# CUDA 与算子 Kernel 专题：FA 谱系、decode kernel 族与融合方法论

> 面向：AI Infra 岗口试的 kernel 体系梳理。读完你会获得：FlashAttention
> 四代演进的标准答法（每一代「诊断 → 改动 → 数字」三段式）、decode 侧
> 四个 kernel 的定位差异表、Triton 选型矩阵、roofline 融合判据，以及
> 10 条高频追问的要点卡片。
>
> 本篇是**口试体系篇**：只讲"为什么"和"怎么答"，凡涉及代码骨架处一律
> 挂到 [coding/工程手撕/cuda算子手撕.md](../coding/工程手撕/cuda算子手撕.md)，
> 不重复默写。时效口径：2022–2026 的 kernel 谱系——FA1（2022）→
> FA2（2023）→ FA3（2024）→ FA4（2026-03 发布，截至 2026-10 仍
> beta 周更），decode 侧 Flash-Decoding（2023）→ FlashMLA /
> FlashInfer / FlashDecoding++。

<div class="diagram-embed">
<iframe src="assets/diagrams/cuda-kernel-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/cuda-kernel-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、直觉：attention 是访存问题，不是算力问题

先把面试官预期的那层窗户纸捅破：标准 attention 要的 FLOPs 不多，
但它要在 HBM（全局显存）和 SRAM（片上共享内存）之间搬进搬出
N×N 的中间矩阵 S 和 P。HBM 比 SRAM 慢一个数量级以上，所以
**瓶颈在访存不在算力**——这是整个 FlashAttention 谱系的出发点。

另一条同样重要的直觉：**GEMM 快不等于 attention 快——exp 的 SFU
只有 Tensor Core 的 1/256**。H100 峰值 **989 TFLOPs**（FP16 密集），
而 exp 走的 SFU 单元只有约 **3.9 TFLOPs**，差 256 倍（FA3 blog 引
官方 SPEC，2024）。所以 attention kernel 的优化史，一半是在躲
HBM 访存，一半是在躲 SFU 上的 exp。

记住这两条直觉，后面四代 FA 的每一步改动都能"推出来"而不是"背出来"。

## 二、FA 谱系四代：跟着硬件特性走

四代 FlashAttention 的演进逻辑一句话概括：**每一代都是先诊断
"这一代硬件上还剩什么没吃到"，然后做针对性改动**。卡片模板统一为
「诊断 → 改动 → 数字」，面试逐代背。

### 2.1 FA1（2022）：IO 复杂度是主角

**诊断**：标准 attention 访存受限，优化目标 = 最小化 HBM 访存次数。

**三件套改动**：

- **Tiling 分块**：Q/K/V 分块搬进 SRAM，逐块算 attention，避免整行
  N×N 矩阵落到 HBM；
- **Online softmax**：维护 running max 和 running sum，增量 rescale，
  一次 pass 算出与"先存 S 再归一化"数学等价的结果——中间矩阵
  S/P 永远不写回；
- **重计算换显存**：backward 不存 S/P，用到时现场重算，
  激活显存从 O(N²) 降到 O(N)。

**IO 复杂度账**（追问常客）：

```text
标准 attention：Θ(N·d + N²) 次 HBM 访存 —— N² 项是存取 S/P 的代价
FA1：            Θ(N²d²/M) 次，M = SRAM 大小
                 M 典型 100+ KB 时，访存量直接除以几十到上百
```

一句话总结："**不存 N×N 中间矩阵**是唯一的大赢家"——其他优化都
是围绕怎么把 S/P 摁在 SRAM 里。数字侧：端到端 **2–4× 提速** vs
优化基线，BERT-large 训练节省 15% wallclock，GPT-2 训练 3×
（arXiv:2205.14135, 2022）；还有外部性收益——16K/64K 的 Path-X/
Path-256 长序列基准首次变得可训练。

但 FA1 也有短板：只跑到 **峰值 25–40% 的水平**（FA2 论文自述，
arXiv:2307.08691, 2023）——这正好是下一代的弹药。

### 2.2 FA2（2023）：分工问题，不是新问题

**诊断**：FA1 的 block/warp 级分工不合理，SM 没有占满。

**三大改动**：

