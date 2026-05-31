export type Theme = 'light' | 'dark';
export type Language = 'en' | 'zh-CN';

export interface Variable {
  name: string;           // always prefixed: "specflow_branch"
  required?: boolean;
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
  /** Raw JSON string for ACP McpServer[]. */
  mcpServers?: string;
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
  resumedFromRunId?: string;
  resumedByRunId?: string;
}

export interface LogLine {
  chunk: string;
  nodeId?: string;
  stream?: 'stdout' | 'stderr' | 'system';
}

export type TimelineEvent =
  | {
    type: 'terminal';
    chunk: string;
    nodeId?: string;
    agentInvocationId?: string;
    specflowSessionId?: string;
    stream?: 'stdout' | 'stderr' | 'system';
    localContext?: boolean;
  }
  | {
    type: 'session-update';
    update: unknown;
    nodeId?: string;
    agentInvocationId?: string;
    sessionId?: string;
    specflowSessionId?: string;
    localContext?: boolean;
  }
  | {
    type: 'gate-decision';
    nodeId?: string;
    branchId: string;
    reason?: string;
    branches?: Array<{
      branchId: string;
      label: string;
      traversalsUsed: number;
      maxTraversals: number;
      available: boolean;
    }>;
  }
  | {
    type: 'display-message';
    role: 'agent' | 'user' | 'system';
    text: string;
    nodeId?: string;
    specflowSessionId?: string;
  };

export interface Branch {
  id: string;
  label: string;
  description?: string;
}

export interface StepNode {
  kind: 'step';
  id: string;
  alias: string;
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
  modeId?: string;
  configOptions?: Record<string, string | boolean>;
}

export interface GateNode {
  kind: 'gate';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  decisionCriteria: string;
  branches: Branch[];
  configOptions?: Record<string, string | boolean>;
}

export interface EndNode {
  kind: 'end';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
}

export interface InputNode {
  kind: 'input';
  id: string;
  alias: string;
  x: number;
  y: number;
  w: number;
  title: string;
  variableName: string;    // stored prefixed: "specflow_component_tree"
  required?: boolean;
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
  maxTraversals?: number;
}

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}
