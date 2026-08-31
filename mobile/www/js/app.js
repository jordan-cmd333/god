/* Budget Control — application monodocument hors ligne.
 *
 * Rend toutes les pages de la version Django a partir des donnees locales
 * (IndexedDB). Aucun reseau. La logique de calcul vit dans services.js.
 */

const App = (function () {
  'use strict';

  const State = { data: {}, currency: 'FCFA', threshold: 80, lastBackup: null, backupSnooze: null };
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
    for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts', 'recurrences', 'goals']) {
      d[s] = await DB.all(s);
    }
    State.data = d;
    State.currency = await DB.metaGet('currency', 'FCFA');
    State.threshold = await DB.metaGet('threshold', 80);
    State.lastBackup = await DB.metaGet('lastBackup', null);
    State.backupSnooze = await DB.metaGet('backupSnooze', null);
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
    const carry = bal.carryOver || 0;
    let extra = '';
    if (!bal.isPositive) {
      extra = `<div class="alert alert-exceeded" style="margin:10px 0 0"><span class="ico">⛔</span>
        <div>Solde negatif : vos depenses depassent vos revenus et vos reserves de ${money(Math.abs(bal.available))} ${cur()}.</div></div>`;
    } else if (bal.income === 0 && carry === 0) {
      extra = `<div class="alert alert-info" style="margin:10px 0 0"><span class="ico">💡</span>
        <div>Aucun revenu sur la periode. <a href="#/income/new">Ajoutez vos rentrees</a> pour suivre votre solde.</div></div>`;
    }
    const carryRow = carry !== 0 ? `<div class="balance-row"><span class="balance-label"><span class="dot" style="background:var(--faint)"></span> Reste du mois passe</span><span class="balance-value ${carry < 0 ? 'up' : ''}">${carry < 0 ? '−' : ''}${money(Math.abs(carry))}</span></div>` : '';
    return `<div class="balance">
      ${carryRow}
      <div class="balance-row"><span class="balance-label"><span class="dot" style="background:var(--success)"></span> Revenus</span><span class="balance-value">${money(bal.income)}</span></div>
      <div class="balance-row"><span class="balance-label"><span class="dot" style="background:var(--danger)"></span> Depenses</span><span class="balance-value">−${money(bal.expense)}</span></div>
      ${ratio != null ? `<div class="bar ${barCls}" style="margin:10px 0 6px"><span style="width:${barPct}%"></span></div>
        <div class="limit-foot" style="margin-bottom:10px"><span>${Math.round(ratio)} % de vos revenus depenses</span></div>` : ''}
      <div class="balance-row balance-total"><span class="balance-label">${bal.isPositive ? 'Solde disponible' : 'Solde negatif'}</span>
        <span class="balance-value ${bal.isPositive ? 'down' : 'up'}">${money(Math.abs(bal.available))} ${cur()}</span></div>
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
    if (trialLeft != null) html += `<div class="alert alert-info"><span class="ico">🎁</span>
      <div>Version d'essai — <b>${trialLeft} jour${trialLeft > 1 ? 's' : ''}</b> restant${trialLeft > 1 ? 's' : ''}.
      <a href="#" onclick="App.activate();return false">J'ai un code d'activation</a></div></div>`;
    if (backupDue()) html += backupBanner();
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

    const dueRecs = S.dueRecurrences(d.recurrences, ref);
    if (dueRecs.length) {
      html += `<div class="card"><h2 class="card-title">A confirmer <a href="#/recurrences">Gerer</a></h2>`;
      dueRecs.forEach((r) => html += dueRecurRow(r));
      html += `</div>`;
    }

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
    const bn = root.querySelector('[data-action="backup-now"]');
    if (bn) bn.addEventListener('click', async () => { await shareBackup(); go('#/'); });
    const bs = root.querySelector('[data-action="backup-snooze"]');
    if (bs) bs.addEventListener('click', async () => {
      const until = new Date(Date.now() + 7 * 86400000).toISOString();
      await DB.metaSet('backupSnooze', until); State.backupSnooze = until;
      flash('info', 'Rappel reporte de 7 jours.'); go('#/');
    });
    wireRecurActions(root, '#/');
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

  // Transactions recurrentes -----------------------------------------------
  // Rien n'est cree en silence : a l'echeance (nextDue <= aujourd'hui), la
  // recurrence est proposee « a confirmer ». Confirmer cree l'ecriture et
  // avance l'echeance ; passer avance sans rien creer.

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function recurRef(rec) { return rec.kind === 'income' ? src(rec.refId) : cat(rec.refId); }

  async function advanceRecurrenceDB(rec, fromDate) {
    const next = S.advanceOccurrence(rec.nextDue, rec.frequency, S.anchorDayOf(rec));
    await DB.put('recurrences', { ...rec, nextDue: next, lastRun: fromDate });
    State.data.recurrences = await DB.all('recurrences');
  }

  async function confirmRecurrence(rec) {
    const date = rec.nextDue;
    if (rec.kind === 'income') {
      await DB.add('incomes', { amount: rec.amount, sourceId: rec.refId, description: rec.description || '', date, method: rec.method, recurring: true, note: rec.note || '', createdAt: Date.now() });
      State.data.incomes = await DB.all('incomes');
    } else {
      await DB.add('expenses', { amount: rec.amount, categoryId: rec.refId, description: rec.description || '', date, method: rec.method, note: rec.note || '', createdAt: Date.now() });
      State.data.expenses = await DB.all('expenses');
    }
    await advanceRecurrenceDB(rec, date);
    await reevaluate(date);
  }

  function dueRecurRow(rec) {
    const ref = recurRef(rec);
    const isIncome = rec.kind === 'income';
    return `<div class="limit">
      <div class="limit-head">
        <span class="limit-name"><span class="dot" style="background:${ref.color}"></span>${esc(rec.description || ref.name)}
          <span class="limit-period">· ${S.FREQ_LABELS[rec.frequency]} · echeance ${fmtDate(rec.nextDue)}</span></span>
        <span class="limit-amounts"><b>${isIncome ? '+' : '−'}${money(rec.amount)}</b></span>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-sm ${isIncome ? 'btn-income' : ''}" data-rec-confirm="${rec.id}">Confirmer</button>
        <button class="btn btn-ghost btn-sm" data-rec-skip="${rec.id}">Passer</button>
      </div>
    </div>`;
  }

  function wireRecurActions(root, backHash) {
    root.querySelectorAll('[data-rec-confirm]').forEach((b) => b.addEventListener('click', async () => {
      const rec = State.data.recurrences.find((r) => r.id === Number(b.getAttribute('data-rec-confirm')));
      if (!rec) return;
      await confirmRecurrence(rec);
      flash('success', `${rec.kind === 'income' ? 'Revenu' : 'Depense'} de ${money(rec.amount)} ajoute${rec.kind === 'income' ? '' : 'e'}.`);
      go(backHash);
    }));
    root.querySelectorAll('[data-rec-skip]').forEach((b) => b.addEventListener('click', async () => {
      const rec = State.data.recurrences.find((r) => r.id === Number(b.getAttribute('data-rec-skip')));
      if (!rec) return;
      await advanceRecurrenceDB(rec, rec.nextDue);
      flash('info', 'Echeance passee.'); go(backHash);
    }));
  }

  Views.recurrences = async function () {
    const list = State.data.recurrences.slice().sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0));
    const due = S.dueRecurrences(State.data.recurrences);
    let html = `<div class="btn-row" style="margin-bottom:16px">
      <a href="#/recurrence/new?kind=expense" class="btn">＋ Depense</a>
      <a href="#/recurrence/new?kind=income" class="btn btn-income">＋ Revenu</a></div>`;
    if (due.length) {
      html += `<div class="card"><h2 class="card-title">A confirmer</h2>`;
      due.forEach((r) => html += dueRecurRow(r));
      html += `</div>`;
    }
    html += `<div class="card"><h2 class="card-title">Mes recurrences</h2>`;
    if (list.length) {
      html += `<ul class="list">`;
      list.forEach((rec) => {
        const ref = recurRef(rec);
        const isIncome = rec.kind === 'income';
        const inactive = !rec.active;
        html += `<li class="row"${inactive ? ' style="opacity:.55"' : ''}>
          <span class="row-icon" style="background:${ref.color}">${icon(ref.icon)}</span>
          <span class="row-main"><span class="t">${esc(rec.description || ref.name)}</span>
            <span class="s">${S.FREQ_LABELS[rec.frequency]} · ${isIncome ? 'revenu' : 'depense'} · prochaine ${fmtDate(rec.nextDue)}${rec.endDate ? ` · jusqu'au ${fmtDate(rec.endDate)}` : ''}${inactive ? ' · en pause' : ''}</span></span>
          <span class="row-amount">${isIncome ? '+' : '−'}${money(rec.amount)}</span>
          <span class="row-actions" style="margin-left:8px">
            <button class="btn btn-ghost btn-sm" data-rec-toggle="${rec.id}" title="${rec.active ? 'Mettre en pause' : 'Reactiver'}">${rec.active ? '⏸' : '▶'}</button>
            <a class="btn btn-ghost btn-sm" href="#/recurrence/${rec.id}">✏️</a></span></li>`;
      });
      html += `</ul>`;
    } else {
      html += emptyBlock('🔁', 'Aucune recurrence definie.', '<a href="#/recurrence/new?kind=expense">Ajouter la premiere</a>');
    }
    html += `</div>`;
    return {
      title: 'Recurrences', subtitle: 'Depenses et revenus qui reviennent', html,
      mount: (root) => {
        wireRecurActions(root, '#/recurrences');
        root.querySelectorAll('[data-rec-toggle]').forEach((b) => b.addEventListener('click', async () => {
          const rec = State.data.recurrences.find((r) => r.id === Number(b.getAttribute('data-rec-toggle')));
          if (!rec) return;
          await DB.put('recurrences', { ...rec, active: !rec.active });
          State.data.recurrences = await DB.all('recurrences'); go('#/recurrences');
        }));
      },
    };
  };

  Views.recurrenceForm = async function (id) {
    const item = id ? State.data.recurrences.find((r) => r.id === id) : null;
    const q = parseQuery();
    const kind = item ? item.kind : (q.kind === 'income' ? 'income' : 'expense');
    const isExpense = kind === 'expense';
    const refs = (isExpense ? State.data.categories : State.data.sources).filter((r) => !r.archived);
    const methods = isExpense ? EXPENSE_METHODS : INCOME_METHODS;
    const addSteps = isExpense ? [500, 1000, 5000] : [5000, 25000, 100000];
    const selId = item ? item.refId : null;
    const chips = refs.map((r, i) => `<label class="chip"><input type="radio" name="ref" value="${r.id}"
      ${selId === r.id || (selId == null && i === 0) ? 'checked' : ''}>${icon(r.icon)} ${esc(r.name)}</label>`).join('');
    const methodOpts = Object.keys(methods).map((k) => `<option value="${k}" ${item && item.method === k ? 'selected' : ''}>${methods[k]}</option>`).join('');
    const freqOpts = Object.keys(S.FREQ_LABELS).map((k) => `<option value="${k}" ${(item ? item.frequency : 'monthly') === k ? 'selected' : ''}>${cap(S.FREQ_LABELS[k])}</option>`).join('');
    const steps = addSteps.map((s) => `<button type="button" class="chip" data-add="${s}">+${money(s).replace(',00', '')}</button>`).join('');
    const btnCls = isExpense ? 'btn' : 'btn btn-income';

    const html = `<form data-form="recur">
      <div class="card">
        <label>Montant (${cur()})</label>
        <input class="amount-input" name="amount" inputmode="decimal" step="0.01" min="0.01"
          value="${item && item.amount != null ? item.amount : ''}" placeholder="0">
        <div class="errorlist" data-err="amount" hidden></div>
        <div class="chips" style="justify-content:center;margin-top:12px">${steps}
          <button type="button" class="chip" data-clear="1">C</button></div>
      </div>
      <div class="card"><span class="form-label">${isExpense ? 'Categorie' : 'Source'}</span>
        <div class="chips">${chips || `<p class="helptext">Aucune ${isExpense ? 'categorie' : 'source'}.</p>`}</div></div>
      <div class="card">
        <div class="form-row">
          <div class="field"><label>Frequence</label><select name="frequency">${freqOpts}</select></div>
          <div class="field"><label>${isExpense ? 'Mode de paiement' : 'Mode de reception'}</label>
            <select name="method">${methodOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Premiere echeance</label><input type="date" name="startDate" value="${item ? item.startDate : S.todayISO()}"></div>
          <div class="field"><label>Fin (optionnel)</label><input type="date" name="endDate" value="${item && item.endDate ? item.endDate : ''}"></div>
        </div>
        <div class="field"><label>Description</label>
          <input type="text" name="description" value="${esc(item ? item.description || '' : '')}" placeholder="Ex : ${isExpense ? 'loyer' : 'salaire'}"></div>
        <div class="field" style="margin-bottom:0"><label>Note</label>
          <textarea name="note" rows="2">${esc(item ? item.note || '' : '')}</textarea></div>
      </div>
      <input type="hidden" name="kind" value="${kind}">
      <button class="${btnCls} btn-block" style="margin-bottom:10px">${item ? 'Enregistrer' : 'Creer la recurrence'}</button>
    </form>
    ${item ? `<form data-del-recur="${item.id}" style="margin-top:16px">
      <button class="btn btn-danger btn-block">Supprimer</button></form>` : ''}`;

    return {
      title: item ? 'Modifier la recurrence' : (isExpense ? 'Depense recurrente' : 'Revenu recurrent'),
      subtitle: 'Se repete — a confirmer a chaque echeance', html,
      mount: (root) => mountRecurForm(root, item),
    };
  };

  function mountRecurForm(root, item) {
    const input = root.querySelector('.amount-input');
    if (input && !input.value) input.focus();
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      input.value = S.round2((parseFloat(input.value) || 0) + parseFloat(b.getAttribute('data-add')));
    }));
    root.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { input.value = ''; input.focus(); }));

    root.querySelector('[data-form="recur"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = S.round2(parseFloat(fd.get('amount')));
      const errEl = root.querySelector('[data-err="amount"]');
      if (!(amount > 0)) { errEl.hidden = false; errEl.textContent = 'Montant invalide.'; return; }
      const refVal = fd.get('ref');
      const kind = fd.get('kind');
      if (!refVal) { errEl.hidden = false; errEl.textContent = 'Choisissez une ' + (kind === 'expense' ? 'categorie.' : 'source.'); return; }
      const startDate = fd.get('startDate') || S.todayISO();
      const rec = {
        kind, amount, refId: Number(refVal),
        frequency: fd.get('frequency') || 'monthly',
        startDate, endDate: fd.get('endDate') || null,
        method: fd.get('method'),
        description: (fd.get('description') || '').trim(),
        note: (fd.get('note') || '').trim(),
        active: item ? item.active : true,
        createdAt: item ? item.createdAt : Date.now(),
        lastRun: item ? (item.lastRun || null) : null,
        nextDue: item ? item.nextDue : startDate,
      };
      if (item) {
        rec.id = item.id;
        if (rec.nextDue < startDate) rec.nextDue = startDate; // jamais d'echeance avant le debut
        await DB.put('recurrences', rec);
      } else {
        await DB.add('recurrences', rec);
      }
      State.data.recurrences = await DB.all('recurrences');
      flash('success', item ? 'Recurrence mise a jour.' : 'Recurrence creee.');
      go('#/recurrences');
    });

    const del = root.querySelector('[data-del-recur]');
    if (del) del.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!await confirmModal('Supprimer cette recurrence ? Les ecritures deja creees sont conservees.')) return;
      await DB.remove('recurrences', Number(del.getAttribute('data-del-recur')));
      State.data.recurrences = await DB.all('recurrences');
      flash('success', 'Recurrence supprimee.'); go('#/recurrences');
    });
  }

  // Objectifs d'epargne ----------------------------------------------------
  // Chaque contribution est une depense reelle dans la categorie « Epargne »,
  // liee a l'objectif par goalId : mettre de cote sort donc l'argent du solde
  // disponible. Le montant epargne = somme des depenses liees (source unique).

  function goalContributions(g) { return State.data.expenses.filter((e) => e.goalId === g.id); }
  function goalSaved(g) { return S.sum(goalContributions(g), 'amount'); }

  function goalStatus(g) {
    const target = g.target || 0;
    const saved = goalSaved(g);
    const percent = target > 0 ? Math.min(100, (saved / target) * 100) : (saved > 0 ? 100 : 0);
    return { saved, percent, remaining: S.round2(Math.max(0, target - saved)), reached: target > 0 && saved >= target };
  }

  // Categorie « Epargne » (creee au besoin) qui porte les depenses de mise de cote.
  async function ensureSavingsCategory() {
    let c = State.data.categories.find((x) => !x.archived && x.icon === 'saving')
         || State.data.categories.find((x) => !x.archived && /epargne/i.test(x.name));
    if (!c) {
      c = await DB.add('categories', { name: 'Epargne', color: '#22c55e', icon: 'saving', archived: false });
      State.data.categories = await DB.all('categories');
    }
    return c;
  }

  async function goalContribute(goal, amount) {
    const cat = await ensureSavingsCategory();
    const date = S.todayISO();
    await DB.add('expenses', { amount, categoryId: cat.id, description: `Epargne : ${goal.name}`, date, method: 'transfer', note: '', goalId: goal.id, createdAt: Date.now() });
    State.data.expenses = await DB.all('expenses');
    await reevaluate(date);
  }

  // Reprendre de l'epargne : on retire les dernieres contributions (depenses
  // liees les plus recentes), ce qui remet l'argent dans le solde disponible.
  async function goalWithdraw(goal, amount) {
    let remaining = amount;
    for (const e of goalContributions(goal).sort(sortByDateDesc)) {
      if (remaining <= 0.005) break;
      if (e.amount <= remaining + 0.005) {
        await DB.remove('expenses', e.id); remaining = S.round2(remaining - e.amount);
      } else {
        await DB.put('expenses', { ...e, amount: S.round2(e.amount - remaining) }); remaining = 0;
      }
    }
    State.data.expenses = await DB.all('expenses');
    await reevaluate(S.todayISO());
  }

  function goalCard(g) {
    const st = goalStatus(g);
    const dl = g.deadline ? ` <span class="limit-period">· echeance ${fmtDate(g.deadline)}</span>` : '';
    return `<div class="card">
      <div class="limit-head">
        <span class="limit-name"><span class="dot" style="background:${g.color}"></span>${esc(g.name)}${dl}</span>
        <span class="limit-amounts"><b>${money(st.saved)}</b> / ${money(g.target)}</span>
      </div>
      <div class="bar" style="margin-top:10px"><span style="width:${Math.round(st.percent)}%"></span></div>
      <div class="limit-foot">
        <span>${Math.round(st.percent)} %</span>
        <span>${st.reached ? '<b style="color:var(--success)">Objectif atteint 🎉</b>' : `Reste ${money(st.remaining)} ${cur()}`}</span>
      </div>
      <form data-goal-contrib="${g.id}" class="goal-contrib" style="margin-top:12px">
        <input name="amount" class="amount-input" inputmode="decimal" step="0.01" min="0.01" placeholder="Montant">
        <button type="submit" name="op" value="add" class="btn btn-sm">Mettre de cote</button>
        <button type="submit" name="op" value="withdraw" class="btn btn-ghost btn-sm">Reprendre</button>
      </form>
      <div class="limit-foot" style="margin-top:8px"><span class="helptext" style="margin:0">Sort du solde disponible (depense « Epargne »)</span>
        <span class="row-actions"><a class="btn btn-ghost btn-sm" href="#/goal/${g.id}">✏️</a></span></div>
    </div>`;
  }

  Views.goals = async function () {
    const list = State.data.goals.slice().filter((g) => !g.archived)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let html = `<div class="btn-row" style="margin-bottom:16px">
      <a href="#/goal/new" class="btn">＋ Nouvel objectif</a></div>`;
    if (list.length) {
      list.forEach((g) => html += goalCard(g));
    } else {
      html += `<div class="card">${emptyBlock('🐖', "Aucun objectif d'epargne.", '<a href="#/goal/new">Definir un objectif</a>')}</div>`;
    }
    return {
      title: "Objectifs d'epargne", subtitle: 'Mettez de cote, suivez vos progres', tab: 'goals', html,
      mount: (root) => {
        root.querySelectorAll('[data-goal-contrib]').forEach((f) => {
          const input = f.querySelector('.amount-input');
          f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = S.round2(parseFloat(input.value));
            if (!(amount > 0)) { input.focus(); return; }
            const withdraw = e.submitter && e.submitter.value === 'withdraw';
            const g = State.data.goals.find((x) => x.id === Number(f.getAttribute('data-goal-contrib')));
            if (!g) return;
            if (withdraw) { await goalWithdraw(g, amount); flash('success', `${money(amount)} repris de « ${g.name} ».`); }
            else { await goalContribute(g, amount); flash('success', `${money(amount)} mis de cote pour « ${g.name} ».`); }
            go('#/goals');
          });
        });
      },
    };
  };

  Views.goalForm = async function (id) {
    const item = id ? State.data.goals.find((g) => g.id === id) : null;
    const html = `<form data-form="goal">
      <div class="card">
        <div class="field"><label>Nom de l'objectif</label>
          <input name="name" value="${esc(item ? item.name : '')}" placeholder="Ex : Fonds d'urgence" required></div>
        <div class="form-row">
          <div class="field"><label>Montant cible (${cur()})</label>
            <input name="target" class="amount-input" inputmode="decimal" step="0.01" min="0.01"
              value="${item && item.target != null ? item.target : ''}" placeholder="0"></div>
          <div class="field"><label>Echeance (optionnel)</label>
            <input type="date" name="deadline" value="${item && item.deadline ? item.deadline : ''}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Couleur</label><input name="color" type="color" value="${item ? item.color : '#0f766e'}"></div>
          <div class="field"><label>Icone</label><input name="icon" value="${item ? esc(item.icon) : 'saving'}">
            <span class="helptext">saving, home, school, health, transport, family, other</span></div>
        </div>
        ${!item ? `<div class="field" style="margin-bottom:0"><label>Deja epargne (optionnel)</label>
          <input name="saved" inputmode="decimal" step="0.01" min="0" placeholder="0">
          <span class="helptext">Enregistre comme une depense « Epargne » (sort du solde disponible).</span></div>` : ''}
        <div class="errorlist" data-err hidden></div>
      </div>
      <button class="btn btn-block" style="margin-bottom:10px">${item ? 'Enregistrer' : "Creer l'objectif"}</button>
    </form>
    ${item ? `<form data-del-goal="${item.id}" style="margin-top:16px">
      <button class="btn btn-danger btn-block">Supprimer</button></form>` : ''}`;
    return {
      title: item ? "Modifier l'objectif" : 'Nouvel objectif', subtitle: 'Fixez un montant a atteindre', tab: 'goals', html,
      mount: (root) => {
        root.querySelector('[data-form="goal"]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const name = (fd.get('name') || '').trim();
          const target = S.round2(parseFloat(fd.get('target')));
          const err = root.querySelector('[data-err]');
          if (!name) { err.hidden = false; err.textContent = 'Nom requis.'; return; }
          if (!(target > 0)) { err.hidden = false; err.textContent = 'Montant cible invalide.'; return; }
          const rec = {
            name, target, deadline: fd.get('deadline') || null,
            color: fd.get('color') || '#0f766e', icon: (fd.get('icon') || 'saving').trim(),
            archived: item ? item.archived : false,
            createdAt: item ? item.createdAt : Date.now(),
          };
          if (item) {
            rec.id = item.id; await DB.put('goals', rec);
            State.data.goals = await DB.all('goals');
          } else {
            const created = await DB.add('goals', rec);
            State.data.goals = await DB.all('goals');
            const initial = S.round2(Math.max(0, parseFloat(fd.get('saved')) || 0));
            if (initial > 0) await goalContribute(created, initial);
          }
          flash('success', item ? 'Objectif mis a jour.' : 'Objectif cree.');
          go('#/goals');
        });
        const del = root.querySelector('[data-del-goal]');
        if (del) del.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!await confirmModal("Supprimer cet objectif ? Les depenses d'epargne deja enregistrees sont conservees.")) return;
          const gid = Number(del.getAttribute('data-del-goal'));
          for (const ex of State.data.expenses.filter((x) => x.goalId === gid)) await DB.put('expenses', { ...ex, goalId: null });
          await DB.remove('goals', gid);
          State.data.expenses = await DB.all('expenses');
          State.data.goals = await DB.all('goals');
          flash('success', 'Objectif supprime.'); go('#/goals');
        });
      },
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
      recurrences: d.recurrences.filter((r) => r.active).length,
      goals: d.goals.filter((g) => !g.archived).length,
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
          <a class="btn btn-ghost btn-sm" href="#/sources">Gerer</a></li>
        <li class="row"><span class="row-icon" style="background:#7c3aed">🔁</span>
          <span class="row-main"><span class="t">Transactions recurrentes</span><span class="s">${stats.recurrences} active${stats.recurrences > 1 ? 's' : ''}</span></span>
          <a class="btn btn-ghost btn-sm" href="#/recurrences">Gerer</a></li>
        <li class="row"><span class="row-icon" style="background:#0ea5e9">🐖</span>
          <span class="row-main"><span class="t">Objectifs d'epargne</span><span class="s">${stats.goals} objectif${stats.goals > 1 ? 's' : ''}</span></span>
          <a class="btn btn-ghost btn-sm" href="#/goals">Gerer</a></li></ul></div>

      <div class="card"><h2 class="card-title">Mes donnees</h2><div class="stat-grid">
        <div class="stat"><div class="k">Depenses</div><div class="v">${stats.expenses}</div></div>
        <div class="stat"><div class="k">Total cumule</div><div class="v">${money(stats.total)}</div></div>
        <div class="stat"><div class="k">Revenus</div><div class="v">${stats.incomes}</div></div>
        <div class="stat"><div class="k">Total encaisse</div><div class="v">${money(stats.earned)}</div></div>
        <div class="stat"><div class="k">Categories</div><div class="v">${stats.categories}</div></div>
        <div class="stat"><div class="k">Limites</div><div class="v">${stats.limits}</div></div></div></div>

      <div class="card"><h2 class="card-title">Sauvegarde</h2>
        <p class="helptext" style="margin-bottom:10px">Vos donnees ne sont enregistrees que sur cet appareil. Sauvegardez-les regulierement (Drive, WhatsApp, e-mail...) pour pouvoir les restaurer si vous perdez ou changez de telephone.</p>
        <p class="helptext" style="margin-bottom:12px"><b>${State.lastBackup ? `Derniere sauvegarde : ${relLabel(State.lastBackup)}` : 'Aucune sauvegarde effectuee pour le moment.'}</b></p>
        <div class="btn-row"><button class="btn" data-share>Sauvegarder et partager</button>
          <button class="btn btn-ghost" data-backup>Exporter le fichier</button>
          <button class="btn btn-ghost" data-restore>Restaurer</button></div>
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
        root.querySelector('[data-share]').addEventListener('click', async () => { await shareBackup(); go('#/settings'); });
        root.querySelector('[data-backup]').addEventListener('click', async () => { await backupJSON(); go('#/settings'); });
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

  async function buildBackup() {
    const dump = { version: 1, exportedAt: new Date().toISOString(), meta: { currency: State.currency, threshold: State.threshold } };
    for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts', 'recurrences', 'goals']) dump[s] = await DB.all(s);
    return dump;
  }

  function backupName() { return `budget-control_sauvegarde_${S.todayISO()}.json`; }

  // Enregistre l'instant de sauvegarde et lève le rappel (et l'eventuel report).
  async function markBackupDone() {
    const now = new Date().toISOString();
    await DB.metaSet('lastBackup', now); State.lastBackup = now;
    if (State.backupSnooze) { await DB.metaSet('backupSnooze', null); State.backupSnooze = null; }
  }

  // "Exporter (JSON)" : enregistre le fichier (APK -> selecteur systeme, navigateur -> telechargement).
  async function backupJSON() {
    download(backupName(), JSON.stringify(await buildBackup(), null, 2), 'application/json');
    await markBackupDone();
    flash('success', 'Sauvegarde enregistree.');
  }

  // "Sauvegarder et partager" : ouvre le partage systeme quand il existe
  // (mobile / PWA -> WhatsApp, Drive, mail...), sinon repli sur l'enregistrement.
  async function shareBackup() {
    const text = JSON.stringify(await buildBackup(), null, 2);
    const name = backupName();
    try {
      if (navigator.canShare) {
        const file = new File([text], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Sauvegarde Budget Control' });
          await markBackupDone();
          flash('success', 'Sauvegarde partagee.');
          return;
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // partage annule : ne pas retomber sur le telechargement
    }
    download(name, text, 'application/json'); // repli : enregistrement local / selecteur systeme
    await markBackupDone();
    flash('success', 'Sauvegarde enregistree.');
  }

  // --- Rappel anti-perte de donnees ---------------------------------------
  // Les donnees vivent uniquement sur cet appareil : on invite a sauvegarder
  // quand il y a de quoi perdre et que la derniere sauvegarde date (ou jamais).
  function daysSince(iso) { return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : Infinity; }
  function relLabel(iso) { const dd = daysSince(iso); return dd <= 0 ? "aujourd'hui" : dd === 1 ? 'hier' : `il y a ${dd} jours`; }

  const BACKUP_MIN_RECORDS = 5;   // pas de rappel tant qu'il y a peu a perdre
  const BACKUP_MAX_AGE_DAYS = 14; // au-dela, on re-propose si de nouvelles donnees existent

  function backupDue() {
    const n = State.data.expenses.length + State.data.incomes.length;
    if (n < BACKUP_MIN_RECORDS) return false;
    if (State.backupSnooze && Date.parse(State.backupSnooze) > Date.now()) return false;
    if (!State.lastBackup) return true;                 // jamais sauvegarde
    if (daysSince(State.lastBackup) < BACKUP_MAX_AGE_DAYS) return false;
    const t = Date.parse(State.lastBackup);             // nouvelles donnees depuis la derniere sauvegarde ?
    return State.data.expenses.some((e) => (e.createdAt || 0) > t)
        || State.data.incomes.some((i) => (i.createdAt || 0) > t);
  }

  function backupBanner() {
    const detail = State.lastBackup
      ? `Derniere sauvegarde ${relLabel(State.lastBackup)}, et de nouvelles donnees ne le sont pas encore.`
      : "Vos donnees ne sont enregistrees que sur cet appareil.";
    return `<div class="alert alert-warning" style="margin-bottom:14px"><span class="ico">🛟</span>
      <div><b>Pensez a sauvegarder.</b> ${detail}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-sm" data-action="backup-now">Sauvegarder maintenant</button>
        <button class="btn btn-ghost btn-sm" data-action="backup-snooze">Plus tard</button>
      </div></div></div>`;
  }

  async function restoreJSON(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!await confirmModal('Remplacer toutes les donnees actuelles par cette sauvegarde ?')) { e.target.value = ''; return; }
    try {
      const dump = JSON.parse(await file.text());
      await DB.clearData(); // remplace les donnees, mais conserve licence / PIN / essai (store meta)
      for (const s of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts', 'recurrences', 'goals']) {
        if (Array.isArray(dump[s])) await DB.bulkAdd(s, dump[s]);
      }
      if (dump.meta) { await DB.metaSet('currency', dump.meta.currency || 'FCFA'); await DB.metaSet('threshold', dump.meta.threshold || 80); }
      // Les donnees correspondent desormais a cette sauvegarde : on date le rappel en consequence.
      if (dump.exportedAt) await DB.metaSet('lastBackup', dump.exportedAt);
      await DB.metaSet('backupSnooze', null);
      await load(); flash('success', 'Sauvegarde importee.'); go('#/');
    } catch (err) { flash('error', 'Fichier invalide.'); go('#/settings'); }
  }

  // --- Activation par code de licence SIGNE (Android uniquement) ----------
  //
  // Modele a cle publique (ECDSA P-256 / SHA-256). L'app ne contient que la cle
  // PUBLIQUE ci-dessous ; les codes sont signes avec la cle PRIVEE detenue par
  // l'editeur (mobile/license-sign.py, cle hors du depot). Un code =
  // base64url(identifiant 5 octets + signature 64 octets). L'app reconstruit le
  // message signe (PREFIX + identifiant) et verifie la signature, hors ligne.
  //
  // Interet : personne ne peut fabriquer un code valide sans la cle privee,
  // meme en lisant l'app ou ce depot public. (Un bricoleur peut toujours retirer
  // l'ecran en modifiant le code — mais pas EMETTRE de codes valides.)

  const LICENSE_PUBLIC_JWK = {"kty":"EC","crv":"P-256","x":"f4zRAm7g79Yvnf2wJhi3B30gQamzASfqZ4jzAoB0raA","y":"mVDdC4_KjNnG0vER4aBVt8JEkm9zP6fc44rKl5xqhn0"};
  const LICENSE_PREFIX = new TextEncoder().encode('BudgetControl-license-v1|');
  const LICENSE_ID_LEN = 5;

  let _licenseKeyPromise = null;
  function licensePublicKey() {
    if (!_licenseKeyPromise) {
      _licenseKeyPromise = crypto.subtle.importKey(
        'jwk', LICENSE_PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
    }
    return _licenseKeyPromise;
  }

  function b64urlToBytes(raw) {
    let s = (raw || '').replace(/\s+/g, '');            // retire espaces / retours ligne
    s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    s += '='.repeat((-s.length % 4 + 4) % 4);
    try {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  function normalizeLicense(raw) {
    return (raw || '').replace(/\s+/g, '');
  }

  async function licenseValid(raw) {
    const bytes = b64urlToBytes(raw);
    if (!bytes || bytes.length !== LICENSE_ID_LEN + 64) return false;
    const ident = bytes.slice(0, LICENSE_ID_LEN);
    const sig = bytes.slice(LICENSE_ID_LEN);
    const msg = new Uint8Array(LICENSE_PREFIX.length + ident.length);
    msg.set(LICENSE_PREFIX, 0);
    msg.set(ident, LICENSE_PREFIX.length);
    try {
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, await licensePublicKey(), sig, msg
      );
    } catch (e) {
      return false; // crypto.subtle indisponible : on ne valide pas a l'aveugle
    }
  }

  // Exige un code valide au premier lancement, puis le retient. N'est appelee
  // que dans l'APK Android (presence de window.AndroidBridge).
  // --- Periode d'essai gratuite (3 mois) puis licence --------------------
  // La date de debut est stockee sur l'appareil : essai dissuasif, comme le
  // verrou lui-meme (une reinitialisation des donnees ou un recul de l'horloge
  // relance l'essai — impossible a empecher sans serveur).
  const TRIAL_MONTHS = 3;
  let trialLeft = null; // jours d'essai restants (banniere), sinon null

  function trialEndDate(startISO) {
    const [y, m, d] = startISO.split('-').map(Number);
    return new Date(y, m - 1 + TRIAL_MONTHS, d);
  }

  // Regle : licence a vie > essai gratuit en cours > exiger le code.
  async function enforceLicense() {
    const stored = await DB.metaGet('license', null);
    if (stored && await licenseValid(stored)) return;
    let start = await DB.metaGet('trialStart', null);
    if (!start) { start = Services.todayISO(); await DB.metaSet('trialStart', start); }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = trialEndDate(start);
    if (today < end) {
      trialLeft = Math.max(0, Math.ceil((end - today) / 86400000));
      return; // encore en essai gratuit
    }
    await requireLicense(true); // essai termine
  }

  async function requireLicense(trialEnded) {
    const stored = await DB.metaGet('license', null);
    if (stored && await licenseValid(stored)) { trialLeft = null; return; }

    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'lock-screen';
      ov.innerHTML = `<div class="lock-box">
        <div class="lock-logo">🔑</div>
        <h2>Activation</h2>
        <p>${trialEnded ? "Votre periode d'essai de 3 mois est terminee. " : ''}Collez votre code de licence pour ${trialEnded ? 'continuer' : "activer l'application"}.</p>
        <textarea id="lic-input" rows="3" autocomplete="off" autocapitalize="off"
                  autocorrect="off" spellcheck="false" placeholder="Collez le code ici"
                  style="width:100%;font-family:monospace;font-size:13px;word-break:break-all"></textarea>
        <div id="lic-error" class="errorlist" hidden>Code invalide. Verifiez le collage.</div>
        <button class="btn btn-block" id="lic-btn" style="margin-top:12px">Activer</button></div>`;
      document.body.appendChild(ov);
      const input = ov.querySelector('#lic-input');
      const err = ov.querySelector('#lic-error');
      const btn = ov.querySelector('#lic-btn');
      const attempt = async () => {
        btn.disabled = true;
        if (await licenseValid(input.value)) {
          await DB.metaSet('license', normalizeLicense(input.value));
          trialLeft = null;
          ov.remove();
          resolve();
        } else {
          err.hidden = false; btn.disabled = false; input.select();
        }
      };
      btn.addEventListener('click', attempt);
    });
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
    await DB.clearData(); // conserve licence / PIN / essai
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

    const todayIso = S.todayISO();
    await DB.bulkAdd('recurrences', [
      { kind: 'income', amount: 185000, refId: srcBy['Salaire'], frequency: 'monthly', method: 'transfer', description: 'Salaire mensuel', note: '', startDate: S.addDays(todayIso, -1), endDate: null, nextDue: S.addDays(todayIso, -1), active: true, createdAt: Date.now(), lastRun: null },
      { kind: 'expense', amount: 9000, refId: catBy['Communication'], frequency: 'monthly', method: 'mobile', description: 'Forfait telephone', note: '', startDate: S.addDays(todayIso, -2), endDate: null, nextDue: S.addDays(todayIso, -2), active: true, createdAt: Date.now(), lastRun: null },
      { kind: 'expense', amount: 45000, refId: catBy['Logement'], frequency: 'monthly', method: 'transfer', description: 'Loyer', note: '', startDate: S.addDays(todayIso, 3), endDate: null, nextDue: S.addDays(todayIso, 3), active: true, createdAt: Date.now(), lastRun: null },
    ]);

    const g1 = await DB.add('goals', { name: "Fonds d'urgence", target: 500000, deadline: null, color: '#0f766e', icon: 'saving', archived: false, createdAt: Date.now() });
    const g2 = await DB.add('goals', { name: 'Rentree scolaire', target: 150000, deadline: S.addDays(todayIso, 45), color: '#6366f1', icon: 'school', archived: false, createdAt: Date.now() - 1 });
    await DB.bulkAdd('expenses', [
      { amount: 180000, categoryId: catBy['Epargne'], description: "Epargne : Fonds d'urgence", date: S.addDays(todayIso, -20), method: 'transfer', note: '', goalId: g1.id, createdAt: Date.now() },
      { amount: 150000, categoryId: catBy['Epargne'], description: 'Epargne : Rentree scolaire', date: S.addDays(todayIso, -30), method: 'transfer', note: '', goalId: g2.id, createdAt: Date.now() - 1 },
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
    [/^#\/recurrences/, () => Views.recurrences()],
    [/^#\/recurrence\/new/, () => Views.recurrenceForm(null)],
    [/^#\/recurrence\/(\d+)/, (m) => Views.recurrenceForm(Number(m[1]))],
    [/^#\/goals/, () => Views.goals()],
    [/^#\/goal\/new/, () => Views.goalForm(null)],
    [/^#\/goal\/(\d+)/, (m) => Views.goalForm(Number(m[1]))],
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
    // Code de licence : uniquement dans l'APK Android (pont natif present).
    if (window.AndroidBridge) await enforceLicense();
    await guardLock();
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', init);

  async function activate() { await requireLicense(false); go('#/'); }

  return { State, go, activate };
})();
