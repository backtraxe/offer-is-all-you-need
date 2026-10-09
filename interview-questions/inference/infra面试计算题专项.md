# AI Infra 面试计算题专项

> ▶ 真题来源：多本面经复盘交叉提炼（英伟达五面、字节二面、摩尔线程三轮、百度
> 一面及若干手撕题汇总帖），同一套题型在多家公司反复出现，是 Infra 岗与其他
> 算法岗面试的最大差异点。本文按「题型模板 → 完整示范推演 → 变体追问」组织，
> 所有数字均给出可复核的算式。前置概念不再重复：KV Cache 原理见
> [Transformer 与 Attention](../llm基础/transformer与attention.md)，引擎侧调度见
> [vLLM 与推理加速核心](./vllm与推理加速核心.md)，通信原语见
> [三维并行](../distributed-training/三维并行.md)，量化方法见
> [量化与压缩](./量化与压缩.md)。

## 〇、为什么 Infra 面试全是计算题

Infra 岗的产出是「用多少卡、跑多快、扛多少 QPS」——这些数字没法靠背八股
推出来，面试官只能现场出题考你的**数量级感**。题目本身都不难（乘除为主），
真正筛选的是三件事：公式背没背对、量级代没代对、结论的适用边界说没说清。

**答题总模板（每道题都按这个节奏走）**：

1. **先写公式**——一边说一边写，让面试官看到推导从何而来；
2. **代入量级**——显式声明假设（dtype、利用率、batch），每步列出算式；
3. **给结论**——落到一个具体数字或区间，别停在「大概挺大的」；
4. **说适用边界**——什么时候这个估算失效，这才是区分度所在。

---

## 一、KV Cache 显存

### 题型模板

每 token 的 KV Cache 增量：

```text
bytes/token = 2(K,V) × layers × kv_heads × head_dim × dtype_bytes
```

- MHA：kv_heads = attention heads；GQA：kv_heads = 组数（广播共享）；MLA：把
  K/V 压成低秩 latent，公式改写为 `(kv_lora_rank + rope_dim) × dtype_bytes`，
  与 head 数无关。

### 实例 1:7B MHA 模型，1M context

参数：32 层、32 个 KV head（MHA）、head_dim 128、BF16（2 字节）。

```text
bytes/token = 2 × 32 × 32 × 128 × 2 B
            = 2 × 4096 × 32 × 2
            = 524288 B = 512 KB/token
```

1M context（假设只剩一条请求跑满）：

```text
512 KB × 10⁶ = 5.24 × 10¹¹ B ≈ 524 GB ≈ 488 GiB
```

**结论**：一张 80 GB 的卡放不下，要 7 张卡纯存 KV。这个数就是为什么长上下文
服务的显存大头不是权重（7B 权重才 14 GB）而是 KV Cache。

### 实例 2：换成 MLA（DeepSeek 低秩压缩）后怎么变

DeepSeek 系（V2/V3）公开口径：KV 低秩压缩到 `kv_lora_rank = 512` 维 latent，
外加 `qk_rope_head_dim = 64` 维与共享位置相关的部分，cache 存的是
`(512 + 64) = 576` 维向量，**与 head 数无关**。

同样 32 层的模型换 MLA：

```text
bytes/token = 576 × 2 B × 32 = 36864 B ≈ 36 KB/token
```

相对实例 1 的 512 KB，**压缩约 14 倍**。DeepSeek V3 实际 61 层：

```text
576 × 2 B × 61 ≈ 70 KB/token
128K context → 70 KB × 1.28 × 10⁵ ≈ 9 GB
```

从 128K context 需要 ~64 GB（同结构 MHA）降到 ~9 GB——这是 V3 能把长上下文
推理成本打下来的关键之一。适用边界：MLA 的收益依赖「cache 存 latent、用时
展开」，展开矩阵的训练一致性是结构绑定的，不能事后给 MHA 模型无缝套上。

### 变体追问：Agent 长 prefix 场景 KV 空间不够，4 种优化

Agent 多轮/工具调用场景典型特征：system prompt + 工具定义 + 历史轨迹构成超长
共享 prefix（见 [vLLM 与推理加速核心](./vllm与推理加速核心.md) 第五节）。

