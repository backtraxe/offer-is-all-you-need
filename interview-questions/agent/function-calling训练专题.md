# Function Calling 训练专题：格式谱系、可验证合成数据与 BFCL 判分

> **面向**：已读过 [工具调用与mcp](./工具调用与mcp.md)（推理链路）与
> [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)（FC vs MCP 分层）的
> 读者。那两篇讲「协议与链路」，本篇往下钻模型侧——各家 tool call 文本
> 长什么样、训练数据怎么造、约束解码怎么兜底、BFCL 怎么打分。协议对比
> 不重复，本篇只串联。
>
> **读完获得**：① 「模型侧没有任何协议，只有约定」的直觉与四派格式方言
> （OpenAI JSON schema / Claude tool_use 块 / Hermes XML-ish / xLAM
> 四段式）；② 并行、嵌套、拒调三类编码约定与 BFCL 类目的一一对应；
> ③ 训练谱系时间线（Toolformer→Gorilla→ToolBench→APIGen→ToolACE→
> xLAM→Qwen3 口径），合成数据 pipeline 五步配方与拒绝采样；④ 约束解码
> （Outlines/GBNF/xgrammar/vLLM 结构化输出）的机制一句话与代价谱；
> ⑤ BFCL V1→V4 编年、AST/exec/state-based 三种判分形态、V4 加权公式；
> ⑥ 两个必答题的完整答法——「模型为什么会在 JSON 上错乱」「怎么训练
> 才不幻觉工具」。
>
> **时效口径**：素材时间轴从 2023-06 OpenAI function calling API 到
> 2025-07 BFCL V4；全部数字按模型卡/论文/官方文档口径括注年份，榜单
> 分数必须带「截至某年某月」引用，跨版本不可比。BFCL 官方口径只到
> **V4**（榜单页 2026-10 抓取，PyPI bfcl-eval 2025.12.17），网传 v5
> 无一手来源，本篇不引用不编分，详见文末「口径与未核实说明」。

## 一、直觉：tool call 终究是一段文本

模型从来不知道「协议」两个字。所谓 function calling，本质只有两件事——
**请求里把工具 schema 塞给模型，响应里让模型按规定格式吐一段结构化文本**。
所有格式差异（OpenAI 的 tool_calls 数组、Claude 的 tool_use 块、Hermes
的 XML 标签、xLAM 的拼接 prompt）都发生在同一层：chat template、特殊
token、解析器。推理引擎看到的就是普通 token 流，「调用工具」是宿主
进程 parse 完这段文本之后替模型做的事。

这个视角解释了三个面试高频现象：

1. **JSON 乱不是模型笨，是训练分布薄**。FC 数据在通用语料里占比极低，
   纯预训练模型没见过「schema→JSON arguments」的映射，格式要靠 SFT
   数据灌出来；
2. **换格式就崩是常态**。模型学到的大多是表面模板而非 schema 约束，
   BFCL V4 专门用 26 种格式配置 × 200 条量化这件事（§五）；
3. **约束解码救不了语义**。服务端可以把 JSON 保证到 100% 语法合法，
   但参数值填错、工具选错照样发生（§四）。

本篇的隐含主线由此展开：格式谱系讲「文本长什么样」（§二），训练谱系
讲「模型怎么学会写这种文本」（§三），约束解码讲「学不会的部分怎么
兜底」（§四），BFCL 讲「学成什么样算好」（§五）。

<div class="diagram-embed">
<iframe src="assets/diagrams/fc-training-lineage.html" width="100%" height="880" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/fc-training-lineage.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、格式谱系：四派文本方言

### 2.1 OpenAI tools JSON schema（事实标准）

OpenAI 2023-06 上线的 function calling API 是格式层的事实起点，请求/
响应/回填三段约定沿用至今：

- **请求侧**：`tools` 数组，每项为
  `{"type":"function","function":{"name","description","parameters":<JSON Schema>}}`，
  parameters 走 JSON Schema 子集（type/properties/required/enum/description）；
- **响应侧**：assistant message 带 `tool_calls` 数组，每项含 `id`
  （call_xxx，回填配对用）、`function.name`、`function.arguments`——
  注意 **arguments 是 JSON 字符串而不是对象**，解析器要多一次反序列化；
- **回填侧**：role=tool 的 message，带 tool_call_id + name + content。

