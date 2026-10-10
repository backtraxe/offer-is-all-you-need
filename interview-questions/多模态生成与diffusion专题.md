# 多模态生成与 Diffusion 专题：视频 DiT 的谱系、采样加速与 serving 解法栈

> 面向 AI Infra / 推理系统岗，偏生成侧（文生图、文生视频）。被问「视频生成
> 为什么没有 KV cache」「8 秒 1080p 为什么贵」「vLLM 那套 serving 功夫
> 迁移得过来吗」「50 步怎么降到 4 步」时，这篇就是弹药库。
>
> 读完获得：① 生成侧与 LLM serving 负载结构的根本差异四连；② DiT 谱系
> 从 2022 到 2026 的完整换代线（cross-attention → MMDiT → Wan 反潮流 →
> MoE 扩散）；③ 采样加速四代人与每一代的数字锚；④ 视频生成算力账的
> 三段推导（token 化、attention 主导判据、单视频 FLOPs）；⑤ 工程化解法栈
> （USP/PipeFusion/CFG 并行、组件 offload 四档）；⑥ 生态功能矩阵与产品
> 形态；⑦ 十条面试追问的答题要点。
>
> **时效口径**：2022 DiT → 2026 Sora 2 / Veo 3.1 / Wan2.x 时代。理解侧
> （VLM token 化、EPD 分离）只串联不重复，见
> [多模态推理专题](./inference/多模态推理专题.md)。论文数字标注 arXiv 编号，
> 实测数字标注来源仓库与日期，推导值单独标明「推导」；闭源产品（Sora 2、
> Veo 3.1）仅引官方已公开口径，规格未公开处不编数字；未逐条核实的 arXiv
> 编号建议引用前按日期抽查一遍（见文末说明）。

## 一、直觉一句话：生成侧没有 decode——每个请求是一次巨型 compute job

LLM serving 的全部工程都长在一个事实上：请求分两相，prefill 一次性、
decode 逐 token 增量，且已算过的 K/V 可以精确复用。围绕它长出了
KV cache、continuous batching、PD 分离、prefix cache 一整个工具箱。

扩散/Flow 模型的负载结构完全不同，一句话说透：

```text
视频生成推理 = 「全长序列 × N 步重算」
  每个 denoising 步：对整段 noisy latent（几万到几十万 token）做一次完整前向
  N 步之间：latent 全量变化，上一步的任何中间结果对下一步都无效
  没有增量、没有流式输出、没有「算到哪儿歇哪儿」
```

由此三条金句，面试先背：

1. **视频生成的推理 FLOPs 九成以上在 attention**——token 长到几万之后的
   物理学（第四节推导）；
2. **生成侧没有 KV cache——只有跨步近似复用，没有精确复用**（TeaCache /
   PAB / PipeFusion 都是「近似正确」）；
3. **PD 分离无从谈起：每个请求是单次巨型 compute job**——没有 P/D 两相
   可拆，并发靠 gang 调度加模型分档。

负载结构不同，所以生成侧的优化主轴整个换了一套：**序列并行 × 步数蒸馏
× 步间 cache × 稀疏/量化 attention**。这也是本文地图的四根柱子：

<div class="diagram-embed">
<iframe src="assets/diagrams/diffusion-video-map.html" width="100%" height="700" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/diffusion-video-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

图读法：上泳道是 **DiT 谱系**——注入方式从 cross-attention 换到 MMDiT 双
流，Wan 系在视频侧走了自己的路；中泳道是 **采样加速四代人**——solver
免训练 → flow matching 换目标函数 → 蒸馏压到个位数步 → 步间 cache 与
稀疏 attention 推理期白捡；下泳道是 **serving 解法栈**——序列并行与
CFG 并行摊算力、组件 offload 治显存、生态把这一切打包成开箱即用的引擎。

## 二、DiT 谱系：四年完成两次换代

### 2.1 DiT 起点：U-Net 换 latent ViT

