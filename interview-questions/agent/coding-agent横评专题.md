# Coding Agent 架构横评专题：同一套 Agent Loop，六种工程哲学

> **面向谁**：已经能讲清单个 coding agent（Claude Code 或 Codex 任一）的内部
> 结构、准备「横评 / 选型 / 差异点」追问线的读者。单家深挖不在这里——
> Claude Code 的范式细节归 [learn-claude-code导读](./learn-claude-code导读.md) 与
> [ai编程与claudecode内幕](./ai编程与claudecode内幕.md)，Codex 源码级剖析归
> [codex源码分析](./codex源码分析.md)，本篇只做横评与差异点。
>
> **读完获得**：① star 实测金字塔倒挂的读法（文档仓反超源码仓）；② 上下文续命
> 三路线（模型原生 / harness 层 / 用户手工）的分层逻辑与成本账；③ 编辑原语
> 之争（apply-patch DSL / 文件 Edit / shell-first）与失败原子性；④ 写权限
> 三种收口拓扑（进程内沙箱 / 容器隔离 / 权限对话）的部署形态对应；⑤ 模型-产品
> 绑定光谱（Cursor / Devin / OpenHands Agent Canvas）；⑥ ACP 协议第二战场与
> MCP 的边界；⑦ SWE-bench Verified 被厂牌弃用换代的事实与水话；⑧ 10 条
> 面试题的完整答法。
>
> **时效口径 2026-10**：star 与治理归属为 **2026-10-12 gh api 实测**；benchmark
> 数字按官方发布页/博客口径括注年份；厂商自报值一律标「官方自报」；未核实项
> 集中在文末「口径与未核实说明」，正文不当事实引用。

## 〇、主线直觉

2024–2026 的 coding agent 大战已经收敛出同一套共识架构，**公式就是
harness = 工具 + 压缩 + 权限**，大家抄的是同一套 loop。真正的分化发生在三条轴上：**上下文
如何续命、写权限如何收口、模型与产品绑多深**。而到 2026 年，协议层（ACP）
开了第二战场，benchmark（SWE-bench Verified）则被厂商主流口径弃用换行——
面试里还在背 77.9 对 80.9 小数点的，已经落后两个版本。

<div class="diagram-embed">
<iframe src="assets/diagrams/coding-agent-compare.html" width="100%" height="830" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/coding-agent-compare.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、star 倒挂：热度金字塔怎么读

先上实测数字（**2026-10-12 gh api 实测**，口径为 stargazers 总数）：

| 仓库 | star（万） | 备注 |
|---|---|---|
| sst/opencode | 21.3（212,687） | 独立开源 coding agent 第一 |
| anthropics/claude-code | 15.0（150,181） | 以文档/issue 为主的发布仓，非完整源码 |
| openai/codex | 12.9（128,653） | MIT 开源，Rust workspace |
| OpenHands/OpenHands | 9.1（90,588） | 原 All-Hands-AI，现 Agent Canvas 品牌 |
| shareAI-lab/learn-claude-code | 7.8（78,362） | 教程仓，佐证范式热度 |
| block/goose → aaif-goose | 5.5（55,161） | Rust，MCP-native，AAIF 托管 |
| Aider-AI/aider | 4.9（49,474） | 与旧路径 paul-gauthier/aider 实测同数 |
| agentclientprotocol/agent-client-protocol | 0.44（4,413） | ACP 稳定线 v1（参照系） |

**倒挂：闭源产品的文档仓反而登顶，完整源码仓反居其后。** anthropics/claude-code
以文档和 issue 为主的发布仓拿到 15 万 star，高于 MIT 协议完整开源的 openai/codex
（12.9 万）与 OpenHands（9.1 万）；最大的独立开源 agent 是 sst/opencode（21.3 万）。
教程仓 learn-claude-code（7.8 万）比 goose、aider 两个真产品还高，是范式热度的
旁证。**读法：开发者用脚投票的权重是产品受关注度，不是源码可读性。** 面试被
问「谁家最强」时，先分清 star 量的是声量不是能力——能力问题必须回到 benchmark
口径与工程结构上去答。

