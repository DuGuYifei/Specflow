import { describe, expect, it } from "bun:test";
import { prepareCanvasRun } from "./run-inputs";
import type { CanvasDoc, CanvasStepNode } from "./canvas-doc";

const doc: CanvasDoc = {
  id: "simple",
  name: "Simple",
  sessions: [{ id: "s1", name: "mock", color: "blue", agent: "mock" }],
  nodes: [
    {
      kind: "input",
      id: "in1",
      num: "IN",
      x: 0,
      y: 0,
      w: 200,
      title: "Value",
      variableName: "specflow_value",
      sessionId: null,
    },
    {
      kind: "step",
      id: "n1",
      num: "01",
      x: 0,
      y: 0,
      w: 220,
      title: "Add one",
      desc: "1 + <specflow_value> = ?",
      sessionId: "s1",
      updateDoc: false,
    },
  ],
  edges: [{ id: "e-input", from: "in1", to: "n1" }],
};

describe("prepareCanvasRun", () => {
  it("reports missing input nodes without defaults", () => {
    const prepared = prepareCanvasRun(doc);
    expect(prepared.missingVariables.map((v) => v.name)).toEqual(["specflow_value"]);
    expect(findStep(prepared.doc, "n1").desc).toBe("1 +  = ?");
  });

  it("substitutes provided variable values into step prompts", () => {
    const prepared = prepareCanvasRun(doc, { variableValues: { specflow_value: "1" } });
    expect(prepared.missingVariables).toHaveLength(0);
    expect(prepared.variables[0]).toMatchObject({
      name: "specflow_value",
      value: "1",
      source: "override",
    });
    expect(findStep(prepared.doc, "n1").desc).toBe("1 + 1 = ?");
  });
});

function findStep(input: CanvasDoc, id: string): CanvasStepNode {
  const node = input.nodes.find((n): n is CanvasStepNode => n.kind === "step" && n.id === id);
  if (!node) throw new Error(`Missing step ${id}`);
  return node;
}
