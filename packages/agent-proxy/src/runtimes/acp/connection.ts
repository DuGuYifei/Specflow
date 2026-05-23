import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentRestoreMode,
  AgentRestorePrimitive,
  AgentRestoreRequest,
  AgentRestoreResult,
  AgentRunRequest,
  AgentRunResult,
  AgentAuthenticationMethod,
  AgentAuthenticationStatus,
  AgentTerminalEvent,
  ResolvedAgentServer,
} from "../../types";
import { AcpClientHandlers } from "./client-handlers";

export interface AcpAgentClientOptions {
  resolved: ResolvedAgentServer;
  cwd: string;
  additionalDirectories?: string[];
  onTerminalEvent?: (event: AgentTerminalEvent) => void;
  request: Pick<
    AgentRunRequest,
    | "onPermissionRequest"
    | "onSessionUpdate"
    | "onElicitationRequest"
    | "onElicitationComplete"
    | "onExtMethod"
    | "onExtNotification"
  >;
  appendOutput: (text: string) => void;
}

export class AcpAgentClient {
  readonly connection: acp.ClientSideConnection;
  readonly process: ChildProcessWithoutNullStreams;
  readonly #settings: ResolvedAgentServer["settings"];
  #stderr = "";

  constructor(options: AcpAgentClientOptions) {
    this.#settings = options.resolved.settings;
    const { command } = options.resolved.command;
    const args = options.resolved.command.args;
    this.process = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.resolved.command.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    void this.#captureStderr(options.onTerminalEvent);

    const stream = acp.ndJsonStream(
      Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.process.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    const handlers = new AcpClientHandlers({
      cwd: options.cwd,
      additionalDirectories: options.additionalDirectories,
      terminalEnabled: options.resolved.settings.terminal?.enabled ?? true,
      appendOutput: options.appendOutput,
      onTerminalEvent: options.onTerminalEvent,
      onPermissionRequest: options.request.onPermissionRequest,
      onSessionUpdate: options.request.onSessionUpdate,
      onElicitationRequest: options.request.onElicitationRequest,
      onElicitationComplete: options.request.onElicitationComplete,
      onExtMethod: options.request.onExtMethod,
      onExtNotification: options.request.onExtNotification,
    });
    this.connection = new acp.ClientSideConnection(() => handlers, stream);
  }

  get stderr(): string {
    return this.#stderr;
  }

  async initialize(): Promise<acp.InitializeResponse> {
    const terminalEnabled = this.#terminalEnabled();
    const terminalAuthEnabled = terminalEnabled && (this.#terminalAuthEnabled());
    return this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: terminalEnabled,
        auth: { terminal: terminalAuthEnabled },
        elicitation: { form: {}, url: {} },
        positionEncodings: ["utf-8", "utf-16", "utf-32"],
        _meta: {
          terminal_output: terminalEnabled,
          "terminal-auth": terminalAuthEnabled,
        },
      },
      clientInfo: {
        name: "specflow",
        title: "Specflow",
        version: "0.0.0",
      },
    });
  }

  kill(): void {
    this.process.kill();
  }

  #terminalEnabled(): boolean {
    return this.#settings.terminal?.enabled ?? true;
  }

  #terminalAuthEnabled(): boolean {
    return this.#settings.terminal?.auth ?? false;
  }

  async close(): Promise<void> {
    this.process.stdin.end();
    await Promise.race([
      onceExit(this.process),
      this.connection.closed,
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
    this.process.kill();
    await Promise.all([
      Promise.race([
        onceExit(this.process),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]),
      Promise.race([
        this.connection.closed,
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]),
    ]);
  }

  async #captureStderr(onTerminalEvent?: (event: AgentTerminalEvent) => void): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of this.process.stderr) {
      const text = decoder.decode(chunk, { stream: true });
      this.#stderr += text;
      onTerminalEvent?.({ stream: "stderr", chunk: text });
    }
  }
}

interface AcpSessionTurn {
  request: AgentRunRequest;
  output: string;
}

