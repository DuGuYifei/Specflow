import { join } from "node:path";
import type { AgentServerCommand, RegistryAcpAgentServerSettings } from "../types";
import {
  ensureCacheDir,
  loadRegistryIndex,
  packageTargetCommand,
  type RegistryAgent,
} from "./registry-client";
import { resolveBinaryTarget } from "./registry-download";
import { normalizeEnv } from "../util";
import { assertSupportedRegistryAgent } from "../supported-agents";

export async function resolveRegistryAcpCommand(input: {
  settings: RegistryAcpAgentServerSettings;
  cacheDir: string;
}): Promise<AgentServerCommand> {
  assertSupportedRegistryAgent(input.settings.registryId);
  const cacheDir = await ensureCacheDir(input.cacheDir);
  const index = await loadRegistryIndex(cacheDir);
  const agent = index.agents.find((candidate) => candidate.id === input.settings.registryId);
  if (!agent) {
    throw new Error(`ACP registry agent not found: ${input.settings.registryId}`);
  }
  return resolveRegistryDistribution(agent, cacheDir, normalizeEnv(input.settings.env));
}

async function resolveRegistryDistribution(
  agent: RegistryAgent,
  cacheDir: string,
  env: Record<string, string>,
): Promise<AgentServerCommand> {
  const platform = platformKey();
  const binary = agent.distribution.binary?.[platform];
  if (binary) {
    return resolveBinaryTarget({
      cacheDir: join(cacheDir, "archives"),
      registryId: agent.id,
      version: agent.version,
      target: binary,
      extraEnv: env,
    });
  }
  if (agent.distribution.npx) return packageTargetCommand("npx", agent.distribution.npx, env);
  if (agent.distribution.uvx) return packageTargetCommand("uvx", agent.distribution.uvx, env);
  throw new Error(`ACP registry agent has no supported distribution for ${platform}: ${agent.id}`);
}

function platformKey(): string {
  const os = process.platform === "darwin"
    ? "darwin"
    : process.platform === "win32"
      ? "windows"
      : process.platform;
  const arch = process.arch === "x64"
    ? "x86_64"
    : process.arch === "arm64"
      ? "aarch64"
      : process.arch;
  return `${os}-${arch}`;
}
