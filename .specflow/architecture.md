# 当前架构事实

Specflow 是 TypeScript monorepo，使用 pnpm workspaces 和 Turbo。

CLI 位于 `apps/cli`，是当前唯一真实应用入口。

核心领域类型位于 `packages/core`。

workflow engine、状态机、调度和执行占位位于 `packages/runtime`。

`.specflow` 读写、schema 和仓库知识层工具位于 `packages/specflow`。

agent runner、工具调用和执行策略占位位于 `packages/agent`。

本地 API / IPC 适配层占位位于 `packages/local-api`。

React 节点式 workflow 面板组件位于 `packages/ui`。

`.specflow` 是仓库级知识层，记录当前项目目的、架构事实、工程约定、术语和 workflow 意图。

当前不包含数据库、认证、CI workflow、真实 Codex 集成、生产级 workflow 编排、桌面壳或传统前后端分离架构。
