import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { AgentProxySessionPool } from "./session-pool";

describe("AgentProxySessionPool", () => {
  it("uses one ACP process for multiple sessions and forks a parent session", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-pool-"));
    const specflowDir = join(cwd, ".specflow");
    const fakeAgentPath = fileURLToPath(new URL("./runtimes/acp/test-fixtures/fake-agent.ts", import.meta.url));
    await mkdir(specflowDir, { recursive: true });
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");
    await writeFile(join(specflowDir, "agent-servers.json"), JSON.stringify({
      agent_servers: {
        fake: {
          type: "custom",
          command: "bun",
          args: [fakeAgentPath],
          default_mode: "auto",
          default_model: "test-model",
          default_config_options: { reasoning: "high" },
          env: { SPECFLOW_FAKE_ACP_RESTORE: "fork" },
        },
      },
    }), "utf8");

    const pool = new AgentProxySessionPool({ root: cwd });
    const lifecycle: string[] = [];
    const onLifecycleEvent = (event: { type: string }) => lifecycle.push(event.type);
    try {
      const first = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-a",
        prompt: "first",
        onLifecycleEvent,
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });
      const second = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-a",
        prompt: "second",
        onLifecycleEvent,
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });
      const separate = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-b",
        prompt: "separate",
        onLifecycleEvent,
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });
      const forked = await pool.run({
        agentServerId: "fake",
        cwd,
        workflowSessionId: "session-a-fork-01",
        forkFromWorkflowSessionId: "session-a",
        prompt: "fork",
        onLifecycleEvent,
        onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      });

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(first.sessionId).toBe(second.sessionId);
      expect(first.output).toContain("turn:1");
      expect(second.output).toContain("turn:2");
      expect(separate.sessionId).not.toBe(first.sessionId);
      expect(separate.output).toContain("turn:1");
      expect(forked.sessionId).not.toBe(first.sessionId);
      expect(forked.workflowSessionId).toBe("session-a-fork-01");
      expect(forked.parentWorkflowSessionId).toBe("session-a");
      expect(forked.sessionForked).toBe(true);
      expect(forked.output).toContain("turn:3");
      expect(lifecycle.filter((type) => type === "process_started")).toHaveLength(1);
      expect(lifecycle.filter((type) => type === "session_created")).toHaveLength(2);
      expect(lifecycle.filter((type) => type === "session_forked")).toHaveLength(1);
    } finally {
      await pool.closeAll();
    }
  });
});
