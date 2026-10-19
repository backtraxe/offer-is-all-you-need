# AI 编译器与 torch.compile 专题：四段式、图层收益与 Serving 侧落地

> **面向**：已读过 [cuda与kernel专题](./cuda与kernel专题.md)（手写件的世界）与
> [profiling与性能分析专题](./profiling与性能分析专题.md)（测量方法论）、准备
> 「编译器 / 推理引擎」追问线的读者。本篇换到编译器视角：手写 kernel 的边界在
> 哪、编译器又在哪赢，是 2025–2026 AI Infra 面试的固定压轴区。
>
> **读完获得**：① torch.compile 四段式（Dynamo → AOTAutograd → Inductor →
> 后端模式）的可复述机制；② 图层优化收益的三个真实来源与量级；③ vLLM
> piecewise 编译 + 编译缓存 + 动态 shape 三档的 serving 落地细节；④ 生态谱系
> （MLIR/Triton/Helion/Gluon/XLA/TVM）一张口径表；⑤ 数值漂移与 batch-invariant
> 这条 RL infra 新热点线；⑥ 九个面试题带追问的完整答法。
>
> **时效口径**：本篇以 **2026-10** 为口径：版本锚 PyTorch v2.14.1（2026-09-30）、
> Triton v3.8.0（2026-08-28）、vLLM v0.31.0（2026-10-05）、SGLang v0.5.21
> （2026-10-02）、TVM v0.27.0.post1（2026-09-29），star 数为 2026-10-11 GH API
> 实测；官方宣称、基准转引、社区经验逐条括注，未核实项见文末「口径与未核实说明」。

## 一、直觉一句话

torch.compile 做的事，一句话讲完：**把 Python eager「先录成图、再优化图、
最后生成 kernel」，拿不住的地方回退 eager 保正确性**。它不是魔法——大 GEMM
早就是 cuBLAS/CUTLASS 的天下，编译器真正啃下来的是 eager 模式下零碎的
Python 开销、launch 开销、以及 memory-bound 小算子之间来回白跑的显存带宽。

面试官听到这句话预期你能立刻往下拆三层：录图（Dynamo）、优化图（Inductor）、
生成与执行（Triton / CUDA Graph / 手写件），每层都有自己的失败模式和工程对策。

<div class="diagram-embed">
<iframe src="assets/diagrams/compiler-stack.html" width="100%" height="950" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/compiler-stack.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、torch.compile 四段式

### 2.1 Dynamo：字节码级捕捉，拿不住就断图

Dynamo 的捕捉位置在 **CPython 字节码层**：hook PEP-0523 的 frame evaluation
接口，逐帧把 Python 字节码翻译成 FX Graph。这和 TorchScript 的源码静态分析是
两条路——官方宣称 Dynamo 对 7000+ GitHub 项目的**图捕捉成功率达 99%、旧
TorchScript 不足五成**（PyTorch 2.0 发布页口径，2022；这个对比至今仍是最常被
引用的数，TorchScript 的「无声错误」——不报错但语义跑偏——是它的致命伤）。

拿不住的语句（data-dependent 控制流、第三方库黑盒、print 之类副作用）做
graph break：断点前后各成一个子图，断点处回退 eager 执行。**断图不是错误，
是设计**——这是 Dynamo「不报错」哲学的核心。

正确性靠 guard：捕捉时记录符号类型、shape 约束、全局假设，运行时**微秒级**
逐条检查，guard 失效即触发重编译。两个生产坑必须条件反射：

- recompile limit 有上限，超限后**静默回退 eager**——「编译开了怎么反而变慢/
  忽快忽慢」的第一嫌疑人；
- 0/1 specialization：backed 符号会把 0 和 1 特例化到 `{0, 1, ≥2}` 三个分支，
  batch=1 的 decode 路径一进来就触发一轮重编译。

排查三件套：`TORCH_LOGS="+dynamo"`、`torch._logging.set_logs(graph_breaks=True)`、
`torch._dynamo.explain()`。

### 2.2 AOTAutograd：backward 也提前追成图

