#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  executeAgentFlowDoc,
  loadAgentFlowFile,
  prepareCanvasRun,
  startSpecflowServer,
  type AgentFlowDoc,
  type RunInputVariable,
} from "@specflow/server";

interface RunCliOptions {
  file: string;
  yes: boolean;
  initialInput: string;
  values: Record<string, string>;
}

const args = Bun.argv.slice(2);

try {
  if (args[0] === "run") {
    await runWorkflowCommand(args.slice(1));
  } else {
    await serveCommand();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function serveCommand(): Promise<void> {
  const server = await startSpecflowServer();
  let stopping = false;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\nStopping Specflow (${signal})...`);
    server.stop();
    process.exit(0);
  };

  process.once("SIGINT",  () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGHUP",  () => stop("SIGHUP"));
  process.once("exit",    () => {
    if (!stopping) server.stop();
  });

  await new Promise<void>(() => {
    // Keep the CLI process alive until a signal arrives.
  });
}

async function runWorkflowCommand(args: string[]): Promise<void> {
  const opts = parseRunArgs(args);
  const filePath = resolve(process.cwd(), opts.file);
  const doc = await loadAgentFlowFile(filePath);
  const normalizedValues = normalizeVariableValues(doc, opts.values);
  const prepared = prepareCanvasRun(doc, {
    initialInput: opts.initialInput,
    variableValues: normalizedValues,
  });

  printRunPlan(filePath, doc, prepared.variables);

  if (prepared.missingVariables.length > 0) {
    console.log("\nMissing required variables:");
    for (const v of prepared.missingVariables) {
      console.log(`  - ${v.name}${v.description ? ` (${v.description})` : ""}`);
    }
    console.log("\nPass them with -Dname=value, for example: -Dvalue=1 or -Dspecflow_value=1");
    process.exitCode = 2;
    return;
  }

  if (!opts.yes) {
    const confirmed = await confirm("Run this workflow?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  console.log("\nStarting run...");
  const nodeTitles = new Map(
    prepared.doc.nodes
      .filter((n) => n.kind === "step" || n.kind === "gate")
      .map((n) => [n.id, `${n.num} ${n.title}`]),
  );

  const run = await executeAgentFlowDoc({
    doc: prepared.doc,
    initialInput: prepared.initialInput,
    cwd: process.cwd(),
    onRunStatus(event) {
      if (event.status === "failed" && event.error) {
        console.log(`Run failed: ${event.error}`);
      }
    },
    onNodeStatus(event) {
      const label = nodeTitles.get(event.nodeId) ?? event.nodeId;
      if (event.status === "running") {
        console.log(`-> ${label}`);
      } else if (event.status === "done") {
        console.log(`OK ${label}`);
        if (event.output) console.log(indentBlock("output", event.output));
      } else if (event.status === "failed") {
        console.log(`FAIL ${label}`);
      }
    },
  });

  console.log(`\nRun ${run.status}: ${run.id}`);
  const failed = run.nodeRuns.filter((nodeRun) => nodeRun.status === "failed");
  for (const nodeRun of failed) {
    console.log(`\n[failed] ${nodeTitles.get(nodeRun.nodeId) ?? nodeRun.nodeId}`);
    if (nodeRun.error) console.log(indentBlock("error", nodeRun.error));
  }

  if (run.status !== "done") process.exitCode = 1;
}

function parseRunArgs(args: string[]): RunCliOptions {
  let file = "";
  let yes = false;
  let initialInput = "";
  const values: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-y" || arg === "--yes") {
      yes = true;
      continue;
    }
    if (arg === "--input") {
      initialInput = args[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--input=")) {
      initialInput = arg.slice("--input=".length);
      continue;
    }
    if (arg === "-D") {
      assignDefine(values, args[++i] ?? "");
      continue;
    }
    if (arg.startsWith("-D")) {
      assignDefine(values, arg.slice(2));
      continue;
    }
    if (!file) {
      file = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!file) {
    printRunUsage();
    process.exit(2);
  }

  return { file, yes, initialInput, values };
}

function assignDefine(target: Record<string, string>, raw: string): void {
  const eq = raw.indexOf("=");
  if (eq <= 0) throw new Error(`Invalid -D value "${raw}". Expected -Dname=value.`);
  target[raw.slice(0, eq)] = raw.slice(eq + 1);
}

function normalizeVariableValues(doc: AgentFlowDoc, values: Record<string, string>): Record<string, string> {
  const names = new Set(doc.nodes.filter((n) => n.kind === "input").map((n) => n.variableName));
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const fullKey = key.startsWith("specflow_") ? key : `specflow_${key}`;
    normalized[names.has(fullKey) ? fullKey : key] = value;
  }
  return normalized;
}

function printRunPlan(filePath: string, doc: AgentFlowDoc, variables: RunInputVariable[]): void {
  const runtimeNodes = doc.nodes.filter((n) => n.kind === "step" || n.kind === "gate");
  console.log(`Workflow: ${doc.name} (${doc.id})`);
  console.log(`File: ${filePath}`);
  console.log(`Sessions: ${doc.sessions.length}`);
  for (const s of doc.sessions) {
    console.log(`  - ${s.name} [${s.agent}]`);
  }
  console.log(`Nodes: ${runtimeNodes.length}`);
  for (const n of runtimeNodes) {
    console.log(`  - ${n.num} ${n.title} (${n.kind})`);
  }

  if (variables.length > 0) {
    console.log("Variables:");
    for (const v of variables) {
      const shown = v.value === "" ? "<empty>" : v.value;
      console.log(`  - ${v.name} = ${shown} (${v.source})`);
    }
  } else {
    console.log("Variables: none");
  }
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`\n${question} [y/N] `);
  const line = await readStdinLine();
  return line.trim().toLowerCase() === "y" || line.trim().toLowerCase() === "yes";
}

async function readStdinLine(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
    const nl = out.indexOf("\n");
    if (nl >= 0) return out.slice(0, nl);
  }
}

function indentBlock(label: string, value: string): string {
  return `  ${label}:\n${value.split("\n").map((line) => `    ${line}`).join("\n")}`;
}

function printRunUsage(): void {
  console.error("Usage: specflow run <agentflow.yaml> [-Dname=value ...] [--input text] [--yes]");
}
