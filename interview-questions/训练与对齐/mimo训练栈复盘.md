# MiMo 训练栈复盘：25T 预训练抬上限 · 改进 GRPO · Seamless Rollout

> 本篇面向准备「训练栈全链路复盘」类追问的读者：面试官让你挑一个工业界
> 案例，从预训练一路讲到 RL infra，看你能不能把**数据配比 → SFT → RL →
> 系统**串成一盘棋。
> 读完后你将得到：一条完整的 MiMo-7B 训练栈动线（25T 三阶段预训练 →
> 6M SFT → 130K 改进 GRPO）、一句主攻锚句 + 一句 infra 锚句、7 道高频
> 面试题的答法。
> 时效口径：数字锚来自 MiMo-7B 技术报告（arXiv 2505.07608）与 GitHub
> README，2026-10-10 实测核实；GPU 总量/总训练时长等**未公开**项已明确
> 标注，不杜撰。

## 一、直觉：RL 的天花板由 base model 的推理潜力决定

回顾一个争论：模型推理能力到底是**预训练学出来的**还是 **RL 激发出来的**？
小米 MiMo-7B（2025/04 发布，arXiv 2505.07608）给了一个干净利落的实验
回答：他们把筹码**重注押在预训练**上——25T tokens 三阶段配比，让 base
model 的 pass@k 上限**超过 32B 量级模型**，再在这个高上限上做 RL，
用 7B 参数做到 AIME24 **80.1**（技术报告 GitHub），反超 DeepSeek-R1 的
**79.8**。

一句话叙事：**先把 base 的上限抬上去，RL 才有腾挪空间；小模型以小博大，
博的是预训练的投资密度。** 这也是回答「预训练 vs 后训练谁更重要」这类
送分题的最好案例——不再空谈，直接引用 MiMo 的实验设计。

<div class="diagram-embed">
<iframe src="assets/diagrams/mimo-stack.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/mimo-stack.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、预训练：25T tokens 三阶段配比

### 2.1 三阶段：先广谱、再专才、后长上下文+合成推理

总量 **25T tokens**，三个阶段各有明确分工（技术报告）：

- **S1 全量数据源打底**：去低知识密度内容——广告/新闻/招聘类**下采样**，
  专业领域**上采样**。直觉：先建立广谱世界知识；
- **S2 数学+代码提到约 70%：**专才配比，把推理相关能力集中喂出来；
- **S3 加约 10% 合成 response**（数学/代码/创意写作），同时把 context
  从 8K 扩到 **32K**，RoPE base 从 **10,000 提到 640,000**（前两阶段
  8K / 10,000）。

why 三阶段而不是一把配比到底：知识密度先筛一遍防止预算浪费在低质文档上；
数学代码是推理的主引擎所以第二阶段倾斜；长上下文和「会写推理过程」最后
灌——顺序反过来，先训长文本的预算效率不值。

### 2.2 数据工程四个动作（这部分经常被追问）

1. **自研 HTML 抽取**，专门保留数学公式和代码块——常见 extractor 会丢
   公式、把代码块拍平，对推理数据是致命伤；
2. **PDF/STEM 解析增强**（论文、教材的公式抽取单独优化）；
3. **全局快速去重**；
4. 用**先进推理模型批量生成合成推理数据**（S3 那 10% 的来源）。

### 2.3 架构：Llama 系 + 单 MTP 层，训推非对称

- 主体是 Llama 系配置：**GQA + pre-RMSNorm + SwiGLU + RoPE**；
- 加**单 MTP 层**（仿 DeepSeek-V3 的 Multi-Token Prediction）：loss 权重
  前 **10.3T** 为 **0.3**，之后降到 **0.1**（技术报告）；
- **训推非对称是聪明设计**：预训练只塞 1 层 MTP（报告实验多层无增益），
  推理期却可以**堆多层 MTP 当头做投机解码**——第 1 层接受率约 **90%，**
  第 3 层仍 **>75%**（技术报告）。训练成本最小化、推理加速最大化，
  两头都吃到。

### 2.4 超参与未公开项

