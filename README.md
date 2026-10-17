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

- 2026-10-17：抖音「推理引擎面试」换词——三十八批——合集四十五节+映射表两新行：网易 AI 应用开发一面 Text2SQL 深挖 18 问全录（1020 赞 6 图 OCR——此前仅 41 赞标题级、升级为首个全录网易场：表关系固化 vs 动态推断、起点表外补依赖用字段到表反向索引+关系图最短路径最多两跳、隐含业务逻辑靠语义标签「统一口径/跨币种」命中补汇率表、规则为主 LLM 辅助且 LLM 输出进规则引擎校验不直接生效、半自动知识构建 DDL 元数据同步+Join 候选历史 SQL 抽取关键链路人工 Review、规则层语义标签模板化命中注入 SQL 约束而非让 LLM 理解业务、Query Rewrite 统计类补默认时间、防编字段三层+生成后解析校验不通过不执行、多通道召回分设 Top 阈值控 token、PGVector+HNSW、自学习只沉淀成功+人工确认 SQL；笔试 BFS 两跳最少关联表与 Join 路径先长度再置信度入映射表；反问金句「SQL 准确率、查询安全还是知识库治理成本」、感受「不能只说用了 RAG——不能让 LLM 猜字段猜 Join 猜业务口径」，与大疆 Text2SQL 六步提准成对）；峰哥小米 AI Agent 三轮技术面全录（802 赞 10 图 OCR、峰哥现存最早帖——一面 13：线程池四参/Redis 锁过期看门狗/MVCC 幻读/ReAct/意图识别防漂移/LangChain 六组件/AgentExecutor 防死循环/Naive RAG 与 chunk/Hybrid+Rerank/工作流写死场景/手撕 LC146；二面 12：架构七层/LangGraph State Reducer 并发写/Checkpointer 持久化与中断恢复/多 Agent 四模式与子 Agent 超时/Harness 层限流审计降级全链路 Trace 四职责/FC Schema+重试降级/长会话三策略/HITL interrupt/手撕 LC394；三面 12：Bad Case 定位归因修复/带人 Code Review 标准/PM 模糊需求评估/观测四件 Trace Token 成功率 BadCase 回流/召回率低排查五件/Self 与 Corrective RAG/MCP vs Tool Calling 本质/千级 QPS 生产化/手撕 LC200；HR 7 问含小爱同学——java 双栈画像与追觅同构、三手撕全基频区、LC394/LC200 入映射表、邪修引流注照办）；AgentAlpha 创客星球字节二面推理引擎岗视频要点（34 赞小号第 19 集——KV 老做法有效利用率仅 20%-38%、P 大小受延迟/抢占/长 prompt 三限制）；灰原/啊星/暴龙战士/AgentAlpha 前缀卡复现注；小哲系五卡按判别式
- 2026-10-17：TurnOPD 正文复读补遗+查重勘误——三十七批微批：agentic-rl前沿手法专题 §四·增补遗（混元 hy3 TurnOPD 微信批遗留候选风控解除后 3789 字直读复核——覆盖臂＝成功条件完成深度 80 分位防过度截断、深度统计量靠周期性全长度探针 rollout 更新（截断样本不计入防偏置）+EMA 平滑、KL 预算线性插值 q=(1−α)n_t/Σn+α·1/T 且 α 绑定训练进度初期 0 后期转回合均衡、四基准 Least-Time Avg@4 数字表 ALFWorld-1.7B 73.52@4.42h→85.60@1.93h 2.29×/4B 1.33×/Multi-Hop 1.51×/WebShop 1.26×、对照 TCOD-F2B 2.37× 加速但 80.06 准确率反低——加速与准确两前沿分开报、控制器动态三观察、官方论文 arXiv:2607.05804 补号）；查重工具事故定案+勘误：仓库根裸 rg 递归静默盲区（返回空≠零命中）——git grep 对批前提交重审批 34/35 零词，唯一假零词「请求分布」（profiling 专题 trace 折叠处既有命中、排障用法仍概念首见）就近勘误四十三节，批 34 侧「小微」为 torch profiler 跨词拼接同形异物、概念结论不变，四十二节补同形注；跨批查重口径固定为「git grep 或显式目录参数」
- 2026-10-17：抖音「LLM 训练面试」换词——三十六批——合集四十四节+数据工程专题 §十·增：鹏博士「LLM 数据配比与清洗」11 条 checklist 全 OCR 后查重结案（与数据工程专题一~十节逐条对上不重录，真增量三件已补专题：岗位深浅四档——数据岗讲到工具与阈值/通用岗校招标流程/微调岗只考 SFT 配比防遗忘/推理岗不涉及；常见错答四条——数据越多越好去重质量过滤收益常超加数据/配比照抄不可迁移/去重只做精确近似才是大头/SFT 按来源分不按任务分；「清洗决定下限配比决定分布」框架句——追问五连与专题 Q1-Q3 逐条对上）；小温 AI 求职号大厂 Agent 评测岗 40min 复盘章节要点直录（一人独面横截面：自动评测三件初筛维度锚点/质量管控两连黄金集校准+Verifier+抽检+回归/链路归因失败链路分析/开放题评判三件/模型选型四答生成随机性输出长度约束输出推理深度/反问问「AI 提效在报告生成与归因分析怎么落地」——主体查重结案，提纲当评测岗口述训练样本）；听天色等烟雨连载双卡（「输出工具调用 JSON≠已执行——模型提出调用应用负责校验执行」判别金句+Token 三追问训练并行/ICL/BERT-GPT，AI 生成与转载双声明进判别式家族打折）；复现实录：丁师兄 SFT→RL 493 赞=二十五节同帖、豆豆 AI 六 offer 口号帖打位不变；研学姐手撕清单 1187 赞与丁师兄面试现场 2293 赞存目
- 2026-10-17：XHS 存目清仓——三十五批——合集四十三节：老陈的AI工坊「给你所有数据你推得出根因吗」70B 线上排障场景题全录（6 图 OCR——8 卡 A100 线上部署、QPS 50→10、P99 80→500ms、GPU 95%、显存 70/80GB「给你 30 分钟怎么查」；三数据陷阱 GPU 95%≠瓶颈/没 OOM≠显存够/无报错≠正常；面试官三测排除干扰变量+设计实验+数据证根因「不是我觉得是我测得」；楼主第一步看请求分布三分 Scheduler/KV Cache/Kernel——「数据都有了但不知道看什么」是 CS 转 Infra 真实挂法）；汉堡校招简历四原则（11 图 OCR——简历每词默认是潜在面试题不堆名词、介绍不走两极端「讲太少=让出面试战场/讲太长=面试官力竭」正解三段式留追问素材、每段经历=潜在准备成本「算子岗面试官也会顺口问 vLLM/KV Cache」简历即划定面试范围、同一段经历按 JD 调重点——与三十四批社招七军规、demo 7 问、vibe coding 表述合成简历方法论四件）；SongSomi 凉经 IDE 面翻车（90 分钟面前 50 分钟项目+GPU 八股、面试官翻文件夹源码十几分钟、最简单的反转链表没撕出来即凉——IDE 工作区即面试素材要策展、基频题不过线直接凉与灰原送分题同谱；厂名判读注：自称百度、截图北森实为昆仑芯 2027 届 AI 高性能计算研发工程师-GDH 面邀 08-14 吻合时间线，按昆仑芯第二场次存续打折、「高性能计算」岗名第二例）；xhs_infra_raw 卡池清账（剩两低值资源位不拆）
- 2026-10-17：XHS 零散卡清偿——三十四批——合集四十二节：木木子「Infra 面经解剖所」第一期全拆（54 赞 10 图 OCR，4 份字节一面拼盘——考察五件跨岗稳定 KV Cache/vLLM 与 SGLang/分布式并行/项目深挖/ACM 手撕，火山方舟/Seed/Data-AML/业务推理四岗线；「八成经典题但不停第一问」三条追问链：AllGather 四连、KV Cache 六层（不缓存 Q 原理→显存计算→长上下文瓶颈→不同长度分配→Paged→Prefix Cache/量化/Offload）、vLLM 巡考（长 Prefill 占满 GPU Decode 一直等→Continuous Batching/Chunked Prefill/PD 分离）；答题公式「问题→原因→方案→代价」与项目深挖六问；完整 ACM 手撕四题（第 K 大行/K 个一组翻转链表/链表成环/URL Parse）入刷题频次映射表新行——「有人思路对但代码没跑通」口径；工程区分题三连：管理 100 万张卡怎么拆/Python 进程卡住不报错排查/C++ 超大数组两遍访问之辨）；社招简历痛批七军规（266 赞 17 评论全录——不写规操、删课程项目、定位单一、量化先交基线、深度即护城河、平台过渡、一页纸，与 demo 7 问收束简历方法论三件套）；WXG-WeLM 岗位实锤（57 赞邀请函 OCR——技术架构团队后台开发名头、WeLM 预训练多模态 Agent 支撑小微与 AI 搜索、微信 6 面起步、「最近在招好多」）；度小满 2027 届 AI Infra 三轮零手撕速通意向（11 赞意向函 OCR）；三十五节字节拷打与简历求批两存目升级已拆
- 2026-10-17：抖音大模型 Agent 项目面词批——三十三批——合集四十一节（19 卡全扫）：主料为面试官视角方法论卡「toy 项目 7 问自检」（阿东玩AI 4-7 长简介直录——Agent 上次拒绝检索何时/用户偏好真记忆/比 baseline 强几个点/System Prompt 折叠剩几个 Agent/丢截图断不断/改计划是否因中间结果/工具失败自恢复，踩 3 条即 demo 不是工程）+vibe coding 简历表述形态（「CC/Cursor 用在哪些环节哪些留人工」而非「AI 辅助提效」——与手撕 20+10、离线 hackathon 收束为三形态）+分水岭三件（Agent 自决检索/检索策略动机/MCP 安全治理——「知道裸跑 MCP 多危险是做了工程和调了 API 的区别」）+进阶六选二与金句句式「我遇到 X 所以这样设计，权衡是 Y」；长鑫存储（CXMT）开 Agent 开发岗为厂向新信号（13 小时前标题级、存储厂进 Agent 岗、待更后拆）；讯飞应用开发面经（5 天前，飞星线互证）与峰哥企业级编排平台（java 向）存目；Panda师兄五项目卡与十四轮批候选表全同构（Multi-Turn-RL-Agent=MT-GRPO 已档）+「Kimi2.6/GLM-5 大量用 RL 提规划与工具调用」行情句；成电摆子哥项目包装第三帖与 7 问自检同向构成 demo 判别二连
- 2026-10-17：GCD 挂账清偿——三十二批微批——刷题频次映射表核心专项加行「GCD 区间最短操作次数」（优酷 AI Infra 一面手撕真题入表：相邻元素 gcd 操作使全数组变 1 的最少步数，三步判法「整体 gcd≠1 无解优先、已有 1 向两侧扩散、无 1 找 gcd=1 最短连续子数组造 1 再扩散」，O(n²) 区间枚举增量 gcd 可过；「无解判定优先于构造」的顺序直觉为练习要求）；合集四十节挂账措辞就地改已结案
- 2026-10-17：XHS 系列作者下半场批——三十一批——合集四十节：优酷 AI Infra 一面凉经全录（158 赞「被问穿了」——两条追踪链金样本：MFU 全称与分母→理论峰值 FLOPS 怎么算→CUDA Core vs Tensor Core→TC 基本数学运算；ZeRO 分片→各阶段增量通信与 ReduceScatter/AllGather 作用量→给定参数量与卡数估每轮通信量——「能背分片对象只是第一步」；动态组批七连含「问题最初怎么发现的」发现链追问；C++ 六件；手撕 GCD 最短区间三步解法为仓内零词题、挂账刷题频次映射表；岗位底色视频 AI+推理侧重+国产卡适配）；蚂蚁 AReaL 一面凉经全录（152 赞最惨烈场——团队五关注向 Rollout 性能/调度与负载均衡/Cache-aware Routing/Trainer-Rollout 权重同步/TB 级 Weight Transfer；Dynamic Batch 发现-成立-验证三段链（改 Loss→证明语义不变→收敛能否证实现正确→做到什么程度敢上线）；「做 Infra 至少得知道模型多大、数据多大、序列多长、Tensor 怎么组织」；反问金块——面试官答 Cache-aware Routing 完整例子，推理负载看 Queue/P-D Workload/KV Cache Hit/显存/运行时五件组，「难点是怎么定义这个 Load」）；淘天二面已 offer（68 赞省流口径——无手撕考「为什么做/收益怎么证明/复杂度是否值得」；作者后端转 AI Infra 完整轨迹字节实习→京东→秋招 433 赞大结果作行情线）；三十九节主表行「四解法块下批补」过时态修正
- 2026-10-17：挂账清偿批——三十批小批——三十九节两项挂账结案：MoE×RL 训推不一致四解法块补进 rlhf与对齐 GSPO 节·增（Routing Replay 路由决策记录重放/多次前向取平均/GSPO 序列级压方差/GEIW Group 期望分母，含千问 48 层 10% 激活漂移与快手 235B 实验锚，与 rl训练工程实战 §2.5 训推不一致连读成对——「不一致从哪来」与「怎么治」）；Expert Choice 路由行补进 moe架构 §二（Top-K token-choice vs Expert Choice 专家反向挑 token 的对比题一句话答法「谁有容量决定权」——均衡白送不含辅助 loss、代价是 batch 级因果可见性与管线复杂化、主线全员 token-choice）；三十九节三处挂账措辞就地改已结案
- 2026-10-17：抖音 MoE 面词批——二十九批——合集三十九节（26 卡全扫）：头鱼 MoE×RL 训推不一致组合题（字节 Agent 岗实录、同题双源）四解法全录——Routing Replay（路由决策记录重放，锁路由收窄探索）、多次前向取平均（快手 235B 实验证优于前者、推理算力翻倍）、GSPO（token 级 Ratio 违背重要性采样多样本前提→Sequence 级平均似然比，训 MoE 无需叠 Replay）、GEIW（Group 期望分母，探索阶段）；实测锚千问 48 层每轮梯度更新约 10% 专家激活漂移——GSPO/训推不一致/MoE 三组件仓内均已有专题、组合接缝零覆盖（与 DSpark×DCP 同构），四解法块与 Expert Choice 路由两项挂账下批补专题；显存账本题六连发揭「小哲系四号矩阵」同模板跨号刷屏——判别式新维度「矩阵号同题多号连发」（生产端矩阵化，看流通强度不看单号信度）；腾讯「MoE 训练 TP 还是 EP」、负载均衡损失函数与动态分组（9-12）、Top-K vs Expert Choice 路由哲学、DeepSeek 删辅助损失互证、AIPM 岗外溢考 MoE 架构（3 天前）
- 2026-10-17：XHS 两帖批——二十八批——合集三十八节：MeteX「AI INFRA(推理)社招面经-0」（154 赞 08-02）判读为系列引路的行情纪要而非题面——推理 Infra 社招供需四要点：国产卡实战+大集群经验市场溢价、超节点兴起（计算存储网络紧耦合）、RL infra 训推一体使训练组/具身组/世界模型组实际也面推理优化（会推理的人选择面比想象中宽）、入行推理框架门槛已不比训练 infra 低；系列-0 后暂无后续章节（结案注待更）；字节 Infra 二面凉经（五号魔晄炉 24h 新鲜）题面全录——FA 与传统 attention、online softmax、SWA mask、MLA 矩阵吸收拷打、手撕 GEMM 计算量与 KV Cache 大小、显存构成与 KV 不够怎么办、L1/L2/L3 数据移动、端到端性能分析、MFU 计算、手撕 LRU；行情三连：面到最后一面才暴露岗位真身是搜广推 infra、挂后可打复活赛、反馈时延判读（最多 2 天、pending 久≈gg）；评论渠道三件套（猎头/内推/HR 捞）
- 2026-10-17：XHS 标题级备选四卡全拆——二十七批——上批存目清仓入合集三十七节：淘天闪购 Infra 一面已过（今天吃饱了吗，172 赞，8 图 OCR——Dynamic Batch 七连问、「1 万 token vs 10 条 1 千」现场计算量题展开 Packing/Varlen mask 四连、MFU 指标本体三问、生成式搜推业务六问、Coding 三段式 20min 独立+10min 允许 AI 的单机到多 Worker TopK、复盘金句「不是看第一句能否说出标准答案，是看问题变复杂后还能不能分析」）；昆仑芯偏算子三轮全录（62 赞——CUDA 与 AMD warp 32/64 差异、CUTLASS 生产者消费者、MLA 小 M 大 M、EP/TP 下 GEMM 切分、DCP 省通信还是计算、手搓 GEMM 逐步叠加优化+C++ 单例，国产算子线寒武纪追觅后+昆仑芯）；字节芯片部训练一面 66 赞 llmbases 投稿（线性度三机制、All-Gather ring 递归翻倍、CP all-gather 转 P2P 等价、精度定位三步、contiguous 兜底还是提需求、FSDP 反向 reduce-scatter 非 allreduce 陷阱，llmbases.com 引流注）；百度 AI Infra 一面 114 赞十月海秒挂（与 teleai 帖同作者双场连读——DCP/异构 Mask 双场复现、「没什么建议挺好的」秒挂话术样本）；系列作者候选：今天吃饱了吗（优酷场）、十月海（双场）
- 2026-10-17：XHS 推理 Infra 双帖批+GitHub 追新——二十六轮——上批存目的「推理 infra 社招记录」深挖到位：649 赞行情帖作者十天后发的「大模型推理Infra社招面经总结」（刻猫猫，130 赞，2881 字 18 图脱敏一手）净 OCR 全录——自我介绍三版本法、通用六件（反问加问与基模团队 model-system co-design meeting）、Coding 七类（Infra 特色三类：资源块管理器/矩阵乘优化/简化 Attention-MLP 与 shape 推导）+vibe coding 与离线 hackathon 新形态（提前两天发题可用 coding agent、面试围绕代码对谈）、项目七连问（边界条件最高频「怕你说什么场景都有效」、开销分析七项、对比给建模不放话）、系统开放十连、准备四件与底层补齐清单「推理 Infra 面试越来越跨层」；行情侧 29 天 30+ 轮社招样本与「收藏向工具帖」观察（「怎么这么多收藏没评论」）；「AI INFRA(推理)社招面经-0」正名注（上批 MeteX 卡同 id）、字节 infra 二面凉经与百度 infra 一二面存目；GitHub 追新 11 仓零实质增量结案、OneRec-Think 停更修正（2025-10-26 最后一 push，「仍在更新」系日期误读）、wanshuiyin 换群码第 4 次实锤、WeThinkIn 绘画板块连载口径延续
- 2026-10-17：抖音 LLM 面词快照对账补遗——二十五轮小批——旧会话在途切片（/tmp/dy_tree.json 搜索页快照）逐卡对账结案：二十五节追加 §6 判残余 11 卡——SFT→RL 切换判断题（493 赞，残余最重题面：收敛边际递减+可判定任务信号+基础对齐稳三条件，锚 rl训练工程实战/rlhf与对齐）、动态脱敏对比题（132 赞：数据库一次性静态规则掩码 vs LLM 侧 prompt 摄入与观测回放两处语义动态识别，锚观测与trace工程 §7.6）、截断 Token 坑帖（142 赞 10-7）与 Transformer 拷打（158 赞）等五张基频标题级、科普位四张零增量、「五天背完 6 offer」引流口号帖打法位不入正文；相关搜索岗向外溢——「llm 评测项目经理」「llm 测试工程师」与三十四节 vLLM 测试开发词同向，LLM 评测/测试岗自成一档检索域（评测体系实战专题/agentic评测基准专题为该岗复习主线）；快照全部消费、断点闭环，下批另开新词
- 2026-10-17：DSpark×DCP 组合设计题批与勘误——二十四轮——teleai 设计题两连结案：dcp 解码上下文并行专题新增六·增节（spec 与 DCP 各自假设的对撞——KV 一次全落本卡 vs 生而分片；四件新活：AllGather Q 变 k 行块 LSE 合并数学不动、verify 新 KV 广播为临时分片用完即弃（MLA 只广播 latent）、接受写回只有尾部分片卡转正、组内一致步进对齐；异构 Mask 第二问分语义答——数学可按列切分与 LSE 合并正交、工程须 (T,k,t) 参数化加被拒行逐行丢弃；#17706/#16997 组合边界与单特性退化位互证，mrv2 按标题口径未展开考据）；勘误三十五节与本行上批记录：「DSpark 为微信尾部深读批点名的零覆盖词再证」实为误读 b2e6df9 查重结案注——原义是「DSpark……无一全仓漏网」，DSpark 自 10-12 投机解码2026专题起已覆盖；组合接缝部分明标面试推演口径未见官方文档
- 2026-10-17：小红书 AI Infra 换词批——二十三轮——面经合集新增三十五节：
  **teleai AI Infra 一面 24 问全录**（10 小时前秋招一手、作者答问确认非实习：
  华为 Attention 项目深挖四连——个人具体负责什么、结合业务与 SLA 讲 TTFT、
  过程拆步数问每步收益；自设计 PCP 与 CP/SP 异同、Ring Attention baseline
  对照、按历史 KV 长度动态 Chunk Size 是经验还是自动搜索、昇腾卡型号盘问、
  DeepSeek-V3.1 架构与「为什么用它」、256K KV Cache 显存手算、MTP 适配；
  「换成 DSpark 支持 DCP 怎么设计」设计题两连——「怎么改造让 X 支持 Y」
  设计题比概念问狠一档，零覆盖误读勘误与组合设计落点见二十四轮行）；两款高
  赞爆款体裁入行情：AI Infra 数学题帖 2551 赞（量化位宽与误差、评论区代答
  模式）与岗位认知梗图 1664 赞（「看完感觉已有 infra 工作经历」426 赞、
  「AI infra 真是干 GPU 运维的吗」）；拼多多与 Momenta 判已录帖复现；字
  节拷打、淘天已过（172 赞）、昆仑芯算子回忆版、WXG 等标题级备候选——
  infra 面经验确立为独立检索域
