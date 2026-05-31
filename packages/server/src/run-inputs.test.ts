import { describe, expect, it } from "bun:test";
import { prepareCanvasRun } from "./run-inputs";
import type { AgentFlowDoc, AgentFlowStepNode } from "./canvas-doc";

const doc: AgentFlowDoc = {
  id: "simple",
  name: "Simple",
  sessions: [{ id: "s1", name: "codex", agentServerId: "codex-acp" }],
  nodes: [
    {
      kind: "input",
      id: "in1",
      alias: "IN",
      title: "Value",
      variableName: "specflow_value",
      sessionId: null,
    },
    {
      kind: "step",
      id: "n1",
      alias: "01",
      title: "Add one",
      prompt: "1 + <specflow_value> = ?",
      sessionId: "s1",
    },
  ],
  edges: [{ id: "e-input", from: "in1", to: "n1" }],
};

describe("prepareCanvasRun", () => {
  it("reports missing input nodes without defaults", () => {
    const prepared = prepareCanvasRun(doc);
    expect(prepared.missingVariables.map((v) => v.name)).toEqual(["specflow_value"]);
    expect(findStep(prepared.doc, "n1").prompt).toBe("1 +  = ?");
  });

  it("substitutes provided variable values into step prompts", () => {
    const prepared = prepareCanvasRun(doc, { variableValues: { specflow_value: "1" } });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(prepared.variables[0]).toMatchObject({
      name: "specflow_value",
      required: true,
      value: "1",
      source: "override",
    });
    expect(findStep(prepared.doc, "n1").prompt).toBe("1 + 1 = ?");
  });

  it("treats empty overrides as missing", () => {
    const prepared = prepareCanvasRun(doc, { variableValues: { specflow_value: "" } });
    expect(prepared.missingVariables.map((v) => v.name)).toEqual(["specflow_value"]);
  });

  it("allows optional inputs to stay empty", () => {
    const prepared = prepareCanvasRun({
      ...doc,
      nodes: doc.nodes.map((node) => (
        node.kind === "input" ? { ...node, required: false } : node
      )),
    });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(prepared.variables[0]).toMatchObject({
      name: "specflow_value",
      required: false,
      value: "",
      source: "default",
    });
  });
});

function findStep(input: AgentFlowDoc, id: string): AgentFlowStepNode {
  const node = input.nodes.find((n): n is AgentFlowStepNode => n.kind === "step" && n.id === id);
  if (!node) throw new Error(`Missing step ${id}`);
  return node;
}
