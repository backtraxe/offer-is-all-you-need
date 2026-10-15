# torch.profiler 入门实战专题：两个产物、三个侦探案例与一张速查表

> 面向第一次认真读 profiler trace 的读者；已入库的姊妹篇是
> [线性层与 MLP 的 Profile 实战专题](./线性层与mlp的profile实战专题.md)
> （系列第二篇）与 [Attention 的 Profile 实战专题](./attention的profile实战专题.md)
> （系列第三篇），工具链总纲见
> [Profiling 与性能分析专题](./profiling与性能分析专题.md)。本篇是系列
> 第一站：用一个 `matmul + add` 玩具，建立三件事——① profiler 的**两个
> 产物**（表 vs trace）各回答什么问题；② **overhead-bound vs
> compute-bound** 的判定数字；③ 三个侦探案例（首步死区、CPU/GPU 道
> 偏移、同 kernel 快慢不一）；④ 一张随身速查表。
>
> **口径声明**：案例与数字来自 PyTorch 官方 Profiling 系列教程（第一篇，
> A100 + PyTorch 2.13 实测），绝对值随版本与硬件变化，方法不变。

## 一、配置与两个产物

最小可用姿势：`torch.profiler.profile(activities=[CPU, CUDA])` 包住
被测函数，里面用 `record_function("matmul_add")` 打标注；
`prof.key_averages().table(sort_by="cuda_time_total")` 出表，
`prof.export_chrome_trace(...)` 出 trace。热身建议：进 profiler 前
先跑几遍，schedule 用 `wait=1, warmup=1, active=3`（wait 跳过嘈杂
初始化、warmup 跑但不记录、active 才进 trace）。

**两个产物回答的是不同问题**：

- **profiler 表**：统计摘要——什么最耗时、被调多少次（`# of Calls`
  列），找热点；`Self` 只算自身、`Total` 含全部子事件
  （`CPU total ≫ Self CPU` 说明大头在子事件里，往下钻）；
- **trace**：时间线——什么时候 launch 了哪些 kernel、launch 有没有
  延迟、CPU 与 GPU 的活动有没有重叠。

## 二、第一个判定：overhead-bound 还是 compute-bound

| 矩阵 | Self CPU total | Self CUDA total | 结论 |
|---|---|---|---|
| 64×64 bf16 | 2.314 ms | 23.104 µs | **overhead-bound**：GPU 有 99% 时间在闲，CPU 全花在 dispatch、launch、搬运上 |
| 4096×4096 bf16 | 4.908 ms | 4.495 ms | **compute-bound**：量级对齐，GPU 是真瓶颈 |

代价失衡的另一个指纹：`cudaDeviceSynchronize` 1.78 ms 罩着 26 µs 的
真活——profiler 在 active 窗口末尾打同步刷事件，**同步时长 ≈ GPU
收尾未完成工作的时间，不是 CPU 开销**；同步罩小微活就是教科书式的
overhead-bound。走出 overhead-bound 的最简动作：把活做大（更大矩阵
或 batched 算子），让每次 launch 摊到更多计算。

## 三、侦探案例一：第一个 ProfileStep 为什么特别宽

现象：ProfilerStep#2 比 #3、#4 宽得多。放大看，标注
`record_function("matmul_add")` 已进入，但到 `aten::matmul` dispatch
之间隔了 **227.757 µs 死区**（后续步只有 5 µs 上下）。真凶在标注
内部而不在标注本身：**冷启动税**——workspace 分配、cuBLAS 启发式
挑 kernel、模块懒加载。处置方针：profile 前跑 warmup（独立于 schedule
的 warmup 参数），让一次性工作不计入。**注意这不是优化掉了冷启动，
只是没 profile 它**——如果冷启动本身是问题（serverless 推理、逐请求
init），它值得单独成一个议题。

## 四、侦探案例二：CPU 道和 GPU 道为什么错开 2.5 ms

