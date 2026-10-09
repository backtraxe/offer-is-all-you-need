# 位置编码、Norm 与 Tokenizer

> LLM 基础模块的第二篇：让模型知道"词在哪"和"怎么稳着训"的那部分。
> RoPE 是高频 + 常手撕，Pre/Post-Norm 是腾讯最爱，BPE 是应用岗常识。
> 题目来源：[高频面试真题汇总](../高频面试真题汇总.md)。

## 一、为什么需要位置编码

Self-Attention 本身是**排列不变的**——把句子打乱，attention 的输出只是跟着换顺序，内容完全一样（数学上叫 permutation equivariant）。但语言显然有顺序："我打你"和"你打我"意思完全不同。所以得人为把位置信息注入进去。这就是位置编码要解决的问题。

<div class="diagram-embed">
<iframe src="assets/diagrams/pos-encoding-choice.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/pos-encoding-choice.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、绝对位置编码

▶ 面试题：位置编码有哪些？—**高频**

**Sinusoidal（原版 Transformer）**：不加可学习参数，直接用一套固定公式写死：

$$PE_{(pos, 2i)} = \sin\left(\frac{pos}{10000^{2i/d}}\right), \qquad PE_{(pos, 2i+1)} = \cos\left(\frac{pos}{10000^{2i/d}}\right)$$

- 直觉：把位置 pos 用一组不同频率的正弦/余弦函数编码成 d 维向量，第 i 对维度的波长是 $10000^{2i/d}$——低频维度变化慢、高频快，各维组合出独一无二的位置指纹。
- 优点：不需要训练，理论上可以外推（任意长度都有定义）；
- 关键性质：任意偏移 k 有线性关系 $PE_{pos+k} = M_k \cdot PE_{pos}$，即"相对位置信息在线性变换后保留"——这其实是 RoPE 的老祖宗。

**Learned（GPT-2/BERT）**：位置 embedding 直接当参数学。表达力强，但完全没法外推——训练时最长 1024，只能学到 1024 行 embedding，推理时更长的序列没有位置向量可用。

为什么现代主流 LLM 都放弃 learned PE 转向 RoPE？一句话：**RoPE 把位置信息从「加在 embedding 上的偏移」改成「乘在 Q/K 上的旋转」，天然带了相对性，还能配套各种纯插值式长上下文扩展。**

## 三、相对位置编码、RoPE、ALiBi

### 相对位置编码的思想

绝对编码告诉模型"你在第 7 个位置"，相对编码告诉模型"你和他隔了 3 个位置"。
直觉上：词语之间的关系本来就主要由相对距离决定（两个挨着的动词主语大概率属于同一短语）。
相对编码有很多实现，RoPE 和 ALiBi 是其中最成功的两条路线。

### RoPE (Rotary Position Embedding)

▶ 面试题：RoPE 原理？为什么比绝对位置编码好？—**高频，手撕也常考**

**核心操作**：把 Q/K 的每对相邻维度 $(q_{2i}, q_{2i+1})$ 看成一个二维向量，位置 m 乘上一个旋转矩阵 $R_{m\theta_i}$：

```text
       cos(mθ)  -sin(mθ)
R(m) = 
       sin(mθ)   cos(mθ)

q_m' = R(mθ) · q_m      θ = 10000^{-2i/d}
k_n' = R(nθ) · k_n
```

每个 token 的 Q/K 向量，只按它自己的位置在一个复平面里转一个角度。

**为什么这就带来了相对位置？** 关键一步推导是内积：

$$\langle R_m q, R_n k \rangle = q^\top R_{m-n} k$$

也就是说 attention score 只依赖**相对位置差 m−n**，跟绝对偏移无关。这正是相对编码想要的性质，而且这性质是**从结构上**天然得到的，不是学出来的。

**工程上的加分点**：
- 位置信息以"乘"的形式注入 QK，不改 V，不污染 token 表征本身；
- 无参数，序列长度变了不用改模型；
- 可以**离线预计算 cos/sin 缓存**，推理时只查表 + 逐对旋转，开销几乎可忽略。

