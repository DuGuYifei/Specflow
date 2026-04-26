#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatDefaultWorkflowFlow } from "@specflow/shared";
import { readSpecflowKnowledge } from "@specflow/specflow";
import {
  FileWorkflowRunStore,
  createDefaultWorkflowGraph,
  runLocalWorkflow,
  validateGraph
} from "@specflow/runtime";
import type { WorkflowRun } from "@specflow/core";

const requiredProjectPaths = [
  ".mise.toml",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".specflow",
  "apps/cli",
  "packages/server",
  "packages/ui",
  "packages/core",
  "packages/runtime",
  "packages/agent",
  "packages/specflow",
  "packages/shared",
  "packages/config"
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  let current = start;

  while (true) {
    if (
      (await pathExists(join(current, "pnpm-workspace.yaml"))) &&
      (await pathExists(join(current, ".specflow")))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current || parse(current).root === current) {
      throw new Error("Specflow repository root not found.");
    }
    current = parent;
  }
}

async function readRootPackage(root: string): Promise<{ packageManager?: string }> {
  const content = await readFile(join(root, "package.json"), "utf8");
  return JSON.parse(content) as { packageManager?: string };
}

async function runDoctor(): Promise<void> {
  const root = await findRepositoryRoot();
  const results = await Promise.all(
    requiredProjectPaths.map(async (relativePath) => ({
      relativePath,
      exists: await pathExists(join(root, relativePath))
    }))
  );
  const missing = results.filter((result) => !result.exists);
  const rootPackage = await readRootPackage(root);

  console.log("Specflow doctor");
  console.log(`root: ${root}`);
  console.log(`package manager: ${rootPackage.packageManager ?? "unknown"}`);

  for (const result of results) {
    console.log(`${result.exists ? "ok" : "missing"} ${result.relativePath}`);
  }

  if (missing.length > 0) {
    process.exitCode = 1;
  }
}

async function readSpec(): Promise<void> {
  const root = await findRepositoryRoot();
  const knowledge = await readSpecflowKnowledge(root);

  console.log("Specflow knowledge");

  if (knowledge.files.length === 0) {
    console.log("No .specflow Markdown files found.");
    return;
  }

  for (const file of knowledge.files) {
    console.log(`\n# ${file.path}`);
    console.log(file.content.trim());
  }
}

async function validateWorkflow(): Promise<void> {
  const graph = createDefaultWorkflowGraph();
  const result = validateGraph(graph);

  console.log("Specflow workflow validation");
  console.log(`graph: ${graph.name}`);
  console.log(`flow: ${formatDefaultWorkflowFlow()}`);
  console.log(`valid: ${String(result.valid)}`);

  for (const issue of result.issues) {
    console.log(`issue: ${issue.message}`);
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}

async function runWorkflow(options: {
  ticket?: string;
  ticketFile?: string;
}): Promise<void> {
  if (options.ticket && options.ticketFile) {
    console.error("error: use either --ticket or --ticket-file, not both.");
    process.exitCode = 1;
    return;
  }

  if (!options.ticket && !options.ticketFile) {
    console.error("error: provide --ticket or --ticket-file.");
    process.exitCode = 1;
    return;
  }

  const root = await findRepositoryRoot();
  const ticket = options.ticketFile
    ? {
        body: await readFile(resolve(options.ticketFile), "utf8"),
        source: "file" as const,
        sourcePath: resolve(options.ticketFile)
      }
    : {
        body: options.ticket ?? "",
        source: "inline" as const
      };
  const run = await runLocalWorkflow({ root, ticket });

  printRunSummary("Specflow workflow run", run);
}

async function listWorkflowRuns(): Promise<void> {
  const root = await findRepositoryRoot();
  const store = new FileWorkflowRunStore(root);
  const runs = await store.listRuns();

  console.log("Specflow workflow runs");

  if (runs.length === 0) {
    console.log("No workflow runs found.");
    return;
  }

  for (const run of runs) {
    console.log(`${run.id} ${run.status} ${run.createdAt} ${run.updatedAt}`);
  }
}

async function showWorkflowRun(runId: string): Promise<void> {
  const root = await findRepositoryRoot();
  const store = new FileWorkflowRunStore(root);
  const run = await store.readRun(runId);

  printRunSummary("Specflow workflow run", run);
}

function printRunSummary(title: string, run: WorkflowRun): void {
  console.log(title);
  console.log(`run: ${run.id}`);
  console.log(`status: ${run.status}`);
  console.log(`ticket source: ${run.ticket.source}`);
  console.log(`created: ${run.createdAt}`);
  console.log(`updated: ${run.updatedAt}`);

  if (run.finalArtifactId) {
    console.log(`final artifact: ${run.finalArtifactId}`);
  }

  console.log("nodes:");
  for (const execution of run.nodeExecutions) {
    const mode =
      execution.executionMode === "agent"
        ? `agent:${execution.agentCli?.cli ?? "unknown"}`
        : "system";
    console.log(
      `- ${execution.nodeId} ${execution.status} ${mode} attempts:${execution.attempts} outputs:${execution.outputArtifactIds.length}`
    );
  }

  console.log("artifacts:");
  for (const artifact of run.artifacts) {
    console.log(`- ${artifact.id} ${artifact.kind} ${artifact.nodeId}`);
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("specflow")
    .description("Continuous Coding workflow foundation for Specflow.")
    .version("0.0.0");

  program
    .command("doctor")
    .description("Validate that the local repository structure is present.")
    .action(runDoctor);

  const spec = program.command("spec").description("Read Specflow project knowledge.");

  spec
    .command("read")
    .description("Print the repository-level Specflow project spec.")
    .action(readSpec);

  const workflow = program
    .command("workflow")
    .description("Inspect placeholder workflow definitions.");

  workflow
    .command("validate")
    .description("Validate the static default workflow graph definition.")
    .action(validateWorkflow);

  workflow
    .command("run")
    .description("Run the Phase 1 local placeholder workflow.")
    .option("--ticket <ticket>", "Inline ticket body.")
    .option("--ticket-file <path>", "Path to a ticket Markdown or text file.")
    .action(runWorkflow);

  workflow
    .command("list")
    .description("List local workflow runs.")
    .action(listWorkflowRuns);

  workflow
    .command("show")
    .description("Show a local workflow run summary.")
    .argument("<runId>", "Workflow run id.")
    .action(showWorkflowRun);

  return program;
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  await createCli().parseAsync(process.argv);
}
