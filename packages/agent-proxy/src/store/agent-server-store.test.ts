import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AgentServerStore } from "./agent-server-store";

describe("AgentServerStore", () => {
  test("normalizes registry settings without adding Specflow auth defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-store-"));
    await mkdir(join(root, ".specflow"), { recursive: true });
    await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
      agent_servers: {
        "claude-acp": {
          type: "registry",
          registry_id: "claude-acp",
        },
      },
    }), "utf8");

    const entries = await new AgentServerStore({ root }).listAgentServers();

    expect(entries[0]).toMatchObject({
      id: "claude-acp",
      settings: {
        type: "registry",
        registryId: "claude-acp",
      },
    });
  });

  test("deep merges local agent settings over base settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-store-"));
    await mkdir(join(root, ".specflow"), { recursive: true });
    await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
      agent_servers: {
        fake: {
          type: "custom",
          command: "bun",
          args: ["agent.ts"],
          cwd: "agents/fake",
          env: { BASE: "1", SHARED: "base" },
        },
      },
    }), "utf8");
    await writeFile(join(root, ".specflow", "agent-servers.local.json"), JSON.stringify({
      agent_servers: {
        fake: {
          env: { SHARED: "local", SECRET: "token" },
        },
      },
    }), "utf8");

    const resolved = await new AgentServerStore({ root }).resolve("fake");

    expect(resolved.settings).toMatchObject({
      type: "custom",
      command: "bun",
      args: ["agent.ts"],
      cwd: "agents/fake",
      env: { BASE: "1", SHARED: "local", SECRET: "token" },
    });
  });

  test("resolves arbitrary registry agents from the registry index", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-store-"));
    await mkdir(join(root, ".specflow"), { recursive: true });
    await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
      agent_servers: {
        other: {
          type: "registry",
          registry_id: "other-acp",
        },
      },
    }), "utf8");

    const restoreFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({
      version: "1",
      agents: [{
        id: "other-acp",
        name: "Other",
        version: "1.0.0",
        distribution: { npx: { package: "other-acp", args: ["--acp"] } },
      }],
    })) as unknown as typeof fetch;

    try {
      const resolved = await new AgentServerStore({ root }).resolve("other");
      expect(resolved.command).toMatchObject({
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["--yes", "other-acp", "--acp"],
      });
    } finally {
      globalThis.fetch = restoreFetch;
    }
  });

  test("rejects registry agents missing from the registry index", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-store-"));
    await mkdir(join(root, ".specflow"), { recursive: true });
    await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
      agent_servers: {
        other: {
          type: "registry",
          registry_id: "missing-acp",
        },
      },
    }), "utf8");
    const restoreFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ version: "1", agents: [] })) as unknown as typeof fetch;

    try {
      await expect(new AgentServerStore({ root }).resolve("other")).rejects.toThrow("ACP registry agent not found: missing-acp");
    } finally {
      globalThis.fetch = restoreFetch;
    }
  });

  test("rejects registry agents with unsupported distributions", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-store-"));
    await mkdir(join(root, ".specflow"), { recursive: true });
    await writeFile(join(root, ".specflow", "agent-servers.json"), JSON.stringify({
      agent_servers: {
        other: {
          type: "registry",
          registry_id: "other-acp",
        },
      },
    }), "utf8");
    const restoreFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({
      version: "1",
      agents: [{
        id: "other-acp",
        name: "Other",
        version: "1.0.0",
        distribution: {},
      }],
    })) as unknown as typeof fetch;

    try {
      await expect(new AgentServerStore({ root }).resolve("other")).rejects.toThrow("ACP registry agent has no supported distribution");
    } finally {
      globalThis.fetch = restoreFetch;
    }
  });
});
