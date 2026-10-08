/**
 * handdrawn.js — mermaid 子集 → 原生 Canvas 2D 渲染器（简约科技风）
 *
 * 管道：parse（mermaid 子集 → 模型）→ layout（模型 → 指令清单，纯函数）
 *       → drawCommands（指令清单 → canvas，crisp 细线）
 * parse/layout 不依赖 DOM，可在 node 下测试；浏览器中通过 window.__hd 暴露。
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
  var FLOW_MAX_W = 2600, FLOW_MAX_H = 2600;
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

  /** 贪心逐字换行；返回 [{text, w}] */
  function wrapLine(line, maxW, size) {
    if (maxW <= 0) return [{ text: line, w: measureLine(line, size) }];
    var out = [], buf = '', bufW = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var cw = measureLine(ch, size);
      if (buf && bufW + cw > maxW) {
        // 避免行首标点（中英文常见标点不抬行）
        if (/^[，。、；：）】》！？,.;:)\]!?%]/.test(ch)) {
          buf += ch; bufW += cw; i++;
          if (i < line.length) { ch = ''; }
        } else {
          out.push({ text: buf, w: bufW });
          buf = ch; bufW = cw; ch = '';
        }
      }
      if (ch) { buf += ch; bufW += cw; }
    }
    if (buf || !out.length) out.push({ text: buf || line, w: buf ? bufW : measureLine(line, size) });
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

  var MARGIN = 26, HGAP = 48, VGAP = 42;
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

  /* ================= flow 驱动布局（两层：容器内 + 单元间） ================= */

  function epIsNode(ep) { return ep && ep.node != null; }

  // 把 rank 容器（sub）和 lone 节点统一为单元
  function buildUnits(state) {
    var units = []; // {key, sub?|node?, w, h}
    var unitOfNode = {};
    state.subs.forEach(function (sub) {
      units.push({ key: 'U' + sub.idx, sub: sub.idx });
      sub.members.forEach(function (id) { unitOfNode[id] = 'U' + sub.idx; });
    });
    state.order.forEach(function (id) {
      if (unitOfNode[id] == null) {
        var key = 'N' + id;
        unitOfNode[id] = key;
        units.push({ key: key, node: id });
      }
    });
    var unitByKey = {};
    units.forEach(function (u) { unitByKey[u.key] = u; });
    function unitOfEp(ep) {
      if (ep.sub != null) return 'U' + ep.sub;
      return unitOfNode[ep.node] || null;
    }
    return { units: units, unitByKey: unitByKey, unitOfEp: unitOfEp };
  }

  function sizeSub(state, sub) {
    // 容器内部布局（dir 可被子图的 direction 覆盖）
    var dir = sub.dir || state.dir;
    var nodeMap = state.nodes;
    var ids = sub.members.filter(function (id) { return nodeMap[id] && !nodeMap[id].pseudo; });
    if (!ids.length) { sub.layout = null; sub.cw = 60; sub.ch = 44; return; }
    var innerEdges = state.edges.filter(function (e) {
      return epIsNode(e.s) && epIsNode(e.t) &&
             ids.indexOf(e.s.node) >= 0 && ids.indexOf(e.t.node) >= 0;
    });
    var lev = layoutLevel(ids, nodeMap, innerEdges, dir);
    sub.layout = lev;
    // 内容包围盒
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    ids.forEach(function (id) {
      var p = lev.pos[id], n = nodeMap[id];
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w); maxY = Math.max(maxY, p.y + n.h);
    });
    sub.contentBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    sub.cw = sub.contentBox.w + SUB_PADX * 2;
    sub.ch = sub.contentBox.h + SUB_PADY * 2 + SUB_TITLE_H;
  }

  var SUB_PADX = 18, SUB_PADY = 16, SUB_TITLE_H = 30;

  function layoutFlow(state) {
    // 1. 节点测尺寸
    state.order.forEach(function (id) { sizeNode(state.nodes[id]); });
    // 2. 容器内部
    state.subs.forEach(function (sub) { sizeSub(state, sub); });
    // 3. 单元间布局
    var U = buildUnits(state);
    U.units.forEach(function (u) {
      if (u.sub != null) {
        var sub = state.subs[u.sub];
        u.w = sub.cw; u.h = sub.ch;
      } else {
        var n = state.nodes[u.node];
        u.w = n.w; u.h = n.h;
      }
    });
    var unitEdges = [];
    state.edges.forEach(function (e) {
      var a = U.unitOfEp(e.s), b = U.unitOfEp(e.t);
      if (a && b && a !== b) {
        unitEdges.push({ s: a, t: b, invis: e.invis });
      }
    });
    var unitMap = {};
    U.units.forEach(function (u) { unitMap[u.key] = u; });
    var levU = layoutLevel(U.units.map(function (u) { return u.key; }), unitMap, unitEdges, state.dir);

    // 4. 绝对位置：单元 → 容器 → 节点
    var nodeGeom = {}, subGeom = {};
    U.units.forEach(function (u) {
      var p = levU.pos[u.key];
      if (u.sub != null) {
        var sub = state.subs[u.sub];
        subGeom[u.sub] = { x: p.x, y: p.y, w: u.w, h: u.h, title: sub.title, tone: sub.tone || '' };
        if (sub.layout) {
          var ox = p.x + SUB_PADX - sub.contentBox.x;
          var oy = p.y + SUB_PADY + SUB_TITLE_H - sub.contentBox.y;
          sub.members.forEach(function (id) {
            var ip = sub.layout.pos[id];
            if (!ip) return;
            var n = state.nodes[id];
            nodeGeom[id] = { x: ox + ip.x, y: oy + ip.y, w: n.w, h: n.h };
          });
        }
      } else {
        nodeGeom[u.node] = { x: p.x, y: p.y, w: u.w, h: u.h };
      }
    });

    // 5. 画布边界
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    function grow(x, y, w, h) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    Object.keys(nodeGeom).forEach(function (id) {
      var g = nodeGeom[id]; grow(g.x, g.y, g.w, g.h);
    });
    Object.keys(subGeom).forEach(function (k) {
      var g = subGeom[k]; grow(g.x, g.y, g.w, g.h);
    });

    return { nodeGeom: nodeGeom, subGeom: subGeom, state: state, levU: levU };
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
  /* ================= 主题（简约科技风，Linear/Vercel 色系） ================= */

  var THEMES = {
    light: {
      stroke: '#8b949e', text: '#1f2328', muted: '#65707d',
      nodeFill: '#ffffff', nodeStroke: '#d0d7de',
      clusterFill: '#f8fafc', clusterStroke: '#d0d7de', clusterText: '#8b949e',
      red: '#cf222e', redFill: '#ffeff0',
      labelBg: '#ffffff', labelText: '#57606a',
      noteFill: '#fff8dc', noteStroke: '#e6d27e', noteText: '#7a5c00',
      lifeline: '#d0d7de',
      accent: '#2563eb', accentFill: '#eff6ff', accentText: '#1d4ed8',
      loopTabFill: '#ffffff', loopTabStroke: '#d0d7de', loopTabText: '#6e7781'
    },
    dark: {
      stroke: '#7d8590', text: '#e6edf3', muted: '#848d97',
      nodeFill: '#161b22', nodeStroke: '#30363d',
      clusterFill: '#11161d', clusterStroke: '#30363d', clusterText: '#6e7681',
      red: '#ff7b72', redFill: '#3d2027',
      labelBg: '#161b22', labelText: '#adb7c1',
      noteFill: '#322d12', noteStroke: '#8c6f35', noteText: '#d0a94b',
      lifeline: '#30363d',
      accent: '#4493f8', accentFill: '#0f1f3a', accentText: '#93c5fd',
      loopTabFill: '#161b22', loopTabStroke: '#30363d', loopTabText: '#848d97'
    }
  };

  /* ================= 原生 Canvas 2D 绘制（crisp 细线） ================= */

  function setFont(ctx, size, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
    ctx.textBaseline = 'middle';
  }

  function fillLines(ctx, lines, cx, top, lineH, align, color) {
    ctx.fillStyle = color;
    lines.forEach(function (l, i) {
      var y = top + (i + 0.5) * lineH;
      var x = align === 'left' ? cx : cx - l.w / 2;
      ctx.fillText(l.text, x, y);
    });
  }

  /** 圆角矩形路径；ctx.roundRect 缺失时降级普通 rect */
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else if (r > 0) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }
  }

  function fillAndStroke(ctx, fill, stroke, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1.25;
      ctx.stroke();
    }
  }

  function polyline(ctx, pts, color, lw, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || 1.4;
    ctx.lineJoin = 'miter';
    ctx.setLineDash(dash || []);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function circle(ctx, cx, cy, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    fillAndStroke(ctx, fill, stroke, lw || 1.25);
  }

  function diamond(ctx, x, y, w, h, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w / 2, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
    fillAndStroke(ctx, fill, stroke, lw || 1.25);
  }

  function triangle(ctx, tip, dirX, dirY, size, spread, color) {
    var ang = Math.atan2(dirY, dirX);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - size * Math.cos(ang - spread), tip.y - size * Math.sin(ang - spread));
    ctx.lineTo(tip.x - size * Math.cos(ang + spread), tip.y - size * Math.sin(ang + spread));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawArrowHead(ctx, theme, tip, from, head, color) {
    var dX = tip.x - from.x, dY = tip.y - from.y;
    if (!dX && !dY) return;
    var ang = Math.atan2(dY, dX);
    if (head === 'full') {
      triangle(ctx, tip, dX, dY, 10, 0.5, color);
    } else if (head === 'x') {
      polyline(ctx, [
        { x: tip.x - 7 * Math.cos(ang - 0.55), y: tip.y - 7 * Math.sin(ang - 0.55) },
        { x: tip.x + 0, y: tip.y }
      ], color, 1.4);
      polyline(ctx, [
        { x: tip.x - 7 * Math.cos(ang + 0.55), y: tip.y - 7 * Math.sin(ang + 0.55) },
        { x: tip.x, y: tip.y }
      ], color, 1.4);
    } else { // open：两条斜线组成的空心箭头
      var a1 = ang + 0.55, a2 = ang - 0.55, len = 9;
      polyline(ctx, [
        { x: tip.x - len * Math.cos(a1), y: tip.y - len * Math.sin(a1) }, tip
      ], color, 1.4);
      polyline(ctx, [
        { x: tip.x - len * Math.cos(a2), y: tip.y - len * Math.sin(a2) }, tip
      ], color, 1.4);
    }
  }

  function nodePalette(c, theme) {
    return {
      stroke: c.tone === 'red' ? theme.red : theme.nodeStroke,
      fill: c.tone === 'red' ? theme.redFill : theme.nodeFill,
      text: c.tone === 'red' ? theme.red : theme.text
    };
  }

  function drawCommands(canvas, cmds, dx, dy, theme) {
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(dx || 0, dy || 0);

    // 分层：底层（容器/生命周期/循环框/note）→ 边 → 节点 → 文本
    var layers = { under: [], edges: [], nodes: [], texts: [] };
    cmds.forEach(function (c) {
      if (c.op === 'cluster' || c.op === 'lifeline' || c.op === 'loopBox' || c.op === 'note') layers.under.push(c);
      else if (c.op === 'edge' || c.op === 'seqMsg' || c.op === 'seqSelf') layers.edges.push(c);
      else if (c.op === 'node' || c.op === 'seqHead') layers.nodes.push(c);
      else layers.texts.push(c);
    });

    layers.under.forEach(function (c) {
      if (c.op === 'cluster') {
        ctx.save();
        ctx.setLineDash(c.tone === 'red' ? [] : [5, 4]);
        rr(ctx, c.x, c.y, c.w, c.h, 10);
        fillAndStroke(ctx, c.tone === 'red' ? theme.redFill : theme.clusterFill,
          c.tone === 'red' ? theme.red : theme.clusterStroke, 1);
        ctx.restore();
        setFont(ctx, 12, true);
        fillLines(ctx, [{ text: c.title, w: measureLine(c.title, 12) }], c.x + 12, c.y + 7, 14, 'left',
          c.tone === 'red' ? theme.red : theme.clusterText);
      } else if (c.op === 'lifeline') {
        polyline(ctx, [{ x: c.x, y: c.y0 }, { x: c.x, y: c.y1 }], theme.lifeline, 1.2, [4, 4]);
      } else if (c.op === 'loopBox') {
        ctx.save();
        ctx.setLineDash([4, 3]);
        rr(ctx, c.x, c.y, c.w, c.h, 8);
        fillAndStroke(ctx, null, theme.clusterStroke, 1);
        ctx.restore();
        var tabW = 52, tabH = 20;
        rr(ctx, c.x, c.y, tabW, tabH, 6);
        fillAndStroke(ctx, theme.loopTabFill, theme.loopTabStroke, 1);
        setFont(ctx, LOOP_FS, true);
        fillLines(ctx, [{ text: 'loop', w: measureLine('loop', LOOP_FS) }], c.x + tabW / 2,
          c.y + (tabH - LOOP_FS * 1.3) / 2, LOOP_FS * 1.3, 'center', theme.loopTabText);
        if (c.label) {
          setFont(ctx, LOOP_FS, false);
          fillLines(ctx, [{ text: c.label, w: measureLine(c.label, LOOP_FS) }],
            c.x + tabW + measureLine(c.label, LOOP_FS) / 2 + 5,
            c.y + (tabH - LOOP_FS * 1.3) / 2, LOOP_FS * 1.3, 'center', theme.muted);
        }
      } else if (c.op === 'note') {
        rr(ctx, c.x, c.y, c.w, c.h, 6);
        fillAndStroke(ctx, theme.noteFill, theme.noteStroke, 1);
        setFont(ctx, c.size || NOTE_FS, false);
        fillLines(ctx, c.lines, c.x + c.w / 2, c.y + 8, c.lineH, 'center', theme.noteText);
      }
    });

    layers.edges.forEach(function (c) {
      if (c.op === 'edge') {
        polyline(ctx, c.pts, theme.stroke, 1.4, c.dash ? [6, 4] : null);
        if (c.arrow === 'end' || c.arrow === 'both') {
          drawArrowHead(ctx, theme, c.pts[c.pts.length - 1], c.pts[c.pts.length - 2], 'full', theme.stroke);
        }
        if (c.arrow === 'both') {
          drawArrowHead(ctx, theme, c.pts[0], c.pts[1], 'full', theme.stroke);
        }
      } else if (c.op === 'seqMsg') {
        polyline(ctx, [{ x: c.x0, y: c.y }, { x: c.x1, y: c.y }], theme.stroke, 1.3, c.dash ? [6, 4] : null);
        drawArrowHead(ctx, theme, { x: c.x1, y: c.y }, { x: c.x0, y: c.y }, c.head, theme.stroke);
      } else if (c.op === 'seqSelf') {
        polyline(ctx, [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }],
          theme.stroke, 1.3, c.dash ? [6, 4] : null);
        drawArrowHead(ctx, theme, { x: c.x, y: c.y + c.h }, { x: c.x + c.w - 10, y: c.y + c.h }, c.head, theme.stroke);
      }
    });

    layers.nodes.forEach(function (c) {
      if (c.op === 'node') {
        var pal = nodePalette(c, theme);
        if (c.shape === 'diamond') {
          diamond(ctx, c.x, c.y, c.w, c.h, pal.fill, pal.stroke, 1.25);
        } else if (c.shape === 'round') {
          rr(ctx, c.x, c.y, c.w, c.h, Math.min(c.h / 2, 20));
          fillAndStroke(ctx, pal.fill, pal.stroke, 1.25);
        } else if (c.shape === 'point') {
          circle(ctx, c.x + c.w / 2, c.y + c.h / 2, 10, theme.stroke, theme.stroke, 1);
        } else if (c.shape === 'pointEnd') {
          circle(ctx, c.x + c.w / 2, c.y + c.h / 2, (c.w - 6) / 2, theme.nodeFill, theme.stroke, 1.6);
          circle(ctx, c.x + c.w / 2, c.y + c.h / 2, (c.w - 16) / 2, theme.stroke, theme.stroke, 1);
        } else {
          rr(ctx, c.x, c.y, c.w, c.h, 7);
          fillAndStroke(ctx, pal.fill, pal.stroke, 1.25);
        }
      } else if (c.op === 'seqHead') {
        // sequence 头部框：唯一强调色（科技蓝）
        rr(ctx, c.x, c.y, c.w, c.h, 8);
        fillAndStroke(ctx, theme.accentFill, theme.accent, 1.4);
        setFont(ctx, c.size || PART_FS, true);
        fillLines(ctx, c.lines, c.x + c.w / 2, c.y + (c.h - c.lines.length * 20) / 2, 20, 'center', theme.accentText);
      }
    });

    layers.texts.forEach(function (c) {
      if (c.op === 'nodeText') {
        setFont(ctx, c.size, false);
        fillLines(ctx, c.lines, c.cx, c.top, c.lineH, 'center',
          c.tone === 'red' ? theme.red : theme.text);
      } else if (c.op === 'edgeLabel') {
        var w = 0;
        c.lines.forEach(function (l) { w = Math.max(w, l.w); });
        var bh = c.lines.length * c.lineH + (c.bg ? 6 : 0), bw = w + (c.bg ? 10 : 0);
        if (c.bg) {
          rr(ctx, c.cx - bw / 2, c.cy - bh / 2, bw, bh, 4);
          ctx.fillStyle = theme.labelBg;
          ctx.fill();
        }
        setFont(ctx, c.size, false);
        fillLines(ctx, c.lines, c.cx, c.cy - c.lines.length * c.lineH / 2, c.lineH, 'center', theme.labelText);
      } else if (c.op === 'seqText') {
        setFont(ctx, c.size || MSGLABEL_FS, false);
        fillLines(ctx, c.lines, c.x, c.y, c.lineH, c.align || 'center', theme.text);
      } else if (c.op === 'seqNum') {
        setFont(ctx, 11, true);
        var t = String(c.n);
        var x = c.alignR ? c.x - measureLine(t, 11) - 2 : c.x;
        fillLines(ctx, [{ text: t, w: measureLine(t, 11) }], x, c.y - 4, 11, 'left', theme.muted);
      }
    });

    ctx.restore();
  }

  /* ================= 公共 API ================= */

  var registry = [];

  function isDark() {
    try {
      return !!(global.document && document.body && document.body.classList.contains('dark'));
    } catch (e) { return false; }
  }

  function setupCanvas(w, h) {
    var canvas = document.createElement('canvas');
    var dpr = Math.min(2.5, global.devicePixelRatio || 1);
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.maxWidth = '100%';
    canvas.style.display = 'block';
    canvas.setAttribute('data-hd', '1');
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return canvas;
  }

  function paintToCanvas(c) {
    var canvas = setupCanvas(c.w, c.h);
    drawCommands(canvas, c.cmds, c.dx || 0, c.dy || 0, isDark() ? THEMES.dark : THEMES.light);
    return canvas;
  }

  /** 尝试手绘渲染。成功 true；不支持/失败 false（el 已清空，交回 mermaid） */
  function render(el, source) {
    if (!global.document || !el) return false;
    try {
      var c = compile(source);
      el.innerHTML = '';
      var canvas = paintToCanvas(c);
      el.appendChild(canvas);
      registry = registry.filter(function (r) { return r.el !== el; });
      registry.push({ el: el, source: source });
      return true;
    } catch (err) {
      try {
        if (global.console && console.debug) console.debug('[handdrawn fallback]', err && err.message);
      } catch (_) { /* noop */ }
      try { el.innerHTML = ''; } catch (_) { /* noop */ }
      return false;
    }
  }

  /** 主题切换时重绘全部已转换图 */
  function rerenderAll() {
    var alive = [];
    registry.forEach(function (r) {
      if (!r.el || (r.el.isConnected === false)) return;
      try {
        var c = compile(r.source);
        r.el.innerHTML = '';
        r.el.appendChild(paintToCanvas(c));
        alive.push(r);
      } catch (e) {
        alive.push(r); // 保留原图，避免闪空
      }
    });
    registry = alive;
  }

  var Api = {
    render: render,
    rerenderAll: rerenderAll,
    __compile: compile,
    __parseFlow: parseFlow,
    __parseSequence: parseSequence,
    __setMeasure: setMeasure,
    __THEMES: THEMES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Api;
  } else {
    global.__hd = Api;
    if (global.document) measureFn = browserMeasure;
  }
})(typeof window !== 'undefined' ? window : this);
