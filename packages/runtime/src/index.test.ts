import { describe, expect, it } from "vitest";
import { createPhaseZeroGraph, validateGraph } from "./index.js";

describe("validateGraph", () => {
  it("accepts the Phase 0 intent graph", () => {
    expect(validateGraph(createPhaseZeroGraph())).toEqual({
      valid: true,
      issues: []
    });
  });
});
