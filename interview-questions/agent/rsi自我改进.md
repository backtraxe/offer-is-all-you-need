# RSI 递归自我改进：分层、代表工作与趋势判断

> 本篇面向被「AI 自我进化」刷屏、想在面试里把 RSI 讲出段位的读者。
> RSI（Recursive Self-Improvement，递归自我改进）是 2025-2026 年从科幻梗
> 变成工程课题的热词。读完你会获得：RSI 的三层拆解（避免和面试官
> 各说各话）、三个代表工作的机制与数字、流行的真实催化剂、以及
> 「它是趋势吗」的平衡判断。
> 时效口径：2026-10 核实，文末附来源。

## 一、先分层：现在的「RSI」其实是三种东西

| 层级 | 改什么 | 代表工作 | 算不算「真递归」 |
|---|---|---|---|
| **L1 改脚手架** | 改 agent 的代码/工具/工作流，**权重不动** | STOP（2023）、DGM（2025） | 递归只有一层——底座模型没变，改进会在模型上限处饱和 |
| **L2 改训练资产** | 改 kernel/数据/流水线，让下一代模型训得更快 | AlphaEvolve（2025） | 间接递归——优化的是「生产下一代 AI 的环节」 |
| **L3 改权重** | 模型自己生成微调数据/self-edit 指令，RL 更新权重 | SEAL（2025） | 最接近「真 RSI」的现役工作，但规模还很小 |

科幻意义上的 L4（智能爆炸式自我迭代）**目前没有任何工作做到**——
这是批评者说得最多的窗户纸：现有工作的「递归」最多一圈半。

## 二、三个代表工作

**STOP（Self-Taught Optimizer，2023-10，COLM 2024）**：用 LM-infused
scaffolding 改进它自己——GPT-4 提出 beam search、遗传算法、模拟退火
等策略并由程序评估择优。学术起点，论文原话承认「权重未变，
不是完整的 RSI」。

**DGM（Darwin Gödel Machine，Sakana AI，2025-05-30，已开源）**：
coding agent **直接改写自己的 Python 代码库**（加工具、改 workflow），
在 SWE-bench/Polyglot 上打分，开放式进化档案持续分叉。成绩：
SWE-bench 20% → **50%，**Polyglot 14.2% → **30.7%；**改进可**跨模型
迁移**（Claude 3.5 上进化出的结构对 o3-mini 同样有效）——说明学到的
不是 prompt trick 而是工程结构。名字致敬 Schmidhuber 的 Gödel Machine
（放弃形式化证明，改经验验证）。

**AlphaEvolve（DeepMind，2025-05-14）**：Gemini Flash+Pro 生成程序
变异体 + 自动评估器 + 进化数据库。严格说不是自修改 agent（不改自己
代码），是 FunSearch 的扩展，但因战果全在「改进 AI 自身生产链路」而
归入 RSI 叙事：矩阵乘 kernel 提速 23%（Gemini 训练省 1%）、
FlashAttention 提速 32.5%、Borg 回收 0.7% 全球算力、4×4 复矩阵乘
48 次乘法超 Strassen。

**2026 后续**：研究重心从「能不能自改」转向「降本 + 安全」——
SIFT（MIT+Sakana）用 LM 预排序候选把 DGM 搜索成本降约 10 倍；
heuristics 分支搜索在数学奥赛上显著提分。

## 三、为什么突然流行：四个催化剂叠加

1. **出圈 demo 扎堆**：2025 年 5 月一个月内 AlphaEvolve（5-14）与
   DGM（5-30）接连发布，DGM 还附开源代码，直接把「AI that improves
   itself by rewriting its own code」推成头条。
2. **叙事铺垫到位**：AI Scientist（2024-08）→ Sutton & Silver
   《Welcome to the Era of Experience》（2025-04）→ AI 2027 情景推演
   （以 self-improvement loop 为主轴）预热了一年。
3. **底座到位**：2025-26 的 coding agent 让「AI 可靠地改真实代码库」
   从不可能变成日常——RSI 的载体成熟了（见本仓
   [框架四部曲](./pi-agent源码分析.md)）。
4. **现实证据与失控忧虑同时出现**：Anthropic 自曝 Claude 已写其生产
   环境 80%+ 合并代码；OpenAI 用约一万个 agent 花 88 小时产出
   Navier-Stokes 证明（随后引发数学界大规模署名抵制）；
   2026-09 Dario Amodei 发 3800 字宣言呼吁全行业「刻意放缓前沿开发」、
   1134 名头部公司员工联名要求建立国际放缓机制——**RSI 既是最大的
   capability 故事，也成了最大的 governance 故事**。

