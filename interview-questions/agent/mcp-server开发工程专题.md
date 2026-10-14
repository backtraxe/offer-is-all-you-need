# MCP Server 开发工程专题：工具设计学、双层错误与 Inspector→Registry 交付线

> **面向**：已读过 [工具调用与mcp](./工具调用与mcp.md)（MCP 是什么、三类原语、
> 协议全景）与 [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)（供货侧与
> 最后一公里、JSON-RPC 生命周期）的读者。概念与对比那两篇已经讲完，本篇只回答
> 一件事：**怎么写出一个好用的 MCP server**——从选 SDK、设计工具面、处理错误、
> 过安全线，到用 Inspector/conformance 测、上官方 Registry 发。
>
> **读完获得**：① 官方 SDK 十语言矩阵与 FastMCP 两段历史；② 协议版本时间线
> （2024-11 首版 → 2026-07-28 draft 无态化）的硬口径；③ Anthropic
> 「为 agent 写工具」方法论的完整拆解：描述即 prompt engineering、粒度与
> namespace、自然语言标识、response_format、25,000 tokens 预算、截断指路、
> ToolAnnotations 四 hint；④ 错误双层模型（protocol error 是墙、isError 是路）
> 的答题金句；⑤ 传输与安全硬约束（stdout 禁写、Origin 校验防 DNS rebinding、
> OAuth 2.1 + RFC 9728/8707、禁 token passthrough）；⑥ Inspector、conformance、
> Registry 三段交付线；⑦ filesystem / GitHub / postgres 三个官方案例的取舍拆账；
> ⑧ 两道高频面试题（工具描述后果链、缓存四层）的完整答法。
>
> **时效口径**：素材口径 **2026-10**；版本与日期按官方文档与规范原文括注，
> 实测数据按 Anthropic 工程博客口径转述。未核实项见文末「口径与未核实说明」。

## 〇、主线一句话：MCP server 是写给模型读的软件，三面都要过

把一个 MCP server 从「能跑」做到「好用」，本质是同时过三面：**设计层**——
schema 与描述是写给模型看的系统提示；**运行层**——传输、错误、安全决定
agent 在失败时能不能自己爬起来；**交付层**——Inspector/conformance/Registry
决定别人敢不敢装你的 server。本篇七节就是这三面的展开：先用 SDK 与时间线
定位你在哪个时代（第一节），再给设计层四块料（第二节，全篇最重）、运行层
两块料（错误 + 传输安全，第三、四节）、交付线三段（第五节），最后用三个官方
案例验证这套框架真的有人在用（第六节），落到面试口径（第七节）。

<div class="diagram-embed">
<iframe src="assets/diagrams/mcp-server-engineering.html" width="100%" height="840" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/mcp-server-engineering.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、SDK 矩阵与协议版本时间线

### 1.1 官方 SDK 全家福与选型口径

截至 2026-10，官方 modelcontextprotocol 组织维护的 SDK 覆盖 **十种语言**：
C#（与 Microsoft 合作）、Go、Java、Kotlin、PHP、Python、Ruby、Rust、Swift、
TypeScript。不是让你背清单，而是记住几条选型口径：

- **Python（mcp 包）**：生态最大，官方 Build-a-server 教程已要求 Python MCP
  SDK 2.0.0+。声明式写法：函数 type hints + docstring 自动生成 tool 的
  JSON Schema 与描述——「函数即工具」的主线。
- **TypeScript（@modelcontextprotocol/sdk）**：分两条线——v2 monorepo
  （主线，面向新规范时代）与 v1.x 已发布线（npm v1.29.x 系列，维护旧时代
  compat）；官方 conformance 仓库把两个版本作为独立条目跑测试。
- **Java**：官方 SDK + Spring AI 集成，`spring-ai-starter-mcp-server` 用
  @Service + @Tool 注解自动注册，配 `spring.ai.mcp.server.protocol=STREAMABLE`
  即得 Streamable HTTP server，要求 Java 17+ / Spring Boot 3.3+。
- **Kotlin / C# / Go**：Kotlin 需 JDK 11+；C# 走 ModelContextProtocol NuGet +
  Microsoft.Extensions.Hosting（.NET 8+）；Go 官方 go-sdk 要求 Go 1.24+，
  stateless/stateful 由启动参数决定。

**能力矩阵的正确说法**（面试加分项）：所有官方 SDK 都覆盖 client+server、
stdio+Streamable HTTP、tools/resources/prompts 三原语；但高级原语——sampling、
roots、elicitation、tasks（SEP-1730 分级中的实验扩展）、structured content /
outputSchema——各 SDK 落地程度不一，**应以 conformance 测试的 tier-check
结果为准，而不是文档宣称**。

