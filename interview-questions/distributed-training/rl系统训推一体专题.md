# RL 系统训推一体专题：rollout / trainer / weight sync 三件套的收敛

> **面向**：已读过 [verl深度拆解](../训练与对齐/verl深度拆解.md)（讲一个系统的
> 内部：HybridFlow 两段论与训推一致性三层防线）与
> [agentic-rl专题](../训练与对齐/agentic-rl专题.md)（讲算法侧怎么训多轮轨迹）
> 的读者。本篇把镜头拉远到**系统架构**：2025 下半年到 2026 年，LLM RL 后
> 训练系统在「rollout 集群 + trainer 集群 + weight sync 中间件」三件套上
> 收敛出的通用拓扑。版本线与框架 release 横评在
> [训练框架2026新进展](./训练框架2026新进展.md)，本篇只挖通用结构与机制，
> 不重复版本流水账。
>
> **读完获得**：① 「SFT 只有一个引擎，RL 一步驱动四类引擎」的矛盾根源叙事；
> ② 三件套拓扑的完整数据流（prompt → rollout → buffer → trainer → 权重回灌）；
> ③ colocate vs disaggregated × sync vs async 两轴四组合的选型话术与
> verl v0.9 三模式命名；④ weight sync 三条实现路线（NCCL 全量广播 /
> checkpoint-engine 分桶流水 / delta 稀疏同步）与全部数字锚；⑤ 异步化三道闸
> （staleness 上限 / 离策略修正 / partial rollout）与 AReaL 全异步证据；
> ⑥ 五大系统 + 中间件的横评定位；⑦ 七条坑位清单；⑧ 八道面试题的完整答法。
>
> **时效口径**：2026-10（截至 2026-10-12）；star 数与 repo 活跃度为当日
> `gh api` 当场实测，版本日期取 GitHub release notes 原文，倍数类数字凡未经
> 第三方复现的一律带「官方自测 / 厂商口径」前缀，未核实项只进文末
> 「口径与未核实说明」。

## 一、主线直觉：为什么 RL 系统会收敛成「三件套」

一句话直觉：**矛盾的根源在于，SFT 只需要一个引擎，RL 一步却要驱动四类
引擎——rollout（推理生成）、actor（训练）、reference、reward/critic——
而「生成 ↔ 训练」流水线的切换开销，就是全部系统矛盾的总根。**

2024 年各家还是各写各的胶水代码：训练脚本里内嵌一段 vLLM 离线 generate，
生成完把权重 state_dict 搬来搬去。2025 下半年到 2026 年，三件套出现了明显
的收敛形态：

1. **rollout 全面服务器化**：vLLM / SGLang 的 router + server 常驻，不再
   每一步 spawn 一批临时推理进程。verl 的 RolloutReplica、slime 的 SGLang
   server 化 rollout、OpenRLHF 的 vLLM engine 常驻，都是同一个方向。
2. **trainer 抽象统一**：verl v0.9（2026-08-14）把 sync / colocate_async /
   separate_async 三种摆放收进同一个 V1 trainer，共享同一控制流、同一
   replay buffer 与指标面。
3. **weight sync 独立成中间件层**：从「每步全量 NCCL 广播」演化成独立项目
   ——MoonshotAI 的 checkpoint-engine（2025-09 立项）、verl 的
   delta_sharded、slime 的 disk-delta 与 straw 持久队列。权重更新这件事
   2024 年还是附属功能，2026 年已经是能单独立项的竞争点。

驱动这场收敛的量化依据是那句被反复引用的话：RLHF 训练**约八成时间花在
sample generation**（OpenRLHF README 口径，2026）。既然瓶颈在生成与生成
↔训练的切换，系统的演化方向就只剩三个：让 rollout 更像在线服务（吞吐）、
让切换更便宜（colocate 与 sleep/wake）、让剩下的串行段（weight sync）变得
接近免费（中间件与 delta）。

<div class="diagram-embed">
<iframe src="assets/diagrams/rl-training-inference-convergence.html" width="100%" height="855" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/rl-training-inference-convergence.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、机制拆解：一步 RL 的完整数据流

把「三件套」展开成一条数据流，五个站点：

```
prompt(+环境会话) → rollout 集群 → data buffer → trainer 集群 → weight sync → 回到 rollout
```