Dynamo/FX 只抓前向；backward 由 autograd 引擎在运行时按算子动态生成，
编译器只看到半张图，跨前反向的融合/重排无从谈起。AOTAutograd 用
`__torch_dispatch__` 在 **ATen 层逐算子拦截**，把前向和后向追进同一张
FX **joint graph**：每个算子先取 proxy、建 `call_function`、真实执行、
再把结果绑回 proxy。

追完要切回两张图，切法决定显存账：

| 切分策略 | 保存什么 | 代价 |
|---|---|---|
| `default_partition` | 所有中间张量 | 显存占用高，后向不重算 |
| `min_cut_rematerialization_partition` | 只留输入 + 最小割集 | 用少量重算换掉中间张量的写读，是 activation checkpointing 的一般化 |

直觉：逐点链前后向都 memory-bound，默认每个中间张量前向写一次、后向读
一次；min-cut 用几乎免费的多余 FLOPs（藏在访存延迟后）换掉这次往返。
两张图分别编译后包进一个 `torch.autograd.Function`：前向图把后向需要的
张量作为额外返回值，后向图把它们当输入。上游 Dynamo 抓前向 →
AOTAutograd 出 fwd/bwd 图 → Inductor 降 kernel，这条 handoff 是
torch.compile 的主干。DDP/FSDP 的通信 bucket **留在图外**——图内做计算、
图间做通信重叠，这是分布式训练栈和编译栈的标准接缝。

### 2.3 Inductor：默认后端，FX 图到 kernel

Inductor 把 FX 图降到**循环级 IR**（约 50 个算子粒度），再做代码生成：GPU 出
Triton kernel，CPU 出 C++/OpenMP。GEMM 默认走 cuBLAS/ATen 派发，max-autotune
模式下与 Triton 模板、CUTLASS 后端同台 benchmark 择优——**Inductor 自己也知道
大 GEMM 不是 Triton 的地盘，候选池里一直给 cuBLAS 留着位置**。

图层优化的典型动作：pointwise/reduction 融合、no-op 与冗余 reshape 消除、
布局推导、常量折叠、CUDA Graph 包装。

一个可以背下来的 autotune 实例（vLLM integration docs 官方示例，2026-10 抓取）：
8×2048×3072 的 decode GEMM，最优 Triton 模板 **0.0130ms**，默认 cuBLAS 派发
**0.0160ms**——decode 小 shape 段，模板调优确实能反杀派发表。

### 2.4 四档模式与两个开关

| 模式 | 干什么 | 代价 |
|---|---|---|
| default | 基础融合+代码生成 | 编译开销最小 |
| reduce-overhead | 叠加 CUDA Graphs | 消除 launch 开销，静态 shape 才回放得上 |
| max-autotune | 逐 shape 调 tile 参数 | 编译时间秒到分钟级，vLLM 文档因此默认关 autotune |

两个工程开关：`dynamic=True` 把 sz 维符号化，避免 shape 一变就重编译；
`fullgraph=True` 逼你消灭所有 graph break——vLLM 就是用这个标准要求自己
（把 attention 包成 custom op 来保 fullgraph，见第四节）。

## 三、图层优化的收益来自哪

先校准量级：PyTorch 2.0 发布页官方宣称，163 个开源模型、A100 上**训练提速
geomean +43%（加权 0.75·AMP+0.25·FP32；分档 FP32 +21%、AMP +51%）**，93%
的模型可直接跑通；TorchBench 80+ 模型**官方口径 geomean 提速 1.8~2 倍**（vLLM
blog 2025-08 转引）。但收益大头**不在 GEMM raw speed**，而在三处：

1. **小算子串行化的消除**。RMSNorm、RoPE、SiLU+Mul、残差加这条
   memory-bound 串，eager 下每个算子都要把中间张量完整读写一遍；融合后
   一次读写走完。GPT-fast 的叙事原型就是这个：先消灭 launch overhead 和
   中间张量往返，再叠量化。其官方 benchmark（meta-pytorch/gpt-fast README，
   2023 末 A100 数据）：Llama-2-7B bs=1 decode bf16 **104.9 tok/s** →
   int8+compile **155.6** → int4 **196.8**；70B 八卡 TP+int4 **90.8 tok/s**。
   注意这是 2023 硬件口径，2026 年只作「compile 叠量化的收益形态」参考，
   勿当绝对性能引用。
