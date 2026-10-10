# 搜广推与 LLM 融合专题：从四段级联到端到端三段跳

> **面向**：AI infra / 推荐系统方向候选人，尤其是简历上有搜广推经历、或想在面试里
> 把「推荐系统 LLM 化」讲出深度的人。
> **读完获得**：经典级联的口述版打底、生成式推荐三段跳的主线叙事、semantic ID 的
> 词表工程细节、「LLM 能不能直接做精排」的标准话术，以及推荐 infra 与 LLM infra
> 的六条可迁移共振点。
> **时效口径**：覆盖 2023-05（Google TIGER）到 2026（OneTrans / WWW 2026）的工业
> 时间线；文中全部关键数字均经 arXiv 摘要/全文核验，括注论文编号；凡未获论文级
> 证据的数值一律标「经验量级」或注明交叉印证渠道，不编数字。

## 〇、勘误先行：两条「查无此物」的线索

> ⚠️ 本专题最重要的一段，比任何技术细节都重要——它示范的是**信息审慎**。

调研过程中对两条流传线索做了 arXiv 全库检索、arXiv API 查询与多轮搜索引擎交叉，
结论是：

- 「阿里 Egbert」**查无此物**。阿里（淘宝）线上真实可查的生成式/LLM 推荐工作是
  RecGPT（arXiv:2507.22879）与 TBGRecall（arXiv:2508.11977），不存在名为 Egbert
  的推荐模型。本文通篇不引用该词，面试中也不要说——说出口就是负分信号。
- 「MRank」**查无此物**。其真实对应物是字节的 RankMixer（arXiv:2507.15551，
  精排 scaling 工作，归属字节经中文技术媒体报道交叉印证）。
- 附带一条高频误传：**Wukong（arXiv:2403.02545）是 Meta 的特征交互 scaling law
  工作**，不是什么「流式推荐」系统；其会议出处不写，只按 arXiv 2024 引用。

这是本专题调研在 arXiv 全库/API 检索与多方交叉后得出的勘误。面试里被问到「你看过
哪些推荐大模型论文」时，能主动指出这两处幻觉线索，比多背两篇论文更能建立可信度。

## 一、总表：三条线一张地图

| 线 | 在干什么 | 代表作（时间序） | 一句话定位 |
|---|---|---|---|
| 底线：经典级联 | 千万级物料 → 四段漏斗 → 数十条曝光 | 双塔/DSSM → Wide&Deep → DIN/SIM → DLRM 范式 | 一切讨论的「被改革对象」，必须先会背 |
| 线 1：生成式检索 | item 变成残差量化码字序列，seq2seq 直接解码出推荐 | TIGER 2023 → LC-Rec / IDGenRec 2024 → TBGRecall 2025 | 把召回从「查 ANN 索引」变成「生成 token」 |
| 线 2：排序大模型化 | 验证推荐也有 scaling law，但必须先换架构 | HSTU / Wukong 2024 → RankMixer 2025 | 精排的特征交互可以吃算力红利 |
| 线 3：端到端 | 单一生成模型吃掉多阶段级联 | OneRec-V1/V2 2025、MTGR 2025 | 激进派主场景落地，保守派保留 DLRM 交叉 |
| 辅线：LLM 增强 | 不取代推荐模型，做特征工厂/索引构造器/意图层 | NoteLLM 2024 → HLLM 2024 → RecGPT 2025 | 三种接法，性价比最高、落地最广 |

**一条主线记全局**：推荐系统「LLM 化」不是把 LLM 搬进来打分，而是三次范式迁移
——①生成式检索（semantic ID + seq2seq）→ ②排序大模型化（scaling law 验证）→
③端到端单模型吃掉级联；而 scaling 成立的前提是换架构，在老 DLRM 上堆算力无效。

<div class="diagram-embed">
<iframe src="assets/diagrams/recsys-llm-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/recsys-llm-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、底：经典四段式级联 + DLRM 范式（口述版）

> ▶ 面试题：推荐系统完整链路讲一遍？——**打底题，答不顺后面全免谈**

### 2.1 四段漏斗

