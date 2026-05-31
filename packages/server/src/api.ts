import { AgentServerStore, probeAcpAgentCapabilities } from "@specflow/agent-proxy";
import { WorkflowExecutor } from "@specflow/bridge";
import type { SpecflowBridge, WorkflowResumeState } from "@specflow/bridge";
import type { AgentAuthenticationStatus, AgentConversation, AgentRestoreMode, AgentRestorePrimitive, AgentServerEntry, AgentServerSettings, NodeStatusEvent, RunInteraction, RunInteractionContext, RunStatusEvent } from "@specflow/bridge";
import { SPECFLOW_WORKSPACE_PATH, uuidv7 } from "@specflow/shared";
import { SkillStore } from "./skills";
import { AuthTerminalSessionStore } from "./auth-terminal-sessions";
import { canvasToWorkflow } from "./canvas-to-workflow";
import {
  listCanvases,
  loadCanvas,
  loadAgentFlow,
  loadOrCreateCanvasLayout,
  saveCanvas,
  deleteCanvas,
} from "./canvas-store";
import { formatDuration, listRuns, loadRun, reconcileInterruptedRuns, saveRun, deleteRun, type RunRecord, type RunState } from "./run-store";
import {
  listAgentSessions,
  loadAgentSession,
  recordAgentSessionRestoreAttempt,
  upsertAgentSessionsFromRun,
} from "./agent-session-store";
import { appendRunLogEvent, deleteRunLog, listRunLogEvents, listRunLogEventsRange } from "./run-log-store";
import { prepareCanvasRun } from "./run-inputs";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc } from "./canvas-doc";
import type { CanvasSession } from "./canvas-doc";
import { assertSymbolKey, keyFromLabel } from "./agentflow-source";
import {
  loadLocalAgentServerConfig,
  removeLocalAgentServer,
  upsertLocalAgentServer,
} from "./agent-server-config";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

// ── simple in-process event bus ───────────────────────────────────────────────

type BusHandler = (payload: unknown) => void;

class EventBus {
  readonly #listeners = new Map<string, Set<BusHandler>>();

  on(channel: string, handler: BusHandler): () => void {
    let set = this.#listeners.get(channel);
    if (!set) {
      set = new Set();
      this.#listeners.set(channel, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(channel: string, payload: unknown): void {
    for (const handler of this.#listeners.get(channel) ?? []) {
      handler(payload);
    }
  }
}

type RestoreStatus = "requested" | "success" | "failure";
const REDACTED_ENV_VALUE = "[redacted]";

type RestoreStreamEvent =
  | {
      type: "restore-status";
      restoreId: string;
      agentSessionId: string;
      runId: string;
      requestedMode: AgentRestoreMode;
      selectedPrimitive?: AgentRestorePrimitive;
      status: RestoreStatus;
      error?: string;
      at: string;
    }
  | {
      type: "session-update";
      restoreId: string;
      agentSessionId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: "terminal";
      restoreId: string;
      agentSessionId: string;
      stream: string;
      chunk: string;
      at: string;
    }
  | {
      type: "interaction-requested";
      restoreId: string;
      interaction: RunInteraction;
      at: string;
    };

interface RestoreStreamState {
  events: RestoreStreamEvent[];
  done: boolean;
}

interface ActiveConversation {
  conversation: AgentConversation;
  promptPending: boolean;
  promptController?: AbortController;
  interactionInvocationId: string;
  stopInteractionEvents: () => void;
  waitForLogWrites: () => Promise<void>;
}

function closesRestoreStream(event: RestoreStreamEvent): boolean {
  return event.type === "restore-status"
    && (event.status === "failure" || (event.status === "success" && event.requestedMode === "inspect"));
}

function parseAgentServerSettings(input: unknown): AgentServerSettings | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const env = recordOfStrings(raw.env);
  const cwd = typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined;
  const additionalDirectories = arrayOfStrings(raw.additionalDirectories ?? raw.additional_directories);

  if (raw.type === "registry" && typeof raw.registryId === "string" && raw.registryId.trim()) {
    return {
      type: "registry",
      registryId: raw.registryId.trim(),
      installedVersion: typeof raw.installedVersion === "string" ? raw.installedVersion : undefined,
      cwd,
      env,
      additionalDirectories,
    };
  }
  if (raw.type === "custom" && typeof raw.command === "string" && raw.command.trim()) {
    return {
      type: "custom",
      command: raw.command.trim(),
      args: arrayOfStrings(raw.args),
      cwd,
      env,
      additionalDirectories,
    };
  }
  if (raw.type === "headless" && typeof raw.command === "string" && raw.command.trim()) {
    return {
      type: "headless",
      command: raw.command.trim(),
      argsTemplate: arrayOfStrings(raw.argsTemplate),
      cwd,
      env,
      additionalDirectories,
    };
  }
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function redactAgentServerEntries(entries: AgentServerEntry[]): AgentServerEntry[] {
  return entries.map((entry) => ({
    ...entry,
    settings: redactAgentServerSettings(entry.settings),
  }));
}

async function listAgentServerEntries(bridge: SpecflowBridge, root: string): Promise<AgentServerEntry[]> {
  return bridge.listAgentServers(root);
}

function redactAgentServerSettings(settings: AgentServerSettings): AgentServerSettings {
  if (!settings.env) return settings;
  return {
    ...settings,
    env: Object.fromEntries(Object.entries(settings.env).map(([key, value]) => [
      key,
      isSensitiveEnvKey(key) ? REDACTED_ENV_VALUE : value,
    ])),
  } as AgentServerSettings;
}

function isSensitiveEnvKey(key: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|API[_-]?KEY|PRIVATE[_-]?KEY)/i.test(key);
}

async function preserveRedactedEnvValues(
  root: string,
  id: string,
  settings: AgentServerSettings,
): Promise<AgentServerSettings> {
  if (!settings.env || !Object.values(settings.env).includes(REDACTED_ENV_VALUE)) {
    return settings;
  }
  const current = (await loadLocalAgentServerConfig(root)).agent_servers[id]?.env ?? {};
  return {
    ...settings,
    env: Object.fromEntries(Object.entries(settings.env).map(([key, value]) => [
      key,
      value === REDACTED_ENV_VALUE && current[key] !== undefined ? current[key] : value,
    ])),
  } as AgentServerSettings;
}

function interactionAuditRecord(interaction: RunInteraction): RunInteraction {
  if (interaction.kind === "permission") {
    return interaction;
  }
  return {
    ...interaction,
    request: summarizeElicitationRequest(interaction.request),
    resolution: summarizeElicitationResolution(interaction.resolution),
  };
}

function summarizeElicitationRequest(request: unknown): unknown {
  if (!request || typeof request !== "object") return request;
  const raw = request as Record<string, unknown>;
  return {
    ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
    ...(typeof raw.mode === "string" ? { mode: raw.mode } : {}),
    ...(typeof raw.message === "string" ? { message: raw.message } : {}),
    ...(raw.requestedSchema ? { requestedSchema: raw.requestedSchema } : {}),
  };
}

function summarizeElicitationResolution(resolution: unknown): unknown {
  if (!resolution || typeof resolution !== "object") return resolution;
  const raw = resolution as Record<string, unknown>;
  return {
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
  };
}

