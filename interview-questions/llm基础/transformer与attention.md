# Transformer 与 Attention 详解

> LLM 基础模块的第一篇，也是整个面试的"开场白"——Transformer 架构题几乎人人问
> （"极高"频率），MHA 手撕是算法/Infra 岗的硬通货。本文按「直觉 → 公式 → 结构 →
> 工程取舍 → 面试怎么答」组织，配套题目标注自
> [高频面试真题汇总](../高频面试真题汇总.md)。

## 一、Self-Attention 的直觉

▶ 面试题：Transformer 整体架构讲一遍（自注意力/多头/FFN/残差/位置编码）——**极高频**，几乎人人问

先讲讲故事版：一句话里每个词都要"看这个句子的所有其他词一眼"，来决定自己在这个
语境下的表示。比如"苹果发布了新手机"里的"苹果"，只有通过 attention 看到"手机"，
才能把自己的向量从"水果"修正成"公司"。

这件事用三句话说清楚：

1. 每个 token 把自己变成三个向量：**Query（我要找什么）**、**Key（我是什么）**、
   **Value（我携带的信息）**。
2. 用 Q 和所有人的 K 做点积，得到"相关性分数"（attention score）。
3. 分数过 softmax 变成权重，对所有人的 V 做加权求和，得到新的表示。

公式：

```text
             Q = XW_Q,  K = XW_K,  V = XW_V

                       QK^T
  Attn(X) = softmax( ——————— ) V
                       √d_k
```

其中 `d_k` 是 Key 向量维度。输入序列长 `n`、隐藏维度 `d` 时，Shape 变化：
`X: [n, d]` → `Q,K,V: [n, d_k]` → `QK^T: [n, n]` → 输出 `[n, d_k]`。

### 为什么除以 √d_k？（经典中的经典）

▶ 面试题：Attention 为什么除以 √d？——**极高频**（经典八股）

推导就一个假设：Q、K 各分量独立、均值为 0、方差为 1，则点积
$q \cdot k = \sum_{i=1}^{d_k} q_i k_i$ 的方差是 $d_k$（每一项方差 1，求和累乘加）。
也就是说维度越大，点积的数值就越大，softmax 的输入动辄几百上千。

softmax 对极端值很敏感：输入差一个数量级，输出就会"一边倒"成 one-hot，几乎退化成
硬 attention，**梯度趋近于 0**（softmax 的梯度在上界饱和区消失）。除以 $\sqrt{d_k}$
刚好把方差归一回 1，让 softmax 工作在一个梯度健康的区间。

一句话答法："**方差随 d_k 线性膨胀，除以 √d_k 把 attention score 的方差归一，防止
softmax 饱和导致梯度消失。**"

### O(n²) 复杂度

`QK^T` 是 $n \times n$ 矩阵，序列每翻一倍，attention 的计算量和显存都翻四倍。
这就是长上下文的一切麻烦之源（KV Cache 显存、FlashAttention、稀疏 attention
都是为了对付它）。复杂度怎么优化也是高频追问，后文会讲。

## 二、MHA（Multi-Head Attention）

一个 head 只能学一种"看谁"的模式，多头就是并行跑 h 组不同投影的 self-attention，
各自捕捉不同关系（有的盯语法、有的盯指代、有的盯相邻），最后拼起来再过一次投影：

```text
  head_i = Attn(XW_Q^{(i)}, XW_K^{(i)}, XW_V^{(i)})     i = 1..h
  MHA(X) = Concat(head_1..head_h) W_O
```

<div class="diagram-embed">
<iframe src="assets/diagrams/mha-structure.html" width="100%" height="780" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/mha-structure.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

一个标准 LLM block 的完整结构（Decoder-only / Pre-Norm 风格）：

<div class="diagram-embed">
<iframe src="assets/diagrams/transformer-block.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/transformer-block.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

