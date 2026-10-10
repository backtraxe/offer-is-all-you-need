# Embedding 与向量索引工程（infra 侧）

> 面向已经在 [检索与混合召回](./检索与混合召回.md) 搞定算法侧（双塔直觉、BM25、
> RRF 公式）的 AI Infra 求职者。算法召回本篇只串联不重复，这里只讲 infra 侧：
> 模型格局与选型、维度与内存账、索引算法三维权衡、数据库工程对照、serving 栈
> 与十亿级架构。
>
> 读完你会得到：① 2025 格局换血的全部分差锚（Qwen3-Embedding-8B 对比 BGE-M3
> 的 11 分差）与 0.6B/4B/8B 三档答卷；② 长上下文与维度账怎么逼出量化；
> ③ IVF / HNSW / DiskANN / 量化族的选型一句话版；④ 换 embedding 模型的
> 全库重建工程账与蓝绿切流标准动作。
>
> **时效口径**：2023–2026。GitHub star 全部 2026-10-11 gh 实测；MTEB 数字
> 均标注榜单快照日（2025-05-24 / 2025-03-07 口径，2025 下半年后位次可能
> 变动）。未核实项一律降级：TEI/Infinity 吞吐不给精确数（官方只以图形式给出
> bge-base @A10 的 benchmark，本篇不引具体数字）；reranker 延迟只给工程估算；
> BGE-M3 的维度/参数不引精确数字、只标常识口径；ANN-Benchmarks 只引
> 「hnswlib 长期帕累托前沿」定性结论；pgvector/Redis 规模甜区标社区通行口径。

## 一、格局换血：BERT 系让位，LLM 底座登顶

2025 年 embedding 模型格局完成了一次换血：旧的 BERT 系（bge、e5，参数
0.3–0.6B 档）把榜首位子让给了 LLM 底座蒸馏出来的新军（Qwen3-Embedding
0.6B/4B/8B、gemini-embedding）。换血的分差是硬的：**MTEB Multilingual
70.58**（Qwen3-Embedding-8B，2025-06-05 榜单快照）对比 BGE-M3 的 59.56，
**足足 11 分**（2025-05-24 快照横评口径）。代价同样硬：推理成本差 10–30
倍。

换血背后的方法论也换了代。Qwen3-Embedding 的训练是三代管线：弱监督对比
预训练（语料由 Qwen3 自己合成）→ 高质量 SFT → model merging；配套的
reranker 则直接 SFT（arXiv 2506.05176，2025-06-05）。工程可直接性：
vLLM ≥0.8.5、TEI ≥1.7.2 原生支持。社区渠道注意口径：GitHub stars
**2.1k**（2026-10-11 实测）不算爆火——使用主渠道在 HuggingFace，别在面试
里吹社区热度。

一句话选型答卷：**0.6B 档够用就 0.6B，追求上限上 4B/8B**。0.6B 档的
serving 成本和上一代 BERT 系同量级，白吃 LLM 底座的分差收益；4B/8B 是
指标预算充足、GPU 富裕时的上限选项。

<div class="diagram-embed">
<iframe src="assets/diagrams/embedding-vector-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/embedding-vector-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、选型横评：MTEB 快照与三档答卷

下表是 **2025-05-24 MTEB 快照**（引自 Qwen3 模型卡横评口径），三列分别为
MMTEB Multilingual / MTEB English v2 / C-MTEB 中文：

| 模型 | 档位 | MMTEB | MTEB Eng v2 | C-MTEB |
|---|---|---|---|---|
| Qwen3-Embedding-8B | 8B | 70.58 | 75.22 | 73.84 |
| Qwen3-Embedding-4B | 4B | 69.45 | 74.60 | 72.27 |
| gemini-embedding-exp-03-07 | 闭源 | 68.37 | 73.3 | — |
| Qwen3-Embedding-0.6B | 0.6B | 64.33 | 70.70 | 66.33 |
| multilingual-e5-large-instruct | 0.6B | 63.22 | 65.53 | 58.08 |
| gte-Qwen2-7B-instruct | 7B | 62.51 | 70.72 | 71.62 |
| BGE-M3 | 0.6B | 59.56 | — | — |
| text-embedding-3-large | 闭源 | 58.93 | — | — |

横评的三个读法：

1. **同档对比见底座收益**：同在 0.6B 档，Qwen3-E-0.6B 比 e5-large-instruct
   高 1.1 分、比 BGE-M3 高 4.8 分——LLM 底座的收益是明火执仗的，不是
   边际改进。
