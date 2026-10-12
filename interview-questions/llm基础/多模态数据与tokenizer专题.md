# 多模态数据与 tokenizer 专题：BPE 谱系、视觉两派与数据阶梯

> **面向**：已读过 [多模态架构基础](./多模态架构基础.md)（VLM 三流派、
> M-RoPE、图像 token 占位）与 [数据工程专题](../数据工程专题.md)（文本
> 数据清洗五件套）的读者。那两篇只讲到「图像 token 占位」与「文本数据」
> 为止，本篇往下补一层——**tokenizer 本体**与**多模态数据工程**，不重复
> 模型结构设计（三流派、训练三段式、EPD 分离在另外几篇）。
>
> **读完获得**：① 文本 tokenizer 四代谱系（BPE → SentencePiece → BBPE →
> tiktoken）的演化逻辑与 **12 个模型词表对照表**（2026-10 实测口径）；
> ② 中文 fertility 的对比口径与「fertility → 上下文 → KV → 账单」的
> 成本链；③ 视觉 token 两派（VQ 离散 vs CLIP/SigLIP 连续）的哲理分歧
> 与 2026 统一化动向（TiTok、Cosmos）；④ 多模态数据三梯队（LAION /
> DataComp → 交错 MINT-1T → 视频与 OCR）与 recaption、合成占比数字；
> ⑤ 词表 × embedding 参数账、多模态 token 数公式这两条面试必考算术
> 的完整答法。
>
> **时效口径**：素材时间轴从 1994 年 Gage 的 BPE 压缩算法到 **2026-10
> 实测的 HuggingFace config**；论文数字按 arXiv 原文口径括注年份，社区
> 实测与工程估算一律标明，未核实项见文末「口径与未核实说明」。

## 一、直觉主线：token 是模型世界的「汇率」

先给三句直觉，整篇都是这三句的展开：

1. **文本 tokenizer 是一台压缩器**。它把无尽的字节流切成有限词表里的
   编号——词表越大，常见词整块编码、密文越短；但查「字典」（embedding
   表 + lm_head）的成本跟着词表涨。所有 tokenizer 设计都是在
   「压缩率」和「词表尺寸」之间找甜点。
2. **图像没有天然的「字」**，所以视觉 token 化分裂成两派：一派把像素
   硬压成离散编号进词表（VQ 系，图像从此可以和文本混编进同一个
   transformer）；一派不编号，直接保留连续向量投影进 LLM（CLIP 系，
   语义保真但生成要另接通路）。选哪派 = 选「生成优先」还是「理解优先」。
3. **多模态数据比文本数据贵一个量级**，所以这条线的全部工程都是为了
   一个 KPI——**每个 token 的信息量**：配对过滤、caption 重写、交错
   去重，都是在给 token 提纯。

抓住这三句，下面四节就是把它们变成可以背给面试官听的谱系与账本。

<div class="diagram-embed">
<iframe src="assets/diagrams/multimodal-tokenizer-lineage.html" width="100%" height="940" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/multimodal-tokenizer-lineage.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、文本 tokenizer 谱系：四代人解决同一个问题

### 2.1 BPE（1994 → 2015）：从压缩算法借来的贪心

BPE（Byte Pair Encoding）原本是 Gage 1994 年发表的数据压缩算法；
2015 年 Sennrich 等人把它引入神经机器翻译做子词分词（ACL 2016 发表），
GPT 系随即沿用。机制一句话：

- 从字符级词表出发，统计语料里相邻符号对的频次；
- 每轮把最高频的一对合并成新符号入表，直到词表达到预算 V；
- 训练产物 = 词表 + 一份**有序 merge 规则表**；编码时按 merge 序号
  贪心切分。

直觉也很直白：**高频组合整体化，低频组合碎片化**——「the」会被练成
一个 token，「quantization」只好拆成 qu/anti/zation 一块块。词表预算
V 就是这个「整体化」的程度旋钮。

### 2.2 SentencePiece 与 unigram（2018）：把空格也变成数据

Google 的 SentencePiece（Kudo 与 Richardson，EMNLP 2018）有两个一起
赢下口碑的创新：

- **不做预分词**：直接在 Unicode 字符序列上训练，空格被编码为特殊
  符号 `▁`，分词结果**可逆无损**——空格信息保留在 token 里。这让它
  天然适合中日韩这类没有空格分词的语言，Llama-1/2、T5、GLM-130B
  时代都用它。
- **unigram LM 算法**：与 BPE 反向操作——先准备超大词表，再用 EM
  逐个删掉「删掉后语料似然下降最小」的 token。好处是同一字符串可以
  保留多种切分（subword regularization，Kudo 2018 提出的随机切分
  即正则化），T5/mT5 用它抗噪声。

### 2.3 Byte-level BPE（GPT-2，2019）：零 OOV 的 256 进制世界

