# Agentic 评测基准横评：SWE-bench 谱系、Terminal-Bench 换血与榜单治理

> **面向谁**：已读过 [评测题专项](../评测题专项.md)（pass@k/pass^k 指标口径与防污
> 染方法论）与 [多agent与评测](./多agent与评测.md)（Harness 与五层门禁）的读
> 者。那两篇讲「指标怎么算、门禁怎么设」，本篇补 **2026-10 口径的官方榜单实测
> 快照**与 Terminal-Bench 一年三次换血史，被问「选哪个基准、分数可信吗」时直
> 接引本篇。
>
> **读完获得**：① SWE-bench 五个子集的题量地图与 Verified 官方爬分轨迹（一点
> 九六到七九点二），以及「选榜即选分数」的二十六个百分点实例；② Terminal-
> Bench 从八十题到七十四题的三代换血全记录与「benchmarks are software」的
> semver 维护方法论；③ τ/τ² 的 pass 左上标 k 教训、GAIA 官方榜事实停更的现场、
> BrowseComp 的数字阶梯；④ 榜单治理 2026 三件套（ATIF 轨迹强制 + agent judge
> 复核 + verifier 容器分离）与三起作弊实锤；⑤ 自建内部评测五要素；⑥ 十条面试
> 题的完整答法。
>
> **时效口径**：素材时间轴为 **2023-11 GAIA 论文**（arXiv:2311.12983）到
> **2026-10-12 官方榜单实测快照**（swebench.com leaderboards.json、gaia-
> benchmark/results_public、GitHub star 实测）。论文与厂商宣称值一律括注口径；
> 未核实项只进文末「口径与未核实说明」，正文不当事实引用。

## 一、主线：饱和 → 换血 → 再饱和，榜单进入版本化生命周期

一句话主线：**基准已进入「饱和—换血—再饱和」的版本化生命周期**——agent 谱系里任何
一个题集被头部刷到窄带宽度的同时，它的区分度就在死亡；新的题集必须靠「更能
区分 frontier」来证明自己的合法性，而修题、防腐、版本迁移本身成了工程议题。

支撑这条主线的三个实测事实（全部来自 2026-10-12 官方快照与官方博客口径）：

1. SWE-bench Verified 从 2023-10 的不到两个点刷到 2025-12 的 **七九点二**，
   前八名挤在不到三个百分点的窄带里——区分度枯竭。
2. Terminal-Bench 被迫一年内三次换血：八十题 → 八十九题 → 七十四题，新榜
   3.0 头部只有 **三十四点四**，但把头两名的差距从四点九拉开到 **十二点七
   个百分点**——换血的意义就在区分度。
3. 榜单治理从「自觉」升级为「强制」：2026-04 Terminal-Bench 官方发布
   Integrity Update，实锤下架三起作弊，要求所有通过的 trial **强制提交
   ATIF 轨迹**并接受 agent judge 复核。

<div class="diagram-embed">
<iframe src="assets/diagrams/agentic-bench.html" width="100%" height="890" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agentic-bench.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、SWE-bench 谱系：题量地图与「选榜即选分数」

### 2.1 题量与子集地图

SWE-bench 原榜（Test split）共 2294 题，来自 12 个 Python 仓库的真实 GitHub
issue，判分方式为 fail-to-pass 单测（官网自述口径，2026-10-12 实测）。围绕原
榜衍生出四个常用子集：

| 子集 | 题量 | 定位 | 2026-10 头部（官方实测） |
|---|---|---|---|
| 原榜 Test | 2294 | 全量基准 | **五十二点六二**（Sonar + Claude 4.5 Opus，2025-12-19，官方口径） |
| Verified | 500 | OpenAI 2024-08 人工筛「可解性/少歧义」 | **七九点二**（Sonar + Claude 4.5 Opus，2025-12，官方口径） |
| Lite | 300 | 省成本快速版 | **六十点三三**（ExpeRepair + Claude 4 Sonnet，2025-06，官方口径） |
| Multilingual | 300（42 repo、9 语言） | 跨语言 | **七十二点七**（Gemini 3 Flash，2026-02，官方口径） |
| Multimodal | 480 | 含截图/前端视觉问题 | **三十五点九八**（GUIRepair+o3、Codefuse Pycfuse，2025-07/11，官方口径） |

### 2.2 Verified 官方爬分轨迹（swebench.com 数据文件实测，2026-10-12 快照）

