# 多 LoRA Serving 专题：一个底座背两千个微调模型

> 面向已经读过 [LoRA 与参数高效微调](../训练与对齐/lora与参数高效微调.md) 的 AI Infra
> 求职者。算法侧（低秩公式、r 怎么选、PEFT 全家桶）本篇只串联不重复——**这里讲的是
> serving 侧**：N 个微调模型怎么折叠成「1 个底座 + N 个小 adapter」，在同一 batch 里
> 被同一个引擎服务。
>
> 读完你会得到：① SGMV/BGMV 与朴素三方案（Loop / Gather-BMM / merge）的完整账目，
> 每笔都落到论文数字；② S-LoRA 四件套（unified paging / 异构 batch / TP 切分 /
> 预取 overlap）的机制与上限；③ vLLM / SGLang / TRT-LLM 三引擎 2024–2026 落地对照；
> ④ hot-swap 成本口算、prefix cache×LoRA 大坑等七条工程议题的面试答法。
>
> **时效口径**：2023→2026 谱系，全部数字注明来源（Punica arXiv:2310.18547、
> S-LoRA arXiv:2311.03285 v3 / MLSys 2024、LoRAX archived blog 与 GitHub、
> dLoRA OSDI'24、vLLM/SGLang 官方 docs 与 issue 区实测）。

## 〇、勘误先行：三处流传错漏，先校准再往下读

多 LoRA serving 的二手资料里有三处高频错漏，面试里纠正它们本身就是加分项：

1. **论文编号**。正确编号是 **Punica = arXiv:2310.18547**（2023-10，UW + Duke），
   **S-LoRA = arXiv:2311.03285**（2023-11 v1，v3 2024-06，MLSys 2024）。网上流传的
   "arXiv:2311.03287" 是错号——那是一篇幻觉分析方向的相关论文，和 Punica 无关。
2. **SGMV 与 BGMV 的出身**。Punica 论文正文里**只出现 SGMV 一个 kernel 名**，通篇
   检索不到 "BGMV"。BGMV（Batched-GMV，prefill 侧、seqlen>1 场景的泛化）是**实现侧
   命名**：它活在 vLLM 源码的 `vllm/lora/punica_wrapper/` 里，以 `bgmv_expand` /
   `bgmv_shrink` 两个函数的形态存活——2026 年的 vLLM main 分支依然如此。这个区分
   来自对论文正文与 vLLM 源码的双边核对：读论文记 SGMV，读代码认 BGMV。
3. **加载耗时张冠李戴**。「adapter 按需加载 ~50µs/层、整模型 ~2ms（PCIe Gen4 x16）」
   是 **Punica 论文自己的数字**（arXiv:2310.18547, 2023）；S-LoRA 论文**没有给绝对
   加载耗时**。把 2ms 记到 S-LoRA 头上是二手文章的常见串味，引用时分清主人。

## 一、第一性问题：N 个微调折叠成 1 底座 + N adapter

业务现实是：同一个开源底座（Llama、Qwen、SD/SDXL）在 HF 生态里挂着**数十万量级**的
LoRA adapter（S-LoRA 论文引 PEFT 生态口径，2023）。每个 adapter 参数量只有底座的
~1%——r=16、挂全线性层的 7B bf16 adapter ≈ **180MB**（Punica README + 本仓
[LoRA 篇](../训练与对齐/lora与参数高效微调.md)口径）。为每个微调 variant 起一份独立
模型实例，显存和运维都是灾难。

多 LoRA serving 的本质就是一句话：**把 N 个微调模型折叠成「1 底座 + N adapter」，
不同 adapter 的请求进同一个 batch 共享底座 GEMM，低秩支路用专用 kernel 补算**：

```text
Y = X·W₀ + (x₁A₁B₁, x₂A₂B₂, …, xₙAₙBₙ)
     ↑ 左项：一次 dense GEMM，吃足底座批量红利（所有请求共享 W₀）
     ↑ 右项：每个 token 各找各的 adapter，SGMV/BGMV 按段补齐
```

左项是 N 个请求白蹭一份底座权重——这正是 decode 带宽 bound 场景下「batch 越大权重
摊销越充分」的老道理（见 [推理调度专题](./推理调度专题.md)）；右项是全部技术含量的
所在：怎么让「混着 n 种 adapter」和「跑单 adapter」的开销差异趋近于零。

