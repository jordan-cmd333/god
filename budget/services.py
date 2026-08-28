"""Regles de gestion : agregation par periode, comparaisons, alertes, rapports.

Toute la logique de calcul vit ici pour que les vues restent minces et que les
memes chiffres alimentent le tableau de bord, les rapports et les exports.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Sum
from django.utils import timezone

from .models import (
    Alert, BudgetLimit, Category, Expense, Income, IncomeSource,
    RecurringTransaction, Report,
)

ZERO = Decimal('0.00')

PERIOD_LABELS = {
    'day': ('Aujourd’hui', 'Hier'),
    'week': ('Cette semaine', 'Semaine derniere'),
    'month': ('Ce mois-ci', 'Mois dernier'),
    'year': ('Cette annee', 'Annee derniere'),
}


# --------------------------------------------------------------------------
# Bornes de periodes
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Period:
    kind: str
    start: date
    end: date  # inclusive

    @property
    def label(self):
        return PERIOD_LABELS[self.kind][0]


def today():
    return timezone.localdate()


def period_bounds(kind: str, ref: date | None = None) -> Period:
    """Retourne les bornes (incluses) de la periode contenant `ref`."""
    ref = ref or today()
    if kind == 'day':
        return Period(kind, ref, ref)
    if kind == 'week':
        start = ref - timedelta(days=ref.weekday())  # lundi
        return Period(kind, start, start + timedelta(days=6))
    if kind == 'month':
        start = ref.replace(day=1)
        return Period(kind, start, ref.replace(day=monthrange(ref.year, ref.month)[1]))
    if kind == 'year':
        return Period(kind, date(ref.year, 1, 1), date(ref.year, 12, 31))
    raise ValueError(f'Periode inconnue : {kind}')


def previous_period(kind: str, ref: date | None = None) -> Period:
    """Periode precedente : hier, semaine passee, mois passe, annee passee."""
    current = period_bounds(kind, ref)
    return period_bounds(kind, current.start - timedelta(days=1))


# --------------------------------------------------------------------------
# Agregations
# --------------------------------------------------------------------------

def _rows_in(model, user, period: Period, **filters):
    qs = model.objects.filter(user=user, date__gte=period.start, date__lte=period.end)
    return qs.filter(**{k: v for k, v in filters.items() if v is not None})


def _total(model, user, period: Period, **filters) -> Decimal:
    return _rows_in(model, user, period, **filters).aggregate(t=Sum('amount'))['t'] or ZERO


def _breakdown(model, relation, user, period: Period):
    """Repartition [{name, color, total, count, share}], du plus gros au plus petit."""
    rows = (
        _rows_in(model, user, period)
        .values(f'{relation}__name', f'{relation}__color')
        .annotate(total=Sum('amount'), count=Count('id'))
        .order_by('-total')
    )
    grand_total = sum((r['total'] for r in rows), ZERO)
    return [
        {
            'name': r[f'{relation}__name'],
            'color': r[f'{relation}__color'],
            'total': r['total'],
            'count': r['count'],
            'share': float(r['total']) / float(grand_total) * 100 if grand_total else 0,
        }
        for r in rows
    ]


# -- Depenses ---------------------------------------------------------------

def expenses_in(user, period: Period, category=None):
    return _rows_in(Expense, user, period, category=category)


def total_for(user, period: Period, category=None) -> Decimal:
    """Somme automatique des depenses de la periode."""
    return _total(Expense, user, period, category=category)


def breakdown_by_category(user, period: Period):
    return _breakdown(Expense, 'category', user, period)


def top_category(user, period: Period):
    """Categorie ou l'utilisateur depense le plus sur la periode."""
    rows = breakdown_by_category(user, period)
    return rows[0] if rows else None


# -- Revenus ----------------------------------------------------------------

def incomes_in(user, period: Period, source=None):
    return _rows_in(Income, user, period, source=source)


def income_total(user, period: Period, source=None) -> Decimal:
    """Somme automatique des rentrees d'argent de la periode."""
    return _total(Income, user, period, source=source)


def breakdown_by_source(user, period: Period):
    return _breakdown(Income, 'source', user, period)


