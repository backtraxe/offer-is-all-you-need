# 语音与 Voice Agent 专题：延迟预算、turn-taking 与 E2E 语音模型

> **面向**：准备 AI Infra / Agent 方向面试（或要接手实时语音产品线）的读者，
> 假设已通读仓内 [推理调度专题](./inference/推理调度专题.md)、
> [多模态推理专题](./inference/多模态推理专题.md) 两篇打底；本篇把「实时语音
> 对话」这条产品线从传输层到模型栈整条链路摊开。
>
> **读完获得**：① Pipeline（ASR→LLM→TTS）与 E2E speech-to-speech 两条路线的
> 直觉、机制与选型话术；② 一套可背的数字锚（延迟预算、12.5Hz 离散 token、
> 官方价格与缓存价差）；③ turn-taking、barge-in、preemptive generation 三大
> 生产工程议题的完整答法；④ 开源生态四件套的 star 水位与最新版本；⑤ 7 道
> 面试题加追问链。
>
> **时效口径**：调研日期 2026-10-11。全部 star、版本、价格、参数默认值均来自
> 当日 GitHub API、官方 README/公告、arXiv 摘要页与源码实测；官方宣称、论文
> 值、推导值、社区口径一律括注区分，未核实项见第七节，不准的数字不入正文。

## 〇、口径勘误（先立规矩）

- 网传「BLSH 双向流式」一词：arXiv 全文检索与 GitHub 检索均无匹配，查无
  明确出处。行业里最接近的可考概念是 WeNet U2/U2++ 的 **chunk-based 双向
  编码加 CTC 同步双遍解码**，FunASR/Kimi 系的流式实现与此同源。正文一律
  按这个可考口径写，面试官抛出原词时按本段拆穿即可。
- OpenAI 侧「250–500ms 端到端延迟」仅见于 tecnobits 一篇文章
  （2026-05，自媒体口径），官方从未给绝对值；官方口径只有
  **p95 延迟下降 ≥25%（OpenAI 官方社区公告，2026-07）**，且归因是缓存改进。
  正文凡涉 OpenAI 延迟，只引这两条可核实口径。

## 一、直觉一句话：语音 agent 的时钟从「闭嘴」起算

文本聊天的延迟感受从「开始出字」起算，流式输出把 head latency 藏得很好。
语音对话完全不同：用户的计时是从自己闭嘴那一刻开始的，而且他要等的不只是
第一个字，而是第一句完整的话语起播。人对自然应答间隙的容忍大约
**200–500ms（社区与语用学常识口径）**，所以语音 agent 的端到端预算一路从
「1 秒内及格」一路卷到 **400ms 内起播算优秀（推导口径，2026）** 的水平。

Pipeline 方案要把五段全压进这个预算：endpointing 等待、ASR 尾巴、LLM
TTFT、TTS 首包、网络传输，每段几十到几百毫秒，处处是坑。这就是 E2E
speech-to-speech 模型存在的动机——把五段折叠成一次 forward，延迟下限从
pipeline 的约 **600ms–1s（推导值，2026）** 一步压到 **200–400ms（对标
Moshi/Qwen3-Omni 官方论文锚点）**。代价与取舍在第三、四节展开。

<div class="diagram-embed">
<iframe src="assets/diagrams/voice-agent.html" width="100%" height="900" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/voice-agent.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

## 二、Pipeline 机制拆解：五段延迟，一段都省不掉

### 2.1 传输段：自建栈几乎必须 WebRTC

语音是连续媒体流，丢包与抖动下「内容基本可用」比「字节级可靠」重要得多，
WebRTC 正是为此而生，还自带 AEC 回声消除（agent 正在播放的声音不能被
自己采集回去触发 VAD）。WebSocket over TCP 在弱网下队头阻塞直接翻车。
这也是 LiveKit（自述 end-to-end realtime stack，GitHub 仓库描述，
2026-10 实测）、TEN、Pipecat 三家框架全部以 WebRTC 为传输核心的原因。
网络段典型预算 **50–150ms（推导值，2026）**，在总预算里常常被低估。

