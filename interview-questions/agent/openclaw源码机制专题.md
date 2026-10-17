# OpenClaw 源码机制专题：Gateway 控制面、Context Engine 与「个人 AI OS」路线

> 本篇面向读过 [Hermes 与 OpenClaw 生态专题](./hermes与openclaw生态专题.md) 的
> 读者——那里的视角是**增长与争议**（90k→359k star 的拆账、跨语言复现口水战），
> 本篇是它的下半场：**机制面**。源码系列的第五极到齐：pi 给出复杂度地板、
> dsh 给插件天花板、codex 给 Rust 安全纵深、claude-code 给闭源逆向读法，
> OpenClaw 给的是一个全新象限——**唯一把「个人助手网关」做成产品的 harness**。
> 吸收源：`xiaonancs/openclaw-study` 27 章深读报告（基线 v2026.4.15，
> commit c56b56e，2026-04-17 快照；覆盖 2026-02 以来 23,014 commits、
> 1,200 merged PR、420 issue、300 fork 的量化数据集）。除注明外均为
> **报告口径**，本仓未复测、未读 openclaw 原仓源码。

## 〇、为什么这一极值得加

已有四极都对不上 OpenClaw 的题：Claude Code 没有「Gateway」概念，它本身
就是 CLI 进程，没法多端共享 session；Codex 控制面在 OpenAI 云端，用户
端是瘦客户端；Hermes 有控制面但走 HTTP REST；pi 是单文件哲学。OpenClaw
的答案成了一个孤例——**控制面是用户自己拥有的进程**，于是菜单栏动画、
iOS 通知、跨端 session 续接这些「agent 可见性」能力才存在。面试被问
「你还有没有见过完全不同形态的 agent 系统」，这里就是答案。

数字抓底（2026-04-17 报告快照，随时间漂移）：**359,217 stars / 73,087
forks / 18,993 open issues / 31,559 commits / 96 releases**；`src/` 60 个
子目录、`packages/` 3 个 SDK、`extensions/` 106 个扩展、`skills/` 53 个
内置 skill、30+ 通道、50+ 模型 provider。演化线一路是改名史：Warelay →
Clawdbot → Moltbot → OpenClaw（2025-11）→ 基金会治理（2026-02）。

## 一、六顶层子系统与一条消息的旅程

```text
  通道进                    控制面                     执行与记忆                出口
  ┌────────┐   ┌─────────────────────────┐   ┌──────────────────────┐   ┌────────┐
  │ IM/邮件 │ → │ Gateway 控制面           │ → │ Agent 运行时          │ → │ 同通道 │
  │/语音/屏幕│   │ WS 127.0.0.1:18789      │   │ Context Engine       │   │ 回程   │
  └────────┘   │ Routing+Hooks+Auto-reply│   │ Memory/Dreaming/     │   └────────┘
               │ (dispatch/auth/dedup)   │   │ Compaction           │
               └─────────────────────────┘   │ Tools/Canvas/Nodes    │
      ↑ Skills+ClawHub ⤵ 注入                │ Browser/MCP          │
      └ Security/Sandbox/Pairing ⤵ 保护整体  └──────────────────────┘
```

以飞书群 @ 机器人发一句话为例（报告对照源码给的十步法）：

1. `extensions/feishu` 收 webhook/WS 消息，**规范化为内部事件**；
2. Gateway dispatch，做 **auth + dedup**（去重是 IM 场景刚需，
   消息重投是常态）；
3. `src/routing` 命中 agent + session（路由钩子、Auto-reply 规则在这层）；
4. Context Engine 组装 context：memory 召回 + `SOUL.md` 人设 +
   `AGENTS.md` 项目提示 + `TOOLS.md` 能力清单；
5. 走 50+ provider 之一调模型，含 **failover**（provider 挂了换下一家）；
6. 流式 token 回 agent runtime；
7. 期间按需发 `tool_call`（browser/cron/canvas/…）；
8. 结果回 Gateway，经 `sendMessageFeishu / sendCardFeishu` 出通道；
9. 事件总线全量广播（`event:agent/chat/presence/health/heartbeat/cron`），
   菜单栏红点、手机震动、CLI 日志都是订阅者；
10. 空 tick 间隙可能触发 Dreaming（见第四节）。

设计要点三连（报告总纲提炼）：**single control plane**——所有端
（CLI/WebChat/iOS/菜单栏/通道）共用同一个 WS 端口；**Channel 抽象**——
`src/channels` 只定义接口，真实通道全部落在 `extensions/<channel>`，
主干不依赖任何 SaaS；**channels 与 provider 对偶**——「信息从哪进」和
「模型从哪调」同一套扩展机制的两面。

