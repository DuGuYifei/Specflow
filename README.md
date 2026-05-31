# Specflow

English | [简体中文](README.zh-CN.md)

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
1.3.14
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

Agent servers are configured under `.specflow/agent-servers.json`. Local secrets and machine-specific overrides should go in `.specflow/agent-servers.local.json`, which deep-merges with the shared file by agent id. Local files can provide only the fields they need, especially `env`.

Example local secret override:

```json
{
  "agent_servers": {
    "codex-acp": {
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "http_proxy": "http://127.0.0.1:7890",
        "https_proxy": "http://127.0.0.1:7890"
      }
    }
  }
}
```

Specflow-specific agent server keys:

- `env`: environment variables passed to the agent process. ACP `env_var` auth methods read their required variables from here.

Agent server entries keep process launch settings such as `command`, `args`, `cwd`, and `env`. Authentication, terminal capability handling, and permission prompts are driven by ACP at run time. Mode, model, reasoning, and config overrides belong at the workflow or node level rather than in agent server config.

## Scripts

```sh
bun run dev        # start server + Vite dev proxy
bun run build      # build:ui then build:bin → ./specflow binary
bun run typecheck  # type-check all packages
```
