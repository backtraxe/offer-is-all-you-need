# Agent 观测与 Trace 工程：OTel 承载 · Langfuse 核心 · 线上 eval 闭环

> 面向：Agent / AI Infra 岗位面试者，以及任何被问过「agent 上了线之后怎么看
> 它在哪里错、钱花在哪」的人。本篇讲**线上观测与工程闭环**——trace 结构怎么
> 设计、观测平台怎么选、线上 eval 怎么闭环；harness 层的错误处理（失败数据化、
> 熔断）与离线评测的口径（benchmark、judge 基准）在
> [harness工程实战](./harness工程实战.md) 和 [多agent与评测](./多agent与评测.md)
> 已有专题，本篇只串联不重复。
>
> 读完获得：①「OTel 承载 + LLM 专属后端」这条 2025H2–2026 收敛的路线判断；
> ② 八家工具的对照表与选型话术；③ Langfuse 的三层数据模型与宽表设计 why；
> ④ OTel GenAI semconv 的核心 attribute 清单和「别当 stable 契约」的边界；
> ⑤ 线上 eval 闭环的完整七步流程与 trace 设计最佳实践清单。
>
> **时效口径**：2025H2–2026，全部 star 与版本为 2026-10 GitHub 实测；标注
> 「官方自陈」的数字来自厂商官网/文档，未经独立核实。

## 一、主线结论：技术路线已收敛为「OTel 承载 + LLM 专属后端」

2026 年再看 Agent 观测，行业分裂的两条路线已经分出胜负：

- **承载层通用**：OpenTelemetry 成为一等公民。Langfuse v3+ 提供原生 OTLP
  endpoint（`/api/public/otel`，v3.22.0 起，HTTP JSON/protobuf、无 gRPC）、
  LangSmith 通过 `LANGSMITH_OTEL_ENABLED` 打开 OTLP 接入、Phoenix/Opik 同样
  原生消费 OTel span。答 trace 结构设计按 OTel span 语义（root span、父子、
  attribute、status）讲，**不会错**。
- **呈现层专用**：通用 APM（Jaeger/Grafana）只能把 GenAI span 当普通 span 画
  瀑布图，LLM 语义——消息树、generation、token 成本、score 挂载——只有
  LLM 专属后端能完整呈现。这是「为什么不用 Jaeger 就够」的标准答案骨架。

关键中间件是 **OTel GenAI semconv**：截至 2026-10 它仍是 Development 状态
（没有 stable），但 `gen_ai.*` attribute 已被 Langfuse/LangSmith/Phoenix
全面映射，成为**事实标准**。金句记好：「gen_ai.\* 是事实标准但别当 stable
契约用」——内部属性用自家命名空间，`gen_ai.*` 只作映射层的输入。

先把全景地图放出来，三条泳道分别是路线收敛、Langfuse 核心、线上 eval
闭环，后面逐节下钻：

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-observability-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-observability-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、工具对照总表（star 全部 2026-10 github 实测）

| 工具 | 定位 | star / 版本 | 自部署 | OTel 支持 |
|---|---|---|---|---|
| Langfuse | 开源 LLM 观测 + 评测平台一体 | **35.6k、v4.56.0**（2026-10-09，gh 实测） | Docker Compose / K8s Helm（Postgres + ClickHouse + Redis + S3 四件套） | 原生 OTLP endpoint（v3.22+，HTTP only 无 gRPC） |
| LangSmith | LangChain 官方闭源 SaaS + 企业自部署，LangGraph 绑定 | SDK 1,072（v0.14.7）；langchain 本体 147,554 | 企业自部署（K8s，企业版授权） | OTLP endpoint + `LANGSMITH_OTEL_ENABLED` |
| OpenLLMetry（Traceloop） | OTel GenAI 自动 instrumentation 库 | 7,481（v0.62.4） | N/A（是库不是平台） | 原生 |
| Phoenix（Arize） | 开源 AI 观测 + eval，OpenInference 生态 | 11,774（2026-10-09） | 支持 | 原生 |
| Opik（Comet） | 开源 LLM 观测 + eval | 22,487（v2.2.96） | 支持 | 部分 |
| Promptfoo | 开源 eval / 红队 CLI，CI 友好本地优先 | 25,869 | 本地（不是平台） | 无（不涉及） |
| Braintrust | 闭源 eval-first 平台，SDK 开源但体量极小（JS SDK 仅 29 star） | autoevals 1,053 | SaaS only | 部分 |
| Jaeger | 通用 APM tracing，OTel 原生 v2 | 23,272（v2.22.0，2026-10-06） | 支持 | OTel 本家 |
| Datadog LLM Obs | 商业一体化 | — | SaaS only | 原生 |
| AWS Bedrock | 云厂商内置（CloudWatch invocation logging），一句话定位：购买即得、数据不出域 | — | 云内 | 部分 |