2. **中文垂域仍有小模型窗口**：C-MTEB 上存在 0.3B 档垂域模型反超 4B 档
   通用模型的样本——通用榜不覆盖专有名词时，垂域小模型依旧能打，这与
   [检索与混合召回](./检索与混合召回.md) 的「榜单不如自测」是同一条道理。
3. **BGE-M3 的差异化不是分数是形态**：单次前向同时产出 dense + sparse +
   multi-vector（ColBERT 式）三路表示，8192 token 长文，>100 语言
   （arXiv:2402.03216，2024-02）——一个模型顶一套 hybrid 检索的参数与
   维度按常识口径引用即可（0.6B 档、1024 维量级），面试不要精确报数。

三档答卷再压一遍：
**0.6B 档**（Qwen3-E-0.6B）是高 QPS、成本敏感场景的默认答案；
**4B 档**是质量与成本的平衡档；**8B 档**（或闭源 gemini-embedding，
**MTEB Multilingual 68.32**、3072 维、MRL 可截，Google blog 2025-03-07）
是指标优先、预算不设限时的上限。闭源线的另一锚：text-embedding-3-large，
3072 维，MTEB 64.6 / MIRACL 54.9（OpenAI blog，2024-01-25）。

## 三、长上下文与维度账：16TB 怎么逼出量化

两个常被混为一谈的数：

- **上下文窗口**：8192+ 档的有 BGE-M3、gemini-embedding、jina-v3；
  Qwen3 全系标称 32K。但「模型支持 32K」不等于「检索效果在 32K 验证过」—
  —官方示例的 max_length 仍写 8192。窗口是上限不是甜点，检索精度随
  chunk 变长先升后降（主题稀释），这与 chunking 策略握手。
- **向量维度**：2025 新主流是 3072/4096 维（Qwen3-E 三档分别为
  1024/2560/4096 维）。维度是存储与内存的直接单价。

算一笔十亿级内存账：每 100 万向量 fp32，1024 维约 **4MB**、4096 维
约 **16MB**；放大到十亿条就是 ×1000——**1B 条 × 4096 维 × fp32 ≈
16TB**，任何单机任何集群都不会让原始向量全量驻内存。这笔账就是后面
整章量化技术的存在理由：要么量化压单价（PQ/SQ/BQ/RaBitQ），要么把
本体搬去 SSD（DiskANN），要么两者都上。

## 四、Instruction 现象与非对称模板

LLM 底座 embedding 带来一个 BERT 系没有的现象级旋钮：**query 侧加 instruction 可带来检索分数 +1%~5% 的提升**（Qwen3-E 模型卡口径）。
一句话话术记牢：**instruction 把任务定义注入向量空间，解决一个模型
服务多任务的表示冲突**。

工程落点三条：

1. **非对称**：instruction 只加在 query 侧，doc 侧不加。serving 实现上
   就是 query / doc 两条模板路径分开，别用一个模板函数糊两边；
2. **多语言场景用英文 instruction**——训练语料如此配置，照抄即可；
3. 模板是接口契约的一部分：换模型时模板跟着换，灰度期两套模板并存，
   这和下文「影子库蓝绿」是同一次发布里的事。

## 五、降本两件套：MRL 截维 + 量化反超

### 5.1 MRL（Matryoshka 截维）

同一向量取前 N 维仍然可用，等于**索引维度在线调参、不重训模型**：

- text-embedding-3-large 从 3072 维截到 **256 维，仍超过 ada-002 完整
  1536 维**（OpenAI blog，2024-01-25）——这个对比是 MRL 价值的硬证据；
- gemini-embedding 3072 维可截；Qwen3-E 全系 32 维到上限任意截。

工程含义：先按全维度建库，线上用截维跑；容量紧张时把截维度数调小
重建索引，embedding 不用重算。

### 5.2 Binary Quantization 与 RaBitQ

把每维压到 1 bit，理论内存压缩 **32×**。配套手法是过采样再加精排：
oversampling ×2–4 取候选，再用 fp32 原向量 rescore。实测口径：
**0.98 recall@100、32× 内存压缩**（Qdrant binary quantization 官方实测，
ada-002 1536 维、oversampling ×4；Cohere 4096 维、×2 可达 0.98
recall@50，最高 40× 加速）。两个前提要背：**高维（1536d+）+ 分布居中**，
低维场景慎用。

量化新军 RaBitQ（arXiv:2405.12497 / SIGMOD 2024）：D 维向量压到 D bit
的同时带**理论误差上界**，实测反超 PQ——PQ 多年没有理论保证，RaBitQ
补上了这块短板，正成为 Knowhere / Faiss 系的新标配方向；Qdrant 2025
年后另引入 TurboQuant。工程闭环各家统一：**量化粗筛 + oversample +
原向量 rescore**，而 rescore 成立的前提是原始向量可随机读（这也是
十亿级架构里冷热分层的设计约束）。

