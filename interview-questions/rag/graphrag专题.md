# GraphRAG 与知识图谱 RAG 专题：从预摘要巨舰到按需轻图

> **面向**：已读过 [rag全链路](./rag全链路.md)（RAG 主干）与
> [评测与建库工程](./评测与建库工程.md)（RAG 评测口径）、准备
> 「RAG 进阶 / KG-RAG / GraphRAG」追问线的读者。本篇把评测篇 §4.1 的
> GraphRAG 三段式电梯陈述展开为完整 pipeline、成本账与 2026 生态现状，
> 原段落一句话带走即可，本篇不再重写「解决全局性问题」的动机。
>
> **读完获得**：① 微软 GraphRAG 2024 pipeline 的索引四步与查询四态，以及
> 官方仓库进入维护模式的现状口径；② LazyGraphRAG 官方自我降本账
> （索引千分之一、查询成本七百倍以上差距的由来）；③ LightRAG、HippoRAG、
> HippoRAG2、KAG、PIKE-RAG 五条支线的机制差与各自数字口径；④ 收益矩阵——
> 全局题与多跳是主阵地，简单事实检索增益近零；⑤ 增量更新的结构性软肋与
> 三条对冲路线；⑥ 评测口径混乱的读法与 GraphRAG-Bench 的纠偏设计；
> ⑦ 七条面试题（含追问树）的完整答法。
>
> **时效口径**：素材时间轴从 2024-04 GraphRAG 论文（arXiv:2404.16130）到
> 2026-10 生态实测；全部 star 数为 2026-10-11 gh api 实测口径；论文数字按
> 原文口径括注，官方博客与厂商宣称值一律标「官方口径 / 论文宣称」，未核实项
> 单列于文末「口径与未核实说明」，不作正文事实引用。

## 一、主线直觉：一句话讲清 KG-RAG 的 2026 位置

2024 年微软 GraphRAG 用「建图 + 社区摘要」打开了全局理解（sensemaking）
这条向量 RAG 够不着的线；但索引成本与增量更新的结构性困难，让 2025-2026
年的主流叙事转向三件更便宜的东西：轻量图（LightRAG、HippoRAG）、懒构图
（LazyGraphRAG，微软官方自己下场）、以及把 KG 降格为「第三路召回」的混合
RAG。金句记好：**知识图谱路线已从一种索引结构，演变为按需启用的第三路召回**。

这条主线的全部证据可以排成一条投降时间线：

1. 2024-04 GraphRAG 论文证明全局题上社区摘要碾压向量 RAG；
2. 2024-11 微软研究博客自己推出 LazyGraphRAG，砍掉预摘要——部分否定了自家
   四个月前的 pipeline 假设；
3. 2026-10，官方仓库 README 明示「基本进入维护模式」，star 被港大系的
   LightRAG 反超——生态重心已实质转移。

<div class="diagram-embed">
<iframe src="assets/diagrams/graphrag-flow.html" width="100%" height="770" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/graphrag-flow.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、微软 GraphRAG 2024 pipeline：索引四步与查询四态

### 2.1 索引四步（write-heavy 的完整链条）

按论文（arXiv:2404.16130）与官方文档核实的原厂流程：

1. **切 TextUnit**：语料切成文本单元，作为后续一切抽取与引用的粒度；
2. **LLM 三重抽取**：对每个 TextUnit 用大模型抽实体、关系与 claims，构图；
3. **Leiden 层次社区检测**：在图上做层次化社区划分——这是全局计算的根，
   也是后面增量更新软肋的根；
4. **自底向上预摘要**：从叶子社区开始，逐层为每个社区预生成摘要报告。

工程含义一句话：**索引是「全文多轮 LLM 抽取 + 多次摘要」的 write-heavy
过程**，token 消耗与语料量近似线性还要乘上数倍放大（每个 chunk 一次抽取、
每个实体/关系一次聚合、每个社区一次摘要）。官方 README 至今保留两条警告：
indexing 可能昂贵，**先小规模试**；用你自己的数据前强烈推荐
**prompt tuning**——这两句是成本与工程量的官方自证。

### 2.2 查询四态（被问「GraphRAG 有几种查询」的标准答案）

