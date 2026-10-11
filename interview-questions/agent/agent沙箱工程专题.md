# Agent 沙箱工程专题：五级隔离谱系、E2B runtime 拆解与本地沙箱默认配置

> **面向**：准备 Agent 基建 / AI Infra / RL Infra 方向面试、需要回答「agent 生成的
> 不可信代码到底跑在哪、这一层怎么造出来」的读者。已读
> [agent安全与防护](./agent安全与防护.md)（策略层）与
> [coding-agent横评专题](./coding-agent横评专题.md)（选型结论）后再读本文最顺。
>
> **读完获得**：① 子进程 → 容器 → gVisor → microVM → 云托管这条五级隔离谱系
> 每一级「多挡了什么、付出了什么」；② E2B runtime 的完整机制拆解——snapshot
> restore、userfaultfd 懒分页、CoW+NBD、分块缓存 P2P、best-of-K 调度、
> 控制面数据面分离；③ Claude Code / Codex 本地沙箱可直接背引用的公开默认配置，
> 以及「MCP/hooks 在沙箱外」这个最常见漏项；④ 网络出口三层范式
> （netns + nftables + SNI 检测）；⑤ RL 训练用与服务用沙箱差异（含 slime
> 最小 Protocol 的幂等重试设计）；⑥ 成本账与 8 条高频面试题答法。
>
> **时效口径以 2026-10 为准**（本批次调研日 2026-10-12）。star 数与时间戳均为当日 `gh api`
> 实测；厂商数字全部标注「官方/自报」口径；未核实项不进正文断言，统一收在
> 文末「口径与未核实说明」。

## 〇、定位：本篇下沉到机制层

仓内已有三篇沾边内容，边界一句话划清：
[agent安全与防护](./agent安全与防护.md) 讲威胁模型与分层防御的**策略层**；
[coding-agent横评专题](./coding-agent横评专题.md) 给了「写权限收口三拓扑」的
**选型结论**；[rl环境工程专题](../训练与对齐/rl环境工程专题.md) 从训练侧讲
环境即服务，sandbox 只有一张 Docker vs Firecracker 对比表。本篇只回答一个
机制问题：**当 agent 要执行一段模型生成的、不可完全信任的代码时，它落在哪
一层执行环境里，这一层是怎么被造出来、被隔离、被调度、被回收的**。

## 一、主线直觉：隔离向 VM 看齐、速度向容器看齐

一句话主线：**沙箱的演进方向是「隔离强度向 VM 看齐、启动速度向容器看齐」，
2025-2026 年这个行业用快照恢复（snapshot resume）把这条之前不可能的折线
打通了**。于是「每 agent 会话一台独占内核的机器」从奢侈品变成了日用品——
E2B 官网首页挂着「1B+ sandboxes started」的实时计数（E2B 官网，2026-10
实测）。

打通之前，行业在谱系两端纠结：

- 要速度就用容器，但容器**共享宿主内核**，gVisor 官方 README 原话点破：
  "Containers are not a sandbox——单次漏洞即可逃逸共享内核"；
- 要隔离就起 VM，但 QEMU 通用 VM 秒级起步，agent 每次 tool call 都等几秒
  是不可接受的。

打通的关键是 microVM 血统加快照路径：Firecracker 把 QEMU 裁到只剩 5 个
模拟设备，官方实测**建一个 microVM 冷启动 <125ms**（Firecracker 官网，2026-10
核实）；E2B 更进一步，**创建 = 恢复快照而非冷启动内核**，懒分页让内存按需
供页。这两件事叠加，「VM 级隔离」才第一次有了「容器级体感」。

<div class="diagram-embed">
<iframe src="assets/diagrams/agent-sandbox-engineering.html" width="100%" height="800" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/agent-sandbox-engineering.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、五级隔离谱系：每级多挡了什么、付出了什么

### 2.1 第一级：本地子进程受限执行（OS 原语）

不起容器，在 agent 所在机器上用 OS 自带机制画边界：

