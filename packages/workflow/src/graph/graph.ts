import type { WorkflowEdge } from "./edge";
import type { WorkflowNode } from "./node";

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function createEmptyGraph(): WorkflowGraph {
  return {
    nodes: [],
    edges: [],
  };
}
