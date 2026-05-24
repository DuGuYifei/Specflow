import type {
  CompleteElicitationNotification,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  InitializeResponse,
  LoadSessionResponse,
  McpServer,
  PromptResponse,
  ResumeSessionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";

export type AgentServerId = string;

export type AgentServerSource = "custom" | "registry" | "headless";

export interface AgentServerCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface BaseAgentServerSettings {
  defaultMode?: string | null;
  defaultModel?: string | null;
  defaultConfigOptions?: Record<string, string | boolean>;
  env?: Record<string, string>;
  additionalDirectories?: string[];
  terminal?: {
    enabled?: boolean;
    auth?: boolean;
  };
}

export interface CustomAcpAgentServerSettings extends BaseAgentServerSettings {
  type: "custom";
  command: string;
  args?: string[];
}

export interface RegistryAcpAgentServerSettings extends BaseAgentServerSettings {
  type: "registry";
  registryId: string;
  installedVersion?: string;
}

export interface HeadlessAgentServerSettings extends BaseAgentServerSettings {
  type: "headless";
  command: string;
  argsTemplate: string[];
  timeoutMs?: number;
}

export type AgentServerSettings =
  | CustomAcpAgentServerSettings
  | RegistryAcpAgentServerSettings
  | HeadlessAgentServerSettings;

export interface AgentServerConfigFile {
  agentServers?: Record<AgentServerId, AgentServerSettings>;
  agent_servers?: Record<AgentServerId, AgentServerSettings>;
}

export type AgentTerminalStream = "stdout" | "stderr" | "system";

export interface AgentTerminalEvent {
  stream: AgentTerminalStream;
  chunk: string;
}

export interface AgentPermissionSelection {
  outcome: "selected";
  optionId: string;
}

export interface AgentPermissionCancelled {
  outcome: "cancelled";
}

export type AgentPermissionResult = AgentPermissionSelection | AgentPermissionCancelled;

export interface AgentPermissionRequest {
  sessionId: string;
  toolCall: unknown;
  options: Array<{ optionId: string; name?: string; kind?: string }>;
  raw: unknown;
}

export interface AgentSessionUpdateEvent {
  sessionId: string;
  update: SessionNotification["update"];
}

export type AgentLifecycleEvent =
  | { type: "process_started"; agentServerId: AgentServerId; command: string; args: string[]; at: string }
  | { type: "initialized"; agentServerId: AgentServerId; protocolVersion: number; at: string }
  | { type: "session_created"; agentServerId: AgentServerId; sessionId: string; at: string }
  | { type: "session_forked"; agentServerId: AgentServerId; sessionId: string; parentSessionId: string; at: string }
  | { type: "prompt_started"; agentServerId: AgentServerId; sessionId: string; messageId?: string; at: string }
  | { type: "prompt_stopped"; agentServerId: AgentServerId; sessionId: string; stopReason?: PromptResponse["stopReason"]; at: string }
  | { type: "prompt_failed"; agentServerId: AgentServerId; sessionId?: string; error: string; at: string }
  | { type: "prompt_cancelled"; agentServerId: AgentServerId; sessionId?: string; at: string }
  | { type: "session_closed"; agentServerId: AgentServerId; sessionId: string; at: string };

export interface AgentRunRequest {
  agentServerId: AgentServerId;
  prompt: string;
  promptBlocks?: ContentBlock[];
  messageId?: string;
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: McpServer[];
  runId?: string;
  workflowSessionId?: string;
  forkFromWorkflowSessionId?: string;
  signal?: AbortSignal;
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  onLifecycleEvent?: (event: AgentLifecycleEvent) => void;
  onPermissionRequest?: (request: AgentPermissionRequest) => Promise<AgentPermissionResult>;
  onSessionUpdate?: (event: AgentSessionUpdateEvent) => void;
  onElicitationRequest?: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>;
  onElicitationComplete?: (notification: CompleteElicitationNotification) => void | Promise<void>;
  onExtMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onExtNotification?: (method: string, params: Record<string, unknown>) => void | Promise<void>;
}

export interface AgentRunResult {
  agentServerId: AgentServerId;
  exitCode: number;
  output: string;
  sessionId?: string;
  stopReason?: PromptResponse["stopReason"];
  initializeResponse?: InitializeResponse;
  workflowSessionId?: string;
  parentWorkflowSessionId?: string;
  sessionForked?: boolean;
}

export type AgentRestoreMode = "inspect" | "continue";
export type AgentRestorePrimitive = "load" | "resume";

export interface AgentRestoreRequest {
  agentServerId: AgentServerId;
  sessionId: string;
  mode: AgentRestoreMode;
  cwd: string;
  additionalDirectories?: string[];
  mcpServers?: McpServer[];
  signal?: AbortSignal;
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  onSessionUpdate?: (event: AgentSessionUpdateEvent) => void;
  onPermissionRequest?: (request: AgentPermissionRequest) => Promise<AgentPermissionResult>;
  onElicitationRequest?: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>;
  onElicitationComplete?: (notification: CompleteElicitationNotification) => void | Promise<void>;
  onExtMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onExtNotification?: (method: string, params: Record<string, unknown>) => void | Promise<void>;
}

export interface AgentRestoreResult {
  agentServerId: AgentServerId;
  sessionId: string;
  selectedPrimitive: AgentRestorePrimitive;
  initializeResponse: InitializeResponse;
  loadResponse?: LoadSessionResponse;
  resumeResponse?: ResumeSessionResponse;
}

export interface AgentConversationPromptResult {
  output: string;
  stopReason?: PromptResponse["stopReason"];
}

export interface AgentConversation {
  restore(): Promise<AgentRestoreResult>;
  prompt(prompt: string, signal?: AbortSignal): Promise<AgentConversationPromptResult>;
  close(): Promise<void>;
}

export interface ResolvedAgentServer {
  id: AgentServerId;
  source: AgentServerSource;
  command: AgentServerCommand;
  settings: AgentServerSettings;
}

export interface AgentServerRegistryStatus {
  registryId: string;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
}

export interface AgentServerEntry {
  id: AgentServerId;
  settings: AgentServerSettings;
  registry?: AgentServerRegistryStatus;
}

export interface AgentAuthenticationEnvVar {
  name: string;
  label?: string;
  secret: boolean;
  optional: boolean;
}

export type AgentAuthenticationMethod =
  | {
      type: "agent";
      id: string;
      name: string;
      description?: string;
    }
  | {
      type: "env_var";
      id: string;
      name: string;
      description?: string;
      link?: string;
      vars: AgentAuthenticationEnvVar[];
      missingVars: string[];
    }
  | {
      type: "terminal";
      id: string;
      name: string;
      description?: string;
      terminalEnabled: boolean;
    };

export interface AgentAuthenticationStatus {
  agentServerId: AgentServerId;
  needsAuth: boolean;
  methods: AgentAuthenticationMethod[];
}
