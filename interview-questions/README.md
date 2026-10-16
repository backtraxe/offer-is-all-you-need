# 高频考点地图（interview-questions）

> 考点体系基于 10+ 篇公开面经（牛客摘录、代码随想录、kamacoder 面经、CSDN 秋招
> 实测 28 家公司等调查研究），并按 JD 调研标定权重。完整题目清单见
> [高频面试真题汇总](./高频面试真题汇总.md)；学习顺序见
> [resources/学习路线图](../resources/学习路线图.md)；学完全部模块后用
> [知识串联与 Why 链](./知识串联与why链.md) 做总复习（五条因果链织联全部文档）。

## 一、模块划分（由浅入深）

<div class="diagram-embed">
<iframe src="assets/diagrams/interview-map.html" width="100%" height="640" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/interview-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

各模块目录（持续更新）：

| 模块 | 目录 | 岗位权重 |
|---|---|---|
| LLM 基础 | `llm基础/` | 三类岗位公共必答 |
| 训练与对齐 | `训练与对齐/` | 算法岗核心，其余懂概念 |
| RAG | `rag/` | 应用岗第一权重，Infra 懂流程 |
| Agent | `agent/` | 应用岗第一权重 |
| 推理部署 | `inference/` | Infra 岗第一权重 |
| 分布式训练 | `distributed-training/` | Infra/算法岗，应用岗懂概念 |

## 二、三类岗位的答题区

<div class="diagram-embed">
<iframe src="assets/diagrams/interview-prep-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/interview-prep-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 三、出现率 Top 20（合并 10+ 篇面经去重）

| # | 题目 | 频率 |
|---|---|---|
| 1 | RAG 完整流程 + chunk 切分策略 | 极高 |
| 2 | KV Cache 原理与显存估算 | 极高 |
| 3 | LoRA 原理及与全量微调对比 | 极高 |
| 4 | Transformer 架构 / Self-Attention 原理 | 极高 |
| 5 | RAG vs 微调的取舍 | 极高 |
| 6 | 幻觉的成因与工程缓解 | 极高 |
| 7 | Function Calling 原理 / MCP 区别 | 极高 |
| 8 | ReAct 范式与循环控制 | 极高 |
| 9 | PPO / DPO / GRPO 差异与推导 | 极高（算法岗） |
| 10 | 混合检索（BM25+ 向量）/ Rerank | 极高 |
| 11 | 手撕 Multi-Head Attention | 极高（算法/Infra） |
| 12 | vLLM / PagedAttention / Continuous Batching | 高 |
| 13 | RoPE 位置编码原理 | 高 |
| 14 | RLHF 完整流程与 Reward Model | 高 |
| 15 | Agent 长短期记忆设计 | 高 |
| 16 | 项目指标怎么量化（通用追问） | 高 |
| 17 | DP/TP/PP + ZeRO-1/2/3 | 高 |
| 18 | 量化选型 GPTQ/AWQ/PTQ/QAT | 高 |
| 19 | MHA→MQA/GQA/MLA 演进 | 高 |
| 20 | 上下文工程：压缩策略与摆放位置 | 高（2026 新热点） |

## 三·五列关联总索引（知识点 × 考频 × 专题 × 手撕/演练 × 面经案例）

> 本表是全仓的关联中枢：一行 = 一个考点从「考得多勤 → 深读哪篇 →
> 动手练哪个 → 哪场面经真考过」的完整链路。考频口径合并 Top 20 与
> [面经合集主信号总表](../interview-experiences/小红书社招面经合集-2026h2.md)
> （他处与本表不一致时以本表为准）。★ 标记 = 必读主干篇。

