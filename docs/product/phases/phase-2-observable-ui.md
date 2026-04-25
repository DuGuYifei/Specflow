# Phase 2：可观察的 workflow graph UI

目标是把本地 workflow 从命令行过程变成一个可观察、可理解、可检查的节点图。

UI 是本地 runtime 的可视化面板，不是独立 Web 产品。

## 范围

- 本地 runtime 暴露 workflow run 状态
- UI 显示真实 workflow run
- React Flow 图展示真实节点状态
- 节点状态可以更新
- 用户可以查看节点输入、输出、artifact、日志
- 用户可以看到 control flow、data flow、review loop
- 用户可以重跑部分安全节点
- 本地持久化 workflow run 记录

## UI 原则

节点图不是装饰，而是 Specflow runtime 的可视化表达。

用户应该能看懂当前运行到哪一步、每一步输入是什么、每一步输出是什么、哪一步失败了、为什么 reviewer 不通过、repair 做了什么、final patch 是如何得到的。

## 非目标

- 复杂 workflow 编辑器
- 团队权限
- 自动 workflow 进化
- marketplace