GPT-2（OpenAI，2019）把 BPE 的基础符号从 Unicode 字符换成 **256 个
byte**：任何语言的任何字符（含 emoji、控制字符）都能编码，**OOV 概念
消失**。代价立刻显现：一个 UTF-8 汉字占 3 个 byte，没进词表的汉字会被
拆成 byte 级碎片——**零 OOV 的单子，由非拉丁语言的 fertility 来买**。

编号账背一下：GPT-2 词表 **50,257 = 256 bytes + 50,000 merges + 1 个
`<|endoftext|>`（GPT-2 开源代码，2019）**。

### 2.4 tiktoken 与词表军备赛（2022 → 2024）

OpenAI 的 tiktoken（2022 开源，Rust 实现）把 BBPE 做成工业标准件：

- GPT-3.5 / GPT-4 用 cl100k_base，词表 100,256；
- GPT-4o（2024-05）升级 o200k_base，词表约 **200,019（OpenAI 博客，
  2024-05）**——官方口径非英语压缩显著提升：印地语 2.9×、泰卢固语
  3.5×、约 **1.4× 的中文压缩提升（GPT-4o 发布博客，2024-05）**，日韩
  语 1.4~1.7×。
- 通用参照：**英文每 token 约 4 字符、约 0.75 词（OpenAI tiktoken
  文档，2022）**。

同期 HuggingFace 开源了 Rust 写的 tokenizers 库（2020），Llama-3 的
tokenizer 实际就是 tiktoken BPE 加载格式 + HF tokenizer.json 序列化。
词表军备赛至此定形：**2023 年 32K 是主流，2024 年 128K-151K 是主流，
2025 年头部模型已经摸到 163K**。

### 2.5 主流模型词表对照表（2026-10 一手核实）

| 模型 | 词表大小 | tokenizer 类型 | 口径来源 |
|---|---:|---|---|
| GPT-2（2019） | 50,257 | byte-level BPE | OpenAI 开源 |
| GPT-3.5 / GPT-4（2022-23） | 100,256 | cl100k_base BBPE | tiktoken 文档 |
| GPT-4o（2024-05） | ≈200,019 | o200k_base BBPE | OpenAI 博客 |
| Llama-1/2（2023） | 32,000 | SentencePiece BPE | Meta 论文 |
| Llama-3 系（2024） | 128,256 | BBPE（tiktoken 格式） | HF tokenizer config |
| Mistral 7B（2023-09） | 32,000 | SentencePiece | 开源模型卡 |
| Qwen2.5 / Qwen3（2024-25） | 151,936 | BBPE 扩 cl100k | HF config 实测 |
| GLM-4 / GLM-4.5（2024-25） | 151,552 | BBPE 多语言扩容 | HF config 实测 |
| DeepSeek-V3（2024-12） | 129,280 | BBPE 含中文扩充 | HF config |
| Kimi K2（2025-07） | 163,840 | BBPE 自训练 | HF config 实测 |
| InternLM2（2024-01） | 92,544 | BBPE | HF config |
| Gemma / Gemma3（2024-25） | 256,000 / 262,208 | SP unigram 超大词表 | Google config |

对照要点三条，全部有出处：

- **对齐账**：Qwen 实际词表 151,643，pad 到 151,936（凑 128 的倍数提
  kernel 效率）；Kimi K2 扩到 163,840 恰好是 160K 对齐。词表 pad 是
  工程常态，别在面试里说「词表必须是 2 的幂」。
- **中文策略**：Qwen/GLM/DeepSeek 词表里编入大量完整汉字与常用双字词，
  单汉字约 1 token；Llama-3 只编入高频中文 bigram，生僻字仍按 byte
  拆断。这是国产与海外 tokenizer 的一阶差异。
- **军备赛的另类**：Gemma 的 256K 词表是「超大词表换激进压缩」的极端
  案例，配 tie embeddings 才压得住参数账（见第五节 Q1）。

### 2.6 tokenizer-free 动向：词表会消失吗

2025-26 年值得盯的信号线：ByT5（Google，2022，直接在 UTF-8 bytes 上
训练，鲁棒但序列长 3-4 倍）→ MEGABYTE（Meta，2023-06，多尺度 patch）→
MambaByte（2024）→ **BLT（Byte Latent Transformer，Meta，2024-12）**：
首个 FLOP-controlled 的 byte 级实验，到 **8B 参数 × 4T bytes（BLT
arXiv:2412.09871，2024-12）**；核心创新是按下一字节的熵动态切
patch——难预测区域短 patch 高密度计算、好预测区域长 patch 省算力，
官方声称同等推理成本下 scaling 比 tokenizer 模型更平滑。H-Net
（Cartesia，2025-07）再做分层动态 chunking。