治理侧三个易错归属（2026-10 口径，详见文末勘误）：

1. **goose 已转入 AAIF 托管**：README 治理链接指向 aaif-goose/goose，即
   Linux Foundation 旗下 Agentic AI Foundation。「Block 的产品」叙事已过时。
2. **All-Hands-AI 已更名 OpenHands**：主仓 README 已整体改写为 Agent Canvas
   品牌；引用时写 OpenHands 新 org。
3. **ACP 仓已迁 agentclientprotocol org**：zed-industries/agent-client-protocol
   旧地址仍重定向，写作应给新 org 名。

## 二、上下文续命三路线：位置决定经济账

长任务是 coding agent 区别于聊天机器人的本质场景，上下文怎么办，2025–2026
分化出三条路线，分化点是**续命机制放在栈的哪一层**。

### 2.1 模型原生：Codex-Max 把 compaction 训进模型

GPT-5.1-Codex-Max 官方自述是「第一个原生训练以跨多 context window 工作的
模型」，compaction 内建在模型里（**OpenAI 官方博客，2025-11**）。官方称跨窗口
可连贯工作数百万 token、内部观测单任务连续工作**超过 24 小时（官方自报口径）**；
同 effort 档下比前代少用 **30% 的 thinking tokens（官方自报）**。harness 只负责
触发，续命质量归训练——这是 2025-11 之后最重要的结构变化：harness 层的
压缩技巧第一次有了训练层竞品。

### 2.2 harness 层：Claude Code 的 auto-compact + checkpoints

Claude Code 的续命三件套仍是 harness 工程：auto-compact（触顶自动压缩）、
checkpoints（用户可回滚的快照，**随 Sonnet 4.5 于 2025-09 发布的官方公告**）、
memory tool。叠加 2026 年 Claude 全系 **1M token 上下文窗口（docs.claude.com，
2026-10-12 抓取）** 之后，压缩压力从「能不能塞下」变成**成本与注意力稀释**的
经济账：窗口大十倍不代表应该塞十倍。

### 2.3 用户手工：aider 的 repo-map 与 goose 的会话摘要

aider 不做自动压缩，用 repo-map（仓库结构地图）加用户手控 /drop 精确管理
上下文；goose 用 MCP extension 加会话摘要。这是最便宜的路线，也是缓存最友好
的路线——手工增删不打断前缀。

### 2.4 工程含义：续命位置决定缓存命中率与可审计性

把三路线并排，追问自然出现：

- **模型原生**：质量上限最高，但 compaction 后 prompt cache 全线失效的成本
  归谁付？harness 完全不可审计压缩内容。
- **harness 层**：可审计、可回滚（checkpoints），但摘要插回 KV 的位置直接
  决定前缀缓存是否断裂。
- **用户手工**：缓存最友好、完全可审计，上限受用户体力约束。

**面试金句：续命机制的位置（模型内 / harness / 用户）是 2026 年 coding agent
选型第一张表。** 详见 [记忆与上下文工程](./记忆与上下文工程.md) 的通用框架，
本篇只补「compaction 下渗到训练层」这个 2025-11 后的新事实。

## 三、编辑原语之争：补丁怎么写，决定失败怎么收场

模型改代码有三种「写」法，各家站队分明：

- **apply-patch DSL（Codex）**：自研补丁格式（V4A），专有 parser crate 解析，
  模型输出结构化补丁再由 harness 落盘。
- **文件级 Edit 工具（Claude Code）**：old/new 字符串替换的工具调用，配
  diff 渲染给用户确认。
- **shell-first（OpenHands / goose）**：编辑就是 shell 命令（sed、cat 覆盖、
  python 脚本），是普通工具调用的一种，天然被沙箱覆盖。

