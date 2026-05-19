import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentInvocation } from "@specflow/workflow";
import type { RunRecord } from "./run-store";

export interface AgentSessionIndex {
  version: 1;
  sessions: AgentSessionRecord[];
}

export interface AgentSessionRecord {
  id: string;
  workflowId: string;
  specflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  acpSessionId: string;
  acpSupportsLoadSession: boolean;
  acpSupportsResumeSession: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: AgentInvocation["status"];
  runIds: string[];
  invocationIds: string[];
  invocations: AgentSessionInvocationRef[];
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

export function agentSessionsPath(root: string): string {
  return join(root, ".specflow", "agent-sessions.json");
}

export async function loadAgentSessionIndex(root: string): Promise<AgentSessionIndex> {
  try {
    const raw = await readFile(agentSessionsPath(root), "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentSessionIndex>;
    return normalizeAgentSessionIndex(parsed);
  } catch {
    return emptyIndex();
  }
}

export async function listAgentSessions(
  root: string,
  filter: { workflowId?: string; agentServerId?: string } = {},
): Promise<AgentSessionRecord[]> {
  const index = await loadAgentSessionIndex(root);
  return index.sessions
    .filter((session) => !filter.workflowId || session.workflowId === filter.workflowId)
    .filter((session) => !filter.agentServerId || session.agentServerId === filter.agentServerId)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function loadAgentSession(root: string, id: string): Promise<AgentSessionRecord> {
  const index = await loadAgentSessionIndex(root);
  const session = index.sessions.find((candidate) => candidate.id === id);
  if (!session) {
    throw new Error(`Agent session "${id}" not found.`);
  }
  return session;
}

export async function upsertAgentSessionsFromRun(record: RunRecord, root: string): Promise<void> {
  const index = await loadAgentSessionIndex(root);
  const byId = new Map(index.sessions.map((session) => [session.id, session]));

  for (const invocation of record.agentInvocations) {
    if (!invocation.agentServerId || !invocation.acpSessionId) {
      continue;
    }

    const id = createAgentSessionRecordId({
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
        agentId: invocation.agentId,
        agentServerId: invocation.agentServerId,
        acpSessionId: invocation.acpSessionId,
        acpSupportsLoadSession: Boolean(invocation.acpSupportsLoadSession),
        acpSupportsResumeSession: Boolean(invocation.acpSupportsResumeSession),
        firstSeenAt: invocation.startedAt,
        lastSeenAt: seenAt,
        latestRunId: record.id,
        latestInvocationId: invocation.id,
        latestStatus: invocation.status,
        runIds: [record.id],
        invocationIds: [invocation.id],
        invocations: [ref],
      });
      continue;
    }

    existing.agentId = invocation.agentId;
    existing.acpSupportsLoadSession ||= Boolean(invocation.acpSupportsLoadSession);
    existing.acpSupportsResumeSession ||= Boolean(invocation.acpSupportsResumeSession);
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

  await saveAgentSessionIndex({ version: 1, sessions: sortedSessions([...byId.values()]) }, root);
}

export async function removeRunFromAgentSessions(runId: string, root: string): Promise<void> {
  const index = await loadAgentSessionIndex(root);
  const sessions = index.sessions
    .map((session) => {
      const invocations = session.invocations.filter((ref) => ref.runId !== runId);
      if (invocations.length === 0) {
        return undefined;
      }

      const runIds = unique(invocations.map((ref) => ref.runId));
      const invocationIds = unique(invocations.map((ref) => ref.invocationId));
      const latest = [...invocations].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!;
      return {
        ...session,
        firstSeenAt: invocations.reduce((min, ref) => minIso(min, ref.startedAt), invocations[0]!.startedAt),
        lastSeenAt: invocations.reduce((max, ref) => (ref.completedAt ?? ref.startedAt) > max ? (ref.completedAt ?? ref.startedAt) : max, invocations[0]!.completedAt ?? invocations[0]!.startedAt),
        latestRunId: latest.runId,
        latestInvocationId: latest.invocationId,
        latestStatus: latest.status,
        runIds,
        invocationIds,
        invocations,
      } satisfies AgentSessionRecord;
    })
    .filter((session): session is AgentSessionRecord => Boolean(session));

  await saveAgentSessionIndex({ version: 1, sessions: sortedSessions(sessions) }, root);
}

export async function saveAgentSessionIndex(index: AgentSessionIndex, root: string): Promise<void> {
  const path = agentSessionsPath(root);
  await mkdir(dirname(path), { recursive: true });
  const normalized = normalizeAgentSessionIndex(index);
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export function createAgentSessionRecordId(input: {
  workflowId: string;
  specflowSessionId?: string;
  agentServerId: string;
  acpSessionId: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.workflowId,
      input.specflowSessionId ?? null,
      input.agentServerId,
      input.acpSessionId,
    ]))
    .digest("hex")
    .slice(0, 24);
}

function normalizeAgentSessionIndex(input: Partial<AgentSessionIndex>): AgentSessionIndex {
  return {
    version: 1,
    sessions: sortedSessions((input.sessions ?? []).map(normalizeAgentSessionRecord)),
  };
}

function normalizeAgentSessionRecord(input: AgentSessionRecord): AgentSessionRecord {
  const invocations = input.invocations ?? [];
  return {
    ...input,
    acpSupportsLoadSession: Boolean(input.acpSupportsLoadSession),
    acpSupportsResumeSession: Boolean(input.acpSupportsResumeSession),
    runIds: unique(input.runIds ?? invocations.map((ref) => ref.runId)),
    invocationIds: unique(input.invocationIds ?? invocations.map((ref) => ref.invocationId)),
    invocations,
  };
}

function emptyIndex(): AgentSessionIndex {
  return { version: 1, sessions: [] };
}

function sortedSessions(sessions: AgentSessionRecord[]): AgentSessionRecord[] {
  return sessions.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}