现象：warmup 后 CPU/GPU 道之间仍有约 2.5 ms 偏移，而 GPU 本该一直
忙。把 schedule 改成 `wait=0, warmup=0` 逼出真相——GPU 道在操作前
冒出 **Activity Buffer Request**：profiler 在给自己分配事件 buffer。
把 active 加大到 20 验证：**间隙只在 ProfileStep#1 出现一次，之后
再无**——是 profiler 自己的 buffer 分配，不是被测代码的问题。
**读 trace 的通用确认法：可疑现象多跑几轮，只出现一次的通常是
测量者自己，反复出现的才归被测系统**。

## 五、侦探案例三：同一个 kernel 为什么快慢不一

4096 矩阵跑 20 个 active step：matmul kernel 完全一样（名字相同，
排除 cuBLAS 启发式与调度间隙），但某步明显更慢。**kernel 运行时间
不是常量**——GPU 时钟的空闲/睿频、发热、电源管理、驱动 housekeeping
都在动。看均值会得到「matmul ≈ 1.08 ms」；看 trace 才发现平时
≈580 µs，只是偶尔波动。**均值掩盖一切；分位数 + trace 才见真相**
——这与推理侧「指标一律报分位数」是同一条纪律。

## 六、dispatch 链与 occupancy 查询速查

嵌套链：`ProfileStep → record_function → aten::matmul → aten::mm`
（二维）；给矩阵加 batch 轴，落点变 `aten::bmm` 并伴随更多 CUDA
runtime 调用（cuBLAS 要为 batched 变体做更多启发式）。

`cudaOccupancyMaxActiveBlocksPerMultiprocessor`：
- 出现在 `cudaLaunchKernel` 之前 → **重量级、自适应 launch 的
  kernel**（GEMM、卷积）——cuBLAS 在问驱动「一个 SM 能驻留几个
  block」好挑变体；matmul kernel 的寄存器/共享内存随形状动态，所以
  要查；
- 不出现 → 逐元素/reduction kernel——footprint 固定且轻量
  （add 只有 32 寄存器、零共享内存），机械 launch 即可。

扫 trace 时拿它当书签：**有查询的必是重活，没查询的是轻活**。

## 七、torch.compile 的两个真相（入门篇版）

**真相一：融合发生在 dispatcher 层，不在 kernel 层。**
Inductor 把 `add(matmul(x,w), b)` 重写成单个 `aten::addmm(b, x, w)`
——GPU 上跑的还是同一个 cuBLAS GEMM kernel；而且不是零成本：
`addmm` 要先 DtoD memcpy 把 bias 填进目标 buffer（32 MB、约 33 µs），
再在 GEMM epilogue 里完成 bias 加。**两次访存都在，只是换了名字**；
真正跳过 memcpy 是手写 kernel 的做法（对照
[线性层与 MLP 篇](./线性层与mlp的profile实战专题.md) 的 Liger 路线）。

**真相二：小 op 上 compile 的 CPU 每步贵约 2 倍。**
每次调用都走整条栈：`TorchDynamo Cache Lookup`（形状/dtype/设备/
元数据匹配校验，**每次调用都付**）→ `AOTDispatcher Runtime Wrapper
Prologue`（不要梯度也在栈里）→ `Call CompiledFxGraph <hash>`
（hash 相同 = 缓存命中；生成源码在
`/tmp/torchinductor_<user>/fxgraph/<hash>` 可翻）。这套税靠几十个
op 的模型摊薄，单个 op 就是纯亏——与系列第二篇「单 Linear compile
零收益」互相印证。

## 八、随身速查表（背这张就够开场）

| 在 profiler 看到 | 通常意味着 | 动作 |
|---|---|---|
| Self CPU（ms）≫ Self CUDA（µs） | overhead-bound | 做大批量/融合调用 |
| 首个 ProfileStep 特别宽、标注与首个 aten 间死区 | 冷启动税（workspace/cuBLAS/懒加载） | warmup；冷启动本身是议题就单列 |
| CPU/GPU 道初始偏移、间隙只出现一次 | Activity Buffer Request（测量者自己） | 无视；多跑几轮确认即可 |
| active 末尾超长 cudaDeviceSynchronize | profiler 刷事件、GPU 收尾 | 不是 CPU 开销；罩小微活即 overhead-bound |
| launch 前有 occupancy 查询 | GEMM/卷积级自适应 kernel | 扫它是「重活书签」 |
| 同 kernel 各 step 计时不一 | 时钟/发热/电源/驱动 | 看 trace 与分位数，别看均值 |
| `aten::addmm` + GEMM 前 DtoD memcpy | dispatcher 层融合；bias 先填 buffer | memcpy 也是钱；真融合得手写或 Triton codegen |
| compile 后 CPU 每步变贵 | Dynamo/AOT/Inductor 栈的按次税 | op 少了别开 compile；查 mode 参数 |

