# 08 CUDA Kernel 入门：一份代码，GPU 替你跑一万遍

> 本篇面向读完 [04 GPU 与算力入门](./04-gpu与算力入门.md) 的读者：04 讲的是
> 「为什么 AI 烧显卡」的三笔宏观账（FLOPS / 带宽 / 显存），这一篇下钻一层，
> 看清**一份 Kernel 代码在 GPU 里到底怎么被执行**——线程怎么分工、显存分
> 几层、warp 是什么。读完你能把 `i = blockIdx.x * blockDim.x + threadIdx.x`
> 的来龙去脉当常识讲，并备好「SIMD vs SIMT」这道**实录原题**的答法。
> 这是通往 [CUDA 与 Kernel 专题](../interview-questions/cuda与kernel专题.md)
> 和 [CUDA 算子手撕](../coding/工程手撕/cuda算子手撕.md) 的最后一级台阶：
> 那两篇默认你懂这些词，本篇负责把它们讲懂。

## 一、Kernel 是什么：按单线程写，跑一万遍

回顾 04 的一句话：GPU 是给「同一件事重复一亿次」设计的机器。那「一件事」
在代码里长什么样？就是 **Kernel——一段跑在 GPU 上、被大量线程同时执行
的函数**。

最重要的心智模型只有一句：

> **Kernel 按单线程视角写一次；GPU 启动成千上万个线程，每个线程把这份代码
> 各跑一遍，各管自己那份数据。**

用最小的例子对照：两个长度 100 万的数组逐位相加，`c[i] = a[i] + b[i]`。
CPU 写法是一个循环，一个加法器挨个处理一百万次迭代：

```c
void add_cpu(int n, float *a, float *b, float *c) {
    for (int i = 0; i < n; i++) c[i] = a[i] + b[i];
}
```

CUDA 写法里循环消失了——每个线程只处理一个位置，一百万个线程同时开工：

```cuda
__global__ void add(int n, float *a, float *b, float *c) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
```

三个新面孔，本文剩下篇幅各负责一个：

- `__global__`：修饰词，宣告「这是 Kernel，从 CPU 侧调用、在 GPU 上执行」；
- `<<<blocks, threadsPerBlock>>>`：启动语法，一次说清要开多少线程；
- `int i = blockIdx.x * blockDim.x + threadIdx.x;`：线程自己算「我该处理
  哪个元素」——全篇最重要的一行，下一节细讲。

`if (i < n)` 不是防御式编程的客套，有真实原因，同样下一节说。

## 二、线程的三级组织：i 是怎么算出来的

GPU 一次开成千上万线程，不能散养。CUDA 用三级结构组织它们：

| 层级 | 是什么 | 数量级 |
| --- | --- | --- |
| **线程（thread）** | 把 Kernel 跑一遍的单个工人 | 一次启动百万级起步 |
| **线程块（block）** | 一组线程，同块之间可经共享内存通信 | 每块通常 ≤1024 线程 |
| **网格（grid）** | 一次 Kernel 启动的所有块 | 块数几乎没有上限 |

为什么偏偏要加「块」这一层？两个硬原因：一是**单块线程数有上限**（现代卡
通常 1024）；二是共享内存与块内同步只在块内可见，块与块互不依赖——正因
如此，块才能被随意分派到任何 SM 上（第四节），硬件才有调度自由度。

每个线程跑的代码一模一样，那谁算第 5 个加法、谁算第 522 个？CUDA 的答案
是给每个线程发几个**内置变量**，让线程自己算自己的任务号，全程无需协商：

| 变量 | 含义 | 向量加法例子里 |
| --- | --- | --- |
| `threadIdx.x` | 我在块内的编号 | 0～255 |
| `blockIdx.x` | 我的块在网格里的编号 | 0～3906 |
| `blockDim.x` | 每块的线程数 | 256 |

于是全局任务号只是一道小学算术：

```text
i = 块号 × 每块线程数 + 块内线程号
i = blockIdx.x * blockDim.x + threadIdx.x
```

代几个数：块 0 的线程 0 → `0×256+0=0`；块 1 的线程 0 → `256`；块 2 的
线程 10 → `2×256+10=522`。每个线程算出的 i 全网格唯一——**一份代码，
百万线程瓜分百万个任务，靠的就是这行乘加**。

再看启动那行：

```cuda
int threadsPerBlock = 256;
int blocks = (n + threadsPerBlock - 1) / threadsPerBlock;   // 向上取整
add<<<blocks, threadsPerBlock>>>(n, d_a, d_b, d_c);
```

