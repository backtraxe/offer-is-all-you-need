# Deep Research 架构专题：两大范式、上下文三件套与百万 token 成本账

> **面向谁**：已读过 [agentic评测基准专题](./agentic评测基准专题.md)（榜单数
> 字口径与治理，本篇的邻居）与 [多agent与评测](./多agent与评测.md)（多
> agent 编排基础）的读者，准备一个 agent 在几十分钟、几十到几百次工具调
> 用的预算内做完「查资料 → 读 → 综合 → 写出带引用的报告」这条追问线
> （system design 型与训练理解型都会考）。邻居那篇讲榜单数字怎么报、怎
> 么勘误，本篇只讲**架构与训练侧是怎么做的**，两句衔接、互不重复。
>
> **读完获得**：① DR 与 RAG/Agentic RAG 的边界判断句；② 两大范式的完整
> 数据流——工作流编排（planner → 并行 researcher → synthesizer）与端到
> 端 agentic RL（单模型 ReAct + context_manager）；③ 2025-2026 代表作
> 横评表与数字锚（OpenAI DR、Kimi-Researcher、Tongyi DeepResearch、
> MiroThinker、DeerFlow 2.0 等，全部括注来源年份）；④ 上下文管理三件
> 套（子 agent 隔离 / keep-K 观察裁剪 / 摘要续跑）与三者的代价对比；
> ⑤ 成本量级一手数据（单任务 0.5M-2M token、$0.4-$2/篇）与降本路径；
> ⑥ RL 训练搜索 agent 的特有稳定性坑位；⑦ 评测防泄漏的工程手段；
> ⑧ 八条高频面试题的完整答法。
>
> **时效口径**：素材时间轴从 **2023-05 GPT Researcher 立项**（README 实
> 测）到 **2026-10-11 DeerFlow 2.0 star 实测快照**（gh API）。厂商与官
> 方博文数字一律括注口径年份，未核实项只进文末「口径与未核实说明」，正
> 文不当事实引用。

## 一、主线直觉：一个长程知识工作循环，长出了两种架构

一句话主线：**即「检索-阅读-综合」循环（plan → search → read →
reflect → synthesize）是 DR 的本质；2025 年的范式分叉是「手写工作流编排
vs 端到端 RL 训练单模型 agent」，2025 下半年以后者以开源权重形式被全面
复制，2026 年话题重心转向上下文管理与可验证长链推理**。

先用边界判断句把 DR 钉在地图上：

- 与 **RAG/Agentic RAG** 的边界：RAG 是「一次检索加生成」或少量轮次；
  DR 是**开放式、多轮、带回溯的子问题分解加检索循环**——单次任务可探
  索数百个 URL（Kimi-Researcher 官方博文自述评测期平均 200 多个，2025-
  06）。看到「多轮」「回溯」「上百次工具调用」这些词，就是 DR 而不是
  RAG。
- 与 **agentic评测基准专题.md** 的边界：那篇讲 BrowseComp 阶梯、GAIA
  勘误、HLE 口径这些**榜单治理**，本篇讲**架构怎么搭、RL 怎么训**；
  本篇出现的分数只作为架构论证的锚点。
- 与 **记忆与上下文工程** 的边界：本篇只用「DR 特有的上下文形态」
  （子 agent 隔离、keep-K 工具结果、摘要续跑），通用 memory 体系归那
  篇。

为什么这个循环会分叉成两种架构？因为「谁在 planning」这个问题有两个答案：

1. **人写代码 planning（范式 A）**：planner 拆子问题、supervisor 分发、
   researcher 各自小循环、synthesizer 成文——LangChain 的
   open_deep_research、GPT Researcher、DeerFlow v1 都是这个形态。工程
   可控、可审计、各组件可换不同模型；代价是绑死模型与工具版本、泛化
   差。
2. **模型自己 planning（范式 B）**：单模型在 ReAct 循环里自己决定何时
   搜、何时读、何时回溯、何时收——OpenAI Deep Research、Kimi-Researcher、
   Tongyi DeepResearch 是代表。planning、回溯、冲突消解全靠 RL 涌现；
   代价是训练 infra 门槛高。

