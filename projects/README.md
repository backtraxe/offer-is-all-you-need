# 项目篇章导读：让面试官能连续追问 20 分钟的项目长什么样

> 本篇面向「简历上没有对口项目 / 项目讲不深」的读者。素材来自：
> GitHub 实测调研（star / good first issue 均为 2026-10 当日值）、
> 小红书面试官视角帖（「很多问题水平一眼假」的清单）、以及仓内
> [小红书社招面经合集](../interview-experiences/小红书社招面经合集-2026h2.md)
> 里项目追问高频点。读完你会获得：一份按方向分级的**项目选型总表**、
> 每条方向 4 周的**落地套餐**、面试官「三层讲法」与防造假追问的
> 一个标准自查清单。简历怎么写见姊妹篇 [resume/](../resume/README.md)。

## 一、面试官到底在测什么：三层讲法

一位面试官视角帖的原话：**「九成人只留在第一层」**。所有 LLM/infra
项目面试天然分三层：

| 层 | 表现 | 结果 |
|---|---|---|
| 功能层 | 会搭 RAG、会调 Agent、能跑通流程，"我用 LangChain 实现了知识库问答" | 会用但没思考，及格都够刑不上 |
| 设计层 | 为什么选这个切片策略、为什么用这个 embedding、为什么走 RAG 不走微调、什么参数怎么调的 | 及格线——可评估的决策过程 |
| 工程层 | 准确率/延迟/token 成本/并发吞吐怎么测的；异常降级/失败重试/线上监控/迭代闭环怎么搭的 | 拿高分——说明你在真实环境里趟过水 |

**高分讲法的模板**永远是倒推的决策链：业务痛点 → 为什么用大模型
→ 选型依据（还对比过什么）→ 关键参数怎么调的 → badcase 怎么排查
→ 最终指标提升多少。**「这个常用、网上都这么写」在面试里等于零分**。

## 二、防造假追问：书写器老僧三问

小红书「几个问题，造假简历项目就现行」贴的框架，反过来就是你的
项目自查清单。以"长上下文项目"为例，真做过与包装的差别：

1. **最大难点是什么？** ❌ "训练资源"（这是所有长训的共性，不是
   项目特有难点）；✅ 讲出一个该项目**特有的技术难点**（如短能力
   回退：长数据比例一上，短任务掉点 → 配比回放 + 长度课程拉回来）。
2. **数据/材料从哪来、怎么配？** ❌ 按长度配（"书籍代码 60% 短文 40%"，
   一问"你们哪类能力最弱、如何定向补数据"就愣住）；✅ **按能力配**：
   先拆能力（信息检索/多跳推理/跨段聚合/长代码依赖）→ 哪差修哪
   （合成定向问答对）。**按能力配比 vs 按长度配比是真假分水岭**。
3. **怎么证明真能用？** ❌ "RULER 总分 90 多"；✅ 记住垫底的子任务：
   "检索能撑满 128K 但多跳推理有效长度只有 40K、变量追踪掉了 20 点、
   lost-in-middle 在 60K 有个坑"——**记住的不是总分是短板**，因为短板
   才是你下一步迭代的依据。

**自查程序**：写完简历找个朋友或 AI 按这三问打两遍，任何一层卡住，
项目就不该上简历。

## 三、选型原则：四条硬指标

对每个候选项目打分（1-5），又在面试胜率才是唯一标准：

1. **深挖空间**：能不能撑起 5 层连续追问（机制 + 数学 + 工程细节 +
   trade-off + 失败案例）——这是唯一一票否决项；
2. **稀缺性**：面试官是不是已经看过一百份一样的（rasbt/nanoGPT 这种
   全网爆款默认"看过"，必须做**增量改造**才有区分度；tiny-llm/llm.c
   这种尚未烂大街的，做完本身即是差异化）；
3. **工程完整性**：有没有 benchmark、profiling、失败处理代码、
   评估集回归——四件套至少俩，不然说不上「工程层」；
4. **投入产出**：4 周内能不能交付。做不完的项目等于没项目。

组合法则：**⭐ 高爆款 = 必做改造；⭐ 中爆款 = 本身就是差异化**。
一个主项目（深挖空间满分）+ 一个副件（benchmark/PR/评估组件）的
"1+1 套餐"优于两个半成品。

## 四、项目选型总表

<div class="diagram-embed">
<iframe src="assets/diagrams/projects-landscape.html" width="100%" height="820" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/projects-landscape.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

