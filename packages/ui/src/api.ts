import type { Session, WorkflowNode, Edge, Workflow, Run, RunState, Variable, LogLine, TimelineEvent } from './types';

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
  pausedNodeId?: string;
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
  parentSpecflowSessionId?: string;
  agentId: string;
  agentServerId: string;
  acpSessionId: string;
  acpSupportsLoadSession: boolean;
  acpSupportsResumeSession: boolean;
  acpSupportsForkSession: boolean;
  acpSessionForked: boolean;
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

export interface AgentAuthenticationEnvVar {
  name: string;
  label?: string;
  secret: boolean;
  optional: boolean;
}

export type AgentAuthenticationMethod =
  | { type: 'agent'; id: string; name: string; description?: string }
  | {
      type: 'env_var';
      id: string;
      name: string;
      description?: string;
      link?: string;
      vars: AgentAuthenticationEnvVar[];
      missingVars: string[];
    }
  | {
      type: 'terminal';
      id: string;
      name: string;
      description?: string;
      terminalEnabled: boolean;
    };

export interface AgentAuthenticationStatus {
  agentServerId: string;
  needsAuth: boolean;
  methods: AgentAuthenticationMethod[];
}

export class AgentAuthenticationRequiredError extends Error {
  readonly statuses: AgentAuthenticationStatus[];

  constructor(statuses: AgentAuthenticationStatus[]) {
    super('Agent authentication required');
    this.name = 'AgentAuthenticationRequiredError';
    this.statuses = statuses;
  }
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

export type RestoreSseEventType = 'restore-status' | 'session-update' | 'terminal' | 'interaction-requested';

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
    }
  | {
      type: 'interaction-requested';
      restoreId: string;
      interaction: RunInteraction;
      at: string;
    };

export type RunInteractionStatus = 'pending' | 'resolved' | 'cancelled';

export interface PausedNodeSession {
  runId: string;
  nodeId: string;
  specflowSessionId: string;
  agentServerId: string;
  pausedAt: string;
}

export interface RunInteraction {
  id: string;
  runId: string;
  kind: 'permission' | 'elicitation';
  status: RunInteractionStatus;
  createdAt: string;
  resolvedAt?: string;
  nodeId?: string;
  nodeRunId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId?: string;
  toolCall?: unknown;
  options?: Array<{ optionId: string; name?: string; kind?: string }>;
  timeoutAt?: string;
  timeoutAction?: 'accept' | 'deny';
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
      type: 'session_update';
      runId: string;
      nodeId?: string;
      agentInvocationId: string;
      sessionId: string;
      update: unknown;
      at: string;
    }
  | {
      type: 'node_status';
      runId: string;
      nodeId: string;
      gateDecision?: { branchId: string; reason?: string };
      gateBranches?: Array<{ branchId: string; label: string; traversalsUsed: number; maxTraversals: number; available: boolean }>;
      [key: string]: unknown;
    }
  | {
      type: 'run_status' | 'agent_lifecycle' | 'restore_attempt' | 'interaction';
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
  if (!res.ok) throw new Error(await apiError(res, `Failed to load canvas ${id}`));
  return res.json();
}

export async function saveCanvas(id: string, doc: CanvasDoc): Promise<void> {
  const res = await fetch(`/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(await apiError(res, `Failed to save canvas ${id}`));
}

export async function uploadCanvasAssets(
  id: string,
  kind: 'image' | 'path',
  files: File[],
  directory = false,
): Promise<{ paths: string[]; images?: Array<{ path: string; label?: string; mimeType?: string }> }> {
  const body = new FormData();
  for (const file of files) {
    body.append('files', file, file.name);
    body.append('relativePaths', (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
  }
  const res = await fetch(`/api/canvases/${id}/assets?kind=${kind}&directory=${directory}`, { method: 'POST', body });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to import assets'));
  return res.json();
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
  if (!res.ok) await throwRunStartError(res, 'Failed to start run');
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

export async function fetchAgentServerAuth(id: string): Promise<AgentAuthenticationStatus> {
  const res = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/auth`);
  if (!res.ok) throw new Error(await apiError(res, `Failed to inspect auth for ${id}`));
  return res.json();
}