**核心差异是失败原子性**：apply-patch 解析失败是原子拒绝，文件没动；文件
Edit 的 old 串不匹配是原子报错；而 shell sed 写一半失败就是**部分污染**，
回滚语义要靠 checkpoint / worktree 兜底。aider 的 polyglot 榜单把这个维度
第一次量化了：模型成绩与 edit format 合规率分列——gpt-5(high) 的
**成绩 88.0% 但 diff 格式合规率 91.6%，单次成本约 29.08 美元（aider.chat
官方榜单，2026-10-12 抓取）**；architect 模式合规率 100%。也就是说**小模型不是
不会解题，是不会输出补丁格式**——弱模型配 harness 时，编辑原语的容错阶梯
（先 diff，不行降级 architect，再不行整文件重写）是实打实的分数来源。

## 四、写权限三种收口：沙箱拓扑决定部署形态

agent 拿到写权限怎么办，三家给了三种拓扑，对应三种部署形态：

### 4.1 进程内沙箱：Codex 的三层纵深（唯一官方成文）

Codex 是各家唯一把安全模型完整成文的，默认 **workspace-write 模式**（workspace 内
可写、其余只读）× **网络默认关闭**（显式配置 network_access=true 才开，官方
security 文档原文提示「开网 = 引入 prompt-injection 面」）× 审批策略 × 平台
实现（macOS Seatbelt / Linux Landlock+seccomp / Windows AppContainer）。官方
自述的两个漏点要记，第一是 **CI 容器内 Landlock 可能不可用而退化为
danger-full-access**，第二是 **Windows 无法阻止 Everyone SID 可写目录的
删改**。2025-11 后官方口径换成
Read Only / Agent / Full Access 预设名。这是面试「agent 安全」题最稳的官方
证据链，源码级展开见 [codex源码分析](./codex源码分析.md)。

### 4.2 容器隔离：OpenHands 的 Docker runtime 兜底

OpenHands 把隔离外包给容器：agent 跑在 Docker runtime 里，README 自己警告
「不带沙箱模式 = agent 对文件系统全权访问」（**README 原文，2026-10-12 抓取**）。
哲学是进程内不做策略，边界就是容器边界。

### 4.3 权限对话：Claude Code 的 plan mode 与 hooks

Claude Code 默认信任用户主机，隔离靠权限分级对话 + hooks 拦截 + plan mode
（**2025-11 升级为可编辑的 plan.md 文件，Opus 4.5 发布公告**），需要强隔离时
靠外部容器。金句：**进程内沙箱对应 CI 嵌入、容器隔离对应批量任务、权限对话
对应人机协作**——不是优劣排序，是部署形态三连选。

## 五、模型-产品绑定光谱：从自研模型到可插拔

把六家按「模型与产品绑多深」排成光谱，五个位置：

1. **深度自研模型端：Cursor**。2025-10 发布 Composer 模型 + Cursor 2.0 多
   agent 界面（git worktree 并行，官方称多模型解同题后择优显著提升输出）。
   官方口径为**同智能档 4 倍快、多数 turn 在 30 秒内（Cursor 官方博客，
   2025-10）**，但**无公开 SWE-bench Verified 分数**——2026 年 CursorBench 4.0
   出现在 Anthropic Opus 5.5 官方对比图里，说明 Cursor 开始自建裁判席。
2. **远端同事形态：Devin**。自始就是 shell+editor+browser 沙箱里独立工作、
   完成数千步决策的形态（Cognition 官方博客，2024）。它不是 IDE 插件，是
   「招了一个远端同事」的产品假设。
3. **模型产品一体：Claude Code / Codex**。模型厂自产 harness，绑定最深但
   也最透明（Codex MIT 开源、Claude Code 仓以文档为主），是横评的中间锚。
4. **绑定叠加态：aider**。纯终端、模型无绑定（15+ provider），光谱最左的
   另一面旗帜：产品完全不押注任何一家模型。
5. **编排层中立：OpenHands Agent Canvas 与 goose**。前者 README 明示支持
   运行 Claude Code、Codex、Gemini、Pi、OpenCode 或任何 ACP-compatible
   agent（2026 重写版 README）；后者 AAIF 托管、70+ MCP extension、支持 ACP。
   **竞争点从 agent 能力本身转移到控制面**——agent 变成可替换部件。

