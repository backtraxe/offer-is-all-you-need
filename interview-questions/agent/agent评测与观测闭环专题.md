# Agent 评测与观测闭环专题：离线门禁 ⇄ 线上观测 ⇄ 失败挖掘 ⇄ 灰度回灌

> **面向**：已读过 [多agent与评测](./多agent与评测.md)（分层评估与 CI 门禁）、
> [观测与trace工程](./观测与trace工程.md)（OTel 承载与 trace 设计）与
> [agentic评测基准专题](./agentic评测基准专题.md)（基准题库与榜单治理）
> 的读者。本篇是这三篇之上的**闭环工程层**：基准题库、trace 字段设计、
> CI 门禁五层都不重写，只讲它们之间那条「线上数据如何回流成离线资产」
> 的环形产线。
>
> **读完获得**：① LLM-as-judge 四大偏差的研究级细节与缓解清单、
> judge 上岗前的人标校准回路；② pass@k 与 pass^k 的产品化口径
> （同一 agent 两者结论可以相反）；③ 观测层两个 2026 硬事实
> （OTel GenAI semconv 独立成仓、OpenAI Evals 平台官宣弃用）与
> 五平台定价/留存/自托管对照表；④ 闭环 pipeline 五环节（trace →
> 聚类挖掘 → 扩评测集 → 灰度 A·B → 回归监控）的商业化现状与
> Anthropic 官方方法论文精读；⑤ 「上线后怎么知道它变好了」
> 的三层标准答法骨架。
>
> **时效口径**：素材为 2026-10-12 抓取的一手来源（官方定价页、官方
> 文档、官方工程博客、arXiv 摘要页），时间轴从
> **2023 MT-Bench 论文**到 **2026-11 OpenAI Evals 关停**；平台
> 价格随时可变动，正文一律标「官方定价页 2026-10」，未核实项见文末。

## 一、主线直觉：评测不是一次考试，是一条环形产线

把 agent 当学生：离线评测是「考前模拟」，线上观测是「真实考场」。
多数团队只做了前半段——上线前跑一遍评测集，过了就发；上线后靠用户
骂声发现问题。2025 到 2026 年行业把后半段也工程化了：线上每条
trace 自动沉淀、失败样本自动聚类成 issue、确认后的真失败一键进
评测集、新修绕过门禁后灰度回灌，agent 从不进入下一次真实考试——
这就是本篇的环形主线。

这条环线现在已经有明确的商品化证据：**三家观测平台在 2026 年
不约而同把「自动从 trace 聚出 issue 并建议修复」做成了独立产品
（LangSmith Engine、Arize AX Signal、Braintrust Loop，官方定价页
2026-10）**，连 OpenAI 自己都在 2026 年 11 月关停了托管 Evals
平台、降级为 Datasets 内一项能力——「评测闭环要自己建（或买套件）」
已经是行业默认，不再是要不要做的选择题。

环线上每一段都有专属坑位：离线段坑在 judge 本身不可信（四大偏差）；
观测段坑在字段契约与账单（gen_ai.* 仍在迭代期、计费轴五花八门）；
挖掘段坑在「规则档必做、聚类档已商品化、异常检测接 llmops 篇」的
分层；回灌段坑在灰度判定标准与 judge 漂移。本篇按「离线 → 观测 →
闭环」三环逐段拆。

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-eval-loop.html" width="100%" height="880" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-eval-loop.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、离线评测层：judge 的可信度工程

### 2.1 四大偏差：必背清单与缓解对照

MT-Bench 论文（Zheng et al., arXiv:2306.05685, NeurIPS 2023 D&B）
是 LLM-as-judge 合法化的奠基文献，系统列出四大局限，面试必背：

1. **位置偏差（position bias）**：pairwise 对比时 judge 偏好出现在
   特定位置（通常第一个）的答案。缓解：两个答案交换顺序各评一次，
   仅当两次判定一致才计分，否则记为平局。
2. **冗长偏差（verbosity bias）**：judge 偏好更长的回答，即使信息
   质量相同甚至更差。缓解：rubric 显式声明「长度不计分」、输出做
   长度归一、或用 reference-based 形态弱化「看着详细」的加分。
3. **自我抬高偏差（self-enhancement bias）**：模型给自己或同家族
   模型的输出打更高分。缓解：盲评（judge 看不到答案来源）＋用
   与候选模型不同家族的强模型当 judge。NeurIPS 2024 的一篇后续
   （Liusie et al.）把这个偏差做成了可测指标——judge 在不知道
   答案来源的前提下仍系统偏爱同家族文本，即「现象」已升级为
   「有指标的实验对象」；盲评加跨家族仍是最便宜的工程解。