## 二、kernel 层：SGMV/BGMV 为什么赢

### 2.1 朴素三方案的账目

| 方案 | 做法 | 死在哪 |
|---|---|---|
| 逐 adapter 循环（Loop） | 同 adapter 的请求凑一组串行跑 | batch 退化成串行，并发红利清零 |
| Gather-BMM | 把各 adapter 的支路输入 gather 成 `[s_n, h_i, h_o]` 大张量再 BMM | 多一次 s_n·h_i·h_o 级显存搬运，访存翻倍 |
| merge 进底座 | 推理前把 BA 加回 W₀ | 单 adapter 时**最快**；多 adapter 并发切换要做全量 GEMM 改写，S-LoRA 实测 **≥2 个 adapter 后被 on-the-fly 反超**（arXiv:2311.03285 v3, 2024） |

### 2.2 SGMV：按段索引的分组 matvec

Punica 的 SGMV（Segmented Gather MatVec）把 batch 内 token **按 adapter 重排成连续
段**，一次 kernel 内按段索引取不同 adapter 权重做 matvec：shrink 算 `v = x·A`，
expand 算 `y = v·B`。两个关键性质：

- **访存 bound 无差别**：低秩支路（r=16）在 roofline 上是纯访存 bound，SGMV 的
  kernel 时间随 workload 从 **37µs 缓升到 116µs**，且始终优于 Gather-BMM
  （arXiv:2310.18547, 2023）。混 LoRA 和同 LoRA 成本近乎无差——**这是整个多 LoRA
  serving 的地基**。
- **端到端数字**：多 LoRA 场景吞吐 **12×**（Punica vs HF Transformers / DeepSpeed /
  FasterTransformer / vLLM，Llama-2 7B/13B/70B，A100 集群，arXiv:2310.18547,
  2023），额外延迟仅 **+2ms/token**；adapter 按需加载 ~50µs/层、整模型 ~2ms
  （PCIe Gen4 x16）。

prefill 侧（一次喂整段 prompt、seqlen>1）的同款思想在引擎实现里叫 BGMV——见第〇节
勘误，论文没这个词，vLLM 的 `bgmv_expand` / `bgmv_shrink` 才是它的户口。

LoRAX 把地基价值量化得更直白：**128 adapter 时 SGMV 延迟仅 +20%，**1M token 摊到
32 个模型和 1 个模型耗时几乎相同（Llama-2 7B，单 A10G，Predibase blog + GitHub,
2023-11）。金句「**LoRAX 生产实测 1→128 adapter 成本近乎恒定**」。

## 三、S-LoRA 四件套：从 kernel 到系统

S-LoRA（MLSys 2024）在 Punica kernel 之上补齐了系统层，单机服务 **2,000 个
adapter**（A10G/A100），吞吐 **≤30× vs HF PEFT、≤4× vs vLLM-packed**
（arXiv:2311.03285 v3, 2024）。四件套：

- **① Unified Paging**：KV cache 和 LoRA 权重进**同一个页池**。洞察是二者同构——
  都是「大小不定 + 动态进出」的对象，统一分页消碎片换更大 batch。这是 PagedAttention
  思想从 KV 到权重的推广。
- **② 异构 batch**：continuous batching + 自定义 MBGMV，支持同 batch 不同 rank 的
  adapter 混跑。代价是一个硬约束：**batch 内活跃 adapter 有上限**（生产旋钮
  `max_loras_per_batch`，SGLang 默认 8）；配套 adapter clustering——优先把同
  adapter 的请求调度到一起，用一点公平性换 batch 效率。
- **③ TP 切分**：ColumnParallelLinear **只切 B 矩阵、A 各卡复制**；RowParallelLinear
  **只切 A、B 复制**——通信只发生在 r 维的小中间秩张量上（NVIDIA TRT-LLM docs 同样
  规则）。vLLM 到 **v0.4.2**（2024-06）才补齐 LoRA 全 TP 支持。
- **④ 预取 + overlap**：用等待队列预测下一拍要用的 adapter，当前 decode 时异步
  H2D。工业版是 SGLang 的 `--enable-lora-overlap-loading`（median TTFT **-35%，**
  adversarial 负载，SGLang docs, 2026）——但有反例，见第六节。