**选型一句话**：自部署开源底座 = Langfuse（评测闭环最完整）vs Phoenix
（OpenInference 生态）二选一；已经绑死 LangGraph 则 LangSmith 接入成本
最低——两个环境变量就能跑。Promptfoo 很适合补上 CI 段：配置即测试用例，
跟着 PR 跑，官网自陈「Used by OpenAI and Anthropic」（官方自陈，2026-10）。

## 三、Langfuse 详解：为什么它是开源自部署事实标准

规模先给一个量级：**90B+ observations/月**（官方自陈，2026）、Fortune 50
中 21 家在用、Docker 镜像 38M+ 拉取。版本节奏：v3.0.0（2024-12，引入
ClickHouse）→ v4.0.0（2026-07）→ **v4.56**（2026-10-09）。

### 3.1 数据模型：Session → Trace → Observation 三层

- **Session**（可选）：一组多轮对话的聚合桶，session_id 建议 20+ 字符防碰撞。
- **Trace**：一次请求/一次会话回合的顶层单位，trace 级属性有 name / userId /
  sessionId / release / tags / metadata / environment / version / public；
  注意 v4 起 trace 自身的 input/output 已废弃，改取 root observation。
- **Observation**：trace 内的单个执行单元，共 **10 种类型**：span /
  generation / event / embedding / agent / tool / chain / retriever /
  guardrail / evaluator。

### 3.2 存储 why：ClickHouse 宽表，用冗余换查询

Langfuse 的 observations 是一张 **ClickHouse 宽表**：每行 = observation
本体 + trace 级属性（user_id / session_id / tags / metadata）的**冗余拷贝**。
代价是写入放大，换来的是**读时无需 JOIN**——OLAP 分析（按 release 分桶看
成本、按 user 找异常）全是单表聚合。这条设计的推论反过来约束了写入侧：
**trace 级属性必须传播到每一个 span**（见下一节的 Baggage）。

### 3.3 OTel 集成与属性传播

- `/api/public/otel` 原生 OTLP endpoint（v3.22.0 起，HTTP JSON/protobuf，
  无 gRPC）——Langfuse 可以只当一个纯 OTel backend 用。
- SDK v4 是 OTel 的原生薄封装（`@observe` decorator），span 自动转
  observation。属性映射优先级：**langfuse.\* 前缀优先于 gen_ai.\* 前缀**，
  同时兼容 OpenInference（`input.value`）和 MLflow（`mlflow.spanInputs`）
  的命名。
- **Baggage 警告**：trace 级属性（userId / sessionId）靠 OTel Baggage +
  BaggageSpanProcessor 传播（SDK 提供 `propagate_attributes()` 助手），但
  **Baggage 会随跨服务 header 泄露给第三方 API**——严禁往里放任何敏感信息。
- 短生命周期进程（脚本 / Lambda / 一次性 eval job）退出前必须
  **flush()，否则尾部 trace 直接丢**。
- 多模态内容走 S3 引用，不直接进 trace payload。

### 3.4 评测与实验体系：闭环全内置

**Online（线上）**：score 可以挂在 trace 或 observation 上，来源三种——
用户 feedback（thumbs up/down）、托管 LLM-as-judge、代码评估器 /
annotation queue（人工标注）。Score Analytics 专门用来校准 judge 与人标
之间的一致性与分歧。

**Offline（数据集）**：Dataset item = input / expectedOutput / metadata，
支持多模态附件、JSON Schema 校验、**版本化**（每次增删改自动出版本，
experiment 可锁固定版本复现）。