4. **推理受限（limited reasoning ability）**：judge 自己不擅长
   数学与逻辑题，评不了推理链正确性。缓解：先给 judge 参考答案、
   让 judge 先自己解题再对比（reference-guided grading），或
   先 chain-of-thought 再裁决。

一致性数字锚（被引用最多的 judge 可信度口径）：**与受控人类
偏好的一致率超过八成，达到「人与人之间一致率」的同一水平
（MT-Bench 论文口径，NeurIPS 2023 D&B）**。面试话术的关键是
不要说「judge 近似人类」，要说「judge 的一致性已达到人类标注员
之间一致性的水平」——这才是把 judge 推上生产的合法论据。

### 2.2 judge 上岗前：人标校准回路

仓库 [多agent与评测](./多agent与评测.md) 已有一句「先用人标校验
judge 的 precision/recall」，本篇补落地数字与回路：

- **校准集**：抽 100 到 300 条人工双标注做 gold judge 集；标注员之间
  的一致性卡达标（gold 本身才可信），然后 judge 对 gold 的 agreement
  对齐八成锚点才允许进 CI。
- **周期性复校**：judge 模型也是会被升级拖漂移的，每隔固定周期
  （月度/换 judge 版本时）重跑校准。judge、prompt、模型、dataset
  必须一起版本化。
- **双向回路**：人标样本回流做 judge 校准集；judge 低置信样本回流
  进人标 queue——两条回流是同一个标注系统的进出方向（§四.2）。
- **偏严偏松都要修**：不只看总分，judge 系统性偏严或偏松都要在
  rubric 层修正。

> ▶ 面试题：LLM-as-judge 怎么保证可信？——**高频**。四层答法：先背
> 四偏差清单与各自缓解（2.1），再讲人标校准集与八成 agreement 门槛
> （2.2），然后挑打分形态（2.3），最后收口「judge 也要版本化与月度
> 复校，它是系统的被测对象不是裁判」。

### 2.3 打分三形态与 per-dimension judge

| 形态 | 优点 | 缺点 | 适用 |
|---|---|---|---|
| Absolute rubric（1-5 绝对分） | 可排序、可看趋势 | 方差大、分数尺随 judge 版本漂移 | 版本间回归，前提是 judge 锁版本 |
| Pairwise（两两对比） | 信噪比最高、最接近人类偏好 | O(n²) 成本、只给相对序 | 发版前新旧版裁决，必须配 position-swap |
| Reference-based（对照参考答案） | 弱化 judge 知识要求、短答案也能高分 | reference 获取维护有成本，错则全错 | 事实题、代码题等有标准解的任务 |

Anthropic 2025 工程口径再加两条（§四.3 精读）：**把每个维度拆给
独立的 judge 分别评，而不是一个 judge 一次评完所有维度
（Anthropic「Demystifying evals」工程博客 2025）**——单 judge
多维会互相污染（答案一块长，语气分被事实分带跑）；另给 judge
「判不出来就输出 Unknown」的出口，宁可少分不可幻觉分。

### 2.4 pass@k vs pass^k：给指标前先问产品形态

Anthropic「Demystifying evals for AI agents」官方定义（一手博客，
发布于 2025 下半年）：

- **pass@k**：k 次尝试中至少一次成功的概率，k 越大越高
  （「更多射门次数」）。适用：工具类场景，一次成功就够。
- **pass^k**：k 次尝试全部成功的概率，k 越大越低。适用：面向
  用户的 agent，用户期望「每次都可靠」。

数字锚：**单次成功率七成五时，三次全过只有约四成的水平
（Anthropic 官方例数 2025）**——0.75 的三次方约等于 0.42。k=1 时
两者相同；k=10 时 pass@k 逼近满分而 pass^k 逼近零——同一个 agent
用哪个指标讲，结论完全相反。**面试给指标前必须先问产品形态
（Anthropic 2025 口径）**。τ-bench 的 pass^k 原始出处与 HumanEval
的无偏估计公式在 [agentic评测基准专题](./agentic评测基准专题.md)
与 [评测题专项](../评测题专项.md) 已有，本篇不重复。

### 2.5 评 outcome 不评 path：过程指标只 track 不判分

- **结果侧（outcome）**：只看环境终态（数据库里订单是否真的生成了、
  测试是否全过）。Anthropic 口径非常明确：评 agent 产出了什么，
  而不是它走了哪条路——agent 经常找到出题人没料到的合法路径，
  按固定 tool-call 序列判分会过度脆弱。原文佐证：某模型在 τ2-bench
  订机票任务上发现了规则漏洞、绕出了对用户更好的解，「按题面判
  fail，实际更优」，纯过程判分在这里直接误判。
