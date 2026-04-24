export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AgentRunResult {
  output: string;
  metadata?: Record<string, string>;
}

export interface Agent {
  name: string;
  run(messages: AgentMessage[]): Promise<AgentRunResult>;
}

export class CodexAgent implements Agent {
  public readonly name = 'codex-placeholder';

  public async run(_messages: AgentMessage[]): Promise<AgentRunResult> {
    // TODO(phase-1): connect to real Codex APIs.
    return {
      output: 'CodexAgent placeholder run complete.',
      metadata: { mode: 'placeholder' }
    };
  }
}
