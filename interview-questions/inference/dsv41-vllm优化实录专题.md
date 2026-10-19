# DSv4.1 × vLLM 优化实录专题：三周把 Agentic 吞吐做到 5.3 倍

> 面向已经读过 [vLLM 与推理加速核心](./vllm与推理加速核心.md) 与
> [长上下文推理与 KV 体系](./长上下文推理与kv体系.md) 的读者。本篇拆解
> vLLM 官方博客（2026-10-07）：DeepSeek-V4.1 发布三周内，Inferact 与
> vLLM 社区把 SemiAnalysis AgentX 上的 agentic serving 做到**相对
> day-0 低延迟 1.9 倍、高吞吐 5.3 倍，100K 吞吐档 P90 TTFT 从 1.86 秒
> 降到 0.32 秒（降 5.8 倍）**。两类武器：**SWA bounded replay**
> （拿可控近似换掉 SWA KV 的存储与 prefill 代价，decoder 侧 21–39 层
> 只跑最后 128 token）+ **Kernel 端的融合与并行族**（Mega-mHC /
> Mega-Gate / MegaAttention 等，单项 1.14–2.1 倍）。读完获得：
> ① bounded replay 的机制与精度边界；② breakable PIECEWISE 为什么
> 是修剪层的救星；③ 两档部署配方（低延迟 TP4+FlashInfer / 高吞吐
> DEP2+DP attention）及其背后的 KV 复制账；④ 全套数字锚。
>
> **口径声明**：全部加速比与配置为 vLLM 官方博客口径（GB300 NVL72，
> 精度以 GSM8K/GPQA 复测「约 1.5 个标准误内无伤」为凭），未独立复测。

## 一、模型底子：为 agentic 而生的 V4.1

CED（causal encoder-decoder）架构，decode 每 token 只激活 16B 参数、
prefill 8B；KV 压到极致：CSA2 + FP4 KV + 层间共享，**全局 KV 只有
每 token 约 890 字节**。vLLM 的工作是把模型侧优化与引擎侧优化叠乘。
（对照仓库 [推理引擎 2026 新进展](./推理引擎2026新进展.md)：这是
「为 Agent 负载重塑 KV 形态」趋势的最完整样本。）

## 二、SWA bounded replay：两个代价与一次 128 token 的重放

V4.1 同时维护两种 KV：全局 KV（压缩+共享+FP4，890 B/token）与
**SWA KV**（不压缩、FP8、覆盖 40 层中每层最近 128 个位置）。SWA KV
带来两大账单：

1. **存储账**：prefix caching 要在每个命中边界存 SWA KV，存储量超
   全局 KV 的 10 倍；
2. **prefill 账**：prefix 命中后要跑 21–39 层的 SWA 部分，即使 decode
   只读它们的最后 128 个位置。

精确重算不可行（跨 L 层重建 ≈ 重跑 L×128 token）。bounded replay
用近似换效率：**只重跑最后 128 token，并在重放起点把 SWA 窗口截断**
——不是 bit-exact，但 DeepSeek 报告质量损失可忽略，vLLM 在 GSM8K/
GPQA 复测确认（约 1.5 个标准误以内）。

两个落点正好对上两本账：

- **Encoder 侧（省存储）**：replay 只缓存全局 KV；prefix 命中长度 H
  时重跑 [H−128, H) 重建 SWA KV——一次窗口 prefill 换掉 10 倍缓存；
- **Decoder 侧（省 prefill）**：CED 里第 20 层产出 decoder 全局 KV，
  21–39 层复用它——第 20 层跑全部 token，**21–39 层只跑每个请求的
  最后 128 token**：长 prompt 下等于跳过近半个模型。

## 三、救星 breakable PIECEWISE：修剪层也能进 CUDA graphs

修剪后 21–39 层的 GPU 活太小：eager 跑 launch 开销主导、GPU 空转；
且它们的输入形状与 0–20 层不同，进不了同一张 CUDA graph。vLLM 的
**breakable PIECEWISE graph** 本来就允许在模型中间断开捕获，正好当
天然切分：**0–20 层按完整 batch 捕获，21–39 层按修剪后小 batch 单独
捕获**。效果：

- 修剪后的 prefill 也能吃 CUDA graphs，graph 覆盖率更高；
- 实测解码 replay + graphs 让 **prefill 计算时间降 30–40%**（官方口径）；
- 但注意条件：**短 prompt 下 launch 开销是瓶颈，不开 graphs 时 replay
  反而比 baseline 慢**（DEP2 上 1K prompt 最多少 12%）；长 prompt 的
  GPU 活足够盖住 launch 开销，eager replay 已拿大头。

