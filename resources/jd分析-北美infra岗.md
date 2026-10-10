# JD 分析：北美 AI Infra 岗（OpenAI / Anthropic / xAI / GDM / Meta / Mistral）

> **面向谁**：在国内备战 AI Infra（推理/训练/平台）方向、同时想评估北美 lab 机会的人；
> 也适合被面试官问「你考虑过海外机会吗」时需要一套有数据支撑的口径的人。
>
> **读完获得**：三家已实测 lab（OpenAI/Anthropic/xAI）的在招规模、薪资带、签证实证与
> 流程差异；国内 vs 北美 JD 的三维度对比；8 条可执行备战清单；外加一份「未核实项」
> 清单，告诉你哪些数字只能说「社区口径」。
>
> **时效口径**：2026-10-10 实测——Ashby / Greenhouse 公开 API 抓取 JD 原文 + 官网
> 正文 + 美国劳工部 H1B LCA 披露数据。Meta、GDM、Mistral 的具体 JD 未能从官网实测，
> 一律标注「社区口径，未实测」；LCA 数据**只含 base、不含 equity**，每次引用都会提醒。
>
> 配套阅读：[JD 分析-AI Infra 岗（国内）](./jd分析-ai-infra岗.md)、
> [JD 分析-Agent 开发岗](./jd分析-agent开发岗.md)、[学习路线图](./学习路线图.md)。

## 总览图

<div class="diagram-embed">
<iframe src="assets/diagrams/na-infra-jd-map.html" width="100%" height="620" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/na-infra-jd-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 一、JD 对照总表（已实测部分）

| 公司 | 岗位 | 关键词 | 薪资（base/年） | 来源 |
|---|---|---|---|---|
| OpenAI | SWE, Model Inference | PyTorch、NCCL/CUDA、IB/MPI/NVLink、production distributed、5 年+ | **$266K–$500K** + equity | Ashby，发布 2025-02，抓取 2026-10 |
| OpenAI | SWE, Inference – Performance Optimization | roofline/微基准 → cost-to-serve 建模、跨层定位瓶颈 | **$266K–$500K** | Ashby，2026-04 |
| OpenAI | SWE, Kernel Performance & AI Tooling | kernel 优化、编译器/DSL、AI-assisted kernel 工作流、硬件协同设计 | **$266K–$445K** | Ashby，2026-04 |
| OpenAI | SWE, Multi Modal / Training PE / AI accelerator Runtime | 多模态推理、MFU、自研芯片 Runtime | **$266K–$555K** | Ashby，抓取 2026-10 |
| Anthropic | Performance Engineer, GPU | CUDA、Triton、CUTLASS、FlashAttention、tensor core、PyTorch/JAX internals、torch.compile/XLA、kernel fusion、Nsight、NCCL/NVLink、INT8/FP8 | **$280K–$850K** | Greenhouse JD，抓取 2026-10 |
| Anthropic | PE, Inference Engine | Rust/C++ 系统编程、prefill/decode 落点心智模型、HBM/PCIe/RDMA 带宽数感、batching、KV/前缀复用、可观测 | **$350K–$850K** | Greenhouse JD，抓取 2026-10 |
| Anthropic | PE, Inference Systems | Python、fleet 级吞吐/延迟/可靠性/正确性四维护、roofline gap、quantization 回归 | **$350K–$850K** | Greenhouse JD，抓取 2026-10 |
| Anthropic | RE/PE, RL Distributed Systems | Python + Rust/C++/Go、调度 placement、sandboxed env、checkpoint、容错、autoscaling、可观测 | **$500K–$850K**（全场最高） | Greenhouse JD，抓取 2026-10 |
| xAI | SWE, Kernels / CUDA (C++) | GEMM/Attention kernel、CUTLASS、Tensor Core、Nsight、PTX/SASS、memory-bound vs compute-bound | **$180K–$440K** base + equity | Greenhouse JD，抓取 2026-10 |
| xAI | SWE, Training/Inference (C++)（MTS-Inference） | global KV cache、continuous batching、load balancing、auto-scaling、speculative decoding、量化、tail latency；点名 vLLM/SGLang/Triton/TRT-LLM | **$180K–$440K** | Greenhouse JD，抓取 2026-10 |
| xAI | MTS, RL Inference | 低精度 RL 训推、量化数值、vLLM/SGLang 加分 | **$180K–$440K** | Greenhouse JD，抓取 2026-10 |
| GDM | （具体 JD 未抓取） | 官网强调 full-stack：自研芯片 → 基础设施 → Gemini/Veo 全球部署 | 未公开 | 官网正文，JD 未能实测 |
| Meta | （未抓取） | metacareers 纯 JS + GraphQL 无法抓；levels.fyi 被墙 | 社区口径，未实测 | — |
| Mistral | （具体 JD 未抓取） | careers 页关键词 audacity/rigor/speed/low-ego | 未公开数字 | careers 页正文 |

