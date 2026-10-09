# MCP vs 工具调用深度对比：供货侧与最后一公里

> 本篇是 [工具调用与 MCP](./工具调用与mcp.md) 的深挖姊妹篇——那篇回答
> 「是什么、怎么防注入」，本篇回答**「两者到底在工程上差在哪、什么时候
> 用哪个」**。素材来自本仓库 Agent 框架四部曲的一手源码阅读
> （[pi](./pi-agent源码分析.md)、[dsh](./deepseek-harness分析.md)、
> [codex](./codex源码分析.md)、[MiniMax Code](./minimax-code分析.md)）。
> 读完你会获得：一张「供货侧 vs 最后一公里」的心智地图、MCP 协议生命周期
> 的完整拆解、四个真实 harness 里 MCP 工具与内置工具如何统一进同一管线
> 的源码证据，以及选型决策树。

## 一、一句话定性：根本不在同一层

很多人问「MCP 会不会取代 Function Calling」——这个问题本身问错了层：

```text
模型只看得见 Function Calling（tool schema 进上下文，JSON tool call 出上下文）
                              │
                              ▼ 宿主解析后，走哪条路去执行？
              ┌─── 内置工具：直接调 runtime 里的 execute 函数（进程内）
              └─── MCP 工具：JSON-RPC 发给独立的 MCP Server 进程/服务（进程外）
```

**FC 是模型与宿主之间的「最后一公里」约定；MCP 是宿主与工具供给方之间的
「供货侧」协议。** 对模型而言两者完全不可见——它永远只发出同一份
tool call JSON。差异全部发生在宿主往外走的那几米。

<div class="diagram-embed">
<iframe src="assets/diagrams/fc-vs-mcp-paths.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/fc-vs-mcp-paths.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

记住这个分层，下面所有对比都是它的展开。

## 二、协议解剖：「无协议」vs 完整生命周期

### 2.1 Function Calling：严格说它不是协议

- 没有实体、没有连接、没有握手——只有**一次请求里的两个字段**：
  请求侧的 `tools`（schema 数组）和响应侧的 `tool_calls`；
- schema 校验、执行、回填全部是**宿主的自由实现**；
- 状态活在对话历史里：tool result 以 tool message 形式回填，
  下一轮请求重放全部历史——**协议状态 = 文本**。

证据来自 pi 的 `streamFn` 契约（`packages/agent/src/types.ts`）：
loop 只保证「模型消息进、assistant 事件流出」，工具执行态完全不进
模型协议——这正是「FC 无协议」的代码级体现。

### 2.2 MCP：有完整生命周期的真协议（JSON-RPC 2.0）

一个 MCP Client↔Server 会话的典型生命周期：

```text
initialize（握手：协议版本 + client/server capabilities 协商）
  → notifications/initialized
  → tools/list（拉取工具目录：name/description/inputSchema）
  → tools/call（发起调用，参数经 Server 校验执行）
  → 可选：resources/list, resources/read（只读数据）
  → 可选：prompts/list, prompts/get（预置模板）
  → 可选：notifications/tools/list_changed（工具热更新推送）
```

传输三种形态各有选型含义：

| Transport | 场景 | 代价 |
|---|---|---|
| **stdio** | 本地子进程（Claude Desktop 式） | 一台 Server 一个进程，I/O 开销小，无网络面 |
| **Streamable HTTP** | 远程服务、多客户端共享 | 要处理鉴权、会话恢复（MCP-Session-Id） |
| **SSE（已并入 Streamable HTTP）** | 老资料里的独立传输 | 新口径下视为 Streamable HTTP 的一部分 |

