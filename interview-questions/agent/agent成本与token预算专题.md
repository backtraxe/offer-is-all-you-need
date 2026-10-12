# Agent 成本与 Token 预算专题：单任务经济学、模型路由与预算工程

> **面向**：已经跑过 agent 产品、被面试官问到「这套 agent 跑一次任务多少钱、
> 老板说太贵了怎么办」的读者。本篇把「单任务经济学」拆成五层：账单从哪来、
> 路由怎么省、预算怎么管、瘦身怎么算账、2026-10 价目怎么套。
>
> **读完获得**：① Anthropic 官方「4×/15× chat」乘子与 Manus「100:1
> in/out」结构锚，以及 input 四象限拆法与 tool schema 固定税的精确换算；
> ② 一张白板算账模板（50 步任务 cache 命中与否差 5~6 倍）；③ 模型路由
> 谱系（FrugalGPT 三策略 → RouteLLM 四构件 → lead/sub 结构性定档）与节省
> 幅度可背表；④ 预算工程三件套（三本账、子 agent 账户、early-exit 与
> partial deliver）；⑤ 瘦身手段的成本排序（外置 → 剪 → 摘要 → 截断）与
> LLMLingua 实测锚；⑥ 2026-10 三家价目与「cache 天选、batch 不适用」的
> 折扣适用性结论；⑦ 「太贵怎么办」六步标准答法与 cost per successful
> task 北极星看板。
>
> **时效口径**：素材采集于 **2026-10-12**，全部价目为当日官方定价页实测
> 口径；论文数字按 arXiv 原文口径括注；社区/工程估算一律标明「业界通例」，
> 未核实项集中在第六节「口径与未核实说明」，不进正文断言。

## 〇、本篇边界：与 finops、thinking-serving、上下文压缩不重复

仓库里已有三篇相邻文档，先把边界划清，面试时也按这个边界组织回答：

- [finops与算力成本专题](../finops与算力成本专题.md) 讲的是**组织级/集群级算力账**：GPU-hr 单价、三段式 $/M output token 公式、showback 与容量
  规划——它回答「卡贵不贵」，本篇回答「跑一次 agent 任务花多少钱、怎么
  控制住」。
- [inference/thinking-serving专题](../inference/thinking-serving专题.md)
  讲的是 **thinking budget 的单请求级工程**（软提示 → 语法硬钳 → logit
  硬钳）与 TTFAT 指标。本篇只引用「task 级预算」与「thinking 预算」的
  上下位关系，不重复钳制实现。
- [agent/上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md) 讲的是
  **压缩机制谱系与 RL 记忆训练**。本篇只算「瘦身手段的成本账」（token
  省下多少 vs 质量损失多少、瘦身本身花多少），不重复机制细节。
- [agent/观测与trace工程](./观测与trace工程.md) 讲的是 trace 管线本身，
  本篇只用其「成本归因 trace 字段」的结论来搭成本看板。

一句话主线：**chat 的成本是一次调用，agent 的成本是一条轨迹——账单的主项从 output token 平移到反复重放的 input 前缀，所以省钱的第一抓手是 cache 命中率，第二抓手是模型路由，第三才是瘦身。**

## 一、成本结构拆解：一次 agent 任务的 token 构成

### 1.1 两个官方锚：Anthropic 的乘子与 BrowseComp 方差

Anthropic《How we built our multi-agent research system》（2025-06 发布，
2026-10-12 实测可访问）给了两个可以往白板上一放就镇场的数字：

- **单 agent ≈ 4× chat，multi-agent ≈ 15× chat**（原文：agents typically
  use about 4× more tokens than chat interactions, and multi-agent
  systems use about 15× more）。这是「agent 比 chat 贵一个量级」的官方
  出处。
- BrowseComp 上性能方差的三因子解释：**token usage 单独解释 80%，**加上
  tool call 次数与模型选择共解释 **95%。**官方原话的读法是「multi-agent
  systems work mainly because they help spend enough tokens to solve the
  problem」——**性能 ≈ 可花费的 token 量**，这是「预算即性能」的官方
  论据，也是预算工程不是抠门而是性能管理的官方背书。
