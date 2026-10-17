# Agentic RL 专题：从单轮 RLVR 到多轮轨迹可验证

> **面向**：已读过 [rl环境工程专题](./rl环境工程专题.md)（环境侧）与
> [rl训练工程实战](./rl训练工程实战.md)（训练坑）、准备「Agentic RL /
> Agent 训练侧」追问线的读者。本篇是训练主线在 agent 场景的延伸：环境那篇
> 讲「环境怎么造、怎么调度」，本篇讲「轨迹怎么训、credit 怎么分」。
>
> **读完获得**：① 一句话主线——Agentic RL 的真正难点从 reward 来源转移到
> credit assignment 与系统工程；② GRPO 搬到多轮的三条缺口与三种 reward
> 粒度取舍；③ 2025-2026 四家工业配方（DeepSeek-V3.2 / Kimi K2 / GLM-5 /
> Qwen3-Coder）的逐项对比表与各自一个「可当场引用」的细节；④ 工具调用
> SFT/RL 分工话术（SFT 教格式、RL 教策略）；⑤ coding agent 训练谱系
> （SWE-RL → DeepSWE）与 23→42 数字锚；⑥ 七条工程议题；⑦ 8 条面试题
> 的完整答法。
>
> **时效口径**：以 **2026-10** 为截点，素材时间轴从 2025-07 Kimi K2 到
> 2026-02 GLM-5；官方报告/模型卡数字均括注来源，论文自述提升幅度与未核实
> 项一律标明，见文末「口径与未核实说明」。

## 〇、Agentic 三阶段训练管线总览（CPT → SFT → RL）

进正文前先把地图放平：Agent 模型的训练不是「SFT + RL」两段，而是**三
阶段管线（CPT → SFT → RL）**，各段的目标、数据形态与掩码口径完全不同：

| 阶段 | 目标 | 数据形态 | 掩码 / loss 口径 |
|---|---|---|---|
| CPT（持续预训练） | 注入工具使用与环境交互先验：调用格式、常见 API 签名、文件系统 / 终端语感 | 含 tool call 格式与 observation 文本的大规模语料（文档、代码工单、合成轨迹混合） | 标准 next-token 全量回灌，基本不 mask |
| SFT | 轨迹蒸馏，学「这一步该做什么动作」而非照抄工具返回 | 带角色分段的多轮轨迹（prompt / action / observation / action …），强模型蒸馏或人工标注 | observation token **必须被 mask 掉**，只在 prompt 与 action token 上算 loss |
| RL | 在线 rollout 中按结果奖励 + 过程奖励调策略，学代价写不出来的取舍 | 真实环境跑出的整条轨迹（本文件正文的主战场） | 只对模型自采样的 action token 算 policy gradient；observation 天然不进 loss |

**为什么 Agent 要单设 CPT 阶段**：基模预训练语料里几乎没有 tool call
的语法、文件系统 / 终端长程交互的样本，模型连「函数参数长什么样、
observation 之后该接什么」的先验都没有——指望 SFT 的小数据量同时教
格式和策略，格式先学崩。CPT 先把先验打平，SFT 才能专注教动作选择。

三阶段联动一句话：CPT 教先验、SFT 教动作、RL 教取舍——本文其余章节
（第二章起的 credit assignment 与 reward 粒度）都是在回答第三阶段
「取舍怎么教」的问题。

最后收一条必被追问的题：**「SFT 为什么要 mask observation tokens」的
一句话答案**——observation 是环境返回、不是策略要学的分布，让它进
loss 等于纵容模型学着生成工具返回：既污染动作分布，又白白烧掉一大半
loss 面。三种构造方式与完整推导见
[多轮对话 loss mask 专题](./多轮对话loss-mask专题.md)；RL 侧「observation
不进梯度但占上下文」的系统后果即本文件第一节的第三个本质差异。

## 一、直觉：单轮 RLVR 推广到多轮轨迹

单轮 RLVR 的画面很简单：模型一次回答，规则一次打分（数学对答案、代码过
单测），GRPO 组内算优势，一条样本一次梯度。**所谓 Agentic RL，就是把同一个东西
推广到多轮轨迹**：模型跑一条 τ=(s₀,a₀,…,s_T)，中间穿插几十上百次工具
调用，环境状态持续演化，只有终点拿到一个 0/1 验收信号。