## 二、Gateway 控制面：一个 WS server，三种 role

Gateway 同时干三件事：**owns**（独占连接，如 WhatsApp Baileys 会话）、
**broadcasts**（事件总线）、**serves RPC**（req:connect / req:agent /
req:send）。传输不选 REST/SSE/gRPC，是 **WebSocket 文本帧 + JSON +
严格 schema**（18789 端口默认只绑 127.0.0.1，绑 0.0.0.0 官方文档
明文警告——等于把 agent 暴露进局域网）。它要一把解决的五个问题：
协议统一（MQTT-like 的 WhatsApp、长轮询的 Telegram、macOS 桥的
iMessage 统一进一个内部协议）、认证单点（几十把 API key/通道 token/
配对密钥都从这一个点管）、事件广播、断线可恢复（`lastEventId` 续传）、
每通道健康监测。

架构是 **三类 role + 每类独立 policy 层**（handshake 时 `role` 必填，
发声明外的 method 会被拒）：

| role | 谁在用 | 关键机制 |
|---|---|---|
| operator | CLI / macOS 菜单栏 / Web UI | `auth-mode-policy` + auth-rate-limit 限流 |
| node | iOS / Android / headless | `src/pairing` 配对与 capability 声明 |
| channel | extensions/whatsapp 等 | `channel-health-monitor` + policy |

工程细节里两处最能讲（报告对照 docs/gateway/protocol.md）：

- **pre-connect challenge**：Gateway 在 `connect` 之前先发
  `connect.challenge`（nonce + ts），客户端 connect 请求必须回引 nonce。
  这是 **CVE-2026-25253 修复的一部分**——早期没有 challenge，跨站
  WebSocket 劫持的利用链就是从 control-UI 的 HTTP 端点把受害者 WS
  诱导到 attacker 的 Gateway 上。修复后 HTTP 子集被砍成「仅服务
  control-ui 的有限反射」+ Origin 校验。
- **mechanism vs policy 分层**：health-monitor 只探活，
  health-policy 决定连续 N 次失败后重连还是下线报警——同一个模式
  在 auth 层也出现（auth / auth-rate-limit 分家）。

已知缺陷（面试追问「这套单点还有什么坑」）：json5 配置误改可进
**crash loop**（issue #6028），没有「退化到只读模式」机制；rate-limit
是全局的，三种 role 共享易误杀；断线重连要客户端自存 lastEventId，
**服务端无 offline queue**，对常断网的 iOS Node 不友好。

## 三、安全模型：per-session sandbox 与「身份优先」安全观

OpenClaw 的沙箱粒度是 **per-session，不是 per-tool**：`main` session
（主人本人的会话）默认可直跑 host 命令；`non-main` session（任何
别人、任何陌生通道进来的）默认进 per-session Docker 隔离。报告将其
总结为一句产品态度：**「你是谁」比「你做什么」更重要**——工具级
策略（per-tool）永远追不完新工具，会话级身份（谁在说话）是稳定变量。
四环纵深：secrets → pairing → sandbox → tool policy（13 章口径）。

两个安全事件的复盘价值都被报告点为一级响应的正面案例：
**CVE-2026-25253**（上面 challenge 修复）与 **ClawHavoc**（extension
即 npm 包——`plugin-package-contract` 允许扩展直接 npm 分发，免自建
registry 的代价是供应链攻击面），2026-04 单月 **96 条 security-sandbox
类 PR**（报告数据集口径）。沉淀下来的结构创新就是 main/non-main
session 抽象——**报告判断：这会是未来 12 个月 agent runtime 安全的
参考实现，其他框架还没有对等物**。

## 四、Context Engine 与记忆：MD 是唯一的 source of truth

OpenClaw 记忆系统是全套主流 agent 里**最偏人类可读**的一套，三条
关键原则：

1. **MD 主动写入**：agent 自己决定「这条信息要不要进 MEMORY」，
   不是自动 dump；
2. **vector 只是加速层**：索引坏了可从 MD 重建，MD 坏了无法从
   vector 恢复——所以 workspace 整个目录可以 `git commit`，
   agent 状态变成可版本管理的资产；
3. **先 flush 后 compact，顺序固定**：压缩前先把重要事实落进 MD，
   然后才允许丢弃原文——上下文窗口管理被外部化成显式工作流。

Context Engine 是**装配线**而非拼贴板：SOUL.md（人设）/ AGENTS.md
（项目级提示，OpenClaw 自身的这份有 41KB）/ MEMORY.md（长期事实）/
`memory/YYYY-MM-DD.md`（近几日日记）/ transcript / 工具与 skill 清单 /
`memory_search` 的向量召回——**按优先级分段插入**，最近最相关的
内容永远贴着 user message。

