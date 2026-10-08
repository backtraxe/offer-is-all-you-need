# 字节 · AI Infra 二面

> 来源：小红书面经帖（二手转述，已脱敏）｜岗位方向：AI Infra（推理优化，2 年社招）｜轮次：二面（手撕压力面）

**一句话特征**：8 道题里 6 道手撕，且每道手撕后必跟定量二连（访存量多少、参数
量多少、推理耗时多少）——字节 Infra 面的标准范式是「写得出 → 算得清」。

## 面试机制（原帖观察，值得单独记）

- **面评连贯**：上一面问过且没答好的问题，这一面很可能被追问；上一面答得好的
  基本不再重复。投字节务必将每轮卡点复盘成清单。
- **压力面节奏**：一面偏简历，二面偏压力——前 7 题 30 分钟（快问快写），第 8 题
  单独给了 30 分钟（深挖）。
- 原帖补充：比较顶的组可能更偏爱攻击性强（敢追问、敢反击）的候选人。

## 考察点

### 模型结构手撕（PyTorch 白板）

1. 手撕 Linear Attention → [手写 Attention](../coding/模型手撕/手写attention.md)
2. 手撕 MoE（router + experts）→ [手写 Attention](../coding/模型手撕/手写attention.md)
3. 手撕 MHA → [手写 Attention](../coding/模型手撕/手写attention.md)
4. 手撕 MLA → [手写 Transformer 组件](../coding/模型手撕/手写transformer组件.md)

### 定量计算（手撕后立刻追问）

5. 上述每个手撕结构的访存量（memory access）各是多少？
6. DeepSeek V3 结构伪代码手撕 + 参数量手算 + 每次推理访存量手算 → [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md)

### 工程手撕

7. 堆排序 → [通用手撕清单](../coding/工程手撕/通用手撕清单.md)
8. 手撕 reduce（CUDA）及优化（占 30 分钟，warp 级 shuffle、多元素每线程、bank
   conflict 等逐层优化）→ [CUDA 算子手撕](../coding/工程手撕/cuda算子手撕.md)

## 结构借鉴

字节 Infra 的答题框架是**手撕 → 定量二连**：

- 写完代码不算完，立刻口算两个数：**访存量**（arithmetric intensity 的分母）与
  **参数量 / 激活量**。平时练习时，每写一个结构都顺手推一遍它读写了几个张量、
  各多大。
- 定量的下一步是落到 Roofline：这个结构在目标卡上是 compute bound 还是
  memory bound → 直接决定了优化方向（参考
  [vLLM 与推理加速核心](../interview-questions/inference/vllm与推理加速核心.md) 的
  计算强度分析）。
- 第 8 题式的「30 分钟单题深压」考察的是优化路径有没有层次：先写出正确 naive
  版，再按「访存合并 → 并行规约 → warp shuffle → 每线程多元素」逐层演进，
  每层说清楚省了什么。
