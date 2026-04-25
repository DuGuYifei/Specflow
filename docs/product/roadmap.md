# Specflow 阶段路线

Specflow 的阶段路线从本地优先的持续编码 runtime 出发，逐步扩展到可观察 UI、更多 verifier、`.specflow` 知识进化、团队协作和 CC-CI-CD 集成。

完整阶段说明拆分在 `docs/product/phases/`。

## 阶段总览

| 阶段    | 名称                 | 主要产出                              |
| ------- | -------------------- | ------------------------------------- |
| Phase 0 | 仓库基础             | local-first/package-first 工程骨架    |
| Phase 1 | 本地最小闭环         | ticket 到 final patch 的本地 workflow |
| Phase 2 | 可观察图形界面       | 真实 workflow run 的节点图展示        |
| Phase 3 | 多 verifier 扩展     | 多产物、多审查节点                    |
| Phase 4 | `.specflow` 知识进化 | 仓库级长期知识可学习、可审查          |
| Phase 5 | workflow 进化        | agent 辅助改进 workflow 本身          |
| Phase 6 | 团队协作             | 团队级 workflow 和知识治理            |
| Phase 7 | CC-CI-CD 集成        | 连接 PR 和 CI/CD                      |
| Phase 8 | 平台生态             | 可扩展 workflow 平台                  |

## 阅读顺序

- `docs/product/phases/phase-0-foundation.md`
- `docs/product/phases/phase-1-local-loop.md`
- `docs/product/phases/phase-2-observable-ui.md`
- `docs/product/phases/phase-3-verifiers.md`
- `docs/product/phases/phase-4-specflow-knowledge.md`
- `docs/product/phases/phase-5-workflow-evolution.md`
- `docs/product/phases/phase-6-team-collaboration.md`
- `docs/product/phases/phase-7-cc-ci-cd.md`
- `docs/product/phases/phase-8-ecosystem.md`