DiT（arXiv:2212.09748，2022-12）把扩散模型的骨干从 U-Net 换成 ViT 式
transformer，在 latent patch 上做 class-conditional 生成，配 adaLN-Zero
条件注入。**DiT-XL/2 在 ImageNet 256 上拿到 FID 2.27**（arXiv:2212.09748），
并且 Gflops 与 FID 呈干净 scaling——「transformer scaling law 对生成模型同
样成立」就此立住。一作 William Peebles 后来出任 Sora lead（人员谱系为
推断标注，非官方简历核对）。

SDXL（arXiv:2307.01952，2023）是最后的 U-Net 旗舰。随后
**PixArt-α 把训练成本打到了 675 个 A100 GPU day（约 2.6 万美元，仅为
SD1.5 的 10.8%）**（arXiv:2310.00426）——DiT 加 cross-attention 注入 T5、
去掉 class-condition，这是「DiT 训练可以多便宜」的标准答案。

### 2.2 第一次换代：SD3/MMDiT 双流联合注意力

SD3（arXiv:2403.03206，2024-03）一次换了两样东西：

- **训练目标换 rectified flow**：数据到噪声走直线插值，传输轨迹更直、
  所需步数天然更少；配 logit-normal 时间步加权集中学习感知关键噪声区；
- **注入方式换 MMDiT 双流块**：图像与文本 token 各有独立 QKV 权重，在
  注意力内部拼接做双向交互——文本不再是 cross-attention 里「只读的条件」，
  而是全程参与、可被图像反向影响。文本编码 CLIP×2 加 T5-XXL 三编码器。

Flux.1（BFL 官方博客，2024-08）是 SD3 原班人马创业作：**12B 参数、
MMDiT 双流加 parallel single-stream blocks 混合架构**，flow matching 加
RoPE 加 parallel attention；分 pro/dev（guidance-distilled）/schnell
（Apache 2.0 few-step）三档，成为 2024–2026 开源文生图的事实标杆。

### 2.3 第二次变奏：Wan 系的反潮流与两个工程创新

Wan2.1（arXiv:2503.20314，2025-02，阿里）反潮流坚持 **T5 加
cross-attention 的单流产线**（umt5-xxl 文本编码器），说明双流并未淘汰
cross-attention——是成本与效果的取舍。它真正的工程核心在
**Wan-VAE：时空压缩比 4×8×8 的 3D causal VAE**（T×H×W 三轴），因果设计
支持任意长度的 1080p 编解码、不丢历史时间信息。两档型号：14B（480p/720p）
与 1.3B——**1.3B 档在 4090 上出 480p 5s 视频约 4 分钟、显存 8.19 GB**
（Wan2.1 README）。

Wan2.2（README，2025-07-28）连出两招：

- **MoE 进扩散**：按 denoising 时段拆专家——SNR 低于阈值切「高噪专家」
  （管布局）、其余走「低噪专家」（管细节），各 14B、总参 27B、每步只激活
  14B——**容量翻倍、算力不变**（Wan2.2 README 口径）；
- **高压缩 VAE 换 token 长度**：TI2V-5B 配 4×16×16（整体 64×）压缩，
  patchify 后等效 4×32×32，**720p 5s 在单卡 4090 上小于 9 分钟可跑**
  （Wan2.2 README）——「用 VAE 压缩比当成本旋钮」的代表作，第四节会
  回到这个旋钮。

### 2.4 视频侧其他锚点

- **HunyuanVideo 大于 13B，是当时最大的开源视频模型**（arXiv:2412.03603，
  2024-12，腾讯），MMDiT 架构；
- LTX-Video（arXiv:2501.00103，2024-12）主打实时：2B/13B 两档，30fps；
- LTX-2（2025-10-23 官方公告）原生音视频同步加 4K/50fps 加 10s——2026
  年产品规格新基线（详见第六节产品形态）。

