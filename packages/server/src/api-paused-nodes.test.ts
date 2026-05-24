import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveRun, type RunRecord } from "./run-store";

describe("paused node interaction API", () => {
  test("accepts prompt and continue only for an active server-authorized pause", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-paused-api-"));
    const bridge = createSpecflowBridge();
    const handle = createApiHandler(bridge, root);
    await saveRun(sampleRun(), root);
    const continuation = bridge.pauses.waitForContinuation({
      runId: "run1",
      nodeId: "node-1",
      specflowSessionId: "s1",
      agentServerId: "codex-acp",
      pausedAt: "2026-05-24T10:00:00.000Z",
    }, async (prompt) => `answer:${prompt}`);

    const list = await handle(new Request("http://specflow.test/api/runs/run1/paused-nodes"));
    expect(await list?.json()).toEqual([expect.objectContaining({ nodeId: "node-1", specflowSessionId: "s1" })]);

    const forged = await handle(new Request("http://specflow.test/api/runs/run1/paused-nodes/node-2/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "attack" }),
    }));
    expect(forged?.status).toBe(409);

    const prompted = await handle(new Request("http://specflow.test/api/runs/run1/paused-nodes/node-1/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "review" }),
    }));
    expect(prompted?.status).toBe(200);
    expect(await prompted?.json()).toEqual({ output: "answer:review" });

    const resumed = await handle(new Request("http://specflow.test/api/runs/run1/paused-nodes/node-1/continue", {
      method: "POST",
    }));
    expect(resumed?.status).toBe(200);
    await expect(continuation).resolves.toBe("answer:review");

    const replay = await handle(new Request("http://specflow.test/api/runs/run1/paused-nodes/node-1/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "late" }),
    }));
    expect(replay?.status).toBe(409);
  });
});

function sampleRun(): RunRecord {
  return {
    id: "run1",
    workflowId: "wf",
    label: "Run",
    status: "running",
    startedAt: "2026-05-24T10:00:00.000Z",
    agent: "codex-acp",
    nodeStates: { "node-1": "paused" },
    nodeOutputs: {},
    agentInvocations: [],
    agentSessions: [],
    agentflowSnapshot: { id: "wf", name: "Workflow", sessions: [], nodes: [], edges: [] },
    canvasSnapshot: { workflowId: "wf", version: 1, nodes: [] },
    initialInput: "",
    variableValues: {},
  };
}
