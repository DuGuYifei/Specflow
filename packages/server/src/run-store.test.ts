import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { stringify } from "yaml";
import { appendRunLogEvent, listRunLogEvents } from "./run-log-store";
import { loadRun, reconcileInterruptedRuns, saveRun, type RunRecord } from "./run-store";
import type { CanvasDoc } from "./canvas-doc";
import { splitCanvasDoc } from "./canvas-store";

describe("run store snapshots", () => {
  it("stores agentflow and canvas snapshots separately", async () => {
    const root = await tempProject();
    const doc = sampleCanvas();
    const { agentflow, layout } = splitCanvasDoc(doc);
    const record: RunRecord = {
      id: "run1",
      workflowId: doc.id,
      label: "Run #1",
      status: "running",
      startedAt: new Date().toISOString(),
      agent: "codex-acp",
      nodeStates: { n1: "pending" },
      nodeOutputs: {},
      agentInvocations: [],
      agentSessions: [],
      agentflowSnapshot: agentflow,
      canvasSnapshot: layout,
      initialInput: "",
      variableValues: {},
    };

    await saveRun(record, root);
    const raw = JSON.parse(await readFile(join(root, ".aflow/.specflow", "runs", "run1.json"), "utf8")) as RunRecord;
    expect(raw.agentflowSnapshot.nodes[0]).not.toHaveProperty("x");
    expect(raw.canvasSnapshot.nodes[0]).toHaveProperty("nodeId");
    expect(raw.agentSessions).toEqual([]);
  });

  it("adapts legacy run records with combined canvasSnapshot", async () => {
    const root = await tempProject();
    const legacy = {
      id: "legacy-run",
      workflowId: "wf",
      label: "Legacy",
      status: "success",
      startedAt: new Date().toISOString(),
      agent: "codex-acp",
      nodeStates: {},
      nodeOutputs: {},
      canvasSnapshot: sampleCanvas(),
      initialInput: "",
      variableValues: {},
    };
    await writeFile(join(root, ".aflow/.specflow", "runs", "legacy-run.yaml"), stringify(legacy), "utf8");

    const loaded = await loadRun("legacy-run", root);
    expect(loaded.agentInvocations).toEqual([]);
    expect(loaded.agentSessions).toEqual([]);
    expect(loaded.agentflowSnapshot.id).toBe("wf");
    expect(loaded.agentflowSnapshot.nodes[0]).not.toHaveProperty("x");
    expect(loaded.canvasSnapshot.workflowId).toBe("wf");
  });

  it("reconciles interrupted runs, running invocations, and missing terminal log events", async () => {
    const root = await tempProject();
    const doc = sampleCanvas();
    const { agentflow, layout } = splitCanvasDoc(doc);
    const record: RunRecord = {
      id: "interrupted-run",
      workflowId: doc.id,
      label: "Interrupted",
      status: "cancelled",
      startedAt: "2026-05-19T10:00:00.000Z",
      completedAt: "2026-05-19T10:01:00.000Z",
      agent: "codex-acp",
      nodeStates: { n1: "running", done: "pending" },
      nodeOutputs: {},
      agentInvocations: [
        {
          id: "inv1",
          runId: "interrupted-run",
          nodeRunId: "node-run-1",
          nodeId: "n1",
          agentId: "agent-server-codex-acp",
          agentServerId: "codex-acp",
          sessionId: "s1",
          acpSessionId: "acp-session-1",
          prompt: "",
          status: "running",
          startedAt: "2026-05-19T10:00:01.000Z",
        },
      ],
      agentSessions: [],
      agentflowSnapshot: agentflow,
      canvasSnapshot: layout,
      initialInput: "",
      variableValues: {},
    };
    await saveRun(record, root);
    await appendRunLogEvent(root, {
      type: "run_status",
      runId: record.id,
      workflowId: record.workflowId,
      status: "running",
      at: record.startedAt,
    });
    await appendRunLogEvent(root, {
      type: "node_status",
      runId: record.id,
      nodeId: "n1",
      status: "running",
      at: record.startedAt,
    });

    const reconciled = await reconcileInterruptedRuns(root, "server restarted");
    const loaded = await loadRun(record.id, root);
    const events = await listRunLogEvents(root, record.id);

    expect(reconciled).toContain(record.id);
    expect(loaded.nodeStates.n1).toBe("cancelled");
    expect(loaded.agentInvocations[0]).toMatchObject({
      status: "cancelled",
      error: "server restarted",
      completedAt: "2026-05-19T10:01:00.000Z",
    });
    expect(events.filter((event) => event.type === "node_status").at(-1)).toMatchObject({
      nodeId: "n1",
      status: "cancelled",
    });
    expect(events.filter((event) => event.type === "run_status").at(-1)).toMatchObject({
      status: "cancelled",
    });
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-runs-"));
  await mkdir(join(root, ".aflow/.specflow", "runs"), { recursive: true });
  return root;
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf",
    name: "Workflow",
    sessions: [{ id: "s1", name: "main", agentServerId: "codex-acp" }],
    nodes: [
      { kind: "step", id: "n1", alias: "01", x: 10, y: 20, w: 220, title: "Step", prompt: "Do it", sessionId: "s1" },
      { kind: "end", id: "done", alias: "END", x: 300, y: 20, w: 140, title: "Done", sessionId: null },
    ],
    edges: [{ id: "e1", from: "n1", to: "done" }],
  };
}
