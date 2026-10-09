# Agent 与 RAG 实战：从「toy 三件套」到工程级项目

> 本篇面向投「Agent 开发 / 大模型应用」方向的读者。素材来自三路：
> GitHub 候选项目实测、小红书面试官视角帖（「三件套太 toy 了」）、
> 一篇 80+ 场秋招面试官总结的 Harness 项目五模块框架。读完你会获得：
> **七条从 toy 到工程级的升级路线**、**一个五模块 Agent Harness 项目
> 模板（自带面试追问集）**、GitHub 候选项目对照表与组合套餐。
> 理论对接仓内 [agent/](../interview-questions/agent/) 与
> [rag/](../interview-questions/rag/) 目录。

## 一、「太 toy 了」：面试官到底在烦什么

一位做过 80+ 场秋招面试的面试官和两个学员帖交叉证实的现状：

> 「接入了 MCP，做了 RAG 检索，还实现了 Function calling」——
> 面试官接不上这句：**「你这个太 toy 了」**。

**toy 的精确定义**：只能跑通 Demo，离工程化差得远。面试官的比喻：
「买了 CPU、内存、硬盘插在主板上，这不叫电脑——**MCP 是接口协议、
RAG 是知识检索、Function calling 是工具调用，但它们都只是零件；
把它们串起来的推理框架、记忆管理、多 Agent 协作、成本优化才是操作
系统**。」三个不过岗的判断标准：

1. 没有处理过真实场景的复杂度（多模态输入/并发/权限/脏数据）；
2. 没有考虑过系统可扩展性（流程不是写死的）；
3. 没有做过性能优化（成本/延迟指标为零）。

另一个面试官金句，记牢：**「Demo 的流程是写死的，产品的流程是
动态的」**。

## 二、七条升级路线（从 toy 到工程级）

面试官亲口的 7 个方向，每人都选一个做深：

| # | 升级方向 | toy 版 → 工程版 | 面试讲解点 |
|---|---|---|---|
| 1 | 多模态输入 | 只读文字 → 统一理解文字/图片/语音后转标准格式 | 「架构能不能兼容不同模态的数据流」 |
| 2 | 自主决策（ReAct） | 流程写死（提问→查库→调工具→返答案）→ Agent 按问题类型/上下文复杂度/知识库覆盖率实时选择路径 | 对照 [agent基础与规划](../interview-questions/agent/agent基础与规划.md) 的 ReAct 选型 |
| 3 | RAG 别暴力检索 | 每问必查 → Agentic RAG（自己决定检索策略）/ 知识图谱增强 / 动态路由 | 「让检索更聪明，而不是更暴力」 |
| 4 | 自适应检索层 | LLM 自己判断要不要检索、检哪个库、要不要多轮补检——实现为轻量推理层 | 「面试官很喜欢问这个点」：对 RAG 的深度理解 |
| 5 | 长期记忆 | 对话摘要（压缩历史）+ 用户画像（偏好/常用需求），memory agent 定期摘要并向量化 | 「越用越懂你」——对照 [记忆与上下文工程](../interview-questions/agent/记忆与上下文工程.md) |
| 6 | 多 Agent 协作 | 单 Agent 全包 → 拆意图识别/检索/回复生成多 Agent，CoT 分工 | 调度怎么分配任务、怎么同步状态、怎么处理冲突 |
| 7 | 自研微调 | 通用模型不够用/太贵 → LoRA 微调专用模型 | **坑：训练集/验证集/RAG 知识库不能重合**（会被模型记住→RAG 价值削弱+过拟合）——三者互不重叠，面试官很爱问 |

**简历句式对照（面试官给的原文示例）**：

- ✗「实现了 MCP、RAG、Function calling 的 Agent 系统」——一看就是
  入门；
- ✓「设计并实现了多 Agent 协作的客服系统，包含意图识别、知识检索、
  回复生成三个模块，通过 [框架] 实现调度与状态同步」；
- ✓「实现了自适应 RAG 检索策略，LLM 根据问题类型动态决策检索路径，
  检索准确率从基线 65% 提升到 82%」；
- ✓「引入长期记忆机制，对话摘要与用户画像双轨存储，用户重复提问率
  下降 40%」。

前一句在说功能，后三句在说**价值**。

## 三、完整项目模板：Agent Harness 五模块

