# 具身智能与 VLA 专题：端云协同、Action Chunk 与数据三条腿

> **面向**：已读过 [inference/推理调度专题](./inference/推理调度专题.md)、
> [inference/量化与压缩](./inference/量化与压缩.md) 与
> [inference/多模态推理专题](./inference/多模态推理专题.md) 的读者。LLM serving
> 的基本功（continuous batching、KV cache、PD 分离、SLO 拆解）本篇默认你已会，
> 只讲它们搬进机器人之后变成什么样。
>
> **读完获得**：① VLA 从论文 demo 到工业化的时间线与收敛形态判断；② 动作头
> 三条技术路线（离散 token / diffusion·flow-matching / FAST 压缩 token）的选型
> 话术；③ action chunk 与双系统两大工程原语，为什么双系统就是机器人版 PD 分离；
> ④ 端侧 / 云边协同 / fleet serving 三层部署形态与各自 SLO；⑤ 数据管线三条腿
> （遥操作扩产、GPU 并行仿真、世界模型合成数据）与具身 RL 的位置；⑥ 七条工程
> 议题（延迟预算、chunk 顿挫、量化异质、eval 方差、断网 fallback、跨本体归一化）
> 的完整答法；⑦ 8 条面试题与全套数字锚。
>
> **时效口径**：2026-10。素材时间轴从 **2023-07 RT-2** 到 **2026-04 的 GR00T
> N1.7 GA**。全部论文数字按 arXiv 原文口径括注；官方 README / 新闻稿标明「官方」；
> 媒体与社区估算、推导值一律标注；未核实项见文末「口径与未核实说明」，正文不使
> 用任何未核实数字。

## 一、主线：直觉一句话与工业化时间线

**VLA（Vision-Language-Action）= 给 VLM 接一只手。** VLM 本来就看得懂图、
听得懂指令，差的是把「理解」翻译成「电机动作」的最后一公里。这条路的演化史
就是动作表示方式的三次选择，以及围绕延迟与数据的两轮工程妥协。

时间线（全部是官方口径）：

- **2023-07 RT-2**（DeepMind）：>6000 次真机评测，未见场景泛化成功率**从 32%
  提到 62%（官方博客 2023-07-28）**；前作 RT-1 用了 **13 台机器人、17 个月**
  采集数据——数据的人力成本从第一天就是主角。
- **2023-10 Open X-Embodiment**：**覆盖 22 种机器人、21 家机构、527 项
  skill / 160,266 个 task（arXiv:2310.08864，2023-10）**，跨本体数据联盟成立。
- **2024-06 OpenVLA**：首个全开源 7B VLA，970k 条轨迹，64×A100 训练 15 天
  （约 2.3 万 A100·时，机时为本篇按官方数字推导）。
- **2024-10 π0**（Physical Intelligence）：**PaliGemma 3B + 300M 动作专家，
  实测支撑 50Hz 高频灵巧控制（arXiv:2410.24164，2024-10）**，双系统形态确立。
- **2025-03 GR00T N1**（NVIDIA，GTC 2025-03-18，arXiv:2503.14734 v1 同日）；
  同月 **Gemini Robotics**（DeepMind，2025-03-12）发布。
- **2025-05 GR00T-Dreams** 合成数据蓝图（Computex 2025-05-19）；
  **Gemini Robotics On-Device**（2025-06-24）证明断网可用是独立产品品类。
- **2025-08 Jetson Thor GA**（2070 FP4 sparse TFLOPS、128GB，官方规格页）与
  **Genie 3**（720p @ 24fps 实时世界模型，DeepMind 官方博客 2025-08-05）。
- **2026-04 GR00T N1.7 GA**：全链路 TensorRT/ONNX 导出到 Jetson Thor/Orin 与
  DGX Spark，「模型 → 端侧芯片」toolchain 闭环（官方 release note 2026）。

三个收敛判断（面试可直接讲）：

1. **架构收敛**：主流 VLA 已收敛到同一形态——3B 级 VLM backbone + 小型连续
   动作专家（diffusion/flow-matching DiT）+ action chunk。参数量比主流 LLM 小
   2–3 个数量级，但对硬实时延迟的要求高出一个数量级。**模型很小，系统很难。**