### 1.2 FastMCP 的来龙去脉（高频考点，两段别搞混）

- **FastMCP 1.0**（原 jlowin/fastmcp）2024 年被并入官方 Python SDK，成为
  `mcp.server.fastmcp` 模块——所以「FastMCP 是不是官方的」答案是一度是。
- **FastMCP 2.x/3.x** 现归属 Prefect（PrefectHQ/fastmcp）独立维护。官方自述
  每天约 100 万次下载、约 70% 的 MCP server（跨语言）由某个版本的 FastMCP
  驱动。FastMCP 3 提供 server/client/apps 三支柱，装饰器即工具（@mcp.tool），
  自动生成 schema、校验、文档；另有 TypeScript 版（@prefecthq/fastmcp-ts）。

面试口径：**低层 SDK（Server + handler 注册）表达力强但啰嗦；FastMCP 类高层
API（函数即工具）覆盖约九成场景**；生产 HTTP server 要注意 ASGI 模式部署
（uvicorn）与单例状态管理。

### 1.3 协议版本时间线（必须熟的硬口径）

| 版本日期 | 关键变化 |
|---|---|
| 2024-11-05 | 首版，HTTP+SSE 传输 |
| 2025-03-26 | 引入 **Streamable HTTP**（单端点 POST/GET、SSE 可选、Mcp-Session-Id 会话、可恢复流），取代并废弃 HTTP+SSE；同时引入 ToolAnnotations |
| 2025-06-18 | OAuth 2.1 授权成体系（resource server + RFC 9728 资源元数据 + RFC 8707 audience 绑定）；outputSchema/structuredContent 结构化输出；elicitation（server 向用户反问表单）；resource_link 内容块 |
| 2025-11-25 | 含 tasks 等扩展的修订（长任务一等公民的前奏） |
| 2026-07-28（draft） | 无状态生命周期：per-request `_meta` 携带协议版本与能力，替代 initialize 握手；Inspector 与 conformance 已按 legacy（stateful）vs modern（stateless）两个 era 做协商 |

两个工程细节常考：HTTP 请求必须带 **MCP-Protocol-Version** 头，缺省时 server
必须按 2025-03-26 假设（向后兼容要求）；2026-07-28 的无态化意味着「每次请求
自报家门」，为多实例无亲和部署铺路。

## 二、工具设计学：全篇核心

本节素材主线来自 Anthropic 工程博客「Writing effective tools for agents」，
是全篇被问频率最高的一节。

### 2.1 心智模型：工具是契约，不是 API 封装

**工具是确定性系统与非确定性 agent 之间的新型契约。** 为 agent 写工具 ≠
为开发者写 SDK，因为 agent 的 affordance 完全不同：上下文是有限的，记忆是
逐 token 读的。所以「返回全部让模型自己选」是一种浪费——经典反例是通讯录：
让 agent 从 A 到 Z 暴力翻页找联系人， vs 提供一个 `search_contacts` 直接定位。
前者消耗的是最稀缺的资源（context window），后者才是 agent-native 的设计。

### 2.2 Schema 与描述：描述即 prompt engineering

- **写法标准**：如同向新入职同事解释这个工具——隐含约定（查询语法、领域
  术语、资源间关系）必须显式化，模型不在你的团队里没有 tribal knowledge。
- **参数命名**：避免 `user` 这类含混泛指，用 `user_id`；用 strict JSON
  Schema（enum、min/max、required）把可填空间收窄。
- **示例**：描述里给 1-2 个 concrete 调用示例，可显著降低参数幻觉。
- **实测证据**两条：其一，Anthropic 内部 web search 工具曾发现 Claude 总往
  query 里追加「2025」，污染结果、拉低效果——最后靠**改工具描述**纠回来；
  其二，Claude Sonnet 3.5 在 SWE-bench Verified 上的 SOTA 表现，部分归因于
  工具描述的精调，错误率与任务完成率双双改善。
- **自我一致性**：多个工具的描述互相引用、语义不冲突；重构时可借 Claude
  Code 批量保持描述与实现一致。

金句记好：**工具描述本质是写给模型读的系统提示，写不好等于系统提示被污染。**

### 2.3 工具粒度：一个 server 多少工具、每个工具多大

- **反模式**：一个 API 端点包一个工具的「机械包裹」。改成围绕高价值工作流
  合并：`schedule_event`（找空档 + 建会一步到位）替代
  list_users / list_events / create_event 三件套；`get_customer_context`
  （聚合客户近期全部相关信息）替代 get_customer_by_id / list_transactions /
  list_notes。
- **合并的收益**：减少中间结果占上下文；把「多步 commit」下沉到工具内减少
  往返；降低模型选错路径的概率。
