import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { WorkflowNode, Edge, Session, Workflow, Run, Selection, RunStateMap, Theme, RunStatus, LogLine, InputNode } from './types';
import { isSymbolKey } from './appearance';
import {
  fetchCanvases, fetchCanvas, saveCanvas, uploadCanvasAssets, runCanvas,
  fetchRuns, fetchRun, fetchRunLogs, subscribeToRun,
  createCanvas, deleteRun as apiDeleteRun, rerunRun as apiRerunRun,
  cancelRun as apiCancelRun,
  fetchAgentSessions, fetchAgentServers, restoreAgentSession, subscribeToRestore,
  promptRestoredSession, closeRestoredSession, cancelRestoredSession, fetchPausedNodes, promptPausedNode, continuePausedNode,
  apiRunToUiRun, apiRunLogsToLogLines, summaryToWorkflow, respondToRunInteraction,
  AgentAuthenticationRequiredError,
  type SseEventType,
  type AgentAuthenticationStatus,
  type RunInteraction,
  type AgentSessionRecord,
  type AgentServerEntry,
  type RestoreMode,
  type RestoreSseEventType,
  type RestoreStreamEvent,
  type PausedNodeSession,
} from './api';
import { TopBar } from './components/top-bar';
import { Sidebar } from './components/sidebar';
import { Canvas } from './components/canvas';
import { NodePanel } from './components/node-panel';
import { ConnectionPanel } from './components/connection-panel';
import { SessionsBar } from './components/sessions-bar';
import { RunConfigPanel } from './components/run-config-panel';
import { InteractionModal } from './components/interaction-modal';
import { AgentAuthModal } from './components/agent-auth-modal';
import { AgentServerManager } from './components/agent-server-manager';
import { AgentConversationWindow, type ConversationLine } from './components/agent-conversation-window';
import { normalizeTransferConfiguration, resolveTransferSource } from './edge-semantics';

function runStatusFromEvent(status: string): RunStatus {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'done') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