1. **prompt + 环境会话池**：任务源。multi-turn 场景里 rollout 不是一次性
   生成，而是与环境 / sandbox 往返多轮（工具调用、代码执行、网页交互），
   环境侧的形态问题归 [rl环境工程专题](../训练与对齐/rl环境工程专题.md)，
   本篇只看系统结构。
2. **rollout 集群**：推理引擎 + router 常驻，做高吞吐连续生成。vLLM 与
   SGLang 是 2026 年的两个主流后端（差异见
   [vllm与sglang深度对比](../inference/vllm与sglang深度对比.md)）。
3. **data buffer / replay queue**：trajectories 的落脚点。slime 用 Ray
   object-store 或 straw 持久队列（共享文件系统上的持久队列 + 张量存储），
   verl 用 TransferQueue，AReaL 走自己的 replay。
4. **trainer 集群**：拉一批样本，算 log-prob、反向、更新。ref / critic /
   RM 挂在 trainer 侧（GRPO 系配方省掉 critic）。训练后端是 Megatron 或
   FSDP 这代主流。
5. **weight sync 层**：把新权重灌回 rollout 引擎，开始下一轮。

注意「四引擎」是逻辑角色：rollout / actor / ref / critic。落到物理资源上
只有两种摆法——同卡还是分卡，这就是下一节的两轴。

## 三、两轴四组合：colocate vs disaggregated × sync vs async

### 3.1 轴一（资源轴）：训推同卡还是分卡

**colocate（在位）**：rollout 引擎与训练进程共享同一批 GPU。靠 sleep/wake
机制在生成与训练两个阶段之间腾显存——vLLM 的 sleep 接口 + DeepSpeed 的
sleep 接口（OpenRLHF 官方推荐 colocate 形态）。省下整整一组推理节点的卡，
代价是显存账必须算平（推理 mem_fraction + 训练峰值 ≤ 单卡容量，见第八节
坑位），以及生成与训练严格串行。

**disaggregated（卸载 / 分卡）**：rollout 与 trainer 各占一组节点，生成与
训练可以并行流。代价是必须解决「权重怎么跨集群送」——这就是 weight sync
之所以能独立成第三件的原因。

### 3.2 轴二（时间轴）：同步还是异步

同步：rollout 产一批 → 等 trainer 更新 → 灌回权重 → 再产下一批，严格
on-policy。异步：rollout 与 trainer 长短流水并行，rollout 永远不空转，
代价是样本可能是用旧权重采的（off-policy，staleness 问题见第六节）。

verl v0.9.0（release notes，2026-08-14）把这个设计空间明确命名成三种
模式，面试直接背这套命名：

| 模式 | 轴一 | 轴二 | 一句话 |
|---|---|---|---|
| `sync` | colocate | 同步 | 同卡交替，sleep/wake 腾显存，最省卡 |
| `colocate_async` | colocate | 异步 | 同卡但生成与训练流水并行 |
| `separate_async` | disaggregated | 全异步 | 训推分集群，rollout 永不空转 |

### 3.3 colocate 的王牌：CUDA IPC 零拷贝直通

同卡形态有个独有的杀手锏——权重更新**可以完全不拷贝数据**。NeMo-RL 的
colocate refit 流程（discussion #1189）：policy worker 把训练侧参数打包成
CUDA IPC buffer handle 传给 vLLM executor，同卡时是**零数据拷贝**的指针级
交接；分卡时退化走 RDMA / 网络传输。这是 colocate 在 weight sync 开销上的
结构性优势，也是 disaggregated 必须用 checkpoint-engine 这类中间件去追平
的账。

## 四、weight sync 三条实现路线（2026 收敛形态）

被问「权重怎么同步」就按这三条路线讲，从基线到前沿：

### 4.1 路线 a：NCCL 全量广播（基线）

trainer 各 rank 把参数按推理引擎的新并行布局 gather / reshard 之后，经
NCCL broadcast 直接灌进推理引擎显存。实现最简单、无外部依赖，但**每步都
送全量模型字节**——模型越大、步数越多，串行段越长。这是所有优化想替代
的对象。

### 4.2 路线 b：参数服务器 + 分桶流水（checkpoint-engine）

MoonshotAI checkpoint-engine 的三段流水：**依次走完 H2D → broadcast →
reload 三段**。
CPU 侧持有分片引用，分桶广播进 CUDA IPC buffer，每个推理引擎实例只挑选
自己 shard 的子集拷贝；控制面用 ZeroMQ 调度引擎。另有一条 P2P 模式用
mooncake-transfer-engine（RDMA）给**新加入的推理实例**单补权重——这是
「Mooncake 传输层复用到训推一体」的直接证据。