| 方向 | 项目 | repos | star | 投入 | 深挖维度指针 | 性价比 |
|---|---|---|---|---|---|---|
| 推理 infra | tiny-llm（tiny vLLM 课程体系） | skyzh/tiny-llm | 4.8k | 4-6w 压缩 | 调度/KV/量化/MoE/前缀缓存全覆盖 | 5 |
| 推理 infra | nano-vllm（复刻+增量） | GeeeekExplorer/nano-vllm | 15.7k | 2-3w | continuous batching/BlockManager/CUDA Graph/TP | 5 |
| 推理 infra | mini-sglang（官方 mini 版） | sgl-project/mini-sglang | 5.2k | 3-5w | RadixCache/chunked prefill/offload | 5 |
| 推理 infra | llama2.c（C 推理+int8） | karpathy/llama2.c | 20k | 1w | 访存/量化/KV C 层布局 | 4 |
| kernel | llm.c（C/CUDA 训练 kernel） | karpathy/llm.c | 31k | 2-3w | fused kernel/occupancy/带宽 | 4 |
| kernel | Liger-Kernel + 接入实测 | linkedin/Liger-Kernel | 6.6k | 0.5-1w | kernel fusion 显存/吞吐账 | 4 |
| kernel | GPU MODE 题集 | gpu-mode/reference-kernels | 315 | 按题 | Triton 调参/autotune | 4 |
| 模型训练 | LLMs-from-scratch | rasbt/LLMs-from-scratch | 106k | 3-4w | MHA→GQA→MLA/RoPE/KV cache 手撕 | 4（烂大街需改造） |
| 模型训练 | minimind（2 小时训 64M 全链路） | jingyaogong/minimind | 63k | 1-2w | DPO/GRPO 手写+RL 坑实战 | 4.5 |
| 模型训练 | nanoGPT + sizing notebook | karpathy/nanoGPT | 64k | 1-2w | 6ND 算量/初始化/调度器 | 4（烂大街需改造） |
| Agent | OpenManus + 工程硬化 | FoundationAgents/OpenManus | 58.6k | 1w | 工具容错/成本护栏/step 记账 | 5 |
| Agent | smolagents 范式对比 | huggingface/smolagents | 29.8k | 0.5-1w | CodeAct vs JSON-FC A/B 量化 | 4 |
| Agent | 自写 MCP server | modelcontextprotocol/servers 参考 | 91k | 1w | 工具描述工程/权限围栏/分页 | 5 |
| Agent | deep-research 两种形态对照 | dzhng/deep-research（20k）+ assafelovic/gpt-researcher（30k） | — | 1-2w | 预算控制/引用幻觉检测 | 4 |
| Agent | OpenHands 子系统精读 | OpenHands/OpenHands | 90.4k | 2w+ | 事件溯源/压缩/沙箱 | 3 |
| RAG | 垂直语料生产级链路（自研） | 不推荐找现成模板 | — | 2w | 混合检索/rerank/citation/eval 回归 | 5 |
| 评估组件 | langfuse/promptfoo/ragas | — | 36k/26k/16k | 0.5w | trace/成本看板/CI 回归 | 5（副件） |

两张非常非常加分但成本几乎为零的"副件"，推荐给所有方向：

1. **vLLM/SGLang 源码 PR**：2026-10 两边各有十几二十个 good first
   issue（vLLM 侧文档/量化 config refactor/KV-cache 抽取；SGLang 侧
   profiling/文档/cookbook）。**合入一个 PR 的信号强度大于全部玩具
   项目加和**；没合入也成立——带 issue 讨论链接上讲。指路
   [推理引擎选型与源码路线](../interview-questions/inference/推理引擎选型与源码路线.md)。
2. **benchmark 报告**：任何项目后面挂一节"实验报告"——不同并发下的
   吞吐/TTFT/TPOT 曲线 + KV 打满点 + roofline 分界。"你怎么知道瓶颈
   在哪"的标准答案。工具用脚注意 vLLM 官方 `benchmark_serving.py` 与
   ninehills/llm-inference-benchmark。

## 五、按方向的四条落地路线

四篇详解里给出每个项目的面试追问预演与包装话术：

- [推理引擎实战](./推理引擎实战.md)：tiny-llm 或 nano-vllm/mini-sglang
  二选一为主，llama2.c/llm.c/Liger 补 kernel 谈资，PR 收尾；
- [从零造轮子：模型与训练](./从零造轮子.md)：LLMs-from-scratch /
  nanoGPT / minimind / llms-from-scratch-cn，重点讲"烂大街怎么救"；
- [Agent 与 RAG 实战](./agent与rag实战.md)：OpenManus 硬化 +
  MCP server 自写 + 垂直 RAG 评估链，配上深 research 对照;
- [简历篇章](../resume/README.md)：上述项目落地成简历 4 段式
  （背景→难点→工作→成果量化）的写作模板与分方向范文。

## 六、红线提醒（防止面试翻车的最后三条）

1. **时间不足的削减顺序**：先砍 TP 与 CUDA Graph，保住
   "调度器 + BlockManager + benchmark" 三件套即可讲满 20 分钟；
2. **没 GPU**：GPU MODE Discord 有 T4 时长领；repo 里的代码 +
   带数据的结论即可被接受（"代码在仓库里、结论有数据"）；
3. **写上简历的所有数字必须可复现**——简历上的"提升 60%"被追着
   问"度量口径/env/消融"答不上时扣双倍分。口径参考
   [infra面试计算题专项](../interview-questions/inference/infra面试计算题专项.md)
   的压测口径一节。
