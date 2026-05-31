import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import type { NodeStatus } from "@specflow/shared";
import type { WorkflowRunStatus } from "@specflow/workflow";
import { appendRunLogEvent, listRunLogEvents } from "./run-log-store";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc } from "./canvas-doc";
import { splitCanvasDoc } from "./canvas-store";
import type { AgentInvocation } from "@specflow/workflow";
import type { AgentSessionRecord } from "./agent-session-store";

export type RunState = "running" | "paused" | "success" | "error" | "pending" | "cancelled";

export interface RunRecord {
  id: string;
  workflowId: string;
  label: string;
  ticket?: string;
  status: "running" | "success" | "error" | "cancelled";
  activeNode?: string;
  pausedNodeId?: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  agent: string;
  errorMsg?: string;
  nodeStates: Record<string, RunState>;
  nodeOutputs: Record<string, string>;
  agentInvocations: AgentInvocation[];
  agentSessions: AgentSessionRecord[];
  agentflowSnapshot: AgentFlowDoc;
  canvasSnapshot: CanvasLayoutDoc;
  initialInput: string;
  variableValues: Record<string, string>;
  /** Set when this run was created by resuming another run; identifies the source. */
  resumedFromRunId?: string;
  /** Set on a source run once a continuation run has been created from it. */
  resumedByRunId?: string;
}

function runsDir(root: string) {
  return join(root, SPECFLOW_WORKSPACE_PATH, "runs");
}

function runPath(id: string, root: string) {
  return join(runsDir(root), `${id}.json`);
}

function legacyRunPath(id: string, root: string) {
  return join(runsDir(root), `${id}.yaml`);
}

export async function listRuns(workflowId: string | undefined, root: string): Promise<RunRecord[]> {
  const dir = runsDir(root);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const runFiles = files
    .filter((f) => f.endsWith(".json") || f.endsWith(".yaml"))
    .sort((a, b) => Number(a.endsWith(".yaml")) - Number(b.endsWith(".yaml")));
  const byId = new Map<string, RunRecord>();
  for (const file of runFiles) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const rec = parseRunRecord(raw, file);
      normalizeRunRecord(rec);
      if (!workflowId || rec.workflowId === workflowId) {
        byId.set(rec.id, rec);
      }
    } catch {
      // skip malformed
    }
  }
  const results = [...byId.values()];
  results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return results;
}

export async function loadRun(id: string, root: string): Promise<RunRecord> {
  let raw: string;
  let path = runPath(id, root);
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    path = legacyRunPath(id, root);
    raw = await readFile(path, "utf8");
  }
  const rec = parseRunRecord(raw, path);
  normalizeRunRecord(rec);
  return rec;
}

