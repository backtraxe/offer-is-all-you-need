# FBTriton 与稀疏算子 Kernel 实战专题：一个 Triton 打赢 CUDA 的生产案例

> 面向已经读过 [CUDA 与 Kernel 专题](./cuda与kernel专题.md)（Triton
> 选型矩阵、roofline 判据）的读者。本篇拆解 PyTorch 官方博客（2026-10）
> 的 FBTriton 案例：把推荐系统的核心稀疏算子 TBE（Table Batched
> Embedding，多表查找+pooling 压进一次 GPU launch）整条前向/反向用
> Triton 重写，**前向中位数 1.28×、反向 Weighted 中位数 1.22×，且原来
> 的 CUDA 模板代码量比普通 Python 还大**。你读完应该记住三件事：
> ① 反向 kernel 的一个「batch → run」视角反转；② 六个可直接抄的
> kernel 工程解法；③ 「赢在阈值」——Triton 打赢 CUDA 的真正原因不是
> 搬得少，是切换点选得对。
>
> **口径声明**：全部加速比与带宽数字为 PyTorch 官方博客实测（GB200，
> 307 个生产分片），未独立复测；TLX 为 Blackwell 代际的 Triton 扩展
> 原语，非 Hopper 可用。

## 一、问题形态：为什么 TBE 难写

前向是 gather + pooling；**反向才是主角**：对 batch 里碰到的每个唯一
（table, row）对，把所有碰过它的样本的上游梯度行加起来，再对该行做
恰好一次优化器更新。关键反转：

- batch 视角说「每个样本读了哪些行」；
- 反向需要逆映射「哪些样本碰了每一行」——`transpose_embedding_input`
  + RLE（run-length 编码）把 batch 反转成 **run**（一个唯一行 + 碰过它
  的样本列表），每个 run 是独立工作单元；
- **segment length（SL，碰过一行的样本数）从 1 跨到数百万**，同一个
  batch 内共存——一切分流都从 SL 出发。

这个形态（长短混杂、比例数据决定）是稀疏算子的通用难题：torch scatter/
index_add、推荐系统 embedding、MoE 的 expert 反传都长这样。

## 二、前向：双路径 + 按形状分流

1. **通用 gather 路径**保通用性；
2. **小表快速路径**：命中窄条件（E≤64、64≤D≤128、L≥64、FP16 权重、
   FP32 输出、无 per-sample 权重、无 VBE）时，把前 256 个索引建成直方图，
   用 `tl.dot` 算 `counts × table` 走 tensor core，一个 program 处理 16
   个 bag，剩余索引走标量路径。其他形状回落通用 kernel。

配套工程：边界检查在独立 CUDA 校验步完成，B200 上各负载最高 **1.24×**；
`fused_bounds_check` 让内核顺手修复非法输入，默认关。

前向结果（GB200、307 分片）：**中位数 1.28×（Model 1）/ 1.18×（Model 2）
，100% 分片不低于持平线**。

## 三、反向：三件大事——转置 hoist、SL 分流、长 run 切碎

1. **把预处理 hoist 进前向**：索引转置/排序/RLE 搬进前向，经 autograd
   把元数据传出，反向不再在关键路径上做反转。大 B200 配置上：前向
   22.844→33.252 ms（变慢了），反向 56.693→32.931 ms，**合计 79.537
   → 66.183 ms（−16.8%）**——前向变慢换整体变快，值得。
2. **SL 三路分流**：短/中/长 run 路由到三个 kernel；weighted 表只多
   一步（累加前按 per-sample 权重缩放梯度行）。
3. **精确 row-wise Adagrad 的跨向复用**：前向的直方图计数保存下来，
   反向用它做补偿的 FP16 高低位 GEMM 进 FP32 再进优化器——前后向仍
   两次 launch，只复用计数。

## 四、六个工程解法（可抄清单）

**解法 1：长 run 切成 256 一块（split-K 风格）+ CLC 常驻偷活。**
两百万次查找的单 run 让一个 program 走全程会饿死整机；按 256 查找切
块变成约八千个子 program。配合 TLX 的 CLC（cooperative launch
control）：kernel 常驻、不断「偷」空闲的 run_id 处理——把「按频率
二分 run_id」的软件调度交给硬件 work-stealing。

**解法 2：gather 宽度是寄存器悬崖，每档目标配自己的宽度。**
每缓冲行让 BLOCK_SIZE 个 64 位地址常驻（`ptr[:,None]+offsets[None,:]`
实例化整块指针 tile），代价 = 宽度 × BLOCK_SIZE；在 A 行宽调好的值到
B 行宽就是寄存器溢出。