1. **Prefix Cache 命中复用**：共享 prefix 的 KV 只算/存一份，命中跳过
   prefill——空间换时间的反面，以复用省显存；
2. **KV Cache 量化**：BF16 → INT8/FP8，直接砍半或再砍半，公式里改 dtype_bytes
   即可，注意 attention 对 KV 误差比权重更敏感，长上下文下要评估；
3. **滑窗 / 分层驱逐**：只保留最近窗口的高精度 KV，远期 KV 下沉 CPU/SSD
   （分层缓存），就近取决于请求命中模式；
4. **PD 分离 + 显存专享**：decode 节点专机专用装 KV。
   **失效条件**：PD 分离不解决总量——如果单请求 KV 本身就超过单卡显存
   （如实例 1 的 488 GiB），分离再多 decode 节点也没用，此时必须上量化、
   滑窗或 CP（序列维切 KV）。

---

## 二、参数量与访存量手算

先立一张心智图：一次 decode 前向，HBM 上要搬三类数据——

<div class="diagram-embed">
<iframe src="assets/diagrams/hbm-traffic.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/hbm-traffic.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 实例：DeepSeek V3（671B 总量 / 37B 激活）一次 decode 的访存量

- **权重读**：decode 每 token 只走 router 选中的专家。激活参数 37B × 2 B
  = **74 GB**。
- **KV 读**：MLA ≈ 70 KB/token（见上节）。8K context ≈ 0.57 GB；128K ≈ 9 GB。
- **合计**：8K 下 **~75 GB**，128K 下 **~83 GB**——权重绝对主导。

H800（HBM 3.35 TB/s，按 70% 有效带宽 ≈ 2.35 TB/s）：

```text
每 token 时延 ≈ 75 GB / 2.35 TB/s ≈ 32 ms → ~30 tok/s
```

**对比 dense 7B**（BF16，32 层 MHA，8K context）：

```text
权重 14 GB + KV 512 KB × 8K ≈ 18 GB
18 GB / 2.35 TB/s ≈ 7.7 ms → ~130 tok/s
```

**结论**：MoE 大模型 decode 慢的不是「模型大」，是**激活参数的访存量大**；
KV 只有在超长 context（>64K）才追平权重。这个对比能顺手回答「为什么
decode 用 MoE 也要开大 batch 摊权重读」。

### 结构伪代码 → 参数量估算模板（MoE FFN + MLA）

给定：hidden h = 7168，专家数 E = 256，top-8 + 1 shared，专家 FFN 中间维
d_ff = 2048（SwiGLU 三个矩阵），MoE 层数 L_moe = 58。

