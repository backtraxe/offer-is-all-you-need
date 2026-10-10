# Guardrail 系统专题：审核模型谱系、五类 Rail 管线与红队合规闭环

> 本篇面向要回答「Agent 上线前安全审核这层怎么做」的读者——guardrail
> 模型怎么选、管线怎么搭、延迟账怎么算、红队怎么闭环、国内合规怎么走
> 全流程。读完你会获得：一条从 Llama Guard v1 到 v4 的谱系主线（含每版
> taxonomy 演进与关键性能数字）、NeMo 五类 rail 与本仓 L1-L5 五层防御的
> 映射、延迟叠加的真实锚点与优化四板斧、红队工具栈与基准四层，以及国内
> 备案/标识双轨合规清单。时效口径：2023-12 Llama Guard v1（arXiv）起，
> 至 **2026-08 备案累计约 1112 款**（网信中国 2026-09-14 公告）。
>
> 本篇与 [Agent 安全与防护](./agent安全与防护.md) 是双向引用关系：
> 那篇讲 L1-L5 五层防御框架与威胁模型，本篇讲框架里「审核模型与管线」
> 这一格的工程实现——input rail≈L1 注入分类、execution rail≈L3 动作
> 审查、output rail+DLP≈L4 外泄控制，互相串联、不重复展开。

## 〇、开篇勘误：写作前核掉的五个常见错误说法

在这段主题下流传最广的几条「记忆」都是错的，面试里说出来会暴露信息源：

1. **Llama Guard 4 并非「三个版本」**。HuggingFace 全量检索确认只有一个
   权重：**Guard 4-12B**（2025-04-23 上传）。「三版本」的记忆来自
   Scout/Maverick/Behemoth 三个 Llama 4 基座，或来自 Guard 3 的
   1B/8B/11B-Vision 三规格。
2. **Guard 4 的发布时间是 2025-04-05 随 Llama 4 同天官宣**（Meta 博客
   原文明示三件套），HF 权重稍晚（04-23）；「2025-06 发布」是错记。
3. **「Gemma Shield」的正确名字是 ShieldGemma**（Google，Gemma 2 基座）。
4. **「PyJudge」查无此物**。红队 judge 的真实候选是 JailbreakBench 的
   Llama-3-70B judge 和 StrongREJECT（arXiv:2402.10260）。
5. **「每加一级 rail 多 200-500ms」与实测矛盾**。真实锚点是
   Prompt Guard 2-22M 单条 **延迟 19.3ms**（A100、512 token，HF 卡
   2025-04-28）、全量输入+输出双过滤的**推理开销 +23.7%、拒答率
   +0.38% 两项代价**（Anthropic Constitutional Classifiers，
   arXiv:2501.18837，2025-01）。本文所有延迟账按锚点组织，不用
   「200-500ms」口径。

## 一、先立主线：guardrail 模型 ≈ 基座模型的安全蒸馏体

内容安全分类器在 2023-2025 收敛到一个稳定形态：**与基座模型同代的
小一号指令微调模型**。Llama Guard 谱系是最完整的样本：

- v1（2023-12）：Llama2-7B 指令微调；
- v2（2024-04）：Llama3-8B；
- v3（2024-07）：Llama3.1-8B；
- v4（2025-04）：Llama 4 Scout 的 MoE **删掉路由专家、只留共享部分
  剪成 dense 12B**，early fusion 多模态。

一句话记住：**guardrail 模型 ≈ 基座模型的安全蒸馏体**——基座换代，
guardrail 跟着换蒸馏，吃同一套架构与训练栈红利。这句在面试里既是
选型直觉（别把 guardrail 当成独立品类自研），也是成本判断（蒸馏体
的推理成本远低于法官式大模型调用）。

第二条主线是 **taxonomy 标准化**。2024 年后行业收敛到
MLCommons AI Safety v0.5（2024 上半年发布，13 类危害）作为公共
类目集；国内以 Qwen3Guard（2025-09）为代表走出另一条：**9 类目里自
带 Politically Sensitive Topics 与 Jailbreak，三档严重度**——中外政
策差异直接映射进 taxonomy，不是翻译问题。面试追问「类目能不能改」
的答案是：指令微调路线换 taxonomy 只需换 few-shot 模板或微调数据，
这正是自研 guardrail 相对 API 审核（政策写死）的最大差异。

## 二、Llama Guard 谱系详解：每版的 taxonomy 演进与关键数字