export class AcpAgentSession {
  readonly #resolved: ResolvedAgentServer;
  readonly #cwd: string;
  readonly #additionalDirectories: string[] | undefined;
  readonly #client: AcpAgentClient;
  #sessionId: string | undefined;
  #initializeResponse: acp.InitializeResponse | undefined;
  #currentTurn: AcpSessionTurn | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(input: {
    resolved: ResolvedAgentServer;
    cwd: string;
    additionalDirectories?: string[];
  }) {
    this.#resolved = input.resolved;
    this.#cwd = input.cwd;
    this.#additionalDirectories = input.additionalDirectories;
    this.#client = new AcpAgentClient({
      resolved: input.resolved,
      cwd: input.cwd,
      additionalDirectories: input.additionalDirectories,
      onTerminalEvent: (event) => this.#currentTurn?.request.onTerminalEvent?.(event),
      request: {
        onPermissionRequest: (request) => {
          return this.#currentTurn?.request.onPermissionRequest?.(request) ?? Promise.resolve({ outcome: "cancelled" });
        },
        onSessionUpdate: (event) => this.#currentTurn?.request.onSessionUpdate?.(event),
        onElicitationRequest: (request) => {
          return this.#currentTurn?.request.onElicitationRequest?.(request) ?? Promise.resolve({ action: "cancel" });
        },
        onElicitationComplete: (notification) => this.#currentTurn?.request.onElicitationComplete?.(notification),
        onExtMethod: (method, params) => {
          const handler = this.#currentTurn?.request.onExtMethod;
          if (!handler) throw acp.RequestError.methodNotFound(method);
          return handler(method, params);
        },
        onExtNotification: (method, params) => this.#currentTurn?.request.onExtNotification?.(method, params),
      },
      appendOutput: (text) => {
        if (this.#currentTurn) this.#currentTurn.output += text;
      },
    });
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  async start(request: AgentRunRequest): Promise<void> {
    request.onLifecycleEvent?.({
      type: "process_started",
      agentServerId: request.agentServerId,
      command: this.#resolved.command.command,
      args: this.#resolved.command.args,
      at: new Date().toISOString(),
    });
    this.#initializeResponse = await this.#client.initialize();
    request.onLifecycleEvent?.({
      type: "initialized",
      agentServerId: request.agentServerId,
      protocolVersion: this.#initializeResponse.protocolVersion,
      at: new Date().toISOString(),
    });
    if (this.#initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${this.#initializeResponse.protocolVersion}`);
    }
    const session = await this.#client.connection.newSession({
      cwd: this.#cwd,
      additionalDirectories: this.#additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    });
    this.#sessionId = session.sessionId;
    request.onLifecycleEvent?.({
      type: "session_created",
      agentServerId: request.agentServerId,
      sessionId: this.#sessionId,
      at: new Date().toISOString(),
    });
    await applySessionDefaults(this.#client.connection, this.#sessionId, session, this.#resolved);
  }

  async prompt(request: AgentRunRequest): Promise<AgentRunResult> {
    const run = this.#queue.then(() => this.#prompt(request));
    this.#queue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#queue.catch(() => {});
    if (this.#sessionId) {
      await this.#client.connection.closeSession({ sessionId: this.#sessionId }).catch(() => {});
    }
    await this.#client.close();
  }

  async #prompt(request: AgentRunRequest): Promise<AgentRunResult> {
    if (this.#closed) throw new Error("ACP session is already closed.");
    if (!this.#sessionId) throw new Error("ACP session has not been started.");

    const sessionId = this.#sessionId;
    const turn: AcpSessionTurn = { request, output: "" };
    this.#currentTurn = turn;
    const abort = () => {
      void this.#client.connection.cancel({ sessionId });
    };
    request.signal?.addEventListener("abort", abort);

    try {
      if (request.signal?.aborted) {
        await this.#client.connection.cancel({ sessionId });
        throw new Error("ACP prompt cancelled before start.");
      }

      request.onLifecycleEvent?.({
        type: "prompt_started",
        agentServerId: request.agentServerId,
        sessionId,
        messageId: request.messageId,
        at: new Date().toISOString(),
      });
      const promptResult = await this.#client.connection.prompt({
        sessionId,
        messageId: request.messageId,
        prompt: preparePromptBlocks(request, this.#initializeResponse),
      });
      request.onLifecycleEvent?.({
        type: "prompt_stopped",
        agentServerId: request.agentServerId,
        sessionId,
        stopReason: promptResult.stopReason,
        at: new Date().toISOString(),
      });
      request.onTerminalEvent?.({
        stream: "system",
        chunk: `[acp:stop] ${promptResult.stopReason}\n`,
      });
      return {
        agentServerId: request.agentServerId,
        exitCode: 0,
        output: turn.output,
        sessionId,
        stopReason: promptResult.stopReason,
        initializeResponse: this.#initializeResponse,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (request.signal?.aborted) {
        request.onLifecycleEvent?.({
          type: "prompt_cancelled",
          agentServerId: request.agentServerId,
          sessionId,
          at: new Date().toISOString(),
        });
      } else {
        request.onLifecycleEvent?.({
          type: "prompt_failed",
          agentServerId: request.agentServerId,
          sessionId,
          error: message,
          at: new Date().toISOString(),
        });
      }
      request.onTerminalEvent?.({ stream: "system", chunk: `${message}\n` });
      return {
        agentServerId: request.agentServerId,
        exitCode: 1,
        output: turn.output || message,
        sessionId,
        initializeResponse: this.#initializeResponse,
      };
    } finally {
      request.signal?.removeEventListener("abort", abort);
      this.#currentTurn = undefined;
    }
  }
}