1. **召回（matching/retrieval）**：千万~十亿物料 → 数千候选。多路并行：双塔 +
   DSSM 类向量召回（ANN 索引：Faiss/HNSW）、item2item 倒排链、热门/规则兜底、
   多兴趣（MIND）、多模态内容向量。代表：Microsoft DSSM（CIKM 2013）、
   YouTube DNN（RecSys 2016）。
   交融点提示：双塔向量召回与 RAG 的向量检索是**同一套 ANN 工程技术**（建索引、
   度量选择、索引漂移），串联见 [rag全链路](./rag/rag全链路.md)，本篇不重复展开。
2. **粗排**：数千 → 数百，轻量双塔/小 MLP，用少量特征快筛。
3. **精排（ranking）**：数百候选，CTR/CVR/时长多目标打分（pCTR×bid 或组合公式）。
   代表演化线：Wide&Deep（2016）→ DeepFM（IJCAI 2017）→ DIN（阿里 KDD 2018，
   attention 兴趣激活）→ SIM（阿里 CIKM 2020，长序列两阶段检索）→ **DLRM 范式**
   （Meta 2019, arXiv:1906.00091）。
4. **重排（rerank）**：混排多样性/打散/去重/业务规则/listwise 重打。

**延迟预算（经验量级）**：全链路 p99 百毫秒级、召回每路毫秒级×多路并行、精排
几十毫秒。注意这只是经验量级口径——全文唯一引用的硬延迟数字是 OneRec-V2 的
**36ms@L20（arXiv:2508.20900, 2025）**，其余不编。

### 2.2 DLRM 范式：一句顶一万句的结构描述

DLRM（Meta 2019）定义了之后五年工业界精排的骨架：**稀疏特征 embedding lookup
→ 特征交互 → MLP**。其分布式方案写进论文摘要：embedding 表用**模型并行**（表太
大，数百 GB~TB 级，低算强高访存），MLP 用**数据并行**——与后来 LLM 的 TP/DP
切分同构，这是面试里最好用的类比迁移点（见第八节共振点 1）。

### 2.3 为什么要「改革」它

级联的根本矛盾：各阶段目标不一致（召回追覆盖率、精排追 CTR、重排追规则），
逐段有损；且 DLRM 的手工特征交叉模块继承自 CPU 时代，RankMixer 论文指出其
**MFU 仅 4.5%（arXiv:2507.15551, 2025）**——算力喂不进去，这就是「在老 DLRM
上堆算力无效」的工程解释。

## 三、三段跳：生成式检索 → 排序 scaling law → 端到端

### 3.1 第一跳：TIGER 把召回变成「生成」

TIGER（Google, NeurIPS 2023, arXiv:2305.05065）的链路四步：

1. 文本 encoder 提取 item 内容 embedding；
2. **RQ-VAE 残差量化**成 L 级码字元组——这就是 semantic ID（RQ-VAE 源自
   CVPR 2022 图像生成论文 arXiv:2203.01941，是借来的量化工具）；
3. Transformer seq2seq 输入用户历史 semantic ID 序列，**自回归解码**下一 item
   的语义 ID；
4. 查表把码字元组映射回具体 item。

**vs 双塔的优势**：冷启动/泛化更好（ID 从内容语义构造，不靠随机初始化）+ 全库
检索无 ANN 索引漂移 + 逐 token 解码天然支持束搜索约束。**劣势**：beam 解码延迟
（L 级 × beam 宽）、长尾码字训练不足、码本需随物料增长重训并与在线索引版本化
对齐。生成式检索的阿喀琉斯之踵就是长尾码字（详见第四节）。

### 3.2 第二跳：HSTU/Wukong 验证推荐 scaling law

- **HSTU**（Meta, arXiv:2402.17152, ICML 2024）：把排序特征全部序列化，
  用行动序列建模统一推荐问题，被称「推荐 GPT 时刻」的锚点。数字锚：
  NDCG 相对基线最大 **+65.8%（论文口径）**；8K 序列上比 FlashAttention-2
  **快 5.3×–15.2×（HSTU, arXiv:2402.17152）**；最大 1.5 万亿参数、线上
  A/B **+12.4%（论文口径）**、十亿用户平台多场景部署；scaling 跨 **3 个数量级
  算力**仍呈幂律。
