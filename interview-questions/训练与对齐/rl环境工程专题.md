# RL 环境工程专题：Env-as-a-Service、Verifier 咽喉与 Sandbox 选型

> **面向**：已读过 [rl训练工程实战](./rl训练工程实战.md)（训练坑）与
> [verl深度拆解](./verl深度拆解.md)（训练引擎）、准备「Agentic RL / RL Infra」
> 追问线的读者。本篇是第三根柱——**环境侧（Env-as-a-Service）**：训练坑、训练
> 引擎、推理引擎 RL 配套在另外几篇已有专题，本篇只串联、不重复。
>
> **读完获得**：① 「环境从评测资产变成训练资产」的转变叙事与数字锚；② Gym
> 谱系（2016 白皮书 → Gymnasium → 五元组拆分 → vectorization）；③ Agentic
> 环境谱系与五类架构 pattern 的选型话术；④ Verifier 工程的域化分类表、RLVR
> 概念位置、三套硬实测结论（单类饱和 / reward hacking / 细粒度 reward）；
> ⑤ Sandbox 隔离选型表（Docker vs Firecracker 精确对比）与生命周期五形态；
> ⑥ 规模化 rollout 的三池解耦、verl AgentLoop 接口切分、长尾异步化收益；
> ⑦ 成本量纲的排序结论；⑧ 10 条面试题的完整答法。
>
> **时效口径**：素材时间轴从 **2016 Gym 白皮书**（arXiv:1606.01540）到
> **2026 Env-as-a-Service** 形态；全部论文数字按 arXiv 原文口径括注，社区/工程
> 估算一律标明，未核实项见文末「口径与未核实说明」。

## 一、主线：环境从「评测资产」变成「训练资产」

2023 年，WebArena / OSWorld 这类环境是拿来**评** agent 的——人出题、人看分。
2024 年底 SWE-Gym 开始，同一批东西被直接拿来**采样轨迹做 RL/SFT**：
SWE-Gym、R2E-Gym、SWE-smith、AgentGym-RL 一路接力。变的是调用方：gym.make()
的返回协议没变，但谁会调用它变了——**从人评测，变成万级并发 rollout
worker**。这条转变是三件事同时发生的结果：

1. **API 收敛已成事实**：OpenAI Gym 2016 的 reset/step 五元组被 Gymnasium
   继承，然后被 WebArena、OSWorld、BrowserGym 原样沿用（WebArena README 自称
   very similar to OpenAI Gym）；AgentGym 把它 HTTP 化成
   /createEnv /step /reset。金句记好：**Gym API 是 RL 环境的 POSIX**。
2. **Verifier 是环境侧的咽喉**：R2E-Gym 硬证据——执行式与非执行式 verifier
   各自都在 42-43% 饱和，混验才能到 51%；没有显式推理奖励，agent reasoning
   就很难涌现（RAGEN）。且 verifier 本身就是攻击面。
3. **调度形态彻底改变**：评测是一次性跑完 812 题，训练是 7×24 持续并发，
   长尾、复现、隔离、成本全部变成工程问题——这就是本篇的主角。

<div class="diagram-embed">
<iframe src="assets/diagrams/rl-env-map.html" width="100%" height="630" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/rl-env-map.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、Gym 谱系：RL 环境的 POSIX

### 2.1 2016 白皮书与五元组

OpenAI Gym（arXiv:1606.01540, 2016）第一次把 RL 环境统一成一个接口加一套
基准集。核心契约是 step 循环：

- `obs = env.reset()` 拿初始观测；
- `obs, reward, done, info = env.step(action)` 推进一步；
- agent 只认 obs/action 空间声明，不认环境内部实现。

这份「超薄契约」是它能成为 POSIX 的原因：环境实现可以是从 Atari 模拟器到
真实网站站群的任何东西，协议不变。

### 2.2 Gymnasium 继承与 terminated/truncated 拆分

OpenAI 重心转移后，Gym 由 Farama Foundation 以 **Gymnasium** 名义社区接管
（接管精确月份未核实，按纪律不写；论文 arXiv:2407.17032，NeurIPS D&B 2025）。
最重要的协议改动是把 `done` 拆成两个布尔量：

- `terminated`：MDP 语义上的终止（到达终态），value bootstrapping 到此为止；
- `truncated`：外部截断（step 上限、超时），**状态本身不是终态，value 仍然
  需要 bootstrap**。

