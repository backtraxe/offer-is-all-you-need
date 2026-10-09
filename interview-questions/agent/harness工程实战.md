# Agent Harness 工程实战：稳定性 · 并发 · 状态 · 复现 · 监控

> 本篇面向要回答「这个 agent 系统在**生产**上靠不靠谱」类问题的读者——
> 它们不是理论八股，而是 harness 上线后天天撞的工程题。
> 四个框架分析文是「按框架讲」（[pi](./pi-agent源码分析.md) /
> [dsh](./deepseek-harness分析.md) / [codex](./codex源码分析.md) /
> [MiniMax Code](./minimax-code分析.md)），本篇换个视角**按问题讲**，
> 把四家的答案拧成一套可迁移的方法论。

## 一、稳定性：把不确定的模型包在确定的结构里

六层手段，按离模型由近到远：

**1. 契约不抛异常（失败全部数据化）**
pi 的 `StreamFn` / `convertToLlm` / `transformContext` 契约全写明
must not throw——失败编码成流内事件；工具错误一律 `isError: true`
回喂模型。**任何组件挂掉，事件序列对 UI 依然完整**。

**2. 执行护栏**
- 截断熔断：`stopReason=length` 时整批 tool call 拒执（pi）——
  半截 JSON 参数语法合法 ≠ 语义完整；
- 并发安全：exclusive 工具构成 barrier（dsh `isConcurrencySafe()`
  纯函数分类；pi 批内一个 sequential 整批降级）；
- 循环兜底：max-steps、token 预算、runaway guard（mcode 有独立
  `runaway-guard` 模块）。

**3. 权限与审批**
高危动作进审批链：dsh 的 pre-execute waterfall、codex 的四档
AskForApproval、mcode 的四档 + 云端分类器。铁律：**无人可答 = deny**
——拒绝是数据化失败，不是崩溃。

**4. 确定性优先**
能代码确定的判断不留给模型：dsh 先确定性裁剪 tool result 再决定
要不要花模型摘要；mcode 给 edit diff 加 `maxEditLength` 硬上限
（20,000 行重写 167s→193ms）。

**5. 版本与状态防护**
会话 append-only、committed generation 永不覆盖（dsh 版本链式
迁移）；prompt 分节 + diff patch（pi，保护 cache 命中率）；
权限判定单调收紧（dsh monotonic guard，顺序无关不错序）。

**6. 观测性即稳定性**
codex 的全链路 OTel span + token 水位 gauge——看不见的失败
等于没失败过，直到爆雷那天。

## 二、高并发：会话内串行，会话间并行

先纠正直觉：**agent 高并发 ≠ 推理高并发**。模型并发已被推理引擎
解决（continuous batching，一个 batch 塞几百请求），agent 每个
turn 对它只是普通一条。agent 侧的真问题是**状态**：

**会话内严格串行**。理由：上下文是 append-only 线性历史，
两个并发 turn 同写一条历史 = race。

- pi：steering/follow-up 两条 `PendingMessageQueue`，当前 run
  不结束不消费新输入——用户插话**排队而非打断**；
- dsh：durable inbox 投影，一个会话至多一个进程内 Activation，
  turn 边界才 claim；
- codex：mailbox + input_queue 同构。

**会话间天然并行**。会话之间没有共享可变状态：

- 无状态入口先行：print/headless 模式（`mcode exec`、dsh headless）
  随便横向扩容，CI 场景首选；
- 交互长会话：多副本 + **会话亲和路由**（sticky），同会话请求
  路由到持有其 Activation 的实例；
- 更激进：dsh 把状态完全外部化到日志——**实例只是临时工**，
  任何实例都能从日志 restore 接管，连 affinity 都可以不要。

**模型侧背压**：租户级配额在网关层做（QPM/TPM）；单会话自身
fan-out 也要限——dsh 的 `maxParallelSubCalls`（PTC 并发上限）、
`maxDepth`（委派深度）、并发工具 barrier，防一个会话自己打爆配额。

## 三、状态保存：事件溯源是共同答案

四家不约而同选 **append-only 事件日志 + 状态投影**，而不是
「存 messages 数组快照」：

| Harness | 存储 | 组织 | 恢复 |
|---|---|---|---|
| pi | JSONL 会话文件 | 树：uuidv7 + parent 指针成 DAG，fork=换指针 | 重放活动分支投影 |
| dsh | `session.vN.jsonl[.zstd]` | 版本链式迁移，committed generation 永不覆盖 | `deriveMessages()` 投影 |
| codex | rollout JSONL + SQLite state | JSONL 是重放真相源，SQLite 管结构化查询 | resume 重建历史数组 |
| MiniMax Code | 继承 pi + better-sqlite3 | fork/rewind/export | 同上 |

为什么不是快照：**可重放**（fork/resume/审计无第二份真相漂移）、
**崩溃安全**（追加写原子，断电最多损失最后半条）、**可审计**
（「模型当时看到了什么」必须可重建——合规与调试的共同刚需）。

