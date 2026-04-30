import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_CLI,
  FileWorkflowRunStore,
  createLocalWorkflowRun,
  createDefaultWorkflowGraph,
  createPhase1LocalLoopGraph,
  executeLocalWorkflowRun,
  runLocalWorkflow,
  validateGraph
} from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots.length = 0;
});

describe("validateGraph", () => {
  it("accepts the default workflow graph", () => {
    expect(validateGraph(createDefaultWorkflowGraph())).toEqual({
      valid: true,
      issues: []
    });
  });

  it("rejects broken session controllers and control scopes", () => {
    const graph = createDefaultWorkflowGraph();
    const plan = graph.nodes.find((node) => node.id === "plan");
    const director = graph.nodes.find((node) => node.id === "session-director");

    if (!plan || !director?.control) {
      throw new Error("Expected default graph nodes.");
    }

    plan.session = {
      mode: "ai_decides",
      groupId: "missing-group",
      controllerNodeId: "missing-director"
    };
    plan.agentCli = {
      cli: "",
      args: []
    };
    director.control.managedNodeIds = director.control.managedNodeIds.filter(
      (nodeId) => nodeId !== "code-draft"
    );

    const result = validateGraph(graph);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toContain(
      "AI-decided session policy has missing controller: plan"
    );
    expect(result.issues.map((issue) => issue.message)).toContain(
      "Control scope edge target is not managed by source: code-draft"
    );
    expect(result.issues.map((issue) => issue.message)).toContain(
      "Agent CLI requires a command: plan"
    );
    expect(result.issues.map((issue) => issue.message)).toContain(
      "Session policy references missing group: missing-group"
    );
  });
});

