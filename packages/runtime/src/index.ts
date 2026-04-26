import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentCliConfig,
  NodeExecutionMode,
  NodeExecutionState,
  Ticket,
  TicketSource,
  WorkflowArtifact,
  WorkflowArtifactKind,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun
} from "@specflow/core";
import { readSpecflowKnowledge } from "@specflow/specflow";

export const DEFAULT_AGENT_CLI = "codex";

export interface GraphDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

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
  maxRepairAttempts?: number;
  reviewerMode?: ReviewerMode;
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
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function createDefaultWorkflowGraph(): GraphDefinition {
  const nodes: WorkflowNode[] = [
    { id: "ticket", type: "ticket", label: "Ticket", status: "pending" },
    { id: "interview", type: "interview", label: "Interview", status: "pending" },
    { id: "plan", type: "plan", label: "Plan", status: "pending" },
    { id: "code-draft", type: "code_draft", label: "Code Draft", status: "pending" },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending"
    },
    { id: "repair-loop", type: "repair", label: "Repair Loop", status: "pending" },
    { id: "final-patch", type: "final_patch", label: "Final Patch", status: "pending" }
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
        id: "interview-plan",
        source: "interview",
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
      }
    ]
  };
}

export function createPhase1LocalLoopGraph(): GraphDefinition {
  const nodes: WorkflowNode[] = [
    { id: "ticket-input", type: "ticket", label: "Ticket Input", status: "pending" },
    {
      id: "spec-context",
      type: "spec_context",
      label: "Spec Context",
      status: "pending"
    },
    { id: "plan", type: "plan", label: "Plan", status: "pending" },
    { id: "code-draft", type: "code_draft", label: "Code Draft", status: "pending" },
    {
      id: "implementation-review",
      type: "implementation_reviewer",
      label: "Implementation Review",
      status: "pending"
    },
    { id: "repair-loop", type: "repair", label: "Repair Loop", status: "pending" },
    { id: "final-patch", type: "final_patch", label: "Final Patch", status: "pending" }
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
        id: "spec-context-plan",
        source: "spec-context",
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
      }
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
    return readJson<WorkflowRun>(join(this.runDirectory(runId), "run.json"));
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

  async readArtifact(
    runId: string,
    artifactId: string
  ): Promise<WorkflowArtifact> {
    return readJson<WorkflowArtifact>(
      join(this.runDirectory(runId), "artifacts", `${artifactId}.json`)
    );
  }

  private runDirectory(runId: string): string {
    return join(this.runsDirectory, runId);
  }
}