export async function runAcpAgent(
  resolved: ResolvedAgentServer,
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  let output = "";
  let sessionId: string | undefined;
  let initializeResponse: acp.InitializeResponse | undefined;
  const client = new AcpAgentClient({
    resolved,
    cwd: request.cwd,
    additionalDirectories: request.additionalDirectories,
    onTerminalEvent: request.onTerminalEvent,
    request,
    appendOutput(text) { output += text; },
  });

  const abort = () => {
    if (sessionId) void client.connection.cancel({ sessionId });
  };
  request.signal?.addEventListener("abort", abort);

  try {
    request.onLifecycleEvent?.({
      type: "process_started",
      agentServerId: request.agentServerId,
      command: resolved.command.command,
      args: resolved.command.args,
      at: new Date().toISOString(),
    });
    initializeResponse = await client.initialize();
    request.onLifecycleEvent?.({
      type: "initialized",
      agentServerId: request.agentServerId,
      protocolVersion: initializeResponse.protocolVersion,
      at: new Date().toISOString(),
    });
    if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
    }
    const session = await client.connection.newSession({
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    });
    sessionId = session.sessionId;
    request.onLifecycleEvent?.({
      type: "session_created",
      agentServerId: request.agentServerId,
      sessionId,
      at: new Date().toISOString(),
    });
    await applySessionDefaults(client.connection, sessionId, session, resolved);

    if (request.signal?.aborted) {
      await client.connection.cancel({ sessionId });
      throw new Error("ACP prompt cancelled before start.");
    }

    request.onLifecycleEvent?.({
      type: "prompt_started",
      agentServerId: request.agentServerId,
      sessionId,
      messageId: request.messageId,
      at: new Date().toISOString(),
    });
    const promptResult = await client.connection.prompt({
      sessionId,
      messageId: request.messageId,
      prompt: preparePromptBlocks(request, initializeResponse),
    });
    request.onLifecycleEvent?.({
      type: "prompt_stopped",
      agentServerId: request.agentServerId,
      sessionId,
      stopReason: promptResult.stopReason,
      at: new Date().toISOString(),
    });
    request.onTerminalEvent?.({
      stream: "system",
      chunk: `[acp:stop] ${promptResult.stopReason}\n`,
    });
    await client.connection.closeSession({ sessionId }).catch(() => {});
    request.onLifecycleEvent?.({
      type: "session_closed",
      agentServerId: request.agentServerId,
      sessionId,
      at: new Date().toISOString(),
    });
    await client.close();
    return {
      agentServerId: request.agentServerId,
      exitCode: 0,
      output,
      sessionId,
      stopReason: promptResult.stopReason,
      initializeResponse,
    };
  } catch (error) {
    if (sessionId) await client.connection.closeSession({ sessionId }).catch(() => {});
    client.kill();
    const message = error instanceof Error ? error.message : String(error);
    if (request.signal?.aborted) {
      request.onLifecycleEvent?.({
        type: "prompt_cancelled",
        agentServerId: request.agentServerId,
        sessionId,
        at: new Date().toISOString(),
      });
    } else {
      request.onLifecycleEvent?.({
        type: "prompt_failed",
        agentServerId: request.agentServerId,
        sessionId,
        error: message,
        at: new Date().toISOString(),
      });
    }
    request.onTerminalEvent?.({ stream: "system", chunk: `${message}\n` });
    return {
      agentServerId: request.agentServerId,
      exitCode: 1,
      output: output || message,
      sessionId,
      initializeResponse,
    };
  } finally {
    request.signal?.removeEventListener("abort", abort);
  }
}

