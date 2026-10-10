# TensorRT-LLM 专题：三段式重构、PyTorch 新架构与 Blackwell 根基地盘

> 本篇面向想在面试里把 TensorRT-LLM（下称 TRT-LLM）「它现在长什么样、
> 为什么 2025 推倒重来、跟 vLLM/SGLang 怎么选」讲清楚的 AI Infra 求职者。
> 读完你会得到：① v0.17 → v1.0.0 → v1.3.0rc20 三段式重构的完整时间线
> 与动机；② 重构后架构六件（PyExecutor / 双调度器 / Overlap Scheduler /
> attention backends / C++ kernel 地图 / ModelOpt 量化链路）；③ Blackwell
> + FP4 官方性能锚、spec decode 五代演化、disagg 与 Dynamo 生态位、
> 四选四不选的选型矩阵，外加源码地图、CLI 现状与 10 条面试题。
>
> **时效口径**：2023-10（v0.5.0 首个公开 release）→ 2026-09（v1.3.0rc29
> 为当期最新），全部版本号与日期经 gh api 拉取官方 release notes 实测
> 核实（2026-10-10）。性能数字除特别标注外均为 NVIDIA 官方博客口径，
> 未独立复测。
>
> 开篇闭环：上一篇 [推理引擎 2026 新进展](./推理引擎2026新进展.md) 第
> 4.1 节留下的「TRT-LLM 的独立演进未调研」悬置，本篇即补全——那篇的
> 收敛趋势（KV 资产化、控制面 Rust 化等）是三线通用判断，本篇不重复，
> 只聚焦 TRT-LLM 自己的体系。

## 〇、一句话主脉络：Python 重构模型层，C++/CUDA 守住性能层

整条时间线可以压成一句话：**2025-2026 年 TRT-LLM 完成了一次「模型层
Python 化、性能层 C++/CUDA 原样保留」的大重构，PyTorch 是唯一后端，
engine 编译这一步在 2026-07 之后彻底不存在。**

最容易踩的旧面相陷阱：trtllm-build 已删除。凡是你脑子里的
convert_checkpoint → trtllm-build → 序列化 engine 的老三步，现在讲出来
就是反向信号——本篇第六节的版本里程碑表会给出它是什么时候、以什么方式
谢幕的。

另有一处需要标注：[推理引擎选型与源码路线](./推理引擎选型与源码路线.md)
第六节「TRT-LLM 为什么极限性能更强」里的「C++ 调度栈」**表述，2025 后已
过时**——调度器与模型定义层已 Python 化，C++ 只留在热路径
（kernel、batch manager、executor），详见本篇第二节。旧文不改动，
以本篇为准。

补一句经常被误解的：「MLPerf 用的就是 TRT-LLM——但这只证明官方栈下限，
不证明上限」。MLPerf 提交用官方栈是确定性/合规性选择，不代表社区找不
到更快配方；MLPerf 具体分数本次未核实（官网 403），本篇一律不给数字，
只引 GTC 官方博客侧写。

## 一、三段式重构时间线

| 阶段 | 版本/日期 | 事件 |
|---|---|---|
| 起点 | 2023-10-19 | v0.5.0 首个公开 release，IFB（in-flight batching）配套 GptManager；IFB 是否该版即 GA 措辞留余量，release note 只确认 IFB 在列 |
| ① 实验 | v0.17.0（2025-02-07） | PyTorch workflow 实验首发（`tensorrt_llm._torch`）；NVFP4 GEMM for Llama/Mixtral；Blackwell 硬件首发 |
| ② 转正 | v1.0.0（2025-09-24） | **BREAKING CHANGE**：PyTorch 成为默认后端（LLM 与 trtllm-serve 两条入口都默认）；LLM API 给出稳定承诺；TRT workflow 旧文档移除 |
| ③ 谢幕 | v1.3.0rc20（2026-06-30） | **最后一个支持 TensorRT engine 后端的 RC**；其后 rc21…rc29（2026-07-15 → 2026-09-29）TRT 后端彻底移除；迁移文档 `docs/source/legacy/tensorrt-backend-removal.md` 于 2026-07-02 入库，原话「PyTorch is now the sole execution backend」 |

