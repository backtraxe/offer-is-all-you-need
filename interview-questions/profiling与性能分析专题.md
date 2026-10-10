# Profiling 与性能分析专题：GPU 时间拆解、工具四段式与门诊手册

> **面向**：准备 AI Infra 面试「性能分析与调优」追问线的读者，默认已读过
> [cuda与kernel专题](./cuda与kernel专题.md)（kernel 侧机制）与
> [inference/推理调度专题](./inference/推理调度专题.md)（引擎侧调度）。
> 如果你是面试官口中「给我一个慢 case，你怎么查」答不上来第三层的人，
> 这篇就是补第三层的。
>
> **读完获得**：① 直觉主线——GPU 时间只有「算、搬、等」三个去向，
> profiling 的全部工作就是把 wall time 拆进这三个桶；② 工具四段式的选型
> 话术（torch.profiler → nsys → ncu → 引擎内建开关）与开销阶梯；③ 训练大
> 作业的标准 SOP（抓 → 洗 → 拆桶 → 下钻 → 验证）；④ 一张门诊症状 → 工具
> 对应表，背下来就是一面标准答案；⑤ 带宽/FLOPS/版本全套数字锚，全部括注
> 来源与年份；⑥ 8 条面试题完整答法。
>
> **时效口径**：工具与参数按 **2026-10** 的官方文档口径（vLLM v0.31、
> SGLang v0.5.21、nsys 2026.5、ncu 2026.3、PyTorch v2.14），FlashAttention
> 数字按作者 blog/README 原始口径；社区实测与经验估算一律标明「社区口径」，
> 未核实项见文末「口径与未核实说明」。

## 〇、直觉：GPU 的时间只有三个去向

一句话直觉：**GPU 程序的墙钟时间只会花在「算」（compute）、「搬」（访存
与通信）、「等」（gap 与气泡）三个桶里**。nvidia-smi 只告诉你「有活干」的
占比——它报的是「采样窗口内是否至少有一个 kernel 在跑」的时长比例
（NVIDIA 文档长期表述，percent of time one or more kernels are executing），
SM 只开 10% 也算 busy。所以 util 高 ≠ 没问题：拆桶必须靠时间线工具。

第一性判据是 roofline：把 kernel 的算术强度（FLOP/byte）跟机器拐点比。
H100 BF16 张量核 **峰值 989 TFLOPS、HBM 带宽 3.35 TB/s（NVIDIA 官方页，
2026）**，拐点约 **295 FLOP/B**；算术强度高于拐点就是 compute bound，反之
memory bound。decode 阶段的 GEMV 算术强度只有约 2 FLOP/B——**decode 永远
memory bound**，这一个结论决定了 decode 优化的一切方向：KV cache 量化、
MLA、涨 batch 爬 roofline 斜坡。面试里把这一条讲透，比背十条参数有用。

<div class="diagram-embed">
<iframe src="assets/diagrams/profiling.html" width="100%" height="620" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/profiling.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、工具四段式：什么时候用哪一格

2026 年工具链已经收敛成四格：**torch.profiler（框架内、中开销、带
stack/shape）→ nsys（低开销时间线，看 gap/overlap/NCCL）→ ncu（单 kernel
深潜，慢 10-100 倍，看 roofline 落点）→ 引擎内建 HTTP 开关**（vLLM/SGLang
都封装了 torch profiler，产物统一进 Perfetto）。面试标准答案不是背命令，
而是「什么时候用哪一格」——vLLM 官方 profiling 文档（2026-10）自己就是
这么分的。

### 1.1 torch.profiler / Kineto：框架内的第一站

栈是 PyTorch profiler API → Kineto → CUPTI（PyTorch v2.14.x，2026-09 发布）。
关键 API 就那几个，但每个都有面试价值：

- `schedule(wait, warmup, active, repeat)`：wait 跳过编译与 allocator
  warm-up，active 段才是有效样本；**profiling 的第一步永远是选对窗口**。
- `activities=[CPU, CUDA]`：只要 GPU 侧就 `["CUDA"]`，省掉 CPU 段的体积
  和 flushing 时间（vLLM 文档的建议写法）。
