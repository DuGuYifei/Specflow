export interface CanvasBranch {
  id: string;
  label: string;
  description?: string;
}

export interface CanvasSession {
  id: string;
  name: string;
  agentServerId: string;
  agent?: string;
}

export interface CanvasStepNode {
  kind: "step";
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  prompt: string;
  sessionId: string | null;
  locked?: boolean;
  images?: Array<{ path: string; label?: string; mimeType?: string }>;
  paths?: string[];
}

export interface CanvasGateNode {
  kind: "gate";
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  decisionCriteria: string;
  branches: CanvasBranch[];
}

export interface CanvasEndNode {
  kind: "end";
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sessionId: null;
}

export interface CanvasInputNode {
  kind: "input";
  id: string;
  num: string;
  x: number;
  y: number;
  w: number;
  title: string;
  variableName: string;
  defaultValue?: string;
  description?: string;
  sessionId: null;
}

export type CanvasNode = CanvasStepNode | CanvasGateNode | CanvasEndNode | CanvasInputNode;

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  transmit?: boolean;
  outputTag?: string;
  handoffPrompt?: string;
  branch?: string;
  loopback?: boolean;
}

export interface CanvasVariable {
  name: string;
  defaultValue?: string;
  description?: string;
}

export interface CanvasDoc {
  id: string;
  name: string;
  sessions: CanvasSession[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  variables?: CanvasVariable[];
}

export type AgentFlowStepNode = Omit<CanvasStepNode, "x" | "y" | "w">;
export type AgentFlowGateNode = Omit<CanvasGateNode, "x" | "y" | "w">;
export type AgentFlowEndNode = Omit<CanvasEndNode, "x" | "y" | "w">;
export type AgentFlowInputNode = Omit<CanvasInputNode, "x" | "y" | "w">;

export type AgentFlowNode =
  | AgentFlowStepNode
  | AgentFlowGateNode
  | AgentFlowEndNode
  | AgentFlowInputNode;

export interface AgentFlowDoc {
  id: string;
  name: string;
  sessions: CanvasSession[];
  nodes: AgentFlowNode[];
  edges: CanvasEdge[];
  variables?: CanvasVariable[];
}

export interface CanvasNodeLayout {
  nodeId: string;
  x: number;
  y: number;
  w: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasLayoutDoc {
  workflowId: string;
  version: 1;
  nodes: CanvasNodeLayout[];
  viewport?: CanvasViewport;
}
