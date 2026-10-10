# JD 分析：AI Infra 工程师（推理 / 训练 / 平台）

> 调研时间：2026-10。数据源：**15 份官方 JD 原文**——腾讯官网开放 API 6 份、
> 字节跳动官网 6 份、Moonshot（careers.kimi.com）3 份。阿里/百度/华为/智谱等
> 因登录墙未取全文，以索引级证据佐证。
> 配套阅读：[JD 分析-Agent 开发岗](./jd分析-agent开发岗.md)、[学习路线图](./学习路线图.md)。

## 一、已验证 JD 原文（15 份）

| # | 公司 | 岗位 | 方向 | 核心要求一句话 |
|---|------|------|------|---------------|
| 1 | 腾讯（元宝） | LLM 大模型推理工程师 | 推理·优化 | CUDA 高性能计算，访存/低比特优化，TRT-LLM/vLLM |
| 2 | 腾讯（云） | 大模型推理框架研发工程师 | 推理·框架 | vLLM/SGLang/TRT-LLM，PD 分离调度，Triton/tilelang/CUTLASS，昇腾异构 |
| 3 | 腾讯（混元） | 训练 Infra 工程师（Dataloader/Checkpoint） | 训练·数据 | 分布式 Dataloader、IO 优化、Checkpoint 高吞吐存储 |
| 4 | 腾讯（游戏） | 大模型训练框架研发工程师 | 训练·框架 | PyTorch/JAX，Megatron/DeepSpeed/FSDP，CUDA、TP/PP |
| 5 | 腾讯（ML 平台） | 机器学习平台研发工程师 | 平台·MaaS | Java/Go/Python，K8s/Docker，模型一键部署、多推理框架接入 |
| 6 | 腾讯（ML 平台） | 机器学习平台调度工程师 | 平台·调度 | 万卡 GPU 调度，K8s 调度器/CSI/CRD，RDMA、混部容灾 |
| 7 | 字节（基础设施） | 大模型推理研发专家 | 推理·Serving | 全链路性能分析（Perf/eBPF/Nsight），SLO 下吞吐/时延平衡 |
| 8 | 字节（Seed） | 大模型推理引擎专家 | 推理·引擎 | 自研推理引擎、在线 + 批式推理，集群弹性调度/GPU 超卖 |
| 9 | 字节（Data） | 硬件加速推理引擎运行时开发 | 推理·Runtime | C++，Runtime/UMD 软件栈，CUDA Runtime、ROCm |
| 10 | 字节（Data） | 训练系统与优化工程师（VLM/Agent RL） | 训练·RL | 100B~1T 分布式训练、MFU 优化、PPO/GRPO/Agent RL 框架 |
| 11 | 字节（抖音） | 大模型训练框架开发工程师 | 训练·框架 | FSDP/ZeRO、TP/PP/EP/SP，NCCL/HCCL，32B+/100B+ MoE 经验 |
| 12 | 字节（基础设施） | AI Infra 研发工程师 - 存储 | 平台·存储 | 并行策略优化、集合通信（AllReduce/AllGather）、数据缓存 |
| 13 | Moonshot/Kimi | 大规模推理系统工程师 | 推理·Serving | 分布式服务架构；Python/Go/Rust/TS；CS 基础 + 开源加分，**校招友好** |
| 14 | Moonshot/Kimi | RL Infra 研究工程师 | 训练·RLHF infra | 万亿参数 RL 后训练框架，Megatron-LM/vLLM，verl/slime 加分 |
| 15 | Moonshot/Kimi | Infra 系统应用工程师 | 平台·生态 | LLM 生产管线（网关/任务流/可观测），K8s，OpenAI API 标准 |

## 二、技能要求矩阵（按方向分列）

| 技能类别 | 推理方向 | 训练方向 | 平台方向 |
|---|---|---|---|
| 语言 | **C/C++ 为主**，Python 普遍 | Python+C++ | Go/Java/Python（Moonshot 含 Rust/TS） |
| 推理框架 | **vLLM / SGLang / TRT-LLM 三件套** + 自研引擎 | 用于 RL rollout：vLLM | 多框架接入 |
| GPU 编程 | **CUDA 核心**，Triton/tilelang/CUTLASS，ROCm | CUDA 优化、算子融合（加分） | 了解即可 |
| 分布式训练 | 非必需 | **Megatron/DeepSpeed/FSDP(ZeRO)，**DP/TP/PP/EP/SP，NCCL/HCCL | 集合通信、调度层面 |
| 推理优化 | PD 分离、量化/剪枝/稀疏、动态 batch、编译优化、低比特/访存 | 显存优化、MFU | 资源利用率、混部 |
| RL infra | — | **PPO/GRPO/Agent RL**，verl/slime，训推一致性、Rollout 长尾 | — |
| 数据/存储 | — | Dataloader、IO 瓶颈、Checkpoint 高吞吐、对象存储 | 训练数据调度缓存 |
| 云原生 | 集群弹性调度、GPU 超卖 | 容错、Profiling 工具链 | **K8s 调度器/CSI/CRD、RDMA、MPI** |
| 性能工具 | Perf、eBPF、Nsight | 收敛性排查 | 观测体系 |