### 2.2 turn-taking：生产链路的最大变量不是模型，是轮次判定

半双工链路里，「用户说完了吗」这个判断直接决定延迟与体验的天花板。
做得太急会抢话（用户喘气、停顿被打断），做得太慢延迟爆炸。工程上叠两层：

- **轻量组合层**：Silero VAD 加滑动 silence 阈值。LiveKit agents 的源码
  默认值可以把面试官按在地上摩擦：**min_endpointing_delay 0.5s /
  max 3.0s**，用流式 STT 时收紧到 **0.3s / 2.5s**；被疑似打断后
  **false_interruption_timeout 2.0s** 内恢复视为误打断（上述默认值均为
  livekit/agents turn.py 源码 main 分支实测，2026-10）。
- **专用 turn 模型层**：Pipecat 系 Smart Turn 直接吃 PCM，利用韵律线索
  判句末，只在静音段运行。v3.2 支持 **23 种语言**，CPU int8 量化后仅
  **8MB**（GPU fp32 版 32MB），推理最快 **10ms**、云端实例低于
  **100ms（pipecat-ai/smart-turn 官方 README，2026-01 最后更新）**。

还有一招最直白的延迟偷法——**preemptive generation**：turn 还没确认就先
跑 LLM（必要时连 TTS 也先跑）。LiveKit 默认开启，单 turn 最多预生成
**3 次**，用户发言超过 **10s** 就放弃预生成（源码实测，2026-10）。
赌赢了 TTFT 归零，赌输了白烧 token；TTS 默认不参与预生成，因为合成
比 LLM token 贵得多。开不开、开多深，就是面试追问点。

OpenAI 侧官方未公开 turn 模型细节，但 gpt-realtime-2.1 公告明确改了
silence and noise handling 与 interruption behavior，2026-10 的 GPT-Live-1
官方描述直接是 smooth interruption handling——E2E 模型把打断处理内化
进模型本身，与 Moshi 系「模型内 turn-taking」殊途同归。

### 2.3 流式 ASR：chunk 化 attention 是事实范式

主流做法是「双向编码、受限右看」：编码器看全上文 chunk，只向右看一个
固定 lookahead，stride 滑动出 partial 结果。可背数字：

- FunASR 流式 Paraformer：**chunk_size [0,10,5] 即 600ms 窗口**、stride
  **600ms、前向 lookahead 300ms（FunASR 官方 README 示例，2025–2026）**。
- Fun-ASR-Nano streaming SDK 默认 chunk **720ms（官方 SDK 默认为「示例
  口径」而非推荐生产值，2026）**；且 Fun-ASR 已原生集成 vLLM 做批量与
  流式服务（官方 README，2026）。
- WeNet U2/U2++ 的 **CTC 同步双遍解码**：第一遍 chunk 流式出草稿，
  CTC 第二遍重打分纠错——一套编码器复用离线与流式两种模式。

工程要点：ASR 的 final 结果比 partial 慢一截（尾巴约 **50ms 量级**，
推导值），要不要等 final 再送 LLM，是延迟与纠错质量的第一笔 trade-off。

### 2.4 流式 TTS：离散 token 加轻量解码器，分块起播

2025–2026 年的共识架构是：LLM 生成离散语音 token，轻量解码器边收边播。
首包之战的可背锚点：

- CosyVoice 3.0 支持 text-in 流式与 audio-out 流式双向（bi-streaming），
  Bi-Streaming 首包低至 **150ms（CosyVoice 官方 README，2025-12）**；
  还显式支持 pronunciation inpainting，允许音素级回改——这是给生产断句
  兜底的特性。
- Kimi-Audio 用 **flow-matching 分块流式 detokenizer（arXiv 2504.18425，
  2025-04）**。
