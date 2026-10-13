# DeepSpeed 专题：配置卡片、启动、Checkpoint 与框架选型边界

> **面向**：准备 AI Infra 训练岗、背过 ZeRO 原理但「没真正跑过 DeepSpeed」
> 的读者；微调工程师面试前也可用来过一遍工程细节。
>
> **读完获得**：① 版图定位与模块地图；② 三张能默写的 `ds_config.json` 卡片
> （微调首选 / 大模型省显存 / 卡不够 offload）；③ 单机到多机启动与排错；
> ④ ZeRO-3 checkpoint 导出与拓扑变更救援；⑤ overlap、bucket、混精、梯度
> 裁剪的调参口径；⑥ 与 Megatron/FSDP 的选型话术；⑦ 7 道高频面试题答法。
>
> **分工口径**：ZeRO-1/2/3 分片了什么、显存降多少、通信量怎么推导——全部在
> [ZeRO 与显存优化](./zero与显存优化.md)（本篇引用它讲账，不复述）。本篇只讲
> **框架工程**：配置、启动、checkpoint、调参开关，以及与 Megatron/FSDP 的边界。

## 一、DeepSpeed 在框架版图的位置

DeepSpeed 是**微软 2020 年随 ZeRO 论文一起放出的训练框架**，从此成为「ZeRO
全家桶的代名词」：ZeRO-1/2/3、ZeRO-Offload、ZeRO-Infinity、ZeRO++ 都是它先
落地。工程形态是「pip 包 + launcher + runtime engine」：模型代码几乎不改，
`deepspeed.initialize(model, config)` 包一层就拿到分片训练能力——这是它与
Megatron 最大的气质差别（Megatron 要你按它的方式写模型）。

模块地图一张（pip 包内一级目录，每个一句话）：

| 模块 | 干什么 | 面试里怎么提 |
|---|---|---|
| `runtime` | DeepSpeedEngine 与 ZeRO 三阶段、offload 的心脏 | engine 把 optimizer/scheduler/通信都吞进去了 |
| `pipeline` | PipelineModule 的 PP 实现 | 教程级，生产 PP 还是得 Megatron（见 [三维并行](./三维并行.md)） |
| `ops` | FusedAdam、fused transformer、量化 kernel | 不手写 CUDA 也能吃 fused 算子 |
| `compression` | 量化、剪枝、层替换工具库 | 答「知道有」即可 |
| `inference` | DeepSpeed-Inference，kernel injection 加速推理 | 2022 年是亮点，今被 vLLM/SGLang 超车 |
| `chat` | DeepSpeed-Chat，端到端 RLHF 参考实现 | 鼻祖地位，详见第七节 |

一句话定位（背这句）：**DeepSpeed 是 ZeRO 的工程化外壳——HF 模型即插即用、显存压得最狠；代价是侵入训练循环，可定制上限不如 Megatron。**

## 二、ZeRO 配置卡片（本篇核心，能默写）

`ds_config.json` 是 DeepSpeed 的全部入口。三张卡覆盖 90% 真实场景，每张附
「什么时候抄它」一行。`"auto"` 是合法值，交给 HF Trainer 或命令行注入。

### 卡片 A：微调首选——ZeRO-2 + bf16

```json
{
  "bf16": { "enabled": "auto" },
  "zero_optimization": {
    "stage": 2,
    "overlap_comm": true,
    "contiguous_gradients": true,
    "reduce_bucket_size": 200000000
  },
  "train_micro_batch_size_per_gpu": "auto",
  "gradient_accumulation_steps": "auto",
  "gradient_clipping": "auto",
  "wall_clock_breakdown": false
}
```

- `overlap_comm: true`：梯度分桶 ReduceScatter 与反向计算重叠，通信几乎免费；
- `contiguous_gradients: true`：梯度写进连续大 buffer，压住长期训练的显存碎片；
- `reduce_bucket_size`：通信桶元素个数，默认 5e8，微调调到 2e8 常更稳
  （桶小→overlap 粒度细，但通信启动次数变多，权衡见第五节）。

**什么时候抄它**：7B~13B 全参微调、单机多卡、显存未紧到必须切参数。
ZeRO-2 通信量与 DDP 同级（账见 [ZeRO 篇](./zero与显存优化.md)），是性价比拐点。

### 卡片 B：大模型省显存——ZeRO-3 全分片

```json
{
  "bf16": { "enabled": "auto" },
  "zero_optimization": {
    "stage": 3,
    "overlap_comm": true,
    "contiguous_gradients": true,
    "reduce_bucket_size": "auto",
    "stage3_prefetch_bucket_size": "auto",
    "stage3_param_persistence_threshold": "auto",
    "stage3_max_live_parameters": 1000000000,
    "stage3_max_reuse_distance": 1000000000,
    "stage3_gather_16bit_weights_on_model_save": true
  },
  "train_micro_batch_size_per_gpu": "auto",
  "gradient_clipping": "auto"
}
```