- 2026-10-17：抖音 vLLM 面词批——二十二轮——面经合集新增三十四节：vLLM
  与 Ollama 生产级消费级分界场景题组七卡（单 token 成本 1486 赞、春招模拟
  818 赞、大厂部署 346 赞——选型答法「报维度不报优劣」）；字节一手真题
  「Prefix Cache 的过期策略」四步答法链（块哈希存、ref_cnt 一条不动、请
  求结束转空闲不失效、LRU 队头先淘汰）已补 vllm与推理加速核心第五节
  「过期策略答法块」（原表仅一句带过）；模型选型四层话术卡（评测集怎么
  来、指标优先级、候选取舍、上线归因——「报出选型结果不等于参与过决
  策」347 赞）；源码走读系双帖（请求跑完全链路 94 赞、Scheduler 防饿死）
  与仓内源码解读、推理调度专题逐点互证并记「源码走读图文化、题面化」风
  向；古希腊「RL 训练瓶颈是推理」新卡与终身训推一体专题互证；相关搜索
  出现 vLLM 推理社招与测开专属词——vLLM 自身已成检索词；AgentAlpha 帖
  为社区引流混排卡，题面答法吸收、引流页不录口径注
- 2026-10-17：抖音 CUDA 面词批与 OneRec 实核批——二十一轮——面经合集新增三十三节：
  峰哥寒武纪 AI Infra 三轮全录（186 赞 10 图 OCR：NeuWare 五件套调用
  链 CNNL/CNRT/CNCL/MagicMind/BANGC 不背定义说清调用链、A100 迁
  MLU370 吞吐反低分层排查、算子不支持时等官方写 BANG C 拆图绕路三选
  一、不用 nvidia-smi 看 MLU 卡况、CNCL 与 NCCL 异同、三生态平台层抽
  象、私有化信创交付、SLA 99.9 与芯片驱动崩的责任划分、手撕 INT8 对称
  量化与 Gang Scheduling 与优先级抢占调度；帖内辅导引流卡照录口径注；
  三面判断题区为本帖独有增量）；快手三轮帖按新判别式判题单化模板打
  折（存 DAG 全拓扑序列手撕变体一道）；千问基模组面「KV Cache 利用率
  怎么算」单题线入主表（块表占用、前缀命中、池水位三解）；OneRec 系名
  称实核结案：OpenOneRec 950 星开放基座与基准、OneReason_Eval_Benchmark
  官方评测基准（快手 OneRec 团队官方户），OneRec-Think 282 星（Itemic
  Alignment+CoT 微调+推荐专属 reward，Qwen3-1.7B）、MiniOneRec 1901 星最
  小复现当生成式推荐线的 TinyZero——三十二节与搜广推专题两处待核注
  就地升级
