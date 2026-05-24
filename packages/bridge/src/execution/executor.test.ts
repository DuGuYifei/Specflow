import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCommandRequest, AgentCommandResult } from "@specflow/agent-proxy";
import type {
  AgentNode,
  GateNode,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "@specflow/workflow";
import { WorkflowExecutor, type AgentRunner } from "./executor";
import { RunPauseStore } from "./pause-store";
import { TerminalEventStore } from "./terminal-store";

const agentId = "agent-server-codex-acp";
const sessionId = "session-codex";

describe("WorkflowExecutor", () => {
  test("runs linear agent nodes and injects explicitly tagged output", async () => {
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
        edges: [tagged("edge-1", "first", "second", "input")],
      }),
      "start",
    );

    expect(run.status).toBe("done");
    expect(prompts).toEqual(["first start", "second <input>first output</input>"]);
    expect(run.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual(["first", "second"]);
  });

  test("sends node images and related resources as ACP content blocks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-prompt-blocks-"));
    await writeFile(join(cwd, "screenshot.png"), new Uint8Array([1, 2, 3]));
    await writeFile(join(cwd, "note.txt"), "hello text", "utf8");
    await writeFile(join(cwd, "capture.wav"), new Uint8Array([4, 5, 6]));
    await writeFile(join(cwd, "archive.bin"), new Uint8Array([7, 8, 9]));

    let promptBlocks: AgentCommandRequest["promptBlocks"];
    const node = agentNode("source", "inspect <specflow_input>");
    node.images = [
      { id: "img", kind: "image", path: "screenshot.png", label: "screenshot.png" },
    ];
    node.relatedResources = [
      { id: "note", kind: "file", path: "note.txt", label: "note.txt" },
      { id: "audio", kind: "file", path: "capture.wav", label: "capture.wav" },
      { id: "bin", kind: "file", path: "archive.bin", label: "archive.bin" },
    ];

    const executor = new WorkflowExecutor({
      cwd,
      agentRunner: async (request) => {
        promptBlocks = request.promptBlocks;
        return { agentServerId: request.agentServerId, exitCode: 0, output: "done" };
      },
    });

    await executor.run(createWorkflow({ nodes: [node], edges: [] }), "target");

    expect(promptBlocks?.map((block) => block.type)).toEqual([
      "text",
      "image",
      "resource",
      "audio",
      "resource",
    ]);
    expect(promptBlocks?.[0]).toMatchObject({ type: "text", text: "inspect target" });
    expect(promptBlocks?.[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from([1, 2, 3]).toString("base64"),
    });
    expect(promptBlocks?.[2]).toMatchObject({
      type: "resource",
      resource: { text: "hello text", mimeType: "text/plain" },
    });
    expect(promptBlocks?.[3]).toMatchObject({
      type: "audio",
      mimeType: "audio/wav",
      data: Buffer.from([4, 5, 6]).toString("base64"),
    });
    expect(promptBlocks?.[4]).toMatchObject({
      type: "resource",
      resource: { blob: Buffer.from([7, 8, 9]).toString("base64") },
    });
  });

  test("runs only the selected gate branch", async () => {
    const requests: AgentCommandRequest[] = [];
    const executor = new WorkflowExecutor({
      agentRunner: createAgentRunner((request) => {
        requests.push(request);
        if (request.prompt.startsWith("source")) {
          return "needs review";
        }
        if (request.forkFromWorkflowSessionId) {
          return JSON.stringify({ branchId: "rework", reason: "test selection" });
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
          agentNode("final-node", "final"),
        ],
        edges: [
          gateInput("edge-source-gate", "source", "gate"),
          trigger("edge-gate-pass", "gate", "pass-node", "pass"),
          trigger("edge-gate-rework", "gate", "rework-node", "rework"),
          trigger("edge-pass-final", "pass-node", "final-node"),
          trigger("edge-rework-final", "rework-node", "final-node"),
        ],
      }),
    );

    expect(run.status).toBe("done");
    expect(run.nodeRuns.map((nodeRun) => nodeRun.nodeId)).toEqual([
      "source",
      "gate",
      "rework-node",
      "final-node",
    ]);
    expect(run.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.gateDecision).toEqual({
      branchId: "rework",
      reason: "test selection",
    });
    expect(requests[1]?.forkFromWorkflowSessionId).toBe(sessionId);
    expect(requests[1]?.workflowSessionId).toBe(`${sessionId}-fork-01`);
    expect(requests[1]?.prompt).toContain('"branchId":"<one available branch id>"');
    expect(run.agentInvocations.find((invocation) => invocation.nodeId === "gate")?.sessionId).toBe(sessionId);
    expect(run.agentInvocations.find((invocation) => invocation.nodeId === "gate")?.parentSessionId).toBeUndefined();
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
          agentServerId: request.agentServerId,
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

  test("passes the workflow session id to agent-proxy for nodes and edge handoffs", async () => {
    const seen: Array<string | undefined> = [];
    const executor = new WorkflowExecutor({
      agentRunner: createAgentRunner((request) => {
        seen.push(request.workflowSessionId);
        return request.prompt.startsWith("handoff") ? "handled" : "done";
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
              promptTemplate: { template: "handoff <specflow_input>" },
            },
          },
        ],
      }),
    );

    expect(run.status).toBe("done");
    expect(seen).toEqual([sessionId, sessionId, sessionId]);
  });

  test("pauses an agent node for same-session prompts before continuing downstream", async () => {
    const pauses = new RunPauseStore();
    const statuses: string[] = [];
    const prompts: string[] = [];
    const source = agentNode("source", "source");
    source.pauseAfterRun = true;
    const executor = new WorkflowExecutor({
      pauses,
      onNodeStatus: (event) => statuses.push(`${event.nodeId}:${event.status}`),
      agentRunner: createAgentRunner((request) => {
        prompts.push(request.prompt);
        if (request.prompt === "source") return "draft";
        if (request.prompt === "revise it") return "revised";
        return "target done";
      }),
    });

    const runPromise = executor.run(
      createWorkflow({
        nodes: [source, agentNode("target", "target <specflow_input>")],
        edges: [tagged("edge", "source", "target", "input")],
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const paused = pauses.list()[0]!;
    expect(paused).toMatchObject({ nodeId: "source", specflowSessionId: sessionId });
    expect(statuses).toEqual(["source:running", "source:paused"]);

    await expect(pauses.sendPrompt(paused.runId, paused.nodeId, "revise it")).resolves.toEqual({ output: "revised" });
    pauses.continue(paused.runId, paused.nodeId);

    const run = await runPromise;
    expect(run.status).toBe("done");
    expect(statuses).toEqual(["source:running", "source:paused", "source:done", "target:running", "target:done"]);
    expect(prompts).toEqual(["source", "revise it", "target <input>revised</input>"]);
  });

  test("records external ACP session metadata on agent invocations", async () => {
    const executor = new WorkflowExecutor({
      agentRunner: async (request) => {
        expect(request.runId).toBe("ui-run-1");
        request.onTerminalEvent?.({ stream: "stdout", chunk: "done" });
        return {
          agentServerId: request.agentServerId,
          sessionId: "acp-session-123",
          initializeResponse: {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              sessionCapabilities: { resume: {} },
            },
          },
          exitCode: 0,
          output: "done",
        };
      },
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
      "",
      { runId: "ui-run-1" },
    );

    expect(run.id).toBe("ui-run-1");
    expect(run.status).toBe("done");
    expect(run.agentInvocations[0]).toMatchObject({
      runId: "ui-run-1",
      nodeId: "source",
      agentServerId: "codex-acp",
      sessionId,
      acpSessionId: "acp-session-123",
      acpSupportsLoadSession: true,
      acpSupportsResumeSession: true,
    });
  });

  test("routes permission requests through the interaction store", async () => {
    const executor = new WorkflowExecutor({
      agentRunner: async (request) => {
        const permission = await request.onPermissionRequest?.({
          sessionId: "acp-session",
          toolCall: { toolCallId: "tool-1", title: "Edit file" },
          options: [{ optionId: "allow", name: "Allow" }],
          raw: {},
        });
        return {
          agentServerId: request.agentServerId,
          sessionId: "acp-session",
          exitCode: 0,
          output: permission?.outcome === "selected" ? permission.optionId : "cancelled",
        };
      },
    });

    const runPromise = executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const interaction = executor.interactions.list({ status: "pending" })[0]!;
    expect(interaction).toMatchObject({
      kind: "permission",
      runId: expect.any(String),
      nodeId: "source",
      agentServerId: "codex-acp",
    });
    executor.interactions.resolve(interaction.id, { outcome: "selected", optionId: "allow" });

    const run = await runPromise;
    expect(run.status).toBe("done");
    expect(run.agentInvocations[0]?.output).toBe("allow");
  });

  test("adds workflow context to agent lifecycle events", async () => {
    const lifecycleEvents: string[] = [];
    const executor = new WorkflowExecutor({
      onAgentLifecycle(event) {
        lifecycleEvents.push(`${event.type}:${event.nodeId}:${event.agentInvocationId}`);
      },
      agentRunner: async (request) => {
        request.onLifecycleEvent?.({
          type: "prompt_started",
          agentServerId: request.agentServerId,
          sessionId: "acp-session",
          at: "2026-05-19T00:00:00.000Z",
        });
        return {
          agentServerId: request.agentServerId,
          sessionId: "acp-session",
          exitCode: 0,
          output: "done",
        };
      },
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
    );

    expect(run.status).toBe("done");
    expect(lifecycleEvents).toHaveLength(1);
    expect(lifecycleEvents[0]).toContain("prompt_started:source:");
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

  test("marks the run cancelled and forwards AbortSignal to the agent runner", async () => {
    const controller = new AbortController();
    const runStatuses: string[] = [];
    let sawSignal = false;
    let abortSeen: (() => void) | undefined;
    const abortSeenPromise = new Promise<void>((resolve) => {
      abortSeen = resolve;
    });

    const executor = new WorkflowExecutor({
      onRunStatus(event) {
        runStatuses.push(event.status);
      },
      agentRunner: async (request) => {
        sawSignal = request.signal === controller.signal;
        request.signal?.addEventListener("abort", () => abortSeen?.(), { once: true });
        controller.abort();
        await abortSeenPromise;
        return {
          agentServerId: request.agentServerId,
          exitCode: 1,
          output: "cancelled by test",
        };
      },
    });

    const run = await executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
      "",
      { signal: controller.signal },
    );

    expect(sawSignal).toBe(true);
    expect(run.status).toBe("cancelled");
    expect(runStatuses).toEqual(["running", "cancelled"]);
    expect(run.nodeRuns[0]?.status).toBe("failed");
  });

  test("cancels a run waiting for a permission decision", async () => {
    const controller = new AbortController();
    const executor = new WorkflowExecutor({
      agentRunner: async (request) => {
        const permission = await request.onPermissionRequest?.({
          sessionId: "acp-session",
          toolCall: { toolCallId: "tool-1", title: "Edit file" },
          options: [{ optionId: "allow", name: "Allow" }],
          raw: {},
        });
        return {
          agentServerId: request.agentServerId,
          sessionId: "acp-session",
          exitCode: permission?.outcome === "cancelled" ? 1 : 0,
          output: "permission resolved",
        };
      },
    });

    const runPromise = executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
      "",
      { signal: controller.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executor.interactions.list({ status: "pending" })).toHaveLength(1);
    executor.interactions.cancelPendingForRun(executor.interactions.list({ status: "pending" })[0]!.runId, "test cancel");
    controller.abort();

    const run = await runPromise;
    expect(run.status).toBe("cancelled");
    expect(executor.interactions.list({ status: "pending" })).toHaveLength(0);
  });

  test("cancels a run waiting for an elicitation decision", async () => {
    const controller = new AbortController();
    const executor = new WorkflowExecutor({
      agentRunner: async (request) => {
        const elicitation = await request.onElicitationRequest?.({
          sessionId: "acp-session",
          mode: "form",
          message: "Pick a value",
          requestedSchema: {
            type: "object",
            properties: {
              value: { type: "string", title: "Value" },
            },
          },
        });
        return {
          agentServerId: request.agentServerId,
          sessionId: "acp-session",
          exitCode: elicitation?.action === "cancel" ? 1 : 0,
          output: "elicitation resolved",
        };
      },
    });

    const runPromise = executor.run(
      createWorkflow({
        nodes: [agentNode("source", "source")],
        edges: [],
      }),
      "",
      { signal: controller.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(executor.interactions.list({ status: "pending" })).toHaveLength(1);
    executor.interactions.cancelPendingForRun(executor.interactions.list({ status: "pending" })[0]!.runId, "test cancel");
    controller.abort();

    const run = await runPromise;
    expect(run.status).toBe("cancelled");
    expect(executor.interactions.list({ status: "pending" })).toHaveLength(0);
  });
});

function createWorkflow(input: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Workflow {
  return {
    id: "workflow",
    name: "Workflow",
    agents: [
      {
        id: agentId,
        kind: "external",
        name: "Codex ACP",
        agentServerId: "codex-acp",
      },
    ],
    sessions: [
      {
        id: sessionId,
        name: "Mock session",
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
    images: [],
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
    branches: branches.map((branch) => ({ id: branch, label: branch })),
  };
}

function trigger(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourcePortId?: string,
): WorkflowEdge {
  return {
    id,
    kind: "trigger",
    sourceNodeId,
    targetNodeId,
    sourcePortId,
  };
}

function gateInput(id: string, sourceNodeId: string, targetNodeId: string): WorkflowEdge {
  return {
    id,
    kind: "gate-input",
    sourceNodeId,
    targetNodeId,
  };
}

function tagged(id: string, sourceNodeId: string, targetNodeId: string, tag: string): WorkflowEdge {
  return {
    id,
    kind: "tagged-output",
    sourceNodeId,
    targetNodeId,
    outputTag: {
      identifier: tag,
      promptReference: `specflow_${tag}`,
      xmlTagName: tag,
    },
  };
}

function createAgentRunner(handler: (request: AgentCommandRequest) => string): AgentRunner {
  return async (request): Promise<AgentCommandResult> => {
    const output = handler(request);
    request.onTerminalEvent?.({ stream: "stdout", chunk: output });
    return {
      agentServerId: request.agentServerId,
      exitCode: 0,
      output,
    };
  };
}
