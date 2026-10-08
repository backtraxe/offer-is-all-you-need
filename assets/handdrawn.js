/**
 * handdrawn.js — mermaid 子集 → SVG 渲染器（简约科技风）
 *
 * 管道：parse（mermaid 子集 → 模型）→ layout（模型 → 指令清单，纯函数）
 *       → buildSvg（指令清单 → svg 元素字符串，样式全由 assets/site.css 的 .hd-* 规则驱动）
 * parse/layout 不依赖 DOM，可在 node 下测试；浏览器中通过 window.__hd 暴露。
 * 亮/暗主题切换由 CSS 变量完成，无需重绘。
 *
 * 支持子集（超出即 fallback，不抛给用户）：
 *  - flowchart/graph TB|TD|BT|LR|RL、stateDiagram-v2
 *    节点 a["x"] a{"x"} a{{"x"}} a("x") a((x)) a(["x"])
 *    边 --> -.-> --- -.- ~~~ <-->，a --> b & c，链式 a --> b --> c
 *    subgraph 一层（嵌套→fallback），style 行仅识别红色系 fill
 *  - sequenceDiagram：participant/actor、->> -->> -> --> -) --) -x --x、
 *    Note over、loop...end、autonumber；activate/deactivate 忽略
 */
(function (global) {
  'use strict';

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif';

  // 画布尺寸上限：超出则 fallback 给 mermaid（避免自研布局在超宽图上失控）
  var FLOW_MAX_W = 3200, FLOW_MAX_H = 2600;
  var SEQ_MAX_W = 1600, SEQ_MAX_H = 2600;

  /* ================= 文本工具 ================= */

  function unescapeHtml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }

  function normText(s) {
    if (s == null) return '';
    return unescapeHtml(String(s)).replace(/<br\s*\/?>/gi, '\n').trim();
  }

  function stripComment(line) {
    var i = line.indexOf('%%');
    return (i >= 0 ? line.slice(0, i) : line);
  }

  /* ================= 文本测量（可注入） ================= */

  var measureFn = null;

  function setMeasure(fn) { measureFn = typeof fn === 'function' ? fn : null; }

  function estimateMeasure(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += text.charCodeAt(i) > 255 ? size : size * 0.55;
    }
    return w;
  }

  var mCanvas = null, mCtx = null;
  function browserMeasure(text, size) {
    try {
      if (!mCtx) {
        mCanvas = document.createElement('canvas');
        mCtx = mCanvas.getContext('2d');
      }
      mCtx.font = size + 'px ' + FONT;
      var w = mCtx.measureText(text).width;
      return w > 0 ? w : estimateMeasure(text, size);
    } catch (e) {
      return estimateMeasure(text, size);
    }
  }

  function measureLine(text, size) {
    var w = measureFn ? measureFn(text, size) : estimateMeasure(text, size);
    return Math.max(0, w);
  }

  /** 自然断点：空格 / / _ · - \ （不选 . ，避免断版本号/文件名） */
  var BREAK_CHARS = ' /_·-\\';
  function naturalBreak(ch) { return BREAK_CHARS.indexOf(ch) >= 0; }

  /** 贪心换行；优先在自然断点处断，避免在 ASCII 长词中间硬断；返回 [{text, w}] */
  function wrapLine(line, maxW, size) {
    if (maxW <= 0) return [{ text: line, w: measureLine(line, size) }];
    var out = [], buf = '', bufW = 0, breakPos = -1;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var cw = measureLine(ch, size);
      if (buf && bufW + cw > maxW) {
        // 优先在 buf 中的自然断点处断（断点字符留在上一行行尾）
        if (breakPos > 0 && breakPos < buf.length) {
          out.push({ text: buf.slice(0, breakPos), w: measureLine(buf.slice(0, breakPos), size) });
          buf = buf.slice(breakPos).replace(/^[ ]+/, '');
          bufW = measureLine(buf, size);
        } else {
          out.push({ text: buf, w: bufW });
          buf = ''; bufW = 0;
        }
        breakPos = naturalBreak(buf.charAt(buf.length - 1)) ? buf.length : -1;
      }
      buf += ch; bufW += cw;
      if (naturalBreak(ch)) breakPos = buf.length;
    }
    if (buf || !out.length) out.push({ text: buf, w: buf ? bufW : measureLine(line, size) });
    return out;
  }

  /** 多行文本（含 \n）换行 → 行数组（带各自宽度）与总尺寸 */
  function wrapText(text, maxLineW, size) {
    var lines = [];
    String(text == null ? '' : text).split('\n').forEach(function (raw) {
      var l = raw.trim();
      wrapLine(l, maxLineW, size).forEach(function (x) { lines.push(x); });
    });
    if (!lines.length) lines = [{ text: '', w: 0 }];
    var w = 0;
    lines.forEach(function (l) { if (l.w > w) w = l.w; });
    return { lines: lines, w: w };
  }

  /* ================= flowchart / stateDiagram 解析 ================= */

  // 链式语句中的连接符，按优先级匹配（长者优先）
  var LINKS = [
    { re: /^<-->\s*(?:\|"([^"]*)"\||\|([^|]*)\|)?/, arrow: 'both' },
    { re: /^~~~/, arrow: 'none', invis: true },
    { re: /^-\.->\s*(?:\|"([^"]*)"\||\|([^|]*)\|)?/, arrow: 'end', dash: true },
    { re: /^-->\s*(?:\|"([^"]*)"\||\|([^|]*)\|)?/, arrow: 'end' },
    { re: /^--\s+"([^"]*)"\s*-->/, arrow: 'end' },
    { re: /^--\s+([^|]*?)\s+-->/, arrow: 'end' },
    { re: /^-\.\s*"([^"]*)"\s*\.->/, arrow: 'end', dash: true },
    { re: /^-\.\s*([^|]*?)\s*\.->/, arrow: 'end', dash: true },
    { re: /^--\s+"([^"]*)"\s+--(?!>)/, arrow: 'none' },
    { re: /^--\s+([^|]*?)\s+--(?!>|-)/, arrow: 'none' },
    { re: /^---/, arrow: 'none' },
    { re: /^-\.-/, arrow: 'none', dash: true }
  ];

  function matchLink(s) {
    for (var i = 0; i < LINKS.length; i++) {
      var m = s.match(LINKS[i].re);
      if (m) {
        var label = m[1] != null ? m[1] : (m[2] != null ? m[2] : '');
        return {
          arrow: LINKS[i].arrow, dash: !!LINKS[i].dash,
          invis: !!LINKS[i].invis, label: normText(label),
          rest: s.slice(m[0].length)
        };
      }
    }
    return null;
  }

  var ID_RE = /^[^\s\[\(\{<&|>'":]+/;

  function parseNodeSpec(s) {
    s = s.replace(/^\s+/, '');
    if (s.slice(0, 3) === '[*]') {
      return { node: { id: '[*]', pseudo: true }, rest: s.slice(3) };
    }
    var m = s.match(ID_RE);
    if (!m) return null;
    var id = m[0];
    if (!/^[\w一-鿿．.·*]+$/u.test(id)) return null;
    var rest = s.slice(id.length);
    var spec = { id: id, shape: null, text: null };
    var sm =
      rest.match(/^\{\{\s*(?:"([^"]*)"|([^{}]*?))\s*\}\}/) ||
      rest.match(/^\{\s*(?:"([^"]*)"|([^{}]*?))\s*\}/) ||
      rest.match(/^\(\[\s*(?:"([^"]*)"|([^\]\)]*?))\s*\]\)/) ||
      rest.match(/^\(\(\s*(?:"([^"]*)"|([^\)]*?))\s*\)\)/) ||
      rest.match(/^\(\s*(?:"([^"]*)"|([^\)]*?))\s*\)/) ||
      rest.match(/^\[\s*(?:"([^"]*)"|([^\]]*?))\s*\]/);
    if (sm) {
      var shapeHead = sm[0].charAt(0);
      var text = sm[1] != null ? sm[1] : (sm[2] != null ? sm[2] : '');
      spec.text = normText(text);
      if (sm[0].slice(0, 2) === '{{') spec.shape = 'round';
      else if (shapeHead === '{') spec.shape = 'diamond';
      else if (sm[0].slice(0, 2) === '([' || sm[0].slice(0, 2) === '((' || shapeHead === '(') spec.shape = 'round';
      else spec.shape = 'rect';
      rest = rest.slice(sm[0].length);
    }
    return { node: spec, rest: rest };
  }

  function parseEndpointsSide(s) {
    var list = [];
    while (true) {
      var ep = parseNodeSpec(s);
      if (!ep) break;
      list.push(ep.node);
      s = ep.rest;
      if (/^\s*&(?!\w+;)/.test(s)) { s = s.replace(/^\s*&/, ''); continue; }
      break;
    }
    return { list: list, rest: s };
  }

  function resolveNode(state, spec) {
    var id = spec.id;
    if (spec.pseudo) {
      // [*] 每次出现独立成点（起点实心、终点圆环）
      var key = '__pseudo' + (state.pseudoCount++);
      spec = {
        id: key, pseudo: true, shape: state.pendingRole === 'target' ? 'pointEnd' : 'point',
        text: ''
      };
      id = key;
    }
    if (!state.nodes[id]) {
      state.nodes[id] = {
        id: id, pseudo: !!spec.pseudo,
        shape: spec.shape || 'rect',
        text: spec.text != null ? spec.text : (spec.pseudo ? '' : id),
        tone: ''
      };
      state.order.push(id);
      if (state.subStack.length && !spec.pseudo) {
        var cur = state.subStack[state.subStack.length - 1];
        if (cur.members.indexOf(id) < 0) cur.members.push(id);
        state.nodes[id].memberOf = cur.idx;
      }
    } else {
      var n = state.nodes[id];
      if (spec.shape) n.shape = spec.shape;
      if (spec.text) n.text = spec.text;
    }
    return state.nodes[id];
  }

  /** 端点解析：无形状标注且命中 subgraph id 时视为容器引用，否则为节点 */
  function resolveEndpoint(state, spec) {
    if (!spec.pseudo && !spec.shape && !state.nodes[spec.id]) {
      for (var si = 0; si < state.subs.length; si++) {
        if (state.subs[si].id === spec.id) return { sub: si };
      }
    }
    return { node: resolveNode(state, spec).id };
  }

  function parseChainStatement(line, state) {
    var left = parseEndpointsSide(line);
    if (!left.list.length) throw new Error('no endpoint: ' + line.slice(0, 40));
    left.list.forEach(function (spec) {
      spec.__ep = resolveEndpoint(state, spec);
    });
    var rest = left.rest;
    var prev = left, sawLink = false, lastLink = null;
    while (true) {
      rest = rest.replace(/^\s+/, '');
      var lm = matchLink(rest);
      if (!lm) break;
      sawLink = true;
      lastLink = lm;
      var right = parseEndpointsSide(lm.rest);
      if (!right.list.length) throw new Error('dangling link: ' + line.slice(0, 40));
      right.list.forEach(function (spec) {
        state.pendingRole = 'target';
        spec.__ep = resolveEndpoint(state, spec);
        state.pendingRole = '';
      });
      prev.list.forEach(function (a) {
        right.list.forEach(function (b) {
          state.edges.push({
            s: a.__ep, t: b.__ep,
            arrow: lm.arrow, dash: lm.dash, invis: lm.invis,
            label: lm.label || ''
          });
        });
      });
      prev = right;
      rest = right.rest;
    }
    rest = rest.trim();
    if (rest) {
      var sm = rest.match(/^:\s*([\s\S]+)$/); // stateDiagram-v2 的冒号标签
      if (sm && lastLink) {
        lastLink.label = normText(sm[1]);
        // 把标签写回最后一批边
        for (var i = state.edges.length - 1; i >= 0; i--) {
          state.edges[i].label = normText(sm[1]);
          break;
        }
      } else {
        throw new Error('unparsed tail: ' + rest.slice(0, 40));
      }
    }
    if (sawLink) return;
    // 无连接符：必须是单个节点声明
    if (left.list.length !== 1) throw new Error('& without link');
  }

  function isRedFamily(hex) {
    var m = /^#?([0-9a-fA-F]{6})/.exec(hex || '');
    if (!m) return false;
    var r = parseInt(m[1].slice(0, 2), 16),
        g = parseInt(m[1].slice(2, 4), 16),
        b = parseInt(m[1].slice(4, 6), 16);
    return r - Math.max(g, b) >= 8 && r >= 100;
  }

  /** flowchart/graph/stateDiagram-v2 → 模型；不支持处抛错（上层转 fallback） */
  function parseFlow(source) {
    var state = {
      kind: 'flow', dir: 'TB',
      nodes: {}, order: [], edges: [], subs: [],
      subStack: [], pseudoCount: 0, pendingRole: ''
    };
    var lines = String(source).split('\n');
    var headIdx = -1;
    for (var li = 0; li < lines.length; li++) {
      var first = stripComment(lines[li]).trim();
      if (!first) continue;
      headIdx = li;
      var hm = first.match(/^(flowchart|graph)\s+(TD|TB|BT|LR|RL)/) ||
               first.match(/^(stateDiagram(?:-v2)?)/);
      if (!hm) throw new Error('bad header: ' + first.slice(0, 40));
      if (hm[2]) state.dir = hm[2] === 'TD' ? 'TB' : hm[2];
      if (hm[1] && hm[1].indexOf('stateDiagram') === 0) state.dir = 'TB';
      break;
    }
    if (headIdx < 0) throw new Error('empty');
    for (var i = headIdx + 1; i < lines.length; i++) {
      var line = stripComment(lines[i]).trim();
      if (!line) continue;
      var subA = line.match(/^subgraph\s+([^\s\[]+)\s*(?:\[\s*"([^"]*)"\s*\]|\[\s*([^\]]*)\s*\])?\s*$/);
      var subB = !subA && line.match(/^subgraph\s+"([^"]+)"\s*$/);
      if (subA || subB) {
        if (state.subStack.length) throw new Error('nested subgraph');
        var subId = null, subTitle = null;
        if (subA) {
          subId = subA[1];
          subTitle = subA[2] != null ? subA[2] : (subA[3] != null ? normText(subA[3]) : subA[1]);
        } else {
          subId = null;
          subTitle = normText(subB[1]);
        }
        var sub = {
          idx: state.subs.length,
          id: subId != null ? subId : '__sub' + state.subs.length,
          title: subTitle,
          members: [], dir: null
        };
        if (!sub.title) sub.title = sub.id;
        state.subs.push(sub);
        state.subStack.push(sub);
        continue;
      }
      if (/^end\s*$/.test(line)) {
        if (state.subStack.length) { state.subStack.pop(); continue; }
        throw new Error('stray end');
      }
      var dirM = line.match(/^direction\s+(TD|TB|BT|LR|RL)\s*$/);
      if (dirM) {
        if (state.subStack.length) state.subStack[state.subStack.length - 1].dir = dirM[1] === 'TD' ? 'TB' : dirM[1];
        else state.dir = dirM[1] === 'TD' ? 'TB' : dirM[1];
        continue;
      }
      var styleM = line.match(/^style\s+([^\s]+)\s+(.+)$/);
      if (styleM) {
        var fillM = styleM[2].match(/fill\s*:\s*#?([0-9a-fA-F]{6})/);
        if (fillM && isRedFamily('#' + fillM[1])) {
          var target = state.nodes[styleM[1]];
          if (target) target.tone = 'red';
          state.subs.forEach(function (sub) { if (sub.id === styleM[1]) sub.tone = 'red'; });
        }
        continue;
      }
      if (/^(classDef|class|click|linkStyle)\b/.test(line)) {
        throw new Error('unsupported: ' + line.slice(0, 30));
      }
      parseChainStatement(line, state);
    }
    // subgraph id 作为端点时，记到对应 sub（token 级分辨延后到布局阶段）
    return state;
  }

  /* ================= sequenceDiagram 解析 ================= */

  var SEQ_ARROW_MAP = {
    '-->>': { dash: true, head: 'full' },
    '--x': { dash: true, head: 'x' },
    '--)': { dash: true, head: 'open' },
    '-->': { dash: true, head: 'open' },
    '->>': { dash: false, head: 'full' },
    '-x': { dash: false, head: 'x' },
    '-)': { dash: false, head: 'open' },
    '->': { dash: false, head: 'open' }
  };
  var SEQ_MSG_RE = /^([A-Za-z0-9_.一-鿿]+)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([A-Za-z0-9_.一-鿿]+)\s*:\s*([\s\S]*)$/;

  function parseSequence(source) {
    var model = { kind: 'seq', parts: [], partById: {}, events: [], autonumber: false };
    var lines = String(source).split('\n');
    var headIdx = -1;
    for (var hi = 0; hi < lines.length; hi++) {
      var first = stripComment(lines[hi]).trim();
      if (!first) continue;
      if (!/^sequenceDiagram\b/.test(first)) throw new Error('bad header');
      headIdx = hi;
      break;
    }
    if (headIdx < 0) throw new Error('empty');

    function ensurePart(id, label) {
      if (!model.partById[id]) {
        var p = { id: id, label: normText(label || id), idx: model.parts.length };
        model.partById[id] = p;
        model.parts.push(p);
      }
      return model.partById[id];
    }

    var loopStack = [];
    for (var i = headIdx + 1; i < lines.length; i++) {
      var line = stripComment(lines[i]).trim();
      if (!line) continue;
      var m;
      if (/^autonumber\b/.test(line)) { model.autonumber = true; continue; }
      if ((m = line.match(/^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/))) {
        ensurePart(m[1], m[2]);
        continue;
      }
      if (/^(activate|deactivate)\b/.test(line)) continue;
      if ((m = line.match(/^[Nn]ote\s+over\s+([^\s:,]+)(?:\s*,\s*([^\s:,]+))?\s*:\s*([\s\S]+)$/))) {
        var na = ensurePart(m[1]), nb = m[2] ? ensurePart(m[2]) : null;
        var noteEv = { t: 'note', a: na.idx, b: nb ? nb.idx : null, text: normText(m[3]) };
        model.events.push(noteEv);
        if (loopStack.length) loopStack[loopStack.length - 1].events.push(noteEv);
        continue;
      }
      if ((m = line.match(/^[Ll]oop\s+(.+)$/))) {
        if (loopStack.length) throw new Error('nested loop');
        var frame = { label: normText(m[1]), events: [] };
        model.events.push({ t: 'loopstart', frame: frame });
        loopStack.push(frame);
        continue;
      }
      if (/^else\b/.test(line)) continue;
      if (/^end\s*$/.test(line)) {
        if (!loopStack.length) throw new Error('stray end (seq)');
        model.events.push({ t: 'loopend', frame: loopStack.pop() });
        continue;
      }
      if (/^(alt|opt|par|critical|break|and)\b/.test(line)) {
        throw new Error('unsupported seq block: ' + line.slice(0, 20));
      }
      var msgM = line.match(SEQ_MSG_RE);
      if (msgM) {
        var arrow = SEQ_ARROW_MAP[msgM[2]];
        var fa = ensurePart(msgM[1]), ta = ensurePart(msgM[3]);
        var ev = { t: 'msg', from: fa.idx, to: ta.idx, text: normText(msgM[4]), dash: arrow.dash, head: arrow.head };
        model.events.push(ev);
        if (loopStack.length) loopStack[loopStack.length - 1].events.push(ev);
        continue;
      }
      // 其余未知行忽略（不阻塞整个图）
    }
    if (loopStack.length) throw new Error('unclosed loop');
    if (!model.parts.length) throw new Error('no participants');
    return model;
  }

  /* ================= flow 布局 ================= */

  var MARGIN = 26, HGAP = 48, VGAP = 52;
  var NODE_FS = 13, NODE_LINE_H = 22, NODE_PADX = 13, NODE_PADY = 12;
  var EDGE_FS = 12, EDGE_PAD = 6;

  function sizeNode(n) {
    if (n.shape === 'point') { n.w = 26; n.h = 26; n.textLines = []; return; }
    if (n.shape === 'pointEnd') { n.w = 32; n.h = 32; n.textLines = []; return; }
    var wrapW = n.shape === 'diamond' ? 150 : 240 - 2 * NODE_PADX;
    var t = wrapText(n.text, wrapW, NODE_FS);
    n.textLines = t.lines;
    n.w = Math.max(78, Math.ceil(t.w + 2 * NODE_PADX));
    n.h = Math.max(44, t.lines.length * NODE_LINE_H + 2 * NODE_PADY);
    if (n.shape === 'round') {
      n.w = Math.min(300, n.w + 22);
      n.h = Math.max(n.h, 48);
    }
    if (n.shape === 'diamond') {
      n.w = Math.ceil(n.w * 1.45);
      n.h = Math.ceil(n.h * 1.32);
    }
  }

  /** 单层 DAG 分层布局：返回 {pos:{id:{x,y}}, w, h}；dir∈{TB,BT,LR,RL} */
  function layoutLevel(ids, nodeMap, edges, dir) {
    var horizontal = dir === 'LR' || dir === 'RL';
    var sign = (dir === 'BT' || dir === 'RL') ? -1 : 1;
    var outs = {}, ins = {}, present = {};
    ids.forEach(function (id) { outs[id] = []; ins[id] = []; present[id] = true; });
    var usable = edges.filter(function (e) { return present[e.s] && present[e.t] && !e.invis; });

    // DFS 回边剔除（保证拓扑序存在）
    var color = {};
    var back = [];
    (function dfs() {
      function visit(v) {
        color[v] = 1;
        usable.forEach(function (e) {
          if (e.s !== v) return;
          if (color[e.t] === 1) { back.push(e); return; }
          if (!color[e.t]) visit(e.t);
        });
        color[v] = 2;
      }
      ids.forEach(function (v) { if (!color[v]) visit(v); });
    })();

    var fwd = usable.filter(function (e) { return back.indexOf(e) < 0; });
    fwd.forEach(function (e) { outs[e.s].push(e.t); ins[e.t].push(e.s); });

    var rank = {}, left = {};
    ids.forEach(function (id) { rank[id] = 0; left[id] = ins[id].length; });
    var queue = ids.filter(function (id) { return !left[id]; });
    var tmp = queue.slice();
    while (tmp.length) {
      var v = tmp.shift();
      outs[v].forEach(function (w) {
        if (rank[w] < rank[v] + 1) rank[w] = rank[v] + 1;
        if (--left[w] === 0) tmp.push(w);
      });
    }
    // 漏网的（孤立或缓存问题）保持 rank 0

    var maxRank = 0, groups = [];
    ids.forEach(function (id) {
      if (rank[id] > maxRank) maxRank = rank[id];
    });
    for (var g = 0; g <= maxRank; g++) groups.push([]);
    ids.forEach(function (id) { groups[rank[id]].push(id); });
    groups.forEach(function (gp) {
      gp.sort(function (a, b) { return ids.indexOf(a) - ids.indexOf(b); });
    });

    // barycenter 排序（前向后向各两趟）
    function idxIn(groups2) {
      var pos = {};
      groups2.forEach(function (gp, ri) { gp.forEach(function (id, oi) { pos[id] = oi + 1; }); });
      return pos;
    }
    function sortGroup(gp, neigh, pos) {
      return gp.slice().sort(function (a, b) {
        function bary(id) {
          var ns = neigh[id];
          if (!ns || !ns.length) return -1;
          var sum = 0, cnt = 0;
          ns.forEach(function (n) { if (pos[n]) { sum += pos[n]; cnt++; } });
          return cnt ? sum / cnt : -1;
        }
        var ba = bary(a), bb = bary(b);
        if (ba < 0 && bb < 0) return ids.indexOf(a) - ids.indexOf(b);
        if (ba < 0) return 1;
        if (bb < 0) return -1;
        return ba - bb;
      });
    }
    var pass, ri;
    for (pass = 0; pass < 2; pass++) {
      for (ri = 1; ri <= maxRank; ri++) {
        var d = ins; // 来自上一层的邻居
        var pos = idxIn(groups);
        var up = {};
        groups[ri].forEach(function (id) {
          up[id] = (d[id] || []).filter(function (n) { return rank[n] === ri - 1; });
        });
        groups[ri] = sortGroup(groups[ri], up, pos);
      }
      for (ri = maxRank - 1; ri >= 0; ri--) {
        var dd = outs;
        var pos2 = idxIn(groups);
        var dn = {};
        groups[ri].forEach(function (id) {
          dn[id] = (dd[id] || []).filter(function (n) { return rank[n] === ri + 1; });
        });
        groups[ri] = sortGroup(groups[ri], dn, pos2);
      }
    }

    // 主尺寸 = 主轴向尺寸(nh)，交叉轴 = 宽度或高度
    function mainSize(id) { return horizontal ? nodeMap[id].w : nodeMap[id].h; }
    function crossSize(id) { return horizontal ? nodeMap[id].h : nodeMap[id].w; }

    // 主轴 rank 位置
    var layerSizes = groups.map(function (gp) {
      var s = 0;
      gp.forEach(function (id) { s = Math.max(s, mainSize(id)); });
      return s;
    });
    var layerTop = [], acc = 0;
    for (var li = 0; li < layerSizes.length; li++) {
      layerTop.push(acc);
      acc += layerSizes[li] + VGAP;
    }
    var totalMain = acc - (layerSizes.length ? VGAP : 0);

    // 交叉轴：每层内容居中
    var crossTotals = groups.map(function (gp) {
      var s = 0;
      gp.forEach(function (id) { s += crossSize(id); });
      s += HGAP * Math.max(0, gp.length - 1);
      return s;
    });
    var crossMax = 0;
    crossTotals.forEach(function (s) { crossMax = Math.max(crossMax, s); });

    var pos = {};
    groups.forEach(function (gp, ri2) {
      var cx = (crossMax - crossTotals[ri2]) / 2;
      gp.forEach(function (id) {
        var mainC = layerTop[ri2] + (layerSizes[ri2] - mainSize(id)) / 2;
        if (sign < 0) mainC = totalMain - mainC - mainSize(id);
        if (horizontal) {
          pos[id] = { x: mainC, y: cx, cx: mainC + nodeMap[id].w / 2, cy: cx + nodeMap[id].h / 2 };
          cx += crossSize(id) + HGAP;
        } else {
          pos[id] = { x: cx, y: mainC, cx: cx + nodeMap[id].w / 2, cy: mainC + nodeMap[id].h / 2 };
          cx += crossSize(id) + HGAP;
        }
      });
    });

    return {
      pos: pos, rank: rank, backEdges: back,
      w: horizontal ? totalMain : crossMax,
      h: horizontal ? crossMax : totalMain
    };
  }

  /* ================= flow 驱动布局（全局 rank + 泳道列（lane）布局） ================= */

  // 容器垂直留白需 ≤ VGAP（bottomPad + padTop + 标题区 ≤ 层间距），否则相邻 rank 的簇框会压线
  var SUB_PADX = 18, SUB_PADY = 12, SUB_TITLE_H = 26;

  function epIsNode(ep) { return ep && ep.node != null; }

  /** 端点展开为节点 id 数组（容器端点展开为其成员节点） */
  function expandEp(state, ep) {
    if (epIsNode(ep)) return [ep.node];
    var sub = state.subs[ep.sub];
    return sub ? sub.members.slice() : [];
  }

  /** 排名用约束边：节点边原样进，容器引用边展开为成员笛卡尔积 */
  function constraintEdges(state) {
    var out = [];
    state.edges.forEach(function (e) {
      var froms = expandEp(state, e.s), tos = expandEp(state, e.t);
      froms.forEach(function (s) {
        tos.forEach(function (t) {
          if (s !== t) out.push({ s: s, t: t, invis: e.invis });
        });
      });
    });
    return out;
  }

  /**
   * mermaid 语义布局：
   *  1) 全局 rank（跨子图对齐，同 rank 节点共享 y 带）
   *  2) 泳道列：每个 subgraph 一列（多 rank 的簇自然竖排/横排），孤立节点自成一列
   *  3) 列序按子图间的约束做 barycenter 平均（初值来自扁平布局的重心）
   *  4) 每列内按 rank 分行居中；某 rank 只有一个“柔性”实体（孤立节点 / 单 rank 簇）时整行对画布居中
   */
  function layoutFlow(state) {
    // 1. 节点尺寸 + 全局分层
    state.order.forEach(function (id) { sizeNode(state.nodes[id]); });
    var ids = state.order.slice();
    var cEdges = constraintEdges(state);
    var lev = layoutLevel(ids, state.nodes, cEdges, state.dir);
    var flatPos = lev.pos, rank = lev.rank;
    var horizontal = state.dir === 'LR' || state.dir === 'RL';
    var mirror = state.dir === 'BT' || state.dir === 'RL';

    // 2. 泳道单元
    var memberOf = {};
    state.subs.forEach(function (sub) {
      sub.members.forEach(function (id) { memberOf[id] = sub.idx; });
    });
    var lanes = [];
    state.subs.forEach(function (sub) {
      var mem = sub.members.filter(function (id) { return flatPos[id]; });
      if (mem.length) lanes.push({ kind: 'sub', sub: sub, members: mem });
    });
    state.order.forEach(function (id) {
      if (memberOf[id] == null && flatPos[id]) lanes.push({ kind: 'lone', members: [id] });
    });
    if (!lanes.length) lanes = [{ kind: 'lone', members: ids }];

    var laneOf = {};
    lanes.forEach(function (l, i) {
      l.idx = i;
      l.members.forEach(function (id) { laneOf[id] = i; });
    });

    // 3. 每列的行（按 rank 分组）、行跨度与列宽
    lanes.forEach(function (l) {
      var rows = {};
      l.members.forEach(function (id) {
        var r = rank[id] != null ? rank[id] : 0;
        (rows[r] = rows[r] || []).push(id);
      });
      l.rows = rows;
      l.minR = Math.min.apply(null, Object.keys(rows).map(Number));
      l.maxR = Math.max.apply(null, Object.keys(rows).map(Number));
      var w = 0;
      Object.keys(rows).forEach(function (r) {
        var mem = rows[r];
        mem.sort(function (a, b) { return flatPos[a].cx - flatPos[b].cx; }); // 保序
        var rw = 0;
        mem.forEach(function (id) { rw += state.nodes[id].w; });
        rw += HGAP * Math.max(0, mem.length - 1);
        if (rw > w) w = rw;
      });
      l.width = w;
    });

    // 4. 列序：起始 rank 早的列靠左（图上深向下），同一起点按扁平布局重心排序
    var seed = lanes.map(function (l) {
      var s = 0;
      l.members.forEach(function (id) { s += flatPos[id].cx; });
      return s / l.members.length;
    });
    var orderIdx = lanes.map(function (l, i) { return i; }).sort(function (a, b) {
      return (lanes[a].minR - lanes[b].minR) || (seed[a] - seed[b]);
    });

    // 5. 列中心（交叉轴累计）
    var cursor = 0;
    var totalCross = 0;
    orderIdx.forEach(function (i, k) {
      var l = lanes[i];
      l.cx = cursor + l.width / 2;
      cursor += l.width + (k < orderIdx.length - 1 ? HGAP : 0);
    });
    totalCross = cursor;

    // 6. 布置位置：列内按 rank 分行，行内成员沿交叉轴居中于列中心
    var pos = {};
    lanes.forEach(function (l) {
      Object.keys(l.rows).forEach(function (rk) {
        var mem = l.rows[rk];
        var rowW = 0;
        mem.forEach(function (id) { rowW += state.nodes[id].w; });
        rowW += HGAP * (mem.length - 1);
        var start = l.cx - rowW / 2;
        mem.forEach(function (id) {
          var n = state.nodes[id], fp = flatPos[id];
          if (horizontal) {
            pos[id] = { x: fp.x, y: start, cx: fp.cx, cy: start + n.h / 2 };
            start += n.h + HGAP;
          } else {
            pos[id] = { x: start, y: fp.y, cx: start + n.w / 2, cy: fp.cy };
            start += n.w + HGAP;
          }
        });
      });
    });

    // 7. solo rank 居中：该 rank 只有一个柔性实体（孤立节点 / 单 rank 簇）时对总宽居中
    var byRank = {};
    lanes.forEach(function (l) {
      Object.keys(l.rows).forEach(function (rk) {
        (byRank[rk] = byRank[rk] || []).push(l);
      });
    });
    Object.keys(byRank).forEach(function (rk) {
      var ls = byRank[rk];
      if (ls.length !== 1) return;
      var l = ls[0];
      var flexible = l.kind === 'lone' || (l.minR === l.maxR);
      if (!flexible) return;
      var mem = l.rows[rk];
      var lo = 1e9, hi = -1e9;
      mem.forEach(function (id) {
        var p = pos[id], n = state.nodes[id];
        var a = horizontal ? p.y : p.x, s = horizontal ? n.h : n.w;
        lo = Math.min(lo, a); hi = Math.max(hi, a + s);
      });
      var shift = totalCross / 2 - (lo + hi) / 2;
      if (!shift) return;
      mem.forEach(function (id) {
        if (horizontal) { pos[id].y += shift; pos[id].cy += shift; }
        else { pos[id].x += shift; pos[id].cx += shift; }
      });
    });

    // 8. 输出几何（容器 = 成员 bbox + padding + 标题区）
    var nodeGeom = {}, subGeom = {};
    ids.forEach(function (id) {
      var p = pos[id] || flatPos[id], n = state.nodes[id];
      nodeGeom[id] = { x: p.x, y: p.y, w: n.w, h: n.h };
    });
    state.subs.forEach(function (sub) {
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, has = false;
      sub.members.forEach(function (id) {
        var g = nodeGeom[id];
        if (!g) return;
        has = true;
        minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
        maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
      });
      if (!has) return;
      subGeom[sub.idx] = {
        x: minX - SUB_PADX, y: minY - SUB_PADY - SUB_TITLE_H,
        w: (maxX - minX) + SUB_PADX * 2, h: (maxY - minY) + SUB_PADY * 2 + SUB_TITLE_H,
        title: sub.title, tone: sub.tone || ''
      };
    });

    return { nodeGeom: nodeGeom, subGeom: subGeom, state: state, levU: lev };
  }
  /* ================= flow 路由 + 指令生成 ================= */

  function endpointBox(L, ep) {
    if (ep.sub != null) {
      var g = L.subGeom[ep.sub];
      return g ? { cx: g.x + g.w / 2, cy: g.y + g.h / 2, w: g.w, h: g.h } : null;
    }
    var n = L.nodeGeom[ep.node];
    return n ? { cx: n.x + n.w / 2, cy: n.y + n.h / 2, w: n.w, h: n.h } : null;
  }

  var SIDE_LANE = 22;

  function routeFlowEdge(L, e, dir) {
    var b0 = endpointBox(L, e.s), b1 = endpointBox(L, e.t);
    if (!b0 || !b1) return null;
    if (e.s.node != null && e.s.node === e.t.node) return null; // 自环（flow 暂不支持）
    var dx = b1.cx - b0.cx, dy = b1.cy - b0.cy;
    var pts;
    if (dir === 'LR' || dir === 'RL') {
      var gapX = dx > 0 ? dx - (b0.w + b1.w) / 2 : dx;
      if ((dir === 'LR' ? 1 : -1) * dx > 0 && gapX > 8) {
        var s = { x: b0.cx + (dir === 'LR' ? 1 : -1) * b0.w / 2, y: b0.cy };
        var t = { x: b1.cx - (dir === 'LR' ? 1 : -1) * b1.w / 2, y: b1.cy };
        var midX = (s.x + t.x) / 2;
        pts = Math.abs(s.y - t.y) < 3 ? [s, t] : [s, { x: midX, y: s.y }, { x: midX, y: t.y }, t];
      } else {
        var lane = Math.max(b0.cy + b0.h / 2, b1.cy + b1.h / 2) + SIDE_LANE;
        pts = [{ x: b0.cx, y: b0.cy + b0.h / 2 }, { x: b0.cx, y: lane },
               { x: b1.cx, y: lane }, { x: b1.cx, y: b1.cy + b1.h / 2 }];
      }
    } else {
      var gapY = dy > 0 ? dy - (b0.h + b1.h) / 2 : dy;
      if ((dir === 'BT' ? -1 : 1) * dy > 0 && gapY > 8) {
        var sy = b0.cy + (dir === 'BT' ? -1 : 1) * b0.h / 2;
        var ty = b1.cy - (dir === 'BT' ? -1 : 1) * b1.h / 2;
        var s2 = { x: b0.cx, y: sy }, t2 = { x: b1.cx, y: ty };
        var midY = (s2.y + t2.y) / 2;
        pts = Math.abs(s2.x - t2.x) < 3 ? [s2, t2] : [s2, { x: s2.x, y: midY }, { x: t2.x, y: midY }, t2];
      } else {
        var lane2 = Math.max(b0.cx + b0.w / 2, b1.cx + b1.w / 2) + SIDE_LANE;
        pts = [{ x: b0.cx + b0.w / 2, y: b0.cy }, { x: lane2, y: b0.cy },
               { x: lane2, y: b1.cy }, { x: b1.cx + b1.w / 2, y: b1.cy }];
      }
    }
    return pts;
  }

  // 标签位置：第二段线段中点
  function labelPos(pts, linesH) {
    var i = Math.min(1, pts.length - 2);
    var a = pts[i], b = pts[i + 1];
    if (pts.length === 4) { a = pts[1]; b = pts[2]; }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 2 };
  }

  function flowCommands(state, L) {
    var cmds = [];
    // 背景容器
    Object.keys(L.subGeom).forEach(function (k) {
      var g = L.subGeom[k];
      cmds.push({ op: 'cluster', x: g.x, y: g.y, w: g.w, h: g.h, title: g.title, tone: g.tone });
    });
    // 节点
    L.state.order.forEach(function (id) {
      var n = state.nodes[id], g = L.nodeGeom[id];
      if (!g) return;
      cmds.push({ op: 'node', shape: n.shape, x: g.x, y: g.y, w: g.w, h: g.h, tone: n.tone });
      if (n.textLines && n.textLines.length) {
        cmds.push({
          op: 'nodeText', cx: g.x + g.w / 2, top: g.y + NODE_PADY,
          lines: n.textLines, size: NODE_FS, lineH: NODE_LINE_H, tone: n.tone
        });
      }
    });
    // 边
    state.edges.forEach(function (e) {
      if (e.invis) return;
      var pts = routeFlowEdge(L, e, state.dir);
      if (!pts) return;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      pts.forEach(function (p) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
      cmds.push({ op: 'edge', pts: pts, dash: e.dash, arrow: e.arrow });
      if (e.label) {
        var t = wrapText(e.label, 200, EDGE_FS);
        var lp = labelPos(pts, t.lines.length * 18);
        cmds.push({
          op: 'edgeLabel', cx: lp.x, cy: lp.y,
          lines: t.lines, size: EDGE_FS, lineH: 19, bg: true
        });
      }
    });
    return cmds;
  }

  /* ================= sequence 布局 + 指令 ================= */

  var PART_FS = 13, PART_PADX = 16, MSGLABEL_FS = 12, MSGLABEL_LINE_H = 18;
  var NOTE_FS = 12, NOTE_PADX = 12, NOTE_LINE_H = 18;
  var LOOP_FS = 12;
  var COL_GAP_MIN = 110, MSG_ARROW_PAD = 44, SELF_WIDTH = 42, SELF_HEIGHT = 30;

  function layoutSequence(model) {
    var parts = model.parts;
    if (parts.length > 12) throw new Error('too many participants');
    var n = parts.length;

    // 1. 头部尺寸
    parts.forEach(function (p) {
      var t = wrapText(p.label, 170, PART_FS);
      p.textLines = t.lines;
      p.hw = Math.max(84, Math.ceil(t.w + PART_PADX * 2));
      p.hh = t.lines.length * 20 + 14;
    });

    // 2. 消息行预处理（换行 + 字号）
    var msgNo = 0;
    var events = model.events.map(function (ev) {
      if (ev.t === 'msg') {
        var t = wrapText(ev.text, 300, MSGLABEL_FS);
        var e2 = {
          t: 'msg', from: ev.from, to: ev.to,
          lines: t.lines, labelW: t.w, dash: ev.dash, head: ev.head,
          no: model.autonumber ? ++msgNo : 0
        };
        e2.labelW = Math.max(e2.labelW, e2.lines.length ? e2.lines[0].w : 0);
        return e2;
      }
      if (ev.t === 'note') {
        var tn = wrapText(ev.text, 240, NOTE_FS);
        return { t: 'note', a: ev.a, b: ev.b, lines: tn.lines, w: tn.w + NOTE_PADX * 2 };
      }
      if (ev.t === 'loopstart') return ev;
      return ev;
    });

    // 3. 列间距（考虑跨列消息文本宽度 + 头部宽度）
    var gap = [];
    var gi, k;
    for (gi = 0; gi < n - 1; gi++) {
      gap[gi] = Math.max(COL_GAP_MIN, (parts[gi].hw + parts[gi + 1].hw) / 2 + 26);
    }
    for (k = 0; k < 3; k++) {
      events.forEach(function (ev) {
        if (ev.t !== 'msg' || ev.from === ev.to) return;
        var a = Math.min(ev.from, ev.to), b = Math.max(ev.from, ev.to);
        var need = ev.labelW + MSG_ARROW_PAD;
        var span = 0, gi2;
        for (gi2 = a; gi2 < b; gi2++) span += gap[gi2];
        if (need > span) {
          var add = (need - span) / (b - a);
          for (gi2 = a; gi2 < b; gi2++) gap[gi2] += add;
        }
      });
    }
    var colX = [MARGIN + parts[0].hw / 2];
    for (gi = 1; gi < n; gi++) {
      colX[gi] = colX[gi - 1] + gap[gi - 1];
    }

    // 4. 逐事件纵向排布 → 指令
    var cmds = [];
    var topY = MARGIN;
    var headMaxH = 0;
    parts.forEach(function (p) { headMaxH = Math.max(headMaxH, p.hh); });
    var lifelineTop = topY + headMaxH + 6;
    var curY = lifelineTop + 22;

    var loopOpen = [];
    function evCols(ev) {
      if (ev.t === 'msg') return [ev.from, ev.to];
      if (ev.t === 'note') return ev.b != null ? [ev.a, ev.b] : [ev.a];
      return [];
    }
    events.forEach(function (ev, ei) {
      if (ev.t === 'msg') {
        var labelH = ev.lines.length * MSGLABEL_LINE_H;
        var arrowY = curY + labelH + 10;
        if (ev.from === ev.to) {
          var x = colX[ev.from];
          var selfBottom = arrowY + SELF_HEIGHT;
          cmds.push({ op: 'seqText', x: x + 14, y: curY - 2, lines: ev.lines, size: MSGLABEL_FS, lineH: MSGLABEL_LINE_H, align: 'left' });
          cmds.push({ op: 'seqSelf', x: x, y: arrowY, w: SELF_WIDTH, h: SELF_HEIGHT, dash: ev.dash, head: ev.head });
          if (ev.no) cmds.push({ op: 'seqNum', n: ev.no, x: x + 6, y: arrowY - 4 });
          curY = selfBottom + 22;
        } else {
          var x0 = colX[ev.from], x1 = colX[ev.to];
          var cx = (x0 + x1) / 2;
          cmds.push({ op: 'seqText', x: cx, y: curY - 2, lines: ev.lines, size: MSGLABEL_FS, lineH: MSGLABEL_LINE_H, align: 'center' });
          cmds.push({ op: 'seqMsg', x0: x0, x1: x1, y: arrowY, dash: ev.dash, head: ev.head });
          if (ev.no) {
            cmds.push({ op: 'seqNum', n: ev.no, x: Math.min(x0, x1) + 8, y: arrowY - 5, alignR: x1 < x0 });
          }
          curY = arrowY + 26;
        }
      } else if (ev.t === 'note') {
        var cols = evCols(ev);
        var a2 = Math.min.apply(null, cols), b2 = Math.max.apply(null, cols);
        var spanC = (colX[a2] + colX[b2]) / 2;
        var nw = ev.w;
        var nx = spanC - nw / 2;
        var noteH = ev.lines.length * NOTE_LINE_H + 14;
        cmds.push({ op: 'note', x: nx, y: curY, w: nw, h: noteH, lines: ev.lines, size: NOTE_FS, lineH: NOTE_LINE_H });
        if (loopOpen.length) loopOpen[loopOpen.length - 1].__cols = loopOpen[loopOpen.length - 1].__cols.concat(cols);
        curY += noteH + 18;
      } else if (ev.t === 'loopstart') {
        ev.frame.__y0 = curY - 12;
        ev.frame.__cols = [];
        loopOpen.push(ev.frame);
      } else if (ev.t === 'loopend') {
        var fr = loopOpen.pop();
        if (!fr) return;
        var y0 = fr.__y0 != null ? fr.__y0 : curY - 12;
        var cols2 = fr.__cols && fr.__cols.length ? fr.__cols : [0, n - 1];
        var a3 = Math.min.apply(null, cols2), b3 = Math.max.apply(null, cols2);
        var lx = colX[a3] - 36, rx = colX[b3] + 36;
        cmds.push({ op: 'loopBox', x: lx, y: y0, w: rx - lx, h: curY - y0 + 10, label: fr.label });
        curY += 22;
      }
      if (loopOpen.length && ev.t === 'msg') {
        loopOpen.forEach(function (fr2) { fr2.__cols = (fr2.__cols || []).concat(evCols(ev)); });
      }
    });

    var bottomY = (curY + 16);
    // loop 未闭合已在此前 parse 阶段抛掉

    // 先画生命线（要在框下方）——指令插入最前
    var lifeCmds = [];
    parts.forEach(function (p, i) {
      lifeCmds.push({ op: 'lifeline', x: colX[i], y0: lifelineTop, y1: bottomY });
    });

    // 头部框
    var headCmds = [];
    parts.forEach(function (p, i) {
      headCmds.push({
        op: 'seqHead', x: colX[i] - p.hw / 2, y: topY, w: p.hw, h: p.hh,
        lines: p.textLines, size: PART_FS
      });
    });

    var rightMost = 0;
    for (gi = 0; gi < n; gi++) rightMost = Math.max(rightMost, colX[gi] + parts[gi].hw / 2);
    // 自环向右扩
    events.forEach(function (ev) {
      if (ev.t === 'msg' && ev.from === ev.to) {
        rightMost = Math.max(rightMost, colX[ev.from] + SELF_WIDTH + 40);
      }
    });

    var w = rightMost + MARGIN;
    var h = bottomY + MARGIN;
    if (w > SEQ_MAX_W || h > SEQ_MAX_H) throw new Error('sequence too large: ' + Math.round(w) + 'x' + Math.round(h));
    return { w: w, h: h, cmds: lifeCmds.concat(headCmds, cmds) };
  }

  /* ================= compile：解析 → 布局 → 指令 + 边界 ================= */

  function boundsOf(cmds) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    function g(x, y, w, h) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    cmds.forEach(function (c) {
      if (c.op === 'node' || c.op === 'cluster' || c.op === 'note' || c.op === 'loopBox' || c.op === 'seqHead') {
        g(c.x, c.y, c.w, c.h);
      } else if (c.op === 'edge') {
        c.pts.forEach(function (p) { g(p.x, p.y, 0, 0); });
      } else if (c.op === 'edgeLabel') {
        var w = 0;
        c.lines.forEach(function (l) { w = Math.max(w, l.w); });
        g(c.cx - w / 2 - 4, c.cy - (c.lines.length * c.lineH) / 2 - 3, w + 8, c.lines.length * c.lineH + 6);
      } else if (c.op === 'nodeText' || c.op === 'seqText') {
        var w2 = 0;
        c.lines.forEach(function (l) { w2 = Math.max(w2, l.w); });
        g(c.cx - w2 / 2, c.top != null ? c.top : c.y,
          w2, c.lines.length * (c.lineH || 20));
      }
    });
    if (minX > maxX) { minX = 0; minY = 0; maxX = 10; maxY = 10; }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  /** 编译整图。成功返回 {w,h,cmds,dx,dy}；不支持时抛错 */
  function compile(source) {
    var src = String(source).trim();
    if (!src) throw new Error('empty');
    var firstLine = src.split('\n').map(function (l) { return stripComment(l).trim(); })
      .filter(function (l) { return l.length; })[0] || '';
    if (/^sequenceDiagram\b/.test(firstLine)) {
      return layoutSequence(parseSequence(src));
    }
    var state = parseFlow(src);
    if (!state.order.length) throw new Error('no nodes');
    var L = layoutFlow(state);
    var cmds = flowCommands(state, L);
    var b = boundsOf(cmds);
    var w = b.maxX - b.minX + MARGIN * 2;
    var h = b.maxY - b.minY + MARGIN * 2;
    if (w > FLOW_MAX_W || h > FLOW_MAX_H) {
      throw new Error('flow too large: ' + Math.round(w) + 'x' + Math.round(h));
    }
    return {
      w: w, h: h, cmds: cmds,
      dx: MARGIN - b.minX, dy: MARGIN - b.minY
    };
  }
  /* ================= SVG 构建（视觉主题全部交给 assets/site.css 的 .hd-* 规则） ================= */

  function escSvg(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(n) {
    var v = Math.round(n * 10) / 10;
    return v === Math.round(v) ? String(Math.round(v)) : String(v);
  }

  function ptsAttr(pts) {
    return pts.map(function (p) { return fmt(p.x) + ',' + fmt(p.y); }).join(' ');
  }

  /** 实心三角箭头（从 from 指向 tip），返回 polygon points 字符串 */
  function triPoints(tip, from, size, spread) {
    var ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    var a1 = ang - spread, a2 = ang + spread;
    var p1 = fmt(tip.x) + ',' + fmt(tip.y);
    var p2 = fmt(tip.x - size * Math.cos(a1)) + ',' + fmt(tip.y - size * Math.sin(a1));
    var p3 = fmt(tip.x - size * Math.cos(a2)) + ',' + fmt(tip.y - size * Math.sin(a2));
    return p1 + ' ' + p2 + ' ' + p3;
  }

  /** 开放箭头：两条斜线，返回 path d */
  function openArrowD(tip, from, size, spread) {
    var ang = Math.atan2(tip.y - from.y, tip.x - from.x);
    var a1 = ang + spread, a2 = ang - spread;
    return 'M' + fmt(tip.x - size * Math.cos(a1)) + ',' + fmt(tip.y - size * Math.sin(a1)) +
      ' L' + fmt(tip.x) + ',' + fmt(tip.y) +
      ' M' + fmt(tip.x - size * Math.cos(a2)) + ',' + fmt(tip.y - size * Math.sin(a2)) +
      ' L' + fmt(tip.x) + ',' + fmt(tip.y);
  }

  /** 多行文本：每行一个 <text>，anchor=start|middle */
  function svgTexts(lines, x, top, lineH, cls, anchor, attrs) {
    var out = [];
    lines.forEach(function (l, i) {
      var y = top + (i + 0.5) * lineH;
      out.push('<text class="' + cls + '" x="' + fmt(x) + '" y="' + fmt(y) +
        '" text-anchor="' + (anchor || 'middle') + '" dominant-baseline="middle"' + (attrs || '') + '>' +
        escSvg(l.text) + '</text>');
    });
    return out.join('');
  }

  function edgesArrow(head, tip, from, edgeCls) {
    if (head === 'full') {
      return '<polygon class="hd-arrow" points="' + triPoints(tip, from, 10, 0.5) + '"/>';
    }
    if (head === 'x') {
      return '<path class="hd-arrow-open" d="' + openArrowD(tip, from, 9, 0.55) + '"/>';
    }
    return '<path class="hd-arrow-open" d="' + openArrowD(tip, from, 9, 0.55) + '"/>';
  }

  /** 长轴箭头类型：flow 边只有 full；seq 有 full/open/x */
  function arrowFor(head, tip, from) {
    if (!head) return '';
    return edgesArrow(head, tip, from);
  }

  /** 指令清单 → svg 字符串（dx/dy 用 translate 包装，不烘焙进坐标） */
  function buildSvg(c, ariaLabel) {
    var under = [], edges = [], nodes = [], labels = [];

    c.cmds.forEach(function (cmd) {
      if (cmd.op === 'cluster') {
        var danger = cmd.tone === 'red' ? ' hd-danger' : '';
        under.push('<g class="hd-cluster' + danger + '">' +
          '<rect class="hd-cluster-rect" x="' + fmt(cmd.x) + '" y="' + fmt(cmd.y) +
          '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) + '" rx="10"/>' +
          '<text class="hd-cluster-title" x="' + fmt(cmd.x + 12) + '" y="' + fmt(cmd.y + 13) +
          '" text-anchor="start" dominant-baseline="middle">' + escSvg(cmd.title) + '</text></g>');
      } else if (cmd.op === 'lifeline') {
        under.push('<line class="hd-lifeline" x1="' + fmt(cmd.x) + '" y1="' + fmt(cmd.y0) +
          '" x2="' + fmt(cmd.x) + '" y2="' + fmt(cmd.y1) + '"/>');
      } else if (cmd.op === 'loopBox') {
        var tabW = 52, tabH = 20;
        var box = '<rect class="hd-loopbox-rect" x="' + fmt(cmd.x) + '" y="' + fmt(cmd.y) +
          '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) + '" rx="8"/>' +
          '<rect class="hd-loopbox-tab" x="' + fmt(cmd.x) + '" y="' + fmt(cmd.y) +
          '" width="' + tabW + '" height="' + tabH + '" rx="6"/>' +
          '<text class="hd-loopbox-tab-text" x="' + fmt(cmd.x + tabW / 2) + '" y="' + fmt(cmd.y + tabH / 2) +
          '" text-anchor="middle" dominant-baseline="middle">loop</text>';
        if (cmd.label) {
          box += '<text class="hd-loopbox-label" x="' + fmt(cmd.x + tabW + 5) + '" y="' + fmt(cmd.y + tabH / 2) +
            '" text-anchor="start" dominant-baseline="middle">' + escSvg(cmd.label) + '</text>';
        }
        under.push('<g class="hd-loopbox">' + box + '</g>');
      } else if (cmd.op === 'note') {
        under.push('<g class="hd-note">' +
          '<rect class="hd-note-rect" x="' + fmt(cmd.x) + '" y="' + fmt(cmd.y) +
          '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) + '" rx="6"/>' +
          svgTexts(cmd.lines, cmd.x + cmd.w / 2, cmd.y + 8, cmd.lineH, 'hd-note-text') + '</g>');
      } else if (cmd.op === 'edge') {
        var g = '<polyline class="hd-edge-path" points="' + ptsAttr(cmd.pts) + '" fill="none"/>';
        if (cmd.arrow === 'end' || cmd.arrow === 'both') {
          g += arrowFor('full', cmd.pts[cmd.pts.length - 1], cmd.pts[cmd.pts.length - 2]);
        }
        if (cmd.arrow === 'both') {
          g += arrowFor('full', cmd.pts[0], cmd.pts[1]);
        }
        edges.push('<g class="hd-edge' + (cmd.dash ? ' hd-dash' : '') + '">' + g + '</g>');
      } else if (cmd.op === 'seqMsg') {
        edges.push('<g class="hd-edge hd-seq-msg' + (cmd.dash ? ' hd-dash' : '') + '">' +
          '<line class="hd-edge-path" x1="' + fmt(cmd.x0) + '" y1="' + fmt(cmd.y) +
          '" x2="' + fmt(cmd.x1) + '" y2="' + fmt(cmd.y) + '"/>' +
          arrowFor(cmd.head, { x: cmd.x1, y: cmd.y }, { x: cmd.x0, y: cmd.y }) + '</g>');
      } else if (cmd.op === 'seqSelf') {
        edges.push('<g class="hd-edge hd-seq-self' + (cmd.dash ? ' hd-dash' : '') + '">' +
          '<polyline class="hd-edge-path" fill="none" points="' +
          fmt(cmd.x) + ',' + fmt(cmd.y) + ' ' + fmt(cmd.x + cmd.w) + ',' + fmt(cmd.y) + ' ' +
          fmt(cmd.x + cmd.w) + ',' + fmt(cmd.y + cmd.h) + ' ' + fmt(cmd.x) + ',' + fmt(cmd.y + cmd.h) + '"/>' +
          arrowFor(cmd.head, { x: cmd.x, y: cmd.y + cmd.h }, { x: cmd.x + cmd.w - 10, y: cmd.y + cmd.h }) + '</g>');
      } else if (cmd.op === 'node') {
        var tone = cmd.tone === 'red' ? ' hd-danger' : '';
        if (cmd.shape === 'diamond') {
          nodes.push('<g class="hd-node hd-shape-diamond' + tone + '"><polygon class="hd-node-shape" points="' +
            fmt(cmd.x + cmd.w / 2) + ',' + fmt(cmd.y) + ' ' +
            fmt(cmd.x + cmd.w) + ',' + fmt(cmd.y + cmd.h / 2) + ' ' +
            fmt(cmd.x + cmd.w / 2) + ',' + fmt(cmd.y + cmd.h) + ' ' +
            fmt(cmd.x) + ',' + fmt(cmd.y + cmd.h / 2) + '"/></g>');
        } else if (cmd.shape === 'round') {
          nodes.push('<g class="hd-node hd-shape-round' + tone + '"><rect class="hd-node-shape" x="' + fmt(cmd.x) +
            '" y="' + fmt(cmd.y) + '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) +
            '" rx="' + fmt(Math.min(cmd.h / 2, 20)) + '"/></g>');
        } else if (cmd.shape === 'point') {
          nodes.push('<g class="hd-node hd-shape-point"><circle class="hd-node-point" cx="' +
            fmt(cmd.x + cmd.w / 2) + '" cy="' + fmt(cmd.y + cmd.h / 2) + '" r="10"/></g>');
        } else if (cmd.shape === 'pointEnd') {
          nodes.push('<g class="hd-node hd-shape-pointend"><circle class="hd-node-pointend-outer" cx="' +
            fmt(cmd.x + cmd.w / 2) + '" cy="' + fmt(cmd.y + cmd.h / 2) + '" r="' + fmt((cmd.w - 6) / 2) + '"/>' +
            '<circle class="hd-node-pointend-inner" cx="' + fmt(cmd.x + cmd.w / 2) + '" cy="' +
            fmt(cmd.y + cmd.h / 2) + '" r="' + fmt((cmd.w - 16) / 2) + '"/></g>');
        } else {
          nodes.push('<g class="hd-node hd-shape-rect' + tone + '"><rect class="hd-node-shape" x="' + fmt(cmd.x) +
            '" y="' + fmt(cmd.y) + '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) + '" rx="7"/></g>');
        }
      } else if (cmd.op === 'seqHead') {
        nodes.push('<g class="hd-seq-head"><rect class="hd-seq-head-rect" x="' + fmt(cmd.x) + '" y="' + fmt(cmd.y) +
          '" width="' + fmt(cmd.w) + '" height="' + fmt(cmd.h) + '" rx="8"/>' +
          svgTexts(cmd.lines, cmd.x + cmd.w / 2, cmd.y + (cmd.h - cmd.lines.length * 20) / 2, 20, 'hd-seq-head-text') + '</g>');
      } else if (cmd.op === 'nodeText') {
        labels.push(svgTexts(cmd.lines, cmd.cx, cmd.top, cmd.lineH, 'hd-node-text' + (cmd.tone === 'red' ? ' hd-danger-text' : '')));
      } else if (cmd.op === 'edgeLabel') {
        var w = 0;
        cmd.lines.forEach(function (l) { if (l.w > w) w = l.w; });
        var bh = cmd.lines.length * cmd.lineH + (cmd.bg ? 6 : 0);
        var bgRect = '';
        if (cmd.bg) {
          bgRect = '<rect class="hd-label-bg" x="' + fmt(cmd.cx - (w + 10) / 2) + '" y="' + fmt(cmd.cy - bh / 2) +
            '" width="' + fmt(w + 10) + '" height="' + fmt(bh) + '" rx="4"/>';
        }
        labels.push('<g class="hd-edge-label">' + bgRect +
          svgTexts(cmd.lines, cmd.cx, cmd.cy - cmd.lines.length * cmd.lineH / 2 + (cmd.bg ? 3 : 0), cmd.lineH, 'hd-edge-label-text') + '</g>');
      } else if (cmd.op === 'seqText') {
        labels.push(svgTexts(cmd.lines, cmd.x, cmd.y, cmd.lineH, 'hd-seq-text', cmd.align === 'left' ? 'start' : 'middle'));
      } else if (cmd.op === 'seqNum') {
        labels.push('<text class="hd-seq-num" x="' + fmt(cmd.alignR ? cmd.x - 2 : cmd.x) + '" y="' + fmt(cmd.y) +
          '" text-anchor="' + (cmd.alignR ? 'end' : 'start') + '" dominant-baseline="middle">' + cmd.n + '</text>');
      }
    });

    var W = fmt(c.w), H = fmt(c.h);
    var tran = (c.dx || c.dy) ? ' transform="translate(' + fmt(c.dx || 0) + ' ' + fmt(c.dy || 0) + ')"' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" class="hd-svg" viewBox="0 0 ' + W + ' ' + H +
      '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escSvg(ariaLabel) + '"><g' + tran + '>' +
      '<g class="hd-containers">' + under.join('') + '</g>' +
      '<g class="hd-edges">' + edges.join('') + '</g>' +
      '<g class="hd-nodes">' + nodes.join('') + '</g>' +
      '<g class="hd-labels">' + labels.join('') + '</g>' +
      '</g></svg>';
  }

  /** aria-label：取首个节点/participant 文本，兜底“示意图” */
  function ariaLabelFor(cmds) {
    for (var i = 0; i < cmds.length; i++) {
      var cmd = cmds[i];
      if ((cmd.op === 'nodeText' || cmd.op === 'seqHead') && cmd.lines && cmd.lines.length) {
        var t = cmd.lines.map(function (l) { return l.text; }).join(' ').trim();
        if (t) return (t.length > 60 ? t.slice(0, 57) + '...' : t) + '（示意图）';
      }
    }
    return '示意图';
  }

  /* ================= 公共 API ================= */

  /** source → svg 字符串；不支持时抛错（走 mermaid fallback） */
  function svgStringFor(source) {
    var c = compile(source);
    return buildSvg(c, ariaLabelFor(c.cmds));
  }

  /** 尝试渲染。成功 true；不支持/失败 false（el 已清空，交回 mermaid）。主题切换由 CSS 完成，不重绘。 */
  function render(el, source) {
    if (!global.document || !el) return false;
    try {
      var svg = svgStringFor(source);
      if (el.__hdSvg === svg) return true; // 同图源（如主题切换重扫）：无需重建
      el.innerHTML = '';
      el.innerHTML = svg;
      el.__hdSvg = svg;
      return true;
    } catch (err) {
      try {
        if (global.console && console.debug) console.debug('[handdrawn fallback]', err && err.message);
      } catch (_) { /* noop */ }
      try { el.innerHTML = ''; el.__hdSvg = null; } catch (_) { /* noop */ }
      return false;
    }
  }

  /** 主题切换不再需要重绘（颜色全在 CSS 变量里）；保留作空实现以兼容旧调用点。 */
  function rerenderAll() {}

  var Api = {
    render: render,
    rerenderAll: rerenderAll,
    __buildSvg: buildSvg,
    __svgStringFor: svgStringFor,
    __compile: compile,
    __parseFlow: parseFlow,
    __parseSequence: parseSequence,
    __setMeasure: setMeasure
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Api;
  } else {
    global.__hd = Api;
    if (global.document) measureFn = browserMeasure;
  }
})(typeof window !== 'undefined' ? window : this);
