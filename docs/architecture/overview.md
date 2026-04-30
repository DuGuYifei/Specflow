# 架构说明

Specflow 是 local-first/package-first 的 TypeScript monorepo。核心产品不是独立 Web 服务，而是在本地运行的持续编码 runtime。

## 架构重心

CLI 是当前唯一真实应用入口。用户和 AI agent 通过 CLI 检查环境、读取 `.specflow`、验证 workflow、启动本地 workflow run，并通过 `specflow ui` 启动本地可视化工作台。

Runtime 是核心。它负责 workflow graph、状态机、调度、中断恢复和执行结果收敛。当前只保留 graph 契约、验证 helper 和执行占位。

Session module 是 runtime 的一等概念。它把多个节点放入同一个 agent CLI 会话组，或在循环边界强制开启新 session。节点可以声明固定 session 策略，也可以声明由某个 director 节点通过 mock AI 决策控制 session 边界。

UI 是本地 runtime 的可视化面板，不是独立 Web 产品。它使用 React 和 `@xyflow/react` 表达节点式 workflow，由 `specflow ui` 启动的本地 server 托管。

Server 是本地 runtime API 和 UI 静态托管适配层，不是 hosted backend，也不是传统前后端分离架构里的远程后端服务。当前它提供本地 run 查询、创建和 artifact 读取 API，并托管 `packages/ui` 的构建输出。

Server 也提供 `/api/workflows`，把 `.specflow/workflows/*.workflow.json` 读取为 UI 可消费的 definition 列表，并附带 validation result、当前 runtime compatibility result 和 execution preview。UI 的 draft graph 应优先来自这个 API，而不是复制 runtime 的硬编码图。创建 run 的 API 可以接收 `workflowDefinitionId`，并把实际绑定的 definition reference 写入 run state。

## Package 边界

`packages/core` 存放领域模型、规则和基础类型，例如 Ticket、WorkflowNode、WorkflowEdge、WorkflowRun、WorkflowArtifact、ReviewResult。

节点级 agent CLI 选择是 `WorkflowNode` 的一部分。Definition 可以声明某个节点使用 `codex`、`claude` 或未来自定义 CLI；runtime 会把该选择复制到 `NodeExecutionState`，但当前仍只做 mock 执行，不启动真实 agent。

`WorkflowDefinition.sessionGroups` 是 session module 的定义级目录，用来描述 Direction、Implementation、Review 等共享 session 组。节点继续通过 `session.groupId` 加入某个组，runtime 在创建 run 时保存这个 plan，UI 用它展示哪些节点预期共享同一 session。

`packages/runtime` 存放 workflow engine、状态机、调度和执行占位。当前不做真实 agent 编排。

`packages/specflow` 存放 `.specflow` 读写、schema 和仓库知识层工具。

结构化 workflow definition 使用 `.specflow/workflows/*.workflow.json`。它和 Markdown 状态文件分工不同：JSON 是程序可读取和校验的当前事实，Markdown 是人和 AI 阅读的状态说明。

`WorkflowRun` 保留创建时的 workflow definition reference，包括 id、name、source、version 和 path。这样 UI、CLI 和未来恢复执行时都能知道某个 run 基于哪个结构化定义启动。

`packages/agent` 存放 agent runner、工具调用和执行策略占位。当前不集成真实 Codex。

`packages/server` 存放本地 runtime API 和 UI 静态托管适配层。

`packages/ui` 存放 React 节点式 workflow 面板。

`packages/shared` 存放共享常量和小工具。

`packages/config` 存放共享 ESLint、Prettier、Vitest 配置。

## Runtime 方向

长期 runtime 会把实现过程视为 graph。Node 表示可观察的工作步骤或验证步骤，Edge 表示节点之间的执行、数据和审查关系。

当前已定义的 edge 语义是：

- `control_flow`：执行顺序
- `data_flow`：artifact 或上下文移动
- `review_loop`：reviewer/verifier 的反馈循环
- `control_scope`：director、manager 或 verifier 节点管理其他节点的范围

当前已定义的 session 语义是：

- `none`：节点不进入 agent session
- `shared`：复用同一 session group 的最近 session
- `fresh`：每次执行创建新 session
- `ai_decides`：由控制节点产出的 decision 决定是否创建新 session

`specflow workflow validate` 必须同时校验内置 workflow graph 和仓库中的结构化 workflow definition。校验范围至少包括 entry node、edge endpoint、session controller、managed node 和 `control_scope` edge。

当前 placeholder executor 仍按 Phase 1 节点 id 执行固定本地闭环。Runtime 暴露本地 placeholder graph 可执行性检查；Server 在 `/api/workflows` 和创建 run 时只组合 definition validation 和 runtime compatibility result。

Runtime 也负责从 workflow definition 派生 execution preview，包括节点执行模式、agent CLI、session policy、controller 和 control scope 摘要。Server 只透传 preview，UI 只消费 preview，避免可视化层复制 runtime 推导规则。

当前已定义的 node 语义包括 ticket、interview、session director、plan、code draft、implementation reviewer、repair、final patch，以及面向未来的 visual decomposer、visual verifier。Session Director 是 director/manager/verifier 族节点的第一个实例：它不直接产出代码，而是产出可观察的控制决策，管理其他节点的 session 边界。

`implementation-review` 是 reviewer/control 节点的第一个实例：它仍产出 `review-result` artifact，但也通过 `control_scope` 管理 repair 和 final patch，并写入 `review` control decision。后续 verifier、manager 或 reviewer 节点应优先复用这个 pattern。

## 本地产品表面

Specflow 可以有多个本地产品表面：CLI、未来桌面壳、UI 面板、本地 server 或 IPC。它们都应该围绕同一个 runtime 工作，而不是形成传统前后端分离架构。当前 `specflow ui` 是 CLI 启动本地 server 和 UI 面板的组合入口。

`apps/desktop` 暂不创建。未来真正选择 Tauri 或 Electron 时，再把它作为本地桌面壳加入。
