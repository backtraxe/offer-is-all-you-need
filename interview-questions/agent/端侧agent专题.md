# 端侧 Agent 专题：本地 3B 怎么长成一个 Agent

> **面向**：已读过 [端侧推理专题](../端侧推理专题.md)（模型怎么在端上跑通：带宽
> 天花板、量化档位、引擎选型）与 [gui-agent与computer-use专题](./gui-agent与computer-use专题.md)
> （像素进、鼠标键盘出的兜底回路）的读者。本篇是第三根柱——**agent 逻辑跑在
> 端上怎么设计**。那两篇分别讲「引擎侧」和「没有 API 时的视觉兜底」，本篇讲
> OS 级架构、路由决策、工具生态与能力底线，只串联、不重复。
>
> **读完获得**：① 端侧 agent 的四家架构谱系——Apple 本地 3B + PCC + 适配器仓
> （官方披露最全）、AICore/Gemini Nano 的能力边界六条、Qualcomm/MTK 的芯片厂
> 叙事边界；② 端云路由三判据与 Apple/Google 两套隐私分级答案；③ OS 级工具
> 暴露（App Intents / AppFunctions——**端上 MCP**）、本地 RAG 权限模型、屏幕
> 理解两条管线；④ 小模型 tool calling 的能力底线数字（BFCL 水位线、xLAM-2 /
> Hammer 家族）；⑤ 车机与机器人端侧 agent 实例（Gemini Robotics On-Device、
> Figure Helix）；⑥ 8 条面试题的完整答法。
>
> **时效口径**：素材截至 **2026-10-12**；官方一手来源均括注时间，厂商新闻稿
> 与二手条目在文末「口径与未核实说明」逐条标注。Apple 训练使用用户数据的口径
> 已从「绝不」改为「显式 opt-in」（2026-09-09 官方更新），引用时务必用新口径。

## 〇、本篇与相邻专题的边界

同一张桌子上的三篇，面试时经常被连续追问，先划清界线：

- **端侧推理专题**答「模型怎么在端上跑」：60 GB/s LPDDR vs HBM 3 TB/s 的带宽
  天花板、够用 3B 的尺寸收敛、llama.cpp/ExecuTorch/Core ML 引擎选型、发热
  降频。本篇只在引用延迟/吞吐数字时点一句结论，不展开引擎细节。
- **GUI agent 专题**答「没有 API 时怎么办」：截图 → 视觉 grounding → 坐标
  动作的兜底控制回路，OSWorld/AndroidWorld 评测。本篇讲的 App Intents /
  AppFunctions 是与它正交的路径 B——**结构化 API 路线**，快、准、但要开发者
  配合暴露。
- **本篇**答「agent 编排逻辑放在设备本地，整个系统长什么样」：谁在端上推理、
  什么请求上云、工具从哪来、权限怎么隔离、小模型到底够不够格。

面试串联视角一句话：GUI agent（路径 A，无需开发者配合、慢但通用）→
AppFunctions/App Intents（路径 B，结构化、快、要开发者暴露）→ MCP（云端
工具座标准）——三者是「工具接入」这枚硬币的三个面。Google 官方原话直接把
AppFunctions 比作端上 MCP：「Mirroring how backend capabilities are declared
via MCP cloud servers… provides an on-device solution」（Android Developers
Blog 2026-02-25）。

## 一、架构谱系：四家 OS/芯片级答案

### 1.1 Apple Intelligence：本地 3B + PCC + 适配器仓（官方披露最全）

两代官方技术报告加官网更新，Apple 是所有厂商里架构披露最完整的，面试引用
尽量用它家数字，可溯源、可追问、不会穿帮。

**2024 代际**（machinelearning.apple.com，WWDC24 配套，2024-07-29 更新）：

- 端侧约 3B：vocab 49K、输入输出 embedding 共享、GQA；服务器模型 vocab 100K。
- 端侧量化用 **low-bit palletization**：混合 2-bit/4-bit、平均 3.7 bpw
  （激进档 3.5 bpw）做到与未压缩同精度；由此产生的质量损失用
  accuracy-recovery LoRA 适配器补回。
- **适配器即「功能即模型」**：每个 feature（邮件摘要、通知摘要、写作工具…）
  训一个 rank-16 LoRA 适配器、fp16 表示、约几十 MB，运行时动态加载/换出——
  同一个底座随任务换技能。金句记好：**agent 的领域特化不塞进 base model，
  而是外挂可热插拔的 adapter 仓库**。这是端侧 agent 最值得背的结构创新。
- 端侧硬数字（iPhone 15 Pro，官方）：TTFT 约 0.6 ms/prompt token，生成约
  30 tok/s（未上投机解码）。
- 训练栈用 Apple AXLearn（JAX/XLA）；后训练两个自研算法：teacher-committee
  拒绝采样微调 + mirror descent 的 RLHF（leave-one-out advantage）。