**2026 年的共识是混合收口**：模型层端到端 RL，infra 层仍然保留 sandbox、
MCP 会话、上下文管理（Kimi、Tongyi、DeerFlow 2.0 都是这个形态）。面试里
把「范式 A 或 B」答成非此即彼会丢分，收口句要说「模型层 B、infra 层还得
有 A 时代的那些件」。

<div class="diagram-embed">
<iframe src="assets/diagrams/dr-paradigms.html" width="100%" height="880" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/dr-paradigms.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、范式 A：工作流编排（planner → 并行 researcher → synthesizer）

### 2.1 完整数据流

```text
用户 query
  → Scope/澄清节点（可选 human-in-the-loop，确认研究计划）
  → Planner：把问题拆成 N 个子问题 / 报告章节大纲
  → Supervisor：把子问题分发给多个 Researcher 子 agent（并行）
       每个 Researcher 内部是 ReAct 循环：
         search（Serper / Tavily / 内部搜索引擎）
         → read/scrape（网页正文提取，常配小模型过滤「对问题有用的段落」）
         → reflect（够不够？不够就改写 query 重搜——query 改写是核心技能）
       子 agent 返回压缩后的结构化 findings（带 URL 溯源）
  → 收集汇总 → Writer/Synthesizer：按大纲成文，逐句标注引用
  →（可选）Citation / format 校验节点
```

这条链路上每个框都可以独立追问，下面是面试里真正被深挖的四个组件。

### 2.2 关键组件逐个拆

**其一，子问题拆分**。三类策略按演进排：静态 planner 一次拆完（LangChain
三段式，scope → research → write）；递归/树状拆（GPT Researcher 的
tree-like exploration，支持 depth 与 breadth 双配置，README 实测口径）；
RL 让模型自己拆（范式 B，见第三节）。静态拆的最优性来自**并发降延迟**，
递归拆的代价是 **token 爆炸**——所以工程上必须 breadth/depth 双上限加
per-branch 去重。

**其二，每页内容过滤**。这是 token 成本的大头所在，也是最容易被忽略的组
件。GPT Researcher 的官方 README（2026 实测口径）给了一组硬对比：用 Jev
判别模型过滤，**保留段落的相关率是百分之七十三**，而 embedding 相似度只
有百分之四十六；不加过滤器整体**贵出百分之六十五**。金句记好：filter
first, read later——先判别再精读，别把整个网页正文塞进研究上下文。

**其三，子 agent 上下文隔离**。几百个网页的正文不隔离，主上下文注定撑
爆——隔离是防止主上下文被撑爆的**第一手段**。DeerFlow 2.0 把这个做成
一等公民：`context_mode="isolated"`（默认）与 snapshot 两种模式，子
agent 内部消息不进主流，只回结构化结果（README 实测口径）。

**其四，引用溯源**。source tracking 要在**抓取摘要时就记录 URL**，报告
写作时回挂；等到成文阶段再补引用必乱。工程化更彻底的做法是 DeerFlow
2.0 的 deterministic tool receipts（溯源账本）：预算打满时保最新条目和
收据 ID，全程可审计。

### 2.3 范式 A 的坑

- **绑死模型与工具版本**：planner 的 prompt、researcher 的工具调用格式
  都是按当时的模型手写调好的，换底模就要返工；这是 Kimi 官方博文
  （2025-06）论证为什么要转向端到端 RL 时的核心口径。
- **泛化差**：超出设计好的子问题形态，手写编排不会自己转弯。
- **但流程可控、可审计、可分工换模型**：LangChain 的实现里
  summarization / research / compression / final-report 四个角色可以用
  不同模型（README 口径），成本敏感场景这是真实优势。
- **口径提醒**：LangChain 的 open_deep_research 已于 **2026-08-10 归
  档**（README 明示），其 README 快照是归档前状态；DeerFlow 已经从 v1
  的多 agent 编排重写成 2.0 的 SuperAgent harness——社区最热的工作流
  实现自己演化了，别把 v1 角色表当 2026 现状。

