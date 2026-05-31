# ACP CLI Available Commands 实测清单

> 范围：本文记录 ACP agent 通过 `session/update` 的
> `available_commands_update` 返回的 slash command 快照，供 Specflow 的 command
> discovery、命令输入 UI 和更多 CLI 兼容性验证参考。
>
> 探测日期：2026-05-24。
> Specflow slash command 支持状态更新：2026-05-31。
>
> 探测方式：使用当前项目的 `AcpAgentClient` 执行 ACP `initialize` 与
> `session/new`，记录新会话发出的 `AvailableCommandsUpdate.availableCommands`。
> 这是一份按 agent 版本和本机环境生成的运行时快照，不表示某个 CLI 的永久固定命令集。

## 1. 协议形态

SDK `@agentclientprotocol/sdk@0.22.1` 将命令列表作为 session update 提供：

```ts
{
  sessionUpdate: "available_commands_update",
  availableCommands: Array<{
    name: string;
    description: string;
    input?: { hint: string } | null;
    _meta?: Record<string, unknown> | null;
  }>;
}
```

本次探测的两种 agent 均在 `session/new` 后发出了该通知。所有命令条目均未发送
`_meta`。

## 2. 已测 Agent 汇总

| ACP agent | 探测版本 | ACP protocolVersion | 命令数量 | 结果 |
| --- | --- | --- | ---: | --- |
| `codex-acp` | `0.14.0` | `1` | 6 | 支持 `available_commands_update` |
| `claude-acp` / `@agentclientprotocol/claude-agent-acp` | `0.37.0` | `1` | 23 | 支持 `available_commands_update` |

## 3. `codex-acp@0.14.0`

以下命令由当前缓存二进制 `codex-acp` 在新会话中返回。

### `/review`

- `description`: Review my current changes and find issues
- `input.hint`: `optional custom review instructions`

### `/review-branch`

- `description`: Review the code changes against a specific branch
- `input.hint`: `branch name`

### `/review-commit`

- `description`: Review the code changes introduced by a commit
- `input.hint`: `commit sha`

### `/init`

- `description`: create an AGENTS.md file with instructions for Codex
- `input`: 未提供

### `/compact`

- `description`: summarize conversation to prevent hitting the context limit
- `input`: 未提供

### `/logout`

- `description`: logout of Codex
- `input`: 未提供

## 4. `claude-agent-acp@0.37.0`

以下命令由注册表 id `claude-acp` 对应的
`@agentclientprotocol/claude-agent-acp` 在新会话中返回。

### `/update-config`

- `description`: Use this skill to configure the Claude Code harness via settings.json. Automated behaviors ("from now on when X", "each time X", "whenever X", "before/after X") require hooks configured in settings.json - the harness executes these, not Claude, so memory/preferences cannot fulfill them. Also use for: permissions ("allow X", "add permission", "move permission to"), env vars ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json files. Examples: "allow npm commands", "add bq permission to global settings", "move permission to user settings", "set DEBUG=true", "when claude stops show X". For simple settings like theme/model, suggest the /config command.
- `input`: `null`

### `/verify`

- `description`: Verify that a code change actually does what it's supposed to by running the app and observing behavior. Use when asked to verify a PR, confirm a fix works, test a change manually, check that a feature works, or validate local changes before pushing.
- `input`: `null`

### `/debug`

- `description`: Enable debug logging for this session and help diagnose issues
- `input.hint`: `[issue description]`

### `/code-review`

- `description`: Review changed code for reuse, quality, and efficiency, then fix any issues found.
- `input.hint`: `[low|medium|high|xhigh|max]`

### `/batch`

- `description`: Research and plan a large-scale change, then execute it in parallel across 5–30 isolated worktree agents that each open a PR.
- `input.hint`: `<instruction>`

### `/fewer-permission-prompts`

- `description`: Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to project .claude/settings.json to reduce permission prompts.
- `input`: `null`

### `/loop`

- `description`: Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.
- `input.hint`: `[interval] [prompt]`

### `/schedule`

- `description`: Create, update, list, or run scheduled remote agents (routines) that execute on a cron schedule.
- `input`: `null`

### `/claude-api`

- `description`:

  ```txt
  Build, debug, and optimize Claude API / Anthropic SDK apps. Apps built with this skill should include prompt caching. Also handles migrating existing Claude API code between Claude model versions (4.5 → 4.6, 4.6 → 4.7, retired-model replacements).
  TRIGGER when: code imports `anthropic`/`@anthropic-ai/sdk`; user asks for the Claude API, Anthropic SDK, or Managed Agents; user adds/modifies/tunes a Claude feature (caching, thinking, compaction, tool use, batch, files, citations, memory) or model (Opus/Sonnet/Haiku) in a file; questions about prompt caching / cache hit rate in an Anthropic SDK project.
  SKIP: file imports `openai`/other-provider SDK, filename like `*-openai.py`/`*-generic.py`, provider-neutral code, general programming/ML.
  ```

- `input`: `null`

### `/run`

- `description`: Launch and drive this project's app to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app (not just tests). First looks for a project skill that already covers launching the app; otherwise falls back to built-in patterns per project type (CLI, server, TUI, Electron, browser-driven, library).
- `input`: `null`

### `/run-skill-generator`

- `description`: Author or improve the run-<unit> skill — a per-project skill that tells agents how to build, launch, and drive this project's app. Use when the user asks to set up the project, get it running, write run instructions, or verify build/run steps work from a clean environment.
- `input`: `null`

### `/compact`

- `description`: Free up context by summarizing the conversation so far
- `input.hint`: `<optional custom summarization instructions>`

### `/context`

- `description`: Show current context usage
- `input`: `null`

### `/heapdump`

