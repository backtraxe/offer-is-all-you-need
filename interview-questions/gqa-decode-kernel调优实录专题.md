# GQA Decode Kernel 调优实录专题：Blackwell 上手写赢 FA4 的完整过程

> 面向已经读过 [Attention 的 Profile 实战专题](./attention的profile实战专题.md)
> （SDPA 后端）与 [CUDA 与 Kernel 专题](./cuda与kernel专题.md)（FA 谱系）
> 的读者。本篇拆解一篇 Blackwell SM100 的手写 GQA decode kernel 实录
> （CUTLASS PR #2973 配套，2026-10）：相对 FA4（开了自动 split 与
> S/P ping pong 的实现），**60 个形状中位数 1.46 倍、最高 2.26 倍、
> 自动选择中位数 1.47 倍**。读完获得：① 全案最巧的一刀——**换操作数
> 顺序消掉 padding**（score tile 128×128 → 128×8）；② 两个串行等待的
> 消除法（双 softmax warpgroup、双 O 槽）；③ PDL 把 combine 藏进
> producer 尾巴；④ 两条 reduction 路径（kernel combine vs 集群内
> atomic）怎么选；⑤ **如实保留的负结果**（去 mutex 没增益，32 ns
> 中位获取区间）。
>
> **口径声明**：全部加速比与资源数字来自作者公开的优化实录与 PR
> 描述（B200、BF16、单 query token、CUDA graphs、含 combine），作者
> 已明示「非整模型 serving 结果」；未独立复测。

## 一、问题起点：FA4 的 tile 在 GQA 上是填不满的

FA4 给宽 head group 设计的 tile 是「query 头 × KV 长度」的大矩阵；
GQA 分组查询头少（如 64 query head 对 8 KV head = 8 头一组），打包后
128 行的 tile 里只有 8 行有效，**剩下全是 padding 计算与搬运**。优化
空间不在搬更多字节，而在调度。

## 二、第一刀：换操作数顺序（swap-AB）

改算 `S^T = KQ^T / √d` 与 `O^T = V^T P^T`，**把 KV 位置放到大矩阵维、
小 query head group 放另一维**：

- 8 头 group × 128 个 KV token 的块，score tile 从 **128×128 缩到
  128×8**——padding 计算直接消失；
- softmax 线程把 score fragment 留在寄存器里，TMEM 少搬一半；
- P 也小：完整 P tile 一次交接 SMEM，不必用 FA4 的 split-P arrival
  信令（P 部分就绪就启 PV MMA）。

这一刀是后面的调度优化的地基：**tile 物理尺寸决定了一切下游成本**。

## 三、消串行：双 softmax warpgroup + 双 O 槽

simple kernel 的两个串行点（IKET trace 实锤）：

1. softmax tile 在一个 warpgroup 串行，VP 反复等 P；
2. 单 O 累加器：correction 必须 rescale O 并释放，下一个 VP 才能用。

治疗：

- **偶/奇 tile 分两个 softmax warpgroup 重叠**，running maximum 共享
  更新仍走有序临界区（顺序不变，潜入的工作挪到另一个 warpgroup 上跑）；
- **双 O 槽滚动**：VP 往一个槽写时 correction 在另一个槽 rescale——
  两个 O 槽携带不同的 maximum 历史，最终合并时把旧槽 rescale 到新槽
  尺度再相加。
- 顺手把分母累加搬进 softmax（发布 P 之后做），省掉整块 FP32 的 P
  经 TMEM 的存取交接。

## 四、PDL：把 combine kernel 藏进 producer 尾巴

kernel reduction 走两条 kernel：decode 写 partial（FP32 输出、running
maximum、分母）到全局 → combine kernel 合并。decode 很短时，第二次
launch 占可观比例。**Programmatic Dependent Launch（PDL）**让
combine 在 producer 还没跑完就启动：split statistics warp 写完统计就
调 `griddepcontrol_launch_dependents()`，combine 先做独立 prologue，
碰任何 split maximum 之前 `griddepcontrol_wait()`。

- **PDL 重叠的是「启动开销」不是「合并算术与未写完输出」**——
  语义一定要这么答；
- 顺手删掉 `M_final` 全局缓冲与每次 `memset` reset：各 split 本就写
  自己的 maximum，combine 对 staged 值做一次小 reduce 取代全局最大
  缓冲 + reset launch + CTA 间原子更新；输出 workspace 可直接
  `torch.empty`（每个被 combine 读的值都由本次调用写）。

## 五、集群内 reduce：第二条路，以及怎么选

atomic reduction：一个 batch item + head group 的 KV split 组成
thread block cluster，经 DSMEM 交换 maximum/分母，butterfly 求公共
max、rescale 求和，每个 split 知道自己的最终归一化因子后直接 TMA
reduce add 进最终输出——**省掉 combine kernel 与 global workspace**。

代价写死在实现里：输出每次调用都要清零（含 graph 重放）、BF16 输出
相加顺序相关可能与 FP32 combine 舍入不同、要求 split 数是 2 的幂且
≤16、cluster 的 CTA 必须一起调度。

**自动选择规则（可直接背）**：至多 4 个 split、或 8 split 且≤64 CTA
上用 atomic reduction，其余用 kernel reduction；kernel 模式默认开
PDL，atomic 默认关（没有 second launch 可藏）。实测成对 PDL：
kernel 模式中位省 0.82 µs；atomic 独立模式开 PDL 反而 +0.53 µs——
**有尾巴可藏时 PDL 才有意义，没有就别开**。

