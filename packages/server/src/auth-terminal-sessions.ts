import { uuidv7 } from "@specflow/shared";
import type { AgentAuthenticationStatus, TerminalAuthTask } from "@specflow/bridge";

export type AuthTerminalStatus = "running" | "succeeded" | "failed" | "cancelled";

export type AuthTerminalStreamEvent =
  | {
      type: "output";
      sessionId: string;
      data: string;
      at: string;
    }
  | {
      type: "status";
      sessionId: string;
      status: AuthTerminalStatus;
      exitCode?: number;
      signal?: string | null;
      error?: string;
      authStatus?: AgentAuthenticationStatus;
      at: string;
    };

interface AuthTerminalRecord {
  id: string;
  task: TerminalAuthTask;
  proc: Bun.Subprocess;
  terminal: Bun.Terminal;
  status: AuthTerminalStatus;
  events: AuthTerminalStreamEvent[];
  subscribers: Set<(event: AuthTerminalStreamEvent) => void>;
  output: string;
  completing: boolean;
}

export class AuthTerminalSessionStore {
  readonly #sessions = new Map<string, AuthTerminalRecord>();
  readonly #checkAuth: (agentServerId: string) => Promise<AgentAuthenticationStatus>;

  constructor(input: {
    checkAuth: (agentServerId: string) => Promise<AgentAuthenticationStatus>;
  }) {
    this.#checkAuth = input.checkAuth;
  }

  start(task: TerminalAuthTask, size: { cols?: number; rows?: number } = {}): string {
    const sessionId = uuidv7();
    const terminal = new Bun.Terminal({
      cols: size.cols ?? 80,
      rows: size.rows ?? 24,
      data: (_terminal, data) => {
        const text = new TextDecoder().decode(data);
        const record = this.#sessions.get(sessionId);
        if (record) this.#emitOutput(record, text);
      },
      exit: () => {
        // The subprocess exit promise below carries the real command status.
      },
    });
    const proc = Bun.spawn([task.command, ...task.args], {
      cwd: task.cwd,
      env: { ...process.env, ...task.env },
      terminal,
    });
    const record: AuthTerminalRecord = {
      id: sessionId,
      task,
      proc,
      terminal,
      status: "running",
      events: [],
      subscribers: new Set(),
      output: "",
      completing: false,
    };
    this.#sessions.set(sessionId, record);
    this.#emit(record, {
      type: "status",
      sessionId,
      status: "running",
      at: new Date().toISOString(),
    });
    void proc.exited.then((exitCode) => {
      if (record.status !== "running") return;
      if (exitCode === 0) {
        void this.#complete(record, "succeeded", { exitCode });
      } else {
        void this.#complete(record, "failed", {
          exitCode,
          error: `Terminal auth exited with code ${exitCode}.`,
        });
      }
    }).catch((error) => {
      if (record.status !== "running") return;
      void this.#complete(record, "failed", { error: errorMessage(error) });
    });
    return sessionId;
  }

  get(sessionId: string): AuthTerminalRecord | undefined {
    return this.#sessions.get(sessionId);
  }

  subscribe(sessionId: string, listener: (event: AuthTerminalStreamEvent) => void): () => void {
    const record = this.#require(sessionId);
    record.subscribers.add(listener);
    return () => record.subscribers.delete(listener);
  }

  input(sessionId: string, data: string): void {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    record.terminal.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    record.terminal.resize(cols, rows);
  }

  async cancel(sessionId: string): Promise<void> {
    const record = this.#require(sessionId);
    if (record.status !== "running") return;
    await this.#complete(record, "cancelled", { error: "Terminal auth cancelled." });
  }

  async check(sessionId: string): Promise<AgentAuthenticationStatus> {
    const record = this.#require(sessionId);
    const authStatus = await this.#checkAuth(record.task.agentServerId);
    if (!authStatus.needsAuth && record.status === "running") {
      await this.#complete(record, "succeeded", { authStatus });
    } else {
      this.#emit(record, {
        type: "status",
        sessionId,
        status: record.status,
        authStatus,
        at: new Date().toISOString(),
      });
    }
    return authStatus;
  }

  #emitOutput(record: AuthTerminalRecord, data: string): void {
    record.output += data;
    this.#emit(record, {
      type: "output",
      sessionId: record.id,
      data,
      at: new Date().toISOString(),
    });
    if (record.status !== "running") return;
    if (record.task.successPatterns.some((pattern) => record.output.includes(pattern))) {
      void this.#complete(record, "succeeded");
    }
  }

  async #complete(
    record: AuthTerminalRecord,
    status: AuthTerminalStatus,
    details: {
      exitCode?: number;
      signal?: string | null;
      error?: string;
      authStatus?: AgentAuthenticationStatus;
    } = {},
  ): Promise<void> {
    if (record.completing) return;
    record.completing = true;
    record.status = status;
    if (status !== "succeeded") {
      record.proc.kill();
    } else if (record.proc.exitCode === null) {
      record.proc.kill();
    }
    record.terminal.close();
    let authStatus = details.authStatus;
    if (status === "succeeded" && !authStatus) {
      authStatus = await this.#checkAuth(record.task.agentServerId).catch(() => undefined);
    }
    this.#emit(record, {
      type: "status",
      sessionId: record.id,
      status,
      ...details,
      ...(authStatus ? { authStatus } : {}),
      at: new Date().toISOString(),
    });
    setTimeout(() => {
      if (record.subscribers.size === 0) this.#sessions.delete(record.id);
    }, 30_000);
  }

  #emit(record: AuthTerminalRecord, event: AuthTerminalStreamEvent): void {
    record.events.push(event);
    for (const subscriber of record.subscribers) subscriber(event);
  }

  #require(sessionId: string): AuthTerminalRecord {
    const record = this.#sessions.get(sessionId);
    if (!record) throw new Error(`Auth terminal session not found: ${sessionId}`);
    return record;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