重构后，`trtllm-build` / `trtllm-refit` / `trtllm-prune` 三个 CLI 全部
删除，HF checkpoint 直接加载，engine 编译与 convert_checkpoint 步骤连
同 per-model 转换脚本目录一起消失。

**动机**：原 engine 路线模型上新成本极高——每接一个模型要写 C++ /
plugin 加转换脚本，再 convert_checkpoint、trtllm-build、序列化。这个
节奏跟不上 vLLM / SGLang 的模型跟进速度（2025 年引擎军备竞赛的核心
赛道就是「新模型 Day-1 支持」）。解法是把模型定义降到纯 Python，把
kernel 与 batch manager 热路径全部保留在 C++/CUDA——这就是「Python
重构模型层、C++/CUDA 守住性能层」的由来。

## 二、重构后架构六件

修订后对外只有一个顶层 API：`tensorrt_llm.LLM`。往下拆六件：

### 2.1 PyExecutor：新的执行内核

位于 `tensorrt_llm/_torch/pyexecutor/`。单个 step 的流水：取新请求 →
Scheduler 决策 → ModelEngine.forward → Decoder 采样 → 输出。C++
binding 在底层，Python 接口可定制——这是「工程门槛降低」论据的核心
证据：改调度策略不再需要碰 C++。

### 2.2 调度层：CapacityScheduler + MicroBatchScheduler

两阶段分工：

- **CapacityScheduler**：回答「资源够不够」，管 KV / batch 资源准入；
- **MicroBatchScheduler**：回答「本 step 跑哪些请求」，做 batch 组成。

IFB（NVIDIA 版 continuous batching）退到更底层，由 C++ batch manager
执行，外层策略全在 Python。配套的 paged KV、KV reuse、salting、
offloading 都还在，热路径 C++。

### 2.3 Overlap Scheduler：默认开启

默认开（`disable_overlap_scheduler=True` 可关）：第 n 步的 GPU 计算
与第 n 步的 CPU 收尾（stop criteria 判定、response 更新）重叠执行，
代价是增加 1 个 decode step 的延迟。官方实现明确引用 **NanoFlow
（arXiv:2408.12757）** 与 **SGLang v0.4 的 zero-overhead scheduling**
——这不是谁的独门绝技，是 2025 年引擎界的共同答案，TRT-LLM 只是把
它做成了默认项。

### 2.4 Attention backends：trtllm（XQA）是默认

三档可选：vanilla（参考实现）/ flashinfer / **trtllm（默认，XQA 族）**。

XQA 是 NVIDIA 的 **decode 专用 attention kernel**，为 MQA/GQA 加
beam search 优化，已 tensor-core 化：v0.8.0（2024-02）首次集成（GPT-J
beamWidth=4）、v0.10.0（2024-06）上 Hopper，v0.16 起成为默认。官方
宣称 **Llama-70B on H200 单卡吞吐 2.4×**（ISL/OSL 128/2048，FP8，
官方口径）。源码在 `cpp/kernels/xqa/`（`mha_sm90.cu`、
`mla_sm120.cu`，加 `gen_cubins.py` 做 JIT）。

### 2.5 C++ kernel 地图：性能层一个地方没少

`cpp/tensorrt_llm/` 下：batch_manager、executor、runtime、kernels、
cutlass_extensions、deep_ep、deep_gemm、flash_mla、nccl_extensions、
nanobind、thop。另有 trtllm-gen 预编译 cubins（v1.0.0 release notes
首次出现 TRTLLM MoE NVFP4 cubins；v0.21.0 TRT-LLM Gen FP8
block-scale MoE 接入 PyTorch autotuner）。**「Python 化」只动了模型
定义与调度策略，kernel 与 batch/executor 热路径一个字符没少。**