- **太多/重叠工具的代价**：分散模型注意力；每个工具名 + schema + 描述都要
  进 system prompt，描述本身吃上下文；两个职责重叠的工具让模型随机横跳。
- **命名空间（namespacing）**：按 service/resource 前缀分组（asana_search、
  jira_search、asana_projects_search）。**Anthropic 实测：前缀 vs 后缀命名
  对评估结果有非平凡影响，且结论随模型变化**——拿你自己的 eval 决定，别抄
  作业。
- **上限口径**：单 server 建议个位数到十来个精挑细选的工具；超出就拆
  server 或拆 toolset（GitHub 案例见 6.2）。生态视角要记住：模型可能同时
  面对几十个 server 数百个工具，**你的描述在和别家工具竞争注意力**。

### 2.4 返回内容的上下文预算（数字锚集中地）

1. **只回高信号字段**：`name / image_url / file_type` 优于
   `uuid / 256px_image_url / mime_type`。实测：把 opaque UUID 解析成自然语言
   标识（或 0-indexed id）能显著降低检索任务中的幻觉、提升精度。
2. **技术 id 的下簧**：下游调用又可能需要技术 id（search_user(name=…) →
   send_message(id=12345)）。解法是 **response_format enum 参数**
   （concise/detailed）。Anthropic 示例口径：**detailed 206 tokens vs concise
   72 tokens，省约三分之二**。
3. **响应格式也影响评估**（XML/JSON/Markdown 没有普适最优，跟各模型训练分布
   有关），用你自己的 eval 选。
4. **截断与分页模式**：凡可能爆上下文的返回，组合使用 pagination（cursor）、
   range selection、filtering、truncation + 合理默认值。**Claude Code 工具
   返回上限默认 25,000 tokens**——这是全篇最该背的数字。
5. **截断必须指路**：返回里明确说明已被截断、如何拿下一页/缩小查询（暗示
   模型多次小而精确的搜索优于一次大而化之）；绝不能让模型在无声截断的数据
   上得出错误结论。
6. **结构化输出**：outputSchema（2025-06-18 起）让 server 在
   structuredContent 返回机器可读 JSON，client SHOULD 校验；为向后兼容，
   返回 structured content 的 server SHOULD 同时在 TextContent 放一份序列化
   JSON。
7. **内容类型分工**：text / image / audio / resource_link / embedded
   resource——只给引用用 resource_link（可订阅），内嵌用 embedded resource。

### 2.5 ToolAnnotations 四 hint（2025-03-26 起）

四个布尔 hint——**均为 hint 而非安全保证，client 不可据此放行敏感操作**：

| hint | 语义 | 正确用途 |
|---|---|---|
| readOnlyHint | true = 不改变环境；false = 写操作 | client UI 分级：只读可直接跑 |
| destructiveHint | 可能强删/覆写已有数据；仅当 readOnly=false 时有意义；false 表示仅追加式更新 | destructive 强制用户确认 |
| idempotentHint | 相同参数重复调用无副作用差异；仅当 readOnly=false 时有意义 | 客户端可以安全自动重试 |
| openWorldHint | true = 与开放外部世界交互（搜索、发消息出域）；false = 封闭域（本地文件、内存计算） | 风险评估与外发提示 |

标错的代价两头都是坑：要么过度打扰用户（狼来了式确认框），要么把危险操作
放跑。filesystem 参考实现的教科书级标法见 6.2 的矩阵表。

### 2.6 设计工作流：evaluation-driven

Anthropic 给出的闭环值得整条背下来：**prototype**（本地 MCP server 接
Claude Code/Desktop 手测）→ **生成贴近真实数据的 evaluation tasks**（强任务
要多步几十次调用、结果可验证；弱任务 = 一把 identifier 就能混过）→
**程序化跑 agent loop 收集指标**（top-level 准确率、调用次数、token 消耗、
工具错误率、单 task 时长）→ **读模型 reasoning 定位问题** → 用 Claude Code
批量改描述/schema → **held-out test set 防过拟合**。指标信号翻译：大量冗余
调用 → 分页/limit 默认值有问题；大量参数无效错误 → 描述/schema 不清晰。
这套闭环在第五节会升级成「Inspector + conformance + 自定义 eval」三层交付线。

## 三、错误处理：双层模型（高频考点）

### 3.1 Protocol error 是墙，isError 是路

MCP 的错误天然分两层，面试要能画出这条分界：

- **Protocol errors**：JSON-RPC 错误响应，表达协议/参数层面的问题——未知
  工具、无效参数（-32602 Invalid params，连无效的分页 cursor 也用它）、
  server 内部错误。**这种错误模型 agent 层通常只拿到「调用失败」四个字，
  无法自我修正**——像一堵墙。