| 版本 | 发布 | 基座 | taxonomy | 关键数字 |
|---|---|---|---|---|
| Guard v1 | 2023-12（arXiv:2312.06674） | Llama2-7B | 自建 6 类 + O1-O6 | 匹配或超当时商用审核（OpenAI Moderation/ToxicChat） |
| Guard 2 | 2024-04-18 随 Llama 3 | Llama3-8B | MLCommons 13 类覆盖 11 类（诽谤/选举需外部实时知识被显式排除） | **内测 F1 0.915、AUPRC 0.974、FPR 0.040**（model card）；对比 OpenAI Moderation API F1 0.347、GPT-4 zero-shot F1 0.796 且 FPR 9-25% |
| Guard 3-8B | 2024-07-23 随 Llama 3.1 | Llama3.1-8B | 新增 S14（代码解释器滥用+搜索工具滥用），8 语言 | **英文 F1 0.939、AUPRC 0.985、FPR 0.040**（HF 卡）；INT8 量化掉点极小 |
| Guard 3-1B/INT4 | Meta Connect 2024 | 剪枝+蒸馏 1B | 同 v3 | **手机 CPU TTFT ≤2.5s、≥30 tok/s**（官方演示口径） |
| Guard 3-11B-Vision | 随 Llama 3.2 | 11B 多模态 | 同 v3 | 首代图像审核版 |
| Guard 4-12B | 2025-04-05 官宣、04-23 权重 | Scout MoE 剪成 dense 12B，early fusion | S1-S14 同 v3，加多模态 | 见下表 |

Guard 4-12B 的分项实测（HF model card，2025-04，文本与多模态训练数据
约 3:1，多图训练以 2-5 张为主）：

| 轴 | 指标 | 数字 |
|---|---|---|
| 英文文本（输出过滤） | Recall / FPR / F1 | **R 69%/FPR 11%/F1 61** |
| 多语言（7 语） | Recall / FPR / F1 | **R 43%/FPR 3%/F1 51** |
| 单图 | F1 | **F1 38** |
| 多图 | F1 | **F1 52** |
| 生态 | Meta 托管服务 | Llama Moderations API 已集成合成（截至本文仅此项获证实） |

两个直接被面试官拿来挖坑的官方 limitation，从 v2 起每张 model card
都写着：

1. **Guard 自身仍易被 adversarial/prompt injection 攻击**——LG4 干脆
   在卡里推荐搭配 Prompt Guard 2 分工。这句的官方背书在面试里要记
   住：**Guardrail 永远只是系统级纵深防御的一环**（各家 model card
   的官方 limitation 自认）。
2. **多图限制**：多数评测「最多三张图」，更多图性能未保证。
3. **多语言短板**：LG4 多语 R 43% vs 英文 R 69%——这是「通用英文审
   核模型多语言召回显著更弱」的硬证据，也是国内必须换 Qwen3Guard
   类自营模型的数字依据。

Guard 2 的一个训练技巧值得一提：**hard sample 对抗训练**——用
Llama2-70B 生成能把分类器判错的对抗样本、翻转标签回流进训练集。
这条思路后来被 Constitutional Classifiers 的合成数据路线继承（见
第八节红队闭环）。

## 三、Prompt Guard 2：不是 LLM 的判别式守卫

Prompt Guard 2（2025-04-28，HF 卡）证明了 guardrail 不一定是大模型：
**86M（mDeBERTa 多语）与 22M（DeBERTa-xs）两个判别式分类器**，专查
prompt injection 与 jailbreak：

| 指标 | 86M | 22M |
|---|---|---|
| Recall@1%FPR（英文） | **97.5%** | **88.7%** |
| 单条延迟（A100，512 token） | **92.4ms** | **19.3ms** |

- Prompt Guard 2 的 v1/v2 延迟同口径（A100、512 token 单条），引用
  时注意别混用单位。
- 512 token 上下文之外的长文**切分并行**处理——小模型的 19ms 级延迟
  让「每条输入都过一遍注入分类」成为默认动作而不是奢侈品。
- Agent 场景评测的**APR@3% 81.2% 压制率**（AgentDojo；GPT 基线
  最差单项 12.9%）——判别式小模型在 agent 注入防护上大幅反超当法官的通用
  LLM。

## 四、同类对照表：九条产品线一张图

