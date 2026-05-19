# ACP Agent Runtime Architecture

This document records the current ACP agent runtime architecture, implemented behavior, known gaps, and the execution plan boundary.

## Goal

Specflow workflows execute work through sessions. Each workflow node or tagged edge handoff selects an agent and a Specflow session. For ACP agents, a selected Specflow session maps to a real ACP CLI process plus a real ACP session id returned by the agent.

The architecture must support:

- Built-in ACP agents installed from the ACP registry, currently `codex-acp` and `claude-acp`.
- Custom ACP agents registered by project/user JSON.
- A reserved future headless command-template runtime.
- Multiple workflow sessions running in the same workflow run.
- Real-time terminal logging to the UI.
- Recording both Specflow session ids and real ACP CLI session ids.
- Future session restore through ACP `session/load` or `session/resume`.
- Future interactive UI handling for ACP permission and elicitation requests.
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
2. Server loads the agentflow and canvas layout, validates required run inputs, converts the canvas to a workflow, creates the persisted run id, and saves `.specflow/runs/<runId>.yaml`.
3. Server calls `WorkflowExecutor.run(workflow, initialInput, { runId })`.
4. Bridge walks the workflow graph.
5. For each agent node, bridge renders the node prompt and creates an `AgentInvocation`.
6. For each tagged edge with a handoff, bridge renders the handoff prompt and creates an `AgentInvocation` with `edgeId`.
7. Bridge calls `AgentProxySessionPool.run`.
8. The pool resolves the configured agent server from `.specflow/agent-servers.json`, `.specflow/agent-servers.local.json`, or built-in defaults.
9. For ACP servers, agent-proxy starts an ACP CLI subprocess over stdio through the official `@agentclientprotocol/sdk`.
10. Agent-proxy sends ACP `initialize`, creates or reuses an ACP session, applies configured defaults, and sends `session/prompt`.
11. Agent output, terminal output, session updates, permission requests, and elicitation requests flow through ACP client handlers.
12. Bridge records terminal chunks in `TerminalEventStore`.
13. Server streams live events to `/api/runs/:id/events`.
14. After the run resolves, server writes the final `agentInvocations` back to the run record and updates `.specflow/agent-sessions.json`.

## Agent Server Sources

Agent server configuration is represented by `AgentServerSettings`:

- `registry`: ACP registry agent. The command is resolved from the registry metadata and downloaded/cached lazily.
- `custom`: user-provided ACP command and args.
- `headless`: reserved for future command-template execution. The type exists in schema, but runtime execution intentionally throws.

Configuration load order:

1. Built-in defaults from `AgentServerStore`.
2. Project config `.specflow/agent-servers.json`.
3. Local/user override `.specflow/agent-servers.local.json`.

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
- Terminal and filesystem requests are handled inside the configured workspace roots.

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

`.specflow/runs/<runId>.yaml` is the immutable execution/audit record. It stores:

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

`.specflow/agent-sessions.json` is the cross-run browse/resume index. It is keyed by:

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

Server APIs:

- `GET /api/agent-sessions`
- `GET /api/agent-sessions?workflowId=<workflow-id>`
- `GET /api/agent-sessions?agentServerId=<agent-server-id>`
- `GET /api/agent-sessions/:id`

Deleting a run removes that run's invocation references from the session index. Empty session entries are removed.

### Runtime Logs

Future durable runtime logs should be workflow-side event logs, not a duplicate ACP transcript database.

Recommended path:

```text
.specflow/run-logs/<runId>.jsonl
```

These logs should persist:

- terminal chunks emitted during the run: `stdout`, `stderr`, and `system`
- lifecycle events: process started, initialized, session created, prompt started/stopped/failed/cancelled
- permission and elicitation audit records: requested, resolved, cancelled, timed out
- restore attempts: requested mode, selected ACP primitive, success/failure

These logs should not persist as primary data:

- full ACP conversation transcript
- full ACP `session/update` history solely to reconstruct agent memory
- environment variable values
- terminal auth secrets
- MCP server secrets
- large file contents read or written by tools

If a `session/load` call later replays ACP `session/update` notifications, those notifications can be streamed to the UI for the active restore view. They should not become Specflow's canonical copy of the agent transcript unless a future product decision explicitly makes Specflow a transcript archival system.

## Current UI Integration

Implemented:

- UI can start a workflow run.
- Server streams run/node/terminal events over SSE.
- UI can show live terminal logs in the log panel.
- Run records include final ACP invocation metadata after run completion.
- Server exposes the ACP session index API.

Not complete:

- Permission and elicitation requests are not surfaced to UI.
- There is no interaction response API.
- Historical workflow-side runtime logs are not durably persisted.
- There is no UI to browse `.specflow/agent-sessions.json`.
- There is no restore API that starts an ACP CLI and calls `session/load` or `session/resume`.
- Headless command-template agents are reserved but not implemented.

## Resume Design Direction

Restore must be capability-driven:

- Use ACP `session/load` only when `InitializeResponse.agentCapabilities.loadSession` is true.
- Use ACP `session/resume` only when `InitializeResponse.agentCapabilities.sessionCapabilities.resume` is present.

Historical inspection should prefer `session/load` because it can replay prior messages through `session/update`.

Continuing work should prefer `session/resume` when the user wants to reactivate the external session.

If an agent supports only resume and cannot replay history, Specflow can still show its own workflow-side run logs, but it should not pretend those logs are the agent's full conversation transcript.

## Required Invariants

- Server-created run id must be passed into bridge. Bridge must not create a different id for server-backed runs.
- `AgentInvocation.runId` must match `.specflow/runs/<runId>.yaml`.
- Terminal events must use the persisted run id so SSE and log filtering work.
- `AgentInvocation.agentServerId` and `AgentInvocation.acpSessionId` must be recorded whenever an ACP prompt starts successfully.
- The ACP session index must be derived from run records, not replace them.
- ACP session transcript authority stays with the ACP agent. Specflow stores lookup metadata, workflow audit records, and runtime shell logs.
- Permission and elicitation decisions must be explicit user or policy decisions. Agent-proxy defaults to cancellation until UI/bridge callbacks are wired.

## Verification Coverage

Current test coverage includes:

- ACP subprocess connection through the official SDK.
- ACP client handlers for permission/elicitation defaults, filesystem workspace guard, and extension hooks.
- ACP session pool reuse by Specflow workflow session.
- Bridge propagation of workflow session ids to agent-proxy.
- Bridge recording of ACP session metadata on invocations.
- Server run-store migration/defaulting for `agentInvocations`.
- Server ACP session index create/merge/delete behavior.

Coverage still needed:

- Server API integration test proving terminal SSE uses the same run id as the persisted run record.
- End-to-end UI test for run start and live log display.
- Interaction request/response tests once permission and elicitation UI are implemented.
- Restore API tests against fake ACP agents that advertise load and resume.