官方 benchmark 表（vLLM v0.10.2rc1 实测，厂商口径）：

| 模型 | 规模 | broadcast 耗时 |
|---|---|---|
| GLM-4.5-Air BF16 | 8×H800 | 3.47s（3.02GiB/桶） |
| DeepSeek-V3.1 FP8 | 16×H20 | 10.19s |
| Kimi-K2-Instruct FP8 | 16×H20 | 14.36s |
| Kimi-K2-Instruct FP8 | 256×H20 | 16.04s |

这张表的读法：实例数从 16 扩到 256、耗时只从 14.36s 涨到 16.04s——
**实例扩 16 倍、耗时几乎不翻倍**，正是分桶流水 + IPC 直通要证明的扩展性。
README 另有背书：Kimi-K2（1T 参数）跨数千 GPU 更新约 20s（与 Kimi-K2
技术报告口径一致），这是 weight sync 的旗舰数字锚——**1T 参数约 20 秒**
（官方口径，2025–2026）。

### 4.3 路线 c：delta / 稀疏同步

verl v0.9 的 `delta_sharded`：每个 actor rank 只对自己的 shard 和一个钉在
CPU 上的同尺寸快照做 byte-diff，稀疏 gather 出（位置, 值）对，推理侧经
custom-weight-loader 原位打补丁——**任何 rank 都不持有全模型快照**。slime
有同款思路的 disk-delta（shared storage 上只送变化字节）。

verl v0.9.0 release notes 官方自测（H100、GSM8K GRPO、separate_async、
SGLang rollout），delta_sharded vs 全量 NCCL broadcast：

| 模型 | 加速比 |
|---|---|
| 7B | **2.4×** |
| 32B | **1.9×** |
| 72B | **3.1×** |

三条路线的选型直觉：步步全量且模型不大 → 路线 a 够用；超大模型 + 弹性
扩缩实例 → 路线 b；权重变化稀疏（GRPO 系每步改动有限）→ 路线 c 把传输量
打到地板。

## 五、并行度映射（resharding / refit）：训练布局 ≠ 推理布局

训练并行（如 EP64PP8）与推理并行（如 TP64）几乎从不一致，所以 weight sync
不只是搬运，还包含一次**布局转换**。refit 三步：

```
gather 训练 shard → 转换命名/布局 → reload 推理 shard
```

两条实现路线：FSDP 系靠 full-param 的 CUDA IPC 直通（NeMo-RL）；Megatron
系靠 mbridge 类映射层（verl Megatron-Bridge param mappings 覆盖 TP+EP 与
hybrid-Mamba；v0.9 把 VeOmni 的 expert all-gather 改成分组顺序广播，
weight-refit 峰值显存从 O(E) 降到 O(E/ep_size)）。

教学级案例是 NeMo-RL 的 colocate refit 优化（discussion #1189，2025-08，
DeepSeek-V3、训练 EP64PP8 → 推理 TP64）：**单次 refit 从 692.5s 压到
47.2s，提速约 14.7×。**（官方数字）三招都有面试价值：

1. **tensor packing**：原先 9 万个参数逐张 wrap IPC handle（每次
   rebuild 约 0.18ms，合计约 16s），优化后每桶只做一次。
2. **绕开 collective_rpc**：vLLM 的 collective_rpc 开销随 TP size **二次
   增长**，改为逐 executor 直调后变成线性——「为什么随 TP 二次增长」本身
   就是一道高频追问。
3. **元数据提前准备**：名字映射、shard 索引等全部离线算好。

优化后的 SOL（speed-of-light）参考：gather 3.3s、传输约 0s（同卡 IPC）、
load 0.01s——**传输项被打到接近零**，再次印证 colocate 直通的价值。

## 六、异步化三道闸与 partial rollout

全异步（separate_async / colocate_async）让 rollout 和 trainer 的长短流水
并行，rollout 永不空转；代价是样本用旧权重采样，训练分布偏移。2026 年
工业界控制 staleness 的共识是**三道闸**，按「系统 → 算法 → 生成分布」
分层布置：

### 6.1 闸 a（系统侧）：staleness 上限

- AReaL 用 `max_head_offpolicyness` 控制样本最多落后多少个权重版本，设 0
  即退化为同步系统。
