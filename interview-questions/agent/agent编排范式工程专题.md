# Agent 编排范式工程专题：固定 DAG × 状态机运行时 × 自由 loop 的可靠性光谱

> **面向**：已读过 [agent基础与规划](./agent基础与规划.md)（ReAct 与 workflow/agent
> 定义）、[langchain与编排框架](./langchain与编排框架.md)（四组件与六路径选型）、
> [多agent与评测](./多agent与评测.md)（三种协作模式与评测分层）的读者。本篇把
> 「编排结构」本身当作工程对象：三种范式在可靠性、可维护性、可观测性上怎么取舍，
> 2024 末到 2026 两年间收敛出了什么共识，以及面试官最爱追问的「为什么是 LangGraph
> 不是 Dify」「什么时候不要框架」怎么答。入门概念不再重复。
>
> **读完获得**：① 范式三分法（固定 DAG / 状态机图运行时 / 自由 loop）与可靠性
> 等级适配表；② Anthropic《Building Effective Agents》workflow vs agent 的官方
> 口径与五种 workflow 积木；③ OpenAI Agents SDK handoff/guardrail 与 LangGraph
> durability 的一手工程细节；④ 三大工程难点（loop 可观测、DAG 节点爆炸、混合
> 嵌套）的已收敛解法；⑤ 失败模式与兜底工程对照表（人审节点 vs 最大步数/同参数
> 检测）；⑥ star 趋势数字锚（2026-10-12 实测）与企业选型口径；⑦ 四道高频面试题
> 的完整答法。
>
> **时效口径**：素材口径 **2026-10-12**；star 当前值为当日 api.github.com 实测，
> 历史锚点一律标「约」（公开报道口径，未逐一核实）；官方引文按原文口径括注。
> 未核实项见文末「口径与未核实说明」。

## 〇、主线一句话：可靠性需求是上界，自由度是从下往上逼近上界的工具

把市面所有 agentic 系统的编排结构按「控制流由谁决定」压到一根数轴上，只有
三种范式：**固定 DAG（人写死全部路径）、状态机图运行时（人定拓扑、模型选边）、
自由 agent loop（模型即时生成节点）**。2024 年底 Anthropic BEA 一篇博文把
workflow 与 agent 的边界定义收敛，2025-26 两年的工程实践把「什么时候用哪个」
收敛成一句话：**先定 SLA/审计/预算等级，再决定范式，而不是反过来先选「最潮的
agent」再硬塞兜底**。本篇所有细节都是这句话的展开。

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-orchestration-spectrum.html" width="100%" height="840" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-orchestration-spectrum.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、范式三分法：固定 DAG / 状态机图运行时 / 自由 agent loop

### 1.1 范式 A：固定 DAG（declarative dataflow graph）

代表：Dify flow、Coze（扣子）画布、n8n、LCEL 管道、Rivet。

特征：节点等于一次 LLM 调用/工具调用/代码块，边等于数据流向，全部人工拖拽或
代码写死，本质是「流程图加 LLM 节点」。没有模型在运行时决定去哪个节点，最多
内嵌一个 if/else 条件路由节点。

十二要素 agents（12-Factor Agents）作者 Dex Horthy 的表述最准：**软件本来就是
有向图，Airflow/dagster/inngest 这一代 DAG 编排器早就把观测、模块化、重试、
管理吃过一遍螃蟹，LLM 节点只是 DAG 上多了一种新型节点**。这句话的面试价值
在于把「agent 编排」从玄学拉回普通软件工程：你不需要为新节点发明新世界观。

### 1.2 范式 B：状态机 / 图运行时（state machine runtime）

代表：LangGraph（StateGraph + checkpointer）、微软 Agent Framework 的
workflow/edge 模型、Temporal 式 durable workflow 包一层 agent。

特征：结构声明式（节点与条件边人定），但允许循环回边、条件路由由模型输出决定，
即「图的拓扑是人定的，走哪条边可以是模型定的」；配 checkpoint 持久化做到断开
续跑、HITL 中断、time-travel。**这是 DAG 与 loop 的中间地带，也是 2025-26
生产侧的收敛点**（详见第七节）。