<div class="diagram-embed">
<iframe src="assets/diagrams/lora-serving-map.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/lora-serving-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 四、演进谱系一图流（2023 → 2026）

- **2023-10 Punica**（UW+Duke）：kernel 地基 + 集群级调度（request migration /
  consolidation）。
- **2023-11 S-LoRA**：内存管理 + 单机规模化（2,000 adapter）。
- **2023-11 LoRAX**（Predibase）：TGI v0.9.4 fork 的生产栈——动态加载（HF/存储
  JIT）+ 三级 cache + tenant 隔离 + 内嵌 Punica SGMV。HF TGI 自身没有多 LoRA，
  LoRAX 正是为补这个洞而 fork。
- **2024-01 CaraServe**（字节）：CPU 预跑 prefill 消冷启动 + rank-aware 调度保
  SLO，平均延迟 **≤1.4× 加速**、SLO 达成率 **≤99%（arXiv:2401.11240, 2024）**。
- **2024-01 vLLM v0.3.0**：实验性多 LoRA（PR #1804），**内核直接移植 Punica**。
- **2024-07 dLoRA**（PKU，OSDI'24）：推翻「永不 merge」教条——请求偏斜时 merge 更优，
  credit-based 动态 merge/unmerge + 协同迁移；**≤57.9× vs vLLM（旧基线）、平均延迟
  1.8× 低于 S-LoRA**（USENIX OSDI'24 官网摘要）。
- **2024-09 SGLang**：PR #1307 首发多 LoRA；后续 CUDA graph 支持（PR #4115,
  v0.4.7）、csgmv 后端、pinning、DPA 下 LoRA。docs 明写 "incorporating techniques
  from S-LoRA and Punica"。
- **2025 ServerlessLoRA**：状态三分（base 共享只读 / variant warm / request 私有），
  TTFT **-92.3%** vs serverless 基线，latency-cost **1.66–3.01× vs vLLM-LoRA**
  （arXiv:2505.14468, 2025）。
- **2026 PLoRA**：PCIe staging 被认为逼近极限，转向 CXL/NVLink pooled memory +
  NDP；单 H100 服务 1,000 adapter、decode 延迟平均 **6.6×** 低于实机 S-LoRA，
  短上下文吞吐 32GB/s 即饱和（CXL 3.1 的 1/4）（arXiv:2608.05483, 2026-08，
  **暂无 venue 标注**，引用时注意口径）。

另外有 Symbiosis 等工作在综述里被零星提及，本篇未核实一手材料，不展开。

金句记住：「**Punica 身死而魂不散**」——本体停演进，但 kernel 以 vLLM 的
`punica_wrapper` 和 LoRAX 的 SGMV 续命，S-LoRA 的 unified paging 与调度思想进了
SGLang；反面对照是 LightLLM，官方多 LoRA 支持的 **issue #84 open 至今**（2026 实测）。

## 五、生产三引擎对照表

| | vLLM | SGLang | TensorRT-LLM | LoRAX（独立栈） |
|---|---|---|---|---|
| 多 LoRA 起点 | v0.3.0（2024-01-31, PR #1804） | PR #1307（2024-09） | 两级 LoRA cache + DoRA | TGI fork（2023-11） |
| kernel 血统 | 直接移植 Punica（`punica_wrapper`/`bgmv_*`） | csgmv 后端（延迟提升 **20–80%** vs 自家 triton 后端，SGLang docs, 2026） | 自研 + TRT 生态 | 内嵌 Punica SGMV |
| 缓存层级 | `max_loras`（GPU）+ `max_cpu_loras`（host 二级） | pinning（≤ `max_loras_per_batch - 1` 常驻）| host（定大小）+ GPU（按剩余显存百分比），evict 最旧 | GPU → host → 磁盘三级 |
| 批内上限 | `max_loras_per_batch` | 默认 **8**，pinned ≤ 上限 −1；DPA 模式全部必须 pinned | — | — |
| 特色 | V1 全 TP（v0.4.2）、QLoRA（PR #4776）、`load_inplace` RA 更新 | overlap 加载 TTFT **-35%、**lru/fifo、`--lora-drain-wait-threshold` 防垄断 | DoRA 即拆即算 | tenant 隔离、private adapters 卖点 |
| 反面/坑 | prefix cache 串 cache（issue #30931） | overlap 反例 28ms→82ms（见下） | 生态绑定 N 卡 | 公司变动后引用看 archived blog/GitHub |

