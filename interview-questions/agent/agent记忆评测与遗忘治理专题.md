# Agent 记忆评测与遗忘治理专题：四大基准数字锚 × 五能力维度 × 治理五板斧

> **面向**：已读过 [记忆与上下文工程](./记忆与上下文工程.md)（概念分类）、
> [agent记忆产品化专题](./agent记忆产品化专题.md)（五路线选型 + 删除权合规）、
> [上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md)（压缩谱系与 RL 记忆训练）
> 的读者。本篇不重复架构与选型，只补两块没人写深的地基：**怎么测**（四大基准
> 深挖 + 五能力维度 + 数字锚）与**怎么治遗忘污染**（冲突合并 / 失效时间戳 /
> 漂移监控 / 记忆库 GC）。
>
> **读完获得**：① LoCoMo / LongMemEval / MemBench / RULER 四个基准各自测什么、
> 数字锚怎么背；② 「记忆好不好」的五个可测维度与三套方法学坑；③ 治理五板斧
> （mem0 merge gate、Graphiti 双时态、事实失效时间戳、漂移四红灯、三层 GC）的
> 工程实现点；④ ChatGPT / Mem0 / Letta / Zep 的产品口径与反面教训；
> ⑤ 两道 Top-K 面试原题的分层答法。
>
> **时效口径**：素材口径 **2026-10-12**；论文数字全部按 arXiv 原文面板口径抄录并
> 括注，厂商互测数字一律标「厂商自测」；LOCOMO 存在 50 段论文版与 10 段社区子集
> 两种口径，正文引用处强制标注。未核实项只在文末「口径与未核实说明」单列。

## 〇、定位：本篇只讲两件事——「怎么测」与「怎么治」

记忆库已有三篇打通上游：

- **概念层**（记忆与上下文工程.md）：短期/长期/程序性记忆分类、外挂式选型一句话表；
- **产品层**（agent记忆产品化专题.md）：mem0/Zep/Letta/LangMem/Memobase 五路线
  选型、基准三段论入门、删除权合规、产品形态对照；
- **机制层**（上下文压缩与记忆训练专题.md）：压缩三代谱系、MEM1/MemAgent/
  Memory-R1 的 RL 记忆训练。

本篇接的是下游：**记忆系统上线之后**。学术界 2024–2025 连发四个基准
（LoCoMo → RULER → LongMemEval → MemBench），把「记忆」拆成可量化的五个
能力维度；工业界对应长出五条治理工具链。一句话主线：

**记忆系统上线后最大的工程风险不是「记不住」，而是「记错、记混、旧的不走、
新的进不来」。面试答题主线 = 评测先行（离线基准 + 在线指标）→ 写入门禁 →
冲突合并 → 时态失效 → GC 分级 → 用户可查可删。**

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-memory-eval-gc.html" width="100%" height="960" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-memory-eval-gc.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、四大基准深挖：数字锚才是硬通货

### 2.1 LoCoMo：超长程开放域对话记忆的首个基准（arXiv:2402.17753，2024-02，UNC + Snap）

**构造**：机器-人工流水线——先让两个 LLM agent 基于 persona + 时序事件图谱
（temporal event graph，最多 25 个因果相连事件、跨度 6–12 个月）生成对话，
人工再修正长程一致性；支持图片分享/回复。

**规模（引用必注口径）**：论文版 **50 段高质量对话**，每段平均约 300 turns、
约 9K tokens、横跨最多 35 个 session（是 MSC 数据集的 9 倍长度、6 倍轮数、
4 倍会话数）。注意：公开社区常用 **10 段子集**；Mem0 论文口径为「10 段、每段
约 600 turns、26K tokens、约 200 道题」——两个口径并存，引用时必须注明。

**三个任务**：QA、事件摘要（对照事件图谱评分）、多模态对话生成。QA 分五类推理：
single-hop / multi-hop / temporal / commonsense-world knowledge / adversarial
（对抗类测「拒答不可能问题」；**mem0 因无 ground truth 而剔除此类——这是复现
常踩的坑**）。QA 用 F1 partial match（答案尽量取原文措辞），RAG 另报检索准确率
recall@k；摘要报 F1 / ROUGE / FactScore。