听起来只是「步数变多」，实际上有三个本质差异：

1. **决策序列长一到两个数量级。** K2 Thinking 官宣可稳定连续工具调用
   **两百到三百轮（HF 模型卡口径）**，而旧模型 30–50 轮就退化。序列一长，
   优势分配、显存、rollout 时长全部变形。
2. **Reward 稀疏但有组合性。** 一步漏调工具、参数填错一个字段，后面全对
   也是 0。这不是普通稀疏——是「组合爆炸的稀疏」，credit 分不清是哪一步
   砸了。
3. **观测里混进大段非策略 token。** 工具返回（observation）占掉上下文
   大头，却不产生梯度——它们不参与 loss，但占 KV、占 log-prob 对齐位置，
   还制造「重分词边界」这个坑（GLM-5 的 TITO 就是为它而生）。

所以本篇的一句话主线：**难点已经从「reward 从哪来」转移到「credit
怎么分」和「系统怎么撑」。** 2025-2026 四家主流量产配方没有一家
发明了新算法，全是同一套三件套——GRPO 变体 + 大规模可验证环境 + 异步
rollout 基建。差别只在三件套的各自配比。

<div class="diagram-embed">
<iframe src="assets/diagrams/agentic-rl.html" width="100%" height="980" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agentic-rl.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、Credit Assignment：GRPO 的多轮缺口

### 2.1 GRPO 搬到多轮，三条缺口当场暴露

GRPO 的优势是 Â = R_i − mean（组内），「组」是同一 prompt 采的 G 条完整
轨迹。单轮时这套没问题；多轮时当场暴露三条缺口：

- **步级优势被压成同一标量。** 几十步操作共享一个轨迹级优势，好步和烂步
  同奖同罚——这就是 credit assignment 退化的形式化描述。
- **轨迹长度差异巨大。** 有的轨迹 5 步收工，有的 200 步才失败，效率与噪声
  天差地别，却被塞进同一个组内均值基线。
- **全 0 组（以及全 1 组）直接零梯度。** 稀疏奖励下，一个 prompt 采 G 条
  全部失败是常态，组内方差为 0，优势恒 0，整条 rollout 纯烧钱。

### 2.2 三种 reward 粒度的取舍坐标轴

| 粒度 | 代表 | 优点 | 死穴 |
|---|---|---|---|
| token 级 | 过程奖励模型 PRM | credit 最细 | 太密、最易被 hack、标注最贵 |
| 轮级/步级 | GiGPO anchor-state 分组 | 不引 critic、不加 rollout | 依赖环境状态可复现 |
| 轨迹级 outcome | DeepSWE / V3.2 | 无偏、verifier 最便宜 | 方差大、信用模糊 |

工业界的答案出奇一致：**轨迹级 outcome + 硬 verifier，然后拿 scale
硬堆**。轮级中间信号只在 verifier 便宜时加（每轮 schema 校验、格式扣分
这类规则信号），token 级基本没人用——坐标轴是「可验证度 vs hack 风险」。

### 2.3 学术侧答案：GiGPO 的两级优势

GiGPO（arXiv:2505.10978, NeurIPS 2025）不绕过问题，正面补缺口，**提出
episode 级加 anchor-state 步级的两级优势**。核心观察是不同轨迹会落到同一个环境
状态（anchor state），把这些状态上的 action 聚成一组算步级相对优势——不
引 critic、不加 rollout、显存不变。论文自述相对 GRPO 在 ALFWorld 提升约
十二个百分点、WebShop 约九个百分点（均为论文口径，非独立复现）。

面试被追「GiGPO 还是 turn-level value model」时，标准答案是看环境状态
重复率：搜索/网页任务里状态几乎不重复，anchor-state 分组退化成单点组，
等于白分；value model 方差低但要多训一个模型，轮级 value 标注来自蒙特
卡洛回报，成本乘轨迹数。

### 2.4 反面证据：RAGEN/StarPO 与 Echo Trap

RAGEN/StarPO（2025）提供了「光靠加环境不够」的反面证据：**没有
reasoning-aware 的细粒度信号，多轮 RL 训不出真推理**——模型学出浅策略，
 internally 出现「幻觉想法」（与观测脱节的内心独白）。训练中还会反复踩
