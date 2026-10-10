# Pi Agent 源码分析：极简 Coding Agent 的分层设计

> 本篇面向想搞清楚「一个现代 coding agent 到底由哪几层组成、agent loop 长什么样」
> 的读者。分析对象是 **Pi**（Mario Zechner / badlogic 的
> [earendil-works/pi](https://github.com/earendil-works/pi)，npm 包
> `@earendil-works/pi-coding-agent`）——一个以「极简、可扩展」为卖点的开源
> coding agent。它没有 subagent、没有 plan mode、没有内置权限系统，
> 全部核心逻辑能在一下午读完，是**学习 agent 内部构造的最佳教材之一**。
> 读完你会获得：pi 的四层架构图、agent loop 的完整事件模型、
> 以及「如果让你设计一个 coding agent 你怎么分层」的系统设计答题骨架。

## 〇、为什么是 Pi

读 coding agent 源码的候选通常是 Claude Code（闭源）、Aider（Python，历史包袱重）、
OpenHands（大而全）。Pi 的定位恰好相反：**README 第一句就是
"a minimal, extensible agent harness**"，并且明确声明跳过 sub-agent 和
plan mode——你想让这些能力存在，就自己写扩展。

这种克制造成了两个好处：

1. **核心路径短**：一次请求从用户输入到 LLM 再到工具执行回环，
   主链路只有 `agent-loop.ts` 一个文件（949 行）；
2. **设计决策暴露**：因为没有功能堆砌，每一层抽象的「为什么存在」都能在
   源码里找到直接注解——types 文件的注释几乎就是一篇设计文档。

面试价值：当面试官问「你读过 agent 框架源码吗」「自己设计一个 coding agent
你怎么做」时，pi 的分层可以直接搬出来当骨架，再对照
[Claude Code 内幕](./ai编程与claudecode内幕.md)讲取舍，层次立刻拉开。

## 一、全景：四层 monorepo

pi 是一个 TypeScript monorepo，面试要讲的只有四层：

```text
┌─────────────────────────────────────────────────────┐
│ pi-coding-agent   CLI 应用层：会话管理、工具实现、     │
│                   skills、扩展、TUI/print/RPC 模式     │
├─────────────────────────────────────────────────────┤
│ pi-agent-core     运行时层：agent loop、事件流、       │
│                   工具调度、状态管理（~2500 行）        │
├─────────────────────────────────────────────────────┤
│ pi-ai             模型层：统一多 provider LLM API、    │
│                   流式协议、重试、消息规范化            │
├─────────────────────────────────────────────────────┤
│ pi-tui            终端 UI 库：差分渲染、编辑器组件      │
└─────────────────────────────────────────────────────┘
```

对应 `packages/` 目录（本文所有路径相对 repo 根）：

| 层 | 目录 | 关键文件 |
|---|---|---|
| 模型层 | `packages/ai` | `utils/retry.ts`、`utils/event-stream.ts`、providers/ |
| 运行时层 | `packages/agent` | **`agent-loop.ts`、`agent.ts`、`types.ts`** |
| 应用层 | `packages/coding-agent` | `core/agent-session.ts`、`core/session-manager.ts`、`core/tools/`、`core/system-prompt.ts`、`core/skills.ts`、`core/compaction/`、`core/extensions/` |

两条贯穿全局的设计哲学，先记住，后面处处回扣：

1. **一切皆消息**：系统提示、工具增删、bash 执行记录、压缩摘要，
   全部编码进 transcript 的消息流里，模型上下文 = 消息流的投影；
2. **契约不抛异常**：`StreamFn`、`convertToLlm`、`transformContext` 的契约
   全部写明"must not throw"——失败必须编码成流内事件
   （`stopReason: "error"`），保证事件序列对 UI 永远完整可渲染。

## 二、运行时层：agent loop 的完整解剖

`packages/agent/src/agent-loop.ts` 是全仓最值得逐行读的文件。

### 2.1 双层循环结构

```text
外层 while(true)：处理「follow-up」队列
  └─ 内层 while(hasMoreToolCalls || pendingMessages)：
       1. prepareNextTurn（如压缩）→ 注入轮间消息
       2. 取出 steering 消息并入上下文
       3. prepareRequest（换模型/思考档位）
       4. streamAssistantResponse → 流式收 assistant 消息
       5. 执行 tool calls（并行或串行）
       6. finishTurn 决策：continue / end
agent_end：没有更多工具调用且两个队列都空
```

关键代码就一段（`agent-loop.ts` runLoop，已精简注释）：

```typescript
while (true) {                       // 外层：follow-up
  let hasMoreToolCalls = true;
  while (hasMoreToolCalls || pendingMessages.length > 0) {  // 内层：turn
    // ...注入 prepared/steering 消息
    const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);
    if (message.stopReason === "error" || message.stopReason === "aborted") { /* 硬退出 */ }
    const toolCalls = message.content.filter((c) => c.type === "toolCall");
    // 执行工具，结果作为 toolResult 消息回写上下文
    const decision = await config.finishTurn?.(lastCompletedTurn, signal);
    if (decision?.action === "end") { /* 结束 */ }
    pendingMessages = (await config.getSteeringMessages?.()) || [];
  }
  const followUpMessages = (await config.getFollowUpMessages?.()) || [];
  if (followUpMessages.length === 0) break;    // 真的结束了
  pendingMessages = followUpMessages;          // 否则再来一轮
}
```

### 2.2 两个消息队列：steering 与 follow-up

这是 pi 相对教科书式 ReAct 循环多出来的东西，也是面试加分细节：

- **steering（转向消息）**：agent 干活途中用户又输入了新指令。
  在**当前 assistant turn 的工具执行完之后**注入上下文，
  直接改变下一轮 LLM 看到的内容——打断但不截断。
- **follow-up（跟进消息）**：用户说了「做完这个再做那个」。
  等 agent **自然停止后**才注入，开启全新的外层循环迭代。

对应 `Agent.steer()` / `Agent.followUp()` 两个 API，以及
`PendingMessageQueue` 的 `"all" | "one-at-a-time"` 两种排空模式。

### 2.3 完整事件模型

loop 对外只暴露 `EventStream<AgentEvent, AgentMessage[]>`，UI（TUI/RPC/JSON 模式）
全部靠订阅这 11 种事件渲染——**视图与运行时彻底解耦**：

| 类别 | 事件 |
|---|---|
| Agent 生命周期 | `agent_start` / `agent_end` |
| Turn 生命周期 | `turn_start` / `turn_end` |
| 消息生命周期 | `message_start` / `message_update`（流式 delta）/ `message_end` |
| 工具生命周期 | `tool_execution_start` / `tool_execution_update`（部分结果）/ `tool_execution_end` |

「一 turn = 一次 assistant 响应 + 它引起的所有工具调用与结果」，
这个定义写在事件类型注释里，是理解整个节奏苹果的钥匙。

### 2.4 钩子系统：七孔插座

`AgentLoopConfig`（`types.ts`）提供 7 个钩子，应用层所有「定制行为」
都是从这些孔插进来的，而不是改 loop：

- `convertToLlm`（必有）：AgentMessage[] → LLM Message[]，
  应用层的 bashExecution、branchSummary 等自定义消息在这里翻译；
- `transformContext`：LLM 调用前变换上下文（压缩、注入）；
- `prepareRequest` / `prepareNextTurn`：换模型、调思考档位的时机；
- `getSteeringMessages` / `getFollowUpMessages`：上面的两个队列；
- `finishTurn`：强制续一轮或终止。

**「一次请求经过 pi 的全过程」**：用户输入
→ `Agent.prompt()` → `runAgentLoop` → 消息入上下文
→ `transformContext`（可能压缩）→ `convertToLlm`
→ `streamFn`（pi-ai 层，含重试）→ 流式事件上行到 UI
→ 工具调用 → `beforeToolCall`（校验/拦截）→ `execute`
→ `afterToolCall`（改写结果）→ toolResult 消息入上下文 → 下一 turn。

```text
user ─▶ Agent.prompt ─▶ runAgentLoop
                           │  ┌─ transformContext（压缩/注入）
                           │  ├─ convertToLlm（自定义消息翻译）
                           ▼  ▼
                        streamFn ─▶ LLM provider（pi-ai，含重试）
                           │  流式 events ─▶ UI（TUI/RPC/JSON）
                           ▼
                     toolCall? ──yes──▶ beforeToolCall ─▶ execute
                           │                （拦截）       │
                           │                         afterToolCall
                           │                （改写结果）    │
                           └──── toolResult 入上下文 ◀──────┘
                           │ no more calls & 队列空
                           ▼
                       agent_end
```

<div class="diagram-embed">
<iframe src="assets/diagrams/pi-agent-loop.html" width="100%" height="660" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/pi-agent-loop.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 三、工具协议：从 schema 到执行

### 3.1 AgentTool 的形状

```typescript
interface AgentTool<TParameters> {
  name: string;               // 模型可见名
  label: string;              // UI 显示名
  parameters: TSchema;        // TypeBox 的 JSON Schema
  execute(toolCallId, params, signal, onUpdate): Promise<AgentToolResult>;
  prepareArguments?: (args) => args;   // 校验前的兼容性 shim
  executionMode?: "sequential" | "parallel";
}
```

默认内置工具就 8 个（`core/tools/index.ts`：
`read | bash | powershell | edit | write | grep | find | ls`），
默认 loadout 更是只有 `read / bash / edit / write` 四件——
「grep 没有就用 bash 里的 rg」这种约束甚至被自动写进 system prompt 的规则里
（见下节 buildRules）。

### 3.2 并行/串行执行与截断防护

`executeToolCalls` 里两个值得抄的工程细节：

1. **混合调度**：整批默认并行（`Promise.all` 收集、
   `tool_execution_end` 按完成顺序发），但只要批里有一个工具声明
   `executionMode: "sequential"`，整批降级为串行——写操作不会和读操作竞争；
2. **截断熔断**：assistant 消息 `stopReason === "length"` 时，
   **该消息里所有 tool call 一律不执行**——流式拼装出的参数可能是不完整 JSON，
   「解析成功 ≠ 完整」，执行了就是灾难。loop 给每个调用返回一条
   "re-issue the tool call with complete arguments" 错误让模型重发。

### 3.3 错误一律不进异常通道

工具未找到、参数校验失败、被 hook 拦截、抛异常——
全部归一为 `isError: true` 的 toolResult 消息喂回模型。
**模型是唯一需要看到错误的人**，这条原则让所有失败路径都可在会话里复盘，
也是「契约不抛异常」哲学的第二处体现。

## 四、上下文与 system prompt：一切皆消息

### 4.1 分节式 system prompt

`core/system-prompt.ts` 把 system prompt 拆成**带标签的独立小节**：

```text
preamble（无标签）→ <tools> → <rules> → <docs> → <project_context> → <skills> → <cwd>
```

- 每一节独立可替换，`diffSystemPromptSections()` 计算增量补丁——
  比如切换工具集时只重发 `<tools>` 节，而非重写整个 prompt，
  这对 prompt cache 命中率是实打实的优化；
- 工具的规则是**按 loadout 动态生成**的：有 bash 没 grep 时自动加规则
  "Use bash for file operations like ls, rg, find"；
  每个工具自带 `guidelines` 贡献条目（read 工具会声明
  "Use read to examine files instead of cat or sed"）。

### 4.2 工具增删也是消息

`declareToolChanges()`（agent-loop.ts）：可执行工具集与
transcript 里声明过的工具集做 diff，差异编码成系统消息的
`toolsAdded` / `toolsRemoved` 字段——**工具集变化对模型可见、可回放**，
会话从任何入口恢复都能精确还原当时的 loadout。

### 4.3 Skills：SKILL.md 规范

`core/skills.ts` 实现了 [Agent Skills 规范](https://agentskills.io)：

- 目录下有 `SKILL.md`（带 frontmatter 的 name/description）即视为技能根；
- **prompt 里只放 name + description + 路径**（几十 token 的索引卡），
  模型判断任务匹配后才用 read 工具加载完整文件——这是
  「渐进式披露」省 context 的经典实现，和 Claude Code 的 Skills 同一思路；
- name/description 有严格校验（64 字符、小写连字符、description ≤1024）；
- `disable-model-invocation: true` 的技能不进 prompt，只能 `/skill:name` 显式调用。

### 4.4 压缩（compaction）

`core/compaction/compaction.ts`：默认 `reserveTokens: 16384 + keepRecentTokens: 20000`
——上下文逼近窗口上限时，把旧消息序列化发给 LLM 生成摘要，
摘要作为 compaction 消息进入 transcript，**原始条目保留在会话文件里不动**。
细节亮点：摘要会带上「读过/改过哪些文件」的操作清单
（`extractFileOperations`），压缩后模型仍知道此前摸过哪些文件。

## 五、会话层：JSONL 树上的一切皆可回放

`core/session-manager.ts`（2013 行）管理会话持久化：

- **会话 = JSONL 文件**，每行一个 entry，带 `uuidv7` id + `parentUuid` 指针；
- **entries 构成一棵树**：每条路径是一个分支，「当前 entry 所指的那条」
  是活动分支，为下一次模型请求提供历史；
- entry 类型即审计全集：消息、模型切换、思考档切换、usage、compaction、
  branch summary、label、context edit……；
- **fork = 从任意历史 entry 继续**，自然长成同文件新分支；
  compaction 也只是一个特殊 entry——「编辑历史」在 pi 里不存在，
  只有「追加新指针」。

这套设计和 git 的 commit DAG 同构：**模型上下文是会话树的投影**，
而不是被直接修改的状态。面试讲「会话持久化怎么设计」时，
这个「append-only 事件溯源」答案比「存 messages 数组到数据库」高一个段位。

## 六、扩展系统：一切内生能力的替代品

pi 把「官方的克制」翻译成架构语言：**扩展能做核心做的几乎所有事**。
`core/extensions/` 加载 TypeScript 模块，工厂函数可注册：
工具、命令、快捷键、模型 provider、事件处理器（session_start、
before_agent_start、context、session_before_compact、tool renderers……）、
终端 UI 组件。30+ 种事件钩子覆盖会话全生命周期——
plan mode、subagent、权限系统，官方期望你以扩展形态自己实现。

工具渲染都分三层（`renderShell` / `renderCall` / `renderResult`），
TUI 里你看到的每个工具折叠卡片都是渲染器产物，而非写死的 UI。

## 七、与 Claude Code 对照着看

| 维度 | Pi | Claude Code |
|---|---|---|
| 源码 | 全开源（MIT） | 闭源（靠行为规范与逆向观察） |
| 体量 | 核心 loop 949 行 | 估计大一个数量级以上 |
| subagent/plan mode | **无**，交给扩展 | 内置第一公民 |
| 权限系统 | **无**，README 建议容器化 | 内置细粒度权限/HITL |
| 技能 | SKILL.md 规范，渐进披露 | Skills 同源思路 |
| 上下文管理 | compaction + 树形会话 + 分节 prompt | auto-compact + 文件系统当记忆 |
| 哲学 | "adapt Pi to your workflows" | 开箱即用的完整产品 |

面试话术：**「看过 Claude Code 的行为规范，也精读过 pi 的 agent loop——
前者让我理解完整产品要补什么，后者让我理解核心循环最小可以小到什么。」**

## 八、▶ 面试挂钩

**问题 1：让你设计一个 coding agent，架构怎么分层？**
「四层：模型层统一多家 LLM 的流式协议并重试；运行时层一个事件驱动的
agent loop，对外只发 11 种生命周期事件；应用层管会话持久化、工具实现、
提示词组装；最上是 UI/接口层。各层之间全靠消息流和事件流通信，
reference 是 pi 的 packages 划分——我就是按它的边界讲的。」

**问题 2：agent 执行中用户追加指令怎么处理？**
「两种语义要分开： steering——当前 turn 的工具执行完就注入，
影响下轮 LLM 输入，适合纠偏； follow-up——等 agent 干完自然停再注入，
适合排队的下一个任务。pi 用两条队列分别实现，abort 时队列内容
退回输入框而不是丢弃。」

**问题 3：流式输出的工具调用有什么坑？**
「最大的坑是响应被 max_tokens 截断：拼出来的 JSON 参数可能语法合法
但语义残缺，执行就是事故。pi 的做法是 stopReason=length 时整批 tool call
拒绝执行、让模型重发；其次是并行工具批里混着写操作，
pi 允许单工具声明 sequential 让整批降级串行。」

**问题 4：长会话上下文怎么做持久化和压缩？**
「学 pi 的会话树：append-only 的 JSONL entry 流，uuid + parent 指针成 DAG，
上下文是活动分支的投影，fork 只是换指针；压缩是往流里追加一个
summary entry，原始历史不动、可审计。压缩摘要里附上文件操作清单，
模型压缩后仍记得摸过哪些文件。」

**问题 5：Skills 机制怎么省 context？**
「prompt 里只放技能索引卡（name+description+路径），命中才读全文——
渐进式披露。pi 的 skill name/description 还有规范级校验，
无效条目降级为 warning 不阻塞加载。」

## 九、延伸阅读

- 官方架构说明：
  [how-pi-works.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/how-pi-works.md)
  与 [session-format.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)。
- 仓内对照阅读：[AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)、
  [工具调用与 MCP](./工具调用与mcp.md)、[记忆与上下文工程](./记忆与上下文工程.md)。
- 动手作业：[coding/工程手撕/手写最小agent.md](../../coding/工程手撕/手写最小agent.md)——
  读完 pi 的 loop 再手写一遍最小版，面试现场就能复现。
- vLLM/SGLang 侧的同款「一次请求全链路」分析：
  [inference/源码解读/](../inference/源码解读/源码学习路线图.md)。