**硬核数字锚（原文 Finding，面试直接背）**：

1. 长上下文 LLM 与 RAG 相对 base 提升 22%–66%，但**仍落后人类 56%，时序
   推理更是落后人类 73%，**时序是所有基准里一致的洼地；
2. 对抗问题上长上下文模型比 base **差 83%：**gpt-3.5-turbo-16k 的对抗题 F1
   跌到 **2.1%，**而 4K 窗口的 GPT-4-turbo 是 **70.2%，**——金句记好：**上下文
   越长越容易被误导产生幻觉**；
3. 事件摘要常见五类错误：丢失时序/因果连接、幻觉补细节、误读幽默讽刺、
   说话人归属错、把无关对话当关键事件。

### 2.2 LongMemEval：记忆系统的「分段归因」利器（arXiv:2410.10813，ICLR 2025，Tencent AI Lab + UCLA）

**定位**：面向聊天助手的长期交互记忆基准——区别于 LoCoMo 的人-人开放对话，
它造的是 **user–assistant 交互史**（含任务型对话），历史长度可自由扩展
（LongMemEval_S 约 115K tokens）。

**构造质量口径：500 道精编题、五大能力齐备**——information extraction（信息
提取）、multi-session reasoning（跨会话聚合）、temporal reasoning（时序推理）、
knowledge updates（知识更新/矛盾覆盖）、abstention（对不存在信息拒答，由 30 道
false-premise 题改造而来）；落题为七种题型（single-session-user /
single-session-assistant / single-session-preference / multi-session /
knowledge-update / temporal-reasoning / abstention）。每类题先用
Llama-3-70B/GPT-4o 生成约 1000 道、人工筛选编辑后**成品率约 5%；**答案拆成
evidence statements 并标注会话位置 → **可以直接测检索中间指标（Recall@k、
NDCG@k）**，这是它比 LoCoMo 更适合「分段归因评测」的原因。

**数字锚（全部论文口径，2024-08 实测）**：

1. **商用助手显著掉分**：同一个 GPT-4o，离线直读全史 accuracy **0.9184**，
   ChatGPT 在线记忆只有 **0.5773**（掉 37%），Coze **0.3299**（掉 64%）；
   GPT-4o-mini 版 0.7113。这张「0.5773 vs 0.9184」的卡是本基准的招牌数字；
2. **长上下文模型直读全史 vs oracle 只给证据会话：掉分 30%–60%。**（约 50 会话
   的短篇历史已经这样，历史更差）→ 「长上下文 ≠ 有记忆」的硬证据；
3. 正确答案要成立，**约 90% 的情形必须先检索对**；错误实例中 **40%–50% 是
   「检索对了但 reader 读错」**——reading 策略（Chain-of-Note + JSON 结构化
   输出）本身能拉开 up to 10 分；
4. 工程优化收益：key expansion（把抽取的用户事实拼进索引 key）平均
   **+9.4% recall、+5.4% 终答准确率**；time-aware query expansion（时间戳缩
   检索范围）时序题召回 **+6.8%∼11.3%；**value 粒度上 round 拆解优于整
   session 存，压成纯 facts 总体有损、唯独多会话推理题受益；
5. LLM judge（GPT-4o 评审）各题型判定准确率 **≥90%（与人类专家对齐实测）**。

**KU 题的重要失利模式**：检索器只召回「更新后」的信息、漏掉「更新前」的那条，
严格检索口径判失败——直接映射「新事实覆盖旧事实时系统必须把新旧都挂上时态」
的治理需求（见 §4.2）。

### 2.3 MemBench：多层记忆 × 多场景 × 容量悬崖（arXiv:2506.21605，ACL 2025 Findings，人大 + 华为诺亚）

