# Coding Agent 会话记忆工程专题：context-mode / claude-mem / Hindsight 三案拆解

> **面向**：面试官追问「coding agent 跑半小时上下文就爆了，工具输出那么长怎么办？」「会话压缩之后 agent 忘了自己改到哪，怎么设计记忆？」时的体系化弹药。
> **读完获得**：代码 agent 侧上下文防护的第三条线认识；context-mode 98% 压缩的算账方式；claude-mem 观察-压缩-注入管线；Hindsight 四类仿生记忆与三操作；三案对照选择话术；「98%」「SOTA」等宣传数字的口径审计方法。
> **口径声明**：三案数字（98%、100x、LongMemEval SOTA 等）均来自各仓 README 或其引用基准站 2026-10 时点的**自报口径**，本仓未实测复现；Hindsight 星数增速本仓已有存疑先例（见末节），不引为社区成功证据。GitHub trending 月榜增量为 GitHub 官方口径，仅用于说明热度。

---

## 一、一句话定位：记忆的「第三条线」——会话防守

仓内已有两条记忆线，先对齐再补第三条：

```
线一：上下文内压缩      「记忆与上下文工程」
      截断/摘要/分层，在窗口里做减法 —— 防守点是 prompt 本身

线二：服务端记忆产品    「agent记忆产品化专题」
      mem0 / Zep / Letta / LangMem / Memobase
      抽象是「用户画像与事实库」——防守点是跨用户跨会话的长期事实

线三：会话侧防护工程    本篇（2026 GitHub trending 集中爆发）
      context-mode（29.9k star，月增 6.7k）
      claude-mem（101k star，月增 7.5k）
      Hindsight（50.1k star，月增 26.7k）
      抽象是「工具输出与会话事件不该白进窗」
      ——防守点是 coding agent 自己的一次工作会话
```

线三的三个判断先给：

1. **上下文是稀缺资源，磁盘不是**：原始工具输出默认不落窗，落 SQLite/FTS5/向量库，用时再检索回填。
2. **压缩发生在「进窗之前」而不是「爆窗之后」**：线一是事后压缩（compact），线三是事前拦截。
3. **可读性证据分层**：README 自报 → 基准自测 → 第三方复现，三案正好各占一档，面试里要能拆开讲。

---

## 二、为什么 2026 年这条线突然爆：问题本身的账

context-mode README 把问题算得很直白（自报口径）：

- 一次 Playwright 快照 56 KB，二十条 GitHub issue 59 KB，一条访问日志 45 KB。
- 半小时工具调用下来，约 40% 的上下文窗口被原始工具输出吃掉。
- 等窗口爆了再 compact，agent 又忘了：自己在改哪个文件、任务进行到哪、用户上一句要什么。
- 双头失血：输入侧被原始数据淹没，输出侧模型还在烧 token 写客套话和冗长解释。

三条线面对的就是这同一个伤口，但下刀位置完全不同——这就是本篇的骨架。

---

## 三、context-mode：「上下文模式」四件套

仓库：`mksglu/context-mode`，插件形态，官方口径支持 17 个平台（Claude Code / Gemini CLI / Copilot 系 / Cursor / pi / dsh / OpenClaw 等）。

### 3.1 第一刀：sandbox 工具，原始数据不进窗

机制：给模型一套 sandbox 工具替代表——`ctx_batch_execute` / `ctx_execute` / `ctx_execute_file` / `ctx_index` / `ctx_search` / `ctx_fetch_and_index` 六个，加 `ctx_stats` / `ctx_doctor` / `ctx_upgrade` / `ctx_purge` / `ctx_insight` 五个 meta。工具产生的原始输出写进本地库，窗口里只留检索入口与结果摘要。

自报账（README 口径）：

```
不进 sandbox 的常态：原始工具输出直接进窗     315 KB
进 sandbox 之后：  摘要 + 可检索句柄进窗        5.4 KB
压缩比宣布为 98%（= 1 - 5.4/315 ≈ 98.3%）
```

面试追问「这个 98% 怎么来的」，正确拆法：

- 分子分母都是**客户端测量**：`ctx_stats` 按工具给出 per-tool 的 tokens 消耗与节省比，不是端到端任务成功率指标。
- 它是「上下文节省率」，不是「任务质量不降」的证明；任务质量的证据要另外找基准。
- 场景依赖极强：grep 全文、读大文件、抓网页这类**输出远大于输入**的工具收益最大；小规模工具调用收益趋零。