### 1.3 范式 C：自由 agent loop（single loop + tools）

代表：Claude Code、Codex CLI、SWE-agent、Devin 主线、各种「一个 while 循环
加工具箱」的 harness。

结构代码 50 行就能写完：while not done，模型决定下一步，执行工具，结果追加进
context，模型再决定。没有显式节点图，「节点」由模型即时生成。Horthy 的原话
值得背：「**学习 agent 最大的收获是你可以把 DAG 扔掉——只给 LLM 图的边
（可用工具集合），让它自己算节点。**」

### 1.4 各适合什么可靠性等级

把可靠性需求粗分 R0 到 R4（可预算可审计 → 开放式不可预知），三范式的适配
关系是面试骨架：

| 范式 | 适配等级 | 典型场景 | 代价 |
|---|---|---|---|
| A 固定 DAG | R0-R1：可预算、可单测、可审计 | 退款、报销、客服标准问答分流等合规场景 | 长尾输入要么掉线要么 fallback 烂 |
| B 状态机运行时 | R2-R3：长任务、人审、断点恢复刚需 | 进件审批、多步业务流嵌小 agent | 引入运行时与状态存储的复杂度 |
| C 自由 loop | R3-R4：开放式任务、步数不可预知 | coding、深度调研、运维排查 | 成本延迟不可预算、错误复合 |

两个补注：

- 范式 B 是「人审/长任务/断点恢复」刚需的唯一结构：流程骨架确定、局部自由度
  给模型、状态可持久化到 DB，这三件事范式 A 做不全、范式 C 不想做。
- 范式 C 的适用前提 Anthropic 原话是「agents 适合在 trusted environments 里
  scaling」——开放式自由度只在环境可信、副作用可控时成立。

**金句记好：可靠性需求是上界，自由度是从下往上逼近上界的工具。**

## 二、Anthropic BEA 官方口径：workflow vs agent 何时用哪个

《Building Effective Agents》（2024-12，2025/26 多次被官方回链，anthropic.com/
research/building-effective-agents）是这块的事实标准文本，定义与原则直到 2026
仍是各家引用源头。

### 2.1 两个定义（极高频，原句口径）

- Workflows are systems where LLMs and tools are orchestrated through
  predefined code paths.
- Agents are systems where LLMs dynamically direct their own processes and
  tool usage, maintaining control over how they accomplish tasks.

译成工程语言：**路径是否预定义**是唯一分界线，跟「用了几个模型」「有没有
for 循环」「是不是多 agent」都无关。一个 50 行 while 循环如果每步走哪个分支
都是 if/else 写死的，它是 workflow；一个单节点的图如果出边由模型输出当场
决定，它有 agent 成分。

### 2.2 用 agent 时机的三原则

1. **Find the simplest solution possible, and only increasing complexity
   when needed. This might mean not building agentic systems at all.**
   能不 agent 就不 agent，这是第一原则。
2. **Agentic systems often trade latency and cost for better task
   performance.** 成本与延迟换性能，划不划算要先算账。
3. **When more complexity is warranted, workflows offer predictability and
   consistency for well-defined tasks, whereas agents are the better option
   when flexibility and model-driven decision-making are needed at scale.**
   良定义任务用 workflow 换可预测，需要规模化的模型驱动决策才上 agent。

agent 的准确定位原文是：open-ended problems where it's difficult or
impossible to predict the required number of steps, and where you can't
hardcode a fixed path。**步数不可预知加路径不可写死，两个条件同时成立才是
agent 的合法领地。**

### 2.3 五种 workflow 积木（背名词加一句话场景）

prompt chaining（串步加中间 gate）/ routing（分类分流）/ parallelization
（sectioning 并行切分加 voting 投票）/ orchestrator-workers（主编排子任务）/
evaluator-optimizer（生成-评估循环）。面试展开时每个给一句「什么时候用」就够，
细节见 [agent基础与规划](./agent基础与规划.md)。