## 三、范式 B：端到端 agentic RL（单模型 ReAct + context_manager）

### 3.1 Kimi-Researcher 给出的形式化

Kimi-Researcher 官方博文（2025-06-20，实测核验）是目前披露最完整的端
到端 agentic RL 蓝本。每一步的 state s_t = 系统提示 + 工具声明 + 用户
query，模型产出 (think_t, action_t)，action 是工具调用或 finish；
context_manager 负责把工具结果裁剪后写入下一步状态。工具只有三件套：
**搜索、文本浏览器、代码沙箱**。逻辑流程一行写完：

```text
query → [think → tool_call(search/browse/code)
        → context_manager(压缩/丢弃) → think → ...] × 几十上百轮 → 终答
```

注意三个结构取舍：没有手写 planner/supervisor（planning、回溯、冲突消
解全是 RL 涌现的）；模型是一个而不是一组（多步推理与工具选择在同一份
权重里）；上下文经理是一等基建而不是技巧（没有它几十轮必爆窗，见第五
节）。

### 3.2 RL 涌现了什么，为什么 SFT 做不到

Kimi 博文给了两个涌现案例：多源信息冲突时**自我修正**，以及简单问题也
**主动加搜交叉验证**。这两种行为很难靠 SFT 写出标注——长程轨迹的标注
成本与「什么算对」的定义本身都模糊，而 RL 只需要终局奖励。效果侧的锚
点：**成绩从 8.6 升到 26.9、几乎全靠 RL 一段（HLE，Kimi-Researcher 官
方博文，2025-06）**——这句话是训练方向面试的必背句。

### 3.3 中间形态：WebThinker 的「思考内化」

在 A 与 B 之间还有一条中间路线值得背：WebThinker（人大 RUC-NLPIR，
NeurIPS 2025，arXiv:2504.21776）让 LRM 在 thinking 过程内自主调用
Deep Web Explorer（点击/翻页）和 think-search-draft 报告起草工具，配在
线 DPO 训练；WebThinker-32B-RL 在 GAIA Text-103 达到 **48.5 分**
（MiroThinker 对比表口径，2026）。它的定位是「不端到端训 RL，但把搜索
行为内化进推理过程」——被问「DR 和 reasoning model 的关系」时这是标准
素材。

### 3.4 范式 B 的坑

- **训练 infra 门槛**：严格 on-policy、异步 rollout、partial rollout
  （≥1.5× 加速，Kimi 口径）、可重联的 MCP 沙箱会话——这些件没有，单
  模型 agent 根本跑不起训练（详见第八节）。
- **终局奖励难定义**：报告质量没有 fail-to-pass 单测，OpenAI 的官方口
  径是自注「针对该类任务专门训练过」——评测类任务能被专项优化，通用
  报告质量则长期靠人工偏好。
- **可解释性弱于 A**：涌现的回溯与纠错落不在任何代码里，出 bad case
  时排查靠轨迹回放而不是断点。

## 四、2025-2026 代表作横评与数字锚

下表全部按官方博文/官方 README 实测口径括注年份；未核实项不进表。

