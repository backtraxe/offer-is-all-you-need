# 双向 KV 传输与多轮复用专题（vLLM 2026-10 新能力）

> 面向已经读完 PD 分离与前缀缓存基础、准备推理岗或 Agent 基建岗面试的
> 读者。读完你会得到：① 多轮 Agent 负载下「KV 单向流的隐形税」是什么；
> ② 双向 KV 传输的机制六步与两个调参旋钮（TTL 480 秒 / 阈值 64 token）；
> ③ 一组可背诵的数字锚（TTFT 最长降 1.6 倍 / 3.3 倍）；④ 六个可直接
> 对答的面试追问。
> **口径声明**：机制描述与参数名依 vLLM 官方博客（2026-10-12）及其中文
> 转述整理；性能数字均为官方口径，未独立复测，行文一律标注。

## 一、直觉：KV 只往一个方向流，多轮对话每轮都在交「重复计算税」

多轮 Agent 负载的典型样子：Agent 推理一步、调一次工具、把工具结果追加进
对话，然后客户端**把整段历史重发一遍**进下一轮——系统指令、历史 prompt、
工具返回、模型回复，只增不减。

PD 分离部署下，标准动作是：prefill 节点给这段历史算 KV → decode 节点把
KV 块拉走 → 逐 token 生成。问题出在**方向只有一个**：decode 生成完，手里
明明握着「prompt + 新回复」的全部 KV，下一轮 prefill 却拿不到——

- decode 不维护会话共享通道，KV 生成完默认释放；
- prefill 侧的前缀缓存不感知会话，活跃会话的块反而更容易被驱逐。

一旦全 miss，prefill 只能把整段历史（含系统指令、历史请求、工具结果、
模型回复）**从头重算一遍**。对话越长、轮次越多，重复工作越大，TTFT 越涨。
一句话：**decode 算过的 KV，prefill 用不了——这是单向流架构的税**。

## 二、机制：decode 把 KV 还给 prefill（六步）

双向 KV 传输让 decode 在后续轮次把算好的 KV 反向还给 prefill。在原有
P→D 流程（蓝色通道）上叠加一条 D→P 复用路径（红色六步）：

1. decode 生成结束后**保留符合条件的 KV 块**，不立刻释放（由
   `decoder_kv_blocks_ttl` 控制，默认 480 秒），并公布块位置和过期时间；
2. 元数据（`kv_transfer_params`：块位置 + 过期时间）**随流式回复**返回，
   不需要另查 decode；
3. router 按 `conversation_id` 把元数据**缓存进内存**，挂到下一轮 prefill
   请求上；
4. 下一轮 prefill 先做本地前缀缓存命中检查，**再查远端可复用 KV**；
5. 可复用 token 数达到 `kv_recompute_threshold`（默认 64）才排队异步接收，
   否则本地重算更便宜；
6. D→P 一次 NIXL READ 把保留的 KV 拉回，**剩余后缀本地重算**，然后正常
   走 P→D 给 decode。

三个结构性要点：

- **router 只倒手元数据**，KV 张量两台 GPU 点对点直传，传输面与控制面
  分离；
- **正反用同一套传输机制**：NIXL connector 扩展后，prefill 也像 decode
  一样能消费远端 KV 块，P→D 与 D→P 共用一次 NIXL READ 的实现；
- **首轮永远 miss**：新会话第一轮走标准 P→D 流程并顺带把 decode 元数据
  存下，此后逐轮命中复用、逐轮刷新元数据。

配套的有状态控制面是 **KV-cache-aware router**：轻量化、内存级，只维护
`conversation_id → decode 侧 kv_transfer_params` 的映射。vLLM 官方只给
示例 proxy 实现，生产要自己写。

## 三、两个旋钮（面试高频收束点）

| 旋钮 | 默认 | 管什么 | 调参逻辑 |
|---|---|---|---|
| `decoder_kv_blocks_ttl` | 480 秒 | KV 在 decode 侧活多久 | 按轮次间隔中位数调；太长占显存、太短复用率低；**固定不续租**，官方明示下一步是空闲心跳续租 |
| `kv_recompute_threshold` | 64 token | 多短的前缀不值得拉 | 互联与协调开销大于重算时间就本地算；按模型算力、KV 块大小、互联性能标定 |

两处排障口径（来自官方复现脚本的踩坑清单）：

- prefill 日志出现 `Declining expired remote read`：decode 的块在下一轮前
  已过期 → 把 `decoder_kv_blocks_ttl` 调大，**且 proxy 侧的元数据缓存 TTL
  必须严格小于它**，否则 router 会领人去读已消失的块；
- proxy 在 ON 轮仍然一直 cache MISS：查三件——没传
  `--send-conversation-id`、上游补丁只打了一端、decode 侧
  `bidirectional_kv_xfer` 还停留在 false（此种情况下 decode 干脆不返回
  `kv_transfer_params`）。

## 四、数字锚（官方口径，可直接背）

环境：AWS P5en（每台 8×H200）× 2 台做 1P1D，EFA 16×200Gb/s ≈ 3.2Tb/s
互联；**prefill 侧显式关闭前缀缓存**以模拟「缓存被驱逐 / router 把请求
路由到无会话 KV 的 prefill」这一最坏情形；vLLM 0.29.0 + NIXL 1.4.1。

| 模型 | 关双向：TTFT 随 prompt 长度 | 开双向：TTFT | 最长 prompt 处降幅 | 额外传输时间 |
|---|---|---|---|---|
| Qwen3-32B | 2k:158ms → 24k:778ms | 2k:122ms → 24k:460ms | **约 1.6 倍** | 30–130ms |
| GLM-5-FP8 | 2k:500ms → 20k:2334ms | 2k:358ms → 20k:702ms | **约 3.3 倍** | 29–110ms |