更高的版本来自面试官的秋招总结（80+ 场样本）：今年的简历必须讲清
**「Agent 到底端到端完成了什么复杂的任务」**。他给的骨架可直接当
项目蓝图复刻（也默认会成为面试官的对照答案）：

| 模块 | 内容 | 简历里长什么样（原文句式） |
|---|---|---|
| Context | 分层（稳定层/任务层/工作层）、按需装配、版本与失效（保留依据与口径：币种/时区/归因）、压缩与预算 | 「按店铺、活动与决策阶段装配分层上下文，结合结构化经营状态、报表口径和证据引用控制历史增长」 |
| Agent Loop | 观察状态→选择动作→执行→验收；目标重规划（任务依赖、局部改计划复用产物、区分继续/等待/结束、空转停止、预算不足降级） | 「设计目标与状态驱动的 Agent Loop，以任务依赖和经营反馈更新计划；动态选择查询、操作或等待动作，执行前校验约束」 |
| Tool 组件 | 能力注册表（描述/Schema/市场/权限/副作用/成本）、按需选择、契约验证、适配器替换 | 「建设能力注册表与平台适配层，支持同类工具替换及新能力注册；由 Agent 动态选择并通过契约验证执行结果」 |
| 工程运行时 | 持久化状态、调度与等待、并发控制、故障恢复、全链路 Trace | 「实现持久化计划、事件唤醒与检查点恢复，管理共享预算和受限并发」 |
| 系统化评估 | Loop/Context/Tool/Runtime/Business 五维独立验收，对照与消融、故障注入、回归 | 「在有状态环境中验证动态工具选择与适配器替换，开展对照、消融和回归」 |

他的**简历主线公式**：业务价值 → 决策难点 → 系统设计 → 验证结果。
示例他找到一个真实业务场景（跨境电商新品首周验证，预算 ≤300 美元
遵守毛利/库存/权限约束）——成立条件三条：**业务价值成立、决策有真实
后果、交付影响下一步**。

**面试官给自己的项目出的追问集**（预演四道题）：

1. 同一目标换一组经营数据，为什么调用另一组工具？
2. 低转化后为什么先查配送而不是立刻改价？
3. 两个子任务同时申请预算，如何避免各自都认为还有足够余额？
   （共享预算「已消费/已预留/待确认」三账并发记账）
4. **广告创建超时怎么处理？** 「请求超时 ≠ 远端未执行」：先持久化
   意图 → 进 UNKNOWN → 用幂等键核对远端 → 找到则接回原任务 /
   确认未执行且满足重试条件才受控重试 / 仍不明确则继续核对或交接，
   **不盲目重建**。

**没做过怎么做出来的合规路径**（面试官自己给的）：搭有状态模拟平台
+ 虚拟时钟推七天 → 基础角色循环 → 主动制造困难分支（点击低/转化弱/
库存不足/工具下线）→ 补预算竞争、写入丢响应、重启恢复与评测。
**面试该拿出的证据**：同一目标的两条不同执行轨迹、一次工具替换与
新能力接入、一次失败恢复、一份固定口径的评测报告；**写清实现与
接入边界，模拟运营不能写成真实业绩**。

## 四、GitHub 候选项目对照（star 为 2026-10 当日值）