| 名称 | 时间 | 已核验数字（括注出处） | 一句话定位 |
|---|---|---|---|
| OpenAI Deep Research | 2025-02-02 | HLE **26.6 分**（带 browsing+python）；GAIA pass@1 平均 **67.36**、cons@64 **72.57**；BrowseComp **51.5 对 1.9**（vs GPT-4o+browsing，OpenAI 官方博文 2025-02） | 端到端 RL 训练 browsing agent（o3 系）的开山之作；一篇报告 5-30 分钟 |
| Kimi-Researcher | 2025-06-20 | HLE pass@1 **26.9**、pass@4 **40.17**；xbench-DeepSearch 达 **69%（avg@4）**；平均 **23 步推理、探索 200+ 个 URL**（官方博文 2025-06） | 国内首个完整披露端到端 agentic RL 细节的 DR |
| smolagents open_deep_research | 2025-02 起 | GAIA validation **55% pass@1**（README 实测，对照口径称原版 67%） | 最早的开源复现，CodeAgent 风格，极小工作量 |
| langchain open_deep_research | 2024-11 起，2026-08-10 归档 | **12,681 star**；Deep Research Bench 第 6 位、分值 **0.4344**；100 题评测成本 **$20-$100**（README 实测） | scope→research→write 三段式，贡献了一手成本表 |
| DeerFlow 2.0 | v1 2025-05；2.0 于 2026-02-28 登 GitHub Trending 第一 | **83,687 star**（gh API 实测，2026-10-11） | 社区最火 DR 实现；v1 是多 agent 编排，2.0 重写为 SuperAgent harness（隔离/快照/沙箱/溯源账本） |
| Tongyi DeepResearch 30B-A3B | 2025-09-17 权重发布 | **20,028 star**；总参 **30.5B**、激活 **3.3B**、上下文 **128K**（GitHub+HF 实测） | 首个开源 DR 专用模型权重；agentic 继续预训练 + 全自动合成数据 + custom GRPO |
| MiroThinker | v0.1 2025-08 → 1.7 2026-03-11 | **8,426 star**；1.7 版 BrowseComp **74.0**、ZH **75.3**、GAIA-Val-165 **82.7**、HLE-Text **42.9**；**上下文给到 256K**（README 实测） | 提出 interactive scaling 作为模型/上下文之外的第三维 scaling |
| WebThinker | 2025-03 开源，NeurIPS 2025 | **1,471 star**；WebThinker-32B-RL 在 GAIA Text-103 达 **48.5**（MiroThinker 对比表口径） | 推理内自主搜索加报告起草的「思考内化」路线 |
| GPT Researcher | 2023-05 起 | **30,017 star**；Deep Research 模式约 **5 分钟/篇、$0.4/次**（o3-mini high，README 实测） | planner+execution 树状递归工作流的工程标杆，老项目长青 |

按主线读这张表，有四个结构性信号值得在面试里主动抛：

1. **范式 B 的分数碾压是源头**：BrowseComp 上 Deep Research 拿 **51.5**，
   同代 GPT-4o 挂浏览工具只有 **1.9**（OpenAI 官方博文，2025-02）——
   差近三十倍，OpenAI 官方自注「针对该类任务专门训练过」，这直接把
   「为什么不继续 prompt 编排」变成了可被追问的送分题。
2. **开源权重复制只用了一个季度量级**：OpenAI 2025-02 发布，Kimi
   2025-06 披露完整 RL 配方，Tongyi 2025-09 放出 **30.5B 总参/3.3B 激
   活**的开源权重（README/HF 实测）——从闭源产品到开源专用模型权重，
   间隔约七个月。
3. **口径差异必须自带勘误**：MiroThinker README 顶部的 **88.2 on
   BrowseComp** 与正文表格的 **74.0** 不一致，疑为闭源 H1 agent 的成绩
   （口径不明）；本篇正文一律采用表格 74.0，88.2 只进「口径与未核实说
   明」。被追问时能把这条差异讲出来，反而是加分项。
4. **第三维 scaling 的话术**：MiroThinker 把 interactive scaling（增加
   工具调用轮数与交互深度）立为模型规模、上下文长度之外的第三维——
   单任务至多 **300-600 次工具调用**（README 实测），这就是「长程」两
   个字在训练侧的量化定义。

## 五、上下文管理三件套：128K-256K 怎么装下几百次工具调用

这是 2025-2026 收敛出的共识答案，三件各有来历、各有代价。

### 5.1 子 agent 隔离：DeerFlow 2.0 的 isolated/snapshot

子 agent 内部的消息流不进主上下文，只回**结构化结果**。DeerFlow 2.0 把
`context_mode="isolated"` 设为默认（README 实测口径），snapshot 模式则
给子 agent 一份主上下文的只读快照。**代价是丢全局视野**：子 agent 看不
到其他分支发现了什么，跨主题互补要靠 planner 显式安排。

### 5.2 keep-K 观察裁剪：MiroThinker 的保留最近五条