**定位**：把记忆评测从单维度准确率扩成「多层记忆 × 多交互场景 × 多指标」。
记忆分两层：**factual memory**（事实层）与 **reflective memory**（反思/画像层，
由低层事实归纳出的高层偏好）；场景分 **participation**（agent 参与对话生成
记忆）与 **observation**（旁观他人对话积累记忆）；指标四件套：accuracy、
recall、capacity、temporal efficiency（读写时间成本）。用 MovieLens/Food/
Goodreads 真实用户-物品偏好采「高层偏好」，再一对多映射成低层事实属性，可扩展
到 10K / 100K token 两种长度、两种场景、两种记忆层共 8 个子集。

**数字锚与结论（7 种记忆机制横评：FullMemory / RecentMemory / RetrievalMemory /
GenerativeAgent / MemoryBank / MemGPT / SCMemory）**：

1. 10K-factual-observation 子集上，single-hop 准确率 FullMemory 0.825 /
   RetrievalMemory 0.875，MemoryBank 与 SCMemory 仅 0.575、且 **SCMemory 的
   multi-hop 只有 0.05**——「简单挂历史或纯检索」在简单题上不差，复杂题
   （comparative/aggregative）普遍腰斩；
2. **reflective memory 是重灾区**：GenerativeAgent / MemGPT / MemoryBank 在
   短史子集表现好，换长史子集显著掉分，只有 RetrievalMemory 撑住——归因于
   「遗忘机制把重要记忆表盘掉了」+ 窗口限制。原文结论：「如何在新增长交互后
   仍保住反思记忆」是未解难题；
3. **capacity 测法（面试可背）**：固定证据轮位置，随 token 数增加画逐轮准确率
   曲线，MemGPT 与 Self-Controlled Memory 都出现**陡崖式下跌**——记忆机制存在
   容量临界点，产品上线前必须测自己链路的「悬崖在哪」；
4. 同窗口下基座模型差异显著：多数场景 GPT-4o-mini > Qwen2.5-7B / LLaMA-3.1-8B
   / GLM-4。

### 2.4 RULER：它和记忆的分界线在哪（arXiv:2404.06654，COLM 2024，NVIDIA）

长上下文「针海捞针（NIAH）」扩展版合成基准：13 任务、4 大类（单针/多针/多跳
追踪/聚合，CWE 频次统计、QA 变体），可配置任意长度与复杂度；评了 17 个长上下文
模型。数字锚：**暴力 NIAH 所有模型近乎满分，但 32K 长度下只剩一半模型能保持
令人满意的成绩**；宣称 200K 的 Yi-34B 在难度加大时速降。核心结论：effective
context length ≠ claimed context length。

**和记忆的关系（面试区分题，必考）**：

| 对比项 | RULER | LoCoMo / LongMemEval / MemBench |
|---|---|---|
| 测什么 | 一次上下文内的信息利用（in-context） | 跨会话状态管理（write/read/update/forget） |
| 状态 | 无状态 | 有状态 |
| 适合回归 | reader 能力 | 记忆管线 |

LongMemEval 已证明：给模型 115K 直读全史比「外挂记忆 + 检索」掉分 30%–60%，
所以「上长窗口就不用记忆层」是伪命题。memory 产品回归测试应**两者都挂**：
RULER 回归基座换版后的 reader 能力，LongMemEval 回归记忆管线。

### 2.5 厂商自测口径对照（引用必标「厂商自测」）

- **Zep（arXiv:2501.13956，2025-01，厂商自测）**：DMR（MemGPT 自建的 Deep
  Memory Retrieval 基准）94.8% vs MemGPT 93.4%；LongMemEval 上比 baseline
  accuracy 提升 up to 18.5%、延迟降 90%。
- **Mem0（arXiv:2504.19413，2025-04，厂商自测）**：LOCOMO 横评 6 类 baseline
  + LLM-as-a-Judge J 分——Mem0 平均 J 67%（Mem0g 68.44%）、最强 RAG 约 61%、
  full-context 约 73%（但 p95 约 17s）；分类题 J：single-hop 67.13、
  multi-hop 51.15、temporal 55.51（Mem0g 58.13）、open-domain 72.93（Zep
  76.60 反超一点点）。成本账：Mem0 每段对话只占 **7K tokens**（Mem0g 14K），
  **Zep 图超 600K**（吐槽其节点摘要冗余），full-context 26K；p95 检索延迟
  Mem0 0.2s、总延迟 1.44s vs full-context 17.1s（-91%）。
