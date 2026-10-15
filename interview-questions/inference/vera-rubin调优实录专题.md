# Vera Rubin 调优实录专题：新硬件代际到手后的推理优化四板斧

> 面向准备推理岗、已经读过 [MLA 深度穿透专题](../llm基础/mla深度穿透专题.md)
> 与 [Attention 的 Profile 实战专题](../attention的profile实战专题.md) 的
> 读者。本篇拆解 LMSYS/SGLang 团队的 Kimi K3 在 NVIDIA Vera Rubin 上的
> 推理调优实录（2026-10-09 官方博客）：**新硬件参数给了新上限，但大部分
> 加速来自把上一代没注意的开销清掉**。案例覆盖 MLA decode、MoE 尾、
> KDA verify、RL 训推四条线，每条都标了面试追问。
>
> **口径声明**：全部百分比收益与配置为 LMSYS 官方博客口径，未独立复测；
> 「逐比特一致」「4.8 倍集群吞吐」均为原文自报。

## 一、新平台给的三张牌 + 一条基线

Vera Rubin（GB300 之后一代）与调优最相关的三个参数：

| 参数 | Hopper/Blackwell | Vera Rubin | 调优含义 |
|---|---|---|---|
| 每 CTA 共享内存 | 227 KiB | **327 KiB** | 流水线 stage 可以加深一档 |
| SM 数 | 132 量级（H100/B200 各不同） | **212** | 小批量时的 split 数要重标定 |
| 互联 | NVLink 5 | NVLink 6 | all-reduce 的 push/pull 切换点重调 |

集群侧基线：Cognition 已在 Vera Rubin NVL72 部署自家 SGLang 栈，报
**total token 吞吐为 GB200 NVL72 的 4.8 倍**（官方口径）。注意这是集群
级数字，含规模与软件栈差异，别当作单卡加速比引用。

## 二、MLA decode 四连击（K3 是 MLA 模型）

MLA decode 的瓶颈本质是**等 HBM 读 KV**（账见
[MLA 深度穿透专题](../llm基础/mla深度穿透专题.md)），四个优化全是围绕
「让读更多地在路上、让等待更少地发生」：

1. **深流水线**：Blackwell 的 FP8 kernel 已把 227 KiB smem 塞满（3 个 K
   stage + 2 个 V stage）；327 KiB 正好多塞 1 个 K stage 和 2 个 V stage，
   流水线加深一档 → batch 16、128k 上下文**快 16%，输出逐比特一致**。
   **新硬件的第一个动作永远是把松弛的资源重新塞满。**
2. **split-KV 合并先读后算**：低并发时一个请求的 KV 分给很多 CTA，合并
   kernel 原来「读一个 split 的部分结果、等一次、再读下一个」——每个
   split 白付一次 L2 延迟。改成**先把所有读发出去、再从寄存器累加**，
   batch 1、128k 的完整 FP8 MLA **提速 20%（官方口径）**。
3. **split 数按 SM 数重标定**：batch 1 decode 给 attention 的并行活太少，
   默认 32 split 让 212 个 SM 大半闲着；按 K3 的形状翻倍到 64 split →
   **端到端提速 1.9%（官方口径）**。同理心公式：split 数 ≈ SM 数的可见
   利用率函数，换硬件必须重调。
4. **饱和转换**：MLA 的 KV/Q 准备里转 FP8 时没开饱和模式，编译器走慢速
   软件路径；改成饱和转换（溢出钳到 ±448 而非变 NaN）→ 准备 kernel
   **快 2.5 倍**。这类「指令选型」优化一个 if 都没有，纯属读了 codegen
   才抓得到。

## 三、MoE 尾：92 层 × 每层 3 个小 kernel = launch 开销的复利

K3 每层 MoE 结尾是同一组小动作：收尾专家输出、加共享专家、8 卡
all-reduce、RMSNorm。每个 kernel 都很小，**launch 开销占比反超计算**，
而且 92 层层层都付。优化三连：

- **四步折进一个集合 kernel**：每 decode 步省 **276 次 kernel launch**
  → **端到端提速 5.9%，为全篇最大单笔收益**——**小 kernel × 高层数
  = launch overhead 的复利，融合尾部是 MoE 模型的必查项**。
