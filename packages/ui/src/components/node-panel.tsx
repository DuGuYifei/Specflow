import { useState, useRef } from 'react';
import type { WorkflowNode, Edge, Run, Session, RunState, GateNode, StepNode, InputNode, LogLine } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

function insertAtCaret(
  el: HTMLTextAreaElement | null,
  token: string,
  write: (next: string) => void,
) {
  if (!el) return;
  const { selectionStart: s, selectionEnd: e, value } = el;
  const next = value.slice(0, s) + token + value.slice(e);
  write(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + token.length, s + token.length);
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
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
  onAddBranch: (gateId: string) => void;
  onEditBranch: (gateId: string, branchId: string, patch: { label?: string }) => void;
  onDeleteBranch: (gateId: string, branchId: string) => void;
  onAddPath: (nodeId: string, path?: string) => void;
  onEditPath: (nodeId: string, index: number, value: string) => void;
  onDeletePath: (nodeId: string, index: number) => void;
  onAddAttachment: (nodeId: string, label: string) => void;
  onDeleteAttachment: (nodeId: string, index: number) => void;
}

export function NodePanel({ node, run, sessions, nodes, edges, viewMode, logLines, onClose, onEditNode, onToggleUpdateDoc, onChangeSession, onAddSessionRequest, onAddBranch, onEditBranch, onDeleteBranch, onAddPath, onEditPath, onDeletePath, onAddAttachment, onDeleteAttachment }: NodePanelProps) {
  const [tab, setTab] = useState('overview');
  const readonly = viewMode === 'run';

  if (node.kind === 'input') {
    return <InputPanelContent node={node} readonly={readonly} onClose={onClose} onEditNode={onEditNode} />;
  }
  if (node.kind === 'gate') {
    return <GatePanelContent node={node} sessions={sessions} nodes={nodes} edges={edges} readonly={readonly} onClose={onClose} onEditNode={onEditNode} onChangeSession={onChangeSession} onAddBranch={onAddBranch} onEditBranch={onEditBranch} onDeleteBranch={onDeleteBranch} />;
  }
  if (node.kind === 'end') {
    return <EndPanelContent node={node} readonly={readonly} onClose={onClose} onEditNode={onEditNode} />;
  }

  return <StepPanelContent node={node} run={run} sessions={sessions} nodes={nodes} edges={edges} readonly={readonly} logLines={logLines} tab={tab} setTab={setTab} onClose={onClose} onEditNode={onEditNode} onToggleUpdateDoc={onToggleUpdateDoc} onChangeSession={onChangeSession} onAddSessionRequest={onAddSessionRequest} onAddPath={onAddPath} onEditPath={onEditPath} onDeletePath={onDeletePath} onAddAttachment={onAddAttachment} onDeleteAttachment={onDeleteAttachment} />;
}

// ── step ──────────────────────────────────────────────────────────────────────

interface StepPanelContentProps {
  node: StepNode & { runState?: RunState };
  run?: Run;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  readonly: boolean;
  logLines: LogLine[];
  tab: string;
  setTab: (t: string) => void;
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
  onAddPath: (nodeId: string, path?: string) => void;
  onEditPath: (nodeId: string, index: number, value: string) => void;
  onDeletePath: (nodeId: string, index: number) => void;
  onAddAttachment: (nodeId: string, label: string) => void;
  onDeleteAttachment: (nodeId: string, index: number) => void;
}

