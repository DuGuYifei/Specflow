import type { Theme } from '../types';
import { Icon } from './icon';

interface TopBarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  runLabel?: string;
  workflowName?: string;
  onNewRun?: () => void;
  onRerun?: () => void;
  view: 'edit' | 'run';
  onExitRunView: () => void;
}

export function TopBar({ theme, onThemeChange, runLabel, workflowName, onNewRun, onRerun, view, onExitRunView }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span>specflow</span>
      </div>
      <div className="crumbs">
        <span>Acme</span><span className="sep">/</span>
        <span>Workflows</span><span className="sep">/</span>
        <span className="current">{workflowName ?? 'Loading…'}</span>
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
          title="Return to the live workflow"
        >
          <Icon name="edit" size={13} />Back to design
        </button>
      )}

      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 6px' }} />
      <div className="theme-toggle">
        <button
          className={theme === 'light' ? 'active' : ''}
          onClick={() => onThemeChange('light')}
          title="Light"
        >
          <Icon name="sun" size={12} />
        </button>
        <button
          className={theme === 'dark' ? 'active' : ''}
          onClick={() => onThemeChange('dark')}
          title="Dark"
        >
          <Icon name="moon" size={12} />
        </button>
      </div>

      {view === 'run' && onRerun && (
        <button className="btn sm" onClick={onRerun} title="Start a new run from this saved snapshot">
          <Icon name="rotate" size={11} />Run again
        </button>
      )}
      {view === 'edit' && (
        <button className="btn sm primary" onClick={onNewRun}>
          <Icon name="play-circle" size={12} />Start run
        </button>
      )}
    </div>
  );
}
