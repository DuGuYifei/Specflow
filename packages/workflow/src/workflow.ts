import type { WorkflowEdge } from "./graph/edge";
import type { WorkflowNode } from "./graph/node";

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function createEmptyWorkflow(name = "Untitled workflow"): Workflow {
  return {
    id: crypto.randomUUID(),
    name,
    nodes: [],
    edges: [],
  };
}