- **Tool execution errors**：业务层失败（下游 API 挂了、输入数据违规、业务
  逻辑拒绝）——应返回正常的 CallToolResult，但置 `isError: true`，原因写在
  content 里。这是关键设计：**isError 的响应仍然进入模型上下文**，模型看到
  失败原因后可以改正参数重试或换工具——是一条路。

面试金句：「能教模型下一次不要这么调的错误，用 isError=true 写进结果；模型
无法纠正的错误（协议层、未知工具），用 JSON-RPC error。」

### 3.2 错误内容的工程

- **错误消息本身也是 prompt**：要 actionable。反例：「Error: input must be
  a string」；正例：说明期望格式、给正确入参示例（ISO 8601 日期、参数拼写
  建议），让模型自我纠偏。
- **不要把 traceback/内部实现细节漏进 content**：信息安全（泄露内部结构）+
  浪费 token + 教不会模型任何事，三输。
- **错误分类**：可恢复（参数错、限流、暂时性下游 5xx——重试/改参可解）vs
  结构性失败（认证过期、资源不存在、配置错误——明确告诉模型别盲目重试，
  给人类可读指引）。
- **官方 spec 的安全要求**：server MUST validate all tool inputs、限流
  （rate limit tool invocations）、sanitize tool outputs（防返回内容携带
  注入）；client SHOULD 对敏感操作要用户确认、把工具入参展示给用户防数据
  外泄、对 tool 结果做校验再喂给 LLM、实现超时、日志审计。

### 3.3 超时、取消与长任务

- **客户端超时**：client SHOULD implement timeouts for tool calls；server 应
  支持 notifications/cancelled（stdio 发取消通知；Streamable HTTP 关闭请求
  对应的响应流）并及时释放资源。注意一个坑：**Streamable HTTP 下「连接断开
  不等于取消」**——客户端应显式发 CancelledNotification。
- **长任务**：用 ProgressNotification（progressToken）汇报进度；实在没法
  取消的耗时任务建议拆「submit + poll status」两个工具（任务化设计，对应
  2025-11-25 的 tasks 实验扩展）。
- **错误码设计口径**：工具层不建议顺手抄 HTTP 风格——用具名语义
  （invalid_params / upstream_timeout / not_found 的 message + 可控的 data）；
  协议层严格 JSON-RPC code。

## 四、传输与安全

### 4.1 传输选型：stdio vs Streamable HTTP（HTTP+SSE 已弃用）

**stdio**：

- client 以子进程启动 server，stdin/stdout 走换行分隔的 JSON-RPC；生命周期
  1:1 绑定。
- **铁律：stdio server 往 stdout 写任何非 MCP 消息都会腐坏 JSON-RPC**——
  Python 别用 print（走 logging → stderr）、TS 别用 console.log（用
  console.error）、Java 别用 System.out、Rust 别用 println!。这是最便宜也
  最常见的生产事故。
- 鉴权：spec 明确 stdio 不走 OAuth 流程，凭证从环境变量取
  （GITHUB_PERSONAL_ACCESS_TOKEN 等）——信任边界在本机。

**Streamable HTTP**（2025-03-26 之后唯一的 HTTP 标准）：

- 单一 MCP endpoint 同时支持 POST 与 GET；POST 的 Accept 必须同时列出
  application/json 与 text/event-stream；server 可选回 SSE 流或纯 JSON；
  GET 用于 server → client 的独立 SSE 通道。
- **会话管理**：Mcp-Session-Id 头（初始化时 server 可分配，需密码学安全的
  UUID 类随机值），后续每个请求必须带；server 终止会话后对旧 id 应回 404，
  client 据此重新 initialize；client 可 DELETE 显式结束会话。
- **可恢复性**：SSE 事件可带 id，断线重连用 Last-Event-ID 头续传（按 stream
  维度的游标）。
- **多连接**：同一会话可有多条 SSE 流，server 每条消息只发在一条流上，
  不得广播。
- **安全硬性要求**：MUST 校验 **Origin 头防 DNS rebinding 攻击**；本地部署
  应 bind 127.0.0.1 而非 0.0.0.0；应做认证。
- **旧传输兼容**：支持老 HTTP+SSE 的 server 双端点并行；client 探测策略：
  先 POST InitializeRequest，拿到 4xx 则回退 GET 开 SSE 流。

选型口径一句话：本地桌面/IDE（Claude Desktop、VS Code、Cursor）→ stdio
（生命周期托管、进程级隔离）；远程/团队共享/多租户/网关化 → Streamable
HTTP（无状态横向扩容 + 可选 SSE 流式 + OAuth 承接）。自定义传输：协议本身
传输无关，但必须保住 JSON-RPC 帧格式与消息模式；跑在可靠双向字节流上的
定制传输 SHOULD 复用 stdio 的分帧。