- `record_shapes` / `with_stack`：信息量大但开销大，生产慎开；
  with_stack 叠 record_shapes 可以让吞吐掉数倍（社区实测口径）。
- `profile_memory` / `with_flops`：显存账与 FLOPS 账的出口。
- 产物：`export_chrome_trace` / TensorBoard / `key_averages()`，查看前端
  2026 年已收敛到 **Perfetto**（ui.perfetto.dev）——vLLM 和 SGLang 官方
  文档都只指它。

分布式场景每 rank 各自写 trace，靠工具后合并：SGLang 自带 merger、
HTA（HolisticTraceAnalysis，561 star 的小而美库，GitHub 2026-10 实测）
做多 rank 关键路径与通信负载均衡分析。NCCL 卡死另有一格：PyTorch
Flight Recorder（`TORCH_NCCL_TRACE_BUFFER_SIZE`，2.4+，方向性提及未逐个
核实）。

### 1.2 Nsight Systems（nsys 2026.5）：系统级时间线

底层是 CUPTI trace（2026 版默认硬件时间戳 HES）+ OS runtime + NVTX。
**读时间线的顺序是先纵后横**：纵轴看 GPU 各 stream 上 kernel 的连续度，
横轴把 GPU 缝隙对齐到 CPU 的 cudaLaunch 与 DataLoader 线程段。三个高频
诊断：

1. **kernel gap**：GPU stream 上 kernel 之间的小缝，每条缝对应 CPU 上
   一段长 python runtime，就是 CPU-bound launch 开销。解法三选一：
   CUDA Graph、torch.compile、减 python。
2. **NCCL 与 overlap**：通信 kernel 有没有藏进计算影子。TP 的通信全部
   串行暴露 = 没做 overlap；DP 的梯度 allreduce 应该藏在 backward 里。
3. **DataLoader 阻塞**：step 起点 GPU 空转 + `cudaMemcpy H2D` 晚到。

`nsys stats` 直接出 `cuda_gpu_kern_sum`——vLLM 官方文档示例里 GEMM 占
**GPU 时间的 46%（vLLM 文档示例，2026-10）** 是很典型的首诊。2026.5 的
新能力：**NCCL straggler recipe**（定位慢 rank）和 **vClock**（免 root
跨节点时钟对齐），外加 Rubin 平台支持。

### 1.3 Nsight Compute（ncu 2026.3）：单 kernel 深潜

对目标 kernel 多次 replay 收 PMU 计数，**典型减速 10-100 倍（社区经验
口径）**，只适合离线复现。产出三件套：roofline 图落点、SM 拆账
（occupancy、issue slot utilization）、内存吞吐拆账（DRAM/L2/SMEM、
bank conflict）。2026.3 新增 **Compute Triage Guide** 官方 top-down
工作流：先分 compute/memory/latency bound 再下钻。纪律只有一条，但面试
必答：**ncu 要在 nsys 定位到具体 kernel 之后才用**——顺序反了就是拿锤子
找钉子，而且 ncu 的结果不含调度效应，不能回答「为什么线上慢」。

### 1.4 引擎内建开关：一个 HTTP 请求抓一轮

2025-2026 最大的工程变化，是把 profiling 做成**常驻开关 + 分 step 抓取**，
「抓 step 0~5 的 trace」从改代码变成一个 HTTP 请求：

- **vLLM（v0.31，2026-10）**：`--profiler-config '{"profiler":"torch",
  "torch_profiler_dir":...}'`（v0.13.0+ 统一入口），`/start_profile` 支持
  `delay_iterations` / `max_iterations` / `profile_prefix`；`vllm bench
  serve --profile` 一键抓。产物按 rank 命名
  （dp0_pp0_tp0..._rank0.pt.trace.json.gz）。两个坑：**flush 很慢——70B
  模型 × 100 请求 flush 约 10 分钟（H100，vLLM 官方文档，2026-10）**；
  nsys 侧要 `VLLM_WORKER_MULTIPROC_METHOD=spawn`（fork 下 CUPTI 注入
  不可靠）+ `--cuda-graph-trace=node`。第三种选择 **Triton Proton**：
  低开销聚合树或 Chrome trace，能做 CUDA graph 归因，需 Triton 3.7+。
