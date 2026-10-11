# LLMOps 与模型发布专题：Registry、发布策略谱系与底座升级治理

> **面向**：准备去面「大模型平台 / MLOps / AI Infra」方向、会被追问「你们模型
> 怎么上线的」「OpenAI 通知模型下线你怎么办」的读者。建议先读
> [推理服务slo与运营](./inference/推理服务slo与运营.md)（线上怎么扛）与
> [观测与trace工程](./agent/观测与trace工程.md)（线上怎么看），本篇讲的是
> 中间缺失的那一环——**怎么发、怎么灰、怎么滚**。
>
> **读完获得**：① 一句话直觉「管确定性代码 → 管概率性行为」与每环多出来的
> 「行为」维度；② Registry 格局 2026 实测（MLflow 弃 stage 改 alias、Langfuse
> stars 反超、W&B 归入 CoreWeave 品牌）与自建 registry 的真实坑；③ 发布策略
> 谱系（影子/金丝雀/蓝绿/A·B/flag）按「流量真实可见性」的排序话术与双平面
> 架构；④ 三类事故对应的三档回滚与「硬指标全绿」事故模式；⑤ 监控漂移三层、
> Evidently 默认值与告警三段式；⑥ 底座升级五步 runbook（含 OpenAI 官方退役
> 通知期与 fine-tune 随基座消亡的硬约束）；⑦ 四维版本化元组与原子回滚；
> ⑧ 8 条带频率标注的面试题完整答法。
>
> **时效口径**：素材实测于 **2026-10**，stars 数取 gh api 当日值；OpenAI 退役
> 政策取 platform.openai.com/docs/deprecations 现行页面；MLflow/W&B/Evidently
> 取官方 docs 当日版本。社区实践与推导值一律括注，未核实项见文末「口径与未
> 核实说明」。

## 一、直觉一句话：从管确定性的代码，到管概率性的行为

传统软件发布管的是**确定性的代码**：同一份二进制、同一输入、同一输出，挂了
有 stack trace，健康检查能兜住绝大多数事故。LLM 发布管的是**概率性的行为**：
同一权重加同一 prompt 还有采样方差，「服务没挂」和「模型变笨了」之间隔着
一大片传统监控完全看不见的地带——没有 5xx、延迟正常、GPU 利用率正常，但
拒答率悄悄翻倍、格式合规率掉了五个点。

所以 LLMOps 的每一环——注册、灰度、监控、回滚——都比传统 MLOps 多出一层
「行为」维度：registry 里除了权重还要登记 prompt 与 config 的版本；灰度观察
窗里除了错误率还要喂 judge；回滚除了回权重还要能秒回 prompt。把 LLM 发布
当成「重一次的传统发布」来做，是新手平台第一个月必踩的坑。

数字锚先收拢一张总表（全部 2026-10 实测或官方现行口径）：

| 锚点 | 数字 | 口径 |
|---|---|---|
| MLflow | 28,342 stars，v3.17.0（2026-10-07） | gh api / 官方 release |
| Langfuse | 35,643 stars，已反超 MLflow | gh api 2026-10 |
| wandb | 11,274 stars，SDK v0.30.0（2026-09-09） | gh api / 官方 release |
| Evidently / Arize Phoenix | 8.0k / 11.8k stars | gh api 2026-10 |
| Argo Rollouts / Flagsmith | 3,595 / 6,592 stars（OpenFeature spec 仅 1.3k） | gh api 2026-10 |
| OpenAI 退役通知期 | GA ≥6 个月 / chat 变体 ≥3 个月 / preview 短至 2 周 | 官方 deprecations 页 |
| Argo 金丝雀官方示例 | 10% → pause 1h → 20%；maxSurge、maxUnavailable 默认各 25% | 官方 docs |
| 社区金丝雀阶梯 | 1% → 5% → 25% → 50% | 社区实践口径 |
| Evidently 漂移默认 | PSI 0.1；KS/chi2 p-value 0.05；drift_share 0.5；文本 domain classifier ROC-AUC 超 0.55 判漂移 | 官方 docs |

<div class="diagram-embed">
<iframe src="assets/diagrams/llmops-release.html" width="100%" height="790" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/llmops-release.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、Registry 与模型生命周期

### 2.1 五段式生命周期