- 2026-10-17：小红书复调批——二十轮——面经合集新增三十二节：**字节推荐大
  模型一面 40 题全录**（生成式推荐方向一手帖、一面已过、5 小时新 71 赞、19
  图全文 OCR：四域 SID 词表与码本、Think 与 No-Think 双路各 32 候选与
  Pass@64 四域加权、RFT 成功轨迹与 Target Mask 到 Loss 层、CVR 后验
  Reward 的曝光偏差与 credit assignment、SID-to-PID 冲突与商品上下架动态
  更新、手写 Beam Search 生成三级 SID 与残差量化伪代码、反问环节自带组
  方向）；搜广推与llm融合专题新增 §4.1·增（生成式推荐面试题面五块对接地
  图：RFT 与 Target Mask/评测口径/Reward 三问即推荐侧 OPE/SID 在线工
  程/手撕双题）；成电摆子哥 Multi-Agent 八股 8 问入三面，楼主自标三处
  「面试多次提到」（Token 开销、状态与文本转换、知识沉淀）为多 Agent 追
  问题眼排序；通识题单样本与「题单×面经混用」判别式加一维（正文有个人
  情境变量才算面经）；已录观察帖复现零新料注记
- 2026-10-17：GitHub 挖掘批——十九轮小批——新锐雷达 10-17 晚二扫：新入库
  landedjobs/ai-interview-questions（landed.jobs 官方题库，759 题按 11 角
  色分区、372 题 reported/practice 明确分标的口径纪律；AI Infra 与 Platform
  118 题、Frontier Labs 按实验室轮次分组——北美题面对一手来源）与
  lss-1138/llm-scratch-code（手撕个人合集，与 coding/模型手撕 完全同构、
  SimPO 已覆盖射程内互证）；两道数字判读题标本落专题——推理服务slo与运营
  playbook 新增「单租户长 prompt 顶 TTFT」行（TTFT 与 queue p95 同涨而
  token-gap 稳＝prefill 侧层差判读）、通信与网络专题 §五新增 straggler 现场
  判读题（输入等待 140 ms 尾 rank 是短板而集合 20 ms 完成说明通信健康）；
  追新复查：Imironman123 09-24 目录重组后零增量、wanshuiyin 群二维码行政
  push、WeThinkIn 连更集中 AIGC 绘画与多模态排版、Junvate 与 EasyOffer 停更
  判定不变；amanailab 类机构 PDF 引流仓按卖课口径不列
