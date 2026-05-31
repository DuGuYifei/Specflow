import {
  createSpecflowBridge,
  type AgentAuthenticationStatus,
  type AgentServerEntry,
} from "@specflow/bridge";

export async function listAgentServers(root: string): Promise<AgentServerEntry[]> {
  return createSpecflowBridge().listAgentServers(root);
}

export async function ensureAgentServerInstalled(root: string, agentServerId: string): Promise<void> {
  await createSpecflowBridge().ensureAgentServerInstalled(root, agentServerId);
}

export async function inspectAgentServerAuthentication(
  root: string,
  agentServerId: string,
): Promise<AgentAuthenticationStatus> {
  return createSpecflowBridge().inspectAgentAuthentication(root, agentServerId);
}

export async function authenticateAgentServer(
  root: string,
  agentServerId: string,
  methodId: string,
): Promise<AgentAuthenticationStatus> {
  return createSpecflowBridge().authenticateAgentServer(root, agentServerId, methodId);
}