- macOS 用 **Seatbelt**（`sandbox-exec -p` 注入 profile）；
- Linux 用 **bubblewrap**（user namespace + bind mount 视图）+ **seccomp**
  （过滤系统调用）；
- Windows 侧机制细节本期未公开核实，见文末口径节。

这一级挡住的是「文件读写到哪、网络出不出得去」，**挡不住内核漏洞**，因为
还共享宿主内核。两个可直接背的代表实现：

- Anthropic 开源的 **sandbox-runtime（srt）**：TypeScript 库，README 自述
  「在 OS 层面对任意进程实施文件系统与网络限制，不需要容器」，
  2025-10-20 建仓，**截至 2026-10 共 5,508 star**（gh api 实测）。它是
  Claude Code 的官方沙箱底座。
- OpenAI 的 **Codex CLI**：自 **0.115 版本起 Linux 沙箱统一迁到
  bubblewrap + seccomp**（官方文档现行版，2026-10 核实），代价是 WSL1
  不再受支持。

**付出**的是：只承住 shell 命令语义内的破坏，没有独立的资源配额体系，
也无法给「一台干净机器」的错觉——agent 看到的还是你的整机文件树。

### 2.2 第二级：容器（Docker 单机 / K8s）

cgroups + namespace + 镜像分层。比第一级多了**文件系统与进程视图的完整
隔离**、镜像分发与资源限额，但仍**共享宿主内核**——单次内核漏洞即可逃逸
（gVisor README 原话，2026-10 核实）。

适用面：**可信内网的批量任务**。典型就是 RL rollout 里低密级题型环境——
题目本身不攻击宿主，隔离只要防误伤即可。付出的是：隔离强度天花板被
「共享内核」这件事钉死。

### 2.3 第三级：gVisor（用户态内核运行时 runsc）

Google 的第三条路：用 Go **在用户态重实现 Linux 接口层**（Sentry 拦截并
重实现应用 syscall），官方 README 定位语可直接背——**既不是 syscall
过滤器、也不是 VM**，"implements Linux by way of Linux"（gVisor 官方
README）。以 OCI runtime 形态插进 Docker/K8s，隔离强度**接近** VM、启动
**接近**容器，代价是 **syscall 兼容性面**——部分应用跑不了。

选型信号是 **Modal 将 gVisor 设为 Sandbox 默认 runtime**，且 **GPU Sandbox 只支持 gVisor
runtime**（Modal 官方文档，2026-10 核实）。gVisor 仓 2018 建仓，
**截至 2026-10 共 19,638 star**（gh api 实测）。

面试答 gVisor vs Firecracker 的本质区别就一句：**一个是用 Go 重实现
Linux 接口、共享宿主调度，一个是真内核真 VM 只裁设备——兼容性面换隔离
强度的两个方向**。

### 2.4 第四级：microVM（Firecracker 血统）

用 KVM 起真 VM，但裁掉 QEMU 的通用性：只留 **5 个模拟设备**——virtio-net、
virtio-block、virtio-vsock、串口、一个只用于关机的极简键盘控制器。官方
三组核心数字全部来自 firecracker-microvm.github.io（2026-10 核实）：

| 数字 | 口径 |
|---|---|
| **冷启动 <125ms** | 单 microVM 启动时间 |
| **每 VM 开销 <5 MiB** | 超出客户机请求内存部分的 VMM 常驻开销 |
| **单宿主每秒可建 150 个 microVM** | 吞吐口径 |

工程细节同样值得背：VMM 本体用 **Rust** 写；每个 FC 进程再被 **jailer**
关进第二层 cgroup/namespace/seccomp（双重防线）；血统来自 crosvm，由
AWS 为 Lambda 造——官网同时披露 **Lambda 每月 15 万亿+ 次调用跑在
Firecracker 上**（AWS 官方口径，2026-10 核实）。Firecracker 仓 2017
建仓至今，**截至 2026-10 共 37,290 star**（gh api 实测）。

