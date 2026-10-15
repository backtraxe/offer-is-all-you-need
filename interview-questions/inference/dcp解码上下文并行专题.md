# DCP 解码上下文并行专题：TP 切 KV 的头数地板与按序列切解法

> 面向已经读过 [推理并行策略决策专题](./推理并行策略决策专题.md)（六种
> 并行策略概览）与 [长上下文推理与 KV 体系](./长上下文推理与kv体系.md)
> 的读者。本篇把其中一个决策点打穿：**Decode Context Parallelism
> （DCP）**——纯 TP 切 KV 缓存有一道「头数地板」，GQA 切到每卡一个
> KV 头就无路可切、MLA 干脆每卡全复制；DCP 改按**序列位置**切。vLLM
> 官方 benchmark（2026）：8 卡 B200 跑 Kimi K2.6，吞吐从 1,863 到
> **6,091 token/s/GPU（超 3 倍）**，并发上限从 64 拉到 512。读完获得：
> ① 头数地板的数学；② DCP 的通信流程（AllGather Q → 本地算 → LSE
> 合并）；③ MLA/GQA 两条后端的**切分度约束公式**；④ 8 道可直接对答
> 的面试题。
>
> **口径声明**：性能数字为 vLLM 官方博客实测（2026-08 发布、2026-10
> 转述核实），平台仅限 8×B200 + Kimi K2.6 NVFP4，未独立复测；其余模型
> 的 DCP benchmark 官方仍在推进。

## 一、TP 切 KV 的头数地板：为什么 MLA 是纯 TP 的最差情形

标准 TP 按**注意力头**切 KV 缓存，一个 KV 头（一整套 K、V 张量）是
能分给一张卡的最小单位：

- **GQA 的墙**：有 K 个 KV 头，最多切到每卡一个头；TP 超过 K 后，
  多出来的 rank 只能**复制**——`tp / num_key_value_heads` 份相同拷贝。
- **MLA 的深渊**：Key/Value 被压成一个所有 query 头共享的低秩 latent
  向量，等效 KV 头数 = **1**，纯 TP 下**根本没有头可切**——latent KV
  在每个 TP rank 上**完整复制一份**。

两种情况下，复制的 KV 都在吃显存：留给新请求的空间所剩无几，并发
上不去，吞吐和单 token 成本一起遭殃。长上下文 Agent 负载（64K–1M
token）把这个矛盾推到极限——KV 体积与输入长度成正比，复制一份就是
复制一座山。

## 二、DCP 的解法：按 token 位置切

不按头切，按**序列维度**切：200K token 的请求，GPU 0 存 0–50K，
GPU 1 存 50K–100K……每加一张卡，每卡的 KV footprint 就缩小一档，
**省下的显存直接换 batch 和并发**。这就是它和 DP 的本质区别：DP 换
吞吐靠的是「更多完整副本」，DCP 靠的是「更少冗余」。

decode 的通信节奏（每步）：

1. **AllGather Q**：拼出完整 query——decode 时 Q 只有一个 token，
   这一步极便宜；
2. **本地计算**：每卡在自己的 KV 序列分片上算 attention（MLA 走
   `k_up` 上投影重建 K/V、GQA 走 tensor broadcast）；
3. **AllGather 结果 + LSE**：各卡上报 partial 输出与局部 log-sum-exp；
4. **重加权合并 + ReduceScatter**：用 online-softmax 技巧按 LSE 重
   缩合并，归约后每卡只拿回自己的头分片。

MLA 的一个可选进一步优化：加载时在 DCP 组内复制很小的 query 投影，
decode 直接跳过第 1 步的 Q all-gather（`VLLM_DCP_Q_REPLICATE=1`）。
**合并数学与 [推理并行策略决策专题](./推理并行策略决策专题.md) 第五节
的 log-sum-exp 重缩放完全一致**——那篇给原理，本篇给工程实现。

## 三、实测数字锚（官方口径，可背但有边界）

设置：单节点 8×B200，Kimi K2.6 NVFP4，公开 Mooncake 格式的 Agent
长上下文 trace——输入中位约 67K token、输出约 400 token，分布双峰，
一半 64K 以上、长尾到 1M。只改 decode 时 KV 怎么切，其余全固定。