### 2.4 对框架的态度（面试直接可用）

原文要点（按原文口径转述）：框架「often create extra layers of abstraction
that can obscure the underlying prompts and responses, making them harder to
debug」；建议「developers start by using LLM APIs directly: many patterns
can be implemented in a few lines of code」；要用框架就「ensure you
understand the underlying code」，因为对底层的错误假设是常见客户错误来源。
**直白版：先用裸 API，大多数 pattern 几十行代码就够；框架的抽象会挡住你看
prompt 与 response，这是调试噩梦与客户错误的共同来源。**

三大设计原则：maintain simplicity / prioritize transparency（显式展示 agent 的
规划步骤）/ carefully craft the agent-computer interface（ACI——像做 HCI 一样
投入工具的文档与测试）。

2026 注脚：官方在页面顶部加注「此篇工具生态已过时，见 Claude Managed
Agents」——**不变的是定义与原则，过时的只是工具截面**，这个区分本身就是
加分项。

### 2.5 配套实证：《How we built our multi-agent research system》（2025-06）

Anthropic 把「何时用 loop/何时用编排」讲成了单位经济学：

- token 账：agents 约 4x token vs chat，multi-agent 约 15x token vs chat，
  所以「multi-agent 只在任务价值足够高且可并行时成立」。
- BrowseComp 分析：三个因子解释 95% 方差，其中 token usage 单独解释 80%。
  **多 agent 本质是「花更多 token 买性能」的杠杆，不是所有任务都该升级范式。**
- 硬数字：Opus 4 lead 加 Sonnet 4 subagents 的多 agent 系统比单 Opus 4 agent
  在内部 eval 高 90.2%，但成本 15x token——「值得的任务才配多 agent」。
- effort scaling rules：简单任务 1 个 agent 3-10 次 tool call、对比类 2-4 个
  子 agent 各 10-15 次、复杂任务多于 10 个子 agent 且分工明确；让 orchestrator
  显式判断 effort，而不是自发扩到 50 个子 agent。
- ACI 投入的产出比：改工具描述后 task completion time 降 40%（自测 100+ 次
  修正工具简介的口径）。

## 三、两家的工程化答案：OpenAI Agents SDK 与 LangGraph durability

### 3.1 OpenAI Agents SDK：三条原语打天下

2025-03 由 Swarm 转正（openai.github.io/openai-agents-python，2026 版仍有效）。
三条原语：Agents（instructions 加 tools 加内置 loop）、Agents as tools /
Handoffs（委派）、Guardrails（输入/输出守卫）。设计原则原话：「Enough
features to be worth using, but few enough primitives to make it quick to
learn.」——薄抽象是明确的设计目标。

**Handoff 的三个工程细节**（一手口径，面试追问全靠这些）：

- handoff 对 LLM 呈现为工具，命名 transfer_to_加 agent 名；
- 接管方默认看到全部对话历史，可用 input_filter / handoff_filters 裁剪
  （如 remove_all_tools）；nest_handoff_history 是 2026 的 opt-in beta，
  把历史压缩成有序摘要段再交接；
- 边界规则：**输入 guardrail 只对链上第一个 agent 生效，输出 guardrail 只对
  最终输出 agent 生效**，中间要做工具级检查请用 tool guardrails。

**Guardrail 的工程点**（可直接用于「DAG vs loop 的兜底」对比）：

- parallel（默认，低延迟但可能已经烧 token）与 blocking（先过守卫再跑 agent，
  省钱免副作用）两种模式；
- tripwire 触发后 runner 直接抛异常停整段 run；
- tripwire 的 session 持久化语义细到「被拒内容不落盘、落占位符 Output
  withheld by an output guardrail」——**这是架构层面的数据卫生，不是
  prompt 层面的恳求**。

### 3.2 LangGraph 的 durability 设计

持久化分两套（docs.langchain.com 官方口径）：

- **Checkpointer**：thread 级，graph 状态快照——对话连续、HITL、time
  travel、容错；
- **Store**：跨线程的应用自定义 key-value——长期记忆、用户偏好、共享知识。