**反馈回流**：observations 表里勾选 traces → Actions → **Add to dataset**，
按 JSON path 做字段映射，后台批量执行、部分失败容错——失败 case 一键进
gold 集。

**CI 拦截**：`langfuse/experiment-action` GitHub Action，在 PR 上跑
experiment 对比新旧版本，抛 RegressionError 直接 fail PR。

**接入成本**：LangChain / LangGraph 用 CallbackHandler 三行代码即可；一般
团队**小时级**就能看到第一条 trace——真正的难点从来不在工具，而在属性传播
策略与采样/脱敏策略。

## 四、LangSmith 与 Phoenix：两个最常见的「为什么不用它」

**LangSmith**：LangChain / LangGraph 绑定最深的方案，平台本身是闭源 SaaS
（可加钱企业自部署，走企业版授权），SDK 仅 1k star 恰恰说明**它是平台不是
库**。概念体系为 run / trace / thread / trajectory 四级：thread = 多轮
session，trajectory = 扁平消息序列视图。两个工程细节值得背：① SaaS 默认
trace 保留 **180 天**（官网 2026-10 实锤）；② 专为「数小时不闭合的 long
span」自研了 SmithDB 存储（self-hosting 文档实锤）。OTel 嫁接有一个特有坑：
OTel span id 是 8 字节而 LangSmith run id 是 UUID，跨 SDK 拼父子要用
`langsmith.span.parent_id` 显式传全量 UUID。

**Phoenix（Arize）**：OpenInference 生态的开源代表，观测 + eval 一体、可
自部署，是与 Langfuse 并列的开源厂牌。选它的理由通常是团队已经绑
OpenInference instrumentation；选 Langfuse 的理由是评测 / 数据集 / CI
闭环更完整。一句话：同构竞品，差异在闭环深度而不在 trace 能力。

## 五、OTel GenAI semconv：事实标准，但别当契约

**现状两个要点**：① 2026-05 起 GenAI semconv 从主仓迁入独立仓库
open-telemetry/semantic-conventions-genai（**422 star**，gh 2026-10 实测），
主仓文档标注 Moved；② GenAI spans / metrics / agent spans **全部
Development 状态**——「纸片级 specification，别当 stable 契约用」。破例的
只有 `error.type`，是唯一 Stable 的 attribute。但 Jaeger 等通用后端与大厂
实现都按它收敛，所以面试照它讲。

**核心约定速查**：

- **span 命名**：`{gen_ai.operation.name} {gen_ai.request.model}`；
  operation 枚举：chat / create_agent / embeddings / execute_tool /
  generate_content / invoke_agent / invoke_workflow / retrieval /
  text_completion。
- **usage**：`gen_ai.usage.input_tokens` / `output_tokens`，细分
  `cache_creation.input_tokens` / `cache_read.input_tokens`（cache 命中数
  计入 input 总量）/ `reasoning.output_tokens`。
- **agent 层**：`gen_ai.agent.id` / `name` / `description` / `version`、
  `gen_ai.conversation.id`、`gen_ai.workflow.name`。
- **工具层**：`gen_ai.tool.call.id` / `arguments` / `result`、
  `gen_ai.tool.name` / `type`。
- **评测层**：`gen_ai.evaluation.name` / `score.value` / `score.label` /
  `explanation`。
- **请求响应**：`gen_ai.request.model` / `max_tokens` / `temperature` /
  `seed`、`gen_ai.response.model` / `finish_reasons`、
  `gen_ai.response.time_to_first_chunk`（TTFT）。
- **provider**：`gen_ai.provider.name`——`gen_ai.system` 已 Deprecated 被它
  替换，看老 blog 时注意新旧命名差异。
- **metrics**：`gen_ai.client.operation.duration`、
  `gen_ai.server.time_to_first_token`（TTFT）、
  `gen_ai.server.time_per_output_token`（TPOT）、
  `gen_ai.invoke_agent.duration`、
  `gen_ai.invoke_agent.inference_calls` / `tool_calls`、
  `gen_ai.execute_tool.duration`。
- **消息内容**：支持结构化 JSON schema 表示，且**显式允许截断与过滤**——
  这就是给脱敏留的口子。