| 产品 | 基座/形态 | 类目口径 | 定位与备注 |
|---|---|---|---|
| OpenAI Moderation API | omni-moderation-latest | 13 字段，部分类目仅文本 | **免费**；文本+图片（单图 ≤20MB）；官方明示**不用于 CSAM** |
| Llama Moderations API | Guard 4 托管 | MLCommons | Meta 官方托管，集成已证实 |
| ShieldGemma | Gemma 2 的 2B/9B/27B | 4 类危害 | **内测 Prompt F1 0.825-0.830**（arXiv:2407.21772，2024-07）；ShieldGemma 2=4B Gemma 3 基座图像安全（2025-03-04） |
| WildGuard | Mistral-7B（AllenAI） | 三任务 | prompt 危害/response 危害/拒答检测；比 LG2 与 Aegis 最高**超 25.3% 的幅度**，对抗 prompt 判定超 GPT-4 至多 4.8%（arXiv:2406.18495） |
| Aegis（NVIDIA） | 数据+模型两路 | MLCommons 系 | Aegis-AI-Content-Safety 数据（2024-04-17）；llama-3.1-nemoguard-8b-content-safety 多语（2025-01-15）；NemoGuard-JailbreakDetect（2025-01-14） |
| Qwen3Guard | 0.6B/4B/8B | 9 类目含**政治敏感+Jailbreak**，三档严重度 | 训练数据 119 万条、**119 种语言**；Qwen3Guard-Stream 用 token 级分类头做流式实时审核（2025-09-23，arXiv:2510.14276） |
| Azure Prompt Shields | 托管服务 | 注入+内容 | 存在且可用；GA 具体月份未核实，不引 |
| Perspective API | Jigsaw | 毒性多维 | 老牌文本毒性 API |
| NeMo Guardrails | 编排框架不是模型 | — | EMNLP 2023；五类 rail；Colang 1.0/2.0；最新 release 0.24.1（README 截至 2026） |

选型直觉：英文通用→Guard 系或 ShieldGemma；中文+政治敏感+多语言
→Qwen3Guard 收口；轻量注入检测→Prompt Guard 2；代理 TO C 文本审核
且接受数据出境→OpenAI Moderation 先压成本。

## 五、管线架构：五类 rail、输入 vs 输出过滤与延迟账

<div class="diagram-embed">
<iframe src="assets/diagrams/guardrail-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/guardrail-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 5.1 五类 rail 与本仓 L1-L5 的映射

NeMo Guardrails 的 rail 分类（2023 EMNLP 至今的行业共识）与本仓
[Agent 安全与防护](./agent安全与防护.md) 的 L1-L5 严丝合缝：

| rail | 干什么 | 映射 L1-L5 |
|---|---|---|
| input rail | 用户输入进主模型前：注入分类（Prompt Guard 2）+内容初筛 | ≈L1 注入分类 |
| dialog rail | 对话状态/流程约束，守待办与话题边界 | ≈L2 提示词与流程约束 |
| retrieval rail | 检索/工具返回进上下文前：挡间接注入 | ≈L2/L3 数据面检疫 |
| execution rail | 工具入参/出参审计，动作级放行 | ≈L3 动作审查 |
| output rail | 主模型输出出系统前：内容审核+DLP 外泄检测 | ≈L4 外泄控制 |

Agent 场景与纯聊天的差别就在中间两档：**注入面随工具数线性放
大**，覆盖目标从「内容安全」扩到「意图/动作安全」（S14 工具滥用类、
Prompt Guard 2 的 jailbreak 检测、AgentDojo 评测）。

### 5.2 输入过滤 vs 输出过滤：LG4 model card 的官方对比

Meta 官方内测的措辞（面试可直接引）：

- **输入过滤**：违规更早拦截、违规率压得更低，但**拒答率上升更多**；
  附带收益是省主模型 token（违规请求不烧主模型算力）。
- **输出过滤**：给模型「以安全方式回答危险提问」的机会，用户体验
  更好。
- **两者叠加违规率最低，成本也最高**——全量双过滤的成本锚是
  Anthropic 的**推理开销 +23.7% 成本锚**（见第八节）。

务实折中（也是面试标准答案）：输入侧只跑 19ms 级小分类器查注入，
内容审核主力放输出侧，按意图路由选择性启用重检。

### 5.3 延迟叠加的真实锚点与优化四板斧

锚点先立住：**PG2-22M 19.3ms、PG2-86M 92.4ms**（单条、A100）；
全量双过滤 **+23.7% 推理开销**（Anthropic）；端侧 **INT4 手机版
TTFT ≤2.5s**。优化四板斧：

