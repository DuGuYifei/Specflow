import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { splitCanvasDoc } from "./canvas-store";
import type { CanvasDoc } from "./canvas-doc";
import type { RunRecord } from "./run-store";
import { deleteRun, loadRun } from "./run-store";
import {
  listAgentSessions,
  recordAgentSessionRestoreAttempt,
  upsertAgentSessionsFromRun,
} from "./agent-session-store";

describe("agent session store", () => {
  it("indexes ACP sessions from run invocations", async () => {
    const root = await tempProject();
    await upsertAgentSessionsFromRun(sampleRun("run1"), root);

    const savedRun = await loadRun("run1", root);
    expect(savedRun.agentSessions).toHaveLength(1);
    expect(savedRun.agentSessions[0]).toMatchObject({
      workflowId: "wf",
      specflowSessionId: "s1",
      agentId: "agent-server-codex-acp",
      agentServerId: "codex-acp",
      acpSessionId: "acp-session-1",
      acpSupportsLoadSession: true,
      acpSupportsResumeSession: false,
      latestRunId: "run1",
      latestInvocationId: "inv2",
      runIds: ["run1"],
      invocationIds: ["inv1", "inv2"],
    });
    expect(savedRun.agentSessions[0]?.invocations.map((ref) => ref.nodeId)).toEqual(["n1", "n2"]);
    expect(savedRun.agentSessions[0]?.restoreAttempts).toEqual([]);
  });

  it("keeps each run's ACP sessions as separate records", async () => {
    const root = await tempProject();
    await upsertAgentSessionsFromRun(sampleRun("run1"), root);
    await upsertAgentSessionsFromRun(sampleRun("run2", {
      invocationIds: ["inv3"],
      completedAt: "2026-05-19T10:03:00.000Z",
      supportsResume: true,
    }), root);

    const sessions = await listAgentSessions(root, { workflowId: "wf" });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.latestRunId)).toEqual(["run2", "run1"]);
    expect(sessions.find((session) => session.latestRunId === "run1")?.runIds).toEqual(["run1"]);
    expect(sessions.find((session) => session.latestRunId === "run2")?.runIds).toEqual(["run2"]);
    expect(sessions.find((session) => session.latestRunId === "run2")?.acpSupportsResumeSession).toBe(true);
  });

  it("drops agent sessions when their run record is deleted", async () => {
    const root = await tempProject();
    await upsertAgentSessionsFromRun(sampleRun("run1"), root);
    await upsertAgentSessionsFromRun(sampleRun("run2", { invocationIds: ["inv3"] }), root);

    await deleteRun("run1", root);

    let sessions = await listAgentSessions(root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.runIds).toEqual(["run2"]);
    expect(sessions[0]?.invocationIds).toEqual(["inv3"]);

    await deleteRun("run2", root);
    sessions = await listAgentSessions(root);
    expect(sessions).toEqual([]);
  });

  it("records restore attempts on the run-bound agent session", async () => {
    const root = await tempProject();
    await upsertAgentSessionsFromRun(sampleRun("run1"), root);
    const [session] = await listAgentSessions(root);
    expect(session).toBeDefined();

    await recordAgentSessionRestoreAttempt(root, session!.id, {
      id: "restore-1",
      requestedMode: "inspect",
      selectedPrimitive: "load",
      status: "success",
      startedAt: "2026-05-19T10:03:00.000Z",
      completedAt: "2026-05-19T10:03:01.000Z",
    });

    await recordAgentSessionRestoreAttempt(root, session!.id, {
      id: "restore-1",
      requestedMode: "inspect",
      selectedPrimitive: "load",
      status: "failure",
      startedAt: "2026-05-19T10:03:00.000Z",
      completedAt: "2026-05-19T10:03:02.000Z",
      error: "failed",
    });

    const [updated] = await listAgentSessions(root);
    expect(updated?.restoreAttempts).toEqual([
      {
        id: "restore-1",
        requestedMode: "inspect",
        selectedPrimitive: "load",
        status: "failure",
        startedAt: "2026-05-19T10:03:00.000Z",
        completedAt: "2026-05-19T10:03:02.000Z",
        error: "failed",
      },
    ]);
  });
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-agent-sessions-"));
  await mkdir(join(root, ".specflow"), { recursive: true });
  return root;
}

function sampleRun(
  id: string,
  options: {
    invocationIds?: string[];
    completedAt?: string;
    supportsResume?: boolean;
  } = {},
): RunRecord {
  const doc = sampleCanvas();
  const { agentflow, layout } = splitCanvasDoc(doc);
  const invocationIds = options.invocationIds ?? ["inv1", "inv2"];
  const startedAt = "2026-05-19T10:00:00.000Z";
  const completedAt = options.completedAt ?? "2026-05-19T10:02:00.000Z";

  return {
    id,
    workflowId: doc.id,
    label: "Run",
    status: "success",
    startedAt,
    completedAt,
    agent: "codex-acp",
    nodeStates: { n1: "success", n2: "success" },
    nodeOutputs: {},
    agentInvocations: invocationIds.map((invocationId, index) => ({
      id: invocationId,
      runId: id,
      nodeRunId: `node-run-${index + 1}`,
      nodeId: index === 0 ? "n1" : "n2",
      agentId: "agent-server-codex-acp",
      agentServerId: "codex-acp",
      sessionId: "s1",
      acpSessionId: "acp-session-1",
      acpSupportsLoadSession: true,
      acpSupportsResumeSession: Boolean(options.supportsResume),
      prompt: `prompt ${index + 1}`,
      status: "done",
      startedAt: new Date(Date.parse(startedAt) + index * 30_000).toISOString(),
      completedAt,
      output: "done",
    })),
    agentSessions: [],
    agentflowSnapshot: agentflow,
    canvasSnapshot: layout,
    initialInput: "",
    variableValues: {},
  };
}

function sampleCanvas(): CanvasDoc {
  return {
    id: "wf",
    name: "Workflow",
    sessions: [{ id: "s1", name: "main", agentServerId: "codex-acp" }],
    nodes: [
      { kind: "step", id: "n1", num: "01", x: 10, y: 20, w: 220, title: "Step 1", prompt: "Do it", sessionId: "s1" },
      { kind: "step", id: "n2", num: "02", x: 260, y: 20, w: 220, title: "Step 2", prompt: "Do more", sessionId: "s1" },
      { kind: "end", id: "done", num: "END", x: 520, y: 20, w: 140, title: "Done", sessionId: null },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "done" },
    ],
  };
}