- Qwen3-Omni 的 Talker 用多码本并行加因果 ConvNet 替代 block-wise
  diffusion，从第一个 codec 帧即可起播，冷启动端到端首包 **234ms
  （理论值，arXiv 2509.17765 官方论文摘要，2025-09）**。
- GLM-4-Voice 解码器最少 **10 token 起播、20 token 即可合成（官方
  README，2024-12）**——12.5Hz 码本下一格就是 80ms。

首包优化的工程抓手无非四个：LLM 首句截短（避免长前缀生成）、TTS 按句/
按标点切开、codec 帧粒度足够细、播放器预热缓冲调小。断句切太碎会引入
「语气断裂与数字读错」——文本规范化（TN）要在文本边界上做，这正是
pronunciation inpainting 存在的理由。

### 2.5 LLM 段：prefix cache 命中率等于毛利率

语音会话每个 turn 都要把完整历史上文重新喂给模型，LLM 段的 TTFT 与
成本双双系于缓存命中。最硬的价格锚来自 OpenAI 官方定价表（2026-07）：
gpt-realtime-2.1 的 audio input 每百万 token **32 美元**，cached input 只要
**0.40 美元**，价差达 **80 倍（官方公告价格表，2026-07）**；output 为
**64 美元**。mini 版则是 10 / 0.30 / 20 美元三档。

自建栈要在三处分别做缓存复用：LLM 的 KV/prefix cache（vLLM/SGLang 的
前缀复用直接套上固定 system prompt 加会话历史）、ASR encoder 状态、
TTS codec 前序。注意一个天花板问题：**语音场景 prefix cache 命中率上限
低于文本客服场景（推导口径）**——会话短、每轮追加的音频 token 占比高、
缓存陈旧窗口窄，所以「缓存命中=毛利」在语音侧比文本侧更考验调度。
OpenAI 把 p95 延迟降 25 个百分点以上的归因给「改进缓存实现」，从官方侧
印证缓存就是延迟主攻点。

## 三、E2E speech-to-speech：离散 token 战争与全双工

### 3.1 12.5Hz 离散 audio token 成为事实标准

三家独立团队收敛到同一个量级，这不是巧合，是工程甜点：

- GLM-4-Voice：Whisper encoder 加 VQ，码率 **12.5 token/s（官方
  README，2024-12）**，流式交替输出文本与语音 token，以文本为参照保质量。
- Kimi-Audio：tokenizer **12.5Hz（arXiv 2504.18425，2025-04）**，走
  continuous-in / discrete-out 混合路线，配 flow matching 分块流式
  detokenizer，预训练音频达 **13M 小时**。
- Step-Audio-AQAA：**双码本 tokenizer 加 130B backbone（arXiv
  2506.08967，2025-06）**，文本与音频交错 token 输出，DPO 加 model
  merge 后训。注意：该工作**仅论文，无开源权重仓（2026-10 实测）**。

为什么从 50Hz 一路压到 12.5Hz？序列长度直接决定注意力成本与起播粒度：
12.5Hz 一格 80ms，天然匹配首包预算；多码本并进再补回码率损失。
codec token 与 semantic token 怎么选、怎么编排，是面试深追的基本盘。

### 3.2 三条已验证的路线

1. **离散 codec token 单流交错**（GLM-4-Voice）：一路序列里文本与语音
   token 交替出，实现最简，文本孪生兜底质量。
2. **双码本加交错输出加 DPO**（Step-Audio-AQAA）：码本分工更细、容量更大，
   但暂无开源权重，工程验证停留在论文层。
3. **全双工双流并行**（Moshi，Kyutai）：自方与用户方语音两条平行流，
   无显式轮次概念，天然支持叠加与插话，理论延迟 **160ms、实测 200ms
   （arXiv 2410.00037 官方论文摘要，2024-09）**。NVIDIA PersonaPlex 7B
   直接基于 Moshi 架构与权重、加 persona 条件化，2026-01 开源即达
   **10.6k star（GitHub API 实测，2026-10）**，是 2026 年 full-duplex
   开源落地的标志事件。

