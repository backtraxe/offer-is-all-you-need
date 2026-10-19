# 多模态 Embedding 与检索专题：双塔谱系、ColPali 一跳与落库三赛道

> **面向**：已搞定文本侧两篇——[embedding与向量索引工程](./embedding与向量索引工程.md)
> （Qwen3-Embedding / BGE-M3、HNSW/IVF、索引重建账）与
> [检索与混合召回](./检索与混合召回.md)（BM25、RRF、垂域三板斧）——的 RAG / Infra
> 求职者。本篇把「向量 = 单模态文本」的隐含假设打破，只回答一个问题：
> **图、页、帧、音频怎么进同一个检索系统**。文本 embedding、索引算法、蓝绿重建
> 本篇只串联、不重复。
>
> **读完获得**：① 双塔单向量谱系的数字接力（CLIP → ALIGN → SigLIP 2 →
> CN-CLIP → E5-V/VISTA）与每代的「为什么换代」；② late interaction 派
> （ColBERT → ColPali → ColQwen2.5）的完整账——ViDoRe NDCG@5 阶梯、MaxSim
> 成本、存储放大倍数；③ VDR 工程裁决——什么时候截图代替 OCR+chunk，
> 分辨率怎么换算成 token 与向量存储；④ 视频/音频 embedding 的时间粒度
> 选型与降级路线；⑤ 多模态向量库落库的 schema、三条向量赛道、分层漏斗
> 与多模态 reranker；⑥ 六道面试题的完整答法（每题一句话答案 + 两个数字）。
>
> **时效口径**：素材时间轴从 **2021 CLIP/ALIGN** 到 **2026 Qwen3-VL
> Embedding/Reranker**；全部论文数字按 arXiv 原文 / HF 模型卡口径括注
> （2026-10-12 一手抓取），未核实项一律降级，见第八节说明。

## 一、主线：打破「向量 = 单模态文本」的假设

文本 RAG 的整条链路——切块、embedding、ANN、rerank——默认输入是字符串。
但企业知识库里增长最快的恰恰是字符串守不住的东西：PDF 里的表格与图表、
扫描件、产品图、内部培训视频、会议录音。传统解法是给每个模态配一条消化
管线（OCR、版面检测、captioning、ASR），把模态「翻译」回文本再走老路。
2024 年 ColPali 用一组数字证伪了这条路：**检索的瓶颈不在 embedding 模型，
而在前面的消化管线**——同一条 Unstructured+OCR 管线上，BM25 65.5 与
BGE-M3 66.1（ViDoRe NDCG@5 均值）几乎打平，换多好的文本 embedding 都
救不回解析丢掉的版面。

破局的是两条平行路线。双塔单向量派把图、文、视频、音频压进同一个余弦
空间：CLIP 400M 图文对开山，五年卷到 SigLIP 2 的原生长宽比与
Qwen3-VL-Embedding 的 78 子集统一评测。late interaction 多向量派走另一
头：不压成单向量，页面截图直接喂给 VLM 出逐 patch 向量，打分用 MaxSim
词粒度交互——ViDoRe 均值 81.3 那一跳比最强工业文本管线高 22.5pt。工程
落库时两派并不互斥，而是分层：单向量管粗排、多向量管精排、VLM reranker
管终排。下面这张图把三泳道摆在一起，后续每一节对应图中一格。

<div class="diagram-embed">
<iframe src="assets/diagrams/mm-embedding-retrieval.html" width="100%" height="830" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/mm-embedding-retrieval.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、双塔单向量谱系：CLIP → ALIGN → SigLIP(2) → 中文三家 → E5-V/VISTA

双塔的意义一句话：图文共享向量空间 = 「以文搜图 / 以图搜文」的召回底座。
图像侧离线批算、query 侧在线算一次，top-k 走 ANN——与文本双塔完全同构，
所以文本侧的全部索引工程可以直接复用，变的只是 encoder。

### 2.1 CLIP（OpenAI，ICML 2021）：400M 对开山

CLIP（arXiv 2103.00020）的设定极简：对 4 亿从网上搜集的 (image, text)
对做对比预训练，batch 内「谁的 caption 是谁」；图像 encoder（ViT 或
ResNet 系）+ 文本 encoder 各探各的，cosine 归一化后走 InfoNCE。数字锚
（摘要口径）：**zero-shot 不打 1.28M ImageNet 标签就追平原始 ResNet-50**
（论文标准报告口径 ViT-L/14@336 为 76.2% zero-shot top-1）；30+ 个 CV
数据集上 zero-shot 大多可与全监督基线竞争，覆盖 OCR、动作识别、地理定位、
细粒度分类。

面试必须背的两个短板（E5-V 论文 related work 明确指出）：

