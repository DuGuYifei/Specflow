import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveCanvas } from "./canvas-store";
import { upsertLocalAgentServer } from "./agent-server-config";
import { listRunLogEvents } from "./run-log-store";
import { loadRun } from "./run-store";
import type { CanvasDoc } from "./canvas-doc";

describe("run event API", () => {
  test("replays terminal logs for the same persisted run id", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-run-events-"));
    await upsertLocalAgentServer(root, "echo-headless", {
      type: "headless",
      command: process.execPath,
      argsTemplate: ["-e", "console.log('run-id-check')"],
    });
    await saveCanvas("wf-events", sampleCanvas(), root);

    const handle = createApiHandler(createSpecflowBridge(), root);
    const start = await handle(new Request("http://specflow.test/api/canvases/wf-events/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(start?.status).toBe(200);
    const { runId } = await start!.json() as { runId: string };

    const record = await eventuallyLoadRun(root, runId, "success");
    expect(record.agentInvocations[0]).toMatchObject({
      runId,
      agentServerId: "echo-headless",
      status: "done",
    });
    expect(record.agentflowSnapshot.nodes[0]).not.toHaveProperty("x");
    expect(record.canvasSnapshot.nodes[0]).toMatchObject({
      nodeId: "node-1",
      x: 80,
      y: 80,
      w: 240,
    });
    const terminalLog = await eventuallyFindTerminalLog(root, runId, "run-id-check");
    expect(terminalLog?.runId).toBe(runId);

    const eventResponse = await handle(new Request(`http://specflow.test/api/runs/${runId}/events`));
    expect(eventResponse?.status).toBe(200);
    const eventText = await readUntil(eventResponse!, "run-id-check");
    expect(eventText).toContain("run-id-check");
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

async function eventuallyFindTerminalLog(root: string, runId: string, chunk: string) {
  for (let i = 0; i < 50; i += 1) {
    const log = (await listRunLogEvents(root, runId)).find((event) =>
      event.type === "terminal" && event.chunk.includes(chunk),
    );
    if (log) return log;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return undefined;
}

async function readUntil(response: Response, pattern: string): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < 8 && !text.includes(pattern); i += 1) {
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  await reader.cancel();
  return text;
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf-events",
    name: "Events test",
    sessions: [
      {
        id: "s1",
        name: "main",
        agentServerId: "echo-headless",
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
        title: "Echo",
        prompt: "echo prompt",
        sessionId: "s1",
      },
    ],
    edges: [],
  };
}