### 3.2 第二刀：会话连续性 = 事件溯源 + FTS5，不回灌

管线：

```
working 阶段：每次文件编辑/git 操作/任务/报错/用户决定
              → hook 拦截 → 追加进 SQLite 事件表（agent 无感）

PreCompact 触发：不把事件表 dump 回上下文
              → 事件索引进 FTS5

新会话开始：  SessionStart hook 注入「路由块」
              → 模型用 ctx_search 按 BM25 按需取回
              → 只取相关，不取全部
```

两个可追问的设计细节：

1. **为什么不回灌**：compact 的本质就是把窗口腾空，再把历史摘要倒回去等于又灌满——所以只倒「索引能力」，不倒「内容」。这正对应仓内 `harness工程实战` 的事件溯源思想：事件全留在外存，回放按需。
2. **新会话默认清账**：不显式 `--continue` 的话上一会话数据立即删除——「新会话=干净白板」是默认语义，延续是显式授权。隐私诉求在后面第七节再展开。

### 3.3 第三刀：Think in Code——LLM 是代码生成器，不是数据处理器

README 给的对比例子（自报口径）：

```
改造前：47 × Read() 把文件全读进窗来数函数     ≈ 700 KB 上下文
改造后：1 × ctx_execute("javascript", ...)      ≈ 3.6 KB 上下文
        const files = fs.readdirSync('src').filter(f => f.endsWith('.ts'));
        files.forEach(f => console.log(f + ': ' +
          fs.readFileSync('src/'+f,'utf8').split('\n').length + ' lines'));
节省号称 100 倍 —— 一次脚本调用替代十次工具调用
```

话术内核：需要「在大量原始数据上算一个结论」的任务，让模型**写脚本**算出结论，只把结论 `console.log` 回窗口；不要把数据搬进窗口让模型肉算。这是 MCP 工具设计里「返回结果 vs 返回数据」之争的一次工程落地。

### 3.4 第四刀是「不动刀」：明确不做 prose-style enforcement

context-mode 声明只管数据去哪、不管模型怎么说话——理由是 Moonshot AI 对 kimi-k2.5 的自报实验：激进的 brevity prompt（强制极简输出）会**拉低** coding/reasoning 基准。管道块只写路由指令，刻意不写「请简洁回答」。

面试价值：这条是反直觉设计——大多数团队的第一反应是把「省 token」翻译成「教模型少说话」，该仓把这条坑直接写进 README 当反面教材。文风控制应该交给项目自己的 CLAUDE.md/AGENTS.md，不应该是底层基础设施的职责。

### 3.5 底座：hook 六件套 + fail-open

- hook 面：`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `PreCompact` / `SessionStart` / `Stop`，与仓内 `learn-claude-code导读` 的 s04 hooks 一一对应。
- 适配器：hook 能力强的平台自动路由（SessionStart 注入路由块，不落盘任何项目文件）；无 hook 平台降级为「一次性拷贝路由文件」。
- `PreToolUse` 的 matcher 只挂在**输出可能很大**的工具上（`run_shell_command` / `read_file` / `web_fetch` / 各类 grep 等），轻量工具不走 hook，省拦截开销。
- **fail-open**：hook 挂了不阻塞工具调用（例如本机 context-mode 版本过旧时 hook 静默失效），可用性优先于拦截完整性——生产 hook 系统该有的默认姿势。

---

## 四、claude-mem：观察-压缩-注入三段式

仓库：`thedotmack/claude-mem`（README 写明同时覆盖 OpenClaw / Codex / Gemini / Hermes / Copilot / OpenCode / pi / dsh / Cursor 等），2026-10 时点 10 万 star 量级。

### 4.1 数据管线

```
会话中：hook 捕获 tool usage observations（工具调用的观察记录）
        → 交给常驻 worker runtime

后台：  worker 用 AI 模型把 observations 压缩成语义摘要
        → 落 SQLite（FTS5）+ Chroma 向量库双索引

下次会话：新 session 启动 → 检索相关摘要 → 注入上下文开头
        → agent 带着「上一轮项目记忆」继续干活