## 六、索引算法四件：召回率–延迟–内存三维权衡

所有 ANN 选型本质是同一笔账在三个维度上的不同分配。按性格给结论：

- **HNSW（分层图）**：满内存换最高召回与 QPS，**百万级之王**。旋钮
  M（8–64，建图质量）、efConstruction（建图深度）、ef_search（查询
  深度）；M 翻倍内存线性涨、召回与 QPS 提升。官方口径：1M SIFT、
  M=8 ef=64、12 核 QPS **10248**、TP99 63ms；堆副本近线性，8 副本
  **30655 QPS**（Milvus 2.2 benchmark，2022-11）。短板：图与向量全量
  驻内存、单机构建，十亿级内存吃不消。定性补充：ANN-Benchmarks 上
  hnswlib 长期处于帕累托前沿（只引这一句）。
- **IVF 族（倒排 + 量化）**：k-means 聚 nlist 个桶、查询扫 nprobe 个；
  IVF_PQ 对残差做乘积量化（m 个子空间各 8 bit），压缩 8–32×。性格：
  建索引快、内存省、召回中等、更新友好；召回与内存靠 nprobe 和 PQ
  位数调。ef_search 和 nprobe 是同一性质的钱——都在买「多扫一点」。
- **DiskANN / Vamana（SSD 图）**：诀窍是图放 SSD、内存只放 PQ 压缩
  码做导航打分。官方口径直接给出十亿点完整答卷：**SIFT1B 十亿条、单机 64GB RAM + SSD、超 5000 QPS、均值延迟 3ms 内、95%+ recall@1 的实测**（NeurIPS 2019
  官方口径）；同内存 FAISS 仅约 50% recall；比 HNSW/NSG 每节点多
  服务 5–10 倍数据点。Milvus 侧参数 MaxDegree=56、search_list 越大
  越准越慢；官方硬要求 NVMe 路径。何时用：**内存买不起、QPS 不太凶、数据量巨大的场景**——冷数据与长尾知识库的传统答案。
- **量化族（SQ8 / PQ / RaBitQ / TurboQuant / BQ）**：见第五章。SQ8
  4× 压缩召回几乎无损；PQ 8–32× 无理论保证；RaBitQ 带误差上界 +
  SIMD 位运算；BQ 高维专属 32×。GPU 一档另算：Milvus GPU_CAGRA 大
  批量吞吐可达 CPU 的 **100 倍**（官方 FAQ 口径），代价是 topk≤1024、
  不支持 COSINE（归一化转 IP 绕过）。

**选型一句话版**（直接照背）：

> 库 <千万级、要高召回低延迟 → **HNSW**，内存按 `dim × 4B × N × 1.2~1.5`
> 估；库大、内存敏感、95% 上下召回可接受 → **IVF-PQ / SQ8 / RaBitQ**；
> 十亿级、SSD 充足、QPS 中等 → **DiskANN**；QPS 爆高、batch 大、有
> GPU → **GPU_CAGRA / GPU_IVF**。

## 七、数据库工程对照

| 维度 | Milvus | pgvector | Qdrant | Faiss | Redis Vector |
|---|---|---|---|---|---|
| 定位 | 专用向量 DB，分布式 | PG 扩展，向量+业务表一体 | Rust 专用，payload 强 | C++/Py 库，非服务 | 缓存内嵌 |
| 索引 | HNSW/IVF/DISKANN/GPU_CAGRA（Knowhere+cuvs） | HNSW/IVFFlat | HNSW + SQ/PQ/BQ/TurboQuant | 全家桶自己拼 | HNSW/Flat |
| 2024–26 进展 | GPU 索引、SPARSE+BM25 原生、DAAT_WAND | 0.8 iterative scan、并行构建、binary_quantize | TurboQuant、payload 索引、量化+rescore 全链路 | 收入 RaBitQ | — |
| 规模甜区（社区通行口径） | 千万–十亿+ | 百万–千万级 | 百万–亿级 | 研究/离线建库 | 百万级内存型（估算） |
| stars（2026-10-11 实测） | 46.3k | 23.3k | 35.0k | 41.1k | — |

三个必考点：