上面**可恢复性**一行，生产上要扩成一整套**断线重连续传工程化**：

- **事件 id 设计**：单调递增游标（per-stream 序号或 uuidv7 类时间有序
  id），别用裸时间戳——时钟回拨与多实例并发写会撞序。client 只需记住
  自己消费到的最后一个 id。
- **服务端环形缓冲**：每条流保留最近一段事件，窗口大小**经验量级几百到
  几千条每流**，够覆盖一次正常断线重连的间隔即可；缓冲是纯内存成本，
  与并发流数成正比，容量规划时别忘了它。
- **续传协议**：client 重连时带 `Last-Event-ID` 头，server 在缓冲里找到
  该 id 就重放其后全部事件；找不到（id 已被挤出窗口）回约定错误信号，
  client 走降级。SSE 原生 `retry:` 字段可下发服务端建议的重连间隔。
- **客户端幂等消费**：重放窗口与断线瞬间重叠的事件会重复投递，消费者
  必须按事件 id 去重——「恰好一次」是幻想，幂等才是地基。
- **重连与降级**：指数退避加抖动防惊群；缓冲丢失时降级为重新拉取完整
  state 快照再续流——事件流只负责增量，全量永远以 state 为准。
- **对端 Agent 场景的意义**：长任务（几十分钟级的 deep research、编码
  任务）靠 progress 事件流驱动 UI 与下游编排，续传能力直接决定「任务
  跑到一半刷新页面还能不能接上」，是 MCP 长任务体验的隐形地基。

口径收束：可恢复性 = **单调游标、环形缓冲、幂等消费**三件套；缓冲丢了
就认栽回全量快照，别在增量流里硬凑一致性。

### 4.2 OAuth 2.1 授权（2025-06-18 的关键变更）

**角色模型**：MCP server = OAuth 2.1 resource server（验 token）；MCP
client = OAuth client（代表 resource owner 请 token）；authorization server
独立于 MCP 之外。

**规范栈四件套**：

- **OAuth 2.1**（draft-ietf-oauth-v2-1）：PKCE 必须；confidential + public
  client 都得支持；refresh token 必须轮换；全程 HTTPS、redirect URI 限
  localhost 或 HTTPS。
- **RFC 9728（Protected Resource Metadata）**：server MUST 发布
  `/.well-known/oauth-protected-resource` 元数据声明 authorization_servers；
  401 时必须用 WWW-Authenticate 头指到元数据 URL。**这是 2025-06-18 相对
  2025-03-26 的核心变化**（旧版 server 直接内嵌 AS 元数据）。
- **RFC 8414 / RFC 7591**：AS 元数据发现授权端点；Dynamic Client
  Registration 让 client 自助注册拿 client_id——MCP 场景刚需，因为 client
  预先不知道会遇到哪些 server；不支持 DCR 的 AS 退化为人工注册 + UI 输入。
- **RFC 8707（Resource Indicators）**：resource 参数 MUST 出现在授权请求与
  token 请求中 = 把 token 绑定到目标 server 的 canonical URI（小写
  scheme+host、无 fragment、不带尾斜杠）；server MUST 校验 audience。

**防线三条硬禁令**（背下来）：**MCP server 禁止把收到的 token passthrough
给上游 API**（上游要独立发 token）；**禁止接受不是为本 server audience
签发的 token**；access token 不得出现在 query string，只能走
`Authorization: Bearer` 头，且短 TTL。错误语义：401 = 需认证/token 无效，
403 = scope 不足，400 = 请求畸形。

代理特殊坑：MCP proxy server 用静态 client_id 转发到第三方 AS 时，必须为
每个动态注册的 client 单独取得用户同意（confused deputy 防线）。

授权放行只是准入，用户在工具粒度上还能随时说不。**被拒绝后的降级闭环**
有四级，缺一级就会卡死或空转：

1. **拒绝信号写入会话 state**：落成结构化的 tool_denied 事件（带工具名
   与用户给的拒绝原因），不是往上下文里塞一句「调用失败」的字符串。
2. **替代工具选择**：规划器看到拒绝后换路径——只读替代、换数据源、
   把「帮你执行」降级成「给你建议步骤」。
3. **部分结果交付**：明确标注哪一步被用户跳过、下游结论的可信边界
   在哪，不许假装全链路都跑了。
4. **answer 兜底回答**：一条数据都拿不到，也要交付方法论与手工操作
   步骤，不能空转或直接摆烂。

