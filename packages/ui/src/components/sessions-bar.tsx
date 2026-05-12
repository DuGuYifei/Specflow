import { useState, useEffect, useRef } from 'react';
import type { Session, WorkflowNode, LogLine, Variable } from '../types';
import { Icon } from './icon';

interface SessionsBarProps {
  sessions: Session[];
  nodes: WorkflowNode[];
  expanded: boolean;
  setExpanded: (b: boolean) => void;
  barHeight: number;
  setBarHeight: (h: number) => void;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  onAssignSession: (nodeId: string, sessionId: string) => void;
  addSessionPing: number;
  logLines?: LogLine[];
  onAddSession: (name: string, agent: Session['agent']) => void;
  onDeleteSession: (id: string) => void;
  onClearLogs: () => void;
  variables: Variable[];
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  readonly?: boolean;
}

export function SessionsBar({
  sessions, nodes,
  expanded, setExpanded,
  barHeight, setBarHeight,
  activeSessionId, setActiveSessionId,
  onAssignSession, addSessionPing,
  logLines,
  onAddSession, onDeleteSession, onClearLogs,
  variables, onEditVariable,
  readonly,
}: SessionsBarProps) {
  const [tab, setTab] = useState<'logs' | 'settings' | 'vars'>('logs');
  const barHeightRef = useRef(barHeight);
  const stepNodes = nodes.filter((n) => n.kind === 'step');
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  useEffect(() => { barHeightRef.current = barHeight; }, [barHeight]);

  useEffect(() => {
    if (addSessionPing) setTab('settings');
  }, [addSessionPing]);

  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = barHeightRef.current;
    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY;
      setBarHeight(Math.min(600, Math.max(120, startH + dy)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!expanded) {
    return (
      <div className="sessions-bar" style={{ height: 32 }}>
        <div className="sessions-head">
          <button className="bar-handle" onClick={() => setExpanded(true)} style={{ marginRight: 4 }}>
            <Icon name="chevron-up" size={12} />
          </button>
          <span className="title">
            <Icon name="terminal" size={11} style={{ verticalAlign: -2, marginRight: 4 }} />Sessions
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {sessions.length} sessions · {stepNodes.length} nodes
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>activity:</span>
          {sessions.slice(0, 4).map((s) => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--ink-2)' }}>
              <span className="ses-dot" style={{ width: 6, height: 6, borderRadius: 2, background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-bar" style={{ height: barHeight }}>
      {/* resize handle — drag up to grow, drag down to shrink */}
      <div
        className="bar-resize-handle"
        onMouseDown={onResizeDown}
        title="Drag to resize"
      />
      <div className="sessions-head">
        <button className="bar-handle" onClick={() => setExpanded(false)} style={{ marginRight: 4 }}>
          <Icon name="chevron-down" size={12} />
        </button>
        <div className="bar-tabs">
          <button className={`bar-tab${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>
            <Icon name="terminal" size={11} />Logs
          </button>
          <button className={`bar-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <Icon name="settings" size={11} />Sessions
            <span className="count">{sessions.length}</span>
          </button>
          <button className={`bar-tab${tab === 'vars' ? ' active' : ''}`} onClick={() => setTab('vars')}>
            <Icon name="tag" size={11} />Variables
            {variables.length > 0 && <span className="count">{variables.length}</span>}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'logs' && (
          <button className="bar-handle" title="Clear logs" onClick={onClearLogs}>
            <Icon name="trash" size={11} />
          </button>
        )}
      </div>

      {tab === 'logs' && (
        <LogsTab
          sessions={sessions}
          activeSession={activeSession}
          setActiveSessionId={setActiveSessionId}
          stepNodes={stepNodes}
          logLines={logLines}
          onDeleteSession={onDeleteSession}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          sessions={sessions}
          stepNodes={stepNodes}
          onAssignSession={onAssignSession}
          addSessionPing={addSessionPing}
          onAddSession={onAddSession}
          onDeleteSession={onDeleteSession}
        />
      )}
      {tab === 'vars' && (
        <VariablesTab
          variables={variables}
          onEditVariable={onEditVariable}
          readonly={readonly}
        />
      )}
    </div>
  );
}

// ── logs tab ──────────────────────────────────────────────────────────────────

interface LogsTabProps {
  sessions: Session[];
  activeSession: Session;
  setActiveSessionId: (id: string) => void;
  stepNodes: WorkflowNode[];
  logLines?: LogLine[];
  onDeleteSession: (id: string) => void;
}

function LogsTab({ sessions, activeSession, setActiveSessionId, stepNodes, logLines, onDeleteSession }: LogsTabProps) {
  const [sideW, setSideW] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem('sf-side-w') ?? '', 10);
      return Number.isFinite(saved) ? Math.min(360, Math.max(140, saved)) : 180;
    } catch { return 180; }
  });
  const [dragging, setDragging] = useState(false);
  const sideWRef = useRef(sideW);

  useEffect(() => {
    sideWRef.current = sideW;
    try { localStorage.setItem('sf-side-w', String(sideW)); } catch { /* ignore */ }
  }, [sideW]);

  const onResizerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = sideWRef.current;
    const onMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX;
      setSideW(Math.min(360, Math.max(140, startW + dx)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const termRef = useRef<HTMLDivElement>(null);
  const prevLinesLen = useRef(0);
  useEffect(() => {
    if (logLines && logLines.length > prevLinesLen.current && termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
    prevLinesLen.current = logLines?.length ?? 0;
  }, [logLines]);

  return (
    <div className="sessions-body logs">
      <div className="term-pane">
        <div className="term-header">
          <span className="ses-dot" style={{ width: 8, height: 8, borderRadius: 2, background: activeSession?.color }} />
          <strong style={{ fontSize: 11.5 }}>{activeSession?.name}</strong>
          <span className="agent-badge">
            <span className="dot" style={{ background: activeSession?.color }} />{activeSession?.agent}
          </span>
          <span style={{ color: 'var(--ink-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
            · {stepNodes.filter((n) => n.kind === 'step' && n.sessionId === activeSession?.id).length} nodes
          </span>
        </div>
        <div className="term-stream" ref={termRef}>
          {logLines && logLines.length > 0 ? (
            logLines.map((line, i) => (
              <div key={i} className="term-line">
                <span className="lvl">[out]</span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line.chunk}</span>
              </div>
            ))
          ) : (
            <>
              <div className="term-line"><span className="ts">-</span><span className="lvl">[sys]</span><span>No run output yet. Click Start run when the workflow is ready.</span></div>
              <div className="term-line">
                <span className="ts">—</span>
                <span style={{ color: 'var(--ink-3)' }}>·</span>
                <span style={{ animation: 'blink 1s steps(2) infinite' }}>▎</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div
        className={`term-resizer${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizerDown}
        title="Drag to resize"
      />
      <div className="term-sidebar" style={{ width: sideW }}>
        <div className="term-sidebar-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Sessions</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-4)' }}>{sessions.length}</span>
        </div>
        <div className="term-sidebar-list">
          {sessions.map((s) => {
            const count = stepNodes.filter((n) => n.kind === 'step' && n.sessionId === s.id).length;
            const isActive = s.id === activeSession?.id;
            return (
              <div
                key={s.id}
                className={`term-ses-item${isActive ? ' active' : ''}`}
                onClick={() => setActiveSessionId(s.id)}
              >
                <span className="ses-dot" style={{ background: s.color }} />
                <span className="name">{s.name}</span>
                <span className="count">{count}</span>
                <button
                  className="ses-del"
                  title="Delete session"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                >
                  <Icon name="x" size={10} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── settings tab ──────────────────────────────────────────────────────────────

interface SettingsTabProps {
  sessions: Session[];
  stepNodes: WorkflowNode[];
  onAssignSession: (nodeId: string, sessionId: string) => void;
  addSessionPing: number;
  onAddSession: (name: string, agent: Session['agent']) => void;
  onDeleteSession: (id: string) => void;
}

// ── variables tab ─────────────────────────────────────────────────────────────

interface VariablesTabProps {
  variables: Variable[];
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  readonly?: boolean;
}

function VariablesTab({ variables, onEditVariable, readonly }: VariablesTabProps) {
  if (variables.length === 0) {
    return (
      <div className="sessions-body settings">
        <div style={{ padding: '12px 16px', color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          No input variables declared.<br />
          Add a <strong>Run input</strong> node on the canvas and connect it to a step; its variable will appear here for editing.
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-body settings">
      <div className="assn-list" style={{ overflow: 'auto', flex: 1 }}>
        <div className="assn-list-head">
          <span>Variable (from canvas)</span>
          <span>Default value</span>
          <span>Description</span>
        </div>
        {variables.map((v) => (
          <div key={v.name} className="assn-row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-2)', flexShrink: 0, minWidth: 120 }}>
              &lt;{v.name}&gt;
            </span>
            <input
              className="input"
              value={v.defaultValue ?? ''}
              disabled={readonly}
              placeholder="—"
              onChange={(e) => onEditVariable(v.name, { defaultValue: e.target.value || undefined })}
              style={{ flex: 1, minWidth: 80 }}
            />
            <input
              className="input"
              value={v.description ?? ''}
              disabled={readonly}
              placeholder="—"
              onChange={(e) => onEditVariable(v.name, { description: e.target.value || undefined })}
              style={{ flex: 2 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsTab({ sessions, stepNodes, onAssignSession, addSessionPing, onAddSession, onDeleteSession }: SettingsTabProps) {
  const [draftName, setDraftName] = useState('');
  const [draftAgent, setDraftAgent] = useState<Session['agent']>('claude-code');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addSessionPing && inputRef.current) {
      const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 60);
      return () => clearTimeout(t);
    }
  }, [addSessionPing]);

  const handleAdd = () => {
    const name = draftName.trim();
    if (!name) return;
    onAddSession(name, draftAgent);
    setDraftName('');
  };

  return (
    <div className="sessions-body settings">
      <div className="add-session-row">
        <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginRight: 4 }}>
          New agent session
        </span>
        <input
          ref={inputRef}
          className="input sm"
          placeholder="session name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          style={{ width: 180, height: 26 }}
        />
        <div className="seg" style={{ height: 26 }}>
          <button className={draftAgent === 'claude-code' ? 'active' : ''} onClick={() => setDraftAgent('claude-code')}>Claude</button>
          <button className={draftAgent === 'codex'       ? 'active' : ''} onClick={() => setDraftAgent('codex')}>Codex</button>
          <button className={draftAgent === 'mock'        ? 'active' : ''} onClick={() => setDraftAgent('mock')}>Mock</button>
        </div>
        <button className="btn sm primary" onClick={handleAdd}><Icon name="plus" size={11} />Add</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{sessions.length} sessions</span>
      </div>

      <div className="session-list-row">
        <span className="label">Sessions</span>
        {sessions.map((s) => (
          <span key={s.id} className="session-chip">
            <span className="ses-dot" style={{ background: s.color }} />
            {s.name}
            <span className="agent">{s.agent}</span>
            <button className="ses-x" title={`Delete ${s.name}`} onClick={() => onDeleteSession(s.id)}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
      </div>

      <div className="assn-list">
        <div className="assn-list-head">
          <span>Node</span>
          <span>Session assignment</span>
        </div>
        {(stepNodes.filter((n) => n.kind === 'step') as Extract<WorkflowNode, { kind: 'step' }>[]).map((n) => (
          <div key={n.id} className="assn-row">
            <div className="nbox">
              <span className="nid">{n.num}</span>
              <span className="nname">{n.title}</span>
            </div>
            <div className="session-pick">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className={n.sessionId === s.id ? 'active' : ''}
                  onClick={() => onAssignSession(n.id, s.id)}
                >
                  <span className="ses-dot" style={{ background: s.color }} />{s.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