2. **量化与算子的 fusion**。FP8/FP4 的 quant kernel 本身就是 memory-bound
   小算子，恰好是融合收益最大的位置。vLLM 一批自定义 pass 的单点上限
   （vLLM blog 2025-08 官方，含 AMD MI300 405B FP8 等场景）：**单点上限分别为
   SiLU/激活+FP8 Quant 融合 +8%、Attention+Quant(FP8) +7%、AllReduce+RMSNorm
   +15%、Async TP +10% 的端到端增益**。这些都是百分点级的收益，不是微基准。
3. **通信-计算重叠**。all_reduce 拆成 reduce_scatter+all_gather，all_gather
   延后并与下一个 GEMM 融合（Async TP pass 最高约 10%）。这种改写要手工
   改几百个模型文件不现实，**编译 pass 是唯一规模化路径**。

边界同样清晰：attention 本体、MoE group-GEMM、稀疏/低 bit packing 这类
「算件」仍是手写/专用 kernel 领地。vLLM 把 attention 包成
`torch.ops.vllm.unified_attention_with_output` 这个 custom op——Dynamo 看不
进去，编译器只管它周围。这就是「编译赢什么、手件守什么」的分界线，也是
本专题图里第三张卡的核心。

### 三·增、跨 GEMM 边界的联合融合：ComFuse（2026-08，字节 × 南开）

Inductor 的融合止于 GEMM 外：GEMM 走 cuBLAS/ATen，结果先写回 GMEM，
下游 RMSNorm/LayerNorm/Softmax 再读回来——on-chip→off-chip→on-chip
一个来回。ComFuse 把 GEMM 与依赖它的 elementwise/reduction 子图放进
同一个 kernel 流水：

- **Stage-Stream**：MatMul 一个 stage、下游子图一个 stage；stage 内按
  DAG 调度，stage 间用可复用片上 buffer 串流，让 epilogue 与下一 tile
  的 mainloop 重叠。
- **跨 CTA 共享 + 三级 reduction**：Hopper/Blackwell 的 Thread Block
  Cluster 经 DSMEM 跨 CTA 交换中间值，TMA 做 bulk 传输；reduction
  依次走 warp shuffle → warpgroup SMEM → 跨 CTA DSMEM，只沿一个逻辑维
  归约，同步边界收在 tile 局部子集。
- **B2BGEMM**：producer/consumer warp group + dataflow scheduling，第一
  GEMM 的 tile 留在寄存器/片上直接喂第二 GEMM，中间矩阵不落 GMEM。
- **编译栈**：Code Translate → Frontend Mapping → Reduction Subgraph
  Splitting → Backend Mapping；高层 tensor 子程序自动 lower 到
  CUDA/CUTLASS。

数字口径要收紧：公众号说「最高 1.24×」，论文（arXiv:2608.03537v1）给的
三 pattern 均值是 **1.08× / 1.09× / 1.07×**，B2BGEMM 最好
Target-Attention **1.97×**、DLRM Bottom MLP **1.23×**；实验是
PyTorch 2.5.1 + CUDA 12.4 + TensorRT 10.3.0，Inductor 开 static-shape
+ max-autotune。**反例**：Self-Attention 场景 TorchInductor 因内置
FlashAttention 更强，ComFuse 有明显差距；小规模/小 batch 也会因流水线
未进稳态而略输。所以它是「GEMM 后拖长 epilogue + Hopper/Blackwell +
stage 负载平衡」时的架构特定优化，不是通用替代。

## 四、Serving 侧落地：vLLM 与 SGLang（2026 现状）

### 4.1 vLLM：编译是 V1 架构的默认底座

vLLM 从 V1 起**默认开启 torch.compile**，形态是 piecewise 编译：整体 forward
图按 splitting_ops（即 attention）切开，attention 之间的层间子图走
Inductor+CUDA Graph，attention 本体留 eager。CUDA Graph 负责消 decode 阶段
的 launch/框架开销——decode 一个 step 几十上百个小 kernel，逐个 launch 的
CPU 开销在静态 shape 下回放一次就全省了。

