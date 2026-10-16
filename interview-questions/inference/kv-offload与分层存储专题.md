# KV Offload 与分层存储专题：HBM→DRAM→NVMe→远端池的金字塔、四大系统与九条坑位

> **面向**：已读过 [长上下文推理与kv体系](./长上下文推理与kv体系.md)（引擎
> 内的 KV 总量账、tiered offloading 总览、驱逐 vs 换入决策树）与
> [agentic-serving专题](./agentic-serving专题.md)（agent 流量特征与路由亲
> 和）的读者，正在准备「推理系统 / AI Infra」方向里关于 KV 存储层的追问。
>
> **读完获得**：① 「KV cache 从显存副产物变成存储层基础设施」的一句话主线；
> ② L0-L3 四层金字塔的容量/带宽/延迟量级表（全部挂来源年份）；③ 一次带
> 分层缓存请求的完整数据流（块哈希 → 查层 → 流水换入 → 增量 prefill → 回
> 写降级 → LRU 外推）；④ 四大系统分工——LMCache 管理层、Mooncake 分布式
> 池、NIXL 传输库、vLLM KVConnector 接口族——与 2025-2026 数字锚；⑤ 九
> 条实战坑位（每条带出处）；⑥ 收益拐点约 250-300k token 的判断逻辑与
> 「合成 benchmark 冤判 L2」的反面教材；⑦ 八条高频面试题的深浅两档答法。
>
> **时效口径**：硬件规格取自 NVIDIA 官方产品规格页（2026-10-12 核实）；
> GitHub star/release 用 gh api 于 2026-10-12 实测；系统实测数字全部来自
> 各官方博客原文（LMCache 2026-04/2026-05、vLLM 官方 2026-05、SGLang
> 2025-09）并按原文口径括注；论文数字按 arXiv 摘要口径；未核实项只进文
> 末「口径与未核实说明」，正文不当事实引用。

## 一、定位：引擎内视角 vs 存储层系统视角

一句话衔接边界：[长上下文推理与kv体系](./长上下文推理与kv体系.md) 是**引
擎内视角**——KV 总量怎么算、vLLM tiered offloading 总览、稀疏注意力×分
层、驱逐 vs 换入决策树；本篇是**存储层系统视角**——分层本身的量纲、四个
核心系统（LMCache / Mooncake / NIXL / vLLM connector 族）的架构与实测数
字、接口契约与坑位。与 PD 分离的关系只说一句：PD 分离是计算拓扑决策，KV
分层是状态放置决策，两者共用同一套 connector/transfer 基础设施（Mooncake
Transfer Engine 同时服务两者），本篇只讲存储一侧。

主线直觉一句话：KV cache 已经从「显存里的临时计算副产物」演化成**一个
独立的存储层基础设施**——它有分层（HBM→DRAM→SSD→远端池）、有统一接口
（vLLM KVConnector）、有专用系统（LMCache、Mooncake）、有专用传输库
（NIXL）。2025-2026 年这条线是推理系统里最快收敛成标准栈的方向，面试里以
「长上下文 / agent 场景怎么扛」为引子，追问落到存储层就会落到本篇内容。

<div class="diagram-embed">
<iframe src="assets/diagrams/kv-offload-tiered-storage.html" width="100%" height="940" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/kv-offload-tiered-storage.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、分层金字塔：每 GB 成本下降，带宽延迟恶化两个数量级

KV 分层的前提是硬件量级的客观落差。下表四个层级的量纲（全部是
**2026-10 核实口径或已标推导口径**）：

| 层级 | 代表规格 | 容量 | 带宽 | 延迟 | 口径 |
|---|---|---|---|---|---|
| L0 GPU HBM | H200 = 141 GB HBM3e | 百 GB | 4.8 TB/s | 微秒以内 | NVIDIA 官方规格页，2026-10 核实 |
| L0 GPU HBM | H100 SXM = 80 GB | 百 GB | 3.35 TB/s | 微秒以内 | 同上核实 |
| L1 CPU DRAM | 8-12 通道 DDR5 服务器 | TB 级 | 整机 0.6-0.9 TB/s | ≈100 μs | 带宽为 DDR5-4800 单通道 38.4 GB/s 标称推导（未跑基准）；延迟为 LMCache 博客口径 |
| L1↔L0 搬运通道 | PCIe Gen5 x16 | — | 单向约 63 GB/s、双向 128 GB/s | — | NVIDIA 官方规格页，2026-10 核实 |
| L2 本地 NVMe | Gen5 企业盘（如三星 PM1743） | 十 TB 级 | 顺序读约 14 GB/s | 毫秒级 | 厂商标称口径，未实测核验 |
| L3 远端池 | RDMA 200/400 Gbps 单口 | 数百 TB 到无上限 | 25 / 50 GB/s | 毫秒到数十毫秒 | 网卡标称；LMCache 博客层级表口径 |

