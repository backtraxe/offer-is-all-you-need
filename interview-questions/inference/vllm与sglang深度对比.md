# vLLM vs SGLang 深度对比：同源分岔的两种引擎哲学

> 本篇面向已经知道**单个引擎**怎么工作的读者——如果你还没读过
> 两个源码全链路专题，建议先扫一眼各自的全景图再回来：
> [vLLM 请求全链路](./源码解读/vllm请求全链路.md)、
> [SGLang 请求全链路](./源码解读/sglang请求全链路.md)。
> 本文不做「功能清单对比」（那种表网上到处是），而是从**源码级架构证据**出发，
> 回答四个真问题：两个引擎在设计哲学上差在哪、哪些差异会在压测数字上显形、
> 按业务流量特征怎么选、以及面试怎么把对比答出段位。
> 版本口径：两个 main 分支均 2026-10 现场核实（vLLM V1 架构 / SGLang v0.5.x）。

## 一、一句话定性：同一个起点的两次分流

两个引擎共享同一套地基：**continuous batching、PagedAttention 式 KV 分页、
CUDA Graph、ZMQ 多进程、OpenAI 兼容 API**。分岔发生在地基之上的三个选择：

| 选择点 | vLLM 的答案 | SGLang 的答案 |
|---|---|---|
| **CPU 杂活放哪** | API 进程全包（tokenize/detokenize/HTTP），EngineCore 只做调度+执行 | 再拆一刀：Tokenizer / Scheduler / Detokenizer 三进程流水线 |
| **前缀复用怎么做** | 块哈希 APC：block 对齐（16 token）的哈希链，实现简单 | Radix Tree：任意长度前缀 + 中段分裂，命中粒度细一个量级 |
| **差异化押注** | 生态与模块化：V1 全重构、组件边界最干净、社区最大 | 生成结构：RadixAttention + 结构化生成（xgrammar）+ cache-aware 调度 |

一句话：**vLLM 把「成为一个好平台」做到极致，SGLang 把「为高前缀复用
流量做引擎」做到极致。**

## 二、进程架构：两刀 vs 三刀

<div class="diagram-embed">
<iframe src="assets/diagrams/vllm-vs-sglang.html" width="100%" height="560" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/vllm-vs-sglang.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

两家都为**躲 GIL** 而拆进程，但刀数不同：

```text
vLLM V1（两刀）
  API server 进程（asyncio：HTTP + tokenize + detokenize + SSE）
    │ ZMQ（EngineCoreRequest / EngineCoreOutputs，token ids）
  EngineCore 进程（busy loop：schedule() → execute）
    │ NCCL / shm
  Worker 进程 ×TP rank（.gpu_model_runner 纯前向）

SGLang（三刀）
  HTTP + TokenizerManager 进程（rid_to_state 状态机）
    │ ZMQ PUSH/PULL
  Scheduler 进程（event_loop + ModelWorker 同进程！）
    │ ZMQ
  DetokenizerManager 进程（DecodeStatus 增量解码）
```

| 维度 | vLLM V1 | SGLang |
|---|---|---|
| 调度与 worker | 同进 EngineCore 进程，TP 才拆 Worker | **ModelWorker 就住在 Scheduler 进程里**，调度到前向零 IPC |
| detokenize 位置 | API 进程内（`OutputProcessor`） | **独立进程**（增量解码，多字节字符靠 `sent_offset` 游标） |
| 调度循环 | `EngineCore.step()` 单循环 | `event_loop_normal` / `event_loop_overlap` **双批流水**（CPU 收尾压到下一批 GPU forward 底下） |
| API 层水平扩展 | 支持：`client_count` 多 API server 共用一个 EngineCore | FastAPI 与 TokenizerManager 同进程 asyncio，水平扩展靠外层网关 |
| 状态载体 | `request_id` + 输出队列 | `rid_to_state: Dict[str, ReqState]` 显式 asyncio 状态机 |

**面试论点**：SGLang 的「Worker 住进 Scheduler 进程」和 vLLM 的
「EngineCore 只管调度」谁更好？看负载：调度本身轻（纯 Python 决策）
时同进程省去一次序列化；但调度逻辑变重（cache-aware 排序、优先级
抢占）时，vLLM 的彻底隔离更能保住 GPU 心跳。**SGLang 用
`event_loop_overlap` 双批流水来还这笔债**——这是它答案的巧妙之处，
也是面试能展开的点。

## 三、前缀缓存：块哈希 vs Radix Tree（核心分岔）

这是两个引擎**最本质**的技术差异，直接决定命中粒度：

