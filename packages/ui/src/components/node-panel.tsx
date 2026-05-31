import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ChangeEvent, type KeyboardEvent } from 'react';
import type { WorkflowNode, Edge, Run, Session, RunState, GateNode, StepNode, InputNode, TimelineEvent } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';
import { branchAccent, edgeKey, sessionAccent } from '../appearance';
import { SessionTimeline } from './session-timeline';
import {
  fetchAgentServerCapabilities,
  fetchSkills,
  refreshAgentServerCapabilities,
  type AgentServerCapabilities,
  type SkillSummary,
} from '../api';
import { useI18n } from '../i18n';

function insertAtCaret(el: HTMLTextAreaElement | null, token: string, write: (next: string) => void) {
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  const next = value.slice(0, start) + token + value.slice(end);
  write(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  });
}

interface NodePanelProps {
  node: WorkflowNode & { runState?: RunState };
  run?: Run;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  viewMode: 'edit' | 'run';
  timelineEvents: TimelineEvent[];
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onChangeSession: (id: string, sid: string) => void;
  onEditSession?: (id: string, patch: Partial<Session>) => void;
  onAddSessionRequest: () => void;
  onAddEdge: (edge: Edge) => void;
  onDeleteEdge: (id: string) => void;
  onAddBranch: (gateId: string) => void;
  onEditBranch: (gateId: string, branchId: string, patch: { label?: string; description?: string }) => void;
  onDeleteBranch: (gateId: string, branchId: string) => void;
  onAddPath: (nodeId: string, path?: string) => void;
  onEditPath: (nodeId: string, index: number, value: string) => void;
  onDeletePath: (nodeId: string, index: number) => void;
  onUploadImages: (nodeId: string, files: File[]) => void;
  onDeleteImage: (nodeId: string, index: number) => void;
  onImportPaths: (nodeId: string, files: File[], directory: boolean) => void;
}

export function NodePanel(props: NodePanelProps) {
  const [tab, setTab] = useState('overview');
  const readonly = props.viewMode === 'run';
  if (props.node.kind === 'input') {
    return <InputPanelContent {...props} node={props.node} readonly={readonly} />;
  }
  if (props.node.kind === 'gate') {
    return <GatePanelContent {...props} node={props.node} readonly={readonly} />;
  }
  if (props.node.kind === 'end') {
    return <EndPanelContent node={props.node} readonly={readonly} onClose={props.onClose} onEditNode={props.onEditNode} />;
  }
  return <StepPanelContent {...props} node={props.node} readonly={readonly} tab={tab} setTab={setTab} />;
}

function StepPanelContent(props: NodePanelProps & {
  node: StepNode & { runState?: RunState };
  readonly: boolean;
  tab: string;
  setTab: (tab: string) => void;
}) {
  const { t } = useI18n();
  const { node, run, sessions, timelineEvents, tab, setTab } = props;
  const session = sessions.find((candidate) => candidate.id === node.sessionId);
  const nodeLogEvents = timelineEvents.filter((event) => !('nodeId' in event) || !event.nodeId || event.nodeId === node.id);
  const tabs = run
    ? [{ key: 'overview', label: t('node.tabs.overview') }, { key: 'logs', label: t('node.tabs.logs'), count: nodeLogEvents.length || undefined }]
    : [{ key: 'overview', label: t('node.tabs.definition') }, { key: 'images', label: t('node.tabs.images'), count: node.images?.length || undefined }, { key: 'paths', label: t('node.tabs.paths'), count: node.paths?.length || undefined }];
  const label = (
    <>
      <Icon name="flow" size={11} /> {t('node.stepLabel', { alias: node.alias })}
      {session && <><span style={{ color: 'var(--ink-4)' }}>·</span><span className="ses-dot" style={{ background: sessionAccent(session) }} />{session.name}</>}
    </>
  );
  return (
    <RightPanel label={label} title={node.title} onClose={props.onClose} tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'overview' && <StepOverview {...props} session={session} />}
      {tab === 'logs' && <NodeLogs events={nodeLogEvents} />}
      {tab === 'images' && <NodeImages {...props} />}
      {tab === 'paths' && <NodePaths {...props} />}
    </RightPanel>
  );
}