这一级挡住的是**内核级逃逸**：就算客户机内核被攻陷，攻击者也只是站在
microVM 边界上，看不到宿主内核。E2B、Fly.io、Kata、Northflank 都在用
这个底座。

### 2.5 第五级：云级托管

把上面的 microVM/容器池做成 serverless API——E2B Cloud、Daytona、Modal
Sandbox。你拿到的不再是一台机器而是**一个 HTTPS/gRPC 控制面**：生命周期
原语（create/pause/resume/fork/metrics）由厂商兜底，计费按秒，合规资质
（SOC 2 II + HIPAA 之类）打包在 SLA 里。

E2B 商业化规模按官方自报口径（2026-10 实测）有 **100K+ teams、
94/100 Fortune 100 在用、10M+ 月 SDK 下载**。Daytona 是反面教材型样本：
开源仓 **71,566 star 定格**（archived，末次 push 2026-07-24，gh api 实测），
README 称 2026-06 起核心开发转私有代码库，服务延续、官网自报「Sub 90ms
sandbox creation」。

### 2.6 谱系小结与桌面/浏览器特化形态

| 级别 | 机制 | 多挡了什么 | 付出了什么 |
|---|---|---|---|
| 一、子进程 | Seatbelt / bwrap + seccomp | 文件与网络越权 | 内核漏洞裸奔，共享内核 |
| 二、容器 | cgroups + namespace | FS/进程完整视图 | 共享宿主内核 |
| 三、gVisor | 用户态重实现 syscall | 接近 VM 的 syscall 攻击面 | 兼容性面缩小 |
| 四、microVM | KVM + 5 设备 + jailer | 内核级逃逸 | 依赖 KVM，需 VM 基建 |
| 五、云托管 | serverless 控制面 | 生命周期与合规外包 | 成本与供应商绑定 |

**浏览器/桌面环境是第四、五级的特化形态**：microVM 里再装一个带屏幕的
Linux。E2B Desktop 有独立仓 e2b-dev/desktop（**共 1,523 star**，gh api 实测）；
Daytona 提供 Linux/macOS/Windows 桌面沙箱；Browser Use 生态的 browser
sandbox 属同构（browser-use 仓 **117,646 star**，但沙箱非其主线，口径见
文末）。

## 三、E2B runtime 架构全拆解：创建 = 恢复快照

E2B runtime（e2b-dev/runtime 仓，star 数 **1,709**，Go，Apache-2.0，2023-08
建仓、2026-10 高度活跃）把整套机制开源在仓内 docs/ARCHITECTURE.md——
这是目前公开资料里唯一一份逐层可考的 microVM 托管实现，面试答「E2B
为什么快」照这条数据流讲。

### 3.1 构建期：模板即快照

- 模板 = Docker 镜像 + 构建步骤的**分层构建**，每层**哈希缓存**；
- 最后有一遍 **optimize pass**：记录一次真实启动**触碰了哪些内存页**，
  为恢复期的预取服务；
- 产物是「预启动 VM 的快照」——**memfile + rootfs + 机器状态**，**分块**
  存入对象存储（GCS/S3）。

直觉：**把一次冷启动的成本在构建期一次性付掉**，之后每个沙箱都不再
冷启动。

### 3.2 创建期：四件套撑起「秒开」

「创建沙箱」= 恢复快照，而非启动内核。四步走：

1. **分块拉取与缓存**：orchestrator 从对象存储拉快照分块，落本地磁盘
   缓存，可选 NFS 共享缓存，节点间还可 **P2P 互拉**（ChunkService）。
2. **userfaultfd 懒分页**：内存不整份加载——页错误时 handler 直接从模板
   memfile 供页，**只读被真实触碰的页**；另有 prefetcher 按optimize pass
   留下的热页清单预热。
3. **CoW + NBD 的根文件系统**：rootfs 是**只读模板 + 每沙箱私有 CoW
   覆盖层**，由 orchestrator **进程内的用户态 NBD server** 暴露成块设备。
