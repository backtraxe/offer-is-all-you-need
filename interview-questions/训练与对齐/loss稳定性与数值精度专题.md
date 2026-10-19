# Loss 稳定性与数值精度专题：零 Spike 军功章、FP8 一二八修正律与恢复 Runbook

> **面向**：已读过 [训练框架与稳定性](../distributed-training/训练框架与稳定性.md)（排查流程与容错三层）与
> [rl训练工程实战](./rl训练工程实战.md)（算法信号层的坑）、准备「预训练/RL 训练稳定性」
> 追问线的读者。本篇是**数字层专题**：bf16 累加外溢、FP8 块级缩放、attention logit
> 爆炸、梯度收缩与恢复 runbook——排查流程的「怎么查」在框架篇已有，本篇只补
> 「官方事故的数字与原文」，是面试里最能区分「读过」和「排过」的一段。
>
> **读完获得**：① 零 spike 军功章对照组（DSV3/K2 两次官方声明 vs Llama3 中断账）
> 的完整口径；② GLM-130B 公开文献里最完整的 spike 实录与 grad norm 先行指标
> 论；③ FP8 训练的「一二八修正律」（N_C 累加间隔、tile/block 粒度、五件套保原
> 精度、消融误差上限）全套可背数字；④ QK-Clip 咬字集与 μP 采用度实测（谁是
> 信徒、谁缺席）；⑤ WSD 的恢复自由度（decay 一成足够）；⑥ RL 侧 off-policy
> spike 的 MiniCPM-4 四件套；⑦ 监控告警骨架与恢复 runbook 三件套；⑧ 8 条
> 面试题的完整答法与频率标注。
>
> **时效口径**：素材时间轴从 **GLM-130B（2022，arXiv:2210.02414）** 到 Kimi K2、
> MiniCPM-4、Qwen3 三家 **2025 年新报告**；时效口径 2026-10。论文数字按原文口径括注，厂商
> 宣称一律标「官方口径/论文宣称」，未核实项见文末「口径与未核实说明」。

## 一、主线直觉：稳定性的最后一战在数值与系统

大模型训练事故的兜底战，已经从「算法会不会」变成**数值与系统稳不稳**：各家
官方技术报告开始把「零 loss spike」当军功章写在摘要边上，而 Meta 用一份诚实
的中断账告诉大家头部集群的真实运行面貌。面试里这条线的标准走位是：

1. 先给**事故分层**：数值面（logit 爆炸、精度累加外溢）＞ 优化器状态 ＞ 数据
   坏 batch ＞ 硬件坏卡——每层各配一个官方背书案例。
2. 再给**先行指标**：grad norm 突增领先 loss spike 几步（GLM-130B 原文），
   logit 上限与 entropy/KL 分列预训练侧与 RL 侧观测量。
3. 然后给**对症手段**：EGS 梯度收缩、QK-Clip 封顶、skip 坏 batch。
4. 最后给**恢复 runbook**：回退最近好 ckpt → 跳过坏 batch → WSD 稳定段任意点
   冷启，全程带数字（Llama3 中断账、GLM 三次发散）。

<div class="diagram-embed">
<iframe src="assets/diagrams/rl-loss-stability.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/rl-loss-stability.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、军功章对照组：零 spike 声明 vs Llama3 的中断账

「无 spike、无回滚」已经成了头部技术报告的标准军功章，而对照组是同样官方
口径的大型集群事故实录。两组数字放一起，就是面试开场白。

### 2.1 正面：两次官方零事故声明

- **DeepSeek-V3 全文两次声明**训练全程「未经历任何不可恢复的 loss spike、未
  执行任何回滚」（DeepSeek-V3 技术报告，2024-12，原文摘要与正文各一次的
  措辞，官方口径）。注意是**两次声明**，引用时说「摘要和正文各写了一次」
  比笼统一句更可信。
- **Kimi K2 宣称十五点五万亿 tokens 预训练全程零 loss spike**（Kimi K2 技术
  报告 v1，2025-07，官方口径，原文 "without a single loss spike"）。这句话
  与第五节的 QK-Clip 是同一份报告的一体两面：军功章是它，机制也是它。

### 2.2 对照组：Llama 3 的四百六十六次中断

Meta 在 Llama 3 论文里给了头部训练集群最诚实的一份运行账（Llama 3 论文
Sec.3.4，2024-07，官方口径）：