1. **判别式小模型打头**：几毫秒到几十毫秒级，覆盖注入与大路货内容
   初筛。
2. **LLM 级守卫取 first-token probability + thresholding**：LG2/3/4
   的 model card 都明示这条路径——不整句 decode，取首个 token
   （safe/unsafe）的 logit 做阈值判定，延迟压一个数量级。
3. **并行 + short-circuit + 选择性启用**：各 rail 并行跑、命中即短路；
   语义 cache/意图路由让重检只对特定问题类型启用（NeMo README 官方
   建议「fact-checking 只对特定问题类型启用」的写法）。
4. **端侧 INT4**：隐私+离线场景用手机版 1B/INT4。

### 5.4 多语言审核：LG4 的 43% 短板与国内收口

LG4 多语 R 43% vs 英文 R 69%（见第二节），M-ALERT（arXiv:2412.15035，
2024-12）的题目就叫「LLMs Lost in Translation」——跨语言审核不一致
是实证结论。国内落地标准动作：**Qwen3Guard 收口**（119 种语言、自带
中文与政治敏感类目、Stream 版支持流式 token 级审核），配本语言红队
集与翻译对照回流。

### 5.5 CSAM/PII/政治敏感：三个「不是 LLM 审核主场」的构成式

- **CSAM**：走 PhotoDNA/感知哈希专用链路做哈希比对；OpenAI 官方明示
  Moderation 不适用。「LLM 审核不当 CSAM 防线」是面试加分点。
- **PII**：确定性掩码在先（正则/NER），LLM 在后
  （NeMo sensitive_data_detection 的官方式）。
- **政治敏感**：国内按暂行办法第四条枚举红线 + 类目模型
  （Qwen3Guard 自营）+ 人审队列三层。

## 六、红队工程化：工具栈、基准四层与回流闭环

### 6.1 自动红队的始祖与工具栈现状

自动红队的始祖论文是 Anthropic 的「Red Teaming Language Models with
Language Models」（arXiv:2202.03286，2022-02）——用 LLM 生成攻击
prompt 攻击 LLM。四年后的工具栈：

- **Garak**（NVIDIA）：自我定位是「LLM 版 nmap/metasploit」，探针库
  覆盖 DAN/encoding/GCG/grandma/XSS，jsonl 命中日志直接可回流。
- **PyRIT**（微软）：**2026-03-27 GitHub 归档 read-only**（横幅实测），
  存量知识可讲，新选型别再往上押注。
- **promptfoo red team**：插件 × 策略双轴，接 CI 最顺手。
- **NeMo 自带 NemoGuard-JailbreakDetect rail**：护栏编排里直接挂
  越狱检测。

### 6.2 基准四层

| 层 | 基准 | 数字 |
|---|---|---|
| 攻防效率 | HarmBench（arXiv:2402.04249，2024-02） | 18 种攻击法 × 33 个目标模型/防御的标准化评判 |
| 攻防效率+可复现 | JailbreakBench（arXiv:2404.01318，2024-03-28） | 100 行为、Llama-3-70B judge、NeurIPS 2024 D&B |
| 类目覆盖 | ALERT（arXiv:2404.08676，2024-04） | >45k 红队指令、6 宏观类/32 子类；M-ALERT 补跨语言 |
| 法规政策对齐 | AIR-Bench 2024（arXiv:2407.17436，2024-07-11） | 8 部法规+16 家公司政策→**314 个粒度风险类目**、5694 条人工审 prompt |

国内合规语境下 AIR-Bench 最贴切——它本来就是「法规→类目」的映射
器。judge 选型替代链：JBB 的 Llama-3-70B judge 或 StrongREJECT
（arXiv:2402.10260），**没有「PyJudge」这个东西**。

### 6.3 闭环：命中回流蒸馏

完整闭环五步：**基准跑一轮 → 命中样本回流 → 蒸馏入 Guard 训练集 →
回归集进 CI 当闸 → canary 线上监测**。合成数据两条已验证路线：LG2 的
hard sample（70B 生成对抗样本翻转标签）与 Anthropic 的 constitution
→ LLM 批量生成合成训练数据路线。

## 七、合规线：暂行办法、备案时序与标识双轨

### 7.1 三部法规的时间轴

