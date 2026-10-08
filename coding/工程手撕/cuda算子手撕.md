# CUDA 算子手撕（滴滴 AI Infra 一面系列）

> 覆盖 [高频面试真题汇总](../../interview-questions/高频面试真题汇总.md)
> 第五节推理部署中的「手撕 CUDA 算子：RMSNorm / Softmax / Online Softmax / SwiGLU
> ——中高（滴滴一面原题）"。每题给：题目来源 → 思路（访存/reduce 模式）→
> PyTorch 参考 → 可默写的 CUDA 骨架 → 常见追问。**时间不够背 CUDA 的同学备一份
> Triton 版**（Infra 岗 JD 里 Triton 出现频率极高，能默写 Triton 骨架也是解法）。

通用答题节奏：先讲数学（特别是数值稳定）、再讲访存与并行划分、最后上代码骨架。
面试官听的是"为什么这样切分 parallel pattern"，代码完整与否是其次。

## 题一：RMSNorm

▶ 真题：手写 RMSNorm CUDA kernel（一行一个 block，含 block reduce）——**高**（滴滴 AI Infra 一面原题；正常版本 → 追 fusion / warp shuffle 版本）

### 数学与参考实现

$$\text{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{n}\sum_i x_i^2 + \epsilon}} \odot w$$

跟 LayerNorm 差在**不减去均值、无 bias**，因此只需要一个 reduce（$\sum x_i^2$），
天然对算子优化更友好——这是"为什么大模型用 RMSNorm"的理论答法的另一半。

```python
import torch

def rmsnorm_torch(x: torch.Tensor, w: torch.Tensor, eps: float = 1e-6):
    # x: [L, n]，w: [n]
    ms = x.float().pow(2).mean(-1, keepdim=True)   # 用 fp32 累加，避免 bf16 精度掉
    r = torch.rsqrt(ms + eps)
    return x * r * w
```

### CUDA 骨架（一行一 block + warp shuffle block reduce）

```cuda
#include <cuda_runtime.h>

// warp 内部归约：__shfl_down_sync，利用同一 warp 内的寄存器交换，无 smem 无同步
__inline__ __device__ float warp_reduce_sum(float v) {
    for (int offset = 16; offset > 0; offset >>= 1)
        v += __shfl_down_sync(0xffffffff, v, offset);
    return v;                       // 归约结果只在 lane 0（完整的只在 lane 0）
}

__global__ void rmsnorm_kernel(const float* __restrict__ x,
                               const float* __restrict__ w,
                               float* __restrict__ y,
                               int n, float eps) {
    int row = blockIdx.x;                            // 一行一个 block
    const float* xr = x + row * n;
    float* yr = y + row * n;
    int tid = threadIdx.x, lane = tid & 31, wid = tid >> 5;

    // 1. 每个线程跨步累加一部分平方（访存合并：相邻 tid 读相邻元素）
    float local = 0.0f;
    for (int i = tid; i < n; i += blockDim.x) {
        float v = xr[i];
        local += v * v;
    }

    // 2. warp 内归约，然后跨 warp 用共享内存归约
    local = warp_reduce_sum(local);
    __shared__ float smem[32];                       // 最多 1024 线程 = 32 warp
    if (lane == 0) smem[wid] = local;
    __syncthreads();
    if (wid == 0) {
        int n_warps = (blockDim.x + 31) >> 5;
        local = (tid < n_warps) ? smem[tid] : 0.0f;
        local = warp_reduce_sum(local);
        if (lane == 0) smem[0] = local;
    }
    __syncthreads();
    float rms = rsqrtf(smem[0] / n + eps);

    // 3. 归一化并乘权重；注意 x 又读了一遍（fusion 追问的动机）
    for (int i = tid; i < n; i += blockDim.x)
        yr[i] = xr[i] * rms * w[i];
}
```

### 常见追问