### 共性经验要求

- **规模化叙事是硬通货**：100B+ 模型分布式训练、32B+ Dense / 100B+ MoE、万卡集群。
- **开源贡献是普遍加分项**：vLLM/SGLang contributor（腾讯）、Megatron/DeepSpeed（字节）、
  vLLM/VeRL 重要 PR（Moonshot）。
- 顶会论文（MLSys/OSDI/SOSP）、NOI/ACM 竞赛背景（DeepSeek 系风格）。

## 三、推理 vs 训练：要求差异

| 维度 | 推理（Serving/优化） | 训练（预训练/后训练/RL infra） |
|---|---|---|
| 第一语言 | C/C++ 权重更高 | Python 权重更高，C++ 辅助 |
| 核心知识域 | CUDA kernel、访存/低比特、编译、PD 分离/continuous batch、SLO/SLA | 并行策略、通信、显存管理、数据管线、收敛性排查 |
| 评价指标 | 吞吐/时延/成本、tokens/s、GPU 利用率 | MFU、训练吞吐、故障恢复时间、收敛正确性 |
| 新兴热点 | PD 分离、异构推理、端侧推理 | **Agent RL 训练框架**、长序列训练、训推一致性 |
| 经验门槛 | 2-3 年即可进；Moonshot 校招友好 | 普遍 2 年 + 且要大模型尺寸背书 |

> 趋势：**推理与训练的边界在合拢**——推理岗也开始要求懂训练；RL/后训练岗
> 要求同时熟悉 vLLM（推理）与 Megatron（训练），字节和 Moonshot 都在抢这类人。

## 四、高频技术关键词榜

1. GPU（25 次）2. 分布式训练/系统（29）3. 推理框架/引擎（18）4. 性能分析/瓶颈定位（17）
5. 并行策略 TP/PP/DP/EP（13）6. Python（13）7. **RL/GRPO/Agent RL（13）** 8. C/C++（12）
9. 异构计算/昇腾（11）10. 算子优化/融合（10）11. 开源贡献/PR（10）12. CUDA（9）
13. vLLM（8）14. PyTorch（8）15. K8s/Docker/云原生（13）16. 多模态/VLM（8）
17. 编译/图优化（8）18. 模型量化（6）19. NCCL/集合通信（5）20. RDMA/NVLink（5）、PD 分离（5）

> 注：KV Cache/PagedAttention 在 JD 原文频次低（2 次），但属于面试深挖**必考点**——
> JD 以"框架名 + 项目经验"写要求，原理以面试题形式出现。

## 五、层级差异

- **校招/初级（0-2 年）**：Moonshot 大规模推理岗是典型——CS 基础扎实（编译/OS/网络）+
  一门语言精通 + 开源/GitHub 加分，不要求 CUDA/框架经验。
- **中级（2-3 年）**：熟悉至少一种训练/推理框架原理 + 实际优化经验，CUDA 或分布式有其一。
- **高级/专家（3-5 年+）**：要"规模"背书——100B+ 模型、万卡集群、线上高并发；
  独立拆解复杂问题、架构设计。

## 六、启示

1. 先选"推理深"还是"训练深"，再补另一边；RL infra 是差异化竞争力。
2. 简历写"规模数字"：100B+ 模型、千卡集群、tokens/s、MFU 提升。
3. 给 vLLM/SGLang/Megatron 提 PR 是最高性价比加分项（3 家公司显式点名）。
4. 系统基本功决定下限：Linux/IO、体系结构/访存、网络与分布式。
5. **平台方向是「后端转 AI Infra」的最佳入口**：MaaS/调度岗要求更接近传统后端
   （Go/K8s/微服务），框架深度要求低一档。

---

*来源：腾讯招聘官网开放 API、字节跳动招聘官网、Moonshot careers（Moka 系统）。
阿里/百度/华为/MiniMax/智谱/阶跃/商汤因登录墙或风控未取全文。
统计基于 15 份已验证原文，样本偏腾讯/字节/Moonshot，不代表全市场分布。*