- 2026-10-17：抖音 RAG 面词批——十八轮小批——面经合集新增三十一节
  （RAG 拆解教程区扫描，全批标题级+题组口径）：文档 ingestion 五连题组
  （Word/PDF 4599 赞、几百页 PDF 2265 赞四步链路，与 rag全链路「文档
  解析深水区」逐点互证）、TopK 工程权衡双卡、GraphRAG 反背 4206 赞、
  科普位量级对账（费曼 RAG 4.9 万赞、RAG 项目全流程 6710 赞）；评测
  题组三卡（2779/195/49 赞）坐实真缺口——DeepEval 与 TruLens 原全仓
  零覆盖，评测与建库工程新增 §1.4（DeepEval 评测即测试用例做回归门
  禁、TruLens feedback functions 加 RAG triad 三问定位「检索烂还是
  生成烂」；RAGAS 与 promptfoo 仓内已覆盖互证）；先先贝 1360 赞卡出
  处修正（AI学弟 8-18 原创换号转载，搬运链第四例）；AI 产品经理岗也考
  RAG 完整流程（1309 赞，题向外溢信号）；阿蛋 RAG 急救包家族第二件
  标题级
- 2026-10-17：抖音推理面词批——十七轮——面经合集新增三十节：天猫大
  模型应用开发三面全录（电商 Agent 出题地图：电商导购 Agent 链路熔
  断降级超时幂等、上千 Skill 工具选择命中率、多模态 RAG 商品图文
  「外观相似参数不符」根因、向量库增量增删开销、指标七维评测闭
  环、分布式会话记忆同步）、大疆 AI 大模型应用开发三面全录（无人
  机操控 Agent：硬件指令 Temp 0-0.2、FC 参数错误五层优化、Text2SQL
  六步提准、云端 vs 机载分工、硬件操控安全三层）、Ra 哥手撕
  Agent 五题打样（stop 参数坑、tool_calls 原样回填、滚动摘要增量
  合并、Plan-and-Execute；风向句「手撕不再只考 Attention，越来越
  多直接让写一个 Agent」）、灰原推理八股「推理岗与算法岗两个路
  数」行情金句；端侧agent专题新增六·增（硬件操控安全三层）；手
  写最小agent 追问区补 stop 参数坑+新增题目四 Plan-and-Execute；
  廿九节追觅加出处修正注（峰哥 8-3 原帖、10-16 系转载）
