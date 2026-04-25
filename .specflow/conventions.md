# 当前工程约定

## TypeScript

使用 TypeScript strict mode。

默认使用 ESM，除非工具明确要求其他模块格式。

领域类型应保持可读，并尽量贴近产品语言。

## Package 边界

保持明确 package 边界。

不要隐藏跨 package 私有文件引用。

共享领域类型放在 `packages/core`。

workflow engine、状态机和 runtime 契约放在 `packages/runtime`。

`.specflow` 读写和仓库知识层逻辑放在 `packages/specflow`。

agent runner、工具调用和执行策略放在 `packages/agent`。

本地 API / IPC 适配层放在 `packages/local-api`。

React 节点式 workflow 面板组件放在 `packages/ui`。

## 代码风格

避免过早抽象。

只有在逻辑不明显或需要说明未来集成点时才添加注释。

CLI 命令输出必须可预测。

Local API 只表达本地适配边界，不应被设计成独立后端产品。

UI 应该让 workflow graph 概念可见，不应被设计成独立 Web 产品。

## 当前产品边界

不要实现真实 agent。

不要集成真实 Codex 调用。

不要实现生产级 workflow 编排。

不要添加数据库。

不要添加认证。

不要添加 CI workflow。

不要创建桌面壳。

不要实现复杂图编辑器。

不要引入传统前后端分离架构。

## 文档边界

`.specflow` 记录当前必须遵守的事实和规则。

`docs` 记录解释、背景、路线、决策原因和 onboarding。

不要在多个文档中复制同一段长解释。

## Toolchain Management

本项目使用 mise 管理本地 Node.js 和 pnpm 工具链。

工具链版本定义在 `.mise.toml`。

`.mise.toml` 是本地工具链版本的唯一来源。

`package.json` 镜像 package manager 和 Node engine 约束。

依赖版本由 `pnpm-lock.yaml` 锁定。

`pnpm-lock.yaml` 必须提交，并作为确定性执行契约的一部分。

如果工具链版本需要变化，必须通过独立 PR 或独立提交处理。

这些规则用于保证本地开发和 Codex 等 AI agent 的执行一致性。
