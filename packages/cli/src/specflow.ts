#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  executeCanvasDoc,
  loadCanvasFile,
  prepareCanvasRun,
  startSpecflowServer,
  type CanvasDoc,
} from "@specflow/server";

interface RunCliOptions {
  file: string;
  yes: boolean;
  initialInput: string;
  values: Record<string, string>;
}

const args = Bun.argv.slice(2);

if (args[0] === "run") {
  await runWorkflowCommand(args.slice(1));
} else {
  await startSpecflowServer();
}

async function runWorkflowCommand(args: string[]): Promise<void> {
  const opts = parseRunArgs(args);
  const filePath = resolve(process.cwd(), opts.file);
  const doc = await loadCanvasFile(filePath);
  const normalizedValues = normalizeVariableValues(doc, opts.values);
  const prepared = prepareCanvasRun(doc, {
    initialInput: opts.initialInput,
    variableValues: normalizedValues,
  });

  printRunPlan(filePath, doc, prepared.variables);

  if (prepared.missingVariables.length > 0) {
    console.error("\nMissing required variables:");
    for (const v of prepared.missingVariables) {
      console.error(`  - ${v.name}${v.description ? ` (${v.description})` : ""}`);
    }
    console.error("\nPass them with -Dname=value, for example: -Dvalue=1 or -Dspecflow_value=1");
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

  const run = await executeCanvasDoc({
    doc: prepared.doc,
    initialInput: prepared.initialInput,
    cwd: process.cwd(),
  });

  console.log(`\nRun ${run.status}: ${run.id}`);
  for (const nodeRun of run.nodeRuns) {
    console.log(`\n[${nodeRun.status}] ${nodeRun.nodeId}`);
    if (nodeRun.input) console.log(indentBlock("input", nodeRun.input));
    if (nodeRun.output) console.log(indentBlock("output", nodeRun.output));
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

function normalizeVariableValues(doc: CanvasDoc, values: Record<string, string>): Record<string, string> {
  const names = new Set(doc.nodes.filter((n) => n.kind === "input").map((n) => n.variableName));
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const fullKey = key.startsWith("specflow_") ? key : `specflow_${key}`;
    normalized[names.has(fullKey) ? fullKey : key] = value;
  }
  return normalized;
}

function printRunPlan(filePath: string, doc: CanvasDoc, variables: ReturnType<typeof prepareCanvasRun>["variables"]): void {
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
  console.error("Usage: specflow run <canvas.yaml> [-Dname=value ...] [--input text] [--yes]");
}