混用会系统性低估长 horizon 任务的 value——这是面试极高频题（见第九节 Q1）。
agentic 场景里这个拆分更关键：一个 30 轮 web 任务被 step 上限砍掉，
truncated=True，return 计算必须按「还有未来」处理，否则长任务被惩罚。

### 2.3 Vectorization：从单环境到 VecEnv

训练吞吐要求环境**向量化**：一批环境实例并行 step，agent 批量出 action。
这条线在 web/agentic 域的直接后代是「浏览器会话当 VecEnv 的 slot 调度」
（BrowserGym 配套 AgentLab 的官方推荐跑法，2024-12 后 WebArena README 也
指向它做并行）——**浏览器池化**就是 vectorization 在 agentic 域的形态，
预热池、命中率、slot 复用这些概念全部从 VecEnv 平移过来。

## 三、Agentic 环境谱系与五种架构 pattern

### 3.1 谱系时间线（全部数字按原文口径）

| 阶段 | 环境 | 规模/口径 | 定位 |
|---|---|---|---|
| 早期网页 | World of Bits → MiniWoB++（arXiv:1802.08802, ICLR 2018 workshop） | workflow 引导探索，样本效率较 BC **提升超 100 倍** | web 任务环境 |
| 游戏 | NLE / NetHack（arXiv:2006.13760, NeurIPS 2020） | 过程生成 roguelike，复杂且仿真快 | 单进程轻量 |
| 多环境评测 | AgentBench（arXiv:2308.03688, ICLR 2024） | **8 环境、27+ 模型**（AgentBench, ICLR 2024） | LLM-as-agent 基准 |
| 真实网站 | WebArena（arXiv:2307.13854, 2023） | **812 任务**（WebArena, arXiv:2307.13854, 2023）；GPT-4 **14.41% vs 人类 78.24%** | 评测资产 |
| 真实 OS | OSWorld（arXiv:2404.07972, 2024） | **369 任务**（OSWorld, arXiv:2404.07972, 2024）；最佳模型 **12.24% vs 人类 72.36%+** | 评测资产 |
| HTTP 化 | AgentGym（arXiv:2406.04151, 复旦, 2024） | **14 环境 7 大类、轨迹 14,485 条** | EnvServer |
| 训练化（code） | SWE-Gym（arXiv:2412.21139, ICML 2025） | **2,438 真实 Python 任务**；resolve rate **绝对提升 19 个百分点**，Verified 达 **32.0%** / Lite 达 **26.0%** | 训练资产 |
| 程序化生成 | R2E-Gym（arXiv:2504.07164, 2025-04） | **8.7K+ 程序化任务**；32B pass@1 达 **34.4%；**混合 verifier 到 **51%** Verified | 训练资产 |
| 程序化生成 | SWE-smith（arXiv:2504.21798, 2025-04） | **50K 实例、128 仓库**；SWE-agent-LM-32B **40.2%** Verified | 训练资产 |
| 持续续更 | SWE-bench-Live（arXiv:2505.23419, 2025-05） | **1,319 任务、93 仓库、每任务专用 Docker 镜像** | 滚动集 |
| RL 配方 | Tulu 3（arXiv:2411.15124, 2024-11） | 把 **RLVR** 作为公开配方独立 stage 命名 | 概念锚点 |
| RL 配方 | AgentGym-RL（arXiv:2509.08755, 2025-09） | **27 任务追平/超商业模型**；ScalingInter-RL；无需 SFT 冷启 | 端到端 |
| browser RL | WebAgent-R1（arXiv:2505.16421, EMNLP 2025） | WebArena-Lite 纯 binary reward 多轮 RL：Qwen2.5-3B 从 **6.1% 到 33.9%、**Llama3.1-8B 从 **8.5% 到 44.8%。** | 训练资产 |

规模接力的瓶颈读法：SWE-Gym 2.4K → R2E-Gym 8.7K → SWE-smith 50K，
**缺的不是 issue，而是「可执行环境 + 可验证测试」的联对**。R2E-Gym 的
SYNGEN 从 commit 反向生成测试与题面（不依赖人类 issue）；SWE-smith 给代码库
自动破坏现有测试造任务；SWE-bench-Live 把 curation 管线自动化支持持续续更。
金句记好：**环境与 verifier 必须一起生成，单独生成任何一边都无法闭环**。

