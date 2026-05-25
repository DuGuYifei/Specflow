import {
  AgentProxySessionPool,
  type AgentCommandRequest,
  type AgentCommandResult,
  type AgentLifecycleEvent,
  type AgentTerminalEvent,
} from "@specflow/agent-proxy";
import { uuidv7, type NodeStatus } from "@specflow/shared";
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
import { buildPromptBlocksForNode } from "./prompt-blocks";
import { parseGateDecision } from "./gate-evaluator";
import { TerminalEventStore } from "./terminal-store";
import { RunInteractionStore, type RunInteractionContext } from "./interaction-store";
import { RunPauseStore } from "./pause-store";

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

export type AgentLifecycleStatusEvent = AgentLifecycleEvent & {
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
};

export interface WorkflowExecutorOptions {
  cwd?: string;
  terminalEvents?: TerminalEventStore;
  interactions?: RunInteractionStore;
  pauses?: RunPauseStore;
  agentRunner?: AgentRunner;
  onNodeStatus?: (event: NodeStatusEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
  onAgentLifecycle?: (event: AgentLifecycleStatusEvent) => void;
}

export type AgentRunner = (request: AgentCommandRequest) => Promise<AgentCommandResult>;

export interface WorkflowRunOptions {
  runId?: string;
  signal?: AbortSignal;
}

interface TransferOrigin {
  agentId: string;
  sessionId: string;
  output: string;
}

interface NodeExecutionResult {
  output: string;
  origin: TransferOrigin;
  chosenBranchId?: string;
}

interface PendingNodeInput {
  input: string[];
  edgeValues: Record<string, string>;
  origin?: TransferOrigin;
}

interface QueuedNode {
  nodeId: string;
  traversal: number;
}

class WorkflowCancelledError extends Error {
  constructor() {
    super("Workflow run cancelled.");
    this.name = "WorkflowCancelledError";
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WorkflowCancelledError();
}

export class WorkflowExecutor {
  readonly #cwd: string;
  readonly #terminalEvents: TerminalEventStore;
  readonly #interactions: RunInteractionStore;
  readonly #pauses: RunPauseStore | undefined;
  readonly #agentRunnerOverride: AgentRunner | undefined;
  readonly #onNodeStatus: ((event: NodeStatusEvent) => void) | undefined;
  readonly #onRunStatus: ((event: RunStatusEvent) => void) | undefined;
  readonly #onAgentLifecycle: ((event: AgentLifecycleStatusEvent) => void) | undefined;
  readonly #forkCounts = new Map<string, number>();

  constructor(options: WorkflowExecutorOptions = {}) {
    this.#cwd = options.cwd ?? process.cwd();
    this.#terminalEvents = options.terminalEvents ?? new TerminalEventStore();
    this.#interactions = options.interactions ?? new RunInteractionStore();
    this.#pauses = options.pauses;
    this.#agentRunnerOverride = options.agentRunner;
    this.#onNodeStatus = options.onNodeStatus;
    this.#onRunStatus = options.onRunStatus;
    this.#onAgentLifecycle = options.onAgentLifecycle;
  }

  get terminalEvents(): TerminalEventStore {
    return this.#terminalEvents;
  }

  get interactions(): RunInteractionStore {
    return this.#interactions;
  }

  async run(workflow: Workflow, initialInput = "", options: WorkflowRunOptions = {}): Promise<WorkflowRun> {
    const sessionPool = this.#agentRunnerOverride ? undefined : new AgentProxySessionPool({ root: this.#cwd });
    const agentRunner = this.#agentRunnerOverride ?? ((request: AgentCommandRequest) => sessionPool!.run(request));
    const run: WorkflowRun = {
      id: options.runId ?? uuidv7(),
      workflowId: workflow.id,
      status: "running",
      startedAt: new Date().toISOString(),
      nodeRuns: [],
      agentInvocations: [],
    };
    this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "running", at: run.startedAt! });

