import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSpecflowBridge } from "@specflow/bridge";
import { createApiHandler } from "./api";
import { saveCanvas } from "./canvas-store";
import { loadLocalAgentServerConfig } from "./agent-server-config";

describe("agent server API", () => {
  test("lists configured servers and writes local custom/registry overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);

    const initial = await handle(new Request("http://specflow.test/api/agent-servers"));
    expect(initial?.status).toBe(200);
    const initialBody = await initial!.json() as Array<{ id: string }>;
    expect(initialBody).toEqual([]);

    const putCustom = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        command: "node",
        args: ["agent.js", "--acp"],
        env: { A: "B", API_KEY: "secret" },
        additionalDirectories: ["../shared"],
        terminal: { enabled: false, auth: false },
      }),
    }));
    expect(putCustom?.status).toBe(200);
    const putCustomBody = await putCustom!.json() as Array<{ id: string; settings: { env?: Record<string, string> } }>;
    expect(putCustomBody.find((entry) => entry.id === "my-custom")?.settings.env).toEqual({
      A: "B",
      API_KEY: "[redacted]",
    });
    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "my-custom": {
          type: "custom",
          command: "node",
          args: ["agent.js", "--acp"],
          env: { API_KEY: "secret" },
          additionalDirectories: ["../shared"],
          terminal: { enabled: false, auth: false },
        },
      },
    });

    const preserveRedacted = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "custom",
        command: "node",
        args: ["agent.js", "--acp"],
        env: { API_KEY: "[redacted]" },
      }),
    }));
    expect(preserveRedacted?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers["my-custom"]?.env).toEqual({
      API_KEY: "secret",
    });

    const putRegistry = await handle(new Request("http://specflow.test/api/agent-servers/codex-acp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "codex-acp",
        defaultMode: "auto",
      }),
    }));
    expect(putRegistry?.status).toBe(200);
    expect(await loadLocalAgentServerConfig(root)).toMatchObject({
      agent_servers: {
        "codex-acp": {
          type: "registry",
          registryId: "codex-acp",
          defaultMode: "auto",
        },
      },
    });

    const del = await handle(new Request("http://specflow.test/api/agent-servers/my-custom", { method: "DELETE" }));
    expect(del?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers["my-custom"]).toBeUndefined();
  });

  test("ensures configured registry servers on startup listing without using the browser registry endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    let registryReads = 0;
    const ensured: string[] = [];
    const bridge = {
      ...createSpecflowBridge(),
      listAgentRegistry: async () => {
        registryReads += 1;
        throw new Error("registry should be read only by the explicit registry endpoint");
      },
      ensureAgentServerInstalled: async (_root: string, id: string) => {
        ensured.push(id);
      },
    };
    const handle = createApiHandler(bridge, root);

    const putOld = await handle(new Request("http://specflow.test/api/agent-servers/codex-acp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "codex-acp",
        installedVersion: "1.0.0",
      }),
    }));
    expect(putOld?.status).toBe(200);
    const oldBody = await putOld!.json() as Array<{ id: string; registry?: unknown }>;
    expect(oldBody.find((entry) => entry.id === "codex-acp")?.registry).toBeUndefined();

    const listed = await handle(new Request("http://specflow.test/api/agent-servers"));
    expect(listed?.status).toBe(200);
    expect(registryReads).toBe(0);
    expect(ensured).toEqual(["codex-acp"]);
  });

  test("fetches the registry browser index without creating the agent cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-registry-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);
    const fetchBeforeTest = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({
      version: "1",
      agents: [{
        id: "codex-acp",
        name: "Codex",
        version: "1.0.0",
        distribution: { npx: { package: "codex-acp" } },
      }, {
        id: "other-acp",
        name: "Other",
        version: "1.0.0",
        distribution: { npx: { package: "other-acp" } },
      }],
    })) as unknown as typeof fetch;

    try {
      const response = await handle(new Request("http://specflow.test/api/agent-servers/registry"));
      expect(response?.status).toBe(200);
      expect(await response!.json()).toMatchObject({
        agents: [{ id: "codex-acp", version: "1.0.0" }],
      });
      await expect(access(join(root, ".specflow", "cache", "agents"))).rejects.toThrow();
    } finally {
      globalThis.fetch = fetchBeforeTest;
    }
  });

  test("rejects unsupported registry agent server settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-api-"));
    const handle = createApiHandler(createSpecflowBridge(), root);

    const response = await handle(new Request("http://specflow.test/api/agent-servers/other", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "registry",
        registryId: "other-acp",
      }),
    }));

    expect(response?.status).toBe(400);
  });

  test("probes auth methods and stores env auth values locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-auth-api-"));
    const authStatus = {
      agentServerId: "fake",
      needsAuth: true,
      methods: [{
        type: "env_var" as const,
        id: "env",
        name: "Environment",
        vars: [{ name: "FAKE_API_KEY", secret: true, optional: false }],
        missingVars: [],
      }],
    };
    const bridge = {
      ...createSpecflowBridge(),
      inspectAgentAuthentication: async () => authStatus,
      authenticateAgentServer: async () => authStatus,
    };
    const handle = createApiHandler(bridge, root);

    await handle(new Request("http://specflow.test/api/agent-servers/fake", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "custom", command: "fake-acp" }),
    }));

    const inspected = await handle(new Request("http://specflow.test/api/agent-servers/fake/auth"));
    expect(await inspected!.json()).toEqual(authStatus);

    const authenticated = await handle(new Request("http://specflow.test/api/agent-servers/fake/auth/env", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ env: { FAKE_API_KEY: "secret" } }),
    }));
    expect(authenticated?.status).toBe(200);
    expect((await loadLocalAgentServerConfig(root)).agent_servers.fake?.env).toEqual({
      FAKE_API_KEY: "secret",
    });
  });

  test("preflights every workflow ACP server before starting a run", async () => {
    const root = await mkdtemp(join(tmpdir(), "specflow-agent-server-run-auth-"));
    const authStatus = {
      agentServerId: "needs-auth",
      needsAuth: true,
      methods: [{ type: "agent" as const, id: "login", name: "Sign in" }],
    };
    const bridge = {
      ...createSpecflowBridge(),
      listAgentServers: async () => [{
        id: "needs-auth",
        settings: { type: "custom" as const, command: "fake-acp" },
      }],
      inspectAgentAuthentication: async () => authStatus,
    };
    const handle = createApiHandler(bridge, root);

    await saveCanvas("wf-auth", {
      id: "wf-auth",
      name: "Auth workflow",
      sessions: [{ id: "s1", name: "main", agentServerId: "needs-auth" }],
      nodes: [{
        kind: "step",
        id: "n1",
        num: "1",
        x: 0,
        y: 0,
        w: 200,
        title: "Prompt",
        desc: "Needs auth",
        sessionId: "s1",
        updateDoc: false,
      }],
      edges: [],
    }, root);

    const response = await handle(new Request("http://specflow.test/api/canvases/wf-auth/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));

    expect(response?.status).toBe(409);
    expect(await response!.json()).toEqual({
      error: "Agent authentication required",
      authStatuses: [authStatus],
    });
  });
});
