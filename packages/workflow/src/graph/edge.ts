export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  data: Record<string, unknown>;
}