AdamW β(0.9, 0.95)、weight decay 0.1、grad clip 1.0；LR warmup 到
**1.07e-4**，经过 **10.2T** 的常量段，再对 **7.5T** 做 cosine 降到
3e-5；batch warmup 到 **2560**（S3 阶段为 640）。**GPU 总量与总训练
时长官方未公开**——面试里被问到就老实说未公开，不要编。

## 三、SFT：6M 蒸馏数据与三段清洗

SFT 数据是开源 + 自采蒸馏数据的混合体，**三段清洗**（技术报告）：
**16-gram 评测去重**（防测试集泄漏）→ 去混合语言/不完整 response →
**每 query 最多保留 8 条**。超参：LR **3e-5** 常量、batch **128**、
packing 到 **32,768**。

0530 版本把 SFT 从 **500K 扩到 6M 条**，RL 的 context window 也从 32K
扩到 **48K**（GitHub）——数据量翻倍 + 上下文放长，是 RL-0530 全面上涨的
前提。

## 四、RL 后训练：改进 GRPO + 全规则可验证 reward

基于开源 **verl** 自研扩展（报告明确引用 Sheng et al. 2024），在 GRPO 上
做了三处改进，每一处都对应一个明确的痛点：

1. **去 KL loss**：省掉 reference model 的显存和计算，也放开探索空间；
2. **Dynamic Sampling**：过滤 passrate=1（全对）和 passrate=0（全错）的
   prompt——这些组的优势在全组归一化后是**零梯度**， rollout 纯属浪费；
3. **Clip-Higher**（DAPO 思想）：抬高 ε_high，防熵坍缩——下界裁剪保持
   紧、上界放松，给探索型 token 留爬升空间。

### 4.1 数据：130K 全规则可验证

**数学 100K + 代码 30K**（技术报告），全部规则可验证：

- **数学**：用 LLM **过滤证明题和选择题**（这两类最易被 reward hacking），
  保留原题；n-gram 去重 + 评测去污；难度两刀——先滤掉先进模型也解不出
  的（信号为零），再用 SFT 模型 rollout **16 次**滤掉 passrate > 90% 的
  易题，**砍掉约 50%；**
- **代码**：必须有 test case；golden solution 必须跑过全部测试；SFT 模型
  **16 次 rollout 全对者剔除**；在线判题环境**并行跑海量单测**。

### 4.2 Reward：只做规则化，不上学习式 RM

- **只用规则化 accuracy reward**（数学用 Math-Verify），**没有 format
  reward、没有长度惩罚**——信号单一才可能不被 hack；
- 代码侧是 **Test Difficulty Driven Reward**：仿 IOI 子任务计分，按 test
  通过率把测试**聚类出难度**、分 strict/soft 两档给分——缓解难题上
  「全错零分」的稀疏奖励问题；
- **Easy Data Re-sampling**：passrate=1 的 prompt 不是丢掉，而是进易题池
  以 **10% 概率重采样**——对照实验显示直接丢弃会让 policy 更新不稳
  （技术报告）。

超参：batch **512**、actor mini-batch 32、每次迭代 **16 次梯度更新**、
LR **1e-6**、max seq **32K**、temp/top-p=1.0。

## 五、RL Infra：Seamless Rollout Engine（infra 叙事核心）

RL 训练的 GPU 空转大头在哪？**rollout 长尾 + 奖励计算的同步屏障**：
生成是一批齐步走，最长的样本拖住所有人，reward 计算又把生成停了。
MiMo 的 Seamless Rollout Engine 用三件套把屏障打掉（技术报告）：

- **continuous rollout**：消除「生成→奖励」的同步屏障，样本边生成边进
  下游；
- **异步奖励计算**（基于 Ray）；
- **early termination**：FIFO 选择，尾批直接截断不再等。

这个数字是面试里最硬的：**256 张 H20 实测，相对 naive dynamic sampling
训练加速 2.29×、rollout 2.61×，GPU idle 占比 69.3%→27.7%，sample waste
22.1%→12.9%；验证吞吐 1.96×**（技术报告）。而且保持**同步训练语义
不改算法**——工程加速不等于偷偷换成异步算法。