- **两个狠发现（mem0 论文口径）**：OpenAI 记忆管线生成的记忆**大多没带时间戳**，
  导致 temporal 题 **J 分不足 15%，**直接印证「无时间戳则时序推理必废」；Zep 侧的坑
  是**加完记忆后立刻查答案常错、几小时后重查才好**——图构建是异步多步 LLM
  调用，read-your-write 一致性有分钟到小时级延迟，实时产品不可用（§5.4 展开）。

## 三、评测五维度：把「记忆好不好」拆成可测的数

### 3.1 五维度 × 对应题型 × 指标

| 维度 | 题型出处 | 指标 | 数字锚 |
|---|---|---|---|
| 1. 提取准确率 | LoCoMo single-hop；LongMemEval 三 single-session 题 | F1 partial-match、Recall@k/NDCG@k | LongMemEval 约 90% 正确答须检索先对 |
| 2. 时序推理 | LoCoMo temporal；LongMemEval TR | temporal J 分、时窗召回率 | LoCoMo 落后人类 **73%；**OpenAI 记忆缺时间戳时 **J<15%（mem0 口径）** |
| 3. 多跳整合 | LoCoMo multi-hop；LongMemEval multi-session | 并集覆盖率（不是单条命中率） | MemBench 的 SCMemory multi-hop 仅 **0.05** |
| 4. 矛盾更新 | LongMemEval KU 题（业界唯一标准化测法） | 新旧记忆召回完整性、invalidate 正确率 | 失利模式 = 只召回新不召回旧（或反过来） |
| 5. 拒答 abstention | LoCoMo adversarial；LongMemEval 30 道 false-premise | false-premise 拒绝率 + hallucination rate | gpt-3.5-16k 对抗题 F1 跌到 **2.1%** |

三个设计细节值得复述给面试官：

- **多跳题的评分要点是「证据跨 ≥2 会话」**，要测检索返回条目集合的并集覆盖率，
  不是单条命中率——很多系统单条很准、并集残缺；
- **KU 题是业界唯一标准化「新信息覆盖旧信息」的测法**，建内部评测集时这一段
  直接抄；
- **abstention 题**是防「把不存在的信息答出来」的唯一检验，LoCoMo adversarial
  类无 ground truth 是坑（mem0 干脆剔除），自建集时要用 false-premise 改造法。

### 3.2 方法学三坑（面试加分项）

**坑一：词重叠指标失真。** mem0 论文痛批 F1/BLEU——GT「Alice 三月生」、串答
「七月生」，F1 还能拿高分；所以主指标用 **LLM-as-a-Judge（J 分）**。但 judge
本身要做 meta-eval：LongMemEval 实测 GPT-4o judge 与人类专家一致性 ≥90% 才
敢用。

**坑二：不测中间指标 = 不会归因。** LongMemEval 因标了 evidence 位置，可以把
「错在检索」与「错在阅读」分开——错答中 40%∼50% 是检索对而读者读错。上线
回归也按这个分层打点：召回率、时间窗过滤召回率、reader 正确率分别报数，改任何
一环都能定位到模块。

**坑三：不测容量悬崖 = 发版盲测。** MemBench 的 capacity 曲线法（固定证据位置、
随历史 token 增长画逐轮准确率）是唯一能测出「你的记忆系统在多长历史后崩」的
方法。全链路冒烟不需要全史——**发版前测出悬崖点位置即可进 SLO**。

## 四、遗忘与污染治理：五板斧工程拆解

治理的敌人有四个：**记错**（幻觉事实入库）、**记混**（新旧矛盾共存）、
**旧的不走**（过时事实继续被召回）、**新的进不来**（膨胀挤压 + 冗余吞噬预算）。
五板斧按写入→生命周期→库级卫生的顺序排。

