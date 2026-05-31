import {
  AgentServerStore,
  authenticateAgentServer,
  fetchRegistryIndex,
  filterSupportedRegistryIndex,
  inspectAgentAuthentication,
  resolveAgentTerminalAuthTask,
  restoreAgentSession,
  openAgentConversation,
  type AgentConversation,
  type AgentRestoreRequest,
  type AgentRestoreResult,
  type AgentAuthenticationStatus,
  type AgentServerEntry,
  type AgentServerSettings,
  type AgentTerminalEvent,
  type TerminalAuthTask,
  type RegistryIndex,
} from "@specflow/agent-proxy";
import {
  RunInteractionStore,
  RunPauseStore,
  TerminalEventStore,
  WorkflowExecutor,
  type PromptTransformer,
} from "./execution";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export type {
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentConversation,
  AgentAuthenticationStatus,
  AgentServerEntry,
  AgentServerSettings,
  AgentTerminalEvent,
  TerminalAuthTask,
  RegistryAgent,
  RegistryIndex,
} from "@specflow/agent-proxy";
export {
  assertSupportedRegistryAgent,
  supportedRegistryAgentIds,
  supportedRegistryAgentProfile,
} from "@specflow/agent-proxy";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  terminalEvents: TerminalEventStore;
  interactions: RunInteractionStore;
  pauses: RunPauseStore;
  executor: WorkflowExecutor;
  restoreAgentSession(request: AgentRestoreRequest): Promise<AgentRestoreResult>;
  openAgentConversation(request: AgentRestoreRequest): Promise<AgentConversation>;
  inspectAgentAuthentication(root: string, agentServerId: string): Promise<AgentAuthenticationStatus>;
  authenticateAgentServer(
    root: string,
    agentServerId: string,
    methodId: string,
  ): Promise<AgentAuthenticationStatus>;
  resolveAgentTerminalAuthTask(root: string, agentServerId: string, methodId: string): Promise<TerminalAuthTask | undefined>;
  ensureAgentServerInstalled(root: string, agentServerId: string): Promise<void>;
  listAgentServers(root: string): Promise<AgentServerEntry[]>;
  listAgentRegistry(root: string): Promise<RegistryIndex>;
}

export interface CreateSpecflowBridgeOptions {
  /**
   * Per-prompt transformer (used by the server to apply slash-command /
   * skill body injection). Receives the rendered prompt and the agent
   * server id, returns the text to actually send.
   */
  promptTransformer?: PromptTransformer;
}

export function createSpecflowBridge(options: CreateSpecflowBridgeOptions = {}): SpecflowBridge {
  const terminalEvents = new TerminalEventStore();
  const interactions = new RunInteractionStore();
  const pauses = new RunPauseStore();
  const executor = new WorkflowExecutor({
    terminalEvents,
    interactions,
    pauses,
    promptTransformer: options.promptTransformer,
  });

  return {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    terminalEvents,
    interactions,
    pauses,
    executor,
    restoreAgentSession,
    openAgentConversation,
    inspectAgentAuthentication,
    authenticateAgentServer,
    resolveAgentTerminalAuthTask,
    ensureAgentServerInstalled,
    listAgentServers,
    listAgentRegistry,
  };
}

async function listAgentServers(root: string): Promise<AgentServerEntry[]> {
  return new AgentServerStore({ root }).listAgentServers();
}

async function ensureAgentServerInstalled(root: string, agentServerId: string): Promise<void> {
  await new AgentServerStore({ root }).resolve(agentServerId);
}

async function listAgentRegistry(root: string): Promise<RegistryIndex> {
  void root;
  return filterSupportedRegistryIndex(await fetchRegistryIndex());
}