一个模型权重的平台旅程是固定的五段：**训练产出 → 注册（绑定 run 与
lineage）→ 灰度 → 全量（alias 指向切换）→ 退役**。面试里问「你们模型生命周期
怎么管」，能一口气把五段说出来，并且每段配一个你平台里的真实组件名，这条
问题就过关了。记住两个设计要点：

- 注册不是「把文件拷进对象存储」，是写入一条元数据：(name, version,
  artifact_uri, lineage, tags)。lineage 要能从权重反查到训练 run、数据快照
  与代码 commit，否则事故复盘时连「这版是谁训的」都答不上来。
- 全量切换的本质不是「部署新版本」，是**改一个命名指针**。理解了这一点，
  下面的 alias 之争就顺理成章。

### 2.2 Registry 格局 2026：MLflow 弃 stage，Langfuse 吃掉 prompt 空档

**MLflow 仍是 model registry 的事实标准**（28,342 stars，2026-10 实测），但
3.17（2026-10-07）已把重心全面转向「面向 agents 与 LLMs 的 AI engineering
platform」。最重要的架构决定是：**官方弃用 Staging、Production、Archived
三阶段模型，改用 alias（如 @champion）加 tag**（main 分支 docs 标注 will be
removed in a future major release）。

stage 为什么必须死：stage 是**全局单值互斥**——一个版本同时只能挂一个
stage，这表达不了「租户 A 的生产用 v3、租户 B 的生产用 v5」。alias 是可变
命名指针，天然支持 per-tenant 指针（@champion-tenantA），回滚就是把
@champion 重新指回旧版本，**秒级、可审计**。这个「全局单值 vs 可变指针」的
对比是面试标准答案，顺带把多租户发布也答了（见第七节）。

W&B Registry 走另一条路：Artifact 版本化 → link 进 collection → webhook 触发
下游 CI/CD，治理做在 collection 级 RBAC 上；W&B Server v0.71.0 起 Registry
默认开启。值得注意的是 wandb 文档站已挂在 CoreWeave Docs 品牌下（W&B 被
CoreWeave 收购，2025 年新闻口径，细节见文末）。MLflow 和 W&B 有一个共同的
盲区：**它们都不是为「prompt 是一等公民」设计的**。这正是 Langfuse 涨起来
的核心空档——35,643 stars（2026-10 实测）已反超 MLflow，它管 prompt 版本
与 trace，但不管权重 lineage。

一句话记住三方分工：**权重在 registry，prompt 在 prompt 管理工具，config 在
flag 平台**，三件套靠 release manifest 缝在一起（第七节展开）。能画出这张
分工图而不是脱口报一个工具名，才像真做过平台选型。

### 2.3 自建 registry 的真实坑

自建模型 registry 本质是一张元数据表加对象存储，写起来一周，坑全在运营期：

1. **大 artifact 的存储与 GC**：百 GB 级权重的版本堆积、过期清理、冷热分层，
   对象存储账单会教你做人。
2. **promote 权限与审计**：真正把 platform team 难住的不是表结构，是「谁有
   权限把 alias 指向生产」。promote 必须走审批加审计，这一步没有捷径。
   注意 MLflow OSS 自建**没有企业级 RBAC**（官方文档说明 RBAC 依赖
   Databricks 等托管后端），要权限治理就得自己糊一层。
3. **跨 region 同步延迟**：alias 已切但海外集群还是旧权重，「发布完成」和
   「全球生效」是两个时间点，发布系统要暴露这个差距而不是假装它不存在。
4. **与 CI 签名、合规扫描的集成**：金融、政企场景权重进生产前要签名与扫描，
   这一步最好卡在 promote 审批流里，而不是事后补票。

### 2.4 Registry 与推理服务的耦合方向

registry 怎么把版本送到推理集群，两个方向各有代价：

- **正向拉取**：推理服务启动或收到通知后从 registry 拉 alias 指向的权重。
  可控性好，但 70B 级模型加载是分钟级，冷的副本起不到「秒级回滚」的作用。
- **反向推送**：registry 侧把变更推给集群分组。时效好，但要处理分组灰度、
  失败重试与版本一致性。

所以「秒级回滚」的真实前提是**旧版副本热备**——这是成本问题，不是技术
问题。Argo Rollouts 金丝雀期间 stable 保持 100% 副本（官方默认，可用
dynamicStableScale 优化）正是同一逻辑在 K8s 层的体现。

## 三、发布策略谱系：先拆双平面，再谈策略

