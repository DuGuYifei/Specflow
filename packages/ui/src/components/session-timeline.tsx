import type { TimelineEvent, WorkflowNode } from '../types';
import { useI18n } from '../i18n';

type TimelineRole = 'agent' | 'user' | 'thought' | 'terminal' | 'system';

type TimelineItem =
  | {
      kind: 'message';
      role: TimelineRole;
      text: string;
      nodeId?: string;
      agentInvocationId?: string;
      stream?: 'stdout' | 'stderr' | 'system';
      localContext?: boolean;
    }
  | {
      kind: 'tool';
      toolCallId: string;
      title: string;
      status?: string;
      nodeId?: string;
      agentInvocationId?: string;
    }
  | {
      kind: 'plan';
      entries: Array<{ content: string; status?: string }>;
      agentInvocationId?: string;
    }
  | {
      kind: 'gate';
      branchId: string;
      reason?: string;
      branches?: Array<{ branchId: string; label: string; traversalsUsed: number; maxTraversals: number; available: boolean }>;
      nodeId?: string;
    };

interface SessionTimelineProps {
  events: TimelineEvent[];
  emptyMessage?: string;
  nodeById?: Map<string, WorkflowNode>;
}

export function SessionTimeline({ events, emptyMessage = 'No output yet.', nodeById }: SessionTimelineProps) {
  const { t } = useI18n();
  const items = buildTimelineItems(events);
  if (items.length === 0) return <div className="history-empty">{emptyMessage === 'No output yet.' ? t('timeline.empty') : emptyMessage}</div>;
  return (
    <>
      {items.map((item, index) => {
        if (item.kind === 'tool') {
          return (
            <div key={index} className="timeline-tool">
              <span className="timeline-role">{t('timeline.tool')}</span>
              {item.nodeId && nodeById?.get(item.nodeId) && <span className="node-ref">{nodeById.get(item.nodeId)!.alias}</span>}
              <span className="timeline-tool-title">{item.title}</span>
              {item.status && <span className="timeline-tool-status">{item.status}</span>}
            </div>
          );
        }
        if (item.kind === 'plan') {
          return (
            <div key={index} className="timeline-plan">
              <span className="timeline-role">{t('timeline.plan')}</span>
              <div className="timeline-plan-entries">
                {item.entries.map((entry, entryIndex) => (
                  <div key={entryIndex}>
                    {entry.status && <span className={`timeline-plan-status ${entry.status}`}>{entry.status}</span>}
                    {entry.content}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (item.kind === 'gate') {
          return (
            <div key={index} className="timeline-gate">
              <div className="timeline-gate-head">
                <span className="timeline-role">{t('timeline.gate')}</span>
                {item.nodeId && nodeById?.get(item.nodeId) && <span className="node-ref">{nodeById.get(item.nodeId)!.alias}</span>}
                <span className="timeline-gate-choice">{item.branchId}</span>
              </div>
              {item.reason && <div className="timeline-gate-reason">{item.reason}</div>}
              {item.branches && (
                <div className="timeline-gate-branches">
                  {item.branches.map((branch) => (
                    <span key={branch.branchId} className={`timeline-gate-branch${branch.available ? '' : ' exhausted'}${branch.branchId === item.branchId ? ' chosen' : ''}`}>
                      {branch.label} {branch.traversalsUsed}/{branch.maxTraversals}{branch.available ? '' : ` ${t('timeline.exhausted')}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        }
        const node = item.nodeId ? nodeById?.get(item.nodeId) : undefined;
        return (
          <div key={index} className={`timeline-message ${item.role}${item.stream ? ` ${item.stream}` : ''}${item.localContext ? ' local-context' : ''}`}>
            <span className="timeline-role">{item.role === 'terminal' && item.stream ? item.stream : item.role}</span>
            {node && <span className="node-ref">{node.alias}</span>}
            <span className="timeline-text">{item.text}</span>
          </div>
        );
      })}
    </>
  );
}

export function buildTimelineItems(events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of events) {
    if (event.type === 'display-message') {
      items.push({
        kind: 'message',
        role: event.role,
        text: event.text,
        nodeId: event.nodeId,
      });
      continue;
    }
    if (event.type === 'terminal') {
      appendMessage(items, {
        role: event.stream === 'system' ? 'system' : 'terminal',
        text: event.chunk,
        stream: event.stream,
        nodeId: event.nodeId,
        agentInvocationId: event.agentInvocationId,
        localContext: event.localContext,
      });
      continue;
    }
    if (event.type === 'gate-decision') {
      items.push({
        kind: 'gate',
        branchId: event.branchId,
        reason: event.reason,
        branches: event.branches,
        nodeId: event.nodeId,
      });
      continue;
    }
    const update = record(event.update);
    const updateKind = typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : '';
    if (updateKind === 'agent_message_chunk' || updateKind === 'user_message_chunk' || updateKind === 'agent_thought_chunk') {
      appendMessage(items, {
        role: updateKind === 'agent_message_chunk' ? 'agent' : updateKind === 'user_message_chunk' ? 'user' : 'thought',
        text: contentText(update?.content),
        nodeId: event.nodeId,
        agentInvocationId: event.agentInvocationId,
        localContext: event.localContext,
      });
      continue;
    }
    if (updateKind === 'tool_call' || updateKind === 'tool_call_update') {
      const toolCallId = stringValue(update?.toolCallId) ?? `tool-${items.length}`;
      const existing = items.find((item): item is Extract<TimelineItem, { kind: 'tool' }> =>
        item.kind === 'tool' && item.toolCallId === toolCallId);
      if (existing) {
        existing.title = stringValue(update?.title) ?? existing.title;
        existing.status = stringValue(update?.status) ?? existing.status;
      } else {
        items.push({
          kind: 'tool',
          toolCallId,
          title: stringValue(update?.title) ?? toolCallId,
          status: stringValue(update?.status),
          nodeId: event.nodeId,
          agentInvocationId: event.agentInvocationId,
        });
      }
      continue;
    }
    if (updateKind === 'plan') {
      const entries = Array.isArray(update?.entries)
        ? update.entries.map((entry) => {
            const item = record(entry);
            return {
              content: stringValue(item?.content) ?? stringValue(item?.description) ?? stringValue(item?.title) ?? 'Plan step',
              status: stringValue(item?.status),
            };
          })
        : [];
      const existing = [...items].reverse().find((item): item is Extract<TimelineItem, { kind: 'plan' }> =>
        item.kind === 'plan' && item.agentInvocationId === event.agentInvocationId);
      if (existing) existing.entries = entries;
      else items.push({ kind: 'plan', entries, agentInvocationId: event.agentInvocationId });
      continue;
    }
    if (updateKind) {
      appendMessage(items, {
        role: 'system',
        text: `[acp:${updateKind}]\n`,
        nodeId: event.nodeId,
        agentInvocationId: event.agentInvocationId,
        localContext: event.localContext,
      });
    }
  }
  return items;
}

function appendMessage(items: TimelineItem[], next: Omit<Extract<TimelineItem, { kind: 'message' }>, 'kind'>): void {
  const previous = items.at(-1);
  if (
    previous?.kind === 'message'
    && previous.role === next.role
    && previous.stream === next.stream
    && previous.nodeId === next.nodeId
    && previous.agentInvocationId === next.agentInvocationId
    && previous.localContext === next.localContext
  ) {
    previous.text += next.text;
    return;
  }
  items.push({ kind: 'message', ...next });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function contentText(content: unknown): string {
  const block = record(content);
  if (block?.type === 'text' && typeof block.text === 'string') return block.text;
  return block?.type ? `[${String(block.type)}]` : '';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
