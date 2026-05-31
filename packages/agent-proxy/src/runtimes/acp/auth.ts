import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentAuthenticationMethod,
  ResolvedAgentServer,
  TerminalAuthTask,
} from "../../types";
import { supportedRegistryAgentProfile } from "../../supported-agents";

export const GEMINI_TERMINAL_AUTH_METHOD_ID = "spawn-gemini-cli";

export function advertisedAuthMethods(
  methods: acp.AuthMethod[] | undefined,
  resolved: ResolvedAgentServer,
): acp.AuthMethod[] {
  if ((methods?.length ?? 0) === 0 && shouldUseGeminiTerminalAuthShim(resolved)) {
    return [geminiTerminalAuthMethod(resolved)];
  }
  return methods ?? [];
}

export function authMethodInfos(
  methods: acp.AuthMethod[],
  resolved: ResolvedAgentServer,
  cwd: string,
): AgentAuthenticationMethod[] {
  return methods.map((method) => {
    const common = {
      id: method.id,
      name: method.name,
      ...("description" in method && method.description ? { description: method.description } : {}),
    };
    if (resolveTerminalAuthTaskFromMethod(resolved, cwd, method)) {
      return {
        ...common,
        type: "terminal",
      };
    }
    if (isEnvAuthMethod(method)) {
      return {
        ...common,
        type: "env_var",
        ...("link" in method && method.link ? { link: method.link } : {}),
        vars: method.vars.map((entry) => ({
          name: entry.name,
          ...(entry.label ? { label: entry.label } : {}),
          secret: entry.secret ?? true,
          optional: entry.optional ?? false,
        })),
        missingVars: missingEnvVars(method, resolved),
      };
    }
    return {
      ...common,
      type: "agent",
    };
  });
}

export function isEnvAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "env_var" }> {
  return "type" in method && method.type === "env_var";
}

export function isTerminalAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "terminal" }> {
  return "type" in method && method.type === "terminal";
}

export function missingEnvVars(method: Extract<acp.AuthMethod, { type: "env_var" }>, resolved: ResolvedAgentServer): string[] {
  const env = { ...process.env, ...(resolved.command.env ?? {}) };
  return method.vars
    .filter((entry) => !entry.optional && !env[entry.name])
    .map((entry) => entry.name);
}

export function resolveTerminalAuthTaskFromMethod(
  resolved: ResolvedAgentServer,
  cwd: string,
  method: acp.AuthMethod,
): TerminalAuthTask | undefined {
  if (isTerminalAuthMethod(method)) {
    return {
      agentServerId: resolved.id,
      methodId: method.id,
      label: method.name,
      command: resolved.command.command,
      args: [...resolved.command.args, ...(method.args ?? [])],
      cwd: resolved.command.cwd ?? cwd,
      env: { ...(resolved.command.env ?? {}), ...(method.env ?? {}) },
      successPatterns: successPatternsForAuthMethod(resolved, method.id),
    };
  }

  const metadata = metadataTerminalAuth(method);
  if (!metadata) return undefined;
  return {
    agentServerId: resolved.id,
    methodId: method.id,
    label: metadata.label,
    command: metadata.command,
    args: metadata.args,
    cwd: resolved.command.cwd ?? cwd,
    env: metadata.env,
    successPatterns: successPatternsForAuthMethod(resolved, method.id),
  };
}

function shouldUseGeminiTerminalAuthShim(resolved: ResolvedAgentServer): boolean {
  const registryId = resolved.settings.type === "registry" ? resolved.settings.registryId : resolved.id;
  return resolved.id === "gemini"
    || registryId === "gemini"
    || Boolean(supportedRegistryAgentProfile(registryId)?.geminiTerminalAuthShim);
}

function geminiTerminalAuthMethod(resolved: ResolvedAgentServer): acp.AuthMethod {
  const args = resolved.command.args.filter((arg) => arg !== "--experimental-acp" && arg !== "--acp");
  return {
    id: GEMINI_TERMINAL_AUTH_METHOD_ID,
    name: "Login",
    description: "Login with your Google or Vertex AI account",
    _meta: {
      "terminal-auth": {
        label: "gemini /auth",
        command: resolved.command.command,
        args,
        env: resolved.command.env ?? {},
      },
    },
  };
}

interface MetadataTerminalAuth {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

function metadataTerminalAuth(method: acp.AuthMethod): MetadataTerminalAuth | undefined {
  const meta = method._meta;
  if (!meta || typeof meta !== "object") return undefined;
  const raw = meta["terminal-auth"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const label = stringValue(value.label);
  const command = stringValue(value.command);
  if (!label || !command) return undefined;
  return {
    label,
    command,
    args: arrayOfStrings(value.args),
    env: recordOfStrings(value.env),
  };
}

function successPatternsForAuthMethod(resolved: ResolvedAgentServer, methodId: string): string[] {
  const patterns: string[] = [];
  const registryId = resolved.settings.type === "registry" ? resolved.settings.registryId : resolved.id;
  if (methodId === "claude-login") patterns.push("Login successful", "Type your message");
  if (methodId === GEMINI_TERMINAL_AUTH_METHOD_ID || registryId === "gemini") {
    patterns.push("Type your message");
  }
  return patterns;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
