import {
  renderPromptTemplate,
  wrapXmlTag,
  type AnyWorkflowEdge,
  type AnyWorkflowNode,
  type GateNode,
  type PromptTemplate,
} from "@specflow/workflow";

export interface PromptRenderContext {
  node: AnyWorkflowNode;
  input: string;
  edgeValues: Record<string, string>;
}

export function renderNodePrompt(context: PromptRenderContext): string {
  return renderPromptTemplate({
    template: context.node.promptTemplate,
    variables: {
      specflow_input: context.input,
      ...context.edgeValues,
    },
  });
}

export function renderHandoffPrompt(template: PromptTemplate, input: string): string {
  return renderPromptTemplate({
    template,
    variables: {
      specflow_input: input,
    },
  });
}

export function renderGatePrompt(node: GateNode, input: string): string {
  return renderPromptTemplate({
    template: node.promptTemplate,
    variables: {
      [node.inputVariable]: input,
      specflow_input: input,
      specflow_branches: node.branches.map((branch) => branch.id).join(", "),
    },
  });
}

export function createTaggedEdgeVariable(edge: AnyWorkflowEdge, content: string): Record<string, string> {
  if (edge.kind !== "tagged-output") {
    return {};
  }

  return {
    [edge.outputTag.promptReference]: wrapXmlTag(edge.outputTag.xmlTagName, content),
  };
}