工程化四件套，面试可以挨个点：

- **缓存即资产**。编译产物落 `~/.cache/vllm/torch_compile_cache`，目录名由
  「全部相关 config + traced 文件源码 hash」决定；可以整目录拷贝进生产镜像
  收敛冷启动；`VLLM_DISABLE_COMPILE_CACHE=1` 只留调试用。铁律：**只编译一次、
  启动期全部编完，请求服务期绝不允许触发新编译**——一次 JIT 编译阻塞就是
  一个 P99 突刺，SLO 直接崩。冷启动编译时间是公认痛点，官方立了 startup-ux
  专项，规划 -O0..-O3 档位让用户显式拿启动时间换性能。
- **动态 shape 的分寸**。serving 场景 vLLM 反而**嫌 guard 多**——guard 多了
  要么偷偷降优化度，要么触发重编译。DynamicShapesConfig 三档：BACKED
  （默认，接受「potentially unsafe dropping of guards」换性能）/ UNBACKED
  （最强保证，可能丢优化）/ BACKED_SIZE_OBLIVIOUS（实验性中间档）。这本质上是
  把 correctness contract 的责任从编译器转嫁给框架，三档是这个灰色地带的
  formalize。
- **特例化两条腿**。`compile_sizes: [1,2,4,8]` 对这些 batch 做全静态 shape
  编译+autotune，换来最快 kernel，冷启动更慢但缓存命中后白赚；
  `cudagraph_capture_sizes` 单独控制 CUDA Graph 捕获的 batch 档位。
- **lm head + sampling 不在图里**——采样有随机性和 data-dependent 分支，
  留在 eager 区，和 attention 一样是 piecewise 的「切口」。

### 4.2 SGLang：编译是可开关的甜点

SGLang 里 torch.compile 是可开关优化项而非架构底座：
`--enable-torch-compile --torch-compile-max-bs N`（官方 DeepSeek 指南建议
N 取 1–8），瞄的是小 batch decode 的延迟。源码侧已出现独立的
srt/compilation 目录与 compile_phase 机制，方向和 vLLM 趋同，但定位差异要
答得出来：**vLLM 把编译当默认底座，SGLang 把编译当可选甜点**。

### 4.3 TensorRT-LLM 与 ONNX 的位置变化

动态 shape + KV cache 变长生成，让静态图导出路径很别扭；新算子（MLA、MoE、
sparse attention）的图优化规则也写不过来。TensorRT-LLM 仍是 NVIDIA 闭环内的
强竞品（GB200/NVL72 整机前缀场景是它的主场，另见 [tensorrt-llm专题](./inference/tensorrt-llm专题.md)），
但开放生态侧「torch.compile + CUDA Graph + 手写 attention kernel」的
vLLM/SGLang 式组合已成主流。ONNX 在主力 LLM serving 基本退场，前 LLM 时代
模型与边缘端仍有存量。TPU 侧则是 XLA 吃全盘——vLLM TPU 后端 2025-10 已改走
JAX-to-XLA lowering。

## 五、生态谱系（2026-10 实测活动度）

### 5.1 一张活动度表

| 项目 | star（2026-10-11 GH API） | 52 周提交 | 定位一句话 |
|---|---|---|---|
| pytorch | 104.3k | 18,288 | 一家独大的默认底座 |
| vllm | 93.6k | — | 编译化 serving 的标杆 |
| sglang | 37.0k | — | 编译作可选甜点 |
| flash-attention | 25.1k | — | 手件 attention 的王座 |
| mlc-llm | 23.2k | — | TVM Unity 的端侧/本地叙事 |
| triton | 20.3k | 2,171 | 性能可移植 kernel DSL |
| tvm | 13.8k | 1,263 | 式微未死，边缘找生态位 |
| cutlass | 10.6k | — | NVIDIA 大 GEMM 手件库 |
| DeepGEMM | 8.9k | — | FP8 GEMM 专用件 |
| flashinfer | 6.6k | — | serving 向手件集 |
| openxla/xla | 4.6k | — | 影响力集中 TPU/JAX |
| KernelBench | 1.3k | — | AI 写 kernel 的标准榜 |
| helion | 960 | — | Triton 之上更高层 DSL |

