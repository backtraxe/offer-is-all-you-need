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

## 六·增、当 spec 遇上 DCP：组合设计题四件新活（面试推演口径）

> 题面出处：teleai AI Infra 一面设计题两连（2026-10 一手，全录见
> [面经合集 · 三十五节](../../interview-experiences/小红书社招面经合集-2026h2.md)）：
> 「如果把 MTP 换成 DSpark、让它也支持 DCP，你会怎么设计？」
> 「异构 Mask 优化方案能不能直接用于 DSpark？」DSpark 与 DCP 各自
> 都已入射程——前者在
> [投机解码2026专题](./投机解码2026专题.md) §3.7，后者本篇 §二；
> **没有任何人替你设计过两者的组合接缝**。本节组合推演未见官方
> 文档，接缝部分为面试推演口径（组件口径各有官方锚）。

两组机制各自成立时各带一条隐性假设，一组合就相撞：

- **spec 的假设**：一次 forward 出 k 个 draft token，verify 要用
  它们**刚生成的 KV**、接受后随步落盘——「新 KV 天然全在本卡」。
- **DCP 的假设**：历史 KV **生而分片**，每卡只见 1/N，靠
  AllGather Q 与 LSE 合并拼全局注意力——「要用的 KV 就在本地
  分片里」。

「怎么让 DSpark 支持 DCP」的标准答法——把接缝拆成**四件新活**：

1. **Q 块变大，数学不破**：AllGather Q 从 [1,h] 变 [k,h] 量级
   （vLLM 示例 DeepSeek-V4-Flash-DSpark 配 7 个投机 token），只是
   常数级开销；LSE 重加权合并对 query 逐行独立，多行各自合并
   即可。若开了 `VLLM_DCP_Q_REPLICATE`，Q 的 all-gather 本来就
   已消掉——这层几乎白送。
2. **verify 新 KV 的临时可见性**：k 个 draft token 的 K/V 是本次
   前向新产出，历史分片里没有，而**每个 DCP 分片卡算 partial
   attention 都需要它们**。做法：把这 k 组新 KV 广播给全组、当作
   **临时第 N+1 个分片**参与本地计算，verify 完即弃（MLA 形态下
   只需广播 latent 向量，更小）。反方案「让尾卡自己算 verify」
   等于对全历史单点全量访问——DCP 白开。
3. **接受写回的管辖权**：只接受 t≤k 个、且全部落在序列尾部——
   **只有尾部管辖卡**把临时 KV「转正」写进自己的分片池，其余卡
   全丢。这条保住 DCP 的「不复制」不变量；反过来，KV 块管理器若
   按「每步固定提交步长」写死路径、或分片池缺「部分提交」接口，
   组合就撞墙。真实先例：Kimi-K3「开 DCP + mrv2 推理失败、关 DCP
   正常」（vLLM issue #17706，标题级口径，mrv2 未展开考据）——
   这类新特性两两组合的语义边界，排查姿势见
   [国产推理芯片栈专题](../国产推理芯片栈专题.md) §4.6：新特性
   一次只开一个，出问题先回退组合。
4. **组内一致步进**：DCP 组靠集合通信，要求组内 time step 齐步；
   spec 的变长接受（adaptive verification 按置信度截 t）让 batch
   内各请求进度天然不齐——要么组内 padding 对齐最大步、要么把
   调度对齐粒度降到 micro-step。组合前还要单特性基测：A5 上
   「开 DSpark 后 TTFT 劣化十倍」（#16997，标题级口径）说明单开
   新特性也可能踩平台特化坑，别急着叠加。

第二问「异构 Mask 能否直接用于 DSpark」的标准拆法——**分语义答**：

- **数学上能**：verify 的因果 mask 是 k×(T+k) 的梯形，**按列切片
  与 DCP 分片天然对齐**（每卡取自己管辖的 key 列区间即可），与
  §二 的 LSE 逐行合并正交——mask 复用不改动合并数学。
- **工程上不能直接用**：MTP 时代的 verify 内核常把 mask 形状写死
  成固定三角形或固定步进；DSpark 的块内顺序依赖（Markov head 要
  看左邻已选 token）+ 变长接受 t，要求 mask 形状由 (T,k,t) 运行时
  参数化，且被拒行的 partial 输出走**逐行丢弃**而非整块回滚。
  一句话收束：**mask 语义可切、工程必须参数化**。

**收束金句**：设计题不考背机制，考找出两个「各自都对」的组件在
假设上的对撞点——spec 假设 KV 一次全落本卡，DCP 假设 KV 生而
分片；四件新活（Q 变块、新 KV 临时广播、尾卡管辖写回、组内齐步）
补完，组合才相容。

**▶ 对答卡（teleai 原题两连）**

**「怎么让 DSpark 也支持 DCP？」**——按四件新活顺序报：AllGather
Q 换成 k 行块、LSE 合并数学不动；verify 新 KV 广播成临时分片、
用完即弃；接受的 t 个 token 只由尾部分片卡转正入池；调度侧加组
内一致步进。每个坑位配一条真实 issue 讲排查。

**「异构 Mask 能直接用于 DSpark 吗？」**——先答数学（可按列切分、
与 LSE 合并正交），再答工程（固定形状特化内核必须改 (T,k,t) 参数
化与被拒行逐行丢弃），收尾给「能/不能」判据而不是硬选边——面试
官考的是分类讨论能力。

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
- 六·增节为面试推演口径：DSpark 机制锚投机解码2026专题 §3.7 的
  vLLM 官方口径，DCP 机制锚本篇 §二；「四件新活」与「MLA 只需广播
  latent、常数级开销」为组合推演论断，未见官方 spec×DCP 设计文档、
  未实测。#17706/#16997 仅按 issue 标题口径转述（见国产推理芯片栈
  专题 §4.6），未逐楼核实，mrv2 未展开考据。
