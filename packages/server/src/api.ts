import { WorkflowExecutor } from "@specflow/bridge";
import type { SpecflowBridge } from "@specflow/bridge";
import type { AgentRestoreMode, AgentRestorePrimitive, NodeStatusEvent, RunStatusEvent } from "@specflow/bridge";
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
  removeRunFromAgentSessions,
  upsertAgentSessionsFromRun,
} from "./agent-session-store";
import { appendRunLogEvent, deleteRunLog, listRunLogEvents } from "./run-log-store";
import { prepareCanvasRun } from "./run-inputs";
import type { AgentFlowDoc, CanvasDoc, CanvasLayoutDoc } from "./canvas-doc";
import type { CanvasSession } from "./canvas-doc";

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
    };

interface RestoreStreamState {
  events: RestoreStreamEvent[];
  done: boolean;
}

// ── API handler factory ───────────────────────────────────────────────────────

export function createApiHandler(bridge: SpecflowBridge, root: string) {
  const bus = new EventBus();
  const restoreStreams = new Map<string, RestoreStreamState>();

  const DEFAULT_SESSION: CanvasSession = {
    id: "s1",
    name: "main",
    color: "oklch(0.7 0.13 250)",
    agentServerId: "codex-acp",
  };

  function publishRestoreEvent(event: RestoreStreamEvent): void {
    const state = restoreStreams.get(event.restoreId) ?? { events: [], done: false };
    state.events.push(event);
    if (event.type === "restore-status" && event.status !== "requested") {
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
          if (restoreEvent.type === "restore-status" && restoreEvent.status !== "requested") {
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
      } catch {
        return Response.json({ error: "Agentflow not found" }, { status: 404 });
      }
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
    const runId = crypto.randomUUID();
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
      agent: agentflow.sessions[0]?.agentServerId ?? agentflow.sessions[0]?.agent ?? "codex-acp",
      nodeStates: initialNodeStates,
      nodeOutputs: {},
      agentInvocations: [],
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
      appendLog({ type: "interaction", ...interaction });
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
        e.status === "running" ? "running" : "pending";

      if (e.status === "running") {
        currentNodeId = e.nodeId;
      }

      record.nodeStates[e.nodeId] = uiStatus;
      if (uiStatus === "running") record.activeNode = e.nodeId;

      if (e.status === "done" && (e as NodeStatusEvent & { output?: string }).output) {
        record.nodeOutputs[e.nodeId] = (e as NodeStatusEvent & { output?: string }).output!;
      }

      void saveRun(record, root);
      appendLog({ type: "node_status", ...e });
      bus.emit(`${runId}:node`, { nodeId: e.nodeId, status: uiStatus, runId });
      flushTerminalEvents();
    };

    const onRunStatus = (e: RunStatusEvent) => {
      const completedAt = new Date().toISOString();
      record.completedAt = completedAt;
      record.duration = formatDuration(record.startedAt, completedAt);

      if (e.status === "done") {
        record.status = "success";
      } else if (e.status === "failed") {
        record.status = "error";
        record.errorMsg = e.error;
      }
      flushTerminalEvents();
      if (record.status !== "running") {
        bridge.interactions.cancelPendingForRun(runId, `run ${record.status}`);
      }
      void saveRun(record, root);
      appendLog({ type: "run_status", ...e });
      bus.emit(`${runId}:run`, { runId, status: record.status, workflowId });
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
    });

    void executor.run(workflow, prepared.initialInput, { runId })
      .then(async (workflowRun) => {
        await logWrite;
        record.agentInvocations = workflowRun.agentInvocations;
        await saveRun(record, root);
        await upsertAgentSessionsFromRun(record, root);
      })
      .catch(() => { /* handled via onRunStatus */ });

    return Response.json({ runId });
  }

  async function handleRestore(agentSessionId: string, mode: AgentRestoreMode): Promise<Response> {
    let session: Awaited<ReturnType<typeof loadAgentSession>>;
    try {
      session = await loadAgentSession(root, agentSessionId);
    } catch {
      return Response.json({ error: "Agent session not found" }, { status: 404 });
    }

    const restoreId = crypto.randomUUID();
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

    void bridge.restoreAgentSession({
      agentServerId: session.agentServerId,
      sessionId: session.acpSessionId,
      mode,
      cwd: root,
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
      let body: { name?: string } = {};
      try { body = await request.json(); } catch { /* ok */ }
      const id = `wf${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const doc: CanvasDoc = {
        id,
        name: body.name ?? "Untitled workflow",
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
        } catch {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
      }
      if (request.method === "PUT") {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        await saveCanvas(id, body, root);
        return Response.json({ ok: true });
      }
      if (request.method === "DELETE") {
        await deleteCanvas(id, root);
        return Response.json({ ok: true });
      }
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
        await removeRunFromAgentSessions(id, root);
        await deleteRunLog(root, id);
        return Response.json({ ok: true });
      }
    }

    // GET /api/runs/:id/logs
    const runLogsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/logs$/);
    if (runLogsMatch && request.method === "GET") {
      return Response.json(await listRunLogEvents(root, runLogsMatch[1]));
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