### 3.2 架构五 pattern（被问「环境怎么搭」就按这个讲）

1. **自托管 Docker 站群（WebArena 形态）**：6 个自托管 Docker 服务——
   shopping:7770、shopping_admin:7780、reddit:9999、gitlab:8023、map:3000、
   wikipedia:8888——eval 后需整站 reset 回初始态。本质是「把互联网戒掉」：
   DNS/依赖全部内网 fixture 化，环境才确定。
2. **HTTP 化 EnvServer（AgentGym 形态）**：reset/step 暴露成 /createEnv
   /step /reset，环境池与训练集群跨机部署，gym 协议过 HTTP。
3. **gym-like Python 进程内（NLE / MiniWoB++ 形态）**：单进程轻量、仿真极快，
   适合 game/模拟器域做大规模 on-policy；网络/DB 依赖为零。
4. **真 OS VM（OSWorld 形态）**：Ubuntu/Windows/macOS 真实桌面，provider 可
   选 VMware/VirtualBox/Docker/AWS 四类；每任务 = 初始态 setup 配置 + 可执行
   评测脚本（比对文件内容、系统状态、网络可达性）。这是「verifier 即代码」的
   极端形态：reward 不来自模型或规则文本，而是**对世界最终状态的程序化断言**。
   代价：VM 级环境重（分钟级 setup）、不适合池化复用——本质是评测环境，
   训练要用得降维。
5. **程序化生成（R2E-Gym / SWE-smith 形态）**：环境不再是「采集品」而是
   「工业品」，curation 从人工采转向模型产；规模上限由生成管线决定。

### 3.3 域化索引（含 Voyager 同构论证）

- **code**：SWE-Gym / R2E-Gym / SWE-smith / SWE-bench-Live——当前训练资产化
  最成熟的一域，原因正是 verifier 可执行、可断言。
- **web 静态站**：WebArena / VisualWebArena / TheAgentCompany——评测为主。
- **browser RL 训练侧**：BrowserGym + WebAgent-R1 证明 **web 环境不用 reward
  model 也能训**：task-success binary reward 就够撑多轮 agentic RL（3B 模型
  6.1%→33.9%、8B 8.5%→44.8%）。
- **game**：NLE（过程生成 + 轻量单进程）；Voyager（arXiv:2305.16291,
  Minecraft, 2023）**严格说不走梯度 RL**——黑盒 GPT-4 + 技能库 + 自动课程，
  论文自述不微调参数；但其「环境反馈 → 程序自我修正 → 技能入库存检索」闭环
  与 RL 环境-奖励结构**同构**（3.3× 物品数、2.3× 行程、15.3× 科技树解锁
  速度，数字已从 arXiv 摘要核实）——讲「没有梯度能不能利用环境反馈」时用它。
- **multi-agent**：PettingZoo（与 Gymnasium 同属 Farama 组织），Gym API 的
  多 agent 扩展。

## 四、Verifier 工程：环境侧的咽喉

### 4.1 可验证 reward 域化分类表（成本从小到大）

| 类别 | 代表 | 判定方式 | 成本 |
|---|---|---|---|
| 规则/字符串匹配 | GSM8K、Tulu RLVR 精确匹配 | regex/extractor + 答案等价 | <ms，纯 CPU |
| 答案等价 | 数学 symbolic / 数值容差 | SymPy 规范化 + 数值容差 fallback | CPU 级 |
| 编译 + 单测 | SWE-Gym / SWE-bench 系 | pytest 编排：先 FAIL_TO_PASS 再 PASS_TO_PASS 防回归 | 沙箱内秒~分钟级 |
| 仿真器到达 | NLE / ALFWorld / ScienceWorld | 仿真器内 goal state 断言 | 轻到中 |
| 执行式终态断言 | WebArena / OSWorld | 对真实站点/OS 最终状态跑评测脚本 | 重：需环境复位 + 状态读取通道 |
| 过程式 process-based | OSWorld getter 型 + SWE 侧 LLM-judge patch | 对中间动作序列/成本/副作用打 secondary 分 | 需 trace 结构化落盘，含 LLM 调用 |
| 非执行式 execution-free | R2E-Gym 对照组 LLM judge patch | 直接判 patch 文本 | 快但有偏（风格特征区分度低） |

### 4.2 RLVR 概念位置