两个后续里程碑：

- **并行调用（2023-11 devday 起 native 支持）**：一次响应吐多个
  tool_calls 元素，`parallel_tool_calls=false` 可关；
- **Structured Outputs（2024-08）**：
  `response_format={"type":"json_schema","strict":true}`，官方承诺
  100% 遵守 schema——闭源把约束解码做到了服务端（§四）。strict 模式
  对 schema 有限制：required 必须列全部字段、additionalProperties 为
  false 等。

### 2.2 Claude tool_use / tool_result 块（Anthropic）

Claude 的约定与 OpenAI 结构差异显眼，字段名和嵌套方式都不一样：

- **请求侧**：`{"name","description","input_schema":<JSON Schema>}`——
  schema 字段叫 input_schema 且平铺，不嵌在 function 里；
- **响应侧**：content 是块数组，工具调用是
  `{"type":"tool_use","id","name","input":<对象>}`——input 直接是
  对象而非字符串，stop_reason 置 tool_use；
- **回填侧**：user message 的 content 里放
  `{"type":"tool_result","tool_use_id","content"}` 块；
- **tool_choice 四档**：auto / any / tool / none；默认 auto 下由模型
  每轮自行决定调不调，官方文档（2026-10 抓取）明确 system prompt 可
  调高调用倾向。

数字锚（Anthropic 官方文档，截至 2026-10 抓取）：工具调用会自动附加
一段隐藏 system prompt 教模型用工具，**各家附加预算为：Opus 4.1 与
Sonnet 4 在 auto/none 档 313 token、any/tool 档 315 token，Haiku 3.5
为 264/355 token，Opus 4.7 达 675/804 token。**这是「工具 schema
之外还有隐藏注入开销」的官方证据，面试讲 token 成本可直接引用。
并行调用形态：一个响应里允许多个 tool_use 块。

### 2.3 Hermes XML-ish：开源事实方言

NousResearch Hermes-2-Pro-Llama-3-8B（2024，模型卡）定下了开源侧的
主流写法：

- ChatML 外壳（`<|im_start|>`/`<|im_end|>`），FC 靠专用 system prompt
  加三个新增**单 token** `<tool_call>`、`<tool_response>`、`<tools>`
  及闭合标签——单 token 设计就是为了流式解析好做；
- 输出形态：`<tool_call>\n{"arguments": {...}, "name": "func_name"}\n</tool_call>`，
  即「JSON 内容、XML 栅栏」的 XML-ish 混写；
- 回填约定对齐 OpenAI 消息结构：tool call 作为 assistant 消息的
  tool_calls key，结果用 role=tool 回填。

数字锚（Hermes-2-Pro 模型卡，2024）：与 Fireworks.AI 共建评测，
**函数调用评测 90%，结构化 JSON 输出评测 84%。**

Qwen2.5/Qwen3 系列沿用 Hermes 格式：chat template 把 tools 列表序列化
进 system 段的 `<tools>...</tools>`，模型吐 `<tool_call>{json}</tool_call>`。
Qwen3 模型卡（2025 抓取）官方推荐用 Qwen-Agent 封装模板与解析器，
不暴露底层格式细节。DeepSeek 的 API 兼容 OpenAI tools 格式，开源权重
则靠 chat template + prompt 约定，社区通用 Hermes 式模板。MiniCPM 系
同样走标签 JSON 流派。**开源侧基本收敛到 Hermes 式标签 JSON、消息结构
对齐 OpenAI，这一句可以当结论背。**

### 2.4 xLAM 四段式：拼接 prompt 流派

Salesforce xLAM（模型卡抓取）不走 chat template 内嵌 schema，而是
显式拼接式 prompt，四段分界：`[BEGIN OF TASK INSTRUCTION] /
[BEGIN OF AVAILABLE TOOLS] /[BEGIN OF FORMAT INSTRUCTION] /
[BEGIN OF QUERY]`，schema 转成更紧凑的 xLAM 自定义格式后注入；输出为
纯 JSON `{"tool_calls":[{"name","arguments"}]}`，无需工具时输出空
列表 `[]`。

最值得记的是 task instruction 里明文写了拒调语义：

> If none of the functions can be used, point it out and refuse to
> answer. If the given question lacks the parameters required by the
> function, also point it out.

