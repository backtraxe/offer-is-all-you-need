# Kernel Agent 竞赛复盘专题：胜负手是 harness 工程，不是模型

> 面向已经读过 [Harness 工程实战](./harness工程实战.md) 与
> [Agent 评测与观测闭环专题](./agent评测与观测闭环专题.md) 的读者。
> 本篇拆解 MLSys 2026 NVIDIA 赛道 FlashInfer AI Kernel 生成竞赛的
> 参赛复盘（2026-10 转述）：同一批 coding agent、两条路线——
> **Agent-Assisted 五个算子全部超过 FlashInfer 基线（最高 29.68×）**，
> **Full-Agent 只在部分算子有效、两个算子跌破基线**。核心结论一句话：
> kernel 生成的胜负手不是模型，是**人和 agent 怎么在可验证闭环里
> 分工**。读完获得：① LLM4Kernel vs Agent4Kernel 的路线版图；②
> Agent-Assisted 闭环 harness 的四层结构；③ Full-Agent 什么时候
> 撑不住（MoE FP8 只有基线的 0.27）；④ 「长平台期 + 离散跳变」的
> 优化轨迹读法；⑤ 6 道 agent 工程面试题。
>
> **口径声明**：榜单名次为官方 Top-3；分算子加速比为团队本地
> （Modal B200）评估口径，原文明示「非官方分赛道计分、GPU 频率未
> 完全锁定」，引用时同标。

## 一、路线版图：LLM4Kernel vs Agent4Kernel

生成 GPU kernel 的难点不止「写出像样代码」：候选实现要同时**语义
正确、编译成功、覆盖目标形状、真实 GPU 上比现有实现更快**。
KernelBench 给评估三维（编译/正确性/性能）；FlashInfer-Bench 把它
放进真实推理负载分布（trace 格式的闭环）。

综述（Yu et al., 2026）把路线分两支：

- **LLM4Kernel**：用 CPT/SFT/RL 把 kernel 知识训进模型参数——
  依赖高质量数据、稳定奖励、可观训练成本；
- **Agent4Kernel**：用迭代搜索、外部记忆、多智能体编排、自动化
  评估让现有 coding agent 在**闭环 harness** 里持续产出——本次的
  参赛路线；Meta 的 KernelEvolve（持久知识库 + 检索 prompt +
  跨硬件抽象）是工业侧的互证。

**判标签的口径**：不是用不用 LLM，是**人是否持续介入搜索过程**。

## 二、两条参赛路线与全部战绩（官方 Top-3 + 本地表）

| 维度 | Agent-Assisted | Full-Agent |
|---|---|---|
| 人的参与 | 持续设计策略、提供参考实现、选优化方向、维护晋升规则 | 只给初始任务、约束与自动化工具，搜索全自动 |
| 搜索方式 | 按画像与经验选候选实现家族，聚焦高置信局部优化 | 计划-执行-评估-总结-入库的长程循环 |
| 状态管理 | 人工维护笔记、技能、实验档案 | LoongFlow 式持久数据库（来源/结果摘要/最优/失败模式） |

官方 Top-3 榜单：Track A Fused MoE 第 3（Agent-Assisted）、
Track C Gated Delta Net 第 3（Agent-Assisted）与第 2（Full-Agent）。

本地对照表（Modal B200、相对 FlashInfer 官方基线，作者口径）：

| 算子 | Agent-Assisted | Full-Agent | 基线 |
|---|---|---|---|
| DSA Attention | **29.68×** | 14.54× | 1.00× |
| DSA Indexer | **18.05×** | 3.81× | 1.00× |
| GDN Prefill | **13.70×** | 1.03× | 1.00× |
| MoE FP8 | **1.62×** | **0.27×（跌破）** | 1.00× |
| GDN Decode | **1.12×** | **0.83×（跌破）** | 1.00× |

