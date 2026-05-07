import type { AnyWorkflowEdge } from "./graph/edge";
import type { AnyWorkflowNode } from "./graph/node";
import type { AgentDefinition } from "./schema/agent";
import type { WorkflowSession } from "./schema/session";

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  agents: AgentDefinition[];
  sessions: WorkflowSession[];
  nodes: AnyWorkflowNode[];
  edges: AnyWorkflowEdge[];
}

export function createEmptyWorkflow(name = "Untitled workflow"): Workflow {
  return {
    id: crypto.randomUUID(),
    name,
    agents: [],
    sessions: [],
    nodes: [],
    edges: [],
  };
}
