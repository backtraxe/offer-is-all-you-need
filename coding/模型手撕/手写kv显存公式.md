# 手写 KV Cache 显存公式 + TP 切分（小米 AI Infra 原题 · 默写版）

> 题源：2026-10 小米 AI Infra 基模组一面（MiMo 推理优化团队）——
> 「写出 MHA 的 KV Cache 显存占用公式，再答 TP 下如何切分」。这是推理岗
> 从「背概念」升级到「现场算」的标志性题型：公式写出来只是开场，
> 追问链一路延伸到 GQA/MLA/SWA 变体和部署配置。基础版的参数量/显存
> 手算见 [手写transformer组件](手写transformer组件.md#四参数量--显存手算演练)，
> 本文专攻 KV Cache 的公式化追问。

## 背诵总纲

```text
KV 显存 = 2 × B × S × n_kv_head × d_head × bytes × L
          │   │   │     │           │        │      └ 层数
          │   │   │     │           │        └ 每元素字节数（BF16=2）
          │   │   │     │           └ 每头维度
          │   │   │     └ KV 头数（GQA 后 ≠ q 头数！）
          │   │   └ 序列长度（SWA 时换成窗口 w）
          │   └ batch size
          └ K 和 V 两份
```

骨架必须记住的：**每条链路 5 个乘法因子各是什么含义**、n_kv 与 q 头
的区别、TP 把 n_kv 均分到各卡。可以现场推的部分：具体数字代入。

## 一、公式与现场推演

▶ 真题：写 MHA 的 KV Cache 显存公式 + TP 切分——**新高频**（小米 MiMo 团队 2026-10）

**MHA 基线**：

```text
显存 = 2(K,V) × B × S × H × d_h × p × L
```

**GQA 修正（面试默认问 GQA 模型）**：H 换成 n_kv（KV 头数），q 头数
只影响计算不影响 KV 存储。

```python
def kv_cache_bytes(B, S, n_kv_head, d_head, n_layers, dtype_bytes=2,
                   tp=1):
    per_token_all_layers = 2 * n_kv_head * d_head * dtype_bytes * n_layers
    total = B * S * per_token_all_layers
    return total // tp          # TP 把 KV 头（以及每层）均分到各卡
```

**数字演练 1（7B、GQA-8、32 层、d_head=128、B=16、S=4k、BF16、单卡）**：

```text
每 token 每层 KV = 2 × 8 × 128 × 2 B = 4 KB
每 token 全层   = 4 KB × 32 = 128 KB
B×S = 16 × 4096 = 65536 token → 65536 × 128 KB = 8 GB
```

**数字演练 2（同模型 TP=8）**：每卡 8 GB / 8 = **1 GB**；注意 TP 切的是
n_kv 头——若 n_kv=8、TP=8，每卡恰好 1 个 KV 头，再往上加 TP 就切不开
KV 了（这是 GQA 头数约束 TP 上限的经典追问）。

**数字演练 3（SWA，小米 MiMo 方向）**：滑动窗口 w=1024 时 S 换成
min(S, w)，长序列下 KV 从线性增长变常数封顶——MiMo 团队选 SWA 的
动机就是减 KV 存储和跨卡传输（面经情报）。

**易错点清单：**

- **KV 头数不是 q 头数**——7B GQA-8 的题里写 32 直接错 4 倍。
- **别忘了 ×2（K 和 V），也别漏层数 L**——两个最常见的漏乘。
- 单位意识：每 token 全层 KV 量级（7B ≈ 128 KB、70B ≈ 320 KB）背下来，
  便于现场心算 sanity check。
- TP 切分答出「KV 头均分」之外，补一句「**TP 不能无限加：受 n_kv
  头数下约束**」直接拿追问分。

**面试官常见追问：**

1. **MLA 怎么改这个公式？** 不存完整 KV，存压缩后的 latent（c_t 维度
   d_c ≈ 512-1536，远小于 n_h × d_h），每 token 每层约 2→1 份低维
   向量；再用吸收矩阵在计算时展开。**这就是 DeepSeek 把 KV 砍一个
   数量级的核心**——对照
   [注意力变体2026专题](../../interview-questions/inference/注意力变体2026专题.md)。
2. **什么时候 KV 比权重还贵？** B×S 线性涨、权重固定：长上下文 /
   大 batch 场景 KV 反超权重；给 80G 卡现场算「最大可服务 B×S」。
3. **prefix cache / radix tree 省的是什么？** 共享前缀的 KV 只存一份，
   多租户相同 system prompt 下显存和 prefill 计算双省——对照
   [长上下文推理与kv体系](../../interview-questions/inference/长上下文推理与kv体系.md)。
4. **多级缓存（HiCache 式）的收益条件？** G2→G1 加载时间 < 命中部分
   重新 prefill 的时间才值得 offload（小米面经口径）。
5. **量化 KV（KV int8/fp8）的影响？** bytes 因子减半/再减半，但要答
   精度损失与逐 token/逐通道 scale 的取舍——对照
   [kv量化与压缩专题](../../interview-questions/inference/kv量化与压缩专题.md)。

## 二、现场提速版

```python
# 一行公式 + 一句切分
kv = 2 * B * S * n_kv * d_head * n_layers * 2  # bytes, BF16
per_gpu = kv // tp                              # TP 均分 KV 头
```

## 三、串联阅读

- 全套显存口径（权重/激活/推理/训练）：[显存计算专题](../../interview-questions/显存计算专题.md)
- PagedAttention 与 KV block 管理：[vllm与推理加速核心](../../interview-questions/inference/vllm与推理加速核心.md)
- KV offload 与分层存储：[kv-offload与分层存储专题](../../interview-questions/inference/kv-offload与分层存储专题.md)