启示是普适的：**任何「把模型算小」的优化（剪枝、稀疏、短窗），收尾
都要把「剩下的活太小、被 launch 开销吃掉」一起处理**，否则净收益
可能为负。

## 四、Kernel 族：融合与多流（单项 1.14–2.1 倍）

DeepSeek 开源三个 kernel 仓（DeepSelect/DeepGEMM/FlashMLA），vLLM
集成了主线，把 decode 路径一层的主流 kernel launch 从 24 次降到 16 次：

| Kernel | 融合了什么 | 收益（官方口径） |
|---|---|---|
| Mega-mHC | mHC 链 post 步+delayed-pre 步+RMSNorm 合一（替代 TileLang） | GB200 上比 TileLang 快 **1.14–1.51×** |
| Mega-Gate | MoE router（gate GEMM+打分+bias+top-k）成一 kernel，省一次分数内存往返 | 中 batch **1.18–1.31×** |
| MegaAttention | query RoPE+稀疏 attention+逆 RoPE+FP8 cast 一 launch，直写输出投影 buffer；读 NVFP4 KV（比 FP8 小 45%） | kernel 效率再 **1.45×** |
| WO-A（Blackwell 小 batch） | 逆 RoPE+FP8 量化+WO-A batch GEMM+MXFP8 重量化（CuTe-DSL） | 最高 **2.1×**，ITL −6~7% |
| 稀疏 MQA logits | indexer 只在 16K 候选 block 上算分，不再随上下文增长 | 每层 512K 快 **14–23 倍**；4×GB300 decode +3~6%，prefill 1M 上下文快 2 倍 |
| Engram 异步预取 | n-gram FP8 大表 host offload，查询与 decode 计算重叠；THP 降缺页 | prefill 查询 kernel 最高 **10 倍** |
| mHC 多流 | 下一个 mHC 系数 GEMM 只读已存在的 residual，放 side stream 与 attention/FFN 并行 | TP4 低延迟 −4% |

## 五、两档部署配方（直接可拿走）

- **低延迟档：TP4 + FlashInfer attention**。小 batch decode 吃内存
  带宽，权重分四卡刚好；MegaAttention 的强项在大 batch 融合空间，
  TP4 下收益小，实测 FlashInfer 更快——**「最强 kernel」不是按名字
  选，是按 batch 形状选**。
- **高吞吐档：DEP2 + DP attention**。V4.1 所有 head 共享 KV latent，
  TP 会在卡间复制 KV；DP 不复制（每卡只存自己服务的请求的 KV），
  session affinity 保住跨轮 prefix 局部性；叠加 MegaAttention 的
  NVFP4（每请求 KV 再省近半），单卡并发更高。
  ——这正是仓库 [DCP 解码上下文并行专题](./dcp解码上下文并行专题.md)
  「TP 复制 KV vs DCP/DP 不复制」在同一模型上的生产级姐妹证据：
  **对共享 latent 的 MLA 系模型，KV 复制一分都要清算**。
- V4.1 内存效率高到**整个 AgentX 测试都不需要 KV offload**；更高
  并发+PD 分离后排 offload 才开始有用（与
  [kv-offload与分层存储专题](./kv-offload与分层存储专题.md) 的
  「offload 有收益条件」互证）。

## 六、总账数字锚（官方口径，可背）

| 指标 | day-0 | 三周后 | 倍率 |
|---|---|---|---|
| AgentX 吞吐（155 tok/s/user 档） | 27k tok/s/chip | 144k tok/s/chip | **5.3×** |
| 最高 P90 interactivity | 311 tok/s/user | 599 tok/s/user | **1.9×** |
| 100K 吞吐档 P90 TTFT | 1.86 s | 0.32 s | **降 5.8×** |
| prefill 计算（replay+graphs） | — | −30~40% | — |
| decode 主流 kernel launch/层 | 24 | 16 | — |
| NVFP4 KV vs FP8 | — | 小 45% | — |

三项 TTFT 优化的叠加逻辑：bounded replay 让模型上半只处理最后 128
token（prefill 计算近乎减半）、CUDA graphs 让修剪后的小 replay 跑在
GPU 而非卡在 CPU launch、kernel 改进加速计算本身——**近似、调度、
kernel 三层各自独立、各自可证，叠加成 5 倍**。

## 六·增、A2 速记：H20 与 SGLang 两条实录