## 三、采样加速四代人：千步 → 20 步 → 4 步 → 再叠加

### 3.1 第一代：solver 免训练

DDPM 原始采样要千步；DDIM 确定性跳步先砍一刀；DPM-Solver/++ 用专用
ODE solver 把高阶信息补上，10–20 步质量可用——**实战档收敛在 20–50 步**
（各开源仓库默认步数口径）。这一代的贡献是「不改模型，只换数值方法」。

### 3.2 第二代：换目标函数，天然少步

rectified flow / flow matching 把传输路径直线化：曲率小，低阶 solver 走
大步长误差也小。**SD3 的 28 步档就是这么来的**（arXiv:2403.03206），
SD3/Flux/Wan/HunyuanVideo 全部跟进——「为什么 flow matching 28 步就够」
是面试高频题（见第七节第 7 条）。

### 3.3 第三代：蒸馏压到 1–8 步

谱系要分清历史线与当前线：

- Consistency Models（arXiv:2303.01469，2023-03）开创一步生成思路；
- **LCM/LCM-LoRA 只用约 32 个 A100 GPU 时蒸出 2–4 步**（arXiv:2311.05556）；
- **ADD（SDXL-Turbo）1–2 步实时、4 步追平 SDXL 全步**（arXiv:2311.17042），
  对抗蒸馏加 score 蒸馏；
- 视频侧当前线是 **DMD2 分布匹配蒸馏**：FastVideo FastWan 系列宣称稀疏加
  蒸馏总加速大于 50×（FastVideo 仓库口径，2025-08）；FastH3 8-step V2
  用 data-free DMD2 加 80% 稀疏 attention，已能单卡 5090 跑视频模型；
  Self-Forcing 做因果化蒸馏支持流式生成。

术语纠偏：**LCM 是历史线，DMD2/Self-Forcing 才是 2026 当前线**——面试
里只背 LCM 会露老底。

### 3.4 第四代：不改模型改计算，推理期白捡

两小族，全部免训练或近免训练：

**步间 cache**：

- **TeaCache 免训练、Open-Sora-Plan 上加速 4.41× 而 VBench 仅 −0.07%，
  Wan2.1 上约 2×**（arXiv:2411.19108，CVPR 2025）——用 timestep
  embedding 调制输入差估输出差，差小就直接复用上一步输出；
- PAB（Pyramid Attention Broadcast，arXiv:2408.12588）按层金字塔式广播；
- DeepCache 是 U-Net 时代的同思路前辈；
- ToMe（arXiv:2210.09461）按相似度合并冗余 token，图像 DiT 常用、视频
  侧因时空冗余估算更敏感需谨慎。

**稀疏/量化 attention**：

- **SageAttention2 把 QK 量化 INT4、PV 用 FP8，在 4090 上比 FlashAttention-2
  快约 3×**（arXiv:2411.10958，ICML 2025）；
- SpargeAttn 通用稀疏加量化免训练（arXiv:2502.18137，ICML 2025），两段式
  在线过滤；
- 视频结构专用：STA（arXiv:2502.04507）吃局部时空结构、VSA
  （arXiv:2505.13389）可训练稀疏，HunyuanVideo-1.5 的 SSTA、Kandinsky-5
  的 NABLA、LongCat-Video 块稀疏同路线。

生产组合三件套：**flow matching 底模加 DMD 蒸馏加稀疏 attention**——
这是「50 → 28 → 4 步怎么降」的标准答案骨架。

## 四、视频生成算力账：三段推导

换到 [显存计算专题](./显存计算专题.md) 的口算风格：每一段给出公式、代入、
结论，全部标注「推导」。

### 4.1 token 化：一条视频是多少 token（推导）

以 Wan2.1 几何口径推导：VAE 时空压缩 4×8×8（T×H×W），patchify 1×2×2：