2. **核心矛盾换位**：LLM serving 是 throughput 导向（拼利用率），VLA 推理是
   **deadline 导向**——单机单机器人 batch=1，continuous batching 没有红利，
   优化的对象从 TTFT/TPOT 变成 deadline miss rate。
3. **数据是第一瓶颈**（不是算力）：最大开源真机数据集 DROID 只有 **76k 轨迹 /
   350 小时（arXiv:2403.12945，2024-03）**，主流 VLA 预训练在 1 万–2 万小时
   量级，与 LLM 的互联网文本差 5 个以上数量级。

<div class="diagram-embed">
<iframe src="assets/diagrams/embodied-vla.html" width="100%" height="900" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/embodied-vla.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、机制：动作表示的三条路线

把 VLM 的「理解」接到电机上，本质是回答一个问题：**动作怎么编码？**

### 2.1 离散动作 token（RT-2 → OpenVLA）：动作进 tokenizer

每个动作维度均匀分 bin（约 256 档），动作序列变成离散 token，自回归逐 token
输出。**最大红利是完全复用 LLM 基建**：tokenizer、KV cache、投机解码、vLLM/
SGLang 全家桶原样可用。缺点同样显然：高频灵巧任务 bin 化精度不够，且逐维串
行解码慢。OpenVLA 的补救是 OFT（OpenVLA-OFT）：并行解码 + action chunk +
连续 L1 回归，把 LIBERO 成功率**从 76.5% 拉到 97.1%（arXiv:2502.19645，
2025-02）**，动作生成吞吐**提升约 26 倍（同论文口径）**——路线没死，是工程
优化续的命。

### 2.2 连续动作专家 + diffusion / flow matching（π0 → GR00T N 系）

3B 级 VLM 负责理解，外挂一个 300M 级的 DiT「动作专家」，对一整段噪声动作
chunk 迭代去噪。π0 论文实测可支撑 **50Hz 灵巧控制**（叠衣服、装盒子，自回归
bin 化做不到的频率）。代价有两笔：

- **推理延迟由去噪步数 × DiT 前向决定**，不再是单次前向；
- **架构不再是标准 LLM**——KV cache 语义没有标准答案，openpi 的 PyTorch 版
  需要 patch transformers 的 AdaRMS 归一化与 KV cache 行为（openpi README
  明说，2026 口径），量化管线也要单独适配。

### 2.3 压缩动作 token（FAST，2025-01）：折中路线

对动作序列做 DCT 离散余弦变换再量化，把一整段高频动作压成少量 token，让自
回归路线也能训高频灵巧任务；官方口径训练**提速约 5 倍**（arXiv:2501.09747，
2025-01），FAST+ 分词器用 **100 万条轨迹**训练（openpi README 2026）。工程
意义：「动作 token 化」与「连续动作头」之争没有终局，**怎么压是工程问题**。

### 2.4 Action chunk：推理频率与控制频率解耦

一次前向输出未来 H 步动作（π0 取 **H=50**，GR00T N1.7 取 **H=40**，均为官方
口径），实际只执行前若干步——GR00T 默认 **predict 40 步只执行 8 步**（官方
README 2026）。效果：一次 <100ms 的推理被摊销成约 1 秒的 50Hz 控制，**推理
频率与控制频率解耦**。代价是 chunk 执行期内开环，环境突变看不见；两段 chunk
交界处的动作序列不连续，轻则轨迹发抖、重则任务失败。解法谱系：temporal
ensemble（多段 chunk 加权平均）、实时 chunking（每步重推、滑动执行）、动作
头加连续性约束。execution horizon 是**延迟、环境动态性、模型自信度**三者的
函数——工程上要监控「chunk 内动作与实际状态的偏差曲线」动态调整。

### 2.5 双系统（System 1 / System 2）= 机器人版 PD 分离

