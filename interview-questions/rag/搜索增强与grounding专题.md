# 搜索增强与 Grounding 专题：Web Search RAG 的产品形态、query 规划、计费锚与引用工程

> **面向**：读完私有库系列——[rag全链路](./rag全链路.md)（入库→召回→生成→评测）、
> [检索与混合召回](./检索与混合召回.md)、[评测与建库工程](./评测与建库工程.md)——
> 的 RAG / Agent 求职者。本篇讲私有库系列没覆盖的那半边：**接公网搜索的
> grounding**（Web Search RAG）。私有库的索引治理、切块混合召回、权限与评测
> 本篇只串联、不重复。
>
> **读完获得**：① 四大产品形态（ChatGPT Search / Perplexity / Gemini grounding /
> Bing Prometheus）的公开架构口径与每家的「一句话差异化」；② 计费锚点：
> Google \$14/1k query 与 OpenAI /Brave /Tavily /Exa /SerpAPI /Perplexity 的
> 对比读法，「每 prompt 平均 query 数」换算公式；③ query 规划三件套
> （fan-out /HyDE /freshness router）与官方证据链；④ 引用工程：句级归因
> schema、inline vs post-hoc 两路线、AIS /ALCE /Stanford 审计三组评测数字、
> 未引用内容的四条兜底；⑤ 搜索 API 三层生态对比表与「返回 chunk 而非链接」
> 五要点；⑥ FreshQA /FreshPrompt 的 47 点提升与 1→10 条证据的边际收益；
> ⑦ 三道面试题的完整答法。
>
> **时效口径**：素材时间轴从 **2016 前的搜索引擎旧世界**到 **2026-10 的
> Vertex / OpenAI / Brave 现行定价页**；全部价格与论文数字按官方文档与
> arXiv 原文口径括注（2026-10-12 调研），社区反推与未核实项见第八节说明。

## 一、主线：四大产品形态的公开架构口径

搜索增强（web search RAG、生成式搜索、grounding——三个名字一条线）在
2023→2026 完成了三次形态分化：传统搜索交付「候选集合」（10 条蓝链，认知
成本在用户），answer engine 交付「结论」（LLM 综合 + 句级引用），而云厂商
把 grounding 收敛成 API 上的一层开关和一张计费牌表。看懂这四家就都够了：

- **ChatGPT Search（OpenAI）**：2024-10-31 发布，微调 GPT-4o 驱动，
  2025 年起 Free 层可用。官方帮助页（help.openai.com/articles/9237897）
  是 query 改写的官方证据链实锤（见第三节）。
- **Perplexity**：2022-12-07 上线的「answer engine」原型机，多轮检索
  循环 + 句级角标，唯一被允许放弃 CTR/SEO 目标只按「可引性」调排序的
  玩家；同时也是引用事故与版权诉讼的最厚案例库。
- **Gemini grounding with Google Search（Google）**：云厂商形态的标杆——
  一层 `tools: [{googleSearch: {}}]` 开关，输出带完整归因数据结构
  `groundingSupports`，计费 2026 年改成按 query 条数收费。
- **Bing / Microsoft Copilot（Prometheus）**：2023-02 官方博客披露
  Prometheus（Bing 后端 + LLM 的组合、iterative query development、
  Orchestrator）；**2025-08-11 Bing Search API 公网 API 全面退役**，
  开发者被引导进 Azure AI Foundry 的 Grounding with Bing Search——
  公网搜索 API 生态从此「去 Bing 化」，红利被 Brave /Tavily /Exa /
  SerpAPI 吃掉。
- 旁证一条：**DeepSeek 联网**——2025-02 起网页版/App 开「联网搜索」
  开关（检索结果注入 R1 推理上下文），但 API 不提供联网，业界经典
  组合是 Tavily /Brave API + DeepSeek API 自建；2025 年几度因流量/
  稳定性关闭又恢复——联网能力的稳定性本身就是产品可靠性的一部分。
  国内同类（Kimi、豆包、文心一言检索插件）模式雷同。

下图先把全链路三泳道摆在一起：**query 规划 → 搜索与拼包 → 引用归因**，
两端的计费锚与审计数字卡嵌在图上，后续每节对应图中一格。

<div class="diagram-embed">
<iframe src="assets/diagrams/grounding-pipeline.html" width="100%" height="860" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/grounding-pipeline.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 1.1 ChatGPT Search：官方披露的改写多轮机制

OpenAI 帮助页给出的工作机制造了四个可背的点：

1. **自动或手动触发**：模型自己判断「这个问题需不需要新鲜信息」，工具
   菜单里也可强制 Search——这是内置 freshness router 的产品形态。
