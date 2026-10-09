# Learn Claude Code 导读：17 节渐进式手写 Agent 的课程地图

> 本篇是外源教程 [shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)
> 的导读与本仓对照索引。该项目以「**Agency comes from the model, and we build
> the harness**」为核心主张，用 Python 从 `s01_agent_loop` 渐进到
> `s17_goal_loop`，共计 17 节，每节一个独立目录（`code.py` + 中英日三语
> README），是 2026 年中文圈学习 agent 原理的当红教材。
> 读完你会获得：17 节的分组地图、每节与本仓四框架分析/八股文档的
> 对照入口、以及怎么用它和 [Agent 由浅入深路线图](./agent由浅入深路线图.md)
> 配合使用的学习曲线。

## 一、它的定位和这本书为什么值得读

开篇宣言（README）先把概念摆正，这段编排被大量面试回答引用：

- **Agency 是训出来的，不是编码出来的**：DQN（2013）、AlphaStar、
  OpenAI Five 到今天的 coding agent，同一个公式：模型是司机，
  harness 是车。所以"造 agent"其实只有两件事——**训模型**（厂商的活）
  或**造 harness**（我们的活）；
- `Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions`；
- 反模式宣言：工作流拖拽平台/硬编码路由不是 agent，
  是"Rube Goldberg 机器"。

课程组织特征（面试复述时允许的口径）：

- 17 个递进目录，每节独立：`code.py`（示例主程序）+ README；
- 重型节点：`s01_agent_loop`（一个循环一个工具）、
  `s08_context_compact`（342 行 README）、`s13_agent_teams`（453 行）、
  `s15_integrated_harness`（多机制集成）；
- `agents/` 目录有第二套精简命名实现（`s_full.py` 汇总），适合
  跟着 course 走完后对照默写。

## 二、17 节分组地图（看完就知道怎么跳读）

按主题相关性分为六组：

```
G1 骨架(单 agent 核心)      G2 决策与动机        G3 上下文与记忆
  s01 agent_loop              s05 todo_write       s08 context_compact
  s02 tool_use                s17 goal_loop        s09 memory
  s03 permission                                 
  s04_hooks                                      

G4 协作(多 agent)           G5 生态/外部协议      G6 集成与运行时
  s06 subagent                s07 skill_loading    s15 integrated_harness
  s13 agent_teams             s14 mcp_plugin       s16 workflow_runtime
  s12 cron_scheduler          (s10 task_system)    
  s11 background_tasks        
```

简记法：**G1 会跑 → G2 会想 → G3 记得住 → G4 能组队 → G5 接生态 → G6 上生产**。

<div class="diagram-embed">
<iframe src="assets/diagrams/lcc-map.html" width="100%" height="620" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/lcc-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 三、与本仓的对照索引（最重要的一张表）

每节先读 lcc 的 code.py（极简实现、能跑），再回到本仓看
**生产框架是怎么把同一个问题做厚的**——这是「由浅入深」的最短路径：