- 2026-09-09 脚注更新：训练使用用户数据从「绝不」改为**显式 opt-in**（用户
  可主动选择帮助改进 Siri/Apple Intelligence）——旧口径已经过期，面试别背
  旧答案。

**2025 代际**（arXiv 2507.13575，2025-07-17）：

- 端侧仍约 3B，新增多模态（ViTDet-L + Register-Window 视觉编码器，图像压缩
  为固定数量 image token）。
- 架构两处省算优化：KV-cache sharing（transformer 分两块，第二块省 K/V 投影
  直接复用第一块，**省掉 37.5% 的 prefill 计算**）；2-bit QAT（可学习缩放因子 +
  迭代初始化稳定低比特训练）；embedding 4-bit、KV cache 8-bit；tokenizer 扩
  到 150K 支持更多语言。
- 训练省钱新招：sparse upcycling（dense → MoE 蒸馏重训）把训练成本降约
  90%。
- 量化代价说得很透明：MMLU 从 67.8 掉到 64.4（2-bit）——2-bit **换来约 40%
  内存节省、掉约 3 分 MMLU**，是面试可直接引用的取舍数字。
- 服务器模型是 PT-MoE（Parallel-Track MoE）：多个独立 track 只在 block 边界
  同步（通信比 TP 少），track 内置 local-expert MoE + grouped GEMM top-k 路
  由；交错 global-local attention（global 层去 RoPE 利于长度泛化并省 KV）；
  预训练 13.4T tokens；权重用 Apple GPU 原生 ASTC 纹理压缩在线解压到
  3.56 bpw，质量损失再用 LoRA 补——「**压缩损失一律用 adapter 赎买**」这套
  打法从端侧复用到云端。
- **Foundation Models framework**（WWDC25，iOS 26 起）：Swift 原生 API，三大
  能力——guided generation（约束解码与 Swift 类型系统绑定，直接产出结构化
  数据）、constrained tool calling（**框架保证 tool call 结构正确**——后训练
  加了 tool-use 数据，但正确性由受约束解码兜底，不是靠模型自觉）、LoRA
  adapter fine-tuning（官方 Python 工具包训自定义适配器）。
- 关键商业口径（apple.com/siri，2026-06 更新）：「Any app can tap into the
  on-device models… work offline. And it's all at **no cost per request**」
  ——**端侧推理对开发者零边际成本**，这是对比云端 API 成本最硬的数字锚。

**2026 最新口径**（apple.com/siri 与 Apple Support，2026-09）：Siri AI
（Beta）以「完全重写的对话式助手」于 2026-09 发货，「grounded in your
context, private at every step」——WWDC24 画的个人语境（personal context）
+ 屏上感知（screen awareness）的饼在 iOS 26 周期落地。隐私三段论不变：
on-device processing → Private Cloud Compute → 第三方显式 opt-in。PCC 三承
诺原文：「Your data is never stored / Used only for your requests / Verifiable
privacy promise」——Verifiable 指服务器运行镜像与公开审计镜像一致，研究者
可独立验证（security.apple.com 文档）。

### 1.2 Android AICore / Gemini Nano：「模型是系统服务，不是你的依赖」

Android 的解法是另一条哲学：模型不出厂打包进 app，而是由系统服务统一分发。

- **AICore 是 Android 14 起的系统服务**（android-developers 官方博客
  2023-12 定义）：负责 model management、runtimes、safety features；app 不打
  包模型，Nano 由 AICore 分发和 OTA 更新。
- 能力边界六条（developer.android.com/ai/gemini-nano 官方页，经社区镜像核实）：
  1. 开发入口只有六个 ML Kit GenAI 高级 API：Prompt / Summarization /
     Proofreading / Rewriting / Image Description / Speech Recognition——
     **官方没有暴露裸 chat / 裸 tool-calling API**，第三方 agent 的「编排权」
     留在 Gemini/系统侧；
  2. Nano 多模态：text/image/audio 进、text 出；
  3. 隐私架构建在 Private Compute Core 原则上：Restricted Package Binding
     （仅整包 OTA 可改）+ Indirect Internet Access（所有外联必须经开源的
     Private Compute Services APK，github.com/google/private-compute-services）；
     请求隔离，处理完不留输入输出记录；
  4. 安全责任切分：AICore 内置安全过滤，但官方明示「开发者对自己 API 调用
     的安全负全责」；
  5. 分发管控：ML Kit GenAI 另有单独 ToS；
  6. 架构图里出现「LoRAs」但页面未展开——对应下一条的官方兑现。
