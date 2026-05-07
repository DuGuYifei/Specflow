import type { AgentNode, AnyWorkflowNode } from "./graph/node";
import type { Workflow } from "./workflow";

export function assertValidWorkflowNode(workflow: Workflow, node: AnyWorkflowNode): void {
  if (node.kind !== "agent") {
    return;
  }

  assertValidAgentNodeSession(workflow, node);
}

export function assertValidAgentNodeSession(workflow: Workflow, node: AgentNode): void {
  const agent = workflow.agents.find((candidate) => candidate.id === node.agentId);
  if (!agent) {
    throw new Error(`Agent node "${node.id}" references missing agent "${node.agentId}".`);
  }

  const session = workflow.sessions.find((candidate) => candidate.id === node.sessionId);
  if (!session) {
    throw new Error(`Agent node "${node.id}" references missing session "${node.sessionId}".`);
  }

  if (session.agentId !== node.agentId) {
    throw new Error(
      `Agent node "${node.id}" session "${node.sessionId}" belongs to agent "${session.agentId}", not "${node.agentId}".`,
    );
  }
}