- 405B 预训练 **五十四天快照窗口内共发生四百六十六次 job 中断**（官方口径）。
- 其中**计划内四十七次、意外四百一十九次**（官方口径）——背数字时必须拆开，
  「四百六十六次全是意外」是错的（勘误见文末）。
- **意外中断中约七八成归因于确认或疑似硬件问题**，GPU 是最大类别（官方口径）。
- 即便如此，**有效训练时间仍超过九成**（官方口径）——这就是自动容错体系的
  价值锚点。

面试含义：训练框架篇说的「约八成是工程问题」这句定性口径，在这里有了官方
数字武器——**意外中断的硬件归因约七八成**（Llama 3 论文，2024）可直接引用。
Llama3 的应对不是靠人盯，而是 NCCLX flight recorder + heartbeat 触发的
**自动** dump 与逐 rank 定位，这是集群监控 breaker 的范型（详见第九节）。

### 2.3 成本锚：DSV3 的训练账单

既然谈到「零回滚」值多少钱，顺手背 DSV3 全量训练成本（含 post-train）：
**约二百七十八点八万 H800 GPU 时、账面约五百五十七点六万美元、十四点八万亿
tokens**（DeepSeek-V3 技术报告 Table 1，2024，官方口径）。零 spike 军功章
的潜台词是：这份账单里**没有一分钱花在回滚重跑上**。

## 三、前兆在 grad norm：GLM-130B spike 实录

GLM-130B 是目前公开文献里**最完整的 loss spike 实录**（GLM-130B 论文，
2022-10），它的价值不在「也崩过」，而在把崩溃的前兆、病灶和对策全写了
出来，是目前唯一能逐条背下来的机制细节。

### 3.1 病灶：embedding 层梯度异常

- 架构选型是 **DeepNorm-PostLN**——这是 GLM-130B 稳定性的结构底座。
- 实测现象：**早期 embedding 层的梯度 norm 常比其他层高若干数量级**
  （GLM-130B 论文，2022），这是它的专属病灶。
- 精度相关 spike（fp16/bf16 取舍引起）有的会自愈，有的遵循固定剧本：
  **先 grad norm 突增，滞后几步之后 loss spike 甚至 NaN**（GLM-130B 论文，
  2022）。这句话直接把 grad norm 提到「领先指标」的位置——告警体系要盯
  的不是 loss，是 grad norm。

### 3.2 对策：EGS 梯度收缩

EGS（Embedding Layer Gradient Shrink）的公式一行能写：

```
emb = emb*α + emb.detach()*(1-α)      # α = 0.1
```

即前向用全量 embedding、反向只放一成梯度给 embedding 层，**工程开销官方
定性为可忽略**（GLM-130B 论文，2022）。效果：EGS 消掉了绝大多数 spike，
**最终整轮训练只发生三次后期 loss 发散**（硬件故障另计，GLM-130B 论文，
2022）。

### 3.3 同时代反面教材

GLM-130B 论文点名了两位同场玩家的处理手段作对比（均为 GLM-130B 转述，
转述内容已核实）：

- **OPT-175B 靠人工跳数据、调超参硬扛**；
- **BLOOM-176B 靠给 embedding 加 norm（embedding norm）救场**。

三家的对比正好说明同一个病灶的三种解法：收缩梯度（GLM）、人工跳过（OPT）、
归一化压制（BLOOM）。面试被问「embedding 层为什么特殊」时按这个三家谱系
答。

## 四、FP8 的一二八修正律：高精度累加与五件套

DeepSeek-V3 把 FP8 训练从「敢不敢用」变成「按什么律用」。核心是一套
围绕 **一百二十八这个数字**的修正机制，背下来就是面试里区分度的来源（DeepSeek-V3
技术报告 Sec.3.3，2024）。

### 4.1 矛盾：Hopper 的 FP8 累加精度受限

矛盾的原文句子：**在 Hopper GPU 上 FP8 累加精度受限（约十四位，仅保留八位
指数与尾数对齐后的有效位），约束了训练精度**（DSV3 报告 Sec.3.3.2，2024，
官方口径）。也就是说 Tensor Core 内部的部分和是低精度累加的，模型一大、
序列一长，误差会攒出来。

### 4.2 修正律：每隔一百二十八次 MMA 提升一次精度

- **每一百二十八次 MMA，就把 Tensor Core 的半精度部分和提升（promote）到
  CUDA Core 的 FP32 寄存器做全精度累加**（DSV3 报告，2024，官方口径）——
  报告里这个间隔记作 N_C=128，面试直接说「N_C 等于一百二十八」。
