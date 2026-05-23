import type {
  AgentNode,
  GateNode,
  PassthroughEdge,
  TaggedOutputEdge,
  Workflow,
} from "@specflow/workflow";
import { uuidv7 } from "@specflow/shared";
import type { AgentFlowDoc, AgentFlowStepNode, CanvasEdge, CanvasSession } from "./canvas-doc";

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
  const endNodeIds = new Set(
    doc.nodes.filter((n) => n.kind === "end").map((n) => n.id),
  );

  const inputNodeIds = new Set(
    doc.nodes.filter((n) => n.kind === "input").map((n) => n.id),
  );

  const loopbackEdgeIds = new Set(
    doc.edges.filter((e) => e.loopback).map((e) => e.id),
  );

  const agentServerIds = new Set<string>(doc.sessions.map(agentServerIdForSession));

  const agents: Workflow["agents"] = [...agentServerIds].map((agentServerId) => ({
    id: agentIdForServer(agentServerId),
    kind: "external",
    name: agentServerId,
    agentServerId,
  }));

  const sessions: Workflow["sessions"] = doc.sessions.map((s) => ({
    id: s.id,
    name: s.name,
    agentId: agentIdForServer(agentServerIdForSession(s)),
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
          branches: n.branches.map((b) => ({ id: b.id, label: b.label })),
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
    agentId: session ? agentIdForServer(agentServerIdForSession(session)) : agentIdForServer(DEFAULT_AGENT_SERVER_ID),
    sessionId: n.sessionId ?? "",
    updateSpecDoc: n.updateDoc,
    attachments: (n.attachments ?? []).map((a) => ({
      id: uuidv7(),
      kind: "file",
      path: a.label,
      label: a.label,
    })),
    relatedResources: (n.paths ?? []).map((p) => ({
      id: uuidv7(),
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
          agentId: toSession ? agentIdForServer(agentServerIdForSession(toSession)) : agentIdForServer(DEFAULT_AGENT_SERVER_ID),
          sessionId: toSessionId ?? undefined,
          promptTemplate: { template: e.prompt },
        }
      : undefined,
  } satisfies TaggedOutputEdge;
}
