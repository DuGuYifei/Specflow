import { parse, stringify } from "yaml";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasBranch,
  CanvasEdge,
  CanvasSession,
  CanvasVariable,
} from "./canvas-doc";
import { contentSourceForEdge, hasTransferProperties } from "./canvas-edge-semantics";

export const AGENTFLOW_SOURCE_VERSION = 1;
const SYMBOL_KEY = /^[a-z][a-z0-9-]*$/;

export function parseAgentFlowSource(raw: string, workflowId: string): AgentFlowDoc {
  assertSymbolKey(workflowId, "workflow filename");
  const source = asRecord(parse(raw), "agentflow");
  if (source.version !== AGENTFLOW_SOURCE_VERSION) {
    throw new Error(`Agentflow "${workflowId}" must declare version: ${AGENTFLOW_SOURCE_VERSION}.`);
  }

  const sessions = parseSessions(asRecord(source.sessions, "sessions"));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const nodes = parseNodes(asRecord(source.nodes, "nodes"), sessionIds);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = parseEdges(source.edges, nodes, nodeIds);

  const doc: AgentFlowDoc = {
    id: workflowId,
    name: requireString(source.name, "name"),
    sessions,
    nodes,
    edges,
    variables: parseVariables(source.variables),
  };
  assertResolvedDoc(doc);
  return doc;
}

export function stringifyAgentFlowSource(doc: AgentFlowDoc): string {
  assertSymbolKey(doc.id, "workflow filename");
  assertResolvedDoc(doc);

  return stringify({
    version: AGENTFLOW_SOURCE_VERSION,
    name: doc.name,
    sessions: Object.fromEntries(doc.sessions.map((session) => [
      session.id,
      {
        agentServerId: session.agentServerId,
        ...(session.agent ? { agent: session.agent } : {}),
        ...(session.mcpServers && session.mcpServers.trim() ? { mcpServers: session.mcpServers } : {}),
      },
    ])),
    nodes: Object.fromEntries(doc.nodes.map((node) => [node.id, serializeNode(node)])),
    edges: doc.edges.map(({ id: _id, ...edge }) => edge),
    ...(doc.variables ? { variables: doc.variables } : {}),
  });
}

export function assertSymbolKey(value: string, label: string): void {
  if (!SYMBOL_KEY.test(value)) {
    throw new Error(`${label} "${value}" must match ${SYMBOL_KEY.source}.`);
  }
}

export function keyFromLabel(label: string, fallback: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SYMBOL_KEY.test(key) ? key : fallback;
}

export function edgeIdFromReferences(edge: Pick<CanvasEdge, "from" | "to" | "branch">): string {
  return `edge:${edge.from}:${edge.branch ?? ""}->${edge.to}`;
}

function parseSessions(raw: Record<string, unknown>): CanvasSession[] {
  return Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, "session key");
    const session = asRecord(input, `session "${id}"`);
    return {
      id,
      name: id,
      agentServerId: requireString(session.agentServerId, `session "${id}".agentServerId`),
      ...(typeof session.agent === "string" ? { agent: session.agent } : {}),
      ...(typeof session.mcpServers === "string"
        ? { mcpServers: assertMcpServersString(session.mcpServers, id) }
        : {}),
    };
  });
}

/**
 * MCP servers are stored as a JSON string so users can paste a McpServer[]
 * config from Claude Desktop / Cursor / etc. without inventing a parallel
 * YAML schema. We do basic JSON validity + array-shape checks here so the
 * error fires at parse time, not when the agent finally fails to start.
 */
