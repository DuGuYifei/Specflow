import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SPECFLOW_WORKSPACE_PATH } from "@specflow/shared";
import type { TerminalOutputEvent } from "@specflow/workflow";
import type {
  AgentPromptStatusEvent,
  AgentSessionUpdateStatusEvent,
  NodeStatusEvent,
  RunInteraction,
  RunStatusEvent,
} from "@specflow/bridge";

export type AgentLifecycleLogPayload = {
  type: string;
  at: string;
  [key: string]: unknown;
};

export type RestoreAttemptLogEvent = {
  type: "restore_attempt";
  runId: string;
  agentSessionId: string;
  agentServerId: string;
  acpSessionId: string;
  requestedMode: "inspect" | "continue";
  selectedPrimitive?: "load" | "resume";
  status: "requested" | "success" | "failure";
  error?: string;
  at: string;
};

export type RunLogEvent =
  | ({ type: "terminal" } & TerminalOutputEvent & { nodeId?: string; specflowSessionId?: string })
  | ({ type: "session_update" } & AgentSessionUpdateStatusEvent & { specflowSessionId?: string })
  | ({ type: "agent_prompt" } & AgentPromptStatusEvent)
  | ({ type: "node_status" } & NodeStatusEvent)
  | ({ type: "run_status" } & RunStatusEvent)
  | {
      type: "agent_lifecycle";
      runId: string;
      nodeRunId?: string;
      nodeId?: string;
      edgeId?: string;
      agentInvocationId: string;
      agentId: string;
      agentServerId: string;
      lifecycle: AgentLifecycleLogPayload;
    }
  | RestoreAttemptLogEvent
  | ({ type: "interaction" } & RunInteraction);

export function runLogsDir(root: string): string {
  return join(root, SPECFLOW_WORKSPACE_PATH, "run-logs");
}

export function runLogPath(root: string, runId: string): string {
  return join(runLogsDir(root), `${runId}.jsonl`);
}

export async function appendRunLogEvent(root: string, event: RunLogEvent): Promise<void> {
  const path = runLogPath(root, event.runId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "a" });
}

export async function listRunLogEvents(root: string, runId: string): Promise<RunLogEvent[]> {
  let raw: string;
  try {
    raw = await readFile(runLogPath(root, runId), "utf8");
  } catch {
    return [];
  }
  const events: RunLogEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as RunLogEvent);
    } catch {
      // Skip malformed lines; the log is append-only and should remain readable.
    }
  }
  return events;
}

export interface RunLogEventPage {
  events: RunLogEvent[];
  total: number;
  /** Index of the first event in `events` within the full log (0-based). */
  startIndex: number;
}

/**
 * Range-query the run log. Supports tail-loading and pagination by index.
 * Lazy-load entry point: client first asks for `tail`, then for ranges with
 * `to` set to whatever index it already has.
 *
 * Reads the whole file in one shot; for the 40MB / 74k-event runs we have so
 * far this is around 100ms, while reading via SSE-per-event would block the
 * UI for many seconds.
 */
export async function listRunLogEventsRange(
  root: string,
  runId: string,
  options: { from?: number; to?: number; tail?: number } = {},
): Promise<RunLogEventPage> {
  const all = await listRunLogEvents(root, runId);
  const total = all.length;
  if (typeof options.tail === "number" && options.tail > 0) {
    const startIndex = Math.max(0, total - options.tail);
    return { events: all.slice(startIndex), total, startIndex };
  }
  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(total, options.to ?? total);
  if (to <= from) return { events: [], total, startIndex: from };
  return { events: all.slice(from, to), total, startIndex: from };
}

export async function deleteRunLog(root: string, runId: string): Promise<void> {
  await rm(runLogPath(root, runId), { force: true });
}
