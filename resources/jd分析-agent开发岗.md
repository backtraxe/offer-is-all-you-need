# JD 分析：Agent 开发 / 大模型应用开发工程师

> 调研时间：2026-10。覆盖大厂（字节、阿里、腾讯、百度、美团、京东、拼多多）、
> AI 公司（Moonshot、DeepSeek、智谱、MiniMax、阶跃星辰）及 70+ 份聚合 JD 样本。
> 配套阅读：[JD 分析-AI Infra 岗](./jd分析-ai-infra岗.md)、[学习路线图](./学习路线图.md)。

## 一、岗位汇总表

### 大厂

| 公司 | 岗位 | 一句话核心要求 |
|---|---|---|
| 字节跳动 | AI Agent 开发工程师 | 基于大模型的应用架构，探索无代码/Agent 场景落地 |
| 字节跳动 | Agent 平台/AML 平台 Agent 工程师 | Agent 编排、workflow 框架与高性能 API 服务，多轮对话 |
| 阿里巴巴 | Agent 应用开发工程师（杭州，1-3 年） | 大模型应用开发、业务场景落地 |
| 阿里巴巴 | Agent 研发工程师（Java/Python） | 可视化 Agent 编排引擎 + RAG 检索增强系统 |
| 腾讯 | 混元大模型 Agent 开发工程师 | 围绕混元模型的 Agent 应用开发 |
| 腾讯云 | Agent 应用构建工程师（武汉，1-3 年，15-22K·14 薪） | 面向行业客户构建并交付 Agent 应用 |
| 腾讯游戏 | 多模态大模型与 Agent 算法工程师（校招） | LLM/VLM 训练微调部署，熟悉 LangChain、AutoGen |
| 百度 | 智能体研发工程师（校招） | 企业级 AI 原生应用；提示词工程、RAG、多模态 |
| 百度 | AIDU 智能体算法工程师（校招，硕士起） | 规划、工具调用、多 Agent、RAG、评测、Fine-tuning/RL |
| 美团 | Search Agent 大模型算法工程师（3-5 年，硕士） | 搜索场景 Agentic 算法研发 |
| 京东 | 大模型应用开发工程师（本科+） | 工作流、智能体、RAG 场景技术研发，要有真实项目效果 |
| 拼多多 | AI Agent 研发工程师 | 核心架构、RAG、高并发、安全、可观测性、MCP、多 Agent |

### AI 公司

| 公司 | 岗位 | 一句话核心要求 |
|---|---|---|
| Moonshot/月之暗面 | AI Agent 工程师 / 全栈极客（AI-Native） | Agent 核心研发 + 评测，工程能力极客化 |
| DeepSeek | Agent 方向 17 个岗位 | 硬性要求深度使用过 Claude Code/Manus 等知名 Agent，偏好重度 Vibe Coding 人才 |
| 智谱 | 大模型 Agent 算法工程师 | 评测和优化智能体技术效果，设计微调方案 |
| MiniMax | Agent 服务端研发（2026 届，35-45K·16 薪）；AGI 全栈工程师（3-5 年，30-50K·16 薪） | Agent 服务端研发与 AI App 全栈交付 |
| 阶跃星辰 | Agent 基建算法工程师 / 多模态 Agent 算法工程师 | Agent 基础设施与算法并重，多模态 Agent 特色 |

## 二、技能要求矩阵

### P0 · 几乎必备（85%+ JD 提及）

| 技能 | 说明 |
|---|---|
| Python（精通级） | 100% 必备；要写可维护、可测试的服务代码而非 Notebook 脚本 |
| RAG 全链路 | 解析→分块→Embedding→混合检索（向量+BM25）→Rerank→引用溯源；仅"接个向量库"不够 |
| Agent 框架 | LangChain 最高频，其次 LangGraph、Dify/Coze、AutoGen、CrewAI |
| Function Calling / MCP | 工具 Schema 设计、权限、重试、幂等；MCP 已是 2026 标配 |
| Prompt/Context Engineering | 结构化提示、上下文压缩与缓存、Token 预算 |
| 生产级软件工程 | API、异步/高并发、数据库、缓存、MQ、Docker、CI/CD、云 |
| 项目/生产证据 | 可演示项目、上线系统、开源贡献、真实指标复盘 |

