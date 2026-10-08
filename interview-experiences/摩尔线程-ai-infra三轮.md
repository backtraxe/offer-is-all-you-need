# 摩尔线程 · AI Infra 三轮

> 来源：小红书面经帖（二手转述，已脱敏）｜岗位方向：AI Infra（集群 / 训练平台）｜轮次：三轮技术面（含架构管理面）

**一句话特征**：全程无手撕，三轮问的全是实打实的集群、通信、调度坑——「不是背
八股就能糊弄的」；面评硬指标是**真实排障实例**，光讲原理容易被反问住。原帖自评：
部分中间件问题往 AI 场景靠有点牵强，但在考察迁移能力；MUSA、MCCL 问得很细，
没踩过坑大概率露怯。

## 一面：中间件迁移能力 + 训练框架基础

- Redis 做训练元数据缓存的设计？
- MySQL 隔离级别？分布式任务状态的一致性怎么保证？
- ES 集群做训练日志检索的方案？
- Kafka 解耦预处理与训练的链路怎么搭？
- RocketMQ 事务消息在任务下发场景怎么用？
- TP / PP / DP 的区别与选型？→ [三维并行](../interview-questions/distributed-training/三维并行.md)
- ZeRO 各阶段分别省多少显存、通信开销多少？→ [ZeRO 与显存优化](../interview-questions/distributed-training/zero与显存优化.md)
- Megatron Column Parallel / Row Parallel 怎么切？
- Ring AllReduce vs Tree AllReduce？→ [三维并行](../interview-questions/distributed-training/三维并行.md)
- RDMA / RoCE vs InfiniBand？
- GPU 拓扑感知调度（NVLink / PCIe），在 K8s 上的难点？
- FP16 vs BF16？Loss Scale 怎么做？→ [训练框架与稳定性](../interview-questions/distributed-training/训练框架与稳定性.md)
- 算子融合的访存分析？

## 二面：千卡基建实战 + 排障实例（重头戏）

- 千卡基建经历深挖（面试官要求讲出真实数字和坑）
- Gang Scheduling 怎么解决 Pod 死锁与资源碎片？
- Volcano vs Kueue 怎么选？
- 节点故障时的 Checkpoint 机制？异步 Checkpoint 怎么做？→ [训练框架与稳定性](../interview-questions/distributed-training/训练框架与稳定性.md)
- 集合通信带宽不及预期怎么排障？（网卡绑定 / NUMA / QP 数 / `MCCL_DEBUG` 日志）
- PagedAttention 与显存碎片问题？→ [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md)
- INT8 / W4A16 量化？极端分布（min 到 −10000）时量化策略怎么定？→ [量化与压缩](../interview-questions/inference/量化与压缩.md)
- Speculative Decoding 与量化结合的挑战？
- 对象存储 + Ceph vs Lustre / GPFS？
- Redis 大 key / 热 key 怎么处理？
- Kafka 消费堆积怎么定位？
- ES segment 层级的调优？
- MUSA / CUDA 代码移植的坑？
- GPU 监控体系（DCGM + Prometheus）怎么落地？

## 三面：架构与团队管理

- 设计一个多租户千卡训练平台？
- 自研调度器 vs 用开源，技术债怎么权衡？
- 选型有分歧时怎么说服团队？（实例：JuiceFS / Alluxio / Lustre 之争）
- 集群 SLA 怎么定？灰度、熔断、故障演练怎么设计？
- 跨地域训练怎么做？
- 用 K8s Operator / CRD 管理训练任务生命周期的设计？
- 国产芯片的显存隔离怎么做？（MIG / cGPU）
- MUSA 新特性 vs CUDA 生态，怎么跟、跟到什么程度？
- 对 Serverless 推理 / 异构调度 / FP8 这类技术方向怎么看？
- 学习新技术的路径是什么？
- 技术分享怎么准备？

## 结构借鉴

本篇可沉淀两个答题框架：

**① 排障路径清单**（答一切「XX 不高 / XX 失败怎么查」）：

1. **现象**：先量化——带宽实测多少、理论多少、占比多少；
2. **分层假设**：按栈列嫌疑层（应用配置 → 集合通信库 → 网卡/驱动 → 网络/拓扑）；
3. **逐层验证**：每层给对应工具与指标（`MCCL_DEBUG` 日志、perftest、网卡绑定 /
   NUMA 亲和、QP 数）；
4. **指标收口**：修复后回到哪个指标、多少提升。

**② 选型对比矩阵**（答一切「A vs B 怎么选」）：固定对比轴——性能（吞吐/延迟）、
生态成熟度、运维成本、迁移成本、团队熟悉度；三面级的答案还要加一行
**决策机制**（分歧时怎么收敛：POC 数据说话，而不是职位说话）。