`n=1000000`、每块 256 线程 → 3907 个块、共 3907×256 = **1,000,192 个
线程——比 100 万多出 192 个**。块数按「向上取整」算，尾块注定含越界线程，
所以 Kernel 里必须 `if (i < n)` 让它们原地空转，否则这 192 个线程会各往
界外野写一笔。`d_a` 这些指针是数据在**显存**里的地址，`d_` 前缀（device）
是命名惯例。

> 补一个小字注：示例里到处是 `.x`，因为 CUDA 允许线程 / 块按一维直线、
> 二维平面、三维立方组织（图像和矩阵常开二维，会多出 `.y` / `.z`）。
> LLM 的算子绝大多数一维就够用，多维换汤不换药。

## 三、主机与设备：六步固定流程

CUDA 有对高频词：**主机（host）= CPU + 内存**；**设备（device）= GPU +
显存**。两边内存互相独立，入门层面先粗暴记住「CPU 读不到显存，GPU 读不到
内存」（现代平台有统一虚拟地址等机制，但第一直觉这样记不会错）。想让 GPU
干活，数据必须先搬过去，任何 CUDA 程序都走同六步：

```text
第 1 步  CPU 侧准备好数据（a、b 在内存里）
第 2 步  cudaMalloc(&d_a, ...)                     在显存里申请空间
第 3 步  cudaMemcpy(d_a, a, ..., cudaMemcpyHostToDevice)    搬过去
第 4 步  add<<<blocks, threads>>>(n, d_a, d_b, d_c)         启动 Kernel
第 5 步  cudaMemcpy(c, d_c, ..., cudaMemcpyDeviceToHost)    搬回来
第 6 步  cudaFree(d_a) ...                        释放显存
```

落到代码就是这段（省略错误检查）：

```cuda
float *d_a, *d_b, *d_c;                                        // 设备指针
cudaMalloc(&d_a, n * sizeof(float));                           // 第 2 步
cudaMalloc(&d_b, n * sizeof(float));
cudaMalloc(&d_c, n * sizeof(float));
cudaMemcpy(d_a, a, n * sizeof(float), cudaMemcpyHostToDevice); // 第 3 步
cudaMemcpy(d_b, b, n * sizeof(float), cudaMemcpyHostToDevice);
add<<<blocks, threadsPerBlock>>>(n, d_a, d_b, d_c);            // 第 4 步
cudaMemcpy(c, d_c, n * sizeof(float), cudaMemcpyDeviceToHost); // 第 5 步
cudaFree(d_a); cudaFree(d_b); cudaFree(d_c);                   // 第 6 步
```

第 3、5 步走 PCIe / NVLink 这类总线，比 GPU 算数慢得多——04 讲 roofline
时那句「GPU 不是算不快，而是搬不动」，税根就在这两步。所以「这个任务值
不值得上 GPU」的判断朴素得很：**搬运开销要是盖过省下的计算时间，就别上**。
10 个数的加法搬去 GPU 是亏本买卖；百亿参数的矩阵乘是稳赚生意，04 的
三笔账会告诉你差多少个量级。

第 5 步为什么不可省：GPU 算完的结果躺在显存里，CPU 后续要打印、要存盘，
都得先拷回内存。顺带一个常识：`cudaMemcpy` 本身是同步的，搬完才执行下
一行，这行代码的耗时可以直接拿表掐。

（编译一句话：CUDA 代码存成 `.cu` 文件，用 NVIDIA 的 `nvcc` 编译，它同时
懂主机侧的普通 C++ 和设备侧的 Kernel。）

## 四、GPU 内部：SM、warp 与分支发散

Kernel 启动之后，硬件怎么跑它？两级结构：

**第一级，块进 SM。** GPU 由上百个 **SM（流式多处理器）** 组成，每个 SM
装着成百上千个小核心。3907 个块不会一次全上——每个 SM 领几个块，做完再
领下一批，直到清空。块与块本就互不依赖，谁先谁后、分给谁都无所谓，
这个设计让「多开几千个块」永远安全。

**第二级，线程进 warp。** SM 真正执行指令的单位不是线程，是 **warp——
32 个线程捆成的一小队**。同一 warp 的 32 个线程**在同一时刻执行同一条
指令**：指令只取译一次，同时作用于 32 份数据。04 里那句「一个指令广播
给全班」（SIMT），落到硬件上，广播的最小单位就是 warp。

warp 带来一条常识和一个陷阱：

- 常识：例子里 `blockDim=256` 恰好是 8 个完整的 warp——**块内线程数要取
  32 的倍数**，否则最后一个 warp 凑不齐 32 人，白白浪费席位。这就是
  面试里「blockDim 为什么常取 256 / 512」的半个答案。
