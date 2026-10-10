# veRL 深度拆解：HybridFlow 两段论、零冗余权重直通与训推一致性三层防线

> 本篇面向已经知道 GRPO/PPO 公式、准备「RL 训练框架 / AI Infra」追问线的读者。
> 读完能获得：① RL 训练框架到底在解决什么题（RLHF 四引擎协作的开销账）；② veRL 的
> 两段论架构（hybrid-controller + 3D-HybridEngine）与论文 Table 2 的账怎么算；
> ③ 当前 main 分支代码地图（engine/worker/rollout/checkpoint_engine/core_algos/
> rollout_correction/agent_loop），直接可背目录路径；④ 六道高频率面试题的递归答法。
> 时效口径：star 数与生态横评均为 **2026-10-10 实测**；代码地图对应该时间点 main 分支，
> 旧叙事里的 `verl/workers/sharding_manager/` 目录已不存在（重构为 engine 层流式导出 +
> checkpoint_engine 抽象层），被追问"演进"时可主动提这一笔。

## 一、直觉：RL 训练框架解决什么题

SFT 训练只需要一个引擎：读数据、前向反向、更新。RLHF/GRPO 一步要同时驱动**四类引擎**：

1. **rollout 引擎**（vLLM/SGLang）高吞吐生成一批 trajectories；
2. **actor 训练引擎**（FSDP/Megatron）重算 log-prob、反向、更新；
3. **ref 引擎**算参考 log-prob（算 KL 时）；
4. **critic 引擎**估计 value（PPO 才要，GRPO 省掉）。

一步之内，**同一批 GPU 要在四个角色之间来回切换**：生成好了权重还要同步给推理引擎，推理
引擎的显存要为训练让位，训练完权重又得发回去。两个朴素解法都难堪：

- **分卡**（rollout 占一组卡、训练占另一组卡，OpenRLHF 的默认形态）：权重同步要靠
  落盘或全集群广播，生成与训练串行时一半算力在空转；
- **同卡复用**（DS-Chat 式全单控制器）：切换时权重重复物化、通信量大、调度链僵化。

veRL 的全部设计都在回答一个问题：**怎么让这条"生成↔训练"流水线的切换开销趋近于零**。
答案是两段论：**hybrid-controller 编程模型**（编排层灵活 + 计算层低延迟）+
**3D-HybridEngine**（训推同卡 colocate + 零显存冗余 resharding）。

位置上先钉死：**veRL 是 HybridFlow 论文（EuroSys 2025，arXiv 2409.19256）的开源实现**，
字节 Seed 发起，2026/01 迁入 verl-project org 社区维护，Apache-2.0。star **23,810**
（2026-10-10 实测）。它是 GRPO/RLVR 后训练的事实标准之一：DAPO、VAPO、
Seed-Thinking-v1.5、Seed-Coder、Doubao-1.5-pro 都用它训练；采用者还包括 ByteDance
Seed、Moonshot（Kimi）、Qwen、StepFun、小红书、Microsoft（rStar2-Agent）、
All Hands AI、清华、Berkeley 等。

## 二、两段论之一：hybrid-controller 编程模型

RL 数据流图（rollout → 优势计算 → PPO 更新）其实不大，但**图节点之间的调度很频繁**：
每一步都要在多个模型、多组数据分片之间路由。veRL 把控制器需求拆成两层：

- **数据流层：single-controller**。一个 Ray driver 编排整条数据流（DataProto 分片在
  节点间流转），图节点少、调度灵活，加新算法/新角色不用改分布式通信逻辑；
- **模型内计算层：multi-controller（SPMD）**。单个模型内部的前后向/推理用 SPMD 模式，
  各 worker 自己跑计算、点对点通信，不被单点串行化，保住低延迟。

对照两个参照物（面试常一起问）：**DeepSpeed-Chat 是全单控制器**——RL 数据流和模型内
计算都过同一个 driver，数据流灵活但模型内调度僵化；**OpenRLHF 是每个模型一个 Ray
actor**——模型内自己控，但跨模型的数据路由要靠 actor 间互相推，做复杂数据流（多轮
rollout、partial rollout）时调度链又长又碎。hybrid-controller 取的是两者交集：
跨模型用单控制器、模型内用多控制器。

## 三、两段论之二：3D-HybridEngine——训推同卡 + 零冗余 resharding

这是论文最核心的一个 trick，也是面试拆解的重头。拆开三件事：

**① colocate 同卡复用。** rollout 引擎和训练引擎跑在**同一批 GPU** 上，用
wake/sleep 切换：生成时推理引擎醒、训练侧让位；训练时反过来。算力不分卡、不落盘。

