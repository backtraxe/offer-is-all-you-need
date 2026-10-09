# Codex 源码分析：工程化上限的「安全纵深」路线

> 本篇面向已读过 [Pi Agent 源码分析](./pi-agent源码分析.md) 和
> [DeepSeek Harness 分析](./deepseek-harness分析.md) 的读者：你看过了
> 「极简到 949 行」（pi）和「一切皆插件」（dsh），现在看第三极——
> OpenAI 官方的 [Codex](https://github.com/openai/codex)：一个用 **Rust**
> 写的 coding agent。它的关键词不是「极简」也不是「插件化」，而是
> **安全纵深**：审批策略、execpolicy 规则引擎、平台沙箱
> （Seatbelt/Landlock）层层设防，是三者中唯一把「agent 别搞坏我的电脑」
> 当一等公民来设计的。
> 读完你会获得：codex-rs 的 crate 地图、run_turn 采样循环剖析、
> 审批+沙箱双闸机制，以及 pi/dsh/codex 三方对比的总表。

## 〇、为什么是 Codex：三条路线补齐

| | pi（TypeScript） | dsh（TypeScript） | codex（**Rust**） |
|---|---|---|---|
| 路线 | 极简约定 | 元框架插件树 | 工程纵深，安全第一 |
| 语言/形态 | TS，npm 单包 | TS，pnpm monorepo | Rust，Cargo workspace（100+ crate）+ Bazel |
| 扩展机制 | 7 个钩子 + TS 扩展 | 一切皆插件，YAML patch | 编译期组合，hook/MCP/execpolicy 规则 |
| 安全模型 | 无内置，靠容器化 | 审批 waterfall + 沙箱 seam | 审批策略 × execpolicy 规则 × 平台沙箱三层 |
| 上下文管理 | compaction entry | compaction seam（可换 provider） | auto-compact + remote compaction（服务端） |
| 会话 | JSONL 树（uuid/parent） | 版本化 JSONL（.zstd，链式迁移） | rollout JSONL + SQLite state |
| 多入口 | TUI/print/RPC/SDK | web/headless/sdk/acp/desktop | TUI/app-server/SDK/cloud tasks |

一句话：**pi 给出复杂度地板，dsh 给出解耦天花板，codex 给出
「交付给百万用户用」的工程参照系。**

## 一、crate 地图：一个 Cargo workspace 里的分层

`codex-rs/` 下有 100+ 个 crate，面试要讲清的只有六个族：

```text
core/          大脑：Session、run_turn 循环、工具调度、compact、安全判断
  ├─ session/turn.rs      采样循环本体（3209 行）
  ├─ session/turn_context.rs  每轮配置快照（1485 行）
  ├─ tasks/               task 抽象：regular / review / compact / user-shell
  └─ tools/               router（路由）+ orchestrator（编排）+ spec_plan（spec 组装）
protocol/      协议族：EventMsg、ResponseItem、审批与沙箱的类型定义
apply-patch/   自研补丁 DSL 的解析器与执行器（V4A 格式）
sandboxing/    平台沙箱：seatbelt（macOS）/ landlock（Linux）/ 策略变换
execpolicy/    命令规则引擎（starlark 风格 .policy 文件）
rollout/ + state/   会话持久化：rollout JSONL 记录器 + SQLite 状态库
tui/ + app-server*/ 终端 UI 与 JSON-RPC 服务（IDE/桌面端的对接口）
```

与 dsh 对照看很有意思：dsh 把「包 = 插件」做进了运行时语义；
codex 的 crate 边界只是**编译期的**——扩展走 execpolicy 规则文件、
hooks、MCP，而不是热插拔插件。

## 二、run_turn：采样循环剖析

核心在 `core/src/session/turn.rs` 的 `run_turn()`，官方注释（150-162 行）
把循环语义说得极干净：

```text
每次采样请求（sampling request），模型只回两样东西之一：
- function call(s) → 执行，输出作为下一次采样的输入
- assistant message → 记入历史，turn 结束
```

### 2.1 turn 内的完整流水线（诚实精简版）

```text
run_turn 开始
  ├─ drain_async_hook_results   （收口上一轮异步 hook 的结果）
  ├─ run_pre_sampling_compact   （采样前压缩；失败也要先把用户输入落盘）
  ├─ capture_step_context       （按输入要求唤醒必需 MCP server / plugin）
  ├─ record_context_updates     （环境/AGENTS.md/skills 变化进历史）
  └─ loop：采样循环
       ├─ record_step_world_state_if_changed   （工作区状态指纹）
       ├─ clone_history().for_prompt(...)      （历史 → 采样输入）
       ├─ run_sampling_request                 （流式调用 + 工具分发）
       ├─ model_needs_follow_up? 收 mailbox    （多 agent 通信盒的触发邮件）
       ├─ drain hooks / 采集 token 状态
       └─ 判断：needs_follow_up || pending_input → 再来一轮
          token_limit_reached → roll-over 或 auto-compact 兜底
```

### 2.2 与 pi/dsh 循环的三个关键差异

1. **「一采样一响应」的弱约束**：pi 的 loop 处理任意数量 tool call 的批，
   codex 注释明确说「实践中一次采样基本只有一个 item」——
   循环不是框架决定的，是被模型行为校准过的；
2. **中断语义**：取消时发现「已有部分工作」→ 历史里插入
   interrupted 标记（`interrupted_turn_history_marker`），
   下一轮模型能看到「上轮被打断了」而不是诡异断层；
3. **mailbox 机制**：session 内部有 input_queue + mailbox，
   多 agent 协作时其他 agent 的邮件标 `trigger_turn`，
   当前采样循环空转等待时会被「有邮件」唤醒——
   这是 dsh 的 steering/follow-up 之外的第三种异步注入设计。

### 2.3 Task 抽象：turn 上的一层

`tasks/mod.rs`：`Task` trait（`kind()`/`run()`）把「一次用户意图」
抽象成四种实现——`RegularTask`（正常对话）、`ReviewTask`（代码审查）、
`CompactTask`（压缩）、`UserShellTask`（用户直接跑的 `!cmd`）。
每个 task 有自己的事件序列与生命周期，复用同一个 Session。

对照表值得记：**pi 只有 prompt 一种入口；dsh 用 turn/step 两层；
codex 用 Task（意图）→ turn.rs 采样循环（轮）两层。**

## 三、安全纵深：三层防线（本文最重的部分）

codex 与 pi/dsh 最大的设计分野在安全。三层各自独立可配：

### 3.1 第一层：审批策略（AskForApproval）

`protocol/src/protocol.rs` 定义了四档：

| 档位 | 语义 |
|---|---|
| `untrusted` | 未标记信任的项目：除非 execpolicy 显式放行，都问 |
| `on-request`（默认） | **模型自己决定何时求人** |
| `granular` | 细粒度开关：sandbox 提权 / execpolicy prompt 规则 / skill 脚本 / request_permissions / MCP elicitation，逐项独立 |
| `never` | 永不问人，失败直接回给模型，**绝不升级** |

`on-request` 的默认值选择非常「agent-native」：不是「什么都问人」
（打断流）也不是「什么都不问」（失控），而是把升级时机也交还给模型，
用人挡在「不可逆操作」之前。

### 3.2 第二层：execpolicy 规则引擎

`codex-rs/execpolicy/`：一个独立的 starlark 风格规则语言
（`~/.codex/rules/*.policy`），对 shell 命令做前缀/模式级匹配：

```text
规则三元：prefix_rule(pattern=[...], decision="allow"|"prompt"|"forbidden")
评估顺序：第一条匹配获胜；无匹配 → 走审批策略兜底
```

和「审批」的分工：**审批是「这个命令要不要现在问人」，
execpolicy 是「这类命令的常态决策」**——`git status` 永远 allow、
`rm -rf` 永远 forbidden，不用每次都惊动人。
（dsh 里对应物是 `tools/pre-execute` waterfall + monotonic guard；
pi 里对应物是不存在——README 直接让你上容器。）

### 3.3 第三层：平台沙箱

`codex-rs/sandboxing/`：审批说「可以跑」之后，命令仍被关进平台沙箱：

- **macOS**：Apple Seatbelt（`.sbpl` 策略文件，内核级）；
- **Linux**：Landlock LSM（+ bwrap 备选路径）；
- **Windows**：受限 token / 桌面隔离，分档 `WindowsSandboxLevel`；
- 配合 `FileSystemSandboxPolicy`（read-only / workspace-write /
  danger-full-access）做路径级读写判定，patch 写盘前过
  `assess_patch_safety()`（`core/src/safety.rs`）逐文件确认。

三层一起构成「defense in depth」：
**规则挡惯例、审批挡个案、沙箱挡万一。**

<div class="diagram-embed">
<iframe src="assets/diagrams/codex-safety-layers.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/codex-safety-layers.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 四、上下文与持久化

### 4.1 历史与截断

所有上下文存于 `Session` 内的 history（`Vec<ResponseItem>`），
`clone_history().for_prompt(modalities)` 在采样时投影——与 dsh 的
`deriveMessages()` 同构。截断是**对外统一投影、对内全量保留**，
`record_reasoning_effort_override` 这类临时覆盖会和输入一起被截断，
保证「截走的内容和它依赖的状态一起消失」。

### 4.2 压缩（compact）三条路

- **inline auto-compact**（本机调模型摘要，token 水位触发）；
- **remote compaction V2**：把压缩任务发给服务端，含图片预算管理
  （`compact_remote_v2*.rs` 一整族）——供应商专属能力；
- **roll-over**：窗口实在不够时开新 context window，旧上下文归档。

`CompactedHistoryMetadata` 记录了 window number、compaction_response_id、
model hash——和 dsh 的 `compaction/summary` envelope 思路一致：
**摘要调用的完整证据要留档**。

### 4.3 rollout 与 state

- `rollout/`：`RolloutRecorder` 把会话追加为 JSONL（按日期分目录），
  `codex resume` / `fork` 从它恢复；
- `state/`（较新）：SQLite 状态库（audit、log_db、migrations）——
  可查询的结构化状态在往 SQLite 迁，rollout 文件仍是重放真相源。

## 五、工具与 Task 生态速览

- 工具 spec 组装走 `tools/spec_plan.rs`（ToolSpec：Function / Namespace /
  Freeform / WebSearch / ToolSearch），运行时路由走 `router.rs`，
  并行判定 `tool_supports_parallel(call)`；
- **`apply_patch` 是自研补丁 DSL**（V4A grammar），模型被要求用它改文件
  而非自由编辑——给「模型改代码」加了一层可校验、可 sandbox 判定的
  结构化协议（对比 pi/dsh 都是直接给通用 edit 工具）；
- `update_plan` 任务清单、`user_shell` 用户直跑命令、`multi_agent_tool`
  子 agent、MCP 全套走 `rmcp-client`。

## 六、三方对比总结（面试直接背诵版）

| 维度 | pi | dsh | codex |
|---|---|---|---|
| 循环结构 | 单文件双层循环 | turn/step + waterfall 拦截点 | Task/turn + 采样循环 |
| 注入异步输入 | steering/follow-up 队列 | agent/pre-step waterfall + inbox | mailbox + input_queue |
| 事件模型 | 11 种生命周期事件 | 三域事件（durable/live/capability） | EventMsg 协议枚举 + OTel |
| 安全 | 无内置 | 审批 waterfall + guard | 审批 × execpolicy × 平台沙箱 |
| 压缩 | compaction entry | compaction seam | 本地/远程/roll-over 三路 |
| 工具增改 | edit 直改 | edit 直改 | apply_patch 结构化补丁 |
| 扩展哲学 | 7 孔插座 | 插件树无孔位 | 规则文件 + hooks + MCP |
| 适合读法 | 一下午 | 按子系统一周 | 按 crate 族一个月 |

**最佳分工**：面试被问「读过什么 agent 源码」——pi 讲循环本质，
dsh 讲插件化与事件溯源，codex 讲安全纵深与工程化细节。

## 七、▶ 面试挂钩

**问题 1：三个框架的 agent loop 本质上有什么不同？**
「本质相同：都是『模型回工具就执行回写、回消息就停』。差异在三层
包装：pi 把循环写成 949 行单文件，只有 7 个钩子；dsh 把每个拦截点
做成 waterfall 事件，并把 loop 本身降为插件；codex 在循环外套了
Task 抽象（regular/review/compact/user-shell），并用 mailbox 处理
多 agent 唤醒。选哪个看约束：小团队选 pi，要运行时自修改选 dsh，
要交付到不信任环境选 codex。」

**问题 2：codex 的审批系统 vs dsh 的审批 waterfall，哪个更好？**
「目标不同。codex 是『分层防御』：execpolicy 管惯例（starlark 规则，
pattern 级），审批管个案（四档策略），沙箱管兜底（Seatbelt/Landlock），
由于面向公开分发，默认策略保守。dsh 是『策略可换』：审批只是
`tools/pre-execute` 的一个 listener，你可以整个替换成自己公司的
风控服务。做 to-C 产品学 codex，做企业内部平台学 dsh。」

**问题 3：为什么 codex 用 apply_patch 而不是直接 edit 工具？**
「三个收益：**安全**——补丁是结构化数据，能逐文件过 sandbox 策略
（`assess_patch_safety`）再落盘；**可审查**——V4A 格式 diff 形态，
用户看到的是标准变更视图；**可恢复**——失败时整个 patch 原子拒绝，
不存在半个 edit 工具造成的中间态。代价是模型要学一门 DSL，
但 GPT 系模型在训练中见过这个格式，约束反而降低了出错率。」

**问题 4：observability 怎么做？**
「codex 是最重的一个：全链路 tracing span（run_turn/prepare_sampling/
collect_post_sampling 分段），OTel 指标（active turns gauge、token
水位、compression 次数），外加 rollout JSONL + SQLite 双轨持久化。
pinch point 是『采样循环内的每条记录都要在取消/中断时保持一致』——
所以它连 interrupted 都有专门的 history marker。」

**问题 5：如果让你给 pi 加上 codex 的安全纵深，怎么加？**
「按三层倒着加：先抄 sandbox——pi 的 bash 工具外裹一层 Seatbelt/Landlock
（pi README 本来就建议容器化，这一步等于把建议落成默认）；再抄
execpolicy——在 `beforeToolCall` 钩子里挂一个规则文件评估器；
最后抄审批——`beforeToolCall` 返回 block 时转成用户询问。
pi 的钩子孔位正好够插这三层，不用改 loop。」

## 八、延伸阅读

- 一手仓库：[openai/codex](https://github.com/openai/codex)；
  核心文件 `codex-rs/core/src/session/turn.rs`（采样循环）、
  `core/src/safety.rs`（patch 安全判定）、`protocol/src/protocol.rs`
  （审批与沙箱类型）、`codex-rs/execpolicy/`（规则引擎）。
- 官方文档：[developers.openai.com/codex](https://developers.openai.com/codex/cli)
  （security 与 exec-policy 两节是本篇三、四节的官方口径）。
- 仓内对照：[Pi Agent 源码分析](./pi-agent源码分析.md)（极简路线）、
  [DeepSeek Harness 分析](./deepseek-harness分析.md)（元框架路线）、
  [AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)（产品内幕视角）。
