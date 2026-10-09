# Agent 由浅入深路线图：从 50 行循环到企业级系统

> 本篇面向已有 [Agent 基础](./agent基础与规划.md) 概念、想问「接下来
> 怎么一步步进阶」的读者。Agent 的知识在仓库里散落于基础八股、
> 四个框架源码分析、工程实战、系统设计各处——本篇给一条**阶梯主线**
> 把它们串起来：每级只加一个关注点，配一个「到此级你能交出什么」
> 的验收标准。读完你会获得：L0→L5 的进阶地图、写好 prompt 的工程
> 方法、做 trace 的三层方案，以及每级对应的仓内深挖入口。

## 〇、阶梯总表

| 级别 | 主题 | 新增关注点 | 验收标准 |
|---|---|---|---|
| L0 | 最小 Agent | TAO 循环 + 工具注册 + 终止条件 | 能手写 50 行跑通 ReAct |
| L1 | Prompt 工程 | 系统 prompt 分层、工具 schema、失败自愈 | 模型选错工具/编参数的概率显著下降 |
| L2 | 上下文与记忆 | 消息流、压缩、长任务续命 | 百轮对话不炸窗口、可复盘 |
| L3 | 可靠性与防护 | 错误数据化、并发护栏、权限审批 | 线上出故障可重启可审计 |
| L4 | Trace 与评测 | span 分段、会话日志、采样评估 | 任何坏 case 可定位到具体环节 |
| L5 | 企业级形态 | 事件溯源、多入口、生态扩展 | 框架级复用（参考四个真实 harness） |

**学习心法**：L0-L1 靠写（手写最小 agent），L2-L3 靠读
（读 pi 的 loop 与 dsh 的工具管线），L4-L5 靠拆
（拆解真实 harness 怎么做的观测和扩展）。

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-ladder.html" width="100%" height="620" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-ladder.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、L0：最小 Agent——先跑通一个循环

不要一开始就读 vLLM 级别的大项目。**门槛最低且收益最大的起手式
是脱框架手写 50 行 ReAct**：

```python
while steps < MAX_STEPS:          # 硬兜底
    resp = llm(messages, tools=TOOL_SCHEMAS)   # 模型决策
    if resp.is_final: break                    # finish 标记退出
    for call in resp.tool_calls:
        key = fingerprint(call)                # 重复指纹拦截
        if seen[key] >= DUP_LIMIT: break
        result = run_tool(call, timeout=30)    # 异常也只是一条 Observation
        messages.append(tool_result(result))
    messages.append(assistant_msg(resp))
```

到这一级你要能回答：ReAct 三步是什么、为什么异常不能让循环炸、
什么时候该退出（三层防护：步数→重复→finish）。
**这是 agent 的「Hello World」**，不是玩具——pi 的 agent loop
就是在这个骨架上加了消息队列和钩子。
（代码与三层防护细节：[coding/手写最小agent](../../coding/工程手撕/手写最小agent.md)）

## 二、L1：Prompt 工程——模型选择的接口学

L0 跑通后 90% 的「不听话」都来自 prompt。按影响力排序三条：

### 2.1 系统 prompt 分层（学自 dsh/pi 的分节设计）

```text
preamble（身份一句话）
<tools>         工具目录（schema + 用途 + 边界）
<rules>         行为纪律（先读后改、最小改动、交付前自测）
<project_context>  上下文文件（AGENTS.md）
<cwd/env>       环境事实
skills、todos 等扩展节
```

要点：

- **分节>一大段**：工具增删只 patch 对应节（pi 的
  `diffSystemPromptSections`），prompt cache 命中率才保得住；
- **rules 写「判断标准」不写「流程描述」**：bad「仔细检查代码」；
  good「改动后必须运行相关测试，失败不允许交付」；
- **只写每轮都要用的**：长尾流程放 Skills 按需加载，别塞进常驻
  prompt（[Agent Skills 详解](./agent-skills详解.md)）。

### 2.2 工具 schema 是路由器的性能上限

description 写「什么时候用、什么时候不用、和相邻工具的边界」；
参数用枚举收窄、给默认值；返回值裁剪到必要字段。
（完整纪律：[工具调用与 MCP 第三节](./工具调用与mcp.md)）

### 2.3 让失败自愈

工具报错写成**模型能懂的结构化错误**（错在哪/可用替代是什么），
而不是 stacktrace——模型看到「参数 path 缺失，可用格式为 /abs/path」
大概率下一步就改对了。这是 pi 把「工具错误一律回喂」之外的第二个
细节：**回喂的内容质量决定恢复质量**。

## 三、L2：上下文与记忆——长任务不翻车的工程学

真正能跑 50+ 轮的 agent， 靠的是上下文工程而不是更大的窗口：

1. **一切皆消息**：用户输入、工具结果、系统提示、压缩摘要
   统一进消息流，模型历史 = 消息流的投影；
2. **分层预算**（[详情](./记忆与上下文工程.md)）：
   常驻 system 区只放选择所需的最小索引（工具目录/技能卡片），
   正文大件（skill 全文、大文件）**用时才读**，
   压缩按价值梯度（system 最近轮 > 远古工具输出）；
3. **三件套续命**（学学 Claude Code）：
   auto-compact 摘要压缩、subagent 把长任务隔离成独立上下文、
   文件系统当外挂记忆（写进文件不占窗口的空间，
   需要时 read 回来——这就是进展式披露的本质）。

## 四、L3：可靠性与防护——出错有限度

L2 之后进入「能不能上生产」的分水岭。三个必加件：

- **错误数据化**：工具失败一律回喂模型、LLM 错误编码成事件
  （pi 契约「must not throw」）——**任何失败都是数据不是崩溃**；
