import { useState } from 'react';
import type { AgentSessionRecord, RestoreMode } from '../api';
import { Icon } from './icon';

export interface ConversationLine {
  role: 'agent' | 'user' | 'system' | 'terminal';
  text: string;
}

interface AgentConversationWindowProps {
  session: AgentSessionRecord;
  mode: RestoreMode;
  status: string;
  lines: ConversationLine[];
  canPrompt: boolean;
  busy: boolean;
  onPrompt: (prompt: string) => void;
  onClose: () => void;
}

export function AgentConversationWindow(props: AgentConversationWindowProps) {
  const [prompt, setPrompt] = useState('');
  const submit = () => {
    const value = prompt.trim();
    if (!value || props.busy || !props.canPrompt) return;
    props.onPrompt(value);
    setPrompt('');
  };

  return (
    <div className="conversation-overlay">
      <section className="conversation-window" aria-label="ACP conversation">
        <header className="conversation-head">
          <div>
            <div className="conversation-title">
              <Icon name={props.mode === 'inspect' ? 'search' : 'play-circle'} size={13} />
              {props.mode === 'inspect' ? 'Inspect session' : 'Resume session'}
            </div>
            <div className="conversation-meta">
              {props.session.agentServerId} · <span className="mono-id">{props.session.acpSessionId}</span>
            </div>
          </div>
          <div className="conversation-controls">
            <span className="agent-badge">{props.status}</span>
            <button className="icon-btn" onClick={props.onClose} title="Close conversation"><Icon name="x" size={13} /></button>
          </div>
        </header>
        <div className="conversation-transcript">
          {props.lines.map((line, index) => (
            <div key={index} className={`conversation-message ${line.role}`}>
              <span className="conversation-role">{line.role}</span>
              <span className="conversation-text">{line.text}</span>
            </div>
          ))}
          {props.lines.length === 0 && <div className="history-empty">Waiting for ACP session content...</div>}
        </div>
        {props.mode === 'inspect' ? (
          <footer className="conversation-readonly">
            Inspect is read-only. Use Resume to continue this ACP session.
          </footer>
        ) : (
          <footer className="conversation-compose">
            <textarea
              className="textarea"
              value={prompt}
              rows={3}
              disabled={!props.canPrompt || props.busy}
              placeholder={props.canPrompt ? 'Send a prompt to this ACP session...' : 'Restoring session...'}
              onInput={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
              }}
            />
            <button className="btn primary" disabled={!props.canPrompt || props.busy || !prompt.trim()} onClick={submit}>
              {props.busy ? 'Sending...' : 'Send'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
