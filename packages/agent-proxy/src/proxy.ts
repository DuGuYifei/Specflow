import type { AgentProvider } from "@specflow/shared";

export type { AgentProvider };

export interface AgentCommandRequest {
  provider: AgentProvider;
  prompt: string;
  cwd: string;
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
}

export interface AgentCommandResult {
  provider: AgentProvider;
  exitCode: number;
  output: string;
}

export type AgentTerminalStream = "stdout" | "stderr" | "system";

export interface AgentTerminalEvent {
  stream: AgentTerminalStream;
  chunk: string;
}

export async function runAgentCommand(
  request: AgentCommandRequest,
): Promise<AgentCommandResult> {
  const output = `Agent proxy placeholder for ${request.provider}`;
  request.onTerminalEvent?.({
    stream: "stdout",
    chunk: output,
  });

  return {
    provider: request.provider,
    exitCode: 0,
    output,
  };
}
