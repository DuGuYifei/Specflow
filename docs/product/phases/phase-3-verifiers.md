# Phase 3：多 verifier 和多产物类型扩展

目标是让 Specflow 不只处理代码实现审查，还能处理不同产物类型的审查和验证。

## 范围

- 多种 reviewer/verifier 节点
- 按 artifact 类型选择 verifier
- Visual Decomposer
- Visual Verifier
- Spec Consistency Checker
- Execution Verifier
- lint/typecheck/test/build verifier
- 可配置 verifier 链路

## 节点类型

Implementation Reviewer 审查代码实现草稿。

Visual Decomposer 把截图、设计稿、UI 图片拆解成结构化 UI 要求。

Visual Verifier 审查视觉拆解结果。

Spec Consistency Checker 检查生成结果是否和 `.specflow` 中的仓库级知识冲突。

Execution Verifier 执行本地验证命令，例如 lint、typecheck、test、build。

## 非目标

- 自动重写 workflow
- 未经确认自动更新 `.specflow`
- 完全自治的长期学习系统