GR00T N1 论文把分层写进了架构（arXiv:2503.14734，2025-03）：System 2 的
VLM「慢思考」理解环境与指令，System 1 的 DiT「快执行」实时生成电机动作，两
者**紧耦合、端到端训练**。π0 的 VLM backbone + action expert、Gemini
Robotics 的云端版 + On-Device 版，本质是同一个思想在不同颗粒度上的投影。
对照 LLM serving：**这就是 PD 分离**——慢 tier（prefill/规划）不要求每步都
跑，可以按 chunk 周期或事件触发；快 tier（decode/执行）有硬 deadline，必须
有确定性延迟。具体运行频率因实现而异（社区流传数字本仓不采用，见第九节）。

## 三、部署形态：三层正在标准化

### 3.1 端侧：Thor 成了「人形机器人脑」的默认答案

Jetson Thor（GA 于 2025-08-25 当周）：**算力 2070 FP4 sparse TFLOPS @130W、
显存 128GB LPDDR5X @273GB/s、14 核 Neoverse-V3AE**（官方规格页），对比 AGX Orin
**约 7.5 倍算力、3.5 倍能效**（官方新闻稿口径）；dev kit 售 $3,499（CNBC
2025-08-25 经 Wikipedia 引述，价格属媒体口径）。GR00T N1.7 官方支持 Thor/
Orin/DGX Spark 全链路 **ONNX/TensorRT 导出**；3B 模型 bf16 推理 **16GB+ VRAM
起步**（官方 README 2026）。对照 openpi 的资源线：推理 >8GB、LoRA 微调
>22.5GB、全量微调 >70GB（openpi README 2026）。Gemini Robotics On-Device
（2025-06-24）进一步证明「断网可用、低延迟」是**独立产品品类**：本地运行、
50–100 条新 demo 适配新任务、附 MuJoCo SDK（DeepMind 官方博客）。

### 3.2 云边协同：大脑云端、小脑端侧

正式形态：**大脑**（VLM 高层规划、低频重规划、复杂任务路由）跑数据中心，
**小脑**（动作专家、WBC 全身控制、安全控制环）跑端侧。落地证据链：

- 模型内对应物是 GR00T N1 双系统架构（§2.5）；
- **RPC 化已是开源栈标配**：openpi 官方提供 websocket 远程推理 demo（大 GPU
  放机柜外），GR00T 官方提供 ZMQ server-client 推理——「观测上行 / 动作下行」
  两家都已经做成 RPC（两仓库 README 2026 实测）。

设计要点与 PD 分离完全同构：慢 tier 按 chunk 周期或事件触发，快 tier 硬
deadline；额外多一个带宽选择题——观测是传原始视频流，还是端侧 ViT 编码后
传 embedding。

### 3.3 Fleet 级 serving：云端大脑回归经典 LLM serving

单个机器人 batch=1 没有批处理红利，但一个仓库几百台机器人时，云端「大脑」
层重新变回教科书问题：**continuous batching、路由、热点任务的 KV 复用**全部
回来，只是 SLO 从 TTFT/TPOT 换成 deadline miss rate。深坑：每台机器人的观
测序列强异构，prefix 复用率低，别把 LLM 侧的缓存命中率预期直接搬过来。

## 四、数据管线三条腿（2025–2026 收敛形态）

### 4.1 遥操作扩产：本质是人力运营生意

DROID 的 350 小时动用了 **50 名采集员、12 个月、跨三大洲**（arXiv:2403.
12945，2024-03）。工程含量不在机械臂，在**采集基础设施**：VR 遥操作、数据
质量过滤、格式标准化。格式已经在收敛——**LeRobot v2/v3 + modality.json 是
事实标准**，GR00T 和 openpi 两家都原生支持（README 实测 2026）。「数据格式
中间件」本身就是 infra 岗的真实工作内容。

### 4.2 GPU 并行仿真 + sim2real

Isaac Gym 的核心创新不是物理引擎而是**数据通路**：物理与 RL 全在 GPU、
buffer 直传 PyTorch tensor 不经 CPU 拷贝，换来单卡**提速 2–3 个数量级**
（arXiv:2108.10470，2021-08）。继任者 Isaac Lab 至今周更；ManiSkill 3 走
GPU 并行 + ray tracing 渲染路线。sim2real gap 的工程手段没变：domain
randomization + system ID + 少量真机数据校准。

### 4.3 世界模型合成数据：生成式直接产轨迹

