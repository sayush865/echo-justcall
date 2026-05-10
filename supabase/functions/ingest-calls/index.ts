import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  corsHeaders,
  embedBatch,
  extractTopics,
  getJustcallToken,
  getPineconeIndexHost,
  pineconeUpsert,
  splitText,
} from "../_shared/ingest-helpers.ts";

const requestSchema = z.object({
  team: z.enum(["sales", "success", "support"]),
  url: z.string().url().optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
});

const TEAM_CONFIG: Record<
  "sales" | "success" | "support",
  { namespace: string; source: string; defaultUrl: string }
> = {
  sales: {
    namespace: "Sales Calls",
    source: "justcall_sales_call",
    defaultUrl:
      "https://api.justcall.io/v2/calls/reports?per_page=100&platform=justcall&fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false&order=desc",
  },
  success: {
    namespace: "Customer Success Calls",
    source: "justcall_customer_success_call",
    defaultUrl:
      "https://api.justcall.io/v2/calls/reports?per_page=100&platform=justcall&fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false&order=desc",
  },
  support: {
    namespace: "Customer Support Calls",
    source: "justcall_customer_support_call",
    defaultUrl:
      "https://api.justcall.io/v2/calls/reports?per_page=100&platform=justcall&fetch_transcription=true&fetch_summary=false&fetch_ai_insights=false&fetch_action_items=false&fetch_smart_chapters=false&order=desc",
  },
};

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

function sanitizeSupport(field: "name" | "number", value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (field === "name" && trimmed === "Emma S.") return "";
  if (field === "number" && trimmed === "18106313405") return "";
  return trimmed;
}

function buildTranscript(transcription: any[]): string {
  let out = "";
  for (const line of transcription) {
    const sentence = (line.sentence || "").trim();
    const ts = line.timestamp
      ? `[${line.timestamp.starttime}s → ${line.timestamp.endtime}s]`
      : "";
    out += `${sentence} ${ts}\n`;
  }
  return out.trim();
}

interface ProcessedCall {
  metadata: Record<string, unknown>;
  chunks: string[];
}

async function processCall(
  call: any,
  team: "sales" | "success" | "support",
  source: string,
  openAiKey: string,
): Promise<ProcessedCall | null> {
  const trans = call?.justcall_iq?.call_transcription;
  if (!Array.isArray(trans) || trans.length === 0) return null;

  const transcript = buildTranscript(trans);
  if (!transcript) return null;

  const summaryClean = (call?.justcall_iq?.call_summary || "")
    .replace(/Call Summary:/gi, "")
    .replace(/Action Items:/gi, "")
    .trim();

  let topics: string[] = [];
  try {
    topics = await extractTopics(transcript, openAiKey);
  } catch (err) {
    console.error(`topic extraction failed for ${call.call_sid}:`, err);
  }

  const customerName = team === "support"
    ? sanitizeSupport("name", call.contact_name)
    : (call.contact_name || "");
  const customerNumber = team === "support"
    ? sanitizeSupport("number", call.contact_number)
    : (call.contact_number || "");

  const metadata: Record<string, unknown> = {
    call_id: call.id,
    call_sid: call.call_sid,
    customer_name: customerName,
    customer_number: customerNumber,
    customer_email: call.contact_email || "",
    justcall_agent_name: call.agent_name,
    justcall_agent_email: call.agent_email,
    call_date: call.call_date,
    call_time: call.call_time,
    direction: call.call_info?.direction || "",
    call_type: call.call_info?.type || "",
    status: call.call_info?.status || "",
    duration_seconds: call.call_duration?.total_duration || 0,
    sentiment: call.justcall_iq?.customer_sentiment || "unknown",
    call_score: call.justcall_iq?.call_score || 0,
    call_moments: call.justcall_iq?.call_moments || [],
    summary_full: summaryClean,
    topics,
    source,
    transcript_length: transcript.length,
    transcript_lines: trans.length,
  };

  if (team === "sales" && call.call_info?.recording) {
    metadata.recording = call.call_info.recording;
  }

  const chunks = splitText(transcript, {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  return { metadata, chunks };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.errors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { team, url: urlOverride, maxPages = 1 } = parsed.data;

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const pineconeKey = Deno.env.get("PINECONE_API_KEY");
    if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured");
    if (!pineconeKey) throw new Error("PINECONE_API_KEY is not configured");

    const justcallToken = getJustcallToken(team);
    const cfg = TEAM_CONFIG[team];
    const pineconeHost = await getPineconeIndexHost(pineconeKey);

    let currentUrl: string | null = urlOverride || cfg.defaultUrl;
    let pagesProcessed = 0;
    let recordsSeen = 0;
    let recordsIngested = 0;
    let chunksUpserted = 0;
    const errors: string[] = [];
    const ingestedSids: string[] = [];

    while (currentUrl && pagesProcessed < maxPages) {
      console.log(`[ingest-calls/${team}] page ${pagesProcessed + 1}: ${currentUrl}`);
      const apiRes = await fetch(currentUrl, {
        headers: {
          Authorization: justcallToken,
          accept: "application/json",
        },
      });
      if (!apiRes.ok) {
        throw new Error(
          `JustCall API failed: ${apiRes.status} ${await apiRes.text()}`,
        );
      }
      const apiData = await apiRes.json();
      const list: any[] = apiData?.list || [];
      const nextPage: string | null = apiData?.nextPage || null;

      const filtered = list.filter((c) =>
        Array.isArray(c?.justcall_iq?.call_transcription) &&
        c.justcall_iq.call_transcription.length > 0
      );
      recordsSeen += list.length;

      // Process records in parallel
      const processed = (
        await Promise.all(
          filtered.map((c) => processCall(c, team, cfg.source, openAiKey)),
        )
      ).filter((p): p is ProcessedCall => p !== null);

      // Embed all chunks across all records, then upsert
      const flatChunks: { recordIdx: number; chunkIdx: number; text: string }[] = [];
      processed.forEach((p, recordIdx) => {
        p.chunks.forEach((text, chunkIdx) => {
          flatChunks.push({ recordIdx, chunkIdx, text });
        });
      });

      let embeddings: number[][] = [];
      try {
        embeddings = await embedBatch(flatChunks.map((c) => c.text), openAiKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`embed batch failed: ${msg}`);
        console.error("embed batch failed:", err);
      }

      const vectors: { id: string; values: number[]; metadata: Record<string, unknown> }[] = [];
      flatChunks.forEach((fc, i) => {
        if (!embeddings[i]) return;
        const record = processed[fc.recordIdx];
        vectors.push({
          id: crypto.randomUUID(),
          values: embeddings[i],
          metadata: { ...record.metadata, text: fc.text, chunk_index: fc.chunkIdx },
        });
      });

      try {
        await pineconeUpsert(pineconeHost, pineconeKey, cfg.namespace, vectors);
        chunksUpserted += vectors.length;
        recordsIngested += processed.length;
        for (const p of processed) {
          if (p.metadata.call_sid) ingestedSids.push(String(p.metadata.call_sid));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`pinecone upsert failed on page ${pagesProcessed + 1}: ${msg}`);
        console.error("pinecone upsert failed:", err);
      }

      pagesProcessed++;
      currentUrl = nextPage && nextPage.length > 0 ? nextPage : null;
    }

    return new Response(
      JSON.stringify({
        team,
        namespace: cfg.namespace,
        pagesProcessed,
        recordsSeen,
        recordsIngested,
        chunksUpserted,
        ingestedSids,
        nextPage: currentUrl,
        errors,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("ingest-calls error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