- 反方向的乘子也存在：**升级模型是效率乘子**——Sonnet 3.7 → Sonnet 4
  的提升大于 token 预算翻倍。所以「省钱」不等于「一味降档」，升档可能
  反而省下步数。
- 适用边界：multi-agent 要 **task value × breadth** 足够高才经济；coding
  任务可并行性低，不是 multi-agent 的好场景（Anthropic 明口径）。

### 1.2 Manus 结构锚：100:1 in/out 与三角数放大

Manus《Context Engineering for AI Agents》（2025-07，2026-10-12 实测）
给了结构层面的解释：

- **平均 input:output ≈ 100:1**——agent 与 chatbot 的根本结构差异：
  prefill 极长、decode 极短（每轮输出只是一个结构化 function call）。
- 每轮迭代把 action + observation append 进上下文，上下文线性增长，而
  每轮 prefill 要**重放全部历史** → 总 input token 随步数近似**平方增长**（三角数）。这就是 1.1 那个 15× 乘子的微观放大器公式。
- **KV-cache hit rate 是生产阶段 agent 最重要的单一指标**（Manus 原话），
  举例价差：cached $0.30 vs uncached $3 /MTok（2025-07 口径的上一代
  Claude 价格，10× 差）。
- 平均任务 ≈ **50 次 tool call**；图片/截图进上下文是隐性成本杀手
  （computer use / browser use 的截图按 image input 计费）。

### 1.3 四象限：input token 的四块构成

一次 Codex / deep-research 任务的 input token 由四块组成，比例因产品
而异但结构稳定（面试白板就画这个）：

1. **系统提示**：角色、规范、行为准则，量级数千~万余 token（coding
   agent 的系统 prompt 公开逆向普遍在 1 万 token 量级，属社区逆向口径，
   不构成官方断言）。
2. **工具 schema 开销（固定税）**：见 1.4，这是「每轮都重放」的部分，
   且位于上下文前部——改它会打爆整个 cache。
3. **历史轨迹**：每轮 append 的 assistant 消息 + tool_use + tool_result，
   步数越多占比越大，是 15× 乘子的主来源。
4. **工具结果（observation）**：最不可控的一块。Anthropic 定价页给的
   实测换算：平均网页 10 kB ≈ 2,500 token；大文档页 100 kB ≈ 25,000
   token；500 kB PDF ≈ 125,000 token——一次「读个 PDF」就能吃掉半个
   典型 chat 会话的 token。

### 1.4 tool schema 固定税：286~6600 token 每轮重放

Anthropic 官方定价页的精确口径（2026-10-12 实测）：

- 只要带 ≥1 个 tool，自动注入 tool-use system prompt：auto/none 模式
  **286~675 token**（因模型代际不同），any/tool 强制模式再多 ~110~130。
- bash tool 定义 **+325 token**（Claude 4.7+ / Mythos；4.6 及更早 244）；
  text_editor tool **+974 token**（4.7+；更早 745）。
- computer_toolset 默认成员 **≈ +4,500 token**；browser_toolset
  **≈ +6,600 token**。

结论：工具集越大，固定税越重；且 schema 区在上下文最前部，**任何对工具定义的改动都会让后面全部前缀 cache 失效**（Manus 的 mask-don't-remove
论据，第四节展开）。

### 1.5 白板算账：同一条轨迹差 5~6 倍

口径自曝版（2026-10-12 价目）：设一个 50 步 tool-call 任务，历史上限
压到 200k 内。线性近似：第 i 轮 prefill ≈ 固定税 S（系统提示+schema
≈ 8k）+ i × 每步增量 d（2k），平均 prefill ≈ 8k + 25×2k = 58k，50
轮总 input ≈ 2.9M token，output ≈ 50 × 300 = 15k。

- 全程 cache miss（历史每轮都打爆前缀）：按 Sonnet 5.5（$2/$10）input
  2.9M × $2 = $5.8 + output $0.15 ≈ **$6/任务**。
- 正常 append-only 高命中（假设 90% input 走 cache read，Sonnet 5.5 档
  $0.10/MTok）：2.9M × (10%×$2 + 90%×$0.10) = 2.9M × $0.29 = $0.84 +
  cache write 溢价（首写 1.25×）≈ **$1.0~1.2/任务**。
