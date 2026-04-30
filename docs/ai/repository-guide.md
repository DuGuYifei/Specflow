# AI 仓库阅读指南

这份文档写给在 Specflow 仓库中工作的 AI agent。

## 先读哪里

- 项目是什么、怎么运行：`README.md`
- 产品定位和功能理解：`docs/product/vision.md`
- 阶段路线总览：`docs/product/roadmap.md`
- 各阶段细节：`docs/product/phases/`
- 架构说明：`docs/architecture/overview.md`
- 当前项目知识：`.specflow/project.md`
- 当前架构事实：`.specflow/architecture.md`
- 当前工程约定：`.specflow/conventions.md`
- 当前术语：`.specflow/glossary.md`

## 代码位置

- CLI 入口：`apps/cli/src`
- 核心领域类型：`packages/core/src`
- workflow runtime：`packages/runtime/src`
- `.specflow` 读写工具：`packages/specflow/src`
- agent 抽象：`packages/agent/src`
- 本地 server / IPC 适配层：`packages/server/src`
- React workflow 面板：`packages/ui/src`

## `docs` 与 `.specflow` 的边界

`.specflow` 写当前应该被系统和 AI 遵守的事实与规则。

`docs` 写解释、背景、原因、路线和 onboarding。

如果一个信息是当前必须遵守的规则，放 `.specflow`。如果一个信息是为什么这么做，放 `docs`。如果两个地方都要提，`.specflow` 只简短记录事实，`docs` 负责解释背景。

## 工具链规则

使用 mise 管理本地 Node.js 和 pnpm。工具链版本从 `.mise.toml` 读取。

不要修改工具链版本，除非用户明确要求。如果版本需要变化，应该用独立提交或独立 PR 处理。

shell 激活 mise 后，直接运行 `pnpm ...`。不要在普通文档中要求用户使用 `mise exec -- pnpm ...`。

依赖版本由 `pnpm-lock.yaml` 锁定。这个 lockfile 是确定性执行契约的一部分。

## 当前边界

- Phase 0 仓库基础已经收尾，后续工作从 Phase 1 本地最小闭环开始。
- 当前代码已经具备 Phase 1 的本地 placeholder workflow run 能力：`packages/runtime` 包含 graph contract、validation helper、文件存储、artifact 记录、session module、mock Session Director 和占位执行。
- 当前仓库已有结构化 workflow definition：`.specflow/workflows/phase-1-local-loop.workflow.json`。修改 workflow 节点、边、session policy 或 control scope 时，应同步更新它。
- CLI 目前支持静态 graph validation，可以创建、列出和查看本地 Phase 1 placeholder workflow run，也可以通过 `specflow ui` 启动本地可视化面板。
- Phase 1 已开始实现 artifact 记录、agent CLI 选择建模、session 归属、director control decision 和 placeholder repair loop；当前仍不调用真实 agent。
- 不实现真实 agent。
- 不集成真实 Codex 调用。
- 不实现生产级 workflow 编排。
- 不添加数据库。
- 不添加认证。
- 不添加 CI workflow。
- 不创建桌面壳。
- UI 保持本地组件包，不作为独立 Web 产品；当前由 `specflow ui` 启动的本地 server 托管。
- Server 保持本地适配层，不作为独立后端产品。

## 修改规则

优先写可读 TypeScript，不要过早抽象。

共享领域语言放在 `packages/core`。workflow engine 和 runtime 契约放在 `packages/runtime`。读取 `.specflow` 的逻辑放在 `packages/specflow`。

CLI 输出应该可预测。Server 只表达本地适配边界。UI 应该让 workflow graph 概念可见，避免过早引入复杂状态。

Session、director、manager、reviewer 和 verifier 属于领域模型。新增这类能力时，应同时更新 `packages/core`、runtime run state、UI 展示，以及 `.specflow` 当前事实。

Reviewer、director、manager 和 verifier 节点应优先使用 `control_scope` + `WorkflowControlDecision` 表达管理关系和决策结果。不要为每一种控制角色另起一套互不兼容的状态模型。

`.specflow/workflows/*.workflow.json` 是程序读取的结构化事实，`.specflow/workflows/*.md` 是状态说明。不要只改 Markdown 而遗漏 JSON definition。

节点 agent CLI 配置也属于结构化事实。新增或修改节点级 CLI 选择时，要同步 `WorkflowNode.agentCli` 类型、runtime node execution 初始化、UI 展示和 `.workflow.json`。

Session group 也属于结构化事实。新增或修改节点 session policy 时，优先同步 `WorkflowDefinition.sessionGroups`，让 UI 可以展示稳定的 Session Plan。

UI draft graph 通过 server 的 `/api/workflows` 获取 workflow definition。调整 workflow definition 展示时，优先保持这个 API 边界稳定。

创建 run 时，UI/server 应传递并记录 `workflowDefinitionId`。修改 run state 时，不要丢失 `workflowDefinition` reference；它是复现某次 workflow 的最小来源信息。

文档修改时，避免把同一段长解释复制到多个文件。`.specflow` 记录事实，`docs` 解释原因。
