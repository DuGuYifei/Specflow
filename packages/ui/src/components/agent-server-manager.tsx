import { useEffect, useMemo, useState } from 'react';
import {
  fetchAgentServerAuth,
  fetchAgentRegistry,
  fetchAgentServers,
  removeAgentServer,
  saveAgentServer,
  type AgentAuthenticationStatus,
  type AgentServerEntry,
  type RegistryAgent,
} from '../api';
import { useI18n } from '../i18n';
import { Icon } from './icon';

interface AgentServerManagerProps {
  onClose: () => void;
  onChanged?: () => void;
  onAuthRequired?: (statuses: AgentAuthenticationStatus[]) => void;
}

export function AgentServerManager({ onClose, onChanged, onAuthRequired }: AgentServerManagerProps) {
  const { t } = useI18n();
  const [servers, setServers] = useState<AgentServerEntry[]>([]);
  const [registry, setRegistry] = useState<RegistryAgent[]>([]);
  const [tab, setTab] = useState<'registry' | 'custom'>('registry');
  const [busy, setBusy] = useState('');
  const [busyMessage, setBusyMessage] = useState('');
  const [loadingRegistry, setLoadingRegistry] = useState(true);
  const [error, setError] = useState('');
  const [customId, setCustomId] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');
  const [customEnv, setCustomEnv] = useState('');
  const [customAdditionalDirs, setCustomAdditionalDirs] = useState('');
  const [customTerminalEnabled, setCustomTerminalEnabled] = useState(true);
  const [customTerminalAuth, setCustomTerminalAuth] = useState(false);
  const [customDefaultMode, setCustomDefaultMode] = useState('');
  const [customDefaultModel, setCustomDefaultModel] = useState('');
  const [customConfigOptions, setCustomConfigOptions] = useState('');

  const installed = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const installedRegistry = useMemo(() => {
    const byRegistryId = new Map<string, AgentServerEntry>();
    for (const server of servers) {
      if (server.settings.type === 'registry') byRegistryId.set(server.settings.registryId, server);
    }
    return byRegistryId;
  }, [servers]);

  useEffect(() => {
    void refreshAll();
  }, []);

  async function refreshAll() {
    try {
      setError('');
      setLoadingRegistry(true);
      const [serverList, registryIndex] = await Promise.all([
        fetchAgentServers(),
        fetchAgentRegistry(),
      ]);
      setServers(serverList);
      setRegistry(registryIndex.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRegistry(false);
    }
  }

  async function installRegistry(agent: RegistryAgent) {
    setBusy(agent.id);
    setBusyMessage(t('agentServers.downloadingChecking', { name: agent.name || agent.id }));
    try {
      setServers(await saveAgentServer(agent.id, {
        type: 'registry',
        registryId: agent.id,
        installedVersion: agent.version,
      }));
      setBusyMessage(t('agentServers.checkingAuth', { name: agent.name || agent.id }));
      await inspectAuthIfNeeded(agent.id);
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
      setBusyMessage('');
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      setServers(await removeAgentServer(id));
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function updateRegistry(agent: RegistryAgent, server: AgentServerEntry) {
    if (server.settings.type !== 'registry') return;
    setBusy(server.id);
    setBusyMessage(t('agentServers.downloadingChecking', { name: agent.name || agent.id }));
    try {
      setServers(await saveAgentServer(server.id, {
        ...server.settings,
        installedVersion: agent.version,
      }));
      setBusyMessage(t('agentServers.checkingAuth', { name: agent.name || agent.id }));
      await inspectAuthIfNeeded(server.id);
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
      setBusyMessage('');
    }
  }

  async function saveCustom() {
    const id = customId.trim();
    const command = customCommand.trim();
    if (!id || !command) return;
    setBusy(id);
    try {
      setServers(await saveAgentServer(id, {
        type: 'custom',
        command,
        args: splitArgs(customArgs),
        env: parseEnv(customEnv),
        additionalDirectories: splitLines(customAdditionalDirs),
        terminal: { enabled: customTerminalEnabled, auth: customTerminalAuth },
        defaultMode: customDefaultMode.trim() || undefined,
        defaultModel: customDefaultModel.trim() || undefined,
        defaultConfigOptions: parseConfigOptions(customConfigOptions),
      }));
      setCustomId('');
      setCustomCommand('');
      setCustomArgs('');
      setCustomEnv('');
      setCustomAdditionalDirs('');
      setCustomTerminalEnabled(true);
      setCustomTerminalAuth(false);
      setCustomDefaultMode('');
      setCustomDefaultModel('');
      setCustomConfigOptions('');
      await inspectAuthIfNeeded(id);
      onChanged?.();
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('');
    }
  }

  async function inspectAuthIfNeeded(id: string) {
    const status = await fetchAgentServerAuth(id);
    if (status.needsAuth) onAuthRequired?.([status]);
  }

  return (
    <div className="run-modal-overlay" onMouseDown={onClose}>
      <div className="agent-server-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="settings" size={11} /> {t('agentServers.label')}</div>
            <h2>{t('agentServers.title')}</h2>
          </div>
          <button className="close" onClick={onClose} title={t('common.close')}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="agent-server-tabs">
          <button className={tab === 'registry' ? 'active' : ''} onClick={() => setTab('registry')}>
            <Icon name="list" size={11} />{t('agentServers.registry')}
          </button>
          <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
            <Icon name="terminal" size={11} />{t('agentServers.custom')}
          </button>
        </div>

        {error && <div className="agent-server-error">{error}</div>}
        {busyMessage && <div className="agent-server-desc agent-server-busy">{busyMessage}</div>}

        {tab === 'registry' && (
          <div className="agent-server-list">
            {loadingRegistry && <div className="agent-server-desc agent-server-busy">{t('agentServers.loadingRegistry')}</div>}
            {registry.map((agent) => {
              const installedServer = installedRegistry.get(agent.id) ?? installed.get(agent.id);
              const isInstalled = Boolean(installedServer);
              const installedVersion = installedServer?.settings.type === 'registry'
                ? installedServer.settings.installedVersion
                : undefined;
              const hasUpdate = Boolean(installedVersion && installedVersion !== agent.version);
              return (
                <div className="agent-server-row" key={agent.id}>
                  <div className="agent-server-main">
                    <div className="agent-server-title">
                      <span>{agent.name || agent.id}</span>
                      <span className="mono-id">{agent.version}</span>
                      {isInstalled && <span className="cap-badge on">{t('agentServers.installed')}</span>}
                      {hasUpdate && <span className="cap-badge update">{t('agentServers.update')}</span>}
                    </div>
                    <div className="agent-server-desc">{agent.description || agent.id}</div>
                    <div className="history-meta">
                      {Boolean(agent.distribution.binary) && <span>{t('agentServers.binary')}</span>}
                      {Boolean(agent.distribution.npx) && <span>npx</span>}
                      {Boolean(agent.distribution.uvx) && <span>uvx</span>}
                      {installedVersion && (
                        <span>installed {installedVersion}</span>
                      )}
                    </div>
                  </div>
                  <div className="agent-server-actions">
                    {agent.website && (
                      <a className="btn sm" href={agent.website} target="_blank" rel="noreferrer">
                        <Icon name="external" size={10} />{t('agentServers.site')}
                      </a>
                    )}
                    {installedServer ? (
                      <>
                        {hasUpdate && (
                          <button className="btn sm primary" disabled={busy === installedServer.id} onClick={() => updateRegistry(agent, installedServer)}>
                            <Icon name="check" size={10} />{t('agentServers.updateButton')}
                          </button>
                        )}
                        <button className="btn sm" disabled={busy === installedServer.id} onClick={() => remove(installedServer.id)}>
                          <Icon name="trash" size={10} />{t('agentServers.remove')}
                        </button>
                      </>
                    ) : (
                      <button className="btn sm primary" disabled={busy === agent.id} onClick={() => installRegistry(agent)}>
                        <Icon name="plus" size={10} />{t('agentServers.install')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'custom' && (
          <div className="agent-server-custom">
            <div className="agent-server-form">
              <input className="input" value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder={t('agentServers.customId')} />
              <input className="input" value={customCommand} onChange={(e) => setCustomCommand(e.target.value)} placeholder={t('agentServers.customCommand')} />
              <input className="input" value={customArgs} onChange={(e) => setCustomArgs(e.target.value)} placeholder={t('agentServers.customArgs')} />
              <input className="input" value={customDefaultMode} onChange={(e) => setCustomDefaultMode(e.target.value)} placeholder={t('agentServers.customMode')} />
              <input className="input" value={customDefaultModel} onChange={(e) => setCustomDefaultModel(e.target.value)} placeholder={t('agentServers.customModel')} />
              <textarea className="textarea code" value={customConfigOptions} onChange={(e) => setCustomConfigOptions(e.target.value)} placeholder={t('agentServers.customConfig')} rows={3} />
              <textarea className="textarea code" value={customAdditionalDirs} onChange={(e) => setCustomAdditionalDirs(e.target.value)} placeholder={t('agentServers.customDirs')} rows={3} />
              <label className="agent-server-toggle">
                <input type="checkbox" checked={customTerminalEnabled} onChange={(e) => setCustomTerminalEnabled(e.target.checked)} />
                <span>{t('agentServers.terminalEnabled')}</span>
              </label>
              <label className="agent-server-toggle">
                <input type="checkbox" checked={customTerminalAuth} onChange={(e) => setCustomTerminalAuth(e.target.checked)} disabled={!customTerminalEnabled} />
                <span>{t('agentServers.terminalAuth')}</span>
              </label>
              <textarea className="textarea code" value={customEnv} onChange={(e) => setCustomEnv(e.target.value)} placeholder={t('agentServers.customEnv')} rows={4} />
              <button className="btn primary" disabled={!customId.trim() || !customCommand.trim() || Boolean(busy)} onClick={saveCustom}>
                <Icon name="check" size={12} />{t('agentServers.saveCustom')}
              </button>
            </div>

            <div className="agent-server-list compact">
              {servers.map((server) => {
                if (server.settings.type !== 'custom') return null;
                return (
                  <div className="agent-server-row" key={server.id}>
                    <div className="agent-server-main">
                      <div className="agent-server-title">
                        <span>{server.id}</span>
                        <span className="mono-id">{server.settings.command}</span>
                      </div>
                      <div className="agent-server-desc">{server.settings.args?.join(' ') || t('agentServers.noArgs')}</div>
                    </div>
                    <div className="agent-server-actions">
                      <button className="btn sm" disabled={busy === server.id} onClick={() => remove(server.id)}>
                        <Icon name="trash" size={10} />{t('agentServers.remove')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function splitLines(input: string): string[] {
  return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function splitArgs(input: string): string[] {
  return input.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function parseEnv(input: string): Record<string, string> {
  return Object.fromEntries(input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return index >= 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ''];
    }));
}

function parseConfigOptions(input: string): Record<string, string | boolean> {
  return Object.fromEntries(input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      const key = index >= 0 ? line.slice(0, index) : line;
      const raw = index >= 0 ? line.slice(index + 1) : 'true';
      const value = raw === 'true' ? true : raw === 'false' ? false : raw;
      return [key, value];
    }));
}
