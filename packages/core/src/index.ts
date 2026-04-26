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
  | "spec_context"
  | "interview"
  | "plan"
  | "code_draft"
  | "implementation_reviewer"
  | "repair"
  | "final_patch"
  | "visual_decomposer"
  | "visual_verifier";

export type TicketSource = "inline" | "file";

export interface Ticket {
  id: string;
  body: string;
  source: TicketSource;
  createdAt: string;
  title?: string;
  sourcePath?: string;
  description?: string;
}

export interface SpecflowProject {
  name: string;
  category: "Continuous Coding";
  status: "local-foundation" | "local-loop";
  repositoryRoot: string;
}

export type WorkflowArtifactKind =
  | "ticket"
  | "spec-context"
  | "plan"
  | "code-draft"
  | "review-result"
  | "repair"
  | "final-patch"
  | "spec"
  | "patch"
  | "review"
  | "context";

export type WorkflowArtifactContentType =
  | "application/json"
  | "text/markdown"
  | "text/plain";

export interface WorkflowArtifact {
  id: string;
  runId: string;
  nodeId: string;
  kind: WorkflowArtifactKind;
  title: string;
  content: string;
  contentType: WorkflowArtifactContentType;
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
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

export type WorkflowRunStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type NodeExecutionMode = "system" | "agent";

export interface AgentCliConfig {
  cli: string;
  args: string[];
}

export interface NodeExecutionState {
  nodeId: string;
  nodeType: NodeType;
  label: string;
  status: NodeExecutionStatus;
  executionMode: NodeExecutionMode;
  agentCli?: AgentCliConfig;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  ticket: Ticket;
  status: WorkflowRunStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeExecutions: NodeExecutionState[];
  artifacts: WorkflowArtifact[];
  reviews: ReviewResult[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  finalArtifactId?: string;
  maxRepairAttempts: number;
}
