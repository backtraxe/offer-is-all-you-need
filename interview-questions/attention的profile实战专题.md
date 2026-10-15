# Attention 的 Profile 实战专题：SDPA 四后端在 trace 里长什么样

> 面向已经读过 [Profiling 与性能分析专题](./profiling与性能分析专题.md)
> （工具链与指标口径）与 [推理 Profile 实战专题](./inference/推理profile实战专题.md)
> （推理版六区域读法）的读者。本篇是**工作负载级的读 trace 案例课**：
> 从手写 naive attention 出发，逐个 profile PyTorch SDPA 的四个后端
> （math / efficient / flash / cuDNN），回答三个面试官爱问的问题——
> 「为什么融成一个 kernel 就快」「occupancy 低是不是没优化好」「kernel
> 名字里能读出什么」。
>
> **口径声明**：案例与数字来自 PyTorch 官方 Profiling 系列教程的中文
> 转述（2026-10）及 SDPA 官方文档，均为教程实测口径；不同 GPU/CUDA
> 版本上具体数值会变，方法不变。

## 一、方法论只有一句话：先猜，再看

整个系列的第一习惯：**开 trace 之前，先大声说出你预期看到什么**。
naive attention 的预测清单是五个 kernel：matmul（q·kᵀ）→ mul（缩放）→
mask → softmax → matmul（attn·v）。然后打开 trace，凡是对不上的地方，
就是屏幕上最有价值的东西——本篇所有 insight 都来自「没对上」：
多出来的 Memcpy、20 个 kernel 的 math 后端、flash 不对劲的 13%
occupancy、cuDNN 那条又粗又不透明的 CPU 条。

## 二、naive attention 的第一个「没对上」：多出来的 Memcpy

GPU 道展开，实际是六个 kernel——五个在预期内，**多出一个 memory copy**。
源头是 `masked_fill`：PyTorch 的 out-of-place 操作常先复制一份、在副本
上改、再返回副本。改成 in-place 的 `masked_fill_`（下划线是 PyTorch
约定），CPU op 骤减，GPU 道的 Memcpy 整个消失——**一行改动，每次
forward 少一个 kernel**。单看不起眼，但 attention 每层一次、层数又多，
省的量很快加起来。

in-place 不是免费的：autograd 反向要重放 forward 的张量值，in-place 覆盖
了就读错数。本例安全是因为跑在 `torch.no_grad` 下。**面试口径**：in-place
省时间也省显存（少一次复制），但只在无反向或确认无依赖时可用。

## 三、SDPA：一行代码背后的 dispatch 层

`F.scaled_dot_product_attention(q, k, v, is_causal=True)` 一行顶掉整个
手写 module，但它没有单一实现——底下按 dtype、head dim、mask、硬件
dispatch 到四个后端之一（`torch.nn.attention.SDPBackend` 枚举）。用
`sdpa_kernel` 上下文管理器把后端逐个 pin 死，分别 profile，就是本篇的
实验设计。

## 四、math 后端：慢 3.7 倍的「正确性参考实现」

profiler 表先给一闷棍：naive in-place 版单步 1.955 ms，SDPA math 后端
**7.239 ms，慢约 3.7 倍**；kernel 数从 5 个变成 **20 个**。trace 里三段
原因链：

1. **Tensor Core 空着**。kernel 名是指纹：naive 的 matmul 是 `s16816`
   族（bf16 的 16×8×16 Tensor Core 指令签名），math 后端是 `sgemm`——
   经典 FP32 matmul，跑普通 CUDA core。math 为数值精度把 tensor upcast
   到 FP32（连搬运的数据量都翻倍），根本不碰 Tensor Core。
2. **因果 mask 现场重建**。手写版 mask 建一次复用；`is_causal=True` 在
   math 后端是每次调用现造：`aten::ones` + `aten::tril` 建下三角、
   `aten::fill_` 造 -inf、`aten::where` 转加性偏置，CPU 道上一整串 op。
   **省心的 flag 没省掉活，只是把活挪到了下一层**。
3. **`_safe_softmax` 又多几个 kernel**。全 mask 行（全 -inf）会让普通
   softmax 算出 0/0=NaN，safe 版防这个；naive 版没管，角落 case 会
   悄悄吐 NaN。

合起来：math 后端的存在意义不是快，是**永远能跑**——dtype 安全、NaN
安全、逐 op 可审，是完美的正确性基线。这也是它成为后端的最后一个
选项的原因。

## 五、三个融合后端：20 个 kernel 压成 1 个

