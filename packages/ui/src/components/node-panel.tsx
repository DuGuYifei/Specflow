import { useRef, useState, type ClipboardEvent, type ChangeEvent } from 'react';
import type { WorkflowNode, Edge, Run, Session, RunState, GateNode, StepNode, InputNode, LogLine } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';
import { branchAccent, sessionAccent } from '../appearance';

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
  logLines: LogLine[];
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
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
    return <InputPanelContent node={props.node} readonly={readonly} onClose={props.onClose} onEditNode={props.onEditNode} />;
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
  const { node, run, sessions, logLines, tab, setTab } = props;
  const session = sessions.find((candidate) => candidate.id === node.sessionId);
  const nodeLogLines = logLines.filter((line) => !line.nodeId || line.nodeId === node.id);
  const tabs = run
    ? [{ key: 'overview', label: 'Overview' }, { key: 'logs', label: 'Logs', count: nodeLogLines.length || undefined }, { key: 'output', label: 'Output' }]
    : [{ key: 'overview', label: 'Definition' }, { key: 'images', label: 'Images', count: node.images?.length || undefined }, { key: 'paths', label: 'Paths', count: node.paths?.length || undefined }];
  const label = (
    <>
      <Icon name="flow" size={11} /> Step · {node.num}
      {session && <><span style={{ color: 'var(--ink-4)' }}>·</span><span className="ses-dot" style={{ background: sessionAccent(session) }} />{session.name}</>}
    </>
  );
  return (
    <RightPanel label={label} title={node.title} onClose={props.onClose} tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'overview' && <StepOverview {...props} session={session} />}
      {tab === 'logs' && <NodeLogs lines={nodeLogLines} />}
      {tab === 'output' && <NodeOutput output={run?.nodeOutputs?.[node.id]} />}
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
  const { node, run, sessions, nodes, edges, readonly } = props;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const inputTokens = edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => nodes.find((candidate) => candidate.id === edge.from))
    .filter((candidate): candidate is InputNode => candidate?.kind === 'input')
    .map((input) => ({ token: input.variableName, hint: input.description }));
  const outputTokens = edges
    .filter((edge) => edge.to === node.id && edge.transmit && edge.outputTag)
    .map((edge) => ({ token: `specflow_${edge.outputTag}`, hint: 'Transferred output from the connected step.' }));
  return (
    <>
      {run && <div className="output-card"><span className={`status-dot ${node.runState || 'pending'}`} /> {node.runState || 'pending'}</div>}
      <div className="section-title">Title</div>
      <input className="input" value={node.title} disabled={node.locked || readonly} onChange={(event) => props.onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">Prompt</div>
      {!readonly && [...inputTokens, ...outputTokens].length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {[...inputTokens, ...outputTokens].map(({ token, hint }) => (
            <button key={token} className="btn sm ghost" title={hint} onClick={() => insertAtCaret(promptRef.current, `<${token}>`, (next) => props.onEditNode(node.id, { prompt: next }))}>
              {'<'}{token}{'>'}
            </button>
          ))}
        </div>
      )}
      <textarea ref={promptRef} className="textarea" rows={6} value={node.prompt} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { prompt: event.target.value })} />
      <div className="section-title">Human checkpoint</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={node.pauseAfterRun === true}
          disabled={readonly}
          onChange={(event) => props.onEditNode(node.id, { pauseAfterRun: event.target.checked || undefined })}
        />
        Pause after this node finishes for manual agent interaction
      </label>
      <div className="code-hint">
        ACP does not yet expose an ask-human tool. This pauses the workflow so you can prompt the agent directly.
        Native elicitation support will be added after the Agent Client Protocol Elicitation RFD is merged.
      </div>
      <div className="section-title">Session</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sessions.map((session) => (
          <button key={session.id} className="btn sm" disabled={readonly} onClick={() => props.onChangeSession(node.id, session.id)}>
            <span className="ses-dot" style={{ background: sessionAccent(session) }} />{session.name}
          </button>
        ))}
        {!readonly && <button className="btn sm ghost" onClick={props.onAddSessionRequest}><Icon name="plus" size={11} />Add</button>}
      </div>
      <NodeImages {...props} compact />
      <NodePaths {...props} compact />
    </>
  );
}

function NodeImages(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
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
      {!props.compact && <div className="section-title">Images</div>}
      {props.compact && <div className="section-title">Images</div>}
      <div className="attach-row">
        {(props.node.images ?? []).map((image, index) => (
          <div key={image.path} className="attach-thumb">
            <span className="label">{image.label ?? image.path}</span>
            {!props.readonly && <button className="icon-btn" onClick={() => props.onDeleteImage(props.node.id, index)}><Icon name="trash" size={11} /></button>}
          </div>
        ))}
        {!props.readonly && <button className="attach-add" onClick={() => inputRef.current?.click()} title="Choose image files"><Icon name="plus" size={14} /></button>}
      </div>
      {!props.readonly && <div className="code-hint">Choose image files or paste images here. Images are sent to the agent as multimodal context, not prompt variables.</div>}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </div>
  );
}