| 知识点 | 考频 | 深读专题 | 手撕/演练 | 面经案例 |
|---|---|---|---|---|
| **公共底盘** ||||
| Transformer / Self-Attention | 极高 | [llm基础/](llm基础) | [coding/手写attention](../coding/模型手撕/手写attention.md) | 平头哥五板块、字节多模态 |
| KV Cache 原理与显存估算 | 极高 | ★[inference/长上下文推理与kv体系](inference/长上下文推理与kv体系.md) + [显存计算专题](显存计算专题.md) + [双向kv传输与多轮复用专题](inference/双向kv传输与多轮复用专题.md) | [coding/手写kv显存公式](../coding/模型手撕/手写kv显存公式.md) | 小米手撕公式、月之暗面预算治理 |
| MHA→GQA/MQA→MLA 演进 | 高 | [注意力变体2026专题](inference/注意力变体2026专题.md) + [mla深度穿透专题](llm基础/mla深度穿透专题.md)（矩阵吸收/手撕 cache 账） | coding/手写attention GQA 节 | 小米 SWA 情报 |
| RoPE 位置编码 | 高 | [llm基础/位置编码与norm](llm基础/位置编码与norm.md) | coding/手写attention RoPE 节 | 字节频次表 32 次 |
| **RAG** ||||
| RAG 全链路 | 极高 | ★[rag/rag全链路](rag/rag全链路.md) | [system-design/设计企业知识库agent](../system-design/设计企业知识库agent.md) | 字节评测岗三层口径 |
| 混合检索 BM25 + Rerank | 极高 | ★[rag/检索与混合召回](rag/检索与混合召回.md) | 模考卷 A 第 5 题 | 月之暗面 RAG 全链 |
| 幻觉成因与治理 | 极高 | ★[rag/幻觉与事实性](rag/幻觉与事实性.md) | 阿里「幻觉分情况」话术 | 阿里业务 Agent 一面 |
| RAG badcase 分层定位 | 新高 | [rag/搜索增强与grounding专题](rag/搜索增强与grounding专题.md) | 模考卷 A 第 5 题 | 百度一面、抖音方法论帖 |
| Agentic RAG / 多跳 | 高 | [rag/agentic-rag](rag/agentic-rag.md) | — | 月之暗面复盘预算退化 |
| **Agent** ||||
| ReAct / 规划模式 / Workflow 边界 | 极高 | ★[agent/agent基础与规划](agent/agent基础与规划.md) | [coding/手写最小agent](../coding/工程手撕/手写最小agent.md) | 月之暗面/腾讯一面、阿里国际 |
| 工具调用 / Function Calling / MCP | 极高 | ★[agent/工具调用与mcp](agent/工具调用与mcp.md) + [mcp与工具调用深度对比](agent/mcp与工具调用深度对比.md) | JSON 兜底三件套（[模拟面试](../resources/模拟面试与口语化表达.md)） | 滴滴连问 4 道 MCP |
| Skills 机制 | 新高 | [agent/agent-skills详解](agent/agent-skills详解.md) | — | 字节追 Skills 底层 |
| 记忆分层 / 上下文工程 | 高 | ★[agent/记忆与上下文工程](agent/记忆与上下文工程.md) + [上下文压缩与记忆训练专题](agent/上下文压缩与记忆训练专题.md) + [agent记忆产品化专题](agent/agent记忆产品化专题.md) + [agent记忆评测与遗忘治理专题](agent/agent记忆评测与遗忘治理专题.md) + [coding-agent会话记忆工程专题](agent/coding-agent会话记忆工程专题.md)（context-mode/claude-mem/Hindsight） | 模考卷 A 第 3 题 | 「第二十轮丢信息」排查链 |
| Harness / 评测 / 观测闭环 | 高（爬升） | ★[agent/harness工程实战](agent/harness工程实战.md) + [agent评测与观测闭环专题](agent/agent评测与观测闭环专题.md) + [agent线上排障手册](agent/agent线上排障手册.md) + [agent线上稳定性运营专题](agent/agent线上稳定性运营专题.md) + [评测体系实战专题](评测体系实战专题.md)（从 0 搭业务评测） + [kernel-agent竞赛复盘专题](agent/kernel-agent竞赛复盘专题.md)（竞赛实证） | 模考卷 A 第 9 题 | 字节实习面六连问、某厂画架构 |
| 安全 / 红队 / Guardrail | 高（新题块） | [agent/agent安全与防护](agent/agent安全与防护.md) + [guardrail系统专题](agent/guardrail系统专题.md) | — | 2026 安全攻略 18 题 |
| Coding Agent 源码路线 | 高（爬升） | [agent/pi-agent源码分析](agent/pi-agent源码分析.md) + [agent/deepseek-harness分析](agent/deepseek-harness分析.md) + [agent/codex源码分析](agent/codex源码分析.md) + [agent/claude-code源码机制专题](agent/claude-code源码机制专题.md) + [coding-agent横评专题](agent/coding-agent横评专题.md) | — | 「读过什么 agent 源码」四极话术 |
| 多 Agent 协作与状态仲裁 | 中 | [agent/多agent与评测](agent/多agent与评测.md) | 模考卷 A 第 10 题 | 面试官追问链、抖音场景题 |
| Agentic RL | 高（爬升） | [训练与对齐/agentic-rl专题](训练与对齐/agentic-rl专题.md) + [agentic-rl前沿手法专题](训练与对齐/agentic-rl前沿手法专题.md)（Search-R1/ReTool/OPD）+ [rl环境工程专题](训练与对齐/rl环境工程专题.md) | [coding/手写grpo-loss](../coding/模型手撕/手写grpo-loss.md) | 字节 agent RL 三面、美团 M17 教程 |
| **训练与对齐** ||||
| PPO / DPO / GRPO 差异与推导 | 极高（算法岗） | ★[rlhf与对齐](训练与对齐/rlhf与对齐.md) + [经典rl地基专题](训练与对齐/经典rl地基专题.md)（MDP→贝尔曼→PPO 全程映射 RLHF）+ [rl训练工程实战](训练与对齐/rl训练工程实战.md) | [coding/手写grpo-loss](../coding/模型手撕/手写grpo-loss.md) + [对齐与并行代码](../coding/模型手撕/对齐与并行代码.md) | 滴滴四连追问、GRPO 13 关 |
| SFT / OPD / RL 选型 | 新高 | [post-training蒸馏生产线专题](训练与对齐/post-training蒸馏生产线专题.md) | [coding/手写蒸馏kl](../coding/模型手撕/手写蒸馏kl.md) | 滴滴选型五连问、字节多模态 |
| SFT 数据侧：loss mask / 端到端实战口径 | 高 | [多轮对话loss-mask专题](训练与对齐/多轮对话loss-mask专题.md) + [从零训练小模型实战专题](训练与对齐/从零训练小模型实战专题.md) | loss÷mask之和手算（专题内） | 「你训过模型吗」分水岭题 |
| Reward 设计 / 防长度 hack / 熵坍缩 | 高 | [rl奖励设计专题](训练与对齐/rl奖励设计专题.md) | rl训练工程实战 | 字节 agent RL 三面、字节多模态 |
| 训推不一致 / 异步 rollout | 高（RL infra） | [rl训练工程实战](训练与对齐/rl训练工程实战.md) + [verl深度拆解](训练与对齐/verl深度拆解.md) + [训推逐位一致专题](distributed-training/训推逐位一致专题.md)（diff=0 五要素+逐算子 recipe+Agent skill） | — | 字节 agent RL 三面、面试官接缝复盘 |
| LoRA 与参数高效微调 | 极高 | [训练与对齐/lora与参数高效微调](训练与对齐/lora与参数高效微调.md) | 对齐与并行代码 LoRA 节 | 各类算法岗通考 |
| 模型合并 / 基模合版 | 中（新信号） | [模型合并专题](训练与对齐/模型合并专题.md) | — | 字节 agent RL 三面 |
| **推理部署** ||||
| vLLM / PagedAttention / 连续批处理 | 高 | ★[inference/vllm与推理加速核心](inference/vllm与推理加速核心.md) + [vllm与sglang深度对比](inference/vllm与sglang深度对比.md) + [inference/dsv41-vllm优化实录专题](inference/dsv41-vllm优化实录专题.md)（Agentic 5.3× 实录） | — | 字节 infra 一面、理想一面 |
| 请求过一个引擎的全过程 | 高 | [inference/推理引擎选型与源码路线](inference/推理引擎选型与源码路线.md) + [源码解读/](inference/源码解读) | — | 面经合集二次调研新批 |
| 服务化层：Triton / ensemble / BLS | 中（新补） | [inference/triton-inference-server专题](inference/triton-inference-server专题.md) | — | 「多模型混部怎么搭」场景题 |
| 量化（对称/非对称/QAT/FP8） | 高 | [蒸馏与剪枝专题](蒸馏与剪枝专题.md) + [inference/量化与压缩](inference/量化与压缩.md) + [消费级硬件推理实战专题](消费级硬件推理实战专题.md) + [低精度预训练专题](distributed-training/低精度预训练专题.md)（NVFP4 从零训 12B×10T 五味配方） | INT8 scale 手算 | 字节 infra 题单、2276 赞视频 |
| PD 分离 / 负载均衡 / 前缀缓存 | 高 | ★[负载均衡专题](负载均衡专题.md) + [agentic-serving专题](inference/agentic-serving专题.md) | 模考卷 B 第 4-5 题 | 平头哥 HiCache/ radix 追问 |
| CUDA / GEMM / Bank 冲突 | 高 | [cuda与kernel专题](cuda与kernel专题.md) + [kernel工具链选型专题](kernel工具链选型专题.md)（库/编译器/DSL/手写/Mojo 五层阶梯） + [inference/vera-rubin调优实录专题](inference/vera-rubin调优实录专题.md)（新硬件四板斧实录） + [fbtriton与稀疏算子kernel实战专题](fbtriton与稀疏算子kernel实战专题.md)（Triton 打赢 CUDA 生产案例） + [gemm优化阶梯专题](gemm优化阶梯专题.md)（13 级阶梯） + [blackwell-gemm实战专题](blackwell-gemm实战专题.md)（B200 手写八步到 cuBLAS 97） + [gqa-decode-kernel调优实录专题](gqa-decode-kernel调优实录专题.md)（赢 FA4 1.46×） | [coding/cuda算子手撕](../coding/工程手撕/cuda算子手撕.md) | 平头哥现场画图、地平线 21 问 |
| 仿真 / Configurator / 性能表 | 新高 | [profiling与性能分析专题](profiling与性能分析专题.md) + [torch-profiler入门实战专题](torch-profiler入门实战专题.md)（系列一） + [线性层与mlp的profile实战专题](线性层与mlp的profile实战专题.md)（系列二） + [attention的profile实战专题](attention的profile实战专题.md)（系列三） + [推理压测与容量规划专题](inference/推理压测与容量规划专题.md) + [推理profile实战专题](inference/推理profile实战专题.md)（抓 trace→优化动作闭环） | 收益条件公式（[合集十九节](../interview-experiences/小红书社招面经合集-2026h2.md)） | 小米仿真连环问 |
| 服务排障 runbook（p99/抢占/OOM/慢节点） | 高（运维面分水岭） | [排障面试实战题库](排障面试实战题库.md)（30 题四段论）+ [事故复盘案例集](事故复盘案例集.md)（15 案 postmortem 叙事）+ 三篇排障手册（推理/训练/Agent） | — | 「线上 p99 毛刺怎么排」「讲一个棘手问题」 |
| 国产卡栈（MLU/NPU） | 中高 | [国产卡生态专题](国产卡生态专题.md) + [国产卡推理引擎适配专题](国产卡推理引擎适配专题.md) | — | 寒武纪三轮、字节国产线 |
| **分布式训练** ||||
| DP/TP/PP/EP + ZeRO | 高 | ★[distributed-training/三维并行](distributed-training/三维并行.md) + [组合并行机制专题](distributed-training/组合并行机制专题.md)（坐标编址/EP 五族组/梯度三本账） + [zero与显存优化](distributed-training/zero与显存优化.md) + [inference/推理并行策略决策专题](inference/推理并行策略决策专题.md)（五问框架）+ [inference/dcp解码上下文并行专题](inference/dcp解码上下文并行专题.md)（DCP 深挖） | [对齐与并行代码](../coding/模型手撕/对齐与并行代码.md) TP 节 | 平头哥并行通信板块 |
| 集合通信 / NCCL | 高 | [distributed-training/通信与网络专题](distributed-training/通信与网络专题.md) | — | 阿里云三轮、宇树三轮 |
| Megatron / DeepSpeed / 框架选型 | 中高 | [训练栈全链路专题](distributed-training/训练栈全链路专题.md)（平台→框架→RL 链路图）+ [megatron源码深度拆解](distributed-training/megatron源码深度拆解.md) + [deepspeed专题](distributed-training/deepspeed专题.md)（配置卡片/ckpt 工程）+ [训练框架与稳定性](distributed-training/训练框架与稳定性.md) + [确定性训练专题](distributed-training/确定性训练专题.md)（比特级可复现）+ [训练光速手算实战专题](distributed-training/训练光速手算实战专题.md)（FSDP vs PP 光速判决书） | — | 万卡三面标准题 |
| RL 系统（训推一体/权重同步） | 新高 | [rl系统训推一体专题](distributed-training/rl系统训推一体专题.md) | — | 「训练组也考推理优化」信号 |