MiroThinker 的 `keep_tool_result=5` 只保留最近 5 条工具返回，但**完整
保留 thought/action 链**（README 实测口径）——模型记得自己搜过什么、
想过什么，只是不再看到当时的网页全文。官方称无性能损失且支撑 **200-
600 轮**交互。**代价是远证据需要重搜**：早期抓到的关键段落被裁掉后，
写作阶段引用它要么靠 findings 压缩层留底，要么重新搜一次。

### 5.3 摘要续跑：Kimi context_manager 与阿里 ReSum

Kimi-Researcher 的 context_manager 是这个路线的代表：官方博文（2025-
06）给的对比是**不做管理十轮以内就爆窗，做管理能跑到 50 轮以上、迭
代数多出约三成**。阿里通义的 ReSum 是同一思想的独立命名：用周期性摘要解
锁长程搜索。**代价是丢原始引用**：摘要天然丢 URL 与原文句子，所以摘要
路线必须配外部文件系统或溯源账本兜底（DeerFlow 2.0 的 receipts 就是干
这个的）。

### 5.4 三件套对比速查

| 件 | 代表实现 | 保住什么 | 裁掉什么 | 主要风险 |
|---|---|---|---|---|
| 子 agent 隔离 | DeerFlow 2.0 isolated/snapshot | 主上下文干净 | 子 agent 全部中间消息 | 丢全局视野，分支间互补靠 planner |
| keep-K 观察裁剪 | MiroThinker keep_tool_result=5 | 完整 thought/action 链 | 5 条之前的工具全文 | 远证据需重搜，引用层要 find压缩兜底 |
| 摘要续跑 | Kimi context_manager、阿里 ReSum | 任务进度与结论 | 原始观察与 URL | 引用溯源断链，需账本兜底 |

面试答法上不要把三件讲成并列三选一——**生产形态是叠加用的**：主线用
keep-K 或摘要续跑，分支线用隔离，引用层用账本。

## 六、成本量级与降本路径：一篇报告到底多少钱

### 6.1 一手成本锚点

LangChain 官方评测表（README 实测，2025-08 口径）是目前最可信的一手数
据：跑 100 个 DR 任务总 token 在 **58M-205M** 之间——折算下来**单任务
约 0.5M-2M token**，单任务现金成本约 **$0.5-$1.9**（取决于模型配置）；
其中 GPT-4.1 默认配置是 **58.0M token / $45.98**，Claude Sonnet 4 配置
是 **138.9M token / $187.09**（均为 100 题总量口径）。GPT Researcher 的
Deep Research 模式压到约 **$0.4/篇**（o3-mini high，README 实测）。延
迟侧：OpenAI 官方一篇 **5-30 分钟**（2025-02 系统卡口径），GPT
Researcher 约 **5 分钟**（README 口径）。

面试里的报数句式：「**一次 DR 报告是百万 token 级、几十到上百次工具调
用、几分钟到半小时**」——三个量纲一起报才完整。

### 6.2 降本路径（按真实收益排序）

1. **小模型做页面过滤**：GPT Researcher 的 Jev 判别保留相关段落
   **73% 的命中**、embedding 相似度只有 **46% 的水平**、不过滤贵
   **65% 的成本**（README 实测）；MiroThinker 用 Qwen3-14B/gpt-5-nano
   做 SUMMARY_LLM 是同一思路。**成本大头不在最终报告生成，而在 read
   与过滤层**——这句是「怎么降本」的题眼。
2. **keep-K 工具结果**：见 5.2 节，上下文瘦身直接减输入 token。
3. **轻量版模型分档**：OpenAI 2025-04 上线的 o4-mini 轻量 DR 是产品侧
   的分档答案；LangChain 四角色分模型是工程侧的同款思路。
4. **专用小模型整个换掉通用大模型**：MiroThinker README 的宣称口径是
   「30B 打 Kimi-K2-Thinking 的 1/30 参数量级」——这是其 README 宣称，
   引用时注意标出处。

## 七、阅读管线、引用溯源与反幻觉的诚实口径

### 7.1 网页阅读管线四层

```text
Serper/Tavily 取 SERP → Jina r.jina.ai / Crawl4AI 抓正文
  → 小模型判别过滤（filter first, read later）→ 保留段落进研究上下文
```

