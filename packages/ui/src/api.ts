import type { Session, WorkflowNode, Edge, Workflow, Run, RunState, Variable } from './types';

export interface CanvasDoc {
  id: string;
  name: string;
  sessions: Session[];
  nodes: WorkflowNode[];
  edges: Edge[];
  variables?: Variable[];
}

export type AgentFlowNode = Omit<WorkflowNode, 'x' | 'y' | 'w'>;

export interface AgentFlowDoc {
  id: string;
  name: string;
  sessions: Session[];
  nodes: AgentFlowNode[];
  edges: Edge[];
  variables?: Variable[];
}

export interface CanvasLayoutDoc {
  workflowId: string;
  version: 1;
  nodes: Array<{ nodeId: string; x: number; y: number; w: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface ApiRunRecord {
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
  nodeOutputs?: Record<string, string>;
  agentflowSnapshot?: AgentFlowDoc;
  canvasSnapshot?: CanvasLayoutDoc | CanvasDoc;
  initialInput?: string;
  variableValues?: Record<string, string>;
}

export interface CanvasSummary {
  id: string;
  name: string;
  runs: number;
}

export async function fetchCanvases(): Promise<CanvasSummary[]> {
  const res = await fetch('/api/canvases');
  if (!res.ok) throw new Error(`Failed to fetch canvases: ${res.status}`);
  return res.json();
}

export async function fetchCanvas(id: string): Promise<CanvasDoc> {
  const res = await fetch(`/api/canvases/${id}`);
  if (!res.ok) throw new Error(`Canvas ${id} not found`);
  return res.json();
}

export async function saveCanvas(id: string, doc: CanvasDoc): Promise<void> {
  await fetch(`/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
}

export async function createCanvas(name: string): Promise<CanvasDoc> {
  const res = await fetch('/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create canvas: ${res.status}`);
  return res.json();
}

export async function deleteCanvas(id: string): Promise<void> {
  await fetch(`/api/canvases/${id}`, { method: 'DELETE' });
}

export async function runCanvas(
  id: string,
  opts?: { initialInput?: string; variableValues?: Record<string, string> },
): Promise<{ runId: string }> {
  const res = await fetch(`/api/canvases/${id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initialInput: opts?.initialInput, variableValues: opts?.variableValues }),
  });
  if (!res.ok) throw new Error(`Failed to start run: ${res.status}`);
  return res.json();
}

export async function fetchRuns(workflowId: string): Promise<ApiRunRecord[]> {
  const res = await fetch(`/api/runs?workflowId=${encodeURIComponent(workflowId)}`);
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  return res.json();
}

export async function fetchRun(id: string): Promise<ApiRunRecord> {
  const res = await fetch(`/api/runs/${id}`);
  if (!res.ok) throw new Error(`Run ${id} not found`);
  return res.json();
}

export async function deleteRun(id: string): Promise<void> {
  await fetch(`/api/runs/${id}`, { method: 'DELETE' });
}

export async function rerunRun(
  id: string,
  opts?: { initialInput?: string; variableValues?: Record<string, string> },
): Promise<{ runId: string }> {
  const res = await fetch(`/api/runs/${id}/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initialInput: opts?.initialInput, variableValues: opts?.variableValues }),
  });
  if (!res.ok) throw new Error(`Failed to re-run: ${res.status}`);
  return res.json();
}

export type SseEventType = 'hello' | 'node-status' | 'terminal' | 'run-status';

export function subscribeToRun(
  runId: string,
  onEvent: (type: SseEventType, data: unknown) => void,
): () => void {
  const source = new EventSource(`/api/runs/${runId}/events`);

  const handle = (type: SseEventType) => (e: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(e.data));
    } catch { /* ignore bad json */ }
  };

  source.addEventListener('hello',       handle('hello'));
  source.addEventListener('node-status', handle('node-status'));
  source.addEventListener('terminal',    handle('terminal'));
  source.addEventListener('run-status',  handle('run-status'));

  return () => source.close();
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function apiRunToUiRun(rec: ApiRunRecord): Run {
  const canvasSnapshot = combineSnapshot(rec.agentflowSnapshot, rec.canvasSnapshot);
  return {
    id: rec.id,
    workflowId: rec.workflowId,
    label: rec.label,
    ticket: rec.ticket ?? '',
    status: rec.status,
    activeNode: rec.activeNode,
    time: formatTime(rec.startedAt),
    duration: rec.duration ?? '—',
    agent: rec.agent,
    errorMsg: rec.errorMsg,
    nodeOutputs: rec.nodeOutputs,
    canvasSnapshot,
    nodeStates: rec.nodeStates,
    initialInput: rec.initialInput,
    variableValues: rec.variableValues,
  };
}

function combineSnapshot(
  agentflow: AgentFlowDoc | undefined,
  layoutOrLegacy: CanvasLayoutDoc | CanvasDoc | undefined,
): CanvasDoc | undefined {
  if (!layoutOrLegacy) return undefined;
  if ('id' in layoutOrLegacy) return layoutOrLegacy;
  if (!agentflow) return undefined;

  const layoutByNode = new Map(layoutOrLegacy.nodes.map((node) => [node.nodeId, node]));
  return {
    id: agentflow.id,
    name: agentflow.name,
    sessions: agentflow.sessions,
    nodes: agentflow.nodes.map((node) => {
      const layout = layoutByNode.get(node.id);
      return {
        ...node,
        x: layout?.x ?? 0,
        y: layout?.y ?? 0,
        w: layout?.w ?? defaultWidth(node.kind),
      } as WorkflowNode;
    }),
    edges: agentflow.edges,
    variables: agentflow.variables,
  };
}

function defaultWidth(kind: WorkflowNode['kind']): number {
  if (kind === 'gate') return 200;
  if (kind === 'input') return 200;
  if (kind === 'end') return 140;
  return 220;
}

export function summaryToWorkflow(s: CanvasSummary): Workflow {
  return {
    id: s.id,
    name: s.name,
    meta: `${s.runs} runs`,
    runs: s.runs,
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `${time} · today`;
  if (diffDays === 1) return `yesterday · ${time}`;
  return `${diffDays}d ago`;
}
