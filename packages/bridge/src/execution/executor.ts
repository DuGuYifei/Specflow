import {
  runAgentCommand,
  type AgentCommandRequest,
  type AgentCommandResult,
  type AgentTerminalEvent,
} from "@specflow/agent-proxy";
import type { AgentProvider, NodeStatus } from "@specflow/shared";
import {
  assertValidAgentNodeSession,
  type AgentDefinition,
  type AgentInvocation,
  type AgentNode,
  type NodeRun,
  type TerminalStream,
  type Workflow,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "@specflow/workflow";
import {
  createTaggedEdgeVariable,
  renderGatePrompt,
  renderHandoffPrompt,
  renderNodePrompt,
} from "./prompt-renderer";
import { DeterministicGateEvaluator, type GateEvaluator } from "./gate-evaluator";
import { TerminalEventStore } from "./terminal-store";

export interface NodeStatusEvent {
  runId: string;
  nodeId: string;
  status: NodeStatus;
  at: string;
  output?: string;
}

export interface RunStatusEvent {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  at: string;
  error?: string;
}

export interface WorkflowExecutorOptions {
  cwd?: string;
  gateEvaluator?: GateEvaluator;
  terminalEvents?: TerminalEventStore;
  agentRunner?: AgentRunner;
  onNodeStatus?: (event: NodeStatusEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
}

export type AgentRunner = (request: AgentCommandRequest) => Promise<AgentCommandResult>;

interface NodeExecutionResult {
  output: string;
  downstreamInput: string;
  chosenBranchId?: string;
}

interface PendingNodeInput {
  passthrough: string[];
  edgeValues: Record<string, string>;
}

export class WorkflowExecutor {
  readonly #cwd: string;
  readonly #gateEvaluator: GateEvaluator;
  readonly #terminalEvents: TerminalEventStore;
  readonly #agentRunner: AgentRunner;
  readonly #onNodeStatus: ((event: NodeStatusEvent) => void) | undefined;
  readonly #onRunStatus: ((event: RunStatusEvent) => void) | undefined;

  constructor(options: WorkflowExecutorOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#gateEvaluator = options.gateEvaluator ?? new DeterministicGateEvaluator();
    this.#terminalEvents = options.terminalEvents ?? new TerminalEventStore();
    this.#agentRunner = options.agentRunner ?? runAgentCommand;
    this.#onNodeStatus = options.onNodeStatus;
    this.#onRunStatus = options.onRunStatus;
  }

  get terminalEvents(): TerminalEventStore {
    return this.#terminalEvents;
  }

  async run(workflow: Workflow, initialInput = ""): Promise<WorkflowRun> {
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      workflowId: workflow.id,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: [],
      agentInvocations: [],
    };
    this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "running", at: run.startedAt! });

    try {
      const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
      const incomingEdgesByTarget = groupEdgesByTarget(workflow.edges);
      const outgoingEdgesBySource = groupEdgesBySource(workflow.edges);
      const pendingInputs = new Map<string, PendingNodeInput>();
      const queue = findEntryNodes(workflow).map((node) => node.id);
      const completedNodes = new Set<string>();

      for (const entryNode of findEntryNodes(workflow)) {
        pendingInputs.set(entryNode.id, { passthrough: [initialInput], edgeValues: {} });
      }

      while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!nodeId || completedNodes.has(nodeId)) {
          continue;
        }

        const node = nodesById.get(nodeId);
        if (!node) {
          throw new Error(`Workflow references missing node "${nodeId}".`);
        }

        const incomingEdges = incomingEdgesByTarget.get(node.id) ?? [];
        if (!isNodeReady(incomingEdges, completedNodes)) {
          queue.push(node.id);
          continue;
        }

        const pendingInput = pendingInputs.get(node.id) ?? { passthrough: [initialInput], edgeValues: {} };
        const nodeInput = pendingInput.passthrough.filter(Boolean).join("\n\n");
        const nodeResult = await this.#executeNode({
          workflow,
          run,
          node,
          input: nodeInput,
          edgeValues: pendingInput.edgeValues,
        });

        completedNodes.add(node.id);

        for (const edge of outgoingEdgesBySource.get(node.id) ?? []) {
          if (node.kind === "gate" && edge.sourcePortId !== nodeResult.chosenBranchId) {
            continue;
          }

          const targetInput = pendingInputs.get(edge.targetNodeId) ?? {
            passthrough: [],
            edgeValues: {},
          };

          if (edge.kind === "passthrough") {
            targetInput.passthrough.push(nodeResult.downstreamInput);
          } else {
            const taggedContent = await this.#resolveTaggedEdgeContent({
              workflow,
              run,
              edge,
              input: nodeResult.output,
            });
            Object.assign(targetInput.edgeValues, createTaggedEdgeVariable(edge, taggedContent));
          }

          pendingInputs.set(edge.targetNodeId, targetInput);
          queue.push(edge.targetNodeId);
        }
      }

      run.status = "done";
      run.completedAt = new Date().toISOString();
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "done", at: run.completedAt });
      return run;
    } catch (error) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      const errMsg = error instanceof Error ? error.message : String(error);
      this.#terminalEvents.append({ runId: run.id, stream: "system", chunk: errMsg });
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "failed", at: run.completedAt, error: errMsg });
      return run;
    }
  }

  async #executeNode(input: {
    workflow: Workflow;
    run: WorkflowRun;
    node: WorkflowNode;
    input: string;
    edgeValues: Record<string, string>;
  }): Promise<NodeExecutionResult> {
    const nodeRun: NodeRun = {
      id: crypto.randomUUID(),
      nodeId: input.node.id,
      status: "running",
      startedAt: new Date().toISOString(),
      input: input.input,
    };
    input.run.nodeRuns.push(nodeRun);
    this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "running", at: nodeRun.startedAt! });

    try {
      if (input.node.kind === "agent") {
        const output = await this.#executeAgentNode({
          workflow: input.workflow,
          run: input.run,
          nodeRun,
          node: input.node,
          input: input.input,
          edgeValues: input.edgeValues,
        });

        nodeRun.status = "done";
        nodeRun.output = output;
        nodeRun.completedAt = new Date().toISOString();
        this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "done", at: nodeRun.completedAt, output });
        return { output, downstreamInput: output };
      }

      const decision = await this.#gateEvaluator.evaluate({
        node: input.node,
        input: input.input,
        prompt: renderGatePrompt(input.node, input.input),
      });
      nodeRun.status = "done";
      nodeRun.output = JSON.stringify(decision);
      nodeRun.gateDecision = decision;
      nodeRun.completedAt = new Date().toISOString();
      this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "done", at: nodeRun.completedAt, output: nodeRun.output });
      return {
        output: nodeRun.output,
        downstreamInput: input.input,
        chosenBranchId: decision.branchId,
      };
    } catch (error) {
      nodeRun.status = "failed";
      nodeRun.error = error instanceof Error ? error.message : String(error);
      nodeRun.completedAt = new Date().toISOString();
      this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "failed", at: nodeRun.completedAt! });
      throw error;
    }
  }

  async #executeAgentNode(input: {
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun: NodeRun;
    node: AgentNode;
    input: string;
    edgeValues: Record<string, string>;
  }): Promise<string> {
    assertValidAgentNodeSession(input.workflow, input.node);
    const prompt = renderNodePrompt({
      node: input.node,
      input: input.input,
      edgeValues: input.edgeValues,
    });

    const invocation = this.#createInvocation({
      run: input.run,
      nodeRun: input.nodeRun,
      agentId: input.node.agentId,
      sessionId: input.node.sessionId,
      prompt,
    });
    input.nodeRun.sessionId = input.node.sessionId;
    input.nodeRun.agentInvocationId = invocation.id;

    const output = await this.#invokeAgent({
      workflow: input.workflow,
      run: input.run,
      nodeRun: input.nodeRun,
      invocation,
      agentId: input.node.agentId,
      prompt,
    });

    return output;
  }

  async #resolveTaggedEdgeContent(input: {
    workflow: Workflow;
    run: WorkflowRun;
    edge: WorkflowEdge;
    input: string;
  }): Promise<string> {
    if (input.edge.kind !== "tagged-output" || !input.edge.handoff) {
      return input.input;
    }

    assertSessionBelongsToAgent(
      input.workflow,
      input.edge.handoff.agentId,
      input.edge.handoff.sessionId,
    );

    const prompt = renderHandoffPrompt(input.edge.handoff.promptTemplate, input.input);
    const invocation = this.#createInvocation({
      run: input.run,
      agentId: input.edge.handoff.agentId,
      sessionId: input.edge.handoff.sessionId,
      prompt,
    });

    return this.#invokeAgent({
      workflow: input.workflow,
      run: input.run,
      invocation,
      agentId: input.edge.handoff.agentId,
      prompt,
    });
  }

  #createInvocation(input: {
    run: WorkflowRun;
    nodeRun?: NodeRun;
    agentId: string;
    sessionId?: string;
    prompt: string;
  }): AgentInvocation {
    const invocation: AgentInvocation = {
      id: crypto.randomUUID(),
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      agentId: input.agentId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    input.run.agentInvocations.push(invocation);
    return invocation;
  }

  async #invokeAgent(input: {
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun?: NodeRun;
    invocation: AgentInvocation;
    agentId: string;
    prompt: string;
  }): Promise<string> {
    const agent = input.workflow.agents.find((candidate) => candidate.id === input.agentId);
    if (!agent) {
      throw new Error(`Missing agent "${input.agentId}".`);
    }

    const provider = resolveAgentProvider(agent);
    const result = await this.#agentRunner({
      provider,
      prompt: input.prompt,
      cwd: this.#cwd,
      onTerminalEvent: (event) => {
        this.#appendAgentTerminalEvent({
          runId: input.run.id,
          nodeRunId: input.nodeRun?.id,
          agentInvocationId: input.invocation.id,
          event,
        });
      },
    });

    if (result.exitCode !== 0) {
      input.invocation.status = "failed";
      input.invocation.error = result.output;
      input.invocation.completedAt = new Date().toISOString();
      throw new Error(`Agent "${input.agentId}" failed with exit code ${result.exitCode}.`);
    }

    input.invocation.status = "done";
    input.invocation.output = result.output;
    input.invocation.completedAt = new Date().toISOString();
    return result.output;
  }

  #appendAgentTerminalEvent(input: {
    runId: string;
    nodeRunId?: string;
    agentInvocationId: string;
    event: AgentTerminalEvent;
  }): void {
    this.#terminalEvents.append({
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      agentInvocationId: input.agentInvocationId,
      stream: input.event.stream as TerminalStream,
      chunk: input.event.chunk,
    });
  }
}