- verl v0.9 用 `max_off_policy_threshold` 配 `drop` / `wait` 两种处置：
  超限样本要么丢弃、要么等训练追上来再用。

### 6.2 闸 b（算法侧）：离策略修正

- staleness-aware 的解耦重要性采样（AReaL decoupled PPO，行为策略与目标
  策略的 ratio 分开处理）。
- TIS（truncated importance sampling，截断重要性采样）：OpenRLHF 提供
  token / sequence 两级 correction，外加 mask / clip 门控与阈值，参数面
  是各家最齐的。算法细节归 [agentic-rl专题](../训练与对齐/agentic-rl专题.md)，
  本篇只定位它在系统闸里的位置。

### 6.3 闸 c（接受「半旧半新」）：partial rollout

权重更新时**不打断在途请求**：同一条 response 的前半段 token 用旧权重、
后半段用新权重生成——on-policy 性变成「条内混合分布」，再交给 TIS 修正。

- OpenRLHF 的 partial rollout 用 vLLM 的 pause / resume 实现；
- slime v0.4.0 的 PipelineRL 有 flush-cache-interval 机制：未完成的请求
  连同 KV cache 扛过若干次权重更新，不在每次更新时全部清空。

追问点天然在这里：「partial rollout 复用会不会毁掉 on-policy 性？」答法
是写出混合分布，再说明 TIS 怎么修（见第九节 Q6）。

### 6.4 全异步的收益与风险

收益锚点：AReaL boba²（2025-06-03，arXiv 2505.24298）报告**全异步相比
同步系统提速 2.77×，训练效果相当或更好**（AReaL v0.3 blog/paper，厂商
自述口径）。这是「异步化值得做」的旗舰数字。

风险口径同样要会背，OpenRLHF 官方风险提示原文大意为：async 影响收敛
稳定性，只在吞吐关键且收敛已验证时启用。这句话的结构本身就是答题模板：
**先讲收益数字，再讲适用边界**。

## 七、系统横评（star 与日期均 2026-10-12 `gh api` 当场实测）

| 系统 | star | 一句话定位 | 本篇视角 |
|---|---|---|---|
| verl（verl-project/verl，字节 Seed 发起，2026-01 迁社区） | 23,826★ | RL 框架王座 | v0.9 三模式 + delta_sharded + PD 分离 rollout，本篇最密的系统素材 |
| OpenRLHF | 10,079★ | Ray + vLLM + DeepSpeed ZeRO-3 经典分卡标杆 | hybrid engine(colocate) / async / async+partial rollout 三档取舍旋钮，TIS 参数面最齐 |
| slime（THUDM/智谱） | 8,632★ | Megatron 训练 + SGLang server 化 rollout + data buffer 三段式 | v0.4.0（2026-10-09）同步/全异步统一进 train.py；straw 持久队列 |
| AReaL（蚂蚁 inclusionAI + 清华 IIIS） | 5,828★ | 全异步 RL 系统论文线 | v2.0（2026-07-01）重构为微服务：training / inference / agent / weight-update 四服务 |
| NVIDIA NeMo-RL | 2,058★ | DTensor(FSDP2) 与 Megatron-Core 双训练后端 + 三套 rollout | colocate refit 优化 10× 工程博客是 weight sync 教学标准素材 |
| MoonshotAI checkpoint-engine | 1,007★ | weight sync 中间件单独立项的标志事件 | 1T 参数数千 GPU 约 20s（README 背书） |

补两条有叙事价值的细节：

- **verl 的 v0.9 系列**（v0.9.0 2026-08-14，v0.9.1 2026-09-20）一次性
  给出：统一 V1 trainer 三模式、delta_sharded、vLLM PD 分离 rollout
  （1 prefill + N decode，经 NIXL / Mooncake 传输）、平台插件层（寒武纪 /
  沐曦 / 天数 / 燧原 / 昆仑参考实现）。
- **slime 的官方背书**：README 自述 GLM-4.5 → GLM-5.3 全系列 RL 由它
  训练（厂商自背书口径）；straw 把 rollout 编排分布到每个 Ray 节点的
  CPU，任务 / partial rollout / 样本可持久化——训练进程崩了可以不动
  Serving 集群、只重提训练，这是 failure 恢复设计题的范本（第九节 Q7）。