- **DeepSeek-V4-Pro on H20（119）**：按上下文切 PP2/PP4；decode 分
  PP2-TP8 与 DP32-EP32；batch1 **271 vs 383.7 tok/s**；1M **43.7s**。
- **V4.1-Flash SGLang 调优（159）**：修 GEMM 派发、融合小算子、mHC
  重叠，verify 按 6 行重做；**35→873.6 tok/s**；EP4 **854.6 vs TP4
  873.6**。

## 七、▶ 面试题与追问

**Q1【高】SWA bounded replay 是什么？为什么不是精确重算也敢上？**
SWA 的逐层 128 token 窗口使 prefix 命中的存储与 prefill 双重昂贵；
精确重算窗口要重放 L×128 token。bounded replay 只重放最后 128 并在
起点截断窗口，非 bit-exact 但 GSM8K/GPQA 分差在约 1.5 个标准误内——
**「近似换取」要附带精度复测报告才算闭环**。

**Q2【高】为什么「把模型算小」之后还要专门处理 launch 开销？**
算子变小后每次 kernel 的计算时间可能低于 launch 平均成本，eager 路径
GPU 空转——实测短 prompt 下不开 CUDA graphs 的 replay 比 baseline 还
慢 12%。工程答案：修剪/稀疏/短窗类优化必须与图捕获或融合成对出现
（本例 breakable PIECEWISE 让不同 batch 形状分段捕获）。

**Q3【中高】21–39 层为什么能只跑最后 128 token？**
CED 架构里 decoder 的全局 KV 由第 20 层产出，21–39 层的 SWA 只读
每层最近 128 个位置——其余位置的输出永远不会被后续消费，算它们
是纯浪费。**「只算会被读到的部分」是 replay 的本质**，KV 可见性分析
给了合法性。

**Q4【中高】低延迟档为什么选 TP4+FlashInfer 而不是 MegaAttention？**
小 batch 下 decode 是带宽 bound，融合 kernel 的收益空间（消 HBM
往返）被 batch 小限制，而 TP4 的权重分片与 FlashInfer 的低开销
更合口味；MegaAttention 的优势在大 batch 融合空间。**kernel 选型
按 batch 形状，不按论文顺序**。

**Q5【中高】高吞吐档为什么用 DP attention 不用 TP？**
V4.1 全系共享 KV latent：TP 会在每个 rank 复制 latent KV，吞吐被
显存按住；DP 每卡只存本副本请求的 KV，零复制，session affinity 还
保住 prefix 局部性——叠加 NVFP4 再砍一半 footprint。**共享 latent
模型的吞吐上限由 KV 复制决定，不由权重分片决定**。

**Q6【中】稀疏 MQA logits 为什么能 512K 快 14–23 倍？**
原实现先算完整上下文的分数再 mask 掉非候选 block，代价随上下文
线性涨；稀疏实现只在固定 16K 候选 block 上算分，代价与上下文
**脱钩**——越长上下文加速比越大。这类「把 mask 前移」的优化是
稀疏 attention 的通用第一刀。

## 八、串联阅读

- [推理引擎 2026 新进展](./推理引擎2026新进展.md)：「为 Agent 负载
  重塑 KV 形态」的宏观趋势，本篇是它的最完整案例；
- [DCP 解码上下文并行专题](./dcp解码上下文并行专题.md)：MLA 系
  latent 的 KV 复制账，与本篇第五节的 DP 选择互证；
- [Vera Rubin 调优实录专题](./vera-rubin调优实录专题.md)：同一套
  「launch 合并/隐藏拷贝/scheduling」手法在新硬件上的姊妹实录；
- [Attention 的 Profile 实战专题](../attention的profile实战专题.md)：
  融合为什么快的底层（少 HBM 往返），本篇 Kernel 族是它的批量应用；
- [稀疏注意力专题](./稀疏注意力专题.md)：SWA/稀疏 logits 的算法
  版图。

## 口径与未核实说明

- 全部倍率（5.3/1.9/5.8×、30–40%、1.14–2.1×、10 倍、45%）为 vLLM
  官方博客 + Inferact 数据（SemiAnalysis AgentX, GB300 NVL72），未
  独立复测；「约 1.5 个标准误内无伤」为官方 GSM8K/GPQA 复测口径。
- DeepSeek-V4.1 的命名与内部结构描述（CED、CSA2、Engram、mHC 链）
  以原文为准；TP4/DEP2 配方是基于 AgentX 负载的结论，换负载要重测
  形状。SWA bounded replay 默认对 V4.1 开启（`--[no-]swa-bounded-replay`）。
