# MoE 架构：稀疏激活、负载均衡与 DeepSeek 系演进

> MoE（Mixture of Experts）是这两年面试的"新老八股"：算法岗问架构演进和路由
> 细节，Infra 岗问 EP 并行、all-to-all 和 DeepEP。一句话总结：**MoE 用"每次只
> 激活一小撮专家"的条件计算，把模型总参数（知识容量）和每 token 的算力开销解耦，
> 同等算力下把容量做大数倍。** 本文按「直觉 → 演进线 → 负载均衡 → 训练 EP →
> 推理 DeepEP → 面试追问」组织，题目标注自
> [高频面试真题汇总](../高频面试真题汇总.md)。

## 一、为什么要有 MoE：容量和算力解耦

▶ 面试题：MoE 相比 Dense 的核心优势是什么？——**高频**（字节/月之暗面开场题）

Dense 模型有个铁律：**参数每翻一倍，训练和推理每个 token 的算力基本也翻一倍**。
想装更多知识（更大参数量），就得接受更贵的计算。MoE 的想法是：能不能把"知识"
存得很大、但每个 token 只查一小部分？

做法很直白——把每个 Transformer block 里的 FFN 复制成 N 份（每份叫一个
**专家 Expert**），前面加一个小型**路由器（Router / Gate）**：每个 token 经过
时，路由器给它算 N 个得分，挑得分最高的 top-k 个专家走，其余专家的输出直接
为零、不参与计算。

```text
  y = Σ_{i ∈ top-k} G(x)_i · FFN_i(x)      （G(x) 是路由权重，其余为 0）
```

于是出现两个独立数字：

- **总参数（Total Params）**：所有专家的参数加总——决定模型能装多少知识；
- **激活参数（Active Params）**：每个 token 实际走过的参数——决定每个 token
  的 FLOPs 和推理成本。

两个经典对比把这个直觉钉死：

- Llama-2-7B（Dense）：总 7B，激活 7B，每个 token 全靠这 7B 输出。
- Mixtral 8×7B（MoE）：8 个专家 top-2，总约 46.7B，激活约 12.9B。以不到
  13B 的激活算力，效果对标 Llama-2-70B——**这就是"同算力下容量数倍于 dense"
  的具体含义**。

引申出**等效激活参数**这个概念：比较两个模型"贵不贵"，看激活参数而非总参数。
面试官说"671B 模型"时不要慌——DeepSeek-V3 总参数 671B，激活只有 37B，单
token 推理成本大致和 30B 级 dense 模型一个量级。

### 1.1 形态演变：72B dense 退场，27B dense + 巨型 MoE 分治（2026 新观察）

▶ 面试题：为什么以前旗舰是 70B+ dense，现在前沿全是 MoE？——**中高**

三个数字要会同时解释：**总参数在暴涨**（1T、2.4T）、**激活参数
在竞赛式下探**（37B→22B→10B）、**dense 在收缩**（72B→27-32B）。
三件事是同一条「存算解耦」逻辑的侧面：

- **容量归 MoE 总参数**：知识便宜（显存存着不花 FLOPs），算力贵——
  那就多存少算。上探到 1T/2.4T 的模型，每张"知识货架"只为极少数
  token 服务；
- **成本归激活参数**：API 按 token 计价，Agent 时代按每步算账——
  MiniMax M2 的 10B 激活就是这个逻辑的极端产物
  （「激活少 → agent loop 每步便宜 → 同预算更多并发」）；
- **dense 收缩到部署甜点**：能力/参数比因蒸馏（27B 从 1T 级 MoE
  老师学）和数据质量暴涨而追平旧 72B，而 72B 的生态位被**两头
  吃掉**——向上被 MoE 旗舰碾压，向下不如 27B 好部署。27-32B 是
  「单节点能扛」的最大甜点，企业私有化/私有化 agent 的默认档。

**激活率的梯度是设计取舍不是偶然**（面试追问必到）：

| 模型 | 总/激活 | 激活率 | 设计取向 |
|---|---|---|---|
| MiniMax-M2 | 230B/10B | **4.3%** | 极限稀疏，agent 单位经济极致 |
| DeepSeek-V3 | 671B/37B | 5.5% | 细颗粒 256 专家选 8 + MLA 压 attn 成本 |
| Qwen3-235B | 235B/22B | 9.4% | 较稀疏 |
| Mixtral 8×7B（2023） | 47B/13B | 28% | 早期粗颗粒 8 选 2 |

激活率由四件事决定：**attn 部分永远 dense**（MLA 把它压小是
稀疏化的前提）、共享专家数（通用能力保底）、top-k/专家数
（8/256 vs 2/8 差一个量级）、训练稳定性下限（太稀疏专家「饿死」
——每专家训练 token 不足）。激活率从 28% → 4% 的下探过程，
本质是**负载均衡技术（aux loss → aux-loss-free bias → EPLB）
逐步解锁出来的**。