4. **独立网络栈**：每沙箱独立 netns + tap 设备 + /16 网段内唯一的主机侧
   IP + NAT，以及**每槽位 nftables 出口防火墙**，带 **SNI/Host 检测**的
   域名 allow/deny 名单（不解密 TLS，只看握手 SNI 与 HTTP Host）。

亲和便利性数字（E2B 架构文档，2026-10 核实）：VM 内入口进程 **envd
监听 :49983**；orchestrator gRPC 端口 **:5008**。

### 3.3 运行期：envd 是 SDK 对话的对象

VM 内跑 envd，**进程执行/PTY/文件读写/端口转发**都走它，协议是
**Connect RPC + REST**。各语言 SDK 说的「sandbox.exec」翻译过来就是对
:49983 的一次调用。**进程 envd 可在运行中的沙箱里热升级**——这是把沙箱当
长期服务经营的信号，不是一次性容器。

### 3.4 暂停/恢复/fork：省成本的三板斧

- **pause**：把内存与磁盘相对模板的 **diff** 导出到对象存储。关键设计
  是 **paused 快照和模板是同一种 artifact**——resume 走的与 create 是
  **同一条快路径**（uffd 懒分页 + CoW），没有任何特殊慢分支。
- **自动暂停 + 流量唤醒**：闲置沙箱可自动 pause；进来的流量由边缘的
  client-proxy 命中后**经 gRPC 唤醒**，**闲置超时预算默认 120 秒**
  （overstay budget，架构文档默认值）。
- **fork**：对**活沙箱原地 checkpoint**，**一次请求最多起 100 个新沙箱**，
  原沙箱不受影响——这是给「同一环境跑 K 个并行探索」这类 RL/评测场景
  准备的原语。

### 3.5 控制面/数据面分离与 best-of-K 调度

职责切分一句话：**控制面 API 只决定沙箱「跑在哪」，节点 orchestrator 决定「怎么跑」，
沙箱流量直连节点、永不过 API**。

- **控制面**走 REST + gRPC（Gin 框架、OpenAPI 生成）；持久实体进
  **Postgres**，活沙箱与路由表进 **Redis**。
- **数据面**：节点上的 orchestrator + Firecracker 进程 + envd；边缘
  client-proxy 按 Redis 路由表把 `https://<port>-<sandbox>.<domain>`
  转发到目标节点 :5007。
- **调度采用 best-of-K**：随机抽 K 个就绪节点，按 **CPU 负载与
  hugepage 池负载取高者**打分收最低者（默认开 `BEST_OF_K_HUGEPAGE_MEMORY`，
  内存走大页以支撑 uffd 路径）；节点拒绝创建则**全抖动退避**。

面试递进口径：被问「一万个沙箱并发怎么编」时，答案骨架 = best-of-K
放置 + hugepage 评分 + P2P 模板分发 + 每节点 cgroup 配额（E2B 的 vCPU
超配实现：**建 VM 按 max_vcpus、限 cpu 用 cpu.max 限住 fc_vcpu 线程**）。

## 四、本地沙箱公开默认值：Claude Code vs Codex

以下条目均取自两家官方文档现行版（2026-10 核实），可以直接背。

### 4.1 Claude Code（底座 = srt）

- 默认项：**sandbox.enabled 默认为 false**（须 `/sandbox` 命令或 settings 显式开
  才生效；macOS 走 Seatbelt，Linux/WSL2 走 **bubblewrap + socat**，原生
  Windows 不支持沙箱（让路给 WSL2）。
- 开启后的边界：**写入仅限工作目录** + 每用户临时目录（Protected paths
  恒写拒绝）；**读几乎整机**——**包括 ~/.ssh 与 ~/.aws/credentials**，须
  显式配 `denyRead`/credentials 收口，这是默认配置里最危险的坑。
- 网络：**无直连**，全部走**本机代理**，allowedDomains **初始为空**。
- 边界误区（官方文档明说）：**只有 shell 命令受约束**——Read/Edit/Write/
  WebFetch 工具与 **MCP server、hooks 全在沙箱外**；沙箱内失败的命令，
  Claude 可请求「脱沙箱重跑」。

