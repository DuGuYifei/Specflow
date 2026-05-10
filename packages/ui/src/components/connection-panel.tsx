import type { Edge, WorkflowNode } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

interface ConnectionPanelProps {
  edge: Edge;
  fromNode?: WorkflowNode;
  toNode?: WorkflowNode;
  onClose: () => void;
}

export function ConnectionPanel({ edge, fromNode, toNode, onClose }: ConnectionPanelProps) {
  if (edge.sameSession) {
    return (
      <RightPanel
        label={<><Icon name="link" size={11} />Same-session connection</>}
        title={<span style={{ fontSize: 14 }}>Implicit handoff</span>}
        onClose={onClose}
      >
        <div className="code-hint">
          Both nodes run in the <strong>same session</strong>. Output and input flow through the live conversation — no separate hand-off prompt or output tag is needed. To customize, split the nodes into different sessions.
        </div>
        <div className="section-title">From → To</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="conn-pill">
            <div className="nbox"><span className="nid">{fromNode?.num}</span><span className="nname">{fromNode?.title}</span></div>
          </div>
          <div className="conn-pill">
            <div className="nbox"><span className="nid">{toNode?.num}</span><span className="nname">{toNode?.title}</span></div>
          </div>
        </div>
      </RightPanel>
    );
  }

  if (fromNode?.kind === 'gate') {
    return (
      <RightPanel
        label={<><Icon name="route" size={11} />Gate branch</>}
        title={<span style={{ fontSize: 14 }}>{edge.branch} → {toNode?.title}</span>}
        onClose={onClose}
      >
        <div className="code-hint">
          Gate output edges have no prompt or tag — the gate&apos;s input is forwarded as-is to whichever branch it picks.
        </div>
      </RightPanel>
    );
  }

  return (
    <RightPanel
      label={
        <>
          <Icon name="route" size={11} />Connection
          {edge.loopback && <span style={{ color: 'var(--ink-3)' }}> · loopback</span>}
        </>
      }
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{fromNode?.num}</span>
          <span style={{ color: 'var(--ink-3)' }}>→</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{toNode?.num}</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="section-title">
        <Icon name="tag" size={10} />Output tag
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>identifier</span>
      </div>
      <input className="input" style={{ fontFamily: 'var(--font-mono)' }} defaultValue={edge.tag} />
      <div className="code-hint">
        Reference in the next prompt as <code>&lt;specflow_{edge.tag || 'tag_name'}&gt;</code>.<br />
        At runtime it&apos;s substituted with{' '}
        <code>&lt;{edge.tag || 'tag_name'}&gt;…content…&lt;/{edge.tag || 'tag_name'}&gt;</code>.
      </div>

      <div className="section-title">
        Hand-off prompt
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>optional</span>
      </div>
      <textarea
        className="textarea code"
        rows={5}
        defaultValue={edge.prompt}
        placeholder="How should the previous node format its output?"
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button className="btn ghost" style={{ color: 'var(--err)' }}>
          <Icon name="trash" size={12} />Delete
        </button>
        <button className="btn primary">
          <Icon name="check" size={12} />Save
        </button>
      </div>
    </RightPanel>
  );
}
