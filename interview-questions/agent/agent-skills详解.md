# Agent Skills 详解：写给模型的任务说明书

> 本篇面向想搞清楚「Skills 到底和工具/MCP/系统提示有什么区别」的读者。
> Skills（Agent Skills，Anthropic 2025 底推出并开放为 agentskills.io
> 规范）已经成为 2026 年 agent harness 的标配件——Claude Code、pi、
> dsh、MiniMax Code、Kimi Code 全都支持。读完你会获得：Skills 的准确定位
> （在「给模型加能力」的三种方式里它是哪一种）、渐进式披露的三层机制、
> 写好一个 Skill 的工程纪律，以及与工具/MCP/Subagent 的边界表。

## 一、定位：三种「加能力」方式里管知识的那种

先钉在心智地图的正确位置：

| 方式 | 给模型什么 | 类比 |
|---|---|---|
| **工具 / MCP** | 可调用的**动作** | 给员工一台打印机 |
| **上下文注入（RAG/记忆）** | 与当前问题相关的**事实** | 把资料摊在他桌上 |
| **Skill** | 完成某类任务的**流程与诀窍** | 给他一本岗位操作手册 |

Skill 的物理形态是一个目录：中心是 `SKILL.md`（带 YAML frontmatter
的 Markdown），旁边可放 `scripts/`（可执行脚本）、`references/`
（参考文档）、`assets/`（模板）等资源。

对应记忆分层，**Skills 是程序性记忆的载体**（「怎么做某类事」），
语义记忆管「事实」，情景记忆管「经历」（见
[记忆与上下文工程](./记忆与上下文工程.md)）。

## 二、核心机制：渐进式披露（Progressive Disclosure）

Skills 的灵魂设计——怎么让上百个技能可用却**不撑爆上下文**。
三层披露，成本逐级递增：

```text
第一层（常驻，每个 ~几十 token）：
  name + description 索引，进 system prompt 的 <available_skills> 区
  → 模型知道"有哪些手册存在、各自管什么"

第二层（命中才加载，几百~几千 token）：
  SKILL.md 正文——步骤、约束、输出格式
  → 模型判断任务匹配 description 后，用 read 工具自己把文件读进来

第三层（按需引用，不占上下文）：
  scripts / references / assets
  → 模型按 SKILL.md 指引去读参考文档，或直接执行脚本
    ——脚本输出进上下文，脚本代码本身不进
```

<div class="diagram-embed">
<iframe src="assets/diagrams/skill-triple-disclosure.html" width="100%" height="620" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/skill-triple-disclosure.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

最巧妙的一点：**「使用技能」不是特殊功能，就是普通的文件读取**——
零协议、零新原语，全靠「索引写得好 + 模型会读文件」。
源码佐证 pi 的 `formatSkillsForPrompt()`（`core/skills.ts`）：
往 system prompt 注入 `<available_skills>` 索引和一句「任务匹配时
用 read 工具加载 skill 文件」——就这些，机制到此为止。

## 三、SKILL.md 解剖与工程纪律

```markdown
---
name: pdf-form-filler          # ≤64 字符，小写+连字符，禁连续 --（规范级校验）
description: 填写 PDF 表单字段。当用户提供 PDF 并要求填表、
             或要求从 PDF 表单提取数据时使用。   # ≤1024 字符
disable-model-invocation: false   # true 则只能 /skill:name 显式调用，不进索引
---

# PDF 表单填写
## 何时使用 / 何时不要使用
## 步骤（1. 用 scripts/analyze.py 提取字段 2. …）
## 参考 references/field-types.md
```

写 Skill 的四条工程纪律（决定触发率高不高）：

