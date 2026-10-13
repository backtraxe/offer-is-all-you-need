# 推理 Profile 实战专题：从抓 trace 到优化动作的完整闭环

> **面向**：准备 AI Infra 面试「给我一个慢推理服务，你怎么查」这一类题的读者。默认已
> 读过 [profiling与性能分析专题](../profiling与性能分析专题.md)（下称「工具篇」）。
> **本篇与工具篇的分工**：工具篇讲工具怎么用——四段式（`torch.profiler` → nsys →
> ncu → 引擎 HTTP 开关）、开销阶梯、训练大作业 SOP、门诊症状表，那是 canonical，本篇
> 一概不重复；本篇讲**对一个在线推理服务，从「决定抓」到「出优化动作」的完整闭环**
> ——怎么选实例、怎么定窗口、时间线上六个区域怎么看、每个异常特征落到哪个动作。
>
> **读完获得**：① 推理 profile 与训练 profile 的四组本质差异与对照表；② 在线低开销
> 抓 trace 的生产安全 SOP（含 PD 分离与多 rank 合并）；③ 一张推理 trace 的六区域读
> 法与「时间线 → 指标」归因映射；④ 8 条「特征 → 判定 → 动作」优化动作库（本篇主
> 菜）；⑤ 两个完整案例的时间线叙述；⑥ 面试高频题的完整答法。
>
> **口径**：工具与参数以 2026-10 官方文档为准（vLLM v0.31+、SGLang v0.5+）。数字锚从
> 工具篇同源引用（decode GEMV 算术强度约 2 FLOP/B、GEMM 占 GPU 时间 46% 的 vLLM 文
> 档示例、80B 模型 × 100 请求 flush 约 10 分钟、H100 HBM 3.35 TB/s 的 80% 带宽墙判
> 据），本篇不复测；案例内数字为示例构造。

## 一、推理 profile 和训练有什么不同

用训练 profile 的直觉直接套推理服务，是这一类题最常见的翻车点。对照记四组差异，后
面所有方法选择都是它们的推论。

第一组，**目标不同**。训练要的是 step 吞吐、讲 MFU，开销摊平在百万次同质 step 上；
推理服务要的是**每条请求的 TTFT 与 TBT/ITL 分位数**，用户只看尾部。所以推理 profile
的验收单位不是「这步快没快」，而是「p99 的哪一段被治掉了」。

第二组，**约束不同**。训练大作业可摘下来离线复现，ncu 的十倍到百倍减速（工具篇口径）
只是时间问题；在线推理服务的请求是活的，观察者效应直接打穿 SLO——开 profiling 的同
一个实例，TTFT/TPOT 当场失真。所以在线能上的极限是低开销的时间线工具，重下钻一律
离线。

第三组，**归因单位不同**。训练的归因单位是 step，一步拆六桶；推理在连续 batching 下
根本没有「同质的步」——每一步的 batch 里混着若干请求的 prefill、若干请求的 decode、
以及排队与调度。**推理的归因单位是单条请求的生命周期分段**：排队 → 调度 → prefill
→ decode。一条 trace 看不懂，十之八九是拿「步」当主线，而不是拿「段」当主线。

第四组，**验收不同**。训练修完看 MFU 是否上涨；推理修完看 SLO 分位是否下降，而且必
须对着**同一负载画像**对比——流量画像换了分布，trace 结论整个作废。

| 维度 | 训练大作业 | 在线推理服务 |
|---|---|---|
| 优化目标 | step 吞吐 / MFU | TTFT、TBT/ITL 分位数 |
| 工具约束 | 可离线重跑，ncu 随意 | 在线低开销优先，ncu 只在线下钻 |
| 归因单位 | step 六桶 | 每请求的排队→调度→prefill→decode |
| 窗口 | 同质 step，抓 3-5 步即代表 | 负载随时间变，窗口先固定负载画像 |
| 验收 | MFU 提升 | SLO 分位下降（p90/p99） |

## 二、抓取 SOP：在线低开销抓法

面试问「在线服务不能停，怎么 profile」，按这套流程答就是生产姿势。

第一步，**先定段再抓**。不要一上来就开 profiler：先用引擎 metrics 与 DCGM/Grafana 把
问题定到「TTFT 段」还是「TBT 段」，再决定抓什么。无目标抓 trace 是大海捞针，trace
还很贵。

第二步，**摘一台灰度实例**。从负载均衡后面摘一台实例，流量切走或只切小部分灰度流量
给它，在灰度上开 profile——永远不在线上主力实例上开。这一步解决的不是技术问题，是
事故责任问题。

