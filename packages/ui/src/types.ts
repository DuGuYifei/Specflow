export type Theme = 'light' | 'dark';

export interface Variable {
  name: string;           // always prefixed: "specflow_branch"
  defaultValue?: string;
  description?: string;
}

export type Density = 'comfortable' | 'compact';
export type RunStatus = 'running' | 'success' | 'error' | 'cancelled' | 'idle' | 'pending';
export type RunState = 'running' | 'paused' | 'success' | 'error' | 'cancelled' | 'pending';
export type RunStateMap = Record<string, RunState>;

export interface Session {
  id: string;
  name: string;
  agentServerId: string;
  agent?: string;
}

export interface Workflow {
  id: string;
  name: string;
  meta: string;
  runs: number;
  active?: boolean;
}

export interface RunSnapshot {
  id: string;
  name: string;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  variables?: Variable[];
}

export interface Run {
  id: string;
  workflowId?: string;
  label: string;
  ticket: string;
  status: RunStatus;
  activeNode?: string;
  pausedNodeId?: string;
  progress?: string;
  time: string;
  duration: string;
  agent: string;
  active?: boolean;
  errorMsg?: string;
  nodeOutputs?: Record<string, string>;
  canvasSnapshot?: RunSnapshot;
  nodeStates?: RunStateMap;
  initialInput?: string;
  variableValues?: Record<string, string>;
}

export interface LogLine {
  chunk: string;
  nodeId?: string;
  stream?: 'stdout' | 'stderr' | 'system';
}

export interface Branch {
  id: string;
  label: string;
  description?: string;
}

export interface StepNode {
  kind: 'step';
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  prompt: string;
  sessionId: string | null;
  pauseAfterRun?: boolean;
  locked?: boolean;
  images?: Array<{ path: string; label?: string; mimeType?: string }>;
  paths?: string[];
}

export interface GateNode {
  kind: 'gate';
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  decisionCriteria: string;
  branches: Branch[];
}

export interface EndNode {
  kind: 'end';
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
}

export interface InputNode {
  kind: 'input';
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  variableName: string;    // stored prefixed: "specflow_component_tree"
  defaultValue?: string;
  description?: string;
  sessionId: null;
}

export type WorkflowNode = StepNode | GateNode | EndNode | InputNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
  transmit?: boolean;
  outputTag?: string;
  handoffPrompt?: string;
  branch?: string;
  loopback?: boolean;
}

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}