三个必须背下来的结论：

1. **跨层级带宽落差约两个数量级**：HBM 4.8 TB/s → 整机 DRAM 0.6-0.9
   TB/s → PCIe 63 GB/s → NVMe 14 GB/s。所以调度原则的反直觉版是——**判
   断「值不值搬」永远优先于「搬多快」**：带宽解不了错判，只能缓解。
2. **L1 的带宽瓶颈不在 DRAM 本身而在 PCIe**：整机 DRAM 理论 0.6-0.9
   TB/s，但 GPU↔DRAM 的搬运走 PCIe Gen5 单向约 63 GB/s。所以分层缓存的
   有效带宽上限是 PCIe，不是内存带宽——这是「为什么 LMCache/GDS 都要绕
   开页缓存、都要谈 GPUDirect」的根因。
3. **L3 的带宽反超 L1↔L0 通道的假象**：RDMA 单口 25/50 GB/s 与 PCIe
   63 GB/s 同量级，于是「跨机搬 KV」并不比「本机搬 KV」慢几个数量级
   ——这给跨实例共享池留出了物理可行性，Mooncake 的故事从这里开始。

经济学根因（方向可确认、倍数见文末未核实说明）：**扩容 DRAM 一个数量级
容量的边际成本，远低于再给 HBM 腾空间**。HBM 是整机 BOM 里最贵的部件之
一，把 KV 挪出 GPU 是这笔账的自然结果。但它只对「复用价值高的前缀」成
立——decode 尾段的 KV 搬运亏了带宽换不来复用，这是后文坑位 Q3 的立足
点。

## 三、数据流：一次带分层缓存请求的完整生命周期

被问「分层缓存怎么工作」时按这六步讲，比背系统名词管用：

1. **块哈希查层**：调度器拿 prompt 按 block 切分做哈希（vLLM 默认 16
   token/页，LMCache chunk 是 256 token），查 L0 命中表；
2. **miss 下沉**：L0 miss 则查 connector（LMCache / Mooncake master）维护
   的块元数据，问 DRAM/SSD/远端池里有没有；
3. **异步流水换入**：命中下层就**异步预取**，关键技巧是 layer-wise
   overlap——第 N 层 attention 执行时并发加载第 N+1 层的 KV（SGLang
   HiCache 的做法），把传输时间藏进计算时间；
4. **增量 prefill**：补齐的前缀不重算，只对后缀增量做 prefill——TTFT 省
   的就是这一段；
5. **回写降级**：prefill 产生的新 KV 先写 HBM，再按写策略降级——
   write-through（全写）、write-through-selective（按热度挑块写）、
   write-back（回写缓存延后落盘）三档；
6. **驱逐外推**：LRU 逐层外推——HBM 挤热点到 DRAM，DRAM 挤冷块到
   SSD/远端池，跨层不是一份拷贝搬家，而是热度梯度下的级联。

这套生命周期的工程含义：**换入是 async 的、回写是 policy 的、驱逐是
LRU 的**——任何一环变成同步阻塞（比如 decode 每步同步 offload），整条
流水线立刻被拖垮，这正是坑位清单里 100-250s 停顿的来处。

## 四、四大系统：管理层、分布式池、传输库、接口族

### 4.1 LMCache：KV 缓存「管理层」

- **出身与定位**：U Chicago / Junchen Jiang 组（Tensormesh 支持），2025-10
  加入 PyTorch Foundation。定位是引擎之外的 KV 缓存管理层。
- **进程独立 daemon**：引擎崩了缓存不死，重启后还能命中；后端可挂 CPU /
  SSD / Redis / Valkey / Mooncake / InfiniStore / S3 / NIXL / GDS。
- **MP（multi-process）架构（2026-04）**：节点级所有 DP rank / 独立实例共
  享一个 CPU 池——这是对冲 vLLM 原生 in-process offload 碎片化（每 rank
  私有 50 GB 池、不共享、跨 rank 重复 prefill）的答案。
- **增值件**：CacheBlend 非前缀复用、observability 指标（请求级 / token 级
  命中率）。