版本锚：PyTorch v2.14.1（2026-09-30）、Triton v3.8.0（2026-08-28）、
vLLM v0.31.0（2026-10-05）、SGLang v0.5.21（2026-10-02）、TVM
v0.27.0.post1（2026-09-29），均为官方 release 实测。

### 5.2 逐家口径

- **MLIR 是基建不是产品**：Triton IR 本身就是一个 MLIR dialect，答「Triton
  是什么」时先点「MLIR 之上」这句，面试官预期内的加分项。
- **Triton 的双重身份**：对 Inductor 是代码生成目标，对 kernel 工程师是
  可移植手写 DSL。2025 起向下加了 Gluon（显式布局/warp specialization 的
  低一层），向上有 Helion（vLLM 已用它写实验性 paged attention），构成
  Helion > Triton > Gluon 的三层梯度。
- **XLA/OpenXLA**：仓库高活跃，但影响力集中在 Google 内部与 TPU/JAX（JAX
  36.4k star）；PyTorch GPU 编译这个战场已被 Inductor 终结，XLA 作为
  torch.compile 备选后端的故事已边缘化。
- **TVM**：式微但没死——v0.27 正常发版、52 周 1,263 提交，MetaSchedule
  （Ansor 的继任）仍是其 autotune 体系；MLC-LLM 走 TVM Unity 搞「一个 IR
  打所有端」。面试口径：**自动调优思想的先行者，如今在边缘/本地部署找生态位**，
  数据中心 LLM serving 主流叙事已被 vLLM/Triton 取代。
- **AI 写 kernel**：AlphaEvolve **给 Google 自家 GEMM kernel 提速 23%、换算
  Gemini 训练总时长省 1%，FlashAttention kernel 最高提速 32.5%（DeepMind
  blog 2025-05 官方宣称）**；KernelBench 成为标准评测
  （ICML'25，arXiv:2502.10517；L1 单算子 100 题/L2 融合 100 题/L3 整模型
  50 题/L4 HF 模型；指标 fast_p=正确且达到 p 倍速的题占比），但主仓 2026-03
  后未再更新。定位成 **autotune 的搜索器增强**，不是编译器替代者。教训性
  事件：2025 社区曾有号称百倍加速实为评测漏洞的翻车（reward hacking，
  详见文末口径说明）。

### 5.3 Triton vs 手件：性能可移植的证据

vLLM blog 2026-03 官方基准（官方标注 testing in late 2025，H100 单卡 bs=1，
**只覆盖长 decode 段**）：同源 Triton paged-attention kernel **在 H100 长
decode 达 FA3 的 100.7%，在 MI300 上比旧实现快 5.8 倍；代码量约 800 行对
FA3 的约 7 万行**。2026 年 Triton 版已成为 vLLM 在 AMD/ROCm 的默认
attention 后端。

解读口径要稳：性能可移植**不等于所有场景都赢**（H100 上是刚追平），但把
多平台维护成本从 N 套手件 kernel 收到 1 套。Triton 自身的 JIT cold-start
成本靠磁盘缓存摊（TRITON_CACHE_DIR）。

## 六、数值与调试：编译改变的不只是速度

**数值漂移是编译固有的**：fusion 改变归约/求和顺序，bf16 累加路径跟着变，
输出无法和 eager bitwise 对齐。训练侧多数可接受；但 RL 场景里 rollout 栈与
训练栈的 logprob 差会被 PPO/GRPO 放大成训练事故。2025Q4 起这条线被推成
RL infra 硬需求：vLLM×TorchTitan 做过 bitwise 对齐实验（2025-11）；SkyRL
IsoExec 把 logprob 差压到 **1e-6 以下**（2026-08 blog 官宣数据，代价约
**25% 开销**）。

高频追问「两边都设 eager 还不够吗」——不够。即使同一 kernel，decode 的
batch 组成不同也会导致分块规约路径不同，结果仍然对不齐；需要的是专门设计的
**batch-invariant kernel**（归约结果与 batch 组成无关），再叠 rollout/training
两侧 kernel 栈的对齐。约 25% 开销换 1e-6 级 logprob 差，当前这是公开口径里
最扎实的一组数。