| 指标 | 基线 TP8 | DCP（TP8+EP8+DCP8） |
|---|---|---|
| KV 撞墙点 | 并发 64 → 100% 耗尽 | 并发 512 → 仅 82% |
| 峰值吞吐 | 1,863 token/s/GPU（并发 64 封顶） | **6,091 token/s/GPU（并发 512）** |
| 并发 64 时 KV 占用 | 100% | **19%** |
| 200K+ 序列档 | 无法扩展 | 前沿与短档几乎重合，依然稳定 |

吞吐-交互性 Pareto 前沿上 DCP 整条线压过基线：高并发吞吐继续涨的
同时，每用户输出速度仍留在可交互区间；基线在并发 64 之后**直接没
有点**（加不进请求）。**结论形态**：DCP 的收益随「序列长度 × 并发」
放大，trace 越长越吃香。

## 四、两条后端的约束公式（面试收束点）

| 后端 | 模型例 | 切分度上限 | 约束 |
|---|---|---|---|
| **MLA** | DeepSeek-V2/V3/R1、Kimi K2.x | 序列切分可到满 TP 度 | `tensor_parallel_size ≥ decode_context_parallel_size` 且**能整除** |
| **GQA** | Qwen3-235B、Llama 系 | **复制因子** `tp / num_key_value_heads` | 例：TP8 + 4 个 KV 头 → DCP 最大 2 |

读法：MLA 是纯 TP 下「整块缓存全是冗余」的最差情形，因而是 DCP 的
最大受益者——整块都是冗余，整块都能按序列切；GQA 的 DCP 不是无限
切，只是把**本来要浪费在复制上的位置**填上不同的序列分片，所以
上限恰好等于复制因子。一句话：**DCP 把 TP 的冗余预算全部变现**。

工程用法：vLLM 里只加一个参数 `decode_context_parallel_size`，与
已有 `tensor-parallel-size` 搭配；离线 API 与在线 serve 同一开关。

路线图上值得知道的三件事：更细粒度的 TP/DCP 度数（收回过度切分
的浪费）、更强的 DCP all-to-all kernel（单节点与多节点）、向更多
模型扩展并把 **PCP（Prefill Context Parallelism）**纳入路线——
NVIDIA 在 TensorRT-LLM 的 Helix Parallelism 是同一方向的类似工作。
诚实边界：上述数字只在 8×B200 + K2.6 一组合跑出，其他模型/其他
互联下要重测，尤其 all-gather 的带宽成本在非 NVLink 拓扑上会换
结论。

## 五、和仓库既有知识怎么拼

- 与 [推理并行策略决策专题](./推理并行策略决策专题.md) 的关系：该篇是
  决策地图（什么时候考虑 DCP），本篇是 DCP 的实现深挖（头数地板、
  通信流程、约束公式）——先决策、后实现。
- 与 [MLA 深度穿透专题](../llm基础/mla深度穿透专题.md) 的关系：MLA 的
  latent 账（64KB vs 1.13KB 每 token）解释了为什么 MLA 的 KV 总量
  小、却仍是纯 TP 的最差情形——**总量小不等于能切分**，两个维度别混。
- 与 [负载均衡专题](../负载均衡专题.md) 的关系：DCP 组内是集合通信，
  组间仍是请求级路由——两层负载均衡各管一段。
- 与 [双向 KV 传输与多轮复用专题](./双向kv传输与多轮复用专题.md) 的
  关系：同一场考试的两张答卷——一个解决「decode 的 KV 被 prefill
  浪费」（时间维），一个解决「KV 被 TP 复制浪费」（空间维）；高并发长上下文
  服务两者可叠加。

## 六、▶ 面试题与追问

**Q1【高】MLA 模型做 TP，KV 缓存会发生什么？为什么这是个问题？**
MLA 等效只有一个 KV 头（所有 query 头共享一个 latent），纯 TP 按头
切无从下刀，latent KV 在每个 rank 上完整复制一份。模型参数被 TP
均摊得再漂亮，KV 这坨显存一分钱没省——长上下文高并发时它恰恰是
主要矛盾。

**Q2【高】DCP 怎么解决这个复制问题？通信流程是什么？**
改按序列位置切：200K 的请求拆成 N 段，每卡只存 1/N 层 KV。decode
每步：AllGather Q（1 token，便宜）→ 各卡在本地分片上算 attention →
AllGather partial 输出与 LSE → online-softmax 重加权 + ReduceScatter
归并，每卡只留自己的头分片。省下的显存直接换成并发：官方 8 卡案例
从并发 64/KV 100% 到并发 512/KV 82%。