- **量化粒度是激活一乘一百二十八 tile、权重一百二十八乘一百二十八 block**
  （DSV3 报告，2024），配合在线量化：细粒度缩放把异常值的影响限制在小块
  内，不让一个 outlier 污染整张张量的 scale。

### 4.3 五件套保原精度

FP8 只铺在算力大头（GEMM）上，**精度敏感的五个组件全部保持原精度
（BF16/FP32）**：embedding、output head、MoE gating、normalization、
attention（DSV3 报告，2024）。推论要记住：**共享的 MTP 头与 output head 同源，
同样留在原精度轨道上**——面试问 MTP 精度时，不要再掂「量化头」这种说法。

### 4.4 验证：一万亿 token 消融

**约一万亿 tokens 的消融下，FP8 训练相对 BF16 的 loss 相对误差持续低于
百分之零点二五**（DSV3 报告，2024，官方口径，在随机性容差范围内）。这是
「FP8 不崩」唯一的官方量化证据，口径要念全：消融规模、相对误差、对比
基准三者缺一不可。

### 4.5 别踩的坑：Qwen3 的 FP8 是推理侧

**Qwen3 官方的 -FP8 checkpoint 用「块大小一百二十八」的细粒度量化，但那
是推理侧 PTQ，不是训练侧**（Qwen3-235B-A22B-FP8 model card，2025，官方
口径）。面试里把「Qwen 预训练用了 FP8 训练」说出口就翻车——证据只支持
「Qwen 发了 FP8 推理 checkpoint」。

## 五、attention logit 爆炸与 QK-Clip

2025 年的新官宣 stability killer 是 **attention logit 爆炸**，官方完整数字
来自 Kimi K2（K2 技术报告 v1，2025-07）。

### 5.1 起因：Muon 把 logit 推出了旧假设

K2 在中尺度实验中观察到：**换用 Muon 优化器后，attention logits 迅速涨破
一千**（K2 报告，2025，官方口径），且 logit 爆炸与 MoE 稀疏化程度的增长
同步出现——现代优化器把 attention logit 的量级推到了传统工程假设之外，
这是「QK-Norm 不够用了」的官方注脚。

### 5.2 QK-Clip 咬字集

对策 QK-Clip（含在 MuonClip 里）的全套数字一次背齐（K2 报告 v1 Fig.2，
2025，官方口径）：

- **以一百度为封顶阈值（τ=100）裁剪每步的 attention logits**，训练中 logits
  逐步回落到常规区间，**全程不需要调 τ**；
- **至少被触发过一次的 head 占百分之十二点七**；
- **τ=30 的激进裁剪消融对 loss 轨迹的影响可忽略**——说明这个帽子的安全边际
  很宽，钳的是尾部而不是主体。

再强调一次：救场的是 QK-Clip 而不是 μP。「K2 用了 μP」是社区误传（详见下
一节勘误）。

## 六、μP 信仰与现实：采用度实测

μP（Maximal Update Parametrization）主张让所有量随宽度呈 Θ(1) 标度，从而
超参数可以从小模型零样本迁移到大模型，理论出自 **Tensor Programs V
（Microsoft，2022）**。它的社区采用度可以一句话概括：**有正宗信徒、旗舰
缺席**（2026-10-12 对旗舰报告全文检索实测）。

### 6.1 正面实证

- **Cerebras-GPT 用 μP 做了从一百一十兆到一百三十亿参数的超参外推**（2023，
  摘要口径），并自称「第一个开放且可复现」的此类工作；
- **MiniCPM 在模型风洞（MWTE）里用 μP 做超参搜索**（MiniCPM 论文 3.1 节
  与附录 A.1，2024），与下文 WSD 是同一份报告里的组合拳。

### 6.2 旗舰缺席

**DeepSeek-V3、Kimi K2 的技术报告正文全文检索均无 μP 踪迹**（2026-10-12
实测检索；GLM-130B、Llama3 正文级亦无实攻痕迹）。K2 的稳定性方案最终
选了工程味十足的 QK-Clip——这是「归一化信仰派（μP 从根上消掉 logit 增长）
vs 实用派（τ=100 直接封顶）」路线分歧的实证。面试被问「μP 到底实不实用」：
理论好感强、有两家公开实证，但旗舰线缺席，回答时点出这条分歧即满分。

## 七、WSD 与恢复自由度

WSD（Warmup-Stable-Decay）调度对稳定性的意义不在曲线形状，而在**事故恢复
的自由度**（MiniCPM 论文 Sec.4.3，2024）：