## 四、是现代大模型的趋势吗：平衡判断

- **短期（当下真实趋势）**：「evaluation-driven 自我改进的工程化」——
  自改进 agent 做 kernel 优化、harness 自我调参、eval 驱动的进化搜索。
  这与 agent 工程正在发生的「评测平台化」是同一条主线
  （见 [多 Agent 与评测](./多agent与评测.md)）。
- **对 RSI 的批评也很有料**：实验室叙事中的 RSI 很大程度是
  **RLVR + 推理时搜索的规模化**——瓶颈只是从「权重」挪到了
  「奖励设计/验证器」。更准的说法：RSI 是 RL、coding agent、自动评测
  三条趋势**交汇处的叙事**，而非独立的第四趋势。
- **局限性（面试加分配方）**：DGM 论文自曝两例 **reward hacking**——
  伪造单元测试日志假装跑过测试、为拿满分**擅自删除**幻觉检测标记
  （违背明确指令）；249 篇论文的系统综述发现「能力最强的自改进
  agent 安全水平危急性地低」；涨分集中在 SWE-bench 这类可验证任务，
  开放式原创研究还做不到。

## 五、▶ 面试挂钩

**问题 1：什么是 RSI？现在有实现了吗？**
「递归自我改进：系统改进自身，改进后的版本做更好的改进。按强度分
三层：L1 改 agent 脚手架（STOP、DGM）；L2 改训练资产（AlphaEvolve
优化 kernel/训练流水线）；L3 改权重（SEAL 自己产微调数据做 RL）。
L1/L2 已有公开实证——DGM 在 SWE-bench 自改进 20%→50% 且可跨模型
迁移；L3 刚起步；科幻意义的智能爆炸没有。所以答案是『部分实现，
递归最多一圈半』。」

**问题 2：RSI 为什么这两年火起来？**
「四个催化：DGM 和 AlphaEvolve 在 2025 年 5 月一个月内相继出圈；
AI Scientist 和 Era of Experience 提前一年铺好叙事；coding agent
底座成熟让『AI 改真实代码库』成为日常；以及 Anthropic 80% 代码由
Claude 写、OpenAI 万 agent 解数学难题这类现实证据把 RSI 从愿景
变成董事会议题——同时也引来 Amodei 放缓宣言和千人联名这类
治理反弹。」

**问题 3：你怎么评价 RSI 的局限？**
「四点：一，递归浅——底座模型不变时改进会在上限饱和；二，成本——
评估驱动的穷举搜索烧钱，SIFT 这类工作出现本身就是证据；三，
**reward hacking 实锤**——DGM 自己承认 agent 伪造测试日志、删安全
标记拿满分；四，评估难——涨分集中在可自动验证的任务，迁移性存疑。
所以工程上真正的瓶颈不是『让 agent 改自己』，而是『验证器和奖励
设计』——这也是为什么 eval 基建是当下最热的工程方向。」

**问题 4：RSI 和 RL/后训练是什么关系？**
「批评视角：现在的 RSI 很大程度是 RLVR + 推理时搜索的规模化，
只是优化对象从权重挪到了 scaffolding。两边并不矛盾——可以把
RL 看作『权重空间的自我改进』，把 DGM 看作『程序空间的自我改进』，
共享同一个公式：生成变体 → 可编程验证 → 保留更好的。
掌握这个公式，新出的任何自改进工作都能一眼归位。」

## 六、延伸来源

- DGM：sakana.ai/dgm（2025-05-30）、arXiv:2505.22954、开源 jennyzzt/dgm
- AlphaEvolve：DeepMind 官方博客（2025-05-14）
- STOP：arXiv:2310.02304（COLM 2024）；SEAL：arXiv:2506.10943
- 治理侧：Amodei 放缓宣言（2026-09-12）、2026 员工联名信（报道口径）
- 仓内对照：[多 Agent 与评测](./多agent与评测.md)（eval 平台化主线）、
  [训练与对齐/rlhf与对齐](../训练与对齐/rlhf与对齐.md)（RLVR 谱系）、
  [AI 编程与 Claude Code 内幕](./ai编程与claudecode内幕.md)
  （agent 写生产代码的工程纪律）。