    try {
      throwIfCancelled(options.signal);
      const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
      const incomingEdgesByTarget = groupEdgesByTarget(workflow.edges);
      const outgoingEdgesBySource = groupEdgesBySource(workflow.edges);
      const pendingInputs = new Map<string, PendingNodeInput>();
      const queue: QueuedNode[] = findEntryNodes(workflow).map((node) => ({ nodeId: node.id, traversal: 0 }));
      const rerunnableGateIds = findRerunnableGateIds(workflow);
      const recurringBranchEdgeIds = findRecurringBranchEdgeIds(workflow);
      const completedNodes = new Set<string>();
      const completedExecutions = new Set<string>();
      const skippedNodes = new Set<string>();
      const inactiveEdges = new Set<string>();
      const branchTraversals = new Map<string, number>();

      for (const entryNode of findEntryNodes(workflow)) {
        pendingInputs.set(executionKey(entryNode.id, 0), { input: [initialInput], edgeValues: {} });
      }

      while (queue.length > 0) {
        throwIfCancelled(options.signal);
        const queued = queue.shift();
        if (!queued) continue;
        const key = executionKey(queued.nodeId, queued.traversal);
        if (completedExecutions.has(key) || (queued.traversal === 0 && skippedNodes.has(queued.nodeId))) continue;
        const node = nodesById.get(queued.nodeId);
        if (!node) throw new Error(`Workflow references missing node "${queued.nodeId}".`);

        const incomingEdges = incomingEdgesByTarget.get(node.id) ?? [];
        if (queued.traversal === 0 && !isNodeReady(incomingEdges, completedNodes, inactiveEdges)) {
          queue.push(queued);
          continue;
        }

        const outgoingEdges = outgoingEdgesBySource.get(node.id) ?? [];
        const executableNode = node.kind === "gate"
          ? gateWithAvailableBranches(node, branchTraversals)
          : node;
        const pending = pendingInputs.get(key) ?? { input: [], edgeValues: {} };
        const nodeResult = await this.#executeNode({
          agentRunner,
          workflow,
          run,
          node: executableNode,
          input: pending.input.filter(Boolean).join("\n\n"),
          edgeValues: pending.edgeValues,
          origin: pending.origin,
          signal: options.signal,
        });
        if (node.kind === "agent" && node.pauseAfterRun) {
          if (!this.#pauses) {
            throw new Error(`Node "${node.id}" requires interactive pause support.`);
          }
          const nodeRun = run.nodeRuns.find((candidate) => candidate.nodeId === node.id);
          if (!nodeRun) {
            throw new Error(`Node "${node.id}" has no execution record to pause.`);
          }
          const pausedAt = new Date().toISOString();
          const continuation = this.#pauses.waitForContinuation({
            runId: run.id,
            nodeId: node.id,
            specflowSessionId: node.sessionId,
            agentServerId: resolveAgentServerId(workflow.agents.find((agent) => agent.id === node.agentId)!),
            pausedAt,
          }, async (prompt) => {
            const invocation = this.#createInvocation({
              run,
              agentId: node.agentId,
              sessionId: node.sessionId,
              nodeRun,
              prompt,
            });
            return this.#invokeAgent({
              workflow,
              agentRunner,
              run,
              invocation,
              agentId: node.agentId,
              prompt,
              signal: options.signal,
            });
          }, options.signal);
          this.#onNodeStatus?.({
            runId: run.id,
            nodeId: node.id,
            status: "paused",
            at: pausedAt,
            output: nodeResult.output,
          });
          const intervenedOutput = await continuation;
          if (intervenedOutput !== undefined) {
            nodeResult.output = intervenedOutput;
            nodeResult.origin.output = intervenedOutput;
          }
          nodeRun.status = "done";
          nodeRun.output = nodeResult.output;
          nodeRun.completedAt = new Date().toISOString();
          this.#onNodeStatus?.({
            runId: run.id,
            nodeId: node.id,
            status: "done",
            at: nodeRun.completedAt,
            output: nodeResult.output,
          });
        }
        completedExecutions.add(key);
        if (queued.traversal === 0) completedNodes.add(node.id);

        let selectedEdges = outgoingEdges;
        if (node.kind === "gate") {
          const branchKey = `${node.id}:${nodeResult.chosenBranchId}`;
          branchTraversals.set(branchKey, (branchTraversals.get(branchKey) ?? 0) + 1);
          selectedEdges = outgoingEdges.filter((edge) => edge.sourcePortId === nodeResult.chosenBranchId);
          const supportsRerun = rerunnableGateIds.has(node.id);
          const continuesLoop = selectedEdges.some((edge) => recurringBranchEdgeIds.has(edge.id));
          if ((!supportsRerun || !continuesLoop) && queued.traversal === 0) {
            for (const edge of outgoingEdges) {
              if (edge.sourcePortId === nodeResult.chosenBranchId) continue;
              deactivateEdgeAndDependents({
                edge,
                inactiveEdges,
                skippedNodes,
                incomingEdgesByTarget,
                outgoingEdgesBySource,
                queue,
              });
            }
          }
        }
        for (const edge of selectedEdges) {
          if (inactiveEdges.has(edge.id)) continue;
          const targetTraversal = edge.loopback ? queued.traversal + 1 : queued.traversal;
          const targetKey = executionKey(edge.targetNodeId, targetTraversal);
          const target = pendingInputs.get(targetKey) ?? { input: [], edgeValues: {} };
          if (edge.kind === "gate-input") {
            target.input.push(nodeResult.origin.output);
            target.origin = nodeResult.origin;
          } else if (edge.kind === "tagged-output") {
            const taggedContent = await this.#resolveTaggedEdgeContent({
              workflow,
              agentRunner,
              run,
              edge,
              origin: nodeResult.origin,
              signal: options.signal,
            });
            Object.assign(target.edgeValues, createTaggedEdgeVariable(edge, taggedContent));
          }
          pendingInputs.set(targetKey, target);
          queue.push({ nodeId: edge.targetNodeId, traversal: targetTraversal });
        }
      }

      run.status = "done";
      run.completedAt = new Date().toISOString();
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: "done", at: run.completedAt });
      return run;
    } catch (error) {
      const cancelled = error instanceof WorkflowCancelledError || options.signal?.aborted;
      run.status = cancelled ? "cancelled" : "failed";
      run.completedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      this.#terminalEvents.append({ runId: run.id, stream: "system", chunk: message });
      this.#onRunStatus?.({ runId: run.id, workflowId: workflow.id, status: run.status, at: run.completedAt, error: message });
      return run;
    } finally {
      await sessionPool?.closeAll();
    }
  }

  async #executeNode(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    node: WorkflowNode;
    input: string;
    edgeValues: Record<string, string>;
    origin?: TransferOrigin;
    signal?: AbortSignal;
  }): Promise<NodeExecutionResult> {
    throwIfCancelled(input.signal);
    const nodeRun: NodeRun = {
      id: uuidv7(),
      nodeId: input.node.id,
      status: "running",
      startedAt: new Date().toISOString(),
      input: input.input,
    };
    input.run.nodeRuns.push(nodeRun);
    this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "running", at: nodeRun.startedAt! });

    try {
      if (input.node.kind === "agent") {
        const output = await this.#executeAgentNode({ ...input, node: input.node, nodeRun });
        nodeRun.status = input.node.pauseAfterRun ? "paused" : "done";
        nodeRun.output = output;
        if (!input.node.pauseAfterRun) {
          nodeRun.completedAt = new Date().toISOString();
          this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "done", at: nodeRun.completedAt, output });
        }
        return {
          output,
          origin: { agentId: input.node.agentId, sessionId: input.node.sessionId, output },
        };
      }
      if (!input.origin) throw new Error(`Gate node "${input.node.id}" requires one upstream step output.`);
      const prompt = renderGatePrompt(input.node, input.origin.output);
      const forkSessionId = this.#nextForkSessionId(input.origin.sessionId);
      const invocation = this.#createInvocation({
        run: input.run,
        nodeRun,
        agentId: input.origin.agentId,
        sessionId: forkSessionId,
        parentSessionId: input.origin.sessionId,
        prompt,
      });
      const output = await this.#invokeAgent({
        workflow: input.workflow,
        agentRunner: input.agentRunner,
        run: input.run,
        nodeRun,
        invocation,
        agentId: input.origin.agentId,
        prompt,
        forkFromSessionId: input.origin.sessionId,
        signal: input.signal,
      });
      const decision = parseGateDecision(input.node, output);
      nodeRun.status = "done";
      nodeRun.output = output;
      nodeRun.gateDecision = decision;
      nodeRun.sessionId = invocation.sessionId;
      nodeRun.agentInvocationId = invocation.id;
      nodeRun.completedAt = new Date().toISOString();
      this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "done", at: nodeRun.completedAt, output });
      return { output, origin: input.origin, chosenBranchId: decision.branchId };
    } catch (error) {
      nodeRun.status = "failed";
      nodeRun.error = error instanceof Error ? error.message : String(error);
      nodeRun.completedAt = new Date().toISOString();
      this.#onNodeStatus?.({ runId: input.run.id, nodeId: input.node.id, status: "failed", at: nodeRun.completedAt });
      throw error;
    }
  }

  async #executeAgentNode(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun: NodeRun;
    node: AgentNode;
    input: string;
    edgeValues: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<string> {
    assertValidAgentNodeSession(input.workflow, input.node);
    const prompt = renderNodePrompt({ node: input.node, input: input.input, edgeValues: input.edgeValues });
    const promptBlocks = await buildPromptBlocksForNode({ node: input.node, prompt, cwd: this.#cwd });
    const invocation = this.#createInvocation({
      run: input.run,
      nodeRun: input.nodeRun,
      agentId: input.node.agentId,
      sessionId: input.node.sessionId,
      prompt,
    });
    input.nodeRun.sessionId = input.node.sessionId;
    input.nodeRun.agentInvocationId = invocation.id;
    return this.#invokeAgent({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      nodeRun: input.nodeRun,
      invocation,
      agentId: input.node.agentId,
      prompt,
      promptBlocks,
      signal: input.signal,
    });
  }

  async #resolveTaggedEdgeContent(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    edge: WorkflowEdge;
    origin: TransferOrigin;
    signal?: AbortSignal;
  }): Promise<string> {
    if (input.edge.kind !== "tagged-output" || !input.edge.handoff) return input.origin.output;
    const prompt = renderHandoffPrompt(input.edge.handoff.promptTemplate, input.origin.output);
    const invocation = this.#createInvocation({
      run: input.run,
      agentId: input.origin.agentId,
      sessionId: input.origin.sessionId,
      edgeId: input.edge.id,
      prompt,
    });
    return this.#invokeAgent({
      workflow: input.workflow,
      agentRunner: input.agentRunner,
      run: input.run,
      invocation,
      agentId: input.origin.agentId,
      prompt,
      signal: input.signal,
    });
  }

  #nextForkSessionId(sourceSessionId: string): string {
    const next = (this.#forkCounts.get(sourceSessionId) ?? 0) + 1;
    this.#forkCounts.set(sourceSessionId, next);
    return `${sourceSessionId}-fork-${String(next).padStart(2, "0")}`;
  }

  #createInvocation(input: {
    run: WorkflowRun;
    nodeRun?: NodeRun;
    agentId: string;
    sessionId?: string;
    parentSessionId?: string;
    edgeId?: string;
    prompt: string;
  }): AgentInvocation {
    const invocation: AgentInvocation = {
      id: uuidv7(),
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      nodeId: input.nodeRun?.nodeId,
      edgeId: input.edgeId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      prompt: input.prompt,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    input.run.agentInvocations.push(invocation);
    return invocation;
  }

  async #invokeAgent(input: {
    agentRunner: AgentRunner;
    workflow: Workflow;
    run: WorkflowRun;
    nodeRun?: NodeRun;
    invocation: AgentInvocation;
    agentId: string;
    prompt: string;
    promptBlocks?: AgentCommandRequest["promptBlocks"];
    forkFromSessionId?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    throwIfCancelled(input.signal);
    const agent = input.workflow.agents.find((candidate) => candidate.id === input.agentId);
    if (!agent) throw new Error(`Missing agent "${input.agentId}".`);
    const result = await input.agentRunner({
      agentServerId: resolveAgentServerId(agent),
      prompt: input.prompt,
      promptBlocks: input.promptBlocks,
      cwd: this.#cwd,
      runId: input.run.id,
      workflowSessionId: input.invocation.sessionId,
      forkFromWorkflowSessionId: input.forkFromSessionId,
      signal: input.signal,
      onTerminalEvent: (event) => this.#appendAgentTerminalEvent({
        runId: input.run.id,
        nodeRunId: input.nodeRun?.id,
        agentInvocationId: input.invocation.id,
        event,
      }),
      onLifecycleEvent: (event) => this.#onAgentLifecycle?.({
        ...event,
        runId: input.run.id,
        nodeRunId: input.nodeRun?.id,
        nodeId: input.invocation.nodeId,
        edgeId: input.invocation.edgeId,
        agentInvocationId: input.invocation.id,
        agentId: input.agentId,
      }),
      onPermissionRequest: (request) => this.#interactions.requestPermission(
        this.#interactionContext(input, resolveAgentServerId(agent)),
        request,
      ),
      onElicitationRequest: (request) => this.#interactions.requestElicitation(
        this.#interactionContext(input, resolveAgentServerId(agent)),
        request,
      ),
      onElicitationComplete: (notification) => this.#interactions.recordElicitationComplete(
        this.#interactionContext(input, resolveAgentServerId(agent)),
        notification,
      ),
    });
    if (input.signal?.aborted) throw new WorkflowCancelledError();
    input.invocation.agentServerId = result.agentServerId;
    input.invocation.acpSessionId = result.sessionId;
    input.invocation.sessionId = result.workflowSessionId
      ?? (input.forkFromSessionId && result.sessionForked !== true
        ? input.forkFromSessionId
        : input.invocation.sessionId);
    input.invocation.parentSessionId = result.sessionForked === true
      ? result.parentWorkflowSessionId ?? input.forkFromSessionId
      : undefined;
    input.invocation.acpSessionForked = result.sessionForked;
    input.invocation.acpSupportsLoadSession = Boolean(result.initializeResponse?.agentCapabilities?.loadSession);
    input.invocation.acpSupportsResumeSession = Boolean(result.initializeResponse?.agentCapabilities?.sessionCapabilities?.resume);
    input.invocation.acpSupportsForkSession = Boolean(result.initializeResponse?.agentCapabilities?.sessionCapabilities?.fork);
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

  #interactionContext(input: {
    run: WorkflowRun;
    nodeRun?: NodeRun;
    invocation: AgentInvocation;
    agentId: string;
  }, agentServerId: string): RunInteractionContext {
    return {
      runId: input.run.id,
      nodeRunId: input.nodeRun?.id,
      nodeId: input.invocation.nodeId,
      edgeId: input.invocation.edgeId,
      agentInvocationId: input.invocation.id,
      agentId: input.agentId,
      agentServerId,
      specflowSessionId: input.invocation.sessionId,
      acpSessionId: input.invocation.acpSessionId,
    };
  }
}

