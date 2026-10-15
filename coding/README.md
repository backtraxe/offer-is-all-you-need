# coding/ 手撕题库

> Live coding 真题的可默写模板。来源与频率见
> [interview-questions/高频面试真题汇总](../interview-questions/高频面试真题汇总.md#七手写代码题live-coding-真题)。
> 理论支撑在 ../interview-questions/ 各模块，练习资源见
> ../resources/学习资源清单.md。

## 目录

### 模型手撕/（算法/Infra 岗重点）

| 文档 | 覆盖真题 | 来源 |
|---|---|---|
| [手写 attention.md](模型手撕/手写attention.md) | PyTorch MHA、numpy attention 前向、KV Cache 增量推理、RoPE、LayerNorm/RMSNorm、GQA 广播 | 字节算法岗/AML 一面 |
| [手写 transformer 组件.md](模型手撕/手写transformer组件.md) | Pre-Norm Block + SwiGLU FFN、简易 MoE、BPE 合并、参数量/显存手算 | 美团、滴滴、通用 |
| [对齐与并行代码.md](模型手撕/对齐与并行代码.md) | LoRA 层、DPO loss、GRPO advantage、TP 行切/列切、ZeRO-3 伪代码 | 阿里深挖、Infra 岗 |
| [手写grpo-loss.md](模型手撕/手写grpo-loss.md) | 完整 GRPO Loss：组内优势→广播→log prob→IS ratio→clip/KL | 滴滴二面 2026-10（新题型） |
| [手写蒸馏kl.md](模型手撕/手写蒸馏kl.md) | 蒸馏 KL + 温度 T² + 硬标签加权、黑盒/跨词表变体 | 字节频次表 22 次 |
| [手写kv显存公式.md](模型手撕/手写kv显存公式.md) | KV Cache 显存五因子公式、GQA/SWA/MLA 变体、TP 切分 | 小米 MiMo 团队 2026-10 |
| [手写投机解码.md](模型手撕/手写投机解码.md) | draft-verify 贪心循环（20 行）、rejection sampling 采样版无损判定、期望加速比口算 | 2026 新题型预备（vLLM/SGLang 主线化后自然现场题） |

### 工程手撕/（应用/Infra 岗重点）

| 文档 | 覆盖真题 | 来源 |
|---|---|---|
| [手写最小 agent.md](工程手撕/手写最小agent.md) | 脱框架最小 ReAct Agent、Function Calling JSON 模式、滑动窗口摘要 | 2026 新高频（应用岗） |
| [cuda 算子手撕.md](工程手撕/cuda算子手撕.md) | RMSNorm / Softmax / Online Softmax / SwiGLU（CUDA + Triton 备选） | 滴滴 AI Infra 一面原题 |
| [通用手撕清单.md](工程手撕/通用手撕清单.md) | LRU、Top-K、链表三件套、DP 选型、岗位备考权重表 | 通用 |

## 使用方法

1. **背骨架不背全文**：每题标注了"白板必须记住的骨架行"，其余现场推。
2. 模型手撕类代码已在真实环境（torch/numpy）运行验证过逻辑；CUDA/Triton 为可默写骨架（无 GPU 验证需求，面试只写思路 + 关键 kernel 结构）。
3. 练完回到对应模块文档，把「▶ 面试题」再过一遍——代码题往往紧接着原理追问。
4. 真机演练资源：LLMs-from-scratch（模型手撕）、nano-vllm（推理引擎）、tiny-universe（组件级），见资源清单。

## 备考权重速查

- **按出现频次刷**：[刷题频次映射表](刷题频次映射表.md)——字节频次表
  与 2026-10 新题型到仓库文件的逐题对照（新题型 GRPO Loss / KV 公式
  命中率爬升中，优先于旧高频）。
- **算法岗**：MHA / TransformerBlock / RoPE / GRPO Loss > 蒸馏 KL / MoE / DPO > 通用算法
- **AI Infra 岗**：CUDA 算子 / KV 显存公式 > TP/ZeRO > MHA
- **应用岗**：最小 Agent / 滑动窗口 > LRU / Top-K / DP 中等题
