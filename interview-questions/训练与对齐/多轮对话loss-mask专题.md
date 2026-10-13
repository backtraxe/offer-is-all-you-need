# 多轮对话 loss mask 专题：SFT 到底在哪几个 token 上算 loss

> **面向**：知道 SFT 是「下一个 token 预测」、但说不清 loss 到底算在哪些
> 位置的读者。这是 SFT 面试里最容易被追穿的题——面试官不问「会不会」，
> 只问「EOS 和换行符算不算 loss」这一层。
>
> **读完获得**：① 三种 loss 构造方式的横向对比与各自代价；② 两套真实实现
> 的 mask 规则（happy-llm 第 5 章手写版、第 6 章 Qwen 风格版），含一条三轮
> 对话的逐 token 靶串；③ mask 与 shift 错位的自查方法；④ 6 道面试题答法。
>
> **口径说明**：实现细节取自 Datawhale happy-llm 第 5、6 章公开教程
> （CC BY-NC-SA 4.0），本文只借素材重新组织文字，文末标注来源；靶串为
> 本文自行构造，逐 token mask 已自验证。

## 一、为什么这是一道高频题

SFT 的标准说法人人会背：语言模型做下一个 token 预测，loss 是逐 token 的
交叉熵。面试官真正的问法是往下再追半句——

1. **追问一：loss 算在全部 token 上吗？** 如果算，那模型也在学着生成用户
   的话，这叫什么，代价是什么（第二节）。
2. **追问二：EOS 和轮次分隔的换行符算不算 loss？** 答错任何一半都会引出
   「那你的模型怎么学会停」的连环追（第四节）。
3. **追问三：labels 要 shift 一位，mask 打在 shift 之前还是之后？** 错位
   的后果是什么，怎么自查（第四节，Q4 给了答法模板）。

能精确回答到「哪几个 token 进 loss、哪个不出」的人，说明真的写过或读过
训练代码；只会背「mask 掉非 assistant 部分」的人，一追 shift 就露馅。这道
题本质是在考**训练数据从字符串到 loss 的最后一公里**。

## 二、三种构造方式对比

给定一条 N 轮对话（system + 交替的 user/assistant），loss 的算法有三派：

| 构造方式 | 做法 | 代价 |
| --- | --- | --- |
| 全序列算 loss | 整串（含 system、user 轮）全部计入交叉熵 | prompt 污染：模型在优化「生成用户的话」，监督信号错位，风格被带偏，有效算力浪费在非目标 token 上 |
| 只算最后一轮 assistant | 前面 N-1 轮只在上下文里，loss 只落在最后一条回复 | 丢信息：前面轮次的回复监督全丢；补救是把 N 轮拆成 N 条样本重复喂前缀，计算量直接翻 N 倍 |
| 单序列 mask（全轮 assistant） | 一条序列一次前向，mask 只放开每轮 assistant 的回复体与结束符 | 最优解：依赖 causal mask 保证每轮只看见前文、看不见未来轮次，一次前向拿到全部轮次的监督，前提是 mask 打准 |

第三派是生产标准做法，前两派各自是「教科书反面教材」和「偷懒但合法的单轮
特例」。面试里把三派摆出来对比，比直接背答案加分得多。

## 三、两套真实实现

### 手写版（happy-llm 第 5 章）

思路是「拼好整串再回头找标记」：

1. 用 `apply_chat_template` 把整段对话拼成一条 token 序列；
2. 滑窗扫描，定位每一个 `<|im_start|>assistant\n` 标记串的结束位置；
3. 从该位置开始置 mask=1，一直开到下一个 EOS（含 EOS 本身）为止；
4. 其余位置——system 段、user 段、每一轮的防伪头 `<|im_start|>user`——
   mask 全 0。

净效果：**只拟合 assistant 的回复体和 EOS，提示与轮次包装全部豁免**。实现
直白、不依赖模板内部布局；代价是依赖标记串在词表里确实是
「`<|im_start|>` + `assistant` + `\n`」这个拼法，换模板就得换定位串。

### Qwen 风格版（happy-llm 第 6 章）

思路是「逐轮构造时就同步生成 input 和 target 两条序列」：

- system / human 段：input 照常写入，target 整段填 IGNORE（-100）；
- assistant 段：input 写入完整轮次包装加回复，target 写成 `im_start` 标记位
  + IGNORE×角色元数据长度 + 回复正文 + `im_end` + `\n`。

净效果：**回复正文与 `im_end`、换行计入 loss，轮次包装符不计**。与手写版
殊途同归，差别在于 mask 在构造样本时天然产生，不需要事后扫串。

### 一条三轮对话的靶串

构造一条 system + 两轮对话，给出逐 token 的 target mask（1 = 计入 loss）：

```
段:   system      <|im_start|> system \n 你是助手 <|im_end|> \n
mask:  全 0         0         0    0    0      0     0

段:   user 轮 1   <|im_start|> user \n 你好 <|im_end|> \n
mask:  全 0         0        0   0   0      0     0

段:   asst 轮 1   <|im_start|> assistant \n 你好呀 <|im_end|> \n
mask:              0          0     0   1      1     1

段:   user 轮 2   <|im_start|> user \n 1加1等于几 <|im_end|> \n
mask:  全 0         0        0   0     0         0     0

段:   asst 轮 2   <|im_start|> assistant \n 等于2 <|im_end|> \n
mask:              0          0     0   1     1     1
```

检验口径：mask=1 的位置只有两类——assistant 的回复正文，以及每轮结尾的
`<|im_end|>` 加换行；其余全部为 0。把这个例子背到能在白板上默写，这道题
基本就拿下了。

## 四、工程细节与坑