- **适配器双子星的另一半**（Android Developers Blog 2025-08-22）：Google 自己
  也用「per-feature LoRA adapter 压在 Nano 底座上」保证六个 GenAI API 的质量
  稳定——evals 决定要不要训 adapter，模型换代（nano-v2 → nano-v3）时 API 质量
  不回退。与 Apple 的 rank-16 adapter 仓如出一辙——**底座加适配器的双轨已是
  两家平台级共识**，面试可互引。
- Nano 代际性能（官方 Pixel 10 Pro，2025-08）：nano-v3 的 prefill 速度
  text-to-text 940 tok/s（vs v2 同机型 610、v2 @ Pixel 9 Pro 510）；
  image-to-text 940 tok/s + 图像编码 0.6 s（v1 时代 0.8 s）。注意官方只给
  prefill 不给 decode——可点破**端侧看 prefill 增速快、decode 被带宽锁死**，
  与端侧推理专题的带宽结论咬合。

### 1.3 Qualcomm / MTK / Meta：芯片厂与开源系的叙事边界

- Qualcomm AI Hub（2024-02 发布）：预编译到 Hexagon NPU 的优化模型仓库
  （Llama 2/3、Whisper、ControlNet 等百款以上），还能把自己的模型喂进去量化
  编译——定位是端侧推理部署市场，不是 agent 框架。Snapdragon 8 Elite（2024-10）
  起官方话术转向 agentic：「AI 助手理解屏幕内容、跨 app 代你操作」为卖点；
  Snapdragon Summit 2025-09 的 8 Elite Gen 5 / X2 Elite 继续主打 agentic AI 与
  始终在线感知。【厂商新闻稿口径，未读到独立评测】
- MTK：Dimensity 9300（2023-11）起支持端上 70B INT4 的营销口径、9400
  （2024-10）第八代 APU 890 +「端侧 LoRA 训练 / Agentic AI」生态（阿里通义、
  混元小模型合作），并宣布与 OPPO/vivo 的 agent 共建；2025 开发者大会主打
  「智能体化引擎」。【全部厂商口径，未能取得一手英文新闻稿，标注未核实】
- 两家共性值得背：**芯片厂不做 agent 编排**——它们卖的是 NPU 算力 + 模型
  适配工具链 + 与 OS 厂的 co-marketing，编排层永远是 OS 厂（Apple/Google）或
  OEM（三星/OPPO/小米）。被问「为什么高通不做自己的 agent」就按这条答。
- Meta 端侧口径：Llama 3.2 1B/3B（2024-09，官方明确为 on-device 设计，128K
  上下文、支持 tool-use 微调）仍是 Meta 系端侧主力；Llama 4 Scout/Maverick
  （2025-04）转 MoE 大模型线，不是端侧货。**Meta 端侧 = 小 dense + 开源许可
  献给生态，Apple 端侧 = 私有 3B + 适配器仓**，两种路线对照鲜明，是很好的
  开放题素材。

<div class="diagram-embed">
<iframe src="assets/diagrams/edge-agent-arch.html" width="100%" height="1100" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/edge-agent-arch.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、端云路由：什么留端，什么上云

### 2.1 路由三判据（跨厂商收敛出的工程共识）

被问「端云怎么协同」，先给三个判据，再给 Apple 的标准链路：

1. **能力够不够**：端侧 3B 能否完成——任务复杂度、上下文长度、所需工具是否
   本地可达。摘要、改写、分类、封闭 tool calling 端侧稳；知识密集问答、长文
   创作、多跳推理端侧悬。
2. **数据敏感度**：体检报告类死守端侧；PCC/PCC-like 私有云算「同一信任域的
   延伸」；送第三方 LLM 必须显式授权。
3. **时效与成本**：端侧 TTFT ≈ 0 网络 RTT、decode 8~15 tok/s 量级（A18 实测
   推导，详见端侧推理专题）；云端多了网络 +50~300 ms，但 decode 快一个数量级。

Apple 官方的实际链路：**请求先在端侧由设备端分类器分级**（2024 官方博客明
示）→ 端侧能办就办 → 超纲走 PCC（Apple silicon 服务器、同构模型、无状态）
→ 仍超纲（如问 ChatGPT）弹窗征得逐次同意。注意细节：**路由决策本身也是端
侧模型做的**——分类器是小模型最常见的隐藏岗位。

Google 侧是同构图：ML Kit（端）→ Vertex AI Gemini API（云）→ 第三方。
Pixel 10 + AICore v3 后，大量曾经上云的摘要/改写功能被留在端上。Galaxy S26
（AppFunctions 首发机型，2026-02）上「Gemini 调用三星相册」就是
**端上 agent + 端上 AppFunctions + 云端 Gemini** 的混合实例。

### 2.2 隐私分级的两套标准答案

