# Phase 1：本地持续编码最小闭环

目标是实现第一个真正可运行的本地持续编码闭环。

核心流程是：

```txt
ticket -> spec context -> interview -> plan -> code draft -> implementation reviewer -> repair loop -> final patch
```

用户输入一个 ticket，Specflow 可以读取仓库上下文，执行基础 workflow，生成代码草稿，进行实现审查，必要时进入修复循环，最后输出 final patch 候选。

## 范围

- CLI 触发本地 workflow
- 读取 ticket
- 读取 `.specflow` 仓库级上下文
- interview 节点
- plan 节点
- code draft 节点
- implementation reviewer 节点
- repair 节点
- final patch 节点
- 本地 workflow run 状态记录
- 本地 artifact 记录
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