引擎侧还有两个开源联动动作：vLLM 用 **external launch** 方式接入并加固
（prefix cache 一致性、scheduler steps 兼容性），并给 vLLM **加了 MTP
支持回馈社区**——官方 fork 基于 vLLM 0.7.3，该能力已进入 **SGLang 主线**
（GitHub）。面试讲「回馈开源」或者「训推一体引擎问题」时这段是现成素材。

## 六、效果数字锚：7B 以小博大

temp=0.6、AIME 平均 32 次的口径下（技术报告 / GitHub）：

| 评测 | o1-mini | QwQ-32B-Preview | MiMo-7B-RL | MiMo-7B-RL-0530 |
|---|---|---|---|---|
| AIME24 | 63.6 | 50.0 | 68.2 | **80.1**（超 R1 的 79.8） |
| AIME25 | 50.7 | 32.4 | 55.4 | **70.2** |
| LiveCodeBench v5 | — | — | 57.8 | **60.9** |
| LiveCodeBench v6 | — | — | 49.3 | **52.2** |

两个补充结论：

- **Base 本身就狠**：MiMo-7B-Base 在 AIME24 已到 **32.9**，显著超同尺寸
  Qwen2.5-7B / Llama-3.1-8B——上限是预训练给的；
- **RL from SFT vs RL-Zero**（报告 §3.5.2）：RL from SFT 的**上限更高**
  但增长斜率更缓——「起点低、跑得快」与「起点高、天花板高」的取舍，
  正式版本选了后者。

## 七、系列时间线：从 MiMo-7B 到 MiMo-V2-Flash

- **2025/04** MiMo-7B：开源 Base / SFT / RL-Zero / RL-0530 之前四个 ckpt
  （Base/SFT/RL-Zero/RL）；
- **2025/05-30** RL-0530：SFT 扩 6M、RL window 48K；
- **2025/06** MiMo-VL-7B（arXiv 2506.03569）：原生分辨率 ViT + MLP
  projector + MiMo-7B LLM，四阶段预训练 + MORL 混合 on-policy RL；
- **2025/08** VL-RL-2508：MMMU **70.6**、VideoMME **70.8**；
- **2025/09** MiMo-Audio-7B：1.2B 参数 audio tokenizer（25Hz、8 层 RVQ、
  200 tokens/s），README 原文口径为「千万小时语料训 tokenizer、**超一亿
  小时音频预训练**」——小时数按 README 标注引用即可；
- **2025/11** MiMo-Embodied-7B：首个同时覆盖自动驾驶 + 具身智能的开源
  VLM；
- **2025/12** MiMo-V2-Flash（arXiv 2601.02780）：**309B 总参 / 15B 激活**
  的 MoE、**27T tokens FP8 预训练**、256K context；SWA:GA=**5:1** 混合
  注意力（128 token 滑窗 + sink bias，KV cache 省近 **6×**）、**3 层轻量
  MTP** 推理约 **3×** 提速；后训练用 **MOPD 多教师 on-policy 蒸馏** +
  agentic RL（10 万+ 真实 GitHub issue 环境、K8s 万级并发 pod），
  **SWE-Bench Verified 73.4、AIME25 94.1**；
- **2026** MiMo-V2.5-ASR、MiMo-Code（终端编程 Agent，GitHub 13.6k star）。

面试用得上的一条线：**MTP 从 MiMo-7B 的「1 层训练+推理堆多层」到
V2-Flash 的「3 层轻量 MTP 直接加速 3×」**——架构赌注延续，回报越来越硬。
未公开/未核实项：VL 预训练 token 量、各代 GPU 总量与训练时长均未见
官方披露。

## 八、面试案例锚句（背下来直接用）

**主攻锚**（讲算法/训练栈时用）：

> 小米 MiMo-7B 证明 RL 天花板在预训练：**25T** 三阶段配比（数学+代码峰
> 值 **70%**）把 base 的 pass@k 上限抬过 32B 模型，再用 **130K** 可验证
> 题做改进 GRPO（去 KL + Dynamic Sampling + Clip-Higher），7B 做到
> AIME24 **80.1** 反超 DeepSeek-R1（**79.8**），RL-0530 全面超 o1-mini。

