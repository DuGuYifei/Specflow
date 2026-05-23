import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  authenticateAcpAgent,
  inspectAcpAgentAuthentication,
  restoreAcpAgentSession,
  runAcpAgent,
} from "./connection";
import type { AgentRunRequest, ResolvedAgentServer } from "../../types";

const fakeAgentPath = fileURLToPath(new URL("./test-fixtures/fake-agent.ts", import.meta.url));

describe("runAcpAgent", () => {
  it("runs an ACP subprocess through the official SDK and services client requests", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-"));
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");
    const terminalEvents: string[] = [];
    const lifecycleEvents: string[] = [];

    const result = await runAcpAgent(resolved(), {
      agentServerId: "fake-acp",
      cwd,
      prompt: "hello",
      onPermissionRequest: async () => ({ outcome: "selected", optionId: "allow" }),
      onTerminalEvent: (event) => terminalEvents.push(`${event.stream}:${event.chunk}`),
      onLifecycleEvent: (event) => lifecycleEvents.push(event.type),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.output).toContain("prompt:hello");
    expect(result.output).toContain("file:file-content");
    expect(result.output).toContain("terminal:terminal-output");
    expect(result.output).toContain("permission:allow");
    expect(await readFile(join(cwd, "out.txt"), "utf8")).toBe("written-by-agent");
    expect(terminalEvents.some((event) => event.includes("[acp:stop] end_turn"))).toBe(true);
    expect(lifecycleEvents).toEqual([
      "process_started",
      "initialized",
      "session_created",
      "prompt_started",
      "prompt_stopped",
      "session_closed",
    ]);
  });

  it("fails when the configured default mode is not advertised by the agent", async () => {
    const result = await runAcpAgent(resolved({ settings: { defaultMode: "missing-mode" } }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-")),
      prompt: "hello",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('mode "missing-mode"');
  });

  it("fails when the configured default model is not advertised by the agent", async () => {
    const result = await runAcpAgent(resolved({ settings: { defaultModel: "missing-model" } }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-")),
      prompt: "hello",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('model "missing-model"');
  });

  it("fails when a configured default config option value is not advertised by the agent", async () => {
    const result = await runAcpAgent(resolved({ settings: { defaultConfigOptions: { reasoning: "low" } } }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-")),
      prompt: "hello",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('config option "reasoning" value "low"');
  });

  it("does not start authentication merely because the agent advertises a method", async () => {
    const result = await runAcpAgent(resolved({ authMethods: "agent" }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-")),
      prompt: "hello",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output.toLowerCase()).toContain("auth");
  });

  it("does not re-authenticate an already authorized agent that advertises methods", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-"));
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");

    const result = await runAcpAgent(resolved({
      authMethods: "agent",
      preauthorized: true,
    }), {
      agentServerId: "fake-acp",
      cwd,
      prompt: "hello",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("authenticated:true");
    expect(result.output).toContain("authentications:0");
  });

  it("downgrades unsupported binary prompt blocks to resource links", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-"));
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");
    const promptBlocks: AgentRunRequest["promptBlocks"] = [
      { type: "text", text: "inspect" },
      {
        type: "image",
        data: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "image/png",
        uri: "file:///tmp/screenshot.png",
      },
      {
        type: "audio",
        data: Buffer.from([4, 5, 6]).toString("base64"),
        mimeType: "audio/wav",
        _meta: { specflowUri: "file:///tmp/capture.wav", specflowName: "capture.wav" },
      },
      {
        type: "resource",
        resource: {
          uri: "file:///tmp/archive.bin",
          blob: Buffer.from([7, 8, 9]).toString("base64"),
          mimeType: "application/octet-stream",
        },
      },
    ];

    const result = await runAcpAgent(resolved(), {
      agentServerId: "fake-acp",
      cwd,
      prompt: "inspect",
      promptBlocks,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("blocks:text,resource_link,resource_link,resource_link");
  });

  it("keeps binary prompt blocks when the agent advertises support", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-"));
    await writeFile(join(cwd, "input.txt"), "file-content", "utf8");

    const result = await runAcpAgent(resolved({ promptCapabilities: "image,audio,embeddedContext" }), {
      agentServerId: "fake-acp",
      cwd,
      prompt: "inspect",
      promptBlocks: [
        { type: "text", text: "inspect" },
        {
          type: "image",
          data: Buffer.from([1, 2, 3]).toString("base64"),
          mimeType: "image/png",
          uri: "file:///tmp/screenshot.png",
        },
        {
          type: "audio",
          data: Buffer.from([4, 5, 6]).toString("base64"),
          mimeType: "audio/wav",
        },
        {
          type: "resource",
          resource: {
            uri: "file:///tmp/archive.bin",
            blob: Buffer.from([7, 8, 9]).toString("base64"),
            mimeType: "application/octet-stream",
          },
        },
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("blocks:text,image,audio,resource");
  });
});

describe("restoreAcpAgentSession", () => {
  it("uses load for inspect mode when the agent supports load and resume", async () => {
    const updates: string[] = [];
    const result = await restoreAcpAgentSession(resolved({ restoreCapabilities: "load,resume" }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-restore-")),
      sessionId: "prior-session",
      mode: "inspect",
      onSessionUpdate: (event) => {
        if (event.update.sessionUpdate === "agent_message_chunk" && event.update.content.type === "text") {
          updates.push(event.update.content.text);
        }
      },
    });

    expect(result.selectedPrimitive).toBe("load");
    expect(result.sessionId).toBe("prior-session");
    expect(result.initializeResponse.agentCapabilities?.loadSession).toBe(true);
    expect(updates.join("")).toContain("loaded:prior-session");
  });

  it("uses resume for continue mode when the agent supports load and resume", async () => {
    const result = await restoreAcpAgentSession(resolved({ restoreCapabilities: "load,resume" }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-restore-")),
      sessionId: "prior-session",
      mode: "continue",
    });

    expect(result.selectedPrimitive).toBe("resume");
    expect(result.initializeResponse.agentCapabilities?.sessionCapabilities?.resume).toEqual({});
  });

  it("falls back to resume for inspect mode when load is unavailable", async () => {
    const result = await restoreAcpAgentSession(resolved({ restoreCapabilities: "resume" }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-restore-")),
      sessionId: "prior-session",
      mode: "inspect",
    });

    expect(result.selectedPrimitive).toBe("resume");
  });

  it("falls back to load for continue mode when resume is unavailable", async () => {
    const result = await restoreAcpAgentSession(resolved({ restoreCapabilities: "load" }), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-restore-")),
      sessionId: "prior-session",
      mode: "continue",
    });

    expect(result.selectedPrimitive).toBe("load");
  });

  it("rejects restore when the agent advertises neither load nor resume", async () => {
    await expect(restoreAcpAgentSession(resolved(), {
      agentServerId: "fake-acp",
      cwd: await mkdtemp(join(tmpdir(), "specflow-acp-restore-")),
      sessionId: "prior-session",
      mode: "inspect",
    })).rejects.toThrow("does not support session restore");
  });
});

describe("ACP auth inspection", () => {
  it("does not require user auth when an agent already accepts sessions", async () => {
    const inspected = await inspectAcpAgentAuthentication(
      resolved({ authMethods: "env_var", preauthorized: true }),
      await mkdtemp(join(tmpdir(), "specflow-acp-auth-ready-")),
    );

    expect(inspected.needsAuth).toBe(false);
    expect(inspected.methods[0]).toMatchObject({
      type: "env_var",
      missingVars: ["SPECFLOW_FAKE_TOKEN"],
    });
  });

  it("reports env vars required by the agent and authenticates once they are configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "specflow-acp-auth-"));
    const inspected = await inspectAcpAgentAuthentication(resolved({ authMethods: "env_var" }), cwd);
    expect(inspected).toEqual({
      agentServerId: "fake-acp",
      needsAuth: true,
      methods: [{
        type: "env_var",
        id: "env",
        name: "Environment",
        vars: [{ name: "SPECFLOW_FAKE_TOKEN", secret: true, optional: false }],
        missingVars: ["SPECFLOW_FAKE_TOKEN"],
      }],
    });

    const authenticated = await authenticateAcpAgent(
      resolved({ authMethods: "env_var", env: { SPECFLOW_FAKE_TOKEN: "token" } }),
      cwd,
      "env",
    );
    expect(authenticated.needsAuth).toBe(false);
    expect(authenticated.methods[0]?.id).toBe("env");
  });
});

function resolved(options: {
  restoreCapabilities?: string;
  promptCapabilities?: string;
  authMethods?: string;
  preauthorized?: boolean;
  env?: Record<string, string>;
  settings?: Partial<Extract<ResolvedAgentServer["settings"], { type: "custom" }>>;
} = {}): ResolvedAgentServer {
  return {
    id: "fake-acp",
    source: "custom",
    settings: {
      type: "custom",
      command: "bun",
      args: [],
      defaultMode: "auto",
      defaultModel: "test-model",
      defaultConfigOptions: { reasoning: "high" },
      ...options.settings,
    },
    command: {
      command: "bun",
      args: [fakeAgentPath],
      env: {
        ...(options.env ?? {}),
        ...(options.restoreCapabilities ? { SPECFLOW_FAKE_ACP_RESTORE: options.restoreCapabilities } : {}),
        ...(options.promptCapabilities ? { SPECFLOW_FAKE_ACP_PROMPT_CAPABILITIES: options.promptCapabilities } : {}),
        ...(options.authMethods ? { SPECFLOW_FAKE_ACP_AUTH_METHODS: options.authMethods } : {}),
        ...(options.preauthorized ? { SPECFLOW_FAKE_ACP_PREAUTHORIZED: "1" } : {}),
      },
    },
  };
}