> 读表提示：北美 lab JD **普遍明文给薪资范围**——这本身就是与国内最大的信息差之一。
> 表内全部是 base 口径；OpenAI 另行注明 Offers Equity，xAI 注明 +equity+401(k)。

## 二、OpenAI：815 个在招岗，「用 agent 写 kernel」已成正式工程方向

**在招规模**：domestic **815 个在招岗**（Ashby 公开 API 统计，2026-10-10）。infra 族可拆三条线：

- **Inference 族**：Model Inference / Multi-Modal / Performance Optimization / Runtime Productivity；
- **Performance 族**：专门做 cost-to-serve 建模与跨层瓶颈定位；
- **Hardware 族**：AI accelerator Runtime / Kernel Performance & AI Tooling / On-Device。

**三个值得记住的信号**：

1. **Kernel Performance & AI Tooling 岗把「AI-assisted kernel 开发 / agentic 优化工作流」
   写成了正式职责**（JD 顺带提及内部代号 Jalapeño 自研硅）。一句话：
   「**AI-assisted kernel 开发已经是 OpenAI 内部正式工程方向**」——面试官问你
   「AI 工具怎么用」时，这就是最高段位的参照系：不是用 Copilot 补全，而是把
   agentic 工作流做成 kernel 团队的生产管线。
2. 推理岗明说跑在 Azure VM fleet 上，目标是「榨干每个 FLOP 和每 GB HBM」——
   说明 OpenAI 推理 infra 的叙事单位就是硬件利用率，roofline 是通用语言。
3. 岗位命名从 MTS（Member of Technical Staff）转向「Software Engineer, X」，
   对外口径在向业界标准 title 靠拢。

**薪资实证**：

- infra 族 JD 薪资带 **$230K–$555K**（Ashby JD，抓取 2026-10），绝大部分 $266K 起，
  另注明 Offers Equity。
- H1B LCA 披露：**170 条、中位 $297.5K**（H1B LCA, 2025），**93% 都超 $200K**（同上）。
  注意 LCA **只含 base、不含 equity**，实际 TC 更高。

**门槛与地点**：Model Inference 明文要求 **5 年以上经验**、多次重构生产系统者优先；infra 岗几乎全
SF only。面试流程细节（轮次、coding 难度）未拿到官方材料，社区流传的
「recruiter → HM → 1–2 轮技术 → onsite loop」属**社区口径，未实测**，正文第六章标注。

## 三、Anthropic：645 个在招岗，推理 infra 成建制 + 明文承诺办签证

**在招规模**：**645 个在招岗**（Greenhouse 公开 API 统计，2026-10-10）。推理 infra 是
成建制的：

- **Performance Engineering 三子方向**：GPU / Inference Engine / Inference Systems；
- Staff/Senior SWE, Inference 多个团队；
- EM, Inference Infrastructure（管理线也单独设岗）。

**自研引擎信号（最重要）**：JD 明说推理引擎 **in-house 自研**、跑「all of our
accelerator and cloud platforms」（对应 TPU + Trainium + GPU 多云），**通篇不点名
vLLM**。考察的是可迁移的系统原理，不是某个开源引擎的实现细节——这与国内 JD
「vLLM/SGLang/TRT-LLM 三件套熟」的写法形成对照（xAI 是例外，见下节）。

**文风里藏着考点，两句原话值得背**：

- Minimum Qualifications 直接写：能讲清「**prefill 和 decode 分别落在加速器
  计算/显存/互联的哪里、此时 host 在干什么**」。这就是 PD 分离心智模型最地道的
  英文表述，也是面试口算题的原型。
- 「**Tokens you can trust**」「**correctness as part of performance**」——数值
  正确性被当作性能的一部分。量化回归、kernel 数值一致性在 Anthropic 不是质量
  话题，是性能话题。

**薪资与签证实证**：

