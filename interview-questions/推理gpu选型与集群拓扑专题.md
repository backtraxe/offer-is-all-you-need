# 推理 GPU 选型与集群拓扑专题：规格梯队、三步选型账与每百万 token 成本根

> **面向**：已读过 [显存计算专题](./显存计算专题.md)（KV 与权重的字节账）与
> [finops与算力成本专题](./finops与算力成本专题.md)（三段式成本公式）的读者。
> 本篇回答的是面试里那条最常被现场白板的追问线——**给定模型与 SLO，选什么卡、
> 几卡、什么网络拓扑，最后每百万 token 多少钱**。与已有专题的边界：
> Groq/Cerebras 等 SRAM 阵营见 [推理专用硬件专题](./推理专用硬件专题.md)，
> 昇腾/CloudMatrix 见 [国产卡生态专题](./国产卡生态专题.md)，拓扑感知调度见
> [集群调度与资源管理专题](./集群调度与资源管理专题.md)，本篇只串联、不重复。
>
> **读完获得**：① 2022→2026 推理 GPU 规格梯队的一张对比表与口径纪律；
> ② 容量→带宽→SLO 的**三步选型决策链**（全部可白板推导）；
> ③ 推理集群拓扑的硬词汇（scale-up 域 / rail-optimized / PD 分离 / 大 EP）
> 以及 NVL72 超节点对 PD 分离与大 EP 的实际影响；
> ④ 每百万 token 成本的推导方法与两个硬锚点（SGLang 与 Dynamo 口径分明）；
> ⑤ 三道完整白板选型例题；⑥ 十条面试题的完整答法。
>
> **时效口径 2026-10**：规格数字以 NVIDIA/AMD/Google/AWS 官网 2026-10 抓取
> 为准；SGLang 大 EP 数字为 lmsys.org 团队一手实测博文（2025-05）；
> NVIDIA/AMD/AWS 的倍数宣称一律标注**官方口径**；Atlas 950/昆仑芯超节点为
> 媒体报道口径。未核实项统一在第八节声明。

## 一、直觉：推理选卡不是买算力，是买带宽、显存和「域」

先讲三个违反直觉的事实，它们就是本篇的全部种子。

**同算力的两张卡，推理快慢可以差出一截**。H200 与 H100 的 Tensor Core 算力
**完全相同**（FP8 与 BF16 逐位一致，NVIDIA 官网规格表口径），但 H200 官方宣称
Llama2-70B 推理快 **约 1.9 倍**（NVIDIA 官方口径，2023）——多出来的速度全部
来自显存：容量近 2 倍、带宽 1.4 倍。原因一句话：**每生成一个 token 都要把
权重完整读一遍**（decode 阶段的本质），单用户速度上限 ≈ 显存带宽 ÷ 每 token 读出的字节数，
算力在旁边围观。所以推理选型的第一排序键是**带宽与显存**，不是 FLOPS。

**低精度格式是推理专用的降价刀**。B200 起原生 FP4：权重字节数从 BF16 的 2 字节
砍到 0.5 字节，同一批模型「放得下」的卡数下限直接腰斩，decode 每 token 的读取
量也减半。训练侧 FP8 到头（梯度噪声扛不住），FP4 是推理独享的甜点——这是
Blackwell 代际红利的正确打开方式，不是算力翻倍。

**机柜本身变成了新卡型**。GB200 NVL72 把 72 张 GPU 用 NVLink 交换系统连成一个
柜内 all-to-all 域，柜内聚合 130 TB/s（NVIDIA 官网口径）；而跨机走网卡只有
50-100 GB/s 量级。MoE 大 EP（专家并行）的 dispatch/combine 通信一旦收进这个域，
时延与抖动降一档——**这个大域的红利是 MoE 专有的**，dense 模型用不上，
NVIDIA 自己的官方数字都这么说（见第四节）。

记住这条决策骨架，后面所有内容都是它的展开：

- **放不下没资格谈优化**：权重 + KV 的字节账先定最低卡数；
- **放得下了看带宽**：decode 吞吐与单流速度都吃 HBM 带宽；
- **SLO 逼出拓扑**：长上下文与大 EP 会把网络变成瓶颈，拓扑选型登场。