export function selectAcpRestorePrimitive(
  mode: AgentRestoreMode,
  initializeResponse: acp.InitializeResponse,
): AgentRestorePrimitive {
  const supportsLoad = Boolean(initializeResponse.agentCapabilities?.loadSession);
  const supportsResume = Boolean(initializeResponse.agentCapabilities?.sessionCapabilities?.resume);

  if (mode === "inspect") {
    if (supportsLoad) return "load";
    if (supportsResume) return "resume";
  } else {
    if (supportsResume) return "resume";
    if (supportsLoad) return "load";
  }

  throw new Error(
    `ACP agent does not support session restore. loadSession=${supportsLoad}, resume=${supportsResume}`,
  );
}

export async function restoreAcpAgentSession(
  resolved: ResolvedAgentServer,
  request: AgentRestoreRequest,
): Promise<AgentRestoreResult> {
  const client = new AcpAgentClient({
    resolved,
    cwd: request.cwd,
    additionalDirectories: request.additionalDirectories,
    onTerminalEvent: request.onTerminalEvent,
    request,
    appendOutput() {},
  });
  const abort = () => {
    client.kill();
  };
  request.signal?.addEventListener("abort", abort);

  try {
    const initializeResponse = await client.initialize();
    if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
    }
    const selectedPrimitive = selectAcpRestorePrimitive(request.mode, initializeResponse);
    if (selectedPrimitive === "load") {
      const loadResponse = await raceWithAbort(client.connection.loadSession({
        sessionId: request.sessionId,
        cwd: request.cwd,
        additionalDirectories: request.additionalDirectories,
        mcpServers: request.mcpServers ?? [],
      }), request.signal, "ACP restore cancelled.");
      await client.connection.closeSession({ sessionId: request.sessionId }).catch(() => {});
      await client.close();
      return {
        agentServerId: request.agentServerId,
        sessionId: request.sessionId,
        selectedPrimitive,
        initializeResponse,
        loadResponse,
      };
    }

    const resumeResponse = await raceWithAbort(client.connection.resumeSession({
      sessionId: request.sessionId,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      mcpServers: request.mcpServers ?? [],
    }), request.signal, "ACP restore cancelled.");
    await client.connection.closeSession({ sessionId: request.sessionId }).catch(() => {});
    await client.close();
    return {
      agentServerId: request.agentServerId,
      sessionId: request.sessionId,
      selectedPrimitive,
      initializeResponse,
      resumeResponse,
    };
  } catch (error) {
    client.kill();
    throw error;
  } finally {
    request.signal?.removeEventListener("abort", abort);
    await client.close().catch(() => {});
  }
}

export async function inspectAcpAgentAuthentication(
  resolved: ResolvedAgentServer,
  cwd: string,
): Promise<AgentAuthenticationStatus> {
  const client = createAuthClient(resolved, cwd);
  try {
    const initializeResponse = await client.initialize();
    assertProtocolVersion(initializeResponse);
    return await inspectInitializedAuthentication(client.connection, initializeResponse, resolved, cwd);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function authenticateAcpAgent(
  resolved: ResolvedAgentServer,
  cwd: string,
  methodId: string,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): Promise<AgentAuthenticationStatus> {
  const client = createAuthClient(resolved, cwd, onTerminalEvent);
  try {
    const initializeResponse = await client.initialize();
    assertProtocolVersion(initializeResponse);
    const method = (initializeResponse.authMethods ?? []).find((candidate) => candidate.id === methodId);
    if (!method) {
      throw new Error(`ACP agent "${resolved.id}" does not advertise auth method "${methodId}".`);
    }
    if (isEnvAuthMethod(method)) {
      const missing = missingEnvVars(method, resolved);
      if (missing.length > 0) {
        throw new Error(`ACP agent "${resolved.id}" requires authentication env vars: ${missing.join(", ")}`);
      }
    }
    if (isTerminalAuthMethod(method)) {
      if (!resolved.settings.terminal?.auth) {
        throw new Error(
          `ACP agent "${resolved.id}" requires terminal authentication, but terminal auth is disabled. Set terminal.auth=true on the agent server.`,
        );
      }
      await runTerminalAuthMethod(resolved, cwd, method, onTerminalEvent);
    }
    await client.connection.authenticate({ methodId: method.id });
    return await inspectInitializedAuthentication(client.connection, initializeResponse, resolved, cwd);
  } finally {
    await client.close().catch(() => {});
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, message: string): Promise<T> {
  if (!signal) return promise;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal?.aborted) {
      reject(new Error(message));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error(message)), { once: true });
  });
  return Promise.race([promise, abortPromise]);
}