三个 ZeRO-3 专属开关，一句话一个：`stage3_param_persistence_threshold` 小于
阈值的参数常驻不分片（LayerNorm、小 embedding），管「谁常驻」；
`stage3_prefetch_bucket_size` 前向/反向预取下一层参数的桶大小，用瞬时显存
换「参数不等通信就到位」；`stage3_max_live_parameters` 允许同时「活着」
（已 AllGather 未释放）的参数上限，显存爆了先砍它——ZeRO-3 的显存安全阀。

**什么时候抄它**：13B 以上全参训练、或卡够但单卡 80G 放不下模型状态。
`stage3_gather_16bit_weights_on_model_save: true` 顺手开，save 时直接攒出
完整 16bit 权重（第四节讲为什么省事）。

### 卡片 C：卡不够时——ZeRO-Offload 与 ZeRO-Infinity

```json
{
  "bf16": { "enabled": "auto" },
  "zero_optimization": {
    "stage": 3,
    "offload_optimizer": { "device": "cpu", "pin_memory": true },
    "offload_param": {
      "device": "nvme",
      "nvme_path": "/local_nvme",
      "pin_memory": true
    },
    "aio": {
      "block_size": 1048576,
      "queue_depth": 8,
      "thread_count": 1,
      "single_submit": false,
      "overlap_events": true
    }
  },
  "train_micro_batch_size_per_gpu": "auto",
  "gradient_clipping": "auto"
}
```

只开 `offload_optimizer`（优化器状态与更新下 CPU，参数/梯度留 GPU）=
**ZeRO-Offload**：AdamW 那 12Ψ 搬进 CPU 内存，瓶颈在 PCIe 带宽；再加
`offload_param` 到 `nvme` = **ZeRO-Infinity**：参数也分层 offload 到 NVMe，
靠 `aio` 异步 IO 引擎流水掩盖；`nvme_path` 要用本地 SSD。

吞吐代价量级（**经验口径**，与 PCIe 代际、`pin_memory`、CPU 核数强相关）：
Offload 相对纯 GPU ZeRO-3 吞吐通常打 **3~7 折**，Infinity 碰 NVMe 更低——
offload 是把「跑不了」变成「跑得慢」，不是免费的。

**什么时候抄它**：资源受限场景（单卡/双卡想训 13B+）、穷一步的验证性实验；生产追 MFU 的预训练不要用它。

## 三、启动与多机：`deepspeed` CLI vs `torchrun`

DeepSpeed 自带 launcher，官方推荐入口是 CLI：

```bash
# 单机 8 卡
deepspeed --num_gpus 8 train.py --deepspeed ds_config.json

# 多机：hostfile 每行一台机器，slots = 这台的卡数
cat hostfile
# worker-0 slots=8
# worker-1 slots=8
deepspeed --hostfile hostfile --master_addr worker-0 \
  train.py --deepspeed ds_config.json
```

- **SSH 免密是硬前提**：launcher 底层走 PDSH，master 到每个 worker 免密 ssh，多机排错第一查这个；
- **节点选择**：`-i/--include "worker-0:0,1,2,3@worker-1:0,1"` 只用部分卡，`--exclude` 反向排除，调坏卡时高频用；
- **环境变量传递**：worker 不继承你的 shell，变量写进用户目录 `.deepspeed_env`，launcher 逐节点注入；
- **`torchrun` 路线**：代码里 `deepspeed.init_distributed()` 即可，对接 k8s/volcano 等调度更顺，内部大集群基本走这条。

**单机调试姿势**（背下来能演示「做过」）：先 `--num_gpus 1` 跑通脚本、配置、
数据管线 → `ds_report` 查编译 ops 与 CUDA/NCCL 版本匹配 → 再开整机 8 卡 →
最后上多机。**每次只扩一档规模**，报错归因省一半时间。

## 四、Checkpoint 工程（高频被忽略）

### ZeRO-3 下 checkpoint 长什么样

`model.save_checkpoint(save_dir, tag)` 落盘结构：

```text
checkpoint/
└── global_step1000/
    ├── mp_rank_00_model_states.pt                 # 本 rank 参数分片 + 模型元信息
    ├── zero_pp_rank_0_mp_rank_00_optim_states.pt  # 本 rank 优化器状态分片
    ├── zero_pp_rank_1_mp_rank_00_optim_states.pt
    └── ...                                        # DP=N 就有 N 份 optim 分片
```