- **SGLang（v0.5.21，2026-10）**：`SGLANG_TORCH_PROFILER_DIR` +
  `/start_profile`（start_step / num_steps / activities /
  merge_profiles），多 rank trace 自动合并。四级 benchmark 分层：
  `bench_serving` 走在线全链路，`bench_one_batch` 直连 ModelRunner 测纯
  kernel 延迟。特色三件套：① `detailed_annotations` 把每步 token 分布
  折进 trace，trace 自带做 roofline 分析所需的请求分布；② PD 分离下
  prefill/decode 必须分开 profile（--profile-prefill-url 与
  --profile-decode-url 互斥）；③ `--enable-layerwise-nvtx-marker` 给
  每层打 NVTX（注意 CUDA graph 会吞 NVTX，定位 python 源码得配
  `--disable-cuda-graph`）。

生态体量锚（GitHub star，2026-10 实测）：**PyTorch 104k / vLLM 93.5k /
SGLang 37.0k**——profiling 能力跟着这三个 repo 走就够了。

## 二、开销阶梯与七个工程议题

### 2.1 开销阶梯是硬 trade-off

越精确越贵：**nvidia-smi / DCGM 免费常驻 → nsys 低开销可短窗在线 →
torch.profiler 开 with_stack 吞吐掉数倍 → ncu 直接 10-100 倍减速**。
vLLM 官方文档（2026-10）第一句就是 end-user 请勿开启 profiling，线上可
接受的极限一般在 nsys 这一格，CPU 侧用 py-spy 采样补刀；深潜一律离线
复现。

### 2.2 trace 体积与 flush 是真实成本

Chrome 打不开大 trace，SGLang 建议压到 **100 MB 以下（SGLANG 文档口径，
2026-10）**。对策三板斧：按 step 语义抓短窗、`activities=["CUDA"]` 砍掉
CPU 段、产物 gzip。vLLM 70B × 100 请求 flush 约 10 分钟那条数字就是
「抓全量」的代价。

### 2.3 CUDA graph 会「隐身」

graph replay 之后逐层 NVTX 标记消失，nsys 要 `--cuda-graph-trace=node`
才能看 graph 内部，SGLang 定位 python 源码要求 `--disable-cuda-graph`。
**profile 之前先回答：这次要看 graph 内还是 graph 外**，答错一步就白跑。

### 2.4 fork vs spawn

CUPTI 注入在 fork 进程下不可靠，多进程 worker 一律 spawn。省一次排查
ticket 的时间。

### 2.5 多机 trace 的时钟对齐

不同节点的 trace 各有本地时钟，跨节点 overlap 诊断一度靠肉眼对时间戳。
演进链：手工对时 → 每 rank 写 trace 后工具合并（HTA、SGLang merger，
多机要求共享存储）→ **nsys 2026.5 的 vClock 免权限虚拟钟**。

### 2.6 「util 高 ≠ 没问题」的度量陷阱

nvidia-smi util 是采样口径不是饱和度口径：kernel 在跑就算 busy，跟 SM
开了多少、带宽用了多少完全脱钩。判断真实饱和度改用 **ncu 的 SM
Throughput 与 DRAM Throughput**，或 DCGM 的 sm_active、tensor pipe
active。这一题几乎 AI Infra 一面必考。

### 2.7 观察者效应与慢 rank 归因

profiler 自身是扰动源：online serving 下开 profiling，TTFT/TPOT 全部
失真。分层：Grafana/DCGM 定段 → nsys 短窗抓 trace → ncu 离线下钻，
**不能把诊断手段直接压在生产链路上**。分布式下 step time 由最慢 rank
决定（集合通信的同步语义）：「慢 rank」的常见根因不是 NCCL 本身，而是
某 rank 的 DataLoader 慢、热降频/ECC 报错、混部邻居抢带宽、IB 端口抖动。
归因顺序永远是**先单点机器指标（dcgm / 降频 / 温度）→ 再通信 trace**。

## 三、训练大作业 SOP：抓 → 洗 → 拆桶 → 下钻 → 验证

面试问「训练慢 15% 怎么查」，照这五步走就是满分结构：

