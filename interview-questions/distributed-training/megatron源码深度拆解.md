# Megatron 源码深度拆解：3D 并行的"原厂手册"

> 分布式训练模块源码篇。面向 AI Infra / 大模型训练岗，应对面试官那句"读过
> Megatron 源码吗？从哪读起、里面有什么"。读完你会得到：① 仓库三层架构
> （Core/LM/Bridge）的现状与版本口径；② 一张"并行维度 → 源码路径"的搬运地图，
> 被问任何 3D/EP/FP8/CKPT 问题能瞬间给出文件级证据；③ 六道高频面试题（3D 配比、
> MFU、PP bubble 三层递进、框架选型、Distributed Optimizer 拆账、MoE EP 瓶颈）的
> 标准答法。
>
> **时效口径**：仓库数字、源码路径、flag 名称均 2026-10-09/10 实测核实于
> NVIDIA/Megatron-LM **main 分支**（该分支移动很快，引用请自省日期）；论文数字
> 标注 arXiv 编号与年份。

## 一、先搞清：Megatron 是什么、解决什么题

**Megatron-LM 是 NVIDIA 的大模型预训练框架，核心命题只有一个：在千卡万卡上把
Transformer 训到硬件性能逼近物理上限**，为此它把"怎么切模型"做到了业界最完整的
五维并行（TP/SP/PP/DP/CP，加 MoE 的 EP 第六维），并且通信、kernel、显存全部
自己重写，不依赖 PyTorch 默认实现。

几个硬数字帮你建立量级感（均为 2026-10 实测）：

- 仓库 **star 18.1k**（2026-10-10 gh api），协议 **Apache-2.0**；
- README 徽章 **Megatron Core 0.19.0**，release 命名已迁 CalVer，最新为
  **26.09-alpha.rc2**（2026-10-08）；**0.17.0 起要求 Python ≥3.12**；
- **2025/12 起开发与 CI 全部迁到 GitHub 公开**，公开透明度大幅提升；
- 官方性能锚：**462B 参数在 6,144 张 H100 上验证，MFU 47–48%，**weak scaling
  从 41% 提到 47–48%（引用时必须补一句：**benchmark 未训到收敛**）。

面试怎么用这个开场？被问"为什么选 Megatron"时，先抛出"3D 并行的原厂标杆 +
MFU 天花板"两个定位，然后用上面的 star 数与 462B 数字锚定分量，再进入选型对比。
详见 [训练框架与稳定性](./训练框架与稳定性.md) 第一节的横评表。

## 二、三层架构：Core / LM / Bridge

2025 年后 Megatron 重构为三件套，澄清面试里最常见的概念混淆：

| 层 | 仓库对应物 | 干什么 |
|---|---|---|
| **① Megatron Core（mcore）** | `megatron/core/` 目录，可 `pip install megatron-core` | GPU 优化、可组合的基础库，支持 FP16/BF16/FP8/FP4 |
| **② Megatron-LM** | mcore + 参考训练脚本（pretrain_gpt.py 等） | 拿来就能跑 full pretrain 的 reference implementation |
| **③ Megatron Bridge** | 独立仓（2025/10） | HF ↔ Megatron ckpt 双向转换，生态桥 |

同时注意两个新目录与一条边缘化警告：

- **megatron/rl/：**RLHF/GRPO 场景训推对齐的基础设施；
- **megatron/post_training/：**量化/蒸馏/剪枝（训练后压缩）；
- **`megatron/legacy/` 已边缘化**，读源码别走这扇门——老代码只作参考，主线在 mcore。

我们把全文地图先送到眼前，后面四节按泳道逐层下钻：

<div class="diagram-embed">
<iframe src="assets/diagrams/megatron-core-map.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/megatron-core-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

图读法：最上一泳道是仓库三层；中间是**并行维度的代码仓库地图**（本文的重心）；
最下一泳道是**精度与容灾**（FP8/FP4 recipe + 分布式 checkpoint + 异步落盘/straggler）。
三张卡片沉淀：RankGenerator 面试口径、2025→2026 版本时间线、MoE 四类 dispatcher。

## 三、并行维度 → 源码模块总地图

被问"X 在 Megatron 里在哪实现"的速查表（路径均 2026-10-09/10 main 分支核实）：