function createAuthClient(
  resolved: ResolvedAgentServer,
  cwd: string,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): AcpAgentClient {
  return new AcpAgentClient({
    resolved,
    cwd,
    onTerminalEvent,
    request: {},
    appendOutput() {},
  });
}

function assertProtocolVersion(initializeResponse: acp.InitializeResponse): void {
  if (initializeResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
    throw new Error(`Unsupported ACP protocol version: ${initializeResponse.protocolVersion}`);
  }
}

async function inspectInitializedAuthentication(
  connection: acp.ClientSideConnection,
  initializeResponse: acp.InitializeResponse,
  resolved: ResolvedAgentServer,
  cwd: string,
): Promise<AgentAuthenticationStatus> {
  const methods = initializeResponse.authMethods ?? [];
  let needsAuth = !(await canCreateSessionWithoutAuth(connection, cwd));

  if (needsAuth) {
    const configuredEnvMethod = methods.find((method) =>
      isEnvAuthMethod(method) && missingEnvVars(method, resolved).length === 0
    );
    if (configuredEnvMethod) {
      try {
        await connection.authenticate({ methodId: configuredEnvMethod.id });
        needsAuth = !(await canCreateSessionWithoutAuth(connection, cwd));
      } catch {
        // Keep the auth prompt available when a stored credential is rejected.
      }
    }
  }

  return {
    agentServerId: resolved.id,
    needsAuth,
    methods: authMethodInfos(methods, resolved),
  };
}

async function canCreateSessionWithoutAuth(
  connection: acp.ClientSideConnection,
  cwd: string,
): Promise<boolean> {
  try {
    await connection.newSession({ cwd, mcpServers: [] });
    return true;
  } catch (error) {
    if (isAuthRequiredError(error)) return false;
    throw error;
  }
}

function isAuthRequiredError(error: unknown): boolean {
  if (error instanceof acp.RequestError && error.code === -32000) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /auth(?:entication)?[_ -]?required/i.test(message);
}

function authMethodInfos(
  methods: acp.AuthMethod[],
  resolved: ResolvedAgentServer,
): AgentAuthenticationMethod[] {
  return methods.map((method) => {
    const common = {
      id: method.id,
      name: method.name,
      ...("description" in method && method.description ? { description: method.description } : {}),
    };
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
    if (isTerminalAuthMethod(method)) {
      return {
        ...common,
        type: "terminal",
        terminalEnabled: resolved.settings.terminal?.auth ?? false,
      };
    }
    return {
      ...common,
      type: "agent",
    };
  });
}

function isEnvAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "env_var" }> {
  return "type" in method && method.type === "env_var";
}

function isTerminalAuthMethod(method: acp.AuthMethod): method is Extract<acp.AuthMethod, { type: "terminal" }> {
  return "type" in method && method.type === "terminal";
}

function missingEnvVars(method: Extract<acp.AuthMethod, { type: "env_var" }>, resolved: ResolvedAgentServer): string[] {
  const env = { ...process.env, ...(resolved.command.env ?? {}) };
  return method.vars
    .filter((entry) => !entry.optional && !env[entry.name])
    .map((entry) => entry.name);
}

