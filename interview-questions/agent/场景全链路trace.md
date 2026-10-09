# 场景全链路 Trace：一轮Agent 请求的解剖实录

> 本篇面向读完 [pi](./pi-agent源码分析.md) / [dsh](./deepseek-harness分析.md) /
> [codex](./codex源码分析.md) / [mcode](./minimax-code分析.md) 四篇框架分析、
> 想看「这些东西在一个**具体任务**里长什么样」的读者。
> 构造一个贯穿 6 轮的完整场景——**「修复登录接口偶发超时」**——
> 逐轮展示：上下文长什么样、LLM 看到了什么、它为什么选择这个工具/skill、
> 宿主在每一步干了什么、失败是怎么自愈的。读完你会获得：一张能背下来的
> Agent 解剖图，以及回答「一次请求经过 Agent 的全过程」的标准答案。

## 场景与任务

> 用户（在客服提的单子里）：
> 「我们 `payments` 服务的 `/login` 接口过去一周偶发 3 秒 timeout，
> 帮查一下原因并修复。」
>
> Agent 环境：真实工作区（monorepo），模型 = Claude 系 coding 能力模型，
> Harness = 类 pi/dsh 的现代 coding agent（四家的共性特征）。

以下按 Agent Loop 的 6 个真实轮次解剖。为可读性，消息只保留关键字段。
**每一轮都给三件事：`LLM 输入` / `LLM 输出` / `宿主动作`。**

## 一、轮 1：意图理解 + 首轮检索

### LLM 输入（context 快照）

```text
[system]
  preamble: You are an expert coding assistant operating inside pi...
  <tools>     read / bash / edit / write / grep / glob / ls / mcp.search_logs ...
  <rules>     先读后改；最小改动；交付前自测
  <skills>    incident-review（故障复盘流程，description 命中）
  <project_context> 根 AGENTS.md：monorepo，payment 服务在 services/payments
  <cwd>       /repo/company
[user]
  我们 payments 服务的 /login 接口过去一周偶发 3 秒 timeout，帮查原因并修复。
```

### LLM 输出

```json
{
  "thought": "偶发超时，先定位代码与日志，缩小范围。",
  "tool_calls": [
    {"name": "grep", "arguments": {"pattern": "login", "path": "services/payments"}},
    {"name": "mcp__search_logs", "arguments": {"query": "/login timeout", "window": "7d"}}
  ]
}
```

### 宿主动作

- **工具选择是 description 路由**：模型在 tool schema 索引里读到了
  grep「按正则检索代码」和 `mcp__search_logs`「查询服务日志」，
  description 匹配「定位原因」意图。MCP 工具在 schema 上和内置工具
  同槽位——模型根本不分它是 MCP 还是内置。
- 两个 toolCall 并行执行（dsh 的 `isConcurrencySafe()` 分类：
  两个只读工具都不是 exclusive）；
- grep 命中 17 处，log 命中超时频率「每天约 4 次，无规律」——
  两条 toolResult 回写上下文；
- **TUI 此刻的状态**：两条 tool_execution_start/end 事件流，
  前端显示两个工具卡片。

## 二、轮 2：读代码 + Skill 按需加载

### LLM 输入（context 变化）

```text
  ...上一轮消息不变...
  [toolResult(grep)]   17 matches: services/payments/src/auth/login.ts:142 ...
  [toolResult(logs)]   timeout 集中在每天 4 次，伴随关键字 pool/exhausted
```

### LLM 输出

```json
{
  "thought": "pool exhausted 指向连接池。这个仓库应该有 incident-review 技能，先加载它按流程走。",
  "tool_calls": [
    {"name": "read", "arguments": {"path": "~/.agent/skills/incident-review/SKILL.md"}},
    {"name": "read", "arguments": {"path": "services/payments/src/auth/login.ts"}}
  ]
}
```

### 宿主动作

- **Skill 的按需披露发生在这一步**：索引里 `incident-review` 的
  description 匹配了「故障复盘」模式，模型**主动 read 加载**——
  这 2000 token 的说明书之前根本不在上下文里；