**无关工具拒绝、缺参拒绝是训练出来的指令遵循，不是天然能力。**
这句话是回答「怎么训练不幻觉工具」的题眼（§六 Q2）。

### 2.5 并行、嵌套、拒调：三类编码约定

- **并行（parallel）**：同一回合内多个互相独立的调用。OpenAI 是
  tool_calls 数组多元素；Hermes 式是连续多个 `<tool_call>` 块；
  xLAM 是 tool_calls 列表多元素。BFCL 的 Parallel 类目专测「一个需求
  显式要求多次调用」（查北京和上海天气→两次 get_weather）；
  Parallel Multiple（多函数中选对函数 × 并行多次）是最难的单轮子类；
- **嵌套/依赖（dependent）**：ToolACE 论文（arXiv:2409.00920，2024-09）
  术语——parallel function calls 指一回合多个独立调用，dependent
  function calls 指顺序调用链、后续调用依赖前序输出。注意嵌套在文本
  协议里不是真的「参数套函数」，而是**回合间依赖**，BFCL V3 用多轮
  多步来测；
- **无关工具拒绝（irrelevance/relevance）**：BFCL V1 起就有的检测项——
  给一堆工具但问题根本不需要工具（如「你好吗」），期望输出自然语言而
  非函数调用。xLAM 把 refuse to answer 写进 task instruction 正是对
  这一类目的显式对齐。

## 三、训练谱系：FC 能力是被「喂」出来的

### 3.1 先驱时代（2023）：强模型合成 + 弱模型蒸馏

- **Toolformer（Meta，2023-02）**：自监督自举——给语料让模型自己决定
  在哪插 API 调用，用「API 返回值是否降低后续 token 的 loss」过滤样本。
  证明了「何时调」可以被训出来，但只支持单 API 单参数、无对话；
- **Gorilla（Berkeley，arXiv:2305.15334，2023-05）**：LLaMA-7B 微调，
  在自建 APIBench（HuggingFace/TorchHub/TensorHub 三库 API 集合）上
  生成准确 API 调用超过 GPT-4；首创 **retrieval-aware 训练**——训练时
  把 API 文档塞进上下文，因此对测试期文档变化鲁棒，并显著降低幻觉。
  论文原话级要点：GPT-4 级别模型也会「generate accurate input
  arguments 失败 + 幻觉错误 API 用法」，微调 + 文档检索是当时的两味
  解药。开源第一波「专用 FC 小模型」热潮由此开始；
- **ToolLLM / ToolBench（清华等，arXiv:2307.16789，2023-07）**：
  RapidAPI Hub 采集 **16,464 个真实 RESTful API、49 类**；ChatGPT
  合成单/多工具指令；核心创新 DFSDT（depth-first search-based
  decision tree），让 ChatGPT 搜索多条推理路径标注有效解；配 ToolEval
  自动评测。ToolLLaMA 基于 LLaMA-7B 微调加神经 API retriever。局限
  明显：数据全靠 ChatGPT 蒸馏，**正确性无执行验证，轨迹噪声大**——
  这正是 2024 年要解决的问题；
- 同期的 API-Bank、ToolAlpaca 思路类似：强模型合成 + 弱模型蒸馏。

### 3.2 可验证合成数据时代（2024 分水岭）

**APIGen（Salesforce，arXiv:2406.18518，2024-06）** 是本篇最重要
引文之一，它把「合成数据必须过执行验证」变成共识：

- 规模：3,673 个可执行 API、21 类；发布 60,000 条高质量数据
  （xlam-function-calling-60k，CC-BY-4.0）；
- **三层级联验证**：① format checking（JSON 合不合法、schema 匹不
  匹配）→ ② actual function execution（真跑 API，看抛不抛错）→
  ③ semantic verification（LLM judge 检查问答-调用一致性）；
- 战绩（2024-06 论文口径）：7B 的 xLAM 在 Berkeley FC Benchmark 上
  超过多个 GPT-4 变体；1B 模型超过 GPT-3.5-Turbo 和 Claude-3-Haiku。

**xLAM 系列（arXiv:2409.03215，2024-09 论文；模型卡 2024-07 抓取）**：

- 家族：xLAM-1b-fc-r / xLAM-7b-fc-r（2024-07-17，fc 系列基于
  deepseek-coder 微调，主打端侧）；xLAM-7b-r / 8x7b-r / 8x22b-r
  （2024-09-05）；xLAM-v0.1-r（2024-03-18）；