参数量估算（忽略 bias）：每层 attention 有 $W_Q,W_K,W_V,W_O$ 四个 $d \times d$
矩阵 = $4d^2$；SwiGLU FFN 三个矩阵（gate、up、down），中间维约 $\frac{8}{3}d$，合计
$3 \cdot d \cdot \frac{8}{3}d = 8d^2$。**每层约 $12d^2$，**L 层加 embedding 就是

$$N \approx L \cdot 12d^2 + V \cdot d$$

校验一下 LLaMA-2-7B（L=32，d=4096，V=32000）：$32 \times 12 \times 4096^2 \approx 6.44\text{B}$，
加 embedding（输入输出各一份）约 0.26B，≈ 6.7B，对得上。

## 三、MHA → MQA → GQA → MLA 演进

▶ 面试题：MHA→MQA→GQA→MLA 演进脉络，每一步在省什么？——**高频**（字节/快手）

主线只有一条：**压缩 KV Cache**（下一节会讲为什么它是推理显存大头）。所有变体
动的都是 K/V 的头数，Q 的头数始终不动。

| 方案 | Q 头数 | K/V 头数 | KV Cache 量 | 代表模型 |
|---|---|---|---|---|
| MHA | h | h（每头独立） | $2 \cdot L \cdot d$ | GPT-3、LLaMA-1 |
| MQA | h | 1（全部共享） | $2 \cdot L \cdot d/h$（省 h 倍） | Falcon、PaLM |
| GQA | h | g（1 < g < h，g 组共享） | $2 \cdot L \cdot d \cdot g/h$ | LLaMA-2-70B、Qwen |
| MLA | h | 低秩压缩 latent 向量 | 只存压缩向量 $c_t$，维度远小于 d | DeepSeek-V2/V3 |

<div class="diagram-embed">
<iframe src="assets/diagrams/kv-evolution.html" width="100%" height="1000" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/kv-evolution.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

各步答法要点：

- **MQA**：所有头共享一组 K/V，KV Cache 直接缩 h 倍，解码是 memory-bound 所以
  提速明显；代价是质量有损失（表达容量下降）。
- **GQA**：MHA 和 MQA 的折中——分组共享，几乎不掉点、显存省到 g/h。**目前是
  开源模型的主流默认**（LLaMA-2/3-70B、Qwen、Mistral 都是 GQA）。
- **MLA**：思路换了——不再共享头，而是把每个 token 的 K/V 先从 d 维**下投影到
  一个低维 latent（$c_t$）**（DeepSeek-V2 里 $d_c = 512$，远小于 $d$），cache 里只存
  $c_t$（加一个共享的 RoPE 分量），用的时候再上投影还原出各头的 K/V。因为下投影
  矩阵可以**被后续矩阵吸收**（矩阵乘法结合律：$W^{UK}$ 能并进 Q 的投影里不显式算出 K），
  既比 GQA 更省，又能保留接近 MHA 的表达能力。注意 MLA 里 RoPE 和压缩有冲突
  （RoPE 是逐位置的，不能被矩阵吸收），所以 DeepSeek 把一小部分维度单独留出来
  走 RoPE，不参与压缩——这是深挖追问点。
  深挖到推导与手撕 cache 账见 [MLA 深度穿透专题](./mla深度穿透专题.md)。

答这类题的节奏：**先说动机（KV Cache 是解码显存瓶颈）→ 按头数光谱讲 MHA/MQA/GQA
→ MLA 单独讲低秩压缩和矩阵吸收 → 收尾提各自代表模型。**

## 四、KV Cache 原理与显存估算

▶ 面试题：KV Cache 是什么？生成新 token 要不要重算历史 token？——**高频**（字节/拼多多开场题）
▶ 面试题：参数量和显存占用估算（7B/8×7B 权重 + KV Cache 占比）？——**高频**（字节/滴滴必考计算题）

### 原理

自回归解码时，第 t 步的 attention 需要前 t 个 token 的 K 和 V。历史 token 的 K/V
算过之后现在**不会变**（它们看不到未来，因果 mask 保证），所以缓存下来，每步只算
**当前新 token 的 QKV**，Q 和历史 K/V 算 attention。

