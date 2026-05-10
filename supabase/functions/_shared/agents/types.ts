export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface Route {
  toolName: string;     // e.g. "echo_cs_calls" — for frontend display + tool events
  namespace: string;    // e.g. "Customer Success Calls" — actual Pinecone namespace
  searchQuery: string;  // optimized search query, distinct from user's raw question
}

export interface RetrievedMatch {
  id: string;
  score: number;
  namespace: string;
  toolName: string;
  text: string;
  metadata: Record<string, unknown>;
}

// Shared blackboard between agents. Each agent reads what it needs and
// writes its slice. Errors accumulate non-fatally.
export interface Session {
  userQuery: string;
  history: ChatMsg[];
  routes?: Route[];
  retrieved?: RetrievedMatch[];
  reranked?: RetrievedMatch[];
  errors: string[];
}

export type Emit = (obj: Record<string, unknown>) => Promise<void>;

export interface AgentContext {
  session: Session;
  emit: Emit;
}