**infra 锚**（讲训练系统时用）：

> RL 训练 GPU 空转的大头在 **rollout 长尾 + 奖励计算**：MiMo 的 Seamless
> Rollout Engine 用 continuous rollout + 异步 reward + FIFO early
> termination 三件套，**256 张 H20** 上训练加速 **2.29×**、GPU idle 从
> **69.3% 压到 27.7%**——并且保持同步训练语义、不改变算法本身。

## ▶ 面试题

**Q1：为什么 MiMo 只用 rule-based reward，不训一个 RM？**
规则 reward 几乎不可 hack：数学用 Math-Verify 做符号级核对，代码用在线
判题跑全部 test case。为防漏刷还做了反作弊前的**数据层防御**——证明题
和选择题直接被 LLM 筛掉（答案格式太容易糊弄），保留原题；再叠 n-gram
去重和评测去污防泄漏。RM 的问题是它可以被讨好，而规则只有 0/1。

**Q2：代码任务稀疏奖励怎么缓解？**
Test Difficulty Driven Reward：仿 IOI 子任务计分，把 test 按通过率
**聚类出难度**，strict/soft 两档给分——难题过一部分测试也有部分分，
不再是「过一个全对、否则归零」的 0/1 悬崖。

**Q3：Dynamic Sampling 后期采样效率塌陷怎么办？**
训练后期模型变强，passrate=1 的组越来越多，过滤后有效 batch 变小、
更新不稳。MiMo 用 **Easy Data Re-sampling**：易题进池子，**10% 概率
重采样**回来；报告里有对照实验——直接丢弃易题的版本 policy 更新不稳。

**Q4：RL from SFT 还是 RL-Zero？**
报告 §3.5.2 的对比结论：RL from SFT **上限更高**但增长斜率小；RL-Zero
起步快但天花板低。取舍本质是「要不要为更好的终点多付一次 SFT」。MiMo
给的配套答案是 yes——因为 base 上限已经被 25T 抬得很高，SFT 只是把它
对齐到可用分布。

**Q5：MTP 训推非对称，为什么训练只放 1 层、推理堆多层？**
训练侧实验发现**多层 MTP 没有增益**还白占显存算力，所以只训 1 层（loss
权重前 10.3T 取 0.3、后降到 0.1）；推理侧可以把 MTP 头**自堆叠**成多层
draft 模型做投机解码——第 1 层接受率约 90%、第 3 层仍 >75%。一份权重、
两种用法。

**Q6：GRPO 三处改进各自解决什么？**
一句话版：去 KL = **省掉 reference model 的显存和计算**；Dynamic
Sampling = **消除全对/全错组的零梯度 rollout 浪费**；Clip-Higher =
**防熵坍缩**（上界裁剪放松给探索留空间，下界保持紧）。

**Q7：预训练三阶段配比的直觉是什么？**
先**广谱**（S1 去低知识密度，广告/新闻/招聘下采样、专业领域上采样），
再**专才**（S2 数学+代码提到约 70%——推理的主引擎），最后**长上下文
+ 合成推理**（S3 约 10% 合成 response、8K→32K、RoPE base 10,000→
640,000）。顺序直觉：知识 → 配比 → 长度，先训长文本是浪费预算。

## 串联阅读

- 上游算法：[rlhf与对齐](./rlhf与对齐.md)（PPO/GRPO/DPO/DAPO 公式与
  RL 算法演化线——MiMo 的三处改进里两处来自这条线）；
- 同栈工程：[rl训练工程实战](./rl训练工程实战.md)（四坑复盘：verifier
  漏刷、熵坍缩、数据筛选、长思维链——可与本篇互为印证）；
- Infra 深潜：verl深度拆解.md（同目录，MiMo RL infra 基于 verl 自研
  扩展，源码级框架拆解）；
- 前置阶段：[预训练与sft](./预训练与sft.md)（三阶段配比的通用方法论）；
- 数据底座：[数据工程专题](./数据工程专题.md)（HTML/PDF 抽取、去重、
  合成数据的完整管线）。
