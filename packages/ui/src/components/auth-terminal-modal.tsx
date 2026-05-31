import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAuthTerminal,
  checkAuthTerminal,
  resizeAuthTerminal,
  sendAuthTerminalInput,
  subscribeToAuthTerminal,
  type AgentAuthenticationStatus,
  type AuthTerminalStatus,
} from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';
import { TerminalSurface, type TerminalSurfaceHandle } from './terminal-surface';

interface AuthTerminalModalProps {
  sessionId: string;
  agentServerId: string;
  onClose: () => void;
  onAuthStatus: (status: AgentAuthenticationStatus) => void | Promise<void>;
}

export function AuthTerminalModal({ sessionId, agentServerId, onClose, onAuthStatus }: AuthTerminalModalProps) {
  const { t } = useI18n();
  const terminalRef = useRef<TerminalSurfaceHandle | null>(null);
  const [status, setStatus] = useState<AuthTerminalStatus>('running');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setStatus('running');
    setError('');
    const unsubscribe = subscribeToAuthTerminal(sessionId, (event) => {
      if (event.type === 'output') {
        terminalRef.current?.write(event.data);
        return;
      }
      setStatus(event.status);
      if (event.error) setError(event.error);
      if (event.authStatus) void onAuthStatus(event.authStatus);
    }, () => setError(t('auth.terminalDisconnected')));
    return unsubscribe;
  }, [sessionId, onAuthStatus, t]);

  const sendInput = useCallback((data: string) => {
    void sendAuthTerminalInput(sessionId, data).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [sessionId]);

  const resize = useCallback((cols: number, rows: number) => {
    void resizeAuthTerminal(sessionId, cols, rows).catch(() => {});
  }, [sessionId]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const authStatus = await checkAuthTerminal(sessionId);
      await onAuthStatus(authStatus);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, [sessionId, onAuthStatus]);

  const cancel = useCallback(async () => {
    try {
      await cancelAuthTerminal(sessionId);
    } catch {
      // Closing should still be allowed if the session already ended.
    }
    onClose();
  }, [sessionId, onClose]);

  return (
    <div className="run-modal-overlay agent-auth-terminal-overlay">
      <div className="auth-terminal-modal">
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="terminal" size={11} /> {t('auth.terminalLabel')}</div>
            <h2>{agentServerId}</h2>
          </div>
          <span className={`cap-badge ${status === 'running' ? 'update' : status === 'succeeded' ? 'on' : ''}`}>
            {t(`auth.terminalStatus.${status}`)}
          </span>
        </div>
        {error && <div className="agent-server-error">{error}</div>}
        <div className="auth-terminal-frame">
          <TerminalSurface ref={terminalRef} onData={sendInput} onResize={resize} />
        </div>
        <div className="run-modal-actions">
          <button className="btn" onClick={cancel}>
            <Icon name="x" size={10} />{status === 'running' ? t('common.cancel') : t('common.close')}
          </button>
          <button className="btn primary" disabled={checking} onClick={check}>
            <Icon name="check" size={10} />{checking ? t('auth.checking') : t('auth.checkAgain')}
          </button>
        </div>
      </div>
    </div>
  );
}
