import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasDoc,
  CanvasLayoutDoc,
  CanvasNode,
  CanvasNodeLayout,
} from "./canvas-doc";
import { parseAgentFlowSource, stringifyAgentFlowSource } from "./agentflow-source";

function agentflowsDir(root: string) {
  return join(root, ".specflow", "agentflows");
}

function canvasDir(root: string) {
  return join(root, ".specflow", "canvas");
}

function agentflowPath(id: string, root: string) {
  return join(agentflowsDir(root), `${id}.yaml`);
}

function canvasPath(id: string, root: string) {
  return join(canvasDir(root), `${id}.json`);
}

export async function listCanvases(root: string): Promise<{ id: string; name: string }[]> {
  const dir = agentflowsDir(root);
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
      const id = basename(file, ".yaml");
      const doc = parseAgentFlowSource(raw, id);
      results.push({ id: doc.id, name: doc.name });
    } catch {
      // skip malformed
    }
  }
  return results;
}

export async function loadCanvas(id: string, root: string): Promise<CanvasDoc> {
  const agentflow = await loadAgentFlow(id, root);
  const layout = await loadOrCreateCanvasLayout(agentflow, root);
  return combineAgentFlowAndLayout(agentflow, layout);
}

export async function loadAgentFlow(id: string, root: string): Promise<AgentFlowDoc> {
  const raw = await readFile(agentflowPath(id, root), "utf8");
  return parseAgentFlowSource(raw, id);
}

export async function loadOrCreateCanvasLayout(
  agentflow: AgentFlowDoc,
  root: string,
): Promise<CanvasLayoutDoc> {
  try {
    const raw = await readFile(canvasPath(agentflow.id, root), "utf8");
    const layout = JSON.parse(raw) as CanvasLayoutDoc;
    if (layout.workflowId === agentflow.id) return normalizeCanvasLayout(agentflow, layout);
  } catch {
    // Missing or malformed layout is regenerated below.
  }
  const generated = generateCanvasLayout(agentflow);
  await saveCanvasLayout(agentflow.id, generated, root);
  return generated;
}

export async function saveCanvas(id: string, doc: CanvasDoc, root: string): Promise<void> {
  const { agentflow, layout } = splitCanvasDoc({ ...doc, id });
  await mkdir(agentflowsDir(root), { recursive: true });
  await Promise.all([
    writeFile(agentflowPath(id, root), stringifyAgentFlowSource(agentflow), "utf8"),
    saveCanvasLayout(id, layout, root),
  ]);
}

export async function saveAgentFlowAndLayout(
  id: string,
  agentflow: AgentFlowDoc,
  layout: CanvasLayoutDoc,
  root: string,
): Promise<void> {
  await mkdir(agentflowsDir(root), { recursive: true });
  await Promise.all([
    writeFile(agentflowPath(id, root), stringifyAgentFlowSource({ ...agentflow, id }), "utf8"),
    saveCanvasLayout(id, layout, root),
  ]);
}

export async function saveCanvasLayout(id: string, layout: CanvasLayoutDoc, root: string): Promise<void> {
  await mkdir(canvasDir(root), { recursive: true });
  await writeFile(canvasPath(id, root), `${JSON.stringify(layout, null, 2)}\n`, "utf8");
}

export async function deleteCanvas(id: string, root: string): Promise<void> {
  await Promise.all([
    unlink(agentflowPath(id, root)).catch(() => {}),
    unlink(canvasPath(id, root)).catch(() => {}),
  ]);
}

export function splitCanvasDoc(doc: CanvasDoc): { agentflow: AgentFlowDoc; layout: CanvasLayoutDoc } {
  const nodes: AgentFlowNode[] = doc.nodes.map((node) => stripLayout(node));
  const layout: CanvasLayoutDoc = {
    workflowId: doc.id,
    version: 1,
    nodes: doc.nodes.map((node) => ({
      nodeId: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
    })),
  };
  return {
    agentflow: {
      id: doc.id,
      name: doc.name,
      sessions: doc.sessions,
      nodes,
      edges: doc.edges,
      variables: doc.variables,
    },
    layout,
  };
}

export function combineAgentFlowAndLayout(
  agentflow: AgentFlowDoc,
  layout: CanvasLayoutDoc,
): CanvasDoc {
  const layoutByNode = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  const generated = generateCanvasLayout(agentflow);
  const generatedByNode = new Map(generated.nodes.map((node) => [node.nodeId, node]));
  return {
    id: agentflow.id,
    name: agentflow.name,
    sessions: agentflow.sessions,
    nodes: agentflow.nodes.map((node) => {
      const nodeLayout = layoutByNode.get(node.id) ?? generatedByNode.get(node.id);
      return {
        ...node,
        x: nodeLayout?.x ?? 0,
        y: nodeLayout?.y ?? 0,
        w: nodeLayout?.w ?? defaultWidth(node.kind),
      } as CanvasNode;
    }),
    edges: agentflow.edges,
    variables: agentflow.variables,
  };
}