**为什么比 sinusoidal 绝对编码好**：把它"注入一次就在 attention 里消失"的被动设计，
变成了"每一次 attention 计算都直接参与分数"的主动设计；相对性让它对长文档的
结构建模更稳定；实测在 LLaMA 系、Qwen 系、GLM 系全部验证有效。

**关于「外推」要小心（这是个坑，面试官常钓鱼）**：RoPE 单独拿出来**并不能**无限
外推。它的低频维度波长远大于训练长度，超过训练长度时这些维度的旋转角还在
第一段里没被训练过，模型立刻崩。所以长上下文扩展需要专门的 tricks：

- **Position Interpolation (PI)**：把长位置**线性压缩**回训练范围内，相当于把 cos/sin 频率整体调慢；
- **NTK-aware / Dynamic NTK**：分维度插值，高频维度少缩一点，低频多缩——保持高频细节不丢；
- **YaRN**：在 NTK 基础上进一步分频段做插值策略 + 一个温度系数，LLaMA 系 8K→32K→128K 的最常用配方之一。

一句话：**RoPE 天然自带相对性质，但本身不超训练长度的保险；现代长上下文是
"RoPE + NTK/YaRN"组合出来。**

<div class="diagram-embed">
<iframe src="assets/diagrams/pos-encoding-mechanism.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/pos-encoding-mechanism.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### ALiBi

不改 Q/K 的内容，只在 attention score 上加一个固定的线性偏置：

$$\text{score}(i, j) = q_i \cdot k_j - m \cdot |i - j|$$

m 是一个按头不同的斜率（head i 用 $m_i = 2^{-8i/h}$）。离得越远的 token，分数被
减得越多。

- 优点：**零参数、零额外计算、外推极强**（用 1K 长度训的模型外推到 4K 也不崩）；
- 缺点：对"长距离上确实有强依赖"的任务（比如代码末尾调用开头定义的函数）
  的建模有偏负，交给模型自己学的能力少一点；
- 代表模型：BLOOM、Falcon 7B（后续版本改回了 RoPE）。

**对比速记**：

| | 注入位置 | 相对性 | 插值式长上下文 | 代表模型 |
|---|---|---|---|---|
| Sinusoidal | embedding 加法 | 弱（间接） | 一般 | 原版 Transformer |
| Learned | embedding 加法 | 无 | 不能 | GPT-2/BERT |
| **RoPE** | Q/K 旋转 | 强（内积只依赖差） | 好，配 NTK/YaRN | LLaMA/Qwen/GLM |
| ALiBi | score 线性 bias | 强 | 最好 | BLOOM/Falcon |

## 四、Norm

▶ 面试题：Pre-Norm vs Post-Norm？LayerNorm vs RMSNorm，为什么大模型用 RMSNorm？—**高频**（腾讯）

### LayerNorm vs RMSNorm

LayerNorm：
$$\text{LN}(x) = \frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} \odot \gamma + \beta$$
两行统计量：均值 μ 和标准差 σ，再做 scale + shift。

RMSNorm（LLaMA 用的）：
$$\text{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{d}\sum_i x_i^2 + \epsilon}} \odot \gamma$$
只减去 RMS（均方根），**不做均值中心化**，没有 β shift。

为什么大模型都用 RMSNorm？
- **算得快**：不用算均值，少一次全局 reduce + 少一个减法；在 kernel 层面省一个
  pass，大约 7%–60% 的速度提升（取决实现）；
- **效果几乎不掉**：论文实测 RMSNorm ≈ LayerNorm，均值中心化那一项的贡献
  远没有 scale 重要；
