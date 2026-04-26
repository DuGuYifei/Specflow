import { describe, expect, it } from "vitest";
import type {
  AgentCliConfig,
  EdgeType,
  NodeExecutionStatus,
  NodeType,
  WorkflowArtifactKind,
  WorkflowRunStatus
} from "./index.js";

describe("core domain types", () => {
  it("allows default workflow node and edge concepts", () => {
    const nodeType: NodeType = "implementation_reviewer";
    const edgeType: EdgeType = "review_loop";

    expect(nodeType).toBe("implementation_reviewer");
    expect(edgeType).toBe("review_loop");
  });

  it("allows Phase 1 run, artifact, execution, and agent concepts", () => {
    const runStatus: WorkflowRunStatus = "running";
    const executionStatus: NodeExecutionStatus = "completed";
    const artifactKind: WorkflowArtifactKind = "spec-context";
    const agentCli: AgentCliConfig = { cli: "codex", args: [] };

    expect(runStatus).toBe("running");
    expect(executionStatus).toBe("completed");
    expect(artifactKind).toBe("spec-context");
    expect(agentCli.cli).toBe("codex");
  });
});
