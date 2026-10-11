# Thinking 模型 Serving 专题：TTFAT 改版、Budget 三档硬钳与并行采样成本账

> **面向**：已读过 [推理调度专题](./推理调度专题.md)（continuous batching 与
> token budget）与 [agentic-serving专题](./agentic-serving专题.md)（会话亲和与
> 1×prefill+N×decode 成本公式）的读者。本篇是 inference 线在「reasoning /
> thinking 模型」方向的收口——训练侧配方在
> [推理模型训练专题](../训练与对齐/推理模型训练专题.md)，本篇只讲 serving。
>
> **读完获得**：① 指标体系为什么要从 TTFT 改版成 TTFAT/E2E，以及 Incomplete
> 陷阱这个监控盲区；② thinking budget 的三档工程谱系（软提示 → 语法硬钳 →
> logit 硬钳）与 vLLM/SGLang 各自的真实实现位置；③ effort 档位取代 token
> 预算的 API 收敛路线（OpenAI 六级、DeepSeek 七级映射）；④ 并行采样在万级
> thinking 下的成本账（vLLM ParentRequest fan-out、K2 Heavy Mode 实例）；
> ⑤ 思考链不外显四件套的产品与安全设计；⑥ off-peak 五折与长 thinking 排产
> 的耦合；⑦ 10 条面试题的完整答法。
>
> **时效口径**：素材全部取自 **2026-10 实测**（OpenAI/Anthropic/DeepSeek/
> SGLang 官方文档与 vLLM main 源码，2026-10-11）与 2025 年官方发布口径
> （Qwen3 model card、K2 Thinking HF 卡片、s1 论文）；论文/厂商宣称值一律
> 标口径；未核实项只进文末「口径与未核实说明」，正文不当事实引用。

## 一、主线直觉：主矛盾从 prefill 平移到无界 decode

一句话主线：**引入 thinking 之后，serving 的主矛盾从「prefill/KV 容量」
整体平移到「万级 token 的无界 decode 相」**。传统 chat 负载输出百级 token，
TTFT 约等于用户感知启动；thinking 负载下首 token 只是思考链开头，答案
可能还在数千甚至数万 token 之后。于是整条 serving 链路都要跟着改：指标
要改版（TTFT 失真、TTFAT 登场）、调度要解决长 decode 拖尾、引擎要给
thinking 长度加上限（软提示到硬钳三档）、并行采样从「白送的质量技巧」
变成「真金白银的成本决策」，而思考链要不要给用户看，则是一道安全与
计费交叉的产品题。

OpenAI 官方文档直言 reasoning tokens「从几百到数万不等」（OpenAI docs，
2026-10 实测）——**输出长度进入万级 token 量级是这个专题的一切前提**。

<div class="diagram-embed">
<iframe src="assets/diagrams/thinking-serving.html" width="100%" height="800" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/thinking-serving.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、指标改版：TTFT 失真、TTFAT 登场与 Incomplete 陷阱

### 2.1 TTFT 为什么失真

传统负载下 TTFT 是用户体验代理：首 token 出现 ≈ 答案开始流出。thinking
负载下这个等式断裂——首 token 只是 `<think>` 之后的第一个思考 token，
若 UI 不流式展示思考过程，用户看到的是长达数十秒的空白。改法是把指标
体系拆成三件套：

- **TTFT 退阶为运维指标**：只度量「队列 + prefill 健康度」，不再代表用户
  体验；
- **TTFAT（time to first answer token）**登场：首个 answer token，即
  `</think>` 之后第一个 token 的到达时刻，才是「思考开始→答案开始」的
  真实用户等待；
- **总 E2E 兜底**：thinking + answer 两相加总的端到端时延。

配套地，TBT（token 间时延）要在 thinking 相和 answer 相**分域统计**——
以 `</think>` 为分界。流式框架的 detokenizer 天然知道分界位置；且
thinking 域内 decode 速度本身就慢于 answer 域（结构更碎、spec decode
接受率更低），分域 metric 除了计费还有 diagnostics 价值。

### 2.2 数字锚：预留缓冲直接进入框架默认值

- **OpenAI 建议实验期至少预留 25,000 token 缓冲**（reasoning + output
  合计，OpenAI docs，2026-10 实测）；
- **Qwen3 官方最佳实践建议常规查询预留 32,768 token**、竞赛级难题
  38,912（Qwen3 model card，2025-04）；