```text
720p 5s@16fps：81 帧 1280×720
  latent  ≈ 21 × 90 × 160           （81/4 向上对齐，720/8，1280/8）
  patchify ≈ 21 × 45 × 80 ≈ 7.6 万 token

1080p 8s@16fps：128 帧 1920×1080
  latent  ≈ 33 × 135 × 240
  patchify ≈ 33 × 67 × 120 ≈ 26.5 万 token
```

直觉锚：**每一步 denoising 都相当于把一本小书塞进 self-attention，连算
30–50 步**（Wan2.1 官方默认 T2V 50 步、I2V 40 步，Wan2.1 README），开
CFG 再乘 2。Wan2.2 高压缩 VAE 把同分辨率 token 长度直接除以 4——VAE
压缩比就是成本旋钮。

### 4.2 attention 主导判据 L/d（推导）

每层线性层 FLOPs 与 L·d² 成正比，attention score 计算与 L²·d 成正比，
比值约为 L/d（d 为隐层宽）。14B 级 d≈5120：

```text
L = 7.6 万（720p 5s）：L/d ≈ 15
L = 26 万（1080p 8s）：L/d ≈ 52
```

attention 成本几十倍于线性层，于是得到本文第一条金句的定量版：**视频
生成的推理 FLOPs 九成以上在 attention**（按 L/d 判据推导，与第四节加速
研究八成以上瞄准 attention 与序列并行的生态事实自洽）。平方项随分辨率
与时长双增——这就是「8s 1080p 为什么贵」的物理根源。

### 4.3 单视频 FLOPs 粗账（推导）

14B 模型、720p 5s（7.6 万 token）、50 步、CFG ×2：

```text
每次前向 ≈ 2 × N × L = 2 × 14e9 × 7.6e4 ≈ 2.1 PFLOPs
整条视频 ≈ 2.1 PFLOPs × 50 步 × 2（CFG）≈ 2×10^20 FLOPs
```

H100 有效吞吐按 MFU 约 40% 估约 400 TFLOP/s（推导假设），单条约
**8–9 分钟（推导）**——与 Wan2.1 官方 1.3B 档 4090 约 4 分钟的量级
放缩一致。14B 档官方未给出端到端出片表，此值仅作量级锚，标注未核实。

### 4.4 E2E 三段，别只盯 DiT

一条请求的端到端延迟由三段组成：

1. **text encode**：umt5-xxl 约 4.7B，不能忽略但只跑一次；
2. **N 步 DiT 前向**：绝对大头，第三、五节的全部火力都瞄准它；
3. **VAE decode**：数十秒级，是「分钟级出片」SLO 的尾部延迟大户——治理
   手段 tiling 分块与轻量蒸馏 VAE（LightX2V 的 lightweight VAE 路线）。

## 五、工程化解法栈：LLM 工具箱为什么不迁移，迁移什么

### 5.1 不迁移的四条

1. **没有 decode**：每个请求是单次巨型 compute job、非流式——
   **PD 分离无从谈起**；
2. **没有 KV cache 复用**：上一步的 K/V 对下一步无效，只有跨步近似复用；
3. **batch 收益薄**：单请求常占满 1–8 卡，continuous batching 意义有限，
   调度近似「一个请求一个独占 GPU 组」的 gang scheduling；
4. **但基础设施全都要**：队列化、优先级、抢占、冷热模型、LoRA 热插拔
   一个不少——这正是 SGLang/vLLM 系切入生成侧的理由。

### 5.2 并行是主解法

| 并行方式 | 切什么 | 约束与适用 |
|---|---|---|
| Ulysses | 按 attention head 切，all-to-all 换 head 维 | head 数整除约束：Wan2.1 1.3B 只有 12 head，8 卡只能走 Ring（Wan 官方 README 原话） |
| Ring Attention | 按序列维切，环形 P2P，通信可藏在计算后 | head 少 / 超长序列选它 |
| USP（xDiT） | Ulysses 与 Ring 混合 | 生产默认：Wan 官方多卡方案等于 FSDP 加 USP（引 xDiT 仓库实现） |
| CFG 并行 | 正负 prompt 两路摊到两倍卡 | **免费 2×**（两路计算完全独立） |
| PipeFusion（xDiT） | patch 级流水，跨节点 | 用相邻 denoising 步的时序相似复用旧 KV（stale KV），显式牺牲精度换流水（引 xDiT 仓库实现） |