### 4.2 Codex CLI/IDE

- 模式三档：**取值即 sandbox_mode 三档**（`read-only` / `workspace-write` / `danger-full-access`）；
  默认 Auto 预设 = workspace-write + on-request 审批。
- **默认网络关闭**；workspace-write 下要显式 `network_access = true` 才开。
- 工作区 = cwd + /tmp；**可写根内 .git / .agents / .codex 递归只读保护**——
  防 agent 改自己的配置与审计痕迹。
- 网络代理规则（特性默认关）：域名支持精确主机、`*.example.com`（不匹配
  apex）、`**.example.com`（连 apex）、全局 `*` 仅允许出现在 allow 侧；
  **deny 恒赢**。
- `allow_local_binding` **默认 false**——挡 loopback/私网访问；放行前做
  **DNS 重绑定（DNS rebinding）的尽力检查**：域名解析到非公网地址即拒。
- **Codex Cloud 两段式**：setup 阶段可联网装依赖，**且 agent 阶段默认离线**；
  secrets 只在 setup 可用。

### 4.3 网络出口的工程范式已收敛为三层

不管是 E2B 还是两家本地沙箱，出口策略都落在同一个三层范式上：

| 层 | 机制 | 挡什么 |
|---|---|---|
| L1 物理隔离 | netns + NAT | 沙箱对宿主网络的任意触摸 |
| L2 四元组 | nftables 按 IP/端口 | 粗粒度出口策略 |
| L3 域名名单 | **SNI/Host 检测** | 域名级白名单（不解密 TLS） |

第三层的工程依据务必背下来以供追问：**不解密 TLS、只看 ClientHello 里的
SNI 与 HTTP Host 头**——HTTPS 白名单因此在**性能与法务上都站得住**（不
需要中间人证书）。Claude Code（本机代理 + 空名单起步）和 Codex（deny
恒赢 + DNS rebinding 检查 + 本地地址默认拒）是同一范式的两套实现，
面试可以互相印证。

追问杀招：**白名单域名 ≠ 白名单 IP**——攻击者可以让一个你白名单里的域名
解析到 169.254.169.254（云元数据）再请求。Codex 的对策就是解到非公网
地址即拒。

### 4.4 「沙箱外的攻击面」是最常见漏项

Claude Code 文档明说的边界：**文件工具/MCP/hooks/statusline 都在沙箱
外**。也就是说本地原语沙箱（第一级）**只挡 shell 命令**，挡不住：

- MCP server 进程带着 agent 的凭证直连网络；
- hooks 里被注入的恶意 shell；
- 文件工具对 ~/.ssh 的读取（除非额外 denyRead）。

Codex 文档给的标准对策是**把整个 agent 进程塞进 devcontainer**——Ubuntu
24.04 参考实现 + 出站防火墙 + **容器内仍然跑 bwrap**。话术语法：**进程
原语挡命令、容器挡进程**，双层防御。策略层的威胁模型（注入三角）见
agent安全与防护，本篇只补充执行层机制。

## 五、RL 训练用沙箱 vs 服务用沙箱

衔接 rl环境工程专题的训练侧视角，本篇只补**机制侧差异**。核心差异在
**生命周期协议与并发模型**：

| 维度 | 训练用（rollout） | 服务用（产品沙箱） |
|---|---|---|
| 生命周期 | **秒级生灭** | 长会话 + pause/resume |
| 并发量纲 | **万级 rollout worker** | 百级~千级在线用户 |
| 状态形态 | 模板即环境快照，**从头复刻** | 用户私有状态持续演进 |
| 接口契约 | **幂等重试**优先 | pause/fork/URL 路由 |
| 成本结构 | 单位 episode 成本 | 单位会话小时成本 |

实测 **THUDM/slime（8,632 star，gh api 2026-10-11 实测）** 的
`slime/agent/sandbox.py`，对照契约设计直接可读：

- 公开契约刻意做成**最小 Protocol**：async 上下文管理 +
  `exec(cmd, timeout=120)` + `write_file/read_file`——**默认超时 120 秒**；