- 生成新 token **不需要**重算历史 token 的前向，只算向量新增的 1 个位置。
- 这就是 prefill（输入整段，并行算，cache 首次填充）和 decode（一次一个 token，
  读 cache）两阶段分开的原因——prefill 是 compute-bound，decode 是 memory-bound
  （瓶颈在把 cache 从 HBM 搬进显存计算单元）。
- 评估缓存命中：常用指标是 **prefix cache 命中率**（vLLM/SGLang 都有），以及
  TTFT（首 token 延迟，prefill 完成才算）vs TPOT（每 token 延迟，纯 decode）。

### 显存估算公式（必背）

KV Cache 每 token 占的显存：

$$\text{KV/token} = 2 \times L \times n_{kv} \times d_{head} \times \text{bytes}$$

- 2 = K 和 V 两份
- L = 层数
- $n_{kv}$ = K/V 头数（MHA 时 = 头数 h，GQA 时 = 组数 g；$n_{kv} \times d_{head}$ 对 MHA 就是 $d_{model}$）
- bytes = 精度字节数（FP16/BF16 = 2，FP8/INT8 = 1）

总 KV Cache = 上式 × 序列长度 × batch size。

拿 LLaMA-2 系列算一遍（BF16，batch=1）：

| 模型 | L | d_model | n_kv | 每 token | 4K 上下文 | 8K 上下文 |
|---|---|---|---|---|---|---|
| 7B | 32 | 4096 | 32（MHA） | $2\cdot32\cdot4096\cdot2$B = 0.5 MB | 2 GB | 4 GB |
| 13B | 40 | 5120 | 40（MHA） | $2\cdot40\cdot5120\cdot2$B ≈ 0.78 MB | 3.2 GB | 6.4 GB |
| 70B | 80 | 8192 | 8（GQA） | $2\cdot80\cdot8\cdot128\cdot2$B ≈ 0.31 MB | 1.25 GB | 2.5 GB |

顺手核对一下 70B 为什么用 GQA：如果不分组的 MHA，每 token 是
$2\cdot80\cdot8192\cdot2$B ≈ 2.5 MB，4K 上下文 batch=1 就要 10 GB，batch 开大或
上下文加长直接爆。GQA-8 把它砍到 1/8。

再补一笔推理总显存的拆账（面试官经常接着问）：

$$\text{总显存} \approx \text{权重} + \text{KV Cache} + \text{激活/碎片（约 10%-20%）}$$

- 权重 = 参数量 × 每参数字节数：7B FP16 ≈ 14 GB，13B ≈ 26 GB，70B ≈ 140 GB。
- 所以"7B 模型 FP16 推理，4K 上下文"≈ 14 + 2 + 缓冲 ≈ **17 GB 左右**，一张
  24 GB 卡够用；batch 开大或上下文拉长后 KV Cache 就会反超权重成为大头——
  这正是上节所有 KV 压缩方案的动机。

扩展公式（若问到训练显存）：AdamW + 混合精度每个参数约占 **16 字节**
（BF16 权重 2 + BF16 梯度 2 + FP32 主权重 4 + FP32 一阶动量 4 + FP32 二阶动量 4），
7B ≈ 112 GB，还没算激活，这就是为什么 7B 全参训练单卡放不下。详细拆账见
[分布式训练模块](../distributed-training/) 和本模块 README 的速查表。

## 五、FlashAttention：把 O(n²) 显存压成 O(n)

▶ 面试题：FlashAttention 原理？——**中高频**（阿里 Infra 深挖）

先纠正一个常见误区：FlashAttention **不改数学结果，计算量仍是 O(n²)，**它省的是
**显存和 HBM 读写次数**。标准 attention 的痛点是把 $n \times n$ 的 score 矩阵
显式写出来，softmax 之后再读回来——n=8K 时这个矩阵 BF16 也有 128 MB，而且
HBM↔SRAM 之间来回搬，memory-bound。