- 若挂在 Opus 5.5（$4/$20）且无 cache 命中：≈ $12/任务；multi-agent
  叠加（15× vs 4×，再多 ~3.75×）后可达数十美元/任务。

杠杆排序一目了然：**cache 命中率 > 模型档位 > 步数控制 > 瘦身细化**——
同一条轨迹，cache 命中与否就是 5~6 倍，模型档位再乘 2 倍，瘦身只能动
零头。

### 1.6 官方「价值-成本」门槛

Anthropic 原话：multi-agent 经济性要求 task value × breadth 足够高
（search/travel 类价值分散在多方、单任务价值低，不适合）；coding agent
场景（Devin 等）因单任务价值高而成立。面试可直接引「agents 4× chat、
multi-agent 15× chat」这张官图收尾：**agent 的经济性本质上是任务价值筛选器**。

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-cost-budget.html" width="100%" height="900" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-cost-budget.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、模型路由：FrugalGPT / RouteLLM 谱系与 lead/sub 定档

### 2.1 FrugalGPT：三条降本策略与 98%

FrugalGPT（arXiv:2305.05176，2023-05，Stanford）。选题动机一句话：
主流 LLM API 价差可达两个数量级。它给出三条降本策略，这是整条谱系
的纲领，面试可直接背三类：

1. **prompt adaptation**——缩短 prompt、query 聚合，省的是输入侧；
2. **LLM approximation**——更便宜的近似模型 / completion fine-tune；
3. **LLM cascade**——按查询学习「用哪个/哪些模型」的组合（FrugalGPT
   本体）：弱模型先答，置信不足再升级强模型。

官方结论数字：**追平最强单体模型（GPT-4）且成本降最高 98%；**或同成本
下准确率比 GPT-4 高 4%。锚点地位：它是「级联评分器先答、置信不足升级
强模型」这条线的学术源头，EMNLP/MLServing 圈子高频引用。

### 2.2 RouteLLM：数字、四构件与「1500 条金标」

RouteLLM（LMSYS / UC Berkeley，2024-07 博客 + arXiv:2406.18665，
2026-10-12 实测）。问题形式化：两模型间（强 GPT-4 Turbo vs 弱
Mixtral 8×7B）按 query 路由，目标是最小成本下保住质量。

官方结果（均相对只用 GPT-4，同时保住 95% 的 GPT-4 性能）：

- **MT-Bench 成本降 >85%；**
- MMLU 降 45%；
- GSM8K 降 35%。

路由器四构件（按实测效果排序的语感）：

1. SW（similarity-weighted）ranking：加权 Elo；
2. matrix factorization：学「模型对 prompt 的打分函数」，纯 Arena
   数据时最强；
3. BERT classifier；
4. causal LLM classifier：预测哪个模型回答更好。

两个容易被忽略的工程结论：

- **数据增强是决定性变量**：纯 Chatbot Arena 偏好数据训练，MT-Bench 上
  要 26% GPT-4 调用才能保住 95% 性能；叠加 LLM judge 增强后只需 **14%**
  GPT-4 调用；MMLU 仅靠 **1500 条金标**增强（<2% 训练数据）即从近随机
  提到 54% GPT-4 调用。结论：路由器泛化靠「少量 in-domain 金标」，不是
  大数据——落到自己业务上，标一千多条就够启动。
- **跨模型对零重训泛化**：同一路由器直接在 Claude 3 Opus ↔ Llama 3
  8B 上仍工作（MT-Bench 相当）——路由学的是「问题难度特征」，不绑定
  具体模型。对比商用路由器（Martian、Unify），官方口径同等性能下再
  便宜 40%+。

### 2.3 agent 场景的 runtime 判定：五级信号

论文是静态路由（进门前判一次）；agent 是动态路由（每个 node、每轮判
一次）。候选判定信号按工程成本从低到高：

1. **规则/启发式**：任务类型 tag（coding/research/chitchat）、输入
   长度、是否命中工具集、SLA 档位。成本近乎零，覆盖 60–70% 场景。
2. **小分类器**：RouteLLM 式 BERT/矩阵分解路由器，ms 级延迟，需要
   几百~几千条 in-domain 金标（上文 1500 条即够）。