1. **抓**：`torch.profiler.schedule(wait=1, warmup=1, active=3)`，或等价
   的 HTTP 开关，抓 step 0~5。step 0/1 混着编译、allocator warm-up、
   CUDA graph capture——标注为「异常但正常」，别被吓到。
2. **洗**：抛掉 step 0-2，对 step 3-5 做分位/方差分析（p50/p90/p99、
   step time 抖动系数）。**方差大先查 DataLoader、检查点/日志同步、
   straggler rank，而不是 kernel**——顺序错了一下午就白干。
3. **拆桶**：step 时间拆成六类——forward GEMM / attention / NCCL 通信 /
   optimizer / CPU python / gap。每一类对应一种修法，不拆桶就没有优化
   优先级。
4. **下钻**：只有占比异常的具体 kernel 才进 ncu，看它到底卡在带宽、
   issue 还是 latency。
5. **修复验证**：比对修复前后**同一 step 窗**的 trace，不信单次撞出来
   的数字——profiling 的结论必须可复现，不然就是在测噪声。

## 四、门诊症状 → 工具对应表

背下来这张表，一面「怎么查」类题就有兜底答案：

| 症状 | 最可能根因 | 第一工具 | 验证路径 |
|---|---|---|---|
| GPU util ~60% 但显存已满 | decode memory-bound：batch 开到容量墙，util 采样口径虚高 | ncu（DRAM Throughput）+ Perfetto | 实测 HBM 带宽对比 3.35 TB/s（H100）；>80% 即带宽墙，方向是 KV 量化/MLA/更大 batch |
| step time 抖动（p99/p50 > 1.3） | DataLoader prefetch 不足 / 检查点同步 / straggler rank / 混部 | nsys 时间线 + DCGM | step 起点 GPU 空窗是否对齐 CPU 段；多 rank trace 找固定慢 rank → 查降频/温度/IB 计数器 |
| kernel 间全是小 gap | CPU-bound launch：python 开销、小算子太多 | nsys + py-spy 火焰图 | gap 对齐 CPU python 段 → CUDA Graph / torch.compile / 算子融合 |
| NCCL kernel 完全串行暴露 | 通信计算没 overlap（TP 典型），或梯度桶/通信流配置错 | nsys 时间线 | 通信应藏在反向/计算流影子下；查通信 stream 专用化、bucket size、PP 气泡 |
| prefill 慢但 worker util 不高 | chunked prefill 太小 / attention kernel 没吃满 / CPU 调度回路 | bench_one_batch + ncu | 静态 batch 直测 kernel 延迟，定位 GEMM/attention 的 roofline 落点 |
| TTFT 劣化但 GPU 均正常 | 前端/调度回路 CPU 瓶颈、KV 排队、prefix cache miss | 引擎 metrics + py-spy | TTFT = 排队 + 调度 + prefill，先拆段再下钻 |
| 某 rank 周期性变慢 | 热降频 / ECC 错误 / IB 抖动 / 数据不均 | DCGM + nsys straggler recipe | 温度/时钟曲线对齐 trace 慢窗 |
| elementwise kernel 带宽只到理论值 40-50% | 未融合、访存不合并 | ncu（L2/DRAM 吞吐、sector 命中） | 融合后重测：判据是都落在 roofline 带宽段、中间不物化大张量 |

## 五、数字锚（全部括注来源年份）

### 5.1 带宽与互联

- **H100 SXM 80GB HBM3，带宽 3.35 TB/s（NVIDIA 官方页，2026）**；
  **H200 SXM 141GB HBM3e，带宽 4.8 TB/s（NVIDIA 官方页，2026）**；
  **B200 按 DGX 整机 64 TB/s 除以 8 推导为 8 TB/s/卡（官方整机规格推导，
  2026）**。
- **NVLink4 每卡 900 GB/s、NVLink5 每卡 1.8 TB/s，均为双向口径（NVIDIA
  官方，2026）**。NCCL allreduce 的 busbw 对标的是单向线速：busbw 公式
  `algbw × 2(n-1)/n`（rs/ag 类算子为 `(n-1)/n`，nccl-tests 官方
  PERFORMANCE.md 口径，2026）。所以 **8 卡 H100 NVSwitch 实测 busbw 约
  450-470 GB/s（社区实测区间 2024-2026）** 不是「没打满」，是口径正确——
  分清「官方 NVLink 数字是双向、NCCL 对标单向」就排进候选人前 10%。
