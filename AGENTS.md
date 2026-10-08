# AGENTS.md

> 本文件面向 AI 编码助手，用于快速理解本仓库的结构与约定。

## 项目概述

`offer-is-all-you-need` 是一个**面试备战笔记仓库**（非软件工程项目），聚焦于
Agent 开发与 AI Infra 方向的求职准备。内容由 Markdown 文档组成：面经复盘、
高频考点（八股）整理、系统设计笔记和手写 coding 真题，持续更新至"上岸"为止。

- License：MIT
- 主要语言：**中文**（README、注释、文档均以中文为主，中英文术语混排）
- 除 Git 外**没有任何依赖**：无 package.json / pyproject.toml / Cargo.toml 等任何配置文件

## 仓库结构

```
├── interview-experiences/  # 面经复盘：按公司/日期组织，含流程、题目、复盘（暂空）
├── interview-questions/    # 高频考点：README 为考点地图（Top 20 + 公司风格差异）
│   ├── 高频面试真题汇总.md   # 8 大类目全量真题，标注频率与来源公司
│   ├── llm基础/             # Transformer/Attention/RoPE/Norm/KV Cache 计算题
│   ├── 训练与对齐/          # 预训练/SFT/LoRA/RLHF/DPO/GRPO
│   ├── rag/                # 全链路/混合检索/评测与建库工程
│   ├── agent/              # ReAct/FC/MCP/记忆/上下文工程/多 Agent/评测
│   ├── inference/          # vLLM/Continuous Batching/量化/PD 分离/引擎选型
│   └── distributed-training/ # 3D 并行/ZeRO 显存拆账/框架与稳定性
├── system-design/          # 系统设计 6 题：README 有统一答题框架
│   ├── 应用类：知识库 Agent / AI 客服 / 代码 Review+运维
│   └── Infra 类：模型网关 / 分布式推理服务 / AI 开发平台
├── coding/                 # 手撕题库：README 有备考权重表
│   ├── 模型手撕/            # attention/transformer 组件/LoRA·DPO·TP 代码模板
│   └── 工程手撕/            # 最小 ReAct Agent/CUDA 算子/LRU·Top-K 通用题
├── resources/              # 学习路线图（导航页）/两份 JD 分析/学习资源清单
├── .gitignore              # macOS / 编辑器 / 临时文件
├── LICENSE                 # MIT
└── README.md               # 仓库说明
```

新增文档请放入对应目录（模块内可继续建子目录），勿新造顶层目录。各模块文档
遵循「直觉 → 原理 → 工程取舍 → ▶ 面试题标注 → 追问」，配 mermaid 图，链接
用相对路径。

## 构建与测试

- **无构建系统，无测试，无 CI/CD**。这是一个纯文档仓库，不存在需要运行的构建
  或测试命令。
- 若未来在 `coding/` 中加入可运行的代码题解，请在对应文件中（或本文件中）
  注明运行方式；不要为整个仓库引入统一的构建配置。

## 写作与代码约定

- 文档统一使用 Markdown，每篇文档自成一体，直接按目录翻阅即可。
- 文风与 README 保持一致：中文为主、轻松直率，技术术语可保留英文原文
  （LLM、Agent、Transformer、RLHF 等不必翻译）。
- 面经内容必须**脱敏**：隐去面试官个人信息、涉密业务数据等；不保证 100%
  还原现场，但不得编造题目。
- 文件名建议使用「公司-日期」或「主题」式的自描述命名（README 约定的组织方式）。

## 安全注意事项

- 面经属脱敏数据：任何新增内容在提交前自行检查是否包含未公开的薪资数字、
  内部系统名、他人隐私等敏感信息。
- 不要往仓库里提交任何凭证、密钥文件；`.gitignore` 已覆盖常见编辑器与临时
  文件，如需忽略更多类型，直接补充 `.gitignore`。

## 贡献方式

- 发现错误欢迎提 issue / PR；分享面经同样欢迎 PR（记得脱敏）；想看某个方向
  的整理，开 issue 许愿。