| 层级 | Apple | Google |
|---|---|---|
| 一级（设备内） | on-device processing，永不流出 | app 本地处理 |
| 二级（私有云） | PCC：服务器镜像可审计、无持久化、无第三方运维权限、请求完成即焚 | AICore/PCC：Restricted Package Binding + 经开源 PCS 的间接外联 + 请求隔离不留痕 |
| 三级（普通云/第三方） | 用户逐次显式同意（如 Siri 调 ChatGPT，官方承诺 requests are not logged） | Gemini API / 第三方 |

对照记忆点：**Apple PCC 的 auditable 靠「镜像哈希一致性」，Android PCC 的
auditable 靠「PCS APK 开源」**——约束手段不同，信任假设同源：数据不把云当
信任域，云只做无状态受托计算。两套答案背一套就能对冲另一家的追问。

### 2.3 成本与延迟账（可引的锚）

- **端侧边际成本为零，但有隐藏成本**：Foundation Models「no cost per
  request」（2026 苹果官网）；代价是电量与热——decode 每个 token 要完整读一
  遍约 1.8 GB 权重（3B-Q4 量级），持续推理是整机功耗大头（推导值，官方未给
  mWh/token）。
- **云端成本参照系**：GPT-5-mini 级 API 约 $0.25/$2.00 每百万 token
  （2025-08 OpenAI 价目，报价需按当期价表核）——一次端侧指令重写几百 token，
  云端成本分厘级。结论是**批量后台任务（文档重写、邮件摘要）天然端侧，知识
  密集任务天然云端**。
- **延迟账本**：公网 RTT 中位 50~150 ms + 云端排队；端侧 3B 在 A18 级带宽下
  TTFT 毫秒级（Apple 官方 0.6 ms/prompt token × 输入长度）——交互式短任务端
  侧稳赢「感知延迟」，长文生成的长尾则云端胜。

▶ 面试题标注：「你的 agent 为什么不上云？」别答隐私就没了——三判据 +
no-cost-per-request 的商业账 + RTT 的感知延迟账，三层都有官方数字可引。

## 三、端上工具生态

### 3.1 OS 级工具暴露：App Intents vs AppFunctions——端上 MCP

**Apple App Intents**（2022 起源，2024 绑定 Siri/Apple Intelligence 后质变）：
用 Swift 声明 app 的可调用能力（intent/entity/query），系统自动编入系统语义
索引；用户口头指令 → Siri 匹配 intent → 执行。WWDC24 起它同时为两件事供能：
「个人语境」（semantic index 检索邮件/文件/照片里的实体引用）与「屏上感知」
（屏幕内容作为 entity 供 Siri 引用）。2026-09 发货的新 Siri AI 依赖这套体系
做大上下文个性化（Apple Support 2026-09 文档口径）。

**Android AppFunctions**（Android 16 平台特性 + Jetpack 库，Beta 于
2026-02-25 官方博客宣布）：

- 官方定位原文：app 通过 self-describing functions 让 agentic apps「discover
  and execute via natural language」；「Mirroring how backend capabilities are
  declared via MCP cloud servers, AppFunctions provides an on-device solution
  for Android apps」——**官方自己把它比作端上 MCP**，与 WebMCP 思路相同但
  本机执行。
- 落地实况（2026-02 官方）：三星相册接入 Gemini 是首发案例（Galaxy S26，
  「Show me pictures of my cat from Samsung Gallery」——多模态、语音或文本
  皆可，返回的照片还能在对话里继续引用转发）；日历/笔记/待办类目已可跨厂商
  调用；后续扩到 OneUI 8.5+。
- 平台还给了第二杠杆：**无 API 集成时的 UI automation 兜底**——用户长焦电源
  键委派多步任务，外卖/生鲜/打车三类在不同区域试点（美韩区 Beta），全程可
  live view 监控、随时接管，**付款等敏感步骤前强制提醒确认**。注意 Google 把
  GUI 自动化也产品化成了「零开发者代码」选项：AppFunctions（开发者写）与
  UI automation（平台代劳）构成完整光谱，Android 17 已预告两套能力继续放大。

三条路线的对照表（面试画图素材）：

| 维度 | MCP（云端） | App Intents / AppFunctions | GUI agent / UI automation |
|---|---|---|---|
| 接口形态 | JSON-RPC + 工具 schema | 声明式 DSL（Swift / 注解+KDoc） | 截屏像素 |
| 正确性保证 | schema 强约束 | schema 强约束 | 无，靠模型 grounding |
| 开发者成本 | 低（起 server） | 中（声明+测试） | 零（平台代劳） |
| 传输与权限 | 网络 RPC + OAuth | 系统调用 / binder + OS 权限弹窗 | 无障碍权限 + 屏幕捕获 |
| 审计 | 网关日志 | 系统 event log | 录屏与接管日志 |

金句记好：**AppFunctions/App Intents 是把 MCP 的「工具描述 + 发现 + 调用」
三段式从云端 server 搬进设备进程内**——传输从网络 RPC 变成 binder/系统调用，
权限从 OAuth 变成 OS 权限弹窗，审计从网关日志变成系统 event log。