export function createTicket(input: TicketInput, now = new Date().toISOString()): Ticket {
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

export async function runLocalWorkflow(
  options: RunLocalWorkflowOptions
): Promise<WorkflowRun> {
  const now = options.now ?? (() => new Date().toISOString());
  const graph = createPhase1LocalLoopGraph();
  const store = options.store ?? new FileWorkflowRunStore(options.root);
  const maxRepairAttempts = options.maxRepairAttempts ?? 1;
  const reviewerMode = options.reviewerMode ?? "fail-once";
  const createdAt = now();
  const ticket = createTicket(options.ticket, createdAt);
  const run: WorkflowRun = {
    id: createId("run"),
    ticket,
    status: "created",
    nodes: graph.nodes,
    edges: graph.edges,
    nodeExecutions: graph.nodes.map((node) =>
      createNodeExecutionState(node, nodeExecutionMode(node.id))
    ),
    artifacts: [],
    reviews: [],
    createdAt,
    updatedAt: createdAt,
    maxRepairAttempts
  };

  await store.saveRun(run);
  run.status = "running";
  await saveRun(store, run, now);

  try {
    const ticketArtifact = await completeNode(
      run,
      store,
      "ticket-input",
      [],
      now,
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

    const planArtifact = await completeNode(
      run,
      store,
      "plan",
      [ticketArtifact.id, specContextArtifact.id],
      now,
      () =>
        createArtifact(run, "plan", "plan", "Plan", {
          content: [
            "# Placeholder Plan",
            "",
            `Ticket source: ${ticket.source}`,
            `Ticket body: ${ticket.body}`,
            "",
            "This deterministic plan is produced without calling a real agent."
          ].join("\n"),
          contentType: "text/markdown",
          now
        })
    );

    const draftArtifact = await completeNode(
      run,
      store,
      "code-draft",
      [planArtifact.id],
      now,
      () =>
        createArtifact(run, "code-draft", "code-draft", "Code Draft", {
          content: [
            "# Placeholder Code Draft",
            "",
            "No repository files are modified in Phase 1 placeholder execution."
          ].join("\n"),
          contentType: "text/markdown",
          now
        })
    );

    let latestReviewArtifact = await completeReviewNode(
      run,
      store,
      [draftArtifact.id],
      reviewerMode,
      now
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
        () =>
          createArtifact(run, "repair-loop", "repair", "Repair", {
            content: [
              "# Placeholder Repair",
              "",
              `Repair attempt: ${repairAttempts}`,
              "The repair loop is modeled without modifying repository files."
            ].join("\n"),
            contentType: "text/markdown",
            now,
            metadata: {
              repairAttempt: repairAttempts
            }
          })
      );

      latestReviewArtifact = await completeReviewNode(
        run,
        store,
        [draftArtifact.id, repairArtifact.id],
        reviewerMode,
        now
      );
      latestReview = readReviewResult(latestReviewArtifact);
    }

    const finalPatchArtifact = await completeNode(
      run,
      store,
      "final-patch",
      [latestReviewArtifact.id],
      now,
      () =>
        createArtifact(run, "final-patch", "final-patch", "Final Patch", {
          content: [
            "# Placeholder Final Patch",
            "",
            "The review loop completed. No real patch was applied."
          ].join("\n"),
          contentType: "text/markdown",
          now
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

export async function executeInMemoryStub(
  ticket: Ticket,
  graph: GraphDefinition = createDefaultWorkflowGraph()
): Promise<WorkflowRun> {
  const now = new Date().toISOString();

  return {
    id: `stub-${ticket.id}`,
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
      startedAt: now,
      completedAt: now
    })),
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

async function completeReviewNode(
  run: WorkflowRun,
  store: WorkflowRunStore,
  inputArtifactIds: string[],
  reviewerMode: ReviewerMode,
  now: () => string
): Promise<WorkflowArtifact> {
  return completeNode(run, store, "implementation-review", inputArtifactIds, now, () => {
    const repairArtifacts = run.artifacts.filter((artifact) => artifact.kind === "repair");
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

    run.reviews.push(review);

    return createArtifact(run, "implementation-review", "review-result", "Review Result", {
      content: JSON.stringify(review, null, 2),
      contentType: "application/json",
      now,
      metadata: {
        approved
      }
    });
  });
}

async function completeNode(
  run: WorkflowRun,
  store: WorkflowRunStore,
  nodeId: string,
  inputArtifactIds: string[],
  now: () => string,
  createOutput: () => WorkflowArtifact | Promise<WorkflowArtifact>
): Promise<WorkflowArtifact> {
  const execution = findExecution(run, nodeId);

  execution.status = "running";
  execution.attempts += 1;
  execution.startedAt ??= now();
  execution.completedAt = undefined;
  execution.error = undefined;
  execution.inputArtifactIds = inputArtifactIds;
  await saveRun(store, run, now);

  try {
    const artifact = await createOutput();
    run.artifacts.push(artifact);
    execution.status = "completed";
    execution.completedAt = now();
    execution.outputArtifactIds.push(artifact.id);
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

function createNodeExecutionState(
  node: WorkflowNode,
  executionMode: NodeExecutionMode
): NodeExecutionState {
  const agentCli =
    executionMode === "agent"
      ? ({
          cli: DEFAULT_AGENT_CLI,
          args: []
        } satisfies AgentCliConfig)
      : undefined;

  return {
    nodeId: node.id,
    nodeType: node.type,
    label: node.label,
    status: "pending",
    executionMode,
    agentCli,
    inputArtifactIds: [],
    outputArtifactIds: [],
    attempts: 0
  };
}

function nodeExecutionMode(nodeId: string): NodeExecutionMode {
  return nodeId === "ticket-input" || nodeId === "spec-context" ? "system" : "agent";
}

function findExecution(run: WorkflowRun, nodeId: string): NodeExecutionState {
  const execution = run.nodeExecutions.find((candidate) => candidate.nodeId === nodeId);

  if (!execution) {
    throw new Error(`Node execution not found: ${nodeId}`);
  }

  return execution;
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");

  return JSON.parse(content) as T;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
