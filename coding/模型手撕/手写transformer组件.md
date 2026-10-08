# 手写 Transformer 组件（live coding 真题 · 默写版）

> 上一篇 [手写attention](./手写attention.md) 拆了注意力本身，这一篇把
> 注意力之外的组件凑齐：Pre-Norm Block、SwiGLU FFN、MoE、BPE、参数量/
> 显存手算。美团/滴滴的爱考区。同样按「默写版代码 → 易错点 → 追问」组织。
> 题源见 [高频面试真题汇总-手写代码题](../../interview-questions/高频面试真题汇总.md)。

## 一、Pre-Norm Transformer Block（SwiGLU 版 FFN）

▶ 真题：手撕 transformer 层——**中频**（通用）；FFN 结构 + SwiGLU——**中频**
（美团；滴滴要求手撕 SwiGLU 算子）

现代 LLM（LLaMA/Qwen）的一个 block 骨架就 8 行 forward：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class SwiGLUFFN(nn.Module):
    """SwiGLU: down( silu(x @ W_gate.T) * (x @ W_up.T) )
    LLaMA 中间维取 ~8d/3 凑 256 的倍数，三个矩阵参数 ≈ 8d²"""
    def __init__(self, d: int, d_ff: int):
        super().__init__()
        self.gate = nn.Linear(d, d_ff, bias=False)
        self.up = nn.Linear(d, d_ff, bias=False)
        self.down = nn.Linear(d_ff, d, bias=False)

    def forward(self, x):
        return self.down(F.silu(self.gate(x)) * self.up(x))   # 门控相乘

class TransformerBlock(nn.Module):
    """Pre-Norm 结构: 残差旁的子层先 Norm，残差通路保持恒等"""
    def __init__(self, d: int, num_heads: int, d_ff: int):
        super().__init__()
        self.attn_norm = RMSNorm(d)          # 前文手撕的 RMSNorm，用 nn.LayerNorm 也行
        self.attn = MultiHeadAttention(d, num_heads)
        self.ffn_norm = RMSNorm(d)
        self.ffn = SwiGLUFFN(d, d_ff)

    def forward(self, x, mask=None):
        x = x + self.attn(self.attn_norm(x), self.attn_norm(x), self.attn_norm(x), mask)
        x = x + self.ffn(self.ffn_norm(x))
        return x