### 2.6 量化链路：ModelOpt 离线 + HF checkpoint 直载

链路：Model Optimizer 离线量化（ModelOpt 0.23 起全栈 FP4，2025-01-24
官方博客）→ 产出 HF 预量化 checkpoint → `LLM(model=...)` 直接加载。

支持面（当下版本）：FP4（NVFP4）、FP8 per-tensor / block-scale /
rowwise、FP8 KV、NVFP4 KV、W4A16 / W4A8 GPTQ / AWQ。注意区分：
**FP8 KV 可运行时开关**（`KvCacheConfig(dtype='fp8')`），**NVFP4 KV
必须离线**——面试里这是个高频细节题。

## 三、版本里程碑表（全量 gh api 实测）

| 日期 | 版本 | 高价值锚点 |
|---|---|---|
| 2023-10-19 | v0.5.0 | 首个公开 release，IFB 配套 GptManager |
| 2023-12-27 | v0.7.1 | XQA kernel FP8 KV cache；Baichuan FP8 |
| 2024-02-29 | v0.8.0 | Medusa 投机解码；XQA 首集成；新 build workflow |
| 2024-06-05 | v0.10.0 | Hopper XQA for Llama 2 70B；builder API spec-decoding mode |
| 2024-08-29 | v0.12.0 | ReDrafter |
| 2024-11-21 | 官方博客 | Multiblock Attention：HGX H200 长序列吞吐 >3×（官方口径） |
| 2024-12-24 | v0.15.0 | EAGLE + prompt-lookup |
| 2025-01-04 | 官方博客 | Llama 3.3 70B 投机解码吞吐 3×（官方口径） |
| 2025-01-24 | 官方博客 | Model Optimizer 0.23 全栈 FP4 |
| 2025-02-07 | v0.17.0 | PyTorch workflow 实验；NVFP4 GEMM；Blackwell 首发 |
| 2025-02-25 | — | nvidia/DeepSeek-R1-FP4 官方 checkpoint 发布 |
| 2025-03-18 | GTC 2025 | **Dynamo 发布；B200 R1 纪录；官方博客明写 "TensorRT-LLM, architected with PyTorch"** |
| 2025-05-09 | v0.19.0 | MTP（DeepSeek Multi-Token Prediction）；AutoDeploy 实验 |
| 2025-08-04 | v0.21.0 | TRT-LLM Gen FP8 block-scale MoE 接入 PyTorch autotuner |
| 2025-09-24 | **v1.0.0** | **BREAKING：PyTorch 默认、LLM API 稳定承诺**；DeepSeek R1 FP8 on Blackwell；NVFP4 MoE cubins；overlap scheduler + guided decoding |
| 2025-12-19 | v1.1.0 | GPT-OSS；C++ sampler 默认；KV Cache Connector API（disagg）；B300/GB300；CuteDSL NVFP4 grouped GEMM |
| 2026-03-12 | v1.2.0 | FlashInfer batched sampling 默认；Helix 并行（百万 token decode KV 分片）；NIXL-LibFabric、Mooncake；Ray orchestrator；SM120/121 |
| 2026-04-20 | v1.2.1 | 维护版 |
| 2026-06-30 | v1.3.0rc20 | **最后一个支持 TRT engine 后端的 RC** |
| 2026-07-15 → 09-29 | v1.3.0rc21…rc29 | TRT 后端彻底移除；AutoDeploy 于 2026-09-24 移除（PR #19028） |
| 2026-09-24 | 生态变动 | GenAI-Perf deprecated → **AIPerf**（ai-dynamo/aiperf，v0.13.0） |

读表方式：spec decode 的演化线（Medusa → ReDrafter → EAGLE → MTP →
EAGLE-3）完整落在 2024-02 到 2025-09 之间；硬件线（0.17 Blackwell →
1.1 B300/GB300 → 1.2 SM120/121）每个季度一代；2026 下半年是「删东西」
的节奏（TRT 后端、AutoDeploy、GenAI-Perf 三个相继下线）。

