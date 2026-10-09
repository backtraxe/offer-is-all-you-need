# LLM 基础（模块导航）

> 整个考点的地基，三类岗位（算法 / 应用 / Infra）的公共必答区。Top 20 高频题里
> 有 5 道来自本模块：Transformer 架构、KV Cache、RoPE、MHA→MLA 演进、手撕 MHA。
> 回 [考点地图](../README.md) · 题目全集 [高频面试真题汇总](../高频面试真题汇总.md)

## 本模块文档

| 文档 | 覆盖主题 | 核心面试题 |
|---|---|---|
| [Transformer 与 Attention](./transformer与attention.md) | Self-Attention 公式与 √d 缩放、MHA 结构、MHA→MQA→GQA→MLA 演进、KV Cache 显存估算（7B/13B/70B 数字）、FlashAttention | "Transformer 架构讲一遍" "**为什么除以 √d**" "MHA→MLA 每一步省什么" "KV Cache 显存怎么算" |
| [位置编码、Norm 与 Tokenizer](./位置编码与norm.md) | 绝对/相对位置编码、RoPE 原理与长上下文扩展（NTK/YaRN）、ALiBi、Pre-Norm vs Post-Norm、LayerNorm vs RMSNorm、BPE 与 token 估算 | "RoPE 原理" "为什么大模型用 RMSNorm" "BPE 是怎么训练的" |
| [MoE 架构与专家并行](./moe架构.md) | 稀疏激活与等效激活参数、Switch→GShard→DeepSeek V2/V3→Qwen3 演进、辅助 loss vs aux-loss-free bias、EP 并行与 all-to-all、DeepEP 双内核与 EPLB | "MoE 相比 Dense 的优势" "负载均衡怎么做" "EP 的 all-to-all 为什么是瓶颈" |

<div class="diagram-embed">
<iframe src="assets/diagrams/llm-map.html" width="100%" height="820" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/llm-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 必考计算题速查（背下来直接口算）

这是字节/滴滴等公司开场就出的一组题，公式不难，难在 30 秒内算对。均按
LLaMA 类 Decoder-only 架构（忽略 bias）。

### 1. 参数量估算

```text
每层：Attention(4d²) + SwiGLU-FFN(3·d·d_ff ≈ 8d²) ≈ 12d²
全模型：N ≈ L · 12d² + V · d      （embedding 共享时一份，不共享 ×2）

例：LLaMA-2-7B：L=32, d=4096, V=32000
  → 32 × 12 × 4096² ≈ 6.44B + embedding ≈ 6.7B ✓
例：13B：L=40, d=5120 → 40 × 12 × 5120² ≈ 12.6B ✓
```

### 2. 推理权重显存

```text
FP16/BF16：N × 2 字节     → 7B ≈ 14 GB，13B ≈ 26 GB，70B ≈ 140 GB
INT8：N × 1 字节          → 7B ≈ 7 GB
INT4：N × 0.5 字节        → 7B ≈ 3.5 GB
```

### 3. KV Cache 显存（本模块最硬的计算题）

```text
每 token：2 × L × n_kv × d_head × bytes
总量：每 token × 上下文长度 × batch size
（n_kv = K/V 头数；MHA 时 n_kv×d_head = d_model；GQA 时用组数）

例（BF16, batch=1）：
  7B  (L=32, MHA-32×128)：0.5 MB/token  → 4K ≈ 2 GB， 8K ≈ 4 GB
  13B (L=40, MHA-40×128)：0.78 MB/token → 4K ≈ 3.2 GB
  70B (L=80, GQA-8×128)： 0.31 MB/token → 4K ≈ 1.25 GB
  └─ 注意 70B 是 GQA 反而比 13B 省，这就是"[n_kv] 换成 g"的意义
推理总显存 ≈ 权重 + KV Cache + 10%~20% 余量
```

### 4. 训练显存（延伸阅读，详见分布式训练模块）

```text
AdamW + 混合精度：每参数 16 字节
  = BF16 权重(2) + BF16 梯度(2) + FP32 主权重(4) + m(4) + v(4)
→ 7B 全参训练 ≈ 112 GB（未含激活）→ 单卡放不下，必须 ZeRO/3D 并行
```

### 5. Attention 计算量与 FLOPs

```text
QK^T：2·n²·d  FLOPs，softmax(×V)：2·n²·d → attention 主体 ≈ 4·n²·d
前向每层总 FLOPs ≈ 2 × 每参数FLOPs × 参数量（≈24·n·d² 项，小 n 时线性项主导）
情形判断：小 batch 短上下文 decode 是 memory-bound；
          prefill / 大 batch 是 compute-bound
```

### 6. Token 数估算（应用岗）

```text
英文：1 token ≈ ¾ 词 ≈ 4 字符
中文：汉字 × 1.5（LLaMA 系上限）或 ×0.7~1（Qwen/Yi 中文优化）
预算习惯：理论值 +20% 余量（prompt 模板、工具结果、JSON 都占 token）
```

## 配套练习

- 手撕题指引与各题频率：见
  [高频面试真题汇总 - 手写代码题](../高频面试真题汇总.md#七手写代码题live-coding-真题)
  （手撕 MHA、numpy attention、RoPE、CUDA RMSNorm 都是本模块考点）；
- 代码实现目录：[coding/](../../coding/)（随本仓库持续补充）；
- 学完本模块后顺序推进：[训练与对齐](../训练与对齐/) 或
  [推理部署](../inference/)（KV Cache/vLLM 会接着用这里的显存公式）。