async function runTerminalAuthMethod(
  resolved: ResolvedAgentServer,
  cwd: string,
  method: Extract<acp.AuthMethod, { type: "terminal" }>,
  onTerminalEvent?: (event: AgentTerminalEvent) => void,
): Promise<void> {
  if (!onTerminalEvent) {
    const child = spawn(resolved.command.command, [...resolved.command.args, ...(method.args ?? [])], {
      cwd,
      env: { ...process.env, ...(resolved.command.env ?? {}), ...(method.env ?? {}) },
      stdio: "inherit",
    });
    await onceExit(child);
    if (child.exitCode !== 0) {
      throw new Error(`ACP terminal auth failed for "${resolved.id}" with exit code ${child.exitCode ?? "unknown"}.`);
    }
    return;
  }

  const child = spawn(resolved.command.command, [...resolved.command.args, ...(method.args ?? [])], {
    cwd,
    env: { ...process.env, ...(resolved.command.env ?? {}), ...(method.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => onTerminalEvent?.({ stream: "stdout", chunk: chunk.toString() }));
  child.stderr.on("data", (chunk) => onTerminalEvent?.({ stream: "stderr", chunk: chunk.toString() }));
  await onceExit(child);
  if (child.exitCode !== 0) {
    throw new Error(`ACP terminal auth failed for "${resolved.id}" with exit code ${child.exitCode ?? "unknown"}.`);
  }
}

async function applySessionDefaults(
  connection: acp.ClientSideConnection,
  sessionId: string,
  session: acp.NewSessionResponse,
  resolved: ResolvedAgentServer,
): Promise<void> {
  const mode = resolved.settings.defaultMode;
  if (mode) {
    const availableModes = session.modes?.availableModes ?? [];
    if (!availableModes.some((candidate) => candidate.id === mode)) {
      throw new Error(`Configured ACP mode "${mode}" is not advertised by ${resolved.id}.`);
    }
    await connection.setSessionMode({ sessionId, modeId: mode });
  }

  const model = resolved.settings.defaultModel;
  if (model) {
    const availableModels = session.models?.availableModels ?? [];
    if (!availableModels.some((candidate) => candidate.modelId === model)) {
      throw new Error(`Configured ACP model "${model}" is not advertised by ${resolved.id}.`);
    }
    await connection.unstable_setSessionModel({ sessionId, modelId: model });
  }

  for (const [configId, value] of Object.entries(resolved.settings.defaultConfigOptions ?? {})) {
    const option = session.configOptions?.find((candidate) => candidate.id === configId);
    if (!option) {
      throw new Error(`Configured ACP config option "${configId}" is not advertised by ${resolved.id}.`);
    }
    if (option.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`Configured ACP config option "${configId}" expects a boolean value.`);
      }
      await connection.setSessionConfigOption({ sessionId, configId, type: "boolean", value });
      continue;
    }

    const stringValue = String(value);
    if (!selectOptionValues(option).has(stringValue)) {
      throw new Error(`Configured ACP config option "${configId}" value "${stringValue}" is not advertised by ${resolved.id}.`);
    }
    await connection.setSessionConfigOption({ sessionId, configId, value: stringValue });
  }
}

function selectOptionValues(option: Extract<acp.SessionConfigOption, { type: "select" }>): Set<string> {
  const values = new Set<string>();
  for (const entry of option.options) {
    if ("value" in entry) {
      values.add(entry.value);
      continue;
    }
    for (const child of entry.options) values.add(child.value);
  }
  return values;
}

function preparePromptBlocks(
  request: Pick<AgentRunRequest, "prompt" | "promptBlocks">,
  initializeResponse: acp.InitializeResponse | undefined,
): acp.ContentBlock[] {
  const blocks = request.promptBlocks ?? [{ type: "text", text: request.prompt } satisfies acp.ContentBlock];
  const capabilities = initializeResponse?.agentCapabilities?.promptCapabilities;

  return blocks.map((block) => {
    if (block.type === "text" || block.type === "resource_link") {
      return block;
    }

    if (block.type === "image") {
      if (capabilities?.image) return block;
      return resourceLinkFromPromptBlock(block.uri, "image", block.mimeType);
    }

    if (block.type === "audio") {
      if (capabilities?.audio) return block;
      return resourceLinkFromPromptBlock(
        metaString(block._meta, "specflowUri"),
        metaString(block._meta, "specflowName") ?? "audio",
        block.mimeType,
      );
    }

    if (block.type === "resource") {
      if (capabilities?.embeddedContext) return block;
      const resource = block.resource;
      return {
        type: "resource_link",
        uri: resource.uri,
        name: nameFromUri(resource.uri),
        mimeType: resource.mimeType ?? null,
      };
    }

    return block;
  });
}

function resourceLinkFromPromptBlock(
  uri: string | null | undefined,
  name: string,
  mimeType: string | null | undefined,
): acp.ContentBlock {
  return {
    type: "resource_link",
    uri: uri ?? `specflow:${name}`,
    name: uri ? nameFromUri(uri) : name,
    mimeType: mimeType ?? null,
  };
}

function nameFromUri(uri: string): string {
  try {
    const url = new URL(uri);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : uri;
  } catch {
    const lastSegment = uri.split("/").filter(Boolean).at(-1);
    return lastSegment ?? uri;
  }
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" ? value : undefined;
}

async function onceExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}