- **NeMo-RL 的战绩**：Nemotron-3 Nano/Super/Ultra、Minimax-M3 day-0 由
  它训出；v0.6.0（2026-04-30）加 SGLang/Muon/投机解码，v0.7.0
  （2026-07-25）加 PPO/CISPO。

生态周边（同日实测，知道量级即可）：MiniMax 衍生 radixark/miles 3,089★
（slime fork）、阿里 ROLL 3,419★、Berkeley NovaSky-AI/SkyRL 2,402★、
PrimeIntellect-ai/prime-rl 2,152★、字节 ByteDance-Seed/VeOmni 2,236★
（训练后端，供 verl 复用）。

## 八、坑位清单（来自各项目文档与代码注释）

1. **colocate 显存账算不平**：推理 mem_fraction + 训练峰值必须 ≤ 单卡。
   OpenRLHF 模板把 vLLM 侧 gpu_memory_utilization 设为 0.5 留出余量——
   面试官追问「为什么不打满 0.9」就答训练峰值与通信 buffer 的存在。
2. **FP8 权重更新要打 patch**：vLLM 原生不直接支持更新 FP8 权重，需打
   checkpoint-engine 的 patch（在 DeepSeek-V3.1 / Kimi-K2 上验证过）——
   没打 patch 的症状是权重灌进去推理输出乱码。
3. **NCCL broadcast buffer 尺寸竞态**：bucket 尺寸与 `_compact_for_bucket`
   的交互竞态（verl #7107 / #7139），症状是偶发挂死或数据错位。
4. **sleep/wake 的权重保留遗漏**：CUDA Graph 与 MTP drafter 的权重在
   sleep/wake 序列里要显式保留（verl #6661），否则醒来后的投机解码用
   的是脏权重。
5. **Ray 的 GPU index 错配**：环境变量
   `RAY_EXPERIMENTAL_NOSET_CUDA_VISIBLE_DEVICES=1` 下，进程内
   `cuda:0` 与物理卡号不再对齐，NCCL 组通信错卡而挂死。
6. **straw 的存储后端单一**：slime 的 straw 数据管道目前只验证过
   JuiceFS，换别的共享文件系统要自己验证一致性语义。
7. **超长轨迹的精确 abort**：OpenClawing 类超长轨迹里，单个超时请求要
   能穿透 router 对后面的 SGLang worker 精确 abort（slime #2340），
   粗粒度 kill 会误伤同节点其他在途请求。

## 八·增、2026 六条增量：SAO / SAT / Mooncake RL / NIXL 同步 / SpecActor / QwenGyre

- **SAO（智谱 GLM 5.2）**：单轨迹异步 + 双侧重要性裁剪 + 快更新价值模型；
  1000 步稳定 vs GRPO 160 步崩，AIME **97.3/84.2**。解决的是「组采样
  本身就是同步屏障」，把 wait 从组内挪到轨迹级。
- **SAT（腾讯混元）**：用 `|log ρ|` 作陈旧度代理，逐 token 收窄裁剪半径；
  lag=1 **35.83**、lag=8 **34.79**，失配约 **10×**。与固定 clip 的差别是
  「按陈旧度自适应」，不是又一个 trust region 超参。
- **Mooncake for RL**：控制面/数据面分离，按字段布局打包碎片化 rollout；
  GET **10–14×**、PUT **1.2–1.6×**，单样本 **3,422B**。把 KV 池的
  transfer engine 复用到 rollout 数据搬运。
- **NIXL 权重同步**：单边 RDMA + lazy 张量 trace 拆「前缀寻址/后缀重放」；
  **86.1s→3.9s**、1.6TB、单卡 **45GB/s**。权重热更从「全量广播」变成
  「按需拉取」。
- **SpecActor**：草稿与验证分卡解耦，按接受率调 draft window，尾部叠加
  多草稿；rollout 占 **70–80%**，提速 **2.0–2.4×**、端到端 **1.4×**。
  与推理侧投机解码同源，但优化的是 rollout 墙钟而非 TPOT。
- **QwenGyre**：弹性 RL，按未完成 rollout 动态重分 GPU，TITO 轨迹树
  前缀去重；**1.85×**、75.42h vs 91.47/134.55h、**+6.0pp**。解决的是
  「长尾 rollout 拖死整批」的资源轴，不是算法轴。

**一句话定位**：SAO/SAT 改异步优化，Mooncake/NIXL 改数据与权重搬运，
SpecActor 改 rollout 生成，QwenGyre 改资源重配——六条分别落在算法、
数据面、生成、调度四个接口上。

