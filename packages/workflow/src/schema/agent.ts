import type { AgentProvider } from "@specflow/shared";

export type AgentDefinitionKind = "provider" | "workflow" | "specflow";

interface BaseAgentDefinition {
  id: string;
  kind: AgentDefinitionKind;
  name: string;
  description?: string;
}

export interface ProviderAgentDefinition extends BaseAgentDefinition {
  kind: "provider";
  provider: AgentProvider;
  providerAgentId?: string;
}

export interface WorkflowAgentDefinition extends BaseAgentDefinition {
  kind: "workflow";
  workflowId: string;
}

export interface SpecflowAgentDefinition extends BaseAgentDefinition {
  kind: "specflow";
  role: "workflow-manager" | "workflow-learner";
}

export type AgentDefinition =
  | ProviderAgentDefinition
  | WorkflowAgentDefinition
  | SpecflowAgentDefinition;