**权限范围与确认频次的权衡**：scope 收得越窄，确认弹窗越少；但反过来
「每次调用都确认」会把用户训练成无脑全点同意（确认疲劳），安全形同
虚设。口径是只读工具靠 scope 收窄免确认、destructive 类
（destructiveHint=true）永远确认、中间地带用「本会话内记住选择」折中。

**拒绝原因必须回传规划器**：模型不知道「用户拒绝了 X、原因是 Y」时，
最常见的反应是原地重试同一个调用——这是 Agent 死循环的经典来源之一。
配合「同工具连续被拒 N 次强制换路径」的硬规则收尾，拒绝通道才算闭环。

### 4.3 多租户 server 的鉴权与隔离

- **身份边界在 token**：每个请求独立验签 + aud 校验，不存在「会话级信任」；
  HTTP 模式下 spec 明确每个请求都必须带 Authorization（即使同一会话）。
- **数据隔离**：用 token 的 subject/tenant claim 做下游数据作用域（行级
  过滤）；**绝不许跨租户共享缓存放感数据——缓存 key 必含租户维度**。
- **会话隔离**：Mcp-Session-Id 是流程状态而非身份标识，必须密码学安全
  随机、可吊销，防止被猜/复用。
- **最小权限工具面**：公网多租户 server 常配 toolset 白名单 + read-only
  模式（GitHub 案例），配合 destructiveHint 让 client 侧强制确认。
- **日志审计**：工具调用日志（who/what/params hash）是合规底线；token 与
  密钥绝不落日志。

## 五、测试与发布

### 5.1 MCP Inspector（首选调试工具）

- 官方包 `@modelcontextprotocol/inspector`，Node 22.19+，`npx` 零安装拉起。
  一个二进制三种界面：**Web**（默认，浏览器 GUI，看 JSON-RPC wire 流量的
  monitoring 侧栏、逐步调用工具）、**CLI**（--cli，可脚本化、机器可读，
  适合 CI 与 agent 自动化）、**TUI**（--tui，终端交互）。
- 三界面共享同一核心：传输、配置文件、OAuth 状态、协议 era 协商
  （legacy vs 2026-07-28 stateless）。
- 用法：`npx @modelcontextprotocol/inspector` + server 启动命令
  （uvx mcp-server-git / npx 包），或 `--server-url` 直指远程 HTTP server。

### 5.2 官方 conformance 测试（SDK 级合规，server 也可跑）

```bash
npx @modelcontextprotocol/conformance server --url http://localhost:3000/mcp
```

- **原理**：以 client 身份打你的 server，跑场景（server-initialize、
  tools-list、tools-call-*、resources-*、auth 套件），对照 spec 检查；且
  每条线上的 JSON-RPC 消息都按协商版本的 JSON schema 校验（wire-schema-valid
  check）。
- **工程化三件套**：`--expected-failures` YAML 基线让 CI 只抓回归，可精确
  到单个 check（scenario:check-id）；`--requirements <revision>` 跑「某次
  发版真正需要的场景集」（冻结在历史，防止 suite 增长回杀旧实现）；
  tier-check 按 SEP-1730 评 SDK 分级（conformance 通过率 + issue triage +
  P0 处理，一半机器判定一半人工）。
- **面试口径**：别只说「我用 Inspector 测通了」——「**conformance +
  Inspector CLI + 自定义 eval**（Anthropic 工具评估 cookbook）」三层才是
  成熟打法：Inspector 做交互调试，conformance 保规范合规，自定义 agent
  eval 测「模型用得好不好」（描述、schema、返回预算的迭代依据）。

### 5.3 官方 Registry 发布（2025-09 起）

- **时间线**：2025-09-08 Registry 预览上线
  （registry.modelcontextprotocol.io）；2025-10-24 API freeze v0.1（一个月+
  稳定期供集成商适配，预告 GA v1）。
- **定位**：公开 server 的「单一可信源 + app store」；允许社区/企业建
  sub-registry——公共 marketplace 可叠加自家策略、企业内部私有 registry
  共享 API schema。
- **发布方式**：**不是给 registry 仓库提 PR**！在你自己的项目里用
  `mcp-publisher` CLI，`server.json` 描述清单（名称、包、远程端点、版本）。
- **命名空间所有权校验**：`io.github.<你的账号>/*` 需 GitHub OAuth 登录或
  GitHub Actions OIDC；`<你的域名反写>/*` 需 DNS 或 HTTP 挑战验权。
- **治理**：违反 moderation 准则（恶意、仿冒、烂内容）可被社区 issue 举报、
  维护者 denylist 追溯下架。

面试一句话：「发布 = mcp-publisher + server.json + 命名空间验权；分发不是
PR，也不是往某个 Awesome 列表投简历。」