### 4.1·增 CacheBlend：突破前缀匹配天花板的「缝合术」（EuroSys 2025 最佳论文）

LMCache 团队的 CacheBlend 是「非前缀复用」这条线的代表作，补上它，
本篇的复用谱系才完整：

```text
精确前缀复用（vLLM/SGLang 原生 APC）：要求从头逐字节匹配
      ——RAG 拼多篇文档、同一文档出现在不同位置/顺序时，前缀断裂、
        命中率直接归零
CacheBlend 非前缀复用：chunk 级匹配【任意位置】的重复文本块，
      拼装已缓存 KV + 只在【拼接边界】做选择性重算（selective
      recompute）——处理跨块 attention 断裂，其余照缝
```

可行性直觉：非相邻块之间的 cross-attention 影响集中在拼接边界附近的
窗口内——**边界少量重算就能恢复接近全精度的质量**，这是「缝合」
的物理依据，也是它区别于「直接乱拼」（质量崩）的分界线。

数字锚（官方口径，注意转述校准）：

- 多轮 QA 查询吞吐最高 **14x**；文档密集 RAG 管线吞吐最高
  **+4.5x**；
- TTFT 降低 **1.9x~8.1x**（低 QPS 基线下可到 7–10x）；
- 成本省最高 90%（分层 offload：GPU / CPU DRAM / 本地盘 /
  Redis / S3 共享复用）；
- **口径校准一条**：社区转述常把 14x 说成「首 Token 快 14 倍」
  ——官方口径 14x 是多轮 QA 的**查询吞吐**，TTFT 的倍数另有
  上述区间。引用时把量和口径对齐，是这条线最容易踩的转述坑。

Fine print（社区实测评论口径）：收益集中在**前缀重叠重的负载**
（长共享块、多文档重复拼装）；全新无重叠输入没有免费午餐。
论文评审把最佳论文给它，等于给「复用边界从『前缀』推进到
『任意重复块』」这条系统主线盖了官方章——与 agentic serving 篇
§一的「block 级复用将成为 agentic 负载刚需」互为印证。

### 4.2 Mooncake：分布式 KV 池 + Transfer Engine

- **出身与论文**：月之暗面 / Kimi 生产系统，FAST'25 **最佳论文奖**（2025-02，
  README 核实），开源 2024-11（TE 先行）。
- **Transfer Engine（TE）**：统一抽象 TCP / RDMA / EFA / NVMe-oF / NVLink /
  CXL 等传输，多网卡聚合、拓扑感知选路、自动故障切换；实测 8×400Gbps
  RoCE 下达 190 GB/s（40 GB KV 块传输，README 核实）。
- **Mooncake Store**：利用 GPU 集群闲置的 CPU / DRAM / SSD 建分布式 KV 池；
  master 管块元数据与服务发现，client 间 GPUDirect RDMA 直通——**传输不占
  SM**，不和计算抢 GPU。
- **外溢复用（2026 新趋势）**：TE 已从推理扩散到训练侧——SGLang 用它做 RL
  权重更新 P2P 传输（Kimi-K2 1T 参数跨数千 GPU，实测**权重广播从 53s 压
  到 7.2s 约 7 倍加速**
  （2026-04 lmsys 博客，README 核实））；checkpoint-engine 在 K1.5/K2 生产
  训练中约 20s 完成 1T 参数全集群权重更新（README 核实）。一句话：KV/权
  重传输库正在变成训推一体的公共底座。

### 4.3 NIXL：点对点 KV transfer 库

- **出身**：NVIDIA，2025-03 开源，是 Dynamo 的传输底座。
- **插件式后端**：UCX / GDS / POSIX / Mooncake TE 等——注意它和 Mooncake
  是互为插件的关系（NIXL 可把 Mooncake TE 当后端，LMCache 也可走 NIXL），
  面试里别把两家说成竞争关系。

### 4.4 vLLM KVConnector 接口族（最容易踩口径差异的一节）

vLLM 侧是**一个原生实现 + 一族 connector + 一个组合器**：

- **内置 OffloadingConnector**：in-process CPU offload，用
  -kv-offloading-size N 参数开 GB 级 CPU 池（flag 名在两个官方页面一致出
  现，见文末未核实说明）；
- **KVConnectorV1 接口族**：LMCacheConnectorV1 / LMCacheMPConnector /
  MooncakeConnector（PD 传输）/ MooncakeStoreConnector（分布式池）/
  NixlConnector；