GR00T-Dreams（NVIDIA 新闻稿 2025-05-19）给出标准管线：**少量人类 demo 后训
练 Cosmos Predict-2 → 文本 + 单图生成 2D dream 视频 → Cosmos Reason 过滤质
量 → 逆动力学反解出可执行 3D 轨迹**。Google 侧 Genie 3（官方博客 2025-08-05）
已做到 720p @ 24fps 实时可交互、一致性数分钟、视觉记忆回溯 1 分钟——定位是
「给 agent 造训练环境」。判断：**合成数据不再只是仿真渲染，而是世界模型直接
产轨迹**；质量过滤用 VLM 当 judge，与 LLM 侧的 reward model 思路同源。

### 4.4 新变量：WAM 与全身控制（2026 观察项）

2026 年出现的架构之争：「世界模型出动作（WAM）」vs「VLA 直出动作」。社区侧
已有专门 awesome 列表（OpenMOSS/Awesome-WAM，1.4k star）与 RSS 2026 论文
（FastWAM）；NVIDIA 侧 GR00T N1.7 接入 GEAR-SONIC 全身控制——VLA 出 latent
action，再由 WBC 解码成全身关节指令（官方 release note 2026）。术语稳定性社
区尚无共识，面试按「世界模型 × 动作生成的合流趋势」表述最稳。

## 五、RL 在具身：与仓内 RL 环境工程专题同构但更极端

具身 RL 的 infra 难点与 LLM RL 同构，只是指标换了单位：吞吐单位是**环境步/
秒**。Isaac 万环境并行下 rollout 侧不再是瓶颈，**稀疏 reward 才是**。工程答
案按优先级排序：仿真内 reward shaping → 课程学习 → 演示数据做 BC 预热再 RL
精调 → 用世界模型 / VLM 当 reward model。2025 年后的主流叙事是 **IL 打底、
RL 精调**（行为克隆 → 精调）——π0 / GR00T 这类基座全部以 IL 为主，RL 只做落地后
的任务专精与安全修正。对应到 infra：**后训练规模小、但环境交互重**，与
[rl环境工程专题](./训练与对齐/rl环境工程专题.md) 的三池解耦、长尾异步化结论
直接可平移。

## 六、工程议题七条（面试官真正想听的坑）

### 6.1 延迟预算：控制环反推推理周期

低层控制环跑 10–50Hz（机器人本体侧 500Hz–1kHz 属行业工程惯例，无官方统一
数字），留给「策略」的预算只有 20–100ms。chunk 越大摊销越好，开环盲区也越
大；GR00T 默认 predict 40 步只执行 8 步就是「摊销 vs 盲区」的实锤折中。

### 6.2 chunk 交界顿挫：VLA 特有的「speculative-accept」问题

两段 chunk 拼接处不连续。可类比 speculative decoding——都是用大块前缀摊销
串行成本，但验证机制不同：LLM 靠小模型验证，VLA 靠**物理一致性**（偏差曲线、
事件触发重规划、缩短 horizon）。temporal ensemble / 实时 chunking / 平滑插
值各自的开销要会算。

### 6.3 动作头路线决定 serving 成本结构

离散 token 头：能直接套 vLLM/SGLang，但逐维解码慢、串行延迟高。flow-
matching 头：延迟 ≈ 去噪迭代次数 × DiT 前向，KV cache 无标准、要 patch 框架。
FAST 头：介于两者之间，训练提速 5 倍（§2.3）。**选型本质是「复用 LLM 基建的
程度」与「动作质量 / 频率上限」的交换**。

### 6.4 量化对动作精度的影响异质于文本

VLM backbone 的量化容忍度和 LLM 近似；但 action expert 输出的是连续数值，
int8/fp4 的量化误差**直接变成执行误差**，末端毫米级精度任务可能不可接受。工
程惯例：**backbone 激进量化、动作头保守（fp16 起步）**。Thor 的 2070 TFLOPS
是 FP4 sparse 口径，必须用满，「骨干 FP4 / 头 BF16」的混合精度部署是 2026 端
侧默认难题——与 [量化与压缩](./inference/量化与压缩.md) 的 W4A16 讨论同族。

### 6.5 评测不可比与大方的方差

