# assets/diagrams — Archify 交互大图生产手册

本目录下全部 HTML 由 [archify skill](https://github.com/tt-a1i/archify)（本地装于 `~/.kimi-code/skills/archify`）产出，
替代了原先的 mermaid 图。每张图可缩放、悬停看注释、切暗色、导出 PNG/SVG。

**改图流程：改 candidate.json → 重跑 finalize → 覆盖本目录 HTML。永远不要在 md 里重新写 mermaid（全仓库已清零，保持为 0）。**

## 快速开始

```bash
# 1. 建候选目录
mkdir .archify/workflow-<slug>-$(date +%Y%m%d-%H%M%S)

# 2. 写 candidate.json（meta.output 指向同目录 <slug>.html）

# 3. finalize（四道门：validate → deliver → check → browser-check 全过才算完）
node ~/.kimi-code/skills/archify/bin/archify.mjs finalize \
  <type> <dir>/candidate.json <dir>/<slug>.html \
  --quality showcase --out-dir <dir>/review-N --json
# 重跑必须换 --out-dir（review-1 → review-2 → …）

# 4. 通过后
cp <dir>/<slug>.html assets/diagrams/

# 5. 必做：headless Chrome 截图目检
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=10000 --window-size=1440,1050 --hide-scrollbars \
  --screenshot=/tmp/chk-<slug>.png "file://$PWD/assets/diagrams/<slug>.html"

# 6. md 中嵌入（iframe src 必须是站点根相对 assets/diagrams/…，不要 ../）
# <div class="diagram-embed">
# <iframe src="assets/diagrams/<slug>.html" width="100%" height="<H>" style="border:none;border-radius:12px" loading="lazy"></iframe>
# <p><a href="assets/diagrams/<slug>.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
# </div>
# H ≈ finalize 产物实际高度 + 90~110（2 泳道 ~700、3~4 泳道 ~800-940、sequence ~860）

# 7. 收尾验证
grep -rc '```mermaid' --include='*.md' .   # 应全为 0
python3 -m http.server 8899 &              # 抽一页 docsify 站点截图后 kill
```

类型选择：时序/调用链 `sequence`；状态机 `lifecycle`；其他全部 `workflow`。locale 一律 `zh-CN`，quality 一般 `showcase`。
candidate 目录可参照任一 `.archify/*/candidate.json`（该目录已 gitignore）。

## 硬性约束（撞过才写，条条有代价）

| 约束 | 数值 / 规则 | 解法 |
|---|---|---|
| viewBox 宽上限 | ≈ **1240px**（非硬编码：desktop-readability 按 930px 默认阅读宽度投影，最小源字号 8px 投影后不得 < 6px，8×930/6=1240） | 首选缩 **sublabel 文本**（宽度按文本实测撑开）；砍宽度要砍「**该列/跨泳道的最大节点**」，砍非最大节点无效；长文本挪进 cards |
| 宽高比 | 无显式 viewBox 时 w/h ≥ **1.55** | 加宽每列最大节点；或显式 `meta.viewBox`（值必须 ≥ render 命令实测最小容量，宜先用 render 探一次） |
| workflow 列数 | col ≤ **5**（6 列注定超宽） | 长链两行包行，包行折行边加 `role:"return"` |
| lifecycle 列数 | col ≤ **4**（比 workflow 少 1） | 状态多时复用列、错开泳道 |
| mainPath | 相邻 id 必须有对应边、col 不许回退 | 只填连续主链子序列即可 |
| 3+ 路扇出 | 同侧直连易箭头/走廊冲突 | **上下包夹**：目标节点分置源节点上、下泳道，边垂直走 |
| 同列垂直扇入 | 触发 arrowhead-collision | 汇入目标与来源**错列** |
| corridor 冲突 | `ambiguous-corridor` 加 label 无效 | 根本解法是**重排泳道顺序**，让扇出与汇入占用不同 x 区间；只有「边间隙恰好 28px」这类才是加短 label 能救的 |
| candidate.json 手写换行 | 真实换行破坏 JSON | 卡片标题等字段禁用换行，用 Edit 检查 |

## 阅读器与宽屏脚注

- 阅读器默认 **960px 宽**渲染（chrome 30px 后正文 930px），这是 1240 上限的根源；
  我们的嵌页场景自带缩放/全屏/新窗口，所以这个保护对实际阅读不是强约束。
- 源码预留 **declared-wide-v1** 宽屏契约（上限 1920px，要求 w/h≥1.55 + intrinsic-height fit），
  由渲染器自动声明，candidate 无法直接命令。
- 若未来确需低于 6px 的地板以换取超宽画布，改 `~/.kimi-code/skills/archify/renderers/shared/desktop-readability.mjs`
  里的 `MIN_PROJECTED_NODE_TEXT_PX`（6→5 ≈1488px；6→4 ≈1860px），改前和现在对比一张图再定。

## 非阻塞项（不必强求归零）

- deliver 的 advisory `visualReviewRecommendation`（detour/crossing hint）：细线单次交叉若目检可读就接受；
  为消一个 hint 大改布局往往引入更多交叉（B 组实测挪 Approved 节点反而 1 交叉变 2）。
- sequence 无自消息语法：`Note over X`、`X->>X` 用消息的 `note` 字段表达（FULL 缩放/悬停显示，属特性）。

## 验证清单（每批交付前）

1. finalize 四道门全过（无 error，仅 advisory 可留）
2. headless Chrome 逐张截图目检：无节点重叠 / 文字截断 / 箭头错乱 / 配色异常
3. `grep -rc '```mermaid' --include='*.md' .` 全 0
4. http.server 抽一页 docsify 页面截图，确认 iframe 渲染 + 新窗口链接正常
5. git add 只含本批 html + 对应 md，commit 里写明每张图的 slug 与内容

## 历史批次

- 批次 1–6（49 张）：llm 基础 / agent / rag / 训练对齐 / 分布式训练 / inference（至 e30ecc6）
- 批次 7（10 张）：system-design 六大设计题（b091361）
- 批次 8（6 张）：resources 学习路线图 ×2、iq README ×2、源码解读 README + 源码学习路线图（be24f4a）
- 批次 9（1 张）：rl-evolution RL 算法演化线（训练与对齐 rlhf与对齐.md 第十五章）
- 批次 10（1 张）：muon-update 一步 Muon 更新全流程（训练与对齐 muon与优化器.md）
- 批次 11（1 张）：slo-capacity 业务 SLO → 引擎预算拆解树（inference 推理服务slo与运营.md）
- 批次 12（1 张）：hallucination-map 幻觉来源四件套 → 缓解三板斧（rag 幻觉与事实性.md）
- 批次 13（1 张）：personal-assistant-arch 个人助理 Agent 分层架构（system-design 设计个人助理agent.md，通道/调度面/Runtime/本地四泳道）
- 批次 14（1 张）：kv-tiering KV 多级体系四泳道（GPU→host→SSD→对象存储，驱逐下行与 miss 换入/重算两条路）（inference 长上下文推理与kv体系.md）
- 批次 15（2 张）：basics 入门篇——next-token-loop 完形填空闭环四步+回环（basics/01 什么是大模型.md 第一节）；attention-intuition 全班传小抄双泳道（「买苹果手机了」Q/K 打分→加权求和→新表示，k2 手机走右侧入 score 化解箭头碰撞）（basics/02 transformer直观入门.md Q/K/V 一节）
- 批次 16（1 张）：pi-agent-loop 三泳道（应用层/运行时/模型层）——一次请求经过 Pi agent loop 全过程：上下文装配→streamFn 流式→toolCall 判定→工具批次→toolResult 回写/下轮 turn 或 agent_end（agent/pi-agent源码分析.md 第二节）
- 批次 17（1 张）：dsh-turn-flow 三泳道（能力缝/agent loop/session log）——DeepSeek Harness step/turn 双层循环 + 事件溯源 + 工具管线/compaction 两个能力缝（agent/deepseek-harness分析.md 第三节）。教训记录：5 列 + 跨泳道对角边（prestep→sesslog 型）会显著推高 viewBox，节点宽度预算要比普通 5 列图再紧一档（单列最大节点 ≲190）
- 批次 18（1 张）：codex-safety-layers 三泳道（策略层/命令生命周期/OS 内核层）——Codex 三层安全纵深：execpolicy 规则 → AskForApproval 审批 → Seatbelt/Landlock 沙箱，含 forbidden/用户拒绝两条回模型支路（agent/codex源码分析.md 第三节）
- 批次 19（1 张）：mcode-vendor-arch 三泳道（自研外壳/vendor 底座/云服务）——MiniMax Code 商业化结构：packages 外壳 + third_party/pi-mono 原样 vendor + MINIMAX_CHANGES 补丁台账 + 云端分类器/BYOK（agent/minimax-code分析.md 第〇节）
- 批次 20（1 张）：vllm-vs-sglang 双泳道对照——vLLM V1 两刀进程（API/EngineCore/Worker+APC 块哈希）vs SGLang 三刀流水线（Tokenizer/Scheduler/Detokenizer+Radix Tree）（inference/vllm与sglang深度对比.md 第二节）。教训：mainPath 相邻 id 必须有边——跨 lane 的 sched→radix 边不能进 mainPath
- 批次 21（1 张）：fc-vs-mcp-paths 三泳道（宿主/工具供给/模型侧）——一次 tool_call 的两条路：内置工具进程内 execute vs MCP Client 转发 JSON-RPC，observation 总回流（agent/mcp与工具调用深度对比.md 第一节）。教训：分组回程边（结果回传）与去程边共用走廊必撞 arrowhead/ambiguous-corridor，只留一条总回流边即可过门
- 批次 22（1 张）：skill-triple-disclosure 双泳道（上下文预算/磁盘）——Skills 三层渐进式披露：索引常驻→命中才 read 正文→脚本只消费输出（agent/agent-skills详解.md 第二节）
- 批次 23（1 张）：lb-layers 双泳道（流量侧/算力侧）——负载均衡六层地图 L1 网关→L6 运行时→L3 路由亲和→L2 引擎调度→L4 MoE 专家→L5 并行切分（interview-questions/负载均衡专题.md 总表后）。教训记录：mainPath 必须与边链一致（l1→l6→l3→l2 实际边链），6 节点两列并行时单列宽度 ≲140
- 批次 24（1 张）：vram-anatomy 三泳道（固定/动态/开关变量）——显存五笔账：权重→框架→KV→激活→draft，Mamba 让 KV 不存在（interview-questions/显存计算专题.md 第二节前）
- 批次 25（1 张）：kv-knobs 双泳道（通用公式链/70B GQA 实例）——KV 显存三旋钮：每 token 单价 × 并发 × 上下文 − 前缀去重，实例泳道给出 320 KB→10 GB/条→1M 时 320 GB→APC 省 83 GB 的完整代入（interview-questions/显存计算专题.md 第四节）
- 批次 26（1 张）：agent-ladder 双泳道（阶梯/终点形态锚点）——Agent 进阶阶梯 L0 最小循环→L1 prompt 工程→L2 上下文→L3 可靠性→L4 trace/eval→L5 四框架形态（agent/agent由浅入深路线图.md 总表后）。教训：同泳道同列节点报 node-overlap，终点节点挪独立泳道即过
- 批次 27（1 张）：agent-turn-trace（sequence）——「修复登录超时」六轮四角色消息流（agent/场景全链路trace.md 第七节）。教训：sequence 的 message 必须有 y（≥160）、自消息不支持 span=0 要改 note、participant sublabel ≤ 8 字符级防 layout/constraint
- 批次 28（1 张）：lcc-map 双泳道（lcc 课程/本仓生产对照）——learn-claude-code 六组 17 节动线 + 三节的生产级深挖锚点（agent/learn-claude-code导读.md 第二节）
- 批次 29（4 张）：agent-security-layers 双泳道（攻击链五环 × 防御五层跨泳道拦截，agent/agent安全与防护.md 第三节）；scaling-paradigms 双泳道（范式轴 × 工程含义，训练与对齐/scaling-law与范式迁移.md 第二节）；data-pipeline 双泳道（六步流水线 × 做法与 why，训练与对齐/数据工程专题.md 第四节）；why-chains 五泳道 × 3 列（五条因果链 现象→机制→工程解，interview-questions/知识串联与why链.md 第〇节后）。教训：① 5 泳道高图会触发 composition/viewport-height——画布 w/h 比须 ≥1.55 才进宽屏契约（<1.55 时页面必溢出），把每列最大节点加宽到 viewBox ≈1210（上限 1240）即可，本图迭代 4 轮才命中，下次 5 泳道直接按 265-280 单列宽度起做；② `queue` 等 lifecycle 专有 node type 在 workflow schema 直接报 enum error，workflow 可用类型见 finalize 报错白名单（frontend/backend/database/cloud/security/messagebus/external 等）。

- 批次 30（2 张）：rl-four-pitfalls 四泳道×3 列（RL 训练四个坑 现象→机制→对策与监控，训练与对齐/rl训练工程实战.md 第一节后）；infra-interview-map 三泳道×3 列（项目追问/技术栈纵向/工程手撕三主线，inference/推理infra社招面经与备战.md 3.4 后）。教训：4 泳道当列宽>265 时 viewBox 限~1240 需每列最大节点 ≤290 且 sublabel 要压字数，首批过宽（1313→两轮压缩才过门）；用 python 批量改 width 比逐次 Edit 快。

- 批次 31（1 张）：projects-landscape 三泳道×3 列（推理 infra/Agent/算法三方向的项目组合：主项目→工程副件→信号件，projects/README.md 第四节）。教训：3 泳道宽字图（label 超 18 字符）viewBox 易踩 1240 边缘（本次 1243 首轮被毙，三列各砍 7-12px 后过门）。

- 批次 32（1 张）：resume-jd-map 三泳道×3 列（JD 关键词 → 简历承接模块 → 面试追问落点，三方向 resume/README.md 篇首）。首轮过门无迭代：参照批次 31 经验直接把单列宽压到 265-270。

- 批次 33（1 张）：backend-core-map 双泳道×4 列（Redis/MySQL/MQ/网络/K8s+护栏 经典三句 → Agent 场景联动，interview-questions/工程基础八股专题.md 第一节后）。教训：① 4 列图推荐单列宽 ≤250 起做，285 起步会两轮压缩（1266→1243→1235）；② mainPath 只能填实际边链上的连续子序列（首轮 mainPath 写了无边的假主链，报 layout/constraint）。

- 批次 34（1 张）：softskills-map 双泳道×4 列（自我介绍/离职·gap/反问/谈薪 面试官测什么 → 你的动作，interview-questions/沟通与hr面专题.md 第二节前）。

- 批次 35（3 张，训练栈三专题）：megatron-core-map 三泳道×3 列（架构三层 / 并行源码地图 tp-cp-ep-dp-pp / 精度与容灾，distributed-training/megatron源码深度拆解.md，4 轮迭代 1294→1238）；verl-arch 三泳道（控制面 / 训练侧 / 推理侧，回流边仅留一条 checkpoint_engine→RolloutReplica，训练与对齐/verl深度拆解.md，3 轮 1419→1237）；mimo-stack 双泳道×4 列（训练栈流水线 25T→6M→130K / 配套数据与 infra，训练与对齐/mimo训练栈复盘.md，4 轮 1563→1235）。教训：① 3 泳道×3 列单列宽 250 起步，长路径 sublabel（含模块全路径）极易撑破 1240，先把最长 sublabel 压短再调宽度；② 双泳道×4 列首做务必 sublabel ≤14 字级、列宽 ≤245，否则首轮 1500+；③ 控制/训/推三泳道图的去程与回流走廊必须分离，回流只留一条总边可一轮免 corridor 冲突。

- 批次 36（1 张）：comm-network-map 三泳道×3 列（硬件带宽分层 PCIe/NVLink/NIC × rail 与双平面拓扑 × Ring/Tree/分层集合通信，distributed-training/通信与网络专题.md，4 轮 1258→1223）。教训：① 首轮超限时别逐列 −5px 试，直接全列一次性 −10~15px 收敛更快；② 同列垂直跨泳道边（上层列↔下层同列）天然避开 corridor 冲突，布局上可以把"分层支撑关系"摆成同列。另：本站 md 写作铁律已沉淀根 README——粗体以 `%` `)` `/` 结尾且闭合 `**` 后随 CJK 标点会被 docsify@4 marked 漏渲染，写完正文必须 grep 自查。

- 批次 37（1 张）：domestic-gpu-map 三泳道×3 列（昇腾主线 910 系→CM384→路线图 × 软件与引擎 CANN/MindSpeed/vllm-ascend × 对手盘 MUSA/寒武纪/壁仞与 Pangu dense50-MoE30 收口，interview-questions/国产卡生态专题.md，2 轮 1254→1229）。新坑①：粗体若以半角直线引号 `**"..."**` 包住整句，marked 不解析（全角引号「」“”开头反而没事）——解法是把直线引号挪出粗体 `"**...**"`（2026-10 第二批全仓 23 处统一修过）；单边引号只在 span 仅 1 个引号时才可移动，粗体内本身有成对引号的（`**均衡只做"分流的调度"…"权重的梯度"**`）绝不能动。新坑②：全角引号「"」开头跨行的粗体同样不被解析（grep 查不出来，须 dump-dom 查渲染后 DOM 里的字面 `**`）；涉及"传言/宣称"的中立引语尽量别整句进粗体。

- 批次 38（1 张）：multimodal-serving-map 三泳道×3 列（token 化成本面 Qwen 连续/InternVL 阶跃/LLaVA-OV 配额 × 四级省钱缓存 传输UUID→预处理+embedding→prefix hash × EPD 分离决策 聚合/colocated/异构，inference/多模态推理专题.md，3 轮 1258→1216）。教训：跨两泳道的跨列边（a2→c2 型）必经中间泳道节点，绕行 2 折弯必触发 detour advisory——跨两泳道的"决策引申"边不如直接删，三泳道各留一条链内边 + 一条相邻泳道竖边最干净。

- 批次 39（1 张）：eval-benchmark-map 三泳道×3 列（口径层 pass@k/pass^k/judge × 工具层 静态集→滚动集→agent 集 × 工程层 沙箱→判分→可复现五件套，interview-questions/评测题专项.md，2 轮 1268→1235）。教训：`「` 全角引号开头的粗体 marked 同样不解析（与批次 37 的半角直线引号同类，比 grep 更难查），涉及引语的整句别进粗体；跨泳道竖边保持同列相邻泳道可零 advisory。

- 批次 40（1 张）：domestic-gpu-supplement-map 三泳道×3 列（海光 DCU 线 × 寒武纪线 × 四小龙，interview-questions/国产卡后补篇.md，4 轮 1293→1233）。
- 批次 41（1 张）：inference-engine-2026-map 三泳道×3 列（vLLM/SGLang/Dynamo 三演进线 × 架构演进/KV 体系/RL 与弹性，inference/推理引擎2026新进展.md，1 轮 1230）。
- 批次 42（1 张）：sparse-attention-map 三泳道×3 列（省存 MLA / 省算 NSA·MoBA·DSA / 不算 linear·hybrid，inference/稀疏注意力专题.md，1 轮 1218，1 条非阻塞 detour advisory 目检可读后接受）。

- 批次 43（1 张）：cuda-kernel-map 三泳道×3 列（attention kernel 主线 FA1→FA4 数字接力 / decode·服务 kernel 线 split-KV→FlashMLA→FlashInfer / 融合与 Triton 选型，interview-questions/cuda与kernel专题.md，2 轮 1269→1228）。
- 批次 44（1 张）：inference-scheduling-map 三泳道×3 列（三代范式 FT→ORCA 36.9×→Sarathi / vLLM 调度结构 FCFS·budget·抢占 / 旋钮与 SLO，inference/推理调度专题.md，3 轮 1280→1230）。
- 批次 45（1 张）：inference-hardware-map 三泳道×3 列（Groq/LPX 线 / Cerebras 线 / SambaNova+其他，interview-questions/推理专用硬件专题.md，2 轮 1270→1240）。
- 批次 46（1 张）：na-infra-jd-map 三泳道×3 列（三家在招实情与薪资带 / 关键词交集差集与 RL infra 溢价 / 流程对策与路径，resources/jd分析-北美infra岗.md，4 轮 1327→1236；1 条非阻塞 detour 目检可读后接受）。

- 批次 47（1 张）：trtllm-map 三泳道×3 列（重构时间线 v0.17/v1.0.0/v1.3.0rc20 × 重构后架构 LLM API→PyExecutor→C++ 热路径 × 生态位 Blackwell+FP4/Disagg+Dynamo/选型，inference/tensorrt-llm专题.md，3 轮 1298→1223）。
- 批次 48（1 张）：lora-serving-map 三泳道×3 列（kernel 层 merge/Gather-BMM→SGMV / S-LoRA 四件套 / 生产引擎落地与 prefix cache 坑，inference/多lora-serving专题.md，2 轮 1269→1239）。
- 批次 49（1 张）：agent-observability-map 三泳道×3 列（技术栈收敛 SDK→semconv→LLM 后端 / Langfuse 三层模型 / 线上 eval 闭环，agent/观测与trace工程.md，3 轮 1253→1233）。
- 批次 50（1 张）：recsys-llm-map 三泳道×3 列（经典级联打底 / 三段跳 TIGER→HSTU→OneRec / 三种接法×infra 共振，interview-questions/搜广推与llm融合专题.md，3 轮 1290→1236）。新 bold 坑（已并入根 README 铁律区）：全角标点（如 `：`）紧贴 `**+数字` 开头的粗体时 marked 首个 delimiter run 不解析且配对整体错位，同句后续粗体全部遭殃；安全形态=粗体以 CJK 开头、以全角标点结尾（如 `。**总观看时长 +1.68%（来源）**`）。

- 批次 51（1 张）：diffusion-video-map 三泳道×3 列（DiT 谱系 / 采样加速四代 / serving 解法栈 USP·offload，interview-questions/多模态生成与diffusion专题.md，4 轮 1258→1224）。
- 批次 52（1 张）：embedding-vector-map 三泳道×3 列（模型格局换血 / 索引算法四维 / Serving 与十亿级工程，rag/embedding与向量索引工程.md，2 轮 1257→1225）。
- 批次 53（1 张）：guardrail-map 三泳道×3 列（Llama Guard 谱系 / 管线五 rail 与延迟优化 / 红队与合规收口，agent/guardrail系统专题.md，4 轮 1306→1236）。
- 批次 54（1 张）：rl-env-map 三泳道×3 列（Gym→Agentic 谱系与规模接力 / Verifier 咽喉 / Sandbox 与三池解耦调度，训练与对齐/rl环境工程专题.md，3 轮 1320→1236）。

- 批次 55（1 张）：voice-agent 三泳道×3 列（用户侧/传输层 × 调度与流控 × 模型栈，感知 ASR/VAD→决策 LLM→合成 TTS + E2E 旁路与延迟预算卡，interview-questions/语音与voice-agent专题.md，2 轮 1279→1239，零 advisory）。
- 批次 56（1 张）：embodied-vla 三泳道×3 列（云大脑 S2 / 端小脑 S1 / 本体执行环 × 观测采集→理解规划→动作执行，action chunk 摊销卡与机器人版 PD 分离卡，interview-questions/具身智能与vla专题.md，3 轮 1305→1235 内；2 条非阻塞 detour 目检可读后接受）。
- 批次 57（1 张）：rl-platform 三泳道×3 列（Rollout 池 / Env·Verifier 池 / Trainer 池，样本总线 + 权重同步控制器回程仅一条 return 总边，staleness 版本戳/容错 SLO/三池配额三卡，system-design/设计rl训练平台.md，3 轮 1324→1237，零 advisory）。教训：3 泳道×3 列含 3 卡片且同列跨泳道三竖边挤占走廊时，单列宽要压到 220/230（即全列一次再 −35）才进 1240。
- 批次 58（1 张）：gen-media-platform 三泳道×3 列（接入与审核层 / 队列与多档调度层 / GPU 并行执行层，分池铁律卡：秒级 vs 分钟级，system-design/设计多模态生成平台.md，2 轮 1247→1237；1 条非阻塞 detour 目检可读后接受）。教训：iframe 的 height 要在 930px 嵌入宽度下实测产物实际高度再定，勿按 viewBox 直接套（本篇产物实际高约 800，height 从 630 调到 900 才不裁底卡）。
- 批次 59（1 张）：profiling 三泳道×3 列（在线无损观测 / 时间线定位 / 单点深潜与修复验证 × 定段→抓 trace→归因下钻，开销阶梯/带宽锚/顺序金句三卡，interview-questions/profiling与性能分析专题.md，3 轮 1302→1232；1 条非阻塞 detour 接受）。

- 批次 60（1 张）：data-engineering 三泳道×3 列（数据源与抽取 / 清洗与去重 / 配比与课程 × 预训练胚子→SFT 与偏好→RL 与合成，分类器驱动重采样与成本锚卡，interview-questions/数据工程专题.md，2 轮 1267→1237，零 advisory）。
- 批次 61（1 张）：distill-prune 三泳道×3 列（蒸馏信号谱系 / 剪枝三代 / 压缩组合生产线，72.6 vs 44.0 与 17920 vs 1800 GPU·h 两张数字锚卡，interview-questions/蒸馏与剪枝专题.md，4 轮 1340→≤1240 单列收敛到 210px，零 advisory）。
- 批次 62（1 张）：llmops-release 三泳道×3 列（Registry 与版本层 / 发布策略层 / 监控与回滚层 × 注册→灰度→全量，双平面与四维元组卡，interview-questions/llmops与模型发布专题.md，2 轮 1257→≤1240 全列 230→220，零 advisory）。
- 批次 63（1 张）：agent-security 三泳道×3 列（攻击面：注入→越权→外泄 / 防线谱系 L0→L4 / 隔离与合规收口，致命三角与 AgentDojo 卡，agent/agent安全与防护.md 扩写 171→470 行，2 轮；1 条非阻塞 detour 目检可读后接受）。新坑：card 的 dot 颜色字段是枚举，`red` 不可用要用 `rose`，validate 第一轮就会拦。

- 批次 64（1 张）：gpu-cluster-sched 三泳道×3 列（配额与准入层 Kueue/Volcano / 放置层 / 节点与容错层 × 作业到达→准入与 gang→上机运行与自愈，18 倍带宽差与 Arnold +10.6% 卡，interview-questions/集群调度与资源管理专题.md，1 轮零 advisory 直过）。
- 批次 65（1 张）：compiler-stack 三泳道×3 列（捕捉层 Dynamo/AOTAutograd / 优化层 Inductor+自定义 pass / 生成执行层 Triton·CUDA Graph·手件 kernel，编译赢什么/手件守什么边界卡，interview-questions/ai编译器与torch-compile专题.md，2 轮 1276→≤1240；2 条同列竖边非阻塞 detour 接受）。
- 批次 66（1 张）：edge-inference 三泳道×3 列（硬件面 TOPS/带宽 / 模型与引擎层 / 端云协同形态 × prefill 吃算力→decode 吃带宽→路由与协同，tok/s≈带宽÷字节数公式卡与 GGUF 档位卡，interview-questions/端侧推理专题.md，1 轮；1 条非阻塞 detour 接受）。
- 批次 67（1 张）：finops-cost 三泳道×3 列（成本公式层 / 降本组合拳层 / 组织与采购层 × 单价→吞吐×利用率→单位 token 成本，70B 推导账与乘法叠加卡，interview-questions/finops与算力成本专题.md，3 轮 1282→≤1240；1 条非阻塞 detour 接受）。教训：docsify 宽列下标注卡 2+1 换行，iframe height 要按卡片换行后的实际高度定（本篇 800 内容高但三卡换行后要 1040），不能只看节点区实测高。
- 批次 68（1 张）：thinking-train 三泳道×3 列（冷启动与数据层 / RLVR 主阶段 / 长度控制与 test-time 接口 × 冷启动 SFT→推理 RL→再 SFT→通用 RL，R1 四段式与长度控制三路线卡，interview-questions/训练与对齐/推理模型训练专题.md，2 轮；1 条非阻塞 detour 接受，iframe height=920）。
- 批次 69（1 张）：agentic-rl 三泳道×3 列（多轮 POMDP 与步级归因 / 工业配方层 / 训练系统层 × GRPO 三缺口→GiGPO 两锚→四工业配方，TITO 双侧 IS 与 coding agent 谱系卡，interview-questions/训练与对齐/agentic-rl专题.md，2 轮，iframe height=980）。
- 批次 70（1 张）：agentic-serving 三泳道×3 列（前缀与缓存层 / 路由与调度层 / 结构约束与采样层 × 会话生命周期→单步执行→分支与回退，195K vs 317 token 实测卡与 sticky-until-saturated τ 标定卡，interview-questions/inference/agentic-serving专题.md，3 轮 1283→1245→过门，零 advisory，iframe height=720 实测 930px 下内容底 668）。
- 批次 71（1 张）：gui-agent 三泳道×3 列（感知与 grounding / 控制回路与动作空间 / 环境·评测·安全 × 截图进→推理出动作→环境执行与校验，OSWorld-Verified 阶梯卡与步数预算卡，interview-questions/agent/gui-agent与computer-use专题.md，7 轮：role 枚举修复（exit→branch）、2 次 ambiguous-corridor 修复（改同列相邻竖边+删挤走廊引申边）、readability 250→212 收敛；2 条非阻塞 detour 接受，iframe height=840 实测 930px 下内容高约 800）。
- 批次 72（1 张）：thinking-serving 三泳道×3 列（指标与计费 / 调度与预算 / 并行采样与 CoT 处理 × 请求进→thinking 相→answer 相，TTFT→TTFAT 卡与 budget 三档卡，interview-questions/inference/thinking-serving专题.md，2 轮 1248→1228 全列 240→232 收敛，零 advisory，iframe height=800 实测 930px 下内容底 748）。
- 批次 73（1 张）：agent-memory-layer 三泳道×3 列（写入管线 / 存储与组织 / 读取管线 × 会话内→跨会话持久→合规与删除权，五路线 star 水位卡与记忆注入×前缀缓存卡，interview-questions/agent/agent记忆产品化专题.md，2 轮 1268→≤1240 全列 250→238 收敛，零 advisory，iframe height=860 实测 930px 下内容底 826）。
- 批次 74（1 张）：graphrag-flow 三泳道×3 列（索引构建 / 查询态 / 轻量与按需 × 语料进→图与摘要→查询与召回，0.1% 索引成本卡与 star 反超卡，interview-questions/rag/graphrag专题.md，1 轮一次过门；1 条非阻塞 detour 接受，iframe height=770 实测 930px 下内容底 723）。
- 批次 75（1 张）：realtime-omni 三泳道×3 列（codec 层 / 模型层 / serving 层 × 音频进→推理→音频出，160ms 结构账卡与 12.5Hz/1.1kbps 甜点卡，interview-questions/inference/实时多模态模型专题.md，1 轮一次过门；2 条非阻塞 detour 接受，iframe height=730 实测 930px 下内容底 705）。
- 批次 76（1 张）：rl-loss-stability 三泳道×3 列（先行指标与监控 / 数值精度机制 / 恢复 runbook × 正常训练→前兆→崩溃与恢复，Llama3 中断账卡与 QK-Clip 卡，interview-questions/训练与对齐/loss稳定性与数值精度专题.md，2 轮 1265→全列 −10px 收敛；1 条非阻塞 detour 接受，iframe height=700 实测 930px 下内容底 665）。
- 批次 77（1 张）：train-frameworks-2026 三泳道×3 列（训练框架主线 / RL 框架主线 / 横切议题 × 训练→权重同步→rollout，star 易主卡与 delta_sharded 卡，interview-questions/distributed-training/训练框架2026新进展.md，1 轮一次过门零 advisory，iframe height=840 实测 930px 下内容底约 780）。
- 批次 78（1 张）：coding-agent-compare 三泳道×3 列（上下文续命三路线 / 写权限三种收口 / 协议与生态 × 读/检索→写/编辑原语→安全边界，Verified 换代卡与 star 倒挂卡，interview-questions/agent/coding-agent横评专题.md，1 轮一次过门；1 条非阻塞 detour 接受，iframe height=830 实测 930px 下内容底约 795）。
- 批次 79（1 张）：agentic-bench 三泳道×3 列（SWE 谱系与选榜 / 终端与对话型 / 治理与防腐 × 题出→断分→榜单维护，Verified 轨迹卡与选榜差 26pt 卡，interview-questions/agent/agentic评测基准专题.md，2 轮：review-1 因 workflow 不支持 branch 节点类型被拦，改 cloud/backend 后过；零 advisory，iframe height=890 实测 930px 下内容底约 852）。教训：candidate 节点 role 枚举里没有 branch，要用 cloud/backend 等合法枚举，validate 第一轮就会拦。

- 批次 80（1 张）：post-training-distill-pipeline 三泳道×3 列（强模型线造数据 / 学生线装配 / 成本与三坑 × 原料→拒绝采样→蒸馏收尾，5K vs 101K GPU·h 卡与 Qwen3 双阶段对照卡，interview-questions/训练与对齐/post-training蒸馏生产线专题.md，2 轮 1260→全列 220→205 收敛；iframe height=945 实测 930px 下内容底 887）。
- 批次 81（1 张）：dr-paradigms 三泳道×3 列（范式 A 工作流 / 范式 B 端到端 RL / 横切底座 × query→检索阅读循环→综合报告，Kimi 23 步 200+URL 卡与三件套卡，interview-questions/agent/deep-research架构专题.md，1 轮一次过门零 advisory，iframe height=880 实测 930px 下内容底约 830）。
- 批次 82（1 张）：kv-offload-tiered-storage 四泳道×3 列（HBM/DRAM/SSD/远端池四层 × 命中查找→异步换入→回写驱逐，92.2% 命中率卡与九坑卡，interview-questions/inference/kv-offload与分层存储专题.md，2 轮 1263→全列 250→240 收敛；3 条非阻塞 detour 目检可读后接受，iframe height=940 实测内容底约 890）。
- 批次 83（1 张）：domestic-inference-stack 三泳道×3 列（插件机制 / CUDA 参照栈 / ROCm 与昇腾栈 × 主仓调度→插件换位→硬件执行，RFC#11162 卡与适配仓热度天梯卡，interview-questions/国产推理芯片栈专题.md，3 轮 1297→1262→≤1240 全列 250→224；1 条非阻塞 detour 接受，iframe height=800 实测 930px 下内容底约 750）。

- 批次 84（1 张）：speculative-decoding-2026 三泳道×3 列（draft 谱系演进 / 验证与无损保障 / 大 batch 衰减与自适应验证 × draft→verify→截断，EAGLE-3 双口径卡与 MTP 85-90% 卡，interview-questions/inference/投机解码2026专题.md，3 轮 1351→1263→≤1240 全列收敛 215px，零 advisory，iframe height=790 实测 930px 下内容底 744）。
- 批次 85（1 张）：memory-training-compression 三泳道×3 列（外挂式一代 / 激活态 latent 二代 / 训练原生三代 × 摘要→记忆槽→RL 行为，MEM1 3.5× 卡与厂商暗盒卡，interview-questions/agent/上下文压缩与记忆训练专题.md，4 轮 1270→1228 收敛+dot 枚举 sky→cyan，零 advisory，iframe height=850 实测 930px 下内容底 804）。
- 批次 86（1 张）：rl-training-inference-convergence 三泳道×3 列（rollout 服务器池 / trainer 与 staleness 闸 / weight sync 回灌 × prompt→轨迹→更新回灌，20s@1T 卡与 delta 1.9-3.1× 卡，interview-questions/distributed-training/rl系统训推一体专题.md，review-1 一次全过零 advisory，iframe height=855 实测 930px 下内容底约 802）。
- 批次 87（1 张）：long-video-inference 三泳道×3 列（一小时 token 账本 / 压缩谱系 × 视频推理数据流，70/258 token 每帧卡与 pruning 禁 CUDA graph 卡，interview-questions/inference/长视频推理工程专题.md，一次全过零 advisory，iframe height=750 实测 930px 下内容底约 700）。

- 批次 88（1 张）：model-merging 三泳道×3 列（base θ₀ 同源微调 / τ=θᵢ−θ₀ 算术 / EVAL 回环 × 成本锚与干扰修复数字卡，mergekit 7392★ 卡，interview-questions/训练与对齐/模型合并专题.md，2 轮 1261→全列 −10px 收敛；1 条非阻塞 detour 接受，iframe height=870 实测 930px 下内容底约 820）。
- 批次 89（1 张）：agent-sandbox-engineering 三泳道×3 列（共享内核级谱系 / VM 级与云托管 / 数字锚 × 子进程→容器→gVisor→microVM→云托管，Firecracker 三数字卡与沙箱外攻击面卡，interview-questions/agent/agent沙箱工程专题.md，4 轮 1282→1244 −5px 收敛；2 条非阻塞 detour 接受，iframe height=800 实测 930px 下内容底约 750）。
- 批次 90（1 张）：attention-variants-2026 三泳道×3 列（省存线 / 省算线 / 线性 hybrid 线 × 2017→2026 谱系演进，GQA/MLA 字节账卡与 Kimi Linear 75%/6× 卡，interview-questions/inference/注意力变体2026专题.md，3 轮列宽 250→234 收敛，零 advisory，iframe height=860 实测 930px 下内容底约 810）。
- 批次 91（1 张）：continual-learning-ttt 三泳道×3 列（续预训线 / 遗忘处置顺位 / TTT 与自我改进闭环 × 基座→续训→回流，ChipNeMo 1.5% 卡与 MIT TTT 53→61.9 卡，interview-questions/训练与对齐/持续学习与ttt专题.md，iframe height 以文内实际值为准）。
- 批次 93（1 张）：multimodal-tokenizer-lineage 四泳道×3 列（文本 tokenizer 谱系 / 视觉离散 VQ 派 / 视觉连续特征派 / 数据规模阶梯 LAION-5B→MINT-1T，词表尺寸小卡+TiTok 32 token 410× 数字锚卡，interview-questions/llm基础/多模态数据与tokenizer专题.md，3 轮 1258→全列 240→232 收敛，零 advisory，iframe height=940 实测 930px 下内容底约 920）。
- 批次 92（1 张）：inference-gpu-topology 三泳道×3 列（GPU 规格梯队 H100/H200→GB200/Rubin / 三步选型决策链 / NVLink domain 与 IB-RoCE 对 PD 分离大 EP，$0.20/1M output 官方口径数字卡，interview-questions/推理gpu选型与集群拓扑专题.md，四门全过零 advisory，iframe height=860 实测 930px 下内容底约 805）。
- 批次 94（1 张）：agent-eval-loop 三泳道×3 列（线上观测 / 闭环 pipeline / 离线评测力量，两条 return 边成环，pass^k 42% 与 judge 四偏差双卡，interview-questions/agent/agent评测与观测闭环专题.md，5 轮 1422→列宽 178 收敛，iframe height=880 实测 930px 下内容底约 830）。
- 批次 95（1 张）：fc-training-lineage 三泳道×3 列（格式四派 / 训练里程碑 Gorilla→APIGen/xLAM→ToolACE/Qwen3 / BFCL 评测维度 V1→V4，88.24% 数字锚卡+合成数据五步卡+BFCL 口径纪律卡，interview-questions/agent/function-calling训练专题.md，3 轮 1272→1242→列宽 226 收敛，零 advisory，iframe height=880 实测 930px 下内容底约 830）。
- 批次 97（1 张）：inference-capacity-loop 三泳道×3 列（负载建模层 / 压测与定容层 / 上线与回灌层 × 画像进 → knee 定容 → 监控回灌，三条 return 边成环，headroom 1.5-2x 卡与 knee 三信号卡，interview-questions/inference/推理压测与容量规划专题.md，3 轮：dot 枚举 sky→cyan、readability 240→232 收敛，零 advisory，iframe height=800 实测 930px 下内容底约 740）。

- 批次 96（1 张）：rl-reward-design 三泳道×3 列（奖励三派 ORM/PRM/规则 × hacking 攻防 × RM 校准与防 Goodhart，PRM800K 证据链卡+Goodhart 拐点卡+monitorability tax 卡，interview-questions/训练与对齐/rl奖励设计专题.md，1 轮一次过门零 advisory，iframe height=990 实测 930px 下内容底 936）。
- 批次 98（1 张）：agent-memory-eval-gc 三泳道×3 列（评测基准层 LoCoMo→LongMemEval→MemBench·RULER / 治理工具层 merge gate→双时态 invalidate→漂移监控×三层 GC / 产品决策层 ChatGPT→Mem0·Letta→Zep 反面，0.5773 vs 0.9184 数字锚卡+在线四红灯卡+五板斧主线卡，interview-questions/agent/agent记忆评测与遗忘治理专题.md，3 轮 1285→1245→列宽 205 且缩 b1 文本收敛，零 advisory，iframe height=960 实测 930px 下卡片底约 900）。
- 批次 99（1 张）：npu-engine-adaptation 三泳道×3 列（引擎三分支 vLLM-Ascend/SGLang-NPU/MindIE / 算子移植三条路径 Ascend C、Triton-on-NPU、生态缓冲 / 坑排行，DeepSeek-on-NPU 性能口径双卡，interview-questions/国产卡推理引擎适配专题.md，3 轮 1251→列宽 216 收敛，零 advisory，iframe height=860 实测 930px 下内容底约 790）。

- 批次 101（1 张）：multitenant-serving 三泳道×3 列（隔离机制 准入/排队/状态层 × 公平调度 RPM-VTC-max-min × 成本归因与 tier 计量→计价→混部，VTC 2× 上界 340 vs 779 卡与 tier 价锚卡，interview-questions/inference/推理多租户与成本归因专题.md，1 轮一次过门零 advisory，iframe height=880 实测 930px 下卡片底约 800）。
- 批次 102（1 张）：agent-protocol-stack 三泳道×3 列分层栈（上接用户 AG-UI / 平接 agent A2A / 下接工具 MCP，Client Agent→Remote Agent 同列竖边承接委派，A2A 时间线四节点卡+采用与安全批评卡，interview-questions/agent/agent通信协议专题.md，3 轮 1272→1242→全列 200px 收敛；1 条非阻塞 detour 目检可读后接受，iframe height=830）。

- 批次 100（1 张）：longctx-training 三泳道×3 列（PE 外插谱系 PI→YaRN→LongRoPE2 / 长文数据工程 源与清洗→长度课程→长短混合 / 系统与评测 CP 三兄弟→packing 与显存折算→有效窗口，同列相邻泳道两条竖边 pe2→d2→s2，PE 谱系数字锚卡+USP 47% MFU 通信账卡+有效窗口评测卡，interview-questions/训练与对齐/长上下文训练工程专题.md，1 轮一次过门零 advisory，iframe height=940 实测 930px 下内容底约 890）。
- 批次 103（1 张）：edge-agent-arch 三泳道×3 列（端上三层 模型/工具/权限 × 端云路由 隐私分级与延迟成本 × 场景谱系 手机/车/机器人，Apple 3B+PCC 适配器仓卡与小模型能力底线数字卡，interview-questions/agent/端侧agent专题.md，1 轮一次过门零 advisory，iframe height=1100 按 docsify 740px 内宽卡片 2+1 换行实测内容底约 1060）。

- 批次 107（1 张）：mm-embedding-retrieval 三泳道×3 列（双塔单向量派 CLIP→SigLIP2→E5-V/Qwen3-VL × 多向量 late interaction 派 ColBERT→ColPali→ColQwen2.5 × 工程落库 schema→分层漏斗→多模态 reranker，同列相邻泳道两条竖边 a1→b1→c1 承接，ViDoRE NDCG@5 阶梯卡+ColPali 三笔成本卡，interview-questions/rag/多模态embedding与检索专题.md 第一节后，5 轮 1584→≤1240：先缩 sublabel 全列 215、再缩泳道/边 label 到 1248、最后全列 208 收敛，零 advisory，iframe height=830 实测 930px 下内容底约 780）。教训：拉丁长泳道 label（late interaction 派）与长边 label 对 viewBox 的抬升比节点 sublabel 更大，首轮应从这两者起缩。

- 批次 106（1 张）：agent-orchestration-spectrum 三泳道×3 列（三范式光谱 DAG/状态机/自由loop × 工程兜底 人审/checkpoint/数值缰绳 × 选型决策 R0-R4，每列两条同列竖边成链，star 水位卡+收敛共识卡，interview-questions/agent/agent编排范式工程专题.md，1 轮一次过门；2 条非阻塞 detour（首列 s0→g0、g0→p0 左侧绕行 3 弯）目检可读后接受，iframe height=840 实测 930px 下内容底约 735）。

- 批次 105（1 张）：kv-quant-evict 三泳道×3 列（量化位宽派 KVQuant→KIVI→SKVQ / 驱散裁剪派 StreamingLLM→H2O·SnapKV·PyramidKV→Razor·DuoAttention / 引擎落地 vLLM→SGLang 静默坑→FlashMLA 原生 FP8·FP4，同列竖边 e0→q0 与 e2→g2，单卡百万上下文三级跳卡+并发换算账卡+四坑位卡，interview-questions/inference/kv量化与压缩专题.md 第一节后）。教训：3 轮收敛 1261→≤1240，先缩 sublabel 无效（viewBox 由布局走廊撑开），全列 230→222→216 才过门；q1 sublabel 下悬挂「sublabel 换行」形式未触发，iframe height=890 实测 960px 下内容底约 845）。

- 批次 104（1 张）：dllm-lineage 三泳道×3 列（谱系时间线 D3PM→LLaDA/Dream→MoE/SDAR × 平行解码机制 全掩码→N 步并行→KV cache 失效 × 评测对标 追平档/规划赢/速度标本，数字锚卡+AO-ARM 等价差异卡+面试口径卡，interview-questions/llm基础/扩散语言模型专题.md，1 轮一次过门零 advisory，iframe height=940 实测 960px 下内容底约 890）。

- 批次 111（1 张）：agent-cost-budget 三泳道×3 列（成本构成 官方数字锚 × 降本六步 杠杆排序 × 定价与折扣 2026-10，同列竖边 c0→r0、r2→p2，四象限账卡+杠杆排序卡+折扣适用性卡，interview-questions/agent/agent成本与token预算专题.md §一后，2 轮 1242→列宽 232→230 收敛；1 条非阻塞 detour（c0→r0 左侧绕行 3 弯）目检可读后接受，iframe height=900 实测 980px 下内容底约 828）。

- 批次 109（1 张）：mcp-server-engineering 三泳道×3 列（设计层 schema与描述 / 运行层 传输与错误 / 交付层 测试与发布，同列相邻泳道竖边 d1→r1→t1 承接，25,000 tokens 预算数字锚卡+spec 三条硬约束卡，interview-questions/agent/mcp-server开发工程专题.md 第〇节后，1 轮一次过门零 advisory，iframe height=840）。教训：粗体以反引号代码段开头且跨行（**`--read-only` …**型）marked 不解析——dump-dom 字面 `**` 终检抓出，把代码段挪出粗体开头即修复。

- 批次 110（1 张）：grounding-pipeline 三泳道×3 列（query 规划 意图识别×freshness 路由→改写 fan-out→自适应多轮 × 搜索与拼包 搜索 API 三层→拼包 token 预算→日期感知合成 × 引用归因 句级 schema→post-hoc 校验→兜底降级，同列相邻泳道竖边 a1→b1→c1 承接，计费锚点卡+审计评测数字卡，interview-questions/rag/搜索增强与grounding专题.md 第一节主线后，1 轮一次过门零 advisory，iframe height=860 实测 930px 下内容底约 790）。教训：粗体以 `**$数字` 开头且紧跟全角标点（回答）**$4/1k…型）是批次 50 铁律的 $ 变体，marked 不解析——dump-dom 字面 `**` 终检抓出，开头塞一个 CJK 字（「按」）即修复。

- 批次 108（1 张）：synth-data-lineage 三泳道×3 列（指令合成四代谱系 Self-Instruct→Evol→Magpie/Persona / 轨迹与 verifier 闭环 STaR·RFT→环境采轨迹→verifier 三形态 / 治理与坍缩防线 去污染双闸→GSM1K 实锤→坍缩四必备条件，同列相邻泳道竖边 i2→t2 与 t1→g1 承接，Magpie 4M→300K/Nemotron-4 >98%/GSM1K 降 13 点数字卡，interview-questions/训练与对齐/合成数据工程专题.md 第 2.8 节后，2 轮 1269→全列 235→222 收敛，零 advisory，iframe height=903 实测 930px 下内容底 853）。

合计张数以本目录实际 html 文件数为准，全仓库 mermaid 清零。
