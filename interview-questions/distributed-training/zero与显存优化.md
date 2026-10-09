# ZeRO 与显存优化

> 分布式训练模块第二篇，AI Infra 训练岗**计算题重灾区**：AdamW 显存拆账、
> ZeRO-1/2/3 各分片什么、显存降幅与通信开销，是滴滴/百度的招牌高频题。
> 本文按「拆账 → ZeRO 三代 → FSDP → 重计算/offload → 组合拳决策树 → MoE」组织。
> 上一篇 [三维并行](./三维并行.md) 讲切法，本篇讲"每份怎么更省"。

## 一、训练显存拆账（极高频计算题）

▶ 面试题：AdamW + 混合精度为什么占 4 倍参数量显存？训练显存怎么拆账？——**极高频**（滴滴/字节计算题）

### 四大件

训练时显存 = **参数 + 梯度 + 优化器状态 + 激活**。前三个统称"模型状态
（model states）"，第四个是激活（activations）。

| 项 | 内容 | 每参数字节数（混合精度 AdamW） |
|---|---|---|
| BF16/FP16 权重 | 前向反向实际参与计算的那份 | 2 |
| BF16/FP16 梯度 | 反向算出来的那份 | 2 |
| FP32 主权重（master weights） | 优化器真正更新的高精度副本 | 4 |
| FP32 一阶动量 m | AdamW 的 | 4 |
| FP32 二阶动量 v | AdamW 的 | 4 |
| **合计** | | **16 字节/参数** |

```text
7B × 16 B = 112 GB    ← 这就是"7B 全参训练单卡（80G）放不下"的全部理由
为什么是混合精度的"4 倍"：FP32 那份模型本来是 4B/参数，
混合精度为了求稳定再多背了 master copy 和两份动量 → 16B = 4 × 4B。
```

三个常见追问，顺手备着：

- **为什么要 FP32 主权重？** FP16/BF16 精度太低，lr × gradient 的更新量可能小
  到被舍入误差吃掉（尤其后期 loss 平稳时），更新必须在 FP32 上累计。
- **激活算多少？** 与 batch、序列长、层数全都正相关，和并行无关时**常常反超
  模型状态成为大头**——估算量级见第四节与第六节。
- **和 KV Cache 的关系？** 面试最爱设的陷阱：**KV Cache 是推理的账，与训练的
  16B/param 模型状态完全无关**。推理显存 = 权重 + KV Cache + 余量；训练显存 =
  16Ψ + 激活 + 碎片。两套公式不要混（推理详见
  [Transformer 与 Attention 的 KV Cache 节](../llm基础/transformer与attention.md)）。

## 二、ZeRO-1/2/3：分片什么、省多少、付什么

▶ 面试题：ZeRO-1/2/3 各分片什么？显存降幅和通信开销各多少？——**极高频**（滴滴/百度高频）

### 一句话原理

DP 的浪费在于：N 张卡**每张都存一份完整的模型状态**，但它们反正最后梯度要等
价，冗余是白白浪费的。ZeRO 的思路：**把模型状态分片到 DP 各卡上，每个人只
持有 1/N，用时靠通信临时拼出来**。按分片对象分三代：

<div class="diagram-embed">
<iframe src="assets/diagrams/zero-stages.html" width="100%" height="880" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/zero-stages.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 对照表（Ψ = 参数量，N = DP 度，通信量以 DeepSpeed 论文口径记）

| 方案 | 每卡模型状态 | 降幅（相对 AdamW 全量 16Ψ） | 通信量（每 step） | 对比 DDP 基线（≈2Ψ） |
|---|---|---|---|---|
| DP + AdamW | 16Ψ | 1×（基线） | 2Ψ（梯度 AllReduce） | 1× |
| **ZeRO-1** | 4Ψ（BF16 w + BF16 g）+ 12Ψ/N | 优化器状态省 N 倍，大模型下 ≈ 4× | 2Ψ（梯度 AllReduce） | **≈ 1×** |
| **ZeRO-2** | 2Ψ（BF16 w）+ 14Ψ/N | 梯度再省 N 倍，≈ 8× | 2Ψ（梯度 ReduceScatter） | **≈ 1×** |
| **ZeRO-3** | **16Ψ / N** | 全部分片，理论 N 倍 | 3Ψ（fwd 参数 AllGather Ψ + bwd 参数 AllGather Ψ + 梯度 ReduceScatter Ψ） | **≈ 1.5×** |