- Logistics 原文薪资带 **$280K–$850K**（Anthropic Greenhouse JD，抓取 2026-10）；
  RL Distributed Systems 给到 **$500K–$850K**（同上，全场最高带）。
- H1B LCA：**159 条、中位 $187.7K**（H1B LCA, 2025）——再次提醒，LCA **只含 base、
  不含 equity**。
- Visa 承诺原文（JD Logistics 段）："We do sponsor visas…if we make you an offer,
  we will make every reasonable effort to get you a visa, and we retain an
  immigration lawyer to help with this." 这是**实测到的最明确的签证承诺**。
- FAQ 补充两条：面试**不提供反馈**；**被拒 12 个月后可再投**。

**工作方式**：混合办公，JD 统一写「至少 25% 时间在办公室」；地点 SF / NYC / Seattle，
部分 London / Ontario / Zürich。

**面试官方描述（实测）**：全程 Google Meet；实时 coding 用 Colab / CodeSignal；
"You can look things up"——**允许现场查文档**，基本语法和标准库熟练即可；重双向问答。
候选人画像原话："We care about what you can do, not where you learned to do it"——
约一半技术员工之前没有 ML 经验、约一半 PhD；"If you have an engineering background,
apply as an engineer—you'll perform better in the interviews."

## 四、xAI：305 个在招岗，与国内同栈 + 门槛最低

**在招规模**：**305 个在招岗**（Greenhouse 公开 API 统计，2026-10-10）。

**与国内最同栈的一家**：xAI 推理 JD 几乎是国内推理 JD 的英文版——global KV cache、
continuous batching、speculative decoding、tail latency，并**直接点名
vLLM/SGLang/Triton/TRT-LLM**。你在国内攒的开源引擎经验在 xAI 直接按面值兑换。

**组织与地点**：

- 层级扁平，全员 MTS（Member of Technical Staff）风格；
- base Palo Alto（部分 Seattle）；机房/电力/网络岗在 Memphis（Colossus 集群所在）；
- Network Engineer (High-Speed Interconnects) 单列招聘，可见集群网络是独立战线。

**薪资与门槛**：

- base **$180K–$440K**（xAI Greenhouse JD，抓取 2026-10）+ equity + 401(k)；
- **门槛最低**：ML Infra 岗只要求 **2 年+经验**（JD 原文），语言栈
  Python/C++/Rust + PyTorch/JAX/CUDA；
- JD 自称「SpaceXAI」——按 JD 原文引用，背景未核实，不展开。

**RL 线**：MTS, RL Inference 做低精度 RL 训推、量化数值，vLLM/SGLang 经验加分——
与 Anthropic 的 RL Distributed Systems、国内字节/Moonshot 的 RL infra 岗同向，
这是第七章要收的口子。

## 五、GDM / Meta / Mistral：具体 JD 未能实测的部分

**Google DeepMind**：

- 官网强调的叙事是 **full-stack**：自研芯片 → 基础设施 → Gemini/Veo 全球部署；
- 工作地点覆盖 10 城；
- **官方四段式流程（实测官网正文）**：① 30 分钟 recruiter 沟通 → ② skills
  interviews 2–3 轮 → ③ final round 见 Team Lead（技能 + team goal +
  culture/mission/values）→ ④ 统一评审出 offer；
- 具体 infra JD 自家 JS 招聘系统未抓到，标「**待补/未能从官网实测**」。

**Meta**：

- metacareers.com 纯 JS + GraphQL 无法抓，levels.fyi 被墙——**JD 原文与薪资区间
  均未实测**；
- 社区口径（未实测）：infra 岗挂 Production Engineer / SWE-ML Systems /
  Research Engineer (FAIR)，面试走标准 Meta loop（E5+ = 2 coding + 1 system
  design + behavioral）。引用时必须挂「社区口径」。

**Mistral**：

- 900+ 员工、30+ 国籍；careers 页关键词 audacity / rigor / speed / low-ego；
- benefits 明写 **relocation + visa sponsorship + settling-in**——欧洲线里对
  跨境候选人最友好的一档；
- 流程（实测 careers 页）：intro 面 + 2–5 轮「贴近日常工作」的技术实操 + values
  终面 + offer 前 reference check；
- 具体 infra JD 未抓到，标「**待补/未能从官网实测**」。

## 六、流程与风格差异：实测事实 vs 社区口径

**已实测（官方材料）**：