2. **多轮 query 改写**。官方原文口径： typically rewrites your query
   into one or more targeted queries，且**看完第一轮结果后再发更具体的
   查询**。官方例子：用户问 "CCR8 抗癌药最新进展" → 首轮发
   "CCR8 immunotherapy drug development 2025" → 审阅结果后补发
   "CHS-114 conference 2025"。本地意图会把 IP 推断的大致位置写进查询
   （"top restaurants San Francisco"），但不传 IP 本身；开 memory 时，
   保存的记忆（素食、住旧金山）也参与改写。
3. **后端合作方**：与第三方搜索提供商合作（帮助页列出 Microsoft、
   Shopify 隐私政策链接——即后端用了 Bing 等）。
4. **API 侧三档搜索形态**（platform.openai.com/docs/guides/tools-web-search，
   2026 现行）：non-reasoning web search（快查）、agentic search with
   reasoning（思维链中自主多轮搜索，可调 reasoning effort）、deep
   research（数百页面、数分钟、建议 background 模式）。

API 返回结构的工程口径同样要背：`web_search_call` 输出项的 action ∈
{search, open_page, find_in_page}（对应「搜 → 开页 → 页内找」三段式）；
消息体带 `url_citation` annotations（start_index /end_index /url /title）
做行内引用；`sources` 字段返回**完整**来源列表（比 inline citation 多，
含 oai-sports /oai-weather /oai-finance 等实时第三方 feed）。控制面：
search_context_size 三档、GPT-5+ 推理模型的 return_token_budget、
allowed/blocked_domains 各最多 100 个、user_location、
external_web_access=false 走纯缓存模式；**搜索上下文窗口恒定 128k**
（即使模型本身 1M）。legacy 口径：gpt-4o-search-preview 已于
2026-07-23 关停，Chat Completions 路径只剩 gpt-5-search-api。

### 1.2 Perplexity：answer engine 的完整原型机

Perplexity 的架构公开口径（创始人访谈 + 产品反推 + 行业共识，非官方
白皮书）：query 理解 → 拆查询 → web 检索（自建索引 + 第三方）→ rerank
→ 把 top 文档内容塞进上下文让 LLM 综合 → 句级数字角标引用。Pro Search
就是把这个「检索-综合」循环跑多轮。底层模型可换：GPT-5.x /Claude /
Gemini 3.1 Pro /自研 Sonar（Llama 3.3 微调）/R1-1776（DeepSeek R1
微调版）。

真正的结构性差异化要记住这句：**它只为 answer engine 优化 ranking——
重质量 /权威 /「可引性」，而不优化 CTR 与 SEO**。这是它比「Google +
一个聊天框」更像原生答案引擎的根本原因：排名函数的目标函数换了。

但它同时是引用工程事故的绝好素材库，面试引用张冠李戴时直接拿：

- **Dow Jones 诉状**：Perplexity 把不存在的引语（F-16 供乌报道）
  张冠李戴到原文——**引用张冠李戴是生成式搜索的头号事故类型**；
- Forbes /NYT /BBC /日经 /朝日 /读卖 /Reddit 连环诉讼；
- Wired 2024-06 与 Cloudflare 2025-08 指其用伪装 UA 的「隐身爬虫」
  绕过 robots.txt（Cloudflare CEO 称其「像朝鲜黑客」）——检索侧合规
  暴露面的标志性事件。

商业口径备胎两个：2026 年初估值约 212 亿美元；2026-01 与微软签 3 年
7.5 亿美元 Azure+Foundry 协议（AWS 仍为主云）；2026-02 起放弃广告
订阅制优先以保答案中立性。

### 1.3 Gemini grounding：一层开关 + 一个归因 schema

Vertex /Gemini API 的产品形态极薄：请求体加 `tools: [{googleSearch: {}}]`
即完成 grounding。配套口径：

- exclude_domains、latLng 地域定制；上限 100 万次 /天 /项目；官方建议
  temperature=1.0；**不能与非搜索工具（function calling 等）在同一次
  generateContent 混用**（都是 search 工具则可以）。
- 输出带完整 groundingMetadata：`webSearchQueries`（模型实际发出的
  查询列表——fan-out 可观测）、`groundingChunks`（来源 URL /标题 /域）、
  **`groundingSupports`（句级归因结构，第四节细拆）**、
  `searchEntryPoint`（Google Search 建议芯片，**强制在产品中展示**——
  Google 合规条款要求）。