四个记忆插件**并排不互斥**：`memory-core`（默认 sqlite-vec）、
`memory-lancedb`（生产级、multimodal）、`memory-wiki`（结构化 claim
必带来源引用 + **矛盾检测** + 过期追踪—— 把记忆升级成可审计知识库）、
`active-memory`（模式识别自动捕 preference/decision/fact/entity）。工具
侧是 `memory_search`（语义检索）+ `memory_get`（按文件+行号精确读）
组合——**先搜到大概，再确认原文**，这是结构性防幻觉设计。

两个 OpenClaw 独有/特色机制：

- **Dreaming（做梦）**：daemon 长跑的独有红利——`event:tick` 的空闲
  间隙里，agent 扫描近期日记，筛出重复事实/矛盾信息/候选长期记忆
  写入 `DREAMS.md` 建议池，**用户确认后才 promote 进 MEMORY**。多数
  agent 框架没有「空闲」概念，谈不上这个设计。
- **Compaction 三档**：aggressive（保留不足两成原文）/ balanced
  （约一半，默认）/ conservative（八成以上），per-agent 配置。

竞赛者对比一行答（报告口径）：Claude Code 无持久化、mem0 是 DB 优先、
Letta 半结构化、Hermes 自定义——只有 OpenClaw 把「MD 可 git、可手改、
可审计」当第一原则。代价是一致性（多后端并存无定义）与实时性（索引
无 rebuild 调度、flush 判定靠 agent 默认模型）都偏弱。

## 五、Skill 生态与三件套护城河

Skill 走 `SKILL.md` 契约 + ClawHub 分发；53 个内置 skill 里
coding-agent 只是八个代表作之一。报告的判断 J2 很锋利：**OpenClaw 的
护城河不在 coding，在 voice + channel + mobile node 三件套**——
「Telegram 按住说『帮妈订明天上海飞北京的机票』→ iOS node 打开去哪儿
比价 → canvas 弹三张候选卡 → 选一张 → calendar/email skill 接着办」，
**这条链没有一步发生在 IDE 里**，所有 coding harness 做不到。

生态侧量化（报告 fork 数据集）：openclaw-cn 4,695★（中国通道需求）、
DenchClaw 1,524★（企业 CRM）、EdgeClaw 1,192★（端侧）；官方仓库 PR
活力来自北美/欧洲约 20 位高产者，**中国生态、企业可观测、端侧三条
需求主线主要由 fork 承担**——「生态 >> 代码派生」的罕见形态（周边
repo 的 star 反超多数 fork）。

## 六、四个判断、三个预测、两个难题（转述给面试官的部分）

四个判断（报告结语）：

- **J1 个人 AI OS 初形**：Gateway=进程管理器，session/pairing/sandbox=
  权限层，extensions+skills=可装卸 app store，channels+nodes=外设——
  process+permission+plugin+peripherals 四件套叠出「操作系统」，
  与 coding agent 不同象限；
- **J2 护城河在 voice+channel+mobile node**（见上）；
- **J3 社区活力长在 fork 外部**，官方对「中国生态+企业可观测」欠账；
- **J4 安全是试金石不是短板**：经历两个事件后沉淀为四环纵深 +
  main/non-main 结构创新。

三个预测（报告观点，非官方 roadmap）：**微信/钉钉/企业微信官方
extension 将在 2026 下半年出现**（fork 前 5 里 3 个是这需求；半年不
发生 = 法务卡住或战略退守英文市场）；**Gateway HA/多租户将以
`openclaw-server` 独立产品出现**（单点是最痛设计问题，企业化是下一轮
分叉点）；**记忆将重写为事件型**（commitment/preference 级别的
「agent 个人 CRM」，而不是 transcript 向量化）。

两个未解难题：**mobile node 能力地板**——iOS 不允许真 shell、
Android 厂商杀后台无解（做到 80 分，永远到不了 100 分）；**skill 的
行为级审计**——静态签名+VirusTotal 在 skill 过万后必然不够，
「恶意 prompt 式 skill」无法算法识别，ClawHub moderation 可能要上
人工团队，开源圈尚无解。

## 七、▶ 面试题

**Q1【高】OpenClaw 与你熟悉的 coding harness 最大区别是什么？**
形态级区别：coding harness 是「IDE 里的工具」，OpenClaw 是「用户自己
跑的 personal AI 网关」，Gateway 进程 + 多端 Node 是结构性的，不是
功能多少的问题——所以能做「Telegram 语音 → iOS node 执行 → canvas
呈现」这种全程不在 IDE 里的链路。coding 只是它 53 个 skill 之一（J2）。

