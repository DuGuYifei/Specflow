# Phase 1 Workflow 状态

Phase 1 当前状态：已开始实现。

当前目标：实现本地持续编码最小闭环，但按可交付切片逐步推进。

当前已实现切片：最小 workflow run、artifact、execution state 的本地类型和 `.specflow/runs/` 文件存储边界；CLI 可以创建、列出和查看本地 placeholder workflow run。

## 当前边界

- CLI 是当前唯一真实应用入口。
- `packages/runtime` 负责 workflow graph、状态机、执行占位、run state 和 artifact 边界。
- `packages/specflow` 只负责通用 `.specflow` 读写和仓库知识层能力。
- `packages/agent` 只保留 agent runner、执行策略和 agent CLI 选择的边界。
- 不集成真实 Codex 调用。
- 不实现生产级 orchestration。
- 不添加数据库、认证或 CI workflow。
- 不创建复杂 UI 或桌面壳。
- 本地运行记录写入 `.specflow/runs/`，该目录不提交入库。

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
- 不连接 UI。

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

## 当前默认 Workflow 节点

最小 Phase 1 workflow 节点顺序：

```txt
ticket input
  -> spec context
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