选型口诀：**head 整除且带宽好选 Ulysses；head 少或超长选 Ring；
生产上 USP 混合加 CFG 并行；跨节点上 PipeFusion。**

### 5.3 显存治理：组件级 offload 四档

视频 DiT 请求是「一次用一个组件」：text encoder（T5-XXL 级）只在开头
跑一次，VAE 只在结尾解码一次——没有理由全程驻留显存。SGLang diffusion
的 component-residency 四档就是标准答案：

```text
resident          全驻留（最快，吃显存）
component-offload 组件用完回 CPU（text encoder 编码完即挪）
snapshot-offload  快照级换入换出（中档权衡）
layerwise-offload 逐层 offload（最省显存，最慢）
```

对照要点：**T5-XXL 这类文本编码器只用一次必须回 CPU**，这一条就能省出
十几 GB；档位选择按「显存预算 × 时延 SLO」拧，与
[显存计算专题](./显存计算专题.md) 的卸载思路同源。

### 5.4 调度与 SLO 形态

- 长任务可抢占性差，配 gang 调度加模型分档：**1.3B 预览档、14B 质量
  档、蒸馏实时档**——LTX「3 秒低清预览加 10 秒高清」的产品形态就是
  调度分档的直接体现；
- E2E SLO 口径是「分钟级出片」而非毫秒级 TTFT——计费与容量规划全部
  围绕 GPU·分钟/秒视频。

## 六、生态功能矩阵与产品形态（2026）

### 6.1 生态 star 矩阵（GitHub API，2026-10-11 抓取）

| 项目 | star | 角色 |
|---|---|---|
| ComfyUI | **136.8K** | 工作流编排事实标准，节点即生态 |
| sglang | **37.0K** | LLM 引擎厂商吃下生成侧的标志（见下） |
| diffusers | **34.7K** | HF 统一 API 层，研究与原型首选 |
| flux | **26.0K** | 开源文生图标杆（BFL 官方仓库） |
| Wan2.2 / Wan2.1 | **17.8K / 17.1K** | 开源视频模型双旗舰 |
| CogVideo / HunyuanVideo | **13.1K / 12.6K** | 视频模型第二梯队 |
| LTX-Video | **11.1K** | 实时视频代表 |
| FastVideo / xDiT | **4.6K / 2.7K** | 后训练加速一体栈 / 并行库底座 |

**SGLang diffusion 是 2026 最重要的结构性事件**：主仓
python/sglang/multimodal_gen，fork 自 FastVideo（2025-09-24）、复用
xDiT 并行库，支持 Wan/Flux/Qwen-Image/LTX-2.x 等模型，带
component-residency 四档、conditioning cache、LoRA、ComfyUI 插件与多
平台支持（AMD/Ascend/Apple/摩尔线程）。一句话：**SGLang 与 vLLM 系
吃掉生成侧在 2026 已成事实**——LLM 引擎的调度与运维基础设施整体平移，
只换掉了 KV 管理这一层。

### 6.2 推理成本锚（均已核实）

- LTX-Video 13B distilled：**H100 上 1216×704 30fps 实时（fp8），HD 出片
  约 10 秒**（LTX-Video README，2025-05）；
- FastWan-QAD：**5s 视频 1.8s 端到端**（FastVideo README，2026-06）、
  **5s 1080p 单卡 4.5s**（2026-03）；
- Wan2.2-TI2V-5B：720p 5s 单卡小于 9 分钟（Wan2.2 README）；
- FastH3 8-step：单卡 5090 可跑视频模型（FastVideo 口径，2026）。