成功率 run-to-run 方差大到 GR00T 官方 README 自曝数据增强非确定性导致
**±5–6 个百分点波动**（官方口径 2026）；sim 榜单（LIBERO/SimplerEnv/
RoboCasa）与真机表现相关性弱；open-loop MSE 与 closed-loop 成功率可以背离。
**工程含义：eval infra 比模型稀缺**——批量真机评测台架、仿真回归流水线、
intervention rate 统计，是招人的真实缺口。真机台架不像 GPU，没法弹性扩容。

### 6.6 断网与 fallback 是一等公民

云大脑方案必须回答「断连会怎样」：Gemini Robotics On-Device 把零连接鲁棒性
当卖点就是信号。工程形态：端侧**始终保有能安全停车 / 降级任务的最小策略**，
云脑只做增强。再叠加语义安全层（Google 的 Robot Constitution / ASIMOV 数据
集思路）：guardrail 在具身侧是「输出动作前过安全判定」，与
[guardrail系统专题](./agent/guardrail系统专题.md) 同构，但**挂在控制环上，
延迟预算更紧**。

### 6.7 数据归一化与跨本体：隐形深坑

不同机器人的 state/action 维度、量纲、坐标系各异。GR00T N1.7 押注 relative
EEF 动作空间 + embodiment tag 做跨本体迁移，state/action 扩到 132 维（官方
release note 2026）；openpi 要求先用 q01/q99 分位数算归一化统计——冷启动维
度会把归一化后的数值拉爆（官方 troubleshooting 明说）。infra 视角：这是一套
**数据 schema 治理**问题，痛苦程度与推荐系统特征工程同构。

## 七、案例数字锚总表

| 锚点 | 数字 | 口径 |
|---|---|---|
| RT-1 数据成本 | 13 台机器人 × 17 个月 | DeepMind 官方博客 2023-07-28 |
| RT-2 真机评测 | >6000 次；未见场景泛化 32%→62% | 官方 2023-07；RT-2-X 为 55B 系 OpenVLA 论文口径 |
| Open X-Embodiment | 22 种机器人 / 21 家机构 / 527 skills / 160,266 tasks | arXiv:2310.08864，2023-10 |
| DROID | 76k 轨迹 / 350 小时 / 564 场景 / 84 任务 / 50 采集员 / 12 个月 | arXiv:2403.12945，2024-03 |
| OpenVLA | 7B / 970k 轨迹 / 64×A100×15 天（≈2.3 万 A100·时，推导） | arXiv:2406.09246，2024-06 |
| OpenVLA-OFT | LIBERO 76.5%→97.1%；吞吐 ×26 | arXiv:2502.19645，2025-02 |
| π0 | 3B PaliGemma + 300M 动作专家；H=50；50Hz 控制 | arXiv:2410.24164，2024-10 |
| π0 系列预训练 | 10k+ 小时机器人数据；FAST 训练提速 5×；FAST+ 分词器 1M 条轨迹 | openpi README 2026；arXiv:2501.09747 |
| GR00T N1 时间线 | 2025-03-18 论文；2025-06-11 开源；N1.5 于 Computex 2025 宣布；N1.6 2026-04-15；N1.7 GA 2026-04-18 | arXiv:2503.14734；GitHub release；NVIDIA 新闻稿 |
| GR00T N1.7 | 3B checkpoint；Cosmos-Reason2-2B backbone（Qwen3-VL 架构）；16 层 flow-matching DiT；H=40 执行 8 步；132 维 state/action；relative EEF；混入 20K 小时 EgoScale 人类视频 | Isaac-GR00T README，2026 官方 |
| 部署资源线 | GR00T 推理 16GB+ VRAM；openpi 推理 >8GB / LoRA >22.5GB / 全量 >70GB | 两仓库 README，2026 官方 |
| GR00T-Dreams | 5 步合成数据管线（Predict-2 微调 → 2D dream → Reason 过滤 → 逆动力学 3D 轨迹） | NVIDIA 新闻稿 2025-05；dev blog 2025-06-16 |
| Gemini Robotics | 2025-03-12 云端版；2025-06-24 On-Device（50–100 条 demo 适配 + MuJoCo SDK） | DeepMind 官方博客 |
| Genie 3 | 720p @ 24fps 实时交互；一致性数分钟；视觉记忆 1 分钟 | DeepMind 官方博客 2025-08-05 |
| Jetson Thor | 2070 FP4 sparse TFLOPS @130W；128GB @273GB/s；对 Orin 7.5× 算力 / 3.5× 能效；dev kit $3,499 | 规格页与新闻稿官方；价格为媒体口径（CNBC 2025-08-25） |
| Isaac Gym | 全 GPU 数据通路，单卡提速 2–3 个数量级 | arXiv:2108.10470，2021-08 |
| 生态热度 | openpi 14.2k / Isaac-GR00T 8.2k / IsaacLab 8.3k / OpenVLA 7.1k / ManiSkill 3.4k / LIBERO 2.4k star | GitHub API 实测 2026-10 |

