import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentCliConfig,
  NodeSessionDecision,
  NodeExecutionMode,
  NodeExecutionState,
  Ticket,
  TicketSource,
  WorkflowControlDecision,
  WorkflowArtifact,
  WorkflowArtifactKind,
  WorkflowDefinition,
  WorkflowDefinitionRef,
  WorkflowDefinitionSource,
  WorkflowNode,
  WorkflowRun,
  WorkflowSession
} from "@specflow/core";
import { readSpecflowKnowledge } from "@specflow/specflow";

export const DEFAULT_AGENT_CLI = "codex";

export type GraphDefinition = WorkflowDefinition;

export interface GraphValidationIssue {
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  issues: GraphValidationIssue[];
}

export interface NodeExecutionContext {
  ticket: Ticket;
  artifacts: WorkflowArtifact[];
}

export interface NodeExecutionResult {
  status: "completed" | "blocked";
  artifacts: WorkflowArtifact[];
  message: string;
}

export interface NodeExecutor {
  type: WorkflowNode["type"];
  execute(
    node: WorkflowNode,
    context: NodeExecutionContext
  ): Promise<NodeExecutionResult>;
}

export interface TicketInput {
  body: string;
  source: TicketSource;
  title?: string;
  sourcePath?: string;
}

export type ReviewerMode = "pass" | "fail-once" | "always-fail";

export interface RunLocalWorkflowOptions {
  root: string;
  ticket: TicketInput;
  workflowDefinition?: WorkflowDefinition;
  workflowDefinitionPath?: string;
  workflowDefinitionSource?: WorkflowDefinitionSource;
  maxRepairAttempts?: number;
  reviewerMode?: ReviewerMode;
  stepDelayMs?: number;
  store?: WorkflowRunStore;
  now?: () => string;
}

export interface CreateLocalWorkflowRunOptions {
  root: string;
  ticket: TicketInput;
  workflowDefinition?: WorkflowDefinition;
  workflowDefinitionPath?: string;
  workflowDefinitionSource?: WorkflowDefinitionSource;
  maxRepairAttempts?: number;
  store?: WorkflowRunStore;
  now?: () => string;
}

export interface ExecuteLocalWorkflowRunOptions {
  root: string;
  runId: string;
  reviewerMode?: ReviewerMode;
  stepDelayMs?: number;
  maxRepairAttempts?: number;
  store?: WorkflowRunStore;
  now?: () => string;
}

export interface WorkflowRunStore {
  saveRun(run: WorkflowRun): Promise<void>;
  readRun(runId: string): Promise<WorkflowRun>;
  listRuns(): Promise<WorkflowRun[]>;
  writeArtifact(artifact: WorkflowArtifact): Promise<void>;
  readArtifact(runId: string, artifactId: string): Promise<WorkflowArtifact>;
}

