import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(10000, "Message too long"),
  conversationId: z.string().uuid("Invalid conversation ID"),
  backgroundMode: z.boolean().optional(),
  warmup: z.boolean().optional(),
});

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

// === Echo agent config ===
const PINECONE_INDEX = "echo";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 512;
const CHAT_MODEL = "gpt-4.1";
const MEMORY_WINDOW_MESSAGES = 20; // n8n had contextWindowLength=10 (interactions = pairs)
const MAX_AGENT_ITERATIONS = 6;
const TOPK = 5;

const NAMESPACE_BY_TOOL: Record<string, string> = {
  echo_sales_calls: "Sales Calls",
  echo_cs_calls: "Customer Success Calls",
  echo_support_calls: "Customer Support Calls",
  echo_sales_meetings: "Customer Sales Meetings",
  echo_cs_meetings: "Customer Success Meetings",
  echo_support_meetings: "Customer Support Meetings",
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  echo_sales_calls:
    "Search JustCall customer calls from the Sales team (transcripts, summaries, tags, sentiment).",
  echo_cs_calls:
    "Search JustCall customer calls from the Customer Success team (transcripts, summaries, tags, sentiment).",
  echo_support_calls:
    "Search JustCall customer calls from the Customer Support team (transcripts, summaries, tags, sentiment).",
  echo_sales_meetings:
    "Search JustCall customer meetings from the Sales team (transcripts, summaries, tags, sentiment).",
  echo_cs_meetings:
    "Search JustCall customer meetings from the Customer Success team (transcripts, summaries, tags, sentiment).",
  echo_support_meetings:
    "Search JustCall customer meetings from the Customer Support team (transcripts, summaries, tags, sentiment).",
};

const SYSTEM_PROMPT = `You are Echo, JustCall's voice-of-customer intelligence assistant.

You retrieve and synthesize insights from customer conversations stored in Pinecone. ALWAYS use the appropriate echo tools to find relevant data—never guess or fabricate information.

## Available Tools

| Tool | Data Source |
|------|-------------|
| echo_sales_calls | Sales team calls with customers/leads |
| echo_sales_meetings | Sales team meetings with customers/leads |
| echo_cs_calls | Customer Success team calls |
| echo_cs_meetings | Customer Success team meetings |
| echo_support_calls | Support team calls |
| echo_support_meetings | Support team meetings |

## Tool Selection Rules
- For general queries: Search ALL relevant tools to get comprehensive data
- If query mentions "CS" or "Customer Success": Search both cs_calls AND cs_meetings
- If query mentions "Sales": Search both sales_calls AND sales_meetings
- If query mentions "Support": Search both support_calls AND support_meetings
- Optimize your search query for each tool based on context

## Response Guidelines
1. **Synthesize, don't just list**: Identify patterns, themes, and actionable insights with complete details. Retrieve comprehensive context from Vector DB via tool calls.
2. **Be specific**: Quote or paraphrase actual customer statements when impactful to show accuracy
3. **Acknowledge gaps**: If data isn't found, say so clearly—never fabricate
4. **Stay conversational**: Format for easy reading with headers and bullets where helpful

## Citation Format (CRITICAL)
When referencing sources, use inline citations [source:N] where N starts at 1.
**Cite sources in the order they first appear in your response.**

End your response with a Sources section:

Sources:
[1] CA123abc456def (Sales Call)
[2] 2d955387-24d2-4f30-88c3-883d8096c1b4 (CS Meeting)
[3] CA345mno678pqr (Support Call)

**ID Formats:**
- Calls use callSID: CA-prefixed IDs (e.g., CA123abc456def)
- Meetings use instanceId: CA-prefixed IDs (e.g., CA123abc456def)
- Use accurate IDs (always start with CA, no breaks). Find them in metadata.callSID or metadata.instanceId.

**Type Labels:**
- (Sales Call), (Sales Meeting)
- (CS Call), (CS Meeting)
- (Support Call), (Support Meeting)

Rules:
- Only cite sources you actually retrieved and used
- Number sequentially starting from 1
- Each source on its own line
- Never hallucinate or fabricate source IDs`;

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

  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("ip_address", ipAddress);
  }

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
    resetIn: requestCount < RATE_LIMIT_MAX_REQUESTS ? 0 : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
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

// === Pinecone + OpenAI helpers ===

let cachedIndexHost: string | null = null;

async function getPineconeIndexHost(apiKey: string): Promise<string> {
  if (cachedIndexHost) return cachedIndexHost;
  const fromEnv = Deno.env.get("PINECONE_INDEX_HOST");
  if (fromEnv) {
    cachedIndexHost = fromEnv.replace(/^https?:\/\//, "");
    return cachedIndexHost;
  }
  const res = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX}`, {
    headers: { "Api-Key": apiKey, "X-Pinecone-API-Version": "2025-04" },
  });
  if (!res.ok) {
    throw new Error(`Pinecone describe-index failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedIndexHost = data.host as string;
  return cachedIndexHost;
}

