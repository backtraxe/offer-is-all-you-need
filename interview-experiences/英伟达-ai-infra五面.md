# 英伟达 · AI Infra 五面

> 来源：小红书面经帖（二手转述，已脱敏）｜岗位方向：AI Infra（推理优化）｜轮次：五面（技术面全程）

**一句话特征**：原帖原话「面到力竭但整体体验挺好，问题非常专业」——几乎没有纯八股
复述题。每道题先让你给通用结论，面试官立刻叠加场景约束（Agent 长 prefix、MLA 大
KV、固定单卡 batch=16），追问结论在这个场景下怎么改、何时失效，覆盖推理优化、
硬件 CUDA、C++、数学、算法五个桶。

## 考察点

### AI Infra 推理优化

- Roofline 分析：算 Matmul 的最佳输入大小；算 MoE TopK 的最佳 token 数 → [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md)
- FlashAttention 原理及实现；FlashDecoding 是什么 → [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md)
- PrefixCache 的作用？与 KVCache 的区别？怎么实现？→ [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md)
- Chunk Prefill 在 MLA 中，KV 很大导致激活值很大，怎么办？
- Agent 场景下 KVCache 空间不够，怎么优化？
- PD 分离在 Agent 长 prefix 场景下是不是一定好？→ [设计分布式推理服务](../system-design/设计分布式推理服务.md)
- Context Parallelism 中 AG KV 与 AG Q 怎么选？
- Decode 阶段长输出的负载均衡怎么做？
- 大 EP 多大合适？（约束：固定单卡 batch=16，以 DeepSeek 为例）
- PD 配比与 Decode batch 的关系？如何由 Decode 反推 Prefill 资源？
- MoE All-to-All 通信量怎么算？→ [三维并行](../interview-questions/distributed-training/三维并行.md)
- 4 台机器全连接、内存放 N² 矩阵乘并行，每台缓存 N²/8 时给出方案

### 硬件与 CUDA

- MHA / MQA / GQA / MLA 对算子计算访存比的影响？→ [Transformer 与 Attention](../interview-questions/llm基础/transformer与attention.md)
- 算子优化方法有哪些？→ [CUDA 算子手撕](../coding/工程手撕/cuda算子手撕.md)
- 算子输出随机（不确定）是什么原因？（面试官引导：AtomicAdd 浮点累加顺序）
- GPU memory 有哪些种类？
- 两个进程访问同一个 Global Memory 地址，是同一个虚拟地址吗？
- Kernel 的常量参数放在哪块存储里？
- 单核上两个线程，什么情况下比单线程执行时间更短？

### C++

- `const int *A` 和 `int const *B` 有什么区别？
- 指向常量的指针，交换两个指针会发生什么？
- 深拷贝与浅拷贝的区别？手写深拷贝构造函数。
- 有虚函数的继承类，`sizeof` 是多少？
- 不用额外空间交换两个 int。

### 数学

- FP32 怎么表示 9.9e9 − 1e−9？（浮点精度与吞小数问题）
- 汽水换瓶：经典数学换瓶题（多少瓶汽水最多能喝几瓶）

### 算法手撕

- 排序二叉树中替换一个同分节点
- copyRandomList（LC 138，深拷贝带随机指针的链表）
- 1~N 个任务的调度，最少需要多少核？
- LC 2712 原题
- 类 LC 1383：最大化 `sum(speed) × min(reliability)`
- 数字字符串中插入加号使求和满足条件

## 结构借鉴

本篇面经是**场景限定追问法**的样本库，答题节奏固定为三步：

1. **通用结论**：先把教科书答案干净给出（如「PrefixCache 复用公共前缀的 KV」）。
2. **场景约束**：面试官加约束（Agent 长 prefix、MLA、固定 batch），你立刻重算
   结论——准备时每道八股都自备 2-3 个典型场景的变体答案。
3. **何时失效**：主动补一句该结论的失效边界（如「PD 分离在长 prefix 且 Agent
   会话复用率高时，分离的收益可能被 KV 传输吃掉」）。「一定好 / 一定不好」是
   这套面试里最危险的表述。

五桶混合出现的另一层信号：Infra 岗的 C++ / 数学 / 算法不是走过场，浮点精度
（9.9e9 − 1e−9）这类题和 CUDA 的 AtomicAdd 不确定性其实是一条线——都考
「数值非确定性从哪来」。