1. **减少非 matmul FLOPs**：调整 online softmax 的更新顺序，
   把归一化延迟到循环末尾，省掉每个分块一次的除法；
2. **并行度**：在 batch × heads 之外，把 seq_len 维度也按 Q block
   切出来并行——解决"长序列小 batch 时 SM 占不满"；
3. **warp 分工**：QK^T 放在外循环切片，每个 warp 处理不同的 Q 行段，
   自己完成该段的 softmax 和 PV，**避免 warp 之间经 SMEM 交换
   S/P**。

**循环顺序追问**：FA1 是"外 KV 内 Q"，FA2 翻成"外 Q 内 KV"——
这是被点名单独追的常客，别搞反。

数字：**约 2× vs FA1，A100 峰值 50–73%，训练 225 TFLOPs/s
每张 A100（72% MFU）**（arXiv:2307.08691, 2023）。

### 2.3 FA3（2024）：Hopper 三件套

**诊断**：FA2 搬到 H100 只有约 **350 TFLOPs，仅 35% 峰值**（FA3 blog
自述，tridao.me, 2024）——因为 FA2 的串行写法吃不到 Hopper 的异步性。

**三大改动**（答"FA3 用了 Hopper 哪些特性"照此展开）：

1. **WGMMA + TMA + warp specialization**：producer warp 发 TMA
   搬运数据、consumer warpgroup 发 WGMMA 算 GEMM，利用异步性
   做"计算-搬运"重叠；**pingpong 调度**让两个 warpgroup 交替
   GEMM/softmax（吞吐 350 → 540–570 → 约 620，FA3 blog 拆解口径，
   2024）；
2. **intra-warpgroup 交叠**：把 softmax 藏进下一次迭代 GEMM 的
   阴影里（→ 640–660 TFLOPs），代价是寄存器压力上升；
3. **FP8 + incoherent processing**：Q/K 乘随机 Hadamard 正交阵
   打散 outlier 再量化，FP8 误差比基线低 **2.6 倍**（
   arXiv:2407.08608, 2024）；Hadamard 是 O(d log d) 访存受限变换，
   可与 RoPE 免费融合。

数字：H100 FP16 最高 **740 TFLOPs / 75% 利用率**（
arXiv:2407.08608, 2024），**1.5–2.0× vs FA2**，FP8 接近
**1.2 PFLOPs**。

帧外知识点（面试官爱问"为什么不再多榨一点"）：hd128 时 GEMM 的
FLOPs 是 exp 的 512 倍，**exp 仍可占 50% 时间**（FA3 论文脚注口径，
2024）——Hopper 上前向瓶颈其实是 SFU 不是 Tensor Core。

### 2.4 FA4（2026-03）：Blackwell 的不对称扩展

**口径说明**：FA4 无 arXiv 论文，以下引 Together AI blog
（2026-03-05）；工程形态为全 CuTeDSL 重写，截至 2026-10 仍 beta
周更（fa4-v4.0.0.beta34，2026-10-07）。

**诊断**：Blackwell 是**不对称扩展**——Tensor Core 从 1 跳到约
2.25 PFLOPs，但 SFU 吞吐和 SMEM 带宽几乎没变。FA3 的均衡设计
在 B200 上重新失衡。

**前向改动**：

- 每个 CTA 两个 Q tile ping-pong，两个 softmax warpgroup **显式
  同步**避免同时算 exp（减少 MUFU 争抢）；
- **软件模拟 2^x**：Cody-Waite 区间规约 + Horner 三阶多项式在
  FMA 上算 exp，把工作摊给 MUFU + FMA 两路，绕开 SFU 瓶颈；
- S/P 分段写回 **TMEM**（Blackwell 新增 256 KB/SM），直接伺候
  Tensor Core；
- **conditional online softmax rescaling**：max 跳变超过阈值 τ 才
  rescale，把 correction warpgroup 从关键路径摘出去。

**反向改动**：

- 中间结果存 TMEM 给 SMEM 减压（**反向瓶颈在 SMEM 流量**，
  FA4 feeds-and-speeds 口径，2026）；
- **2-CTA MMA**：CTA 对共享 256×256×16 的 UMMA，B 操作数
  SMEM 流量减半、global atomic 减半；