### 4.1 板斧一：写入 merge gate——每次写入一次 LLM 裁决

**Mem0 写入门禁（arXiv:2504.19413）**：每个新事实先在库里取 top-s 语义近邻，
连同候选事实交给 LLM 用 function-calling 四选一：

- **ADD**：无等价记忆，新建；
- **UPDATE**：互补信息，增补进原文；
- **DELETE**：与新信息矛盾，删除旧条；
- **NOOP**：无需变更。

不放单独分类器，全靠 LLM 判定前后语义关系。治理口径一句话：**一次 LLM 调用
就是一次 merge gate**，成本 = 每条新记忆一次写侧 LLM 调用。它天然同时完成
「去重 + 矛盾消解」，也解释为什么 mem0 的记忆库膨胀靠 merge 控制而不是靠删。

### 4.2 板斧二：双时态 invalidate——旧记忆不是删，是降级失效

- **Mem0g 的进阶**：LLM update resolver 判断某已有关系 obsolete 后**把旧边标记
  invalid 而非物理删除**，保留时态推理能力（你能问「三个月前是什么状态」）。
- **Graphiti（Zep，arXiv:2501.13956）的正统做法**：每条 fact 是 (subject,
  predicate, object) 三元组 + **validity window**（valid_from / valid_until），
  新事实冲突时自动 invalidate 旧边；任何时刻可查「当前什么为真 / 过去某时刻
  什么为真」；且所有实体与关系都能回溯到 episode（原始输入），**provenance 是
  它真正的护城河**。

**冲突合并选型一句话（面试背）**：向量库世界用 mem0 四操作（简单可行、每次
写入一次 LLM 调用），图谱世界用双时态 invalidate（支持 as-of 查询，代价是图
工程复杂度）；两者共同点 = 旧记忆不是删，是降级失效。

### 4.3 板斧三：事实失效时间戳——两类时间必须分开

- **第一类：事件发生时间（valid time）**——用户说「我 3 月跳槽了」，
  valid_from = 3 月；
- **第二类：系统记录时间（record time）**——用于审计与 replay。

**双时态（bi-temporal）= 两套时间戳都存**。Graphiti 的 validity window 覆盖
第一类，episode provenance 覆盖第二类。

为什么必须做：LongMemEval KU 题证明，丢了旧时间线检索器约 10% 失败率会
常态化出现；mem0 发现 OpenAI 记忆缺时间戳时 temporal J<15%。工程落地两步：
写入时对每个 fact 抽 valid_from / valid_until（LLM 抽 + 相对时间规范化为绝对
时间戳）；召回时**先时窗过滤再向量召回**（LongMemEval 实测时序题召回
+6.8∼11.3%）。

### 4.4 板斧四：漂移监控——离线回归 + 在线四红灯

**离线侧（上线前/发版）**：维护一个 LongMemEval 式内部评测集（500 量级、五
能力齐备、标 evidence 位置），每次改写入/召回/阅读任一环节跑回归；RULER 用于
回归基座模型换版后的 reader 能力。**换基座 / 换 embedding 模型必须重跑离线集**：
MemBench 实测同窗口下 GPT-4o-mini 与 7B 开源模型差距显著；且 embedding 换版
新旧向量空间不兼容，**要全库重建**。

**在线侧四个红灯指标（面试背）**：

1. **用户纠正率**：用户说「不对，我上次说过 XX / 我已经换工作了」的比例，
   上升 = KU 链路漏标旧事实；
2. **自相矛盾率**：抽查同用户回复中事实级矛盾，靠证据级抽样人工/LLM 审；
3. **记忆活跃分布漂移**：旧记忆召回占比降到异常低 = 时间衰减参数过狠或新记忆
   过挤出旧记忆；
4. **abstention 失效率**：用户故意问「我从没说过的事」被编出来的比例（线上
   灰塞 false-premise 探测题）。

### 4.5 板斧五：记忆库 GC——合并优先于淘汰

三种正统路线及真实出处：