- 数字锚（模型卡，BFCL 截至 2024-07-18 口径，temperature=0.001，
  top_p=1）：**其中 xLAM-7b-fc-r 总分 88.24% 列榜单第 3，同系
  xLAM-1b-fc-r 总分 78.94%，是榜上唯一小于 2B 的模型且超过
  GPT-3.5-Turbo。**
- 许可注意：CC-BY-NC-4.0 + DeepSeek 许可附加条款，商用受限——
  面试聊「开源 FC 模型选型」时值得点一句；
- 2025 后续：APIGen-MT（多轮 FC 数据 pipeline）与 ActionStudio
  （arXiv:2503.22673，2025-03，轻量 action 模型数据与训练框架）。

**ToolACE（华为诺亚等，arXiv:2409.00920，2024-09；ICLR 2025 收录）**：

- 定位：自动 agentic pipeline 生成「准确、复杂、多样」的工具学习
  数据，明确提出 parallel 与 dependent function calls 的区分；
- 方法要点：tool self-evolution synthesis（TSS，从 API 子集演化出
  更多样的工具说明书）；多智能体对话生成（planner/caller/executor
  分工模拟真实交互）；双重验证（format/general 规则层 + execution
  执行层）；复杂度用「调用链与参数依赖图」刻画；
- 数字锚（2024-09 论文口径）：**基于 LLaMA-3.1-8B 微调的 ToolACE-8B
  在 BFCL 上达当时 8B 规模 SOTA，超过多个闭源模型；**数据规模约
  11.3 万条对话级样本（论文口径）。

**Hermes function-calling（NousResearch × Fireworks，2024）**：
OpenHermes-2.5 数据加自建 FC/JSON-mode 数据集微调 Llama-3-8B，带
执行校验下函数调用评测 90%、JSON 输出 84%（模型卡口径）。意义在于
证明**通用对话模型加一坨 FC 数据即可兼得，FC 不必以通用能力换**——
后来的 Qwen、GLM 等开源模型都是这条路线。

### 3.3 闭源/官方 2025 口径

- **Qwen3（2025-04/05，模型卡与技术报告 arXiv:2505.09388）**：官方
  话术「Expertise in agent capabilities, enabling precise integration
  with external tools in both thinking and unthinking modes」，FC 走
  Hermes 式模板，推荐 Qwen-Agent 封装；
- **DeepSeek**：API 侧完全 OpenAI 兼容；开源侧社区公认 V3 早期 FC
  不稳（漏 tool_calls、arguments 转义问题），靠模板 + 提示词缓解；
  R1 系不以在线工具调用为强项——面试可讲**推理模型不等于工具模型，
  RL 主练的是思维而不是 schema 遵循**；
- **OpenAI**：2024-08 Structured Outputs 与之后的 strict function
  calling，约束解码下沉到服务端；
- **Anthropic**：tool_use token 预算公开（§2.2 数字锚），并支持
  fine-grained tool streaming 流式吐参数 JSON。

### 3.4 合成数据 pipeline 通用配方（可以直接背）

「agent 数据怎么造」的标准答案，综合 Gorilla→ToolBench→APIGen→
ToolACE 的演化：

1. **工具池**：真 API（RapidAPI 1.6 万级）或自造 API 代码库
   （BFCL V3 手写 8 域 API）；
2. **指令/查询生成**：persona 多样化（BFCL V3 用 Persona Hub 造不同
   职业/年龄的用户口吻），单工具→多工具→并行→依赖链递增复杂度；
3. **轨迹生成**：强模型直接标（ChatGPT/GPT-4），或 DFSDT 搜索解
   空间，或多智能体分工模拟（planner/caller/executor）；
4. **验证（2024 后的硬门槛）**：格式检查 → 真实执行 → 语义 judge
   三层级联；配**拒绝采样**——同题采样多条，只留通过验证的；
5. **拒调/异常负样本**：显式造「无关工具拒绝」「缺参反问」「missing
   function 声明不可用」三类，否则模型只会永远调一个。

