export type AgentProvider = "codex" | "claude-code";

export interface AgentCommandRequest {
  provider: AgentProvider;
  prompt: string;
  cwd: string;
}

export interface AgentCommandResult {
  provider: AgentProvider;
  exitCode: number;
  output: string;
}

export async function runAgentCommand(
  request: AgentCommandRequest,
): Promise<AgentCommandResult> {
  return {
    provider: request.provider,
    exitCode: 0,
    output: `Agent proxy placeholder for ${request.provider}`,
  };
}
