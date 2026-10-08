# 手写最小 Agent（脱框架 ReAct + 上下文压缩）

> 应用岗 2026 年 live coding 新高频。理论口径与
> [agent基础与规划](../../interview-questions/agent/agent基础与规划.md)
> 保持一致：ReAct = Thought/Action/Observation 交错循环（TAO），死循环靠"三层防护"
> （最大步数硬兜底 → 重复指纹拦截 → 反思退出）。本文把这三层直接写成能默写的代码。

## 题目一：脱框架手写最小 ReAct Agent

▶ 真题：不依赖 LangChain 等框架，手写一个最小 ReAct Agent：支持工具注册（name → schema + 函数）、TAO 循环、终止条件（最大步数 / 重复检测 / finish 标记）、工具异常处理与超时重试、简易 trace 记录——**中高，2026 新高频**（应用岗通用原题）

### 题意拆解

面试官想看四件事，一件都不能少：

1. **工具注册表**：工具名 → 可调函数 + JSON Schema（model 侧用）。装饰器一行搞定是加分项。
2. **TAO 循环**：每步 LLM 吐 `Thought + Action`，代码执行工具拿 `Observation`，拼回上下文。
3. **终止条件**：`finish` 主动结束（第三层）；`(tool, args)` 指纹重复拦截（第二层）；
   `MAX_STEPS` 硬兜底（第一层）——且兜底后要 best-effort 降级回答，不是直接报错。
4. **鲁棒性**：LLM 调用超时重试、工具抛异常不能炸掉循环（异常本身就是一条 Observation）、
   trace 逐步落盘。

### 默写版代码