**消费边界**：内部系统用自有或 `langfuse.*` 之类的命名空间，`gen_ai.*` 只
做映射层输入、不作内部契约——这样 semconv 哪天改名/改枚举，你只动映射
不动业务代码。

## 六、线上 eval 闭环：数据流只有一条

完整闭环七步，一条线走穿：

```
线上流量 →（采样率 + 环境标记）→ OTel span → 观测后端
 → 在线评估（托管 judge 对新 trace 打分 / 用户 thumbs / 代码规则）
 → score 挂回 trace，按 model / prompt version / feature flag 分桶看趋势
 → 低分 + 人工 review 确认为真失败 case
 → 一键 Add to dataset（gold 集扩充）
 → 改 prompt / 模型 / 代码 → CI 跑 experiment（锁固定 dataset version）
   并排对比新旧版本、RegressionError 拦截
 → 通过门槛后灰度放量（release / version 打标）→ 回看线上 score 确认
```

两个伴随机制：

- **模型换版窗口双跑（shadow）**：新旧模型并行执行同一批线上请求，只
  记录不返回；历史 trace 可做**回放回归**——把历史失败 case 再跑一遍新
  版本，看是否复现。
- **判定点量化**：灰度看三件事——score 降幅、单位 token 成本增幅、p95，
  超阈值即停。

工具分工：**Langfuse 全链路内置**（从打分到 experiment-action 拦 PR）；
LangSmith 同构（feedback + dataset + experiments + pairwise compare，
绑死 LangGraph 最顺）；Promptfoo 只做 CI 段；Braintrust 是 eval-first 的
闭源思路；Datadog / Bedrock 一句话定位：商业购买即得，卖的是云内数据
不出域。

值得点名 **Anthropic 多智能体工程文（2025-06，官方博客）**——线上 eval
闭环的最佳公开案例：起始评测集只有约 **20 条 query**；**单个 LLM judge、
单 prompt、输出 0.0–1.0 分数 + pass/fail，比多 judge 投票更稳**；上线后
靠全量生产 trace 定位失败模式。同一篇给出的成本预期：agent 任务约为
chat 的 **4× token 消耗**，多 agent 约 **15×**。

## 七、trace 结构设计最佳实践

### 7.1 span 粒度：小到能回答「钱和时间花在哪、错在哪一步」

与 Langfuse 10 种 observation type 对齐的推荐拆分：

```
root span（一次请求）
 └── agent / workflow span（一轮 ReAct turn、一次 invoke_agent）
      ├── generation（每次 LLM call，记 usage 明细）
      ├── tool（每次工具执行，记参数与结果）
      ├── retriever（每次检索）
      ├── guardrail（每次护栏判定）
      └── evaluator（judge 也记 span——它本身是 agent 的一部分，成本要记）
```

原则只有一条：**能回答「钱和时间花在哪」「错在哪一步」的最小粒度**。反面
教材也是常见的坑：judge 调用和重试逻辑藏进 application 代码不记 span——
翻车之后你会发现 30% 的成本和时间花在你看不见的地方。

### 7.2 token 与成本记账：usage 平台记，单价自己养

每个 generation 记 usage 明细 input / output / cache_creation / cache_read /
reasoning（semconv 直接给好了字段）；**成本 = usage × 本地单价表，单价表
必须自己按月维护**——观测平台只记 usage 不计钱。2026-10 的陷阱实例：cache
write 1.25×（5 分钟 TTL 档）、cache read 0.1×、Batch API 半价、tokenizer
换版导致同文本 token 数 ±30% 漂移。

单价参考（docs.anthropic.com pricing，2026-10 实测）：Sonnet 4.5/4.6
**$3 / $15 per MTok**（input / output）、Opus 4.5+ **$5 / $25**、
Haiku 4.5 **$1 / $5**。落地方式：Langfuse 的 cost_details JSON 挂在
generation 上，root trace 聚合展示整轮成本。

### 7.3 延迟分解

```
总时延 = 排队 + TTFT（首 token）
       + 生成时延（TPOT × 输出 token 数）
       + 工具执行时延 + judge / guardrail 耗时
```

TTFT 用 `gen_ai.response.time_to_first_chunk`（Langfuse 里叫
completion_start_time）；TPOT 用 `gen_ai.server.time_per_output_token`。
agent 场景按 **turn** 分解，一眼定位是模型慢还是工具慢。

