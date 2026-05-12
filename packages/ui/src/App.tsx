import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { WorkflowNode, Edge, Session, Workflow, Run, Selection, RunStateMap, Theme, RunStatus, LogLine, InputNode } from './types';
import {
  fetchCanvases, fetchCanvas, saveCanvas, runCanvas,
  fetchRuns, fetchRun, subscribeToRun,
  createCanvas, deleteRun as apiDeleteRun, rerunRun as apiRerunRun,
  apiRunToUiRun, summaryToWorkflow,
  type SseEventType,
} from './api';
import { TopBar } from './components/top-bar';
import { Sidebar } from './components/sidebar';
import { Canvas } from './components/canvas';
import { NodePanel } from './components/node-panel';
import { ConnectionPanel } from './components/connection-panel';
import { SessionsBar } from './components/sessions-bar';
import { RunConfigPanel } from './components/run-config-panel';

const SESSION_COLORS = [
  'oklch(0.7 0.13 250)',
  'oklch(0.7 0.14 160)',
  'oklch(0.7 0.14 30)',
  'oklch(0.7 0.14 310)',
  'oklch(0.65 0.12 80)',
];

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

  const nodesRef     = useRef(nodes);
  const edgesRef     = useRef(edges);
  const sessionsRef  = useRef(sessions);
  useEffect(() => { nodesRef.current     = nodes;     }, [nodes]);
  useEffect(() => { edgesRef.current     = edges;     }, [edges]);
  useEffect(() => { sessionsRef.current  = sessions;  }, [sessions]);

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
    // Clicking a workflow always returns to workflow-edit (no run selected).
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
  }, [activeWorkflow]);

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

  const onToggleUpdateDoc = useCallback((id: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== id || n.kind !== 'step') return n;
        return { ...n, updateDoc: !n.updateDoc };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onChangeSession = useCallback((id: string, sid: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== id || n.kind === 'end' || n.kind === 'input') return n;
        return { ...n, sessionId: sid };
      });
      nodesRef.current = updated;
      setEdges((es) => {
        const recomputed = es.map((e) => {
          const fromN = updated.find((n) => n.id === e.from);
          const toN   = updated.find((n) => n.id === e.to);
          if (!fromN || !toN || e.loopback || fromN.kind === 'gate' || toN.kind === 'gate' || toN.kind === 'end') return e;
          const fromSid = fromN.sessionId;
          const toSid   = toN.sessionId;
          return { ...e, sameSession: fromSid != null && fromSid === toSid };
        });
        edgesRef.current = recomputed;
        scheduleSave();
        return recomputed;
      });
      return updated;
    });
  }, [scheduleSave]);

  const onAddBranch = useCallback((gateId: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== gateId || n.kind !== 'gate') return n;
        const newBranch = { id: `b${Date.now()}`, label: 'branch', color: 'var(--ink-3)' };
        return { ...n, branches: [...n.branches, newBranch] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditBranch = useCallback((gateId: string, branchId: string, patch: { label?: string; color?: string }) => {
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

  const onAddAttachment = useCallback((nodeId: string, label: string) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, attachments: [...(n.attachments ?? []), { label }] };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteAttachment = useCallback((nodeId: string, index: number) => {
    setNodes((ns) => {
      const updated = ns.map((n) => {
        if (n.id !== nodeId || n.kind !== 'step') return n;
        return { ...n, attachments: (n.attachments ?? []).filter((_, i) => i !== index) };
      });
      nodesRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onEditEdge = useCallback((id: string, patch: { tag?: string; prompt?: string }) => {
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

  const onAddSession = useCallback((name: string, agent: Session['agent']) => {
    setSessions((ss) => {
      const id = `s${Date.now()}`;
      const color = SESSION_COLORS[ss.length % SESSION_COLORS.length];
      const updated = [...ss, { id, name, color, agent }];
      sessionsRef.current = updated;
      scheduleSave();
      return updated;
    });
  }, [scheduleSave]);

  const onDeleteSession = useCallback((id: string) => {
    const remaining = sessionsRef.current.filter((s) => s.id !== id);
    const fallback = remaining[0]?.id ?? null;
    const updatedNodes = nodesRef.current.map((n) =>
      n.sessionId === id ? { ...n, sessionId: fallback } as WorkflowNode : n,
    );
    const updatedEdges = edgesRef.current.map((e) => {
      const fromN = updatedNodes.find((n) => n.id === e.from);
      const toN   = updatedNodes.find((n) => n.id === e.to);
      if (!fromN || !toN || e.loopback || fromN.kind === 'gate' || toN.kind === 'gate' || toN.kind === 'end') return e;
      return { ...e, sameSession: fromN.sessionId != null && fromN.sessionId === toN.sessionId };
    });
    sessionsRef.current = remaining;
    nodesRef.current    = updatedNodes;
    edgesRef.current    = updatedEdges;
    setSessions(remaining);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
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

  const onSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    setLiveNodeStates({});
    fetchRun(id).then((rec) => {
      setHistoricNodeStates(rec.nodeStates);
      // Hydrate the active run with its snapshot for read-only display.
      setRuns((prev) => prev.map((r) =>
        r.id === id ? { ...r, canvasSnapshot: rec.canvasSnapshot, nodeStates: rec.nodeStates, nodeOutputs: rec.nodeOutputs } : r,
      ));
    }).catch(console.error);
  }, []);

  const onExitRunView = useCallback(() => {
    setActiveRunId('');
    setHistoricNodeStates({});
    setLiveNodeStates({});
    setSelection(null);
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
    setRunConfigOpen(true);
  }, []);

  const startRun = useCallback(async (initialInput: string, variableValues: Record<string, string>) => {
    try {
      const { runId } = await runCanvas(activeWorkflow, { initialInput, variableValues });

      const pending: RunStateMap = {};
      for (const n of nodesRef.current) pending[n.id] = 'pending';
      setLiveNodeStates(pending);
      setHistoricNodeStates({});
      setLogLines([]);

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
          agent: sessionsRef.current[0]?.agent ?? 'mock',
        };
      }
      setRuns((prev) => [placeholder, ...prev]);
      setActiveRunId(runId);
      setBarExpanded(true);

      const unsub = subscribeToRun(runId, (type: SseEventType, data: unknown) => {
        if (type === 'node-status') {
          const ev = data as { nodeId: string; status: string };
          setLiveNodeStates((prev) => ({ ...prev, [ev.nodeId]: ev.status as import('./types').RunState }));
        } else if (type === 'terminal') {
          const ev = data as { chunk: string; nodeId?: string };
          setLogLines((prev) => [...prev.slice(-500), { chunk: ev.chunk, nodeId: ev.nodeId }]);
        } else if (type === 'run-status') {
          const ev = data as { status: string };
          const uiStatus = ev.status === 'done' ? 'success' : ev.status === 'failed' ? 'error' : 'running';
          setRuns((prev) => prev.map((r) =>
            r.id === runId ? { ...r, status: uiStatus as RunStatus } : r,
          ));
          if (uiStatus !== 'running') {
            unsub();
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((r) => r.id === runId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
          }
        }
      });
    } catch (err) {
      console.error('Failed to start run', err);
    }
  }, [activeWorkflow]);

  const onStartConfiguredRun = useCallback(async () => {
    setRunConfigBusy(true);
    setRunConfigOpen(false);
    await startRun('', runConfigVars);
    setRunConfigBusy(false);
  }, [startRun, runConfigVars]);

  const handleRerun = useCallback(async (runId: string) => {
    try {
      const { runId: newRunId } = await apiRerunRun(runId);
      const initial = await fetchRun(newRunId);
      const placeholder = apiRunToUiRun(initial);
      setRuns((prev) => [placeholder, ...prev]);
      setActiveRunId(newRunId);
      setLiveNodeStates(initial.nodeStates ?? {});
      setHistoricNodeStates({});
      setLogLines([]);
      setBarExpanded(true);

      const unsub = subscribeToRun(newRunId, (type: SseEventType, data: unknown) => {
        if (type === 'node-status') {
          const ev = data as { nodeId: string; status: string };
          setLiveNodeStates((prev) => ({ ...prev, [ev.nodeId]: ev.status as import('./types').RunState }));
        } else if (type === 'terminal') {
          const ev = data as { chunk: string; nodeId?: string };
          setLogLines((prev) => [...prev.slice(-500), { chunk: ev.chunk, nodeId: ev.nodeId }]);
        } else if (type === 'run-status') {
          const ev = data as { status: string };
          const uiStatus = ev.status === 'done' ? 'success' : ev.status === 'failed' ? 'error' : 'running';
          setRuns((prev) => prev.map((r) =>
            r.id === newRunId ? { ...r, status: uiStatus as RunStatus } : r,
          ));
          if (uiStatus !== 'running') {
            unsub();
            fetchRuns(activeWorkflow).then((records) => {
              setRuns(records.map(apiRunToUiRun));
              const fresh = records.find((r) => r.id === newRunId);
              if (fresh) {
                setHistoricNodeStates(fresh.nodeStates);
                setLiveNodeStates({});
              }
            }).catch(console.error);
          }
        }
      });
    } catch (err) {
      console.error('Failed to re-run', err);
    }
  }, [activeWorkflow]);

  const onDeleteRun = useCallback(async (id: string) => {
    if (!window.confirm('Delete this run?')) return;
    try {
      await apiDeleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (activeRunId === id) {
        setActiveRunId('');
        setHistoricNodeStates({});
        setLiveNodeStates({});
      }
    } catch (err) {
      console.error('Failed to delete run', err);
    }
  }, [activeRunId]);

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
          onToggleUpdateDoc={onToggleUpdateDoc}
          onChangeSession={onChangeSession}
          onAddSessionRequest={onAddSessionRequest}
          onAddBranch={onAddBranch}
          onEditBranch={onEditBranch}
          onDeleteBranch={onDeleteBranch}
          onAddPath={onAddPath}
          onEditPath={onEditPath}
          onDeletePath={onDeletePath}
          onAddAttachment={onAddAttachment}
          onDeleteAttachment={onDeleteAttachment}
        />
      )}
      {!runConfigOpen && selection?.kind === 'edge' && selectedEdge && (
        <ConnectionPanel
          edge={selectedEdge}
          fromNode={selectedFromNode}
          toNode={selectedToNode}
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
          onDeleteSession={onDeleteSession}
          onClearLogs={onClearLogs}
          variables={displayVariables}
          onEditVariable={onEditVariable}
          readonly={view === 'run'}
        />
      </div>
    </div>
  );
}