**Q2【高】把控制面做成单点 Gateway，收益和代价怎么答？**
收益：全端一个 WS 协议（operator/node/channel 三 role）、认证/事件/
健康监测都只有一个点要管、跨端 session 可见性；代价：crash loop 无
降级（#6028）、全局限流粒度粗、无 offline queue、HA 要整个产品化
（openclaw-server 预测）。答题结构：先讲为什么单点是对的（IM 协议
异构、多端共享），再讲三个已知坑和业界可能的修法（read-only 降级、
按 role 分桶限流、服务端 event queue）。

**Q3【高】MD-first 记忆 vs DB-first，你怎么评价？**
收益：人可读可手改可 `git commit`、索引坏了可重建（方向反过来就
不行）、audit 友好（memory-wiki 的 claim 带来源引用与矛盾检测）；
代价：一致性（多后端并存行为无定义）、实时性（索引 drift 无 rebuild
调度）、搜索上限（LLM 读大 MD 低效，必须靠 vector 加速层兜住）。
扣回本仓 [记忆与上下文工程](./记忆与上下文工程.md) 的三分法——
OpenClaw 选的正是「外置显式资产」路线的极端形态。

**Q4【中高】为什么沙箱做 per-session 而不是 per-tool？**
「你是谁比你做什么更重要」：工具永远在增，策略追不完；会话身份是
稳定变量。main/non-main 二分把「主人全权/外人隔离」变成结构而非
配置，修 CVE-2026-25253 后这套又加上了 pre-connect challenge 的
握手层。答题加分：对比 codex 的审批×execpolicy×平台沙箱三层——
那边是「怀疑一切操作」，OpenClaw 是「信任先验到身份」。

**Q5【中】Dreaming 和 Compaction 为什么必须「先 flush 后 compact」？**
顺序反了就把原文丢进了不可恢复的压缩器。这是把「上下文窗口管理」
从黑盒变成了显式数据流：会话逼近阈值 → 重要事实 flush 进 MD →
再按三档策略压缩历史。追问「flush 判定谁来做」——报告直言是 agent
默认模型，成本与质量都没有独立控制，这是该设计的真实弱点。

**Q6【中低】359k star 的项目，你能从 fork 结构读出什么？**
官方 PR 活力集中在 20 位北美/欧洲高产者；中国生态、企业可观测、
端侧三条主线全在 fork 上（openclaw-cn 4695★ 等）；周边（awesome/
教程/RL 项目）star 反超绝大多数 fork——「生态 >> 代码派生」是
判断这个项目健康度的独特样态，也是「官方吸收成熟 fork」路径的
依据（微信/钉钉预测的推理链）。

## 八、口径与未核实说明

1. 本文全部机制与数字来自 `xiaonancs/openclaw-study` 深读报告
   （基线 v2026.4.15 / commit c56b56e / 数据快照 2026-04-17），该报告
   自称引用源码路径 100+ 条与量化数据集 40+ 份，但**本仓未读 openclaw
   原仓源码、未复测任何数字**，引用时注明「报告口径」。
2. star/fork/issue 数随时间漂移，359,217 为快照值，与本仓生态篇的
   「90k 增长」叙事是不同时点口径（增长叙事用的是早期窗口），二者
   不矛盾但引用时要带日期。
3. 三个预测（微信/钉钉 extension、openclaw-server、事件型记忆）与
   两个未解难题为报告作者观点，非官方 roadmap。
4. CVE-2026-25253 与 ClawHavoc 的事件细节按报告转述；机制层面的
   pre-connect challenge / Origin 校验修复归报告对照
   docs/gateway/protocol.md 的结论，未逐一核对 commit。

## 九、串联阅读

- [Hermes 与 OpenClaw 生态专题](./hermes与openclaw生态专题.md)：本篇
  上半场——90k 增长拆账、EvoMap 争议与四范式分类学；
- [记忆与上下文工程](./记忆与上下文工程.md)+[上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md)：
  OpenClaw 的 MD-first/flush-compact 是「压缩谱系」的产业级对照组；
- [agent记忆产品化专题](./agent记忆产品化专题.md)：memory-wiki 的
  claim/证据结构在该篇的产业化框架下看得更清楚；
- [Codex 源码分析](./codex源码分析.md)：云端控制面网关 vs 钱包里
  自己跑的网关——两种安全哲学的参照系；
- [工具调用与 MCP](./工具调用与mcp.md)：channels/provider 对偶与
  106 扩展体系给「工具生态」一章提供最重的现实样本。