- **MultiConnector**：链式组合，如把 PD connector 与 store connector 串成
  两条独立链路；
- **统一配置入口**：kv-transfer-config 传 JSON，配 kv_connector 与
  kv_role（kv_both / kv_producer / kv_consumer）。

**口径勘误（正文必须带的 v1 口径漂移）**：「MooncakeConnector」这个名字在
老架构 xPyD 里指的是**纯 PD 传输**，而跨实例共享池复用要的是
**MooncakeStoreConnector**——两者语义不同、不可互换。2026-05 vLLM 官方
博客已明确把「PD connector」与「store connector」列为 MultiConnector 下
的两条独立链路。面试和搭环境时说错名字，行为直接错而不是报错，这是版本
口径差异最坑的一类。

## 五、2025-2026 关键进展与数字锚

这一节把正文要背的「数字锚」集中放好，每条括注来源年份，面试引用时带上
口径才像干过活的人。

- **Mooncake（kvcache-ai/Mooncake）**：开源 2024-11（TE 先行）；
  **⭐6,764，最新 release v0.3.13.post1、2026-08-31 发布**（gh api 核实，
  2026-10-12）。FAST'25 **最佳论文奖**（2025-02，README 核实）。论文指标
  分两个口径：模拟场景吞吐最高提升 525%，**线上真实负载下 Kimi 多承载
  75% 的请求量**（arXiv:2407.00079 摘要核实）——注意前者是模拟、后者
  才是线上，引用别混。TE 实测 8×400Gbps RoCE 网络下达 190 GB/s（40 GB
  KV 块传输，README 核实）。2026-02 加入 PyTorch Ecosystem。
- **LMCache（LMCache/LMCache）**：**⭐12,001，release v0.5.5、2026-09-12
  发布**（gh api 核实，2026-10-12）。论文与 vLLM 组合宣称吞吐最高 15 倍
  （arXiv:2510.09665，2025-10，论文宣称口径）。**节点级 MP 架构博客实测 Qwen3-235B
  FP8 在 8×H100 上，多轮会话场景 TTFT 均值从 3.98s 降到 0.29s 约 13 倍、
  p99 从 13.55s 降到 1.30s、decode 吞吐从 9.8 升到 37.5 tok/s 约 4 倍**
  （LMCache 官方博客，2026-04；对比基底是 vLLM 原生 in-process offload）。
  2025-10 加入 PyTorch Foundation。
- **vLLM × Mooncake Store 联合方案**：Kimi-2.5 NVFP4 模型在 GB200 上以
  1P1D 共 12 卡跑真实 Codex agentic trace（SWE-bench Pro 610 条任务、中位
  33 轮）。实测**命中率提升最猛的一组——KV 池命中率从 1.7% 升到 92.2%、吞吐放大 3.8 倍、P50 TTFT 降
  46 倍、端到端延迟降 8.6 倍**（vLLM 官方博客，2026-05-07）。round-robin
  路由无亲和的情况下扩展到 60 张 GB200 仍保持大于 95% 命中、近似线性
  扩——这组数字就是「为什么分布式池能干掉会话亲和依赖」的实证。
- **SGLang HiCache**：HiRadixTree 页表统管 GPU/CPU/外部三层；自研 GPU 辅
  助 IO kernel 使 CPU↔GPU 传输吞吐最高 3 倍（SGLang 官方博客，
  2025-09-10）。storage 后端只需实现 get/exist/set 三函数即可插拔，已接
  入 Mooncake/3FS/NIXL。社区实测两组：Novita AI 编码场景会话均值 TTFT 降
  56%、吞吐翻倍、**命中率从 40% 提升到 80%（博客里用箭头口径，引用照
  抄）**；蚂蚁
  集团 DeepSeek-R1 PD 分离部署缓存命中比全量重算 TTFT 降 84%（均为 SGLang
  官方博客引用口径，2025-09）。官方 benchmark 另宣称最高 6 倍吞吐、80%
  TTFT 降幅（博客宣称，非第三方实测）。
- **NIXL（ai-dynamo/nixl）**：**⭐1,296，release v1.5.0、2026-09-30 发布**
  （gh api 核实，2026-10-12）；2025-03 开源，PyPI 安装自动选 CUDA12/13 后
  端，配套 NIXLBench/KVBench 基准工具。
