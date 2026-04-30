import { describe, expect, it } from "vitest";
import type {
  AgentCliConfig,
  EdgeType,
  NodeSessionPolicy,
  NodeExecutionStatus,
  NodeType,
  WorkflowControlDecision,
  WorkflowDefinition,
  WorkflowDefinitionRef,
  WorkflowArtifactKind,
  WorkflowRunStatus
} from "./index.js";

describe("core domain types", () => {
  it("allows default workflow node and edge concepts", () => {
    const nodeType: NodeType = "workflow_director";
    const edgeType: EdgeType = "control_scope";
    const node = {
      id: "plan",
      type: "plan" as const,
      label: "Plan",
      status: "pending" as const,
      agentCli: { cli: "claude", args: ["--headless"] }
    };

    expect(nodeType).toBe("workflow_director");
    expect(edgeType).toBe("control_scope");
    expect(node.agentCli.cli).toBe("claude");
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

  it("allows session policy and director decisions", () => {
    const session: NodeSessionPolicy = {
      mode: "ai_decides",
      groupId: "implementation",
      controllerNodeId: "session-director",
      newSessionOnLoop: true
    };
    const decision: WorkflowControlDecision = {
      id: "decision_1",
      runId: "run_1",
      controllerNodeId: "session-director",
      kind: "session",
      targetNodeIds: ["plan", "code-draft"],
      summary: "Reuse one implementation session.",
      sessionDecisions: [
        {
          targetNodeId: "plan",
          sessionGroupId: "implementation",
          openNewSession: true,
          reason: "Start the implementation thread."
        }
      ],
      createdAt: "2026-01-01T00:00:00.000Z"
    };

    expect(session.mode).toBe("ai_decides");
    expect(decision.kind).toBe("session");
  });

  it("allows structured workflow definitions", () => {
    const definition: WorkflowDefinition = {
      id: "phase-1-local-loop",
      name: "Phase 1 Local Loop",
      version: "0.1.0",
      entryNodeId: "ticket-input",
      sessionGroups: [
        {
          id: "implementation",
          label: "Implementation",
          controllerNodeId: "session-director"
        }
      ],
      nodes: [
        {
          id: "ticket-input",
          type: "ticket",
          label: "Ticket Input",
          status: "pending"
        }
      ],
      edges: []
    };

    expect(definition.entryNodeId).toBe("ticket-input");
    expect(definition.sessionGroups?.[0]?.id).toBe("implementation");
  });

  it("allows workflow runs to reference their source definition", () => {
    const reference: WorkflowDefinitionRef = {
      id: "phase-1-local-loop",
      name: "Phase 1 Local Loop",
      source: "repository",
      version: "0.1.0",
      path: "workflows/phase-1-local-loop.workflow.json"
    };

    expect(reference.source).toBe("repository");
  });
});