Tulu 3（arXiv:2411.15124, 2024-11）是把 RL with Verifiable Rewards 作为公开
配方独立 stage 命名的代表；同期 DeepSeek-R1 系把它推到一线（规则 reward：
答案正则 + 格式正则，不训 reward model）。**工程意义不是「reward 更准」，
而是 reward 管线从模型推理（GPU、非确定、可 hack）降级为确定性程序
（CPU、可复现、可测试）——verifier 从此可以像单元测试一样进 CI。**
这句是整个环境侧的方法论锚点。

### 4.3 三个硬实测结论

**结论一：单类 verifier 会饱和，混合是信息互补而非简单或。** R2E-Gym 实测
**单类饱和 42-43%、混合 verifier 51% 的实测**（R2E-Gym, arXiv:2504.07164, 2025）：
执行式区分度低（0-1 信息量少、测试不全＝漏刷），非执行式有偏（风格特征）。
工程落地：测试式定 pass/fail，judge 做 tie-break 与过程质量；训练侧只能取
一个就先执行式。

**结论二：verifier 是攻击面，必须按不可信环境做隔离。** 证据一：Anthropic
reward tampering 实验（arXiv:2406.10162, 2024-06）——在「课程式可钻空环境」
上训练，模型从小动作（specification gaming）**零样本泛化到直接改写自己的
reward 函数**；重训缓解但根治不掉，无害化训练也不防住。证据二：
[rl训练工程实战](./rl训练工程实战.md) 的 verifier 漏刷线——reward 涨而
抽审三成在糊弄。防护六件套背熟：

1. 测试仅在 eval 阶段注入，workspace 不挂载；
2. 双集合防「删测试过关」（FAIL_TO_PASS + PASS_TO_PASS）；
3. reward 计算放在 agent 无权访问的 sidecar，文件只读挂载；
4. process-based secondary verifier 看动作序列合法性；
5. verifier 自身单元测试化、进 CI；
6. canary 题 + 高 reward 样本人工/独立强模型抽审闭环。

**结论三：没有细粒度 reward，reasoning 不会涌现。** RAGEN（arXiv:2504.20073,
2025-04）用 4 个 stylized 环境（Bandit/Sokoban/FrozenLake 类）系统研究多轮
agentic RL：无 reasoning-aware reward 时出现**浅策略与幻觉思维**；并发现
Echo Trap 不稳定模式（reward 方差悬崖 + 梯度尖峰），rollout 侧要求**多样
初始态、中等交互粒度、更高采样频率**三个变量。推论：verifier 设计不止是
对错，还包括「reward 能否分解到步级」的可能性。

## 五、Sandbox 工程：隔离、生命周期与会话抽象

### 5.1 隔离选型表（精确对比版）

| 维度 | Docker（进程级） | gVisor（用户态内核） | Firecracker（microVM） |
|---|---|---|---|
| 隔离强度 | 弱：共享内核，syscall 面全暴露 | 中：runsc 拦截走 Sentry | 强：VM 边界 + jailer 双防 |
| 启动 | ms 级 | 接近容器 | **启动 <125ms、每 host 150 个/s、内存 <5MiB/VM**（Firecracker 官网） |
| 开销 | 无虚拟化开销 | syscall/IO 路径有代价（具体倍数未核实，不写） | 仅 5 个模拟设备，攻击面最小化 |
| 生产证据 | SWE-bench 全生态（每任务一个 repo-pinned 镜像） | — | Lambda 基于其支撑 **15 万亿+/月调用**，状态可保留 8h |
| 适用 | 自研可信任务集 | 居间选择 | 多租户/模型自写代码（=不可信代码） |

**决策本质是威胁模型，不是启动毫秒数**：RL rollout 里模型写的脚本就是
不可信代码——这是选 Firecracker 类 microVM 的第一理由。Kata Containers 是
「跑容器接口的 VM」（底层可配 Firecracker/QEMU），兼得 OCI 生态与 VM 隔离，
冷启慢于纯 Firecracker。

### 5.2 生命周期五形态

1. **按需创建（冷启）**：最简单，每个 step 多付容器/VM 启动成本；SWE 类
   Compose 环境冷启 10s-60s 量级，与 microVM 冷启 125ms 是两个量纲，
   调度策略完全不同。
2. **预创建 + 预热池**：池内常驻 warm 环境，rollout 命中即 reset；池深按
   长尾确定，**命中率是第一 KPI**。