```python
import hashlib
import json
import time

MAX_STEPS = 10          # 硬兜底：最大步数
DUP_LIMIT = 2           # 同一指纹最多出现几次
LLM_RETRY = 3           # LLM 调用失败重试次数
LLM_TIMEOUT = 30.0      # 单次 LLM 调用超时（秒）

# ---------- 1. 工具注册表：name -> {fn, schema} ----------
TOOLS = {}

def tool(name: str, description: str, parameters: dict):
    """装饰器：注册工具。parameters 是 JSON Schema 的 properties 部分。"""
    def deco(fn):
        TOOLS[name] = {
            "fn": fn,
            "schema": {
                "name": name,
                "description": description,
                "parameters": {"type": "object", "properties": parameters},
            },
        }
        return fn
    return deco

@tool("calculator", "计算一个算术表达式，参数 expr 为字符串，如 '3*(4+5)'",
      {"expr": {"type": "string", "description": "算术表达式"}})
def calculator(expr: str) -> str:
    # 演示用禁掉内建；生产上用 ast 白名单解析，别直接 eval
    return str(eval(expr, {"__builtins__": {}}, {}))

@tool("search", "搜索互联网，参数 query 为查询词",
      {"query": {"type": "string", "description": "搜索关键词"}})
def search(query: str) -> str:
    # 真项目里这里接搜索 API；面试时能讲清接口就行
    return f"[mock] '{query}' 的搜索结果……"

PROMPT = """你在一个循环里完成任务。每一步只输出：
Thought: <你的推理>
Action: <工具名> <JSON 参数>
或结束时输出：
Action: finish <最终答案>
可用工具：{tools}""".format(
    tools=json.dumps([v["schema"] for v in TOOLS.values()], ensure_ascii=False))


def parse_action(text: str):
    """从 LLM 输出里解析 Action 行：返回 (工具名, 参数 dict 或最终答案)"""
    for line in text.splitlines():
        if line.startswith("Action:"):
            body = line[len("Action:"):].strip()
            name, _, rest = body.partition(" ")
            if name == "finish":
                return "finish", rest
            try:
                return name, json.loads(rest) if rest else {}
            except json.JSONDecodeError:
                return name, {}          # 参数解析失败也不能炸，交给工具层兜底
    raise ValueError("没有合法的 Action 行")


def call_llm_with_retry(messages) -> str:
    """LLM 调用 + 超时 + 指数退避重试。llm_call 是外部注入的真实 API 调用。"""
    for attempt in range(LLM_RETRY):
        try:
            # llm_call(messages, timeout=LLM_TIMEOUT)
            time.sleep(0.01)  # mock：真实现就是 SDK 调用，超时由 SDK 抛 TimeoutError
            return "Thought: 演示\nAction: finish 演示答案"
        except (TimeoutError, ConnectionError) as e:
            if attempt == LLM_RETRY - 1:
                raise
            time.sleep(2 ** attempt)     # 指数退避：1s, 2s, 4s…
    raise RuntimeError("unreachable")


def fingerprint(name: str, args: dict) -> str:
    """动作指纹 = (工具名 + 规范化参数) 的 hash，用于重复循环检测"""
    canon = json.dumps({"tool": name, "args": args},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.md5(canon.encode()).hexdigest()


def run_agent(task: str) -> str:
    messages = [{"role": "system", "content": PROMPT},
                {"role": "user", "content": task}]
    seen = {}        # 指纹 -> 已出现次数（第二层防护）
    trace = []       # 简易 trace：每步 (step, action, observation) 落一条

    for step in range(1, MAX_STEPS + 1):
        # —— LLM 一步推理（带重试）——
        raw = call_llm_with_retry(messages)
        try:
            action, args = parse_action(raw)
        except ValueError:
            # 输出格式不合法也是一条 Observation，让模型自我纠正
            messages.append({"role": "user", "content":
                "Observation: 输出格式错误，必须包含 'Thought:' 和 'Action:' 行"})
            continue

        # —— 终止：模型主动 finish（第三层防护）——
        if action == "finish":
            trace.append({"step": step, "action": "finish", "answer": args})
            return args

        # —— 重复检测（第二层防护）——
        fp = fingerprint(action, args)
        seen[fp] = seen.get(fp, 0) + 1
        if seen[fp] >= DUP_LIMIT:
            obs = (f"你已用相同参数调用过 {action}，结果是 {trace[-1].get('obs')}。"
                   "这条路走不通，请换思路或直接 finish。")
            # 强制再重复就直接触发兜底，不再给机会
            if seen[fp] >= DUP_LIMIT + 2:
                break
        else:
            # —— 执行工具：异常降级为 Observation，绝不让循环崩掉 ——
            if action not in TOOLS:
                obs = f"错误：工具 '{action}' 不存在，可用工具：{list(TOOLS)}"
            else:
                try:
                    obs = TOOLS[action]["fn"](**args)
                except TypeError as e:
                    obs = f"参数错误：{e}。请对照工具 schema 修正。"
                except TimeoutError:
                    obs = f"工具 {action} 超时，可换工具或重试一次。"
                except Exception as e:          # 兜底一切业务异常
                    obs = f"工具 {action} 执行失败：{e}"

        trace.append({"step": step, "action": action, "args": args, "obs": obs})
        messages.append({"role": "assistant", "content": raw})
        messages.append({"role": "user", "content": f"Observation: {obs}"})

    # —— 硬兜底生效（第一层）：best-effort 降级，而不是直接报错 ——
    summary = call_llm_with_retry(messages + [
        {"role": "user", "content": "步数用尽，请基于已有信息给出尽力而为的回答"}])
    return f"[未完成警告] {summary}"
```

### 易错点（面试官盯的就是这些）

- **工具异常直接 throw 出循环**——一票否决。异常必须变成 Observation 喂回去，这是
  ReAct"环境纠偏"的核心。
- **重复检测只比 tool name**：必须连参数一起 hash，否则 `search("A")` → `search("B")`
  会被误伤；反过来参数归一化也最好做（大小写、空白），否则 `search("a ")` 和
  `search("a")` 是两个指纹，防不住本质绕圈。
- **达到 max_steps 直接 return 报错**：正确姿势是给一次降级总结（best-effort），
  并明确标注"未完成"。
