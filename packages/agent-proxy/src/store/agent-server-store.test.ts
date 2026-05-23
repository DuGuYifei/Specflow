import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AgentServerStore } from "./agent-server-store";

describe("AgentServerStore", () => {
  test("applies supported registry agent defaults", async () => {
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
        terminal: { enabled: true, auth: true },
      },
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
  });
});
