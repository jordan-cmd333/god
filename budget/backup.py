"""Sauvegarde complete des donnees d'un utilisateur (export / import JSON).

Protege contre la perte de donnees : l'utilisateur peut telecharger l'integralite
de son compte (preferences, categories, sources, depenses, revenus, limites) dans
un fichier JSON, puis le reimporter — sur ce serveur ou apres une panne.

Tout est strictement limite a `user` : l'export ne lit que ses donnees, l'import
ne remplace que les siennes. Alertes et rapports ne sont pas sauvegardes : ils sont
regeneres a partir des donnees par le service (services.evaluate_alerts / refresh_reports).
"""

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import (
    Alert, BudgetLimit, Category, Expense, Income, IncomeSource, Profile,
    RecurringTransaction, Report, SavingsGoal,
)

FORMAT_VERSION = 1
MIN_RECORDS_BEFORE_REMINDER = 5   # pas de rappel tant qu'il y a peu a perdre
MAX_AGE_DAYS = 14                 # au-dela, on re-propose si de nouvelles donnees existent


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

def export_payload(user):
    """Serialise toutes les donnees de `user` en structure JSON-compatible."""
    profile = getattr(user, 'profile', None)
    return {
        'version': FORMAT_VERSION,
        'app': 'budget-control',
        'exportedAt': timezone.now().isoformat(),
        'meta': {
            'currency': profile.currency if profile else 'FCFA',
            'alert_threshold': profile.alert_threshold if profile else 80,
        },
        'categories': [
            {'id': c.id, 'name': c.name, 'color': c.color,
             'icon': c.icon, 'is_archived': c.is_archived}
            for c in Category.objects.filter(user=user).order_by('id')
        ],
        'sources': [
            {'id': s.id, 'name': s.name, 'color': s.color,
             'icon': s.icon, 'is_archived': s.is_archived}
            for s in IncomeSource.objects.filter(user=user).order_by('id')
        ],
        'expenses': [
            {'amount': str(e.amount), 'category_id': e.category_id,
             'description': e.description, 'date': e.date.isoformat(),
             'payment_method': e.payment_method, 'note': e.note,
             'goal_id': e.goal_id}
            for e in Expense.objects.filter(user=user).order_by('id')
        ],
        'incomes': [
            {'amount': str(i.amount), 'source_id': i.source_id,
             'description': i.description, 'date': i.date.isoformat(),
             'method': i.method, 'is_recurring': i.is_recurring, 'note': i.note}
            for i in Income.objects.filter(user=user).order_by('id')
        ],
        'limits': [
            {'period': l.period, 'category_id': l.category_id,
             'amount': str(l.amount), 'is_active': l.is_active}
            for l in BudgetLimit.objects.filter(user=user).order_by('id')
        ],
        'recurrences': [
            {'kind': r.kind, 'amount': str(r.amount),
             'category_id': r.category_id, 'source_id': r.source_id,
             'method': r.method, 'description': r.description, 'note': r.note,
             'frequency': r.frequency, 'start_date': r.start_date.isoformat(),
             'end_date': r.end_date.isoformat() if r.end_date else None,
             'next_due': r.next_due.isoformat(), 'is_active': r.is_active,
             'last_run': r.last_run.isoformat() if r.last_run else None}
            for r in RecurringTransaction.objects.filter(user=user).order_by('id')
        ],
        'goals': [
            {'id': g.id, 'name': g.name, 'target_amount': str(g.target_amount),
             'deadline': g.deadline.isoformat() if g.deadline else None,
             'color': g.color, 'icon': g.icon, 'is_archived': g.is_archived}
            for g in SavingsGoal.objects.filter(user=user).order_by('id')
        ],
    }


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------