| 模块 | 公式 | 量级 |
|---|---|---|
| 单专家 FFN | 3 × h × d_ff | 3 × 7168 × 2048 ≈ 4.4 × 10⁷ ≈ 44 M |
| 单层 routed 专家 | 256 × 44 M | ≈ 11.3 B |
| 全部 routed(58 层） | 58 × 11.3 B | ≈ 654 B |
| attention + dense 层 + embedding | h² 量级 × 层数 | ≈ 15~17 B |
| **总量** | 加总 | **≈ 671 B** ✓（与公开口径吻合） |
| 每 token 激活 | (8+1)/256 × 654 B + 17 B | ≈ 23 B + 14 B ≈ 37 B ✓ |

记忆锚点：**MoE 模型 ≥95% 参数在 routed 专家里**，总参数量 ≈ E × 单专家
× 层数一行就能估出来；激活量 ≈ 总参 × top_k/E + 稠密部分。

### 变体追问（字节原题套路）：「写完结构伪代码，紧跟手算访存量」

组合拳的标准流程：伪代码里**每出现一个矩阵乘，立刻报一组数字**——输出
FLOPs（= 2 × M × N × K）和访存字节（= 三个矩阵各乘 dtype_bytes 之和），
然后顺手给出 AI = FLOPs/Bytes 和 bound 判断。练熟之后一个 MoE block 两
三分钟推完。考的不是算术，是「脑子里有没有 roofline」。

---

## 三、Roofline 操作强度

### 题型模板

```text
算术强度 AI = FLOPs / 访存 Bytes
机器平衡点 AI* = 峰值算力 / 峰值带宽
AI > AI* → 算力 bound（算力是瓶颈，加带宽没用）
AI < AI* → 带宽 bound（带宽是瓶颈，加算力没用）
```

单卡能跑出的实际吞吐：`min(峰值算力, 峰值带宽 × AI)`。

### 实例 1：H800 的平衡点；decode(bs=1) 为什么远小于它

H800：BF16/FP16 约 989 TFLOPS，HBM3 带宽 3.35 TB/s。

```text
AI* = 989 × 10¹² / 3.35 × 10¹² ≈ 295 FLOP/Byte
```

Decode bs=1：对任一 BF16 权重矩阵（2 B/参数），过一遍的参数 GEMV 正好是
2 次 FLOP/参数（一次乘一次加）：

```text
AI ≈ 2 FLOP / 2 B = 1 ≪ 295 → 深度带宽 bound
```

**推论很值钱**：线性层 `W[h,h]` 在 batch = B 时，FLOPs = 2B·h²，访存 =
2h²（权重，忽略瘦激活），**AI ≈ B**。也就是说 batch ≳ 300 才跨过 H800 的
平衡点——这就是「decode 开大 batch 本质上是在爬 roofline 的斜坡」。

常用硬件速查（平衡点自己除一遍加深印象）：

| 卡 | BF16/FP16 算力 | HBM 带宽 | AI* |
|---|---|---|---|
| A100 80G | 312 TFLOPS | 2.0 TB/s | ≈ 156 |
| H100 80G | 989 TFLOPS | 3.35 TB/s | ≈ 295 |
| H800 80G | 989 TFLOPS | 3.35 TB/s | ≈ 295 |
| RTX 4090 | ~330 TFLOPS（FP16 tensor） | 1.0 TB/s | ≈ 330 |

### 实例 2：由硬件反推 Matmul 最佳输入规模；MoE TopK 最佳 token 数（英伟达原题）

**方阵 GEMM** `n×n×n`：FLOPs = 2n³，访存 = 3 × 2n² B（A、B、C 三个矩阵，
BF16，假设 cache 装不下需要全搬）：

```text
AI = 2n³ / 6n² = n/3   ≥ 295  →  n ≥ 885，工程取整 n ≥ 1024
```

结论：H100/H800 上 GEMM 边长小于 ~1K 都是带宽区，tile 做大到 ≥1024 才进
算力区。

**MoE TopK 最佳 token 数**：单专家 GEMM 形状 `[T_e, h] × [h, d]`，其中 T_e
是派给该专家的 token 数。访存 = 权重 2·h·d B + 激活 2·T_e(h+d) B，
FLOPs = 2·T_e·h·d：

```text
AI = T_e·h·d / (h·d + T_e(h+d))
   ≈ T_e        （当 T_e ≪ h・d 时，激活项可忽略）
```

要 AI ≥ 295 → **每个专家至少要 ~300 token**，考虑 GEMM tile 对齐取
384 或 512。DeepSeek 规格（256 专家、top-8）反推全局 batch：

```text
每专家期望 token = B_tokens × 8 / 256 ≥ 300
→ B_tokens ≥ 300 × 256 / 8 = 9600 ≈ 1 万 token
```

**答法要点**：MoE 的每专家分散打不满 GEMM，token 不够时上 EP 反而是负
优化；这个大数（≈1 万 token/batch）就是 MoE 好批量的下界量级。

---

## 四、并行度与通信量

### EP 该开多大（以 DeepSeek 规格为例，固定单卡 batch = 16）

设 decode 单卡 batch = 16 seq（每 step 每卡 16 个 token），EP = G 台卡共享
一组专家（256 个 routed 专家，top-8）。

- **上界**：每卡至少摊到 1 个专家（不考虑专家复制）→ G ≤ 256；
- **下界（打不满 GEMM）**：每专家期望 token 数：

```text
T_e = (16 × G) × 8 / 256 = G / 2
```

按上一节每专家 ≥300 token 的理想值，G 需要 ~600，超过了 256 的上界——
**这正是真题的坑**：固定小 batch 下 EP 再大也喂不饱专家，此时工程选择是
(a) 专家复制（同一专家放多卡，等价减小有效 E）、(b) 把 decode 请求在多卡
间 DP 起来共享等价大 batch、(c) 接受带宽区运行，只求分摊参数显存
（每卡只放 256/G 个专家，671B 才能装下）。所以答案不是单一数字，而是
「显存约束先定 G 的最小值，负载均衡与 GEMM 效率决定要不要专家复制」，
量级落在 **G ≈ 32~256**。

- **负载均衡敏感性**：每专家的 token 是多项分布，hot expert 的相对波动
  ≈ 1/√T_e——T_e 越小方差越大，最慢的一张卡决定全组延迟（A2A 同步特性）。

### MoE dispatch/combine 的 A2A 通信量

token 数 T、top-k、h、BF16。dispatch 把 token 送往选中的 k 个专家，combine
把结果送回来，各一次 AllToAll：

```text
单向字节 = T × k × h × 2 B
每层双向 = 2 × 单向
```

T = 4096、k = 8、h = 7168：

```text
单向 = 4096 × 8 × 7168 × 2 ≈ 4.7 × 10⁸ B ≈ 470 MB
双向/层 ≈ 0.94 GB；58 个 MoE 层 ≈ 54 GB / 前向
```

量级结论：**A2A 是 MoE 的通信税**，每 MoE 层千兆字级，必须靠计算 - 通信
overlap（如把 A2A 藏进 attention/dense GEMM 的间隙）和专家均衡压住；
这也是 EP 不敢乱开大的另一个原因（G 越大，跨节点 A2A 越吃慢链路段）。

### Ring vs Tree AllReduce（消息大小 S，N 个 rank）

| | 步骤数（延迟项） | 带宽项（每 rank 传输量） |
|---|---|---|
| Ring | 2(N−1) 步 × α | 2 × (N−1)·S/N ≈ **2S**，与 N 无关 |
| Tree（二叉）reduce+bcast | 2·log₂N 步 × α | 朴素树每步传整块，约 2·log₂N·chunk；分块后同量级逼近 2S |

推导要点（边画边讲）：Ring 每步传 S/N，共 (N−1) 个 reduce-scatter 步加
(N−1) 个 allgather 步 → 延迟 2(N−1)α、带宽 2(N−1)·S/N；树把步骤压到
log₂N 但小步长大，带宽利用率差。

**选择规则**：小消息/大 N → tree（延迟主导，N=1024 时 ring 的 2046α vs
tree 的 20α）；大消息 → ring（带宽主导，带宽项与 N 无关干净打满链路）。
NCCL 实际按消息大小和拓扑自动二选一——这句话记得说出来。

### 英伟达小题：4 台全连接服务器算 C = A·B（[N,N]）

**约束 1：每台内存 = N²**（刚好一个矩阵的量级）。

全集群总内存 4N² ≥ A+B+C 的 3N²，装得下。用 2D 分块（2×2 grid，Cannon/
SUMMA 都是这个形状）：每台存 A、B、C 各一个 N/2 × N/2 块（每块 N²/4）。

Cannon 通信账（grid 边长 q = 2）：初始对齐后共 q−1 = 1 步轮转，每步每台
把 A 块右移、B 块上移，各 N²/4：

```text
每台发送量 = q × 2 × N²/4 = N² …（含对齐一步）
全集群 ≈ 4N²
```

由于全连接 + q=2，通信还能与本地 3 个子 GEMM（每块要算 q = 2 次子乘）
部分重叠。

**约束 2：缓存只剩 N²/8**。装不下完整 A/B 块 → 两条路：

- **分块外积（outer-product by panel）**：C += A[:,k]·B[k,:]，按 panel 流式
  读 A 的列条和 B 的行条（各 N²/8 以内），C 分块驻守本地、算完一块写出一块。
  通信量 = A 和 B 各流式读一遍 ≈ 每台 ~N²/2 量级的入站流量，算法简单、
  通信与计算天然可流水；
- **二级分块 Cannon**：把 N/2 块再切成 N/4 子块跑 q' 级嵌套轮转，驻留集
  降到 2×(N/4)² = N²/8，但通信次数翻倍（每步传更小块、步数 more）——
  总字节量相近，延迟项上升。

**答法要点**：先算装不装得下（决定能不能用 2D 分块），装不下就换
「流式一侧 + 常驻另一侧」的外积形式；通信量对比时把「总字节」和「步数
→ 延迟项」分开说，别合成一个数。

---

## 五、prefill / decode 耗时推算

### 题目：7B（BF16）在 H800 上，10K prompt 输入 + 1K token 输出

设有效算力按峰值 40% 计（≈ 400 TFLOPS，典型 MFU 口径），有效带宽按 70%
（≈ 2.35 TB/s）。

**Prefill**（稠密计算，FLOPs ≈ 2·P·S，P = 7×10⁹）：

```text
2 × 7×10⁹ × 10⁴ = 1.4 × 10¹⁴ FLOP
attention 修正（S 不可忽略时）≈ 2·S²·d·L ≈ 2×10⁸×4096×32 ≈ 2.6×10¹³ ≈ +18%
合计 ≈ 1.7 × 10¹⁴ FLOP
TTFT ≈ 1.7e14 / 4e14 ≈ 0.42 s
```

注意 attention 的 S² 项随序列线性增长，10K 时还只是修正项，128K 时会反超。

**Decode**：每步访存 = 权重 14 GB + KV（512 KB/token × 平均 ~10.5K
context ≈ 5.4 GB）≈ 19.4 GB：

```text
TPOT ≈ 19.4 GB / 2.35 TB/s ≈ 8.3 ms
1K 输出 ≈ 8.3 s
总时延 ≈ 0.42 + 8.3 ≈ 8.7 s
```

**结论 + 边界**：这套估算顺手回答了「长 prompt 场景优化钱往哪花」——本例
96% 的时间在 decode；若输出只 50 token，则 TTFT 反而占大头，该投的是
prefix cache 而不是 decode 优化。利用率假设（40% MFU / 70% 带宽）要自己
声明，面试官会揪着这个问你依据。

---

## 六、PD 分离配比

### 方法

PD 分离的配比不是拍的，是**从 SLO 反推的**：

1. **decode 侧**：由 TPOT SLO 定单实例 batch 上限（batch 越大 TPOT 越差），
   得到单实例吞吐（req/s）→ 总 QPS 除以它 = decode 实例数；
2. **prefill 侧**：由 TTFT SLO 定单请求 prefill 时延 → 单实例 prefill 吞吐
   → 按 prompt token 总量反推 prefill 实例数；
3. 配比 ≈ （prefill 实例数）:（decode 实例数），本质是
   `QPS×prompt_tokens/单实例prefill吞吐 : QPS×output_tokens/单实例decode吞吐`。

### 数字示例

QPS = 100，prompt 4K token，输出 1K token，模型 7B/H800。

- prefill：4K 一次的成本 ≈ 2×7e9×4e3 = 5.6×10¹³ FLOP ÷ 4e14 ≈ 0.14 s/req，
  单实例 ≈ 7 req/s → **需要 100/7 ≈ 15 实例**；
- decode：TPOT ≈ 8 ms，单实例满 batch 跑 8 req/s（每 req 1K 输出占 8 s
  卡槽）→ **需要 100/8 ≈ 13 实例**；
- **配比 ≈ 1:1**。把 prompt 拉长 4 倍（16K）则 ≈ 4:1——配比完全由流量
  形态（长短 prompt、长短输出）决定，这就是面试官想听的那句。

### 英伟达变体：decode 输出特别长怎么做负载均衡

输出长度方差大 → 各 decode 实例 catch-up 时间不一、卡槽占用不均。两条
标准思路：**按 length 分桶路由**（预测输出长度的请求聚到同组实例，短请求
不被长请求拖死）、**chunked 迁移**（超长请求生成到一半把 KV 迁到空闲实例，
借 KV transfer 层做负载再平衡，代价是一次跨节点搬运 [P·ctx KB] 的 cache）。

---

## 七、数值与量化

### 1. FP32 下 9.9×10⁹ − 1.0×10⁻⁹（「大数吃小数」标准题）

**不是溢出**，是精度湮灭。FP32 尾数 23 bit，9.9×10⁹ ∈ [2³³, 2³⁴)，此处的
绝对精度（1 ULP）为：

```text
ULP = 2³³ × 2⁻²³ = 2¹⁰ = 1024
```

1.0×10⁻⁹ 远小于半个 ULP（512），舍入后**完全消失**：

```text
fp32: 9.9e9 − 1e-9 = 9.9e9（原值，bit 不变）
(fp32: 9.9e9 − 9.9e9) 换序则丢失信息无法挽回
```

顺式表述：在 2³³ 量级，FP32 的分辨率是 **1024**，任何小于 512 的扰动都会被
直接吃掉。答题补一句工程含义：混合精度里 loss 累加器用 FP32 就是为了避免
梯度小量被大权重吃掉。

### 2. 分布极不均的量化（最小值 −10000，其余 ∈ [−1,1]）

朴素 absmax int8：scale = 10000/127 ≈ 78.7。

```text
Q([−1,1]) = round(x / 78.7) = 0  →  主体数据 100% 归零，量化失败
```

对策（按引用频次排）：

1. **Per-channel scale**：outlier 通常集中在个别通道，每通道独立 scale 后
   恶劣通道独自遭殃，其余通道 scale ≈ 1/127 恢复正常分辨率；
2. **异常值混合精度保留**：把 |x| 大于阈值的分量单独抽出来用 FP16 稀疏存
   （LLM.int8() 的思路），主体走 int8；
3. **AWQ 式 salient 保护**：对那 1% 关键权重乘放大系数再量化、推理时除回，
   用激活统计识别「谁不能被吃掉」（见 [量化与压缩](./量化与压缩.md)）；
4. 仅当分布近似对数正态时，才考虑对数尺度/非均匀码本（NF4 一类）——
   本题「单个 −10000」是**点异常**不是宽分布，对数尺度治不好，要在论证
   里点破这一点。

### 3. softmax 为什么减 max

exp 溢出阈值：FP32 最大 ~3.4×10³⁸，ln 它 ≈ **88.7**——输入超过 89 即
+Inf；FP16 更加惨烈，ln(65504) ≈ **11.1**，超过 12 就炸。softmax 对输入
整体平移不变：

```text
softmax(x_i) = e^{x_i} / Σ e^{x_j} = e^{x_i − m} / Σ e^{x_j − m},  m = max(x)
```

减完 max 后指数项 ∈ (0, 1]，数值上界安全、下界至多 underflow 成 0（无害）。
这是 FlashAttention online softmax 的同源技巧。

### 4. 点到向量投影（几何小题，一行公式）

点 p 在向量 v 方向上的投影点：

```text
p̂ = (p·v / ‖v‖²) · v
```

补一句退化：单位向量时就是 (p·v)·v；考的是内积 ≈ 投影这件事的熟练度。

---

## 八、怎么练

每类题给自己出 3 个变体：换模型（7B→70B→MoE）、换卡（A100→H800→4090）、
换约束（显存砍半/SLO 收紧），走同一套「公式 → 量级 → 结论 → 边界」流程。
练习时**必须出声讲**，面试是边写边说的现场，节奏比答案重要。数量级感
靠一张速查表校准（见第三节硬件表），再记三个锚点：7B 权重 14 GB、
7B MHA 的 KV 512 KB/token、H800 平衡点 AI* ≈ 295。这三个锚点能推出本
专题 80% 的题。

---

## 九、推理压测指标口径（压测报告题必考）

▶ 面试题：线上压测报告怎么写？TTFT / TPOT / 吞吐 / Goodput 各是什么口径？——**中高，2026 升温**

先点破一个坑：**同一组数字能拗出两个结论，全看分位数、口径、是否计入排队。**
面试官考的就是你能不能戳破它们。先把请求生命周期时间轴画出来——
排队 → prefill（→ TTFT）→ decode × N（→ ITL/TPOT）→ 流结束（→ E2E），
再对号入座：

| 指标 | 口径（时间轴画在哪段） | 内涵 | 容易埋的坑 |
|---|---|---|---|
| **TTFT** | 请求入队 → 第一个 token 返回 | **排队 + prefill**，不含 decode | prefix cache 命中会把 TTFT 腰斩，报"TTFT 漂亮"必须先拆命中率 |
| **TPOT · ITL** | decode 阶段相邻两个 token 的间隔 | decode 每步延迟 | ITL 是一整个序列（有毛刺分布），TPOT 是其期望；chunked prefill 会周期性掐动 ITL |
| **E2E Latency** | 请求入队 → 最后一个 token 返回 | TTFT + Σ ITL | 被输出长度强主导，输出越长越像 decode 摊销；必须带输出长度分布一起看 |
| **Throughput** | tok/s | **aggregate**（单位时间全系统吐出的总 token）vs **per-request**（单请求视角的产出速率） | 这两个常被混报、能差一个数量级；报告必须写清是哪种 |
| **分位数口径** | p50 / p90 / p99 | 延迟分布的割点 | **均值不可信**：长尾请求把 mean 带飞，SLA 是按 p99 碎的，报告务必声明分位数 |
| **Goodput** | SLO 内完成的吞吐 / 请求比例 | 给定了 SLO（如 TTFT ≤ 200 ms、TPOT ≤ 50 ms）才算得出来 | 不声明 SLO 就没有 goodput；吞吐刷了但 goodput < 100% = SLA 没打住 |

通用答题框架：**画时间轴 → 给每段命名（TTFT / TPOT / E2E）→ 说明口径（aggregate
还是 per-request、哪个分位数）→ 落到 SLO 下的 goodput。**

### 压测注意事项（防"压测无效"的四个坑）

1. **预热**：调度器、prefix cache、CUDA graph、JIT 编译都在第一段请求中才就位；
   先跑几百上千个请求让引擎进稳态再取数，否则第一批请求能把 p99 拉高几倍。
2. **并发梯度扫描**：按 1 → 4 → 8 → 16 → 32 → 64 … 逐档加压，画"吞吐 vs 延迟"
   曲线而不是报单点值；曲线上的**拐点（knee）**才是你在 SLO 下能承诺的最大并发。
3. **输入/输出长度分布贴近真实**：用线上真实的长度直方图回放（常见 lognormal
   或双峰），拿 128/128 打出来的"TTFT 一百毫秒"在线上动不动 4K prompt 的场景里
   直接作废。
4. **拆分 decode-only 阶段单独测**：同一负载下各跑一套"全引擎"和"只打 decode
   实例"的数据，才能分离 prefill 的贡献——PD 分离后拆不开这两段，就证明不了
   配比拆得对不对（呼应第六节）。

▶ 追问答法速查表：

| 追问 | 要点 |
|---|---|
| 报告延迟用均值还是分位数？ | 分位数，且必须声明是哪一个（p50/p90/p99）：延迟是长尾分布，均值会被长输出、重试请求、零星大请求带偏，均值在统计上就没意义；SLA 直击的是 p99 的尾部。 |
| SLO 给了 TTFT ≤ 200 ms，怎么设计压测？ | 先算预算：TTFT = 排队 + prefill，prefill 耗时按 prompt 长度 × prefix 命中率估出，剩下的就是排队预算；然后扫并发梯度逐档收 TTFT 的 p50/p90/p99，取 **p99 ≤ 200 ms 的最大并发**即 goodput 上限。若 p90 还稳、p99 直接炸，说明长尾请求撞上了大 prefill——对应武器：prefix cache、长 prompt 分流、PD 分离把排队的影响另起灶。 |

---

*相关阅读：[vLLM 与推理加速核心](./vllm与推理加速核心.md) ·
[量化与压缩](./量化与压缩.md) ·
[三维并行](../distributed-training/三维并行.md) ·
[ZeRO 与显存优化](../distributed-training/zero与显存优化.md) ·
回 [考点地图](../README.md)*