数字锚速查：**谱系接力为 Gorilla/APIBench 三库（2023），ToolBench
16,464 个 API 与 49 类（2023-07），APIGen 3,673 个 API 与 6 万条
（2024-06），ToolACE 约 11.3 万条对话（2024-09），xLAM-7b-fc-r
88.24% 与 xLAM-1b-fc-r 78.94%（2024-07-18 榜单口径）。**

## 四、约束解码：保 JSON 合法的机制与代价

### 4.1 机制一句话与谱系

核心机制一句话：**给违法 token 判死刑——constrained/guided decoding
每步把「会导致违反语法」的 token 的 logit 置为负无穷，使采样只剩
合法 token**；合法性来源是正则或上下文无关文法（CFG）被编译成的
自动机/token 掩码。

谱系与代表实现（按时间）：

- **Outlines（arXiv:2307.09702，2023-07）**：把生成重述为有限状态机
  状态转移；对正则和 CFG 建词表索引（token→允许的 FSM 转移），解码
  时查表做 logit mask。论文口径几乎无额外开销，是 HF 生态结构化输出
  的老牌实现；
- **GBNF（llama.cpp，2023 起内置）**：用类 BNF 语法文件描述 CFG，
  服务端 `--grammar`/`--json-schema`（schema 自动转 GBNF）约束生成，
  是本地部署 GGUF 量化模型保 JSON 合法的主力手段；
- **lm-format-enforcer（2023）**：token 级强制 JSON Schema，支持
  llama.cpp/HF/vLLM 后端，特点是边生成边校验、出错时引导恢复；
- **xgrammar（MLSys 2025，arXiv:2411.15100，MLC 团队）**：把词表分
  成上下文无关 token（可预检）与上下文相关 token（运行时解释），
  预编译吃掉大部分掩码计算，加 persistent stack 加速逐 token 检查，
  并与推理引擎 co-design 把文法计算与 GPU 执行重叠。数字锚（论文
  口径）：**相对既有方案最高 100 倍加速，接入推理引擎后端到端结构化
  生成近零开销。**
- **SGLang**：grammar backend 默认走 xgrammar（0.4 起，可选
  outlines），结构化输出在 RadixAttention 前缀缓存下仍高效；
- **vLLM（官方文档，2026-10 抓取）**：Structured Outputs 支持
  choice/regex/json/grammar/structural_tag 五种；后端 xgrammar 或
  guidance（默认 auto）；v1 默认 xgrammar；API 层支持 OpenAI
  response_format=json_schema 并返回已 parse 的 pydantic 对象。注意
  v0.12.0 起 guided_json/regex/grammar 等老字段删除，统一到
  structured_outputs 参数；Qwen3-Coder 带 reasoning 时需
  `--structured-outputs-config.enable_in_reasoning=True`；
- **OpenAI 服务端（2024-08 起）**：strict 模式承诺 100% schema
  遵守——闭源同样把约束解码做到了服务端。

### 4.2 代价与坑（面试加分点）

- **性能代价谱**：早期方案每步对全词表跑语法检查（论文称
  non-negligible overhead）；Outlines 预编译 FSM 后查表成本小；
  xgrammar 把大部分工作摊到离线预检做到近零开销。工程上 constraint
  会打断「连续字符串被合并成单 token」的贪心路径，部分实现把拼接
  token 拆开重新校验，吞吐仍可能下降约一到三成（实践口径，非论文
  数字，见文末说明）；
- **约束不等于正确**：约束解码只保证语法合法（合法 JSON、字段在
  schema 里），不保证值正确——参数填错、工具选错、幻觉枚举值照样
  发生。这是「为什么开了结构化输出还会幻觉工具」的标准答案；
- **语法表达力局限**：JSON Schema 子集能编译进 CFG，但跨字段语义
  约束（如 start_date 必须早于 end_date）表达不了，只能靠训练或
  校验兜底；
- **与推理模式冲突**：reasoning 模型的 think 段与 JSON 约束的交互
  要额外处理（vLLM 的 enable_in_reasoning 开关就是证据）。

## 五、评测：BFCL V1→V4 编年与判分口径

BFCL 论文：Patil 等，ICML 2025（《The Berkeley Function Calling
Leaderboard: From Tool Use to Agentic Evaluation》）。榜单页
（2026-10 抓取）仍标注 V4。

### 5.1 版本编年

