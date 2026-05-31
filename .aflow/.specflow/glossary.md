# Glossary

**Ticket** — the starting input for a workflow run. Can be a user-typed description, a GitHub issue, a bug report, a refactor task, or a UI implementation task.

**Spec** — repository-level knowledge that persists across workflow runs. Stored in `.aflow/.specflow/`. Tells the system and AI what rules and facts apply to this codebase, so AI is not reasoning only from the current ticket.

**Workflow** — the structured process that transforms a ticket into an implementation result. Represented as a directed graph of nodes and edges. Not a linear pipeline.

**Node** — a single observable step in a workflow. Has a `type` (string discriminator), a position on the canvas, and a `data` payload. Examples: `ticket-input`, `spec-context`, `plan`, `code-draft`, `implementation-reviewer`, `repair`, `final-patch`.

**Edge** — a directed connection between two nodes. Has a `type` that determines its semantics:
- `control_flow` — execution order
- `data_flow` — data, context, or artifact passing
- `review_loop` — repair cycle triggered by a failed review
- `control_scope` — scope of a director/manager/verifier over other nodes

**Session** — a shared agent CLI context across a set of nodes. Nodes in the same session preserve conversational context (plan → implementation → repair). A node can declare that a new repair-loop entry opens a fresh session to avoid context pollution.

**Session Director** — the first node in the base workflow. Records which nodes share a session and which open a new one. Currently a deterministic mock; future: AI-driven.

**Bridge** — the stateful runtime layer that coordinates workflow execution and agent calls. Consumed by `server` today; will also be consumed by a future headless mode.

**Agent Proxy** — the `agent-proxy` package. Wraps external AI agent CLIs (Codex, Claude Code) as subprocess calls so workflow nodes can invoke them without coupling the core engine to any specific provider.

**Final Patch** — the output artifact of a completed workflow run: a reviewed and repaired code change ready to enter CI.

**CC (Continuous Coding)** — the pre-CI layer Specflow operates in. Analogous to CI but focused on the coding phase: understand → plan → generate → review → repair → patch.