**pi 已被 OpenHands Agent Canvas 列为官方支持的第三方 agent**——极简派也进了
可插拔名单，佐证光谱右端的判断（pi 的 949 行极简循环见
[pi-agent源码分析](./pi-agent源码分析.md)）。

## 六、协议第二战场：MCP 还是 ACP

MCP 管 agent 与工具之间，ACP（Agent Client Protocol）管编辑器与 agent 之间——
**ACP 官网自我定位是「编辑器↔agent，类比 LSP 之于语言服务器」**。要点清单：

- **发起方是 Zed**：JSON-RPC over stdio/HTTP，仓库已迁至 agentclientprotocol
  org，**稳定线协议版本 v1**；Zed 官方做了 claude-code-acp（star 2,638）与
  codex-acp（star 871）两个桥（**2026-10-12 实测**）。
- **ACP 复用 MCP 的 JSON 表示**，但自研 agentic UX 类型（如 diff 展示、
  plan 展示）——两者不是替代关系，是交互侧与工具侧的分层。
- **生态信号**：Agent Canvas 的 README 把「any ACP-compatible agent」写成
  卖点，意味着编辑器/控制面正在平台化，agent 在协议层面被部件化。
- **反方观点**（面试要会给）：协议稳定线才到 v1，会话状态（断点续传、
  checkpoint 回放）这类深能力很难标准化；ACP 适合的只是「编辑器里嵌 agent
  终端」这一层，深度集成仍要私有协议。

Zed 为什么推 ACP？Zed 作为编辑器没有自有模型也没有订阅收入，**把 agent 变可
插拔部件，是把竞争挤到自己不占位的层面**——这是平台博弈的标准手法，和当年
VS Code 推 LSP 同理。MCP 协议纵向细节见
[mcp与工具调用深度对比](./mcp与工具调用深度对比.md)，本篇只引入 ACP 这个
新维度与之并置。

## 七、Benchmark 换代：Verified 的三行墙注

到 2026 年，SWE-bench Verified 已被厂商主流口径弃用。能核实的时间线：

| 年份 | 分数锚 | 口径 |
|---|---|---|
| 2024-03 | Devin 13.86% | Cognition 官方博客；**全量 SWE-bench 的 25% 随机抽样子集**，前 SoTA 1.96% |
| 2025-11 | GPT-5.1-Codex(high) 73.7% / Codex-Max(xhigh) 77.9% | OpenAI 官方博客附录，Verified，n=500 |
| 2026 | Anthropic Opus 5.5 发布 | 主图换成 Terminal-Bench 4.0（Opus 5.5 66.4% / GPT-6 Astra 57.9%）、CursorBench 4.0、FrontierCode v1.1（Opus 5.5 54.4%），Verified 不再出现在头部表格（Anthropic 发布页） |

**引用任何 Verified 分数必须带三行墙注**：① n=500 且部分提交未复验；②
assisted vs unassisted 口径（Devin 2024 是 25% 随机子集、官方脚注明确与其余
assisted 跑法不可比）；③ 2026 后头部厂商已换基准。**面试已不值得背 80.9 对
77.9 的小数点，值得讲的是基准饱和后大家往哪换**——往端到端终端任务
（Terminal-Bench）、往厂商自建评测（CursorBench）、往更难前沿集（FrontierCode）
三个方向换。

## 八、工程议题（面试可深挖）

1. **Compaction 的位置之争**：模型原生 compaction 会不会吃掉 prompt cache
   经济性？harness compaction 的摘要插回 KV 的哪个位置最不伤前缀？
2. **编辑原语三选一**：apply-patch DSL / 文件 Edit / shell 命令，各自的失败
   原子性、回滚语义、对弱模型的容错阶梯设计。
3. **沙箱拓扑选型**：进程内能做到 network off 与只读挂载，但 CI 容器里
   Landlock 常常不可用（官方承认可能退化 danger-full-access）——部署矩阵
   怎么画。
