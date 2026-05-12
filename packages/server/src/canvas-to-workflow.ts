import type {
  AgentNode,
  GateNode,
  PassthroughEdge,
  TaggedOutputEdge,
  Workflow,
} from "@specflow/workflow";
import type { AgentFlowDoc, AgentFlowStepNode, CanvasEdge, CanvasSession } from "./canvas-doc";

export const MOCK_AGENT_ID = "agent-mock";

function agentIdForProvider(provider: CanvasSession["agent"]): string {
  return `agent-${provider}`;
}

export function canvasToWorkflow(doc: AgentFlowDoc): Workflow {
  const endNodeIds = new Set(
    doc.nodes.filter((n) => n.kind === "end").map((n) => n.id),
  );

  const inputNodeIds = new Set(
    doc.nodes.filter((n) => n.kind === "input").map((n) => n.id),
  );

  const loopbackEdgeIds = new Set(
    doc.edges.filter((e) => e.loopback).map((e) => e.id),
  );

  const providers = new Set<CanvasSession["agent"]>(doc.sessions.map((s) => s.agent));
  providers.add("mock");

  const agents: Workflow["agents"] = [...providers].map((provider) => ({
    id: agentIdForProvider(provider),
    kind: "provider",
    name: provider === "claude-code" ? "Claude" : provider === "codex" ? "Codex" : "Mock",
    provider,
  }));

  const sessions: Workflow["sessions"] = doc.sessions.map((s) => ({
    id: s.id,
    name: s.name,
    agentId: agentIdForProvider(s.agent),
    createdAt: new Date().toISOString(),
  }));

  const nodes: Workflow["nodes"] = doc.nodes
    .filter((n) => n.kind !== "end" && n.kind !== "input")
    .map((n) => {
      if (n.kind === "step") {
        return buildAgentNode(n, doc);
      }
      if (n.kind === "gate") {
        return {
          id: n.id,
          kind: "gate",
          behavior: "functional",
          title: n.title,
          description: n.gateDesc,
          promptTemplate: { template: n.gateDesc ?? "" },
          decisionCriteria: n.gateDesc ?? "",
          inputVariable: "specflow_input",
          branches: n.branches.map((b) => ({ id: b.id, label: b.label, color: b.color })),
        } satisfies GateNode;
      }
      throw new Error(`Unknown node kind: ${(n as { kind: string }).kind}`);
    });

  const edges: Workflow["edges"] = doc.edges
    .filter((e) => !loopbackEdgeIds.has(e.id))
    .filter((e) => !endNodeIds.has(e.to) && !endNodeIds.has(e.from))
    .filter((e) => !inputNodeIds.has(e.from))   // variable injection edges are not workflow edges
    .map((e) => buildEdge(e, doc));

  return {
    id: doc.id,
    name: doc.name,
    agents,
    sessions,
    nodes,
    edges,
  };
}

function buildAgentNode(n: AgentFlowStepNode, doc: AgentFlowDoc): AgentNode {
  const session = doc.sessions.find((s) => s.id === n.sessionId);
  return {
    id: n.id,
    kind: "agent",
    title: n.title,
    description: n.desc,
    promptTemplate: { template: n.desc ?? "" },
    agentId: session ? agentIdForProvider(session.agent) : MOCK_AGENT_ID,
    sessionId: n.sessionId ?? "",
    updateSpecDoc: n.updateDoc,
    attachments: (n.attachments ?? []).map((a) => ({
      id: crypto.randomUUID(),
      kind: "file",
      path: a.label,
      label: a.label,
    })),
    relatedResources: (n.paths ?? []).map((p) => ({
      id: crypto.randomUUID(),
      kind: "file",
      path: p,
    })),
  };
}

function buildEdge(e: CanvasEdge, doc: AgentFlowDoc): PassthroughEdge | TaggedOutputEdge {
  // Gate-branch edge or same-session edge → passthrough
  if (e.branch || e.sameSession) {
    return {
      id: e.id,
      kind: "passthrough",
      sourceNodeId: e.from,
      targetNodeId: e.to,
      sourcePortId: e.branch,
    } satisfies PassthroughEdge;
  }

  // Cross-session tagged edge
  const toNode = doc.nodes.find((n) => n.id === e.to);
  const toSessionId = toNode && toNode.kind !== "end" && toNode.kind !== "input" ? toNode.sessionId : undefined;
  const toSession = doc.sessions.find((s) => s.id === toSessionId);

  const tag = e.tag ?? e.id;
  return {
    id: e.id,
    kind: "tagged-output",
    sourceNodeId: e.from,
    targetNodeId: e.to,
    outputTag: {
      identifier: tag,
      xmlTagName: tag,
      promptReference: tag,
    },
    handoff: e.prompt
      ? {
          agentId: toSession ? agentIdForProvider(toSession.agent) : MOCK_AGENT_ID,
          sessionId: toSessionId ?? undefined,
          promptTemplate: { template: e.prompt },
        }
      : undefined,
  } satisfies TaggedOutputEdge;
}
