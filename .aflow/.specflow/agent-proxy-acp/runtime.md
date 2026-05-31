# ACP Agent Runtime Architecture

This document records the current ACP agent runtime architecture, implemented behavior, known gaps, and the execution plan boundary.

## Goal

Specflow workflows execute work through sessions. Each workflow node or tagged edge handoff selects an agent and a Specflow session. For ACP agents, a selected Specflow session maps to a real ACP CLI process plus a real ACP session id returned by the agent.

The architecture must support:

- Built-in ACP agents installed from the ACP registry, currently `codex-acp` and `claude-acp`.
- Custom ACP agents registered by project/user JSON.
- A headless command-template runtime for non-ACP direct command agents.
- Multiple workflow sessions running in the same workflow run.
- Real-time terminal logging to the UI.
- Recording both Specflow session ids and real ACP CLI session ids.
- Future session restore through ACP `session/load` or `session/resume`.
- Interactive UI handling for ACP permission and elicitation requests.
- ACP agent-owned session history as the authoritative transcript source.

## Package Ownership

| Package | Ownership |
|---------|-----------|
| `packages/workflow` | Pure workflow schema, run schema, logical agent/session references. No process spawning. |
| `packages/bridge` | Runtime graph execution, prompt rendering, gate routing, `AgentInvocation` creation, terminal event capture. |
| `packages/agent-proxy` | Agent server resolution, ACP registry/custom source handling, ACP subprocess lifecycle, ACP client handlers. |
| `packages/server` | HTTP API, SSE run events, run persistence, ACP session index persistence. |
| `packages/ui` | Canvas editing, workflow run trigger, live log display. Permission and restore UI are not complete yet. |

## Runtime Flow

1. UI calls `POST /api/canvases/:id/run`.
2. Server loads the agentflow and canvas layout, validates required run inputs, converts the canvas to a workflow, creates the persisted run id, and saves `.aflow/.specflow/runs/<runId>.yaml`.
3. Server calls `WorkflowExecutor.run(workflow, initialInput, { runId })`.
4. Bridge walks the workflow graph.
5. For each agent node, bridge renders the node prompt and creates an `AgentInvocation`.
6. For each tagged edge with a handoff, bridge renders the handoff prompt and creates an `AgentInvocation` with `edgeId`.
7. Bridge calls `AgentProxySessionPool.run`.
8. The pool resolves the configured agent server from `.aflow/.specflow/agent-servers.json`, `.aflow/.specflow/agent-servers.local.json`, or built-in defaults.
9. For ACP servers, agent-proxy starts an ACP CLI subprocess over stdio through the official `@agentclientprotocol/sdk`.
10. Agent-proxy sends ACP `initialize`, creates or reuses an ACP session, applies configured defaults, and sends `session/prompt`.
11. Agent output, terminal output, session updates, permission requests, and elicitation requests flow through ACP client handlers.
12. Bridge records terminal chunks in `TerminalEventStore`.
13. Server streams live events to `/api/runs/:id/events`.
14. After the run resolves, server writes the final `agentInvocations` back to the run record and updates `.aflow/.specflow/agent-sessions.json`.

## Agent Server Sources

Agent server configuration is represented by `AgentServerSettings`:

- `registry`: ACP registry agent. The command is resolved from the registry metadata and downloaded/cached lazily.
- `custom`: user-provided ACP command and args.
- `headless`: direct command-template execution. `argsTemplate` supports `{prompt}` and `{{prompt}}` interpolation.

Configuration load order:

1. Built-in defaults from `AgentServerStore`.
2. Project config `.aflow/.specflow/agent-servers.json`.
3. Local/user override `.aflow/.specflow/agent-servers.local.json`.

Later entries override earlier entries by agent server id.

Current built-ins:

- `codex-acp`, registry id `codex-acp`, default mode `auto`.
- `claude-acp`, registry id `claude-acp`.

## ACP Client Behavior

ACP transport uses:

- `acp.ndJsonStream(...)`
- `acp.ClientSideConnection`
- subprocess stdio pipes

The client advertises:

- File read/write.
- Terminal create/output/wait/kill/release.
- Terminal auth.
- Form and URL elicitation.
- UTF position encodings.

Implemented client handlers:

- `session/request_permission`
- `session/update`
- `fs/read_text_file`
- `fs/write_text_file`
- `terminal/create`
- `terminal/output`
- `terminal/wait_for_exit`
- `terminal/kill`
- `terminal/release`
- `elicitation/create`
- `elicitation/complete`
- extension method and notification hooks

Default behavior without UI hooks:

- Permission requests return cancelled.
- Elicitation requests return cancel.
- Filesystem requests are allowed only inside the workflow `cwd` and configured `additionalDirectories`.
- `additionalDirectories` can be set on an agent server entry in `.aflow/.specflow/agent-servers.json` or `.aflow/.specflow/agent-servers.local.json`; relative paths resolve from the workflow `cwd`, and `~` is expanded.
- ACP terminal creation is enabled by default but constrained to the same allowed roots for terminal `cwd`.
- ACP terminal auth is not advertised by default. It is advertised only when the agent server config sets `terminal.auth: true`.
- Agent server configs can disable terminal creation with `terminal.enabled: false`.

## Session Model

There are two distinct session ids:

- `AgentInvocation.sessionId`: Specflow workflow session id, such as `s1`.
- `AgentInvocation.acpSessionId`: real ACP CLI session id returned by `session/new`.

Within a single workflow run, `AgentProxySessionPool` keys reusable ACP processes by:

```text
cwd + agentServerId + workflowSessionId
```

Implications:

- Multiple nodes using the same Specflow session reuse one ACP process and one ACP session.
- Tagged edge handoffs using the same Specflow session reuse that session too.
- Different Specflow sessions spawn separate ACP processes, even for the same agent server.
- Invocations without a workflow session run as one-shot ACP sessions.
- The pool closes all ACP sessions when the workflow run ends.

## Persistence

Run persistence and session-index persistence have different responsibilities.

Specflow is not the authoritative store for ACP conversation history. The ACP agent CLI owns its own session transcript and restore semantics. Specflow persists enough metadata to find that external session again, plus workflow-level audit/log data needed to explain what happened in a workflow run.

### Run Records

`.aflow/.specflow/runs/<runId>.yaml` is the immutable execution/audit record. It stores:

- run status, timing, node states, node outputs
- agentflow and canvas snapshots
- initial input and variable values
- `agentInvocations`

Each `AgentInvocation` records:

- Specflow run id
- node run id
- node id or edge id
- logical agent id
- agent server id
- Specflow session id
- ACP session id
- ACP load/resume capability flags
- prompt, output, status, timing, error

### ACP Session Index

`.aflow/.specflow/agent-sessions.json` is the cross-run browse/resume index. It is keyed by:

```text
workflowId + specflowSessionId + agentServerId + acpSessionId
```

It stores:

- `workflowId`
- `specflowSessionId`
- `agentId`
- `agentServerId`
- `acpSessionId`
- `acpSupportsLoadSession`
- `acpSupportsResumeSession`
- first/last seen timestamps
- latest run and invocation references
- all run ids and invocation ids known for the session
- per-invocation references including node id or edge id
- restore attempts with requested mode, selected primitive, status, timing, and error

Server APIs:

- `GET /api/agent-sessions`
- `GET /api/agent-sessions?workflowId=<workflow-id>`
- `GET /api/agent-sessions?agentServerId=<agent-server-id>`
- `GET /api/agent-sessions/:id`
- `POST /api/agent-sessions/:id/restore`
- `GET /api/agent-session-restores/:restoreId/events`

Deleting a run removes that run's invocation references from the session index. Empty session entries are removed.

### Runtime Logs

Durable runtime logs are workflow-side event logs, not a duplicate ACP transcript database.

Recommended path:

```text
.aflow/.specflow/run-logs/<runId>.jsonl
```

These logs persist:

- terminal chunks emitted during the run: `stdout`, `stderr`, and `system`
- workflow-side lifecycle events: node status and run status
- ACP lifecycle events: process started, initialized, session created, prompt started/stopped/failed/cancelled, and session closed where applicable
- permission and elicitation audit records: requested, resolved, cancelled, timed out
- restore attempts: requested mode, selected ACP primitive, success/failure

These logs do not persist as primary data:

- full ACP conversation transcript
- full ACP `session/update` history solely to reconstruct agent memory
- environment variable values
- terminal auth secrets
- MCP server secrets
- accepted elicitation form values
- large file contents read or written by tools

If a `session/load` call later replays ACP `session/update` notifications, those notifications can be streamed to the UI for the active restore view. They should not become Specflow's canonical copy of the agent transcript unless a future product decision explicitly makes Specflow a transcript archival system.

## Current UI Integration

Implemented:

- UI can start a workflow run.
- Server streams run/node/terminal events over SSE.
- Server persists terminal logs, workflow-side status logs, ACP lifecycle events, interaction audit events, and restore attempt audit events under `.aflow/.specflow/run-logs/<runId>.jsonl`.
- `GET /api/runs/:id/logs` returns historical run log events.
- New SSE connections replay persisted terminal chunks before live events.
- UI can show live terminal logs in the log panel.
- UI loads historical terminal logs when viewing a completed run.
- UI exposes ACP session history in the bottom History tab, filtered by workflow, Specflow session, and agent server.
- UI links session index entries back to run node logs and can start Inspect or Resume restore attempts.
- UI exposes an Agent Servers manager for registry install/update/remove and custom ACP command registration.
- Registry installs record the registry version in local settings. When the current registry version differs, the manager shows an Update action and the top-bar Agents button shows a red update dot. The actual ACP binary/package resolution remains lazy: the next run resolves the current registry metadata and downloads the matching artifact into the versioned cache if needed.
- New workflow sessions choose from configured agent servers instead of hardcoded Codex/Claude options.
- ACP permission and elicitation requests can be surfaced to UI and answered through `POST /api/runs/:runId/interactions/:interactionId/respond`.
- Run records include final ACP invocation metadata after run completion.
- Server exposes the ACP session index API.
- Agent-proxy can start an ACP CLI for an existing ACP session id and call `session/load` or `session/resume` based on advertised capabilities.
- Restore mode selection is capability-driven: `inspect` prefers `load`, `continue` prefers `resume`, and each mode falls back to the other primitive when only one is available.
- Server can start a restore attempt for an indexed ACP session and stream restored `session/update` notifications and terminal output over a restore SSE channel.
- Server records restore attempts and results in both `.aflow/.specflow/run-logs/<runId>.jsonl` and `.aflow/.specflow/agent-sessions.json`.
- UI can cancel an active run from the run view.
- Server exposes `POST /api/runs/:id/cancel`.
- Cancellation aborts the run's `AbortSignal`, releases pending permission/elicitation interactions as cancelled, propagates to agent-proxy, and persists the final run status as `cancelled`.
- ACP runtime cancellation calls ACP `session/cancel` when a real ACP session exists; headless runtime cancellation kills the child process.

## Resume Design Direction

Restore must be capability-driven:

- Use ACP `session/load` only when `InitializeResponse.agentCapabilities.loadSession` is true.
- Use ACP `session/resume` only when `InitializeResponse.agentCapabilities.sessionCapabilities.resume` is present.

Historical inspection should prefer `session/load` because it can replay prior messages through `session/update`.

Continuing work should prefer `session/resume` when the user wants to reactivate the external session.

The agent-proxy restore selector implements those preferences and falls back to the other primitive when only one is advertised. If neither primitive is advertised, restore fails before calling an ACP session restore method.

The server route is `POST /api/agent-sessions/:id/restore` with `{ "mode": "inspect" | "continue" }`. The response includes a `restoreId`; the active restore stream is `GET /api/agent-session-restores/:restoreId/events`.

If an agent supports only resume and cannot replay history, Specflow can still show its own workflow-side run logs, but it should not pretend those logs are the agent's full conversation transcript.

## Required Invariants

- Server-created run id must be passed into bridge. Bridge must not create a different id for server-backed runs.
- `AgentInvocation.runId` must match `.aflow/.specflow/runs/<runId>.yaml`.
- Terminal events must use the persisted run id so SSE and log filtering work.
- `AgentInvocation.agentServerId` and `AgentInvocation.acpSessionId` must be recorded whenever an ACP prompt starts successfully.
- The ACP session index must be derived from run records, not replace them.
- ACP session transcript authority stays with the ACP agent. Specflow stores lookup metadata, workflow audit records, and runtime shell logs.
- Permission and elicitation decisions must be explicit user or policy decisions. Agent-proxy defaults to cancellation until UI/bridge callbacks are wired.
- Run cancellation must release any pending interaction before aborting the underlying agent process, otherwise an agent blocked on `request_permission` or `elicitation/create` can keep the workflow pending.

## Verification Coverage

Current test coverage includes:

- ACP subprocess connection through the official SDK.
- ACP client handlers for permission/elicitation defaults, filesystem workspace guard, and extension hooks.
- ACP session pool reuse by Specflow workflow session.
- Bridge propagation of workflow session ids to agent-proxy.
- Bridge recording of ACP session metadata on invocations.
- Bridge propagation of ACP lifecycle events with workflow context.
- Bridge interaction store resolve/cancel behavior.
- Server interaction SSE and response endpoint.
- Server run log JSONL append/list/delete behavior, including ACP lifecycle entries.
- Server run-store migration/defaulting for `agentInvocations`.
- Server ACP session index create/merge/delete behavior.
- Agent-proxy restore selection against fake ACP agents advertising load-only, resume-only, both, and neither capability sets.
- Server restore API streaming and audit persistence against the fake ACP restore fixture.
- Agent-proxy rejects configured default modes/models/options that are not advertised by the initialized ACP session.
- Headless runtime execution for success, non-zero exit, env merge, and cancellation.
- Bridge run cancellation during active prompts, permission waits, and elicitation waits.
- Server run cancellation API persistence using a headless child process.
- Server API terminal SSE replay uses the same run id as the persisted run log.
- Server restore API covers both inspect/load and continue/resume against fake ACP agents advertising both capabilities.
- UI integration coverage for run start and live log panel updates.

- End-to-end UI test for run start and live log display.
