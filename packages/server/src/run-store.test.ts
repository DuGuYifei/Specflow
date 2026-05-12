import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { parse, stringify } from "yaml";
import { loadRun, saveRun, type RunRecord } from "./run-store";
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
      agent: "mock",
      nodeStates: { n1: "pending" },
      nodeOutputs: {},
      agentflowSnapshot: agentflow,
      canvasSnapshot: layout,
      initialInput: "",
      variableValues: {},
    };

    await saveRun(record, root);
    const raw = parse(await readFile(join(root, ".specflow", "runs", "run1.yaml"), "utf8")) as RunRecord;
    expect(raw.agentflowSnapshot.nodes[0]).not.toHaveProperty("x");
    expect(raw.canvasSnapshot.nodes[0]).toHaveProperty("nodeId");
  });

  it("adapts legacy run records with combined canvasSnapshot", async () => {
    const root = await tempProject();
    const legacy = {
      id: "legacy-run",
      workflowId: "wf",
      label: "Legacy",
      status: "success",
      startedAt: new Date().toISOString(),
      agent: "mock",
      nodeStates: {},
      nodeOutputs: {},
      canvasSnapshot: sampleCanvas(),
      initialInput: "",
      variableValues: {},
    };
    await writeFile(join(root, ".specflow", "runs", "legacy-run.yaml"), stringify(legacy), "utf8");

    const loaded = await loadRun("legacy-run", root);
    expect(loaded.agentflowSnapshot.id).toBe("wf");
    expect(loaded.agentflowSnapshot.nodes[0]).not.toHaveProperty("x");
    expect(loaded.canvasSnapshot.workflowId).toBe("wf");
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-runs-"));
  await mkdir(join(root, ".specflow", "runs"), { recursive: true });
  return root;
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf",
    name: "Workflow",
    sessions: [{ id: "s1", name: "main", color: "blue", agent: "mock" }],
    nodes: [
      { kind: "step", id: "n1", num: "01", x: 10, y: 20, w: 220, title: "Step", desc: "Do it", sessionId: "s1", updateDoc: false },
      { kind: "end", id: "done", num: "END", x: 300, y: 20, w: 140, title: "Done", sessionId: null },
    ],
    edges: [{ id: "e1", from: "n1", to: "done" }],
  };
}
