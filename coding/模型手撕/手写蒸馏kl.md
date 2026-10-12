# 手写知识蒸馏 KL Loss（字节频次表 22 次 · 默写版）

> 题源：字节大模型 Coding 高频统计帖（手写知识蒸馏 22 次，核心考点是
> **KL 散度损失与温度调节**）。蒸馏手撕是「看起来最短、易错点最密」
> 的一类题——5 行代码里埋了 T² 补偿、log_softmax/softmax 分工、
> reduction 语义三个坑。追问会延伸到黑盒蒸馏与跨词表（字节多模态
> 一面真题）。

## 背诵总纲

```text
学生除以 T 后 log_softmax，教师除以 T 后 softmax
KD = KL(教师 ‖ 学生) × T²
loss = α · KD + (1 − α) · CE(学生, 硬标签)
```

骨架必须记住的行：`student_logits / T`、`F.log_softmax`（学生）与
`F.softmax`（教师）的分工、`reduction="batchmean"`、`(T * T)`。可以
现场推的部分：α 取值的语感、temperature 的平滑作用叙述。

## 一、标准蒸馏 Loss（可运行默写版）

▶ 真题：手写知识蒸馏损失（KL + 温度 + 硬标签加权）——**高频**（字节频次表 22 次）

```python
import torch
import torch.nn.functional as F

def distill_loss(student_logits, teacher_logits, labels,
                 T=2.0, alpha=0.5):
    """标准 KD loss（Hinton 2015 口径）。
    student_logits / teacher_logits: [B, V]（教师通常 no_grad）
    labels: [B] 硬标签；T: 温度；alpha: KD 项权重
    """
    # 学生：log 侧；教师：概率侧（方向不可反，KL(p_teacher ‖ p_student)）
    log_p_s = F.log_softmax(student_logits / T, dim=-1)   # [B, V]
    p_t = F.softmax(teacher_logits / T, dim=-1)           # [B, V]

    # KL 散度：F.kl_div 的第一个参数是 log 值、第二个是概率值
    kd = F.kl_div(log_p_s, p_t, reduction="batchmean") * (T * T)

    # 硬标签项用原始 logits（不除以 T）
    ce = F.cross_entropy(student_logits, labels)
    return alpha * kd + (1 - alpha) * ce
```

**易错点清单：**

- **T² 补偿**：温度会让梯度缩小约 T² 倍，乘回 `T * T` 是 Hinton 原文
  的口径；漏写是最常见丢分点。
- **log_softmax 在学生、softmax 在教师**，且 `F.kl_div(log, prob)`；写反
  得到的是反向 KL（mode-seeking 方向不同），面试官会追两种方向的差异。
- `reduction="batchmean"`：默认 `"mean"` 把 batch 和 vocab 一起平均，
  样本多的时候 KD 被稀释，量级与 CE 对不上，α 就失效了。
- 硬标签 CE 用**未除 T 的原始 logits**——温度只软化教师信号，不软化
  真实标签监督。
- 教师侧记得 `detach`/`no_grad`（完整训练循环里），白板上提一句即可。

**面试官常见追问：**

1. **温度在做什么？** 放大教师 logits 的相对差异（暗知识/dark
   knowledge），让学生学到「这个猫有点像狗」的类间结构，而不只是
   one-hot 对错。T→∞ 分布趋近均匀，T→1 退化为普通 KL。
2. **α 怎么选？** 教师强可信时 α 大（0.7-0.9 都常见）；有噪声或硬
   标签质量高时 α 小。追问「两个目标冲突怎么办」——梯度量级差太多
   时做归一化或课程式衰减。
3. **为什么 KD 之外还要 CE？** 教师也会错；硬标签锚定真值，防止把
   教师的错误一并蒸下来。
4. **teacher logits 拿不到怎么办（字节多模态一面原题）？** 黑盒场景只有
   文本输出：序列级 KD——用教师采样文本当伪标签做 SFT；或 top-k
   logits 近似（API 给 logprobs 的场景）。
5. **跨词表蒸馏怎么做（同场追问）？** 词表不同 KL 无定义：常用方案是
   top-k 对齐映射（建目标词到学生词表的映射表）、最小公共子词表截断、
   或直接退到序列级 KD。按「先词表映射、不行就序列级」两层答。
6. **T 和 α 之外的第三旋钮？** 特征层蒸馏（中间层 hidden state 的
   L2/cosine 对齐）——QLoRA 式轻量蒸馏常用组合。

## 二、现场提速版

```python
def kd_simple(s_logits, t_logits, labels, T=2.0, alpha=0.5):
    kd = F.kl_div(F.log_softmax(s_logits / T, -1),
                  F.softmax(t_logits / T, -1), reduction="batchmean") * T * T
    ce = F.cross_entropy(s_logits, labels)
    return alpha * kd + (1 - alpha) * ce
```

## 三、串联阅读

- 蒸馏生产线全链路（数据→配比→词表→验收）：
  [post-training蒸馏生产线专题](../../interview-questions/训练与对齐/post-training蒸馏生产线专题.md)
- OPD 与 SFT/RL 的选型判断（滴滴/字节多模态同考）：
  [rlhf与对齐](../../interview-questions/训练与对齐/rlhf与对齐.md)
- 量化协同压缩的另一条线：[蒸馏与剪枝专题](../../interview-questions/蒸馏与剪枝专题.md)