### 3.2 本地 RAG：设备文件/相册/邮件检索的权限模型

- **Apple「personal context / semantic index」**：系统级语义索引覆盖邮件、信
  息、文件、照片、日历、事件，但**只有 Siri/Apple Intelligence 全家桶能调用**
  ——开发者侧没有「自由查询全局索引」的 API，第三方 app 只能通过 App Intents
  entities 声明自己的实体被索引，读不进来全量。金句记好：**个人语境是受限
  于系统服务的专有 RAG：索引归系统，暴露受 schema 约束**。
- **Android 侧对应物**：Gemini 应用下「连接应用」（Apps，原 extensions）读
  Gmail/Photos/Files——权限走**逐 app 授权开关**（Apps 控制页可逐个断开）；
  AICore/PCC 保证处理路径隔离且端上不留痕；AppFunctions 返回值在 agent 会话
  内可继续引用（三星相册案例官方明示）。权限粒度对照：Android 是「功能目录
  式授权」（AppFunctions 逐个函数暴露+授权），iOS 是「系统级索引 + intent 白
  名单」。
- **工程共性**：本地 RAG 的检索侧（embedding 建索引、BM25+向量混合、增量同
  步）完全可以在端上做——小 embedding 模型 + SQLite/向量库就够了。难的是
  **权限隔离**：检索结果的语料横跨邮件/相册/健康多个权限域，端侧 agent 必须
  把「权限边界传播到检索结果」（taint tracking：检索块标注来源权限域、生成
  时审计），否则一次提示注入就能借检索结果外泄私密数据——与 agent 安全专题
  的分层防御链直接衔接。

### 3.3 屏幕理解（screen parsing）在端上的实现

两条技术线并存：

- **A) 语义管线（快路）**：读 Android accessibility tree 或 iOS 的 App Intents
  entities——结构化、省算力（token 省一个数量级），但覆盖度取决于开发者标注。
  AppFunctions 的 UI automation 兜底也大量复用系统 a11y + 视觉混合（官方未披
  露细节，成分未核实）。
- **B) 视觉管线（精路）**：截图 → 端侧 VLM 解析 UI 元素与语义——Google
  ScreenAI（2024-02，5B VLM 专攻 UI/信息图理解）、Apple Ferret-UI 系列（2024
  论文，referring/grounding 式 UI 理解，二代加高分辨率与多分辨率栅格）、
  Pixel 上 Gemini「Talk about screen」。2026 年 Siri/Pixel 的 screen awareness
  都是「视音频串流到系统模型」而不是暴露给第三方——**Apple 的 screen-context
  API 截至 2026-10 未对开发者开放**（待核）。
- **工程取舍**：a11y 快但绿地覆盖差；全屏 VLM 每帧约 0.6 s 图像编码 + prefill
  （Pixel 10 Pro 官方 940 tok/s 量级），连续跟手不可得——所以产品化的屏幕理
  解全是**快门式**（用户触发一次取一屏），连续流只给系统特权（Siri overlay /
  Gemini overlay）。
- **与 GUI agent 专题的挂钩**：端上 screen parsing 是 grounding 的「轻量版」
  ——坐标精度要求低于云端 CUA（多走 intent/element-id 而非裸坐标），失败兜
  低走 UI automation 而非重试循环。

## 四、小模型能力底线：数字锚（面试最值钱的一节）

### 4.1 BFCL 水位线：agentic tool calling 的天花板与小模型位置

BFCL V4（2025-07 发布）加入了 multi-turn agentic 评测。evals.report 收录的
官方/厂商申报总分（2025-04~2026-02 区间，均为申报口径带日期）显示头部水位：

| 模型 | BFCL 总分 | 申报时间 |
|---|---|---|
| Claude Opus 4.5 | 77.47% | 2025-11 |
| Claude Sonnet 4.5 | 73.24% | 2025-09 |
| Gemini 3 Pro | 72.51% | 2025-11 |
| GLM-4.6 | 72.38% | 2025-09 |
| Grok 4.1 fast | 69.57% | 2025-11 |
| DeepSeek-V3.2 | 56.73% | 2025 年间 |
| GPT-5.2 | 55.87% | 2025 年间 |
| GPT-4.1 | 53.96% | 2025 年间 |
| Qwen3-235B | 52.15% | 2025 年间 |
| Llama-4-Maverick | 37.29% | 2025-04 |

两个启示直接可背：其一，**即便前沿模型，multi-turn agentic 也只有 55~77
分——tool calling 已不是模型竞赛的决胜项，编排与 harness 才是**；其二，
Llama-4-Maverick 这类巨型 MoE 反而垫底之一——**参数大 ≠ 会调工具**。

小模型专项训练线的官方/自报结论（arXiv 摘要口径）：