1. **pgvector 0.8 的 iterative index scan**（2024-10-30，0.5 HNSW /
   0.6 并行建索引 / 0.7 halfvec·sparsevec·binary_quantize 一路演进，
   最新 0.8.7）。问题：「WHERE 过滤 + HNSW」会因图遍历提前耗尽 limit
   把结果滤光、凑不齐 top-k；0.8 起迭代继续扫直到凑够——这是「带过滤
   向量检索召回掉底」在 Postgres 侧的标准答案，也是 pgvector 守住
   百万–千万级甜区的关键一版。
2. **Faiss 是库不是服务**。没有 RPC、没有持久化、没有多租户；Knowhere
   就是 Milvus 把 Faiss + hnswlib + DiskANN + cuvs 包起来的引擎层。
   面试说「我们用 Faiss 做线上检索服务」等于自爆。
3. **Milvus 原生 BM25 sparse 向量**：dense + sparse 双路召回 + RRF
   在一个库内完成，hybrid 不再外挂 ES——这与
   [检索与混合召回](./检索与混合召回.md) 的混合检索主线直接握手。

## 八、Serving infra：三条路线与 reranker 成本模型

### 8.1 三条 serving 路线

- **TEI（Text Embeddings Inference）**：Rust + Candle/Flash Attention，
  杀手锏是 **token-based dynamic batching**（max_batch_tokens 默认
  16384）——按 token 总量组批而不是按条数，专治变长 doc 的 padding
  长尾，P99 显著平滑。官方 benchmark（bge-base @A10 @512 token）只以
  图形式给出，本篇不引具体数字。
- **Infinity**：Python/FastAPI + torch/ONNX/CTranslate2/TensorRT，
  OpenAI 兼容 API，单进程多模型混部，CLIP/CLAP/ColPali 多模态一栈
  通吃（stars 3.0k，2026-10-11 实测）。
- **vLLM pooling**：提供 /v1/embeddings、/score、/rerank，≥0.8.5
  支持 Qwen3-E 与 Reranker。但官方 docs 原话：**primarily for
  convenience，不保证比 Transformers 快**。这句原话就是「embedding
  要不要和生成共用 vLLM 集群」的标准答案锚点：**同集群图省事走
  vLLM，独立高 QPS 走 TEI/Infinity 专线**。

批处理长尾的成本账也要会算：embedding 无 KV cache，整条长度进
prefill 式全量计算，attention FLOPs 随长度近似平方、整体成本近线性
——8192 token 单条的成本是 256 token 的 **32 倍量级**；chunk 从 512
调到 1024 token，serving 成本直接翻倍量级。**chunk 粒度即 serving
成本**，这就是和 chunking 策略握手的那只手。

### 8.2 Reranker 成本模型与 0.6B ROI 论证

cross-encoder 的本质：每对 (query, doc) 一次完整前向。rerank top-100、
每对按 500 token 计，就是 **100 次前向**，token 成本比召回阶段放大
两个数量级；延迟上 0.6B 档 GPU 单 query + top-100 在百毫秒量级
（工程估算口径，不给精确数）。

值不值？看硬收益：同一批 top-100 候选（由 0.6B embedding 召回）下，
**Qwen3-Reranker-4B MTEB-R 69.76 对比 bge-reranker-v2-m3 57.03**
（Qwen blog，2025-06）——0.6B 档 reranker 白捞 6 分以上，质量档
直接换个量级。金句：**rerank 是 RAG 里 ROI 最高的一笔延迟换质量
交易**。8B 档边际收益递减，看 ROI 说话。成本封顶三件套：top-20~100
截候选、doc 截断 512 token、0.6B 档兜底高 QPS。

多模态一句带过：CLIP/CLAP/ColPali 走 Infinity 一栈；图像吞吐瓶颈在
视觉 encoder，生产一般与文本 embedding 分离部署。

## 九、十亿级架构：分片、冷热与蓝绿切换

五个标准动作，按顺序背：

1. **分片**：按租户或主键 hash；Milvus segment（growing / sealed）
   自带冷热分层的物理载体。
2. **副本**：读多写少就堆副本——官方 1→8 副本 QPS 7153→30655 近线性
   （Milvus 2.2 benchmark）；热分片 HNSW、冷分片 DiskANN/SQ8 混合部署。
3. **冷热分层与 GC**：原始 fp32 归档对象存储，线上只留量化码 +
   rescore 层——呼应第五章「rescore 要求原向量可随机读」。
4. **离线重建 + 蓝绿切换**：换 embedding 模型 = 全库重 embed + 重建
   索引。标准动作是影子建库 → 双跑灰度对比（离线 recall@k + 线上影子
   流量）→ 原子切流 → 旧库留回滚窗口。金句：**换 embedding 模型 =
   全库重建——十亿级库上模型选型一步到位是刚需**。