Agent-Assisted 全胜；Full-Agent 三个有效、两个跌破。差距说明：**高质量
人工参考实现 + 持续积累的轨迹记忆，比 agent 从零探索更高效**——
harness 不接地，agent 就是在黑暗里乱试。

## 三、Agent-Assisted 闭环 harness 的四层结构

1. **接地输入**：算子定义、参考实现、负载 JSON 全部给齐——
   「先有上下文，再谈生成」；
2. **形状发现**：按 batch/seq 把负载分组，每组采样代表性形状——
   **不用每次跑完整验证就能快速迭代**（这就是「形状画像吃进 harness」）；
3. **闭环优化**：基线 → 画像 → 诊断 → 生成 → 评估 → 归档；
   验证三件事：能编译、结果正确、性能更优；分析工具上 Torch
   Profiler + Nsight Compute（NCU）沿
   [Attention 的 Profile 实战专题](../attention的profile实战专题.md)
   的思路查瓶颈；
4. **产物归档**：代码、指标、失败原因全量入库，回灌下一轮——
   **harness 的真正资产是可检索的历史**。

对照仓库 [Harness 工程实战](./harness工程实战.md)：这正是其中
「评估闭环 + 晋升规则」在 kernel 域的完整展开——优化技能由人写、
评估脚手架由人搭，agent 在框内迭代。

## 四、Full-Agent 为什么跌破：搜索失败的两个指纹

- **MoE FP8（0.27×）**：agent 走了自以为优化的弯路径且没有人工
  晋升规则兜底——**没有「保留最优」的闸门，坏候选也能被留住**；
- **GDN Decode（0.83×）**：基线已经很硬，零起点的进化搜索找不到
  更优点——**参考实现的缺失在长平台期里无可救药**。
- 共性：**严格最终验证必须有，但**「最终阶段的正确性检查」挡不住
  「中间搜索路径的整体漂移」，所以要在 harness 里沉淀失败模式
  （Full-Agent 的 LoongFlow 数据库就是对的方向，只是还不够）。

## 五、轨迹的形态：长平台期 + 离散跳变

Agent-Assisted 的保留加速比轨迹不是平滑爬坡，而是**长时间平台期 +
 少数几次大幅跳变**——性能提升发生在「某个关键改动被抓住」的瞬间。
工程含义：

- 别按步数评估 harness，要按「能不能撞出下一个跳变」评估；
- 跳变来自哪里：一次正确的画像→正确的候选家族换一个**实现策略**
  （不是调参）——所以「负载画像吃进 harness」是撞跳变的主要机械；
- Agent agent 目标不是「多生成」，是**在正确的家族里局部挖掘**——
  这正是「高分区方案的共性不是盲目尝试更多 kernel，而是先吃透
  负载分布」作者的总结。

## 五·增、产业界的工程化版：SGLang 把工程经验编码成 Skill

2026 年 SGLang 团队公开了「用 agent 优化自家引擎」的实践
（多源转述其官方博客口径：AI圈的9527 微信文、腾讯云开发者社区
文章、知乎调研帖，本仓未直接核对 SGLang 官方原文），与本文的
竞赛数据正好组成**竞赛 vs 生产**双案例：

**做了什么**：把团队的 kernel 工程经验沉淀成 Agent Skills——
`debug-cuda-crash`（CUDA 崩溃排查）、`llm-torch-profiler-analysis`
（性能分析）、`sglang-sota-humanize-loop` 等结构化技能，让 agent
按「Profile 抓取（torch.profiler / NCU / SGLang tracing）→
任务拆解（如识别多余中间结果写显存，触发 Op Fusion）→ 生成
（csrc/ 下 CUDA C++ 或 Triton + AOT 扩展绑定）→ 验证回流
（编译/基准/NCU 指标迭代）→ 沉淀（Kernel Hub / AOT wheel /
get_kernel）」的流水线自跑——**闭环验证（RLCR / Judge 机制）**
是它区别于「一次性生成」的关键：依据「访存受限还是算力受限」
自主决定下一步。

