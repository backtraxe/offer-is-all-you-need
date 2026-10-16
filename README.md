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
├── system-design/     # 系统设计：Agent/网关/推理服务/个人助理等场景设计题
├── coding/            # 手写题：transformer、attention、LRU 及各种 live coding
└── resources/         # 参考资料、书单、博客链接
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