3. **级联置信度**：弱模型先答，用 logprob/自一致性/裁判模型打分，
   不足则升级 FrugalGPT 式 cascade。对错率敏感场景可用，代价是引入了
   「双次调用」的延迟税。
4. **agent 内的结构性路由**（不判复杂度、直接按角色定档，Anthropic
   Research 实证）：lead/planning 用旗舰（Opus 4），subagent/执行用
   次旗舰（Sonnet 4）——比「处处 Opus」省、又比「处处 Sonnet」强：
   **Opus 4 lead + Sonnet 4 subagents 比单 agent Opus 4 在内部 research eval 上高 90.2%。**同样思路：tool 结果解析/摘要/格式化
   节点挂 Haiku 档，planning/最终综合挂 Opus 档。
5. **运行时纠偏**：监控「任务中途的表现信号」（连续 tool 错误、轨迹
   发散）触发升档——与第三节的预算熔断共用一套 trace 指标。

注意一个反直觉点：lead/sub 定档是「提质」不是「降质」，90.2% 是相对
提升——因为分工让每一步都在最合适的模型上跑。面试里把它和静态路由
区分讲，会显得很懂行。

### 2.4 大小模型级联的节省幅度汇总（可背表）

| 来源 | 配置 | 节省 | 质量代价 |
|---|---|---|---|
| FrugalGPT | cascade vs GPT-4-only | 最高 98% | 持平（或同成本 +4% 准确率） |
| RouteLLM | GPT-4↔Mixtral MT-Bench | >85% | 保 95% GPT-4 性能 |
| RouteLLM | GPT-4↔Mixtral MMLU | 45% | 保 95% GPT-4 性能 |
| RouteLLM | GPT-4↔Mixtral GSM8K | 35% | 保 95% GPT-4 性能 |
| 定价比（2026-10-12 实测） | Opus 5.5 → Sonnet 5.5 | 50%（$4/$20 → $2/$10） | 档位差 |
| 同上 | Sonnet 5.5 → Haiku 5.5 | 95%（$2/$10 → $0.10/$0.50） | 档位差显著 |
| 同上 | Gemini 3.1 Pro → 3.8 Flash | ~62%（$2/$12 → $0.75/$3.75） | 档位差 |

三行 takeaway：**路由这条路的天花板是「省到只剩 14% 的强模型调用」，档位表决定了每一刀的收益下限，结构性定档甚至能反而提质。**

## 三、预算工程：三本账、子 agent 账户与 early-exit

### 3.1 per-task 三本账与熔断三档

预算单位建议同时挂三本账：

- **token 账**：input/output 分列，input 再拆 cache hit/miss（命中率
  就是最大杠杆，不拆开看不见）；
- **美元账**：按当前价表换算，Anthropic 官方明示「estimate it in
  advance with the token counting endpoint」——预算估算可以算在起跑前；
- **步数账**：tool call 次数，即 max_iterations 的直接依据。

熔断档位（与 thinking-serving 专题的三档硬钳呼应，但此处是**轨迹级**
而非单请求级）：

1. **软预算**：达到阈值给 agent 注入「剩余预算」提示，逼它收敛
   （budget forcing / 软提示这条线）；
2. **硬预算**：max_tokens/单请求钳制 + max_iterations/max wall-clock
   （LangGraph / Claude Agent SDK 均提供 recursion/turn 上限，属框架
   公开能力）；
3. **成本熔断**：美元账超阈值直接 kill + 返回部分结果（见 3.3），防
   「死循环烧库」——公开报道中 agent 死循环烧百刀级账单的事故屡见
   不鲜（社区事故通例，引用时标注口径）。

预算要按任务价值分层：高价值任务（客户产线 incident、付费深度报告）
给高预算，免费/探索流量给低预算+小模型——这正是 1.6「任务价值 ×
广度」决定引擎档位的官方口径落地。

### 3.2 子 agent 预算账户：Anthropic scaling rules 三档

Anthropic Research 系统的官方做法是 **prompt 级预算**，硬编码在
orchestrator 的 prompt 里：

- 简单事实查询：**一个 agent，3–10 次 tool call**；
- 直接对比类：**多 subagent（2–4 个），每个 10–15 次调用**；
- 复杂研究：**十个以上 subagent，明确分工**。