2026-10 时点的判断：**私有部署的主线模型全线仍是 BBPE/SentencePiece
（Qwen3、GLM-4.5、K2、Gemma3、DeepSeek-V3.2 皆然，2026-10）**，byte
级属于「路线成熟但未主导」，「词表消失」是 2026-2027 值得追、但还没
改天换地的信号（面试被问到就按这句话答）。

### 2.7 中文 fertility：tokenizer 选型是一阶决策变量

fertility = 平均每个词/字切出多少 token，越低越省。中文没有天然分词
边界，按「token/字」计。社区多篇 2023-2025 对照测试的均值量级：

| tokenizer | 中文 fertility（token/字量级） | 口径 |
|---|---|---|
| Llama-2（32K SP） | 常用字 1~1.5，生僻字 2~3（byte 回退） | 社区实测 2023-25 |
| Llama-3（128K BBPE） | 约 0.9~1.0（简单文本） | 社区实测 |
| Qwen2.5 / GLM-4（151K） | 约 0.55~0.7（双字词入表） | 社区实测 |
| o200k vs cl100k | 中文省约 30%~40%，官方 1.4× 口径 | OpenAI 2024-05 |

把成本链串起来：fertility 高 → 同样一篇中文文档占更多 token → 有效
上下文「变短」、KV cache 成本升、API 按 token 计费时**中文任务账单
直接差 30%~50%（按上表数字推算的工程量级）**。所以做中文产品选型
「国产闭源 vs Llama 开源」时，**输出侧便宜的钱可能先被 tokenizer
吃回去**——fertility 是一阶决策变量，不是学术细节。

## 三、多模态 tokenizer 两派：离散 VQ vs 连续特征

图像/视频/音频不存在「字典」，视觉 token 化分裂成两派，分歧的本质是
**要不要把连续特征量化成离散编号**。

### 3.1 派 A：VQ 离散 codebook（生成向）

谱系一环扣一环：

1. **VQ-VAE**（van den Oord 与 Vinyals，DeepMind，2017）：编码器输出
   在 codebook（K=512）里查最近邻替换为离散码，解码器重建；下游
   PixelCNN 把离散码当「图像 token」做自回归。
2. **VQGAN**（Esser 等，CVPR 2021）+ Taming Transformers：VQ-VAE 加
   感知损失与对抗损失，codebook K=1024、f=16 下采样，Stable
   Diffusion 1.x 时代的经典底座。
3. **dVAE（DALL-E，OpenAI，2021）**：codebook K=8192，256×256 图 →
   32×32 = **1024 token（DALL-E，2021）**，首次大规模「图像=token」实践。
4. 中间代：RQ-VAE（残差量化，2022）、ViT-VQGAN（2022）、MagViT /
   MagViT-v2（Google，2023 / 2024，视频 3D causal VQ，v2 的 codebook
   达 2^18=262K，是视频 tokenizer 先声）。
5. **Chameleon（Meta，2024-05）**：早融合 token-based 多模态样板——
   image tokenizer 为 VQ（K=8192），512×512 → 1024 token；文本 BPE
   词表与图像 codebook **合并成 65,536 + 8,192 的统一词表（Chameleon
   arXiv:2405.09818，2024-05）**，4.4T tokens 预训练。生成侧不需要
   diffusion，但保真度低于扩散模型。
6. **Emu3（BAAI，2024-09）**：图像/文本/视频统一 codebook
   **K=32,768（Emu3 arXiv:2409.18869，2024-09）**，单个 transformer 纯
   next-token 训练，视频生成就是预测下一帧的 token 序列。Emu3 是
   「统一理解+生成单 transformer」阵营最常被引用的工作；同阵营还有
   Show-o（2024-08）、Janus-Pro（DeepSeek，2025-01）、Bagel（ByteDance，
   2025-05）。

离散派的收益与代价同源：**进了词表就能自回归**（文本工具箱全可复用，
图像生成=续写 token），但 codebook 容量有限、量化必损信息——重建损失
与语义保真之间的 tension 是 2024-25 年的主战场。

### 3.2 派 B：连续特征编码（理解向）

另一派拒绝量化，把视觉编码器的连续输出直接送给 LLM：

1. **CLIP**（OpenAI，2021-02）：4 亿图文对对比学习，ViT-B/32 在
   ImageNet zero-shot **76.2%（CLIP，2021）**；图像端输出连续特征，
   无量化，成为整个理解系的「视觉底座」。
2. **SigLIP**（Google，2023-09）：把 softmax InfoNCE 换成 sigmoid 二元
   logistic loss，去全局归一化、小 batch 可稳定训练；SigLIP-SO400M
   （0.4B）是 2024-25 业界视觉 encoder 事实标配——LLaVA-NeXT、
   InternVL2、PaliGemma、Gemma-3 都基于它或其变体。**SigLIP2
   （Google，2025-02）**加 caption 目标、LocCa 定位与 NaFlex 原生多
   分辨率，多语言与文档/OCR 更强。