export function validateGraph(graph: GraphDefinition): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ message: `Duplicate node id: ${node.id}`, nodeId: node.id });
    }
    nodeIds.add(node.id);
  }

  if (graph.entryNodeId && !nodeIds.has(graph.entryNodeId)) {
    issues.push({
      message: `Entry node does not exist: ${graph.entryNodeId}`,
      nodeId: graph.entryNodeId
    });
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        message: `Edge source does not exist: ${edge.source}`,
        edgeId: edge.id
      });
    }

    if (!nodeIds.has(edge.target)) {
      issues.push({
        message: `Edge target does not exist: ${edge.target}`,
        edgeId: edge.id
      });
    }

    if (edge.type === "control_scope") {
      const sourceNode = graph.nodes.find((node) => node.id === edge.source);

      if (!sourceNode?.control) {
        issues.push({
          message: `Control scope edge source has no control scope: ${edge.source}`,
          nodeId: edge.source,
          edgeId: edge.id
        });
      } else if (!sourceNode.control.managedNodeIds.includes(edge.target)) {
        issues.push({
          message: `Control scope edge target is not managed by source: ${edge.target}`,
          nodeId: edge.source,
          edgeId: edge.id
        });
      }
    }
  }

  for (const node of graph.nodes) {
    const policy = node.session;

    if (node.agentCli) {
      if (
        typeof node.agentCli.cli !== "string" ||
        node.agentCli.cli.trim().length === 0
      ) {
        issues.push({
          message: `Agent CLI requires a command: ${node.id}`,
          nodeId: node.id
        });
      }

      if (
        !Array.isArray(node.agentCli.args) ||
        node.agentCli.args.some((argument) => typeof argument !== "string")
      ) {
        issues.push({
          message: `Agent CLI args must be strings: ${node.id}`,
          nodeId: node.id
        });
      }
    }

    if (
      policy &&
      policy.mode !== "none" &&
      policy.mode !== "ai_decides" &&
      !policy.groupId
    ) {
      issues.push({
        message: `Session policy requires a group id: ${node.id}`,
        nodeId: node.id
      });
    }

    if (policy?.mode === "ai_decides") {
      if (!policy.groupId) {
        issues.push({
          message: `AI-decided session policy requires a group id: ${node.id}`,
          nodeId: node.id
        });
      }

      if (!policy.controllerNodeId || !nodeIds.has(policy.controllerNodeId)) {
        issues.push({
          message: `AI-decided session policy has missing controller: ${node.id}`,
          nodeId: node.id
        });
      } else {
        const controller = graph.nodes.find(
          (candidate) => candidate.id === policy.controllerNodeId
        );

        if (!controller?.control?.decisionKinds.includes("session")) {
          issues.push({
            message: `Session controller cannot make session decisions: ${policy.controllerNodeId}`,
            nodeId: policy.controllerNodeId
          });
        }

        if (!controller?.control?.managedNodeIds.includes(node.id)) {
          issues.push({
            message: `Session controller does not manage node: ${node.id}`,
            nodeId: node.id
          });
        }
      }
    }

    if (node.control) {
      for (const managedNodeId of node.control.managedNodeIds) {
        if (!nodeIds.has(managedNodeId)) {
          issues.push({
            message: `Managed node does not exist: ${managedNodeId}`,
            nodeId: node.id
          });
        }
      }
    }

    if (node.role === "director" && !node.control) {
      issues.push({
        message: `Director node requires a control scope: ${node.id}`,
        nodeId: node.id
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function createDefaultWorkflowGraph(): GraphDefinition {
  const managedNodeIds = [
    "plan",
    "code-draft",
    "implementation-review",
    "repair-loop",
    "final-patch"
  ];
  const reviewManagedNodeIds = ["repair-loop", "final-patch"];
  const nodes: WorkflowNode[] = [
    {
      id: "ticket",
      type: "ticket",
      label: "Ticket",
      status: "pending",
      role: "input",
      session: { mode: "none" }
    },
    {
      id: "interview",
      type: "interview",
      label: "Interview",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "fresh",
        groupId: "discovery",
        label: "Discovery"
      }
    },
    {
      id: "session-director",
      type: "workflow_director",
      label: "Session Director",
      status: "pending",
      role: "director",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "fresh",
        groupId: "direction",
        label: "Direction"
      },
      control: {
        managedNodeIds,
        decisionKinds: ["session"]
      }
    },
    {
      id: "plan",
      type: "plan",
      label: "Plan",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "code-draft",
      type: "code_draft",
      label: "Code Draft",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending",
      role: "reviewer",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "review",
        label: "Review",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      },
      control: {
        managedNodeIds: reviewManagedNodeIds,
        decisionKinds: ["review"]
      }
    },
    {
      id: "repair-loop",
      type: "repair",
      label: "Repair Loop",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      }
    },
    {
      id: "final-patch",
      type: "final_patch",
      label: "Final Patch",
      status: "pending",
      role: "output",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    }
  ];

  return {
    id: "default-workflow-intent",
    name: "Default Workflow Intent",
    nodes,
    edges: [
      {
        id: "ticket-interview",
        source: "ticket",
        target: "interview",
        type: "control_flow"
      },
      {
        id: "interview-session-director",
        source: "interview",
        target: "session-director",
        type: "control_flow"
      },
      {
        id: "session-director-plan",
        source: "session-director",
        target: "plan",
        type: "control_flow"
      },
      {
        id: "plan-code-draft",
        source: "plan",
        target: "code-draft",
        type: "control_flow"
      },
      {
        id: "code-draft-review",
        source: "code-draft",
        target: "implementation-review",
        type: "control_flow"
      },
      {
        id: "review-repair",
        source: "implementation-review",
        target: "repair-loop",
        type: "review_loop"
      },
      {
        id: "repair-review",
        source: "repair-loop",
        target: "implementation-review",
        type: "review_loop"
      },
      {
        id: "review-final-patch",
        source: "implementation-review",
        target: "final-patch",
        type: "control_flow"
      },
      ...managedNodeIds.map((nodeId) => ({
        id: `session-director-manages-${nodeId}`,
        source: "session-director",
        target: nodeId,
        type: "control_scope" as const,
        label: "manages session"
      })),
      ...reviewManagedNodeIds.map((nodeId) => ({
        id: `implementation-review-controls-${nodeId}`,
        source: "implementation-review",
        target: nodeId,
        type: "control_scope" as const,
        label: "reviews outcome"
      }))
    ]
  };
}

