# 手写 Attention（live coding 真题 · 默写版）

> Attention 手撕是 AI 方向 live coding 的"开卷题"——字节算法岗、字节 AML、
> 公众号面经手撕榜的常驻题目。白板条件下要求的是**骨架对、shape 对、
> 数值稳定细节对**，而不是工业级工程。本文每道题给三段：默写版代码、
> 易错点清单、面试官常见追问。题源见
> [高频面试真题汇总 - 手写代码题](../../interview-questions/高频面试真题汇总.md)。

## 背诵总纲

所有题共用一句话骨架：

```text
scores = Q @ K^T / √d  →  mask  →  softmax(减 max)  →  @ V  →  W_O
```

骨架必须记住的行：`transpose/view` 切头、`/ math.sqrt(d_head)`、
mask 填 `-inf`、softmax 前先 `x - x.max()`、四个 shape 注释。
可以现场推的部分：GQA 的 repeat、RoPE 的具体旋转公式（记住"两两配对、
cos/sin 旋转"就能推出来）。

## 一、Multi-Head Attention（PyTorch 完整版）

▶ 真题：手撕 Multi-Head Attention（PyTorch，可扩展 cross-attention）——**高频**（字节算法岗）

```python
import torch
import torch.nn as nn
import math

class MultiHeadAttention(nn.Module):
    def __init__(self, d_model: int, num_heads: int):
        super().__init__()
        assert d_model % num_heads == 0
        self.h = num_heads
        self.d_head = d_model // num_heads
        # 四个投影：QKV 可以合并成一个大矩阵，拆开写更清楚
        self.W_q = nn.Linear(d_model, d_model, bias=False)
        self.W_k = nn.Linear(d_model, d_model, bias=False)
        self.W_v = nn.Linear(d_model, d_model, bias=False)
        self.W_o = nn.Linear(d_model, d_model, bias=False)

    def forward(self, q, k, v, mask=None):
        # 自注意力: q = k = v = x, shape [B, L, D]
        B, L, D = q.shape
        # [B, L, D] -> [B, L, h, d] -> [B, h, L, d]，把 head 维提到 batch 位
        Q = self.W_q(q).view(B, -1, self.h, self.d_head).transpose(1, 2)
        K = self.W_k(k).view(B, -1, self.h, self.d_head).transpose(1, 2)
        V = self.W_v(v).view(B, -1, self.h, self.d_head).transpose(1, 2)

        # scores: [B, h, L_q, L_k]，除以 √d_head 把方差归一
        scores = Q @ K.transpose(-2, -1) / math.sqrt(self.d_head)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float("-inf"))
        attn = torch.softmax(scores, dim=-1)      # [B, h, L_q, L_k]
        out = attn @ V                            # [B, h, L_q, d]

        # 多头拼回去: [B, h, L, d] -> [B, L, D]，最后过输出投影
        out = out.transpose(1, 2).reshape(B, L, D)
        return self.W_o(out)

def causal_mask(L: int) -> torch.Tensor:
    # 下三角为 1（可见），上三角为 0（屏蔽未来）
    return torch.tril(torch.ones(L, L)).unsqueeze(0).unsqueeze(0)  # [1, 1, L, L]
```

**改成 cross-attention（一行追问）**：只需允许 `q` 来自 decoder、`k/v` 来自
encoder 输出，长度可以不同——上面的 forward 已经天然支持，只需注意
`scores` 的 shape 变成 `[B, h, L_q, L_kv]`，mask 也按 `[L_q, L_kv]` 生成。
面试时先说"改动点只有 q/k/v 的来源和 mask 的形状"，再给代码。

**易错点清单：**

- reshape 顺序必须是 `view(B, L, h, d).transpose(1, 2)`，写成
  `view(B, h, L, d)` 是错的——L 和 h 的分界搞反了。
- 缩放除的是 `√d_head` 不是 `√d_model`。
- mask 用 `masked_fill(mask == 0, -inf)`，不要直接乘 0（softmax 后会有非零值）。
- 拼回去时 `transpose(1,2)` 后 tensor 不连续，reshape 前先 `.contiguous()`
  或用 `.reshape()`（reshape 自动处理，更安全）。
- causal mask 的广播维度要加到 `[1,1,L,L]`，才能和 `[B,h,L,L]` 广播。

**面试官常见追问：**

- **「为什么除以 √d？」** Q、K 分量独立均值为 0 方差为 1 时点积方差是 d，
  除 √d 归一方差，防 softmax 饱和区梯度消失。详见
  [transformer 与 attention](../../interview-questions/llm基础/transformer与attention.md)。
- **「W_q/W_k/W_v 为什么不初始化 scale？」** 缩发放前向里而不是权重初始化
  里，是因为 scale 依赖 d_head 且作用在 score 上；若塞进初始化，后面改
  head 数就失配，且初始化的目标是控制激活方差（Xavier/Kaiming），与
  score 尺度是两件事。