反面教材同样是官方自曝：早期版本没有这套规则时，agent 会对简单 query
一把梭 50 个 subagent、为不存在的来源刷爆网络、互相干扰——这就是
「预算失控」的官方样本。

工程版账户设计：lead 给每个 subagent 下发 task 描述时**同时下发预算额度**（token / 步数 / 超时），subagent 记账，配额耗尽时返回部分结果
而非失控重试；lead 汇总时按「已花/已得」决定是否再派。账户数据的另
一个用途：做 per-subtask 成本归因看板（第六节）。

一个别讲反的点：**异步化是延迟优化不是成本优化**——Anthropic 自承
同步执行 subagent 会造成等待瓶颈，异步能并行但带来结果协调、状态
一致、错误传播的开销，反而可能涨 token（更多边算边等）。并行化同理：
两档并行（lead 并发起 3–5 个 subagent；subagent 用 3+ 工具并行）把
复杂研究时间砍 90%，但这是**延迟收益**，token 反而略涨（重复检索），
回答「降本」时别拿它当论据。

### 3.3 early-exit 与部分结果交付（partial deliver）

Anthropic 官方失败模式列表第一条即「agents continuing when they
already had sufficient results」——在已有足够信息时继续搜。对策分
两层：

1. 在 prompt 里教 orchestrator 识别「足够」（effort scaling + 停止
   准则）；
2. 在 harness 里强制退出条件（连续 N 步无新信息增益、置信度达标、
   预算告警线）。

**部分结果交付**：预算熔断时不返回空，返回「已完成部分 + 明确标注
缺口」。技术上依赖 checkpoint——Anthropic 明牌组件：错误后不从头
重启，而是从断点 resume；retry logic + regular checkpoints。输出契约
要在任务开始就约定好部分结果格式，否则熔断产物不可用。

「重试即再烧一遍」是预算与可靠性的交点：Anthropic 明示 agent 场景
restarts are expensive，**优雅退避**（告知模型工具失败、让它自适应）
常比重试便宜。

## 四、瘦身的成本账：外置 → 剪 → 摘要 → 截断

### 4.1 四种手段的成本机制与排序

瘦身机制本身的谱系在[上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md)，
本篇只算账：

1. **工具结果外置（file system as context）**：Manus 核心结论——压缩
   设计成「可恢复」：网页内容可丢但要留 URL，文档可省但要留路径。这是
   **唯一「零信息损失」的瘦身**，代价是模型要学会读写文件的行为，且
   回读时重新付一次 prefill。Anthropic Research 同款：memory tool
   持久化 plan、「subagent output to a filesystem」让 subagent 产出
   直写文件、只回传轻量引用，官方给的双重收益是保真度（避免 game of
   telephone 传话失真）+ 省 token（不再把大产出经 conversation
   history 反复拷贝）。
2. **剪（prune）**：清 tool 输出主体留指针、constrained decoding 省
   结构化输出废 token。零 LLM 调用成本，风险同样接近零——被剪的是
   「已经消费过」的 observation 主体。
3. **摘要压缩**：省 token 但摘要本身要花一次 LLM 调用（压缩成本约占
   被压段落的 1/3~1/2 token，业界通例口径），且质量损失真实存在
   （详见压缩专题的三代谱系）。适用面收窄到「终态不再需要细节」的
   段落；压缩执行可以用小模型（Haiku 档 $0.10/$0.50）。
4. **截断**：零调用成本，但 Manus 口径「any irreversible compression
   carries risk」——无法预知哪条 observation 在第 10 步后变成关键；
   且模型性能在超出某一上下文长度后本就下降。只作兜底（超限/事故
   恢复时）。

排序结论（面试结论版）：**先外置、再剪、摘要只压终态段落、截断只兜底；一切瘦身手段的账本必须把「瘦身本身的 LLM 调用费」计入分母——省下来的必须大于花出去的。**

### 4.2 压缩率实测锚：LLMLingua 系列

- LLMLingua（arXiv:2310.05736，EMNLP 2023）：**最高 20× 压缩**且性能
  损失很小（「up to 20x compression with little performance loss」，
  GSM8K / BBH / ShareGPT / Arxiv-March23 四数据集口径）。
