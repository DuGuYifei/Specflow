import { useState, useEffect, useRef } from 'react';
import type { Session, WorkflowNode, TimelineEvent, Variable } from '../types';
import type { AgentServerEntry, AgentSessionRecord, PausedNodeSession, RestoreMode } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { isSymbolKey, sessionAccent } from '../appearance';
import { SessionTimeline } from './session-timeline';

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
  timelineEvents?: TimelineEvent[];
  onLoadEarlierLogs?: () => void;
  canLoadEarlierLogs?: boolean;
  loadingEarlierLogs?: boolean;
  historicLogTotal?: number;
  historicLogLoadedFromIndex?: number;
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
  timelineEvents,
  onLoadEarlierLogs, canLoadEarlierLogs, loadingEarlierLogs, historicLogTotal, historicLogLoadedFromIndex,
  onAddSession, onEditSession, onDeleteSession, onClearLogs,
  variables, onEditVariable,
  agentSessions = [], agentServers = [], runs = [],
  onOpenInvocationLog, onRestoreSession,
  restoreStatusBySession = {},
  pausedNode, pausedPromptBusy = false,
  onPromptPausedNode, onContinuePausedNode,
  readonly,
}: SessionsBarProps) {
  const { t, language } = useI18n();
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
            <Icon name="terminal" size={11} style={{ verticalAlign: -2, marginRight: 4 }} />{t('sessions.title')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {t('sessions.sessionsCount', { count: sessions.length })} · {t('sessions.nodesCount', { count: stepNodes.length })}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{t('sessions.activity')}</span>
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
        title={t('sessions.dragToResize')}
      />
      <div className="sessions-head">
        <button className="bar-handle" onClick={() => setExpanded(false)} style={{ marginRight: 4 }}>
          <Icon name="chevron-down" size={12} />
        </button>
        <div className="bar-tabs">
          <button className={`bar-tab${tab === 'logs' ? ' active' : ''}`} onClick={() => setTab('logs')}>
            <Icon name="terminal" size={11} />{t('sessions.logs')}
          </button>
          <button className={`bar-tab${tab === 'agent-sessions' ? ' active' : ''}`} onClick={() => setTab('agent-sessions')}>
            <Icon name="history" size={11} />{t('sessions.agentSessions')}
            {agentSessions.length > 0 && <span className="count">{agentSessions.length}</span>}
          </button>
          <button className={`bar-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <Icon name="settings" size={11} />{t('sessions.title')}
            <span className="count">{sessions.length}</span>
          </button>
          <button className={`bar-tab${tab === 'vars' ? ' active' : ''}`} onClick={() => setTab('vars')}>
            <Icon name="tag" size={11} />{t('sessions.variables')}
            {variables.length > 0 && <span className="count">{variables.length}</span>}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'logs' && (
          <button className="bar-handle" title={t('sessions.clearLogs')} onClick={onClearLogs}>
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
          timelineEvents={timelineEvents}
          onLoadEarlierLogs={onLoadEarlierLogs}
          canLoadEarlierLogs={canLoadEarlierLogs}
          loadingEarlierLogs={loadingEarlierLogs}
          historicLogTotal={historicLogTotal}
          historicLogLoadedFromIndex={historicLogLoadedFromIndex}
          onDeleteSession={onDeleteSession}
          pausedNode={pausedNode}
          pausedPromptBusy={pausedPromptBusy}
          onPromptPausedNode={onPromptPausedNode}
          onContinuePausedNode={onContinuePausedNode}
          t={t}
        />
      )}
      {tab === 'agent-sessions' && (
        <AgentSessionsTab
          agentSessions={agentSessions}
          runs={runs}
          onOpenInvocationLog={onOpenInvocationLog}
          onRestoreSession={onRestoreSession}
          restoreStatusBySession={restoreStatusBySession}
          t={t}
          language={language}
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
          t={t}
        />
      )}
      {tab === 'vars' && (
        <VariablesTab
          variables={variables}
          onEditVariable={onEditVariable}
          readonly={readonly}
          t={t}
        />
      )}
    </div>
  );
}

// ── logs tab ──────────────────────────────────────────────────────────────────

interface LogsTabProps {
  sessions: Session[];
  activeSession?: Session;
  setActiveSessionId: (id: string) => void;
  stepNodes: WorkflowNode[];
  timelineEvents?: TimelineEvent[];
  onLoadEarlierLogs?: () => void;
  canLoadEarlierLogs?: boolean;
  loadingEarlierLogs?: boolean;
  historicLogTotal?: number;
  historicLogLoadedFromIndex?: number;
  onDeleteSession: (id: string) => void;
  pausedNode?: PausedNodeSession | null;
  pausedPromptBusy: boolean;
  onPromptPausedNode?: (prompt: string) => void;
  onContinuePausedNode?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function LogsTab({
  sessions, activeSession, setActiveSessionId, stepNodes, timelineEvents, onDeleteSession,
  onLoadEarlierLogs, canLoadEarlierLogs, loadingEarlierLogs, historicLogTotal, historicLogLoadedFromIndex,
  pausedNode, pausedPromptBusy, onPromptPausedNode, onContinuePausedNode,
  t,
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
  const prevLenRef = useRef(0);
  const prevFirstRef = useRef<TimelineEvent | undefined>(undefined);
  const prevHeightRef = useRef(0);
  useEffect(() => {
    const events = timelineEvents ?? [];
    const el = termRef.current;
    if (!el) {
      prevLenRef.current = events.length;
      prevFirstRef.current = events[0];
      return;
    }
    const prevLen = prevLenRef.current;
    const prevFirst = prevFirstRef.current;
    const currFirst = events[0];
    const grew = events.length > prevLen;
    const firstChanged = prevLen > 0 && currFirst !== prevFirst;
    if (grew && firstChanged) {
      // Prepend (Load earlier): keep the currently-visible content under the
      // user's eye by compensating scrollTop for the height added at the top.
      const delta = el.scrollHeight - prevHeightRef.current;
      el.scrollTop = el.scrollTop + delta;
    } else if (grew) {
      // Live append: pin to bottom.
      el.scrollTop = el.scrollHeight;
    }
    prevLenRef.current = events.length;
    prevFirstRef.current = currFirst;
    prevHeightRef.current = el.scrollHeight;
  }, [timelineEvents]);

  const activeNodeIds = new Set(
    stepNodes.filter((n) => n.kind === 'step' && n.sessionId === activeSession?.id).map((n) => n.id),
  );
  const nodeById = new Map(stepNodes.map((n) => [n.id, n]));
  const visibleEvents = (timelineEvents ?? []).filter((event) => {
    // Events explicitly tagged with this session win.
    if ('specflowSessionId' in event && event.specflowSessionId) {
      return event.specflowSessionId === activeSession?.id;
    }
    // Events with a nodeId: only show if that node belongs to the active session.
    if ('nodeId' in event && event.nodeId) {
      return activeNodeIds.has(event.nodeId);
    }
    // Unscoped run-level events (system messages, cancellation, etc) appear in every tab.
    return true;
  });

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
            · {t('sessions.nodesCount', { count: stepNodes.filter((n) => n.kind === 'step' && n.sessionId === activeSession?.id).length })}
          </span>
        </div>
        <div className="term-stream" ref={termRef}>
          {canLoadEarlierLogs && onLoadEarlierLogs && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '6px 12px',
              borderBottom: '1px solid var(--rule-2, #2a2a2a)',
              fontSize: 10.5,
              color: 'var(--ink-3)',
              fontFamily: 'var(--font-mono)',
            }}>
              <button
                className="btn sm"
                disabled={loadingEarlierLogs}
                onClick={onLoadEarlierLogs}
              >
                <Icon name="chevron-up" size={10} />
                {loadingEarlierLogs ? t('common.loading') : t('sessions.loadEarlier')}
              </button>
              {typeof historicLogTotal === 'number' && typeof historicLogLoadedFromIndex === 'number' && (
                <span>{t('sessions.eventsCount', { loaded: historicLogTotal - historicLogLoadedFromIndex, total: historicLogTotal })}</span>
              )}
            </div>
          )}
          {visibleEvents.length > 0 ? (
            <SessionTimeline events={visibleEvents} nodeById={nodeById} />
          ) : (
            <>
              <div className="term-line"><span className="ts">-</span><span className="lvl">[sys]</span><span>{timelineEvents && timelineEvents.length > 0 ? t('sessions.noOutputForSession') : t('sessions.noRunOutputYet')}</span></div>
              <div className="term-line">
                <span className="ts">—</span>
                <span style={{ color: 'var(--ink-3)' }}>·</span>
                <span style={{ animation: 'blink 1s steps(2) infinite' }}>▎</span>
              </div>
            </>
          )}
        </div>
        {pausedNode && activeSession && pausedNode.specflowSessionId === activeSession.id && (
          <PausedNodeComposer
            node={stepNodes.find((candidate) => candidate.id === pausedNode.nodeId)}
            busy={pausedPromptBusy}
            onPrompt={onPromptPausedNode}
            onContinue={onContinuePausedNode}
            t={t}
          />
        )}
      </div>
      <div
        className={`term-resizer${dragging ? ' dragging' : ''}`}
        onMouseDown={onResizerDown}
        title={t('sessions.dragToResize')}
      />
      <div className="term-sidebar" style={{ width: sideW }}>
        <div className="term-sidebar-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{t('sessions.title')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--ink-4)' }}>{sessions.length}</span>
        </div>
        <div className="term-sidebar-list">
          {sessions.length === 0 && (
            <div className="term-empty-session">{t('sessions.noSessions')}</div>
          )}
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
                  title={t('sessions.deleteSession')}
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
  busy: boolean;
  onPrompt?: (prompt: string) => void;
  onContinue?: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
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
        <span><Icon name="pause" size={11} /> {props.t('sessions.pausedAfter', { node: props.node?.title ?? 'node' })}</span>
        <button className="btn sm primary" disabled={props.busy} onClick={props.onContinue}>
          <Icon name="play" size={10} />{props.t('sessions.continueWorkflow')}
        </button>
      </div>
      <div className="paused-compose-input">
        <textarea
          className="textarea"
          rows={2}
          value={prompt}
          disabled={props.busy}
          placeholder={props.t('sessions.promptPausedSession')}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
        />
        <button className="btn sm" disabled={props.busy || !prompt.trim()} onClick={submit}>
          {props.busy ? props.t('sessions.sending') : props.t('sessions.send')}
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
  t: (key: string, params?: Record<string, string | number>) => string;
  language: string;
}

function AgentSessionsTab({
  agentSessions,
  runs,
  onOpenInvocationLog,
  onRestoreSession,
  restoreStatusBySession,
  t,
  language,
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
          <span>{t('agentSession.agent')}</span>
          <select
            className="input agent-session-agent-select"
            value={selectedAgentId}
            disabled={agentIds.length === 0}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setWorkflowSessionFilter('');
            }}
          >
            {agentIds.length === 0 && <option value="">{t('agentSession.noAgents')}</option>}
            {agentIds.map((agentId) => (
              <option key={agentId} value={agentId}>{agentId}</option>
            ))}
          </select>
        </label>
        <label className="history-filter">
          <span>{t('agentSession.workflowSession')}</span>
          <select
            className="input agent-session-workflow-select"
            value={selectedWorkflowSession}
            disabled={workflowSessionIds.length === 0}
            onChange={(e) => setWorkflowSessionFilter(e.target.value)}
          >
            <option value="">{t('agentSession.allSessions')}</option>
            {workflowSessionIds.filter(Boolean).map((sessionId) => (
              <option key={sessionId} value={sessionId}>{sessionId}</option>
            ))}
            {workflowSessionIds.includes('') && <option value={UNSCOPED_SESSION_FILTER}>{t('agentSession.unscoped')}</option>}
          </select>
        </label>
        {selectedAgentId && (
          <div className="history-agent-summary">
            <span className="agent-badge"><span className="dot" />{selectedAgentId}</span>
            <span>{t('agentSession.runtimeSessions', { count: agentScopedSessions.length })}</span>
          </div>
        )}
      </div>

      <div className="history-list">
        {groupedSessions.length === 0 && (
          <div className="history-empty">
            {t('agentSession.empty')}
          </div>
        )}

        {groupedSessions.map((group) => (
          <section key={group.id} className="history-session-group">
            <div className="history-session-group-head">
              <span>{t('agentSession.workflowSession')}</span>
              <span className="mono-id">{group.id || t('agentSession.unscoped')}</span>
              <span className="count">{group.sessions.length}</span>
            </div>
            <div className="history-session-cards">
              {group.sessions.map((session) => {
                const latestRunMissing = !knownRuns.has(session.latestRunId);
                const status = restoreStatusBySession[session.id];
                const canRestore = Boolean(session.acpSessionId);
                return (
                  <div key={session.id} className="history-card">
                    <div className="history-card-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="history-title">
                          <span className="mono-id">{session.acpSessionId}</span>
                        </div>
                        <div className="history-meta">
                          <span>{t('agentSession.invocations', { count: session.invocations.length })}</span>
                          <span>·</span>
                          <span>{formatShortDate(session.lastSeenAt, language)}</span>
                          {session.parentSpecflowSessionId && <span>· {t('agentSession.forkOf', { id: session.parentSpecflowSessionId })}</span>}
                        </div>
                      </div>
                      <div className="history-actions">
                        <CapabilityBadge label="load" enabled={session.acpSupportsLoadSession} />
                        <CapabilityBadge label="resume" enabled={session.acpSupportsResumeSession} />
                        <CapabilityBadge label="fork" enabled={session.acpSupportsForkSession} />
                        <button
                          className="btn sm"
                          disabled={!canRestore}
                          onClick={() => onRestoreSession?.(session, 'inspect')}
                          title={t('agentSession.inspectTitle')}
                        >
                          <Icon name="search" size={10} />{t('agentSession.inspect')}
                        </button>
                        <button
                          className="btn sm primary"
                          disabled={!canRestore}
                          onClick={() => onRestoreSession?.(session, 'continue')}
                          title={t('agentSession.resumeTitle')}
                        >
                          <Icon name="play-circle" size={10} />{t('agentSession.resume')}
                        </button>
                      </div>
                    </div>

                    {status && (
                      <div className={`history-restore-status ${status === 'failure' ? 'failed' : ''}`}>
                        {t('agentSession.restoreStatus', { status })}
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
                            title={runMissing ? t('agentSession.deletedRun') : t('agentSession.openRunLog')}
                          >
                            <span className={`status-dot ${ref.status === 'done' ? 'success' : ref.status === 'failed' ? 'error' : ref.status}`} />
                            <span className="mono-id">{ref.nodeId ?? ref.edgeId ?? ref.invocationId}</span>
                            <span>{runMissing ? t('agentSession.missingRun') : runLabelById.get(ref.runId) ?? ref.runId}</span>
                          </button>
                        );
                      })}
                    </div>

                    {latestRunMissing && (
                      <div className="history-warning">
                        {t('agentSession.latestRunUnavailable')}
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

function formatShortDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: '2-digit' });
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
  t: (key: string, params?: Record<string, string | number>) => string;
}

// ── variables tab ─────────────────────────────────────────────────────────────

interface VariablesTabProps {
  variables: Variable[];
  onEditVariable: (name: string, patch: Partial<Variable>) => void;
  readonly?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function VariablesTab({ variables, onEditVariable, readonly, t }: VariablesTabProps) {
  if (variables.length === 0) {
    return (
      <div className="sessions-body settings">
        <div style={{ padding: '12px 16px', color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          {t('variables.empty')}<br />
          {t('variables.emptyHint')}
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-body settings">
      <div className="assn-list" style={{ overflow: 'auto', flex: 1 }}>
        <div className="assn-list-head">
          <span>{t('variables.name')}</span>
          <span>{t('variables.defaultValue')}</span>
          <span>{t('variables.description')}</span>
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

function SettingsTab({ sessions, stepNodes, onAssignSession, addSessionPing, onAddSession, onEditSession, onDeleteSession, agentServers, readonly, t }: SettingsTabProps) {
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
          {t('settings.newAgentSession')}
        </span>
        <input
          ref={inputRef}
          className="input sm"
          placeholder={t('settings.sessionName')}
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
        <button className="btn sm primary" disabled={readonly} onClick={handleAdd}><Icon name="plus" size={11} />{t('settings.add')}</button>
        {draftName && (!isSymbolKey(draftName.trim()) || sessions.some((session) => session.id === draftName.trim())) && (
          <span className="field-error">{t('settings.invalidSessionName')}</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{t('sessions.sessionsCount', { count: sessions.length })}</span>
      </div>

      <div className="session-list-row">
        <span className="label">{t('sessions.title')}</span>
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
                <button className="ses-x save" title={t('settings.saveSession', { name: s.name })} disabled={readonly || !isSymbolKey(editingName.trim()) || sessions.some((session) => session.id === editingName.trim() && session.id !== editingId)} onClick={saveEdit}>
                  <Icon name="check" size={10} />
                </button>
                <button className="ses-x" title={t('settings.cancelEdit')} onClick={cancelEdit}>
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
              <button className="ses-x" title={t('settings.editSession', { name: s.name })} disabled={readonly} onClick={() => startEdit(s)}>
                <Icon name="edit" size={10} />
              </button>
              <button className="ses-x" title={t('settings.deleteSession', { name: s.name })} disabled={readonly || sessions.length <= 1} onClick={() => onDeleteSession(s.id)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="assn-list">
        <div className="assn-list-head">
          <span>{t('settings.node')}</span>
          <span>{t('settings.sessionAssignment')}</span>
        </div>
        {(stepNodes.filter((n) => n.kind === 'step') as Extract<WorkflowNode, { kind: 'step' }>[]).map((n) => (
          <div key={n.id} className="assn-row">
            <div className="nbox">
              <span className="nid">{n.alias}</span>
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
