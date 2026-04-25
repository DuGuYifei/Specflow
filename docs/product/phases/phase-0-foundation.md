# Phase 0：仓库基础

目标是建立清晰、稳定、AI 友好的 local-first/package-first 工程骨架。

这个阶段不是实现完整产品，而是建立后续开发所需的项目结构、工具链、基础类型、文档入口和最小本地能力包。

## 范围

- 使用 monorepo
- 使用 pnpm workspace
- 使用 mise 管理本地工具链
- 使用 Turbo 编排本地任务
- 使用 TypeScript
- 建立 CLI 应用
- 建立 core、runtime、specflow、agent、local-api、ui、shared、config package
- 建立 `.specflow` 目录
- 建立 `docs` 目录
- 建立基础领域类型
- 建立静态节点图 UI 组件占位
- 本地可以完成 lint、typecheck、test、build

## 非目标

- 真实 agent 集成
- 真实 Codex 调用
- 真实 workflow 编排
- 数据库
- 认证
- CI workflow
- 桌面壳
- 传统前后端分离架构
- 复杂图编辑器