第三步，**用 HTTP 开关定窗口**。vLLM v0.31 起用 `--profiler-config` 配置
`torch_profiler_dir`，运行中打 `/start_profile`，以 `delay_iterations` 跳过启动段、
`max_iterations` 控制窗长；SGLang 是 `SGLANG_TORCH_PROFILER_DIR` 加 `/start_profile`
的 `num_steps`。窗口抓 3-5 个 iteration 就够，并且**显式标注 warmup 段**——前 1-2
步混着 CUDA graph capture、allocator 预热、前缀缓存注册，看完要学会「异常但正常」。

第四步，**为什么窗口只能小不能大**：flush 成本。trace 在结束时 flush 落盘，模型越大、
请求越多 flush 越久——80B 模型 × 100 请求的 flush 约 10 分钟（H100，vLLM 官方文档，
与工具篇同源）。抓大窗口不仅 flush 期间实例半瘫，产物体积也会大到 Perfetto 打不开。
小窗、只开 CUDA activity、gzip 三板斧都在工具篇，这里只强调结论：**在线 trace 以小为
美**。

第五步，**分离部署下 prefill 和 decode 必须分开抓**。SGLang 的
`--profile-prefill-url` 与 `--profile-decode-url` 互斥（官方文档口径），这不是偷懒
的 API 设计，是方法论：prefill 实例与 decode 实例是两种角色，各自的调度回路、带宽
特征、瓶颈类型完全不同，混在一份 trace 里既无法归因角色，也填不出 TTFT 与 TBT 各自
的账。问「TTFT 高」抓 prefill 实例加前端排队账；问「TBT 高」抓 decode 实例。

第六步，**多 rank trace 要合并**。TP 下每个 rank 各写一份 trace（vLLM 按
`dp0_pp0_tp0..._rankN` 命名），要么用 SGLang 自带的 trace merger（`merge_profiles`）
合并，要么逐 rank 对齐同一时间窗看——判断通信段是否 overlap，必须所有 rank 同屏对
齐。

## 三、读懂一张推理 trace：时间线上的六个区域

拿到 Perfetto 里的一份 decode 实例 trace，**不要从最大的 kernel 看起**，从时间线横轴
把六个区域分区上色。每个区域记「正常长什么样、异常长什么样」两格。

**区域一，调度回路 CPU 段**。引擎 python 调度器在两条 GPU kernel 之间的活动（选请求、
组 batch、发 token）。正常：短促、细窄，GPU 无空窗。异常：CPU 段变长且 GPU 对齐出
现空转缝——CPU bound 的标准画像。

**区域二，显存分配与 KV 管理段**。显存分配、block 注册、prefix cache 查表与写回。正
常：偶发小尖刺，多在 step 边界。异常：每步都有成块的 alloc/copy 活动——KV 管理开
销化，通常伴随显存水位很高或碎片化。

**区域三，长上下文的 prefill 计算段（GEMM 加 attention）**。大块密集的计算 kernel。
正常：在含 prefill 的窗口里占大头，vLLM 文档示例里 GEMM 一族占 GPU 时间 46%（与工
具篇同源）属健康分布。异常：prefill kernel 被切成很多小碎块——chunked prefill 尺
寸太小的典型长相。

**区域四，采样段**。logits 处理、采样与（投机场景）verify kernel。正常：每 decode 步
结尾一小段。异常：采样段占比异常膨胀——大词表未融合采样，或投机解码 verify 成本高、
接受率差。

**区域五，逐 token 的 decode GEMV 等宽段**。权重搬运 kernel。正常：连续、瘦长、稳定
等宽，带宽打满。异常：GEMV 段被拉长——上下文变长、KV 变大，或者带宽被别的段抢走。

**区域六，跨卡 TP 通信段**。allreduce 等集合通信 kernel。正常：短，且藏进计算 kernel
的影子里（overlap）。异常：通信段以长条串行暴露在计算之间——TP 度数越高，这条暴露
越致命。

**归因映射表：时间线到指标**（面试里这张表就是「第一反应是分段」的具象化）：

| 线上指标 | 时间线上的位置 | 看哪个区域的账 |
|---|---|---|
| TTFT | 请求到达 → 首个 token 输出 | 排队空隙 + 调度段 + prefill 段 |
| 排队时间 | 到达 → 被调度之间的空白 | 请求流密度对 running 上限 |
| TBT/ITL | 相邻输出 token 的间距 | decode 单步总账：GEMV + 通信 + 采样 + 调度缝 |
| 吞吐 token/s | 整窗内 GPU kernel 占比 | 各区域占比，减掉空转缝 |
| p99 尾部 | 时间线上的异常长窗 | 先分位定位，再逐个长窗定性 |

