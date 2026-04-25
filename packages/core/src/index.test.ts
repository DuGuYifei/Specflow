import { describe, expect, it } from "vitest";
import type { EdgeType, NodeType } from "./index.js";

describe("core domain types", () => {
  it("allows default workflow node and edge concepts", () => {
    const nodeType: NodeType = "implementation_reviewer";
    const edgeType: EdgeType = "review_loop";

    expect(nodeType).toBe("implementation_reviewer");
    expect(edgeType).toBe("review_loop");
  });
});