- 陷阱：同一个 warp 若在某个 `if` 走上不同分支，硬件无法同时广播两条
  指令，只能先把一支跑完、再跑另一支，两边各自屏蔽掉不该执行的那部分
  线程——这叫**分支发散（branch divergence）**，发散一次，这段代码的
  有效吞吐直接砍半。好 Kernel 尽量让同 warp 的 32 路齐步走。上文的
  `if (i < n)` 只发生在尾块，伤害可以忽略。

**同一个 SM 里，两种核心。** SM 里的计算核心分两类：**CUDA Core** 是最
普通的标量乘加单元，什么都能算；**Tensor Core** 是矩阵乘专用电路，一条
指令完成一小块矩阵的乘累加（MMA）。拿 H100 说：标称 989 TFLOPs（FP16），
指的全是 Tensor Core 的峰值；CUDA Core 只有几十 TFLOPs 量级——**大模型的
算力几乎全部来自 Tensor Core**，CUDA Core 更多负责地址计算、循环推进
这类杂活。线程模型负责把活分下去，矩阵乘的活最终都落在 Tensor Core 上。

把镜头拉远：你写 `torch.matmul(a, b)` 时一行 CUDA 没写，但 PyTorch
最终调的是 cuBLAS 里高度优化的 GEMM kernel；LLM 每生成一个 token，
GPU 上会接连启动成千上万个 kernel（GEMM 只是其中最重的一类）。
**框架把「写 kernel」藏了起来，性能上限却仍由这些 kernel 决定**——
这正是 AI Infra 岗既要会用框架、又要能下钻到 kernel 的原因。想看一次
forward 里 kernel 怎么排队、cuBLAS 怎么挑变体，接
[Torch Profiler 入门实战专题](../interview-questions/torch-profiler入门实战专题.md)。

## 五、显存三层：寄存器、共享内存、全局内存

Kernel 里每个变量住在哪，直接决定这段代码快不快。设备内存分三层：

| 层 | 归属 | 速度 | 直觉 |
| --- | --- | --- | --- |
| **寄存器** | 每线程私有 | 最快 | 工人手里的草稿纸（变量 `i` 就住这） |
| **共享内存（SMEM）** | SM 内一块，**块内**可见 | 比全局快一个数量级以上 | 同桌共用的白板 |
| **全局内存** | 整卡显存（数据中心卡上即 HBM），所有线程可见 | 最慢也最大 | 大仓库，人人能去但来回跑断腿 |

CUDA 编程最经典的一招：**把一块数据从全局内存搬进共享内存，让块内线程
反复取用、多算几轮，最后把结果写回全局内存**。逐元素相加这种「每个数
只用一次」的活，SMEM 帮不上忙；到矩阵乘这种「同一批数据被反复用」的
场景就威力巨大——每次搬一片 tile 进 SMEM、就地算一整轮。FlashAttention
和手工 GEMM 的共同起点就是这个动作，深水区文章会反复见到「分块搬进片上」
四个字，说的是同一件事。

（块内线程怎么对齐步骤：`__syncthreads()` 栅栏——所有人都到齐了，才允许
读白板。它在手撕代码里高频出现，先混个脸熟。）

## 六、Kernel 的边界：什么时候值得上 GPU

Kernel 不是万能加速器。把「适不适合」压成一张对照表：

| 适合上 GPU | 不适合上 GPU |
| --- | --- |
| 同一操作作用于大量数据：GEMM、卷积、attention | 任务太小：10 个数相加，拷贝比计算还贵 |
| 各元素的计算互不依赖，能拆给不同线程 | 强串行依赖：第 2 步必须等第 1 步结果 |
| 计算量足够大，摊得平主机与设备间的拷贝 | warp 内重度分支发散，32 路各走各的 |
| 数据装得进显存，且访存模式规整（相邻线程读相邻地址） | 数据装不下，要在内存与显存之间来回搬 |

判断顺序可以很朴素：**先看并行度，再看计算强度，最后看数据装不装得
下**。三条里有一条明显不满足，GPU 的加速就可能被拷贝、串行或搬运吃
光——04 的 roofline 与搬运开销，就是用来算这笔买卖的。

面试若问「什么任务不适合上 GPU」，照这张表分四点答即可：粒度太小、
强串行、分支发散、装不下。

## 七、▶ 面试挂钩