**Echo Trap：奖励方差骤降伴随梯度尖峰**，需要 StarPO-S 的轨迹过滤 +
梯度稳定机制兜底。这条线的教训可以直接背诵：多轮 RL 不是「单轮 RLVR
×N」，稳定性机制是配方的一部分，不是可选项。

## 三、2025-2026 工业配方对比

四家的官方报告都遵循同一个判断，**即 Agent RL 的瓶颈在环境扩展与系统
工程，不在算法。** 先把总表立起来，再逐家拆一个能当场引用的细节。

| 维度 | DeepSeek-V3.2（2025-12） | Kimi K2（2025-07） | GLM-5（2026-02） | Qwen3-Coder（2025-07） |
|---|---|---|---|---|
| 底座/规模 | V3.2 系列 | 1T 级 MoE | 744B-A40B / 28.5T token | Qwen3-Coder-480B-A35B |
| 环境口径 | 合成 1,827 环境 / 4,417 任务 / 85,000 prompt | 3,000+ 真实 MCP 工具 + 20,000+ 演化合成工具 | 1 万+ 可验证 SWE/terminal 环境 | 2 万个并行独立环境 |
| 算法骨架 | GRPO + 无偏 KL + 高 KL 负样本 mask | RLVR + self-critic rubric reward | group-wise + 双侧 IS 裁剪 | 先 scale Code RL 再做 Agent RL |
| 异步策略 | **半同步**：批内多 mini-batch | Gym 式可扩框架 | **全异步 slime**：每 K 次更新推权重 | 依托阿里云 2 万环境并行 |
| 招牌数字 | SWE-bench Verified 67.8（换 harness 72–74） | Tau2-Bench 66.1；Verified 65.8 单次 / 71.6 并行 TTC | 并发 rollout >1k；相对 GLM-4.7 平均高约 20% | 「hard to solve, easy to verify」 |
| 报告 | arXiv:2512.02556 | arXiv:2507.20534 | arXiv:2602.15763 | 官方 blog |

### 3.1 DeepSeek-V3.2：合成环境的增益来自「泛化」

V3.2 的环境生成 agent 产出 ⟨environment, tools, task, verifier⟩ 四元组，
判据一句话——**难做、易验**。1,827 个环境用 pass@100>0 过滤难度，把「全
败组」挡在训练集外。code agent 侧从 issue-PR 对挖出数万可复现环境、覆盖
8 种语言。

最值得背的是这条消融：**只在合成 agent 数据上训 RL（非 thinking），
Tau2 / MCP-Mark 这类未见工具集大涨；只在 search+code 环境训则不涨。**
也就是说合成环境 RL 的增益来自泛化而非背题——这直接回答了「合成环境会
不会和评测集同分布过拟合」这个追问。工程上还有两个细节：reasoning /
agent / 对齐合并成一个 RL 阶段避免多阶段遗忘；后训练算力 > 预训练的
百分之十。官方也承认了暗坑：模型出现**冗余自我验证**导致轨迹超长，128K
窗口下 20%+ 的 BrowseComp 用例溢出，靠外部 context management 补救。

### 3.2 Kimi K2：SFT 侧大规模 agentic 合成，RL 侧 rubric 闭环

K2 的分工很干净：**先看 SFT 侧**。3,000+ 真实 MCP 工具 + 演化出 20,000+ 合成
工具，任务带显式 rubric，工具模拟器（功能上等价 world model）注入受控
随机性——成功、部分失败、边界情况都有；LLM judge 按 rubric 过滤，只留
达标轨迹，包括「自然失败又恢复」的纠错样本。**再看 RL 侧**：RLVR 加
self-critic rubric reward——模型自己成对比较打分；rubric 分核心 / 反 hack / 人工
三层；critic 用 RLVR 的 on-policy rollout 持续闭环校准，等于**把可验证
信号蒸馏回主观判断**。对指令遵循额外加 hack-check 检测层，专打虚假声明
完成。K2 Thinking 官宣：SWE-bench Verified 71.3、HLE w/ tools 44.9、
BrowseComp 60.2，并可稳定连续调用工具 200–300 轮（均为官方口径）。

### 3.3 GLM-5：异步 Agent RL 的偏差控制三件套

GLM-5（744B-A40B，28.5T 预训练 token）把「全异步」做成了主线：rollout
引擎与训练引擎解耦，每 K 次梯度更新才推一次权重。异步引入 off-policy，
它的答案是把偏差控制做成显式组件：