- dQ 归约轴冲突用 cluster 内 DSMEM 交换 dS；
- **确定性模式**（semaphore + fence）：吞吐保留约 85–90%，
  RLHF/复现实验场景直接用。

数字：B200 BF16 最高 **1605 TFLOPs / 71% 利用率**，比 cuDNN 9.13
快 **1.1–1.3×**、比 Triton 实现快 **2.1–2.7×**（ Together AI blog
口径，2026-03）；部分技术已回流 cuDNN 9.13/9.14；全量 CuTeDSL
让编译比 C++ 模板快 **20–30×** 。

§2 收口一句话：Hopper 上前向瓶颈是 SFU，Blackwell 上前向仍受
exp 制约、反向瓶颈变成 SMEM 流量——**瓶颈叙事必须跟着芯片代际
更新**，这是比背数字更值钱的答法。

## 三、decode kernel 族：自成一派

prefill/训练用的 FA 谱系解决不了 decode 的专属问题：q_len=1、
batch 小时 SM 占用率不到 1%，**decode 的瓶颈从算力变成带宽+调度**。
于是 decode 侧长出了另一族 kernel：

| kernel | 核心机制 | 关键数字（来源） | 定位 |
|---|---|---|---|
| Flash-Decoding（2023-11，PyTorch blog） | split-KV：增开 KV 维并行 + log-sum-exp 合并归约 | 端到端最高 8×；64K seq batch=1 时 attention 2300μs→64μs（最高 50× vs FA2） | decode 并行化的开山 |
| FlashMLA（DeepSeek） | MLA 共享 latent KV，打满带宽的 decode kernel | H800 3000 GB/s 打满（2025-02）；B200 稠密 fwd 1460 TFLOPs（README 2025-08） | MLA 专用 |
| FlashInfer（arXiv:2501.01005，MLSys 2025） | JIT 可定制 attention 引擎 + CUDAGraph 兼容 plan | ITL 降 29–69%；长上下文延迟降 28–30% | 服务侧通用引擎 |
| FlashDecoding++（arXiv:2311.01282，2023） | 统一 max 免同步 softmax + flat GEMM 优化 | vs HF 最高 4.86×（NVIDIA）/2.18×（AMD）；partial softmax 同步约占 attention 20% | 论文口径研究线 |

各家展开一句话：

- **Flash-Decoding**：decode 时 q=1，FA 的 Q 维并行名存实亡，
  于是把 KV 也切开（split-KV），各 split 算完用 log-sum-exp
  合并归约——**把空转的 SM 喂满**。
- **FlashMLA**：MLA 架构下 K/V 共享 latent，访存模式又不一样；
  它把带宽打满。口径要**带日期**：README 2026-09 已移除 Hopper、
  聚焦 SM100 + 昇腾 950（2026-09-30 口径为昇腾 950 稀疏 prefill
  410 / decode 360 TFLOPs）——kernel 跟芯片代际走，release note
  是铁证。融合版一次融 Q-norm + Q-RoPE + attention + O-RoPE
  conjugate + cast-FP8：prefill 1460 / decode 950 TFLOPs（README
  2025-08/2026-09）。
- **FlashInfer**：attention 的"最后一公里通用化"——block-sparse、
  KV 异构、JIT 可定制 template，plan 阶段在 **GPU 上算调度元数据**
  保 CUDAGraph 兼容；已进入 SGLang/vLLM/MLC。
- **FlashDecoding++：三个痛点**——partial softmax 同步约 20%、
  flat GEMM padding 浪费超 50%、静态 dataflow 不适配 shape；
  核心招是**统一 max 免同步**：各 split 用预设常数替代局部 max，
  归约层统一修正。这是"用数学等价性换掉一次硬件同步"的典型例
  （与 MTP verify、RoPE 融合同属"免同步/免中间张量"方法论）。
  注意口径：按论文叙述，不说"已合并进主流引擎"。

场景话术收口："**训练多 query 用 FA、服务 decode 用
FlashInfer/FlashMLA**；MLA 架构专用 FlashMLA；要 JIT 可定制
+ CUDAGraph 用 FlashInfer。"

## 四、Triton 体系与选型矩阵

**Triton 的护城河是开发效率与可融合性，不是峰值性能。**

