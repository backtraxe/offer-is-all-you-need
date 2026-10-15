# 线性层与 MLP 的 Profile 实战专题：epilogue、零 kernel op 与融合的边界

> 面向已经读过 [Attention 的 Profile 实战专题](./attention的profile实战专题.md)
> （SDPA 四后端，系列第三篇）的读者。本篇是它的姊妹篇、官方系列的第二
> 站：从 `nn.Linear` 到 GeGLU MLP 再到 Liger 手写 kernel，同样用
> 「先猜再看」法拆 profiler trace。读完获得：① **epilogue** 是什么、
> 为什么 bias 从不作为单独 kernel 出现；② 一张「**零 kernel op**」
> 名单（只改元数据的 op）；③ kernel 名当身份证的读法（`_tn_` 布局
> 后缀）；④ torch.compile 什么时候**完全没用**、什么时候真有用；
> ⑤ Liger 手写 kernel vs Inductor 自动生成 kernel 的**特化 vs 通用**
> 取舍（89.4 µs vs 92.8 µs 的诚实对比）。
>
> **口径声明**：案例与数字来自 PyTorch 官方 Profiling 系列教程（第二
> 篇，2026-10 转述），均为教程实测口径；不同 GPU/CUDA 版本上具体
> 数值会变，方法不变。

## 一、nn.Linear 的第一课：没有单独的 add kernel

`nn.Linear(bias=True)` 计算 `y = x @ w.T + b`。开 trace 前按第一篇的
经验猜：一个 matmul kernel + 一个 add kernel。**猜错了**——只有
一个 cuBLAS GEMM kernel。

原因链：`linear` 看到有 bias → dispatch `aten::addmm` → cuBLAS 的
GEMM kernel 自带 bias-add 变体，**偏置加在写回 HBM 前的最后一步顺手
完成**。这就是 **epilogue**：GEMM kernel 写回前做的小计算（加偏置、
套激活、乘常数），目的是省一整趟 HBM 读写。**访存贵，能挂在 epilogue
上的计算绝不单独 launch**——这和 attention 篇的「中间矩阵不写 HBM」
是同一条军规。

## 二、零 kernel op 名单：它们只在 CPU 上改 stride

Linear 的 CPU 道里 `aten::addmm` 前面挂一个 `aten::t`（转置权重）——
但 **GPU 道上它没有对应 kernel**，profiler 表里 CUDA 时间为 0。
`aten::t` 不复制也不重排一个数：tensor 在内存里是一串连续数，shape/
stride 是元数据；`M.t()` 返回的新 view 只是把 stride 互换，按行读
自然就走转置后的顺序。**被迫物化的时候才会搬数据**（比如 `flatten()`）。

一张可以背的「零 kernel op」名单（全部只改元数据，CUDA 时间恒 0）：

`aten::t`、`aten::transpose`、`aten::reshape`、`aten::view`、
`aten::as_strided`、`aten::_unsafe_view`——扫 profiler 表时，
每个 linear 会冒出六个 op 名，真到 GPU 的只有 `mm` 那一个。

追问链：编译版 Linear 删掉的是什么？**不是 GPU kernel，是 CPU 的 view
记账开销**——Inductor 在编译时追完 view 链、算死 stride，直接发
`aten::addmm` 并把 stride 硬编码。GPU 算的数逐字节一样，CPU 省几
微秒。预期管理：`--compile` 对**单个带 bias 的 Linear 几乎零收益**
（没有可融合的对象，kernel 名都不变）——「模型一慢就 torch.compile」
是这个系列点名的坏反射。

## 三、kernel 名是身份证：后缀读法

eager 和编译两次跑的是同一个
`cutlass_80_wmma_tensorop_bf16_s161616gemm_bf16_32x32_32x1_tn_align8`。
没跑转置 kernel，GEMM 凭什么按转置顺序读权重？答案在后缀 `_tn_`：

- cuBLAS/CUTLASS 给每种**输入布局组合**预编译单独的二进制：`n`
  （不转置）和 `t`（转置）描述 kernel 内层循环怎么走输入；
- dispatcher 看输入 stride 决定后缀组合，挑对应预编译 kernel。

军规：**kernel 名 = kernel 身份的哈希**——两次 trace 里名字一样，
GPU 干的活就一样；不一样（`_tn_` vs `_nn_`、bf16 vs fp16、s16816 vs
sgemm），干的活就不一样，dispatcher 走了不同分支。比 trace 第一
习惯就是先扫名字。（结合 attention 篇的 s16816/sgemm/cutlassF 指纹，
指纹库就齐了。）

