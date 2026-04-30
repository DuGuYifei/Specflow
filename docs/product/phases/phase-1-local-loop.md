# Phase 1：本地持续编码最小闭环

目标是实现第一个真正可运行的本地持续编码闭环。

核心流程是：

```txt
ticket -> spec context -> session director -> plan -> code draft -> implementation reviewer -> repair loop -> final patch
```

用户输入一个 ticket，Specflow 可以读取仓库上下文，执行基础 workflow，生成代码草稿，进行实现审查，必要时进入修复循环，最后输出 final patch 候选。`interview` 仍属于 Phase 1 的长期范围，但当前 placeholder run 先跳过它。

## 范围

- CLI 触发本地 workflow
- 读取 ticket
- 读取 `.specflow` 仓库级上下文
- session module 和 mock Session Director
- 结构化 workflow definition
- interview 节点
- plan 节点
- code draft 节点
- implementation reviewer 节点
- repair 节点
- final patch 节点
- 本地 workflow run 状态记录
- 本地 artifact 记录
- 节点 agent CLI 选择和 session 归属记录
- 基础日志记录

## 终止条件

- reviewer 通过
- 达到最大修复次数
- 用户主动停止
- 出现不可恢复错误

## 非目标

- 团队协作
- hosted server workflow 编排
- 高级 UI 图编辑
- 自动更新 `.specflow`
- 多 agent 编排

## Session Module

Phase 1 已把 session 作为 workflow run 的状态之一。节点可以声明不进入 session、复用同组 session、每次开启新 session，或由 Session Director 产出的 control decision 决定。

Workflow definition 现在包含 `sessionGroups`，用于声明 Direction、Implementation、Review 等可展示的 session plan。节点通过 `session.groupId` 加入这些组，UI 可以在 run 开始前就展示哪些节点预期共用 session。

当前 Session Director 是 deterministic mock：它通过 `control_scope` 管理 plan、code draft、implementation reviewer、repair loop 和 final patch，并产出 `control-decision` artifact。未来真实 AI 可以替换这一步，但 run state 和 UI 展示不需要改变。

Implementation reviewer 也进入同一 control model：它通过 `control_scope` 管理 repair loop 和 final patch，并在每次 review 后写入 `review` control decision。这样 reviewer、verifier、manager 这类节点未来可以用同一种 UI 和 run state 表达“我管理哪些节点、我做了什么决策”。

UI Inspector 会展开 control decision 细节。Session Director 的 decision 会显示每个目标节点是新开 session 还是复用 session；reviewer 的 decision 会显示它路由到 repair loop 还是 final patch。

Session Director 的 mock session decision 来自 workflow definition，而不是来自 Phase 1 节点 id 硬编码。它根据 managed node 顺序、session group、session mode 和 `newSessionOnLoop` 判断新开或复用 session。

创建 run 失败时，UI 会读取本地 server 的 `error` 和 validation `issues`，避免只显示 HTTP 状态码。这个边界对后续 workflow definition 编辑器很重要。

本地 UI 可以设置 mock review mode 和 repair attempt 上限，用来观察 pass、fail-once、always-fail 三种 placeholder review/repair 路径。这些是单次 run 的调试选项，不写入 workflow definition。

UI 和 CLI 的 run 列表显示每次 run 绑定的 workflow、review 次数、repair 次数和最新 review 状态，便于比较不同 mock run options 下的执行路径。

## Workflow Definition

Phase 1 的当前结构化定义位于 `.specflow/workflows/phase-1-local-loop.workflow.json`。它记录节点、边、session policy 和 control scope，供 CLI 校验，并作为后续 UI 配置编辑和 runtime 配置驱动执行的边界。

Agent-mode 节点可以在 definition 中声明 `agentCli`。当前 Phase 1 definition 显式使用 mock `codex`，未来可以在同一字段上配置 `claude` 或自定义 CLI；真实 agent 启动仍不是本阶段目标。

本地 server 通过 `/api/workflows` 暴露这些定义、校验结果、当前 runtime 可执行性结果和 execution preview。UI draft graph 优先从该 API 构建，并在 definition 对当前 placeholder runtime 不可执行时提前标记 blocked。

Execution preview 是 definition 到可视化工作台之间的稳定派生层。它把节点执行模式、agent CLI、session policy、controller、control scope 摘要和反向 managed-by 关系交给 UI 展示，后续图编辑器可以继续复用这个边界。

创建 run 时，UI 会把选中的 `workflowDefinitionId` 传给本地 server。run state 会记录实际绑定的 definition reference，包含来源和路径；当前 placeholder executor 仍要求 definition 保持 Phase 1 固定节点形状，直到 runtime 进入真正配置驱动调度。
