# Specflow

Specflow 是一个本地优先的持续编码平台。

它位于传统 CI/CD 之前，目标是把一个 ticket 转化为一个可观察、可验证、可修复的实现图，在代码进入 CI 之前尽可能完成理解、计划、生成、审查和修复。

整体关系是：

```txt
CC -> CI -> CD
```

Specflow 不替代 CI/CD，而是在 CI/CD 之前增加一个本地编码收敛层。

## 当前状态

Phase 0 仓库基础已经收尾，当前正在实现 Phase 1：本地持续编码最小闭环。

当前代码提供 local-first/package-first 工程骨架、静态 workflow graph validation、`.specflow` 读取能力，以及 Phase 1 的本地 placeholder workflow run、artifact 记录和 repair loop。当前仍不调用真实 agent。

## 技术选择

- CLI：TypeScript 和 `commander`
- Runtime：本地 workflow graph、状态机和执行占位
- Server：本地 server / IPC 适配层占位
- UI：React 和 `@xyflow/react` 组件包
- 包管理：pnpm workspaces
- 任务编排：Turbo
- 本地工具链：mise

## 仓库结构

```txt
apps/cli              唯一真实应用入口
packages/core         领域模型、规则、基础类型
packages/runtime      workflow engine、状态机、调度和执行占位
packages/specflow     .specflow 读写、schema、仓库知识层
packages/agent        agent runner、工具调用、执行策略占位
packages/server       本地 server / IPC 适配层占位
packages/ui           React 节点式 workflow 面板组件
packages/shared       共享常量和工具
packages/config       共享 lint、format、test 配置
docs/                 给人和 AI 阅读的解释文档
.specflow/            仓库级项目知识和当前规则
```

`apps/desktop` 暂不创建。未来真正选择 Tauri 或 Electron 时，再作为本地桌面壳加入。

## 本地环境

`.mise.toml` 是本地 Node.js 和 pnpm 工具链版本的唯一来源。根目录 `package.json` 会镜像这些约束。依赖版本由 `pnpm-lock.yaml` 锁定。

Linux/macOS 安装 mise：

```bash
curl https://mise.run | sh
```

让当前 shell 可以找到 mise：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

bash 自动激活 mise：

```bash
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

macOS zsh 自动激活 mise：

```bash
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

shell 激活后，直接运行 `pnpm ...`，不需要通过 `mise exec -- pnpm ...`。

安装项目工具链和依赖：

```bash
mise install
pnpm install
```

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
pnpm clean
```

运行 CLI：

```bash
pnpm --filter @specflow/cli specflow --help
pnpm --filter @specflow/cli specflow doctor
pnpm --filter @specflow/cli specflow spec read
pnpm --filter @specflow/cli specflow workflow validate
pnpm --filter @specflow/cli specflow workflow run --ticket "describe the task"
pnpm --filter @specflow/cli specflow workflow list
pnpm --filter @specflow/cli specflow workflow show <runId>
```

构建本地能力包：

```bash
pnpm --filter @specflow/runtime build
pnpm --filter @specflow/specflow build
pnpm --filter @specflow/ui build
pnpm --filter @specflow/server build
```

## 阅读入口

- 产品定位：`docs/product/vision.md`
- 阶段路线：`docs/product/roadmap.md`
- 架构说明：`docs/architecture/overview.md`
- AI 阅读指南：`docs/ai/repository-guide.md`
- 当前项目知识：`.specflow/project.md`
- 当前工程约定：`.specflow/conventions.md`
