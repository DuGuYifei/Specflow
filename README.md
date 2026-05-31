<p align="center">
  <img src="assets/banner.png" alt="Specflow" />
</p>

<h1 align="center">Aflow Agent</h1>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="packages/ui/public/favicon.svg" alt="Aflow" width="72" height="72" />
</p>

<p align="center">
  <strong>Specflow</strong> turns agent work into visible workflows. <strong>Aflow Agent</strong>, an agentic workflow agent, is built on top of it.
</p>

## What It Is

**Specflow** is a workflow foundation for agentic work. It lets you describe a process as editable workflow-as-code, connect one or more agents to that process, run the workflow, inspect decisions and outputs, and continue work across sessions with traceable context.

**Aflow Agent** is an agentic workflow agent built with Specflow to help you design and operate those workflows. It can assist while you assemble a workflow, or use a workflow to complete a complex task through planned steps, review gates, and follow-up paths instead of relying on one long, unstructured chat.

Specflow is not limited to coding. It can connect to arbitrary custom agents for business operations, research, review, automation, or domain-specific processes. In development scenarios, it can also generate and maintain spec documents that support SDD, Spec-Driven Development, so implementation work starts from explicit intent, constraints, and expected outcomes.

## What It Helps With

- Build workflow-as-code for repeatable agent work.
- Break complex tasks into visible nodes, decisions, reviews, and follow-up paths.
- Connect custom agents and compose them into the same workflow.
- Coordinate multiple agents with different strengths in one workflow.
- Continue work across sessions so context, decisions, and run history remain traceable.
- Generate spec documents for development workflows when SDD-style clarity is useful.
- Use agents for business workflows, research workflows, coding workflows, or any task that benefits from explicit process and review.

## Workspace Files

Workflow-as-code files live in `.aflow/.specflow/agentflows/*.yaml`.

Browser canvas layout is generated into `.aflow/.specflow/canvas/*.json` and is ignored by default, so workflows can be authored and reviewed without hand-writing UI coordinates.

Agent servers are configured under `.aflow/.specflow/agent-servers.json`. Local secrets and machine-specific overrides should go in `.aflow/.specflow/agent-servers.local.json`, which deep-merges with the shared file by agent id.

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

Example custom ACP agent:

```json
{
  "agent_servers": {
    "my-acp-agent": {
      "type": "custom",
      "command": "node",
      "args": ["./agents/my-agent.js", "--acp"],
      "cwd": ".",
      "env": {
        "MY_AGENT_API_KEY": "..."
      },
      "additionalDirectories": ["../shared-workspace"]
    }
  }
}
```

Specflow-specific agent server keys:

- `env`: environment variables passed to the agent process. ACP `env_var` auth methods read their required variables from here.

Agent server entries keep process launch settings such as `type`, `command`, `args`, `cwd`, `env`, and `additionalDirectories`. Custom ACP agents must speak ACP over stdio. Authentication, terminal capability handling, and permission prompts are driven by ACP at run time. Mode, model, reasoning, and config overrides belong at the workflow or node level rather than in agent server config.

## Development

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
cd Aflow
mise trust
bun --version
```

Install dependencies:

```sh
bun install
```

Run the development server:

```sh
bun run dev
```

The command starts the Specflow server and prints the browser URL:

```text
Specflow UI: http://localhost:5173/
```

In development, the server proxies UI requests to Vite so React updates stay fast. In production, the server serves the embedded static UI from the compiled binary.

## Scripts

```sh
bun run dev        # start server + Vite dev proxy
bun run build      # build:ui then build:bin, producing ./specflow
bun run typecheck  # type-check all packages
```

## Acknowledgements

Specflow references and learns from the following projects and communities:

- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) by [@agentclientprotocol](https://github.com/agentclientprotocol)
- [Zed](https://github.com/zed-industries/zed) by [@zed-industries](https://github.com/zed-industries)
- [Pi](https://github.com/earendil-works/pi) by [@earendil-works](https://github.com/earendil-works)

These links are listed as reference materials for protocol, editor, and agent harness design.
