import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { Langfuse } from "npm:langfuse@3";
import { corsHeaders } from "../_shared/cors.ts";
import { getPineconeIndexHost } from "../_shared/pinecone.ts";
import { RouterAgent } from "../_shared/agents/router.ts";
import { RetrievalAgent } from "../_shared/agents/retrieval.ts";
import { RerankerAgent } from "../_shared/agents/reranker.ts";
import { SynthesizerAgent } from "../_shared/agents/synthesizer.ts";
import { runAllOnlineScorers } from "../_shared/scorers.ts";
import type { ChatMsg, Session, TraceParent } from "../_shared/agents/types.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(10000, "Message too long"),
  conversationId: z.string().uuid("Invalid conversation ID"),
  backgroundMode: z.boolean().optional(),
  warmup: z.boolean().optional(),
});

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

// Format reranked chunks as a single string for online evaluators (hallucination,
// faithfulness, etc.) that need the retrieved context as a {{context}} variable.
function formatContextForEval(
  matches: Array<{ text: string; metadata: Record<string, unknown> }>,
): string {
  if (!matches.length) return "";
  const parts = matches.map((m) => {
    const meta = m.metadata as Record<string, any>;
    const id = meta.callSID || meta.instanceId || "unknown";
    const summary = typeof meta.summary === "string" ? meta.summary : "";
    const body = m.text || summary;
    return `[Source ${id}]\n${body}`.slice(0, 1500);
  });
  // Cap total to ~30k chars to keep trace payload reasonable.
  let out = "";
  for (const p of parts) {
    if (out.length + p.length + 2 > 30000) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out;
}

// Run async scorers and attach results to the trace. Failures swallowed —
// scoring must never affect the user response.
async function runScorers(opts: {
  trace: TraceParent;
  query: string;
  answer: string;
  session: Session;
  openAiKey: string;
}): Promise<void> {
  if (!opts.trace || !opts.answer) return;
  const scores = await runAllOnlineScorers({
    query: opts.query,
    answer: opts.answer,
    session: opts.session,
    openAiKey: opts.openAiKey,
  });
  for (const s of scores) {
    try {
      opts.trace.score?.({
        name: s.name,
        value: s.value,
        comment: s.comment,
        dataType: "NUMERIC",
      });
    } catch (err) {
      console.error(`${s.name} score error:`, err);
    }
  }
}

// === Rate-limit / IP-block helpers ===

async function checkRateLimit(
  supabaseAdmin: any,
  userId: string | null,
  ipAddress: string,
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  let query = supabaseAdmin
    .from("audit_logs")
    .select("created_at", { count: "exact" })
    .eq("event_type", "user_message")
    .gte("created_at", windowStart);
  if (userId) query = query.eq("user_id", userId);
  else query = query.eq("ip_address", ipAddress);
  const { count, error } = await query;
  if (error) {
    console.error("Rate limit check error:", error);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS, resetIn: 0 };
  }
  const requestCount = count || 0;
  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - requestCount);
  return {
    allowed: requestCount < RATE_LIMIT_MAX_REQUESTS,
    remaining,
    resetIn: requestCount < RATE_LIMIT_MAX_REQUESTS
      ? 0
      : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
  };
}

async function checkIPBlocked(
  supabaseAdmin: any,
  ipAddress: string,
): Promise<{ blocked: boolean; reason: string | null }> {
  if (!ipAddress) return { blocked: false, reason: null };
  const { data, error } = await supabaseAdmin
    .from("blocked_ips")
    .select("ip_address, reason")
    .eq("ip_address", ipAddress)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("IP block check error:", error);
    return { blocked: false, reason: null };
  }
  return { blocked: !!data, reason: data?.reason || null };
}

// === NDJSON streamer (handles client disconnect gracefully) ===

class NdjsonStream {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null;
  private encoder = new TextEncoder();
  fullContent = "";
  clientConnected: boolean;