export function createPhase1LocalLoopGraph(): GraphDefinition {
  const managedNodeIds = [
    "plan",
    "code-draft",
    "implementation-review",
    "repair-loop",
    "final-patch"
  ];
  const reviewManagedNodeIds = ["repair-loop", "final-patch"];
  const nodes: WorkflowNode[] = [
    {
      id: "ticket-input",
      type: "ticket",
      label: "Ticket Input",
      status: "pending",
      role: "input",
      session: { mode: "none" }
    },
    {
      id: "spec-context",
      type: "spec_context",
      label: "Spec Context",
      status: "pending",
      role: "context",
      session: { mode: "none" }
    },
    {
      id: "session-director",
      type: "workflow_director",
      label: "Session Director",
      status: "pending",
      role: "director",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "fresh",
        groupId: "direction",
        label: "Direction"
      },
      control: {
        managedNodeIds,
        decisionKinds: ["session"]
      }
    },
    {
      id: "plan",
      type: "plan",
      label: "Plan",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "code-draft",
      type: "code_draft",
      label: "Code Draft",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending",
      role: "reviewer",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "review",
        label: "Review",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      },
      control: {
        managedNodeIds: reviewManagedNodeIds,
        decisionKinds: ["review"]
      }
    },
    {
      id: "repair-loop",
      type: "repair",
      label: "Repair Loop",
      status: "pending",
      role: "worker",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director",
        newSessionOnLoop: true
      }
    },
    {
      id: "final-patch",
      type: "final_patch",
      label: "Final Patch",
      status: "pending",
      role: "output",
      agentCli: createDefaultAgentCliConfig(),
      session: {
        mode: "ai_decides",
        groupId: "implementation",
        label: "Implementation",
        controllerNodeId: "session-director"
      }
    }
  ];

  return {
    id: "phase-1-local-loop",
    name: "Phase 1 Local Loop",
    nodes,
    edges: [
      {
        id: "ticket-spec-context",
        source: "ticket-input",
        target: "spec-context",
        type: "control_flow"
      },
      {
        id: "spec-context-session-director",
        source: "spec-context",
        target: "session-director",
        type: "control_flow"
      },
      {
        id: "session-director-plan",
        source: "session-director",
        target: "plan",
        type: "control_flow"
      },
      {
        id: "plan-code-draft",
        source: "plan",
        target: "code-draft",
        type: "control_flow"
      },
      {
        id: "code-draft-review",
        source: "code-draft",
        target: "implementation-review",
        type: "control_flow"
      },
      {
        id: "review-repair",
        source: "implementation-review",
        target: "repair-loop",
        type: "review_loop"
      },
      {
        id: "repair-review",
        source: "repair-loop",
        target: "implementation-review",
        type: "review_loop"
      },
      {
        id: "review-final-patch",
        source: "implementation-review",
        target: "final-patch",
        type: "control_flow"
      },
      ...managedNodeIds.map((nodeId) => ({
        id: `session-director-manages-${nodeId}`,
        source: "session-director",
        target: nodeId,
        type: "control_scope" as const,
        label: "manages session"
      })),
      ...reviewManagedNodeIds.map((nodeId) => ({
        id: `implementation-review-controls-${nodeId}`,
        source: "implementation-review",
        target: nodeId,
        type: "control_scope" as const,
        label: "reviews outcome"
      }))
    ]
  };
}

export class FileWorkflowRunStore implements WorkflowRunStore {
  private readonly runsDirectory: string;

  constructor(private readonly root: string) {
    this.runsDirectory = join(root, ".specflow", "runs");
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    const directory = this.runDirectory(run.id);

    await mkdir(directory, { recursive: true });
    await writeJson(join(directory, "run.json"), run);
  }