| 公司 | 流程要点 |
|---|---|
| Anthropic | 全程 Google Meet；live coding 用 Colab / CodeSignal；**允许查文档**；重双向沟通；行为/风格匹配权重明显高于国内（pair programming、low ego、"ask the naive question"、mission-first） |
| GDM | 官方四段式：recruiter → skills 2–3 轮 → Team Lead 终面（含 values）→ 统一评审 |
| Mistral | intro + 2–5 轮实操（贴近日常工作）+ values 终面 + offer 前 reference check |

**社区口径（未实测）**：

- OpenAI：recruiter → HM → 1–2 轮技术 → onsite loop（project deep dive + 研究品味
  讨论），coding 难度低于大厂 LC hard、偏实用；
- Meta E5+：2 coding + 1 system design + behavioral。

引用以上两条时必须说「社区口径，未实测」——这是本篇与面经帖的分界线。

## 七、国内 vs 北美：三维度实测对比

| 维度 | 国内（对照 [jd分析-ai-infra岗.md](./jd分析-ai-infra岗.md)） | 北美 lab（本篇实测） |
|---|---|---|
| **JD 关键词** | 点名 vLLM/SGLang/TRT-LLM 三件套、昇腾等国产卡、框架版本细节 | Anthropic/OpenAI 写「自研引擎」「跨加速卡平台」、Rust/C++ systems programming、fault tolerance、correctness-as-performance；xAI 例外与国内同栈 |
| **面试形式** | 八股深挖 + 手撕 + 牛客白板味浓 | project deep dive + systems reasoning（roofline 口算、带宽数感、"measure, model, then change"）+ 行为文化匹配；Anthropic 明说开卷 |
| **JD 透明度** | 薪资几乎不写 | 薪资带明文写进 JD（$180K–$850K 各家不一），签证承诺、办公地点比例也写 |

**第四个维度：技术栈抽象层级**。国内 JD 把要求写成「框架名 + 项目经验」，原理留到面试
深挖；Anthropic/OpenAI 直接把「从零设计推理引擎所需的原理」写进 Minimum
Qualifications（prefill/decode 落点、HBM/PCIe/RDMA 带宽数感）。同一个岗位，
**国内考「你用过什么」，北美 lab 考「你能推导出什么」**。

**交集就是溢价方向**：CUDA/Triton、NCCL/NVLink、FP8、PD 分离心智模型之外，最值得
单独点名的交集是 **RL infra**——Anthropic RL Distributed Systems 给到
**$500K–$850K**（Greenhouse JD，抓取 2026-10），xAI 单列 MTS-RL Inference，国内
字节（VLM/Agent RL）与 Moonshot（RL Infra 研究工程师）同向抢人。一句话金句：
「**RL infra 是全球统一的溢价方向**」。

**薪资结构对比**：美 lab 现金 base 高 + equity 构成 TC 主体；国内现金包小、期权折价。
绝对值差 **3–6 倍**，但计入 SF/Palo Alto 生活成本、加州州税（9–13%）与签证沉没
成本后，体感约 **2–3 倍**。TC 数字一律以 JD 薪资带 + LCA 为准，levels.fyi 数字
引用时必须标「社区自报口径」。

## 八、备战清单（8 条）

1. **补 Rust/C++ systems programming**：Anthropic Inference Engine 第一条 Minimum
   Qualification 就是 Rust/C++ + 代码质量与测试；要能讲 RAII/并发/零拷贝。
2. **「带宽数感」练到口算级**：Anthropic 原话——intimately familiar with the
   hardware and bandwidth numbers（FLOPs, HBM, PCIe, RDMA, network links）…model a
   problem quickly: where the time and bytes go。对应本仓
   [显存计算专题](../interview-questions/显存计算专题.md) 的 KV 计算题进阶。
3. **简历挂开源 PR**：xAI 把 SGLang/vLLM 开发经验写进 Preferred Skills；实质性 PR 是
   跨市场最硬背书，与国内同向——「**开源 PR 是双语市场通吃的单一最高性价比投资**」。
4. **按「自研引擎」而非「开源引擎」视角组织知识**：面 Anthropic/OpenAI 别只背 vLLM
   实现细节，要能从 KV 内存布局 / batch 调度 / 数值正确性推导出「从零设计推理
   引擎」；面 xAI 时 vLLM/SGLang 具体经验直接可用。
