# DeepSeek Harness 分析：「一切皆插件」的元框架路线

> 本篇面向已读过 [Pi Agent 源码分析](./pi-agent源码分析.md) 的读者：你看完了
> 「极简到 949 行」的 agent loop，现在看它的**镜像反面**——DeepSeek 官方
> 2026 年 8 月开源的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> （CLI 名 `dsh`，246k+ stars、MIT、TypeScript），Slogan 是
> "**Everything is a Plugin**"：模型适配器、工具注册表、会话日志、
> **连 agent loop 本身都是插件**，配置层可整体替换。
> 读完你会获得：Cordis 插件框架的五个核心概念、dsh 的 turn/step 双层循环
> 与事件溯源设计、以及「极简 vs 元框架」这组架构选型对照的面试话术。
> 注意：dsh 处于 developer preview（README 明示有破坏性变更），
> 本文以 2026-10 的 main 分支与官方文档为准。

## 〇、和 Pi 的关系：同代际、反路线

| | Pi（earendil-works/pi） | DeepSeek Harness（dsh） |
|---|---|---|
| 哲学 | 极简单文件循环，约定优于框架 | 一切皆插件，loop 都可换 |
| 核心 loop | `agent-loop.ts` 949 行 | loop 是一个可替换插件（`core/agent-loop`） |
| 扩展方式 | 扩展注册进固定孔位（7 个钩子） | 没有「孔位」——整个产品是插件树，patch YAML 可替换任意节点 |
| 权限/审批 | 无内置，建议容器化 | 内置审批 waterfall + 沙箱 + monotonic guard |
| subagent | 无，交给扩展 | 内置，且能把 Claude Code/Codex 当子 agent 委派 |
| 适用读法 | 一下午通读核心 | 按 subsystem 文档分块读，loop 只是其中一块 |

一句话：**pi 证明 agent 最小可以小到什么；dsh 证明 agent 的每块拼图
可以解耦到什么程度。** 两者一起读，正好是系统设计的两个极端锚点。

## 一、Cordis：五个概念撑起整个框架

