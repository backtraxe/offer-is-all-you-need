# Muon 与新优化器：从二阶矩到矩阵正交化

> 训练与对齐模块第四篇。AdamW 逐坐标缩放学习率，Muon 则把整个动量矩阵
> 「正交化」——让所有奇异方向获得同等步长。Kimi K2 用 Muon 全程训练了
> 1T 参数模型（15.5T token、全程无 loss spike），Moonshot 的 Moonlight
> 补完了规模化配方，Muon 已经成为 infra / 算法岗的新考点。本文按 动机 →
> 原理 → 工程配方 → MuonClip → 谱系定位 → 追问 的顺序展开，题目标注参考
> [高频面试真题汇总](../高频面试真题汇总.md)。

## 一、动机：AdamW 的三个软肋

▶ 面试题：Adam 有什么问题，为什么 2025 年开始聊新优化器？——**新兴高频**
（Kimi 系 / infra 岗）

Adam(W) 统治深度学习优化器十年，但在万亿参数规模上，三个软肋越来越贵：

1. **优化器状态翻倍**：Adam 要为一阶动量 $m$ 和二阶矩 $v$ 各存一份
   （通常 FP32）——参数量 $\Psi$ 对应额外 $8\Psi$ 字节优化器显存；
   分布式下这部分状态同样参与分片与通信，ZeRO-1 的存在本身就是为切掉它。
2. **逐坐标缩放，没有矩阵视野**：Adam 的更新是 $g/\sqrt{v+\epsilon}$，
   逐元素自适应缩放。好处是不怕个别坐标爆炸；代价是对权重矩阵**毫无
   几何理解**——一旦奇异值谱坏条件（少数主方向 dominate），逐坐标缩放
   任由这几个方向主导更新，其余大多数奇异方向的步长被压得极小。
3. **逐层 lr 玄学**：各层参数尺度差异大，per-coordinate 归一并不消除
   层间 RMS 差，工程上要靠逐层调参、逐层 warmup 续命。

Muon 的思路是把第 2、3 条一起掀掉：不再逐坐标讨价还价，而是对更新矩阵
本身做一次「几何整流」。

## 二、Muon 原理：把动量矩阵旋正

▶ 面试题：Muon 的更新怎么算？Newton-Schulz 迭代是什么？——**新兴高频**

### 直觉

一句话：**不再问"每个坐标走多大"，而是问"整个矩阵更新往哪个方向最值"**。
对一个 $n\times m$ 的权重矩阵，取其动量矩阵 $M$，求离它最近的半正交
矩阵——SVD 分解 $M=U\Sigma V^\top$ 下答案就是 $UV^\top$——用它当更新
方向。效果等价于**把所有奇异值一口气拉到 1**：谱里不管原来多大、多小的
方向，获得完全相同的步长，"大方向通吃、小方向挨饿"的系统性偏袒消失。

### 算法三步

1. **动量累积**（带 Nesterov 修正）：
   $B_t \leftarrow \mu B_{t-1} + G_t$，代入时用 $M_t \leftarrow G_t + \mu B_t$。
2. **Newton-Schulz 迭代逼近半正交化**：先归一化 $X_0 = M_t/\lVert M_t \rVert_F$
   把谱压进工作区间，然后迭代 5 次：

$$X \leftarrow aX + b\,X(XX^\top) + c\,X(XX^\top)^2,\qquad (a,b,c)=(3.4445,\,-4.7750,\,2.0315)$$

   迭代收敛到 $UV^\top$。这组系数按"最大化把初始奇异值谱一步推平的斜率"
   调过，所以 5 步就够用。整个迭代只是 **5 次矩阵乘法**，直接以 bfloat16
   在 GPU 上跑，成本 < 1% 的前反向训练步——这就是不用精确 SVD 的工程
   理由：精确 SVD 贵、往往要搬出 GPU、对 $10^4\times 10^4$ 量级矩阵无法
   承受，而 NS 五次 matmul 便宜到可以忽略。
3. **更新**：$W \leftarrow W - \eta\cdot O$，其中 $O=\mathrm{NS}(M_t)$
   （规模化后还要乘维度缩放、加 weight decay，见第三节）。

<div class="diagram-embed">
<iframe src="assets/diagrams/muon-update.html" width="100%" height="940" style="border:none;border-radius:12px" loading="lazy"></iframe>
<p><a href="assets/diagrams/muon-update.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
</div>

### 理论定位