**解法 3：BLOCK_SIZE 是 constexpr，按维度分桶再 launch。**
一次 launch 只能按 `next_pow2(max_D)` 定宽；窄表跟着宽表跑，gather 行
的大部分 lane 被 mask 掉。分桶（按 `next_pow2(D)`）后每桶各 launch
自己的 BLOCK_SIZE，分桶逻辑折进分类 kernel 不多走一遍——
**profiling 确认省的是 lane 浪费，不是 occupancy**。

**解法 4：形状知识留在 GPU 上，别用 `.item()` 问 CPU。**
哪些 run 算长是数据决定的、只有 GPU 知道；`.item()` 读回 = 每次反向
一次 `cudaStreamSynchronize`。解法：workspace 按上界预分配，分类
kernel 内 `atomic_add` 一次拿基址 + `cumsum` 拿块内偏移做 stream
compaction，后续 kernel 把计数当 device 指针消费、while 循环自分配。

**解法 5：跨 program 屏障 = fence + 倒计数。**
run 切开后，优化器更新必须等所有子 program 的 partial 落盘。Triton 没
device-scope fence；TLX 暴露后：`tlx.fence("gpu")` + 倒计数
（`remaining==1` 的最后一个子 program 在同一次 launch 里应用优化器）。
**正确性论证本身就是面试答案**：fence 让 partial 在倒计数递减前
device-wide 可见，看到 remaining==1 的 program 读到的必是完整求和；
少了 fence，可能抢跑读到半途的和——静默数值错误，测试都不一定抓到。

**解法 6：partial 合并从行级 atomic 换 TMA reduce。**
八千个子 program 对同一行发 BLOCK_SIZE 次 atomic 是合并热点；换
Blackwell 的 `cp.reduce.async.bulk.tensor`（经
`tlx.async_descriptor_store(..., store_reduce="add")`）。

## 五、赢在阈值：5.8× 实现带宽的 Nsight 证据

这是全案最值钱的一段分析。两套实现的策略切换点不同：**CUDA 在
SL=32 就升级到 cooperative CTA-per-row kernel；Triton 的简单
streaming 一路用到 SL=256。**于是 32–256 是「胜负带」：

- 胜负带深处 Triton 快 **4.3×**，搬运的 DRAM 字节数相当（0.91×），
  load 请求只多 29%——**不是搬得少**；
- Nsight Compute 实测：同形状下 CUDA kernel 实现带宽 678 GB/s，
  Triton **3948 GB/s（5.8×），occupancy 相同**；
- 原因：SL 刚过 32 时，cooperative kernel 的 CTA 级同步**没有足够
  的活摊销**——同步成本是固定的，活小就吃成负优化。

**方法论**：策略升级点（何时从简单 kernel 换协作 kernel）是稀疏算子
调优的第一旋钮，比任何单 kernel 优化都大；而且这个点在 A 硬件调好的
值，到 B 硬件要重调——和 [Vera Rubin 实录](./inference/vera-rubin调优实录专题.md)
「重标定所有按上一代调好的常量」是同一条军规。

## 六、输在哪、平在哪（边界感是加分项）

- **SL<4 的形状 Triton 输**：工作几乎全是 dependent-load 延迟，CUDA
  的 warp-per-row 把 per-run 元数据摊得更好——307 个分片里 11 个，
  每个不到一毫秒，原文明说「成为负载瓶颈时再投」。
- **SL>256 持平**：两套策略在那里趋同。
- 工程结论不是「Triton 全面替代 CUDA」，而是**「阈值可配置的简单
  策略 + 长尾回退」打赢「模板生成的固定策略」**——挪一个升级点在
  Triton 里是改配置，在 CUDA 模板里是重构 kernel 分工。

## 七、结果总表（官方口径）

| 指标 | 数值 | 达标率 |
|---|---|---|
| 前向（两模型 307 分片） | 中位数 1.28× / 1.18× | 100% ≥ 持平 |
| 反向 Unweighted | 中位数 1.13 | 94% ≥ 持平 |
| 反向 Weighted | 中位数 1.22 | 69% ≥ 持平 |
| 边界检查组件 | 最高 1.24×（B200） | — |
| 胜负带深处 | 4.3×；实现带宽 3948 vs 678 GB/s | 同 occupancy |

## 八、▶ 面试题与追问