> 口径说明：ring AllReduce 一次 ≈ 2Ψ（发送 + 接收合计），ReduceScatter 本身
> 只有 Ψ（每个 rank 只发出自己那 1/N 份）。表里 ZeRO-3 的 3Ψ 就是这么来的。

**答法要点**：先按"优化器状态 → 梯度 → 参数"的递进讲三代各分片了什么（这一定
答对）；显存降幅用 **16Ψ 拆分** 口算；通信量记住一句话：**"ZeRO-1/2 通信量
和 DDP 一样，ZeRO-3 变成 1.5 倍——用 50% 的额外通信换 N 倍显存压缩"**。

## 三、完整计算题示例（把上面的表用起来）

### 示例 1:7B + AdamW 混合精度单卡显存

```text
模型状态 16Ψ = 7e9 × 16 B = 112 GB
+ 激活：batch 8K seq、mbs=1 量级还要再加十几 GB（与实现有关）
→ 总需求 > 128 GB，单卡 80G 放不下。结论：必须上 ZeRO 或 3D。
```

### 示例 2:7B，ZeRO-3 + DP=8

```text
每卡模型状态 = 16Ψ / N = 112 GB / 8 = 14 GB
+ 激活（未做 TP/SP，全开 gradient checkpointing 后几 GB 到十几 GB 量级）
→ 每卡 ≈ 14 GB + 激活 < 30 GB。80G 卡绰绰有余——这正是 DeepSpeed
"7B 单机 8 卡能训"的 benchmark 来源。

追问变形：DP=64 呢？16Ψ/64 ≈ 1.75 GB/卡 + 激活。模型状态已经几乎不是
问题，瓶颈转移到通信和激活。
```

### 示例 3:70B，ZeRO-3 + DP=64，够不够？

```text
70B × 16 B / 64 = 17.5 GB/卡 ≈ 20 GB
+ 激活（70B 层多，若不开 TP 或 checkpoint，seq~4K 时激活可达几十 GB）
→ 模型状态 OK，但激活爆了。
→ 工程答案：ZeRO-3 只负责摊模型状态，**激活问题要么叠 TP/SP（见上一篇
   三维并行），要么开 gradient checkpointing**。这就是"FSDP 和 TP 要一起用"
的原因。
```

**面试常见考点就在这三步**：单卡算爆 → ZeRO 拆账 → 拆完发现激活才是新问题，
自然引出下一招。

## 四、FSDP 与 ZeRO-3 的对应关系

▶ 面试题：DeepSpeed 和 FSDP 的区别？FSDP 是什么分片？——**中高频**（腾讯/美团）

PyTorch 官方原生 FSDP（FullyShardedDataParallel）相当于 **ZeRO 思想的一等
公民实现**：

| FSDP 模式 | ZeRO 对照 | 分片内容 |
|---|---|---|
| `NO_SHARD` | 普通 DDP | 不分片 |
| `SHARD_GRAD_OP` | **ZeRO-2** | 梯度 + 优化器状态 |
| `FULL_SHARD` | **ZeRO-3**（默认） | 参数 + 梯度 + 优化器状态 |
| `HYBRID_SHARD` | ZeRO-3 × 节点内 / DDP × 节点间 | 8 卡内分片，跨节点复制——**工程上最常用的折中** |

答法要点：**FSDP 就是「PyTorch 原生版 ZeRO」**，FULL_SHARD ≈ ZeRO-3；
HYBRID_SHARD 是大集群上的实用形态——节点内 8 卡分片、跨节点复制，把通信
留在节点内/节点间分层。FSDP2（`fully_shard` API）把分片从整个 module 改成逐
parameter，更细粒度、通信更好重叠，可作为加分项提一句。

## 五、梯度检查点：重计算换显存

▶ 面试题：显存不够怎么救（检查点/混合精度/offload/ZeRO）？——**中高频**（组合拳题）

**Gradient Checkpointing（激活重计算）**：前向时**只存少量锚点激活**（比如每
层边界），用掉就扔；反向传播到某一层时**重新从锚点前向算一遍**补出中间激活。