1. **TITO（token-in-token-out）**：训练端直接消费推理引擎产出的原始
   token 流，消除「解码成文本再重分词」造成的 action 边界错位——工具调用
   JSON、特殊 token 处最容易错。
2. **Direct Double-sided IS**：rollout 的 log-prob 做 token 级双侧裁剪
   [1−ε_l, 1+ε_h]，不保存历史策略 checkpoint 也控住 off-policy 偏差。
   长轨迹上 IS 比值连乘会指数漂移，token 级裁剪正是对此的回答。
3. **权重推送后重置 optimizer**：配合「每 K 次更新同步一次 rollout 权重」
   的近似 on-policy 节奏，清掉跨版本的动量污染。

还有一个数字层面的坑可以直接引用：DSA indexer 若用非确定性 CUDA/TileLang
top-k，RL 几步内性能骤降并伴随熵崩塌；换成确定性 torch.topk 并**在 RL
中冻结 indexer** 才稳定（MoE 沿用 routing replay 同理）。Reward 侧用
rule / ORM / GRM 混合——ORM 低方差但最易被 hack，GRM 抗 hack 但高方差，
混合中和。环境 1 万+ 可验证 SWE/terminal 场景，并发 rollout >1k。

### 3.4 Qwen3-Coder：把「环境扩展」单点打穿

Qwen3-Coder 的方法论口号是 hard to solve, easy to verify，路径是**先
scale 单轮 Code RL（自动扩测试用例），再做 long-horizon Agent RL**。最
有分量的一句官方判断：Agent RL 的瓶颈在环境扩展而非算法——他们用
2 万个并行独立环境（依托阿里云）跑 SWE 式多轮交互训练，把这句话变成了
产能。

### 3.5 Polar（NVIDIA）：不动 Harness 的 Agentic RL——模型 API 边界就是训练接口

口径：NVIDIA 论文 Polar: Agentic RL on Any Harness at Scale（2026-10
公众号解读帖全文转录，官方一手未读，数字转述）。

一句话：**能不能不打开盒子就训 Agent**。常规路线要么把 Agent 执行
嵌进 RL 设施（SkyRL-Agent/PRIME-RL），要么要求 Agent 遵循标准追踪
接口（Agent Lightning/rLLM）——每接入一个 Harness 就一次专用集成，
闭源二进制分发的框架更无从下手。Polar 反过来在 **Agent 与推理服务
之间插一个 API 兼容 Proxy**：转发模型调用、记录 prompts、采样 token
与 logprobs，在 Harness 外部重建训练就绪的轨迹——Agent 是黑盒但仍
可训。

- **架构两件**：Rollout Server（收 TaskRequest 扩 N 个独立 session、
  管生命周期与异步端点）+ Gateway Node（起 Runtime、跑 Harness 命令、
  从捕获的 completions 重建轨迹、评估、回收，兼宿 Proxy 端点）。
- **四池阶段隔离**：INIT Pool 起 Runtime → READY Buffer 缓冲已初始化
  Runtime → RUNNING Pool 跑 Agent → POSTRUN Pool 重建轨迹+评估+回收。
  Runtime 预热与评估器预热都不在关键路径——CPU 密集的环境准备与
  GPU 密集的 rollout 解耦，跑当前任务的评估器在后台预热下一个。
- **数字**：Qwen3.5-4B 加朴素 GRPO，SWE-Bench Verified 上四种 Harness
  分别 +22.6（Codex）、+4.8（Claude Code）、+0.6（Qwen Code）、
  +6.2（Pi）个百分点——一次训练跨四种 Harness 复用；Codex 档的
  22.6 说明模型学到了原本不熟的执行协议本身。
- **与本篇的接法**：Proxy 只需 API 兼容加记录够重建的信息，不需要
  理解 Harness 怎么规划、调工具、决定停止——与 §6.2 的 on-policy
  旋钮连读（重建轨迹的 on-policy 程度成为新的控制面）。

## 四、工具调用训练分工：SFT 教格式，RL 教策略

一句话分工：**格式归 SFT——学「调用长什么样」；策略归 RL——学「何时调、
调哪个、失败怎么办」。**

- **Tool-use SFT** 教格式：function calling schema、参数拼装、
  think/act/observe 穿插格式。V3.2 的 cold-start 甚至主要靠 prompt 工程
  + 少量 SFT 就能冷启动出可用轨迹——格式是浅层技能。