export async function saveRun(record: RunRecord, root: string): Promise<void> {
  const path = runPath(record.id, root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * Mark any run records left in "running" state as cancelled. Called on server
 * startup so a previous crash or kill -9 doesn't leave runs stuck pretending
 * to be live. The ACP session itself may still be recoverable via the agent
 * session restore flow.
 */
export async function reconcileInterruptedRuns(root: string, reason: string): Promise<string[]> {
  const runs = await listRuns(undefined, root);
  const interrupted: string[] = [];
  const completedAt = new Date().toISOString();
  for (const rec of runs) {
    let changed = false;
    const wasRunning = rec.status === "running";
    const effectiveCompletedAt = rec.completedAt ?? completedAt;
    if (wasRunning) {
      rec.status = "cancelled";
      rec.errorMsg = reason;
      rec.completedAt = completedAt;
      rec.duration = formatDuration(rec.startedAt, completedAt);
      changed = true;
    }
    for (const [nodeId, state] of Object.entries(rec.nodeStates)) {
      if (rec.status === "cancelled" && (state === "running" || state === "paused")) {
        rec.nodeStates[nodeId] = "cancelled";
        changed = true;
      } else if (rec.status === "error" && state === "running") {
        rec.nodeStates[nodeId] = "error";
        changed = true;
      }
    }
    for (const invocation of rec.agentInvocations) {
      if (invocation.status !== "running") continue;
      if (rec.status === "cancelled") {
        invocation.status = "cancelled";
        invocation.error ??= rec.errorMsg ?? reason;
        invocation.completedAt ??= effectiveCompletedAt;
        changed = true;
      } else if (rec.status === "error") {
        invocation.status = "failed";
        invocation.error ??= rec.errorMsg;
        invocation.completedAt ??= effectiveCompletedAt;
        changed = true;
      }
    }
    await appendMissingTerminalLogEvents(rec, root, effectiveCompletedAt);
    if (changed) {
      await saveRun(rec, root);
      interrupted.push(rec.id);
    }
  }
  return interrupted;
}

async function appendMissingTerminalLogEvents(record: RunRecord, root: string, at: string): Promise<void> {
  if (record.status === "running") return;
  const events = await listRunLogEvents(root, record.id);
  const latestNodeStatus = new Map<string, string>();
  let latestRunStatus: string | undefined;
  for (const event of events) {
    if (event.type === "node_status") latestNodeStatus.set(event.nodeId, event.status);
    if (event.type === "run_status") latestRunStatus = event.status;
  }
  for (const [nodeId, state] of Object.entries(record.nodeStates)) {
    const status = nodeStatusFromRunState(state);
    if (!status || latestNodeStatus.get(nodeId) === status) continue;
    await appendRunLogEvent(root, {
      type: "node_status",
      runId: record.id,
      nodeId,
      status,
      at,
    });
  }
  const runStatus = workflowStatusFromRecordStatus(record.status);
  if (runStatus && latestRunStatus !== runStatus) {
    await appendRunLogEvent(root, {
      type: "run_status",
      runId: record.id,
      workflowId: record.workflowId,
      status: runStatus,
      error: record.errorMsg,
      at,
    });
  }
}

function nodeStatusFromRunState(state: RunState): NodeStatus | undefined {
  switch (state) {
    case "success": return "done";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    case "paused": return "paused";
    case "running": return "running";
    default: return undefined;
  }
}

function workflowStatusFromRecordStatus(status: RunRecord["status"]): WorkflowRunStatus | undefined {
  switch (status) {
    case "success": return "done";
    case "error": return "failed";
    case "cancelled": return "cancelled";
    default: return undefined;
  }
}

export async function deleteRun(id: string, root: string): Promise<void> {
  try {
    await unlink(runPath(id, root));
  } catch {
    // already gone — ok
  }
  try {
    await unlink(legacyRunPath(id, root));
  } catch {
    // already gone — ok
  }
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function normalizeRunRecord(rec: RunRecord): void {
  if (!rec.nodeOutputs) rec.nodeOutputs = {};
  if (!rec.agentInvocations) rec.agentInvocations = [];
  if (!rec.agentSessions) rec.agentSessions = [];
  if (!rec.initialInput) rec.initialInput = "";
  if (!rec.variableValues) rec.variableValues = {};

  const maybeLegacy = rec as RunRecord & {
    agentflowSnapshot?: AgentFlowDoc;
    canvasSnapshot?: CanvasLayoutDoc | CanvasDoc;
  };
  if (!maybeLegacy.agentflowSnapshot && maybeLegacy.canvasSnapshot && "id" in maybeLegacy.canvasSnapshot) {
    const legacySnapshot = maybeLegacy.canvasSnapshot as CanvasDoc;
    const { agentflow, layout } = splitCanvasDoc(legacySnapshot);
    maybeLegacy.agentflowSnapshot = agentflow;
    maybeLegacy.canvasSnapshot = layout;
  }
}

function parseRunRecord(raw: string, path: string): RunRecord {
  return path.endsWith(".json")
    ? JSON.parse(raw) as RunRecord
    : parse(raw) as RunRecord;
}