dsh 底座是 [Cordis](https://github.com/cordiverse/cordis) 插件框架
（配套论文 arXiv:2608.25512；其前身是 4000+ 插件规模的 Koishi 聊天机器人
框架）。官方 primer 概括为五条：`docs/cordis-primer.md`

1. **插件即 Service**：一个插件就是实现 Service 的对象（或带
   `inject` + `apply(ctx)` 的函数）；
2. **Context 是服务仓库**：服务认领稳定的 `ctx.<key>`（`ctx.tools`、
   `ctx.llm`、`ctx.sessions`），其他插件按键名找服务，不 import 具体实现；
3. **用 `inject` 声明依赖**：依赖表达加载顺序——插件声明需要哪些服务，
   等它们存在才挂载，不要手动编排启动顺序；
4. **typed events 五种分发模式**：`emit`（观察）/ `waterfall`（around
   中间件，listener 收 `(...args, next)`）/ `parallel` / `serial` / `bail`，
   分发模式是事件公共契约的一部分；
5. **所有注册都是可逆 effect**：prompt 小节、工具 schema、adapter、
   listener 全部通过 `ctx.effect()` 安装，**插件卸载时自动 unwind**。

第 5 条是 dsh 最有野心的地基：可逆 effect 使**运行时装卸插件**成为可能
——官方称之为「自进化 agent」（Creator 模式：agent 给自己写插件并热加载）。
对照 pi：pi 的扩展注册后也是「活着的」，但 pi 不需要可逆语义，
因为它的定位不是让 agent 改自己。

## 二、组合模型：Profile / Bundle / Patch 三层 YAML

一个运行中的 `dsh` = 启动时按**有序分层**合成的插件树：

```text
Profile（命名组合，如 web / headless / sdk / acp）
  └─ 有序叠加 Bundle（config 行 + 代码的分发格式）
       └─ 逐层 patch：profile 的 cordis.patch.yml → home 级 → --patch overlay
```

- 内置 profile：`web`（浏览器应用 + 服务端）、`headless`（一次性 runner）、
  `sdk`、`sdk-minimal`（刻意自足单 bundle，不套 base）、`acp`；
- `dsh-base` 是共享首层：模型适配器、工具、持久化、沙箱与审批策略、
  设置、凭据、遥测；
- **`dsh --profile web --dump-config` 可以把整机插件树 dump 出来**，
  打印出的每一行都能被你自己的 patch 替换——
  「there is no privileged core to patch」（docs/architecture.md）。

这与 pi 的对比非常鲜明：pi 给你 7 个钩子孔位；dsh 说整个产品就是
一张可编辑的插件清单，loop 本身也是其中一行。

## 三、Turn 流程：step/turn 双层 + 事件溯源

### 3.1 术语对齐

- **Step = 一次模型请求 + 它调用的所有工具**（对应 pi 的一个 turn）；
- **Turn = 0~N 个 step**：第一个 input 被 claim 前开启，
  「不再欠任何东西」（无待执行工具、无排队输入）时关闭。

### 3.2 官方 turn flow（docs/architecture.md 原文骨架）

```text
turn/start
  claim 下一 step 输入 + 一条排队消息
  组装 prompt 小节 + 工具 schema
  -> agent/pre-step        （waterfall，可改写/拒收输入）
     step/start
     agent/request -> prepareCall
     提交 system/message + user/message 入日志
     deriveMessages() 从日志投影模型历史并冻结
     流式调用 -> llm/stream -> agent/assistant-stream
       assistant/message | assistant/attempt
     tool/call -> tools/pre-execute -> tools/execute
                -> tools/post-execute -> tool/result
     step/end
  -> agent/turn-stopping
turn/end
```

<div class="diagram-embed">
<iframe src="assets/diagrams/dsh-turn-flow.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/dsh-turn-flow.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

与 pi 的 loop 形态一致（消息→请求→流→工具→回写），但 dsh 把每一步
都做成了**有名字的 waterfall 拦截点**，并且把「调了几次模型」这一步
从 pi 的隐式 while 循环提升为显式的 step/turn 二级结构。

### 3.3 事件三域：扩展前先选对域

- **Session 事件**（durable）：`turn/*`、`step/*`、`user/message`、
  `assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`——
  进 append-only 日志，可重放。「事实必须活过重启」就用它；
- **Agent 事件**（live，`agent/*`）：inbox、step、`agent/pre-step`、
  `agent/assistant-stream`、`agent/turn-stopping` 等——观察/拦截进行中的工作；
- **Capability 事件**（`fs/*`、`tools/*`、`telemetry/*`）：把策略和适配器
  挂到能力缝上，不 import loop。

### 3.4 核心不变式：Model-visible means logged

**模型看到的一切必须能从日志重建。** `deriveMessages()` 从 append-only
日志投影模型历史；每条 `assistant/message` 内嵌产生它的完整 compact
timed stream；失败/重试/取消记为 log-only 的 `assistant/attempt`
（不进模型历史，但可审计）；system prompt 也走 `system/message` 历史
（空渲染 = 清空所有活跃 prompt 节点）。

这是比 pi「一切皆消息」更强的不变式：pi 说「都编码进消息流」，
dsh 说「并且运行时**检查**每次模型请求能由日志重建」——
新增任何模型可见输入，必须先加 session 事件。

## 四、工具管线：policy 不碰 loop

`docs/tool-execution-pipeline.md` 的完整管线（对照 pi 的
「beforeToolCall → execute → afterToolCall」三段）：

```text
tool/call（先落日志再执行）
  -> tools/pre-execute   waterfall：hooks/权限/沙箱（allow/deny/cancel/ask）
  -> monotonic ToolGuard 只能收紧不能放行，与顺序无关
  -> ctx.approval        一次性人工审批；无人可答 = deny
  -> tools/execute       around waterfall：超时/重试/指标
  -> tool execute() 本体（fs 写入再过 fs/write-intent 闸）
  -> projectContent      工具自备的结果投影
  -> tools/post-execute  waterfall：accept/replace/block（纠错反馈）
  -> finalizeContent     内容不变式最后关卡
  -> tools/result        冻结权威结果（同步通知）
  -> tool/result         唯一模型可见 outcome，落日志
```

三个细节直接可当面试亮点：

1. **参数不可重写**：历史、审计、UI、执行必须看到同一份参数，
   管线只允许变换「结果」不允许改「调用」；
2. **guard 单调只能收紧**：注册多个守卫时与注册顺序无关——
   避免了「谁先注册谁赢」的隐蔽 bug；
3. **任何环节抛异常**都被外层归一化为 isError 快照，
   与 pi 的「错误一律进结果通道」殊途同归。

并行调度：`isConcurrencySafe()` 纯函数分类，exclusive 调用构成 barrier，
其余进 rolling-pool 并行（pi 是「批内有一个 sequential 就整批串行」，
粒度更粗但实现更简单）。

## 五、上下文管理：compaction 是 seam 不是脊柱

dsh 的 compaction 设计是「缝」思路的范本（`docs/subsystems/compaction.md`）：

- 三个 log-only 事件：**compaction/start（拿锁）→ 摘要 → compaction/summary（记录 shadowed 范围、token 计数、摘要调用完整 envelope）→ compaction/end（放锁）**；
  崩溃在锁中间 = 可检测的孤儿锁，而不是误报完成；
- **唯一的 surface 改写**通过一条带
  `surfaceOp: { op: 'replace', startSeq, endSeq }` 的 `user/message`
  完成——摘要复用了普通消息类型，日志 schema 零膨胀；
- 边界检查保证 tool-call/result 配对不断裂
  （`toolPairingBalancedBefore/After`），允许一个超长 turn 的
  早期已关闭 step 被压缩；
- 两种触发：`'pressure'`（自动，在 `agent/pre-step` waterfall 里、
  推导请求前运行）与 `'context-overflow'`（provider 确认溢出，
  经 `agent/request-error` 同一步内恢复重试）；
- 摘要前先跑确定性裁剪（`ctx.toolResultPruner`，head/middle/tail
  按 Unicode code point 计量）——**能不花钱摘要就先裁剪**；
- 单次摘要调用必须可从 log + code 重建（provider/model/maxTokens/usage
  全部入 `compaction/summary` 的 envelope）。

对照 pi：pi 的 compaction 是会话树上的一个特殊 entry、保留原始条目；
dsh 进一步把「锁、范围、摘要调用的完整证据」全部事件化，
并且把 compaction 本身做成可替换 provider。

## 六、其余值得知道的能力缝

- **Subagent 多 provider 注册表**（`ctx.subagents`）：`spawn-in-process`、
  `fork-in-process`、`acp`、**claude-code / codex**——后两个是把
  Claude Code 和 Codex 当子 agent 委派的桥接，dsh 因此有「元 harness」
  定位；支持 per-child 模型/推理档、`maxDepth` 委派深度上限、
  `toolFilter` 收缩子 agent 工具集；continuable 后台子 agent 与父
  可直接 `send_message` 互相 steer；
- **PTC（Programmatic Tool Calling）**：保留传输工具 `run_code`，
  模型写 TypeScript 程序、程序内 `await tools.name(args)` 程序化
  调用工具，子调用重入完整守卫管线（对标 Cloudflare Code Mode /
  Anthropic code execution with MCP）；
- **Session 物理格式**：JSONL（`.zstd` 压缩可选），版本链式迁移，
  **committed generation 永不改名/覆盖/删除**；
- 内置工具目录（每个都是独立插件包）：bash/PTY、read/write/edit、
  glob/grep、LSP、web_search/fetch、todo_write、skill、subagent、
  workflow（JS 编排 fan-out）、schedule（cron）、Agent Teams（实验性，
  默认禁用）等几十个。

## 七、深读增量：论文两轴 × fiber 内核 × AI 工程纪律（三方报告）

> 本节的增量来自社区第三方报告
> [xiaonancs/deepseek-harness-deep-dive](https://github.com/xiaonancs/deepseek-harness-deep-dive)
> （2026-10 时点约 44 star 的小仓，**非官方**；基线为 rc.5 快照
> `47f943859b`、2026-08-13、12,293 commits，rc.5→rc.7 增量另有逐条追踪）。
> 它的价值不在 star 数，而在两件可抄的东西：给每条结论标证据档
> （`[verified]` 文件:行号 / `[inferred]` 合理推断 / `[claimed]` 二手口径，
> 与本仓「官方/自报/未复测」口径同构）、以及把论文形式化逐条对回源码。
> 本节机制性结论均为其对 fiber.ts 等文件的 [verified] 读码口径，
> 本仓未逐行复核；涉及动机处按其 [inferred]/[claimed] 标注降级处理。

### 7.1 论文两轴：「时空可组合」到底在哪两根轴上组合

首节说的 Cordis 配套论文《A Programming Paradigm for Spatiotemporal
Composability》，报告给出的通俗拆解（报告口径，论文为北大 × DeepSeek-AI
联合产出，共同作者 Tianyi Cui 是 dsh 头号提交者）：

```text
时间轴 = reversible effect（可逆副作用）
         安装任何副作用时同时交出它的撤销键；
         组合算子的逆 = 各分量逆的反序组合
         →「做过的动作都能撤销」

空间轴 = reactive coeffect（响应式依赖）
         依赖用 inject 声明，框架在服务就绪/消失时主动推通知，
         插件不轮询、启动顺序不手工编排
         →「我需要什么由我声明，框架自动喂给我」
```

报告把整条技术主线浓缩成一句口号：**「万物皆服务，万物皆可撤销」**——
前半句是「一切皆插件」的服务化表达，后半句是可逆 effect 的通俗说法。
注意它的自我设限：口号不是被证明的定理，严格边界在论文原文。

### 7.2 fiber 内核三件套：热插拔正确性的运行时答案

首节的「五个概念」停在 API 面；报告对 `fiber.ts`（core 包最承重单文件，
约 486 行）的精读补上了运行时面。fiber = 插件实例的运行时载体
（`Plugin.Runtime` 是类，fiber 是一次实例化运行；一个 runtime 可挂多个
fiber，还分根 fiber / 普通 fiber）。三根承重柱：

**其一，epoch 字符串 = 依赖快照的单一真相源。**
`_refresh()` 把每个依赖当前提供方的 uid 拼进 epoch；任一依赖缺失则置
哨兵 `INACTIVE`。状态（六态：PENDING/LOADING/ACTIVE/FAILED/UNLOADING/
DISPOSED）不另存字段，而是从 epoch 推导——热插拔最怕「状态与派生状态
不一致」，干脆只存一份。重要推论：**依赖名字还在、但提供者换了人
（uid 变了），epoch 同样变、照样触发 reload**。

**其二，可逆 effect 的三性质。**
`ctx.effect(fn)` 返回撤销键（disposer），且保证：

```text
反序：  卸载时 disposer 后进先出执行
        （先建连接再注册路由，拆时必须先撤路由再断连接）
幂等：  重复调用同一个 disposer 是无害空操作（撤销键只灵一次）
嵌套：  effect 内创建的子 effect 改挂进父 effect 的账本，
        撤父连带撤子，且顺序正确
```

**其三，inertia 惯性闸门：异步迁移串行化。**
插件 callback 可能 await 半天，加载途中依赖又消失了怎么办？

```text
服务变化 → reflect.notify → 重算依赖 _store → 重算 epoch
        → _setEpoch：新旧相等则不动（幂等）
        → 若正在迁移中（inertia 存在）：只记 epoch 不动作
        → 迁移末尾「回头看」最新 epoch，决定再来一轮
收敛形态：任一时刻至多一个迁移在跑，且最终收敛到最新目标
```

报告点出的取舍：在「惯性排队」与「抢占中断」之间选了前者——完全回滚
要求副作用始终处于已知的完整状态，中断跑到一半的 callback，已建连接、
已注册钩子全卡在半成品，回滚点根本说不清。

**自引用闭环**：装载一个插件，对父 fiber 而言就是注册一个 effect
（子 fiber 的 dispose 登记在父的账本上）——于是「整棵插件树」天然层层
可回滚，这正是 dsh 敢说「运行时改自己不留脏东西」的地基。

### 7.3 过程哲学：当主力程序员是 AI，工程纪律是给 AI 立的法

报告「过程命题」的几个硬数字（其对仓库门禁文档的引用口径）：

- 仓库自述 **"This codebase is developed primarily by coding agents"**
  （quality-gates.md:11）——不是外界推断，是自述；
- 节奏：约 2 个月 12,293 commits（rc.5 基线口径）；
- 制度件：约 505–507 篇 Agent Notes（ADR 决策记录，相当于给后来者的
  「当初为什么这么定」备忘）、docs/postmortem 事故复盘、100% 单文件
  覆盖、双语门禁、原生 stacked-PR 工作流。

这组事实和本仓 `harness工程实战` 的「把不确定的模型包在确定的结构里」
互为印证：**代码主要由不确定的 agent 写出时，确定性的东西必须外置**——
评审纪律、决策留痕、事故复盘、门禁全在流程里而不在 agent 的自觉里。

### 7.4 血缘链：元框架不是设计出来的，是演进出来的

报告的血缘考证（其 git 实证口径）：Cordis 出自 4000+ 插件规模的
Koishi 聊天机器人框架（Shigma 主导 537/550 commits、4 年演进），
dsh 以 vendored 方式消费 Cordis。链条 = Koishi 生态 → Cordis 抽象 →
dsh 产品。面试里被问「为什么不学 pi 极简」，这是比「理念不同」更实的
答案：**dsh 的复杂度是带着生态遗产来的——它要继承的是 Koishi 验证过的
插件经济，pi 没有这个历史包袱也不需要。**

## 八、▶ 面试挂钩

**问题 1：pi 和 dsh 都读过，架构选型上你怎么取舍？**
「两个极端锚点。pi：agent loop 949 行一个文件，7 个钩子孔位，
胜在读得完、改得动、心智负担小，适合产品形态明确、团队小的场景；
dsh：一切是插件、loop 可换，Cordis 用可逆 effect 支撑运行时自修改，
胜在生态和多端（web/headless/SDK/ACP 同树不同组合），代价是理解一组
框架概念才能上手。真做产品我会从 pi 的复杂度起步，
把 dsh 的三样按需抄过来：事件溯源日志、工具管线的审批 waterfall、
capability seam 的三分角色（Definition/Provider/Consumer）。」

**问题 2：dsh 的 "model-visible means logged" 解决什么问题？**
「三件事的可审计性：回放（fork/resume/转录全从日志投影，不存第二份
真相）、调试（任何一次模型请求含 system prompt 都能从 log 重建，
失败重试记为 log-only attempt 不污染模型历史）、合规（工具调用
先落 tool/call 再执行，参数全程不可重写）。代价是所有模型可见输入
都得先进日志 schema——这是一笔用扩展灵活性换审计刚性的账。」

**问题 3：对比两个项目的 compaction 设计。**
「pi：compaction 是会话树上的一个特殊 entry，摘要带文件操作清单，
原始历史不动——小而美。dsh：compaction 是可替换 provider，
锁、范围、token 计数、摘要调用的完整 envelope 全部事件化；
摘要通过一条带 surfaceOp replace 的 user/message 完成唯一 surface
改写；边界检查保护 tool-call/result 配对；摘要前先做确定性
tool-result 裁剪省钱。dsh 版本能回答『这次压缩到底发生了什么』，
pi 版本只回答『压缩了』。」

**问题 4：agent 运行时给自己装插件（自进化）怎么做才安全？**
「dsh 的答案分三层：地基是可逆 effect（卸载自动 unwind，
装错了能干净退回）；权限走 plugin_manager 工具 + danger-full-access
显式开门；所有安装动作落 session 日志可审计。本质上和
『允许 agent 写代码』是同一个信任问题——boundary 不在『能不能』
而在『可不可回滚、可不可审计』。」

**问题 5：插件热装卸「不留脏东西」靠什么保证，不只是口号吧？**
「下沉到 fiber 三件套：依赖快照收敛成一个 epoch 字符串
（任一依赖缺失置 INACTIVE、提供者换人 uid 变也触发 reload，
状态从 epoch 推导不另存字段，消灭不一致窗口）；可逆 effect 保证
反序撤销、幂等撤销、嵌套连带撤销；异步迁移用 inertia 串行化——
加载途中目标变了只记 epoch，迁移末尾回头看再决定下一轮，
最终在 unleas 最新目标上收敛。支撑它的还有一篇形式化论文
（时空可组合：时间轴可逆 effect、空间轴响应式 coeffect），
可替换是机制兜底而不是约定自觉。答题时补一句来历更稳：
这套语义在 Koishi 几千个插件的生态里先跑了四年。」

## 九、延伸阅读

- 三方深读报告（本文 §七 来源）：
  [xiaonancs/deepseek-harness-deep-dive](https://github.com/xiaonancs/deepseek-harness-deep-dive)
  （35 章 + 总纲 + 社区认知地图；证据三档标注法可直接抄）。
- 一手仓库与文档：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)、
  [架构总览](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/architecture.md)、
  [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.md)、
  [工具管线](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/tool-execution-pipeline.md)、
  [compaction 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/subsystems/compaction.md)。
- Cordis 论文：arXiv:2608.25512《A Programming Paradigm for
  Spatiotemporal Composability》。
- 仓内对照：[Pi Agent 源码分析](./pi-agent源码分析.md)（路线 A）、
  [AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)（产品形态参照）、
  [多 Agent 与评测](./多agent与评测.md)（Harness 评测七组件）。