- **动态检索（dynamic retrieval）**：Gemini 2.x 起模型自己按预测阈值
  判断当前 prompt 是否受益于新鲜信息，只在需要时启动 grounding——
  本质是**官方内置的 freshness router**，直接省掉不必要的接地计费与
  检索噪声。
- 生态位扩张（2026-10 Vertex grounding overview 共 7 种）：Google
  Search /Google Maps /Agent Search（私有数据）/RAG Engine /
  Elasticsearch /自带 search API /Web Grounding for Enterprise（强合规
  行业索引，$45/1k）/Grounding with Parallel web search。消费者侧的
  AI Overviews /AI Mode 即同套 grounding 的产品化。

面试记住一个对称结构：OpenAI 把 grounding 做成 Responses API 里的
工具调用项，Google 把 grounding 做成 metadata + 引用 schema 的官方
标准件，两家交付的都是「可观测的搜索轨迹 + 可归因的句子」。

### 1.4 Bing Prometheus：从披露到退役的三年

2023-02 微软官方博客《Building the new Bing》首次披露 Prometheus：

- Bing 后端 + 下一代 LLM 的组合架构；
- iterative query development（把对话上下文改写成搜索 query——
  与 ChatGPT Search 的改写多轮同源）；
- Bing Orchestrator 统筹检索与生成，用 Bing 索引 + 新闻 + 实时网页
  给答案 grounding；
- 内嵌 SEO 安全与相关性判断。

**2025-08-11 Bing Search API 公网 API 全面退役**（微软官方公告），
开发者被引导到 Azure AI Foundry 的 Grounding with Bing Search。这个
事件的生态含义大于产品含义：**公网搜索 API 从此「去 Bing 化」**，
中小开发者可选底座只剩 Google grounding（捆绑 Gemini）、Brave 独立
索引、SERP 代理与 LLM 优化搜索三层——生态对比见第五节。

## 二、计费锚点：grounding 怎么收钱（2026-10 现行口径）

### 2.1 Google：$14/1k query，计费单位从 prompt 变 query

Vertex AI Agent Platform 官方定价页（2026-10）现行口径：

- **Gemini 3 代：每月前 5,000 次 Grounding Query 免费，超出部分
  $14 / 1,000 Grounding Query**；2026-01-05 起开始计费。
- **计费单位从 Prompt 改成 Query**——一个用户 prompt fan-out 出的每条
  搜索查询单独收费。文档明示的例子：问「爱因斯坦生平」可能产生 3 条
  query，就收 3 次。
- 只有成功返回来源（至少一个 support URL）才计费；grounding 返回的
  input token 有对应收费口径。

旧口径对比（背一串数字就够）：Gemini 2.x 按 **$35 / 1k Grounding
Prompt** 计费（不管 fan-out 几条），Flash /Flash-Lite 合计 1,500 次 /
天免费、Pro 10,000 次 /天免费；Web Grounding for Enterprise $45/1k；
Grounding with your data $2.5/1k prompt。

**演进记忆锚**：从 $35/1k prompt（按次、含大额度）到 $14/1k query
（按条、小额度）——单价降了 60%，但 fan-out 从「免费质量增益」变成
「明确的成本变量」。预算换算公式一句话：

```text
每 prompt 成本 = $0.014 × 每 prompt 平均 query 数 + 回采内容 token 费
```

生产上必须给每 prompt 的搜索条数设上限，并埋点监控「每 prompt 平均
query 数」这个指标——它就是 grounding 版的 prompt 通货膨胀表。

### 2.2 OpenAI：$10/1k 次 + 内容 token 按模型价

- Web search tool（所有模型含推理模型）的口径是 **$10 / 1k tool calls**，且
  **搜索内容 token 另外按模型输入 token 费率收费**；旧 web_search_preview
  非推理模型 $25/1k（内容免费）。
- 特例：gpt-4o-mini /gpt-4.1-mini 搜索内容按每次调用固定 8,000 input
  token 计。File search 工具 $2.5/1k + $0.10/GB·天存储。
- **成本结构教训**：工具调用费只是小头，**搜索回采的 content tokens 按
  模型价计才是变量大头**——deep research 一次几十万 token 的检索内容
  全按模型费率走，扇出的并发深比费钱得多。

### 2.3 独立索引与 LLM 优化搜索的价牌

- **Perplexity API**（docs.perplexity.ai/guides/pricing）：Search API
  $5.00 / 1k 请求，Fast Search $1.00 / 1k；Agent 工具价：web_search
  standard $2.5/1k 次、fetch_url $0.5/1k、image_search $2.5/1k、
  people/finance_search $5/1k、sandbox $0.03/session。官方成本示例：
  500 in + 200 out + 1 次搜索 ≈ $0.0059。定位是把自家搜索基建开放成
  API，与 Brave 同价位竞争。