**② 零显存冗余 resharding。** 训练并行度记为 `(p, t, d)`（PP/TP/DP），生成并行度
`(pg, tg, dg, d)`。关键设计是 `dg = p·t/(pg·tg)` 的 **micro DP group 只存在于生成
阶段**——切换时按 `t/tg` 的间隔重排 rank 分组，使每张卡上现有的那一份训练权重分片
**恰好就是生成要用的分片**，权重一份不复制，显存冗余为零；all-gather 只发生在 micro
DP group 内部，并行展开。

**③ 对照群（论文 Table 2，M = 参数量，背口径）**：

| 框架 | 权重同步通信量 | 峰值显存（权重副本） | 冗余 |
|---|---|---|---|
| DS-Chat | `(tpd−1)/(tpd)·M`（近似全部） | `M` | `1/(tpd)·M` |
| HybridFlow-V（镜象版） | `(tp−1)/(tp)·M` | `M` | `1/(tp)·M` |
| HybridFlow（veRL） | `(tp−tg·pg)/(tg·pg·tp)·M` | `1/(tg·pg)·M` | **0** |

一句话口径：HybridFlow 的通信量系数从"接近 1"压到 **(tp−tg·pg)/(tg·pg·tp)，**
峰值权重副本从整份 `M` 压到 **1/(tg·pg)·M**，冗余直接压到 **0**——而竞品要么
复制整份权重（分卡），要么在切换时整份广播（单控制器）。

## 四、headline 数字（论文口径，被问"好在哪"时背）

- 端到端吞吐：**1.53×~20.57×** vs DeepSpeed-Chat / OpenRLHF / NeMo-Aligner，
  扫描范围 7B~70B、8~128 GPU；
- PPO 细分：对 DS-Chat 平均 **3.67×**，对 OpenRLHF **3.25×**，
  对 NeMo-Aligner **12.52×**；
- 70B 平均 **9.64×**；
- 强扩展效率 **66.8%。**

<div class="diagram-embed">
<iframe src="assets/diagrams/verl-arch.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/verl-arch.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 五、代码地图（2026-10 main 分支）

下面按一次 RL step 的执行顺序走代码目录，括号里是文件路径，背这句就背路径。

### 5.1 Engine：训练后端五种

- 基类 `verl/workers/engine/base.py`，实现五种：**FSDP**（`fsdp/transformer_impl.py`）、
  **Megatron**（`megatron/transformer_impl.py`）、**torchtitan**、**veomni**、
  **automodel**。生产推荐 **FSDP2**。
- Megatron 走 **Megatron-Bridge**：`verl/models/mcore/bridge.py` 的 `AutoBridge`
  （`from_hf_pretrained` → `to_megatron_provider` → `export_hf_weights`），干的就是
  **HF 权重布局 ↔ Megatron TP/PP 布局的双向转换**（conversion tasks）。

### 5.2 Worker：hybrid-controller 的落点

`verl/workers/engine_workers.py`：

- **TrainingWorker**：`train_batch` / `infer_batch`；
- **ActorRolloutRefWorker**：`compute_ref_log_prob` / `compute_log_prob` /
  `update_actor`——actor、rollout、ref 三个角色共用一个 worker，driver 一次调用、
  内部 SPMD 展开，这就是"数据流单控制器 + 计算多控制器"在代码里的样子。

### 5.3 Rollout：三种模式 + RolloutReplica

- 引擎适配层：`verl/workers/rollout/{vllm,sglang,trtllm}_rollout/`；
- **RolloutMode 三种**：`colocated`（同卡，默认）、`hybrid`（部分分隔）、
  `standalone`（独立分卡）；
- **RolloutReplica**（`replica.py`）：`init_colocated` / `init_standalone` +
  `wake_up` / `sleep` / `clear_kv_cache`。colocate 模式下显存让位靠 vLLM sleep：
  **level 1 = 把权重 offload 到 CPU，level 2 = 直接丢弃权重**。注意 level 1 在
  KV 占用大时可能仍 OOM（追问点）。

### 5.4 参数同步：两条路径

**colocate 路径（不落盘，流式）**：

actor 流式导出命名张量——FSDP 走 `get_per_tensor_param`（含 `layered_summon`
分层召唤、`unfuse_moe_params` 把 EP 融合专家**反融合**回独立专家、LoRA merge）；
Megatron 走 `bridge.export_hf_weights`——经 checkpoint_engine 的 streaming
`send_weights` 发给 vLLM 的 `update_weights_from_ipc`，bucket 粒度由
`update_weights_bucket_megabytes` 控制。全程**权重不出 GPU/不进磁盘**。

**独立 rollout 路径**：`verl/checkpoint_engine/` 抽象了六类 backend——

