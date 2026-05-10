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
    namespace: "Customer Sales Meetings",
    source: "justcall_sales_meetings",
    defaultUrl:
      "https://api.justcall.io/v2.1/meetings_ai?per_page=20&fetch_transcription=true&fetch_summary=true&fetch_ai_insights=true&fetch_action_items=true&fetch_smart_chapters=true&order=desc",
  },
  success: {
    namespace: "Customer Success Meetings",
    source: "justcall_success_meetings",
    defaultUrl:
      "https://api.justcall.io/v2.1/meetings_ai?per_page=20&fetch_transcription=true&fetch_summary=true&fetch_ai_insights=true&fetch_action_items=true&fetch_smart_chapters=true&order=desc",
  },
  support: {
    namespace: "Customer Support Meetings",
    source: "justcall_support_meetings",
    defaultUrl:
      "https://api.justcall.io/v2.1/meetings_ai?per_page=20&fetch_transcription=true&fetch_summary=true&fetch_ai_insights=true&fetch_action_items=true&fetch_smart_chapters=true&order=desc",
  },
};

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 250;

const AGENT_DOMAINS = ["@saaslabs.co", "@justcall.io"];

function normalize(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findEmail(name: string, inviteEmails: string[]): string | null {
  if (!name) return null;
  const n = normalize(name);
  for (const email of inviteEmails) {
    const local = email.split("@")[0];
    const ln = normalize(local);
    if (ln.includes(n) || n.includes(ln)) return email;
  }
  return null;
}

function classifySpeakers(meeting: any): {
  agent_names: string[];
  agent_emails: string[];
  customer_names: string[];
  customer_emails: string[];
} {
  const speakers = meeting.speakers || [];
  const inviteEmails = meeting.invitee_emails || [];
  const agent_names: string[] = [];
  const agent_emails: string[] = [];
  const customer_names: string[] = [];
  const customer_emails: string[] = [];

  for (const sp of speakers) {
    if (!sp.name) continue;
    if (sp.name.toLowerCase().includes("notetaker")) continue;
    const email = findEmail(sp.name, inviteEmails);
    const isAgent = email && AGENT_DOMAINS.some((d) => email.endsWith(d));
    if (isAgent) {
      agent_names.push(sp.name);
      agent_emails.push(email!);
    } else {
      customer_names.push(sp.name);
      if (email) customer_emails.push(email);
    }
  }
  return { agent_names, agent_emails, customer_names, customer_emails };
}

function buildTranscript(meeting: any): string {
  const speakers: any[] = meeting.speakers || [];
  const trans: any[] = meeting.instance_transcription || [];
  let out = "";
  for (const line of trans) {
    const sp = speakers.find((s) => String(s.id) === String(line.speaker_id));
    const name = sp?.name || `Speaker ${line.speaker_id}`;
    const text = line.sentence || "";
    const ts = line.timestamp
      ? `[${line.timestamp.starttime}s → ${line.timestamp.endtime}s]`
      : "";
    out += `${name}: ${text} ${ts}\n`;
  }
  return out.trim();
}

interface ProcessedMeeting {
  metadata: Record<string, unknown>;
  chunks: string[];
}

async function processMeeting(
  meeting: any,
  source: string,
  openAiKey: string,
): Promise<ProcessedMeeting | null> {
  if (!meeting.instance_sid) return null;
  const trans = meeting.instance_transcription;
  if (!Array.isArray(trans) || trans.length === 0) return null;

  const transcript = buildTranscript(meeting);
  if (!transcript) return null;

  const summaryClean = (meeting.instance_summary || "")
    .replace(/Call Summary:/gi, "")
    .replace(/Action Items:/gi, "")
    .trim();

  const { agent_names, agent_emails, customer_names, customer_emails } =
    classifySpeakers(meeting);

  let topics: string[] = [];
  try {
    topics = await extractTopics(transcript, openAiKey);
  } catch (err) {
    console.error(`topic extraction failed for ${meeting.instance_sid}:`, err);
  }

  const metadata: Record<string, unknown> = {
    instance_sid: meeting.instance_sid,
    meeting_id: meeting.meeting_id,
    meeting_title: meeting.meeting_title,
    platform: meeting.platform,
    instance_date: meeting.instance_date,
    instance_time: meeting.instance_time,
    instance_duration: meeting.instance_duration,
    instance_friendly_duration: meeting.instance_friendly_duration,
    topics,
    moments: meeting.instance_moments || [],
    sentiment: meeting.sentiment,
    meeting_score: meeting.manual_instance_score || 0,
    summary_full: summaryClean,
    agent_names,
    agent_emails,
    customer_names,
    customer_emails,
    source,
    transcript_length: transcript.length,
    transcript_lines: trans.length,
  };

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
      console.log(`[ingest-meetings/${team}] page ${pagesProcessed + 1}: ${currentUrl}`);
      // Strip n8n's "&fetch_*" suffixes and re-add cleanly
      const cleanUrl = currentUrl.split("&fetch_")[0];
      const apiRes = await fetch(cleanUrl, {
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
      const list: any[] = apiData?.data || [];
      const nextPage: string | null = apiData?.next_page_link || null;

      const filtered = list.filter((m) =>
        Array.isArray(m?.instance_transcription) &&
        m.instance_transcription.length > 0
      );
      recordsSeen += list.length;

      const processed = (
        await Promise.all(
          filtered.map((m) => processMeeting(m, cfg.source, openAiKey)),
        )
      ).filter((p): p is ProcessedMeeting => p !== null);

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
          if (p.metadata.instance_sid) ingestedSids.push(String(p.metadata.instance_sid));
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
    console.error("ingest-meetings error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