  constructor(writer: WritableStreamDefaultWriter<Uint8Array> | null) {
    this.writer = writer;
    this.clientConnected = !!writer;
  }

  async write(obj: any): Promise<void> {
    if (obj.type === "item" && typeof obj.content === "string") {
      this.fullContent += obj.content;
    }
    if (this.writer && this.clientConnected) {
      try {
        await this.writer.write(this.encoder.encode(JSON.stringify(obj) + "\n"));
      } catch (err) {
        console.log("Client disconnected, continuing in background:", err);
        this.clientConnected = false;
      }
    }
  }

  async close(): Promise<void> {
    if (this.writer && this.clientConnected) {
      try {
        await this.writer.close();
      } catch {
        // ignore
      }
    }
  }
}

// === Pipeline orchestrator (Router → Retrieval → Reranker → Synthesizer) ===

async function runEchoPipeline(opts: {
  userQuery: string;
  history: ChatMsg[];
  openAiKey: string;
  pineconeKey: string;
  pineconeHost: string;
  ndjson: NdjsonStream;
  onProgress: (fullContent: string) => void;
  trace?: TraceParent;
}): Promise<Session> {
  const session: Session = {
    userQuery: opts.userQuery,
    history: opts.history,
    errors: [],
  };

  const ctx = {
    session,
    emit: async (obj: Record<string, unknown>) => {
      if (obj.type === "item" && typeof obj.content === "string") {
        opts.onProgress(opts.ndjson.fullContent + obj.content);
      }
      await opts.ndjson.write(obj);
    },
    trace: opts.trace,
  };

  const router = new RouterAgent(opts.openAiKey);
  const retriever = new RetrievalAgent(
    opts.openAiKey,
    opts.pineconeKey,
    opts.pineconeHost,
  );
  const reranker = new RerankerAgent(opts.pineconeKey);
  const synthesizer = new SynthesizerAgent(opts.openAiKey);

  await router.run(ctx);
  await retriever.run(ctx);
  await reranker.run(ctx);
  await synthesizer.run(ctx);

  return session;
}