- **Brave Search API**（brave.com/search/api）：**自立门户的独立索引**
  （40B+ 页面、每日 1 亿+ 页面更新，含 Web Discovery Project 用户贡献
  数据）——不是 Google /Bing 的套壳爬虫。定价：每月 $5 免费额度；
  Answers（带 citations 的 grounded 回答）按 **$4/1k 请求 + $5 /百万
  输入输出 token** 计，OpenAI SDK 兼容、可流式；Search 端 50 QPS；Goggles 自
  定义重排 /域过滤；每结果最多 5 条 query-dependent snippets；SOC 2
  Type II、全链路 Zero Data Retention。训练用途需购带存储权的套餐。
- **Tavily**（docs.tavily.com/api-credits）：「为 AI agent 设计的搜索」
  ——直接返回适配 RAG 的 chunk-ready 内容而非裸链接。Free 1,000
  credits/月；按量 $0.008/credit，套餐 $0.005–0.0075。Search basic 1
  credit /次、advanced 2；Extract 5 个成功 URL = 1 credit；Map 10 页
  = 1 credit；Crawl = Map + Extract；Research mini 4–110 credits、pro
  15–250 credits/次。
- **Exa**（docs.exa.ai/pricing，2026-09-25 更新）：neural /
  embedding-based「为 AI 设计的搜索」，号称 500k 开发者。/search
  instant $4/1k（含 10 结果）、/search fast $7/1k、/answer $5/1k、
  /monitors $15/1k、/contents $1/1k 页；Deep Search：deep-lite /deep
  $12/1k（4–15s 多步推理）、deep-reasoning $15/1k（12–40s）；Agent
  产品按 effort 固定价：minimal $0.012 → low $0.025 → medium $0.10 →
  high $0.50 → xhigh $1.00/次；auto 用 ACU $0.10 + 搜索 $0.005/次。
- **SerpAPI**（serpapi.com）：Legal Proxy——代你调 Google /Bing 真实
  SERP 并结构化返回，自带「US Legal Shield」。**只有成功搜索计数**
  （缓存 /失败不计），按次不按结果数。量级：免费 100 次/月；
  Developer $75/月 5,000 次；Big Data $275/30,000 次——**约 $15–18/1k，
  比自有索引贵一个量级，买的是 Google 真身 SERP 质量与解析稳定性**。

### 2.4 生态分层（面试一张嘴版）

| 层 | 玩家 | 价格锚 | 买到什么 |
|---|---|---|---|
| 一层：搜索引擎自有 API | Google grounding（捆绑 Gemini）、Bing（已退役）、Brave | $14/1k query、~$5/1k | 索引本身 +（Google）归因 schema |
| 二层：SERP 代理 | SerpAPI、Serper | ~$15/1k | Google 真身 SERP 的合规转售 |
| 三层：LLM 优化搜索 | Tavily、Exa、Perplexity | $1–7/1k | chunk-ready 内容 + 查询理解前置 |

被问「选谁」就按这张表说：要 Google 索引质量且接受绑定——grounding
一层开关；要独立索引许可清晰——Brave；要合规拿 Google 真身——
SerpAPI；要给 agent 喂现成 chunk、自己不想做抓取解析——Tavily /Exa /
Perplexity 三选一，按 research 循环深度再分档。

## 三、Query 规划工程：fan-out / HyDE / freshness router

### 3.1 多轮检索改写（query rewrite / fan-out）官方证据链

三个官方口径把「改写 + 多轮」从社区猜测变成可引事实：

- OpenAI Help Center 明说 ChatGPT search 重写成一个或多个 targeted
  queries、看结果后再发更具体的查询（第一节 1.1 的 CCR8 例子）；
- Gemini groundingMetadata.webSearchQueries 直接暴露模型实际发出的
  查询列表——计费页的「爱因斯坦生平 → 3 条 query」同一机制两面看；
- Bing Prometheus 叫 iterative query development，把对话历史折成独立
  查询。

工程拆解四步：

1. **上下文消解**：多轮对话里代词/省略必须回写——「那它多少钱」→
   「iPhone 17 Pro Max 多少钱」。
2. **子问题分解**：比较类/多跳问题拆成 2–5 条并行查询，广度优先
   fan-out 后逐源打开页面（对应 OpenAI 的 open_page /find_in_page
   action 序列）。