- **Mooncake TE 外溢到训练侧**：SGLang 用 TE 做 RL 权重更新 P2P 传输，
  Kimi-K2 1T 参数跨数千 GPU，**权重广播时间从 53s 压到 7.2s 约 7 倍加速**
  （lmsys 官方博客，2026-04；README 时间线核实）。checkpoint-engine
  （Moonshot 官方） 在 K1.5/K2 生产训练中约 20s 完成 1T 参数全集群权重
  更新（README 核实）。结论一句话：**训推终于共用一套传输底座——KV/权重传
  输库正在成为公共底座**——和 [verl深度拆解](../训练与对齐/verl深度拆解.md) 的 checkpoint
  engine 线对读。

## 六、部署形态速查

被问「你们环境怎么挂的」，按四张牌回答：

1. **单机单实例** = LMCache daemon（lmcache server --l1-size-gb 400 起
   L1 池） + vLLM 侧挂 LMCacheConnectorV1；
2. **单机多实例 / 多 DP rank** = MP 模式，LMCacheMPConnector 让所有 rank 共
   享同一个 CPU 池，否则每 rank 私有 50 GB 池互相看不见、跨 rank 重复
   prefill；
3. **集群共享池** = Mooncake master（块元数据 + 服务发现 + 健康检查） + 每
   节点 client（管本地 DRAM/SSD，RDMA fabric 互联，GPUDirect 直通）；
4. **PD 分离 / PD+池** = PD 传输用 MooncakeConnector 或 NixlConnector，若要
   同时跨实例复用池，用 MultiConnector 把 PD connector 与
   MooncakeStoreConnector 链成两条独立链路。

## 七、实战坑位九条（每条带出处）

1. **PYTHONHASHSEED=0 必须设**。不设的话 TP worker 0/1 对同一个 prompt 哈
   希出不同 cache key，位级相同的 prompt 也 0% 命中；症状是日志反复出现
   hit tokens: 0（LMCache MI300X 实测博客，2026-05）。这类 bug 最阴险的
   在于不报任何错，只是静默不命中。
2. **即使走 LMCache 也必须开 --enable-prefix-caching**。LMCache 依赖 vLLM
   前缀缓存的哈希函数来定位块，关掉后会报 Could not load 'builtin' from
   vLLM 且行为不一致（同上博客，2026-05）。
3. **不要开 LMCACHE_SAVE_DECODE_CACHE=true**。解码每步同步 offload 会把
   GPU 流水线串行化，实测普通请求被拖出 100-250s 停顿；decode 侧 KV 复用
   本就罕见，纯开销（同上博客，2026-05）。对应面试题 Q4 的完整答案。
4. **合成 benchmark 会冤枉 L2**。固定命中率的 cache_rate 测试不制造 HBM
   压力，LMCache 显示吞吐反而降 10-17%；同一台机器换真实 agentic trace
   就变成提升约 200%。结论：**评估分层缓存必须「真实工作负载 + 显存压
   力」双条件同存**，缺一都判不出收益（同上博客，2026-05）。
5. **TP=2 + LMCacheConnectorV1 在 vLLM 0.19.x 下偶发 shm_broadcast 死
   锁**——6 分钟无进展，原作者建议 TP 大于 4 慎用并上报上游（同上博客，
   2026-05 口径，vLLM 0.19.x / LMCache 0.4.3-dev 版本对；2026-10 现行版
   本可能已修，引用时带版本号）。这就是「口径漂移」类坑：坑本身是真的、
   适用范围随版本过期，照抄年份和版本号是自保护。
6. **AMD 侧 LMCache 没有官方 ROCm wheel**。MI300X 必须 BUILD_WITH_HIP=1
   源码编译，且要卸载编译时拉进来的 nixl-cu12、cupy-cuda12x 等传递依赖，
   否则 vLLM quark 配置 import nixl_ep 直接 ImportError（同上博客，2026-05）。
7. **字节级一致的序列化是命中率前提**。JSON key 重排、空白字符、时间戳
   差异都会静默毁掉前缀命中——agent 场景必须固定消息序列化格式（同上博
   客 best practices）。这也解释了为什么有的团队上了缓存系统却测不出命
   中：不是没命中逻辑，是 prompt 从来没字节级重复过。
8. **in-process offload 的碎片化是架构级缺陷而非配置问题**。vLLM 原生
   OffloadingConnector 每个 DP rank 各起 50 GB 私有 CPU 池、不共享，跨
   rank 相同上下文重复 prefill。这不是「把池调大点」能解的，LMCache MP
   模式的 400 GB 节点级共享池才是答案（LMCache MP 博客，2026-04）。