3. **LLaVA-1.5（2023-10）**：ViT-L/14（CLIP）→ MLP projector，336×336
   图按 14px patch 切成 24×24 = **每图 576 个视觉 token（LLaVA-1.5，
   2023-10）**——「576」是面试常问数。
4. **InternVL（2023-12 / InternVL2 2024-07）**：InternViT-6B 加
   pixel shuffle 1/4 下采样，448×448 图 → 约 256 token。
5. **Qwen2-VL（2024-08）/ Qwen2.5-VL（2025-01）**：Naive Dynamic
   Resolution——按原生分辨率任意切 patch（14px patch、2×2 merge，
   即每 28×28 像素 1 个 token），token 数随分辨率线性变化；配
   M-RoPE 把位置拆成 t/h/w 三组（细节见
   [多模态架构基础](./多模态架构基础.md)）；Video 侧 dynamic FPS
   采样。Qwen2.5-VL 的 ViT 是 675M，RMSNorm+SwiGLU 与 LLM 架构对齐。

连续派的软肋：**特征连续就无法直接驱动生成**——要出图就得另接
VQ/VAE + diffusion 头，于是有了 Janus、Show-o 这类 hybrid 路线。

### 3.3 2026 统一化动向：TiTok 与 Cosmos

两派之外，2024 起另一条暗线是把视觉 token **压到极小、压到统一**：

- **TiTok（ByteDance，2024-06；CVPR 2025）**：1D tokenization，
  256×256 图只切成 **32 个离散 token（TiTok arXiv:2406.07550，
  2024-06）**，codebook K=4,096；ImageNet 256 上 gFID **1.97 vs
  MaskGIT 6.18（TiTok, CVPR 2025）**，512×512 上 gFID 2.13 优于
  DiT-XL/2 的 3.04 且 token 少 64 倍 → 生成快 **410×（512×512
  口径，TiTok, CVPR 2025）**。它是「1D 超紧凑 image tokenizer」标杆，
  直接证明 token 数比大家以为的少两个数量级也够用。
- **Cosmos Tokenizer（NVIDIA，2025-01）**：视频 causal 3D tokenizer，
  同时支持 continuous 与 discrete 两种模式，时间×空间压缩率覆盖
  4×8×8 到 **8×16×16 = 总压缩 2048 倍（Cosmos arXiv:2501.03575，
  2025-01）**，是物理世界模型（WFM）的底座件。
- 工业侧：Qwen3-Omni（2025-09）、GPT-4o 已把 image/audio tokenizer
  并进统一模型；2025-26 的趋势判断是——**理解侧 SigLIP2 连续特征
  继续主导，生成侧向「连续 encoder + 轻量 VQ 或 flow-matching
  解码」hybrid 收敛**，统一理解+生成的单一模型已被 Bagel/Janus-Pro/
  Emu3 验证可行，但保真度仍不及专用扩散。

### 3.4 两派对照表

| 维度 | VQ 离散派 | CLIP/SigLIP 连续派 |
|---|---|---|
| 信息状态 | 量化有损（256² 图压到 32/64/1024 token） | 近似无损，语义上游强 |
| 生成能力 | 原生可自回归出图（Chameleon/Emu3） | 需外挂 VQ/diffusion 通路 |
| 理解任务 | 受 codebook 容量封顶 | 理解任务 SOTA |
| 代表工作 | VQ-VAE→VQGAN→Chameleon→Emu3→TiTok | CLIP→SigLIP/2→LLaVA/InternVL/Qwen-VL |
| 面试定性 | 「图像进了词典」 | 「图像只是换了空间的向量」 |

追问接法：被问「两派谁赢」——理解走连续（SigLIP 系占住 VLM 底座），
生成走离散或 hybrid（TiTok/Cosmos 把 token 数打下来之后，hybrid 的
生成成本才真正可接受）；一句话定性——**这一年没有单一赢家，赢家
是按任务选派的人（2026）**。

## 四、多模态数据工程：配对、交错、视频、OCR

### 4.1 图文对：LAION 定过滤范式，DataComp 定评测范式

- **LAION-400M**（2021）：4 亿英文图文对，CLIP score > 0.28 阈值过滤，
  SD1.x 时代训练基底。
- **LAION-5B**（arXiv:2210.08402，2022-08）：从 Common Crawl 约 50B
  原始样本过滤到 **5.85B CLIP-filtered 图文对（LAION-5B，2022）**，
  其中 2.32B 英文、2.26B 其他语言；LAION-Aesthetics v2 子集约 600M。
  工程三件套全是后来者的参照：CLIP NSFW 分类器去毒、pHash 感知哈希
  近似去重、cosine 0.28 过滤阈值。