## 六、实战案例拆解

### 6.1 filesystem（modelcontextprotocol/servers，TS 参考实现）

- **安全模型：双轨目录白名单**。启动参数静态指定 + MCP Roots 协议动态下发；
  支持 roots 的 client 侧变更（roots/list_changed）实时整体替换允许集，工具
  调用在根更新未取回前会等待；撤销 root 后所有路径立即拒绝（Access denied -
  no allowed directories）；裸启动 + client 不支持 roots 则直接初始化失败
  退出 1。**取舍的要点：把访问控制做成「协议原生能力协商」而不是配置文件，
  安全边界归宿主（client 端用户）而非 server。**
- **工具集 13 个**：覆盖读写编辑移动搜索树 metadata。细粒度取舍值得抄：
  read_text_file 带可选 head/tail（避免大文件爆上下文，两者不可同用）；
  write_file 覆盖写保留 inode/权限但非 crash-atomic（README 如实写明）；
  edit_file 支持 dryRun 先预览 diff（推荐 always dryRun first）；
  read_media_file 按 MIME 返回 image/audio/embedded resource；
  **list_directory 与 list_directory_with_sizes 拆成两个工具**——经常不用
  size，省下每一行都是 token。
- **Annotation 矩阵是教科书**：九个只读工具（read_text_file / read_media_
  file / read_multiple_files / list_directory / list_directory_with_sizes /
  directory_tree / search_files / get_file_info / list_allowed_directories）
  全部 readOnlyHint=true；create_directory：readOnly=false、idempotent=
  true、destructive=false（重复建同目录是 no-op）；write_file：idempotent=
  true、destructive=true（覆盖，但同内容重写结果相同）；edit_file：
  idempotent=false、destructive=true（重复应用 edit 可能失败或双应用）；
  move_file：idempotent=false、destructive=true（删源文件、目标存在即失败）；
  所有工具 openWorldHint=false（封闭域）。注意 spec 备注：idempotent/
  destructive 仅在 readOnly=false 时有意义。
- **部分成功语义**：read_multiple_files 单文件失败不会整体失败；路径遍历
  均被限制在允许目录内（sanitize）。

### 6.2 GitHub 官方 server（github/github-mcp-server，Go）

- **双形态**：自托管本地版（env GITHUB_PERSONAL_ACCESS_TOKEN，stdio）+
  GitHub 托管远程版（`https://api.githubcopilot.com/mcp/`，Streamable HTTP，
  OAuth 或 PAT，VS Code 1.101+）——同一个代码库打两种部署形态，是「SDK
  抽象传输」的样板（替代已归档的参考版 GitHub server）。
- **工具面治理是核心设计**：`--toolsets` 按功能分组开关（repos、issues、
  pull_requests、actions、code_security、context、gists、discussions、
  security_advisories、stargazers、users、orgs、notifications、projects 等），
  特殊值 all / default；环境变量 GITHUB_TOOLSETS 优先于命令行；`--tools`
  可精确单开某工具、与 toolsets 叠加（additive）；`--read-only` 的
  **优先级最高——即使 --tools 明确点名写操作也会被跳过**。官方 README 原话：
  「Enabling only the toolsets that you need can help the LLM with tool
  choice and reduce the context size」——工具面收敛 = 降低选错率 + 省上下文，
  且 toolset 不止影响 tools，相关 MCP Resources 和 Prompts 一并随组启用。
- **经验**：大型 API 面（GitHub REST API 百级端点）的正确打开方式不是全量
  铺工具，而是**分组默认 + 按需精准开通 + read-only 硬开关**；同时用远程
  托管版把 OAuth 之类复杂度留给平台。

### 6.3 PostgreSQL 参考实现（已归档于 servers-archived，但仍是经典教案）

- **极简工具面**：就一条 query 工具 + 把数据库 schema 以 resources
  （schema://host/table）方式暴露——「**工具做动作，resources 做只读
  数据**」的职责分工。
- **只读强制的工程手段**：所有 SQL 在只读事务中执行——即便模型被注入诱导
  出 DELETE/DROP，DB 层也会拒绝。**防御放在数据库层而非 prompt 层。**
- **口径**：这组取舍正是面试里答「prompt injection 怎么防」的具体化——
  不信任模型输出的 SQL，把权限收窄到执行层。「**能只读就只读 + annotation
  标注 + 执行层兜底**」三层惰性防线。
- 备选佐证：fetch 参考实现把 robots.txt 尊重（autonomous-agent 模式下按
  robots 拒绝抓取）与 truncation 参数（max_length/start_index）做成工具
  参数的一等公民——佐证 2.4 的上下文预算模式不是 Claude Code 独有约定。

## 七、面试两问口径

