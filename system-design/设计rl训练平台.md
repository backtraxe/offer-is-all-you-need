# 设计 RL 训练平台

▶ **真题画像：AI Infra / 训练平台岗 2026 年的新晋高频题**——"设计一个支持 RL
后训练（PPO/GRPO/agentic）的训练平台"，字节、阿里、头部大模型公司轮询式出现。

> **面向谁**：面 AI Infra / 训练平台方向、被问到"RL 训练平台怎么设计"的候选人；
> 也适合把 verl/AReaL 源码读完、但缺一张"平台层全景图"的工程师。
>
> **读完获得什么**：一套面试前 3 分钟的澄清清单；一条"三池一总线"的架构主线；
> 容错、权重同步、数据流、多租户配额、评估回放五个子设计的标准答案与量化口径；
> 以及七组面试追问的分层应答（及格答案 vs 高分答案）。
>
> **时效口径（2026-10）**：框架事实以 vLLM 2026-05 官方博客、AReaL 论文 v5
> （2026-03）为准；开源 star 数为 2026-10 GitHub 实测。GPU kernel 与并行切分细节
> 仓内另有专题（见文末串联阅读），本文只讲平台层编排、数据管线与资源隔离。

## 一、先澄清问题（开口前 3 分钟的澄清清单）

面试官只丢一句"设计一个 RL 训练平台"，先把范围钉死，展示的是工程直觉：

1. **算法范围**：只做单轮 PPO/GRPO，还是要支持多轮 agentic（工具调用、长程
   环境交互）？on-policy 约束有多强——能不能容忍异步带来的样本过期？
2. **模型规模**：7B 实验级还是数百 B 生产级？这决定训练池的并行拓扑
   （单组 FSDP 就够，还是必须 TP/PP/EP 全上），也决定权重同步走同机 IPC 还是
   跨机 NCCL。
3. **训推资源配比**：rollout 和 trainer 的卡怎么分？单机小集群（≤百卡）还是
   跨机房千卡？——配比对错，集群一半时间在空转。
4. **租户与隔离**：多少团队共用？要的是"能排队"，还是严格的配额、抢占与审计？
   2026 年这题几乎必追问多租户。
5. **评估与回放**：训练只是手段——checkpoint 要不要自动进 benchmark 流水线？
   样本要不要沉淀成可重放的资产？

一句话立题："**RL 训练平台 = 在一个集群里同时编排三种异构负载，并用一条样本
总线和一条权重同步通道把它们闭环**——而不是把 verl 包一层。"

## 二、直觉一句话

预训练平台只要管好"一个巨型批处理作业"；RL 平台要同时养活的其实是三个服务：

- **Trainer 池**（训练侧）：Gang-scheduled、吞吐敏感、同步语义的巨型批处理，
  Megatron / FSDP 那套；
- **Rollout 池**（推理侧）：vLLM/SGLang 在线推理服务，行为上和线上 serving 无异——
  延迟敏感、连续批、要应对流量式负载；
- **Env·Verifier 池**（环境侧）：沙箱化的 CPU/网络敏感 worker 池，跑代码执行、
  检索、游戏规则校验，安全和超时熔断是头等大事。

平台设计的全部难点都来自一句话：**这三种负载的资源画像互相矛盾，却必须在一个
集群里闭环流转**。样本从 Rollout 池流向 Env 池再流向 Trainer 池，权重从
Trainer 池反向灌回 Rollout 池——平台的骨架就是"三个资源池 + 一条样本/权重
复合总线"。

## 三、架构主线

<div class="diagram-embed">
<iframe src="assets/diagrams/rl-platform.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/rl-platform.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

讲这张图的标准动线：Prompt Pool / 回放库出任务 → Rollout 池（vLLM 集群）生成
轨迹 → Env/Verifier 池沙箱打分 → 样本总线（trajectory buffer，打策略版本戳）→
Trainer 池按 staleness 上限取批更新 → 权重同步控制器把新权重 NCCL/IPC 广播回
Rollout 池，闭环。训练编排器（job spec、权重对齐、策略版本追踪）横贯三池，
checkpoint 存储在 Trainer 侧旁路落盘。

### 3.1 全案最大的分叉点：同步 vs 异步编排

- **同步模式**（verl hybrid-controller 的 colocate 方案）：训推同卡轮换，rollout
  跑完一整批 → trainer 更新 → 再 rollout。工程简单、样本严格 on-policy，但
  step 时间由 batch 内**最长那条 trajectory** 决定——长思维链任务里一条
  32k+ token 的轨迹能拖垮整个 batch 的利用率。
