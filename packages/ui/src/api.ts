import type { Session, WorkflowNode, Edge, Workflow, Run, RunState, Variable, LogLine } from './types';

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
  status: "running" | "success" | "error" | "cancelled";
  activeNode?: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  agent: string;
  errorMsg?: string;
  nodeStates: Record<string, RunState>;
  nodeOutputs?: Record<string, string>;
  agentSessions?: AgentSessionRecord[];
  agentflowSnapshot?: AgentFlowDoc;
  canvasSnapshot?: CanvasLayoutDoc | CanvasDoc;
  initialInput?: string;
  variableValues?: Record<string, string>;
}

export interface AgentSessionInvocationRef {
  runId: string;
  invocationId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  completedAt?: string;
}

export interface AgentSessionRestoreAttempt {
  id: string;
  requestedMode: 'inspect' | 'continue';
  selectedPrimitive?: 'load' | 'resume';
  status: 'requested' | 'success' | 'failure';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AgentSessionRecord {
  id: string;
  workflowId: string;
  specflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  acpSessionId: string;
  acpSupportsLoadSession: boolean;
  acpSupportsResumeSession: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  latestRunId: string;
  latestInvocationId: string;
  latestStatus: 'running' | 'done' | 'failed';
  runIds: string[];
  invocationIds: string[];
  invocations: AgentSessionInvocationRef[];
  restoreAttempts?: AgentSessionRestoreAttempt[];
}

export type AgentServerSettings =
  | {
      type: 'registry';
      registryId: string;
      installedVersion?: string;
      defaultMode?: string;
      defaultModel?: string;
      defaultConfigOptions?: Record<string, string | boolean>;
      env?: Record<string, string>;
      additionalDirectories?: string[];
      terminal?: { enabled?: boolean; auth?: boolean };
    }
  | {
      type: 'custom';
      command: string;
      args?: string[];
      defaultMode?: string;
      defaultModel?: string;
      defaultConfigOptions?: Record<string, string | boolean>;
      env?: Record<string, string>;
      additionalDirectories?: string[];
      terminal?: { enabled?: boolean; auth?: boolean };
    }
  | {
      type: 'headless';
      command: string;
      argsTemplate: string[];
      defaultMode?: string;
      defaultModel?: string;
      defaultConfigOptions?: Record<string, string | boolean>;
      env?: Record<string, string>;
      additionalDirectories?: string[];
      terminal?: { enabled?: boolean; auth?: boolean };
    };

export interface AgentServerEntry {
  id: string;
  settings: AgentServerSettings;
  registry?: {
    registryId: string;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable: boolean;
  };
}

export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description?: string;
  repository?: string;
  website?: string;
  icon?: string;
  distribution: {
    binary?: Record<string, unknown>;
    npx?: unknown;
    uvx?: unknown;
  };
}

export interface RegistryIndex {
  version: string;
  agents: RegistryAgent[];
}

export type RestoreMode = 'inspect' | 'continue';

export interface RestoreStartResponse {
  restoreId: string;
  agentSessionId: string;
  runId: string;
  status: 'running';
  requestedMode: RestoreMode;
}

export type RestoreSseEventType = 'restore-status' | 'session-update' | 'terminal';

export type RestoreStreamEvent =
  | {
      type: 'restore-status';
      restoreId: string;
      agentSessionId: string;
      runId: string;
      requestedMode: RestoreMode;
      selectedPrimitive?: 'load' | 'resume';
      status: 'requested' | 'success' | 'failure';
      error?: string;
      at: string;
    }
  | {
      type: 'session-update';
      restoreId: string;
      agentSessionId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: 'terminal';
      restoreId: string;
      agentSessionId: string;
      stream: LogLine['stream'];
      chunk: string;
      at: string;
    };

export type RunInteractionStatus = 'pending' | 'resolved' | 'cancelled';

export interface RunInteraction {
  id: string;
  runId: string;
  kind: 'permission' | 'elicitation';
  status: RunInteractionStatus;
  createdAt: string;
  resolvedAt?: string;
  nodeId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId?: string;
  toolCall?: unknown;
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
  request?: unknown;
  resolution?: unknown;
}