### 3.1 双平面：LLM 场景的第一刀

LLM 应用的发布要一刀切成两个平面：

- **基础设施面**（模型权重、推理引擎版本）：走金丝雀、影子、蓝绿，旋钮是
  流量比例，回滚是 alias 重指向，成本是 GPU 副本。
- **应用面**（prompt、system message、工具 schema、routing 规则、config）：
  走 feature flag 加灰度，旋钮是配置下发，回滚是配置回退，成本接近零。

两个平面旋钮不同、回滚成本不同，**混在一个 pipeline 里是新手最常见的架构
错误**。支撑这一刀的核心原则是：**改 prompt 不需要重新部署**——网关层把
prompt 渲染与模型调用解耦，prompt 从配置中心或 prompt 管理工具按版本拉取，
trace 里打上 prompt_version 标签，线上任何一个请求都能说出「它跑的是哪一版」。

### 3.2 策略谱系（按流量真实可见性排序）

**影子流量（shadow / mirror）**：复制真实流量打给新版本，结果不返回用户，
只记录对比。这是 LLM 场景最有价值的一档——可以做离线 diff（新旧输出
pair-wise judge），**零用户风险**。代价是双倍推理成本，GPU 贵的时候只对
采样流量做（1%–5%，推导值）。两个已知边界：影子看不到真实交互反馈（用户
后续轮次不会发生），所以 **Agent 场景影子只能测首轮**，多轮 replay 还要面对
外部世界状态已变的一致性问题。

**金丝雀（canary）**：权重阶梯放量。Argo Rollouts 官方示例是 10% 放量后
pause 一小时再到 20%，社区常见阶梯是 1% → 5% → 25% → 50%（社区实践口径）。
LLM 特有的坑是**观察窗的统计瓶颈**：5% 流量乘以低 QPS，一小时只有几百条
完整 session，judge 分差两三个点在统计上根本不显著——比传统 HTTP 错误率
信号慢一个量级。所以低 QPS 场景的金丝雀定位要诚实：**主要防大回归，防不了
小回归**；要抓小回归，要么拉长观察窗，要么加影子流量喂评估（成本翻倍），
要么承认只看硬阈值。

**蓝绿（blue-green）**：全量切换加旧版热备。成本最高（双倍 GPU），但底座大
版本切换——比如推理引擎大版本升级、PD 分离架构切换——常用它，因为切流
必须原子，半新半旧的混合状态不可接受。

**A/B 实验**：和金丝雀长得像，目的完全不同。金丝雀验证「没挂」，A/B 验证
「更好」；后者需要随机化单位（按用户或 session sticky 分流）和统计显著性
设计，把它当金丝雀跑是方法论错误。

**Feature flag / prompt 灰度**：prompt、system message、工具 schema、routing
规则都不进权重发布管道，走配置中心加 flag。标准化看 OpenFeature（CNCF
标准，spec 仓库仅 1.3k stars，但 Flagsmith 6,592、Unleash 系已经很成熟）；
产品化看 Langfuse Prompt Management、LangSmith prompt hub——它们把 prompt
做成带版本标签的一等公民，正是补 MLflow/W&B 的盲区。

## 四、回滚与事故

### 4.1 三类事故，三档回滚

| 事故类型 | 回滚手段 | 时效 | 附带动作 |
|---|---|---|---|
| 模型回归（SFT 后某类 case 变坏） | registry alias 回指旧版本 | 秒级 | 同时失效语义缓存与 KV 预热，否则旧行为还有残留 |
| Prompt 回归（改 system prompt 后拒答率飙升） | flag 回滚到旧 prompt 版本 | 毫秒级 | 无需重启——这正是「prompt 不该硬编码进镜像」的核心论据 |
| 配置回归（temperature、max_tokens、超时） | flag 回退 | 毫秒级 | 注意 config 变更可能触发 SDK with-retry 行为差异，重试放大的流量要一起评估 |

### 4.2 触发指标分两层，硬指标全绿是常态

触发回滚的信号要分两层看：

- **硬指标**（秒到分钟级）：5xx、TTFT/TPOT、GPU 利用率、排队深度。它们回答
  「服务活着吗」。
- **软指标**（分钟到小时级）：judge 分、拒答率、规则五件套——格式合规、
  长度、敏感词、工具调用合法性、引用一致性。它们回答「模型还聪明吗」。