- **过程侧（process）**：训练侧用于 credit assignment，评测侧用于
  「哪一步开始走歪」的归因（trace-level judge，仓库已提）。纯结果
  判分的盲区：答案对但路径瞎蒙，线上迟早翻车。
- **工程折中（Anthropic 口径）**：outcome 为主，过程指标只作为
  tracked metrics 记录而不做 grader——turn 数、工具调用数、总
  token、TTFT、token 吞吐这些当监控指标；判 pass/fail 只判终态
  加少量硬约束（如 max_turns、安全关键步骤必须调过某工具）。
  「必须调用过某工具」本质是把关键过程点降级为状态断言，
  **能把关键过程点写成状态断言而非按固定路径判分，是新手与老手的
  分水岭（Anthropic 2025）**。
- **Partial credit**：多组件任务给部分分——客服 agent 正确识别问题
  并完成身份核验但退款失败，显著好于第一步就失败；grader 组合有
  weighted / binary / hybrid 三档。

### 2.6 能/否双集制：capability 爬坡，regression 守门

- Capability eval 问「agent 能做什么难事」，**起步通过率应该低、
  给团队爬坡空间（Anthropic 2025 口径）**；regression eval 问
  「以前会的还会吗」，通过率应接近满分。
- 毕业机制：capability eval 被刷到高分后 graduate 成 regression
  suite 持续跑防漂移——「曾经测能不能做，现在测是否还稳定地能」。
- 起步规模数字锚：**起步只要 20 到 50 条任务、全部来自真实失败
  （Anthropic 2025 官方建议）**——早期改动 effect size 大，小样本
  就测得出；越晚建 eval 越难，因为要反向从线上系统反推成功标准。
  仓库「黄金评测集 50-200 条起步」口径在多agent篇已有，两者互补：
  冷启动靠 20-50 条失败集，成熟后扩到百条级黄金集。

## 三、线上观测层：2026 两个硬事实与五平台选型

### 3.1 硬事实一：OTel GenAI semconv 独立成仓（2026）

- 原 open-telemetry/semantic-conventions 仓的 gen-ai 目录已 404 化，
  官方重定向到新仓 **semantic-conventions-genai**（GitHub 仓 README
  2026-10 核实）。范围明确写成 spans、metrics、events for GenAI
  clients、MCP（Model Context Protocol）与 vendor专有约定，docs 由
  YAML 模型生成，另附 Python 参考实现与合规矩阵。
- **面试口径更新：gen_ai 系字段不再只是「大仓里的一个目录」，
  而是有独立治理节奏的 GenAI 专属 spec 仓、且把 MCP 工具调用
  纳入语义约定（OpenTelemetry 官方仓 README 2026-10）**——MCP
  tool 调用的 span 与 attribute 从此有官方字段。
- 沿用仓库既有边界：gen_ai.* 是事实标准但仍在迭代期，别当 stable
  契约用——内部属性用自家命名空间，gen_ai.* 只做映射层输入。字段
  清单在 [观测与trace工程](./观测与trace工程.md) §五已列全，不重复。

### 3.2 硬事实二：OpenAI Evals 平台官宣弃用（2026 时间线）

developers.openai.com evals 指南页头横幅（2026-10-12 抓取）原文
要点：**既有用户 2026 年 10 月 31 日转入只读、11 月 30 日平台
正式关停，新能力并入 Datasets（OpenAI 官方页面 2026-10）**。

含义比时间线本身重要：连模型厂都把托管 eval 从独立产品降级为
数据集里的一项能力，**评测自建已成行业长期默认，这是最硬的
官方论据（OpenAI 官方页面 2026-10）**，正好呼应本篇主线。该指南仍保留了
可引用的三步法骨架：用 data_source_config 加 testing_criteria
描述任务与 grader、跑 run（JSONL 数据集加 prompt 模板）、分析
迭代，webhook 事件可接 CI，官方自述类似 BDD（先写行为规格再
实现）。页面尾部还留了三条 cookbook 线索，其中「监控线上存储的
补全、周期性当回归集重跑」就是 OpenAI 版的线上闭环。

### 3.3 五平台对照表：只补「要花钱的列」（官方定价页 2026-10）

仓库已有 star 数与自部署对照表，本篇只补定价、留存与合规列。
全部数字为官网现行口径，随时可能调价：