function assertMcpServersString(value: string, sessionId: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`session "${sessionId}".mcpServers must be valid JSON: ${detail}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`session "${sessionId}".mcpServers must be a JSON array of McpServer objects.`);
  }
  return value;
}

function parseNodes(raw: Record<string, unknown>, sessionIds: Set<string>): AgentFlowNode[] {
  let stepNumber = 0;
  let gateNumber = 0;
  return Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, "node key");
    const node = asRecord(input, `node "${id}"`);
    const kind = requireString(node.kind, `node "${id}".kind`);
    const title = requireString(node.title, `node "${id}".title`);

    if (kind === "input") {
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "IN",
        title,
        variableName: requireString(node.variableName, `node "${id}".variableName`),
        ...(node.required === false ? { required: false } : {}),
        defaultValue: optionalString(node.defaultValue),
        description: optionalString(node.description),
        sessionId: null,
      };
    }
    if (kind === "end") {
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? "END",
        title,
        sessionId: null,
      };
    }

    if (kind === "step") {
      const sessionId = requireString(node.session, `node "${id}".session`);
      if (!sessionIds.has(sessionId)) {
        throw new Error(`Node "${id}" references missing session "${sessionId}".`);
      }
      stepNumber += 1;
      const modeId = optionalString(node.modeId);
      const configOptions = parseConfigOptions(node.configOptions, id);
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? String(stepNumber).padStart(2, "0"),
        title,
        prompt: optionalString(node.prompt) ?? "",
        sessionId,
        ...(node.pauseAfterRun === true ? { pauseAfterRun: true } : {}),
        ...(node.locked === true ? { locked: true } : {}),
        ...(Array.isArray(node.images) ? { images: parseImages(node.images, id) } : {}),
        ...(Array.isArray(node.paths) ? { paths: parsePaths(node.paths, id) } : {}),
        ...(modeId ? { modeId } : {}),
        ...(configOptions ? { configOptions } : {}),
      };
    }
    if (kind === "gate") {
      gateNumber += 1;
      if (node.modeId !== undefined) {
        throw new Error(`Gate node "${id}" must not define modeId — only step nodes accept a per-node ACP mode override.`);
      }
      const configOptions = parseConfigOptions(node.configOptions, id);
      return {
        kind,
        id,
        alias: optionalString(node.alias) ?? `G${gateNumber}`,
        title,
        decisionCriteria: optionalString(node.decisionCriteria) ?? "",
        branches: parseBranches(asRecord(node.branches, `node "${id}".branches`), id),
        ...(configOptions ? { configOptions } : {}),
      };
    }
    throw new Error(`Node "${id}" has unsupported kind "${kind}".`);
  });
}

function parseBranches(raw: Record<string, unknown>, nodeId: string): CanvasBranch[] {
  const branches = Object.entries(raw).map(([id, input]) => {
    assertSymbolKey(id, `node "${nodeId}" branch key`);
    const branch = input == null ? {} : asRecord(input, `node "${nodeId}" branch "${id}"`);
    return {
      id,
      label: optionalString(branch.label) ?? id,
      ...(optionalString(branch.description) ? { description: optionalString(branch.description) } : {}),
    };
  });
  if (branches.length === 0) {
    throw new Error(`Gate node "${nodeId}" must define at least one branch.`);
  }
  return branches;
}

function parseEdges(raw: unknown, nodes: AgentFlowNode[], nodeIds: Set<string>): CanvasEdge[] {
  if (!Array.isArray(raw)) throw new Error("edges must be an array.");
  const branchesByGate = new Map(
    nodes
      .filter((node) => node.kind === "gate")
      .map((node) => [node.id, new Set(node.branches.map((branch) => branch.id))]),
  );
  const edgeIds = new Set<string>();

  return raw.map((input, index) => {
    const edge = asRecord(input, `edges[${index}]`);
    const from = requireString(edge.from, `edges[${index}].from`);
    const to = requireString(edge.to, `edges[${index}].to`);
    if (!nodeIds.has(from)) throw new Error(`Edge references missing source node "${from}".`);
    if (!nodeIds.has(to)) throw new Error(`Edge references missing target node "${to}".`);
    const branch = optionalString(edge.branch);
    if (branch && !branchesByGate.get(from)?.has(branch)) {
      throw new Error(`Edge from "${from}" references missing branch "${branch}".`);
    }
    const parsed: CanvasEdge = {
      id: edgeIdFromReferences({ from, to, branch }),
      from,
      to,
      ...(edge.transmit === true ? { transmit: true } : {}),
      ...(optionalString(edge.outputTag) ? { outputTag: optionalString(edge.outputTag)! } : {}),
      ...(optionalString(edge.handoffPrompt) ? { handoffPrompt: optionalString(edge.handoffPrompt)! } : {}),
      ...(branch ? { branch } : {}),
      ...(edge.loopback === true ? { loopback: true } : {}),
      ...(parseMaxTraversals(edge.maxTraversals, `edges[${index}].maxTraversals`) != null
        ? { maxTraversals: parseMaxTraversals(edge.maxTraversals, `edges[${index}].maxTraversals`)! }
        : {}),
    };
    if (edgeIds.has(parsed.id)) {
      throw new Error(`Duplicate edge "${parsed.id}".`);
    }
    edgeIds.add(parsed.id);
    return parsed;
  });
}

function serializeNode(node: AgentFlowNode): Record<string, unknown> {
  if (node.kind === "input") {
    return compact({
      kind: node.kind,
      alias: node.alias,
      title: node.title,
      variableName: node.variableName,
      required: node.required,
      defaultValue: node.defaultValue,
      description: node.description,
    });
  }
  if (node.kind === "end") {
    return compact({ kind: node.kind, alias: node.alias, title: node.title });
  }
  if (node.kind === "step") {
    return compact({
      kind: node.kind,
      alias: node.alias,
      title: node.title,
      prompt: node.prompt,
      session: node.sessionId,
      pauseAfterRun: node.pauseAfterRun,
      locked: node.locked,
      images: node.images,
      paths: node.paths,
      modeId: node.modeId,
      configOptions: node.configOptions && Object.keys(node.configOptions).length > 0 ? node.configOptions : undefined,
    });
  }
  return compact({
    kind: node.kind,
    alias: node.alias,
    title: node.title,
    decisionCriteria: node.decisionCriteria,
    branches: Object.fromEntries(node.branches.map((branch) => [
      branch.id,
      compact({
        label: branch.label === branch.id ? undefined : branch.label,
        description: branch.description,
      }),
    ])),
    configOptions: node.configOptions && Object.keys(node.configOptions).length > 0 ? node.configOptions : undefined,
  });
}

function assertResolvedDoc(doc: AgentFlowDoc): void {
  const sessionIds = new Set<string>();
  for (const session of doc.sessions) {
    assertSymbolKey(session.id, "session key");
    if (sessionIds.has(session.id)) throw new Error(`Duplicate session "${session.id}".`);
    sessionIds.add(session.id);
  }
  const nodeIds = new Set<string>();
  for (const node of doc.nodes) {
    assertSymbolKey(node.id, "node key");
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node "${node.id}".`);
    nodeIds.add(node.id);
    if (node.kind === "step" && !sessionIds.has(node.sessionId ?? "")) {
      throw new Error(`Node "${node.id}" references missing session "${node.sessionId}".`);
    }
    if (node.kind === "gate") {
      if (node.branches.length === 0) throw new Error(`Gate node "${node.id}" must define at least one branch.`);
      const branchIds = new Set<string>();
      for (const branch of node.branches) {
        assertSymbolKey(branch.id, `node "${node.id}" branch key`);
        if (branchIds.has(branch.id)) throw new Error(`Duplicate branch "${branch.id}" on node "${node.id}".`);
        branchIds.add(branch.id);
      }
    }
  }
  const branchesByGate = new Map(
    doc.nodes
      .filter((node) => node.kind === "gate")
      .map((node) => [node.id, new Set(node.branches.map((branch) => branch.id))]),
  );
  const edgeIds = new Set<string>();
  const businessInputsByGate = new Map<string, number>();
  const inputEdgesByTargetTag = new Map<string, CanvasEdge[]>();
  for (const edge of doc.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge "${edge.id}" references a missing node.`);
    }
    if (edge.branch && !branchesByGate.get(edge.from)?.has(edge.branch)) {
      throw new Error(`Edge from "${edge.from}" references missing branch "${edge.branch}".`);
    }
    const target = doc.nodes.find((node) => node.id === edge.to);
    const source = doc.nodes.find((node) => node.id === edge.from);
    if (target?.kind === "input") {
      throw new Error(`Edge "${edge.id}" cannot target an input node.`);
    }
    if (source?.kind === "end") {
      throw new Error(`Edge "${edge.id}" cannot leave an end node.`);
    }
    if (source?.kind === "gate" && !edge.branch) {
      throw new Error(`Edge "${edge.id}" leaving gate "${source.id}" must select a branch.`);
    }
    if (edge.maxTraversals !== undefined && source?.kind !== "gate") {
      throw new Error(`Edge "${edge.id}" can define maxTraversals only when leaving a gate.`);
    }
    if (edge.outputTag && !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(edge.outputTag)) {
      throw new Error(`Edge "${edge.id}" outputTag must be an XML-safe tag name.`);
    }
    if (target?.kind === "gate" && source?.kind !== "input") {
      const count = (businessInputsByGate.get(target.id) ?? 0) + 1;
      if (count > 1) throw new Error(`Gate node "${target.id}" accepts exactly one business input edge.`);
      businessInputsByGate.set(target.id, count);
    }
    if (target?.kind === "gate" && hasTransferProperties(edge)) {
      throw new Error(`Gate input edge "${edge.id}" cannot declare transmission properties.`);
    } else if (target?.kind === "gate" && edge.loopback) {
      throw new Error(`Gate input edge "${edge.id}" cannot be a loopback edge.`);
    } else if ((source?.kind === "input" || target?.kind === "end") && hasTransferProperties(edge)) {
      throw new Error(`Control-only edge "${edge.id}" cannot declare transmission properties.`);
    } else if (edge.transmit !== true && (edge.outputTag || edge.handoffPrompt)) {
      throw new Error(`Edge "${edge.id}" cannot define outputTag or handoffPrompt unless transmit is enabled.`);
    } else if (edge.transmit === true && !edge.outputTag) {
      throw new Error(`Transmitting edge "${edge.id}" must define outputTag.`);
    } else if (edge.transmit === true && target?.kind === "step") {
      const contentSource = contentSourceForEdge(edge, doc);
      if (contentSource?.kind === "step" && contentSource.sessionId === target.sessionId) {
        throw new Error(`Same-session edge "${edge.id}" cannot declare transmission properties.`);
      }
      const targetTag = `${target.id}:${edge.outputTag}`;
      const matchingEdges = inputEdgesByTargetTag.get(targetTag) ?? [];
      if (matchingEdges.some((candidate) => !areExclusiveGateBranches(candidate, edge, doc))) {
        throw new Error(`Node "${target.id}" has duplicate transmitted outputTag "${edge.outputTag}".`);
      }
      matchingEdges.push(edge);
      inputEdgesByTargetTag.set(targetTag, matchingEdges);
    }
    const id = edgeIdFromReferences(edge);
    if (edgeIds.has(id)) throw new Error(`Duplicate edge "${id}".`);
    edgeIds.add(id);
  }
  assertControlledLoopbacks(doc);
  assertAcyclicExecutedEdges(doc);
}

function areExclusiveGateBranches(first: CanvasEdge, second: CanvasEdge, doc: AgentFlowDoc): boolean {
  if (first.from !== second.from || !first.branch || !second.branch || first.branch === second.branch) return false;
  return doc.nodes.find((node) => node.id === first.from)?.kind === "gate";
}

function assertAcyclicExecutedEdges(doc: AgentFlowDoc): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of doc.edges.filter((candidate) => !candidate.loopback)) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new Error(`Workflow contains an unmarked cycle through node "${nodeId}".`);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const targetId of adjacency.get(nodeId) ?? []) visit(targetId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of doc.nodes) visit(node.id);
}

function assertControlledLoopbacks(doc: AgentFlowDoc): void {
  const bySource = new Map<string, CanvasEdge[]>();
  for (const edge of doc.edges.filter((candidate) => !candidate.loopback)) {
    bySource.set(edge.from, [...(bySource.get(edge.from) ?? []), edge]);
  }
  const gateIds = new Set(doc.nodes.filter((node) => node.kind === "gate").map((node) => node.id));
  for (const loopback of doc.edges.filter((edge) => edge.loopback)) {
    const pending: Array<{ nodeId: string; crossedGateBranch: boolean }> = [{
      nodeId: loopback.to,
      crossedGateBranch: false,
    }];
    const visited = new Set<string>();
    let controlled = gateIds.has(loopback.from) && Boolean(loopback.branch);
    while (!controlled && pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.nodeId}:${current.crossedGateBranch}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (current.nodeId === loopback.from && current.crossedGateBranch) {
        controlled = true;
        break;
      }
      for (const edge of bySource.get(current.nodeId) ?? []) {
        pending.push({
          nodeId: edge.to,
          crossedGateBranch: current.crossedGateBranch || (gateIds.has(edge.from) && Boolean(edge.branch)),
        });
      }
    }
    if (!controlled) {
      throw new Error(`Loopback edge "${loopback.id}" must close a path controlled by a gate branch.`);
    }
  }
}

function parseImages(raw: unknown[], nodeId: string): Array<{ path: string; label?: string; mimeType?: string }> {
  return raw.map((input, index) => {
    const image = asRecord(input, `node "${nodeId}".images[${index}]`);
    return compact({
      path: requireString(image.path, `node "${nodeId}".images[${index}].path`),
      label: optionalString(image.label),
      mimeType: optionalString(image.mimeType),
    });
  });
}

function parsePaths(raw: unknown[], nodeId: string): string[] {
  return raw.map((input, index) => requireString(input, `node "${nodeId}".paths[${index}]`));
}

function parseConfigOptions(raw: unknown, nodeId: string): Record<string, string | boolean> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`node "${nodeId}".configOptions must be a key/value object.`);
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const out: Record<string, string | boolean> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string" && typeof value !== "boolean") {
      throw new Error(`node "${nodeId}".configOptions["${key}"] must be a string or boolean.`);
    }
    out[key] = value;
  }
  return out;
}

function parseVariables(raw: unknown): CanvasVariable[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("variables must be an array.");
  return raw.map((input, index) => {
    const variable = asRecord(input, `variables[${index}]`);
    return compact({
      name: requireString(variable.name, `variables[${index}].name`),
      defaultValue: optionalString(variable.defaultValue),
      description: optionalString(variable.description),
    }) as CanvasVariable;
  });
}

function parseMaxTraversals(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value as number;
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