## 四、Checkpoint：三种语义别混

1. **训练 ckpt**：模型权重，与 agent 无关；
2. **会话级提交点**：**turn 是天然的 commit point**（dsh：turn/start
   到 turn/end 原子属于一轮，失败记 log-only attempt 不进模型历史）；
   compaction 也落 checkpoint（dsh `surfaceOp: replace` + 摘要 envelope、
   codex `CompactedHistoryMetadata` 带 window/model hash）；
3. **执行级恢复点**：中断显式标记而非静默继续——codex 的
   interrupted history marker（模型下轮知道「上次被打断」）、
   dsh 的孤儿锁检测（有 `compaction/start` 无 `end` = 可检测崩溃
   而非误报完成）。

**本质：把「执行到哪了」也变成日志事件**，与会话状态共用同一套
事件溯源，而不是另起快照系统——和数据库 WAL 同一哲学。

## 五、复现问题：日志 + mock + 快照三层基建

agent 的非确定性让 bug 复现成为专门学问：

1. **完整会话日志做底**：复现 = 重放。出事的 session 文件找回当时
   完整输入（prompt、历史、工具集、模型版本）；
2. **模型可见性不变式**：dsh 的 "model-visible means logged"——
   模型当时看到的每个字必须能从日志重建（含 system prompt、
   摘要调用 envelope）。没有这层，「复现」只是「拿相似输入再试」
   的玄学；
3. **确定性回放环境**：同输入重放时换 mock/faux provider（不发
   真实 API），隔离「模型变了还是代码变了」；稳定的 model-visible
   文本做 snapshot diff；真实失败请求录成离线 fixture。

**一句话**：日志做底 + mock 去噪 + 快照定边界。三条齐了，bug 从
「神奇不复现」变成「第 N 条 entry 之后 diverge 了」。

## 六、监控：三层指标 + trace + 面向任务的 SLO

harness 监控与普通后端最大的不同：被监控对象一半确定性代码、
一半概率性模型。

**三层指标**：

| 层 | 看什么 | 告警信号 |
|---|---|---|
| L1 系统 | 进程/队列深度/子进程泄漏 | inbox 积压、goroutine/fiber 泄漏 |
| L2 引擎 | turn 延迟分布、token 速率、**上下文水位**、事件序列完整性（孤儿 turn/锁）、工具失败率、steps/turn、审批拒绝率 | 水位 >80%（compaction 风暴前兆）、单 MCP server 掉线 |
| L3 质量 | 采样 LLM-as-judge、决策轨迹指标（该检索未检索率、漂移检测）、用户信号（Esc 中断率、放弃率） | 质量分周环比下降、路径方差突变 |

**Trace 是第二支柱**：codex 的 span 分段（`run_turn` 下分
prepare_sampling/collect_post_sampling，带 token 用量与 window id）
可以直接聚合「turn 时间花在哪」；tool_call_id 贯穿模型输出→
审批→执行→result，跨 MCP server 要透传同一 trace id。

**告警面向任务 SLO 而非原始指标**：

```text
SLO1 可用性：agent_end 成功率 ≥ 99.5%（排除用户 abort）
SLO2 时效  ：P95 turn 时长 ≤ N 秒（按任务类型分桶）
SLO3 经济性：单会话平均 token ≤ 预算（成本失控比延迟更隐蔽）
SLO4 质量  ：采样质量分环比不降
```

两条降噪经验：按**模型/任务/租户三维分解**再告警（一锅烩全是噪音）；
**突变告警优于阈值告警**（模型换版/prompt 改动引发的是阶跃）。

**落地最小集**（自建 harness）：结构化事件日志 + 四个关键指标
（turn 时长 / 工具失败率 / token 水位 / Esc 率）+ 每周质量采样。
隐私约束参照 mcode：usage/metrics/diagnostics 三路分开、默认全关、
opt-in，诊断上传前 allowlist 最小化 + 加密。

## 七、▶ 面试挂钩

**问题 1：agent 系统怎么保证线上稳定性？**
「六层：契约不抛异常（失败数据化进事件流）；执行护栏（截断熔断、
并发 barrier、循环预算）；权限审批（无人可答=deny）；确定性优先
（能代码判断的不问模型）；版本与状态防护（日志不可变、prompt
diff、guard 单调）；观测性兜底。核心思想一句话：**模型可以错，
工程结构保证错得可见、可拦、可回退**。」

**问题 2：agent 怎么做高并发？**
「先分战场：模型并发归推理引擎（CB/batching）。agent 编排层是
会话内串行、会话间并行：会话内由消息队列保证（pi steering
队列、dsh durable inbox），上下文 append-only 本质禁止并发写；
会话间无共享状态，无状态入口直接横向扩，长会话做亲和路由或
像 dsh 那样状态外置、任意实例 restore 接管。配额和背压在网关层
加单会话 fan-out 上限。」