```

（`MultiHeadAttention` 与 `RMSNorm` 从 [手写attention](./手写attention.md)
第一、第五节原样搬过来即可。）

骨架必须记住的结构：

```text
x = x + Attn(Norm(x))      # 残差在外、Norm 在内
x = x + FFN(Norm(x))
```

比普通二激活 FFN 多记的一处：SwiGLU 是**三个**矩阵
（gate / up / down），silu 门控与 up 分支**逐元素相乘**后过 down。

**易错点清单：**

- Pre-Norm 别把 Norm 写在残差外——`Norm(x + Attn(x))` 是 Post-Norm，
  两者训练稳定性天差地别。
- `silu(gate(x)) * up(x)` 是逐元素乘，不是矩阵乘。
- 现代 LLM 的 FFN 和 Linear 大多 **不带 bias**，白板写 `bias=False` 是
  加分细节。
- d_ff 取 8d/3 上下、凑硬件友好的倍数（LLaMA-7B 是 11008），面试官问
  "为什么不是 4d"时答：SwiGLU 三矩阵，用 8/3 倍保持总参数与 GELU 两
  矩阵 FFN 的 4d 版本相当。
- 残差相加的是**子层输出**，别写成 `x = self.attn(self.attn_norm(x)) + 0`。

**面试官常见追问：**

- **「SwiGLU 比 GELU FFN 好在哪？」** 门控结构提供乘法非线性，同参数规模下
  效果更稳更优；代价是三个矩阵、且 SiLU 逐元素不可拆分融合（滴滴考 CUDA
  手撕就考这个逐元素模式的 kernel）。
- **「Pre-Norm 为什么好训？」** 残差通路是恒等映射，梯度可以无损传回第一层；
  代价是输出表示依赖子层累加幅度，深层需要 final norm 收尾。
- **「FFN 在模型里起什么作用？」** 逐位置的"知识记忆库"，参数量占每层 2/3，
  是 MoE 稀疏化的开刀对象。

## 二、简易 MoE（router top-k + 负载均衡 loss）

▶ 真题：手写简易 MoE——**中频**（美团手撕原题）

考点三件套：**router 打分 → top-k 选专家 → Switch 式负载均衡 loss**。

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class SparseMoE(nn.Module):
    """每个 token 独立路由，选 top-k 个专家加权合并"""
    def __init__(self, d: int, d_ff: int, n_experts: int = 8, top_k: int = 2):
        super().__init__()
        self.k = top_k
        self.router = nn.Linear(d, n_experts, bias=False)          # 打分器
        self.experts = nn.ModuleList(
            [SwiGLUFFN(d, d_ff) for _ in range(n_experts)])        # 每个专家一个 FFN

    def forward(self, x):
        # x: [B, L, d]，摊平成 token 维: [N, d]
        B, L, d = x.shape
        tokens = x.reshape(-1, d)
        logits = self.router(tokens)                       # [N, n_experts]
        probs = F.softmax(logits, dim=-1)

        # top-k: 每个 token 选 k 个专家及其权重
        top_w, top_idx = probs.topk(self.k, dim=-1)        # [N, k]
        top_w = top_w / top_w.sum(dim=-1, keepdim=True)    # 权重归一

        out = torch.zeros_like(tokens)
        for i, expert in enumerate(self.experts):
            # 找出路由到第 i 号专家的 (token, k槽位)
            token_idx, slot = torch.where(top_idx == i)
            if len(token_idx) == 0:
                continue
            out[token_idx] += top_w[token_idx, slot].unsqueeze(-1) * expert(tokens[token_idx])

        # Switch 式负载均衡 loss: n_e * <f_i · p_i>
        # f_i = 被选到专家 i 的 token 占比（离散的）
        # p_i = 路由概率在全体 token 上的均值（可导的）
        n_e = len(self.experts)
        f = torch.zeros(n_e, device=x.device)
        f.scatter_add_(0, top_idx.flatten(), torch.ones_like(top_idx.flatten(), dtype=torch.float))
        f = f / top_idx.numel()
        p = probs.mean(dim=0)
        aux_loss = n_e * (f * p).sum()

        return out.reshape(B, L, d), aux_loss
```

总 loss = 任务 loss + $\alpha \cdot$ `aux_loss`（$\alpha$ 常见 0.01）。

**易错点清单：**

- top-k 权重要**重新归一**（softmax 是按全体算的，截断后不归一会让
  输出幅度漂移）。
- 负载均衡 loss 里 f 是**不可导**的路由统计、 p 是**可导**的平均概率，
  乘起来梯度只走 p——把两者都写成可导就失去设计意义。
- 按专家遍历（expert-loop）而不是按 token 遍历，否则白板写不完、工程
  上也慢。
- `scatter_add_` 统计被选中次数时，dtype 要和后面除法对齐。
- aux_loss 忘了乘 n_e——没有这个系数，loss 量级随专家数缩放，调参失效。

**面试官常见追问：**

- **「为什么要有负载均衡 loss？」** 没有它，router 会收敛到"所有 token 都
  去最强的少数专家"（专家坍缩），其他专家拿不到梯度、容量浪费；aux loss
  惩罚不均匀分布，逼 router 雨露均沾。
- **「top-k 为什么取 2 不是 1？」** k=1 时梯度路由完全离散、训练不稳
  （Switch Transformer 就是 k=1，需要更多 trick）；k=2 是效果与算力的
  折中，DeepSeek/Qwen 的 MoE 常见 k=8/64 里的 8。
- **「推理时 MoE 为什么省算力不省显存？」** 每次前向只激活 k 个专家（FLOPs
  按稀疏算），但全部专家参数都得在显存里放着——显存按总参数算。
