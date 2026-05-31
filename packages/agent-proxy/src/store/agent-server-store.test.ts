import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

  test("rejects unsupported registry agents before resolving downloads", async () => {
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

    await expect(new AgentServerStore({ root }).resolve("other")).rejects.toThrow("Unsupported registry ACP agent");
    await expect(access(join(root, ".specflow", "cache", "agents"))).rejects.toThrow();
  });
});