| 平台 | 免费档 | 进阶档 | 留存阶梯 | 自托管形态 | 计费主轴 |
|---|---|---|---|---|---|
| Langfuse | Hobby 免费：5万 units/月、30 天数据、1,000 req/min 摄入 | Core 29 美元/月（90 天数据、无限用户）；Pro 199 美元/月 | 30 天 / 90 天 / 3 年（Pro） | 开源四件套（Postgres+ClickHouse+Redis+S3），企业功能要商业 license | unit＝observation/span 粒度计费，超量阶梯降价 |
| LangSmith | Developer：5k base traces/月 | Plus 39 美元/seat/月；Enterprise 定制 | base trace 14 天 / extended trace 180 天 | Hybrid：SaaS 控制面＋自托管数据面，数据留自家 VPC | seat ＋ trace 留存档位；LSU 统一计量、1 LSU＝1 美元跨全线产品 |
| Braintrust | Starter：1 GB 处理数据＋1万 scores/月、14 天留存 | Pro 249 美元/月（30 天留存） | 14 天 / 30 天，超出按 GB/月计留存费 | 纯 SaaS（Enterprise 有 BAA/HIPAA、S3 自动导出） | 处理数据量＋judge 打分数；score 是独立成本项 |
| Arize AX（Phoenix 开源） | AX Free：2.5万 spans/月、15 天留存、10 issues/月 | AX Pro 50 美元/月（30 天留存、25 issues/月） | 15 天 / 30 天 | Phoenix 开源自部署；AX Enterprise 可 Self-hosted | span 量＋issues 配额制（聚类挖掘直接是计费单位） |
| W&B Weave | 归 CoreWeave 品牌，走 CoreWeave Forge 账户 | 官网定价页 2026-10 无法匿名抓取（403），定价未核实 | 未核实 | Dedicated 实例有独立 OTel ingress URL | 未核实 |

三条能直接引用的定价细节：

- **留存阶梯就是用途分层：30 天调试、90 天复盘、3 年训练数据
  沉淀（langfuse.com/pricing 2026-10）**；LangSmith 的 base/
  extended 两档同一个逻辑——debug 短留、带 feedback 标注的高价值
  样本长留。
- **judge 评测器成本要单列：Braintrust 的 score 按千次计费、
  LangSmith Tuned Evaluator 按次计费、Engine 每轮聚类几十美元
  （官方定价页 2026-10）**——跑 judge 不只付 LLM API，还要付平台钱，
  预算模型里这是独立一行。
- 合规优先级排序：自托管（Langfuse/Phoenix/AX Enterprise）＞
  Hybrid 数据面（LangSmith Enterprise）＞ 纯 SaaS（Braintrust/
  AX Pro/LangSmith Plus）。Anthropic 官方博客在工具附录给 Langfuse
  的定位原话是「给有数据驻留要求团队的自托管开源替代」。

选型话术（2026-10 收口）：纯开源自托管默认 Langfuse；绑死
LangGraph 用 LangSmith（hybrid 数据面是它对合规的解法）；eval-first
迭代文化用 Braintrust；训练推理一体化团队用 Weave。预算粗算示例：
10 人团队月 100 万 span 量级，Langfuse Core 约 101 美元/月，同量
LangSmith Plus 按 seat 起算约 390 美元/月——**价差主要来自计费轴
不同，选型前必须按自家流量结构折算（官方定价页 2026-10 推导）**。

> ▶ 面试题：观测平台怎么选？——**高频**。先抛「分层」答案：自托管
> 开源底座（Langfuse 默认）、LangGraph 生态绑定（LangSmith）、
> eval-first 文化（Braintrust）、训练推理一体（Weave）；再补两刀
> 硬事实（semconv 独立成仓、OpenAI Evals 关停）证明你不是背选型
> 表而是在读行业信号；最后给计费轴折算思路。

## 四、闭环 pipeline：trace → 失败挖掘 → 扩评测集 → 灰度 → 回归监控

仓库 [观测与trace工程](./观测与trace工程.md) §六已有七步数据流骨架
（采样摄入 → 在线评估 → score 挂回 → 确认失败 → 入 dataset → CI
并排对比 → 灰度放量），本篇只补它没展开的三块：失败挖掘的商业化
现状、Anthropic 官方方法论文精读、各厂口径。

### 4.1 失败样本挖掘：规则 / 聚类 / 异常检测三档

- **规则档**：错误 status、turn 数超阈值、token 成本异常、低 judge
  分、用户 thumbs-down、人工接管标记，直接过滤出来。零成本，必做。
