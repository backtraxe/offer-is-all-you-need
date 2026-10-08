/* offer-is-all-you-need 站点交互增强：
 * - mermaid 主题化渲染（深浅双色）
 * - mermaid 点击放大浮层（拖拽平移 + 滚轮缩放）
 * - 表格横向滚动包裹
 * - 暗黑模式开关（记忆偏好）
 * - 阅读进度条
 */
(function () {
  'use strict';

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif';

  /* ---------- mermaid ---------- */

  function mermaidConfig() {
    var dark = document.body.classList.contains('dark');
    // 白板风：默认节点全白（暗色统一深阶），内容层自定义语义色保留（亮色）
    var vars = dark ? {
      background: 'transparent', primaryColor: '#1a2436', primaryTextColor: '#e2e8f0',
      primaryBorderColor: '#3b475c', secondaryColor: '#141c2b', tertiaryColor: '#141c2b',
      mainBkg: '#1a2436', titleColor: '#f1f5f9', lineColor: '#64748b', textColor: '#b6c1d0',
      clusterBkg: '#141c2b', clusterBorder: '#2a364d', edgeLabelBackground: '#141c2b',
      actorBkg: '#1a2436', actorBorder: '#3b475c', actorTextColor: '#e2e8f0', actorLineColor: '#3b475c',
      signalColor: '#94a3b8', signalTextColor: '#b6c1d0', labelBoxBkgColor: '#1a2436',
      labelBoxBorderColor: '#3b475c', labelTextColor: '#e2e8f0', loopTextColor: '#8b99ad',
      noteBkgColor: '#1a2436', noteBorderColor: '#3b475c', noteTextColor: '#b6c1d0',
      activationBkgColor: '#2a364d', activationBorderColor: '#3b475c'
    } : {
      background: 'transparent', primaryColor: '#ffffff', primaryTextColor: '#0f172a',
      primaryBorderColor: '#dbe3ec', secondaryColor: '#f6f8fa', tertiaryColor: '#f6f8fa',
      mainBkg: '#ffffff', titleColor: '#0f172a', lineColor: '#94a3b8', textColor: '#334155',
      clusterBkg: '#f6f8fa', clusterBorder: '#e2e8f0', edgeLabelBackground: '#ffffff',
      actorBkg: '#ffffff', actorBorder: '#dbe3ec', actorTextColor: '#0f172a', actorLineColor: '#dbe3ec',
      signalColor: '#64748b', signalTextColor: '#334155', labelBoxBkgColor: '#ffffff',
      labelBoxBorderColor: '#dbe3ec', labelTextColor: '#0f172a', loopTextColor: '#64748b',
      noteBkgColor: '#f6f8fa', noteBorderColor: '#e2e8f0', noteTextColor: '#334155',
      activationBkgColor: '#eef2f7', activationBorderColor: '#dbe3ec'
    };
    return {
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: vars,
      fontFamily: FONT,
      flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: false, wrappingWidth: 280 }
    };
  }

  function ensureZoomHint(el) {
    if (el.querySelector('.mermaid-zoom-hint')) return;
    var h = document.createElement('span');
    h.className = 'mermaid-zoom-hint';
    h.textContent = '点击放大';
    el.prepend(h);
  }

  function renderMermaidDiagrams() {
    if (!window.mermaid) return;
    mermaid.initialize(mermaidConfig());
    var pending = [];
    document.querySelectorAll('.mermaid').forEach(function (el) {
      var id = parseInt(el.getAttribute('data-mermaid-id'), 10);
      if (isNaN(id) || window.__mermaidSources[id] === undefined) return;
      // 优先走自研 SVG 渲染（vector）；不支持或失败再回到 mermaid
      if (window.__hd && window.__hd.render(el, window.__mermaidSources[id])) {
        ensureZoomHint(el);
        return;
      }
      el.removeAttribute('data-processed');
      // textContent 赋值不走 HTML 解析，<br/> 与引号保持字面量给 mermaid
      el.textContent = window.__mermaidSources[id];
      pending.push(el);
    });
    if (!pending.length) return;
    mermaid.run({ nodes: pending })
      .catch(function (e) { console.warn('mermaid render:', e); })
      .finally(function () { pending.forEach(ensureZoomHint); });
  }

  /* ---------- 图表放大浮层 ---------- */

  var modal = null, stage = null, canvas = null;
  var view = { scale: 1, x: 0, y: 0 };

  function applyTransform() {
    stage.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
  }

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'mermaid-modal';
    modal.innerHTML =
      '<div class="mz-canvas"><div class="mz-stage"></div></div>' +
      '<div class="mz-toolbar">' +
      '<button type="button" data-act="out">−</button>' +
      '<button type="button" data-act="in">＋</button>' +
      '<button type="button" data-act="reset">复位</button>' +
      '<button type="button" data-act="close">✕</button>' +
      '</div>';
    document.body.appendChild(modal);
    canvas = modal.querySelector('.mz-canvas');
    stage = modal.querySelector('.mz-stage');

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target === canvas) closeModal();
    });
    modal.querySelector('.mz-toolbar').addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'close') closeModal();
      if (act === 'reset') { view = { scale: 1, x: 0, y: 0 }; fitToCanvas(); }
      if (act === 'in') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25);
      if (act === 'out') zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8);
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.9);
    }, { passive: false });

    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      view.x = drag.vx + (e.clientX - drag.x);
      view.y = drag.vy + (e.clientY - drag.y);
      applyTransform();
    });
    canvas.addEventListener('pointerup', function () { drag = null; });
    canvas.addEventListener('pointercancel', function () { drag = null; });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  function zoomAt(cx, cy, factor) {
    var next = Math.min(6, Math.max(0.15, view.scale * factor));
    var k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    applyTransform();
  }

  function fitToCanvas() {
    var node = stage.querySelector('svg');
    if (!node) { applyTransform(); return; }
    view.x = 0; view.y = 0; view.scale = 1;
    stage.style.transform = 'none';
    var w = node.getBoundingClientRect().width;
    var h = node.getBoundingClientRect().height;
    if (w > 0 && h > 0) {
      view.scale = Math.min(canvas.clientWidth / (w + 48), canvas.clientHeight / (h + 48), 3);
      view.x = (canvas.clientWidth - w * view.scale) / 2;
      view.y = (canvas.clientHeight - h * view.scale) / 2;
    }
    applyTransform();
  }

  function openMermaidModal(el) {
    ensureModal();
    var svg = el.querySelector('svg');
    if (!svg) return;
    stage.innerHTML = '';
    stage.appendChild(svg.cloneNode(true));
    // HD-SVG 的配色由 body.dark 下的 CSS 变量驱动，暗色时给浮层补深底
    canvas.style.background =
      (svg.classList.contains('hd-svg') && document.body.classList.contains('dark')) ? '#0d1117' : '';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    view = { scale: 1, x: 0, y: 0 };
    fitToCanvas();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('.mermaid-modal, .mermaid');
    if (!d || d.classList.contains('mermaid-modal')) return;
    if (d.classList.contains('mermaid')) openMermaidModal(d);
  });

  /* ---------- 表格手机端横向滚动 ---------- */

  function wrapTables() {
    document.querySelectorAll('.markdown-section table').forEach(function (t) {
      if (t.parentElement && t.parentElement.classList.contains('table-scroll')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
  }

  /* ---------- 暗黑模式 ---------- */

  function setDark(dark, rerender) {
    document.body.classList.toggle('dark', dark);
    var link = document.getElementById('main-theme');
    var name = dark ? 'dark' : 'vue';
    link.href = link.href.replace(/themes\/\w+\.css/, 'themes/' + name + '.css');
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = dark ? '<i class="ti ti-sun"></i>' : '<i class="ti ti-moon-stars"></i>';
    try { localStorage.setItem('oiayn-theme', dark ? 'dark' : 'light'); } catch (e) {}
    // HD-SVG 的主题由 CSS 变量随 body.dark 自动切换，无需重绘
    if (rerender) renderMermaidDiagrams();
  }

  function initThemeToggle() {
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.type = 'button';
    btn.title = '切换深色模式';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      setDark(!document.body.classList.contains('dark'), true);
    });
    var saved = null;
    try { saved = localStorage.getItem('oiayn-theme'); } catch (e) {}
    var prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(saved ? saved === 'dark' : prefersDark, false);
  }

  /* ---------- 阅读进度条 ---------- */

  function initProgressBar() {
    var bar = document.createElement('div');
    bar.id = 'reading-progress';
    document.body.appendChild(bar);
    document.addEventListener('scroll', function () {
      var h = document.documentElement;
      var total = h.scrollHeight - h.clientHeight;
      bar.style.width = total > 0 ? (h.scrollTop / total * 100) + '%' : '0';
    }, { capture: true, passive: true });
  }

  /* ---------- 挂载 docsify 钩子 ---------- */

  window.$docsify.plugins.push(function (hook) {
    hook.doneEach(function () {
      renderMermaidDiagrams();
      wrapTables();
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    initProgressBar();
  });
})();
