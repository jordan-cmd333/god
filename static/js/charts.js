/* Graphiques Budget Control — canvas natif, aucune dependance externe.
   Chaque <canvas data-chart="donut|bars|line" data-series="[...]"> est rendu
   automatiquement et redessine proprement sur les ecrans haute densite. */

(function () {
  'use strict';

  var MUTED = '#94a3b8';
  var GRID = '#e9edf1';
  var TEAL = '#0f766e';

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

  /* -------------------------------------------------------------- Donut */

  function donut(canvas, data) {
    var s = setup(canvas, 210);
    var ctx = s.ctx;
    var total = data.reduce(function (acc, d) { return acc + d.value; }, 0);
    var cx = s.w / 2, cy = s.h / 2;
    var radius = Math.min(s.w, s.h) / 2 - 8;
    var inner = radius * 0.62;

    if (!total) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = radius - inner;
      ctx.strokeStyle = GRID;
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.fillText('Aucune donnee', cx, cy + 4);
      return;
    }

    var angle = -Math.PI / 2;
    data.forEach(function (d) {
      var slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (radius + inner) / 2, angle, angle + slice);
      ctx.lineWidth = radius - inner;
      ctx.strokeStyle = d.color || TEAL;
      ctx.stroke();
      angle += slice;
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.fillText(compact(total), cx, cy + 2);
    ctx.fillStyle = MUTED;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('total', cx, cy + 18);
  }

  /* --------------------------------------------------------------- Bars */

  function bars(canvas, data) {
    var s = setup(canvas, 210);
    var ctx = s.ctx;
    var padLeft = 6, padRight = 6, padTop = 18, padBottom = 26;
    var plotW = s.w - padLeft - padRight;
    var plotH = s.h - padTop - padBottom;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH + .5);
    ctx.lineTo(padLeft + plotW, padTop + plotH + .5);
    ctx.stroke();

    var slot = plotW / Math.max(data.length, 1);
    var barW = Math.min(slot * 0.62, 46);

    data.forEach(function (d, i) {
      var h = (d.value / max) * plotH;
      var x = padLeft + slot * i + (slot - barW) / 2;
      var y = padTop + plotH - h;

      ctx.fillStyle = d.color || TEAL;
      var r = Math.min(5, barW / 2);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barW, Math.max(h, 2), [r, r, 0, 0]);
      } else {
        ctx.rect(x, y, barW, Math.max(h, 2));
      }
      ctx.fill();

      ctx.textAlign = 'center';
      if (d.value > 0) {
        ctx.fillStyle = '#0f172a';
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(compact(d.value), x + barW / 2, y - 5);
      }
      ctx.fillStyle = MUTED;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(d.label, x + barW / 2, s.h - 8);
    });
  }

  /* --------------------------------------------------------------- Line */

  function line(canvas, data) {
    var s = setup(canvas, 190);
    var ctx = s.ctx;
    var padLeft = 6, padRight = 6, padTop = 16, padBottom = 24;
    var plotW = s.w - padLeft - padRight;
    var plotH = s.h - padTop - padBottom;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));

    // Lignes de repere horizontales.
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (var g = 0; g <= 2; g++) {
      var gy = padTop + (plotH / 2) * g + .5;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(padLeft + plotW, gy);
      ctx.stroke();
    }

    if (data.length < 2) { bars(canvas, data); return; }

    var step = plotW / (data.length - 1);
    var pointAt = function (i, v) {
      return [padLeft + step * i, padTop + plotH - (v / max) * plotH];
    };

    // Aire remplie.
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + plotH);
    data.forEach(function (d, i) {
      var p = pointAt(i, d.value);
      ctx.lineTo(p[0], p[1]);
    });
    ctx.lineTo(padLeft + plotW, padTop + plotH);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, 'rgba(15, 118, 110, .22)');
    grad.addColorStop(1, 'rgba(15, 118, 110, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Courbe.
    ctx.beginPath();
    data.forEach(function (d, i) {
      var p = pointAt(i, d.value);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Point le plus haut mis en valeur.
    var peak = data.reduce(function (best, d, i) {
      return d.value > data[best].value ? i : best;
    }, 0);
    if (data[peak].value > 0) {
      var pp = pointAt(peak, data[peak].value);
      ctx.beginPath();
      ctx.arc(pp[0], pp[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = TEAL;
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = pp[0] > s.w - 40 ? 'right' : 'center';
      ctx.fillText(compact(data[peak].value), pp[0], pp[1] - 8);
    }

    // Etiquettes : premiere, milieu, derniere (evite le chevauchement).
    ctx.fillStyle = MUTED;
    ctx.font = '11px system-ui, sans-serif';
    var marks = data.length > 8
      ? [0, Math.floor(data.length / 2), data.length - 1]
      : data.map(function (_, i) { return i; });
    marks.forEach(function (i) {
      ctx.textAlign = i === 0 ? 'left' : (i === data.length - 1 ? 'right' : 'center');
      ctx.fillText(data[i].label, padLeft + step * i, s.h - 7);
    });
  }

  var RENDERERS = { donut: donut, bars: bars, line: line };

  function renderAll() {
    document.querySelectorAll('canvas[data-chart]').forEach(function (canvas) {
      var kind = canvas.getAttribute('data-chart');
      var renderer = RENDERERS[kind];
      if (!renderer) return;
      var data;
      try {
        data = JSON.parse(canvas.getAttribute('data-series') || '[]');
      } catch (e) {
        return;
      }
      renderer(canvas, data);
    });
  }

  var pending;
  window.addEventListener('resize', function () {
    clearTimeout(pending);
    pending = setTimeout(renderAll, 150);
  });

  document.addEventListener('DOMContentLoaded', renderAll);
})();