interface LifecyclePayload {
  type: string;
  at: string;
  sessionId?: string;
  parentSessionId?: string;
  stopReason?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Build a WorkflowResumeState snapshot from a prior run record + its log.
 * Powers POST /api/runs/:id/resume-workflow.
 */
async function buildResumeStateFromRun(root: string, record: RunRecord): Promise<WorkflowResumeState> {
  // Session map: specflowSessionId → ACP sessionId, from invocations.
  const acpSessionByWorkflowSession: Record<string, string> = {};
  for (const inv of record.agentInvocations) {
    if (inv.sessionId && inv.acpSessionId && !acpSessionByWorkflowSession[inv.sessionId]) {
      acpSessionByWorkflowSession[inv.sessionId] = inv.acpSessionId;
    }
  }
  // Gate decisions + branch traversal counts: scan node_status log events.
  const gateDecisions: Record<string, { branchId: string }> = {};
  const branchTraversals: Record<string, number> = {};
  for (const event of await listRunLogEvents(root, record.id)) {
    if (event.type !== "node_status" || !event.gateDecision) continue;
    gateDecisions[event.nodeId] = { branchId: event.gateDecision.branchId };
    const key = `${event.nodeId}:${event.gateDecision.branchId}`;
    branchTraversals[key] = (branchTraversals[key] ?? 0) + 1;
  }
  return {
    nodeStates: { ...record.nodeStates } as WorkflowResumeState["nodeStates"],
    nodeOutputs: { ...record.nodeOutputs },
    gateDecisions,
    acpSessionByWorkflowSession,
    branchTraversals,
  };
}

async function reconstructInvocationsFromRunLog(root: string, record: RunRecord): Promise<RunRecord["agentInvocations"]> {
  const events = await listRunLogEvents(root, record.id);
  const byInvocationId = new Map<string, RunRecord["agentInvocations"][number]>();
  for (const event of events) {
    if (event.type === "agent_lifecycle") {
      const lifecycle = (event.lifecycle ?? {}) as { type?: string; at?: string; sessionId?: string; parentSessionId?: string; error?: string };
      if (!event.agentInvocationId) continue;
      let existing = byInvocationId.get(event.agentInvocationId);
      if (!existing) {
        existing = {
          id: event.agentInvocationId,
          runId: event.runId,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          edgeId: event.edgeId,
          agentId: event.agentId,
          agentServerId: event.agentServerId,
          prompt: "",
          status: "running",
          startedAt: lifecycle.at ?? record.startedAt,
        };
        byInvocationId.set(event.agentInvocationId, existing);
      }
      if (lifecycle.sessionId && !existing.acpSessionId) existing.acpSessionId = lifecycle.sessionId;
      if (lifecycle.parentSessionId && !existing.parentSessionId) existing.parentSessionId = lifecycle.parentSessionId;
      if (lifecycle.type === "session_closed" || lifecycle.type === "prompt_stopped") {
        if (existing.status === "running") existing.status = "done";
        if (!existing.completedAt) existing.completedAt = lifecycle.at ?? new Date().toISOString();
      }
      if (lifecycle.type === "prompt_failed") {
        existing.status = "failed";
        existing.completedAt = lifecycle.at ?? new Date().toISOString();
        if (lifecycle.error) existing.error = lifecycle.error;
      }
    } else if (event.type === "session_update") {
      // session_update fires per agent chunk and carries both agentInvocationId
      // and the ACP sessionId. Invocations that REUSE an existing ACP session
      // (no fresh `session_created` of their own) only get their acpSessionId
      // populated this way.
      const evt = event as { agentInvocationId?: string; sessionId?: string; agentServerId?: string };
      if (!evt.agentInvocationId || !evt.sessionId) continue;
      const existing = byInvocationId.get(evt.agentInvocationId);
      if (existing && !existing.acpSessionId) existing.acpSessionId = evt.sessionId;
    }
  }
  return [...byInvocationId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function pickResumableInvocation(record: RunRecord): RunRecord["agentInvocations"][number] | undefined {
  if (!record.agentInvocations?.length) return undefined;
  const sortByStartDesc = [...record.agentInvocations].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Prefer an invocation that was still running — that's the one mid-flight when interrupted.
  const stillRunning = sortByStartDesc.find((inv) => inv.status === "running");
  if (stillRunning) return stillRunning;
  // Otherwise the most recently finished invocation; the user can prompt it to continue the flow.
  return sortByStartDesc[0];
}

function buildContinuationPrompt(input: {
  nodeTitle?: string;
  invocationStatus: "running" | "done" | "failed";
  runStatus: "running" | "success" | "error" | "cancelled";
  errorMsg?: string;
}): string {
  const node = input.nodeTitle ? `"${input.nodeTitle}"` : "the last step";
  const lines: string[] = [];
  if (input.invocationStatus === "running") {
    lines.push(`Specflow detected that the previous run was interrupted while ${node} was still in progress.`);
  } else if (input.runStatus === "cancelled") {
    lines.push(`Specflow detected that the previous run was cancelled after ${node} completed.`);
  } else if (input.runStatus === "error") {
    lines.push(`Specflow detected that the previous run failed after ${node} completed${input.errorMsg ? `: ${input.errorMsg}` : ""}.`);
  } else {
    lines.push(`Specflow is resuming the conversation that backed ${node}.`);
  }
  lines.push(
    "Before doing more work, briefly summarize what you completed in your last actions and what (if anything) was left undone. " +
    "Then, if it makes sense, finish the outstanding work. If you cannot tell what to do, ask me a clarifying question instead of guessing.",
  );
  return lines.join("\n\n");
}

function upsertRunInvocation(record: RunRecord, input: {
  id: string;
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  agentId: string;
  agentServerId: string;
  lifecycle: LifecyclePayload;
}): void {
  const existingIdx = record.agentInvocations.findIndex((inv) => inv.id === input.id);
  const at = input.lifecycle.at ?? new Date().toISOString();
  const lifecycleSessionId = typeof input.lifecycle.sessionId === "string" ? input.lifecycle.sessionId : undefined;
  const parentSessionId = typeof input.lifecycle.parentSessionId === "string" ? input.lifecycle.parentSessionId : undefined;
  const error = typeof input.lifecycle.error === "string" ? input.lifecycle.error : undefined;

  if (existingIdx < 0) {
    record.agentInvocations.push({
      id: input.id,
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      nodeId: input.nodeId,
      edgeId: input.edgeId,
      agentId: input.agentId,
      agentServerId: input.agentServerId,
      acpSessionId: lifecycleSessionId,
      parentSessionId,
      prompt: "",
      status: "running",
      startedAt: at,
    });
    return;
  }
  const existing = record.agentInvocations[existingIdx]!;
  if (lifecycleSessionId && !existing.acpSessionId) existing.acpSessionId = lifecycleSessionId;
  if (parentSessionId && !existing.parentSessionId) existing.parentSessionId = parentSessionId;
  if (input.lifecycle.type === "session_closed" || input.lifecycle.type === "prompt_stopped") {
    if (existing.status === "running") existing.status = "done";
    if (!existing.completedAt) existing.completedAt = at;
  }
  if (input.lifecycle.type === "prompt_failed") {
    existing.status = "failed";
    existing.completedAt = at;
    if (error) existing.error = error;
  }
}

// ── API handler factory ───────────────────────────────────────────────────────

export function createApiHandler(bridge: SpecflowBridge, root: string) {
  const bus = new EventBus();
  const authTerminals = new AuthTerminalSessionStore({
    checkAuth: (agentServerId) => bridge.inspectAgentAuthentication(root, agentServerId),
  });
  const restoreStreams = new Map<string, RestoreStreamState>();
  const restoreControllers = new Map<string, AbortController>();
  const activeConversations = new Map<string, ActiveConversation>();
  const runControllers = new Map<string, AbortController>();
  const resumeRequests = new Set<string>();

  // Reconcile any runs left "running" from a previous process — server restart
  // or kill -9 — so the UI shows the real state instead of a stuck spinner.
  // The ACP session itself can still be resumed via the agent-session restore flow.
  void reconcileInterruptedRuns(root, "Server restart detected; run was interrupted before completion.")
    .then((ids) => {
      if (ids.length > 0) {
        console.log(`[specflow] reconciled ${ids.length} interrupted run(s):`, ids.join(", "));
      }
    })
    .catch((error) => console.error("Failed to reconcile interrupted runs", error));

  async function closeActiveConversation(active: ActiveConversation, reason = "Restored conversation closed."): Promise<void> {
    active.promptController?.abort();
    active.stopInteractionEvents();
    for (const interaction of bridge.interactions.list({ status: "pending" })) {
      if (interaction.agentInvocationId === active.interactionInvocationId) {
        bridge.interactions.cancel(interaction.id, reason);
      }
    }
    await active.waitForLogWrites();
    await active.conversation.close();
  }

  const DEFAULT_SESSION: CanvasSession = {
    id: "main",
    name: "main",
    agentServerId: "unconfigured",
  };

  function publishRestoreEvent(event: RestoreStreamEvent): void {
    const state = restoreStreams.get(event.restoreId) ?? { events: [], done: false };
    state.events.push(event);
    if (closesRestoreStream(event)) {
      state.done = true;
    }
    restoreStreams.set(event.restoreId, state);
    bus.emit(`${event.restoreId}:restore`, event);
  }

  function restoreSseResponse(restoreId: string): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: RestoreStreamEvent) =>
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));