function StepOverview(props: NodePanelProps & {
  node: StepNode & { runState?: RunState };
  readonly: boolean;
  session?: Session;
}) {
  const { t } = useI18n();
  const { node, run, session, sessions, nodes, edges, readonly } = props;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { capabilities, refreshing, refresh } = useAgentCapabilities(session?.agentServerId);
  const skills = useSkills();
  const inputTokens = edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => nodes.find((candidate) => candidate.id === edge.from))
    .filter((candidate): candidate is InputNode => candidate?.kind === 'input')
    .map((input) => ({ token: input.variableName, hint: input.description }));
  const outputTokens = edges
    .filter((edge) => edge.to === node.id && edge.transmit && edge.outputTag)
    .map((edge) => ({ token: `specflow_${edge.outputTag}`, hint: t('node.transferredOutputHint') }));
  return (
    <>
      {run && <div className="output-card"><span className={`status-dot ${node.runState || 'pending'}`} /> {node.runState || 'pending'}</div>}
      <div className="section-title">{t('node.title')}</div>
      <input className="input" value={node.title} disabled={node.locked || readonly} onChange={(event) => props.onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={node.locked || readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.session')}</div>
      <div className="node-session-control">
        <select
          className="input node-session-select"
          value={node.sessionId ?? ''}
          disabled={readonly || sessions.length === 0}
          onChange={(event) => {
            if (event.target.value) props.onChangeSession(node.id, event.target.value);
          }}
        >
          {!node.sessionId && <option value="">{t('node.selectSession')}</option>}
          {sessions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.agentServerId ?? candidate.agent})</option>
          ))}
        </select>
        {!readonly && <button className="btn sm ghost" onClick={props.onAddSessionRequest}><Icon name="plus" size={11} />{t('node.add')}</button>}
      </div>
      {session && props.onEditSession && (
        <McpServersEditor
          session={session}
          readonly={readonly}
          onChange={(value) => props.onEditSession!(session.id, { mcpServers: value || undefined })}
        />
      )}
      <div className="section-title">{t('node.prompt')}</div>
      {!readonly && [...inputTokens, ...outputTokens].length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {[...inputTokens, ...outputTokens].map(({ token, hint }) => (
            <button key={token} className="btn sm ghost" title={hint} onClick={() => insertAtCaret(promptRef.current, `<${token}>`, (next) => props.onEditNode(node.id, { prompt: next }))}>
              {'<'}{token}{'>'}
            </button>
          ))}
        </div>
      )}
      <SlashCommandTextarea
        ref={promptRef}
        rows={6}
        value={node.prompt}
        disabled={readonly}
        skills={skills}
        availableCommands={capabilities?.availableCommands}
        onChange={(next) => props.onEditNode(node.id, { prompt: next })}
      />
      <SlashCommandWarnings prompt={node.prompt} skills={skills} availableCommands={capabilities?.availableCommands} />
      <AcpControls
        readonly={readonly}
        capabilities={capabilities}
        refresh={refresh}
        refreshing={refreshing}
        modeId={node.modeId}
        configOptions={node.configOptions}
        allowMode
        onChangeMode={(modeId) => props.onEditNode(node.id, { modeId: modeId ?? undefined })}
        onChangeConfigOption={(configId, value) => {
          const next = { ...(node.configOptions ?? {}) };
          if (value === undefined) delete next[configId];
          else next[configId] = value;
          props.onEditNode(node.id, {
            configOptions: Object.keys(next).length > 0 ? next : undefined,
          });
        }}
      />
      <div className="section-title">{t('node.humanCheckpoint')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.pauseAfterRun === true}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { pauseAfterRun: event.target.checked || undefined })}
        />
        {t('node.pauseAfter')}
      </label>
      <div className="code-hint">{t('node.pauseHint')}</div>
      <NodeImages {...props} compact />
      <NodePaths {...props} compact />
    </>
  );
}