- **聚类档**：对低分与失败 trace 的摘要 embedding 聚类，把长尾失败
  压成有限个 failure mode bucket，每个 bucket 分派 owner。这一档在
  2025 到 2026 年已被平台商品化：
  - LangSmith Engine：自动监控 trace、把 agent 行为聚类成 issue、
    诊断代码失败、推荐 prompt 与代码修复、为人工 review 生成
    dataset、创建 online 与 offline eval 防止复发——
    **该引擎每 6 小时自动调度一轮、单次消耗约 7 到 45 美元
    （LangSmith 官方定价页 2026-10）**。
  - Arize AX Signal：聚类结果是直接计费单位，**免费档 10 个
    issues、Pro 档 25 个 issues 每月的配额制（arize.com/pricing
    2026-10）**。
  - Braintrust Loop：自动跑评测、生成测试用例、迭代 prompt 的内置
    agent（Enterprise 档），与 Engine 是同代际产品信号。
  - Langfuse 侧无内建聚类，惯用做法是 scheduled batch export 到
    blob storage 后用自家 embedding 加聚类脚本跑 nightly job。
- **异常检测档**：score 均值、turn 分布、工具错误率这些指标时序
  上的漂移检测，接 [llmops与模型发布专题](../llmops与模型发布专题.md)
  的 PSI 告警三段式，本篇不展开。

面试口径：失败挖掘的商品化本身就是「闭环已是标配」的证据——
落后的团队还在人工翻 trace，头部平台已经把「trace 聚成 issue 并
建议修复」卖成了收钱的产品。

### 4.2 标注 queue：人机混合是定价维度

Langfuse 把 Human Annotation Queues 做成档位卖（Hobby 一个、Core
三个、Pro 不限），LangSmith 有 Annotation queue 加 bulk export，
Braintrust 的 Human review scores 免费档一个、Pro 不限——**人机
混合排队标注工作流被三家平台不约而同做成定价维度，说明它是普适
需求（官方定价页 2026-10）**。工程要点：LLM 标注（judge）打量、
人标（SME spot check）质量；人标样本回流做 judge 校准集、judge
低置信样本回流人标 queue，两条回流是同一个 queue 系统的进出方向。

### 4.3 Anthropic「Demystifying evals for AI agents」精读

anthropic.com/engineering/demystifying-evals-for-ai-agents
（2026-10-12 全文抓取，文中提及 Opus 4.5 与 τ2-bench，发布时点不
早于 2025 下半年）。这是公开渠道目前对 agent 评测闭环最系统的一手
阐述，抓六块：

**六定义先背**。Task（单测题：输入加成功标准）、Trial（一次尝试，
模型有方差所以要多 trial）、Grader（评分逻辑；一个 task 可挂多个
grader、每个含多个 assertions）、Transcript（trial 的完整记录，
等价仓库的 trace）、Outcome（trial 结束时环境的最终状态——agent
嘴上订了票不算，SQL 库里 reservation 存在才算）、Harness（跑 eval
的基建；评 agent 等于评 harness 加模型合起来）。Suite 就是 task
集合。这套术语与 Anthropic 对齐，面试不丢分。

**三类 grader 对照**。Code-based（string match、单测、静态分析、
outcome 与 tool-call 校验、transcript 分析）：快、便宜、客观、
可复现，但脆于合法变体。Model-based（rubric、自然语言断言、
pairwise、reference-based、multi-judge consensus）：灵活可扩展，
但非确定、更贵、必须与人标校准。Human（SME、众包、抽样 spot-
check、A·B、标注员间一致性）：金标，又贵又慢，只用于校准 judge。

**能/否双集制**见 §2.6，九条实战口径里挑面试用得上的：

1. 起步只要 20 到 50 条真实失败任务（§2.6 已列数字锚）。
2. 好任务的判据：两个领域专家独立给出相同的 pass/fail，且存在
   reference solution（证明可解、顺带验证 grader 配置正确）。
3. **前沿模型全题零分时更常意味着题目坏了而不是模型不行
   （Anthropic 2025 官方经验）**——先查任务规格与 grader。
4. Balanced problem set：正例负例都要有。官方案例是搜索引擎触发：
   既要测「该搜」（查天气）也要测「不该搜」（谁创立了 Apple），
   单向评测集只会训出过度调用的 agent。
5. 环境隔离：每次 trial 从干净环境启动，共享状态会导致相关失败——
   官方案例：内部 eval 里模型靠读上一次 trial 留下的 git history
   获得不公平优势。
6. CORE-Bench 惨案单列（§4.4）。
7. 饱和监控：SWE-bench Verified 从 2025 年初约三成刷到 2026 年初
   八成以上逼近饱和，头部进步在小数点后挤——**饱和之后只有噪声
   没有信号，该换题或毕业（Anthropic 2025 口径）**。
