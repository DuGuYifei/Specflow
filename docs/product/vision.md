# Specflow 产品理解

## 一句话定义

Specflow 是一个本地优先的持续编码平台。

它把一个 ticket 转化为一个可观察、可验证、可修复的实现图，在代码进入 CI/CD 之前，持续完成理解、计划、生成、审查和修复。

最终目标是尽可能减少用户对代码部分的直接参与度，让用户主要参与意图确认、关键取舍和结果审查。

## 产品定位

传统软件开发流程通常是：

```txt
开发者写代码 -> CI 检查 -> CD 发布
```

很多错误在 coding 阶段产生，却要到 CI 阶段才被系统性发现。Specflow 的目标是在 CI 之前增加一个持续编码层：

```txt
CC -> CI -> CD
```

CC 负责理解 ticket、读取项目规范、规划实现方案、生成代码草稿、审查代码草稿、自动修复问题，并输出 final patch。

Specflow 不替代 CI/CD，而是让代码在进入 CI 前更接近正确状态。

## 核心理念

Specflow 不是普通 AI coding wrapper。

它的核心不是让 AI 一次性写代码，而是让 AI 的编码过程变成一个可观察、可控制、可验证、可改进的 workflow graph。

Specflow 关注的是编码过程如何在本地被系统性收敛。

## 核心对象

Ticket 是一次 workflow run 的起点，可以来自用户输入、issue、产品需求、bug 描述、refactor 任务或 UI 实现任务。

Spec 是仓库级知识，不是 ticket 级文档。Specflow 当前把这类知识放在 `.specflow` 目录下，让 AI 不只理解当前 ticket，也理解当前仓库。

Workflow 是把 ticket 转化为实现结果的结构化流程。它不是简单线性步骤，而是由节点和边组成的图。

Node 是 workflow 中的一个可观察步骤，例如 Ticket Input、Spec Context、Interview、Plan、Code Draft、Implementation Reviewer、Repair、Final Patch、Visual Decomposer、Visual Verifier。

Edge 表示节点之间的关系。Specflow 至少有三类边：`control_flow` 表示执行顺序，`data_flow` 表示数据、上下文或 artifact 的流向，`review_loop` 表示审查失败后的修复循环。

## 基础 workflow

长期基础流程是：

```txt
ticket input
  -> spec context
  -> interview
  -> plan
  -> code draft
  -> implementation reviewer
  -> repair
  -> implementation reviewer
  -> final patch
```

这个流程表达了 Specflow 的核心判断：不是拿到 ticket 就直接写代码，而是先读取仓库知识，再澄清需求、制定计划、生成代码草稿、审查草稿、修复问题，最后输出 final patch。

## Reviewer 和 Verifier

Reviewer 和 Verifier 是 Specflow 的核心节点类型。它们检查某个 artifact 是否足够好，是否可以进入下一步。

Implementation Reviewer 审查代码实现草稿。它不是传统 PR code review，而是检查 AI 生成的第一版实现是否满足 ticket、符合 plan、遵守 `.specflow` 约定、遗漏关键边界条件，以及是否需要进入 repair loop。

Visual Decomposer 处理图片、截图、设计稿和 UI mock，把视觉输入拆解为结构化 UI 信息。

Visual Verifier 审查 Visual Decomposer 的输出，检查是否遗漏重要视觉元素、组件层级是否合理、布局关系是否准确、是否保留关键状态和交互。

Spec Consistency Checker 检查产物是否和 `.specflow` 中的仓库知识冲突。

Execution Verifier 执行本地验证命令，例如 lint、typecheck、test、build。它更接近传统自动化检查，但在 Specflow 中属于 workflow graph 的一个可观察节点。

## Repair Loop

Repair Loop 是 Specflow 区别于普通 AI coding 工具的核心能力之一。

普通 AI coding 工具经常是：

```txt
用户提需求 -> AI 生成代码 -> 用户自己检查
```

Specflow 的模式是：

```txt
生成代码 -> 审查 -> 修复 -> 再审查 -> 输出
```

Repair Loop 的价值是让代码生成过程持续收敛，而不是一次性输出。

## `.specflow` 与 `docs`

`.specflow` 是仓库级长期知识层。它记录当前仓库应该被系统和 AI 遵守的事实与规则。

`docs` 是给人看的解释文档层。它记录产品愿景、架构说明、设计背景、技术选型原因、ADR 和 AI 阅读路径。

边界是：

```txt
.specflow 写当前应遵守什么。
docs 写为什么这么设计、如何理解、历史上怎么决定。
```

## 产品边界

Specflow 不应该做成普通聊天机器人、单纯 AI code generator、CI 替代品、issue tracker 替代品、项目管理软件、传统前后端分离 Web 产品或黑盒自动改代码系统。

Specflow 应该是本地持续编码 workflow 系统，关注代码生成过程是否可观察、可审查、可修复、可沉淀、可进化。

## MVP 判断

Specflow 的第一个真正 MVP 不需要很多功能，但必须证明：

```txt
一个 ticket 可以通过结构化 workflow 变成一个被审查和修复过的 final patch。
```

如果只能生成代码但不能审查和修复，就不是 Specflow。如果只能画图但不能表达真实 workflow，也不是 Specflow。如果只能聊天但不能沉淀 `.specflow`，也不是 Specflow。