- **Wukong**（Meta, arXiv:2403.02545, 2024）：纯特征交互侧的 scaling——
  **2 个数量级**、超过 100 GFLOP/样本 仍有效（只按 arXiv 2024 引用，不写会议
  出处）。

两文合起来的结论：**推荐大模型真有 scaling law，但前提是换架构**——序列建模
（HSTU）与特征交互（Wukong）各自验证，老 DLRM 结构不在幂律曲线上。

### 3.3 第三跳：OneRec 端到端吃掉级联，混合态成为 2025 共识

- **OneRec-V1**（快手, arXiv:2502.18965, 2025）：encoder 编码行为序列 +
  MoE decoder 做 session 级生成，消除级联的目标不一致；首个在主场景超过级联的
  端到端：**总观看时长 +1.68%、平均观看时长 +6.56%（OneRec-V1, arXiv:2502.18965）**，
  摘要口径写作 1.6%；0.05B→1B 参数量 scaling 成立，0.1B vs 0.05B 最大提升
  **精度 +14.45%（论文口径）**。推荐里
  单次曝光无正负对，他们用 reward model 模拟采样构造 DPO 偏好对。
- **OneRec-V2**（arXiv:2508.20900, 2025）：发现 V1 把 **97.66% 算力**花在序列
  encoder 上——于是改 Lazy Decoder-Only 架构，总算力 **-94%（V2 论文口径）**、
  训练资源 -90%、参数 8B；线上 A/B 停留时长 +0.467%/+0.741%；推理延迟
  **36ms@L20 且 MFU 62%（OneRec-V2, arXiv:2508.20900）**；用真实用户反馈做 RL
  （duration-aware reward shaping + adaptive ratio clipping）。
  金句：V1 把 97.66% 算力花在序列 encoder——V2 改 Lazy Decoder-Only 是生成式
  推荐的 **compute allocation 问题**（与 HSTU 同源母题）。
- **MTGR**（美团, arXiv:2505.18654, 2025）：HSTU 化但**保留 DLRM 交叉特征**的
  保守派——GLN + dynamic masking + 用户级压缩，单样本前向 FLOPs 相对 DLRM
  **65×（MTGR 论文口径）**，主流量部署、论文称「近两年来最大涨幅」。它同时是
  辩证素材：说明纯架构替换之外还有「混合保留」路线。
- **RankMixer**（字节, arXiv:2507.15551, 2025；归属经中文技术媒体报道交叉
  印证）：multi-head token mixing 替代 self-attention + per-token FFN +
  sparse MoE，**MFU 4.5%→45%（RankMixer, arXiv:2507.15551）**、参数量 100×
  而延迟持平、1B Dense 全量上线 **+0.3% 活跃天数、+1.08% 时长（论文口径）**——
  证明传统级联内的精排也能 scaling。

**2025 共识**：不是「端到端替代一切」，而是两腿并行——端到端（OneRec/MTGR）证
明可行，精排大模型化（RankMixer）证明级联也能 scaling，线上是「召回生成式 +
精排大模型化」的混合态。OneRec 是激进派，MTGR 是保守派。

## 四、semantic ID：生成式推荐的「词表工程」

> ▶ 面试题：semantic ID 怎么构造？碰撞怎么办？——**极高频**

把 item 映射成 token 序列就是词表工程，三大考点：

1. **RQ-VAE 残差分级量化**：第一级码字表粗语义、逐级残差细化，L 级码字元组即
   semantic ID。工具本身来自 CVPR 2022 图像 AR 生成（arXiv:2203.01941）。
2. **碰撞去重**：不同 item 可能得到相同码字元组——TIGER 的做法是追加一个去重
   码字区分；LC-Rec（人大等, ICDE 2024, arXiv:2311.09049）用 uniform semantic
   mapping 约束码本负载均衡，并做协同语义与语言语义对齐。
3. **长尾难点**：冷门 item 的码字 token 在语料里出现次数极少、训练不足——这是
   生成式检索的阿喀琉斯之踵；且码本需随物料增长重训（RQ-VAE 重训与在线索引
   版本化），还要与后链路排序衔接。