5. **CDC 双写对齐**：CDC 驱动增量 embed 双写新旧两库，消费端做去重、
   乱序容忍、embed 服务限流反压，保证灰度期两边向量空间版本对齐。

回答「十亿向量怎么设计」的收口话术：**先算内存账（16TB 不可驻内存），
再按 QPS/召回/成本三角选量化或 SSD 路线，最后用分片副本 + 冷热分层 +
蓝绿切流把工程兜住**。

## 十、▶ 面试题 10 条（频率标注 + 一口答案）

1. 【极高】**HNSW vs IVF-PQ 怎么选？** —— 三维权衡背出；<千万级
   HNSW、大库内存敏感 IVF-PQ/RaBitQ；ef_search 和 nprobe 是同一
   性质的钱。
2. 【高】**十亿向量怎么设计？** —— 先算内存账（1B×4096d fp32 =
   **16TB** 不可驻内存）→ 量化或 SSD：单机 DiskANN、分布式 Milvus
   分片副本；冷热分层；CDC 双写 + 蓝绿切换。先算账再按三角选方案。
3. 【中高】**binary quantization 损失多少召回？** —— 取决于维度
   与配套：1536d + oversampling ×4 + rescore 可到 **0.98
   recall@100**（Qdrant 官方实测），低维慎用；RaBitQ 有误差上界
   反超 PQ。
4. 【高】**rerank 为什么值它的延迟？** —— 成本模型先行（top-100
   = 100 次前向、放大两数量级）；硬收益 0.6B 档 MTEB-R +6~10 分；
   封顶 top-20~100 / 512 截断 / 0.6B 兜底——ROI 最高的延迟换质量
   交易。
5. 【中高】**embedding serving 用 TEI 还是 vLLM？** —— vLLM
   pooling 官方定位 primarily for convenience；TEI token-based
   batching 专治变长长尾；同集群省事走 vLLM、独立高 QPS 走
   TEI/Infinity。
6. 【高】**Milvus / pgvector / Qdrant / Faiss 怎么分？** —— 向量
   是主数据且上规模用 Milvus/Qdrant；附属字段、百万–千万级、要
   吃 PG 事务用 pgvector（0.8 iterative scan 必修点）；Faiss 是
   库不是服务；Redis 百万级内存型。
7. 【中高】**带标量过滤的混合查询为什么召回不足？怎么修？** ——
   ANN 遍历按 limit 提前收敛，结果被过滤裁掉凑不齐 top-k。三件套：
   pre-filter 增大 ef/nprobe 或过召回；pgvector 0.8 iterative
   scan；高选择性过滤反转——先过滤出小集合再暴力扫。
8. 【中】**chunk 大小和模型上下文怎么对齐？** —— 窗口是上限不是
   甜点：精度随 chunk 变长先升后降（主题稀释）、成本近线性上涨；
   按 P95 doc 长度定 chunk、按 serving 成本卡上限。
9. 【中高】**换 embedding 模型迁移成本多大？** —— 向量空间不兼容
   = 全库重 embed + 重建索引，成本 O（全库）；影子库双跑 + 离线
   recall@k + 线上影子流量 + 原子切流 + 回滚窗口；CDC 双写两边
   对齐——所以选型一步到位是刚需。
10. 【中】**GPU 索引什么时候上？** —— 大批量吞吐可达 CPU 100×
    （官方口径）；CAGRA 性能优先吃显存、GPU_IVF_PQ 省显存但精度
    损失大；不支持 COSINE、topk≤1024；高 QPS 大批量场景（推荐
    广告召回）上 GPU，交互式低 QPS 不划算。

## 串联阅读

- 算法侧主线：[检索与混合召回](./检索与混合召回.md) —— 双塔直觉、
  BM25、RRF、垂域术语三板斧，本篇全部引用不重复。
- 流水线全景：[RAG 全链路](./rag全链路.md) —— embedding 与索引是
  建库段，rerank 是精排段，回到链路里看位置。
- 评测口径：[评测与建库工程](./评测与建库工程.md) —— 离线 recall@k、
  影子流量对比的评测细节，换模型灰度就在这里做裁判。
- 引擎侧对照：[推理引擎选型与源码路线](../inference/推理引擎选型与源码路线.md) ——
  TEI/vLLM pooling 的取舍与生成侧引擎选型是同一套方法论。

---

*本篇数字全部给到来源与快照口径；面试引用时报「口径」比报「数字」更稳。
榜单会动、stars 会长，三角权衡与工程动作不会过时。*