FlashAttention 两招：

1. **分块（Tiling）**：把 Q、K、V 切成小块，像算矩阵乘法一样按块计算，$n\times n$
   score 从不落地显存，只在片上 SRAM 命里又活了几秒。
2. **在线 softmax（Online Softmax）**：普通 softmax 要看到整行分数才能归一，
   分块就没法算。在线 softmax 每处理一块就维护"当前最大值 m 和当前分母和 l"，
   新块来了就先把之前的结果按 $e^{m_{old} - m_{new}}$ 缩放、再并入新块，最后一步
   才做真正的归一化。数学上等价于一次性 softmax。

<div class="diagram-embed">
<iframe src="assets/diagrams/flash-attention.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/flash-attention.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

效果：显存从 O(n²) 降到 O(n)，实测 2-4 倍端到端加速；反向传播不重读中间矩阵，
而是**用保存的输出和 softmax 归一化统计量重算 attention**（重算比读 HBM 便宜）。
FA2 进一步调整了如何切 batch/head 维度的并行和 warp 内的工作划分；FA3 针对
Hopper 架构做 warp specialization 和低精度。追问到 Hopper 级别细节时答出"warp
specialization、生产消费流水"即可，不用背 kernel 代码。

## 六、高频追问清单（本主题）

| 追问 | 答题要点 |
|---|---|
| 为什么用 Decoder-only 而不是 Encoder-Decoder？ | ① 生成任务天然是自回归的，causal mask 的 Decoder 结构简单统一；② Decoder-only 在 zero-shot/少样本 generalization 上表现更好（有研究指出 full attention 的 prefix-LM 结构 bidirectional 部分会引入噪声）；③ prefill 时输入也走同一条路径，工程上 KD/蒸馏/KV Cache 都更顺。代价是理解类任务不如 Encoder 双向建模。——**高频**（腾讯/阿里）。补充三条 2026 版论述：④ **数据效率**：自回归目标下每个 token 都是监督信号（1000 token 产 999 个训练任务），span corruption 类目标只有被遮 token 产 loss 且遮盖策略本身是超参——规模法则下数据吞吐效率是胜负手；⑤ **训推一致性**：decoder-only 训练与推理共用完全同一张计算图，encoder-decoder 存在 teacher forcing 与前缀生成的 exposure bias 管理成本；⑥ **ICL 天然契合**：prompt 与生成共享同一自回归序列，few-shot 示例注入无 encoder 信息瓶颈。Encoder-Decoder 的保留地：输入理解密集（翻译/摘要/QA）、输入输出长度悬殊、非自回归并行生成。 |
| QKV 里 K 的作用是什么？能否省 K 直接用 V 匹配？ | K 是「匹配器/索引」，V 是「内容」——**匹配与读取解耦**：一个位置可以「容易被关注」（好 K）但「贡献特定变换后的信息」（好 V）。省 K 等于强制 W_K = W_V：① 匹配与读取锁死，可学变换空间被压缩，多头丢失「不同匹配模式」的多样性；② **对称性破坏**：QK^T 有方向性（代词找先行词 ≠ 先行词找代词），QV^T 是对称的，查询与被查询不该对称；③ 独立 K 投影多一条梯度通路，共享后部分任务收敛更慢。所以没人省 K，省的是 KV 的**头数**（MQA/GQA）或**维度**（MLA）——存储侧压缩，不解耦匹配与读取。 |
| 因果 mask 是什么？ | 上三角置 $-\infty$ 再过 softmax，保证第 t 个位置只能看到 ≤ t 的 token；训练和推理逻辑统一（teacher forcing 也靠它防泄漏）。 |
| 残差连接为什么必须有？ | 深网络梯度通路（恒等映射），缓解梯度消失；配合 Pre-Norm 后残差通路是"干净"的，能训练上百层。 |
| FFN 为什么要先把维度放大再缩回？SwiGLU 哪里好？ | FFN 提供逐位置非线性变换和"记忆库"，扩维后容量更大；SwiGLU = Swish(xW₁) ⊙ (xW₃) 再过 W₂，门控结构比 GELU 两层 FFN 同参数下效果更稳，代价是三个矩阵。 |
| 不训练能不能往模型里塞知识？ | 能，而且都绑在 MLP 上：① 先决认知——事实知识住在 MLP 层（Geva 2021 的 FFN=key-value 内存）；② 编辑路线——ROME/MEMIT 闭式 rank-one 改预训练权重；③ 构造路线——arXiv 2607.10034 证明白化后门控 MLP 与 Hebbian 记忆数学等价，B 矩阵用键值外积和直接赋值、无需梯度下降，信息论最优率下同事实数参数省 10–10⁴ 倍、塞进 Transformer 块省 15–63 倍，PoC 是整块换 MLP（摘要口径）。边界：白化假设、PoC 阶段，详见 §九。 |
| Attention 除了 FA 还有哪些降复杂度方案？ | 稀疏 attention（Longformer/BigBird 固定 pattern）、线性 attention（kernel 近似 softmax 变 O(n)）、滑窗 attention（Mistral SWA，只看最近 w 个 token）、PagedAttention（这是显存管理不是改复杂度）、以及 KV Cache 侧的 GQA/MLA。 |
| Softmax 为什么要减 max？ | 数值稳定性：$e^{x}$ 容易上溢出，softmax(x) = softmax(x − max)，不变换结果但防 NaN。FlashAttention 的在线 softmax 本质就是动态维护这个 max。硬核追问如字节要求 numpy 从零手写 softmax，就考这个。 |