- 文本 encoder 只在短 alt-text 上训练，**长 query、复杂 query 表征弱**；
- 双塔各自编码，天然无法表征「图文交错输入」（composed query：给一张图 +
  一句「换成这个风格」），要 textual inversion 之类外挂管线才能救。

### 2.2 ALIGN（Google，ICML 2021）：scale 换清洗

ALIGN（arXiv 2102.05918）的哲学与 CLIP 正相反：用超过 10 亿（1.8B）
**未过滤**的 image alt-text 对（刻意不做 Conceptual Captions 式的昂贵
过滤），简单双塔对比。结论口径：ImageNet zero-shot 76.4%，Flickr30K /
MSCOCO 图文检索刷 SOTA，甚至超过带 cross-attention 的融合模型；支持
cross-modality search，query 可以是复杂文本或 text+image。

**CLIP vs ALIGN 是常考的「数据哲学差异」题**：CLIP 是规则清洗的大配比
数据，ALIGN 是刻意不过滤的极端版——align 证明了「噪声可以靠规模补偿」，
这一数据观与后来 LLM pretrain 一脉相承，答题时把线拉通。

### 2.3 SigLIP 与 SigLIP 2：损失函数一行改动 + 统一配方

SigLIP（arXiv 2303.15343，ICCV'23 Oral）核心改动只有一行：softmax
InfoNCE → **逐对 sigmoid loss**。不需要全局归一化的所有 pair 视图，
batch 大小与 loss 解耦。数字锚（摘要口径）：配合 Locked-image Tuning，
只用 4 块 TPUv4、两天训出 84.5% ImageNet zero-shot 的 SigLiT；把 batch
推到极端 100 万 pair 发现收益急速递减，**饱和点就在 32k**——「对比学习
需要超大 batch」这一 CLIP 时代共识被 sigmoid 推翻。

SigLIP 2（arXiv 2502.14786，2025-02）把 2023 年分散出现的增强合成一份
统一配方：captioning-based 预训练（LocCa 式）+ 自蒸馏 / masked
prediction 自监督 + 在线数据精选（ACID），全在 sigmoid 底座上。规格四档
开源：B 86M / L 303M / So400m 400M / g 1B；**NaFlex 变体支持多分辨率 +
保持原始长宽比**（序列长度采样自 128–1024，16×16 patch 网格，双线性插值
位置编码）——原生长宽比对文档图 / OCR 场景极其重要，不拉伸版面。数字锚
（论文 Table 1，0-shot ImageNet）：So400m@384 从 83.2 升到 84.1，g/16@384
到 85.0；多语言上单模型逼近专门多语 mSigLIP 的 Crossmodal-3600 检索表现。

工程地位记好：**SigLIP 的 patch token 输出后来直接喂给 PaliGemma /
ColPali，是整个 late interaction 文档检索派的视觉骨架**，也是当前开源
VLM 视觉 encoder 的默认答案之一。

### 2.4 中文三家：Wukong → R2D2 → CN-CLIP

CN-CLIP（阿里，arXiv 2211.01335）自建约 2 亿中文图文对（HF 卡口径），
5 个尺寸 77M–958M；训练是两阶段——先冻图像 encoder 只训文本侧，再全量
放开（论文摘要口径：该两阶段提升效果）。数字锚用 HF 模型卡对照表
（MUGE 文搜图，zero-shot R@1 / finetune R@1）：

| 模型 | MUGE z.s. R@1 | MUGE finetune R@1 | Flickr30K-CN z.s. R@1 |
|---|---|---|---|
| Wukong（华为，2021） | 42.7 | 52.7 | 51.7 |
| R2D2（字节） | 49.5 | 60.1 | 60.9 |
| CN-CLIP L/14@336（阿里，2022-11） | **63.0** | **68.9** | **71.2** |

梯队背法：Wukong(2021) → R2D2 → CN-CLIP(2022-11) 一代比一代强；R2D2
原文未抓取成功，只引 CN-CLIP 卡内对照行，见第八节说明。工程备注：
CN-CLIP 已是 transformers 原生（ChineseCLIPModel），**中文电商/素材检索
0.5B 以内的默认 baseline**；长宽比与长文本短板照旧存在。

### 2.5 2024 拐点：E5-V 与 VISTA——embedding 直通 MLLM

背景痛点（E5-V 论文 related work 的分型，面试金句）：(a) CLIP 不能
encode 图文交错输入；(b) 在交错图文对上继续训 CLIP 需要昂贵的交错数据
（甚至要 GPT-4 合成）；(c) 把 CLIP 视觉向量喂给文本 encoder 会损伤原有
纯图文检索能力；(d) CLIP 文本侧短训，长 query 弱。两条破局线：

