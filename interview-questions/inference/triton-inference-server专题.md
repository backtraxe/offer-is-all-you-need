# Triton Inference Server 专题：服务化层、ensemble 与 BLS 两条绝活

> 本篇面向已经把 vLLM / TRT-LLM 引擎层吃透、被面试官追问「引擎再往上，
> 服务化层怎么搭」的 AI Infra 求职者。NVIDIA Triton Inference Server
> （下称 Triton）就是最标准的答案。读完你会得到：① Triton 的生态位——
> 模型无关的服务化框架，四大机制一次讲清；② ensemble 与 BLS 两条
> Triton 独有绝活的原理、典型形态与取舍；③「直接 vllm serve 还是再架
> 一层 Triton」的决策表，外加 6 条面试题口径。
>
> **口径说明**：概念一律以 NVIDIA 官方文档为准（Triton User Guide 与
> triton-inference-server GitHub 官方仓库），概念多年稳定，不编性能
> 数字、不虚构版本特性；选型判断为作者推演，文中已单独标注。

开篇闭环：引擎层的对手戏读 [TensorRT-LLM 专题](./tensorrt-llm专题.md) 与
[vLLM 与推理加速核心](./vllm与推理加速核心.md)——那两篇讲「单引擎怎么快」，
本篇讲「多模型多引擎混在一个集群里时，谁来管接入、调度、版本与管线」。

## 一、Triton 在推理栈里是哪一层：模型无关的服务化框架

把整个推理栈竖着切三层：

```text
业务接入层    网关 / FastAPI / KServe / Dynamo
服务化层      Triton Inference Server  ← 本篇主角
引擎层        TRT-LLM / vLLM / ONNX Runtime / PyTorch / FasterTransformer …
```

Triton 自己**不做任何计算**，它是模型无关的服务化框架：无论底下的模型是
TensorRT plan、ONNX、PyTorch、TRT-LLM 引擎还是一段 Python 脚本，对 Triton
来说都只是一种 backend。它干的事官方列得很清楚：

- 对外提供 HTTP/REST 与 gRPC 推理协议（社区 KServe 协议），另有 C / Java API 供进程内嵌调用；
- 模型管理：专用 model management API，运行时加载、卸载、查询状态；调度拼批 per-model scheduler，每个模型独立配置；
- 指标与健康：GPU 利用率、吞吐、延迟等指标，readiness / liveness 健康端点，方便接进 Kubernetes。

与「直接 `vllm serve` 一把梭」的分工一句话：**引擎自带的 serve 是把引擎
裸奔出去，Triton 是把多个引擎收编为 backend 统一管起来**——收编换来的是
统一协议、统一指标、统一版本管理和管线编排，代价是多一跳。

## 二、核心机制四件套

### 2.1 model repository：目录即模型

Triton 没有注册中心、没有数据库，**模型就是一个目录**。启动时用
`--model-repository` 指向仓库（可重复指定多个），仓库布局是固定约定：

```text
<model-repository-path>/
  my_model/
    config.pbtxt        # 模型配置：backend、拼批、实例等
    1/                  # 版本子目录，必须数字命名
      model.plan        # 具体文件由 backend 决定
    2/
      model.plan
```

- **多版本并存**：每个数字子目录是一个版本，config 里的 version policy 决定对外暴露哪些版本（全部 / 最新 N 个 / 指定版本），灰度与回滚因此只是改配置；
- **热加载**：默认模式只加载启动时的仓库；开启 poll 模式自动检测变化，或用 model control API 显式 load / unload；
- **仓库不止本地盘**：GCS、S3、Azure Blob 可直接挂载，启动时拷贝到本地临时目录。

版本目录里放什么由 backend 决定：TensorRT 放 `model.plan`，ONNX 放 `model.onnx`，TorchScript 放 `model.pt`，Python backend 放 `model.py`。

### 2.2 scheduler：dynamic batching 与 sequence batching

每个模型可独立配置调度器，面试最常问的是这两个：

- **dynamic batching（动态拼批）**：server 在单个模型实例入口攒一小段时间窗口内的多个请求，拼成一大 batch 一次性喂给 backend，再等每个子结果分发回去。可选 preferred batch size 与排队等待上限（max queue delay），是吞吐换延迟的经典旋钮。
- **sequence batching（序列拼批）**：面向有状态模型——给每个请求打上 sequence id 与首尾标志，server 保证同一序列的请求被路由回同一实例，由该实例的 scheduler 维护隐式状态，按请求携带的开始/结束标志判断新序列还是续序列。

**层次差异必须讲清**：Triton 的 dynamic batching 是 server 侧、请求级拼批，
拼好一整个 batch 才交给 backend；vLLM / TRT-LLM 的 continuous batching
（IFB）是引擎内、token 级调度，每个 decode step 动态增删序列进出批。两者
层次与粒度不同、不冲突——而正因为 LLM 拼批责任已下沉引擎 token 级，
**server 层动态拼批对 LLM 模型通常不承担主责**，重活在 backend 的 IFB 里。