读表要点：训练端只有两个数量级需要记——**真机数据 10²–10³ 小时**（DROID
350h）与**VLA 预训练 10⁴ 小时**（π0 系 1 万+、N1.7 混 20K 人类视频）；推理
端只记三对数——**H=40/50 执行 8 步、<100ms 推理摊 1 秒控制、16GB VRAM 起步**。

## 八、▶ 面试题 8 条（全收）

**Q1【极高】给一台机器人设计 VLA 推理系统，画出架构并定 SLO。**
答法：policy server 双 tier（云大脑 + 端小脑）、action chunk 摊销、ZMQ/
websocket 观测上行动作下行、deadline miss 监控（§3.1-3.2）。SLO 按控制频率
反推：50Hz 控制 + H=50 chunk → 推理周期 ≤1s 为安全线，动态环境压到 100–
200ms；单卡延迟抖动靠端侧小策略 fallback + 预生成下一段 chunk 的 pipelining
兜底（§6.1、§6.6）。

**Q2【极高】action chunk 为什么能摊延迟？execution horizon 怎么选？**
一次前向出 H 步、执行前 k 步，把推理频率从控制频率里解耦（§2.4）。horizon
是延迟 / 环境动态性 / 模型自信度的函数，工程上监控 chunk 内偏差曲线动态调
整；环境突变用事件触发重规划，缩短 horizon 的代价是推理频率上升。两段
chunk 的接法：temporal ensemble / 实时 chunking / 平滑插值（§6.2）。

**Q3【高】离散 token / diffusion / flow-matching / FAST 四种动作头怎么选型？**
比四个维度：serving 延迟构成（逐 token 解码 vs 去噪步数）、能否复用 vLLM/
SGLang（离散能、DiT 头不能）、量化敏感性（连续头怕低精度）、训练成本
（FAST 官方口径省 5×）。结论：**高频灵巧任务选 flow/DiT，复用 LLM 基建优先
选 FAST**（§2.1-2.3、§6.3）。

**Q4【高】PD 分离在机器人上是什么样？断网了怎么办？**
慢 tier（大脑）按 chunk 周期或事件触发，快 tier（小脑）硬 deadline + GPU 抢占
隔离；观测上传要在「原始视频流 vs 端侧 ViT 后传 embedding」之间做带宽权衡
（§3.2）。断网：端侧常驻最小安全策略（停车/降级），云脑只做增强（§6.6）。
必须留在端侧的：安全环、停车策略、WBC。

**Q5【高】仿真 RL 为什么在机器人上 scale 得动？瓶颈在哪？**
全 GPU 数据通路（Isaac Gym 论文 2–3 个数量级提速，2021）+ 环境并行而非
actor 并行；rollout 便宜之后瓶颈移到 reward 与 sim2real（§4.2、§5）。sparse
reward 工程排序：shaping → 课程 → BC 预热 → 世界模型 / VLM 当 reward model；
sim2real 用 domain randomization + system ID + 真机校准。