**E5-V（微软 + 北航，arXiv 2407.12580）**：拿现成 MLLM
（LLaVA-NeXT-8B，LLaMA-3 8B + 冻结 CLIP ViT-L 视觉 encoder），用 prompt
把多模态输入「压成一个词的表征」——「Summary above image in one word:」
取 last-token embedding。关键发现：这个 prompt 直接消除 MLLM 内部的
modality gap（PCA 可视化佐证的论文 Figure 3）。训练是 **single modality
training**：只在文本三元组（NLI，约 273K 句子对，与多模态任务无关）上
对比微调，训练时全程拆掉视觉 encoder。成本账（论文 Table 7）：单模态
训练 32×V100 共 1.5 小时，多模态版（558K CC3M）34.9 小时——**省约 95%
训练成本，且平均分反而更高（80.7 vs 73.1）**。检索分（Table 1，zero-shot
图文检索 R@1，方向 = 文搜图）：Flickr30K 79.5（vs CLIP ViT-L 67.3、
EVA-02-CLIP-5B 78.8）、COCO 52.0（vs CLIP ViT-L 37.0）；与同视觉
encoder 的 CLIP ViT-L 比，两集分别高 12.2pt / 15.0pt。composed image
retrieval（Table 2，CIRR R@1）33.9 vs SOTA iSEARLE-XL 25.4，且不用
textual inversion。杀器实验是 I2I（Table 4）：把文本 caption 渲染成图片
再检索，CLIP ViT-L 直接崩到 3.8，E5-V 拿 67.8——**说明 MLLM 能「读图上
的字」**，这就是后面视觉文档检索的伏笔。

**VISTA（BAAI + 北邮，arXiv 2406.04292，ACL 2024 main）**：路线相反——
在强文本 encoder（BGE 系）里引入 visual token embeddings，让文本 encoder
获得读图能力；两阶段训练：先用海量弱标注对齐 visual token 与文本空间，
再用合成的 composed image-text 数据（IT2I，含 hard negatives）补多模态
联合表征。数字锚（论文口径）：zero-shot 混合多模态检索 benchmark 平均
R@5 领先全部 baseline 超 9pt；微调后 WebQA R@5 70.8 / R@10 71.0
（超前 SOTA 6pt+）、CIRR R@5 76.1 / Rsub@1 75.7（与专用 CIR 模型打平）、
ReMuQ R@5 96.3（领先 SOTA 5pt+）。

横评金句：VISTA 是「文本 encoder 加视觉插件」，E5-V 是「直接复用 MLLM」；
2025 后两条路线收敛——Qwen3-VL-Embedding 直接基于 VL 底座训 embedding
（见 §6.3），原文点名的 VISTA 短板（损伤原图文能力、需要有图数据）正是
新路线的卖点。**多模态 embedding 不一定要多模态训练数据**——先消
modality gap，文本对就能全部迁移过去，这是 2024 后最重要的范式假说。


## 三、late interaction 派：ColBERT → ColPali → ColQwen

单向量 embedding 把一整段压成 1 个点，词粒度信息全挤掉；late
interaction 派保词粒度（fine-grained），代价是存储多向量、打分做局部
乘加。这一派是多模态文档检索 2024-2026 年最大的变量。

### 3.1 ColBERT（SIGIR 2020）：MaxSim 公式与两个数量级

ColBERT（arXiv 2004.12832）的骨架：query 与文档各自过 BERT 独立编码，
**保留每个 token 的向量（不单向量池化）**，评分用 late interaction /
MaxSim：

```
score(q, d) = Σ_i max_j <E_q(i), E_d(j)>
```

每个 query token 在文档所有 token 向量里找最匹配的，取 max 再求和。
价值主张（摘要口径）：质量对 cross-encoder（每对 query-doc 都要过大网络
算一个分）有竞争力，但**每 query 快 2 个数量级、FLOPs 少 4 个数量级**——
因为文档侧 token 矩阵可以离线预算入库，在线只剩一个轻量交互。

工程化的接力：ColBERTv2（arXiv 2112.01488，NAACL 2022）残差压缩 + 去噪
监督，**空间占用先砍 6-10 倍**，同域/跨域都 SOTA；PLAID / Super-Cluster
等把 late interaction 推到百万—亿级（ColPali 论文直接引用「cluster
centroids 可再省一个数量级」作为可行性背书）。这条压缩线是后面所有
多向量系统的标准动作。

### 3.2 ColPali（ICLR 2025）：把 ColBERT 搬到页面截图上

ColPali（Illuin，arXiv 2407.01449）核心观察写在引言里：「工业文档检索的
瓶颈不是 embedding 模型，而是前面的消化管线」。证据是自家 benchmark 的
均值行——同一条 Unstructured+OCR 管线上 BM25 65.5 与 BGE-M3 66.1 几乎
打平（ViDoRe NDCG@5，论文 Table 2），**换更好的文本 embedding 救不回
解析丢失的版面与图表**。

