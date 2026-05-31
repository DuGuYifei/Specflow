# ACP Compatibility

This page documents how Specflow interoperates with ACP agents.

## Agent Sources

Specflow supports registry and custom ACP agents.

- Registry agents are open by default. Specflow will show, save, install, and try to run any agent returned by the ACP registry.
- A registry agent still needs a supported distribution: `binary`, `npx`, or `uvx`.
- Custom ACP agents can be configured with `type`, `command`, `args`, `cwd`, `env`, and `additionalDirectories`.
- Custom agents must speak ACP over stdio.

Registry openness does not mean every agent is guaranteed to run. Specflow reports distribution, auth, protocol, and runtime errors from the agent path.

## Authentication

Specflow uses ACP-native auth methods whenever the agent advertises them.

- `env_var` methods read required variables from `.specflow/agent-servers.json` or `.specflow/agent-servers.local.json`.
- Terminal auth methods run in a browser-visible auth terminal backed by the local Bun server.
- Zed-compatible `_meta["terminal-auth"]` methods are treated as terminal auth.

Gemini is the only temporary auth shim. When the registry id is `gemini` and the agent does not advertise official ACP auth methods, Specflow injects a synthetic terminal auth method that runs the Gemini CLI login flow. This should be removed once Gemini exposes complete official ACP auth methods.

## Session Fork

Specflow partially supports ACP session fork as described in:

https://agentclientprotocol.com/rfds/session-fork

When an agent advertises ACP `session/fork`, Specflow can use the forked ACP session for branched work. When an agent does not support fork, gate and review flows continue in the current session instead of failing.

Any older fallback code that only exists to work around missing fork support can be deleted once the agents we depend on consistently support ACP session fork.

## Elicitation

ACP elicitation is described in:

https://agentclientprotocol.com/rfds/elicitation

Specflow has low-level ACP elicitation handlers, but it does not yet provide a product-level interview interaction experience. Workflows that need human input should use Specflow's ask-human / human interaction tool rather than relying on ACP elicitation interview UX.

## Slash Commands

Slash commands are supported.

- Agent `available_commands_update` messages are stored in the agent capability cache.
- The UI shows slash command candidates from both Specflow skills and the selected agent's advertised commands.
- Specflow skill commands are expanded before sending the prompt.
- Agent commands pass through to the agent unchanged.
- Unknown slash commands also pass through, with a UI warning.