- **Tool-use RL** 教策略：何时该调工具、调哪个、超时/报错后重试还是换路。
  RL 阶段对 schema 错误和虚假调用直接给 0 reward 惩罚。

负样本构造的三类经验（直接可背）：

1. **K2 工具模拟器**：显式注入成功 / 部分失败 / 边界情况的受控随机结果，
   让模型见过「工具不可靠」的世界；
2. **rubric + LLM judge 过滤**：只保留达标的「自然失败又恢复」轨迹做
   SFT 种子——失败轨迹不是垃圾，是纠错模式的数据源；
3. **RL 硬惩罚**：schema 错误与虚假调用 0 分。

这里自然引出 **agentic 场景 reward hacking 的最典型形态：虚假调用与虚假
完成**——声明调了工具其实没调、声明任务完成其实没验。两个可直接引用的
对策：K2 的 hack-check 检测层（rubric 里还有独立反 hack 层）；GLM-5 的
rule/ORM/GRM 混合 reward，靠方差-抗 hack 的权衡中和单点漏洞。被追问
「self-critic 给 self 打分会不会自嗨」时，答案是 K2 的闭环校准：critic
持续吃 RLVR on-policy 可验证信号，主观判断被客观信号锚住防 drift。

## 五、Coding Agent 训练谱系：从 SWE-RL 到 DeepSWE

这条谱系是「SWE-bench 类任务怎么做成训练环境」的活教材，五个锚点：

| 工作 | 环境数据从哪来 | 规模 | 路线与成绩（原文口径） |
|---|---|---|---|
| SWE-RL（Meta, arXiv:2502.18449, NeurIPS 2025） | 软件演化数据 + 规则化 patch 相似度奖励 | Llama3-70B | 轻量规则 reward，Verified 41.0%，且泛化到函数编码/数学 |
| SWE-Gym（arXiv:2412.21139, ICML 2025） | 真实 issue 环境 | 2,438 实例 | SFT，resolve rate 绝对提升约 19 个百分点 |
| SWE-smith（arXiv:2504.21798） | **给任意 Python 仓库造 bug 反向合成** | 50K 实例 / 128 仓库 | SWE-agent-LM-32B：Verified 40.2%（SFT） |
| R2E-Gym（arXiv:2504.07164） | **从 commit 而非 PR 造环境**（SWE-GEN，更可扩展） | 8.1K 题 | SFT pass@1 34.4%；hybrid TTS 51% |
| DeepSWE（2025 官方模型卡） | R2E-Gym 4.5K 题 | Qwen3-32B | **纯 RL，无 SFT：23→42；hybrid TTS 59** |

DeepSWE 是「纯 RL 极点」的教科书案例，拆开看每个组件都可引用：

- **不做 SFT**：Qwen3-32B 直接上 RL，4.5K 道 R2E-Gym 题、200 步，
  SWE-bench Verified 从 23 到 42（pass@1 avg@16 = 42.2，hybrid TTS
  59.0）；
- **reward 极稀疏**：0/1 ORM，测试限 5 分钟；
- **算法是缝合怪**：GRPO 骨架 + clip-high（DAPO）+ 无 KL + 去 std 归一
  （Dr.GRPO）+ 长度归一（RLOO）+ leave-one-out 基线 + 截断轨迹 mask
  （compact filtering）+ 不加 entropy loss。

谱系结论背这三句：**其一，SFT 路线 32B 天花板约四成；其二，纯 RL 把同
尺寸拉到 42；其三，再叠轨迹级 verifier 做 test-time 选择到 59**——
训练侧 RL 与推理侧
verifier 是互补的两段增益，不是互相替代。被追问「为什么 DeepSWE 能纯 RL
而 SWE-smith 用 SFT」，标准答案在基座先验：Qwen3 自带工具调用格式先验，
冷启动采样到成功轨迹的概率非零；Llama 系没这个先验，纯 RL 采不到正样本，
只能先 SFT。

数据侧三条来路也要分清：issue-PR 挖掘（V3.2 数万对）、commit 反向合成
（R2E/SWE-GEN，可扩展性更好，不必依赖 PR 元数据）、故意造 bug
（SWE-smith，任意仓库可产）。

## 六、工程议题七条

### 6.1 长耗时 rollout 的长尾