**三原语对照复习**：Tools（模型控制）/ Resources（应用控制）/
Prompts（用户控制）——深度题的分水岭，详表在
[工具调用与 MCP 第五节](./工具调用与mcp.md#五mcp-是什么)。

## 三、「模型无感」的源码证据：四个 harness 怎么焊这一段

四部曲里每家都回答了同一个问题：**MCP 工具发现之后，怎么和内置工具
进同一条执行管线？** 答案惊人一致——转成普通 ToolDefinition。

| Harness | 关键实现 | 一句话 |
|---|---|---|
| **pi** | `declareToolChanges()`：`toolsAdded/toolsRemoved` 以系统消息形式向模型**通报工具集变化** | MCP server 上线/下线对模型也是「一切皆消息」 |
| **dsh** | Schema 白名单投影：内置工具走受限 JSON Schema 子集；**MCP 工具直接透传 raw schema**；全部进同一条 pre-execute→guard→post-execute 管线 | MCP 工具和内置工具共用审批/沙箱/超时 |
| **codex** | MCP server 发现后挂载进 `spec_plan.rs` 的 ToolSpec 列表，路由层不区分来源 | 「MCP 只是另一种工具注册方式」 |
| **MiniMax Code** | MCP + managed connectors 云侧代理，工具 schema 统一进本地 catalog | 连「云端连接器」这种形态也焊进同一管线 |

两个可背诵的工程细节：

1. **schema 不是无条件透传的**。dsh 对内置工具施加「受限 JSON Schema
   子集」约束（execution/UI 字段永不泄漏给模型），而 MCP 工具给的是
   raw schema——因为 Server 是第三方，无法强约束它的写法。
   这解释了为什么**自家 MCP Server 的 schema 质量参差不齐会直接影响
   FC 准确率**（对照 [工具调用与 MCP 第三节](./工具调用与mcp.md#三工具-schema-设计被低估的工程题)
   的 Schema 设计纪律——写 MCP Server 时同样适用）。
2. **动态工具集要「告知模型」**。pi 把 tools added/removed 编码进
   transcript；dsh 用 `tools/*` capability 事件广播。否则模型还拿着
   旧目录调用已下线的工具——「工具热更新」不是加个 server 就完事。

## 四、工程差异速览（选型要对照的七个维度）

| 维度 | 内置工具（FC 直连） | MCP 工具 |
|---|---|---|
| 部署耦合 | 与宿主同进程同发布 | 独立进程/服务，独立发布 |
| 故障隔离 | 一次 panic 可能带走宿主 | Server 崩了宿主只收到一个错误结果 |
| 权限边界 | 继承宿主进程权限（最大） | 可单独沙箱/容器化，天然最小权限 |
| 复用性 | 只有自家宿主能用 | 任何 MCP 宿主即插即用（N×M→N+M） |
| 性能 | 进程内调用，~µs | stdio ~ms 级，远程 HTTP 还要加网络 |
| 调试与观测 | 跟宿主同一 trace | 跨进程，需要 Server 侧日志拼接 |
| 版本兼容 | 跟宿主一起升级 | 协议版本协商（initialize 的 capabilities） |

**性能数字感**：本地 stdio MCP 调用在毫秒级——对「模型思考一次几百
毫秒到几秒」的 agent loop 而言**通常不是瓶颈**；真正要警惕的是
**远程 MCP 的超时与重试语义**混进 agent loop 的节奏（见
[工具调用与 MCP 第 2.4 节](./工具调用与mcp.md#24-高频追问工具调用失败参数漂移超时重试)
的失败分类表，MCP 场景同样适用，且「工具不存在」要扩展成
「server 掉线/工具目录变了」两种子情况）。

## 五、选型决策树

```text
要给 Agent 接一个能力，先问三个问题：
├─ Q1 这个能力只有我自己用吗？
│    ├─ 是 → Q2 它对故障/权限敏感吗？
│    │    ├─ 敏感（要沙箱、要独立发布）→ 自建 MCP Server（stdio 最省事）
│    │    └─ 不敏感 → 内置工具（进程内函数，最简单）
│    └─ 否（想给生态用 / 用别人的）→ MCP（生态即插即用）
├─ Q2 能力本来就是现成 REST/gRPC API？
│    ├─ 是 → 薄包一层内置工具先跑通；需要共享/生态时再 MCP 化
│    └─ 注意：把 API 大包原文当返回是反模式，schema 层做裁剪
└─ Q3 对接的是「另一个 Agent」而不是「一个工具」？
     → 那不是 MCP 的事，是 A2A 的事
       （见 [工具调用与 MCP 第 6.1 节](./工具调用与mcp.md#61-agent-协议全景2026-视角)）
```

**经验法则**：先做内置工具验证价值（一天），要共享、要隔离、要生态时
再 MCP 化（一周）；**不要为「可能有人用」提前 MCP 化**——多一层
进程边界就多一层运维（版本协商、超时、日志拼接）。

## 六、▶ 面试挂钩

**问题 1：MCP 会不会取代 Function Calling？（高频原题）**
「不会，因为它们不在同一层。FC 是模型与宿主之间的最后一公里——
模型只会这一种表达工具调用的方式；MCP 是宿主与工具供给方之间的
供货侧协议，解决 N×M 集成降为 N+M。真实链路里两者是串联关系：
MCP Server 暴露的 tools 经宿主拉取（tools/list）后，以普通 FC
schema 的形式注入模型上下文；模型发出的 tool call，宿主路由到
对应 MCP Client 转发（tools/call）。我读过 pi/dsh/codex 的源码，
四家都是这个焊法：MCP 工具转成普通 ToolDefinition 进同一条
执行管线，审批、超时、截断一视同仁。」

**问题 2：MCP 和直接函数调用比，有哪些固有代价？**
「四类：进程边界成本（stdio 毫秒级延迟 + 序列化，本地可忽略、
远程要计入 TTFT 预算）；运维面（server 生命周期、协议版本协商、
工具热更新时要通知模型——pi 用 toolsAdded/Removed 系统消息做）；
调试复杂度（跨进程 trace 拼接）；以及 schema 不可控——第三方
Server 的 schema 写得差会直接拖垮 FC 准确率，且你没法像内置工具
那样约束它的输出结构。」

**问题 3：MCP 工具怎么进权限/审批体系？**
「以 dsh 为例：MCP 工具和内置工具走同一条 pre-execute waterfall——
审批、monotonic guard、超时、post-execute 改写全部适用；
差别只在 schema 来源（内置受限子集 vs MCP raw 透传）。
codex 的 granular 审批里甚至单列了 MCP elicitation 开关。
所以答案是：MCP 不应该成为权限的旁路——进管线即受管制，
这也是反对『Agent 直接裸连第三方 API』的理由。」

**问题 4：什么时候内置工具、什么时候 MCP？**
「三问决策：只有自己用且不敏感 → 内置工具；要独立发布/沙箱隔离/
被生态复用 → MCP；对方是另一个 Agent → 那是 A2A 不是 MCP。
经验法则是先内置验证价值，再按需 MCP 化——提前 MCP 化等于
提前背上进程边界的运维税。」

**问题 5：MCP Server 的工具很多时怎么管理上下文？**
「分层披露：先只给索引（工具名 + 一句话描述，对应 pi 的 skills
渐进式披露思路在工具域的镜像）；模型选定后再给完整 schema。
生产上的做法有两派：Tool RAG（向量检索 Top-K 工具注入）和
层级元工具（只暴露 invoke(tool_name, args)，模型先查目录）。
MCP 本身没解决这个问题——它管发现，不管上下文预算，预算归宿主
的 transformContext/compaction 管。」

## 七、延伸阅读（仓内）

- 基础与防护：[工具调用与 MCP](./工具调用与mcp.md)（FC 原理、
  Schema 设计纪律、大规模工具集降幻觉、注入防护）、
  [多 Agent 与评测](./多agent与评测.md)（A2A、HITL）。
- 四个 harness 的工具管线一手源码：
  [pi](./pi-agent源码分析.md#三工具协议从-schema-到执行)、
  [dsh](./deepseek-harness分析.md#四工具管线policy-不碰-loop)、
  [codex](./codex源码分析.md#五工具与-task-生态速览)、
  [MiniMax Code](./minimax-code分析.md#二企业外壳pi-缺失的商业补件清单)。
- 系统设计落点：[设计企业知识库 Agent](../../system-design/设计企业知识库agent.md)、
  [设计个人助理 Agent](../../system-design/设计个人助理agent.md)——
  看工具/MCP 在完整系统设计里的位置。