3. **自适应多轮**：看首轮结果覆盖度决定要不要第二轮——这就是
   「非推理快查 vs 推理循环 vs deep research」三档的本质区别。
4. **完整性与去重**：fan-out 查询要彼此**正交**（不同实体 /时间段 /
   语种），否则烧钱还互相稀释排序。

**计费联动是 2026 才出现的新坑**：Google 按 query 计费后（$14/1k
query），fan-out 条数从质量旋钮变成成本旋钮——规划器要给每 prompt
的搜索条数设硬上限，并把「每 prompt 平均 query 数」当 SLO 监控。

### 3.2 HyDE 在公网搜索场景

HyDE（arXiv:2212.10496，NeurIPS 2023）：先让 LLM 生成一段「假想答案
文档」，再用其 embedding 做 dense 检索匹配真实文档；encoder 的稠密
瓶颈会滤掉幻觉细节。零样本即显著超 Contriever、可比肩微调检索器（含
web search /QA /fact verification 三类任务）。

公网搜索口径下的使用要点：

- 适合「**关键词错位**」的长尾问题——用户说现象、答案页说规范术语，
  HyDE 的假想文本正好站在答案的语言侧；
- 搜索 API 多为 lexical+semantic 混合排序，HyDE 文本直接当 query
  用也行（不必非走向量层）；
- 副作用两条必读：多一次 LLM 调用拉长延迟；**freshness 高的查询反而
  别用 HyDE**——假想文档会把「过时实体/过期数字」写进去，污染检索。

### 3.3 Freshness router：先判要不要搜

触发判断三档实现（从便宜到豪华）：

1. **规则/特征**：含「最新 /今天 /股价 /比分」等词、recipe intent、
   实体是否属于快变类目。
2. **小分类器打分**：query → {freshness_need ∈ static | slow | fast |
   false-premise}；FreshQA 论文的四分法（never /slow /fast-changing +
   false-premise）就是最现成的标注 schema。
3. **内置方案**：Gemini dynamic retrieval（模型按预测阈值自动决定
   grounding 与否）、OpenAI 的 tool_choice=auto 模型自选工具。

路由收益两面都算得出：**命中率上，freshness 查询不路由 = 必挂**
（FreshQA 显示所有模型在 fast-changing /false-premise 题上都翻车）；
成本上，静态问题（定义、历史）没必要 grounding——省 $10–35/1k 级
工具费、降延迟、减少检索噪声污染。

Freshness 注入细节：把「当前日期 /用户时区」写进 evidence metadata
（FreshPrompt 的 unified format：source + date + title + snippet +
highlighted words）；排序时按发布时间重排或过滤（OpenAI
user_location + date、Gemini latLng、Brave freshness filter）。

## 四、引用工程：schema、两路线、评测数字与兜底

### 4.1 句级归因的数据结构范式（Gemini 官方实现）

Gemini groundingSupports 是这个问题的工业标准答案，字段级背下：

- `groundingSupports[].segment = {startIndex, endIndex, text}`——生成
  文本的一段 span；
- `segment → groundingChunkIndices[]`——指向 groundingChunks 来源
  列表 + `confidenceScores[]`；
- 一个 segment 可对多个 chunk（多源支撑的合成句）；confidence 低 ⇒
  前端降显示权重或不把该引用置顶。

对照口径：OpenAI 是 `url_citation` annotation 带 start_index /
end_index；Perplexity 是句末数字角标。**粒度取舍一句话**：句级归因最
严格、可读性好，但多源合成句要分配 joint attribution；段级吞吐高、错
注率低，但用户验证成本大。产品界的通行做法是**句级角标 + 来源面板
聚合**。

### 4.2 两种技术路线

- **inline / prompt-based**：检索结果编号进 prompt，让 LLM 边写边标
  [1][2]。成本低、可端到端训练；风险是**模型编造编号 /张冠李戴**。
- **post-hoc 归因（verification-first）**：先自由生成，再用 NLI /对齐
  模型把每个句子分配给最支撑它的来源（RARR 路线）。错注率低但多一次
  推理。

生产上常见**双保险：生成时标 + 生成后校验**——生成时 inline 挂编号控
体验，生成后 NLI 逐句校验控准确率，低置信走删句 /降级 /补检（4.4）。

### 4.3 评测口径三组数字（面试必背）

- **AIS（Attributable to Identified Sources；Rashkin et al.，
  arXiv:2112.12870，Google）**：评估生成内容是否「可归因于指定来源」。
  两阶段人评：先判陈述意图是否与世界相关（intent identification），再
  判是否被来源支持（attribution check）。"AIS-def" 即按定义级口径延伸
  ——每个输出陈述需满足「来源可核验 + 可归因」。在 TopiOCQA、对话
  QA、QMSum 摘要、WIT 表格转文本等多任务上验证了人评可行性。
