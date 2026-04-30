# Phase 1 Workflow 状态

Phase 1 当前状态：已开始实现。

当前目标：实现本地持续编码最小闭环，但按可交付切片逐步推进。

当前已实现切片：最小 workflow run、artifact、execution state、定义级 session group plan、节点级 agent CLI 选择、session module、mock Session Director、reviewer control scope、control decision 细节展示、本地 API 详细错误展示、workflow-bound run 创建的本地类型和 `.specflow/runs/` 文件存储边界；CLI 可以创建、列出和查看本地 placeholder workflow run；`specflow ui` 可以启动本地可视化面板观察运行过程。

当前结构化 workflow definition：`.specflow/workflows/phase-1-local-loop.workflow.json`。

## 当前边界

- CLI 是当前唯一真实应用入口。
- `packages/runtime` 负责 workflow graph、状态机、执行占位、run state 和 artifact 边界。
- `packages/runtime` 负责将节点 session policy、Session Director control decision 和 workflow session 写入 run state。
- `packages/specflow` 只负责通用 `.specflow` 读写和仓库知识层能力。
- `packages/specflow` 可以读取 `.specflow/workflows/*.workflow.json`，但不负责执行 workflow。
- 本地 server 通过 `/api/workflows` 暴露 workflow definition 和 validation result。
- UI draft graph 优先使用 `/api/workflows` 返回的结构化 definition。
- 本地 server 创建 run 时可以接收 `workflowDefinitionId`，并把绑定的 definition reference 写入 run state。
- 当前 placeholder executor 只保证包含 Phase 1 固定节点 id 的 workflow definition 可执行。
- 当前 placeholder executor 的 graph 可执行性检查由 `packages/runtime` 暴露，server 不复制必需节点清单。
- Workflow definition 中的 `sessionGroups` 描述可展示的 session plan；节点通过 `session.groupId` 加入组。
- Workflow definition 中的 agent-mode 节点可以声明 `agentCli`；未声明时 runtime 使用默认 mock `codex`。
- `implementation-review` 通过 `control_scope` 管理 `repair-loop` 和 `final-patch`，并在运行时写入 `review` control decision。
- UI Inspector 会展开 control decision 细节，显示 session director 对目标节点的新 session / 复用 session 决策。
- UI 创建 run 失败时会显示 server 返回的 `error` 和 validation `issues`。
- `packages/agent` 只保留 agent runner、执行策略和 agent CLI 选择的边界。
- 不集成真实 Codex 调用。
- 不实现生产级 orchestration。
- 不添加数据库、认证或 CI workflow。
- 不创建复杂 UI 或桌面壳。
- 本地运行记录写入 `.specflow/runs/`，该目录不提交入库。
- UI 由 `specflow ui` 启动，不新增独立 app 入口。

## Agent CLI 选择

每个 workflow node 都应允许声明执行它的 agent CLI。

当前默认 agent CLI：`codex`。

当前阶段只建模 agent CLI 选择，不实际调用真实 agent。

最小节点执行配置应能表达：

- node id
- node kind
- agent CLI 名称
- agent CLI 参数占位
- 输入 artifact 引用
- 输出 artifact 类型
- 执行状态

如果节点未显式声明 agent CLI，runtime 应使用默认 agent CLI。

未来可支持的 agent CLI 包括但不限于 `codex`、`claude`、`gemini` 或本地自定义命令；当前不实现这些集成。

## 可实现切片

### P1.1 Run / Artifact / Execution State 契约

完成状态：已完成。

完成条件：

- 定义最小 `WorkflowRun`、`WorkflowArtifact`、`NodeExecutionState`。
- 定义本地存储接口边界。
- 定义节点执行配置中的 agent CLI 字段。
- 提供内存或文件存储占位实现。
- 测试覆盖 run 创建、artifact 写入、node state 流转和默认 agent CLI 选择。

非目标：

- 不调用真实 agent。
- 不生成真实代码补丁。
- 不实现复杂调度。

### P1.2 CLI 创建和读取 Workflow Run

完成状态：已完成。

完成条件：

- CLI 可以从 ticket 创建本地 workflow run。
- CLI 可以写入 ticket artifact。
- CLI 可以读取 run summary。
- CLI 输出保持可预测。

非目标：

- 不执行完整 workflow。
- 本切片不连接 UI；UI 作为后续切片接入。

### P1.3 Spec Context 节点

完成状态：已完成。

完成条件：

- runtime 可以通过 `packages/specflow` 读取 `.specflow` 上下文。
- 生成 `spec-context` artifact。
- 节点可声明使用默认 `codex` 或其他 agent CLI，但当前只记录选择。

非目标：