## 四、profile 特征 → 判定 → 优化动作库

本篇主菜。先背总表，再看逐条展开；每条都给了验证方式，面试带着验证说才完整。

| # | 时间线特征 | 判定 | 优化动作 | 验证方式 |
|---|---|---|---|---|
| 1 | decode 段长，ncu 显示 DRAM 带宽超 80% | decode 撞上带宽墙 | KV 量化 → MLA → 放大 batch 爬 roofline | ncu 带宽复测 + TBT 分位复测 |
| 2 | prefill kernel 被切碎成小碎块 | chunked prefill 尺寸太小 | 调大 chunk 尺寸，静态直测定位 | 静态 batch 直测前后对比 |
| 3 | kernel 间空转缝与 CPU 段逐条对齐 | CPU bound 启动开销 | CUDA graph / 减少 python / 算子融合 | 空转缝消失、ITL 下降 |
| 4 | 通信 kernel 长条串行暴露 | TP 通信未 overlap | 通信流专用化、降 TP 度或换 EP | 通信藏进计算影子 |
| 5 | 采样段在每步占比异常大 | 采样未融合或投机接受率低 | 采样算子融合；先查投机接受率 | 采样段相对单步时长回落 |
| 6 | 调度回路 CPU 段每步都长且稳定 | 调度参数或引擎实现问题 | 调配额参数、升级引擎版本 | py-spy 火焰图热点迁移 |
| 7 | 同样前缀的 prefill 段周期性重复出现 | prefix cache 未命中 | 路由亲和：同前缀打同实例 | 命中率指标、TTFT 均值下降 |
| 8 | decode 段周期性出现大变长的慢步 | CUDA graph 因动态 shape 未命中 | 固定 batch bucket、消除动态 shape | graph 覆盖的步占比回升 |

**第 1 条，decode 撞带宽墙**。decode GEMV 算术强度只有约 2 FLOP/B（工具篇同源），对
H100 约 295 FLOP/B 的拐点差了两个数量级，**这个负载天生就是 memory bound 一类**；ncu 若
显示 DRAM Throughput 超过 3.35 TB/s 的 80%，判带宽墙。动作按升级顺序：KV 量化
（INT8/FP8，立竿见影省搬运量）→ 换 MLA 类低 KV 架构（治本）→ 显存允许内放大
batch，把 GEMV 挤成 GEMM 往 roofline 右边爬。别背成「decode 慢就加卡」——加卡不改
单卡带宽墙。

**第 2 条，prefill 被切碎**。Chunked prefill 是为 TTFT-TBT 公平性切块的，切得太小，
GEMM 吃不满张量核，trace 上 prefill 段碎成一串小 kernel。动作：调大 chunk 尺寸，并
用静态 batch 直测（绕开调度器，直接打 ModelRunner）定位到底是 GEMM 还是 attention
kernel 没吃满。

**第 3 条，空转缝对齐 CPU 段**。判定只需一条：GPU 上的每条小缝，横轴对过去都压着一
段 CPU python。动作三选一：CUDA graph（一次 launch 重放整段）、减少调度回路的
python 活动、融合小算子减少 launch 次数。提醒：开 graph 后逐层标记消失，下次
profile 前想清楚看 graph 内还是外。

**第 4 条，TP 通信串行暴露**。TP 每层两次 allreduce，不 overlap 就是「算一段、等一
段」。动作：通信专用 stream 与计算 overlap；更根治的是评估 TP 度数是否过高、跨机 TP
是否值得换 EP。验证口径统一：通信段藏进计算影子，而不是通信时长绝对变小。

**第 5 条，采样段膨胀**。两个分叉先分开：纯采样段长，查大词表下采样算子是否融合；
挂了投机解码时 verify/draft 段一并计入，先查投机接受率——接受率塌方时，投机不但
不加速还把 TBT 拉大。

**第 6 条，调度回路每步都长**。CPU 段长但不随 batch 剧烈变化，大概率不是负载问题而
是实现或参数问题：配额类参数让单步调度对象过多，或引擎版本本身的热点。动作：调配
额参数、py-spy 定位热点、升级到修过的版本。

**第 7 条，前缀重复算**。trace 上看到内容高度雷同的 prefill GEMM 周期性重现，结合
前缀命中率低，判定 prefix cache 没接住。动作在路由层：同会话、同系统前缀的请求亲
和到同一实例，让缓存真正命中——这是「profile 结论驱动路由策略」的标准例子。