- **all-reduce 的 push/pull 切换点按新互联重调**：小批量用 push 式、
  大批量用 pull 式；Vera Rubin 上 push 快直到 256 行，把切换点挪过去 →
  **32 并发 decode 吞吐提升 3.6%（官方口径）**。
- **标量指令换 tensor core**：MoE latent 上投影的 all-gather GEMM，
  profiling 发现时间花在 producer 的标量 FMA 和 warp shuffle 上；改用
  `mma.m16n8k16` 张量核指令（只动了 4 到 8 行）→ **decode 步时间再降
  1.1%（官方口径）**。

## 四、KDA 两连击：barrier 与隐藏拷贝

KDA（Kimi 的线性注意力变体）是新架构，新架构的工程坑也最典型：

- **verify kernel 的 barrier 空等**：原实现每个 CTA 把卷积权重拷进
  smem、再在块级 barrier 等所有人到齐。改成**每个 warp 把权重放自己
  寄存器、warp 内交接、不走 CTA barrier**；先算完的 v warp 顺势用空闲
  时间把输出归一化的门算了。**verify kernel 提速 20%，且输出逐比特不变**。
  **barrier 停顿是 profiler 里最好认的浪费：大量 warp 停在同步点即信号。**
- **gated RMSNorm 的隐藏拷贝**：门控从融合 QKVG 投影的**列切片**取，
  切片不连续，PyTorch 每次调用前**静默拷一份**——2.6 µs × 每步 69 次
  调用。教会 norm kernel 按 stride 直接读门，拷贝消失 → **decode 步
  时间再降 1.8%（官方口径）**。这条和上篇 attention profile 案例的
  「多出来的 Memcpy」是同一族病：**PyTorch 的语义安全默认会用静默拷贝
  满足你，不读 profiler 永远不知道**。

## 五、训练侧：Miles 在 Rubin 上端到端跑 RL

实录的另一半值得单独记住，因为它回答的是「新硬件能不能直接训」：

- **可移植性证据**：SGLang rollout + Megatron 训练的 Miles 栈，单容器
  镜像在 Vera Rubin 端到端跑通；Qwen3-30B-A3B 在 GSM8K（每 rollout
  256 prompt × 8 采样、回复上限 1024 token）**50 个 rollout 奖励从约
  45% 涨到 95%，曲线与 GB300 完全贴合**——新硬件行为级兼容，RL 曲线
  就是验收报告。DeepSeek-V4-Flash（4 层 FP8）的 FP8 训练路径同样全通。
- **agentic RL 的沙盒放 CPU**：NeMo Gym 的 mini-SWE-agent 环境，每
  episode 一个沙盒直接放在托盘的 **Arm 架构 Vera CPU** 上，单 tray
  并发 64 个沙盒，GPU 侧同时 serve + 训练 Qwen3.5-35B-A3B；选
  SWE-bench Verified 的原因是它自带 arm64 任务镜像。结果：奖励稳在
  0.6 附近、episode 平均长度缩 30%、rollout 与训练 KL 紧贴——
  **沙盒与 GPU 解耦到 CPU 托盘，是 agentic RL 成本结构的务实答案**。

## 六、方法论提炼（面试能不能背出这段是区分点）

新硬件代际到手，调优顺序四板斧：

1. **按新上限重新塞满**：smem 227→327 KiB → 流水线加深一档；SM 变了
   → split 数重标定；互联变了 → all-reduce 切换点重调。**硬件换代的
   第一性动作是重标定所有「按上一代调好的常量」。**
2. **合并 launch**：小 kernel × 高层数 = launch 复利（本例 276 次/步）。
3. **消除等待**：barrier 空等换 warp 级交接；合并类 kernel 先发出全部
   读再消费；空闲 warp 顺手干别的活。
4. **清除隐藏拷贝与指令降级**：stride/切片导致的静默拷贝、没开饱和
   转换走的软件慢路径——**这两项只看代码永远发现不了，必须 profiler
   逐 kernel 对账**（方法见 [Attention 的 Profile 实战专题](../attention的profile实战专题.md)）。

而最大的一笔心智转变：官方结语原话「**Vera Rubin 的 327 KiB 和 212 SM
给了新上限，但大部分加速来自把 Blackwell 时代没注意的开销清掉**」——
换硬件最大的收益往往不是新硬件特性，是逼你把旧账翻出来对一遍。

