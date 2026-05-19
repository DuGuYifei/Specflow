import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { listAgentSessions, upsertAgentSessionsFromRun } from "./agent-session-store";
import { listRunLogEvents } from "./run-log-store";
import type { RunRecord } from "./run-store";

describe("agent session restore API", () => {
  test("restores an indexed ACP session, streams updates, and records audit events", async () => {
    const root = await setupProject("load,resume");
    await upsertAgentSessionsFromRun(sampleRun("run1"), root);
    const [session] = await listAgentSessions(root);
    expect(session).toBeDefined();

    const handle = createApiHandler(createSpecflowBridge(), root);
    const response = await handle(new Request(`http://specflow.test/api/agent-sessions/${session!.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "inspect" }),
    }));
    const body = await response?.json() as { restoreId: string; status: string };
    expect(response?.status).toBe(200);
    expect(body.status).toBe("running");

    const eventResponse = await handle(new Request(`http://specflow.test/api/agent-session-restores/${body.restoreId}/events`));
    expect(eventResponse?.status).toBe(200);
    const eventText = await readUntil(eventResponse!, ["session-update", "\"status\":\"success\""]);
    expect(eventText).toContain("loaded:acp-session-1");
    expect(eventText).toContain("\"selectedPrimitive\":\"load\"");

    const [updated] = await listAgentSessions(root);
    expect(updated?.restoreAttempts).toMatchObject([
      {
        id: body.restoreId,
        requestedMode: "inspect",
        selectedPrimitive: "load",
        status: "success",
      },
    ]);

    const logs = await listRunLogEvents(root, "run1");
    expect(logs.filter((event) => event.type === "restore_attempt")).toMatchObject([
      { type: "restore_attempt", status: "requested", requestedMode: "inspect" },
      { type: "restore_attempt", status: "success", selectedPrimitive: "load" },
    ]);
  });
});

async function setupProject(restoreCapabilities: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-restore-"));
  await mkdir(join(root, ".specflow"), { recursive: true });
  const fakeAgentPath = fileURLToPath(new URL("../../agent-proxy/src/runtimes/acp/test-fixtures/fake-agent.ts", import.meta.url));
  await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
    agent_servers: {
      fake: {
        type: "custom",
        command: "bun",
        args: [fakeAgentPath],
        env: { SPECFLOW_FAKE_ACP_RESTORE: restoreCapabilities },
      },
    },
  }), "utf8");
  return root;
}

function sampleRun(id: string): RunRecord {
  const startedAt = "2026-05-19T10:00:00.000Z";
  return {
    id,
    workflowId: "wf",
    label: "Run",
    status: "success",
    startedAt,
    completedAt: "2026-05-19T10:01:00.000Z",
    agent: "fake",
    nodeStates: { n1: "success" },
    nodeOutputs: {},
    agentInvocations: [{
      id: "inv1",
      runId: id,
      nodeRunId: "node-run-1",
      nodeId: "n1",
      agentId: "agent-fake",
      agentServerId: "fake",
      sessionId: "s1",
      acpSessionId: "acp-session-1",
      acpSupportsLoadSession: true,
      acpSupportsResumeSession: true,
      prompt: "prompt",
      status: "done",
      startedAt,
      completedAt: "2026-05-19T10:01:00.000Z",
      output: "done",
    }],
    agentflowSnapshot: {
      id: "wf",
      name: "Workflow",
      sessions: [{ id: "s1", name: "main", color: "blue", agentServerId: "fake" }],
      nodes: [],
      edges: [],
    },
    canvasSnapshot: { workflowId: "wf", version: 1, nodes: [] },
    initialInput: "",
    variableValues: {},
  };
}

async function readUntil(response: Response, patterns: string[]): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < 12 && !patterns.every((pattern) => text.includes(pattern)); i += 1) {
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  await reader.cancel();
  return text;
}