- **ALCE（Liu et al.，arXiv:2305.14627，EMNLP 2023）**：第一个**自动**
  LLM 引用评测。三维指标：fluency /correctness /citation quality——
  citation recall = 陈述被引用支撑率，citation precision = 引用真正
  支撑其句率。语料 NaturalQuestions /ASQA /QAMPARI /ELI5，自动判分与人
  评高相关。关键数字：**ELI5 上最强模型仍有约 50% 的回答缺乏完整
  引用支撑**。
- **Stanford 生成式搜索可验证性审计（Liu et al.，arXiv:2304.09848，
  EMNLP findings 2023）**：人工审计 Bing Chat /NeevaAI /perplexity.ai /
  YouChat 四家——**仅 51.5% 的生成句子被引用完全支撑（citation
  recall），74.5% 的引用真正支撑其对应句（citation precision）**。
  回答流畅且貌似有据，是不可信的外观陷阱。这是「引用不能保证不错」
  的旗舰数字。

**面试点**：引用是「verifiability（可验证性）」而非「correctness
（正确性）」证明；citation precision /recall 双指标都要报，只报一个
等于没报。

### 4.4 未引用内容的四步兜底

1. **无支撑检测**：对每句与其引用源跑 NLI /对齐打分；低于阈值时策略
   四种——a) 删除该句；b) 降级为「可能 /据报道」措辞；c) 追加二次
   检索补源（Exa deep /agent loop 自动干的事）；d) 显式标注「以下内容
   来自模型内部知识，未经来源核验」。
2. **无源可被引用才生成**：系统 prompt 硬约束「只写被检索内容支撑的
   事实」；编不进来源的句子宁可不说——回答更短更稳，FreshPrompt 实验
   佐证：简洁直接的回答比冗长回答幻觉更少。
3. **检索侧兜底**：召回为 0 或全是低可信域（SEO 农场）时，宁可触发
   「我没查到」的降级回答；Gemini 口径里 source relevance 低或信息不
   全时不返回 groundingMetadata（请求不计费）——产品侧必须接住这个
   「未 grounded」分支。
4. **来源侧信任链**：域级黑白名单（OpenAI allowed/blocked_domains、
   Gemini exclude_domains 均为 API 级支持）+ 过滤 SEO 垃圾与 AI 内容
   农场（Brave 索引声明反 SEO spam 调校）。

## 五、搜索 API 生态对比（2025-26 定价与能力）

主干对比表（全部 2026-10 官方口径）：

| 维度 | Brave | Tavily | Exa | SerpAPI | Google grounding | Perplexity Search |
|---|---|---|---|---|---|---|
| 索引 | 自建独立 40B+ 页 | 自建（较小）+ 抓取 | embedding 神经索引 + 抓取 | 无：代理 Google /Bing 真 SERP | 捆绑 Google 索引 | 自建 |
| 返回形态 | 链接 + 最多 5 条 query-dependent snippets；Answers 直接给 grounded 答案 | chunk-ready 内容 + answer 字段 + raw content | 全文 contents /highlights /summary | 结构化 SERP（organic /answer box /knowledge graph） | groundingMetadata 完整归因结构 | 原始结果 + 高级过滤 |
| LLM 优化点 | LLM 语境端点、MCP 生态常用 | agent 全家桶（search/extract/map/crawl/research） | 语义检索、查询可被神经改写 | 保真最高，需自行切块 | 一站式（改写 /检索 /归因全托管） | Fast Search 档 |
| 价格 | Answers $4/1k + token；$5/月免费额度 | $0.005–0.008/credit（search 1–2 credits） | $4–7/1k search；deep $12–15/1k | ~$15/1k（$75/5k 起） | $14/1k query（Gemini 3，月免 5000 次） | $5/1k（Fast $1/1k） |
| QPS/延迟 | Search 50 QPS，业界最低档 | basic 亚秒 | instant /fast 档 | 受制于上游 | 100 万 query/天/项目 | — |
| 合规 | SOC2、ZDR、训练另购存储权 | 常规 | 常规 | 「US Legal Shield」代刮责任 | 强制展示 Search Suggestions | — |
| 退役参照 | — | — | — | — | Bing 公网 API 2025-08-11 退役（退役前 $7/1k 档） | — |

### 5.1 「返回 chunk 而非链接」的设计五要点

为 LLM 优化的搜索与传统搜索 API 的差别，拆开就这五条：

