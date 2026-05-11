import { useState } from 'react';
import type { Edge, WorkflowNode } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

interface ConnectionPanelProps {
  edge: Edge;
  fromNode?: WorkflowNode;
  toNode?: WorkflowNode;
  viewMode: 'edit' | 'run';
  onClose: () => void;
  onEditEdge?: (id: string, patch: { tag?: string; prompt?: string }) => void;
  onDeleteEdge?: (id: string) => void;
}

export function ConnectionPanel({ edge, fromNode, toNode, viewMode, onClose, onEditEdge, onDeleteEdge }: ConnectionPanelProps) {
  if (edge.sameSession) {
    return (
      <RightPanel
        label={<><Icon name="link" size={11} />Same-session connection</>}
        title={<span style={{ fontSize: 14 }}>Implicit handoff</span>}
        onClose={onClose}
      >
        <div className="code-hint">
          Both nodes run in the <strong>same session</strong>. Output and input flow through the live conversation — no separate hand-off prompt or output tag is needed.
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
        {viewMode === 'edit' && onDeleteEdge && (
          <div style={{ marginTop: 18 }}>
            <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge(edge.id); onClose(); }}>
              <Icon name="trash" size={12} />Delete
            </button>
          </div>
        )}
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
        {viewMode === 'edit' && onDeleteEdge && (
          <div style={{ marginTop: 18 }}>
            <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge(edge.id); onClose(); }}>
              <Icon name="trash" size={12} />Delete
            </button>
          </div>
        )}
      </RightPanel>
    );
  }

  return <EditableConnectionPanel edge={edge} fromNode={fromNode} toNode={toNode} viewMode={viewMode} onClose={onClose} onEditEdge={onEditEdge} onDeleteEdge={onDeleteEdge} />;
}

function EditableConnectionPanel({ edge, fromNode, toNode, viewMode, onClose, onEditEdge, onDeleteEdge }: ConnectionPanelProps) {
  const [tag, setTag] = useState(edge.tag ?? '');
  const [prompt, setPrompt] = useState(edge.prompt ?? '');
  const readonly = viewMode === 'run';

  const handleSave = () => {
    onEditEdge?.(edge.id, { tag, prompt });
  };

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
      <input
        className="input"
        style={{ fontFamily: 'var(--font-mono)' }}
        value={tag}
        disabled={readonly}
        onChange={(e) => setTag(e.target.value)}
      />
      <div className="code-hint">
        Reference in the next prompt as <code>&lt;specflow_{tag || 'tag_name'}&gt;</code>.<br />
        At runtime it&apos;s substituted with{' '}
        <code>&lt;{tag || 'tag_name'}&gt;…content…&lt;/{tag || 'tag_name'}&gt;</code>.
      </div>

      <div className="section-title">
        Hand-off prompt
        <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>optional</span>
      </div>
      <textarea
        className="textarea code"
        rows={5}
        value={prompt}
        disabled={readonly}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="How should the previous node format its output?"
      />

      {!readonly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge?.(edge.id); onClose(); }}>
            <Icon name="trash" size={12} />Delete
          </button>
          <button className="btn primary" onClick={handleSave}>
            <Icon name="check" size={12} />Save
          </button>
        </div>
      )}
    </RightPanel>
  );
}
