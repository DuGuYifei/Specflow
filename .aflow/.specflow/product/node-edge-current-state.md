# Node 与 Edge 当前实现说明

本文描述当前代码已经实现的节点、连线、资源、session 与执行行为。流程定义保存在 `.aflow/.specflow/agentflows/<workflow-id>.yaml`，画布位置单独保存在 `.aflow/.specflow/canvas/<workflow-id>.json`。

## 1. 模型分层

| 层 | 用途 | 节点 | 连线 |
| --- | --- | --- | --- |
| Canvas / AgentFlow | UI 编辑与 YAML 存储 | `step`、`gate`、`input`、`end` | `CanvasEdge` |
| Runtime Workflow | 实际执行 | `agent`、`gate` | `trigger`、`gate-input`、`tagged-output` |

转换规则：

- `step` 转为 runtime `agent`。
- `gate` 转为 runtime `gate`。
- `input` 仅声明 run 输入变量；在运行准备阶段完成文本替换后移除。
- `end` 仅用于画布终点展示；运行时移除。
- `loopback: true` 的边表示受控返修回跳，运行时保留并启动新一轮节点执行；其闭环路径必须经过 gate branch。

## 2. Canvas 节点类型

### 2.1 `step`

`step` 是会实际调用 agent 的工作节点。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `kind` | `"step"` | 类型标识 |
| `id`、`num`、`title` | `string` | 稳定 id、显示编号、标题 |
| `prompt` | `string` | 用户编写的执行 prompt；不是 description |
| `sessionId` | `string \| null` | 所用 workflow session；有效执行必须指向存在的 session |
| `images` | `{ path, label?, mimeType? }[]` | 图片上下文 |
| `paths` | `string[]` | 文件或目录上下文；支持手写相对路径或绝对路径 |
| `pauseAfterRun` | `boolean?` | 节点完成一次 agent turn 后暂停 workflow，允许人工继续与该 session 交互 |
| `locked` | `boolean?` | UI 布局/删除限制，不影响执行语义 |

运行时 `AgentNode` 主要字段：

| 字段 | 来源 |
| --- | --- |
| `promptTemplate.template` | `step.prompt` |
| `agentId` | `sessionId` 对应 session 的 `agentServerId` |
| `sessionId` | `step.sessionId` |
| `images` | 图片资源引用；支持图片块的 agent 接收 ACP 多模态 content block，否则降级为资源链接 |
| `relatedResources` | `paths` 转成的文件/目录资源引用 |
| `pauseAfterRun` | `step.pauseAfterRun`；启用时完成 turn 后进入人工暂停 |

`description` 不再承担 step 执行内容；step UI 只编辑 `prompt`。

### 2.2 `gate`

`gate` 是由前一个内容节点的 agent 做分支判断的节点，本身没有可分配的固定 session。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `kind` | `"gate"` | 类型标识 |
| `id`、`num`、`title` | `string` | 稳定 id、显示编号、标题 |
| `decisionCriteria` | `string` | 分支判断标准 |
| `branches` | `{ id, label, description? }[]` | 可选择输出分支；运行时还携带由输出边确定的遍历预算 |

约束：

- gate 必须至少包含一个 branch。
- gate 至多允许一条非 `input` 的业务输入边。
- gate 输入边不得配置 `transmit`、`outputTag` 或 `handoffPrompt`。
- gate 输入边不得标记为 `loopback`。
- gate 可在尚未连接业务输入时保存，但执行到该 gate 会失败。

Gate 执行：

1. gate 取得前一个内容 `step` 的输出。
2. 若该 step 的 agent 支持 ACP fork，系统从该 step session fork 出 `<source-session>-fork-01`、`-fork-02` 等派生 session 执行判断。
3. 若 agent 不支持 fork，判断直接在前一个 step 的 session 中执行。
4. 判断 prompt 包含 `decisionCriteria`、前序输出和 branch 列表，要求 agent 仅返回 JSON：

```json
{"branchId":"pass","reason":"short reason"}
```

5. 运行时校验 JSON 与 `branchId`，只激活选中 branch 的输出边。
6. 未选中 branch 可达而不被其他活跃路径需要的节点会被跳过，因此选中路径可以在后续 join 节点继续执行。
7. 每个 branch 的输出边默认最多选中 `1` 次；作者可用 `maxTraversals` 提升返修次数。预算耗尽的 branch 不再出现在 gate 可选列表中。

Gate 的判断输出不作为业务内容继续传播。gate 输出边的内容来源仍是 gate 前的内容 `step`。