- 两份 read 并行，SKILL.md 给出流程「1. 重现 2. 定位 3. 修复 4. 验证」；
- login.ts 第 142 行附近发现 `pool.acquire({timeout: 3000})`——
  硬编码 3 秒与现象吻合。

## 三、轮 3：修复 + 权限闸

### LLM 输出

```json
{
  "thought": "两处修复：1) timeout 提到 10s 并作配置项；2) 排队加指标。先改最小的一处。",
  "tool_calls": [
    {"name": "edit", "arguments": {"path": "services/payments/src/auth/login.ts",
      "old": "pool.acquire({timeout: 3000})", "new": "pool.acquire({timeout: config.pool.acquireTimeoutMs})"}}
  ]
}
```

### 宿主动作（这一轮是 harness 分层的舞台）

- **权限闸**：edit 是 exclusive 工具 + 写操作，dsh 的
  `tools/pre-execute` waterfall 检查到工作区信任等级=trusted，
  rule-based 允许修改 `services/**`，放行不打扰；若信任级别低，
  此处会弹人工 approval 卡；
- **execpolicy 命中**：codex 系会拿 `login.ts` 路径对规则表评估，
  allow 则免审批；
- edit 成功，toolResult 包含 diff 摘要（mcode 的 `maxEditLength` 护栏
  此时保证 diff 不会爆炸）；
- **run_hooks_and_record_inputs**（codex）：hook 写了
  `file-modified` 事件进会话日志——审计从此可查。

## 四、轮 4：验证生成失败 + 自愈

### LLM 输出（第一次）

```json
{
  "thought": "跑单测验证。",
  "tool_calls": [
    {"name": "bash", "arguments": {"command": "npm run test services/payments -- -t login", "timeout_ms": 60000}}
  ]
}
```

### 宿主动作（含一次自愈）

- bash 执行但**命令不存在**（这个 monorepo 用 pnpm 不是 npm）；
- bash 的 toolResult：`isError: true, exit: 127, stderr: "command not found: npm"`；
- **关键：错误被数据化回喂，不炸循环**；

### LLM 输出（第二轮）——自愈发生

```json
{
  "thought": "npm 不存在，这个仓库是 pnpm 工作区（根 AGENTS.md 写过）。",
  "tool_calls": [
    {"name": "bash", "arguments": {"command": "pnpm --filter payments test -- -t login", "timeout_ms": 120000}}
  ]
}
```

- 第二次成功，单测 18 passed 1 failed——失败的用例恰好暴露了
  timeout 仍然 3000ms 的旧配置路径；
- **fail 也是 Observation**：模型看到具体断言 `expected 10000,
  received 3000`，下一轮继续修。

## 五、轮 5：根因修复 + 全量验证

模型发现配置读取用错了 key（`pool.acquireTimeoutMs` 写成了
`pool.acquire_timeout_ms` 的蛇形变体不匹配 YAML），
一处 edit 修复 + 全量测试通过（24/24）。

**该轮宿主干预**：

- runaway-guard 检查：当前 4 轮已消耗 ~85K tokens，未超预算；
- compaction 未触发（上下文水位 62%，低于 75% 阈值）。

## 六、轮 6：交付 + 复盘生成

### LLM 输出（最后一轮）

```text
根因：连接池 acquire 超时硬编码 3s 且配置读取键错误，导致连接池
高峰耗尽时直接 3 秒超时而不是排队等待。修复 2 处：超时改为配置项
+ 修正配置键。单测 24/24 全过。

附加发现：日志里 pool/exhausted 频率与业务高峰吻合，建议下一步
评估连接池容量（This is beyond the scope）。
```

### 宿主动作

- `finishTurn` 决策返回 `{ action: "end" }`，
  `agent_end` 事件携 14 条 newMessages 收尾；
- 会话日志追加：2 system/user messages + 6 assistant/tool 对 +
  1 次 hook 事件（事件溯源完整）；
- **重启此处再进入**：会话可从 JSONL 完全重建；
- 复盘附录：这轮任务中 steering 队列收到过一次用户插话改成
  follow-up 排队（「顺便把 /logout 也加上同样配置」）——
  follow-up 在 agent_end 后被消费，开启新的一次外层循环
  （pi 的 steering/follow-up 分语义就在这体现）。