- **DataComp**（NeurIPS 2023 D&B，arXiv:2304.14108）：把「过滤策略」
  本身做成了 benchmark——12.8B Common Crawl 候选池，算力档位跨
  50 GPU-day 到 180K GPU-hour 共 4 个量级，38 个下游测试集；胜出策略
  是 image-based / CLIP score / text complexity 的**组合过滤**而非单
  阈值。头名数据训出的 CLIP ViT-L/14 拿到 **79.2% ImageNet
  zero-shot（DataComp-1B，2023）**，反超 OpenAI 同成本模型的 75.5% 约
  3.7 个点——「模型不动、数据当超参」就是从这个数字来的。
- 后续线：SuperClass、Re-LAION-5B（2024，法律合规清理版）进入法规
  驱动的清洗赛道；而 **Pixmo 是反其道行之的另类（AI2，2024-09）**——
  31.3 万条人工手写高密度 caption，强调不依赖 GPT-4V 合成以保证开源
  合规。

### 4.2 caption 重写：短噪声描述 → 高密度描述

原始网页 alt-text 又短又脏，caption 重写把图文对的「每个 token 信息
量」往上提了一个档次：

- **LLaVA**（2023-04）：用 GPT-4 造 158K 视觉指令对（详描述/问答/
  复杂推理三类），开了「强模型造数据」的先河。
- **ShareGPT4V**（arXiv:2311.12793，2023-11）：先用 GPT-4-Vision 产
  10 万条高密度 caption 当「SFT 金标准」，再用这 10 万微调出
  ShareCaptioner，规模化产出 **120 万条新 caption（ShareGPT4V，
  2023-11）**；SFT 等数量替换旧 caption 后，LLaVA-7B 的 MME 上涨
  **+222.8 分（ShareGPT4V，2023-11）**。
- 规模化 recaption：CapsFusion 用 LLaMA-2 重整 1.2 亿条（2023）；
  PixelProse 用 Gemini-1.0 重写 1700 万张图（2024），配敏感词与
  NSFW/PII 清洗。
- 2025-26 格局：闭源 captioner（GPT-4o → GPT-4.1）与开源 captioner
  （Qwen2-VL-72B、InternVL-78B、Molmo-72B）双轨并行；Pixmo 的口径
  显示人工 caption 质量略高，但行业结论是 **「人工种子 + 合成放量」
  的混合配比（2025-26 社区共识）**——这就是 ShareGPT4V 路线的
  标准化。

### 4.3 交错数据：MMC4 → OBELICS → MINT-1T 的规模接力

图文对之外，网页原生的图文交错（interleaved）是另一铁矿，规模接力
非常整齐：

| 数据集 | 时间 | 规模口径 | 用途 |
|---|---|---|---|
| MMC4 | 2023（arXiv:2306.06963） | 101.2M 文档 / 103B tokens / 571M 图 | Flamingo 系训练 |
| OBELICS | 2023-06（arXiv:2306.16527） | 141M 网页 → 115B text tokens + 353M 图 | IDEFICS 9B/80B |
| MINT-1T | 2024-06（arXiv:2406.11271） | **1T 文本 tokens + 3.4B 图（=10× OBELICS）** | 开源最大交错集 |

MINT-1T 新增 PDF 与 arXiv 来源，实验证明训出的模型与 OBELICS 系同
水平，但把 engineering detail 全公开（mlfoundations/MINT-1T）。清洗
流水线口径：URL blocklist → HTML 抽取 → 语言检测 → 质量过滤（重复
n-gram、图片密度、图文距离）→ 图 URL 哈希去重 → NSFW 过滤。

**面试点**：交错数据的 token 位置必须贴合原始 HTML 的图文位置（图像
token 插回原文出现处），训练时用 `<image>` 占位符——这和「同窗口内
多模态 token 占比」都是面试官爱顺藤摸瓜的点。

### 4.4 视频数据：时长、帧率、分辨率的三维配平

- HowTo100M（2019）：122 万教学视频 → 1.36 亿 clip-caption，ASR 转
  写当 caption，证明「噪声弱标注也能规模化」。
- WebVid-10M（2021）：1070 万短视频对，HD 分辨率。
- InternVid（2023）：700 万视频 → 2.34 亿 clip-caption（16M 开放）。 
- **Panda-70M**（Snap，2024）：7080 万 1080p caption 动图对，text-
  to-video 头部预训练段位。
- 中文侧：Youku-mPLUG10M（2023）提供 1000 万中文短视频对。

工程口径：Sora 技术报告（2024-02）的「train at native aspect ratio
and duration」是行业共识——时长从 2s 到 60s 分层配比、fps 1~8 动态
采样；Qwen2.5-VL 用 dynamic FPS 1~2，**10 分钟视频按 4000~15000 个
visual token 计（Qwen2.5-VL 文档口径）**。视频 token 成本账详见
[长视频推理工程专题](../inference/长视频推理工程专题.md)。

