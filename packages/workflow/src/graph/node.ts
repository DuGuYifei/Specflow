import type { WorkflowNodeKind } from "@specflow/shared";
import type { PromptTemplate } from "../schema/prompt";
import type { WorkflowResourceRef } from "../schema/resource";

export interface NodePosition {
  x: number;
  y: number;
}

export interface BaseWorkflowNode<TKind extends WorkflowNodeKind = WorkflowNodeKind> {
  id: string;
  kind: TKind;
  title: string;
  description?: string;
  promptTemplate: PromptTemplate;
  position?: NodePosition;
}

export interface AgentNode extends BaseWorkflowNode<"agent"> {
  agentId: string;
  sessionId: string;
  updateSpecDoc: boolean;
  attachments: WorkflowResourceRef[];
  relatedResources: WorkflowResourceRef[];
}

export interface FunctionalNode<TKind extends WorkflowNodeKind = WorkflowNodeKind>
  extends BaseWorkflowNode<TKind> {
  behavior: "functional";
}

export interface GateBranch {
  id: string;
  label: string;
  color?: string;
  description?: string;
}

export interface GateNode extends FunctionalNode<"gate"> {
  decisionCriteria: string;
  inputVariable: string;
  branches: GateBranch[];
}

export type AnyWorkflowNode = AgentNode | GateNode;

/** @deprecated use AnyWorkflowNode */
export type WorkflowNode = AnyWorkflowNode;