- **Salesforce APIGen-MT / xLAM-2-fc-r**（arXiv 2504.03601，2025-04）：1B~70B
  家族，在 τ-bench 与 BFCL 上超过 GPT-4o / Claude 3.5，小尺寸在 multi-turn 设
  定反超同门大尺寸——卖点是数据配方：两阶段流水线（LLM 委员会生成任务蓝图
  + ground-truth actions → 模拟人机多轮轨迹）。金句记好：**agent 的数据配方
  比参数重要**。
- **Hammer 家族**（arXiv 2410.04587，2024-10，MeetKai）：明确定位「on-device
  function calling」，0.5B~7B，用 irrelevant-function 增广数据 + function
  masking 提高鲁棒性——防的是「给了 20 个不相关工具后模型乱挑」。
- **ToolACE**（TeamACE，arXiv 2409 系列）：8B 专用模型 + 自动化 agent 数据流
  水线 TSS，宣称 BFCL 同级领先——具体百分数为自报口径，引用时标注。

### 4.2 3B/7B 底线结论（直接可用的面试答法）

1. **单轮、schema 已知、工具数 ≤ 20 的工具调用，微调过的 1~4B 可达生产可用**
   ——Apple 敢把 constrained decoding 开放给全生态就是最硬背书，xLAM-2 系列
   的自报数字是旁证。
2. **多轮依赖、跨工具规划、隐含意图消歧上，3B 与前沿差距显著**——BFCL V4
   多轮档小模型普遍崩，「会填参数 ≠ 会执行计划」。
3. **工程补偿两件套**：其一是**结构化兜底**——guided generation /
   constrained decoding 保证格式 100% 合法，把不确定性压进语义理解而非语法；
   其二是**步长收敛**——限制 plan 步数、每步规则/人工校验、敏感动作确认闸口。
   一句话收口：**端侧 agent 的工程主题，是用小步、强约束、可接管的闭环，驯
   服小模型的长程不稳**。

### 4.3 端侧微调（LoRA on device）的现实口径

- **Apple**：Foundation Models 官方 LoRA adapter fine-tuning 工具包（Python，
  2025，arXiv 2507.13575）——训练在开发机/Mac 上做（MLX 生态：mlx-lm 在
  32GB+ 的 Apple Silicon 机器上可训 7~8B QLoRA，社区通用口径），产物随
  Foundation Models framework 部署到端上；iOS 26 起 adapter 可随 app 分发。
  「训练在 Mac、推理在 iPhone、分发走 app」**的完整链路已官方打通**。
- **Google**：官方自己在 ML Kit 幕后用 per-feature LoRA（2025-08 博客明写），
  但**对第三方不开放自定义 adapter 训练**——第三方校准只能靠 Prompt API 的
  few-shot。「可定制性天平 Apple > Google」是 2026 年前的明显差异。
- **Android 第三方路线**：AI Edge / LiteRT 跑 Qwen3 4B、Gemma 3n、LFM2 等开
  源小模型（app 自己打包，走 Play for On-Device AI 分发；与 AICore 的 Nano 并
  不冲突）。
- **真·端上训练仍是期货**：Apple 2025 tech report 把 federated /
  on-device continual learning 明确列在未来方向。现阶段量产端侧 LoRA 全部是
  「云端/开发机训、端上推理」，营销里的「on-device fine-tuning」绝大多数指
  「推理时注入 adapter 做个性化」，不是端上反向传播——面试遇追问可直接拆。
- **开源底座现实清单**（与端侧推理专题「够用 3B」合并记）：Qwen3 4B/8B
  （Apache 2.0，官方 tool-calling 训练模板）、Gemma 3 4B/3n（端侧多模态、
  MatFormer 套娃）、LFM2（Liquid AI 2025-07，面向 edge 的混合架构，官方宣称
  CPU 吞吐 2× Qwen3 同级）、SmolLM3 3B（HF 2025）。

## 五、车机 / 机器人端侧 Agent 实例

### 5.1 机器人：三个一手来源可引的端侧 VLA

**Google Gemini Robotics On-Device**（deepmind.google 官方博客，2025-06-24）：

- 首个可 fine-tune 的 VLA 端侧模型，**完全脱离网络运行**，主打延迟敏感与断
  连/弱网环境；双臂 ALOHA 起步，可迁移 Franka FR3 双臂与 Apptronik Apollo
  人形。
- **50~100 条演示即可适配新任务**（官方数字）；泛化任务（拉拉链、折衣、抽
  卡、倒沙拉酱）击败此前最佳 on-device VLA。
- 安全架构值得背：语义安全由 Live API 把关——**注意 Live API 是云端部件，
  与「on-device 决策」分离**（安全判定上云、快控制回路本地），低层另有
  safety-critical controller 兜底动作执行。
- 配套 SDK 送 MuJoCo 仿真评估，走 trusted tester 先行计划。

