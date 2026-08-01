/* Budget Control — regles de gestion (port fidele de budget/services.py).
 *
 * Meme logique que la version Django : bornes de periodes (semaine lundi ->
 * dimanche), agregations, comparaisons, solde, alertes de limite et alerte
 * « depenses > revenus du mois ». Les montants sont arrondis au centime pour
 * eviter les derives de la virgule flottante.
 */

const Services = (function () {
  'use strict';

  const PERIOD_LABELS = {
    day: ['Aujourd’hui', 'Hier'],
    week: ['Cette semaine', 'Semaine derniere'],
    month: ['Ce mois-ci', 'Mois dernier'],
    year: ['Cette annee', 'Annee derniere'],
  };

  const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin',
    'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

  // --- Utilitaires de date (chaines ISO 'YYYY-MM-DD') ---------------------

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

  function todayISO() { return iso(new Date()); }

  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }

  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

  function sum(list, key) {
    return round2(list.reduce((acc, r) => acc + (key ? r[key] : r), 0));
  }

  // --- Bornes de periodes -------------------------------------------------

  function periodBounds(kind, refISO) {
    const ref = parse(refISO || todayISO());
    if (kind === 'day') {
      const s = iso(ref);
      return { kind, start: s, end: s };
    }
    if (kind === 'week') {
      const dow = (ref.getDay() + 6) % 7; // 0 = lundi
      const start = new Date(ref); start.setDate(ref.getDate() - dow);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { kind, start: iso(start), end: iso(end) };
    }
    if (kind === 'month') {
      const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      return { kind, start: iso(start), end: iso(end) };
    }
    if (kind === 'year') {
      return { kind, start: ref.getFullYear() + '-01-01', end: ref.getFullYear() + '-12-31' };
    }
    throw new Error('Periode inconnue : ' + kind);
  }

  function previousPeriod(kind, refISO) {
    const cur = periodBounds(kind, refISO);
    return periodBounds(kind, addDays(cur.start, -1));
  }

  function label(kind) { return PERIOD_LABELS[kind][0]; }

  // --- Filtres et agregations --------------------------------------------

  function inPeriod(rows, period, filterKey, filterVal) {
    return rows.filter((r) =>
      r.date >= period.start && r.date <= period.end &&
      (filterVal == null || r[filterKey] === filterVal));
  }

  function totalFor(rows, period, filterKey, filterVal) {
    return sum(inPeriod(rows, period, filterKey, filterVal), 'amount');
  }

  // Repartition [{id,name,color,total,count,share}] triee du plus gros au plus petit.
  function breakdown(rows, period, refs, idKey) {
    const sel = inPeriod(rows, period);
    const byId = {};
    for (const r of sel) {
      const k = r[idKey];
      if (!byId[k]) byId[k] = { total: 0, count: 0 };
      byId[k].total += r.amount;
      byId[k].count += 1;
    }
    const grand = sum(sel, 'amount');
    const out = Object.keys(byId).map((k) => {
      const ref = refs.find((x) => x.id === Number(k)) || { name: '?', color: '#64748b' };
      const total = round2(byId[k].total);
      return {
        id: Number(k), name: ref.name, color: ref.color, total: total,
        count: byId[k].count, share: grand ? (total / grand) * 100 : 0,
      };
    });
    out.sort((a, b) => b.total - a.total);
    return out;
  }

  function compare(rows, kind, refISO, isIncome) {
    const cur = periodBounds(kind, refISO);
    const prev = previousPeriod(kind, refISO);
    const now = totalFor(rows, cur);
    const before = totalFor(rows, prev);
    const variation = before ? ((now - before) / before) * 100 : null;
    return {
      kind: kind, label: PERIOD_LABELS[kind][0], previousLabel: PERIOD_LABELS[kind][1],
      current: now, previous: before, delta: round2(now - before), variation: variation,
      improving: isIncome ? now >= before : now <= before, period: cur,
    };
  }

  function timeline(rows, kind, refISO) {
    const ref = parse(refISO || todayISO());
    if (kind === 'year') {
      const totals = {};
      for (const r of rows) {
        const d = parse(r.date);
        if (d.getFullYear() === ref.getFullYear()) {
          totals[d.getMonth()] = (totals[d.getMonth()] || 0) + r.amount;
        }
      }
      return MONTHS.map((m, i) => ({ label: m, value: round2(totals[i] || 0) }));
    }
    let span;
    if (kind === 'day') {
      span = []; for (let i = 13; i >= 0; i--) span.push(addDays(iso(ref), -i));
    } else {
      const p = periodBounds(kind, refISO);
      span = []; let c = p.start;
      while (c <= p.end) { span.push(c); c = addDays(c, 1); }
    }
    const totals = {};
    for (const r of rows) if (totals[r.date] != null || true) totals[r.date] = (totals[r.date] || 0) + r.amount;
    return span.map((d) => {
      const dt = parse(d);
      const lab = kind === 'week'
        ? ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][dt.getDay()]
        : pad(dt.getDate()) + '/' + pad(dt.getMonth() + 1);
      return { label: lab, value: round2(totals[d] || 0) };
    });
  }

  // --- Solde --------------------------------------------------------------

  function sumBefore(list, startISO) {
    return sum(list.filter((r) => r.date < startISO), 'amount');
  }

  function balance(expenses, incomes, period) {
    const inc = totalFor(incomes, period);
    const exp = totalFor(expenses, period);
    // Report : ce qui restait disponible avant le debut de la periode (cumul de
    // tout l'historique anterieur). Assure la continuite d'un mois a l'autre.
    const carryOver = round2(sumBefore(incomes, period.start) - sumBefore(expenses, period.start));
    const available = round2(carryOver + inc - exp);
    return {
      income: inc, expense: exp, carryOver, available,
      balance: round2(inc - exp),
      isPositive: available >= 0,
      spentRatio: inc ? (exp / inc) * 100 : null,
      period: period,
    };
  }

  // --- Limites budgetaires ------------------------------------------------

  function limitStatus(expenses, limit, threshold, refISO) {
    const period = periodBounds(limit.period, refISO);
    const spent = totalFor(expenses, period, 'categoryId', limit.categoryId || null);
    const percent = limit.amount ? (spent / limit.amount) * 100 : 0;
    let level = null;
    if (percent >= 100) level = 'exceeded';
    else if (percent >= threshold) level = 'warning';
    return {
      limit: limit, period: period, spent: spent, amount: limit.amount,
      remaining: round2(limit.amount - spent), percent: percent,
      barPercent: Math.min(percent, 100), level: level,
      isWarning: level === 'warning', isExceeded: level === 'exceeded',
    };
  }

  function allLimitStatuses(expenses, limits, categories, threshold, refISO, includeInactive) {
    const order = { day: 0, week: 1, month: 2, year: 3 };
    const sel = limits.filter((l) => includeInactive || l.active);
    return sel.map((l) => {
      const st = limitStatus(expenses, l, threshold, refISO);
      const cat = l.categoryId ? categories.find((c) => c.id === l.categoryId) : null;
      st.target = cat ? cat.name : 'Toutes categories';
      st.color = cat ? cat.color : '#0f766e';
      return st;
    }).sort((a, b) => (order[a.limit.period] - order[b.limit.period]) ||
      a.target.localeCompare(b.target));
  }

  // --- Alertes ------------------------------------------------------------

  // Renvoie {toCreate:[...], toDeleteIds:[...], toUpdate:[...]} — l'appelant
  // applique les changements en base. Idempotent comme la version Python.
  function evaluateAlerts(data, threshold, refISO) {
    const ref = refISO || todayISO();
    const toCreate = [], toUpdate = [], toDeleteIds = [];
    const existing = data.alerts;

    // Alertes de limites.
    const statuses = allLimitStatuses(data.expenses, data.limits, data.categories, threshold, ref, false);
    for (const st of statuses) {
      if (!st.level) continue;
      const levels = st.level === 'exceeded' ? ['warning', 'exceeded'] : ['warning'];
      for (const lvl of levels) {
        const found = existing.find((a) => a.kind === 'limit' && a.limitId === st.limit.id &&
          a.level === lvl && a.periodStart === st.period.start);
        if (!found) {
          toCreate.push({
            kind: 'limit', limitId: st.limit.id, level: lvl,
            periodStart: st.period.start, periodEnd: st.period.end,
            spent: st.spent, limitAmount: st.amount, read: false, createdAt: Date.now(),
          });
        } else if (found.spent !== st.spent) {
          toUpdate.push({ ...found, spent: st.spent });
        }
      }
    }

    // Alerte depenses > revenus du mois.
    const month = periodBounds('month', ref);
    const income = totalFor(data.incomes, month);
    const expense = totalFor(data.expenses, month);
    const over = existing.find((a) => a.kind === 'overspend' && a.periodStart === month.start);
    if (income > 0 && expense > income) {
      if (!over) {
        toCreate.push({
          kind: 'overspend', limitId: null, level: 'exceeded',
          periodStart: month.start, periodEnd: month.end,
          spent: expense, limitAmount: income, read: false, createdAt: Date.now(),
        });
      } else if (!over.read && (over.spent !== expense || over.limitAmount !== income)) {
        toUpdate.push({ ...over, spent: expense, limitAmount: income });
      }
    } else if (over && !over.read) {
      toDeleteIds.push(over.id); // situation resolue, alerte non lue : on la retire
    }

    return { toCreate, toUpdate, toDeleteIds };
  }

  // Une alerte visible par limite et periode (la plus severe : 'exceeded' > 'warning').
  function unreadAlerts(alerts, limitCount) {
    const unread = alerts.filter((a) => !a.read)
      .sort((a, b) => {
        const ka = (a.limitId || 0) - (b.limitId || 0);
        if (ka) return ka;
        if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? -1 : 1;
        return a.level.localeCompare(b.level); // 'exceeded' avant 'warning'
      });
    const seen = new Set(), kept = [];
    for (const a of unread) {
      const key = (a.limitId || 'over') + '|' + a.periodStart;
      if (seen.has(key)) continue;
      seen.add(key); kept.push(a);
    }
    return kept.slice(0, limitCount || 5);
  }

  function ratio(alert) {
    return alert.limitAmount ? (alert.spent / alert.limitAmount) * 100 : 0;
  }

  return {
    PERIOD_LABELS, MONTHS, iso, parse, todayISO, addDays, round2, sum,
    periodBounds, previousPeriod, label, inPeriod, totalFor, breakdown,
    compare, timeline, balance, limitStatus, allLimitStatuses,
    evaluateAlerts, unreadAlerts, ratio,
  };
})();