1. **description 就是路由器**——模型只看它决定用不用；必须写清
   「什么场景用、什么场景**不**用、和相邻 skill 的边界」
   （与工具 schema 的 description 纪律同源，见
   [工具调用与 MCP 第三节](./工具调用与mcp.md#三工具-schema-设计被低估的工程题)）；
2. **粒度要像菜谱不像百科全书**——一个 skill 解决一类任务；
   太大的拆成主 skill + 多个 references 分层加载；
3. **能脚本化的判断别留给模型**——校验、转换、格式化写成脚本让
   模型执行：确定性逻辑不占 token、不出幻觉；
4. **相对路径生效规则**：skill 内引用的相对路径一律相对 skill
   目录解析（pi 会在 prompt 里显式教模型这条）。

参数校验（来自 pi `skills.ts` 的真实实现）：name ≤64 字符且
`[a-z0-9-]`、不允许首尾连字符和连续双连字符；description 必填
非空、≤1024 字符；**校验失败降级为 warning 不阻塞加载**——
坏 skill 不会拖垮整个启动（诊断会报告，见 principles）。

## 四、边界辨析：和工具/MCP/Subagent/System Prompt

| 对比 | 一句话 |
|---|---|
| **vs 工具/MCP** | 工具是动词（execute），skill 是名词+说明书（knowledge）；skill 里指点模型去**用哪些工具**。互不替代，通常配合 |
| **vs System Prompt 常驻指令** | 常驻指令每条请求都付 token 且数量有上限；skill 索引只有几十 token、正文按需加载——**常用纪律放 system prompt，长尾技能放 skills** |
| **vs Subagent** | subagent 隔离上下文另起炉灶；skill 在**同一上下文**里加载知识继续干——要隔离用前者，只要知识用后者 |
| **vs Few-shot 示例** | example 是 skill 的可选组成（放 references 里）；skill 还能带脚本和流程，是超集 |
| **vs Workflow 引擎** | workflow 是代码驱动的固定 DAG；skill 是模型自主决定是否遵循的软指引——约束强弱不同 |

发现与加载的实现细节（pi `loadSkillsFromDir`）：目录含 `SKILL.md`
即视为技能根**不再递归下钻**；尊重 `.gitignore`/`.ignore`；
三级来源合并（全局 `~/.agent`、项目 `.agents/skills`、显式路径），
重名按优先级去重；ACP 客户端在会话创建时拿到 skill 清单，
唤出名是 skill 配置的名而非安装包名。

## 五、生态现状（2026-10 一手观察）

| Harness | Skills 支持 | 特色 |
|---|---|---|
| Claude Code | 原生 `.claude/skills/` | 规范主要传播者；`/skill` 显式调用 + 自动触发 |
| pi | `core/skills.ts` | 发现规则/校验/ignore 支持/三源加载的完整参考实现 |
| dsh | 独立 skill 包 + skill 工具 | 能力缝形态，可整体替换 provider |
| MiniMax Code | `.agents/skills`、`.claude/skills`、`.minimax/skills` **三根目录都认**，且支持符号链接 | 直接兼容 Claude Code 用户已有资产——生态打法教科书 |
| Kimi Code | `~/.kimi-code/skills/` | 本仓库的 superpowers、archify 都是这个形态 |

mcode 的选择说明趋势：**skill 目录正在成为跨工具的默认约定**，
就像 MCP 之于工具——个人沉淀的 skills 可以在多个 harness 间复用。

## 六、优势与注意事项

**优势**：上下文经济（三层披露，常驻成本趋零）；可组合（skill 可
调工具/MCP）；可分发（git/npm 包即可）；人类可读可审计（就是
Markdown）；模型无关（不绑定厂商私有协议）。

**注意**：触发完全依赖 description 质量与模型判断，**没有强制
约束**（软性匹配，可能该触发没触发）；skills 也是**间接注入面**
（恶意 skill 文件=可信指令通道，只装可信来源并做内容审查）；
多个 skill 职责重叠时会互相干扰（和工具选择过载同病）；编写质量
参差——「能写 prompt 就会写 skill，但写好同样需要把它当产品做」。

## 七、经典 Skill 精读清单（2026-10 核实）

读别人的经典作品比闷写快十倍。以下均为真实仓库中可核对的样本，
按「学什么」排序：

**入门底册：[anthropics/skills](https://github.com/anthropics/skills)**
（规范制定者的参考答案）

- **`pdf`——结构完整度标杆**：SKILL.md 正文只有 Quick Start
  （几十行 pypdf 示例），细节全推给 `reference.md` / `forms.md` /
  `scripts/`——三层披露「用到才读」是活的；description 用穷举
  场景动词触发（reading / merging / splitting / OCR…），
  不是「处理 PDF」四个字；
- **`mcp-builder`——流程型标杆**：几乎没有脚本，主体是四阶段
  workflow + 「工具的 quality 由 LLM 能否完成真实任务衡量」这类
  写进流程的判断标准——复杂流程类 skill 的模子；
- **`skill-creator`——元技能标杆（必看）**：把 skill 开发做成
  闭环：draft → 造测试 prompt → 后台跑评估 → 定量指标+定性评审 →
  重写 → 扩大测试集。理解「skill 是要 eval 的产品」的原始出处。

**企业流程类：dsh 仓库自用 `.agents/skills/`（16 个）**

- **`dsh-create-upgrade-guide`——description 教科书**：
  触发条件写成可判定技术边界（「breaks an externally perceptible
  surface: CLI, profiles, settings keys, persisted data, wire APIs…」），
  正文带 scope 划界、位置规范、i18n 配对要求；
- `dsh-prose-standard` / `dsh-trim-cot-leakage`——开阔适用面想象：
  连「文档文风」「防思维链泄漏」都能做成 skill。

**极简美：pi 仓库 `.pi/skills/`**

- `interactive-testing.md`（教 agent 用 tmux 测交互 TUI）与
  `release.md`（发布 checklist）——**skill 可以小到只有一页**，
  小而准 > 大而全的活样本。

**本机就有：`~/.kimi-code/skills/`**

- `archify`（本仓库 86 张图的生父）——工具管线型：
  四道门验收（validate→deliver→check→browser-check）写成 skill，
  质量门禁不依赖人肉记忆；
- `taste-skill` vs 官方 `frontend-design` 对比读——
  「品味也能写成 checklist」：反例清单 + 判定规则，避免写得空洞；
- `superpowers` 系列（brainstorming/tdd/systematic-debugging，
  在 `~/.kimi-code/plugins/managed/superpowers/skills/`）——
  流程纪律类大全集：反模式红旗表格 + 强制执行顺序 + 适用边界。

**读法**：每个 skill 带四个问题解剖——触发条件可判定吗？
正文哪些该挪 references？哪些判断固化成了脚本？有没有写
「怎么验证它有效」？读完挑一个每周重复 3 次以上的流程，
按 pdf 的结构 + dsh 的 description 标准写一个，并用
skill-creator 的闭环评估触发率。

## 八、意外情况排错手册（实战 95% 覆盖）

| 症状 | 根因（按概率排） | 处置 |
|---|---|---|
| 装了没触发 | description 太抽象/和其他技能撞车/索引未重载 | 加触发场景关键词（「当用户说 X 时」）；写边界；`/skills` 查索引 |
| 触发了但不按流程走 | 正文像文档不像指令；步骤无 done 标准 | 砍成「每步一动作+验收条件」；长解释挪 references；祈使句 |
| 不该触发时乱触发 | description 写太宽 | 加负向条件（「不要用于：…」） |
| 触发错 skill | 多技能职责重叠（同工具选择过载） | 合并或重切边界 |
| 脚本执行失败 | 环境依赖/路径错 | 脚本自带依赖守护；相对路径一律相对 skill 目录解析 |
| 内容过期 | 无版本意识 | 项目 skill 进 git 跟着代码走；references 写快照日期 |
| 多 skill 指令冲突 | 无优先级声明 | 项目 > 全局；正文写「服从 system prompt 全局纪律」 |
| 反直觉步骤被跳过 | 与模型训练习惯冲突 | 步骤前加「⚠️ 不要跳过」；反模式用「不要做 X（因为 Y）」 |
| skill 即注入 | 供应链 | 只装可信源；敏感 skill 设 `disable-model-invocation` |

**兜底心法**：90% 是 description 问题，5% 是正文长度，5% 是脚本
环境——排错永远先改 description，再裁正文，最后查脚本。

## 九、▶ 面试挂钩

**问题 1：Skills 是什么？和工具/MCP 什么区别？**
「Skill 是给模型的任务说明书：一个 SKILL.md 目录，frontmatter
声明 name/description，正文写流程，旁边放脚本和参考文档。
核心机制是渐进式披露——索引几十 token 常驻，正文命中才用 read
加载，脚本只消费输出。和工具的分工：工具给动作，skill 给动作的
使用流程；和 system prompt 的分工：常驻纪律放 prompt，长尾技能
放 skills。我读过 pi 的 skills.ts：发现规则、name/description
规范校验、disable-model-invocation 开关都是 Anthropic 规范的实现；
MiniMax Code 直接兼容 .claude/skills 目录，说明它正在变成跨
harness 的默认约定。」

**问题 2：为什么不把这些说明直接写进 system prompt？**
「上下文经济学。常驻 prompt 每条请求都付费且有容量上限——几百条
技能说明常驻等于把 prompt 写爆了，还稀释真正重要的纪律。
Skills 把成本变成『索引常驻 + 按需加载』：100 个技能的索引不到
一千 token，只有被命中的那个才临时占用正文预算。这就是
progressive disclosure，本质和 RAG 的『检索代替全量塞入』
是同一思想在「流程知识」域的应用。」

**问题 3：Skill 文件算不算新的安全风险？**
「算间接注入面：模型会把 skill 内容当指令执行，恶意 skill 等于
一条可信的指令通道。缓解三条：只装可信来源（企业里做 skill 仓库
评审）；对禁用自动触发的敏感技能设 disable-model-invocation，
只许 /skill:name 人工点名；harness 层的权限与审批对 skill 同样
生效——skill 只是文本，它触发的**工具调用**仍走权限管线，
这是最后一道闸。」

## 十、延伸阅读（仓内）

- 源码实现：[Pi 源码分析 · Skills 一节](./pi-agent源码分析.md)。
- 产品视角：[AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)。
- 记忆分层的位置：[记忆与上下文工程](./记忆与上下文工程.md)
  （程序性记忆）。
- 与工具协议的对比：[工具调用与 MCP](./工具调用与mcp.md)、
  [MCP vs 工具调用深度对比](./mcp与工具调用深度对比.md)。
