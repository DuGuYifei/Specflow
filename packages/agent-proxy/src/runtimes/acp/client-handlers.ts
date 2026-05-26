import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { uuidv7 } from "@specflow/shared";
import type {
  AgentPermissionRequest,
  AgentPermissionResult,
  AgentSessionUpdateEvent,
  AgentTerminalEvent,
  PermissionPolicy,
} from "../../types";
import { assertInsideAllowedRoots } from "../../util";
import { handleSessionUpdate } from "./events";
import { resolveByPolicy } from "./permission-policy";

interface TerminalRecord {
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  output: string;
  outputByteLimit?: number;
  truncated: boolean;
  exitCode?: number;
  signal?: string | null;
}

export class AcpClientHandlers implements acp.Client {
  readonly #cwd: string;
  readonly #allowedRoots: string[];
  readonly #terminalEnabled: boolean;
  readonly #permissionPolicy: PermissionPolicy | undefined;
  readonly #terminals = new Map<string, TerminalRecord>();
  readonly #appendOutput: (text: string) => void;
  readonly #onTerminalEvent: ((event: AgentTerminalEvent) => void) | undefined;
  readonly #onPermissionRequest: ((request: AgentPermissionRequest) => Promise<AgentPermissionResult>) | undefined;
  readonly #onSessionUpdate: ((event: AgentSessionUpdateEvent) => void) | undefined;
  readonly #onElicitationRequest: ((request: acp.CreateElicitationRequest) => Promise<acp.CreateElicitationResponse>) | undefined;
  readonly #onElicitationComplete: ((notification: acp.CompleteElicitationNotification) => void | Promise<void>) | undefined;
  readonly #onExtMethod: ((method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
  readonly #onExtNotification: ((method: string, params: Record<string, unknown>) => void | Promise<void>) | undefined;

  constructor(input: {
    cwd: string;
    additionalDirectories?: string[];
    terminalEnabled?: boolean;
    permissionPolicy?: PermissionPolicy;
    appendOutput: (text: string) => void;
    onTerminalEvent?: (event: AgentTerminalEvent) => void;
    onPermissionRequest?: (request: AgentPermissionRequest) => Promise<AgentPermissionResult>;
    onSessionUpdate?: (event: AgentSessionUpdateEvent) => void;
    onElicitationRequest?: (request: acp.CreateElicitationRequest) => Promise<acp.CreateElicitationResponse>;
    onElicitationComplete?: (notification: acp.CompleteElicitationNotification) => void | Promise<void>;
    onExtMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onExtNotification?: (method: string, params: Record<string, unknown>) => void | Promise<void>;
  }) {
    this.#cwd = input.cwd;
    this.#allowedRoots = [input.cwd, ...(input.additionalDirectories ?? [])];
    this.#terminalEnabled = input.terminalEnabled ?? true;
    this.#permissionPolicy = input.permissionPolicy;
    this.#appendOutput = input.appendOutput;
    this.#onTerminalEvent = input.onTerminalEvent;
    this.#onPermissionRequest = input.onPermissionRequest;
    this.#onSessionUpdate = input.onSessionUpdate;
    this.#onElicitationRequest = input.onElicitationRequest;
    this.#onElicitationComplete = input.onElicitationComplete;
    this.#onExtMethod = input.onExtMethod;
    this.#onExtNotification = input.onExtNotification;
  }

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const request: AgentPermissionRequest = {
      sessionId: params.sessionId,
      toolCall: params.toolCall,
      options: params.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
      raw: params,
    };
    const policyShortCircuit = resolveByPolicy(request.options, this.#permissionPolicy);
    const result = policyShortCircuit
      ?? (this.#onPermissionRequest
        ? await this.#onPermissionRequest(request)
        : { outcome: "cancelled" } satisfies AgentPermissionResult);
    if (result.outcome === "cancelled") {
      this.#onTerminalEvent?.({ stream: "system", chunk: "ACP permission request cancelled.\n" });
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId: result.optionId } };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    handleSessionUpdate({
      params,
      appendOutput: this.#appendOutput,
      onTerminalEvent: this.#onTerminalEvent,
      onSessionUpdate: this.#onSessionUpdate,
    });
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const path = assertInsideAllowedRoots(this.#allowedRoots, params.path);
    const content = await readFile(path, "utf8");
    return { content: applyLineWindow(content, params.line, params.limit) };
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    const path = assertInsideAllowedRoots(this.#allowedRoots, params.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, params.content, "utf8");
    return {};
  }

  async createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    if (!this.#terminalEnabled) {
      throw acp.RequestError.methodNotFound("terminal/create");
    }
    const terminalId = uuidv7();
    const cwd = params.cwd ? assertInsideAllowedRoots(this.#allowedRoots, params.cwd) : this.#cwd;
    const proc = Bun.spawn([params.command, ...(params.args ?? [])], {
      cwd,
      env: { ...process.env, ...envArrayToRecord(params.env) },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const record: TerminalRecord = {
      proc,
      output: "",
      outputByteLimit: params.outputByteLimit ?? undefined,
      truncated: false,
    };
    this.#terminals.set(terminalId, record);
    this.#onTerminalEvent?.({
      stream: "system",
      chunk: `[terminal ${terminalId}] ${params.command} ${(params.args ?? []).join(" ")}\n`,
    });
    void this.#captureTerminal(terminalId, record, "stdout");
    void this.#captureTerminal(terminalId, record, "stderr");
    void proc.exited.then((exitCode) => { record.exitCode = exitCode; });
    return { terminalId };
  }

  async terminalOutput(params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse> {
    const terminal = this.#terminal(params.terminalId);
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus: terminal.exitCode === undefined
        ? undefined
        : { exitCode: terminal.exitCode, signal: terminal.signal ?? null },
    };
  }

  async waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.#terminal(params.terminalId);
    const exitCode = terminal.exitCode ?? await terminal.proc.exited;
    terminal.exitCode = exitCode;
    return { exitCode, signal: terminal.signal ?? null };
  }