## 二、架构演进：Switch → GShard/Mixtral → DeepSeek V2 → V3 → Qwen3

▶ 面试题：MoE 架构的演进脉络，每代在解决什么？——**高频**（字节/阿里 Infra）

主线和 MHA→MLA 一样清晰：**怎么把"选专家"这件事做得更细、更准、更便宜**。

| 方案 | 专家构成 | top-k / 路由函数 | 负载均衡 | 代表尺度 |
|---|---|---|---|---|
| Switch Transformer (2021) | 每层 128~2048 专家 | **top-1**，softmax | 辅助 loss；capacity factor 直接丢弃溢出 token | T5 系，万亿参数 |
| GShard / Mixtral | 每 2 层 60 专家（GShard）；8 专家（Mixtral） | **top-2**，softmax | 辅助 loss；容量限制同上 | Mixtral 8×7B |
| DeepSeek-V2 | **160 细粒度路由 + 2 共享专家** | top-6，sigmoid 打分 + 选中组内归一 | 专家级 + 设备级 + 通信均衡三种辅助 loss；device-limited routing | 总 236B / 激活 21B |
| DeepSeek-V3 | 256 路由 + **1 共享** | **top-8，sigmoid 直接打分** | **aux-loss-free（可学习 bias）** + sequence 级小 loss 兜底；node-limited routing | 总 671B / 激活 37B |
| Qwen3-MoE | 128 专家，**无共享专家** | top-8，softmax | 经典辅助 loss 路线（全局 batch 均衡） | 总 235B / 激活 22B |

<div class="diagram-embed">
<iframe src="assets/diagrams/moe-evolution.html" width="100%" height="1000" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/moe-evolution.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

几个演进逻辑要讲得出来：

- **top-1 → top-2 → 细粒度多专家**：Switch 证明选 1 个就够（省一半 all-to-all
  流量）但表达受限；DeepSeek 的解法是反直觉的——不是选更多"大"专家，而是把
  FFN 切碎成很多**细粒度小专家**，top-k 乘上去（64→160→256），组合空间指数
  增长，等价于专家"可分头专精"不同知识。
- **共享专家（Shared Expert）**：V2 发现不管输入是什么，总有些通用知识
  （语法、常识）每个 token 都要用，让每个路由专家都重复存一份太浪费。于是
  固定几个专家**永远激活**承载通用知识，路由专家只管专精部分。V3 保留 1 个
  共享专家；Qwen3 则认为细粒度路由足够好、直接砍掉了共享专家——**两条路线
  都跑得通，面试里讲清各自动机即可**。
- **softmax → sigmoid**：V3 把路由打分从 softmax 换成 sigmoid。softmax 强制
  所有专家归一竞争，得分互相抑制；sigmoid 让各专家独立打分，和 top-k 加偏心
  的偏置（bias）路由配合更自然，分数尺度也更稳定。

## 三、负载均衡：从辅助损失到无辅助损失（面试最高频深挖点）

▶ 面试题：MoE 的负载均衡怎么解决？辅助 loss 有什么问题？——**高频**（深挖追问必到）

这节按"问题 → 尝试 → 问题 → 新法"的演进讲，比背结论好记得多。

### 问题

路由器如果自由发挥，很快就会塌缩：起初某几个专家稍微好用 → 更多 token 路由
过去 → 它们训练得更充分 → 更被选中，出现**赢家通吃（routing collapse）**。
后果是双重的：知识上，大量专家饿死、模型容量浪费；系统上，热点专家所在的
GPU 被打爆，EP 并行里 all-to-all 出现长短板（木桶效应），集群吞吐被单个
热点卡拖住。

### 尝试一：辅助损失（aux loss）

加一条负载均衡辅助 loss 到总目标里：

```text
  L_total = L_lm + α · L_balance
  L_balance ∝ N · Σ f_i · p_i
    f_i = 路由到专家 i 的 token 占比
    p_i = 专家 i 的平均路由概率
```

f 和 p 越不均匀，loss 越大，迫使路由器把 token 撒匀。**问题在于这是硬塞进去
的目标，和主任务（把下一个词说对）本质是冲突的**：模型本来就该把"的、是、了"
这类高频 token 和冷僻知识区别对待，强行均匀会挤占总 loss 的"注意力"，污染
主任务梯度。α 调小不均衡、调大掉主任务指标——这就是"均衡 vs 损伤"的
trade-off，也是 V3 要干掉它的直接动机。

### 新法：aux-loss-free 的可学习 bias（DeepSeek-V3）