一次 agentic rollout = 几百轮「生成 → 工具执行 → 回填」，尾巴样本拖住
整个同步点。对策三板：**全异步流水线**（GLM-5 slime，端到端目标从吞吐
改成尾延迟）、**rollout 侧 FP8 + MTP 投机解码**（小 batch 尾巴样本收益
最大）、**多轮场景 PD 分离**（防重 prefill 打断 decode）。代价明码标价：
引擎解耦引入权重版本滞后。

### 6.2 On-policy 程度是明码标价的旋钮

越异步吞吐越高、数据越 stale。三档对号入座：全同步（GPU 空转严重）→
V3.2 半同步（批内多 mini-batch 更新 + 高 KL 负样本 mask）→ GLM-5 全异步
（双侧 IS 裁剪 + optimizer 重置）。面试可以主动反问一句「staleness 怎么
量化」——答案是看 log π_old/π_current 的 KL 分布，而不是拍脑袋。

### 6.3 训练-推理数值不一致，几步内毁掉 RL

GLM-5 非确定性 top-k 的实测在前文；V3.2 同样把「推理框架与训练框架的
实现差异」列为 off-policy 加剧因素。纪律三条：**一是 token 流原样传递
（TITO），二是离散操作全链路确定性，三是稀疏注意力 indexer 冻结**。

### 6.4 失败轨迹的利用与浪费

GRPO 全 0 组零梯度，稀疏 reward 下大量 rollout 纯烧钱。三类去处：
环境侧**先过滤难度**（V3.2 保留 pass@100>0 实例）；数据侧**进 SFT/DPO
池**蒸馏「错误-纠正」模式（K2 故意注入部分失败正是为此——全 mask 掉
失败轨迹，模型就学不到错误恢复）；算法侧 **mask 截断轨迹**（DeepSWE
compact filtering——截断轨迹 reward 恒 0 会系统性惩罚长轨迹、诱导模型
提前 submit）。

### 6.5 评估-训练闭环是脏活但决定上限

训练环境与评测环境必须显式隔离：DeepSWE 专门过滤与 SWE-bench Verified
同仓库的题防泄漏。更扎心的是 harness 敏感性——同一模型换 harness 分数
漂移数个百分点（V3.2 的 72–74 区间）。**而「训练里见过的脚手架」本身就是
一个可过拟合维度**，评测要报 harness 敏感性区间，agent 能力 ≠ 模型能力，
而是模型 × 脚手架的联合分布。

### 6.6 上下文溢出是 hidden failure mode

V3.2 官方口径：冗余自我验证导致轨迹超长，128K 下 20%+ 的 BrowseComp
用例溢出。训练含义：长度惩罚 / 截断 mask 会反向塑造 agent 行为；长程
agentic RL 要求**训练上下文窗口 ≥ 典型轨迹长度**，否则你在训练一个
注定超窗的行为分布。

### 6.7 Reward 三选一的三角取舍

rule-based（精确但表达力窄）/ ORM（低方差高效但最易被 hack）/ GRM 或
rubric judge（抗 hack 但高方差，judge 本身要训练防 drift）。GLM-5 的
答案是混合；K2 的答案是 rubric + self-critic 闭环，critic 用可验证信号
持续校准。没有第四种答案，说出三角就及格。

### 6.8 多轮交互式 RL 的 user simulator：环境里再站一个模型

用户不停追问、按结果细化目标的开放式会话（assistant 产品、谈判式
agent），rollout 里 user 侧再放一个模型当对手（27 届后训练岗 20 余场
面经总结帖实录，见
[面经合集二十六节](../../interview-experiences/小红书社招面经合集-2026h2.md)）：

- **user simulator 「好」的定义与难题**：要难且真——分布要随 policy
  变强而调整，否则训出讨好模拟器的策略（与 reward model 过优化同构，
  Goodhart 防线原样适用）；user 侧输出不确定会让轨迹评级噪声翻倍。
  面试锚一句话：**user simulator 就是 user 侧的 reward model**，KL、
  ensemble、定期换代三件套直接迁移。
- **训哪几轮的三档**：只训最后一轮（轨迹级、信号稀疏但干净）/ 多轮
  都学（信息密，但用户消息是否进 loss 要与 observation mask 口径
  区分，见 [agentic-rl 前沿手法专题](./agentic-rl前沿手法专题.md)
  §2.2）/ 带 simulator 的交互式多轮（真闭环但环境噪声最大化）——
  取舍坐标可直接复用 §6.7 的三角背法。