**数字锚（均为团队自报，未复测）**：B200 上单算子
（qknorm_rope / norm_infer 等）加速 1.13x~2.75x；
Qwen3-Next 端到端吞吐 +71.4%、TTFT 456ms→168ms；
Diffusion 侧（Z-Image / Qwen-Image）吞吐与 TTFT 同步改善。

**生态对照**：KDA（Kernel Design Agents，MIT Han Lab 等开源）
专做 FlashInfer/SGLang 体系内的多轮证据驱动优化；CUDA Agent
走大范围 Agentic RL，KernelBench 上超 torch.compile 基线。

**国产注脚（MusaCoder，2026-10 解读帖转录，自报口径）**：摩尔线程把
kernel 生成模型的全栈训练第一次落在国产 MUSA 上——SFT 三阶段（任务
扩展与基础算子正确性 → 加显式张量元数据与六步推理模板压形状、索引、
边界类失败 → 合成 reviewer、性能分析、优化重写、多轮修复数据）、保
多样性的 RFT（同 prompt 的正确实现聚类、训练时随机采样监督目标，防
过早塌缩进固定模板、给 RL 留探索空间）、再到执行反馈 RL。验证环
MooreEval 是本条含金量所在：编译与执行彻底解耦（CPU 侧编译资源、
GPU 侧验证各自独立扩缩）；四关校验——可解析可编译、随机输入的
shape 与数值对齐 PyTorch 参考、**静态规则加运行时 profiling 双查
ModelNew.forward 里回调 PyTorch 或 aten 算子的反作弊**、warmup 后
CUDA event 重复计时降方差；三项 RL 稳定机制（PrimeEcho 锁定首轮生
成质量、Buffered Dynamic Retry 把全失败组变成可学习样本、MirrorPop
更准估计离策略漂移稳定更新）。自报数字：MusaCoder-27B-RL 在
KernelBench 严格协议 Pass@8 93.2%、Avg@8 88.6%，声称超 Claude
Opus 4.7，全程跑在 64 台 MTT S5000 上。与本课题口径纪律的互文：
它把「verifier 要硬、反作弊要明、基线要公」三件事都做在了台面
上——正面版的可信自报模板。

**反例同框（口径纪律）**：同赛道的 Sakana AI CUDA Engineer
（闭源：PyTorch 翻译成 CUDA 再进化优化、LLM verifier 判正确性）
其对外宣称的大幅加速被 Answer.AI 等团队质疑——与本文 §四
「Full-Agent 跌破指纹」同根：**没有接地、没有公平基线、verifier
不硬，加速倍数就只是营销数字**。引用 SGLang 数字时建议主动
带这一条对比，显示口径意识。

**与竞赛结论互表**：本文 §二~§三说「高质量参考实现 + 轨迹记忆 >
从零探索」，SGLang 的实践是它的工业注脚——它的「经验」不是
凭空喂 prompt，而是**固化成 skill 文件 + 绑定真实 profiling
工具 + 沉淀 AOT 产物库**三件套。harness 的可检索历史资产，
在生产侧对应的就是 skill 库与 kernel 库的持续积累。

## 五·增二、产业界的第二案例：TokenSpeed-Kernel——把 kernel 变成一等公民

第一个产业案例（SGLang Skills）回答「**让 agent 怎么产 kernel**」；
2026-06 PyTorch 官方博客发布的 TokenSpeed-Kernel 深度文（AMD Triton
Team 与 TokenSpeed Team 联署，官方一手口径，本仓未复测）回答另一半：
「**agent 产的 kernel 落进引擎，需要什么样的承接结构**」。纲领一句
——「make kernels a first-class subsystem rather than a collection of
hidden fast paths」：kernel 不是引擎里散落的隐藏快路，而是一个有
公共 API、有注册表、有选择器、有验证基准护栏的一等公民子系统。