- 2026-10-17：Projects RL 线扩容批——十六轮小批——十三轮批挖到的
  Panda 906 赞 RL Agent 项目四件套入项目谱：projects/agent与rag实战
  §四候选表新增三行（TinyZero 13.2k——最小预算纯 RL 复现 R1-Zero、
  3B 级涌现 aha moment，防包装打法是把训练曲线对齐仓内 RL 训练工
  程实战四坑逐坑留档；Search-R1 5.5k——think、search、information、
  answer 四段语义 token、检索 token 掩码只对自生成 token 计 logprob、
  结果奖励、verl 上 PPO 与 GRPO 双兼容，硬化打法是掩码开关消融留
  稳定性曲线；DeepResearcher 0.8k——真实互联网环境 RL 训 browsing
  agent、计损与不计损 token 分段，硬化打法加工具调用预算对质量的
  曲线），star 均为 gh 搜索当日实查值；ReTool 与 MT-GRPO 判定论文
  口径无公开仓、不入表挂链接，手法展开锚到 agentic-rl 前沿手法专
  题；§五组合套餐新增「1 月+ RL 线」套餐行——RL 项目叙事从「跑通
  了」升级到「复现经典坑并验证过设计」
- 2026-10-17：TurnOPD 补读与追新复查批——十五轮小批——前批风控
  未读的腾讯混元 hy3 TurnOPD 原文补读吸收（agentic-rl前沿手法专题
  新增四·增：长程多回合下 OPD 的两道错配——固定 rollout 深度把算力
  花在信号不可靠的深尾、轨迹级归一化让 KL 压浅层（ALFWorld-4B 上
  回合 0 吃掉四分之一预算、最深的第三回合仅 3.6% 到 4.5%）、污染加
  压缩机制使失败轨迹 KL 反而更低；解法是两个预算控制器——效率臂
  加覆盖臂取大定自适应深度、KL 聚合从 token 级转向回合均衡监督，
  ALFWorld、WebShop、Multi-Hop Search 同等时钟预算全面占优、训练
  最高 2.29 倍提速——一句型答案「监督单位从扁平 token 位置改成回
  合条件的决策」）；连带 km1994 千面郎君追新定点当月复查：注册以
  来（10-11）无新 push，零增量结案；其余追新面保持月度节奏不变