### 八·增二、A2 速记：两条 RL 系统增量

- **Miles（31）**：小核心插件化；Rollout Routing Replay 让训练/推理的
  MoE 路由对齐；解决的是「同一 token 在两侧走不同 expert」。
- **GLM-5 万亿参数 RL（45）**：Wide EP + PD 分离 + R3 路由重放 +
  DSA 自定义 CP；28×H200；**131k 序列**；步长 **<5min**。

## 九、▶ 高频面试题 8 条（全收）

**Q1【极高】colocate vs disaggregated 怎么选？**
浅答：colocate 省卡（一组 GPU 两用）、disaggregated 解耦（训推各自扩
缩容与迭代）。深答四个点：colocate 的 sleep/wake 显存账（mem_fraction +
训练峰值 ≤ 单卡）与 CUDA IPC 零拷贝直通（NeMo-RL refit 同卡传输约 0s）；
disaggregated 的 staleness 控制成本与 weight sync 中间件成本；verl v0.9
三模式命名（sync / colocate_async / separate_async）可直接引用；选型
的尾部因素是容错域——分卡后训练与推理可以独立挂、独立重启。（§3、§5）

**Q2【极高】全异步 RL 的 staleness 怎么控？对收敛什么影响？**
三道闸：系统侧 staleness 上限（AReaL max_head_offpolicyness，设 0 退化
同步；verl max_off_policy_threshold + drop/wait），算法侧离策略修正
（decoupled PPO、TIS token/seq 两级 + mask/clip 门控），分布侧 partial
rollout（条内新旧权重混合 + TIS 修）。收益锚：AReaL **全异步提速
2.77× 且效果相当或更好**（arXiv 2505.24298，2025-06，厂商自述）；
风险口径：OpenRLHF 官方说只在吞吐关键且收敛已验证时启用。（§6）

**Q3【高】weight sync 怎么做？1T 参数要多久？**
三路线：NCCL 全量广播（基线）、checkpoint-engine 三段流水
H2D→broadcast→reload（分桶 + 引擎自选 shard 拷贝 + ZeroMQ 控制面，
P2P 用 mooncake-transfer-engine 给新实例补权重）、delta 稀疏同步
（delta_sharded 按 shard byte-diff，推理侧原位打补丁）。数字锚：1T 参数
**跨数千 GPU 约 20 秒完成更新**（checkpoint-engine README，与 Kimi-K2
技术报告口径一致）；16 → 256 实例耗时 14.36s → 16.04s 近线性；verl
delta_sharded 官方自测 7B/32B/72B 加速 2.4×/1.9×/3.1×。（§4）

**Q4【高】训练并行 EP64PP8、推理 TP64，权重怎么转换？**
refit 三步：gather 训练 shard → 转换命名/布局 → reload 推理 shard。
FSDP 路线靠 full-param IPC 直通，Megatron 路线靠 mbridge 类映射层
（expert all-gather 改分组顺序广播，峰值显存 O(E) → O(E/ep_size)）。
教学案例 NeMo-RL：**从 692.5s 压到 47.2s、约 14.7× 的加速**，三招——tensor packing
（9 万参数逐张 wrap ≈ 16s 减到每桶一次）、绕开 collective_rpc（开销随
TP size 二次增长，改逐 executor 直调变线性）、元数据提前准备。（§5）

**Q5【高】vLLM vs SGLang 做 rollout 后端的差异？**
四个可答的点：sleep/wake API 的形态差异（colocate 显存腾挪的手感）；
TIS / correction 支持面；PD 分离的支持路线（verl v0.9 用 vLLM 做
1 prefill + N decode，经 NIXL/Mooncake）；生态绑定——slime 选 SGLang
router 服务器化，tito 类服务负责多轮 token continuity 对齐。更深的引擎
对比已另有专题，本篇只答 RL 配套面。（§2、§4）

**Q6【中】partial rollout 复用会不会毁掉 on-policy 性？**
会改变生成分布但可控：一条 response 前段 token ~ 旧权重、后段 ~ 新权重，
样本来自「条内混合分布」。写法上把行为策略表示成分段混合，再用 TIS 修
正偏差。工程实现两个代表：OpenRLHF 用 vLLM pause/resume；slime
PipelineRL 用 flush-cache-interval 让未竟请求 + KV cache 扛过若干次权重
更新。收益是权重更新零等待、在途请求不浪费。（§6.3）