**Q6【极高】VLA 和 LLM serving 的异同？（核心题）**
同：云端大脑在 fleet 规模下回归 continuous batching / 路由 / KV 管理（§3.3）。
异：① SLO 是 deadline miss rate 而非 TTFT/TPOT；② 单请求路径 batch=1；③
模型小但系统延迟含传感器 → 编码 → chunk → 执行全链路；④ 量化约束更紧（动
作头怕低精度）；⑤ eval 用成功率 / intervention rate 而非困惑度（§6.1-6.5）。
深追：能否对多机器人做 continuous batching？云端大脑可以，但观测序列强异
构、prefix 复用率低（§3.3）。

**Q7【中】合成数据 / 世界模型会取代遥操作吗？**
立场：**不会取代，是配比问题**——真机数据提供接触物理的 ground truth，合成
数据解决场景/任务多样性的长尾（§4.1 vs §4.3）。深追：合成轨迹过滤怎么做
（Dreams 用 Cosmos Reason 当 filter，本质 VLM 当 judge）；2D 视频 → 3D 轨迹
的逆动力学误差如何收敛。

**Q8【中】VLA 的线上监控和 eval 怎么做？**
双轨：open-loop（MSE 对 GT，便宜但会骗人）+ closed-loop（仿真批量回归 + 真
机抽检）；线上指标是 success rate 与 human intervention rate；方差大（GR00T
官方自曝 ±5–6 个百分点），评测次数要按统计功效算（§6.5）。加分句：**eval
infra 是招聘缺口**，真机评测台架无法像 GPU 一样弹性扩容。

## 九、口径与未核实说明

- **Jetson Thor 价格**：dev kit $3,499、生产模组千片价 $2,999 的来源是 CNBC
  （2025-08-25）经 Wikipedia 引述，规格页参数为 NVIDIA 官方——价格属媒体口
  径，被追问时主动声明。
- **π0.5 确切发布日期**：PI 官网 429 无法直查；Wayback 最早快照 2025-04-23，
  仅能确定「不晚于该日」；openpi README 口径 2025-09 在仓库放出 π0.5 与
  PyTorch 支持。
- **OpenVLA 基座推理频率约 6Hz**：社区流传，未核实到官方来源，正文未采用；
  已核实的官方数字是 OFT 吞吐提升 26 倍。
- **未核实的频率传言**（「GR00T System 1 以 120Hz 运行」、Figure Helix 的
  「S2 7B @ 7–9Hz / S1 80M @ 200Hz」）：均未核实，正文不写；安全表述是「双系统是共识架构，具体频率
  因实现而异」。
- **机器人低层控制器 500Hz–1kHz**：行业工程惯例，无官方统一数字，正文已标
  注为惯例口径。
- **WAM 术语**：OpenMOSS/Awesome-WAM（1.4k star）与 RSS 2026 FastWAM 为实
  测存在，但术语稳定性无社区共识，按「合流趋势」表述。
- **GR00T N1.5 权重开放时间**：未核实，只写「宣布于 Computex 2025」。

## 串联阅读

- [inference/推理调度专题](./inference/推理调度专题.md)：continuous batching
  与抢占调度——本篇 §3.3 fleet 大脑的教科书底版。
- [inference/量化与压缩](./inference/量化与压缩.md)：W4A16 与低精度权衡——
  本篇 §6.4「骨干激进 / 头保守」混合精度的方法论来源。
- [inference/多模态推理专题](./inference/多模态推理专题.md)：视觉编码的
  token 化成本与 EPD 分离——VLA 的 V 那一侧的成本结构看这篇。
- [inference/推理服务slo与运营](./inference/推理服务slo与运营.md)：SLO 拆解树
  ——把 TTFT/TPOT 换成 deadline miss rate 后，拆解方法不变。
- [训练与对齐/rl环境工程专题](./训练与对齐/rl环境工程专题.md)：环境工程与三
  池解耦——本篇 §5 具身 RL 的 infra 结论与该篇同构。
- [agent/guardrail系统专题](./agent/guardrail系统专题.md)：guardrail 五 rail
  与延迟优化——本篇 §6.6 把同一套挂上控制环。
- [显存计算专题](./显存计算专题.md)：显存五笔账——3B 模型 16GB VRAM 起步的
  账怎么算。
- [知识串联与why链](./知识串联与why链.md)：五条因果链的追问训练——本篇
  「摊销 vs 盲区」「复用基建 vs 动作上限」可直接续进 why 链。