要点是第三层把 token 大头挡住了：MiroThinker 官方称 SUMMARY_LLM 选型
对结果影响很小（README 口径），也就是说**判别层的模型不必强，但必须
有**。

### 7.2 引用溯源的正确顺位

顺序不能反：**抓取时记 URL → 摘要带 source 标注 → 写作回挂引用**。
OpenAI 把「引用具体句子/段落」直接训进模型（官方博文口径，2025-02）；
DeerFlow 2.0 走 deterministic tool receipts，deferred 工具经账本可审计；
两者共同点是把溯源做成**结构性产物**而不是成文阶段的后期修饰。

### 7.3 反幻觉：别吹成「解决了幻觉」

OpenAI 官方系统卡（2025-02 口径）自承 DR **仍会幻觉、难区分权威信息与
谣言、置信度校准差**。面试的正确口径：DR 的**诚实定位是「降低幻觉」
而非「解决幻觉」**；工程上的真实手段是多源交叉验证（Kimi 涌现行为
之一就是主动加搜交叉验证）加**可点击复核的引用**——把校验成本转移
给用户，而不是宣称消灭。

## 八、RL 训练搜索 agent 的稳定性坑位（训练方向必问）

Kimi-Researcher 官方博文（2025-06）披露的四点是目前最完整的工业口径，
配 Tongyi DeepResearch 的 custom GRPO（README 口径，2025-09）正好互补：

1. **严格 on-policy**：必须把 toolcall 格式强制器关掉——开着它，采样出
   来的就不是模型自己的分布，梯度方向就错了。这是 on-policy 三个字在
   agentic 场景的具体含义。
2. **负样本控制防 entropy collapse**：失败轨迹占比过高会让熵塌缩、策略
   收敛到保守短轨迹；Kimi 靠负样本战略丢弃维稳。
3. **gamma-decay 奖励压短轨迹**：奖励随步数衰减，鼓励模型别为了「多探
   索」而空转——把「长程」与「高效」对齐。
4. **长尾轨迹的 turn 级 partial rollout**：全异步 rollout 加 partial
   rollout 回放队列，官方口径带来 **≥1.5 倍加速**；再配一个可重联的
   MCP 状态会话沙箱，长尾任务中断不整批报废。

Tongyi 版本的对应件：custom GRPO 带 **token 级梯度、leave-one-out 优势
估计、负样本过滤**，外加 agentic 继续预训练与全自动合成数据管线——面
试被问「有没有不用 REINFORCE 的实现」时就报这条。ReAct 与 IterResearch
「Heavy」双推理范式是它的另一个可背点（README 实测）。

更深的机制细节（partial rollout 回放、熵塌缩的理论解释）归
[rl环境工程专题](../训练与对齐/rl环境工程专题.md) 与
[agentic-rl专题](../训练与对齐/agentic-rl专题.md)，本篇只负责把「DR 训
练侧有什么特有的坑」答圆。

## 九、评测防泄漏：已经是必修课，不是加分项

DR 的成绩高度依赖「没见过的网页能不能搜到答案」，所以评测防泄漏在 DR
语境比一般基准更切身：

- **MiroThinker 的做法**（README 实测口径）：评测时**封禁
  huggingface.co**（防模型走到模型卡上抄答案），并对全轨迹做 **canary
  字符串检测**——这是可以直接抄的两件套。
- **OpenAI 的做法**（官方博文口径，2025-02）：官方自注 GAIA ground
  truth 曾泄露，已**屏蔽包含泄露答案的网站**。
- **邻居边界归邻居**：HLE 口径、GAIA 榜单治理、BrowseComp 阶梯那套榜
  单层面的解读全部归 [agentic评测基准专题](./agentic评测基准专题.md)，
  本篇只负责「跑分时怎么防自己的模型抄近路」。

## 十、▶ 高频面试题

1. **Design 一个 Deep Research 系统，画出架构（高频）**——必须能画
   planner → 并行 researcher → synthesizer 三段式，并主动补上澄清节
   点、子 agent 隔离、引用溯源、成本闸。深度提示：能说出 LangChain 实
   现里 summarization/research/compression/final-report 四个角色可用
   不同模型（README 口径）；收口句说 2026 年的混合形态是「模型层 RL
   加 infra 层 A 时代的件」。
