import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_CLI,
  FileWorkflowRunStore,
  createDefaultWorkflowGraph,
  runLocalWorkflow,
  validateGraph
} from "./index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("validateGraph", () => {
  it("accepts the default workflow graph", () => {
    expect(validateGraph(createDefaultWorkflowGraph())).toEqual({
      valid: true,
      issues: []
    });
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
        join(root, ".specflow", "runs", run.id, "artifacts", `${ticketArtifact?.id}.json`),
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
