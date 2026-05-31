# Skills + Slash Commands

Specflow layers a Zed-NativeAgent-style slash command system on top of external
ACP agents. When a node prompt contains a `/command`, Specflow resolves it
against locally-authored skills before the prompt is sent; anything it doesn't
recognize is passed through verbatim so the agent can handle its own
`available_commands`.

Code lives in [packages/server/src/skills/](../../packages/server/src/skills/).

> **MCP JSON note**: the ACP SDK's `McpServer` is a flat discriminated union —
> stdio is the default variant with no wrapper key:
> `{"name":"fs","command":"uvx","args":[...],"env":[]}`. HTTP/SSE use
> `{"type":"http","name":"...","url":"..."}`. Do **not** wrap in `{"stdio":{}}`.

## Skill sources & format

Skills are Markdown files with YAML frontmatter:

```
~/.agents/skills/<name>/SKILL.md      ← global scope
<repo>/.agents/skills/<name>/SKILL.md ← projectLocal scope
```

```markdown
---
name: plan-skeleton
description: Generate a plan skeleton for a complex task
---

You are tasked with planning a complex change. Break it into phases:
1. ...
2. ...
```

- `name` defaults to the directory name when omitted; `description` is optional.
- The body (everything after the frontmatter) is what gets injected.
- **Precedence**: `projectLocal` > `global` for same-name collisions
  ([skill-store.ts](../../packages/server/src/skills/skill-store.ts)
  `pickSkillPrecedence`).
- `SkillStore.list()` returns **both** scopes without deduping (so scope
  qualifiers can target a specific scope); the `/api/skills` endpoint dedupes
  for the UI popup.

## Slash command grammar

Parsed by [slash-parser.ts](../../packages/server/src/skills/slash-parser.ts).
Slash commands are only recognized at the **start of a line** (after optional
leading whitespace) — mid-line `/` is treated as a file path / fraction and
ignored.

| Form | Meaning | v1 behavior |
|---|---|---|
| `/:<name>` | scope-qualified, **global** skill | inject skill body |
| `/<scope>:<name>` | scope-qualified skill (e.g. `projectLocal`) | inject skill body |
| `/<server>.<prompt>` | MCP server prompt | **passthrough** (not implemented) |
| `/<name>` | unqualified | skill if known (precedence applied), else passthrough |

Args = the rest of the line after the command token.

## Three-branch dispatch

[slash-resolver.ts](../../packages/server/src/skills/slash-resolver.ts)
`resolveSlashCommands` mirrors Zed's `NativeAgentConnection::prompt`:

1. **Scope qualifier** → match skill by name + scope, inject body.
2. **MCP prompt** → unresolved in v1 (we don't open MCP connections from the
   proxy). Returns a `mcp-prompt-passthrough` diagnostic.
3. **Unqualified** → skill (highest precedence) if matched; else if it's in the
   agent's `available_commands`, `agent-command-passthrough`; else
   `unknown-passthrough`.

Unresolved commands are left in the prompt text **verbatim** so the external
agent can interpret them.

## Injection: when & how

- **When**: at runtime, in the executor just before the ACP `session/prompt`
  call ([executor.ts](../../packages/bridge/src/execution/executor.ts)
  `#invokeAgent` → `promptTransformer`). The YAML keeps the raw `/skill` so it
  stays readable and portable; the skill body never bloats the stored workflow.
- **How**: the matched skill body is wrapped in XML so the model can tell it
  apart from the user's own words:

  ```
  <skill name="plan-skeleton" source="projectLocal">
  {body}
  <args>{anything typed after the command}</args>
  </skill>
  ```

- **Variable interpolation**: Specflow's existing `<variable>` rendering runs in
  the normal prompt pipeline; the slash transformer runs on the already-rendered
  prompt, so a skill body containing `<specflow_value>` is substituted by the
  same machinery (injection happens, then the surrounding prompt is what the
  template renderer produced).

The transformer is wired in [http.ts](../../packages/server/src/http.ts) via
`createSpecflowBridge({ promptTransformer })`, pulling skills from `SkillStore`
and `availableCommands` from the agent capability cache.

## UI validation (write-time, non-blocking)

In the node prompt editor
([node-panel.tsx](../../packages/ui/src/components/node-panel.tsx)
`SlashCommandWarnings`), each line-leading `/token` is checked against the
loaded skills and the agent's advertised `available_commands`. Unmatched tokens
get a **red warning below the prompt box** — but they are NOT blocked. The user
can still send them (an agent may accept commands beyond what it advertised over
ACP). This intentionally relaxes Zed's hard validation.

## Comparison to Zed NativeAgent

| Aspect | Zed NativeAgent | Specflow |
|---|---|---|
| Skill scope qualifier | ✅ | ✅ |
| MCP prompt `/<server>.<prompt>` | ✅ (NativeAgent owns MCP conns) | ❌ v1 passthrough (proxy doesn't own MCP conns) |
| Unqualified skill precedence | ProjectLocal > Global > BuiltIn | projectLocal > global (no BuiltIn tier) |
| Unknown command | validation blocks send | warning only, send allowed |
| Injection target | NativeAgent's own model call | external ACP agent via `session/prompt` |

## Future (v2)

- MCP prompt branch: would require the server to open its own MCP connection
  (independent of the agent's) to call `prompts/list` + fetch prompt content.
- Skill hot-reload via a filesystem watcher (v1 re-scans on each request).
- BuiltIn skill tier shipped with Specflow.