export function App() {
  const [activeWorkflow, setActiveWorkflow] = useState('wf1');
  const [activeCanvasName, setActiveCanvasName] = useState('');

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  const [activeRunId, setActiveRunId] = useState('');
  const activeRun = runs.find((r) => r.id === activeRunId);

  const [historicNodeStates, setHistoricNodeStates] = useState<RunStateMap>({});
  const [liveNodeStates, setLiveNodeStates] = useState<RunStateMap>({});
  const runState = useMemo<RunStateMap>(() => ({ ...historicNodeStates, ...liveNodeStates }), [historicNodeStates, liveNodeStates]);

  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [agentSessions, setAgentSessions] = useState<AgentSessionRecord[]>([]);
  const [agentServers, setAgentServers] = useState<AgentServerEntry[]>([]);
  const [restoreStatusBySession, setRestoreStatusBySession] = useState<Record<string, string>>({});
  const [conversation, setConversation] = useState<{
    session: AgentSessionRecord;
    mode: RestoreMode;
    restoreId?: string;
    status: string;
    lines: ConversationLine[];
    canPrompt: boolean;
    busy: boolean;
  } | null>(null);
  const [pausedNode, setPausedNode] = useState<PausedNodeSession | null>(null);
  const [pausedLines, setPausedLines] = useState<ConversationLine[]>([]);
  const [pausedPromptBusy, setPausedPromptBusy] = useState(false);

  const [selection, setSelection]             = useState<Selection | null>(null);
  const [zoom, setZoom]                       = useState(1);
  const [pan, setPan]                         = useState({ x: 0, y: 0 });
  const [barExpanded, setBarExpanded]         = useState(false);
  const [barHeight, setBarHeight]             = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('sf-bar-h') ?? '', 10);
      return Number.isFinite(saved) ? Math.min(600, Math.max(120, saved)) : 252;
    } catch { return 252; }
  });
  const [activeSessionId, setActiveSessionId] = useState('');
  const [addSessionPing, setAddSessionPing]   = useState(0);
  const [theme, setTheme]                     = useState<Theme>('light');

  // Run config panel state
  const [runConfigOpen, setRunConfigOpen]     = useState(false);
  const [runConfigVars, setRunConfigVars]     = useState<Record<string, string>>({});
  const [runConfigBusy, setRunConfigBusy]     = useState(false);
  const [runStartBusy, setRunStartBusy]       = useState(false);
  const [pendingInteractions, setPendingInteractions] = useState<RunInteraction[]>([]);
  const [agentServerManagerOpen, setAgentServerManagerOpen] = useState(false);
  const [authStatuses, setAuthStatuses] = useState<AgentAuthenticationStatus[]>([]);

  // viewMode is derived from selection: viewing a run → run view (readonly).
  const view: 'edit' | 'run' = activeRunId ? 'run' : 'edit';

  // displayDoc: render the run's snapshot when in run view, else the live doc.
  const displayNodes: WorkflowNode[]  = (activeRun?.canvasSnapshot?.nodes  as WorkflowNode[]) ?? nodes;
  const displayEdges: Edge[]          = (activeRun?.canvasSnapshot?.edges  as Edge[])         ?? edges;
  const displaySessions: Session[]    = (activeRun?.canvasSnapshot?.sessions as Session[])    ?? sessions;

  // Variables are derived from InputNodes — both in edit and run view.
  const variables = useMemo(
    () => nodes.filter((n): n is InputNode => n.kind === 'input')
              .map((n) => ({ name: n.variableName, defaultValue: n.defaultValue, description: n.description })),
    [nodes],
  );
  const displayVariables = useMemo(
    () => displayNodes.filter((n): n is InputNode => n.kind === 'input')
                      .map((n) => ({ name: n.variableName, defaultValue: n.defaultValue, description: n.description })),
    [displayNodes],
  );
  const hasAgentUpdates = useMemo(
    () => agentServers.some((server) => server.registry?.updateAvailable),
    [agentServers],
  );

  const nodesRef     = useRef(nodes);
  const edgesRef     = useRef(edges);
  const sessionsRef  = useRef(sessions);
  const resumeAfterAuthRef = useRef<undefined | (() => void | Promise<void>)>(undefined);
  const restoreUnsubscribeRef = useRef<undefined | (() => void)>(undefined);
  const restoreRequestTokenRef = useRef(0);
  const conversationRef = useRef(conversation);
  useEffect(() => { nodesRef.current     = nodes;     }, [nodes]);
  useEffect(() => { edgesRef.current     = edges;     }, [edges]);
  useEffect(() => { sessionsRef.current  = sessions;  }, [sessions]);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);

  const terminateConversation = useCallback((active: typeof conversation) => {
    restoreUnsubscribeRef.current?.();
    restoreUnsubscribeRef.current = undefined;
    if (!active?.restoreId) return;
    const terminate = active.mode === 'continue' && active.status === 'success'
      ? closeRestoredSession(active.restoreId)
      : cancelRestoredSession(active.restoreId);
    void terminate.catch(console.error);
  }, []);

  useEffect(() => () => {
    terminateConversation(conversationRef.current);
  }, [terminateConversation]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load canvases list once
  useEffect(() => {
    fetchCanvases().then((list) => {
      setWorkflows(list.map(summaryToWorkflow));
    }).catch(console.error);
  }, []);

  // Load active canvas + runs whenever workflow changes
  useEffect(() => {
    fetchCanvas(activeWorkflow).then((doc) => {
      setNodes(doc.nodes as WorkflowNode[]);
      setEdges(doc.edges as Edge[]);
      setSessions(doc.sessions as Session[]);
      setActiveCanvasName(doc.name);
      if (doc.sessions[0]) setActiveSessionId(doc.sessions[0].id);
      setSelection(null);
    }).catch(console.error);

    fetchRuns(activeWorkflow).then((records) => {
      const uiRuns = records.map(apiRunToUiRun);
      setRuns(uiRuns);
    }).catch(console.error);
    fetchAgentSessions({ workflowId: activeWorkflow }).then(setAgentSessions).catch(console.error);
    fetchAgentServers().then(setAgentServers).catch(console.error);
    // Clicking a workflow always returns to workflow-edit (no run selected).
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setRestoreStatusBySession({});
    restoreRequestTokenRef.current += 1;
    terminateConversation(conversationRef.current);
    setConversation(null);
    setPausedNode(null);
    setPausedLines([]);
    setPendingInteractions([]);
  }, [activeWorkflow, terminateConversation]);

  // ── debounced save ────────────────────────────────────────────────────────

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const doc = {
        id: activeWorkflow,
        name: activeCanvasName,
        sessions: sessionsRef.current,
        nodes: nodesRef.current,
        edges: edgesRef.current,
      };
      saveCanvas(activeWorkflow, doc).catch(console.error);
    }, 300);
  }, [activeWorkflow, activeCanvasName]);

  // ── canvas edit handlers ──────────────────────────────────────────────────

  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setNodes((ns) => {
      const updated = ns.map((n) => n.id === id ? { ...n, x, y } : n);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditNode = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes((ns) => {
      const updated = ns.map((n) => n.id === id ? { ...n, ...patch } as WorkflowNode : n);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onChangeSession = useCallback((id: string, sid: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== id || n.kind !== 'step') return n;
        return { ...n, sessionId: sid };
      });
      nodesRef.current = updated;
      setEdges((current) => {
        const normalized = normalizeTransferConfiguration(current, updated);
        edgesRef.current = normalized;
        return normalized;
      });
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddBranch = useCallback((gateId: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== gateId || n.kind !== 'gate') return n;
        let suffix = n.branches.length + 1;
        let id = `branch-${suffix}`;
        while (n.branches.some((branch) => branch.id === id)) {
          suffix += 1;
          id = `branch-${suffix}`;
        }
        const newBranch = { id, label: id };
        return { ...n, branches: [...n.branches, newBranch] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditBranch = useCallback((gateId: string, branchId: string, patch: { label?: string; description?: string }) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== gateId || n.kind !== 'gate') return n;
        return { ...n, branches: n.branches.map((b) => b.id === branchId ? { ...b, ...patch } : b) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteBranch = useCallback((gateId: string, branchId: string) => {
    const gate = nodesRef.current.find((node): node is Extract<WorkflowNode, { kind: 'gate' }> => node.kind === 'gate' && node.id === gateId);
    if (!gate || gate.branches.length <= 1) return;
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== gateId || n.kind !== 'gate') return n;
        return { ...n, branches: n.branches.filter((b) => b.id !== branchId) };
      });
      nodesRef.current = updated;
      return updated;
    });
    setEdges((es) => {
      const updated = es.filter((e) => !(e.from === gateId && e.branch === branchId));
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddPath = useCallback((nodeId: string, path = '') => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, paths: [...(n.paths ?? []), path] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditPath = useCallback((nodeId: string, index: number, value: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        const paths = [...(n.paths ?? [])];
        paths[index] = value;
        return { ...n, paths };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeletePath = useCallback((nodeId: string, index: number) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, paths: (n.paths ?? []).filter((_, i) => i !== index) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onUploadImages = useCallback(async (nodeId: string, files: File[]) => {
    const uploaded = await uploadCanvasAssets(activeWorkflow, 'image', files);
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, images: [...(n.images ?? []), ...(uploaded.images ?? [])] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [activeWorkflow, scheduleSave]);

  const onDeleteImage = useCallback((nodeId: string, index: number) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, images: (n.images ?? []).filter((_, i) => i !== index) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onImportPaths = useCallback(async (nodeId: string, files: File[], directory: boolean) => {
    if (!files.length) return;
    const uploaded = await uploadCanvasAssets(activeWorkflow, 'path', files, directory);
    setNodes((ns) => {
      const updated = ns.map((node) => node.id === nodeId && node.kind === 'step'
        ? { ...node, paths: [...(node.paths ?? []), ...uploaded.paths] }
        : node);
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [activeWorkflow, scheduleSave]);

  const onEditEdge = useCallback((id: string, patch: Partial<Edge>) => {
    setEdges((es) => {
      const updated = es.map((e) => e.id === id ? { ...e, ...patch } : e);
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteEdge = useCallback((id: string) => {
    setEdges((es) => {
      const updated = es.filter((e) => e.id !== id);
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  // ── node/edge create (from canvas) ────────────────────────────────────────

  const onAddNode = useCallback((node: WorkflowNode) => {
    setNodes((ns) => {
      const updated = [...ns, node];
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onAddEdge = useCallback((edge: Edge) => {
    setEdges((es) => {
      const updated = [...es, edge];
      edgesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteNode = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    if ((node as WorkflowNode & { locked?: boolean }).locked) return;
    if (!window.confirm(`Delete node "${node.title}"?`)) return;
    const updatedNodes = nodesRef.current.filter((n) => n.id !== id);
    const updatedEdges = edgesRef.current.filter((e) => e.from !== id && e.to !== id);
    nodesRef.current = updatedNodes;
    edgesRef.current = updatedEdges;
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setSelection(null);
    scheduleSave();
  }, [scheduleSave]);

  // ── session management ────────────────────────────────────────────────────

  const onAddSession = useCallback((name: string, agentServerId: Session['agentServerId']) => {
    setSessions((ss) => {
      const id = name.trim();
      if (!isSymbolKey(id) || ss.some((session) => session.id === id)) return ss;
      const updated = [...ss, { id, name: id, agentServerId }];
      sessionsRef.current = updated;
      setActiveSessionId(id);
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteSession = useCallback((id: string) => {
    if (sessionsRef.current.length <= 1) return;
    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    const fallback = remaining[0]?.id ?? null;
    const updatedNodes = nodesRef.current.map((n) =>
      n.kind === 'step' && n.sessionId === id ? { ...n, sessionId: fallback } as WorkflowNode : n,
    );
    sessionsRef.current = remaining;
    nodesRef.current    = updatedNodes;
    const updatedEdges = normalizeTransferConfiguration(edgesRef.current, updatedNodes);
    edgesRef.current = updatedEdges;
    setSessions(remaining);
    setActiveSessionId(fallback ?? '');
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    scheduleSave();
  }, [scheduleSave]);

  const onEditSession = useCallback((id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => {
    const nextId = patch.name?.trim() ?? id;
    if (!isSymbolKey(nextId) || sessionsRef.current.some((session) => session.id === nextId && session.id !== id)) {
      return;
    }
    const updated = sessionsRef.current.map((session) =>
      session.id === id ? { ...session, ...patch, id: nextId, name: nextId } : session,
    );
    const updatedNodes = nodesRef.current.map((node) =>
      node.kind === 'step' && node.sessionId === id ? { ...node, sessionId: nextId } as WorkflowNode : node,
    );
    sessionsRef.current = updated;
    nodesRef.current = updatedNodes;
    const updatedEdges = normalizeTransferConfiguration(edgesRef.current, updatedNodes);
    edgesRef.current = updatedEdges;
    setSessions(updated);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    setActiveSessionId((active) => active === id ? nextId : active);
    scheduleSave();
  }, [scheduleSave]);

  // ── variable management (InputNode-derived) ───────────────────────────────

  // Variables are declared via InputNodes on the canvas. Editing a variable
  // default value from the SessionsBar patches the InputNode directly.
  const onEditVariable = useCallback((name: string, patch: Partial<{ defaultValue?: string; description?: string }>) => {
    const inputNode = nodesRef.current.find((n): n is InputNode => n.kind === 'input' && n.variableName === name);
    if (inputNode) onEditNode(inputNode.id, patch);
  }, [onEditNode]);

  // ── logs ──────────────────────────────────────────────────────────────────

  const onClearLogs = useCallback(() => setLogLines([]), []);

  // ── selection ─────────────────────────────────────────────────────────────

  const onSelectNode     = (id: string) => { setRunConfigOpen(false); setSelection({ kind: 'node', id }); };
  const onSelectEdge     = (id: string) => { setRunConfigOpen(false); setSelection({ kind: 'edge', id }); };
  const onClearSelection = ()            => setSelection(null);

  const onAddSessionRequest = useCallback(() => {
    setBarExpanded(true);
    setAddSessionPing((n) => n + 1);
  }, []);

  // ── keyboard delete ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      if (!selection) return;
      e.preventDefault();
      if (selection.kind === 'node') onDeleteNode(selection.id);
      if (selection.kind === 'edge') onDeleteEdge(selection.id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, onDeleteNode, onDeleteEdge]);

  // ── run management ────────────────────────────────────────────────────────

  const refreshAgentSessions = useCallback(() => {
    fetchAgentSessions({ workflowId: activeWorkflow }).then(setAgentSessions).catch(console.error);
  }, [activeWorkflow]);

  const refreshAgentServers = useCallback(() => {
    fetchAgentServers().then(setAgentServers).catch(console.error);
  }, []);

  const requestAuth = useCallback((statuses: AgentAuthenticationStatus[], resume?: () => void | Promise<void>) => {
    const required = statuses.filter((status) => status.needsAuth);
    if (required.length === 0) return;
    resumeAfterAuthRef.current = resume;
    setAuthStatuses(required);
  }, []);

  const onAuthReady = useCallback(async () => {
    const resume = resumeAfterAuthRef.current;
    resumeAfterAuthRef.current = undefined;
    setAuthStatuses([]);
    await resume?.();
  }, []);

  const onSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    setLiveNodeStates({});
    fetchRun(id).then((rec) => {
      const uiRun = apiRunToUiRun(rec);
      setHistoricNodeStates(uiRun.nodeStates ?? {});
      // Hydrate the active run with its snapshot for read-only display.
      setRuns((prev) => prev.map((r) =>
        r.id === id ? { ...r, canvasSnapshot: uiRun.canvasSnapshot, nodeStates: uiRun.nodeStates, nodeOutputs: uiRun.nodeOutputs } : r,
      ));
    }).catch(console.error);
    fetchRunLogs(id).then((events) => {
      setLogLines(apiRunLogsToLogLines(events));
    }).catch(console.error);
    fetchPausedNodes(id).then((paused) => {
      setPausedNode(paused[0] ?? null);
      setPausedLines([]);
      if (paused[0]) {
        setActiveSessionId(paused[0].specflowSessionId);
        setBarExpanded(true);
      }
    }).catch(console.error);
  }, []);

  const onExitRunView = useCallback(() => {
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setSelection(null);
    setPendingInteractions([]);
    setPausedNode(null);
    setPausedLines([]);
  }, []);

  const onOpenNewRun = useCallback(() => {
    const defaults: Record<string, string> = {};
    for (const n of nodesRef.current) {
      if (n.kind === 'input') defaults[n.variableName] = n.defaultValue ?? '';
    }
    setRunConfigVars(defaults);
    setRunConfigBusy(false);
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setSelection(null);
    setPendingInteractions([]);
    setRunConfigOpen(true);
  }, []);

  const onRunInteractionEvent = useCallback((interaction: RunInteraction) => {
    setPendingInteractions((prev) => {
      if (interaction.status !== 'pending') {
        return prev.filter((item) => item.id !== interaction.id);
      }
      const index = prev.findIndex((item) => item.id === interaction.id);
      if (index < 0) return [...prev, interaction];
      const next = [...prev];
      next[index] = interaction;
      return next;
    });
  }, []);

  const onRespondToInteraction = useCallback(async (interaction: RunInteraction, response: unknown) => {
    try {
      await respondToRunInteraction(interaction.runId, interaction.id, response);
      setPendingInteractions((prev) => prev.filter((item) => item.id !== interaction.id));
    } catch (err) {
      console.error('Failed to respond to interaction', err);
    }
  }, []);

  const startRun = useCallback(async (initialInput: string, variableValues: Record<string, string>) => {
    setRunStartBusy(true);
    try {
      const { runId } = await runCanvas(activeWorkflow, { initialInput, variableValues });

      const pending: RunStateMap = {};
      for (const n of nodesRef.current) pending[n.id] = 'pending';
      setLiveNodeStates(pending);
      setHistoricNodeStates({});
      setLogLines([]);
      setPendingInteractions([]);
      setPausedNode(null);
      setPausedLines([]);

      let placeholder: Run;
      try {
        const initial = await fetchRun(runId);
        placeholder = apiRunToUiRun(initial);
      } catch {
        placeholder = {
          id: runId,
          label: 'Starting run...',
          ticket: '',
          status: 'running',
          time: 'just now',
          duration: '—',
          agent: sessionsRef.current[0]?.agentServerId ?? 'unconfigured',
        };
      }
      setRuns((prev) => [placeholder, ...prev]);
      setActiveRunId(runId);
      setBarExpanded(true);

      const unsub = subscribeToRun(runId, (type: SseEventType, data: unknown) => {
        if (type === 'node-status') {
          const ev = data as { nodeId: string; status: string };
          setLiveNodeStates((prev) => ({ ...prev, [ev.nodeId]: ev.status as import('./types').RunState }));
          if (ev.status === 'paused') {
            const node = nodesRef.current.find((candidate) => candidate.id === ev.nodeId);
            if (node?.kind === 'step' && node.sessionId) {
              setPausedNode({ runId, nodeId: node.id, specflowSessionId: node.sessionId, agentServerId: sessionsRef.current.find((session) => session.id === node.sessionId)?.agentServerId ?? '', pausedAt: new Date().toISOString() });
              setPausedLines([]);
              setActiveSessionId(node.sessionId);
              setBarExpanded(true);
            }
          } else if (ev.status === 'success') {
            setPausedNode((paused) => paused?.nodeId === ev.nodeId ? null : paused);
          }
        } else if (type === 'terminal') {
          const ev = data as { chunk: string; nodeId?: string; stream?: LogLine['stream'] };
          setLogLines((prev) => [...prev.slice(-500), { chunk: ev.chunk, nodeId: ev.nodeId, stream: ev.stream }]);
        } else if (type === 'interaction-requested') {
          onRunInteractionEvent(data as RunInteraction);
        } else if (type === 'run-status') {
          const ev = data as { status: string; error?: string };
          const uiStatus = runStatusFromEvent(ev.status);
          setRuns((prev) => prev.map((r) =>
            r.id === runId ? { ...r, status: uiStatus } : r,
          ));
          if (uiStatus !== 'running') {
            setPausedNode(null);
            setPausedLines([]);
            unsub();
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((r) => r.id === runId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
            refreshAgentSessions();
          }
        }
      });
      fetchPausedNodes(runId).then((paused) => {
        if (paused[0]) {
          setPausedNode(paused[0]);
          setActiveSessionId(paused[0].specflowSessionId);
        }
      }).catch(console.error);
    } catch (err) {
      if (err instanceof AgentAuthenticationRequiredError) {
        requestAuth(err.statuses, () => startRun(initialInput, variableValues));
        return;
      }
      console.error('Failed to start run', err);
    } finally {
      setRunStartBusy(false);
    }
  }, [activeWorkflow, onRunInteractionEvent, refreshAgentSessions, requestAuth]);

  const onStartConfiguredRun = useCallback(async () => {
    setRunConfigBusy(true);
    await startRun('', runConfigVars);
    setRunConfigOpen(false);
    setRunConfigBusy(false);
  }, [startRun, runConfigVars]);

  const handleRerun = useCallback(async (runId: string) => {
    setRunStartBusy(true);
    try {
      const { runId: newRunId } = await apiRerunRun(runId);
      const initial = await fetchRun(newRunId);
      const placeholder = apiRunToUiRun(initial);
      setRuns((prev) => [placeholder, ...prev]);
      setActiveRunId(newRunId);
      setLiveNodeStates(initial.nodeStates ?? {});
      setHistoricNodeStates({});
      setLogLines([]);
      setPendingInteractions([]);
      setPausedNode(null);
      setPausedLines([]);
      setBarExpanded(true);

      const unsub = subscribeToRun(newRunId, (type: SseEventType, data: unknown) => {
        if (type === 'node-status') {
          const ev = data as { nodeId: string; status: string };
          setLiveNodeStates((prev) => ({ ...prev, [ev.nodeId]: ev.status as import('./types').RunState }));
          if (ev.status === 'paused') {
            const node = nodesRef.current.find((candidate) => candidate.id === ev.nodeId);
            if (node?.kind === 'step' && node.sessionId) {
              setPausedNode({ runId: newRunId, nodeId: node.id, specflowSessionId: node.sessionId, agentServerId: sessionsRef.current.find((session) => session.id === node.sessionId)?.agentServerId ?? '', pausedAt: new Date().toISOString() });
              setPausedLines([]);
              setActiveSessionId(node.sessionId);
              setBarExpanded(true);
            }
          } else if (ev.status === 'success') {
            setPausedNode((paused) => paused?.nodeId === ev.nodeId ? null : paused);
          }
        } else if (type === 'terminal') {
          const ev = data as { chunk: string; nodeId?: string; stream?: LogLine['stream'] };
          setLogLines((prev) => [...prev.slice(-500), { chunk: ev.chunk, nodeId: ev.nodeId, stream: ev.stream }]);
        } else if (type === 'interaction-requested') {
          onRunInteractionEvent(data as RunInteraction);
        } else if (type === 'run-status') {
          const ev = data as { status: string; error?: string };
          const uiStatus = runStatusFromEvent(ev.status);
          setRuns((prev) => prev.map((r) =>
            r.id === newRunId ? { ...r, status: uiStatus } : r,
          ));
          if (uiStatus !== 'running') {
            setPausedNode(null);
            setPausedLines([]);
            unsub();
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((r) => r.id === newRunId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
            refreshAgentSessions();
          }
        }
      });
      fetchPausedNodes(newRunId).then((paused) => {
        if (paused[0]) {
          setPausedNode(paused[0]);
          setActiveSessionId(paused[0].specflowSessionId);
        }
      }).catch(console.error);
    } catch (err) {
      if (err instanceof AgentAuthenticationRequiredError) {
        requestAuth(err.statuses, () => handleRerun(runId));
        return;
      }
      console.error('Failed to re-run', err);
    } finally {
      setRunStartBusy(false);
    }
  }, [activeWorkflow, onRunInteractionEvent, refreshAgentSessions, requestAuth]);

  const onDeleteRun = useCallback(async (id: string) => {
    if (!window.confirm('Delete this run?')) return;
    try {
      await apiDeleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (activeRunId === id) {
        setActiveRunId('');
        setHistoricNodeStates({});
        setLiveNodeStates({});
        setPendingInteractions([]);
      }
      refreshAgentSessions();
    } catch (err) {
      console.error('Failed to delete run', err);
    }
  }, [activeRunId, refreshAgentSessions]);

  const onCancelRun = useCallback(async (id: string) => {
    try {
      await apiCancelRun(id);
      setRuns((prev) => prev.map((r) =>
        r.id === id ? { ...r, status: 'cancelled' } : r,
      ));
      setLogLines((prev) => [...prev.slice(-500), { chunk: 'Run cancellation requested.\n', stream: 'system' }]);
    } catch (err) {
      console.error('Failed to cancel run', err);
    }
  }, []);

  const onOpenInvocationLog = useCallback((runId: string, nodeId?: string, specflowSessionId?: string) => {
    if (specflowSessionId) setActiveSessionId(specflowSessionId);
    if (nodeId) setSelection({ kind: 'node', id: nodeId });
    setBarExpanded(true);
    onSelectRun(runId);
  }, [onSelectRun]);

  const onRestoreHistoricalSession = useCallback(async (session: AgentSessionRecord, mode: RestoreMode) => {
    restoreRequestTokenRef.current += 1;
    const requestToken = restoreRequestTokenRef.current;
    terminateConversation(conversationRef.current);
    setRestoreStatusBySession((prev) => ({ ...prev, [session.id]: 'starting' }));
    setConversation({
      session,
      mode,
      status: 'starting',
      lines: [{ role: 'system', text: `${mode === 'inspect' ? 'Loading' : 'Resuming'} ACP session...` }],
      canPrompt: false,
      busy: false,
    });

    try {
      const started = await restoreAgentSession(session.id, mode);
      if (requestToken !== restoreRequestTokenRef.current) {
        void cancelRestoredSession(started.restoreId).catch(console.error);
        return;
      }
      setConversation((current) => current?.session.id === session.id ? { ...current, restoreId: started.restoreId } : current);
      restoreUnsubscribeRef.current = subscribeToRestore(started.restoreId, (type: RestoreSseEventType, event: RestoreStreamEvent) => {
        if (type === 'terminal' && event.type === 'terminal') {
          setConversation((current) => current?.session.id === session.id
            ? { ...current, lines: [...current.lines, { role: 'terminal', text: event.chunk }] }
            : current);
          return;
        }

        if (type === 'session-update' && event.type === 'session-update') {
          const text = textFromSessionUpdate(event.update);
          if (text) setConversation((current) => current?.session.id === session.id
            ? { ...current, lines: [...current.lines, { role: 'agent', text }] }
            : current);
          return;
        }

        if (type === 'interaction-requested' && event.type === 'interaction-requested') {
          onRunInteractionEvent(event.interaction);
          return;
        }

        if (type === 'restore-status' && event.type === 'restore-status') {
          setRestoreStatusBySession((prev) => ({ ...prev, [session.id]: event.status }));
          const text = event.status === 'success'
            ? `Restored through ACP session/${event.selectedPrimitive}.`
            : event.status === 'failure'
              ? `Restore failed: ${event.error ?? 'unknown error'}`
              : 'Restore requested.';
          setConversation((current) => current?.session.id === session.id
            ? {
                ...current,
                status: event.status,
                canPrompt: mode === 'continue' && event.status === 'success',
                lines: [...current.lines, { role: 'system', text }],
              }
            : current);
          if (event.status === 'failure' || (event.status === 'success' && mode === 'inspect')) {
            refreshAgentSessions();
            restoreUnsubscribeRef.current?.();
            restoreUnsubscribeRef.current = undefined;
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRestoreStatusBySession((prev) => ({ ...prev, [session.id]: 'failure' }));
      setConversation((current) => current?.session.id === session.id
        ? { ...current, status: 'failure', lines: [...current.lines, { role: 'system', text: `Restore failed: ${message}` }] }
        : current);
    }
  }, [onRunInteractionEvent, refreshAgentSessions, terminateConversation]);

  const onPromptConversation = useCallback(async (prompt: string) => {
    const active = conversation;
    if (!active?.restoreId || !active.canPrompt || active.busy) return;
    setConversation((current) => current ? { ...current, busy: true, lines: [...current.lines, { role: 'user', text: prompt }] } : current);
    try {
      await promptRestoredSession(active.restoreId, prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConversation((current) => current ? { ...current, lines: [...current.lines, { role: 'system', text: message }] } : current);
    } finally {
      setConversation((current) => current ? { ...current, busy: false } : current);
    }
  }, [conversation]);

  const onCloseConversation = useCallback(() => {
    restoreRequestTokenRef.current += 1;
    terminateConversation(conversation);
    if (conversation?.restoreId) {
      setPendingInteractions((current) => current.filter((interaction) =>
        interaction.agentInvocationId !== `restore:${conversation.restoreId}`));
    }
    setConversation(null);
  }, [conversation, terminateConversation]);

  const onPromptPausedNode = useCallback(async (prompt: string) => {
    if (!pausedNode || pausedPromptBusy) return;
    setPausedPromptBusy(true);
    setPausedLines((current) => [...current, { role: 'user', text: prompt }]);
    try {
      const result = await promptPausedNode(pausedNode.runId, pausedNode.nodeId, prompt);
      setPausedLines((current) => [...current, { role: 'agent', text: result.output }]);
    } catch (error) {
      setPausedLines((current) => [...current, { role: 'system', text: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setPausedPromptBusy(false);
    }
  }, [pausedNode, pausedPromptBusy]);

  const onContinuePausedNode = useCallback(async () => {
    if (!pausedNode || pausedPromptBusy) return;
    try {
      await continuePausedNode(pausedNode.runId, pausedNode.nodeId);
      setPausedNode(null);
      setPausedLines([]);
    } catch (error) {
      setPausedLines((current) => [...current, { role: 'system', text: error instanceof Error ? error.message : String(error) }]);
    }
  }, [pausedNode, pausedPromptBusy]);

  // ── workflow management ───────────────────────────────────────────────────

  const onCreateWorkflow = useCallback(async () => {
    try {
      const doc = await createCanvas('Untitled workflow');
      const summary = { id: doc.id, name: doc.name, runs: 0 };
      setWorkflows((prev) => [summaryToWorkflow(summary), ...prev]);
      setActiveWorkflow(doc.id);
    } catch (err) {
      console.error('Failed to create workflow', err);
    }
  }, []);

  // ── derived selection state ───────────────────────────────────────────────

  const selectedNode     = selection?.kind === 'node' ? displayNodes.find((n) => n.id === selection.id) : null;
  const selectedEdge     = selection?.kind === 'edge' ? displayEdges.find((e) => e.id === selection.id) : null;
  const selectedFromNode = selectedEdge ? displayNodes.find((n) => n.id === selectedEdge.from) : undefined;
  const selectedToNode   = selectedEdge ? displayNodes.find((n) => n.id === selectedEdge.to)   : undefined;
  const selectedTransferSourceNode = selectedEdge ? resolveTransferSource(selectedEdge, displayNodes, displayEdges) : undefined;

  const selectedNodeWithState = selectedNode
    ? { ...selectedNode, runState: runState[selectedNode.id] }
    : null;

  const hasRightPanel = !!selection;
  const barH     = barExpanded ? barHeight : 32;
  const rootClass = ['app', 'two-col-left', 'has-bottom-bar', hasRightPanel ? '' : 'no-right'].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={{ '--bar-h': `${barH}px` } as React.CSSProperties}
    >
      <TopBar
        theme={theme}
        onThemeChange={setTheme}
        runLabel={activeRun?.label}
        workflowName={activeCanvasName}
        onNewRun={onOpenNewRun}
        onRerun={activeRunId ? () => handleRerun(activeRunId) : undefined}
        onCancelRun={activeRunId ? () => onCancelRun(activeRunId) : undefined}
        canCancelRun={activeRun?.status === 'running'}
        onAgentServers={() => setAgentServerManagerOpen(true)}
        hasAgentUpdates={hasAgentUpdates}
        view={view}
        onExitRunView={onExitRunView}
      />

      <Sidebar
        workflows={workflows}
        runs={runs}
        activeWorkflow={activeWorkflow}
        activeRun={activeRunId}
        onSelectWorkflow={setActiveWorkflow}
        onSelectRun={onSelectRun}
        onNewRun={onOpenNewRun}
        onRerunRun={handleRerun}
        onDeleteRun={onDeleteRun}
        onCreateWorkflow={onCreateWorkflow}
      />

      <div className="canvas-cell" style={{ position: 'relative', overflow: 'hidden', minHeight: 0, height: '100%' }}>
        <Canvas
          nodes={displayNodes}
          edges={displayEdges}
          sessions={displaySessions}
          selection={selection}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onClearSelection={onClearSelection}
          runState={runState}
          showRun={!!activeRun}
          onNodeMove={onNodeMove}
          onAddNode={onAddNode}
          onAddEdge={onAddEdge}
          onDeleteNode={onDeleteNode}
          onAddBranch={onAddBranch}
          onContinuePausedNode={(nodeId) => {
            if (pausedNode?.nodeId === nodeId) void onContinuePausedNode();
          }}
          viewMode={view}
          zoom={zoom} setZoom={setZoom}
          pan={pan} setPan={setPan}
        />
        {activeRun && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 6 }}>
            <div className="run-pill">
              <span className={`status-dot ${activeRun.status}`} />
              <span className="label">RUN</span>
              <span className="value">{activeRun.label}</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span className="value" style={{ color: 'var(--ink-3)' }}>{activeRun.duration}</span>
            </div>
          </div>
        )}
        {runStartBusy && !runConfigOpen && (
          <div className="run-start-busy" role="status">
            <span className="run-start-spinner" />
            Checking ACP agents...
          </div>
        )}
      </div>

      {runConfigOpen && (
        <RunConfigPanel
          workflowName={activeCanvasName}
          variables={variables}
          values={runConfigVars}
          setValue={(name, value) => setRunConfigVars((prev) => ({ ...prev, [name]: value }))}
          onCancel={() => setRunConfigOpen(false)}
          onStart={onStartConfiguredRun}
          busy={runConfigBusy}
        />
      )}

      {!runConfigOpen && pendingInteractions[0] && (
        <InteractionModal
          interaction={pendingInteractions[0]}
          onRespond={onRespondToInteraction}
        />
      )}

      {!runConfigOpen && agentServerManagerOpen && (
        <AgentServerManager
          onClose={() => setAgentServerManagerOpen(false)}
          onChanged={refreshAgentServers}
          onAuthRequired={(statuses) => requestAuth(statuses)}
        />
      )}

      {authStatuses.length > 0 && (
        <AgentAuthModal
          statuses={authStatuses}
          onClose={() => {
            resumeAfterAuthRef.current = undefined;
            setAuthStatuses([]);
          }}
          onReady={onAuthReady}
          onChanged={refreshAgentServers}
        />
      )}

      {!runConfigOpen && selection?.kind === 'node' && selectedNodeWithState && (
        <NodePanel
          node={selectedNodeWithState}
          run={activeRun}
          sessions={displaySessions}
          nodes={displayNodes}
          edges={displayEdges}
          viewMode={view}
          logLines={logLines}
          onClose={onClearSelection}
          onEditNode={onEditNode}
          onChangeSession={onChangeSession}
          onAddSessionRequest={onAddSessionRequest}
          onAddBranch={onAddBranch}
          onEditBranch={onEditBranch}
          onDeleteBranch={onDeleteBranch}
          onAddPath={onAddPath}
          onEditPath={onEditPath}
          onDeletePath={onDeletePath}
          onUploadImages={onUploadImages}
          onDeleteImage={onDeleteImage}
          onImportPaths={onImportPaths}
        />
      )}
      {!runConfigOpen && selection?.kind === 'edge' && selectedEdge && (
        <ConnectionPanel
          edge={selectedEdge}
          fromNode={selectedFromNode}
          toNode={selectedToNode}
          transferSourceNode={selectedTransferSourceNode}
          viewMode={view}
          onClose={onClearSelection}
          onEditEdge={onEditEdge}
          onDeleteEdge={onDeleteEdge}
        />
      )}

      <div className="bottom-bar-cell">
        <SessionsBar
          sessions={displaySessions}
          nodes={displayNodes}
          expanded={barExpanded}
          setExpanded={setBarExpanded}
          barHeight={barHeight}
          setBarHeight={(h) => {
            setBarHeight(h);
            try { localStorage.setItem('sf-bar-h', String(h)); } catch { /* ignore */ }
          }}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          onAssignSession={onChangeSession}
          addSessionPing={addSessionPing}
          logLines={logLines}
          onAddSession={onAddSession}
          onEditSession={onEditSession}
          onDeleteSession={onDeleteSession}
          onClearLogs={onClearLogs}
          variables={displayVariables}
          onEditVariable={onEditVariable}
          agentSessions={agentSessions}
          agentServers={agentServers}
          runs={runs}
          onOpenInvocationLog={onOpenInvocationLog}
          onRestoreSession={onRestoreHistoricalSession}
          restoreStatusBySession={restoreStatusBySession}
          pausedNode={pausedNode}
          pausedLines={pausedLines}
          pausedPromptBusy={pausedPromptBusy}
          onPromptPausedNode={onPromptPausedNode}
          onContinuePausedNode={onContinuePausedNode}
          readonly={view === 'run'}
        />
      </div>
      {conversation && (
        <AgentConversationWindow
          session={conversation.session}
          mode={conversation.mode}
          status={conversation.status}
          lines={conversation.lines}
          canPrompt={conversation.canPrompt}
          busy={conversation.busy}
          onPrompt={onPromptConversation}
          onClose={onCloseConversation}
        />
      )}
    </div>
  );
}

function textFromSessionUpdate(update: unknown): string | undefined {
  if (!update || typeof update !== 'object') return undefined;
  const maybe = update as { sessionUpdate?: string; content?: unknown };
  if (maybe.sessionUpdate !== 'agent_message_chunk') return undefined;
  const content = maybe.content as { type?: string; text?: unknown } | undefined;
  return content?.type === 'text' && typeof content.text === 'string' ? content.text : undefined;
}
