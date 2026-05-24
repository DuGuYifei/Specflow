import { useState, useEffect, useRef } from 'react';
import type { Session, WorkflowNode, LogLine, Variable } from '../types';
import type { AgentServerEntry, AgentSessionRecord, PausedNodeSession, RestoreMode } from '../api';
import { Icon } from './icon';
import { isSymbolKey, sessionAccent } from '../appearance';
import type { ConversationLine } from './agent-conversation-window';

const UNSCOPED_SESSION_FILTER = '__unscoped__';

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
  onAddSession: (name: string, agentServerId: Session['agentServerId']) => void;
  onEditSession: (id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => void;
  onDeleteSession: (id: string) => void;
  onClearLogs: () => void;
  variables: Variable[];
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  agentSessions?: AgentSessionRecord[];
  agentServers?: AgentServerEntry[];
  runs?: Array<{ id: string; label: string }>;
  onOpenInvocationLog?: (runId: string, nodeId?: string, specflowSessionId?: string) => void;
  onRestoreSession?: (session: AgentSessionRecord, mode: RestoreMode) => void;
  restoreStatusBySession?: Record<string, string>;
  pausedNode?: PausedNodeSession | null;
  pausedLines?: ConversationLine[];
  pausedPromptBusy?: boolean;
  onPromptPausedNode?: (prompt: string) => void;
  onContinuePausedNode?: () => void;
  readonly?: boolean;
}