**Figure Helix**（figure.ai 官方，2025-02）——端侧 agent 架构学的最佳案例：

- 端上双 brain：S2 = 7B VLM（7~9 Hz，语义与规划）+ S1 = 80M transformer 策略
  （200 Hz 连续控制，35 DoF 全上身），两份权重部署在**两块嵌入式低功耗 GPU
  上异步并行**，S2 的 latent vector 作共享记忆传给 S1。
- 训练时刻意引入 temporal offset，与部署延迟对齐以消除 train-deploy gap。
- 数据效率：约 500 小时遥操作数据（官方称不到前作数据量的 5%），单套权重零
  样本 pickup 数千未见物体，还能双机协作。
- 金句记好：**S1/S2 快慢系统就是端侧 agent 架构学——小模型管快反射，大模
  型管慢规划，两者通过低带宽 latent 通道通信**。

**NVIDIA 侧事实点**（2025-03 GTC 官方新闻稿口径）：Isaac GR00T N1 开源人形
基础模型（VLA，双系统回路与 Helix 同构），Jetson Thor 为端上算力底座；
GR00T N1.5 于 2025-06 开源——「双系统 VLA + 端上 Thor」已成业界默认参考架
构。【细节未逐条核，列官方发布口径】

### 5.2 汽车座舱：车端 agent 的现实结构

- **座舱芯座**：Snapdragon 8295（SA8295P，30 TOPS NPU）是 2024~26 中国高端
  座舱绝对主力，官方与 OEM 演示均含端上 LLM 运行；新一代 Snapdragon Cockpit
  Elite（2024-10 官宣）对标舱驾融合。
- **现实架构是「云端大模型 + 车端小模型兜底」**：离线/隧道/弱网时，车窗、
  空调、导航等**本地意图车端闭环**——车端 1~7B 级模型管车载 function calling；
  开放问答/创作类走云端。蔚来 NOMI GPT（2024）、理想「理想同学」Mind GPT、
  小米 SU7 小爱同学大模型版均为混合架构（各厂新闻口径，模型参数未公开，未
  核实）。
- **车端与手机端的三个差异**（面试可讲的差异化答案）：
  1. 网络环境更差（隧道/地下车库）——**离线完备性是一级需求而非加分项**；
  2. 工具集封闭（车控 API 几百个、schema 稳定）——小模型微调即可打满，是
     「小模型 agent 够用」论的最佳证明场景；
  3. 安全等级不同——ASIL 语境下 agent 输出不直接对接驱动执行器，车控动作
     经车规硬件抽象层二次确认。

### 5.3 跨场景的共同架构语言

把 5.1/5.2 与手机案例叠起来看，三件事是通用的，任何「设计端侧 agent」的题
都可以往这三个词上收口：

1. **分层**：云端/端上大模型 = 慢规划；本地小模型/规则引擎 = 快反射与人身
   安全兜底。
2. **降级链**：断网 → 小模型接管封闭技能集（车控、相机快门、闹钟电话短信）。
3. **人类接管点**：Android UI automation 付款前提醒、车控确认、机器人
   e-stop——敏感动作永远留确认闸口。

## 六、面试题答法（完整链路）

**Q1：设计一个在手机上运行的个人助理 agent，架构怎么搭？**

四层往上说：① 模型层——本地 3B 底座 + LoRA 适配器仓热插拔（Apple/AICore
两家官方背书的范式），量化用 low-bit palletization 补 accuracy-recovery
adapter；② 工具层——App Intents/AppFunctions 声明式暴露能力（端上 MCP），
无 API 的场景落 UI automation 兜底；③ 记忆层——本地 RAG 走系统语义索引或
逐 app 授权的 Apps 连接，检索结果做权限域 taint tracking；④ 路由层——设备
端分类器按能力/敏感度/成本三判据分级，端 → PCC → 第三方 opt-in。收尾点一
句：路由决策本身也是端侧小模型做的。

**Q2：什么请求留在端上，什么上云？**

先三判据，再两本账。成本账：端侧 no cost per request（Apple 2026 官网口径）
vs 云端每百万 token 美元级，批量后台任务天然端侧；延迟账：端侧 TTFT 毫秒级
（官方 0.6 ms/prompt token）+ 无 RTT，公网 RTT 中位 50~150 ms——短交互端
侧稳赢，长文生成云端 decode 快一个数量级。最后给 Apple 三段链路作实例。

**Q3：3B 模型做 tool calling 靠谱吗？**

分层答。单轮封闭 schema（工具 ≤ 20）：可靠，xLAM-2 1B~70B 在 τ-bench/BFCL
超 GPT-4o/Claude 3.5（自报口径），Apple constrained decoding 兜底格式。
多轮 agentic：不可全信，BFCL V4 前沿也只有 55~77 分。工程补偿：guided
generation 保格式 100% 合法、计划步长收敛、敏感动作确认闸口。