同线代表作：**IDGenRec**（SIGIR 2024, arXiv:2403.19021）用自然语言短语做
textual ID（可解释），**19 个数据集训练 / 6 个零样本测试（论文口径）**——推荐
基座模型的代表作；阿里 **TBGRecall**（arXiv:2508.11977, 2025）用 Next Session
Prediction（session token + 无位置约束的 item token 集合）改造电商生成式检索，
在淘宝数据上看到 scaling 趋势。

## 五、LLM 增强推荐的三种接法（并行比较）

| 接法 | 位置 | 代表作 | 机制 | 落地性 |
|---|---|---|---|---|
| ① 表征进特征（Item 侧） | 特征工厂 | NoteLLM（小红书, WWW 2024, arXiv:2403.01744） | Note Compression Prompt 压成 special token + 对比学习做 I2I 召回 + instruction tuning 生成 hashtag/category；NoteLLM-2（KDD 2025 ADS, arXiv:2405.16789）上多模态 | 最高：LLM 不进在线打分 |
| ② 生成式项目侧（理解进索引） | 索引构造 | TIGER/LC-Rec/IDGenRec；字节 HLLM（arXiv:2409.12740） | HLLM 两级：Item LLM（最大 7B）提内容表征 → User LLM（最大 7B）吃行为序列建兴趣；验证 ID 化传统模型被大幅超越 + 预训练权重/微调/scaling 三问题；摘要称线上正向（未给具体 A/B 数字） | 中：离线重、在线收益看链路 |
| ③ 重排/agentic 侧（意图显式化） | 意图层 | 淘宝 RecGPT（arXiv:2507.22879, 2025-07） | user intent 为中心：意图挖掘/检索/解释三段注入 LLM + 多阶段训练（reasoning 预对齐 + self-training）+ Human-LLM 协作评判；已全量部署淘宝 App（多样性/满意度/曝光/转化全栈正向） | 高：工程重但见效快 |

共同特点：**LLM 不直接参与在线打分**，而是内容侧特征工厂 / 索引构造器 / 意图
层，增量进链路与召回层——这是「性价比最高、落地最广」的融合方式，也是内容社区
（小红书/抖音）内容理解大模型进推荐的标准链：NoteLLM → NoteLLM-2 → HLLM。

## 六、「LLM 能不能直接做精排」的标准话术

> ▶ 面试题：LLM 能不能直接做精排/直接打分？——**高频，有标准答案**

参考答法：能，但贵。CTR 场景 QPS 十万级、p99 几十毫秒（经验量级口径），裸搬
LLM 推理扛不住。所以工业界三选一：

1. **借架构不借参数**——HSTU：借 Transformer 序列建模架构，模型自己从头训；
2. **借参数但离线蒸馏成特征**——HLLM：LLM 预训练权重离线产表征，在线只查表；
3. **端到端但极致工程化**——OneRec-V2：decoder-only + KV cache 化 + L20 卡，
   压到 **36ms、62% MFU（arXiv:2508.20900）**。

三句话收口：架构能借、参数要蒸、在线要抠。

## 七、工业时间线（2023-05 → 2026）

| 时间 | 工作 | 主体 | 一句话 |
|---|---|---|---|
| 2023-05 | TIGER | Google | 生成式检索开山，semantic ID + seq2seq（NeurIPS 2023） |
| 2023-11→2024 | LC-Rec / IDGenRec | 人大等 | 码本对齐与 textual ID 可解释化（ICDE/SIGIR 2024） |
| 2024-02 | HSTU | Meta | 「推荐 GPT 时刻」锚点，scaling 跨 3 数量级（ICML 2024） |
| 2024-03 | Wukong | Meta | 特征交互 scaling law，2 数量级、>100 GFLOP/样本 |
| 2024-03 | NoteLLM | 小红书 | LLM 表征进 I2I 召回（WWW 2024） |
| 2024-09 | HLLM | 字节 | Item/User 双 7B，预训练权重进推荐 |
| 2025-02 | OneRec-V1 | 快手 | 首个主场景端到端超过级联：+1.68% 观看时长；MoE decoder + session 级生成 + DPO（reward model 解推荐无正负对） |
| 2025-05 | MTGR | 美团 | HSTU 化保留 DLRM 交叉，65× FLOPs/样本，主流量部署 |
| 2025-07 | RankMixer | 字节 | MFU 4.5%→45%，100× 参数同延迟，推荐+广告 A/B 正向 |
| 2025-07 | RecGPT | 淘宝 | 意图为中心 agentic 推荐，全量上线淘宝 App |
| 2025-08 | OneRec-V2 | 快手 | -94% 算力、-90% 训练资源、8B + 真实用户反馈 RL |
| 2025-08 | TBGRecall | 阿里 | NSP 改造电商生成式检索，淘宝数据 scaling 趋势 |
| 2025-10→2026 | OneTrans | — | cross-request KV caching + 统一 tokenizer，人均 GMV **+5.68%（arXiv:2510.26104, WWW 2026）** |
| 2026 续线 | TokenMixer-Large / RecGPT-V2·V3 / Explorer Challenge | 字节/淘宝/快手 | 一行带过：推理增强生成式推荐成新热点（本条仅为时间线收录，不作核心论据） |

