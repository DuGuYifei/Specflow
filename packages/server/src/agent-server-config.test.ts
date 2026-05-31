import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  agentServersLocalPath,
  loadLocalAgentServerConfig,
  removeLocalAgentServer,
  upsertLocalAgentServer,
} from "./agent-server-config";

describe("agent server local config", () => {
  test("upserts and removes local agent server overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));

    await upsertLocalAgentServer(root, "my-agent", {
      type: "custom",
      command: "node",
      args: ["agent.js", "--acp"],
      env: { TOKEN: "secret" },
    });

    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "my-agent": {
          type: "custom",
          command: "node",
          args: ["agent.js", "--acp"],
        },
      },
    });

    await removeLocalAgentServer(root, "my-agent");
    expect(await loadLocalAgentServerConfig(root)).toEqual({ agent_servers: {} });
  });

  test("normalizes camelCase agentServers from existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-servers-"));
    await mkdir(join(root, ".aflow/.specflow"), { recursive: true });
    await writeFile(agentServersLocalPath(root), JSON.stringify({
      agentServers: {
        codex: { type: "registry", registryId: "codex-acp" },
      },
    }), "utf8");

    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: { codex: { type: "registry", registryId: "codex-acp" } },
    });
  });
});