- **「causal mask 训练时也要加吗？」** 要。Teacher forcing 并行训练整条序列，
  靠 mask 防信息泄漏，训练和推理逻辑统一。
- **「dropout 加在哪？」** 标准答案两个位置：attn 权重上（`attn = dropout(attn)`）
  和 W_o 输出上。白板能答出前者加分。

## 二、numpy 手撕 attention 前向（含手写 softmax）

▶ 真题：numpy 版 attention 前向，softmax 自己写——**高频**（字节 AML 一面原题）

考点不是 attention 本身，而是**没有框架兜底时你记得哪些数值细节**：
softmax 减 max 防溢出、V 的 shape 别转错。

```python
import numpy as np

def softmax(x: np.ndarray) -> np.ndarray:
    # 数值稳定版：先减每行最大值，数学上等价，防 exp 上溢出
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)

def attention(Q, K, V):
    # Q: [n, d_q]  K: [n, d_k]  V: [n, d_v]，演示用 d_q = d_k
    d = Q.shape[-1]
    scores = Q @ K.T / np.sqrt(d)      # [n, n]
    attn = softmax(scores)             # [n, n]，每行和为 1
    return attn @ V                    # [n, d_v]
```

**易错点清单：**

- 减 max 一行**绝对要写出来**，这是本题真正的考点；不写直接挂。
  问"softmax 为什么要减 max"时答：softmax(x) = softmax(x − c) 数学不变，
  选 c = max 让 exp 的输入 ≤ 0，杜绝 `exp(1000) = inf` 变成 NaN。
- `axis=-1, keepdims=True` 两个参数缺一不可——不 keep dims，广播减法
  会变成逐元素相减（shape 错或静默算错）。
- V 是 `[n, d_v]`，`attn @ V` 后输出 `[n, d_v]`；原题常见坑是给你的
  V 和 Q/K 最后一维不同，不要假设 d_v == d，缩放因子只看 K 的维度。
- numpy 里矩阵乘用 `@` 或 `np.matmul`，别写 `np.dot` 转置组合把自己绕晕。
- `np.sqrt(d)` 里 d 是标量（`Q.shape[-1]`），别写成 `np.sqrt(Q.shape)`。

**面试官常见追问：**

- **「时间/空间复杂度？」** QK^T O(n²d)，显存 O(n²) ——顺着引出 FlashAttention。
- **「如果序列很长怎么写更稳？」** 分块 + online softmax（维护 running max
  和 running sum），能口述 FlashAttention 思路即可。
- **「自回归场景这个函数哪一步浪费？」** 历史 K/V 每步重算——引出下题 KV Cache。

## 三、KV Cache 增量推理（伪代码）

▶ 真题：attention 改成增量推理怎么改——**高频**（字节/拼多多开场题的落地版）

不写完整类，只写改动点，面试时讲"变在哪、shape 变成什么"：

```python
def forward_incremental(self, x_new, kv_cache, pos):
    # x_new: [B, 1, D]，只来当前这一个新 token
    Q = self.W_q(x_new)                          # [B, 1, D]
    K_new = self.W_k(x_new)                      # [B, 1, D]
    V_new = self.W_v(x_new)                      # [B, 1, D]

    # 改动 1: K/V 拼到历史 cache 上，而不是重新算整段
    K = torch.cat([kv_cache["K"], K_new], dim=1) # [B, t, D]
    V = torch.cat([kv_cache["V"], V_new], dim=1) # [B, t, D]
    kv_cache["K"], kv_cache["V"] = K, V

    # 改动 2: scores 只需算 1 行——新 token 的 Q 对全部历史 K
    scores = Q @ K.transpose(-2, -1) / math.sqrt(self.d_head)  # [B, h, 1, t]

    # 改动 3: 不需要 causal mask——新 token 本来就能看全部历史
    # 改动 4: RoPE 只对 Q_new/K_new 施加，且用 _absolute_ 位置 pos
    attn = torch.softmax(scores, dim=-1)
    return (attn @ V)                            # [B, 1, D]
```

**易错点清单：**

- prefill 和 decode 两条路径分开：prefill 时一次算整段填充 cache（可以
  用 mask 并行），decode 每步只过 1 个 token。别在 decode 路径里还加 mask。
- cat 的维度是序列维 dim=1（如果提前切了头就是 dim=-2，说清楚你的手
  放哪维）。
- cache 是按层存的：每层都有自己那份 K/V，别共享。

**面试官常见追问：**

- **「KV Cache 显存怎么算？」** 每 token $2 \times L \times n_{kv} \times d_{head}
  \times \text{bytes}$，总乘序列长 × batch。计算演练见
  [手写 transformer 组件](./手写transformer组件.md) 第四节。