- **问题设定**：传统 PDF 检索 = parser/OCR → 版面检测 → 切块 →（图表
  captioning）→ 文本 embedding，五个环节错误级联。ColPali 对页面截图
 直接编码，物理上跳过整链。
- **架构**：骨架 = PaliGemma-3B（SigLIP 视觉 encoder + Gemma-2B 语言
  模型，patch embedding 直接进语言模型拿「LLM 语境化」的 patch 表征）
  + 投影层降到 D=128；query 侧送文本 token，图像侧送 patch，两端落在
  同一 128 维空间，无缝套用 ColBERT 的 MaxSim。
- **训练**：127,460 query-page 对 = 63% 公开学术训练集 + 37% 合成
  （web PDF 页面 + Claude-3 Sonnet 生成伪问法）；全英文训练集刻意为之
  验证跨语言 zero-shot；LoRA r=α=32 只挂语言模型层 + 投影层，bf16，
  8 GPU 数据并行，global batch 32，1 epoch；loss 是 MaxSim 的 in-batch
  对比。HF 卡 colpali-v1.2 加了 5 epoch + hard-negatives 缓解非英语塌陷。
- **评测配套**：ViDoRe benchmark 同文发布——页级视觉文档检索基准，跨域/
  跨语言，主指标 NDCG@5；训练与评测严格去重（无同 PDF 入训练集）。

**ViDoRe NDCG@5 阶梯（Table 2 均值，本篇第一数字锚）**：

| 路线 | NDCG@5 |
|---|---|
| Unstructured + OCR + BM25 | 65.5 |
| Unstructured + OCR + BGE-M3（文本管线天花板） | 66.1 |
| Unstructured + Captioning（Claude-3 Sonnet 图说）+ BM25 | 65.1 |
| Jina-CLIP（对比式 VLM 单向量） | 17.7 |
| Nomic-vision | 12.9 |
| SigLIP So400m/14@384（vanilla） | 51.4 |
| BiSigLIP（微调 SigLIP 双塔池化单向量） | 58.6 |
| BiPali（PaliGemma 池化单向量） | 58.8 |
| **ColPali（+ late interaction）** | **81.3** |

读法三条：① 文本管线天花板 66.1，ColPali 81.3 高 +22.5pt；② 单向量派
从 vanilla 51.4 到池化微调 58.8 只涨 7pt 多，**late interaction 一跳
+22.5pt，作者把这一跳归因于 fine-grained 交互本身**；③ 负面结果同样
重要——把 SigLIP 改成 ColBERT 式 late interaction（ColSigLIP）效果
崩盘，因为 SigLIP 预训练只优化池化表征、不优化单个 patch/token 向量。
差距最大的子类是 InfographicVQA / ArxivQA / TabFQuAD——信息图、图表、
法语表格是视觉页主战场。

**预算与延迟账（§5.2 + 附录 B）**：

- 在线 query 编码（NVIDIA L4，bs=1，1000 query 平均）：BGE-M3 15 token
  约 22ms；ColPali query（要过 Gemma 语言模型）约 30ms，只慢 8ms；1000
  页规模的 MaxSim 增量延迟约 1ms/1000 页——**在线侧 late interaction
  几乎白送**，PLAID/Super-Cluster 可到百万级。
- 离线索引（L4，bs=4，平均每页 2.1 chunk）：ColPali 直接对页图编码，
  跳过 parser/OCR/版面检测/chunk/captioning，索引端到端显著快于传统
  管线（论文 Figure 3 口径）。
- 存储：每页 1030 个向量（1024 patch + 少量非图 token）× 128 维 →
  **每页 256KB**（论文原话）；索引体积比 BM25 稀疏索引大一个数量级、
  比 BGE-M3 单向量大两个数量级；centroid/压缩可再省 10 倍左右。

**垂域微调信号（面试加分）**：训练集零法语，TabFQuAD 法语表格仍靠
PaliGemma 里 Gemma 的多语言预训练拿到零样本优势；再往训练集塞 1552 条
法语表格样本，TabFQuAD Recall@1 +6.63%，其他任务仅 +0.34% 无回退
（论文 Figure 4）——证明 late-interaction VDR 可端到端微调到垂域。

### 3.3 ColQwen2.5：动态分辨率与「页不变 token 变」

ColQwen2.5（HF 卡 vidore/colqwen2.5-v0.2）底座换 Qwen2.5-VL-3B-Instruct：
动态分辨率、不再强制 448×448（ColPali 是 448→1024 patch 固定），上界
设 ≤768 image patch；文档向量示例形状 (755, 128)；可配置只保留图像
token，每页再丢 11 个非图向量省存储；训练配方与 ColPali 一致。**答辩
分水岭：ColPali 是固定 patch 预算（分辨率定死、延迟可预测），ColQwen2.5
是动态分辨率更省 token——「页不变 token 变，还是 token 不变页变」两种
工程哲学**。ViDoRe leaderboard 的社区口径：ColPali v1.x 约 80 NDCG 的
时代之后，ColQwen2/2.5 与厂商模型把均值推到 85-90 区间（2025-2026
社区口径，Space 需 JS 渲染未抓取，见第八节）。

