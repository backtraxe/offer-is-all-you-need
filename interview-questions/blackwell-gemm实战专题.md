# Blackwell GEMM 实战专题：B200 手写八步从 164 到 1401 TFLOP/s

> **面向**：求职「CUDA kernel / 推理性能优化」岗的候选人；想搞懂
> Blackwell 新硬件特性（TMA/mbarrier/TMEM/tcgen05）怎么落地的
> Infra 同学。
> **读完获得**：一套八步登顶 cuBLAS 97 的完整登山日志——其中
> **三步白工、一步干了几乎全部活**；Blackwell 四件新硬件各自解决
> 什么；128B swizzle 治 TMA 写 bank 冲突的机理；「sweep 只在它的
> regime 里有效」等四条可以原话背诵的方法论金句。
> **口径**：案例来自 X 公开发的 CuTeDSL 实操长文（2026-10，B200
> fp16 实测，经公众号转述），数字为**作者自测口径、未经本仓复测**；
> 与 AMD 侧的 [GEMM 优化阶梯专题](gemm优化阶梯专题.md)（Helios/
> MI355X）互为镜像——那篇讲通用阶梯，本篇讲 Blackwell 专有路径。

## 一、一句话主线

首版 kernel 跑 **164 TFLOP/s（cuBLAS 的 11 个点）**，八步之后
4096³ 上 **1401 TFLOP/s（97 个点，840us→98us，cuBLAS 95us）**。
全程的戏剧性不在改动清单，而在：

- **一步（128B swizzle）单独贡献约 4.1 倍**，其余七步加起来
  不到 2 倍；
- **三步完全白工**（warp 特化、流水 epilogue、TMA multicast）——
  但每个 null 结果都排除了一个错误假设，把搜索逼向正解；
- **哪步有用取决于跑 prefill 还是 decode**——swizzle 全形状通吃，
  双 CTA 和 persistent 主要帮 decode，threadblock swizzle 只在
  大形状收尾。

## 二、登山前的四件装备（Blackwell 专有，必背）

| 装备 | 是什么 | 解决什么 |
|---|---|---|
| **TMA**（Tensor Memory Accelerator，Hopper 起） | 一个线程把 descriptor+坐标交给硬件，硬件异步整块搬 tile（GMEM↔SMEM） | 拷贝异步化：发出的 warp 立刻往下走；stride/边界/predication 全在 descriptor 里，线程不烧寄存器算地址 |
| **mbarrier** | SMEM 里的 64 位对象，同时数「到达数」和「字节数」，双零后 phase 翻转释放 waiter | load 路径的完成同步：producer 先 arrive 报字节数，TMA 数据落位逐字节减计数，最后一字节到、phase 翻、consumer 醒 |
| **TMEM**（Blackwell 新增） | 独立于 SMEM/寄存器的片上 Tensor Memory，**每 SM 256KB**，128 lane × 512 列 | accumulator 搬家：Hopper 的 wgmma 把累加器塞寄存器（吃掉大半寄存器文件、tile 做不大、epilogue 和 mainloop 抢寄存器）；Blackwell 让 tensor core 拥有结果，**一个线程就能发 MMA**，寄存器全空出来 |
| **tcgen05 指令族** | alloc/commit/mma/ld：一个 warp 申请 TMEM 列（2 的幂、至少 32 列），MMA warp 发 MMA 指 TMEM 地址，commit 挂 mbarrier 报完工，epilogue warp 读回 | 把「发 MMA—等完工—读结果」拆成三条异步流水 |

记忆钩子：Hopper 的关键词是 **wgmma+寄存器累加器**；Blackwell 的
关键词是 **tcgen05+TMEM 累加器**——「谁拥有累加器」是两代架构的
分水岭，面试讲这句就够。

## 三、八步登山日志（每步：做了什么 → 结果 → 为什么）

四个测试形状全程重测：4096³ 方阵、prefill MLP up（8192×28672
×8192）、decode attention output（256×8192×8192）、decode MLP
up（256×28672×8192）——**每步四个形状**这个纪律本身就是方法论。

### 第 0 步：起点与第一条教训（164 TFLOP/s）

单 buffer、K=16 一条 MMA。profile 显示 warp 每 40.1 个 issue 周期
里 19.5 个卡在 **L1TEX scoreboard（48.8 个点）**。第一反应「内存
延迟」是**错的**：mbarrier wait 的 poll 也走 L1TEX pipe——stall
的真实含义是「线程蹲在 barrier 上等 TMA 和 tensor core 干活，
kernel 没别的活给它们」。**这是 overlap 问题，不是带宽问题**。

### 第 1 步：K-loop（840us，0.11×）