### 3.3 OpenAI 产品线一年内三跳：方向是「专用语音模型加解耦会话协议」

- **2025-08-28**：gpt-realtime GA（官方发布口径）。
- **2026-07-06**：gpt-realtime-2.1，官方只宣称 p95 延迟改善 ≥25%（缓存
  改进），同步改了 silence/noise handling 与 interruption behavior。
- **2026-10 前后**：GPT-Live-1 上线，独立 **v1/live/sessions** 端点，
  **按分钟 0.05 美元按秒计费**，knowledge cutoff **2025-07-31
  （developers.openai.com 官方模型页，2026-10）**。

一年三跳说明：与文本模型解耦的专用全双工语音模型，配独立的流式会话
协议，是头部厂商认定的生产方向。但 E2E 不是银弹——OpenAI 官方社区
2026-08 有生产团队吐槽 2.1 在强流程话术下 instruction 不稳（社区口径），
回退到 mini 版的案例不少；价格上 audio output 64 美元/百万 token 也让
确定性话务（外呼、催收、订餐）很难算平账。结果就是第四节开篇的混合拓扑。

## 四、工程议题七个：落地痛点与 trade-off

1. **Pipeline 与 E2E 不是二选一而是分工**。E2E 当「嘴和耳」（情绪、笑声、
   方言不丢，延迟下限 200–400ms），文本 supervisor 模型管流程与 tool，
   黑盒与成本交给文本侧兜底。这是 2026 年的主流生产拓扑（OpenAI 官方
   社区生产案例佐证，2026-08）。
2. **barge-in 是双边成本**。检测太灵，咳嗽与背景音就把 agent 掐死；
   太钝，用户会觉得你听不见他说话。工程上是组合解：VAD 触发暂停播放
   （播放器须支持 seek）、丢弃已排队 TTS buffer、false interruption 窗口
   内判定误打断则恢复现场。且打断发生时已预付的 TTS 音频与 LLM token
   都是沉没成本——这又是 preemptive generation 为什么默认只预生成
   LLM、不预生成 TTS 的账本逻辑。
3. **prefix cache 命中率直接决定毛利**。官方 80 倍价差摆在那；自建侧要把
   固定前缀（system prompt 加话术模板）做到久命中，把增量音频 token 的
   缓存期望降到诚实水平，不要在 BP 里按文本客服的命中率讲故事。
4. **网络段常被忽略**。传输换了 WebRTC 不等于完事：JitterBuffer 尺寸、
   播放缓冲预热、AEC 与 VAD 的串扰都要调；弱网指标要用包到达方差讲，
   别用平均 RTT 讲。
5. **TTS 断句策略决定首包与语气**。整句送合成延迟高，逐标点切又断语气、
   读错数字。成熟做法：首句强制短句化、后续按标点边界流式追加、有
   pronunciation inpainting 级能力兜底纠错。
6. **全双工开源模型的部署现实**。PersonaPlex 走 WebRTC server，官方
   README 甚至给 Blackwell GPU 单列 cu130 版 PyTorch 安装指引（README
   实测，2026）。真全双工模型常驻显存、每路会话独占一条 stream，单卡
   并发上限低，成本模型与 pipeline 完全不同——按「每并发一路独占算力」
   而非「按 token 摊销」算账。
7. **可观测性三大盲区**。① 音频段不可检索：会话要录双轨 stereo 再离线
   ASR 复盘，否则 badcase 无法归因；② 延迟归因要一条贯穿 VAD、ASR、
   LLM、TTS、传输五段的 trace（与仓内 LLM 观测专题同理，但采样率要求
   高一个量级）；③ 「用户感知延迟」与「指标延迟」不一致——播放缓冲会
   掩盖 TTFA，埋点要打「用户真正听到声音」那一帧。

## 五、开源生态四件套与水位（GitHub API 实测，2026-10）