## 七、全景解剖图：数据在每个角色间怎么流

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-turn-trace.html" width="100%" height="720" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-turn-trace.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 八、各参与点速查（面试抽认卡）

| 环节 | 发生在哪轮 | 关键机制 | 源码侧参照 |
|---|---|---|---|
| 意图理解 | 轮 1 思考语 | 输入语义匹配 | [意图四层](./agent基础与规划.md#41-补充意图处理规划的上游) |
| 工具选择 | 轮 1-6 每次 toolCall | description 路由 + schema 索引 | [工具调用与 MCP](./工具调用与mcp.md) |
| Skill 触发 | 轮 2 | 索引→命中→read 加载（渐进式披露） | [Skills 详解](./agent-skills详解.md) |
| 权限闸 | 轮 3 | trusted workspace / execpolicy / approval | [codex 源码分析](./codex源码分析.md) |
| 失败自愈 | 轮 4 | 错误数据化 + 模型重试 | [Harness 工程实战](./harness工程实战.md) |
| Steering 注入 | 轮 6 间隙 | follow-up 队列（不插入当前 run） | [pi 源码分析](./pi-agent源码分析.md) |
| 会话固化 | 全程 | append-only 事件日志 | [Harness 工程实战](./harness工程实战.md#三状态保存事件溯源是共同答案) |
| 健康守护 | 全程 | runaway guard / token 水位 / compaction 阈值 | 同上 |

## 九、▶ 面试挂钩（用这个场景答题）

**问题 1：从用户输入到 agent 修复完代码，数据是怎么流的？**
「六轮：① 意图理解+检索（grep+log 并行）；② 加载 skill + 读代码；
③ edit 走权限闸修复；④ 单测失败自愈（换 pnpm）；⑤ 根因修复全量
测试过；⑥ 交付报告 + follow-up 入队。每轮间宿主做决策（工具路由
并行/权限/护栏/日志），模型只做『判断+生成』——重点：全过程模型
的输入是**消息流（系统分节+历史+工具结果）**，输出是**结构化
toolCall**——宿主与模型是两个世界通过 FC 接口单向连接的。」

**问题 2：这个流程里 prompt 起了几次作用？**
「系统 prompt 每轮都在（分节+prompt cache 摊销），但**形状会变**：
第 2 轮 skill 加载后多一节说明书、第 3 轮工具的 approval 结果
以水注事件进消息流、第 4 轮失败测试把摘要用例拉进上下文。
所以说『prompt 不是一张静态契约』，而是**活的消息流的投影**。」

**问题 3：如果第 4 轮测试持续失败，会怎样？**
「三层剂量逐层上：模型自我修正（一般 1-2 轮有效）→ 触发 runaway
guard 硬兜底，把问题 escalate 回用户（非静默打转）→ 失败后依然
可以复盘——会话日志完整记录错误尝试。这就是为什么 harness 的
guard 不是「可有可无的保险」，而是长任务的氧气面罩。」

**问题 4：这个场景里 Steering 和 Follow-up 的区别体现在哪？**
「轮 6 中途用户问『顺便改下 /logout』——这是 follow-up（等本轮
完成后才消费，不插入当前 run）；如果是轮 4 就说「别用 edit，先试
配置热更」，就是 steering 会立即插入、影响下一轮。两者落地的
代码上是两条队列，时机上是「运行中纠偏」与「运行完结后追加」。」

## 十、延伸阅读（仓内）

- 框架全景：[Pi](./pi-agent源码分析.md) · [dsh](./deepseek-harness分析.md) ·
  [Codex](./codex源码分析.md) · [MiniMax Code](./minimax-code分析.md)；
- 上下文预算与压实：[记忆与上下文工程](./记忆与上下文工程.md)；
- 技能机制：[Agent Skills 详解](./agent-skills详解.md)；
- 失败与自愈：[Harness 工程实战](./harness工程实战.md)；
- 进阶主线：[Agent 由浅入深路线图](./agent由浅入深路线图.md)。