- **并发与循环护栏**：max-steps、并发工具 barrier（一个写操作
  让整批变串行）、runaway guard（mcode 的独立模块）；
- **权限边界**：高危动作进审批（codex 四档）、危险命令走
  execpolicy 规则、OS 层沙箱。规则先行 = 惯例免打扰、
  个案问人、沙箱兜底。

到这一级的验收方法：故意触发失败（拔网、删文件、超时）——
系统应当**优雅降级**而不是炸掉，且事后能从消息流完全重建
现场（这就是 dsh「model-visible means logged」的价值）。

（完整六层与 harness 对应：[Harness 工程实战](./harness工程实战.md)）

## 五、L4：Trace 与评测——坏 case 必须可定位

到 L4，「修 bug」从玄学变成科学。三层方案：

**1. Span 分段（学 codex）**：一次 turn 切成 `prepare / sampling /
tools / post-processing` 等 span，每个 span 带 token 用量、
模型、参数——性能问题直接看到「钱花在哪」。
最小实现：在 loop 的关键节点（LLM 调用、工具前/后）打印
结构化 timing log，十条日志够用。

**2. 会话日志 = 审计与复现**：append-only JSONL 记录每条事件
（消息、工具调用、决策、错误），**fork 和复盘都从日志投影**。
关键纪律：写日志早于执行（dsh 的 tool/call 先记再跑），
失败也有 attempt 记录。

**3. 采样评估**：线上每周抽样 N 条会话做质量打分（LLM-as-judge），
指标盯**决策轨迹**（该检索没检索？无效工具调用率？Esc 中断率？）
而非只看答案分。

（误检注入与四件套防护：[工具调用与 MCP 第七节](./工具调用与mcp.md)；
监控三层：[Harness 工程实战 第六节](./harness工程实战.md)）

## 六、L5：企业级形态——框架级复用

到顶层的标志：你的 agent 能被另一个团队**拿去改配置就用**。
四个已分析的开源项目给了四种形态答案，直接对照选型即可：

| 形态 | 项目 | 一句话 |
|---|---|---|
| 极简底座 | pi（[分析](./pi-agent源码分析.md)） | 9 个文件读完全栈，7 钩子定制 |
| 元框架 | dsh（[分析](./deepseek-harness分析.md)） | 一切皆插件，Loop 自身可换 |
| 工程纵深 | codex（[分析](./codex源码分析.md)） | Rust + 三层安全 + 应用工程范本 |
| 商业化 | MiniMax Code（[分析](./minimax-code分析.md)） | vendor pi + 企业外壳 + 补丁台账 |

到 L5 你最该会的技能是：**遇到框架问题能找到对应的源码位置**——
被问内部机制时，谈「我读过 xx 的 yy 文件，它是 zz 这么做的」
是面试终极武器。

## 七、常见问题（FAQ 收口）

- **Q：L0 的最小循环和 LangGraph/CrewUI 是什么关系？**
  A：框架帮你写完了 L0-L2 的部分，但代价是看不见这些层。
  先手写一遍 L0，再用框架你才知道每一层值多少钱、出问题去哪改。
- **Q：什么时候读哪个框架的源码？**
  A：写完 L0-L2 后读 pi（[入口](./pi-agent源码分析.md)），
  能全部看懂后再对比 dsh 的抽象增量。
- **Q：学这么多框架是不是技术选型焦虑？**
  A：四条路线都是**同一本教科书的四个注本**——核心概念
  （loop/工具schema/上下文/观测）完全一致，学的是各自对
  「取舍」的答案。

## 八、▶ 面试挂钩

**问题 1：如果让你从零做一个 coding agent，分几步走？**
「五步阶梯：手写最小 ReAct 跑通 TAO 循环（含三层退出防护）→
prompt 工程把工具 description 和 rules 分层写好，失败回喂结构化
错误 → 上下文工程（一切皆消息 + 分层预算 + auto-compact/文件系统
外挂记忆）→ 可靠性三件套（错误数据化/并发护栏/权限审批）→
trace（span 分段）+ 会话日志（事件溯源）+ 采样评估。
每一级都有验收标准，上级不成立就先別谈下级。」

**问题 2：写好 agent prompt 的关键是什么？**
「三句话：系统 prompt 按节组织（分节保 cache 率）、rules 写
判断标准而非流程口号、工具 description 说清「何时用何时不用」。
另两条隐性原则：失败信息给模型能修的格式、长尾流程放 Skills
按需加载别塞常驻。」

**问题 3：agent 的 trace 和普通后端 trace 有什么区别？**
「三层：算法层的 span 分段（prepare/sampling/tools/post）看
时间花费；产品层的会话日志（append-only 事件流）看决策序列；
业务层的采样评估（轨迹质量指标）看行为正确性。最大的区别是
observer 必须能重建模型的每一次输入——日志即 trace 的底座。」

## 九、延伸阅读（仓内）

- 手写起脚：[coding/手写最小agent](../../coding/工程手撕/手写最小agent.md)
- 概念复习：[Agent 基础与规划](./agent基础与规划.md)、
  [意图四层](./agent基础与规划.md#41-补充意图处理规划的上游)
- 上下文：[记忆与上下文工程](./记忆与上下文工程.md)
- 工程实战：[Harness 工程实战](./harness工程实战.md)
- 框架拆解：[pi](./pi-agent源码分析.md) → [dsh](./deepseek-harness分析.md)
  → [codex](./codex源码分析.md) → [MiniMax Code](./minimax-code分析.md)
- 系统设计案例：[system-design/](../../system-design/)