背景一句话：TokenSpeed 是 LightSeek 基金会（非商业公司，NVIDIA/AMD
均投工程力量）2026-05 发布的 agentic 推理引擎，目标「TensorRT-LLM 级
性能 + vLLM 级易用」；2026-08 入选 PyTorch Ecosystem。与本篇的扣合点
是博客原文点破的一句：这套结构 gives kernel development for AI
agents a clearer work boundary——try a kernel, verify it, benchmark
it, and register it without reshaping model code——**试、验、测、注
册四步全程不碰模型代码**，正是 §三闭环想要的产业级管道。

### 机制四件套（一等公民的四根柱子）

```text
   runtime（模型执行、调度、page table —— 始终平台无关）
        │ 只描述算子问题：mha_prefill / mha_decode_with_kvcache / moe_apply
        ▼
   选择器：平台能力 / 格式签名 / traits 三重过滤 → priority 排序 → 命中缓存
        │
        ├─ tokenspeed-kernel（NVIDIA：trtllm / cuteDSL / 便携 Triton）
        ├─ tokenspeed-kernel-amd（Gluon 写的 CDNA4 内核）
        └─ out-of-tree 插件（同一 @register_kernel 注册，同台竞争）
   [每条注册声明：算子族/方案/签名/traits/优先级 → 通行 numerics/基准/profile 护栏]
```

1. **分层公共 API**：runtime 只调平台无关接口，只描述「算子问题」
   （张量、格式、模型 traits、约束），从不点名后端；
2. **注册即声明**：`@register_kernel` 装饰器声明算子族、方案名、
   平台能力要求、张量格式签名、traits、优先级——注册表是**唯一事实源**；
3. **选择器**：运行时按三重条件过滤、按优先级排序、返回 callable，
   同模型×平台×dtype×traits 组合命中后缓存；调试/基准可强制指定方案；
4. **迭代护栏**：参考实现做 numerics 对照、独立基准不开全服务器也能
   跑、profiling 让「选中了哪个 kernel」出现在端到端 trace；CLI 与
   serving 复用同一套注册元数据——**注册到选择一条管道**；插件走
   同一装饰器自带优先级，与 in-tree 内核同台竞争。

补一句引擎侧架构账（面试加分项）：TokenSpeed 是**把控制面/执行面
拆开的首个开源推理引擎**（PyTorch 基金会收录时的自述口径）——控制面
用 C++ 写成有限状态机，请求生命周期与 KV 所有权由类型系统在编译期
管住；执行面留 Python 保迭代速度。

### 实战账：GPT-OSS 120B on AMD MI355X（官方口径）

模型本身就是考场：attention 带 attention sinks + 滑动窗/全量层混合，
MoE 是 128 专家 top-4、MXFP4 权重 + FP8 激活——这些细节全压在公共
API 之下，模型代码不知道 CDNA4 架构。AMD 侧用 Gluon（Triton 家族
DSL，显式控制 scaled MFMA、异步拷贝、软件流水）：

- attention prefill（bf16、head_dim 64）：15 个测点 14 个最快，
  1.4–2.3 倍于 Triton 基线、1.1–1.3 倍于 AMD 官方 AITER；
- MoE decode 按批量分档：小 batch 用 warp-decode 把 top-k 路由**融进
  gate/up 投影单次启动**（瓶颈是 occupancy），1.7–2.1 倍于 Triton、
  1.1–1.6 倍于 AITER；中批量切 direct grouped GEMM（单缓冲直读换低
  寄存器/smem 压力保 occupancy），该段 AITER 略胜、Gluon 保住 0.9x
  ——**不是每格都赢，且公开写出来**；
- 端到端 20 个测点全胜：输出吞吐 1.6–3.6 倍于便携 Triton 路径（TP1
  单卡、prefix 关闭、EvalScope 口径；commit 1492030 / ROCm 7.2.1 /
  AITER 0.1.13 配置全公开）；
