import { AgentServerStore } from "./store/agent-server-store";
import type {
  AgentAuthenticationStatus,
  AgentConversation,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentRunRequest,
  AgentRunResult,
  TerminalAuthTask,
} from "./types";
import {
  authenticateAcpAgent,
  inspectAcpAgentAuthentication,
  probeAcpAgentCapabilities,
  resolveAcpTerminalAuthTask,
  restoreAcpAgentSession,
  AcpRestoredConversation,
  runAcpAgent,
} from "./runtimes/acp/connection";
import { runHeadlessAgent } from "./runtimes/headless/command";
import { withPolicyDirectories } from "./runtime-policy";
export { AgentProxySessionPool } from "./session-pool";

export type AgentCommandRequest = AgentRunRequest;
export type AgentCommandResult = AgentRunResult;
export type { AgentRestoreRequest, AgentRestoreResult, AgentRunRequest, AgentRunResult };
export type {
  AgentAvailableCommand,
  AgentConversation,
  AgentConversationPromptResult,
  AgentPermissionRequest,
  AgentPermissionResult,
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentLifecycleEvent,
  AgentServerCapabilitiesCache,
  AgentServerCommand,
  AgentServerConfigFile,
  AgentServerSettings,
  AgentSessionUpdateEvent,
  AgentTerminalEvent,
  AgentTerminalStream,
  TerminalAuthTask,
} from "./types";
export { AgentServerStore };
export { probeAcpAgentCapabilities };

export async function runAgentCommand(request: AgentRunRequest): Promise<AgentRunResult> {
  const store = new AgentServerStore({ root: request.cwd });
  const resolved = await store.resolve(request.agentServerId);
  if (resolved.source === "headless") {
    return runHeadlessAgent(resolved, request);
  }
  return runAcpAgent(resolved, withPolicyDirectories(resolved, request), {
    onCapabilities: (probe) => store.setCapabilities(request.agentServerId, probe),
  });
}

export async function restoreAgentSession(request: AgentRestoreRequest): Promise<AgentRestoreResult> {
  const store = new AgentServerStore({ root: request.cwd });
  const resolved = await store.resolve(request.agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime is not implemented: ${request.agentServerId}`);
  }
  return restoreAcpAgentSession(resolved, withPolicyDirectories(resolved, request));
}

export async function openAgentConversation(request: AgentRestoreRequest): Promise<AgentConversation> {
  const store = new AgentServerStore({ root: request.cwd });
  const resolved = await store.resolve(request.agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not support ACP conversations: ${request.agentServerId}`);
  }
  return new AcpRestoredConversation(resolved, withPolicyDirectories(resolved, request));
}

export async function inspectAgentAuthentication(
  root: string,
  agentServerId: string,
): Promise<AgentAuthenticationStatus> {
  const resolved = await new AgentServerStore({ root }).resolve(agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not advertise ACP authentication: ${agentServerId}`);
  }
  return inspectAcpAgentAuthentication(resolved, root);
}

export async function authenticateAgentServer(
  root: string,
  agentServerId: string,
  methodId: string,
): Promise<AgentAuthenticationStatus> {
  const resolved = await new AgentServerStore({ root }).resolve(agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not advertise ACP authentication: ${agentServerId}`);
  }
  return authenticateAcpAgent(resolved, root, methodId);
}

export async function resolveAgentTerminalAuthTask(
  root: string,
  agentServerId: string,
  methodId: string,
): Promise<TerminalAuthTask | undefined> {
  const resolved = await new AgentServerStore({ root }).resolve(agentServerId);
  if (resolved.source === "headless") {
    throw new Error(`Headless agent runtime does not advertise ACP authentication: ${agentServerId}`);
  }
  return resolveAcpTerminalAuthTask(resolved, root, methodId);
}
