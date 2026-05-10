import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import type { WorkflowNode, Edge, Session, Selection, RunStateMap, GateNode } from '../types';
import { Icon } from './icon';

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
  return { x: n.x + (n.w || 220), y: n.y + 60 };
}

function nodeAnchorIn(n: WorkflowNode): { x: number; y: number } {
  if (n.kind === 'gate') return { x: n.x, y: n.y + 110 / 2 };
  if (n.kind === 'end')  return { x: n.x - 2, y: n.y + 18 };
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

// Approximate rendered heights per node kind (used for bounding-box fit).
const NODE_H: Record<string, number> = { step: 120, gate: 110, end: 36 };

// ── node cards ────────────────────────────────────────────────────────────────

interface StepCardProps {
  n: Extract<WorkflowNode, { kind: 'step' }>;
  session: Session | undefined;
  selected: boolean;
  runState: string | undefined;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onSelect: (id: string) => void;
}

function StepCard({ n, session, selected, runState, onMouseDown, onSelect }: StepCardProps) {
  const cls = ['node'];
  if (selected)           cls.push('selected');
  if (runState === 'running') cls.push('running');
  if (runState === 'success') cls.push('success');
  if (runState === 'error')   cls.push('error');
  if (n.locked)           cls.push('locked');

  return (
    <div
      className={cls.join(' ')}
      data-session={n.sessionId || ''}
      style={{ left: n.x, top: n.y, width: n.w, '--session-color': session?.color || 'var(--ink-3)' } as React.CSSProperties}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
    >
      <div className="node-head">
        <span className="node-id">{n.num}</span>
        {n.locked && <span className="lock-badge"><Icon name="lock" size={10} /></span>}
        {n.updateDoc && (
          <span className="doc-badge" title="Updates SPECFLOW.md after this step">
            <Icon name="file" size={9} />doc
          </span>
        )}
        <span className="node-state-icon">
          {runState === 'running' && <><Icon name="loader" size={11} style={{ animation: 'spin 1.4s linear infinite' }} />running</>}
          {runState === 'success' && <><Icon name="check"  size={11} style={{ color: 'oklch(0.55 0.13 145)' }} />done</>}
          {runState === 'error'   && <><Icon name="alert"  size={11} style={{ color: 'var(--err)' }} />failed</>}
          {runState === 'pending' && <span style={{ color: 'var(--ink-3)' }}>queued</span>}
        </span>
      </div>
      <h3 className="node-title">{n.title}</h3>
      <p className="node-desc">{n.desc}</p>
      <div className="node-meta">
        {(n.attachments || []).map((a, i) => (
          <span className="chip attach" key={i}><Icon name="image" size={10} />{a.label}</span>
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
}

function GateCard({ n, selected, runState, onMouseDown, onSelect }: GateCardProps) {
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
          <span className="gate-sub"><Icon name="route" size={10} /> gate · {branches.length} branches</span>
        </div>
        <h3 className="gate-title">{n.title}</h3>
      </div>
      <div className="gate-port-in" />
      {branches.map((b, i) => {
        const total = branches.length + 1;
        const t = (i + 1) / (total + 1);
        const top = h * t - 6;
        return (
          <div key={b.id} className={`gate-port-out ${b.id}`} style={{ right: -7, top }}>
            <span className="pl">{b.label}</span>
          </div>
        );
      })}
      <div
        className="gate-port-add"
        style={{ right: -8, top: h * (branches.length + 1) / (branches.length + 2) - 7 }}
        title="Add branch"
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
  const cls = ['end-node'];
  if (selected) cls.push('selected');

  return (
    <div
      className={cls.join(' ')}
      style={{ left: n.x, top: n.y }}
      onMouseDown={(e) => onMouseDown(e, n.id)}
      onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
    >
      <Icon name="check" size={11} />{n.title || 'End'}
    </div>
  );
}

// ── canvas ────────────────────────────────────────────────────────────────────

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
  zoom: number;
  setZoom: (z: number) => void;
  pan: { x: number; y: number };
  setPan: (p: { x: number; y: number }) => void;
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'node'; nodeId: string; startX: number; startY: number; nx: number; ny: number };

export function Canvas({
  nodes, edges, sessions,
  selection, onSelectNode, onSelectEdge, onClearSelection,
  runState, showRun, onNodeMove,
  zoom, setZoom, pan, setPan,
}: CanvasProps) {
  const dragRef = useRef<DragState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  zoomRef.current = zoom;
  panRef.current  = pan;

  // Compute zoom + pan to fit all nodes inside the visible canvas area.
  const fitToView = useCallback(() => {
    if (!wrapRef.current || nodes.length === 0) return;
    const cw = wrapRef.current.clientWidth;
    const ch = wrapRef.current.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const w = n.w || 220;
      const h = NODE_H[n.kind] ?? 120;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }

    const pad = 64;
    const z = Math.min(1.4, Math.max(0.3,
      Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxY - minY)),
    ));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(z);
    setPan({ x: cw / 2 - cx * z, y: ch / 2 - cy * z });
  }, [nodes, setZoom, setPan]);

  // Fit on first render once the DOM has measured.
  useEffect(() => {
    const t = setTimeout(fitToView, 0);
    return () => clearTimeout(t);
  // Intentionally only on mount — nodes ref is stable at load time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Non-passive wheel listener so preventDefault actually stops page scroll.
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

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('.node, .gate-wrap, .end-node, .edge-tag, .canvas-toolbar, .edge-hover-target')) return;
    dragRef.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    onClearSelection();
  };

  const onNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    const target = e.target as Element;
    if (
      target.classList.contains('port') ||
      target.classList.contains('gate-port-out') ||
      target.classList.contains('gate-port-add') ||
      target.classList.contains('gate-port-in')
    ) return;
    e.stopPropagation();
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    dragRef.current = { kind: 'node', nodeId, startX: e.clientX, startY: e.clientY, nx: n.x, ny: n.y };
    onSelectNode(nodeId);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'pan') {
        setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
      } else if (d.kind === 'node') {
        const dx = (e.clientX - d.startX) / zoom;
        const dy = (e.clientY - d.startY) / zoom;
        onNodeMove(d.nodeId, d.nx + dx, d.ny + dy);
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, onNodeMove, setPan]);

  const nodeById = useMemo(() => {
    const m: Record<string, WorkflowNode> = {};
    for (const n of nodes) m[n.id] = n;
    return m;
  }, [nodes]);

  const sessionById = (id: string | null) => sessions.find((s) => s.id === id);

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
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
                : e.sameSession ? 'var(--ink-3)' : 'var(--ink-2)';
            const dash = e.loopback
              ? '4 4'
              : active
                ? '6 4'
                : e.sameSession ? '2 4' : '';
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
        </svg>

        {/* edge tag badges */}
        {edges.map((e) => {
          const fromN = nodeById[e.from];
          const toN   = nodeById[e.to];
          if (!fromN || !toN) return null;
          if (fromN.kind === 'gate') return null;

          const from = nodeAnchorOut(fromN, e.branch);
          const to   = nodeAnchorIn(toN);
          const m    = edgeMid(from, to, e.loopback);

          if (e.sameSession) {
            return (
              <div
                key={`tag-${e.id}`}
                className="edge-tag"
                style={{ left: m.x, top: m.y, fontSize: 9.5, opacity: 0.7, padding: '1px 5px', cursor: 'default' }}
                title="Same session — handoff is implicit"
              >
                <Icon name="link" size={9} />same session
              </div>
            );
          }

          const isSelected = selection?.kind === 'edge' && selection.id === e.id;
          return (
            <div
              key={`tag-${e.id}`}
              className={`edge-tag${e.tag ? '' : ' empty'}${isSelected ? ' selected' : ''}`}
              style={{ left: m.x, top: m.y }}
              onClick={(ev) => { ev.stopPropagation(); onSelectEdge(e.id); }}
            >
              {e.loopback && <Icon name="rotate" size={10} />}
              {e.tag ? <span className="tag-key">&lt;{e.tag}&gt;</span> : <span>+ tag</span>}
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
            />
          );
          if (n.kind === 'end') return (
            <EndCard
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
            />
          );
        })}

        {/* hover prompt preview */}
        {hoverEdge && (() => {
          const e = edges.find((x) => x.id === hoverEdge);
          if (!e || !e.prompt || e.sameSession) return null;
          const fromN = nodeById[e.from];
          const toN   = nodeById[e.to];
          if (!fromN || !toN) return null;
          const m = edgeMid(nodeAnchorOut(fromN, e.branch), nodeAnchorIn(toN), e.loopback);
          return (
            <div className="edge-preview" style={{ left: m.x + 20, top: m.y + 14 }}>
              <span className="pp-label">handoff prompt</span>
              {e.prompt}
            </div>
          );
        })()}
      </div>

      {/* toolbar */}
      <div className="canvas-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <button title="Hand / pan"><Icon name="hand" size={14} /></button>
        <button title="Connect"><Icon name="connect" size={14} /></button>
        <button title="Add step"><Icon name="plus" size={14} /></button>
        <button title="Add gate"><Icon name="route" size={14} /></button>
        <button title="Add end"><Icon name="check" size={14} /></button>
        <div className="divider" />
        <button onClick={() => setZoom(Math.max(0.3, zoom - 0.1))}>
          <Icon name="zoom-out" size={13} />
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(1.6, zoom + 0.1))}>
          <Icon name="zoom-in" size={13} />
        </button>
        <button title="Fit" onClick={fitToView}>
          <Icon name="fit" size={13} />
        </button>
      </div>
    </div>
  );
}