## 九、▶ 面试题与追问

**Q1【高】profiler 表和 trace 分别回答什么问题？**
表回答「什么最耗时、被调多少次」（热点定位，Self/Total 分列）；trace
回答「什么时候 launch 了什么、launch 延迟多少、CPU/GPU 有没有重叠」
（过程定位）。**优化先表后 trace：表告诉你优化谁，trace 告诉你
为什么慢**。

**Q2【高】GPU 利用率低，怎么判断是 launch 开销还是 kernel 本身弱？**
看 Self CPU total vs Self CUDA total 的量级：CPU 毫秒级、GPU 微秒级
就是 overhead-bound（dispatch/launch/搬运吃掉大头）；两者同量级才
轮到 kernel 本身。配套印证：launch 前有 occupancy 查询的是重量级
自适应 kernel，没有的是轻量逐元素。

**Q3【中高】trace 里发现一个可疑间隙，怎么确认它是不是自己代码
的问题？**
两个动作：多跑几轮（active 调大），只出现一次的归类测量者自身
（profiler buffer 分配、冷启动）；反复出现的才追代码。另看间隙两侧
的事件属性：落在 record_function 与首个 aten 之间的是冷启动税，
落在 kernel 之间且反复出现的是真调度/同步问题。

**Q4【中高】为什么同一 kernel 两次运行时间不一致？benchmark 怎么
报才诚实？**
时钟睿频状态、温度、电源管理、驱动 housekeeping 都会让同 kernel
的时长漂移；kernel 时间不是常量。诚实报法：多轮 trace 看分布与典型
值（本例典型 580 µs vs 均值 1084 µs），报分位数并报轮数与 warmup
配置——「跑了一次报均值」在这个粒度上等于没测。

**Q5【中】torch.compile 什么时候是负优化？**
op 数量少时：每次调用都付 Dynamo cache lookup + AOT prologue 的
按次税，且没有可融合对象时 GPU 端零收益（kernel 逐字节不变）。
什么时候值得：pointwise 链 + glue code 多、op 数量几十以上——
融合收益摊得薄按次税（系列第二篇 MLP 案例）。

**Q6【中】`aten::addmm` 融合是免费的吗？**
不是。它是 dispatcher 层融合：先 DtoD memcpy 把 bias 填进目标
buffer，再在 GEMM epilogue 完成 bias 加——两次访存都在，只是从
「单独 add kernel」变成「memcpy + epilogue」。判断是否划算要回到
访存账：省的是一次 launch 与中间张量的物化开销。

## 十、串联阅读

- [线性层与 MLP 的 Profile 实战专题](./线性层与mlp的profile实战专题.md)：
  系列第二篇，本篇的 dispatch/compile 知识在那里升级；
- [Attention 的 Profile 实战专题](./attention的profile实战专题.md)：
  系列第三篇，SDPA 四后端；
- [Profiling 与性能分析专题](./profiling与性能分析专题.md)：工具
  四段式与 Nsight 家族，本篇是它的「第一课案例化」；
- [推理 Profile 实战专题](./inference/推理profile实战专题.md)：
  把本篇方法用于生产推理 trace 的闭环。

## 口径与未核实说明

- 全部耗时数字（227.757 µs、1.78 ms vs 26 µs、580/1084 µs、2.5 ms
  偏移、33 µs、约 2 倍 CPU 税）为官方教程在 A100 + PyTorch 2.13 的
  实测口径；版本与硬件不同会变，**识别模式的方法不变**。
- fxgraph 落盘路径与 Torch-Compiled Region 的命名随版本变化，以
  所用 PyTorch 版本为准。