function resolveAgentServerId(agent: AgentDefinition): string {
  return agent.kind === "external" ? agent.agentServerId : "unconfigured";
}

function findEntryNodes(workflow: Workflow): WorkflowNode[] {
  const targetNodeIds = new Set(workflow.edges.filter((edge) => !edge.loopback).map((edge) => edge.targetNodeId));
  return workflow.nodes.filter((node) => !targetNodeIds.has(node.id));
}

function groupEdgesByTarget(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) grouped.set(edge.targetNodeId, [...(grouped.get(edge.targetNodeId) ?? []), edge]);
  return grouped;
}

function groupEdgesBySource(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const grouped = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) grouped.set(edge.sourceNodeId, [...(grouped.get(edge.sourceNodeId) ?? []), edge]);
  return grouped;
}

function findRerunnableGateIds(workflow: Workflow): Set<string> {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = groupEdgesBySource(workflow.edges.filter((edge) => !edge.loopback));
  const result = new Set<string>();
  for (const loopback of workflow.edges.filter((edge) => edge.loopback)) {
    const pending: Array<{ nodeId: string; gates: Set<string> }> = [{
      nodeId: loopback.targetNodeId,
      gates: new Set(),
    }];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.nodeId}:${[...current.gates].sort().join(",")}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const gates = new Set(current.gates);
      if (nodesById.get(current.nodeId)?.kind === "gate") gates.add(current.nodeId);
      if (current.nodeId === loopback.sourceNodeId) {
        for (const gateId of gates) result.add(gateId);
        continue;
      }
      for (const edge of outgoing.get(current.nodeId) ?? []) {
        pending.push({ nodeId: edge.targetNodeId, gates });
      }
    }
    if (nodesById.get(loopback.sourceNodeId)?.kind === "gate") {
      result.add(loopback.sourceNodeId);
    }
  }
  return result;
}