function NodeImages(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) props.onUploadImages(props.node.id, files);
    event.target.value = '';
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      props.onUploadImages(props.node.id, images);
    }
  };
  return (
    <div onPaste={onPaste}>
      {!props.compact && <div className="section-title">{t('node.images')}</div>}
      {props.compact && <div className="section-title">{t('node.images')}</div>}
      <div className="attach-row">
        {(props.node.images ?? []).map((image, index) => (
          <div key={image.path} className="attach-thumb">
            <span className="label">{image.label ?? image.path}</span>
            {!props.readonly && <button className="icon-btn" onClick={() => props.onDeleteImage(props.node.id, index)}><Icon name="trash" size={11} /></button>}
          </div>
        ))}
        {!props.readonly && <button className="attach-add" onClick={() => inputRef.current?.click()} title={t('node.chooseImageFiles')}><Icon name="plus" size={14} /></button>}
      </div>
      {!props.readonly && <div className="code-hint">{t('node.imagesHint')}</div>}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </div>
  );
}

function NodePaths(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const onImport = (event: ChangeEvent<HTMLInputElement>, directory: boolean) => {
    props.onImportPaths(props.node.id, Array.from(event.target.files ?? []), directory);
    event.target.value = '';
  };
  return (
    <>
      <div className="section-title">{t('node.filesFolders')}</div>
      {(props.node.paths ?? []).map((path, index) => (
        <div key={`${path}-${index}`} className="path-row">
          <Icon name={path.endsWith('/') ? 'folder' : 'file'} size={13} />
          <input className="input" value={path} disabled={props.readonly} onChange={(event) => props.onEditPath(props.node.id, index, event.target.value)} />
          {!props.readonly && <button className="icon-btn" onClick={() => props.onDeletePath(props.node.id, index)}><Icon name="trash" size={12} /></button>}
        </div>
      ))}
      {!props.readonly && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button className="btn sm ghost" onClick={() => props.onAddPath(props.node.id, '')}><Icon name="plus" size={12} />{t('node.typePath')}</button>
          <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>{t('node.chooseFile')}</button>
          <button className="btn sm ghost" onClick={() => folderRef.current?.click()}>{t('node.chooseFolder')}</button>
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => onImport(event, false)} />
      <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => onImport(event, true)} />
    </>
  );
}

function GatePanelContent(props: NodePanelProps & { node: GateNode; readonly: boolean }) {
  const { t } = useI18n();
  const { node, nodes, edges, readonly } = props;
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const predecessorEdge = edges.find((edge) => edge.to === node.id && nodes.find((candidate) => candidate.id === edge.from)?.kind !== 'input');
  const predecessor = nodes.find((candidate) => candidate.id === predecessorEdge?.from);
  const predecessorSession = predecessor?.kind === 'step'
    ? props.sessions.find((session) => session.id === predecessor.sessionId)
    : undefined;
  const supportsForkHint = predecessorSession?.agentServerId.toLowerCase().includes('claude');
  const { capabilities, refreshing, refresh } = useAgentCapabilities(predecessorSession?.agentServerId);
  const skills = useSkills();
  return (
    <RightPanel label={<><Icon name="route" size={11} /> {t('node.gateLabel', { alias: node.alias })}</>} title={node.title} onClose={props.onClose}>
      <div className="code-hint">
        {t('node.gateHint')}
        {predecessorSession && (supportsForkHint
          ? t('node.gateForkClaudeHint')
          : t('node.gateForkRuntimeHint'))}
      </div>
      <div className="section-title">{t('node.title')}</div>
      <input className="input" value={node.title} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.decisionCriteria')}</div>
      <SlashCommandTextarea
        ref={criteriaRef}
        rows={6}
        value={node.decisionCriteria}
        disabled={readonly}
        skills={skills}
        availableCommands={capabilities?.availableCommands}
        onChange={(next) => props.onEditNode(node.id, { decisionCriteria: next })}
      />
      <SlashCommandWarnings prompt={node.decisionCriteria} skills={skills} availableCommands={capabilities?.availableCommands} />
      <AcpControls
        readonly={readonly}
        capabilities={capabilities}
        refresh={refresh}
        refreshing={refreshing}
        configOptions={node.configOptions}
        allowMode={false}
        onChangeConfigOption={(configId, value) => {
          const next = { ...(node.configOptions ?? {}) };
          if (value === undefined) delete next[configId];
          else next[configId] = value;
          props.onEditNode(node.id, {
            configOptions: Object.keys(next).length > 0 ? next : undefined,
          });
        }}
      />
      <div className="code-hint">{t('node.inputEdgesHint')}</div>
      <div className="section-title">{t('node.branches')}</div>
      {node.branches.map((branch) => (
        <div key={branch.id} className="output-card" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: branchAccent(branch) }} />
            <input className="input" value={branch.label} disabled={readonly} onChange={(event) => props.onEditBranch(node.id, branch.id, { label: event.target.value })} />
            {!readonly && <button className="icon-btn" disabled={node.branches.length <= 1} title={node.branches.length <= 1 ? t('node.deleteBranchRequired') : t('node.deleteBranch')} onClick={() => props.onDeleteBranch(node.id, branch.id)}><Icon name="trash" size={12} /></button>}
          </div>
          <input className="input" value={branch.description ?? ''} disabled={readonly} placeholder={t('node.branchDescriptionPlaceholder')} onChange={(event) => props.onEditBranch(node.id, branch.id, { description: event.target.value || undefined })} />
        </div>
      ))}
      {!readonly && <button className="btn sm ghost" onClick={() => props.onAddBranch(node.id)}><Icon name="plus" size={12} />{t('node.addBranch')}</button>}
    </RightPanel>
  );
}

