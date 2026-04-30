# 当前架构事实

Specflow 是 TypeScript monorepo，使用 pnpm workspaces 和 Turbo。

CLI 位于 `apps/cli`，是当前唯一真实应用入口。

核心领域类型位于 `packages/core`。

workflow engine、状态机、调度和执行占位位于 `packages/runtime`。

workflow session、节点 session 策略、director control decision 和 `control_scope` 管理边属于核心领域模型，由 `packages/core` 定义，由 `packages/runtime` 写入 run state。

节点级 agent CLI 选择属于 workflow definition。`WorkflowNode.agentCli` 记录节点偏好的 CLI 命令和参数；runtime 只在 agent-mode 节点执行时使用它，未声明时使用当前默认 mock `codex`。

定义级 `sessionGroups` 是 session module 的目录。节点仍通过 `session.groupId` 加入某个 group；runtime 创建 run 时会保存 session group plan，缺省时从节点 policy 推导。

Reviewer、director、manager 和 verifier 都可以通过 `control_scope` 管理其他节点，并通过 `WorkflowControlDecision` 写入可观察决策。当前 `implementation-review` 已作为 reviewer/control 节点管理 `repair-loop` 和 `final-patch`。

`.specflow` 读写、schema 和仓库知识层工具位于 `packages/specflow`。

agent runner、工具调用和执行策略占位位于 `packages/agent`。

本地 server / IPC 适配层占位位于 `packages/server`。

React 节点式 workflow 面板组件位于 `packages/ui`。

当前 UI 必须能显示节点角色、agent CLI、session 归属、Session Director 的管理范围和控制决策。

本地 server 暴露 `/api/workflows`，用于给 UI 提供结构化 workflow definition、validation result、当前 runtime compatibility result 和 execution preview。UI draft graph 应优先使用该 API 返回的 definition，并在不可执行时提前阻止创建 run。

Execution preview 由 `packages/runtime` 从 workflow definition 派生，包含节点执行模式、agent CLI、session policy、controller 和 control scope 摘要。Server 不应重新推导，UI 不应复制 runtime 规则。

本地 server 创建 run 时可以接收 `workflowDefinitionId`。`WorkflowRun` 必须记录实际绑定的 workflow definition id、name、source、version 和 path，便于之后复现、审计和 UI 展示。

`.specflow` 是仓库级知识层，记录当前项目目的、架构事实、工程约定、术语和 workflow 意图。

`.specflow/workflows/*.workflow.json` 是结构化 workflow definition。当前 runtime 创建 run 时可以绑定仓库或内置 definition；placeholder executor 仍只保证当前 Phase 1 节点形状可执行，后续配置驱动执行应沿用这个边界继续扩展。

本地 placeholder graph 可执行性检查由 `packages/runtime` 负责，server 只能调用 runtime 暴露的 compatibility helper，不应复制 executor 必需节点清单。

当前不包含数据库、认证、CI workflow、真实 Codex 集成、生产级 workflow 编排、桌面壳或传统前后端分离架构。