<div class="diagram-embed">
<iframe src="assets/diagrams/inference-gpu-topology.html" width="100%" height="860" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/inference-gpu-topology.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、机制：2022→2026 推理 GPU 规格梯队

### 2.1 三条梯队，各自解决什么

**第一梯队：Hopper 存量主力（H100/H200，2022-2023）**。H100 到今天仍是推理
存量池的绝对主力：80GB HBM3、3.35 TB/s、NVLink 900 GB/s、700W（NVIDIA 官网，
2022 发布）。H200 是「同算力换内存」的教科书案例：141GB HBM3e、4.8 TB/s，
其余规格与 H100 逐项相同（NVIDIA 官网，2023）。推理含义：**同价位下 H200
对 H100 的 decode 优势直接等于带宽差**，这是推理账里最经典的「显存带宽买
吞吐」交易。

**第二梯队：Blackwell 单节点（B200/B300，2024Q4-2025）**。B200 单卡约 180GB
HBM3e、带宽约 8 TB/s、NVLink 5 代 1.8 TB/s，原生 FP4/FP6（NVIDIA HGX 平台页，
2026-10 抓取）。B300（Blackwell Ultra）把显存推到 270GB 并给注意力特化：
官方表注 Attention Performance 2x vs Blackwell（NVIDIA 官方口径）——它对准
的是长上下文、KV-heavy 的 decode 场景，是 NVL72 之外「中 NVLink 域」的首选。

**第三梯队：机柜级与下一代（GB200 NVL72 / Rubin，2024Q4-2026）**。NVL72：
36 Grace CPU + 72 Blackwell GPU 液冷单柜，13.4TB HBM3e、聚合带宽 576 TB/s、
柜内 NVLink 交换 130 TB/s（NVIDIA 官网口径）。Rubin 单卡：288GB HBM4、
22 TB/s、NVLink 6 代 3.6 TB/s，NVIDIA HGX 页口径为 2026 年 ramping into
full production；HGX Rubin NVL8 官方宣称 token 工厂吞吐 **约 10 倍**于
HGX B200（Kimi K2-Thinking 场景，FTL≤500ms，ISL/OSL 4K/4K，NVIDIA 官方口径）。

**非 NVIDIA 阵营一句话**：MI300X 以 192GB HBM3 加 5.3 TB/s（AMD 官网，2023）
成为推理性价比标杆；MI355X 288GB 加 8 TB/s 带宽追平 B200（2025-06 发布，
Wikipedia 引官方宣称口径）；TPU v6e 算力密度高但单芯片只有 32GB HBM，哲学
是「靠芯片数堆容量」，与 GPU 的单卡大 HBM 相反（Google 文档，2026-10 抓取）；
AWS Trainium2 单芯片 96GB 加 2.9 TB/s，官方宣称性价比优于 GPU 实例
**三至四成**（AWS 官方口径，2024-12 re:Invent）。

### 2.2 横向对比表（dense 口径，sparse 已减半）