8. 读 transcript 是硬纪律：失败必须显得「公平」——说不清 agent 错在
   哪的失败，往往是 grader 错了；**分数不涨时先确认是 agent 问题
   还是 eval 问题（Anthropic 2025 工程纪律）**。
9. 组织形态：专职 evals 团队拥有核心基建，领域专家与产品团队贡献
   大部分任务；拥有并迭代评测应像维护单测一样日常化；离产品需求
   最近的人最适合定义成功——eval 是产品与研究之间带宽最高的通信
   渠道。

**Eval-driven development**：先做「现在还不行、赌模型几个月内行」
的低通过率 capability eval，新模型发布跑一遍立即知道哪些赌注
兑现——这是把评测集当资产配置的打法。

### 4.4 CORE-Bench 惨案：不信字面分数，先读 transcript

官方案例：某前沿模型在 CORE-Bench 初测只有四成二，研究员逐条读
transcript 后查出三类问题——grader 僵化（期望一串长浮点、把四舍
五入后的数值判错）、任务歧义、随机性不可复现；修完 bug、换
scaffold 后**同一模型的分数从四成二跳到九成五
（Anthropic 2025 工程博客）**。同类故事：某时间地平线基准有题
要求「优化到声明的阈值」，判分却要求「超过阈值」，按指令办事的
模型反被惩罚。这条案例是面试里回答「评分手动查什么」的最强弹药：
字面分数只是入口，transcript 才是现场。

### 4.5 瑞士奶酪：六种方法叠起来漏洞才错开

官方六方法优缺点表（面试压轴素材）：

| 方法 | 优势 | 盲区 |
|---|---|---|
| Automated evals | 快、可复现、每次提交可跑 | 前期投入大、会维护漂移、可能与真实使用不符 |
| Production monitoring | 真实分布真值 | 反应式、缺标注真值 |
| A·B testing | 测真实用户结果、控制混淆 | 达显著需数天到数周、有流量门槛 |
| User feedback | 挖出没想到的问题 | 稀疏且自选择、偏重严重问题 |
| Manual transcript review | 建直觉、抓细节 | 不可扩展、评审疲劳 |
| Systematic human studies | 金标多评审 | 贵且慢、复杂域需专家 |

结论句：**没有任何单层能拦住所有问题，只有叠起来让漏洞彼此错开
的瑞士奶酪模型才够用（Anthropic 2025 工程博客）**。阶段映射：
发布前靠 automated evals 做 CI 门禁；上线后靠 production
monitoring 抓分布漂移与意外失败；足量流量后用 A·B 验证大改；
feedback 与 transcript review 常驻；系统性人评留作 judge 校准与
主观输出的金标。

### 4.6 各厂实践口径（含未核实缺口）

- **Anthropic**：§4.3 全量一手；另 2025-06 多智能体博客的「约
  20 条 query 起步、单 judge 单 prompt 打分比多 judge 投票稳」
  已在多agent篇收录，不重复。
- **OpenAI**：Evals 平台弃用时间线与 Datasets 承接（§3.2，一手页面
  实锤）；《A practical guide to building agents》PDF 中的 evals
  章节本批未抓取，引用前需补。
- **Descript 与 Bolt**（Anthropic 博客转引，二手但有官方背书）：
  Descript 按「别弄坏／做我要求的／做得好」三维度建 eval，从人工
  打分演进到 LLM grader 加产品团队定标准加周期性人工校准，维护
  quality benchmark 与 regression 两套 suite；Bolt 在 agent 已
  大规模上线后用约三个月补上评测体系（静态分析判代码、browser
  agent 测应用、LLM judge 测指令遵循）——**后补 evaluation 体系
  三个月可以落地（Bolt 案例，Anthropic 博客 2025 转引）**。
- **Notion 与 Perplexity：未核实缺口**。本批未抓到两家对应的一手
  工程博客证据——Notion 工程博客无可抓取的 evals 专篇（仅有
  LangSmith 官网 case study 营销页，未逐字核实），Perplexity 公开
  材料以产品发布为主、未见评测基建技术文。面试中被追问这两家时
  直接说「没有公开的一手口径」，不要现编数字。

## 五、数字锚：成本、质量、漂移三组

### 5.1 评测也要单独算账

模型单价与 cache 折扣锚在 [观测与trace工程](./观测与trace工程.md)
已全（Sonnet $3/$15 per MTok 等，2026-10），本篇只补闭环特有的
三笔账：

1. **judge 成本独立成行**：Braintrust 把 score 做成计费单位（每千次
   1.5 到 2.5 美元档位）；LangSmith Tuned Evaluator 按次约 0.015
   LSU；Engine 每 6 小时一轮 7 到 45 美元——跑 judge 要同时付
   LLM API 与平台费。