## 八、infra 共振点六条：推荐与 LLM infra 词汇合流

> ▶ 面试题：推荐 infra 和 LLM infra 有哪些可迁移点？——**高频深挖，本专题灵魂**

1. **embedding lookup = 模型并行的先声**：DLRM 下 embedding 表（数百 GB~TB，
   低算强高访存）走模型并行、dense MLP 走数据并行（DLRM 摘要原文方案）——与
   LLM TP/DP 切分同构；推荐 embedding all-to-all 可比 MoE 的 all-to-all 通信，
   是最顺口的类比迁移点。
2. **MFU 语言合流**：RankMixer 指出传统手工特征交叉继承自 CPU 时代、MFU 仅
   4.5%，改造后 45%；OneRec-V2 推理 62% MFU——与 LLM 侧算子融合/连续 batch
   提 MFU 是同一种语言，MFU 已成排序模型核心 KPI。
3. **KV cache 类物已进推荐**：OneTrans 做 cross-request KV caching——预计算
   行为序列中间表示跨请求复用，论文直接叫 KV cache（arXiv:2510.26104,
   WWW 2026）；HSTU 8K 序列比 FlashAttention-2 快 5.3×–15.2×。注意推荐行为
   序列数千~万级 token，比多数 LLM 上下文还长。
4. **batching 的推荐特殊性**：ranking 请求批量天然在线聚合——一次请求数百
   候选共享 user/context 特征，「请求内共享 + 请求间攒批」双层结构；生成式
   推荐还有 beam 宽束搜索的批处理；RankMixer 摘要写明 "strict latency bounds
   and high QPS"。推荐基本事实：**请求内天然批、p99 优先于 TTFT**——这与 LLM
   serving 追 TTFT/TPOT 的口径相反，差异点要说出来。
5. **训练侧共振**：OneRec 稀疏 MoE 扩容量不涨 FLOPs；DPO/RLHF 偏好对齐迁到
   推荐（reward model 模拟采样解正负样本缺失，V2 进一步真实用户反馈 RL）；
   MTGR 工程优化让 10–100× 复杂度模型训练成本不显著上升——推荐大训开始复用
   LLM 侧 ZeRO 级显存/通信优化。
6. **分布式特征 embedding service**：推荐 serving 要在线特征服务（feature
   store）+ embedding 查找层，与 LLM 的 KV cache 提供方/权重分片在架构上可
   共用同一套低延迟 KV 存储思路（此条为架构类比，属综合判断，非论文结论）。

金句补一条：推荐长序列效率（HSTU 级优化）是**推荐向 LLM 反向输出经验的少数
领域**——行为序列天然比 LLM 上下文长，这块经验值得在面试里反向输出。

## 九、▶ 面试题十条（按频率排序）

1. 【极高】**生成式检索 vs 双塔优劣？**——冷启动与全库检索 vs 延迟与生态成熟；
   长尾码字不足是生成式阿喀琉斯之踵（§3.1、§四）。
2. 【极高】**semantic ID 怎么构造？碰撞怎么办？**——RQ-VAE 残差分级量化；追加
   去重码字 / LC-Rec uniform mapping（§四）。