| 卡 | 发布/出货 | FP8 dense | FP4 dense | BF16 dense | HBM | 带宽 | 域内互联 | TDP |
|---|---|---|---|---|---|---|---|---|
| H100 SXM | 2022Q3 | 约 1.98 PF | — | 约 0.99 PF | 80GB HBM3 | 3.35 TB/s | NVLink 900 GB/s | 700W |
| H200 SXM | 2023Q3 | 约 1.98 PF | — | 约 0.99 PF | 141GB HBM3e | 4.8 TB/s | NVLink 900 GB/s | 700W |
| B200 | 2024Q4 | 4.5 PF | 9 PF | 2.25 PF | 约 180GB HBM3e | 约 8 TB/s | NVLink5 1.8 TB/s | 1000W |
| B300 | 2025 | 4.5 PF | 13.5 PF | 2.25 PF | 270GB HBM3e | 约 8 TB/s | NVLink5 1.8 TB/s | 液冷档 |
| GB200 NVL72/柜 | 2024Q4 | 360 PF | 720 PF | 180 PF | 13.4TB | 576 TB/s | 柜内 130 TB/s | 柜级 |
| Rubin 单卡 | 2026 ramp | 17.5 PF（训练口径） | 50 PF（推理 sparse 口径） | 4 PF | 288GB HBM4 | 22 TB/s | NVLink6 3.6 TB/s | — |
| MI300X | 2023-12 | 2.61 PF | — | 1.3 PF | 192GB HBM3 | 5.3 TB/s | IF 互联 | 750W |
| MI325X | 2024-12 | 2.61 PF | — | 1.3 PF | 256GB HBM3e | 6.0 TB/s | IF 互联 | 1000W |
| MI355X | 2025-06 | 约 4.6 PF | 9.2 PF（sparse 宣称口径） | 约 2.3 PF | 288GB HBM3e | 8 TB/s | IF 互联 | 1400W |
| TPU v5p | 2023-12 | 459 TF | — | 459 TF | 95GB | 2.765 TB/s | ICI 1.2 TB/s | — |
| TPU v6e | 2024Q4 | Int8 1836 TOPS | — | 918 TF | 32GB | 1.638 TB/s | ICI 800 GB/s | — |
| Trainium2 | 2024-12 | 约 1.3 PF | — | — | 96GB HBM3 | 2.9 TB/s | NeuronLink | — |
| Trainium3 | 2025-12 发布 | MXFP8 2× 口径 | — | — | 144GB HBM3e | 4.9 TB/s | NeuronLink 2× | — |

### 2.3 口径纪律三条（面试官最爱抓）

1. **sparse 与 dense 不可混比**：Blackwell 与 CDNA4 的官网表大量标 sparse，
   横比之前 dense 一律减半。表里所有「约 × PF」的 dense 值已按纪律折算。
2. **FP4 数字先对齐格式再对比**：NVIDIA 的 NVFP4 与 AMD 的 MXFP4 不是同一
   格式，宣称的 PFLOPS 直接相减没有意义。
3. **倍数宣称全部绑场景**：30 倍、50 倍、10 倍、35 倍这类数字全部绑定
   特定 ISL/OSL/SLO 与精度口径，引用时口径必须带在身上，否则一追就穿。

## 三、工程一：三步选型决策链（白板可推的方法论主体）

被问「这个模型上线选什么卡」，不要背型号，当场推这条链。

### 3.1 第一步：放得下（容量账）

权重字节 ≈ 参数量 × dtype 字节（BF16 取 2B、FP8 取 1B、FP4 约 0.5B）；MoE 按
总参数装卡，不按激活参数。KV 每 token 字节 ≈ 2 × 层数 × KV 头数 × 头维 × dtype
（系数的推导见显存计算专题，本篇直接用）；MLA 路线把 KV 压到等效约 576 维，
这是 DeepSeek V3/R1 能做大 EP 的显存前提。

代入感受一下卡数下限的咬合力：**权重约 671GB**（DeepSeek-V3 671B 的 FP8
口径）——
B200（180GB）4 卡不够、8 卡充裕；MI325X（256GB）4 卡恰好；H200（141GB）
8 卡放下但剩给 KV 的空间很薄。容量账的输出只有一个：**最低卡数下限**，
低于这个数一切免谈。

### 3.2 第二步：跑得动（decode 带宽账）

单用户 tok/s 上限 ≈ 有效 HBM 带宽 ÷ 每 token 读出的权重字节（batch=1 时读全量
权重或全部激活专家）。聚合吞吐 = 带宽 ÷ 每 token 字节 × batch 效率。

代入（70B BF16，decode 每 token 读约 140GB）：

- H100 3.35 TB/s → **单流约 24 tok/s**；
- H200 4.8 TB/s → 约 34 tok/s，同算力白捡 1.4 倍；
- B200 约 8 TB/s → 约 57 tok/s；
- MI300X 5.3 TB/s → 约 38 tok/s。

MoE 只读激活专家：V3 每 token 激活约 37B FP8 参数即约 37GB 读取量，H200 理论
单流约 130 tok/s，工程上打五到七折。这就是「选卡先看带宽除以激活权重」的
逻辑——同价位 H100 与 H200 二选一时，**选 H200 就是直接以带宽差起步**。

### 3.3 第三步：SLO 卡并发（prefill 算力账）