def top_source(user, period: Period):
    """Source qui rapporte le plus sur la periode."""
    rows = breakdown_by_source(user, period)
    return rows[0] if rows else None


def _sum_before(qs, start):
    return qs.filter(date__lt=start).aggregate(t=Sum('amount'))['t'] or ZERO


def balance(user, period: Period):
    """Solde de la periode, avec report du reste anterieur (continuite).

    Le report est le cumul de tout l'historique avant le debut de la periode
    (revenus - depenses). Le solde disponible = report + revenus - depenses de
    la periode, ce qui assure la continuite d'un mois a l'autre.
    """
    entrees, sorties = income_total(user, period), total_for(user, period)
    carry_over = (
        _sum_before(Income.objects.filter(user=user), period.start)
        - _sum_before(Expense.objects.filter(user=user), period.start)
    )
    available = carry_over + entrees - sorties
    return {
        'income': entrees,
        'expense': sorties,
        'carry_over': carry_over,
        'available': available,
        'balance': entrees - sorties,
        'is_positive': available >= 0,
        # Part des revenus deja depensee : au-dela de 100 %, on vit sur ses reserves.
        'spent_ratio': float(sorties) / float(entrees) * 100 if entrees else None,
        'period': period,
    }


def compare(user, kind: str, ref: date | None = None, model=Expense):
    """Compare la periode courante a la precedente.

    `improving` vaut « la situation va dans le bon sens » : depenser moins pour
    les depenses, gagner plus pour les revenus.
    """
    current, previous = period_bounds(kind, ref), previous_period(kind, ref)
    now_total = _total(model, user, current)
    prev_total = _total(model, user, previous)
    # Sans reference sur la periode precedente, un pourcentage n'a pas de sens :
    # on renvoie None et les gabarits affichent « pas de reference ».
    variation = (
        float(now_total - prev_total) / float(prev_total) * 100 if prev_total else None
    )
    return {
        'kind': kind,
        'label': PERIOD_LABELS[kind][0],
        'previous_label': PERIOD_LABELS[kind][1],
        'current': now_total,
        'previous': prev_total,
        'delta': now_total - prev_total,
        'variation': variation,
        'improving': (now_total >= prev_total if model is Income
                      else now_total <= prev_total),
        'period': current,
    }


def timeline(user, kind: str, ref: date | None = None, model=Expense):
    """Serie temporelle pour le graphique d'evolution.

    jour -> 24 h impossible a granularite date, on renvoie donc les 14 derniers
    jours ; semaine -> 7 jours ; mois -> jours du mois ; annee -> 12 mois.
    """
    ref = ref or today()
    if kind == 'year':
        year = ref.year
        rows = (
            model.objects.filter(user=user, date__year=year)
            .values('date__month')
            .annotate(total=Sum('amount'))
        )
        totals = {r['date__month']: r['total'] for r in rows}
        noms = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin',
                'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec']
        return [
            {'label': noms[m - 1], 'value': float(totals.get(m, 0))}
            for m in range(1, 13)
        ]

    if kind == 'day':
        span = [ref - timedelta(days=i) for i in range(13, -1, -1)]
    else:
        p = period_bounds(kind, ref)
        span = [p.start + timedelta(days=i) for i in range((p.end - p.start).days + 1)]

    rows = (
        model.objects.filter(user=user, date__gte=span[0], date__lte=span[-1])
        .values('date')
        .annotate(total=Sum('amount'))
    )
    totals = {r['date']: r['total'] for r in rows}
    fmt = '%d/%m' if kind != 'week' else '%a'
    return [
        {'label': d.strftime(fmt), 'value': float(totals.get(d, 0))} for d in span
    ]


# --------------------------------------------------------------------------
# Limites budgetaires et alertes
# --------------------------------------------------------------------------

def _threshold(user) -> float:
    profile = getattr(user, 'profile', None)
    if profile:
        return profile.alert_threshold / 100
    return settings.BUDGET_ALERT_THRESHOLD


