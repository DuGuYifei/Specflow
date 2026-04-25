#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatPhaseZeroFlow } from "@specflow/shared";
import { readSpecflowKnowledge } from "@specflow/specflow";
import { createPhaseZeroGraph, validateGraph } from "@specflow/runtime";

const requiredProjectPaths = [
  ".mise.toml",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  ".specflow",
  "apps/cli",
  "packages/local-api",
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
  const graph = createPhaseZeroGraph();
  const result = validateGraph(graph);

  console.log("Specflow workflow validation");
  console.log(`graph: ${graph.name}`);
  console.log(`flow: ${formatPhaseZeroFlow()}`);
  console.log(`valid: ${String(result.valid)}`);

  for (const issue of result.issues) {
    console.log(`issue: ${issue.message}`);
  }

  if (!result.valid) {
    process.exitCode = 1;
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
    .description("Validate that the local Phase 0 repository structure is present.")
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
    .description("Validate the static Phase 0 workflow graph definition.")
    .action(validateWorkflow);

  return program;
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  await createCli().parseAsync(process.argv);
}
