import { AgentServerStore } from "./store/agent-server-store";
import type { AgentRunRequest, AgentRunResult, AgentServerId } from "./types";
import { AcpAgentSession, runAcpAgent } from "./runtimes/acp/connection";
import { runHeadlessAgent } from "./runtimes/headless/command";

export interface AgentProxySessionPoolOptions {
  root: string;
  cacheDir?: string;
}

interface SessionEntry {
  session: Promise<AcpAgentSession>;
}

export class AgentProxySessionPool {
  readonly #store: AgentServerStore;
  readonly #sessions = new Map<string, SessionEntry>();

  constructor(options: AgentProxySessionPoolOptions) {
    this.#store = new AgentServerStore({ root: options.root, cacheDir: options.cacheDir });
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const resolved = await this.#resolve(request.agentServerId);
    if (resolved.source === "headless") {
      return runHeadlessAgent(resolved, request);
    }

    if (!request.workflowSessionId) {
      return runAcpAgent(resolved, request);
    }

    const key = sessionKey(request);
    let entry = this.#sessions.get(key);
    if (!entry) {
      entry = {
        session: this.#createSession(request),
      };
      this.#sessions.set(key, entry);
    }

    let session: AcpAgentSession;
    try {
      session = await entry.session;
    } catch (error) {
      this.#sessions.delete(key);
      throw error;
    }
    const result = await session.prompt(request);
    if (result.exitCode !== 0) {
      await session.close().catch(() => {});
      this.#sessions.delete(key);
    }
    return result;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map(async (entry) => {
      const session = await entry.session.catch(() => undefined);
      await session?.close();
    }));
  }

  async #createSession(request: AgentRunRequest): Promise<AcpAgentSession> {
    const resolved = await this.#resolve(request.agentServerId);
    if (resolved.source === "headless") {
      throw new Error(`Headless agent sessions are not pooled: ${request.agentServerId}`);
    }
    const session = new AcpAgentSession({
      resolved,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
    });
    try {
      await session.start(request);
      return session;
    } catch (error) {
      await session.close().catch(() => {});
      throw error;
    }
  }

  async #resolve(agentServerId: AgentServerId) {
    return this.#store.resolve(agentServerId);
  }
}

function sessionKey(request: AgentRunRequest): string {
  return JSON.stringify({
    cwd: request.cwd,
    agentServerId: request.agentServerId,
    workflowSessionId: request.workflowSessionId,
  });
}