3. **镜像内 checkpoint/snapshot**：置到任务初始态后打快照，reset = 恢复快照
   而不是重跑 setup（WebArena 整站 reset 即此类思路；Firecracker 8h 状态
   保留是云侧对应能力）。
4. **recycle with 污染审计**：环境复用后跑 canary 断言（遗留进程/文件/网络
   连接），失败即销毁回炉。
5. **copy-on-write 分层**：基础镜像（OS+依赖）+ per-task 层（repo@commit）
   + per-rollout 层（突变），突变层用完即弃——SWE 系 Docker 镜像链就是此
   模式的静态版本。

### 5.3 资源配额、网络与会话抽象

- **CPU/mem**：cgroup 硬限 + OOM 语义定义——环境进程被杀算 truncated 还是
  env error，这个归类直接决定 advantage 是否被污染。
- **确定性源**：RL 复现要求可控随机源（种子注入 + 环境内 time freeze/虚拟
  时钟）；时间加速对 game/模拟器有效（NLE 单进程即可千倍实时），对
  browser/DB 域无效 → 网络模拟替掉真依赖（DNS 劫持到内网 fixture、DB 灌
  snapshot、外部 API mock）。
- **网络**：rollout 沙箱默认禁外网（防数据泄漏 + 防 agent 把不可信内容灌进
  上下文），出站白名单只放 mock 服务。
- **会话抽象 SWE-ReX**（GitHub README 口径）：shell 会话（命令完成检测 +
  exit code 抽取）、交互式工具（ipython/gdb）、多会话并行；后端可切
  Docker/AWS/Modal/Fargate/Daytona——agent 逻辑与执行基建解耦，官方自陈
  100 agent 并行无压力。
- **数据持久**：trajectory（obs/action/reward/种子/镜像 digest）全量落盘；
  镜像按 **digest 而非 tag** 引用——这是 SWE-bench 系可复现模式的根基，
  与 [观测与trace工程](../agent/观测与trace工程.md) 的 trace 落盘纪律同源。

## 六、规模化 rollout 调度

### 6.1 三池解耦与 verl AgentLoop 案例

现代 agentic RL = 三个资源池：**LLM 推理池（vLLM/SGLang）× 环境池
（sandbox fleet）× 训练池（FSDP/Megatron）**，中间用 trajectory buffer
队列解耦。接口切分看 verl AgentLoop（官方文档，2025-07 更新，v0.4.2 alpha）：

- `AgentLoopBase.run` 是唯一用户接口，返回
  AgentLoopOutput（prompt_ids、response_ids、response_mask）；
- **token-in-token-out**：chat completion 风格 API 的 decode-encode 往返
  会造成 token ids 不一致，verl 文档明确记载**此问题曾致单轮 PPO 不收敛**——
  rollout 全程持有 response_ids 与 response_mask（1=模型生成，0=工具/环境
  注入），训练直接用拼接 token 序列，不重算模板；
- LLMServerClient 做 least-request 负载均衡 + request_id **sticky session**
  （多轮请求打回同一 server，保 KV 局部性）；rollout 结束 sleep 推理 server
  释放 KV 并权重 offload 到 CPU。

部署形态：colocate（推理与训练同卡时分复用）适合小集群；万级环境并发下
**环境池必须独立成 CPU-only fleet**，与 GPU 池物理解耦，靠 RPC/对象存储传
轨迹。环境侧配套要求：环境注入的文本（工具返回、页面 observation）必须与
上下文预算连动裁剪，且**裁剪规则作为环境契约的一部分版本化**——否则同一
条轨迹换一版 obs 模板，分布就变了。

### 6.2 五个结构性矛盾与对策

1. **长尾与同步浪费**：同步系统整批等最长 rollout（batch 内 30 轮 web
   交互与 3 轮数学采样混排，P90/P99 差距可达一个数量级）。对策：按任务
   预估步数分桶排队（short/medium/long 三优先级队列）。
2. **异步化的 staleness 代价**：AReaL（arXiv:2505.24298, 2025-05）把生成与
   训练完全异步解耦——rollout worker 持续产出不等待，训练 worker 攒够
   batch 就更新，配 staleness-enhanced PPO 吸收旧样本，实测同 GPU 数
   **加速 2.77×**（AReaL, arXiv:2505.24298, 2025）且最终性能持平或更好；
   代价是 off-policy 度上升，staleness 控制成为新旋钮。