## 七、手撕练习（→ coding/）

本主题对应的手写代码真题（详见 [高频面试真题汇总 - 手写代码题](../高频面试真题汇总.md#七手写代码题live-coding-真题)）：

- **手撕 Multi-Head Attention**（PyTorch，可扩展 cross-attention）——字节算法岗，
  高频。核心考点：reshape 成多头、`QK^T/√d`、causal mask、softmax、`W_O`。
- **numpy 手撕 attention 前向**（含手写 softmax，要减 max）——字节 AML 一面原题。
- **FlashAttention 思想版实现**（分块 + 在线 softmax 的 Python 伪代码）——Infra 岗
  可能要求讲清后再写。
- 配套代码会在 [coding/](../../coding/) 目录更新，写完先对着本文公式自查 shape。

## 八、高效注意力谱系：通往长上下文（2025-2026 主线）

▶ 面试题：除了 FlashAttention，注意力还能怎么降成本？NSA / MoBA / 线性注意力 / hybrid 各是什么？——**中高，2026 升温线索**

主线只有一句：**长上下文下注意力又贵又慢，所有方案都在回答同一个问题——
"哪些 token pair 之间的 attention 真正值得算"。**各家刀法不同、付出的代价不同，
背一张谱系表就能答穿：

| 方案族 | 代表 | 核心思想 | 代价 / 风险 |
|---|---|---|---|
| 稀疏 attention | BigBird / Longformer | 固定 pattern：滑窗 + 少数全局 token + 随机连接，把 O(n²) 砍到 O(n·w) | pattern 靠人工拍，不是数据自适应 |
| 滑动窗口（SWA） | Mistral 的 Sliding Window Attention | 每个 query 只算最近 w 个 key，KV cache 上限也随之固定为 w | 长程依赖要靠"层数接力"传递，w 小时远端信息真看不到 |
| NSA（DeepSeek） | Native Sparse Attention，原生稀疏训练 | 三分支：compressed（分块压成代表 token 看全局摘要）+ selected（按重要性 top-k 选原始块细看）+ sliding（近邻全分辨率），门控融合 | 硬件对齐要求高，kernel 比 FA 难写；选块质量依赖打分器 |
| MoBA（Kimi） | Mixture of Block Attention | 把 attention 类比 MoE：key 分块当 expert，轻量 router 让每个 query 选 top-k 块 | 块冷热不均要配负载均衡；选块上限受 router 质量约束 |
| 线性 attention / SSM | Linear Attention、Mamba、RWKV、Gated DeltaNet | 核化 softmax 或状态递推：历史被压进固定大小状态，复杂度 ~O(n)、decode 状态 O(1) | 状态有界 → 记忆精度有损，长程检索/精确复制任务掉点 |
| Hybrid（2025 收敛方向） | Qwen3-Next：75% 线性层（Gated DeltaNet）+ 25% 全注意力层 | 记忆精度 vs 容量效率的折中：线性层吃吞吐，少数全注意力层兜长程检索能力 | 配比是打磨出来的经验值，没有通用最优 |

各家一句拆解：

- **稀疏 attention（BigBird/Longformer）**：最早的答案——提前定好"滑窗 + 全局
  token + 随机连边"的固定 pattern，证明了"绝大多数 pair 不重要"；但 pattern 不
  是模型自己学出来的，被可学习稀疏（NSA 这一派）接棒。
- **滑动窗口（Mistral SWA）**：直觉最直接的方案——每个 query 只找最近 w 个 key，
  计算和 KV cache 双双从 O(n) 降到 O(w)；代价是长程信息只能在层与层之间"接力"
  传播，w 小、层数不够时，十万 token 之外的内容等于不存在。
- **NSA（DeepSeek）**：思路是"让模型自己挑要算谁"——compressed 分支把 token
  分块、每块压成一个代表 token，给 query 提供粗粒度全局摘要；selected 分支按
  重要性打分选 top-k 原始块精看；sliding 分支保住近邻的高分辨率信息；三路用
  门控加权融合，且选块策略随训练端到端优化，比固定 pattern 自适应得多。
- **MoBA（Kimi）**：attention × MoE 的混血——key 分块当 expert，query 一个轻量
  router 打分只接 top-k 块，思想上直接复用 MoE 的"块路由 + 稀疏激活"；优点是
  算力开关是运行时决策，缺点和 MoE 一样要治冷热不均。
- **线性 attention / SSM（Mamba、RWKV、Gated DeltaNet）**：复杂度约 O(n)、decode
  每步只更新 O(1) 状态，把"看全部历史"换成"压缩历史"；代价清清楚楚——状态被压
  进固定大小，记忆精度必有损，needle-in-a-haystack 类精确检索任务上是硬伤。
- **Hybrid 收敛趋势（2025 主流）**：前些年大家想让"更好复杂度的结构整体取代
  softmax attention"，2025 年结论收敛到"**大部分层用线性注意力省算力，少数层
  全注意力兜精度**"——以 Qwen3-Next 的 75% 线性层（Gated DeltaNet）+ 25% 全局
  全注意力的配比为代表。逻辑：线性层容量已够用，但只有全注意力层能撑精确检索
  与复制；且**只有全注意力层才产生完整 KV cache**（线性层只存 O(1) 状态，不产生
  KV），所以 KV cache 预算只需按那 25% 的层估算——这是 hybrid 对 Infra 侧最大的
  实际意义。

**答题节奏**：一句主线（复杂度与显存一起砍）→ 按表讲谱系 → 强调 hybrid 是
2025 收敛方向、"KV cache 只按全注意力层算" → 收尾点名代表模型/论文（NSA 出自
DeepSeek、MoBA 出自 Kimi、hybrid 代表 Qwen3-Next）。

▶ 追问答法速查表：

| 追问 | 要点 |
|---|---|
| 为什么 hybrid 是 2025 主流方向？ | 纯线性/纯 SSM 想在所有层取代 softmax attention 的路线，在精确检索、长程复制等任务上稳定掉点；规模化实践收敛到"大部分层省算力 + 少数层兜精度"：线性层负责吞吐，全注意力层保住检索能力，KV cache 也只按全注意力层算，端到端综合成本最低。 |
| NSA 三分支怎么配合训练？ | 端到端一起训：compressed 分支的块摘要给 query 全局视野、selected 分支的打分器靠门控等可微路径回传梯度（top-k 选块本身是离散的，要用可微近似把它"绕过去"）、sliding 分支保证近邻信息密度；三路不是各算各的，最后由门控融合成一个输出，选块策略随主 loss 一起收敛。 |

## 九、FFN 存知识的理论补全：MLP 是 Hebbian 记忆（2026-07）

▶ 面试题：FFN 为什么被叫「记忆库」？能否不训练直接往模型里塞知识？——**中频**（2026-07 新论，理论题升温）

老结论先摆出来：attention 管「谁看谁」，FFN 管「记住什么」。Geva et al.
（2021）早就论证 FFN 的中间神经元是一次 key-value 查找：FFN(x) =
f(x·K)·V，每个中间隐藏元 ≈ 一条「键-值」记录。§六追问表里那句
「FFN 是记忆库」就来自这条经验观察——但它一直没有理论解释。

2026-07 补上了：Hazy Research（Roberto Garcia、Jerry Liu、Ronny
Junkins、Sabri Eyuboglu、Atri Rudra、Christopher Ré）的
《MLPs are Hebbians: Constructing Efficient Fact-Storing MLPs for
Transformers》（arXiv:2607.10034，COLM 2026，收录口径系检索转述）。

### 9.1 等价性：白化后，门控 MLP 就是 Hebbian 记忆

神经科学的赫布法则说「一起激发的神经元连接在一起」；翻译成数学，
存一条事实就是一次外积：键的表征与值的向量做外积、累加进突触矩阵。
论文证明：对输入特征的协方差做**白化（whitening）**后，门控
MLP(x) = B(Ax ⊙ Gx) 与 Hebbian 核记忆**数学等价**——白化消掉真实
embedding 之间的相关性，外积叠加的各条记录才互不串扰；真实数据
各向异性/聚簇时残留的串扰，就是论文摘要里「几何惩罚因子」的来源。

### 9.2 闭式构造：不训练，直接赋值

**机制口径：arXiv 摘要 + 微信/检索转述，本仓未读 PDF 全文。**

```text
存（构造）                                  读（解码）
  事实 i = (k_i, v_i)                          给定查询 x ≈ k_i
  A、G：随机投影（采样/计算，保留门控形态）        MLP(x) = B(Ax ⊙ Gx)
  B := Σ_i  v_i · φ(k_i)ᵀ  ← 键值外积求和       「解码间隔」= 输出与干扰
  φ(k_i) = Ak_i ⊙ Gk_i（隐藏空间里的键）          项的差距 > 0 才读得回
  全程不需要反向传播，一次线性代数赋值即完成
```

方法上的关键跃迁：先前工作只衡量「存了多少」，这篇分析的是
**解码间隔（decoding margin）**——像 LM 给下个 token 打分那样，用
想要的输出与干扰项的差距来度量「能不能被读回来」，这才谈得上
信息论意义上的最优存储率。

### 9.3 数字锚（论文摘要口径，未复测）

- 各向同性 embedding 下达到**信息论最优存储率**：同样事实数，参数量
  比先前构造**省 10 到 10⁴ 倍**；
- 任意 key/value 几何：保持同样的容量标度，只被几何惩罚因子打折；
- 塞进 Transformer 块做事实召回：同样事实数**省 15 到 63 倍参数**；
- 概念验证：**模块化事实编辑**——把一个 Transformer 块的 MLP 整个
  换成新构造的 MLP，知识即随之更换。

### 9.4 面试串联：三条已有线各归各位

- **对 Geva 2021**：这是「FFN=KV 内存」经验观察的理论补全——解释了
  为什么 LLM 里的 MLP 存事实能逼近信息论最优；
- **对 ROME/MEMIT 模型编辑**：ROME 同样是闭式 rank-one 改 MLP 权重，
  但那是在预训练模型上「打补丁」；本篇从零构造给出上界。一句话：
  **「编辑」与「构造」是同一枚硬币**——都在写 Hebbian 外积，区别是
  前者迁就已训练权重的几何，后者自由设计几何；
- **对 RAG/微调三分法**：[RAG 全链路](../rag/rag全链路.md) §1.2 说
  「微调=学习知识改参数」；这条线补出第三种姿势——**改参数但不
  训练**：外积写入的信息量恰好等于新事实携带的信息量，是最小改动。

### 9.5 诚实划界

这是 2026-07 的理论工作加构造式 PoC，离「生产模型直接注入知识」
有距离：白化假设、随机投影 gate/up 与真实预训练权重的偏差、多层
组合、与后训练（RLHF 等）的相互作用都是开放问题。引用时口径写
「理论+PoC，COLM 2026 转述」。

## 十、深度轴的注意力：AttnRes 打破「残差各层等权」十年假设

K3 技术报告（arXiv:2607.24653，官方口径，本仓未复核）把一个
十年没人动的假设摆上台面：残差连接对**所有前层等权累加**，
深度方向的信息流其实是个瓶颈——序列轴上 RNN 的老毛病
（单一状态 h_l 一路压缩）在深度轴上换皮重演。AttnRes 的
方法论平移很漂亮：**Transformer 当年用注意力替掉时间轴递归，
AttnRes 用注意力替掉深度轴等权累加**：

```text
层 l 定义可学伪查询  q_l = w_l ∈ R^d
键=值:k_i = v_i = h_token_embedding (i=0) | f_i(h_i) (前层输出)
softmax核 φ(q,k) = exp(q^T · RMSNorm(k))   ← RMSNorm 防"大层
输出范数大→权重被单层垄断"
h_l = Σ_{i<l} α_{i→l} · v_i                ← 逐层选择式取回

全形式代价: L~百级, O(L^2·d) 算力可接受; 真开销是 O(L·d) 存活
内存 + PP 下跨段通信 → Block AttnRes: L 层切 N 块, 块内求和成
单表示再进注意力, 开销降为块粒度
```

面试三点式：其一，**这不是变体大杂烩，而是范式改写**——
x_l = x_{l-1} + f(x_{l-1}) 的「加法残差」变成「注意力残差」，
每层按数据相关性选择取回哪些前层表示，与 §九 Hebbian 线
同属「重定义信息存放位置」一派（一个改写参数，一个改写
通路）；其二，**K3 实测它是 2.5× scaling 效率的组成部分**
（与 KDA、Stable LatentMoE、Per-Head Muon 并列——单一归因
是常见误读，四件套各有贡献）；其三，**Block 形式是落地
形态**——块内求和压掉 O(L²) 通信，配合专用
Block-AttnRes kernel 才进得了生产（推理侧 kernel 见
K3 报告 §5.4.2）。追问预案：「为什么不干脆用 Dense 残差
或加权残差」——答：等权和固定权都是静态先验，AttnRes 是
逐 token 逐层动态选择；「与 Goody/ELU+ 有什么区别」——
答：那些改的是残差的数值形状，AttnRes 改的是残差的**拓扑**
（从链到全连通 DAG）。

## 附：高频开场题「NLP 与 LLM 最大的区别是什么」

参考答法（三句话版）：传统 NLP 是**任务定义模型**——分词、NER、
摘要各训各的专用模型，迁移靠特征工程；LLM 是**模型吞掉任务**——
一个自回归 next-token 目标加足够大的语料，把几百个任务统一成
「做下文预测」，迁移靠 prompt 而非改参数。所以真正最大的区别不是
参数量，是**任务接口消失了**：评测一个 LLM 你问的是「它还会什么」，
评测一个 NLP 模型你问的是「它在哪个任务上多少分」。追问「那为什么
BERT 时代不算？」——BERT 仍需每个下游任务接一个任务头微调，
统一的只是编码器，不是任务本身。

---

*相关阅读：[位置编码与 Norm](./位置编码与norm.md) · [RAG 全链路](../rag/rag全链路.md)（改参数不训练的第三种姿势）· 上一页 [模块导航](./README.md)*