prefill 吃算力，决定 TTFT：FLOPs ≈ 2 × 激活参数 × 输入长度。V3 输入 2K 时，
单请求约 1.48e14 FLOPs；H100 的 FP8 dense 有效供给约 8e14 FLOPs/s（按 4 成
MFU 估），单卡一刻之地约 200ms 级。但输入上到 32K（agent/RAG 常态），
prefill 成本 ×16，TTFT 立刻出格——**这正是 PD 分离的选型动机**：把 prefill
池单独伸缩，别让长输入挤占 decode 池的带宽（接第四节）。

### 3.4 场景速查表（2026-10 口径）

| 场景 | 首选 | 为什么 |
|---|---|---|
| 70B dense 在线 | H200 / B200 / B300 | decode 吃带宽；B300 长上下文加成 |
| 压成本的 70B | MI300X | 192GB 单卡装权重加 KV 正好 fit |
| KV-heavy 长上下文 agent | B300 / HGX B300 | 270GB 直接抬 batch 上限 |
| 大 EP MoE 在线 | GB200/GB300 NVL72 | 64 卡级 EP 收进柜内低延迟域 |
| 成本极致离线批 | H100 存量 + MI300X | 时租低一档，吞吐照样堆 |
| 云上自用栈 | TPU v6e / Trainium2 | 官方宣称再省三至四成，代价是迁移 |

离线池与在线池分开是铁律：**离线堆旧卡与 spot 吃吞吐，在线用新卡留冗余保
SLO**，两池的钱分开算、互不补贴。

## 四、工程二：推理集群拓扑——NVL72/超节点 vs IB/RoCE

### 4.1 三层网络词汇（面试硬词汇表）

- **scale-up 域**：NVLink domain、Infinity Fabric 域、NeuronLink、ICI 的统称。
  HGX 节点内 900 GB/s，比网卡高一个数量级；NVL72 把这个域放大到 72 卡、
  柜内 130 TB/s；CloudMatrix 384 用光 module 把域放大到 384 卡（数字见国产卡
  生态专题，本篇引用结论）。
- **scale-out 网络**：IB（NDR 400G→XDR 800G）与 RoCE 以太。训练主力是胖树
  无阻塞；**现在的事实标准是 rail-optimized**（每 GPU 一张网卡、一条 rail，
  8 rail 胖树）——all-to-all 与 EP 集合通信天然沿 rail 走，拥塞局部化。
  Dragonfly 系 hop 更少但热点难局部化，GPU 云公开口径清一色胖树或
  rail-optimized（行业文献口径，原始链接见第八节声明）。
- **DPU/SuperNIC**：CX-7 400G 配 H100 代、CX-8 800G 配 Blackwell 代；RoCE
  无损要 PFC/ECN，推理流量突发小报文多，PFC 风暴是真实线上故障型。

网卡代际锚：B200 板级网络 0.8 TB/s，B300 翻倍到 1.6 TB/s，Rubin NVL8 标
1.8 TB/s（NVIDIA HGX 页，2026-10 抓取）。

### 4.2 PD 分离 = 把 KV 传输变成网络问题

PD 分离后，prefill 产出的整段 KV 要搬到 decode 节点。V3 场景每 token KV 约
70KB（MLA 压缩口径，系数以显存计算专题为准）：

- 8K 输入 ≈ 560MB：400G rail（约 50GB/s）上传输约 11ms，800G 约 5.6ms，
  相对 1-2s 的 TTFT 预算尚可；
- 128K 输入 ≈ 9GB：400G 要 180ms，**这时 KV 传输直接进入 SLO 尾巴**。

工程结论：**两个池不要跨 rail 打散，prefill 与 decode 最好收在同一 fat-tree
blossom 内**；KV 流转半径控制在机柜级能省掉 spine 带宽。SGLang 的 PD 分离
走 RDMA + NIXL/Mooncake（lmsys 2025-05 博文口径）；NIXL 的意义是把
NVLink、IB、RoCE、以太抽象成同一张内存搬运 API（NVIDIA Dynamo 博文，
2025-03 GTC 口径）。

### 4.3 大 EP MoE：NVLink 域大小决定 all-to-all 留在哪一层

