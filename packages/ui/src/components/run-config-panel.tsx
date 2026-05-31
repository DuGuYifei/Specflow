import type { Variable } from '../types';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const missingVariables = variables.filter((v) => v.required !== false && (values[v.name] ?? v.defaultValue ?? '').trim() === '');
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
            <div className="label"><Icon name="play-circle" size={11} /> {t('runConfig.startRun')}</div>
            <h2>{workflowName}</h2>
          </div>
          <button className="close" onClick={onCancel} title={t('common.close')}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="run-modal-body">
          {variables.length > 0 && (
            <>
              <div className="section-title">
                {t('runConfig.runInputs')}
                <span style={{ color: 'var(--ink-4)', fontWeight: 400, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {variables.length}
                </span>
              </div>
              <div className="run-var-list">
                {variables.map((v, index) => {
                  const effective = values[v.name] ?? v.defaultValue ?? '';
                  const isRequired = v.required !== false;
                  const isDefault = effective === (v.defaultValue ?? '');
                  return (
                    <div key={v.name} className="run-var-row">
                      <label htmlFor={`run-var-${index}`}>{v.name}</label>
                      {isRequired && (values[v.name] ?? v.defaultValue ?? '').trim() === '' && (
                        <span className="run-var-required">{t('common.required')}</span>
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
                            title={t('runConfig.resetToDefault')}
                            onClick={() => setValue(v.name, v.defaultValue ?? '')}
                          >
                            <Icon name="rotate" size={10} />
                          </button>
                        )}
                      </div>
                      {v.description && <div className="hint">{v.description}</div>}
                      {isDefault && v.defaultValue && <div className="hint mono">{t('runConfig.defaultValue', { value: v.defaultValue })}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {variables.length === 0 && (
            <div className="run-confirm-only">
              <Icon name="play-circle" size={18} />
              <span>{t('runConfig.noInputs')}</span>
            </div>
          )}
        </div>

        <div className="run-modal-actions">
          <button className="btn sm" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            className="btn sm primary"
            onClick={onStart}
            title={t('runConfig.startRunHotkey')}
            disabled={!canStart}
          >
            <Icon name="play-circle" size={12} />
            {busy ? t('runConfig.checkingAgents') : t('runConfig.startRun')}
          </button>
        </div>
      </div>
    </div>
  );
}
