export interface PausedNodeSession {
  runId: string;
  nodeId: string;
  specflowSessionId: string;
  agentServerId: string;
  pausedAt: string;
}

type PausedPromptHandler = (prompt: string) => Promise<string>;

interface PendingPause {
  session: PausedNodeSession;
  prompt: PausedPromptHandler;
  resolve: (output?: string) => void;
  reject: (error: Error) => void;
  lastOutput?: string;
  promptPending: boolean;
  removeAbort?: () => void;
}

export class RunPauseStore {
  readonly #pending = new Map<string, PendingPause>();

  list(runId?: string): PausedNodeSession[] {
    return [...this.#pending.values()]
      .filter((entry) => !runId || entry.session.runId === runId)
      .map((entry) => entry.session);
  }

  get(runId: string, nodeId: string): PausedNodeSession | undefined {
    return this.#pending.get(keyFor(runId, nodeId))?.session;
  }

  waitForContinuation(
    session: PausedNodeSession,
    prompt: PausedPromptHandler,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const key = keyFor(session.runId, session.nodeId);
    if (this.#pending.has(key)) throw new Error(`Node "${session.nodeId}" is already paused.`);
    return new Promise<string | undefined>((resolve, reject) => {
      const pending: PendingPause = {
        session,
        prompt,
        resolve,
        reject,
        promptPending: false,
      };
      const abort = () => {
        this.#pending.delete(key);
        reject(new Error("Workflow run cancelled while paused."));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      pending.removeAbort = () => signal?.removeEventListener("abort", abort);
      this.#pending.set(key, pending);
    });
  }

  async sendPrompt(runId: string, nodeId: string, prompt: string): Promise<{ output: string }> {
    const entry = this.#requirePending(runId, nodeId);
    if (prompt.trim() === "") throw new Error("Prompt must not be empty.");
    if (entry.promptPending) throw new Error("A prompt is already running for this paused node.");
    entry.promptPending = true;
    try {
      const output = await entry.prompt(prompt);
      entry.lastOutput = output;
      return { output };
    } finally {
      entry.promptPending = false;
    }
  }

  continue(runId: string, nodeId: string): PausedNodeSession {
    const key = keyFor(runId, nodeId);
    const entry = this.#requirePending(runId, nodeId);
    if (entry.promptPending) throw new Error("Cannot continue while a paused prompt is running.");
    this.#pending.delete(key);
    entry.removeAbort?.();
    entry.resolve(entry.lastOutput);
    return entry.session;
  }

  cancelForRun(runId: string, reason = "Workflow run ended."): void {
    for (const [key, entry] of this.#pending.entries()) {
      if (entry.session.runId !== runId) continue;
      this.#pending.delete(key);
      entry.removeAbort?.();
      entry.reject(new Error(reason));
    }
  }

  #requirePending(runId: string, nodeId: string): PendingPause {
    const entry = this.#pending.get(keyFor(runId, nodeId));
    if (!entry) throw new Error(`Node "${nodeId}" is not currently paused for run "${runId}".`);
    return entry;
  }
}

function keyFor(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`;
}
