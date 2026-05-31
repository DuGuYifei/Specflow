# Specflow

[English](README.md) | 简体中文

Specflow 正在围绕 Bun 驱动的运行时和浏览器优先的 UI 进行重建。当前基础架构通过独立的 server package 启动 UI，同时 server 调用单独的 bridge 层；这个 bridge 层未来也可以被 headless 入口复用。

## 环境要求

Specflow 使用 [mise](https://mise.jdx.dev/) 固定 Bun 版本。

安装 mise：

```sh
curl https://mise.run | sh
```

在 shell 中启用 mise。bash 示例：

```sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

zsh 示例：

```sh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

然后进入本仓库并信任本地 mise 配置：

```sh
cd specflow-code
mise trust
bun --version
```

期望的 Bun 版本是：

```text
1.3.14
```

## 开发

安装依赖：

```sh
bun install
```

以开发模式启动 Specflow：

```sh
bun run dev
```

该命令会启动 Specflow server，并打印浏览器 URL：

```text
Specflow UI: http://localhost:5173/
```

开发模式下，server 会把 UI 请求代理到 Vite，因此 React 更新会比较快。生产模式下，server 会从编译后的二进制中提供内嵌的静态 UI。

## Workspace 文件

Specflow 将 workflow-as-code 文件保存在 `.specflow/agentflows/*.yaml`。浏览器画布布局生成到 `.specflow/canvas/*.json`，并默认被忽略，因此用户可以编写或 review agentflow，而不需要手写 UI 坐标。

Agent server 配置在 `.specflow/agent-servers.json` 中。本地密钥和机器相关覆盖项建议写入 `.specflow/agent-servers.local.json`；它会按 agent id 与共享配置深度合并。local 文件只需要写自己要覆盖或补充的字段，尤其是 `env`。

本地密钥覆盖示例：

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

Specflow 支持的 agent server 自定义 key：

- `env`：传给 agent 进程的环境变量。ACP `env_var` 认证方法会从这里读取所需变量；如果代理或 VPN 导致 agent 无法访问网络，也可以在这里配置 `http_proxy` 和 `https_proxy`。

Agent server 条目只保存进程启动所需设置，例如 `command`、`args`、`cwd` 和 `env`。认证、terminal capability 和 permission prompt 都由 ACP 在运行时驱动。Mode、model、reasoning 和 config override 应该配置在 workflow 或节点级别，而不是 agent server 配置里。

## Scripts

```sh
bun run dev        # 启动 server + Vite dev proxy
bun run build      # build:ui 后 build:bin，生成 ./specflow 二进制
bun run typecheck  # 对所有 packages 做类型检查
```