调试侧的体验退化也要心里有数：compile+CUDA Graph 之后 stack trace、profile、
断点体验全面退化；生产引入编译必须保留 enforce-eager 降级开关，配套
unpacked cache 保存可读代码与 TORCH_LOGS 调试路径。

## 七、工程议题七条

1. **编译时间 vs 运行收益的账**。max-autotune 逐 shape 调优到分钟级，
   vLLM 文档自己都默认关。生产方案=离线预编译+缓存目录随镜像分发+启动期
   编完再接流量；冷启动 SLA 紧的场景用低档 -O 或干脆 enforce-eager 主动放弃。
2. **动态 shape 的 recompile 定时炸弹**。token 数一直在变，自然 guard 就是
   「shape 一改→静默重编译→P99 突刺」；对策=符号化保底+小批 decode 特例化
   双腿走路。
3. **guard dropping 的灰色地带**。vLLM 为性能直接丢 guard，correctness
   contract 的责任转嫁给框架；DynamicShapesConfig 三档是对这个灰色地带的
   显式定价，选型时要答得出各自放弃了什么。
4. **编译 vs 手件的边界在移动**。2024 年 Triton attention 打不过 FA 是共识，
   2025 底长 decode 打平 FA3（100.7%），2026 官方在 AMD 默认 Triton；但大
   GEMM、MoE grouped GEMM、FP4 的手件仍领先。经验推导：新硬件 tensor core
   指令落地，手件先领先一年左右。策略=attention 和量化器**周围**交给编译器
   融合，本体留给专用 kernel，保住 backend 可插拔。反方向证据是 ComFuse：
   把 GEMM 与下游 reduction 联合融合，均值 1.07–1.09×、最高 1.24×；但依赖
   Hopper/Blackwell，小规模会输。
5. **CUDA Graph 与动态性的矛盾**。变长 attention 的 launch grid 依赖
   batch/seq，固定 graph 回放会浪费 wave；对策方向是 persistent kernel
   （固定 launch grid、工作量元数据从 GPU 内存读）——2026 attention kernel
   实践的 next big thing。
6. **数值一致性与 RL 对齐**。见第六节；联动高频题「为什么 PPO 线上
   logprob 和训练算的对不齐」。
7. **resilience/debugability 退化**。编译栈越深，可观测性越差；降级开关、
   可读缓存、TORCH_LOGS 三件套要在引入编译的同时交付，不是事后补。

## 八、数字锚总表（口径逐条括注）

- torch.compile **训练比 eager 快 43%（加权 0.75·AMP+0.25·FP32；FP32
  +21%、AMP +51%），163 个开源模型、A100、93% 可直接跑通**——PyTorch 2.0
  发布页官方宣称，2022。
- **捕捉成功率 Dynamo 达 99%、旧 TorchScript 不足五成**——同上官方宣称。
- TorchBench 80+ 模型**官方口径 geomean 提速 1.8~2 倍**——PyTorch 官方，
  vLLM blog 2025-08 转引。
- GPT-fast：**bf16 版 104.9 tok/s、int8+compile 达 155.6、int4 达 196.8，
  70B 8 卡 TP+int4 为 90.8 tok/s**（Llama-2-7B A100 bs=1 decode）——gpt-fast
  README 官方 benchmark，2023 末硬件口径。
- vLLM 自定义 pass：**单点上限分别为 SiLU+FP8 Quant +8%、Attention+Quant
  +7%、AllReduce+RMSNorm +15%、Async TP +10% 的增益**——vLLM blog 2025-08
  官方。
- Inductor autotune 实例：decode GEMM（8×2048×3072）最优 Triton 模板
  **0.0130ms** < 默认 cuBLAS 派发 **0.0160ms**——vLLM integration docs，
  2026-10 抓取。
- ComFuse：GEMM + 下游 reduction 联合融合，三 pattern 均值
  **1.08× / 1.09× / 1.07×、最高 1.24×**；B2BGEMM 最好
  Target-Attention **1.97×**、DLRM Bottom MLP **1.23×**——公众号 +
  论文 arXiv:2608.03537v1（2026-08，字节 × 南开）；GPU 型号未给，
  Self-Attention 场景以论文为准（Inductor 更强）。
