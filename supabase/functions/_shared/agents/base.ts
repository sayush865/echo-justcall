import type { AgentContext } from "./types.ts";

export abstract class Agent {
  abstract readonly name: string;
  abstract run(ctx: AgentContext): Promise<void>;
}
