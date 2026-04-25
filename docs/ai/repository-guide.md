# AI 仓库阅读指南

这份文档写给在 Specflow 仓库中工作的 AI agent。

## 先读哪里

- 项目是什么、怎么运行：`README.md`
- 产品定位和功能理解：`docs/product/vision.md`
- 阶段路线总览：`docs/product/roadmap.md`
- 各阶段细节：`docs/product/phases/`
- 架构说明：`docs/architecture/overview.md`
- 当前项目知识：`.specflow/project.md`
- 当前架构事实：`.specflow/architecture.md`
- 当前工程约定：`.specflow/conventions.md`
- 当前术语：`.specflow/glossary.md`

## 代码位置

- CLI 入口：`apps/cli/src`
- 核心领域类型：`packages/core/src`
- workflow runtime：`packages/runtime/src`
- `.specflow` 读写工具：`packages/specflow/src`
- agent 抽象：`packages/agent/src`
- 本地 API / IPC 适配层：`packages/local-api/src`
- React workflow 面板：`packages/ui/src`

## `docs` 与 `.specflow` 的边界

`.specflow` 写当前应该被系统和 AI 遵守的事实与规则。

`docs` 写解释、背景、原因、路线和 onboarding。

如果一个信息是当前必须遵守的规则，放 `.specflow`。如果一个信息是为什么这么做，放 `docs`。如果两个地方都要提，`.specflow` 只简短记录事实，`docs` 负责解释背景。

## 工具链规则

使用 mise 管理本地 Node.js 和 pnpm。工具链版本从 `.mise.toml` 读取。

不要修改工具链版本，除非用户明确要求。如果版本需要变化，应该用独立提交或独立 PR 处理。

shell 激活 mise 后，直接运行 `pnpm ...`。不要在普通文档中要求用户使用 `mise exec -- pnpm ...`。

依赖版本由 `pnpm-lock.yaml` 锁定。这个 lockfile 是确定性执行契约的一部分。

## 当前边界

- 不实现真实 agent。
- 不集成真实 Codex 调用。
- 不实现生产级 workflow 编排。
- 不添加数据库。
- 不添加认证。
- 不添加 CI workflow。
- 不创建桌面壳。
- UI 保持本地组件包，不作为独立 Web 产品。
- Local API 保持本地适配层，不作为独立后端产品。

## 修改规则

优先写可读 TypeScript，不要过早抽象。

共享领域语言放在 `packages/core`。workflow engine 和 runtime 契约放在 `packages/runtime`。读取 `.specflow` 的逻辑放在 `packages/specflow`。

CLI 输出应该可预测。Local API 只表达本地适配边界。UI 应该让 workflow graph 概念可见，避免过早引入复杂状态。

文档修改时，避免把同一段长解释复制到多个文件。`.specflow` 记录事实，`docs` 解释原因。