### 4.5 OCR 与文档数据：最贵的数据、最省钱的配方

- 评测锚点：DocVQA（2021，5 万 QA）、TextVQA（2021，4.5 万题）、
  OCR-VQA（2019，100 万 QA）——面试报这三个数即可。
- 预训练数据：Nougat（Meta，2023-08）用 arXiv 论文 + LaTeX 源码对，
  800 万+ 页；mPLUG-DocOwl（2023-07）的 UReader 把教学文档统一成
  像素级格式，千万量级。
- **olmOCR**（AI2，arXiv:2502.18443，2025-02）：开源 PDF OCR 管线，
  先用真 GPT-4o-mini 做锚定对齐、再自训 7B 模型批量推理，**官方口径
  处理 100 万页 PDF 成本约 190 美元（olmOCR/AI2 博客，2025-02）**——
  「190 美元/百万页」是这条线最常被点名的成本数字。
- 2025-26 趋势：屏幕截图（GUI agent 数据）、手写公式、数学图表、
  document grounding（bbox/表格单元格标注）成为增量主战场；
  PaddleOCR-VL（2025-09）公开了 109 语言的 OCR 数据卡。

### 4.6 清洗、去毒与去重的数字口径

- **CLIP score 阈值**：LAION-400M/5B 用 0.28（CLIP 论文同款）；DataComp
  的结论是组合过滤优于任何单阈值。
- **图像去重**：pHash 感知哈希近似去重是 LAION/OBELICS/MINT-1T 通用
  件；语义级近重复检测用 SSCD（Pizzi 等，NeurIPS 2022，Meta 的 copy
  detection 标杆）；SemDeDup（2023-11）用语义 dedup 省下约
  **50% 存储且性能不跌（SemDeDup，2023-11）**。
- **去毒**：CLIP NSFW 分类器 + 域名黑名单（GCD blacklist）；LAION
  附件口径 NSFW 阈值 0.8 后召回保守在 10-30% 量级。
- 多模态 dedup 的独有难点在**图像跨页面复用**（同一张图出现在几十个
  网页），文本侧的 MinHash LSH 5-gram（RefinedWeb 系）管不了这个。

### 4.7 合成数据占比：2026 时点的经验区间

公开报告口径接力：DeepSeek-V3 的 14.8T tokens 中含多轮对话与推理
合成数据；**GLM-4.5 的 23T tokens 中约 7T 是代码/推理定向合成
（GLM-4.5 arXiv:2508.06471，2025-08）**；Kimi K2 官方博客点明大规模
agentic tool-use synthesis（2025-07）；Qwen3 的 36T 含合成数学与代码；
NVIDIA Nemotron 4 340B（2024-06）指令数据 **98% 以上为合成
（Nemotron 4，2024-06）**。

经验共识（2026 时点社区口径）：**头部预训练后段约 10%~30% 是合成
数据，SFT 段 50%+ 是合成**，且合成数据质量由教师模型能力封顶——
Shumailov 等人在 Nature（2024）的 model collapse 警告「递归训练
合成数据误差指数累积」，是面试官反将一军的常备弹药：占比要报区间，
并补一句「靠人写种子数据 + 多样性约束来防坍缩」。

## 五、面试题：词表账、fertility 与 token 数公式三连

**Q1【高】词表做大，为什么压缩率升但 embedding 变贵？怎么权衡？**

顺着两笔账讲。收益账：V 越大，merge 表容纳越长的高频子串，平均
token 长度变长，同一语料切出的 token 总数下降（fertility 降低），
训练和推理序列成本都省。成本账两笔：

- **参数账**：embedding 矩阵 V × d，lm_head 又一份 V × d（不 tie
  时）。代 d=4096：Llama-2 的 32K 词表 embedding 约 **1.31 亿参数
  （Llama-2, 2023）**，Llama-3 的 128K 词表涨到 **5.25 亿、两份共
  10.5 亿参数（Llama-3, 2024）**——对一个 8B 模型就是 **13% 的参数
  占比（按 8B 推算）**；1-3B 小模型上 128K 词表能挤占 30%+，这就是
  Gemma-2-2B 用 256K 词表时 tie_word_embeddings 的原因。
- **计算与显存账**：最后一层 logits 计算是 O(L×d×V)，softmax 物化出
  batch×L×V 的 fp32 张量，长上下文大 batch 时词表维成为显存大头；
  Megatron-LM 这类框架专门为 lm_head 做 vocab parallel。

缓解与反转：tie embeddings（小模型标配）、词表 pad 到 2 的幂倍数
（Qwen 151,643 → 151,936）、z-loss 稳大词表训练；且 V 不是越大越优，
**Scaling Laws with Vocabulary（arXiv:2403.04705，2024-03）**指出
最优词表随 compute 增长而非单调——结尾抛这句，追问就稳了。

