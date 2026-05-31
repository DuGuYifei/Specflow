import { useCallback, useEffect, useState } from 'react';
import {
  authenticateAgentServer,
  type AgentAuthenticationMethod,
  type AgentAuthenticationStatus,
} from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { AuthTerminalModal } from './auth-terminal-modal';

interface AgentAuthModalProps {
  statuses: AgentAuthenticationStatus[];
  onClose: () => void;
  onReady: () => void | Promise<void>;
  onChanged?: () => void;
}

export function AgentAuthModal({ statuses: initialStatuses, onClose, onReady, onChanged }: AgentAuthModalProps) {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState(initialStatuses);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [terminalSession, setTerminalSession] = useState<{ id: string; agentServerId: string } | undefined>();

  useEffect(() => {
    setStatuses(initialStatuses);
  }, [initialStatuses]);

  async function runAuth(status: AgentAuthenticationStatus, method: AgentAuthenticationMethod) {
    setBusy(`${status.agentServerId}:${method.id}`);
    try {
      const result = await authenticateAgentServer(status.agentServerId, method.id);
      if (isTerminalAuthStart(result)) {
        setTerminalSession({ id: result.terminalSessionId, agentServerId: status.agentServerId });
        return;
      }
      await applyAuthStatus(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  const applyAuthStatus = useCallback(async (updated: AgentAuthenticationStatus) => {
    const nextStatuses = statuses.map((candidate) =>
      candidate.agentServerId === updated.agentServerId ? updated : candidate,
    );
    setStatuses(nextStatuses);
    onChanged?.();
    if (nextStatuses.every((candidate) => !candidate.needsAuth)) {
      setTerminalSession(undefined);
      await onReady();
    }
  }, [onChanged, onReady, statuses]);

  return (
    <div className="run-modal-overlay agent-auth-overlay" onMouseDown={onClose}>
      <div className="agent-auth-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="lock" size={11} /> {t('auth.label')}</div>
            <h2>{t('auth.title')}</h2>
          </div>
          <button className="close" onClick={onClose} title={t('common.close')}>
            <Icon name="x" size={14} />
          </button>
        </div>

        {error && <div className="agent-server-error">{error}</div>}

        <div className="agent-auth-status-list">
          {statuses.filter((status) => status.needsAuth).map((status) => (
            <section className="agent-auth-status" key={status.agentServerId}>
              <div className="agent-server-title">
                <span>{status.agentServerId}</span>
                <span className="cap-badge update">{t('auth.required')}</span>
              </div>

              {status.methods.length === 0 && (
                <div className="agent-server-desc">{t('auth.noMethod')}</div>
              )}

              {status.methods.map((method) => (
                <div className="agent-auth-method" key={method.id}>
                  <div className="agent-auth-method-head">
                    <span>{method.name}</span>
                    <span className="mono-id">{method.type}</span>
                    {method.type === 'env_var' && method.link && (
                      <a href={method.link} target="_blank" rel="noreferrer" title={t('auth.credentialsTitle', { name: method.name })}>
                        <Icon name="external" size={10} />
                      </a>
                    )}
                  </div>

                  {method.description && <div className="agent-server-desc">{method.description}</div>}

                  {method.type === 'env_var' && (
                    <div className="agent-auth-env">
                      {method.vars.map((variable) => (
                        <div className="agent-auth-env-row" key={variable.name}>
                          <span>{variable.label || variable.name}</span>
                          <span className="mono-id">{variable.name}</span>
                          {variable.optional && <span className="cap-badge">{t('common.optional')}</span>}
                        </div>
                      ))}
                      {method.missingVars.length > 0 && (
                        <div className="agent-auth-missing">{t('auth.missing', { names: method.missingVars.join(', ') })}</div>
                      )}
                      <div className="agent-server-desc">{t('auth.envConfigHint')}</div>
                    </div>
                  )}

                  <button
                    className="btn sm primary"
                    disabled={busy === `${status.agentServerId}:${method.id}`}
                    onClick={() => runAuth(status, method)}
                  >
                    <Icon name={method.type === 'env_var' ? 'check' : 'external'} size={10} />
                    {busy === `${status.agentServerId}:${method.id}`
                      ? t('auth.checking')
                      : method.type === 'env_var' ? t('auth.checkEnv') : t('auth.authenticate')}
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        {terminalSession && (
          <AuthTerminalModal
            sessionId={terminalSession.id}
            agentServerId={terminalSession.agentServerId}
            onClose={() => setTerminalSession(undefined)}
            onAuthStatus={applyAuthStatus}
          />
        )}
      </div>
    </div>
  );
}

function isTerminalAuthStart(
  value: Awaited<ReturnType<typeof authenticateAgentServer>>,
): value is { status: 'terminal_started'; terminalSessionId: string } {
  return typeof value === 'object'
    && value !== null
    && 'status' in value
    && value.status === 'terminal_started';
}