function NodePaths(props: NodePanelProps & { node: StepNode; readonly: boolean; compact?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const onImport = (event: ChangeEvent<HTMLInputElement>, directory: boolean) => {
    props.onImportPaths(props.node.id, Array.from(event.target.files ?? []), directory);
    event.target.value = '';
  };
  return (
    <>
      <div className="section-title">Files &amp; folders</div>
      {(props.node.paths ?? []).map((path, index) => (
        <div key={`${path}-${index}`} className="path-row">
          <Icon name={path.endsWith('/') ? 'folder' : 'file'} size={13} />
          <input className="input" value={path} disabled={props.readonly} onChange={(event) => props.onEditPath(props.node.id, index, event.target.value)} />
          {!props.readonly && <button className="icon-btn" onClick={() => props.onDeletePath(props.node.id, index)}><Icon name="trash" size={12} /></button>}
        </div>
      ))}
      {!props.readonly && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button className="btn sm ghost" onClick={() => props.onAddPath(props.node.id, '')}><Icon name="plus" size={12} />Type path</button>
          <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>Choose file</button>
          <button className="btn sm ghost" onClick={() => folderRef.current?.click()}>Choose folder</button>
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(event) => onImport(event, false)} />
      <input ref={folderRef} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(event) => onImport(event, true)} />
    </>
  );
}

function GatePanelContent(props: NodePanelProps & { node: GateNode; readonly: boolean }) {
  const { node, nodes, edges, readonly } = props;
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const predecessorEdge = edges.find((edge) => edge.to === node.id && nodes.find((candidate) => candidate.id === edge.from)?.kind !== 'input');
  const predecessor = nodes.find((candidate) => candidate.id === predecessorEdge?.from);
  const predecessorSession = predecessor?.kind === 'step'
    ? props.sessions.find((session) => session.id === predecessor.sessionId)
    : undefined;
  const supportsForkHint = predecessorSession?.agentServerId.toLowerCase().includes('claude');
  return (
    <RightPanel label={<><Icon name="route" size={11} /> Gate · {node.num}</>} title={node.title} onClose={props.onClose}>
      <div className="code-hint">
        The gate uses the previous step context to select exactly one branch and must return a JSON decision.
        {predecessorSession && (supportsForkHint
          ? ' This Claude ACP session can be forked at runtime so the decision does not alter the original conversation.'
          : ' Runtime checks fork capability; when unavailable, the decision continues in the previous session.')}
      </div>
      <div className="section-title">Decision criteria</div>
      <textarea ref={criteriaRef} className="textarea" rows={6} value={node.decisionCriteria} disabled={readonly} onChange={(event) => props.onEditNode(node.id, { decisionCriteria: event.target.value })} />
      <div className="code-hint">Input edges carry the previous step output automatically and have no transfer properties.</div>
      <div className="section-title">Branches</div>
      {node.branches.map((branch) => (
        <div key={branch.id} className="output-card" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: branchAccent(branch) }} />
            <input className="input" value={branch.label} disabled={readonly} onChange={(event) => props.onEditBranch(node.id, branch.id, { label: event.target.value })} />
            {!readonly && <button className="icon-btn" disabled={node.branches.length <= 1} title={node.branches.length <= 1 ? 'A gate must keep at least one branch' : 'Delete branch'} onClick={() => props.onDeleteBranch(node.id, branch.id)}><Icon name="trash" size={12} /></button>}
          </div>
          <input className="input" value={branch.description ?? ''} disabled={readonly} placeholder="Describe when this branch should be selected" onChange={(event) => props.onEditBranch(node.id, branch.id, { description: event.target.value || undefined })} />
        </div>
      ))}
      {!readonly && <button className="btn sm ghost" onClick={() => props.onAddBranch(node.id)}><Icon name="plus" size={12} />Add branch</button>}
    </RightPanel>
  );
}

function InputPanelContent({ node, readonly, onClose, onEditNode }: { node: InputNode; readonly: boolean; onClose: () => void; onEditNode: (id: string, patch: Record<string, unknown>) => void }) {
  const rawName = node.variableName.startsWith('specflow_') ? node.variableName.slice(9) : node.variableName;
  return (
    <RightPanel label={<><Icon name="tag" size={11} />Run input · {node.num}</>} title={node.title} onClose={onClose}>
      <div className="section-title">Title</div>
      <input className="input" value={node.title} disabled={readonly} onChange={(event) => onEditNode(node.id, { title: event.target.value })} />
      <div className="section-title">Variable name</div>
      <input className="input" value={rawName} disabled={readonly} onChange={(event) => {
        const value = event.target.value.replace(/[^A-Za-z0-9_]/g, '');
        if (value) onEditNode(node.id, { variableName: `specflow_${value}` });
      }} />
      <div className="section-title">Default value</div>
      <input className="input" value={node.defaultValue ?? ''} disabled={readonly} onChange={(event) => onEditNode(node.id, { defaultValue: event.target.value || undefined })} />
      <div className="section-title">Description</div>
      <input className="input" value={node.description ?? ''} disabled={readonly} onChange={(event) => onEditNode(node.id, { description: event.target.value || undefined })} />
    </RightPanel>
  );
}

function EndPanelContent({ node, readonly, onClose, onEditNode }: { node: Extract<WorkflowNode, { kind: 'end' }>; readonly: boolean; onClose: () => void; onEditNode: (id: string, patch: Record<string, unknown>) => void }) {
  return (
    <RightPanel label={<><Icon name="check" size={11} />End</>} title="End of path" onClose={onClose}>
      <div className="code-hint">Reaching this node terminates the selected path.</div>
      <input className="input" value={node.title} disabled={readonly} onChange={(event) => onEditNode(node.id, { title: event.target.value })} />
    </RightPanel>
  );
}

function NodeLogs({ lines }: { lines: LogLine[] }) {
  return <div className="log-block">{lines.length ? lines.map((line, index) => <div key={index}>{line.chunk}</div>) : 'No output yet.'}</div>;
}

function NodeOutput({ output }: { output?: string }) {
  return <div className="output-card">{output || 'No output yet.'}</div>;
}
