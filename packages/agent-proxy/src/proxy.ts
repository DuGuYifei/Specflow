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
  if (request.provider === "mock") {
    const output = createMockAgentOutput(request.prompt);
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

  const command = request.provider === "claude-code" ? "claude" : "codex";
  const proc = Bun.spawn([command, request.prompt], {
    cwd: request.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    name: AgentTerminalStream,
  ) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      output += text;
      request.onTerminalEvent?.({ stream: name, chunk: text });
    }
  };

  await Promise.all([
    readStream(proc.stdout, "stdout"),
    readStream(proc.stderr, "stderr"),
  ]);

  const exitCode = await proc.exited;
  return { provider: request.provider, exitCode, output };
}

function createMockAgentOutput(prompt: string): string {
  return `Mock agent response:\n${prompt}`;
}