- **省钱的落地**：不必每步全真模拟——离线多轮轨迹池 + 末端 RL 微调，
  或 user 侧小模型+规则模板混合，把算力留给 policy。

口径：三档框架与「user 侧 RM」类比为面经还原帖答法（自报），工程
直觉可信，未引具体论文背书。

### 6.9 self-play 自对弈：拿历史 checkpoint 当对手

训练里的对手不一定要是环境或 user simulator——可以是模型自己的
历史版本。抖音训练经验帖（2026-10，单帖自报）的第五板斧，也是
Agentic RL 图谱帖里与 Deep Research、代码沙箱并列的实现件之一：

- **组队式**：多 agent 协作训练拿不同 checkpoint 组队，能挖出单
  agent 与固定环境互动学不到的配合策略；
- **对抗式**：旧版本负责破坏任务、新版本学会应对——相当于自动
  化的课程升级，持续把模型弱点暴露给策略。**对手强度要控**：太强
  打崩探索，太弱学不到东西，本质是 exploration 侧的又一颗旋钮；
- **与 user simulator 的关系**：§6.8 是「环境侧再站一个模型」，
  self-play 是「对手侧换成一排旧自己」——两者都把静态环境变成
  动态博弈方，Goodhart 防线同样要看紧，别让 policy 学成专揍旧版
  自己的套路。

口径：单帖自报、未引论文背书；思想血缘是围棋与 Atari 的
self-play 老传统，与具身侧 DAgger 专家纠偏同属「对手工程」一族。

## ▶ 面试题

**Q1（极高频）：GRPO 为什么直接搬去多轮 agent 不够用？**
三条缺口：步级优势被压成同一标量、全 0 组零梯度（稀疏 reward 下占比极高）、
轨迹长度差异带来的效率噪声。追「选 GiGPO anchor-state 分组还是
turn-level value model」：前者无 critic、显存不变，但依赖环境状态可复现
——搜索/网页环境状态重复率低时退化；后者方差低但多训一个模型，轮级
value 标注来自蒙特卡洛回报，成本 × 轨迹数。

**Q2（极高频）：token 级 / 轮级 / 轨迹级 reward 怎么选？**
坐标轴是可验证度与 hack 风险。工业答案是轨迹级 outcome + 硬 verifier，
轮级中间信号只在 verifier 便宜时加（每轮 schema 校验、格式扣分），
token 级基本没人用——太密、易 hack、标注贵。

**Q3（高频）：异步 rollout 引入多少 off-policy？怎么控？**
先画版本时间线：rollout 开始时的权重版本 vs 训练消费时的版本， staleness
用 log π_old/π_current 的 KL 分布量化。两派对策记适用边界：GLM-5 双侧
token 级 IS 裁剪 + optimizer 重置（不存历史 checkpoint 也能控）；
DeepSeek 高 KL 负样本 mask（半同步场景）。追「IS 比值在长轨迹上指数
漂移怎么办」——token 级裁剪正是对此的回答，序列级比值连乘才会爆。

**Q4（高频）：设计一个 agentic RL 环境要满足什么性质？**
标准四点：可重置、可验证、低成本（沙箱/模拟器，K2 用 tool simulator
当 world model）、多样性（环境合成 agent 而非手写）。引 V3.2 的
「难做易验 + pass@100 过滤」闭环。追「合成环境如何避免与评测集同分布
过拟合」——官方消融：只在合成 agent 数据训 RL，未见工具集 Tau2 /
MCP-Mark 照样大涨，增益来自泛化。

**Q5（高频）：虚假调用 / reward hacking 怎么防？**
分三类：虚假声明完成（K2 hack-check 检测层）、schema 幻觉（format 硬
扣分、0 reward）、judge 被 exploit（GLM-5 混合 rule/ORM/GRM）。追
「self-critic 会不会自嗨」——K2：critic 用 RLVR on-policy 信号持续
校准，rubric 分层且含独立反 hack 层。

**Q6（中频）：失败轨迹值多少钱？**
三个去处：难度过滤挡在训练集外（pass@100>0）、进 SFT/DPO 池做纠错
数据、算法侧直接 mask。反例要会说：全 mask 掉失败轨迹会让模型学不到
「错误恢复」，K2 故意在模拟器里注入部分失败正是为此；但截断轨迹恒 0
会诱导提前 submit，所以 DeepSWE 做 compact filtering。