2. **为什么 2025 年后大家转向端到端 RL 搜索 agent？（高频）**——Kimi
   口径三点：工作流绑死模型与工具版本、泛化差；SFT 长程轨迹标注难；
   RL 让 planning/回溯/冲突消解涌现。数字锚必背：**在 HLE 上从 8.6 升
   到 26.9、几乎全靠 RL 一段**（Kimi 官方博文，2025-06）。
3. **单次 DR 多少钱、多少 token？怎么降？（中频）**——报 **0.5M-2M
   token/任务**（LangChain 100 题 58M-205M 推算，2025-08），现金侧约
   **0.4 到 2 美元每篇**（GPT Researcher o3-mini 到 Claude Sonnet 4
   两档，README 实测）；降本路径按收益排：小模型页面过滤（Jev **73%
   对 46% 的对比**、不过滤贵 **65% 的成本**）、keep-K、轻量版分档。深度提
   示：能解释成本大头在 read/过滤层而非最终报告生成。
4. **上下文窗口只有 128K-256K，几百次工具调用怎么装下？（高频）**——
   三件套报全：子 agent 隔离加结构化回传（DeerFlow isolated/snapshot）、
   keep_tool_result=5 只裁观察保 thought/action 链（MiroThinker，
   **200-600 轮**）、摘要续跑（Kimi **不管理十轮内爆窗、管理后 50+ 轮
   且迭代数多三成**，2025-06 官方口径）。深度提示：能比出三件各自的
   代价——隔离丢全局视野、keep-K 丢远证据需重搜、摘要丢原始引用需账
   本兜底——生产形态是叠加用而非三选一。
5. **RL 训练搜索 agent 有哪些特有的稳定性问题？（中频，训练方向必
   问）**——Kimi 四点：严格 on-policy（禁格式强制器）、负样本控制防
   entropy collapse、gamma-decay 奖励压短轨迹、turn 级 partial rollout
   （官方口径 **≥1.5 倍加速**）。Tongyi 版本作为对照：custom GRPO 加
   token 级梯度加 leave-one-out 优势加负样本过滤。
6. **BrowseComp 51.5 这种分怎么来的，为什么 DR 在 Easy-Verify 题上比
   通用模型强这么多？（低频但经典）**——BrowseComp 是 1266 道倒推式
   题：答案难检索但易验证，过程奖励就是「找到即对」；OpenAI 官方自注
   DR 针对该类任务专门训练过（2025-02 口径）。深度提示：衔接邻居文
   档，人类 trainer 两小时只解出 **29.2 分**——报 DR 产品数字时这是
   标准锚点，别忘口径。
7. **引用溯源和反幻觉怎么做？（高频）**——溯源顺位：抓取时记 URL →
   摘要带 source → 写作回挂；OpenAI 把「引用具体句子/段落」训进模型，
   DeerFlow 做 receipts 账本。诚实口径：官方自承仍幻觉、权威源判别弱、
   校准差——DR 是降低幻觉不是解决幻觉，多数工程做法靠多源交叉验证加
   可点击复核。
8. **子问题拆分策略怎么定？广度优先还是深度优先？（中频）**——三类：
   静态 planner 一次拆完（LangChain 三段式）、递归/树状（GPT
   Researcher depth×breadth）、RL 让模型自己拆（端到端路线）。深度提
   示：静态拆的最优性来自并发降延迟，递归拆的代价是 token 爆炸，必须
   breadth/depth 双上限加 per-branch 去重。

**深档总要求**：能把范式 A/B 的分界线说清（hand-crafted workflow vs
end-to-end RL），并指出 2026 年趋势是混合——模型层 RL 训练、infra 层
仍要 sandbox/MCP/context 管理（Kimi/Tongyi/DeerFlow 2.0 都是这形态）。