- 2026-10-17：微信尾部深读批——目录考古六真缺口溯源吸收（十四轮）——
  旧 panel 存量页已清空，改走考古路线：从新旧两份会话事件日志归一出
  40 篇公众号 URL，静态抓取 26 篇真题名逐一对账（全部已在既有专题
  射程内），锁定空壳与参数错误页为待读集，经用户 Chrome 登录态补读
  五篇正文（Context Tuning、K3 AttnRes 解析、K3 后训练 Infra、
  TileRT 解读、12 阶 GEMM——逐篇查重全部已覆盖结案），但其尾部
  《往期文章》目录吐出 11 个仓内零覆盖词，深读六篇溯源吸收：agentic-rl
  专题新增 §3.5 Polar（NVIDIA Any-Harness 的 Agentic RL——Agent 与
  模型 API 边界插 Proxy 记 logprobs 重建轨迹，四池异步编排让 Runtime
  预热不占关键路径，Qwen3.5-4B 加朴素 GRPO 跨四种 Harness 一次训练
  +22.6/+4.8/+0.6/+6.2 个百分点）；rl环境工程专题新增 §4.4
  Dockerless（字节 Agent-as-Verifier：两阶段验证性问题生成加只读
  shell 子 Agent 找证据，81.0 AUC 超最强开源验证器 14.3 点，当 SFT
  筛与当 RM 跑 GRPO 双用、端到端 62.0% 仅比真执行低 0.4——RLVR
  验收从真执行换成可信信号的闭环）；kv-offload 专题新增五·增二
  TriAttention（KV 驱逐两引擎级卡点——FlashAttention 不落分数、
  paged 块回收不动；Pre-RoPE 几何评分加每 128 token 物理压缩，AIME
  32.9% 对 R-KV 近翻倍、吞吐 2.5 倍内存省 10.7 倍）；数据工程专题
  新增四·增 CausalMix（数据混合重构成状态条件因果边际回报估计、DML
   双残差剥混杂、0.5B 代理直接外推 7B 与新数据池、CATE 解释器实证
  知识与推理技能冲突）；kernel-agent 竞赛复盘新增国产注脚 MusaCoder
  （首个国产 MUSA 全栈 kernel 生成模型：MooreEval 四关含禁 PyTorch
  回调反作弊、PrimeEcho 加 Buffered Dynamic Retry 加 MirrorPop 三
  项 RL 稳定机制、KernelBench Pass@8 93.2% 声称超 Opus 4.7、64 台
  MTT S5000）；rl奖励设计新增 RubricEM 块（rubric 升级贯穿全程共享
  接口、四阶段结构化推理、SS-GRPO 阶段级信用分配、反思元策略经验
  复用、8B 1400 步均分 55.5 逼近 OpenAI Deep Research）。查重结案
  注：MoonEP3（冗余专家定理已被组合并行专题覆盖）、SAO（GLM-5 异步
  三件套已点名）、A/F 分离、CXL、DSpark、AttnRes、MOPD、LongCat-2.0、
  KVCache 缝合、Firecracker、流水线解码、Rubric 无一全仓漏网；
  TurnOPD 触发风控未读，留下批候选