- **Qwen3 默认把输出预留写死了框架配置**：max_position_embeddings 默认
  40960 = 输出 32,768 + prompt 8,192（Qwen3 部署文档/model card，
  2025-04）。这等于官方默认配置固化了「输出 = prompt 四倍」的新常态，
  TTFT 在 E2E 里的占比被结构性压缩。

记住这组数的读法：25,000 是「实验期你别小于这个」的保守下限，32,768 是
「常规查询」的推荐预留，两者合起来说明——**万级 thinking 不是长尾事件，
而是默认工况**。

### 2.3 Incomplete 陷阱：全绿但零输出

账单侧的新坑，OpenAI 文档原例：**如果 max_output_tokens 在思考相被耗尽，
你可能为 input + reasoning 付了钱，却一个可见 token 都收不到**——响应
status=incomplete（OpenAI docs，2026-10 实测）。此时 TTFT/TBT 全部正常、
计费正常发生、业务完全失败。监控必须把 incomplete 状态与 reasoning
token 占比单列报警，否则这是一类「所有绿灯但用户炸锅」的事故。

usage 口径也因此改版：thinking tokens 必须进
usage.output_tokens_details 的 reasoning 域——DeepSeek、OpenAI、
Anthropic 三家现行 API 全部这么干（2026-10 实测）。

### 2.4 产品侧解法：把等待变成进度

- 流式 thinking 展示：DeepSeek/通义/Kimi 均把 CoT 以 reasoning_content
  增量流下，把「等待」转化为「进度可读」；
- Claude 的 progress updates：工具调用之间给一两句状态，把 thinking
  包装为可渲染的状态行（Anthropic docs，2026-10 实测）。

工程结论：**三个指标各管一段——TTFAT 管用户体验，TTFT 管系统健康，
incomplete 管计费正确性**，缺一个都有盲区。

## 三、调度冲击：长 decode 拖尾

万级 token 的 decode 让 continuous batching 的 occupancy 曲线变形：单
请求生命周期拉长十倍到五十倍量级，batch 组成长期被「不死 decode」占据，
抢占/重排队概率上升；Sarathi token budget 的单步时长假设（预算钳死 →
每步可预测，见 [推理调度专题](./推理调度专题.md)）在尾部被少数超长请求
拖累。

引擎的统一解法是**给 decode 加预算，把无界 decode 截成可调度有界
decode**。这实质上是调度器的第二类 budget：prefill 侧的 token budget
控制每步喂多少，decode 侧的 thinking budget 控制单请求总共吐多少。
「按历史/分类器预估 thinking 长度做装箱」的长度预测调度是下一步，但
当前 vLLM/SGLang 两家官方实现都是「硬截」而非「预测」。

## 四、Budget 三档工程谱系：软提示 → 语法硬钳 → logit 硬钳

SGLang 官方文档把三档写全（SGLang docs main，2026-10 实测），这是目前
最完整的工程谱系，按强度排序：

1. **软提示：chat_template 变量可超发**。Qwen3 官方模板支持
   `thinking_budget`，把预算渲染进 prompt，模型「尽量遵守」——**无 token
   级保证，可以超发**。Qwen blog 官方宣称准确率随 budget「scalable and
   smooth」增长（2025-04）。适用面：质量优先、预算只是成本提示的场景。
2. **语法硬钳：xgrammar 词表掩码精确到 token**。`--enable-strict-thinking`
   打开后，budget 耗尽时 grammar 后端的词表掩码只放行 `</think>` 序列，
   其余 token 概率清零——**截断点精确到 token**，结束 token id 从
   reasoning parser 的 think_end_token 自动推导，模型无关。前置条件是
   grammar backend 支持 token filtering，启动失败即报错。
3. **logit 硬钳：custom logit processor 兜底**。语法后端不可用时，
   在 `<think>` 后逐 token 计数，到预算先强注换行再强注 `</think>`
   （先注换行是为了避免钳在 sub-sentence 中间）。

vLLM 同构地做了 GPU 端实现（vLLM main 源码，2026-10 实测）：

- SamplingParams 新增 `thinking_token_budget`，由 GPU 采样器内的
  **ThinkingBudgetState**（`vllm/v1/worker/gpu/sample/thinking_budget.py`）
  逐请求记账；