9. **Mooncake 两个 connector 名不可互替**。老架构 xPyD 需要
   MooncakeConnector（纯 PD 传输），分布式池复用要用
   MooncakeStoreConnector，两者语义不同；2026-05 vLLM 官方博客已明确把
   「PD connector」与「store connector」列为 MultiConnector 下的两条独立
   链路——配置时拿错名字，拿到的是一个「能跑但行为错」的系统。

## 八、收益拐点：约 250-300k token 工作集，以及判断逻辑

LMCache 官方 MI300X agentic 实测（2026-05，MiniMax-M2.5 FP8、2×MI300X、
739 条 Claude Code 匿名 trace 回放）给了拐点的两条边：

- **重压场景（32 并发 / 100k 上下文）**，LMCache DRAM 分层 vs HBM-only：
  **实测四项齐好——TTFT 均值降 3.0 倍、p95 降 2.1 倍、可承载并发 2.3
  倍、有效工作集扩大 36%（LMCache 官方博客 2026-05 口径）**；
- **低负载 / 工作集装得进 HBM 时 HBM-only 反而赢**——搬 KV 本身就是开销。

由此得到面试可背的拐点口径：**收益拐点是「工作集 vs HBM 有效容量」，实
测约 250-300k token 起步**（同上实测口径，2026-05）。判断逻辑永远是——
先问有没有 HBM 压力（装不下才存在搬的价值），再问复用率（重复访问才值
得搬），两个都成立才谈带宽怎么省。

这里最容易掉坑的类比是「SSD 比 HBM 慢所以没用」：错在把访问延迟和收益
混为一谈。L2 的收益不来自「比 HBM 快」，来自「比重算便宜」——重算
1k token 前缀的真实成本是一个 prefill 步的算力 + 排队，而从 DRAM 换回
1k token 只要几十个微秒级传输。**换入 vs 重算的决策因子 = 副本层级距离/带
宽 × 前缀长度 × 当前算力与带宽负载**（与 [长上下文推理与kv体系](./长上下文推理与kv体系.md) 的决策树对读）。

## 九、▶ 高频面试题（8 条，标注频率与深度提示）

**Q1｜KV cache 为什么要分层？HBM/DRAM/SSD 的量级差异各是什么？**
（频率：极高频，长上下文/agent 引子的标准落点）答出四层金字塔 + 三行数
字：H200 = 141 GB / 4.8 TB/s（NVIDIA 官方规格页，2026-10）；整机 DRAM
0.6-0.9 TB/s 理论但搬运走 PCIe Gen5 单向约 63 GB/s（NVIDIA 官方，
2026-10）；Gen5 SSD 顺序读约 14 GB/s（厂商标称）。收尾一句话：**跨层级带
宽落差约两个数量级，所以调度判断优先于搬运优化**。深度提示：深档要能讲
「L1 瓶颈在 PCIe 不在 DRAM 带宽」这一层。

**Q2｜vLLM 的 KV connector 是什么接口？能说出哪几种实现？**（频率：高频，
vLLM 场景必问）先说统一入口 kv-transfer-config JSON + kv_role 三值
（kv_both / kv_producer / kv_consumer），再列六种：OffloadingConnector
（in-process 单机 offload）、LMCacheConnectorV1 与 LMCacheMPConnector（单机
daemon / 节点级共享池）、MooncakeConnector（PD 传输）、
MooncakeStoreConnector（分布式池）、NixlConnector（Dynamo 传输底座）、
MultiConnector（链式组合）。深度提示：答出「MooncakeConnector 与
MooncakeStoreConnector 在 2026-05 官方口径里被明确拆成两条链路」直接到
深档——这是 v1/v2 口径漂移在接口命名上的体现。

**Q3｜什么时候 CPU offload 不划算？**（频率：高频，考判断力不是背诵）给拐
点双条件：HBM 压力 + 复用率，缺一则 L2 纯开销。数字锚：无 HBM 压力的合
成 benchmark 下 LMCache 吞吐反而降 10-17%、真实 agentic trace 同机变升
约 200%（LMCache 官方博客，2026-05）；拐点实测约 250-300k token 工作集
起步（同上）。深度提示：能把「换入 vs 重算」决策因子（层级距离/带宽 × 前
缀长度 × 负载）说出来，比背 250-300k 值更硬。