- `naive`：torch.distributed all_gather，colocate on-policy 用；
- `nccl` / `hccl`：固定集群 off-policy；
- `nixl`：ring p2p（UCX/Mooncake 传输层），**弹性 rollout + 异构硬件**场景；
- `kimi_checkpoint_engine`：Mooncake p2p + broadcast——actor 先把权重 offload CPU →
  p2p 发给 rollout 侧某个 worker → rollout 内部广播，Moonshot 开源的
  checkpoint-engine 方案；
- `mooncake_checkpoint_engine`。

**演进注脚**：上代代码里有名的 `verl/workers/sharding_manager/` 目录已经不存在，
resharding 逻辑重构为 engine 层 `get_per_tensor_param()` 流式导出 +
checkpoint_engine 抽象层 + RolloutReplica/server 体系。被问"你知道 veRL 怎么演进
的"时主动给这一笔，能直接区分开"背博客"和"读过近期代码"。

### 5.5 GRPO/PPO：`core_algos.py` 注册制 + 开销分摊

`verl/trainer/ppo/core_algos.py`：

- **AdvantageEstimator 注册制**：GAE、**GRPO**（组内减均值除标准差）、RLOO、
  REINFORCE++、ReMax、GRPO-pass@k 等十几种，注册即用；
- **policy loss 注册制**：PPO-clip、**GSPO**（sequence-level ratio）、
  `clip_cov`/`kl_cov`（熵坍缩防御）、SAPO；
- **AdaptiveKLController / FixedKLController**。

开销分摊的两个省点（面试追"GRPO 为什么便宜"时接在算法答法后面的工程答法）：

1. **ref_log_prob 只在 `use_kl_loss` 或 `kl_in_reward` 开时才算**——GRPO 常设 KL=0，
   ref 模型这一步整个免掉（省一次完整前向 + 一份模型常驻显存）；
2. **old_log_prob 由 actor 复算**（`compute_log_prob`），v1 异步架构下可直接复用
   rollout 返回的 `rollout_log_probs`，又一次前向省掉。

### 5.6 训推一致性（2026 高频追问，给三层答法）

机制层先答：同一模型在两套引擎里算出不同 token 概率，因为 **kernel 非确定性、
归约顺序、批大小**不同，importance ratio 逐 token 累积放大，长思维链下尤其致命
（连带把 RL 不稳的锅算在算法头上）。

veRL 的三层应对：

1. **L1 源头对齐**：per-tensor 流式分发 + checkpoint_engine 不落盘——保证训练端
   权重**逐位**到达推理端，把"权重不一致"这一层消成 0；
2. **L2 rollout_correction**（`verl/trainer/config/algorithm/rollout_correction.yaml`
   + `rollout_corr_helper.py`）：`rollout_is` 做 token/sequence 级**截断重要性
   采样（TIS）**——上界 2.0，`lower_upper` 是 IcePop 双边裁切；`rollout_rs` 拒绝
   采样——mask 掉 rollout 端概率异常低的 token；`bypass_mode` 兜底直通；**ESS**
   （有效样本量）监控用于判断修正后还剩多少有效梯度；
3. **L3 根治**：2026/05 发布的 **vexact**——零 mismatch 的 HF rollout：
   batch-invariant kernels + 与 FSDP **共享模型定义**，从实现层把两套前向对齐。

### 5.7 Agentic 与异步

- **Agentic**：`verl/experimental/agent_loop/`——`AgentLoopBase`（coroutine 化）+
  `AgentLoopWorker`/`Manager` + tool registry + OpenAI 兼容 server 回流；多轮
  trajectory **token 级拼接**（`ct_merge_assistant_token`），防止每轮回环时
  retokenization 造成的边界漂移——这是多轮 agent 训练里公认的隐蔽坑；
- **异步三件套**：`one_step_off_policy`（rollout 与训练重叠一步）、
  `fully_async_policy`（rollouter/trainer 全分离 + `dynamic_schedule`）、
  `transfer_queue`。异步带来 staleness，靠 rollout_correction（5.6 的 L2）兜。

## 六、2025-2026 时间线（时间敏感题素材）

- **2025/03** DAPO：AIME24 50 分，超 R1-Zero-Qwen-32B；
- **2025/04** VAPO（60.4）/ Seed-Thinking-v1.5（AIME **86.7**）；
- **2025/06** Megatron backend 支持 DeepSeek-671B / Qwen3-235B；
- **2025/12** 万亿参数 GRPO LoRA：64×H800，走 Megatron-Bridge；
- **2026/01** 迁 verl-project org + recipe 钉版本；
- **2026/05** vexact / verl-omni / uni-agent；
- **2026/06** verl-SpeCo；**2026/07** rl-insight；**2026/08** verl-vla / VeRL-Tinker。

