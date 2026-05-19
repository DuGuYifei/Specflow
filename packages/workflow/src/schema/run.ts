import type { NodeStatus } from "@specflow/shared";

export type { NodeStatus };

export type WorkflowRunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt?: string;
  completedAt?: string;
  nodeRuns: NodeRun[];
  agentInvocations: AgentInvocation[];
}

export interface NodeRun {
  id: string;
  nodeId: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  input?: string;
  output?: string;
  error?: string;
  sessionId?: string;
  agentInvocationId?: string;
  gateDecision?: GateDecision;
}

export interface GateDecision {
  branchId: string;
  reason?: string;
}

export interface AgentInvocation {
  id: string;
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  agentId: string;
  agentServerId?: string;
  sessionId?: string;
  acpSessionId?: string;
  acpSupportsLoadSession?: boolean;
  acpSupportsResumeSession?: boolean;
  prompt: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

export type TerminalStream = "stdout" | "stderr" | "system";

export interface TerminalOutputEvent {
  id: string;
  runId: string;
  nodeRunId?: string;
  agentInvocationId?: string;
  stream: TerminalStream;
  sequence: number;
  chunk: string;
  createdAt: string;
}
