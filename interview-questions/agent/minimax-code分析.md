# MiniMax Code 分析：极简 pi 的商业化终局

> 本篇面向已读过 [Pi Agent 源码分析](./pi-agent源码分析.md) 的读者——
> 这篇是它的**直接续集**。MiniMax 官方的 coding agent
> [MiniMax Code](https://github.com/MiniMax-AI/minimax-code)（CLI 名 `mcode`，
> MIT 开源 source preview）做了一个出乎很多人意料的技术选择：
> 不从零自研、不 fork Claude Code，而是**把极简 harness pi
> （earendil-works/pi-mono）整体 vendor 进 `third_party/`**，
> 在其上叠加自研的云托管运行时和企业级功能外壳。
> 读完你会获得：「vendor 极简底座 + 补丁台账 + 企业外壳」这条
> 商业化路径的完整解剖——patch ledger 里每一条都是大厂在极简
> harness 上做工程加固的真实案例，以及四篇框架分析的收束对比。

## 〇、为什么是 MiniMax Code：第四块拼图

前三篇给了三个学术化极端：

- **pi**：极简地板（明说无内置权限系统，建议容器化）；
- **dsh**：解耦天花板（一切皆插件）；
- **codex**：安全纵深（审批 × 规则 × 沙箱）。

MiniMax Code 回答的是一个更现实的问题：**一个产品团队拿到 pi 这种
「能跑但赤手空拳」的底座之后，要怎么把它做成收费产品？**
答案是它的仓库本身就是一本教科书：

```text
third_party/pi-mono/            原样 vendor 的 pi 底座（上游 v0.79.1）
  └─ MINIMAX_CHANGES.md         补丁台账：每条改动的原因、范围、验证方式
third_party/sandbox-runtime/    Anthropic sandbox-runtime 的 fork（补 OS 沙箱）
packages/                       自研外壳：tui / local-runtime-v2 / agent-*
  ├─ agent-modules/             goal、permission、skills、cron、plugin-hooks…
  ├─ oauth-core + oauth-lease-protocol   账号体系 + 短时令牌 lease
  └─ config + protocol + shared 配置协议层
release/public-source.json      内部 monorepo → 公开版的显式文件清单
```

一句话：**agent loop 是借来的，产品是自己的。**

<div class="diagram-embed">
<iframe src="assets/diagrams/mcode-vendor-arch.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/mcode-vendor-arch.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、vendor 策略：不改一行上游文件，但记账每一分补丁

`third_party/pi-mono/MINIMAX_CHANGES.md` 是全文最值得细读的文件。
它的规矩：基线 import **不动任何上游源文件**；之后所有本地修改逐条登记
——日期、原因、影响的包、改动类型、是否可 upstream、验证命令。
目前已累积 15+ 条，按主题分四类，每一类都是 agent 产品化的必修课：

### 1.1 Provider 兼容战（真实世界的模型 API 没那么标准）

| 补丁 | 问题 |
|---|---|
| `developer` 角色回退 `system` | Mistral / SiliconFlow / DashScope / Kimi Coding 的 OpenAI 兼容端点都不认识 thinking 模型的 `developer` role，一发就 400——按 host 精确匹配回退 |
| 空 `tools: []` 省略 | checkpoint（压缩）请求保留 tool 历史但无工具定义，部分后端直接拒掉空数组（issue #194） |
| Anthropic refusal 保留细节 | Claude 安全拒绝是 HTTP 200 + `stop_reason: "refusal"`，上游映射成 error 后丢了 category/explanation，BYOK 还会傻乎乎重试 |
| Claude 默认 thinking 模型 | Opus/Sonnet 5 默认开 thinking，新版要用 `output_config.effort` 而不是旧的 `budget_tokens` |
| Codex SSE 超时放宽 | 响应头 10 秒超时在生产环境杀掉了健康的长任务，放宽到 30 秒 |

**面试要点**：多 provider 支持的最后一公里全是这种「龙与地下城式」
端点差异（对照 dsh 把 provider 当 adapter seam、pi-ai 统一协议层的
设计目标），补丁台账告诉你兼容层的真实成本在哪。

### 1.2 工具语义加固（demo 语义 → 生产语义）

- **Bash 重新定义「成功」**：只有 exit code 0 才算成功；信号、取消原因、
  超时、部分输出全部保留进结构化结果；输出 24KiB 首响预算 + 完整日志落盘
  （对照 pi 上游的宽松语义）；
- **edit 工具的 diff 爆炸**：整文件重写完 20,000 行要走两遍无界 Myers diff，
  卡死工具 2 分钟+、堆内存 60MB——MiniMax 给两遍 diff 都加了
  `maxEditLength=2000` + 5s 超时，实测 167,620ms → **193ms**，
  峰值堆 47-60MB → 14-15MB；还补了 `patchOmitted` 字段让「diff 被省略」
  和「工具不产 diff」可区分；
- **Windows ConstrainedLanguage**：企业 AppLocker 环境下 PowerShell
  stdin wrapper 自己先挂了——探测 LanguageMode 后降级路径。

### 1.3 Agent loop 宿主 seam（只加孔位，不改语义）

- `unexpectedToolCallFallback`：宿主故意不声明任何工具、但 provider
  仍吐了 tool call 时，上游会发起第二个模型请求且可能永远收不到终稿——
  补丁把这类调用整体剥离并追加一次 fallback 提示，正常收尾；
- steering 被 `UserPromptSubmit` 插件钩子拒绝后的「优雅停机」seam：
  直接 `agent_end` 而不是报一个假失败 turn；
- 工具钩子可显式终止整个 agent。

这三条的共同形态：**都是 opt-in 的新钩子，不传就保持上游行为**——
这就是 vendor 上游时正确的补丁姿势（可 rebase、可 upstream）。

### 1.4 执行事实保真

Bash 的 stdout/stderr 分流、Read 的原始页码与截断标记，
在 pi 上游被「模型友好的装饰文本」糊掉了，下游无法重建——
补丁把原始事实保留进 result details。
（这正是 dsh「immutable, lossless-JSON outcome」原则的临床病例。）

## 二、企业外壳：pi 缺失的商业补件清单

对照 pi 「什么都不内置」的清单，看 MiniMax 补了什么：

| pi 明说没有 | MiniMax Code 的补法 |
|---|---|
| 权限系统 | 四档权限：**Ask**（逐次问）/ **Auto**（云端 Anthropic 安全分类器自动判风险，挂了回退本地规则+人工）/ **Full access** / **Off**（headless 专用），`Alt+M` 切换；外加 `sandbox-runtime` fork 提供 OS 级沙箱（独立 unlink scope、deny-first 网络、净化 baseEnv） |
| 账号/计费 | OAuth Core + Token Plan 订阅（5 小时窗口 + 每周额度）；**BYOK** 免登录，兼容 openai-completions/openai-responses/anthropic-messages 三种 API 格式 |
| 多媒体/搜索 | `mcode-tools` 媒体生成工具，用本地 **lease broker** 给子进程发短时令牌（`oauth-lease-protocol`），密钥不落地 |
| 长任务 | **Goals**（跨多 turn 目标 + token 预算）、cron 定时、`/btw` 支线问答（主任务跑着也能插话）、`task_output` 后台任务 |
| 分发形态 | TUI + headless `mcode exec`（CI 友好）+ `mcode acp`（ACP 协议接 Zed 等编辑器）+ 闭源桌面 App |
| 生态 | 插件市场（`/plugins`）、Skills 兼容 `.claude/skills` 目录习惯、MCP、云端 managed connectors |
| 隐私合规 | usage/metrics/diagnostics **三路遥测默认全关、分开 opt-in**；`DO_NOT_TRACK` 一键全灭；诊断上传前 allowlist 最小化+加密 |

瞩目细节是 **Auto 档权限用云端分类器**：risk 判断变成一个 LLM 调用
（Claude 安全分类器），网络失败时降级为本地规则 + 人工——
「用模型管模型」在权限域的落地，比 codex 的纯本地规则更激进，
也引出他们必须修的那条 refusal 补丁（1.1 节），环环相扣。

## 三、工程组织：内部 monorepo 的「公开投影」

仓库 AGENTS.md 开篇就坦白：这不是普通开源项目，是
**内部 monorepo 经评审后的公开投影**（reviewed public projection）：

- `release/public-source.json` 显式列出每一个允许公开的文件，
  `pnpm check:source` 校验清单、内部地址、退役模块、明显凭据；
- 上游同步走**三路合并**（`docs/source-sync.md`），移动/改名文件
  会在下次同步时变成冲突——所以「prefer changing content over
  changing layout」；
- 私有包保留 `@mavis/*` 命名（内部运行时代号），源码直接在仓内
  解析但不独立发布。

这是「大厂如何开源商业产品」的完整流程范本：
**安全边界靠清单机器校验，不靠人肉记住哪些文件能发**。
（对照 dsh 的内置 `install-lock` 供应链加固、codex 的 Bazel 构建，
三家各有一种「严肃工程」的形态。）

## 四、runtime 分层与执行细节

官方架构文档给出一条边界线：

```text
TUI / exec / ACP  →  CliService  →  local Applications
  →  Session / Turn / Agent services  →  Pi / model providers / local tools
```

三个入口（交互 TUI、headless exec、ACP server）共享同一套 local
runtime；`local-runtime-v2` 是当前产品主干，v1 只读历史会话文件。
几个值得记的 Boutique 设计：

- **模型请求超时双保险**：首响应（含 header）300 秒、流式静默 300 秒
  可重试；一旦已有可见输出则 turn 直接失败不重试（理由：部分输出
  已进历史，重试会打乱单调性）；总上限 20 分钟；
- **前后台 Bash 一体**：有原生 `task_output` 时前台 Bash 60 秒自动转
  后台任务返回 task id，总时限 600 秒；没有则纯前台、120 秒默认；
- **停止语义**：Esc 显式停 = 级联取消本会话的后台任务和子 agent；
  `/clear` 或切换会话 = 只停当前 turn、**后台任务继续跑**（goal 和
  排队指令暂停）——「用户走了」和「用户叫停了」是两种语义；
- **skill 目录符号链接**：`.agents/skills` / `.claude/skills` /
  `.minimax/skills` 三个根都支持软链，兼容 Claude Code 用户已有资产。

## 五、四方对比收官（面试总表）

| 维度 | pi | dsh | codex | MiniMax Code |
|---|---|---|---|---|
| 定位 | 极简底座 | 元框架 | 工程纵深 | **商业化产品（vendor pi）** |
| agent loop | 自研 949 行 | 可替换插件 | Rust 采样循环 | **pi 的（+补丁台账）** |
| 权限/安全 | 无 | 审批 waterfall 可换 | 三层本地纵深 | 云端分类器 + 本地回退 + OS 沙箱 |
| 商业模式 | 无（个人项目） | 全家桶产品 | 订阅 + API | Token Plan 订阅 + BYOK |
| 扩展开源策略 | 全量开源 | 全量开源 | 全量开源 | 内部仓的评审后公开投影 |
| 会计/计费 | 无 | 无 | 云端 | 订阅 quota + 遥测三路 opt-in |
| 模型策略 | 任何 provider | 任何 provider | OpenAI 为主 | MiniMax M2 主推，通用兼容 |

而 M2 模型侧补一刀：230B 总参 / **10B 激活** MoE 专为 agentic
设计——「激活少 = agent loop 每一步便宜 = 同预算跑更多并发 agent」，
产品（mcode）与模型（M2）在单位经济上互相咬合；
使用约束是 **interleaved thinking 的 `<think>` 段必须原样回传**，
否则性能下降，这是 M2 在 agentic 场景最易踩的坑。

## 六、▶ 面试挂钩

**问题 1：如果老板说「我们也要做一个 Claude Code」，技术路线怎么选？**
「四条现实路线：自研极简底座（pi 路线，快但什么都得自己补）；
用元框架（dsh 路线，灵活但团队要先吃透框架）；
fork/vendor 现成开源底座（MiniMax Code 路线：`third_party` 原样
vendor + 补丁台账 + 企业外壳，最快出产品，代价是要持续跟上游 rebase）；
或纯自研重基础设施（codex 路线，控制力最强，成本最高）。
我会学 MiniMax：vendor 一个 MIT 的极简底座、把补丁压到最少且全部
opt-in 可 upstream，把人力集中在账号、权限、生态这些真正差异化的地方。」

**问题 2：接多家模型 API 最大的工程挑战是什么？**
「协议层统一只是 20%，80% 是端点怪癖。MiniMax 的补丁台账就是证据：
`developer` role 在 Mistral/SiliconFlow/DashScope/Kimi 都要回退
`system`；Claude 的 safety refusal 是 HTTP 200 不是错误码，丢了
category 就会被当成可重试错误；空 `tools: []` 有后端直接 400。
所以要有一按 host 精确匹配的兼容层 + 每条怪癖一条留档的台账 +
离线 payload 回归测试。」

**问题 3：agent 权限系统有哪些实现路线？**
「三档教科书答案：codex 全本地（execpolicy 规则 + 审批 + 平台沙箱，
零网络依赖）；dsh 可插拔（审批只是 pre-execute 的 listener，
风控可换企业内部服务）；MiniMax Code 云端分类器（Auto 档把风险
判断变成一次安全分类模型的调用，挂了降级本地规则+人工）。
选型看三点：离线可用性、决策可解释性、误判成本往哪边倾斜。」

**问题 4：商业开源怎么做才不泄露内部资产？**
「学 minimax-code 的『公开投影』：内部 monorepo 不动，公开仓是
评审后的投影；`public-source.json` 显式文件清单 + CI 校验内部地址
和凭据；上游走三路合并同步；私有包保留内部命名空间但不单独发布。
核心原则：发布边界机器校验，不靠人肉记。」

**问题 5：怎么给 agent 工具定「成功」的语义？**
「MiniMax 改 Bash 的这条值得背：只有 exit code 0 是成功；信号、
取消、超时、部分输出作为结构化事实保留；大输出截断给首尾 + 完整
日志引用；转后台和超时预算是两回事。反面教材就是『退出码非零
但输出有用也当成功』——模型会把报错当作正常产出继续推理。」

## 七、延伸阅读

- 一手仓库：[MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code)；
  重点文件 `third_party/pi-mono/MINIMAX_CHANGES.md`（补丁台账）、
  `docs/architecture.md`（分层边界）、`docs/tui-capabilities.md`
  （Bash 语义/超时/停止语义细节）、`AGENTS.md`（公开投影流程）。
- 配套模型：[MiniMax-AI/MiniMax-M2](https://github.com/MiniMax-AI/MiniMax-M2)
  （10B 激活 MoE、interleaved thinking 约束）。
- 仓内三部曲：[Pi Agent 源码分析](./pi-agent源码分析.md)（被 vendor
  的底座）、[DeepSeek Harness 分析](./deepseek-harness分析.md)、
  [Codex 源码分析](./codex源码分析.md)。
- skills 目录兼容的由来：[AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)。