## 六、寄存器再分配与一条如实保留的负结果

宽 head group 用 CUTLASS 的寄存器重分配：MMA/TMA warp
`setmaxregister_decrease` 压到 64 寄存器/线程，softmax warpgroup 120，
**correction 要 `setmaxregister_increase` 到 208**（它持有输出
fragment + 分母状态）——不是各角色平均，而是**把寄存器预算分给
真正持有状态的角色**。

负结果（本文最诚实的一段）：试过「去掉 softmax warpgroup 之间的
mutex」——偶/奇组各配独立 SMEM maximum 槽、不抢共享槽，最终合并
时把两套 maximum 历史 rescale 到公共尺度。**A/B 没看到明确增益，
多数持平或略慢**；profile 说 mutex 获取区间中位 **32 ns、最大
96 ns**——等 score tile 更显眼，省这点不够覆盖独立状态与rescale
的复杂度。保留共享 maximum 协议。

**方法论价值 > 结论**：每个优化都有 trace 为证，没增益的改动也
如实写进实录——这是「IKET 方法论」最该抄的部分。

## 七、六格全景与 batch 曲线（官方口径）

- MHA/GQA/MQA 六格（Hq:Hkv=16:1/16:2/16:16，d=64/128，KV 1k–128k）：
  kernel+PDL 与 auto 线在多数形状压过 FA4；MHA d=128、128k KV 时
  auto ≈7.0 TB/s 对 FA4 ≈6.1 TB/s；
- batch scaling：KV=1k 时小 batch 双方接近、batch 32 后 FA4 个别
  反超；KV=8k/32k 时 auto 全程领先，32k KV、batch 64 时 ≈7.3 TB/s
  对 FA4 ≈6 TB/s。**不是处处赢：曲线的回退段作者如实保留**。

## 八、▶ 面试题与追问

**Q1【高】GQA decode kernel 相对 FA 系列还能怎么快？动脑子在哪？**
不在算子在布局：KV 位置摆到大矩阵维、小 head group 摆另一维，score
tile 从 128×128 缩到 128×8，先把 padding 消了；后面才是调度：双
softmax、双 O 槽、PDL 藏启动、集群 reduce 去 combine。**先看形状
有没有填不满，再谈 warp 级调度**。

**Q2【高】PDL 的正确语义是什么？**
让依赖 kernel 在 producer 未跑完时启动 prologue，但碰数据前必须
`griddepcontrol_wait()`——重叠的是启动开销（寄存器分配、代码预热），
不是把合并和未写完的输出重叠。**答 PDL 不答这一句等于不懂**。

**Q3【中高】双 O 槽、双 softmax warpgroup 为什么不是免费的？**
双槽携带不同 maximum 历史，合并时要 rescale 到公共尺度再相加；双
warpgroup 共享 running maximum 仍要有序临界区。**重叠是把工作挪
给闲着的人，不是删掉工作的顺序**——共享标量（max、分母）的顺序
必须保住。

**Q4【中高】kernel combine 和 集群内 reduce 怎么选？**
看 split 数 + CTA 数：少 split（≤4，或 ≤8 且 ≤64 CTA）→ 集群内
（省 combine launch）；否则 kernel combine（无 split 数上限、
FP32 确定性合并、可开 PDL）。代价：集群内要每次输出清零、CTA 必须
共调度、BF16 顺序相关可能改末位舍入。

**Q5【中】softmax 的 running maximum 需要 mutex 吗？实测怎么说？**
要保住顺序（running max 是共享标量）；别为了「看着先进」拆成独立
maximum 槽——作者实测 mutex 获取中位 32 ns，远小于 score tile 的
等待，拆开换不来收益还多一套 rescale。**先看 profile 里的区间大小
再决定拆不拆同步**。

**Q6【中】为什么这篇 resume 里挂满寄存器预算这几个数？**
Blackwell 的 `setmaxregister` 是角色级预算接口：状态持有者
（correction：输出 fragment+分母）要加（208），纯流水线角色
（MMA/TMA）要减（64）。**宽 head group 的性能不是算出来的，是
寄存器预算分出来的**。

## 九、串联阅读

- [Attention 的 Profile 实战专题](./attention的profile实战专题.md)：
  SDPA 后端在 PyTorch 层的对照，本篇是它的 CUTLASS/手写层深挖；
- [CUDA 与 Kernel 专题](./cuda与kernel专题.md)：FA 谱系与 decode
  kernel 族「自成一派」的版图，本篇是它在 Blackwell 的最新案例
  （含与 FA4 的直接对照）；
- [GEMM 优化阶梯专题](./gemm优化阶梯专题.md)：split barrier、集群、
  寄存器预算的同族技巧，在 GEMM 侧的演示；
- [注意力变体 2026 专题](./inference/注意力变体2026专题.md)：GQA/
  MQA/MHA 的头数版图，决定本篇 tile 选择的输入参数。

## 口径与未核实说明

- 全部加速比（中位 1.46/自动 1.47、峰值 2.26、0.82/0.53 µs）与
  带宽（≈7.0 vs 6.1、≈7.3 vs 6.0 TB/s）为作者实录与 PR #2973 的
  B200/BF16 单 query token 实测，作者明确「非整模型 serving 结果、
  回退段如实保留」；未独立复测。
- 「mutex 32 ns/96 ns」为作者实测区间；`setmaxregister` 数字只在
  32 头 tile 配置出现，小 head group 未启用该路径。