## 四、公司面试风格差异（面经体现）

- **字节**：题量最大、追问最深；手撕硬（MHA/attention 算子，AML 要求 numpy 从 0 写 softmax）；
  新热点是上下文工程、压缩、权限（ACL 先过滤还是先召回）。
- **阿里**：算法岗深挖 RL 理论（GRPO loss、Advantage、KL 摆放、on/off-policy）；Infra 挖 CUDA kernel、
  FlashAttention 底层、NCCL 排障。
- **腾讯**：结构细节题（Pre/Post-Norm、Decoder-only 原因）+ 微调框架横评 + 一体化平台设计。
- **美团**：具体结构 + 工程细节（SwiGLU、LoRA、手撕 MoE、SSE 流式）；场景设计题多。
- **快手**：框架横评型（vLLM、LangChain vs LangGraph、Harness/Skills 管理）；重设计取舍。
- **滴滴**：AI Infra 极硬核——显存计算、ZeRO 通信量、AdamW 4 倍显存、CUDA 手撕。
- **京东**：RAG 工程味浓（RRF、多路召回）；Java 生态（Spring AI vs LangChain4j）特色。
- **通用规律**：算法岗 = 结构细节 + RL 推导 + 手撕模型；应用岗 = RAG 全链路 + Agent 工程 +
  效果量化；Infra 岗 = 显存/通信计算 + CUDA 手撕 + vLLM/ZeRO 原理。
  **2026 共同追问主线：「怎么量化」**——幻觉率、召回率、提升百分比都要讲得出测试集和口径。

## 五、使用建议

1. 概念题只是起点，**简历项目深挖才是决定项**——每个主题备一个真实项目案例
   （怎么量化、踩过什么坑）。
2. 按模块目录逐个击破：`coding/` 里有配套手撕练习，`system-design/` 里有设计题模板。
3. 答题模板：**先讲原理（是什么/为什么）→ 再讲工程取舍（什么时候用/代价）→
   最后落到自己项目的数字**。