| 指标（教程实测） | naive in-place | math | efficient | flash | cuDNN |
|---|---|---|---|---|---|
| 每 forward GPU kernel 数 | 5 | 20 | 1 | 1 | 1 |
| CUDA 平均时间 | 1.955 ms（整步） | 7.239 ms | 277.9 µs | **146.8 µs** | 186.3 µs |
| CPU 平均时间 | — | — | 117 µs | 138 µs | **214 µs** |

- **efficient（xformers 血统）**：一个 `fmha_cutlassF_bf16_aligned_64x64_rf_sm80`
  解决。kernel 名拆开读：fmha=fused multi-head attention；
  cutlassF=基于 CUTLASS 模板库的 forward；bf16_aligned=全程 bf16 不
  upcast；64x64=tile 尺寸；rf=工作集放寄存器堆；sm80=为 Ampere 编译。
- **flash**：一个 `pytorch_flash` kernel，vendored 进 PyTorch 的
  FlashAttention-2。存在理由要回到 math 的问题本质：慢的根源不是 20 个
  kernel，而是 **kernel 之间来回搬运的东西**——[seq,seq] 分数矩阵反复
  读写 HBM。Flash 按 tile 走 K/V、用 online softmax 维护 running 归约，
  **完整分数矩阵永远不写 HBM、只活在片上**——这才是「融合」真正的含义，
  也解释了为什么 attention 优化本质是访存题不是算力题。
- **cuDNN**：也是一个 kernel，但性质不同——`cudnn_generated_fort_native_
  sdpa_sm80_flash_fprop_wmma_f16_knob_6_128x64x64_...`，**按问题生成**，
  不是 vendored 固定二进制：`knob_6` 是它从预调配置里挑的方案，tile
  128x64x64，WMMA f16 走 Tensor Core。所以它换个形状可能赢 flash——
  生成器按问题重调；重调的代价见下节。

## 六、三个反直觉，面试就这考你

**反直觉一：flash 最快，occupancy 却只有 13%——不是没优化好。**
算给你看：每线程约 255 个寄存器 × 128 线程/block = 32,640 寄存器，而
Ampere 一个 SM 共 65,536 个寄存器 → 一个 SM 只住得下两个 block = 8 个
warp（上限 64）≈ 13%。flash 是**故意把 block 做得很重**：寄存器和共享
内存全花在把 attention tile 留在片上、激进复用数据、永不物化完整矩阵。
occupancy 高靠多 warp 藏延迟，但藏延迟≠活干得高效；**这是「低 occupancy
的 kernel 反而最快」的教科书案例**。

**反直觉二：cuDNN 的 0% achieved occupancy 是测量盲区，不是 GPU 卡住。**
cuDNN 走 driver 层的 `cuLaunchKernelEx`（其余全家走 runtime API
`cudaLaunchKernel`），CUPTI 对 driver API launch 的 occupancy 归因
缺失，读出来恒为 0。footprint 说真话：240 寄存器 × 256 线程 = 61,440
寄存器/block → 一个 SM 塞一个 block、8 warp ≈ 12.5%，和 flash 同水平。
**profiler 报的数也可能是工具链的盲区，交叉验证用 kernel footprint。**

**反直觉三：cuDNN 零转置，CPU 反而最贵。**
CPU 道上 flash/efficient 各插 4 个 `aten::transpose` 做布局转换，cuDNN
生成器直接吃原生 [B,H,S,D] 布局、一个转置都没有——但 CPU 时间它最贵
（214 µs vs 138/117）：ATen op 变少不等于 CPU 活变少，**活搬进了库里**，
变成 profiler 拆不开的一条粗杠（运行时 knob 搜索、做 plan 的成本，光
`scaled_dot_product_attention` 的 self 时间就占整轮 26%）。读 trace 的
军规：**trace 突然变干净，活不一定没了，可能只是搬到了你看不见的地方**。

## 七、一张表背下来（面试白板用）

| 变体 | 每 forward kernel 数 | trace 揭穿了什么 |
|---|---|---|
| naive attention | 6 | out-of-place `masked_fill` 藏一个 Memcpy |
| naive + in-place | 5 | 一行改动干掉 Memcpy；`no_grad` 下才安全 |
| SDPA math | 20 | 参考实现：FP32 跑 CUDA core、mask 每次重建、`_safe_softmax`；正确但慢约 3.7 倍 |
| SDPA efficient | 1 | 一个 `fmha_cutlassF` 融合 kernel，全程 bf16 上 Tensor Core |
| SDPA flash | 1 | 一个 `pytorch_flash`（FA2）；13% occupancy 是设计不是缺陷 |
| SDPA cuDNN | 1 | 按问题生成的 kernel；零转置但 CPU 最重，成本在 knob 搜索 |

