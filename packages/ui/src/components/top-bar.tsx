import type { Theme } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './icon';

interface TopBarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  runLabel?: string;
  workflowName?: string;
  onNewRun?: () => void;
  onRerun?: () => void;
  onCancelRun?: () => void;
  canCancelRun?: boolean;
  onAgentServers?: () => void;
  hasAgentUpdates?: boolean;
  view: 'edit' | 'run';
  onExitRunView: () => void;
}

export function TopBar({
  theme,
  onThemeChange,
  runLabel,
  workflowName,
  onNewRun,
  onRerun,
  onCancelRun,
  canCancelRun,
  onAgentServers,
  hasAgentUpdates,
  view,
  onExitRunView,
}: TopBarProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/aflow.png" alt="Aflow" />
        <span>Aflow</span>
      </div>
      <div className="crumbs">
        <span>Acme</span><span className="sep">/</span>
        <span>{t('topbar.workspace')}</span><span className="sep">/</span>
        <span className="current">{workflowName ?? t('topbar.loadingWorkflow')}</span>
        {runLabel && view === 'run' && (
          <>
            <span className="sep">/</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{runLabel}</span>
          </>
        )}
      </div>
      <div className="topbar-spacer" />

      {view === 'run' && (
        <button
          className="topbar-tab active"
          onClick={onExitRunView}
          title={t('topbar.backToDesignTitle')}
        >
          <Icon name="edit" size={13} />{t('topbar.backToDesign')}
        </button>
      )}

      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 6px' }} />
      <button className="btn sm agent-update-button" onClick={onAgentServers} title={t('topbar.agentsTitle')}>
        <Icon name="settings" size={11} />{t('topbar.agents')}
        {hasAgentUpdates && <span className="agent-update-dot" aria-label={t('topbar.agentUpdatesAvailable')} />}
      </button>
      <div className="language-toggle" aria-label={t('language.label')}>
        <button
          className={language === 'en' ? 'active' : ''}
          onClick={() => setLanguage('en')}
          title="English"
        >
          {t('language.english')}
        </button>
        <button
          className={language === 'zh-CN' ? 'active' : ''}
          onClick={() => setLanguage('zh-CN')}
          title="简体中文"
        >
          {t('language.chinese')}
        </button>
      </div>
      <div className="theme-toggle">
        <button
          className={theme === 'light' ? 'active' : ''}
          onClick={() => onThemeChange('light')}
          title={t('topbar.light')}
        >
          <Icon name="sun" size={12} />
        </button>
        <button
          className={theme === 'dark' ? 'active' : ''}
          onClick={() => onThemeChange('dark')}
          title={t('topbar.dark')}
        >
          <Icon name="moon" size={12} />
        </button>
      </div>

      {view === 'run' && onRerun && (
        <button className="btn sm" onClick={onRerun} title={t('topbar.runAgainTitle')}>
          <Icon name="rotate" size={11} />{t('topbar.runAgain')}
        </button>
      )}
      {view === 'run' && canCancelRun && onCancelRun && (
        <button className="btn sm" onClick={onCancelRun} title={t('topbar.cancelRunTitle')}>
          <Icon name="x" size={11} />{t('topbar.cancelRun')}
        </button>
      )}
      {view === 'edit' && (
        <button className="btn sm primary" onClick={onNewRun}>
          <Icon name="play-circle" size={12} />{t('topbar.startRun')}
        </button>
      )}
    </div>
  );
}
