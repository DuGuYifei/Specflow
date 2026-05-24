import {
  renderPromptTemplate,
  wrapXmlTag,
  type GateNode,
  type PromptTemplate,
  type WorkflowEdge,
  type WorkflowNode,
} from "@specflow/workflow";

export interface PromptRenderContext {
  node: WorkflowNode;
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
  const criteria = renderPromptTemplate({
    template: node.promptTemplate,
    variables: { specflow_input: input },
  });
  const branches = JSON.stringify(node.branches.map((branch) => ({
    id: branch.id,
    label: branch.label,
    description: branch.description ?? "",
  })));
  return [
    "Select exactly one workflow branch based on the prior node output.",
    "",
    "Decision criteria:",
    criteria,
    "",
    "Prior node output:",
    `<specflow_input>${input}</specflow_input>`,
    "",
    `Available branches: ${branches}`,
    "",
    "Return only valid JSON matching this schema, with no markdown or extra text:",
    '{"branchId":"<one available branch id>","reason":"<short explanation>"}',
  ].join("\n");
}

export function createTaggedEdgeVariable(edge: WorkflowEdge, content: string): Record<string, string> {
  if (edge.kind !== "tagged-output") {
    return {};
  }

  return {
    [edge.outputTag.promptReference]: wrapXmlTag(edge.outputTag.xmlTagName, content),
  };
}
