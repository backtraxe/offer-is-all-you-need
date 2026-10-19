# 从零实现推理引擎：一步一步写出 mini-vLLM

> **面向**：用过 vLLM / SGLang，但一被问「调度器里到底发生了什么」就卡住
> 的读者；也适合想做一个「能撑 20 分钟追问」的推理 infra 主项目的人。
>
> **读完你会得到**：一条从 `while` 循环到连续批处理、PagedAttention、
> 前缀缓存、采样与 CUDA Graph 的实现路线；每章都有可运行代码、手算公式、
> 架构图和验收标准。不是复刻 vLLM 的全部功能，而是把**最关键的 20%**
> 自己写一遍。
>
> **参考实现**：[nano-vllm](https://github.com/GeeeekExplorer/nano-vllm)
> （约 1200 行，适合先读骨架）、
> [mini-sglang](https://github.com/sgl-project/mini-sglang)（官方 mini 版，
> RadixCache / chunked prefill 更完整）、
> [tiny-llm](https://github.com/skyzh/tiny-llm)（课程驱动，覆盖最全）。
> 本系列不复制它们的代码，而是用「先写最笨版本，再逐步加机制」的方式
> 把设计动机讲透。

## 一、我们要造什么

一个叫 **MiniEngine** 的推理引擎，从 v0 到 v5，每版只加一个机制：

| 版本 | 新增能力 | 解决什么问题 | 对应章节 |
|---|---|---|---|
| v0 | 单请求 `while` 循环 | 先把「生成」跑通 | 01 |
| v1 | KV Cache + prefill/decode 分离 | 不重复算 prefix | 02 |
| v2 | 连续批处理 + 调度器 | GPU 不等单个请求 | 03 |
| v3 | PagedAttention + BlockManager | KV 显存不碎片 | 04 |
| v4 | 前缀缓存 + 采样/停止条件 | 多轮/agent 复用，输出可控 | 05–06 |
| v5 | CUDA Graph / TP / benchmark | 压 launch 开销，多卡扩展 | 07–08 |

> 一句话主线：**推理引擎不是「更快的模型」，而是「让 GPU 一直有活干、
> 让显存一直够用」的调度与内存系统。**

## 二、路线图

| 章 | 标题 | 核心问题 | 代码 | 验收 |
|---|---|---|---|---|
| 01 | [最小引擎循环](./01-最小引擎循环.md) | 一次只生成一个 token，为什么慢 | `code/mini_engine_v0.py` | 跑通 3 个请求，能解释 `tokens_seen` 为什么是 O(T²) |
| 02 | KV Cache 与 prefill/decode | 哪些计算可以只做一次 | `code/mini_engine_v1.py` | 输出与 v0 一致，`tokens_seen` 从 O(T²) 降到 O(T) |
| 03 | 连续批处理与调度器 | 多个请求怎么拼成 batch | `code/mini_engine_v2.py` | 同一 workload 吞吐明显高于 v1 |
| 04 | PagedAttention 与 BlockManager | KV 显存怎么分配/回收/共享 | `code/block_manager.py` | 无泄漏、能前缀共享、碎片可控 |
| 05 | 前缀缓存与 RadixCache | 多轮/agent 为什么能复用 | `code/prefix_cache.py` | 命中率与 TTFT 有可解释变化 |
| 06 | 采样与停止条件 | temperature/top-k/top-p/stop | `code/sampling.py` | 单测覆盖 greedy/采样/停止 |
| 07 | CUDA Graph 与性能优化 | launch 开销怎么藏 | `code/graph_runner.py` | 小模型 decode 延迟下降 |
| 08 | TP、benchmark 与项目包装 | 多卡与面试叙事 | `code/bench.py` | 一份可复现的 benchmark 报告 |

> 前 4 章只依赖 `numpy`，本机就能跑；第 5 章起可选装
> `torch` / `transformers`，把 ToyModel 换成 Qwen2.5-0.5B 之类的小模型。
> 没有 GPU 也能学完调度与内存管理——这正是引擎最值钱的部分。

## 三、三条学习原则

1. **先跑通，再优化。** 每章先给一个「笨但正确」的版本，再用数字证明
   它慢在哪；不要一上来就抄 PagedAttention。
2. **公式必须能手算。** KV 显存、吞吐、TTFT/TPOT、batch 上限，都要能
   用纸笔估出量级；面试官追问的是「为什么是这个数」。
3. **每章一个可验证指标。** 不只看代码「能跑」，还要看 `tokens_seen`、
   显存、吞吐、TTFT 的变化；没有对照就没有优化。

## 四、参考实现怎么用

- **nano-vllm**：先看 `engine/` 主循环与 `core/` BlockManager，建立
  「engine → scheduler → model runner → sampler」的模块图；再回来看
  本系列的 v2/v3 对应关系。
- **mini-sglang**：重点看 `radix_cache.py` 与 chunked prefill；本系列
  第 5 章会用一个简化 RadixTree 复现「前缀共享 + 驱逐」。
- **tiny-llm**：课程覆盖最全，适合作为 12 周主线的目录；本系列更像
  「把关键机制手写一遍」的短训营。

仓内先修：

- [推理引擎实战](../推理引擎实战.md)：nano-vllm / mini-sglang / tiny-llm
  的选型与面试追问预演。
- [vLLM 与推理加速核心](../../interview-questions/inference/vllm与推理加速核心.md)：
  PagedAttention / Continuous Batching 的原理版。
- [源码学习路线图](../../interview-questions/inference/源码解读/源码学习路线图.md)：
  读完本系列后怎么进真源码。

## 五、指标口径

| 指标 | 定义 | 为什么重要 |
|---|---|---|
| **TTFT** | 从请求进来到第一个 token 输出 | 决定「首字快不快」，prefill 主导 |
| **TPOT / ITL** | 相邻输出 token 的时间间隔 | 决定「打字机流不流畅」，decode 主导 |
| **吞吐** | 每秒输出 token 数（tok/s） | 决定单位成本，batch 主导 |
| **显存占用** | 权重 + KV Cache + 中间激活 | 决定能放多少并发、多长上下文 |

公式先放在这里，后面每章都会用：

```text
吞吐 = 输出 token 总数 / 墙钟时间
TTFT ≈ prefill 时间 + 排队时间 + 首 token 采样时间
TPOT ≈ decode 单步时间（batch 内所有请求共享）
```

## 六、章节目录

- [01 最小引擎循环：一次只生成一个 token](./01-最小引擎循环.md)
- [02 KV Cache 与 prefill/decode](./02-kv-cache与prefill-decode.md)
- 03 连续批处理与调度器（待写）
- 04 PagedAttention 与 BlockManager（待写）
- 05 前缀缓存与 RadixCache（待写）
- 06 采样与停止条件（待写）
- 07 CUDA Graph 与性能优化（待写）
- 08 TP、benchmark 与项目包装（待写）

## 七、代码目录

```text
projects/从零实现推理引擎/
├── README.md
├── 01-最小引擎循环.md
└── code/
    ├── mini_engine_v0.py
    └── mini_engine_v1.py
```

> 代码只依赖 `numpy`；每个文件都可以单独运行：
> `python3 code/mini_engine_v0.py`。

## 八、写作与口径说明

- ToyModel 是**确定性 bigram 模型**，只用于验证引擎循环，不代表真实
  模型质量；第 2 章会把它替换成带 KV Cache 的小 Transformer 接口。
- 文中所有延迟/吞吐数字都是**本机 toy 口径**，用于展示趋势，不是 GPU
  实测；真实模型请按第 8 章的 benchmark 方法复测。
- 与 nano-vllm / mini-sglang 的对应关系会逐章标注；不复制其代码，
  只对照设计。