### 2.3 `input`

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `kind` | `"input"` | 类型标识 |
| `variableName` | `string` | 输入变量名，如 `specflow_ticket` |
| `defaultValue` | `string?` | run 未覆盖时的默认值 |
| `description` | `string?` | UI 中对输入变量的说明 |
| `sessionId` | `null` | 不参与 session |

运行开始前，输入值会替换 `step.prompt` 与 `gate.decisionCriteria` 中的 `<specflow_name>` token。`input` 节点及其连线不会进入 runtime 图。

### 2.4 `end`

`end` 只标识画布结束位置，字段为显示信息和 `sessionId: null`。转换时该节点及连接它的边被移除。

## 3. Canvas Edge 字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `from`、`to` | `string` | 源和目标节点 id |
| `branch` | `string?` | 源为 gate 时选择的 branch id |
| `transmit` | `boolean?` | 是否向不同 session 的目标显式传递内容 |
| `outputTag` | `string?` | 显式传递时的名称；必须是 XML-safe tag name |
| `handoffPrompt` | `string?` | 显式传递前由来源 session 执行的可选整理 prompt |
| `loopback` | `boolean?` | 受控回跳标记；边执行后目标节点进入下一轮执行 |
| `maxTraversals` | `positive integer?` | gate 输出 branch 在一次 run 中最多可选次数；默认 `1` |

不再存在的编辑字段：

- `sameSession`：是否同 session 由实际两个内容节点的 `sessionId` 计算。
- `tag` / `prompt`：改为 `outputTag` / `handoffPrompt`。

保存和运行转换共同校验以下规则：

- `input` 只能作为控制/变量来源，`end` 只能作为终点；涉及它们的边不得带传输配置。
- 同 session 的两个内容 `step` 之间不得保留 `transmit`、`outputTag` 或 `handoffPrompt`。
- `transmit: true` 必须有 `outputTag`，未开启 `transmit` 时不得配置 `outputTag` 或 `handoffPrompt`。
- 同一目标节点不得从可同时到达的不同来源接收相同 `outputTag`；同一 gate 的互斥 branches 可复用该 tag。
- `maxTraversals` 仅可写在 gate 输出边上。
- 普通执行边不得形成有向循环；`loopback` 仅允许闭合一条经过 gate branch 的返修路径，确保循环受 branch 遍历预算约束。
- 自动布局估算可见 edge label 的宽度并扩大相邻列间距，避免传输标签或 gate 标签被节点覆盖。

## 4. 从一个节点连接到另一个节点

### 4.1 `input -> step` 或 `input -> gate`

- 用于画布表达输入变量关系。
- 运行准备时变量按 token 替换文本；该连线不进入 runtime。

### 4.2 `step(A) -> step(A)`：同 session

- Runtime 边类型：`trigger`。
- UI 不提供传输属性。
- 目标步骤在同一 conversation context 中继续执行，不额外注入前序 output token。

### 4.3 `step(A) -> step(B)`：不同 session

UI 提供两种方式：

| 配置 | Runtime 边 | 行为 |
| --- | --- | --- |
| `transmit` 关闭 | `trigger` | 仅激活目标，不传递显式内容 |
| `transmit` 开启 | `tagged-output` | 将来源输出传给目标 |

显式传递示例：

```yaml
- from: review
  to: implement
  transmit: true
  outputTag: implementation
  handoffPrompt: Summarize actionable changes.
```

目标 `prompt` 使用：

```text
Apply <specflow_implementation>.
```

执行时替换为：

```xml
Apply <implementation>...source output or handoff output...</implementation>.
```

若配置了 `handoffPrompt`，该 prompt 在来源 `step` 的 session 中执行，因为只有来源 session 持有生成输出所需的上下文。

### 4.4 `step -> gate`

- Runtime 边类型：`gate-input`。
- 无任何可编辑传输属性。
- 该边为 gate 提供前序输出和来源 session 身份，以便同 session 判断或 fork 判断。

### 4.5 `gate -> step`

先按 branch 选择是否激活，再将 gate 视为被跳过：

```text
step(A) -> gate -> selected step(B)
```

等价于对内容传递规则判断：

```text
step(A) -> selected step(B)
```

- `A` 与 `B` 相同：`trigger`，无属性。
- `A` 与 `B` 不同且不传输：`trigger`。
- `A` 与 `B` 不同且传输：`tagged-output`；内容及 handoff 都来源于 `step(A)`，不来源于 gate 判断 session。

### 4.6 `gate -> end`

仅表示该 branch 完成；runtime 不生成执行边。

## 5. Runtime 连线类型