- budget 命中时**强制把推理结束串采样进去**——`ReasoningConfig` 的
  reasoning_end_str 是字符串级可配，允许携带过渡短语（如
  Final Answer:）再回到自然结束；
- 因为落在 GPU 采样器路径内，预算强制**不需要退出 CUDA graph 批量
  采样路径**——这是它相对「客户端循环重喂」方案的吞吐优势。

### 4.1 延长方向：s1 的 budget forcing

截短的反面同样工程化：s1（arXiv 2501.19393，2025-01）演示**延长**思考
——到 stop token 就强制 append Wait 让模型继续想，**论文宣称 AIME24 从
一半提升到 57%（论文口径）**，并宣称最多超 o1-preview 二十多个百分点
（MATH/AIME24，论文宣称值）。注意实现位置：s1 官方示例是**离线客户端
循环**（stop_token_ids + 循环重喂，repo 示例 MAX_TOKENS_THINKING=32000），
线上硬钳必须引擎级实现（xgrammar 掩码或 GPU 采样器强注），否则 TBT
拖尾与越狱绕钳都不成立。B2B 出海面试能区分这两者很加分。

### 4.2 坑位清单：silently ignored 是第一事故模式

官方文档点名的三类静默失效：

- 缺 `require_reasoning` 时 budget 被静默忽略；
- chat template 未定义变量时软提示静默失效（预算根本没渲染进 prompt）；
- logit processor 里 hardcode 的 token id 与分词器不匹配（数错了对象）。

**这类功能的第一事故模式不是钳错，而是根本没生效**——上线前必须用「固定
budget + 秒表式端到端验证」兜一道回归。

### 4.3 硬钳与质量悬崖

直接强注 `</think>` 时模型可能正算到一半。磨平悬崖的三件套：过渡短语
（s1 的 Final Answer:）、过渡结构（SGLang 先强注换行再注结束串）、
字符串级可配的结束串（vLLM reasoning_end_str 可含 transition phrase）。
兜底来自训练侧：Qwen3 官方声称 budget 可控来自 thinking fusion 训练
——thinking→answer 之间模型自有终止协同。另注意预算语义本身有两类：
Claude 官方明说 budget_tokens **是 target 不是 strict cap**，而 serving
侧 hard-forcing 才是真正的 strict cap。

## 五、预算语义收敛：effort 档位取代 token 预算

商用 API 的 2026 收敛答案是 **effort 档位制**（各家 docs，2026-10 实测）：

- OpenAI reasoning_effort 六级：none → minimal → low → medium → high →
  xhigh/max（模型自适应解释档位）；
- DeepSeek 七级映射：xhigh 映射到 high、ultra 映射到 max，对外档位数与
  内部枚举做一次对齐；
- Anthropic 4.7 起 manual 模式 `type:"enabled"` 直接 400，全面转向
  adaptive + effort；
- Kimi kimi-k3 恒定思考，effort 分 low/high/max。

**token 预算只遗留在 Anthropic 4.5 时代的 manual 模式**：下限 1,024
token、必须小于 max_tokens、语义是 target 不是上限，且 **budget 会渲染进
prompt，一改预算前缀缓存全 miss**（Claude extended thinking doc，2026-10
实测）。最后这一条是纯 serving 视角的成本暗坑：prompt 里嵌预算 = 预算即
前缀的一部分。

工程含义值得单独记住：**自建引擎（vLLM/SGLang）反而比大 API 商更早提供
真硬预算**——API 商出于质量风险只给软档位，而做 FinOps 型 serving 的团队
可以给「便宜档」按 token 硬钳，这是一个可对外出售的差异化能力。

## 六、并行采样：1×prefill + N×decode 的成本天平

### 6.1 成本公式没变，量级变了

BoN/self-consistency 的成本仍是 1×prefill + N×（thinking+answer）decode，
前缀共享依然成立；但 thinking 让 decode 项从百级涨到万级——**六路并行
就不再是「白送的前缀共享」，而是六万 token 起步的账单**（n=8 时成本近似
线性放大，decode 占绝对大头、prefill 共享收益相对衰减）。并行采样从
「cheap quality 技巧」正式变成「成本决策」。

### 6.2 vLLM 实现：ParentRequest fan-out

vLLM V1 的 n>1 实现（`vllm/v1/engine/parallel_sampling.py`，2026-10
实测）：