**Q1【高】稀疏算子（embedding 反传/scatter-add/MoE expert 反传）
性能调优的第一思路是什么？**
先把负载按规模分桶（SL），每桶选策略：短 run 重元数据摊销、长 run
切碎保 occupancy、极长 run 走协作 kernel；**然后先校准切换阈值再
优化 kernel 本体**——本例 5.8× 带宽差全部来自阈值，不是来自指令级
优化。

**Q2【高】`.item()` 为什么不能出现在热路径？**
它就是一次 `cudaStreamSynchronize`：host 停下来等 device，整个流
水断流。形状/计数类知识要么在 CPU 侧预计算、**要么留在 GPU 上传递**
（device 指针 + atomic 基址分配 + cumsum 块内偏移，stream
compaction）。

**Q3【中高】kernel 里怎么做「所有分块都做完了」的屏障？**
三个答案按可用原语排：消息计数 + fence（本例 TLX fence + 倒计数，
最后一个子 program 收尾）；第二次 launch（最朴素，多一次全局往返）；
cooperative launch 的 grid sync（cudaLaunchCooperativeKernel，要求
全 grid 驻留）。**任何「计数器递减到 0 即消费和」的写法，消费前必须
有内存 fence 保证 partial 可见**，否则是静默数值错误。

**Q4【中高】为什么同 occupancy 下带宽能差 5.8 倍？**
occupancy 只保证「有 warp 可换」，不保证「load 发了多少在飞」。实现
带宽 = 在途字节 / 时间；CUDA cooperative kernel 在小 SL 上把大量
cycle 耗在 CTA 同步上，在途 load 稀疏；streaming kernel 没有同步开销，
load 流水线是满的。对照实验的写法：字节数相当（0.91×）、occupancy
相同、带宽差 5.8×——**变量只剩同步摊销**。

**Q5【中】把预处理 hoist 到上游，上游变慢了怎么办？**
算总账：本例前向 +10.4 ms、反向 −23.8 ms、合计 −16.8%。hoist 的
判断式是单次成本 × 调用频次：预处理在反向每次调用都做，hoist 到前
向只做一次——频次不对称就是收益来源。

**Q6【中】Triton 什么时候不该用？**
三种：需要 Blackwell 细粒度特性（warp specialization、TMEM、2-CTA
MMA）表达不了的头部算子（对照 [CUDA 与 Kernel 专题](./cuda与kernel专题.md)
的 FA4 例子）；负载形状单一且固定、手写 CUDA 已经到顶的算子；团队
没有 kernel 维护能力却需要长期演进——Triton 的真正红利是迭代速度
（改阈值改宽度是改配置），用不上这个红利就不必换。

**Q7【中】「前向双路径、反向三 kernel」这种分流设计会不会让代码
爆炸？**
分流的每一路都是小 kernel，契约对外统一（输出布局固定）；分流依据
（形状谓词）必须一键可改。坏味道信号是：某条路径三个月没被打中、
或谓词条件没人说得出为什么——分流该收敛就收敛。

## 九、串联阅读

- [CUDA 与 Kernel 专题](./cuda与kernel专题.md)：Triton vs CUDA 选型
  矩阵的上游理论，本篇是它的生产级证据章；
- [Vera Rubin 调优实录专题](./inference/vera-rubin调优实录专题.md)：
  阈值/常量按硬件重标定的姊妹案例；
- [Attention 的 Profile 实战专题](./attention的profile实战专题.md)：
  「同一 op 多后端」的读 trace 方法，本篇的 Nsight 对照是同一肌肉；
- [搜广推与 LLM 融合专题](./搜广推与llm融合专题.md)：推荐系统侧
  的工程背景——TBE 所在的系统长什么样；
- [AI 编译器与 torch.compile 专题](./ai编译器与torch-compile专题.md)：
  Triton 作为 torch.compile 默认后端的生态位。

## 口径与未核实说明

- 全部性能数字（1.28×/1.18×/1.13/1.22/1.24×/4.3×/5.8×/678/3948
  GB/s/0.91×/+29%/16.8%/毫秒数）为 PyTorch 官方博客实测口径，平台
  GB200 + Blackwell TLX，未独立复测。
- 达标率（100%/94%/69%）与分片数（307 分片、283 形状）同口径；
  「Weighted 69% ≥ 持平」是原文如实披露，非全部打赢。
- 解法 5 的 fence/倒计数模式依赖 TLX（Blackwell 代际），Hopper 及
  更早需用第二次 launch 或 cooperative kernel 替代。