一句话收：**vLLM 赢在生态与版本节奏，SGLang 赢在多 LoRA 调度细节文档化最全，
TRT-LLM 赢在 N 卡栈整合，LoRAX 是最早把多 LoRA 做成产品的独立栈。**

## 六、工程议题七条（面试主战区）

### 6.1 Hot-swap 成本模型（必考口算）

按 [显存计算专题](../显存计算专题.md) 的口径，一笔一笔算：

```text
adapter（7B, r=16, bf16）≈ 100–200MB
PCIe Gen4 x16 有效带宽 ≈ 25–30 GB/s
单 adapter 换入 ≈ 150MB / 27GB/s ≈ 3–8 ms
（Punica ~2ms、SGLang docs 「2ms 加载」同量级，口径一致）
```

成本 = 传输 + pinned host memory 占用 + 调度空窗三笔。生产隐藏手法：预取 / overlap /
热点 pinning。**面试加分点**：SGLang docs 自己给了 overlap 反例——4 个 adapter
各 2ms 加载、20ms prefill 的场景，**同步 28ms 反而优于 overlap 82ms**：adapter
加载比 prefill 还快时，overlap 会把 multi-adapter prefill batch 拆碎。

### 6.2 LRU 之外的驱逐策略

SGLang 提供 lru（默认）/ fifo；vLLM 是 `max_loras`（GPU 一级）+ `max_cpu_loras`
（host 二级）；TRT-LLM 两级 cache（host 定大小、GPU 按剩余显存百分比）evict 最旧；
SGLang 的 `--lora-drain-wait-threshold` 专门防少数 adapter 长期垄断 batch 槽位。

### 6.3 热点 vs 冷备

SGLang pinning 让 ≤ `max_loras_per_batch − 1` 个 adapter 常驻 GPU；冷 adapter 退到
host（`max_loaded_loras`），再冷退磁盘（LoRAX 三级 cache 同款思路）。注意 DPA
（数据并行注意力）模式下所有 adapter **必须 pinned** 且上限同样减 1。

### 6.4 Per-request 路由

网关层把 adapter 名当独立模型路由：vLLM 的 `/models` 把每个 adapter 暴露为独立条目
并带 parent 血缘。未加载 adapter 的行为（动态 load / 直接拒绝）必须显式定义。
vLLM 的 `VLLM_ALLOW_RUNTIME_LORA_UPDATING` + LoRAResolver 插件支持 fs/HF/S3 源动态
加载——官方明确警告：**非可信环境不要开**。

### 6.5 prefix cache × LoRA：最被低估的坑

LoRA 改的是 QKV 投影 → **同一 prompt 在不同 adapter 下 KV 不同——prefix cache 的
key 必须包含 adapter 身份**。这不是理论洁癖：vLLM **issue #30931**（2025 起 open）
就是「同名不同 id 的 adapter 串 cache」的实锤。共享 base system prompt cache 与安全
多租户共存时，key 隔离必须显式设计——答出这条是面试金矿。

### 6.6 Rank 异构

S-LoRA 的 unified pool 原生支持不同 rank 共存；LoRAX 遇 rank 异构回退 Loop 路径；
vLLM 需要 `max_lora_rank` 上界预留显存——**设大了浪费且损性能**；SGLang 动态加载要求
后加载 adapter 的 rank/模块不超过初始集合，否则启动时显式抬 `--max-lora-rank`。

### 6.7 RL 场景的 in-place 更新

vLLM 的 `load_inplace=True` 支持**同名 adapter 热替换权重**——为 rollout 引擎每
iteration 吐新 adapter 的 RL 流程量身设计，避免整模型重载。与
[RL 训练工程实战](../训练与对齐/rl训练工程实战.md) 的 rollout 侧联动看。

## 七、QLoRA × 多 LoRA serving：可行，但有 dtype 组合账

NF4 底座 + bf16 adapter 的组合**已落地**：底座量化 kernel 解出 bf16 激活 → adapter
支路走独立的 bf16 GEMM → 加法融合，**adapter 全程不碰 4bit 权重**。证据链：vLLM
**PR #4776**（2024-06-01，QLoRA 支持）；LoRAX 支持 bnb/GPTQ/AWQ 底座且官方示例
adapter 就是 QLoRA。