| 维度 | vLLM APC（Automatic Prefix Caching） | SGLang RadixAttention |
|---|---|---|
| 数据结构 | 块哈希链：`hash(block_tokens)` → block id | Radix Tree：token 序列的压缩前缀树（`RadixCache`） |
| 命中粒度 | **block 对齐**（默认 16 token）：不满一块的前缀尾巴作废 | **token 级**：`match_prefix()` 命中到树中段时**当场分裂节点** |
| 驱逐策略 | LRU + 引用计数，按 block | 按 `last_access_time` 从叶子逐出，**lock_ref 保护在用路径** |
| 多轮/分支复用 | 只有完整共享 block 才复用 | 共享任意长度的公共路径，树杈天然表达分叉 |
| 调度联动 | 无（命中是被动发生的） | **CacheAwarePolicy 主动把同前缀请求聚批 prefill**（LPM/DFS_WEIGHT） |

```text
一个 1000-token system prompt + 37-token 用户问题：
vLLM APC：  复用 floor(1000/16)×16 = 992 token，尾巴 8 token 重算
SGLang：    复用全部 1000 token（match_prefix 精确分裂）
```

单条请求差别是 8 个 token；但 **Agent 场景下差别被放大**：
多轮历史是「同一路径的延长」、多采样/ToT 是「同前缀分叉」，
树形结构把这类流量的复用率拉满，而块哈希在不对齐的边界上每次都丢一点。

**反过来 vLLM 的块哈希赢在哪**：实现和数据结构简单得多——
没有树的分裂/合并/锁引用，hash 查表 O(1)，在「前缀复用率本身不高」
的流量（单轮问答、独立请求）下开销更小、边界情况更少。
选型时先问自己：**我的流量里，前缀共享是主食还是点心？**

## 四、调度策略：被动 FIFO vs 主动 cache-aware

两家都是 continuous batching（每 iteration 重排 batch），但**拣选
waiting 请求的策略**分道了：

- **vLLM**：基本是 FCFS + 优先级，简单可预期；
- **SGLang**：`schedule_policy.py` 一整套 `CacheAwarePolicy`——
  `LPM`（命中最多的先来）、`DFS_WEIGHT`（树深加权）、
  `HRRN`（token 级 aging 防饿死）、`SHORTEST_PREFILL_FIRST`，
  外加 `CacheAgnosticPolicy`（FCFS/LOF/RANDOM/ROUTING_KEY）。

SGLang 为「踢回去会不会饿死」专门配了答案：retraction（decode 显存
不足把请求踢回 waiting 队首）+ HRRN aging 优先重准入 + PD 分离下
decode 端独有的 retraction backup（先备份 KV 再踢，因为 decode 侧
没有原始 prompt 可重算）。**这套「retract + aging + backup」是
SGLang 调度层被低估的精细度**；vLLM 对应的答案是 preempt + 重算
/SWAP，机制更直白。

## 五、其他关键差异速览

| 维度 | vLLM | SGLang |
|---|---|---|
| 结构化生成 | 支持（xgrammar 后端） | **起家本领**：constrained decoding + regex/JSON schema，RadixCache 还能缓存 FSM 状态 |
| 投机采样 | MTP/EAGLE/draft-model 谱系全 | EAGLE 家族专项目录（`speculative/eagle_worker_v2`） |
| Attention backend | FlashAttention/FlashInfer/MLA 等可切 | 同样策略模式多 backend（FA/FlashInfer/Triton/FlashMLA） |
| PD 分离 | 支持（NIXL/mooncake 等 KV 传输） | 支持（`disaggregation/` 双 Scheduler mixin，decode 端 retraction 特护） |
| 量化路径 | GPTQ/AWQ/FP8/INT4 全家 | 同样全家，社区落地略晚 |
| LoRA 多租户 | 支持 | 支持（extra_key 隔离不同 adapter 的树命名空间，设计更原生） |
| 生态/模型跟进 | **最快**：社区最大，新模型周级支持 | 快但小一圈；复杂生成场景往往功能先到 |
| Debug/可观测 | V1 组件边界干净，metrics 成熟 | 组件少而内聚，日志直接 |

## 六、选型决策树（按流量特征，不按信仰）

```text
你的流量长什么样？
├─ 单轮为主、请求独立、prompt 短
│    → vLLM（块哈希开销小，生态兜底，出问题搜得到人）
├─ 多轮对话 / Agent / 长 system prompt / 工具定义复用
│    → SGLang（Radix + cache-aware 调度就是为此造的）
├─ 结构化输出是主线（JSON mode、表单抽取、DSL 生成）
│    → SGLang（结构化生成是它的护城河）
├─ 多采样分叉（n>1 采样、best-of-N、tree-of-thought、RL rollout）
│    → SGLang（树杈分叉复用公共前缀，rollout 成本显著低）
├─ 快速跟进新模型 + 需要最成熟的生产案例
│    → vLLM（事实标准的另一边：文档、issue、集成最厚）
└─ 都要 / 拿不准
     → 先 vLLM 上线，把「前缀命中率」做成观测指标；
       命中率持续高且 TTFT 成为瓶颈时灰度 SGLang
```