### 2.3 instance_group：同一模型多副本绑多卡

`instance_group` 是横向扩卡开关：count 定副本数，kind 定跑 GPU 还是 CPU
（KIND_GPU / KIND_CPU 等），gpus 指定绑到哪几张卡——四张卡给同一模型开
四个副本就是几行配置，也是官方 concurrent model execution 的落地点。

### 2.4 backend：引擎都被收编成插件

backend 是 Triton 与「真正干活的引擎」之间的接口层：tensorrt、tensorrtllm、
vllm、pytorch、onnxruntime、python、dali、fil 等以独立插件形式经统一
backend C API 挂进 server。**白盒可编程的 python backend** 是重点——约定
`TritonPythonModel` 类实现 initialize / execute / finalize，你写什么它跑
什么。下一节的 BLS 全靠它。

## 三、ensemble 与 BLS：本篇的面试主菜

### 3.1 ensemble：config 里连一条流水线

ensemble 把多个模型在 `config.pbtxt` 里连成一条 DAG，对外暴露为单一逻辑模型：

```text
ensemble_scheduling {
  step [
    {
      model_name: "preprocess"
      model_version: -1
      input_map  { key: "raw"    value: "raw" }
      output_map { key: "tensor" value: "input0" }
    },
    {
      model_name: "resnet"
      model_version: -1
      input_map  { key: "input0" value: "tensor" }
      output_map { key: "logits" value: "probs" }
    },
    { ... 后处理模型 ... }
  ]
}
```

数据流在 server 内部流转：**预处理、推理、后处理三步只产生一次对外网络
往返**，中间不做协议序列化、不过网卡，省 RTT 与序列化开销。缺点是纯静态
——DAG 形状写死在 config 里，不支持循环、条件分支。

### 3.2 BLS：Python backend 里是活的编排

BLS（Business Logic Scripting）自 21.08 起提供：在 Python backend 的 execute
函数里，用 `pb_utils.InferenceRequest` 对同一 server 上的其他模型直接发起
推理调用（server 内部路由，不走对外网络）——官方定位「custom logic 与 model
execution 的组合」，条件、循环、数据依赖控制流都能写。典型形态三条：

- **RAG 管线**：embedding 模型 → 向量检索 → 拼 prompt → LLM 模型，一条请求进 Triton、一条 completion 出去，检索与拼接都是 BLS 代码；
- **guardrail 前后审核**：先调分类模型做输入审核，命中直接拒答；LLM 生成完再过一次输出审核——组合顺序由代码控制；
- **draft + target 投机解码编排**：BLS 里循环调度小模型提草、大模型验收，把解码策略收进 server 内部（主流做法是把投机解码放进引擎自己跑，这条是「server 层编排」的备选形态）。

### 3.3 与「前面再架一层网关/FastAPI 编排」的取舍

| 维度 | ensemble / BLS（server 内编排） | 外部网关 / FastAPI 编排 |
|---|---|---|
| 延迟 | 零网络往返、零协议序列化，最低 | 每步一次 HTTP + 序列化，累计明显 |
| 表达能力 | ensemble 只能静态 DAG；BLS 是受 server 进程约束的 Python | 任意代码、任意框架，最灵活 |
| 服务边界 | 编排逻辑与推理生命周期绑死，部署一体 | 编排与推理解耦，独立扩缩容独立发版 |
| 观测 | 整条管线进 Triton 统一指标 | 需要自己打通链路追踪 |
| 适用 | 确定、稳定、延迟敏感的固定管线 | 快速迭代、频繁变化、多租户逻辑各异地接外部依赖 |

一句话结论：**管线稳定且压得住延迟就下沉 server 内（ensemble/BLS），编排逻辑
天天改就留在外面**。

## 四、LLM 时代的选型判断

| 场景 | 判断 | 理由（作者推演，非官方口径） |
|---|---|---|
| 纯 LLM 高并发对话 | 直接 `vllm serve`（SGLang 同理）更省一层 | continuous batching 在引擎内部已做到最好，再包一次 server 拼批不增益，还多一跳协议与一层运维面 |
| 多模型混部（LLM + embedding + rerank + TTS） | Triton 有价值 | 一个 server 装多模型多 backend，instance_group 混绑多卡，ensemble/BLS 把管线连起来 |
| 异构 backend 混跑（部分模型只有 TRT / ONNX 形态） | Triton 有价值 | backend 插件化是 Triton 核心卖点，不用为一两个老模型自建框架 |
| 复杂前后处理（图片编解码、tokenizer 外置、审核） | Triton 有价值 | ensemble 把预处理/后处理收编成模型，省一次 HTTP |
| 需要统一指标、版本管理、K8s 健康就绪 | Triton 有价值 | metrics / readiness / liveness / model management API 开箱即用 |
| 追最新引擎特性（最新 spec decode、anchor KV） | 先看 engine 原生 serve | Triton 的 vllm / tensorrtllm backend 有集成节奏差，新特性有时晚于引擎本体 |