```

### 4.2 三个可追问机制

1. **Progressive disclosure**：摘要按层级展开，检索时先看粗摘要、需要细节再往下钻，且每层的 token 成本对调用方可见——「先目录后正文」的信息架构落到记忆检索上。
2. **混合检索**：FTS5 关键词 + Chroma 向量，各自缺点互补（关键词对新术语准、向量对同义改写稳）——与仓内 RAG 线的混合召回同构。
3. **`<private>` 标签**：被该标签包住的内容不进记忆存储。隐私控制做成内容级标记而不是会话级开关，粒度比 context-mode 的 `--continue` 清账细。

### 4.3 记忆 provider 三选

- hosted 服务（官方宿主）；
- 自带 OpenRouter/Gemini key；
- 直接用 Anthropic 套餐额度。

企业落地追问对应：「记忆摘要卖给谁」不仅是成本问题也是合规问题——hosted 意味着会话内容出厂，自带 key 才谈得上数据边界。

### 4.4 和 context-mode 的分工边界

两者装在同一台 coding agent 上并不冲突，甚至互补：

```
context-mode：管「现在的窗口别被原始数据灌爆」——横向省窗
claude-mem：  管「昨天的活今天别忘」         ——纵向续命
```

一句话对内：**一个管工具输出，一个管会话摘要；一个防淹，一个防忘。**

---

## 五、Hindsight：服务端记忆层的「仿生」流派

仓库：`vectorize-io/hindsight`，定位是「会让 agent 学习的记忆系统」（learn，not just remember）——它其实更接近线二（服务端记忆产品），列进本篇是因为 2026-10 trending 上它与两件套同榜爆发，且抽象层对照最能讲清「为什么不用 RAG 当记忆」。

### 5.1 四类仿生记忆（biomimetic）

```
World facts    世界事实：「炉子很烫」——与自身经历无关的客观事实
Experiences    亲历经验：「我摸过炉子，很疼」——带第一人称视角与场景
Observations   观察结论：多条记忆收敛出的、有证据支撑的稳定信念
Mental models  心智模型：由 observations + facts 综合出的世界理解
```

记忆实体按 entities + relationships + 时序组织，配稀疏/稠密双向量表示。写入时两路分流：客观内容进 world facts 通路，亲历内容进 experiences 通路。

### 5.2 三操作：retain / recall / reflect

- `retain(bank, content)`：背后跑 LLM 抽取——关键事实、时间信息、实体、关系——再过归一化（canonical 实体、时序、搜索索引）。**写入即消费 LLM 算力**，这是抽取式路线的共同成本曲线，与仓内产品化专题 mem0 的「写入 merge gate」同型账。
- `recall(bank, query)`：支持时序查询（"What happened in June?"），稀疏+稠密混合。
- `reflect(bank, query)`：不返回记忆原文，返回基于 disposition（倾向性）生成的回答——把「检索」升级成「基于记忆的生成」。

### 5.3 证据等级与口径红线

- 自报 LongMemEval SOTA，且声明 Virginia Tech Sanghani Center 与 The Washington Post 的研究合作方做了**独立复现**；同时声明榜上其他分数为各厂商自报。
- 本仓先例（`上下文压缩与记忆训练专题` 厂商口径审计节）：该仓创建的 11 个月内冲到约 5 万 star 的增速**存疑**，无法区分真实采用与运营水位，正文不引为社区成功证据——本篇沿用该口径。
- 架构证据照引：`/mcp/{bank_id}/` 每记忆库一个 MCP endpoint，retain/recall/reflect 暴露为工具——MCP 作为记忆服务的标准出口，这个选型本身值得记。

---

## 六、三案（+仓内线一二）对照表

| 维度 | context-mode | claude-mem | Hindsight | 线一：上下文内压缩 | 线二：mem0 类产品 |
|---|---|---|---|---|---|
| 防守点 | 当前窗口 | 跨会话延续 | 长期学习与画像 | 当前窗口 | 长期事实库 |
| 写入点 | 工具输出落 SQLite | 会话 observation → AI 摘要 | retain 时 LLM 抽取 | 爆窗时摘要 | 对话后异步抽取 |
| 存储 | SQLite + FTS5 | SQLite FTS5 + Chroma | PostgreSQL + 双向量 | 窗口文本 | 各家不一 |
| 检索 | BM25 按需 | 混合 + 分层展开 | 时序+混合+reflect | 无（在窗里） | 向量/图谱 |
| 进窗内容 | 摘要+检索句柄 | 摘要注入开场 | 按需注入事实 | 全部（直到爆） | 事实列表 |
| 哲学 | 数据永不白进窗 | 昨天的活接续 | 积累成信念与模型 | 事后减肥 | 用户画像沉淀 |
| 隐私抓手 | `--continue` 清账 | `<private>` 标签 | bank 隔离 | 无 | 删除权工程 |
| 证据等级 | 客户端自测（ctx_stats） | 无明显基准 | 基准+第三方复现 | —— | 基准自测为主 |

---

## 七、工程追问四连（面试深挖层）

### 7.1 为什么「不回灌」是正确默认

compact 的目的是腾空窗口；把历史摘要倒回去，等于刚腾空又灌满，且倒进去的内容里只有一小部分对接下来的任务相关。所以正确默认是：

```
上下文里只放「能力」（检索入口 + 使用说明）
内容放在外存（SQLite / FTS5 / 向量库）
按需按相关性回填（BM25 / 向量 / 分层展开）
```

推论：评估一套会话记忆系统，先看它**默认进窗的是能力还是内容**——进内容的是上一代设计，进能力的是这一代。

### 7.2 记忆注入与前缀缓存的老矛盾

回忆仓内 `记忆与上下文工程` 的结论：动态注入内容放 prompt 越靠前，前缀缓存失效面越大。会话摘要注入恰好是「每轮都变、位置必须靠前」的最差情况。工程对策沿三案可见两派现身：

1. **压低注入频率**：session 级注入一次（claude-mem），会话内不再改——前缀缓存在会话内全程有效。
2. **注入能力而非内容**（context-mode）：路由块本身稳定（同版本不变），前缀缓存友好；动态内容走工具调用，根本不过 prompt。

### 7.3 「98%」这类数字的口径审计三步

面试被问「这个数可信吗」，照这个顺序拆：

1. **先分母**：省的到底是什么？（context-mode 省的是上下文 token，不是端到端时延/成本；上下文省 98% 不等于账单省 98%——工具执行本身不计 LLM token。）
2. **再测法**：客户端口径（`ctx_stats` 按工具分解）还是基准口径？客户端口径天然挑对自己有利的场景（大输出工具）。
3. **后复现**：有无第三方独立复现？三案里只有 Hindsight 声称有（Virginia Tech / Washington Post），且它反过来声明榜上其他厂商分数为自报——这句声明本身就是弹药。

### 7.4 fail-open 与 hook 的可靠性预算

hook 系统在生产上的正确默认是 fail-open：基础设施失效不应该阻塞用户的工具调用。代价是拦截可能静默缺失——所以配一个 `ctx_doctor` 式自检命令（校验运行时、hook 注册、FTS5、插件注册）让用户/CI 能主动发现「防护其实没生效」。这套「静默降级 + 主动自检」的组合可以直接搬进任何护栏系统设计答卷。

---

## 八、▶ 面试题

**Q1【高】coding agent 跑半小时上下文就爆了 40%，主要是工具输出吃的，怎么办？**
A：事前拦截而不是事后压缩——工具输出默认落外存（SQLite/文件），窗口里只留检索句柄与结论摘要；模型需要细节时通过搜索工具按关键词/向量取回。context-mode 自报 315 KB 压到 5.4 KB。配套两条：重型工具才挂拦截 hook（省开销）；「算结论」类任务让模型写脚本跑数据只回结论，别把数据搬进窗。

**Q2【高】会话 compact 之后 agent 忘了自己在改哪个文件，怎么设计记忆？**
A：事件溯源 + 索引不回灌。会话中 hook 拦截文件编辑/git 操作/任务/报错/用户决定，追加进事件表；PreCompact 时不把历史 dump 回窗，而是索引进 FTS5；新会话注入路由块，模型用 BM25 按需取回填。默认语义「新会话=白板」，延续需显式 continue。对照 claude-mem：hook 捕获观察 → AI 压缩摘要 → 下次会话注入开场。

**Q3【高】README 写「上下文节省 98%」，面试官问你信不信，怎么答？**
A：三步拆口径。分母：省的是上下文 token 占用，不是端到端成本/时延/成功率；测法：客户端 per-tool 自测，天然偏向大输出工具场景；复现：有无独立第三方——没有就只当方向性信号。能给出复测方案加分：固定任务集 × 开/关插件，记录 context 峰值与任务成功率两侧，防止省窗伤质量。

**Q4【中】为什么不把压缩后的历史摘要塞回上下文？**
A：compact 的目的就是腾窗，倒回去等于又灌满；且历史内容只有小部分对下一步相关。所以只回「能力」（检索工具+说明），内容留外存按需取回。「默认进窗的是能力还是内容」可以作为系统代际划分标准。

**Q5【中】记忆摘要每轮都变、又得放 prompt 开头，前缀缓存不是全失效了？**
A：两派现身工程。一派压频率：摘要只在 session 开场注入一次，会话内不变，缓存全程有效（claude-mem）。一派换载体：注入的是稳定的路由块（同版本固定），动态内容走工具调用不 prompt（context-mode）。二者可叠加。

**Q6【中】让模型「少说话省 token」有什么问题？**
A：Moonshot 对 kimi-k2.5 的自报实验：激进 brevity prompt 拉低 coding/reasoning 基准。正确分工：基础设施只路由数据去哪，文风控制交给项目自己的 CLAUDE.md/AGENTS.md；context-mode 明确不做 prose enforcement 就是这条的落地。

**Q7【中】Hindsight 的四类记忆和 mem0 / Zep 的本质区别是什么？**
A：抽象层之争。mem0 是「抽取式事实库」（事实条目+冲突合并），Zep 是「时序知识图谱」（实体关系带双时态），Hindsight 是「仿生分层」（facts/experiences/observations/mental models，多条记忆收敛成信念再综合成模型）。retain 写入时的 LLM 抽取+归一化成三家共同成本曲线；Hindsight 多出的 reflect 把检索升级成基于记忆的生成。注意口径：其 LongMemEval SOTA 有第三方复现声明，星数增速本仓存疑不引。

**Q8【低】hook 挂了导致防护静默失效，这类系统可靠性怎么设计？**
A：默认 fail-open——hook 失效不阻塞工具调用，可用性优先；配套自检入口（doctor 命令校验运行时/hook 注册/索引可用性）让 CI 主动发现防护缺失。护栏类系统通用姿势：静默降级 + 主动自检，而不是硬失败。

**Q9【低】产品要求「用户删掉记忆就真删」，三件事怎么配合？**
A：粒度三分。会话级：新会话默认清账，延续需显式 continue（context-mode）；内容级：`<private>` 标签圈住不进存储（claude-mem）；服务级：bank 隔离 + 删除权五步落地（见产品化专题 GDPR/CCPA 清单）。面试回答按「粒度从粗到细、动作从默认到显式」组织。

---

## 九、串联阅读

- 线一对照（上下文内压缩与成分全景）：[记忆与上下文工程](./记忆与上下文工程.md)
- 线二对照（mem0/Zep/Letta 五种抽象与基准）：[Agent 记忆产品化专题](./agent记忆产品化专题.md)
- 基准与忘治理（LongMemEval / 双时态 / GC）：[Agent 记忆评测与遗忘治理专题](./agent记忆评测与遗忘治理专题.md)
- 事件溯源与 checkpoint 语义：[Harness 工程实战](./harness工程实战.md)
- hook s04 在 Claude Code 里的原生形态：[Learn Claude Code 导读](./learn-claude-code导读.md)
- 星数存疑口径先例：[上下文压缩与记忆训练专题](./上下文压缩与记忆训练专题.md)
- 「返回结果 vs 返回数据」之争：[工具调用与 MCP](./工具调用与mcp.md)

---

## 十、口径与未核实说明

1. 全部性能与压缩数字来自各仓 README 或其自述引用，**自报口径，本仓未复测**；「第三方复现」声明本身也引自 Hindsight README 自述。
2. star 数与月增为 2026-10 GitHub 页面时点读数；trending 月榜机制为 GitHub 官方口径但算法未公开，只作热度信号。
3. Hindsight 星数增速沿用本仓既有存疑口径，不作成功证据引用；其功能机制描述以 README 为准。
4. 「Moonshot brevity 实验」为 context-mode README 转述的自报结论，未查原始实验出处，引用时建议同样标注转述口径。
