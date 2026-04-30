export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "reviewing"
  | "failed"
  | "completed";

export type EdgeType = "control_flow" | "data_flow" | "review_loop" | "control_scope";

export type NodeType =
  | "ticket"
  | "spec_context"
  | "interview"
  | "plan"
  | "code_draft"
  | "workflow_director"
  | "implementation_reviewer"
  | "repair"
  | "final_patch"
  | "visual_decomposer"
  | "visual_verifier";

export type WorkflowNodeRole =
  | "input"
  | "context"
  | "worker"
  | "reviewer"
  | "verifier"
  | "director"
  | "output";

export type WorkflowControlDecisionKind =
  | "session"
  | "routing"
  | "review"
  | "verification";

export type NodeSessionMode = "none" | "shared" | "fresh" | "ai_decides";

export interface NodeSessionPolicy {
  mode: NodeSessionMode;
  groupId?: string;
  label?: string;
  controllerNodeId?: string;
  newSessionOnLoop?: boolean;
}

export interface NodeControlScope {
  managedNodeIds: string[];
  decisionKinds: WorkflowControlDecisionKind[];
}

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
  | "control-decision"
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

export interface AgentCliConfig {
  cli: string;
  args: string[];
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  status: NodeStatus;
  description?: string;
  role?: WorkflowNodeRole;
  agentCli?: AgentCliConfig;
  session?: NodeSessionPolicy;
  control?: NodeControlScope;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}

export interface WorkflowSessionGroup {
  id: string;
  label: string;
  description?: string;
  controllerNodeId?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version?: string;
  description?: string;
  entryNodeId?: string;
  sessionGroups?: WorkflowSessionGroup[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type WorkflowDefinitionSource = "repository" | "builtin";

export interface WorkflowDefinitionRef {
  id: string;
  name: string;
  source: WorkflowDefinitionSource;
  version?: string;
  path?: string;
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

export type WorkflowSessionStatus = "open" | "closed";

export interface WorkflowSession {
  id: string;
  runId: string;
  groupId: string;
  label: string;
  status: WorkflowSessionStatus;
  agentCli: AgentCliConfig;
  controlledByNodeId?: string;
  nodeIds: string[];
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NodeSessionDecision {
  targetNodeId: string;
  sessionGroupId: string;
  openNewSession: boolean;
  reason: string;
}

export interface WorkflowControlDecision {
  id: string;
  runId: string;
  controllerNodeId: string;
  kind: WorkflowControlDecisionKind;
  targetNodeIds: string[];
  summary: string;
  sessionDecisions?: NodeSessionDecision[];
  createdAt: string;
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
  sessionId?: string;
  sessionIds: string[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  workflowDefinition: WorkflowDefinitionRef;
  ticket: Ticket;
  status: WorkflowRunStatus;
  sessionGroups: WorkflowSessionGroup[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeExecutions: NodeExecutionState[];
  sessions: WorkflowSession[];
  controlDecisions: WorkflowControlDecision[];
  artifacts: WorkflowArtifact[];
  reviews: ReviewResult[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  finalArtifactId?: string;
  maxRepairAttempts: number;
}
