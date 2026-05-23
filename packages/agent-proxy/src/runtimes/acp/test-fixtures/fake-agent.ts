import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { uuidv7 } from "@specflow/shared";

class FakeAgent implements acp.Agent {
  readonly #connection: acp.AgentSideConnection;
  readonly #sessions = new Map<string, { promptCount: number }>();
  readonly #restoreCapabilities = new Set((process.env.SPECFLOW_FAKE_ACP_RESTORE ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  readonly #promptCapabilities = new Set((process.env.SPECFLOW_FAKE_ACP_PROMPT_CAPABILITIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  readonly #authMethods = (process.env.SPECFLOW_FAKE_ACP_AUTH_METHODS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  #authenticated = process.env.SPECFLOW_FAKE_ACP_PREAUTHORIZED === "1";
  #authenticationCount = 0;

  constructor(connection: acp.AgentSideConnection) {
    this.#connection = connection;
  }

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: this.#restoreCapabilities.has("load"),
        promptCapabilities: {
          image: this.#promptCapabilities.has("image"),
          audio: this.#promptCapabilities.has("audio"),
          embeddedContext: this.#promptCapabilities.has("embeddedContext"),
        },
        sessionCapabilities: {
          close: {},
          ...(this.#restoreCapabilities.has("resume") ? { resume: {} } : {}),
        },
      },
      authMethods: this.#authMethods.map((method) => this.#authMethod(method)),
    };
  }

  async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
    const methodIds = new Set(this.#authMethods.map((method) => this.#authMethod(method).id));
    if (methodIds.size > 0 && !methodIds.has(params.methodId)) {
      throw new Error(`Unknown auth method ${params.methodId}`);
    }
    this.#authenticationCount += 1;
    this.#authenticated = true;
    return {};
  }

  async newSession(): Promise<acp.NewSessionResponse> {
    this.#assertAuthenticated();
    const sessionId = uuidv7();
    this.#sessions.set(sessionId, { promptCount: 0 });
    return this.#sessionResponse(sessionId);
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    this.#assertAuthenticated();
    await maybeDelayRestore();
    this.#sessions.set(params.sessionId, { promptCount: 0 });
    await this.#sendText(params.sessionId, `loaded:${params.sessionId}\n`);
    return this.#sessionResponse(params.sessionId);
  }

  async resumeSession(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
    this.#assertAuthenticated();
    await maybeDelayRestore();
    this.#sessions.set(params.sessionId, { promptCount: 0 });
    return this.#sessionResponse(params.sessionId);
  }

  #sessionResponse(sessionId: string): acp.NewSessionResponse {
    return {
      sessionId,
      modes: {
        currentModeId: "auto",
        availableModes: [{ id: "auto", name: "Auto" }],
      },
      models: {
        currentModelId: "test-model",
        availableModels: [{ modelId: "test-model", name: "Test Model" }],
      },
      configOptions: [
        {
          id: "reasoning",
          name: "Reasoning",
          type: "select",
          currentValue: "medium",
          options: [{ value: "high", name: "High" }],
        },
      ],
    };
  }

  async setSessionMode(): Promise<acp.SetSessionModeResponse> {
    return {};
  }

  async unstable_setSessionModel(): Promise<acp.SetSessionModelResponse> {
    return {};
  }

  async setSessionConfigOption(): Promise<acp.SetSessionConfigOptionResponse> {
    return { configOptions: [] };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const sessionId = params.sessionId;
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    session.promptCount += 1;
    const text = params.prompt.find((block) => block.type === "text")?.text ?? "";

    await this.#sendText(sessionId, `turn:${session.promptCount}\n`);
    await this.#sendText(sessionId, `authenticated:${this.#isAuthenticated()}\n`);
    await this.#sendText(sessionId, `authentications:${this.#authenticationCount}\n`);
    await this.#sendText(sessionId, `prompt:${text}\n`);
    await this.#sendText(sessionId, `blocks:${params.prompt.map((block) => block.type).join(",")}\n`);

    const file = await this.#connection.readTextFile({
      sessionId,
      path: `${process.cwd()}/input.txt`,
    });
    await this.#sendText(sessionId, `file:${file.content}\n`);

    await this.#connection.writeTextFile({
      sessionId,
      path: `${process.cwd()}/out.txt`,
      content: "written-by-agent",
    });

    const terminal = await this.#connection.createTerminal({
      sessionId,
      command: process.execPath,
      args: ["-e", "process.stdout.write('terminal-output')"],
    });
    await terminal.waitForExit();
    const terminalOutput = await terminal.currentOutput();
    await terminal.release();
    await this.#sendText(sessionId, `terminal:${terminalOutput.output}\n`);

    const permission = await this.#connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: "permission-1",
        title: "Edit file",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
    await this.#sendText(
      sessionId,
      `permission:${permission.outcome.outcome === "selected" ? permission.outcome.optionId : "cancelled"}\n`,
    );

    return { stopReason: "end_turn" };
  }

  async cancel(): Promise<void> {}

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    this.#sessions.delete(params.sessionId);
    return {};
  }

  async #sendText(sessionId: string, text: string): Promise<void> {
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }

  #assertAuthenticated(): void {
    if (!this.#isAuthenticated()) {
      throw acp.RequestError.authRequired();
    }
  }

  #isAuthenticated(): boolean {
    return this.#authMethods.length === 0 || this.#authenticated;
  }

  #authMethod(method: string): acp.AuthMethod {
    if (method === "env_var") {
      return {
        type: "env_var",
        id: "env",
        name: "Environment",
        vars: [{ name: "SPECFLOW_FAKE_TOKEN", optional: false, secret: true }],
      };
    }
    if (method === "terminal") {
      return {
        type: "terminal",
        id: "terminal",
        name: "Terminal",
        args: ["--fake-auth"],
      };
    }
    return {
      id: "agent",
      name: "Agent",
    };
  }
}

async function maybeDelayRestore(): Promise<void> {
  const delayMs = Number(process.env.SPECFLOW_FAKE_ACP_RESTORE_DELAY_MS ?? 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);

new acp.AgentSideConnection((connection) => new FakeAgent(connection), stream);
