# Hermes Agent 与 OpenClaw 生态专题：90k star 增长的拆账与「跨语言复现」争议

> **面向**：被问「你怎么看 Hermes Agent / OpenClaw 这类爆发式增长的
> 开源 agent」「跨语言重实现算不算抄袭」时的体系化弹药。
> **读完获得**：Hermes 的本质判断与三源证据链、六大子系统速写、
> v0.10→v0.14 三十日五版的三条主线、四个真创新点、Harness 四范式
> 分类学、开源伦理三层框架与答法。
> **口径声明**：本篇主体来自第三方研究
> [xiaonancs/hermes-agent-study](https://github.com/xiaonancs/hermes-agent-study)
> （基线 Hermes v0.9.0 2026-04-13，v0.14 升级补遗；32 章 / 97 图 /
> CC BY-SA 4.0），OpenClaw 侧仅达章节级定位
> （[xiaonancs/openclaw-study](https://github.com/xiaonancs/openclaw-study)，
> 27 章 / 2026-04 快照，待后续吸收）。**「架构抄袭」是 EvoMap 单方
> 技术对比报告的指控口径（2026-04-15 发布），本仓转述其证据并列出
> 事实要素，不采为终局结论**；star 数为报告采集时点读数。

---

## 一、为什么这一案值得进面试弹药

「大模型/Agent 岗」面试里高频出现一类元问题：**你怎么评估一个开源
项目的含金量与风险？** Hermes Agent（Nous Research 出品，Python，
口号 "The agent that grows with you"，报告采集时 90k star）是
2026 年最好的练习题，因为它一次踩中三点：

1. **增长解读**：30 天连发 5 个版本、~4,500 commits、约 73.5 万行
   新增——这种节奏怎么持续、质量怎么不崩；
2. **血统审计**：整体架构与 OpenClaw 大量可比、差异化卖点又卷入
   EvoMap 的架构级抄袭指控——「跨语言重实现」怎么界定；
3. **叙事审计**：「越用越强」的自进化承诺，工程上靠什么支撑、
   边界在哪。

## 二、本质判断与证据链（先把话说满再说边界）

研究报告的总判断一句话：**Hermes = OpenClaw 的 Python 重实现 +
EvoMap Evolver 的自进化概念嫁接。**三条证据：

**证据一：架构继承清单。** Gateway 网关模式、Tool Registry
自注册、SKILL.md 技能格式、AGENTS.md / SOUL.md / USER.md 启动
文件体系——这些核心设计与 OpenClaw（TypeScript，358k star）一致。

**证据二：内置迁移工具。** `hermes claw migrate` 一条命令把
OpenClaw 的人格、技能、记忆、频道配置乃至 API 密钥整套导入，
代码里有完整的 OpenClaw→Hermes 配置映射
（`openclaw_to_hermes.py`，约 2,794 行）。OpenClaw 的 240k+ 用户
是现成迁移池——产品层面认真考虑过「吃下前代用户」这条路径。

**证据三：EvoMap 的指控要点**（转述口径）：10 步主循环精确对齐、
12 组术语系统性替换、三层记忆结构对应、以及 Hermes 在 7 份公开
材料中对 Evolver **零引用**。

时间线把「继承」排得很清楚：

| 日期 | 事件 |
|---|---|
| 2025-07-22 | hermes-agent 建仓（**私有**） |
| 2025-11 | OpenClaw 开源发布 |
| 2026-02-01 | EvoMap Evolver 开源，GEP 协议公开 |
| 2026-02-25 | Hermes v0.1.0 首发公开 |
| 2026-04-15 | EvoMap 发布架构相似性分析，指控抄袭 |
| 2026-04→05 | v0.10→v0.14 三十日五版 |

**边界话术（面试的分界线）**：MIT 许可下复用架构并不违反许可证；
争议的实质是**引用缺失**——学术与社区规范层面的失信，而非法律
层面的侵权。把「许可证合规 / 学术伦理 / 品牌正当性」三层分开答，
比一句「抄袭了/没抄」高一个段位。

## 三、六大子系统速写（v0.9.0 基线）

| 子系统 | 实现锚点 | 要点 |
|---|---|---|
| Agent Loop | `run_agent.py` 11,487 行 AIAgent | 三种 API 模式：Chat Completions / Codex Responses / Anthropic Messages |
| Prompt System | `prompt_builder.py` | SOUL.md + MEMORY.md/USER.md + skills index + AGENTS.md 拼装；`_scan_context_content()` 检测 80+ 种注入威胁模式 |
| Tool System | `tools/registry.py` 自注册 | 模块级 register + AST 静态扫描发现；47 工具 / 19 工具集 |
| Session 持久化 | `hermes_state.py` | SQLite WAL 并发 + FTS5 全文搜索；压缩触发 session **分裂**（`parent_session_id` 链） |
| Memory | `memory_manager.py` | 三层：声明性（MEMORY.md/USER.md）、过程性（SKILL.md）、搜索性（FTS5）；8 个外部 Memory Provider 插件（Mem0/Hindsight 等）同时只能激活一个 |
| Gateway | `gateway/run.py` 9,798 行 | 18 个平台适配器标准化后路由到同一 AIAgent 实例 |

六条设计原则也好背：**prompt 稳定性**（系统提示对话中不变，保
Anthropic prompt caching）、可观察执行、可中断、平台无关核心
（一个 AIAgent 服务 CLI/Gateway/ACP/Batch/API 五入口）、松耦合
（`check_fn` 门控可选子系统）、Profile 隔离。

## 四、v0.10 → v0.14：三十日五版的三条主线

版本爆炸不等于失控——拆三条主线看：

**主线一：底座坚固化。** 最值得背的数字是 `run_agent.py`
**11,487 → 4,410 行（-61.6%）**：v0.11 的 Transport ABC 把三种
API 模式从巨型单文件里抽成 `agent/transports/` 下的独立类——
「单文件循环」到「调度层 + 可插拔传输」的重构教科书。外加
Ink TUI、Checkpoints v2、PyPI 发布、原生 Windows beta、两次冷启动
连削（v0.12 -57% / v0.14 -19s）。

**主线二：自治层。** Curator 后台 7 天周期审计维护技能库、Kanban
多 Profile 协作板、`/goal` `/subgoal`（Ralph 长目标循环）、
`/handoff` `/steer` 实时干预——定位从「对话式单 agent」演进到
「持续运行的多 agent 系统」。这是自进化叙事的工程兑付：
**自动固化（skill_manage）+ 定期审计（Curator）+ 显式治理
（/goal /steer）** 三件缺一不可。

**主线三：接入扩张。** Tool Gateway、Pluggable Provider/Platform、
OpenAI 兼容代理——最后这步让 Hermes 反过来变成「任意 OAuth →
任意 OpenAI 兼容客户端」的中继，产品定位二次翻转。

规模账（v0.9 → v0.14）：Python 文件 886→1,898、行数
411k→912k（+122%）、测试文件 577→1,266（测试与代码同步翻倍——
质量不崩的秘密就藏在这一行）、平台 18→22、可选 skill 子目录
14→82。

## 五、去争议后的四个真创新（别只会讲八卦）

1. **渐进式技能发现**：`skills_list()` 只返回名称+描述，agent 按
   `skill_view(name)` 拉全文——与本仓 Claude Code 专题的
   ToolSearchTool、codex 的 skill 目录是同一命题的三家实现；
2. **FTS5 替代向量库**：四理由——零外部依赖、个人会话场景关键词
   召回够用、检索结果确定（不受 embedding 模型漂移影响）、
   部署简（`$5 VPS` 叙事的技术前提）。与 context-mode 的 BM25
   路线互证，面试可合成「什么时候不用向量库」的完整答法；
3. **六种沙箱后端**：Local / Docker / SSH / Daytona / Modal /
   Singularity，后两个 serverless（空闲休眠、按需唤醒），说明
   「便宜长跑」是选型问题不是玄学；
4. **80+ 模式的 prompt 注入防御**：隐形 Unicode、HTML 隐藏注入、
   凭证钓鱼等——开源个人 agent 里防御密度少见的。

## 六、OpenClaw 渊源与 Harness 四范式

OpenClaw（TypeScript，358k star，Peter Steinberger 等维护）在
Hermes 报告里的对比口径：**Gateway 控制面 vs Hermes 的
ExecutionLoop**——OpenClaw 把「多平台接入、频道、技能市场」做成
控制面核心（对应其 27 章研究里 Gateway 控制面 / Context Engine /
Skill 体系与 ClawHub / Tools Canvas 的章节骨架）；Hermes 则把
重心放在执行循环与自进化。OpenClaw 本体的机制级深读已单独成篇：
[OpenClaw 源码机制专题](./openclaw源码机制专题.md)——Gateway
三类 role、MD-first 记忆、per-session 沙箱与四环纵深，吸收自其
27 章研究（2 个月 23,014 commits、1,200 PR 的量化基线）。

报告 Part III 给的分类学值得直接进弹药库——全网 Harness 四范式：

```text
Gateway       以多平台接入为核（OpenClaw 型）
ExecutionLoop 以对话执行循环为核（Hermes 型）
Orchestration 以多 agent 编排为核（工作流引擎型）
Enhancement   以增强既有工具为核（插件/外挂型）
```

被问「你的 agent 产品该用哪种架构」，先答范式再答实现，
层次立刻拉开。

## 七、开源伦理题：「AI 时代的代码洗稿」怎么答

三层框架（对应报告第 32 章的立法/伦理区分）：

1. **许可证层**：MIT 等宽松许可下，复用架构乃至代码都不违约——
   法律上站得住；
2. **社区规范层**：开源界的默契是「站在肩膀上要说声谢谢」——
   7 份公开材料零引用，在学术规范下等同失信，社区声誉有真实
   代价（fork 数据、贡献者同心圆都是公开可查的信任账本）；
3. **用户价值层**：项目好不好最终由工程质量说话——Hermes 的
   测试同步翻倍、重构纪律是真的，这提醒面试官视角：争议与
   工程质量是两个独立维度，可以分开评价。

一句话总结陈词：**开源世界的抄袭不写在许可证里，写在引用里。**

## 七·增、Hermes 本体机制补全：六设计原则与自进化数据流

> 本节补自同一份报告（[xiaonancs/hermes-agent-study](https://github.com/xiaonancs/hermes-agent-study)，
> 39 篇/32 章/97 张架构图，v0.9.0 基线 + v0.10→v0.14 升级专题）的
> **机制篇（Part I/II）**：本文原吸收的是它的生态/争议视角（Part III
> 与总纲调研），这批补上没写过的设计原则、自进化机制本体与规模账，
> 均按其 [verified] 读码口径转述，本仓未复核。

**六大设计原则**（一句一条，可直接引）：

1. **Prompt 稳定性**：系统提示词在对话中不变——除用户显式动作
   （如切换模型），无破坏缓存的变更；Anthropic Prompt Caching
   的有效性是**显式设计目标**，不是副产品；
2. **可观察执行**：每次工具调用可见（CLI 进度条 / Gateway 聊天
   推送），没有黑盒步骤；
3. **可中断性**：API 调用与工具执行都可中途取消；
4. **平台无关核心**：一个 AIAgent 服务全部入口，平台差异只存在
   于入口层（CLI / Gateway / ACP / Batch / API Server）；
5. **松耦合**：可选子系统（MCP、插件、Memory Provider、RL 环境）
   一律注册模式 + check_fn 门控，不硬依赖；
6. **Profile 隔离**：每个 Profile 独立 HERMES_HOME、配置、记忆、
   会话与 Gateway PID，可并发运行。

**自进化的机制本体**——Q1 说「skill 自动固化做可感知支撑」，固化
到底怎么发生：两相闭环，都走 `skill_manage` 工具——

```text
Phase 1 经验固化    复杂任务完成（5+ 次工具调用）
                    → 评估「值得记住？」
                    → skill_manage(create)：写 SKILL.md + 更新索引
Phase 2 持续进化    后续类似任务自动加载已有 skill
                    → 走完再评估「有没有更好方法？」
                    → skill_manage(patch) 原位更新
```

对照仓内 kernel-agent 篇的 RLCR 闭环：那边是 agent 产业线自己沉淀
kernel，这边是 runtime 把**用户任务的执行经验**固化成 skill——同一
思想（把踩过的坑变成起跑线），作用域不同。

**工具面与两条数据流**：47 个工具在 registry.py 自注册；
model_tools 以 **AST 静态扫描** tools/*.py 生成模型可见目录；执行期
handle_function_call 查注册表分发。CLI 流 = 输入 → PromptBuilder
（system prompt + skills 索引）→ RuntimeProvider 解析（api_mode /
key / base_url）→ 三种 Transport → 工具循环 → SessionDB 落盘；
Gateway 流 = 平台事件 → Adapter 标准化 MessageEvent → authorize
加 session key → 携历史建 AIAgent → Delivery 按平台转回格式。

**规模账（v0.9 → v0.14，报告口径）**：Python 文件 886 → 1,898
（+114%）、411k → 912k 行（+122%）、消息平台 18 → 22、可选 skill
子目录 14 → 82——三十日五版的另一面是**体量翻倍**；Q3 的 Transport
ABC 重构正是体量压力下的产物。

**一行档案（标题级，未读正文）**：同报告 Part III 对照组里还有两个
本文此前未提过的项目——OpenHarness（Python，9.9k star，「三种
Agent 哲学」之一）与 JiuwenClaw（Python，398 star）；另有
AutoResearch 研究工作流话题（其 Part I/II 章节，社区升温中）。

## 八、▶ 面试题

**Q1【高】Hermes 一个月涨几万 star，你怎么解读这种爆发？**
A：拆因子而非看总数——自进化叙事击中「越用越强」痛点（有
skill 自动固化做可感知支撑）；`hermes claw migrate` 把前代产品
240k 用户变成迁移池；六种沙箱后端支撑 `$5 VPS` 传播叙事；
Nous Research 的模型品牌背书；MIT + 零遥测踩中数据主权情绪。
每个因子单独都不新奇，组合起来才是增长引擎——评估开源项目
永远拆因子，别背总量。

**Q2【高】「跨语言架构复现」算不算抄袭？**
A：先切层再下判：许可证层面合法（MIT 不限制再实现）；学术与
社区规范层面，10 步主循环对齐 + 12 组术语替换 + 7 份材料零引用，
这在论文界就是 plagiarism 口径，声誉代价真实；用户层面看结果
质量独立评价。要补一句建设性：开源伦理的解法是引用与致谢
成本极低、收益极高——争议本身本可通过一行 CREDITS 避免。

**Q3【高】run_agent.py 从 11,487 行减到 4,410 行，他们做了什么？**
A：Transport ABC 抽离——把 Chat Completions / Codex /
Anthropic 三种 API 模式从巨型单文件拆成独立 Transport 类，主
循环瘦成调度层。这是「巨型单文件 agent」重构的标准答案：
先抽协议边界（传输层是天然接缝），测试同步翻倍护航。回答时
对照仓内 pi：pi 证明 949 行就够，Hermes 反向证明长错了要能
抽得回来——两个方向都懂才算读懂 agent loop。

**Q4【中】为什么用 SQLite FTS5 而不是向量库做记忆检索？**
A：四个理由：零外部依赖（个人助手定位）、会话场景关键词召回
够用、FTS5 结果确定性不随 embedding 模型漂移、部署契合
低配叙事。适用边界：跨语言语义改写、大规模多用户语料时关键词
匹配召回不足，才需要向量化——Hermes 留了 8 个外部 Memory
Provider 插件位（同时只能单活）作为逃生门。把「FTS5 vs 向量」
答成场景题而非优劣题。

**Q5【中】「agent 越用越强」的工程闭环怎么防失控？**
A：三件套缺一不可——自动固化（复杂任务后 skill_manage 创建/
patch SKILL.md）、定期审计（Curator 后台 7 天周期治理技能
库）、显式干预（/goal /subgoal 定向、/handoff /steer 实时
接管）。对照仓内记忆治理五板斧：只固化不审计会记忆污染，只
审计不干预会失控漂移。自进化的卖点永远要配上「谁看着它进化」。

**Q6【中】三十天发五个版本，质量怎么活下来的？**
A：结构信号——测试文件与代码同步翻倍（577→1,266）、重构以
抽象边界为单位（Transport ABC）连续多版推进、公开 roadmap 与
升级补遗文档化。反面教材视角：把发布节奏当 KPI 而测试与文档
不跟上的团队，30 天 5 版就是 5 次事故窗口。答题给出「节奏、
护栏、文档」三角。

**Q7【低】四种 Harness 范式，你的产品选哪种？**
A：按主要入口负转载入——多平台消息接入为核选 Gateway（模型
需要长期挂在线，会话路由是心脏）；单端深度任务选
ExecutionLoop（循环质量决定体验）；多 agent 协作是需求本体选
Orchestration；「让已有最牛工具体感升级」选 Enhancement。真
实产品常是 Gateway 外壳 + ExecutionLoop 内核（Hermes 即此
复合体）。

**Q8【低】如果老板要你「参考」竞品做个开源产品，合规清单？**
A：四步——许可证审计（依赖与代码段的许可兼容性）；架构参考
与逐行复制的边界声明（前者自由，后者需遵守并保留版权声明）；
CREDITS/致谢文件写明血统（成本一行，避免整场声誉战）；对外
叙事避免「从零创造」的表述。工程合规做在前，比事后公关便宜
三个数量级。

**Q9【中高】Hermes 的「自进化」具体是什么机制，而不是营销词？**
A：两相 skill_manage 闭环——复杂任务（5+ 次工具调用）完成后评估
是否固化，值得记则 create 写 SKILL.md 进索引；后续类似任务自动
加载已有 skill，执行完再按效果原位 patch。关键细节是**触发阈值**：
5+ 工具调用才进入固化评估，避免把琐碎操作也固化为噪声。对照
RLCR（agent 产 kernel）与 Claude Code 的记忆提取：三者都是
「经验固化」，差别在固化物类型——skill 文本、kernel 代码、
事实记忆；被追问边界时补一句：skill 的自动 patch 同样有
reward hacking 风险，固化坏了的 skill 会自我强化，需要
人工索引抽查兜底。

## 九、串联阅读

- 源码四极与产品内幕：[Pi Agent 源码分析](./pi-agent源码分析.md)、
  [DeepSeek Harness 分析](./deepseek-harness分析.md)、
  [Codex 源码分析](./codex源码分析.md)、
  [Claude Code 源码机制专题](./claude-code源码机制专题.md)
- 横向对照（续命路线/编辑原语/沙箱拓扑）：[Coding Agent 架构横评专题](./coding-agent横评专题.md)
- FTS5/BM25 同路线邻案：[Coding Agent 会话记忆工程专题](./coding-agent会话记忆工程专题.md)
- 技能机制三案（渐进加载/目录预算）：[Agent Skills 详解](./agent-skills详解.md)
- 注入防御深水区：[Agent 安全与防护](./agent安全与防护.md)
- 记忆治理五板斧（Curator 审计的邻接答案）：[Agent 记忆评测与遗忘治理专题](./agent记忆评测与遗忘治理专题.md)
- Ralph 循环与多 agent 治理：[多 Agent 与评测](./多agent与评测.md)

---

## 十、口径与未核实说明

1. 「架构抄袭」为 EvoMap 单方技术对比报告（2026-04-15）的指控
   口径，本仓转述其证据要素，未复核逐行对照，亦不采为终局结论；
   Hermes 侧对指控的公开回应状态本批未采集。
2. Hermes 数字（90k star / 11,487 行 / -61.6% 等）为报告 2026-04
   至 2026-05 时点读数；项目 30 天 5 版节奏下数字快速漂移，
   引用带时点。
3. OpenClaw 机制细节（Gateway 控制面 / Context Engine / fork
   生态）已由 [openclaw源码机制专题](./openclaw源码机制专题.md)
   承接（2026-10-17 批次吸收 openclaw-study 27 章研究）；本篇保持
   生态/争议视角，两篇互为上下半场。
4. 报告系列为多模型流水线产出（依次经 Opus/GPT 互审），研究文本
   CC BY-SA 4.0；star 数与生态数据均为采集时点快照。
5. §七·增 的机制细节（六原则、skill_manage 两相闭环、AST 工具
   发现、两条数据流、v0.9→v0.14 规模账）来自同一报告的机制篇
   （Part I/II）[verified] 读码口径，本仓未复核；OpenHarness 与
   JiuwenClaw 仅标题级档案，AutoResearch 正文未读。