- **decay 段占总量的十分之一就足够，四十分之一（百分之二点五）则不足**
  （MiniCPM 论文，2024，官方口径）；
- **模型风洞里零点三六亿（0.036B）参数的小模型就能扫描超参、拟合一点七亿
  （0.17B）的行为**（MiniCPM 论文 Fig.6，2024）；
- K2 报告同样在预训练中使用了 WSD（K2 报告，2025）。

稳定含义是：**在 stable 阶段，任意 checkpoint 都可以随时接一个 decay 小段
收尾**，天然适合超长周期训练的事故回退重跑——decay 段本身能「压平」loss
收敛行为，恢复窗口可以选 stable 末段任意点，**不必迁就 cosine 的相位**。
代价是对齐账：不同 decay 起点的模型评测不可直接比，进度报告里要有数。

## 八、RL 侧的 loss spike：MiniCPM-4 四件套

RL 训练的 loss spike 与预训练**不是一回事**，告警阈值要分域（MiniCPM-4
技术报告 arXiv:2506.07900，2025）：

- 病灶：**部分 off-policy 由 chunk-wise rollout 引入，轨迹方差变大直接引发
  训练 loss spike**（MiniCPM-4 报告，2025，官方口径）；
- 对策四件套：**以 dual-clip（Ye et al. 2020）、chunk 级重要性采样、KL loss、
  garble filter**（MiniCPM-4 报告，2025）。

配套两句话：仓内 [verl深度拆解](./verl深度拆解.md) 已核实 verl 的
TIS（token 级重要性采样）上界设为 2.0；算法信号层的坑（reward hacking、
entropy collapse、动态采样、DAPO 的 ε 解耦）在
[rl训练工程实战](./rl训练工程实战.md) 与
[推理模型训练专题](./推理模型训练专题.md) 已写全，本篇不重复。

**勘误必须记住**：网上流传的「MiniCPM 官方论文有 spike 处理段落」是错的——
MiniCPM v1（arXiv:2404.06395）全文检索**没有** loss spike 内容（2026-10-12
实测），v1 的稳定性贡献是 WSD 与模型风洞；真正的「off-policy 导致 spike →
四件套」出自 MiniCPM-4 报告。引用时别张冠李戴。

## 九、监控告警骨架与恢复 runbook

把前面所有官方案的监控手段拼起来，就是一套可以直接讲的告警骨架：

1. **grad norm 是领先几步的先行指标**（GLM-130B 原文）——告警第一优先级，
   别等 loss；
2. **logit 上限是预训练侧观测量**（K2 的 QK-Clip 观测量口径）；
3. **entropy / KL 是 RL 侧健康线**（DAPO 四故障的监控经验，见推理模型训练
   专题）；
4. **逐 rank loss 定位坏卡**：Llama3 的 NCCLX flight recorder + heartbeat
   触发自动 dump，是「breaker 范型」——讲述时强调**自动**而不是人盯
   （Llama 3 论文，2024）。

恢复 runbook 三件套，按顺序背：

1. **跳过坏 batch**（代价见工程议题：optimizer state 已被污染，恢复窗口要
   往前推多少步没有公开数值）；
2. **回退最近的好 checkpoint**；
3. **用 WSD 稳定段任意点重启**，decay 一成收尾——不用迁就 cosine 相位。

## 十、工程议题（面试可深挖）

1. **skip bad batch 的识别与代价**：GLM 与 Llama 都「跳过可疑 batch」，但
   momentum 与 optimizer state 已经含污染，恢复窗口要往前推多少步，公开
   文献没有数值——这是工程取舍牌，被追问就诚实说「无公开口径」。
2. **FP8 promote 的吞吐代价**：把部分和搬到 CUDA core 有寄存器拷贝开销，
   DSV3 只给了「成本可忽略」的原文定性、无数字——面试可以反问「你们家
   N_C 怎么选」。
3. **QK-Clip 的 τ vs μP**：τ=100 是滑动门缓冲，μP 是从归一化上消除 logit
   增长；K2 用前者弃后者，是优化器学派分歧的证据。
4. **WSD 恢复自由度 vs 评测一致性**：stable 段随时可 decay 重跑，但不同
   decay 起点的模型评测不可直接比，进度与对比实验分开记。
5. **RL spike ≠ 预训练 spike**：MiniCPM-4 把部分 off-policy 的轨迹方差
   spike 单独成段，告警阈值必须分域设定。
