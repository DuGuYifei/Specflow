export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentRunResult {
  status: "completed" | "blocked";
  output: string;
  messages: AgentMessage[];
}

export interface Agent {
  readonly name: string;
  run(messages: AgentMessage[]): Promise<AgentRunResult>;
}

export class CodexAgent implements Agent {
  readonly name = "codex-placeholder";

  async run(messages: AgentMessage[]): Promise<AgentRunResult> {
    return {
      status: "blocked",
      output: "Codex integration is intentionally not implemented yet.",
      messages
    };
  }
}