硬实测锚（lmsys.org 2025-05-05 博文，SGLang，96×H100、12 节点、IB 互联，
DeepSeek-V3 FP8 大 EP）：

- prefill 用 4 节点 EP32，每节点 **50,302 tok/s**（ISL 4K），距 DeepSeek 官方
  profile 只差 5.6%；
- decode 用 9 节点 EP72，每节点 **22,282 tok/s**（batch 256），对 TP16 基线
  **提升约 5.2 倍**；
- 全集群端到端折合 **每百万输出 token 约 0.20 美元**（按 H100 云时租折算的
  推导口径，非账单实测），约为 DeepSeek 官方 API 价的五分之一；
- 跨机通信靠 DeepEP dispatch/combine，IB 上 dispatch 约 0.17ms 每层；
  EPLB 再提速 1.49 倍（prefill）与 2.54 倍（decode）。

同一工作负载放到 GB200 NVL72 上：NVIDIA Dynamo 官方宣称 DeepSeek-R1 的
requests 提升 **约 30 倍**（NVIDIA 官方口径，TensorRT-LLM FP4，ISL/OSL
32K/8K；分离后 generation 用 EP64）——**整个 EP64 组全部落在 NVLink 域内**，
dispatch 走 1.8 TB/s 而不是 50-100 GB/s 的网卡。而同一个 Dynamo 在 dense
Llama-70B 上只宣称约 2 倍（NVIDIA 官方口径，Hopper）。

两组数字放一起，就是面试那句话：**大域的红利是 MoE 专有的——NVLink 大域把
all-to-all 留在机柜内的那一档优势，dense 模型不必为它付钱**。同时 SGLang 在
H100 上「没有 NVL 域也能跑」的实测说明：**它不是必要条件而是杠杆**——
NVL72 的角色是把 SLO 抬高一档、把 EP 组继续撑大。

国产超节点对位（报道口径，详情见国产卡生态专题）：CloudMatrix 384 用 6,912 个
400G LPO 光模块把 384 张卡连成大 scale-up 域，思路与 NVL72 相同——用光互联
域吃掉大 EP 通信（FT 2025-04 转引口径）。

### 4.4 拓扑对调度的新增约束

- rail-optimized 下 EP 组跨 rail 混搭，all-to-all 在 spine 撞车 → 推理长尾；
  生产实践是 **EP 组先收单机或同 NVLink 域，跨机沿同一 rail 走**；
- PD 分离下 decode 池看重同 rack 的 KV 亲和，KV 流转半径 = 机柜级最省；
- 与集群调度专题的交接：拓扑感知调度在推理同样值钱，但粒度从 job 变成
  **P 池、D 池与 EP 组的放置**。

## 五、数字锚（背诵版，全部带口径）

- **H100 显存与带宽档：80GB、3.35 TB/s**（NVIDIA 官网，2022 发布）；
  **H200 同算力换内存：141GB、4.8 TB/s**（NVIDIA 官网，2023 发布）。
- **H200 官方宣称 70B 推理约 1.9 倍于 H100**（NVIDIA 官方口径，2023）——
  纯显存红利，带宽 1.4 倍、容量近 2 倍。
- **B200 单卡约 180GB 加约 8 TB/s，NVLink5 每 GPU 1.8 TB/s**（NVIDIA HGX
  平台页，2026-10 抓取）；**而 B300 把显存推到 270GB、注意力特化约 2 倍**
  （NVIDIA 官方口径，2025）。
- **GB200 NVL72 全柜 13.4TB HBM、聚合 576 TB/s、柜内 NVLink 交换 130 TB/s**，
  官方宣称实时万亿参数推理约 30 倍于 H100（NVIDIA 官方口径，32K/1K 场景，
  2024Q4-2025）。
- **Rubin 单卡 288GB HBM4、22 TB/s、NVLink6 3.6 TB/s**（NVIDIA HGX 页，
  2026 ramp 口径）；NVL8 宣称 token 工厂吞吐约 10 倍于 HGX B200（NVIDIA
  官方口径，Kimi K2-Thinking 场景）。