写进官方文档的生产事故教训（面试里讲这些比讲概念硬核得多）：

- PostgresSaver 的 thread_id 超 255 字符会炸；
- MemorySaver 进程重启全丢，生产必须上 Postgres/Sqlite；
- 长对话的 checkpoints 无限增长，要定期 prune 或设保留策略；
- 子图 checkpoint 命名空间独立，跨图共享数据走 Store 而不是指望父图即时感知。

LangGraph 对「可靠 loop 需要什么」的回答是：persistent thread state 加
resume/approve/interrupt 加 durable workflow 的可配置重试——LangChain 官方
明确在对标 Temporal 的 fault tolerance。**状态机运行时卖的不是「帮你少写
循环」，而是持久化、中断、恢复这一整套 durable execution。**

### 3.3 反方纲领两篇（自由选择一侧时必引）

**Cognition《Don't Build Multi-Agents》（2025-06）**，两条 context
engineering 原则：① Share context, and share full agent traces, not just
individual messages；② Actions carry implicit decisions, and conflicting
decisions carry bad results。结论：默认排除一切违反这两条的多 agent 结构，
生产首选 single-threaded linear agent；Claude Code 的 subagent 被点名「特意
简单」——只回答问题不写代码、不与主线并行，因为子 agent 缺主线 context。
长任务靠另一个 model 压缩历史与决策，而不是拆 agent。

**12-Factor Agents（Dex Horthy/humanlayer，2025-04 起持续更新）**，「什么时候
不需要框架」的最系统回答：

- 「我见过大多数挂着 AI Agent 招牌的产品其实没那么 agentic——大量是确定性
  代码，LLM 点缀在对的点。」
- 创始人经典旅程：拿框架快启动，做到 70-80% 质量，发现客户场景 80% 不够，
  想再往上就要逆向框架，最后推倒重来。
- agent loop 三步原型：LLM 决定下一步（structured json），确定性代码执行
  工具，结果 append 进 context，循环到 done。
- 十二条原则（own your prompts / own your context window / own your
  control flow / unify execution 与 business state / launch-pause-resume
  with simple APIs / contact humans with tool calls / small focused
  agents / stateless reducer 等）本质是一句话：**拿走框架，保留好的工程
  实践，把 LLM 嵌进你现有的软件里。**

## 四、工程难点：三种范式的真实战场

### 4.1 自由 loop 的可观测性与调试

难点是三合一：非确定性加超长轨迹加错误复合。同样 prompt 两次跑出不同轨迹；
用户报「找不到明明存在的信息」时，你要回放整条轨迹判断是 query 写得烂、
资料选错、还是工具失败。

已收敛的工程手段（一手来源）：

1. **全量 production tracing 加高层观测**：Anthropic Research 的做法是不看
   私聊内容，只监控决策模式与交互结构；LangChain 官方把 debugging/
   observability 列为 agent 框架与 workflow 框架都要提供的公共能力。
2. **thinking-as-scratchpad**：lead agent 的规划以可见 thinking 输出，
   subagent 在 tool 结果后做 interleaved thinking 评估质量并决定下一
   query——把「决策理由」留在轨迹里，事后归因才有原料。
3. **状态与工作制品分离**：subagent 的产物写文件系统/artifact store，只把
   轻量引用回给 orchestrator，避免「传话游戏」失真与 token 放量（Anthropic
   附录口径）。这本质是 loop 版的「DAG 节点产物落盘」。
4. **评估做 end-state evaluation 而不是逐步对比**：多步会产生路径多样性，
   承认路径不同但终态相同的合法解；复杂场景按 checkpoint 评估状态变化。
   LLM-as-judge 用单一 prompt 出 0 到 1 分加 pass/fail，比多 judge 更贴近
   人类判断。
5. **12-factor 的可观测骨架**：factor 3/6/8/12（own your context window、
   launch/pause/resume 简单 API、own your control flow、stateless reducer）
   合起来就是一套不依赖大框架的 loop 可观测底座。

### 4.2 固定 DAG 的维护成本与节点爆炸