把 K 按 16 步进循环，累加进同一块 TMEM tile，成为第一个真正的
GEMM。新 stall：issue 间隔跳到 167.6 周期，73.8 个点是 warp 在
CTA barrier 等兄弟——**整个循环包在 `if warp_idx == 0` 里，
warp 1-3 全程看戏**。tensor pipe 利用率 7.5 个点。

### 第 2 步：4 级流水（448us，0.21×，**1.87–1.95 倍**）

SMEM buffer ×4 转 ring：load 与 MMA 重叠。全形状普涨，issue 间隔
167.6→59.6。但新信号：**L1/TEX 吞吐冲到 98.9 个点，DRAM 才
2.3 个点，L2 命中 95.6 个点**——pipe 忙死、HBM 没字节，说明在
处理「大量零散访问」而不是「大量数据」。这是 **bank 冲突的嫌疑人
画像**，但当时先记下了。

### 第 3 步：warp 特化——白工一号（449us，零增益）

producer/consumer 分 warp。机制生效了（CTA barrier stall 43.3→
37.1），**计时纹丝不动**。原因：L1/TEX 已 98 个点顶死，闲下来的
warp 加速不了等数据的 warp；而且发指令本来就全是异步的，卡的
从不是 issue。**「改动生效」不等于「改动有用」**——这个 null 逼
作者从「读代码推理瓶颈」切换到「往 kernel 里做减法」。

### 第 4 步：128B swizzle——几乎全部功劳（110us，**单步 4.1 倍**）

先做减法 ablation（4096³ 单变量）：

| 砍法 | 耗时 | 结论 |
|---|---|---|
| 只留 MMA 链（无 load） | **96.4us ≈ cuBLAS 速度** | 计算本来就达标 |
| 只留 load（无 MMA） | 417.3us | **load 路径占 92 个点时长** |
| stage 4→8 | 454.6us | 不是 latency 问题 |
| tile_k 16→64 | 448.5us | 不是 copy 发射率问题 |
| 每 SM 2 CTA | 555.0us | 更多并发反而更差 |

瓶颈==SMEM 数据排布。机理：tile_k=64 时 A 每行 64 个 fp16 正好
128 字节、行 stride 也是 128 字节，**每行都从 bank 0 起**；TMA
一次写多行全堆同一组 bank 排队。**128B swizzle**：每行切八个
16B 块，块下标与行下标 XOR 置换——八行读同一逻辑列时摸八组
不同 bank，地址运算就一个 XOR。

数字：**纯 load 路径 3.85 → 18.5 TB/s（4.8 倍）**，与 4 路冲突的
理论预测对严；tensor pipe 13.7→63.7，L1/TEX 98.8→68.8，DRAM
2.3→9.4——**数据终于多到 HBM 有存在感了**。

两个拖时间的坑（面试讲细节用）：

1. swizzle 要求 tile_k≥64，而**单测 tile_k=64 没任何变化**
   （448.5us）——**两个改动必须一起上，单独测每半都是死胡同**，
   这就是它拖到第 4 步才被发现的原因；
2. swizzle 得加在**指针**而非 layout 上（composed layout 被拒），
   走 `recast_ptr`，基指针要 1024 字节对齐。

### 第 5 步：流水 epilogue——白工二号（109us，零增益）

给 epilogue 的四拍（TMEM→寄存器→转格式→写回）做寄存器双缓冲，
防「假想的」write-after-read hazard。零变化。**hazard 根本不存在**：
DSL 降成 SSA 后每个 copy 产出新值，ptxas 早已把四条独立链流水。
教训量化：**epilogue 全程最多 13us，占 109us kernel 的 12 个点**，
完美版也省不出多少——**先量占比再动手**。

### 第 6 步：TMA multicast——白工三号（109us，prefill 反慢 6 个点）

同行 16 个 CTA 各取同一份 A tile，multicast 让一次请求喂一个
cluster。机制也生效（L1/TEX 68.3→59.2），计时不动、prefill 还慢
了 6 个点。原因：swizzle 之后 kernel 已算力受限，**L2 流量从来
不是瓶颈，瓶颈是每个 CTA 自己 SMEM 的填充**。留下的理由：学会
`create_tma_multicast_mask`，下一步双 CTA 恰好要用。

### 第 7 步：双 CTA MMA（107us，decode 明显受益）

`CtaGroup.TWO`：相邻 SM 上一对 CTA 合发一个 256 行高的 MMA，
各出一半操作数、各在自己 TMEM 放一半累加器——**每 CTA 算术强度
85 → 128 FLOP/B**，一对盖住 M 全 256 行时权重 tile 只取一次。
最难的是**对等体不对称**：full barrier 全归 leader，follower 的
empty barrier 靠 commit mask 点名才不被 hang（K=192 能跑、
K=1024 hang 的鬼故事）。方阵增益小，decode 增益大（attention
output 54→48us，MLP down 166→138us）。

