import { spawn } from "node:child_process";
import type { AgentRunRequest, AgentRunResult, ResolvedAgentServer } from "../../types";

export async function runHeadlessAgent(
  resolved: ResolvedAgentServer,
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  if (resolved.settings.type !== "headless") {
    throw new Error(`Agent server is not headless: ${resolved.id}`);
  }

  const args = resolved.settings.argsTemplate.map((arg) => renderArg(arg, request.prompt));
  let output = "";
  let stderr = "";
  const child = spawn(resolved.settings.command, args, {
    cwd: request.cwd,
    env: { ...process.env, ...(resolved.settings.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const abort = () => {
    child.kill();
  };
  request.signal?.addEventListener("abort", abort);
  const timeout = resolved.settings.timeoutMs && resolved.settings.timeoutMs > 0
    ? setTimeout(() => child.kill(), resolved.settings.timeoutMs)
    : undefined;

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    output += text;
    request.onTerminalEvent?.({ stream: "stdout", chunk: text });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    request.onTerminalEvent?.({ stream: "stderr", chunk: text });
  });

  try {
    const { code, signal } = await waitForExit(child);
    if (timeout) clearTimeout(timeout);
    const cancelled = Boolean(request.signal?.aborted);
    const timedOut = Boolean(timeout && signal && code === null && !cancelled);
    if (cancelled) {
      request.onTerminalEvent?.({ stream: "system", chunk: "Headless agent cancelled.\n" });
    } else if (timedOut) {
      request.onTerminalEvent?.({ stream: "system", chunk: "Headless agent timed out.\n" });
    }
    return {
      agentServerId: request.agentServerId,
      exitCode: cancelled || timedOut ? 1 : code ?? 1,
      output: output || stderr,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abort);
  }
}

function renderArg(template: string, prompt: string): string {
  return template
    .replaceAll("{{prompt}}", prompt)
    .replaceAll("{prompt}", prompt);
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
