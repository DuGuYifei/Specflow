import { useState } from 'react';
import type { TimelineEvent } from '../types';
import type { AgentSessionRecord, RestoreMode } from '../api';
import { Icon } from './icon';
import { SessionTimeline } from './session-timeline';
import { useI18n } from '../i18n';

export interface ConversationLine {
  role: 'agent' | 'user' | 'system' | 'terminal';
  text: string;
}

interface AgentConversationWindowProps {
  session: AgentSessionRecord;
  mode: RestoreMode;
  status: string;
  events: TimelineEvent[];
  canPrompt: boolean;
  busy: boolean;
  onPrompt: (prompt: string) => void;
  onClose: () => void;
}

export function AgentConversationWindow(props: AgentConversationWindowProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const submit = () => {
    const value = prompt.trim();
    if (!value || props.busy || !props.canPrompt) return;
    props.onPrompt(value);
    setPrompt('');
  };

  return (
    <div className="conversation-overlay">
      <section className="conversation-window" aria-label={t('conversation.ariaLabel')}>
        <header className="conversation-head">
          <div>
            <div className="conversation-title">
              <Icon name={props.mode === 'inspect' ? 'search' : 'play-circle'} size={13} />
              {props.mode === 'inspect' ? t('conversation.inspectSession') : t('conversation.resumeSession')}
            </div>
            <div className="conversation-meta">
              {props.session.agentServerId} · <span className="mono-id">{props.session.acpSessionId}</span>
            </div>
          </div>
          <div className="conversation-controls">
            <span className="agent-badge">{props.status}</span>
            <button className="icon-btn" onClick={props.onClose} title={t('conversation.closeTitle')}><Icon name="x" size={13} /></button>
          </div>
        </header>
        <div className="conversation-transcript">
          <SessionTimeline events={props.events} emptyMessage={t('conversation.waiting')} />
        </div>
        {props.mode === 'inspect' ? (
          <footer className="conversation-readonly">
            {t('conversation.inspectReadonly')}
          </footer>
        ) : (
          <footer className="conversation-compose">
            <textarea
              className="textarea"
              value={prompt}
              rows={3}
              disabled={!props.canPrompt || props.busy}
              placeholder={props.canPrompt ? t('conversation.prompt') : t('conversation.restoring')}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
              }}
            />
            <button className="btn primary" disabled={!props.canPrompt || props.busy || !prompt.trim()} onClick={submit}>
              {props.busy ? t('conversation.sending') : t('conversation.send')}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
