import { useEffect, useMemo, useState } from 'react';
import type { RunInteraction } from '../api';

type ElicitationContent = Record<string, string | number | boolean | string[]>;

interface InteractionModalProps {
  interaction: RunInteraction;
  onRespond: (interaction: RunInteraction, response: unknown) => void;
}

export function InteractionModal({ interaction, onRespond }: InteractionModalProps) {
  if (interaction.kind === 'permission') {
    return <PermissionModal interaction={interaction} onRespond={onRespond} />;
  }
  return <ElicitationModal interaction={interaction} onRespond={onRespond} />;
}

function PermissionModal({ interaction, onRespond }: InteractionModalProps) {
  const toolCall = asRecord(interaction.toolCall);
  const title = stringValue(toolCall.title) || stringValue(toolCall.name) || 'Permission required';
  const description = stringValue(toolCall.description) || stringValue(toolCall.kind) || 'The agent needs approval before continuing.';
  const status = stringValue(toolCall.status);
  const options = interaction.options ?? [];
  const allowOption = pickAllowOption(options);
  const denyOption = pickDenyOption(options);
  const otherOptions = options.filter((o) => o.optionId !== allowOption?.optionId && o.optionId !== denyOption?.optionId);
  const command = extractCommandSummary(toolCall);
  const justification = stringValue((asRecord(toolCall.rawInput) ?? {}).justification)
    || stringValue(toolCall.justification);
  const remaining = useTimeoutCountdown(interaction.timeoutAt);

  return (
    <div className="run-modal-overlay">
      <div className="run-modal interaction-modal">
        <div className="run-modal-head">
          <div style={{ flex: 1 }}>
            <div className="label">
              Agent permission
              {interaction.agentServerId && <span style={{ marginLeft: 6, color: 'var(--ink-3)' }}>· {interaction.agentServerId}</span>}
            </div>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="run-modal-body">
          <p className="interaction-message">{description}</p>
          {command && (
            <pre className="interaction-command" style={{
              margin: '8px 0',
              padding: '8px 10px',
              background: 'var(--code-bg, #1e1e1e)',
              color: 'var(--code-fg, #d4d4d4)',
              borderRadius: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 160,
              overflow: 'auto',
            }}>{command}</pre>
          )}
          {justification && <p className="interaction-muted" style={{ fontStyle: 'italic' }}>{justification}</p>}
          {status && <p className="interaction-muted">Status: {status}</p>}
          {interaction.nodeId && (
            <p className="interaction-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
              node {interaction.nodeId}
              {interaction.acpSessionId && <> · session {interaction.acpSessionId.slice(0, 8)}…</>}
            </p>
          )}
          {remaining && (
            <p className="interaction-muted" style={{ color: 'var(--accent, #f0a020)' }}>
              Auto-{interaction.timeoutAction ?? 'accept'} in {remaining}
            </p>
          )}
          {otherOptions.length > 0 && (
            <div className="interaction-option-list">
              {otherOptions.map((option) => (
                <button
                  key={option.optionId}
                  className="btn"
                  onClick={() => onRespond(interaction, { outcome: 'selected', optionId: option.optionId })}
                >
                  {option.name || option.optionId}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="run-modal-actions">
          {denyOption && (
            <button
              className="btn"
              onClick={() => onRespond(interaction, { outcome: 'selected', optionId: denyOption.optionId })}
            >
              {denyOption.name || 'Deny'}
            </button>
          )}
          {allowOption && (
            <button
              className="btn primary"
              onClick={() => onRespond(interaction, { outcome: 'selected', optionId: allowOption.optionId })}
            >
              {allowOption.name || 'Allow'}
            </button>
          )}
          {!allowOption && !denyOption && (
            <button className="btn" onClick={() => onRespond(interaction, { outcome: 'cancelled' })}>Dismiss</button>
          )}
        </div>
      </div>
    </div>
  );
}

const ALLOW_KIND_PRIORITY = ['allow_once', 'allow_always'];
const DENY_KIND_PRIORITY = ['reject_once', 'reject_always'];
const ALLOW_NAME_HINTS = ['allow', 'approve', 'accept', 'yes', 'ok'];
const DENY_NAME_HINTS = ['deny', 'reject', 'decline', 'no'];

function pickAllowOption(options: ReadonlyArray<{ optionId: string; name?: string; kind?: string }>) {
  for (const k of ALLOW_KIND_PRIORITY) {
    const found = options.find((o) => o.kind === k);
    if (found) return found;
  }
  for (const h of ALLOW_NAME_HINTS) {
    const found = options.find((o) => (o.name ?? '').toLowerCase().includes(h));
    if (found) return found;
  }
  return undefined;
}

function pickDenyOption(options: ReadonlyArray<{ optionId: string; name?: string; kind?: string }>) {
  for (const k of DENY_KIND_PRIORITY) {
    const found = options.find((o) => o.kind === k);
    if (found) return found;
  }
  for (const h of DENY_NAME_HINTS) {
    const found = options.find((o) => (o.name ?? '').toLowerCase().includes(h));
    if (found) return found;
  }
  return undefined;
}

function extractCommandSummary(toolCall: Record<string, unknown>): string {
  const rawInput = asRecord(toolCall.rawInput);
  if (typeof rawInput.cmd === 'string') return rawInput.cmd;
  if (typeof rawInput.command === 'string') return rawInput.command;
  if (Array.isArray(rawInput.command)) return (rawInput.command as unknown[]).map(String).join(' ');
  const content = (toolCall.content ?? []) as unknown[];
  if (Array.isArray(content)) {
    for (const entry of content) {
      const text = stringValue((entry as Record<string, unknown>)?.text);
      if (text) return text;
    }
  }
  return '';
}

function useTimeoutCountdown(timeoutAt?: string): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timeoutAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timeoutAt]);
  if (!timeoutAt) return undefined;
  const remainingMs = new Date(timeoutAt).getTime() - now;
  if (remainingMs <= 0) return '0s';
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function ElicitationModal({ interaction, onRespond }: InteractionModalProps) {
  const request = asRecord(interaction.request);
  const mode = stringValue(request.mode);
  const message = stringValue(request.message) || 'The agent is asking for more information.';

  if (mode === 'url') {
    const url = stringValue(request.url);
    return (
      <div className="run-modal-overlay">
        <div className="run-modal interaction-modal">
          <div className="run-modal-head">
            <div style={{ flex: 1 }}>
              <div className="label">Agent request</div>
              <h2>Open external step</h2>
            </div>
          </div>
          <div className="run-modal-body">
            <p className="interaction-message">{message}</p>
            {url && <a className="interaction-url" href={url} target="_blank" rel="noreferrer">{url}</a>}
          </div>
          <div className="run-modal-actions">
            <button className="btn" onClick={() => onRespond(interaction, { action: 'decline' })}>Decline</button>
            <button className="btn primary" onClick={() => onRespond(interaction, { action: 'accept', content: {} })}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return <FormElicitationModal interaction={interaction} message={message} onRespond={onRespond} />;
}

function FormElicitationModal({
  interaction,
  message,
  onRespond,
}: InteractionModalProps & { message: string }) {
  const request = asRecord(interaction.request);
  const schema = asRecord(request.requestedSchema);
  const properties = asRecord(schema.properties);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const fields = useMemo(() => Object.entries(properties), [properties]);
  const [values, setValues] = useState<ElicitationContent>(() => {
    const initial: ElicitationContent = {};
    for (const [name, property] of fields) {
      const prop = asRecord(property);
      if ('default' in prop && prop.default != null) {
        initial[name] = normalizeDefaultValue(prop.default);
      } else if (prop.type === 'boolean') {
        initial[name] = false;
      } else if (prop.type === 'array') {
        initial[name] = [];
      } else {
        initial[name] = '';
      }
    }
    return initial;
  });

  const setValue = (name: string, value: string | number | boolean | string[]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="run-modal-overlay">
      <div className="run-modal interaction-modal">
        <div className="run-modal-head">
          <div style={{ flex: 1 }}>
            <div className="label">Agent request</div>
            <h2>{stringValue(schema.title) || 'Provide details'}</h2>
          </div>
        </div>
        <div className="run-modal-body">
          <p className="interaction-message">{message}</p>
          <div className="run-var-list">
            {fields.map(([name, property]) => (
              <ElicitationField
                key={name}
                name={name}
                property={asRecord(property)}
                required={required.has(name)}
                value={values[name]}
                setValue={setValue}
              />
            ))}
          </div>
        </div>
        <div className="run-modal-actions">
          <button className="btn" onClick={() => onRespond(interaction, { action: 'cancel' })}>Cancel</button>
          <button className="btn" onClick={() => onRespond(interaction, { action: 'decline' })}>Decline</button>
          <button className="btn primary" onClick={() => onRespond(interaction, { action: 'accept', content: values })}>Submit</button>
        </div>
      </div>
    </div>
  );
}

function ElicitationField({
  name,
  property,
  required,
  value,
  setValue,
}: {
  name: string;
  property: Record<string, unknown>;
  required: boolean;
  value: string | number | boolean | string[] | undefined;
  setValue: (name: string, value: string | number | boolean | string[]) => void;
}) {
  const title = stringValue(property.title) || name;
  const description = stringValue(property.description);
  const type = stringValue(property.type);
  const enumValues = Array.isArray(property.enum) ? property.enum.map(String) : undefined;
  const oneOf = Array.isArray(property.oneOf) ? property.oneOf.map(asRecord) : undefined;

  return (
    <div className="run-var-row">
      <label>
        {title}
        {required && <span className="run-var-required">required</span>}
      </label>
      {renderFieldControl({ name, type, property, value, enumValues, oneOf, setValue })}
      {description && <div className="hint">{description}</div>}
    </div>
  );
}

function renderFieldControl(input: {
  name: string;
  type: string;
  property: Record<string, unknown>;
  value: string | number | boolean | string[] | undefined;
  enumValues?: string[];
  oneOf?: Record<string, unknown>[];
  setValue: (name: string, value: string | number | boolean | string[]) => void;
}) {
  if (input.type === 'boolean') {
    return (
      <label className="interaction-checkbox">
        <input
          type="checkbox"
          checked={Boolean(input.value)}
          onChange={(e) => input.setValue(input.name, e.currentTarget.checked)}
        />
        <span>Enabled</span>
      </label>
    );
  }

  const enumOptions = input.oneOf?.map((option) => ({
    value: String(option.const ?? ''),
    label: stringValue(option.title) || String(option.const ?? ''),
  })) ?? input.enumValues?.map((value) => ({ value, label: value }));

  if (enumOptions?.length) {
    return (
      <select
        className="select-box"
        value={String(input.value ?? '')}
        onChange={(e) => input.setValue(input.name, e.currentTarget.value)}
      >
        <option value="">Choose...</option>
        {enumOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  if (input.type === 'number' || input.type === 'integer') {
    return (
      <input
        className="input"
        type="number"
        value={typeof input.value === 'number' ? input.value : ''}
        onChange={(e) => input.setValue(input.name, Number(e.currentTarget.value))}
      />
    );
  }

  return (
    <input
      className="input"
      type="text"
      value={String(input.value ?? '')}
      onChange={(e) => input.setValue(input.name, e.currentTarget.value)}
    />
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDefaultValue(value: unknown): string | number | boolean | string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(String);
  return '';
}