- E2B 是后端之一（`E2BSandbox` 自带 `_rpc_retry`），接口上有显式
  **`idempotent` 提示位**，供后端决定断线后能否安全重放；
- 长尾任务用 **done-marker file 轮询**（5 秒一次短幂等 RPC，顺带对抗
  沙箱闲置 GC 回收）。

金句记好：**训练侧把 sandbox 当幂等的「函数调用」，服务侧把 sandbox 当有
状态的「进程」**。同一个 E2B runtime 两边都供，但 verl（**23,827 star**，
gh api 实测）侧环境更多走自托管容器池——成本量纲见 rl环境工程专题
第八节。

## 六、成本账与工程坑位

### 6.1 成本账（官方口径，2026-10 实测）

E2B 定价页：**按秒计费**，1 vCPU = **$0.000014/s**（≈ **$0.0504/vCPU·小时**），
默认 2 vCPU 档 ≈ **1 个沙箱每小时约 0.10 美元**。三档计划：

| 计划 | 关键数字 | 会话上限与并发 |
|---|---|---|
| Hobby | $100 一次性免费额度 | 会话最长 1 小时，并发上限 **20** |
| Pro | $150/月 基础费 | 会话最长 24 小时，并发 **100 起可扩到 1,100** |
| Enterprise | 谈价 | **数万并发**、BYOC（自带 AWS/GCP/Azure） |

对照 Modal Sandbox：**默认最长 5 分钟、上限 24 小时**；超 24 小时官方
建议走 **Filesystem Snapshot** 存档再恢复（Modal 官方文档）。生命周期
是 5 个事件（create/timeout 等），readiness probe 默认 100ms 间隔。

**规模参照系**：Firecracker 支撑 Lambda **每月 15 万亿+ 次调用**（AWS
官方口径）——microVM 形态的边际成本已经低到可以作为 RPC 级原语使用。

### 6.2 启动延迟口径的坑

- Firecracker **冷启动 <125ms**（实测口径）；
- E2B 不冷启动而是**恢复快照**，官方未给站内毫秒数——社区流传的
  「~150ms」本次未找到一手来源，**不要背**（见文末说明）；
- Daytona 官网自报「Sub 90ms」（码到执行），代码已私有化无从验证。

面试引用口径：以上数字都指沙箱**就绪到 exec 可用**这一口径，不含镜像构建——
一旦追问就要区分构建期/创建期/预热路径三段。

### 6.3 页缓存是 pausable cloud 的真瓶颈

E2B 架构文档的 telemetry 设计点破：**恢复路径全是小块随机读的
demand paging**。本地分块缓存 + P2P 互拉就是为这个路径存在的——自建
自托管时这是**第一坑**：对象存储首包延迟会原样打在每次恢复里，没有
本地 cache 的 restore 等于伪冷启动。

### 6.4 凭证管理的新标准答案

**凭证不进沙箱文件系统、在出口代理处注入**已成 2026 年的标准答案：

- **E2B secrets 是 metadata-only**：值永不过 API/日志/trace span，仅
  egress 侧解析；
- Daytona 同款：官网原话「keep plaintext credentials outside the
  sandbox and substitute them at network egress」；
- Modal 用 **OIDC token** 注入。

### 6.5 三种「快照」别混

| 名字 | 层位 | 内容 |
|---|---|---|
| VM 快照（Firecracker snapshot） | VMM | memfile + rootfs + 机器状态 |
| Filesystem Snapshot（Modal） | 文件系统 | 磁盘状态，可跨沙箱恢复 |
| RL ckpt | 训练 | 模型权重与 optimizer 状态 |

E2B 的产品化切分是 **template（只读、可共享）** 与 **paused sandbox
（diff、私有）**，resume 同路径——被问「快照和 checkpoint 什么关系」先
问清面试官说的是哪一层。

## 七、数字锚汇总（全部官方/实测口径，2026-10）