- 一个 n>1 请求被拆成 ParentRequest + n 个 child request
  （child_req_id = `{index}_{parent}`），各自独立 seed、sampling
  params 克隆、内部 n=1，展开进统一 batch；
- prompt KV 经 prefix caching / CoW block 共享，prefill 只付一次；
- 但 batch 内 decode token 数同时乘 n——**各个 child 完成时间不同步，
  尾批问题与 batch 抖动被放大**，指标层已单独记录 n 与 max generation
  tokens（metrics.md 注释）。

### 6.3 数字锚：K2 Heavy Mode 花钱买分

官方实证锚：K2 Thinking Heavy Mode = **8 轨迹并行 rollout + 反思聚合**，
HLE 工具评测中每轨迹多至一百二十步内推、逐步 48K thinking budget；
**官方口径 HLE heavy 从 44.9 分提到 51.0 分**（单路 w/tools 44.9，HF
model card，2025-11）——八倍 decode 换约六分，这就是「花钱买分」边际
曲线的官方样本。引用纪律注意：K2 官方评测给数学类按 96K、竞赛代码类
按 128K 设 thinking budget cap——**这是评测设计的 cap，不是 API 上限**
（勘误见文末）。

提示边界：fork/树搜索的程序级调度（Autellix 等）已在
[agentic-serving专题](./agentic-serving专题.md) 讲过，本篇只补「decode
侧成本放大」这半笔账。

## 七、思考链不外显：四件套与「隐藏 ≠ 省钱」

### 7.1 Anthropic 范式（最完整，2026-10 实测）

安全侧由四件套构成：

1. **摘要模型**：thinking block 里的文字永远是摘要，**由另一个模型生成**，
   原始 CoT 任何档位都不返回——官方明说摘要是为了 prevents misuse
   （防蒸馏、防红队套取）；
2. **display omitted 只省延迟不省钱**：设 `display:"omitted"` 时 thinking
   field 返回为空、signature 照带，但**照样按全量 thinking token 计费**——
   隐藏是产品与延迟决策，不是成本决策；
3. **signature 加密字段**：支撑多轮回传校验（防篡改），且 signature 校验
   要求 everything sent before it 不变才有效；2026-08-31 后新账号默认强制，
   serving/网关层因此新增「thinking 协议合规校验」这个中间件职责——同一轮
   内的 thinking block 必须按原序回传、不可增删编辑；
4. **redacted_thinking + reasoning_extraction 拒答**：前者是安全编辑后的
   thinking 形态；后者是一类拒答类目——模型被发现要在正文里输出内部推理
   时可直接拒答，防 prompt 套取 CoT。

保留策略分 keep-all（Opus 4.5+/Sonnet 4.6+，历史 thinking 按 input 计费）
与 last-turn-only（旧模型自动 strip）两档。

### 7.2 OpenAI 现行（2026-10 实测）

reasoning tokens **永不通过 API 可见、照按 output 收费**；摘要需显式
`summary:"auto"` 才 opt-in；GPT-5.6 起默认把历史 reasoning 渲染进后续
上下文（reasoning.context: all_turns/current_turn）；encrypted_content
支撑 ZDR 场景回传。

### 7.3 开源对照：全文可见 + 默认不带回

DeepSeek/Qwen3/Kimi 的 reasoning_content **全文可见**；多轮默认**不带回**
历史 CoT——DeepSeek 无 tools 时 reasoning_content 不拼接进上下文，Qwen3
chat template 直接 strip——自带「thinking 不进历史」省上下文的属性。但
**带 tools 时 DeepSeek 强制全量回传 reasoning_content，否则 400**——
函数调用协议的 thinking 兼容性让请求校验表变厚：Manual mode Claude 不
允许 forced tool_choice 同理。

一句话对照：**商业闭源三家选择「摘要在场、原文封存」，开源三家选择
「原文在场、历史剔除」**——前者卖安全与合规，后者省上下文与实现复杂度。

## 八、运营耦合：off-peak 五折 × 长 thinking 排产 × 账内资产

### 8.1 off-peak 五折与长 thinking 天然适配