1. **时间衰减（类 LRU）**：MemoryBank（arXiv:2305.10250）用艾宾浩斯遗忘曲线，
   按「距上次被强化的时间 × 记忆重要度」算衰减分，低分淘汰。面试话术 =
   记忆强度 = f（时间衰减, 强化次数, 重要度）。缺点：纯 LRU/TTL 会删掉「三个月
   只提一次但很关键」的事实（病历、住址），**线上事故高发区**；
2. **重要度评分（GenerativeAgents 一脉）**：score = recency × importance ×
   relevance，importance 由 LLM 写入时打。缺点 = LLM 打分一致性差、且
   importance 不随使用演化（MemBench 实测 GenerativeAgent 长史下 reflective
   memory 掉分）；
3. **语义去重合并（merge 优先于 evict）**：写入时先去重/合并——mem0 的
   UPDATE/NOOP 其实就是写侧 GC（把增量吸收进旧条目而不是新插一条）。Zep 是
   被验证的反面案例：每节点缓存全量摘要 + 边上存事实，**实测是 600K tokens
   存 26K 原文**（Mem0 论文口径）。金句：「膨胀」的**解法不是删，是合并
   （consolidation）。**

**生产选型口径：三层漏斗**——写时语义去重（merge gate）→ 定期批量
consolidate（同化主题合并成画像层，MemoryBank/MemBench reflective 层的工业化
形态）→ 末位时间衰减淘汰（仅对「低重要度 + 长时间无召回 + 被合并覆盖」的条目）。
切记 GDPR/删除权的分叉：「标失效不删」与「硬删即删」**两类处置必须按用户
意图区分**——
用户主动要求忘记的，必须物理删除并级联到派生事实（细节见
[agent记忆产品化专题](./agent记忆产品化专题.md) §七 删除权一节，本篇不重复）。

## 五、产品口径：四家的治理设计怎么读

### 5.1 ChatGPT Memory：消费级合规的最小集（OpenAI 官方公告时间线）

- **2024-09-05**：Memory 全量上线（Free/Plus/Team/Enterprise）；「Memory
  updated」即时可见，悬停可进 Manage memories 审阅/删除任何单条；可在对话里
  直接说「记住/忘掉 XX」；
- **2025-04-10**：升级为双轨 = **saved memories**（用户显式要求记住的）+
  **reference chat history**（从全部历史对话自动归纳的洞察）；可随时分开关闭；
  Temporary Chat 不读不写记忆；
- **2025-06-03**：免费用户也得轻量版（仅近期对话的短期连续性）；Plus/Pro
  长程理解。

**第三方实测刺点**：LongMemEval 实测 ChatGPT（GPT-4o 后台）在线记忆 accuracy
0.5773、比同模型离线直读掉 37%；附录还发现「ChatGPT 倾向于随对话覆盖关键
信息」。

**治理设计要点**：可见性（每条记忆可查）+ 可控性（可删可关）+ 明示性（写入
时提示）+ 隔离性（Temporary Chat），这四件套是**消费级记忆合规的最小集**，
做 to-C 产品时直接对照检查。

### 5.2 Mem0：merge gate 治理 + 成本账引流

管线：抽取（LLM 从最近 m 轮 + 滚动全局摘要抽候选事实）→ 合并（向量近邻检索 +
LLM 判 ADD/UPDATE/DELETE/NOOP）→ 检索（top-k 向量召回）→ 读入注入 prompt；
变体 Mem0g = 实体-关系图 + 冲突检测 + invalid 标记。治理点：合并门禁天然是
「去重 + 矛盾消解」；每条记忆有创建/更新时间戳、来源会话；核心引流话术 =
「记忆库膨胀靠 merge 控制，不靠删」。（评测数字均为厂商自测，见 §2.5。）

### 5.3 Letta：分层持久化的治理含义（官方文档口径）

三条正统治记忆原则：所有消息/记忆/工具调用都持久化在数据库，**出窗不丢**
（evict 后仍可 API 取回）；核心记忆块 pin 在 system prompt、agent 通过 memory
工具自编辑；记忆块可 attach/detach 到多个 agent（shared blocks，多 agent 共享
同一用户画像）。治理含义：分层 GC = 上下文内 pin 核心是「永不回收」，recall/
archival 层按需换入换出；**shared blocks 意味着「一处更新多端生效」，冲突合并
必须聚焦到块级，不能散存**。

