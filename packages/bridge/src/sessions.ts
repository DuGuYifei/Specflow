export interface BridgeSession {
  id: string;
  createdAt: Date;
}

export class SessionRegistry {
  readonly #sessions = new Map<string, BridgeSession>();

  create(): BridgeSession {
    const session = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    this.#sessions.set(session.id, session);
    return session;
  }

  list(): BridgeSession[] {
    return Array.from(this.#sessions.values());
  }
}