- **《互联网信息服务深度合成管理规定》**：2023-01-10 施行，母法。
- **《生成式人工智能服务管理暂行办法》**：2023-08-15 施行。关键条号：
  第 4 条（红线枚举）、第 14 条（违法内容处置链：停止生成/传输/消
  除→整改→报告）、第 15 条（投诉举报入口）、第 17 条（安全评估+
  算法备案）、第 20 条（境外服务属地处置）。
- **《人工智能生成合成内容标识办法》**：四部门 2025-03-07 印发、
  **2025-09-01 施行**，配套强制国标——显式+隐式双标识成为硬合规。

### 7.2 备案时序（全链官方口径）

| 时点 | 累计备案 | 来源 |
|---|---|---|
| 2025-08-31 | 538 款 | 新华网 |
| 2026-04-30 | 868 款 | 官方通报 |
| 2026-06-30 | 988 款 | 央视网 |
| 2026-08-31 | 约 1112 款（07-08 新增 124） | 网信中国 2026-09-14 公告 |

双层级结构：**自训大模型走国家网信办备案**（含安全评估+算法备案，
办法第 17 条）；**API 直调已备案模型的应用，由地方网信办「登记」**
（2026-09 网信中国公告口径）——上线前自查清单里这两项是分开的。
另注：首批备案 41 款（2023-08）沿用媒体口径标注。

## 八、工程成本对齐与「Guard 被越狱」骨架

### 8.1 成本三档经验法则

1. **零近成本档**：OpenAI Moderation **免费**——To C 文本审核成本可
   压到近零，代价是数据出境与政策写死。
2. **全量双过滤档**：自托管全量输入+输出审核的成本锚是 Anthropic
   的**推理开销 +23.7%、绝对拒答率 +0.38% 两项**。
3. **省钱档**：注入用 19ms 小分类器（PG2-22M）+内容审核只用 LLM
   Guard 查输出侧+按意图选择性启用（NeMo 官方建议写法）。

### 8.2 Constitutional Classifiers：把 constitution 蒸馏成分类器

Anthropic（arXiv:2501.18837，2025-01-31）的完整链路：自然语言
constitution → LLM 批量生成合成训练数据 → 训练输入与输出两个独立
分类器。**超过 3000 人时的红队无人找到 universal jailbreak**，
held-out 自动化评估稳健；代价即上面的**推理开销 +23.7% 与拒答率
+0.38% 两项**。Anthropic 没有公开发布的 auto red teaming
工具，公开动作就是 Constitutional Classifiers+红队众测。

### 8.3 「Guard 自身被越狱怎么办」五件套骨架

1. **攻击面分离**：guardrail 查注入与查内容用两个独立训练的分类器，
   攻击者要同时骗过两个训练分布。
2. **对抗训练回流**：红队命中样本翻转标签进下一轮训练集。
3. **first-token logit 阈值**：取 logit 判定而非文本解析，不给
   「骗模型按格式输出」留面。
4. **系统层最小权限+出口白名单兜底**：呼应本仓 L2/L4——护栏判错的
   损失由系统层兜住。
5. **官方 limitation 背书**：LG2/3/4、ShieldGemma、Prompt Guard 2 的
   model card 全部明示自身可被 jailbreak——把「护栏不是银弹」说成
   厂商自认，比自己辩解有力。

## ▶ 面试题

1. ⭐⭐⭐⭐⭐ **Llama Guard 的 taxonomy 怎么设计的？能不能改？**
   v1 自建 6 类→v2 套 MLCommons 13 类覆盖 11（诽谤/选举需外部实时
   知识被显式排除，要补就上 RAG）→v3 加 S14 工具滥用→v4 同类目上
   多模态。指令微调形态下换 taxonomy 只需换 few-shot 模板或微调数
   据——这是相对 API 审核政策写死的最大差异。
2. ⭐⭐⭐⭐⭐ **输入过滤和输出过滤分不分？** 官方内测：输入拦截更
   早、违规率压得更低但拒答率升更多、省主模型 token；输出体验更好；
   双过滤违规率最低、成本最高（+23.7% 锚）。务实折中=输入小模型查
   注入（19.3ms）+输出 Guard 查内容+按意图选择性启用。
3. ⭐⭐⭐⭐ **guardrail 叠加的延迟成本与优化？** 锚点：PG2-22M
   19.3ms、86M 92.4ms、全量双过滤 +23.7%。四板斧：first-token
   logit 取分、并行+short-circuit、意图路由选择性启用、端侧 INT4。
4. ⭐⭐⭐⭐ **guardrail 自身被 jailbreak 怎么办？** 五件套：独立
   攻击面（两个独立训练分布）、对抗训练回流、logit 阈值、系统层最
   小权限兜底、官方 limitation 背书。
