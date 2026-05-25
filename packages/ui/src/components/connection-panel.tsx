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
  const inputRelation = fromNode?.kind === 'input';
  const completionEdge = toNode?.kind === 'end';
  const gateInput = toNode?.kind === 'gate';
  const sameSession = Boolean(sessionId(transferSourceNode) && sessionId(transferSourceNode) === sessionId(toNode));
  if (inputRelation || completionEdge) {
    return (
      <RightPanel label={<><Icon name="link" size={11} />Control connection</>} title={inputRelation ? 'Run input reference' : 'Workflow completion'} onClose={onClose}>
        <div className="code-hint">
          {inputRelation
            ? 'This connection documents an input variable reference. The variable is substituted in prompts before runtime and this edge carries no output.'
            : 'This connection marks completion of the selected path and carries no output.'}
        </div>
        {completionEdge && fromNode?.kind === 'gate' && <TraversalLimit edge={edge} readonly={viewMode === 'run'} onEditEdge={onEditEdge} />}
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
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
        {fromNode?.kind === 'gate' && <TraversalLimit edge={edge} readonly={viewMode === 'run'} onEditEdge={onEditEdge} />}
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
  const [maxTraversals, setMaxTraversals] = useState(edge.maxTraversals ?? 1);
  const readonly = viewMode === 'run';
  const viaGate = fromNode?.kind === 'gate';
  const validOutputTag = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(outputTag);
  return (
    <RightPanel label={<><Icon name="route" size={11} />Connection</>} title={`${transferSourceNode?.title ?? ''} -> ${toNode?.title ?? ''}`} onClose={onClose}>
      {viaGate && <div className="code-hint">After this branch is selected, transferred content comes from the step before the gate.</div>}
      {viaGate && <TraversalLimit edge={{ ...edge, maxTraversals }} readonly={readonly} onValueChange={setMaxTraversals} />}
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
            ...(viaGate ? { maxTraversals } : {}),
          })}><Icon name="check" size={12} />Save</button>
        </div>
      )}
    </RightPanel>
  );
}

function TraversalLimit({ edge, readonly, onEditEdge, onValueChange }: {
  edge: Edge;
  readonly: boolean;
  onEditEdge?: (id: string, patch: Partial<Edge>) => void;
  onValueChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(edge.maxTraversals ?? 1);
  return (
    <>
      <div className="section-title">Branch traversal limit</div>
      <input
        className="input"
        type="number"
        min={1}
        step={1}
        value={value}
        disabled={readonly}
        onChange={(event) => {
          const next = Math.max(1, Number.parseInt(event.target.value || '1', 10) || 1);
          setValue(next);
          onValueChange?.(next);
          if (!onValueChange) onEditEdge?.(edge.id, { maxTraversals: next });
        }}
      />
      <div className="code-hint">Maximum times this gate branch may be selected during one run. Loopback branches use this bound to prevent infinite revision cycles.</div>
    </>
  );
}

function DeleteButton({ edge, onDeleteEdge, onClose }: Pick<ConnectionPanelProps, 'edge' | 'onDeleteEdge' | 'onClose'>) {
  return (
    <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge?.(edge.id); onClose(); }}>
      <Icon name="trash" size={12} />Delete
    </button>
  );
}