def limit_status(user, limit: BudgetLimit, ref: date | None = None):
    """Etat d'une limite : depense, reste, pourcentage, niveau d'alerte."""
    period = period_bounds(limit.period, ref)
    spent = total_for(user, period, category=limit.category)
    limit_amount = limit.amount
    percent = float(spent) / float(limit_amount) * 100 if limit_amount else 0
    threshold = _threshold(user) * 100

    if percent >= 100:
        level = Alert.Level.EXCEEDED
    elif percent >= threshold:
        level = Alert.Level.WARNING
    else:
        level = None

    return {
        'limit': limit,
        'period': period,
        'target': limit.category.name if limit.category else 'Toutes categories',
        'color': limit.category.color if limit.category else '#0f766e',
        'spent': spent,
        'amount': limit_amount,
        'remaining': limit_amount - spent,
        'percent': percent,
        'bar_percent': min(percent, 100),
        'level': level,
        'is_warning': level == Alert.Level.WARNING,
        'is_exceeded': level == Alert.Level.EXCEEDED,
    }


def all_limit_statuses(user, ref: date | None = None, include_inactive=False):
    """Etat de chaque limite.

    Le tableau de bord ne montre que les limites actives ; la page Budgets les
    montre toutes, sans quoi une limite desactivee serait invisible tout en
    bloquant la creation d'une limite identique.
    """
    limits = BudgetLimit.objects.filter(user=user).select_related('category')
    if not include_inactive:
        limits = limits.filter(is_active=True)
    order = {'day': 0, 'week': 1, 'month': 2, 'year': 3}
    return sorted(
        (limit_status(user, limit, ref) for limit in limits),
        key=lambda s: (order[s['limit'].period], s['target']),
    )


def evaluate_alerts(user, ref: date | None = None):
    """Cree les alertes manquantes (80 % atteint / limite depassee).

    Idempotent : la contrainte d'unicite (limite, niveau, debut de periode)
    garantit qu'une meme alerte n'est pas dupliquee.
    """
    created = []
    for status in all_limit_statuses(user, ref):
        if status['level'] is None:
            continue
        levels = [Alert.Level.WARNING]
        if status['level'] == Alert.Level.EXCEEDED:
            levels.append(Alert.Level.EXCEEDED)
        for level in levels:
            alert, is_new = Alert.objects.get_or_create(
                user=user,
                limit=status['limit'],
                level=level,
                period_start=status['period'].start,
                defaults={
                    'period_end': status['period'].end,
                    'spent': status['spent'],
                    'limit_amount': status['amount'],
                },
            )
            if is_new:
                created.append(alert)
            elif alert.spent != status['spent']:
                alert.spent = status['spent']
                alert.save(update_fields=['spent'])

    overspend = evaluate_overspend(user, ref)
    if overspend:
        created.append(overspend)
    return created


def evaluate_overspend(user, ref: date | None = None):
    """Alerte quand les depenses du mois depassent les revenus du mois.

    Ne se declenche que si des revenus sont enregistres (sinon un utilisateur
    qui ne suit que ses depenses recevrait un bandeau rouge permanent). Tant
    qu'elle n'a pas ete lue, l'alerte se met a jour et disparait si la situation
    se retablit — un bandeau rouge devenu faux serait pire que pas d'alerte.
    """
    ref = ref or today()
    month = period_bounds('month', ref)
    income = income_total(user, month)
    expense = total_for(user, month)

    existing = Alert.objects.filter(
        user=user, kind=Alert.Kind.OVERSPEND, period_start=month.start
    ).first()

    if not (income > ZERO and expense > income):
        if existing and not existing.is_read:
            existing.delete()  # situation resolue, alerte non lue : on la retire
        return None

    if existing:
        if not existing.is_read and (
            existing.spent != expense or existing.limit_amount != income
        ):
            existing.spent, existing.limit_amount = expense, income
            existing.save(update_fields=['spent', 'limit_amount'])
        return None  # deja signalee ce mois-ci

    return Alert.objects.create(
        user=user, kind=Alert.Kind.OVERSPEND, level=Alert.Level.EXCEEDED,
        limit=None, period_start=month.start, period_end=month.end,
        spent=expense, limit_amount=income,
    )


# --------------------------------------------------------------------------
# Rapports
# --------------------------------------------------------------------------

