import type {
  AgentNode,
  GateNode,
  GateInputEdge,
  TaggedOutputEdge,
  TriggerEdge,
  Workflow,
} from "@specflow/workflow";
import { uuidv7 } from "@specflow/shared";
import type {
  AgentFlowDoc,
  AgentFlowStepNode,
  CanvasEdge,
  CanvasSession,
} from "./canvas-doc";
import { contentSourceForEdge, findAgentFlowNode, hasTransferProperties } from "./canvas-edge-semantics";

export const DEFAULT_AGENT_SERVER_ID = "unconfigured";

function agentServerIdForSession(session: CanvasSession): string {
  return session.agentServerId ?? legacyAgentServerId(session.agent);
}

function legacyAgentServerId(agent: string | undefined): string {
  if (agent === "claude-code") return "claude-acp";
  if (agent === "codex") return "codex-acp";
  return agent ?? DEFAULT_AGENT_SERVER_ID;
}

function agentIdForServer(agentServerId: string): string {
  return `agent-server-${agentServerId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function canvasToWorkflow(doc: AgentFlowDoc): Workflow {
  const endNodeIds = new Set(doc.nodes.filter((node) => node.kind === "end").map((node) => node.id));
  const inputNodeIds = new Set(doc.nodes.filter((node) => node.kind === "input").map((node) => node.id));
  const loopbackEdgeIds = new Set(doc.edges.filter((edge) => edge.loopback).map((edge) => edge.id));
  const agentServerIds = new Set<string>(doc.sessions.map(agentServerIdForSession));

  const agents: Workflow["agents"] = [...agentServerIds].map((agentServerId) => ({
    id: agentIdForServer(agentServerId),
    kind: "external",
    name: agentServerId,
    agentServerId,
  }));

  const sessions: Workflow["sessions"] = doc.sessions.map((session) => ({
    id: session.id,
    name: session.name,
    agentId: agentIdForServer(agentServerIdForSession(session)),
    createdAt: new Date().toISOString(),
  }));

  const nodes: Workflow["nodes"] = doc.nodes
    .filter((node) => node.kind !== "end" && node.kind !== "input")
    .map((node) => {
      if (node.kind === "step") return buildAgentNode(node, doc);
      return {
        id: node.id,
        kind: "gate",
        behavior: "functional",
        title: node.title,
        promptTemplate: { template: node.decisionCriteria },
        decisionCriteria: node.decisionCriteria,
        branches: node.branches.map((branch) => ({
          id: branch.id,
          label: branch.label,
          description: branch.description,
        })),
      } satisfies GateNode;
    });

  const edges: Workflow["edges"] = doc.edges
    .filter((edge) => !loopbackEdgeIds.has(edge.id))
    .filter((edge) => !endNodeIds.has(edge.to) && !endNodeIds.has(edge.from))
    .filter((edge) => !inputNodeIds.has(edge.from))
    .map((edge) => buildEdge(edge, doc));

  return { id: doc.id, name: doc.name, agents, sessions, nodes, edges };
}

function buildAgentNode(node: AgentFlowStepNode, doc: AgentFlowDoc): AgentNode {
  const session = doc.sessions.find((candidate) => candidate.id === node.sessionId);
  return {
    id: node.id,
    kind: "agent",
    title: node.title,
    promptTemplate: { template: node.prompt },
    agentId: session
      ? agentIdForServer(agentServerIdForSession(session))
      : agentIdForServer(DEFAULT_AGENT_SERVER_ID),
    sessionId: node.sessionId ?? "",
    pauseAfterRun: node.pauseAfterRun,
    images: (node.images ?? []).map((image) => ({
      id: uuidv7(),
      kind: "image",
      path: image.path,
      label: image.label,
      mimeType: image.mimeType,
    })),
    relatedResources: (node.paths ?? []).map((path) => ({
      id: uuidv7(),
      kind: "file",
      path,
    })),
  };
}

function buildEdge(edge: CanvasEdge, doc: AgentFlowDoc): TriggerEdge | GateInputEdge | TaggedOutputEdge {
  const source = findAgentFlowNode(doc, edge.from);
  const target = findAgentFlowNode(doc, edge.to);

  if (target.kind === "gate") {
    return {
      id: edge.id,
      kind: "gate-input",
      sourceNodeId: edge.from,
      targetNodeId: edge.to,
    };
  }

  const effectiveSource = contentSourceForEdge(edge, doc);
  if (!effectiveSource) throw new Error(`Gate node "${source.id}" requires one business input edge.`);
  const sourceSessionId = effectiveSource.kind === "step" ? effectiveSource.sessionId : undefined;
  const targetSessionId = target.kind === "step" ? target.sessionId : undefined;
  const sameSession = Boolean(sourceSessionId && sourceSessionId === targetSessionId);

  if (sameSession) {
    if (hasTransferProperties(edge)) {
      throw new Error(`Same-session edge "${edge.id}" cannot declare transmission properties.`);
    }
    return {
      id: edge.id,
      kind: "trigger",
      sourceNodeId: edge.from,
      targetNodeId: edge.to,
      sourcePortId: edge.branch,
    };
  }
  if (edge.transmit !== true) {
    if (edge.outputTag || edge.handoffPrompt) {
      throw new Error(`Edge "${edge.id}" cannot define outputTag or handoffPrompt unless transmit is enabled.`);
    }
    return {
      id: edge.id,
      kind: "trigger",
      sourceNodeId: edge.from,
      targetNodeId: edge.to,
      sourcePortId: edge.branch,
    };
  }

  if (!edge.outputTag) {
    throw new Error(`Transmitting edge "${edge.id}" must define outputTag.`);
  }
  return {
    id: edge.id,
    kind: "tagged-output",
    sourceNodeId: edge.from,
    targetNodeId: edge.to,
    sourcePortId: edge.branch,
    outputTag: {
      identifier: edge.outputTag,
      xmlTagName: edge.outputTag,
      promptReference: `specflow_${edge.outputTag}`,
    },
    handoff: edge.handoffPrompt
      ? { promptTemplate: { template: edge.handoffPrompt } }
      : undefined,
  };
}