总 prefill 时长对照（含传输）：Qwen3-32B 开 128–414ms vs 关 153–744ms；
GLM-5-FP8 开 316–541ms vs 关 500–2331ms。

**规律**：模型越大、上下文越长、单 token 重算越贵，复用越划算；几十到
一百毫秒的传输开销换来的是几百毫秒级的重算节省，**收益随规模放大**。
另有一个硬件侧细节：EFA 的 LIBFABRIC 后端会把每块 GPU 的 KV 只注册在
与该 GPU 同 PCIe 交换机的两条 rail 上，传输全程 PCIe 本地——传输快的
前提是网卡亲和性默认就做对了。

## 五、和已有知识怎么拼

- **与 PD 分离**：单向变双向，decode 从「只消费 KV」变成「也产出可复用
  KV」；PD 分离的基础题答法不变，这是叠加层。
- **与前缀缓存 APC**：APC 是会话盲的，活跃会话反而先被驱逐；双向传输 +
  router 元数据把会话亲和从「最好钉同一台 prefill」放宽到「路由到别的
  prefill 也能远端拉回」。
- **与 KV offload**：offload 是纵向分层（GPU → host → disk），双向传输是
  横向对等流动（D → P），Mooncake 式全局池是第三条路——三者解决的是同一
  个问题（KV 资产复用），可以组合用。
- **与 Agent 负载**：agent loop 每轮长出一截历史，正是理想客户；单轮省
  几百毫秒 TTFT × 一次任务几十轮，累计是秒级收益，直接改善 Agent 的
  任务级延迟 SLO。

## 六、▶ 面试题与追问

**Q1【高】多轮对话场景 TTFT 为什么越聊越慢？PD 架构下哪一步在重复干活？**
客户端每轮重发全量历史；decode 侧已算出的「prompt + 回复」KV 用不上、
默认释放，prefill 侧 APC 不感知先验会话反而先驱逐，全 miss 时 prefill 把
整段历史重算。重复干活的就是 prefill 的历史重算，随轮次线性放大。

**Q2【高】双向 KV 传输怎么工作？元数据和数据各走哪条路？**
decode 保留 KV 块并按 TTL 公布位置与过期时间，元数据随流式回复返回；
router 按 conversation_id 缓存元数据；下一轮 prefill 命中后排队异步做
D→P NIXL READ 拉回 KV，后缀本地补算。元数据走 router 控制面，KV 张量
两台 GPU 点对点直传。

**Q3【中高】`kv_recompute_threshold` 为什么存在？直接设 0 行不行？**
复用不是免费：互联传输 + 协调排队有固定开销，可复用前缀很短时，本地重算
反而更快。设 0 等于所有轮次都强制远端拉回，短增量轮次（比如只多了十几
个 token 的工具确认）会被传输开销拖累 TTFT。默认值 64 token 是官方给的
初值，实际按模型算力与互联带宽标定。

**Q4【中高】TTL 到期和 proxy 元数据缓存不一致会怎样？怎么排？**
典型症状是 prefill 日志 `Declining expired remote read`：router 还记着
块，decode 已经释放了。处置：调大 `decoder_kv_blocks_ttl`，并把 proxy
元数据缓存 TTL 压到它之下。更深一层的正确解是官方路线图上说的——空闲
心跳续租，而不是固定计时器。

**Q5【中】为什么不干脆用 sticky routing 把会话钉在同一台 prefill？**
可以，但代价是路由自由度：负载均衡没得选、prefill 扩容缩容时已有会话
无处迁移、会话倾斜时热点实例只能硬扛。双向传输把「亲和」从一台机器放宽
成「任意 prefill + 远端拉回」，配合 KV 事件路由是更通用的一层。两者可以
叠加：先 affinity，miss 时走双向。

**Q6【中】双向传输的缺点是什么？**
三个：TTL 期间 decode 侧 KV 不释放 → 显存占用上升，高压时段挤占并发槽位；
router 变成有状态组件，多实例部署要处理一致性；短增量轮次靠阈值过滤，
阈值调错反而变慢。所以它是「多轮长上下文负载的专用优化」，不是全局开关。

## 七、串联阅读

- [推理引擎 2026 新进展](./推理引擎2026新进展.md)：本篇是其中「KV 资产化」
  趋势在 2026-10 的具体落地案例；
- [长上下文推理与 KV 体系](./长上下文推理与kv体系.md)：前缀缓存与 KV
  分层的基础账，本篇的第一问从这里长出来；
- [KV Offload 与分层存储专题](./kv-offload与分层存储专题.md)：纵向复用
  路线，与本篇横向复用互补；
- [Agentic Serving 专题](./agentic-serving专题.md)：Agent 负载特征与
  多轮成本账，本篇的下游应用场景；
- [推理服务 SLO 与运营](./推理服务slo与运营.md)：TTFT 指标口径——本篇
  「降 1.6 倍」放回这套口径里理解。

## 八、口径与未核实说明

- 全部性能数字为 vLLM 官方博客（2026-10-12）口径，未独立复测；GLM-5-FP8
  的模型命名以原文为准。
- `decoder_kv_blocks_ttl`、`kv_recompute_threshold` 的默认值与配置示例
  来自官方 kv-transfer-config；「TTL 固定不续、心跳续租是下一步」为官方
  原文表述。
- 复现需要 vLLM v0.21.0 以上 + NixlConnector + 两端同开
  `bidirectional_kv_xfer` + KV-cache-aware router；官方只提供示例 proxy。
- 截至 2026-10-14，未见 SGLang 主线提供对等的 D→P 复用能力；若面试被问
  「别家有没有」，答「这是 vLLM 先落地的能力，原理上引擎无关」即可。
