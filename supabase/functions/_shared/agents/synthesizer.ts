import { Agent } from "./base.ts";
import type { AgentContext, RetrievedMatch } from "./types.ts";
import { chatStream } from "../openai.ts";
import { SYNTH_SYSTEM_PROMPT } from "../prompts/synthesizer.ts";

const HISTORY_WINDOW = 20;

export class SynthesizerAgent extends Agent {
  readonly name = "synthesizer";
  constructor(private readonly openAiKey: string, private readonly model = "gpt-4.1") {
    super();
  }

  async run(ctx: AgentContext): Promise<void> {
    const { session, emit } = ctx;
    const matches = session.reranked ?? [];

    const span = ctx.trace?.span?.({
      name: "synthesizer",
      input: { contextChunks: matches.length, historyLength: session.history.length },
    });

    await emit({ type: "step", text: "Writing answer…" });

    const contextBlock = formatMatchesForLLM(matches);

    const messages = [
      { role: "system", content: SYNTH_SYSTEM_PROMPT },
      ...session.history.slice(-HISTORY_WINDOW).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: session.userQuery },
      {
        role: "system",
        content: `Retrieved snippets, in order of relevance:\n\n${contextBlock}`,
      },
    ];

    let full = "";
    try {
      full = await chatStream({
        apiKey: this.openAiKey,
        model: this.model,
        messages,
        parentSpan: span,
        spanName: "synthesizer-llm",
        onContent: async (delta) => {
          await emit({ type: "item", content: delta });
        },
      });
      span?.end?.({ output: { responseLength: full.length } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.errors.push(`synthesizer: ${msg}`);
      await emit({
        type: "item",
        content: `\n\n[Synthesizer error: ${msg}]`,
      });
      span?.end?.({ level: "ERROR", statusMessage: msg });
    }
  }
}

function formatMatchesForLLM(matches: RetrievedMatch[]): string {
  if (!matches.length) return "No relevant snippets were found in the corpus.";
  return matches.map((m, i) => {
    const meta = m.metadata as Record<string, any>;
    const id = meta.callSID || meta.instanceId || m.id;
    const lines = [
      `[Match ${
        i + 1
      }] id=${id} score=${m.score?.toFixed(3) ?? "n/a"} namespace="${m.namespace}"`,
    ];
    if (meta.meeting_title) lines.push(`Title: ${meta.meeting_title}`);
    if (meta.customer_name) lines.push(`Customer: ${meta.customer_name}`);
    if (meta.call_date) lines.push(`Date: ${meta.call_date}`);
    if (meta.direction) lines.push(`Direction: ${meta.direction}`);
    if (meta.sentiment) lines.push(`Sentiment: ${meta.sentiment}`);
    if (meta.summary) lines.push(`Summary: ${meta.summary}`);
    if (m.text && m.text !== meta.summary) lines.push(`Text: ${m.text}`);
    return lines.join("\n");
  }).join("\n\n");
}