| 查询态 | 机制 | 适合的题 |
|---|---|---|
| Global Search | 社区摘要 map-reduce 汇总 | 全局 sensemaking（「这套语料整体在讲什么」） |
| Local Search | 实体邻居 + 关联文本扇出 | 实体为中心的局部问答 |
| DRIFT | Local + 社区上下文引导的渐进式挖掘 | 需要多步逐步收窄的探索题 |
| Basic | 纯向量 top-k | 最简单的对照组与事实题 |

社区版 LightRAG 把这条产品线做成了五态开关：local / global / hybrid /
naive / mix（默认 mix = naive + local + global 三路合并），naive 即纯向量
RAG 作为内置对照——框架内自带平替，等于官方承认**单一路线都不够**。

### 2.3 原论文的收益口径（必须带口径复述）

GraphRAG 论文的评测方法是 **LLM-judge 头对头胜率**（comprehensiveness /
diversity / empowerment 三指标，每对 125 问 × 5 次平均），不是有 gold
answer 的准确率。核心数字锚：

- 全局问题对百万 token 级语料，comprehensiveness 胜率
  **七十二到八十三的相对胜率区间（论文宣称，2024）**（podcast 与 news 两个
  数据集，vs 向量 RAG，p<0.001）；
- diversity 胜率 **七十五到八十的相对区间（论文宣称，2024）**。

这两条是「GraphRAG 在全局题上有效」的最强证据，但同时界定了边界：它只
证明相对向量 RAG 的 LLM 偏好胜率，不证明绝对正确率。

### 2.4 维护模式与生态换位（2026-10 实测口径）

- microsoft/graphrag README 明示 **largely in maintenance mode，不再接新
  PR、不排新特性**（2026-10-11 抓取现状）；star **三万六千余（gh api 实测，
  2026-10-11）**，仍是事实参考实现；
- HKUDS/LightRAG star **四万余并完成反超（gh api 实测，2026-10-11）**，且仍
  在高速迭代（2026-05 合入多模态 RAG-Anything）；
- 其余支线：OpenSPG/KAG **九千余 star（同上口径）**、OSU-NLP-Group/HippoRAG
  **四千余（含 HippoRAG2 代码，同一仓库）**、gusye1234/nano-graphrag **近四千
  （社区极简复现，读源码友好）**、microsoft/PIKE-RAG **两千四百余**。

面试里的「2026 现状」表述记这一句：**微软原版 GraphRAG 是事实参考实现但已
冻结，活跃工程选型在 LightRAG/KAG/HippoRAG 生态与 LazyGraphRAG 式按需查询
两条支线上**。

## 三、LazyGraphRAG：官方自我降本（本篇最重要的一个案例）

### 3.1 机制：把构图推到查询时

2024-11-25 微软研究博客（Darren Edge，GraphRAG 一作）发布 LazyGraphRAG，
一刀切掉原 pipeline 最贵的东西：**不做任何预摘要**，图构建整体推迟到查询
时。成本-质量只有一个旋钮——**relevance test budget（相关测试预算）**，实验
给出 100 / 500 / 1500 三档，Z 档表示便宜 LLM 全程或混用。

### 3.2 数字锚（全部为微软官方博客口径，2024-11）

- **索引成本降至全量 GraphRAG 的千分之一（官方口径，2024-11）**，与向量
  RAG 同量级；
- 全局查询质量与 GraphRAG Global Search 相当，而 **查询成本低七百倍以上
  （官方口径，2024-11）**；
- Z500 档 **查询成本仅为 C2 档 GraphRAG Global 的百分之四（官方口径）**，且在
  local + global 全部对比中胜出，包括 C2 档动态社区选择。

### 3.3 动摇了什么假设

LazyGraphRAG 推翻的是「**全局问题必须预建社区摘要**」这条 2024-04 的核心
假设。推论跟着翻转：

- 语料高频变更、或一次性分析场景，全量预索引就是浪费——按需构图合算；
- 「先建库再查」的保费模型只适合高频查询的静态库；
- 官方 repo 进入维护模式 + 这条路线，说明微软自己的判断重心已从「完整
  pipeline 工具」转向「研究演示 + 按需查询机制」。

回答「为什么微软自己打自己脸」时，把这三层讲完就是满分结构：推翻的假设、
翻转的适用判断、以及它作为官方对自家 2024 pipeline 部分否定的证据力。