4. **MCP vs ACP 的边界**：复用 JSON 表示但 UX 类型分立，长期共存还是 ACP
   吃掉 MCP 的交互侧？
5. **多 agent 并行的工作区隔离**：Cursor 用 git worktree、Codex cloud 用远端
   环境；坑在依赖安装、端口冲突与 review 面膨胀——官方原话「两个新瓶颈是
   review 代码与测试变更」（OpenAI 官方博客，2025-11）。
6. **Planner 显形还是隐形**：plan.md（Claude Code）vs 隐式 loop（aider）vs
   远端计划汇报（Devin）——显式 plan 的价值在可编辑中断点，成本在
   plan-execute 漂移。

## 九、案例与数字锚

- **star 金字塔倒挂（2026-10-12 gh api 实测）**：sst/opencode 212,687、
  anthropics/claude-code 150,181（文档仓）、openai/codex 128,653（MIT 全源码）、
  OpenHands 90,588、goose 55,161、aider 49,474；参照：zed 91,580、cline 70,171、
  learn-claude-code 78,362、ACP 三仓 4,413 / 2,638 / 871。
- **Codex-Max 自报三数（OpenAI 官方博客，2025-11，官方自报口径）**：单任务
  连续工作超 24 小时；OpenAI 工程师周使用率 95%；PR 产出提升约 70%；同 effort
  少用 30% thinking tokens。
- **aider 榜单双列（aider.chat 官方榜单，2026-10-12 抓取）**：gpt-5(high)
  成绩 88.0%、单次成本 29.08 美元、diff 格式合规率 91.6%；architect 模式
  合规率 100%。
- **Claude 定价区间（Anthropic docs，2026-10-12 抓取）**：家族 input 单价
  0.10–0.50 美元/M token 起（Haiku 5.5 起），1M token 上下文全系可用。
- **Devin 13.86%（Cognition 官方博客，2024-03）**：全量 SWE-bench 的 25%
  随机抽样子集，前 SoTA 1.96%；口径与后续 Verified 跑法不可比。
- **Opus 5.5 官方口径（Anthropic 发布页，2026）**：Terminal-Bench 4.0 得分
  66.4% 对比 GPT-6 Astra 57.9%；FrontierCode v1.1 得分 54.4%；主图不再放
  Verified。官方另有两则能力案例——「680,000 行代码迁移一天完成」「9.5 小时
  把 HAProxy 从 C 重写成 Rust」——**引用时必须注明是厂商自报**。

## 十、▶ 面试题

**Q1（高频）：为什么 Claude Code 成了各家抄的模板？**

期望答到：不是工具集本身，而是五件套范式——Grep/Glob 检索哲学、CLAUDE.md
分层、subagent 隔离、Skills 渐进披露、Hooks——且 2025-09 Anthropic 直接把这层
抽象成 Claude Agent SDK 官方出售。深度提示：「造 agent = 训模型或造 harness」
的二分止于口号，要落到 harness 公式：工具 + 知识 + 观察 + 动作接口 + 权限。
学习路径见 [learn-claude-code导读](./learn-claude-code导读.md)。

**Q2（高频）：Codex 的三层安全纵深各自能挡什么、漏什么？**

期望答到：workspace-write 挡误写、网络默认关断挡 exfiltrate、审批挡越界；
漏点是容器内 Landlock 失效可能退化 danger-full-access、Windows Everyone SID
可写目录（均为官方自述）、YOLO flag 被复制进 CI 脚本。深度提示：把「开网 =
引入 prompt-injection 面」这句官方原文背下来，是全场最有分量的一个引证。

**Q3（高频）：SWE-bench Verified 的 77.9% 和 80.9% 谁强？**

