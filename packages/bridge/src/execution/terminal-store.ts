import type { TerminalOutputEvent, TerminalStream } from "@specflow/workflow";

export interface TerminalEventFilter {
  runId?: string;
  nodeRunId?: string;
  agentInvocationId?: string;
}

export class TerminalEventStore {
  readonly #events: TerminalOutputEvent[] = [];
  readonly #sequencesByRun = new Map<string, number>();

  append(input: {
    runId: string;
    nodeRunId?: string;
    agentInvocationId?: string;
    stream: TerminalStream;
    chunk: string;
  }): TerminalOutputEvent {
    const nextSequence = (this.#sequencesByRun.get(input.runId) ?? 0) + 1;
    this.#sequencesByRun.set(input.runId, nextSequence);

    const event: TerminalOutputEvent = {
      id: crypto.randomUUID(),
      runId: input.runId,
      nodeRunId: input.nodeRunId,
      agentInvocationId: input.agentInvocationId,
      stream: input.stream,
      sequence: nextSequence,
      chunk: input.chunk,
      createdAt: new Date().toISOString(),
    };

    this.#events.push(event);
    return event;
  }

  list(filter: TerminalEventFilter = {}): TerminalOutputEvent[] {
    return this.#events.filter((event) => {
      if (filter.runId && event.runId !== filter.runId) {
        return false;
      }
      if (filter.nodeRunId && event.nodeRunId !== filter.nodeRunId) {
        return false;
      }
      if (filter.agentInvocationId && event.agentInvocationId !== filter.agentInvocationId) {
        return false;
      }
      return true;
    });
  }
}
