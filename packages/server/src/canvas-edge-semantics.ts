import type { AgentFlowDoc, AgentFlowNode, CanvasEdge } from "./canvas-doc";

export function findAgentFlowNode(doc: AgentFlowDoc, id: string): AgentFlowNode {
  const node = doc.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node "${id}".`);
  return node;
}

/**
 * Resolves the node whose output is carried by an edge. Gate output edges
 * preserve the content origin from the step before the gate.
 */
export function contentSourceForEdge(
  edge: CanvasEdge,
  doc: AgentFlowDoc,
  visitedGateIds = new Set<string>(),
): AgentFlowNode | undefined {
  const source = findAgentFlowNode(doc, edge.from);
  if (source.kind !== "gate") return source;
  if (visitedGateIds.has(source.id)) {
    throw new Error(`Gate chain contains a cycle at node "${source.id}".`);
  }
  visitedGateIds.add(source.id);
  const incoming = doc.edges.find((candidate) =>
    !candidate.loopback
    && candidate.to === source.id
    && findAgentFlowNode(doc, candidate.from).kind !== "input");
  return incoming ? contentSourceForEdge(incoming, doc, visitedGateIds) : undefined;
}

export function hasTransferProperties(edge: CanvasEdge): boolean {
  return edge.transmit === true || Boolean(edge.outputTag) || Boolean(edge.handoffPrompt);
}
