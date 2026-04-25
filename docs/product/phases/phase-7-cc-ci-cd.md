# Phase 7：CC-CI-CD 集成

目标是把 Specflow 的持续编码结果和现有 CI/CD 系统连接起来。

Specflow 仍然是 CC 层，不变成 CI/CD 工具。

## 范围

- final patch 输出到 branch
- 生成 PR
- PR 附带 workflow run summary
- 把 verifier 结果关联到 CI 预期
- 在 PR 前执行本地验证
- 可选 GitHub/GitLab 集成
- 可选 PR comment 生成
- 可选读取 CI 状态

## 定位

CI 检查提交后的代码是否破坏规则。

Specflow 在代码提交前帮助生成、审查、修复代码。

## 非目标

- 替代 CI
- 替代部署工具
- 变成通用 DevOps 平台
