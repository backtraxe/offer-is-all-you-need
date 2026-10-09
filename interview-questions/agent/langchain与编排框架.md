# LangChain 与编排框架：积木、循环与「Rube Goldberg」争议

> 本篇面向被「要不要用 LangChain」「LangChain 和 agent harness 什么
> 关系」困惑的读者。2026 年的关键认知是：LangChain 早已不是一个库，
> 而是**组件标准（Core）+ 链式流水线（LCEL）+ agent 状态机
> （LangGraph）+ 观测平台（LangSmith）** 的组合；它和本仓主角
> 的 coding harness（pi/dsh/codex）不是同一物种——前者是**编排
> 框架**，后者是**成品 agent**。读完你会获得四组件定位、六条路径
> 的选型表、以及「编排框架过时了吗」的平衡判断。

## 一、是什么：四个组件各管一段

| 组件 | 干什么 | 一句话定位 |
|---|---|---|
| **LangChain Core** | 模型/工具/prompt/messages 统一抽象 | LLM 调用的标准件 |
| **LCEL** | `prompt \| model \| parser` 管道拼流水线，流式/批量/fallback 白送 | 声明式 DAG |
| **LangGraph** | 把 agent 流程建成**状态机图**：节点=函数、条件边、循环回边、HITL 中断、checkpoint 持久化 | 真正的 agent 运行时（现在的主战场） |
| **LangSmith** | trace/评测/监控 | 观测闭环 SaaS |

另有几百个 provider/工具/向量库适配器——**连接器生态是它最大的
现实价值**。

## 二、怎么用（两个层次）

```python
# 链式（LCEL）：适合总结/抽取/翻译类单调用任务
chain = prompt_tmpl | ChatOpenAI(model="gpt-4o-mini") | StrOutputParser()
chain.invoke({...})        # / .stream() / .batch()

# 图式（LangGraph）：适合有循环/审批/恢复的 agent
graph = StateGraph(AgentState)
graph.add_node("reason", call_model); graph.add_node("act", run_tools)
graph.add_conditional_edges("reason", router, {"tool": "act", "done": END})
graph.add_edge("act", "reason")                       # ReAct 循环回边
app = graph.compile(checkpointer=SqliteSaver())       # 持久化断点
app.invoke({...}, config={"thread_id": "s1"})         # thread 维度恢复
```

**LangChain 给你积木，LangGraph 给你循环**——只会
`prompt|model|parser` 只用到了 20% 的价值。

## 三、优劣势（面试想听的不只是优点）

**优势**：适配器生态最全；LangGraph 的状态机/断点/持久化是开源里
最完整的 agent 运行时抽象（HITL、长任务恢复场景尤其好使）；
LangSmith 观测顺手；招人容易。

**劣势**：抽象层厚，简单需求被过度工程化；API 迭代快导致教程
时效差（「跟着半年前的教程写必报错」）；抽象泄漏——定制越深，
你越觉得在和框架搏斗而不是在写业务。

## 四、六条路径的选型对比

| 路径 | 抽象 | 适合谁 | 一句话 |
|---|---|---|---|
| 裸调 API | 无 | 学习期/极简需求 | 50 行 ReAct，状态恢复观测全裸奔 |
| OpenAI Agents SDK | 薄 | 绑死 OpenAI | 厂商原生轻量，但生态锁死 |
| **LangChain/LangGraph** | 厚 | 企业应用、多模型多集成 | 连接器大全 + 最完整的状态机 |
| LlamaIndex | 中 | RAG 为主 | 索引/检索编排比 LangChain 专 |
| CrewAI / AutoGen | 薄-中 | 多角色 demo/研究 | 上手快，生产深度不如 LangGraph |
| **Coding harness**（Claude Code/pi/dsh/codex） | 产品级 | 编程 agent 直接开箱 | 不是框架是成品 |

## 五、「编排框架过时了吗」：关键认知更新

[learn-claude-code 宣言](./learn-claude-code导读.md) 批评的
「Rube Goldberg 机器」，指的正是传统链式编排：**硬编码的路由和
节点图，把 LLM 降级成流水线上的一个文本补全节点**。
现代答案是反过来的——**循环让模型驱动**（LangGraph 的循环回边），
路由让模型决策，代码退到工具与护栏的位置。所以 2026 年的判断：

- 链式 LangChain（固定 DAG）在退烧；
- **LangGraph（模型驱动的状态机）是它有未来的部分**；
- coding agent 这个品类干脆整体绕开编排框架，
  直接做成了产品形态（pi/dsh/codex 四条路线）。

选型口诀：**调用为主用链，循环审批用图，编程 agent 用成品 harness**。

## 六、▶ 面试挂钩

**问题 1：LangChain 和 LangGraph 什么区别？**
「LangChain 是组件与链——LCEL 拼 DAG，无循环；LangGraph 是
状态机图——节点+条件边+循环回边+checkpoint 恢复。agent 的
ReAct 循环只能画在图里：LangChain 给积木，LangGraph 给循环。」

**问题 2：什么时候不用 LangChain？**
「三种：一，单调用任务（总结/抽取/翻译），裸调或 LCEL 薄层就够，
不需要状态机；二，极简定制场景，抽象层的成本超过收益——
手写 50 行 ReAct 反而可维护（见 [手写最小agent](../../coding/工程手撕/手写最小agent.md)）；
三，做编程 agent——这个品类已被 coding harness 产品化，
编排框架不是正确答案。」

**问题 3：编排框架和 agent harness 的本质区别？**
「编排框架是**你描述流程、框架驱动模型**（流程图的每步何时调
模型由代码定）；agent harness 是**模型描述意图、harness 提供
环境**（循环由模型的 tool call 驱动，harness 只负责工具、权限、
日志）。前者适合流程固定的企业流水线，后者适合开放任务——
判据就一句：你的流程图能提前画死吗？能，用框架；不能，用 harness。」

## 七、延伸阅读（仓内）

- 对照系四框架：[pi](./pi-agent源码分析.md) · [dsh](./deepseek-harness分析.md)
  · [codex](./codex源码分析.md) · [MiniMax Code](./minimax-code分析.md)
- [learn-claude-code 导读](./learn-claude-code导读.md)（宣言原文）
- [Agent 由浅入深路线图](./agent由浅入深路线图.md)
- [Agentic RAG](../rag/agentic-rag.md)（DAG vs loop 的同一讨论）
