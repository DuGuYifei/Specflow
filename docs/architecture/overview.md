# 架构说明

Specflow 是 local-first/package-first 的 TypeScript monorepo。核心产品不是独立 Web 服务，而是在本地运行的持续编码 runtime。

## 架构重心

CLI 是当前唯一真实应用入口。用户和 AI agent 通过 CLI 检查环境、读取 `.specflow`、验证 workflow，并在后续阶段启动本地 workflow run。

Runtime 是核心。它负责 workflow graph、状态机、调度、中断恢复和执行结果收敛。当前只保留 graph 契约、验证 helper 和执行占位。

UI 是本地 runtime 的可视化面板组件，不是独立 Web 产品。它使用 React 和 `@xyflow/react` 表达节点式 workflow。

Local API 是本地 API / IPC 适配层，不是传统后端服务。未来它可以连接 CLI、桌面壳、UI 面板和 runtime。

## Package 边界

`packages/core` 存放领域模型、规则和基础类型，例如 Ticket、WorkflowNode、WorkflowEdge、WorkflowRun、WorkflowArtifact、ReviewResult。

`packages/runtime` 存放 workflow engine、状态机、调度和执行占位。当前不做真实 agent 编排。

`packages/specflow` 存放 `.specflow` 读写、schema 和仓库知识层工具。

`packages/agent` 存放 agent runner、工具调用和执行策略占位。当前不集成真实 Codex。

`packages/local-api` 存放本地 API / IPC 适配层占位。

`packages/ui` 存放 React 节点式 workflow 面板组件。

`packages/shared` 存放共享常量和小工具。

`packages/config` 存放共享 ESLint、Prettier、Vitest 配置。

## Runtime 方向

长期 runtime 会把实现过程视为 graph。Node 表示可观察的工作步骤或验证步骤，Edge 表示节点之间的执行、数据和审查关系。

当前已定义的 edge 语义是：

- `control_flow`：执行顺序
- `data_flow`：artifact 或上下文移动
- `review_loop`：reviewer/verifier 的反馈循环

当前已定义的 node 语义包括 ticket、interview、plan、code draft、implementation reviewer、repair、final patch，以及面向未来的 visual decomposer、visual verifier。

## 本地产品表面

Specflow 可以有多个本地产品表面：CLI、未来桌面壳、UI 面板、本地 API 或 IPC。它们都应该围绕同一个 runtime 工作，而不是形成传统前后端分离架构。

`apps/desktop` 暂不创建。未来真正选择 Tauri 或 Electron 时，再把它作为本地桌面壳加入。