- **访存模式**：相邻 thread 连续读 => coalesced。grid-stride loop 是通用默写模板。
- **为什么分 warp reduce + smem，不全部 smem？** warp 内 `__shfl_*` 是寄存器交换，
  无 shared memory 读写、无 `__syncthreads()`，是 reduce 的标准优化；跨 warp 才走 smem。
- **能不能不看两遍 x？** 能，把 xr 读进 smem（n ≤ 8K 时常可行）或进寄存器数组，
  只做一次 global read。这是 fusion / single-pass 优化的入口追问。
- **数值稳定问题**：bf16/fp16 输入必须 **FP32 累加**，这是 RMSNorm 和 Softmax 共同的
  最易丢分点；LLM 推理普遍用 RMSNorm 而非 LayerNorm，跟"少一项均值计算 + 少一项 bias
  加法"的算子开销差异也能扯上。
- **blockDim 怎么选？** 常 256/512；n 很大（>blockDim）用 grid-stride，
  n 很小则每行多个 warp 分工都做了但要保证最后 reduce 正确。

## 题二：Softmax + Online Softmax（单 pass）

▶ 真题：手写 Softmax CUDA kernel；追问：写 online softmax 的单 pass 版本，讲清 running max / running sum 更新——**高**（滴滴一面原题；FlashAttention 思想的配套题）

### 朴素版（3 pass：找 max → 求 sum → 归一化）

```python
import torch

def softmax_torch(x: torch.Tensor):
    m = x.max(-1, keepdim=True).values      # 减 max 防 e^x 溢出
    e = torch.exp(x - m)
    return e / e.sum(-1, keepdim=True)
```

```cuda
// 朴素 softmax：三趟（真实面试写出来也可以，但必须说出"可以合成单 pass online softmax"）
__global__ void softmax_kernel(const float* x, float* y, int n) {
    // ... 此处为"行内 reduce 求 max → reduce 求 sum → exp(x-max)/sum" 三段式 ...
}
```

### 单 pass Online Softmax（重点）

普通 softmax 的组合麻烦在："看完全行才能定 max，定完 max 才能求 sum"。online softmax
把所有更新揉成一条递推——在分块 / 流式 / FlashAttention 里这是唯一的正确做法，
**能默写出来 + 讲清为什么对，就是这一题的全部考点**。

递推式：逐元素看 x_i，维护 (m, l)（当前最大值、当前按 m 归一的分母和）：

```
m_new = max(m_old, x_i)
l     = l * exp(m_old - m_new) + exp(x_i - m_new)
```

全部看完再用 `y_i = exp(x_i - m) / l`（只是表达，真实 kernel 里推迟到 reduce 完）。

```cuda
// 合并两个 (m, l) 分片 —— FlashAttention 里 merge 两个 tile 用的就是这套语义
struct MS { float m, l; };                    // m: running max, l: running sum

__device__ MS merge(MS a, MS b) {
    float m = fmaxf(a.m, b.m);
    float l = a.l * __expf(a.m - m) + b.l * __expf(b.m - m);   // 各自 rescale 到新 m 再相加
    return {m, l};
}

__global__ void online_softmax_kernel(const float* __restrict__ x,
                                      float* __restrict__ y, int n) {
    int row = blockIdx.x;
    const float* xr = x + row * n;
    float* yr = y + row * n;
    int tid = threadIdx.x, lane = tid & 31, wid = tid >> 5;

    // 1. 每个线程跨步扫一段，单线程内就是经典的 online softmax 递推
    MS self = {-INFINITY, 0.0f};
    for (int i = tid; i < n; i += blockDim.x) {
        float v = xr[i];
        float m = fmaxf(self.m, v);
        // 老的 sum 按 m 变化 rescale，并入当前元素
        self.l = self.l * __expf(self.m - m) + __expf(v - m);
        self.m = m;
    }

    // 2. warp 内 + 跨 warp 归约 (m, l) 对，merge 逻辑同上
    for (int offset = 16; offset > 0; offset >>= 1) {
        MS other;
        other.m = __shfl_down_sync(0xffffffff, self.m, offset);
        other.l = __shfl_down_sync(0xffffffff, self.l, offset);
        self = merge(self, other);
    }
    __shared__ MS smem[32];
    if (lane == 0) smem[wid] = self;
    __syncthreads();
    if (wid == 0) {
        int n_warps = (blockDim.x + 31) >> 5;
        self = (tid < n_warps) ? smem[tid] : MS{-INFINITY, 0.0f};
        for (int offset = 16; offset > 0; offset >>= 1) {
            MS other;
            other.m = __shfl_down_sync(0xffffffff, self.m, offset);
            other.l = __shfl_down_sync(0xffffffff, self.l, offset);
            self = merge(self, other);
        }
        if (lane == 0) smem[0] = self;
    }
    __syncthreads();
    MS tot = smem[0];

    // 3. 归一化输出（再读一遍 x；同 RMSNorm，复制进 smem 可避免）
    for (int i = tid; i < n; i += blockDim.x)
        yr[i] = __expf(xr[i] - tot.m) / tot.l;
}
```

