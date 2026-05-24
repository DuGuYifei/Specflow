import { useState } from 'react';
import type { Edge, WorkflowNode } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';

interface ConnectionPanelProps {
  edge: Edge;
  fromNode?: WorkflowNode;
  toNode?: WorkflowNode;
  transferSourceNode?: WorkflowNode;
  viewMode: 'edit' | 'run';
  onClose: () => void;
  onEditEdge?: (id: string, patch: Partial<Edge>) => void;
  onDeleteEdge?: (id: string) => void;
}

function sessionId(node: WorkflowNode | undefined): string | null {
  return node?.kind === 'step' ? node.sessionId : null;
}

export function ConnectionPanel(props: ConnectionPanelProps) {
  const { edge, fromNode, toNode, transferSourceNode = fromNode, viewMode, onClose, onEditEdge, onDeleteEdge } = props;
  const gateInput = toNode?.kind === 'gate';
  const sameSession = Boolean(sessionId(transferSourceNode) && sessionId(transferSourceNode) === sessionId(toNode));
  if (gateInput) {
    return (
      <RightPanel label={<><Icon name="route" size={11} />Gate input</>} title="Decision context" onClose={onClose}>
        <div className="code-hint">This edge supplies the previous step output for branch selection. It has no output tag or handoff configuration.</div>
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
  if (sameSession) {
    return (
      <RightPanel label={<><Icon name="link" size={11} />Same-session connection</>} title="Continue conversation" onClose={onClose}>
        <div className="code-hint">The selected target continues in the same session as the content-producing step. No explicit output transfer is needed.</div>
        {fromNode?.kind === 'gate' && <div className="code-hint">This branch continues the input step&apos;s session after the gate selects it.</div>}
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
  return <TransferPanel {...props} transferSourceNode={transferSourceNode} />;
}

function TransferPanel({ edge, fromNode, toNode, transferSourceNode, viewMode, onClose, onEditEdge, onDeleteEdge }: ConnectionPanelProps) {
  const [transmit, setTransmit] = useState(edge.transmit === true);
  const [outputTag, setOutputTag] = useState(edge.outputTag ?? '');
  const [handoffPrompt, setHandoffPrompt] = useState(edge.handoffPrompt ?? '');
  const readonly = viewMode === 'run';
  const viaGate = fromNode?.kind === 'gate';
  const validOutputTag = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(outputTag);
  return (
    <RightPanel label={<><Icon name="route" size={11} />Connection</>} title={`${transferSourceNode?.title ?? ''} -> ${toNode?.title ?? ''}`} onClose={onClose}>
      {viaGate && <div className="code-hint">After this branch is selected, transferred content comes from the step before the gate.</div>}
      <div className="section-title">Transfer output</div>
      <div className="output-card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className={`switch${transmit ? ' on' : ''}`} disabled={readonly} onClick={() => setTransmit(!transmit)} />
        <span>{transmit ? 'Pass explicit content to the target session.' : 'Activate target without passing explicit content.'}</span>
      </div>
      {transmit && (
        <>
          <div className="section-title">Output tag</div>
          <input className="input" value={outputTag} disabled={readonly} placeholder="implementation" onChange={(event) => setOutputTag(event.target.value.replace(/[^A-Za-z0-9_.-]/g, ''))} />
          <div className="code-hint">
            Reference in the target prompt as <code>&lt;specflow_{outputTag || 'tag_name'}&gt;</code>. At runtime it becomes <code>&lt;{outputTag || 'tag_name'}&gt;...content...&lt;/{outputTag || 'tag_name'}&gt;</code>.
          </div>
          {outputTag && !validOutputTag && <div className="code-hint">Output tag must start with a letter or underscore.</div>}
          <div className="section-title">Handoff prompt</div>
          <textarea className="textarea code" rows={5} value={handoffPrompt} disabled={readonly} onChange={(event) => setHandoffPrompt(event.target.value)} placeholder="Optional: ask the source step to format or summarize its last output before transferring it." />
          <div className="code-hint">When empty, the source step&apos;s last output is transferred unchanged. When set, this prompt runs in the source session because it has the producing context.</div>
        </>
      )}
      {!readonly && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />
          <button className="btn primary" disabled={transmit && !validOutputTag} onClick={() => onEditEdge?.(edge.id, {
            transmit,
            outputTag: transmit ? outputTag : undefined,
            handoffPrompt: transmit && handoffPrompt ? handoffPrompt : undefined,
          })}><Icon name="check" size={12} />Save</button>
        </div>
      )}
    </RightPanel>
  );
}

function DeleteButton({ edge, onDeleteEdge, onClose }: Pick<ConnectionPanelProps, 'edge' | 'onDeleteEdge' | 'onClose'>) {
  return (
    <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge?.(edge.id); onClose(); }}>
      <Icon name="trash" size={12} />Delete
    </button>
  );
}