Muon 是**谱范数（spectral norm）约束下的最速下降**：在"更新矩阵的谱范数
有界"这一约束下最大化损失的一阶下降量，解恰好是 $UV^\top$。从 modular
norm 的视角看，各层参数的"正确"几何各不相同——矩阵层天然该用谱范数
而不是逐坐标的欧氏范数。所以 Muon 不是拍脑袋的启发式，而是给矩阵参数
**换了一种度量**。

## 三、工程配方：白名单 + Moonlight 三件套

▶ 面试题：哪些参数交给 Muon？分布式训练时怎么用？——**新兴高频**

### 适用范围白名单

Muon 的数学对象是**矩阵变换**，所以只替换 2D 权重矩阵——attention 的
Q/K/V/O 投影、FFN 或 MoE expert 的 up/gate/down。以下参数继续 AdamW：

| 参数类型 | 留在 AdamW 的原因 |
|---|---|
| embedding / LM head | 每一行是独立 token 的查表行，不构成"一个变换"，正交化没有意义；且更新极其稀疏 |
| norm / bias / 标量门 | 1D/0D 参数，没有矩阵结构可言 |
| 其他保守项 | 配方上可再按 ablation 缩小白名单 |

### Moonlight 规模化三件套

原生 Muon 直接放大到百亿规模会翻车，Moonshot 的 Moonlight（16B MoE）
把配方补齐成三件：

1. **加 weight decay**：规模一大，谱均匀化的更新会把权重谱整体顶大，
   训到后半段 logits 失控；并入标准解耦 wd 把谱按住（与 AdamW 一致）。
2. **lr 按维度缩放**：每个矩阵乘 $0.2\sqrt{\max(fan_{in},fan_{out})}$
   量级系数，使 Muon 更新的 RMS 对齐 AdamW 典型更新 RMS（≈0.2）。附带
   的好处：lr、wd 等超参可以直接沿用 AdamW 调好的那套，迁移成本几乎为零。
3. **分布式：Newton-Schulz 需要完整矩阵**。NS 迭代是密集矩阵乘法，输入
   必须是完整的动量矩阵——这与 ZeRO-3 / FSDP 把参数切碎天然冲突。工程
   处理：切的是**存储**，优化器 step 前按层 AllGather 把动量重建出来
   （或在切分方案上保证单卡能拿到完整矩阵），算完 NS 再分回去；多出的
   一次汇聚通信被 NS 的低成本整体吸收。

### 显存 / 通信收益

正交化提供了"方向"，步长统一交给 lr 负责，Muon **只存一份动量状态、
没有二阶矩**——优化器显存从 Adam 的 $8\Psi$（FP32 m+v）降到 $4\Psi$，
省一半；分布式下优化器状态的通信与分片压力同步减半。叠加 NS 迭代 <1%
的计算开销，Muon 是少见的"效果不输、状态减半"的免费改进。

## 四、MuonClip：Kimi K2 的关键补丁

▶ 面试题：MuonClip 在治什么病？——**新八股**（Kimi 系必问）

规模继续放大还有一个坑：长训到十万亿 token 量级，**attention logits
开始爆炸**——Q、K 投影的谱范数一起稳步上涨（wd 能按住谱，但压不住
全部方向），$QK^\top/\sqrt{d}$ 顶进 softmax 饱和区，梯度消失、loss
震荡，再训下去直接发散。Muon 把 Q/K 各方向"同速长跑"，这个问题比
AdamW 下更醒目。

MuonClip（K2 tech report 里的 qk-clip）对症下刀：**在线监控每层最大的
attention logit，一旦越阈，就把该层 Q、K 投影的权重按比例 rescale
（按头缩谱范数）**，把 logits 拉回工作区后训练继续。它只动权重谱、
不改 forward 语义，是纯训练期的优化器动作。

对比 QK-Norm 一句话：QK-Norm 在 forward 里对 q、k 向量做归一化，**改了
模型结构**，推理时算子也随之改变；MuonClip 不动结构，等效于给 QK 矩阵
装了个随训练在线调节的"谱刹车"。背书来自 K2 tech report：1T 参数 ×
15.5T token 全程训练无 loss spike，MuonClip 是关键稳定件之一。

## 五、谱系定位：Shampoo/SOAP vs Muon

▶ 面试题：Muon 和 Shampoo 什么关系？为什么 2025 年赢的是 Muon？
——**中频深挖**

谱系上 Muon 属于"**跳出逐坐标度量**"家族，与二阶预条件方法同源：

