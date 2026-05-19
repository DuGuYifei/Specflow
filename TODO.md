# TODO

## ACP Agent Runtime Roadmap

Implementation order is intentional. Each phase should finish with tests and docs before moving to the next phase.

### 0. Baseline Already Implemented

- [x] Replace PoC providers with agent-proxy ACP runtime boundary.
- [x] Use `@agentclientprotocol/sdk` for ACP stdio transport.
- [x] Support registry and custom ACP agent server configuration.
- [x] Reserve `headless` agent server type without implementing execution.
- [x] Run workflow nodes through `AgentProxySessionPool`.
- [x] Reuse one ACP process/session per `cwd + agentServerId + workflowSessionId`.
- [x] Record real ACP CLI session ids on `AgentInvocation`.
- [x] Persist invocation metadata into `.specflow/runs/*.yaml`.
- [x] Maintain `.specflow/agent-sessions.json` as the cross-run ACP session index.

### 1. Interaction Driver: Permission and Ask-User

- [x] Add a bridge-level `RunInteractionStore`.
- [x] Define interaction records for ACP permission requests and ACP elicitation requests.
- [x] Pass `onPermissionRequest`, `onElicitationRequest`, and `onElicitationComplete` callbacks from bridge into `AgentProxySessionPool.run`.
- [x] Add server SSE event `interaction-requested`.
- [x] Add server API `POST /api/runs/:runId/interactions/:interactionId/respond`.
- [x] Add timeout/cancel handling when a run finishes before the UI answers.
- [x] Add UI modal/form for permission choices.
- [x] Add UI modal/form for ACP elicitation fields and URL requests.
- [x] Test default cancellation, explicit allow/deny, and run-finished cancellation.

### 2. Durable Workflow Runtime Logs

- [x] Add persistent terminal log storage under `.specflow/run-logs/<runId>.jsonl`.
- [x] Persist terminal chunks with run id, node id, invocation id, stream, sequence, and timestamp.
- [x] Persist workflow-side lifecycle events: process started, initialized, session created, prompt started/stopped/failed/cancelled.
- [x] Persist permission and elicitation audit events without storing secrets or sensitive form values by default.
- [x] Persist restore attempt events: requested mode, selected ACP primitive, success/failure.
- [x] Do not persist full ACP `session/update` history as Specflow's canonical transcript.
- [x] Add `GET /api/runs/:id/logs` for historical replay.
- [x] Make SSE start with persisted historical chunks when reconnecting.
- [x] Update UI log panel to load historical logs before attaching live SSE.
- [x] Test log replay after server restart.

### 3. ACP Session Restore API

- [x] Add agent-proxy API to start an ACP CLI for an existing `agentServerId` without creating a new Specflow workflow run.
- [x] Add support for ACP `session/load` gated by `InitializeResponse.agentCapabilities.loadSession`.
- [x] Add support for ACP `session/resume` gated by `InitializeResponse.agentCapabilities.sessionCapabilities.resume`.
- [x] Define restore modes: `inspect` prefers load, `continue` prefers resume.
- [x] Add server API `POST /api/agent-sessions/:id/restore`.
- [x] Stream restored ACP updates and terminal output through a restore SSE channel for the active restore view.
- [x] Treat ACP agent session history as authoritative; use Specflow run logs only as workflow-side fallback context.
- [x] Write restore attempts and results back into `.specflow/agent-sessions.json`.
- [x] Test restore against fake ACP agents with load-only, resume-only, both, and neither capability.

### 4. Session Browser UI

- [x] Add API client methods for `/api/agent-sessions`.
- [x] Add a session browser view filtered by workflow, agent server, and Specflow session.
- [x] Link run node logs to their `AgentInvocation` and ACP session index entry.
- [x] Add "Inspect session" action for historical replay.
- [x] Add "Resume session" action for continuing work.
- [x] Show capability badges: load, resume, unavailable.
- [x] Handle missing/deleted run references gracefully.

### 5. Agent Server Management UI

- [x] Add registry browser using the ACP registry metadata.
- [x] Add install/update/remove actions for registry agents.
- [x] Add custom ACP agent form for command, args, env, defaults, and config options.
- [x] Store user-local overrides in `.specflow/agent-servers.local.json`.
- [x] Validate configured default modes/models/options against initialized ACP agent capabilities.
- [x] Add UI for per-session agent server selection without hardcoding Codex/Claude only.

### 6. Headless Agent Runtime

- [x] Define the command-template schema for `headless` agents.
- [x] Support prompt interpolation in `argsTemplate`.
- [x] Capture stdout/stderr into the same terminal/log pipeline.
- [x] Define how headless results map to `AgentRunResult`.
- [x] Add cancellation and timeout behavior.
- [x] Add tests for successful execution, non-zero exit, env merge, and cancellation.

### 7. Run Control

- [ ] Add run cancellation API.
- [ ] Propagate cancellation to bridge, agent-proxy, ACP `session/cancel`, and child process cleanup.
- [ ] Persist cancelled run status.
- [ ] Surface cancellation in UI run status and logs.
- [ ] Test cancellation during prompt, permission wait, elicitation wait, and restore.

### 8. Security and Policy

- [ ] Define workspace root policy for ACP filesystem operations.
- [ ] Add configurable allowlist for additional directories.
- [ ] Decide default behavior for terminal creation and terminal auth.
- [ ] Add audit records for permission decisions.
- [ ] Redact sensitive env values from logs and API responses.
- [ ] Document security expectations in `.specflow`.

### 9. Verification Gates

- [ ] Add server API integration tests for run start, SSE terminal logs, and final invocation persistence.
- [ ] Add UI integration test for run start and live log panel updates.
- [ ] Add fake ACP fixtures for permission, elicitation, load, resume, and active restore update streaming.
- [ ] Run `bun run typecheck` before every ACP runtime merge.
- [ ] Run `bun test` before every ACP runtime merge.