- **「decode 为什么 memory-bound？」** 每步算术强度极低，瓶颈是把 cache 从
  HBM 搬到计算单元——所以 GQA/MLA 砍 KV 头数直接提速解码。
- **「cache 能不能不 cat?」** 可以预分配 `[B, max_len, ...]` 的大 buffer 按
  下标写入（vLLM 的 PagedAttention 就是把 buffer 分页），口述即可。

## 四、RoPE 手撕（旋转位置编码）

▶ 真题：手写 RoPE 旋转矩阵部分——**中高频**（公众号面经手撕高频）

记住思想就能现场推：把 d 维向量两两配对成 d/2 个二维子向量，第 i 对按
角度 $\theta_i \cdot pos$ 旋转，频率 $\theta_i = 10000^{-2i/d}$ 从大到小。

```python
import torch

def build_rope_cache(seq_len: int, d: int, base: float = 10000.0):
    # 每个配对维度的频率，shape [d/2]
    inv_freq = 1.0 / (base ** (torch.arange(0, d, 2).float() / d))
    pos = torch.arange(seq_len).float()          # [L]
    # 外积: 每 (位置, 频率) 的旋转角，[L, d/2]
    theta = torch.outer(pos, inv_freq)
    return theta.cos(), theta.sin()              # [L, d/2] 各一个

def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor):
    # x: [B, h, L, d]，要求 d 为偶数
    x1, x2 = x[..., 0::2], x[..., 1::2]          # 分两两配对
    cos, sin = cos[None, None], sin[None, None]  # 广播到 [B, h, L, d/2]
    rotated = torch.stack([-x2, x1], dim=-1).flatten(-2)  # (-x2, x1) 交错
    return x * cos.repeat_interleave(2, dim=-1) + rotated * sin.repeat_interleave(2, dim=-1)
```

更朴素的二倍维写法（背这个也行，行数更少）：

```python
def apply_rope_simple(x, cos, sin):
    # 把 cos/sin 沿最后一维拼成 d: [L, d]
    cos2 = torch.cat([cos, cos], dim=-1)
    sin2 = torch.cat([sin, sin], dim=-1)
    x_rot = torch.cat([-x[..., x.shape[-1]//2:], x[..., :x.shape[-1]//2]], dim=-1)
    return x * cos2 + x_rot * sin2
```

**易错点清单：**

- RoPE 只加在 **Q 和 K** 上，**V 不加**（V 携带内容信息，与位置无关）。
- 旋转是"两两配对"的，不是整个向量的一个旋转矩阵；频率是**逐对递减**的。
- 加到 Q/K 上的时机：先过 W_q/W_k 线性投影、切多头**之后**再旋转。
- KV Cache 场景下新 token 必须用绝对位置 pos 取 cos/sin，不能重新从 0 算。

**面试官常见追问：**

- **「RoPE 为什么好？」** 相对位置特性：Q_m 与 K_n 的内积只依赖 m−n（旋转
  矩阵的性质 $R_m^\top R_n = R_{n-m}$）；长度外推比 learned 绝对编码好；
  无参数。
- **「为什么要频率递减？」** 低频通道管长程位置关系、高频通道管近邻细节，
  类似傅里叶分解的多尺度。
- **「长上下文扩窗怎么办？」** 缩放 base（NTK-aware scaling / YaRN）或对
  位置索引做线性内插（position interpolation），都是改 `inv_freq` 或 `pos`，
  该方法一行就能指出来。

## 五、LayerNorm / RMSNorm 手撕

▶ 真题：手撕 LayerNorm / transformer 层——**中频**（通用）；手撕 RMSNorm
算子——**中高频**（滴滴 AI Infra 一面原题的 numpy/Python 版）

```python
import torch
import torch.nn as nn

class LayerNorm(nn.Module):
    def __init__(self, d: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.gamma = nn.Parameter(torch.ones(d))   # 缩放
        self.beta = nn.Parameter(torch.zeros(d))   # 平移

    def forward(self, x):                      # x: [B, L, d]
        mean = x.mean(dim=-1, keepdim=True)
        var = x.var(dim=-1, keepdim=True, unbiased=False)  # 用有偏方差
        return (x - mean) / torch.sqrt(var + self.eps) * self.gamma + self.beta

class RMSNorm(nn.Module):
    def __init__(self, d: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.gamma = nn.Parameter(torch.ones(d))   # 没有 beta、不减均值

    def forward(self, x):                      # x: [B, L, d]
        rms = torch.sqrt(x.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return x / rms * self.gamma
```

**易错点清单：**

- 归一化维度是最后一维 `dim=-1`（特征维），不是序列维。
- LN 的方差用**有偏**估计（`unbiased=False`，即除以 N 而非 N−1）。
- RMSNorm **没有减均值、没有 beta**——它假设均值不重要，只做尺度归一。
- eps 加在根号**里面**，位置写错面试官会挑。