**最诚实的答案**：两家在内核相关性（同一批 kernel、同一种 batching）
远大于差异性——差距不在「能不能跑」，在**同一瓦特下谁的排队更短**。
所以压测要用**自己的流量分布**做，公开 benchmark 大多用的是
独立请求流，会系统性低估 SGLang 的树形优势。

## 七、▶ 面试挂钩

**问题 1：vLLM 和 SGLang 的本质区别？（高频原题）60 秒标准答**
「同一个 continuous batching + 分页 KV 的地基上两次分流。
V1 之后 vLLM 的差异化是把模块边界做到最干净——
API 进程 / EngineCore / Worker 三层，调度单点保序，API 侧可多开；
SGLang 是把高前缀复用流量做到极致——Radix Tree 做 token 级前缀命中
（vLLM APC 只有 block 对齐 16 token 粒度），cache-aware 调度把同前缀
请求聚批，加结构化生成这个护城河。所以 Agent/多轮/多采样场景
SGLang 吞吐领先明显；通用 API 服务和新模型跟进速度选 vLLM。
我两个引擎的 main 分支都读过——SGLang 的 `radix_cache.py` 五件套
和 vLLM 的 `kv_cache_manager` 块哈希可以直接对着讲。」

**问题 2：为什么 SGLang 在 Agent 场景吞吐更高？**
「三层叠加：一，Radix Tree 让多轮历史=已缓存路径的延长，
每轮只算增量；二，CacheAwarePolicy 把同前缀请求聚到一批 prefill，
批内又复用一次；三，多分支 rollout 在树上是天然分叉，
公共段只算一遍。vLLM 的块哈希前两点做不到这么细，
第三点完全做不到——block 边界不对齐就得重算。」

**问题 3：SGLang 把 detokenizer 单列一个进程值得吗？**
「它的负载值得：detokenize 是 CPU 密集且高吞吐下吃好几个百分点的
CPU，还要做多字节字符的增量拼接（`DecodeStatus` 游标），
放进调度进程就是拿 GPU 心跳换字符串活。代价是多一跳 ZMQ；
SGLang 用 PUSH/PULL 管道的天然排队消化抖动。vLLM 的判断相反——
detokenize 留在 API 进程内，靠 API 多开来水平消化。
两家在『CPU 杂活怎么躲 GIL』上殊途，同归。」

**问题 4：两套引擎怎么评估迁移成本？**
「API 层都是 OpenAI 兼容，业务代码零改动；真正的成本在三处：
一是行为差异（流式 chunk 粒度、错误语义、stop 细节），要靠
影子流量对比；二是特性依赖（如果业务用了 SGLang 的 FSM 约束生成，
回 vLLM 要找等价配置）；三是运维肌肉（metrics、告警、压测管线
重来一遍）。所以决策依据不要是 benchmark 截图，是自己流量的
前缀命中率和 TTFT/TPOT 分位数。」

**问题 5：两个引擎的调度都有「回退」，差异在哪？**
「vLLM 是 preempt：显存紧张时抢占后到请求，KV 重算或 swap 出。
SGLang 是 retraction + 保护：踢回 waiting 队首，HRRN aging 保证
重准入防饿死，lock_ref 保证 running 请求的 KV 不会被自家驱逐，
PD 分离下 decode 侧踢前还要先备份 KV——因为没有 prompt 可重算。
同样一件事，SGLang 的老人保护做得更细，这与它面向多轮长会话
流量的定位一致。」

## 八、延伸阅读（仓内）

- 源码证据：
  [源码解读/vllm请求全链路.md](./源码解读/vllm请求全链路.md) 与
  [源码解读/sglang请求全链路.md](./源码解读/sglang请求全链路.md)——
  本文所有「文件 + 函数」级论述的出处。
- 原理内功：[vllm与推理加速核心.md](./vllm与推理加速核心.md)
  （PagedAttention/CB/投机/量化）、[长上下文推理与kv体系.md](./长上下文推理与kv体系.md)
  （KV 驱逐谱系与多级卸载——两个引擎都在接的方向）。
- 更大选型棋盘：[推理引擎选型与源码路线.md](./推理引擎选型与源码路线.md)
  （TRT-LLM/LMDeploy/llama.cpp 同表）。
- 容量与 SLO：[推理服务slo与运营.md](./推理服务slo与运营.md)、
  [infra面试计算题专项.md](./infra面试计算题专项.md)——选好引擎之后
  怎么对账。
