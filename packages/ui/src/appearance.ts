import type { Branch, Edge, Session } from './types';

const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;
const FALLBACK_AGENT_COLORS = [
  'oklch(0.62 0.13 230)',
  'oklch(0.62 0.13 145)',
  'oklch(0.68 0.13 80)',
  'oklch(0.64 0.13 310)',
];

export function isSymbolKey(value: string): boolean {
  return SYMBOL_KEY.test(value);
}

export function nextSymbolKey(prefix: string, used: Iterable<string>): string {
  const existing = new Set(used);
  if (!existing.has(prefix)) return prefix;
  let suffix = 2;
  while (existing.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

export function edgeKey(edge: Pick<Edge, 'from' | 'to' | 'branch'>): string {
  return `edge:${edge.from}:${edge.branch ?? ''}->${edge.to}`;
}

export function sessionAccent(session: Pick<Session, 'agentServerId' | 'agent'>): string {
  const id = session.agentServerId ?? session.agent ?? 'unconfigured';
  if (id === 'claude-acp' || id === 'claude-code') return '#d97757';
  if (id === 'codex-acp' || id === 'codex') return '#ffffff';
  return FALLBACK_AGENT_COLORS[stableHash(id) % FALLBACK_AGENT_COLORS.length]!;
}

export function branchAccent(branch: Pick<Branch, 'id' | 'label'>): string {
  const semantic = `${branch.id} ${branch.label}`.toLowerCase();
  if (semantic.includes('pass') || semantic.includes('success') || semantic.includes('approve')) {
    return 'oklch(0.62 0.11 145)';
  }
  if (semantic.includes('fail') || semantic.includes('reject') || semantic.includes('error')) {
    return 'var(--err)';
  }
  if (semantic.includes('rework') || semantic.includes('retry') || semantic.includes('fix')) {
    return 'oklch(0.68 0.13 80)';
  }
  if (semantic.includes('replan')) return 'oklch(0.60 0.13 230)';
  return 'var(--ink-3)';
}

function stableHash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}