- **parse 失败就崩**：模型输出不合法是常态，当 Observation 返给模型让它自我纠正。
- **trace 只记在内存里不区分角色**：面试起码 append 到 list 并能逐条 print；
  提一句"生产上接 Langfuse / OpenTelemetry"直接加分。
- **schema 写死**：schema 应该跟随注册函数自动生成（装饰器里存），新增工具零改动 prompt。

### 面试官追问

- **工具重复调用怎么检测？** 答：对 `(tool_name, normalized_args)` 算指纹（canonical
  JSON + hash），指纹出现 N 次（实战设 2）就拦截并回喂"换思路"。更狠的做法把
  (规划状态, 观测摘要) 也做去重，抓"参数变了但本质在绕圈"的变体循环——这就是
  agent基础与规划.md 里"三层防护"的第二层，追问会顺到"为什么三层而非一层"。
- **超时重试为什么指数退避而不是固定间隔？** 固定间隔遇上服务雪崩会同步打挂下游（
  thundering herd），指数退避 + 上限次数降低重试风暴。可再补一句"生产上再加 jitter"。
- **tool 超时的线程安全 / 取消语义？** Python 侧一般用 thread pool + timeout，超时的
  线程未必真停了——答到这层（"超时只是放弃等待，任务还在跑，副作用工具要幂等"）
  就是老手。
- **多用户并发时 trace / seen 怎么隔离？** 每个会话一份状态，agent 循环要写成
  无共享的实例（本文的 `seen/trace/messages` 都是局部变量），别放全局。

## 题目二：升级——Function Calling JSON 模式版

▶ 真题：把上面的 ReAct 改写成严格 JSON 模式（model 每步输出单条 JSON），实现和上面同样的循环——**中**（Function Calling 配合必问）

口述解析（自然语言 tag）在模型输出长 Thought 后经常解析失败。JSON 模式让模型
每步只输出一个对象，解析便宜、程序友好：

````python
# 约定模型每步输出恰好一个 JSON 对象：
#   {"thought": "...", "action": {"tool": "...", "args": {...}}}
#   或  {"thought": "...", "final": "..."}

def parse_json_action(raw: str):
    """容忍模型在 JSON 外裹了废话/代码围栏，剥出第一个 {...} 再 parse"""
    text = raw.strip()
    if text.startswith("```"):                      # 剥 markdown 围栏
        text = text.strip("`").split("\n", 1)[1]
    start, depth = None, 0
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                return json.loads(text[start:i + 1])
    raise ValueError("LLM 输出中没有完整 JSON 对象")

# 循环主体与题目一相同，只是：
#   resp = parse_json_action(raw)
#   if "final" in resp: return resp["final"]
#   name, args = resp["action"]["tool"], resp["action"].get("args", {})
````

易错点就一个：**别假设输出是干净的一行 JSON 或 ```json 围栏**。剥围栏 + 括号配对
扫描是面试默写的通用防抖写法。追问："JSON 模式和原生 Function Calling API 的区别？"
——原生 API 由模型侧生成 token 时直接约束 schema（structured output），prompt 里
不用塞 schema 文本、坏格式率更低；JSON 模式只是约定，靠 prompt 自律。

## 题目三：上下文压缩 / 滑动窗口摘要手撕

▶ 真题：给定消息列表和 token 上限，决定哪些保留、哪些摘要、哪些卸载——**中，2026 新题**（应用岗；与"上下文工程是重灾区"的问答口径配套）

### 题意拆解

规则讲清楚再动手，面试时先说策略后写码：

1. **必须保留**：system prompt + 最近 K 轮（新鲜上下文不能动）。
2. **中段**：老消息按段落成摘要（调一次 LLM 或启发式裁剪），摘要里必须保留工具调用
   结论（"查到了 X"），不能只剩"我们讨论了几件事"这种废话。
3. **超长单条工具结果**：按行截断 / 卸载到外部存储，只留一句 "已存 ref://obs-13，
   必要时可用 recall 工具取回"（offload）。
4. token 计数面试里用近似（`len(text) // 4`），别真去 import tiktoken。