**Q7（中频）：怎样把 SWE-bench 类任务做成 RL 环境？数据从哪来？**
谱系题：issue-PR 挖掘（DeepSeek 数万对）、commit 反向合成（R2E-Gym /
SWE-GEN，更可扩展）、故意造 bug（SWE-smith，50K / 128 仓库）。追
「为什么 DeepSWE 可以纯 RL 而 SWE-smith 用 SFT」——基座 Qwen3 已有
工具格式先验，冷启动采到正样本的概率非零；Llama 系不行。

**Q8（中频）：模型换 harness 分数漂移几个点，训练侧意味着什么？**
agent 能力 ≠ 模型能力，是模型 × 脚手架的联合分布；训练数据里的工具集 /
脚手架格式本身就是可过拟合维度。评测要报 harness 敏感性区间——V3.2
SWE-bench 的原生 67.8 与换 harness 的 72–74 就是教科书案例。

## 口径与未核实说明

- R2E 原始论文（ICML 2024）arXiv 编号未核实；仅核实 GitHub
  r2e-project/r2e 与 R2E-Gym（arXiv:2504.07164）。
- Qwen3-Coder 的 SWE-bench Verified 具体分数未核实——官方 blog 只给定性
  「开源 SOTA」与 2 万并行环境，本文不引具体分数。
- GLM-5 的 SWE-bench / τ²-bench 绝对分未核实：报告 Figure 为图片，文本
  只抓到「平均比 GLM-4.7 高约 20%」；GLM-5.2 的 Terminal-Bench 2.1 81.0 /
  SWE-bench Pro 62.1 来自 README 官方口径；GLM-5.3 相关日期为第三方
  自媒体口径，不采。
- K2 Thinking 的 τ²-bench 分数未核实：HF 模型卡未含该条目，社区流传的
  Telecom 93.0 无一手出处，不采；本文仅引用其 SF-harness 的四项官宣
  （Verified 71.3 / HLE 44.9 / BrowseComp 60.2 / 200–300 轮）。
- GiGPO、RAGEN/StarPO、SWE-RL 的提升幅度均为论文自述，非独立复现；
  DeepSWE 与 R2E-Gym 数字为官方模型卡 / README 宣称。
- DeepSeek-V3.2 的 85,000 prompt 与 1,827 环境是并集还是包含关系：报告
  引言写「1,800 environments and 85,000 complex prompts」，§3.2.3 写
  「1,827 environments / 4,417 tasks」，两处粒度不同，本文按原文分别
  引用，不做合并推断。
- K2 的 3,000+ / 20,000+ 工具数为 K2 技术报告 §3.1.1 口径；Tau2-Bench
  66.1 为非 thinking 模式，Verified 65.8 为单次、71.6 为并行 TTC。
- 全部基准分数带评测配置敏感性（harness、context management、采样次数），
  已逐处标注；跨家横向比分数意义有限，比配方结构才有意义。

## 串联阅读

- [rl环境工程专题](./rl环境工程专题.md)：环境怎么造、verifier 怎么判、
  沙箱怎么选——本篇的「硬 verifier + 大规模环境」三件套在那边展开；
- [rl训练工程实战](./rl训练工程实战.md)：loss 曲线、梯度尖峰、熵调控的
  通用训练坑，Echo Trap 属于同一族；
- [verl深度拆解](./verl深度拆解.md)：训练引擎视角的 rollout / 权重同步
  / 三池解耦，GLM-5 slime 的对照读物；
- [推理模型训练专题](./推理模型训练专题.md)：单轮 RLVR 与 reasoning
  配方，本篇是它向多轮的直接推广；
- [rlhf与对齐](./rlhf与对齐.md)：PPO/DPO/GRPO 算法本身的演化线；
- [../蒸馏与剪枝专题](../蒸馏与剪枝专题.md)：「把可验证信号蒸馏回主观
  判断」的大框架在那边；
- [../agent/多agent与评测](../agent/多agent与评测.md)：训练出来的 agent
  怎么评，harness 敏感性的评测侧展开；
- [../agent/工具调用与mcp](../agent/工具调用与mcp.md)：function calling
  与 MCP 协议层，理解「虚假调用」要先懂正常调用长什么样。