事故复盘的共性教训值得背下来：**几乎每次「模型质量事故」，事后查硬指标都
是绿的**。模型行为回归不触发任何传统告警，只能由输出质量监控发现——这
决定了监控的钱必须花在软指标那半边（下一节）。

## 五、监控与漂移

### 5.1 三层漂移，各管一段

1. **输入漂移**：线上流量分布偏离训练/评测分布。检测用 domain classifier
   （AUC 超 0.55 判漂移）或 embedding 质心距离。
2. **输出漂移**：长度分布、语言分布、拒答率、工具调用分布的形态变化。这层
   与软指标监控重叠，用规则五件套全量跑就够。
3. **embedding 漂移**：检索场景查询向量分布 vs 建库时分布的偏离。它影响 RAG
   召回但不体现在对话监控里，得单独盯。

### 5.2 Evidently 默认值：起点而不是标准

Evidently（8.0k stars，2026-10 实测）的默认参数可以直接当起点：PSI 阈值
0.1；KS/chi2 p-value 0.05；drift_share 0.5（半数列漂移即判定数据集漂移）；
文本场景默认走 domain classifier 路线，ROC-AUC 超 0.55 判漂移（需超 1000
样本）。要能说清代价：domain classifier 路线意味着**你要为每一次对比训练
一个新旧样本二分类器**，这本身是模型活，不是纯统计活。

### 5.3 告警三段式

LLM-judge 在线监控只能跑采样（常见 1%–10% 流量，推导值），所以告警设计是
三段式：**规则五件套全量跑 + judge 抽样跑 + 周期性全量离线评估**。听到有
方案声称「judge 实时拦截」，追问两句就能拆穿：要么 judge 弱到便宜，要么
采样率低到不敢宣。

### 5.4 embedding 模型变更是数据面变更

换 embedding 模型等于换索引，属于**数据面变更而不是模型发布**，必须走独立
流程：重建索引、双索引灰度、按租户切读。把它塞进 LLM 发布管道，两种风险
会互相污染——对话质量回归时你分不清是模型的锅还是索引的锅。

## 六、底座升级治理：2025–2026 最大的发布工程课题

### 6.1 先立两条铁律

**第一条：生产必须 pin 快照版本，永远不碰 -latest。** -latest 是供应商手里
的可变指针，静默漂移意味着你的「没发布」其实是供应商替你「发布了」，所有
的事故归因、回归集对照全部失效。

**第二条：把供应商的退役时间表当容量规划的一部分。** OpenAI 官方现行政策
（2026-10 实测）：GA 模型至少提前 6 个月通知、chat 变体至少 3 个月、preview
可能只有 2 周。近期实例：gpt-5-2025-08-07 于 2026-12-11 关停；gpt-4o-2024-05-13
于 2026-10-23 关停；chatgpt-4o-latest 已于 2026-02-17 关停。

更狠的一条是 **fine-tune 模型随基座一起消亡**：2026-04-22 公告，ft-gpt-4 随
gpt-4-0613 于 2026-10-23 关停。这对「自训 vs API 微调」的选型是硬约束——
你在别人基座上微调出来的资产，寿命由别人决定。

### 6.2 迁移 runbook 五步

每次基座退役公告触发同一条固定流程：

1. **公告即建 ticket**：离 shutdown 还有 3–6 个月，排期按倒排做。
2. **回归集先跑**：用沉淀好的 prompt 回归集（历史 badcase 加核心业务 case，
   几百到几千条量级）在新基座上跑 snapshot 评估。任何生产系统都必须有这
   套可重复执行的流程，没有就先补这一课。
3. **judge 对齐校准**：judge 模型本身也要 pin 住版本，换了底座更要重新用
   人工标注对对表——升了基座又顺手升了 judge，分差就解释不了了。
4. **影子流量 diff 一到两周**：真实输入上对比新旧输出，pair-wise judge。
5. **按租户分批切流**：别一把全切，先内部租户、再小客户、再核心客户。

### 6.3 工具链供应链风险

2026-11-30 OpenAI 将关停 Evals 平台与 v1/prompts（reusable prompt）API，
官方迁移路径指向 Promptfoo。这个事件的教训比事件本身值钱：**绑死单一
供应商的评测/发布工具链本身就是供应链风险**。回归集要存在自己的仓库里，
评估 harness 要可移植（Promptfoo、自研、开源 CI 均可），prompt 资产要有
导出机制。