| 维度 | 源码路径 | 一句话看什么 |
|---|---|---|
| 并行组排布 | `megatron/core/parallel_state.py` | RankGenerator 默认 `tp-cp-ep-dp-pp` |
| TP/SP | `megatron/core/tensor_parallel/` | Column/RowParallelLinear + mappings.py |
| PP | `megatron/core/pipeline_parallel/schedules.py` | 三调度函数 + combined_1f1b.py |
| PP p2p | `megatron/core/pipeline_parallel/p2p_communication.py` | 点对点通信实现 |
| DP | `megatron/core/distributed/` | bucket 化梯度通信 + overlap |
| Distributed Opt | `megatron/core/optimizer/distrib_optimizer.py` | "ZeRO-1 equivalent" |
| CP | `megatron/core/context_parallel/` | + Dynamic CP 变长自适应 |
| EP/MoE | `megatron/core/transformer/moe/` | 四类 token dispatcher |
| FP8/FP4 | `megatron/core/enums.py` | Fp8Recipe / Fp4Recipe 枚举 |
| Checkpoint | `megatron/core/dist_checkpointing/` | ShardedTensor 跨 TP/PP resharding |
| 激活 offload | `megatron/core/pipeline_parallel/fine_grained_activation_offload.py` | 细粒度激活换出 |

## 四、RankGenerator：3D 并行配比的代码级证据

▶ 面试题：3D（TP×CP×EP×DP×PP）并行比例怎么定？——**高频**

`parallel_state.py` 里的 RankGenerator 是这道题的**代码级证据**：默认 rank 排布
严格按 `tp-cp-ep-dp-pp` 从内到外嵌套——TP 最内层放同机（NVLink 快）→ CP →
EP → DP → PP 最外层跨机（可接受 RDMA 慢链路）。记这个顺序就能口推出一切配比决策。

两条硬约束背下来：

- **TP ≤ NVLink 域**（机内通常 8 卡）：TP 的高频 AllReduce 不能被跨机拖死；
- **m ≥ p**（microbatch 数 ≥ PP 级数）：朴素 1F1B 的
  bubble 占比 ∝ **(p−1)/m；**interleaved 降为 **(p−1)/(m·v)，**但通信量 ×v
  （配比公式引用 SC'21 论文 **arXiv 2104.04473**，3072 GPU 训 **1T** 模型、
  单卡 52% 峰值）。

答配比就按"TP 卡机内 → CP/EP 放 NN → DP 填满剩余 → PP 保证 m≥p 且 bubble 可控"
的顺序讲，说完 RankGenerator 那句嵌套序，面试官就知道你不是背的。

## 五、PP 调度：从 1F1B 到 Zero Bubble

▶ 面试题：PP bubble 怎么消？按四层递进答——**高频**

`pipeline_parallel/schedules.py` 里藏着三个调度函数，对应 bubble 递进：

1. **forward_backward_no_pipelining**：无流水，对照组；
2. **forward_backward_pipelining_without_interleaving**：朴素 1F1B，bubble (p−1)/m；
3. **forward_backward_pipelining_with_interleaving**：virtual pipeline，
   bubble (p−1)/(m·v)，对应论文吞吐提升 **10%+（同上 SC'21）**。

2026 年新增的 **combined_1f1b.py** 把调度抽象成 ScheduleNode 细粒度图，直接按
Zero Bubble 思路排：**前向 / dgrad / wgrad 拆成三类节点**，wgrad 可任意后移；
难缠的尾部 embedding wgrad 则通过 **finish_embedding_wgrad_compute** 延迟到最后
阶段，配合 `p2p_communication.py` 完成跨 stage 同步。这就是"四层递进"的第四层答案。

配合细粒度显存控制：`fine_grained_activation_offload.py` 把激活换出到 CPU，
把"PP bubble 消完但显存爆"的下一题也堵上——升级思路：加大 m → interleaved →
Zero Bubble 拆分 wgrad → 尾 wgrad 延后 → 激活 offload 兜底。

## 六、DP 与 Distributed Optimizer 拆账

▶ 面试题：Megatron 的 Distributed Optimizer 到底省了哪笔账？——**中频**

`megatron/core/distributed/` 做数据并行：bucket 化梯度通信 + overlap（梯度
allreduce 分段挂在反向后面，不等整层算完）。

真正的重头戏是 `megatron/core/optimizer/distrib_optimizer.py`：

- **做法**：按 DP 切分 optimizer state + FP32 master weight + grad bucket，
  通信从 allreduce 改成 **reduce-scatter + allgather**；
- **官方称 "ZeRO-1 equivalent**"，严格说它同时切了 fp32 主权重，**介于 ZeRO-1/2 之间**；
- **拆账**：Adam state（m+v 两份 fp32，加 fp32 master=12N）从全量 12N
  降为 **12N/DP**——~70B 模型 DP=512 时这一项直接从 TB 级砍到 GB 级。