1. **内容就绪**：直接返回清洗后正文/高亮片段（Tavily raw_content、
   Exa highlights /contents、Brave 多 snippet），省掉 agent 自己做抓
   页 /解析 /去 boilerplate 的两大工程坑——JS 渲染与反爬。
2. **token 经济**：分页 /限长 /summary 化——Exa 的 AI page summaries
   $1/1k 页、OpenAI 的 search_context_size 三档、Gemini 128k 搜索
   上下文硬窗，都是「给模型喂多少检索内容」的旋钮。
3. **查询理解前置**：autoprompt /查询改写 /神经排序放服务端，客户端
   只需给自然语言问题。
4. **可引元素**：URL + 标题 + 发布日期 + 片段 offset 都要结构化返回，
   方便做句级归因；日期字段同时喂 freshness router。
5. **双向闭环**：extract /crawl 补 search 的空洞（Tavily 全家桶、Exa
   /contents、Brave scrape）——**先检索后定点取深链正文是标准两段式**。

## 六、新鲜度与事实性：FreshQA / FreshPrompt 数字

### 6.1 FreshQA：所有模型都在快变与虚假前提题翻车

FreshQA /FreshPrompt（Vu et al.，Google，arXiv:2310.03214）：

- FreshQA 是 600 题动态基准，四分法 never /slow /fast-changing +
  false-premise，50K+ 人评。结论：**所有模型无论大小，在快变知识题
  与虚假前提题上明显翻车**——这就是 freshness router 的论文级动机。
- **FreshPrompt**：few-shot + 统一格式的检索证据注入（source、date、
  title、snippet、高亮词），让 **GPT-4 绝对正确率提升 47%（strict）/
  31.4%（relaxed）**，优于 Self-Ask 和当时的 Perplexity.AI。
- 消融两组数字：证据条数 1→5→10→15 条，strict 下分别 +9.2 /+14.2 /
  +16.2 个百分点（边际递减但仍没到顶）；**证据排序把新鲜度放前面有
  显著影响**。
- 行为副作用：让模型回答更简洁直接即更好——怂恿简洁比冗长幻觉更少。

### 6.2 检索增强不是免费午餐

通用结论区间：开放域问答上检索增强相对纯参数化模型，事实性提升典型
**+20~40 个百分点**（freshness 敏感子集提升最大），但——

- **检索噪声污染**：检索内容错误时模型可能被带偏；
- **虚假前提确认偏误**：false-premise 类专测这个——用户问错的事实，
  检索到顺着说的网页，模型就把它坐实；
- 因此公网侧的四件套缺一不可：freshness 路由 + 日期感知合成 +
  权威分级 + 冲突披露。

### 6.3 时效 vs 权威冲突的工程处置（四条）

1. **时间戳优先但来源权重不丢**：新发布内容要过域名权威白名单 /百科
   回退，不能因为新就压过权威源。
2. **冲突仲裁**：多源不一致时按「官方发布 > 主流权威媒体 > 聚合站 >
   UGC」层级裁决，并在答案中**披露冲突**（「A 报道 X，B 官方称 Y」），
   不要静默二选一。
3. **日期感知合成**：prompt 中所有 evidence 强制带发布日期
   （FreshPrompt 格式），让模型做「以最新可靠来源为准」的推理，而非
   无日期拼接。
4. **缓存与冻结**：行情类答案带 as-of 时间戳；结论性回答缓存 TTL 设
   短（分钟级），知识性 TTL 设长。

## 七、面试口径：三道主问题的完整答法

### Q1：Perplexity 为什么比传统搜索「多一步」？

**A**：传统搜索交付的是「候选集合」（10 条蓝链），认知成本在用户；
Perplexity 交付「结论」，多出四步：**query 改写 + 多轮检索、内容抽取
进上下文、LLM 综合写作、句级引用**。其中最难的是综合与归因——
Stanford 审计显示当时生成式搜索**仅 51.5% 句子被引用完全支撑**、
74.5% 引用真支撑其句，所以多出的那一步不是套壳，而是把检索效果
转化为可验证答案的全套工程：改写质量、上下文窗口管理、来源可信度
排序、归因 schema、失败兜底。商业化上它还**被允许放弃 CTR /SEO 目标，
排名函数纯按「可引性 /权威性」调**——这是它能比 Google 插件更像原生
答案引擎的结构性原因。

### Q2：grounding 引用怎么保证不错？

**A**：三层防线一句话一层——

1. **生成层**：inline citation（检索源编号进 prompt）+ 系统级约束
   「只写被支撑的事实；无来源不写」；
