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

Start Specflow:

```sh
bun run specflow
```

The command starts the Specflow server and prints the browser URL:

```text
Specflow UI: http://localhost:5173/
```

During development, the server proxies the UI from Vite so React updates stay fast. Production builds are served as static UI assets by the server package.

## Scripts

```sh
bun run dev
bun run specflow
bun run build
bun run typecheck
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