## 四、轻量图支线一：LightRAG（生态新王）

### 4.1 机制：dual-level 检索 + 可增删的图

LightRAG（arXiv:2410.05779，EMNLP 2025，港大 HKUDS）的机制三件套：

1. **dual-level 检索**：low-level 关键词查实体、high-level 关键词查关系，图谱
   与向量两路共召回；
2. **砍社区报告**：不做任何事先社区摘要，索引与查询的 LLM 调用量大幅减少——
   这是它快的直接来源；
3. **原生增量更新**：支持增量插入与删除（2025-08 引入 document deletion 与
   KG 再生），靠 LLM 抽取缓存快速重建受影响的实体/关系，绕开全局重划分。

### 4.2 数字锚（LLM 三指标胜率口径，与 GraphRAG 同口径可比）

- 对 NaiveRAG 全维度大幅领先，如 agriculture 域 comprehensiveness
  **六十七点六对三十二点四（论文宣称，EMNLP 2025）**；
- 对微软 GraphRAG：comprehensiveness 只是轻微占优，甚至 Mix 域
  **四十九点六对五十点四略输（论文宣称）**；diversity 则大幅领先
  **五十九点二到七十七点二的区间（论文宣称）**。

这组数字的读法比数字本身重要：**微软一方的强项在社区摘要带来的全局性，
LightRAG 一方的强项在关系多样性**——两者不是上下位替代，而是同一道全局题上的
两种偏科。面试若被问「LightRAG 是不是全面碾压 GraphRAG」，正确答案是
「diversity 是，comprehensiveness 打平略输，且它删掉了 GraphRAG 最强的
社区摘要层」。

## 五、轻量图支线二：HippoRAG 与 HippoRAG2（单步 PPR 的便宜与教训）

### 5.1 HippoRAG 一代：把多跳推理从查询时挪进索引时

HippoRAG（arXiv:2405.14831，NeurIPS 2024，OSU）借海马体索引理论起名：
LLM 做 openIE 建 KG 充当 neo-cortex；检索时 query 抽出命名实体，在图上以
**Personalized PageRank** 扩散到 passage 节点充当 hippocampus。

数字锚（NeurIPS 2024，论文宣称）：

- 单步检索追平甚至超过迭代式 IRCoT，同时 **便宜十到三十倍、快六到十三倍
  （论文宣称，2024）**；
- 多跳 QA **至多超当时 SOTA 两成（论文宣称，2024）**。

便宜的机理一句话：**查询时的多轮 LLM 迭代，被替换成索引时一次建图 + 查询
时一次图遍历**——多跳信息由图拓扑预先算好，查询时不再烧 LLM。

### 5.2 HippoRAG2：作者自曝的代价

HippoRAG2（arXiv:2502.14802，ICML 2025，与一代同一仓库，无独立仓库）论文
自己承认：**一代在事实记忆任务上显著低于标准 RAG**。二代的修法是更深的
passage 融合 + LLM 在线 contextualizer，最终在 factual / sense-making /
associative 三类任务全面超过标准 RAG，关联记忆任务 **再超 SOTA embedding
模型七个百分点上下（论文宣称，2025）**。

这一进一退是 KG-RAG 最珍贵的公开教训：**图结构替代向量会牺牲实体级精确
召回，必须保留 passage 锚点**。被问「PPR 扩散的代价是什么」，答「丢实体
精度，HippoRAG 一代在事实记忆上输给朴素 RAG，二代靠 passage 锚点和在线
contextualizer 补回来」即为高分答案。

## 六、行业级 KG：蚂蚁 KAG 与微软 PIKE-RAG

### 6.1 KAG：逻辑形式引导的领域图谱

KAG（OpenSPG，arXiv:2409.13731 v3，蚂蚁）五个支柱：LLM-friendly 知识表示、
KG 与原文 chunk 互索引、**逻辑形式（logical form）引导的混合推理引擎**、
语义推理做知识对齐、模型能力增强。差异化点直白：**数值、时间、专家规则类
知识逻辑交给逻辑式求解，不靠 LLM 语义去凑**。