  async readRun(runId: string): Promise<WorkflowRun> {
    return normalizeWorkflowRun(
      await readJson<WorkflowRun>(join(this.runDirectory(runId), "run.json"))
    );
  }

  async listRuns(): Promise<WorkflowRun[]> {
    try {
      const entries = await readdir(this.runsDirectory, { withFileTypes: true });
      const runs = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.readRun(entry.name))
      );

      return runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async writeArtifact(artifact: WorkflowArtifact): Promise<void> {
    const directory = join(this.runDirectory(artifact.runId), "artifacts");

    await mkdir(directory, { recursive: true });
    await writeJson(join(directory, `${artifact.id}.json`), artifact);
  }

  async readArtifact(runId: string, artifactId: string): Promise<WorkflowArtifact> {
    return readJson<WorkflowArtifact>(
      join(this.runDirectory(runId), "artifacts", `${artifactId}.json`)
    );
  }

  private runDirectory(runId: string): string {
    return join(this.runsDirectory, runId);
  }
}

export function createTicket(
  input: TicketInput,
  now = new Date().toISOString()
): Ticket {
  return {
    id: createId("ticket"),
    body: input.body,
    title: input.title,
    source: input.source,
    sourcePath: input.sourcePath,
    createdAt: now,
    description: input.body
  };
}

export async function createLocalWorkflowRun(
  options: CreateLocalWorkflowRunOptions
): Promise<WorkflowRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const graph = options.workflowDefinition ?? createPhase1LocalLoopGraph();
  const validation = validateGraph(graph);

  if (!validation.valid) {
    throw new Error(
      `Workflow definition is invalid: ${formatValidationIssues(validation.issues)}`
    );
  }

  const workflowDefinitionSource =
    options.workflowDefinitionSource ??
    (options.workflowDefinition ? "repository" : "builtin");
  const store = options.store ?? new FileWorkflowRunStore(options.root);
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  const createdAt = now();
  const ticket = createTicket(options.ticket, createdAt);
  const run: WorkflowRun = {
    id: createId("run"),
    workflowDefinition: createWorkflowDefinitionRef(
      graph,
      workflowDefinitionSource,
      options.workflowDefinitionPath
    ),
    ticket,
    status: "created",
    nodes: graph.nodes,
    edges: graph.edges,
    nodeExecutions: graph.nodes.map((node) =>
      createNodeExecutionState(node, nodeExecutionMode(node))
    ),
    sessions: [],
    controlDecisions: [],
    artifacts: [],
    reviews: [],
    createdAt,
    updatedAt: createdAt,
    maxRepairAttempts
  };

  await store.saveRun(run);
  return run;
}