- LLMLingua-2（arXiv:2403.12968，ACL 2024 Findings）：任务无关蒸馏式
  token 分类压缩；压缩率 2–5× 时端到端加速 **1.6–2.9×**，压缩过程
  本身比前法快 3–6×（MeetingBank / LongBench / ZeroScrolls / GSM8K
  / BBH，跨 LLM 鲁棒）；压缩器是 XLM-RoBERTa 级小模型，自成本几乎
  可忽略。

口径警示：这些数字是「问答/文档类 prompt」的实测；**agent 轨迹的压缩损失更难测**（失败是稀疏事件），所以生产做法（Anthropic / Claude
Code）是只压「已解决、不复用」的段落，保最近 5 个文件、最近一段工具
输出的原貌。

### 4.3 cache 与瘦身的互相牵制（易踩坑）

- cache 命中要求**前缀字节级稳定**：系统 prompt 里放精确到秒的时间戳
  会一夜打爆全部 cache（Manus 明牌反面例子）；
- JSON 序列化 key 顺序不稳也会悄悄打爆 cache——要 deterministic
  serialization；
- 动态增删工具会破坏前部 schema 区的 cache 并让历史 tool_use 失去
  定义参照（要么 hallucinated actions 要么 schema violation），Manus
  的解法是 **mask-don't-remove**：用 logit mask 只约束可选动作、不动
  工具定义；
- 结论：agent 框架设计的 **cache-first 原则**高于一切 prompt 花哨
  把戏，瘦身手段选型时先问「它动不动前缀」。

## 五、价目口径 2026-10（全部当日实测标注）

以下三段均为 2026-10-12 官方定价页实测口径。面试引用必带「截至我的
观测点」后缀。

### 5.1 Anthropic（docs.claude.com/en/docs/about-claude/pricing）

- 旗舰档位（input/output，$/MTok 下同）：**Opus 5.5 $4/$20**；
  **Sonnet 5.5 $2/$10**；**Haiku 5.5 $0.10/$0.50**（prompt ≤100k；
  >100k 档 $0.50/$2.50）；Fable/Mythos 5.1 旗舰档 $10/$50。
- **Prompt caching 乘子**（全部相对 base input）：5 分钟 cache write
  1.25×；1 小时 cache write 2×；**cache read（命中）0.1× base**
  （Opus/Sonnet 5.5 档为 0.05×，Fable/Mythos 5.1 档为 0.025×）。
  回本线：**五分钟档命中 1 次即回本**（1.25× 写 < 1 + 0.1× 命中读）；
  1 小时档命中 2 次回本。
- Batch API：input/output 双双 50% off（不支持 fast mode 与 Managed
  Agents）；与 cache 乘子可叠加（5 折后再 0.1× 命中）。
- fast mode（Opus 5.5）$8/$40 = 2× 标准价，只在一方 API 提供，不能
  批处理。
- 服务器侧工具：web search **$10/1,000 次**；code execution 免
  1,550 时/月，超出 $0.05/时/容器（最低计 5 分钟）；web fetch 不另
  收费（只算 token）。
- **新 tokenizer 警示**：Claude 4.7+ / Mythos Preview 同文本 token
  数涨 ~30%——比价时必须按同一文本实测算账。
- Claude Managed Agents：token 照常计费 + session runtime
  $0.08/session-hour（只计 running 态），不能 batch。官方 worked
  example：**一小时 coding session 总价 $0.525**（Opus 5、50k
  input / 15k output / 40k cache 命中）——这是官方自曝的「agent
  单小时运行成本」锚，极好面试素材。
- inference_geo=us 加 1.1×（数据合规溢价）。

### 5.2 OpenAI（platform.openai.com/docs/pricing + batch guide）

- 旗舰档：**gpt-6-astra $10/$50**（标准上下文；长上下文 $20/$75）；
  **gpt-6.1-sol $2/$10**；**gpt-5.6-sol $4/$20**（促销价至少到
  2026-11-21）。
- cached input：gpt-6-astra $1（90% off）、gpt-6.1-sol $0.10（95%
  off）、gpt-5.6-sol $0.40（90% off）；cache write 分别为
  $12.5/$2.5/$5（1.25×）。