## 四、VDR 工程账：截图派 vs OCR+chunk 派

### 4.1 缘起实验 DSE

DSE（Document Screenshot Embedding，arXiv 2406.11251，EMNLP 2024）先把
「文档截图当作统一输入格式、不做任何解析」跑通：自建 Wiki-SS（130 万
Wikipedia 网页截图语料）、query 来自 Natural Questions。数字锚（摘要
口径）：纯文本密集文档场景下 DSE top-1 检索比 BM25 高 17pt；混合模态
（幻灯片）检索 nDCG@10 比 OCR 文本管线高 15pt+。**截图把「字+图+版面」
一次性保住，省掉逐模态抽取**——ColPali 再进一步，把单向量截图换成
late interaction 多向量，81.3 那一跳由此而来。

### 4.2 利弊清单（正反各给数字）

利：

- **属性信息零损失**：表格线、图表配色曲线、字体级别（粗体 = 层级）、
  页眉页脚全在；OCR 丢版面，captioning 靠模型口播且耗钱。
- **管线极短**：一页一进一出，端到端可微调；索引延迟反而比
  OCR+captioning 管线短，错误不级联（无 parser bug 传染）。
- **版面敏感任务拉开差距**：信息图/表格/图表视觉页相对文本管线差
  20-40pt 级（Table 2 子列对比一目了然）。

弊：

- **存储贵两个数量级**：每页 256KB（ColPali 口径），百万页约 0.25TB
  原始多向量，需要 PLAID 式压缩或分层打分（粗排单向量 + late
  interaction 精排）。
- **建仓成本高**：编码侧每页过一次 3B 级 VLM（L4 bs=4 上限），冷启动
  建库的 GPU 预算远高于文本 embedding。
- **纯文本密集场景未必赢**：合同条款精确匹配这类「检索词即答案」的
  场景，ColPali 论文里 AI/Energy/Gov/Health 四大文本类任务上
  BM25/OCR 管线也能到 78-90 档，截图派的优势主要在视觉页。

### 4.3 分辨率与 token 成本账

一个 3B 级 Col-style VDR 模型，每页向量数 = 图像 token 数（+ 若干非图
token）：PaliGemma 448×448 固定 → 1024 patch（28×28 图像网格）→
ColPali 每页 1030 向量；ColQwen2.5 动态分辨率 ≤768 patch → (755, 128)。
MaxSim 打分是 O(Nq × Nd)：query 25 token × doc 1030 patch 约 26K 次
128 维点积每对，L4 上 1000 页约 1ms。**分辨率越高 patch 越多、小字识别
越准，但存储线性涨**——SigLIP 2 的 NaFlex 与 ColQwen 的动态分辨率正是
为「文档页这种长宽比敏感输入」准备的：不拉伸版面，密集小字页给更多
patch，空白页给更少。


## 五、视频与音频 embedding

### 5.1 视频检索先定时间粒度（工程第一问）

粒度三档，按 query 意图选：

1. **整段视频一个向量**：listing 级推荐/素材库检索，成本最低但只能答
   「找哪段视频」；
2. **镜头/滑动窗口切片**：2-10s clip 一粒入库、时间戳写 payload，能答
   「第几分钟」；
3. **抽关键帧走图文模型**：最低成本，丢运动信息与动作语义，适合预算
   敏感的降级档。

时间维怎么进 embedding 也有三条路线：(a) 3D/时空 ViT 把多帧 patch 化
成时空 cube（InternVideo 系），运动线索洗进向量；(b) 帧间聚合（CLIP
per-frame + mean/attention pooling），工程最常见，帧内语义不掉但没有
时序；(c) VideoCLIP 式对齐（arXiv 2109.14084，EMNLP 2021）——时序重叠
的 video-text pair 当正样本、最近邻检索挖 hard negative，一个模型覆盖
检索 / VQA / action localization。**口径提醒：视频检索 R@1 的数字必须
先问 benchmark（MSR-VTT / DiDeMo / LSMDC / ActivityNet）与整段 vs
moment-level，跨口径比分数没意义。**

### 5.2 InternVideo 系（上海 AI Lab）

- InternVideo（arXiv 2212.03191，2022-12）：masked video modeling
  （生成）+ video-language contrastive（判别）两路互补预训练，可只拿
  判别分支当 video-text 检索 encoder。数字锚（摘要口径）：Kinetics-400
  top-1 91.1%、Something-Something V2 77.2%，39 个视频数据集 SOTA。