V3 的思路釜底抽薪：**均衡只做"分流的调度"，不碰"权重的梯度"**。

- 给每个专家 i 加一个标量 bias $b_i$，路由选择时用 $s_i + b_i$ 决定 top-k，
  但**最终加权求和仍用不带 bias 的原始得分 $g_i$**——bias 只影响"去哪个专家"，
  不影响"输出算多重"，所以不进梯度、不污染主 loss。
- bias 的更新是**规则式的，不走反向传播**：每个 step 结束统计一次负载，
  过载的专家 $b_i \leftarrow b_i - \gamma$，欠载的 $b_i \leftarrow b_i + \gamma$，
  像一个简洁的 PID 调节器，把 token 从拥堵专家引向空闲专家。
- 配套两个细节常被追问：
  - **sequence-wise 兜底**：bias 管 token 级均衡，V3 还保留一个很小的
    sequence 级均衡 loss，防止单条序列内极端集中（token-wise 均衡 ≠
    sequence-wise 均衡，这个区别本身就是考点）。
  - **node-limited routing（节点受限路由）**：每个 token 最多只允许被送到
    M 个节点（V3 训练时组受限到最多 4 个节点）上的专家。这看似是均衡范畴，
    实际是给 EP 通信**预埋伏笔**——限制 token 的跨机扩散范围，all-to-all
    的流量和延迟上界就被掐住了。

## 四、MoE 训练并行：EP 是 3D 之外的第四维

▶ 面试题：EP（专家并行）是什么？和 DP/TP/PP 什么关系？——**高频**（Infra 岗）

MoE 模型动辄几百 B 参数，所有 FFN 全放一张卡放不下。EP 把一层里的 N 个专家**切到
不同 GPU 上**，每张卡只存自己负责的那几个专家；attention 部分照常走 DP/TP/PP
的老路子。于是 EP 成了 3D 并行（数据/张量/流水）之外专门对付 MoE 的第四维。

代价全在一个地方：**all-to-all 通信**。前向时每个 token 要先按路由结果
dispatch 到目标专家所在的卡，算完再 combine 回来；反向时方向反过来再来一轮。
token 在卡间大搬家，通信量随 EP 组规模膨胀，而 NVLink（机内）和 RDMA（机间）
带宽差着好几倍，跨节点的 all-to-all 几乎是必然的性能洼地。

训练侧的主流对策是**通信-计算重叠**：DualPipe（V3 自研流水线）把 all-to-all
藏在 attention 计算的间隙里，只要单卡算力时间 ≥ 通信时间，通信就"免费"。
但训练和解码的诉求天然矛盾——训练要**高并发、大 batch 的 all-to-all**（吞吐
最大化），解码要**小 batch、毫秒级完成**（延迟最小化），同一份通信库两头
难兼顾，这就引出了下一节的 DeepEP。

## 五、MoE 推理与 DeepEP（Infra 岗重点）

▶ 面试题：EP 下 all-to-all 为什么是瓶颈？DeepEP 怎么解？——**中高，2026 升温**

### 四个绕不开的矛盾

1. **all-to-all 随 EP 规模膨胀**：专家切得越散，token 跨卡面越广，通信占比
   越压不住。
2. **训练吞吐优先 vs 解码延迟优先**：一份通信实现很难同时讨好两边。
3. **带宽层级差**：NVLink 机内 ~160GB/s、RDMA 机间 ~50GB/s，差约 3 倍，
   跨机 hop 必须被显式管理，不能一锅端。
4. **通信抢 SM**：常规 GPU 通信内核要占 SM 做数据搬运，挤占本来就紧张的
   计算资源。

### DeepEP 的解：双内核分治

DeepSeek 开源的 DeepEP 干脆承认矛盾，**prefill 和 decode 用两套内核**：

- **Normal 内核**（prefill/训练用）：走"NVLink → RDMA"的分级转发——token 先
  在机内 NVLink 域汇合，再由少数卡跨机 RDMA 送出去，到达后再经 NVLink 分发。
  机间流量被机内合并削减，追的是**吞吐**。
- **Low-Latency 内核**（decode 用）：纯 RDMA 一击直达，并且用 **IBGDA hook**
  把通信通知/轮询挂到 GPU 的异步路径上——**通信几乎零 SM 占用**，再配合两个
  micro batch 之间通信/计算错位重叠，把 all-to-all 藏进计算间隙，追的是
  **延迟**。

### dispatch / combine 与 EPLB

- 两个原语一句话记住：**"dispatch 的反向传播就是 combine"**。前向把 token
  按路由结果发给专家（dispatch）、加权收回（combine）；反向时梯度沿原路
  走相反操作，所以通信库只需把这两个原语做精。
