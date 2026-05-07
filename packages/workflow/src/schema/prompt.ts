export interface PromptTemplate {
  template: string;
}

export interface PromptRenderInput {
  template: PromptTemplate;
  variables: Record<string, string>;
}

export function renderPromptTemplate(input: PromptRenderInput): string {
  let rendered = input.template.template;

  for (const [key, value] of Object.entries(input.variables)) {
    rendered = rendered.split(`<${key}>`).join(value);
    rendered = rendered.split(`{{${key}}}`).join(value);
  }

  return rendered;
}

export function wrapXmlTag(tagName: string, content: string): string {
  return `<${tagName}>${content}</${tagName}>`;
}