## 七、生态横评（star 2026-10-10 实测）

| 框架 | star | 一句话定位 |
|---|---|---|
| **veRL** | **23,810** | GRPO/RLVR 事实标准，hybrid-controller + 零冗余 colocate |
| trl | 19,479 | HF 全家桶，上手最快、单卡友好，大集群不是主场 |
| OpenRLHF | 10,078 | Ray+vLLM+DeepSpeed 组合，天然 standalone 分卡 |
| slime | 8,623 | SGLang 原生 + Megatron，GLM 系，真异步 + FP8 rollout |
| NeMo-RL | 2,054 | NeMo 官方继任者，dtensor resharding |
| NeMo-Aligner | 852（已 archive） | HybridFlow 论文的对照组，NVIDIA 弃坑转 NeMo-RL——**可当追问钩子**："对照组都弃坑了" |

## 八、▶ 面试题

**Q1：hybrid-controller 是什么？**
把控制器拆两层：数据流层 single-controller（Ray driver 编排 RL 数据流，图节点少、
调度灵活），模型内计算层 multi-controller（SPMD，各 worker 自管计算，保住低延迟）。
对照：DS-Chat 全单控制器（灵活但低效），OpenRLHF 每模型一 actor（低效但数据流难扩）。

**Q2：训推不一致怎么办？**
先讲为什么会不一致：kernel 非确定性、归约顺序、批大小。然后三层：
L1 源头——per-tensor 流式分发 + checkpoint_engine，权重不落盘逐位到达；
L2 修正——rollout_correction 的 TIS（截断重要性采样，上界 2.0，IcePop 双边）/
RS（拒绝采样）+ ESS 监控；
L3 根治——vexact：batch-invariant kernels + 与 FSDP 共享模型定义。

**Q3：colocate 模式下显存怎么排？**
FSDP 训练时权重全分片、不走整模型物化；rollout 时 vLLM KV 吃剩余显存；
切换靠 sleep/wake——vLLM sleep level 1 权重 offload CPU、level 2 丢弃权重
（level 1 大 KV 下仍可能 OOM）；optimizer state 训练/生成切换时往 CPU 搬运。
权重冗余是 0（micro DP group 设计，论文 Table 2）。

**Q4：Megatron 训练 + vLLM 推理，权重布局怎么对齐？**
Megatron-Bridge（`AutoBridge`）：`from_hf_pretrained → to_megatron_provider →
export_hf_weights` 做 HF ↔ TP/PP 布局双向 conversion；EP 融合专家导出时
`unfuse_moe_params` 反融合；按 `update_weights_bucket_megabytes` 切 bucket，
NCCL broadcast 直通 vLLM `update_weights_from_ipc`。

**Q5：agentic 多轮 rollout 难在哪？**
四个点：① rollout 要 coroutine 化（agent_loop），不能阻塞主循环；② 多轮轨迹
**token 级拼接**防 retokenization 边界漂移（`ct_merge_assistant_token`）；
③ partial rollout（长轨迹跨步续生）；④ 异步越大 staleness 越高，用
one-step-off / fully-async + rollout_correction 兜。

**Q6：GRPO 为什么能省掉 critic？**
用**组内均值当 baseline**替代 value model：同一 prompt 采一组 rollout，组内减均值
除标准差做优势，天然 zero-mean。省下的不只是 critic 的一份显存：ref 模型在 KL=0 时
也可跳过（`use_kl_loss`/`kl_in_reward` 关），这套组合拳是 GRPO 工程便宜的核心。
代价：方差控制全靠组内归一化 + clip，全对/全错组零梯度要配合动态采样过滤
（详见 [rl训练工程实战](./rl训练工程实战.md) §3.3）。

## 九、串联阅读

- 上游算法：[rlhf与对齐](./rlhf与对齐.md)（PPO/GRPO/DPO/DAPO 公式与历代演化，
  本篇的 GAE/GRPO/GSPO/SAPO 注册制对应那里的算法章）；
- RL 落地四坑：[rl训练工程实战](./rl训练工程实战.md)（verifier 漏刷、熵坍缩、
  数据筛选、长思维链——本篇的 rollout_correction 与动态采样是它的系统侧答法）；
- 训练框架横评：[训练框架与稳定性](../distributed-training/训练框架与稳定性.md)
  （各框架 colocate 与权重同步口径对比）；
- Rollout 引擎选型：[vllm与sglang深度对比](../inference/vllm与sglang深度对比.md)
  （RolloutReplica 底下那两个引擎的调度/显存设计）；
- 国内全栈对照：[mimo训练栈复盘](./mimo训练栈复盘.md)（另一套 RL 训练栈的工程取舍，
  与 veRL 对照读）。