## 四、Blackwell + FP4：根基地盘，官方数字锚

TRT-LLM 的性能故事 2025 年起就是 Blackwell + FP4/NVFP4 一条链：

- **>30,000 tok/s 满载、>250 tok/s/用户**（GTC 2025 官方博客，2025-03-18）：
  单台 DGX B200（8 卡）跑 DeepSeek-R1 671B，ISL 1024 / OSL 2048；
- **自 2025-01 起约 36× 吞吐提升、~32× 成本/token 下降**（同一官方
  博客口径，B200 FP4 vs H200 FP8 的基线对比）；
- **>3×：B200 FP4 vs DGX H200 FP8** 在 DeepSeek-R1、Llama 3.1 405B、
  Llama 3.3 70B 三个模型上的综合口径（官方博客）。

精度侧：官方 R1-FP4 checkpoint 的 MMLU 90.8 → 90.7（近乎无损，
2025-03 官方博客口径）。此 checkpoint（nvidia/DeepSeek-R1-FP4）
**只认证 TRT-LLM 管线**——这是「首发硬件 + 官方认证模型」组合优势
的直接证据。

另外一条容易被忽略的广度证据：2024-11-21 官方博客 Multiblock
Attention 在 HGX H200 上长序列吞吐 >3×（官方口径）——FP4 之外，
长序列是第二个数字锚。

图在此：三段式重构是怎么把 TRT-LLM 推到当前架构与生态位的。

<div class="diagram-embed">
<iframe src="assets/diagrams/trtllm-map.html" width="100%" height="900" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/trtllm-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

图读法：泳道一重构时间线三个锚点（v0.17 实验 → v1.0.0 默认+破式 →
v1.3.0rc20 谢幕）；泳道二重构后架构（LLM API 模型层 Python →
PyExecutor 双调度器 → C++/CUDA 热路径）；泳道三生态位（Blackwell+FP4
首发 → Disagg + Dynamo → 与 vLLM/SGLang 的选型对峙）。中列两条竖边
是链条主线：时间线的「转正」落地成架构，架构支撑起分布式生态位。

## 五、Spec decode 五代演化：Medusa 已不是当前主力

历史线与当前版要分开说，混着讲是常见掉分点。

历史线（五代）：Medusa（v0.8.0，2024-02）→ ReDrafter（v0.12.0，
2024-08）→ EAGLE + prompt-lookup（v0.15.0，2024-12）→ MTP
（v0.19.0，2025-05）→ v1.0.0（2025-09）起 **EAGLE-3 与 Drafter
统一抽象**。官方 2025-01-04 博客给过一个中间态成绩：Llama 3.3 70B
投机解码吞吐 3×（官方口径）。

当前版（PyTorch 后端文档为准）：Draft/Target、EAGLE-3（dynamic
tree）、NGram、MTP、PARD、DFlash、user-provided、Suffix Automaton，
且可与 guided decoding 叠加（v1.0.0 起）。PARD 与 DFlash 只说「当前
支持」，具体引入时间线本篇不编。**Medusa 已从当前 PyTorch 后端文档
消失，不要把它列为当前主力**——这正是「默认开关换代」定律（两年
一换）的又一个实例。

## 六、Disagg 与 Dynamo：2026 生态位是「三后端之一」

PD 分离（prefill/decode disaggregation）在 TRT-LLM 里是内建能力，其
系统设计论文为 arXiv:2506.05508。要点：

- **KV 传输与通信库解耦**：推荐 backend 是 **NIXL**（RDMA / NVLink，
  支持节点动态加入离开）；v1.2.0 加入 Mooncake 与 NIXL-LibFabric；
- 传输与计算 overlap 是设计目标之一；
- 两个入口：`trtllm-serve` 自带 disagg，或作为 **Dynamo 的执行后端**
  运行。

