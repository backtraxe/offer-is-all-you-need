# 长上下文推理与 KV 多级体系

> 推理部署模块的长上下文专题，2026 面试新热点。主线一句话：**200K–1M context
> 时代，长上下文 serving 有两个真问题——注意力本身算不起（靠稀疏注意力），
> KV 装不下（靠驱逐/压缩 + 多级存储体系）**。稀疏注意力（NSA/MoBA）与线性/
> hybrid 架构的**原理**已在
> [LLM 基础模块-高效注意力谱系](../llm基础/transformer与attention.md#八高效注意力谱系通往长上下文2025-2026-主线)
> 讲透，本文只讲它们在推理引擎里怎么落地；PagedAttention、Prefix Cache、KV
> 量化、PD 分离这些「单 GPU 内怎么省 KV」的手段见
> [vLLM 与推理加速核心](./vllm与推理加速核心.md)与
> [量化与压缩](./量化与压缩.md#八kv-cache-量化长上下文时代的第二战场)，
> 本文交叉引用不重复。

## 一、引言：长上下文的两笔账为什么分开算

上下文窗口从 4K 卷到 200K 再到 1M，serving 侧的压力跟着爆炸，但压力来自两个
**性质完全不同**的方向，先分家才能谈治理：

- **注意力算不起（compute 账）**：prefill 的 attention 是 O(n²)，1M 长度单次
  prefill 的 attention FLOPs 是 128K 的 64 倍；decode 每步要看的 KV read 也随
  长度线性涨。这把刀由**稀疏注意力**来砍——top-k 只算少量 token pair。
- **KV 装不下（capacity 账）**：KV Cache 随长度线性增长。代一组数字（GQA、
  80 层、8 个 KV head、head_dim 128、BF16）：每 token 的 KV ≈
  `2 × 80 × 8 × 128 × 2B ≈ 320 KB`，**一条 1M 上下文的请求就要 ~320 GB KV**——
  四张 80G 的 H100 全拿来放 KV 才勉强装下一条。这把刀由**驱逐/压缩（少存几条）
  和多级体系（挪到别处存）**来砍。

记住这个分家：**稀疏注意力解决"算"，不管"存"；驱逐与多级体系解决"存"，不管
"算**"。真实系统里两套都要上，面试里把两条主线混为一谈是最常见的翻车点。

## 二、稀疏注意力的推理落地

> 架构原理（NSA 三分支、MoBA 块路由、hybrid 配比）一句指针：
> [LLM 基础第八节](../llm基础/transformer与attention.md#八高效注意力谱系通往长上下文2025-2026-主线)。
> 本文只回答一个问题：**模型自带稀疏能力了，引擎怎么跑它**。

### 关键洞察：sparse attention 推理是 capacity-bound，不是 compute-bound

这是整节、也是整个专题最值钱的一句话：

- Top-k 稀疏让 attention 只算少量 KV → **FLOPs 省下来了**（典型稀疏度 1%~5%，
  attention 算力开销砍掉一两个数量级）。
- 但 **top-k 集合随 query 漂移**——任何一个历史 token 下一轮都可能被选中，
  所以**全量 KV 仍要驻留 HBM（或至少可寻址）**，显存一个字节都省不下来。
- 推论："都稀疏了为什么 KV 还是爆"是送分题——**省的是算，不是存**。要省存，
  出门右转第三、四节。

### DSA + FlashMLA：DeepSeek-V3.2-Exp 的落地形态

DSA（DeepSeek Sparse Attention）是 2025 下半年稀疏注意力产品化的标杆，三个
要点够答全程：

1. **token 级稀疏**：不做 NSA 那样的块级选择，而是逐 token 打分逐 token 选
   top-k（典型 k≈2048/层），粒度更细、精度损失更小。
2. **lightning indexer**：一个极轻量的打分器（少量 head 的小网络，FP8 跑）
   专门负责给全部历史 token 打分选 top-k——打分本身也是"看全量"的操作，
   必须足够便宜才不违背稀疏的初衷，indexer 的开销被压到主 attention 的
   百分之几。
3. **FlashMLA 稀疏 kernel**：MLA 的解耦 KV 表示 + DSA 的 token 级 top-k +
   FP8 KV，由 FlashMLA 的稀疏版本 kernel 一次性落地；这是"算法—kernel 协同
   设计"的标准答案，V3.2-Exp 以此宣称长 context 推理成本大幅下降。

### SGLang HiSparse：GPU 只留 hot buffer，KV 分层驻留

DSA 省算之后，HiSparse 接着治"存"——它是稀疏注意力 × KV 分层的第一套完整
工程方案（2026 公开）：

- **非活跃 KV 卸载 host**：GPU HBM 里只保留一个 **hot buffer**（活跃请求的
  近期/高命中 KV），其余 KV 页全部卸到 host DRAM。
- **top-k miss 检测**：decode 时 lightning indexer 选出 top-k 后，引擎检查这些
  token 的 KV 是否都在 HBM；缺页即 miss，按 **page table** 定位后从 host
  **换入（swap-in）**，同时用 **LRU 驱逐**冷页回 host 腾位——管法和 OS 缺页
  中断严丝合缝，这个类比面试可以直接用。
- **公开口径**：256 并发的长 context 负载下，相比全驻留/重算基线吞吐提升
  **3–5×**；关键收益不是单请求更快，而是 GPU 显存省出来以后 batch 能开大
  数倍。

**和驱逐类方法的分界**（先把话语权抢过来）：HiSparse 是"**不删、只挪**"——
信息零丢失，代价是换入带宽与调度复杂度；第三节的 H2O/SnapKV 们是"**真删**"——
零带宽代价，代价是信息永久丢失。2026 工程共识是**先挪后删**：多级体系为
主，驱逐只作兜底。

## 三、KV 驱逐与压缩谱系：八股基础段

共同思想一句话：**注意力分布极度不均，绝大多数 token 的 KV 长期不被看**——
所以"扔掉/不生成"经常被实验证明没人发现。四家是必背项：

| 方法 | 机制一句话 | 精度代价 | 适用边界 |
|---|---|---|---|
| **StreamingLLM**（2023） | 发现 attention sink：保留**最初几个 token**（如 4 个 sink）+ 最近 w 滑窗，中间全扔 | 中间内容真丢——长程检索必死 | 流式生成、不回头任务；无限长流的下限方案 |
| **H2O**（2023） | 按**累积 attention 分**驱逐：统计每个历史 token 获得的注意力权重，保 Heavy Hitter + 滑窗 | 统计有偏：未来 query 可能爱上过去被冷落的 token；驱逐不可逆 | 通用 decode 期动态预算；检索任务慎用 |
| **SnapKV**（2024） | prefill **末段开一个观测窗**，用窗内 query 给全前缀打一次分，选出重要的 KV 头，压缩后固定 | 观测窗代表性假设；decode 中无法再修正 | 长 prompt（RAG/长文档）的 prefill 压缩，免维护统计 |
| **PyramidKV**（2024） | 观察到注意力**底层分散、高层集中** → 逐层分配不同 KV 预算，底层多留、高层少留，呈金字塔 | 保留机制本身仍是有损压缩 | 可与 SnapKV 等打分方式叠加，属于"预算分配"层 |

三句收尾记忆点：

1. **驱逐 ≠ 稀疏注意力**：驱逐是"真删、永久丢失"；top-k 稀疏是"这轮不算、
   下轮还在"，信息无损。两套可以叠——先稀疏少算，再驱逐少存。
2. **驱逐与量化正交**：驱逐省**条数**，KV 量化省**每条字节**（FP8/INT4 KV 见
   [量化与压缩第八节](./量化与压缩.md#八kv-cache-量化长上下文时代的第二战场)），
   乘起来才是完整的显存压缩率。
3. **驱逐是兜底不是首选**：能力允许就先走第四节的多级 offload（无损），
   驱逐只在水位实在压不住/任务允许有损时启用——这个排序本身就是一道
   系统设计题的标准开头。

## 四、KV 多级存储体系：2026 工程主线

思路转换：与其删，不如**挪**——把 KV 当成多级 cache 管理，和 CPU 的
L1/L2/内存/磁盘一个哲学：**容量换延迟，层级之间靠命中率摊平**。

### vLLM Tiered KV Offloading：从 PagedAttention 到多级页表

vLLM 2026 的 tiered KV offloading 把 Prefix Cache 的命中域从 HBM 一路拉长：

```
GPU HBM → host memory → filesystem/SSD → object store → 远端 peer（别的实例）
```

- 每一层都是一个 **connector**，后端插件化（LMCache 等），引擎侧只管"这层
  有没有、要不要搬"；命中逻辑沿用了 PagedAttention 的 block/页表抽象——
  **多级体系是 PagedAttention 的块管理思想在存储层级上的自然延拓**，这句话
  能把第三节 PagedAttention 和本节串成一条线。
- 动机很现实：多轮 Agent、长文档 RAG 里**同一长前缀被反复命中**，让几百 GB
  的 KV 一直躺在 HBM 里是纯浪费；下沉之后 HBM 还给在线 batch。
- 命中率 = 新运营指标：L1（HBM）/ L2（DRAM）/ L3（SSD）各自的命中率决定
  TTFT 分布，运维看板跟 cache 系统一模一样。

<div class="diagram-embed">
<iframe src="assets/diagrams/kv-tiering.html" width="100%" height="950" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/kv-tiering.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### miss 时的取舍：换入（swap-in） vs 重算（recompute）

命中了下级存储只是开始，把数据弄回来有两条路，按三因子决策：

| 因子 | 换入占优 | 重算占优 |
|---|---|---|
| **距离/带宽**（副本在哪层） | host DRAM（PCIe，微秒级/页） | SSD/远端 peer（毫秒级、走网络）时换入变贵，重算相对变便宜 |
| **前缀长度**（重算成本） | 前缀短，重算反正也不贵——但通常还是直接换入省心 | 前缀**很长**但算力闲置时，重算的边际成本低于长距离搬运 |
| **在线负载**（资源挤占） | 带宽闲、GPU 忙：换入只花 PCIe 带宽，不抢算力 | 算力闲、带宽堵：重算用 GPU 空闲周期，不抢数据传输通道 |

两个工程细节说出来加分：换入**分 chunk 异步流水**、与 decode 步骤 overlap
（藏在 TPOT 间隙里）；决策可以 per-request 预估两边 cost 再选——HiSparse 的
"只挪不算"和 DistServe 一派的"宁算不等"都是这个 trade-off 的具体落点。

### hybrid 模型的特殊性：非对称 offload

混合架构（线性层 + 全注意力层，代表 Qwen3-Next 75%/25% 配比）的 KV 治理
和纯 attention 模型不对称，记住两条：

1. **线性层的 cache 是定长状态**（conv state + recurrent state，大小与上下文
   长度无关）——不产生随长度爆炸的 KV，**不用卸也不用驱逐**。
2. **只有全注意力层的 KV 要进多级体系**：offload 只挂钩这几层的 block——
   25% 的层数配比意味着 KV 预算、驱逐量、换入流量直接缩到同尺寸纯
   attention 模型的约 1/4。hybrid 对 Infra 的最大红利就在这里，原理侧见
   [LLM 基础第八节](../llm基础/transformer与attention.md#八高效注意力谱系通往长上下文2025-2026-主线)。

### 与 PD 分离 / SLO 的关系（交叉引用，不展开）

- **PD 分离**：prefill 节点算出的 KV 可以直接写进多级体系，供 decode 节点
  和后续请求共享——KV 跨节点传输与多级 offload 是**同一套 connector 基础
  设施**，Mooncake 一派就是把两者做成一个东西。PD 分离本身见
  [vLLM 与推理加速核心第七节](./vllm与推理加速核心.md#七pd-分离prefill-和-decode-为什么要拆成两套集群)。
- **SLO 侧**：换入延迟直接进 TTFT 的尾延迟预算；各级命中率、换入带宽占用
  是容量规划的新输入变量，对接
  [推理服务 SLO 与运营](./推理服务slo与运营.md)的口径。

## 五、▶ 面试追问 5 条

| 追问 | 答题要点 |
|---|---|
| **128K 上下文到底贵在哪？** | 三笔账：① **计算账**——prefill attention O(n²)，128K 是 16K 的 64 倍；② **显存账**——KV 随长度线性涨，GQA 大模型下 128K 单请求就要几十 GB，直接卡死 batch；③ **延迟账**——decode 每步全量 KV read，TPOT 随长度线性劣化，128K 时 KV read 超过权重 read 成为大头。对应三把刀：稀疏注意力/驱逐治算，量化+多级治存，prefix cache+调度治延迟。 |
| **稀疏注意力都 top-k 了，为什么 KV 还装不下？** | 因为它是 capacity-bound：top-k 只省 FLOPs；top-k 集合随 query 漂移，任何历史 token 下轮都可能被选中，全量 KV 必须可寻址；打分索引本身（lightning indexer 的低精度表示）也要占一份。省算不省存，所以才有多级体系这条独立主线。 |
| **H2O / SnapKV 驱逐会不会丢关键信息？** | 会，而且不可逆。缓解手段：保留 attention sink + 滑窗兜底近程信息；观测窗打分（SnapKV）提高选留质量；PyramidKV 逐层预算分配保护底层分散注意力。但长程精确检索（needle 类）任务**禁止驱逐**，该走无损的多级 offload；工程排序是"先挪后删"，驱逐只做水位兜底。 |
| **offload 换入和重算怎么选？** | 三因子：副本所在层级的距离/带宽 × 前缀长度（重算成本）× 当前算力/带宽负载。经验口径：host 命中必换入（PCIe 微秒级，不抢算力）；SSD/远端命中时，算力闲选重算、带宽闲选换入；换入分 chunk 异步流水、藏在 decode 间隙；决策可 per-request 预估双边 cost。 |
| **hybrid 模型的 KV 有什么特殊？** | 只有全注意力层产生随长度增长的 KV；线性层是定长状态（conv+recurrent），与上下文长度无关，不用卸不用驱逐。KV 预算、offload、驱逐、稀疏全部只作用于全注意力层；25% 层数配比 → KV 相关的存储与搬运开销约为同尺寸纯 attention 模型的 1/4。 |

## 六、延伸阅读

- [SGLang HiSparse 博客](https://lmsys.org/blog/2026-04-10-sglang-hisparse/)——
  稀疏注意力 × KV 分层的第一套完整工程方案，hot buffer / page table / miss
  换入的全部细节
- vLLM 博客与官方文档的 Tiered KV Offloading / KV Connector 专题
  （blog.vllm.ai + docs.vllm.ai）——多级 connector 的插件化设计
- [deepseek-ai/FlashMLA](https://github.com/deepseek-ai/FlashMLA) 与
  DeepSeek-V3.2-Exp 技术报告——DSA + lightning indexer 的官方口径
- 驱逐四件套论文：StreamingLLM（arXiv:2309.17453）、H2O（arXiv:2306.14048）、
  SnapKV（arXiv:2404.14469）、PyramidKV（arXiv:2406.02069）

---

*相关阅读：[vLLM 与推理加速核心](./vllm与推理加速核心.md) ·
[量化与压缩](./量化与压缩.md) ·
[推理服务 SLO 与运营](./推理服务slo与运营.md) ·
[模块导航](./README.md)*
