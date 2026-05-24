import { WorkflowExecutor } from "@specflow/bridge";
import type { SpecflowBridge } from "@specflow/bridge";
import type { AgentAuthenticationStatus, AgentConversation, AgentRestoreMode, AgentRestorePrimitive, AgentServerEntry, AgentServerSettings, NodeStatusEvent, RunInteraction, RunInteractionContext, RunStatusEvent } from "@specflow/bridge";
import { supportedRegistryAgentProfile } from "@specflow/bridge";
import { uuidv7 } from "@specflow/shared";
import { canvasToWorkflow } from "./canvas-to-workflow";
import {
  listCanvases,
  loadCanvas,
  loadAgentFlow,
  loadOrCreateCanvasLayout,
  saveCanvas,
  deleteCanvas,
} from "./canvas-store";
import { formatDuration, listRuns, loadRun, saveRun, deleteRun, type RunRecord, type RunState } from "./run-store";
import {
  listAgentSessions,
  loadAgentSession,
  recordAgentSessionRestoreAttempt,
  upsertAgentSessionsFromRun,
} from "./agent-session-store";
import { appendRunLogEvent, deleteRunLog, listRunLogEvents } from "./run-log-store";
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
}

function closesRestoreStream(event: RestoreStreamEvent): boolean {
  return event.type === "restore-status"
    && (event.status === "failure" || (event.status === "success" && event.requestedMode === "inspect"));
}

function parseAgentServerSettings(input: unknown): AgentServerSettings | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const env = recordOfStrings(raw.env);
  const additionalDirectories = arrayOfStrings(raw.additionalDirectories ?? raw.additional_directories);
  const terminal = terminalPolicy(raw.terminal);
  const defaultMode = typeof raw.defaultMode === "string" ? raw.defaultMode : undefined;
  const defaultModel = typeof raw.defaultModel === "string" ? raw.defaultModel : undefined;
  const defaultConfigOptions = recordOfConfigValues(raw.defaultConfigOptions);

  if (raw.type === "registry" && typeof raw.registryId === "string" && raw.registryId.trim()) {
    if (!supportedRegistryAgentProfile(raw.registryId.trim())) return undefined;
    return {
      type: "registry",
      registryId: raw.registryId.trim(),
      installedVersion: typeof raw.installedVersion === "string" ? raw.installedVersion : undefined,
      env,
      additionalDirectories,
      terminal,
      defaultMode,
      defaultModel,
      defaultConfigOptions,
    };
  }
  if (raw.type === "custom" && typeof raw.command === "string" && raw.command.trim()) {
    return {
      type: "custom",
      command: raw.command.trim(),
      args: arrayOfStrings(raw.args),
      env,
      additionalDirectories,
      terminal,
      defaultMode,
      defaultModel,
      defaultConfigOptions,
    };
  }
  if (raw.type === "headless" && typeof raw.command === "string" && raw.command.trim()) {
    return {
      type: "headless",
      command: raw.command.trim(),
      argsTemplate: arrayOfStrings(raw.argsTemplate),
      env,
      additionalDirectories,
      terminal,
      defaultMode,
      defaultModel,
      defaultConfigOptions,
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

function recordOfConfigValues(value: unknown): Record<string, string | boolean> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | boolean] =>
      typeof entry[1] === "string" || typeof entry[1] === "boolean",
    ),
  );
}

function terminalPolicy(value: unknown): AgentServerSettings["terminal"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.auth === "boolean" ? { auth: raw.auth } : {}),
  };
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

