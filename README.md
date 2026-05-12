# Specflow

Specflow is being rebuilt around a Bun-powered runtime with a browser UI first. The current foundation starts the UI through a dedicated server package, while the server calls into a separate bridge layer that can also be used by future headless entrypoints.

## Requirements

Specflow uses [mise](https://mise.jdx.dev/) to pin Bun.

Install mise:

```sh
curl https://mise.run | sh
```

Enable mise in your shell. For bash:

```sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

For zsh:

```sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

Then enter this repository and trust the local mise config:

```sh
cd specflow-code
mise trust
bun --version
```

The expected Bun version is:

```text
1.3.13
```

## Development

Install dependencies:

```sh
bun install
```

Start Specflow in development mode:

```sh
bun run dev
```

The command starts the Specflow server and prints the browser URL:

```text
Specflow UI: http://localhost:5173/
```

The server proxies UI requests to Vite so React updates stay fast. In production the server serves the embedded static UI from the compiled binary.

## Workspace Files

Specflow stores workflow-as-code files in `.specflow/agentflows/*.yaml`. The browser canvas layout is generated into `.specflow/canvas/*.json` and is ignored by default, so users can author or review agentflows without also hand-writing UI coordinates.

## Scripts

```sh
bun run dev        # start server + Vite dev proxy
bun run build      # build:ui then build:bin → ./specflow binary
bun run typecheck  # type-check all packages
```

## Package Layout

```text
packages/
  agent-proxy/  Adapter boundary for agent CLIs such as Codex or Claude Code.
  bridge/       Orchestration layer shared by server and future headless modes.
  cli/          The specflow command entrypoint.
  server/       HTTP entrypoint that serves UI and calls bridge.
  shared/       Shared constants and types.
  ui/           Browser UI, Vite config, index.html, and favicon assets.
  workflow/     Workflow business logic, including graph node and edge models.
```