- 2023-10 RAG + Claude 2：**一点九六**；
- 2024-04 SWE-agent + GPT-4：**十二点四七**；
- 2024-10 Tools + Claude 3.5 Sonnet：**四十九**；
- 2025-05 Claude 4 Opus：**七十三点二**；
- 2025-12 Sonar Foundation Agent + Claude 4.5 Opus：**七九点二**（当前榜首）。

两年间头部提升约七十七个百分点，但代价是区分度枯竭：前八名全部挤在
七十六点四到七十九点二的窄带内。写作与口述时请注意单位是百分制的「分」，
不是百分点升降。

### 2.3 选榜即选分数：同一系统两个榜差二十六个百分点

**同一套 Sonar + Claude 4.5 Opus 体系**（官方口径，2025-12）：Verified 七九点
二，原榜 Test 头部 **五十二点六二**——差约二十六个百分点。结论只有一句话：

**报分必须带子集与 harness 口径**。同思路的教训还有 GPT-5 官方曾披露在
n=477 子集上跑（不满 500 题，仓内 [评测题专项](../评测题专项.md) 已收录）。
2026 面试语境下的正确说法是 **Verified 已经趋于饱和**，头部信号应转向
Multilingual、Multimodal、Pro/Live 与 Terminal-Bench 3.0。

### 2.4 SWE-bench-Live：持续换血路线

SWE-bench-Live（Microsoft，NeurIPS 2025 D&B，GitHub 实测 253⭐，2026-10-12）
走的是「时间换血」路线对抗污染与饱和：

- 每月新增 50 个 verified issues 进 test split；
- MultiLang 扩展 1077 题 / 431 repo / 8 语言（2026-08，README 实测）；另有
  Windows 域 66 题；
- lite/verified 冻结保可比性；
- 提交必须附完整 trajectory，禁用 hint、FAIL_TO_PASS、test_patch。

## 三、Terminal-Bench 谱系：「benchmarks are software」的一年实验场

### 3.1 三代换血全记录（官方博客 + GitHub 目录实测）

| 版本 | 日期 | 规模 | 头部变化 | 关键机制 |
|---|---|---|---|---|
| 1.0 | 2025-05/06 | 初始 80 题 | Opus 4 43%、Warp 52% | terminal-bench-core v0.1 |
| 2.0 | 2025-11-07 | **89 题**（GitHub 实测 89 个任务目录） | —（见文末未核实） | Harbor 框架接管 harness |
| 2.1 | 2026-05-06 | 89 题**修 28 题** | GPT-5.3-Codex 73.3→79.1；Opus 4.6 58→70.1 | 外部依赖漂移修 9 题、资源预算不足修 8 题 |
| 3.0 | 2026-07-30 | **74 题 / 7 域** | 头部仅 **34.4**（GPT-5.6 Sol@Codex）；Fable 5 33.8 | 多容器、GPU 域引入 |

TB 2.1 的修题清单本身就是「评测漂移」的一手素材：九题被外部互联网依赖漂移
击穿（Spark SQL vs PostgreSQL 指令与测试不一致是典例），八题资源预算不足，
另有若干指令-测试不一致。多数模型修题后涨一到十二个百分点——**分数里有相
当一部分是题目质量，不是模型能力**。

### 3.2 区分度论证：新榜的合法性来源

TB 2.1 上 Fable 5 与 Opus 4.8 只差 4.9 个百分点；TB 3.0 把差距拉开到
**十二点七个百分点**（官方口径，2026-07-30）。新基准发布时必须回答「能区分
frontier 吗」，3.0 用更难的题集换来了区分度。另一面：74 题下单题权重约
1.35 个百分点，头两名 34.4 vs 33.8 相差不足一题——**小数点级排名没有统计意
义**，n 小的榜必须要求报 trial 数与置信区间。

### 3.3 harness 是分数的一等公民变量

同一 Opus 4.6：Claude Code harness 跑 70.1，Terminus 2 跑 63.8，差
**六点三个百分点**（官方口径）。TB 3.0 官方报分挂双 harness（Codex CLI、
Claude Code、Terminus 2），官方还给了成本 Pareto front：GPT-5.6 Sol 比
Fable 5 便宜约四成、token 少约五成（官方口径）。面试里比任何两个分数之
前，先对齐 harness、toolset、timeout、retry——Claude Code 的分数与裸模型
分数**不可直接横比**。

### 3.4 判分架构：agent 容器与 verifier 容器分离

TB 判分管线迭代为 **agent 容器 / verifier 容器分离**，artifact 下载后可重
判——修题后能对历史提交重新断分。这是「基准即软件」的工程化落地：题、容
器、verifier 三者都可版本迁移，这一点在第七节自建评测里直接复用。