### 6.3 产品形态（仅引官方已公开口径）

| 产品 | 发布 | 已公开规格 | 口径说明 |
|---|---|---|---|
| Sora 2 | 2025-09-30 | 视频加原生音频，分 Pro 档（openai.com/index/sora-2/） | 模型规格未公开，不引参数/训练数据；Peebles 出任 Sora lead 为人员谱系推断 |
| Veo 3 / 3.1 | Veo 3 首发日期为高置信社区共识；3.1 基准 2025-10 | 原生音频；8s 1280×720（deepmind.google/models/veo/） | 规格仅引官方页 |
| Wan 系 | 2025 持续 | 开源权重加闭源 API 双层——2.5/2.6 代只陈述「开源加闭源 API」这一事实分层，不引未核实规格 | 开源档以 README 为准 |
| LTX-2 | 2025-10-23 公告 | 原生音视频同步、4K/50fps、10s | 产品规格新基线 |

## 七、▶ 面试题十条（按频率排序）

| # | 频率 | 追问 | 答题要点 |
|---|---|---|---|
| 1 | ★ | 为什么视频生成没有 KV cache？ | KV 复用的前提是已有 token 表示不再变化；扩散每步 noisy latent 全量改变，上一步的 K/V 对下一步无效。只有跨步近似复用（TeaCache 4.41× / PAB / PipeFusion stale KV）——「近似正确」，非 LLM KV cache 的「精确正确」。金句：生成侧没有精确复用，只有跨步近似。 |
| 2 | ★ | 视频生成 serving 和 LLM serving 根本不同在哪？ | 无 P/D 两相、无增量 decode、无 prefix cache；请求等于巨型 compute job，并发靠 gang 调度加模型分档（1.3B 预览/14B 质量/蒸馏实时）；优化主轴从「KV 管理加批次」换成「序列并行加步数 cache 加稀疏 attention」。但队列、优先级、冷热模型、LoRA 热插拔全要——SGLang/vLLM 系切入的理由。 |
| 3 | ★ | 8s 1080p 视频为什么贵？ | 约 26 万 token × 40–50 步 × CFG×2 ≈ 10^21 FLOPs 量级（推导）；attention 占九成以上且平方项随分辨率时长双增；VAE 压缩比是成本旋钮（Wan2.2 4×16×16 直接除以 4）。 |
| 4 | ★ | MMDiT 和 cross-attention 差别在哪？ | cross-attention 里文本是只读条件；MMDiT 让文本 token 全程参与双向注意力、可被图像反向影响，文本理解与排版更好；代价是双流权重更大、序列更长。Wan2.1 反潮流坚持 cross-attention 加 umt5-xxl，说明没被完全淘汰——成本与效果的取舍。 |
| 5 | ★ | 50 → 28 → 4 步怎么降的？ | 四代人：ODE solver 免训练（20–50）→ 换目标函数直线流（28 档，天然少步）→ 蒸馏（LCM→ADD→DMD2，1–8 步）→ 推理期步间 cache 加稀疏叠加。生产组合三件套：flow matching 底模加 DMD 蒸馏加稀疏 attention。 |
| 6 | ☆ | 视频 DiT 怎么并行？Ulysses vs Ring 怎么选？ | head 整除且带宽好选 Ulysses（all-to-all 换 head 维）；head 少或超长选 Ring（序列维环形 P2P）。约束实例：Wan2.1 1.3B 只有 12 head，8 卡只能 Ring。生产 USP 混合加 CFG 并行（免费 2×）；跨节点 PipeFusion（stale KV）；显存侧组件 offload（T5 用完回 CPU）。 |
| 7 | ☆ | 为什么 DDPM 噪声预测要 50 步、flow matching 28 步就够？ | flow matching 传输路径直线化、曲率小，低阶 solver 大步长误差小；logit-normal 时间步加权集中学习感知关键噪声区（SD3，arXiv:2403.03206）。 |
| 8 | ☆ | CFG 的工程代价是什么？ | 计算量翻倍——每步正负 prompt 两次前向。治理三招：CFG 并行两路摊卡（免费 2×）、guidance distillation（Flux dev 档）、蒸馏直接学掉 CFG（LTX distilled 明写不需要 CFG）。 |
| 9 | ☆ | VAE 在视频生成里是什么角色、瓶颈在哪？ | 时空压缩比决定 token 长度即成本旋钮（4×8×8 到 4×16×16）；因果 3D VAE 保证任意长流式编解码不丢历史时间信息；解码是 E2E 尾部延迟大户——治理靠 tiling 分块与轻量蒸馏 VAE（LightX2V 路线）。 |
| 10 | ☆ | 怎么把视频生成做到实时？（2026 升温） | 五连招：步数蒸馏到 4–8 步、去 CFG、稀疏 attention（VSA/STA）、fp8/int4 kernel、模型降档。证据链：LTX H100 实时加 HD 约 10s、FastWan-QAD 5s 视频 1.8s、FastH3 8-step 上 5090。 |