**Q7【中】RL 系统的 failure 恢复怎么设计？**
slime v0.4 范本是教科书：训练进程独立于 Serving 集群，训练崩溃只重提
训练、不动 rollout 池；straw 把任务 / partial rollout / 样本持久化到共享
文件系统，重启后可续。配套点：权重同步控制器带版本号对齐，恢复后先对齐
rollout 侧权重版本再续训。（§7）

**Q8【中】既然八成时间在 generation，下一步该优化什么？**
开放题，给结构化的三层：① 串切换开销——生成与训练的交接段（weight
sync + 引擎唤醒）按第四、五节继续往秒级零头压；② 长胖样本的 dispatch
——multi-turn 长尾轨迹的调度与精确 abort（坑位 7）；③ reward 侧异步
——verifier / RM 打分从关键路径上摘出去异步化。答题时先重申依据：**约
八成时间花在 sample generation**（OpenRLHF README 口径）。（§1、§8）

## 十、口径与未核实说明

- **star 口径**：verl 23,826★ 为本篇 2026-10-12 `gh api` 实测；
  [verl深度拆解](../训练与对齐/verl深度拆解.md)文中 23,810★ 为
  2026-10-10 实测、[训练框架2026新进展](./训练框架2026新进展.md)文中
  23,825★ 为此前同日另一次实测，差异系测量时点不同（star 逐日自然
  增长），以本篇 2026-10-12 数字为最新口径。
- **厂商自述口径**（未经第三方复现，正文已带前缀）：AReaL 2.77×；verl
  delta_sharded 1.9×–3.1×；checkpoint-engine 的 1T≈20s 与其 benchmark
  表；NeMo-RL refit 14.7×；OpenRLHF「八成时间在 generation」。
- **slime 战绩**：「GLM-4.5 → GLM-5.3 全系列 RL 由 slime 训练」出自
  slime README 自背书；GLM 官方博客链接存在但未逐篇进文核实训练栈表述。
- **未核实：「字节 Seed-RM」**。ByteDance-Seed org 公开仓库列表
  （2026-10-12 实测）中无同名项目；字节 2026 年 RL 系统侧公开出口即
  verl + uni-agent（verl v0.9.0 release notes 提及）与
  ByteCheckpoint/VeOmni。若指某篇论文或内部系统名，需另行核实，正文
  不引用。
- HybridFlow 论文 1.53×–20.57× 加速比本次未重查原文，引用以
  [verl深度拆解](../训练与对齐/verl深度拆解.md)与论文 Table 2 为准。

## 串联阅读

- [训推逐位一致专题](./训推逐位一致专题.md)：本篇管「新旧权重版本之间」
  的策略差（TIS/partial rollout）；该篇管「同一权重版本、两个引擎之间」
  的数值差（diff=0 五要素与逐算子 recipe）——两层问题别混答。
- [verl深度拆解](../训练与对齐/verl深度拆解.md)：单系统内部——HybridFlow
  两段论、单控制器 driver、训推一致性三层防线；本篇把其中的权重直通
  拉远成三件套拓扑的通用结构。
- [agentic-rl专题](../训练与对齐/agentic-rl专题.md)：算法侧——多轮轨迹的
  GRPO/GiGPO 与 TIS 细节；本篇 §6 只给 TIS 的系统闸位置。
- [rl训练工程实战](../训练与对齐/rl训练工程实战.md)：训练侧四个坑
  （verifier 漏刷、熵坍缩、数据筛选、长思维链），与本篇 §8 坑位清单互补。
- [训练框架2026新进展](./训练框架2026新进展.md)：版本线横评——本篇不发
  布日期流水账，框架的 release 细节以该篇为准。
- [rl环境工程专题](../训练与对齐/rl环境工程专题.md)：环境侧——Env-as-a-
  Service、verifier 咽喉与 sandbox 选型；本篇 §2 的「环境/sandbox 往返」
  在那里展开。
- [vllm与sglang深度对比](../inference/vllm与sglang深度对比.md)：rollout
  两个主流后端的架构对比，本篇 Q5 只答 RL 配套面。
- [设计rl训练平台](../../system-design/设计rl训练平台.md)：系统设计题形式
  的三池编排（Rollout 池 / Env·Verifier 池 / Trainer 池），与本篇拓扑图
  互为参照。