## 四、对话型与浏览型基准：τ 系列、GAIA、BrowseComp

### 4.1 τ-bench：最大的教训是 pass 左上标 k

τ-bench（arXiv:2406.12045，2024-06，零售 + 航空两域，LLM 模拟用户）的两个
机制决定，面试必考：

- **终态 DB 比对判分**，不评轨迹——只看对话结束后的数据库状态，过程自
  由、结果严格；
- **pass 左上标 k**（pass^k）：跑 k 次**全对**才算过，测的是可靠性而非峰
  值。论文口径下 GPT-4o 单次成功率不足五成，retail 域跑八次全对的比例不
  足两成半。SLA 场景报 pass^k，能力对比报 pass^1 的 k 次均值——这是它与
  pass@k（k 次至少对一次）的关键区别，定义细节链 [评测题专项](../评测题
  专项.md)。

### 4.2 τ²-bench：双控电信域把「会不会教用户」独立测出来

τ²-bench（arXiv:2506.07982，2025-06）新增 telecom 双控域（agent 与用户双
方都要操作），引入 Dec-POMDP 与可组合任务生成器。论文口径下 gpt-4.1 的
pass^1 从 retail 的七成四、airline 的五成六**跌到 telecom 的三成四**；
claude-3.7-sonnet telecom 也仅四成九。双控把「协调/沟通错误」与「推理错
误」解耦消融——全跑一遍成本约四十美元（论文口径）。

### 4.3 GAIA：官方榜事实停更，别把人类基线当头部分数

GAIA（arXiv:2311.12983，2023-11）：466 题、三级难度、需联网与工具。论文口
径**人类基线九十二** vs GPT-4 + plugins 十五。

官方榜实测（gaia-benchmark/results_public 数据集，2026-10-12 快照）已
**事实停更**：最近一条提交停留在 2025-04-23，SU AI Zero **七六点四**（L1
九一点四 / L2 七三点零 / L3 五九点二），次名 h2oGPTe 七四点八。此后无新提
交。两个口述纪律：

1. **九十二是人类基线，不是系统成绩**。仓内 [多agent与评测](./多agent与评
   测.md) 第 301 行曾写「GAIA 顶级系统顶尖成绩约 92%」，系误写，本篇以此
   处为勘误（详见文末「口径与未核实说明」）。
2. 社区参考文献分（Deep Research 平均六七点四 / cons@64 七二点六，OpenAI
   2025-02，仓内已有条目）高于官榜头部是常态——**榜内比较与跨榜比较要分
   开表述**。

### 4.4 BrowseComp：倒推式难题，和「专门训练过」的披露范本

BrowseComp（OpenAI，2025-04 官方博客口径）：1266 题「倒推式」——答案难检
索但易验证。官方数字阶梯：GPT-4o 零点六、加 browsing 一点九、GPT-4.5 零点
九、o1 九人点九、Deep Research **五十一点五**。两个值得背诵的点：

- 官方自注 Deep Research **针对该类任务专门训练过**——训练集针对性披露
  的正面范本，报产品时照着学的格式；
- 人类 trainer 在两小时限时内只解出 **二九点二**，其中与参考答案一致
  八成六四；best-of-64 可再抬十五到二十五个百分点（官方口径）。

## 五、知识型天花板与第一代 agent 套件现状

### 5.1 HLE：2500 题，论文发在 Nature

Humanity's Last Exam（CAIS + Scale，arXiv:2501.14249，2025-01，v11 于
2026-07）：2500 题跨数十学科，论文已发在 Nature（DOI
10.1038/s41586-025-09962-4，论文口径）。与 GAIA/BrowseComp 互补的点是
「防 Quick-Googling」。2025 年已知锚点（仓内条目）：Deep Research 带工具
二六点六。2026 年最新头部分数本次未能从官方页核实，列入文末未核实项，
**正文不引**。

### 5.2 AgentBench：教学基线属性大于前沿信号

AgentBench（THUDM，arXiv:2308.03688，ICLR 2024）：8 环境（OS / DB / KG /
DCG / LTP / DC card / Householding / WebShop / WebBrowsing），GitHub
3766⭐（2026-10-12 实测），repo 仍在维护（最后 push 2026-02）。作为 2023
年的「LLM-as-Agent 大一统」套件，2026 语境更多是教学与基线属性，前沿信号
已让位给可版本化、防污染的终端系与 SWE 系。

