export type AgentProvider = "claude-code" | "codex";

export type WorkflowNodeKind = "agent" | "gate";

/** @deprecated use WorkflowNodeKind */
export type NodeType = WorkflowNodeKind;

export type NodeStatus = "queued" | "running" | "done" | "failed" | "skipped";