export async function authenticateAgentServer(
  id: string,
  methodId: string,
  env: Record<string, string> = {},
): Promise<AgentAuthenticationStatus> {
  const res = await fetch(`/api/agent-servers/${encodeURIComponent(id)}/auth/${encodeURIComponent(methodId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ env }),
  });
  if (!res.ok) throw new Error(await apiError(res, `Failed to authenticate ${id}`));
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

export async function promptRestoredSession(restoreId: string, prompt: string): Promise<{ output: string }> {
  const res = await fetch(`/api/agent-session-restores/${restoreId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to prompt restored session'));
  return res.json();
}

export async function closeRestoredSession(restoreId: string): Promise<void> {
  const res = await fetch(`/api/agent-session-restores/${restoreId}/close`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to close restored session'));
}

export async function cancelRestoredSession(restoreId: string): Promise<void> {
  const res = await fetch(`/api/agent-session-restores/${restoreId}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to cancel restored session'));
}

export async function fetchPausedNodes(runId: string): Promise<PausedNodeSession[]> {
  const res = await fetch(`/api/runs/${runId}/paused-nodes`);
  if (!res.ok) throw new Error(await apiError(res, 'Failed to fetch paused nodes'));
  return res.json();
}

export interface ResumableSessionSuggestion {
  agentSessionId: string;
  acpSessionId: string;
  agentServerId: string;
  nodeId?: string;
  continuationPrompt: string;
  canLoad: boolean;
  canResume: boolean;
}

export async function fetchResumableSession(runId: string): Promise<ResumableSessionSuggestion | undefined> {
  const res = await fetch(`/api/runs/${runId}/resumable-session`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(await apiError(res, 'Failed to look up resumable session'));
  return res.json();
}

export async function promptPausedNode(runId: string, nodeId: string, prompt: string): Promise<{ output: string }> {
  const res = await fetch(`/api/runs/${runId}/paused-nodes/${nodeId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to prompt paused node'));
  return res.json();
}

export async function continuePausedNode(runId: string, nodeId: string): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/paused-nodes/${nodeId}/continue`, { method: 'POST' });
  if (!res.ok) throw new Error(await apiError(res, 'Failed to continue paused node'));
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
  if (!res.ok) await throwRunStartError(res, 'Failed to re-run');
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

export type SseEventType = 'hello' | 'node-status' | 'terminal' | 'session-update' | 'run-status' | 'interaction-requested';

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
  source.addEventListener('session-update', handle('session-update'));
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
  source.addEventListener('interaction-requested', handle('interaction-requested'));

  return () => source.close();
}

async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    return body.error || `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

async function throwRunStartError(res: Response, fallback: string): Promise<never> {
  let body: { error?: string; authStatuses?: AgentAuthenticationStatus[] } = {};
  try {
    body = await res.json();
  } catch {
    // Fall through to the status-based error below.
  }
  if (body.authStatuses?.length) {
    throw new AgentAuthenticationRequiredError(body.authStatuses);
  }
  throw new Error(body.error || `${fallback}: ${res.status}`);
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
    pausedNodeId: rec.pausedNodeId,
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

export function apiRunLogsToTimelineEvents(events: ApiRunLogEvent[]): TimelineEvent[] {
  return events
    .flatMap((event): TimelineEvent[] => {
      if (event.type === 'terminal') {
        return [{
          type: 'terminal',
          chunk: event.chunk,
          nodeId: event.nodeId,
          agentInvocationId: event.agentInvocationId,
          stream: event.stream,
        }];
      }
      if (event.type === 'session_update') {
        return [{
          type: 'session-update',
          update: event.update,
          nodeId: event.nodeId,
          agentInvocationId: event.agentInvocationId,
          sessionId: event.sessionId,
        }];
      }
      if (event.type === 'node_status' && event.gateDecision) {
        return [{
          type: 'gate-decision',
          nodeId: event.nodeId,
          branchId: event.gateDecision.branchId,
          reason: event.gateDecision.reason,
          branches: event.gateBranches,
        }];
      }
      return [];
    });
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