DeepSeek 现行定价（api-docs，2026-10 实测）：**现行规则是 off-peak
一律为峰值五折**，
peak 为工作日 01:00–04:00 与 06:00–10:00 UTC；现行模型为
deepseek-flash / deepseek-v4-pro，输出价分别为峰值一块二对六毛、
三块九毛六对一块九毛八（美元每 1M token，peak→off-peak）；最大输出
384K token。长 thinking 请求动辄数万 token、线长到分钟级，天然适合
defer 到 off-peak——**批量离线评测与峰谷定价是同一枚硬币**：Anthropic
直接建议单次请求 thinking 超约 32K 走批处理（网络超时风险），且
max_tokens 超两万一千多（21,333）时 SDK 客户端强制 stream（Claude
thinking doc，2026-10 实测）。

### 8.2 context 记账改变：thinking 成了「账内资产」

keep-all 模型（Opus 4.5+/Sonnet 4.6+）的历史 thinking **按 input 计费且
占上下文窗**——Anthropic 原话「把 thinking 当普通历史来预算」，并配
clear_thinking 剔除策略。长 agent 会话要把 thinking 清理接进 context
管理：[agentic-serving专题](./agentic-serving专题.md) 的「静态区/动态区」
布局需要因此重算——动态区里多了一块「可清理但有计费价值」的新资产。

### 8.3 长 decode 的质量配套参数

供应商推荐采样参数也因此分叉（Qwen3 model card，2025-04）：thinking 模式
推荐 temperature/top_p/top_k 为零点六/零点九五/二十，non-thinking 为零点七/
零点八/二十，且 **thinking 模式禁用贪心解码**；DeepSeek thinking 模式
top_p 生效区间下限被钳到 0.95（DeepSeek thinking_mode 文档，2026-10
实测）。serving 网关在给 thinking 请求转发参数时要把这些钳制做进校验层，
否则用户传入的贪心参数会被静默改写或静默生效出质量问题。

## 九、工程议题清单

1. **TTFAT 与 usage 计费口径分拆**：引擎层要把 `</think>` 前后 token 分域
   计数，理由有二——计费（reasoning 域单独计价/展示）与诊断（spec
   decode/MTP 在两域接受率不同）。
2. **硬钳 vs 质量悬崖**：过渡短语、是否补「最后一轮总结」要做成可配置
   （vLLM reasoning_end_str 已是字符串级）；钳在 sub-sentence 位置还是
   句子边界（SGLang 先强注换行）是产品级取舍。
3. **off-peak 与排产耦合**：长 thinking 请求 defer 到五折窗口，配合批处理
   通道（超 32K 官方建议走 batch）形成「削峰 + 省钱」的一个动作。
4. **账内资产治理**：keep-all 的历史 thinking 计费且占窗，清理策略
   （clear_thinking / strip）要接进 context 管理的常规路径。
5. **协议合规校验中间件**：thinking block 原序回传、signature 全链校验、
   tools 场景强制回传 reasoning_content、manual 模式禁止 forced
   tool_choice——这些规则让 serving/网关的请求校验表显著变厚，是
   thinking 时代新增的中间件职责。

## 十、数字锚总表

| 数字 | 含义 | 来源口径 |
|---|---|---|
| 25,000 token | OpenAI 建议实验期 reasoning+output 预留缓冲 | OpenAI docs，2026-10 实测 |
| 32,768 / 38,912 token | Qwen3 常规/竞赛级推荐 max output | Qwen3 model card，2025-04 |
| 40960 | Qwen3 默认 max_position_embeddings = 32,768 输出 + 8,192 prompt | Qwen3 部署文档，2025-04 |
| 1,024 token | Anthropic budget_tokens 下限，且必须小于 max_tokens | Claude thinking doc，2026-10 实测 |
| 超约 32K → batch | thinking 超约 32K 官方建议走批处理 | Claude thinking doc，2026-10 实测 |
| 超 21,333 → 强制流式 | max_tokens 超此值 SDK 强制 stream | Claude thinking doc，2026-10 实测 |
| 96K / 128K | K2 Thinking 官方**评测** thinking budget cap（数学类/竞赛代码类），非 API 上限 | HF 官方脚注 2.2，2025-11 |
| 256K / INT4 QAT 约两倍提速 | K2 Thinking 上下文与量化口径 | HF model card，2025-11 |
| 一半 → 57% | s1-32B budget forcing 在 AIME24 的提升 | arXiv 2501.19393，论文宣称，2025-01 |
| 8 路 × 多至 120 步 × 每步 48K | K2 Heavy Mode 并行聚合配方 | HF 官方脚注，2025-11 |
| 44.9 分 → 51.0 分 | K2 Heavy Mode HLE 官方成绩（对单路 w/tools） | HF 官方，2025-11 |
| 五折 | DeepSeek 现行 off-peak = peak 的一半；peak 为工作日 01:00–04:00、06:00–10:00 UTC | api-docs，2026-10 实测 |
| 384K token | 现行 deepseek-flash/V4-Pro 最大输出 | api-docs，2026-10 实测 |
| 0.95–1.0 | DeepSeek thinking 模式 top_p 生效区间（下限被钳） | DeepSeek docs，2026-10 实测 |

