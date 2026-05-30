import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkflowNode, Edge, Session, Selection, RunStateMap, GateNode, InputNode } from '../types';
import { branchAccent, edgeKey, nextSymbolKey, sessionAccent } from '../appearance';
import type { IconName } from './icon';
import { Icon } from './icon';
import { closesGateControlledCycle, isSameSessionContentEdge, wouldCreateExecutedCycle } from '../edge-semantics';
import { useI18n } from '../i18n';

// ── geometry ──────────────────────────────────────────────────────────────────

function nodeAnchorOut(n: WorkflowNode, branch?: string): { x: number; y: number } {
  if (n.kind === 'gate') {
    const branches = n.branches;
    const i = branches.findIndex((b) => b.id === branch);
    const h = 110;
    const total = branches.length + 1;
    const t = (i + 1) / (total + 1);
    return { x: n.x + n.w, y: n.y + h * t };
  }
  if (n.kind === 'input') return { x: n.x + (n.w || 200), y: n.y + 36 };
  return { x: n.x + (n.w || 220), y: n.y + 60 };
}

function nodeAnchorIn(n: WorkflowNode): { x: number; y: number } {
  if (n.kind === 'gate') return { x: n.x, y: n.y + 110 / 2 };
  if (n.kind === 'end')  return { x: n.x - 2, y: n.y + 18 };
  if (n.kind === 'input') return { x: n.x, y: n.y + 36 }; // should not happen; InputNode has no input
  return { x: n.x, y: n.y + 60 };
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }, loopback?: boolean): string {
  if (loopback) {
    const top = Math.min(from.y, to.y) - 50;
    return `M ${from.x} ${from.y} C ${from.x + 60} ${from.y}, ${from.x + 80} ${top}, ${from.x + 30} ${top} L ${to.x - 30} ${top} C ${to.x - 80} ${top}, ${to.x - 60} ${to.y}, ${to.x} ${to.y}`;
  }
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.45);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function edgeMid(from: { x: number; y: number }, to: { x: number; y: number }, loopback?: boolean): { x: number; y: number } {
  if (loopback) return { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 50 };
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

const NODE_H: Record<string, number> = { step: 120, gate: 110, end: 36, input: 72 };

export interface CanvasFitResult {
  zoom: number;
  pan: { x: number; y: number };
}

export function calculateCanvasFit(nodes: WorkflowNode[], viewport: { width: number; height: number }): CanvasFitResult | null {
  if (nodes.length === 0 || viewport.width <= 0 || viewport.height <= 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.w || 220;
    const h = NODE_H[n.kind] ?? 120;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  const leftAnchor = 96;
  const rightPad = 48;
  const verticalPad = 48;
  const usableWidth = Math.max(1, viewport.width - leftAnchor - rightPad);
  const usableHeight = Math.max(1, viewport.height - verticalPad * 2);
  const boundsWidth = Math.max(1, maxX - minX);
  const boundsHeight = Math.max(1, maxY - minY);
  const zoom = Math.min(1.4, Math.max(0.3, Math.min(
    usableWidth / boundsWidth,
    usableHeight / boundsHeight,
  )));
  const centerY = (minY + maxY) / 2;
  const targetY = verticalPad + usableHeight / 2;

  return {
    zoom,
    pan: {
      x: leftAnchor - minX * zoom,
      y: targetY - centerY * zoom,
    },
  };
}

// ── node cards ────────────────────────────────────────────────────────────────

interface StepCardProps {
  n: Extract<WorkflowNode, { kind: 'step' }>;
  session: Session | undefined;
  selected: boolean;
  runState: string | undefined;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
  onContinue?: () => void;
}

function StepCard({ n, session, selected, runState, onMouseDown, onSelect, onContinue }: StepCardProps) {
  const { t } = useI18n();
  const cls = ['node'];
  if (selected)               cls.push('selected');
  if (runState === 'running') cls.push('running');
  if (runState === 'paused')  cls.push('paused');
  if (runState === 'success') cls.push('success');
  if (runState === 'error')   cls.push('error');
  if (n.locked)               cls.push('locked');

  return (
    <div
      className={cls.join(' ')}
      data-session={n.sessionId || ''}
      style={{ left: n.x, top: n.y, width: n.w, '--session-color': session ? sessionAccent(session) : 'var(--ink-3)' } as React.CSSProperties}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
    >
      <div className="node-head">
        <span className="node-id">{n.num}</span>
        {n.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
        <span className="node-state-icon">
          {runState === 'running' && <><Icon name="loader" size={11} style={{ animation: 'spin 1.4s linear infinite' }} />{t('canvas.running')}</>}
          {runState === 'paused'  && <><span style={{ color: 'var(--warn)' }}>{t('canvas.paused')}</span><button className="btn sm primary node-continue" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onContinue?.(); }}>{t('canvas.continue')}</button></>}
          {runState === 'success' && <><Icon name="check"  size={11} style={{ color: 'oklch(0.55 0.13 145)' }} />{t('canvas.done')}</>}
          {runState === 'error'   && <><Icon name="alert"  size={11} style={{ color: 'var(--err)' }} />{t('canvas.failed')}</>}
          {runState === 'pending' && <span style={{ color: 'var(--ink-3)' }}>{t('canvas.queued')}</span>}
        </span>
      </div>
      <h3 className="node-title">{n.title}</h3>
      <p className="node-desc">{n.prompt}</p>
      <div className="node-meta">
        {(n.images || []).map((a, i) => (
          <span className="chip attach" key={i}><Icon name="attachment-img" size={10} />{a.label ?? a.path}</span>
        ))}
        {(n.paths || []).map((p, i) => (
          <span className="chip path" key={i}>
            <Icon name={p.endsWith('/') ? 'folder' : 'file'} size={10} />{p}
          </span>
        ))}
      </div>
      <div className="port in"  data-port="in"  data-node={n.id} />
      <div className="port out" data-port="out" data-node={n.id} />
    </div>
  );
}

interface GateCardProps {
  n: GateNode;
  selected: boolean;
  runState: string | undefined;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
  onAddBranch: (gateId: string) => void;
}

function GateCard({ n, selected, runState, onMouseDown, onSelect, onAddBranch }: GateCardProps) {
  const { t } = useI18n();
  const cls = ['gate-wrap'];
  if (selected)               cls.push('selected');
  if (runState === 'running') cls.push('running');
  if (runState === 'success') cls.push('success');
  if (runState === 'error')   cls.push('error');

  const w = n.w, h = 110;
  const branches = n.branches;

  return (
    <div
      className={cls.join(' ')}
      style={{ left: n.x, top: n.y, width: w, height: h }}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
    >
      <div className="gate-card">
        <div className="gate-head">
          <span className="node-id">{n.num}</span>
          <span className="gate-sub"><Icon name="route" size={10} /> {t('canvas.gateBranches', { count: branches.length })}</span>
        </div>
        <h3 className="gate-title">{n.title}</h3>
      </div>
      <div className="gate-port-in" data-port="in" data-node={n.id} />
      {branches.map((b, i) => {
        const total = branches.length + 1;
        const t = (i + 1) / (total + 1);
        const top = h * t - 6;
        return (
          <div
            key={b.id}
            className={`gate-port-out ${b.id}`}
            data-port="gate-out"
            data-node={n.id}
            data-branch={b.id}
            style={{ right: -7, top, borderColor: branchAccent(b) }}
          >
            <span className="pl">{b.label}</span>
          </div>
        );
      })}
      <div
        className="gate-port-add"
        style={{ right: -8, top: h * (branches.length + 1) / (branches.length + 2) - 7 }}
        title={t('canvas.addBranchTitle')}
        onClick={(e) => { e.stopPropagation(); onAddBranch(n.id); }}
      >+</div>
    </div>
  );
}

interface EndCardProps {
  n: Extract<WorkflowNode, { kind: 'end' }>;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
}

function EndCard({ n, selected, onMouseDown, onSelect }: EndCardProps) {
  const { t } = useI18n();
  const cls = ['end-node'];
  if (selected) cls.push('selected');

  return (
    <div
      className={cls.join(' ')}
      style={{ left: n.x, top: n.y }}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
      data-port="in" data-node={n.id}
    >
      <Icon name="check" size={11} />{n.title || t('canvas.end')}
    </div>
  );
}

interface InputCardProps {
  n: InputNode;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
}

function InputCard({ n, selected, onMouseDown, onSelect }: InputCardProps) {
  const cls = ['input-node'];
  if (selected) cls.push('selected');

  return (
    <div
      className={cls.join(' ')}
      style={{ left: n.x, top: n.y, width: n.w || 200 }}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
    >
      <div className="input-node-head">
        <Icon name="tag" size={10} />
        <span className="node-id">{n.num}</span>
        <span style={{ flex: 1 }}>{n.title}</span>
      </div>
      <div className="input-node-var">
        <span className="var-chip">&lt;{n.variableName}&gt;</span>
        {n.defaultValue && (
          <span style={{ color: 'var(--ink-4)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.defaultValue}
          </span>
        )}
      </div>
      {/* output-only port */}
      <div className="port out" data-port="out" data-node={n.id} />
    </div>
  );
}

// ── canvas ────────────────────────────────────────────────────────────────────

export type CanvasMode = 'pan' | 'add-step' | 'add-gate' | 'add-end' | 'add-input';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: Edge[];
  sessions: Session[];
  selection: Selection | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
  runState: RunStateMap;
  showRun: boolean;
  onNodeMove: (id: string, x: number, y: number) => void;
  onAddNode: (node: WorkflowNode) => void;
  onAddEdge: (edge: Edge) => void;
  onDeleteNode: (id: string) => void;
  onAddBranch: (gateId: string) => void;
  onContinuePausedNode?: (nodeId: string) => void;
  viewMode: 'edit' | 'run';
  zoom: number;
  setZoom: (z: number) => void;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'node'; nodeId: string; startX: number; startY: number; nx: number; ny: number };

interface DragEdge {
  fromId: string;
  branch?: string;
  cursorX: number;
  cursorY: number;
}

export function Canvas({
  nodes, edges, sessions,
  selection, onSelectNode, onSelectEdge, onClearSelection,
  runState, showRun, onNodeMove,
  onAddNode, onAddEdge, onDeleteNode, onAddBranch, onContinuePausedNode,
  viewMode,
  zoom, setZoom, pan, setPan,
}: CanvasProps) {
  const { t } = useI18n();
  void onDeleteNode;  // handled by App-level keyboard listener

  const [mode, setMode] = useState<CanvasMode>('pan');
  const [dragEdge, setDragEdge] = useState<DragEdge | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const dragEdgeRef = useRef<DragEdge | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  zoomRef.current   = zoom;
  panRef.current    = pan;
  nodesRef.current  = nodes;
  edgesRef.current  = edges;
  dragEdgeRef.current = dragEdge;

  const isEdit = viewMode === 'edit';

  // ESC + Delete handling for canvas modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode !== 'pan') { setMode('pan'); setGhostPos(null); }
        if (dragEdgeRef.current) setDragEdge(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode]);

  // Auto-reset to pan if view becomes readonly while in add mode
  useEffect(() => {
    if (!isEdit && mode !== 'pan') {
      setMode('pan');
      setGhostPos(null);
      setDragEdge(null);
    }
  }, [isEdit, mode]);

  const fitToView = useCallback(() => {
    if (!wrapRef.current || nodes.length === 0) return;
    const fit = calculateCanvasFit(nodes, {
      width: wrapRef.current.clientWidth,
      height: wrapRef.current.clientHeight,
    });
    if (!fit) return;
    setZoom(fit.zoom);
    setPan(fit.pan);
  }, [nodes, setZoom, setPan]);

  useEffect(() => {
    const t = setTimeout(fitToView, 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const next = Math.min(1.6, Math.max(0.3, zoomRef.current * (1 - e.deltaY * 0.0015)));
        setZoom(next);
      } else {
        setPan({ x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [setZoom, setPan]);

  // canvas-coord helpers
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    if (!wrapRef.current) return { x: 0, y: 0 };
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (clientY - rect.top  - panRef.current.y) / zoomRef.current,
    };
  }, []);

  // ── port-drag-to-connect ──────────────────────────────────────────────────

  const startEdgeDrag = useCallback((fromId: string, branch: string | undefined, clientX: number, clientY: number) => {
    const pos = clientToCanvas(clientX, clientY);
    setDragEdge({ fromId, branch, cursorX: pos.x, cursorY: pos.y });
  }, [clientToCanvas]);

  // Global mouse listeners for port-drag and ghost-cursor tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // 1. Active drag-edge: track cursor
      if (dragEdgeRef.current) {
        const pos = clientToCanvas(e.clientX, e.clientY);
        setDragEdge((d) => d ? { ...d, cursorX: pos.x, cursorY: pos.y } : d);
        return;
      }
      // 2. Existing node drag / pan
      const d = dragRef.current;
      if (d) {
        if (d.kind === 'pan') {
          setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
        } else {
          const dx = (e.clientX - d.startX) / zoomRef.current;
          const dy = (e.clientY - d.startY) / zoomRef.current;
          onNodeMove(d.nodeId, d.nx + dx, d.ny + dy);
        }
        return;
      }
      // 3. Ghost preview in add-mode
      if (mode !== 'pan') {
        const pos = clientToCanvas(e.clientX, e.clientY);
        setGhostPos(pos);
      }
    };

    const onUp = (e: MouseEvent) => {
      // Drop a port-drag
      if (dragEdgeRef.current) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const portIn = target?.closest('[data-port="in"]') as HTMLElement | null;
        const dragInfo = dragEdgeRef.current;
        setDragEdge(null);
        if (portIn) {
          const toId = portIn.getAttribute('data-node');
          if (toId && toId !== dragInfo.fromId) {
            const fromN = nodesRef.current.find((n) => n.id === dragInfo.fromId);
            const toN   = nodesRef.current.find((n) => n.id === toId);
            if (fromN && toN && toN.kind !== 'input') {
              const edge = {
                id: edgeKey({ from: dragInfo.fromId, to: toId, branch: dragInfo.branch }),
                from: dragInfo.fromId,
                to: toId,
                branch: dragInfo.branch,
              };
              const secondGateInput = toN.kind === 'gate'
                && fromN.kind !== 'input'
                && edgesRef.current.some((existing) =>
                  existing.to === toId
                  && nodesRef.current.find((node) => node.id === existing.from)?.kind !== 'input');
              const executionCycle = wouldCreateExecutedCycle(edge, edgesRef.current);
              const controlledLoopback = executionCycle && (
                (fromN.kind === 'gate' && Boolean(dragInfo.branch))
                || closesGateControlledCycle(edge, edgesRef.current, nodesRef.current)
              );
              if (!secondGateInput && (!executionCycle || controlledLoopback) && !edgesRef.current.some((existing) => existing.id === edge.id)) {
                onAddEdge(controlledLoopback ? { ...edge, loopback: true } : edge);
              }
            }
          }
        }
        return;
      }
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [mode, clientToCanvas, onAddEdge, setPan, onNodeMove]);

  // ── canvas mousedown ──────────────────────────────────────────────────────

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('.node, .gate-wrap, .end-node, .input-node, .edge-tag, .canvas-toolbar, .edge-hover-target')) return;

    // In add-mode and edit view: place node at click
    if (mode !== 'pan' && isEdit) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      const keyPrefix =
        mode === 'add-step' ? 'step'
        : mode === 'add-gate' ? 'gate'
        : mode === 'add-input' ? 'input'
        : 'end';
      const id = nextSymbolKey(keyPrefix, nodesRef.current.map((node) => node.id));
      const num = `${nodesRef.current.length + 1}`;
      const firstSession = sessions[0]?.id ?? null;

      let newNode: WorkflowNode;
      if (mode === 'add-step') {
        newNode = { kind: 'step', id, num, x: pos.x - 110, y: pos.y - 60, w: 220, title: t('canvas.untitled'), prompt: '', sessionId: firstSession };
      } else if (mode === 'add-gate') {
        newNode = { kind: 'gate', id, num, x: pos.x - 110, y: pos.y - 55, w: 220, title: t('canvas.decision'), decisionCriteria: '', branches: [{ id: 'pass', label: 'pass' }, { id: 'fix', label: 'fix' }] };
      } else if (mode === 'add-input') {
        newNode = { kind: 'input', id, num, x: pos.x - 100, y: pos.y - 36, w: 200, title: t('canvas.runInput'), variableName: `specflow_var${nodesRef.current.filter((n) => n.kind === 'input').length + 1}`, sessionId: null };
      } else {
        newNode = { kind: 'end', id, num, x: pos.x - 30, y: pos.y - 18, w: 80, title: t('canvas.doneNode'), sessionId: null };
      }

      onAddNode(newNode);

      // Shift+click: stay in mode for rapid placement
      if (!e.shiftKey) {
        setMode('pan');
        setGhostPos(null);
        onSelectNode(id);
      }
      return;
    }

    // Default: pan
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    onClearSelection();
  };

  // ── node mousedown ────────────────────────────────────────────────────────

  const onNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    const target = e.target as Element;

    // Port drag-out (edit mode only)
    if (isEdit) {
      const outEl = target.closest('[data-port="out"], [data-port="gate-out"]') as HTMLElement | null;
      if (outEl) {
        e.stopPropagation();
        const fromId = outEl.getAttribute('data-node') ?? nodeId;
        const branch = outEl.getAttribute('data-branch') ?? undefined;
        startEdgeDrag(fromId, branch, e.clientX, e.clientY);
        return;
      }
    }

    // Skip drag if clicked on any port or the gate add button
    if (
      target.classList.contains('port') ||
      target.classList.contains('gate-port-out') ||
      target.classList.contains('gate-port-add') ||
      target.classList.contains('gate-port-in') ||
      target.closest('.gate-port-out, .gate-port-add, .gate-port-in')
    ) return;

    e.stopPropagation();
    onSelectNode(nodeId);

    // In run view: select-only, no drag
    if (!isEdit) return;

    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    // Locked nodes can't be dragged
    if ((n as WorkflowNode & { locked?: boolean }).locked) return;
    dragRef.current = { kind: 'node', nodeId, startX: e.clientX, startY: e.clientY, nx: n.x, ny: n.y };
  };

  const nodeById = useMemo(() => {
    const m: Record<string, WorkflowNode> = {};
    for (const n of nodes) m[n.id] = n;
    return m;
  }, [nodes]);

  const sessionById = (id: string | null) => sessions.find((s) => s.id === id);

  // Pending drag-edge origin
  const dragEdgeFrom = dragEdge
    ? (() => {
        const fromN = nodeById[dragEdge.fromId];
        return fromN ? nodeAnchorOut(fromN, dragEdge.branch) : null;
      })()
    : null;

  // Toolbar button helper
  const toolbarModeBtn = (m: CanvasMode, icon: IconName, title: string) => (
    <button
      title={title}
      className={mode === m ? 'mode-active' : ''}
      onClick={(e) => { e.stopPropagation(); setMode(mode === m ? 'pan' : m); setGhostPos(null); setDragEdge(null); }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

  const wrapClasses = ['canvas-wrap'];
  if (dragEdge) wrapClasses.push('dragging-edge');
  if (mode !== 'pan' && ghostPos) wrapClasses.push('placing-node');

  return (
    <div
      ref={wrapRef}
      className={wrapClasses.join(' ')}
      onMouseDown={onCanvasMouseDown}
    >
      <div
        className="canvas-stage"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {/* edges */}
        <svg className="canvas-svg" style={{ left: 0, top: 0, width: 4000, height: 2400 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--ink-2)" />
            </marker>
            <marker id="arrow-loopback" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--ink-3)" />
            </marker>
            <marker id="arrow-running" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--running)" />
            </marker>
          </defs>

          {edges.map((e) => {
            const fromN = nodeById[e.from];
            const toN   = nodeById[e.to];
            if (!fromN || !toN) return null;
            const sameSession = isSameSessionContentEdge(e, nodes, edges);
            const from = nodeAnchorOut(fromN, e.branch);
            const to   = nodeAnchorIn(toN);
            const d    = edgePath(from, to, e.loopback);
            const isSelected = selection?.kind === 'edge' && selection.id === e.id;
            const fromState  = runState[e.from];
            const toState    = runState[e.to];
            const active = showRun && fromState === 'success' && (toState === 'running' || toState === 'success');
            const stroke = e.loopback
              ? 'var(--ink-3)'
              : active
                ? 'var(--running)'
                : sameSession ? 'var(--ink-3)' : 'var(--ink-2)';
            const dash = e.loopback
              ? '4 4'
              : active
                ? '6 4'
                : sameSession ? '2 4' : '';
            const markerId = e.loopback ? 'arrow-loopback' : active ? 'arrow-running' : 'arrow';

            return (
              <g key={e.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isSelected ? 1.6 : 1.1}
                  strokeDasharray={dash}
                  markerEnd={`url(#${markerId})`}
                  style={active ? { animation: 'dashflow 1.2s linear infinite' } : undefined}
                />
                <path
                  d={d}
                  className="edge-hover-target"
                  onClick={(ev) => { ev.stopPropagation(); onSelectEdge(e.id); }}
                  onMouseEnter={() => setHoverEdge(e.id)}
                  onMouseLeave={() => setHoverEdge((h) => h === e.id ? null : h)}
                />
              </g>
            );
          })}

          {/* Port-drag live line */}
          {dragEdge && dragEdgeFrom && (
            <path
              d={edgePath(dragEdgeFrom, { x: dragEdge.cursorX, y: dragEdge.cursorY })}
              fill="none"
              stroke="var(--ink-2)"
              strokeWidth={1.4}
              strokeDasharray="4 3"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>

        {/* edge tag badges */}
        {edges.map((e) => {
          const fromN = nodeById[e.from];
          const toN   = nodeById[e.to];
          if (!fromN || !toN) return null;
          const sameSession = isSameSessionContentEdge(e, nodes, edges);

          const from = nodeAnchorOut(fromN, e.branch);
          const to   = nodeAnchorIn(toN);
          const m    = edgeMid(from, to, e.loopback);

          // InputNode→Step edge: show the variable name chip
          if (fromN.kind === 'input') {
            return (
              <div
                key={`tag-${e.id}`}
                className="edge-tag edge-tag-var"
                style={{ left: m.x, top: m.y }}
                title={t('canvas.injectsVariable', { variable: fromN.variableName })}
                onClick={(ev) => { ev.stopPropagation(); onSelectEdge(e.id); }}
              >
                <Icon name="tag" size={9} />&lt;{fromN.variableName}&gt;
              </div>
            );
          }

          if (toN.kind === 'gate') {
            return (
              <div key={`tag-${e.id}`} className="edge-tag" style={{ left: m.x, top: m.y, fontSize: 9.5, opacity: 0.7 }}>
                <Icon name="route" size={9} />{t('canvas.gateInput')}
              </div>
            );
          }

          if (sameSession) {
            return (
              <div
                key={`tag-${e.id}`}
                className="edge-tag"
                style={{ left: m.x, top: m.y, fontSize: 9.5, opacity: 0.7, padding: '1px 5px', cursor: 'default' }}
                title={t('canvas.sameSessionTitle')}
              >
                <Icon name="link" size={9} />{t('canvas.sameSession')}
              </div>
            );
          }

          const isSelected = selection?.kind === 'edge' && selection.id === e.id;
          return (
            <div
              key={`tag-${e.id}`}
              className={`edge-tag${e.outputTag ? '' : ' empty'}${isSelected ? ' selected' : ''}`}
              style={{ left: m.x, top: m.y }}
              onClick={(ev) => { ev.stopPropagation(); onSelectEdge(e.id); }}
            >
              {e.loopback && <Icon name="rotate" size={10} />}
              {e.transmit && e.outputTag ? <span className="tag-key">&lt;specflow_{e.outputTag}&gt;</span> : <span>{t('canvas.noTransfer')}</span>}
            </div>
          );
        })}

        {/* nodes */}
        {nodes.map((n) => {
          const selected = selection?.kind === 'node' && selection.id === n.id;
          if (n.kind === 'gate') return (
            <GateCard
              key={n.id} n={n} selected={selected}
              runState={runState[n.id]}
              onMouseDown={onNodeMouseDown} onSelect={onSelectNode}
              onAddBranch={onAddBranch}
            />
          );
          if (n.kind === 'end') return (
            <EndCard
              key={n.id} n={n} selected={selected}
              onMouseDown={onNodeMouseDown} onSelect={onSelectNode}
            />
          );
          if (n.kind === 'input') return (
            <InputCard
              key={n.id} n={n} selected={selected}
              onMouseDown={onNodeMouseDown} onSelect={onSelectNode}
            />
          );
          return (
            <StepCard
              key={n.id} n={n}
              session={sessionById(n.sessionId)}
              selected={selected}
              runState={runState[n.id]}
              onMouseDown={onNodeMouseDown} onSelect={onSelectNode}
              onContinue={runState[n.id] === 'paused' ? () => onContinuePausedNode?.(n.id) : undefined}
            />
          );
        })}

        {/* ghost preview while in add mode */}
        {mode !== 'pan' && isEdit && ghostPos && <GhostNode mode={mode} pos={ghostPos} />}

        {/* hover prompt preview */}
        {hoverEdge && (() => {
          const e = edges.find((x) => x.id === hoverEdge);
          if (!e || !e.handoffPrompt) return null;
          const fromN = nodeById[e.from];
          const toN   = nodeById[e.to];
          if (!fromN || !toN) return null;
          const m = edgeMid(nodeAnchorOut(fromN, e.branch), nodeAnchorIn(toN), e.loopback);
          return (
            <div className="edge-preview" style={{ left: m.x + 20, top: m.y + 14 }}>
              <span className="pp-label">{t('canvas.handoffPrompt')}</span>
              {e.handoffPrompt}
            </div>
          );
        })()}
      </div>

      {/* Empty-state hint */}
      {isEdit && nodes.length === 0 && (
        <div className="canvas-empty-hint">
          <div className="hint-card">
            <Icon name="sparkle" size={16} />
            <strong>{t('canvas.emptyWorkflow')}</strong>
            <div className="hint-line">{t('canvas.emptyHintPlace')}</div>
            <div className="hint-line muted">{t('canvas.emptyHintConnect')}</div>
          </div>
        </div>
      )}

      {/* toolbar — only in edit view */}
      {isEdit && (
        <div className="canvas-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          {toolbarModeBtn('add-step', 'plus', t('canvas.addStepTitle'))}
          {toolbarModeBtn('add-gate', 'route', t('canvas.addGateTitle'))}
          {toolbarModeBtn('add-end', 'check', t('canvas.addEndTitle'))}
          {toolbarModeBtn('add-input', 'tag', t('canvas.addRunInputTitle'))}
          <div className="divider" />
          <button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))} title={t('canvas.zoomOut')}>
            <Icon name="zoom-out" size={13} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(1.6, zoom + 0.1))} title={t('canvas.zoomIn')}>
            <Icon name="zoom-in" size={13} />
          </button>
          <button title={t('canvas.fitToView')} onClick={fitToView}>
            <Icon name="fit" size={13} />
          </button>
        </div>
      )}
      {!isEdit && (
        <div className="canvas-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))} title={t('canvas.zoomOut')}>
            <Icon name="zoom-out" size={13} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(1.6, zoom + 0.1))} title={t('canvas.zoomIn')}>
            <Icon name="zoom-in" size={13} />
          </button>
          <button title={t('canvas.fitToView')} onClick={fitToView}>
            <Icon name="fit" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── ghost preview ─────────────────────────────────────────────────────────────