## 四、MLP 的 eager 五 kernel 与两个小细节

GeGLU MLP（gate_proj/up_proj/down_proj + gelu + mul）eager 每
forward 正好 **5 个 GPU kernel**——和预测完全对上（先猜再看的重要
性再次兑现）。两个值得记的细节：

1. **GEMM 前先问 occupancy**：三次 GEMM 每次 launch 前都有
   `cudaOccupancyMaxActiveBlocksPerMultiprocessor`——cuBLAS 在定
   grid；pointwise 的 GeLU/mul 直接 launch 不查询。所以 CPU 道里
   「一个 linear = 查询 + launch」，「一个 pointwise = 只有 launch」。
2. **同 FLOP 不同 tile，速度差约一成**：gate/up 都是
   [8192,768]×[768,3072]，用 `128x128…stages_32x5_tn`（0.19 ms）；
   down 是 [8192,3072]×[3072,768]，FLOP 完全相同（≈38.7 GFLOP），
   但 cuBLAS 选了 `128x256…stages_64x3_tn`（0.17 ms）——**形状不同
   则 tile 复用不同，同样的活快出一成**。这也解释了 profiler 表里
   为什么有两行 GEMM：一行是 gate+up，一行是 down。

## 五、compile 真正干的事：塌链 + 融合，中间量不出 HBM

编译 MLP 后 trace 两个变化：

1. **dispatcher 链塌缩**：eager 里每个 linear 展开成
   `aten::linear → t → transpose → matmul → reshape → mm` 的高层
   wrapper 链；编译图里只剩光秃秃的 `aten::mm` 外部调用，元数据 op
   全折进调用方式。
2. **pointwise 融合**：GeLU + mul + reshape 塌成一个 kernel——
   `triton_poi_fused__unsafe_view_gelu_mul_0`。

名字也要会拆：`triton`（Inductor 的 Triton 后端生成）、`poi`
（pointwise；reduction 标 `red`、persistent reduction 标 `per`）、
`fused_<op列表>`（合并了哪些）、数字（图内唯一 id）。

**收益账**（面试可直接背）：eager 里中间量 `h = gelu(g)` 是完整的
[8192,3072] bf16 tensor（约 50 MB）——GeLU kernel 写进 HBM，mul
kernel 紧接着读回来；**融合后 h 留在寄存器里**，Triton kernel 读
一次 g 和 u、算 `gelu(g)*u`、写一次结果，省掉一整趟 HBM 往返。
而 3 个 GEMM 纹丝不动（名字逐字节相同）——**compile 动的是
pointwise 和 glue code，GEMM 主体它碰不了**。

## 六、Liger 手写 kernel vs Inductor：特化与通用的诚实对比

第三条路线：人类专家手写 kernel，经 `kernels` 库交付
（`get_kernel("kernels-community/liger-kernels", version=1)`——
预构建、版本锁定、Hub 下载二进制，免去本地缺 nvcc/Triton 版本不对
的构建地狱）。`LigerGEGLUMLP` 一遍算完 `gelu(gate)*up`
（`_geglu_tanh_forward_kernel`），和 compile 的融合同思路，但：

- **没有 Dynamo guard、没有编译延迟、没有重编译风险**；
- launch 参数按硬件调过（按列数选 block）。

数字要诚实看：**Liger 92.8 µs vs Inductor 融合 kernel 89.4 µs**——
手写看似还慢一点。但这不是公平的对比：Inductor 的 89.4 µs 是
**为 [8192,3072] 这一个形状现特化的**；batch/seq/hidden 一变，
Dynamo 重新 trace、编译成本重付、才拿到新特化 kernel。所以真正的
选择不是「慢的手写 kernel vs 快的编译 kernel」，而是**「一个什么
形状都跑、不重编译的通用快 kernel」对「一个为单一形状特化的
kernel」**——放弃按形状特化抠出的最后几微秒，换形状变化时的
稳健。线上形状多变的场景（Serving、业务量波动），这个 trade 经常
值得做。

## 七、四行总表（面试白板复写用）