  async killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    this.#terminal(params.terminalId).proc.kill();
    return {};
  }

  async releaseTerminal(params: acp.ReleaseTerminalRequest): Promise<acp.ReleaseTerminalResponse> {
    const terminal = this.#terminal(params.terminalId);
    terminal.proc.kill();
    this.#terminals.delete(params.terminalId);
    return {};
  }

  async unstable_createElicitation(params: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse> {
    if (this.#onElicitationRequest) return this.#onElicitationRequest(params);
    this.#onTerminalEvent?.({ stream: "system", chunk: "ACP elicitation request cancelled.\n" });
    return { action: "cancel" };
  }

  async unstable_completeElicitation(params: acp.CompleteElicitationNotification): Promise<void> {
    await this.#onElicitationComplete?.(params);
  }

  async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.#onExtMethod) throw acp.RequestError.methodNotFound(method);
    return this.#onExtMethod(method, params);
  }

  async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
    await this.#onExtNotification?.(method, params);
  }

  #terminal(terminalId: string): TerminalRecord {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal) throw acp.RequestError.resourceNotFound(`terminal:${terminalId}`);
    return terminal;
  }

  async #captureTerminal(terminalId: string, terminal: TerminalRecord, stream: "stdout" | "stderr"): Promise<void> {
    const decoder = new TextDecoder();
    const readable = stream === "stdout" ? terminal.proc.stdout : terminal.proc.stderr;
    for await (const chunk of readable) {
      const text = decoder.decode(chunk, { stream: true });
      appendTerminalOutput(terminal, text);
      this.#onTerminalEvent?.({ stream, chunk: text });
    }
    this.#onTerminalEvent?.({ stream: "system", chunk: `[terminal ${terminalId} ${stream} closed]\n` });
  }
}

function applyLineWindow(content: string, line?: number | null, limit?: number | null): string {
  const startLine = Math.max(1, line ?? 1);
  if (startLine === 1 && !limit) return content;
  const lines = content.split(/\r?\n/);
  const selected = lines.slice(startLine - 1, limit ? startLine - 1 + limit : undefined);
  return selected.join("\n");
}

function envArrayToRecord(env?: acp.EnvVariable[]): Record<string, string> {
  return Object.fromEntries((env ?? []).map((entry) => [entry.name, entry.value]));
}

function appendTerminalOutput(terminal: TerminalRecord, text: string): void {
  terminal.output += text;
  const limit = terminal.outputByteLimit;
  if (!limit || Buffer.byteLength(terminal.output, "utf8") <= limit) return;

  let trimmed = terminal.output;
  while (Buffer.byteLength(trimmed, "utf8") > limit && trimmed.length > 0) {
    trimmed = trimmed.slice(1);
  }
  terminal.output = trimmed;
  terminal.truncated = true;
}