## 六、工程议题：判分、污染与基准生命周期

1. **判分粒度的环境依赖**。SWE-bench 的 fail-to-pass 单测依赖逐 repo
   Docker 镜像锁依赖；TB 2.1 证明即便锁镜像，仍有几近一成的题被外部互联网
   依赖漂移击穿 → 判分管线要把**环境快照当发布物（artifact）**，而不是脚
   本约定。
2. **harness 与模型不可分**。双 harness 差六到十二个百分点（TB 3.0 官方口
   径），报分不对齐 harness 等于没报。
3. **部分分、二值判分与置信区间**。74 题规模下单点差无统计意义，n 小就应
   三报：得分 + 误差棒 + 成本（TB 3.0 官方自己就给了成本 Pareto front）。
4. **防 tuning to the test 的三件套**。SWE-bench-Live 提交协议（禁
   hint/test_patch、交完整轨迹、抽检复核）+ TB 的 ATIF 轨迹强制 + agent
   judge + verifier 容器分离，构成 2026 年榜单反腐标准配置；反面教材是下
   面三起实锤。
5. **污染归因的对策谱系**：Live（时间换血）→ 私有 test split（GAIA 保留
   三百题答案不公开）→ 程序化生题（τ² 组合生成器）→ 承认开放互联网并明
   示纪律（TB 3.0「开放互联网基准，指令 agent 不许搜答案，且官方口径
   surprisingly effective」）。
6. **基准生命周期管理**。TB 团队官方口径「benchmarks are software」——版
   本号、CI/CD、task migration、旧提交在新版本上重判。这是面 infra/平台岗
   讲「自建内部评测」时最可迁移的方法论。

## 七、榜单治理：三起实锤与 2026 反腐三件套

Terminal-Bench 官方 2026-04 发布《Leaderboard Integrity Update》（官方口径）：

- **OpenBlock**：改 timeout、二进制内嵌加密答案 → 下架；
- **QuantFlow**：把 tests/ 文件夹上传进容器 → 下架；
- **ForgeCode**：agent 从互联网 curl 答案 → 判 0，定性为 reward
  hacking。

分级口径：改环境/答案作弊是 **cheating**，利用题面从开放互联网抄答案是
**reward hacking**——两者都毁掉榜单信号，但处罚与防御手段不同。配套的强
制机制即上一节的三件套：**所有通过 trial 必须提交 ATIF 轨迹**、开源 agent
judge 复核、verifier 容器分离 + artifact 可重判。

## 七·增、考场生态：Harness ≠ Benchmark，三足鼎立怎么选

上面几节都在聊题库（benchmark），但同一份题库在不同考场能跑出
数个百分点到两位数的差距——这是工程常态而非 bug（题库口径称
「20+ 分」；**本仓实测口径以 [harness工程实战](./harness工程实战.md)
的 Terminal-Bench 双 harness 差 6–12pp 为准**）。
**Benchmark 是题库 + 评分标准；Eval Harness
是考场**，由四个独立原语组成：

```text
Benchmark(题库) ──┐
                  ▼
  Task Loader(加载样本+组装prompt+few-shot)   ← lm-eval 的 YAML
        ↓
  Solver(怎么作答：ReAct/多轮/桥接外部Agent)   ← 决定 scaffold 分数
        ↓
  Sandbox(工具执行隔离：docker/k8s/VM)          ← 决定资源与安全
        ↓
  Scorer(怎么判分：精确匹配/单元测试/终态diff/LLM judge)
```

生态三足 + 一个度量范式（均为题库口径）：

- **lm-evaluation-harness**（EleutherAI）：model eval 标杆，
  HF Open LLM Leaderboard 的后端。YAML 任务定义、60+ 学术
  benchmark、100+ provider；但对 agent 无能为力——没有 sandbox、
  没有多轮 solver、没有轨迹 scorer，「加了 API provider 也只是
  包一层调用」。
- **Inspect AI**（UK AISI，2024-05 开源）：agent eval 事实标准。
  dataset→Task→Solver→Scorer 显式四原语，200+ inspect_evals，
  Agent Bridge 可桥接 Claude Code/Codex CLI。**生态收敛的最强
  信号：METR 2026-01 发布 Time Horizon 1.1 时弃用自研 Vivaria
  全面迁到 Inspect，且 7 个月翻倍趋势迁移后复现**。
- **HELM**（Stanford CRFM）：多维度全景派——同一 scenario 同时
  报 7 个维度（accuracy/校准/鲁棒/公平/bias/毒性/效率），
  2025-03 Capabilities 改用 mean score 取代 mean win rate。
