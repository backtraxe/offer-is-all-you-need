# assets/diagrams — Archify 交互大图生产手册

本目录下全部 HTML 由 [archify skill](https://github.com/tt-a1i/archify)（本地装于 `~/.kimi-code/skills/archify`）产出，
替代了原先的 mermaid 图。每张图可缩放、悬停看注释、切暗色、导出 PNG/SVG。

**改图流程：改 candidate.json → 重跑 finalize → 覆盖本目录 HTML。永远不要在 md 里重新写 mermaid（全仓库已清零，保持为 0）。**

## 快速开始

```bash
# 1. 建候选目录
mkdir .archify/workflow-<slug>-$(date +%Y%m%d-%H%M%S)

# 2. 写 candidate.json（meta.output 指向同目录 <slug>.html）

# 3. finalize（四道门：validate → deliver → check → browser-check 全过才算完）
node ~/.kimi-code/skills/archify/bin/archify.mjs finalize \
  <type> <dir>/candidate.json <dir>/<slug>.html \
  --quality showcase --out-dir <dir>/review-N --json
# 重跑必须换 --out-dir（review-1 → review-2 → …）

# 4. 通过后
cp <dir>/<slug>.html assets/diagrams/

# 5. 必做：headless Chrome 截图目检
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=10000 --window-size=1440,1050 --hide-scrollbars \
  --screenshot=/tmp/chk-<slug>.png "file://$PWD/assets/diagrams/<slug>.html"

# 6. md 中嵌入（iframe src 必须是站点根相对 assets/diagrams/…，不要 ../）
# <div class="diagram-embed">
# <iframe src="assets/diagrams/<slug>.html" width="100%" height="<H>" style="border:none;border-radius:12px" loading="lazy"></iframe>
# <p><a href="assets/diagrams/<slug>.html" target="_blank" rel="noopener">↗ 交互大图：新窗口打开（可缩放、悬停看注释、切暗色、导出 PNG/SVG）</a></p>
# </div>
# H ≈ finalize 产物实际高度 + 90~110（2 泳道 ~700、3~4 泳道 ~800-940、sequence ~860）

# 7. 收尾验证
grep -rc '```mermaid' --include='*.md' .   # 应全为 0
python3 -m http.server 8899 &              # 抽一页 docsify 站点截图后 kill
```

类型选择：时序/调用链 `sequence`；状态机 `lifecycle`；其他全部 `workflow`。locale 一律 `zh-CN`，quality 一般 `showcase`。
candidate 目录可参照任一 `.archify/*/candidate.json`（该目录已 gitignore）。

## 硬性约束（撞过才写，条条有代价）

| 约束 | 数值 / 规则 | 解法 |
|---|---|---|
| viewBox 宽上限 | ≈ **1240px**（非硬编码：desktop-readability 按 930px 默认阅读宽度投影，最小源字号 8px 投影后不得 < 6px，8×930/6=1240） | 首选缩 **sublabel 文本**（宽度按文本实测撑开）；砍宽度要砍「**该列/跨泳道的最大节点**」，砍非最大节点无效；长文本挪进 cards |
| 宽高比 | 无显式 viewBox 时 w/h ≥ **1.55** | 加宽每列最大节点；或显式 `meta.viewBox`（值必须 ≥ render 命令实测最小容量，宜先用 render 探一次） |
| workflow 列数 | col ≤ **5**（6 列注定超宽） | 长链两行包行，包行折行边加 `role:"return"` |
| lifecycle 列数 | col ≤ **4**（比 workflow 少 1） | 状态多时复用列、错开泳道 |
| mainPath | 相邻 id 必须有对应边、col 不许回退 | 只填连续主链子序列即可 |
| 3+ 路扇出 | 同侧直连易箭头/走廊冲突 | **上下包夹**：目标节点分置源节点上、下泳道，边垂直走 |
| 同列垂直扇入 | 触发 arrowhead-collision | 汇入目标与来源**错列** |
| corridor 冲突 | `ambiguous-corridor` 加 label 无效 | 根本解法是**重排泳道顺序**，让扇出与汇入占用不同 x 区间；只有「边间隙恰好 28px」这类才是加短 label 能救的 |
| candidate.json 手写换行 | 真实换行破坏 JSON | 卡片标题等字段禁用换行，用 Edit 检查 |

## 阅读器与宽屏脚注

- 阅读器默认 **960px 宽**渲染（chrome 30px 后正文 930px），这是 1240 上限的根源；
  我们的嵌页场景自带缩放/全屏/新窗口，所以这个保护对实际阅读不是强约束。
- 源码预留 **declared-wide-v1** 宽屏契约（上限 1920px，要求 w/h≥1.55 + intrinsic-height fit），
  由渲染器自动声明，candidate 无法直接命令。
- 若未来确需低于 6px 的地板以换取超宽画布，改 `~/.kimi-code/skills/archify/renderers/shared/desktop-readability.mjs`
  里的 `MIN_PROJECTED_NODE_TEXT_PX`（6→5 ≈1488px；6→4 ≈1860px），改前和现在对比一张图再定。

## 非阻塞项（不必强求归零）

- deliver 的 advisory `visualReviewRecommendation`（detour/crossing hint）：细线单次交叉若目检可读就接受；
  为消一个 hint 大改布局往往引入更多交叉（B 组实测挪 Approved 节点反而 1 交叉变 2）。
- sequence 无自消息语法：`Note over X`、`X->>X` 用消息的 `note` 字段表达（FULL 缩放/悬停显示，属特性）。

## 验证清单（每批交付前）

1. finalize 四道门全过（无 error，仅 advisory 可留）
2. headless Chrome 逐张截图目检：无节点重叠 / 文字截断 / 箭头错乱 / 配色异常
3. `grep -rc '```mermaid' --include='*.md' .` 全 0
4. http.server 抽一页 docsify 页面截图，确认 iframe 渲染 + 新窗口链接正常
5. git add 只含本批 html + 对应 md，commit 里写明每张图的 slug 与内容

## 历史批次

- 批次 1–6（49 张）：llm 基础 / agent / rag / 训练对齐 / 分布式训练 / inference（至 e30ecc6）
- 批次 7（10 张）：system-design 六大设计题（b091361）
- 批次 8（6 张）：resources 学习路线图 ×2、iq README ×2、源码解读 README + 源码学习路线图（be24f4a）
- 批次 9（1 张）：rl-evolution RL 算法演化线（训练与对齐 rlhf与对齐.md 第十五章）

合计 **66 张**，全仓库 mermaid 清零。