配套的显存兜底：mcore 已内置两套 FSDP——`torch_fully_sharded_data_parallel.py`
（借 PyTorch 官方 FSDP）与 **fsdp/src/megatron_fsdp/** 自研 ZeRO-3 实现，
把"Megatron 只能 ZeRO-1"的老结论翻篇。

## 七、TP/SP/CP 与激活重计算

`megatron/core/tensor_parallel/` 的核心是 `ColumnParallelLinear` /
`RowParallelLinear` + `mappings.py` 里的通信原语：列切后不需 AllReduce、
行切后补一次。口诀：**进不 AllReduce、出才 AllReduce**。

**SP（序列并行）** 是面试常踩坑：TP 之外沿 sequence 维把 LayerNorm/Dropout 这类
非 GEMM 部分再切一刀，配套 **fused cross_entropy** 把 vocab 维临时张量融掉，
否则 logits ×vocab 的 fp32 会爆显存。

`megatron/core/context_parallel/` 做长序列；**Dynamic CP**（2026/01 官方博客）对
变长序列自适应分组、通信取最长那条对齐，**最高 1.48× 加速**。

激活重计算力度的三档旋钮（`recompute_granularity`）：

- **full**：整层重算，反向成本最高；
- **selective**：只重算 attention core 显存大头（softmax 中间体）；
- 粒度进一步到 `core_attn / moe_act / layernorm` 子项，
  再加上 **distribute_recomputed_activations** 把重算激活在 DP 间散开。

论文锚点（**arXiv 2205.05198**）：**SP+selective 训 530B / 2240×A100，MFU 54.2%；**
对比全重计算 42.1%——**激活显存降 5×**，所以 Megatron 默认是 selective 优先。

## 八、MoE/EP：四类 dispatcher 到 Flex+DeepEP

▶ 面试题：MoE EP 为什么是性能瓶颈？怎么解？——**中频，2026 升温**

`megatron/core/transformer/moe/` 里的 token dispatcher 共 **4 类**：

| dispatcher | 特点 |
|---|---|
| **MoEAllGather** | allgather token 后各自算各自，简单但通信量大 |
| **MoEAlltoAll** | alltoall 标准做法，瓶颈在通信带宽 |
| **MoEFlexTokenDispatcher** | **推荐**，v0.12 起接 DeepEP |
| （Flex backend 四选） | **deepep / deepepv2 / hybridep / ncclep**——hybridep 支持 MNNVL 多节点 NVLink，ncclep 是 TE ep API（2026） |

必须背下来的 4 个 flag：

- `--moe-token-dispatcher-type flex --moe-flex-dispatcher-backend deepep`：默认推荐组合；
- `--moe-grouped-gemm`：TE GroupedGEMM，支持 **FP8/MXFP8** 专家 GEMM；
- `--overlap-moe-expert-parallel-comm --delay-wgrad-compute`：**v0.14** 起在 batch
  级隐藏 EP-A2A 通信，把 wgrad 延后；
- `--moe-router-fusion`：router 融合优化；
- 加分项：`shared_experts.py` 独立 overlap、**dropless MoE + CUDA Graph**、
  `upcycling_utils.py`（dense→MoE 复用权重）。

MoE 技术报告锚点（**arXiv 2603.07685，88 页，2026/03**）：**DeepSeek-V3-685B
在 GB300/GB200 上 1,233 / 1,048 TFLOPS/GPU，Qwen3-235B 974 / 919**；关键优化
**Parallel Folding**（把 EP 组从 DP 组折叠"借"rank，不额外占卡）。

**解题口径**：EP 瓶颈=token 扇出×网络带宽，所以答案是"通信隐藏（overlap+wgrad 延后）
+ kernel 融合（GroupedGEMM/FP8）+ 调度折叠（Folding 不扩卡）"三层一起给。

## 九、精度：FP8/FP4 与 Precision-Aware Optimizer

`megatron/core/enums.py` 里的枚举是 2025 之后低精度训练的全部入口：

- **Fp8Recipe 五枚举：delayed / tensorwise / mxfp8 / blockwise / custom**——
  `blockwise` 即 DeepSeek 风格的块状缩放；
- **Fp4Recipe 两枚举：nvfp4 / custom**——NVIDIA 最新 FP4 路径；
- **`--use-precision-aware-optimizer`（v0.13 起）**：FP8 权重 + BF16
  optimizer state，把 optimizer 显存再砍一半。

答题关键词：**Delayed Scaling**（历史最大值外推）、tensorwise→blockwise 粒度细化、
Optimizer state 从 FP32 → BF16 的精度权衡（需配 stochastic rounding）。

## 十、Checkpoint 与容错韧性

`megatron/core/dist_checkpointing/` 的工程思想一句话：**用 ShardedTensor 的
元数据（全局形状 + 局部分片）记账，加载时自动生成任意 TP/PP 度数之间的
resharding 方案**——白天 TP8/PP4 存、夜里 TP4/PP2 拉起来不改名也不改格式。

策略面两个 enum：

- **`torch_dist`（默认）**：走 torch.distributed.checkpoint；
- **nvrx**：接 **nvidia-resiliency-ext** 的 **FSWriterAsync**，路径
  **GPU → CPU pinned → 异步落盘**，训练主线程只等 pinned copy。

配套文件：`fault_injector.py`（故障注入压测）、`README_STRAGGLER.md`
（straggler 慢节点检测——**千卡集群实测一头慢卡能拖掉整机 20%+ 吞吐**）。

## 十一、版本时间线速记（当背景常识背）

```text
v0.12  2025/05  DeepEP 集成、Multi-Token Prediction(MTP)
v0.13  2025/07  BF16 optimizer state（precision-aware optimizer）
v0.14  2025/09  EP-A2A batch 级通信隐藏（--overlap-moe-expert-parallel-comm）
v0.15  2025/11  HybridEP、FSDP-with-EP
dev    2026/01  激活 offloading 主线、Muon/Layer-wise 优化器、
                DeepSeek-V3.2 / Qwen3-Next 跟进
```

被问"最近 Megatron 有什么新动作"时按这个节奏答，重点是 **MoE 通信隐藏 + 精度 +
FSDP 收敛** 三条线还在演进。

## 十二、▶ 面试题小结（六道背熟）

| # | 题目 | 记忆锚 |
|---|---|---|
| 1 | 3D 并行配比怎么定 ——**高频** | RankGenerator `tp-cp-ep-dp-pp`；TP≤NVLink；m≥p 且 bubble∝(p−1)/m |
| 2 | MFU 怎么算 ——**高频** | 每 token ≈6N FLOPs；47% vs 论文 52/54.2%（benchmark 未收敛的 caveat 必说） |
| 3 | PP bubble 四层递进 ——**高频** | 加大 m → interleaved → Zero Bubble 拆 wgrad → 尾 embedding wgrad 延后 |
| 4 | Megatron vs FSDP/DeepSpeed ——**中高频** | 性能上限 vs 易用下限 vs 生态；mcore 已内置 ZeRO-1 式 distrib optimizer + 自研 Megatron-FSDP，差距缩到 kernel 上限 |
| 5 | Distributed Optimizer 拆账 ——**中频** | Adam 12N → 12N/DP；通信 allreduce → reduce-scatter + allgather |
| 6 | MoE EP 瓶颈怎么解 ——**中频升温** | EP 瓶颈=token dispatch 通信 → Flex+DeepEP+batch 级 overlap+Folding |

每道题展开素材对照上文对应章节；一两个关键数字（47–48%、54.2%、12N/DP、1.48×、1,233）必须随手能报。

## 十三、手撕练习（→ coding/）

- **读源码动线**：入口 `pretrain_gpt.py` → `megatron/training/` → 拐进
  `parallel_state.py` 读 RankGenerator → 再去 `schedules.py` 看 1F1B 三段；
  全程不超过一个下午，就能背出"我怎么读 Megatron"的面试版本；
- **3D 配比推演**：给 64 卡，写出 4 种 (TP,PP,DP) 配比并口算各下的 bubble 比例，
  再用 RankGenerator 顺序解释哪种合理；
- **Distributed Optimizer 拆账口算**：70B、DP=512，口算 fp32 master + m + v
  各自节省多少 GB；附伪代码说明 grad bucket 怎么分段 overlap；
- 代码实现目录：[coding/](../../coding/)。

## 串联阅读

- 并行切法与通信量推导：[三维并行](./三维并行.md)
- 显存公式与 ZeRO 三阶段：[ZeRO 与显存优化](./zero与显存优化.md)
- 框架横评与稳定性工程：[训练框架与稳定性](./训练框架与稳定性.md)
- 所有显存数字的统一口径：[显存计算专题](../显存计算专题.md)
- 全景索引：[考点地图](../README.md)

---

*源码路径与 flag 名称 2026-10-09/10 实测核实于 main 分支；main 移动很快，
引用前建议按文中日期再扫一遍对应文件。*