**Q2【高】你负责的中文 RAG 产品，怎么评估 tokenizer 影响？**

答法：先换口径——别问「哪个 tokenizer 好」，问「同一篇中文语料的
fertility 差多少」。给数字：Llama-2 约 1.5~2.7 token/字（未入表字
byte 回退拆 2~3 个），Llama-3 约 0.9，**Qwen2.5/GLM-4 约 0.55~0.7
token/字（社区实测，2023-25）**；o200k 比 cl100k 中文省 30%~40%。
再接成本链：fertility 差 30% 意味着同样窗口装的中文内容少 30%、
同样检索结果进 prompt 的 token 账单多 30%~50%——在「国产词表 vs
Llama 词表」的选型里这是和单价同权重的变量。最后给极端样本：生僻字、
「口口口」、emoji、数学 LaTeX 在 byte 回退下的 token 爆炸，评测时
要用业务语料实测而不是抄榜单。

**Q3【高】给一张 1024×1024 的图、一段 1 分钟视频，进 LLM 分别是
多少 token？**

口诀先给：**先定「编码器 + 下采样倍率 + merge 策略」三要素，再代公式；
视频在此之上乘 fps × 秒数**。逐派代入：

- 固定网格派：tokens = (H/p)×(W/p)+1。LLaVA-1.5：336/14=24 →
  **576 token/图（LLaVA-1.5, 2023）**；InternVL：448/14=32 → 1024，
  再 pixel shuffle 1/4 → 256。
- 动态分辨率派（Qwen2-VL 系）：14px patch 加 2×2 merge，即每
  28×28 像素 1 token——448×448 → 256；**1024×1024 约 1330 token
  （Qwen2-VL 口径，2024）**，实际受 min/max pixel 预算钳制（默认
  单图 4~16384 token）。视频按帧展开：1 分钟 @2fps × 256 token/帧
  ≈ **3 万个 visual token（按 Qwen2-VL 口径推算）**。
- 固定压缩派：BLIP-2 Q-Former 恒 32、Flamingo Perceiver Resampler
  恒 64，与分辨率无关。
- 离散 VQ 派（生成侧）：Chameleon 512² → 1024；TiTok 恒 32。
- 音频按时间：Qwen2-Audio 编码 25Hz、Whisper 风格 50Hz；Gemini
  文档口径图片约 258 token，**视频 1 fps × 约 300 token/帧、1 小时
  视频 ≈ 100 万 token（Gemini 公开文档口径）**。

**Q4【中高】「统一理解+生成」单模型难在哪，2026 到哪一步了？**

难在 token 性质冲突：理解要语义连续（CLIP 特征最好无量化），生成要
离散可自回归（VQ codebook 才有「下一个 token」可预测）。Chameleon
与 **Emu3（K=32,768 统一 codebook，2024-09）**验证了统一词表 +
纯 next-token 可行，Bagel/Janus-Pro（2025）把 hybrid 跑通，但保真度
仍不及专用扩散；TiTok 把图像 token 压到 32 个后，`理解侧连续、
生成侧超紧凑离散` 的 hybrid 收敛成为 2025-26 主流判断。一句话定性：
**不是结构创新不够，是 codebook 容量与语义保真的物理 tension**。

**Q5【中】从 LAION 到 DataComp，数据过滤策略演进的主线是什么？**

LAION 定的是「单阈值过滤」范式（CLIP score 0.28、pHash 去重、NSFW
分类器三件套）；DataComp 把过滤策略本身 benchmark 化——同一 12.8B
候选池、同一训练配方、49 种过滤策略打擂台，结论是**组合过滤（image-
based + CLIP score + text complexity）显著优于任何单阈（DataComp,
2023）**，最好子集训出的 ViT-L/14 反超 OpenAI 同成本 3.7 个点。
主线一句话：数据策略从「工程经验」变成「可评测、可复现的超参数」。
文本侧同思路由 DCLM 接管（见 [数据工程专题](../数据工程专题.md)）。

**Q6【中】recaption 为什么有效？人工 caption 还有必要吗？**

原始 alt-text 短、噪声大、图不对文是常态；GPT-4V 类强模型产的高密度
caption 把每个 token 的信息量直接抬档——ShareGPT4V 用 **10 万条
GPT-4V 金标准蒸馏出 captioner 放 120 万条（2023-11）**，MME 涨 222.8
分证明「caption 质量 > caption 数量」。人工 caption（Pixmo 31.3 万条，
2024-09）质量略高且保证合规，但成本不可规模化，2025-26 的收敛方案是
**人工种子数据微调开源 captioner + 合成放量**，并挂敏感词/PII/NSFW
清洗管线。