### 默写版代码

```python
def approx_tokens(text: str) -> int:
    """近似 token 数：中文 ~1 token/字，英文 ~4 字符/token，保守取 len/2"""
    return max(1, len(text) // 2)

def offload(content: str, max_chars: int = 200) -> str:
    """超长工具结果卸载：正文存外部（这里用 dict 模拟），上下文里只留引用"""
    if len(content) <= max_chars:
        return content
    ref_id = f"obs-{hash(content) & 0xFFFF:x}"
    STORE[ref_id] = content                    # 模拟外部存储
    return f"[结果过长已卸载，ref={ref_id}，可用 recall('{ref_id}') 取回]"

def compress_history(messages, budget: int, keep_recent: int = 3, summarize=None):
    """
    滑动窗口压缩。messages: [{"role":..., "content":...}]，budget: token 上限。
    返回新 messages：
      system 必留 -> 中段合成一条摘要 -> 最近 keep_recent 轮原样保留。
    summarize(prompt)->summary 为外部注入的 LLM 摘要函数；缺省用启发式裁剪。
    """
    if not messages:
        return messages
    system, rest = messages[:1], messages[1:]
    recent = rest[-keep_recent:] if len(rest) > keep_recent else []
    middle = rest[:-keep_recent] if len(rest) > keep_recent else []

    # 1. 超长单条先卸载（压缩永远从"最肥的"下手，性价比最高）
    recent = [{"role": m["role"], "content": offload(m["content"])} for m in recent]

    # 2. 中段摘要：重点保工具结论，丢过程废话
    if middle:
        digest = "\n".join(
            f"[{m['role']}] {m['content'][:500]}" for m in middle
        )
        if summarize:
            middle_text = summarize(
                "将以下轨迹浓缩为一段摘要，必须保留每个工具调用的最终结论与关键数值：\n"
                + digest)
        else:  # 失败兜底：启发式截断
            middle_text = digest[:2000]
        packed = ([system[0],
                   {"role": "system", "content": f"[历史摘要] {middle_text}"}]
                  + recent)
    else:
        packed = list(messages)

    # 3. 最后保险：仍超 budget 就从最老的非 system 消息开始丢
    def total(msgs):
        return sum(approx_tokens(m["content"]) for m in msgs)

    while len(packed) > 2 and total(packed) > budget:
        packed.pop(1)                          # packed[0] 是 system，从 1 开始丢
    return packed
```

### 面试官追问

- **压缩后的摘要失真怎么办？** 答三层：① 摘要 prompt 里强制保留工具最终结论和数值
  （别讲"模型会编"就完了）；② 摘要+原文双保险：摘要只当"目录"，关键 ref 可 recall
  回原文（对应题目的 offload 设计，也是最硬核的答法）；③ 实务上加"压缩前把关键
  中间结论落入 scratchpad / 记忆模块"，让关键事实不依赖单一摘要文本，参考
  [记忆与上下文工程](../../interview-questions/agent/记忆与上下文工程.md)。
- **摘要本身也会涨，怎么防无限膨胀？** 摘要参与下一轮再压缩（recursive summary），
  控制摘要本身占 budget 的比例（如不超过 20%）。
- **为什么先卸载超长单条再摘要，顺序能换吗？** 不能颠倒：卸载是 O(1) 的直接减重，
  摘要会调用 LLM、慢且可能再引入失真；先把"大头"卸掉，后续摘要面对的文本也更干净。
- **token 怎么精确计数？** 生产上 tiktoken / 各家 tokenizer；面试近似就明说"近似即可，
  保 budget 是'不许超'，不是'必须贴满'"。

---

*配套阅读：[agent基础与规划](../../interview-questions/agent/agent基础与规划.md)（TAO 循环与三层防护口径）、
[记忆与上下文工程](../../interview-questions/agent/记忆与上下文工程.md)、
[学习资源清单 · Tiny-Universe（Tiny Agent 参考实现）](../../resources/学习资源清单.md)*