### 7.4 错误分类：span status 只够一半

`span status = ERROR / DEFAULT` 的颗粒度远不够用，给 `error.type`（semconv
里唯一 Stable 的 attribute）做三层分类：

- **模型侧**：rate_limit / timeout / context_overflow / invalid_tool_call
  （截断拒绝）。
- **工具侧**：tool_error——失败已数据化回喂给模型的，要区分是**模型用错
  工具**还是**工具系统自身故障**（前者改 prompt / 上下文，后者修系统）。
- **环境侧**：沙箱崩溃 / MCP server 无响应 / 权限拒绝。

本篇最重要的一行，金句原样背：
**模型语义级失败——答非所问、工具选错、循环打转——在 span status 上是
「成功」，只能靠 score / judge 层暴露**。这就是 trace 与 eval 必须双轨
并行的根本原因，也是回答「观测和评测什么关系」的锚点。

### 7.5 Session 聚合：四个切面锁死

session_id / user_id / release+version 是强制项，SDK 自动传播后聚合出四个
追问切面：

- **按 session**：一轮多轮对话的总 token / 成本 / 时延 / 工具调用次数
  （对照 Anthropic 口径：agent ≈ chat 的 4×、多 agent ≈ 15×）。
- **按 user**：定位个别用户开销异常——上下文堆积、循环未熔断。
- **按 release / version**：换版前后 score、p95、单位 token 成本对比——
  灰度放量的判定点。
- **按 feature flag**：AB 桶标记与线上指标直接关联。

### 7.6 PII 脱敏：摄入前、摄入时、存储三阶段

- **摄入前**：SDK hook（Langfuse send 前的 transform / masking callback），
  正则 + 分类器两级过滤。
- **摄入时**：Langfuse 服务端对 attribute key 含 `__proto__` /
  `constructor` / `prototype` 路径段的属性**静默丢弃**（防原型链污染，
  2026-10 OTel 文档实锤）。
- **存储**：多模态对象走 S3 引用、单独生命周期；trace 按 environment
  隔离 retention；SaaS 默认保留期要查（LangSmith 是 180 天）。

设计上限记 Anthropic 的公开口径：**监控决策结构与交互模式——span 形状、
工具序列、轮次分布——不监控对话内容**。结构信号够定位 99% 的问题，内容
层面越少留越好。

### 7.7 实践清单（FAQ 表）

| 问题 | 答案 |
|---|---|
| 采样率怎么定？ | 生产按 trace 抽样 5–10%；**ERROR / 低分 / anomaly 命中的 trace 100% 保留**——OLAP 存储已不是瓶颈，原则是「多记不省」 |
| trace 属性记 root 还是每个 span？ | 冗余到每个 span（宽表设计的推论），否则 OLAP 按属性过滤查不全 |
| 数小时的长任务 agent 怎么办？ | 长 span 闭合是真实工程问题（LangSmith 为此自研 SmithDB 存未闭合 span）；自研侧用 **event 打点里程碑** + checkpoint 而非一个超长 span；崩溃恢复靠 resume token 续接 trace，成本与进度独立于业务 trace 监控 |
| 跨进程怎么串上下文？ | OTel context propagation（`traceparent` header） |
| LangSmith 特有坑 | OTel span id 8 字节 vs run id UUID，跨 SDK 嫁接父子用 `langsmith.span.parent_id` 显式传全量 UUID |
| 脚本 / Lambda 短进程 | 退出前必须 `flush()`，Langfuse 官方明确警告过丢数据 |

## 八、▶ 面试题 10 条（全收）

**Q1【高频】Agent trace 和普通微服务 APM 有什么区别？为什么不用 Jaeger 就够？**
语义密度不同：消息树 / generation / token 成本 / score 挂载是 LLM 专属
概念，通用后端只能画瀑布线，成本与评测语义全缺。所以行业收敛成「OTel
承载（通用）+ LLM 后端呈现（专用）」——Jaeger 装得下，但装不好。