**V1（2024-02 上线）**：标志创新是 **AST 评测**——把模型输出的函数
调用 parse 成抽象语法树与 ground truth 子树匹配，解决「字符串匹配
太脆」的问题；类目：Simple / Multiple（多工具里选对）/ Parallel
（一次多调）/ Parallel-Multiple；带 Irrelevance（无关工具拒绝）与
Relevance 检测；语言覆盖 Python/Java/JavaScript。

**V2（2024-08）**：引入 Live 类目——企业工程师与社区用户贡献的真实
场景函数；live 数据滚动更新防污染；live 类目判分用加权平均。

**V3（2024-09-19 发布）**：多轮 + 多步时代：

- 新增类目：Base（200 条，信息完整）+ Augmented 四类各 200——
  Missing Parameters（缺参应反问而不是瞎编）、Missing Functions
  （工具列表故意不全，应声明缺工具）、Long-Context（海量干扰下取
  关键参数）、Composite（三者叠加）；
- **判分革命**：不再只比 AST——state-based evaluation（真实执行
  调用后比对后端系统状态，如文件系统/订票系统）+ 子集匹配的
  response-based evaluation（模型轨迹必须包含 ground truth 最小
  必要调用集，允许多余探索步，不惩罚错误恢复）；单轮 20 步强制
  终止并判错；
- 数据手工建：8 个 API 域（Vehicle Control / Trading Bots / Travel
  Booking / Gorilla File System 四主 + Message/Twitter/Ticket/Math
  四辅），构图采样执行路径，Persona Hub 造用户口吻，人工标注 GT
  轨迹 + 11 轮数据过滤；
- 总分构成（博客口径）：**总分 4441 条 = Non-Live 单轮 1390
  （AST 1150 + 幻觉相关 240）+ Live 2251（AST 1351 +
  relevance/irrelevance 900）+ Multi-Turn 800；**
- 明确禁用 ReAct 等 prompt 技巧，裸测模型。

**V4（2025-07-17 发布，分三篇：Web Search / Memory / Format
Sensitivity）**：定位「holistic agentic evaluation」：

- 新 Agentic 类目 = Web Search（200 条：100 多跳问答，含/不含
  snippet 两种）+ Memory（465 条：vector store / kv store /
  rec-sum 各 155）；
- Web search 细节：DuckDuckGo API + fetch_url_content（raw/markdown/
  truncate 三模式）；故意注入随机故障（503/429/403/超时类）测鲁棒
  性；多跳问题递归生成，100 条人工多跳题；判分 exact-match on
  answer 字段（小写化 + 去标点归一）。对照实验：禁用工具后准确率
  暴跌，证明模型确实在用搜索；**去掉 snippet 后部分模型被迫 fetch
  URL 反而答对（snippet 里两个数字诱导错选）——极佳的面试案例**；
- Format Sensitivity 类目（不计总分）：**整套实验为 26 种格式配置
  × 200 条共 5200 条，**系统性变换 ret_fmt（python/json）、
  tool_call_tag（有无）、func_doc_fmt（json/xml）、prompt_fmt
  （markdown/plaintext）——直接量化「模型对格式扰动的敏感度」，
  回答「换种 schema 呈现方式模型就崩」的痛点；
- 总分公式（博客口径，5088 条计分样本）：Overall = Agentic × 40% +
  Multi-Turn × 30% + Live × 10% + Non-Live × 10% + Hallucination
  × 10%；**其中 Agentic 与多轮两项合计占七成，是 V4 权重的主体；**
  幻觉测量 1122 条（non-live irrelevance 240 + live irrelevance
  882），另有 Relevance 18 条；
- 观察到的失败模式（博客原案例）：避免用工具依赖参数化记忆；对未来
  事件的错误假设（如认定某赛季还没开始）；多跳问题整段塞进单次
  搜索（不拆子问题）；误读网页内容。

### 5.2 历年分数体感锚（不可跨版本直接比）

- 2024-07：**榜单第 3 由 xLAM-7b-fc-r 占据，总分 88.24%；同系
  xLAM-1b-fc-r 为 78.94%（模型卡口径）。**
- 2024-09（V3 上线）：多轮类目引入把头部模型总分显著拉低，
  multi_turn 子项当时头部仅五六成（博客误差分析显示顶级模型仍犯
  「不查当前状态就写」「乱编造身份凭据」的错）；
