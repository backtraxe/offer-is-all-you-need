# 多 Agent 与评测

> 前置阅读前三篇。本篇收尾 Agent 模块：多 Agent 协作 → Agent 评估体系 →
> 可观测性与线上排障 → HITL → Claude Code / Harness / Skills 的启发（2026 热点）。

## 一、多 Agent 协作模式

> ▶ 面试题：多 Agent 怎么协作？通信协议、串行并行、结果回收？——**高**
> （阿里/美团/快手）

### 1.1 三种基础模式

<div class="diagram-embed">
<iframe src="assets/diagrams/multi-agent-patterns.html" width="100%" height="920" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/multi-agent-patterns.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

| 模式 | 控制流 | 适合场景 | 典型缺点 |
|---|---|---|---|
| 主管 - 执行 | 星型，主管调度 | 任务可拆、子任务相对独立（调研、代码 PR 系统） | 主管是单点瓶颈与单点故障 |
| 辩论 | 对等互评 | 易出错、需高置信度的输出（合规审查、医学摘要） | 轮次成本翻倍；辩论可能不收敛，要设轮数上限 |
| 流水线 | 串行有向 | 阶段明确、有先后依赖（检索→写作→校对） | 本质是 workflow（见第一篇），不是"真自主多 Agent" |

### 1.2 串行 vs 并行

- **串行**：子任务有依赖（B 需要 A 的输出）或共享状态必须串行。延迟高但可控。
- **并行**：子任务独立才可并行（多路检索、多视角生成）。延迟降但带来新问题：
  结果回收时的冲突合并、部分失败处理（fail all 还是 best-effort）、并发控制。
- 生产常见：**编排层并行执行（AsyncIO/工作队列）+ 主管 Agent 在汇总点串行决策**。

### 1.3 通信与结果回收（工程细分追问）

- **通信介质**：消息队列（解耦、天然异步）、共享黑板 / 状态存储（如 LangGraph
  的 shared state）、直接 RPC（延迟低但耦合）。跨进程跨组织时，A2A 协议
  （Google 2025）定义了 Agent Card 发现 + 消息/task 协议——概念见第一篇对比表。
- **子 Agent 结果回收**：关键设计是**只回收结论、不回收轨迹**——子 Agent 的
  几十步 Thought/Observation 留在子 Agent 自己的上下文里，主 Agent 只拿到
  压缩后的结果 + 置信度 + 引用。这一点既是上下文工程（上一篇的子任务隔离），
  也是评测和回溯的基础。
- **失败处理**：子 Agent 超步数 / 报错时，主管可重试同策略、改派别的 Agent、
  降级为规则路径，或上报 HITL——把"子任务失败"当一等公民来设计。

> **参考答法**：先分三种模式（主管 - 执行/辩论/流水线），再讲串并行取舍，
> 最后落到两个工程抓手——**通信介质选型**与**结果只收结论、轨迹留子 Agent**；
> 提一句 A2A 协议定义了跨组织通信的尝试。

## 二、Agent 评估体系

> ▶ 面试题：Agent 的效果怎么评估？planning 能力 vs 幻觉率怎么量化？——**高**
> （阿里/字节；2026 追踪主线"怎么量化"）

### 2.1 和传统模型评估的不同

Agent 评估难在**过程**而不只是结果：答案对了但走的是瞎蒙路径，线上迟早翻车。
所以要分层评：

| 层 | 评什么 | 指标举例 |
|---|---|---|
| **结果层** | 任务最终成功没 | Task Success Rate / 端到端准确率 |
| **过程层** | 路径是否高效、合理 | 平均步数、工具调用准确率、轨迹长度、重复调用率 |
| **组件层** | 各子能力单独评 | Planning 成功率、Tool-use 准确率（BFCL 类）、记忆召回准确率、RAG 指标 |
| **质量层** | 生成内容质量 | 幻觉率、引用准确率、回答完整性 |
| **系统层** | 工程指标 | P95 延迟、Token 成本/任务、TTFT |

**任务成功率 vs 幻觉率**：两者都要但方位不同——成功率是 north star，但低
量场景（医疗/金融）里"一次幻觉=一次事故"，幻觉率权重更高。答复建议说：
"以任务成功率为 primary metric，幻觉率、工具误调率作 guardrail metric，
两 gate 不过不上线"，量化口径立刻清晰。

### 2.2 黄金评测集怎么建

1. **来源**：真实线上日志（失败 case 优先进集）+ 专家团队构造 + 合成数据扩量。
2. **规模起步**：50–200 条高质量 Gold 集远胜 1000 条噪声集；每条带
   期望结果 + 可接受路径（有的题必须调某工具）。
3. **防泄漏/防劣化**：定期更新；上线 case 回流到评测集（"每次事故都是新题"）。
4. **版本化**：Gold 集、prompt、模型配置三者一起版本化，回归才能对得上号。

