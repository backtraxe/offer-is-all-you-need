# offer-is-all-you-need

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

## 仓库结构

```
├── basics/                 # 零基础入门：什么是大模型、Transformer 直观入门、数学/GPU 速通、术语词典
├── interview-experiences/  # 面经复盘：按公司/日期组织，含流程、题目、复盘
├── interview-questions/    # 高频考点：LLM、Agent、推理部署、分布式训练等
├── system-design/     # 系统设计：Agent/网关/推理服务/个人助理等场景设计题
├── coding/            # 手写题：transformer、attention、LRU 及各种 live coding
└── resources/         # 参考资料、书单、博客链接
```

## 使用说明

1. 零基础转行/刚接触大模型 → 先读 [basics/](basics/README.md)
   （什么是大模型 → Transformer 直观入门 → 数学/GPU 速通 → 术语词典，每篇附进阶指针）
2. 备战冲刺不知道从哪开始 → 再读 [resources/学习路线图.md](resources/学习路线图.md)
   （基于真实招聘 JD 调研的分层备战路线，附两份岗位 JD 分析和学习资源清单）
3. 高频考点入口 → [interview-questions/README.md](interview-questions/README.md)
   （考点地图 + 出现率 Top 20 + 各公司面试风格差异）
4. 其余按目录翻，每篇文档自成一体
5. 面经部分已脱敏，不保证 100% 还原现场
6. 八股不保证全对，以我拿到 offer 为准（验证方法：给我发 offer）

## Contribution

- 发现错误欢迎提 issue / PR
- 想分享你的面经也欢迎 PR，记得脱敏
- 想看某个方向的整理，开 issue 许愿

## License

MIT，拿走不谢。如果你能拿到 offer 回来告诉我一声，就是最好的回报。

---

*"Self-attention is all you need. 走错片场了。"*