| 类型 | 行为 |
| --- | --- |
| `trigger` | 激活下游节点，不显式携带内容 |
| `gate-input` | 将唯一前序内容输出提供给 gate 判断，并保留来源 session 身份 |
| `tagged-output` | 使用 `outputTag` 包装来源内容，并作为命名变量渲染进目标 prompt；可先执行 handoff |

Runtime `TaggedOutputEdge.outputTag` 字段：

| 字段 | 示例 |
| --- | --- |
| `identifier` | `implementation` |
| `promptReference` | `specflow_implementation` |
| `xmlTagName` | `implementation` |

## 6. 图片与路径资源

### 图片

- Step 面板允许选择图片文件，也允许将剪贴板图片直接粘贴进面板。
- 服务端将图片复制到 `.aflow/.specflow/assets/<workflow-id>/images/`，节点保存稳定相对路径和 MIME type。
- 执行时优先将图片作为 ACP image content block 发送；agent 未声明二进制 prompt 支持时降级为资源链接，而不是将二进制内容拼入 prompt 文本。

### 路径

- Step 面板允许手写路径；手写内容可为项目相对路径或全局绝对路径。
- 也可选择文件或文件夹；选择的浏览器文件会复制到 `.aflow/.specflow/assets/<workflow-id>/resources/`。
- 文件夹导入保留文件夹内相对目录结构，节点引用导入后的资源目录。

## 7. ACP Session 与运行记录

- 在一次 workflow run 创建的 session pool 内，对同一有效 agent 配置和工作目录只维护一个 ACP process/connection；该 pool 在 run 结束时关闭。
- 一个 ACP connection 可以承载多个 workflow session。
- Gate fork 成功时，运行记录保存派生 `specflowSessionId`、`parentSpecflowSessionId`、实际 ACP session id 与 fork capability。
- Gate 不支持 fork 时，运行记录使用父 session，不制造虚假的 fork session。
- UI 的 Agent sessions 历史面板展示 `load`、`resume`、`fork` 能力，并为 fork 记录展示父 session。

## 8. Inspect、Resume 与人工暂停

### 历史 session 操作

- `Inspect` 使用 ACP `load`（不可用时按 capability fallback）读取历史 session，并在独立只读 conversation 窗口展示 ACP 回放。
- `Resume` 使用 ACP `resume`（不可用时 fallback），在独立 conversation 窗口保持恢复后的连接，用户可以发送后续 prompt。
- `Resume` 后续 prompt 引发的 ACP permission 或 elicitation 会复用 UI 确认流程；关闭窗口会取消仍在等待答复的请求。
- `Inspect`/`Resume` 的 ACP 回放和后续会话内容不写入运行时 `Logs` 页签；`Logs` 仅展示 workflow run 自身保存的 terminal 输出。
- 关闭 conversation 窗口会取消未完成的恢复，或关闭已恢复并可交互的 Resume session。

### Step 人工暂停

- 普通 `step` 可配置 `pauseAfterRun: true`；`gate`、`input` 和 `end` 不支持此选项。
- 节点完成首个 agent turn 后，run 状态为 `paused`，执行器保留同一次 run 的 ACP connection 与原 workflow session。
- 暂停期间，只有暂停节点所属 session 的 `Logs` 页签会显示 prompt 输入口；发送内容会继续作用于该 session。
- 用户点击暂停节点卡片上的 `Continue` 后，输入口关闭，workflow 继续执行；若人工发送过 prompt，最后一次回复成为该节点用于后续显式内容传递的输出。
- Prompt/Continue API 不接受客户端指定 ACP session，而是只根据服务端登记的活动 `(runId, nodeId)` 暂停令牌路由请求；运行结束或继续后令牌立即失效。
- Headless agent 没有可继续交互的 ACP session，因此服务端拒绝为其启动启用了 `pauseAfterRun` 的 run。
- 当前 ACP 尚未提供可供此流程直接使用的 ask-human tool；UI 说明人工暂停是过渡方案，待 Agent Client Protocol Elicitation RFD 合并后增加原生能力。

## 9. 当前限制

- 受控 `loopback` 已可执行；当前循环策略以 branch 的固定 `maxTraversals` 为上限，不提供运行中人工扩充返修轮次。
- Gate 未选中路径会正确停止执行，但运行记录/UI 尚未将这些节点标为独立的 `skipped` 状态，仍可能显示初始 `pending`。
- ACP process/connection 目前不跨独立 run 长期复用。
- 资源选择通过浏览器上传副本实现；手动路径引用才会直接指向已有全局或项目路径。
