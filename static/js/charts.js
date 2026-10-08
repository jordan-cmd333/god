/* Graphiques Budget Control — canvas natif, aucune dependance externe.
   Chaque <canvas data-chart="donut|bars|line" data-series="[...]"> est rendu
   automatiquement, redessine net sur ecran haute densite, s'adapte au theme
   (clair / sombre) et reagit au tap (bulle de valeur). */

(function () {
  'use strict';

  var MUTED = '#94a3b8', GRID = '#e9edf1', TEAL = '#0f766e', TEXT = '#0f172a',
      SURFACE = '#ffffff', BORDER = '#e5e8ec';

  function refreshColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fb) { var x = cs.getPropertyValue(name).trim(); return x || fb; }
    MUTED = v('--muted', '#94a3b8');
    GRID = v('--chart-grid', '#e9edf1');
    TEAL = v('--primary', '#0f766e');
    TEXT = v('--chart-text', '#0f172a');
    SURFACE = v('--surface', '#ffffff');
    BORDER = v('--border', '#e5e8ec');
  }

  // Convertit une couleur #rrggbb en rgba(...) avec alpha (pour les degrades).
  function rgba(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
    if (!m) return 'rgba(15, 118, 110, ' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function setup(canvas, height) {
    var ratio = window.devicePixelRatio || 1;
    var width = canvas.parentNode.clientWidth || canvas.clientWidth || 300;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = height + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px system-ui, sans-serif';
    return { ctx: ctx, w: width, h: height };
  }

  function compact(value) {
    if (value >= 1000000) return (value / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1).replace('.0', '') + 'k';
    return String(Math.round(value));
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Bulle de valeur (tooltip) ancree en (x, y), maintenue dans le cadre.
  function bubble(ctx, w, x, y, lines) {
    ctx.font = '600 11px system-ui, sans-serif';
    var pad = 7, lh = 14;
    var tw = 0;
    lines.forEach(function (t, i) { ctx.font = (i === 0 ? '700 12px' : '11px') + ' system-ui, sans-serif'; tw = Math.max(tw, ctx.measureText(t).width); });
    var bw = tw + pad * 2, bh = lines.length * lh + pad * 2 - 4;
    var bx = Math.max(4, Math.min(w - bw - 4, x - bw / 2));
    var by = Math.max(4, y - bh - 10);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = SURFACE; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1; ctx.strokeStyle = BORDER; ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'left';
    lines.forEach(function (t, i) {
      ctx.font = (i === 0 ? '700 12px' : '11px') + ' system-ui, sans-serif';
      ctx.fillStyle = i === 0 ? TEXT : MUTED;
      ctx.fillText(t, bx + pad, by + pad + 10 + i * lh);
    });
  }

  /* -------------------------------------------------------------- Donut */

  function donut(canvas, data, hi) {
    var s = setup(canvas, 210), ctx = s.ctx;
    var total = data.reduce(function (a, d) { return a + d.value; }, 0);
    var cx = s.w / 2, cy = s.h / 2;
    var radius = Math.min(s.w, s.h) / 2 - 8;
    var inner = radius * 0.64;
    var mid = (radius + inner) / 2, lw = radius - inner;

    // Anneau de fond.
    ctx.beginPath();
    ctx.arc(cx, cy, mid, 0, Math.PI * 2);
    ctx.lineWidth = lw; ctx.strokeStyle = GRID; ctx.lineCap = 'butt';
    ctx.stroke();

    canvas._hit = null;
    if (!total) {
      ctx.fillStyle = MUTED; ctx.textAlign = 'center';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Aucune donnee', cx, cy + 4);
      return;
    }

    var gap = data.length > 1 ? 0.045 : 0;
    var segs = [];
    var angle = -Math.PI / 2;
    data.forEach(function (d, i) {
      var slice = (d.value / total) * Math.PI * 2;
      segs.push({ a0: angle, a1: angle + slice, i: i });
      // L'espacement ne doit jamais depasser la part, sinon l'arc se dessine
      // a l'envers (fin < debut) et repeint tout l'anneau. On le borne a la
      // moitie de la part : chaque couleur reste visible, meme minuscule.
      var g = Math.min(gap, slice * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, mid, angle + g / 2, angle + slice - g / 2);
      ctx.lineWidth = (hi === i ? lw + 5 : lw);
      ctx.lineCap = g > 0.012 ? 'round' : 'butt';
      ctx.strokeStyle = d.color || TEAL;
      ctx.globalAlpha = (hi == null || hi === i) ? 1 : 0.32;
      ctx.stroke();
      angle += slice;
    });
    ctx.globalAlpha = 1;

    // Centre : total, ou la part survolee.
    ctx.textAlign = 'center';
    if (hi != null && data[hi]) {
      var sh = Math.round((data[hi].value / total) * 100);
      ctx.fillStyle = TEXT; ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(sh + ' %', cx, cy - 1);
      ctx.fillStyle = MUTED; ctx.font = '11px system-ui, sans-serif';
      ctx.fillText((data[hi].label || '').slice(0, 14), cx, cy + 16);
    } else {
      ctx.fillStyle = TEXT; ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(compact(total), cx, cy + 1);
      ctx.fillStyle = MUTED; ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('total', cx, cy + 18);
    }

    canvas._hit = function (x, y) {
      var dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < inner - 6 || dist > radius + 6) return null;
      var a = Math.atan2(dy, dx);
      if (a < -Math.PI / 2) a += Math.PI * 2;
      for (var k = 0; k < segs.length; k++) if (a >= segs[k].a0 && a < segs[k].a1) return segs[k].i;
      return null;
    };
  }

  /* --------------------------------------------------------------- Bars */

  function bars(canvas, data, hi) {
    var s = setup(canvas, 210), ctx = s.ctx;
    var padLeft = 6, padRight = 6, padTop = 20, padBottom = 26;
    var plotW = s.w - padLeft - padRight, plotH = s.h - padTop - padBottom;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));

    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padLeft, padTop + plotH + .5); ctx.lineTo(padLeft + plotW, padTop + plotH + .5); ctx.stroke();

    var slot = plotW / Math.max(data.length, 1);
    var barW = Math.min(slot * 0.6, 42);
    var active = hi != null ? hi : data.length - 1;   // dernier mis en avant par defaut

    data.forEach(function (d, i) {
      var h = Math.max((d.value / max) * plotH, d.value > 0 ? 3 : 0);
      var x = padLeft + slot * i + (slot - barW) / 2;
      var y = padTop + plotH - h;
      var base = d.color || TEAL;
      var grad = ctx.createLinearGradient(0, y, 0, padTop + plotH);
      grad.addColorStop(0, base);
      grad.addColorStop(1, rgba(base.charAt(0) === '#' ? base : TEAL, 0.55));
      ctx.fillStyle = base.charAt(0) === '#' ? grad : base;
      ctx.globalAlpha = (i === active || hi == null) ? 1 : 0.5;
      roundRect(ctx, x, y, barW, Math.max(h, 2), Math.min(6, barW / 2));
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.textAlign = 'center';
      if (d.value > 0) {
        ctx.fillStyle = TEXT; ctx.font = (i === active ? '700' : '600') + ' 11px system-ui, sans-serif';
        ctx.fillText(compact(d.value), x + barW / 2, y - 6);
      }
      ctx.fillStyle = MUTED; ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(d.label, x + barW / 2, s.h - 8);
    });

    canvas._hit = function (x) {
      var i = Math.floor((x - padLeft) / slot);
      return (i >= 0 && i < data.length) ? i : null;
    };
  }

  /* --------------------------------------------------------------- Line */

  function smooth(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      ctx.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1]);
    }
  }

  function line(canvas, data, hi) {
    if (data.length < 2) { bars(canvas, data, hi); return; }
    var s = setup(canvas, 190), ctx = s.ctx;
    var padLeft = 8, padRight = 8, padTop = 18, padBottom = 24;
    var plotW = s.w - padLeft - padRight, plotH = s.h - padTop - padBottom;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));

    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    for (var g = 0; g <= 2; g++) {
      var gy = padTop + (plotH / 2) * g + .5;
      ctx.beginPath(); ctx.moveTo(padLeft, gy); ctx.lineTo(padLeft + plotW, gy); ctx.stroke();
    }

    var step = plotW / (data.length - 1);
    var pts = data.map(function (d, i) { return [padLeft + step * i, padTop + plotH - (d.value / max) * plotH]; });

    // Aire remplie (degrade derive du theme).
    ctx.beginPath();
    ctx.moveTo(pts[0][0], padTop + plotH);
    ctx.lineTo(pts[0][0], pts[0][1]);
    smooth(ctx, pts);
    ctx.lineTo(pts[pts.length - 1][0], padTop + plotH);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, rgba(TEAL, 0.26));
    grad.addColorStop(1, rgba(TEAL, 0));
    ctx.fillStyle = grad; ctx.fill();

    // Courbe lissee.
    ctx.beginPath(); smooth(ctx, pts);
    ctx.strokeStyle = TEAL; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();

    // Point final (ou survole) mis en valeur.
    var idx = hi != null ? hi : data.length - 1;
    var p = pts[idx];
    if (hi != null) { // guide vertical au tap
      ctx.strokeStyle = rgba(TEAL, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], padTop); ctx.lineTo(p[0], padTop + plotH); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(TEAL, 0.18); ctx.fill();
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = TEAL; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = SURFACE; ctx.stroke();

    if (hi != null) {
      bubble(ctx, s.w, p[0], p[1], [compact(data[idx].value), data[idx].label || '']);
    } else if (data[idx].value > 0) {
      ctx.fillStyle = TEXT; ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = p[0] > s.w - 40 ? 'right' : 'center';
      ctx.fillText(compact(data[idx].value), p[0], p[1] - 10);
    }

    // Etiquettes d'axe : debut / milieu / fin.
    ctx.fillStyle = MUTED; ctx.font = '11px system-ui, sans-serif';
    var marks = data.length > 8 ? [0, Math.floor(data.length / 2), data.length - 1] : data.map(function (_, i) { return i; });
    marks.forEach(function (i) {
      ctx.textAlign = i === 0 ? 'left' : (i === data.length - 1 ? 'right' : 'center');
      ctx.fillText(data[i].label, padLeft + step * i, s.h - 7);
    });

    canvas._hit = function (x) {
      var i = Math.round((x - padLeft) / step);
      return (i >= 0 && i < data.length) ? i : null;
    };
  }

  var RENDERERS = { donut: donut, bars: bars, line: line };

  /* --------------------------------------------------- Interaction (tap) */

  function wire(canvas) {
    if (canvas._wired) return;
    canvas._wired = true;
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX) - r.left, (e.clientY) - r.top];
    }
    function update(e) {
      if (!canvas._hit) return;
      var p = pos(e);
      var i = canvas._hit(p[0], p[1]);
      if (i !== canvas._hi) { canvas._hi = i; canvas._draw(i); }
    }
    function clear() { if (canvas._hi != null) { canvas._hi = null; canvas._draw(null); } }
    canvas.addEventListener('pointerdown', update);
    canvas.addEventListener('pointermove', function (e) { if (e.buttons || e.pressure > 0) update(e); });
    canvas.addEventListener('pointerup', clear);
    canvas.addEventListener('pointercancel', clear);
    canvas.addEventListener('pointerleave', clear);
  }

  function renderOne(canvas) {
    var kind = canvas.getAttribute('data-chart');
    var renderer = RENDERERS[kind];
    if (!renderer) return;
    var data;
    try { data = JSON.parse(canvas.getAttribute('data-series') || '[]'); } catch (e) { return; }
    canvas._hi = null;
    canvas._draw = function (hi) { renderer(canvas, data, hi); };
    renderer(canvas, data, null);
    wire(canvas);
  }

  function renderAll() {
    refreshColors();
    document.querySelectorAll('canvas[data-chart]').forEach(renderOne);
  }

  var pending;
  window.addEventListener('resize', function () {
    clearTimeout(pending);
    pending = setTimeout(renderAll, 150);
  });

  document.addEventListener('DOMContentLoaded', renderAll);

  // Rendu manuel : rafraichit les couleurs apres un changement de theme.
  window.ChartsRender = renderAll;
})();