3. 【极高】**推荐大模型真有 scaling law 吗？**——三证据：HSTU 幂律跨 3 数量级 /
   Wukong 2 数量级 >100 GFLOP/样本 / OneRec 0.05B→1B。要点：scaling 成立的前提
   是换架构，老 DLRM 上堆算力无效（MTGR 可作反面辩证素材）（§3.2、§3.3）。
4. 【高】**LLM 能不能直接做精排？**——能但贵：CTR QPS 十万级 + p99 几十毫秒；
   三选：HSTU 借架构 / HLLM 借参数蒸馏 / OneRec 端到端极致工程化（§六）。
5. 【高】**OneRec 为什么能取代级联？DPO 推荐里正负样本怎么搞？**——encoder 编码
   行为序列 + MoE decoder session 级生成消除目标不一致；reward model 模拟采样
   构造 DPO 对；V2 用真实用户反馈 RL（duration-aware reward shaping + adaptive
   ratio clipping）（§3.3）。
6. 【中高】**OneRec-V1 到 V2 改了什么？**——V1 97.66% 算力花在序列 encoder；V2
   Lazy Decoder-Only，总算力 -94%、8B。本质是 compute allocation 问题，HSTU 与
   OneRec 的共同母题（§3.3）。
7. 【高】**推荐 infra 和 LLM infra 迁移点？**——cross-request KV cache；MFU 语言
   合流；embedding 模型并行 × MLP 数据并行类比 TP/DP；MoE/偏好对齐/scaling 方法论
   搬移。差异：请求内天然批、p99 优先于 TTFT（§八）。
8. 【中高】**长行为序列怎么办？SIM 思路还有用吗？**——传统两阶段检索式长序列
   （DIN→SIM）仍有效；生成式时代 HSTU 8K 序列 5.3–15.2×、MTGR 用户级压缩、
   OneRec encoder 吃全历史；推荐序列几千~万 token 比 LLM context 还长，长序列
   效率是反向输出经验的少数领域（§八.3）。
9. 【中】**semantic ID 线 vs RankMixer 精排大模型线怎么选？**——不是二选一：前者
   主攻召回/端到端（TIGER/OneRec/TBGRecall），后者主攻精排特征交互与 MFU 优化；
   TBGRecall 在召回侧看到 scaling、RankMixer 在精排侧看到 scaling，线上是混合态，
   OneRec 激进派、MTGR 保守派（§3.3、§四）。
10. 【中】**小红书/抖音内容社区，内容理解大模型怎么进推荐？**——标准链：NoteLLM
    （special token + 对比学习 I2I 召回 + 指令微调产 tag）→ NoteLLM-2（多模态）→
    HLLM（7B+7B）；LLM 不直接参与在线打分，而是内容侧特征工厂/索引构造器，进
    链路与召回层（§五）。

## 十、收尾金句（背下来直接用）

- 「scaling 成立的前提是换架构，在老 DLRM 上堆算力无效」——回答一切「推荐有
  没有 scaling law」类问题的第一句。
- 「V1 把 97.66% 算力花在序列 encoder——V2 改 Lazy Decoder-Only 是生成式推荐
  的 compute allocation 问题」——把 OneRec-V2 讲成算力分配问题，立刻显出 infra
  视角。
- 「推荐长序列效率是推荐向 LLM 反向输出经验的少数领域」——双向迁移的收尾。
- 「推荐基本事实：请求内天然批、p99 优先于 TTFT」—— serving 差异点的标准收口。

## 串联阅读

- [rag全链路](./rag/rag全链路.md)：双塔向量召回与 RAG 向量检索共用 ANN 工程
  （Faiss/HNSW、索引漂移、度量选择），召回一节读完直接衔接，两边不重复展开。
- [transformer与attention](./llm基础/transformer与attention.md)：HSTU/TIGER 都是
  Transformer 变体，attention 机制与 FlashAttention 基线不懂则 §3.2 读不动。
- [工程基础八股专题](./工程基础八股专题.md)：召回/粗排/精排的工程配套（缓存、
  特征服务、消息队列）在该篇有通用八股版。
- [设计企业知识库agent](../system-design/设计企业知识库agent.md)：系统设计侧练
  「检索 + 排序 + 生成」编排，与本篇级联漏斗互为应用层镜像。