def build_report(user, kind: str, ref: date | None = None) -> Report:
    """Genere (ou rafraichit) le rapport de la periode contenant `ref`."""
    period = period_bounds(kind, ref)
    rows = breakdown_by_category(user, period)
    total = sum((r['total'] for r in rows), ZERO)
    count = expenses_in(user, period).count()

    report, _ = Report.objects.update_or_create(
        user=user,
        kind=kind,
        period_start=period.start,
        defaults={
            'period_end': period.end,
            'total': total,
            'expense_count': count,
            'top_category': rows[0]['name'] if rows else '',
            'breakdown': [
                {'name': r['name'], 'total': str(r['total']), 'share': round(r['share'], 2)}
                for r in rows
            ],
        },
    )
    return report


def refresh_reports(user, ref: date | None = None):
    """Rapports jour / semaine / mois / annee generes selon la date des depenses."""
    return [build_report(user, kind, ref) for kind in ('day', 'week', 'month', 'year')]


def dashboard_context(user, ref: date | None = None):
    """Tout ce dont le tableau de bord a besoin, en une passe."""
    ref = ref or today()
    evaluate_alerts(user, ref)
    refresh_reports(user, ref)

    comparisons = [compare(user, kind, ref) for kind in ('day', 'week', 'month', 'year')]
    month = period_bounds('month', ref)
    return {
        'comparisons': comparisons,
        'balance': balance(user, month),
        'summaries': {c['kind']: c for c in comparisons},
        'limit_statuses': all_limit_statuses(user, ref),
        'top_category': top_category(user, month),
        'month_breakdown': breakdown_by_category(user, month),
        'timeline': timeline(user, 'month', ref),
        'recent': (
            Expense.objects.filter(user=user)
            .select_related('category')[:6]
        ),
        'unread_alerts': unread_alerts(user),
    }


def unread_alerts(user, limit_count=5):
    """Alertes non lues, une seule par limite et par periode.

    Un depassement cree aussi l'alerte de seuil (trace complete en base), mais
    afficher les deux serait redondant : on ne garde que la plus severe.
    """
    alerts = (
        Alert.objects.filter(user=user, is_read=False)
        .select_related('limit', 'limit__category')
        # tri alphabetique : 'exceeded' passe avant 'warning', donc le plus severe d'abord
        .order_by('limit_id', 'period_start', 'level')
    )
    seen, kept = set(), []
    for alert in alerts:
        key = (alert.limit_id, alert.period_start)
        if key in seen:
            continue
        seen.add(key)
        kept.append(alert)
    return kept[:limit_count]


def income_context(user, ref: date | None = None):
    """Tout ce dont la page Revenus a besoin, en une passe."""
    ref = ref or today()
    month = period_bounds('month', ref)
    comparisons = [
        compare(user, kind, ref, model=Income) for kind in ('day', 'week', 'month', 'year')
    ]
    return {
        'comparisons': comparisons,
        'summaries': {c['kind']: c for c in comparisons},
        'balance': balance(user, month),
        'top_source': top_source(user, month),
        'month_breakdown': breakdown_by_source(user, month),
        'timeline': timeline(user, 'month', ref, model=Income),
        'recent': Income.objects.filter(user=user).select_related('source')[:8],
        'recurring': recurring_streams(user),
    }


def recurring_streams(user, limit_count=5):
    """Les revenus recurrents, un par flux et non un par echeance.

    Un salaire encaisse trois mois de suite est un seul flux : on ne garde que
    la derniere occurrence, sinon la liste repete la meme ligne.
    """
    incomes = (
        Income.objects.filter(user=user, is_recurring=True)
        .select_related('source')
        .order_by('-date')
    )
    seen, kept = set(), []
    for income in incomes:
        key = (income.source_id, income.description.strip().lower())
        if key in seen:
            continue
        seen.add(key)
        kept.append(income)
        if len(kept) == limit_count:
            break
    return kept


def bootstrap_user(user):
    """Prepare un compte fraichement cree."""
    from .models import Profile

    Profile.objects.get_or_create(user=user)
    if not Category.objects.filter(user=user).exists():
        Category.create_defaults(user)
    if not IncomeSource.objects.filter(user=user).exists():
        IncomeSource.create_defaults(user)


# --------------------------------------------------------------------------
# Transactions recurrentes
# --------------------------------------------------------------------------

