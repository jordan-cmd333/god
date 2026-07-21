/* Budget Control — application monodocument hors ligne.
 *
 * Rend toutes les pages de la version Django a partir des donnees locales
 * (IndexedDB). Aucun reseau. La logique de calcul vit dans services.js.
 */

const App = (function () {
  'use strict';

  const State = { data: {}, currency: 'FCFA', threshold: 80 };
  const S = Services;

  const EXPENSE_METHODS = {
    cash: 'Especes', card: 'Carte bancaire', mobile: 'Mobile money',
    transfer: 'Virement', check: 'Cheque', other: 'Autre',
  };
  const INCOME_METHODS = {
    cash: 'Especes', mobile: 'Mobile money', transfer: 'Virement',
    card: 'Carte bancaire', check: 'Cheque', other: 'Autre',
  };

  // --- Helpers d'affichage ------------------------------------------------

  function money(v) {
    const n = S.round2(Number(v) || 0);
    const parts = n.toFixed(2).split('.');
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + parts[1];
  }

  function fmtDate(isoStr) {
    const [y, m, d] = isoStr.split('-');
    return d + '/' + m + '/' + y;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function icon(name) { return Seed.icon(name); }
  function cur() { return esc(State.currency); }

  // Confirmation interne : window.confirm() renvoie toujours false dans une
  // WebView sans WebChromeClient, ce qui bloquait toutes les suppressions.
  function confirmModal(message) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.innerHTML = `<div class="modal-box"><p>${esc(message)}</p>
        <div class="btn-row"><button type="button" class="btn btn-ghost" data-no>Annuler</button>
        <button type="button" class="btn btn-danger" data-yes>Confirmer</button></div></div>`;
      document.body.appendChild(ov);
      const close = (v) => { ov.remove(); resolve(v); };
      ov.querySelector('[data-no]').addEventListener('click', () => close(false));
      ov.querySelector('[data-yes]').addEventListener('click', () => close(true));
      ov.addEventListener('click', (e) => { if (e.target === ov) close(false); });
    });
  }

  function cat(id) { return State.data.categories.find((c) => c.id === id) || { name: '?', color: '#64748b', icon: 'other' }; }
  function src(id) { return State.data.sources.find((s) => s.id === id) || { name: '?', color: '#64748b', icon: 'other' }; }

  // --- Chargement et evaluation ------------------------------------------

  async function load() {
    const d = {};
    for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts']) {
      d[s] = await DB.all(s);
    }
    State.data = d;
    State.currency = await DB.metaGet('currency', 'FCFA');
    State.threshold = await DB.metaGet('threshold', 80);
  }

  async function reevaluate(refISO) {
    const { toCreate, toUpdate, toDeleteIds } = S.evaluateAlerts(State.data, State.threshold, refISO);
    for (const a of toCreate) await DB.add('alerts', a);
    for (const a of toUpdate) await DB.put('alerts', a);
    for (const id of toDeleteIds) await DB.remove('alerts', id);
    State.data.alerts = await DB.all('alerts');
  }

  // --- Rendu --------------------------------------------------------------

  function setHeader(title, subtitle) {
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle || '';
  }

  function setActiveTab(tab) {
    document.querySelectorAll('.tabbar a[data-tab]').forEach((a) =>
      a.classList.toggle('active', a.getAttribute('data-tab') === tab));
  }

  function updateBadge() {
    const n = State.data.alerts.filter((a) => !a.read).length;
    const badge = document.getElementById('badge');
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  function render(view) {
    const main = document.getElementById('view');
    main.innerHTML = (view.flash ? view.flash : '') + view.html;
    setHeader(view.title, view.subtitle);
    setActiveTab(view.tab || null);
    updateBadge();
    window.scrollTo(0, 0);
    if (window.ChartsRender) window.ChartsRender();
    if (view.mount) view.mount(main);
  }

  let flashMsg = null;
  function flash(kind, text) { flashMsg = { kind, text }; }
  function takeFlash() {
    if (!flashMsg) return '';
    const icons = { success: '✅', error: '⛔', warning: '⚠️', info: '💡' };
    const cls = { success: 'success', error: 'error', warning: 'warning', info: 'info' }[flashMsg.kind];
    const html = `<div class="alert alert-${cls}"><span class="ico">${icons[flashMsg.kind]}</span><div>${esc(flashMsg.text)}</div></div>`;
    flashMsg = null;
    return html;
  }

  // Fragments reutilisables -------------------------------------------------

  function chart(kind, series) {
    return `<div class="chart-wrap"><canvas data-chart="${kind}" data-series='${JSON.stringify(series)}'></canvas></div>`;
  }

  function legend(rows) {
    if (!rows.length) return '<div class="empty">Aucune donnee.</div>';
    return '<div class="legend">' + rows.map((r) =>
      `<div class="legend-item"><span class="dot" style="background:${r.color}"></span>
       <span class="name">${esc(r.name)}</span><span class="val">${money(r.total)}</span>
       <span class="pct">${Math.round(r.share)} %</span></div>`).join('') + '</div>';
  }

  function balanceCard(bal) {
    const ratio = bal.spentRatio;
    let barCls = '';
    if (ratio != null && ratio >= 100) barCls = 'is-exceeded';
    else if (ratio != null && ratio >= 80) barCls = 'is-warning';
    const barPct = ratio == null ? 0 : Math.min(Math.round(ratio), 100);
    let extra = '';
    if (!bal.isPositive) {
      extra = `<div class="alert alert-exceeded" style="margin:10px 0 0"><span class="ico">⛔</span>
        <div>Vous depensez plus que vous ne gagnez : ${money(Math.abs(bal.balance))} ${cur()} de plus.</div></div>`;
    } else if (bal.income === 0) {
      extra = `<div class="alert alert-info" style="margin:10px 0 0"><span class="ico">💡</span>
        <div>Aucun revenu sur la periode. <a href="#/income/new">Ajoutez vos rentrees</a> pour suivre votre solde.</div></div>`;
    }
    return `<div class="balance">
      <div class="balance-row"><span class="balance-label"><span class="dot" style="background:var(--success)"></span> Revenus</span><span class="balance-value">${money(bal.income)}</span></div>
      <div class="balance-row"><span class="balance-label"><span class="dot" style="background:var(--danger)"></span> Depenses</span><span class="balance-value">−${money(bal.expense)}</span></div>
      ${ratio != null ? `<div class="bar ${barCls}" style="margin:10px 0 6px"><span style="width:${barPct}%"></span></div>
        <div class="limit-foot" style="margin-bottom:10px"><span>${Math.round(ratio)} % de vos revenus depenses</span></div>` : ''}
      <div class="balance-row balance-total"><span class="balance-label">${bal.isPositive ? 'Reste' : 'Deficit'}</span>
        <span class="balance-value ${bal.isPositive ? 'down' : 'up'}">${money(Math.abs(bal.balance))} ${cur()}</span></div>
      ${extra}</div>`;
  }

  function alertBanner(a) {
    const cls = a.level === 'exceeded' ? 'alert-exceeded' : 'alert-warning';
    const ico = a.level === 'exceeded' ? '⛔' : '⚠️';
    let body;
    if (a.kind === 'overspend') {
      body = `<b>Depenses superieures aux revenus</b> — ce mois-ci vous avez depense
        ${money(a.spent)} ${cur()} pour ${money(a.limitAmount)} de revenus (${Math.round(S.ratio(a))} %).`;
    } else {
      const l = a.limitId ? State.data.limits.find((x) => x.id === a.limitId) : null;
      const target = l && l.categoryId ? cat(l.categoryId).name : 'toutes categories';
      const period = l ? { day: 'journaliere', week: 'hebdomadaire', month: 'mensuelle', year: 'annuelle' }[l.period] : '';
      const levelText = a.level === 'exceeded' ? 'Limite depassee' : 'Seuil atteint';
      body = `<b>${levelText}</b> — limite ${period} sur ${esc(target)} :
        ${money(a.spent)} / ${money(a.limitAmount)} ${cur()} (${Math.round(S.ratio(a))} %).`;
    }
    return `<div class="alert ${cls}"><span class="ico">${ico}</span><div>${body}</div></div>`;
  }

  function comparisonsGrid(rows) {
    return '<div class="stat-grid">' + rows.map((c) => {
      const arrow = c.improving ? '▼' : '▲';
      const incArrow = c.improving ? '▲' : '▼';
      return `<div class="stat"><div class="k">${esc(c.label)}</div><div class="v">${money(c.current)}</div>
        <div class="d ${c.improving ? 'down' : 'up'}">${c.variation != null
          ? `${c._income ? incArrow : arrow} ${Math.round(Math.abs(c.variation))} % <span class="neutral">vs ${money(c.previous)}</span>`
          : '<span class="neutral">pas de reference</span>'}</div></div>`;
    }).join('') + '</div>';
  }

  function emptyBlock(ic, text, link) {
    return `<div class="empty"><span class="big">${ic}</span>${text}${link ? '<br>' + link : ''}</div>`;
  }

  // --- Vues ---------------------------------------------------------------

  const Views = {};

  Views.dashboard = async function () {
    const ref = S.todayISO();
    await reevaluate(ref);
    const d = State.data;
    const kinds = ['day', 'week', 'month', 'year'];
    const comps = kinds.map((k) => S.compare(d.expenses, k, ref));
    const summaries = {}; comps.forEach((c) => summaries[c.kind] = c);
    const month = S.periodBounds('month', ref);
    const bal = S.balance(d.expenses, d.incomes, month);
    const monthBreak = S.breakdown(d.expenses, month, d.categories, 'categoryId');
    const top = monthBreak[0];
    const statuses = S.allLimitStatuses(d.expenses, d.limits, d.categories, State.threshold, ref, false);
    const unread = S.unreadAlerts(d.alerts, 5);
    const recent = d.expenses.slice().sort(sortByDateDesc).slice(0, 6);
    const day = summaries.day;

    let html = '';
    unread.forEach((a) => html += alertBanner(a));
    if (unread.length) html += `<form data-action="alerts-read" style="margin-bottom:14px"><button class="btn btn-ghost btn-sm">Marquer les alertes comme lues</button></form>`;

    html += `<div class="card hero"><div class="label">Depenses d'aujourd'hui</div>
      <div class="value">${money(day.current)}<span class="cur">${cur()}</span></div>
      <div class="delta">${day.variation != null
        ? `${day.improving ? '▼' : '▲'} ${Math.round(Math.abs(day.variation))} % par rapport a hier (${money(day.previous)} ${cur()})`
        : 'Aucune depense hier — pas de comparaison possible'}</div>
      <div class="hero-grid">
        <div><div class="k">Semaine</div><div class="v">${money(summaries.week.current)}</div></div>
        <div><div class="k">Mois</div><div class="v">${money(summaries.month.current)}</div></div>
        <div><div class="k">Annee</div><div class="v">${money(summaries.year.current)}</div></div>
      </div></div>`;

    html += `<div class="btn-row" style="margin-bottom:16px">
      <a href="#/expense/new" class="btn">＋ Depense</a>
      <a href="#/income/new" class="btn btn-income">＋ Revenu</a></div>`;

    html += `<div class="card"><h2 class="card-title">Solde du mois <a href="#/incomes">Detail des revenus</a></h2>${balanceCard(bal)}</div>`;

    html += `<div class="card"><h2 class="card-title">Limites budgetaires <a href="#/budgets">Gerer</a></h2>`;
    if (statuses.length) {
      statuses.forEach((st) => html += limitRow(st, false));
    } else {
      html += emptyBlock('🎯', 'Aucune limite definie.', '<a href="#/budgets">Definir un budget</a>');
    }
    html += `</div>`;

    html += `<div class="card"><h2 class="card-title">Repartition du mois <a href="#/reports">Details</a></h2>
      ${chart('donut', monthBreak.map((r) => ({ label: r.name, value: r.total, color: r.color })))}
      ${legend(monthBreak.slice(0, 6))}
      ${top ? `<div class="alert alert-info" style="margin:14px 0 0"><span class="ico">💡</span>
        <div>Vous depensez le plus en <b>${esc(top.name)}</b> : ${money(top.total)} ${cur()} ce mois-ci (${Math.round(top.share)} % du total).</div></div>` : ''}
      </div>`;

    html += `<div class="card"><h2 class="card-title">Evolution du mois</h2>
      ${chart('line', S.timeline(d.expenses, 'month', ref))}</div>`;

    html += `<div class="card"><h2 class="card-title">Comparaison avec la periode precedente</h2>${comparisonsGrid(comps)}</div>`;

    html += `<div class="card"><h2 class="card-title">Dernieres depenses <a href="#/history">Tout voir</a></h2><ul class="list">`;
    if (recent.length) {
      recent.forEach((e) => { const c = cat(e.categoryId); html += `<li class="row">
        <span class="row-icon" style="background:${c.color}">${icon(c.icon)}</span>
        <span class="row-main"><span class="t">${esc(e.description || c.name)}</span>
        <span class="s">${fmtDate(e.date)} · ${EXPENSE_METHODS[e.method] || ''}</span></span>
        <span class="row-amount">${money(e.amount)}</span></li>`; });
    } else {
      html += emptyBlock('🧾', 'Aucune depense enregistree.', '<a href="#/expense/new">Ajouter la premiere</a>');
    }
    html += `</ul></div>`;

    return { title: 'Bonjour', subtitle: "Voici ou vous en etes aujourd'hui", tab: 'dashboard', html, mount: mountDashboard };
  };

  function mountDashboard(root) {
    const f = root.querySelector('[data-action="alerts-read"]');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      for (const a of State.data.alerts.filter((x) => !x.read)) await DB.put('alerts', { ...a, read: true });
      State.data.alerts = await DB.all('alerts');
      go('#/');
    });
  }

  function limitRow(st, withActions) {
    const barCls = st.isExceeded ? 'is-exceeded' : (st.isWarning ? 'is-warning' : '');
    const periodLabel = { day: 'journaliere', week: 'hebdomadaire', month: 'mensuelle', year: 'annuelle' }[st.limit.period];
    const inactive = !st.limit.active;
    return `<div class="limit"${inactive ? ' style="opacity:.55"' : ''}>
      <div class="limit-head">
        <span class="limit-name"><span class="dot" style="background:${st.color}"></span>${esc(st.target)}
          <span class="limit-period">· ${periodLabel}${inactive ? ' · desactivee' : ''}</span></span>
        <span class="limit-amounts"><b>${money(st.spent)}</b> / ${money(st.amount)}</span>
      </div>
      <div class="bar ${st.limit.active ? barCls : ''}"><span style="width:${Math.round(st.barPercent)}%"></span></div>
      <div class="limit-foot"><span>${Math.round(st.percent)} % utilise</span>
        <span>${st.isExceeded
          ? `<b style="color:var(--danger)">Depassement de ${money(Math.abs(st.remaining))} ${cur()}</b>`
          : `Reste ${money(st.remaining)} ${cur()}`}</span></div>
      ${withActions ? `<div class="limit-foot" style="margin-top:6px"><span></span><span class="row-actions">
        <a class="btn btn-ghost btn-sm" href="#/budget/${st.limit.id}">✏️</a>
        <button class="btn btn-danger btn-sm" data-del-limit="${st.limit.id}">🗑</button></span></div>` : ''}
    </div>`;
  }

  function sortByDateDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  // Formulaire depense / revenu (partage la meme structure) ----------------

  function txnForm(opts) {
    // opts: {kind:'expense'|'income', item, refs, methods, chipName, addSteps}
    const isExpense = opts.kind === 'expense';
    const item = opts.item || {};
    const selId = item[isExpense ? 'categoryId' : 'sourceId'];
    const chips = opts.refs.filter((r) => !r.archived).map((r, i) => `
      <label class="chip"><input type="radio" name="ref" value="${r.id}"
        ${selId === r.id || (selId == null && i === 0) ? 'checked' : ''}>${icon(r.icon)} ${esc(r.name)}</label>`).join('');
    const methodOpts = Object.keys(opts.methods).map((k) =>
      `<option value="${k}" ${item.method === k ? 'selected' : ''}>${opts.methods[k]}</option>`).join('');
    const steps = opts.addSteps.map((s) => `<button type="button" class="chip" data-add="${s}">+${money(s).replace(',00', '')}</button>`).join('');
    const btnCls = isExpense ? 'btn' : 'btn btn-income';

    return `<form data-form="txn">
      <div class="card">
        <label>Montant (${cur()})</label>
        <input class="amount-input" name="amount" inputmode="decimal" step="0.01" min="0.01"
          value="${item.amount != null ? item.amount : ''}" placeholder="0">
        <div class="errorlist" data-err="amount" hidden></div>
        <div class="chips" style="justify-content:center;margin-top:12px">${steps}
          <button type="button" class="chip" data-clear="1">C</button></div>
      </div>
      <div class="card"><span class="form-label">${isExpense ? 'Categorie' : 'Source'}</span>
        <div class="chips">${chips || `<p class="helptext">Aucune ${isExpense ? 'categorie' : 'source'}.</p>`}</div></div>
      <div class="card">
        <div class="form-row">
          <div class="field"><label>Date</label><input type="date" name="date" value="${item.date || S.todayISO()}"></div>
          <div class="field"><label>${isExpense ? 'Mode de paiement' : 'Mode de reception'}</label>
            <select name="method">${methodOpts}</select></div>
        </div>
        <div class="field"><label>Description</label>
          <input type="text" name="description" value="${esc(item.description || '')}" placeholder="Ex : ${isExpense ? 'dejeuner' : 'salaire de juillet'}"></div>
        ${!isExpense ? `<label class="chip" style="margin-bottom:13px"><input type="checkbox" name="recurring" ${item.recurring ? 'checked' : ''}> Revenu recurrent</label>` : ''}
        <div class="field" style="margin-bottom:0"><label>Note</label>
          <textarea name="note" rows="2">${esc(item.note || '')}</textarea></div>
      </div>
      ${item.id ? `<div class="btn-row"><button class="${btnCls}">Enregistrer</button>
        <a href="${isExpense ? '#/history' : '#/income-history'}" class="btn btn-ghost">Annuler</a></div>`
        : `<button class="${btnCls} btn-block" style="margin-bottom:10px">Enregistrer</button>
           <button type="submit" name="again" value="1" class="btn btn-ghost btn-block">Enregistrer et en ajouter un autre</button>`}
    </form>
    ${item.id ? `<form data-del="${opts.kind}" data-id="${item.id}" style="margin-top:16px">
      <button class="btn btn-danger btn-block">Supprimer</button></form>` : ''}`;
  }

  function mountTxnForm(root, opts) {
    const input = root.querySelector('.amount-input');
    if (input && !input.value) input.focus();
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      input.value = S.round2((parseFloat(input.value) || 0) + parseFloat(b.getAttribute('data-add')));
    }));
    root.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { input.value = ''; input.focus(); }));

    root.querySelector('[data-form="txn"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = S.round2(parseFloat(fd.get('amount')));
      const errEl = root.querySelector('[data-err="amount"]');
      if (!(amount > 0)) { errEl.hidden = false; errEl.textContent = 'Montant invalide.'; return; }
      const refVal = fd.get('ref');
      if (!refVal) { errEl.hidden = false; errEl.textContent = 'Choisissez une ' + (opts.kind === 'expense' ? 'categorie.' : 'source.'); return; }
      await opts.onSave({
        amount,
        refId: Number(refVal),
        date: fd.get('date') || S.todayISO(),
        method: fd.get('method'),
        description: (fd.get('description') || '').trim(),
        recurring: fd.get('recurring') === 'on',
        note: (fd.get('note') || '').trim(),
      }, e.submitter && e.submitter.name === 'again');
    });

    const delForm = root.querySelector('[data-del]');
    if (delForm) delForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!await confirmModal('Supprimer definitivement ?')) return;
      await opts.onDelete(Number(delForm.getAttribute('data-id')));
    });
  }

  Views.expenseForm = async function (id) {
    const item = id ? State.data.expenses.find((x) => x.id === id) : null;
    const html = txnForm({ kind: 'expense', item, refs: State.data.categories, methods: EXPENSE_METHODS, addSteps: [500, 1000, 5000] });
    return {
      title: id ? 'Modifier la depense' : 'Nouvelle depense', subtitle: 'Montant + categorie suffisent', html,
      mount: (root) => mountTxnForm(root, {
        kind: 'expense',
        onSave: async (v, again) => {
          const rec = { amount: v.amount, categoryId: v.refId, description: v.description, date: v.date, method: v.method, note: v.note, createdAt: item ? item.createdAt : Date.now() };
          if (item) { rec.id = item.id; await DB.put('expenses', rec); } else { await DB.add('expenses', rec); }
          State.data.expenses = await DB.all('expenses');
          await reevaluate(v.date);
          flash('success', `Depense de ${v.amount} enregistree dans « ${cat(v.refId).name} ».`);
          go(again ? '#/expense/new' : (item ? '#/history' : '#/'));
        },
        onDelete: async (delId) => {
          await DB.remove('expenses', delId); State.data.expenses = await DB.all('expenses');
          await reevaluate(S.todayISO()); flash('success', 'Depense supprimee.'); go('#/history');
        },
      }),
    };
  };

  Views.incomeForm = async function (id) {
    const item = id ? State.data.incomes.find((x) => x.id === id) : null;
    const html = txnForm({ kind: 'income', item, refs: State.data.sources, methods: INCOME_METHODS, addSteps: [5000, 25000, 100000] });
    return {
      title: id ? 'Modifier le revenu' : 'Nouveau revenu', subtitle: 'Montant + source suffisent', html,
      mount: (root) => mountTxnForm(root, {
        kind: 'income',
        onSave: async (v, again) => {
          const rec = { amount: v.amount, sourceId: v.refId, description: v.description, date: v.date, method: v.method, recurring: v.recurring, note: v.note, createdAt: item ? item.createdAt : Date.now() };
          if (item) { rec.id = item.id; await DB.put('incomes', rec); } else { await DB.add('incomes', rec); }
          State.data.incomes = await DB.all('incomes');
          await reevaluate(v.date);
          flash('success', `Revenu de ${v.amount} enregistre depuis « ${src(v.refId).name} ».`);
          go(again ? '#/income/new' : (item ? '#/income-history' : '#/incomes'));
        },
        onDelete: async (delId) => {
          await DB.remove('incomes', delId); State.data.incomes = await DB.all('incomes');
          await reevaluate(S.todayISO()); flash('success', 'Revenu supprime.'); go('#/income-history');
        },
      }),
    };
  };

  // Historique (depenses / revenus) ----------------------------------------

  function historyView(opts) {
    const q = parseQuery();
    let rows = State.data[opts.store].slice();
    if (q.preset) { const p = S.periodBounds(q.preset); rows = rows.filter((r) => r.date >= p.start && r.date <= p.end); }
    if (q.ref) rows = rows.filter((r) => r[opts.refKey] === Number(q.ref));
    if (q.min) rows = rows.filter((r) => r.amount >= parseFloat(q.min));
    if (q.max) rows = rows.filter((r) => r.amount <= parseFloat(q.max));
    if (q.q) { const t = q.q.toLowerCase(); rows = rows.filter((r) => (r.description || '').toLowerCase().includes(t) || (r.note || '').toLowerCase().includes(t)); }
    rows.sort(sortByDateDesc);
    const total = S.sum(rows, 'amount');
    const refs = State.data[opts.refsStore];

    const pill = (val, lab) => `<a class="chip ${q.preset === val || (!q.preset && !val) ? 'is-active' : ''}" href="${opts.base}${val ? '?preset=' + val : ''}">${lab}</a>`;
    let html = `<div class="pill-scroll">${pill('', 'Tout')}${pill('day', "Aujourd'hui")}${pill('week', 'Cette semaine')}${pill('month', 'Ce mois')}${pill('year', 'Cette annee')}</div>`;
    html += `<div class="summary-bar ${opts.income ? 'summary-bar-income' : ''}"><span>Total filtre</span><b>${money(total)} ${cur()}</b></div>`;

    html += `<details class="card filters"><summary>Filtres avances</summary><form data-filter class="filters-body">
      <div class="field"><label>${opts.income ? 'Source' : 'Categorie'}</label><select name="ref">
        <option value="">Toutes</option>${refs.map((r) => `<option value="${r.id}" ${q.ref == r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="form-row"><div class="field"><label>Montant min</label><input name="min" type="number" value="${esc(q.min || '')}"></div>
        <div class="field"><label>Montant max</label><input name="max" type="number" value="${esc(q.max || '')}"></div></div>
      <div class="field"><label>Recherche</label><input name="q" type="text" value="${esc(q.q || '')}" placeholder="Description, note..."></div>
      <div class="btn-row"><button class="${opts.income ? 'btn btn-income' : 'btn'}">Filtrer</button>
        <a href="${opts.base}" class="btn btn-ghost">Reinitialiser</a></div></form></details>`;

    if (!opts.income) {
      html += `<div class="btn-row" style="margin-bottom:14px">
        <button class="btn btn-ghost" data-export="expenses">📊 Export CSV</button>
        <button class="btn btn-ghost" data-print="1">📄 Imprimer / PDF</button></div>`;
    } else {
      html += `<div class="btn-row" style="margin-bottom:14px"><button class="btn btn-ghost" data-export="incomes">📊 Export CSV</button></div>`;
    }

    html += `<div class="card"><ul class="list">`;
    if (rows.length) {
      rows.slice(0, 300).forEach((r) => {
        const ref = opts.income ? src(r.sourceId) : cat(r.categoryId);
        const methods = opts.income ? INCOME_METHODS : EXPENSE_METHODS;
        html += `<li class="row"><span class="row-icon" style="background:${ref.color}">${icon(ref.icon)}</span>
          <span class="row-main"><span class="t">${esc(r.description || ref.name)}${r.recurring ? ' <span class="limit-period">· recurrent</span>' : ''}</span>
          <span class="s">${fmtDate(r.date)} · ${esc(ref.name)} · ${methods[r.method] || ''}</span></span>
          <span class="row-amount ${opts.income ? 'income' : ''}">${opts.income ? '+' : ''}${money(r.amount)}</span>
          <a class="btn btn-ghost btn-sm" href="${opts.editBase}/${r.id}">✏️</a></li>`;
      });
    } else {
      html += emptyBlock('🔍', 'Aucun resultat pour ces filtres.');
    }
    html += `</ul>${rows.length > 300 ? `<p class="table-note">300 sur ${rows.length} affiches. Affinez les filtres.</p>` : ''}</div>`;

    return {
      title: opts.title, subtitle: `${rows.length} ${opts.noun}${rows.length > 1 ? 's' : ''}`, tab: opts.tab, html,
      mount: (root) => {
        const f = root.querySelector('[data-filter]');
        f.addEventListener('submit', (e) => {
          e.preventDefault(); const fd = new FormData(f); const p = new URLSearchParams();
          ['ref', 'min', 'max', 'q'].forEach((k) => { if (fd.get(k)) p.set(k, fd.get(k)); });
          if (q.preset) p.set('preset', q.preset);
          go(opts.base + (p.toString() ? '?' + p.toString() : ''));
        });
        const exp = root.querySelector('[data-export]');
        if (exp) exp.addEventListener('click', () => exportCSV(opts.income ? 'incomes' : 'expenses', rows));
        const pr = root.querySelector('[data-print]');
        if (pr) pr.addEventListener('click', () => printDoc());
      },
    };
  }

  Views.history = () => historyView({ store: 'expenses', refsStore: 'categories', refKey: 'categoryId', base: '#/history', editBase: '#/expense', title: 'Historique', noun: 'depense', tab: 'history', income: false });
  Views.incomeHistory = () => historyView({ store: 'incomes', refsStore: 'sources', refKey: 'sourceId', base: '#/income-history', editBase: '#/income', title: 'Historique des revenus', noun: 'revenu', tab: 'incomes', income: true });

  // Revenus (vue d'ensemble) -----------------------------------------------

  Views.incomes = async function () {
    const ref = S.todayISO(); const d = State.data;
    const kinds = ['day', 'week', 'month', 'year'];
    const comps = kinds.map((k) => { const c = S.compare(d.incomes, k, ref, true); c._income = true; return c; });
    const summaries = {}; comps.forEach((c) => summaries[c.kind] = c);
    const month = S.periodBounds('month', ref);
    const bal = S.balance(d.expenses, d.incomes, month);
    const monthBreak = S.breakdown(d.incomes, month, d.sources, 'sourceId');
    const top = monthBreak[0];
    const recent = d.incomes.slice().sort(sortByDateDesc).slice(0, 8);
    const recurring = dedupeRecurring(d.incomes);
    const m = summaries.month;

    let html = `<div class="card hero hero-income"><div class="label">Revenus de ce mois-ci</div>
      <div class="value">${money(m.current)}<span class="cur">${cur()}</span></div>
      <div class="delta">${m.variation != null
        ? `${m.improving ? '▲' : '▼'} ${Math.round(Math.abs(m.variation))} % par rapport au mois dernier (${money(m.previous)} ${cur()})`
        : 'Aucun revenu le mois dernier — pas de comparaison'}</div>
      <div class="hero-grid">
        <div><div class="k">Aujourd'hui</div><div class="v">${money(summaries.day.current)}</div></div>
        <div><div class="k">Semaine</div><div class="v">${money(summaries.week.current)}</div></div>
        <div><div class="k">Annee</div><div class="v">${money(summaries.year.current)}</div></div>
      </div></div>`;

    html += `<a href="#/income/new" class="btn btn-income btn-block" style="margin-bottom:16px">＋ Ajouter un revenu</a>`;
    html += `<div class="card"><h2 class="card-title">Solde du mois</h2>${balanceCard(bal)}</div>`;

    html += `<div class="card"><h2 class="card-title">Sources de revenus <a href="#/sources">Gerer</a></h2>
      ${chart('donut', monthBreak.map((r) => ({ label: r.name, value: r.total, color: r.color })))}
      ${monthBreak.length ? legend(monthBreak) : emptyBlock('💵', 'Aucun revenu ce mois-ci.', '<a href="#/income/new">Enregistrer une rentree</a>')}
      ${top ? `<div class="alert alert-success" style="margin:14px 0 0"><span class="ico">🏆</span>
        <div>Votre principale source est <b>${esc(top.name)}</b> : ${money(top.total)} ${cur()} ce mois-ci (${Math.round(top.share)} % de vos rentrees).
        ${top.share > 70 ? ' Une part aussi concentree rend vos finances dependantes d\'une seule source.' : ''}</div></div>` : ''}</div>`;

    html += `<div class="card"><h2 class="card-title">Evolution du mois</h2>${chart('line', S.timeline(d.incomes, 'month', ref))}</div>`;
    html += `<div class="card"><h2 class="card-title">Comparaison avec la periode precedente</h2>${comparisonsGrid(comps)}</div>`;

    if (recurring.length) {
      html += `<div class="card"><h2 class="card-title">Revenus recurrents</h2><ul class="list">`;
      recurring.forEach((i) => { const s = src(i.sourceId); html += `<li class="row"><span class="row-icon" style="background:${s.color}">${icon(s.icon)}</span>
        <span class="row-main"><span class="t">${esc(i.description || s.name)}</span><span class="s">Dernier le ${fmtDate(i.date)}</span></span>
        <span class="row-amount income">+${money(i.amount)}</span></li>`; });
      html += `</ul></div>`;
    }

    html += `<div class="card"><h2 class="card-title">Derniers revenus <a href="#/income-history">Tout voir</a></h2><ul class="list">`;
    if (recent.length) {
      recent.forEach((i) => { const s = src(i.sourceId); html += `<li class="row"><span class="row-icon" style="background:${s.color}">${icon(s.icon)}</span>
        <span class="row-main"><span class="t">${esc(i.description || s.name)}${i.recurring ? ' <span class="limit-period">· recurrent</span>' : ''}</span>
        <span class="s">${fmtDate(i.date)} · ${INCOME_METHODS[i.method] || ''}</span></span>
        <span class="row-amount income">+${money(i.amount)}</span>
        <a class="btn btn-ghost btn-sm" href="#/income/${i.id}">✏️</a></li>`; });
    } else { html += emptyBlock('🧾', 'Aucun revenu enregistre.', '<a href="#/income/new">Ajouter le premier</a>'); }
    html += `</ul></div>`;

    return { title: 'Revenus', subtitle: "D'ou vient votre argent", tab: 'incomes', html };
  };

  function dedupeRecurring(incomes) {
    const rec = incomes.filter((i) => i.recurring).sort(sortByDateDesc);
    const seen = new Set(), out = [];
    for (const i of rec) { const k = i.sourceId + '|' + (i.description || '').trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(i); if (out.length === 5) break; }
    return out;
  }

  // Budgets ----------------------------------------------------------------

  Views.budgets = async function () {
    const ref = S.todayISO();
    const statuses = S.allLimitStatuses(State.data.expenses, State.data.limits, State.data.categories, State.threshold, ref, true);
    const cats = State.data.categories.filter((c) => !c.archived);
    let html = `<div class="card"><h2 class="card-title">Nouvelle limite</h2><form data-form="limit">
      <div class="form-row">
        <div class="field"><label>Periode</label><select name="period">
          <option value="day">Journaliere</option><option value="week">Hebdomadaire</option>
          <option value="month" selected>Mensuelle</option><option value="year">Annuelle</option></select></div>
        <div class="field"><label>Montant (${cur()})</label><input name="amount" type="number" step="0.01" min="0.01"></div>
      </div>
      <div class="field"><label>Categorie</label><select name="categoryId">
        <option value="">Toutes categories (limite globale)</option>
        ${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <label class="chip" style="margin-bottom:13px"><input type="checkbox" name="active" checked> Limite active</label>
      <div class="errorlist" data-err hidden></div>
      <button class="btn btn-block">Definir la limite</button></form></div>`;

    const groups = {};
    statuses.forEach((st) => { const k = st.limit.period; (groups[k] = groups[k] || []).push(st); });
    const labels = { day: 'Journaliere', week: 'Hebdomadaire', month: 'Mensuelle', year: 'Annuelle' };
    if (statuses.length) {
      ['day', 'week', 'month', 'year'].forEach((k) => {
        if (!groups[k]) return;
        html += `<div class="card"><h2 class="card-title">Limite ${labels[k].toLowerCase()}</h2>`;
        groups[k].forEach((st) => html += limitRow(st, true));
        html += `</div>`;
      });
    } else {
      html += `<div class="card">${emptyBlock('🎯', "Aucune limite pour l'instant.")}</div>`;
    }

    return {
      title: 'Budgets et limites', subtitle: `Alerte a ${State.threshold} % puis au depassement`, tab: 'budgets', html,
      mount: (root) => {
        root.querySelector('[data-form="limit"]').addEventListener('submit', async (e) => {
          e.preventDefault(); const fd = new FormData(e.target);
          const amount = S.round2(parseFloat(fd.get('amount')));
          const err = root.querySelector('[data-err]');
          if (!(amount > 0)) { err.hidden = false; err.textContent = 'Montant invalide.'; return; }
          const period = fd.get('period'); const categoryId = fd.get('categoryId') ? Number(fd.get('categoryId')) : null;
          const dup = State.data.limits.find((l) => l.period === period && (l.categoryId || null) === categoryId);
          if (dup) { err.hidden = false; err.textContent = dup.active ? 'Une limite existe deja pour cette periode et cette categorie.' : 'Une limite desactivee existe deja pour cette periode et cette categorie (listee ci-dessous).'; return; }
          await DB.add('limits', { period, categoryId, amount, active: fd.get('active') === 'on' });
          State.data.limits = await DB.all('limits'); await reevaluate(S.todayISO());
          flash('success', 'Limite enregistree.'); go('#/budgets');
        });
        root.querySelectorAll('[data-del-limit]').forEach((b) => b.addEventListener('click', async () => {
          if (!await confirmModal('Supprimer cette limite ?')) return;
          await DB.remove('limits', Number(b.getAttribute('data-del-limit')));
          State.data.limits = await DB.all('limits'); State.data.alerts = await DB.all('alerts');
          flash('success', 'Limite supprimee.'); go('#/budgets');
        }));
      },
    };
  };

  Views.budgetEdit = async function (id) {
    const limit = State.data.limits.find((l) => l.id === id);
    if (!limit) return Views.budgets();
    const cats = State.data.categories.filter((c) => !c.archived);
    const periods = { day: 'Journaliere', week: 'Hebdomadaire', month: 'Mensuelle', year: 'Annuelle' };
    const html = `<form data-form="limit-edit" class="card">
      <div class="field"><label>Periode</label><select name="period">
        ${Object.keys(periods).map((k) => `<option value="${k}" ${limit.period === k ? 'selected' : ''}>${periods[k]}</option>`).join('')}</select></div>
      <div class="field"><label>Categorie</label><select name="categoryId">
        <option value="">Toutes categories</option>
        ${cats.map((c) => `<option value="${c.id}" ${limit.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Montant (${cur()})</label><input name="amount" type="number" step="0.01" value="${limit.amount}"></div>
      <label class="chip" style="margin-bottom:13px"><input type="checkbox" name="active" ${limit.active ? 'checked' : ''}> Limite active</label>
      <div class="btn-row"><button class="btn">Enregistrer</button><a href="#/budgets" class="btn btn-ghost">Annuler</a></div></form>`;
    return {
      title: 'Modifier la limite', tab: 'budgets', html,
      mount: (root) => root.querySelector('[data-form="limit-edit"]').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        await DB.put('limits', { id: limit.id, period: fd.get('period'), categoryId: fd.get('categoryId') ? Number(fd.get('categoryId')) : null, amount: S.round2(parseFloat(fd.get('amount'))), active: fd.get('active') === 'on' });
        State.data.limits = await DB.all('limits'); await reevaluate(S.todayISO());
        flash('success', 'Limite mise a jour.'); go('#/budgets');
      }),
    };
  };

  // Categories / Sources (CRUD generique) ----------------------------------

  function refListView(opts) {
    const items = State.data[opts.store];
    const usage = {};
    State.data[opts.txnStore].forEach((t) => { const k = t[opts.refKey]; usage[k] = usage[k] || { count: 0, total: 0 }; usage[k].count++; usage[k].total += t.amount; });
    let html = `<div class="card"><h2 class="card-title">Nouvelle ${opts.singular}</h2><form data-form="ref">
      <div class="form-row"><div class="field"><label>Nom</label><input name="name" required></div>
        <div class="field"><label>Couleur</label><input name="color" type="color" value="${opts.income ? '#0f766e' : '#64748b'}"></div></div>
      <div class="field"><label>Icone</label><input name="icon" value="other">
        <span class="helptext">${opts.icons}</span></div>
      <div class="errorlist" data-err hidden></div>
      <button class="${opts.income ? 'btn btn-income' : 'btn'} btn-block">Ajouter</button></form></div>`;

    html += `<div class="card"><h2 class="card-title">Mes ${opts.plural}</h2><ul class="list">`;
    items.forEach((r) => {
      const u = usage[r.id] || { count: 0, total: 0 };
      html += `<li class="row"><span class="row-icon" style="background:${r.color}">${icon(r.icon)}</span>
        <span class="row-main"><span class="t">${esc(r.name)}${r.archived ? ' <span class="limit-period">· archivee</span>' : ''}</span>
        <span class="s">${u.count} ${opts.txnNoun}${u.count > 1 ? 's' : ''}${u.total ? ' · ' + money(u.total) + ' ' + cur() : ''}</span></span>
        <span class="row-actions"><a class="btn btn-ghost btn-sm" href="${opts.editBase}/${r.id}">✏️</a>
        <button class="btn btn-danger btn-sm" data-del="${r.id}">🗑</button></span></li>`;
    });
    html += `</ul><p class="table-note">Une ${opts.singular} deja utilisee est archivee plutot que supprimee, pour preserver l'historique.</p></div>`;

    return {
      title: opts.title, subtitle: opts.subtitle, tab: opts.tab, html,
      mount: (root) => {
        root.querySelector('[data-form="ref"]').addEventListener('submit', async (e) => {
          e.preventDefault(); const fd = new FormData(e.target); const name = (fd.get('name') || '').trim();
          const err = root.querySelector('[data-err]');
          if (!name) { err.hidden = false; err.textContent = 'Nom requis.'; return; }
          if (items.some((r) => r.name.toLowerCase() === name.toLowerCase())) { err.hidden = false; err.textContent = 'Ce nom existe deja.'; return; }
          await DB.add(opts.store, { name, color: fd.get('color'), icon: (fd.get('icon') || 'other').trim(), archived: false });
          State.data[opts.store] = await DB.all(opts.store); flash('success', 'Ajoute.'); go(opts.base);
        });
        root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          const id = Number(b.getAttribute('data-del'));
          if (!await confirmModal('Supprimer ?')) return;
          if ((usage[id] || { count: 0 }).count > 0) {
            const r = items.find((x) => x.id === id); await DB.put(opts.store, { ...r, archived: true });
            flash('warning', 'Element utilise : archive au lieu d\'etre supprime, pour preserver l\'historique.');
          } else { await DB.remove(opts.store, id); flash('success', 'Supprime.'); }
          State.data[opts.store] = await DB.all(opts.store); go(opts.base);
        }));
      },
    };
  }

  Views.categories = () => refListView({ store: 'categories', txnStore: 'expenses', refKey: 'categoryId', singular: 'categorie', plural: 'categories', txnNoun: 'depense', title: 'Categories', subtitle: 'Vos postes de depense', base: '#/categories', editBase: '#/category', icons: 'restaurant, school, family, transport, home, health, leisure, phone, bill, saving, other', income: false });
  Views.sources = () => refListView({ store: 'sources', txnStore: 'incomes', refKey: 'sourceId', singular: 'source', plural: 'sources', txnNoun: 'revenu', title: 'Sources de revenus', subtitle: "D'ou peut venir votre argent", base: '#/sources', editBase: '#/source', icons: 'salary, freelance, business, scholarship, family, rent, sale, interest, gift, other', income: true });

  function refEditView(opts, id) {
    const item = State.data[opts.store].find((x) => x.id === id);
    if (!item) return opts.store === 'categories' ? Views.categories() : Views.sources();
    const html = `<form data-form="ref-edit" class="card">
      <div class="field"><label>Nom</label><input name="name" value="${esc(item.name)}"></div>
      <div class="field"><label>Couleur</label><input name="color" type="color" value="${item.color}"></div>
      <div class="field"><label>Icone</label><input name="icon" value="${esc(item.icon)}"></div>
      <div class="btn-row"><button class="btn">Enregistrer</button><a href="${opts.base}" class="btn btn-ghost">Annuler</a></div></form>`;
    return {
      title: 'Modifier', tab: opts.tab, html,
      mount: (root) => root.querySelector('[data-form="ref-edit"]').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        await DB.put(opts.store, { ...item, name: (fd.get('name') || '').trim(), color: fd.get('color'), icon: (fd.get('icon') || 'other').trim() });
        State.data[opts.store] = await DB.all(opts.store); flash('success', 'Mis a jour.'); go(opts.base);
      }),
    };
  }

  // Rapports ---------------------------------------------------------------

  Views.reports = async function () {
    const q = parseQuery(); const kind = ['day', 'week', 'month', 'year'].includes(q.kind) ? q.kind : 'month';
    const ref = S.todayISO(); const d = State.data;
    const period = S.periodBounds(kind, ref);
    const comparison = S.compare(d.expenses, kind, ref);
    const breakdownRows = S.breakdown(d.expenses, period, d.categories, 'categoryId');
    const total = S.sum(S.inPeriod(d.expenses, period), 'amount');
    const count = S.inPeriod(d.expenses, period).length;
    const top = breakdownRows[0];
    const comps = ['day', 'week', 'month', 'year'].map((k) => S.compare(d.expenses, k, ref));

    const pill = (k, lab) => `<a class="chip ${kind === k ? 'is-active' : ''}" href="#/reports?kind=${k}">${lab}</a>`;
    let html = `<div class="pill-scroll">${pill('day', 'Jour')}${pill('week', 'Semaine')}${pill('month', 'Mois')}${pill('year', 'Annee')}</div>`;
    html += `<div class="card hero"><div class="label">${esc(comparison.label)}</div>
      <div class="value">${money(total)}<span class="cur">${cur()}</span></div>
      <div class="delta">${count} depense${count > 1 ? 's' : ''} · ${comparison.variation != null
        ? `${comparison.improving ? '▼' : '▲'} ${Math.abs(comparison.variation).toFixed(1)} % vs ${comparison.previousLabel.toLowerCase()}`
        : 'pas de reference sur ' + comparison.previousLabel.toLowerCase()}</div></div>`;
    if (top) html += `<div class="alert alert-info"><span class="ico">🏆</span><div>Poste principal : <b>${esc(top.name)}</b> — ${money(top.total)} ${cur()} (${Math.round(top.share)} % du total, ${top.count} depense${top.count > 1 ? 's' : ''}).</div></div>`;

    html += `<div class="card"><h2 class="card-title">Depenses par categorie</h2>
      ${chart('donut', breakdownRows.map((r) => ({ label: r.name, value: r.total, color: r.color })))}${legend(breakdownRows)}</div>`;
    html += `<div class="card"><h2 class="card-title">Evolution dans le temps</h2>
      ${chart(kind === 'year' ? 'bars' : 'line', S.timeline(d.expenses, kind, ref))}</div>`;
    html += `<div class="card"><h2 class="card-title">${esc(comparison.previousLabel)} vs ${esc(comparison.label)}</h2>
      ${chart('bars', [{ label: comparison.previousLabel, value: comparison.previous, color: '#94a3b8' }, { label: comparison.label, value: comparison.current, color: '#0f766e' }])}
      <div class="limit-foot" style="margin-top:10px"><span>Ecart</span>
        <span class="${comparison.improving ? 'down' : 'up'}">${comparison.improving ? '−' : '+'} ${money(Math.abs(comparison.delta))} ${cur()}</span></div></div>`;
    html += `<div class="card"><h2 class="card-title">Toutes les periodes</h2>${comparisonsGrid(comps)}</div>`;
    html += `<div class="btn-row"><button class="btn btn-ghost" data-export="expenses">📊 Export CSV</button>
      <button class="btn btn-ghost" data-print="1">📄 Imprimer / PDF</button></div>`;

    return {
      title: 'Rapports', subtitle: `Du ${fmtDate(period.start)} au ${fmtDate(period.end)}`, html,
      mount: (root) => {
        root.querySelector('[data-export]').addEventListener('click', () => exportCSV('expenses', S.inPeriod(d.expenses, period).sort(sortByDateDesc)));
        root.querySelector('[data-print]').addEventListener('click', () => printDoc());
      },
    };
  };

  // Parametres -------------------------------------------------------------

  Views.settings = async function () {
    const d = State.data;
    const stats = {
      expenses: d.expenses.length, total: S.sum(d.expenses, 'amount'),
      incomes: d.incomes.length, earned: S.sum(d.incomes, 'amount'),
      categories: d.categories.length, sources: d.sources.length, limits: d.limits.length,
    };
    const hasPin = !!(await DB.metaGet('pin', null));
    const html = `
      <div class="card"><h2 class="card-title">Preferences</h2><form data-form="prefs">
        <div class="field"><label>Devise</label><input name="currency" value="${cur()}"></div>
        <div class="field"><label>Seuil d'alerte (%)</label><input name="threshold" type="number" min="10" max="100" value="${State.threshold}"></div>
        <button class="btn btn-block">Enregistrer</button></form></div>

      <div class="card"><h2 class="card-title">Verrou (code PIN)</h2>
        <p class="helptext" style="margin-bottom:12px">Verrou de confort a l'ouverture. Vos donnees restent sur l'appareil et ne sont pas chiffrees.</p>
        <form data-form="pin">
          <div class="field"><label>${hasPin ? 'Nouveau code (vide = retirer)' : 'Definir un code'}</label>
            <input name="pin" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 chiffres"></div>
          <button class="btn btn-ghost btn-block">${hasPin ? 'Modifier le code' : 'Activer le verrou'}</button></form></div>

      <div class="card"><h2 class="card-title">Configuration</h2><ul class="list">
        <li class="row"><span class="row-icon" style="background:#0f766e">🏷️</span>
          <span class="row-main"><span class="t">Categories de depenses</span><span class="s">${stats.categories} categorie${stats.categories > 1 ? 's' : ''}</span></span>
          <a class="btn btn-ghost btn-sm" href="#/categories">Gerer</a></li>
        <li class="row"><span class="row-icon" style="background:#15803d">💵</span>
          <span class="row-main"><span class="t">Sources de revenus</span><span class="s">${stats.sources} source${stats.sources > 1 ? 's' : ''}</span></span>
          <a class="btn btn-ghost btn-sm" href="#/sources">Gerer</a></li></ul></div>

      <div class="card"><h2 class="card-title">Mes donnees</h2><div class="stat-grid">
        <div class="stat"><div class="k">Depenses</div><div class="v">${stats.expenses}</div></div>
        <div class="stat"><div class="k">Total cumule</div><div class="v">${money(stats.total)}</div></div>
        <div class="stat"><div class="k">Revenus</div><div class="v">${stats.incomes}</div></div>
        <div class="stat"><div class="k">Total encaisse</div><div class="v">${money(stats.earned)}</div></div>
        <div class="stat"><div class="k">Categories</div><div class="v">${stats.categories}</div></div>
        <div class="stat"><div class="k">Limites</div><div class="v">${stats.limits}</div></div></div></div>

      <div class="card"><h2 class="card-title">Sauvegarde locale</h2>
        <p class="helptext" style="margin-bottom:12px">Export/import JSON de toutes vos donnees, sans reseau.</p>
        <div class="btn-row"><button class="btn btn-ghost" data-backup>Exporter (JSON)</button>
          <button class="btn btn-ghost" data-restore>Importer</button></div>
        <input type="file" accept="application/json" data-restore-file hidden></div>

      <div class="card"><h2 class="card-title">Demonstration</h2>
        <button class="btn btn-ghost btn-block" data-seed-demo>Charger 90 jours de donnees de demo</button></div>`;

    return {
      title: 'Parametres', subtitle: 'Application 100 % hors ligne', html,
      mount: (root) => {
        root.querySelector('[data-form="prefs"]').addEventListener('submit', async (e) => {
          e.preventDefault(); const fd = new FormData(e.target);
          await DB.metaSet('currency', (fd.get('currency') || 'FCFA').trim());
          await DB.metaSet('threshold', Math.max(10, Math.min(100, parseInt(fd.get('threshold'), 10) || 80)));
          State.currency = await DB.metaGet('currency'); State.threshold = await DB.metaGet('threshold');
          await reevaluate(S.todayISO()); flash('success', 'Parametres enregistres.'); go('#/settings');
        });
        root.querySelector('[data-form="pin"]').addEventListener('submit', async (e) => {
          e.preventDefault(); const pin = (new FormData(e.target).get('pin') || '').trim();
          if (pin && !/^\d{4,8}$/.test(pin)) { flash('error', 'Le code doit compter 4 a 8 chiffres.'); go('#/settings'); return; }
          await DB.metaSet('pin', pin ? hashPin(pin) : null);
          flash('success', pin ? 'Verrou active.' : 'Verrou retire.'); go('#/settings');
        });
        root.querySelector('[data-backup]').addEventListener('click', backupJSON);
        root.querySelector('[data-restore]').addEventListener('click', () => root.querySelector('[data-restore-file]').click());
        root.querySelector('[data-restore-file]').addEventListener('change', restoreJSON);
        root.querySelector('[data-seed-demo]').addEventListener('click', async () => {
          if (!await confirmModal('Remplacer les donnees actuelles par un jeu de demonstration ?')) return;
          await seedDemo(); await load(); flash('success', 'Donnees de demonstration chargees.'); go('#/');
        });
      },
    };
  };

  // --- Sauvegarde / exports (hors ligne) ----------------------------------

  function download(filename, text, mime) {
    // Dans l'APK, le telechargement de blob n'existe pas : on passe par le pont
    // natif (Storage Access Framework). En navigateur, repli sur l'ancre <a>.
    if (window.AndroidBridge && window.AndroidBridge.saveText) {
      try { window.AndroidBridge.saveText(filename, mime || 'text/plain', text); return; }
      catch (e) { /* repli ci-dessous */ }
    }
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printDoc() {
    if (window.AndroidBridge && window.AndroidBridge.printPage) {
      try { window.AndroidBridge.printPage(); return; } catch (e) { /* repli */ }
    }
    window.print();
  }

  function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function exportCSV(store, rows) {
    const income = store === 'incomes';
    const header = income
      ? ['Date', 'Source', 'Montant', 'Mode', 'Recurrent', 'Description', 'Note']
      : ['Date', 'Categorie', 'Montant', 'Mode', 'Description', 'Note'];
    const lines = [header.map(csvCell).join(';')];
    rows.forEach((r) => {
      const ref = income ? src(r.sourceId) : cat(r.categoryId);
      const methods = income ? INCOME_METHODS : EXPENSE_METHODS;
      const row = income
        ? [r.date, ref.name, r.amount, methods[r.method] || '', r.recurring ? 'oui' : 'non', r.description || '', r.note || '']
        : [r.date, ref.name, r.amount, methods[r.method] || '', r.description || '', r.note || ''];
      lines.push(row.map(csvCell).join(';'));
    });
    download(`budget-control_${store}_${S.todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  async function backupJSON() {
    const dump = { version: 1, exportedAt: new Date().toISOString(), meta: { currency: State.currency, threshold: State.threshold } };
    for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts']) dump[s] = await DB.all(s);
    download(`budget-control_sauvegarde_${S.todayISO()}.json`, JSON.stringify(dump, null, 2), 'application/json');
  }

  async function restoreJSON(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!await confirmModal('Remplacer toutes les donnees actuelles par cette sauvegarde ?')) { e.target.value = ''; return; }
    try {
      const dump = JSON.parse(await file.text());
      await DB.clearAll();
      for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts']) {
        if (Array.isArray(dump[s])) await DB.bulkAdd(s, dump[s]);
      }
      if (dump.meta) { await DB.metaSet('currency', dump.meta.currency || 'FCFA'); await DB.metaSet('threshold', dump.meta.threshold || 80); }
      await load(); flash('success', 'Sauvegarde importee.'); go('#/');
    } catch (err) { flash('error', 'Fichier invalide.'); go('#/settings'); }
  }

  // --- Verrou PIN (confort, non chiffrant) --------------------------------

  function hashPin(pin) {
    // djb2 sale : suffisant pour un verrou d'ecran local (les donnees ne sont
    // pas chiffrees ; un acces physique a l'appareil les lit de toute facon).
    let h = 5381; const salted = 'bc:' + pin;
    for (let i = 0; i < salted.length; i++) h = ((h << 5) + h + salted.charCodeAt(i)) >>> 0;
    return 'd' + h.toString(16);
  }

  async function guardLock() {
    const stored = await DB.metaGet('pin', null);
    const lock = document.getElementById('lock');
    if (!stored) { lock.hidden = true; return true; }
    return new Promise((resolve) => {
      lock.hidden = false;
      const input = document.getElementById('lock-pin');
      const btn = document.getElementById('lock-btn');
      const err = document.getElementById('lock-error');
      input.value = ''; input.focus();
      const attempt = () => {
        if (hashPin(input.value.trim()) === stored) { lock.hidden = true; resolve(true); }
        else { err.hidden = false; input.value = ''; input.focus(); }
      };
      btn.onclick = attempt;
      input.onkeydown = (e) => { if (e.key === 'Enter') attempt(); };
    });
  }

  // --- Donnees de demonstration -------------------------------------------

  async function seedDemo() {
    await DB.clearAll();
    await Seed.bootstrap();
    const cats = await DB.all('categories'); const srcs = await DB.all('sources');
    const catBy = {}; cats.forEach((c) => catBy[c.name] = c.id);
    const srcBy = {}; srcs.forEach((s) => srcBy[s.name] = s.id);
    const today = new Date();
    const isoOf = (offset) => { const d = new Date(today); d.setDate(d.getDate() - offset); return S.iso(d); };
    // Generateur pseudo-aleatoire deterministe (pas de Math.random pour rester reproductible).
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

    const profils = [
      ['Nourriture', 500, 4000, ['Marche', 'Dejeuner', 'Courses']],
      ['Transport', 200, 2500, ['Taxi', 'Carburant', 'Bus']],
      ['Communication', 500, 5000, ['Credit', 'Forfait']],
      ['Loisirs', 1000, 12000, ['Cinema', 'Sortie']],
      ['Factures', 3000, 25000, ['Electricite', 'Eau']],
      ['Sante', 1000, 15000, ['Pharmacie', 'Consultation']],
      ['Logement', 10000, 60000, ['Loyer']],
      ['Autres', 500, 8000, ['Divers']],
    ];
    const expenses = [];
    for (let day = 0; day < 90; day++) {
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const p = pick(profils);
        expenses.push({ amount: Math.round((p[1] + rnd() * (p[2] - p[1])) / 50) * 50, categoryId: catBy[p[0]], description: pick(p[3]), date: isoOf(day), method: pick(['cash', 'cash', 'mobile', 'transfer']), note: '', createdAt: Date.now() - day * 86400000 - i });
      }
    }
    await DB.bulkAdd('expenses', expenses);

    const incomes = [];
    for (let mois = 0; mois < 3; mois++) {
      incomes.push({ amount: 185000, sourceId: srcBy['Salaire'], description: 'Salaire mensuel', date: isoOf(mois * 30 + 3), method: 'transfer', recurring: true, note: '', createdAt: Date.now() - mois * 2592000000 });
      incomes.push({ amount: 45000, sourceId: srcBy['Location'], description: 'Loyer encaisse', date: isoOf(mois * 30 + 5), method: 'cash', recurring: true, note: '', createdAt: Date.now() - mois * 2592000000 - 1 });
    }
    for (let i = 0; i < 9; i++) { const nom = pick(['Freelance', 'Commerce', 'Vente', 'Cadeau', 'Bourse']); incomes.push({ amount: Math.round((8000 + rnd() * 80000) / 500) * 500, sourceId: srcBy[nom], description: 'Rentree ' + nom.toLowerCase(), date: isoOf(Math.floor(rnd() * 85)), method: pick(['cash', 'mobile', 'transfer']), recurring: false, note: '', createdAt: Date.now() - i }); }
    await DB.bulkAdd('incomes', incomes);

    await DB.bulkAdd('limits', [
      { period: 'day', categoryId: null, amount: 8000, active: true },
      { period: 'week', categoryId: null, amount: 45000, active: true },
      { period: 'month', categoryId: null, amount: 180000, active: true },
      { period: 'year', categoryId: null, amount: 2000000, active: true },
      { period: 'month', categoryId: catBy['Nourriture'], amount: 60000, active: true },
      { period: 'month', categoryId: catBy['Loisirs'], amount: 20000, active: true },
    ]);
  }

  // --- Routeur ------------------------------------------------------------

  function parseQuery() {
    const h = location.hash.split('?')[1] || '';
    const q = {}; new URLSearchParams(h).forEach((v, k) => q[k] = v);
    return q;
  }

  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  const ROUTES = [
    [/^#?\/?$/, () => Views.dashboard()],
    [/^#\/expense\/new/, () => Views.expenseForm(null)],
    [/^#\/expense\/(\d+)/, (m) => Views.expenseForm(Number(m[1]))],
    [/^#\/history/, () => Views.history()],
    [/^#\/incomes/, () => Views.incomes()],
    [/^#\/income\/new/, () => Views.incomeForm(null)],
    [/^#\/income\/(\d+)/, (m) => Views.incomeForm(Number(m[1]))],
    [/^#\/income-history/, () => Views.incomeHistory()],
    [/^#\/budgets/, () => Views.budgets()],
    [/^#\/budget\/(\d+)/, (m) => Views.budgetEdit(Number(m[1]))],
    [/^#\/categories/, () => Views.categories()],
    [/^#\/category\/(\d+)/, (m) => refEditView({ store: 'categories', base: '#/categories', tab: null }, Number(m[1]))],
    [/^#\/sources/, () => Views.sources()],
    [/^#\/source\/(\d+)/, (m) => refEditView({ store: 'sources', base: '#/sources', tab: 'incomes' }, Number(m[1]))],
    [/^#\/reports/, () => Views.reports()],
    [/^#\/settings/, () => Views.settings()],
  ];

  let routing = false;
  async function route() {
    if (routing) return; routing = true;
    const flashHtml = takeFlash();
    const path = location.hash.split('?')[0] || '#/';
    try {
      for (const [re, handler] of ROUTES) {
        const m = path.match(re);
        if (m) { const view = await handler(m); view.flash = flashHtml; render(view); routing = false; return; }
      }
      const view = await Views.dashboard(); view.flash = flashHtml; render(view);
    } catch (err) {
      document.getElementById('view').innerHTML = `<div class="alert alert-error"><span class="ico">⛔</span><div>Erreur : ${esc(err.message)}</div></div>`;
      console.error(err);
    }
    routing = false;
  }

  // --- Demarrage ----------------------------------------------------------

  async function init() {
    await DB.open();
    await Seed.bootstrap();
    await load();
    await guardLock();
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { State, go };
})();
