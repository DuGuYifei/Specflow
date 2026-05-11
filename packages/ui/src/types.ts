export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type RunStatus = 'running' | 'success' | 'error' | 'idle' | 'pending';
export type RunState = 'running' | 'success' | 'error' | 'pending';
export type RunStateMap = Record<string, RunState>;

export interface Session {
  id: string;
  name: string;
  color: string;
  agent: string;
}

export interface Workflow {
  id: string;
  name: string;
  meta: string;
  runs: number;
  active?: boolean;
}

export interface Run {
  id: string;
  label: string;
  ticket: string;
  status: RunStatus;
  activeNode?: string;
  progress?: string;
  time: string;
  duration: string;
  agent: string;
  active?: boolean;
  errorMsg?: string;
  nodeOutputs?: Record<string, string>;
}

export interface LogLine {
  chunk: string;
  nodeId?: string;
}

export interface Branch {
  id: string;
  label: string;
  color: string;
}

export interface StepNode {
  kind: 'step';
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  desc: string;
  sessionId: string | null;
  updateDoc: boolean;
  locked?: boolean;
  attachments?: Array<{ label: string }>;
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
  gateDesc?: string;
  sessionId: string | null;
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

export type WorkflowNode = StepNode | GateNode | EndNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
  tag?: string;
  prompt?: string;
  branch?: string;
  loopback?: boolean;
  sameSession?: boolean;
}

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}