### 5.4 反面对照：Zep 的两个陈旧教训（Mem0 论文实测，标「厂商互测」）

1. **read-your-write 延迟**：进入的效率复杂度（异步多步 LLM 构图）导致刚写
   进去的记忆立即查询答错、几小时后才对——实时交互产品有「写后立即可读」的
   硬要求，构图管线必须给同步快速路径；
2. **冗余存储**：600K tokens 图结构存 26K 原文，印证「摘要 × 实体 × 关系」
   三重冗余必须由 merge gate 治（§4.5）。

## 六、▶ 面试题

**题1【高频】记忆系统上线后怎么知道质量？**

*青铜答法*：跑几轮人工体验 + 看用户投诉。*你要这么答会失去这道题*——记忆质量
问题（记错、记混、旧的不走）单轮体验根本暴露不出来。

*白银答法（三层）*：

1. **离线基准回归**：内部维护 LongMemEval 式评测集（500 量级、五能力齐备、
   标 evidence 位置），写入/召回/阅读任一环节改动全量跑，基座 / embedding
   换版必重跑（MemBench 实测同窗口下模型间差距显著，且 embedding 换版要全库
   重建）；分层打点（召回率、时窗召回率、judge 分）以定位模块；RULER 回归
   reader 能力；
2. **在线四红灯**：用户纠正率、矛盾率、记忆活跃分布漂移、false-premise
   失效率（线上灰塞探测题）；
3. **容量悬崖测试**：固定证据位置、拉长历史画逐轮准确率曲线，发版前测出
   悬崖点（MemBench 实测 MemGPT / SCMemory 陡崖式下跌），悬崖点进 SLO。

*追问「离线和在线什么区别」*：离线测能力上限，在线测漂移与事故；离线集必须有
abstention 与 KU 题，否则上线后「记错 / 不覆盖」发现不了——LongMemEval 实测
KU 失利模式是只召回新信息漏旧信息，这是离线单测测不出来的分布变化。

**题2【高频】用户改了事实，旧记忆怎么办？（比如「我换工作了」之后「我还在
原来公司」的记忆怎么处理）**

*青铜答法*：删掉旧的 / 覆盖旧的。*直接挂*：物理删除会丢掉时态推理能力，
「三个月前我说的是什么状态」再也答不出来。

*白银答法（四步）*：

1. **写时门禁**：新事实进来先做近邻检索，LLM 判 UPDATE/DELETE（mem0 四操作，
   每次写入一次 LLM 调用的 merge gate）；
2. **时态正解**：不物理删除，标 invalid / validity window（Graphiti / Mem0g），
   支持 as-of 查询，同时**检索层默认只读当前有效事实**；
3. **删除权分叉**：用户显式要求忘记的必须物理删除并级联清理派生记忆
   （GDPR 口径，衔接产品化专题删除权一节）；「系统判定的失效」与「用户要求
   的遗忘」是两条不同的处置路径；
4. **评测闭环**：离线 LongMemEval KU 题回归 + 在线「用户纠正率」监控——
   ChatGPT 官方就提供了「对话内直接说忘掉 XX」的产品级口子，说明这题有
   第一方答案。

*追问「不加时间戳行不行」*：不行，有实锤——mem0 论文实测 OpenAI 记忆管线缺
时间戳时 temporal 题 J<15%；LongMemEval 实测时窗过滤 + 时间感知 query
expansion 能拉 +6.8∼11.3% 时序题召回。时间戳不是 metadata，是记忆语义的
一部分。

**题3【中】「长上下文已经 1M 了，还要记忆层吗？」**