async function embedQuery(text: string, openAiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMS }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding as number[];
}

async function pineconeQuery(
  host: string,
  apiKey: string,
  namespace: string,
  vector: number[],
  topK: number,
): Promise<any[]> {
  const res = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      namespace,
      vector,
      topK,
      includeMetadata: true,
      includeValues: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Pinecone query failed (${namespace}): ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.matches || [];
}

// Pinecone metadata in this index uses flattened dotted keys (e.g. "metadata.call_sid").
// Read both shapes so the LLM and frontend get the right CA-prefixed IDs.
function readMeta(raw: Record<string, any>, key: string): any {
  return raw[key] ?? raw[`metadata.${key}`];
}

function normalizeMatch(m: any) {
  const raw: Record<string, any> = m.metadata || {};
  const callSID = readMeta(raw, "call_sid") ?? raw.callSID ?? raw.callsid;
  const instanceId =
    readMeta(raw, "instance_sid") ??
    readMeta(raw, "instance_id") ??
    raw.instanceId ??
    raw.instanceid;
  const summary = readMeta(raw, "summary_full") ?? readMeta(raw, "summary") ?? raw.summary;
  const text =
    raw.text ??
    readMeta(raw, "text") ??
    readMeta(raw, "content") ??
    readMeta(raw, "transcript") ??
    raw.pageContent;
  const tags = readMeta(raw, "tags") ?? readMeta(raw, "tag");
  const sentiment = readMeta(raw, "sentiment") ?? raw.sentiment;
  const customerName =
    readMeta(raw, "customer_name") ?? readMeta(raw, "customer_names.0");
  const callDate =
    readMeta(raw, "call_date") ??
    readMeta(raw, "meeting_date") ??
    readMeta(raw, "instance_date");
  const direction = readMeta(raw, "direction");
  const meetingTitle = readMeta(raw, "meeting_title");

  return {
    id: m.id,
    score: m.score,
    metadata: {
      ...raw,
      // Aliases the frontend's citation extractor looks for
      callSID,
      instanceId,
      summary,
      text,
      tags,
      sentiment,
      customer_name: customerName,
      call_date: callDate,
      direction,
      meeting_title: meetingTitle,
    },
  };
}

function formatMatchesForLLM(matches: any[]): string {
  if (!matches.length) return "No results found.";
  return matches.map((m, i) => {
    const meta = m.metadata || {};
    const id = meta.callSID || meta.instanceId || m.id;
    const lines = [`[Match ${i + 1}] ID: ${id} (score: ${m.score?.toFixed(3) ?? "n/a"})`];
    if (meta.meeting_title) lines.push(`Title: ${meta.meeting_title}`);
    if (meta.customer_name) lines.push(`Customer: ${meta.customer_name}`);
    if (meta.call_date) lines.push(`Date: ${meta.call_date}`);
    if (meta.direction) lines.push(`Direction: ${meta.direction}`);
    if (meta.sentiment) lines.push(`Sentiment: ${meta.sentiment}`);
    if (meta.tags) {
      lines.push(`Tags: ${typeof meta.tags === "string" ? meta.tags : JSON.stringify(meta.tags)}`);
    }
    if (meta.summary) lines.push(`Summary: ${meta.summary}`);
    if (meta.text && meta.text !== meta.summary) lines.push(`Text: ${meta.text}`);
    return lines.join("\n");
  }).join("\n\n");
}

function buildToolDefs() {
  return Object.keys(NAMESPACE_BY_TOOL).map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query optimized for this tool's data source.",
          },
        },
        required: ["query"],
      },
    },
  }));
}