| 数字 | 说明 | 来源 |
|---|---|---|
| **冷启动 <125ms** | 单 microVM | Firecracker 官网 |
| **每 VM 开销 <5 MiB** | VMM 常驻开销 | Firecracker 官网 |
| **150 个/秒/宿主** | microVM 创建吞吐 | Firecracker 官网 |
| **15 万亿+ 次/月** | Lambda 调用跑在 FC 上 | AWS 官网 |
| **1B+ sandboxes** | E2B 首页计数 | E2B 官网 |
| **$0.000014/s/vCPU** | E2B 单价 | E2B 定价页 |
| **100 个** | 单次 fork 上限 | E2B 架构文档 |
| **120 秒** | auto-pause overstay budget 默认值 | E2B 架构文档 |
| **:49983 / :5008** | envd / orchestrator gRPC 端口 | E2B 架构文档 |
| **三档 sandbox_mode** | read-only/workspace-write/danger | Codex 官方文档 |
| **默认 enabled=false** | Claude Code 沙箱开关 | Claude Code 官方文档 |
| **5,508 star** | sandbox-runtime（2025-10-20 建仓） | gh api 实测 |
| **37,290 star** | Firecracker 仓 | gh api 实测 |
| **19,638 star** | gVisor 仓 | gh api 实测 |
| **71,566 star（archived）** | Daytona 定格 | gh api 实测 |

## ▶ 八、高频面试题

**Q1：为什么不能直接在 host 上跑 agent 生成的代码？**（频率极高，入门题）
三层答法：**进程权限面**（同 UID 即同权限）、**内核共享面**（内核漏洞即
整机）、**数据面**（~/.ssh、~/.aws、环境变量 secrets）。浅档：三层层各举
一例；深档：指出「MCP/hooks 在沙箱外」证明本地原语沙箱不覆盖全部攻击面，
给出 devcontainer 双层对策。

**Q2：microVM 比容器多什么？**（频率极高）
多：独立内核 + KVM 硬件隔离 + **5 设备**的极简攻击面 + jailer 第二层。
追「那为什么不慢」：内核被裁小 + **snapshot restore 取代冷启动**——背
**冷启动 <125ms、每 VM <5 MiB、单宿主每秒 150 个**（Firecracker 官网）。

**Q3：gVisor 和 Firecracker 的本质区别？**（频率高）
一句话：本质是 **Go 在用户态重实现 Linux 接口、共享宿主调度 vs 真内核真 VM 只裁
设备**。取舍轴：兼容性面 vs 隔离强度。加分项：Modal 默认 gVisor 且其
**GPU sandbox 只支持 gVisor runtime**（官方文档）。

**Q4：E2B 为什么快？**（频率高，深档题）
四件套是 **snapshot resume**（创建=恢复而非启动）+ **userfaultfd 懒分页**
（页错误才供页，prefetcher 预热）+ **CoW/NBD 只读模板**（rootfs 不复制）+
**分块缓存/P2P**（本地与节点间复用）。控制面只放 Postgres/Redis 元数据、
不碰沙箱流量。浅档答出前两件即及格；深档能讲清 uffd 的 I/O 路径与
「paused 与 template 同构 artifact → resume/create 同路径」。

**Q5：沙箱网络出口白名单怎么定？**（频率高）
三层范式：netns+NAT → nftables → **SNI/Host 检测不解密 TLS**。追问
「DNS rebinding」：白名单域名不等于白名单 IP，答 Codex 三连——deny 恒赢、
`allow_local_binding=false`、解析到非公网地址即拒。

**Q6：pause/resume 怎么省成本？**（频率中高）
pause 只导出**相对模板的 diff**；paused 快照与模板是**同构 artifact**，
resume 走同一条恢复快路径；闲置自动暂停 + 流量唤醒（**overstay budget
默认 120 秒**）；fork 原地 checkpoint、**一次最多 100 个**。

**Q7：一万个沙箱并发怎么编？**（频率中高，系统设计口）
best-of-K 放置（CPU 与 hugepage 池负载取高者打分）+ hugepage 支撑 uffd + P2P 模板分发 + 每节点 cgroup 配额（max_vcpus 建 VM、cpu.max 限 fc_vcpu
线程）+ 节点拒绝全抖动退避。浅档：画得出控制面/数据面分离即及格。