| 候选 | star | 一句话 | 面试讲解角度 | 防「调 API」包装 | 性价比 |
|---|---|---|---|---|---|
| [FoundationAgents/OpenManus](https://github.com/FoundationAgents/OpenManus) | 58.6k | 最小 General Agent 框架，ReAct + browser/shell/editor 工具 | 工具容错 + 成本护栏 + step 记账 | 只做硬化：错误分类（可重试/不可重试/schema 失败）+ 每步 token 记账 | 5 |
| [huggingface/smolagents](https://github.com/huggingface/smolagents) | 29.8k | CodeAgent 极简库（核心理念：agent 写代码而非 JSON 调工具） | CodeAct vs JSON-FC 范式 trade-off（组合性/token/上下文污染） | 同一批任务双范式 A/B：成功率 + token 消耗量化 | 4 |
| [自写 MCP server](https://github.com/modelcontextprotocol/servers) | 91k(参考库) | 官方 7 个参考 server：fetch/filesystem/git/memory/sequentialthinking/time | 工具描述工程（写得好模型才选得准）、结果分页防 context 爆炸、鉴权/只读围栏 | 自写一个对业务真实场景的 server（wiki/SQLite/arXiv） | 5 |
| [dzhng/deep-research](https://github.com/dzhng/deep-research) | 19.8k TS | 递归式 query 规划 → 搜索 → 反思深化 | 深度/宽度预算控制、中间结果如何进 prompt | 补成本-质量曲线实验 | 4 |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | 30k | 多 agent 分工的 deep research + citation 追踪 | 多 agent 编排 vs 单 agent 递归对比；引用校验 | 加「引用幻觉检测」：每个 claim 是否在 retrieved chunks 找到支撑 | 4 |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | 43k | 图编排事实标准（state graph + checkpoint + HITL） | checkpointer = 断点续跑与记忆分层标准答案；interrupt/resume = HITL 兜底 | 用它重构一个 deep research，讲「手写 loop → 图编排」的工程判断 | 4 |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 90.4k | 最大开源 coding agent：事件流 + Docker 沙箱 | 事件溯源支持中断恢复、历史事件压缩、沙箱隔离 | 只挑一个子系统下钻（event stream compaction 或 runtime 沙箱）写成源码精读 | 3 |
| **垂直 RAG 链路（自研）** | — | 自选垂直语料：混合检索(BM25+向量)→rerank→citation 校验→eval 回归 | 四维度全覆盖：超时降级/多轮 query rewrite/rerank 只对 top-k/RAGAS 回归 | **别找现成「生产模板」**——社区没有高 star 权威，手写反而可信 | 5 |

**评估/追踪组件（给任何项目副着加分）**：
langfuse（35.6k，三行接入，trace + 成本看板直接覆盖「成本预算」与
「badcase 回流成 eval 集」两个面试维度）、promptfoo（25.8k，
CI prompt 回归 + 红队测试）、ragas（16k，faithfulness/context
precision 等指标——**必问，说不出指标定义反而扣分**）。

## 五、组合套餐（按时间预算）

| 预算 | 组合 | 核心故事 |
|---|---|---|
| 1 周 | OpenManus 硬化 + langfuse | 工具容错 + 成本护栏 + 全链路 trace |
| 2 周 | 自写 MCP server + 垂直 RAG（混合检索 + rerank + RAGAS） | MCP 权限/工具设计 + 评测驱动迭代 |
| 1 月+ | 上两行 + LangGraph 重构 deep research + OpenHands 子系统精读 | 编排/记忆/恢复 + 大型 agent 工程理解 |

**通用三板斧（任何项目都有）**：① 至少一个自己设计的对比实验/
量化指标（成本-质量曲线、范式 A/B、检索召回率）；② 至少一处失败
处理代码并在简历点名（重试分类、降级、超时）；③ 至少一个项目带
离线 eval 集 + CI 回归（promptfoo/RAGAS）——**「评测驱动」四个字是
最强的反调-API 信号**。

## 六、真题对照

| 真题（仓内面经来源） | 项目里的答案 |
|---|---|
| 工具调用报错/超时/schema 不符怎么处理（面试官视角四层自检） | OpenManus 硬化第三板斧 + 超时幂等核对流程（本篇章三节） |
| 会话第 20 轮丢关键信息怎么排查 | 长期记忆设计（摘要+画像）+ LangGraph checkpointer |
| 为什么选状态机不是线性 Chain、分支失败怎么回滚 | LangGraph 重构题——「手写 loop → 图编排」的工程判断 |
| 同一个工具同参数重复调用怎么中止 | harness 帖追问集 Q1-Q4 + 成本护栏 |
| RAG 怎样评测、RAGAS 指标 | 垂直 RAG 链路 + ragas 副件 |

## 串联阅读

- 面试侧：[小红书社招面经合集](../interview-experiences/小红书社招面经合集-2026h2.md)
  （阿里 Agent 一面 17 题、面试官视角四层自检）
- 理论：[agent基础与规划](../interview-questions/agent/agent基础与规划.md)、
  [工具调用与mcp](../interview-questions/agent/工具调用与mcp.md)、
  [记忆与上下文工程](../interview-questions/agent/记忆与上下文工程.md)、
  [rag全链路](../interview-questions/rag/rag全链路.md)、
  [评测与建库工程](../interview-questions/rag/评测与建库工程.md)
- 落地简历：[简历篇章](../resume/README.md)