### 6.4 prompt 版本化的边界争议

prompt 引用的 few-shot 示例、RAG 模板、工具 schema、模型名常量，算不算
prompt 的一部分？工程上的正确答案是**全算**，理由来自最常见的一类线上
事故：「prompt v7 配了 model X，但 v7 的格式约定是给 model Y 写的」。把
prompt 与其格式约定绑进同一个 release manifest，这类事故直接清零。

## 七、四维版本化：多租户平台的发布单元

多租户平台的发布单元不是「模型」，是**四维元组**：base_model × LoRA ×
prompt_version × config_hash。缺任何一维的版本化，都会出现「回滚了但行为
没变」的经典事故——模型回了、prompt 没回，半吊子状态比不滚更难排查。

落地三要点：

- **整体快照**：四维必须一起写进 release manifest，一次发布一个 manifest，
  回滚必须**整组原子回滚**。
- **per-tenant alias**：用 @champion-tenantA 这类租户级指针，而不是全局
  alias——这正是 MLflow 弃 stage 改 alias 的同一套逻辑（全局单值表达不了
  多租户）。
- **LoRA 热切换的缓存污染**：vLLM/SGLang 的多 LoRA serving 把热加载成本打
  下来了，但 KV cache 的前缀缓存必须按 LoRA 隔离，否则租户 A 的缓存会被
  租户 B 的 LoRA 前缀污染。（LoRA serving 细节见
  [多lora-serving专题](./inference/多lora-serving专题.md)。）

## 八、▶ 面试题 8 条（带频率标注）

**Q1【极高】你们模型怎么上线的？**
从 registry alias 切换讲到推理副本预热，标准链路：训练产出注册 → alias 灰度
阶梯（1% → 5% → 25% → 50%，社区口径）→ 观察窗达标 → 全量切流。能说出
「70B 权重加载分钟级，所以 stable 保持 100% 副本热备」的是实操过。追问
「金丝雀期间观察什么指标」：硬指标一层（5xx、TTFT/TPOT、排队深度）、软
指标一层（规则五件套加 judge 抽样），judge 采样率与成本各报一个量级。终极
追问「5% 金丝雀流量下 judge 分差多少你敢全量」——正确答案是**看样本量和
置信区间，低 QPS 下金丝雀主要防大回归而非小回归**（§3.2），答不出这条的
可判定没有发布工程经验。

**Q2【极高】prompt 变更要不要走和模型变更一样的发布流程？**
答案是**分级**：system prompt 大改属于行为变更，走回归集评估加灰度；措辞
微调只走 flag 加观察。深挖三连：prompt 版本存哪（prompt 管理工具，带版本
标签）、谁能 promote（审批流）、线上怎么知道当前生效版本（trace 打
prompt_version 标签）。能主动说出「prompt 与模型的格式约定必须绑在同一个
release manifest 里」的，踩过「v7 的格式约定是给 model Y 写的」这种坑
（§6.4）。

**Q3【极高】OpenAI 通知 6 个月后 gpt-xxx 下线，你作为平台 owner 做什么？**
三条主线：① 生产 pin 快照不碰 -latest（§6.1）；② 可重复执行的迁移
runbook——回归集 → snapshot 评估 → 影子 diff → 按租户分批切流（§6.2）；
③ judge 模型本身也要 pin 并重新对人工标注校准。加分项：提到 2026-11-30
Evals 平台与 v1/prompts 一起退役、官方迁移指向 Promptfoo（§6.3），以及
fine-tune 模型随基座消亡对「自训 vs API 微调」选型的影响（§6.1）。

**Q4【中高】影子流量和金丝雀你怎么选？**
影子不担用户风险，但双倍成本、且看不到真实交互反馈（多轮场景没有后续
轮次）；金丝雀有真实反馈，但样本量小、回滚时已经伤害了真实用户。推荐
**两段式**：高风险或低 QPS 场景先影子后小比例金丝雀。强信号两个：主动
指出「shadow 只能测首轮，Agent 多轮一致性测不了」；指出 Agent 场景 replay
的外部状态一致性本身是难题（§3.2）。

**Q5【极高】线上质量事故，硬指标全绿但用户投诉变多，排查路径？**
这是「LLM 事故不触发传统告警」的核心考点（§4.2）。路径四步：trace 采样
人工抽查 → 规则五件套分维度下钻（哪个租户、哪个 prompt 版本、哪类工具
调用的拒答率升了）→ 对照发布时间线定位变更——权重、prompt、检索库、
工具 schema，四维里到底是哪一维（§7）→ 回滚该维度并验证。防御闭环：发布
门禁加金丝雀加软指标分层告警，badcase 沉淀进回归集。