- 跨机 400Gb/s IB 每 rail 对应每 GPU 单向约 50 GB/s，调好后 busbw 约
  **44-48 GB/s（社区实测/推导）**。
- **单次 kernel launch 开销约 3-5 μs（社区经验口径）**——这是 CUDA
  Graph 的全部动机。

### 5.2 FlashAttention 接力（作者官方口径）

- **FA2 比 FA1 快约 2 倍；FA2 在 H100 上只达峰值的 35-50%（tridao FA3
  blog，2024）**。背后的卡点：H100 张量核 989 TFLOPS vs 特殊函数单元
  **3.9 TFLOPS（FA3 blog 引 CUDA 编程指南）**，softmax 的 exp 不 overlap
  时能单独吃掉 attention 一半时间。
- **FA3 达 740 TFLOPS（75% 峰值），FP8 接近 1.2 PFLOPS（tridao FA3
  blog，2024）**，靠 WGMMA/TMA 异步把 softmax 与 GEMM overlap。
- FA 系列整体 vs 朴素 attention：**wallclock 快 2-4 倍；显存 2K 长度省
  10 倍、4K 省 20 倍（flash-attention README 作者 benchmark）**；全套
  优化库训 GPT 在 A100 上达 **225 TFLOPS/卡，即 72% MFU（作者官方）**。
- 面试满分结构：「融合收益 = 消除中间张量物化 × 带宽差 + overlap 掉
  短板单元」，比背倍数高一个段位。

### 5.3 版本与生态（2026-10 实测）

- **PyTorch v2.14.1（2026-09-30）、NCCL v2.32.3（2026-09-17，GitHub
  release）**。
- **nsys 2026.5.1**（Rubin、NCCL straggler recipe、vClock）；
  **ncu 2026.3.1**（Compute Triage Guide）。
- **vLLM v0.31.0、SGLang v0.5.21**；profiling flush 成本锚：70B × 100
  请求约 **10 分钟（H100，vLLM 官方文档，2026-10）**。

## 六、▶ 面试题 8 条（全收）

**Q1【极高】nsys、ncu、torch.profiler 你各在什么时候用？**
按开销阶梯 + 顺序答：先时间线定位（nsys / profiler 短窗），再单点下钻
（ncu）。加分两点：ncu 是 kernel replay、不能 production 在线跑、结果
不含调度效应；生产可接受的极限一般在 nsys 这一格，CPU 侧 py-spy 补。
（§一、§2.1）

**Q2【极高】nvidia-smi 显示 util 100%，是不是就没有优化空间了？**
不是。util 是「采样窗口内是否有 kernel 在跑」的比例，不是 SM 饱和度。
反例：decode GEMV 全程 memory-bound，util 照样 100%。正确的副指标是
HBM 带宽利用率（ncu DRAM Throughput）和 tensor core active——util 100%
但带宽只跑 20% 的 case 到处都是。（§〇、§2.6）

**Q3【高】8×H100 训练，NCCL allreduce busbw 只有 380 GB/s，正常吗？**
先问口径：busbw = algbw × 2(n-1)/n，对标单向线速约 450 GB/s（不是
官方宣传的 900 双向），380/450 ≈ 84%，正常。跨机对标每 GPU 约
44-48 GB/s（400G rail）。能讲清「官方 NVLink 数字双向、NCCL 对标单向」
就超过大多数候选人。（§5.1）

**Q4【高】怎么定位 decode 阶段是 CPU-bound 还是 GPU-bound？**
看 GPU stream 的 kernel 间有没有 gap、gap 是否与 CPU 调度回路对齐：
有 gap 且对齐 → CPU-bound（小模型/小 batch 常见），对策 CUDA Graph、
更大 micro-batch。追问预备：speculative decoding 会加重 CPU 回路，
CPU-bound 阈值左移。（§1.2、门诊表）