数字锚：相对 F1 **提升三十三点五（HotpotQA，相对口径，论文 2024）**、
**提升十九点六（2WikiMultiHopQA，相对口径，同上）**；已在蚂蚁的政务问答与
健康问答两条业务线**落地（论文口径，2024）**。注意这是「相对 F1」口径，与
GraphRAG 的胜率口径、HippoRAG 的 acc 口径不可直接比。

### 6.2 PIKE-RAG：知识原子化 + 可训练分解器

PIKE-RAG（arXiv:2501.11551 v4，MSRA，microsoft/PIKE-RAG——**属微软，不属
THU-KEG**，详见文末勘误）把工业任务按「知识抽取与应用复杂度」从 L0 到 L4
分层。核心机制两件：

1. **knowledge atomizing**：chunk 打碎为原子知识 + 分层知识库；
2. **knowledge-aware task decomposition**：按已有知识把题拆成原子问题序列，
   UCB 采样上下文，且 atomic proposer 可训练——Llama-3.1-8B 微调后 MuSiQue
   分解轨迹收集率 **从五十八到八十四的相对跃升（论文宣称，2025）**。

PIKE-RAG 对面试最有价值的是它的两个自我坦白：

- 收益集中在 **大于两跳**的题（MuSiQue）；在 HotpotQA（Easy 档偏多）上与
  GraphRAG local「closely competitive」——**简单事实检索上 KG 路线增益近似
  为零**这个论断，是被竞品论文互相印证出来的；
- 同一组基线下，**仅检索上下文本身就带来约两成九（HotpotQA）、约一成
  （MuSiQue）的准确率提升（论文自测，2025）**——任何「我们比 naive RAG 好
  X 个点」的宣称都必须先扣除这部分基础增益，否则就是口径作弊。

工程含义：KAG 与 PIKE-RAG 已经把「图」升级为「领域 schema、分层原子知识
与可训练分解器」三件套，不再是通用图谱——落地成本进一步上移，选型时要
按行业知识逻辑密度算账。

## 七、工程议题一：收益矩阵——什么时候上 KG，什么时候别上

把第四到第六章的证据对齐成一张选型表：

| 问题类型 | KG 路线增益 | 证据锚 |
|---|---|---|
| 全局 sensemaking（这份语料整体在讲什么） | 大 | GraphRAG comprehensiveness 胜率七十二到八十三（论文宣称 2024） |
| 多跳推理（大于两跳） | 大 | KAG 相对 F1 +33.5 / +19.6（相对口径 2024）；PIKE-RAG 收益集中 >2 跳 |
| 实体关系密集问答 | 中到大 | LightRAG diversity 大幅领先（论文宣称 2025） |
| 简单事实检索 | **近似为零甚至为负** | PIKE-RAG 与 GraphRAG local 在 HotpotQA 打平；HippoRAG 一代事实记忆输标准 RAG（论文自曝 2025） |

落地口诀：**先 naive + query 改写覆盖八成流量，多跳与全局问题浓度超过两成
再上 KG，KG 建库成本进 FinOps 预算**——避免「为了简历上 GraphRAG」的过度
工程。

## 八、工程议题二：增量更新——结构性软肋与三条对冲

### 8.1 软肋的传播链

Leiden 社区检测是**全局划分**。一篇文档增删可能触发：

文档变更 → 社区重划分 → 大量社区边界移动 → 这些社区的预生成摘要全部失效
→ 要么接受脏摘要要么重算。

微软官方文档把「版本升级时重建索引」作为迁移建议路径，等于官方承认这条
软肋。这是 GraphRAG 式全量预摘要路线的**结构性**问题，不是调参能解的。

### 8.2 三条对冲路线

1. **LightRAG 式**：LLM 抽取缓存 + 局部实体/关系重建——受影响范围多大重建
   多大，不碰全局划分（2025-08 起支持 document deletion + KG 再生）；
2. **HippoRAG 式**：图上追加节点 + 在线 PPR，更新只加不减算，在线不再触发
   LLM 重摘要；
3. **LazyGraphRAG 式**：干脆不预摘要，构图推迟到查询时——更新成本问题直接
   不存在，代价是查询时 LLM 调用增多、latency 上移。

工程落点一句话：**按问题域选图拓扑的全局性，而不是选图算法本身**——全局
社区划分换来全局题的强答，代价就是更新击穿；三条对冲的本质都是把「全局
计算」从写路径上挪走或缩小作用域。