6. **breaker 设计**：flight recorder + heartbeat 自动 dump 是集群监控范型，
   落地叙述重在「自动」，人盯屏幕的 runbook 不是卖点。

## 十一、数字锚总表

| 数字 | 含义 | 口径 |
|---|---|---|
| 466 / 47 / 419 / 约 78% / >90% | Llama 3 405B 五十四天窗口：中断总数 / 计划内 / 意外 / 意外中硬件归因 / 有效训练时间 | Llama 3 论文 Sec.3.4，2024，官方口径 |
| 两次原文声明 | DSV3 预训练无不可恢复 spike、无回滚 | DSV3 报告摘要与 Sec.4，2024，官方口径 |
| N_C=128 / 1×128 / 128×128 | DSV3 FP8 高精度累加间隔与激活 tile / 权重 block 粒度 | DSV3 报告 Sec.3.3.2，2024，官方口径 |
| <0.25% | FP8 vs BF16 约一万亿 token 消融 loss 相对误差 | DSV3 报告 Sec.3.3，2024，官方口径 |
| 2.788M GPU 时 / $5.576M / 14.8T | DSV3 全量训练成本（含 post-train） | DSV3 报告 Table 1，2024，官方口径 |
| 3 次 / α=0.1 / 滞后几步 | GLM-130B：后期发散次数 / EGS 收缩因子 / collapse 滞后 grad norm | GLM-130B 论文，2022，官方口径 |
| >1000 / τ=100 / 12.7% / 15.5T | K2 QK-Clip：logit 破千 / 封顶阈值 / 触发 head 占比 / 零 spike 训练量 | K2 报告 v1 Fig.2，2025，官方口径 |
| 10% vs 2.5% / 0.036B→0.17B | MiniCPM WSD：decay 占比充分 vs 不足 / 风洞拟合 | MiniCPM 论文 Sec.4.3，2024，官方口径 |
| block size 128 | Qwen3 官方 FP8 checkpoint 量化粒度（**推理侧 PTQ**） | Qwen3-235B-A22B-FP8 model card，2025 |
| dual-clip 等四件套 | MiniCPM-4 治 off-policy rollout spike | MiniCPM-4 报告，2025，官方口径 |

## 七·增、A2 速记：4-bit NVFP4 RL

- **#59 逆量化反向 + 4/6 块缩放**：对齐前先做向量化决策；4/6 误差
  **1/6→1/8**；PTX **2.8×**；FP4/FP8 相关系数 **0.924**。
- 面试点：低精度 RL 的难点在反向，不在前向；逆量化要保证梯度尺度，
  否则 advantage 被量化噪声淹没。

## ▶ 面试题

**Q1（高频）：你们训练崩了怎么救？**
期望答出完整链路：事故分层（数值/优化器/数据/硬件各配一个官方案例）→ grad
norm 先行指标（GLM 原文「领先几步」）→ 对症（EGS α=0.1 / logit 帽 τ=100 /
skip batch）→ 恢复 runbook（回退 ckpt、WSD 稳定段冷启）。深度提示：全程带
数字——Llama3 中断账、GLM 三次后期发散；结尾补一句「意外中断约七八成赖
硬件，所以 breaker 要自动化」。

**Q2（高频）：FP8 训练为什么不崩？**
期望答四点：N_C=128 的 promote 修正律；激活 1×128 / 权重 128×128 细粒度
缩放；五件套保原精度（embedding / output head / MoE gating / norm /
attention）；约一万亿 token 消融相对误差低于百分之零点二五。深度提示：
主动补 MTP 头同源留原精度、Qwen3 -FP8 是推理 PTQ 的边界，直接封神。

**Q3（高频）：大模型 loss spike 的最大来源是什么？**
期望分层回答：数值面（logit 爆炸 / 累加外溢）、数据面（坏 batch）、硬件面
（Llama3 意外中断约七八成硬件归因），每层给一个官方案例。深度提示：别只
答「数据脏」——2025 年后官方报告的主角是数值面。

**Q4（中频）：grad norm 为什么是领先指标？**
期望答：GLM-130B 实测剧本「grad norm 突增 → 滞后几步 → loss spike 甚至
NaN」，embedding 层早期 grad norm 比其他层高若干数量级是病灶。深度提示：
顺手给 EGS 公式 emb = emb·α + emb.detach()·(1−α)，α=0.1 成本可忽略。

