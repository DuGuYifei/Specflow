import type { Theme } from '../types';
import { Icon } from './icon';

interface TopBarProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  runLabel?: string;
}

export function TopBar({ theme, onThemeChange, runLabel }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span>specflow</span>
      </div>
      <div className="crumbs">
        <span>Acme</span><span className="sep">/</span>
        <span>Workflows</span><span className="sep">/</span>
        <span className="current">Frontend ticket flow</span>
        {runLabel && (
          <>
            <span className="sep">/</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{runLabel}</span>
          </>
        )}
      </div>
      <div className="topbar-spacer" />
      <button className="topbar-tab active"><Icon name="play-circle" size={13} />Run view</button>
      <button className="topbar-tab"><Icon name="edit" size={13} />Edit workflow</button>
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
      <button className="btn sm"><Icon name="rotate" size={11} />Re-run</button>
      <button className="btn sm primary"><Icon name="play" size={10} />New run</button>
    </div>
  );
}
