import { useState } from 'react';
import type { WorkflowNode, Run, Session, RunState, GateNode, StepNode } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

interface NodePanelProps {
  node: WorkflowNode & { runState?: RunState };
  run?: Run;
  sessions: Session[];
  onClose: () => void;
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
}

export function NodePanel({ node, run, sessions, onClose, onToggleUpdateDoc, onChangeSession, onAddSessionRequest }: NodePanelProps) {
  const [tab, setTab] = useState('overview');

  if (node.kind === 'gate') {
    return <GatePanelContent node={node} sessions={sessions} tab={tab} setTab={setTab} onClose={onClose} onChangeSession={onChangeSession} />;
  }
  if (node.kind === 'end') {
    return <EndPanelContent node={node} onClose={onClose} />;
  }

  return <StepPanelContent node={node} run={run} sessions={sessions} tab={tab} setTab={setTab} onClose={onClose} onToggleUpdateDoc={onToggleUpdateDoc} onChangeSession={onChangeSession} onAddSessionRequest={onAddSessionRequest} />;
}

// ── step ──────────────────────────────────────────────────────────────────────

interface StepPanelContentProps {
  node: StepNode & { runState?: RunState };
  run?: Run;
  sessions: Session[];
  tab: string;
  setTab: (t: string) => void;
  onClose: () => void;
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
}

function StepPanelContent({ node, run, sessions, tab, setTab, onClose, onToggleUpdateDoc, onChangeSession, onAddSessionRequest }: StepPanelContentProps) {
  const session = sessions.find((s) => s.id === node.sessionId);

  const tabs = run
    ? [
        { key: 'overview',    label: 'Overview' },
        { key: 'logs',        label: 'Logs',   count: 142 },
        { key: 'output',      label: 'Output' },
      ]
    : [
        { key: 'overview',    label: 'Definition' },
        { key: 'attachments', label: 'Attach', count: (node.attachments || []).length },
        { key: 'paths',       label: 'Paths',  count: (node.paths || []).length },
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
      {tab === 'overview'    && <StepOverview node={node} run={run} session={session} sessions={sessions} onToggleUpdateDoc={onToggleUpdateDoc} onChangeSession={onChangeSession} onAddSessionRequest={onAddSessionRequest} />}
      {tab === 'logs'        && <NodeLogs />}
      {tab === 'output'      && <NodeOutput />}
      {tab === 'attachments' && <NodeAttachments node={node} />}
      {tab === 'paths'       && <NodePaths node={node} />}
    </RightPanel>
  );
}

interface StepOverviewProps {
  node: StepNode & { runState?: RunState };
  run?: Run;
  session: Session | undefined;
  sessions: Session[];
  onToggleUpdateDoc: (id: string) => void;
  onChangeSession: (id: string, sid: string) => void;
  onAddSessionRequest: () => void;
}

function StepOverview({ node, run, sessions, onToggleUpdateDoc, onChangeSession, onAddSessionRequest }: StepOverviewProps) {
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
            <div style={{ color: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              started 14:02:11 · t+04:21
            </div>
          </div>
          {node.runState === 'running' && <button className="btn sm">Pause</button>}
        </div>
      )}

      <div className="section-title">Title</div>
      <input className="input" defaultValue={node.title} disabled={node.locked} />

      <div className="section-title">
        Description
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>what to do</span>
      </div>
      <textarea className="textarea" rows={5} defaultValue={node.desc} />

      <div className="section-title">
        Session
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>conversation grouping</span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            className="btn sm"
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
        <button
          className="btn sm ghost"
          style={{ borderStyle: 'dashed' }}
          onClick={() => onAddSessionRequest()}
          title="Add a new session"
        >
          <Icon name="plus" size={11} />Add
        </button>
      </div>

      <div className="section-title">
        Spec doc
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>per-node</span>
      </div>
      <div className="output-card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className={`switch${node.updateDoc ? ' on' : ''}`} onClick={() => onToggleUpdateDoc(node.id)} />
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
          <div key={i} className="attach-thumb"><span className="label">{a.label}</span></div>
        ))}
        <button className="attach-add"><Icon name="plus" size={14} /></button>
      </div>

      <div className="section-title">Files &amp; folders</div>
      {(node.paths || []).map((p, i) => (
        <div key={i} className="path-row">
          <Icon name={p.endsWith('/') ? 'folder' : 'file'} size={13} style={{ color: 'var(--ink-3)' }} />
          <input className="input" defaultValue={p} />
          <button className="icon-btn"><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button className="btn sm ghost" style={{ marginTop: 4 }}><Icon name="plus" size={12} />Add path</button>
    </>
  );
}

const SAMPLE_LOG = `[14:02:11] node 04·b · code started
[14:02:12] same-session continuation from 04·a (no handoff)
[14:02:14]   ✓ wrote src/components/EmptyState.tsx (84 lines)
[14:02:16]   ✓ updated app/routes/settings.tsx (+12 -3)
[14:02:21]   ✓ src/components/EmptyState.test.tsx · 4 passed
[14:02:23]   · pending review feedback…`;

function NodeLogs() {
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button className="btn sm">All</button>
        <button className="btn sm ghost">Errors</button>
        <button className="btn sm ghost">Tool calls</button>
      </div>
      <div className="log-block">
        {SAMPLE_LOG.split('\n').map((line, i) => {
          let cls = '';
          if (line.includes('✓')) cls = 'log-ok';
          if (line.includes('error') || line.includes('failed')) cls = 'log-err';
          return <div key={i} className={cls}>{line}</div>;
        })}
      </div>
    </>
  );
}