**Q8：RL 训练用 sandbox 和服务用差在哪？**（频率中高，RL infra 口）
四根轴：**生灭 vs 长会话、万级 vs 百级、幂等重试 vs pause/fork、单位
episode 成本 vs 单位会话小时**。深档举 slime 实例：最小 Protocol、
`idempotent` 提示位、`timeout=120` 默认、done-marker 轮询对抗闲置 GC。

深档总提示：浅档要求 = 画出五级谱系 + Firecracker 三数字 + 两家本地沙箱
各背一个默认配置；深档要求 = uffd 懒分页与 CoW 的 I/O 路径、SNI 白名单
不解密 TLS 的依据、沙箱外攻击面的工程对策（devcontainer 双层）、训练态
幂等重试协议的 slime 实例。

## 九、口径与未核实说明

已核验来路（均 2026-10-12 当日实测或当日现行文档）：star 数与
pushed/archived 时间戳来自 `gh api`；Firecracker 三组核心数字与 Lambda
15 万亿+ 次/月来自 firecracker-microvm.github.io 官网；E2B 机制来自
e2b-dev/runtime 仓内 docs/ARCHITECTURE.md 原文；E2B 定价、并发档位、
商业计数、SOC 2 II + HIPAA 来自 e2b.dev 官网与定价页；Daytona「Sub
90ms」与私有化转向来自 daytona.io 官网与仓 README（仓已归档）；Codex
与 Claude Code 默认值来自两家官方文档现行版；Modal 数字来自 modal.com
官方文档；slime 沙箱 Protocol 来自 THUDM/slime 仓源码 docstring；gVisor
定位语来自官方 README。

未核实项（正文已回避当事实引用）：

1. **E2B 沙箱恢复的具体毫秒数**：官网只说 "boots from a snapshot…
   container speed"；社区「~150ms」未见一手来源，不引用。
2. **Daytona 内部实现机制**：核心代码 2026-06 转私有，「Sub 90ms」为
   官方自报且无法在现行代码层面验证。
3. **gVisor 实现细节数字**（Sentry syscall 覆盖比例、各 platform 模式
   开销）：gvisor.dev 两次 fetch 网络不可达，仅取 GitHub README 定位性
   描述。
4. **Novita、Replicate 的沙箱产品数字**：未实测到公开启动/成本口径，
   仅以「云级托管同类」提级处理。
5. **browser-use 配套 browser sandbox 的隔离形态**：browser-use 仓主线
   是控制框架，云端浏览器沙箱无公开机制文档，按「microVM+桌面」同构
   归类。
6. **verl 的 sandbox 后端清单**：`gh api` 代码搜索返回 0 条，正文只作
   「自托管容器池为主」定性表述。
7. **Codex Windows 新版机制（MXC）**：文档只给名称与 WSL2 建议路径，
   未公开机制细节。
8. 所有「官方自报」数字（Daytona 90ms、E2B 商业计数、Lambda 15 万亿+
   次/月）均为厂商营销口径，无第三方复测，面试引用建议自带「官方
   口径」前缀。

## 串联阅读

- [agent安全与防护](./agent安全与防护.md)：威胁模型与分层防御的策略层，本篇
  的执行层机制是其最底下两环。
- [coding-agent横评专题](./coding-agent横评专题.md)：写权限收口三拓扑的选型
  结论，本篇给其中的「进程内沙箱」补默认配置细节。
- [rl环境工程专题](../训练与对齐/rl环境工程专题.md)：训练侧视角的环境即服务，
  sandbox 选型表与该篇第八节成本量纲呼应。
- [gui-agent与computer-use专题](./gui-agent与computer-use专题.md)：桌面/浏览器
  沙箱是 cdp layer 之下的执行地基。
- [多agent与评测](./多agent与评测.md)：评测环境的隔离与确定性需求。