export type ApiRunLogEvent =
  | {
      type: 'terminal';
      runId: string;
      nodeId?: string;
      agentInvocationId?: string;
      stream: LogLine['stream'];
      sequence: number;
      chunk: string;
      createdAt: string;
    }
  | {
      type: 'node_status' | 'run_status' | 'agent_lifecycle' | 'restore_attempt' | 'interaction';
      runId: string;
      [key: string]: unknown;
    };

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

export async function fetchRunLogs(id: string): Promise<ApiRunLogEvent[]> {
  const res = await fetch(`/api/runs/${id}/logs`);
  if (!res.ok) throw new Error(`Run logs ${id} not found`);
  return res.json();
}

export async function fetchAgentSessions(filter: { workflowId?: string; agentServerId?: string } = {}): Promise<AgentSessionRecord[]> {
  const params = new URLSearchParams();
  if (filter.workflowId) params.set('workflowId', filter.workflowId);
  if (filter.agentServerId) params.set('agentServerId', filter.agentServerId);
  const qs = params.toString();
  const res = await fetch(`/api/agent-sessions${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch agent sessions: ${res.status}`);
  return res.json();
}

export async function fetchAgentServers(): Promise<AgentServerEntry[]> {
  const res = await fetch('/api/agent-servers');
  if (!res.ok) throw new Error(`Failed to fetch agent servers: ${res.status}`);
  return res.json();
}

export async function fetchAgentRegistry(): Promise<RegistryIndex> {
  const res = await fetch('/api/agent-servers/registry');
  if (!res.ok) throw new Error(`Failed to fetch ACP registry: ${res.status}`);
  return res.json();
}

export async function saveAgentServer(id: string, settings: AgentServerSettings): Promise<AgentServerEntry[]> {
  const res = await fetch(`/api/agent-servers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to save agent server: ${res.status}`);
  return res.json();
}

export async function removeAgentServer(id: string): Promise<AgentServerEntry[]> {
  const res = await fetch(`/api/agent-servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove agent server: ${res.status}`);
  return res.json();
}

export async function fetchAgentSession(id: string): Promise<AgentSessionRecord> {
  const res = await fetch(`/api/agent-sessions/${id}`);
  if (!res.ok) throw new Error(`Agent session ${id} not found`);
  return res.json();
}

export async function restoreAgentSession(id: string, mode: RestoreMode): Promise<RestoreStartResponse> {
  const res = await fetch(`/api/agent-sessions/${id}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`Failed to restore agent session: ${res.status}`);
  return res.json();
}

export async function deleteRun(id: string): Promise<void> {
  await fetch(`/api/runs/${id}`, { method: 'DELETE' });
}

export async function cancelRun(id: string): Promise<void> {
  const res = await fetch(`/api/runs/${id}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to cancel run: ${res.status}`);
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

export async function respondToRunInteraction(
  runId: string,
  interactionId: string,
  response: unknown,
): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/interactions/${interactionId}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(response),
  });
  if (!res.ok) throw new Error(`Failed to respond to interaction: ${res.status}`);
}

export type SseEventType = 'hello' | 'node-status' | 'terminal' | 'run-status' | 'interaction-requested';

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
  source.addEventListener('interaction-requested', handle('interaction-requested'));

  return () => source.close();
}

export function subscribeToRestore(
  restoreId: string,
  onEvent: (type: RestoreSseEventType, data: RestoreStreamEvent) => void,
): () => void {
  const source = new EventSource(`/api/agent-session-restores/${restoreId}/events`);

  const handle = (type: RestoreSseEventType) => (e: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(e.data) as RestoreStreamEvent);
    } catch { /* ignore bad json */ }
  };

  source.addEventListener('restore-status', handle('restore-status'));
  source.addEventListener('session-update', handle('session-update'));
  source.addEventListener('terminal', handle('terminal'));

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

export function apiRunLogsToLogLines(events: ApiRunLogEvent[]): LogLine[] {
  return events
    .filter((event): event is Extract<ApiRunLogEvent, { type: 'terminal' }> => event.type === 'terminal')
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => ({
      chunk: event.chunk,
      nodeId: event.nodeId,
      stream: event.stream,
    }));
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
