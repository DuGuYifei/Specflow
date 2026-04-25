# 0003：Local-first Package 架构

## 状态

已接受

## 背景

Specflow 的核心是本地运行的持续编码 runtime，不是传统前后端分离 Web 产品。

初始 `apps/cli + apps/server + apps/web` 结构容易让架构重心偏向独立后端和独立前端。实际产品应该以本地 runtime 为中心，CLI、UI、Local API、未来桌面壳都只是围绕 runtime 的产品表面。

## 决策

采用 local-first/package-first 结构。

`apps/cli` 是当前唯一真实应用入口。

核心能力放在 `packages/core`、`packages/runtime`、`packages/specflow`、`packages/agent`。

本地产品表面放在 `packages/local-api` 和 `packages/ui`。它们是可构建能力包，不是独立后端或独立 Web 产品。

暂不创建 `apps/desktop`。未来真正选择 Tauri 或 Electron 时，再创建桌面壳。

引入 Turbo 编排 monorepo 本地任务。

## 影响

仓库结构更贴近 Specflow 的最终形态：本地 runtime 是核心，其他入口和界面围绕 runtime 组合。

后续实现 workflow、agent、artifact、UI 状态展示时，应优先在 package 边界内建模，而不是先建立远程服务边界。