export async function executeLocalWorkflowRun(
  options: ExecuteLocalWorkflowRunOptions
): Promise<WorkflowRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const store = options.store ?? new FileWorkflowRunStore(options.root);
  const reviewerMode = options.reviewerMode ?? "fail-once";
  const stepDelayMs = options.stepDelayMs ?? 0;
  const run = await store.readRun(options.runId);
  const ticket = run.ticket;
  const maxRepairAttempts = options.maxRepairAttempts ?? run.maxRepairAttempts;
  run.maxRepairAttempts = maxRepairAttempts;

  run.status = "running";
  await saveRun(store, run, now);

  try {
    const ticketArtifact = await completeNode(
      run,
      store,
      "ticket-input",
      [],
      now,
      stepDelayMs,
      () =>
        createArtifact(run, "ticket-input", "ticket", "Ticket", {
          content: JSON.stringify(ticket, null, 2),
          contentType: "application/json",
          now
        })
    );

    const specContextArtifact = await completeNode(
      run,
      store,
      "spec-context",
      [ticketArtifact.id],
      now,
      stepDelayMs,
      async () => {
        const knowledge = await readSpecflowKnowledge(options.root);
        return createArtifact(run, "spec-context", "spec-context", "Spec Context", {
          content: JSON.stringify({ files: knowledge.files }, null, 2),
          contentType: "application/json",
          now,
          metadata: {
            fileCount: knowledge.files.length
          }
        });
      }
    );

    const sessionDecisionArtifact = await completeSessionDirectorNode(
      run,
      store,
      [ticketArtifact.id, specContextArtifact.id],
      now,
      stepDelayMs
    );

    const planArtifact = await completeNode(
      run,
      store,
      "plan",
      [ticketArtifact.id, specContextArtifact.id, sessionDecisionArtifact.id],
      now,
      stepDelayMs,
      (session) =>
        createArtifact(run, "plan", "plan", "Plan", {
          content: [
            "# Placeholder Plan",
            "",
            `Ticket source: ${ticket.source}`,
            `Ticket body: ${ticket.body}`,
            `Session: ${session?.label ?? "none"}`,
            "",
            "This deterministic plan is produced without calling a real agent."
          ].join("\n"),
          contentType: "text/markdown",
          now,
          metadata: sessionMetadata(session)
        })
    );

    const draftArtifact = await completeNode(
      run,
      store,
      "code-draft",
      [planArtifact.id],
      now,
      stepDelayMs,
      (session) =>
        createArtifact(run, "code-draft", "code-draft", "Code Draft", {
          content: [
            "# Placeholder Code Draft",
            "",
            `Session: ${session?.label ?? "none"}`,
            "No repository files are modified in Phase 1 placeholder execution."
          ].join("\n"),
          contentType: "text/markdown",
          now,
          metadata: sessionMetadata(session)
        })
    );

    let latestReviewArtifact = await completeReviewNode(
      run,
      store,
      [draftArtifact.id],
      reviewerMode,
      now,
      stepDelayMs
    );
    let latestReview = readReviewResult(latestReviewArtifact);
    let repairAttempts = 0;

    while (!latestReview.approved) {
      if (repairAttempts >= maxRepairAttempts) {
        skipNode(run, "repair-loop", now);
        skipNode(run, "final-patch", now);
        run.status = "failed";
        run.completedAt = now();
        await saveRun(store, run, now);
        return run;
      }

      repairAttempts += 1;
      const repairArtifact = await completeNode(
        run,
        store,
        "repair-loop",
        [latestReviewArtifact.id],
        now,
        stepDelayMs,
        (session) =>
          createArtifact(run, "repair-loop", "repair", "Repair", {
            content: [
              "# Placeholder Repair",
              "",
              `Repair attempt: ${repairAttempts}`,
              `Session: ${session?.label ?? "none"}`,
              "The repair loop is modeled without modifying repository files."
            ].join("\n"),
            contentType: "text/markdown",
            now,
            metadata: {
              repairAttempt: repairAttempts,
              ...sessionMetadata(session)
            }
          })
      );

      latestReviewArtifact = await completeReviewNode(
        run,
        store,
        [draftArtifact.id, repairArtifact.id],
        reviewerMode,
        now,
        stepDelayMs
      );
      latestReview = readReviewResult(latestReviewArtifact);
    }

    const finalPatchArtifact = await completeNode(
      run,
      store,
      "final-patch",
      [latestReviewArtifact.id],
      now,
      stepDelayMs,
      (session) =>
        createArtifact(run, "final-patch", "final-patch", "Final Patch", {
          content: [
            "# Placeholder Final Patch",
            "",
            `Session: ${session?.label ?? "none"}`,
            "The review loop completed. No real patch was applied."
          ].join("\n"),
          contentType: "text/markdown",
          now,
          metadata: sessionMetadata(session)
        })
    );

    run.finalArtifactId = finalPatchArtifact.id;
    run.status = "completed";
    run.completedAt = now();
    await saveRun(store, run, now);
    return run;
  } catch (error) {
    run.status = "failed";
    run.completedAt = now();
    run.updatedAt = run.completedAt;
    await store.saveRun(run);
    throw error;
  }
}

export async function runLocalWorkflow(
  options: RunLocalWorkflowOptions
): Promise<WorkflowRun> {
  const run = await createLocalWorkflowRun(options);

  return executeLocalWorkflowRun({
    root: options.root,
    runId: run.id,
    reviewerMode: options.reviewerMode,
    stepDelayMs: options.stepDelayMs,
    maxRepairAttempts: options.maxRepairAttempts,
    store: options.store,
    now: options.now
  });
}