**面试官常见追问：**

- **「为什么大模型改用 RMSNorm？」** LN 减均值和求均值两次归约计算量大且
  被证明对性能贡献小；RMSNorm 省掉 mean 统计，约快 10%~40%，效果持平。
- **「为什么 RMSNorm 输出均值会漂移、要紧吗？」** 漂移由 gamma 学习补偿，
  实践里不影响收敛——答出"gamma 吸收了平移自由度"即可。
- **「Pre-Norm 还是 Post-Norm？」** 大模型标配 Pre-Norm：残差通路保持恒等，
  深层不炸梯度。展开见
  [transformer 与 attention](../../interview-questions/llm基础/transformer与attention.md)
  高频追问清单。

## 六、GQA 的分组广播写法

▶ 真题：MHA 改成 GQA 怎么写——**高频的变体**（字节/快手，MHA/GQA 演进是
那段"高频"题的配套手撕）

核心一行思想：**K/V 只有 g 个头，Q 有 h 个头，每个 K/V 头被 h//g 个 Q 头
共享**——用 `repeat_interleave` 把 K/V 的头数复制到与 Q 对齐。

```python
class GroupedQueryAttention(MultiHeadAttention):
    def __init__(self, d_model: int, num_heads: int, num_kv_heads: int):
        super().__init__(d_model, num_heads)
        self.g = num_kv_heads
        # K/V 只投影到 g 个头，参数省 (h-g)/h
        self.W_k = nn.Linear(d_model, self.g * self.d_head, bias=False)
        self.W_v = nn.Linear(d_model, self.g * self.d_head, bias=False)

    def forward(self, x, mask=None):
        B, L, _ = x.shape
        Q = self.W_q(x).view(B, L, self.h, self.d_head).transpose(1, 2)  # [B,h,L,d]
        K = self.W_k(x).view(B, L, self.g, self.d_head).transpose(1, 2)  # [B,g,L,d]
        V = self.W_v(x).view(B, L, self.g, self.d_head).transpose(1, 2)  # [B,g,L,d]

        # 关键: 每个 KV 头连续复制 h//g 次，对齐到 [B, h, L, d]
        # repeat_interleave(dim=1) 不能换成 repeat——后者是整段循环，分组会错
        K = K.repeat_interleave(self.h // self.g, dim=1)
        V = V.repeat_interleave(self.h // self.g, dim=1)

        scores = Q @ K.transpose(-2, -1) / math.sqrt(self.d_head)
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float("-inf"))
        out = torch.softmax(scores, dim=-1) @ V
        out = out.transpose(1, 2).reshape(B, L, -1)
        return self.W_o(out)
```

**易错点清单：**

- `repeat_interleave(n, dim=1)` vs `repeat(1, n, 1, 1)`：**顺序不同**。
  前者是 `[k0,k0,k1,k1]`（0、1 号 Q 头共享第 0 个 KV 头，符合 GQA 定义），
  后者是 `[k0,k1,k0,k1]`（交错共享）。写错了 shape 不报错、默默算错——
  这是本题第一坑。
- W_k/W_v 的输出维度是 `g * d_head` 不是 `h * d_head`，忘了改参数量就
  没省下来。
- MQA 就是 g=1 的特例，同一套代码。

**面试官常见追问：**

- **「省的是什么？参数还是显存？」** 都省，但主要动机是 **KV Cache 显存**
  ——解码时 K/V 头数直接决定 cache 大小，GQA-8 比 MHA 省 h/8 倍。
- **「训练好的 MHA 模型能转 GQA 吗？」** 能，把组内 K/V 头做平均（mean
  pooling）初始化再少量继续训练（GQA 论文的做法，uptraining）。
- **「为什么 query 不共享？」** 共享 Q 会砍表达能力且省不了缓存——cache
  只存 K/V。

## 练习路径

- 先按本文代码默写两遍：**第一遍对着写，第二遍合上书从骨架推细节**，
  重点记"易错点清单"里你踩过的坑。
- 想跑通最小 GPT 练手，优先 [学习资源清单](../../resources/学习资源清单.md)
  里的 **LLMs-from-scratch**（attention/KV Cache/GQA 章节）和
  **Tiny Universe**（中文、逐 tensor 手搓，live coding 几乎照它出题）。
- 推理侧（KV Cache 的 buffer/paged 实现）看清单里的 **nano-vllm**，
  1200 行读得完。
- 写完对着 [transformer 与 attention](../../interview-questions/llm基础/transformer与attention.md)
  的自查公式核 shape——能说出每一步的 shape 才算背下来了。

---

*同目录：[手写 transformer 组件](./手写transformer组件.md) ·
[对齐与并行代码](./对齐与并行代码.md) · [coding/ 目录](../)*
