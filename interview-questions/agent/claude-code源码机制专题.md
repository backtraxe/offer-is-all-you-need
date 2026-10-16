# Claude Code 源码机制专题：闭源产品的逆向重建读法

> **面向**：已读过仓内 pi / dsh / codex 三篇源码分析、想在面试里补上
> 「Claude Code 这套闭源参照系」的读者。
> **读完获得**：启动链与编译时隔离的工程答案、上下文五阶段流水线的
> 完整账本（含 25 万次/天 API 调用熔断事故）、记忆四层与后台提取的
> 门控/互斥/权限矩阵、工具桩模式与延迟加载、「Prompt 即编排」的
> 取舍话术，以及「闭源产品怎么做源码级分析」的方法论。
> **口径声明**：Claude Code 是闭源产品。本文机制描述来自第三方逆向
> 重建研究 [xiaonancs/claude-code-source-analysis](https://github.com/xiaonancs/claude-code-source-analysis)
> （基线 **v2.1.88 restored-src**：1,884 个 TS 文件 / 513,216 行 /
> 30 篇 / 23 子系统；成稿 2026-05，多模型流水线产出、CC BY-SA 4.0），
> 交叉源为 Anthropic 官方工程博客与官方文档。逆向快照≠官方发布源码，
> 版本会漂移；引用时建议带版本号三源互证。报告行中出现的 BQ 注释、
> 具体行号均为报告口径，本仓未逐行复核。

---

## 一、定位：源码分析第四极——闭源参照系怎么读

仓内源码系列至此四极成环：

| | pi | dsh | codex | **Claude Code** |
|---|---|---|---|---|
| 开放度 | 全开源 | 全开源 | 全开源 | **闭源**（逆向快照） |
| 一句话路线 | 复杂度地板 | 解耦天花板 | 工程纵深参照系 | **产品化上限参照系** |
| 循环形态 | 949 行单循环 | turn/step + waterfall | Task/turn 采样循环 | query.ts 九阶段 + async generator |
| 记忆 | 无内置 | 事件溯源日志 | AGENTS.md + memories | **四层持久 + 后台自动提取** |
| 安全 | 靠容器 | 审批 waterfall + 沙箱 | 三层纵深 + 出网门 | 权限 10 检查点 + ask/deny/allow |

读闭源产品的正确姿势（面试可直接讲的方法论）：

```text
源一：逆向重建的快照（restored-src，版本钉死 v2.1.88）
源二：官方工程博客（设计意图：How Claude Code Works、
      Effective Context Engineering、Building Effective Agents）
源三：官方产品文档（行为承诺：code.claude.com/docs）
三角互证才对；只有源一孤证的，标「逆向口径、未获官方确认」
```

规模快照（报告口径）：40 个内置工具、86 个斜杠命令、
约 90 个编译时 feature flag（972 处调用点）、运行时 Bun、
自研 Ink fork + Yoga fork 终端渲染。社区金句（Tony Bai 口径转述）：
**「更好的模型 + 更傻的架构」——核心循环极简单，复杂度全在
harness 周边。**

---

## 二、启动链与编译时隔离：51 万行怎么做到秒开

### 2.1 快路径与三阶段启动

```text
claude --version → 打印 MACRO.VERSION（编译时常量）→ 退出
                   在任何模块导入之前执行，<5ms

主路径分流（bridge/mcp/daemon/后台/交互）→
init()  进程级一次性：enableConfigs / GrowthBook / OAuth / preconnect
setup() 会话级：Node 版本检查 / worktree 检测 / sessionMemory 初始化
main()  Commander：信任对话框 / 工具与命令加载 / Agent 定义
→ launchRepl() Ink 渲染 REPL
```

同一代码库靠这条分流撑起 **10+ 种运行模式**（交互/headless/SDK/
Bridge/IDE/daemon/MCP server/KAIROS 实验面等）。

### 2.2 90 个 feature flag：编译时 DCE，物理隔离

```text
源码含全部 90 个 flag
  → Bun bundler 把 feature('X') 替换为常量 true/false
  → Dead Code Elimination 物理移除 false 分支及其依赖
外部版产物里，未发布功能（KAIROS 等）的代码【物理不存在】——
不是运行时跳过，是字节层面没有
```

两个刻意细节（面试加分）：feature-gated 模块用 `require()` 不用
`import`——静态 import 会让 DCE 失效；否定写法
`if (!feature(...)) return` 可能删不净内联字符串。代价也真实：
90 个 flag 散布 972 处调用，组合爆炸抬高测试矩阵成本，且深度
绑定 bun:bundle 无法换打包器。

### 2.3 客户端自证：`cch=00000` 占位符认证

防御第三方客户端（OpenCode 类）蹭内部 API 的技术执法：

```text
JS 层：请求头注入 x-anthropic-billing-header，
      其中 cch=00000 是占位符
    ↓
Bun 原生 HTTP 栈（Zig 实现，JS 层之下）：
      把 00000【同长度替换】为计算出的 attestation 哈希
      ——同长度替换避免 Content-Length 变化与 buffer 重分配
    ↓
服务端 _parse_cc_header 校验：请求来自真正的官方二进制
       cc_workload 字段还能把 cron 请求路由到低 QoS 池
```

设计妙处一句话：**计算发生在 JS 运行时之下，JS 层的 MITM
看不见**——二进制用密码学自证正版，不靠法律威胁。

---

## 三、query.ts：九阶段流水线

心脏是 `query.ts`（1,729 行）的 `while(true)`，每次迭代走九段：

```text
1 Skill Prefetch     异步预取技能描述
2 Snip Compaction    HISTORY_SNIP 历史截断（tombstone 占位）
3 Microcompact       工具结果瘦身（COMPACTABLE_TOOLS 白名单）
4 Build Config       组装模型/token 预算/工具列表
5 Call Model         流式 API 调用
6 Process Response   解析 assistant、提取 tool_use
7 Run Tools          并行/串行执行，收集 tool_result
8 Attachments        附件/队列命令/记忆预取
9 Update State       messages += assistant + results，turn++
```

两个源码级习惯值得抄：**State 不可变更新**（每个 continue 分支
构造新 State 对象，但 messages 数组共享引用只追加不替换）；
**async generator 必须被完整消费**，否则清理逻辑不执行——
源码里大量 `try/finally` 兜底这一条。

---

## 四、上下文五阶段流水线（本篇最重）

官方把上下文工程定义为 prompt engineering 的自然演进，核心理论是
**Context Rot**：token 越多，模型从上下文中准确召回信息的能力越差。
Claude Code 的回应是一条每次 API 调用前都跑的五段流水线：

```text
Snip(HISTORY_SNIP 截断为 tombstone)
 → Microcompact(工具结果瘦身：替换内容、保留结构)
 → Context Collapse(重复读取/搜索折叠)
 → AutoCompact(fork 子 agent 生成对话摘要)
 → normalizeMessagesForAPI(最终组装)
```

### 4.1 Microcompact 的两个关键约束

- **白名单**：只有输出**可重现**的工具可瘦身——FileRead /
  Bash / Grep / Glob / WebSearch / WebFetch / FileEdit / FileWrite。
  AgentTool 与 MCP 工具**不在列**：子 agent 和外部工具的结果
  不可重现，删了就永久丢失；
- **双路径**：时间路径（cache 已过期）直接改内容，替换为
  `[Old tool result content cleared]`，简单但破坏前缀缓存；
  缓存路径用 `cache_edits` API 移除结果但**不让缓存前缀失效**。
  同一目标，按缓存温度选刀法。

### 4.2 AutoCompact 阈值账与熔断事故（面试硬数字）

```text
contextWindow 200K（1M 可选，多通道覆盖）
ERROR     = window - 20K   红色错误
AUTO      = window - 33K   触发自动压缩（BUFFER=13K + ERROR 20K）
WARNING   = window - 53K   黄色预警（再叠 WARNING 20K）
摘要上限 MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
        （依据：p99.99 摘要 = 17,387 tokens）
熔断     连续失败 ≥ 3 次停止重试
```

熔断背后的生产事故（报告引源码内 BQ 注释口径）：1,279 个会话
出现 50+ 次连续失败（单会话最高 3,272 次），全球每天浪费约
**25 万次 API 调用**——修复就是这一行三行熔断。
「压缩是 LLM 调用，也会失败；给失败的压缩设重试上限」
是答题时必须主动说出的那层。

### 4.3 CLAUDE.md 在哪：社区最大误解

**不在 system prompt 里。** 系统提示三组件并行获取
（基础 prompt + userContext + git 状态），其中 userContext
（CLAUDE.md 内容 + 当前日期）被 `prependUserContext()` 包装成
**第一条 user message 的 `<system-reminder>` 标签**。为什么重要：

```text
system prompt 静态段（40 工具 schema + 基础指令 + 安全规则）
    → 跨轮次进 prompt cache
CLAUDE.md 在 user message #0
    → 它的任何微小变化都会 break cache，但代价被隔离在消息区，
      不会污染 system 段的缓存稳定性
```

配套的 `promptCacheBreakDetection` 监控 14 个 cache-break 向量
（systemHash/toolsHash/每工具 schema 哈希/model/fastMode/
全局 cache 策略 tool_based|system_prompt|none/betas/autoMode 等）。
报告引源码注释：**77% 的工具 cache break 是 schema-only**
（工具没增没删，只是描述微调）——为此引入 sticky latches
防止模式切换刷掉缓存。社区原话：「为每个 token 付费时，
cache invalidation 就不再是计算机科学笑话，是会计问题。」

### 4.4 官方四策略的落地映射

| Anthropic 策略 | Claude Code 实现 |
|---|---|
| Write（写入） | CLAUDE.md 预加载进 userContext |
| Select（选择） | grep/glob 即时检索、skill 懒加载 |
| Compress（压缩） | Snip→Microcompact→AutoCompact 三级 |
| Isolate（隔离） | SubAgent 独立窗口，只回摘要 |

为什么用 grep 不用 embedding 做代码检索——官方答案是
**just-in-time 检索**：维护轻量标识符（路径/查询/链接），
用时动态加载；「文件系统本身就是最好的索引系统」。
与仓内 `ai编程与claudecode内幕` 的检索哲学章互为佐证。

---

## 五、记忆：四层持久存储 + 后台自动提取

### 5.1 四层管线（先把社区的层数之争杀停）

```text
Managed   /etc/claude-code/CLAUDE.md        企业策略，管理员控制
User      ~/.claude/CLAUDE.md + rules/*.md   个人偏好
Project   从 git 根向 cwd 逐级：每层 CLAUDE.md
          + .claude/CLAUDE.md + .claude/rules/*.md
Local     各层 .local.md                      不入版本控制
另有 AutoMem（memdir/MEMORY.md 自动提取）与
TeamMem（团队记忆，按 git 远程标识与服务端同步：
pull 以服务端为准、push 按 hash 差量、删除不同步服务端）
```

社区流传的「七层记忆」（把 token 剪裁、压缩、缓存全算成记忆层）
是报告点名纠正的谬误——**运行时压缩 / 持久存储 / 缓存策略是
三个不同维度**，源码里是完全不同的模块。四层是对持久存储的
准确描述。另支持 `@import` 模块化拆分 CLAUDE.md。

### 5.2 后台自动提取 extractMemories（工程密度最高的一节）

每轮对话结束（无 tool_use 的最终回复）fire-and-forget 触发，
fork 一个子 agent 分析 transcript、把值得跨会话保留的记忆写入
memdir。围绕它的四道保险：

**① 五重门控（该不该跑）**：主 agent 才提取（子 agent 会产
噪声）；GrowthBook 服务端开关（事故可远程回滚）；用户开关
`CLAUDE_CODE_DISABLE_AUTO_MEMORY`；非 remote 模式（远程机器的
`~/.claude` 不是用户本地的）；无在途提取（并发互斥）。
——身份/服务端/用户/环境/并发五个维度各拦一道。

**② 主/后台互斥**：主 agent 自己往 auto-mem 路径写过文件，
本轮提取就跳过（扫游标后 assistant 消息里的 Write/Edit）。
两个 agent 每轮只跑一个。

**③ 重叠保护 + 尾随提取**：提取耗时不可控而触发每轮一次。
在途时新触发不并发，而是把最新上下文覆盖式暂存
（为什么覆盖不排队？最新上下文包含最多消息，分析它就够了）；
当前提取完成后启动**尾随提取**，只处理游标后的新消息。
游标 `lastMemoryMessageUuid` 被压缩移除时 fallback 计全量，
不会永久禁用。用户退出时 `drainPendingExtraction()` 最多等
60 秒让在途提取落盘，不强杀。

**④ 权限矩阵（跑起来能干什么）**：只读工具全放，Bash 仅只读
命令（ls/find/cat/stat/wc/head），FileEdit/Write 仅限 memdir/，
MCP/Agent/Web 全拒。最有教育意义的是**为什么不直接给它一份
精简工具列表**——源码注释自问自答：

> 工具列表是 prompt cache key 的一部分；给 fork 不同的
> 工具列表会破坏 prompt cache 共享。

所以方案是**工具列表不变（保 200K 窗口下的 cache 命中），
运行时 canUseTool 拦截**——典型的用安全层换经济性。

**提取什么**：四类分类学——user（用户画像）/ feedback（纠正
与确认）/ project（项目动态）/ reference（外部指针）；
**只存不可从当前项目状态推导的信息**——代码模式架构不存
（grep 可得）、git 历史不存、调试方案不存、CLAUDE.md 已有
不存、临时任务状态不存。效率上 maxTurns=5：Turn 1 并行读完、
Turn 2 并行写，预注入记忆文件清单免得浪费一轮 `ls`。

检索方式：**grep 文本匹配，不是 embedding**。这条与
「文件系统即索引」的检索哲学一脉相承。

---

## 六、工具系统与「Prompt 即编排」

### 6.1 工具池三阶段组装

```text
getAllBaseTools   40 内置候选过三重门控：
                  feature flag / 用户类型(ant 内部 vs external) / GrowthBook
getTools          SIMPLE 模式砍到 Bash+Read+Edit；
                  filterToolsByDenyRules + 各工具 isEnabled()
assembleToolPool  内置 + MCP 合并，按名排序、uniqBy 内置优先 ——
                  【排序稳定是 prompt cache 稳定的一部分】
```

### 6.2 MCPTool 桩模式 + 延迟加载

- **桩（Stub）模式**：`MCPTool.ts` 78 行占位实现（name='mcp'、
  call 返回空），真正工具在 `fetchToolsForClient` 里
  `{ ...MCPTool, name: 'mcp__github__create_pr', ... }` 展开覆盖。
  MCP 工具数量编译时未知，桩让所有 MCP 工具共享权限/UI/结果
  处理逻辑，运行时任意扩展；
- **ToolSearchTool 延迟加载**（官方文档确认口径）：会话启动
  **只加载 MCP 工具的名称和短描述**，完整 schema 不进场；
  Claude 判断要用某工具时才经搜索加载完整 schema。
  ——这就是「MCP 接了上百个工具、上下文会不会爆」的
  Claude Code 官方答案，与 codex `code_mode` 命名空间思想并列，
  是 2026「工具目录化」的两大工程范本。

### 6.3 Coordinator Mode：「Prompt 即编排」

实验面（feature('COORDINATOR_MODE')）：协调者 agent 不碰代码、
只能 `AgentTool`/`SendMessage`/`TaskStop` 派活；worker 不能再派
worker。编排逻辑**不是代码**（没有状态机/DAG 调度/任务队列），
而是约 370 行自然语言 system prompt：

| prompt 里的指令 | 传统系统的对应物 |
|---|---|
| Launch independent workers concurrently | 并行调度策略 |
| Read-only 并行自由，写任务按文件集串行 | 并发控制/锁 |
| You must understand findings before directing follow-up | 依赖管理 |
| Do not rubber-stamp weak work | 质量检查 |
| High overlap → continue, Low overlap → spawn fresh | worker 复用决策 |

利弊话术备好：**代码编排是确定性的，prompt 编排是概率性的**——
编排可靠性完全挂在模型的 instruction following 上；模型不遵守
并发规则就可能双 worker 改同一文件。但它把「编排策略」变成了
可迭代、可 A/B 的 prompt 资产，这是代码给不了的演化速度。

---

## 七、▶ 面试题

**Q1【高】闭源产品怎么做源码级技术分析？可信度怎么把？**
A：三源三角互证——逆向重建快照（版本钉死，如 v2.1.88）、
官方工程博客（设计意图）、官方产品文档（行为承诺）。两源对上
才可当结论；只有逆向孤证的标注「未获官方确认」并带版本号。
引用具体数字时区分：源码内注释（如 BQ 的 77% schema-only）
与官方口径（如 just-in-time 检索）的可信权重不同。

**Q2【高】CLAUDE.md 到底注入在哪？为什么这个问题值钱？**
A：在第一条 user message 的 `<system-reminder>`，不是 system
prompt。值钱在缓存账：system 静态段（工具 schema + 基础指令）
跨轮次进 prompt cache；CLAUDE.md 放消息区，它的变动只 break
消息区前缀，不污染 system 段缓存稳定性。答错位置 = 缓存策略
全盘讲错，面试官一票识别真伪。

**Q3【高】auto-compact 的阈值和失败处理怎么设计？**
A：分档预警（200K 窗口下 WARNING≈-53K / AUTO≈-33K /
ERROR≈-20K），摘要上限 20K token（按 p99.99=17,387 定）。
压缩本身是 LLM 调用也会失败：连续失败 3 次熔断——依据是
真实事故（源码注释：1,279 会话 50+ 连败、全球日浪费约 25 万
次调用）。再加一层：压缩前 strip 图片、摘要留证据、
压缩边界护住 tool 配对。

**Q4【高】后台记忆自动提取怎么做到不干扰主会话？**
A：五重门控（身份/服务端开关/用户开关/环境/并发）决定该不该
跑；主后互斥（主 agent 本轮写过 mem 就跳过后台）；重叠保护
不并发——覆盖式暂存 + 尾随提取 + 游标增量；退出时 drain 至多
60 秒。权限上只读全放、写仅限 memdir；工具列表刻意不变以保
prompt cache 共享，靠运行时 canUseTool 拦截越权——安全层换
经济性。

**Q5【中】为什么说「工具列表是 prompt cache key 的一部分」？**
A：Anthropic 的 prompt cache 以前缀匹配计价，system 段的工具
schema 在缓存前缀里——工具列表变了，整个前缀缓存作废重算
（200K 窗口 cache miss 的钱约为 hit 的百倍）。推论一：工具池
组装要排序稳定、内置优先；推论二：给受限子 agent 换工具列表
= 每次重新付 system 的钱，所以 Claude Code 选运行时拦截而非
换列表；推论三：77% 的 cache break 其实是 schema-only 微调，
要 sticky latch 防刷。

**Q6【中】接几百个 MCP 工具，上下文怎么活？**
A：两层答案。目录化延迟加载：启动只载名称+短描述，用到才
搜出完整 schema（ToolSearchTool，官方文档确认）。执行折叠：
把一串调用折进一次代码执行（codex Code Mode 的 namespace、
dsh PTC），中间结果不进上下文，只回结论。桩模式保证共享
权限/UI 逻辑不随工具数膨胀。

**Q7【中】编译时 feature flag 的利与弊？**
A：利：未发布功能在外部产物里物理不存在（DCE），同一源码库
出内外两版、天然防泄漏。弊：90 flag×972 调用点的组合爆炸
抬高测试成本；必须 require 不用 import；深度绑定一种打包器；
flag 会成为技术债坟墓，长期不清理。适用场景：单一二进制分发、
内外版本强隔离诉求的产品。

**Q8【低】「Prompt 即编排」和代码编排怎么选？**
A：确定性选代码——金融级并发控制、强审计、不可失败的路径
必须状态机/DAG。演化速度选 prompt——多 agent 分工策略、
质量检查标准这类要频繁调的部分做成 prompt 资产，可 A/B、
可热更。Claude Code 的 Coordinator 把 370 行编排放进 system
prompt 是后者的极限演示：上限取决于模型 instruction
following，风险是概率性违约（双写冲突、跳过综合）。
工程折中：编排骨架代码化、策略细节 prompt 化。

---

## 八、串联阅读

- 源码系列同极：[Pi Agent 源码分析](./pi-agent源码分析.md)、
  [DeepSeek Harness 分析](./deepseek-harness分析.md)、
  [Codex 源码分析](./codex源码分析.md)（含「代码即工具调用」
  四案对读表）
- 检索哲学与产品内幕视角：[AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)
- 17 节书目共读导航：[Learn Claude Code 导读](./learn-claude-code导读.md)
- 压缩/前缀缓存/token 三方账底座：[记忆与上下文工程](./记忆与上下文工程.md)
- 记忆产品线对照（mem0/Zep/Letta）：[Agent 记忆产品化专题](./agent记忆产品化专题.md)
- 会话侧第三条线（context-mode/claude-mem）：[Coding Agent 会话记忆工程专题](./coding-agent会话记忆工程专题.md)

---

## 九、口径与未核实说明

1. 全部机制描述以第三方逆向重建 v2.1.88 快照为准，未经 Anthropic
   官方确认；官方文档/博客可证的已在正文标注。版本漂移风险真实
   存在（Claude Code 发布节奏极快），面试引用建议自带版本号。
2. 数字类（40 工具/86 命令/90 flag/972 调用点/513,216 行/
   77% schema-only/25 万次 API 调用/天/p99.99=17,387）为报告
   口径或报告转引的源码注释口径，本仓未复核。
3. 报告本身为多模型流水线产出并人工发布，CC BY-SA 4.0；
   其引用的社区观点（Tony Bai、Alex Kim、Troy Hua 等）为二手
   转述口径。
4. Coordinator Mode / KAIROS / TeamMem 等均为实验面，
   feature flag 默认状态与对外可见性随时可能变化。
