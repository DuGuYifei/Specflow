import type { ReactNode } from 'react';
import { Icon } from './icon';

export interface PanelTab {
  key: string;
  label: string;
  count?: number;
}

interface RightPanelProps {
  label: ReactNode;
  title: ReactNode;
  onClose: () => void;
  tabs?: PanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  children: ReactNode;
}

export function RightPanel({ label, title, onClose, tabs, activeTab, onTabChange, children }: RightPanelProps) {
  return (
    <div className="right">
      <div className="panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">{label}</div>
          <h2>{title}</h2>
        </div>
        <button className="close" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="panel-tabs">
          {tabs.map(({ key, label: tabLabel, count }) => (
            <button
              key={key}
              className={activeTab === key ? 'active' : ''}
              onClick={() => onTabChange?.(key)}
            >
              {tabLabel}
              {count != null && <span className="count">{count}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="panel-body">{children}</div>
    </div>
  );
}