- **「MoE 和 MMoE 一回事吗？」** 不是。MMoE 是多任务的共享专家+任务塔结构，
  和 Transformer 里的稀疏 MoE FFN 只是名字像。
- **「aux loss 和 expert capacity 的关系？」** 工程版还有容量因子（每个专家
  最多收多少 token，超出直接走残差丢掉或 overflow 重路由），白板能提
  一句即可。

## 三、BPE tokenizer 合并过程手写

▶ 真题：手撕 BPE 训练/合并过程——**低中频**（偶发，应用岗）

考点是**合并算法本身**：统词频 → 找最高频相邻对 → 合并 → 重复，直到
词表够大。

```python
from collections import Counter

def train_bpe(corpus, vocab_size: int):
    # 语料预分词成字符序列（简化版，忽略 pre-tokenize 细节）
    # word -> tuple(chars)，每个词末尾的 </w> 当作词边界符号
    words = Counter(tuple(w) + ("</w>",) for w in corpus)

    merges = []                                        # 记录合并规则，顺序就是优先级
    while True:
        # 1. 统计所有相邻字符对的频次
        pairs = Counter()
        for word, freq in words.items():
            for a, b in zip(word, word[1:]):
                pairs[(a, b)] += freq
        if not pairs:
            break

        # 2. 取最高频的一对
        best = pairs.most_common(1)[0][0]
        merges.append(best)

        # 3. 全语料里把这一对替换成合并符号
        new_words = Counter()
        merged = "".join(best)                         # 新 token 串
        for word, freq in words.items():
            new_word, i = [], 0
            while i < len(word):
                if i + 1 < len(word) and (word[i], word[i + 1]) == best:
                    new_word.append(merged); i += 2    # 吃掉一对
                else:
                    new_word.append(word[i]); i += 1
            new_words[tuple(new_word)] += freq
        words = new_words

        # 4. 词表大小 = 单 token 数，够了就停
        vocab = {t for word in words for t in word}
        if len(vocab) >= vocab_size:
            break
    return merges, words

# 编码新词：按 merges 顺序（= 优先级）依次套合并规则
def bpe_encode(word: str, merges) -> list:
    tokens = list(word) + ["</w>"]
    for a, b in merges:                                # 先学的规则先用
        i = 0
        while i + 1 < len(tokens):
            if tokens[i] == a and tokens[i + 1] == b:
                tokens[i:i + 2] = [a + b]              # 原地合并
            else:
                i += 1
    return tokens
```

**易错点清单：**

- 频次统计要**乘词频**——漏乘 `freq` 等于把语料摊平了，这题的第一坑。
- 合并规则**按学习顺序应用**（先高频先合），编码时乱序会拆出训练时
  没见过的分法。
- 词边界符号（简化版的 `</w>`，GPT 系是空格前缀 Ġ）决定"低/低"这类
  跨词对不被合并；不提这一点说明你只背了代码。
- 判断词表大小时数的是**distinct token**，不是 word 数。

**面试官常见追问：**

- **「为什么是 BPE 不是按字/按词？」** 按字 token 数爆炸、语义西碎；按词
  OOV。BPE 折中：高频串合成单 token，低频串自动落到子词，OOV 能兜底
  拼出来。
- **「现代 LLM 用什么？」** GPT-2/LLaMA 系是字节级 BPE（base alphabet 是
  256 个字节，天然无 OOV、多语言友好）；SentencePiece 是不依赖空格预
  分词的变体（Unigram/BPE 两种训练模式）。
- **「BPE 时间复杂度？」** 每轮全语料扫一遍统计+替换，O(轮数 × 语料长)，
  工程上用增量统计加速。

## 四、参数量 / 显存手算演练

▶ 真题：参数量和显存占用估算——**高频**（字节/滴滴必考计算题）
不是默写代码而是白板速算，按四步法走。

**第 1 步 · 参数量**（每层约 $12d^2$，详细推导见
[transformer与attention](../../interview-questions/llm基础/transformer与attention.md)）：