典型塌方路径（业界共性，与 Dify/Coze 社区反馈一致）：

- 业务方每次提一个 if，画布多几个分支节点，几个月后单个应用画布上百节点，
  没人敢动；
- LLM 节点之间靠 Jinja/变量引用串数据，schema 一改就是手工全局搜索替换；
- 版本管理弱：图是 JSON 躺在 DB 里，没有 code review、没有 diff、没有灰度，
  回滚靠导出导入；
- 测试只能整图 e2e，单节点单测要靠 mock，分支覆盖做不了；
- 「给运营搭建」的愿景变成「只有搭的那个人会改」，组织上造了新瓶颈。

正面也要讲：Dify self-hosted、开源、私有化，是金融/国企/出海的常见选择；
「流程确定加非技术运营要看得懂」的场景 ROI 仍然成立。**判断标准一句话：
图的复杂度有没有超过「5 到 10 个节点加 3 到 5 条分支」这个肉眼可审计的
门槛。**

### 4.3 中间态：状态机里嵌子 agent 的混合方案（2025-26 收敛点）

LangGraph 官方《How to think about agent frameworks》给出最精确的概括：
「Nearly all of the 'agentic systems' we see in production are a combination
of 'workflows' and 'agents'.」以及「Take all the workflow diagrams in
Anthropic's blog post, and replace the LLM calls with agents. This blend of
workflows and agents often gives the best reliability.」

工程上对应三类常见模式：

1. **骨架确定性、局部自由度**：图骨架固定（进件 → 风控 → 意图 → 分流 →
   执行 → 复核），个别节点内部是一个小 agent loop（「这个退款理由拿不准，
   给 8 步工具 loop 自己查清楚」），loop 出口回图。
2. **子 agent 作为节点而不是并行同事**（Cognition 原则）：子 agent 只做信息
   检索/压缩，不写共享状态，主线保持单线程决策权。
3. **DAG 内部有一处 handoff**（OpenAI 风格）：分流节点用 handoff 把控制权
   和裁剪后的历史转给专科 agent，guardrail 守住入口与出口，triage 到
   refund/billing 是教科书形态。

配套持久化：图骨架 checkpoint（断点续跑加审计），子 agent 自己的 thread 隔离
（避免互相污染），跨边界数据走 Store——LangGraph 文档里「子图命名空间」一节
专门讲这个坑。

## 五、失败模式对比与兜底工程

### 5.1 固定 DAG 的病：结构性脆（不可回溯、分支爆炸）

- **长尾掉线**：分支没覆盖到的输入没有「自己想办法」的能力，只能进兜底
  人工/FAQ 节点；DAG 没有「走错了退两步重来」的原语——图是 acyclic 的，
  回边要靠工程上再造。
- **节点级静默错配**：上游 prompt 改了，下游 Jinja 变量引用悄悄空值，整条
  链静默降级——比 crash 更难发现。所以 Anthropic 在 prompt chaining 里明确
  建议中间步加 programmatic gate。

兜底工程四件套：

1. **中间 gate/校验节点**：结构校验加业务规则加抽样 LLM judge；
2. **人审节点（HITL）**：在 DAG 里最便宜，就是一个可挂起的审批节点，
   Dify/Coze/n8n 都原生支持；
3. **dead-letter 路径**：任何节点失败或低置信，分支到人工队列；
4. **版本化加灰度**：把 graph JSON 纳入 git，按租户灰度。

### 5.2 自由 loop 的病：行为性野（跑偏、死循环、错误复合）

典型失败与对应的数值缰绳（一手来源都有）：