要，且有硬证据：LongMemEval 实测长上下文模型直读全史 vs oracle 只给证据会话
掉分 30%–60%；LoCoMo 实测对抗题上 16K 模型 F1 只有 2.1% 而 4K 模型 70.2%——
上下文越长越容易被误导。RULER 测 in-context 利用、LongMemEval 测跨会话状态
管理，是两件事（§2.4 表）。记忆层的价值不只是「装得下」，更是**状态管理**
（write/read/update/forget 的受控语义）。

## 七、数字锚速查表

| 物品 | 年份 | 关键数字 |
|---|---|---|
| LoCoMo | 2024-02 | 50 段对话 / 约 300 turns / 平均 9K tokens / 最多 35 session；落后人类 56%、时序 73%；对抗题 gpt-3.5-16k F1 2.1% vs GPT-4-turbo 70.2% |
| RULER | 2024-04 | 13 任务、17 模型；全部宣称 ≥32K，仅一半在 32K 及格 |
| LongMemEval | 2024-10 | 500 题、五能力七题型；GPT-4o 离线 0.9184 vs ChatGPT 在线 0.5773（-37%）、Coze 0.3299（-64%）；直读全史掉 30–60%；judge 对齐 ≥90% |
| MemBench | 2025-06 | 7 机制横评；SCMemory multi-hop 0.05；MemGPT/SCMemory 容量陡崖；reflective memory 长史掉分 |
| Zep | 2025-01 | DMR 94.8% vs MemGPT 93.4%；LongMemEval +18.5%、延迟 -90%（厂商自测） |
| Mem0 论文 | 2025-04 | LOCOMO J 67%（Mem0g 68.44%）、最强 RAG 约 61%、full-context 约 73%；single-hop J 67.13 / temporal J 55.51；7K tokens/对话 vs Zep 600K vs 原文 26K；p95 总延迟 1.44s vs full-context 17.1s；OpenAI 记忆时序 J<15%（缺时间戳） |
| ChatGPT Memory | 2024-09 全量 | 2025-04 双轨（saved memories + reference chat history）；2025-06 免费轻量版；Temporary Chat 不读不写 |
| MemoryBank | 2023-05 | 艾宾浩斯遗忘曲线，衰减 = f（时间, 强化次数, 重要度） |

## 八、口径与未核实说明

- LOCOMO 双口径并存：论文版 50 段 / 约 300 turns / 9K tokens；Mem0 论文口径
  10 段 / 约 600 turns / 26K tokens / 约 200 道题。正文两处均已标注，引用时
  勿混。
- **Zep 与 Mem0 的互测数字一律厂商自测**：Zep 的 DMR/LongMemEval 提升转引自
  Zep 论文（arXiv:2501.13956）；Mem0 的 J 分、token 成本、延迟、「OpenAI 记忆
  temporal J<15%」转引自 Mem0 论文（arXiv:2504.19413）。两者互为竞品，数字
  不作中立事实背书。
- LongMemEval 的 ChatGPT/Coze 在线实测为 2024-08 时点数据（论文口径），现行
  ChatGPT 记忆版本（2025-04 双轨后）未重测，正文不外推。
- Letta 及其他厂商的官方 LongMemEval 分数本次未确证，不入正文。
- MemBench 的数字为 10K-factual-observation 子集口径；其他子集绝对值不同，
  只引用方向性结论。
- LoCoMo adversarial 类在 mem0 评测中被剔除（无 ground truth），复现横评表时
  分项不可比。

## 串联阅读

- [记忆与上下文工程](./记忆与上下文工程.md)：记忆概念分类与外挂选型全景，
  本篇的「五能力维度」把那篇的概念拆成了可测的数。
- [agent记忆产品化专题](./agent记忆产品化专题.md)：五路线选型与删除权合规；
  本篇 §4.5 三层 GC 的「硬删分叉」细节在那篇 §七。
- [上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md)：压缩谱系与 RL
  记忆训练；那篇讲「架构与压缩」，本篇讲「评测与治理」，两边在 MemoryBank /
  MemGPT 的实测数字上互为印证。
- [agent评测与观测闭环专题](./agent评测与观测闭环专题.md)：通用 agent 评测
  闭环；本篇是它的记忆域特化（多了时态、KU、GC 三个记忆特有维度）。
