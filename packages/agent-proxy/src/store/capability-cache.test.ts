import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AgentServerStore } from "./agent-server-store";
import type { AgentServerCapabilitiesCache } from "../types";

async function workspaceWith(servers: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specflow-cap-"));
  await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
  await writeFile(join(root, ".aflow/.specflow", "agent-servers.json"), JSON.stringify({ agentServers: servers }));
  return root;
}

const snapshot: Omit<AgentServerCapabilitiesCache, "installedVersion" | "probedAt"> = {
  agentCapabilities: { loadSession: true },
  modes: { availableModes: [{ id: "plan", name: "Plan" }], currentModeId: "plan" },
  configOptions: null,
  availableCommands: [{ name: "compact", description: "Compact" }],
};

describe("AgentServerStore capability cache", () => {
  test("round-trips a capability snapshot to disk", async () => {
    const root = await workspaceWith({
      "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "1.0.0" },
    });
    const store = new AgentServerStore({ root });
    await store.setCapabilities("claude-acp", snapshot);

    // Fresh store instance to prove it reads from disk, not memory.
    const reread = new AgentServerStore({ root });
    const cached = await reread.getCapabilities("claude-acp");
    expect(cached).toMatchObject({
      installedVersion: "1.0.0",
      agentCapabilities: { loadSession: true },
    });
    expect(cached?.modes?.availableModes[0]?.id).toBe("plan");
  });

  test("invalidates the snapshot when installedVersion changes", async () => {
    const root = await workspaceWith({
      "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "1.0.0" },
    });
    await new AgentServerStore({ root }).setCapabilities("claude-acp", snapshot);

    // Simulate an upgrade by rewriting the config with a new version.
    await writeFile(
      join(root, ".aflow/.specflow", "agent-servers.json"),
      JSON.stringify({ agentServers: { "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "2.0.0" } } }),
    );

    const cached = await new AgentServerStore({ root }).getCapabilities("claude-acp");
    expect(cached).toBeUndefined();
  });

  test("manual refresh overwrites the stale snapshot with the new version stamp", async () => {
    const root = await workspaceWith({
      "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "2.0.0" },
    });
    const store = new AgentServerStore({ root });
    await store.setCapabilities("claude-acp", snapshot);
    const cached = await store.getCapabilities("claude-acp");
    expect(cached?.installedVersion).toBe("2.0.0");
  });

  test("listAgentServers attaches valid capabilities and omits stale ones", async () => {
    const root = await workspaceWith({
      "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "1.0.0" },
    });
    const store = new AgentServerStore({ root });
    await store.setCapabilities("claude-acp", snapshot);
    const entriesValid = await store.listAgentServers();
    expect(entriesValid.find((e) => e.id === "claude-acp")?.capabilities).toBeDefined();

    await writeFile(
      join(root, ".aflow/.specflow", "agent-servers.json"),
      JSON.stringify({ agentServers: { "claude-acp": { type: "registry", registryId: "claude-code", installedVersion: "9.9.9" } } }),
    );
    const entriesStale = await new AgentServerStore({ root }).listAgentServers();
    expect(entriesStale.find((e) => e.id === "claude-acp")?.capabilities).toBeUndefined();
  });
});