### P1 · 高频要求（50-85%）

- 向量数据库：Milvus/Qdrant/Chroma/ES/pgvector 选型与调优
- 多 Agent / A2A / 工作流编排：状态机、任务拆解、检查点恢复、Human-in-the-Loop
- Eval & 可观测性：黄金评测集、自动评分、Tracing（LangSmith/LangFuse）、回放、成功率/延迟/成本
- 第二语言：Go/Java/C++/TypeScript 其一（大厂平台岗常要求 Java/Python 双栈）
- 多模型接入：Qwen/DeepSeek/OpenAI/Claude 网关、路由与 fallback

### P2 · 加分项（30-55%）

- 微调/后训练：LoRA/QLoRA、SFT、DPO/RLHF（应用岗加分、算法岗必备）
- 推理部署：vLLM/SGLang、量化、私有化部署
- 安全治理：Prompt Injection 防护、沙箱、权限最小化、审计
- AI Coding 工具深度使用：Claude Code/Cursor/Codex——DeepSeek 列为硬性要求
- 多模态、知识图谱/GraphRAG、行业 Know-how

### 软技能

- 业务理解：把模糊业务流程拆成 Agent 可执行的任务链路
- 跨团队协作：与产品、客户对齐并对结果负责
- Owner 意识：end-to-end 交付，能复盘失败案例

## 三、高频关键词 Top 榜

| # | 关键词 | 出现频次 |
|---|---|---|
| 1 | RAG / 知识库 / 向量检索 | 21/21 |
| 2 | 项目经验 / 生产落地证据 | 21/21 |
| 3 | 软件工程（API/并发/Docker/云） | 20/21 |
| 4 | 业务理解 / 跨团队协作 | 20/21 |
| 5 | LangChain（及框架族） | ~18/21 |
| 6 | Function Calling / Tool Use / MCP | 18/21 |
| 7 | Python | 16/21（100% 口径下必备） |
| 8 | 多 Agent / 工作流编排 | 14/21 |
| 9｜10 | Prompt/Context Engineering、Eval/可观测性 | 各 14/21 |
| 11 | 微调/SFT/RLHF（加分） | 12/21 |
| 12 | 安全/权限治理 | 10/21 |
| 13-20 | 向量数据库、Dify/Coze、LangGraph、Java/Go、vLLM、AI Coding 工具… | ~25-40% |

## 四、层级差异：1-3 年 vs 3-5 年

- **1-3 年 / 应届**：独立完成原型或 0→1 项目；校招也要 LLM/Agent 原理 + RAG + 框架 + 项目实践。
  面试重心："会用 + 讲清取舍"。薪资锚点：腾讯云武汉 15-22K·14 薪；AI 公司校招头部 35K+·16 薪。
- **3-5 年 / 资深**：生产经验、架构设计、性能/成本优化、评测体系、安全治理、跨团队推进。
  本质区别：**能对非确定性系统负责**——成功率/延迟/Token 成本指标体系、
  黄金评测集与回归门禁、灰度与降级、Prompt Injection 防护。薪资锚点 30-50K·16 薪。

## 五、启示

1. RAG/Agent 框架只是门票，**生产化证据才是入场券**。
2. 准备"稳定性与可靠性"叙事：失效模式、失败分类、评测构造是高频追问。
3. 保住软件工程底盘：95% JD 仍要求 API/并发/Docker/云。
4. MCP、Eval/可观测性、重度 AI Coding 工具使用是 2026 最容易补上的差异化项。
5. 1-3 年拼"端到端可演示项目 + 框架熟练度"；3-5 年拼"指标体系 + 架构与安全治理"。

---

*来源：21 个 JD 深度编码报告（todayforai.com）、50+ JD 调研（掘金）、
2026 大模型岗位能力地图（LLMGuide）、各公司招聘官网、DeepSeek 招聘媒体报道。
BOSS/脉脉完整 JD 页有登录墙，部分摘自搜索快照；频次为目的性抽样，不代表全市场占比。*
