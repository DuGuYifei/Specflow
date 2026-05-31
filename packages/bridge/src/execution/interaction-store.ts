import type {
  AgentPermissionRequest,
  AgentPermissionResult,
} from "@specflow/agent-proxy";
import { uuidv7 } from "@specflow/shared";

export type RunInteractionStatus = "pending" | "resolved" | "cancelled";

export type ElicitationResponse =
  | { action: "accept"; content?: Record<string, string | number | boolean | string[]> | null }
  | { action: "decline" }
  | { action: "cancel" };

export interface RunInteractionContext {
  runId: string;
  nodeRunId?: string;
  nodeId?: string;
  edgeId?: string;
  agentInvocationId: string;
  agentId: string;
  agentServerId: string;
  specflowSessionId?: string;
  acpSessionId?: string;
}

interface RunInteractionBase extends RunInteractionContext {
  id: string;
  status: RunInteractionStatus;
  createdAt: string;
  resolvedAt?: string;
  resolution?: unknown;
}

export interface PermissionRunInteraction extends RunInteractionBase {
  kind: "permission";
  toolCall: unknown;
  options: Array<{ optionId: string; name?: string; kind?: string }>;
}

export interface ElicitationRunInteraction extends RunInteractionBase {
  kind: "elicitation";
  request: unknown;
}

export type RunInteraction = PermissionRunInteraction | ElicitationRunInteraction;

interface PendingPermissionRecord {
  interaction: PermissionRunInteraction;
  resolve: (result: AgentPermissionResult) => void;
}

interface PendingElicitationRecord {
  interaction: ElicitationRunInteraction;
  resolve: (result: ElicitationResponse) => void;
}

type PendingRecord = PendingPermissionRecord | PendingElicitationRecord;

type InteractionHandler = (interaction: RunInteraction) => void;

export class RunInteractionStore {
  readonly #interactions = new Map<string, RunInteraction>();
  readonly #pending = new Map<string, PendingRecord>();
  readonly #listeners = new Map<string, Set<InteractionHandler>>();

  list(input: { runId?: string; status?: RunInteractionStatus } = {}): RunInteraction[] {
    return [...this.#interactions.values()]
      .filter((interaction) => !input.runId || interaction.runId === input.runId)
      .filter((interaction) => !input.status || interaction.status === input.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(interactionId: string): RunInteraction | undefined {
    return this.#interactions.get(interactionId);
  }

  subscribe(runId: string, handler: InteractionHandler): () => void {
    let listeners = this.#listeners.get(runId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(runId, listeners);
    }
    listeners.add(handler);
    return () => listeners!.delete(handler);
  }

  requestPermission(
    context: RunInteractionContext,
    request: AgentPermissionRequest,
  ): Promise<AgentPermissionResult> {
    const interaction: PermissionRunInteraction = {
      ...context,
      id: uuidv7(),
      kind: "permission",
      status: "pending",
      createdAt: new Date().toISOString(),
      acpSessionId: context.acpSessionId ?? request.sessionId,
      toolCall: request.toolCall,
      options: request.options,
    };

    return new Promise((resolve) => {
      const record: PendingPermissionRecord = { interaction, resolve };
      this.#storePending(record);
    });
  }

  requestElicitation(context: RunInteractionContext, request: unknown): Promise<ElicitationResponse> {
    const interaction: ElicitationRunInteraction = {
      ...context,
      id: uuidv7(),
      kind: "elicitation",
      status: "pending",
      createdAt: new Date().toISOString(),
      acpSessionId: context.acpSessionId ?? sessionIdFromRequest(request),
      request,
    };

    return new Promise((resolve) => {
      this.#storePending({ interaction, resolve });
    });
  }

  recordElicitationComplete(context: RunInteractionContext, notification: unknown): void {
    const interaction: ElicitationRunInteraction = {
      ...context,
      id: uuidv7(),
      kind: "elicitation",
      status: "resolved",
      createdAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      request: notification,
      resolution: { action: "complete" },
    };
    this.#interactions.set(interaction.id, interaction);
    this.#emit(interaction);
  }

  resolve(interactionId: string, resolution: unknown): RunInteraction {
    const pending = this.#pending.get(interactionId);
    if (!pending) {
      const existing = this.#interactions.get(interactionId);
      if (!existing) throw new Error(`Unknown interaction "${interactionId}".`);
      throw new Error(`Interaction "${interactionId}" is already ${existing.status}.`);
    }

    const interaction = pending.interaction;
    interaction.status = "resolved";
    interaction.resolvedAt = new Date().toISOString();
    interaction.resolution = resolution;
    this.#pending.delete(interactionId);

    if (isPendingPermission(pending)) {
      pending.resolve(normalizePermissionResolution(resolution));
    } else {
      pending.resolve(normalizeElicitationResolution(resolution));
    }

    this.#emit(interaction);
    return interaction;
  }

  cancel(interactionId: string, reason?: string): RunInteraction {
    const pending = this.#pending.get(interactionId);
    if (!pending) {
      const existing = this.#interactions.get(interactionId);
      if (!existing) throw new Error(`Unknown interaction "${interactionId}".`);
      throw new Error(`Interaction "${interactionId}" is already ${existing.status}.`);
    }

    const interaction = pending.interaction;
    interaction.status = "cancelled";
    interaction.resolvedAt = new Date().toISOString();
    interaction.resolution = { reason };
    this.#pending.delete(interactionId);

    if (isPendingPermission(pending)) {
      pending.resolve({ outcome: "cancelled" });
    } else {
      pending.resolve({ action: "cancel" });
    }

    this.#emit(interaction);
    return interaction;
  }

  cancelPendingForRun(runId: string, reason?: string): void {
    const pendingIds = [...this.#pending.values()]
      .filter((record) => record.interaction.runId === runId)
      .map((record) => record.interaction.id);
    for (const id of pendingIds) {
      this.cancel(id, reason);
    }
  }

  #storePending(record: PendingRecord): void {
    this.#interactions.set(record.interaction.id, record.interaction);
    this.#pending.set(record.interaction.id, record);
    this.#emit(record.interaction);
  }

  #emit(interaction: RunInteraction): void {
    for (const handler of this.#listeners.get(interaction.runId) ?? []) {
      handler(interaction);
    }
  }
}

function normalizePermissionResolution(input: unknown): AgentPermissionResult {
  const resolution = input as Partial<AgentPermissionResult> & { optionId?: string };
  if (resolution.outcome === "selected" && typeof resolution.optionId === "string") {
    return { outcome: "selected", optionId: resolution.optionId };
  }
  return { outcome: "cancelled" };
}

function sessionIdFromRequest(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as { sessionId?: unknown }).sessionId;
  return typeof value === "string" ? value : undefined;
}

function isPendingPermission(record: PendingRecord): record is PendingPermissionRecord {
  return record.interaction.kind === "permission";
}

function normalizeElicitationResolution(input: unknown): ElicitationResponse {
  const resolution = input as Partial<ElicitationResponse> & { content?: Record<string, string | number | boolean | string[]> | null };
  if (resolution.action === "accept") {
    return { action: "accept", content: resolution.content ?? {} };
  }
  if (resolution.action === "decline") {
    return { action: "decline" };
  }
  return { action: "cancel" };
}
