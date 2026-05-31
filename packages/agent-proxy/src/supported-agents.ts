import type { RegistryIndex } from "./sources/registry-client";

export type SupportedRegistryAgentId = "codex-acp" | "claude-acp" | "gemini";

export interface SupportedRegistryAgentProfile {
  id: SupportedRegistryAgentId;
  geminiTerminalAuthShim?: boolean;
}

const SUPPORTED_REGISTRY_AGENT_PROFILES: Record<SupportedRegistryAgentId, SupportedRegistryAgentProfile> = {
  "codex-acp": {
    id: "codex-acp",
  },
  "claude-acp": {
    id: "claude-acp",
  },
  "gemini": {
    id: "gemini",
    geminiTerminalAuthShim: true,
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

export function filterSupportedRegistryIndex(index: RegistryIndex): RegistryIndex {
  const supported = new Set(supportedRegistryAgentIds());
  return {
    ...index,
    agents: index.agents.filter((agent) => supported.has(agent.id as SupportedRegistryAgentId)),
  };
}