- 2026-10-17：抖音 Agentic RL 面词批——十三轮实务工批——抖音
  「Agentic RL 面试」关键词 29 卡、图文 OCR 逐张还原：追觅科技 AI
  Agent 全栈三轮 40 题+HR 7 问全录（一面 GIL/asyncio 与 Spring
  Boot 对接/Redis 限流/对话日志索引，二面 LangGraph Checkpointer
  与 harness 生产追问、死循环掐断三件套，三面敢不敢做减法与效果量
  化四指标、Eval Harness 回归集，DAG 拓扑排序手撕为新题型已入频次
  表；楼主总评「这岗不养闲人光背题混不过去」）；算法博主五板斧
  12 小时新帖（环境真实掉 API 延迟与失败注入、self-play 历史
  checkpoint 对抗课程原全仓零覆盖已补 agentic-rl 专题 §6.9）；
  Panda 906 赞 RL Agent 项目四件套（Search R1 检索 token 掩码、
  ReTool 交错执行、TinyZero 最小复现、DeepResearcher 真实互联网，
  其三全仓零覆盖记项目件）；阿里 Agent 一面用户插话三式 desc 全
  录（interrupt/steer/排队与 harness 专题队列口径互证）；Skill
  冲突四步答法原全仓零覆盖补 skills 专题问题 4；海云 RL 四坑帖查
  重发现即 rl 训练工程实战的仓内展开结案跳过；行为崩塌三卡与 rl
  双篇互证；主表并入 5 条新信号+导航行更新
