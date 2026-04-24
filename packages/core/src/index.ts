export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export type EdgeType = 'control_flow' | 'data_flow' | 'review_loop';

export type NodeType =
  | 'ticket'
  | 'interview'
  | 'plan'
  | 'code_draft'
  | 'implementation_reviewer'
  | 'repair'
  | 'final_patch'
  | 'visual_decomposer'
  | 'visual_verifier';

export interface Ticket {
  id: string;
  title: string;
  description: string;
}

export interface SpecflowProject {
  name: string;
  phase: 'phase-0';
  rootPath: string;
}

export interface WorkflowArtifact {
  id: string;
  name: string;
  uri?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  status: NodeStatus;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export interface WorkflowRun {
  id: string;
  projectName: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  artifacts: WorkflowArtifact[];
}

export interface ReviewResult {
  approved: boolean;
  findings: string[];
}