- **MI300X 为 192GB 加 5.3 TB/s**（AMD 官网，2023-12）；**后续 MI325X 到
  256GB 加 6.0 TB/s**（2024-12）；**再到 MI355X 的 288GB 加 8 TB/s**
  （2025-06，FP4 9.2 PF 为 sparse 宣称口径）。
- **TPU v6e 单芯片 918 TF BF16 但只有 32GB HBM**（Google 文档，2026-10
  抓取）——算力密度与显存密度的反向取舍样本。
- **Trainium2 单芯片 96GB 加 2.9 TB/s，UltraServer 64 芯片 6TB HBM**（AWS
  官网，2024-12）；官方宣称性价比优于 GPU 实例三至四成（AWS 官方口径）。
- **SGLang 大 EP 实测：96×H100 折合每百万输出 token 约 0.20 美元**、
  decode 对 TP16 提升约 5.2 倍（lmsys.org 一手实测，2025-05；云时租折算
  口径、非账单）。
- **Dynamo on GB200 NVL72 宣称 DeepSeek-R1 requests 约 30 倍**（NVIDIA 官方
  口径，2025-03，ISL/OSL 32K/8K 与 FP4 场景）；同框架 dense 70B 只宣称
  约 2 倍——域红利 MoE 专有。
- **decode 单流上限公式：tok/s 约等于 HBM 带宽除以每 token 权重字节**，
  MoE 按激活参数代入（推导公式，与推理专用硬件专题同一公式）。
- **V3 每 token KV 约 70KB**（MLA 压缩口径），128K 上下文一次 PD 搬迁约
  9GB，400G rail 约 180ms（推导口径，系数以显存计算专题为准）。
- **H100 云时租 2026-10 在 2.89 到 6.88 美元区间**（RunPod/Lambda/AWS，
  FinOps 专题当日实测口径）；代回 SGLang 数据复算约 0.30 美元每百万输出
  token，与原文同量级——**成本锚对时租假设高度敏感**。

## 六、白板推导三例（完整选型题）

### 例 1：Llama-3.1 70B BF16 在线 chat，P99 TTFT<1s、ITL<50ms，ISL 2K/OSL 200，峰值 500 并发——H200 还是 B200？

容量账：权重 140GB。H200 单卡 141GB 装权重即满、KV 无处放，至少 TP2
（282GB，留约 270GB 给 KV 池）。KV 每 token 按 GQA 系数代入（公式见显存
计算专题），平均历史 2.2K × 并发定 batch 上限。

带宽账：H200 4.8 TB/s ÷ 140GB ≈ **单流 34 tok/s**；batch 64 折算后聚合约
1,500-2,000 tok/s 每卡（按 4-6 成 MHBU 工程口径）。500 并发 × 30 tok/s 每流
= 15k tok/s，落在 **8-10 卡 H200**（一套 HGX 加冗余）。B200 同账：带宽 8
TB/s、FP8 权重减半，单卡装权重加 KV，节点数直接砍半——但 B200 时租仍是
H200 的 1.6-2 倍（2026-10 FinOps 口径），每 token 成本谁赢取决于利用率
水位：高水位 B200 赢，低水位或吃存量池 H200 赢。

教训点：**模型 70B 恰好卡在 H100/H200 单卡装不下的临界线上，B200 是单卡
装权重起步的分水岭**——装得下与否改变的是最小部署单元的颗粒度。

### 例 2：DeepSeek-V3/R1 671B FP8 大 EP 在线，ISL 4K/OSL 2K——HGX B300 还是 GB300 NVL72？

容量账：权重约 671GB。B300(270GB)×4 合计 1,080GB，含 KV 有余；单机 EP8
可行，但 decode 的 dispatch 在 8 卡内受限专家容量；EP16/32 跨机走 CX-8 800G，
单口约 100 GB/s。

域账：NVL72 上 EP64 全在柜内域（Dynamo 官方配置即 generation EP64），
dispatch 走 1.8 TB/s 而非网卡，长尾由域内带宽保障。

