# offer-is-all-you-need

[![GitHub stars](https://img.shields.io/github/stars/backtraxe/offer-is-all-you-need?style=flat-square)](https://github.com/backtraxe/offer-is-all-you-need/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/backtraxe/offer-is-all-you-need?style=flat-square)](https://github.com/backtraxe/offer-is-all-you-need/network/members)
[![在线文档](https://img.shields.io/badge/docs-GitHub%20Pages-blue?style=flat-square)](https://backtraxe.github.io/offer-is-all-you-need/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

> Attention 买不到 offer，但这个 repo 可以。

**摘要**：We propose a simple but effective repository, `offer-is-all-you-need`,
based solely on 面试经验，dispensing with 运气 and 玄学 entirely.
Experiments show that it achieves SOTA performance on the "拿 offer" benchmark.

📖 **在线文档站**：[backtraxe.github.io/offer-is-all-you-need](https://backtraxe.github.io/offer-is-all-you-need/)
（GitHub Pages + docsify 渲染，含侧边栏导航、全文搜索；架构图全为可缩放
交互大图，见 `assets/diagrams/`；仓库根目录 `index.html` + `_sidebar.md` 即站点配置）

---

## 这是什么

Agent 开发与 AI Infra 方向的面试备战仓库，记录我在求职季的面经、八股整理、
系统设计笔记和 coding 真题。持续更新，直到上岸为止（上岸之后看心情更不更）。

**本仓库的两种读法**：

1. **当课程读（有重点）**——侧边栏顶部「★ 必读主线」是约 15 篇的正文（分
   Agent 线 / Infra 线，按序），配 [学习路线图](resources/学习路线图.md)
   的 12 周日历推进，每周干什么写得很死。
2. **当词典查（不怕散）**——其余 100+ 篇是按需查阅的专题库。查知识点用
   [interview-questions/README](interview-questions/README.md) 的
   「五列关联总索引」（知识点→考频→专题→手撕→面经案例），查考题用
   [高频面试真题汇总](interview-questions/高频面试真题汇总.md)，查公司风格用
   [面经合集速查表](interview-experiences/小红书社招面经合集-2026h2.md)。

「散」是设计如此：面试前夜你要的是 5 分钟定位到一家公司的一类题，
不是一门顺序课。但主线永远只有一条，先把 ★ 啃完再谈查漏补缺。

## 刷完你能得到什么

- 高频考点成体系——从「什么是大模型」到 PD 分离、GRPO、显存公式
  手撕，约 15 篇主线 + 100 余篇词典式专题，知道 how 也知道 why。
- 22 家公司的出题信号——面经合集主信号总表里，每家公司考什么、
  怎么追问都有实据（多帖互证、标注口径）。
- 一套可执行的行动系统——12 周日历、投递策略、模拟面试模考卷、
  挂后复盘四步法，不只管「学什么」也管「怎么上岸」。
- 面试感的手撕能力——coding 篇按真实考频排序，GRPO Loss、
  蒸馏 KL、KV 显存公式都有从零手推版。

## 最近更新

- 2026-10-14：面经合集二十三节（蚂蚁 Agent 压力面 35 题/字节 Agent 一面 22 题/
  小红书 Harness 18 题/抖音字节三轮 30 题/Momenta 训练优化二面），
  主信号总表并入 13 条新信号；zero 篇补「梯度累积 × ZeRO 通信量」手算
- 2026-10：备战总路线图交互大图（12 周行动线 × Agent/Infra 双主线）
- 2026-10：系统化收口——学习路线图变双轨总入口，五信号表合并为主信号总表
- 2026-10：求职操作四件套（投递与 offer 实战 / 模拟面试 / 挂后复盘 / 12 周日历）
- 2026-10：coding 新题型 3 篇（GRPO Loss / 蒸馏 KL / KV 显存公式）+ 刷题频次映射表
- 更早：vLLM/SGLang 源码全链路、对比专题（vLLM vs SGLang、MoE vs Dense、MCP vs 工具）等

## 仓库结构

```
├── basics/                 # 零基础入门：什么是大模型、Transformer、数学/GPU 速通、术语词典、训练与推理第一印象
├── projects/               # 项目篇章：可面试的 GitHub 项目选型、增量改造与 benchmark 解读
├── resume/                 # 简历篇章：骨架/量化公式/防造假三问、GitHub 模板盘点、分方向范文
├── interview-experiences/  # 面经复盘：按公司/日期组织，含流程、题目、复盘
├── interview-questions/    # 高频考点：LLM、Agent、推理部署、分布式训练等
├── system-design/     # 系统设计：Agent/网关/推理服务/个人助理等场景设计题
├── coding/            # 手写题：transformer、attention、LRU 及各种 live coding
└── resources/         # 参考资料、书单、博客链接
```

## 使用说明

1. 零基础转行/刚接触大模型 → 先读 [basics/](basics/README.md)
   （7 篇连读：概念 → Transformer → 数学/GPU → 术语 → 训练三段 → 推理部署，每篇附进阶指针）
2. 备战冲刺不知道从哪开始 → 再读 [resources/学习路线图.md](resources/学习路线图.md)
   （基于真实招聘 JD 调研的分层备战路线，附两份岗位 JD 分析和学习资源清单）
3. 高频考点入口 → [interview-questions/README.md](interview-questions/README.md)
   （考点地图 + 出现率 Top 20 + 各公司面试风格差异）
4. 没项目/项目讲不深 → [projects/](projects/README.md)
   （GitHub 项目选型总表、防烂大街法则、逐方向的增量改造与面试追问预演）
5. 简历被秒挂/不会量化 → [resume/](resume/README.md)
   （60s 初筛漏斗、4 段式与量化句式库、防造假三问、GitHub 模板/工具盘点、分方向范文）
6. 会考试但不会找工作 →
   [resources/投递与offer实战.md](resources/投递与offer实战.md)（时间线/渠道/面评管理/谈判）
   → [resources/模拟面试与口语化表达.md](resources/模拟面试与口语化表达.md)（四拍答案+两套模考卷）
   → [resources/挂后复盘四步法.md](resources/挂后复盘四步法.md)
7. 其余按目录翻，每篇文档自成一体
8. 面经部分已脱敏，不保证 100% 还原现场
9. 八股不保证全对，以我拿到 offer 为准（验证方法：给我发 offer）

## Contribution

- 发现错误欢迎提 issue / PR，会尽快回复（勘误比面子重要）
- 想分享你的面经也欢迎 PR，记得脱敏；整理得好的我会并进面经合集并署名来源
- 想看某个方向的整理，开 issue 许愿
- 排版注意（踩过坑）：本站点 docsify@4 的 marked 不认「粗体以 ASCII 标点（`%`
  `)` `/`）结尾、闭合 `**` 后紧跟 CJK 文字/全角标点」的写法——会漏渲染甚至把
  `**` 打进正文。遇到这种情况把后面的全角标点收进粗体里（`**50%，**`
  正常 / `**50%**，` 报错）。闭合 `**` 后是空格、ASCII 标点或行尾则安全。

## License

MIT，拿走不谢。如果你能拿到 offer 回来告诉我一声，就是最好的回报。

---

*"Self-attention is all you need. 走错片场了。"*