### 7.1「工具描述写不好有什么后果？」

立体后果链，五条层层递进：

1. **选错工具**：description 与兄弟工具语义重叠/含糊 → 模型在边界场景掷
   硬币（实证：Anthropic 的 namespace 实验，改命名方案评估分数有非平凡
   变化）。
2. **用对工具写错参数**：参数名含混（user vs user_id）、缺格式示例 → 参数
   幻觉 → isError 失败率增高（实证：web search 工具中模型擅自往 query 拼接
   「2025」bias 结果）。
3. **上下文与成本浪费**：描述臃肿、返回值无 budget 设计 → system prompt 和
   tool result 双头吃 token（Claude Code 默认 25,000 tokens 上限不是摆设）。
4. **安全事故放大**：destructive 工具描述不清 → 模型误触发覆写/删除；
   annotation 标错 → 客户端确认 UI 分级失效。
5. **复合退化**：多步 agent 里早期一个错调用污染后续推理，反馈循环放大。

一句话收口：「工具描述本质是写给模型读的系统提示，写不好 = 系统提示被污染。」

### 7.2「MCP server 要不要做缓存？」

答案：要，但四层想清楚。

1. **缓存什么**：上游 API 的确定性/准静态读（文档、issue 详情、repo 元
   数据）、token introspection / JWKS（极短 TTL）；不缓存 secrets、不缓存
   因 token 不同而不同的授权判断结论。
2. **Key 含租户维度**：多租户 server 必须 token/tenant 进 key——跨租户
   共缓存敏感数据是事故级错误。
3. **失效策略**：尊重上游 TTL/ETag；幂等写工具成功后失效相关 read 缓存；
   激进缓存 readOnlyHint=true 的工具一般安全但不等于永远安全（openWorld
   数据可能突变）。
4. **别做成「结果记忆」**：Agent 场景同一参数的两次调用，模型期待看到
   最新数据（「我改了 issue 后再查还在吗」），无脑缓存会制造「模型看到
   幽灵数据」的一致性 bug；建议极短 TTL + 主动失效 + 写后读穿透。

连带设计：返回内容里文件/资源类快照块可用 `annotations.lastModified` 帮
client 决定缓存与订阅；大资源用 resource + subscribe 推送更新
（resources/updated 通知）比轮询缓存更优。

一句话收口：「缓存上游与凭证元数据，谨慎缓存面向模型的结果；缓存失效与
租户隔离优先于命中率。」

### 7.3 其他备好的一句话

- **stdio vs HTTP**：本地单用户免鉴权走 stdio（别往 stdout 写日志），远程/
  多租户走 Streamable HTTP（注意 DNS rebinding、Origin 校验、
  Mcp-Session-Id）。
- **错误双层**：protocol error 给墙、isError 给路——让模型能自我纠正的
  失败都走 isError。
- **粒度**：少而贴工作流 + namespace + toolset 开关 + read-only 模式
  （GitHub 版答案）。
- **返回**：高信号自然语言字段、response_format=concise/detailed、截断必须
  指路、structuredContent + outputSchema 兜底结构化。
- **发布**：Inspector（web/CLI/TUI）+ conformance 场景套件 + mcp-publisher
  发官方 Registry（io.github 验权靠 GitHub OAuth/OIDC、域名靠 DNS/HTTP
  挑战）。
- **OAuth 2.1 亮点（2025-06-18）**：resource server 化 + RFC 9728 元数据 +
  RFC 8707 audience 绑定 + 禁 token passthrough。

## 口径与未核实说明

- FastMCP「每天约 100 万次下载、约 70% 的 MCP server 由某个版本 FastMCP
  驱动」为 PrefectHQ/fastmcp 官方自述口径，未独立核实。
- 「约九成场景适合高层 API」为工程经验口径，非官方数字。
- 协议 2026-07-28 版本在取材时点仍为 draft，正式版发布情况以
  modelcontextprotocol.io 最新规范页为准。
- Registry「预告 GA v1」在取材时点尚未正式 GA，以官方公告为准。
- filesystem / postgres 参考实现在 servers 仓库均有「参考实现非生产就绪」
  的明示警告，引用时请保留这个限定。

## 延伸阅读（仓内）

- [工具调用与mcp](./工具调用与mcp.md)：MCP 概念、三类原语、协议全景与注入防护
- [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)：供货侧 vs 最后一公里、JSON-RPC 生命周期
- [agent通信协议专题](./agent通信协议专题.md)：MCP/A2A/AG-UI 三层协议栈
- [function-calling训练专题](./function-calling训练专题.md)：模型侧怎么学会调工具
- [agent安全与防护](./agent安全与防护.md)：注入、越权与外泄的防线谱系