最关键的一句修正口径：**二者不是替代关系——vLLM 与 TRT-LLM 都可以作为
Triton 的 backend 存在**，框架管接入管理，引擎只管把模型跑到极致。

## ▶ 面试题

**Q1【高频】Triton 的 dynamic batching 和 vLLM 的 continuous batching 差在哪？**
层次与粒度两点都要答到：dynamic batching 在 server 层、请求级——队列攒批
拼成一次性 batch 喂给 backend，靠 max queue delay 换吞吐；continuous
batching 在引擎层、token 级——decode 每步按 token 增删序列。LLM 场景拼批
责任已下沉引擎，Triton 层的 dynamic batching 退居配角。
追问 sequence batching？答：有状态模型用，按 sequence id 把续序列路由回
同一实例，维护隐式状态。

**Q2【高频】ensemble 和「在外面写个 FastAPI 编排」差在哪？**
三刀：① 延迟——ensemble / BLS 在 server 内部转 tensor，零网络往返零
序列化；② 表达能力——ensemble 是静态 DAG，分支循环要靠 BLS 的 Python；
FastAPI 任意；③ 部署边界——server 内编排与推理生命周期绑死，FastAPI
解耦易迭代。稳定管线下沉、高频变化上浮（第三节表）。

**Q3【高频】什么场景不该上 Triton？**
纯 LLM、单引擎、高并发对话：引擎自带 serve 已到顶，多一层只多运维面。
再补两刀：编排逻辑天天改（BLS 更新要动 server 部署）、非 NVIDIA 环境
（Triton 的力都使在 NVIDIA 栈上）。

**Q4【中频】config.pbtxt 里都有哪些关键字段？**
给出示意片段（**示意**，非完整配置，字段以官方 model configuration 文档为准）：

```text
name: "my_model"
backend: "tensorrt"                 # 或 pytorch / onnxruntime / python …
max_batch_size: 8                   # 0 或不写 = 不做 server 侧拼批
input  [ { name: "input0", data_type: TYPE_FP32, dims: [-1] } ]
output [ { name: "output0", data_type: TYPE_FP32, dims: [-1] } ]
version_policy { latest { num_versions: 2 } }  # 多版本灰度
instance_group [ { count: 2, kind: KIND_GPU, gpus: [0, 1] } ]
dynamic_batching { preferred_batch_size: [4, 8] }
```

**Q5【中频】Triton 跟 vLLM 是什么关系？**
框架与引擎的上下位关系：Triton 模型无关、管接入调度指标，vLLM 只管把
LLM 这一个引擎跑到极致。vllm backend 让 vLLM 挂在 Triton 里面跑；反过来
也有 team 只用 vllm serve 不要 Triton——多模型多 backend 时才轮到 Triton
出场。

**Q6【中频】BLS 是什么？给三个典型形态。**
Python backend 的 execute 内经 `pb_utils.InferenceRequest` 对同一 server
的其他模型发起推理调用，官方定位「custom logic + model execution」。形态：
① embedding → 向量检索 → LLM 的 RAG 管线；② guardrail 前置审核 → LLM →
后置审核；③ draft + target 投机解码的 server 层编排。

## 串联阅读

- [vLLM 与推理加速核心](./vllm与推理加速核心.md)：引擎层的调度与 KV 管理，是本篇「拼批责任下沉引擎」判断的依据；
- [TensorRT-LLM 专题](./tensorrt-llm专题.md)：NVIDIA 自家引擎，最常挂在 Triton tensorrtllm backend 下的那位；
- [vLLM 与 SGLang 深度对比](./vllm与sglang深度对比.md)：社区两位主角的架构地基，第四节「直接 serve 更省一层」的对手盘算例；
- [推理调度专题](./推理调度专题.md)：continuous batching / chunked prefill 的通用原理，本篇第 2.2 节的层次差异要在它的语境下读；
- [推理服务 SLO 与运营](./推理服务slo与运营.md)：SLO、指标与算帐——Triton 统一指标的下游用处；
- [推理压测与容量规划专题](./推理压测与容量规划专题.md)：压测方法，instance_group 副本数最后还是要它来定；
- [agentic-serving 专题](./agentic-serving专题.md)：Agent 流量进入 serve 层后的调度面，RAG + guardrail BLS 管线的业务侧背景；
- [高频面试真题汇总](../高频面试真题汇总.md)：跨模块真题大盘点，本篇 6 题是它的推理侧落子。

## 来源与致谢

- 本篇所有概念（model repository 布局、dynamic / sequence batching、instance_group、backend 体系、ensemble DAG、BLS 起始版本与定位）以 [NVIDIA Triton Inference Server 官方文档](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/index.html) 与 [triton-inference-server GitHub 组织](https://github.com/triton-inference-server) 下的 server / backend / python_backend 官方仓库为准；
- 选题思路（服务化层与 ensemble/BLS 单列专题）参考社区仓库 liguodongiot/llm-action 的 Triton 三篇布局，特此致谢；
- 选型决策表与「是否该上 Triton」的判断为作者基于架构事实的推演，非官方口径，面试引用请自行标注。