**Q7【中】byte-level / tokenizer-free 会取代 BPE 吗？**

短期不会。论据三条：① 2026-10 主流私有模型全线 BBPE/SentencePiece，
生态（训练框架 vocab parallel、tokenizer 缓存、评测口径）全部长在这
个地基上；② BLT（Meta，2024-12）虽然把 byte 级推到 **8B×4T bytes
的规模（BLT arXiv:2412.09871）**，且按熵动态切 patch 在同等推理成本
下 scaling 更平滑、对噪声与低资源语言鲁棒，但序列膨胀 3~4 倍的
推理成本没有消失；③ 正确表述是「路线成熟但未主导」——值得作为
2026-2027 的信号跟踪，不该作为选型默认。

**Q8【中】OCR/文档数据怎么造，成本是什么量级？**

谱系：DocVQA/TextVQA/OCR-VQA 三件套是评测锚（5 万/4.5 万/100 万 QA）。
造数据两路线：① 渲染对齐——Nougat 的 arXiv 论文 + LaTeX 源（800 万+
页，2023-08）、DocOwl UReader 像素级统一格式（千万页，2023-07）；
② 模型代工——**olmOCR 用 GPT-4o-mini 锚定 + 自训 7B 推理，100 万页
PDF 约 190 美元（AI2，2025-02）**。2025-26 增量在 GUI 截图（agent
数据）、手写与数学图表、document grounding 的 bbox 标注。被追问
「为什么贵」：文档数据的价值密度高但结构信息（版面、表格、阅读序）
在纯文本抽取时会丢，必须用视觉模型读像素才能保住。

**Q9【中】合成数据占比多少算安全？坍缩怎么防？**

报区间：**预训练后段 10%~30%、SFT 段 50%+（2026 社区共识区间）**，
极端如 Nemotron 4 指令数据 98%+ 合成。风险口径：合成质量被教师模型
能力封顶，递归自训练会 model collapse（Shumailov 等，Nature 2024）。
防法三件套：保留人写/真实种子数据做锚、控制合成数据的多样性（温度
与去重）、对合成段做独立评测监控而不是混进总量里看均值。

## 六、口径与未核实说明

- 中文 fertility 各值为社区多篇 2023-2025 对照实测的均值量级，具体
  随语料（新闻/代码/口语）波动；「账单差 30%~50%」是按其推算的工程
  量级，非单篇论文数字。
- Qwen3 / GLM-4.5 / Kimi K2 词表数（151,936 / 151,552 / 163,840）
  为 2026-10 复核 HF config.json 的 vocab_size；未逐项复核
  tokenizer.json 内 merge 表规模。
- o200k「中文省 30%~40%」是 OpenAI 官方 1.4× 口径的折算区间。
- Emu3 图像 token 数各版本口径不一（8×8 下采样按版本取 64/512 等），
  正文只引用 codebook K=32,768 与统一 next-token 路线，不写单图
  token 精确数。
- Gemini「1 秒视频 ≈ 258~300 token、1 小时 ≈ 100 万」为公开文档
  口径区间，未按具体模型版本复核。
- Cosmos Tokenizer 的「2048 倍」按最高档 8×16×16 时间×空间压缩推算，
  与原文「总压缩 4×8×8 到 8×16×16 区间」口径一致。
- 合成数据占比区间（10~30% / 50%+）为 2026 时点社区经验共识，非
  单篇来源；Re-LAION-5B 合规细节、PaddleOCR-VL 数据卡未展开核实。
- PaddleOCR-VL「109 语言」为官方宣传口径，未测。

## 串联阅读

- [多模态架构基础](./多模态架构基础.md)：VLM 三大流派与 M-RoPE、
  图像 token 占位的模型侧视角——本篇 §3 只讲视觉 token 怎么造，
  进 LLM 之后的结构在那篇。
- [数据工程专题](../数据工程专题.md)：文本数据的清洗五件套、
  FineWeb-Edu/DCLM 分类器重采样——本篇 §4 是它向多模态的平行扩展。
- [位置编码与norm](./位置编码与norm.md)：BPE 训练直觉与 token 数
  估算速查，本篇 §2 是它 tokenizer 一节的完整谱系版。
- [多模态生成与diffusion专题](../多模态生成与diffusion专题.md)：
  DiT 谱系与采样加速——本篇 §3.1 的 VQ 离散派是生成侧的「token 化
  上游」，扩散路线在那篇。
- [实时多模态模型专题](../inference/实时多模态模型专题.md)：音频
  codec 的 12.5Hz 甜点与 omni serving——本篇 Q3 的音频 token 口径
  在那一篇展开。
- [长视频推理工程专题](../inference/长视频推理工程专题.md)：一小时
  视频的 token 账本与压缩谱系，承接本篇 §4.4 的视频数据口径。