export async function executeInMemoryStub(
  ticket: Ticket,
  graph: GraphDefinition = createDefaultWorkflowGraph()
): Promise<WorkflowRun> {
  const now = new Date().toISOString();

  return {
    id: `stub-${ticket.id}`,
    workflowDefinition: createWorkflowDefinitionRef(graph, "builtin"),
    ticket,
    status: "completed",
    nodes: graph.nodes.map((node) => ({ ...node, status: "completed" })),
    edges: graph.edges,
    nodeExecutions: graph.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: "completed",
      executionMode: "system",
      inputArtifactIds: [],
      outputArtifactIds: ["stub-artifact"],
      attempts: 1,
      sessionIds: [],
      startedAt: now,
      completedAt: now
    })),
    sessions: [],
    controlDecisions: [],
    artifacts: [
      {
        id: "stub-artifact",
        runId: `stub-${ticket.id}`,
        nodeId: "final-patch",
        kind: "context",
        title: "Local execution stub",
        content: "No real agent execution runs in placeholder mode.",
        contentType: "text/plain",
        createdAt: now
      }
    ],
    reviews: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    finalArtifactId: "stub-artifact",
    maxRepairAttempts: 0
  };
}

async function completeSessionDirectorNode(
  run: WorkflowRun,
  store: WorkflowRunStore,
  inputArtifactIds: string[],
  now: () => string,
  stepDelayMs: number
): Promise<WorkflowArtifact> {
  return completeNode(
    run,
    store,
    "session-director",
    inputArtifactIds,
    now,
    stepDelayMs,
    (session) => {
      const decision = createSessionControlDecision(run, now);
      run.controlDecisions.push(decision);

      return createArtifact(
        run,
        "session-director",
        "control-decision",
        "Session Decision",
        {
          content: JSON.stringify(decision, null, 2),
          contentType: "application/json",
          now,
          metadata: {
            managedNodes: decision.targetNodeIds.length,
            ...sessionMetadata(session)
          }
        }
      );
    }
  );
}

async function completeReviewNode(
  run: WorkflowRun,
  store: WorkflowRunStore,
  inputArtifactIds: string[],
  reviewerMode: ReviewerMode,
  now: () => string,
  stepDelayMs: number
): Promise<WorkflowArtifact> {
  return completeNode(
    run,
    store,
    "implementation-review",
    inputArtifactIds,
    now,
    stepDelayMs,
    (session) => {
      const repairArtifacts = run.artifacts.filter(
        (artifact) => artifact.kind === "repair"
      );
      const approved =
        reviewerMode === "pass" ||
        (reviewerMode === "fail-once" && repairArtifacts.length > 0);
      const review = {
        reviewerNodeId: "implementation-review",
        approved,
        summary: approved
          ? "Placeholder review approved the current draft."
          : "Placeholder review requires a repair attempt.",
        requiredChanges: approved ? [] : ["Run the placeholder repair node."]
      };
      const decision = createReviewControlDecision(run, approved, now);

      run.reviews.push(review);
      run.controlDecisions.push(decision);

      return createArtifact(
        run,
        "implementation-review",
        "review-result",
        "Review Result",
        {
          content: JSON.stringify(review, null, 2),
          contentType: "application/json",
          now,
          metadata: {
            approved,
            decisionId: decision.id,
            ...sessionMetadata(session)
          }
        }
      );
    }
  );
}

async function completeNode(
  run: WorkflowRun,
  store: WorkflowRunStore,
  nodeId: string,
  inputArtifactIds: string[],
  now: () => string,
  stepDelayMs: number,
  createOutput: (
    session: WorkflowSession | undefined
  ) => WorkflowArtifact | Promise<WorkflowArtifact>
): Promise<WorkflowArtifact> {
  const execution = findExecution(run, nodeId);
  const session = resolveNodeSession(run, nodeId, execution, now);

  execution.status = "running";
  execution.attempts += 1;
  execution.startedAt ??= now();
  execution.completedAt = undefined;
  execution.error = undefined;
  execution.inputArtifactIds = inputArtifactIds;
  if (session) {
    attachSessionToExecution(session, execution, nodeId, now);
  }
  await saveRun(store, run, now);
  await sleep(stepDelayMs);

  try {
    const artifact = await createOutput(session);
    run.artifacts.push(artifact);
    execution.status = "completed";
    execution.completedAt = now();
    execution.outputArtifactIds.push(artifact.id);
    if (session && !session.artifactIds.includes(artifact.id)) {
      session.artifactIds.push(artifact.id);
      session.updatedAt = now();
    }
    await store.writeArtifact(artifact);
    await saveRun(store, run, now);

    return artifact;
  } catch (error) {
    execution.status = "failed";
    execution.error = formatError(error);
    execution.completedAt = now();
    await saveRun(store, run, now);
    throw error;
  }
}