- Codex 专用档：gpt-5.3-codex $1.75/$14，cached $0.175。
- **Batch API**：全场 50% off；24 小时 completion window；单批
  ≤50k 请求、文件 ≤200MB；最多 2000 批/时；速率限制独立池不占标准
  配额。
- 服务器侧工具：web search $10/1k 次（reasoning 系 preview $25/1k、
  结果 token 免费；非 preview 则结果 token 按原价计）；容器会话 20
  分钟按 GB 档位 $0.03~$1.92；file search $2.50/1k 次 + 存储。
- 区域处理/数据驻留：2026-03-05 后发布模型 +10%。

### 5.3 Google Gemini（ai.google.dev/gemini-api/docs/pricing）

- 旗舰：**Gemini 3.1 Pro Preview $2/$12**（prompt ≤200k）/ $4/$18
  （>200k）；context caching $0.20/$0.40 + **存储费 $4.50/M token/hour**（醒：存储费是 Pro 档特有，agent 长会话挂缓存的持有
  成本不低）。
- 轻量旗舰：**Gemini 3.8 Flash $0.75/$3.75**（促销至 2026-12-31，
  2027-01-01 起 $1.50/$7.50）；cached $0.075，存储 $0.50/M/h。
- Batch 与 Flex 均 50% off（Flex 同价但 SLA 更松）；Priority 1.8×
  （3.8 Flash 档 $1.35/$6.75）。
- Grounding with Google Search：5,000 次/月免费，之后 **$14/1k**——
  deep-research 类 agent 一次任务上百次搜索，仅 grounding 费就 $1+，
  叠加搜索内容 token 才是主项。
- 口径警示：Gemini 输出价**含 thinking token**。

### 5.4 agent 场景折扣适用性判断（一句话结论版）

- **cache（prompt caching / context caching）：agent 天选折扣**——
  每步重放同前缀，天然命中率高；成本差 10×，任何 agent 框架不把它
  做进去就是不及格。唯一坑是前缀稳定性（4.3）与 Google 系存储费。
- **Batch（三家均 50% off）：agent 场景基本不适用**——agent 是
  交互式、状态化、逐步依赖的循环（Anthropic 明示 Managed Agents
  不支持批处理），Batch 24h 窗口只服务离线评测、批量打标、embedding
  建库、训练数据清洗这些「可延迟」副业。
- **Priority / fast mode**：1.8×~2× 溢价换延迟，只在 SLO 敏感的
  付费档位值得开。
- **服务器侧搜索（$10~14/1k 次）：deep-research 任务必算账**——百
  次搜索 $1~1.4 相对 token 费是小头，但被「免费搜索」惯坏的成本
  模型会漏掉它。
- **tokenizer 换代 +30% token（Claude 口径）：升级模型不一定省钱**——单价比只是账的一半，token 计数值本身也会变。

## 六、面试口径：六步降本与北极星指标

### 6.1 「Agent 单任务太贵」标准答法（分层作答，按序出牌）

1. **先归因再动手**：拉 per-task 成本结构（第一节四象限），看是
   cache 命中率低、还是步数失控、还是模型档位错配。**没有看板不许拍方案。**
2. **零风险先手：cache 命中率**。幂等前提（系统提示无时间戳、
   append-only、deterministic serialization、mask-don't-remove 保
   工具定义），命中后 input 降 10×（Anthropic 0.1×/0.05×），预期单
   任务立省 50–80%。
3. **档位路由：结构性 + 判定性两刀**。lead/subagent 分工定档（Opus
   lead + Sonnet subagent 官方 90.2% 相对提升）；query 级路由器上
   RouteLLM 式小分类器（1500 条金标增强可启动，MT-Bench 口径可省
   85%）。
4. **预算工程**：prompt 里写死 effort scaling rules（Anthropic 三档）、
   per-task 三本账（token/美元/步数）、超限熔断 + partial deliver、
   死循环保险丝。
5. **瘦身**：工具结果外置为默认，摘要只压「终态段落」，截图类观测
   按分辨率/频率限流。