### 常见追问

- **为什么 online softmax 是对的（数学）？** 关键恒等式：若当前和
  $l = \sum e^{x_i - m_{old}}$，新最大值变成 $m_{new}$，则把每一项乘
  $e^{m_{old} - m_{new}}$ 即可"换底"——
  $\sum e^{x_i - m_{new}} = e^{m_{old}-m_{new}} \cdot l$。递推把"等看到最大值
  再算"换成"边算边 rescale"，结果数学等价，这就是 FlashAttention 能 tile 化的底气。
- **为什么 -max 必须做？** 数值稳定：$e^{x}$ 在 x≈88 就 fp32 上溢出；减 max 后上界
  固定为 1。
- **warp shuffle 的坑**：`__shfl_down_sync` 只在参与 lane 间交换，返回值在其它 lane
  是未定义；merge 时要先把对方 m/l 都抓到手再动 self，顺序错了会用旧值。
- **fp32 累加**：同 RMSNorm，bf16 输入也要全 fp32 中间量，否则会丢 5-6 位精度。
- **性能**：朴素 3-pass vs online 虽访存次数一样（第一次读，最后归一化还得再读或
  用寄存器），但 online 的真正意义是让 **tile 之间可合并**，FlashAttention 才有戏；
  "算一次"和"能合并 tile"是两套目标，评比时别搞混。

## 题三：SwiGLU kernel

▶ 真题：手写 SwiGLU 的 CUDA kernel（输入 gate/up，输出 silu(gate)*up，逐元素）——**中高**（滴滴一面原题，FFN 结构配合问）

### 数学与参考

SwiGLU 是 LLaMA 系 FFN 核心：

$$\text{SwiGLU}(x) = (\text{SiLU}(xW_g) \odot xW_u)\, W_d, \qquad \text{SiLU}(x) = \frac{x}{1+e^{-x}}$$

手撕重点是 elementwise 融合 kernel：把"两次 matmul 出来的中间张量 h = xW_g,
u = xW_u"直接过一道 `silu(h)*u`，避免中间张量落 HBM。

```python
import torch

def swiglu_torch(h: torch.Tensor, u: torch.Tensor):
    # h = x @ W_g，u = x @ W_u；返回 silu(h) * u
    return torch.nn.functional.silu(h) * u
```

```cuda
// 每个线程处理一个元素；fused 的意义是 silu(h)*u 一次性算完，
// 不把 silu(h) 单独写回显存再读出来乘 u
__global__ void swiglu_kernel(const float* __restrict__ h,
                              const float* __restrict__ u,
                              float* __restrict__ y, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        float hv = h[i];
        // silu(h) = h / (1 + exp(-h))；1/exp 用 __expf 更快，精度可接受
        y[i] = hv / (1.0f + __expf(-hv)) * u[i];
    }
}

// 向量化版（讲一句即可，不必默写）：用 float4 / aligned vector load，
// 一次取 4 个，访存占用变 1/4，是这类 elementwise kernel 的第一优化
```

