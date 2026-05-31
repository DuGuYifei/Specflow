# ADR-004: ACP authentication redesign

## Status

Accepted and implemented direction for the ACP auth rewrite.

## Scope

This note records the Zed ACP authentication model observed from source and the
Specflow auth behavior chosen from that research. The target is ACP-native auth:
Specflow discovers auth methods from the agent, displays those methods in the
UI, and runs terminal auth through a browser-visible PTY owned by the local
server.

Sources inspected on 2026-05-31:

- `zed-industries/zed` at `09165c1`
- `zed-industries/codex-acp` at `863d433`
- `agentclientprotocol/claude-agent-acp` at `51a370e`
- Claude Code LLM gateway documentation at
  `https://code.claude.com/docs/en/llm-gateway`
- Local Specflow repository at the current working tree

## Previous Specflow Behavior

Before this redesign, Specflow mixed ACP method discovery with Specflow-owned
credential handling:

- startup could prompt for agent selection, installation, and login;
- env-var auth could collect secrets in the web UI and write them into local
  agent server config;
- terminal auth could run against the terminal that launched the server;
- permission requests could be resolved automatically by server policy;
- agent server config also carried server-level model, mode, and config
  defaults.

That model made the web server harder to run in the background and created a
second auth system beside ACP. The new implementation removes that behavior.

## Zed Authentication Model

Zed treats ACP auth as part of the agent protocol rather than as a Zed-owned
credential system.

### Client Capabilities

When Zed initializes an ACP server, it advertises:

- file system support
- terminal support
- auth terminal support
- `_meta["terminal-auth"] = true`

In the inspected code this is built in `crates/agent_servers/src/acp.rs` around
the ACP `InitializeRequest`. The inspected Zed revision does not advertise the
Claude gateway extension capability (`auth._meta.gateway`) in this path.

Specflow now follows that shape: it declares ACP terminal auth support and the
Zed-compatible terminal-auth metadata flag, but it does not declare gateway
support.

### Auth Method Storage

Zed stores the `auth_methods` returned by the agent's initialize response on
the ACP connection. The UI later reads `connection.auth_methods()` and renders
buttons directly from those methods. The first method is styled as the primary
button, but Zed does not embed Codex- or Claude-specific env-var forms in the
conversation auth UI.

Specflow follows the same principle. Auth methods come from ACP initialize
responses, plus a small documented compatibility shim for Gemini.

### Auth Required Flow

Zed primarily reacts to ACP `AuthRequired` errors. When session creation or
thread work fails with `AuthRequired`, the conversation moves into an
unauthenticated state. The UI displays an auth callout and exposes the methods
advertised by the agent. Clicking a method either:

- runs a terminal auth task if Zed can derive one for the method, or
- sends ACP `AuthenticateRequest { methodId }` to the agent.

After successful authentication, Zed resets/reconnects the conversation state.

Specflow performs auth preflight before workflow runs instead of at server
startup. A missing auth state blocks the run and returns the ACP-native methods
needed by the UI.

### Terminal Auth

Zed has a terminal panel, so terminal auth is implemented by turning an ACP
auth method into a `SpawnInTerminal` task and running that task in the panel.

There are two terminal auth shapes:

- Native ACP terminal methods: `AuthMethod::Terminal`, with args and env.
- Compatibility metadata: `_meta["terminal-auth"]`, present on any auth method
  type, with command, args, env, and label.

For native terminal methods, Zed resolves the agent command from agent server
settings, appends the method args/env, and spawns it in a new terminal. For the
metadata path, Zed uses the exact command payload in `_meta["terminal-auth"]`.

Zed detects completion in two ways:

- If no special success pattern is known, wait for process exit and require a
  successful exit code.
- For long-running login shells, such as `claude-login` and Gemini's shim,
  watch terminal output for patterns like `Login successful` or
  `Type your message`.

Specflow uses the same terminal task model, but the UX is a modal rather than a
docked terminal panel. The PTY lives in the Bun server process. The browser
subscribes to PTY output over SSE and sends input, resize, cancel, and status
check commands over HTTP.

## Agent-Specific Findings

### Codex ACP

`codex-acp` advertises three auth methods:

- `chatgpt`: an ACP agent method. Calling ACP `authenticate` starts the Codex
  ChatGPT login flow through Codex's login machinery.
- `codex-api-key`: an ACP env-var method requiring `CODEX_API_KEY`.
- `openai-api-key`: an ACP env-var method requiring `OPENAI_API_KEY`.

For env-var methods, `codex-acp` itself reads the key from its process
environment during `authenticate`. Specflow provides those variables through
agent server `env`. The UI only shows required and missing variable names; it
does not collect or write secrets.

Codex also removes the browser-based `chatgpt` method when `NO_BROWSER` is set,
so remote/headless behavior is expected to be driven by the agent's advertised
methods.

### Claude Agent ACP

`claude-agent-acp` advertises terminal auth methods only if the client declares
terminal auth support:

- Local environment:
  - `claude-ai-login`: terminal method for Claude subscription login.
  - `console-login`: terminal method for Anthropic Console/API billing login.
- Remote environment:
  - `claude-login`: terminal method running the Claude TUI login path.

It can also advertise gateway methods:

- `gateway`
- `gateway-bedrock`

