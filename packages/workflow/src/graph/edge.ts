import type { PromptTemplate } from "../schema/prompt";

interface BaseEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string;
  targetPortId?: string;
  kind: WorkflowEdgeKind;
}

export type WorkflowEdgeKind = "trigger" | "gate-input" | "tagged-output";

export interface OutputTagBinding {
  identifier: string;
  xmlTagName: string;
  promptReference: string;
}

export interface EdgeHandoff {
  promptTemplate: PromptTemplate;
}

/**
 * Activates a downstream node without carrying explicit content.
 */
export interface TriggerEdge extends BaseEdge {
  kind: "trigger";
}

/**
 * Supplies the single upstream output to a gate. Gate inputs have no authored
 * transfer properties; the gate needs its predecessor's output for routing.
 */
export interface GateInputEdge extends BaseEdge {
  kind: "gate-input";
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

export type WorkflowEdge = TriggerEdge | GateInputEdge | TaggedOutputEdge;
