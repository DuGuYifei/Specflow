import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentInvocation } from "@specflow/workflow";
import { listRuns, saveRun, type RunRecord } from "./run-store";

export interface AgentSessionIndex {
  version: 1;
  sessions: AgentSessionRecord[];
}

export interface AgentSessionRecord {
  id: string;
  workflowId: string;
  specflowSessionId?: string;
  parentSpecflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  acpSessionId: string;
  acpSupportsLoadSession: boolean;
  acpSupportsResumeSession: boolean;
  acpSupportsForkSession: boolean;
  acpSessionForked: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: AgentInvocation["status"];
  runIds: string[];
  invocationIds: string[];
  invocations: AgentSessionInvocationRef[];
  restoreAttempts: AgentSessionRestoreAttempt[];
}

export interface AgentSessionInvocationRef {
  runId: string;
  invocationId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  status: AgentInvocation["status"];
  startedAt: string;
  completedAt?: string;
}

export interface AgentSessionRestoreAttempt {
  id: string;
  requestedMode: "inspect" | "continue";
  selectedPrimitive?: "load" | "resume";
  status: "requested" | "success" | "failure";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export function agentSessionsPath(root: string): string {
  return join(root, ".specflow", "agent-sessions.json");
}

export async function loadAgentSessionIndex(root: string): Promise<AgentSessionIndex> {
  return { version: 1, sessions: await listAgentSessions(root) };
}

export async function listAgentSessions(
  root: string,
  filter: { workflowId?: string; agentServerId?: string } = {},
): Promise<AgentSessionRecord[]> {
  const runs = await listRuns(filter.workflowId, root);
  return runs
    .flatMap((run) => agentSessionsForRun(run))
    .filter((session) => !filter.workflowId || session.workflowId === filter.workflowId)
    .filter((session) => !filter.agentServerId || session.agentServerId === filter.agentServerId)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function loadAgentSession(root: string, id: string): Promise<AgentSessionRecord> {
  const session = (await listAgentSessions(root)).find((candidate) => candidate.id === id);
  if (!session) {
    throw new Error(`Agent session "${id}" not found.`);
  }
  return session;
}

export async function upsertAgentSessionsFromRun(record: RunRecord, root: string): Promise<void> {
  record.agentSessions = buildAgentSessionsForRun(record);
  await saveRun(record, root);
}

export function buildAgentSessionsForRun(record: RunRecord): AgentSessionRecord[] {
  const byId = new Map<string, AgentSessionRecord>();
  for (const invocation of record.agentInvocations) {
    if (!invocation.agentServerId || !invocation.acpSessionId) {
      continue;
    }

    const id = createAgentSessionRecordId({
      runId: record.id,
      workflowId: record.workflowId,
      specflowSessionId: invocation.sessionId,
      agentServerId: invocation.agentServerId,
      acpSessionId: invocation.acpSessionId,
    });
    const seenAt = invocation.completedAt ?? record.completedAt ?? invocation.startedAt;
    const ref: AgentSessionInvocationRef = {
      runId: record.id,
      invocationId: invocation.id,
      nodeRunId: invocation.nodeRunId,
      nodeId: invocation.nodeId,
      edgeId: invocation.edgeId,
      status: invocation.status,
      startedAt: invocation.startedAt,
      completedAt: invocation.completedAt,
    };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        workflowId: record.workflowId,
        specflowSessionId: invocation.sessionId,
        parentSpecflowSessionId: invocation.parentSessionId,
        agentId: invocation.agentId,
        agentServerId: invocation.agentServerId,
        acpSessionId: invocation.acpSessionId,
        acpSupportsLoadSession: Boolean(invocation.acpSupportsLoadSession),
        acpSupportsResumeSession: Boolean(invocation.acpSupportsResumeSession),
        acpSupportsForkSession: Boolean(invocation.acpSupportsForkSession),
        acpSessionForked: Boolean(invocation.acpSessionForked),
        firstSeenAt: invocation.startedAt,
        lastSeenAt: seenAt,
        latestRunId: record.id,
        latestInvocationId: invocation.id,
        latestStatus: invocation.status,
        runIds: [record.id],
        invocationIds: [invocation.id],
        invocations: [ref],
        restoreAttempts: [],
      });
      continue;
    }

    existing.agentId = invocation.agentId;
    existing.acpSupportsLoadSession ||= Boolean(invocation.acpSupportsLoadSession);
    existing.acpSupportsResumeSession ||= Boolean(invocation.acpSupportsResumeSession);
    existing.acpSupportsForkSession ||= Boolean(invocation.acpSupportsForkSession);
    existing.acpSessionForked ||= Boolean(invocation.acpSessionForked);
    existing.parentSpecflowSessionId ??= invocation.parentSessionId;
    existing.firstSeenAt = minIso(existing.firstSeenAt, invocation.startedAt);
    if (seenAt >= existing.lastSeenAt) {
      existing.lastSeenAt = seenAt;
      existing.latestRunId = record.id;
      existing.latestInvocationId = invocation.id;
      existing.latestStatus = invocation.status;
    }
    addUnique(existing.runIds, record.id);
    addUnique(existing.invocationIds, invocation.id);
    upsertInvocationRef(existing.invocations, ref);
  }

  return sortedSessions([...byId.values()]);
}

export async function recordAgentSessionRestoreAttempt(
  root: string,
  sessionId: string,
  attempt: AgentSessionRestoreAttempt,
): Promise<AgentSessionRestoreAttempt> {
  const runs = await listRuns(undefined, root);
  const run = runs.find((candidate) =>
    agentSessionsForRun(candidate).some((session) => session.id === sessionId),
  );
  if (run && run.agentSessions.length === 0) {
    run.agentSessions = buildAgentSessionsForRun(run);
  }
  const session = run?.agentSessions.find((candidate) => candidate.id === sessionId);
  if (!run || !session) throw new Error(`Agent session "${sessionId}" not found.`);

  const existingIndex = session.restoreAttempts.findIndex((candidate) => candidate.id === attempt.id);
  if (existingIndex >= 0) {
    session.restoreAttempts[existingIndex] = attempt;
  } else {
    session.restoreAttempts.push(attempt);
  }
  session.restoreAttempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  await saveRun(run, root);
  return attempt;
}

export function createAgentSessionRecordId(input: {
  runId: string;
  workflowId: string;
  specflowSessionId?: string;
  agentServerId: string;
  acpSessionId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.runId,
      input.workflowId,
      input.specflowSessionId ?? null,
      input.agentServerId,
      input.acpSessionId,
    ]))
    .digest("hex")
    .slice(0, 24);
}

function sortedSessions(sessions: AgentSessionRecord[]): AgentSessionRecord[] {
  return sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function agentSessionsForRun(run: RunRecord): AgentSessionRecord[] {
  return run.agentSessions.length > 0 ? run.agentSessions : buildAgentSessionsForRun(run);
}

function upsertInvocationRef(refs: AgentSessionInvocationRef[], ref: AgentSessionInvocationRef): void {
  const index = refs.findIndex((candidate) => candidate.invocationId === ref.invocationId);
  if (index >= 0) {
    refs[index] = ref;
  } else {
    refs.push(ref);
  }
  refs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}