Those are only offered when the client advertises `auth._meta.gateway = true`.
Zed did not advertise that capability in the inspected ACP path, so gateway auth
is supported by the Claude agent but is not part of Zed's default ACP login
surface at the inspected revision.

The public Claude Code LLM gateway documentation describes gateway use as
environment-driven configuration: gateway base URLs plus auth tokens, API keys,
or helper-provided keys. It is effectively a way to route Claude Code through a
central proxy that owns model access, usage tracking, cost controls, and audit
logging. Specflow does not implement Claude gateway auth yet. If Zed exposes it
through the ACP auth path later, Specflow should follow that capability and map
the ACP method metadata into equivalent Claude environment instead of inventing
a separate credential format.

### Gemini

Zed has a Gemini-specific compatibility shim. The code contains a TODO to
remove the override once Google releases official auth methods.

For `agent_id == "gemini"`, Zed injects a synthetic auth method:

- id: `spawn-gemini-cli`
- type: ACP agent auth method
- metadata: `_meta["terminal-auth"]` with command, args, env, and label for
  running Gemini auth in a terminal

The args are based on the original Gemini command with ACP flags removed. Zed
then uses the same terminal-auth machinery as above. It also contains retry
logic for remote Gemini login when the process exits before the success pattern
is observed.

Specflow implements the same compatibility idea: Gemini gets a synthetic
terminal-auth method only when official ACP auth metadata is absent. This is a
client compatibility layer, not a new Specflow auth system.

## Implemented Specflow Behavior

### Startup

`specflow serve` starts the web server and UI. It does not prompt for agent
selection, install registry agents, inspect auth, or log in.

The server may create the workspace scaffolding needed to serve the project,
but auth belongs to workflow execution, not startup.

### Run Preflight

Workflow runs perform auth preflight for the agent servers referenced by the
workflow:

- Web runs return the existing `409 Agent authentication required` shape with
  ACP-native auth method details.
- CLI runs print actionable auth information and exit non-zero.
- After auth succeeds, the user can retry the same run without restarting the
  server.

### Auth Methods

Specflow initializes ACP clients with terminal auth support and the
Zed-compatible terminal-auth metadata flag. It then normalizes the returned auth
methods for UI display.

Non-terminal methods call ACP `authenticate(methodId)`. Env-var methods are
shown as configuration requirements: users add secrets to
`.specflow/agent-servers.json` or `.specflow/agent-servers.local.json`, and the
next auth inspection reads those files again.

Terminal methods create a server-side PTY session. The UI opens an auth modal
with a reusable terminal surface, streams output over SSE, and sends input,
resize, cancel, and status-check requests back to the server.

### Configuration

Agent server config is limited to process launch boundaries:

- `type`
- `command`
- `args`
- `cwd`
- `env`
- `additionalDirectories`
- registry metadata for built-in agents

Mode, model, reasoning, and ACP config options are node-level settings. They
are not server defaults.

`.specflow/agent-servers.local.json` deep-merges with
`.specflow/agent-servers.json` by agent id. Nested `env` maps also merge, with
local values overriding shared values. This lets shared config define the
agent command while local config provides only secrets or machine-specific
paths.

Example:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Permission Requests

ACP permission requests always create a pending UI interaction. Specflow no
longer resolves them automatically on the server.

The UI displays every option returned by the agent, including allow, deny, and
agent-specific choices. The response API sends either the selected option id or
a cancellation. Users who want fewer prompts should select an appropriate
node-level ACP mode/config option, such as a full-access mode provided by the
agent.

## Web Auth API

`GET /api/agent-servers/:id/auth`

- Resolves fresh merged agent server settings.
- Initializes ACP with terminal auth capabilities enabled.
- Returns current auth status and normalized auth methods.
- Does not write config.

`POST /api/agent-servers/:id/auth/:methodId`

- Resolves fresh merged settings.
- Starts a PTY auth session for native terminal methods or
  `_meta["terminal-auth"]` methods.
- Calls ACP `authenticate(methodId)` for non-terminal methods.
- Does not accept or persist secret values from the UI.

`GET /api/agent-auth-terminals/:sessionId/events`

- Streams PTY output and status events to the browser.

`POST /api/agent-auth-terminals/:sessionId/input`

- Writes buffered browser input into the PTY.

`POST /api/agent-auth-terminals/:sessionId/resize`

- Resizes the PTY.

`POST /api/agent-auth-terminals/:sessionId/cancel`

- Cancels the auth terminal session.

`POST /api/agent-auth-terminals/:sessionId/check`

- Re-inspects auth status using fresh settings.

## Package Boundaries

`agent-proxy`

- Normalizes ACP auth methods.
- Resolves terminal auth methods into terminal auth tasks.
- Implements Gemini compatibility metadata.
- Does not own web PTY sessions.

`server`

- Owns Bun PTY auth sessions.
- Exposes SSE and POST transport for browser terminal auth.
- Performs workflow-run auth preflight.

`ui`

- Renders the auth modal and env-var method details.
- Uses a reusable `TerminalSurface` for terminal auth.
- Keeps the bottom session/log panel as a read-only run timeline.

`bridge`

- Connects workflow execution and auth inspection.
- Does not own PTY lifecycle.