        const state = restoreStreams.get(restoreId);
        if (!state) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Restore not found" })}\n\n`));
          controller.close();
          return;
        }

        for (const event of state.events) {
          enqueue(event);
        }
        if (state.done) {
          controller.close();
          return;
        }

        cleanup = bus.on(`${restoreId}:restore`, (event) => {
          const restoreEvent = event as RestoreStreamEvent;
          enqueue(restoreEvent);
          if (closesRestoreStream(restoreEvent)) {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  function authTerminalSseResponse(sessionId: string): Response {
    const record = authTerminals.get(sessionId);
    if (!record) {
      return Response.json({ error: "Auth terminal session not found" }, { status: 404 });
    }
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enqueue = (event: { type: string }) => {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        };

        for (const event of record.events) enqueue(event);
        if (record.status !== "running") {
          controller.close();
          return;
        }
        cleanup = authTerminals.subscribe(sessionId, (event) => {
          enqueue(event);
          if (event.type === "status" && event.status !== "running") {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  function sseResponse(runId: string, options: { replay: boolean } = { replay: true }): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (type: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

        enqueue("hello", { runId });

        let priorRunStatus: string | undefined;
        try {
          const prior = await loadRun(runId, root);
          priorRunStatus = prior.status;
        } catch {
          // Run may not exist yet; subscribe optimistically.
        }

        // Skip replay when the caller already loaded history in bulk via /logs.
        // Replaying 70k+ session_update events through SSE one-by-one floods
        // the client; batch load is O(1) on the React side.
        if (options.replay) {
          for (const event of await listRunLogEvents(root, runId)) {
            if (event.type === "terminal") {
              enqueue("terminal", {
                chunk: event.chunk,
                stream: event.stream,
                nodeId: event.nodeId,
                agentInvocationId: event.agentInvocationId,
                specflowSessionId: event.specflowSessionId,
                replay: true,
              });
            } else if (event.type === "session_update") {
              enqueue("session-update", { ...event, replay: true });
            } else if (event.type === "node_status") {
              enqueue("node-status", {
                nodeId: event.nodeId,
                status: event.status === "done" ? "success" : event.status,
                runId,
                ...(event.gateDecision ? { gateDecision: event.gateDecision, gateBranches: event.gateBranches } : {}),
                replay: true,
              });
            }
          }
        }

        const offNode = bus.on(`${runId}:node`, (e) => enqueue("node-status", e));
        const offInteraction = bridge.interactions.subscribe(runId, (interaction) => {
          enqueue("interaction-requested", interaction);
        });
        const offRun  = bus.on(`${runId}:run`,  (e) => {
          enqueue("run-status", e);
          const ev = e as { status: string };
          if (ev.status !== "running") {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 200);
          }
        });
        const offTerm = bus.on(`${runId}:term`, (e) => enqueue("terminal", e));
        const offSessionUpdate = bus.on(`${runId}:session-update`, (e) => enqueue("session-update", e));

        for (const interaction of bridge.interactions.list({ runId, status: "pending" })) {
          enqueue("interaction-requested", interaction);
        }

        if (priorRunStatus && priorRunStatus !== "running") {
          enqueue("run-status", { runId, status: priorRunStatus, replay: true });
          setTimeout(() => {
            try { controller.close(); } catch { /* already closed */ }
          }, 50);
        }

        cleanup = () => {
          offNode(); offRun(); offTerm(); offSessionUpdate(); offInteraction();
        };
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    });
  }

  async function handleRun(
    workflowId: string,
    initialInput: string,
    variableValues: Record<string, string>,
    snapshot?: { agentflow: AgentFlowDoc; layout: CanvasLayoutDoc },
    resumeFrom?: { state: WorkflowResumeState; source: RunRecord },
  ): Promise<Response> {
    let agentflow: AgentFlowDoc;
    let layout: CanvasLayoutDoc;
    if (snapshot) {
      agentflow = snapshot.agentflow;
      layout = snapshot.layout;
    } else {
      try {
        agentflow = await loadAgentFlow(workflowId, root);
        layout = await loadOrCreateCanvasLayout(agentflow, root);
      } catch (error) {
        const notFound = (error as { code?: string }).code === "ENOENT";
        return Response.json({ error: notFound ? "Agentflow not found" : errorMessage(error) }, { status: notFound ? 404 : 400 });
      }
    }

    let authStatuses: AgentAuthenticationStatus[];
    try {
      await assertInteractivePauseSupported(agentflow);
      authStatuses = await inspectWorkflowAuthentication(agentflow);
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 409 });
    }
    const requiredAuth = authStatuses.filter((status) => status.needsAuth);
    if (requiredAuth.length > 0) {
      return Response.json({
        error: "Agent authentication required",
        authStatuses: requiredAuth,
      }, { status: 409 });
    }

    const prepared = prepareCanvasRun(agentflow, { initialInput, variableValues });
    if (prepared.missingVariables.length > 0) {
      return Response.json({
        error: "Missing required variables",
        missingVariables: prepared.missingVariables.map((v) => ({
          name: v.name,
          description: v.description,
        })),
      }, { status: 400 });
    }

    const workflow = canvasToWorkflow(prepared.doc);
    const runId = uuidv7();
    const runController = new AbortController();
    runControllers.set(runId, runController);
    const existingCount = (await listRuns(workflowId, root)).length;
    const label = `Run #${existingCount + 1}`;

    const initialNodeStates: Record<string, RunState> = {};
    for (const n of agentflow.nodes) {
      initialNodeStates[n.id] = "pending";
    }

    // A continued run inherits completed work only. Interrupted or failed work
    // belongs to the source run and starts pending until this run re-enters it.
    const seededNodeStates: Record<string, RunState> = { ...initialNodeStates };
    if (resumeFrom) {
      for (const [nodeId, state] of Object.entries(resumeFrom.state.nodeStates)) {
        if (state === "done" || state === "success") seededNodeStates[nodeId] = "success";
      }
    }
    const record: RunRecord = {
      id: runId,
      workflowId,
      label,
      status: "running",
      startedAt: new Date().toISOString(),
      agent: agentflow.sessions[0]?.agentServerId ?? agentflow.sessions[0]?.agent ?? "unconfigured",
      nodeStates: seededNodeStates,
      nodeOutputs: resumeFrom ? { ...resumeFrom.state.nodeOutputs } : {},
      agentInvocations: [],
      agentSessions: [],
      agentflowSnapshot: agentflow, // store pre-substitution snapshots
      canvasSnapshot: layout,
      initialInput,
      variableValues,
      ...(resumeFrom ? { resumedFromRunId: resumeFrom.source.id } : {}),
    };

    await saveRun(record, root);
    if (resumeFrom) {
      resumeFrom.source.resumedByRunId = runId;
      await saveRun(resumeFrom.source, root);
    }
    await appendRunLogEvent(root, {
      type: "run_status",
      runId,
      workflowId,
      status: "running",
      at: record.startedAt,
    });

    let lastTermSeq = 0;
    let currentNodeId: string | undefined;
    const invocationNodeMap = new Map<string, string>();
    const invocationSessionMap = new Map<string, string>();
    let logWrite = Promise.resolve();
    const appendLog = (event: Parameters<typeof appendRunLogEvent>[1]) => {
      logWrite = logWrite
        .then(() => appendRunLogEvent(root, event))
        .catch((error) => {
          console.error("Failed to append run log", error);
        });
    };
    const offInteractionLog = bridge.interactions.subscribe(runId, (interaction) => {
      appendLog({ type: "interaction", ...interactionAuditRecord(interaction) });
    });

    const flushTerminalEvents = () => {
      const all = bridge.terminalEvents.list({ runId });
      for (const te of all) {
        if (te.sequence > lastTermSeq) {
          lastTermSeq = te.sequence;
          const attributedNodeId = (te.agentInvocationId && invocationNodeMap.get(te.agentInvocationId))
            ?? currentNodeId;
          const specflowSessionId = te.agentInvocationId
            ? invocationSessionMap.get(te.agentInvocationId)
            : undefined;
          const event = { type: "terminal" as const, ...te, nodeId: attributedNodeId, specflowSessionId };
          appendLog(event);
          bus.emit(`${runId}:term`, {
            chunk: te.chunk,
            stream: te.stream,
            nodeId: attributedNodeId,
            agentInvocationId: te.agentInvocationId,
            specflowSessionId,
          });
        }
      }
    };

    const onNodeStatus = (e: NodeStatusEvent) => {
      const uiStatus: RunState =
        e.status === "done" ? "success" :
        e.status === "failed" ? "error" :
        e.status === "paused" ? "paused" :
        e.status === "running" ? "running" : "pending";

      if (e.status === "running") {
        currentNodeId = e.nodeId;
      }

      record.nodeStates[e.nodeId] = uiStatus;
      if (uiStatus === "running") record.activeNode = e.nodeId;
      if (uiStatus === "paused") record.pausedNodeId = e.nodeId;
      if (uiStatus === "success" && record.pausedNodeId === e.nodeId) record.pausedNodeId = undefined;

      if (e.status === "done" && (e as NodeStatusEvent & { output?: string }).output) {
        record.nodeOutputs[e.nodeId] = (e as NodeStatusEvent & { output?: string }).output!;
      }

      void saveRun(record, root);
      appendLog({ type: "node_status", ...e });
      bus.emit(`${runId}:node`, {
        nodeId: e.nodeId,
        status: uiStatus,
        runId,
        ...(e.gateDecision ? { gateDecision: e.gateDecision, gateBranches: e.gateBranches } : {}),
      });
      flushTerminalEvents();
    };

    const onRunStatus = (e: RunStatusEvent) => {
      if (e.status === "done") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "success";
      } else if (e.status === "failed") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "error";
        record.errorMsg = e.error;
      } else if (e.status === "cancelled") {
        const completedAt = new Date().toISOString();
        record.completedAt = completedAt;
        record.duration = formatDuration(record.startedAt, completedAt);
        record.status = "cancelled";
        record.errorMsg = e.error;
      }
      flushTerminalEvents();
      if (record.status !== "running") {
        bridge.interactions.cancelPendingForRun(runId, `run ${record.status}`);
        bridge.pauses.cancelForRun(runId, `run ${record.status}`);
      }
      void saveRun(record, root);
      appendLog({ type: "run_status", ...e });
      bus.emit(`${runId}:run`, { runId, status: record.status, workflowId, error: record.errorMsg });
      offInteractionLog();
    };

    const executor = new WorkflowExecutor({
      cwd: root,
      terminalEvents: bridge.terminalEvents,
      onNodeStatus,
      onRunStatus,
      onAgentLifecycle: (event) => {
        const {
          runId,
          nodeRunId,
          nodeId,
          edgeId,
          agentInvocationId,
          agentId,
          agentServerId,
          ...lifecycle
        } = event;
        if (agentInvocationId && nodeId) {
          invocationNodeMap.set(agentInvocationId, nodeId);
        }
        // Prefer the executor-provided sessionId (covers edge-handoff
        // invocations which have no nodeId). Fall back to deriving from the
        // node for older code paths.
        if (agentInvocationId && event.specflowSessionId) {
          invocationSessionMap.set(agentInvocationId, event.specflowSessionId);
        } else if (agentInvocationId && nodeId) {
          const node = agentflow.nodes.find((candidate) => candidate.id === nodeId);
          if (node?.kind === "step" && node.sessionId) {
            invocationSessionMap.set(agentInvocationId, node.sessionId);
          }
        }
        // Persist invocation rows incrementally so an unexpected shutdown
        // still leaves enough metadata to drive a "resume run" action later.
        if (agentInvocationId) {
          upsertRunInvocation(record, {
            id: agentInvocationId,
            runId,
            nodeRunId,
            nodeId,
            edgeId,
            agentId,
            agentServerId,
            lifecycle,
          });
          void saveRun(record, root);
        }
        appendLog({
          type: "agent_lifecycle",
          runId,
          nodeRunId,
          nodeId,
          edgeId,
          agentInvocationId,
          agentId,
          agentServerId,
          lifecycle,
        });
      },
      onAgentSessionUpdate: (event) => {
        if (event.agentInvocationId && event.nodeId) {
          invocationNodeMap.set(event.agentInvocationId, event.nodeId);
        }
        // Catch invocations that REUSE an ACP session (no fresh session_created
        // event of their own) — their acpSessionId only shows up on session_update.
        // Seed once per invocation to avoid saving on every chunk.
        if (event.agentInvocationId && event.sessionId) {
          const inv = record.agentInvocations.find((candidate) => candidate.id === event.agentInvocationId);
          if (inv && !inv.acpSessionId) {
            inv.acpSessionId = event.sessionId;
            void saveRun(record, root);
          }
        }
        const specflowSessionId = event.specflowSessionId
          ?? (event.agentInvocationId ? invocationSessionMap.get(event.agentInvocationId) : undefined);
        // Persist specflowSessionId in the log too so SSE replay on a later
        // page load routes events to the correct session tab.
        const persisted = { type: "session_update" as const, ...event, specflowSessionId };
        appendLog(persisted);
        bus.emit(`${runId}:session-update`, persisted);
      },
      interactions: bridge.interactions,
      pauses: bridge.pauses,
    });

    void executor.run(workflow, prepared.initialInput, {
        runId,
        signal: runController.signal,
        ...(resumeFrom ? { resumeFrom: resumeFrom.state } : {}),
      })
      .then(async (workflowRun) => {
        await logWrite;
        record.agentInvocations = workflowRun.agentInvocations;
        await saveRun(record, root);
        await upsertAgentSessionsFromRun(record, root);
      })
      .catch(async () => {
        // On cancel/error the .then path never runs, so agentSessions would
        // stay empty even though incremental upserts populated agentInvocations
        // with valid acpSessionIds. Rebuild explicitly so resume lookups don't
        // have to fix this up after the fact.
        try {
          await logWrite;
          await upsertAgentSessionsFromRun(record, root);
        } catch (error) {
          console.error("Failed to rebuild agent sessions after run failure", error);
        }
      })
      .finally(() => {
        runControllers.delete(runId);
      });

    return Response.json({ runId });
  }

  async function inspectWorkflowAuthentication(agentflow: AgentFlowDoc): Promise<AgentAuthenticationStatus[]> {
    const servers = new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry]));
    const agentServerIds = [...new Set(agentflow.sessions
      .map((session) => session.agentServerId ?? session.agent)
      .filter((id): id is string => Boolean(id) && id !== "unconfigured"))];

    return Promise.all(agentServerIds
      .filter((id) => servers.get(id)?.settings.type !== "headless")
      .map((id) => bridge.inspectAgentAuthentication(root, id)));
  }

  async function assertInteractivePauseSupported(agentflow: AgentFlowDoc): Promise<void> {
    const servers = new Map((await bridge.listAgentServers(root)).map((entry) => [entry.id, entry]));
    const sessionsById = new Map(agentflow.sessions.map((session) => [session.id, session]));
    for (const node of agentflow.nodes) {
      if (node.kind !== "step" || !node.pauseAfterRun) continue;
      const serverId = sessionsById.get(node.sessionId ?? "")?.agentServerId;
      if (serverId && servers.get(serverId)?.settings.type === "headless") {
        throw new Error(`Node "${node.id}" cannot pause for interaction because headless agent "${serverId}" has no ACP session.`);
      }
    }
  }

  async function handleRestore(agentSessionId: string, mode: AgentRestoreMode): Promise<Response> {
    let session: Awaited<ReturnType<typeof loadAgentSession>>;
    try {
      session = await loadAgentSession(root, agentSessionId);
    } catch {
      return Response.json({ error: "Agent session not found" }, { status: 404 });
    }

    const restoreId = uuidv7();
    const restoreController = new AbortController();
    restoreControllers.set(restoreId, restoreController);
    const startedAt = new Date().toISOString();
    const requestedAttempt = {
      id: restoreId,
      requestedMode: mode,
      status: "requested" as const,
      startedAt,
    };
    await recordAgentSessionRestoreAttempt(root, session.id, requestedAttempt);
    await appendRunLogEvent(root, {
      type: "restore_attempt",
      runId: session.latestRunId,
      agentSessionId: session.id,
      agentServerId: session.agentServerId,
      acpSessionId: session.acpSessionId,
      requestedMode: mode,
      status: "requested",
      at: startedAt,
    });

    publishRestoreEvent({
      type: "restore-status",
      restoreId,
      agentSessionId: session.id,
      runId: session.latestRunId,
      requestedMode: mode,
      status: "requested",
      at: startedAt,
    });

    let conversation: AgentConversation | undefined;
    let persistContinuedUpdates = false;
    let continuedLogWrite = Promise.resolve();
    const interactionInvocationId = `restore:${restoreId}`;
    const latestInvocation = session.invocations.find((entry) => entry.invocationId === session.latestInvocationId)
      ?? session.invocations.at(-1);
    const interactionContext: RunInteractionContext = {
      runId: session.latestRunId,
      nodeRunId: latestInvocation?.nodeRunId,
      nodeId: latestInvocation?.nodeId,
      edgeId: latestInvocation?.edgeId,
      agentInvocationId: interactionInvocationId,
      agentId: session.agentId,
      agentServerId: session.agentServerId,
      specflowSessionId: session.specflowSessionId,
      acpSessionId: session.acpSessionId,
    };
    const stopInteractionEvents = mode === "continue"
      ? bridge.interactions.subscribe(session.latestRunId, (interaction) => {
          if (interaction.agentInvocationId !== interactionInvocationId) return;
          void appendRunLogEvent(root, { type: "interaction", ...interactionAuditRecord(interaction) })
            .catch((error) => console.error("Failed to append restored conversation interaction log", error));
          publishRestoreEvent({
            type: "interaction-requested",
            restoreId,
            interaction,
            at: new Date().toISOString(),
          });
        })
      : () => {};
    void bridge.openAgentConversation({
      agentServerId: session.agentServerId,
      sessionId: session.acpSessionId,
      mode,
      cwd: root,
      signal: restoreController.signal,
      onTerminalEvent: (event) => {
        publishRestoreEvent({
          type: "terminal",
          restoreId,
          agentSessionId: session.id,
          stream: event.stream,
          chunk: event.chunk,
          at: new Date().toISOString(),
        });
      },
      onSessionUpdate: (event) => {
        const at = new Date().toISOString();
        if (persistContinuedUpdates) {
          continuedLogWrite = continuedLogWrite
            .then(() => appendRunLogEvent(root, {
              type: "session_update",
              runId: session.latestRunId,
              nodeRunId: latestInvocation?.nodeRunId,
              nodeId: latestInvocation?.nodeId,
              edgeId: latestInvocation?.edgeId,
              agentInvocationId: interactionInvocationId,
              agentId: session.agentId,
              agentServerId: session.agentServerId,
              sessionId: event.sessionId,
              update: event.update,
              at,
            }))
            .catch((error) => console.error("Failed to append restored conversation session update log", error));
        }
        publishRestoreEvent({
          type: "session-update",
          restoreId,
          agentSessionId: session.id,
          sessionId: event.sessionId,
          update: event.update,
          at,
        });
      },
      onPermissionRequest: mode === "continue"
        ? (request) => bridge.interactions.requestPermission(interactionContext, request)
        : undefined,
      onElicitationRequest: mode === "continue"
        ? (request) => bridge.interactions.requestElicitation(interactionContext, request)
        : undefined,
      onElicitationComplete: mode === "continue"
        ? (notification) => bridge.interactions.recordElicitationComplete(interactionContext, notification)
        : undefined,
    }).then(async (opened) => {
      conversation = opened;
      return opened.restore();
    }).then(async (result) => {
      const completedAt = new Date().toISOString();
      await recordAgentSessionRestoreAttempt(root, session.id, {
        ...requestedAttempt,
        selectedPrimitive: result.selectedPrimitive,
        status: "success",
        completedAt,
      });
      await appendRunLogEvent(root, {
        type: "restore_attempt",
        runId: session.latestRunId,
        agentSessionId: session.id,
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
        requestedMode: mode,
        selectedPrimitive: result.selectedPrimitive,
        status: "success",
        at: completedAt,
      });
      if (mode === "continue") {
        activeConversations.set(restoreId, {
          conversation: conversation!,
          promptPending: false,
          interactionInvocationId,
          stopInteractionEvents,
          waitForLogWrites: () => continuedLogWrite,
        });
        persistContinuedUpdates = true;
      } else {
        await conversation?.close();
      }
      publishRestoreEvent({
        type: "restore-status",
        restoreId,
        agentSessionId: session.id,
        runId: session.latestRunId,
        requestedMode: mode,
        selectedPrimitive: result.selectedPrimitive,
        status: "success",
        at: completedAt,
      });
    }).catch(async (error) => {
      stopInteractionEvents();
      await conversation?.close().catch(() => {});
      const completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await recordAgentSessionRestoreAttempt(root, session.id, {
        ...requestedAttempt,
        status: "failure",
        completedAt,
        error: message,
      });
      await appendRunLogEvent(root, {
        type: "restore_attempt",
        runId: session.latestRunId,
        agentSessionId: session.id,
        agentServerId: session.agentServerId,
        acpSessionId: session.acpSessionId,
        requestedMode: mode,
        status: "failure",
        error: message,
        at: completedAt,
      });
      publishRestoreEvent({
        type: "restore-status",
        restoreId,
        agentSessionId: session.id,
        runId: session.latestRunId,
        requestedMode: mode,
        status: "failure",
        error: message,
        at: completedAt,
      });
    }).finally(() => {
      restoreControllers.delete(restoreId);
    });

    return Response.json({
      restoreId,
      agentSessionId: session.id,
      runId: session.latestRunId,
      status: "running",
      requestedMode: mode,
    });
  }

  return async function handleApiRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const { pathname } = url;

    // GET /api/agent-servers
    if (request.method === "GET" && pathname === "/api/agent-servers") {
      const entries = await listAgentServerEntries(bridge, root);
      return Response.json(redactAgentServerEntries(entries));
    }

    // GET /api/agent-servers/registry
    if (request.method === "GET" && pathname === "/api/agent-servers/registry") {
      return Response.json(await bridge.listAgentRegistry(root));
    }

    // GET /api/agent-servers/:id/auth
    const agentServerAuthMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/auth$/);
    if (agentServerAuthMatch && request.method === "GET") {
      try {
        return Response.json(await bridge.inspectAgentAuthentication(root, decodeURIComponent(agentServerAuthMatch[1])));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // POST /api/agent-servers/:id/auth/:methodId
    const agentServerAuthMethodMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/auth\/([^/]+)$/);
    if (agentServerAuthMethodMatch && request.method === "POST") {
      const id = decodeURIComponent(agentServerAuthMethodMatch[1]);
      const methodId = decodeURIComponent(agentServerAuthMethodMatch[2]);
      try {
        const terminalTask = await bridge.resolveAgentTerminalAuthTask(root, id, methodId);
        if (terminalTask) {
          const terminalSessionId = authTerminals.start(terminalTask);
          return Response.json({ status: "terminal_started", terminalSessionId });
        }
        return Response.json(await bridge.authenticateAgentServer(root, id, methodId));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/agent-auth-terminals/:sessionId/events
    const authTerminalMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)$/);
    const authTerminalEventsMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)\/events$/);
    if (authTerminalEventsMatch && request.method === "GET") {
      return authTerminalSseResponse(decodeURIComponent(authTerminalEventsMatch[1]));
    }

    if (authTerminalMatch && request.method === "GET") {
      const record = authTerminals.get(decodeURIComponent(authTerminalMatch[1]));
      if (!record) return Response.json({ error: "Auth terminal session not found" }, { status: 404 });
      return Response.json({
        sessionId: record.id,
        agentServerId: record.task.agentServerId,
        methodId: record.task.methodId,
        label: record.task.label,
        status: record.status,
      });
    }

    // POST /api/agent-auth-terminals/:sessionId/(input|resize|cancel|check)
    const authTerminalActionMatch = pathname.match(/^\/api\/agent-auth-terminals\/([^/]+)\/(input|resize|cancel|check)$/);
    if (authTerminalActionMatch && request.method === "POST") {
      const sessionId = decodeURIComponent(authTerminalActionMatch[1]);
      const action = authTerminalActionMatch[2];
      try {
        if (action === "input") {
          const body = await request.json().catch(() => ({})) as { data?: unknown };
          if (typeof body.data !== "string") return Response.json({ error: "Missing input data" }, { status: 400 });
          authTerminals.input(sessionId, body.data);
          return Response.json({ ok: true });
        }
        if (action === "resize") {
          const body = await request.json().catch(() => ({})) as { cols?: unknown; rows?: unknown };
          if (typeof body.cols !== "number" || typeof body.rows !== "number") {
            return Response.json({ error: "Missing terminal size" }, { status: 400 });
          }
          authTerminals.resize(sessionId, body.cols, body.rows);
          return Response.json({ ok: true });
        }
        if (action === "cancel") {
          await authTerminals.cancel(sessionId);
          return Response.json({ ok: true });
        }
        const authStatus = await authTerminals.check(sessionId);
        return Response.json({ ok: true, authStatus });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 404 });
      }
    }

    // PUT /api/agent-servers/:id
    const agentServerMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)$/);
    if (agentServerMatch && request.method === "PUT") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      let settings = parseAgentServerSettings(body);
      if (!settings) {
        return Response.json({ error: "Invalid agent server settings" }, { status: 400 });
      }
      settings = await preserveRedactedEnvValues(root, decodeURIComponent(agentServerMatch[1]), settings);
      const id = decodeURIComponent(agentServerMatch[1]);
      await upsertLocalAgentServer(root, id, settings);
      if (settings.type === "registry") {
        try {
          await bridge.ensureAgentServerInstalled(root, id);
        } catch (error) {
          return Response.json({ error: errorMessage(error) }, { status: 409 });
        }
      }
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
    }

    // DELETE /api/agent-servers/:id
    if (agentServerMatch && request.method === "DELETE") {
      await removeLocalAgentServer(root, decodeURIComponent(agentServerMatch[1]));
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
    }

    // GET /api/agent-servers/:id/capabilities
    // Returns the cached InitializeResponse.agentCapabilities + first session's
    // modes / configOptions / availableCommands snapshot. 404 means no probe yet
    // — the UI should fall back to a generic editor and offer the refresh button.
    const agentServerCapabilitiesMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/capabilities$/);
    if (agentServerCapabilitiesMatch && request.method === "GET") {
      const id = decodeURIComponent(agentServerCapabilitiesMatch[1]);
      const cached = await new AgentServerStore({ root }).getCapabilities(id);
      if (!cached) return Response.json({ error: "No capability snapshot cached for this agent." }, { status: 404 });
      return Response.json(cached);
    }

    // POST /api/agent-servers/:id/capabilities/refresh
    // Spawns a throwaway ACP session purely to refresh the cache. Used when
    // the user knows their settings changed without an installedVersion bump
    // (env vars / args / etc.) and wants the UI to see new modes immediately.
    const agentServerCapabilitiesRefreshMatch = pathname.match(/^\/api\/agent-servers\/([^/]+)\/capabilities\/refresh$/);
    if (agentServerCapabilitiesRefreshMatch && request.method === "POST") {
      const id = decodeURIComponent(agentServerCapabilitiesRefreshMatch[1]);
      const store = new AgentServerStore({ root });
      try {
        const resolved = await store.resolve(id);
        if (resolved.source === "headless") {
          return Response.json({ error: "Headless agent runtimes do not advertise ACP capabilities." }, { status: 409 });
        }
        const probe = await probeAcpAgentCapabilities({ resolved, cwd: root });
        await store.setCapabilities(id, probe);
        const refreshed = await store.getCapabilities(id);
        return Response.json(refreshed ?? probe);
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/skills
    // Lists every skill the user has authored under `~/.agents/skills/` or
    // `<workspace>/.agents/skills/`. Powers the UI slash-command popup. Body
    // payloads are omitted from this listing — they ship with the prompt
    // when the executor injects them, not over a separate fetch.
    if (request.method === "GET" && pathname === "/api/skills") {
      const all = await new SkillStore({ root }).list();
      // Dedupe for display: list() returns both scopes, but the popup only
      // needs the winning skill per name. list() is sorted projectLocal-first
      // within a name group, so the first occurrence is the winner.
      const seen = new Set<string>();
      const skills = all.filter((skill) => {
        if (seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
      });
      return Response.json(skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        filePath: skill.filePath,
        bodyPreview: skill.body.slice(0, 200),
      })));
    }

    // GET /api/canvases
    if (request.method === "GET" && pathname === "/api/canvases") {
      const list = await listCanvases(root);
      const runs = await listRuns(undefined, root);
      const runsByWorkflow = new Map<string, number>();
      for (const r of runs) {
        runsByWorkflow.set(r.workflowId, (runsByWorkflow.get(r.workflowId) ?? 0) + 1);
      }
      return Response.json(list.map((c) => ({ ...c, runs: runsByWorkflow.get(c.id) ?? 0 })));
    }

    // POST /api/canvases  (create new canvas)
    if (request.method === "POST" && pathname === "/api/canvases") {
      let body: { key?: string; name?: string } = {};
      try { body = await request.json(); } catch { /* ok */ }
      const name = body.name ?? "Untitled workflow";
      let id = body.key ?? keyFromLabel(name, "untitled-workflow");
      try {
        assertSymbolKey(id, "workflow key");
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
      const existingIds = new Set((await listCanvases(root)).map((entry) => entry.id));
      if (existingIds.has(id)) {
        const base = id;
        let suffix = 2;
        while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
        id = `${base}-${suffix}`;
      }
      const doc: CanvasDoc = {
        id,
        name,
        sessions: [DEFAULT_SESSION],
        nodes: [],
        edges: [],
      };
      await saveCanvas(id, doc, root);
      return Response.json(doc);
    }

    // /api/canvases/:id
    const canvasMatch = pathname.match(/^\/api\/canvases\/([^/]+)$/);
    if (canvasMatch) {
      const id = canvasMatch[1];
      if (request.method === "GET") {
        try {
          const doc = await loadCanvas(id, root);
          return Response.json(doc);
        } catch (error) {
          const notFound = (error as { code?: string }).code === "ENOENT";
          return Response.json({ error: notFound ? "Not found" : errorMessage(error) }, { status: notFound ? 404 : 400 });
        }
      }
      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        try {
          await saveCanvas(id, body, root);
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json({ error: errorMessage(error) }, { status: 400 });
        }
      }
      if (request.method === "DELETE") {
        await deleteCanvas(id, root);
        return Response.json({ ok: true });
      }
    }

    // POST /api/canvases/:id/assets
    const assetsMatch = pathname.match(/^\/api\/canvases\/([^/]+)\/assets$/);
    if (assetsMatch && request.method === "POST") {
      const workflowId = assetsMatch[1];
      const kind = url.searchParams.get("kind");
      const directory = url.searchParams.get("directory") === "true";
      if (kind !== "image" && kind !== "path") {
        return Response.json({ error: "Invalid asset kind" }, { status: 400 });
      }
      const form = await request.formData();
      const files = form.getAll("files").filter((value): value is File => value instanceof File);
      const relativePaths = form.getAll("relativePaths").filter((value): value is string => typeof value === "string");
      if (files.length === 0) return Response.json({ error: "No files supplied" }, { status: 400 });
      const base = join(root, SPECFLOW_WORKSPACE_PATH, "assets", workflowId, kind === "image" ? "images" : "resources");
      await mkdir(base, { recursive: true });
      if (kind === "image") {
        const images: Array<{ path: string; label: string; mimeType?: string }> = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) return Response.json({ error: "Images only" }, { status: 400 });
          const extension = extname(file.name) || mimeExtension(file.type);
          const filename = `${uuidv7()}${extension}`;
          await writeFile(join(base, filename), new Uint8Array(await file.arrayBuffer()));
          images.push({
            path: `${SPECFLOW_WORKSPACE_PATH}/assets/${workflowId}/images/${filename}`,
            label: basename(file.name) || filename,
            ...(file.type ? { mimeType: file.type } : {}),
          });
        }
        return Response.json({ paths: images.map((image) => image.path), images });
      }
      const importedPaths = new Set<string>();
      for (const [index, file] of files.entries()) {
        const safePath = safeAssetPath(relativePaths[index] ?? file.name);
        const output = join(base, safePath);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, new Uint8Array(await file.arrayBuffer()));
        importedPaths.add(directory
          ? `${SPECFLOW_WORKSPACE_PATH}/assets/${workflowId}/resources/${safePath.split("/")[0]}/`
          : `${SPECFLOW_WORKSPACE_PATH}/assets/${workflowId}/resources/${safePath}`);
      }
      return Response.json({ paths: [...importedPaths] });
    }

    // POST /api/canvases/:id/run
    const runMatch = pathname.match(/^\/api\/canvases\/([^/]+)\/run$/);
    if (runMatch && request.method === "POST") {
      const id = runMatch[1];
      let body: { initialInput?: string; variableValues?: Record<string, string> } = {};
      try { body = await request.json(); } catch { /* ok */ }
      return handleRun(id, body.initialInput ?? "", body.variableValues ?? {});
    }

    // GET /api/runs  (optional ?workflowId=)
    if (request.method === "GET" && pathname === "/api/runs") {
      const workflowId = url.searchParams.get("workflowId") ?? undefined;
      const runs = await listRuns(workflowId, root);
      return Response.json(runs);
    }

    // /api/runs/:id
    const runIdMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runIdMatch) {
      const id = runIdMatch[1];
      if (request.method === "GET") {
        try {
          const rec = await loadRun(id, root);
          return Response.json(rec);
        } catch {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (request.method === "DELETE") {
        let deleted: RunRecord | undefined;
        try {
          deleted = await loadRun(id, root);
        } catch {
          // Deleting an already absent run remains idempotent.
        }
        if (deleted?.resumedFromRunId) {
          try {
            const source = await loadRun(deleted.resumedFromRunId, root);
            if (source.resumedByRunId === deleted.id) {
              delete source.resumedByRunId;
              await saveRun(source, root);
            }
          } catch {
            // A missing source run does not prevent deletion.
          }
        }
        if (deleted?.resumedByRunId) {
          try {
            const continuation = await loadRun(deleted.resumedByRunId, root);
            if (continuation.resumedFromRunId === deleted.id) {
              delete continuation.resumedFromRunId;
              await saveRun(continuation, root);
            }
          } catch {
            // A missing continuation run does not prevent deletion.
          }
        }
        await deleteRun(id, root);
        await deleteRunLog(root, id);
        return Response.json({ ok: true });
      }
    }

    // POST /api/runs/:id/cancel
    const runCancelMatch = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (runCancelMatch && request.method === "POST") {
      const id = runCancelMatch[1];
      const controller = runControllers.get(id);
      if (!controller) {
        try {
          const rec = await loadRun(id, root);
          if (rec.status === "running") {
            return Response.json({ error: "Run process is not active" }, { status: 409 });
          }
          return Response.json({ ok: true, status: rec.status });
        } catch {
          return Response.json({ error: "Run not found" }, { status: 404 });
        }
      }
      bridge.interactions.cancelPendingForRun(id, "run cancelled");
      bridge.terminalEvents.append({
        runId: id,
        stream: "system",
        chunk: "Run cancellation requested.\n",
      });
      controller.abort();
      bus.emit(`${id}:term`, {
        chunk: "Run cancellation requested.\n",
        stream: "system",
      });
      return Response.json({ ok: true, status: "cancelling" });
    }

    // GET /api/runs/:id/logs
    // No query → full array (back-compat). With ?tail=N or ?from=X&to=Y →
    // paginated `{ events, total, startIndex }` for lazy load.
    const runLogsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
    if (runLogsMatch && request.method === "GET") {
      const tailParam = url.searchParams.get("tail");
      const fromParam = url.searchParams.get("from");
      const toParam = url.searchParams.get("to");
      if (tailParam || fromParam || toParam) {
        const tail = tailParam ? Number.parseInt(tailParam, 10) : undefined;
        const from = fromParam ? Number.parseInt(fromParam, 10) : undefined;
        const to = toParam ? Number.parseInt(toParam, 10) : undefined;
        return Response.json(await listRunLogEventsRange(root, runLogsMatch[1], {
          ...(Number.isFinite(tail) ? { tail } : {}),
          ...(Number.isFinite(from) ? { from } : {}),
          ...(Number.isFinite(to) ? { to } : {}),
        }));
      }
      return Response.json(await listRunLogEvents(root, runLogsMatch[1]));
    }

    // GET /api/runs/:id/paused-nodes
    const runPausesMatch = pathname.match(/^\/api\/runs\/([^/]+)\/paused-nodes$/);
    if (runPausesMatch && request.method === "GET") {
      return Response.json(bridge.pauses.list(runPausesMatch[1]));
    }

    // POST /api/runs/:id/paused-nodes/:nodeId/prompt|continue
    const pausedActionMatch = pathname.match(/^\/api\/runs\/([^/]+)\/paused-nodes\/([^/]+)\/(prompt|continue)$/);
    if (pausedActionMatch && request.method === "POST") {
      const runId = decodeURIComponent(pausedActionMatch[1]);
      const nodeId = decodeURIComponent(pausedActionMatch[2]);
      let record: RunRecord;
      try {
        record = await loadRun(runId, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (record.status !== "running" || !bridge.pauses.get(runId, nodeId)) {
        return Response.json({ error: "Node is not currently authorized for paused interaction" }, { status: 409 });
      }
      try {
        if (pausedActionMatch[3] === "continue") {
          return Response.json({ ok: true, paused: bridge.pauses.continue(runId, nodeId) });
        }
        const body = await request.json() as { prompt?: unknown };
        if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
          return Response.json({ error: "Prompt must not be empty" }, { status: 400 });
        }
        return Response.json(await bridge.pauses.sendPrompt(runId, nodeId, body.prompt));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
    }

    // GET /api/agent-sessions  (optional ?workflowId=&agentServerId=)
    if (request.method === "GET" && pathname === "/api/agent-sessions") {
      const workflowId = url.searchParams.get("workflowId") ?? undefined;
      const agentServerId = url.searchParams.get("agentServerId") ?? undefined;
      return Response.json(await listAgentSessions(root, { workflowId, agentServerId }));
    }

    // GET /api/agent-sessions/:id
    const agentSessionMatch = pathname.match(/^\/api\/agent-sessions\/([^/]+)$/);
    if (agentSessionMatch && request.method === "GET") {
      try {
        return Response.json(await loadAgentSession(root, agentSessionMatch[1]));
      } catch {
        return Response.json({ error: "Agent session not found" }, { status: 404 });
      }
    }

    // POST /api/agent-sessions/:id/restore
    const agentSessionRestoreMatch = pathname.match(/^\/api\/agent-sessions\/([^/]+)\/restore$/);
    if (agentSessionRestoreMatch && request.method === "POST") {
      let body: { mode?: AgentRestoreMode } = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const mode = body.mode;
      if (mode !== "inspect" && mode !== "continue") {
        return Response.json({ error: "Invalid restore mode" }, { status: 400 });
      }
      return handleRestore(agentSessionRestoreMatch[1], mode);
    }

    // GET /api/agent-session-restores/:id/events
    const restoreEventsMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/events$/);
    if (restoreEventsMatch && request.method === "GET") {
      return restoreSseResponse(restoreEventsMatch[1]);
    }

    // POST /api/agent-session-restores/:id/cancel
    const restoreCancelMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/cancel$/);
    if (restoreCancelMatch && request.method === "POST") {
      const restoreId = restoreCancelMatch[1];
      const controller = restoreControllers.get(restoreId);
      if (!controller) {
        const active = activeConversations.get(restoreId);
        if (active) {
          activeConversations.delete(restoreId);
          await closeActiveConversation(active);
          return Response.json({ ok: true, status: "closed" });
        }
        const state = restoreStreams.get(restoreId);
        if (!state) return Response.json({ error: "Restore not found" }, { status: 404 });
        return Response.json({ ok: true, status: state.done ? "done" : "inactive" });
      }
      controller.abort();
      const active = activeConversations.get(restoreId);
      activeConversations.delete(restoreId);
      if (active) void closeActiveConversation(active, "Restore cancelled.");
      return Response.json({ ok: true, status: "cancelling" });
    }

    // POST /api/agent-session-restores/:id/prompt
    const restorePromptMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/prompt$/);
    if (restorePromptMatch && request.method === "POST") {
      const restoreId = restorePromptMatch[1];
      const active = activeConversations.get(restoreId);
      if (!active) return Response.json({ error: "Interactive restored session is not active" }, { status: 409 });
      if (active.promptPending) return Response.json({ error: "A prompt is already running" }, { status: 409 });
      let body: { prompt?: unknown };
      try {
        body = await request.json() as { prompt?: unknown };
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
        return Response.json({ error: "Prompt must not be empty" }, { status: 400 });
      }
      active.promptPending = true;
      const promptController = new AbortController();
      active.promptController = promptController;
      try {
        const result = await active.conversation.prompt(body.prompt, promptController.signal);
        await active.waitForLogWrites();
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      } finally {
        active.promptController = undefined;
        active.promptPending = false;
      }
    }

    // POST /api/agent-session-restores/:id/close
    const restoreCloseMatch = pathname.match(/^\/api\/agent-session-restores\/([^/]+)\/close$/);
    if (restoreCloseMatch && request.method === "POST") {
      const active = activeConversations.get(restoreCloseMatch[1]);
      activeConversations.delete(restoreCloseMatch[1]);
      if (active) await closeActiveConversation(active);
      return Response.json({ ok: true });
    }

    // POST /api/runs/:id/interactions/:interactionId/respond
    const interactionRespondMatch = pathname.match(/^\/api\/runs\/([^/]+)\/interactions\/([^/]+)\/respond$/);
    if (interactionRespondMatch && request.method === "POST") {
      const runId = interactionRespondMatch[1];
      const interactionId = interactionRespondMatch[2];
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      try {
        const existing = bridge.interactions.get(interactionId);
        if (!existing) {
          return Response.json({ error: "Interaction not found" }, { status: 404 });
        }
        if (existing.runId !== runId) {
          return Response.json({ error: "Interaction belongs to another run" }, { status: 409 });
        }
        const interaction = bridge.interactions.resolve(interactionId, body);
        return Response.json({ ok: true, interaction });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes("Unknown interaction") ? 404 : 409;
        return Response.json({ error: message }, { status });
      }
    }

    // GET /api/runs/:id/resumable-session — find the agent session most appropriate for resuming
    const resumableMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resumable-session$/);
    if (resumableMatch && request.method === "GET") {
      const id = resumableMatch[1];
      try {
        const record = await loadRun(id, root);
        // Pre-fix runs that crashed mid-flight never persisted their invocations,
        // and invocations that reused an existing ACP session may have been
        // written without an acpSessionId. The session index (record.agentSessions)
        // may also be stale from an earlier partial repair. Rebuild from the log
        // and merge missing fields back into the record.
        const empty = !record.agentInvocations?.length;
        const needsEnrichment = !empty && record.agentInvocations.some((inv) => !inv.acpSessionId);
        const coveredInvocations = new Set(record.agentSessions?.flatMap((s) => s.invocationIds ?? []) ?? []);
        const sessionsOutOfSync = !empty && record.agentInvocations.some((inv) => !coveredInvocations.has(inv.id));
        if (empty || needsEnrichment) {
          const reconstructed = await reconstructInvocationsFromRunLog(root, record);
          if (reconstructed.length > 0) {
            if (empty) {
              record.agentInvocations = reconstructed;
            } else {
              const byId = new Map(record.agentInvocations.map((inv) => [inv.id, inv]));
              for (const inv of reconstructed) {
                const existing = byId.get(inv.id);
                if (!existing) {
                  record.agentInvocations.push(inv);
                  continue;
                }
                if (!existing.acpSessionId && inv.acpSessionId) existing.acpSessionId = inv.acpSessionId;
                if (!existing.parentSessionId && inv.parentSessionId) existing.parentSessionId = inv.parentSessionId;
                // Older invocation rows could be saved without agentServerId/agentId
                // (e.g. legacy code paths). buildAgentSessionsForRun silently drops
                // invocations missing those fields, so backfill from the log too.
                if (!existing.agentServerId && inv.agentServerId) existing.agentServerId = inv.agentServerId;
                if (!existing.agentId && inv.agentId) existing.agentId = inv.agentId;
                if (existing.status === "running" && (inv.status === "done" || inv.status === "failed")) {
                  existing.status = inv.status;
                  if (!existing.completedAt && inv.completedAt) existing.completedAt = inv.completedAt;
                }
              }
            }
            await saveRun(record, root);
            await upsertAgentSessionsFromRun(record, root);
          }
        } else if (sessionsOutOfSync) {
          // Invocations are healthy but the session index is stale (e.g. from
          // a partial repair on a previous server version). Just re-derive.
          await upsertAgentSessionsFromRun(record, root);
        }
        const suggested = pickResumableInvocation(record);
        if (!suggested) {
          return Response.json({ error: "No resumable agent session found for this run" }, { status: 404 });
        }
        const sessions = await listAgentSessions(root, { workflowId: record.workflowId });
        const session = sessions.find((candidate) => candidate.invocationIds.includes(suggested.id));
        if (!session) {
          return Response.json({ error: "Agent session record is missing for the last incomplete step" }, { status: 404 });
        }
        const node = suggested.nodeId
          ? record.agentflowSnapshot.nodes.find((n) => n.id === suggested.nodeId)
          : undefined;
        const continuationPrompt = buildContinuationPrompt({
          nodeTitle: node && "title" in node ? node.title : suggested.nodeId,
          invocationStatus: suggested.status,
          runStatus: record.status,
          errorMsg: record.errorMsg,
        });
        return Response.json({
          agentSessionId: session.id,
          acpSessionId: session.acpSessionId,
          agentServerId: session.agentServerId,
          nodeId: suggested.nodeId,
          continuationPrompt,
          canLoad: session.acpSupportsLoadSession,
          canResume: session.acpSupportsResumeSession,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes("not found") ? 404 : 500;
        return Response.json({ error: message }, { status });
      }
    }

    // POST /api/runs/:id/resume-workflow — start a new run that picks up where
    // the source run left off: completed nodes get short-circuited with their
    // recorded outputs, interrupted nodes are re-invoked with a continuation
    // prompt against their existing ACP sessions.
    const resumeWorkflowMatch = pathname.match(/^\/api\/runs\/([^/]+)\/resume-workflow$/);
    if (resumeWorkflowMatch && request.method === "POST") {
      const id = resumeWorkflowMatch[1];
      let source: RunRecord;
      try {
        source = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      if (source.status === "running") {
        return Response.json({ error: "Cannot resume a run that is still running" }, { status: 409 });
      }
      if (source.status !== "cancelled" && source.status !== "error") {
        return Response.json({ error: "Only cancelled or failed runs can be resumed" }, { status: 409 });
      }
      if (source.resumedByRunId) {
        return Response.json({
          error: "This run has already been resumed",
          resumedByRunId: source.resumedByRunId,
        }, { status: 409 });
      }
      if (resumeRequests.has(source.id)) {
        return Response.json({ error: "A resume for this run is already being started" }, { status: 409 });
      }
      const layout = source.canvasSnapshot;
      const agentflow = source.agentflowSnapshot;
      if (!agentflow || !layout) {
        return Response.json({ error: "Run snapshot is missing; cannot resume" }, { status: 409 });
      }
      resumeRequests.add(source.id);
      try {
        const state = await buildResumeStateFromRun(root, source);
        return await handleRun(
          source.workflowId,
          source.initialInput,
          source.variableValues,
          { agentflow, layout },
          { state, source },
        );
      } finally {
        resumeRequests.delete(source.id);
      }
    }

    // POST /api/runs/:id/rerun — re-execute the snapshot of an existing run
    const rerunMatch = pathname.match(/^\/api\/runs\/([^/]+)\/rerun$/);
    if (rerunMatch && request.method === "POST") {
      const id = rerunMatch[1];
      let prior;
      try {
        prior = await loadRun(id, root);
      } catch {
        return Response.json({ error: "Run not found" }, { status: 404 });
      }
      let body: { initialInput?: string; variableValues?: Record<string, string> } = {};
      try { body = await request.json(); } catch { /* ok */ }
      // Fall back to the prior run's values when not overridden.
      return handleRun(
        prior.workflowId,
        body.initialInput ?? prior.initialInput,
        body.variableValues ?? prior.variableValues,
        {
          agentflow: prior.agentflowSnapshot,
          layout: prior.canvasSnapshot,
        },
      );
    }

    // GET /api/runs/:id/events  (SSE)
    const eventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (eventsMatch && request.method === "GET") {
      const replay = url.searchParams.get("replay") !== "false";
      return sseResponse(eventsMatch[1], { replay });
    }

    return null; // not handled
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeAssetPath(name: string): string {
  const parts = name.replaceAll("\\", "/").split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_")).join("/") || `asset-${uuidv7()}`;
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".bin";
}