## 七、▶ 面试题与追问

**Q1【高】拿到一款新 GPU，推理引擎侧先做哪几件事？**
报参数（smem/CTA、SM 数、互联带宽、指令集差异）→ 重标定所有按上一代
调好的常量（流水线 stage、split 数、NCCL 切换点）→ profiler 全量对账
找 launch/barrier/隐藏拷贝 → 用一条 RL 曲线或逐比特输出验收。顺序就是
本篇的叙事顺序。

**Q2【高】MLA decode 的瓶颈是什么？围绕它的四个优化各自打哪？**
瓶颈是等 HBM 读 KV。深流水线和 split-KV 先读后算打「读延迟的掩盖」，
split 数标定打「SM 利用率」，饱和转换打「准备 kernel 的指令路径」——
**四个优化没有一个碰 attention 数学本身，全部是访存与调度**。

**Q3【中高】为什么 MoE 模型的尾部融合收益特别大？**
因为 launch 开销是「每层一次 × 层数」的复利：92 层 × 每层 3 个小
kernel，单看每次几微秒，合起来一个 decode 步 276 次 launch。层数越深
的 MoE，尾部融合的优先级越高。

**Q4【中高】profiler 里怎么认出 barrier 浪费？**
大量 warp 停在同步点、kernel 时长远大于其访存/计算应有值、换一种
数据摆放（smem → 寄存器、CTA 级 → warp 级）后能逐比特复现且提速。
本例 20% 的收益全部来自交接粒度的缩小。

**Q5【中】什么是「饱和转换」？为什么不开就慢？**
FP8 转换时溢出值钳到上下限（±448）而非产生 NaN/走异常路径。不开
饱和，编译器无法用 packed 硬件转换指令、退化为软件逐值处理——
准备 kernel 慢 2.5 倍。同类问题问法：dtype 转换、type punning、
fast-math 开关，**凡是「编译器替你选了保守慢路径」的都属此族**。

**Q6【中】agentic RL 的沙盒为什么放 CPU 托盘而不是 GPU 节点？**
沙盒是环境执行（跑测试、起容器），吃 CPU/IO 不吃 GPU 算力；放 GPU
节点会跟 rollout/training 抢资源。数托盘级的并发（单 tray 64 沙盒）
也证明 CPU 侧的密度足够。配套口径：选带 arm64 镜像的评测集，
grading 要预先验证。

**Q7【中】怎么验证新硬件「可以用」而不是「能跑」？**
能跑 = kernel 不报错；可以用 = 数值与训练动力学都可移植。验收三件套：
逐比特输出一致（推理 kernel 级）、RL 奖励曲线与旧硬件贴合（系统级）、
训推 KL 紧贴（框架级）。本篇三条全给了。

## 八、串联阅读

- [MLA 深度穿透专题](../llm基础/mla深度穿透专题.md)：MLA 的 cache 账
  与 decode 访存瓶颈，本篇第二节是它的硬件续集；
- [Attention 的 Profile 实战专题](../attention的profile实战专题.md)：
  读 trace 的方法与「隐藏拷贝」同族案例，本篇第四节的认识论来源；
- [推理引擎 2026 新进展](./推理引擎2026新进展.md)：SGLang 的版本线，
  本篇是其平台层的最新落地事件；
- [推理专用硬件专题](../推理专用硬件专题.md)：Vera Rubin 的硬件全景与
  选型账，本篇是到手后的调优动作；
- [RL 系统训推一体专题](../distributed-training/rl系统训推一体专题.md)：
  Miles 式 rollout+training 同构栈的架构面，本篇第五节是它的新硬件
  验收案例。

## 口径与未核实说明

- 全部收益百分比（16%/20%/1.9%/2.5×/5.9%/3.6%/1.1%/20%/1.8%/30%/45→
  95%）与配置（327 KiB、212 SM、276 次、±448、64 沙盒、knob 例）均为
  LMSYS 官方博客口径，未独立复测。
- 「4.8 倍」是 Cognition 对 Vera Rubin NVL72 vs GB200 NVL72 的集群级
  自报，含规模与软件栈差异，勿引为单卡加速比。
- DeepSeek-V4-Flash 的模型命名以原文为准；「逐比特一致」为其 kernel
  验收口径。