- 2026-10-17：抖音多模态面词批——多模态赛道首采十二轮——抖音「多模
  态大模型 面试」关键词首扫 20 卡、图文 Vision OCR 逐张还原；最高值
  为 4838 赞七家人才计划多 offer 帖：筋斗云一面手写 GRPO（楼主评论
  区口径 trl 的 compute_loss 即可）与终面后缀自动机加双哈希、Seed
  reasoning 三连深水区（benchmark 饱和后缺什么思考、efficient
  reasoning trick、剩余 hard case 泛化性方法）、混元去处与千卡训
  练问、Qwen 大尺寸效应与 rubrics 细节、京东 TGT 纯聊、Redstar 六
  轮养鱼吐槽；楼主 master 非 PhD，留美一作顶会评论者反向羡慕「国内
  master 就能碰基模」；Seed 与筋斗云互斥、可沟通拒掉解锁（投递篇联
  动）；字节多模态 30 题（引流打包口径，一面通识、二面 CLIP/多模态
  训练/DPO 与 PPO/FFN 升维）——多模态岗复用 LLM 八股再证实锤；动态
  分辨率 34 赞教程卡转录专题 §五（NaViT 2D-RoPE 与切片 Tiling 两
  路、PatchMerger 576 到 144、视觉 token 压缩四分类）；MiniMax
  Agent 5780 赞三轮地图（项目真实性→架构工程化任务恢复与工具权限→
  CTO 面 AI 程度、高薪触发加面）；主表并入 5 条新信号+导航行更新
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