function createArtifact(
  run: WorkflowRun,
  nodeId: string,
  kind: WorkflowArtifactKind,
  title: string,
  options: {
    content: string;
    contentType: WorkflowArtifact["contentType"];
    now: () => string;
    metadata?: WorkflowArtifact["metadata"];
  }
): WorkflowArtifact {
  return {
    id: createId("artifact"),
    runId: run.id,
    nodeId,
    kind,
    title,
    content: options.content,
    contentType: options.contentType,
    createdAt: options.now(),
    metadata: options.metadata
  };
}

function createSessionControlDecision(
  run: WorkflowRun,
  now: () => string
): WorkflowControlDecision {
  const controller = findNode(run, "session-director");
  const managedNodeIds = controller.control?.managedNodeIds ?? [];
  const sessionDecisions: NodeSessionDecision[] = managedNodeIds.map((nodeId) => {
    const target = findNode(run, nodeId);
    const sessionGroupId = target.session?.groupId ?? nodeId;
    const openNewSession =
      nodeId === "plan" ||
      nodeId === "implementation-review" ||
      nodeId === "repair-loop";

    return {
      targetNodeId: nodeId,
      sessionGroupId,
      openNewSession,
      reason: openNewSession
        ? "Mock director starts a focused session for this work boundary."
        : "Mock director keeps this node in the active session group."
    };
  });

  return {
    id: createId("decision"),
    runId: run.id,
    controllerNodeId: controller.id,
    kind: "session",
    targetNodeIds: managedNodeIds,
    summary:
      "Mock Session Director chooses implementation/review session boundaries without calling a real agent.",
    sessionDecisions,
    createdAt: now()
  };
}

function createReviewControlDecision(
  run: WorkflowRun,
  approved: boolean,
  now: () => string
): WorkflowControlDecision {
  const controller = findNode(run, "implementation-review");
  const intendedTargetNodeId = approved ? "final-patch" : "repair-loop";
  const managedNodeIds = controller.control?.managedNodeIds ?? [intendedTargetNodeId];
  const targetNodeIds = managedNodeIds.includes(intendedTargetNodeId)
    ? [intendedTargetNodeId]
    : managedNodeIds;

  return {
    id: createId("decision"),
    runId: run.id,
    controllerNodeId: controller.id,
    kind: "review",
    targetNodeIds,
    summary: approved
      ? "Mock reviewer routes approved work toward final patch."
      : "Mock reviewer routes rejected work toward repair.",
    createdAt: now()
  };
}

function resolveNodeSession(
  run: WorkflowRun,
  nodeId: string,
  execution: NodeExecutionState,
  now: () => string
): WorkflowSession | undefined {
  const node = findNode(run, nodeId);
  const policy = node.session;

  if (!policy || policy.mode === "none" || !policy.groupId || !execution.agentCli) {
    return undefined;
  }

  const decision =
    policy.mode === "ai_decides" ? findLatestSessionDecision(run, nodeId) : undefined;
  const shouldStartFresh =
    policy.mode === "fresh" ||
    decision?.openNewSession === true ||
    Boolean(policy.newSessionOnLoop && execution.attempts > 0);

  if (!shouldStartFresh) {
    const existing = findReusableSession(run, policy.groupId, execution.agentCli);

    if (existing) {
      existing.updatedAt = now();
      return existing;
    }
  }

  const createdAt = now();
  const session: WorkflowSession = {
    id: createId("session"),
    runId: run.id,
    groupId: policy.groupId,
    label: policy.label ?? policy.groupId,
    status: "open",
    agentCli: execution.agentCli,
    controlledByNodeId: policy.controllerNodeId,
    nodeIds: [],
    artifactIds: [],
    createdAt,
    updatedAt: createdAt
  };

  run.sessions.push(session);
  return session;
}

function findReusableSession(
  run: WorkflowRun,
  groupId: string,
  agentCli: AgentCliConfig
): WorkflowSession | undefined {
  return [...run.sessions]
    .reverse()
    .find(
      (session) =>
        session.status === "open" &&
        session.groupId === groupId &&
        session.agentCli.cli === agentCli.cli
    );
}