## 十一、▶ 面试题

**Q1（高频）thinking 模型让哪些 serving 指标失真？怎么补？**
深度提示：期望答到 TTFT 只度量思考开始 ≠ 答案开始，需要 TTFAT/E2E/流式
thinking 三件套；TBT 在 thinking 相与 answer 相分域统计（`</think>`
分界）；usage 必须拆 reasoning_tokens（三家 API 现状）；举出 Incomplete
陷阱——TTFT/TBT 全绿但 max_output_tokens 在思考相耗尽、业务零输出
（OpenAI 文档原例）。能补一句「thinking 域内 decode 本身更慢（结构碎、
spec 接受率低）」加分。

**Q2（高频）s1 的 budget forcing 和 Qwen3/SGLang 的 thinking budget 是
一回事吗？**
深度提示：分两层。层一是方向——s1 主要演示**延长**（ignore stop、append
Wait），strict thinking 是**截短**；层二是实现位置——s1 是离线客户端循环
（stop_token_ids + 循环重喂），线上硬钳必须引擎级（xgrammar 词表掩码或
GPU 采样器 ThinkingBudgetState 强注 reasoning_end_str），否则 TBT 拖尾和
越狱绕钳都不成立。答出「软提示无 token 保证、硬钳才有」即合格。

**Q3（中频）budget 耗尽直接强注结束串，质量不崩吗？**
深度提示：先说预算语义两类——Claude budget_tokens 官方明说是 target 不是
strict cap，serving 侧 hard-forcing 才是 strict cap。质量悬崖靠过渡结构
磨平：s1 的 Final Answer:、SGLang 先注换行再注结束串、vLLM 的
reasoning_end_str 可含过渡短语回自然结束；兜底是训练侧 thinking fusion
的终止协同（Qwen3 官方口径）。再追问可引 K2 Thinking 的 96K/128K
**评测 cap** 证明官方就是这么评的（注意别说成 API 上限）。

**Q4（高频）BoN 放在 thinking 模型上成本怎么算？n 开多大合理？**
深度提示：公式 1×prefill + N×(thinking+answer) decode，指出 thinking
时代 decode 占绝对大头、前缀共享收益相对衰减——n=8 约等于八个完整
decode 的账单。配 K2 Heavy Mode 官方实例（8 轨迹并行聚合，HLE 从 44.9
分到 51.0 分）论证边际曲线；实现侧答 vLLM ParentRequest fan-out 出 n 个
child、KV 经 APC/CoW 共享但完成时间不同步导致尾批与指标扭曲。

**Q5（中频）为什么三家 API 都不把原始 CoT 给你？serving 侧要做什么？**
深度提示：动机两条——安全（防蒸馏/防套取，Anthropic 明说摘要 prevents
misuse 并配 reasoning_extraction 拒答）与产品（可渲染进度）。serving 侧
动作四件套：摘要由独立模型/管道生成；display omitted 省流式延迟不省
计费；signature 加密字段供多轮回传校验防篡改；redacted_thinking 做安全
编辑。开源侧对照：reasoning_content 全文可见 + 多轮默认不带回 CoT 省
上下文（但 DeepSeek 带 tools 强制回传否则 400）。

**Q6（中频）effort 档位和 token 预算舍哪个？**
深度提示：商用 API 已收敛到 effort 档位（OpenAI 六级、DeepSeek 七级映射、
Anthropic adaptive+effort），token 预算只遗留 Anthropic 4.5 manual 模式
（min 1,024、target 非上限、改预算让前缀缓存全 miss）。工程反超：自建
引擎反而更早有真硬预算（strict thinking），FinOps 型 serving 可以把「便宜
档 = token 硬钳」做成差异化卖点。