实测锚与结论：SGLang 在 H100 加 IB 上都做到每节点 22.3k 输出 tok/s（lmsys
2025-05），**证明没有 NVL 域也能跑**；Dynamo 官方宣称 NVL72 上 requests 约
30 倍。**红利是杠杆而不是入场券——NVL72 负责 SLO 提档与大 EP 撑大**。
预算锚均为媒体
口径：GB200 NVL72 单柜公开报价约 300-350 万美元（2025 媒体口径，未核实），
8 卡 B300 HGX 节点约 50-60 万美元（媒体口径）——ROI 账 = 吞吐 × 利用率 ×
时租差。

### 例 3：离线批量注入（合成数据/评测），50B dense FP8 纯吞吐——旧卡打天下

离线无 SLO，MHBU 可推到 8 成以上；H100 的 3.35 TB/s 配上 2.9-4 美元时租就是
**每 token 成本最优区间**；再掺 MI300X（5.3 TB/s 且云价常打七折）作第二池
防排队。一句话答案：**离线池 = 旧卡加 AMD 加 spot，在线池 = 新卡加冗余，
两池分离**。

## 七、▶ 面试题十条

1. ★★★★★ **70B 模型上线，你先问哪三个数字？**——dtype、ISL/OSL、并发。
   三个数喂进三步账：容量定最低卡数、带宽定 decode 速度、prefill 算力加
   SLO 定 PD 形态；型号是最后一步的结论，不是第一步的输入。
2. ★★★★★ **H100 和 H200 一样贵，推理选谁？**——同算力，H200 带宽 1.4
   倍、容量 1.75 倍（NVIDIA 官网 2023 口径），decode 直接吃带宽差；但
   MHBU 低的并发档差异收窄，且存量 H100 池有时租折让，离线场景另算。
3. ★★★★ **为什么 B200 起原生 FP4 重要？**——权重字节腰斩 = 容量下限
   腰斩 + decode 每 token 读量减半；FP4 是推理专用数据格式（训练侧 FP8
   到头），所以 Blackwell 的代际红利在推理侧兑现得比训练侧干净。
4. ★★★★ **NVL72 宣称 30 倍，为什么你的场景只能兑现一部分？**——30 倍
   口径绑定 32K/1K 输入输出、FP4、EP64 与 TTL 50ms（NVIDIA 官方口径，
   2025-03）；dense 模型、短输入、SLO 不紧时差距收窄——同一框架 dense
   70B 官方只宣称约 2 倍。拆宣称的第一动作永远是**找场景四元组**。
5. ★★★★ **PD 分离后 prefill 和 decode 的卡选型能不能不同？**——能且
   应该：P 池用算力卡（甚至训练退役卡），D 池用显存带宽卡；SGLang 与
   Dynamo 都支持异构两池，Groq LPX 放 decode 就是两池不同卡的极致形态
   （与推理专用硬件专题交接）。
6. ★★★★ **做 64 卡大 EP，网怎么设计？**——EP 组先收进 NVLink 域
   （NVL72 或超节点），跨机部分沿 rail-optimized 的同一 rail 部署，IB/RoCE
   上调度 DeepEP dispatch/combine；32K 以上输入要防 KV 传输占满 rail，
   P 池 D 池收在同一 blossom 内。
7. ★★★ **Dragonfly 能用在大推理集群吗？**——可以，但大 EP 的
   all-to-all 热点难局部化，GPU 云公开口径主流是胖树 rail-optimized；
   TPU v5p 的 3D torus 是另一族，twisted torus 双分带宽提升约七成
   （Google 文档口径）。
8. ★★★ **MI300X 什么时候赢 H100？**——显存密度场景：192GB 单卡装 70B
   BF16 权重加 KV 正好 fit，带宽 5.3 TB/s 也高 1.6 倍；输算力密度、kernel
   生态与 NVLink 域。选型话术：**按带宽买它，按生态留神**。
9. ★★★ **TPU/Trainium 的推理机会在哪？**——云上自用栈客户：Anthropic
   Rainier 堆 Trainium2、Gemini 跑 TPU；v6e-8 单 VM 8 芯片是 GCP 官方标注
   的推理优化形态；成本侧只能引用官方宣称（再省三至四成，AWS 口径），
   迁移与 kernel 生态是对价。