## 九、工程议题三：评测口径混乱与 GraphRAG-Bench

### 9.1 三种口径混用的现状

多跳老三件 HotpotQA / 2WikiMultiHopQA / MuSiQue 仍是各论文标配，但打分
口径各说各话：GraphRAG 用 LLM-judge 三指标**胜率**（无 gold answer，只宜
相对对比）、KAG 用**相对 F1**、HippoRAG 用累计 **acc**。三个口径两两不可
直接换算，跨论文比数字必须先换算口径，否则全是错位对比。

### 9.2 GraphRAG-Bench 的纠偏设计

GraphRAG-Bench（arXiv:2506.02404，2025）试图建公共擂台：大学层级领域问题，
**十六学科二十本教材**规模，多选 / 判断 / 开放 / 填空等五种题型，把
**构图质量、检索、生成三段分开打分**的全流水线评测，已跑九种 GraphRAG
方法。2026 年另有 WildGraphBench（arXiv:2602.02053）用真实门户语料测
GraphRAG。

社区共识已经摆明：**原 GraphRAG 的三指标胜率体系不可复现、不可泛化**。
面试谈评测先声明口径，再说清 GraphRAG-Bench 类基准解决的是「有没有比
naive RAG 好」之上的第二层问题——**图结构本身到底贡献了什么**。

## 十、工程议题四：prompt tuning 是隐性人天账

图质量等于抽取质量，而抽取质量对 prompt 与小模型都敏感：

- 微软官方 README 明确建议「用你自己的数据前必须 fine-tune prompts」——
  开箱即用的下游效果必然打折，**多轮抽取迭代的 prompt 要计入人天，而不仅
  是 API 费**；
- LightRAG 在 2025-09 还专门迭代了面向开源 LLM（如 Qwen3-30B-A3B 档位）的
  抽取精度增强，官网明示抽取流程可能陷入**无尽输出循环**——说明实体/关系
  抽取对中小模型不稳定，而抽取这一层的鲁棒性决定整张图上层一切质量。

被问「上 GraphRAG 的隐藏成本」时，标准答法三层：索引 token 费（write-heavy
放大）、更新击穿（Leiden 全局耦合）、prompt 迭代人天（官方自己要求）。

## 十一、工程议题五：组合形态——KG 是第三路召回，router 是常态

LightRAG 把 naive / local / global / hybrid / mix 做成内置开关、默认
mix 三合一，等于在框架内承认单一路线都不够。生产上的成熟组合是：

**router / agentic 决策 → 向量（事实题） / 图局部（实体关系题） / 社区摘要
（全局题）三路择优**。

两个正交关系必须说清：

- **决策层 × 索引层**：agentic RAG 是查询时决策循环（要不要查第二跳、用
  哪一路），KG-RAG 是索引结构，两者不是替代关系而是正交叠加——本篇与
  [agentic-rag](./agentic-rag.md) 的接口点就在这里；
- **router 的升格**：PIKE-RAG 的 task decomposition 实质是把 router 从规则
  分流升格成可训练分解器（atomic proposer 微调后轨迹收集率 84 对 58），这
  是「决策层也在被学习化」的信号。

## 十二、案例与数字锚总表