- 同一 API 的多硅对照：NVIDIA 侧同一 runtime 调用，底下是 FlashInfer
  包装的 trtllm MHA / MoE 方案——**AMD 性能不是另起一条 serving
  路径换来的，是 Gluon 内核注册进同一注册表换来的**。

### 怎么接回本篇主线（面试收束）

- SGLang 的 Kernel Hub / AOT 产物库是**横向沉淀**（谁的 kernel 都能
  入库），TokenSpeed 的 registry+numerics+bench 是**纵向海关**（kernel
  进 serving 的必经关卡：声明能力→校验数值→基准测量→排队被选）——
  产业闭环的两个半环都齐了；
- §三说评估与晋升层最难做，TokenSpeed 把这两层直接做成了引擎基础
  设施——**agent 产 kernel 的终点站不该是 git 分支，是 kernel registry**；
- 口径纪律同框：TokenSpeed 公开配置与全部形状矩阵（对照 §四 Sakana
  反例的「宣称加速、语焉不详」），产业级可信的方法论就是**数字 +
  配置 + 形状榜单三件全公开**；
- kernel 层独立成可复用资产的注脚：`tokenspeed-kernel-amd` 单独
  pip 发布后**已被 vLLM 采用**（官方博客口径）。引擎侧完整叙事见
  [推理引擎 2026 新进展](../inference/推理引擎2026新进展.md) 的第八条
  收敛趋势。

## 六、▶ 面试题与追问

**Q1【高】给一个「让 agent 写 kernel」的需求，你会先建什么？**
先建可验证闭环：参考实现（正确性对照）、负载画像（形状分组采样）、
自动评估（编译/正确性/性能三维）、晋升规则（保留最优且只保留最优）、
产物归档（失败模式入库）。**没有这五件，模型再强也是在黑暗里试**。

**Q2【高】Agent-Assisted 和 Full-Agent 的本质差距在哪？**
不在于谁写代码，在于**搜索过程中的接地与闸门**：参考实现给初始
梯度方向、画像把搜索聚焦到正确家族、晋升规则挡住坏候选留存。
人工持续介入把「长程漂移」截断；全自动时漂移只能靠失败数据库
事后补救。

**Q3【中高】「长平台期 + 离散跳变」怎么指导 harness 设计？**
别期待稳步提升；目标是撞下一个跳变：换实现策略（换家族）才出
跳变，调参不会。harness 要做到：能识别平台期（评估指标停滞）、
能支持换家族（画像驱动的多族候选）、能留存跳变（晋升规则 +
最优档案）。

**Q4【中高】LLM4Kernel 和 Agent4Kernel 怎么选？**
短跑竞赛/算子域窄/手头没有训练管线：Agent4Kernel（本届冠军路径）。
长期资产/算子域覆盖广/有数据与训练预算：LLM4Kernel 打底 •
Agent4Kernel 搜索。**「先 harness 后训练」**是这篇的一致口径。

**Q5【中】KernelBench 的三维评估为什么必要？**
只有「正确+通过形状覆盖+真实更快」三者都满足，kernel 才算优化；
很多看似成功的候选是在「编译通过但慢」「快但错」「对但没覆盖
目标形状」里三选一。评估必须按形状分组且相对**真实负载分布**
做——单点 micro-benchmark 测不出三者。

**Q6【中】kernel 优化 harnesss 的「形状画像」具体做什么？**
按 batch/seq/dtype 把负载分组、每组抽代表形状、每组内部量加速比
的稳定性——**防止「只在某个形状上好」**；分组结果也决定后段
调度（这篇的算子优化按 batch 大小选 flashinfer vs MegaAttention，
与 [DSv4.1 实录](../inference/dsv41-vllm优化实录专题.md) 的
TP4/DEP2 配方完全同构）。