体系定位：CUDA 需要手工管 coalescing、SMEM staging 和 SM 内调度，
Triton 全自动（SM 间调度两家都手工）。抽象单位是 **power-of-2
block 而非 SIMT thread**，用 program_id 做网格启动。自动优化包括：
tl.dot 操作数自动 stash 进 SMEM、tl.load 的 mask + other 自动越界
谓词、block 内部自动按 SIMD 分块；Triton-IR 基于 LLVM。

官方基线数字：**约 25 行 FP16 GEMM 追平 cuBLAS；fused kernel
最高 2× vs Torch**（OpenAI blog, 2021-07）。但前沿 attention
差距明显——FA4 比 Triton 实现快 **2.1–2.7×**（Together AI blog，
2026-03）。

**什么时候该用 / 不该用**（选型矩阵，背这个表）：

| 场景 | 选择 | 原因 |
|---|---|---|
| GEMM 变体（dequant-GEMM、GEMM+SwiGLU） | Triton | epilogue/prologue 融合方便 |
| fused elementwise/reduce（RMSNorm+quant、RoPE、softmax+log） | Triton | 消除中间张量，两周的活变两天 |
| 低中算力形状的长尾算子 | Triton | 值不当手写 CUDA 的成本 |
| torch.compile 默认后端 | Triton | 生态默认 |
| FA3/FA4 级流水线（warp specialization/TMEM/2-CTA MMA） | CUDA/CUTLASS/CuTeDSL | Triton 表达不了这个细度 |
| NCCL 级通信融合、PTX escape、persistent + 精准寄存器预算 | CUDA | 同上 |

金句收尾：长尾算子用 Triton 消灭中间张量，头部算子留给 CUDA
无限优化。追问"那为什么 Tri Dao 都转 CuTeDSL 了"——答：Hopper/
Blackwell 的细颗粒特性（warp spec、TMEM、2-CTA MMA）Triton-IR
表达不了，Gluon 是补救方向，但前沿 attention 已经流向 CUDA 系。

## 五、算子融合方法论：roofline 判据 → launch 开销 → CUDA Graph

### 5.1 roofline 判据：先算账再融合

算术强度 AI = FLOPs / 访存字节数；机器的 ridge point，以 H100
FP16 为例约 **989T ÷ 3.35 TB/s ≈ 295 FLOPs/byte**。

- **两个访存受限算子串联，融合收益最大**——中间结果不落地，
  各省一次 HBM 往返；
- **算力受限的 GEMM 融合收益在 epilogue**：accumulator 还在
  寄存器时顺手做 bias/激活/residual/cast（epilogue = 输出侧后
  处理；prologue = 输入侧预处理，如 dequant/Hadamard/RoPE，
  随 GEMM 流水完成）。

高频融合组合（给例子证明你做过）：RMSNorm + FP8 quant、
QK-norm + RoPE、SwiGLU、GEMM + bias + GELU、attention 后
cast-FP8。

### 5.2 launch 开销：kernel 太小，CPU 先顶不住

口径只给定性 + 实例：当每个 op 的执行缩到几 μs 量级，**CPU 侧
launch 开销成为瓶颈**（PyTorch 官方 blog 定性口径，2021-10）；
MLPerf 实测 backbone 从 **31ms 压到 6ms**（约 5×，PyTorch blog，
2021-10）。不背具体 μs 数，被追问就说"我没有精确的一级测量数字，
但官方口径是 μs 级 kernel 下 launch 开销主导"。

### 5.3 CUDA Graph：整图一次 launch

- **消了什么**：一次 cudaGraphLaunch 跳过 Python/C++/驱动三层
  dispatch；Mask R-CNN 端到端 1.70×、BERT 1.12×（PyTorch blog，
  2021-10）；
- **代价**：形状与控制流静态（dynamic shape 需 padding/mask）、
  输入输出地址固定、必须消除 CPU→GPU 同步点（如 .item()）；
- **服务端配套**：FlashInfer 的 GPU 侧 plan（调度元数据在 GPU 上
  算）保住 CUDAGraph 兼容；
- **与融合正交**：**CUDA Graph 消 kernel 间空隙，融合消 kernel
  内部访存**——两者收益可叠加，别混为一谈。
