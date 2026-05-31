import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentAvailableCommand,
  AgentServerCapabilitiesCache,
  AgentServerCommand,
  AgentServerEntry,
  AgentServerId,
  AgentServerSettings,
  ResolvedAgentServer,
} from "../types";
import { resolveCustomAcpCommand } from "../sources/custom-acp";
import { resolveRegistryAcpCommand } from "../sources/registry-acp";
import { expandHome } from "../util";

export interface AgentServerStoreOptions {
  root: string;
  cacheDir?: string;
}

interface CapabilitiesCacheFile {
  capabilities?: Record<AgentServerId, AgentServerCapabilitiesCache>;
}

export class AgentServerStore {
  readonly #root: string;
  readonly #cacheDir: string;
  readonly #capabilitiesFile: string;
  #settings: Map<AgentServerId, AgentServerSettings> | undefined;
  #capabilities: Map<AgentServerId, AgentServerCapabilitiesCache> | undefined;

  constructor(options: AgentServerStoreOptions) {
    this.#root = options.root;
    this.#cacheDir = options.cacheDir ?? process.env.SPECFLOW_AGENT_CACHE_DIR ?? join(options.root, ".specflow", "cache", "agents");
    this.#capabilitiesFile = join(this.#cacheDir, "capabilities.json");
  }

