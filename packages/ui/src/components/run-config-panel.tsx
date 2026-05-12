import type { Variable } from '../types';
import { Icon } from './icon';

interface RunConfigPanelProps {
  workflowName: string;
  variables: Variable[];
  values: Record<string, string>;
  setValue: (name: string, value: string) => void;
  onCancel: () => void;
  onStart: () => void;
  busy?: boolean;
}

export function RunConfigPanel({
  workflowName,
  variables,
  values,
  setValue,
  onCancel,
  onStart,
  busy,
}: RunConfigPanelProps) {
  const missingVariables = variables.filter((v) => (values[v.name] ?? v.defaultValue ?? '').trim() === '');
  const canStart = !busy && missingVariables.length === 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canStart) onStart();
    }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="run-modal-overlay" onMouseDown={onCancel}>
      <div className="run-modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="run-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label"><Icon name="play-circle" size={11} /> Start run</div>
            <h2>{workflowName}</h2>
          </div>
          <button className="close" onClick={onCancel} title="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="run-modal-body">
          {variables.length > 0 && (
            <>
              <div className="section-title">
                Run inputs
                <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {variables.length}
                </span>
              </div>
              <div className="run-var-list">
                {variables.map((v, index) => {
                  const effective = values[v.name] ?? v.defaultValue ?? '';
                  const isDefault = effective === (v.defaultValue ?? '');
                  return (
                    <div key={v.name} className="run-var-row">
                      <label htmlFor={`run-var-${index}`}>{v.name}</label>
                      {(values[v.name] ?? v.defaultValue ?? '').trim() === '' && (
                        <span className="run-var-required">Required</span>
                      )}
                      <div className="run-var-control">
                        <input
                          id={`run-var-${index}`}
                          className="input"
                          value={effective}
                          onChange={(e) => setValue(v.name, e.target.value)}
                          autoFocus={index === 0}
                        />
                        {!isDefault && (
                          <button
                            className="btn sm ghost"
                            title="Reset to default"
                            onClick={() => setValue(v.name, v.defaultValue ?? '')}
                          >
                            <Icon name="rotate" size={10} />
                          </button>
                        )}
                      </div>
                      {v.description && <div className="hint">{v.description}</div>}
                      {isDefault && v.defaultValue && <div className="hint mono">default: {v.defaultValue}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {variables.length === 0 && (
            <div className="run-confirm-only">
              <Icon name="play-circle" size={18} />
              <span>No run inputs for this workflow.</span>
            </div>
          )}
        </div>

        <div className="run-modal-actions">
          <button className="btn sm" onClick={onCancel}>Cancel</button>
          <button
            className="btn sm primary"
            onClick={onStart}
            title="Start run (Ctrl+Enter)"
            disabled={!canStart}
          >
            <Icon name="play-circle" size={12} />
            {busy ? 'Starting...' : 'Start run'}
          </button>
        </div>
      </div>
    </div>
  );
}
