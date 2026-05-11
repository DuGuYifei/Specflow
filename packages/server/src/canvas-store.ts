import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { CanvasDoc } from "./canvas-doc";

function canvasDir(root: string) {
  return join(root, ".specflow", "canvas");
}

function canvasPath(id: string, root: string) {
  return join(canvasDir(root), `${id}.yaml`);
}

export async function listCanvases(root: string): Promise<{ id: string; name: string }[]> {
  const dir = canvasDir(root);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const results: { id: string; name: string }[] = [];
  for (const file of files.filter((f) => f.endsWith(".yaml"))) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const doc = parse(raw) as CanvasDoc;
      results.push({ id: doc.id, name: doc.name });
    } catch {
      // skip malformed
    }
  }
  return results;
}

export async function loadCanvas(id: string, root: string): Promise<CanvasDoc> {
  const raw = await readFile(canvasPath(id, root), "utf8");
  return parse(raw) as CanvasDoc;
}

export async function saveCanvas(id: string, doc: CanvasDoc, root: string): Promise<void> {
  await writeFile(canvasPath(id, root), stringify(doc), "utf8");
}

export async function deleteCanvas(id: string, root: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(canvasPath(id, root));
  } catch {
    // already gone — ok
  }
}