| 配置 | 改了什么 | 没变什么 |
|---|---|---|
| Eager nn.Linear | bias 已折进 GEMM epilogue（addmm），单 kernel | — |
| 编译 nn.Linear | CPU 几个 view 记账 op 消失 | 同一个 cuBLAS kernel，逐字节不变——**没有可融的对象** |
| Eager MLP | 5 kernel：3 GEMM + GeLU + mul；中间量完整走 HBM 往返 | GEMM 与独立 linear 相同 |
| 编译 MLP | GeLU+mul+reshape → 一个 `triton_poi_fused_*`；h 留寄存器 | 3 个 GEMM 纹丝不动 |
| Liger MLP | 同样融合但内置手写；无 Dynamo/guard/编译延迟；launch 参数按硬件调 | 3 个 GEMM 仍相同 |

## 八、▶ 面试题与追问

**Q1【高】为什么 profiler 里看不到 bias 的 add kernel？**
因为它被折进 GEMM kernel 的 epilogue：`nn.Linear` 带 bias 时
dispatch 到 `aten::addmm`，cuBLAS 在写回 HBM 前顺手加偏置。判定
方法：CPU 道没有 `aten::add`、GPU 道只有一个 cuBLAS GEMM kernel。
这是访存优化的通用模式——能挂 epilogue 的计算绝不单独 launch。

**Q2【高】哪些 op 在 GPU 上不产生 kernel？为什么？**
元数据 op：`t/transpose/reshape/view/as_strided/_unsafe_view`——
它们只改 shape/stride，不碰数据（CUDA 时间恒 0、GPU 道无活动）。
**数据真正被搬是物化时**（flatten、连续化要求、layout 转换 kernel）。
torch.compile 的收益之一就是把这串 CPU 记账预先折掉。

**Q3【中高】torch.compile 什么时候不值得开？**
单个已经融合良好的 op（比如带 bias 的 Linear——epilogue 早融了）
没有可融对象，compile 零收益还白付 guard 开销；compile 的主战场
是 pointwise 链与 glue code（本例 MLP 的 GeLU+mul+reshape），GEMM
主体它不会替你优化。

**Q4【中高】中间量留在寄存器省多少？怎么算这笔账？**
按「中间量字节数 × 2（写一次读一次）」估 HBM 往返：[8192,3072]
bf16 ≈ 50 MB × 2 = 100 MB 的 HBM 流量被消掉；除以有效带宽就是
省下的时间量级。这正是「融合」二字的全部含义——**中间张量的
物化与回收才是开销，数学没变**。

**Q5【中】手写 kernel 比 Inductor 生成的还慢，为什么有人用？**
89.4 µs 是对单一形状特化的价格：形状一变要重编译（Dynamo guard
失败 → 重新 trace → 新特化）。手写通用 kernel（Liger）92.8 µs 换
的是**任意形状即插即用、零编译延迟、零重编译风险**。形状稳定的
训练循环吃特化；形状多变的 serving 侧吃通用。

**Q6【中】kernel 名里能读出哪些信息？**
来源（cutlass/cuBLAS vs triton）、数据类型与指令集（bf16）、tile
与流水线（32x32/128x256、stages_64x3）、输入布局（_tn_）、生成器
与合并清单（triton_poi_fused_<ops>_<id>）。两次 trace 名字逐字节
相同 = GPU 干的活相同；名字不同先查 dispatcher 走了哪条分支。

## 九、串联阅读

- [torch.profiler 入门实战专题](./torch-profiler入门实战专题.md)：
  系列第一篇（两个产物/三个侦探案例/速查表），本篇的 dispatch 与
  compile 知识是它的升级版；
- [Attention 的 Profile 实战专题](./attention的profile实战专题.md)：
  系列第三篇（SDPA 四后端+kenerl 指纹），本篇是第二篇（MLP 层），
  连读即完整课程；
- [CUDA 与 Kernel 专题](./cuda与kernel专题.md)：GEMM tile、epilogue
  与融合判据的原理侧；
- [AI 编译器与 torch.compile 专题](./ai编译器与torch-compile专题.md)：
  Dynamo/Inductor 的内部构造，本篇第六节是它的实测案例；
- [Profiling 与性能分析专题](./profiling与性能分析专题.md)：工具链
  与 schedule（wait/warmup/active）设置。

## 口径与未核实说明

- 全部耗时数字（0.19/0.17 ms、89.4/92.8 µs）与 kernel 名、op 行为
  （occupancy 查询、零 kernel op、epilogue 选择）为官方教程实测
  口径；不同 GPU/CUDA/驱动版本上绝对值会变。
- 「单个 Linear compile 零收益」是教程在当前 PyTorch 默认路径上的
  结论，自定义后端（如 Inductor max-autotune）会另有 GEMM 特化，
  面试时按「默认路径无收益」答并给出条件。