function InputPanelContent(props: NodePanelProps & { node: InputNode; readonly: boolean }) {
  const { t } = useI18n();
  const { node, readonly, nodes, edges } = props;
  const rawName = node.variableName.startsWith('specflow_') ? node.variableName.slice(9) : node.variableName;
  const stepNodes = nodes.filter((candidate): candidate is StepNode => candidate.kind === 'step');
  return (
    <RightPanel label={<><Icon name="tag" size={11} />{t('node.runInputLabel', { alias: node.alias })}</>} title={node.title} onClose={props.onClose}>
      <div className="section-title">{t('node.title')}</div>
      <input className="input" value={node.title} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { alias: event.target.value })} />
      <div className="section-title">{t('node.variableName')}</div>
      <input className="input" value={rawName} disabled={readonly} onChange={(event) => {
        const value = event.target.value.replace(/[^A-Za-z0-9_]/g, '');
        if (value) props.onEditNode(node.id, { variableName: `specflow_${value}` });
      }} />
      <div className="section-title">{t('node.inputRequired')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.required !== false}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { required: event.target.checked ? undefined : false })}
        />
        {t('common.required')}
      </label>
      <div className="code-hint">{t('node.inputOptionalHint')}</div>
      <div className="section-title">{t('node.defaultValue')}</div>
      <input className="input" value={node.defaultValue ?? ''} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { defaultValue: event.target.value || undefined })} />
      <div className="section-title">{t('node.description')}</div>
      <input className="input" value={node.description ?? ''} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { description: event.target.value || undefined })} />
      <div className="section-title">{t('node.inputTargets')}</div>
      <div className="input-target-list">
        {stepNodes.length === 0 && <div className="code-hint">{t('node.noStepTargets')}</div>}
        {stepNodes.map((step) => {
          const existingEdge = edges.find((edge) => edge.from === node.id && edge.to === step.id);
          return (
            <label key={step.id} className="toggle-row input-target-row">
              <input
                type="checkbox"
                checked={Boolean(existingEdge)}
                disabled={readonly}
                onChange={(event) => {
                  if (event.target.checked) {
                    props.onAddEdge({ id: edgeKey({ from: node.id, to: step.id }), from: node.id, to: step.id });
                  } else if (existingEdge) {
                    props.onDeleteEdge(existingEdge.id);
                  }
                }}
              />
              <span className="node-ref">{step.alias}</span>
              <span>{step.title}</span>
            </label>
          );
        })}
      </div>
    </RightPanel>
  );
}