与 Dynamo 的关系 2026 年已定型：**PD 分离的顶层形态是 Dynamo，
TRT-LLM 内建 disagg 作执行后端之一，与 vLLM、SGLang 平级竞争**。
Dynamo 官方口径给过的 TRT-LLM 侧配置锚：GB200 NVL72 上 DeepSeek-R1
请求数 up to 30×、Hopper Llama 70B 吞吐 2×（官方口径，对比组合内
非 TRT-LLM 基线）、TRT-LLM FP4 ISL/OSL 32K/8K、context 侧 EP4DP16 /
generation 侧 EP64DP3。

生态位的另外两个收缩信号，面试里有人问到要能圆上：AutoDeploy（2025-05
v0.19 实验的特性自动部署编译路线）于 2026-09-24 移除（PR #19028），
说明「编译部署」这条路被 PyTorch 默认后端吸收；压测工具 GenAI-Perf
deprecated、官方迁移到 **AIPerf**（ai-dynamo/aiperf，v0.13.0，
2026-09-24）——2026 年再说 GenAI-Perf 就是旧知识。

服务形态现状：原 Triton 的 trtllm backend（`triton_backend/` 目录仍在
维护，本篇不说「会移除」）；现在主线是 **trtllm-serve**（OpenAI
兼容，含 LoRA、beam search、n>1、/v1/responses 端点）+ Dynamo 编排 +
NIM 产品化。

## 七、选型矩阵：四选四不选

**选 TRT-LLM 的四个场景**（2026 年论据全部有出处）：

1. **全 NVIDIA 栈 + 首发硬件跟进**：B200/GB200/B300/GB300 的适配始终
   第一时间落地——NVFP4 GEMM 在 v0.17（2025-02）就比 vLLM/SGLang 的
   FP4 生态早到位；逐硬件适配清单（MLA chunked prefill、NVFP4 MoE
   cubins、FP8 SwiGLU）每个 release 在加厚；官方 R1-FP4 checkpoint
   只认证 TRT-LLM 管线。
2. **极限性能有官方背书**：GTC 2025 的 B200 R1 纪录（>30,000 tok/s
   满载）、B200 FP4 vs H200 FP8 >3×，都是官方口径可直接引用。
3. **确定性 / 产品化需求**：MLPerf submission 走 TRT-LLM；v1.0.0 起
   LLM API 有稳定承诺；生产栈（Triton / NIM / Dynamo）官方集成完整。
4. **超大 MoE 与超长上下文**：Wide-EP + EPLB + Attention DP 一套；
   Helix（v1.2.0）做百万 token decode 的 KV 分片；稀疏 attention 首发
   优化（DSA 官方博客：TopK kernel 比 torch.topk 平均 7.41×、FP8
   sparse MLA 吞吐 +47%，官方口径）。

**不选的四个场景**：

1. **模型覆盖面与上新速度**：vLLM 社区响应最快；TRT-LLM 的模型导入
   由 NVIDIA 主动排期（2025H2 optimized 名单：Qwen3-Next、KimiK2、
   GPT-OSS、DeepSeek V3.2），不是「今天发模型今晚就能跑」的生态。
   K3 这类未列名单的新模型，本篇只引用 docs supported-models 现状、
   不下支持结论。
2. **多硬件平台**：只支持 NVIDIA（Blackwell / Hopper / Ada /
   Ampere），国产卡与 AMD 出局——对比 [国产卡生态专题](../国产卡生态专题.md)
   的 vllm-ascend 路线，这是生态位差异不是技术差距。
3. **生态与招聘面**：vLLM 是事实标准（Dynamo 三后端之一、RL 生态
   veRL/Slime 对接最密）；TRT-LLM 的 RC 发版狂（2026-09-29 已到
   rc29）正式里程碑少，跟随成本高。
4. **调参门槛**：NGC container + trtllm-bench + autotuner 的组合比
   vLLM 一个 `vllm serve` 重得多——「工程门槛高」的旧论据 2025 后要
   修正为「门槛只剩环境与调参」，模型开发门槛已随 Python 化消解。

第三方横评：2026 年无可核实的公开数字，本篇统一只给官方口径并标注。