**Q4：端侧 agent 和 GUI agent 是什么关系？**

同一条工具接入光谱上的两端。Google 官方双轨：AppFunctions（开发者写的 API
路线）+ UI automation（平台代劳的 GUI 路线）；能力谱系 MCP ←→ AppFunctions
←→ UI automation。选型的轴是开发者配合度 × 正确性保证 × 时延：要准要快要
schema 强约束走 API，要零接入成本走像素。

**Q5：隐私分级怎么设计？**

Apple 三级 vs Google 三级对照答（设备内 → 私有云 → 第三方）。审计手段对照：
PCC 靠镜像哈希一致性，Android PCC 靠 PCS APK 开源。加分项：本地 RAG 必须做
检索结果 taint tracking，否则提示注入借检索外泄私密数据。

**Q6：车上/机器人上的 agent 和手机有什么区别？**

车：离线完备性一级需求、封闭工具集小模型打满、ASIL 下 agent 不直连执行器。
机器人：快慢双系统（Helix S2 7~9 Hz 管规划 / S1 200 Hz 管控制），语义安全
上云（Live API）而控制回路本地。共同语言：分层、降级链、人类接管点。

**Q7：端侧模型怎么个性化？**

adapter 仓热插拔（Apple rank-16 几十 MB、AICore per-feature LoRA）；训练在
云端/开发机，端上只推理 + 换 adapter。顺手拆营销话术：「on-device
fine-tuning」绝大多数指推理时的 adapter 注入，不是端上反向传播。

**Q8：端上怎么做屏幕理解？**

a11y 快路 vs VLM 精路，工程上全是快门式取屏（约 0.6 s 编码 + prefill 940
tok/s，Pixel 10 Pro 官方量级），连续流是系统特权。学术线 ScreenAI /
Ferret-UI；CUA 的裸坐标在端上轻量化成 element-id/intent 锚定，失败兜底走
UI automation 而非重试。

## 六·增：硬件操控 Agent 的安全三层（大疆面经口径，2026-10）

> 来源：抖音大疆 AI 大模型应用开发三面（529 赞 8-8，谢九对话体，单帖自报），
> 面经合集三十节 §2。与本篇 Q6 车规口径同族——汽车的答案是 ASIL 下 agent
> 不直连执行器，无人机的答案是下面三层加禁止自动重试。

- **环境分层**：仿真环境、测试真机、正式业务设备三档，所有新功能先在仿真
  跑通再上真机；迭代更新走灰度上线。
- **安全拦截组件独立迭代**：硬件操控的多层安全校验组件和业务代码解耦、单独
  管控——业务功能可以快速迭代，安全校验组件保持稳定。
- **每次更新自动执行安全用例**：把安全检测沉淀成自动化测试，每次更新必跑，
  不靠人肉回归。
- 配套口径：**硬件操控和互联网客服 Agent 的核心区别在实体风险——客服输出
  文字几乎无实体风险，硬操一旦幻觉、错误参数直接设备损毁与空域事故**，因此
  安全优先级最高、全部动作过安全校验分级兜底，且失败禁止自动重试（先查设备
  当前状态、人工确认后再执行）；需求冲突的沟通模板也照此展开——认同快速上
  线原型 + 原型只连仿真机 + 最简安全清单（先加参数范围校验）+ 约定真机上线
  必配全套安全拦截。

## 七、口径与未核实说明

**已核实一手来源**：Apple 2024/2025 tech report 与 apple.com/siri 页（2026 更
新）；Android AppFunctions 官方博客（2026-02-25）；Gemini Nano nano-v3 性能
官方博客（2025-08）；Gemini Robotics On-Device 官方博客（2025-06-24）；Figure
Helix 官方（2025-02）；arXiv 2507.13575 / 2504.03601 / 2410.04587 摘要；
evals.report 收录的 BFCL 申报分数（均标注申报时间）。

**二手 / 待核**：Apple Support 2026-09「Siri AI (Beta)」条目（标题手录，正文
未展开核实）；MediaTek Agentic AI 引擎、Qualcomm agentic 话术、座舱 OEM 车端
模型参数——全部厂商口径未独立验证；ToolACE 具体分数为自报；Apple
screen-context 第三方 API 截至 2026-10 未开放（建议用时再核）；GR00T N1.5
精确参数量与 PCC 官方延迟数字未见披露。

**废弃来源**：benchlm.ai 的 BFCL 页含查无此模型的条目（BTL-3 / Atria Dawn），
判定为内容农场，本专题所有 BFCL 数字均以 evals.report 收录的申报口径为准。

**待办核查**：Galaxy S26 的 AppFunctions 完整函数目录、Android 17 对 AppFunctions
与 UI automation 的扩围细节，建议在引用前复核当期官方文档。