@transaction.atomic
def import_payload(user, data):
    """Remplace toutes les donnees de `user` par celles du fichier.

    Transactionnel : un fichier invalide n'altere rien (rollback complet).
    Ne touche pas au compte utilisateur ni au mot de passe.
    """
    if not isinstance(data, dict) or 'categories' not in data or 'expenses' not in data:
        raise ValueError('Fichier de sauvegarde non reconnu.')

    # Suppression dans un ordre respectant les FK PROTECT (depenses/revenus avant
    # leurs categories/sources) ; alertes et rapports d'abord (references).
    Alert.objects.filter(user=user).delete()
    Report.objects.filter(user=user).delete()
    Expense.objects.filter(user=user).delete()
    Income.objects.filter(user=user).delete()
    BudgetLimit.objects.filter(user=user).delete()
    RecurringTransaction.objects.filter(user=user).delete()  # FK PROTECT -> cat/source
    SavingsGoal.objects.filter(user=user).delete()
    Category.objects.filter(user=user).delete()
    IncomeSource.objects.filter(user=user).delete()

    # Recreation + correspondance ancien id -> nouvel objet.
    cat_map = {}
    for c in data.get('categories', []):
        cat_map[c.get('id')] = Category.objects.create(
            user=user, name=c['name'], color=c.get('color', '#64748b'),
            icon=c.get('icon', 'other'), is_archived=bool(c.get('is_archived', False)),
        )
    src_map = {}
    for s in data.get('sources', []):
        src_map[s.get('id')] = IncomeSource.objects.create(
            user=user, name=s['name'], color=s.get('color', '#64748b'),
            icon=s.get('icon', 'other'), is_archived=bool(s.get('is_archived', False)),
        )

    # Objectifs avant les depenses : celles-ci peuvent y etre liees (goal_id).
    goal_map = {}
    for g in data.get('goals', []):
        goal_map[g.get('id')] = SavingsGoal.objects.create(
            user=user, name=g['name'], target_amount=Decimal(str(g['target_amount'])),
            deadline=date.fromisoformat(g['deadline']) if g.get('deadline') else None,
            color=g.get('color', '#0f766e'), icon=g.get('icon', 'saving'),
            is_archived=bool(g.get('is_archived', False)),
        )

    for e in data.get('expenses', []):
        category = cat_map.get(e.get('category_id'))
        if category is None:
            continue  # depense orpheline (categorie absente du fichier) : ignoree
        gid = e.get('goal_id')
        Expense.objects.create(
            user=user, category=category, amount=Decimal(str(e['amount'])),
            description=e.get('description', ''), date=date.fromisoformat(e['date']),
            payment_method=e.get('payment_method', 'cash'), note=e.get('note', ''),
            goal=goal_map.get(gid) if gid is not None else None,
        )

    for i in data.get('incomes', []):
        source = src_map.get(i.get('source_id'))
        if source is None:
            continue
        Income.objects.create(
            user=user, source=source, amount=Decimal(str(i['amount'])),
            description=i.get('description', ''), date=date.fromisoformat(i['date']),
            method=i.get('method', 'cash'), is_recurring=bool(i.get('is_recurring', False)),
            note=i.get('note', ''),
        )

    for l in data.get('limits', []):
        cid = l.get('category_id')
        category = cat_map.get(cid) if cid is not None else None
        BudgetLimit.objects.create(
            user=user, period=l['period'], category=category,
            amount=Decimal(str(l['amount'])), is_active=bool(l.get('is_active', True)),
        )

    for r in data.get('recurrences', []):
        cid, sid = r.get('category_id'), r.get('source_id')
        RecurringTransaction.objects.create(
            user=user, kind=r.get('kind', 'expense'), amount=Decimal(str(r['amount'])),
            category=cat_map.get(cid) if cid is not None else None,
            source=src_map.get(sid) if sid is not None else None,
            method=r.get('method', 'cash'), description=r.get('description', ''),
            note=r.get('note', ''), frequency=r.get('frequency', 'monthly'),
            start_date=date.fromisoformat(r['start_date']),
            end_date=date.fromisoformat(r['end_date']) if r.get('end_date') else None,
            next_due=date.fromisoformat(r['next_due']),
            is_active=bool(r.get('is_active', True)),
            last_run=date.fromisoformat(r['last_run']) if r.get('last_run') else None,
        )

    # Preferences + horodatage : les donnees correspondent desormais a cette
    # sauvegarde, on date le rappel en consequence.
    profile, _ = Profile.objects.get_or_create(user=user)
    meta = data.get('meta', {})
    if meta.get('currency'):
        profile.currency = meta['currency']
    if meta.get('alert_threshold') is not None:
        profile.alert_threshold = int(meta['alert_threshold'])
    profile.last_backup = parse_datetime(data.get('exportedAt') or '') or timezone.now()
    profile.save()


# --------------------------------------------------------------------------
# Rappel anti-perte
# --------------------------------------------------------------------------

def is_backup_due(user):
    """Faut-il inviter `user` a sauvegarder ? (assez de donnees, et sauvegarde
    absente ou trop ancienne avec de nouvelles ecritures depuis)."""
    expenses = Expense.objects.filter(user=user)
    incomes = Income.objects.filter(user=user)
    if expenses.count() + incomes.count() < MIN_RECORDS_BEFORE_REMINDER:
        return False
    profile = getattr(user, 'profile', None)
    last = profile.last_backup if profile else None
    if last is None:
        return True
    if (timezone.now() - last).days < MAX_AGE_DAYS:
        return False
    return (expenses.filter(updated_at__gt=last).exists()
            or incomes.filter(updated_at__gt=last).exists())
