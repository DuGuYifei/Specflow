import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runAgentCommand } from "../../proxy";

describe("headless agent runtime", () => {
  test("interpolates prompt into argsTemplate and captures stdout", async () => {
    const root = await projectWithHeadless({
      command: "sh",
      argsTemplate: ["-c", "printf 'prompt:%s' \"$0\"", "{prompt}"],
    });
    const terminal: string[] = [];

    const result = await runAgentCommand({
      agentServerId: "headless",
      cwd: root,
      prompt: "hello",
      onTerminalEvent: (event) => terminal.push(`${event.stream}:${event.chunk}`),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("prompt:hello");
    expect(terminal.join("")).toContain("stdout:prompt:hello");
  });

  test("captures stderr and non-zero exit code", async () => {
    const root = await projectWithHeadless({
      command: "sh",
      argsTemplate: ["-c", "printf 'bad' >&2; exit 7"],
    });

    const result = await runAgentCommand({
      agentServerId: "headless",
      cwd: root,
      prompt: "hello",
    });

    expect(result.exitCode).toBe(7);
    expect(result.output).toBe("bad");
  });

  test("merges configured environment variables", async () => {
    const root = await projectWithHeadless({
      command: "sh",
      argsTemplate: ["-c", "printf '%s' \"$TOKEN\""],
      env: { TOKEN: "from-env" },
    });

    const result = await runAgentCommand({
      agentServerId: "headless",
      cwd: root,
      prompt: "hello",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("from-env");
  });

  test("supports cancellation", async () => {
    const root = await projectWithHeadless({
      command: "sh",
      argsTemplate: ["-c", "sleep 5"],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await runAgentCommand({
      agentServerId: "headless",
      cwd: root,
      prompt: "hello",
      signal: controller.signal,
    });

    expect(result.exitCode).toBe(1);
  });
});

async function projectWithHeadless(settings: {
  command: string;
  argsTemplate: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-headless-"));
  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
    agent_servers: {
      headless: {
        type: "headless",
        ...settings,
      },
    },
  }), "utf8");
  return root;
}
