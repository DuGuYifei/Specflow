# Node 与 Edge 当前实现说明

本文描述当前代码已经实现的节点、连线、资源、session 与执行行为。流程定义保存在 `.specflow/agentflows/<workflow-id>.yaml`，画布位置单独保存在 `.specflow/canvas/<workflow-id>.json`。

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
- `loopback: true` 的边目前只保留为画布表达，运行时移除，尚不执行循环。

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
| `locked` | `boolean?` | UI 布局/删除限制，不影响执行语义 |

运行时 `AgentNode` 主要字段：

| 字段 | 来源 |
| --- | --- |
| `promptTemplate.template` | `step.prompt` |
| `agentId` | `sessionId` 对应 session 的 `agentServerId` |
| `sessionId` | `step.sessionId` |
| `images` | 图片资源引用，以 ACP 多模态 content block 发送 |
| `relatedResources` | `paths` 转成的文件/目录资源引用 |

`description` 不再承担 step 执行内容；step UI 只编辑 `prompt`。

### 2.2 `gate`

`gate` 是由前一个内容节点的 agent 做分支判断的节点，本身没有可分配的固定 session。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `kind` | `"gate"` | 类型标识 |
| `id`、`num`、`title` | `string` | 稳定 id、显示编号、标题 |
| `decisionCriteria` | `string` | 分支判断标准 |
| `branches` | `{ id, label, description? }[]` | 可选择输出分支 |

约束：

- gate 至多允许一条非 `input` 的业务输入边。
- gate 输入边不得配置 `transmit`、`outputTag` 或 `handoffPrompt`。
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
| `loopback` | `boolean?` | 回退线显示标记；当前不执行 |

不再存在的编辑字段：

- `sameSession`：是否同 session 由实际两个内容节点的 `sessionId` 计算。
- `tag` / `prompt`：改为 `outputTag` / `handoffPrompt`。

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
- 服务端将图片复制到 `.specflow/assets/<workflow-id>/images/`，节点保存稳定相对路径和 MIME type。
- 执行时图片作为 ACP image content block 发送给 agent，而不是作为 prompt token。

### 路径

- Step 面板允许手写路径；手写内容可为项目相对路径或全局绝对路径。
- 也可选择文件或文件夹；选择的浏览器文件会复制到 `.specflow/assets/<workflow-id>/resources/`。
- 文件夹导入保留文件夹内相对目录结构，节点引用导入后的资源目录。

## 7. ACP Session 与运行记录

- 对同一有效 agent 配置和工作目录，运行中的 session pool 只维护一个 ACP process/connection。
- 一个 ACP connection 可以承载多个 workflow session。
- Gate fork 成功时，运行记录保存派生 `specflowSessionId`、`parentSpecflowSessionId`、实际 ACP session id 与 fork capability。
- Gate 不支持 fork 时，运行记录使用父 session，不制造虚假的 fork session。
- UI 的 Agent sessions 历史面板展示 `load`、`resume`、`fork` 能力，并为 fork 记录展示父 session。

## 8. 当前限制

- `loopback` 仍是画布层字段，运行执行器不会循环回退。
- 资源选择通过浏览器上传副本实现；手动路径引用才会直接指向已有全局或项目路径。
