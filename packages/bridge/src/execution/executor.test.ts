import { describe, expect, test } from "bun:test";
import type { AgentCommandRequest, AgentCommandResult } from "@specflow/agent-proxy";
import type {
  AgentNode,
  AnyWorkflowEdge,
  AnyWorkflowNode,
  GateNode,
  Workflow,
} from "@specflow/workflow";
import { WorkflowExecutor, type AgentRunner } from "./executor";
import { TerminalEventStore } from "./terminal-store";

const agentId = "agent-codex";
const sessionId = "session-codex";

describe("WorkflowExecutor", () => {
  test("runs linear agent nodes and passes output through", async () => {
    const prompts: string[] = [];
    const executor = new WorkflowExecutor({
      agentRunner: createAgentRunner((request) => {
        prompts.push(request.prompt);
        return request.prompt.includes("second") ? "final output" : "first output";
      }),
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [
          agentNode("first", "first <specflow_input>"),
          agentNode("second", "second <specflow_input>"),
        ],
        edges: [passthrough("edge-1", "first", "second")],
      }),
      "start",
    );

    expect(run.status).toBe("done");
    expect(prompts).toEqual(["first start", "second first output"]);
    expect(run.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual(["first", "second"]);
  });

  test("runs only the selected gate branch", async () => {
    const executor = new WorkflowExecutor({
      gateEvaluator: {
        async evaluate() {
          return { branchId: "rework", reason: "test selection" };
        },
      },
      agentRunner: createAgentRunner((request) => {
        if (request.prompt.startsWith("source")) {
          return "needs review";
        }
        return request.prompt;
      }),
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [
          agentNode("source", "source"),
          gateNode("gate", ["pass", "rework"]),
          agentNode("pass-node", "pass <specflow_input>"),
          agentNode("rework-node", "rework <specflow_input>"),
        ],
        edges: [
          passthrough("edge-source-gate", "source", "gate"),
          passthrough("edge-gate-pass", "gate", "pass-node", "pass"),
          passthrough("edge-gate-rework", "gate", "rework-node", "rework"),
        ],
      }),
    );

    expect(run.status).toBe("done");
    expect(run.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual([
      "source",
      "gate",
      "rework-node",
    ]);
    expect(run.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.gateDecision).toEqual({
      branchId: "rework",
      reason: "test selection",
    });
  });

  test("injects tagged output into the target prompt", async () => {
    const prompts: string[] = [];
    const executor = new WorkflowExecutor({
      agentRunner: createAgentRunner((request) => {
        prompts.push(request.prompt);
        return request.prompt.startsWith("source") ? "tree content" : "done";
      }),
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [
          agentNode("source", "source"),
          agentNode("target", "target <specflow_component_tree>"),
        ],
        edges: [
          {
            id: "edge-tag",
            kind: "tagged-output",
            sourceNodeId: "source",
            targetNodeId: "target",
            outputTag: {
              identifier: "component_tree",
              promptReference: "specflow_component_tree",
              xmlTagName: "component_tree",
            },
          },
        ],
      }),
    );

    expect(run.status).toBe("done");
    expect(prompts[1]).toBe("target <component_tree>tree content</component_tree>");
  });

  test("uses handoff output before tagged edge injection", async () => {
    const prompts: string[] = [];
    const executor = new WorkflowExecutor({
      agentRunner: createAgentRunner((request) => {
        prompts.push(request.prompt);
        if (request.prompt.startsWith("source")) {
          return "raw content";
        }
        if (request.prompt.startsWith("handoff")) {
          return "handled content";
        }
        return "target done";
      }),
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [
          agentNode("source", "source"),
          agentNode("target", "target <specflow_component_tree>"),
        ],
        edges: [
          {
            id: "edge-handoff",
            kind: "tagged-output",
            sourceNodeId: "source",
            targetNodeId: "target",
            outputTag: {
              identifier: "component_tree",
              promptReference: "specflow_component_tree",
              xmlTagName: "component_tree",
            },
            handoff: {
              agentId,
              sessionId,
              promptTemplate: { template: "handoff <specflow_input>" },
            },
          },
        ],
      }),
    );

    expect(run.status).toBe("done");
    expect(prompts).toEqual([
      "source",
      "handoff raw content",
      "target <component_tree>handled content</component_tree>",
    ]);
  });

  test("keeps terminal events when an agent fails", async () => {
    const terminalEvents = new TerminalEventStore();
    const executor = new WorkflowExecutor({
      terminalEvents,
      agentRunner: async (request) => {
        request.onTerminalEvent?.({ stream: "stderr", chunk: "failure details" });
        return {
          provider: request.provider,
          exitCode: 1,
          output: "failed",
        };
      },
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
    );

    expect(run.status).toBe("failed");
    expect(run.nodeRuns[0]?.status).toBe("failed");
    expect(terminalEvents.list({ runId: run.id }).map((event) => event.chunk)).toContain(
      "failure details",
    );
  });

  test("fails an agent node when its session belongs to another agent", async () => {
    const workflow = createWorkflow({
      nodes: [agentNode("source", "source")],
      edges: [],
    });
    workflow.sessions[0] = {
      id: sessionId,
      name: "Other session",
      agentId: "other-agent",
      createdAt: "2026-05-07T00:00:00.000Z",
    };

    const run = await new WorkflowExecutor({
      agentRunner: createAgentRunner(() => "unused"),
    }).run(workflow);

    expect(run.status).toBe("failed");
    expect(run.nodeRuns[0]?.status).toBe("failed");
    expect(run.nodeRuns[0]?.error).toContain("belongs to agent");
  });
});

function createWorkflow(input: {
  nodes: AnyWorkflowNode[];
  edges: AnyWorkflowEdge[];
}): Workflow {
  return {
    id: "workflow",
    name: "Workflow",
    agents: [
      {
        id: agentId,
        kind: "provider",
        name: "Codex",
        provider: "codex",
      },
    ],
    sessions: [
      {
        id: sessionId,
        name: "Codex session",
        agentId,
        createdAt: "2026-05-07T00:00:00.000Z",
      },
    ],
    nodes: input.nodes,
    edges: input.edges,
  };
}

function agentNode(id: string, template: string): AgentNode {
  return {
    id,
    kind: "agent",
    title: id,
    promptTemplate: { template },
    agentId,
    sessionId,
    updateSpecDoc: false,
    attachments: [],
    relatedResources: [],
  };
}

function gateNode(id: string, branches: string[]): GateNode {
  return {
    id,
    kind: "gate",
    title: id,
    behavior: "functional",
    promptTemplate: { template: "gate <specflow_input> <specflow_branches>" },
    decisionCriteria: "choose a branch",
    inputVariable: "specflow_input",
    branches: branches.map((branch) => ({ id: branch, label: branch })),
  };
}

function passthrough(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourcePortId?: string,
): AnyWorkflowEdge {
  return {
    id,
    kind: "passthrough",
    sourceNodeId,
    targetNodeId,
    sourcePortId,
  };
}

function createAgentRunner(handler: (request: AgentCommandRequest) => string): AgentRunner {
  return async (request): Promise<AgentCommandResult> => {
    const output = handler(request);
    request.onTerminalEvent?.({ stream: "stdout", chunk: output });
    return {
      provider: request.provider,
      exitCode: 0,
      output,
    };
  };
}