export function generateCanvasLayout(agentflow: AgentFlowDoc): CanvasLayoutDoc {
  const ignoredEdges = new Set(agentflow.edges.filter((edge) => edge.loopback).map((edge) => edge.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of agentflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of agentflow.edges) {
    if (ignoredEdges.has(edge.id)) continue;
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    incoming.get(edge.to)!.push(edge.from);
    outgoing.get(edge.from)!.push(edge.to);
  }

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(agentflow.nodes.map((node) => [node.id, node]));

  const computeRank = (nodeId: string): number => {
    const existing = rank.get(nodeId);
    if (existing != null) return existing;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    const parents = incoming.get(nodeId) ?? [];
    const value = node?.kind === "input" || parents.length === 0
      ? 0
      : Math.max(...parents.map((parentId) => computeRank(parentId) + 1));
    visiting.delete(nodeId);
    rank.set(nodeId, value);
    return value;
  };

  for (const node of agentflow.nodes) computeRank(node.id);

  const columns = new Map<number, AgentFlowNode[]>();
  for (const node of agentflow.nodes) {
    const r = rank.get(node.id) ?? 0;
    const column = columns.get(r) ?? [];
    column.push(node);
    columns.set(r, column);
  }

  const layouts: CanvasNodeLayout[] = [];
  const sortedRanks = [...columns.keys()].sort((a, b) => a - b);
  const xByRank = new Map<number, number>();
  let previousRank: number | undefined;
  for (const r of sortedRanks) {
    if (previousRank === undefined) {
      xByRank.set(r, 60);
    } else {
      const previousColumn = columns.get(previousRank)!;
      const previousWidth = Math.max(...previousColumn.map((node) => defaultWidth(node.kind)));
      const labelWidth = maximumEdgeLabelWidth(agentflow, rank, previousRank, r);
      xByRank.set(r, (xByRank.get(previousRank) ?? 60) + previousWidth + Math.max(80, labelWidth + 48));
    }
    previousRank = r;
  }
  for (const r of sortedRanks) {
    const column = columns.get(r)!;
    column.sort(compareNodesForLayout);
    for (let index = 0; index < column.length; index += 1) {
      const node = column[index]!;
      layouts.push({
        nodeId: node.id,
        x: xByRank.get(r) ?? 60,
        y: 80 + index * 180,
        w: defaultWidth(node.kind),
      });
    }
  }

  return {
    workflowId: agentflow.id,
    version: 1,
    nodes: layouts,
  };
}

function normalizeCanvasLayout(agentflow: AgentFlowDoc, layout: CanvasLayoutDoc): CanvasLayoutDoc {
  const knownNodeIds = new Set(agentflow.nodes.map((node) => node.id));
  const generated = generateCanvasLayout(agentflow);
  const layoutByNode = new Map(layout.nodes.map((node) => [node.nodeId, node]));
  const nodes = generated.nodes.map((fallback) => {
    const existing = layoutByNode.get(fallback.nodeId);
    if (!existing || !knownNodeIds.has(existing.nodeId)) return fallback;
    return {
      nodeId: existing.nodeId,
      x: existing.x,
      y: existing.y,
      w: existing.w || fallback.w,
    };
  });
  return {
    workflowId: agentflow.id,
    version: 1,
    nodes,
    viewport: layout.viewport,
  };
}

function stripLayout(node: CanvasNode): AgentFlowNode {
  const { x: _x, y: _y, w: _w, ...rest } = node;
  return rest;
}

function defaultWidth(kind: AgentFlowNode["kind"]): number {
  if (kind === "gate") return 200;
  if (kind === "input") return 200;
  if (kind === "end") return 140;
  return 220;
}

function compareNodesForLayout(a: AgentFlowNode, b: AgentFlowNode): number {
  return (a.num || "").localeCompare(b.num || "", undefined, { numeric: true }) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id);
}

function maximumEdgeLabelWidth(
  agentflow: AgentFlowDoc,
  rank: Map<string, number>,
  sourceRank: number,
  targetRank: number,
): number {
  let maximum = 0;
  for (const edge of agentflow.edges) {
    if (edge.loopback || rank.get(edge.from) !== sourceRank || rank.get(edge.to) !== targetRank) continue;
    maximum = Math.max(maximum, estimateEdgeLabelWidth(edge, agentflow));
  }
  return maximum;
}

function estimateEdgeLabelWidth(edge: AgentFlowDoc["edges"][number], agentflow: AgentFlowDoc): number {
  const source = agentflow.nodes.find((node) => node.id === edge.from);
  const target = agentflow.nodes.find((node) => node.id === edge.to);
  const visibleLabels = [
    target?.kind === "gate" ? "gate input" : edge.outputTag ? `<specflow_${edge.outputTag}>` : "no transfer",
    source?.kind === "gate" ? source.branches.find((branch) => branch.id === edge.branch)?.label ?? edge.branch ?? "" : "",
  ];
  return Math.max(...visibleLabels.map((label) => label.length * 7 + 24));
}
