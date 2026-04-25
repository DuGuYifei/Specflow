# 0002：初始应用框架选择

## 状态

已被 `0003-local-first-package-architecture.md` 调整

## 背景

Specflow 初始骨架曾选择 CLI、后端 API、Web 节点图界面作为三个应用入口。

## 决策

保留 `apps/cli` 作为开发者和 AI agent 的命令入口。

CLI 使用 `commander`，因为它成熟、稳定，适合实现可预测的命令结构。

Fastify 保留为本地 API / IPC 适配层的 HTTP 选项，但不再表达为独立后端产品。

React 和 `@xyflow/react` 保留为本地 UI 面板组件基础，但不再表达为独立 Web 产品。

节点图使用 `@xyflow/react`。Specflow 的长期产品形态是 workflow graph，所以 UI 基础从一开始就应该表达节点和边。

## 影响

当前只建立框架骨架和静态占位。真实 workflow 执行、图编辑、本地 API/IPC 联动和 agent 集成都留给后续阶段。