**Q4｜decode 阶段产生的 KV 要不要 offload？**（频率：中高，坑位向）不要。
理由三层：decode 每步同步 offload 会串行化流水线、LMCache 实测拖出
100-250s 停顿（2026-05）；decode 侧 KV 被复用的窗口本来就窄，搬运换不
回复用；写策略上 prefill 新 KV 才走 write-through/选择性写降级。一句话：
**decode 不 offload 不是保守，是实测过开销对不上收益**。

**Q5｜Mooncake 的 Transfer Engine 解决了什么？**（频率：高频，国产 infra
必问）三件套：多网卡聚合（8×400Gbps RoCE 实测 190 GB/s，README）+ 拓
扑感知选路（UCX 之上把 TCP/RDMA/EFA/NVMe-oF/NVLink/CXL 统一抽象）+ 故障
自动切换；client 间 GPUDirect RDMA 直通不占 SM——传输线程不吃 GPU 计算
单元。深度提示：能讲 master/client 分工（元数据 vs 本地池管理）和 TE 外
溢到训练侧权重同步（Kimi-K2 1T 参数 53s→7.2s，lmsys 2026-04）是加分。

**Q6｜KV 分层和 PD 分离是同一个东西吗？**（频率：中高，概念辨析题）不是。
PD 分离是计算拓扑决策（prefill/decode 算哪台机器），KV 分层是状态放置决
策（KV 放哪级存储）；两者共用同一套 connector/transfer 基础设施所以才会
被混讲——Mooncake TE 同时服务两者，vLLM 用 MultiConnector 把 PD
connector 与 store connector 链成两条独立链路（vLLM 官方博客，2026-05）。

**Q7｜agent/多轮会话场景，跨实例共享池凭什么比单机 DRAM 池好？**（频率：
高频，封闭问题以数字收尾）核心场景：用户会话被负载均衡路由到不同副本，
单机池的命中只能赌亲和；共享池把缓存变成集群公共资产。数字锚：vLLM ×
Mooncake Store 在真实 Codex trace 上把命中率从 1.7% 提到 92.2%、P50
TTFT 降 46 倍、E2E 降 8.6 倍（vLLM 官方博客，2026-05）；60 张 GB200
round-robin 无亲和仍大于 95% 命中。深度提示：能对比 sticky routing（与
[agentic-serving专题](./agentic-serving专题.md) 联动）与共享池的取舍—
—粘路由省传输但赌命中，共享池保命中但付 RDMA 带宽——就是架构题答法。

**Q8｜缓存命中率怎么观测、怎么保证？**（频率：中，运维向收口）观测层面用
请求级 + token 级命中率双指标（LMCache observability），症状面盯「hit
tokens: 0」类日志；保证层面四件套：固定序列化格式（坑位 7）、设
PYTHONHASHSEED=0（坑位 1）、cache-aware routing 或共享池兜底（Q7）、别让
启用顺序出错——LMCache 也要先开 --enable-prefix-caching（坑位 2）。

### 深浅两档备考提示

- **浅档（初中级）**：能画出四层金字塔并标量级数字；讲清 prefix cache →
  单机 DRAM offload → 分布式池的演化动机；背出 kv-transfer-config 入口和
  三种场景（单机 offload / PD / 分布式池）；说出「decode 不 offload」一
  句理由。
- **深档（资深/架构）**：讲 HiCache layer-wise overlap 与预取策略；讲
  LMCache MP 与 in-process 的本质差异（共享 vs 碎片）；给换入 vs 重算的
  决策因子；讲 Mooncake master/client 分工 + RDMA 直通路径；引用三组带出
  处的数字——线上 75% 请求（Mooncake 论文）、命中率 92.2%（vLLM×
  Mooncake）、TTFT 约 13 倍（LMCache MP）。

## 口径与未核实说明

以下为未核实/推导/口径受限项，正文不当事实引用：

1. **HBM vs DDR5 每 GB 成本倍数**：行业普遍口径 5-10 倍，本次未找到可核
   验来源（TrendForce 定价页 404），正文只写「倍数见文末」的方向性结论，
   不出倍数数字。HBM3e 单 GB 实际采购价不公开。
2. **服务器 DRAM 整机带宽 0.6-0.9 TB/s**：由 JEDEC DDR5-4800 单通道
   38.4 GB/s 标称 × 16-24 通道推导，非实测；实际有效带宽通常再打七到八
   折。
3. **NVMe Gen5 SSD 顺序读约 14 GB/s**：三星 PM1743 等厂商标称口径，未实
   测核验；随机小 IO 下远低于此。