function GhostNode({ mode, pos }: { mode: CanvasMode; pos: { x: number; y: number } }) {
  const { t } = useI18n();
  if (mode === 'add-step') {
    return (
      <div className="ghost-node ghost-step" style={{ left: pos.x - 110, top: pos.y - 60, width: 220 }}>
        <div className="ghost-head">{t('canvas.step')}</div>
        <div className="ghost-title">{t('canvas.untitled')}</div>
      </div>
    );
  }
  if (mode === 'add-gate') {
    return (
      <div className="ghost-node ghost-gate" style={{ left: pos.x - 110, top: pos.y - 55, width: 220, height: 110 }}>
        <div className="ghost-head"><Icon name="route" size={10} /> {t('canvas.gateBranches', { count: 2 })}</div>
        <div className="ghost-title">{t('canvas.decision')}</div>
      </div>
    );
  }
  if (mode === 'add-input') {
    return (
      <div className="ghost-node ghost-input" style={{ left: pos.x - 100, top: pos.y - 36, width: 200 }}>
        <div className="ghost-head"><Icon name="tag" size={10} /> {t('canvas.runInput')}</div>
        <div className="ghost-title">&lt;specflow_var&gt;</div>
      </div>
    );
  }
  return (
    <div className="ghost-node ghost-end" style={{ left: pos.x - 30, top: pos.y - 18, width: 80 }}>
      <Icon name="check" size={11} />{t('canvas.end')}
    </div>
  );
}
