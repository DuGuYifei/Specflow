# Phase 5：Agent 辅助 workflow 进化

目标是让 Specflow 不只是运行 workflow，还能帮助改进 workflow 本身。

## 范围

- agent 分析失败的 workflow run
- agent 发现薄弱节点
- agent 发现缺失 verifier
- agent 发现 prompt 或节点职责不清
- agent 提出新增节点
- agent 提出修改边关系
- agent 提出更好的 interview 触发条件
- 用户可以接受、拒绝或编辑这些建议

## 示例

agent 可以建议在 plan 后增加 plan reviewer，把过大的 code draft 节点拆成多个小节点，在 UI 任务中增加 Visual Verifier，在 final patch 前增加 Spec Consistency Checker，或对高不确定性 ticket 自动触发 interview。

## 非目标

- 自动无审查地改变 workflow
- 让 agent 黑盒决定流程
- 替代团队对开发流程的治理
