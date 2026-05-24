import { parse, stringify } from "yaml";
import type {
  AgentFlowDoc,
  AgentFlowNode,
  CanvasBranch,
  CanvasEdge,
  CanvasSession,
  CanvasVariable,
} from "./canvas-doc";

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
    };
  });
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
        num: optionalString(node.num) ?? "IN",
        title,
        variableName: requireString(node.variableName, `node "${id}".variableName`),
        defaultValue: optionalString(node.defaultValue),
        description: optionalString(node.description),
        sessionId: null,
      };
    }
    if (kind === "end") {
      return {
        kind,
        id,
        num: optionalString(node.num) ?? "END",
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
      return {
        kind,
        id,
        num: optionalString(node.num) ?? String(stepNumber).padStart(2, "0"),
        title,
        prompt: optionalString(node.prompt) ?? "",
        sessionId,
        ...(node.locked === true ? { locked: true } : {}),
        ...(Array.isArray(node.images) ? { images: parseImages(node.images, id) } : {}),
        ...(Array.isArray(node.paths) ? { paths: parsePaths(node.paths, id) } : {}),
      };
    }
    if (kind === "gate") {
      gateNumber += 1;
      return {
        kind,
        id,
        num: optionalString(node.num) ?? `G${gateNumber}`,
        title,
        decisionCriteria: optionalString(node.decisionCriteria) ?? "",
        branches: parseBranches(asRecord(node.branches, `node "${id}".branches`), id),
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
      num: node.num,
      title: node.title,
      variableName: node.variableName,
      defaultValue: node.defaultValue,
      description: node.description,
    });
  }
  if (node.kind === "end") {
    return compact({ kind: node.kind, num: node.num, title: node.title });
  }
  if (node.kind === "step") {
    return compact({
      kind: node.kind,
      num: node.num,
      title: node.title,
      prompt: node.prompt,
      session: node.sessionId,
      locked: node.locked,
      images: node.images,
      paths: node.paths,
    });
  }
  return compact({
    kind: node.kind,
    num: node.num,
    title: node.title,
    decisionCriteria: node.decisionCriteria,
    branches: Object.fromEntries(node.branches.map((branch) => [
      branch.id,
      compact({
        label: branch.label === branch.id ? undefined : branch.label,
        description: branch.description,
      }),
    ])),
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
  for (const edge of doc.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge "${edge.id}" references a missing node.`);
    }
    if (edge.branch && !branchesByGate.get(edge.from)?.has(edge.branch)) {
      throw new Error(`Edge from "${edge.from}" references missing branch "${edge.branch}".`);
    }
    const target = doc.nodes.find((node) => node.id === edge.to);
    const source = doc.nodes.find((node) => node.id === edge.from);
    if (edge.outputTag && !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(edge.outputTag)) {
      throw new Error(`Edge "${edge.id}" outputTag must be an XML-safe tag name.`);
    }
    if (target?.kind === "gate" && source?.kind !== "input") {
      const count = (businessInputsByGate.get(target.id) ?? 0) + 1;
      if (count > 1) throw new Error(`Gate node "${target.id}" accepts exactly one business input edge.`);
      businessInputsByGate.set(target.id, count);
    }
    if (target?.kind === "gate" && (edge.transmit || edge.outputTag || edge.handoffPrompt)) {
      throw new Error(`Gate input edge "${edge.id}" cannot declare transmission properties.`);
    }
    const id = edgeIdFromReferences(edge);
    if (edgeIds.has(id)) throw new Error(`Duplicate edge "${id}".`);
    edgeIds.add(id);
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