| 失败模式 | 现象 | 兜底工程 |
|---|---|---|
| 死循环/同参数复读 | 对同一工具用同样参数反复调用却无进展 | 最大步数（max iterations，Anthropic 列为 stopping condition）；同参数检测（连续 N 次相同 工具加参数 哈希触发中断或注入反思提示）；每步 token/成本熔断；wall-clock 超时 |
| 目标漂移 | 跑着跑着开始解决别的问题 | 显式 checkpoint 让 agent 定期自评「是否还在解原问题」；evaluator-optimizer 结构里独立评估 LLM 每 N 步回看 |
| 错误复合 | 一步错把轨迹带进沟里回不来 | 持久化 checkpoint 加 resume from checkpoint（**不能 fail-restart，要 resume**，Anthropic 原话口径）；让模型感知工具失败并适应；确定性重试 |
| effort 失控 | 为简单问题 spawn 50 个 subagent | prompt 级 effort scaling rules 加资源预算硬上限 |
| HITL 冲高回落 | 事事人审，失去 agent 意义 | 分级授权：只读工具自动放行，写工具按金额/影响面分级进审批；等价于 OpenAI guardrail 的 blocking 模式 |

补一条 Anthropic 的反直觉发现：letting the agent know when a tool is failing
and letting it adapt works surprisingly well——**把工具失败如实告诉模型让它
适应，比遮丑重试效果好得出奇。**

### 5.3 一句话对照（面试可直接背）

**DAG 的病是「结构性脆」（不可回溯、分支爆炸），loop 的病是「行为性野」
（跑偏、复合错误、预算不可知）；DAG 的兜底是往图里加骨架外的安全网（人审、
gate、dead-letter），loop 的兜底是给自由度套数值缰绳（步数、预算、同参数
检测、熔断、分级授权）。**

### 5.4 共同点：无论哪种范式都要的 9 件事

LangChain 官方清单：short-term memory、long-term memory、HITL、
human-on-the-loop（轨迹回放加从中间步重跑）、streaming、debugging/
observability、fault tolerance（durable workflow 加可配重试）、
optimization（eval 驱动），以及 agent abstractions 本身。LangChain 的论点：
除最后一项，前 8 项对 workflow 和 agent 通吃——**所以「框架价值」不等于
「抽象价值」，这是面试里非常加分的一个区分。**

## 六、数字锚：star 趋势与企业选型（2025-26）

### 6.1 GitHub star（2026-10-12 实测 api.github.com）

| 项目 | star | 叙事 |
|---|---|---|
| n8n-io/n8n | 207,074（fork 61,092） | 2025 年初约 5 万、年中破 10 万，2026 翻约 4 倍到 20 万+，自动化工具里增长最猛，吃「AI 加老牌自动化」双红利 |
| langgenius/dify | 158,232（fork 25,010） | 2025 年初约 4-5 万、年中约 8-9 万，一年半翻约 3 倍，开源 LLM 应用平台第一档 |
| langchain-ai/langchain | 147,676 | 2025 年初约 9 万，增长放缓但存量第一，连接器生态是护城河 |
| microsoft/autogen | 61,375 | 2025 年初约 3 万；微软 2025 末把 AutoGen/Semantic Kernel 收拢进 Agent Framework，老库进入维护叙事 |
| crewAIInc/crewAI | 59,598 | 从约 2 万到 6 万，「多角色演示」叙事的红利与瓶颈并存 |
| langchain-ai/langgraph | 43,126 | 2025 年初约 6 千、年中约 1.5 万，增速最快的状态机运行时 |
| openai/openai-agents-python | 29,984 | 2025-03 才转正（Swarm 后继），一年半 3 万，薄抽象加厂商绑定的现实速度 |

口径提示：**star 不等于生产采用，但趋势足以说明 2025-26 的钱与人心**——
双击点是 n8n/Dify（确定性编排加 AI 增强）与 LangGraph（状态机），纯抽象层
（Crew 式角色扮演）增速垫底，与「能写死就别用 agent」的收敛完全一致。

### 6.2 企业选型的一手口径

- LangChain 官方客户故事页（langchain.com/customers，2026 在展）：ServiceNow
  用 LangChain 加 LangSmith 做 GTM 编排层；Cisco 用 LangSmith 集中 agent
  观测；Toyota 把 LangSmith 当「agent 的安灯（Andon）板」；Salesforce 标准化
  agent eval；Clay 用 eval 加监控改 Claygent；Morningstar 的 AI 研究助手
  省分析师 30% 时间；Madrigal 把 AI 上线周期从 12 周压到 2 周。**共同点：
  选 LangGraph/LangSmith 的第一理由几乎都是「观测/eval/可恢复」，而不是
  「框架帮我少写循环」。**