**Q5【高】线上不能停服，怎么给推理集群做 profiling？**
分层答：DCGM/metrics 无损定段 → 单个实例摘流量、开 /start_profile +
delay/max_iterations 短窗抓 → trace 拉回离线 ncu。补三个坑显熟练度：
flush 约 10 分钟、trace 体积压 100 MB 下、worker 用 spawn。（§1.4、§2.2）

**Q6【中高】kernel 融合到底能省多少？**
别背倍数背机制：FA 本质把 attention 的 HBM 读写从 O(N²) 降到 O(N)，
wallclock 2-4 倍、4K 显存省 20 倍；FA3 从 35-50% 峰值提到 75%
（740 TFLOPS），靠 WGMMA/TMA 异步 overlap——H100 特殊函数单元只有
3.9 TFLOPS，不 overlap 时 softmax 的 exp 单独吃掉一半时间。收口公式：
融合收益 = 消除中间张量物化 × 带宽差 + overlap 掉短板单元。（§5.2）

**Q7【中高】多机训练 GPU 利用率不齐，怎么查慢 rank？**
每 rank trace + HTA/merger 对齐 → nsys NCCL straggler recipe / vClock
→ 落回单点机器指标（降频、ECC、IB counter、DataLoader）。追问「为什么
step time 由最慢 rank 决定」：集合通信的同步语义，快 rank 的全在等。
（§2.5、§2.7）

**Q8【中】step time 抖动大，你的排查顺序是什么？**
先做分位分析定「是均值高还是尾巴长」；尾巴长先查 DataLoader prefetch、
检查点/日志同步、straggler rank，而不是 kernel——这是 SOP 第二步的
核心纪律。均值高再走拆桶 → ncu 下钻。（§三）

## 七、口径与未核实说明

- NCCL 实测带宽（8×H100 busbw 450-470 GB/s、跨机 44-48 GB/s）：社区
  复现区间，未见 NVIDIA 官方 reference 数。
- ncu 开销 10-100 倍、kernel launch 3-5 μs：社区经验口径，随版本与
  负载漂移。
- B200 单卡 8 TB/s、180 GB：DGX B200 整机规格除 8 的推导值；B300 口径
  未核实。
- PyTorch Flight Recorder（2.4+、TORCH_NCCL_TRACE_BUFFER_SIZE）：
  方向性提及，未逐个环境变量核实。
- nvidia-smi util「采样窗口内是否有 kernel 在跑」：NVIDIA 文档长期
  表述（percent of time one or more kernels are executing），与 SM
  饱和度脱钩是行业共识。
- vLLM/SGLang 参数细节、nsys/ncu release note、FA 数字、GPU 规格、
  star 数：2026-10-10~11 经 GitHub API 与官方页面实测。

## 串联阅读

- [cuda与kernel专题](./cuda与kernel专题.md)：kernel 侧机制（FA 接力、
  融合判据）——本篇 Q6 的机制层展开，ncu 下钻后的结论会落到那篇的
  选型表上。
- [inference/推理调度专题](./inference/推理调度专题.md)：引擎侧连续
  batching 与抢占——TTFT/TPOT 劣化先按门诊表拆段，段内机制查这篇。
- [inference/vllm与推理加速核心](./inference/vllm与推理加速核心.md)：
  vLLM 核心机制，配本篇 §1.4 的 /start_profile 参数一起读。
- [distributed-training/训练框架与稳定性](./distributed-training/训练框架与稳定性.md)：
  训练侧稳定性（慢机、掉卡、重试）——本篇 Q7 慢 rank 归因的框架层
  邻居。
- [distributed-training/通信与网络专题](./distributed-training/通信与网络专题.md)：
  rail 拓扑与集合通信——本篇 §5.1 的带宽口径在那篇有完整硬件分层。
- [agent/观测与trace工程](./agent/观测与trace工程.md)：应用侧观测栈
  收敛（SDK → semconv → 后端）——本篇管 GPU 时间线，那篇管 agent
  trace，体检报告的另一半。
- [显存计算专题](./显存计算专题.md)：显存五笔账——「util 60% 但显存
  满」的显存侧解释与 KV 账。
