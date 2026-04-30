# Workflow Definition Reference

Workflow definitions live in `.specflow/workflows/*.workflow.json`.

The current JSON Schema is `.specflow/workflows/workflow-definition.schema.json`.
It documents the portable shape other repositories can reuse when adding a
Specflow workflow definition.

## Runtime Boundary

Schema validation and runtime validation are separate:

- JSON Schema describes the file shape for editors and repository authors.
- `packages/runtime` validates graph semantics such as duplicate node ids,
  missing edge endpoints, session controllers, managed nodes, and control scope
  consistency.
- The current placeholder executor also checks runtime compatibility for the
  Phase 1 local loop node shape.
- `specflow workflow validate` prints both semantic validity and current
  placeholder runtime compatibility for repository workflow definitions.

## Key Fields

- `sessionGroups` declares reusable session group labels and optional
  controllers.
- `nodes[].agentCli` declares the preferred CLI for agent-mode nodes.
- `nodes[].session` declares whether a node uses no session, a shared session,
  a fresh session, or an AI/controller-decided session.
- `nodes[].control` declares which nodes a director, reviewer, manager, or
  verifier can manage.
- `edges[].type = "control_scope"` makes that management relationship visible in
  the graph.

Mock-only run options such as `reviewerMode` and `maxRepairAttempts` are not part
of workflow definitions.