**第 8 条，CUDA graph 未命中**。开了 graph 但动态 shape（罕见 batch 大小、投机解码
变长）超出 capture 的 bucket，该步回落到非 graph 慢路径，trace 上表现为周期性突变
的慢步。动作：让 batch 落到已 capture 的 bucket、消除动态 shape 来源，或升版本。验
证标准是慢步消失而非均值略降。

## 五、两个完整案例

两个案例均为**示例构造**：负载数字与比例只演示闭环走法，非实测数据。

### 案例 A：TTFT p99 超 SLO，根因在 CPU 调度回路

背景（示例构造）：8 卡 TP=8 的 70B 服务，SLO 要求 TTFT p99 在 2s 内，实测 3.1s。mean
正常只有 p99 炸。先按映射表分段：排队账对得上（队列等待 p99 0.8s），剩下 2.3s 要由
调度加 prefill 解释。

抓取：摘一台 prefill 实例，`/start_profile` 抓 4 个 iteration，第 1 步标注 warmup 丢
弃。读 trace（示例构造）：prefill GEMM 加 attention 段只占整窗 25%，kernel 间空转缝
密且每条缝都压着调度回路 CPU 段，CPU 段合计占约 40%。判定：CPU bound，不是算力不够。

下钻：py-spy 火焰图（示例构造）显示调度回路的选请求与序列化占大头；且部分步因动态
batch shape 未命中 CUDA graph，走非 graph 慢路径。

动作与验证：把负载固定到已 capture 的 batch bucket、验证 graph 全步覆盖、上调调度配
额。同负载画像复测：TTFT p99 从 3.1s 降到 1.7s，p50 基本不动——尾巴病治尾巴，均值
不动，结构自洽。

复盘面经句式：「p99 炸、均值正常，我先分位再分段；分段后调度段异常，先查 CPU，不碰
kernel。」

### 案例 B：TBT 高，根因 decode 带宽墙

背景（示例构造）：同集群 decode 实例，32K 长上下文场景 TBT p90 为 110ms，目标 70ms。
metrics 显示 batch 未打满、显存水位高。

抓取与下钻：metrics 定到 TBT 段后，decode 实例短窗抓 trace——GEMV 段瘦长连续、无明
显 CPU 缝与通信暴露；把 decode GEMV kernel 摘出来离线跑 ncu（示例构造）：DRAM
Throughput 92%，越过 3.35 TB/s 的 80% 带宽墙判据；算术强度约 2 FLOP/B，对约 295
FLOP/B 的拐点，纯 memory bound，跟算力无关。

动作：KV cache 从 BF16 改 INT8 量化，单 token 的 KV 搬运量直接减半；同步放开
`max_num_seqs` 等效放大 running batch，把 GEMV 往 GEMM 方向推。

验证：同输入画像重抓 trace——GEMV 段整体变瘦；ncu 复测 DRAM Throughput 降到 61%
（示例构造）；TBT p90 从 110ms 降到 76ms，降幅约三成，打平目标。报告口径注意：TBT
改善与 KV 量化、batch 放大两个变量同批改动，若要归功需拆两次实验——面试主动说这
句是加分点。

复盘面经句式：「decode 慢先问带宽不问算力；带宽墙内优先省搬运（KV 量化、MLA），再
谈爬 roofline（涨 batch）。」

## 六、面试怎么讲

两句话背熟，整类题就有骨架：「**给我一个推理服务慢的问题，我的第一反应是分段**——
把预算拆到排队、调度、prefill、decode 四段，哪段超预算治哪段；工具顺序是
`torch.profiler` 或引擎 HTTP 开关定窗口、nsys 看时间线、ncu 只在线下钻——ncu 是
kernel replay，既不反映调度，也不能上生产链路。」

展开时的三段叙事：先讲**约束**（在线低开销、灰度实例、小窗口），再讲**读法**（六区
域、映射表、TTFT 与 TBT 各自的账），最后讲**动作库**（第 1 条到第 8 条里挑和题目场
景相关的 1-2 条讲透判定链——特征、判定、动作、验证，四件套缺一不可）。

## ▶ 面试题

**第一题：推理 profile 和训练 profile 的核心差异是什么**？
四组：目标是 TTFT/TBT 分位不是 step 吞吐；约束是在线低开销不是离线随意；归因单位是
每请求四段不是 step 六桶；验收是 SLO 分位下降不是 MFU 上涨。追问高发点在归因单位
——连续 batching 下没有同质 step 的概念。

**第二题：为什么不能在线上抓 ncu 深潜**？
两个理由：ncu 对目标 kernel 多次 replay 收 PMU 计数，十倍到百倍减速，直接在线把
SLO 打穿；且 ncu 结果不含调度效应，回答不了「为什么线上慢」。所以 ncu 只在 nsys 定
位到具体 kernel 之后、离线复现环境里下钻。