## 八、▶ 面试题与追问

**Q1【高】为什么融合 kernel 快？真的是因为「少调用几次」吗？**
不是 launch 次数本身，是 **kernel 之间的 HBM 往返没了**。math 后端的
[seq,seq] 分数矩阵要写出、读回、再写、再读好几个来回；flash 用 online
softmax 让分母跟着 tile 走，中间矩阵全程不进 HBM。attention 是访存
bound，融合的收益 ≈ 省掉的全部中间读写。

**Q2【高】occupancy 13% 的 kernel 比 60% 的快，可能吗？**
可能且常见。occupancy 只回答「SM 上同时住多少 warp 能藏延迟」，不回答
「每个 warp 干的活有没有效」。flash 用重 block（255 寄存器/线程 + 大
smem）换数据留在片上，把访存搬到寄存器级带宽——藏延迟的替代方案是
**根本不需要藏**：没有 HBM 往返就没有长延迟可藏。

**Q3【中高】看到 kernel 名能读出什么？**
三段信息：实现来源（sgemm=cuBLAS FP32 路径、s16816 族=Tensor Core、
fmha_cutlassF=xformers/CUTLASS、cudnn_generated=按问题生成）、数据
类型与指令集（bf16 vs FP32、wmma_f16）、tile 与放置策略（64x64、rf、
sm80）。**kernel 名就是指纹**——trace 里先扫名字再谈数字。

**Q4【中高】profiler 里 CPU 时间突然变大但 ATen op 变少了，怎么解释？**
活搬进了 library 内部：cuDNN 每次调用做旋钮搜索和 plan 准备，profiler
只能看到一条拆不开的粗条。处置：看 self time 而非 op 计数；换后端复测；
必要时上 Nsight Systems 看 driver API 层。

**Q5【中】math 后端慢 3.7 倍，为什么 PyTorch 还留着它？**
它是正确性基线：dtype 安全（upcast FP32）、NaN 安全（safe softmax）、
逐 op 可审计。融合 kernel 只在特定 dtype/head dim/mask/硬件上可用，
兜底链的末端必须有一个「永远能跑」的实现。工程上同理：**优化可以有
条件，正确必须无条件**。

**Q6【中】in-place 操作省内存又省 kernel，能不能到处用？**
不能。autograd 反向要重放 forward 值，in-place 覆盖原值会算错梯度；
`torch.no_grad` / 纯推理路径下安全。判断顺序：先确认无反向依赖 → 再谈
省多少。

## 九、串联阅读

- [线性层与 MLP 的 Profile 实战专题](./线性层与mlp的profile实战专题.md)：
  系列第二篇（epilogue/零 kernel op/compile 融合/Liger vs Inductor），
  与本篇连读即完整课程；
- [Profiling 与性能分析专题](./profiling与性能分析专题.md)：工具链、
  指标口径与 Nsight 家族，本篇的案例在那套工具上跑；
- [推理 Profile 实战专题](./inference/推理profile实战专题.md)：推理版
  的六区域时间线读法，与本篇的 workload 级读法互补（一个看系统流水，
  一个看 kernel 细节）；
- [Transformer 与 Attention](./llm基础/transformer与attention.md)：
  attention 数学本体，本篇只负责它的性能形态；
- [vLLM 与推理加速核心](./inference/vllm与推理加速核心.md)：FA2/Paged
  Attention 在引擎里的生产形态，本篇是它在 PyTorch 层的 profiler 视角。

## 口径与未核实说明

- 全部耗时数字（1.955/7.239 ms、277.9/146.8/186.3 µs、CPU 117/138/214
  µs）与 occupancy 读数（13%、0%、12.5%）均为 PyTorch 官方教程在其
  测试机上的实测口径，硬件换代后绝对值会变，「相对关系与归因方法」不变。
- kernel 名拆解（s16816、fmha_cutlassF、cudnn_generated_knob）按教程与
  CUTLASS/cuDNN 文档口径；不同 CUDA/cuDNN 版本名字后缀会变。
- 「cuDNN 的 0% occupancy 是 CUPTI 对 cuLaunchKernelEx 的归因盲区」
  为教程给出的解释，属工具链行为描述，非官方 changelog 条款。
