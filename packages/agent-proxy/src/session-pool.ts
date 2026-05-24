import { AgentServerStore } from "./store/agent-server-store";
import type { AgentRunRequest, AgentRunResult, AgentServerId, ResolvedAgentServer } from "./types";
import { AcpAgentConnection, runAcpAgent } from "./runtimes/acp/connection";
import { runHeadlessAgent } from "./runtimes/headless/command";
import { withPolicyDirectories } from "./runtime-policy";

export interface AgentProxySessionPoolOptions {
  root: string;
  cacheDir?: string;
}

interface ConnectionEntry {
  connection: Promise<AcpAgentConnection>;
}

/**
 * Maintains one ACP process/connection per effective agent configuration. The
 * ACP connection owns multiple workflow sessions and optional forked sessions.
 */
export class AgentProxySessionPool {
  readonly #store: AgentServerStore;
  readonly #connections = new Map<string, ConnectionEntry>();

  constructor(options: AgentProxySessionPoolOptions) {
    this.#store = new AgentServerStore({ root: options.root, cacheDir: options.cacheDir });
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const resolved = await this.#resolve(request.agentServerId);
    if (resolved.source === "headless") return runHeadlessAgent(resolved, request);
    if (!request.workflowSessionId) return runAcpAgent(resolved, withPolicyDirectories(resolved, request));

    const normalizedRequest = withPolicyDirectories(resolved, request);
    const key = connectionKey(normalizedRequest);
    let entry = this.#connections.get(key);
    if (!entry) {
      entry = { connection: this.#createConnection(resolved, normalizedRequest) };
      this.#connections.set(key, entry);
    }
    let connection: AcpAgentConnection;
    try {
      connection = await entry.connection;
    } catch (error) {
      this.#connections.delete(key);
      throw error;
    }
    const result = await connection.prompt(normalizedRequest);
    if (result.exitCode !== 0) {
      await connection.close().catch(() => {});
      this.#connections.delete(key);
    }
    return result;
  }

  async closeAll(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.all(connections.map(async (entry) => {
      const connection = await entry.connection.catch(() => undefined);
      await connection?.close();
    }));
  }

  async #createConnection(
    resolved: ResolvedAgentServer,
    request: AgentRunRequest,
  ): Promise<AcpAgentConnection> {
    if (resolved.source === "headless") {
      throw new Error(`Headless agent sessions are not pooled: ${request.agentServerId}`);
    }
    const connection = new AcpAgentConnection({
      resolved,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
    });
    try {
      await connection.start(request);
      return connection;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }

  async #resolve(agentServerId: AgentServerId) {
    return this.#store.resolve(agentServerId);
  }
}

function connectionKey(request: AgentRunRequest): string {
  return JSON.stringify({
    cwd: request.cwd,
    agentServerId: request.agentServerId,
    additionalDirectories: request.additionalDirectories ?? [],
  });
}
