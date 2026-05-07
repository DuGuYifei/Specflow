import type { PromptTemplate } from "../schema/prompt";

interface BaseEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string;
  targetPortId?: string;
  kind: WorkflowEdgeKind;
}

export type WorkflowEdgeKind = "passthrough" | "tagged-output";

export interface OutputTagBinding {
  identifier: string;
  xmlTagName: string;
  promptReference: string;
}

export interface EdgeHandoff {
  agentId: string;
  sessionId?: string;
  promptTemplate: PromptTemplate;
}

/**
 * A plain connection with no output transformation.
 * The previous node output is forwarded to the target node unchanged.
 */
export interface PassthroughEdge extends BaseEdge {
  kind: "passthrough";
}

/**
 * Wraps the previous node output in a named XML tag before rendering
 * the target prompt. A handoff agent can optionally transform the value first.
 */
export interface TaggedOutputEdge extends BaseEdge {
  kind: "tagged-output";
  outputTag: OutputTagBinding;
  handoff?: EdgeHandoff;
}

export type AnyWorkflowEdge = PassthroughEdge | TaggedOutputEdge;

/** @deprecated use WorkflowEdgeKind */
export type EdgeType = WorkflowEdgeKind;

/** @deprecated use PassthroughEdge */
export type SimpleEdge = PassthroughEdge;

/** @deprecated use TaggedOutputEdge */
export type DataEdge = TaggedOutputEdge;

/** @deprecated use AnyWorkflowEdge */
export type WorkflowEdge = AnyWorkflowEdge;
