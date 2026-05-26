import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentServerConfigFile,
  AgentServerCommand,
  AgentServerEntry,
  AgentServerId,
  AgentServerSettings,
  ResolvedAgentServer,
} from "../types";
import { resolveCustomAcpCommand } from "../sources/custom-acp";
import { resolveRegistryAcpCommand } from "../sources/registry-acp";
import { applySupportedRegistryAgentDefaults } from "../supported-agents";
import { expandHome } from "../util";

export interface AgentServerStoreOptions {
  root: string;
  cacheDir?: string;
}

export class AgentServerStore {
  readonly #root: string;
  readonly #cacheDir: string;
  #settings: Map<AgentServerId, AgentServerSettings> | undefined;

  constructor(options: AgentServerStoreOptions) {
    this.#root = options.root;
    this.#cacheDir = options.cacheDir ?? process.env.SPECFLOW_AGENT_CACHE_DIR ?? join(options.root, ".specflow", "cache", "agents");
  }

  async listAgentServers(): Promise<AgentServerEntry[]> {
    await this.#load();
    return [...this.#settings!.entries()].map(([id, settings]) => ({ id, settings }));
  }

  async resolve(agentServerId: AgentServerId): Promise<ResolvedAgentServer> {
    await this.#load();
    const settings = this.#settings!.get(agentServerId);
    if (!settings) throw new Error(`Unknown agent server: ${agentServerId}`);
    const command = await resolveCommand(settings, this.#cacheDir);
    return { id: agentServerId, source: settings.type, settings, command };
  }

  async #load(): Promise<void> {
    if (this.#settings) return;
    const base = await readConfig(join(this.#root, ".specflow", "agent-servers.json"));
    const local = await readConfig(join(this.#root, ".specflow", "agent-servers.local.json"));
    this.#settings = new Map([
      ...Object.entries(base.agentServers ?? base.agent_servers ?? {}),
      ...Object.entries(local.agentServers ?? local.agent_servers ?? {}),
    ].map(([id, settings]) => [id, applySupportedRegistryAgentDefaults(settings)]));
  }
}

async function resolveCommand(settings: AgentServerSettings, cacheDir: string): Promise<AgentServerCommand> {
  if (settings.type === "custom") return resolveCustomAcpCommand(settings);
  if (settings.type === "registry") return resolveRegistryAcpCommand({ settings, cacheDir });
  return {
    command: expandHome(settings.command),
    args: settings.argsTemplate,
    env: settings.env,
  };
}

async function readConfig(path: string): Promise<AgentServerConfigFile> {
  try {
    return normalizeConfig(JSON.parse(await readFile(path, "utf8")) as AgentServerConfigFile);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw error;
  }
}

function normalizeConfig(config: AgentServerConfigFile): AgentServerConfigFile {
  const normalize = (settings: Record<string, AgentServerSettings> | undefined) => {
    if (!settings) return undefined;
    return Object.fromEntries(
      Object.entries(settings).map(([id, value]) => {
        if (value.type === "registry") {
          const raw = value as RegistryRawSettings;
          return [id, {
            ...value,
            registryId: raw.registryId ?? raw.registry_id ?? id,
            installedVersion: raw.installedVersion ?? raw.installed_version,
            defaultMode: raw.defaultMode ?? raw.default_mode,
            defaultModel: raw.defaultModel ?? raw.default_model,
            defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
            additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
            terminal: normalizeTerminalPolicy(raw.terminal),
            permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
          } satisfies AgentServerSettings];
        }
        if (value.type === "headless") {
          const raw = value as HeadlessRawSettings;
          return [id, {
            ...value,
            argsTemplate: raw.argsTemplate ?? raw.args_template ?? [],
            timeoutMs: raw.timeoutMs ?? raw.timeout_ms,
            defaultMode: raw.defaultMode ?? raw.default_mode,
            defaultModel: raw.defaultModel ?? raw.default_model,
            defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
            additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
            terminal: normalizeTerminalPolicy(raw.terminal),
            permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
          } satisfies AgentServerSettings];
        }
        const raw = value as AgentServerSettings & CommonRawSettings;
        return [id, {
          ...value,
          defaultMode: raw.defaultMode ?? raw.default_mode,
          defaultModel: raw.defaultModel ?? raw.default_model,
          defaultConfigOptions: raw.defaultConfigOptions ?? raw.default_config_options,
          additionalDirectories: raw.additionalDirectories ?? raw.additional_directories,
          terminal: normalizeTerminalPolicy(raw.terminal),
          permissionPolicy: normalizePermissionPolicy(raw.permissionPolicy ?? raw.permission_policy),
        } as AgentServerSettings];
      }),
    );
  };
  return {
    agentServers: normalize(config.agentServers ?? config.agent_servers),
  };
}

function normalizeTerminalPolicy(value: unknown): AgentServerSettings["terminal"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { enabled?: unknown; auth?: unknown };
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.auth === "boolean" ? { auth: raw.auth } : {}),
  };
}

function normalizePermissionPolicy(value: unknown): AgentServerSettings["permissionPolicy"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as {
    mode?: unknown;
    promptTimeoutMs?: unknown;
    prompt_timeout_ms?: unknown;
    onTimeout?: unknown;
    on_timeout?: unknown;
  };
  const mode = raw.mode === "auto_accept" || raw.mode === "auto_deny" || raw.mode === "prompt"
    ? raw.mode
    : "prompt";
  const timeoutRaw = typeof raw.promptTimeoutMs === "number" ? raw.promptTimeoutMs
    : typeof raw.prompt_timeout_ms === "number" ? raw.prompt_timeout_ms
    : undefined;
  const onTimeout = raw.onTimeout === "accept" || raw.onTimeout === "deny" ? raw.onTimeout
    : raw.on_timeout === "accept" || raw.on_timeout === "deny" ? raw.on_timeout
    : undefined;
  return {
    mode,
    ...(typeof timeoutRaw === "number" && timeoutRaw > 0 ? { promptTimeoutMs: timeoutRaw } : {}),
    ...(onTimeout ? { onTimeout } : {}),
  };
}

type CommonRawSettings = {
  default_mode?: string;
  default_model?: string;
  default_config_options?: Record<string, string | boolean>;
  additional_directories?: string[];
  permission_policy?: unknown;
  permissionPolicy?: unknown;
};

type RegistryRawSettings = Extract<AgentServerSettings, { type: "registry" }> & {
  registry_id?: string;
  installed_version?: string;
} & CommonRawSettings;

type HeadlessRawSettings = Extract<AgentServerSettings, { type: "headless" }> & {
  args_template?: string[];
  timeout_ms?: number;
} & CommonRawSettings;