5. **行为面专门准备**：pair programming、low ego、mission-first；GDM/Mistral 有独立
   values 终面——国内几乎不占权重的一类，北美可以一票否决。备 2–3 个英文 STAR
   故事。
6. **英文化表达**：Anthropic 全 Google Meet 远程面，英文直接影响 coding 轮 pairing
   沟通效率；至少完整英文模拟两轮「讲推理优化项目 + 口算 roofline」。
7. **签证路径按难度排序**：(a) 大厂美国 office L1/O-1 internal transfer；(b)
   F-1 → OPT → H1B（多年抽签不确定性）；(c) 直接境外投 Anthropic（JD 明文「有
   offer 就尽全力办签证 + 律师团队」，实测最明确承诺）；(d) xAI/OpenAI 同样真实
   办 H1B（LCA 实证）但无明确承诺文案；O-1 对有顶会/知名开源项目的人是加速器。
8. **地点与生活成本计入决策**：SF 高生活成本把 3–6 倍账面差压缩到体感 2–3 倍；
   估 TC 要折算住房/税（加州 9–13%）。

## 九、应对话术

**「你考虑过海外机会吗？」**——肯定但锚定现实：研究过（Anthropic JD 要求 Rust/C++
与 prefill/decode 落点心智模型，说明考察面更抽象、更偏从零造系统）；目前积累在国内
ROI 更高（vLLM/SGLang PR、国产卡适配直接变现为 offer 竞争力；北美叠加签证不确定性，
且 3–6 倍账面差被 SF 成本压缩到 2–3 倍体感）；不排除，但会带着差异化竞争力（开源
/ RL infra）去，而不是从零排队抽签。

**「北美和国内 infra 岗差异？」**——答三个实测维度即可：① JD 关键词（国内点名
vLLM/昇腾，Anthropic 写 prefill/decode 落点 + Rust，不点名开源引擎）；② 面试形式
（Anthropic 开卷 + 全 Google Meet + Colab，vs 国内八股手撕）；③ JD 透明度（北美
明文薪资带，国内几乎不写）。

**「怎么规划海外路径？」**——给可验证的排序：L1 internal transfer > F-1/OPT 留学线
> 直投 visa-sponsoring lab > O-1；并指出 Anthropic 是唯一在 JD 里明文承诺办签证的。

**红线**：不引用「听说 xAI 996」类社区碎片；被追问到没有一手数据的部分，直接说
「这部分我没有一手数据，只有社区口径」。

## 十、未核实项与口径声明

按调研纪律，以下每一项在引用时都必须挂标注：

- **Meta JD 原文与薪资区间**：官网 JS 无法抓 + levels.fyi 被墙——「社区口径，未实测」；
- **TC 数字**：全篇不出 levels.fyi 数字，必须给时标「levels.fyi 社区自报口径」；
- **GDM / Mistral 具体 JD**：「待补/未能从官网实测」；
- **OpenAI 面试流程细节**：社区口径，未实测；
- **xAI「SpaceXAI」**：按 JD 原文引用，不展开背景；
- **H1B / O-1 政策细节**：本篇只引 LCA 实证 + Anthropic 官方承诺两段，政策页另开专题；
- **面经帖**：不引用单个帖子。

**实测 vs 社区口径总声明**：

- 实测 = Ashby / Greenhouse 公开 API 抓取的 JD 原文（OpenAI/Anthropic/xAI 三家）、
  各公司官网正文（Anthropic 面试 FAQ 与 Logistics、GDM 四段式、Mistral 流程与
  benefits）、美国劳工部 H1B LCA 披露（OpenAI 170 条 / Anthropic 159 条，2025）。
- 社区口径（未实测）= Meta 全部、OpenAI 流程细节、levels.fyi TC 数字、GDM/Mistral
  具体 JD。
- LCA 口径提醒（每次引用都要带）：**LCA 只含 base salary，不含 equity / bonus**；
  用它比较的是「现金底薪水位」，不是 TC。

---

*来源：Ashby / Greenhouse 公开 API（OpenAI 815 / Anthropic 645 / xAI 305 在招岗，
JD 原文与薪资带，抓取 2026-10-10）；Anthropic 官网面试 FAQ 与 JD Logistics 段；
GDM 官网招聘流程页；Mistral careers 页；美国劳工部 H1B LCA 披露（2025）。
样本偏三家美系 lab，GDM/Meta/Mistral 为索引级证据，不代表全市场分布。*
