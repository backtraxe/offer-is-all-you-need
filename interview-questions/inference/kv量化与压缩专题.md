# KV 量化与压缩专题：位宽谱系 × 驱散谱系 × 引擎落地

> **面向**：已读过 [长上下文推理与 KV 多级体系](./长上下文推理与kv体系.md)
>（KV 总量账、稀疏注意力「省算不省存」的分家）与
> [kv-offload 与分层存储专题](./kv-offload与分层存储专题.md)（L0–L3 存储层
> 视角）、准备「KV 压缩」追问线的读者。[量化与压缩](./量化与压缩.md#八kv-cache-量化长上下文时代的第二战场)
> 以权重量化为主体，KV 量化只给了一句话——本篇补上它没讲的部分。
>
> **读完获得**：① KV 为什么难量（流式激活、K/V 结构差异、RoPE 前后）的
> 量化轴速记表；② 量化位宽谱系（KVQuant → KIVI → MiKV → IntactKV → SKVQ →
> WKVQuant）带数字锚的时间线；③ 驱散裁剪谱系（StreamingLLM → H2O → SnapKV →
> PyramidKV → RazorAttention → DuoAttention）的粒度演进轴；④ vLLM / SGLang
> FP8 KV 的开关清单与四个部署坑位，MLA 时代为什么还要量 KV（FlashMLA 原生
> FP8/FP4）；⑤ 两道面试题的完整答法——并发换算账、量化×驱散叠加三形态。
>
> **时效口径**：素材时间轴从 2023-06 H2O（arXiv:2306.14048）到 2026-09
> FlashMLA V4.1 新 FP8/FP4 KV 格式；论文数字按 arXiv 摘要口径括注，引擎行为
> 按官方文档/源码 2026-10 核实口径，推导账与未核实项一律标明，见文末
> 「口径与未核实说明」。

## 一、定位与边界：本篇只压 KV「自己」

KV cache 的「压缩」在仓库里被拆成了三篇，先划清边界才不乱：

- [长上下文推理与 KV 多级体系](./长上下文推理与kv体系.md)：回答「装不下
  怎么办」的总账——稀疏注意力管算、驱逐/多级体系管存，tiered offloading
  总览。它告诉你**有哪些刀**，不细讲每把刀的刀刃。
- [kv-offload 与分层存储专题](./kv-offload与分层存储专题.md)：把 KV **挪走
  存**——HBM/DRAM/SSD/远端池多级体系、LMCache/Mooncake/NIXL 换入换出。
- **本篇**：把 KV **在原地压小**——两条互相正交的谱系：
  **量化位宽派**（每个 token 还在，位宽变矮：FP16 → FP8 → 2bit → 1.5bit）与
  **驱散裁剪派**（token 数变少，留下的仍是全精度：sink+滑窗、heavy hitter、
  观察窗、逐层预算、头级二分），以及两派与引擎开关的接线。

先立一个坐标，全篇都靠它：**量化压的是「位宽」维，驱散压的是「条数」维，
两个维度正交、可叠加**——MiKV 与 DuoAttention 就是两谱系合流的证据（第六
节面试题二的正式答案）。

<div class="diagram-embed">
<iframe src="assets/diagrams/kv-quant-evict.html" width="100%" height="890" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/kv-quant-evict.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、为什么 KV 难量：流式激活 + K/V 不同命

### 2.1 与权重量化的本质区别（面试分水岭）

权重量化是**静态**问题：权重不变，可以离线校准、逐组迭代优化（GPTQ/AWQ
把误差摊销掉）。KV cache 是**流式动态**问题：

- 每个新 token 的 K/V 是推理时**现算的激活（activation）**，没有离线校准的
  机会，scale 必须在线求（dynamic quantization）；
- 误差随序列**累积**——attention softmax 会把 K 的量化误差乘进每个 query
  的注意力分布里，一步错步步放大；
- 所以 KV 量化方法论的关键词只有四个：**量哪位**（per-channel vs
  per-token）、**何时量**（RoPE 前 vs 后）、**谁能容错**（outlier / sink
  token 保护）、**留多少残量**（residual window 最近 N 个 token 保 FP16）。

被问「KV 量化和权重量化有什么区别」，这四个词脱口而出的顺序就是专业度
的顺序。

### 2.2 K 与 V 的结构差异：整个谱系的地基

KVQuant（arXiv:2401.18079，NeurIPS 2024，UC Berkeley）和 KIVI
（arXiv:2402.02750，ICML 2024）对 KV 激活的元素分布做了系统测量，结论
高度一致，是 2024 之后所有工作的前提：

1. **Key cache 存在 per-channel outlier**：少数**固定 channel**（头内某些
   固定维度）的幅值远大于其他 channel。沿 token 维量化（per-token）时，
   一个 outlier channel 会撑爆整组的量化范围，其他 channel 的分辨率全部
   浪费——所以 **Key 要 per-channel 量化**（沿 channel 维分组，每组一个
   scale）。
2. **Value cache 没有明显的 per-channel 结构**，分布平滑；且 V 直接进输出
   加权求和，误差直达 logits。V 实测 **per-token 量化**最合理（每个 token
   一组 scale，在线算最自然也最便宜）。KIVI 摘要原文：
   the key cache should be quantized per-channel；the value cache should be
   quantized per-token。
3. **RoPE 把结构搅浑**：RoPE 把不同频率的旋转混进 key，破坏 per-channel
   的幅值结构，让量化误差恶化。KVQuant 因此提出 **Pre-RoPE Key
   Quantization**——key 在施加 RoPE **之前**量化存储，解算时先反量化再上
   RoPE（代价是要同步存位置信息）。这是 KVQuant 独有的点，KIVI/SKVQ 不
   处理 RoPE 顺序问题。

**量化轴速记表**（面试画这张就够）：

| 对象 | 建议量化轴 | 原因 |
|---|---|---|
| **Key** | per-channel（KIVI/KVQuant），最好 pre-RoPE（KVQuant） | channel 级 outlier 会撑爆 per-token 组距 |
| **Value** | per-token | 分布平滑，误差直达输出要保 resolution |
| **scale** | 在线动态求 | KV 是激活，无离线校准机会 |
| **残窗** | 最近 W 个 token 保 FP16（KIVI residual window、SKVQ sliding window） | 局部 token 的注意力权重最大，不能亏 |

注意这张表跟「量化与压缩篇」旧口径「V 更敏感」不矛盾、但更细：**V 难在
用途**（误差直达输出），**K 难在分布**（outlier 要求换量化轴）——所以 K
换 per-channel，V 用 per-token 加残窗保局部精度。一句话口径：**K 换轴，
V 保窗**。

## 三、量化位宽派谱系：从 3.2bit 开山到 1.5bit 极限

### 3.0 时间线总表（全部数字按 arXiv 摘要口径）

| 工作 | 出处 | 有效位宽 | 关键技法 | 数字锚 |
|---|---|---|---|---|
| **KVQuant** | arXiv:2401.18079，NeurIPS 2024 | 平均约 3.2bit | per-channel K、pre-RoPE、非均匀数据类型、dense+sparse 分离 | 3-bit 下 PPL 退化 **小于 0.1**；LLaMA-7B 单卡 A100-80G 撑 **100 万 token**；自研 kernel 解码提速 **约 1.7 倍** |
| **KIVI** | arXiv:2402.02750，ICML 2024 | 2bit asymmetric | K per-channel + V per-token + FP16 残窗，tuning-free | 峰值显存（含权重）省 **2.6 倍**；批尺寸开到 4 倍、吞吐 **2.35~3.47 倍** |
| **MiKV** | arXiv:2402.18096 | 混合精度 | 重要 token 高位、被「逐」token 极低 bit 保留 | 压缩率/性能 trade-off 的 SOTA（摘要口径） |
| **IntactKV** | arXiv:2403.01241，ACL 2024 Findings | — | pivot/sink token 的 KV 由全精度模型无损保留 | 误差上界的数学证明，可叠加任意量化方案、推理零开销 |
| **SKVQ** | arXiv:2405.06219 | K 2bit / V 1.5bit | 通道重排 + clipped 动态量化 + 滑窗 | 7B 单卡 80G 撑 **100 万 token**；解码提速最高 **7 倍** |
| **WKVQuant** | arXiv:2402.12065 | — | past-only 量化、二维量化、跨 block 重构正则 | 省幅逼近「权重+激活同量」方案，性能接近全精度 |

> 坑位提示：WKVQuant 的编号是 arXiv:2402.120**65**，2402.120**80** 是另一
> 篇无关论文，是常见的误引号（经 HuggingFace papers API 核实）。

### 3.1 KVQuant：定义问题的开山之作

四件套一次说全：① **Per-Channel Key**——key 沿 channel 分组量化，匹配
outlier 结构；② **Pre-RoPE Key**——RoPE 前量化，消除旋转对分布的破坏；
③ **Non-Uniform**——按层敏感度加权的非均匀数据类型（不是均匀格点 INT，
而是保分布的分位点）；④ **Per-Vector Dense-and-Sparse**——每个向量把稀疏
outlier 单独拎出来高精度存，dense 部分用统一 range。

数字锚：3-bit 量化在 Wikitext-2 / C4 上 perplexity 退化小于 0.1（LLaMA /
Llama-2 / Llama-3 / Mistral），平均有效位宽报到 3.2bit 量级；LLaMA-7B +
单卡 A100-80GB 跑 100 万 token 上下文，8 卡系统跑 1000 万（论文标题即
Towards 10 Million Context Length）；自研 CUDA kernel 相对 fp16 matvec
解码提速约 1.7 倍。**定位口径：KVQuant 是精度天花板的代表，但实现复杂**
（非均匀格式 + 稀疏混合），工程上被直接抄的少。

### 3.2 KIVI：免调 2bit，流式友好

tuning-free、asymmetric 2bit；K per-channel + V per-token + **FP16 残窗**
（最近若干 token 不量化，攒满一组再量化塞进窗口外）。数字锚：2bit KV
在 Llama / Mistral / Falcon 上几乎无损；峰值显存（含权重）省 2.6 倍；
批尺寸可开大至 4 倍，真实工作负载吞吐 2.35~3.47 倍；最早强调流式解码
兼容性的 KV 量化方案（hardware-friendly）。

**定位口径：KIVI 是「能直接开」的代表**——无需校准、无需重训，工程上
被引用最多的 2bit KV 方案；面试里 KVQuant vs KIVI 的对比题，就答「精度
天花板 vs 免调落地」这一对。

### 3.3 MiKV：量化谱系与驱逐谱系的桥

MiKV（No Token Left Behind）的核心命题：token 驱逐类方法（H2O 等）把被
逐 token 的信息**彻底丢弃为 0 bit**，会带来 safety breaches、幻觉、上下文
丢失等 unforeseen risks。解法是不驱逐、全部保留但**分层位宽**——重要
token 保高精度，被「驱逐级」的 token 降到极低 bit 量化保留（reduced
precision quantization）。实验发现**留一点点低精度信息就能大幅挽回硬
驱逐造成的退化**。

面试意义：MiKV 证明「**量化与驱逐不是二选一，是连续的位宽预算分配
问题**」——这是第六节面试题二的理论答案预置。

### 3.4 IntactKV：pivot/sink token 无损保留

发现：模型把大部分注意力分数分配给输入开头少数 pivot tokens（即
attention sink），量化模型里这类 token 的 KV 一坏整体就崩。解法：pivot
token 的 KV cache 由**全精度模型无损生成保留**，可叠加在任何现有量化
方案之上、推理零额外开销；数学上证明 IntactKV 降低了量化误差上界。

意义：把 StreamingLLM 的 attention sink 观察（见第四节）引入了**量化**
语境——sink token 保 FP16 从此成为混合精度方案的标准做法。

### 3.5 SKVQ：推到 1.5bit 的极限档

技法三件套：**通道重排**（channel rearrangement，把幅值分布相近的 channel
重排进同一量化组，提高组内相似性）+ group 级 **clipped 动态量化** +
最近窗口 token 保高精度。数字锚：2-bit key + 1.5-bit value 精度损失极小
（此前 SOTA 在此位宽掉点明显）；7B 模型单卡 80GB 处理 100 万 token
上下文；解码提速最高 **7 倍**（低 bit 把带宽省到极限的口径）。

### 3.6 WKVQuant：权重与 KV 一起量的整合档

手法：past-only quantization（只对已生成的 KV 量，当前步不算进量化
流程）、二维量化（沿 token 与 channel 两个维度组织）、cross-block
reconstruction regularization。数字锚（摘要口径）：内存节省接近
「权重+激活同量」方案，性能接近全精度。意义：证明 **KV 量化与权重量化
是正交可叠加的两块显存账**，合起来才逼近「全系统量化」。

### 3.7 谱系一句话口播

KVQuant 定分布（per-channel K / pre-RoPE / 非均匀+稀疏，3.2bit 百万
上下文）→ KIVI 落地（免调 2bit，吞吐 2.35~3.47 倍）→ MiKV 定原则（重要
高位不重要低位，而不是删掉）→ IntactKV 补 sink（pivot token FP16 无损）→
SKVQ 推极限（通道重排，K 2bit / V 1.5bit，解码 7 倍）→ WKVQuant 做整合
（W+KV 一起量）。

## 四、驱散裁剪派谱系：从「丢哪些」到「哪些头看全局」

再立一次坐标：**量化是「每个 token 还在，位宽变矮」；驱散是「token 数变
少，留下的仍是全精度」**。两条谱系压缩的是 KV 的不同维度，所以可叠加。
驱散派的演进轴线记住两个：**粒度**（序列维 → 层维 → 头维）与**识别方式**
（固定规则 → 观察窗启发式 → 可学优化）。

### 4.0 时间线总表

| 工作 | 出处 | 粒度 | 核心观察 | 数字锚 |
|---|---|---|---|---|
| **H2O** | arXiv:2306.14048，NeurIPS 2023 | 序列维 | 少数 heavy hitter 贡献绝大多数注意力分 | 20% 预算；吞吐最高 **29 倍**（vs DeepSpeed/HF）、延迟降 **1.9 倍** |
| **StreamingLLM** | arXiv:2309.17453，ICLR 2024 | 序列维 | 开头 4 个 token 是 attention sink | 稳定跑到 **400 万 token**；vs 滑窗重算提速 **22.2 倍** |
| **SnapKV** | arXiv:2404.14469 | 序列维（prefill 侧） | prompt 末端观察窗可预测各头的关注位置 | 16K 输入解码 **3.6 倍**、显存约 **1/8.2**；单卡跑 380K |
| **PyramidKV** | arXiv:2406.02069 | 层维 | 注意力「低层分散、高层聚焦」，金字塔漏斗 | 只留 **12%** KV 对齐全量 LongBench；极限 **0.7%** 仍超同类；LLaMA-3-70B 留 128 条 Needle 满分 |
| **RazorAttention** | arXiv:2407.15891 | 头维 | 少数 retrieval head 才看全量输入 | KV 显存降 **70%+** 无明显退化；training-free、兼容 FlashAttention |
| **DuoAttention** | arXiv:2410.10819 | 头维（可学识别） | retrieval head vs streaming head 二分 | MHA 模型显存降 **2.55 倍**、解码提速 **2.18 倍**；叠量化单卡 3.3M |

### 4.1 StreamingLLM：attention sink 现象

观察：朴素滑窗在文本长度超窗长时 PPL 爆炸；但**保留最开头 4 个 token**
就能基本恢复——这些 token 语义上不重要，却吸收了大量注意力分数，是
sink（softmax 必须有人接住「不关注任何 token」的情况，开头 token 成了
垃圾场）。方案：sink（4 个）+ 最近滑窗，常数显存跑「无限」流式；稳定
跑到 400 万 token，相比滑窗重算提速 22.2 倍。

**面试主动指出短板，否则被追问击穿：StreamingLLM 保的是困惑度不炸，
不等于保长上下文检索能力**——中间信息丢了就是丢了。

### 4.2 H2O：Heavy Hitter 驱逐策略

观察：少数 token（heavy hitter）贡献绝大多数注意力分数，与文本高频共现
强相关；删掉它们性能显著退化。方案：每个解码步按累计注意力分数驱逐，
缓存 = 最近 token + heavy hitter 的动态平衡；被形式化为 dynamic
submodular 问题并给了理论保证（驱散派里少有的带证明的）。数字锚：20%
heavy hitter 预算；相对 DeepSpeed Zero-Inference / HF Accelerate / FlexGen
吞吐最高 **29 倍 / 29 倍 / 3 倍**（OPT-6.7B/30B 口径）；同 batch 延迟降
1.9 倍。

### 4.3 SnapKV：prefill 末端「观察窗」一次性压缩

观察：生成期的注意力模式（每个头聚焦 prompt 哪些位置）可以用 prompt
**末尾一段观察窗（observation window）上的注意力分布预测**——模型「在
生成前就知道自己要找什么」。方案：prefill 时用观察窗打分，给每个头选出
成簇的重要 KV 位置（clustered pooling 保持局部连续性），只留这些 + 观察
窗。数字锚：16K 输入上解码速度 **3.6 倍**、显存占用约 **1/8.2**；单卡
A100-80GB 用 HF 实现跑 380K；Needle-in-a-Haystack 精度损失可忽略。

工程注：SnapKV 压缩的是 **prompt 阶段**，生成出的 token 全留——天然
适合长 prompt 场景，与 prefill-bound 的 RAG / agent 工作负载契合。

### 4.4 PyramidKV：层间金字塔分配

观察：层越低注意力越分散，层越高越聚焦少数 token（massive activation /
sink），信息是「金字塔漏斗式」聚合。方案：按层分配 KV 预算——**低层
多留、高层少留**，而不是所有层统一预算。数字锚：只留 **12%** KV 即可
对齐全量 KV 的 LongBench；极限省到 **0.7%** KV 时仍超其他压缩方法，
TREC 上最高 +20.5 绝对精度；LLaMA-3-70B 只留 128 条 KV 即可在 Needle
测试拿满分。面试点：把「留多少」从单一数字变成**逐层曲线的预算分配
问题**——与 MiKV 的「位宽预算」视角平行。

### 4.5 RazorAttention → DuoAttention：粒度换到头维

RazorAttention 的观察：绝大多数注意力头只看局部上下文；少数 retrieval
head 才真正看全量输入、能检索远端信息。方案：retrieval head 保全量 KV，
非 retrieval head 丢远端只留局部 + compensation token 机制挽回信息。数字
锚：KV 显存降 70%+ 无明显退化；training-free、兼容 FlashAttention，即插
即用。**视角从「哪些 token 重要」换成「哪些头需要看全局」**，开启了头
级压缩维度。

DuoAttention 同源但更系统：把头分成 **Retrieval Head**（必须全量看所有
token）与 **Streaming Head**（只看最近 + sink，常数缓存就够）；头的分类
不是人挑的，用**轻量优化算法 + 合成数据自动识别**（与 RazorAttention 的
关键工程差异：可学、可调）。数字锚：MHA 模型显存降 **2.55 倍**、解码提
速 **2.18 倍**、prefill 提速 **1.73 倍**；GQA 模型显存降 **1.67 倍**、解码
提速 **1.50 倍**；**与量化叠加**：Llama-3-8B 单卡 A100 解码 **330 万
token** 上下文（combined with quantization——量化×驱散叠加的教科书
案例，详见第六节）。

### 4.6 谱系一句话口播

StreamingLLM 发现 sink（2023.09）→ H2O 按注意力分驱逐（2023.06，理论
保证）→ SnapKV 用观察窗预测重要位置、prefill 阶段压缩（2024.04）→
PyramidKV 按层分配预算（2024.06）→ RazorAttention / DuoAttention 把粒度
从 token 换到头（2024.07 / 2024.10，后者可训练识别头）。**演进轴：粒度
序列维 → 层维 → 头维；识别方式固定规则 → 启发式 → 可学。**

## 五、工程落地：vLLM / SGLang 的 FP8 KV 与 MLA 时代

### 5.1 vLLM：开关清单（官方文档 2026-10 口径）

- `kv_cache_dtype` 取值：`auto`（默认，跟模型 dtype）/ `fp8` / `fp8_e4m3`
  （CUDA 11.8+ 及 ROCm）/ `fp8_e5m2`（CUDA 11.8+）。
- **两种 scale 方案**：per-tensor（q/k/v 各一个 scale）与
  per-attention-head（q 按注意力头、k/v 按 KV 头分 scale）；后者仅 Flash
  Attention 后端 + 需要 llm-compressor 校准路径。
- **三种 scale 来源**：无校准（默认全 1.0，最方便也最糙）→ 数据集校准
  （官方标 Recommended，512 条 ultrachat 级别样本一次标定，llm-compressor
  oneshot 出 checkpoint）。
- **跳层开关** `--kv-cache-dtype-skip-layers`：可以按层号或按层类型（如
  sliding_window）把敏感层留在原生 dtype——官方原话「Some attention layer
  types (e.g. sliding-window) are more sensitive to KV-cache quantization」，
  与第四节滑窗/sink 敏感性的学术观察完全互证。
- **重要 kernel 细节**：Flash Attention 3 后端 + FP8 KV 时，attention 在
  **FP8 域内计算，Q 也会量化到 FP8**——不是「存 FP8 算 BF16」，而是全
  链路 FP8；其他后端是加载时反量化。精度账要把 Q 一起算。

### 5.2 SGLang：sm100 静默错配坑（部署坑位一号）

- `--kv-cache-dtype` 支持 `auto` / `fp8_e5m2` / `fp8_e4m3`。
- 前沿形态（sm100 专用 M3 fp8 注意力路径）：fp8_e4m3 主 + index KV
  cache、fp8-cast q、fp8 稀疏/MSA kernel，需要 trtllm_mha 后端 + SM100
  （Blackwell）。**e5m2 会静默错配（silently mis-dispatch）到 e4m3
  kernel——格式选错不报错还跑坏**；kill switch：
  `SGLANG_DISABLE_M3_FP8_ATTN_GEMM=1`。
- ModelOpt 路径（hf_ptq.py）支持 `--kv_cache_qformat`（默认 fp8），
  Hopper 以上。

### 5.3 FP8 KV 对 prefix cache 与吞吐的影响（推导口径标注）

- **容量门**：FP8 KV 把同一块 HBM 的 token 容量翻倍 → 显存瓶颈型负载里
  prefix cache 的**有效容量乘 2**，长 prompt 复用场景（agent 多轮、RAG、
  共享系统提示）的命中率提升主要来自这里——**不是 cache 机制变了，是能
  驻留的条目数变了**（机制上前缀缓存按 block 哈希，dtype 透明，无 API
  差异。此条为机制推导，无一手实测数字）。
- **带宽门**：解码每步读 KV 的字节数减半 → memory-bound 的 decode TPOT
  改善；学术侧对应数字是 KIVI 的 2.35~3.47 倍吞吐（2bit 口径，4 倍
  batch）与 SKVQ 的 7 倍 decode（1.5bit V 口径）。**KIVI 数字即「低 bit
  换 batch/吞吐」因果链最直接的证据。**
- **质量门四条坑**（面试四坑位）：① per-tensor 无校准 scale=1.0 最省事
  但最糙，校准后 per-head 才是推荐路径；② sliding-window 层对 KV 量化
  敏感，官方建议 skip；③ fp8_e5m2 vs e4m3 静默错配（SGLang sm100）；
  ④ FA3 后端 Q 也被量化，精度账要一起算。

### 5.4 MLA 下 KV 量化为什么还重要（2026 最有现实感的追问）

MLA（DeepSeek-V2 起）把每 token 的 KV 压成低秩潜向量（相对 GQA 再省一
个数量级），很多人以为「KV 已经这么小不用再量」。反驳四条：

1. **绝对账仍然大**：1M 上下文 × 每层每 token 若干百字节 × 60+ 层仍是
   GB 级起步；百并发 agent 场景线性乘。
2. **厂商用脚投票是最硬的证据**：DeepSeek FlashMLA 官方仓库**原生支持
   FP8 乃至 FP4 的 KV cache**（2026-09 版本：B200 上 FP8/FP4 KV 解码报到
   950~1024 TFlops；2026-09-30 起 V4.1 换新 FP8/FP4 KV 格式，连 fused
   norm-RoPE-attn-RoPE-cast kernel 都把 cast-to-FP8 融进 attention 主
   kernel——**量化不再是后处理，而是 attention kernel 的出站动作**）。
3. **MLA + 稀疏（DSA）省的是算不是存**：top-k 集合随 query 漂移，全量
   KV 仍要可寻址驻留（[长上下文篇](./长上下文推理与kv体系.md)的「省算
   不省存」结论接进本篇的接线点）——MLA 时代的存储刀只剩两把：**位宽
   （FP8/FP4 KV）与分层 offload**。
4. **口播版**：MLA 把每 token 的 KV 从 MB 压到 KB，FP8/FP4 再砍 2~4
   倍——省的是同一个线性项的常数，长上下文 × 高并发下这个常数决定
   单卡能塞几条会话。**MLA 不是 KV 量化的终点而是新起点。**

## 六、面试题两组

### 6.1 题一：「KV 压缩省下的显存能换多少并发？」——换算账模板

公式（与 [基础模块 KV 公式](../llm基础/transformer与attention.md#四kv-cache-原理与显存估算)同源）：

```text
每 token KV 字节 = 2(K,V) × 层数 L × KV 头数 H × head_dim × 精度字节 b
可并发会话数 ≈ 可用 KV 池显存 ÷ (每 token KV × 平均上下文长度)
```

**例 A（Llama-3-8B，GQA：L=32，H_kv=8，head_dim=128。算术为公式推导
口径，非实测）**：

- BF16 每 token KV = 2×32×8×128×2B = 131,072 B **约 128 KiB**；
- 一张 80G 卡：权重 BF16 约 16 GB，留给 KV 约 55 GiB → BF16 装 **约 45 万
  token**，按 16K 均值会话 **约 27 条**；
- FP8（b=1）：token 容量乘 2 = 90 万 → **约 54 条**；
- 学术极限 2bit（论文级 KIVI/SKVQ）：乘 8 = 360 万 token **约 220 条**——
  引擎生产环境罕开到 2bit，此数只用于展示「线性可换算」。
- **口径一句话：FP8 KV = 同卡并发乘 2，或同并发下上下文上限乘 2**——
  省下的 byte 全换成 token，线性项没有常数损耗（KV 池几乎全是 KV）。

**例 B（论文锚点，串起来讲）**：KVQuant 单卡 A100-80G 撑 1M（3.2bit 有
效位宽）→ SKVQ 单卡 1M 且 decode 7 倍 → DuoAttention+量化单卡 3.3M。
「**量化一个数量级、驱散再一个数量级，乘起来就是论文里单卡百万级上下
文的来源。**」

**加分项（反线性陷阱）**：batch 翻倍后 compute 占比上升，decode 不永远
memory-bound，吞吐收益**小于线性**——KIVI 实测 4 倍 batch 只换到
2.35~3.47 倍吞吐而非 4 倍，正好可当证据；prefix cache 场景下「并发收
益」也表现为命中率（见 5.3 容量门）。

### 6.2 题二：「量化与驱散能不能叠加？」

**答案：能，且是谱系演进的自然终点。** 三种叠加形态：

1. **MiKV 形态**（arXiv:2402.18096）：位宽本身就是驱逐的连续化——重要
   token 高位、被「驱逐级」的 token 极低 bit 保残；论文证明留低 bit 信息
   能修复硬驱逐带来的幻觉/上下文丢失。**不是能不能，而是本来就该一体
   设计。**
2. **DuoAttention 形态**（arXiv:2410.10819）：头级驱散 × 位宽量化叠加，
   官方数字 = Llama-3-8B 单卡 A100 3.3M 上下文。工程上最常被引用的
   叠加案例。
3. **残窗互补形态**：KIVI/SKVQ 的 FP16 残窗（最近 token 不量）+
   StreamingLLM 的 sink+滑窗（远处 token 不留）可以共存——最近 token
   两头都要保；远处 token 逐掉；中间 token 低 bit 存。一张图就是「位宽
   × 保留率」平面上的预算分配：**越重要越近 F16，次重要低 bit，不重要
   0 bit 逐掉。**

**叠加的三条约束**（答出即加分）：

- 驱散在序列维破坏的是 prefix cache 的连续性假设（被逐块 hash 前缀变
  花），量化在 dtype 维对缓存透明——**叠加时驱散逻辑离缓存层越近坑
  越多**；
- Q 同时量化（vLLM FA3 路径）叠加检索头策略时，retrieval head 的精度
  损失会放大长程检索退化——叠加方案要在 Needle 类检索基准上**单独
  测**；
- 数值上 attention 对驱散后残存 KV 做 softmax，量化误差与缺失信息的
  误差**不是简单加性，实测大于理论**（IntactKV 提供的是误差上界的理论
  工具，面试可提）。

## 口径与未核实说明

1. **例 A 的全部算术为公式推导**（参数取自 Llama-3-8B 公开配置），非
   实测；55 GiB KV 池为典型预留口径。
2. 「**prefix cache 命中率提升来自容量翻倍**」为机制推导，无一手实测
   数字；引擎侧 dtype 对 prefix cache 透明为源码事实。
3. **MiKV / IntactKV 的具体量化位宽**摘要未给，正文按摘要口径未标具体
   bit 数；需精确位宽应翻 PDF 正文补。
4. **FlashMLA 数字**（950~1024 TFlops、V4.1 FP8/FP4 新格式、fused
   norm-RoPE-attn-RoPE-cast）按官方仓库 README 2026-09 版本口径；
   DSA 稀疏 kernel 配 FP8 decode 为 2025-09-29 提交口径。
5. **vLLM / SGLang 开关**按官方文档与 main 分支 server_args.py 2026-10
   核实；e5m2 静默错配为官方文档原文（would silently mis-dispatch）。
6. 全部论文数字（3.2bit / 2.6 倍 / 2.35~3.47 倍 / 7 倍 / 400 万 / 29 倍 /
   12% / 0.7% / 70%+ / 2.55 倍 / 3.3M）为 arXiv 摘要口径，未逐一翻正文
   核验实验设置。

## 串联阅读

- [长上下文推理与 KV 多级体系](./长上下文推理与kv体系.md)：KV 总量账与
  「稀疏省算不省存」的分家——本篇的上游，5.4 节 MLA 论证的接线点。
- [kv-offload 与分层存储专题](./kv-offload与分层存储专题.md)：压缩之外的
  另一条存路（挪走存）；面试常把「压低/逐掉/挪走」三选一做对比题。
- [量化与压缩](./量化与压缩.md)：权重量化主线（GPTQ/AWQ/FP8/W4）与 KV
  量化第一节课；本篇是它的 KV 侧深挖。
- [vllm 与推理加速核心](./vllm与推理加速核心.md)：Prefill/Decode 与
  PagedAttention 底座——理解「KV 池几乎全是 KV」的调度背景。
- [稀疏注意力专题](./稀疏注意力专题.md)与
  [注意力变体 2026 专题](./注意力变体2026专题.md)：DSA/NSA/MoBA 与
  MLA/GQA 的架构侧——「省算」两把刀，与本篇「省存」两把刀互为镜像。
- [推理调度专题](./推理调度专题.md)：continuous batching 与 batch 上限—
  —并发换算账（6.1）的调度语境。
- [agentic-serving 专题](./agentic-serving专题.md)：agent 多轮、长前缀复
  用负载，正是 FP8 KV 容量门与 prefix cache 收益最大的场景。