- InternVideo2（arXiv 2403.15377，ECCV 2024）：6B 级视频 encoder；
  progressive 训练统一 masked 视频建模 + 跨模态对比 + next-token
  prediction；数据侧做时空一致性（语义级视频切分 + video-audio-speech
  caption 对齐）；60+ 视频/音频任务 SOTA，长视频理解与 video dialogue
  居强。（HF 卡抓取 401，数字以摘要口径，见第八节。）

工程话术：视频 embedding 检索 = **先切（镜头检测/等距抽帧窗口）→ 每段
过一次视频 encoder 出单向量 → 单向量 ANN**；要 moment-level 就以 clip
粒度入库并把时间戳写 payload。InternVideo 6B 成本太贵时的标准降级：
SigLIP / Qwen3-VL-Embedding 按 keyframe 抽 1-4 帧平均，牺牲动作语义换
成本——这与 §5.1 的粒度三档是同一件事的两面。

### 5.3 音频 CLAP（LAION，ICASSP 2023）

CLAP（arXiv 2211.06687）= 音频版 CLIP。数据集 LAION-Audio-630K 共
633,526 音频-文本对（多源公开集）；模型 = 音频 encoder（HTSAT 分层
token-semantic audio transformer）+ 文本 encoder 双塔对比；feature
fusion 处理变长音频；**keyword-to-caption 数据增强**是关键工程细节——
用 caption 模型把 Audioset 的类名标签扩成句子，解决「每个样本只有类名
没有 caption」的问题。数字锚（GitHub README，2026-10-12 抓取）：后期
大 ckpt（music_speech_audioset，约 4M 样本、HTSAT-base）zero-shot ESC50
89.98；fusion ckpt 在 ESC50 zero-shot R@1 0.905 / mAP@10 0.9407
（train+test 去重口径）。评测指标口径：检索走 A→T / T→A 双向 mAP@10
（AudioCaps + Clotho 两集合），**不是 MTEB 那套，面试别说混**。工程
用途：音频素材/音效库检索、podcast segment 召回；入库 schema 与视频
相同，modality 字段填 audio，向量字段挂 CLAP 输出。

## 六、工程落库：schema、混合检索、多模态 reranker

### 6.1 库表 schema：一 entity 三条向量赛道

以一次「图文页 + 视频 + 文本块」混库为例，字段设计：

- **基础字段**：doc_id / chunk_or_page_id / modality（text、image、
  page、clip、audio 五枚举）/ parent_doc_uri / time_start 与 time_end
  （视频、音频必须）/ page_no / lang / acl_tags / **原图或原帧 uri**——
  召回后直接给 VLM 看原件，不靠向量反推。
- **向量字段（named vectors，各模态/各策略各一把赛道）**：
  - vec_text：Qwen3-Embedding / BGE-M3（1024 维），存 OCR 文本块；
  - vec_image：SigLIP 2 / CN-CLIP / Qwen3-VL-Embedding（512-4096 维），
    图像或页面截图单向量粗排；
  - vec_multivector：ColQwen2.5 的 (N, 128) 多向量，late interaction
    精排。
- **向量库支持现状**（2026-10 口径）：Qdrant v1.10.0+ 原生 multivector，
  一个 point 存成矩阵 (N,128)、comparator=MAX_SIM，公式即 Σ max 相似
  度，同 point 还可挂其他 named vector 与 payload filter；Milvus 2.4+
  支持一 entity 多向量字段（社区通行口径）。旧库没有多向量字段时的过渡
  方案是把多向量展开存、打分自己在应用层做——正是「ColPali 为什么贵」
  的生态成本那一笔。

打分编排（多模态检索漏斗）：**单向量（vec_image）HNSW 粗排 top-100 →
multivector MaxSim 精排 top-20 → 多模态 reranker 终排 top-5**，文本
BM25 通道并行，末尾 RRF 融合。ColPali 论文给过 1000 页粗排内 MaxSim
只加约 1ms 的数字，但库上万页时仍要 ANN（PLAID 式 centroid 索引）。
这与文本检索五段式（BM25 → 单向量 ANN → reranker → LLM judge）完全
同构——越往漏斗后面走粒度越细、每对距离函数越贵。

### 6.2 与文本 BM25 的混合：按查询意图路由

常见两通道：文本 BM25（对 OCR 文本/标题/正文）+ 视觉向量通道；融合 =
RRF 或带权交叉排序；modality filter 用 payload 前置过滤（「只要 2024
之后的 page」这一类的约束）。ColPali 论文教给我们的分场景判断：
**纯文本密集文档上 BM25 与好 embedding 接近（65.5 vs 66.1 均值），但
「视觉 rich」时 BM25 通道只能召回字符，图表 query 全靠视觉通道**——
所以路由规则按 query 意图写死：query 含「图/表/页/第几页」强制走视觉
通道；术语精确匹配类（合同条款、API 名）强制走 BM25。工程上的双保险：
页面同时存 OCR 文本与截图向量，存储多一份、召回补得住。