| 课节 | 本仓对照深挖 | 阅读理由 |
|---|---|---|
| s01 agent_loop | [pi 源码分析](./pi-agent源码分析.md) | 单循环是 pi 949 行 loop 的裸骨 |
| s02 tool_use | [工具调用与 MCP](./工具调用与mcp.md) | 工具 schema/description/错误自愈 |
| s03 permission | [Codex 源码分析](./codex源码分析.md)（审批四档+execpolicy+沙箱） | lcc 单点权限 vs codex 三层纵深 |
| s04 hooks | [dsh 分析](./deepseek-harness分析.md)（waterfall 管线） | hook 与 waterfall 同一思想两种实现 |
| s05 todo_write | [场景全链路 trace](./场景全链路trace.md) | todo 工件在长任务中的作用 |
| s06 subagent | [多 Agent 与评测](./多agent与评测.md) + [dsh](./deepseek-harness分析.md#六其余值得知道的能力缝) | 委派/隔离/continuable vs one-shot |
| s07 skill_loading | [Agent Skills 详解](./agent-skills详解.md) | lcc 的加载时机对应三层披露 L2 |
| s08 context_compact | [记忆与上下文工程](./记忆与上下文工程.md)（降幅、分层、预算） | lcc 教「何时压」，本仓教「怎么保质量」 |
| s09 memory | [记忆与上下文工程](./记忆与上下文工程.md#二短期记忆-vs-长期记忆) | 工作/情景/语义/程序性四层 |
| s10 task_system | [负载均衡专题](./负载均衡专题.md)（任务队列派发） | 任务 vs 会话的不同生命周期 |
| s11 background_tasks | [Harness 工程实战](./harness工程实战.md)（后台 job/UI 呈现） | 长任务异步化 |
| s12 cron_scheduler | [MiniMax Code 分析](./minimax-code分析.md)（cron 模块） | 定时唤醒 agent 的生产形态 |
| s13 agent_teams | [多 Agent 与评测](./多agent与评测.md)（Orchestrator-Worker） | 分组协作协议、mailbox |
| s14 mcp_plugin | [MCP vs 工具调用深度对比](./mcp与工具调用深度对比.md) | 供货侧协议的全部细节 |
| s15 integrated_harness | [deepseek-harness 分析](./deepseek-harness分析.md)（插件树形态） | 多机制集成怎么不烂掉 |
| s16 workflow_runtime | [Agentic RAG](../rag/agentic-rag.md)（DAG vs loop 讨论） | agent 与 workflow 的边界 |
| s17 goal_loop | [harness 工程实战](./harness工程实战.md)（goal/后台任务） | 无人值守长任务 |

**使用方法**：每课三步——**跑 lcc 的 code.py（能跑）→ 写出本仓对照文档
中的同款机制在哪 → 用 four-harness 对照表复述一次**「为什么 lcc 的简版
能跑，生产却要厚十倍」。

## 四、与「Agent 由浅入深路线图」的对齐

本仓的 [agent 由浅入深路线图](./agent由浅入深路线图.md) 是自底向上的
抽象主线，lcc 是手把手的具体课程。两条线天然互补：

```
路线图 L0 最小 Agent       ←→ lcc G1（s01-s04）
路线图 L1 Prompt 工程      ←→ lcc s02 + s07（工具与技能索引）
路线图 L2 上下文与记忆     ←→ lcc G3（s08+s09）
路线图 L3 可靠性           ←→ lcc s03+s04+s15（权限/钩子/集成）
路线图 L4 Trace 与评测     ←→ lcc 未重点覆盖（本仓补齐）
路线图 L5 企业级形态       ←→ lcc s15-s17 + 本仓四框架分析
```

**搭配建议**：面试前两周，白天读 lcc 对应课节 + 跑 code.py，
晚上读本仓对照文档，把「生产级厚度」的论据干粮带上。

## 五、与 openai/codex 的关系（为什么这篇要提它）

lcc 是**拼写本**，codex 是**交付品**。两者的关系恰如本仓反复强调的
「最小可用 vs 工程纵深」两个端点：

- lcc 的 s03_permission 是一层（读写前规则判断），
  codex 是三层（execpolicy 规则 × 四档审批 × Seatbelt/Landlock 沙箱）；
- lcc 的 s08 是「要压、怎么估、压缩 prompt 长什么样」，
  codex 是三种策略并存（inline 本地 / remote V2 服务端 / roll-over 换窗）
  外加 `CompactedHistoryMetadata` 完整留痕；
- lcc 全程单文件单进程演示，codex 是 Rust workspace 百 crate、
  Task/turn 双层、mailbox 唤醒——**这就是从 course 到 production
  的完整梯度**。

面试话术：**「我用 learn-claude-code 学骨架，用 codex 学交付——
两者之间的十万行距离，就是『上生产』到底意味着什么。」**

## 六、▶ 面试挂钩

**问题 1：有什么好的 agent 学习项目推荐？**
「中文圈首推 shareAI-lab/learn-claude-code——17 节从单循环到
goal loop，每节 code.py 可以跑。它不教 API 而是教 harness 设计的
**判断标准**（宣言本身就是金句：Agency 是训来的，我们造的是车）。
搭配深入材料：我自己仓库里有四框架分析（pi/dsh/codex/mcode），
每节课都有对应的生产级对照。学法是骨架先看 lcc、厚度看拆机。」

**问题 2：你自己跟下来，哪几节改变最大？**
「s08 context compact——它把『压缩』从救急手段讲成了设计维度：
压缩时机（pressure vs overflow）、压缩粒度（tool result 先裁再摘要）、
压缩的证据保留（摘要+指针+原文索引都有）。其次是 s03 permission——
规则线与人工线的混合，是后续 codex 三层纵深的极简原型。」

**问题 3：lcc 和直接读生产源码哪个更好？**
「次序问题。lcc 的先发优势是**每个概念只有一页**、可以跑——
先建立骨架；生产源码的价值全在**厚度**（错误处理/权限层级/并发
形态/观测），但要先有骨架才读得动。两者不是替代关系，
我在仓库里给每节课标了对应的生产深挖入口，就是为了这个互补。」

## 七、延伸资源

- 一手仓库：[shareAI-lab/learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)
  （前 README 的「宣言」值得全文读）；
- 本仓进阶主线：[Agent 由浅入深路线图](./agent由浅入深路线图.md)、
  [场景全链路 trace](./场景全链路trace.md)；
- 四框架拆机：[pi](./pi-agent源码分析.md) · [dsh](./deepseek-harness分析.md)
  · [codex](./codex源码分析.md) · [MiniMax Code](./minimax-code分析.md)；
- 手写练习：[coding/手写最小agent](../../coding/工程手撕/手写最小agent.md)。