2. **观测量身成本按平台计费轴折算**：100 万 span/月量级，Langfuse
   Core 约 101 美元/月 vs 同量 LangSmith Plus seat 计费约 390
   美元/月起——先按自家 trace 结构折算再选型（§3.3）。
3. **token 监控语义锚**：gen_ai.usage.input_tokens 是摄入事实，
   成本等于 usage 乘自维护单价表；tokenizer 换版同文本 token 数
   可漂移约三成（2026-10 教训，仓库已录）。

### 5.2 质量指标锚

- 任务完成率：outcome 判定的 pass 率；用户面看 pass^k（七成五的
  三次方约四成，§2.4）。
- 人工接管率：客服与运维 agent 的北极星之一；版本间应单调下降，
  但警惕「降接管率」过拟合出不敢升级人工的 agent——接管本身是
  正确行为时要给它算对分。
- 交互质量三元组示例（Anthropic 客服案例）：ticket resolved
  （状态断言）＋ max_turns 约束（轨迹硬边界）＋ tone rubric
  （judge 主观分）。
- 过程指标只 track 不判分：turn 数、工具调用数、总 token、TTFT、
  output 吞吐、time to last token（Anthropic tracked metrics 清单）。

### 5.3 评测体系的三种漂移

1. **输入分布漂移**：PSI 阈值 0.1 等默认值，见 llmops 篇。
2. **judge 漂移**：judge 模型版本升级，同题同答分数变——对策是
   judge 版本化加月度人标复校（§2.2）。
3. **评测集腐化**：题目被模型训练数据污染、或被团队成员过拟合
   prompt——对策是 capability eval 饱和即 graduate 加补新难题，
   以及 Live 滚动集思路（agentic评测基准专题已录）。
**三类漂移要拆开监控，混在一起看分数损失一整个维度
（本仓综合口径 2026-10）**。

## 六、▶ 面试题 8 条（含压轴话术）

**Q1【压轴】你的 agent 上线后，怎么知道它变好了？** 三层收敛骨架：

- 第一层「变化前有门禁」（offline）：每次 prompt、模型、代码变更
  必跑离线评测——capability suite 给爬坡信号、regression suite
  接近满分防回退；grader 用 deterministic 加校准过的 LLM judge
  组合，judge 与 prompt、模型、dataset 一起版本化；CI 并排对比
  新旧版本指标，超阈值拦截。关键话术：评 outcome 不评 path，过程
  指标只 track 不判分；新版 judge 先对 100 到 300 条人标 gold
  校准到八成 agreement 再上岗。
- 第二层「上线后有信号」（online）：全量 trace 摄入（OTel
  gen_ai 系字段），在线 eval 采样打分加 thumbs 反馈加规则异常；
  按模型版本、prompt 版本、feature flag 分桶看趋势；失败 trace
  聚类成 issue（可买：Engine 每 6 小时自动聚类、AX Signal 按
  issue 计费；可自建 embedding 聚类 nightly job），确认真失败
  一键进 dataset；灰度窗口看 score 降幅、token 成本增幅、p95。
- 第三层「回路会校准」（loop）：固定节律读 transcript（失败必须
  显得公平）；人标回流校准 judge、judge 低置信回流人标 queue；
  capability eval 饱和即 graduate；输入、judge、腐化三类漂移分开
  监控。收口一句话：**没有单层拦得住所有问题，离线门禁管已知、
  线上监控管真实分布、A·B 管用户结果、人评管金标校准，叠起来
  漏洞错开才算知道它变好了（瑞士奶酪模型，Anthropic 2025）**。
- 加分弹药（随口引用）：OpenAI Evals 平台 2026-11-30 关停（评测
  自建是行业默认）；OTel gen_ai 2026 独立成仓并纳管 MCP；
  CORE-Bench 四成二跳九成五说明不信字面分数要先读 transcript。

**Q2【高频】LLM-as-judge 有哪些偏差，怎么缓解？** 四偏差清单逐个
配缓解（位置→换位双评、冗长→rubric 声明长度不计分、自我抬高→
盲评加跨家族、推理受限→reference-guided）；收口一致性超过八成、
达到人际标注一致性水平（MT-Bench 论文，NeurIPS 2023 D&B），再加
2024 后自我偏好有可测指标（NeurIPS 2024，细节见 §7 未核实项）。