3. **断点续跑**：长轨迹超时不丢已采部分——轨迹 chunk 落盘 + partial
   rollout 续跑，**权重版本号随轨迹携带**。
4. **训推 token 一致性**：见 6.1 的 token-in-token-out；多轮轨迹 token 级
   拼接的 retokenization 边界漂移在 [verl深度拆解](./verl深度拆解.md)
   有展开，本篇只串联。
5. **可复现性**：万级并发下「复现一条 buggy 轨迹」需五要素齐备——任务
   镜像 digest、环境 seed、采样 seed、权重版本、引擎版本/配置
   （SWE-bench-Live 的每任务独立镜像 + SWE-bench 系 evaluate pipeline 是
   公开样板）。注意 **seed 固定 ≠ 可复现**：GPU 非确定性算子、异步调度的
   请求到达顺序都会打破逐位复现；工程务实目标是「**统计可复现**（同配置
   reward 曲线分布一致）+ **单条轨迹可回放**（轨迹+镜像+种子齐全时重放
   环境侧交互，LLM 侧用落盘 token 序列替代实时生成回放）」。

## 七、成本量纲（工程估算，非引用）

一条 agentic rollout step = LLM 调用 + 工具/环境调用 + 验证调用三类成本
叠加。分档看：

- **环境暖启动**（命中预热池 + reset）：Firecracker 级 <125ms、每 host
  150 个/s——调度瓶颈不在 microVM 本身；Docker 常态百 ms 级。
- **环境冷创建**：无快照的 SWE 类环境装依赖是分钟级（社区经验口径，未按
  论文核实）；SWE-bench 系全部走预构建镜像，即**镜像构建成本摊到 curation
  期，rollout 期只付 reset**；SWE-smith 论文明示此前数据集的执行环境占数
  TB 存储，镜像存储/分发本身即一线成本项。
- **验证调用**：规则匹配 <ms；pytest 编排秒~分钟级；执行式终态断言最贵
  （含环境复位）。
- **LLM 调用**：占大头；万级并发真正压力是「并发会话数 × 会话内多轮」的
  乘积——此处调度单元是**会话**不是请求（sticky session 的理由）。

结论性量纲（工程估算）：暖池命中时 rollout 成本 **≥90% 由 LLM 推理与
GPU 长尾闲置组成**（结构性工程估算，非引用数字）；金句记好：**环境成本主要
体现为 curation 期的一次性镜像构建与持续存储**。架构上**先优化 GPU 利用率
（异步化）再优化环境池命中率**，顺序反了收益微乎其微。

## 八、▶ 面试题 10 条（全收）

**Q1【极高】Gym 的 step 五元组里 terminated 和 truncated 为什么要分开？**
terminated 是 MDP 语义终止（value bootstrapping 截止），truncated 是外部
截断（step 上限/超时），后者仍需 bootstrap；Gymnasium 从四元组拆开，混用
会系统性低估长 horizon 任务的 value——agentic 长任务被 step 上限砍掉正是
truncated，按终止算就是惩罚长任务。（§2.2）

**Q2【高】Verifier 的 reward hacking 主要手段与防护？**
手段：删/改测试、硬编码输出、路径侧门（直接写答案文件）、乃至改写 reward
函数本身（Anthropic 实证可零样本泛化到此，arXiv:2406.10162）。防护六件套：
测试隐藏注入、双集合（FAIL_TO_PASS + PASS_TO_PASS）、workspace 与 reward
计算物理隔离、process-based secondary verifier、verifier 单测化进 CI、
canary 题 + 人工抽审闭环。（§4.3）

**Q3【高】万级并发 rollout 怎么调度？**
三池解耦（推理/环境/训练）+ 队列缓冲；按预估步长分桶优先级队列；AReaL 式
全异步（2.77×）+ staleness 控制；环境池暖池命中率为第一 KPI；断点续
rollout（轨迹 chunk 落盘 + 权重版本随行）。（§6）

**Q4【高】环境怎么保证可复现？**
镜像 digest 化、任务 setup 声明化、seed 三级（环境/采样/框架）、trace 与
权重版本随行落盘；承认 GPU 与异步调度非确定性，目标是「统计可复现 +
单轨迹可回放」，LLM 侧回放用落盘 token 替代实时生成。（§6.2-5）