5. ⭐⭐⭐ **受限语言/多语言场景怎么处理？** LG4 多语 R 43% vs 英文
   R 69%；中文场景换 Qwen3Guard（119 语言+政治敏感类目+流式版）；
   M-ALERT 实证跨语言不一致；本地化 Guard+本语言红队集+翻译对照
   回流。
6. ⭐⭐⭐ **红队自动化怎么设计？** Garak/promptfoo/PyRIT（已归
   档）；基准四层（HarmBench/JBB/ALERT/AIR-Bench）；命中回流蒸
   馏；回归集进 CI 当闸。
7. ⭐⭐⭐ **CSAM/PII/政治敏感怎么做？** CSAM 感知哈希专用链路禁
   用 LLM；PII 确定性掩码在先 LLM 在后；政治敏感按办法第四条枚举
   红线+类目模型+人审队列。
8. ⭐⭐⭐ **为什么用专门小模型、不让 GPT-4 当法官？** LG2 内测
   GPT-4 zero-shot F1 0.796 vs LG2 0.915，且 FPR 9-25%；专用小模型
   可离线、数据不出域、policy 可换、延迟低一个数量级；跨模型
   policy 不一致的评测不可直接比。
9. ⭐⭐ **Agent 场景 guardrail 与纯聊天区别？** 多 retrieval rail
   （挡间接注入）与 execution rail（工具入参/出参审计）；注入面随
   工具数线性放大；覆盖从内容扩到意图/动作（S14、PG2 jailbreak）；
   评估换 AgentDojo（PG2 APR@3% 81.2%）。
10. ⭐⭐ **国内上线 To C 聊天产品合规做哪些事？** 自训模型走网信
    办备案（安全评估+算法备案，办法第 17 条）；API 直调已备案模型
    走地方网信办登记；输出显隐双标识（2025-09-01 起）；违法内容处
    置链（停止生成/传输/消除→整改→报告，第 14 条）；投诉举报入
    口（第 15 条）。

## 合规口径与未核实说明

本篇写作纪律汇总，引用前自查：

| 条目 | 处置 | 原因 |
|---|---|---|
| 首批备案 41 款（2023-08） | 正文标注「媒体口径」 | 非常态公告口径 |
| 字节/百度内容审核团队人员量级 | **全文不写** | 未核实，只有传闻 |
| Zoom/DoorDash guardrail 落地案例 | **不引原文** | 二手转述，未抓到一手材料 |
| Llama Guard 官方托管审核服务 | 只写「Llama Moderations API 集成已证实」 | 其余「Guard API 托管」传闻未证实 |
| PyRIT 归档后的迁移去向 | 不写死 | 「迁至某组织」仅为社区推断 |
| Azure Prompt Shields GA 月份 | 不给 | 未核实到官方 GA 公告 |
| LG4 发布日期 | 坚定写 **2025-04-05**（Meta 博客原文） | 「2025-06」为常见错记 |
| LG4 版本数 | 坚定写**仅 12B 一个**（HF 全量检索） | 「三版本」为基座型号误植 |
| Prompt Guard 2 两代延迟 | 标注「v1/v2 同口径（A100、512t 单条）」 | 防止单位混用 |
| MLCommons AI Safety v0.5 | 只写「2024 上半年」 | 具体月日未核实 |
| 「每加一级 rail 多 200-500ms」 | **全文禁用** | 与 PG2 19.3ms 等实测锚点矛盾 |

- 来源分级：**官方 model card/arXiv 原文 > 官方法规文本与网信办公
  告 > 主流媒体报道 > 社区/自媒体**；正文凡弱源均已就地标注或降级
  处理。

## 串联阅读

- [Agent 安全与防护](./agent安全与防护.md)：L1-L5 五层防御框架与威
  胁模型——本篇 rail 映射的上位框架。
- [多agent与评测](./多agent与评测.md)：Agent 评测体系——AgentDojo
  等注入评测的上下文。
- [评测题专项](../评测题专项.md)：judge 与基准工程——红队基准四层
  的方法论底座。
- [harness工程实战](./harness工程实战.md)：护栏与 CI/回归闸的工程
  接线。

---

*时效口径：截至 2026-10。谱系与性能数字来自各家 HuggingFace model
card 与 arXiv 原文；合规时间线来自新华网/央视网/网信中国公告与
CAC 法规原文。*