function findLatestSessionDecision(
  run: WorkflowRun,
  nodeId: string
): NodeSessionDecision | undefined {
  return [...run.controlDecisions]
    .reverse()
    .flatMap((decision) => decision.sessionDecisions ?? [])
    .find((decision) => decision.targetNodeId === nodeId);
}

function attachSessionToExecution(
  session: WorkflowSession,
  execution: NodeExecutionState,
  nodeId: string,
  now: () => string
): void {
  execution.sessionId = session.id;
  if (!execution.sessionIds.includes(session.id)) {
    execution.sessionIds.push(session.id);
  }
  if (!session.nodeIds.includes(nodeId)) {
    session.nodeIds.push(nodeId);
  }
  session.updatedAt = now();
}

function sessionMetadata(session: WorkflowSession | undefined): Record<string, string> {
  if (!session) {
    return {};
  }

  return {
    sessionId: session.id,
    sessionGroupId: session.groupId,
    sessionLabel: session.label
  };
}

function createNodeExecutionState(
  node: WorkflowNode,
  executionMode: NodeExecutionMode
): NodeExecutionState {
  const agentCli = executionMode === "agent" ? agentCliForNode(node) : undefined;

  return {
    nodeId: node.id,
    nodeType: node.type,
    label: node.label,
    status: "pending",
    executionMode,
    agentCli,
    inputArtifactIds: [],
    outputArtifactIds: [],
    attempts: 0,
    sessionIds: []
  };
}

function nodeExecutionMode(node: WorkflowNode): NodeExecutionMode {
  return node.type === "ticket" || node.type === "spec_context" ? "system" : "agent";
}

function agentCliForNode(node: WorkflowNode): AgentCliConfig {
  const agentCli = node.agentCli ?? createDefaultAgentCliConfig();

  return {
    cli: agentCli.cli,
    args: [...agentCli.args]
  };
}

function createDefaultAgentCliConfig(): AgentCliConfig {
  return {
    cli: DEFAULT_AGENT_CLI,
    args: []
  };
}

function findNode(run: WorkflowRun, nodeId: string): WorkflowNode {
  const node = run.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new Error(`Workflow node not found: ${nodeId}`);
  }

  return node;
}

function findExecution(run: WorkflowRun, nodeId: string): NodeExecutionState {
  const execution = run.nodeExecutions.find((candidate) => candidate.nodeId === nodeId);

  if (!execution) {
    throw new Error(`Node execution not found: ${nodeId}`);
  }

  return execution;
}

function normalizeWorkflowRun(run: WorkflowRun): WorkflowRun {
  run.workflowDefinition ??= createWorkflowDefinitionRef(
    {
      id: "legacy-run-snapshot",
      name: "Legacy Run Snapshot",
      nodes: run.nodes,
      edges: run.edges
    },
    "builtin"
  );
  run.sessions ??= [];
  run.controlDecisions ??= [];

  for (const execution of run.nodeExecutions) {
    execution.sessionIds ??= execution.sessionId ? [execution.sessionId] : [];
  }

  return run;
}

function createWorkflowDefinitionRef(
  definition: WorkflowDefinition,
  source: WorkflowDefinitionSource,
  path?: string
): WorkflowDefinitionRef {
  return {
    id: definition.id,
    name: definition.name,
    source,
    version: definition.version,
    path
  };
}

function formatValidationIssues(issues: GraphValidationIssue[]): string {
  return issues.map((issue) => issue.message).join("; ");
}

function skipNode(run: WorkflowRun, nodeId: string, now: () => string): void {
  const execution = findExecution(run, nodeId);

  if (execution.status === "pending") {
    execution.status = "skipped";
    execution.completedAt = now();
  }
}

function readReviewResult(artifact: WorkflowArtifact): {
  approved: boolean;
} {
  return JSON.parse(artifact.content) as { approved: boolean };
}

async function saveRun(
  store: WorkflowRunStore,
  run: WorkflowRun,
  now: () => string
): Promise<void> {
  run.updatedAt = now();
  await store.saveRun(run);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function readJson<T>(path: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const content = await readFile(path, "utf8");

      return JSON.parse(content) as T;
    } catch (error) {
      if (!isRetriableReadJsonError(error)) {
        throw error;
      }

      lastError = error;
      await sleep(5);
    }
  }

  throw lastError;
}

function isRetriableReadJsonError(error: unknown): boolean {
  return (
    (isNodeError(error) && error.code === "ENOENT") || error instanceof SyntaxError
  );
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