  async listAgentServers(): Promise<AgentServerEntry[]> {
    await this.#load();
    await this.#loadCapabilities();
    return [...this.#settings!.entries()].map(([id, settings]) => {
      const entry: AgentServerEntry = { id, settings };
      const cached = this.#capabilities!.get(id);
      if (cached && capabilityCacheStillValid(cached, settings)) {
        entry.capabilities = cached;
      }
      return entry;
    });
  }

  async resolve(agentServerId: AgentServerId): Promise<ResolvedAgentServer> {
    await this.#load();
    const settings = this.#settings!.get(agentServerId);
    if (!settings) throw new Error(`Unknown agent server: ${agentServerId}`);
    const command = await resolveCommand(settings, this.#cacheDir);
    return { id: agentServerId, source: settings.type, settings, command };
  }

  /**
   * Look up cached capabilities for an agent server. Returns undefined when
   * either no probe has run yet, or the cached probe pre-dates the current
   * installedVersion. Stale entries are not auto-removed here — call
   * `clearCapabilities` if you want them gone from disk.
   */
  async getCapabilities(agentServerId: AgentServerId): Promise<AgentServerCapabilitiesCache | undefined> {
    await this.#load();
    await this.#loadCapabilities();
    const settings = this.#settings!.get(agentServerId);
    if (!settings) return undefined;
    const cached = this.#capabilities!.get(agentServerId);
    if (!cached) return undefined;
    if (!capabilityCacheStillValid(cached, settings)) return undefined;
    return cached;
  }

  /**
   * Persist a freshly probed capability snapshot. Overwrites any prior
   * entry for the same agent server. Auto-stamps installedVersion from
   * the resolved settings so invalidation works on the next read.
   */
  async setCapabilities(agentServerId: AgentServerId, snapshot: Omit<AgentServerCapabilitiesCache, "installedVersion" | "probedAt"> & {
    probedAt?: string;
  }): Promise<void> {
    await this.#load();
    await this.#loadCapabilities();
    const settings = this.#settings!.get(agentServerId);
    const installedVersion = installedVersionOf(settings);
    const entry: AgentServerCapabilitiesCache = {
      probedAt: snapshot.probedAt ?? new Date().toISOString(),
      installedVersion,
      agentCapabilities: snapshot.agentCapabilities,
      modes: snapshot.modes,
      configOptions: snapshot.configOptions,
      availableCommands: snapshot.availableCommands,
    };
    this.#capabilities!.set(agentServerId, entry);
    await this.#writeCapabilities();
  }

  async clearCapabilities(agentServerId: AgentServerId): Promise<void> {
    await this.#loadCapabilities();
    if (!this.#capabilities!.delete(agentServerId)) return;
    await this.#writeCapabilities();
  }

  async #load(): Promise<void> {
    if (this.#settings) return;
    const base = await readConfig(join(this.#root, ".specflow", "agent-servers.json"));
    const local = await readConfig(join(this.#root, ".specflow", "agent-servers.local.json"));
    const merged = mergeConfigEntries(configEntries(base), configEntries(local));
    this.#settings = new Map(
      [...merged.entries()]
        .map(([id, settings]) => [id, normalizeSettings(settings)] as const)
        .filter((entry): entry is readonly [string, AgentServerSettings] => Boolean(entry[1])),
    );
  }

  async #loadCapabilities(): Promise<void> {
    if (this.#capabilities) return;
    this.#capabilities = new Map();
    try {
      const raw = await readFile(this.#capabilitiesFile, "utf8");
      const parsed = JSON.parse(raw) as CapabilitiesCacheFile;
      for (const [id, entry] of Object.entries(parsed.capabilities ?? {})) {
        if (!entry || typeof entry !== "object") continue;
        // Trust on-disk shape; this file is owned by the proxy and isn't user-edited.
        this.#capabilities.set(id, entry);
      }
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
  }

  async #writeCapabilities(): Promise<void> {
    const payload: CapabilitiesCacheFile = {
      capabilities: Object.fromEntries(this.#capabilities!.entries()),
    };
    await mkdir(dirname(this.#capabilitiesFile), { recursive: true });
    await writeFile(this.#capabilitiesFile, JSON.stringify(payload, null, 2));
  }
}

function capabilityCacheStillValid(
  cached: AgentServerCapabilitiesCache,
  settings: AgentServerSettings,
): boolean {
  const current = installedVersionOf(settings);
  // Both undefined (custom/headless agents that don't pin a version) →
  // treat as still valid; user must hit refresh after changing command/env.
  return cached.installedVersion === current;
}

function installedVersionOf(settings: AgentServerSettings | undefined): string | undefined {
  if (!settings) return undefined;
  if (settings.type === "registry") return settings.installedVersion;
  return undefined;
}

async function resolveCommand(settings: AgentServerSettings, cacheDir: string): Promise<AgentServerCommand> {
  if (settings.type === "custom") return resolveCustomAcpCommand(settings);
  if (settings.type === "registry") return resolveRegistryAcpCommand({ settings, cacheDir });
  return {
    command: expandHome(settings.command),
    args: settings.argsTemplate,
    cwd: settings.cwd ? expandHome(settings.cwd) : undefined,
    env: settings.env,
  };
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw error;
  }
}

function configEntries(config: Record<string, unknown>): Record<string, unknown> {
  const raw = config.agentServers ?? config.agent_servers;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function mergeConfigEntries(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Map<string, unknown> {
  const merged = new Map(Object.entries(base));
  for (const [id, localSettings] of Object.entries(local)) {
    const baseSettings = merged.get(id);
    merged.set(id, mergeSettings(baseSettings, localSettings));
  }
  return merged;
}

function mergeSettings(base: unknown, local: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(local)) return local;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeSettings(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizeSettings(value: unknown): AgentServerSettings | undefined {
  if (!isPlainObject(value)) return undefined;
  const raw = value as CommonRawSettings;
  const env = recordOfStrings(raw.env);
  const cwd = stringValue(raw.cwd);
  const additionalDirectories = arrayOfStrings(raw.additionalDirectories ?? raw.additional_directories);

  if (raw.type === "registry") {
    const registryId = stringValue(raw.registryId ?? raw.registry_id);
    if (!registryId) return undefined;
    return {
      type: "registry",
      registryId,
      installedVersion: stringValue(raw.installedVersion ?? raw.installed_version),
      cwd,
      env,
      additionalDirectories,
    };
  }

  if (raw.type === "custom") {
    const command = stringValue(raw.command);
    if (!command) return undefined;
    return {
      type: "custom",
      command,
      args: arrayOfStrings(raw.args),
      cwd,
      env,
      additionalDirectories,
    };
  }

  if (raw.type === "headless") {
    const command = stringValue(raw.command);
    if (!command) return undefined;
    return {
      type: "headless",
      command,
      argsTemplate: arrayOfStrings(raw.argsTemplate ?? raw.args_template),
      timeoutMs: numberValue(raw.timeoutMs ?? raw.timeout_ms),
      cwd,
      env,
      additionalDirectories,
    };
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

type CommonRawSettings = Record<string, unknown> & {
  type?: unknown;
  registryId?: unknown;
  registry_id?: unknown;
  installedVersion?: unknown;
  installed_version?: unknown;
  command?: unknown;
  args?: unknown;
  argsTemplate?: unknown;
  args_template?: unknown;
  timeoutMs?: unknown;
  timeout_ms?: unknown;
  cwd?: unknown;
  env?: unknown;
  additionalDirectories?: unknown;
  additional_directories?: unknown;
};

export type { AgentAvailableCommand, AgentServerCapabilitiesCache };