**浅档总要求**：至少能讲一个完整数据流、报一个成本锚点（**单任务
0.5M-2M token**）、背一个训练侧亮点（**从 8.6 升到 26.9 的 HLE 成绩**
或 Tongyi **3.3B 激活**开源权重）。

## 十一、口径与未核实说明

- **已核实条目口径**：2026-10-11 时点的全部 star 数与 push 日期（gh
  API 实测）；OpenAI Deep Research 全部数字（官方博文，2025-02）；
  Kimi-Researcher 全部训练与评测数字（官方博文，2025-06）；LangChain
  成本表与 Deep Research Bench 0.4344（README 实测）；Tongyi 参数量
  与发布日（GitHub+HF，2025-09-17）；MiroThinker 各版本 benchmark 与
  keep_tool_result 机制（README）；smolagents GAIA 55%（README）；GPT
  Researcher 的 $0.4、约 5 分钟、Jev 数字（README）；DeerFlow 2.0 的
  isolated/context_mode 等机制（README）。
- **Kimi「平均 23 步推理、探索 200+ URL」**：官方博文评测期口径，指评
  测期平均而非每任务上限，正文按此引用。
- **未核实/单列项**（仅作存档，正文未当事实断言）：
  - **Gemini Deep Research**：Google 官方无公开技术报告可查其架构，部
    分分数转自 MiroThinker README 对比表——只宜一句带过「Google 同代
    产品、公开技术披露极少」。
  - **Perplexity**：无公开可信架构描述，本次未取到官方技术文档，正文
    从略。
  - **MiroThinker README 顶部「88.2 on BrowseComp」**：与正文表格
    **74.0** 不一致，疑为闭源 H1 agent 的成绩，口径不明；正文采用
    74.0，88.2 按未核实处理。
  - **langchain-ai/open_deep_research 已归档（2026-08-10）**：README 为
    归档前状态，Deep Research Bench 当前排名未核实。
  - **DeerFlow v1 的具体多 agent 角色表**（coordinator/planner/
    researcher/brief 等）：v1 分支 README 本次未单独拉取，角色名称凭
    2.0 README 的「SuperAgent harness 重写」描述反推，细节可能有出入；
    若要细写需另抓 1.x 分支。
  - 「GAIA 官方榜停更」等**榜单治理口径归邻居**：本篇不重复展开，见
    [agentic评测基准专题](./agentic评测基准专题.md)。
- 未括注出处的数字均出自上述 2026-10 时点的官方 README/博文实测快照；
  各家厂商宣称值（如 MiroThinker「30B 打 K2-Thinking 1/30 参数」）
  正文已显式标「宣称口径」。

## 串联阅读

- [agentic评测基准专题](./agentic评测基准专题.md)：BrowseComp 阶梯、
  HLE 口径、GAIA 勘误、榜单治理——本篇所有分数的口径学背景在那里，
  本篇只负责架构与训练怎么做的。
- [多agent与评测](./多agent与评测.md)：多 agent 编排的通用五层门禁，
  本篇 planner→并行 researcher→synthesizer 是它在 DR 场景的具体化。
- [记忆与上下文工程](./记忆与上下文工程.md)：通用 memory 体系与上下文
  预算；本篇三件套是 DR 特有的上下文形态，generic 解法归那篇。
- [rag/agentic-rag](../rag/agentic-rag.md)：少量轮次的检索循环与 DR 的
  开放式循环正好互为对照，边界判断句用它校准。
- [rl环境工程专题](../训练与对齐/rl环境工程专题.md)：RL 环境、verifier、
  sandbox 选型——本篇第八节训练坑位的机制细节在那篇展开。
- [agentic-rl专题](../训练与对齐/agentic-rl专题.md)：多轮 POMDP 与步级
  归因，DR 单模型 ReAct 训练的理论底座。
- [agentic-serving专题](../inference/agentic-serving专题.md)：长程
  agent 请求的 serving 侧账（195K vs 317 token 实测），与本篇第六节的
  token 成本账互为两面。
- [工具调用与mcp](./工具调用与mcp.md)：DR 工具三件套与 MCP 会话的协议
  层背景，第八节「可重联 MCP 沙箱」的协议细节归它。