- 对 CUDA 友好：一个 elementwise 归一化 + 一个 RMS 归约，比 LN 的两次归约
  更好融合——Infra 岗的手撕 RMSNorm CUDA 题就考这个（见 [高频面试真题汇总 - 手写代码题](../高频面试真题汇总.md#七手写代码题live-coding-真题)）。

### Pre-Norm vs Post-Norm

Post-Norm（原版 Transformer）：`x + F(LN(x))` 顺序反了，实际是 `LN(x + F(x))`——
先走子层加残差，再 Norm。

Pre-Norm（GPT-2 以后的主流）：
$$\text{out} = x + F(\text{Norm}(x))$$

**差异完全是训练稳定性**：
- Post-Norm 的残差通路被 LN 挡着，深层时梯度仍然要经过 LN 的 Jacobian，
  层数一深（>50）常训不动，需要 careful learning-rate warm-up；
- Pre-Norm 的残差通路是**纯恒等**，前向每层只是往"主流刘"上加分量，反向梯度
  直接走 $1 + \partial F$ 回流，几百层也能训。这就是为什么 LLaMA、Qwen、GPT
  全部 Pre-Norm；
- 代价：Pre-Norm 深层各子层趋向"没归一化的 x"叠加，最终性能上限略低于
  Post-Norm（同样数据下 Post-Norm 一旦能训起来往往更好）——但大模型都在卷
  稳定性，所以 Pre-Norm 赢了。各家对应变体：DeepNorm、Sandwich-Norm 是
  试图两头占的折中。

<div class="diagram-embed">
<iframe src="assets/diagrams/pre-vs-post-norm.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/pre-vs-post-norm.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

一句话答法：**"Pre-Norm 是因为深网络训练稳定——残差通路保持恒等，梯度能直通；
RMSNorm 是因为省钱——LN 的均值中心化对效果贡献小，砍掉它改 RMS 既快又没掉点。"**

## 五、Tokenizer 与 BPE

▶ 面试题：Tokenizer 怎么做的？BPE 原理？一段文本切成多少 token？—**中**（字节/应用岗）

### 为什么不是按词切

按词分词是词表爆炸 + OOV（未登录词）；按字切是序列太长，而且中文按字丢失了词性信息。
子词（subword）是折中：**常见词一个 token，生僻词拆成 2-3 个常见子词**。BPE 就是
这个数据压缩时代借来的子词算法。

### BPE 原理（一句话就能讲完）

1. 初始化词表 = 所有字符（字节级 BPE 用所有 byte）；
2. 统计语料中所有相邻 token 对的出现频率；
3. 把频率最高的一对合并成一个新 token，加入词表；
4. 重复 2-3 直到达到目标词表大小（GPT-4 约 10 万，LLaMA 3.2 万）。

训练出来的是一张**合并规则表**；推理时按同一张表的顺序去贪婪合并就是 encode。

<div class="diagram-embed">
<iframe src="assets/diagrams/bpe-merge.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/bpe-merge.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

应用岗常问的同行词汇：
- **BPE**（GPT 系）、**WordPiece**（BERT）、**Unigram**（T5/LLaMa 里 SentencePiece 常用）；
- **BBPE（byte-level BPE）**：BPE 直接在字节上跑，任何语言都通用；GPT-2/3/4、
  LLaMA-3 用它。

### 一段文本切成多少 token？（用途 = 费用/上下文估算）

经验法则：
- **英文**：1 token ≈ 4 字符 ≈ 0.75 词（GPT 官方给的近似）；
- **中文**：取决于 tokenizer 对中文的优化程度。LLaMA 系词表偏英文，常用汉字也常被
  拆成 2 个字节级 token，**1 汉字 ≈ 1.5-2 token**；Qwen/Yi 等中文友好的 tokenizer
  词表覆盖常用单字和高频词，实测约 **1 汉字 ≈ 0.7-1 token**。
- 粗略结论：一段 **1000 汉字的中文文档约 800-1800 token**（英文为主的模型取上限、
  中文优化的模型取下限）；同等信息量的英文约 250 词 ≈ 330 token。

估算公式（粗到只能算预算用，中英混排）：
$$\text{tokens} \approx \text{汉字数} \times 1.5 \;+\; \text{英文词数} \times 1.3$$

或者更简单：**宁可多留 20% 余量**——因为 prompt template、工具结果、JSON 标记都
会额外占 token，预算不够会在 decode 阶段截断。

### tokenizer 的深层影响：成本、边界与安全（why 层）

面试官把 BPE 追问到深处，真正考的是这四条传导链：

1. **成本传导链**：tokenizer 效率 → 同样的字变成更多 token → prefill FLOPs、
   KV Cache、账单同比例放大。**案例**：同一篇 1000 汉字文档，LLaMA 系
   tokenizer 约 1800 token，Qwen 系约 800——同样的模型同样的任务，推理成本
   直接差一倍多。所以"选模型先看 tokenizer 的中文/代码覆盖率"是应用岗的
   直觉题，也是 Infra 优化的起点（见
   [显存计算专题](../显存计算专题.md) 的 KV 三旋钮）。
2. **特殊 token 是攻击面**：`<|im_start|>`、`<s>` 这类特殊 token 若 API 层
   不过滤，用户就能在文本里"伪造角色边界"——等于在 system prompt 的位置
   写字。这与 [Agent 安全](../agent/agent安全与防护.md) 的注入防御 L1 同源：
   输入侧必须做 token 级 sanitize，不能只做字符串级。
3. **训练/推理完全一致**：tokenizer 是模型的一部分，错一个合并顺序、换一个
   版本，输出立刻乱码；蒸馏/私有化部署换 tokenizer 约等于换模型，要重新评估。
4. **glitch token 与"数草莓"**："SolidGoldMagikarp" 这类怪词能触发异常输出，
   根因是合并规则来自语料频率，部分词表 token 的 embedding 几乎没被训练过；
   同理"strawberry 有几个 r"难住模型，是因为模型看见的是 token 边界而非
   字母——**不是推理缺陷，是表征粒度缺陷**。

手撕加餐：① 手写 byte-level BPE 的 encode/decode（30 行）；② 用
`tiktoken` 与 `Qwen tokenizer` 分别统计同一段中英混排文本，解释 token 数
差异来自哪几条合并规则——面试官要的就是"说得出的那种解释"。

## 六、高频追问清单（本主题）

| 追问 | 答题要点 |
|---|---|
| RoPE 为什么外推时低频维度先崩？ | 低频 θ 小，旋转角随位置增长缓慢，超过训练长度时 shift 超出已经"见过的"角度分布；NTK 就是小调低频、保高频。 |
| RoPE 给 Q/K 都加，为什么 V 不加？ | 位置信息只需要影响"attention 分数"（谁注意谁），V 承载内容本身；加在 V 上会污染表征。 |
| LayerNorm 放在 Pre 还是 Post 一定二选一吗？ | 不一定：DeepNorm/Sandwich 是 mix；GLM 用 DeepNorm 稳住千亿参数模型。但主流开源全是 Pre-Norm + RMSNorm。 |
| RMSNorm 有没有 β shift？ | 没有，只有 scale γ；β 的作用历史上被认为不重要。 |
| BPE 一个词表大概多大？ | GPT-2 5 万、GPT-4 ~10 万、LLaMA 3.2 万、Qwen ~15 万；越大省 token、越小模型 Embedding 越省参数字典；趋势是越来越大。 |
| 中文模型为什么词表普遍比英文模型大？ | 中文汉字作为子词单元比英文字母多得多；覆盖常用汉字 + 组合需要的词表天然更大，Qwen 15 万就是为了中文/代码/数学的多语言平衡。 |
| 词表越大越好吗？ | 不是——vocab 大让 Embedding 和 LM Head 参数量增加（V·d），fine-tuning 也贵；但 vocab 大 sequence 短，attention 便宜。LLaMA 3 加到 12.8 万就是这个权衡。 |

## 七、手撕练习（→ coding/）

- **手撕 RoPE 位置编码**：写 `precompute_freqs_cis` + `apply_rotary_emb`，核心是把最后
  一维劈成 [d/2, 2] 复数乘法（或写成 `x*cos + rotate_half(x)*sin`）——中高，公众号
  面经手撕高频；
- **手撕 LayerNorm / RMSNorm**：mean/var 归一化 + scale；numpy 版本可以按公式直接写，
  但 RMSNorm 少算均值，正好体会省的一步；
- **CUDA 手撕 RMSNorm**：滴滴 AI Infra 一面原题；
- **BPE 训练过程手写**：模拟合并排序，词表大小到 N 停止——偶发；
- 配套的 [coding/](../../coding/) 目录会同步放题解。

---

*上一篇：[Transformer 与 Attention](./transformer与attention.md) · 上一页 [模块导航](./README.md)*