### 常见追问

- **SwiGLU 为什么是三个矩阵？** 对比 GELU FFN（两个 $d\times \frac{8}{3}d$ 上下），
  SwiGLU 是 $W_g, W_u, W_d$ 三个矩阵、总参数约 $8d^2$（LLaMA 中间维约 $\frac{8}{3}d$），
  门控单元比 GELU 更稳，代价是多一次 GEMM。
- **fusion 省什么？** 省 silu(h) 单独落显存的写 + 读两次（bf16 向量长度 n，
  省 4n bytes 的 HBM 流量），elementwise 融合收益直接、代码便宜。
- **matmul 部分要不要自己写？** 一般不考（GEMM 交给 cuBLAS/CUTLASS），
  但说话要懂：SwiGLU 的 h/u 可以并成一次 $[xW_g, xW_u] = x\cdot [W_g | W_u]$，
  把两次 GEMM 合并再切，也是真实 FFN 优化的常见做法。

## Triton 备选版（来不及背 CUDA 的救命稻草）

▶ 真题（追加问法）：能用 Triton 写 RMSNorm / Softmax 吗？——**中**（AI Infra 岗，Triton 在 JD 里出现频率非常高）

Triton 的卖点：以 Python 语法写 kernel，编译器自动生成 warp/block 划分和向量化。
面试默写骨架足够，讲出"row-program + 每 program 内 vectorize + BLOCK 常数"即可。

```python
import torch
import triton
import triton.language as tl

# ---------- RMSNorm ----------
@triton.jit
def rmsnorm_kernel(x_ptr, w_ptr, y_ptr, N, eps, BLOCK: tl.constexpr):
    row = tl.program_id(0)                      # 一个 program 负责一行
    cols = tl.arange(0, BLOCK)                  # BLOCK >= N，编译期常数
    mask = cols < N
    x = tl.load(x_ptr + row * N + cols, mask=mask, other=0.0)
    ms = tl.sum(x * x, axis=0) / N
    r = tl.rsqrt(ms + eps)
    w = tl.load(w_ptr + cols, mask=mask, other=0.0)
    tl.store(y_ptr + row * N + cols, x * r * w, mask=mask)

# ---------- Softmax（整行放进一个 program 的简化版）----------
@triton.jit
def softmax_kernel(x_ptr, y_ptr, N, BLOCK: tl.constexpr):
    row = tl.program_id(0)
    cols = tl.arange(0, BLOCK)
    mask = cols < N
    x = tl.load(x_ptr + row * N + cols, mask=mask, other=-float('inf'))
    m = tl.max(x, axis=0)
    e = tl.exp(x - m)
    tl.store(y_ptr + row * N + cols, e / tl.sum(e, axis=0), mask=mask)

# ---------- SwiGLU ----------
@triton.jit
def swiglu_kernel(h_ptr, u_ptr, y_ptr, N, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < N
    h = tl.load(h_ptr + offs, mask=mask)
    u = tl.load(u_ptr + offs, mask=mask)
    tl.store(y_ptr + offs, tl.sigmoid(h) * h * u, mask=mask)  # silu(h) = h*sigmoid(h)
```

要说清的两句：**Triton 的 reduce 是 compiler 自动切 warp 的**（不用手写 shuffle
细节，但概念和手撕 CUDA 版同源）；**BLOCK 必须是 2 的幂的编译期常数**，mask 处理
边界。能被追问到"为什么不直接用 PyTorch"——答 "Triton 写出来的就是一个自定义 fused
kernel，去掉了 eager 模式下每个算子一次 kernel launch + 中间张量落 HBM 的开销"。

---

*配套阅读：模型侧口径看 [transformer 与 attention](../../interview-questions/llm基础/transformer与attention.md)
第四节 KV Cache 与第五节 FlashAttention（online softmax 出处）；资源指路
[学习资源清单 · nano-vllm / flash-attention / llm.c](../../resources/学习资源清单.md)。*