function StepPanelContent({ node, run, sessions, nodes, edges, readonly, logLines, tab, setTab, onClose, onEditNode, onToggleUpdateDoc, onChangeSession, onAddSessionRequest, onAddPath, onEditPath, onDeletePath, onAddAttachment, onDeleteAttachment }: StepPanelContentProps) {
  const session = sessions.find((s) => s.id === node.sessionId);
  const nodeLogLines = logLines.filter((l) => !l.nodeId || l.nodeId === node.id);

  const tabs = run
    ? [
        { key: 'overview', label: 'Overview' },
        { key: 'logs',     label: 'Logs',   count: nodeLogLines.length || undefined },
        { key: 'output',   label: 'Output' },
      ]
    : [
        { key: 'overview',    label: 'Definition' },
        { key: 'attachments', label: 'Attach', count: (node.attachments || []).length || undefined },
        { key: 'paths',       label: 'Paths',  count: (node.paths || []).length || undefined },
      ];

  const label = (
    <>
      <Icon name="flow" size={11} /> Step · {node.num}
      {node.locked && <><span style={{ color: 'var(--ink-4)' }}>·</span><Icon name="lock" size={10} />structural</>}
      {session && (
        <>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span className="ses-dot" style={{ width: 7, height: 7, borderRadius: 2, background: session.color, display: 'inline-block' }} />
          {session.name}
        </>
      )}
    </>
  );

  return (
    <RightPanel label={label} title={node.title} onClose={onClose} tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'overview'    && <StepOverview node={node} run={run} session={session} sessions={sessions} nodes={nodes} edges={edges} readonly={readonly} onEditNode={onEditNode} onToggleUpdateDoc={onToggleUpdateDoc} onChangeSession={onChangeSession} onAddSessionRequest={onAddSessionRequest} onAddPath={onAddPath} onEditPath={onEditPath} onDeletePath={onDeletePath} onAddAttachment={onAddAttachment} onDeleteAttachment={onDeleteAttachment} />}
      {tab === 'logs'        && <NodeLogs lines={nodeLogLines} />}
      {tab === 'output'      && <NodeOutput output={run?.nodeOutputs?.[node.id]} />}
      {tab === 'attachments' && <NodeAttachments node={node} readonly={readonly} onAddAttachment={onAddAttachment} onDeleteAttachment={onDeleteAttachment} />}
      {tab === 'paths'       && <NodePaths node={node} readonly={readonly} onAddPath={onAddPath} onEditPath={onEditPath} onDeletePath={onDeletePath} />}
    </RightPanel>
  );
}

interface StepOverviewProps {
  node: StepNode & { runState?: RunState };
  run?: Run;
  session: Session | undefined;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  readonly: boolean;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
  onAddPath: (nodeId: string, path?: string) => void;
  onEditPath: (nodeId: string, index: number, value: string) => void;
  onDeletePath: (nodeId: string, index: number) => void;
  onAddAttachment: (nodeId: string, label: string) => void;
  onDeleteAttachment: (nodeId: string, index: number) => void;
}