## 八、源码地图（main 分支实测目录）

```text
tensorrt_llm/
├── _torch/                    # PyTorch 后端全部新代码
│   ├── pyexecutor/            # 执行内核：sampler / model_engine
│   ├── attention/backends/    # vanilla / flashinfer / trtllm(默认XQA) / sparse
│   ├── autotuner/             # PyTorch autotuner（trtllm-gen kernel 选择）
│   ├── compilation/           # torch.compile + multi_stream + patterns
│   └── modeling/              # 模型定义（纯 Python，重构主战场）
├── llmapi/                    # 顶层 LLM API（稳定承诺所在）
├── commands/                  # CLI：bench / serve / eval / mooncake
├── serve/                     # OpenAI 兼容服务 + benchmark_serving.py
├── tools/                     # plugin_gen / ppl
├── benchmarks/                # 已并入 serve/scripts + trtllm-bench
├── triton_backend/            # 原 Triton backend，仍在维护
└── triton_kernels/

cpp/tensorrt_llm/              # C++ 性能层，一个符号没少
├── batch_manager/ executor/ runtime/   # IFB、paged KV、KV reuse、beam search
├── kernels/ cutlass_extensions/        # 手写 kernel 与 CUTLASS 扩展
├── deep_ep/ deep_gemm/ flash_mla/      # DeepSeek 系 kernel 收编
└── nccl_extensions/ nanobind/ thop/
cpp/kernels/xqa/               # XQA：mha.cu / mha_sm90.cu / mla_sm120.cu
                               # + gen_cubins.py（JIT）+ ref.py
docs/source/
├── legacy/                    # 旧 TRT 文档仅供交叉参考
├── torch/ features/           # 新后端文档与特性页
└── blogs/tech_blog/           # blog01…blog29，技术深挖首选入口
examples/                      # llm-api / models / core / disaggregated / wide_ep
                               # （per-model convert_checkpoint 目录已删除）
```

安装两条路：pip wheel（**强烈建议 NGC pytorch 容器**，v1.2 基座
`nvcr.io/nvidia/pytorch:25.12-py3` + PyTorch 2.9.1）；源码 CMake +
`scripts/build_wheel.py`。

**常用 CLI 现状（2026-10）**：

- `trtllm-serve`：OpenAI 兼容服务，PyTorch 默认，无 engine 步骤；
- `trtllm-bench`：throughput | latency 离线压测；
- `trtllm-eval`：精度评测；
- **已删除**：`trtllm-build` / `trtllm-refit` / `trtllm-prune`（迁移
  文档里标 "Removed"）——这是新旧资料混用时最大的坑。

## 九、▶ 面试题与追问

**Q1【高频】TRT-LLM vs vLLM/SGLang 怎么选型？**
四选四不选（第七节）。要点话术：全 N 卡 + Blackwell 首发（NVFP4 比
社区早落地）+ 超大 MoE/百万上下文（Wide-EP、Helix）+ 生产稳定性
（MLPerf、API 稳定承诺、NIM/Dynamo 官方集成）选 TRT-LLM；模型上新快、
生态、多硬件、低跟随成本选 vLLM。一定要补修正句：2025 重构后「工程
门槛高」论据要更新——模型层已 Python 化，门槛剩 NGC 容器与
trtllm-bench 调参。

**Q2【高频】为什么 2025 要推倒重构？**
v0.17 → v1.0 → v1.3.0rc20 三段背熟（第一节表）。动机一句话：原
engine 路线每个模型 convert_checkpoint + C++ plugin + engine 编译，
上新速度跟不上 vLLM/SGLang；解法是模型定义与调度器降到 Python，
kernel 与 batch manager 热路径保留 C++/CUDA。

