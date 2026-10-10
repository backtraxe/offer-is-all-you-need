# vLLM 源码解读：一个请求的完整旅程（V1 架构）

> [vllm 与推理加速核心.md](../vllm与推理加速核心.md) 讲"引擎为什么这么设计"，
> 本文讲"这些设计在代码里长什么样"——跟着 `POST /v1/chat/completions`
> 从 FastAPI 一路走到 CUDA kernel 再流回 SSE。面试被问"看过 vLLM 源码吗"，
> 本文就是你的弹药库：**每一段都给出可直接打开的文件路径 + 类/函数名**。
>
> 版本口径：vLLM **main 分支 / V1 架构**（V0 engine 已于 v0.11 前后彻底移除）。
> 文中所有路径均于 2026-10 在 GitHub main 分支逐一核实，核实清单见
> [文末第六节](#六勘误与版本声明)。原理名词口径与
> [vllm 与推理加速核心.md](../vllm与推理加速核心.md) 完全一致，先读那篇再读本篇
> 体验最佳；读源码的总体规划在
> [推理引擎选型与源码路线.md](../推理引擎选型与源码路线.md#三源码学习路线从-1200-行复刻开始)。

## 〇、阅读姿势

- 不必背代码，背**主线**：`HTTP → AsyncLLM → ZMQ → EngineCore loop
  (schedule → execute → 回传) → OutputProcessor → SSE`。
- 所有"路径 + 类名"引用都能直接在 GitHub 搜到，比如
  `vllm/v1/core/sched/scheduler.py::Scheduler.schedule()`。
- 面试官追问哪个细节，就把那个细节展开成"文件 + 函数 + 一句话证据"。

## 一、全景：一个请求的完整旅程

下面这张 sequenceDiagram 是全文地图。三个阶段注意看进程归属：
**API server 进程**（asyncio）、**EngineCore 进程**（busy loop）、
**Worker 进程**（GPU，TP 时每 rank 一个）。

<div class="diagram-embed">
<iframe src="assets/diagrams/vllm-request.html" width="100%" height="1000" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/vllm-request.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

一句话总结全链路：**tokenize 和 HTTP 住在 API server 进程，调度和
"每一步组什么 batch"住在 EngineCore 进程，真正算矩阵住在 Worker 进程**，
三者用 ZMQ 串起来。后面逐段拆开。

## 二、进程架构：为什么要多进程

▶ 面试题：vLLM V1 为什么把 engine 拆成单独进程？——**中高**（架构题常客）

<div class="diagram-embed">
<iframe src="assets/diagrams/vllm-processes.html" width="100%" height="1000" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/vllm-processes.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 为什么拆进程：一句话——躲 GIL

Python 有全局解释器锁（GIL），**同进程内任何时刻只有一个线程在跑
Python 字节码**。而推理服务里有两类工作天然互斥：

- **CPU 杂活**：tokenize / detokenize、HTTP 序列化、SSE 拼包——纯 Python，
  高吞吐下能吃掉好几个核；
- **GPU 调度心跳**：每个 iteration 都要"收输出 → 重新 schedule → 组装下一个
  batch → launch kernel"，这条链路的延迟直接决定 TPOT。中间夹一毫秒
  Python 杂活，GPU 就空转一毫秒。

V0 时代这两类工作挤在一个进程里互相抢 GIL。V1 的工程答案（对应代码落点）：

| 设计 | 代码落点 | 收益 |
|---|---|---|
| EngineCore 独立进程跑 busy loop | `vllm/v1/engine/core.py::EngineCoreProc.run_busy_loop()` | 调度心跳不被 tokenize/HTTP 打断，GPU 空隙最小化 |
| 进进程间通信用 ZMQ + msgpack | `vllm/v1/engine/core_client.py::AsyncMPClient`（PUSH/PULL、ROUTER socket） | 比 pickle 快，比共享队列简单，天然支持 API server 多开 |
| tokenizer / detokenizer 全放 API server 侧 | `vllm/v1/engine/output_processor.py`（detokenizer 属 `RequestState`） | CPU 密集活完全不进 EngineCore 进程 |
| Worker 进程只做 model forward | `vllm/v1/worker/gpu_worker.py` + `gpu_model_runner.py` | TP rank 各自一进程，通信走 NCCL 而非 Python |

▶ 面试追问：**AsyncLLM 和 EngineCore 之间到底传什么？**
答：请求侧是 `EngineCoreRequest`（prompt token ids + sampling params，已
tokenize 完），输出侧是 `EngineCoreOutputs`（每请求新 token ids）。
**注意跨进程传的是 token id 不是文本**——detokenize 在 API server 侧做，
这正是"字符级流式输出但不阻塞引擎"的来源。socket 形态：client 端
PUSH 请求、PULL 输出（`core_client.py` 里 `make_zmq_socket(...)` 可见
`zmq.ROUTER` / `zmq.PULL`），序列化用 msgspec。

▶ 面试追问：**API server 能不能多开？**
能。`AsyncLLM` 支持 `client_count / client_index`（`entry.py` 里
`build_async_engine_client` 可见），多个 API server 进程共用一个
EngineCore——tokenize 并行化，调度仍单点保序。

## 三、分段源码溯源

### a. HTTP/API 层：FastAPI → prompt tokens

▶ 面试追问：chat 请求怎么变成 token ids？

- **入口**（注意，主干刚重构过）：`vllm server` 命令落到
  `vllm/entrypoints/launchers/api_server/entry.py::main()` → `run_server()` →
  `build_async_engine_client()`（这里创建 `AsyncLLM`）→
  `build_and_serve()` 建 FastAPI app。
  ⚠️ 老面经里的 `vllm/entrypoints/openai/api_server.py` 现在只是个
 **deprecated 转发壳**（真实代码已搬到 `entrypoints/launchers/`，
  本文核实确认），再说"入口在 api_server.py"会被内行听出是旧口径。
- **chat 路由**：`vllm/entrypoints/openai/chat_completion/api_router.py`
  注册 `/v1/chat/completions` →
  `serving.py::OpenAIServingChat.create_chat_completion()`。
  ⚠️ 第二个重构点：老文件 `serving_chat.py` 已拆成
  `openai/chat_completion/` 目录（serving.py / protocol.py），类名
  `OpenAIServingChat` 没变。
- **template + tokenize**：`create_chat_completion` 内调
  `render_chat_request()` → `OnlineRenderer.render_chat()`（chat template
  渲染 + tokenizer 编码），产出 `EngineInput`（prompt_token_ids +
  多模态特征）和 `SamplingParams`。
- 流式分支：`chat_completion_stream_generator()` 把下游
  `AsyncLLM.generate()` 的 async generator 逐条转成
  `ChatCompletionStreamResponse` 再 SSE 写出——**SSE delta 的拼装发生在这里**。
  SSE 协议本身的取舍见
  [vllm 与推理加速核心.md](../vllm与推理加速核心.md#九sse--websocket流式输出怎么到用户)。

一句话证据：**API 层完全不碰模型，它只做「协议 ↔ token id」的翻译**，
所以它可以随便多开、随便重启（重启只断连接，不掉 GPU 状态）。

### b. Engine 客户端：AsyncLLM → ZMQ 队列

▶ 面试追问：请求进了 AsyncLLM 之后发生了什么？

文件：`vllm/v1/engine/async_llm.py::AsyncLLM`。

1. `generate()`（async generator）内部主流程：
   - `InputProcessor.process_inputs()` 把 `EngineInput` 转成**跨进程传输格式**
     `EngineCoreRequest`；
   - `output_processor.add_request()` 在本地为本请求建一条
     `RequestState` + `RequestOutputCollector`（一个 asyncio.Event 驱动的
     单请求队列）——**这就是后面流式输出的「信箱」**；
   - `await self.engine_core.add_request_async(request)` 通过
     `core_client.py::AsyncMPClient` 把请求 msgpack 序列化后 PUSH 进 ZMQ。
2. 回程：AsyncLLM 启动时拉起 `_run_output_handler()` →
   `output_handler()` 协程，**永久监听 ZMQ 输出 socket**，收到
   `EngineCoreOutputs` 就调 `output_processor.process_outputs()` 分发到各
   请求的"信箱"；`generate()` 的 for 循环再从信箱里 await 取 delta yield 出去。

关键观察：**AsyncLLM 自己没有任何调度逻辑**，它是纯客户端。
"每个请求一条 async generator + 一个全局 output_handler 分发"的结构，
是它单进程能抗上万并发连接的原因——asyncio 协程开销远低于线程。

### c. EngineCore 主循环：continuous batching 的本尊

▶ 面试题：continuous batching 在代码里怎么落地？——**极高频**（本题就是本文意义所在）

文件：`vllm/v1/engine/core.py`。

进程侧主体是 `EngineCoreProc`（继承 `EngineCore`），核心循环浓缩成
十来行就是（`run_busy_loop()` + `_process_engine_step()` + `step()`
的真实结构，非逐字源码）：

```python
# vllm/v1/engine/core.py（结构浓缩，非逐字）
def run_busy_loop(self):
    while True:
        self._process_input_queue()      # 收 ZMQ 新请求 → waiting
        self._process_engine_step()      # 有活就干一步

def step(self):
    scheduler_output = self.scheduler.schedule()           # 这一步 batch 装谁
    model_output = self.model_executor.execute_model(scheduler_output)
    engine_outputs = self.scheduler.update_from_output(
        scheduler_output, model_output)                    # 判停/前进/释放
    return engine_outputs
```

**这就是 continuous batching 的代码本体**：`step()` 每跑一轮就是
"一个 iteration"，每轮都重新 `schedule()`——完成的请求在
`update_from_output()` 里判停释放，新请求在下一轮 `schedule()` 里插入。
原理对照 [vllm 与推理加速核心.md](../vllm与推理加速核心.md#四continuous-batching按-iteration-调度不按请求调度)
的时序图，两者是同一件事的"论文视角"和"代码视角"。

细节补给（面试很加分）：

- 请求不是每次都被立刻调度——`process_input_sockets()` 只是把 ZMQ 里的
  新请求收进 `Scheduler.waiting`，进不进本轮 batch 由 `schedule()` 决定；
- `step_with_batch_queue()` 是 pipeline 优化版：GPU 还在算第 N 步时，
  CPU 已经在 schedule 第 N+1 步，进一步压 CPU/GPU 串行间隙；
- DP 多副本时每个 rank 一个 `EngineCoreProc`（`DPEngineCoreProc`），
  由 `coordinator.py` 同步"大家是否都还有活"，避免有 rank 空转退出。

### d. Scheduler：waiting/running、KV 预算、prefix 命中、抢占

▶ 面试题：vLLM 的调度器每步做什么决定？——**高**

文件：`vllm/v1/core/sched/scheduler.py::Scheduler`。两条队列：

- `self.waiting = create_request_queue(self.policy)`——等待队列
  （FCFS 或优先级，`request_queue.py`）；
- `self.running: list[Request]`——本轮可参与计算的在跑请求。

`schedule()` 的主干逻辑（真实顺序）：

<div class="diagram-embed">
<iframe src="assets/diagrams/vllm-schedule.html" width="100%" height="860" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/vllm-schedule.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

四个必考点逐个落位：

1. **chunked prefill 预算**：`schedule()` 开头
   `input_budget = self.scheduler_config.max_num_batched_tokens`。
   一轮所有请求调度的 token 总数不超过这个预算，所以超长 prompt 会被
   切成多轮 chunk，和 decode 混排——**这就是为什么长 prompt 不会把
   同批 decode 的 TPOT 打出大毛刺**。原理见
   [vllm 与推理加速核心.md](../vllm与推理加速核心.md#四continuous-batching按-iteration-调度不按请求调度)
   的"工程取舍追问"。
2. **prefix cache 命中**：waiting 请求进来先走
   `kv_cache_manager.py::KVCacheManager.get_computed_blocks(request)`
   → 内部 `coordinator.find_longest_cache_hit(request.block_hashes, ...)`。
   `block_hashes` 在 `Request` 构造时由
   `kv_cache_utils.py::get_request_block_hasher()` / `hash_block_tokens()`
   逐块算出——**哈希链式：每块 hash 掺入前一块 hash**，所以"前缀相同
   ⇔ 哈希相同"。默认哈希算法已是 **sha256**（xxhash 为可选非加密实现，
   main 分支核实）。
3. **block 分配**：`KVCacheManager.allocate_slots()` 统一处理
   "已命中块（ref_cnt++）+ 新分配块"，底层池子是
   `vllm/v1/core/block_pool.py::BlockPool`（free block 队列 + 引用计数 +
   LRU 淘汰链）。这就是 PagedAttention 块体系在 V1 的实现位置。
4. **抢占**：running 请求申请不到新块时
   `_preempt_request()` 从 running 队尾开刀，释放 blocks、状态置回
   `PREEMPTED` 塞回 waiting 头部。V1 的抢占恢复策略是 **recompute**
   （重算 prefill，靠 prefix cache 命中兜底便宜化），不再有 V0 的 swap
   到 CPU 选项——面试主动说"抢占 = 踢回 waiting 重新排队，靠 prefix
   cache 减少重算代价"。

▶ 面试追问：**schedule 的产出长什么样？**
`vllm/v1/core/sched/output.py::SchedulerOutput`——dataclass：
`scheduled_new_reqs: list[NewRequestData]`（首次调度，带完整
prompt_token_ids/sampling_params/block_ids）+
`scheduled_cached_reqs: CachedRequestData`（老请求只发 diff：
新 block_ids、前进到哪个 token）+ `num_scheduled_tokens` 字典。
**新旧请求分离 = 通信量最小化**，worker 侧缓存了老请求的全部状态。

### e. ModelRunner（GPU 侧）：组 input → 前向 → 采样

▶ 面试追问：SchedulerOutput 到 kernel 之间发生了什么？

文件：`vllm/v1/worker/gpu_model_runner.py::GPUModelRunner`
（worker 壳是 `gpu_worker.py::GPUWorker`）。

`execute_model(scheduler_output)` 的内部顺序：

1. **更新输入批次**：`NewRequestData` 全量入批，`CachedRequestData`
   只更新 diff；每条请求的 block table 增量
   `self.input_batch.block_table.append_row(new_block_ids, req_index)`
   ——PagedAttention 的 block table 在 GPU 侧由
   `vllm/v1/worker/block_table.py` 维护成一张对齐张量。
2. **组 attention metadata**：把 block table、seq_lens、query start loc
   打成 `CommonAttentionMetadata`，交给 attention backend 的 metadata
   builder。**backend 选择**集中在
   `vllm/v1/attention/backends/`：`flash_attn.py`（FlashAttention
   paged kernel）、`flashinfer.py`、`triton_attn.py`、`mla/`（MLA 专用）……
   由平台/模型配置在启动时选定。**PagedAttention 的"按块索引 KV"就
   实现在这些 backend 的 kernel 里**，不是单独一个 py 文件——面试别再说
   "vLLM 里有个 paged_attention.py"（那是远古版本）。
3. **前向**：`model.forward()`（可包 torch.compile / CUDA Graph，
   CUDA Graph 的 replay 逻辑也在本文件，小 batch decode 消 launch 开销）。
4. **采样**：取 logits → `self.sampler(...)`，
   `vllm/v1/sample/sampler.py::Sampler` 的 docstring 把整个顺序写得
   明明白白：bad words → logit bias → penalties（repetition/frequency/
   presence）→ temperature → top-k / top-p（`TopKTopPSampler`）→ 采样。
   **全 batch 向量化、一次完成**，无 Python 逐请求循环。
5. **打包**：`vllm/v1/outputs.py::ModelRunnerOutput`——注意
   `sampled_token_ids` 是 `list[list[int]]` 而不是 tensor
   （文件里注释原话：tensor 序列化贵，跨进程传 list）。

▶ 面试追问：**TP > 1 时这段在哪同步？**
`GPUModelRunner` 每个 TP rank 各跑一份，权重已按 rank 切好；
EngineCore 侧通过 executor 把同一个 `SchedulerOutput` 广播给所有
rank，前向内的 all-reduce 走 NCCL。Scheduler 只在 driver 侧存在一份——
**调度单点、计算多卡**，这是 V1 对比 Megatron 式"每层一个 controller"
的简洁之处。

### f. 输出链路：token id → SSE delta

▶ 面试追问：token 从 GPU 出来到用户屏幕，还要过几手？

1. `ModelRunnerOutput` 经 executor 回到 EngineCore 进程，
   `Scheduler.update_from_output()` 处理"账本"：前进
   `num_computed_tokens`、append 新 token、判停（EOS / max_tokens /
   stop 判定）、完成则 `free()` 释放 KV blocks。
2. EngineCore 把 `EngineCoreOutputs`（每请求 new_token_ids）msgpack
   后 ZMQ PUSH 回 API server——`core.py::process_output_sockets()`。
3. API server 侧 `output_handler()` 收到 →
   `output_processor.py::OutputProcessor.process_outputs()`：
   它的 docstring 明确写着"V1 最小化全 batch 的 Python 循环，
   这是唯一允许循环遍历 outputs 的地方"。里面做两件事：
   - **增量 detokenize**：`detokenizer.py::IncrementalDetokenizer`。
     fast tokenizer 走 `FastIncrementalDetokenizer`（底层
     `tokenizers.decoders.DecodeStream`，Rust 实现逐 token 吐字符）；
     慢速 python 实现走 `SlowIncrementalDetokenizer`
     （`detokenize_incrementally` + read_offset/prefix_offset 双指针，
     只解码新增部分）。"**每个 token 边界不一定是 UTF-8 字符边界"
     的处理也在这里**；
   - 装 `RequestOutput` 塞进该请求的 `RequestOutputCollector`
     （DELTA 模式还会合并积压输出，消费慢时不爆队列）。
4. `OpenAIServingChat.chat_completion_stream_generator()` 从
   `generate()` 拿到 delta → 组装 OpenAI 格式 chunk → SSE 逐条 flush，
   最后一个 `data: [DONE]` 收场。协议层为什么用 SSE 见
   [vllm 与推理加速核心.md](../vllm与推理加速核心.md#九sse--websocket流式输出怎么到用户)。

## 四、关键数据结构卡片

| 结构 | 所在文件（已核实） | 一句话 |
|---|---|---|
| `Request` / `RequestStatus` | `vllm/v1/request.py` | 引擎侧请求本体：token ids、`num_computed_tokens`、`block_hashes`、状态机（WAITING/RUNNING/PREEMPTED/FINISHED_*） |
| `EngineCoreRequest` | `vllm/v1/engine/__init__.py` | 跨进程传输的请求格式（msgspec），prompt 已是 token ids |
| `SchedulerOutput` | `vllm/v1/core/sched/output.py` | 一轮调度的产出：新请求全量 + 老请求 diff + 每条调度 token 数 |
| `ModelRunnerOutput` | `vllm/v1/outputs.py` | GPU 一轮的产出：req_ids + 各请求 sampled_token_ids（刻意用 list 不用 tensor） |
| `KVCacheBlock` / `BlockHash` | `vllm/v1/core/kv_cache_utils.py` | 物理块对象（含 ref_cnt、块哈希）；哈希为 bytes，链式掺入前块哈希 |
| `BlockPool` | `vllm/v1/core/block_pool.py` | 空闲块队列 + 引用计数 + LRU 淘汰，PagedAttention 的"物理内存管理器" |
| `KVCacheBlocks` | `vllm/v1/core/kv_cache_manager.py` | Scheduler ↔ KVCacheManager 的接口封装，隐藏内部结构、附带 `get_block_ids()` |
| `RequestOutputCollector` | `vllm/v1/engine/output_processor.py` | 单请求流式信箱：asyncio.Event + 积压合并 |
| `RequestState` | `vllm/v1/engine/output_processor.py` | API server 侧每请求状态：增量 detokenizer + logprobs 处理器 + stream interval |

## 五、面试怎么用：八条"读源码答追问"武器

1. **「continuous batching 在哪落地？」**
   → `vllm/v1/engine/core.py::EngineCore.step()`：
   每轮 `schedule()` → `execute_model()` → `update_from_output()`，
   每轮重新决定 batch 成员。说完补一句"`step_with_batch_queue()` 还把
   CPU 调度和 GPU 计算流水化了"，直接显出你读过主干新代码。
2. **「prefix cache 怎么命中的？」**
   → `Request` 生成时按块算链式哈希（`kv_cache_utils.py::hash_block_tokens`，
   默认 sha256）；调度时 `KVCacheManager.get_computed_blocks()` →
   `coordinator.find_longest_cache_hit()` 查哈希表，命中块 ref_cnt++
   直接复用。命中粒度 = block（默认 16 token）。
3. **「为什么 V1 比 V0 快？」**
   → 三个结构原因：EngineCore 独立进程 busy loop，调度心跳不被
   tokenize/HTTP 的 GIL 争抢打断（`core.py::EngineCoreProc.run_busy_loop`）；
   全链路 msgspec + ZMQ，老请求只发 diff（`SchedulerOutput` 的
   New/Cached 分离）；Sampler 全向量化无 Python 循环
   （`v1/sample/sampler.py`）。
4. **「长 prompt 进来为什么不会卡死别人的 decode？」**
   → `scheduler.py::schedule()` 里
   `input_budget = max_num_batched_tokens`：一轮总 token 数封顶，
   长 prefill 被自动切片与 decode 混排（chunked prefill 本体）。
5. **「KV 满了怎么办？」**
   → running 申请新块失败 → `_preempt_request()` 抢占队尾、释放
   blocks、回 waiting；恢复时靠 prefix cache 命中便宜重算。
   注意补一句："V1 只有 recompute 抢占，V0 的 swap-to-CPU 已被移除。"
6. **「PagedAttention 的块索引在代码哪里？」**
   → 两层：CPU 侧 `BlockPool` + `KVCacheManager.allocate_slots()`
   管分配和 block table 账本；kernel 侧在
   `vllm/v1/attention/backends/flash_attn.py` 等 backend 里按
   block table 取 K/V。**「块管理在调度器，块索引在 attention kernel」**
   这句话层次分得很清楚。
7. **「流式输出为什么不影响引擎吞吐？」**
   → 跨进程只传 token id；detokenize 在 API server 进程
   `OutputProcessor` + `IncrementalDetokenizer`（fast 路径直接调 Rust
   的 `DecodeStream`）；SSE 拼装在最外层 `serving.py`。
   EngineCore 对"用户在看文字"一无所知。
8. **「TP=4 时调度器有几份？」**
   → 一份。Scheduler 只在 EngineCore（driver）侧存在，`SchedulerOutput`
   广播到各 TP rank 的 `GPUModelRunner`；卡间同步靠前向里的 NCCL
   all-reduce，调度本身无分布式一致性开销。

## 六、勘误与版本声明

**版本口径**：本文以 vLLM GitHub **main 分支**（V1 架构）为准，核实时间
2026-10。V0 engine（`vllm/engine/llm_engine.py`、`vllm/core/scheduler.py`
等老路径）已在 v0.11 前后从主干移除；`vllm/v1/engine/llm_engine.py`
虽保留但源码自述为 *"Legacy LLMEngine for backwards compatibility"*，
线下批处理兼容层，线上服务路径是 `AsyncLLM`。

**与旧面经口径的两处重要勘误**（核实中发现）：

- `vllm/entrypoints/openai/api_server.py` 现已是 deprecated 转发壳，
  真实入口在 `vllm/entrypoints/launchers/api_server/entry.py`；
- `vllm/entrypoints/openai/serving_chat.py` 已拆分为
  `vllm/entrypoints/openai/chat_completion/serving.py`（类名
  `OpenAIServingChat` 不变）。
  [推理引擎选型与源码路线.md](../推理引擎选型与源码路线.md) 里的读源码
  主线（schedule → execute_model）依然成立，但引用老路径时以本文为准。

**本文实际核实过的路径与方式**（全部 main 分支）：

| 路径 | 核实方式 |
|---|---|
| `vllm/entrypoints/launchers/api_server/entry.py` | raw 全文：main/run_server/build_async_engine_client |
| `vllm/entrypoints/openai/api_server.py` | raw 全文：确认已是 deprecated 壳 |
| `vllm/entrypoints/openai/chat_completion/serving.py` | raw 全文检索：OpenAIServingChat / create_chat_completion / chat_completion_stream_generator |
| `vllm/v1/engine/async_llm.py` | raw 全文检索：AsyncLLM / generate / output_handler |
| `vllm/v1/engine/llm_engine.py` | raw 全文：LLMEngine legacy docstring / step() |
| `vllm/v1/engine/core.py` | raw 全文检索：EngineCore / EngineCoreProc.run_busy_loop / step / step_with_batch_queue / process_input_sockets / process_output_sockets |
| `vllm/v1/engine/core_client.py` | raw 全文检索：EngineCoreClient / InprocClient / SyncMPClient / AsyncMPClient / ZMQ socket |
| `vllm/v1/engine/output_processor.py` | raw 全文：OutputProcessor / RequestState / RequestOutputCollector / process_outputs |
| `vllm/v1/engine/detokenizer.py` | raw 全文：IncrementalDetokenizer / Fast / Slow / check_stop_strings |
| `vllm/v1/core/sched/scheduler.py` | raw 全文检索：Scheduler.schedule / waiting / running / max_num_batched_tokens / _preempt_request / update_from_output |
| `vllm/v1/core/sched/output.py` | raw 全文：SchedulerOutput / NewRequestData / CachedRequestData |
| `vllm/v1/core/kv_cache_manager.py` | raw 全文：KVCacheManager / get_computed_blocks / allocate_slots / block_pool |
| `vllm/v1/core/kv_cache_utils.py` | raw 全文检索：BlockHash / hash_block_tokens / get_request_block_hasher / sha256 |
| `vllm/v1/core/block_pool.py` | GitHub 页面确认存在 + 被 kv_cache_utils 导入 BlockPool |
| `vllm/v1/worker/gpu_model_runner.py` | raw 全文检索：GPUModelRunner / execute_model / self.sampler / block_table 更新 |
| `vllm/v1/sample/sampler.py` | raw 全文：Sampler / 采样顺序 docstring / TopKTopPSampler |
| `vllm/v1/request.py` | raw 全文：Request / RequestStatus / block_hashes |
| `vllm/v1/outputs.py` | raw 全文：ModelRunnerOutput / SamplerOutput |
| `vllm/v1/attention/backends/` | GitHub 目录页：flash_attn.py / flashinfer.py / triton_attn.py / mla/ |
| `vllm/v1/worker/gpu_worker.py` 等 | GitHub 目录页确认存在（未读全文） |

注意：main 分支日日变，面试前建议花 10 分钟重开一遍这份清单对照
（仓库迭代极快，主要风险点是 entrypoints 层的再重构；`v1/` 内部的
Scheduler/EngineCore/ModelRunner 骨架已稳定多版本）。

---

*配套阅读：原理篇 [vllm 与推理加速核心.md](../vllm与推理加速核心.md)；
源码入门路线（nano-vllm 复刻）
[推理引擎选型与源码路线.md](../推理引擎选型与源码路线.md)；
SGLang 侧的同款解读见本目录 [sglang 请求全链路.md](./sglang请求全链路.md)
（RadixAttention 视角，两篇对照服用效果最佳）。*