**Q3【中高】DCP 的收益边界在哪？什么时候不值？**
收益 ∝ 序列长度 × 并发：短上下文、低并发时 KV 本来就不紧，每步多
一次 AllGather 是纯开销；互联带宽不足（非 NVLink 拓扑）时 all-gather
成本上涨，结论要重测；GQA 模型的上限被复制因子锁死（tp/kv_heads），
KV 头多的 GQA 收益自然小。

**Q4【中高】GQA 模型的 DCP 切分度上限怎么算？**
等于 TP 的复制因子：`decode_context_parallel_size ≤ tp /
num_key_value_heads`。Qwen3-235B 是 4 个 KV 头，TP8 → 2 份冗余
拷贝 → DCP 最大 2。逻辑：DCP 只是把「本来浪费在复制上的位置」换
成不同的序列分片，没有冗余就没有可变现的预算。

**Q5【中】MLA 的 DCP 为什么能切到满 TP 度？**
因为 MLA 的「KV 头数」是 1——纯 TP 下它根本没有被切的权利，整块
latent 全是复制的。而序列维度和头数是正交的另一维，latent 按序列
切不受头数约束，于是可以一路切到 TP 度数（约束只剩 tp ≥ dcp 且
整除）。

**Q6【中】DCP 和 DP 都提升吞吐，区别是什么？**
DP 加副本：吞吐翻倍，显存也翻倍，KV 总量不变、只是分成两池；DCP
不加副本：显存里的 KV 冗余被消灭，同样的显存装下更多请求的 KV。
**DP 治「请求太多」，DCP 治「KV 太大占不下请求」**——长上下文
Agent 场景后者是主矛盾。

**Q7【中】DCP 合并 partial attention 怎么保证数学正确？**
每卡上报局部 max、exp 和、加权值和；取全局 max 后各项乘
exp(local_max − global_max) 重缩放，分子分母分别求和相除——就是
online softmax 的分布式版本，与单卡完整 attention 在浮点容差内
一致（这与 FlashAttention 的 tile 合并是同构的，见
[Attention 的 Profile 实战专题](../attention的profile实战专题.md)）。

**Q8【中低】MLA 后端那个 `VLLM_DCP_Q_REPLICATE` 是干嘛的？**
decode 的 Q 只有一个 token，但每步 AllGather 它仍有一次通信；把
很小的 query 投影在 DCP 组内**加载时**复制好，decode 就跳过这步
all-gather——用一点常驻显存换每步一次通信。这类「加载时复制换
运行时通信」的取舍，和 prefix cache 的思路同族。

## 七、串联阅读

- [推理并行策略决策专题](./推理并行策略决策专题.md)：六种并行策略的
  决策地图，本篇是其中 DCP 分支的实现深挖；
- [长上下文推理与 KV 体系](./长上下文推理与kv体系.md)：KV 体积的
  来源与分层，本篇解决它的「复制」维度；
- [MLA 深度穿透专题](../llm基础/mla深度穿透专题.md)：latent 结构
  为什么会有「等效单 KV 头」；
- [双向 KV 传输与多轮复用专题](./双向kv传输与多轮复用专题.md)：
  时间维的 KV 复用，与本篇空间维互补；
- [注意力变体 2026 专题](./注意力变体2026专题.md)：MLA/GQA/SWA
  的头数版图，决定本篇公式的输入参数。

## 口径与未核实说明

- 全部性能数字（1,863/6,091 token/s/GPU、并发 64/512、KV 100%/
  82%/19%）为 vLLM 官方博客实测（2026-08 文、2026-10 转述核实），
  平台限定 8×B200 + Kimi K2.6 NVFP4 + Mooncake 格式 trace；其他
  模型、其他互联拓扑下结论需重测，未独立复现。
- `decode_context_parallel_size`、`VLLM_DCP_Q_REPLICATE`、约束公式
  （tp ≥ dcp 且整除、GQA 上限=复制因子）为官方文档口径；TensorRT-LLM
  的 Helix Parallelism 仅按原文提及，未展开核实。