**Q3【高频】pass@k 和 pass^k 区别什么情况下报哪个？** pass@k 至少
一次成功、pass^k 全部成功；七成五单次的 k 等于 3 时一个报满分
乐观、一个只剩四成。工具类报 pass@k、面向用户的 agent 报 pass^k；
给指标前先问产品形态（Anthropic 2025）。

**Q4【高频】评 agent 的轨迹还是评结果？** outcome 为主：只判环境
终态加少量硬约束；过程指标全部降级为 tracked metrics 监看不做
grader；「必须调用过某工具」写成状态断言而非评整条路径；多组件
任务给 partial credit。理由是按固定 tool 序列判分对 agent 的合法
新路径过度脆弱——τ2-bench 订机票案例是给面试官的具象素材。

**Q5【中频】线上失败样本怎么回流成评测集？** 三档挖掘（规则必做、
聚类已商品化、异常检测接漂移监控）→ 标注 queue 双回流（LLM 打量、
人标注校）→ 真失败入 dataset → 新版本离线门禁通过 → 灰度判定
三要素（score、成本、p95）→ 回灌。追问「你们用什么挖」时直言：
规则档先做，聚类档可以买（Engine、Signal、Loop 三选一）也可以
用 Langfuse batch export 加自家脚本。

**Q6【中频】观测平台怎么选？** §3.3 收口话术：按自托管、生态绑定、
eval-first、训练一体四条线分流；再按计费轴（unit vs seat vs
score vs issues）按自家流量折算预算；最后抛两个 2026 硬事实
（semconv 独立成仓、OpenAI Evals 关停）证明在读行业信号。

**Q7【中频】评测集越建越大分数却不动了怎么办？** 先判是饱和还是
漂移：eval 被刷到接近满分是信号枯竭（graduate 成 regression 并
补新难题，参照 Verified 三成刷到八成以上的轨迹）；分数原地不动
先读 transcript，先确认是 agent 问题还是 eval 问题——CORE-Bench
案例说明修 grader 能把四成二变成九成五。

**Q8【低频但加分】评测这件事的组织形态怎么做？** 专职 evals 团队
拥有核心基建、领域专家与产品团队贡献大部分任务；把评测当单测
一样日常维护；capability eval 先行下注、新模型发布立刻兑现
（eval-driven development）；业务同学也能以 PR 方式贡献 eval
task——离产品需求最近的人最适合定义成功（Anthropic 2025 组织
口径）。

## 七、口径与未核实说明

一手已核验（2026-10-12 抓取）：OpenTelemetry semantic-
conventions-genai 仓 README 与旧址 404 重定向；langfuse.com/
pricing、langchain.com/pricing、braintrust.dev/pricing、
arize.com/pricing 四个定价页全文；weave-docs.wandb.ai 首页与限制
项（确认 CoreWeave 品牌与 Forge 账户体系）；Anthropic工程博客
「Demystifying evals for AI agents」全文；developers.openai.com
evals 指南页（弃用横幅与三步法）；arXiv:2306.05685 摘要页（四大
偏差与超八成一致率）。

未核实项（正文引用均已标口径）：Liusie et al. 2024 自我偏好论文
细节（未抓取一手正文，只引用「可量化」级别结论）；OpenAI《A
practical guide to building agents》PDF 的 evals 章节（未抓取）；
**这两家的评测与观测闭环实践（Notion、Perplexity，无公开一手
工程博客，属未核实缺口，正文不作数字断言）**；Descript 与 Bolt 案例源自
Anthropic 博客转引，二手。

抓取失败记录：wandb.ai 官方定价页返回 403（Weave 定价未核实）；
cookbook.openai.com 的监控线上补全页面 404（URL 需从指南页内链
重取）。

## 串联阅读

- 前置：分层评估与黄金评测集、LLM-as-Judge 一句话工程要点、CI
  门禁五层 → [多agent与评测](./多agent与评测.md)
- 前置：OTel 承载与 gen_ai 属性清单、trace 设计七节、线上 eval
  闭环七步 → [观测与trace工程](./观测与trace工程.md)
- 前置：SWE-bench 谱系、τ-bench 的 pass^k 出处、榜单治理 →
  [agentic评测基准专题](./agentic评测基准专题.md)
- 相邻：HumanEval pass@k 无偏估计与评测口径题 →
  [评测题专项](../评测题专项.md)
- 相邻：影子、金丝雀、A·B 发布与 PSI 漂移监控 →
  [llmops与模型发布专题](../llmops与模型发布专题.md)
- 相邻：grader 要落地必须懂 harness 结构 →
  [harness工程实战](./harness工程实战.md)
- 场景化：把本篇的闭环跑一遍全链路视角 →
  [场景全链路trace](./场景全链路trace.md)