function NodeOutput() {
  return (
    <>
      <div className="section-title">Result · &lt;diff&gt;</div>
      <div className="output-card">
        <div className="o-head"><Icon name="tag" size={10} /> tag · diff · 1.8kb</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.55 }}>
          <div style={{ color: 'var(--ok)' }}>+ src/components/EmptyState.tsx (84)</div>
          <div style={{ color: 'var(--ok)' }}>+ src/components/EmptyState.test.tsx (62)</div>
          <div style={{ color: 'var(--ink-2)' }}>~ app/routes/settings.tsx (+12 -3)</div>
          <div style={{ color: 'var(--ink-2)' }}>~ app/i18n/en.json (+2)</div>
        </div>
      </div>
    </>
  );
}

function NodeAttachments({ node }: { node: StepNode }) {
  return (
    <>
      <div className="attach-row">
        {(node.attachments || []).map((a, i) => (
          <div key={i} className="attach-thumb"><span className="label">{a.label}</span></div>
        ))}
        <div className="attach-thumb"><span className="label">spec.png</span></div>
        <button className="attach-add"><Icon name="plus" size={14} /></button>
      </div>
      <div className="code-hint" style={{ marginTop: 10 }}>
        Reference inline with <code>&lt;specflow_attachments&gt;</code>.
      </div>
    </>
  );
}

function NodePaths({ node }: { node: StepNode }) {
  return (
    <>
      {(node.paths || ['src/']).map((p, i) => (
        <div key={i} className="path-row">
          <Icon name={p.endsWith('/') ? 'folder' : 'file'} size={13} style={{ color: 'var(--ink-3)' }} />
          <input className="input" defaultValue={p} />
          <button className="icon-btn"><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button className="btn sm ghost" style={{ marginTop: 4 }}><Icon name="plus" size={12} />Add path</button>
    </>
  );
}

// ── gate ──────────────────────────────────────────────────────────────────────

interface GatePanelContentProps {
  node: GateNode;
  sessions: Session[];
  tab: string;
  setTab: (t: string) => void;
  onClose: () => void;
  onChangeSession: (id: string, sid: string) => void;
}

function GatePanelContent({ node, sessions, onClose, onChangeSession }: GatePanelContentProps) {
  const session = sessions.find((s) => s.id === node.sessionId);

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
        <strong>Gate node.</strong> Reads the input from the previous step and chooses one branch. The branch's downstream is invoked with the <em>same</em> input — no handoff prompt is generated.
      </div>

      <div className="section-title">Decision criteria</div>
      <textarea className="textarea" rows={5} defaultValue={node.gateDesc} placeholder="Describe how the gate should decide which branch to take." />
      <div className="code-hint" style={{ marginTop: 6 }}>
        Available in the gate prompt: <code>&lt;specflow_input&gt;</code>, <code>&lt;specflow_branches&gt;</code>.
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
          <input className="input" defaultValue={b.label} style={{ flex: 1, fontFamily: 'var(--font-mono)' }} />
          <button className="icon-btn"><Icon name="trash" size={12} /></button>
        </div>
      ))}
      <button className="btn sm ghost"><Icon name="plus" size={12} />Add branch</button>

      <div className="section-title">Session</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {sessions.map((s) => (
          <button
            key={s.id}
            className="btn sm"
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

// ── end ───────────────────────────────────────────────────────────────────────

interface EndPanelContentProps {
  node: Extract<WorkflowNode, { kind: 'end' }>;
  onClose: () => void;
}

function EndPanelContent({ node, onClose }: EndPanelContentProps) {
  return (
    <RightPanel label={<><Icon name="check" size={11} />End</>} title="End of path" onClose={onClose}>
      <div className="code-hint">
        <strong>End node.</strong> Reaching this node terminates the branch with no further action. Use as a destination for gate branches that should halt the workflow (e.g. &quot;pass&quot; after final review).
      </div>
      <div className="section-title">Label</div>
      <input className="input" defaultValue={node.title || 'Done'} />
    </RightPanel>
  );
}