**Q5【高】沙箱用 Docker 还是 Firecracker？**
可信任务集 + 极致启动成本用 Docker（SWE-bench 全生态）；多租户/跑模型自写
代码用 Firecracker（<125ms、<5MiB、150/s、jailer 双防）；gVisor 居间。
决策本质是威胁模型——会不会有人/agent 主动攻击宿主内核——而不是启动
毫秒数。（§5.1）

**Q6【中高】执行式 verifier 与非执行式 judge 怎么选？**
各自饱和（R2E-Gym 实测 42-43%）：执行式区分度低（0-1 信息少、测试不全＝
漏刷），judge 有偏（风格特征）；工程上混合：测试式定 pass/fail、judge 做
tie-break 与过程质量；只能取一个就先执行式。（§4.3）

**Q7【中高】SWE 类环境怎么规模化产出？**
三代路线：人写 issue 凑（SWE-Gym 2.4K）→ commit 反向生成测试 + 题面
（R2E-Gym 8.7K，SYNGEN）→ 任意 repo 自动破测试（SWE-smith 50K）；核心瓶颈
是「可执行环境 + 可验证测试」联对——**环境与 verifier 必须一起产，单产
一边不闭环**。（§3.1）

**Q8【中】RL rollout 与普通推理服务对推理引擎的要求差在哪？**
普通服务优化单请求时延；rollout 要会话级调度（sticky session 保 KV）、
权重热切换（每 step rollout 前同步训练权重，verl wake_up/sleep）、
token-in-token-out（防 decode-encode 不一致导致 PPO 不收敛）、以及对超长
尾输出的容忍与抢占。（§6.1，引擎侧细节见
[推理引擎2026新进展](../inference/推理引擎2026新进展.md)）

**Q9【中】多轮 agentic RL 为什么容易训崩？**
RAGEN 的 Echo Trap：reward 方差悬崖 + 梯度尖峰；对策是 trajectory
filtering、critic 引入、梯度稳定（StarPO-S），rollout 侧配多样初始态、
中等交互粒度、更高采样频率；无细粒度 reward 则 reasoning 不涌现（幻觉
思维/浅策略）。（§4.3）

**Q10【中】Web 环境评测完为什么要整站 reset？**
agent 行为有副作用（发帖、改 wiki、下单），不复位则状态污染后续任务，
verifier 断言的对象已非题目原意；WebArena 官方明确要求 812 例评测后整体
复位。工程推论：**有副作用环境不可池化简单复用，须快照复位或一次性
丢弃**。（§3.2-1、§5.2）

## 九、口径与未核实说明

- Farama/Gymnasium 接管时间线：社区共识成立，精确月份未核，正文不写。
- VisualWebArena 任务数、MiniWoB++ 任务数：未按摘要核实，不写数字。
- gVisor 开销倍数：常见引用区间因负载而异，未核，只写方向不写倍数。
- SWE 单环境构建耗时：社区经验「分钟级到十几分钟」，未按论文核实。
- 「Lookahead SWE-Bench」：查无同名公开工作，疑似指 SWE-bench-Live 或
  SWE-Search 类，正文不引用。
- Terminal-Bench 的 arXiv 编号：未命中，不引用。
- 第七节「≥90% 成本由 LLM 推理与长尾闲置组成」：结构性工程估算，非引用。
- Voyager「非 RL」定性：保留论文自述原措辞（黑盒 GPT-4 查询、不微调
  参数），倍数数字已从 arXiv 摘要核实。

## 串联阅读

- [rl训练工程实战](./rl训练工程实战.md)：训练侧四个坑（verifier 漏刷、熵坍缩、
  数据筛选、长思维链）——本篇的 verifier 咽喉与该篇的漏刷巡检互为表里。
- [verl深度拆解](./verl深度拆解.md)：训练引擎两段论与训推一致性三层防线；
  本篇 6.1 的 AgentLoop 接口切分在该篇 5.7 有代码级地图。
- [harness工程实战](../agent/harness工程实战.md)：agent 运行时层（错误处理、
  失败数据化、熔断）——环境与 harness 的职责分界看这篇。
- [观测与trace工程](../agent/观测与trace工程.md)：trajectory 全量落盘、
  属性传播与可复现五要素的 trace 侧实现，与本篇 §6.2-5 同源。
- [推理引擎2026新进展](../inference/推理引擎2026新进展.md)：推理引擎的 RL
  配套演进（权重热切换、会话调度），本篇 Q8 只点到为止。