- 谁最受益：大量短 kernel 的 workload——**decode 循环每层几十
  个小 kernel**，这正是推理引擎全面接入 CUDA Graph 的原因。

### 5.4 什么时候不融合（反向加分项）

- 寄存器 / SMEM 占用升高可能**拉低 occupancy**，融完反而更慢；
- 融合 kernel 失去独立调优自由度——两个高频调用点的最优 tile
  不一致时，硬融会两头妥协；
- 结论话术："融不融看 roofline，融完看 occupancy，能不能进
  Graph 看同步点。"

## 六、口试常撕三大件：骨架要点（代码不重复）

以下三题是手撕现场出场率最高的；代码与逐步讲解一律挂到
[cuda算子手撕.md](../coding/工程手撕/cuda算子手撕.md)，这里只留
骨架要点防遗忘（代码详见 cuda算子手撕.md）：

1. **Softmax / Online softmax**：先减 running max（数学恒等式，
   稳数值不动结果），running m/l 更新式 + 分子分母同步 rescale；
   变体要能随口展开：减 max 求稳、统一 max 免同步；backward
   靠重计算不存 S/P。代码详见 cuda算子手撕.md。
2. **LayerNorm / RMSNorm**：一行一个 block + warp shuffle
   block reduce；**RMS 少一次均值归约、无 bias**，数学等价性
   基本保留——推理侧每省一次 reduce 就省一次同步，这就是大模型
   全面换 RMSNorm 的原因。追问 fusion 方向：与 quant/residual
   融成单 kernel。代码详见 cuda算子手撕.md。
3. **GEMM 骨架**：三级分块（block/warp/thread）+ double buffer
   + cp.async/TMA 预取 + swizzle 消 bank conflict + **FP32
   accumulator** + epilogue 顺手后处理。**occupancy 三限**
   （寄存器 / SMEM / block 数）取最小；bank conflict 的标准描述：
   32 bank × 4B，连续访问免冲突，访问重叠会重放。代码详见
   cuda算子手撕.md。

## 七、kernel 精度议题：FP32 累加、FP8 校准、确定性

- **FP32 accumulate 是铁律**：bf16/fp16 的所有 reduce 必须 FP32
  累加（tl.dot 的 accumulator 默认就是 FP32）；手撕时不写
  float 累加直接丢分。
- **数值稳定 softmax 必须减 running max**；加分点：大声说出
  "减 max 是数学恒等式，不改结果，只改溢出风险"。
- **FP8 校准两条路径**：算法侧 incoherent processing（Hadamard
  正交阵打散 outlier，FA3 FP8 误差低 2.6 倍，2024）+ 工程侧
  block quantization（逐 tile 独立 scale）；Hadamard 可与 RoPE
  免费融合。追问"为什么不直接 cast 到 FP8"：答 outlier + 小
  动态范围，直接 cast 会把有效位数全喂给异常值。
- **确定性**：FA4 提供 deterministic mode（semaphore + fence，
  吞吐约 85–90%，Together AI blog 2026-03）——RLHF、复现实验、
  盘点 numerics bug 时必考；注意**确定为研报了代价而不是免费**。

## 八、▶ 面试题 10 条

**Q1【极高】FA1 为什么快？IO 复杂度怎么算？**
答法：先定性"访存受限优先"，再报三件套（tiling + online softmax +
backward 重计算）；IO 账 Θ(N·d + N²) → Θ(N²d²/M)；收口：
"不存 N×N 中间矩阵是唯一大赢家"。数字兜底：2–4× vs 优化基线
（arXiv:2205.14135, 2022）。

**Q2【极高】online softmax 推导 / 单 pass 写一遍。**
running m/l 增量更新：新块进来先合并 max，分子分母同步 rescale
到新 max 尺度；变体口径齐活：减 max 求稳（数学恒等式）、统一
max 免同步（FlashDecoding++）；backward 重计算不存 S/P 换 O(N)
显存。代码详见 cuda算子手撕.md。

**Q3【极高】FA1→FA2 改了什么？**
三件事：减非 matmul FLOPs（延迟归一化）、seq 维度并行补 occupancy、
warp 分工去掉 S/P 的 SMEM 交换；循环方向翻转——外 KV 内 Q →
外 Q 内 KV。数字链：峰值 25–40% → 50–73%，训练 225 TFLOPs/s
每张 A100（arXiv:2307.08691, 2023）。