- **异步模式**（AReaL 的路线）：rollout 永远不停，trainer 收够一批就更新；代价是
  样本**staleness**（消费样本时策略已经前进了好几步）。需要三件套补偿：staleness
  上限 η 作为作业级声明式配置（rollout 侧按请求速率反压）、decoupled PPO 目标
  函数、训推一致性监控。

量化口径（必背）：AReaL 论文实测 fully-async 对比同卡数同步系统**最高加速
2.77 倍（AReaL v5，2026-03）**，实验对照是 verl 2025-05-07 的 main；staleness
上限 η 的经验值是**代码任务取 4、数学任务取 8（2025）**。

面试姿态：**同步起步、异步是演进方向**。小规模先把三池逻辑解耦做对，再谈异步——
这个排序本身就是得分点（见追问 7）。

### 3.2 训推配比：不要背固定比例

AReaL 实验里 inference:training ≈ 75:25 的卡数配比吞吐高于 50:50（2025 官方
口径），但论文 limitation 明确写了：配比应随训练进程动态调整——长思维链训练
后期 response 变长，rollout 单价变贵。落到平台层就是两个能力：训练侧**支持动态缩容、滚动腾挪给 rollout**，以及把配比做成作业级可调参数而非集群级硬切分。

## 四、关键子设计

### 4.1 容错与 checkpoint：利用率的天花板

RL 平台题里"挂一次怎么恢复"是必问。引用了就有说服力的锚点：Llama 3 405B
预训练 54 天共发生 **466 次中断，其中 419 次意外、约 78% 与硬件相关
（arXiv 2407.21783，2024）**——平均每天 8.6 次。Meta 靠自动化把需要人工介入
的次数压到 **3 次，有效训练时间做到九成以上（2024）**。这就是平台故障自愈
要努力对齐的 SLO。

标准答案分两层：

1. **训练池层**：step 边界的分布式 checkpoint + 异步落盘，万卡级 ckpt 落盘可
   优化到亚秒级、进程组重启从数小时压到分钟级（Meta 工程博客 2024-03 官方
   宣称）。
2. **RL 特有的恢复四件套**——光恢复 trainer 权重和优化器状态不够，还要恢复：
   rollout 引擎的 weight version、dataloader 消费光标、buffer 里未消费样本的
   版本戳。**漏掉任何一个都会产生重复样本，污染 on-policy 分布**。回退到旧
   checkpoint 后，buffer 里由"更新策略"产出的样本要么丢弃、要么显式按
   off-policy 处理，两类语义必须让作业作者选清楚。

工程细节再加一分：checkpoint 是三角权衡——频率 vs 训练停顿 vs 故障回退量；
对象存储侧还有 Meta 官方确认过的坑，**突发 checkpoint 写入会把存储 fabric
打满**，平台层要做限流与错峰落盘。

### 4.2 权重同步：2026 年的标准答案

vLLM 2026-05 官方博客确认，行业已收敛到一个范式：**推理引擎原生权重同步
API + pause 三模式 + 两阶段 pause**。平台侧要把它封装成用户无感的能力：

- **传输通道**：四阶段权重传输（init / start / update / finish），跨机走 NCCL
  broadcast、同机走 IPC，packed tensor 直灌引擎显存，不落盘。
- **版本追踪**：平台维护策略版本号（weight version），每条样本进总线时打
  版本戳，trainer 取批时按 staleness η 过滤——"weight version ↔ sample
  version"的账本在平台手里，这是框架之外平台必须自己持有的状态。
- **pause 三模式**：权重切换时在飞的 rollout 请求只有三种处置——abort（丢弃
  重算，吞吐换正确性）、wait-done（等跑完，长尾换零浪费）、keep（保留前缀、
  换权重后续跑，工程最复杂但最省）。AReaL 的 interruptible generation 配
  keep 模式在 1.xB 模型上带来 **12%～17% 的吞吐收益（2025）**。
- **DPEP 死锁**：Data-Parallel + Expert-Parallel 部署下 pause 与 DP 协作曾
  有著名死锁，vLLM 官方用"两阶段 pause（local 先停 → global all-reduce 达成
  共识）"修的。**平台的价值就是把这类坑屏蔽在编排层，让作业作者永远不用关心**。