profile 指向下一步：每 SM 一个 block（occupancy 6.25 个点，
SMEM 197.6/200.7KB），波数 3.46——**block 排空时没东西喂
tensor core，要的是 overlap 而不是更多并行**。

### 第 8 步：persistent kernel + TMEM 双缓冲（98us，0.97×）

普通 kernel 是一串 wave，block 算完一块 tile 就退；persistent
只 launch SM 数个 block（148 个，74 对），每个 block 自己循环
tile。overlap 的来源：**TMEM 512 列，128×256 的 fp32 累加器占
256 列，正好塞两份 slot**——tile i 累加进 slot i%2，epilogue 排空
slot 0 时 MMA warp 已在 slot 1 跑 tile i+1。**和 AB tile 双缓冲
同一招，用在输出侧**。

数字：tensor pipe 61.7→74.5（4096³）、84.8→93.9（8192³）；波数
3.46→1.0；top stall 从 CTA barrier 变成 L1TEX scoreboard——
**看着更糟其实更好**：那是各角色在等 handoff，是流水线在呼吸。
限制：每 slot N≤256；epilogue 必须比 mainloop 短才藏得住（小 K
不行）；首 tile 的 mainloop 和末 tile 的 epilogue 无 overlap 可谈。

### 终点对账（vs cuBLAS）

| 形状 | 本文 | cuBLAS | 比值 |
|---|---|---|---|
| 4096³ | 98.0us | 94.9 | **0.97** |
| decode MLP up（256×28672×8192） | 113 | 111 | **0.98** |
| prefill attention output | 816 | 741 | 0.91 |
| prefill MLP up | 2934 | 2407 | 0.82 |
| decode fused QKV | 52 | 38 | 0.74 |
| decode attention output | 48 | 32 | 0.67 |

decode MLP up 几乎打平的物理解释：kernel 从 HBM 读 478MB
**恰好等于权重矩阵大小**——每个权重读一次，DRAM 已跑峰值
60.6 个点，这是 memory-bound 形状的物理极限，不是 kernel 的错。
decode attention output 最惨：grid 只有 64 个 CTA（148 个 SM
上 0.43 个 wave），一半机器闲着——persistent 救不了每 block
不足一块 tile 的形状，更小 tile 或切 K 是下一步。

## 四、方法论四条金句（面试收尾用）

1. **「profile 不会说谎，代码会。」** 第 0 步的 L1TEX stall 看着
   像内存延迟，实为等 barrier；第 3/5/6 步从代码看多合理，计时
   全是零。先 profile 定位，再动代码。
2. **「先量占比，再决定是否优化。」** epilogue 只占 12 个点，
   完美版也省不出 13us——白工二号本可被一次占比预估避免。
3. **「null 结果也是结果。」** 三步白工各自排除了一个错误假设
   （issue 串行、epilogue hazard、L2 流量），把搜索逼向 load 路径
   排布——排除法会走路，盲改不会。
4. **「sweep 只在它的 regime 里有效。」** stage 数第 3 步扫时
   4/8/12 全平（那时不 latency-bound），第 7 步重扫 5 级才饱和——
   **同一个 knob 在项目两个时点给出相反结论，因为瓶颈搬家了**。
   参数扫掠结论离开 regime 即失效。

## 四·增、A2 速记：NVFP4 超 cuBLAS

- **#114 7 warp 四角色、K96/256 双 CTA MMA、TMEM 双缓冲、L2 分区
  调度**：超 cuBLAS **4.7%**；读 `%laneid` 提速 **77.5%**；SMEM 占用
  **99.1%**。
- 面试点：Blackwell 上「SMEM 打满」不是事故，而是用占用率换单 CTA
  吞吐；关键是 TMEM 双缓冲与 CTA 协作。

## 五、▶ 面试题

**Q1【高】Blackwell 相对 Hopper 在 GEMM 编程模型上的本质变化？**
答：累加器的归属。Hopper 的 wgmma 把 accumulator 放寄存器文件，
吃掉大半寄存器、限制 tile 尺寸、epilogue 和 mainloop 抢资源；
Blackwell 引入 TMEM（每 SM 256KB，独立于 SMEM/寄存器），tensor
core 直接拥有结果，一个线程就能发 tcgen05.mma，寄存器全部空出来
给 epilogue。配套变化是 mbarrier+TMA 成为标准同步件、TMEM 还能
双缓冲做输出侧流水。一句话：Hopper 优化寄存器分配，Blackwell
优化 TMEM 槽位调度。

**Q2【高】这个案例里最大单步收益是什么、机理是什么？**
答：128B swizzle，单步约 4.1 倍。tile_k=64 时 A 的行宽和
行 stride 都是 128 字节，每行都从 bank 0 起，TMA 批量写多行时
全堆同一组 bank 排队；swizzle 把每行八个 16B 块与行号 XOR 置换，
八行访问八组不同 bank。实测纯 load 路径 3.85→18.5 TB/s（4.8 倍），
与 4 路 bank 冲突理论吻合。注意**冲突方是 TMA 写而非 MMA 读**——
只跑 MMA 的 ablation 在平直排布下就到 cuBLAS 速度，这一点最能
区分「背过结论」和「理解机制」。