**第三题：为什么 PD 分离下 prefill 和 decode 必须分开抓**？
两种实例的角色、调度回路、瓶颈类型都不同，混一份 trace 无法归因角色，也填不出
TTFT 与 TBT 各自的账；工程上 SGLang 的 `--profile-prefill-url` 与
`--profile-decode-url` 就是互斥的。问 TTFT 抓 prefill 实例加前端排队账，问 TBT 抓
decode 实例。

**第四题：decode 为什么永远是 memory bound 负载**？
decode 每步是 GEMV，算术强度约 2 FLOP/B；H100 的 roofline 拐点约 295 FLOP/B，差两
个数量级。所以 decode 的所有优化方向都从「省搬运」出发：KV 量化、MLA、涨 batch 爬
roofline 斜坡。

**第五题：vLLM 文档示例里 GEMM 占 GPU 时间 46%，算高吗**？
单看比例不判罪——GEMM 本应是 GPU 时间的主力。真正的问题是剩下 54% 去哪了：通信与
attention 合理，若有大块 gap、CPU 段或采样段就按动作库逐条定性。加分点是把这题引
到「先拆账，后评价」。

**第六题：怎么判定 decode 是 CPU bound 还是 GPU 带宽侧**？
看 GPU 时间线 kernel 间有没有空转缝、缝是否逐条对齐 CPU 调度回路段：有缝且对齐是
CPU bound（动作是 CUDA graph、减 python、融合算子）；缝少而 GEMV 段瘦长连续是 GPU
带宽侧，去 ncu 看 DRAM Throughput 对 80% 线。两条路线的下一步动作完全不同，判错方
向全白干。

**第七题：trace 显示调度回路 CPU 段占 40%，你的动作序列是什么**？
先 py-spy 确认热点在调度回路本身；再查 CUDA graph 覆盖——动态 shape 是否把部分步
打出 graph；然后三选一成套调：固定 batch bucket 让 graph 全命中、调调度配额参数、
升级到修过热点的引擎版本。验证是同负载画像下 TTFT/TBT 的 p99 回落，而不是均值抖动。

## 串联阅读

- [profiling与性能分析专题](../profiling与性能分析专题.md)：工具 canonical——四段式、
  开销阶梯、训练 SOP、门诊表；本篇同源数字锚的出处。
- [推理压测与容量规划专题](./推理压测与容量规划专题.md)：负载画像与 knee 点——profile
  前后「同一画像对比」的画像定义在那篇。
- [vllm与推理加速核心](./vllm与推理加速核心.md)：vLLM 机制层——配本篇 HTTP 开关与调
  度回路读法一起读。
- [kv量化与压缩专题](./kv量化与压缩专题.md)：动作库第 1 条「KV 量化」的精度与机制展开。
- [mla深度穿透专题](../llm基础/mla深度穿透专题.md)：动作库第 1 条「换 MLA」治本路线的架构层解释。
- [推理服务排障深挖手册](./推理服务排障深挖手册.md)：排障全景——本篇是「慢」分支的 profile 取证环节。
- [负载均衡专题](../负载均衡专题.md)：动作库第 7 条路由亲和的 LB 侧实现。
- [agentic-serving专题](./agentic-serving专题.md)：长前缀多轮 agent 负载——prefix cache 问题的高发场景。
- [kv-offload与分层存储专题](./kv-offload与分层存储专题.md)：KV 管理与分层——区域二 KV 管理段异常的深挖方向。
- [高频面试真题汇总](../高频面试真题汇总.md)：真题地图——本篇题目按频率对号入座。

## 口径与未核实说明

- 数字锚（GEMV 约 2 FLOP/B、GEMM 占 46%、80B × 100 请求 flush 约 10 分钟 H100、3.35 TB/s
  的 80% 带宽墙、ncu 十倍到百倍减速）均为工具篇同源引用，本篇未独立复测，口径与年份以工具篇为准。
- 命令与参数（`--profiler-config`、`/start_profile`、`delay_iterations`、`--profile-prefill-url`、
  `merge_profiles` 等）按 2026-10 vLLM v0.31 与 SGLang 官方文档表述，细节以官方为准。
- 第三节六区域的正常/异常长相与第四节动作库，属方法框架与社区通行工程经验的整理，非单篇官方文档原文。
- 两个案例的全部数值（占比、p99/p90、降幅）为示例构造，仅演示闭环节奏，不可作为实测数据引用。
