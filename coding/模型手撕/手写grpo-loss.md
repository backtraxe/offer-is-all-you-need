# 手写 GRPO Loss（滴滴二面原题 · 完整版）

> 题源：2026-10 滴滴大模型实习算法二面（InternVL 团队）——「用 PyTorch
> 写一个简化版 GRPO Loss」。此前的旧题型是「手写 GRPO advantage」
> （见 [对齐与并行代码](对齐与并行代码.md#三grpo-advantage-计算伪代码)，
> 阿里深挖），**新趋势是把 advantage、IS ratio、token 级 loss 串成一整段
> 可运行代码**，考察你是否真的动手训过。白板四步骨架：组内优势 → 广播
> 到 token → 取 log prob → 用 ratio 构造 token-level loss。

## 背诵总纲

```text
rewards [G] --(减组均值、除组标准差)--> A [G]
A --(广播)--> A[:, None] [G, T]
logits --(log_softmax + gather 动作位)--> logp [G, T]
ratio = exp(logp - old_logp)
loss = -(ratio * A).mean()          （无 clip 简化版）
```

骨架必须记住的行：`log_softmax` 后 `gather` 取动作位、`A.unsqueeze(-1)`
广播、`torch.exp(logp - old_logp)`、最后取负号求均值。clip 和 KL 是
加分项，记不住可以口述公式。

## 一、简化版 GRPO Loss（可运行默写版）

▶ 真题：PyTorch 写简化版 GRPO Loss——**新高频**（滴滴二面 2026-10）

```python
import torch
import torch.nn.functional as F

def grpo_loss(logits, old_logits, ref_logits, actions, rewards,
              beta=0.04, clip_eps=0.2, eps=1e-8):
    """简化版 GRPO loss。
    logits:      [G, T, V] 当前策略对每个采样回答的 logits
    old_logits:  [G, T, V] 采样时（行为策略）的 logits
    ref_logits:  [G, T, V] 参考模型 logits（算 KL 用，可选）
    actions:     [G, T]    每个位置实际采样的 token id
    rewards:     [G]       组内 G 个回答各自的奖励（二值或连续）
    """
    # 第 1 步：组内优势（GRPO 不需要 critic，组内均值即 baseline）
    A = (rewards - rewards.mean()) / (rewards.std(unbiased=False) + eps)   # [G]

    # 第 2 步：取每个 token 的 log prob（log_softmax 后按动作位 gather）
    logp     = F.log_softmax(logits, dim=-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)      # [G, T]
    old_logp = F.log_softmax(old_logits, dim=-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)  # [G, T]

    # 第 3 步：importance sampling ratio（新旧策略概率比）
    ratio = torch.exp(logp - old_logp)                                    # [G, T]

    # 第 4 步：广播优势到每个 token，构造 token-level loss
    At = A.unsqueeze(-1)                                                  # [G, 1] -> [G, T]
    surr = torch.min(ratio * At,
                     torch.clamp(ratio, 1 - clip_eps, 1 + clip_eps) * At) # PPO 式 clip
    policy_loss = -surr.mean()

    # 第 5 步（加分项）：k3 形式 KL 惩罚，防跑偏参考模型
    ref_logp = F.log_softmax(ref_logits, dim=-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    log_ratio = ref_logp - logp
    kl = (torch.exp(log_ratio) - log_ratio - 1).mean()                    # k3 估计器
    return policy_loss + beta * kl
```

**易错点清单：**

- **归一组维度是 G 维**（同 prompt 的 G 个回答内做），别对 T 或 batch
  维归一——方向错了 baseline 语义全毁。
- `gather` 前必须先 `log_softmax`，直接 gather logits 是高频翻车点。
- **token 级 logp 不要先求和再算 ratio**：GRPO 的 ratio 是逐 token 的，
  先 sum 就变回 sequence-level（那是另一种实现口径，被追问要能区分）。
- `A` 广播时写 `A.unsqueeze(-1)`，别直接乘——shape 会无声广播错。
- clip 用 `torch.min` 而不是 `torch.clamp(...)` 套整个 surr：min 是
  在两个 `ratio*A` 之间取保守值，A 为负时方向要小心（面试官爱问）。
- 简化版可以不写 clip/KL，但被问到要能指着第 4、5 步说出插哪。

**面试官常见追问（滴滴原场连环问）：**

1. **组内优势怎么算？** 减组均值除组标准差；追问全 0 全 1 group——
   标准差为 0，优势全 0 不贡献梯度，天然过滤无效题。
2. **怎么把组内优势广播到每个 token？** `A.unsqueeze(-1)`，一个回答
   内所有 token 共享同一个优势（这是 GRPO 与 PPO 的 token 级 GAE
   的关键差异）。
3. **Token-Level Loss 怎么构造？** 逐 token 的 `-(ratio * A)` 求均值；
   clip 版见第 4 步。追问：为什么用 mean 不用 sum——长回答不会被
   天然放大权重。
4. **IS Ratio 怎么算？** `exp(logp - old_logp)`；同步训练时 ratio≈1，
   **异步 rollout 时 ratio 偏离 1 正是训崩信号**——对照
   [rl训练工程实战](../../interview-questions/训练与对齐/rl训练工程实战.md)
   的训推不一致章节。
5. **截断轨迹（撞 context 上限）怎么处理？** 给 0 和整体 mask 是两种
   信号：给 0 在组内归一化下得到负 advantage，**可能诱导模型提前
   提交**；DeepSWE 是整体 mask 不计入损失（面试官视角帖口径，见
   [面经合集十六节](../../interview-experiences/小红书社招面经合集-2026h2.md)）。

## 二、现场提速版（10 行骨架）

时间紧或面试官说「写个大概就行」时的收缩版：

```python
def grpo_loss_simple(logits, old_logits, actions, rewards, eps=1e-8):
    A = (rewards - rewards.mean()) / (rewards.std(unbiased=False) + eps)
    logp = logits.log_softmax(-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    old  = old_logits.log_softmax(-1).gather(-1, actions.unsqueeze(-1)).squeeze(-1)
    ratio = (logp - old).exp()
    return -(ratio * A.unsqueeze(-1)).mean()
```

写完主动补一句「四步：组内优势、log prob 取位、IS ratio、token 级
均值」，把节奏留给面试官追问 clip/KL——**这题的设计就是让你被追问**。

## 三、串联阅读

- 组内优势的五种变体与全零组处理：[对齐与并行代码](对齐与并行代码.md)
  第三节
- 训推不一致 / 异步 rollout / 环境工程：[rl训练工程实战](../../interview-questions/训练与对齐/rl训练工程实战.md)、
  [rl环境工程专题](../../interview-questions/训练与对齐/rl环境工程专题.md)
- verl 真实实现（core_algos.compute_grpo_outcome_advantage）：
  [verl深度拆解](../../interview-questions/训练与对齐/verl深度拆解.md)
