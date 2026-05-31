import type { AgentFlowDoc } from "./canvas-doc";

export interface RunInputVariable {
  name: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
  value: string;
  source: "override" | "default" | "missing";
}

export interface PreparedCanvasRun {
  doc: AgentFlowDoc;
  initialInput: string;
  variables: RunInputVariable[];
  effectiveValues: Record<string, string>;
  missingVariables: RunInputVariable[];
}

export function prepareCanvasRun(
  doc: AgentFlowDoc,
  input: {
    initialInput?: string;
    variableValues?: Record<string, string>;
  } = {},
): PreparedCanvasRun {
  const overrides = input.variableValues ?? {};
  const variables: RunInputVariable[] = [];
  const effectiveValues: Record<string, string> = {};

  for (const n of doc.nodes) {
    if (n.kind !== "input") continue;

    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, n.variableName);
    const overrideValue = overrides[n.variableName];
    const value = hasOverride ? overrideValue : n.defaultValue ?? "";
    const required = n.required !== false;
    const isMissing = required && value.trim() === "";
    const source = isMissing ? "missing" : hasOverride ? "override" : "default";

    effectiveValues[n.variableName] = value;
    variables.push({
      name: n.variableName,
      required,
      defaultValue: n.defaultValue,
      description: n.description,
      value,
      source,
    });
  }

  for (const [key, value] of Object.entries(overrides)) {
    effectiveValues[key] = value;
  }

  const tokenRx = /<(specflow_[A-Za-z0-9_]+)>/g;
  const substitute = (s: string | undefined) =>
    s?.replace(tokenRx, (orig, key: string) => (key in effectiveValues ? effectiveValues[key] : orig));

  const substitutedNodes = doc.nodes.map((n) => {
    if (n.kind === "step") return { ...n, prompt: substitute(n.prompt) ?? "" };
    if (n.kind === "gate") return { ...n, decisionCriteria: substitute(n.decisionCriteria) ?? "" };
    return n;
  });

  return {
    doc: { ...doc, nodes: substitutedNodes },
    initialInput: substitute(input.initialInput) ?? input.initialInput ?? "",
    variables,
    effectiveValues,
    missingVariables: variables.filter((v) => v.source === "missing"),
  };
}