| 数字 | 含义 | 口径与来源 | 年份 |
|---|---|---|---|
| 72-83 / 72-80 | GraphRAG Global 全局题 comprehensiveness 胜率区间（podcast / news，vs 向量 RAG，p<0.001） | LLM-judge 相对胜率口径，arXiv:2404.16130 v2 | 2024 |
| 75-82 | 同上 diversity 胜率区间 | 同上 | 2024 |
| 0.1 规模级 | LazyGraphRAG 索引成本=全量 GraphRAG 千分之一≈向量 RAG | 官方口径，微软研究博客 | 2024-11 |
| 700 倍以上 | LazyGraphRAG 全局查询成本 vs GraphRAG Global Search | 同上 | 2024-11 |
| 4 | Z500 档查询成本=C2 档 GraphRAG Global 的百分之四，且全胜 | 同上 | 2024-11 |
| 33.5 / 19.6 | KAG 相对 F1 提升点（HotpotQA / 2WikiMultiHopQA，vs SOTA） | 相对口径，arXiv:2409.13731 v3 | 2024 |
| 至多 20 | HippoRAG 多跳 QA 超当时 SOTA 的幅度 | 论文宣称，arXiv:2405.14831 | 2024 |
| 10-30 / 6-13 | HippoRAG 单步检索 vs IRCoT 的成本倍率 / 速度倍率 | 同上，NeurIPS | 2024 |
| 约 29 / 约 10 | 仅检索上下文自带的准确率提升（HotpotQA / MuSiQue） | 控制变量自测，arXiv:2501.11551 v4 | 2025 |
| 7 上下 | HippoRAG2 关联记忆任务超 SOTA embedding 的幅度 | 论文宣称，arXiv:2502.14802 | 2025 |
| 84 vs 58 | PIKE-RAG atomic proposer 微调后 MuSiQue 分解轨迹收集率 | 论文宣称，同上 | 2025 |
| 16 / 20 | GraphRAG-Bench 学科数 / 教材数，九种方法全流水线评测 | arXiv:2506.02404 | 2025 |
| 40,067 vs 36,289 | LightRAG vs microsoft/graphrag star 反超 | gh api 实测 | 2026-10-11 |
| 9,086 / 4,054 / 3,997 / 2,478 | KAG / HippoRAG / nano-graphrag / PIKE-RAG star | gh api 实测 | 2026-10-11 |

## 十三、▶ 面试题（按频率排序）

### Q1（高频）估一下 GraphRAG 给百万 token 语料建索引的 LLM 成本，以及增量更新一篇文档的成本

答题框架：先给多级 token 放大模型——每 chunk 一次实体抽取 + 每实体/关系一次
聚合摘要 + 每社区一次摘要，总量是语料 token 的**数倍放大**；再讲增量更新的
传播链：Leiden 是全局划分，一篇文档变更可能引起社区重划分、摘要全部失效，
官方文档把「重建索引」作为版本升级建议；最后给对冲：LightRAG 缓存重建 /
LazyGraphRAG 按需构图，顺带引用官方**千分之一索引成本与七百倍以上查询成本
差距（官方口径 2024-11）**加分。深度提示：能指出「这是 write-heavy 与
read-time 的成本搬家」者为优。

### Q2（高频）为什么微软自己在 2024-11 推出 LazyGraphRAG？这动摇了什么假设？

期望答到三层：推翻「全局问题必须预建社区摘要」的假设；把构图从 write-heavy
离线推到 read-time 在线，用单一 relevance test budget 旋钮连续调成本-质量
（100 / 500 / 1500 三档）；适用判断翻转——语料高频变更或一次性分析场景
全量索引是浪费。深度提示：能说出「这是官方对自家 2024 pipeline 的部分否定」
并在 2026-10 语境下接上「repo 已进入维护模式」者，信息更新能力直接拉满。

### Q3（高频）KAG 说相对 F1 提升三十三点五（HotpotQA），PIKE-RAG 说 GraphRAG local 在 HotpotQA 上与新方法打平——矛盾吗？

不矛盾，是口径与任务难度分层问题：KAG 的相对提升基线是当时 SOTA 而不是
GraphRAG local；PIKE-RAG 明确收益集中在大于两跳（MuSiQue），且给出
「naive RAG 自带约两成九提升」的控制变量。深度提示：这道题考的不是知识点，
是批判素养——读相对/绝对口径、看基线定义、找控制变量，三条各占一分。

### Q4（高频）HippoRAG 凭什么比 IRCoT 便宜十到三十倍还追平效果？代价是什么？

机理：把「查询时多轮 LLM 迭代推理」替换成「索引时一次 LLM 建图 + 查询时
一次 PPR 图遍历」，多跳信息由图拓扑预计算。代价按 HippoRAG2 论文自曝：
**事实记忆任务显著低于标准 RAG**，必须加回 passage 锚点与 LLM 在线
contextualizer。深度提示：能讲清「PPR 扩散丢实体级精确召回」这一机理者
为优，只背数字者及格。

### Q5（中频）生产系统里 KG-RAG、agentic RAG、向量 RAG 怎么共存？