2. **校验层**：post-hoc 归因校验——每句与其引用源跑 NLI /对齐打分
   （RARR 式），低置信时删句 /降级措辞 /二次补检；结构上用
   groundingSupports 式 span→chunk 映射 + confidenceScores，前端按
   置信度渲染；
3. **评测层**：AIS 做人评框架、ALCE 做自动回归（citation precision /
   recall 双指标），把 Stanford 审计的 51.5% /74.5% 基线当对照。

兜底条款：检索失败/低相关时宁可答「未查到」（Gemini 低 relevance 时
不返回 grounding 就是这个思想）；任何生成但未被引用的句子显式标注
为模型内部知识。**引用是可验证性而非正确性，靠 schema + 校验器 +
指标闭环兜底，而不是「模型变聪明了」**。

### Q3：搜索增强 RAG 与私有知识库 RAG 的区别？

**A**：差异五连——

1. **无索引治理权**：公网侧不可重切/重嵌，只能换 API /参数；
2. **新鲜度是首要指标**：必须 freshness router + 日期感知合成，
   私有库那套「索引即真相」的假设不成立；
3. **成本结构不同**：「工具调用费 + 检索内容 token 费」——OpenAI
   $10/1k 次 + contents 按模型价；Google $14/1k query 且 fan-out 按条
   计费，预算要按「每 prompt 平均 query 数」换算；
4. **信任链外包给搜索源**：要做域级白名单 /权威分级（官方发布 >
   权威媒体 > 聚合站 > UGC），检索噪声污染与虚假前提确认偏误是独有
   风险；
5. **合规暴露面更大**：版权诉讼常客（Perplexity 案例链）、Google 强制
   展示 Search Suggestions、Brave 训练要另买存储权、robots.txt 合规性
   （Cloudflare 隐身爬虫指控）。

## 八、口径与未核实说明

- Perplexity 架构为**创始人访谈 + 产品反推 + 行业共识**拼接口径
  （非官方白皮书），估值 212 亿与微软协议 7.5 亿均按 2026 公开报道
  口径；诉讼与爬虫指控按 Dow Jones 诉状、Wired、Cloudflare 公开口径，
  判决结果不在口径内。
- 各家价格按 **2026-10-12 当日官方定价页**口径：Google Vertex Agent
  Platform 定价页、OpenAI pricing 页、Brave Search API、Tavily
  api-credits 页、Exa pricing（2026-09-25 更新）、SerpAPI plans、
  Perplexity docs pricing。这类页面每月可能变动，**面试前以当日页为准
  复核一次即可**；SerpAPI 「$15–18/1k」为按主流套餐换算的量级口径。
- Stanford 51.5% /74.5% 审计为 2023 年四家生成式搜索的人工审计
  （arXiv:2304.09848），反映的是**当时**的行业水位，不要外推成现在的
  产品仍如此；ALCE 的「约 50% 缺完整支撑」是其 ELI5 子集最强模型口
  径，不是全任务均值。
- HyDE 数字按 NeurIPS 2023 原文口径；FreshQA /FreshPrompt 数字按
  arXiv:2310.03214 口径（GPT-4、当时模型图谱）。
- 「检索增强事实性提升 +20~40pt」为开放域问答文献的典型区间归纳，
  非单一论文数字；DeepSeek 联网开关的产品时间线按公开口径。

## 串联阅读

- [rag全链路](./rag全链路.md)：私有库入库→召回→生成→评测主线——本篇
  的「链路骨架」继承自它，两边合看就是私有 + 公网两条 RAG 大动脉。
- [检索与混合召回](./检索与混合召回.md)：BM25 /BM25F + dense 混合与
  RRF——搜索侧 API 内部同样是混合排序，HyDE 与 freshness 路由可与那篇
  的意图路由对照。
- [幻觉与事实性](./幻觉与事实性.md)：幻觉来源与缓解框架——本篇的引用
  兜底（删句 /降级 /标注内部知识）是那篇「事实性」在公网检索语境下的
  具体化。
- [评测与建库工程](./评测与建库工程.md)：私有库评测体系——本篇的
  AIS /ALCE /Stanford 审计是公网 grounding 侧的对应评测三角。
- [agentic-rag](./agentic-rag.md)：多轮检索循环的家内版——ChatGPT
  Search 的改写多轮与 OpenAI agentic search 三档是把同一循环外包给
  搜索侧。
- [FinOps 与算力成本专题](../finops与算力成本专题.md)：token 成本核算
  框架——本篇的 $14/1k query 与「内容 token 按模型价」是 grounding
  场景的成本延伸。
