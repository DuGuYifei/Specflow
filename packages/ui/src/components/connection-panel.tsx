import { useState } from 'react';
import type { Edge, WorkflowNode } from '../types';
import { Icon } from './icon';
import { RightPanel } from './right-panel';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
  const { edge, fromNode, toNode, transferSourceNode = fromNode, viewMode, onClose, onEditEdge, onDeleteEdge } = props;
  const inputRelation = fromNode?.kind === 'input';
  const completionEdge = toNode?.kind === 'end';
  const gateInput = toNode?.kind === 'gate';
  const sameSession = Boolean(sessionId(transferSourceNode) && sessionId(transferSourceNode) === sessionId(toNode));
  if (inputRelation || completionEdge) {
    return (
      <RightPanel label={<><Icon name="link" size={11} />{t('connection.control')}</>} title={inputRelation ? t('connection.runInputReference') : t('connection.workflowCompletion')} onClose={onClose}>
        <div className="code-hint">
          {inputRelation
            ? t('connection.inputHint')
            : t('connection.completionHint')}
        </div>
        {completionEdge && fromNode?.kind === 'gate' && <TraversalLimit edge={edge} readonly={viewMode === 'run'} onEditEdge={onEditEdge} />}
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
  if (gateInput) {
    return (
      <RightPanel label={<><Icon name="route" size={11} />{t('connection.gateInput')}</>} title={t('connection.decisionContext')} onClose={onClose}>
        <div className="code-hint">{t('connection.gateInputHint')}</div>
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
  if (sameSession) {
    return (
      <RightPanel label={<><Icon name="link" size={11} />{t('connection.sameSession')}</>} title={t('connection.continueConversation')} onClose={onClose}>
        <div className="code-hint">{t('connection.sameSessionHint')}</div>
        {fromNode?.kind === 'gate' && <div className="code-hint">{t('connection.gateBranchSameSessionHint')}</div>}
        {fromNode?.kind === 'gate' && <TraversalLimit edge={edge} readonly={viewMode === 'run'} onEditEdge={onEditEdge} />}
        {viewMode === 'edit' && <DeleteButton edge={edge} onDeleteEdge={onDeleteEdge} onClose={onClose} />}
      </RightPanel>
    );
  }
  return <TransferPanel {...props} transferSourceNode={transferSourceNode} />;
}

function TransferPanel({ edge, fromNode, toNode, transferSourceNode, viewMode, onClose, onEditEdge, onDeleteEdge }: ConnectionPanelProps) {
  const { t } = useI18n();
  const [transmit, setTransmit] = useState(edge.transmit === true);
  const [outputTag, setOutputTag] = useState(edge.outputTag ?? '');
  const [handoffPrompt, setHandoffPrompt] = useState(edge.handoffPrompt ?? '');
  const [maxTraversals, setMaxTraversals] = useState(edge.maxTraversals ?? 1);
  const readonly = viewMode === 'run';
  const viaGate = fromNode?.kind === 'gate';
  const validOutputTag = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(outputTag);
  return (
    <RightPanel label={<><Icon name="route" size={11} />{t('connection.connection')}</>} title={`${transferSourceNode?.title ?? ''} -> ${toNode?.title ?? ''}`} onClose={onClose}>
      {viaGate && <div className="code-hint">{t('connection.viaGateHint')}</div>}
      {viaGate && <TraversalLimit edge={{ ...edge, maxTraversals }} readonly={readonly} onValueChange={setMaxTraversals} />}
      <div className="section-title">{t('connection.transferOutput')}</div>
      <div className="output-card" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className={`switch${transmit ? ' on' : ''}`} disabled={readonly} onClick={() => setTransmit(!transmit)} />
        <span>{transmit ? t('connection.passContent') : t('connection.activateWithoutContent')}</span>
      </div>
      {transmit && (
        <>
          <div className="section-title">{t('connection.outputTag')}</div>
          <input className="input" value={outputTag} disabled={readonly} placeholder="implementation" onChange={(event) => setOutputTag(event.target.value.replace(/[^A-Za-z0-9_.-]/g, ''))} />
          <div className="code-hint">
            {t('connection.outputTagHint')} <code>&lt;specflow_{outputTag || 'tag_name'}&gt;</code>. {t('connection.outputTagRuntimeHint')} <code>&lt;{outputTag || 'tag_name'}&gt;...content...&lt;/{outputTag || 'tag_name'}&gt;</code>.
          </div>
          {outputTag && !validOutputTag && <div className="code-hint">{t('connection.outputTagInvalid')}</div>}
          <div className="section-title">{t('connection.handoffPrompt')}</div>
          <textarea className="textarea code" rows={5} value={handoffPrompt} disabled={readonly} onChange={(event) => setHandoffPrompt(event.target.value)} placeholder={t('connection.handoffPlaceholder')} />
          <div className="code-hint">{t('connection.handoffHint')}</div>
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
          })}><Icon name="check" size={12} />{t('common.save')}</button>
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
  const { t } = useI18n();
  const [value, setValue] = useState(edge.maxTraversals ?? 1);
  return (
    <>
      <div className="section-title">{t('connection.branchTraversalLimit')}</div>
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
      <div className="code-hint">{t('connection.branchTraversalHint')}</div>
    </>
  );
}

function DeleteButton({ edge, onDeleteEdge, onClose }: Pick<ConnectionPanelProps, 'edge' | 'onDeleteEdge' | 'onClose'>) {
  const { t } = useI18n();
  return (
    <button className="btn ghost" style={{ color: 'var(--err)' }} onClick={() => { onDeleteEdge?.(edge.id); onClose(); }}>
      <Icon name="trash" size={12} />{t('common.delete')}
    </button>
  );
}
