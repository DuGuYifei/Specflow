# TODO

本文只保留当前 goal 的验收结果和仍需执行的工作。已经完成的历史 ACP roadmap 不再作为待办重复维护；当前 node/edge 行为详见 `.specflow/product/node-edge-current-state.md`。

## Current Goal Acceptance Checklist

核对日期：2026-05-24。已勾选项目已由实现与测试确认。

### Node And Prompt Model

- [x] `step` 的用户编辑内容使用 `prompt`；`promptTemplate` 仅为 runtime 内部模型。
- [x] 删除 step 的 spec 文档更新开关及对应 runtime 字段。
- [x] 图片与路径资源作为 step 上下文分别配置，图片按 agent capability 发送 ACP image block 或资源链接 fallback。
- [x] 手写路径支持项目相对路径和全局绝对路径；选择的文件/目录可导入 workspace assets。

### Edge Transfer Semantics

- [x] 同 session 内容边仅为触发关系，不暴露或接受显式传输属性。
- [x] 不同 session 边可选择不传内容，或以 `outputTag` 显式注入来源输出。
- [x] `handoffPrompt` 在来源 step 的 session 中执行后再传给目标 step。
- [x] `input`/`end` 控制边、gate 输入边及显示型 `loopback` 不接受传输属性。
- [x] 拒绝非法 XML tag、缺少 `outputTag` 的传输、可同时到达目标的重复 tag 和未标记执行循环。

### Gate And Session Semantics

- [x] Gate 没有独立固定 session，判断使用前序内容 step 的上下文。
- [x] Agent 支持 fork 时 gate 判断 fork 前序 session；不支持时复用前序 session。
- [x] Gate 仅允许一个业务输入且至少一个 branch；输出边按跳过 gate 后的内容节点关系判定传输。
- [x] 未选中的 gate 路径会失活，选中路径可穿过后续 join 节点继续执行。
- [x] 单次 run 内，同一有效 ACP agent 配置复用一个 connection 并承载多个 workflow session。

### UI And Review Corrections

- [x] 编辑或删除 session 后自动清除已变成非法的边传输配置。
- [x] UI 阻止删除最后一个 workflow session、最后一个 gate branch、第二条 gate 业务输入和普通执行循环。
- [x] UI 展示 gate fork 的父 session 与 ACP capability 信息。
- [x] Server 与 converter 对上述约束进行防御性校验，避免手写 YAML 绕过 UI。

## Open Work

- [ ] 实现 `loopback` 的有界循环/返工执行语义；当前仅用于画布显示。
- [ ] 为 gate 未选中路径增加明确的 `skipped` 运行状态并在 UI 展示。
- [ ] 决定是否需要跨独立 run 复用 ACP connection；当前复用范围仅为单次 run。
- [ ] 实现 spec 文档生成、更新及 flow 完成后的自动更新。
- [ ] 解决偶发的 `[Bun.serve]: request timed out after 10 seconds`，并确定合理的 `idleTimeout` 策略。
- [ ] 定义 workspace `.specflow` 与用户级/全局 agent 安装配置的归属边界。
- [ ] 改进执行中才触发 auth 请求时的重试与 UI 流程。