### 6.3 多模态 reranker 与 2026 收敛形态

- **jina-reranker-m0**（HF 卡，2025）：底座 Qwen2-VL-2B-Instruct +
  LoRA 微调语言模型 + MLP 打分头，pairwise/listwise ranking loss；2.4B
  参数；上下文 10240 token（query+document）；动态分辨率 56×56 到 4K，
  图像侧最多 768 patch；支持 29+ 语言、Text2Text/Text2Image/Image2Text/
  Image2Image 四种 rerank 方向；License CC BY-NC 4.0——**商用要谈授权**。
- **Qwen3-VL-Reranker**（arXiv 2601.04720，HF 卡 2026 抓取）：2B/8B 两
  档，32K 上下文，query 与 document 可各含任意模态/混合，输出相关性分；
  配套 Qwen3-VL-Embedding 2B/8B（2048/4096 维，MRL 可截 64-4096，30+
  语言，instruction-aware 带来 1-5% 提升）。
- **Qwen3-VL-Embedding 数字锚**（HF 卡 MMEB-V2，78 子集，2026-10 快照）：
  8B 总分 77.9（Image 80.1 / Video 66.1 / VisDoc 83.3），2B 73.4；对比
  Seed-1.6-embedding 76.9、GME-7B 59.1、VLM2Vec 47.7。VisDoc 细分：
  VDRv1 88.2 / VDRv2 69.9 / VisRAG 88.8 / OOD 78.3。

最后一个口径钉子：纯文本 MMTEB 上 Qwen3-VL-Embedding-8B 均值 67.88，
**仍低于 Qwen3-Embedding-8B 的 70.58**——多模态底座用几个文本分换
跨模态统一性，文本主场景继续用纯文本 embedding，这个结论写进面试
答卷能直接挡住「统一底座是不是全面碾压」的追问。reranker 三档成本
梯度收尾：单向量 embedder 最便宜、late interaction Col 系多向量自带
精排居中、VLM cross-encoder reranker（jina m0 / Qwen3-VL-Reranker）
最贵最准——选型本质是预算沿着漏斗分配。


## 六·增、A2 速记：两阶段多模态检索训练

- **#101 两阶段对比预训练 + 证据锚定潜推理 + 交叉条件重建**：
  MMEB-v2 2B **74.8**/9B **78.4**；线上相对 **+2.92%**。
- 面试点：多模态检索的增益不只在 encoder，还在「训练目标是否要求
  证据对齐」；两阶段比单阶段更稳。

## 七、面试口径：六题速答

**Q1【高频】什么时候多模态 embedding 优于「VLM 先 OCR 再文本检索」？**
一句话：文档视觉 rich（图、表、信息图、版面）且离线预算够时。两个数字：
ColPali ViDoRe NDCG@5 平均 81.3 vs 最强 OCR+embedding 管线 66.1（+22.5pt，
且省掉 OCR/版面/切块/captioning 整条消化管线）；DSE 在文本密集场景也
证明截图能 +17pt top-1 过 BM25。反向同样要给：纯文本密集、检索词靠术语
精确（合同条款、API 参考）时 BM25+文本 embedding 够用——ColPali 论文里
同一条 Unstructured+OCR 管线上 BM25 65.5 与 BGE-M3 66.1 几乎打平，别
误答成「BM25 全面打平 embedding」。（§3.2、§4）

**Q2【高频】ColPali 为什么贵？**
三笔账：① 存储——每页约 1030 个 128 维向量 ≈256KB，比单向量（1024 维
约 2-4KB）大两个数量级，百万页约 0.25TB；② 建仓——编码每页过一次 3B
级 VLM（L4 bs=4），MaxSim 每 query 对每 doc 是 O(Nq×Nd) = 25×1030 次
128 维点积，要 PLAID/centroid 压缩才能上百页级；③ 生态——多向量存储
要 Qdrant v1.10+ 这类 MAX_SIM 支持，传统向量库得改造。但要会翻案：
在线 query 编码只慢 8ms（30ms vs 22ms BGE-M3），1000 页粗排内 late
interaction 约 1ms——**检索链路本身不贵，贵在建仓与存储**。（§3.2）

**Q3【中】SigLIP 相对 CLIP 的卖点？**
sigmoid loss 把损失与 batch 大小解耦——100 万 batch 试过发现 32k 已
饱和；同样训练量 SigLiT 4×TPUv4×2 天就能 84.5% ImageNet zero-shot；
SigLIP 2（2025）在此之上加 caption/自蒸馏/在线精选/原生长宽比 NaFlex，
g/16@384 到 85.0%，多语言单模型逼近专门 mSigLIP。工程上再补一刀：它
同时是 PaliGemma 与 ColPali 的视觉骨架，是 late interaction 文档检索
派的地基。（§2.3）