| 组件 | 角色 | star | 备注 |
|---|---|---|---|
| LiveKit | 传输加编排框架 | 21,360（server）/ 14,684（agents） | server v1.13.9（2026-10-07） |
| Pipecat | 编排框架 | 16,337 | v1.12.0（2026-09-26） |
| TEN-framework | 传输加编排 | 11,157 | 字节系开源 |
| FunASR | 中文 ASR 底座 | 20,636 | 已原生集成 vLLM 服务化 |
| CosyVoice | 中文 TTS 底座 | 23,915 | 3.0 双向流式，首包 150ms |
| Moshi | 全双工 E2E | 11,197 | Kyutai，PersonaPlex 的母体 |
| PersonaPlex | 可部署全双工 | 10,607 | NVIDIA，2026-01 开源 |
| Kimi-Audio | E2E/底座 | 4,737 | 13M 小时预训练音频 |
| Qwen3-Omni | E2E/底座 | 4,042 | DashScope 已支持实时语音 |
| GLM-4-Voice | E2E/底座 | 3,236 | 12.5Hz 单流交错路线 |

选型竞争点不在「有没有」，在**托管编排深度对自控成本**：LiveKit/Pipecat
给到传输、VAD、打断、预生成的全套默认参数（可抄作业），TEN 偏平台化，
FunASR/CosyVoice 是中文世界的事实底座；E2E API（realtime 系）则把一切
变成按分钟计费的托管账单。

## 六、▶ 面试题

**Q1【高频】把一个 voice agent 的端到端延迟从 1.2s 优化到 500ms，先动哪里？**
⭐⭐⭐
按「收益除以改动成本」排序：① endpointing min_delay 调小、开 preemptive
generation（LiveKit 源码默认值 0.5s/3.0s、2.0s 误打断窗能背出来直接加分）；
② LLM TTFT：prefix cache、首句截短、换更快档位模型；③ TTS 分句流式、
首包格拉化（12.5Hz codec、最小起播 token 数）；④ 传输换 WebRTC。
追问：preemptive 什么场景不能开？——长发言（LiveKit 默认 10s 上限正是
为此）、多分支话术（预生成赌错方向白白推理）。

**Q2【高频】画出 ASR→LLM→TTS 链路的延迟瀑布，标典型值。**
⭐⭐⭐
量级要能脱口而出：turn 确认 300–500ms、ASR final 尾巴约 50ms、LLM
TTFT 150–400ms、TTS 首包 100–250ms、网络 50–150ms（均为推导值口径）。
对照组 E2E 一次 forward 全包 200–400ms：Moshi 理论 160ms（arXiv
2410.00037）、Qwen3-Omni 冷启动首包 234ms（arXiv 2509.17765）。

**Q3 为什么说 prefix cache 在语音会话场景命中率天花板更低？**
⭐⭐
三层展开：token 构成（每轮追加音频 token 占比高，固定前缀被稀释）、
缓存陈旧窗口（语音会话短、回收快）、cache key 差异（音频 token 与文本
token 的 KV 形态不同）。佐证用官方价差：音频 cached input 是未缓存的
1/80（OpenAI 官方定价表，2026-07）——命题不成立，头部厂商不会这么定价。

**Q4【高频】设计一个 barge-in 系统：检测、回滚、状态同步怎么做？**
⭐⭐⭐
链路：VAD 触发 → 暂停播放（播放器可 seek）→ 丢弃已排队 TTS buffer →
false_interruption_timeout 窗口内判定误打断（LiveKit 默认 2.0s）→ 恢复
或交出 turn；LLM 侧同步作废本轮输出并把已生成部分标记进上下文。
追问：E2E 模型下打断为什么变简单？——输入输出同一条流，模型自身建模
重叠语音（Moshi 双流），打断是模型内事件，不是链路外补丁。