function resolveAgentProvider(agent: AgentDefinition): AgentProvider {
  if (agent.kind === "provider") {
    return agent.provider;
  }

  return "mock";
}

function assertSessionBelongsToAgent(
  workflow: Workflow,
  agentId: string,
  sessionId: string | undefined,
): void {
  if (!sessionId) {
    return;
  }

  const session = workflow.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Handoff references missing session "${sessionId}".`);
  }

  if (session.agentId !== agentId) {
    throw new Error(
      `Handoff session "${sessionId}" belongs to agent "${session.agentId}", not "${agentId}".`,
    );
  }
}

function findEntryNodes(workflow: Workflow): WorkflowNode[] {
  const targetNodeIds = new Set(workflow.edges.map((edge) => edge.targetNodeId));
  return workflow.nodes.filter((node) => !targetNodeIds.has(node.id));
}

function groupEdgesByTarget(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    grouped.set(edge.targetNodeId, [...(grouped.get(edge.targetNodeId) ?? []), edge]);
  }
  return grouped;
}

function groupEdgesBySource(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    grouped.set(edge.sourceNodeId, [...(grouped.get(edge.sourceNodeId) ?? []), edge]);
  }
  return grouped;
}

function isNodeReady(incomingEdges: WorkflowEdge[], completedNodes: Set<string>): boolean {
  return incomingEdges.every((edge) => completedNodes.has(edge.sourceNodeId));
}