**问题 3：agent bug 难复现怎么办？**
「三层基建：事件溯源日志做底（重放即复现）；model-visible means
logged 保证当时输入可精确重建（含 prompt、工具集、摘要 envelope）；
回放时用 mock provider 隔离模型噪声，稳定文本做 snapshot。
三件套齐了，bug 从玄学变成『哪条 entry 之后开始分叉』的定位题。」

**问题 4：agent 的监控和普通后端有什么不同？**
「多两层。系统层相同；**引擎层**是 harness 特有：turn 延迟、
token 速率、上下文水位、事件序列完整性、工具失败率、steps/turn；
**质量层**是 agent 特有：采样评估、决策轨迹、Esc 率。
告警面向任务 SLO 并按模型/任务/租户分解，突变优于阈值。」

## 八、附一：system prompt 组织方式——四家对照

一份完整上下文 = **分节的 system 区（选择索引，求前缀稳定）+
append-only 历史区（经历，求可压缩）+ 最新用户消息（本轮任务）**。
四家在同一骨架下各守一极（分节细节见各自分析文）：

- **pi：prompt 是消息**。分节 sections（preamble/tools/rules/docs/
  project_context/skills/cwd），`diffSystemPromptSections()` 只重发
  变化节；工具增删编码成 `toolsAdded/Removed` 系统消息通报模型——
  回放时能精确还原「当时模型以为自己有哪些工具」；
- **dsh：prompt 是日志**。`system/message` 直接落 session log
  （model-visible means logged）；空渲染 = 清空所有活跃 prompt 节点；
  capable 路由走增量追加， incapable 才合并重写；
- **codex：prompt 是快照**。step_context 每 step 捕获一份
  （模型设置/环境/必需 MCP·skills），历史截断时「被截走的内容和
  它依赖的状态一起消失」（reasoning override 与所属输入同时截）；
- **mcode：prompt 是产品**。pi 分节 + 账号/配额状态只读注入
  （headless 重检不改全局配置）；skill 三目录兼容抢生态位。

两条共同铁律：**前缀稳定 = 缓存命中率**（不变内容全往前放，
动态信息绝不插 system 中间）；**白名单投影**（工具的 execute/
UI/超时配置永不泄漏给模型，模型只拿选择所需的最小子集）。

## 九、附二：生产故障两则

### 9.1 第三方工具超时

按层处置，别只设一个总超时：

1. **分层超时**：连接（秒级）/首字节（可放宽，codex SSE 头从
   10s→30s 的真实补丁）/流式静默（mcode 300s）/总时限分开；
   工具上限必须短于 turn 预算，给「超时后模型重试一轮」留空间；
2. **重试语义**：只对幂等调用（查询类指数退避）；写操作先查状态
   或带幂等键；第二次尝试把第一次失败喂给模型让它换参数/降级——
   **重试是模型的决策，不是代码的反射**；
3. **数据化+降级**：超时 = `isError: true` 的 toolResult，文案写成
   可行动（「建议缩小窗口或换 grep」而非 `TimeoutError`）；
   同工具连续熔断 → 切备用通道，半开探测恢复；
4. **用户侧**：长任务转后台（task_output 模式），别静默卡死。

### 9.2 模型输出 JSON 错乱（三病型分型）

| 病型 | 特征 | 处置 |
|---|---|---|
| A. 截断 | `stopReason=length`，JSON 不完整 | **绝不执行**（pi 整批熔断，让模型带完整参数重发）；预防：分片写或调大 max_tokens |
| B. Schema 偏移 | 完整但字段/类型不符 | JSON Schema 硬校验 → 错误原文喂回自愈（1 轮内通常修好）→ `prepareArguments` shim 兼容常见错；根治派用 constrained decoding 让非法 JSON 无法生成 |
| C. 语义幻觉 | 格式合法但工具名/参数是编的 | 工具名白名单拦截 + 喂回可用列表；mcode `unexpectedToolCallFallback` 处理「宿主没声明工具模型硬要调」的变体 |

通用兜底：**拦截（校验/截断检测）→ 数据化回喂（不抛异常）→
给修复所需信息（可用列表/schema 原文/错误位置）→ 限自愈轮数 →
全进 trace**。评估标准一句话：好的错误处理让模型一步修好。

## 十、延伸阅读（仓内）

- 四个框架的对应章节：[pi](./pi-agent源码分析.md)、
  [dsh](./deepseek-harness分析.md)、[codex](./codex源码分析.md)、
  [MiniMax Code](./minimax-code分析.md)。
- 上下文与压缩：[记忆与上下文工程](./记忆与上下文工程.md)。
- 引擎侧容量同款方法论：[推理服务 SLO 与运营](../inference/推理服务slo与运营.md)。
- 评估层：[多 Agent 与评测](./多agent与评测.md)。