10. ★★★★ **每百万输出 token 成本怎么从集群数字推？**——时租 × 卡数
    ÷（聚合吞吐 × 利用率 × 3600）。锚：SGLang 96×H100 实测折合每百万输出
    token 约 0.20 美元（lmsys 2025-05，时租折算口径）；用 2026-10 的 3 美元
    时租复算约 0.30 美元，差额全部来自时租假设——**报成本数字必须同时报
    时租与利用率假设**。

## 八、口径与未核实说明

- **官方宣称类**：H200 的 1.9 倍、NVL72 的 30 倍与 50 倍、Rubin NVL8 的 10
  倍、AMD 的 35 倍代际提升、Trainium 的三至四成性价比，全部为厂商官方口径，
  均绑定特定 ISL/OSL/SLO/精度场景；正文引用处已就近标注，横向比较前必须
  先对齐场景四元组与 sparse/dense。
- **SGLang 大 EP 数字**：lmsys.org 2025-05-05 博文为团队一手实测（96×H100、
  IB 互联、PD 分离加 EP72）；**每百万输出 token 约 0.20 美元是按 H100 云
  时租折算的推导值，非账单实测**；正文另给了 2026-10 时租下的复算敏感性。
- **Dynamo 30 倍**：NVIDIA 官方博文口径（2025-03 GTC）——requests 提升是
  **吞吐倍数不是每 token 成本倍数**，正文已显式区分，勿当成本锚引用。
- **媒体口径（未逐一核实原始链接）**：B300 单卡 TDP 约 1400W、GB200 单柜约
  120kW、NVL72 单柜报价约 300-350 万美元、B300 HGX 节点约 50-60 万美元；
  Atlas 950/960 SuperPoD 与昆仑芯天池 256/512 超节点为 2025-09 与 2025-11
  发布会媒体转述口径；TPU v7 Ironwood 的 Pod 数字为 2025-04 发布媒体口径；
  AMD Infinity Fabric 的 896 GB/s 为 ROCm 文档口径（未拉原始链接）。
- **行业文献口径**：rail-optimized 与 dragonfly 的论述依据 Meta RSC、
  Oracle/Azure 公开拓扑等公开资料，本批次未抓取新原始链接；如需引用原文，
  建议补 Meta 的 GenAI Infrastructure 博文（2024-03）与 SemiAnalysis 集群
  拓扑系列。
- **Wikipedia 交叉**：Hopper/AMD Instinct/HiSilicon 三页作为二手交叉验证
  （2026-10-12 抓取），与官网冲突处以官网为准。
- 本篇刻意不重复的内容：Groq/Cerebras/SambaNova 的架构与市场（推理专用硬件
  专题）、昇腾与 CloudMatrix 的规格与路线图（国产卡生态专题）、拓扑感知调度
  的作业层语义（集群调度专题）、三段式成本公式与 API 计价四坑（FinOps 专题）、
  KV 每 token 字节的系数推导（显存计算专题）。

## 串联阅读

- [显存计算专题](./显存计算专题.md)：KV 与权重的字节账，本篇容量账的系数来源。
- [推理专用硬件专题](./推理专用硬件专题.md)：SRAM 阵营的 decode 上限与 TCO 边界。
- [finops与算力成本专题](./finops与算力成本专题.md)：三段式成本公式与时租锚，本篇只在卡型维度代入。
- [集群调度与资源管理专题](./集群调度与资源管理专题.md)：拓扑感知调度的作业层视角，本篇是推理放置视角。
- [国产卡生态专题](./国产卡生态专题.md)：CloudMatrix 384 与昇腾路线，本篇第五节只补 2025-09 后口径。
- [国产推理芯片栈专题](./国产推理芯片栈专题.md)：国产栈的引擎适配现状。
- [inference/推理调度专题](./inference/推理调度专题.md)：PD 分离之前的引擎内调度三代范式。
- [inference/长上下文推理与kv体系](./inference/长上下文推理与kv体系.md)：KV 多级体系，本篇 PD 传输账的上游。
- [distributed-training/通信与网络专题](./distributed-training/通信与网络专题.md)：NVLink/rail/集合通信的训练侧全景。
- [llm基础/moe架构](./llm基础/moe架构.md)：专家并行与大 EP 的模型侧背景。