async function ensureRegistryAgentServersInstalled(
  bridge: SpecflowBridge,
  root: string,
  entries: AgentServerEntry[],
): Promise<void> {
  await Promise.all(entries
    .filter((entry) => entry.settings.type === "registry")
    .map((entry) => bridge.ensureAgentServerInstalled(root, entry.id)));
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

// ── API handler factory ───────────────────────────────────────────────────────

export function createApiHandler(bridge: SpecflowBridge, root: string) {
  const bus = new EventBus();
  const restoreStreams = new Map<string, RestoreStreamState>();
  const restoreControllers = new Map<string, AbortController>();
  const activeConversations = new Map<string, ActiveConversation>();
  const runControllers = new Map<string, AbortController>();

  async function closeActiveConversation(active: ActiveConversation, reason = "Restored conversation closed."): Promise<void> {
    active.promptController?.abort();
    active.stopInteractionEvents();
    for (const interaction of bridge.interactions.list({ status: "pending" })) {
      if (interaction.agentInvocationId === active.interactionInvocationId) {
        bridge.interactions.cancel(interaction.id, reason);
      }
    }
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

  function sseResponse(runId: string): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (type: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

        enqueue("hello", { runId });

        for (const event of await listRunLogEvents(root, runId)) {
          if (event.type === "terminal") {
            enqueue("terminal", {
              chunk: event.chunk,
              stream: event.stream,
              nodeId: event.nodeId,
              agentInvocationId: event.agentInvocationId,
              replay: true,
            });
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

        for (const interaction of bridge.interactions.list({ runId, status: "pending" })) {
          enqueue("interaction-requested", interaction);
        }

        cleanup = () => {
          offNode(); offRun(); offTerm(); offInteraction();
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

    const record: RunRecord = {
      id: runId,
      workflowId,
      label,
      status: "running",
      startedAt: new Date().toISOString(),
      agent: agentflow.sessions[0]?.agentServerId ?? agentflow.sessions[0]?.agent ?? "unconfigured",
      nodeStates: initialNodeStates,
      nodeOutputs: {},
      agentInvocations: [],
      agentSessions: [],
      agentflowSnapshot: agentflow, // store pre-substitution snapshots
      canvasSnapshot: layout,
      initialInput,
      variableValues,
    };

    await saveRun(record, root);
    await appendRunLogEvent(root, {
      type: "run_status",
      runId,
      workflowId,
      status: "running",
      at: record.startedAt,
    });

    let lastTermSeq = 0;
    let currentNodeId: string | undefined;
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
          const event = { type: "terminal" as const, ...te, nodeId: currentNodeId };
          appendLog(event);
          bus.emit(`${runId}:term`, {
            chunk: te.chunk,
            stream: te.stream,
            nodeId: currentNodeId,
            agentInvocationId: te.agentInvocationId,
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
      bus.emit(`${runId}:node`, { nodeId: e.nodeId, status: uiStatus, runId });
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
      interactions: bridge.interactions,
      pauses: bridge.pauses,
    });

    void executor.run(workflow, prepared.initialInput, { runId, signal: runController.signal })
      .then(async (workflowRun) => {
        await logWrite;
        record.agentInvocations = workflowRun.agentInvocations;
        await saveRun(record, root);
        await upsertAgentSessionsFromRun(record, root);
      })
      .catch(() => { /* handled via onRunStatus */ })
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
        publishRestoreEvent({
          type: "session-update",
          restoreId,
          agentSessionId: session.id,
          sessionId: event.sessionId,
          update: event.update,
          at: new Date().toISOString(),
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
        });
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
      try {
        await ensureRegistryAgentServersInstalled(bridge, root, entries);
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
      }
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
      let body: { env?: Record<string, unknown> } = {};
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      const env = recordOfStrings(body.env);
      if (env && Object.keys(env).length > 0) {
        const current = (await bridge.listAgentServers(root)).find((entry) => entry.id === id);
        if (!current) {
          return Response.json({ error: "Agent server not found" }, { status: 404 });
        }
        await upsertLocalAgentServer(root, id, {
          ...current.settings,
          env: { ...(current.settings.env ?? {}), ...env },
        } as AgentServerSettings);
      }

      try {
        return Response.json(await bridge.authenticateAgentServer(root, id, methodId));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 409 });
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
      await upsertLocalAgentServer(root, decodeURIComponent(agentServerMatch[1]), settings);
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
    }

    // DELETE /api/agent-servers/:id
    if (agentServerMatch && request.method === "DELETE") {
      await removeLocalAgentServer(root, decodeURIComponent(agentServerMatch[1]));
      return Response.json(redactAgentServerEntries(await listAgentServerEntries(bridge, root)));
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
      const base = join(root, ".specflow", "assets", workflowId, kind === "image" ? "images" : "resources");
      await mkdir(base, { recursive: true });
      if (kind === "image") {
        const images: Array<{ path: string; label: string; mimeType?: string }> = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) return Response.json({ error: "Images only" }, { status: 400 });
          const extension = extname(file.name) || mimeExtension(file.type);
          const filename = `${uuidv7()}${extension}`;
          await writeFile(join(base, filename), new Uint8Array(await file.arrayBuffer()));
          images.push({
            path: `.specflow/assets/${workflowId}/images/${filename}`,
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
          ? `.specflow/assets/${workflowId}/resources/${safePath.split("/")[0]}/`
          : `.specflow/assets/${workflowId}/resources/${safePath}`);
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
    const runLogsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
    if (runLogsMatch && request.method === "GET") {
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
        return Response.json(await active.conversation.prompt(body.prompt, promptController.signal));
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
      return sseResponse(eventsMatch[1]);
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