function EndPanelContent({ node, readonly, onClose, onEditNode }: { node: Extract<WorkflowNode, { kind: 'end' }>; readonly: boolean; onClose: () => void; onEditNode: (id: string, patch: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  return (
    <RightPanel label={<><Icon name="check" size={11} />{t('node.end')}</>} title={t('node.endTitle')} onClose={onClose}>
      <div className="code-hint">{t('node.endHint')}</div>
      <div className="section-title">{t('node.title')}</div>
      <input className="input" value={node.title} disabled={readonly} onChange={(event) => onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">{t('node.alias')}</div>
      <input className="input" value={node.alias} disabled={readonly} onChange={(event) => onEditNode(node.id, { alias: event.target.value })} />
    </RightPanel>
  );
}

function NodeLogs({ events }: { events: TimelineEvent[] }) {
  return <div className="log-block"><SessionTimeline events={events} /></div>;
}

// ── ACP capability-driven controls (mode / model / effort / other) ────────────

function useAgentCapabilities(agentServerId: string | undefined): {
  capabilities: AgentServerCapabilities | undefined;
  refreshing: boolean;
  refresh: () => Promise<void>;
} {
  const [capabilities, setCapabilities] = useState<AgentServerCapabilities | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!agentServerId) {
      setCapabilities(undefined);
      return () => { cancelled = true; };
    }
    fetchAgentServerCapabilities(agentServerId)
      .then((value) => { if (!cancelled) setCapabilities(value); })
      .catch(() => { if (!cancelled) setCapabilities(undefined); });
    return () => { cancelled = true; };
  }, [agentServerId]);
  const refresh = async () => {
    if (!agentServerId) return;
    setRefreshing(true);
    try {
      const next = await refreshAgentServerCapabilities(agentServerId);
      setCapabilities(next);
    } finally {
      setRefreshing(false);
    }
  };
  return { capabilities, refreshing, refresh };
}

function useSkills(): SkillSummary[] {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchSkills()
      .then((value) => { if (!cancelled) setSkills(value); })
      .catch(() => { if (!cancelled) setSkills([]); });
    return () => { cancelled = true; };
  }, []);
  return skills;
}

interface AcpControlsProps {
  readonly: boolean;
  capabilities: AgentServerCapabilities | undefined;
  refresh: () => Promise<void>;
  refreshing: boolean;
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
  allowMode: boolean;
  onChangeMode?: (modeId: string | undefined) => void;
  onChangeConfigOption: (configId: string, value: string | boolean | undefined) => void;
}

function AcpControls(props: AcpControlsProps) {
  const { t } = useI18n();
  const { capabilities, configOptions, readonly } = props;
  const modes = capabilities?.modes?.availableModes ?? [];
  const options = capabilities?.configOptions ?? [];
  const duplicateModeOption = findDuplicateModeOption(modes, options);
  const hasMode = props.allowMode && modes.length > 0;
  const visibleOptions = duplicateModeOption
    ? options.filter((option) => option !== duplicateModeOption)
    : options;
  const hasConfig = visibleOptions.length > 0;
  if (!capabilities) {
    return (
      <div className="output-card" style={{ marginTop: 6 }}>
        <div className="code-hint">
          {t('node.acpProbeHint')}
        </div>
        <button className="btn sm ghost" disabled={props.refreshing} onClick={() => void props.refresh()}>
          {props.refreshing ? t('node.probing') : t('node.probeCapabilities')}
        </button>
      </div>
    );
  }
  if (!hasMode && !hasConfig) {
    // Cached, but agent didn't advertise any per-session knobs — leave the
    // section hidden so simple agents stay clutter-free.
    return null;
  }
  // configOptions sorted: model → thought_level → mode → other → unknown
  const categoryOrder: Record<string, number> = { model: 0, thought_level: 1, mode: 2, other: 3 };
  const sortedOptions = [...visibleOptions].sort((a, b) => {
    const ai = a.category ? categoryOrder[a.category] ?? 9 : 9;
    const bi = b.category ? categoryOrder[b.category] ?? 9 : 9;
    return ai - bi;
  });
  return (
    <>
      <div className="section-title">{t('node.acpOverrides')}</div>
      {hasMode && (
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>
            {duplicateModeOption?.name || t('node.mode')}
          </label>
          <select
            className="input"
            value={props.modeId ?? ''}
            disabled={readonly}
            onChange={(event) => props.onChangeMode?.(event.target.value || undefined)}
          >
            <option value="">{t('node.inheritSessionMode')}</option>
            {modes.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.name || mode.id}</option>
            ))}
          </select>
          {duplicateModeOption?.description && <div className="code-hint">{duplicateModeOption.description}</div>}
        </div>
      )}
      {sortedOptions.map((option) => (
        <ConfigOptionControl
          key={option.id}
          option={option}
          value={configOptions?.[option.id]}
          readonly={readonly}
          onChange={(value) => props.onChangeConfigOption(option.id, value)}
        />
      ))}
      <div className="code-hint">
        {t('node.acpOverridesHint')}
        <button className="btn sm ghost" style={{ marginLeft: 6 }} disabled={props.refreshing} onClick={() => void props.refresh()}>
          {props.refreshing ? t('node.refreshing') : t('node.refresh')}
        </button>
      </div>
    </>
  );
}

