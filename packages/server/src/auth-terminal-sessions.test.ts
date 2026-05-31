import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AuthTerminalSessionStore, type AuthTerminalStreamEvent } from "./auth-terminal-sessions";

describe("AuthTerminalSessionStore", () => {
  test("streams PTY output and completes successful auth", async () => {
    const events: AuthTerminalStreamEvent[] = [];
    const store = authTerminalStore();
    const sessionId = store.start({
      agentServerId: "fake-acp",
      methodId: "terminal",
      label: "Login",
      command: "bun",
      args: ["-e", "setTimeout(() => process.stdout.write('ready\\n'), 30); setTimeout(() => process.exit(0), 60);"],
      cwd: await mkdtemp(join(tmpdir(), "specflow-auth-terminal-")),
      env: {},
      successPatterns: [],
    });
    const unsubscribe = store.subscribe(sessionId, (event) => events.push(event));

    try {
      await waitFor(() => statusEvents(events).some((event) => event.status === "succeeded"));
    } finally {
      unsubscribe();
    }

    expect(outputText(events)).toContain("ready");
    expect(statusEvents(events).at(-1)).toMatchObject({
      status: "succeeded",
      exitCode: 0,
      authStatus: {
        agentServerId: "fake-acp",
        needsAuth: false,
      },
    });
  });

  test("writes browser input into the PTY", async () => {
    const events: AuthTerminalStreamEvent[] = [];
    const store = authTerminalStore();
    const sessionId = store.start({
      agentServerId: "fake-acp",
      methodId: "terminal",
      label: "Login",
      command: "bun",
      args: [
        "-e",
        "process.stdin.setRawMode?.(true); process.stdin.on('data', (chunk) => { process.stdout.write('echo:' + chunk.toString()); process.exit(0); });",
      ],
      cwd: await mkdtemp(join(tmpdir(), "specflow-auth-terminal-input-")),
      env: {},
      successPatterns: [],
    });
    const unsubscribe = store.subscribe(sessionId, (event) => events.push(event));

    try {
      store.input(sessionId, "x");
      await waitFor(() => outputText(events).includes("echo:x"));
      await waitFor(() => statusEvents(events).some((event) => event.status === "succeeded"));
    } finally {
      unsubscribe();
      await store.cancel(sessionId).catch(() => {});
    }

    expect(outputText(events)).toContain("echo:x");
  });
});

function authTerminalStore(): AuthTerminalSessionStore {
  return new AuthTerminalSessionStore({
    checkAuth: async (agentServerId) => ({
      agentServerId,
      needsAuth: false,
      methods: [],
    }),
  });
}

function outputText(events: AuthTerminalStreamEvent[]): string {
  return events
    .filter((event): event is Extract<AuthTerminalStreamEvent, { type: "output" }> => event.type === "output")
    .map((event) => event.data)
    .join("");
}

function statusEvents(events: AuthTerminalStreamEvent[]): Array<Extract<AuthTerminalStreamEvent, { type: "status" }>> {
  return events.filter((event): event is Extract<AuthTerminalStreamEvent, { type: "status" }> => event.type === "status");
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for auth terminal event.");
}