```text
N ≈ L · 12d² + V · d          # SwiGLU FFN 时；GELU FFN 也是 12d²（4d×2 矩阵）
例: LLaMA-2-7B: L=32, d=4096 → 32·12·4096² ≈ 6.4B + embed 0.26B ≈ 6.7B ✓
```

**第 2 步 · 推理显存**（BF16，每参数 2 字节）：

```text
权重 ≈ 2N 字节         7B ≈ 14 GB, 70B ≈ 140 GB
KV/token = 2 · L · n_kv · d_head · 2 字节
         70B(GQA-8): 2·80·8·128·2 ≈ 0.31 MB/token → 4K 上下文 ≈ 1.25 GB
总显存 ≈ 权重 + KV Cache + 10%~20% 激活/碎片 buffer
例: 7B FP16 + 4K → 14 + 2 + 缓冲 ≈ 17 GB，单卡 24 GB 能跑
```

**第 3 步 · 训练显存**（AdamW + BF16 混合精度，全量微调时每参数 16 字节）：

```text
2(BF16 权重) + 2(BF16 梯度) + 4(FP32 主权重) + 4(m) + 4(v) = 16 字节/参数
7B 全量 ≈ 112 GB + 激活 —— 单卡 H100(80G) 都放不下，必须上 ZeRO/TP
LoRA: 主干 2N 字节冻结，优化器状态只按 ~0.5% 的低秩参数算
7B LoRA ≈ 14 GB 主干 + ~1 GB 状态 + 激活，24 GB 消费卡可训
```

**第 4 步 · 激活显存**（追问时答）：与 $\text{batch} \times \text{seq} \times d
\times L$ 成正比，长序列场景通常反超权重，靠梯度检查点（重算换显存，
算力多花 ~30%）压下来。

**易错点清单：**

- 算 KV Cache 时用 **n_kv（KV 头数）** 不是 q 头数——GQA 模型的题就是
  埋在这。
- 单位换算：$d^2$ 这种大数用科学计数；1 B 参数 FP16 = 2 GB，心算锚点。
- 训练显存别把激活忘了：权重 16N 只是下限，激活和梯度 buffer 常再加
  20%~50%。
- "KV Cache 占比随什么涨"——**batch 和 seq_len 线性涨**，权重固定不变；
  所以当问到"什么时候 KV 反超权重"时答长上下文/大 batch。

**面试官常见追问：**

- **「8×7B MoE（Mixtral）推理要多少显存？」** 权重按总参数 47B 算（≈ 90 GB
  FP16）——MoE 每个 token 只激活 2 个专家省的是 FLOPs，**参数全驻留**。
- **「怎么把 7B 塞进 24 GB 卡训练？」** LoRA/QLoRA + 梯度检查点 + 混合精度 +
  ZeRO-offload，组合拳报出来即可。
- **「vLLM 为什么能开大 batch？」** PagedAttention 把 KV Cache 分页管理，
  消除按 max_len 预分配的碎片浪费，显存利用率从 ~40% 提到 ~90%。

## 练习路径

- Block 和 MoE 两篇都默写到"5 分钟内重建"为止；MoE 的 aux loss 公式
  （$n_e \cdot \sum f_i p_i$）单独抽出来背。
- 想跑通 MoE 小实验，[学习资源清单](../../resources/学习资源清单.md) 里的
  **LLMs-from-scratch** bonus 章节和 **Tiny Universe** 都有可对照实现；
  BPE 部分直接对着 GPT-2 tokenizer 的 `encoder.json` 手工 merge 一段
  语料验证。
- 手算题找 5 个真实模型（LLaMA-7B/70B、Qwen2.5-7B、Mixtral-8×7B、
  DeepSeek-V3）各算一遍参数量+KV Cache，练到 2 分钟出数。
- 推理显存的工程实现细节（paged buffer 怎么组织）看清单里的 **nano-vllm**。

---

*同目录：[手写attention](./手写attention.md) ·
[对齐与并行代码](./对齐与并行代码.md) · [coding/ 目录](../)*