**Q6【中高】多租户平台，租户 A 要基座 X 加 LoRA a，租户 B 要基座 X 加 LoRA b，发布和回滚怎么设计？**
主答四维版本化：发布单元是 (base_model, LoRA, prompt_version, config_hash)
元组，发布与回滚都整组原子（§7）。进阶三点：per-tenant alias（@champion-
tenantA）替代全局 alias；LoRA 热切换时前缀缓存按 LoRA 隔离防污染；多 LoRA
serving 的热加载成本在 vLLM/SGLang 已经打下来了（见
[多lora-serving专题](./inference/多lora-serving专题.md)）。能说到「整组
快照、整组原子」即达标。

**Q7【中】model registry 自建还是买？边界在哪？**
先把三方盲区说清：MLflow OSS 自建没有企业级 RBAC；W&B Registry 核心在
Artifact 版本化，prompt 不是一等公民；Langfuse 管 prompt 与 trace，不管权重
lineage（§2.2）。结论形态是**组合拳**：权重与 LoRA 在 registry，prompt 在
prompt 管理工具，config 在 flag 平台，release manifest 缝三件。只报一个
工具名的答案直接露怯。

**Q8【中高】评测 gate 的阈值怎么定？**
没有银弹数字，正确框架是**基线锚定**：新候选必须在回归集上 non-regression
（不低于当前线上版本，允许统计波动带），且主指标提升显著才放行。judge 分
当门禁的前提是 judge-human agreement 用人工标注对校准，未达标前 judge 分
只能参考。反模式要会骂：裸报绝对阈值（比如 judge 分大于 0.85 才放行）而
无基线对照——换一批 case、换一个 judge，0.85 就是另一把尺子。

## 九、口径与未核实说明

- **MLflow stage 弃用起始版本**：记忆口径是 2.9.0（2023 末），本次只核到
  main 分支 docs（2026-10）明确标注 deprecated 且 3.x 主推 alias；正文按
  「官方已弃用 stages，现状主推 alias 加 tag」表述，不写起始版本号。
- **W&B 被 CoreWeave 收购**：本次核实到 docs.wandb.ai 已以 CoreWeave Docs
  品牌呈现；收购宣布约在 2025 上半年，属新闻与社区口径，金额与交割日期
  未核实。
- **金丝雀配比 1%→5%→25%→50%：**社区实践口径；官方可核实的只有 Argo
  示例（10% 到 20%）与默认值（maxSurge、maxUnavailable 各 25%）。
- **judge 监控采样率 1%–10%、告警三段式的时延分层**：推导值加行业通行
  做法，无官方标准化数字；正文的可用表述是「按成本与时效 trade-off 自定，
  典型分钟级规则加小时级抽样 judge 加天级全量」。
- **评估 gate 阈值**：无行业统一标准，Q8 给的是方法论而非数字。
- **影子流量采样比例 1%–5%：**推导值。
- **GPT-4 → 4o 迁移期 OpenAI 内部灰度策略**：无公开资料，不臆测。

## 串联阅读

- [观测与trace工程](./agent/观测与trace工程.md)：trace 打 prompt_version 标签、
  judge 抽样评估的工程实现——本篇 §3.1、§5.3 的监控闭环在这篇落地。
- [评测题专项](./评测题专项.md)：回归集怎么建、judge 怎么校准、显著性怎么
  算——本篇 §6.2 的 snapshot 评估与 Q8 的基线锚定都依赖这套评测口径。
- [多lora-serving专题](./inference/多lora-serving专题.md)：S-LoRA 四件套与前缀
  缓存按 LoRA 隔离——本篇 §7 四维元组中 LoRA 维度热切换的引擎侧细节。
- [推理服务slo与运营](./inference/推理服务slo与运营.md)：TTFT/TPOT 与排队深度
  的 SLO 拆解——本篇 §4.2 硬指标层的预算从这篇来。
- [设计大模型统一接入网关](../system-design/设计大模型统一接入网关.md)：把本篇
  的双平面、四维版本化、prompt 渲染与模型调用解耦，放到一道完整系统设计
  题里组装一遍。
