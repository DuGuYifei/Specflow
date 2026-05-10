import { useState, useMemo, useCallback, useEffect } from 'react';
import type { WorkflowNode, Edge, Selection, RunStateMap, Theme } from './types';
import { SPECFLOW_DATA } from './data';
import { TopBar } from './components/top-bar';
import { Sidebar } from './components/sidebar';
import { Canvas } from './components/canvas';
import { NodePanel } from './components/node-panel';
import { ConnectionPanel } from './components/connection-panel';
import { SessionsBar } from './components/sessions-bar';

export function App() {
  const { sessions, workflows, runs } = SPECFLOW_DATA;
  const [nodes, setNodes] = useState<WorkflowNode[]>(SPECFLOW_DATA.nodes);
  const [edges, setEdges] = useState<Edge[]>(SPECFLOW_DATA.edges);

  const [activeWorkflow, setActiveWorkflow] = useState('wf1');
  const [activeRunId, setActiveRunId]       = useState('r12');
  const activeRun = runs.find((r) => r.id === activeRunId);

  const [selection, setSelection]           = useState<Selection | null>({ kind: 'node', id: 'n4b' });
  const [zoom, setZoom]                     = useState(1);
  const [pan, setPan]                       = useState({ x: 0, y: 0 });
  const [barExpanded, setBarExpanded]       = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('s5');
  const [addSessionPing, setAddSessionPing] = useState(0);
  const [theme, setTheme]                   = useState<Theme>('light');

  const onAddSessionRequest = useCallback(() => {
    setBarExpanded(true);
    setAddSessionPing((n) => n + 1);
  }, []);

  // apply theme to <html> so CSS [data-theme] selectors work
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // runState: map nodeId → RunState based on active run
  const runState = useMemo<RunStateMap>(() => {
    const m: RunStateMap = {};
    if (!activeRun) return m;
    const order = ['n1','n2a','n2b','n2c','g1','n3a','n3b','n3c','n4a','n4b','n4c','g2','end1'];
    if (activeRun.status === 'running') {
      let hit = false;
      for (const id of order) {
        if (id === activeRun.activeNode) { m[id] = 'running'; hit = true; }
        else if (!hit) m[id] = 'success';
        else           m[id] = 'pending';
      }
    } else if (activeRun.status === 'success') {
      order.forEach((id) => { m[id] = 'success'; });
    } else if (activeRun.status === 'error') {
      ['n1','n2a','n2b','n2c','g1','n3a','n3b','n3c','n4a','n4b'].forEach((id) => { m[id] = 'success'; });
      m['n4c']  = 'error';
      m['g2']   = 'pending';
      m['end1'] = 'pending';
    }
    return m;
  }, [activeRun]);

  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setNodes((ns) => ns.map((n) => n.id === id ? { ...n, x, y } : n));
  }, []);

  const onSelectNode = (id: string) => setSelection({ kind: 'node', id });
  const onSelectEdge = (id: string) => setSelection({ kind: 'edge', id });
  const onClearSelection = () => setSelection(null);

  const onToggleUpdateDoc = (id: string) => {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id || n.kind !== 'step') return n;
      return { ...n, updateDoc: !n.updateDoc };
    }));
  };

  const onChangeSession = useCallback((id: string, sid: string) => {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== id || n.kind === 'end') return n;
      return { ...n, sessionId: sid };
    }));
    // recompute sameSession on adjacent edges using the incoming sid for the changed node
    setEdges((es) => es.map((e) => {
      const fromN = nodes.find((n) => n.id === e.from);
      const toN   = nodes.find((n) => n.id === e.to);
      if (!fromN || !toN || e.loopback || fromN.kind === 'gate' || toN.kind === 'gate' || toN.kind === 'end') return e;
      const fromSid = e.from === id ? sid : fromN.sessionId;
      const toSid   = e.to   === id ? sid : toN.sessionId;
      return { ...e, sameSession: fromSid != null && fromSid === toSid };
    }));
  }, [nodes]);

  const selectedNode = selection?.kind === 'node' ? nodes.find((n) => n.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? edges.find((e) => e.id === selection.id) : null;
  const selectedFromNode = selectedEdge ? nodes.find((n) => n.id === selectedEdge.from) : undefined;
  const selectedToNode   = selectedEdge ? nodes.find((n) => n.id === selectedEdge.to)   : undefined;

  const selectedNodeWithState = selectedNode
    ? { ...selectedNode, runState: runState[selectedNode.id] }
    : null;

  const barH = barExpanded ? 252 : 32;

  // The grid root class drives layout; "no-right" collapses the third column
  const rootClass = [
    'app',
    'two-col-left',
    'has-bottom-bar',
    selection ? '' : 'no-right',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
      style={{ '--bar-h': `${barH}px` } as React.CSSProperties}
    >
      <TopBar theme={theme} onThemeChange={setTheme} runLabel={activeRun?.label} />

      <Sidebar
        workflows={workflows}
        runs={runs}
        activeWorkflow={activeWorkflow}
        activeRun={activeRunId}
        onSelectWorkflow={setActiveWorkflow}
        onSelectRun={setActiveRunId}
      />

      <div className="canvas-cell" style={{ position: 'relative', overflow: 'hidden', minHeight: 0, height: '100%' }}>
        <Canvas
          nodes={nodes}
          edges={edges}
          sessions={sessions}
          selection={selection}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onClearSelection={onClearSelection}
          runState={runState}
          showRun={!!activeRun}
          onNodeMove={onNodeMove}
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

      {selection?.kind === 'node' && selectedNodeWithState && (
        <NodePanel
          node={selectedNodeWithState}
          run={activeRun}
          sessions={sessions}
          onClose={onClearSelection}
          onToggleUpdateDoc={onToggleUpdateDoc}
          onChangeSession={onChangeSession}
          onAddSessionRequest={onAddSessionRequest}
        />
      )}
      {selection?.kind === 'edge' && selectedEdge && (
        <ConnectionPanel
          edge={selectedEdge}
          fromNode={selectedFromNode}
          toNode={selectedToNode}
          onClose={onClearSelection}
        />
      )}

      <div className="bottom-bar-cell">
        <SessionsBar
          sessions={sessions}
          nodes={nodes}
          expanded={barExpanded}
          setExpanded={setBarExpanded}
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          onAssignSession={onChangeSession}
          addSessionPing={addSessionPing}
        />
      </div>
    </div>
  );
}
