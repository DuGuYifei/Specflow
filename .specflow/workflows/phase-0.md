# 当前 workflow 意图

当前静态 workflow 意图是：

```txt
ticket -> interview -> plan -> code draft -> implementation review -> repair loop -> final patch
```

这是当前仓库用于 CLI、UI 静态面板和 AI 阅读的 workflow 意图，不是完整 workflow runtime。

完整产品阶段路线见 `docs/product/roadmap.md`。本文件只记录当前应被遵守的 workflow 事实。

当前边语义：

- control flow：执行顺序
- data flow：artifact 或上下文移动
- review loop：reviewer/verifier 反馈循环

当前不执行真实 agent，不编排真实 workflow，不连接本地 UI 与 runtime。