两个关键事实：① **每个 rank 只存自己那 1/N 分片**，单看任何一份都不是完整
权重；② **恢复必须同拓扑**——`load_checkpoint` 按旧 DP 度数对齐分片，卡数
变了（DP 8 → 16）直接 resume 必挂。

### `zero_to_fp32.py`：什么时候需要单文件权重

DeepSpeed 自带工具把切碎的 ZeRO-3 ckpt 拼回单个 fp32 权重（
`python zero_to_fp32.py checkpoint/global_step1000 output_dir/`）。三种场合
需要它：**给推理/导出**（vLLM、HF `from_pretrained` 都要完整权重）、**换
拓扑续训**（见下）、**模型评测/合并**。保存时开过
`stage3_gather_16bit_weights_on_model_save` 的话拼合更快。

### 拓扑变了怎么救（标准答案）

**先用 `zero_to_fp32.py` 拼成完整 fp32 权重，再用新拓扑起一个任务 load 进来
重新分片**——优化器状态放弃（m/v 重建，momentum 抖一两个 epoch 可接受），
千万别手工切分片对齐。面试说出「放弃优化器状态、保住模型权重」，说明真处理过。

## 五、训练功能开关拾遗（调参口径）

- **Activation Checkpointing**：只存层边界激活、反向重算前向，代价约
  **+30% 计算量**（经验口径）。HF 用 `gradient_checkpointing_enable()`；
  DeepSpeed 另有 `deepspeed.checkpointing`，按 partition 切分 RNG、多机可复现。
- **通信计算重叠**：`overlap_comm` 在 ZeRO-1/2 是梯度 ReduceScatter 插进反向流水、在 ZeRO-3 是参数 AllGather 预取——默认开，关掉只为排错对照。
- **bucket 取多大**：`reduce_bucket_size` 与 `stage3_prefetch_bucket_size` 同一条权衡线——桶大→通信次数少、瞬时显存高、overlap 粒度粗；桶小→相反。先 `"auto"`，显存余量足再调大。
- **fp16 vs bf16**：bf16 动态范围大、**不需要 loss scale**，是今天默认；fp16
  必须配动态 loss scale（`initial_scale_power`/`loss_scale_window` 等键）。
  无论哪种，主权重与动量永远 FP32（账见 [ZeRO 篇](./zero与显存优化.md)）。
- **梯度裁剪与 overflow**：`gradient_clipping` 必开（1.0 起步）；fp16 overflow
  时 loss scale 降档、该 step 更新被跳过——盯日志里 loss scale 跳水频率与
  skipped 计数，比盯 loss 曲线更早发现数值问题（见
  [训练生产排障手册](./训练生产排障手册.md)）。

## 六、与 Megatron/FSDP 的边界（选型题落点）

| 你的处境 | 选谁 | 一句话理由 |
|---|---|---|
| HF 模型微调、只想省显存 | DeepSpeed（卡片 A/B） | 包一层 `initialize` 即可，改动最小 |
| 改模型结构/预训练追 MFU | Megatron-LM | 3D 并行与 fused kernel 上限最高，但要重排模型（见 [Megatron 拆解](./megatron源码深度拆解.md)） |
| 留在纯 PyTorch 官方生态 | FSDP2（TorchTitan） | 官方维护、per-param sharding，新特性第一个吃到 |
| RL 后训练 | 看宿主 | OpenRLHF 以 DeepSpeed+Ray 为训练底座；veRL 官方后端选 FSDP/Megatron（见 [veRL 拆解](../训练与对齐/verl深度拆解.md)） |

加分点：ZeRO 思想今天已框架无关化——Megatron Distributed Optimizer ≈ ZeRO-1、
FSDP `FULL_SHARD` ≈ ZeRO-3。被问「为什么还选 DeepSpeed」，答**Offload/Infinity
的极致显存压缩 + 对 HF 生态的融合度**，而不是「只有它会 ZeRO」。

## 七、DeepSpeed-Chat 与后训练一笔

DeepSpeed-Chat（2023 年 4 月）是**第一个把 InstructGPT 三段式（SFT → Reward
Model → PPO）做成一键脚本的端到端 RLHF 开源系统**，配套 Hybrid Engine 让同
份参数在训练/推理生成模式间切换，把「消费级卡复现 ChatGPT 流程」从口号变成
教程——鼻祖地位不容置疑。但天花板也清楚：PPO 的 rollout 与训内串行切换，
吞吐受限，今天被 veRL / slime / OpenRLHF 的训推一体接管（见
[RL 系统训推一体专题](./rl系统训推一体专题.md)）。话术收尾：**Chat 开创了
端到端 RLHF 工程，三件套拓扑接棒了它。**

## ▶ 面试题