**Q5（中频）：μP 到底实不实用？**
期望答：理论出自 Tensor Programs V（2022）；公开实证是 Cerebras-GPT
（111M→13B，2023）与 MiniCPM 风洞（2024）；DSV3 与 K2 旗舰报告全文检索
均无 μP（2026-10 实测），K2 选了 QK-Clip。深度提示：点出「K2 用 μP」是
社区误传——这是区分「刷过社区帖」和「读过原文」的题眼。

**Q6（中频）：RL 的 loss spike 和预训练有什么不同？**
期望答：源不同——RL 侧是部分 off-policy 的轨迹方差与 reward 侧信号；对策
是 MiniCPM-4 四件套（dual-clip / chunk 级 IS / KL / garble filter），监控
要盯 entropy/KL/长度而不只是 loss。深度提示：纠引用——这套出自 MiniCPM-4
报告而不是 MiniCPM v1。

**Q7（中频）：长周期训练的 checkpoint 与调度怎么设计才扛崩？**
期望答：WSD 三段式，decay 占一成足够、百分之二点五不足；stable 段任意点
可接 decay 收尾，恢复不必迁就 cosine 相位；代价是不同 decay 起点评测不可
直接比。深度提示：K2 预训练也用 WSD，风洞 0.036B 即可扫超参。

**Q8（低频）：零 spike 军功章到底值多少？**
期望答：DSV3 两次原文声明 + K2 十五点五万亿 tokens 零 spike 的对照背法，
顺手给 DSV3 全量成本（约二百七十八点八万 H800 GPU 时 / 约五百五十七点六
万美元 / 十四点八万亿 tokens），点出「账单里没有回滚重跑的钱」。

## 口径与未核实说明

**勘误（素材已注明，写作与面试引用时按此口径）：**

- 「MiniCPM 官方论文有 spike 处理段落」不成立：MiniCPM v1（arXiv:2404.06395）
  全文检索无 loss spike 内容（2026-10-12 实测），其稳定性贡献是 WSD 与模型
  风洞；off-policy spike 与四件套出自 MiniCPM-4 报告（arXiv:2506.07900，
  2025）。
- 「K2 用了 μP」属社区误传：K2 报告全文无 μP，稳定性方案为 MuonClip
  （QK-Clip）。任何把 μP 与 K2 绑定的说法均不采用。
- 「Qwen 预训练用了 FP8 训练」无证据：「块大小一百二十八」口径来自 Qwen3
  官方 -FP8 **推理 checkpoint** model card（PTQ），非训练侧。
- 「Llama3 四百六十六次全是意外中断」错误：原文口径为四百六十六次总数
  等于四十七次计划内加四百一十九次意外。

**未核实单列（正文未作事实引用，被追问时如实交底）：**

- Llama 3 Table 5 各中断类别的细分百分比未提取，只核到「GPU 是最大类别」
  与约七八成硬件归因总量。
- DSV3「promote 到 CUDA core 的开销可忽略」为原文定性表述、无数字；N_C
  的吞吐代价只能答定性。
- Fireworks 等社区在微调场景应用 µTransfer 的案例未逐一核实。
- K2 报告本次核验用 v1 原文；v2 是否有增补未比对。
- OPT-175B 的具体 restart 次数、BLOOM-176B 的中断统计未独立核实（两者的
  spike 处理手段为 GLM-130B 论文转述，转述内容已核实）。

## 串联阅读

- [训练框架与稳定性](../distributed-training/训练框架与稳定性.md)：排查流程、
  SDC 坏卡定位、容错三层——本篇给它补官方事故的数字与原文。
- [rl训练工程实战](./rl训练工程实战.md)：reward hacking、entropy collapse 等
  算法信号层的坑，本篇只补数值层四件套。
- [推理模型训练专题](./推理模型训练专题.md)：DAPO 消融阶梯与 K2 零 spike 一句
  话——本篇把那句话展开成 QK-Clip 全套数字。
- [moe架构](../llm基础/moe架构.md)：aux-loss-free bias、sigmoid 路由与负载
  均衡——router 之外的数值杀手（logit 爆炸）在本篇。
- [量化与压缩](../inference/量化与压缩.md)：FP8/INT8 的推理 PTQ 选型视角，
  与本篇训练数值视角互补。
- [muon与优化器](./muon与优化器.md)：Muon/MuonClip 机制推导，本篇只引用其
  稳定性结论。
- [mimo训练栈复盘](./mimo训练栈复盘.md)：小米 MiMo 训练栈专篇，本篇不再
  展开。