背书级案例：Prime-RL 用 16×8 H200 推理（PD 分离、DPEP32、每节点 1TB CPU KV）
加 16×8 H200 训练 GLM-5.1-FP8 稳定跑过 100+ step——这是 vLLM 博客验证过的
"训推分离、大规模、异步"组合的可行性参照（2026-05 官方口径 + 社区口径）。

### 4.3 数据流：trajectory schema 与样本总线

trajectory 的最小 schema：

```
prompt | response tokens（含逐 token logprob）| reward 分解
     | weight version（策略版本戳）| env metadata（会话、工具调用记录）
```

- **logprob 必须随车走**：训练栈 bf16、推理引擎 FP8 或不同 kernel，logprob
  对不齐就是"看似 on-policy 实则 off-policy"，reward 被悄咪咪吃掉。平台要
  提供版本切换前后 **logprob 分布漂移的在线指标**，加 importance ratio 监控
  作机制化保证。
- **传输形态**：不定长小消息先聚合入湖，走对象存储 / Pulsar 级别的消息通道；
  同一份数据要同时服务在线训练取批和离线回放评估——样本总线是一次写入、
  多处消费的资产，不是一条消息管道。
- **隐性炸弹**：env worker 是 CPU + 网络 + 安全沙箱的混合负载，最容易被
  verifier 的慢接口拖死。环境池要独立网络策略、超时熔断、重试幂等，否则
  打分排队会把上游 rollout 和下游 trainer 一起饿死。

### 4.4 多租户配额：三池独立记账

按"卡数"给租户记账是错误答案：某租户把 rollout 池打满，trainer 池空转；下
一个租户反过来。标准答案：

- **三池独立配额**（trainer / rollout / env 分开记）+ 全局公平调度。
- 更进一步的抽象：配额其实是三个维度——**策略版本数 × rollout 并发度 × 环境
  吞吐**；环境池还要单独加 CPU/网络配额（verifier 慢接口饿死 trainer 的防守）。
- **降级顺序**：quota 超限先降 rollout 副本数，再降训练 batch；
- **抢占策略**：低优先级实验的 rollout replica 先杀——它无状态、重建便宜，
  拉起即回队列。**这是 RL 平台相对预训练平台独有的弹性红利，面试要主动说**。

### 4.5 评估与回放：训练只是手段

- **回放是一等公民资产**：replay buffer 按策略版本可重放、可用新规则重打分
  （reward hacking 排查、奖励函数 A/B 都靠它）；离线 replay 服务独立于训练
  链路配额。
- **评估集群独立配额**：周期性拉 checkpoint 跑 benchmark，结果回写模型
  registry——和训练抢卡的评估等于没有评估。
- 这条链路回答的是面试官心里的真问题：这个平台怎么证明"训练真的在变聪明"？

## 五、数字锚（背下来的一张表）

| 数字 | 口径 | 来源 |
|---|---|---|
| **466 次中断 / 54 天，约八成与硬件相关（2024）** | Llama 3 405B 预训练故障密度 | arXiv 2407.21783 |
| **有效训练时间高于九成、人工介入仅 3 次（2024）** | 自动化故障自愈对齐的 SLO | 同上 |
| **MFU 41%～43%（1.6 万 / 8 千 H100，2024）** | 万卡训练利用率基线 | 同上 |
| **ckpt 落盘亚秒级、进程组重启分钟级（2024）** | 万卡容错优化宣称值 | Meta 工程博客 2024-03 |
| **MFU 55.2%（12288 GPU 训 175B，2024）** | 字节 MegaScale 公开最优档 | arXiv 2402.15627 |
| **异步对比同卡同步最高 2.77 倍加速（2025）** | AReaL fully-async，对 verl main 实测 | arXiv 2505.24298 |
| **staleness 上限取 η=4（代码）/8（数学，2025）** | 异步稳定性的声明式旋钮 | 同上 ablation |
| **动态 batching 平均吞吐提升三成、interruptible 再增 12%～17%（2025）** | 异步 rollout 两个优化项 | 同上 |
| **HybridFlow 吞吐提升 1.53～20.57 倍（2024）** | verl 对 SOTA 基线的对比档 | arXiv 2409.19256 |
| **推理:训练卡数 75:25 优于 50:50（2025）** | 配比起点，非终点 | arXiv 2505.24298 |
| **verl 2.4 万 star、slime 8.6 千、AReaL 5.8 千、SkyRL 2.4 千（2026-10 实测）** | 选型时的社区热度口径 | GitHub API |