期望答到：先拆口径——harness 不同、effort 档位不同、n=500、assisted 与否；
再点出 2026 已换基准（Terminal-Bench 4.0 / CursorBench / FrontierCode），分数差
的实际信号是模型代际而非 harness。深度提示：Devin 2024 的 13.86% 是 25% 抽样
子集口径，官方脚注明确与其他跑法不可比——能主动拆这个例子说明你真看过墙注。

**Q4（中频）：给你一个 20 万行代码库的迁移任务，怎么选 agent 和 harness
配置？**

期望答到：先拆任务形态——批量同构改动倾向 aider 或脚本化 codex exec；长程
探索倾向 Claude Code 的 checkpoints 或 Codex-Max 的原生 compaction。再讲
上下文策略：repo-map/检索哲学 vs 1M 窗口的注意力稀释。最后落到验证闭环：
测试即 reward，回滚用 checkpoint/worktree 而不是相信模型的 git reset。
引用 Opus 5.5 的「68 万行迁移一天完成」案例时注明厂商自报。

**Q5（中频）：ACP 和 MCP 会打架吗？Zed 为什么要推 ACP？**

期望答到：MCP 是 agent↔工具、ACP 是编辑器↔agent，类比 LSP（ACP 官网
自我介绍原话）；Zed 无自有模型与订阅收入，推协议是把竞争挤到自己不占位的
层面。深度提示：会给反方观点——ACP 稳定线才 v1，断点续传与 checkpoint 回放
难标准化，它只覆盖「编辑器里嵌 agent 终端」这一层。

**Q6（中频）：compaction 放在模型里和放在 harness 里，工程上差在哪？**

期望答到：质量上限 vs 可审计性的取舍；compaction 后 prompt cache 全线失效的
成本账；harness 摘要插回 KV 的位置与前缀缓存断裂的关系。深度提示：能说出
「2025-11 后 harness 压缩第一次有了训练层竞品（Codex-Max）」即显示时效感。

**Q7（中频）：apply-patch、文件 Edit、shell 编辑三种原语怎么给弱模型选？**

期望答到：失败原子性排序（补丁原子拒绝 > Edit 原子报错 > shell 部分污染）；
aider 榜单的合规率单列证明弱模型瓶颈常在格式而非能力；容错阶梯设计（diff →
architect → 整文件重写）。深度提示：合规率 91.6% vs 成绩 88.0% 这组数说明
格式错会反过来吃分数。

**Q8（低频）：进程内沙箱 vs 容器隔离，CI 场景怎么选？**

期望答到：CI 容器内 Landlock 常常不可用，进程内沙箱可能退化——所以 CI 场景
反而是「容器套容器」或直接用 OpenHands 式的 Docker runtime 兜底更稳；交互场景
才是 Seatbelt/Landlock 的主场。深度提示：画部署矩阵（交互 / CI / 批量 × 三种
拓扑）比背特性表得分高。

**Q9（低频）：Cursor Composer 没有公开分数，怎么评估它？**

期望答到：官方只有速度与体验口径（4 倍快、30 秒内多数 turn，2025-10 官方
博客）；2026 年 CursorBench 4.0 出现在 Anthropic 对比图里，说明它自建裁判席；
评估无公开分数的产品，只能看可复现第三方评测与自身任务集实测。深度提示：
指出「无公开 Verified 分数」本身就是答案的一部分，不要编数字。

**Q10（低频）：coding agent 的协议生态两年后会是什么样？**

期望答到：agent 部件化（ACP）、工具标准化（MCP）、控制面平台化（Agent
Canvas、Zed），模型厂的差异化退回训练层（原生 compaction、自研模型如
Composer）；Skills 形态跨厂扩散（Codex 2026 也上线 skills 文档页）是佐证。
深度提示：能引用「Agent Canvas README 明示可运行任何 ACP-compatible agent」
说明你看的是 2026 口径不是 2024 OpenDevin 时代的旧叙事。

## 口径与未核实说明

以下素材为调研中标注「未核实单列」或实测勘误的内容，仅集中于此节，正文
一律未当事实引用：