**Q4【中】中文场景怎么选？**
纯中文图文检索 = CN-CLIP（约 200M 中文对，MUGE zero-shot R@1 63.0 vs
R2D2 49.5 vs Wukong 42.7）；视觉文档为核心 = ColPali/ColQwen 系（英语
零样本已有法语迁移证据，垂域微调 1.5K 样本可再涨 6pt 级）；图+文混合
检索 + reranker 全链路 = Qwen3-VL-Embedding/Reranker（30+ 语言自带中文，
VisDoc 83.3 档）。（§2.4、§3.2、§6.3）

**Q5【中】late interaction 与 dense 单向量怎么选？**
预算与库规模决定：单向量 HNSW 成熟便宜；多向量准（ViDoRe 差 +22pt 级）
但占两个数量级存储。工程答案不是二选一而是分层——单向量 ANN 粗排
top-100 → multivector MaxSim 精排 top-20 → VLM reranker 终排 top-5，
三档成本线性递进；ColBERTv2 的残差压缩线与 PLAID/centroid 是把多向量
打到大规模的标准动作（存储先砍 6-10 倍）。（§3.1、§6.1）

**Q6【中】视频检索的时间粒度怎么定？**
看 query 意图：「找哪段视频」用整段单向量；「找第几分钟」先镜头检测切
clip、每 clip 带时间戳入库，用视频 encoder（InternVideo 系 6B）；要便宜
就 keyframe 抽帧走图文 embedding，丢动作语义。InternVideo Kinetics-400
91.1 / SSv2 77.2 说明基座已把「动作判断」benchmark 吃透，文搜视频靠
时序重叠正对的对比预训练（VideoCLIP 式）。（§5）

## 八、口径与未核实说明

- R2D2 原论文：arXiv 搜索 429 / Semantic Scholar 抓取失败，降级为
  「CN-CLIP HF 卡对照表 baseline 行」，不引其原论文独立数字。
- ViDoRe leaderboard 现值：HF Space 需 JS 渲染只抓到占位，正文只给
  「85-90 区间」社区口径；面试以 Space 现场为准。
- InternVideo2 的 OpenGVLab HF 卡：401 Unauthorized 未取，数字只引
  arXiv 摘要口径；CLAP 数字以 GitHub README 当日抓取为准。
- E5-V 论文 Table 1 中 image retrieval 列方向定义 = 文搜图（query 文本、
  候选图片），引述时已写明方向；ColPali 的 BM25/BGE-M3 打平行是
  Unstructured+OCR 管线均值（65.5/66.1），勿外推成全场景打平。
- 「滞后梯队成本」「百万页 0.25TB」等由 256KB/页口径直接换算；「长尾
  视频/音频 embedding serving 成本模型仍稀缺」属趋势判断、非引用。
- 趋势判断（可放结尾自由发挥）：2024→2026 三次范式切换——纯文本双塔
  → MLLM 一通化 embedding（E5-V「文本对就够」假说）→ 底座厂自带
  embedding/reranker 全链路（Qwen3-VL 系）；late interaction vs dense
  的分野本质是信息论选择——「位密压缩、采样召回」vs「词粒度冗余、按需
  交互」，工程答案永远是分层漏斗；VDR 拐点有真实经济含义，一条
  OCR/layout/captioning 管线的维护成本 + 级联错误，在 ColPali 论文里被
  数值化为 22pt NDCG 差距加更慢建仓，这是企业知识库从文本 RAG 切到
  截图 RAG 的硬论据——但精确条款匹配仍应由 BM25 通道承担。

## 串联阅读

- [embedding与向量索引工程](./embedding与向量索引工程.md)：文本 embedding
  格局（Qwen3-Embedding 三档）、HNSW/IVF/DiskANN、全库重建账——本篇
  的 vec_text 赛道与索引底座都在那篇。
- [检索与混合召回](./检索与混合召回.md)：BM25/RRF/垂域三板斧——本篇的
  双通道融合与意图路由建立在那篇的混合召回框架上。
- [graphrag专题](./graphrag专题.md)：文档结构化的另一条路（图与摘要），
  与截图派「不解析」路线互为对照。
- [多模态推理专题](../inference/多模态推理专题.md)：多模态 token 化成本
  与 serving 侧四级缓存——本篇的 embedding 成本账延伸到生成侧看这篇。
- [幻觉与事实性](./幻觉与事实性.md)：召回喂给生成后的最后一公里，视觉
  页检索强了还要防 VLM 读图幻觉。