**Q7（低频）长 thinking 负载的容量与排产怎么做？**
深度提示：三个抓手——TTFAT 反推单请求 decode 预算定时延墙；长请求 defer
到 off-peak（DeepSeek 五折）与批处理通道（超 32K 官方建议 batch；超
21,333 强制 stream）耦合；监控把 incomplete 与 reasoning 占比单列，避免
「全绿零输出」事故潜入。

**Q8（低频）thinking 模型对量化/压缩策略有什么影响？**
深度提示：可引 K2 Thinking 官方论断做强引用——thinking 模型 decode 太长、
量化容易崩质量，所以官方上 INT4 QAT，宣称无损约两倍提速（HF model card，
2025-11）。展开见 [量化与压缩](./量化与压缩.md)。

## 十二、口径与未核实说明

**勘误两条（写作/引用纪律）**：

1. 「K2 Thinking 96K/128K」是**官方评测设计中的 thinking budget cap**
   （HLE/AIME25/HMMT25/GPQA 按 96K，IMO-AnswerBench/LiveCodeBench/
   OJ-Bench 按 128K，HF model card 脚注 2.2，2025-11），**不是 API 级
   thinking 上限**——正文一律写「官方评测用 96K/128K cap」。
2. 「DeepSeek-R1 API 定价」是**历史口径**：api-docs 现行模型页为
   deepseek-flash（V4.1-Flash）/deepseek-v4-pro，R1/V3 名义已从主定价表
   移除；off-peak 规则也已统一为「全量 off-peak 一律五折」（2026-10 实测）。
   引用 R1 时代价格必须标注历史口径。

**未核实单列（本批无法现场核实，正文未当事实引用）**：

- DeepSeek-R1 首发期 API 定价（社区记忆：输入 cache miss $0.55/1M、hit
  $0.14/1M、输出 $2.19/1M）与 2025-02 错峰折扣公告（16:30–00:30 UTC，
  V3 五折/R1 二五折）——Wayback 抓取当时 429，未经本批核实；
- DeepSeek-R1 论文中「平均 thinking 长度」的具体数值（论文有
  self-evolution 增长曲线，无当场取到的硬数字）；
- OpenAI o1 首发时 reasoning tokens 的典型量级分布——现行文档只有
  「几百到数万」的定性区间，无分位数；
- vLLM `thinking_token_budget` 进入正式 release 的版本号（本批仅证实
  main 分支源码存在，未查 tag）；
- SGLang `--enable-strict-thinking` 对全部模型/parser 组合的覆盖范围
  （文档仅声明要求 grammar backend 支持 token filtering）。

## 串联阅读

- [agentic-serving专题](./agentic-serving专题.md)：会话亲和、前缀缓存失效
  清单、BoN 的程序级调度与 1×prefill+N×decode 成本公式；本篇只补
  「thinking 让 decode 项从百级涨到万级」这半笔账。
- [推理调度专题](./推理调度专题.md)：continuous batching/chunked
  prefill/token budget 三代范式；本篇增量的 thinking budget 是调度器的
  第二类 budget（decode 侧）。
- [长上下文推理与kv体系](./长上下文推理与kv体系.md)：输入侧长上下文；
  本篇补输出侧——32,768 输出预留已写进 Qwen3 默认 40960 配置，上下文
  管理中心从 input KV 转向「thinking 是否保留、留多久」。
- [推理引擎2026新进展](./推理引擎2026新进展.md)：vLLM/SGLang 主线版本
  演进；本篇补其未展开的一条功能线（ThinkingBudgetState 与 strict
  thinking）。
- [推理服务slo与运营](./推理服务slo与运营.md)：SLO 三件套与容量反推；
  本篇的 TTFAT、分域 TBT、incomplete 识别与 off-peak 排产可并入其
  「削峰与成本」章节。
- [量化与压缩](./量化与压缩.md)：K2 Thinking「decode 太长怕量化崩质量 →
  INT4 QAT」的官方论断是量化选型的强引用锚。
- [推理模型训练专题](../训练与对齐/推理模型训练专题.md)：thinking fusion
  与长度控制的训练侧配方——硬钳不崩质量的兜底在那边。
- [finops与算力成本专题](../finops与算力成本专题.md)：单位 token 成本
  公式与降本组合拳；本篇的「便宜档按 token 硬钳」与 off-peak 排产是其
  在 thinking 负载下的两个新招。
