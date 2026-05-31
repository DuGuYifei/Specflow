import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";

declare function describe(name: string, fn: () => void): void;
declare function beforeEach(fn: () => void): void;
declare function afterEach(fn: () => void): void;
declare function test(name: string, fn: () => Promise<void> | void): void;
declare const expect: (value: unknown) => {
  toContain(expected: unknown): void;
  not: { toContain(expected: unknown): void };
};

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

let runAuthRequired = false;
let holdRunStart = false;
let releaseRunStart: (() => void) | undefined;
let agentSessionHistory: unknown[] = [];
let recordedRunLogs: unknown[] = [];
let restoredPrompts: string[] = [];
let pausedContinues = 0;
let interactionResponses = 0;

function renderApp(root: Root): void {
  root.render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe("App run integration", () => {
  let root: Root | undefined;
  let container: HTMLElement;

  beforeEach(() => {
    const window = new Window({ url: "http://specflow.test" });
    window.SyntaxError = SyntaxError;
    Object.assign(globalThis, {
      window,
      document: window.document,
      HTMLElement: window.HTMLElement,
      SVGElement: window.SVGElement,
      MouseEvent: window.MouseEvent,
      MessageEvent: window.MessageEvent,
      localStorage: window.localStorage,
      EventSource: MockEventSource,
      fetch: mockFetch,
    });
    MockEventSource.instances = [];
    runAuthRequired = false;
    holdRunStart = false;
    releaseRunStart = undefined;
    agentSessionHistory = [];
    recordedRunLogs = [];
    restoredPrompts = [];
    pausedContinues = 0;
    interactionResponses = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    document.body.innerHTML = "";
    root = undefined;
  });

  test("starts a run and renders live terminal output in the log panel", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("terminal", { stream: "stdout", chunk: "live-log-line\n", nodeId: "node-1" });
    source.emit("run-status", { status: "success" });

    await waitForText("live-log-line");
    expect(document.body.textContent).toContain("Back to design");
  });

  test("renders streamed ACP message chunks as one growing timeline message", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "streamed " } },
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } },
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Read file", status: "pending" },
    });
    source.emit("session-update", {
      type: "session_update",
      nodeId: "node-1",
      agentInvocationId: "invocation-1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" },
    });

    await waitForText("streamed answer");
    await waitForText("Read file");
    await waitForText("completed");
    const messages = document.querySelectorAll(".term-stream .timeline-message.agent");
    if (messages.length !== 1) throw new Error(`Expected one merged ACP message, got ${messages.length}`);
    const tools = document.querySelectorAll(".term-stream .timeline-tool");
    if (tools.length !== 1) throw new Error(`Expected one updated tool entry, got ${tools.length}`);
  });

  test("renders gate decisions with exhausted branch traversal budgets", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("node-status", {
      nodeId: "node-1",
      status: "success",
      gateDecision: { branchId: "revise", reason: "Blueprint still needs complete localized copy." },
      gateBranches: [
        { branchId: "approve", label: "approve", traversalsUsed: 0, maxTraversals: 1, available: true },
        { branchId: "revise", label: "revise", traversalsUsed: 2, maxTraversals: 2, available: false },
      ],
    });

    await waitForText("Blueprint still needs complete localized copy.");
    await waitForText("revise 2/2 exhausted");
    const gates = document.querySelectorAll(".term-stream .timeline-gate");
    if (gates.length !== 1) throw new Error(`Expected one gate decision entry, got ${gates.length}`);
  });

  test("loads the first existing workflow when the renamed example is absent", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases") {
        return json([{ id: "legacy-flow", name: "Existing workflow" }]);
      }
      if (method === "GET" && url === "/api/canvases/legacy-flow") {
        return json({ ...sampleCanvas(), id: "legacy-flow", name: "Existing workflow" });
      }
      if (method === "GET" && url === "/api/agent-sessions?workflowId=legacy-flow") {
        return json([]);
      }
      return defaultFetch(input, init);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Existing workflow");
    await waitForText("Start run");
  });

  test("adds a session and renders it immediately", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Logs");
    clickButtonContaining("Sessions", "last");
    await waitForText("New agent session");

    const input = document.querySelector(".add-session-row input");
    if (!(input instanceof window.HTMLInputElement)) throw new Error("Session name input not found");
    setInputValue(input, "reviewer");
    clickButton("Add");

    await waitForText("reviewer");
    expect(document.body.textContent).toContain("2 sessions");
  });

  test("assigns a step session from the right panel dropdown and keeps Add available", async () => {
    const defaultFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
        return json({
          ...sampleCanvas(),
          sessions: [
            { id: "main", name: "main", agentServerId: "echo-headless" },
            { id: "reviewer", name: "reviewer", agentServerId: "codex-acp" },
          ],
        });
      }
      return defaultFetch(input, init);
    };

    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    const step = document.querySelector(".node");
    if (!(step instanceof window.HTMLElement)) throw new Error("Step node not found");
    step.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForText("Definition");

    const select = document.querySelector(".node-session-select");
    if (!(select instanceof window.HTMLSelectElement)) throw new Error("Right panel session selector not found");
    if (select.value !== "main") throw new Error(`Expected main session, got ${select.value}`);
    if (!document.querySelector(".node-session-control button")) throw new Error("Right panel Add button not found");

    setSelectValue(select, "reviewer");
    await waitFor(() => select.value === "reviewer");
  });

  test("organizes ACP session history under the selected agent", async () => {
    agentSessionHistory = [
      sampleAgentSession("claude-acp", "claude-review", "claude-runtime"),
      sampleAgentSession("codex-acp", "implementation", "codex-runtime"),
    ];
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Agent Sessions");
    clickButtonContaining("Agent Sessions");

    await waitForText("claude-runtime");
    expect(document.body.textContent).not.toContain("codex-runtime");

    const agentSelect = document.querySelector(".agent-session-agent-select");
    if (!(agentSelect instanceof window.HTMLSelectElement)) throw new Error("Agent session selector not found");
    setSelectValue(agentSelect, "codex-acp");

    await waitForText("codex-runtime");
    expect(document.body.textContent).not.toContain("claude-runtime");
  });

  test("opens the auth modal when run preflight requires agent authentication", async () => {
    runAuthRequired = true;
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitForText("Authenticate agents");
    expect(document.body.textContent).toContain("echo-headless");
    expect(document.body.textContent).toContain("Workspace login");
  });

  test("keeps a run launch status visible while agent checks are pending", async () => {
    holdRunStart = true;
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");

    await waitForText("Checking agents...");
    releaseRunStart?.();
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
  });

  test("shows Inspect output in its own conversation window rather than the run Logs tab", async () => {
    agentSessionHistory = [sampleAgentSession("echo-headless", "main", "historical")];
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Agent Sessions");
    clickButtonContaining("Agent Sessions");
    await waitForText("historical");
    clickButton("Inspect");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/agent-session-restores/restore-1/events"));

    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/agent-session-restores/restore-1/events")!;
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "restored-" } },
    });
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "transcript" } },
    });
    await waitForText("restored-transcript");
    clickButton("Logs");

    const logs = document.querySelector(".term-stream")?.textContent ?? "";
    const conversation = document.querySelector(".conversation-transcript")?.textContent ?? "";
    expect(logs).not.toContain("restored-transcript");
    expect(conversation).toContain("restored-transcript");
    const messages = document.querySelectorAll(".conversation-transcript .timeline-message.agent");
    if (messages.length !== 1) throw new Error(`Expected one restored ACP message, got ${messages.length}`);
  });

  test("uses the Resume conversation window to send a follow-up ACP prompt", async () => {
    agentSessionHistory = [sampleAgentSession("echo-headless", "main", "historical")];
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Agent Sessions");
    clickButtonContaining("Agent Sessions");
    await waitForText("historical");
    clickButton("Resume");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/agent-session-restores/restore-1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/agent-session-restores/restore-1/events")!;
    source.emit("session-update", {
      type: "session-update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "loaded history" } },
    });
    source.emit("restore-status", { type: "restore-status", status: "success", selectedPrimitive: "load" });
    await waitForText("loaded history");
    await waitForText("Restored through ACP session/load.");

    const input = document.querySelector(".conversation-compose textarea");
    if (!(input instanceof window.HTMLTextAreaElement)) throw new Error("Resume prompt textarea not found");
    setTextAreaValue(input, "continue reviewing");
    await waitFor(() => {
      const send = document.querySelector(".conversation-compose button");
      return send instanceof window.HTMLButtonElement && !send.disabled;
    });
    clickButton("Send");
    await waitFor(() => restoredPrompts.includes("continue reviewing"));
    source.emit("interaction-requested", {
      type: "interaction-requested",
      interaction: {
        id: "interaction-1",
        runId: "run1",
        kind: "permission",
        status: "pending",
        createdAt: "2026-05-24T10:00:00.000Z",
        agentInvocationId: "restore:restore-1",
        agentId: "agent-server-echo-headless",
        agentServerId: "echo-headless",
        toolCall: { title: "Edit file" },
        options: [{ optionId: "allow", name: "Allow" }],
      },
    });
    await waitForText("Edit file");
    clickButton("Allow");
    await waitFor(() => interactionResponses === 1);
  });

  test("shows recorded context when Resume must use ACP resume without load support", async () => {
    const session = sampleAgentSession("echo-headless", "main", "resume-only") as ReturnType<typeof sampleAgentSession>;
    session.acpSupportsLoadSession = false;
    agentSessionHistory = [session];
    recordedRunLogs = [{
      type: "session_update",
      runId: "run1",
      nodeId: "node-1",
      agentInvocationId: "resume-only-invocation",
      sessionId: "resume-only",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "recorded context" } },
      at: "2026-05-19T10:00:00.000Z",
    }];
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickBottomBarHandle();
    await waitForText("Agent Sessions");
    clickButtonContaining("Agent Sessions");
    await waitForText("resume-only");
    clickButton("Resume");

    await waitForText("ACP resume cannot replay history; showing recorded Specflow context.");
    await waitForText("recorded context");
  });

  test("shows a paused node composer for its session and continues from the node card", async () => {
    root = createRoot(container);
    renderApp(root);

    await waitForText("Start run");
    clickButton("Start run");
    await waitForText("No run inputs for this workflow.");
    clickButton("Start run", "last");
    await waitFor(() => MockEventSource.instances.some((source) => source.url === "/api/runs/run1/events"));
    const source = MockEventSource.instances.find((candidate) => candidate.url === "/api/runs/run1/events")!;
    source.emit("node-status", { nodeId: "node-1", status: "paused" });

    await waitForText("Paused after Echo");
    clickButton("Continue");
    await waitFor(() => pausedContinues === 1);
    await waitFor(() => !(document.body.textContent?.includes("Paused after Echo") ?? false));
  });
});

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const method = init?.method ?? "GET";

  if (method === "GET" && url === "/api/canvases") {
    return json([{ id: "example-code-frontend-flow", name: "Workflow" }]);
  }
  if (method === "GET" && url === "/api/canvases/example-code-frontend-flow") {
    return json(sampleCanvas());
  }
  if (method === "GET" && url.startsWith("/api/runs?")) {
    return json([]);
  }
  if (method === "GET" && url === "/api/agent-sessions?workflowId=example-code-frontend-flow") {
    return json(agentSessionHistory);
  }
  if (method === "GET" && url === "/api/agent-servers") {
    return json([{ id: "echo-headless", settings: { type: "headless", command: "node", argsTemplate: [] } }]);
  }
  if (method === "POST" && url === "/api/canvases/example-code-frontend-flow/run") {
    if (holdRunStart) {
      return new Promise((resolve) => {
        releaseRunStart = () => resolve(Response.json({ runId: "run1" }));
      });
    }
    if (runAuthRequired) {
      return json({
        error: "Agent authentication required",
        authStatuses: [{
          agentServerId: "echo-headless",
          needsAuth: true,
          methods: [{ type: "agent", id: "workspace-login", name: "Workspace login" }],
        }],
      }, { status: 409 });
    }
    return json({ runId: "run1" });
  }
  if (method === "GET" && url === "/api/runs/run1") {
    return json(sampleRun("running"));
  }
  if (method === "GET" && url === "/api/runs/run1/logs") {
    return json(recordedRunLogs);
  }
  if (method === "GET" && url === "/api/runs/run1/paused-nodes") {
    return json([]);
  }
  if (method === "POST" && /^\/api\/agent-sessions\/[^/]+\/restore$/.test(url)) {
    return json({ restoreId: "restore-1", status: "running" });
  }
  if (method === "POST" && url === "/api/agent-session-restores/restore-1/prompt") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { prompt?: string };
    if (body.prompt) restoredPrompts.push(body.prompt);
    return json({ output: "continued" });
  }
  if (method === "POST" && url === "/api/runs/run1/paused-nodes/node-1/continue") {
    pausedContinues += 1;
    return json({ ok: true });
  }
  if (method === "POST" && url === "/api/runs/run1/interactions/interaction-1/respond") {
    interactionResponses += 1;
    return json({ ok: true });
  }
  return json({ ok: true });
}