1. **IGNORE 用 -100 的原因**：PyTorch 交叉熵的 `ignore_index` 默认就是
   -100，labels 里不参与的位置填 -100，框架自动跳过。这是框架约定不是
   数学必需，手写 loss 时对齐它即可。
2. **loss 归一化的正确分母**：逐 token loss 乘 mask 求和，再除以 mask 之和
   （有效 token 数），而不是除以序列长。除序列长等于把 mask 掉的位置当零
   梯度样本摊进去，变相调小 lr；且各样本有效长度不同，batch 间 loss 尺度
   不一致，曲线没法看。
3. **padding 位也必须一起 mask 掉**：batch 内补齐的 pad 位置，labels 置
   -100，否则模型在学「怎么生成 pad」。
4. **shift 与 mask 的对齐**：labels 是 input 右移一位——位置 t 的预测目标
   是 token t+1，所以 mask 必须打在 shift 之后的 target 空间。经典 bug 是
   先打 mask 再随 labels 一起 shift（或只 shift labels 忘了动 mask），错位
   一格。症状很有辨识度：loss 异常地低（连包装符都学进去了）或回复首 token
   始终学不会。自查三步：打印一个 batch 的 input、labels、mask 三行肉眼
   对齐；断言「每个 mask=1 位置的 label 必为回复正文或 `im_end`」；手算
   第一个 mask=1 位置的预测目标是否恰为回复首 token。

## 五、和 Agent 训练是同一思想

function calling / ReAct 轨迹数据里，环境返回的 observation（工具执行结果、
检索片段）是外界噪声，不是模型该学的话——同样靠 mask 排除在 loss 之外，只
拟合模型的思考与动作。RL 侧的 observation mask 是同一条思想的另一面（见
[agentic-rl前沿手法专题](./agentic-rl前沿手法专题.md)）：SFT 里不把环境内容
计入 loss，RL 里不把环境返回计入生成段。一句话：**模型只为自己说出口的话
负责**，这条原则在 SFT 与 RL 两侧各自成立。

## ▶ 面试题

**Q1：为什么 ignore 的位置填 -100 而不是别的数？**
因为 PyTorch 交叉熵的 `ignore_index` 默认值就是 -100，约定俗成不改任何
loss 代码即可生效。填别的值也能用但要显式传参；且 -100 远离任何合法
token id（非负），不会和真实标签撞车。

**Q2：EOS 和换行符算不算 loss？**
算，而且必须算。`<|im_end|>` 教模型在哪停——不学它，解码阶段模型不知道
何时收尾；轮次末尾的换行是协议的一部分，一起学保证输出格式稳定。反过来
`<|im_start|>` 和角色名不算：它们是给模型看的上下文标记，不是让它生成的
内容。一句话口径：**停在哪必须学，包装从哪开始不学**。

**Q3：只算最后一轮 assistant 为什么不充分？**
两条路都有显式代价：只训最后一条回复，前面 N-1 轮监督全丢，数据利用率
只有 1/N；想保住全部监督就得把 N 轮拆成 N 条样本重复携带前缀，前向计算
量翻 N 倍。单序列 mask 用一次前向拿到全部轮次监督，靠的是 causal mask
保证每轮只看见自己的前文。

**Q4：mask 和 shift 怎么对齐？错位了怎么自查？**
labels 右移一位，mask 落在 shift 之后的 target 空间：mask=1 表示「这个位置
要预测的标签是有效内容」。错位典型症状是 loss 反常地低或回复首 token 学
不到。自查：打印一个 batch 的 input、labels、mask 三行对齐；写断言要求
mask=1 处 label 必属回复正文或结束符；手算首个有效位置的目标 token。

**Q5：多卡训练做 packing 时 mask 怎么处理？**
loss mask 本身不用变——每条样本仍按各自规则打。真正要处理的是 attention：
必须用 block-diagonal（或 position_id 重置）把跨样本的注意力切断，否则样本
A 的回复会偷看样本 B 的内容。边界处样本首个 token 没有合法预测目标，
labels 置 -100 即可。

**Q6：全序列算 loss 的「prompt 污染」具体指什么？**
指损失函数在优化「生成 system 提示和用户发言」这件永远不该发生的事。后果
三层：监督信号错位（梯度花在非目标分布上）；风格被预测用户口吻的任务带偏；
有效算力被稀释——同一个 batch 里真正教模型「怎么回答」的 token 可能只占
三四成。

## 串联阅读

- [预训练与sft](./预训练与sft.md)：SFT 在训练流程中的位置总览。
- [经典rl地基专题](./经典rl地基专题.md)：从 SFT 走向 RLHF 的地基。
- [从零训练小模型实战专题](./从零训练小模型实战专题.md)：本篇规则在真实训练脚本里的落地形态。
- [rl训练工程实战](./rl训练工程实战.md)：RL 阶段的 loss 与 mask 工程。
- [agentic-rl前沿手法专题](./agentic-rl前沿手法专题.md)：observation mask 在 RL 侧的版本。
- [function调用训练专题](../agent/function-calling训练专题.md)：Agent 轨迹数据怎么构造。
- [手写transformer组件](../../coding/模型手撕/手写transformer组件.md)：手撕题里的 mask 写法。
- [高频面试真题汇总](../高频面试真题汇总.md)：本题在真题里的出现频次。

## 来源与致谢

- 实现素材取自 Datawhale **happy-llm 公开教程**第 5 章（手写对话 mask）与
  第 6 章（Qwen 风格逐轮构造），协议为 CC BY-NC-SA 4.0：
  https://github.com/datawhalechina/happy-llm
- 本文重新组织了全部文字与顺序，三轮靶串与面试题为本文原创构造，遵循
  原作的署名-非商业性使用-相同方式共享约定。