- Sierra（客服 agent 平台）：不做「一个通用客服 agent」，而做 declarative
  语言加 composable skills 的平台，因为每家公司客服流程独特到通用 loop
  兜不住——这是「垂直领域用状态机/声明式而不是裸 loop」的商业实证。
- Dex Horthy 访谈约 100 个 SaaS 技术创始人的结论：生产级客户面向的 agent
  大量是 mostly deterministic code with LLM steps sprinkled in——「不上
  框架」**不是口号，而是约百家受访创始人的群体经验。**
- 反面教材也值得讲：LangChain 官方博客点名 OpenAI agents 指南存在「假二分」
  （把 declarative vs imperative 和 workflows vs agents 混在一起）。**面试里
  能复述这个争论本身就是高阶信号。**

## 七、2025-26 收敛态势总结（本篇立意句）

1. **定义已收敛**：workflow/agent 边界用 Anthropic 版本，「agentic 程度」用
   Andrew Ng 的形容词视角——讨论「是不是 agent」不如讨论「有多 agentic」，
   唯象争论结束。
2. **共识已收敛**：「能写死就别用 agent」「生产系统是 workflow 加 agent 的
   混合」「框架价值在记忆/中断/容错/观测，不在抽象」——Anthropic/LangChain/
   OpenAI 三家文本互相引用，分歧只剩实现形态。
3. **形态已收敛**：确定性编排（n8n/Dify 之涨）与状态机运行时（LangGraph
   之涨）吃掉中间地带；纯 agent 抽象层（角色扮演式）增速垫底；自由 loop 退回
   两个高价值领地——coding 与深度调研，且被模型厂商以成品 harness
   （Claude Code/Codex）直接提供，应用层不再需要自己发明 loop。
4. **工程问题未收敛（面试可发挥）**：durable execution 的最佳抽象（LangGraph
   checkpoint vs Temporal durable workflow vs DB saga）、跨 agent 上下文
   传递（Cognition 称之为未解难题）、agent 部署的 rainbow/灰度、end-state
   eval 的标准化——这些是 2026-27 的开放问题。

## 八、面试口径（可直接背）

### Q1：你们为什么用 LangGraph 不用 Dify？

答题骨架分四层，体现是「按需求推的选型」而不是个人偏好：

1. **先定性**：不是「LangGraph 比 Dify 好」，是两类东西。Dify 是产品化的
   LLM 应用平台（画布加托管加权限加知识库），LangGraph 是嵌进代码库的状态机
   运行时。**选谁看的是「编排的所有权归谁」。**
2. **摆三个 Dify 撞墙的约束**：（a）控制流复杂度高——回边、动态条件路由、
   子 agent 嵌套，Dify 画布得上百节点，无 code review、无单测、graph JSON
   无 diff，维护成本指数涨；（b）长任务要断点续跑加 HITL，需要 checkpoint
   进 Postgres、按 thread_id 恢复、人审中断-恢复，这是 LangGraph 的第一方
   特性；（c）观测要接既有 OpenTelemetry/LangSmith 和 eval 流水线，而不是
   平台自带的黑盒 trace。
3. **承认 Dify 的强项**：非技术运营自助、私有化快、知识库链路过硬；我们另
   一个流程固定、节点小于 10 个的内部工具就仍在 Dify/Coze 上跑，不折腾。
4. **收尾**：选型不是范式站队，是「控制流所有权 加 持久化/观测的深度 加
   维护者画像」三个维度交叉。

### Q2：什么时候不需要框架？

Anthropic 与 Horthy 两家口径的交集：

- **Anthropic 口径**：先用裸 API，大多数 pattern 几十行就能写；框架的抽象
  会挡住你看 prompt 和 response，是常见客户错误来源；要用也必须读得懂底层。