function StepOverview({ node, run, sessions, nodes, edges, readonly, onEditNode, onToggleUpdateDoc, onChangeSession, onAddSessionRequest, onAddPath, onEditPath, onDeletePath, onAddAttachment, onDeleteAttachment }: StepOverviewProps) {
  const descRef = useRef<HTMLTextAreaElement>(null);

  const incomingInputNodes = edges
    .filter((e) => e.to === node.id)
    .map((e) => nodes.find((n) => n.id === e.from))
    .filter((n): n is InputNode => n?.kind === 'input');

  return (
    <>
      {run && (
        <div className="output-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={`status-dot ${node.runState || 'pending'}`} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {node.runState === 'running' ? 'Running…'
               : node.runState === 'success' ? 'Completed'
               : node.runState === 'error'   ? 'Failed'
               : 'Queued'}
            </div>
          </div>
        </div>
      )}

      <div className="section-title">Title</div>
      <input
        className="input"
        value={node.title}
        disabled={node.locked || readonly}
        onChange={(e) => onEditNode(node.id, { title: e.target.value })}
      />

      <div className="section-title">
        Description
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>what to do</span>
      </div>
      {!readonly && incomingInputNodes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {incomingInputNodes.map((n) => (
            <button
              key={n.id}
              className="btn sm ghost"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
              title={[
                'Click to insert',
                n.defaultValue ? `default: ${n.defaultValue}` : '',
                n.description ?? '',
              ].filter(Boolean).join('\n')}
              onClick={() => insertAtCaret(descRef.current, `<${n.variableName}>`, (next) => onEditNode(node.id, { desc: next }))}
            >
              {'<'}{n.variableName}{'>'}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={descRef}
        className="textarea"
        rows={5}
        value={node.desc}
        disabled={readonly}
        onChange={(e) => onEditNode(node.id, { desc: e.target.value })}
      />

      <div className="section-title">
        Session
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>conversation grouping</span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            className="btn sm"
            disabled={readonly}
            style={{
              background:   node.sessionId === s.id ? 'var(--bg)'   : 'var(--bg-elev)',
              borderColor:  node.sessionId === s.id ? 'var(--ink)'  : 'var(--line)',
              color:        node.sessionId === s.id ? 'var(--ink)'  : 'var(--ink-2)',
            }}
            onClick={() => onChangeSession(node.id, s.id)}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />
            {s.name}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{s.agent}</span>
          </button>
        ))}
        {!readonly && (
          <button
            className="btn sm ghost"
            style={{ borderStyle: 'dashed' }}
            onClick={() => onAddSessionRequest()}
            title="Add a new session"
          >
            <Icon name="plus" size={11} />Add
          </button>
        )}
      </div>

      <div className="section-title">
        Spec doc
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>per-node</span>
      </div>
      <div className="output-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className={`switch${node.updateDoc ? ' on' : ''}`} disabled={readonly} onClick={() => onToggleUpdateDoc(node.id)} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>Update SPECFLOW.md</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>
            After this step, the agent dynamically syncs the spec doc with what it learned.
          </div>
        </div>
      </div>

      <div className="section-title">Attachments</div>
      <div className="attach-row">
        {(node.attachments || []).map((a, i) => (
          <div key={i} className="attach-thumb" style={{ position: 'relative' }}>
            <span className="label">{a.label}</span>
            {!readonly && (
              <button
                style={{ position: 'absolute', top: -4, right: -4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 3px', cursor: 'pointer', fontSize: 9, lineHeight: 1 }}
                onClick={() => onDeleteAttachment(node.id, i)}
                title="Remove"
              >×</button>
            )}
          </div>
        ))}
        {!readonly && (
          <button className="attach-add" onClick={() => { const lbl = window.prompt('Attachment label'); if (lbl) onAddAttachment(node.id, lbl); }}>
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>

      <div className="section-title">Files &amp; folders</div>
      {(node.paths || []).map((p, i) => (
        <div key={i} className="path-row">
          <Icon name={p.endsWith('/') ? 'folder' : 'file'} size={13} style={{ color: 'var(--ink-3)' }} />
          <input
            className="input"
            value={p}
            disabled={readonly}
            onChange={(e) => onEditPath(node.id, i, e.target.value)}
          />
          {!readonly && (
            <button className="icon-btn" onClick={() => onDeletePath(node.id, i)}>
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>
      ))}
      {!readonly && (
        <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => onAddPath(node.id, '')}>
          <Icon name="plus" size={12} />Add path
        </button>
      )}
    </>
  );
}

function NodeLogs({ lines }: { lines: LogLine[] }) {
  if (lines.length === 0) {
    return (
      <div style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>
        No output yet for this node.
      </div>
    );
  }
  return (
    <div className="log-block">
      {lines.map((line, i) => (
        <div key={i}>{line.chunk}</div>
      ))}
    </div>
  );
}

function NodeOutput({ output }: { output?: string }) {
  if (!output) {
    return (
      <div style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>
        No output yet.
      </div>
    );
  }
  return (
    <>
      <div className="section-title">Result</div>
      <div className="output-card">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {output}
        </div>
      </div>
    </>
  );
}

function NodeAttachments({ node, readonly, onAddAttachment, onDeleteAttachment }: { node: StepNode; readonly: boolean; onAddAttachment: (id: string, label: string) => void; onDeleteAttachment: (id: string, i: number) => void }) {
  return (
    <>
      <div className="attach-row">
        {(node.attachments || []).map((a, i) => (
          <div key={i} className="attach-thumb" style={{ position: 'relative' }}>
            <span className="label">{a.label}</span>
            {!readonly && (
              <button
                style={{ position: 'absolute', top: -4, right: -4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 3px', cursor: 'pointer', fontSize: 9, lineHeight: 1 }}
                onClick={() => onDeleteAttachment(node.id, i)}
              >×</button>
            )}
          </div>
        ))}
        {!readonly && (
          <button className="attach-add" onClick={() => { const lbl = window.prompt('Attachment label'); if (lbl) onAddAttachment(node.id, lbl); }}>
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      <div className="code-hint" style={{ marginTop: 10 }}>
        Reference inline with <code>&lt;specflow_attachments&gt;</code>.
      </div>
    </>
  );
}

function NodePaths({ node, readonly, onAddPath, onEditPath, onDeletePath }: { node: StepNode; readonly: boolean; onAddPath: (id: string, p?: string) => void; onEditPath: (id: string, i: number, v: string) => void; onDeletePath: (id: string, i: number) => void }) {
  return (
    <>
      {(node.paths || []).map((p, i) => (
        <div key={i} className="path-row">
          <Icon name={p.endsWith('/') ? 'folder' : 'file'} size={13} style={{ color: 'var(--ink-3)' }} />
          <input
            className="input"
            value={p}
            disabled={readonly}
            onChange={(e) => onEditPath(node.id, i, e.target.value)}
          />
          {!readonly && (
            <button className="icon-btn" onClick={() => onDeletePath(node.id, i)}>
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>
      ))}
      {!readonly && (
        <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => onAddPath(node.id, '')}>
          <Icon name="plus" size={12} />Add path
        </button>
      )}
    </>
  );
}

// ── gate ──────────────────────────────────────────────────────────────────────

interface GatePanelContentProps {
  node: GateNode;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  readonly: boolean;
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddBranch: (gateId: string) => void;
  onEditBranch: (gateId: string, branchId: string, patch: { label?: string }) => void;
  onDeleteBranch: (gateId: string, branchId: string) => void;
}

function GatePanelContent({ node, sessions, nodes, edges, readonly, onClose, onEditNode, onChangeSession, onAddBranch, onEditBranch, onDeleteBranch }: GatePanelContentProps) {
  const session = sessions.find((s) => s.id === node.sessionId);
  const gateDescRef = useRef<HTMLTextAreaElement>(null);

  const incomingInputNodes = edges
    .filter((e) => e.to === node.id)
    .map((e) => nodes.find((n) => n.id === e.from))
    .filter((n): n is InputNode => n?.kind === 'input');

  const label = (
    <>
      <Icon name="route" size={11} /> Gate · {node.num}
      {session && (
        <>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: session.color, display: 'inline-block' }} />
          {session.name}
        </>
      )}
    </>
  );

  return (
    <RightPanel label={label} title={node.title} onClose={onClose}>
      <div className="code-hint" style={{ background: 'var(--bg-elev)', borderColor: 'var(--line)', marginBottom: 12 }}>
        <strong>Decision node.</strong> Reads the previous result and chooses one branch.
      </div>

      <div className="section-title">Decision criteria</div>
      {!readonly && incomingInputNodes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {incomingInputNodes.map((n) => (
            <button
              key={n.id}
              className="btn sm ghost"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
              title={[
                'Click to insert',
                n.defaultValue ? `default: ${n.defaultValue}` : '',
                n.description ?? '',
              ].filter(Boolean).join('\n')}
              onClick={() => insertAtCaret(gateDescRef.current, `<${n.variableName}>`, (next) => onEditNode(node.id, { gateDesc: next }))}
            >
              {'<'}{n.variableName}{'>'}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={gateDescRef}
        className="textarea"
        rows={5}
        value={node.gateDesc ?? ''}
        disabled={readonly}
        placeholder="Describe how the gate should decide which branch to take."
        onChange={(e) => onEditNode(node.id, { gateDesc: e.target.value })}
      />
      <div className="code-hint" style={{ marginTop: 6 }}>
        Available: <code>&lt;specflow_input&gt;</code>, <code>&lt;specflow_branches&gt;</code>.
      </div>

      <div className="section-title">
        Branches
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
          {node.branches.length} outputs
        </span>
      </div>
      {node.branches.map((b) => (
        <div key={b.id} className="output-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, marginBottom: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
          <input
            className="input"
            value={b.label}
            disabled={readonly}
            style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
            onChange={(e) => onEditBranch(node.id, b.id, { label: e.target.value })}
          />
          {!readonly && (
            <button className="icon-btn" onClick={() => onDeleteBranch(node.id, b.id)}>
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>
      ))}
      {!readonly && (
        <button className="btn sm ghost" onClick={() => onAddBranch(node.id)}>
          <Icon name="plus" size={12} />Add branch
        </button>
      )}

      <div className="section-title">Session</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            className="btn sm"
            disabled={readonly}
            style={{
              background:  node.sessionId === s.id ? 'var(--bg)'  : 'var(--bg-elev)',
              borderColor: node.sessionId === s.id ? 'var(--ink)' : 'var(--line)',
            }}
            onClick={() => onChangeSession(node.id, s.id)}
          >
            <span style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />{s.name}
          </button>
        ))}
      </div>
    </RightPanel>
  );
}

// ── input ─────────────────────────────────────────────────────────────────────

interface InputPanelContentProps {
  node: InputNode;
  readonly: boolean;
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
}

function InputPanelContent({ node, readonly, onClose, onEditNode }: InputPanelContentProps) {
  const rawName = node.variableName.startsWith('specflow_')
    ? node.variableName.slice('specflow_'.length)
    : node.variableName;

  const handleNameChange = (raw: string) => {
    const sanitized = raw.replace(/[^A-Za-z0-9_]/g, '');
    if (sanitized) onEditNode(node.id, { variableName: `specflow_${sanitized}` });
  };

  return (
    <RightPanel label={<><Icon name="tag" size={11} />Run input · {node.num}</>} title={node.title} onClose={onClose}>
      <div className="code-hint" style={{ background: 'var(--bg-elev)', borderColor: 'var(--line)', marginBottom: 12 }}>
        <strong>Run input.</strong> Declares a value that can be overridden before a run starts. Connect it to a step to make <code>&lt;{node.variableName}&gt;</code> available there.
      </div>

      <div className="section-title">Title</div>
      <input
        className="input"
        value={node.title}
        disabled={readonly}
        onChange={(e) => onEditNode(node.id, { title: e.target.value })}
      />

      <div className="section-title">Variable name</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', padding: '0 6px', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRight: 'none', borderRadius: '4px 0 0 4px', height: 28, display: 'flex', alignItems: 'center' }}>specflow_</span>
        <input
          className="input"
          style={{ borderRadius: '0 4px 4px 0', fontFamily: 'var(--font-mono)' }}
          value={rawName}
          disabled={readonly}
          placeholder="var_name"
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </div>

      <div className="section-title">Default value</div>
      <input
        className="input"
        value={node.defaultValue ?? ''}
        disabled={readonly}
        placeholder="Value used when not overridden at run time"
        onChange={(e) => onEditNode(node.id, { defaultValue: e.target.value || undefined })}
      />

      <div className="section-title">Description</div>
      <input
        className="input"
        value={node.description ?? ''}
        disabled={readonly}
        placeholder="Optional hint shown on hover"
        onChange={(e) => onEditNode(node.id, { description: e.target.value || undefined })}
      />
    </RightPanel>
  );
}

// ── end ───────────────────────────────────────────────────────────────────────

interface EndPanelContentProps {
  node: Extract<WorkflowNode, { kind: 'end' }>;
  readonly: boolean;
  onClose: () => void;
  onEditNode: (id: string, patch: Record<string, unknown>) => void;
}

function EndPanelContent({ node, readonly, onClose, onEditNode }: EndPanelContentProps) {
  return (
    <RightPanel label={<><Icon name="check" size={11} />End</>} title="End of path" onClose={onClose}>
      <div className="code-hint">
        <strong>End node.</strong> Reaching this node terminates the branch with no further action.
      </div>
      <div className="section-title">Label</div>
      <input
        className="input"
        value={node.title || 'Done'}
        disabled={readonly}
        onChange={(e) => onEditNode(node.id, { title: e.target.value })}
      />
    </RightPanel>
  );
}
