import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveCanvas } from "./canvas-store";
import { upsertLocalAgentServer } from "./agent-server-config";
import { loadRun } from "./run-store";
import type { CanvasDoc } from "./canvas-doc";

describe("run cancellation API", () => {
  test("cancels an active headless run and persists cancelled status", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-cancel-"));
    await upsertLocalAgentServer(root, "slow-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "setTimeout(() => {}, 30000)"],
    });
    await saveCanvas("wf-cancel", sampleCanvas(), root);

    const handle = createApiHandler(createSpecflowBridge(), root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-cancel/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(start?.status).toBe(200);
    const { runId } = await start!.json() as { runId: string };

    const cancel = await handle(new Request(`http://specflow.test/api/runs/${runId}/cancel`, {
      method: "POST",
    }));
    expect(cancel?.status).toBe(200);

    const record = await eventuallyLoadRun(root, runId, "cancelled");
    expect(record.status).toBe("cancelled");
    expect(record.errorMsg).toContain("cancelled");
  });

  test("links a resumed run once and does not seed it with the source failure state", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-resume-"));
    await upsertLocalAgentServer(root, "slow-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "setTimeout(() => {}, 30000)"],
    });
    await saveCanvas("wf-cancel", sampleCanvas(), root);

    const handle = createApiHandler(createSpecflowBridge(), root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-cancel/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));
    const { runId: sourceRunId } = await start!.json() as { runId: string };
    await handle(new Request(`http://specflow.test/api/runs/${sourceRunId}/cancel`, { method: "POST" }));
    const cancelled = await eventuallyLoadRun(root, sourceRunId, "cancelled");
    expect(cancelled.nodeStates["node-1"]).toBe("error");

    const resume = await handle(new Request(`http://specflow.test/api/runs/${sourceRunId}/resume-workflow`, {
      method: "POST",
    }));
    expect(resume?.status).toBe(200);
    const { runId: continuedRunId } = await resume!.json() as { runId: string };

    const source = await loadRun(sourceRunId, root);
    const continued = await loadRun(continuedRunId, root);
    expect(source.resumedByRunId).toBe(continuedRunId);
    expect(continued.resumedFromRunId).toBe(sourceRunId);
    expect(continued.nodeStates["node-1"]).not.toBe("error");

    const secondResume = await handle(new Request(`http://specflow.test/api/runs/${sourceRunId}/resume-workflow`, {
      method: "POST",
    }));
    expect(secondResume?.status).toBe(409);
    expect(await secondResume!.json()).toMatchObject({ resumedByRunId: continuedRunId });

    await handle(new Request(`http://specflow.test/api/runs/${continuedRunId}/cancel`, { method: "POST" }));
    await eventuallyLoadRun(root, continuedRunId, "cancelled");
    await handle(new Request(`http://specflow.test/api/runs/${continuedRunId}`, { method: "DELETE" }));
    expect((await loadRun(sourceRunId, root)).resumedByRunId).toBeUndefined();
  });
});

async function eventuallyLoadRun(root: string, runId: string, status: string) {
  let last = await loadRun(runId, root);
  for (let i = 0; i < 50; i += 1) {
    if (last.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = await loadRun(runId, root);
  }
  return last;
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf-cancel",
    name: "Cancel test",
    sessions: [
      {
        id: "s1",
        name: "main",
        agentServerId: "slow-headless",
      },
    ],
    nodes: [
      {
        kind: "step",
        id: "node-1",
        num: "1",
        x: 80,
        y: 80,
        w: 240,
        title: "Slow",
        prompt: "slow prompt",
        sessionId: "s1",
      },
    ],
    edges: [],
  };
}