- **Horthy/12-factor 口径**：生产里跑得好的 agent 大量是「确定性代码加
  恰到好处的 LLM 步骤」；框架能帮你拿到 70-80%，但把 80% 推到客户可用往往
  需要逆向框架，不如从一开始就 own prompts / own context / own control
  flow。
- **实操判据（给面试官一个可执行清单）**：系统只需一次性/短链路回答，用裸
  调用或 LCEL 式 pipe；要长期记忆、HITL 中断-恢复、长任务容错、多人协作的
  eval 加 trace，上 LangGraph 类运行时；任务开放式且环境可信（coding/调研），
  自己写 50 行 loop 加工具箱加数值缰绳往往更好——每行控制流都是你的，正好
  对应 12-factor 的 factor 2/3/8。

### Q3：workflow 和 agent 你怎么分？

三层递进：

- **定义层**（Anthropic 原文）：predefined code paths vs LLM dynamically
  directs its own processes。
- **工程层**：看三件事——路径是否可预知、是否要求成本/延迟可预算、是否要求
  每步可单测可审计。**三条都「是」就上 workflow，否则才考虑 agent。**
- **现实层**（LangChain/Harrison Chase 原文）：生产系统几乎都是两者混合，
  「把 Anthropic 图里的每个 LLM 节点替换成小 agent」是最常见的高可靠结构；
  讨论「是不是 agent」不如讨论「有多 agentic」（Andrew Ng 的形容词论）。

### Q4：多 agent 什么时候值得上？

- **Anthropic 实证**：宽度优先、可并行、信息超单 context 的检索类任务，
  内部 eval 高 90.2%，但 15x token——只在高价值任务划算。
- **Cognition 反方**：违反 share context 与 actions carry implicit
  decisions 两条原则的多 agent 默认排除；coding 这种紧耦合任务单线程 loop
  更稳，Claude Code subagent 只读不写被点名为正确设计。
- **面试口径**：先问「子任务间要不要共享决策上下文」——共享则单 loop 加
  子任务压缩；不共享且高价值才上 orchestrator-workers，并给每个子 agent
  明确的目标、工具、边界、effort 预算。

## 九、口径与未核实说明

- star 当前值为 2026-10-12 对 api.github.com 的实测；历史锚点（n8n 约 5 万、
  Dify 约 4-5 万、LangGraph 约 6 千、CrewAI 约 2 万、AutoGen 约 3 万等）为
  公开报道口径，一律标「约」，未逐一回链核实。
- 「agents 约 4x token、multi-agent 约 15x token」「token usage 解释 80%
  方差」「多 agent 内部 eval 高 90.2%」「工具描述修正后 task completion
  time 降 40%」均为 Anthropic 官方博客自报口径，非第三方复测。
- 「客户场景 80% 不够要推倒重来」为 Horthy 对受访创始人经验的转述，属群体
  叙事而非统计面板。
- R0-R4 可靠性分级是本文为了表达「可靠性上界 vs 自由度」自造的助记刻度，
  不是业界标准术语，面试引用时建议先说明是自己的切分。
- 主要一手来源：Anthropic《Building Effective Agents》（2024-12）与《How we
  built our multi-agent research system》（2025-06）、LangChain《How to
  think about agent frameworks》（2025-03）、OpenAI Agents SDK 官方文档
  （2025-03 起持续更新）、LangGraph persistence/durable 文档、Cognition
  《Don't Build Multi-Agents》（2025-06）、HumanLayer《12-Factor Agents》
  （2025-04 起）、LangChain customer stories、api.github.com star 实测。

## 相关阅读

- [agent基础与规划](./agent基础与规划.md)：ReAct、五大 workflow 模式、定义表
- [langchain与编排框架](./langchain与编排框架.md)：LangChain 四组件、六路径选型
- [多agent与评测](./多agent与评测.md)：多 agent 三种协作模式、评测分层
- [观测与trace工程](./观测与trace工程.md)：production tracing 的落地细节
- [harness工程实战](./harness工程实战.md)：自由 loop 一侧的 harness 工程
