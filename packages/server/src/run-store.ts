import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { CanvasDoc } from "./canvas-doc";

export type RunState = "running" | "success" | "error" | "pending";

export interface RunRecord {
  id: string;
  workflowId: string;
  label: string;
  ticket?: string;
  status: "running" | "success" | "error";
  activeNode?: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  agent: string;
  errorMsg?: string;
  nodeStates: Record<string, RunState>;
  nodeOutputs: Record<string, string>;
  canvasSnapshot: CanvasDoc;
}

function runsDir(root: string) {
  return join(root, ".specflow", "runs");
}

function runPath(id: string, root: string) {
  return join(runsDir(root), `${id}.yaml`);
}

export async function listRuns(workflowId: string | undefined, root: string): Promise<RunRecord[]> {
  const dir = runsDir(root);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const results: RunRecord[] = [];
  for (const file of files.filter((f) => f.endsWith(".yaml"))) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const rec = parse(raw) as RunRecord;
      if (!rec.nodeOutputs) rec.nodeOutputs = {};
      if (!workflowId || rec.workflowId === workflowId) {
        results.push(rec);
      }
    } catch {
      // skip malformed
    }
  }
  results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return results;
}

export async function loadRun(id: string, root: string): Promise<RunRecord> {
  const raw = await readFile(runPath(id, root), "utf8");
  const rec = parse(raw) as RunRecord;
  if (!rec.nodeOutputs) rec.nodeOutputs = {};
  return rec;
}

export async function saveRun(record: RunRecord, root: string): Promise<void> {
  await writeFile(runPath(record.id, root), stringify(record), "utf8");
}

export async function deleteRun(id: string, root: string): Promise<void> {
  try {
    await unlink(runPath(id, root));
  } catch {
    // already gone — ok
  }
}

export function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