**Q1：`ZeRO-2` 和 `ZeRO-3` 通信量差多少？**
ZeRO-2 每 step ≈ 2Ψ（梯度 ReduceScatter），与 DDP 同量级；ZeRO-3 ≈ 3Ψ
（前向参数 AllGather + 反向再 AllGather + 梯度 ReduceScatter 各 Ψ），约 1.5
倍——**ZeRO-3 用 50% 额外通信换 N 倍显存压缩**（推导见 [ZeRO 篇](./zero与显存优化.md)），
工程上靠 overlap 与预取把这 50% 藏进计算。

**Q2：`reduce_bucket_size` 是干什么的？**
通信分桶大小（元素个数）：梯度装满一桶发一次集合通信、与后续计算 overlap。
桶大→通信次数少但攒桶时显存峰值高；桶小→启动开销摊不薄。默认 5e8，微调常
调 2e8；原则是先 `"auto"` 再按显存余量调。

**Q3：ZeRO-3 的 checkpoint 为什么麻烦？**
每个 rank 只落 1/N 分片（`zero_pp_rank_*`），目录里没有完整权重；恢复严格
假设 DP 拓扑不变，换卡数必挂。出口两个：推理/导出用 `zero_to_fp32.py` 拼
fp32；换拓扑先拼 fp32 再按新拓扑重切，优化器状态放弃、只保模型权重。

**Q4：ZeRO-Offload 什么时候值得开？**
显存墙是「能不能训」而不是「快不快」时：单卡/双卡想训 13B+、穷一步做验证
实验。代价：吞吐通常 3~7 折（经验口径），瓶颈在 PCIe 带宽与 CPU 算力。生产
预训练追 MFU 不值得——省 GPU 的钱会加倍花在时间上。

**Q5：你怎么选 DeepSpeed vs Megatron-LM？**
两维度：改不改模型、追不追 MFU。HF 标准模型微调、目标塞进现有卡 →
DeepSpeed，接入半天；自研架构/预训练/千卡追 MFU → Megatron，接受重写模型
层换 TP/PP/CP 与 fused kernel 上限。收尾必带真实经历（「我用 ZeRO-2 微调
7B，理由是……」）。

**Q6：`overlap_comm` 开了 CPU 占用变高正常吗？**
正常。桶调度要 CPU 持续往 CUDA stream 塞任务，`contiguous_gradients` 的
buffer 管理也在 host 侧；叠加 offload 时 CPU 还要跑 AdamW 更新。警惕 CPU
打满饿死 dataloader——经验每 GPU 留 4~8 核余量，调好 `num_workers`。

**Q7：`stage3_param_persistence_threshold` 怎么定？**
小于阈值的参数（LayerNorm、bias）不分片、常驻每卡：阈值↑→AllGather 次数↓
但每卡冗余显存↑。经验保持 `"auto"`，只有 profile 显示小参数通信爆炸才抬
一档。它与 `stage3_max_live_parameters` 是一对：一个管谁常驻，一个管同时
活着的参数总量上限。

## 串联阅读

- [ZeRO 与显存优化](./zero与显存优化.md)——ZeRO 显存账 canonical，本篇所有「账」的数字锚
- [训练框架与稳定性](./训练框架与稳定性.md)——框架横评、容错、异步 ckpt、MFU
- [三维并行](./三维并行.md)——TP/PP/DP 切法与通信量推导
- [Megatron 源码深度拆解](./megatron源码深度拆解.md)——选型题的另一端
- [通信与网络专题](./通信与网络专题.md)——集合通信原语，overlap 与 bucket 的地基
- [RL 系统训推一体专题](./rl系统训推一体专题.md)——DeepSpeed-Chat 的接棒者们
- [训练栈全链路专题](./训练栈全链路专题.md)——DeepSpeed 在完整训练栈中的位置
- [训练生产排障手册](./训练生产排障手册.md)——overflow、OOM、通信超时处置
- [veRL 深度拆解](../训练与对齐/verl深度拆解.md)——RL 场景的训练后端选型
- [LoRA 与参数高效微调](../训练与对齐/lora与参数高效微调.md)——ZeRO-2 + LoRA 的省钱组合
- [高频面试真题汇总](../高频面试真题汇总.md)——分布式训练类题全景

## 口径与未核实说明

- 配置键以 **DeepSpeed 0.10+ 官方文档**为准；默认值与 `"auto"` 解析随版本变，
  以所用版本包内文档和 `ds_report` 输出为最终口径。
- Offload/Infinity 吞吐折扣（3~7 折）为**经验口径**，随硬件与 CPU 配置浮动很大，不可当 benchmark 引用；Activation Checkpointing「约 +30% 计算」同理。
- ckpt 目录文件名（`zero_pp_rank_*`）在不同版本可能带 `bf16_` 前缀，以实际落盘为准。
