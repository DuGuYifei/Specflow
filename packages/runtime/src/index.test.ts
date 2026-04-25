import { describe, expect, it } from "vitest";
import { createDefaultWorkflowGraph, validateGraph } from "./index.js";

describe("validateGraph", () => {
  it("accepts the default workflow graph", () => {
    expect(validateGraph(createDefaultWorkflowGraph())).toEqual({
      valid: true,
      issues: []
    });
  });
});