**Q3【高频】TRT-LLM 的 scheduling 体系长什么样？**
IFB（v0.5 时代 NVIDIA 版 continuous batching）→ 现在的
CapacityScheduler + MicroBatchScheduler（C++ 核 + Python 接口）
+ Overlap Scheduler（默认开，明确引用 NanoFlow arXiv:2408.12757 与
SGLang v0.4 zero-overhead）+ chunked prefill + paged KV + KV
reuse/salting/offloading。督促一个细节：Overlap 的代价是 1 个
decode step。

**Q4【中频】FP4/NVFP4 为什么先在 TRT-LLM 落地？**
整条链：ModelOpt 离线 PTQ/QAT → HF 预量化 checkpoint → trtllm-gen
NVFP4 MoE/GEMM cubins + CUTLASS 3.8 Blackwell block-scaling——NVIDIA
垂直栈四段自己全控。精度锚：官方 R1-FP4 MMLU 90.8 → 90.7 近乎无损
（2025-03 官方博客口径）。追问细节：NVFP4 KV 必须离线，FP8 KV 可
运行时开关。

**Q5【中频】XQA 是什么？**
decode 专用 attention kernel：MQA/GQA + beam search 优化、已 TC 化。
v0.8 首集成、v0.10 上 Hopper、v0.16 起默认。官方宣称 Llama-70B on
H200 单卡吞吐 2.4×（ISL/OSL 128/2048，FP8，官方口径）。源码在
`cpp/kernels/xqa/`。

**Q6【中频】PD 分离怎么做？**
内建 disagg（arXiv:2506.05508）：KV 传输与通信库解耦，NIXL（推荐，
支持节点动态加入离开）/ Mooncake / NIXL-LibFabric / UCX，传输与计算
overlap。顶层编排交给 Dynamo：Planner 动态决策、Smart Router 按 KV
拓扑路由、KV 分层 offload。2026 的正确生态表述：Dynamo 是顶层形态，
TRT-LLM 与 vLLM/SGLang 平级竞争执行后端位。

**Q7【中频】spec decode 支持到什么程度？**
历史线五代：Medusa → ReDrafter → EAGLE → MTP → v1.0 EAGLE-3/Drafter
统一。当前：EAGLE-3 dynamic tree、MTP、NGram、draft-target、PARD、
DFlash、Suffix Automaton + user-provided，可与 guided decoding 叠加。
Recovery 话术：**Medusa 已不是当前主力**，PyTorch 后端文档已将其移除。

**Q8【低频】CUDA Graph 怎么玩？**
decode-only iteration 全图捕获；piecewise 与 torch.compile 配套
（`_torch/compilation/`）；tech blog 20 起公开批尺寸调参方法论；
spec 场景双图捕获（draft 与 target 各一张）。

**Q9【低频】engine 编译还存在吗？**
**2026-07 后彻底不存在**：v1.3.0rc20 是最后一个支持 TRT engine
后端的 RC；其后 `trtllm-build` / `refit` / `prune` 被删除，
`backend="tensorrt"` 直接 ValueError，convert_checkpoint.py 与
per-model 转换脚本目录一起消失。这是新旧资料混用时最容易踩的旧面相
陷阱。

**Q10【低频】压测用什么？**
离线 `trtllm-bench`（throughput | latency）、服务侧
`benchmark_serving.py`（已并入库）、2026 官方压测迁移到 **AIPerf**
（GenAI-Perf 已 deprecated）；线上侧用 request_perf_metrics 指标。

## 十、串联阅读

- [vLLM vs SGLang 深度对比](./vllm与sglang深度对比.md)：社区两位主角
  的架构地基，本文选型矩阵的对手盘；
- [推理引擎 2026 新进展](./推理引擎2026新进展.md)：三线收敛判断与
  Dynamo 平台化——本篇是用 TRT-LLM 视角补全其第 4.1 节的悬置；
- [推理调度专题](./推理调度专题.md)：continuous batching / chunked
  prefill 的通用原理，本篇第三节的调度器是它在 NVIDIA 栈的实现；
- [量化与压缩](./量化与压缩.md)：FP8/FP4 的算法原理，本篇第 2.6 节
  量化链路与第四节性能锚的方法论前传。