- 精度上 DeepEP 做了**非对称设计：dispatch 用 FP8**（量化 token 省带宽，
  路由信息按索引额外交换），**combine 用 BF16**（加权求和的精度不能省）。
- 推理侧热点同样要治理：**EPLB（专家并行负载均衡器）**的思路是"热点专家
  冗余复制"——把被打爆的专家在其它卡上多放几个副本，再按启发式（优先把
  同组、常共激活的专家放近）做放置，用显存换负载均匀。

## 六、高频面试追问清单（本主题）

| 追问 | 答题要点（3-5 句版本） |
|---|---|
| MoE 和 Dense 的等效参数怎么换算？ | 看激活参数对齐算力：Mixtral 总 46.7B 激活 ~12.9B，算力视角约等于 13B dense，但因总参数大、效果能对标 70B dense；V3 总 671B 激活 37B，单 token 成本 ≈ 30B dense 量级。追问"那显存呢"——权重显存按**总参数**算（671B BF16 ≈ 1.34TB），这是 MoE 在部署上的软肋，所以才需要 EP + 量化。 |
| 为什么 aux loss 会伤主任务？ | 均衡目标是外生的：模型对高频/低频 token 天然应有非均匀分配，均匀化约束会挤占总目标梯度、把路由推向和"预测对下一词"冲突的方向，α 调大了掉点、调小了不均衡。V3 用不参与梯度的规则式 bias 做分流，调度与学习目标解耦，绕开这个 trade-off。 |
| V3 为什么用 sigmoid 不用 softmax 路由？ | softmax 让所有专家归一竞争、得分互相抑制，尺度随 top-k 和专家数抖动；sigmoid 各专家独立打分，配合 aux-loss-free 的 bias（只加在路由选择、不加在加权输出）天然自洽，训练更稳，也便于做 group 受限路由。这是从 V2 的"sigmoid+选中组归一"到 V3 "纯 sigmoid"的演进。 |
| token-wise 和 sequence-wise 均衡的区别？ | token-wise 看全局 token 是否均匀撒到各专家（bias 解决的问题）；sequence-wise 看单条序列内是否极端集中——全局均衡了、某条长序列仍可能死磕一个专家，所以 V3 保留一个很小的 sequence 级均衡 loss 兜底。 |
| EP 的 all-to-all 为什么是瓶颈，DeepEP 怎么解？ | token 要按路由跨卡搬家，通信量随 EP 规模与 token 数膨胀；机内 NVLink 与机间 RDMA 带宽差 ~3 倍，跨机是洼地；且通信内核占 SM 抢计算。DeepEP 分治：prefill 用 Normal 内核做 NVLink→RDMA 分级转发提吞吐，decode 用 Low-Latency 内核纯 RDMA + IBGDA hook 零 SM 占用 + 双微批重叠压延迟；dispatch FP8 / combine BF16 非对称精度再省带宽。 |
| MTP 和 MoE 是什么关系（V3）？ | 两者正交：MTP（Multi-Token Prediction）是训练目标/附加模块——主模型之外挂几个共享 embedding 的轻量模块连猜后续多个 token，提升数据效率；推理时可复用这些模块做 self-speculative decoding 提约 1.8× 解码速度。MoE 管"模型长什么样"，MTP 管"一次猜几个词"，只是恰好都在 V3 上。 |
| 训练时 token Dropped（容量溢出）是怎么回事？ | Switch/GShard 时代每个专家有 capacity 上限，路由超员的 token 直接被丢掉（残差连接兜底、跳过该层 MoE），靠 capacity factor 调头部空间；代价是少量 token 学得浅。DeepSeek 系通过细粒度均衡 + 无辅助损失路由把溢出率压到接近零，推理时更不容忍丢 token（会被用户感知），主要靠 EPLB 冗余副本削峰。 |

## 延伸阅读

- DeepSeek-AI. *DeepSeek-V3 Technical Report*（架构、aux-loss-free、DualPipe、FP8 训练一篇读完）
- DeepSeek-AI. *DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model*（细粒度专家 + shared expert 的出处）
- GitHub: `deepseek-ai/DeepEP`（双内核 dispatch/combine 实现与文档）
- 苏剑林（kexue.fm）："MoE 环游记"系列与《无辅助损失（Aux-loss-free）的负载均衡》——负载均衡章节的推演思路

---

*相关阅读：[Transformer 与 Attention](./transformer与attention.md)（MLA 与 KV Cache）·
[三维并行](../distributed-training/三维并行.md)（EP 与 DP/TP/PP 的组合）·
[vLLM 与推理加速核心](../inference/vllm与推理加速核心.md) · 上一页 [模块导航](./README.md)*
