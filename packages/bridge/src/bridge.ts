import {
  AgentServerStore,
  authenticateAgentServer,
  fetchRegistryIndex,
  filterSupportedRegistryIndex,
  inspectAgentAuthentication,
  restoreAgentSession,
  type AgentRestoreRequest,
  type AgentRestoreResult,
  type AgentAuthenticationStatus,
  type AgentServerEntry,
  type AgentServerSettings,
  type AgentTerminalEvent,
  type RegistryIndex,
} from "@specflow/agent-proxy";
import { RunInteractionStore, TerminalEventStore, WorkflowExecutor } from "./execution";
import { createBridgeRuntime, type BridgeRuntime } from "./runtime";
import { SessionRegistry } from "./sessions";

export type {
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentAuthenticationStatus,
  AgentServerEntry,
  AgentServerSettings,
  AgentTerminalEvent,
  RegistryAgent,
  RegistryIndex,
} from "@specflow/agent-proxy";
export {
  assertSupportedRegistryAgent,
  choosePreferredAuthMethod,
  supportedRegistryAgentIds,
  supportedRegistryAgentProfile,
} from "@specflow/agent-proxy";

export interface SpecflowBridge {
  runtime: BridgeRuntime;
  sessions: SessionRegistry;
  terminalEvents: TerminalEventStore;
  interactions: RunInteractionStore;
  executor: WorkflowExecutor;
  restoreAgentSession(request: AgentRestoreRequest): Promise<AgentRestoreResult>;
  inspectAgentAuthentication(root: string, agentServerId: string): Promise<AgentAuthenticationStatus>;
  authenticateAgentServer(
    root: string,
    agentServerId: string,
    methodId: string,
    onTerminalEvent?: (event: AgentTerminalEvent) => void,
  ): Promise<AgentAuthenticationStatus>;
  ensureAgentServerInstalled(root: string, agentServerId: string): Promise<void>;
  listAgentServers(root: string): Promise<AgentServerEntry[]>;
  listAgentRegistry(root: string): Promise<RegistryIndex>;
}

export function createSpecflowBridge(): SpecflowBridge {
  const terminalEvents = new TerminalEventStore();
  const interactions = new RunInteractionStore();
  const executor = new WorkflowExecutor({ terminalEvents, interactions });

  return {
    runtime: createBridgeRuntime(),
    sessions: new SessionRegistry(),
    terminalEvents,
    interactions,
    executor,
    restoreAgentSession,
    inspectAgentAuthentication,
    authenticateAgentServer,
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