4. **TP 大于 4 死锁、PYTHONHASHSEED 等坑位 1-6 的时效**：源出 LMCache
   官方博客 2026-04/2026-05 两篇（对应 vLLM 0.19.x / LMCache 0.4.3-dev
   版本口径），2026-10 现行版本（vLLM v0.31.0、LMCache v0.5.5）可能已修，
   面试引用保留版本号括注。
5. **HiCache 的 6 倍吞吐 / 80% TTFT 降幅**：SGLang 官方博客自称口径，非
   第三方实测；Novita AI（降 56% / 翻倍 / 40%→80%）与蚂蚁（降 84%）均
   为 SGLang 博客引用的合作方口径，原始报告未见公开链接。
6. **vLLM tiered offloading CLI 的确切 flag 名**（--kv-offloading-size
   等）：两个官方页面（LMCache 博客、HiCache 博客）一致出现，但未直接打
   开 vLLM 0.31 docs 页二次核验，成稿后建议用 vllm serve --help 实测一
   次。
7. **Mooncake README 时间线引用的 Kimi-K2 prefill 224k / decode 288k
   tok/s（200 卡 H200，2025-07 口径）**：README 引用 lmsys 博客，未二次核
   验，本篇正文未采用，仅留档。
8. **LMCache MP 博客的 「LLMCache MP 实测 0.29s vs 3.98s」与「15 倍论
   文宣称」是两个不同口径**：前者是官方博客对 vLLM 原生 in-process
   offload 的实测对比（2026-04），后者是 arXiv:2510.09665 论文宣称
   （2025-10），正文已分开括注，不要合并成「LMCache 15 倍实测」传播。
9. **CacheBlend 数字（§4.1·增，多轮 QA 吞吐 14x / RAG +4.5x / TTFT
   1.9–8.1x / 成本 -90%）**：来自 LMCache 官方与 EuroSys 2025 最佳论文
   口径，经 2026-10 网络多源转述比对（本仓未读论文原文）；「首 Token
   快 14 倍」的转述（含原微信标题）把吞吐口径挪给了 TTFT，正文已校准。

## 串联阅读

- [长上下文推理与kv体系](./长上下文推理与kv体系.md)：引擎内视角——KV 总
  量账、驱逐 vs 换入决策树、稀疏注意力×分层；本篇是它的存储层系统视角
  姊妹篇，决策因子一节与那篇决策树对读。
- [agentic-serving专题](./agentic-serving专题.md)：agent 流量特征（195K
  输入 / 317 输出中位）、sticky 路由与 TTL；本篇 Q7 的「共享池 vs 粘路由」
  取舍要在那篇的负载数字上才有说服力，本篇不复述流量叙事。
- [vllm与推理加速核心](./vllm与推理加速核心.md)：vLLM V1 进程结构与 APC
  块哈希的位置；本篇的 connector 接口族接在那一节的调度器之后。
- [推理引擎2026新进展](./推理引擎2026新进展.md)：vLLM/SGLang/Dynamo 三线
  演进；本篇的 NIXL（Dynamo 底座）与 HiCache（SGLang）是那篇引擎线未展
  开的存储侧展开。
- [推理调度专题](./推理调度专题.md)：continuous batching / token budget /
  抢占；分层换入排队与调度器 budget 的耦合可并入那篇「请求准入」视野。
- [finops与算力成本专题](../finops与算力成本专题.md)：单位 token 成本公
  式；本篇第八节的拐点判断实质是 cost/TB 与 cost/prefill 的换算挂法。
- [显存计算专题](../显存计算专题.md)：KV 显存三旋钮与 1M 上下文的账；第
  八节的「工作集 vs HBM 有效容量」就是那篇漏斗的 L1 逃逸口。
- [verl深度拆解](../训练与对齐/verl深度拆解.md)：checkpoint engine 与
  权重同步；本篇 4.2 的 Mooncake TE 外溢（K2 1T 参数 53s→7.2s）是那篇
  同一条线的推理侧镜像。
- [推理服务slo与运营](./推理服务slo与运营.md)：SLO 三件套与容量规划；谓
  词「命中率 → TTFT → 容量」的因果链可挂在它的反推链上。
- 本篇 §4.1·增 的 CacheBlend（EuroSys 2025 最佳论文）机制展开即「缝合术」
  本体；[agentic-serving专题](./agentic-serving专题.md) §一第 6 条提到
  的「EPIC、CacheBlend 类 block 级复用」落到这里读。