- Triton paged attention：**长 decode 达 FA3 的 100.7%、MI300 较旧实现快
  5.8 倍、约 800 行对 FA3 约 7 万行**——vLLM blog 2026-03 官方，
  官方标注 late 2025 基准、H100 单卡 bs=1、只覆盖长 decode 段。
- AlphaEvolve：**自家 GEMM kernel 提速 23%、Gemini 训练总时长省 1%、
  FlashAttention kernel 最高提速 32.5% 的官宣数字**——Google DeepMind
  blog 2025-05 官方宣称。
- SkyRL IsoExec：**官宣把 logprob 差压到 1e-6 以下、开销约 25%（代价）**——
  2026-08 blog 官宣数据。

## 九、▶ 面试题（带频率标注）

**Q1（频率：极高）torch.compile 为什么快？**
拆四个收益来源：① Python/launch overhead 消灭；② memory-bound 小算子融合
减显存往返；③ 静态 shape GEMM autotune；④ 编译 pass 做量化/通信 fusion。
量级：geomean +43%~2×，单项 fusion 7–15%。追问「大模型 GEMM-bound 时还有
用吗」→ 有但收益收窄，真正的大头在叠量化和分布式通信 fusion。

**Q2（频率：高）Dynamo 怎么做到不报错？**
graph break + guard 组合：拿不住的回退 eager，正确性靠运行时微秒级 guard
检查。追问链：guard 检查成本 → recompile 上限超限静默回退 → 0/1
specialization 坑 → frame evaluation 机制 → 与 TorchScript「无声错误」对比
（99% vs <50% 捕捉率，2022 官方宣称）。

**Q3（频率：高）vLLM 为什么把 attention 包成 custom op？**
三个理由：内部依赖 KV cache 与复杂 shape，Dynamo 看不透；保 fullgraph 让
piecewise 之前的子图最大化；attention 本来就是 hand-tuned 领地。追问：
piecewise CUDA Graph 如何切分（splitting_ops=attention）、lm head+sampling
为什么也不在图里（随机性+data-dependent 分支）。

**Q4（频率：中高）动态 shape 服务的编译怎么设计？**
三档 DynamicShapesConfig 各自放弃什么换什么；compile_sizes 特例化与
generic-symbolic 组合；铁律「请求期绝不能触发新编译」（编译阻塞→P99 突刺
→SLO 崩）。

**Q5（频率：中高）Triton 在这套栈里扮演几个角色？**
双重身份：对 Inductor 是代码生成目标，对工程师是可移植手写 DSL；2025 后
层次 Helion（上）/Triton/Gluon（下），本身是 MLIR dialect 的用户。追问：
「800 行打 FA3 七万行的 100.7%——代价是什么」→ NVIDIA 上刚追平、只覆盖
长 decode；赢在把多平台维护从 N 套收到 1 套；JIT cold-start 靠磁盘缓存摊。

**Q6（频率：中高）编译 vs 手写 kernel 的边界在哪？**
编译赢：pointwise/reduction fusion、量化邻近融合、dtype/layout 改写、通信
延迟融合（Async TP）。手件守：attention 变体、MoE grouped GEMM、大 shape
FP8/FP4 GEMM、稀疏低 bit packing。边界走向：Triton/Gluon 持续啃手件地盘，
新硬件 tensor core 指令落地手件先领先一年左右（推导判断，作答时标注）。
反方向证据是 ComFuse：把 GEMM 与下游 reduction 联合融合，均值
1.07–1.09×、最高 1.24×，但只在 Hopper/Blackwell 且 epilogue 够长时划算。

**Q7（频率：中，RL infra 线升频中）数值漂移怎么来的、怎么办？**
fusion 换归约顺序+低精度累加+batch 组成不同三条来源；解法谱系
batch-invariant kernel、rollout/training kernel 栈对齐（bitwise 已做到，
约 25% 开销换 1e-6 级差）。必接追问「两边都设 eager 还不够」→ 同一 kernel
分块规约路径仍随 batch 组成变，需要专门设计的 batch-invariant 实现。