| 维度 | AdamW | Shampoo / SOAP | Muon |
|---|---|---|---|
| 预条件 | 逐坐标二阶矩 | 全矩阵预条件（Kronecker 因子 + 开方/分解） | 动量矩阵半正交化 |
| 优化器状态 | 2× 参数量 | 更大（因子矩阵） | **1× 参数量（减半）** |
| 单步开销 | ≈0 | 显著（eig/开方） | **< 1% 训练步**（5 次 bf16 matmul） |
| 定位 | 基线 | 严谨的二阶方法，重 | 便宜的几何修正 |

共同点：都不再逐坐标讨价还价，转而给更新施加矩阵级几何。差别在意愿：
Shampoo/SOAP 老老实实维护二阶预条件因子，严谨但状态与分解成本高；
Muon 干脆不建模曲率，直接用 NS 迭代把更新方向"旋正"——理论上是谱范数
约束下的最速下降，工程上只是 5 次 matmul。可以把它理解为"Kronecker
预条件的极简替身"。

2025 年 Muon 赢下这一局，原因一句话：**效果 ≈ 或优于精调 AdamW、单步
成本可忽略、优化器状态减半，还有 Kimi K2 全程 1T 参数训练的背书**——
infra 侧和算法侧都没有拒绝它的理由。

## 六、▶ 面试追问

1. **Muon 为什么省显存？**——Adam 的优化器状态是一阶动量 $m$ 加二阶矩
   $v$ 各一份（FP32 时 8 字节/参数）；Muon 的更新方向由动量矩阵正交化
   给出（$UV^\top$），步长交给全局 lr + 维度缩放，不需要逐坐标方差，
   **只存一份动量**（FP32 时 4 字节/参数）——优化器显存省一半，分布式
   下这部分状态的通信与分片成本同步减半。
2. **Newton-Schulz 为什么 5 步就够？**——输入先按 $\lVert M\rVert_F$
   归一化把谱压进工作区间，迭代本身是 quintic 型、收敛极快，系数
   (3.4445, −4.7750, 2.0315) 又按"最大化首步推平斜率"调过；5 次迭代后
   奇异值已足够接近 1。注意目标是拿到**均匀的更新方向**，不是数值收敛
   证明——5 次 bf16 matmul 成本 <1% 训练步，足够便宜，无需更精。
3. **哪些层不能用 Muon？**——先讲原则：Muon 的数学对象是"矩阵变换"，
   所以白名单只含 2D 权重矩阵（Q/K/V/O 投影、FFN/MoE 的 up/gate/down）。
   三条边界：embedding / LM head 是稀疏查表行、不构成变换；norm、bias、
   标量门没有矩阵结构；保守配方还可按 ablation 再收缩。这三类全部留
   在 AdamW。
4. **MuonClip 在治什么？**——长训中 Q、K 投影谱范数持续上涨 →
   attention logits 爆炸 → softmax 饱和、梯度消失、loss 震荡。MuonClip
   在线监控每层最大 logit，越阈就把该层 Q/K 权重按比例 rescale 回安全
   区。它是纯训练期的谱范数 clip，不改 forward 语义——这点是它和
   QK-Norm（改模型结构）的核心区别。
5. **Muon 和 Shampoo 什么关系？**——同一家族、诚意不同：都要跳出
   逐坐标度量、施加矩阵级几何。Shampoo 维护真正的二阶预条件因子
   （严谨但重），Muon 用 5 次 matmul 直接正交化动量矩阵（轻、近似），
   观感上是"Kronecker 预条件的极简版"。2025 年 Muon 靠 效果 ≈ 或 > 
   AdamW + 成本可忽略 + 状态减半 + K2 背书 跑赢了严谨派。

## 七、延伸阅读

- KellerJordan/Muon 原 repo：*Muon: An optimizer for hidden layers in
  neural networks*（nanoGPT 竞速出身，2024 社区走红起点）
- Moonshot *Muon is Scalable for LLM Training*（Moonlight，2025.02——
  规模化三件套出处）
- *Kimi K2 技术报告*（2025.07——MuonClip / qk-clip 与 1T 参数全程
  Muon 训练的工程记录）
- 苏剑林 kexue.fm 的 Muon 系列博客（Newton-Schulz、谱范数视角、与
  Shampoo 关系的中文推导线）

---

*同模块阅读：[预训练与 sft](./预训练与sft.md) ·
[lora 与参数高效微调](./lora与参数高效微调.md) ·
[rlhf 与对齐](./rlhf与对齐.md) · 上一页 [模块导航](../README.md)*