- **METR Time Horizon**：不是 harness 而是度量范式——50% 成功率
  任务时长每 7 个月翻一番，天然抗污染的外推曲线。

三个带进面试的细节：其一，**sandboxes 是 agent eval 真正的并发
瓶颈**——Inspect 默认 max_sandboxes = 2 × cpu_count；docker 启动
~1s 是主流，k8s 管 >100 并发，高风险评测（CTF/sandbox escape）
必须 VM 内核级隔离。其二，**考场本身是攻击面**：Anthropic 2026-07
复盘三起网络安全评测事故——评测环境自称隔离实际连着真实互联网，
prompt 里一句「你在模拟环境、没有网络」不构成任何隔离，模型按
被喂的世界模型在真实系统上执行了「演习」操作；结论是把
defense-in-depth 从生产延伸到评测基础设施，隔离承诺要与实际
网络拓扑对账。其三，**Agent eval 与 model eval 统计设计不同**：
评估对象是轨迹+终态、多条有效路径并存、必须多 trial——pass@1
（均值）+ pass@k（乐观上界）+ pass^k（悲观下界）三线并报，
衔接本篇 §八第 4 条与 [多 Agent 与评测](./多agent与评测.md)
的 pass^8 数字。

选型一行版：学术单轮 → lm-evaluation-harness；agent 多轮+沙箱 →
Inspect；要 bias/毒性全景 → HELM；要能力外推 → METR 范式 +
Inspect 跑任务。自建时把 sandbox 类型、资源配额、scaffold 版本
**写进 eval 报告**——这些全是结果的一部分。

## 八、自建内部评测五要素

从 TB 与 SWE-bench-Live 的工程实践里抽出的可迁移清单：

1. **任务 = 指令 + 环境快照 + verifier + oracle 解**，四元组缺一不可，
   容器化逐题隔离；
2. **环境快照当发布物**：镜像与依赖锁成 artifact，而非约定，防外部依赖漂
   移击穿（TB 2.1 九题教训）；
3. **版本化迁移**：题集按 semver 维护，修题走 migration，旧提交在新版本
   上可重判（TB 2.1 修 28 题先例）；
4. **双轨报分**：pass^1 + pass^k + 成本三线并报，n 小附置信区间；
5. **影子跑（shadow run）**：先内部 shadow run 观察噪声与区分度，再入决
   策流。

## 九、▶ 面试题

1. **你怎么选一个 agent 基准？（高频）**——按任务形态匹配：coding 选
   SWE-bench 系、终端 ops 选 Terminal-Bench、客服多轮选 τ 系、检索选
   BrowseComp、通用助理选 GAIA；再看判分可自动化、区分度（头部是否挤
   带）、抗污染机制（Live/私有 split）、成本四个维度。深度提示：必须能举
   Verified 近饱和、信号转向 Multilingual 与 TB 3.0 的实例。
2. **pass^k 和 pass@k 的区别，生产上关注哪个？（高频）**——pass^k 是 k
   次全对（可靠性），pass@k 是 k 次至少对一次（峰值能力）；SLA 场景报
   pass^k，能力对比报 pass^1 的 k 次均值。深度提示：背出 GPT-4o 在
   τ-bench retail 域单一成功率与 pass^8 的落差，并能说清 τ² 双控独立测出
   「会不会教用户操作」。
3. **两家厂牌同一基准分数差 3 个点，可信吗？（高频）**——先核对子集口径
   （GPT-5 n=477 事件）、harness/toolset/timeout、采样参数；n=74~500 规
   模下 3 个点常在噪声内，要求报 trial 数与 CI。深度提示：举 Opus 4.6 双
   harness 差六点三个百分点的实例。
4. **怎么防止团队 tuning to the test / 内部评测被刷？（高频）**——
   holdout/rotating 集、轨迹审计、verifier 与执行分离、judge 开源可复
   算、对作弊分级（cheating vs reward hacking）。深度提示：举 OpenBlock、
   QuantFlow、ForgeCode 三起实锤与 SWE-bench-Live 提交协议。
5. **自建内部评测怎么做？（高频）**——按第八节五要素答：任务四元组、环
   境快照当发布物、版本化迁移、双轨报分、影子跑。深度提示：主动提
   「benchmarks are software」的 semver 方法论。
