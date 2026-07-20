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

from .models import Alert, BudgetLimit, Category, Expense, Report

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

def expenses_in(user, period: Period, category=None):
    qs = Expense.objects.filter(
        user=user, date__gte=period.start, date__lte=period.end
    )
    if category is not None:
        qs = qs.filter(category=category)
    return qs


def total_for(user, period: Period, category=None) -> Decimal:
    """Somme automatique des depenses de la periode."""
    return expenses_in(user, period, category).aggregate(t=Sum('amount'))['t'] or ZERO


def breakdown_by_category(user, period: Period):
    """Liste [{name, color, total, share}] triee du plus gros au plus petit."""
    rows = (
        expenses_in(user, period)
        .values('category__name', 'category__color')
        .annotate(total=Sum('amount'), count=Count('id'))
        .order_by('-total')
    )
    grand_total = sum((r['total'] for r in rows), ZERO)
    return [
        {
            'name': r['category__name'],
            'color': r['category__color'],
            'total': r['total'],
            'count': r['count'],
            'share': float(r['total']) / float(grand_total) * 100 if grand_total else 0,
        }
        for r in rows
    ]


def top_category(user, period: Period):
    """Categorie ou l'utilisateur depense le plus sur la periode."""
    rows = breakdown_by_category(user, period)
    return rows[0] if rows else None


def compare(user, kind: str, ref: date | None = None):
    """Compare la periode courante a la precedente."""
    current, previous = period_bounds(kind, ref), previous_period(kind, ref)
    now_total, prev_total = total_for(user, current), total_for(user, previous)
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
        'improving': now_total <= prev_total,
        'period': current,
    }


def timeline(user, kind: str, ref: date | None = None):
    """Serie temporelle pour le graphique d'evolution.

    jour -> 24 h impossible a granularite date, on renvoie donc les 14 derniers
    jours ; semaine -> 7 jours ; mois -> jours du mois ; annee -> 12 mois.
    """
    ref = ref or today()
    if kind == 'year':
        year = ref.year
        rows = (
            Expense.objects.filter(user=user, date__year=year)
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
        Expense.objects.filter(user=user, date__gte=span[0], date__lte=span[-1])
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
    return created


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


def bootstrap_user(user):
    """Prepare un compte fraichement cree."""
    from .models import Profile

    Profile.objects.get_or_create(user=user)
    if not Category.objects.filter(user=user).exists():
        Category.create_defaults(user)