async function executeToolCall(
  toolName: string,
  args: { query: string },
  pineconeHost: string,
  pineconeKey: string,
  openAiKey: string,
): Promise<{ matchesForFrontend: { matches: any[] }; textForLLM: string }> {
  const namespace = NAMESPACE_BY_TOOL[toolName];
  if (!namespace) {
    return {
      matchesForFrontend: { matches: [] },
      textForLLM: `Unknown tool: ${toolName}`,
    };
  }
  const queryText = args.query || "";
  const vector = await embedQuery(queryText, openAiKey);
  const rawMatches = await pineconeQuery(pineconeHost, pineconeKey, namespace, vector, TOPK);
  const matches = rawMatches.map(normalizeMatch);
  return {
    matchesForFrontend: { matches },
    textForLLM: formatMatchesForLLM(matches),
  };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

async function runChatStream(
  messages: any[],
  tools: any[],
  openAiKey: string,
  onContentDelta: (delta: string) => Promise<void>,
): Promise<{ finish: string | null; toolCalls: AccumulatedToolCall[]; assistantContent: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      tools,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI chat failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finish: string | null = null;
  const toolCallsByIdx = new Map<number, AccumulatedToolCall>();
  let assistantContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          assistantContent += delta.content;
          await onContentDelta(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallsByIdx.get(idx) || { id: "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            toolCallsByIdx.set(idx, existing);
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  const toolCalls = Array.from(toolCallsByIdx.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);

  return { finish, toolCalls, assistantContent };
}

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

async function runEchoAgent(opts: {
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  openAiKey: string;
  pineconeKey: string;
  ndjson: NdjsonStream;
  onProgress: (fullContent: string) => void;
}): Promise<string> {
  const { history, openAiKey, pineconeKey, ndjson, onProgress } = opts;

  const pineconeHost = await getPineconeIndexHost(pineconeKey);
  const tools = buildToolDefs();

  // History from DB already includes the latest user turn
  const historyTrimmed = history.slice(-MEMORY_WINDOW_MESSAGES);
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyTrimmed.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
    const { toolCalls, assistantContent } = await runChatStream(
      messages,
      tools,
      openAiKey,
      async (delta) => {
        await ndjson.write({ type: "item", content: delta });
        onProgress(ndjson.fullContent);
      },
    );

    if (toolCalls.length === 0) {
      return assistantContent;
    }

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        let parsedArgs: { query: string };
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}");
        } catch {
          parsedArgs = { query: "" };
        }
        await ndjson.write({
          type: "step",
          text: `Searching ${tc.name}: "${parsedArgs.query}"`,
        });
        try {
          const { matchesForFrontend, textForLLM } = await executeToolCall(
            tc.name,
            parsedArgs,
            pineconeHost,
            pineconeKey,
            openAiKey,
          );
          await ndjson.write({
            type: "tool",
            toolName: tc.name,
            result: matchesForFrontend,
          });
          return { tc, textForLLM };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`Tool ${tc.name} error:`, msg);
          await ndjson.write({
            type: "tool",
            toolName: tc.name,
            result: { matches: [], error: msg },
          });
          return { tc, textForLLM: `Error running ${tc.name}: ${msg}` };
        }
      }),
    );

    for (const { tc, textForLLM } of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: textForLLM,
      });
    }
  }

  // Hit iteration cap
  return ndjson.fullContent;
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
      console.error("Validation error:", errors);
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
    const ipAddress =
      req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";

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

    const dbMessages = messagesResult.data || [];
    const conversation = conversationResult.data;
    const userId = conversation?.user_id ?? null;
    const userEmail = conversation?.user_email ?? null;

    // Rate limit
    const rateLimit = await checkRateLimit(supabaseAdmin, userId, ipAddress);
    if (!rateLimit.allowed) {
      console.log(
        `[Rate Limit] Blocked: userId=${userId || "anonymous"}, ip=${ipAddress}`,
      );
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
      console.log(`[IP Block] Blocked: ${ipAddress}, reason: ${ipBlock.reason}`);
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

    // Helper: persist final state after agent completes
    const persistFinal = async (
      finalResponse: string,
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
          metadata: meta,
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
          await runEchoAgent({
            userMessage: message,
            history: dbMessages,
            openAiKey,
            pineconeKey,
            ndjson,
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
          await persistFinal(ndjson.fullContent, {
            latency_ms: Date.now() - startTime,
            response_length: ndjson.fullContent.length,
            background_mode: true,
          });
        } catch (err) {
          console.error("Background agent error:", err);
          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false, streaming_content: "" })
            .eq("id", conversationId)
            .catch(() => {});
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

    const agentRun = (async () => {
      try {
        await runEchoAgent({
          userMessage: message,
          history: dbMessages,
          openAiKey,
          pineconeKey,
          ndjson,
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
        console.error("Agent run error:", err);
        await ndjson.write({
          type: "item",
          content: `\n\n[Error: ${err instanceof Error ? err.message : "agent failed"}]`,
        });
      } finally {
        await ndjson.close();
        try {
          await persistFinal(ndjson.fullContent, {
            total_latency_ms: Date.now() - startTime,
            response_length: ndjson.fullContent.length,
            client_disconnected: !ndjson.clientConnected,
          });
        } catch (cleanupErr) {
          console.error("Cleanup error:", cleanupErr);
          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false, streaming_content: "" })
            .eq("id", conversationId)
            .catch(() => {});
        }
      }
    })();

    // Keep the runtime alive even if the client disconnects
    EdgeRuntime.waitUntil(agentRun);

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
