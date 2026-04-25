export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "reviewing"
  | "failed"
  | "completed";

export type EdgeType = "control_flow" | "data_flow" | "review_loop";

export type NodeType =
  | "ticket"
  | "interview"
  | "plan"
  | "code_draft"
  | "implementation_reviewer"
  | "repair"
  | "final_patch"
  | "visual_decomposer"
  | "visual_verifier";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  source?: string;
}

export interface SpecflowProject {
  name: string;
  category: "Continuous Coding";
  status: "local-foundation" | "local-loop";
  repositoryRoot: string;
}

export interface WorkflowArtifact {
  id: string;
  nodeId: string;
  kind: "spec" | "plan" | "patch" | "review" | "context";
  title: string;
  content: string;
}

export interface ReviewResult {
  reviewerNodeId: string;
  approved: boolean;
  summary: string;
  requiredChanges: string[];
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  status: NodeStatus;
  description?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}

export interface WorkflowRun {
  id: string;
  ticket: Ticket;
  status: NodeStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  artifacts: WorkflowArtifact[];
  reviews: ReviewResult[];
  createdAt: string;
  updatedAt: string;
}