6. **任务分层**：把「agents 4× chat、multi-agent 15× chat」官方数字
   往老板面前一放——经济性本质是任务价值筛选器：低价值任务留给
   chat + 小模型，把 15× 预算砸在高价值任务上。

最后补一刀 business framing：若卖订阅，成本目标应是「单任务成本 <
用户可感知价值 × 转化系数」而非绝对降到底。

### 6.2 「怎么证明优化有效」：成本看板指标体系

- **北极星指标：cost per successfully completed task（不是 cost per task）**——质量下降会诱发重试，把质量损失换算回重试成本。这
  正是 FrugalGPT / RouteLLM 论证的基本形式（同成本下比准确率、或同
  质量下比成本）。
- 必备看板维度：
  - p50/p95 token per task（input/output 分列、cache hit rate）；
  - 工具调用次数分布（呼应 Anthropic：token、tool calls、模型选择
    解释 95% 性能方差）；
  - per-component 归因（系统提示 / schema / 历史 / 工具结果四块
    占比）；
  - 模型档位的流量分布 + 升档率；
  - 熔断触发率与部分结果交付率（健康区间告警）；
  - 单任务成本趋势 + 任务成功率趋势**同图叠加**——证明「省的不是
    质量」。
- 方法论：A/B 灰度新旧 harness 版本（Anthropic rainbow deployment
  明说为不中断在跑 agent）；离线回归集先测质量再放量；成本与成功率
  至少跑一个完整业务周期（weekly seasonality）。
- 汇报口径四件套：「成本降 X%、成功率持平（±统计窗内）、p95 延迟
  随并行化降 90%」配 Anthropic 15× 官方图做 business case。

### 6.3 高频追问速答卡

- Q：agent 为什么比 chat 贵一个量级？
  A：历史轨迹每轮重放（Manus 100:1 in/out，50 步均摊），input 随
  步数近似平方放大；multi-agent 再叠 3.75×（Anthropic 4× → 15×）。
- Q：最大的单点省钱杠杆？
  A：**cache hit rate**（Manus：生产 agent 最重要单一指标；input
  价差 10×）。
- Q：routing 会不会影响质量？
  A：RouteLLM 保 95% 性能换 >85% 省钱；agent 内 lead/subagent 分工
  反而提质（官方 90.2% 相对提升）。
- Q：Batch API 能给 agent 用吗？
  A：不能（交互/状态化/24h 窗口），只能给离线评测与批量数据管道
  用。
- Q：瘦身手段先上哪个？
  A：工具结果外置（零质量损失）→ 剪工具输出主体 → 摘要压终态段落
  → 截断兜底。
- Q：预算怎么下发给 subagent？
  A：prompt 级 scaling rules（1 任务 3–10 calls / 2–4 subagent 各
  10–15 calls / 复杂 10+）+ 账户级 token/步数/超时三账本 + 超限
  partial deliver。
- Q：怎么跟老板证明省了钱？
  A：cost per successful task 北极星 + 四块归因看板 + 成功率同图 +
  A/B 灰度。

### 6.4 口径与未核实说明

- 「agents 4× chat、multi-agent 15× chat」、「90.2% 相对提升」、
  「token 解释 80% / 三因子 95% 方差」、「50 subagent 反面教材」均
  出自 Anthropic Engineering 原文（2025-06，2026-10-12 实测可
  访问），引用时可给一手出处。
- 「100:1 in/out」、「50 tool calls 均值」、「cache 是最重要单一
  指标」出自 Manus 官方博客（2025-07），其中价差举例是 2025-07
  上一代模型价格口径。
- coding agent 系统提示的「1 万 token 量级」来自社区逆向，非官方
  口径。
- 「死循环烧百刀」是社区事故通例，无单一可引来源，引用时注明。
- 摘要压缩「约占原段落 1/3~1/2 token」是业界通例经验值，无官方
  数据源。
- LLMLingua 系列数字是 prompt QA 场景实测，agent 轨迹泛化性无官方
  验证。
- 全部价目为 **2026-10-12 当日定价页实测口径**，模型换代与促销期
  （如 gpt-5.6-sol 促销至 2026-11-21、Gemini 3.8 Flash 促销至
  2026-12-31）会变，引用必带观测点。