- `packages/specflow` 不硬编码本仓库 phase 文件。
- 不自动更新 `.specflow`。

### P1.4 Plan 节点占位执行

完成状态：已完成。

完成条件：

- 基于 ticket artifact 和 spec context artifact 生成 plan artifact。
- plan 节点记录 agent CLI 选择。
- 当前实现可以是 deterministic placeholder。

非目标：

- 不要求 LLM 生成真实 plan。
- 不进入代码修改。

### P1.5 Code Draft / Review / Repair 占位闭环

完成状态：已完成。

完成条件：

- code draft 节点生成 draft artifact 占位。
- implementation reviewer 节点生成 review result artifact 占位。
- repair 节点可以根据 review result 生成 repair artifact 占位。
- runtime 能表达 reviewer 通过、reviewer 拒绝、达到最大修复次数这三类路径。
- 每个节点都记录自己的 agent CLI 选择。

非目标：

- 不执行真实代码改动。
- 不做多 agent 并发编排。

### P1.9 Session Module / Session Director

完成状态：已完成。

完成条件：

- 节点可以声明 session policy：不使用 session、共享 session、每次新建 session、由 AI 决定。
- 节点可以声明 repair loop 再次进入时是否开启新 session。
- runtime 可以记录 workflow session、节点 session id、session artifact 关联和 control decision。
- 默认 Phase 1 workflow 包含 mock Session Director 节点。
- Session Director 通过 `control_scope` 声明自己管理哪些节点。
- UI 可以显示节点角色、session 归属、director 管理边、control decision 和 session 列表。

非目标：

- 不调用真实 AI 决定 session。
- 不实现多 agent 并发。
- 不实现复杂图编辑器。

### P1.10 Structured Workflow Definition

完成状态：已完成。

完成条件：

- `packages/core` 定义 `WorkflowDefinition`。
- `.specflow/workflows/phase-1-local-loop.workflow.json` 记录当前 Phase 1 节点、边、session policy 和 control scope。
- `packages/specflow` 可以读取 `.specflow/workflows/*.workflow.json`。
- `specflow workflow validate` 可以校验仓库中的结构化 workflow definition。
- graph validation 能检查 entry node、session controller、managed node 和 control scope edge。

非目标：

- 当前不让 runtime 完全由 JSON definition 驱动执行。
- 当前不实现 UI 图编辑器。

### P1.11 Workflow Definition API / UI Draft Graph

完成状态：已完成。

完成条件：

- Server 提供 `/api/workflows`。
- API 返回 repository workflow definition、来源路径和 validation result。
- 如果仓库没有结构化 definition，API 返回内置 Phase 1 workflow fallback。
- UI 启动时读取 `/api/workflows`。
- UI draft graph 优先由 workflow definition 构建。
- UI 显示当前 workflow definition 的来源和校验状态。

非目标：

- 当前不实现 workflow definition 写入。
- 当前不实现图编辑器。
- 当前不实现多 definition 的编辑、排序或启停管理。

### P1.12 Workflow-bound Run Creation

完成状态：已完成。

完成条件：

- `WorkflowRun` 记录绑定的 workflow definition reference。
- `createLocalWorkflowRun` 可以接收显式 workflow definition，并用该 definition 初始化 nodes、edges 和 node execution。
- Server 创建 run API 可以接收 `workflowDefinitionId`。
- Server 会校验选中 definition 是否有效，并拒绝当前 placeholder executor 无法执行的节点形状。
- UI 可以在左侧选择 workflow definition，并用选中 definition 创建 run。
- Inspector 显示当前 run 或 draft 绑定的 workflow definition 来源。

非目标：

- 当前不实现 workflow definition 编辑或保存。
- 当前不把 executor 完全改为任意 graph 调度。
- 当前不调用真实 agent。

### P1.13 Node Agent CLI Definition

完成状态：已完成。

完成条件：

- `WorkflowNode` 可以声明 `agentCli`。
- `.specflow/workflows/phase-1-local-loop.workflow.json` 在 agent-mode 节点上记录默认 `codex` CLI。
- Runtime 创建 node execution 时优先使用节点声明的 agent CLI。
- 没有声明 agent CLI 的 agent-mode 节点继续使用默认 mock `codex`。
- Graph validation 会拒绝空 agent CLI 命令。

非目标：

- 当前不启动真实 Codex、Claude 或其他 agent。
- 当前不实现 UI 图编辑器中的 agent CLI 下拉选择。
- 当前不实现按节点保存用户编辑后的 workflow definition。

### P1.14 Reviewer Control Scope

完成状态：已完成。

完成条件：