function findRecurringBranchEdgeIds(workflow: Workflow): Set<string> {
  const outgoing = groupEdgesBySource(workflow.edges);
  const result = new Set<string>();
  for (const edge of workflow.edges.filter((candidate) => candidate.sourcePortId)) {
    const pending = [edge.targetNodeId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const downstream = outgoing.get(nodeId) ?? [];
      if (downstream.some((candidate) => candidate.loopback)) {
        result.add(edge.id);
        break;
      }
      pending.push(...downstream.filter((candidate) => !candidate.loopback).map((candidate) => candidate.targetNodeId));
    }
  }
  return result;
}

function isNodeReady(
  incomingEdges: WorkflowEdge[],
  completedNodes: Set<string>,
  inactiveEdges: Set<string>,
): boolean {
  return incomingEdges.every((edge) => edge.loopback || inactiveEdges.has(edge.id) || completedNodes.has(edge.sourceNodeId));
}

function deactivateEdgeAndDependents(input: {
  edge: WorkflowEdge;
  inactiveEdges: Set<string>;
  skippedNodes: Set<string>;
  incomingEdgesByTarget: Map<string, WorkflowEdge[]>;
  outgoingEdgesBySource: Map<string, WorkflowEdge[]>;
  queue: QueuedNode[];
}): void {
  if (input.inactiveEdges.has(input.edge.id)) return;
  input.inactiveEdges.add(input.edge.id);
  const targetNodeId = input.edge.targetNodeId;
  const incoming = input.incomingEdgesByTarget.get(targetNodeId) ?? [];
  if (incoming.length > 0 && incoming.every((edge) => input.inactiveEdges.has(edge.id))) {
    input.skippedNodes.add(targetNodeId);
    for (const outgoing of input.outgoingEdgesBySource.get(targetNodeId) ?? []) {
      deactivateEdgeAndDependents({ ...input, edge: outgoing });
    }
    return;
  }
  input.queue.push({ nodeId: targetNodeId, traversal: 0 });
}

function executionKey(nodeId: string, traversal: number): string {
  return `${nodeId}:${traversal}`;
}

function gateWithAvailableBranches(node: Extract<WorkflowNode, { kind: "gate" }>, traversals: Map<string, number>): Extract<WorkflowNode, { kind: "gate" }> {
  const branches = node.branches.filter((branch) =>
    (traversals.get(`${node.id}:${branch.id}`) ?? 0) < (branch.maxTraversals ?? 1));
  if (branches.length === 0) {
    throw new Error(`Gate node "${node.id}" has exhausted all branch traversal limits.`);
  }
  return { ...node, branches };
}