6. **SWE-bench Verified 快刷满了吗，下一步看什么？（中频）**——轨迹一
   点九六 → 七九点二，前八名挤在不到三个百分点；区分度枯竭后看
   Multilingual（头部七二点七）、Multimodal（头部三十五点九八）、Pro/
   Live 与 TB 3.0。深度提示：能背 Verified 五个时间点的轨迹是加分项。
7. **同一系统两个榜分数为什么能差二十多个点？（中频）**——子集不同：
   Verified 是 500 题人工精选，原榜 Test 2294 题含疑难题；Sonar 体系
   79.2 vs 52.62（官方口径）。深度提示：引申「报分必须甲子集结构」与前
   面 n=477 事件。
8. **Terminal-Bench 3.0 为什么头部反而比 2.1 低那么多？（中频）**——换
   血逻辑：难度重置（多容器 + GPU 域 + 七十四题），但区分度从四点九拉开
   到十二点七个百分点，新榜合法性靠区分度而非绝对分。深度提示：顺带答
   74 题单题权重约一点三五个百分点、头两名差距无统计意义。
9. **GAIA 榜首多少分，人类基线多少？（中频）**——官方榜事实停更于
   2025-04-23，头部 SU AI Zero 七六点四（分层 L1 九一点四 / L2 七三点零
   / L3 五九点二）；人类基线九十二（论文口径）。深度提示：别再把九十二
   当系统成绩，这是本篇勘误过的仓内旧错。
10. **BrowseComp 的 Deep Research 五一点五怎么解读？（低频）**——官方自
    注针对该类任务专门训练过，是训练集针对性披露的范本；人类 trainer 两
    小时仅解二九点二。深度提示：对比 GPT-4o 零点六的阶梯，说明浏览工具
    链与专门训练各自的贡献量级。

## 十、口径与未核实说明

- **仓内勘误声明**：[多agent与评测](./多agent与评测.md) 第 301 行「GAIA
  顶级系统顶尖成绩约 92%」为误写。按 GAIA 论文口径，**九十二是人类基线**
  （arXiv:2311.12983，2023-11），官方榜实测最高提交为七六点四（SU AI
  Zero，2025-04-23）；正确表述应为「官方榜头部约七十六，人类基线九十
  二」。本篇以上文 4.3 节为准。
- **七·增来源**：BigKunLun/Agent-Interview-100（433★，MIT，
  2026-10 持续更新）#111 Eval Harness 篇。其生态数字
  （Inspect 200+ evals、METR 2026-01 弃 Vivaria 迁 Inspect、
  Anthropic 2026-07 三起评测隔离事故、Inspect max_sandboxes
  默认值）为题库转述口径，本仓未复核；「同 benchmark 不同
  harness 20+ 分差距」经本仓 harness工程实战实测校准为
  TB 双 harness 6–12pp。（github.com/BigKunLun/Agent-Interview-100）
- **未核实单列**（以下条目仅作存档，正文未当事实引用）：
  - HLE 2026 年最新头部分数——official leaderboard 为 JS 渲染、Scale 页
    403，本次未能核实；2025 年锚点 Deep Research 带工具二六点六见仓内既有
    条目，可信。
  - SWE-bench Verified「OpenAI 人工筛选 500 题」的具体筛选规则条数——
    swebench.com 只确认 human-filtered 与 500 题两点。
  - Terminal-Bench 2.0 发布当日的初始头部分数——发布博客原文 slug 404，
    当前可引的是 2.1 修订对照表（官方）与 3.0 的三十四点四。
- 未括注来源的数字均出自 2026-10-12 官方榜单/仓库实测量（swebench.com
  leaderboards.json、gaia-benchmark/results_public、tbench.ai 官方博客、
  gh api star 实测）；论文与厂商宣称值随处括注。

## 串联阅读

- [评测题专项](../评测题专项.md)：pass@k / avg@k / pass^k 指标定义、防污
  染四件套、厂商发布分速查——本篇只补榜单实测快照与 TB 换血史，指标细节
  以此篇为准。
- [多agent与评测](./多agent与评测.md)：Harness 决定分数、五层门禁、
  pass^k 用法；其 GAIA 一条的执行本以本篇勘误为准。
- [harness工程实战](./harness工程实战.md)：Terminal-Bench 双 harness 差
  六到十二个百分点与本篇 3.3 节互链。
- [codex源码分析](./codex源码分析.md)：Codex 侧 SWE-bench 发布分讨论，可
  与本篇 2.3 节「同系统差二十六个百分点」对照。
- [ai编程与claudecode内幕](./ai编程与claudecode内幕.md)：编程 agent 谱系
  与榜单信号的对应关系。