索引层与决策层正交：KG 是第三路召回结构（LightRAG mix 默认即三合一范式），
agentic 是查询时决策循环。工程路径：先 naive + query 改写覆盖八成流量，
多跳/全局问题浓度超两成再上 KG，KG 建库成本纳入 FinOps 预算。深度提示：
反向追问「什么情况不上 KG」要能答到——简单事实检索为主、语料高频变更、
团队无 prompt 迭代人天预算，三者任一都是劝退信号。

### Q6（中频）增量更新一篇文档，GraphRAG / LightRAG / HippoRAG2 / LazyGraphRAG 各怎么处理？

GraphRAG：Leiden 全局耦合，可能击穿社区摘要，官方建议重建；LightRAG：LLM
抽取缓存 + 局部实体/关系重建，原生支持插入与删除；HippoRAG2：图上追加
节点 + 在线 PPR，不触发 LLM 重摘要；LazyGraphRAG：无预摘要可失效，问题
不存在。深度提示：收尾一句「按问题域选图拓扑的全局性，不是选算法」是
架构感加分点。

### Q7（低频）验收口径题：LightRAG 的 arXiv 号是多少、属哪个组织？PIKE-RAG 属谁？HippoRAG2 的仓库在哪？

三道小坑一次答：LightRAG 是 arXiv:2410.05779（EMNLP 2025），属港大
HKUDS，不属于微软；PIKE-RAG 属微软 microsoft/PIKE-RAG，THU-KEG 名下没有
这个仓库；HippoRAG2 无独立仓库，代码合并在 OSU-NLP-Group/HippoRAG 同仓。
深度提示：这类题出现率低，但答错 2410.12838（那是一本数学论文）会暴露
信息源是二手综述而非一手核对。

## 十四、口径与未核实说明

### 14.1 勘误表（素材调研中已核实的流传错误）

| 幻觉线索 | 核实结果 |
|---|---|
| LightRAG 编号 arXiv:2410.12838 | 错——该编号是无关数学论文（Grüss inequalities）。正确编号 arXiv:2410.05779，EMNLP 2025 |
| THU-KEG / thukeg 名下的 PIKE-RAG 仓库 | 不存在——PIKE-RAG 属微软：microsoft/PIKE-RAG（gh search 实测，star 2,478） |
| OSU-NLP-Group/HippoRAG2 独立仓库 | 不存在（404 实测）——HippoRAG2 代码与数据合并在 OSU-NLP-Group/HippoRAG 同一仓库 |
| microsoft/LightRAG | 不存在——LightRAG 属港大 HKUDS |

### 14.2 未核实单列（正文未当作事实引用）

1. LazyGraphRAG 并入 GraphRAG 主线库的具体发版号与 API 形态——官方博客
   2025-06-06 编辑注被截断，本篇只写「官方博客同年宣布可用，具体版本号未
   核实」；
2. GraphRAG 原论文七十二到八十三胜率对应的 LLM judge 具体型号未细看
   （GPT-4 系，论文评测表），正文只写「LLM-judge 口径」不点名型号；
3. PIKE-RAG 的约两成九 / 约一成增益所用下游 LLM 型号与 prompt 细节未逐一
   核对（论文用 GPT-4o 生成最终答案、atomic proposer 用 Llama-3.1-8B，但
   控制实验基线 LLM 未核对）；
4. GraphRAG-Bench 论文内九种方法的具体排名与分数未展开，正文只引用其规模
   与框架设计；
5. microsoft/graphrag「维护模式」声明的挂出日期未核实，仅为 2026-10-11
   抓取的 README 现状。

## 串联阅读

- [评测与建库工程](./评测与建库工程.md)：§4.1 GraphRAG 三段式电梯陈述是
  本篇的一分钟版；RAG 通用评测口径在本篇第九章被继承。
- [agentic-rag](./agentic-rag.md)：查询时决策循环，与本篇索引结构正交；
  组合接口见本篇第十一章「决策层 × 索引层」。
- [检索与混合召回](./检索与混合召回.md)：向量 / BM25 / rerank 混合是前两路
  召回，本篇 KG 是其第三路扩展；LightRAG mix 与该篇 RRF 思路互为图域对应物。
- [rag全链路](./rag全链路.md)：chunk 切分与索引主干，本篇不再展开。
- [幻觉与事实性](./幻觉与事实性.md)：忠实度与幻觉治理完全复用，KG 路线
  不豁免引用校验。