// === HTTP entrypoint ===

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const rawBody = await req.json();

    if (rawBody.warmup === true) {
      return new Response(JSON.stringify({ status: "warm" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parseResult = chatRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return new Response(
        JSON.stringify({ error: "Invalid request", details: errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { message, conversationId, backgroundMode } = parseResult.data;

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const pineconeKey = Deno.env.get("PINECONE_API_KEY");
    if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured");
    if (!pineconeKey) throw new Error("PINECONE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const userAgent = req.headers.get("user-agent") || "";
    const ipAddress = req.headers.get("x-forwarded-for") ||
      req.headers.get("cf-connecting-ip") || "";

    // Parallel DB startup
    const parallelStartTime = Date.now();
    const [_updateResult, messagesResult, conversationResult] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .update({ pending_response: true, streaming_content: "" })
        .eq("id", conversationId),
      supabaseAdmin
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle(),
    ]);
    const parallelDuration = Date.now() - parallelStartTime;
    console.log(`[Latency] Parallel DB startup: ${parallelDuration}ms`);

    const dbMessages: ChatMsg[] = (messagesResult.data || []).map((m: any) => ({
      role: m.role as ChatMsg["role"],
      content: m.content as string,
    }));
    const conversation = conversationResult.data;
    const userId = conversation?.user_id ?? null;
    const userEmail = conversation?.user_email ?? null;

    // Rate limit
    const rateLimit = await checkRateLimit(supabaseAdmin, userId, ipAddress);
    if (!rateLimit.allowed) {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        user_email: userEmail,
        conversation_id: conversationId,
        event_type: "rate_limit_exceeded",
        message_content: message?.substring(0, 200),
        metadata: {
          rate_limited: true,
          remaining: rateLimit.remaining,
          reset_in_seconds: rateLimit.resetIn,
          ip_address: ipAddress,
        },
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      await supabaseAdmin
        .from("conversations")
        .update({ pending_response: false, streaming_content: "" })
        .eq("id", conversationId);
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Please wait before sending more messages.",
          retryAfter: rateLimit.resetIn,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(rateLimit.resetIn),
          },
        },
      );
    }

    // IP block
    const ipBlock = await checkIPBlocked(supabaseAdmin, ipAddress);
    if (ipBlock.blocked) {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        user_email: userEmail,
        conversation_id: conversationId,
        event_type: "ip_blocked",
        message_content: message?.substring(0, 200),
        metadata: {
          ip_blocked: true,
          ip_address: ipAddress,
          block_reason: ipBlock.reason,
        },
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      await supabaseAdmin
        .from("conversations")
        .update({ pending_response: false, streaming_content: "" })
        .eq("id", conversationId);
      return new Response(
        JSON.stringify({ error: "Access denied. Your IP has been blocked." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Audit user message (fire-and-forget)
    EdgeRuntime.waitUntil((async () => {
      try {
        await supabaseAdmin.from("audit_logs").insert({
          user_id: userId,
          conversation_id: conversationId,
          event_type: "user_message",
          message_content: message,
          metadata: {
            message_count: dbMessages.length,
            conversation_title: conversation?.title || "",
            startup_parallel_time_ms: parallelDuration,
          },
          ip_address: ipAddress,
          user_agent: userAgent,
        });
      } catch (err) {
        console.error("Audit log error:", err);
      }
    })());

    // Resolve Pinecone host (cached at module level after first call)
    const pineconeHost = await getPineconeIndexHost(pineconeKey);

    // === Langfuse tracing (optional — degrades gracefully if keys missing) ===
    const lfPublic = Deno.env.get("LANGFUSE_PUBLIC_KEY");
    const lfSecret = Deno.env.get("LANGFUSE_SECRET_KEY");
    const langfuse = lfPublic && lfSecret
      ? new Langfuse({
        publicKey: lfPublic,
        secretKey: lfSecret,
        baseUrl: Deno.env.get("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
        flushAt: 1,
      })
      : null;

    const trace = langfuse?.trace({
      name: "echo-chat",
      sessionId: conversationId,
      userId: userId ?? undefined,
      input: { query: message },
      metadata: {
        conversationTitle: conversation?.title,
        ip: ipAddress,
        historyLength: dbMessages.length,
      },
    });

    // Helper: persist final state after pipeline completes
    const persistFinal = async (
      finalResponse: string,
      session: Session,
      meta: Record<string, unknown>,
    ) => {
      const ops: Promise<unknown>[] = [];
      if (finalResponse.length > 0) {
        ops.push(
          supabaseAdmin.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: finalResponse,
            user_id: userId,
            user_email: userEmail,
          }),
        );
      }
      ops.push(
        supabaseAdmin.from("audit_logs").insert({
          user_id: userId,
          conversation_id: conversationId,
          event_type: "ai_response",
          ai_response: finalResponse,
          metadata: {
            ...meta,
            agent_errors: session.errors,
            routes: session.routes?.map((r) => r.toolName) ?? [],
            retrieved_count: session.retrieved?.length ?? 0,
            reranked_count: session.reranked?.length ?? 0,
          },
          ip_address: ipAddress,
          user_agent: userAgent,
        }),
      );
      ops.push(
        supabaseAdmin
          .from("conversations")
          .update({ pending_response: false, streaming_content: "" })
          .eq("id", conversationId),
      );
      await Promise.all(ops);
    };

    // === Background-mode path (fire-and-forget, no client stream) ===
    if (backgroundMode) {
      EdgeRuntime.waitUntil((async () => {
        const ndjson = new NdjsonStream(null);
        let lastSaveTime = Date.now();
        try {
          const session = await runEchoPipeline({
            userQuery: message,
            history: dbMessages,
            openAiKey,
            pineconeKey,
            pineconeHost,
            ndjson,
            trace,
            onProgress: (fullContent) => {
              if (Date.now() - lastSaveTime > 500) {
                lastSaveTime = Date.now();
                supabaseAdmin
                  .from("conversations")
                  .update({ streaming_content: fullContent })
                  .eq("id", conversationId)
                  .then(() => {})
                  .catch((err: unknown) => console.error("progress save:", err));
              }
            },
          });
          trace?.update({
            output: ndjson.fullContent,
            metadata: {
              latency_ms: Date.now() - startTime,
              agent_errors: session.errors,
              routes: session.routes?.map((r) => r.toolName) ?? [],
              retrieved_count: session.retrieved?.length ?? 0,
              reranked_count: session.reranked?.length ?? 0,
              retrieved_context: formatContextForEval(session.reranked ?? []),
            },
          });
          await persistFinal(ndjson.fullContent, session, {
            latency_ms: Date.now() - startTime,
            response_length: ndjson.fullContent.length,
            background_mode: true,
          });
          await runScorers({
            trace,
            query: message,
            answer: ndjson.fullContent,
            session,
            openAiKey,
          });
        } catch (err) {
          console.error("Background pipeline error:", err);
          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false, streaming_content: "" })
            .eq("id", conversationId)
            .catch(() => {});
        } finally {
          if (langfuse) await langfuse.flushAsync();
        }
      })());
      return new Response(
        JSON.stringify({ status: "processing", conversationId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // === Streaming path ===
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const ndjson = new NdjsonStream(writer);
    let lastSaveTime = Date.now();
    let session: Session | null = null;

    const pipelineRun = (async () => {
      try {
        session = await runEchoPipeline({
          userQuery: message,
          history: dbMessages,
          openAiKey,
          pineconeKey,
          pineconeHost,
          ndjson,
          trace,
          onProgress: (fullContent) => {
            if (Date.now() - lastSaveTime > 500) {
              lastSaveTime = Date.now();
              supabaseAdmin
                .from("conversations")
                .update({ streaming_content: fullContent })
                .eq("id", conversationId)
                .then(() => {})
                .catch((err: unknown) => console.error("progress save:", err));
            }
          },
        });
      } catch (err) {
        console.error("Pipeline error:", err);
        await ndjson.write({
          type: "item",
          content: `\n\n[Pipeline error: ${
            err instanceof Error ? err.message : "unknown"
          }]`,
        });
      } finally {
        await ndjson.close();
        try {
          trace?.update({
            output: ndjson.fullContent,
            metadata: {
              total_latency_ms: Date.now() - startTime,
              client_disconnected: !ndjson.clientConnected,
              agent_errors: session?.errors ?? [],
              routes: session?.routes?.map((r) => r.toolName) ?? [],
              retrieved_count: session?.retrieved?.length ?? 0,
              reranked_count: session?.reranked?.length ?? 0,
              retrieved_context: formatContextForEval(session?.reranked ?? []),
            },
          });
          await persistFinal(
            ndjson.fullContent,
            session ?? { userQuery: message, history: dbMessages, errors: [] },
            {
              total_latency_ms: Date.now() - startTime,
              response_length: ndjson.fullContent.length,
              client_disconnected: !ndjson.clientConnected,
            },
          );
          await runScorers({
            trace,
            query: message,
            answer: ndjson.fullContent,
            session: session ??
              { userQuery: message, history: dbMessages, errors: [] },
            openAiKey,
          });
        } catch (cleanupErr) {
          console.error("Cleanup error:", cleanupErr);
          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false, streaming_content: "" })
            .eq("id", conversationId)
            .catch(() => {});
        } finally {
          if (langfuse) await langfuse.flushAsync();
        }
      }
    })();

    // Keep the runtime alive even if the client disconnects
    EdgeRuntime.waitUntil(pipelineRun);

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