**Q1【高 · 实录】SIMD 和 SIMT 有什么区别？**（腾讯 TEG 推理优化岗三面
原题）
「SIMD 在 CPU：一条指令作用于**向量寄存器里的一排数据**，并行度藏在寄存
器宽度里，要靠编译器自动向量化或手工 intrinsics。SIMT 在 GPU：一条指令
广播给 **32 个完整独立的标量线程**，每个线程有自己的寄存器和程序计数器，
分支靠硬件 mask 处理。所以 CUDA 写普通标量 C 代码就自带并行，程序员
不用手工向量化；代价是 warp 内 32 人必须齐步走，走岔了就分支发散。」

**Q2【高 · 实录】写出 CUDA 全局线程号公式并解释每一项；为什么要加
`if (i < n)`？**（同场组合追问）
「`i = blockIdx.x * blockDim.x + threadIdx.x`：块号乘每块线程数得到本块
起始下标，再加块内编号得到全局唯一下标；`.x` 是多维组织下的一维分量。
`if (i < n)` 是因为块数向上取整：`(n + tpb - 1) / tpb`，100 万元素、每块
256 线程 → 3907 块共 1,000,192 线程，多出的 192 个线程下标越界，必须让
它们原地返回，否则野写显存。」

**Q3【中高 · 实录】SIMT 是什么？CUDA 和昇腾的编程模型差在哪？**
（理想汽车推理引擎岗原题）
「SIMT 见 Q1。CUDA 的思路是海量线程、每线程算一个元素，中间夹一层
warp；昇腾 Ascend C 反过来——一核一 block、没有 warp 这一束，数据从
GM（对位 global memory，HBM）先进片上 UB / L0 buffer（对位 shared
memory），再由 Cube 单元整块吃矩阵。两边解的都是『别让算力等数据』，
差别在并行抽象：线程束 vs Tile 流水。」追问继续接
[国产卡推理引擎适配专题](../interview-questions/国产卡推理引擎适配专题.md)。

**Q4【中高 · 实录】CUDA Core 和 Tensor Core 的区别？**（优酷 AI Infra
一面原题）
「CUDA Core 是标量乘加单元，什么都能算；Tensor Core 只干一件事——一条
指令完成一小块矩阵乘累加，但把这件事做到极致。H100 的 989 TFLOPs FP16
峰值全部来自 Tensor Core，CUDA Core 只有几十 TFLOPs 量级；LLM 的矩阵
乘 kernel 最终都落到 Tensor Core 上。」被接着追「峰值怎么算、带宽怎么
配」，回 04 背 roofline 和三笔账。

**Q5【中】blockDim 为什么常取 256 / 512 这类 2 的幂？**
「SM 按 32 线程的 warp 执行，块内线程数取 32 的倍数才不浪费 warp 席位；
再取整到 2 的幂，兼顾多维网格的规整性，以及访存合并（coalescing：相邻
线程访问相邻地址时，硬件能把多次访存合并成少数几次大事务，对齐友好）。」

## 八、延伸阅读（仓内进阶指针）

- 口试体系篇：[CUDA 与 Kernel 专题](../interview-questions/cuda与kernel专题.md)
  ——FA 四代演进、decode kernel 族、融合方法论与真题 10 条，本篇是它的地基。
- 代码手撕篇：[CUDA 算子手撕](../coding/工程手撕/cuda算子手撕.md)
  ——RMSNorm / Softmax / Online Softmax / SwiGLU 的可默写骨架；本篇的
  公式到那里要变成肌肉记忆。
- 宏观账的另一半：[GPU 与算力入门](./04-gpu与算力入门.md)
  ——FLOPS / 带宽 / roofline / MFU，把本文的六步流程放进成本账。
- 硬件谱系：[推理专用硬件专题](../interview-questions/推理专用硬件专题.md)
  ——从 HBM 堆叠到各家加速器的设计取舍。
- 昇腾与国产卡对照：[国产卡推理引擎适配专题](../interview-questions/国产卡推理引擎适配专题.md)
  ——Q3 的追问终点，Cube/Vector/UB 的完整对位翻译。
- 从 kernel 到通信：
  [GPU 发起通信专题](../interview-questions/distributed-training/gpu发起通信专题.md)
  ——NVSHMEM / GPUNetIO / mKernel，把本文的 thread/block 知识接到跨卡
  数据搬运。

> 内容出处：本篇主体改写自 Outcome School 的
> [How do CUDA Kernels Work?](https://outcomeschool.com/blog/how-do-cuda-kernels-work)
> 及其微信公众号编译版（AI 圈的 9527，2026-10-18），按仓库体例重排，补充
> 实录真题与仓内指针；与 04 重复的宏观判断（CPU vs GPU、roofline、拷贝
> 开销）只做引用不展开。