- 显存：从 ∝ L 变成 ∝ √L（两层锚点间再套检查点）或几 GB 的常数级；
- 计算代价：多算一遍前向，**约 +30% 训练时间**；
- 工程变体：**selective recompute**（只重计算便宜的部分，如 attention 的
  softmax 内部，把 MatMul 输入留住）——Megatron 默认方案，几乎零成本省掉
  大头激活；
- 和 ZeRO 是**正交**的：ZeRO 分模型状态，checkpoint 分激活，一起上。

## 六、MoE 负载均衡与激活显存

▶ 面试题：MoE 负载均衡？激活显存怎么算？——**中频**（美团/拼多多）

两个分开的考点：

1. **负载均衡**：router 给每个 token 选 top-k 专家，每个专家有 capacity
   （= 全局 token 数 / E × capacity factor）上限。某些专家若"爆红"，超额的
   token 直接 **drop**（掉 token，效果下降）；严重时触发容量上限 → 计算空转。
   解法标准答案：在 loss 里加 **Load Balancing Auxiliary Loss**（鼓励均匀路由）
   与 **Router z-loss**（防止 router logits 过大）；EP 部署上还要考虑热点专家
   动态复制（专家恒等复制）。
   → 详见 [三维并行的 EP 节](./三维并行.md)。
2. **激活显存**：MoE 中间 FFN 维度 × top-k 放大，**激活比同参数稠密模型大
   k 倍量级**；加上 EP 通信是 AllToAll ×top-k，长 batch 时激活 + 通信双杀。
   估算时记住：**只用激活参数算「等效 FFN 宽度」，再按 dense 的激活公式乘 k**。

## 七、Offload：把数据从 HBM 请出去

当 ZeRO-3 + checkpoint 还是不够，下一张牌是 **offload**（ZeRO-Offload /
ZeRO-Infinity）：

| 方案 | 把谁搬哪去 | 带宽瓶颈 | 适合场景 |
|---|---|---|---|
| CPU Offload | 优化器状态、FP32 master、m/v 放 CPU 内存，计算也在 CPU | PCIe/NVLink-C2C（几十 GB/s 量级） | 中等规模微调，显存紧但不追求极致 MFU |
| NVMe Offload | 再多一档：NVMe SSD 存模型状态 | SSD GB/s 量级，跨节点并行文件系统 | 百亿~千亿参数、CPU 内存也不够时 |
| 激活 Offload | 前向激活临时搬 CPU，反向再搬回 | PCIe | 长序列、一次跑不动的极端场景 |

offload 本质上是用**带宽换显存**：每次都为计算准备好数据，通信/IO 变成了新
瓶颈。面试里提它时一定补一句"**吞吐会掉，但能把不可能的模型变成能跑**"。

## 八、组合拳决策树（显存不够怎么办）

<div class="diagram-embed">
<iframe src="assets/diagrams/vram-decision.html" width="100%" height="940" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/vram-decision.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

答法要点（面试一句话版）：**"先拆账（16Ψ vs 激活）→ 模型状态靠 ZeRO/分片 →
激活靠 checkpoint/TP/SP → 再不够 offload → 全程记住通信开销换显存是每一档的
共同代价。"** 然后一定要落到"我在项目里用的组合是什么、MFU/吞吐多少"——
面试官真正想听的是后一句。

## 九、手撕练习（→ coding/）

配套手写练习（放在 [coding/](../../coding/)）：

- **手写一个 mini ZeRO**：用 4-8 个进程模拟 DP，实现梯度 ReduceScatter 和
  参数 AllGather，对比每卡显存峰值（可用 torch profiler / nvidia-smi）；
- **手撕梯度检查点**：写一个带 checkpoint 的 toy transformer block，对比
  "全开"和"全开+checkpoint"的前向显存，验证反向结果一致；
- **激活显存计算器**：给定 L、h、s、b、top-k，按本篇文章里的量级公式输出
  模型状态和激活的拆账，面试前口算热身。

---

*相关阅读：上一篇 [三维并行](./三维并行.md) ·
训练框架落地见 [训练框架与稳定性](./训练框架与稳定性.md) ·
显存公式的另一半（KV Cache 推理账）见
[Transformer 与 Attention](../llm基础/transformer与attention.md)*