**Q5 12.5Hz 离散 token 为什么成主流？codec token 与语义 token 怎么选？**
⭐⭐
从 50Hz 压到 12.5Hz 是序列长度与起播粒度的权衡：一格 80ms 天然匹配
首包预算，注意力成本按长度平方省。多码本（Qwen3-Omni）解决单码本码率
不足，双码本（Step-Audio-AQAA）解决声学与语义分工。彩蛋答案：
Kimi-Audio 的 continuous-in / discrete-out 混合路线，输入不吃离散化损失、
输出保住流式与可控性。

**Q6【高频】Qwen-Omni 的 Thinker-Talker 为什么能压首包？与单体重叠架构比劣势在哪？**
⭐⭐⭐
Thinker 出文本语义、Talker 只管 codec 帧（多码本并行加因果 ConvNet 替代
block-wise diffusion），分工解耦利于流式，第一个 codec 帧即可起播，换来
234ms 理论首包。代价：双流解耦牺牲「语音原生推理」的天花板，且 Thinking
变体与流式天然矛盾——显式推理链拉长，首包必然变长（官方论文口径，
2025-09），选模型时先想清楚要慢思考还是要快起播。

**Q7 客服场景技术选型：LiveKit 自接 / Pipecat / Realtime 系 API，怎么算账？**
⭐⭐
三本账：成本（GPT-Live-1 按分钟 0.05 美元按秒计费 vs 自部署 GPU 占用，
全双工模型单路独占流，不能按 token 摊销）；可控性（话术状态机在 E2E
黑盒里不可控，OpenAI 社区已有生产翻车回退案例，2026-08）；合规与锁定
（录音双轨、数据出境，realtime 系半年一换版本，2025-08 GA 到 2026-07
2.1 到 2026-10 GPT-Live-1 的迭代节奏本身就是风险项）。

## 七、口径与未核实说明

- 「BLSH 双向流式」查无出处，正文按 WeNet U2/U2++ chunk-based 双向编码
  加 CTC 双遍解码口径表达（见第〇节）。
- OpenAI 端到端延迟「250–500ms」仅 tecnobits 自媒体一处（2026-05），
  官方口径只有 p95 降 ≥25%（2026-07 公告），正文不采用自媒体数字。
- GPT-Live-1 的端点、计费、cutoff 经官方模型页核实；发布公告全文未逐条
  核实，发布日期按「2026-10 前后」保守表述。
- LiveKit 官方无公开的端到端延迟基准，正文只引其框架源码参数默认值
  （turn.py 实测，可信）。
- FunASR 流式参数（chunk [0,10,5]、stride 600ms、SDK 720ms）引自官方
  README 代码示例，属示例默认值而非推荐生产值。
- Step-Audio-AQAA 仅有论文（arXiv 2506.08967），无开源权重仓；
  stepfun-ai/Step-Audio 早期仓 2026-10 仅 43 star，主线已迁到
  Step-Audio2（1.5k）。
- PersonaPlex 论文编号 arXiv 2602.06053 为 repo README 所引，形式合法
  但下载页未逐一核对；模型为 7B、Moshi 权重衍生这一事实以 README 为准。

## 串联阅读

- [inference/多模态推理专题.md](./inference/多模态推理专题.md)：多模态 token
  化成本与四级省钱缓存，语音侧的「codec token 成本账」是它的姊妹篇。
- [inference/推理调度专题.md](./inference/推理调度专题.md)：continuous batching
  与调度结构，语客流式服务（ASR/TTS 走 vLLM）的调度底座。
- [显存计算专题.md](./显存计算专题.md)：全双工模型「常驻显存、每路独占流」
  的成本要按这里的账本算。
- [inference/长上下文推理与kv体系.md](./inference/长上下文推理与kv体系.md)：
  prefix cache 机制细节，本篇「命中率=毛利率」的机制基础。
- [agent/观测与trace工程.md](./agent/观测与trace工程.md)：五段延迟 trace 与
  线上 eval 闭环，语音可观测性三大盲区的通用解法。
- [agent/guardrail系统专题.md](./agent/guardrail系统专题.md)：语音护栏的独特
  性（音频不可检索、实时打断下的安全兜底）从这里延伸。