### 2.3 自动评分（LLM-as-Judge）

- 用强模型当裁判，按 rubric 打分（正确性/完整性/风格/引用质量）。
- 工程要点：**先用人标校验 judge 自己的准确率**（judge 的 precision/recall），
  才能拿它批量打分；主观维度（"语气") 慎用。
- 进阶：对过程层用 **trace-level judge**——把整段轨迹交给 judge 评
  "哪一步开始走歪"，是调试与评测的结合部。

## 三、可观测性与线上排障

> ▶ 面试题：线上 Agent 不返回结果 / 一直调工具，怎么 debug？——**中高**
> （腾讯混元/通义）

### 3.1 Tracing 是 Agent 排障的"黑匣子"

每一段 Agent 运行都要留下完整的、可回放的 **Trace**：

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-tracing.html" width="100%" height="720" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-tracing.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

工具：**LangSmith**（LangChain 全家桶）、**LangFuse**（开源、自部署友好，
国内落地多）、底层规范走 **OpenTelemetry GenAI 语义**（自建平台时按它的
span 属性设计）。

### 3.2 "Agent 一直调工具不返回"排查 SOP（面试高频情景题）

按发生概率从高到低：

1. **看 trace 定位模式**：是同一工具同一参数重复（**重复循环**）？不同工具
   轮换（**乒乓球循环**）？还是每步都"差一点"（**接近但不收敛**）？
2. **重复循环** → 查循环控制是否生效（指纹阈值、最大步数）；查工具返回是不是
   "空/错误"导致模型一直重试。
3. **乒乓球循环** → 往往是工具返回互相矛盾（A 说要 X，B 说要 Y），模型找不到
   reconcile 的方向 → 修工具返回的一致性，或在 prompt 里给冲突裁决规则。
4. **接近但不收敛** → 模型觉得总差点信息，常见于**终止准则没写清**：
   没说"找不到就说什么"，模型就永远找下去。修 prompt/SOP，给明确退出条件。
5. **环境问题**：工具超时但错误没结构化回传，模型误以为"信息还没到" →
   检查 tool runtime 的错误包装。

这题的踩分点不是背答案，是展示方法论：**先 trace 分类循环模式，再对型下药
（控制层/工具层/prompt 层各对应一种）**。

## 四、HITL：人在回路的设计

> ▶ 面试题：Agent Loop 怎么暂停、暂存、恢复？高危操作怎么管控？
> ——**中**（蔚来/蚂蚁）

HITL（Human-in-the-Loop）的硬核部分是**状态机设计**，而不是"加个审批按钮"：

<div class="diagram-embed">
<iframe src="assets/diagrams/hitl-state.html" width="100%" height="860" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/hitl-state.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

要点：

- **可序列化的状态**：暂停必须把完整状态——消息历史、scratchpad、工具调用
  台账、当前 planner 状态——序列化（checkpoint）。LangGraph 的 checkpointer、
  Temporal 的工作流都有现成范式。
- **恢复 = 反序列化 + 断点续跑**：不是从头跑，是"接着那个状态往下"——这要求
  状态完整性（包括工具幂等：重跑不重复扣款）。
- **高危操作管控**：把工具分三档——readonly 直接跑 / write 需审批 / 危险
  （删除、转账、发外部邮件）强制双人确认或完全禁止。配合**审计日志**留证。
- **审批点可配置**：按租户/场景能调——演示环境全批、生产环境严控。

## 五、Claude Code / Harness / Skills 的上下文管理启发（2026 新热点）

> ▶ 面试题：了解 Claude Code / Skill 的管理吗？上百个 Skill 怎么管？
> ——**中，2026 新热点**（快手/字节系）

设问背景：AI Coding Agent（Claude Code、Codex、OpenClaw 类）大规模落地后，
"给 Agent 配多少 Skill / 工具、怎么让它找到对的那个"成了真问题——工具多了
准确率掉下来，少了能力不够。这就是 **Harness（运行时编排层）设计**。

从这类工具观察到的设计启发：

1. **Skill 声明式封装**：一个 Skill = 一段说明（何时用）+ 所需资源（文件、
   模板、脚本），像"为 Agent 写的 README"。模型**按需加载**，不是常驻上下文。
2. **渐进式披露（Progressive Disclosure）**：默认只暴露 Skill 的 **name +
   一行描述**（几十 token）；模型决定用时，再把 SKILL.md 正文和附属文件加载
   进来。几百个 Skill 的菜单只占几 K token。
3. **元技能路由**：`load_skill(name)` 本身是工具；先检索/路由到候选 Skill
   （语义相似或 tag 匹配），再加载。本质和大规模工具集的工具检索同构
   （见第二篇第四节）。