type ConfigOption = NonNullable<AgentServerCapabilities['configOptions']>[number];

function findDuplicateModeOption(
  modes: Array<{ id: string }>,
  options: ConfigOption[],
): ConfigOption | undefined {
  if (modes.length === 0) return undefined;
  const modeIds = new Set(modes.map((mode) => mode.id));
  for (const option of options) {
    if (option.type !== 'select') continue;
    if (option.id !== 'mode' && option.category !== 'mode') continue;
    const values = selectOptionValues(option);
    if (values.size !== modeIds.size) continue;
    if ([...modeIds].every((id) => values.has(id))) return option;
  }
  return undefined;
}

function selectOptionValues(option: ConfigOption): Set<string> {
  const values = new Set<string>();
  if (!Array.isArray(option.options)) return values;
  for (const entry of option.options) {
    if ('group' in entry && Array.isArray(entry.options)) {
      for (const child of entry.options) values.add(child.value);
    } else if ('value' in entry) {
      values.add(entry.value);
    }
  }
  return values;
}

function ConfigOptionControl(props: {
  option: ConfigOption;
  value: string | boolean | undefined;
  readonly: boolean;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const { t } = useI18n();
  const { option } = props;
  if (option.type === 'boolean') {
    const checked = typeof props.value === 'boolean' ? props.value : option.currentValue === true;
    return (
      <div style={{ marginBottom: 6 }}>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={checked}
            disabled={props.readonly}
            onChange={(event) => props.onChange(event.target.checked)}
          />
          {option.name || option.id}
        </label>
        {option.description && <div className="code-hint">{option.description}</div>}
      </div>
    );
  }
  const value = typeof props.value === 'string' ? props.value : '';
  // Options may be flat or grouped; flatten for the dropdown but show group as optgroup.
  const groups: Array<{ name: string; options: Array<{ value: string; name: string }> }> = [];
  if (Array.isArray(option.options)) {
    for (const entry of option.options) {
      if ('group' in entry && Array.isArray(entry.options)) {
        groups.push({ name: entry.name || entry.group, options: entry.options });
      } else if ('value' in entry) {
        if (!groups.length || groups[groups.length - 1].name !== '__flat__') {
          groups.push({ name: '__flat__', options: [] });
        }
        groups[groups.length - 1].options.push(entry);
      }
    }
  }
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 2 }}>
        {option.name || option.id}
        {option.category && option.category !== 'other' && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>· {option.category}</span>}
      </label>
      <select
        className="input"
        value={value}
        disabled={props.readonly}
        onChange={(event) => props.onChange(event.target.value || undefined)}
      >
        <option value="">{t('node.inheritAgentDefault')}</option>
        {groups.map((group) => group.name === '__flat__'
          ? group.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.name || opt.value}</option>)
          : (
            <optgroup key={group.name} label={group.name}>
              {group.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.name || opt.value}</option>)}
            </optgroup>
          ))}
      </select>
      {option.description && <div className="code-hint">{option.description}</div>}
    </div>
  );
}

