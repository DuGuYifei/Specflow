# Bridge to Agent Proxy Chain

This document records how workflow execution reaches ACP agent CLIs.

## Runtime Ownership

- `packages/bridge` owns workflow execution order.
- `packages/agent-proxy` owns agent server resolution, ACP process startup, ACP session lifecycle, and client-side ACP handlers.
- `packages/workflow` stores logical agent/session references only; it does not spawn processes.

## Call Path

1. The server creates the persisted run id and calls `WorkflowExecutor.run(workflow, initialInput, { runId })`.
2. At the start of the run, bridge creates one `AgentProxySessionPool` unless a custom `agentRunner` was injected for tests or alternate runtimes.
3. For each agent node, bridge renders the node prompt and creates an `AgentInvocation`.
4. For each tagged edge with a handoff, bridge renders the edge handoff prompt and creates another `AgentInvocation`.
5. Bridge calls the active `AgentRunner` with:
   - `agentServerId`: resolved from the workflow agent definition.
   - `workflowSessionId`: the workflow session selected by the node or edge handoff.
   - `runId`: the current workflow run id.
   - `cwd`: the project root.
   - `prompt`: the rendered node or edge prompt.
   - `onTerminalEvent`: callback that stores terminal output with run/node/invocation metadata.
6. The default runner is `AgentProxySessionPool.run(request)`.
7. The pool resolves the configured agent server through `AgentServerStore`.
8. For ACP agent servers, the pool starts or reuses an ACP session backed by `AcpAgentSession`.
9. `AcpAgentSession` uses `AcpAgentClient`, which uses the official `@agentclientprotocol/sdk`:
   - `acp.ndJsonStream(...)`
   - `acp.ClientSideConnection`
10. The ACP CLI is spawned as a subprocess, connected over stdio, initialized, and sent prompts through `session/prompt`.

## Session Semantics

Specflow workflow sessions are the long-lived unit inside one workflow run.

The default bridge-to-agent-proxy path keys ACP runtimes by:

```text
cwd + agentServerId + workflowSessionId
```

That means:

- Multiple nodes using the same workflow session reuse the same ACP CLI process and ACP session.
- A tagged edge handoff using the same workflow session also reuses that same ACP session.
- Different workflow sessions spawn separate ACP CLI processes, even if they use the same `agentServerId`.
- Invocations without `workflowSessionId` fall back to a one-shot ACP run.
- At workflow completion or failure, bridge closes the session pool, which closes ACP sessions and kills subprocesses.

## Persisted Session Metadata

There are two different session identifiers and both matter:

- `sessionId` on `AgentInvocation` is the Specflow workflow session id, for example `s1`.
- `acpSessionId` on `AgentInvocation` is the real session id returned by the ACP agent CLI from `session/new`.

Bridge records the ACP metadata returned by agent-proxy on every `AgentInvocation`:

```yaml
agentInvocations:
  - id: ...
    agentId: agent-server-codex-acp
    agentServerId: codex-acp
    sessionId: s1
    acpSessionId: <codex-or-claude-session-id>
    acpSupportsLoadSession: true
    acpSupportsResumeSession: true
```

The server persists `agentInvocations` in each run record under `.specflow/runs/*.yaml`.

Run records are the right place for auditability: they answer which external ACP session was used for a specific node or edge handoff during a specific run. They should not be the only storage for long-term resume UX.

The server also maintains a separate session index at `.specflow/agent-sessions.json`, keyed by:

```text
workflowId + specflowSessionId + agentServerId + acpSessionId
```

That index points back to run ids and invocation ids, and tracks whether the agent advertised `session/load` and/or `session/resume`.

This split avoids overloading run history:

- Run record: immutable execution fact and audit trail.
- Session index: browse/search/resume entrypoint across runs.

ACP conversation history itself belongs to the ACP agent CLI. Specflow should not duplicate the ACP transcript as its canonical state. It stores the external session id and enough audit/log metadata to explain workflow execution, then asks the ACP agent to load or resume the session when historical inspection or continuation is needed.

The index is updated after a workflow run completes and its `agentInvocations` have been written back to the run record. Deleting a run removes that run's invocation references from the index; empty session entries are removed.

The server exposes the index through:

- `GET /api/agent-sessions`
- `GET /api/agent-sessions?workflowId=<workflow-id>`
- `GET /api/agent-sessions?agentServerId=<agent-server-id>`
- `GET /api/agent-sessions/:id`

## ACP Client Capabilities

The client side currently advertises:

- File read/write.
- Terminal creation/output/wait/kill/release.
- Terminal auth.
- Form and URL elicitation.
- Position encodings.

The implemented client handlers support:

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
- extension requests and notifications

Permission and elicitation requests default to cancelled when no UI hook is installed. Future UI work should attach callbacks to surface these decisions to the user.

## Error Behavior

- If an ACP prompt returns a non-zero `AgentRunResult.exitCode`, bridge marks the `AgentInvocation` failed, marks the node failed, and fails the workflow run.
- Terminal events emitted before failure are preserved in `TerminalEventStore`.
- A failed pooled ACP session is closed and removed from the pool so later calls do not reuse a compromised process.

## Resume Direction

ACP clients must check advertised capabilities before resuming:

- Use `session/load` only when `InitializeResponse.agentCapabilities.loadSession` is true.
- Use `session/resume` only when `InitializeResponse.agentCapabilities.sessionCapabilities.resume` is present.

For historical inspection, `session/load` is preferable because it asks the agent to replay its own prior messages via `session/update`.

For continuing work without replaying history, `session/resume` is the stable primitive. If an agent supports only resume, Specflow can still show workflow-side runtime logs from its own run log store, but those logs are not a full ACP transcript.

The future UI flow should be:

1. User opens a historical run.
2. User selects a node log or edge handoff.
3. UI reads that invocation's `agentServerId`, `sessionId`, and `acpSessionId`.
4. UI asks server to restore the external session.
5. Server starts the corresponding ACP CLI and calls `session/load` or `session/resume` depending on advertised capability.
6. Replayed or resumed updates stream back to the UI over SSE for the active restore view.