**Q4【高】FA3 用了 Hopper 哪些特性？**
WGMMA/TMA/FP8；warp specialization + pingpong + intra-warpgroup
overlap 三件套，吞吐拆解 350 → 540–570 → 620 → 640–660；帧外线
是 exp 的 SFU 只有 Tensor Core 的 1/256。收尾数字：
**740 TFLOPs / 75% 利用率**（arXiv:2407.08608, 2024）。

**Q5【高】FA / Flash-Decoding / FlashInfer / FlashMLA 什么关系？**
训练和多 query 场景用 FA；decode q=1 时 SM 空转严重，用 split-KV
开新并行维（Flash-Decoding）；生产服务要 JIT 可定制 + CUDAGraph
兼容 plan，用 FlashInfer（ITL −29–69%，MLSys 2025）；MLA 架构
专用 FlashMLA（带宽打满口径）。话术收口：decode 的瓶颈从算力
变成带宽+调度。

**Q6【高】Triton 什么时候该用 / 不该用？**
用：GEMM 变体、epilogue/prologue 融合、长尾 elementwise/reduce、
torch.compile 生态；不用：前沿 attention（FA3/FA4 级流水线）、
通信融合、TMEM/2-CTA/persistent 细控。必须答出抽象差：**block
抽象 vs SIMT thread**。基线数字：约 25 行 GEMM 追平 cuBLAS
（OpenAI blog, 2021）；前沿差距 2.1–2.7×（2026-03）。

**Q7【中高】怎么写高效 GEMM？occupancy 怎么算？**
三级分块 + double buffer + cp.async/TMA + swizzle 消 bank conflict
+ FP32 accumulator + epilogue；occupancy = 寄存器限 / SMEM 限 /
block 数限取最小；bank conflict 标准口径：32 bank × 4B 连续访问，
冲突会序列化重放。骨架详见 cuda算子手撕.md。

**Q8【中高】为什么大模型用 RMSNorm 不用 LayerNorm？**
少一次均值归约 + 无 bias，数学等价性在实践中基本保留；从 kernel
视角：**每省一次 reduce 就少一发全局同步**，推理侧 warm path
极其敏感，这是 RMSNorm 全面胜出的工程解释。

**Q9【中】CUDA Graph 消了什么开销？**
跳过 Python/C++/驱动三层 dispatch，整图一次 cudaGraphLaunch；
实例：MLPerf backbone 31ms→6ms、Mask R-CNN 1.70×（PyTorch blog，
2021-10）。代价三件套：静态形状、静态 buffer、去掉同步点；
服务端 FlashInfer GPU 侧 plan 保兼容。备用定位：回答"为什么
eager 模式跑不满 GPU"的标准答案。

**Q10【中】FP8 attention 怎么保精度？**
算法侧 incoherent processing：Q/K 乘 Hadamard 正交阵打散 outlier
（O(d log d)，可与 RoPE 免费融合）；工程侧 block quantization
逐 tile scale。数字：FA3 FP8 误差比基线低 2.6 倍（2024）。追问
"为什么不直接 cast"：outlier + 小动态范围，直接 cast 有效位数
全被异常值吃掉。

## 九、串联阅读

- 代码手撕：[coding/工程手撕/cuda算子手撕.md](../coding/工程手撕/cuda算子手撕.md)
  （RMSNorm / Softmax / Online Softmax / SwiGLU 可默写骨架）；
- 硬件直觉：[basics/04-gpu与算力入门.md](../basics/04-gpu与算力入门.md)
  （SM/SMEM/带宽三件套，roofline 的第一课）；
- 引擎侧视角：[inference/vllm与推理加速核心.md](./inference/vllm与推理加速核心.md)
  （kernel 之上：scheduling/batching 怎么再吃一层收益）；
- 2026 动态：[inference/推理引擎2026新进展.md](./inference/推理引擎2026新进展.md)
  （kernel 谱系在 vLLM/SGLang/Dynamo 里的落地形态）；
- 显存算力两面账：[显存计算专题.md](./显存计算专题.md)
  （本篇讲"算得快"，那篇讲"装得下"，配合服用）。