**Q8（频率：中）给 serving 系统设计编译策略，分几步？**
骨架：① 干净代码 Inductor 默认档+全 symbolic 保底；② decode 小 batch
compile_sizes 特例化+piecewise cudagraph；③ 上 quant 后写自定义 fusion
pass；④ TP 场景评估 Async TP；⑤ 改造前先 profiling 建 roofline 画像
（串联 [profiling与性能分析专题](./profiling与性能分析专题.md)）；⑥ 离线
预编译+缓存随镜像分发、启动完成才接流量、保留 enforce-eager 降级开关。

**Q9（频率：中）AI 生成 kernel 会取代编译器吗？**
定位为「autotune 的搜索增强/发现引擎」：AlphaEvolve 拿到生产级提速，
KernelBench 上限尚低、产物仍需人工 review。追问：为什么进化式搜索比一次性
生成靠谱（自动 evaluator+多轮 feedback+可验证性）；翻车教训——2025 社区
号称百倍加速实为评测漏洞事件，reward hacking 是 kernel 生成评测的第一风险。

## 十、口径与未核实说明

- **编译绝对时间量级**：官方只说「启动时间是公认痛点」「autotune 从秒到
  分钟级」，无可引用的固定分钟数曲线；社区经验「8B 冷编译几分钟、70B+ 更
  高」普遍可信但未列数，本篇不给精确分钟锚。
- vLLM v0.5.0 torch.compile 原始集成 blog（2025-01）抓取 404；本篇采用
  2025-08 blog + 2026 现行 docs 口径。
- Ansor（2020）/MetaSchedule（2022）的论文年份来自文献知识未单独抓源；
  TVM 活跃度为 GH API 实测。
- 「手件先领先一年左右」：综合 2025–2026 vLLM blog 中 Hopper→Blackwell
  跟进节奏的归纳判断，属**推导值**。
- KernelBench「百倍翻车」案例：指 2025 社区熟知的 LLM 写 kernel
  reward/harness 作弊争议，本轮未抓原文，面试当**社区事件**转述而非
  benchmark 数据引用。
- Triton attention 100.7%/5.8×：基准官方标注 late 2025、H100 单卡 bs=1
  与 MI300，**只覆盖长 decode 段**，prefill 段官方未给同组数字。
- GPT-fast 表内数字为 2023 末 A100 基准，2026 硬件/软件栈已多代演进，
  仅作「compile+quant 叠加收益形态」示例，勿当 2026 绝对性能引用。
- ComFuse：公众号「最高 1.24×」是上限；论文 arXiv:2608.03537v1 给的三
  pattern 均值 1.08×/1.09×/1.07×，Self-Attention 场景 Inductor 更强；
  实验环境 PyTorch 2.5.1 + CUDA 12.4 + TensorRT 10.3.0，GPU 型号未给。

## 串联阅读

- [kernel工具链选型专题](./kernel工具链选型专题.md)：本篇深挖的 L2（AI
  编译器层）在五层控制阶梯中的位置，以及与库/DSL/手写/Mojo 的选型权衡。
- [cuda与kernel专题](./cuda与kernel专题.md)：手件 kernel 主线的数字接力，
  本篇「手件守什么」边界卡的全部细节都在那里。
- [profiling与性能分析专题](./profiling与性能分析专题.md)：roofline 与
  「融合前先画像」的测量方法论，Q8 第 ⑤ 步的操作手册。
- [inference/vllm与推理加速核心](./inference/vllm与推理加速核心.md)：vLLM
  的调度与 PagedAttention 主线，本篇只补编译层。
- [inference/vllm与sglang深度对比](./inference/vllm与sglang深度对比.md)：
  两框架架构级对照，编译定位差异（底座 vs 甜点）的上下文。
- [inference/推理引擎2026新进展](./inference/推理引擎2026新进展.md)：引擎
  演进时间线，本篇 4.x 各结论的年表位置。
- [inference/tensorrt-llm专题](./inference/tensorrt-llm专题.md)：NVIDIA 闭环
  竞品视角，与 4.3 节互补。
- [训练与对齐/rl环境工程专题](./训练与对齐/rl环境工程专题.md)：RL rollout
  侧工程，第六节 logprob 对齐问题的另一半现场。