1. **OpenHands 官方 Verified 分数未核实**：未能从 docs.openhands.dev / GitHub
   取到现行权威表格（旧版 README 曾出现 65.8% 等宣传数字，未复核）。现行
   口径只宜表述为「未在当前官方渠道报 Verified 分数，评测基建在
   OpenHands/benchmarks」，不要背历史数字。
2. **Claude 两家的小数点未逐字复核**：Opus 4.5 的 80.9%、Sonnet 4.5 的 77.2%
   全网流传极广，但官方发布页正文只给定性表述（「最高 effort 超 Sonnet 4.5
   最佳 4.3 个百分点」可引用），具体小数点藏在图表图片中。引用时写「官方
   口径约 78–81 分水位」或只用 +4.3pp 相对差值。
3. **Cursor Composer 无任何公开分数**：官方博客只有 4 倍快、30 秒/turn 与
   多模型择优定性表述，是否有内部自测未公开，正文保持「未公开」表述。
4. **Devin 2025 年后的分数未核实**：本次只核到 2024 年 13.86% 口径，社区
   转述的后续数字勿引用。
5. **各家 failure mode 无量化来源**：死循环率、回滚误删率均为社区定性反馈，
   只能以「社区反馈定性画像」形式出现，不得包装成数字。
6. **勘误：openhands-agent-hub 查无此物**——GitHub 实测 404（三个候选名
   均 Not Found，2026-10-12 gh api）。OpenHands 真正的官方生态是四件套：
   **Agent Canvas / software-agent-sdk / benchmarks / sandbox-server**，另有
   存档仓 legacy。
7. **勘误：ACP 仓已迁 org**——zed-industries/agent-client-protocol 已迁至
   agentclientprotocol/agent-client-protocol，旧地址重定向仍可解析，引用
   应给新 org 名。
8. **勘误：goose 已转 AAIF 托管**——README 治理链接指向 aaif-goose/goose
   （Linux Foundation 旗下 Agentic AI Foundation），「Block 的产品」叙事
   在 2026 年已过时；block/goose 旧路径仍可解析。
9. **勘误：All-Hands-AI 已更名 OpenHands**——org 更名后主仓 README 整体
   改写为 Agent Canvas 品牌（两次实测 star 微差即重定向前后），注意
   「OpenHands = Agent Canvas + SDK」的 2026 语境。

## 串联阅读

- [learn-claude-code导读](./learn-claude-code导读.md)：那篇管「17 节怎么学、
  怎么手写出 Claude Code 同构 harness」，本篇管「它的范式为什么成行业公模板」。
- [codex源码分析](./codex源码分析.md)：codex-rs crate 地图、run_turn、
  execpolicy 三层纵深的源码级剖析；本篇只引用其安全纵深结论做横评。
- [ai编程与claudecode内幕](./ai编程与claudecode内幕.md)：Claude Code 检索哲学
  /续命/纠偏的设计动机问答，本篇不抢单家内幕。
- [pi-agent源码分析](./pi-agent源码分析.md) 与
  [deepseek-harness分析](./deepseek-harness分析.md)：极简 949 行与一切皆插件的
  架构两极；pi 进 Agent Canvas 官方支持名单佐证「agent 可插拔」主线。
- [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)：MCP 协议纵向，本篇
  只把 ACP 新维度与之并置，协议本体不重复。
- [记忆与上下文工程](./记忆与上下文工程.md)：压缩/记忆的通用原理框架，本篇
  只补 compaction 下渗训练层的新事实。
- [agent-skills详解](./agent-skills详解.md)：Skills 机制全貌；本篇只记录
  Codex 2026 上线 skills 文档页这一跨厂扩散信号。
- [minimax-code分析](./minimax-code分析.md)：国产 coding agent 单家解析，
  国产横向对比留作后续专题切口。
- [hermes与openclaw生态专题](./hermes与openclaw生态专题.md)：Gateway vs
  ExecutionLoop 的范式分野与全网 Harness 四范式分类学——本篇负责
  四极横评，那篇补 OpenClaw/Hermes 这条「个人助手」支线的增长与
  伦理维度。
