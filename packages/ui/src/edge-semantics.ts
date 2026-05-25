import type { Edge, WorkflowNode } from './types';

export function resolveTransferSource(
  edge: Edge,
  nodes: WorkflowNode[],
  edges: Edge[],
  visitedGateIds = new Set<string>(),
): WorkflowNode | undefined {
  const source = nodes.find((node) => node.id === edge.from);
  if (source?.kind !== 'gate') return source;
  if (visitedGateIds.has(source.id)) return undefined;
  visitedGateIds.add(source.id);
  const incoming = edges.find((candidate) =>
    !candidate.loopback
    && candidate.to === source.id
    && nodes.find((node) => node.id === candidate.from)?.kind !== 'input');
  return incoming ? resolveTransferSource(incoming, nodes, edges, visitedGateIds) : undefined;
}

export function isSameSessionContentEdge(edge: Edge, nodes: WorkflowNode[], edges: Edge[]): boolean {
  const source = resolveTransferSource(edge, nodes, edges);
  const target = nodes.find((node) => node.id === edge.to);
  return source?.kind === 'step'
    && target?.kind === 'step'
    && Boolean(source.sessionId)
    && source.sessionId === target.sessionId;
}

export function normalizeTransferConfiguration(edges: Edge[], nodes: WorkflowNode[]): Edge[] {
  return edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.from);
    const target = nodes.find((node) => node.id === edge.to);
    const controlOnly = source?.kind === 'input'
      || source?.kind === 'end'
      || target?.kind === 'input'
      || target?.kind === 'end'
      || target?.kind === 'gate';
    if (!controlOnly && !isSameSessionContentEdge(edge, nodes, edges)) return edge;
    if (!edge.transmit && !edge.outputTag && !edge.handoffPrompt) return edge;
    const { transmit: _transmit, outputTag: _outputTag, handoffPrompt: _handoffPrompt, ...rest } = edge;
    return rest;
  });
}

export function wouldCreateExecutedCycle(candidate: Pick<Edge, 'from' | 'to' | 'loopback'>, edges: Edge[]): boolean {
  if (candidate.loopback) return false;
  const downstreamBySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.loopback) continue;
    const downstream = downstreamBySource.get(edge.from) ?? [];
    downstream.push(edge.to);
    downstreamBySource.set(edge.from, downstream);
  }
  const pending = [candidate.to];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === candidate.from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(downstreamBySource.get(current) ?? []));
  }
  return false;
}

export function closesGateControlledCycle(candidate: Pick<Edge, 'from' | 'to'>, edges: Edge[], nodes: WorkflowNode[]): boolean {
  const gateIds = new Set(nodes.filter((node) => node.kind === 'gate').map((node) => node.id));
  const downstreamBySource = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (edge.loopback) continue;
    downstreamBySource.set(edge.from, [...(downstreamBySource.get(edge.from) ?? []), edge]);
  }
  const pending: Array<{ nodeId: string; crossedGate: boolean }> = [{ nodeId: candidate.to, crossedGate: false }];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    const key = `${current.nodeId}:${current.crossedGate}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.nodeId === candidate.from && current.crossedGate) return true;
    for (const edge of downstreamBySource.get(current.nodeId) ?? []) {
      pending.push({
        nodeId: edge.to,
        crossedGate: current.crossedGate || (gateIds.has(edge.from) && Boolean(edge.branch)),
      });
    }
  }
  return false;
}
