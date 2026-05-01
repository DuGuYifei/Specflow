import type { AgentCommandRequest } from "../proxy";

export function createClaudeCodeRequest(prompt: string, cwd: string): AgentCommandRequest {
  return {
    provider: "claude-code",
    prompt,
    cwd,
  };
}