// ── MCP servers JSON editor on the session ──────────────────────────────────

function McpServersEditor(props: {
  session: Session;
  readonly: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(props.session.mcpServers ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  // Reset local draft if the session changes (different node opened with a different session).
  useEffect(() => {
    setDraft(props.session.mcpServers ?? '');
    setError(undefined);
  }, [props.session.id, props.session.mcpServers]);
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(undefined);
      props.onChange('');
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        setError('mcpServers must be a JSON array.');
        return;
      }
      setError(undefined);
      props.onChange(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <div className="section-title">{t('node.mcpServers')}</div>
      <textarea
        className="textarea"
        rows={6}
        value={draft}
        disabled={props.readonly}
        placeholder='[{"name": "fs", "command": "uvx", "args": ["mcp-server-filesystem", "/tmp"], "env": []}]'
        spellCheck={false}
        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
      {error && <div className="code-hint" style={{ color: 'var(--accent-red, #d33)' }}>{t('node.jsonError', { error })}</div>}
      <div className="code-hint">
        {t('node.mcpServersHint')}
      </div>
    </>
  );
}

// ── Slash command autocomplete popup (textarea wrapper) ─────────────────────

interface SlashCandidate {
  name: string;
  kind: 'skill' | 'command';
  label: string;
  detail: string;
}

interface ActiveSlashQuery {
  /** Offset of the `/` character. */
  slashIdx: number;
  /** Offset where the command name starts (slashIdx + 1). */
  queryStart: number;
  /** Partial text typed after the slash, up to the caret. */
  query: string;
}

/**
 * Finds the slash command the caret is currently inside, if any. A command is
 * only "active" when the `/` is line-leading (only whitespace precedes it on
 * the line) and there is no whitespace between the `/` and the caret — i.e. the
 * user is still typing the command name. Returns null otherwise.
 */
function findActiveSlashQuery(text: string, caret: number): ActiveSlashQuery | null {
  let i = caret;
  while (i > 0 && /[A-Za-z0-9_:.-]/.test(text[i - 1])) i -= 1;
  const slashIdx = i - 1;
  if (slashIdx < 0 || text[slashIdx] !== '/') return null;
  const lineStart = text.lastIndexOf('\n', slashIdx - 1) + 1;
  if (text.slice(lineStart, slashIdx).trim() !== '') return null;
  return { slashIdx, queryStart: i, query: text.slice(i, caret) };
}

const SlashCommandTextarea = forwardRef<HTMLTextAreaElement, {
  value: string;
  rows: number;
  disabled?: boolean;
  skills: SkillSummary[];
  availableCommands: AgentServerCapabilities['availableCommands'] | undefined;
  onChange: (next: string) => void;
}>(function SlashCommandTextarea(props, forwardedRef) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement, []);
  const [active, setActive] = useState<ActiveSlashQuery | null>(null);
  const [highlight, setHighlight] = useState(0);

  const candidates: SlashCandidate[] = active ? buildCandidates(props.skills, props.availableCommands, active.query) : [];

  const sync = () => {
    const el = innerRef.current;
    if (!el || props.disabled) { setActive(null); return; }
    const next = findActiveSlashQuery(el.value, el.selectionStart ?? 0);
    setActive(next);
    setHighlight(0);
  };

  const accept = (candidate: SlashCandidate) => {
    const el = innerRef.current;
    if (!el || !active) return;
    const before = el.value.slice(0, active.slashIdx);
    const after = el.value.slice(el.selectionStart ?? active.queryStart);
    const insert = `/${candidate.name} `;
    const next = before + insert + after;
    props.onChange(next);
    const caret = before.length + insert.length;
    setActive(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!active || candidates.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => (h + 1) % candidates.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      accept(candidates[Math.min(highlight, candidates.length - 1)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setActive(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={innerRef}
        className="textarea"
        rows={props.rows}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => { props.onChange(event.target.value); requestAnimationFrame(sync); }}
        onKeyUp={sync}
        onClick={sync}
        onKeyDown={onKeyDown}
        onBlur={() => requestAnimationFrame(() => setActive(null))}
      />
      {active && candidates.length > 0 && (
        <div className="slash-popup" style={{
          position: 'absolute',
          left: 8,
          right: 8,
          zIndex: 20,
          background: 'var(--bg-1, #fff)',
          border: '1px solid var(--ink-5, #ccc)',
          borderRadius: 6,
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
          maxHeight: 220,
          overflowY: 'auto',
        }}>
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.kind}:${candidate.name}`}
              type="button"
              // onMouseDown (not onClick) so it fires before the textarea blur closes the popup.
              onMouseDown={(event) => { event.preventDefault(); accept(candidate); }}
              onMouseEnter={() => setHighlight(index)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: 'none',
                cursor: 'pointer',
                background: index === highlight ? 'var(--accent-soft, #eef)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>/{candidate.name}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{candidate.label}</span>
              </div>
              {candidate.detail && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{candidate.detail}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function buildCandidates(
  skills: SkillSummary[],
  commands: AgentServerCapabilities['availableCommands'] | undefined,
  query: string,
): SlashCandidate[] {
  const q = query.toLowerCase();
  const skillItems: SlashCandidate[] = skills
    .filter((skill) => skill.name.toLowerCase().startsWith(q))
    .map((skill) => ({ name: skill.name, kind: 'skill', label: `skill · ${skill.source}`, detail: skill.description }));
  const commandItems: SlashCandidate[] = (commands ?? [])
    .filter((command) => command.name.toLowerCase().startsWith(q) && !skillItems.some((s) => s.name === command.name))
    .map((command) => ({ name: command.name, kind: 'command', label: 'agent command', detail: command.description }));
  return [...skillItems, ...commandItems].slice(0, 12);
}

// ── Slash command warning underneath a prompt ───────────────────────────────

function SlashCommandWarnings(props: {
  prompt: string;
  skills: SkillSummary[];
  availableCommands: AgentServerCapabilities['availableCommands'] | undefined;
}) {
  const { t } = useI18n();
  const { prompt, skills, availableCommands } = props;
  // Lightweight client-side parse: line-leading `/` followed by [a-z0-9_:.-]+.
  // Mirrors the server's slash-parser logic well enough to surface warnings.
  const slashTokens = parseSlashTokens(prompt);
  if (slashTokens.length === 0) return null;
  const knownSkill = new Set(skills.map((s) => s.name));
  const knownCommand = new Set((availableCommands ?? []).map((c) => c.name));
  const issues = slashTokens.filter((token) => !isResolvable(token, knownSkill, knownCommand));
  if (issues.length === 0) return null;
  return (
    <div className="code-hint" style={{ color: 'var(--accent-red, #d33)' }}>
      {t('node.slashWarning', { commands: issues.map((token) => `"/${token.display}"`).join(', ') })}
    </div>
  );
}

interface SlashToken { display: string; bare: string; scope?: string }

function parseSlashTokens(text: string): SlashToken[] {
  const out: SlashToken[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.trimStart().match(/^\/([A-Za-z0-9_:.-]+)/);
    if (!match) continue;
    const raw = match[1];
    if (raw.includes('.')) {
      // MCP-style: server.prompt — skip in this warning (already unsupported).
      continue;
    }
    if (raw.includes(':')) {
      const lastColon = raw.lastIndexOf(':');
      out.push({ display: raw, scope: raw.slice(0, lastColon), bare: raw.slice(lastColon + 1) });
    } else {
      out.push({ display: raw, bare: raw });
    }
  }
  return out;
}

function isResolvable(token: SlashToken, skills: Set<string>, commands: Set<string>): boolean {
  if (skills.has(token.bare)) return true;
  if (!token.scope && commands.has(token.bare)) return true;
  return false;
}