## 六、▶ 面试追问

**追问 1：为什么不直接用 verl / AReaL，平台的价值在哪？**
差答案是把框架再讲一遍。高分答案画分界：**框架管"单个作业内"的训推对齐、
权重切换、算法语义；平台管"跨作业"的资源配额、租户隔离、排队调度、replay
资产化、故障自愈、灰度发布**。再补一刀 2026 事实：vLLM 已把权重同步做成
原生 API——意味着"框架收敛成 SDK，平台变成编排层"，平台题考的就是这一层。

**追问 2：同步和异步到底差多少？给我量化。**
背 AReaL 的 2.77 倍（同卡数、对 verl 2025-05 main 实测）和 staleness η。
升级追"异步的代价"：staleness 控制、权重切换时在飞请求的三模式处置、训推
一致性校验、eval 曲线变差的风险。再升："什么时候不用异步？"——小集群，以及
reward 稀疏、中程依赖长的 agentic 任务，staleness 的代价压过吞吐收益。

**追问 3：集群挂了，3 分钟后要恢复，平台要做到什么？**
第一层：分布式 ckpt + 异步落盘 + step 边界一致快照，分钟级重启。第二层：
RL 特有的**恢复四件套**——trainer 权重与优化器、rollout 引擎 weight version、
dataloader 光标、buffer 未消费样本版本戳，漏一个就重复采样污染 on-policy。
顶格引 Llama 3 的 SLO（每天近 9 次中断、有效训练九成以上、人工介入 3 次）
作为目标。

**追问 4：rollout 与 trainer 的卡怎么分配？动态吗？**
别答固定比例。引 75:25 优于 50:50 的实验口径，再说配比应随训练阶段调
（长思维链后期 rollout 变贵）；落到平台能力就是 trainer 池可缩容 + 滚动
腾挪 + 抢占先杀无状态 rollout replica。

**追问 5：多租户怎么记账？**
错误答案按卡数平均；及格答案三池独立配额 + 全局公平调度；高分答案把配额
抽象成"策略版本数 × rollout 并发 × 环境吞吐"三维，并给出超限降级顺序
（先降 rollout 副本、再降训练 batch），环境池单独记 CPU/网络配额。

**追问 6：评估和回放在平台上长什么样？**
replay buffer 一等公民（按策略版本重放/重打分）、独立 eval 集群周期拉
ckpt 跑 benchmark、结果回写 registry。深度提示：主动提 reward hacking
排查依赖"旧样本 + 新奖励函数重打分"，说明你把回放当调试工具而不只是存储。

**追问 7：如果你只能带 8 卡，先做什么？**
考取舍排序：小尺度同步方案起盘（单组 FSDP + 单 vLLM 实例 + 本地 env
worker 池），先把三池逻辑解耦和版本戳账本做对，跑通闭环；再谈异步、
多租户和跨机房。**先闭环、后优化**，功能罗列必失分。

## 串联阅读

- [verl 深度拆解](../interview-questions/训练与对齐/verl深度拆解.md)——本文
  "框架 vs 平台"分界中框架那一半：hybrid-controller、3D-HybridEngine、
  checkpoint_engine 全链路。
- [RL 环境工程专题](../interview-questions/训练与对齐/rl环境工程专题.md)——
  Env·Verifier 池的展开：沙箱、判分咽喉与三池解耦调度。
- [RL 训练工程实战](../interview-questions/训练与对齐/rl训练工程实战.md)——
  RL 训练四个坑（训推不一致、长尾、staleness、checkpoint）的机理与监控。
- [RLHF 与对齐](../interview-questions/训练与对齐/rlhf与对齐.md)——PPO/GRPO
  算法语义侧，平台题里"算法范围"澄清项的展开。
- [设计分布式推理服务](设计分布式推理服务.md)——Rollout 池的孪生题：把
  rollout 当线上 serving 设计的那一面。
- [设计 AI 开发平台](设计ai开发平台.md)——多租户配额、排队与资产化的
  通用平台层方法论，可互相套用。
- [三维并行](../interview-questions/distributed-training/三维并行.md) 与
  [训练框架与稳定性](../interview-questions/distributed-training/训练框架与稳定性.md)——
  Trainer 池内部拓扑与大规模故障自愈的编制内知识。