**Q2【高频】线上发现答非所问，怎么定位是模型 / prompt / 工具问题？**
按 span 粒度走查：generation 看输入输出（prompt 拼得对不对）、tool 看
参数与结果（调用对不对）、retriever 看召回，score 挂在 trace 上按
release / version 分桶量化对比历史。关键认知：答非所问在 span status 上
是成功，没有 judge 层你根本不知道它在发生。

**Q3【高频】一次 LLM 请求的成本怎么算？混合调用呢？**
usage × 本地单价表；明细必须含 cache read / cache_creation / reasoning。
混合调用（多模型、多轮、多 agent）按 generation 粒度逐笔记账再聚合到
root trace。三个坑：cache write 1.25×、Batch 半价、tokenizer 换版 token
数 ±30% 漂移——所以说「平台记 usage，单价自己养」。

**Q4【高频】线上 eval 和离线 benchmark 差在哪？judge 怎么保证可信？**
线上：真实分布、持续不断、无 ground truth → 靠 judge 抽样打分；离线：
可复现、CI 可拦截。可信靠三招：抽样人标对齐 judge、Score Analytics 监控
人判分歧、用 Anthropic 2025-06 公开验证的配方——**单 judge、单 prompt、
0.0–1.0 分数 + pass/fail 最稳**，别堆多 judge 投票。

**Q5【中高频】失败 case 怎么回收？gold 集怎么防污染防漂移？**
低分 + 人工确认 → 一键 Add to dataset（字段映射、后台批量、部分失败容错）
；dataset 版本化、experiment 锁固定 version 复现；定期重做人标基线防止
「judge 与人都漂了但一起漂」。

**Q6【中高频】灰度与 AB 怎么做？模型换版窗口怎么保证不回归？**
release / version 打标 + 双桶同 dataset run 并排对比；规则门槛量化：score
降幅 < x、成本增幅 < y、p95 不超；换版窗口双跑 shadow，历史失败 case
回放兜底。

**Q7【中高频】PII 怎么处理？日志给 judge 再打一遍会不会泄露？**
摄入前 hook 脱敏（正则 + 分类器两级）、Baggage 禁放敏感信息（它会随跨
服务 header 泄露给第三方 API）、多模态走对象存储引用并单独生命周期；
judge 走同一管道脱敏后再评。上限原则：盯结构（span 形状、工具序列、
轮次分布）不盯内容。

**Q8【中频】OTel gen_ai 约定稳定吗？该不该直接消费？**
2026-10 仍是 Development 且已迁入独立仓（422 star），只有 error.type
稳定。所以：内部属性用自家 / langfuse.\* 命名空间，gen_ai.\* 只作映射
层输入不作契约——改名时只动映射层。

**Q9【中频】多 agent trace 怎么组织？子 agent 轨迹要进主 trace 吗？**
不进。主 trace 只回收子 agent 的结论（与「context 隔离」的推论一致，
见[多agent与评测](./多agent与评测.md)），子 agent 完整轨迹单独开 trace、
用 id 关联。否则主 trace 的体积和检索成本爆炸，而且违背分层回收原则。

**Q10【中频】10 小时的长任务 agent，span 设计有什么特殊处理？**
长 span 不闭合是真实问题——LangSmith 为此自研 SmithDB 存未闭合 span
（self-hosting 文档实锤）。自研侧：里程碑用 event 打点而非超长 span、
checkpoint 存状态、崩溃恢复用 resume token 续接 trace、成本与进度独立于
业务 trace 监控。

## 串联阅读

- [harness工程实战](./harness工程实战.md)：错误处理与稳定性层（失败数据化、
  截断熔断、循环兜底）——trace 里看到的 tool_error / invalid_tool_call，
  基层机制在这里。
- [多agent与评测](./多agent与评测.md)：评测体系四层口径（结果 / 过程 /
  组件 / 系统）与黄金评测集建设——本篇的线上 judge 是它「评分方式」章
  节的线上延伸。
- [learn-claude-code导读](./learn-claude-code导读.md)：生产级 harness 的
  课程导读，一批可深挖的 trace / 评测锚点。
- [评测题专项](../评测题专项.md)：评测指标与 benchmark 专题（pass@k、
  judge 基准口径）。
- [设计ai客服agent](../../system-design/设计ai客服agent.md)：把线上观测与
  eval 闭环放进系统设计题里的完整演练。
