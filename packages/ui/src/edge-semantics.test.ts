import type { Edge, WorkflowNode } from './types';
import { normalizeTransferConfiguration, resolveTransferSource, wouldCreateExecutedCycle } from './edge-semantics';

declare function describe(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare const expect: (value: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
};

describe('edge semantics', () => {
  test('clears explicit transfer when a session edit makes an edge same-session', () => {
    const edges: Edge[] = [{
      id: 'edge',
      from: 'source',
      to: 'target',
      transmit: true,
      outputTag: 'result',
      handoffPrompt: 'format',
    }];
    expect(normalizeTransferConfiguration(edges, [
      step('source', 'shared'),
      step('target', 'shared'),
    ])).toEqual([{ id: 'edge', from: 'source', to: 'target' }]);
  });

  test('resolves the content-producing step through a gate branch', () => {
    const nodes: WorkflowNode[] = [
      step('source', 'source-session'),
      { kind: 'gate', id: 'gate', num: 'G1', x: 0, y: 0, w: 200, title: 'Gate', decisionCriteria: '', branches: [{ id: 'pass', label: 'pass' }] },
      step('target', 'target-session'),
    ];
    const incoming: Edge = { id: 'in', from: 'source', to: 'gate' };
    const outgoing: Edge = { id: 'out', from: 'gate', to: 'target', branch: 'pass' };
    expect(resolveTransferSource(outgoing, nodes, [incoming, outgoing])?.id).toBe('source');
  });

  test('prevents executed cycles while allowing display-only loopbacks', () => {
    const edges: Edge[] = [{ id: 'forward', from: 'source', to: 'target' }];
    expect(wouldCreateExecutedCycle({ from: 'target', to: 'source' }, edges)).toBe(true);
    expect(wouldCreateExecutedCycle({ from: 'target', to: 'source', loopback: true }, edges)).toBe(false);
  });
});

function step(id: string, sessionId: string): Extract<WorkflowNode, { kind: 'step' }> {
  return { kind: 'step', id, num: id, x: 0, y: 0, w: 200, title: id, prompt: '', sessionId };
}