**Q3【高】为什么 warp 特化、流水 epilogue、TMA multicast 三步
全是零增益？如何预判？**
答：三个共同点是都在优化「非当前瓶颈」。warp 特化优化 issue
串行，但所有发射本是异步，卡的是等数据；epilogue 流水防的
WAR hazard 在 SSA 形态下不存在，且 epilogue 只占 12 个点；
multicast 减 L2 流量，但 L2 命中已 95.6 个点、瓶颈在 SMEM 填充。
预判方法：profile 给出瓶颈候选 → 单变量 ablation 验证 → 估算
理论收益上限（占比×加速比）——三条都不过就跳过。这就是
「先量再动手」。

**Q4【中】persistent kernel 配合 TMEM 双缓冲解决了什么？代价是？**
答：解决 wave 间空隙：普通调度下 block 算完一块 tile 退出、下一
block 才填进，tensor core 在边界断粮；persistent 让 148 个 block
常驻、自循环 tile，配合 TMEM 双 slot（epilogue 排 slot 0 时 MMA
跑 slot 1）把输出侧也流水化，波数 3.46→1.0、tensor pipe 上到
74.5/93.9。代价：TMEM 512 列限制了每 slot N≤256；epilogue 必须
短于 mainloop 才能完全藏住；首末 tile 无对象可 overlap；每 block
不足一块 tile 的形状（小 grid decode）完全无收益。

**Q5【中】什么叫「sweep 只在它的 regime 里有效」？举例。**
答：stage 数在第 3 步扫时 4/8/12 级计时全平（当时瓶颈不在
latency，加 buffer 无用），第 7 步 tile 变深、双 CTA 减半操作数、
每 stage SMEM 从 12KiB 涨到 32KiB 后重扫，5 级才饱和、4 退居
次优。同一个 knob 在瓶颈搬家前后给出相反结论。推论：参数表、
经验配置都必须标注它成立时的 bottleneck regime；换瓶颈就要重扫。

**Q6【中】decode attention output 为什么只到 cuBLAS 的 0.67？**
答：不是算不动，是喂不饱。M=256 的形状 grid 只有 64 个 CTA，
148 个 SM 上 0.43 个 wave，一半以上的机器全程闲置；DRAM 只有
3.0 TB/s（cuBLAS 4.4）。persistent 要求每 block 多块 tile 才能
overlap，这里每 block 不足一块。下一步显而易见：更小 tile、
split-K 或换 kernel 家族。面试加分点是把「比值低」翻译成
「wave 利用率不足」，而不是「kernel 写得差」。

**Q7【低】这个案例对日常工作最可迁移的三件事？**
答：① 每步改动**全形状重测**（方阵+prefill+decode 四个形状），
单点结论不可外推；② ablation 一次只动一样，且**组合项要识别**
（swizzle+tile_k 单独测都是死胡同）；③ 给每个 null 结果写一句
「它排除了什么」——三步白工的排除链（issue→hazard→L2）就是
通往 bank 排布的地图。

## 六、串联阅读

- [GEMM 优化阶梯专题](gemm优化阶梯专题.md)（AMD Helios/MI355X
  13 级通用阶梯，与本篇互为镜像：通用方法论 vs Blackwell 专有路径）
- [GQA decode Kernel 调优实录专题](gqa-decode-kernel调优实录专题.md)
  （同平台 SM100 的另一场手写实战，FA4 对比）
- [attention 的 profile 实战专题](attention的profile实战专题.md)
  （profile 判读方法论同族）
- [torch.profiler 入门实战专题](torch-profiler入门实战专题.md)
  （先量再动手的工具入口）
- [cuda 与 kernel 专题](cuda与kernel专题.md)（bank/SMEM/流水基础八股）
- [低精度预训练专题](distributed-training/低精度预训练专题.md)
  （Blackwell 硬件能力在训练侧的对应面）

## 七、口径与未核实说明

1. 全部耗时与带宽数字为作者在 B200、fp16、CuTeDSL 环境下的
   **自测口径（2026-10，经转述）**，未经本仓复测；cuBLAS 比值随
   cuBLAS 版本、shape、boost 状态波动。
2. 「实验是 Claude 跑的」为作者自述（agent 辅助做 ablation），
   不影响数字口径，但说明复现脚本与 rung_sweep.json 在其 GitHub
   仓库可查——学习时可顺藤摸瓜。
3. prefill MLP up 的 0.82 差距作者标注「还没查」，decode fused
   QKV 0.74 同理——未知即未知，面试别硬编解释。