- `implementation-review` 在 workflow definition 中声明 `control_scope`。
- `implementation-review` 管理 `repair-loop` 和 `final-patch`。
- Runtime 每次 review 都写入 `review` control decision。
- Review artifact 仍保持 `ReviewResult` 形状，避免破坏当前 repair loop 读取逻辑。
- UI 可通过既有 control decision 和 control scope 展示 reviewer 的管理范围。

非目标：

- 当前不实现任意 reviewer/verifier 节点模板。
- 当前不实现真实 AI reviewer。
- 当前不实现复杂路由调度器。

### P1.15 Definition Session Groups / UI Session Plan

完成状态：已完成。

完成条件：

- `WorkflowDefinition` 可以声明 `sessionGroups`。
- Runtime 创建 run 时保存 session group plan。
- 没有显式 `sessionGroups` 的旧 definition 可以从节点 `session.groupId` 推导。
- Graph validation 会检查 session group controller 和节点引用的 group。
- UI Inspector 显示 Session Plan，帮助用户看出哪些节点预期共用 session。

非目标：

- 当前不实现 UI 编辑 session group。
- 当前不实现真实 agent session 进程复用。
- 当前不实现复杂 session 生命周期策略。

### P1.16 Control Decision Detail UI

完成状态：已完成。

完成条件：

- UI Inspector 不只显示 control decision 摘要。
- Session decision 展示目标节点、session group、新开或复用 session、原因。
- Review/control decision 展示目标节点名称。
- 展示逻辑复用 `WorkflowControlDecision`，不为 Session Director 单独创建专用 UI 数据模型。

非目标：

- 当前不实现可编辑 decision。
- 当前不实现图上动画路由。
- 当前不实现实时日志流。

### P1.17 Local API Error Detail UI

完成状态：已完成。

完成条件：

- UI 创建 run 失败时读取 server error payload。
- 如果 server 返回 validation issues，UI 展示 issue message。
- 错误展示仍复用现有 inspector error panel。

非目标：

- 当前不实现 toast 系统。
- 当前不实现按字段定位错误。
- 当前不实现 workflow definition 编辑器。

### P1.18 Runtime Placeholder Compatibility Check

完成状态：已完成。

完成条件：

- Runtime 暴露本地 placeholder graph 可执行性检查。
- 可执行性检查确认当前 executor 必需节点存在且类型匹配。
- Server 创建 run 时调用 runtime compatibility helper。
- Server 不再复制 placeholder executor 的必需节点清单。

非目标：

- 当前不实现任意 graph 调度。
- 当前不生成可视化执行计划。
- 当前不移除 Phase 1 固定节点 executor。

### P1.6 Final Patch 候选输出

完成状态：已完成。

完成条件：

- final patch 节点生成 final patch artifact。
- CLI 可以显示 run summary 和 final artifact 引用。
- run 进入 terminal state。

非目标：

- final patch 可以仍是占位内容。
- 不连接 PR、CI 或远程服务。

### P1.7 最小日志和错误状态

完成状态：部分完成。

完成条件：

- run、node execution 和 artifact 都能记录基础时间信息。
- node 支持 pending、running、completed、failed、skipped。
- run 支持 created、running、completed、failed、cancelled。
- 不可恢复错误可以进入 failed state。

非目标：

- 不实现生产级日志系统。
- 不实现可恢复任务队列。

### P1.8 `specflow ui` 本地可视化面板

完成状态：已完成。

完成条件：

- CLI 提供 `specflow ui`，启动本地 server 并托管 UI。
- Server 提供本地 runs、run detail、artifact 和 create run API。
- UI 可以输入 inline ticket、创建 run、轮询 run 状态，并在节点画布中观察执行过程。
- UI 保持在 `packages/ui`，不新增独立 app 入口。

非目标：

- 不实现 SSE、WebSocket 或远程 hosted backend。
- 不做 auth、数据库或生产级 orchestration。
- 不接真实 agent。

## 当前默认 Workflow 节点

最小 Phase 1 workflow 节点顺序：

```txt
ticket input
  -> spec context
  -> session director
  -> plan
  -> code draft
  -> implementation reviewer
  -> repair
  -> implementation reviewer
  -> final patch
```

`interview` 节点属于 Phase 1 范围，但可以晚于最小 run/artifact/state 契约实现。

## Package Ownership

- 领域共享类型：`packages/core`
- runtime 状态机和存储边界：`packages/runtime`
- `.specflow` 读取能力：`packages/specflow`
- agent CLI 选择和执行策略占位：`packages/agent`
- CLI 命令入口：`apps/cli`

## 参考文档

Phase 1 产品说明见 `docs/product/phases/phase-1-local-loop.md`。

完整阶段路线见 `docs/product/roadmap.md`。