- 2025-07（V4）：Agentic 类目（web search + memory）成为新的区分度
  来源。V4 总分头部水平以榜单页为准（本次抓取榜单为 JS 渲染未取到
  表，故本篇不引具体分）。

### 5.3 BFCL 之外的评测与对照

- **ToolEval（ToolLLM，2023）**：pass rate + win rate，LLM judge
  性质强，复现性受争议——BFCL 博客对照表把它归为「Synthetic
  curation + Human validation」；
- **τ-bench（Sierra，2024）**：对话式 agent 与模拟用户在政策约束
  下完成零售/航空任务，测 policy 遵循；
- **API-Bank（2023）、Seal-Tools（2024）、StableToolBench（2024）**：
  后者给 ToolBench 换稳定后端补缓存；
- BFCL V3 博客横向对比（2024-09 口径）：BFCL-v2 无 multi-step/
  multi-turn；AgentBoard 有 multi-step 无 multi-turn；τ-bench 有
  multi-turn 但无 irrelevance/long-ctx；**只有 BFCL V3 六项全齐
  （multi-step、multi-turn、implicit action、self-correct、
  irrelevancy、long ctx）。**

## 六、▶ 面试题（两个必答 + 四个快问）

**Q1【极高】模型为什么会在 JSON 上错乱？**
分四层答：① 训练分布层——FC 数据在语料里占比极低，纯预训练模型
没见过「schema→JSON arguments」的映射；SFT 数据格式单一时模型学到
表面模板而非 schema 约束，换格式就崩（BFCL V4 format sensitivity 的
26 种配置 × 200 条就是量化这个）。② 采样层——temperature 大于 0
时括号/引号/逗号的采样错误累积，长 JSON 错误率指数上升，没有约束
解码就是逐 token 走钢丝。③ 语义层——参数值要从上下文抽取加类型
转换（「下周三」→日期字符串、城市名→枚举值），任何一步幻觉都会
产出合法但错误的 JSON，约束解码救不了语义。④ 结构层——tokenizer
把 JSON 切得七零八落，「合法前缀」信息弱；多对象并列（parallel
call）时边界 token 的训练信号稀薄。对策组合：格式多样化 SFT（26 种
配置的启示）+ 严负样本（拒调/缺参反问）+ 服务端约束解码
（strict/xgrammar/GBNF）+ 校验-重试 loop（参数校验失败把错误塞回
context 自纠，BFCL V3 的 API 报错设计即鼓励 self-correct）+ 温度
调低（xLAM 评测用 temperature=0.001）。（§一、§四）

**Q2【极高】怎么训练才不幻觉工具？**
四侧作答：① 数据侧——可验证合成（APIGen 三层验证：format→
execution→semantic，2024-06）+ 拒绝采样；负样本三件套（无关工具
拒调、缺参反问、missing-function 声明）；Gorilla 2023 的
retrieval-aware 训练让模型依赖上下文文档而非记忆，天然抗幻觉。
② 行为侧——显式教「探索先行」：BFCL V3 state-based 评测抓出的
失败模式（不 pwd 就 mkdir、不查燃料就加满）说明 GT 轨迹要包含
「先读后写」的习惯；多轮数据用 ToolACE 式 agentic 生成。③ 推理侧
兜底——tool_choice=none/auto 的 system prompt 级控制；约束解码保
语法；执行沙箱把报错回灌（self-correct loop）。④ 评测闭环——用
BFCL 类目语言说话：AST（单轮选对填对）、irrelevance（不该调时
不调）、multi-turn state（多轮最终结果对）、agentic（搜索/记忆
整合）。引用数字务必带版本与时间：xLAM 88.24% 是 2024-07 口径，
ToolACE-8B 的 8B 级 SOTA 是 2024-09 口径。（§三）

**Q3【高】OpenAI 和 Claude 的工具调用格式差在哪？**
三点：schema 字段位置（OpenAI 嵌在 function.parameters，Claude
平铺为 input_schema）；参数载体（OpenAI arguments 是 JSON 字符串，
Claude input 直接是对象）；回填角色（OpenAI 用 role=tool 配
tool_call_id，Claude 在 user message 里放 tool_result 块配
tool_use_id）。追一家开源就答 Hermes：XML 栅栏包 JSON，消息结构
对齐 OpenAI，单 token 标签便于流式解析。（§二）