诚实标注：S-LoRA 论文把量化列为**正交优化而非 core technique**——引用时别说成
S-LoRA 的贡献。坑也有案底：vLLM 的 BNB+LoRA `target_modules` loader bug
（PR #10720，2024-12 修复）；SGLang 的 overlap loading 与部分量化后端组合受限。

## 八、业务场景五条

1. **DreamBooth / 图像风格**：用户传几张照片训主题 LoRA（DreamBooth,
   arXiv:2208.12242, CVPR'23），Civitai 生态催生海量 SD/SDXL LoRA——「一底座 N
   adapter」的需求源头就长在这里。
2. **代码模型多场景**：SQL 生成 / 单测 / 代码评审各挂一个 adapter 共享 code LLM
   底座——vLLM/SGLang 官方示例都用 text2sql adapter 演示。
3. **企业私有微调多租户网关**：每租户一个私有 LoRA，网关按租户路由 + 隔离（LoRAX
   private adapters 的核心卖点）；与本仓
   [设计 AI 开发平台](../system-design/设计ai开发平台.md) 的「7B LoRA 占训练任务
   70%」假设互证。
4. **RL 管线 serving 侧**：rollout policy 每 iteration 更新，adapter in-place 热
   替换（见 6.7）。
5. **Predibase 生产案例**：blog 宣称单卡服务数百个微调模型（2023-11，按「宣称」
   口径引用；公司后被 Rubrik 收购，**时间点未实锤**，引用 LoRAX 数字请用 archived
   blog / GitHub 一手页面）。

## 九、▶ 面试题十条（频率为经验标注）

1. 【极高】底座 + 500 租户 LoRA 怎么设计 serving 架构？——unified paging / 两级
   cache / 路由全链路串起来答（本文第一、三、五、六节）。
2. 【高】SGMV/BGMV 是什么？为什么不能 merge 一把梭？——merge 切换成本 + ≥2 个
   adapter 被 on-the-fly 反超（2.1、2.2）。
3. 【高】批内 adapter 为什么有限制？`max_loras_per_batch` 设大设小各付什么代价？
   ——异构 batch 显存与调度约束（3.2、6.2）。
4. 【高】adapter 换入换出的成本模型？怎么隐藏？——PCIe 带宽算账 → 预取 / overlap
   / pinning；答出 SGLang 82ms vs 28ms 反例加分（6.1）。
5. 【中高】prefix cache 和 LoRA 共存的问题？——KV per-adapter 不同，cache key 需
   含 adapter id，vLLM issue #30931（6.5）。
6. 【中高】TP 下 LoRA 权重怎么切？——ColumnLinear 切 B 复制 A、RowLinear 反之，
   通信只在小秩张量（3.3）。
7. 【中】rank 不同的 adapter 怎么混批？`max_lora_rank` 显存怎么预留？（6.6）
8. 【中】QLoRA 底座 + 多 LoRA serving 可行吗？精度/性能坑？——可行，独立 GEMM
   路径；dtype 组合、BNB bug 史（第七节）。
9. 【中】Punica 与 S-LoRA 的分工差异？为什么 Punica 主要优化 decode？——kernel
   地基 vs 内存管理 + 规模化两件套（第二、三节）。
10. 【低】2024 后还有哪些演进方向？——dLoRA merge/unmerge、CaraServe CPU 预跑、
    serverless 化、CXL/NDP（第四节，开放档次题）。

## 串联阅读

- [LoRA 与参数高效微调](../训练与对齐/lora与参数高效微调.md)：算法侧公式、初始化、
  r 选取——本篇的前置。
- [推理调度专题](./推理调度专题.md)：continuous batching 与 token budget——多 LoRA
  的 batch 红利来自这里。
- [vLLM 与推理加速核心](./vllm与推理加速核心.md)：PagedAttention——unified paging
  是它的推广。
- [量化与压缩](./量化与压缩.md)：NF4/INT4 底座——QLoRA serving 组合的底座口径。
- [设计 AI 开发平台](../system-design/设计ai开发平台.md)：多租户 LoRA 网关的系统
  设计落点。
