# 0001：Monorepo 与 pnpm

## 状态

已接受

## 背景

Specflow 需要一个人类开发者和 AI agent 都能快速理解的工程基础。产品长期会包含 CLI、本地 runtime、UI 面板、本地 API/IPC 适配层，以及多个共享领域概念。

## 决策

使用 monorepo 组织仓库。

使用 pnpm workspaces 管理应用和 package。

全仓库使用 TypeScript。

使用 `.specflow` 作为仓库级项目知识层，用来记录当前项目目的、架构事实、工程约定、术语和 workflow 意图。

使用 mise 管理本地工具链。具体工具链版本由 `.mise.toml` 声明，`.mise.toml` 是本地和 AI agent 确定性执行的来源。

使用 `pnpm-lock.yaml` 锁定依赖版本。

## 影响

monorepo 让多个应用入口共享清晰的领域类型和工具包，同时保留明确 package 边界。

工具链变化必须有明确意图。依赖变化必须更新 lockfile。