**Q4【高】约束解码的原理和代价？**
每步把违反语法的 token logit 置为负无穷，合法性来自正则/CFG 编译
成的自动机或 token 掩码；Outlines 走 FSM 查表，xgrammar 预检 +
persistent stack + 与引擎重叠执行做到近零开销（MLSys 2025 口径最高
100 倍加速）。代价：只保语法不保语义，跨字段约束表达不了，部分
实现吞吐下降约一到三成（实践口径），与 reasoning 模式有额外交互
成本。（§四）

**Q5【中高】BFCL 怎么给 FC 能力打分？**
三种判分形态按版本递进：V1 的 AST 子树匹配（parse 后比结构，不
比字符串）；V3 起加真实执行与 state-based（执行调用后比对后端
系统状态）+ response-based 子集匹配（轨迹须含最小必要调用集，
允许多余探索）；V4 总分加权 Agentic×40% + Multi-Turn×30% + 其余
各 10%（2025-07 口径，5088 条计分样本）。引用分数必须带版本与
时间，跨版本不可比。（§五）

**Q6【中高】并行调用和嵌套调用在文本协议里怎么编码？**
并行：同回合多个独立调用——OpenAI 是 tool_calls 数组多元素，
Hermes 是连续多个 tool_call 标签块；BFCL 的 Parallel 类目专测。
嵌套其实是回合间依赖而非参数套函数（ToolACE 称 dependent function
calls），BFCL V3 用多轮多步测。最难单轮子类是 Parallel Multiple：
多函数中选对函数 × 并行多次。（§2.5）

## 七、口径与未核实说明

- **BFCL 版本口径**：官方榜单页（2026-10 抓取）标注 V4，bfcl-eval
  PyPI 回放版本 2025.12.17；网传「v5」在 gorilla.cs.berkeley.edu
  榜单与博客中均未见一手口径，本篇不引用任何 v5 分数——若日后需要
  请先核榜单页，不要凭空编分。
- **约束解码吞吐下降一到三成**：工程实践口径（约束打断多 token
  合并路径、重校验），非论文数字；Outlines/xgrammar 论文口径均为
  接近零开销。
- **Anthropic token 预算表**：来自官方文档 2026-10 抓取（Opus 4.1/
  Sonnet 4：313/315 token；Haiku 3.5：264/355；Opus 4.7：
  675/804），模型迭代后数字会滚动，引用时带抓取月份。
- **DeepSeek V3 FC 早期不稳**：社区共识口径（漏 tool_calls、
  arguments 转义问题），非官方声明；R1 系工具能力定性为面试话术
  整理，不引具体分数。
- **V4 总分头部水平**：本次榜单页为 JS 渲染未取到表，故本篇只
  引模型卡时代的 88.24%/78.94%（2024-07-18 口径），不引 V4 最新
  头部分。
- **与既有两篇的分工**：FC vs MCP 的协议分层、内置工具与 MCP
  Client 的链路对比见 [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)；
  agent 推理链路与观测见 [工具调用与mcp](./工具调用与mcp.md)。本篇
  只讲模型侧训练与评测，不重复协议对比。
- 全部论文数字按 arXiv 原文/模型卡口径括注年份；ToolACE 的 11.3
  万条、APIGen 的 60k 均为论文口径，数据集卡片如与论文不一致以
  论文为准。

## 串联阅读

- [工具调用与mcp](./工具调用与mcp.md)：FC 在 agent 推理链路中的位置
  与观测——本篇的「文本协议」视角在该篇落到完整链路。
- [mcp与工具调用深度对比](./mcp与工具调用深度对比.md)：一次
  tool_call 的两条路（内置工具 vs MCP Client 转发）——本篇讲模型侧，
  协议宿主侧看这篇。
- [agentic评测基准专题](./agentic评测基准专题.md)：SWE 谱系、终端与
  对话型基准的选榜口径——BFCL 的 agentic 化与那篇的评测治理互为
  参照。
- [agentic-serving专题](../inference/agentic-serving专题.md)：结构
  约束与采样层的 serving 侧实现——本篇 §四的约束解码在该篇有引擎
  视角的展开。
- [rl环境工程专题](../训练与对齐/rl环境工程专题.md)：Verifier 咽喉与
  sandbox 选型——本篇 §三的「执行验证」在 RL 语境下就是该篇的
  verifier 工程。