4. **Skill 是「知识包」不是「工具」**：Skill 提供流程、模板、风格（"怎么写周报"、
   "怎么按本仓库规范改代码"），工具提供动作能力；两者配合——这是第二篇
   对比表里 Skill 一行的出处。
5. **Harness 隔离与预算**：主 Agent 给子任务开子 Harness（独立上下文/工具
   白名单/token 预算），类似多 Agent 的"主管 - 执行"在单 Agent 内部的实现。

**答题框架**：先承认矛盾（工具/Skill 数量 vs 准确率、上下文占用），再讲
**按需加载 + 渐进式披露 + 元路由**三招，最后补一句"Skill 是 knowledge package，
MCP 是 tool interface，分层不同"——这篇与第二篇的呼应就是高分区。

## 六、面试准备清单

1. 徒手画多 Agent 三模式 + 说明结果回收原则（"只收结论"）。
2. 背评估五层（结果/过程/组件/质量/系统）+ "primary + guardrail"指标话术。
3. 按 5 步 SOP 口述"一直调工具不返回"排查过程。
4. 画出 HITL 状态机，说明 checkpoint/恢复/幂等三件套。
5. 2026 加分：讲 Skill 的渐进式披露（几 K token 管几百个 Skill）。

## 练习建议

- 把你的最小 ReAct Agent 改造为**主管 - 执行双 Agent**：主管拆 2-3 个子任务，
  分派给执行 Agent（各自独立上下文），回收时只传结论；对比单 Agent 在复杂
  任务上的步数与成功率。
- 给 Agent 接 **OpenTelemetry / LangFuse 免费版**，录一段失败任务的 trace，
  按第三节 SOP 分类它属于哪种循环模式。
- （2026 强推）给 Agent 加一个 `load_skill` 工具 + 3 个示例 SKILL.md，体会
  "渐进式披露"——这将是面试差异化亮点。
- 延伸阅读：AutoGen / CrewAI 对比、Microsoft AI Agents for Beginners 的
  multi-agent 与 evaluation 章节、[LangGraph 状态机与 checkpointer
  文档](https://github.com/langchain-ai/langgraph)（均见
  [学习资源清单](../../resources/学习资源清单.md)）。

## 七、业界实践参考：Agent 精细化评测十条（阿里技术团队分享，二手转述）

> 来源：小红书转载的阿里技术团队 Agent 评测实践分享（二手转述，已脱敏）。
> 可作为本篇第二节「Agent 评估体系」的工程落地对照——十条策略逐一与我们的
> 五层 Eval 框架交叉引用。

1. **黑盒拆链路**：评测先回答三问——哪里错、为什么错、改什么；对应第二节
   「结果层 → 过程层」下钻，以及第三节用 trace 做归因的 SOP。
2. **指标与架构同构**：系统按编排架构切分模块（planner / tool / memory），指标
   按同一结构切——即第二节五层指标表的「组件层」必须与系统模块一一对应，
   否则归因断层。
3. **每个场景单一主指标**：一个场景只认一个 north-star，其余做 guardrail——
   即第二节「primary metric + guardrail metric」的话术来源。
4. **上游失败下游跳过**：链路式评测中前一节点挂了，后续节点标记 skip 而非
   fail，避免误判组件能力；落在「过程层」指标统计口径里。
5. **Judge 单一职责**：一个 judge 只评一个维度（正确性 / 引用 / 风格分开），
   对应 2.3 节 LLM-as-Judge 的 rubric 设计与 judge 自身校验。
6. **Mock 固定外部世界，Real 与 Mock 互补**：外部工具/环境 mock 化保证可回放，
   同时保留少量 real 环境评测兜底 mock 失真——与 2.2 节评测集「防劣化」配合。
7. **多轮 session 按时序评**：多轮对话的轨迹带时序签名，评测粒度是 session
   而非单 turn；对应第三节 trace 的树状 span 设计。
8. **区分基础设施异常与能力失败**：超时、限流、部署故障先归类为 infra 事件
   剔除出能力指标，否则组件层准确率被污染。
9. **评测集 = LLM 生成 + 人工审核 + BadCase 回流**：合成扩量、人审保金标、
   线上事故回流入集——即 2.2 节「来源 + 每次事故都是新题」的工业化版本。
10. **评测是持续基础设施**：评测平台与回归管线常驻，随 prompt / 模型 / 工具
    版本联动重跑——呼应 2.2 节「Gold 集、prompt、模型配置三者一起版本化」。

**答题用法**：被问「Agent 评测体系怎么建」时，先给第二节的五层框架（结构），
再挑十条里的 2-3 条（拆链路归因、单一主指标、BadCase 回流）作为工程深度
佐证——框架 + 落地细节的组合即高分区。