export function SessionsBar({
  sessions, nodes,
  expanded, setExpanded,
  barHeight, setBarHeight,
  activeSessionId, setActiveSessionId,
  onAssignSession, addSessionPing,
  logLines,
  onAddSession, onEditSession, onDeleteSession, onClearLogs,
  variables, onEditVariable,
  agentSessions = [], agentServers = [], runs = [],
  onOpenInvocationLog, onRestoreSession,
  restoreStatusBySession = {},
  pausedNode, pausedLines = [], pausedPromptBusy = false,
  onPromptPausedNode, onContinuePausedNode,
  readonly,
}: SessionsBarProps) {
  const [tab, setTab] = useState<'logs' | 'agent-sessions' | 'settings' | 'vars'>('logs');
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
              <span className="ses-dot" style={{ width: 6, height: 6, borderRadius: 2, background: sessionAccent(s) }} />{s.name}
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
          <button className={`bar-tab${tab === 'agent-sessions' ? ' active' : ''}`} onClick={() => setTab('agent-sessions')}>
            <Icon name="history" size={11} />Agent Sessions
            {agentSessions.length > 0 && <span className="count">{agentSessions.length}</span>}
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
          pausedNode={pausedNode}
          pausedLines={pausedLines}
          pausedPromptBusy={pausedPromptBusy}
          onPromptPausedNode={onPromptPausedNode}
          onContinuePausedNode={onContinuePausedNode}
        />
      )}
      {tab === 'agent-sessions' && (
        <AgentSessionsTab
          agentSessions={agentSessions}
          runs={runs}
          onOpenInvocationLog={onOpenInvocationLog}
          onRestoreSession={onRestoreSession}
          restoreStatusBySession={restoreStatusBySession}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          sessions={sessions}
          stepNodes={stepNodes}
          onAssignSession={onAssignSession}
          addSessionPing={addSessionPing}
          onAddSession={onAddSession}
          onEditSession={onEditSession}
          onDeleteSession={onDeleteSession}
          agentServers={agentServers}
          readonly={readonly}
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
  pausedNode?: PausedNodeSession | null;
  pausedLines: ConversationLine[];
  pausedPromptBusy: boolean;
  onPromptPausedNode?: (prompt: string) => void;
  onContinuePausedNode?: () => void;
}

function LogsTab({
  sessions, activeSession, setActiveSessionId, stepNodes, logLines, onDeleteSession,
  pausedNode, pausedLines, pausedPromptBusy, onPromptPausedNode, onContinuePausedNode,
}: LogsTabProps) {
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

  const activeNodeIds = new Set(
    stepNodes.filter((n) => n.kind === 'step' && n.sessionId === activeSession?.id).map((n) => n.id),
  );
  const nodeById = new Map(stepNodes.map((n) => [n.id, n]));
  const visibleLines = (logLines ?? []).filter((line) => !line.nodeId || activeNodeIds.has(line.nodeId));

  return (
    <div className="sessions-body logs">
      <div className="term-pane">
        <div className="term-header">
          <span className="ses-dot" style={{ width: 8, height: 8, borderRadius: 2, background: activeSession ? sessionAccent(activeSession) : 'var(--ink-3)' }} />
          <strong style={{ fontSize: 11.5 }}>{activeSession?.name}</strong>
          <span className="agent-badge">
            <span className="dot" style={{ background: activeSession ? sessionAccent(activeSession) : 'var(--ink-3)' }} />{activeSession?.agentServerId ?? activeSession?.agent}
          </span>
          <span style={{ color: 'var(--ink-3)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>
            · {stepNodes.filter((n) => n.kind === 'step' && n.sessionId === activeSession?.id).length} nodes
          </span>
        </div>
        <div className="term-stream" ref={termRef}>
          {visibleLines.length > 0 ? (
            visibleLines.map((line, i) => {
              const node = line.nodeId ? nodeById.get(line.nodeId) : undefined;
              return (
              <div key={i} className="term-line">
                <span className={`lvl ${line.stream ?? 'stdout'}`}>[{line.stream === 'stderr' ? 'err' : line.stream === 'system' ? 'sys' : 'out'}]</span>
                {node && <span className="node-ref">{node.num}</span>}
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line.chunk}</span>
              </div>
              );
            })
          ) : (
            <>
              <div className="term-line"><span className="ts">-</span><span className="lvl">[sys]</span><span>{logLines && logLines.length > 0 ? 'No output for this session.' : 'No run output yet. Click Start run when the workflow is ready.'}</span></div>
              <div className="term-line">
                <span className="ts">—</span>
                <span style={{ color: 'var(--ink-3)' }}>·</span>
                <span style={{ animation: 'blink 1s steps(2) infinite' }}>▎</span>
              </div>
            </>
          )}
        </div>
        {pausedNode?.specflowSessionId === activeSession?.id && (
          <PausedNodeComposer
            node={stepNodes.find((candidate) => candidate.id === pausedNode.nodeId)}
            lines={pausedLines}
            busy={pausedPromptBusy}
            onPrompt={onPromptPausedNode}
            onContinue={onContinuePausedNode}
          />
        )}
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
                <span className="ses-dot" style={{ background: sessionAccent(s) }} />
                <span className="name">{s.name}</span>
                <span className="count">{count}</span>
                <button
                  className="ses-del"
                  title="Delete session"
                  disabled={sessions.length <= 1}
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

function PausedNodeComposer(props: {
  node?: WorkflowNode;
  lines: ConversationLine[];
  busy: boolean;
  onPrompt?: (prompt: string) => void;
  onContinue?: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const submit = () => {
    if (!prompt.trim() || props.busy) return;
    props.onPrompt?.(prompt.trim());
    setPrompt('');
  };
  return (
    <div className="paused-composer">
      <div className="paused-composer-head">
        <span><Icon name="pause" size={11} /> Paused after {props.node?.title ?? 'node'}</span>
        <button className="btn sm primary" disabled={props.busy} onClick={props.onContinue}>
          <Icon name="play" size={10} />Continue workflow
        </button>
      </div>
      {props.lines.length > 0 && (
        <div className="paused-transcript">
          {props.lines.map((line, index) => (
            <div key={index} className={`paused-message ${line.role}`}>
              <strong>{line.role}</strong> {line.text}
            </div>
          ))}
        </div>
      )}
      <div className="paused-compose-input">
        <textarea
          className="textarea"
          rows={2}
          value={prompt}
          disabled={props.busy}
          placeholder="Send a prompt to the paused agent session..."
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
        />
        <button className="btn sm" disabled={props.busy || !prompt.trim()} onClick={submit}>
          {props.busy ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ── agent sessions tab ─────────────────────────────────────────────────────────

interface AgentSessionsTabProps {
  agentSessions: AgentSessionRecord[];
  runs: Array<{ id: string; label: string }>;
  onOpenInvocationLog?: (runId: string, nodeId?: string, specflowSessionId?: string) => void;
  onRestoreSession?: (session: AgentSessionRecord, mode: RestoreMode) => void;
  restoreStatusBySession: Record<string, string>;
}

function AgentSessionsTab({
  agentSessions,
  runs,
  onOpenInvocationLog,
  onRestoreSession,
  restoreStatusBySession,
}: AgentSessionsTabProps) {
  const [agentFilter, setAgentFilter] = useState('');
  const [workflowSessionFilter, setWorkflowSessionFilter] = useState('');
  const knownRuns = new Set(runs.map((run) => run.id));
  const runLabelById = new Map(runs.map((run) => [run.id, run.label]));
  const agentIds = [...new Set(agentSessions.map((session) => session.agentServerId))].sort();
  const selectedAgentId = agentIds.includes(agentFilter) ? agentFilter : agentIds[0] ?? '';
  const agentScopedSessions = agentSessions.filter((session) => session.agentServerId === selectedAgentId);
  const workflowSessionIds = [...new Set(agentScopedSessions.map((session) => session.specflowSessionId ?? ''))].sort();
  const selectedWorkflowSession =
    workflowSessionFilter === UNSCOPED_SESSION_FILTER && workflowSessionIds.includes('')
      ? UNSCOPED_SESSION_FILTER
      : workflowSessionIds.includes(workflowSessionFilter) ? workflowSessionFilter : '';
  const visibleSessions = agentScopedSessions.filter((session) =>
    !selectedWorkflowSession
      || (selectedWorkflowSession === UNSCOPED_SESSION_FILTER
        ? !session.specflowSessionId
        : session.specflowSessionId === selectedWorkflowSession)
  );
  const groupedSessions = groupAgentSessionsByLogicalSession(visibleSessions);

  return (
    <div className="sessions-body agent-sessions">
      <div className="history-filters">
        <label className="history-filter">
          <span>Agent</span>
          <select
            className="input agent-session-agent-select"
            value={selectedAgentId}
            disabled={agentIds.length === 0}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setWorkflowSessionFilter('');
            }}
          >
            {agentIds.length === 0 && <option value="">No agents</option>}
            {agentIds.map((agentId) => (
              <option key={agentId} value={agentId}>{agentId}</option>
            ))}
          </select>
        </label>
        <label className="history-filter">
          <span>Workflow session</span>
          <select
            className="input agent-session-workflow-select"
            value={selectedWorkflowSession}
            disabled={workflowSessionIds.length === 0}
            onChange={(e) => setWorkflowSessionFilter(e.target.value)}
          >
            <option value="">All sessions</option>
            {workflowSessionIds.filter(Boolean).map((sessionId) => (
              <option key={sessionId} value={sessionId}>{sessionId}</option>
            ))}
            {workflowSessionIds.includes('') && <option value={UNSCOPED_SESSION_FILTER}>Unscoped</option>}
          </select>
        </label>
        {selectedAgentId && (
          <div className="history-agent-summary">
            <span className="agent-badge"><span className="dot" />{selectedAgentId}</span>
            <span>{agentScopedSessions.length} runtime sessions</span>
          </div>
        )}
      </div>

      <div className="history-list">
        {groupedSessions.length === 0 && (
          <div className="history-empty">
            No ACP sessions for the selected agent and workflow session.
          </div>
        )}

        {groupedSessions.map((group) => (
          <section key={group.id} className="history-session-group">
            <div className="history-session-group-head">
              <span>Workflow session</span>
              <span className="mono-id">{group.id || 'unscoped'}</span>
              <span className="count">{group.sessions.length}</span>
            </div>
            <div className="history-session-cards">
              {group.sessions.map((session) => {
                const latestRunMissing = !knownRuns.has(session.latestRunId);
                const status = restoreStatusBySession[session.id];
                return (
                  <div key={session.id} className="history-card">
                    <div className="history-card-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="history-title">
                          <span className="mono-id">{session.acpSessionId}</span>
                        </div>
                        <div className="history-meta">
                          <span>{session.invocations.length} invocations</span>
                          <span>·</span>
                          <span>{formatShortDate(session.lastSeenAt)}</span>
                          {session.parentSpecflowSessionId && <span>· fork of {session.parentSpecflowSessionId}</span>}
                        </div>
                      </div>
                      <div className="history-actions">
                        <CapabilityBadge label="load" enabled={session.acpSupportsLoadSession} />
                        <CapabilityBadge label="resume" enabled={session.acpSupportsResumeSession} />
                        <CapabilityBadge label="fork" enabled={session.acpSupportsForkSession} />
                        <button
                          className="btn sm"
                          disabled={!session.acpSupportsLoadSession && !session.acpSupportsResumeSession}
                          onClick={() => onRestoreSession?.(session, 'inspect')}
                          title="Inspect historical session"
                        >
                          <Icon name="search" size={10} />Inspect
                        </button>
                        <button
                          className="btn sm primary"
                          disabled={!session.acpSupportsLoadSession && !session.acpSupportsResumeSession}
                          onClick={() => onRestoreSession?.(session, 'continue')}
                          title="Resume historical session"
                        >
                          <Icon name="play-circle" size={10} />Resume
                        </button>
                      </div>
                    </div>

                    {status && (
                      <div className={`history-restore-status ${status === 'failure' ? 'failed' : ''}`}>
                        restore: {status}
                      </div>
                    )}

                    <div className="history-invocations">
                      {session.invocations.slice(-4).reverse().map((ref) => {
                        const runMissing = !knownRuns.has(ref.runId);
                        return (
                          <button
                            key={ref.invocationId}
                            className="history-invocation"
                            disabled={runMissing}
                            onClick={() => onOpenInvocationLog?.(ref.runId, ref.nodeId, session.specflowSessionId)}
                            title={runMissing ? 'Run record was deleted' : 'Open run log'}
                          >
                            <span className={`status-dot ${ref.status === 'done' ? 'success' : ref.status === 'failed' ? 'error' : 'running'}`} />
                            <span className="mono-id">{ref.nodeId ?? ref.edgeId ?? ref.invocationId}</span>
                            <span>{runMissing ? 'missing run' : runLabelById.get(ref.runId) ?? ref.runId}</span>
                          </button>
                        );
                      })}
                    </div>

                    {latestRunMissing && (
                      <div className="history-warning">
                        Latest run reference is unavailable. Older invocation links may still work.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function groupAgentSessionsByLogicalSession(
  sessions: AgentSessionRecord[],
): Array<{ id: string; sessions: AgentSessionRecord[] }> {
  const groups = new Map<string, AgentSessionRecord[]>();
  for (const session of sessions) {
    const id = session.specflowSessionId ?? '';
    groups.set(id, [...(groups.get(id) ?? []), session]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, grouped]) => ({ id, sessions: grouped }));
}

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={`cap-badge${enabled ? ' on' : ''}`}>
      {label}
    </span>
  );
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString([], { month: 'short', day: '2-digit' });
}

// ── settings tab ──────────────────────────────────────────────────────────────

interface SettingsTabProps {
  sessions: Session[];
  stepNodes: WorkflowNode[];
  onAssignSession: (nodeId: string, sessionId: string) => void;
  addSessionPing: number;
  onAddSession: (name: string, agentServerId: Session['agentServerId']) => void;
  onEditSession: (id: string, patch: Partial<Pick<Session, 'name' | 'agentServerId'>>) => void;
  onDeleteSession: (id: string) => void;
  agentServers: AgentServerEntry[];
  readonly?: boolean;
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

function SettingsTab({ sessions, stepNodes, onAssignSession, addSessionPing, onAddSession, onEditSession, onDeleteSession, agentServers, readonly }: SettingsTabProps) {
  const [draftName, setDraftName] = useState('');
  const [draftAgent, setDraftAgent] = useState<Session['agentServerId']>('unconfigured');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingAgent, setEditingAgent] = useState<Session['agentServerId']>('unconfigured');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addSessionPing && inputRef.current) {
      const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 60);
      return () => clearTimeout(t);
    }
  }, [addSessionPing]);

  useEffect(() => {
    if (agentServers.length > 0 && !agentServers.some((server) => server.id === draftAgent)) {
      setDraftAgent(agentServers[0]!.id);
    }
  }, [agentServers, draftAgent]);

  const handleAdd = () => {
    if (readonly) return;
    const name = (inputRef.current?.value ?? draftName).trim();
    if (!isSymbolKey(name) || sessions.some((session) => session.id === name)) return;
    onAddSession(name, draftAgent);
    setDraftName('');
  };

  const startEdit = (session: Session) => {
    setEditingId(session.id);
    setEditingName(session.name);
    setEditingAgent(session.agentServerId ?? session.agent ?? draftAgent);
  };

  const cancelEdit = () => {
    setEditingId('');
    setEditingName('');
  };

  const saveEdit = () => {
    const name = editingName.trim();
    if (!editingId || !isSymbolKey(name) || sessions.some((session) => session.id === name && session.id !== editingId) || readonly) return;
    onEditSession(editingId, { name, agentServerId: editingAgent });
    cancelEdit();
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
          disabled={readonly}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          style={{ width: 180, height: 26 }}
        />
        <select className="input sm" value={draftAgent} disabled={readonly} onChange={(e) => setDraftAgent(e.target.value)} style={{ height: 26, width: 180 }}>
          {agentServers.map((server) => (
            <option key={server.id} value={server.id}>{server.id}</option>
          ))}
        </select>
        <button className="btn sm primary" disabled={readonly} onClick={handleAdd}><Icon name="plus" size={11} />Add</button>
        {draftName && (!isSymbolKey(draftName.trim()) || sessions.some((session) => session.id === draftName.trim())) && (
          <span className="field-error">Use a unique lowercase key with letters, digits, or hyphens.</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{sessions.length} sessions</span>
      </div>

      <div className="session-list-row">
        <span className="label">Sessions</span>
        {sessions.map((s) => {
          if (editingId === s.id) {
            return (
              <span key={s.id} className="session-chip editing">
                <span className="ses-dot" style={{ background: sessionAccent(s) }} />
                <input
                  className="input sm"
                  value={editingName}
                  disabled={readonly}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  style={{ width: 130, height: 20 }}
                />
                <select
                  className="input sm"
                  value={editingAgent}
                  disabled={readonly}
                  onChange={(e) => setEditingAgent(e.target.value)}
                  style={{ width: 140, height: 20 }}
                >
                  {agentServers.map((server) => (
                    <option key={server.id} value={server.id}>{server.id}</option>
                  ))}
                </select>
                <button className="ses-x save" title={`Save ${s.name}`} disabled={readonly || !isSymbolKey(editingName.trim()) || sessions.some((session) => session.id === editingName.trim() && session.id !== editingId)} onClick={saveEdit}>
                  <Icon name="check" size={10} />
                </button>
                <button className="ses-x" title="Cancel" onClick={cancelEdit}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          }
          return (
            <span key={s.id} className="session-chip">
              <span className="ses-dot" style={{ background: sessionAccent(s) }} />
              {s.name}
              <span className="agent">{s.agentServerId ?? s.agent}</span>
              <button className="ses-x" title={`Edit ${s.name}`} disabled={readonly} onClick={() => startEdit(s)}>
                <Icon name="edit" size={10} />
              </button>
              <button className="ses-x" title={`Delete ${s.name}`} disabled={readonly || sessions.length <= 1} onClick={() => onDeleteSession(s.id)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          );
        })}
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
                  <span className="ses-dot" style={{ background: sessionAccent(s) }} />{s.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
