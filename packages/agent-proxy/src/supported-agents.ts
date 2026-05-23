import type { AgentAuthenticationMethod, AgentServerSettings } from "./types";
import type { RegistryIndex } from "./sources/registry-client";

export type SupportedRegistryAgentId = "codex-acp" | "claude-acp";

export interface SupportedRegistryAgentProfile {
  id: SupportedRegistryAgentId;
  authMethodPreference: string[];
  defaultSettings: Pick<AgentServerSettings, "terminal">;
}

const SUPPORTED_REGISTRY_AGENT_PROFILES: Record<SupportedRegistryAgentId, SupportedRegistryAgentProfile> = {
  "codex-acp": {
    id: "codex-acp",
    authMethodPreference: ["chatgpt", "codex-api-key", "openai-api-key"],
    defaultSettings: { terminal: { enabled: true, auth: true } },
  },
  "claude-acp": {
    id: "claude-acp",
    authMethodPreference: ["claude-ai-login", "console-login", "claude-login", "gateway", "gateway-bedrock"],
    defaultSettings: { terminal: { enabled: true, auth: true } },
  },
};

export function supportedRegistryAgentIds(): SupportedRegistryAgentId[] {
  return Object.keys(SUPPORTED_REGISTRY_AGENT_PROFILES) as SupportedRegistryAgentId[];
}

export function supportedRegistryAgentProfile(id: string): SupportedRegistryAgentProfile | undefined {
  return SUPPORTED_REGISTRY_AGENT_PROFILES[id as SupportedRegistryAgentId];
}

export function assertSupportedRegistryAgent(id: string): void {
  if (!supportedRegistryAgentProfile(id)) {
    throw new Error(`Unsupported registry ACP agent "${id}". Supported agents: ${supportedRegistryAgentIds().join(", ")}`);
  }
}

export function applySupportedRegistryAgentDefaults(settings: AgentServerSettings): AgentServerSettings {
  if (settings.type !== "registry") return settings;
  const profile = supportedRegistryAgentProfile(settings.registryId);
  if (!profile) return settings;
  return {
    ...settings,
    terminal: {
      ...profile.defaultSettings.terminal,
      ...(settings.terminal ?? {}),
    },
  };
}

export function filterSupportedRegistryIndex(index: RegistryIndex): RegistryIndex {
  const supported = new Set(supportedRegistryAgentIds());
  return {
    ...index,
    agents: index.agents.filter((agent) => supported.has(agent.id as SupportedRegistryAgentId)),
  };
}

export function choosePreferredAuthMethod(
  agentServerId: string,
  methods: AgentAuthenticationMethod[],
): AgentAuthenticationMethod | undefined {
  const profile = supportedRegistryAgentProfile(agentServerId);
  for (const id of profile?.authMethodPreference ?? []) {
    const method = methods.find((candidate) => candidate.id === id);
    if (method && method.type !== "terminal") return method;
    if (method?.type === "terminal" && method.terminalEnabled) return method;
  }
  return methods.find((method) => method.type === "agent")
    ?? methods.find((method) => method.type === "env_var")
    ?? methods.find((method) => method.type === "terminal" && method.terminalEnabled)
    ?? methods[0];
}