每题展开素材对照上文对应章节；必背数字锚：**FID 2.27 / 675 GPU day /
4.41× 与 −0.07% / 7.6 万与 26.5 万 token / L/d 判据 15 与 52 /
2×10^20 FLOPs / 8.19 GB 4090 / 136.8K star。**

## 串联阅读

- [多模态架构基础](./llm基础/多模态架构基础.md)：ViT/projector 与训练侧
  视角，谱系前置课
- [多模态推理专题](./inference/多模态推理专题.md)：理解侧（VLM token 化、
  四级缓存、EPD）的姊妹篇，本文是生成侧
- [cuda与kernel专题](./cuda与kernel专题.md)：FlashAttention 谱系与量化
  kernel——SageAttention 那一代的直接上下文
- [显存计算专题](./显存计算专题.md)：显存五笔账与 KV 三旋钮，本文第五节
  offload 显存治理的对照账
- [推理模块导航](./inference/README.md)

## 口径与未核实项说明

1. §4.1 token 数、§4.2 L/d 判据、§4.3 单视频 FLOPs 与时延均为**推导值**，
   4.3 的 H100 有效吞吐（约 400 TFLOP/s、MFU 约 40%）为推导假设；
   Wan2.1-14B 端到端出片表官方未发布，8–9 分钟仅作量级锚并标注未核实。
2. Wan 2.5/2.6 仅陈述「开源加闭源 API」的事实分层，不引规格参数。
3. Sora 2 模型规格未公开；Peebles 任 Sora lead 标为人员谱系推断；Veo 3
   首发日期标社区高置信共识；Seek-omni 系闭源产品线不引任何数字；
   Movie Gen 6144 卡训练规模未核实，正文不引。
4. USP/PipeFusion 引 xDiT 仓库实现，不给 arXiv 编号；B200/H200 官方
   实测表未抓取，不写；FORC 类传闻加速数据全篇剔除。
5. 文中 arXiv 编号（2212.09748/2307.01952/2310.00426/2403.03206/
   2303.01469/2311.05556/2311.17042/2411.19108/2408.12588/2210.09461/
   2411.10958/2502.18137/2502.04507/2505.13389/2412.03603/2501.00103/
   2503.20314）未逐条复核页码与版本，引用前建议按日期抽查。
6. star 数为 GitHub API 2026-10-11 单次抓取快照，引流时会变。

---

*口径截至 2026-10；生态锚点：SGLang diffusion（fork 2025-09-24）、
FastVideo、xDiT、ComfyUI；产品锚点：Sora 2（2025-09-30）、Veo 3.1
（2025-10）、LTX-2（2025-10-23）、Wan2.2（2025-07-28）。
引用前建议按文中日期再核一遍最新 release。*