def advance_occurrence(current: date, frequency: str, anchor_day: int) -> date:
    """Date de l'occurrence suivante, en conservant le jour d'ancrage (jour du
    mois pour mensuel/annuel), avec repli sur le dernier jour du mois."""
    if frequency == 'weekly':
        return current + timedelta(days=7)
    if frequency == 'yearly':
        y = current.year + 1
        return date(y, current.month, min(anchor_day, monthrange(y, current.month)[1]))
    y, m = current.year, current.month + 1   # mensuel (defaut)
    if m > 12:
        m, y = 1, y + 1
    return date(y, m, min(anchor_day, monthrange(y, m)[1]))


def _recurrence_live(rec) -> bool:
    return rec.is_active and (rec.end_date is None or rec.next_due <= rec.end_date)


def due_recurrences(user, ref: date | None = None):
    """Echeances arrivees (a confirmer), triees par date."""
    ref = ref or today()
    qs = (RecurringTransaction.objects
          .filter(user=user, is_active=True, next_due__lte=ref)
          .select_related('category', 'source')
          .order_by('next_due'))
    return [r for r in qs if _recurrence_live(r)]


def upcoming_recurrences(user, ref: date | None = None, days: int = 7):
    """Echeances a venir dans les `days` prochains jours (apercu)."""
    ref = ref or today()
    horizon = ref + timedelta(days=days)
    qs = (RecurringTransaction.objects
          .filter(user=user, is_active=True, next_due__gt=ref, next_due__lte=horizon)
          .select_related('category', 'source')
          .order_by('next_due'))
    return [r for r in qs if _recurrence_live(r)]


def confirm_recurrence(rec):
    """Cree l'ecriture datee de l'echeance puis avance la recurrence."""
    d = rec.next_due
    if rec.kind == RecurringTransaction.Kind.INCOME:
        Income.objects.create(
            user=rec.user, source=rec.source, amount=rec.amount, date=d,
            method=rec.method, description=rec.description, is_recurring=True, note=rec.note,
        )
    else:
        Expense.objects.create(
            user=rec.user, category=rec.category, amount=rec.amount, date=d,
            payment_method=rec.method, description=rec.description, note=rec.note,
        )
    rec.last_run = d
    rec.next_due = advance_occurrence(rec.next_due, rec.frequency, rec.start_date.day)
    rec.save(update_fields=['last_run', 'next_due'])
    evaluate_alerts(rec.user, d)
    refresh_reports(rec.user, d)


def skip_recurrence(rec):
    """Avance la recurrence sans rien creer (echeance passee)."""
    rec.next_due = advance_occurrence(rec.next_due, rec.frequency, rec.start_date.day)
    rec.save(update_fields=['next_due'])


# --------------------------------------------------------------------------
# Objectifs d'epargne (contributions liees a une depense « Epargne »)
# --------------------------------------------------------------------------

def savings_category(user):
    """Categorie « Epargne » de l'utilisateur (creee au besoin)."""
    cat = (Category.objects.filter(user=user, is_archived=False, icon='saving').first()
           or Category.objects.filter(user=user, is_archived=False, name__iexact='Epargne').first())
    if cat is None:
        cat = Category.objects.create(user=user, name='Epargne', color='#22c55e', icon='saving')
    return cat


def contribute_to_goal(goal, amount):
    """Met de cote : cree une depense « Epargne » liee (sort du solde disponible)."""
    Expense.objects.create(
        user=goal.user, category=savings_category(goal.user), amount=amount,
        date=today(), payment_method=Expense.PaymentMethod.TRANSFER,
        description=f'Epargne : {goal.name}', goal=goal,
    )
    evaluate_alerts(goal.user, today())
    refresh_reports(goal.user, today())


def withdraw_from_goal(goal, amount):
    """Reprend de l'epargne : retire les dernieres contributions (l'argent
    revient dans le solde disponible). Clampe au montant epargne."""
    remaining = amount
    for e in goal.contributions.order_by('-date', '-created_at'):
        if remaining <= 0:
            break
        if e.amount <= remaining:
            remaining -= e.amount
            e.delete()
        else:
            e.amount -= remaining
            e.save(update_fields=['amount'])
            remaining = ZERO
    evaluate_alerts(goal.user, today())
    refresh_reports(goal.user, today())
