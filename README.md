# offer-is-all-you-need

[![GitHub stars](https://img.shields.io/github/stars/backtraxe/offer-is-all-you-need?style=flat-square)](https://github.com/backtraxe/offer-is-all-you-need/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/backtraxe/offer-is-all-you-need?style=flat-square)](https://github.com/backtraxe/offer-is-all-you-need/network/members)
[![在线文档](https://img.shields.io/badge/docs-GitHub%20Pages-blue?style=flat-square)](https://backtraxe.github.io/offer-is-all-you-need/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

> Attention 买不到 offer，但这个 repo 可以。

**摘要**：We propose a simple but effective repository, `offer-is-all-you-need`,
based solely on 面试经验，dispensing with 运气 and 玄学 entirely.
Experiments show that it achieves SOTA performance on the "拿 offer" benchmark.

📖 **在线文档站**：[backtraxe.github.io/offer-is-all-you-need](https://backtraxe.github.io/offer-is-all-you-need/)
（GitHub Pages + docsify 渲染，含侧边栏导航、全文搜索；架构图全为可缩放
交互大图，见 `assets/diagrams/`；仓库根目录 `index.html` + `_sidebar.md` 即站点配置）

---

## 这是什么

Agent 开发与 AI Infra 方向的面试备战仓库，记录我在求职季的面经、八股整理、
系统设计笔记和 coding 真题。持续更新，直到上岸为止（上岸之后看心情更不更）。

**本仓库的两种读法**：

1. **当课程读（有重点）**——侧边栏顶部「★ 必读主线」是约 15 篇的正文（分
   Agent 线 / Infra 线，按序），配 [学习路线图](resources/学习路线图.md)
   的 12 周日历推进，每周干什么写得很死。
2. **当词典查（不怕散）**——其余 100+ 篇是按需查阅的专题库。查知识点用
   [interview-questions/README](interview-questions/README.md) 的
   「五列关联总索引」（知识点→考频→专题→手撕→面经案例），查考题用
   [高频面试真题汇总](interview-questions/高频面试真题汇总.md)，查公司风格用
   [面经合集速查表](interview-experiences/小红书社招面经合集-2026h2.md)。

「散」是设计如此：面试前夜你要的是 5 分钟定位到一家公司的一类题，
不是一门顺序课。但主线永远只有一条，先把 ★ 啃完再谈查漏补缺。

## 刷完你能得到什么

- 高频考点成体系——从「什么是大模型」到 PD 分离、GRPO、显存公式
  手撕，约 15 篇主线 + 100 余篇词典式专题，知道 how 也知道 why。
- 22 家公司的出题信号——面经合集主信号总表里，每家公司考什么、
  怎么追问都有实据（多帖互证、标注口径）。
- 一套可执行的行动系统——12 周日历、投递策略、模拟面试模考卷、
  挂后复盘四步法，不只管「学什么」也管「怎么上岸」。
- 面试感的手撕能力——coding 篇按真实考频排序，GRPO Loss、
  蒸馏 KL、KV 显存公式都有从零手推版。

## 最近更新

- 2026-10-17：抖音具身批——VLA 赛道首采十一轮——抖音「具身智能
  面试」关键词换轨首发 19 卡，图文本地 Vision OCR 逐张还原：具身
  三厂 51 问全录（银河通用 18/智元 18/小鹏 15 问，VLA+RL 深水区
  交叉：π0.5 baseline、流匹配推导、GRPO、RL 照搬 LLM 的局限，
  DAgger/LAPA/UMI/RTC/姿态四元数名词五件套）；专题补强一处——
  具身专题新增三厂实题包（名词五件套原全仓零覆盖、具身面复用 LLM
  栈四题实锤：QKV 与 KV Cache、手写 Flow Matching、GRPO、
  actor 与 critic 设计）；1166 赞传统控制题库=LLM 背景转具身的
  硬门槛（MPC/滑模/鲁棒/事件驱动/集群）；行情对仗（7180 赞数据
  来源科普×4407 赞避雷×锐评「具身泡沫最大」）；宇树三轮务实反
  八股卡；主表并入 5 条新信号+导航行更新
- 2026-10-17：追新首扫批——两定点降级与 rag 双真缺口——对 GitHub
  巡检批新登记的两定点做当晚首扫：jingtian11/EasyOffer 实为停更仓
  （2025-03 后无实质推进，主打 DeepSeek 手写实现），Junvate/
  LLM-Algorithm-Intern-Guide 仓库 2026-03 后无 push 且正文托管飞书
  外链（Git 追踪不到）——两仓降级静态参照、撤销「月度追新定点」；
  同扫新增 km1994/Awesome-LLM-Interview（千面郎君 2026-10-11 新建
  国册，README 50 万字符量级、RAG 160 题+30 目录）登入新锐雷达；
  题面抽查出两条真缺口补入 rag 双篇：检索与混合召回新增 §3.3
  学习式稀疏检索 SPLADE（MLM 头出「词项-权重」稀疏向量、术语扩展、
  落倒排保可解释——「BM25/学习式稀疏/稠密」三路升级答法；ECIR
  2021 标题级），rag全链路新增 §3.4 加餐 Late Chunking（先整篇
  embed 再按边界池化，全文语境进块向量、跨块指代不失义——「把
  边界问题从切分侧挪到表示侧」当第 5 板斧；Jina 2024 标题级）；
  两条口径均为标题级注、arXiv 编号未复核
- 2026-10-17：GitHub 巡检批——新锐雷达扩容与偏见检测真缺口补齐——
  gh API 直查四组关键词 40+ 候选仓，三仓深评扩容学习资源清单 1.6
  新锐雷达五行：Imironman123/llm-interview-notes（15 仓溯源聚合，
  字节 11 篇面经按岗位成册——豆包 Seed、搜索推荐、Agent 平台、
  TikTok、飞书、AI Infra、安全治理、推理优化、教育 AI 共 97 问；
  全仓逐一查重结论：题面全部已在本仓专题射程内，反证字节题单高度
  模板化）、datawhalechina/llm-algo-leetcode（★695 大模型算法与
  系统可运行 Notebook 教程，架构演进/后训练/推理/性能/算子五
  路线）、wanshuiyin/ARIS-in-AI-Offer（★602 双语 35 快查卡，每卡
  公式推导+from-scratch PyTorch+25 高频题）、jingtian11/EasyOffer
  与 Junvate/LLM-Algorithm-Intern-Guide（聚合仓点名更新频繁，列为
  真题月度追新两定点）；唯一内容真缺口「大模型偏见检测与缓解」（字节
  安全与治理岗真题，全仓原零覆盖）补入 agent安全与防护·合规快答节
  ——测得出（公平性评测集、分人群与表述形态均衡采样、成对差分探针、
  公平性维度独立出分）×缓解三层（数据层措辞中立化、训练层反事实
  增强与无害性权重单列、服务层 guardrail 拦截与人工抽审）×口径收束
  （可测量可收敛按维度分层报告，接 §九·增 EU AI Act 非歧视条款）；
  其余 30+ 新号自建小仓多为卖课引流型，信号弱未录
- 2026-10-17：微信公众号尾部目录三轮批——旧会话 31 篇存量文章
  URL 考古重扫（30 页正文抓回），19 条尾部目录+全部页标题全仓查重，
  唯一真缺口 TileRT 溯源吸收：小米 MiMo×TileRT UltraSpeed（8 卡
  通用 GPU 跑 1T MoE 突破 1000 tokens/s，声明不走 Cerebras 晶圆级/
  Groq 片上 SRAM 专用路线）官方博客披露。cuda与kernel专题新增
  §5.3+ TileRT 常驻执行模型标本——单算子生命周期进微秒级后算子
  边界失效：RMSNorm/RoPE/KV 写入等外围细碎开销成主瓶颈、MTP 每层
  LM Head 几十微秒已拖累端到端；三板斧＝常驻内核（全链路持续预取，
  寄存器→SMEM→GMEM 提前流动）+ Tile 级流水线（搬运/计算/通信芯片
  内重叠）+ Warp Specialization 与 Heterogeneous Worker；与 §5.2/
  5.3 收束三层正交话术：融合消 kernel 内访存、CUDA Graph 消 launch、
  常驻内核消执行边界；codesign 两件配套＝MoE-Expert-only MXFP4+QAT、
  DFlash 块级并行 draft。投机解码2026专题补 MiMo×DFlash 实测口径
  （draft 全 SWA 常数算力、Muon 二阶优化器+自蒸馏、mask 块限 8、
  mask 信号下沉 GPU 本地分片单步数万级独立信号、实测接受长度 Coding
  6.30/Math 5.56/Agent 4.29 每轮 8 个吞 6-7 个、通用对话尚低——
  并行块 draft 要选块状性强的场景）。查重结案：DCP 解码上下文并行、
  Megatron bitwise 确定性训练、12 阶 GEMM/MI355X、FastH3、TensorFold、
  NVFP4、Mojo、Cerebras、Groq 等 30 篇存量与尾部条目全部已被既有
  专题覆盖；旧批「TileRT 无一手材料移出队列」至此闭环入库
- 2026-10-17：小红书「大模型校招」关键词十轮批——面经合集新增
  二十六节。腾讯大模型算法岗实习双面全录（255 赞：一面 14 题
  Agentic RL 深水区连问——多轮工具 RL loss 设计、GSPO 改进、OPD
  reverse KL、二面 13 题线上系统归因——归因拆解、时延埋点、交付后
  监控，手撕 MHA 追问 transpose 与 contiguous；评论区确认 LLM Judge
  要看 Observation、实习 offer、项目穿插八股）；后训练 20 余场
  24 问总结帖 OCR 全录（242 赞：Agentic RL 11 问、Rubric RL 6 问、
  训练工程 7 问）；27 届十月中旬开奖小结（17 家进度+人才计划名册
  筋斗云/北斗/云弧/KStar/飞星/TStar；评论区阿里硬卡学历、筋斗云
  对价规则、转正挂教训）；锐评各算法岗 96 评论五信号（infra 惨烈
  ×具身泡沫×AIGC 凉×Agent 最多×门槛通胀）；联想卖课帖评论区
  当庭打假实锤；小米帖查重为十九节同帖跳过。专题与资源四处补强：
  agentic-rl专题 §6.8 user simulator（原全仓零覆盖）、rl奖励设计
  Rubric 六问快答块；手写attention 追问区补 transpose/contiguous
  双连问；投递与offer实战新增人才计划名册与三条硬口径；主表并入
  9 条新信号+导航行更新
- 2026-10-17：抖音「LLM 面试 大模型」关键词九轮批——本地 Vision OCR
  逐张还原图文帖，面经合集新增二十五节。字节豆包大模型应用岗校招
  9 题全录（2 天新帖：RAG 深挖链——chunk 混合切分、多片段冲突三层
  处理、评测四维与幻觉率口径；ReAct 无限循环治理；手写 Agent 状态
  机五步循环；豆包知识库系统设计六模块五风险）；米哈游开发一面
  13 题全录（1007 赞：Reward-Bench 奖励模型四分类、DPO 改进五方向
  与输出长度漂移五解法、指令跟随四套集三类评估、AlphaGo 三件套、
  推理 vs 指令跟随能力分层判断题；评论区信号：题目跟着简历走、
  35k+ 难度评价、八股复用论）；同面经 8 天内两号换名搬运实锤，
  「打包打折」口径再验证；视频卡信号：研学姐 Agent 8 问（3734 赞）
  与 Transformer 7 问（205 赞）题单趋同、RAG 过时论标题级叙事。
  四专题同步补强：rlhf与对齐 §四增补（DPO 实战块）、rl奖励设计
  §5.5·增（Reward-Bench 四分类，arXiv:2403.13787 已核）、
  经典rl地基 §6.3（AlphaGo 案例锚）、评测题专项 §3.5（IFEval
  arXiv:2311.07911、FollowBench arXiv:2310.20410 已核）；主表并入
  10 条新信号，并顺手清扫上一批 NZ/FlowMatching「待补」的陈旧标记
- 2026-10-17：面试信号驱动补缺批——两个面经挖出的零覆盖主题溯源
  后落仓（小红书二十四节信号驱动）：国产芯片栈专题新增 §六·增
  NZ 权重布局（Fractal_NZ 分形排布：FP16/BF16 16×16、FP32 16×8、
  INT8 16×32（N0=16/K0 随 dtype）、整矩阵 (H1×W1) 分形列主序；
  三层答法——为什么存在（Cube 单元 16×16 微核吞吐对齐）、布局
  与量化是正交轴但落地打包出现（NZ 分形容器 × 逐块 scale）、
  A5 MXFP4 不能照搬 H20 的本质是「块 scale+分形」数据通路绑定
  而非数字精度、MX 规格块=32；口径标注 CANN 8.0RC1 多源转述）；
  diffusion 专题新增 §3.2·增 Flow Matching 公式两分钟版（插值
  路径 x_t=(1−t)x_0+t·x_1、条件速度场 u=x_1−x_0、CFM 回归损失、
  ODE 采样与 SDE 对照；reflow 把直「练出来」；PCM=arXiv:2405.18407
  LCM 三缺陷分阶段改进、与商汤面经帖口径互证）——与既有 3.2
  「直线流 28 步」叙事和 Q5 生产组合三件套公式级补全
- 2026-10-17：小红书八轮调研批（webbridge 实抓 6 帖+评论区深挖，
  面经合集新增二十四节，主表按唯一事实源规则并入 7 条新信号）——
  拼多多 AI infra 一面 33 题全录：「禁 PPT 考临场」流程信号、
  昇腾 A5(950DT)×H20 迁移对比 22 连问成新题块(NZ 权重布局全仓
  零覆盖已排队)、电商业务链 11 题含 TTFT/TPOT/吞吐×CTR/CVR/GMV
  翻译题与「多优化叠加如何判断收益」，评论区 infra 入行窗口
  收窄行情；海外 RS/RE 六题型帖(340 赞)：AI-assisted coding 成
  今年新面试形态(自带 coding agent+题目超人手极限)、ML sys design
  六段式、Mistral 二轮 DDP dataloader/packing 楼中楼爆料；商汤
  AIGC 一面(评测三件套/Flow Matching/LCM/PCM+面试官建议转图像
  视频加速，Flow Matching 全仓零覆盖排队)；蔚来训练 infra 三连
  问(自研理由/Radix 适合 agent 长对话/为何不外接 vLLM)+GQA 伪
  代码追问分组与维度对齐+面试官点破转训练补课项；649 赞社招
  复盘观点账(性能建模最值钱/算子框架两端串联判断力/agent infra
  不必硬转/maas 更偏上层/定薪看流水)
- 2026-10-17：尾部目录缺口批二（溯源官方原文后双篇吸收）——transformer
  篇新增 §十·增 KDA「精准编辑被压缩的记忆」（K3 报告 §2.1.1：
  S_t=(I−βkkᵀ)Diag(α)S_{t-1}+βkvᵀ 先擦后写；三分视角闭环串联
  §九 Hebbian 外积编辑面/§八 线性注意力「状态有界精度有损→改可
  编辑容量按相关性再分配」/§十 AttnRes 深度轴对偶；工程三件事
  chunkwise UT 变换、lower-bounded decay 把负 Softplus 无界
  衰减用 g_min=−5 scaled sigmoid 钉下界 → off-diagonal tiles
  走 Tensor Core、full-rank 输出门；MLA 层全 NoPE 扩上下文
  免 retune）；lora 篇新增 §六·增 Context Tuning（arXiv:
  2507.04221，ICML：PEFT 第四格「动演示激活出的 KV 表示」，
  ICL 起手初始化+梯度精修两步走、CT-Prompt/CT-KV 两变体、
  摘要口径胜 ICL 与传统 prompt 类且与 TTT 精度相当效率更高、
  与 RAG/KV-offload 缓存经济/部署链三线串联）；同批查重结论：
  ezyang 极限分析已被训练光速手算专题覆盖（其副题即第 3 章
  转述）、AI圈9527 面试题-1 六题中五题已覆盖跳过、TileRT 移
  出（暂无可溯源一手材料，微信正文被 captcha 拦）
- 2026-10-17：微信尾部目录再扫描批——25 篇文章【传送门】全量
  提取、22 个关联主题逐条查重（16 个已覆盖跳过），真缺口溯源到
  Kimi K3 官方技术报告（arXiv:2607.24653，2026-07-27）后五篇
  联动吸收——rl奖励设计篇 §六·增（3×3 矩阵 RL：general/
  agentic/coding 三域 × low/high/max 三档=9 专家、per-problem
  预算 curriculum 从 max 档 anneal 出谱系、AGRM 强制四步协议+
  冗长度预算、MOPD per-token 蒸馏合九为一、报告自陈 top-k 无
  增益）；rl环境工程篇 §六·增（AgentENV Firecracker microVM：
  133ms/49ms 增量 checkpoint-resume、等待推理占沙箱 98% 生命
  周期 Pause 零资源、Fork 判奖无副作用、OverlayBD 亚秒级拉起
  6.5× 超卖、5112 万沙箱/150 万镜像；Partial Rollout λ 比例
  触发+长尾原位暂停、极端 off-policy 由 per-token 正则兜底）；
  组合并行篇 §六·增（MoonEP 完美均衡 EP：每 rank 恰 S×K tokens、
  E/R 冗余专家上界定理及 tightness、ILP 参照+近优 GPU 规划、
  通信 buffer S×K×R 降为 S×K、静态 shape 免层间同步；对照
  ECHO/UltraEP cap 路线三毒）；transformer 篇 §十 AttnRes（残差
  各层等权十年假设换成深度轴注意力：伪查询+RMSNorm 核防大层
  垄断、O(L²d) 算力可接受真开销在 O(Ld) 内存与 PP 跨段通信 →
  Block 形式、2.5× scaling 效率四件套之一勿单归因）；kv-offload
  篇 §五·增（KDA state 与 MLA KV 统一页池同字节：全组 pin 先于
  分配/当步块拷贝落地前不匹配/checkpoint 全组原子化三条一致性
  规则、PD re-layout 零 GPU 重排、cache-aware 亲和+预算准入）；
  配套口径条目 4 处。微信 portal 链接已验证需 captcha，后续吸收
  统一走「尾部目录→标题→原始论文/Blog 溯源」路线
- 2026-10-17：GitHub 巡检批——三缺口吸收（gh 检索命中
  BigKunLun/Agent-Interview-100，433★ MIT 题库；对其 100 题逐题
  查重后 8 个候选缺口收敛出 3 个真缺口：自动化 Prompt 优化/
  Eval Harness 生态/法域合规，12-Factor、A2A、MCTS 等已覆盖
  跳过）——路线图篇新增 §二·增 L1 深水区（DSPy 编程化 vs 元提示
  APE/OPRO/PromptBreeder 两流派对照图：优化对象是结构化组件
  还是字符串、BootstrapFewShot 自举/MIPROv2 贝叶斯搜索/SIMBA、
  OPRO 上百次 PromptBreeder 上千次调用成本账、指标过拟合与
  绕护栏风险、缓存视角「不优化也是决策」反例弹药）；
  评测基准篇新增 §七·增考场生态（Harness ≠ Benchmark 四原语
  Task Loader/Solver/Sandbox/Scorer、lm-eval-harness 与 Inspect
  AI 与 HELM 三足鼎立 + METR Time Horizon 范式、METR 弃自研
  Vivaria 迁 Inspect 的生态收敛信号、max_sandboxes=2×cpu 并发
  瓶颈、Anthropic 三起评测隔离事故「prompt 声明的隔离不是
  隔离」、题库「20+ 分差距」经本仓 TB 双 harness 实测校准为
  6–12pp、选型一行版）；
  安全防护篇新增 §九·增法域合规（EU AI Act 四级风险「判定看
  用途不看技术」、2026-08-02 高风险义务生效/€35M 或 7% 罚款、
  GPAI 10^25 FLOPS 系统性风险线、Provider/Deployer 两顶帽子、
  Agent 特有三大难题的工程答案：结构化 trace 审计/HITL 卡点
  与防线共用骨架/memory×GDPR 日志只存哈希、多法域最高水位线
  策略）；配套口径条目 3 处（含法条未复核声明）
- 2026-10-17：claude-code 篇深读增补（吸收姊妹报告
  xiaonancs/claude-code-source-analysis 30 篇/23 子系统/179 图，
  基线同为 v2.1.88；20 个概念探针对旧 417 行正文查重后锁定五条
  零覆盖线）——新增 §六·增：冷启动四策略（面向 ~135ms 模块求值的
  并行隐藏窗：MDM/keychain 子进程插在 import 语句之间；HEAD 预连接
  因 BoringSSL 首握手锁证书存储被迫后移的教训；earlyInput 三方
  交接；0.5% 采样双模式 Profiler）、对话循环七层防御（529 只重试
  前台的容量雪崩账/fallback 须 stripSignatureBlocks/413 三级恢复
  不跑 stop hooks 防死亡螺旋/输出截断 8k→64k→续写 3 次/stop hook
  标志位曾致烧数千次调用/tombstone 与孤儿 tool_use 协议补齐/
  assistant content 不可原地改的 200 倍缓存红线）、Thinking 四层
  正交控制面（ultrathink 只注入附件不改 effort 参数/Advisor 常发
  beta header 的解析边界/thinkingClearLatched 单向锁存器）、权限
  七步管线（用户 ask 规则先于 bypass 判定）+ Auto Mode 两阶段 XML
  分类器（Stage1 64 token 偏向拦截/连续拒绝熔断/Fail-Closed 双
  兜底）、Settings 5+1 优先级链（远程策略 Fail-Open 哲学 + 跨语言
  checksum 对齐坑）与 Hooks 27 事件（matcher 语义随事件变/三级
  管控防用户禁管理钩子）
- 2026-10-17：Hermes 篇机制篇补全（同一报告 hermes-agent-study 的
  Part I/II 本体——此前只吸收了其生态/争议视角）——新增 §七·增：
  六大设计原则（Prompt 稳定性=缓存是显式目标/可观察/可中断/平台无关
  核心/松耦合 check_fn 门控/Profile 隔离）、自进化机制本体（两相
  skill_manage 闭环：5+ 工具调用触发评估→create 固化 SKILL.md→
  后续加载按效 patch；对照 RLCR 作用域异同）、47 工具自注册 +
  AST 静态扫描发现 + 两条数据流（CLI/Gateway）逐环账、v0.9→v0.14
  规模账（文件 886→1,898、411k→912k 行、skill 子目录 14→82）、
  OpenHarness/JiuwenClaw 一行档案（标题级）+ Q9 自进化防营销词答法
- 2026-10-17：pi 篇深读增补（吸收 pi-agent-source-study 32 章——27 章
  横向按 B 快照 + 28–32 章纵向按 U 快照 46c9de402/2026-09-18、一年
  6,252 commits）——新增 §七·增：读码三发现（「迁移进行中」代码库/
  HarnessNotImplemented 与 v3-v4 会话两轨并存、primitives 未接线
  （图像生成 SDK 零调用/遥测无发射点）、字面自扩展且无沙箱）+
  系统提示 550 token 实测锚；harness 三段换代提交链（5 月真实现→
  8 月 durable 契约替换→U 的 Lane.prompt-accept-drive 执行状态机）与
  「实现/接入/默认交付」三档核验纪律、durable≠副作用可重放 vs dsh
  对照；三发现之外的纵向五步判读框架（产品交付与架构成熟度分开
  评价/修复活动≠效果/责任分配表）+ 面试问题 6
- 2026-10-17：dsh 篇姊妹报告增补（吸收 cordis-source-analysis——Cordis
  本体 24 章逐行拆解，基线 c261dd2/core rc.10，core 仅 1891 行 9 文件）——
  新增 §7.5–7.8：epoch 字符串可抵消指纹的第一性论证（布尔/单调号各差
  一层）与 rc.10 双分量（_revision 只管显式重启，依赖抖动允许抵消）、
  FAILED 干净态（错误连带反序回滚+error 锁+update 唯一复活口）、
  disposer 二合一契约（可调用+thenable 解异步 setup/同步 teardown 错配）、
  五形态归一器与 epoch 守卫、反序两粒度与可逆边界（越界只能幂等/补偿）、
  HMR 三阶段「失败前移」事务化+四集合分类+hmr.watch 依赖反转、
  React Fiber 同名不同物三点澄清；面试问题 6/7 + 延伸阅读补姊妹篇
- 2026-10-17：agent 源码系列第五极新篇「OpenClaw 源码机制专题」——
  兑现生态篇预留的机制欠账，吸收 openclaw-study 27 章深读报告
  （基线 v2026.4.15/23,014 commits/1,200 PR 数据集）：Gateway 三
  role 单控制面（WS 18789 + pre-connect challenge 修 CVE-2026-25253）、
  per-session 沙箱「身份优先」安全观与四环纵深（main/non-main）、
  MD-first 记忆装配线（先 flush 后 compact、Dreaming 建议池、
  memory-wiki 可审计 claim、三档压缩）、六顶层子系统与飞书十步链路、
  四判断（个人 AI OS 初形/护城河 voice+channel+mobile node）三预测
  两难题、六道面试题 + 口径条目；生态篇欠账声明改指新篇、IQ README
  源码路线行升级五极话术
- 2026-10-17：RL 线观点补丁——rl奖励设计篇新增 §6.4「把不可验证域变
  可验证」（2026 行业观点主线：优化器成熟后瓶颈上移到奖励信号生产，
  三条任务改造路线——清单化 RaR arXiv:2507.17746「K=1 退化为 RLVR」
  摘要口径+2026 秋后浪四篇标题级核实、环境化「测试生成一等动作」、
  自博弈产题 Absolute Zero 2505.03335 零数据；含 Goodhart 攻防账
  「把 hacking 面压缩成可复核谓词」与面试收束句）+ 面试题 Q9 +
  数字锚 3 行 + 口径条目 9 + agentic-rl 互链
- 2026-10-17：llm基础理论补丁——transformer篇新增 §九「FFN 存知识的理论补全：
  MLP 是 Hebbian 记忆」（Hazy Research，arXiv:2607.10034，COLM 2026 转述口径：
  白化后门控 MLP 与 Hebbian 记忆数学等价、B 矩阵闭式外积和赋值免训练、
  解码间隔分析视角、信息论最优率下同事实数参数省 10–10⁴ 倍/进 Transformer
  块省 15–63 倍、PoC 为整块换 MLP；串联 Geva 2021 与 ROME/MEMIT 与 RAG
  三分法——微调、RAG 之外补出「写参数但不训练」的第三姿势）+ 追问表
  加行 + rag全链路 §1.2 三分法更新 + llm基础 README 索引行
- 2026-10-17：kernel 线产业第二案例——kernel-agent竞赛篇新增 §五·增二
  「TokenSpeed-Kernel 把 kernel 变成一等公民」（PyTorch 官方博客一手口径：
  分层公共 API mha_prefill/moe_apply + @register_kernel 注册表 + selector
  三重过滤/命中缓存 + numerics/独立基准/profile 护栏；GPT-OSS 120B on
  MI355X 实战：attention 15 测点 14 最快、1.4–2.3× vs Triton、1.1–1.3×
  vs AITER；MoE decode warp-decode 融路由 1.7–2.1×、中批量诚实 0.9x；
  端到端 1.6–3.6×；tokenspeed-kernel-amd 被 vLLM 反向采用；agent 落
  kernel 的终点站=registry 观点）+ 面试 Q8 + 口径条目；推理引擎2026新
  进展篇收敛趋势补第 8 条（kernel 层抽成可插拔一等公民子系统）并加
  串读互链
- 2026-10-17：MoE 线新方向——moe架构篇新增 §六「LatentMoE：把路由专家压进
  潜空间」（Kimi K3 2.8T 架构三件套之一；7168→3584 约两倍瓶颈压缩、共享
  专家保全宽；dispatch 搬运的激活与专家权重读取字节同比例减半，与 FP8 压
  位宽叠加互补；「Stable」＝非首创（NVIDIA 研究在先）但 2.8T 规模训稳并
  量产；专家池 896/激活 16 社区两说口径自注）+ 追问清单加行 + vera-rubin
  篇 MoE 尾节互链
- 2026-10-17：推理线补丁——kv-offload 篇新增 §4.1·增「CacheBlend 缝合术」
  （EuroSys 2025 最佳论文：chunk 级任意位置匹配+边界选择性重算突破前缀
  天花板；多轮 QA 吞吐 14x/RAG +4.5x/TTFT 1.9–8.1x/成本 -90%；口径校准：
  「首Token快14倍」系转述把吞吐挪给了 TTFT）+ agentic-serving 处互链
- 2026-10-17：微信尾部目录挖掘批——SGLang Vera Rubin 文的 8 条往期
  全量查重，仅 1 真缺口：kernel-agent 竞赛篇新增 §五增「SGLang 把
  工程经验编码成 Skill」产业案例（B200 单算子 1.13x~2.75x、
  Qwen3-Next 吞吐 +71.4%、TTFT 456→168ms 自报口径；RLCR 闭环三件套；
  Sakana AI 被质疑反例同框）+ 面试 Q7 + 口径条目；Mooncake 一篇
  经查重已被 kv-offload 专题覆盖，跳过不留痕
- 2026-10-17：agent 新篇「Hermes 与 OpenClaw 生态专题」——90k star
  增长拆因子（自进化叙事+migrate 迁移池+Nous 品牌+MIT 数据主权）、
  「OpenClaw Python 重实现 + EvoMap 嫁接」本质判断三证据与时间线、
  run_agent.py 11,487→4,410 的 Transport ABC 重构、三十日五版三条
  主线、FTS5 选型四理由、Harness 四范式分类学、开源伦理三立场框架
  （指控按 EvoMap 单方口径转述不采为结论）+ 面试题 Q1–Q8
- 2026-10-16：agent 新篇「Claude Code 源码机制专题」——源码系列第四极
  （闭源逆向读法三源互证、90 编译时 flag DCE 物理隔离、cch 认证占位符、
  query.ts 九阶段、上下文五阶段账本含 25 万次/天熔断事故、CLAUDE.md
  在第一条 user message 的社区最大误解、后台记忆提取五重门控+用安全层
  换经济性、MCP 桩模式与 ToolSearch 延迟加载、Coordinator「Prompt 即
  编排」；IQ README 新增 Coding Agent 源码路线索引行）
- 2026-10-16：Codex 分析再补（章节级深挖 Ch07/Ch22）——Skill 双通道注入
  （developer 目录/user 正文 + 预算三层退化逐字符轮转 + implicit 只观测
  不注入 + MCP 依赖弹窗闭环）与 Code Mode V8（exec/wait/cell_id 可恢复
  协议、每 cell 一 isolate 一 OS 线程、namespace 分段不替代 MCP、
  「代码即工具调用」四案对读表）+ 面试问题 7/8；引用源改指上游原仓
- 2026-10-16：Codex 源码分析大补（吸收三方深读报告 codex-source-analysis）
  ——新增 §六增（规模治理快照、入口与 app-server 协议层三分工、
  network-proxy 第四道闸门、hooks/skills/memories 坐标、集成易错六条、
  AGENTS.md 根判定合并规则）+ 面试问题 6（协议层为何是产品边界）
- 2026-10-16：dsh 分析大补（吸收三方深读报告 deepseek-harness-deep-dive）
  ——新增 §七 深读增量（论文时空两轴通俗拆解、fiber 内核三件套 epoch
  快照/反序幂等撤销/inertia 串行化、AI 主力开发的工程纪律五件套、
  Koishi→Cordis→dsh 血缘链）+ 面试问题 5（热装卸正确性）+ 延伸阅读，
  证据沿用报告 [verified]/[inferred]/[claimed] 三档口径
- 2026-10-16：GitHub 调研批——agent 新增「Coding Agent 会话记忆工程专题」
  （trending 月榜三案拆解：context-mode 工具输出沙箱四件套与 98% 算账、
  claude-mem 观察-压缩-注入三段管线和 progressive disclosure、Hindsight
  四类仿生记忆与 retain/recall/reflect；「记忆进窗的是能力不是内容」、
  fail-open 默认、98% 自报口径审计三步；IQ README 记忆行补齐产品化与
  评测治理两个漏登记入口）
- 2026-10-16：查漏补缺批——coding 新增手撕「手写 Speculative Decoding」
  （贪心 verify 20 行 + rejection sampling 采样版 + 期望加速比三要素口算；
  2026 投机主线化后的预备现场题），coding README/频次表/真题汇总三处
  登记，投机解码 2026 专题回链
- 2026-10-15：组合并行机制专题（进程组坐标化编址 rank=tp+t·(dp+d·pp)、
  连续性=同机=NVLink 的推导链、反例双输分析、EP 从 DP 维切出 EDP 五族组、
  「复制到哪梯度求和到哪」七行对账、tied embedding 与输出头两处完整网络
  特有通信；Megatron initialize_model_parallel 次序的最好背法）
- 2026-10-15：llm基础小补丁（八道面试题-1 吸收）——省 K 之问（匹配/
  读取解耦+QV^T 对称性破坏）+ decoder-only 胜出补三条 2026 论述（数据
  效率 999/1000、训推同图无 exposure bias、ICL 无信息瓶颈）+ 位置编码
  表补 NoPE/CoPE 边角变体
- 2026-10-15：投机解码2026专题再补（jarvislabs 四法实测）——Suffix
  机制深挖（双后缀树/D(N) 置信度贪心扩展/CPU 自适应 MAX_SPEC）+ IBM
  MLP Speculator 边栏（逐头 loss、两阶段训练、0.12.0 未完全支持坑位）+
  8B/70B×对话/代码实测矩阵（8B 计算受限 Suffix 赢代码、70B 带宽受限
  EAGLE-3 双赢；落地公式：先 Suffix 摸天花板再决定是否上 EAGLE-3）
- 2026-10-15：训推逐位一致专题（vLLM 官方长文：推理 kernel 定数值、训练
  只补反向；diff=0 五要素；DSV4-Flash 逐算子 recipe——Top-K 固定平局、
  跨卡归约移出比较路径、CUDA Graph 三冲突；rollout 91.3%/87.5% 保住 A；
  Agent+skill C0–C10 工程化；Nemotron 基线 0.56→0.22 vs 一致版不回落）
- 2026-10-15：Kernel 工具链选型专题（cuBLAS→TVM/XLA→Triton→手写→
  Mojo/MAX 五层控制阶梯：每层给什么拿走什么、TVM 四挑战、Mojo 用 MLIR
  comptime 派发跨硬件、决策四问；L4 手写层与本仓三篇 GEMM/kernel 实战互接）
- 2026-10-15：Blackwell GEMM 实战专题（B200 手写八步 164→1401 TFLOP/s：
  TMA/mbarrier/TMEM/tcgen05 四件装备、128B swizzle 单步 4.1 倍治 TMA 写
  bank 冲突、双 CTA 算术强度 85→128、persistent+TMEM 双缓冲；三步白工的
  排除法与「sweep 只在它的 regime 里有效」四金句）
- 2026-10-15：投机解码2026专题大补（vLLM/AMD 官方文吸收）——Gemma 4 MTP
  中间形态（独立 ckpt 共享 KV）+ 两轴分类法 + DFlash anchor/KV 每层注入
  vs EAGLE-3 输入拼接 + DSpark Markov head 补联合不一致（`of problem.`）+
  AMD MI300X/355X 实测 2.87× 与 N∈4–7 调参法 + 训练工作流五坑（target 必须
  自产响应/hidden 三模式/loss 不算数）+ 六家 draft 模型生态地图
- 2026-10-15：低精度预训练专题（NVFP4 训练侧五味配方：微块缩放 16/E4M3
  scale/Hadamard 揉分布/2D 块对齐/随机舍入，12B×10T token 从零训 loss 贴
  FP8，训练三大死结的完整对答）
- 2026-10-15：六篇深度新专题+一补丁（官方博客/竞赛/论文级实战吸收）——
  训练光速手算实战（DSv3 一步拆账，FSDP 69% 暴露 vs PP bubble 3.89%，光速
  6.64s 对实测 3 倍的逐 kernel 对账）/ DSv4.1 × vLLM 优化实录（Agentic 三周
  5.3×）/ GEMM 优化 13 级阶梯（AMD 案例）/ GQA decode 手写 kernel（赢 FA4
  中位 1.46×）/ Kernel Agent 竞赛复盘（harness 工程胜负手）/ 投机解码补丁
  （TensorFold 字节级精确）
- 2026-10-15：torch.profiler 入门实战专题——Profiling 系列三部曲补齐
  （表 vs trace 两产物/overhead vs compute 判定/三个侦探案例：首步 227µs 死区、
  buffer 请求偏移、同 kernel 快慢不一/compile 两真相：融合在 dispatcher 层、
  小 op 上 CPU 贵 2 倍/随身速查表）
- 2026-10-15：线性层与 MLP 的 Profile 实战专题——Profiling 系列姊妹篇
  （epilogue 无单独 add/零 kernel op 名单/kernel 名 `_tn_` 指纹/compile 塌链融合
  中间量不出 HBM/Liger 89.4 vs 92.8µs 的特化 vs 通用取舍）
- 2026-10-15：PD 解耦补丁×2——推理并行决策专题补混跑干扰定量直觉（5 卡 4:1
  时间账）+解耦成本三件套+Agent 契合；推理专用硬件专题补 Cerebras 异构解耦官宣
  （同 WSE 数吞吐 5 倍厂商口径），行业配方第三家坐实
- 2026-10-15：DCP 解码上下文并行专题——TP 切 KV 的头数地板与按序列切解法
  （MLA 等效单头每卡全复制/8 卡 B200 实测 1,863→6,091 token/s·GPU 超 3 倍/
  MLA 满 TP 度 vs GQA 上限=复制因子的约束公式/AllGather Q+LSE 合并流程）
- 2026-10-15：确定性训练专题——Megatron Core 万卡比特级可复现方法论
  （逐步指纹验证/五层分层追踪 SOP/确定性税 17%→2% 三线战绩/grouped-GEMM
  私有槽+定序归并经典案例/防退化三层+症状速查六条）
- 2026-10-15：推理并行策略决策专题——DP/TP/PP/CP/EP/混合六策略各治一种瓶颈
  （五问框架/最小 TP→PP→DP 构造顺序/PCP 治长 prompt、DCP 治 KV/EP 看尾部指标/
  失败信号矩阵 + 8 道面试题）
- 2026-10-15：FBTriton 与稀疏算子 Kernel 实战专题——TBE 前向 1.28× 反向 1.22×
  的 Triton 全案（六个可抄工程解法/赢在阈值：SL 32→256 胜负带实现带宽 5.8×/
  输在哪也如实收录）
- 2026-10-15：Vera Rubin 调优实录专题——SGLang 团队 Kimi K3 新硬件四板斧
  （MLA 深流水线 +16%/split-KV 先读后算 +20%/MoE 尾融合省 276 次 launch/KDA
  barrier 消除 +20%/饱和转换 2.5×/Miles RL 曲线跨硬件贴合）
- 2026-10-15：Attention 的 Profile 实战专题——naive 到 SDPA 四后端逐 trace 拆解
  （math 慢 3.7 倍三段原因链/flash 13% occupancy 是设计/cuDNN 0% 是 CUPTI 盲区/
  kernel 名当指纹读/CPU 活搬进了库里）
- 2026-10-15：消费级硬件推理实战专题——FastH3 137.7 GiB 视频生成模型上 RTX 的
  六把刀（砍层/NVFP4 全层化/校准溢出案例/FP8 单位 scale 技巧/600 次测量剪枝/
  pinned 内存坑），每把刀挂面试题
- 2026-10-15：双向 KV 传输与多轮复用专题（vLLM 2026-10-12 官方能力：decode 反向
  借 KV 给 prefill，多轮 TTFT 最长降 3.3 倍；机制六步 + 两个调参旋钮 + 数字锚）
- 2026-10-15：GitHub 新锐雷达（学习资源清单 §1.6，gh 直查 11 仓星标）+ 五处专题补丁：
  skills 生态新进展（18 万星注册表 + SkillOpt 训练 skill）、nanochat 全栈参照系、
  SimpleMem/EvolveMem 开源记忆参照、AgentCPM 4B 长程全开源栈、KTransformers 异构推理行
- 2026-10-15：查漏补缺批——32 个新面经考点覆盖审计后补 12 处薄弱点：
  MCP 拒绝降级/SSE 续传、run 级版本锁定、多租户配额、Tool 端硬校验、
  DeepEP 机制拆解（官方数字）、MoE 排障症状 g、Agentic 三阶段对照、
  MySQL 索引失效与锁、ES 工程层、PDF 页码校准、文件记忆 vs RAG、意图三层漏斗
- 2026-10-14：面经合集二十三节（蚂蚁 Agent 压力面 35 题/字节 Agent 一面 22 题/
  小红书 Harness 18 题/抖音字节三轮 30 题/Momenta 训练优化二面），
  主信号总表并入 13 条新信号；zero 篇补「梯度累积 × ZeRO 通信量」手算
- 2026-10：备战总路线图交互大图（12 周行动线 × Agent/Infra 双主线）
- 2026-10：系统化收口——学习路线图变双轨总入口，五信号表合并为主信号总表
- 2026-10：求职操作四件套（投递与 offer 实战 / 模拟面试 / 挂后复盘 / 12 周日历）
- 2026-10：coding 新题型 3 篇（GRPO Loss / 蒸馏 KL / KV 显存公式）+ 刷题频次映射表
- 更早：vLLM/SGLang 源码全链路、对比专题（vLLM vs SGLang、MoE vs Dense、MCP vs 工具）等

## 仓库结构

```
├── basics/                 # 零基础入门：什么是大模型、Transformer、数学/GPU 速通、术语词典、训练与推理第一印象
├── projects/               # 项目篇章：可面试的 GitHub 项目选型、增量改造与 benchmark 解读
├── resume/                 # 简历篇章：骨架/量化公式/防造假三问、GitHub 模板盘点、分方向范文
├── interview-experiences/  # 面经复盘：按公司/日期组织，含流程、题目、复盘
├── interview-questions/    # 高频考点：LLM、Agent、推理部署、分布式训练等
├── system-design/          # 系统设计：Agent/网关/推理服务/个人助理等场景设计题
├── coding/                 # 手写题：transformer、attention、LRU 及各种 live coding
└── resources/              # 参考资料、书单、博客链接
```

## 使用说明

1. 零基础转行/刚接触大模型 → 先读 [basics/](basics/README.md)
   （7 篇连读：概念 → Transformer → 数学/GPU → 术语 → 训练三段 → 推理部署，每篇附进阶指针）
2. 备战冲刺不知道从哪开始 → 再读 [resources/学习路线图.md](resources/学习路线图.md)
   （基于真实招聘 JD 调研的分层备战路线，附两份岗位 JD 分析和学习资源清单）
3. 高频考点入口 → [interview-questions/README.md](interview-questions/README.md)
   （考点地图 + 出现率 Top 20 + 各公司面试风格差异）
4. 没项目/项目讲不深 → [projects/](projects/README.md)
   （GitHub 项目选型总表、防烂大街法则、逐方向的增量改造与面试追问预演）
5. 简历被秒挂/不会量化 → [resume/](resume/README.md)
   （60s 初筛漏斗、4 段式与量化句式库、防造假三问、GitHub 模板/工具盘点、分方向范文）
6. 会考试但不会找工作 →
   [resources/投递与offer实战.md](resources/投递与offer实战.md)（时间线/渠道/面评管理/谈判）
   → [resources/模拟面试与口语化表达.md](resources/模拟面试与口语化表达.md)（四拍答案+两套模考卷）
   → [resources/挂后复盘四步法.md](resources/挂后复盘四步法.md)
7. 其余按目录翻，每篇文档自成一体
8. 面经部分已脱敏，不保证 100% 还原现场
9. 八股不保证全对，以我拿到 offer 为准（验证方法：给我发 offer）

## Contribution

- 发现错误欢迎提 issue / PR，会尽快回复（勘误比面子重要）
- 想分享你的面经也欢迎 PR，记得脱敏；整理得好的我会并进面经合集并署名来源
- 想看某个方向的整理，开 issue 许愿
- 排版注意（踩过坑）：本站点 docsify@4 的 marked 不认「粗体以 ASCII 标点（`%`
  `)` `/`）结尾、闭合 `**` 后紧跟 CJK 文字/全角标点」的写法——会漏渲染甚至把
  `**` 打进正文。遇到这种情况把后面的全角标点收进粗体里（`**50%，**`
  正常 / `**50%**，` 报错）。闭合 `**` 后是空格、ASCII 标点或行尾则安全。

## License

MIT，拿走不谢。如果你能拿到 offer 回来告诉我一声，就是最好的回报。

---

*"Self-attention is all you need. 走错片场了。"*
