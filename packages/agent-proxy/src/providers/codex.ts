import type { AgentCommandRequest } from "../proxy";

export function createCodexRequest(prompt: string, cwd: string): AgentCommandRequest {
  return {
    provider: "codex",
    prompt,
    cwd,
  };
}