**Q7【中】生产团队也这么干吗？有实例吗？**
「SGLang 把工程经验编码成 Skill 让 agent 自优化（§五增）——
B200 单算子 1.13x~2.75x、Qwen3-Next 吞吐 +71.4%、TTFT 456→168ms
（自报口径）。它的可信之处恰恰在管线不是口号：profiling 工具
绑定、RLCR 闭环验证、AOT 产物沉淀三件套齐活；反例是 Sakana AI
CUDA Engineer 的加速宣称被 Answer.AI 质疑——差别就在**基线公平、
verifier 硬度、可复现产物**这三件事上。竞赛篇和产业篇结论一致：
赢的从来不是『让 agent 从零写』，是『把人踩过的坑变成 agent 的
起跑线』。」

**Q8【中高】Agent 生成的 kernel 怎么「落进生产引擎」？**
「SGLang Skill 产 kernel + Kernel Hub 沉淀」只闭环了产线一半；
落进 serving 还要过海关：TokenSpeed-Kernel 把 kernel 做成一等公民
子系统——`@register_kernel` 声明能力/签名/traits/优先级、numerics
对参考实现校验、独立基准 CLI、selector 按请求分发并缓存命中、
profile trace 可见，插件与 in-tree 同台竞争。实战口径：GPT-OSS 120B
on MI355X，attention 1.4–2.3 倍于 Triton、端到端 1.6–3.6 倍、中批量
0.9x 于 AITER 照实公开；tokenspeed-kernel-amd 已被 vLLM 采用。一句话
收束：**agent 时代的 kernel 交付物不是补丁分支，是一条 registry
元数据加一份验证基准记录**。」

## 七、串联阅读

- [Harness 工程实战](./harness工程实战.md)：晋升规则/评估闭环的
  通用方法，本篇是它在 kernel 域的实证；
- [Agent 评测与观测闭环专题](./agent评测与观测闭环专题.md)：评估
  先于生成的口径，本篇的形状分组是它的专项化；
- [Attention 的 Profile 实战专题](../attention的profile实战专题.md)：
  NCU/trace 查瓶颈的底层工具方法（闭环的分析手）；
- [FBTriton 与稀疏算子 Kernel 实战专题](../fbtriton与稀疏算子kernel实战专题.md)：
  负载画像吃决策的同族案例（阈值才赢 5.8×）；
- [GEMM 优化阶梯专题](../gemm优化阶梯专题.md)：要优化的东西的
  本体——13 级阶梯是 harness 里「候选家族」的教科书；
- [推理引擎 2026 新进展](../inference/推理引擎2026新进展.md)：§五·增二
  引擎侧的全景——kernel 抽成一等公民子系统已是 2026 引擎收敛趋势之一。

## 口径与未核实说明

- 官方名次（Track A 第 3、Track C 第 3/第 2）为官方 Top-3 榜；分
  算子加速比（29.68/18.05/13.70/1.62/1.12× 等）为团队本地 Modal
  B200 评估、作者明示「非官方计分、GPU 频率未完全锁定」；未独立
  复测。
- §五增的 SGLang 数字（1.13x~2.75x / +71.4% / 456→168ms）为多源
  二次转述的团队自报口径（本仓未核对 SGLang 官方原文）；Sakana AI
  被质疑一事为社区公开争议口径，引用时标注「社区质疑、未终裁」。
- §五·增二的 TokenSpeed 数字（1.4–2.3×/1.1–1.3×/1.7–2.1×/0.9x/
  1.6–3.6× 等）为 PyTorch 官方博客一手口径（AMD Triton Team 与
  TokenSpeed Team 联署，2026-06-25），测量配置原文公开（commit
  1492030、ROCm 7.2.1、AITER 0.1.13、形状矩阵逐条列出）；本仓未复测。
  「vLLM 采用 tokenspeed-kernel-amd」为该博客自报；「首个拆开控制面/
  执行面的开源引擎」为 PyTorch 生态收录时的自述口径，本仓未逐家排查。
- LoongFlow / OpenEvolve / KernelEvolve / KernelBench / FlashInfer-
  Bench 的引用均为综述与 writeup 口径；「高分区方案先吃透负载
  画像」为作者总结，不是官方评分规则。
