import { Agent } from "./base.ts";
import type { AgentContext, Route } from "./types.ts";
import { chatJson } from "../openai.ts";
import { ROUTER_SYSTEM_PROMPT } from "../prompts/router.ts";

const TOOL_TO_NAMESPACE: Record<string, string> = {
  echo_sales_calls: "Sales Calls",
  echo_sales_meetings: "Customer Sales Meetings",
  echo_cs_calls: "Customer Success Calls",
  echo_cs_meetings: "Customer Success Meetings",
  echo_support_calls: "Customer Support Calls",
  echo_support_meetings: "Customer Support Meetings",
};

const ALL_TOOLS = Object.keys(TOOL_TO_NAMESPACE);
const HISTORY_WINDOW = 10;

interface RouterResponse {
  routes?: Array<{ tool?: string; search_query?: string }>;
}

export class RouterAgent extends Agent {
  readonly name = "router";
  constructor(private readonly openAiKey: string, private readonly model = "gpt-4.1-mini") {
    super();
  }

  async run(ctx: AgentContext): Promise<void> {
    const { session, emit } = ctx;
    const span = ctx.trace?.span?.({
      name: "router",
      input: { userQuery: session.userQuery, historyLength: session.history.length },
    });

    await emit({ type: "step", text: "Planning search…" });

    const messages = [
      { role: "system", content: ROUTER_SYSTEM_PROMPT },
      ...session.history.slice(-HISTORY_WINDOW).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: session.userQuery },
    ];

    let parsed: RouterResponse = {};
    try {
      parsed = await chatJson<RouterResponse>({
        apiKey: this.openAiKey,
        model: this.model,
        messages,
        parentSpan: span,
        spanName: "router-llm",
      });
    } catch (err) {
      session.errors.push(`router: ${err instanceof Error ? err.message : String(err)}`);
    }

    const valid = (parsed.routes ?? [])
      .filter((r): r is { tool: string; search_query: string } =>
        typeof r.tool === "string" &&
        typeof r.search_query === "string" &&
        r.search_query.length > 0 &&
        TOOL_TO_NAMESPACE[r.tool] !== undefined
      );

    let routes: Route[];
    let usedFallback = false;
    if (valid.length === 0) {
      usedFallback = true;
      routes = ALL_TOOLS.map((tool) => ({
        toolName: tool,
        namespace: TOOL_TO_NAMESPACE[tool],
        searchQuery: session.userQuery,
      }));
    } else {
      routes = valid.map((r) => ({
        toolName: r.tool,
        namespace: TOOL_TO_NAMESPACE[r.tool],
        searchQuery: r.search_query,
      }));
    }

    session.routes = routes;
    span?.end?.({
      output: {
        chosenTools: routes.map((r) => r.toolName),
        usedFallback,
        routeCount: routes.length,
      },
    });
  }
}