describe("runLocalWorkflow", () => {
  it("persists run state and ticket artifacts to .specflow/runs", async () => {
    const root = await createRepositoryRoot();
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Implement the local loop.", source: "inline" },
      reviewerMode: "pass"
    });
    const store = new FileWorkflowRunStore(root);
    const storedRun = await store.readRun(run.id);
    const ticketArtifact = storedRun.artifacts.find(
      (artifact) => artifact.kind === "ticket"
    );

    expect(storedRun.status).toBe("completed");
    expect(ticketArtifact).toBeDefined();
    expect(
      await readFile(
        join(
          root,
          ".specflow",
          "runs",
          run.id,
          "artifacts",
          `${ticketArtifact?.id}.json`
        ),
        "utf8"
      )
    ).toContain("Implement the local loop.");
  });

  it("records system nodes without agent CLI and agent nodes with codex", async () => {
    const root = await createRepositoryRoot();
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Check agent defaults.", source: "inline" },
      reviewerMode: "pass"
    });
    const ticketExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "ticket-input"
    );
    const specExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "spec-context"
    );
    const planExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "plan"
    );

    expect(ticketExecution?.executionMode).toBe("system");
    expect(ticketExecution?.agentCli).toBeUndefined();
    expect(specExecution?.executionMode).toBe("system");
    expect(specExecution?.agentCli).toBeUndefined();
    expect(planExecution?.executionMode).toBe("agent");
    expect(planExecution?.agentCli?.cli).toBe(DEFAULT_AGENT_CLI);
  });

  it("creates runs from an explicit workflow definition reference", async () => {
    const root = await createRepositoryRoot();
    const definition = createPhase1LocalLoopGraph();
    definition.id = "custom-local-loop";
    definition.name = "Custom Local Loop";
    definition.version = "0.2.0";
    const planNode = definition.nodes.find((node) => node.id === "plan");

    if (!planNode) {
      throw new Error("Expected plan node.");
    }

    planNode.agentCli = {
      cli: "claude",
      args: ["--headless"]
    };

    const run = await createLocalWorkflowRun({
      root,
      ticket: { body: "Bind the selected definition.", source: "inline" },
      workflowDefinition: definition,
      workflowDefinitionPath: "workflows/custom.workflow.json",
      workflowDefinitionSource: "repository"
    });

    expect(run.workflowDefinition).toEqual({
      id: "custom-local-loop",
      name: "Custom Local Loop",
      source: "repository",
      version: "0.2.0",
      path: "workflows/custom.workflow.json"
    });
    expect(run.sessionGroups.map((group) => group.id)).toEqual([
      "direction",
      "implementation",
      "review"
    ]);
    expect(run.nodes.map((node) => node.id)).toEqual(
      definition.nodes.map((node) => node.id)
    );
    expect(
      run.nodeExecutions.find((execution) => execution.nodeId === "plan")?.agentCli
    ).toEqual({
      cli: "claude",
      args: ["--headless"]
    });
  });

  it("rejects invalid workflow definitions before persisting a run", async () => {
    const root = await createRepositoryRoot();
    const definition = createPhase1LocalLoopGraph();
    definition.entryNodeId = "missing-entry";

    await expect(
      createLocalWorkflowRun({
        root,
        ticket: { body: "Reject invalid definitions.", source: "inline" },
        workflowDefinition: definition
      })
    ).rejects.toThrow(
      "Workflow definition is invalid: Entry node does not exist: missing-entry"
    );
  });

  it("records session director decisions and session reuse boundaries", async () => {
    const root = await createRepositoryRoot();
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Model session boundaries.", source: "inline" }
    });
    const planExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "plan"
    );
    const draftExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "code-draft"
    );
    const reviewExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "implementation-review"
    );
    const repairExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "repair-loop"
    );
    const finalExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "final-patch"
    );

    const sessionDecision = run.controlDecisions.find(
      (decision) => decision.kind === "session"
    );
    const reviewDecisions = run.controlDecisions.filter(
      (decision) => decision.kind === "review"
    );

    expect(sessionDecision?.controllerNodeId).toBe("session-director");
    expect(
      sessionDecision?.sessionDecisions?.map((decision) => decision.targetNodeId)
    ).toEqual([
      "plan",
      "code-draft",
      "implementation-review",
      "repair-loop",
      "final-patch"
    ]);
    expect(reviewDecisions.map((decision) => decision.targetNodeIds)).toEqual([
      ["repair-loop"],
      ["final-patch"]
    ]);
    expect(planExecution?.sessionId).toBeDefined();
    expect(draftExecution?.sessionId).toBe(planExecution?.sessionId);
    expect(repairExecution?.sessionId).not.toBe(planExecution?.sessionId);
    expect(finalExecution?.sessionId).toBe(repairExecution?.sessionId);
    expect(reviewExecution?.sessionIds).toHaveLength(2);
    expect(run.sessions.map((session) => session.groupId)).toEqual([
      "direction",
      "implementation",
      "review",
      "implementation",
      "review"
    ]);
  });

  it("creates spec context from generic .specflow Markdown files", async () => {
    const root = await createRepositoryRoot({
      "custom/note.md": "# Custom Knowledge\n\nThis is not a hardcoded phase file."
    });
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Read generic knowledge.", source: "inline" },
      reviewerMode: "pass"
    });
    const specArtifact = run.artifacts.find(
      (artifact) => artifact.kind === "spec-context"
    );

    expect(specArtifact?.content).toContain("custom/note.md");
    expect(specArtifact?.content).toContain("This is not a hardcoded phase file.");
  });

  it("runs one placeholder repair before approval by default", async () => {
    const root = await createRepositoryRoot();
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Exercise repair loop.", source: "inline" }
    });
    const repairExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "repair-loop"
    );

    expect(run.status).toBe("completed");
    expect(repairExecution?.status).toBe("completed");
    expect(repairExecution?.attempts).toBe(1);
    expect(run.reviews.map((review) => review.approved)).toEqual([false, true]);
  });

  it("fails when reviewer never approves before max repair attempts", async () => {
    const root = await createRepositoryRoot();
    const run = await runLocalWorkflow({
      root,
      ticket: { body: "Never approve.", source: "inline" },
      reviewerMode: "always-fail",
      maxRepairAttempts: 1
    });
    const finalPatchExecution = run.nodeExecutions.find(
      (execution) => execution.nodeId === "final-patch"
    );

    expect(run.status).toBe("failed");
    expect(finalPatchExecution?.status).toBe("skipped");
    expect(run.reviews.map((review) => review.approved)).toEqual([false, false]);
  });

  it("persists running state during progressive execution", async () => {
    const root = await createRepositoryRoot();
    const store = new FileWorkflowRunStore(root);
    const createdRun = await createLocalWorkflowRun({
      root,
      ticket: { body: "Observe running state.", source: "inline" },
      store
    });
    const execution = executeLocalWorkflowRun({
      root,
      runId: createdRun.id,
      stepDelayMs: 50,
      reviewerMode: "pass",
      store
    });

    const runningRun = await waitForStoredRun(store, createdRun.id, (candidate) => {
      const ticketExecution = candidate.nodeExecutions.find(
        (nodeExecution) => nodeExecution.nodeId === "ticket-input"
      );

      return candidate.status === "running" && ticketExecution?.status === "running";
    });
    const ticketExecution = runningRun.nodeExecutions.find(
      (nodeExecution) => nodeExecution.nodeId === "ticket-input"
    );

    expect(runningRun.status).toBe("running");
    expect(ticketExecution?.status).toBe("running");

    await execution;
  });
});

async function createRepositoryRoot(
  files: Record<string, string> = {}
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-runtime-"));
  tempRoots.push(root);

  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  await mkdir(join(root, ".specflow"), { recursive: true });
  await writeFile(join(root, ".specflow", "project.md"), "# Test Project\n", "utf8");

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, ".specflow", relativePath);
    const directory = fullPath.slice(0, fullPath.lastIndexOf("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }

  return root;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForStoredRun(
  store: FileWorkflowRunStore,
  runId: string,
  predicate: (run: Awaited<ReturnType<FileWorkflowRunStore["readRun"]>>) => boolean
): Promise<Awaited<ReturnType<FileWorkflowRunStore["readRun"]>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const run = await store.readRun(runId);

    if (predicate(run)) {
      return run;
    }

    await wait(10);
  }

  throw new Error("Timed out waiting for stored run state.");
}