- `description`: Dump the JS heap to ~/Desktop
- `input`: `null`

### `/init`

- `description`: Initialize a new CLAUDE.md file with codebase documentation
- `input`: `null`

### `/review`

- `description`: Review a pull request
- `input`: `null`

### `/security-review`

- `description`: Complete a security review of the pending changes on the current branch
- `input`: `null`

### `/usage-credits`

- `description`: Configure usage credits to keep working when you hit a limit
- `input`: `null`

### `/extra-usage`

- `description`: Renamed to /usage-credits
- `input`: `null`

### `/usage`

- `description`: Show the total cost and duration of the current session
- `input`: `null`

### `/insights`

- `description`: Generate a report analyzing your Claude Code sessions
- `input`: `null`

### `/goal`

- `description`: Set a goal — keep working until the condition is met
- `input`: `null`

### `/team-onboarding`

- `description`: Help teammates ramp on Claude Code with a guide from your usage
- `input`: `null`

## 5. 对 Specflow 的含义

- 当前 agent-proxy 已能通过 `onSessionUpdate` 接收该通知，并将命令快照写入
  agent capability cache。
- 当前 UI 已支持 slash command 输入体验：节点 prompt/decision criteria 中在行首输入
  `/` 会出现候选菜单，候选包含项目 skill 与该 agent 通过
  `available_commands_update` 广告的命令。
- 当前 server 会在执行前解析 slash command：匹配到 Specflow skill 的命令会注入
  skill body；匹配到 agent 广告命令的命令会原样透传给 agent；未知命令也会原样透传，
  但 UI 会提示它没有匹配到项目 skill 或该 agent 广告的命令。
- 命令列表应绑定到具体 ACP session 与 agent 版本，不能静态写死为某个 agent family 的全局能力。
- `input` 的 `undefined` 与 `null` 在真实 agent 间均会出现；消费方应把二者都按“不需要输入”处理，同时保留原始 payload 供调试。
- 命令说明可能很长且包含换行，命令选择 UI 需要支持截断展示和查看完整描述。

## 6. Session Fork 与回退能力

`AvailableCommand` 描述的是用户可输入的 slash command；ACP
`InitializeResponse.agentCapabilities.sessionCapabilities` 描述的是客户端可调用的
session API。两者不是同一套能力。

| Agent | `/fork` | `/branch` | `/rewind` | `/undo` | ACP `session/fork` |
| --- | --- | --- | --- | --- | --- |
| `codex-acp@0.14.0` | 未发布；直接输入可识别 | 未发布 | 未发布 | 未发布 | 未广告 |
| `claude-agent-acp@0.37.0` | 未发布 | 未发布 | 未发布 | 未发布 | 广告 `{}` |

补充说明：

- “支持一个 ACP 进程管理多个 session”与“支持从已有上下文 fork session”是两件事。`codex-acp@0.14.0` 实测可在同一 ACP 连接中连续 `session/new` 得到两个不同 session id，且分别向两个 id `session/prompt` 均成功；它不广告的是 `session/fork`。
- `codex-acp` 发布的 `/review-branch` 是“按指定 Git branch 进行代码审查”的命令，不是创建或切换 agent session branch。
- ACP SDK `0.22.1` 定义了 `session/fork` 请求与 `sessionCapabilities.fork` 能力；当前 SDK session capability 中没有 `rewind` 或 `undo` 对应的方法。
- `claude-agent-acp` 的 fork 应由 Specflow 作为 ACP client 调用 `session/fork`，而不是向 prompt 输入 `/fork`。
- `claude-agent-acp` 实测 `session/fork` 会返回一个与源 session 不同的新 `sessionId`。向源 session 写入标记 `ALPHA-FORK-CONTEXT` 后 fork，新 session 能回答该标记，说明它继承了 fork 时的对话上下文。
- 在同一 ACP 连接中，fork 返回后可直接使用新 `sessionId` 调用 `session/prompt`，不需要先调用 `session/resume`；原 session 也仍可使用原 `sessionId` 继续 prompt。
- 若客户端进程已断开，需要重新接入一个已持久化的原 session 或 fork session，再按 agent 广告能力调用 `session/resume`（继续但不回放历史）或 `session/load`（恢复并向客户端回放历史）。
- `codex-acp` 对直接 prompt `/fork` 的实测响应为 `Ready. What should I work on in this fork?` 和 `What would you like to work on in this fork?`；对照输入 `/definitely-not-a-codex-command` 则响应为未识别命令。因此 `/fork` 是一个未在 `AvailableCommandsUpdate` 发布的可识别命令。
- 调用 `/fork` 后，ACP `session/list` 中只观察到当前会话 id 被列出，未出现一个由 ACP 暴露的新 fork session id。Specflow 当前无法用标准 session API 追踪或管理这个 Codex 内部 fork。
- `codex-acp` 二进制中可观察到内部 rollback/rewind 相关字样，但其 ACP 初始化能力和 AvailableCommands 都未对客户端暴露相应接口，因此不能在 Specflow 中当作已支持功能。

## 7. 后续 CLI 追加模板

探测新的 ACP CLI 时，在本文增加如下条目，并保留原始运行时字段：

```md
## `<registry-id-or-agent-name>@<version>`

- 探测日期：YYYY-MM-DD
- 启动来源：registry binary / npx / uvx / custom
- ACP `protocolVersion`: `<number>`
- `available_commands_update`: 收到 / 未收到
- 命令数量：`<count>`

### `/<command-name>`

- `description`: <agent returned description>
- `input`: `null` / 未提供
- `input.hint`: `<agent returned hint>`  # 仅在存在时记录
- `_meta`: <agent returned metadata>      # 仅在存在时记录
```
