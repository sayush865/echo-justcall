export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface Route {
  toolName: string;
  namespace: string;
  searchQuery: string;
}

export interface RetrievedMatch {
  id: string;
  score: number;
  namespace: string;
  toolName: string;
  text: string;
  metadata: Record<string, unknown>;
}

// Shared blackboard between agents.
export interface Session {
  userQuery: string;
  history: ChatMsg[];
  routes?: Route[];
  retrieved?: RetrievedMatch[];
  reranked?: RetrievedMatch[];
  errors: string[];
}

export type Emit = (obj: Record<string, unknown>) => Promise<void>;

// Loosely typed Langfuse trace/span. Both LangfuseTraceClient and
// LangfuseSpanClient expose .span() and .generation(); we don't need stronger
// types here, and avoiding the import keeps this module dependency-free.
// deno-lint-ignore no-explicit-any
export type TraceParent = any | null | undefined;

export interface AgentContext {
  session: Session;
  emit: Emit;
  trace?: TraceParent;
}