function json(value: unknown, init?: ResponseInit): Promise<Response> {
  return Promise.resolve(Response.json(value, init));
}

function sampleCanvas() {
  return {
    id: "example-code-frontend-flow",
    name: "Workflow",
    sessions: [{ id: "main", name: "main", agentServerId: "echo-headless" }],
    nodes: [{
      kind: "step",
      id: "node-1",
      num: "1",
      x: 120,
      y: 120,
      w: 240,
      title: "Echo",
      prompt: "echo prompt",
        sessionId: "main",
    }],
    edges: [],
  };
}

function sampleRun(status: string) {
  return {
    id: "run1",
    workflowId: "example-code-frontend-flow",
    label: "Run #1",
    ticket: "",
    status,
    startedAt: "2026-05-19T10:00:00.000Z",
    duration: "-",
    agent: "echo-headless",
    nodeStates: { "node-1": "running" },
    nodeOutputs: {},
    agentflowSnapshot: sampleCanvas(),
    canvasSnapshot: { workflowId: "example-code-frontend-flow", version: 1, nodes: [{ nodeId: "node-1", x: 120, y: 120, w: 240 }] },
    initialInput: "",
    variableValues: {},
  };
}

function sampleAgentSession(agentServerId: string, specflowSessionId: string, acpSessionId: string) {
  return {
    id: `${agentServerId}-${acpSessionId}`,
    workflowId: "example-code-frontend-flow",
    specflowSessionId,
    agentId: `agent-server-${agentServerId}`,
    agentServerId,
    acpSessionId,
    acpSupportsLoadSession: true,
    acpSupportsResumeSession: true,
    firstSeenAt: "2026-05-19T10:00:00.000Z",
    lastSeenAt: "2026-05-19T10:05:00.000Z",
    latestRunId: "run1",
    latestInvocationId: `${acpSessionId}-invocation`,
    latestStatus: "done",
    runIds: ["run1"],
    invocationIds: [`${acpSessionId}-invocation`],
    invocations: [{
      runId: "run1",
      invocationId: `${acpSessionId}-invocation`,
      nodeId: "node-1",
      status: "done",
      startedAt: "2026-05-19T10:00:00.000Z",
    }],
  };
}

function clickButton(text: string, pick: "first" | "last" = "first"): void {
  const matches = [...document.getElementsByTagName("button")].filter((candidate) =>
    candidate.textContent?.trim() === text,
  );
  const button = pick === "last" ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Button not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function clickButtonContaining(text: string, pick: "first" | "last" = "first"): void {
  const matches = [...document.getElementsByTagName("button")].filter((candidate) =>
    candidate.textContent?.includes(text),
  );
  const button = pick === "last" ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Button containing text not found: ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function clickBottomBarHandle(): void {
  const bottomBar = document.getElementsByClassName("bottom-bar-cell")[0];
  const button = bottomBar?.getElementsByTagName("button")[0];
  if (!button) throw new Error("Bottom bar handle not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  const InputEventCtor = window.InputEvent ?? window.Event;
  input.dispatchEvent(new InputEventCtor("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function setTextAreaValue(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  const InputEventCtor = window.InputEvent ?? window.Event;
  input.dispatchEvent(new InputEventCtor("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function waitForText(text: string): Promise<void> {
  await waitFor(() => document.body.textContent?.includes(text) ?? false);
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
