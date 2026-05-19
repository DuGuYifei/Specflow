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

- [ ] Add a bridge-level `RunInteractionStore`.
- [ ] Define interaction records for ACP permission requests and ACP elicitation requests.
- [ ] Pass `onPermissionRequest`, `onElicitationRequest`, and `onElicitationComplete` callbacks from bridge into `AgentProxySessionPool.run`.
- [ ] Add server SSE event `interaction-requested`.
- [ ] Add server API `POST /api/runs/:runId/interactions/:interactionId/respond`.
- [ ] Add timeout/cancel handling when a run finishes before the UI answers.
- [ ] Add UI modal/form for permission choices.
- [ ] Add UI modal/form for ACP elicitation fields and URL requests.
- [ ] Test default cancellation, explicit allow/deny, and run-finished cancellation.

### 2. Durable Workflow Runtime Logs

- [ ] Add persistent terminal log storage under `.specflow/run-logs/<runId>.jsonl`.
- [ ] Persist terminal chunks with run id, node id, invocation id, stream, sequence, and timestamp.
- [ ] Persist workflow-side lifecycle events: process started, initialized, session created, prompt started/stopped/failed/cancelled.
- [ ] Persist permission and elicitation audit events without storing secrets or sensitive form values by default.
- [ ] Persist restore attempt events: requested mode, selected ACP primitive, success/failure.
- [ ] Do not persist full ACP `session/update` history as Specflow's canonical transcript.
- [ ] Add `GET /api/runs/:id/logs` for historical replay.
- [ ] Make SSE start with persisted historical chunks when reconnecting.
- [ ] Update UI log panel to load historical logs before attaching live SSE.
- [ ] Test log replay after server restart.

### 3. ACP Session Restore API

- [ ] Add agent-proxy API to start an ACP CLI for an existing `agentServerId` without creating a new Specflow workflow run.
- [ ] Add support for ACP `session/load` gated by `InitializeResponse.agentCapabilities.loadSession`.
- [ ] Add support for ACP `session/resume` gated by `InitializeResponse.agentCapabilities.sessionCapabilities.resume`.
- [ ] Define restore modes: `inspect` prefers load, `continue` prefers resume.
- [ ] Add server API `POST /api/agent-sessions/:id/restore`.
- [ ] Stream restored ACP updates and terminal output through a restore SSE channel for the active restore view.
- [ ] Treat ACP agent session history as authoritative; use Specflow run logs only as workflow-side fallback context.
- [ ] Write restore attempts and results back into `.specflow/agent-sessions.json`.
- [ ] Test restore against fake ACP agents with load-only, resume-only, both, and neither capability.

### 4. Session Browser UI

- [ ] Add API client methods for `/api/agent-sessions`.
- [ ] Add a session browser view filtered by workflow, agent server, and Specflow session.
- [ ] Link run node logs to their `AgentInvocation` and ACP session index entry.
- [ ] Add "Inspect session" action for historical replay.
- [ ] Add "Resume session" action for continuing work.
- [ ] Show capability badges: load, resume, unavailable.
- [ ] Handle missing/deleted run references gracefully.

### 5. Agent Server Management UI

- [ ] Add registry browser using the ACP registry metadata.
- [ ] Add install/update/remove actions for registry agents.
- [ ] Add custom ACP agent form for command, args, env, defaults, and config options.
- [ ] Store user-local overrides in `.specflow/agent-servers.local.json`.
- [ ] Validate configured default modes/models/options against initialized ACP agent capabilities.
- [ ] Add UI for per-session agent server selection without hardcoding Codex/Claude only.

### 6. Headless Agent Runtime

- [ ] Define the command-template schema for `headless` agents.
- [ ] Support prompt interpolation in `argsTemplate`.
- [ ] Capture stdout/stderr into the same terminal/log pipeline.
- [ ] Define how headless results map to `AgentRunResult`.
- [ ] Add cancellation and timeout behavior.
- [ ] Add tests for successful execution, non-zero exit, env merge, and cancellation.

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
