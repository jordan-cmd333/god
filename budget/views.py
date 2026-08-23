"""Vues de Budget Control. La logique de calcul vit dans services.py."""

import json
from datetime import timedelta
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.db.models import Count, ProtectedError, Q, Sum
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from . import backup, exports, services
from .forms import (
    BudgetLimitForm, CategoryForm, ExpenseFilterForm, ExpenseForm, IncomeFilterForm,
    IncomeForm, IncomeSourceForm, ProfileForm, SignUpForm,
)
from .models import (
    Alert, BudgetLimit, Category, Expense, Income, IncomeSource, Profile,
)


# --------------------------------------------------------------------------
# Authentification
# --------------------------------------------------------------------------

def signup(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    form = SignUpForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        services.bootstrap_user(user)
        login(request, user)
        messages.success(request, 'Bienvenue ! Vos categories par defaut sont pretes.')
        return redirect('dashboard')
    return render(request, 'auth/signup.html', {'form': form})


# --------------------------------------------------------------------------
# Tableau de bord
# --------------------------------------------------------------------------

@login_required
def dashboard(request):
    context = services.dashboard_context(request.user)
    context['chart_categories'] = json.dumps([
        {'label': r['name'], 'value': float(r['total']), 'color': r['color']}
        for r in context['month_breakdown']
    ])
    context['chart_timeline'] = json.dumps(context['timeline'])
    context['quick_form'] = ExpenseForm(user=request.user)
    profile = getattr(request.user, 'profile', None)
    snooze = request.session.get('backup_snooze_until')
    snoozed = bool(snooze and snooze > timezone.now().isoformat())
    context['backup_due'] = (not snoozed) and backup.is_backup_due(request.user)
    context['backup_last'] = profile.last_backup if profile else None
    return render(request, 'dashboard.html', context)


# --------------------------------------------------------------------------
# Depenses
# --------------------------------------------------------------------------

@login_required
def expense_create(request):
    form = ExpenseForm(request.POST or None, user=request.user)
    if request.method == 'POST' and form.is_valid():
        expense = form.save()
        new_alerts = services.evaluate_alerts(request.user, expense.date)
        services.refresh_reports(request.user, expense.date)
        messages.success(
            request,
            f'Depense de {expense.amount} enregistree dans « {expense.category} ».',
        )
        for alert in _most_severe(new_alerts):
            _flash_alert(request, alert)
        if 'save_and_new' in request.POST:
            return redirect('expense_create')
        return redirect('dashboard')
    return render(request, 'expense_form.html', {'form': form, 'is_edit': False})


@login_required
def expense_edit(request, pk):
    expense = get_object_or_404(Expense, pk=pk, user=request.user)
    form = ExpenseForm(request.POST or None, instance=expense, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        services.evaluate_alerts(request.user, expense.date)
        services.refresh_reports(request.user, expense.date)
        messages.success(request, 'Depense mise a jour.')
        return redirect('history')
    return render(request, 'expense_form.html',
                  {'form': form, 'is_edit': True, 'expense': expense})


@login_required
@require_POST
def expense_delete(request, pk):
    expense = get_object_or_404(Expense, pk=pk, user=request.user)
    expense_date = expense.date
    expense.delete()
    services.refresh_reports(request.user, expense_date)
    messages.success(request, 'Depense supprimee.')
    return redirect('history')


def _most_severe(alerts):
    """Un depassement cree aussi l'alerte de seuil : n'en notifier qu'une."""
    best = {}
    for alert in alerts:
        current = best.get(alert.limit_id)
        if current is None or alert.level == Alert.Level.EXCEEDED:
            best[alert.limit_id] = alert
    return list(best.values())


def _flash_alert(request, alert):
    if alert.kind == Alert.Kind.OVERSPEND:
        messages.error(
            request,
            f'Vos depenses du mois ({alert.spent}) depassent vos revenus '
            f'({alert.limit_amount}).',
        )
        return
    cible = alert.limit.category.name if alert.limit.category else 'budget global'
    periode = alert.limit.get_period_display().lower()
    if alert.level == Alert.Level.EXCEEDED:
        messages.error(
            request,
            f'Limite {periode} depassee sur {cible} : '
            f'{alert.spent} / {alert.limit_amount}.',
        )
    else:
        messages.warning(
            request,
            f'{alert.ratio:.0f} % de votre limite {periode} sur {cible} est atteint.',
        )


# --------------------------------------------------------------------------
# Historique
# --------------------------------------------------------------------------

def filtered_expenses(user, data):
    """Applique les filtres de l'historique et renvoie le queryset."""
    qs = Expense.objects.filter(user=user).select_related('category')
    if data.get('preset'):
        period = services.period_bounds(data['preset'])
        qs = qs.filter(date__gte=period.start, date__lte=period.end)
    if data.get('date_from'):
        qs = qs.filter(date__gte=data['date_from'])
    if data.get('date_to'):
        qs = qs.filter(date__lte=data['date_to'])
    if data.get('category'):
        qs = qs.filter(category=data['category'])
    if data.get('min_amount') is not None:
        qs = qs.filter(amount__gte=data['min_amount'])
    if data.get('max_amount') is not None:
        qs = qs.filter(amount__lte=data['max_amount'])
    if data.get('q'):
        term = data['q']
        qs = qs.filter(Q(description__icontains=term) | Q(note__icontains=term))
    return qs


@login_required
def history(request):
    form = ExpenseFilterForm(request.GET or None, user=request.user)
    data = form.cleaned_data if form.is_valid() else {}
    expenses = filtered_expenses(request.user, data)
    total = expenses.aggregate(t=Sum('amount'))['t'] or Decimal('0')
    return render(request, 'history.html', {
        'form': form,
        'expenses': expenses[:300],
        'total': total,
        'count': expenses.count(),
        'querystring': request.GET.urlencode(),
    })


# --------------------------------------------------------------------------
# Revenus
# --------------------------------------------------------------------------

@login_required
def income_dashboard(request):
    """Vue d'ensemble des rentrees d'argent et de leurs sources."""
    context = services.income_context(request.user)
    context['chart_sources'] = json.dumps([
        {'label': r['name'], 'value': float(r['total']), 'color': r['color']}
        for r in context['month_breakdown']
    ])
    context['chart_timeline'] = json.dumps(context['timeline'])
    return render(request, 'incomes.html', context)


@login_required
def income_create(request):
    form = IncomeForm(request.POST or None, user=request.user)
    if request.method == 'POST' and form.is_valid():
        income = form.save()
        messages.success(
            request,
            f'Revenu de {income.amount} enregistre depuis « {income.source} ».',
        )
        # Un revenu peut resoudre (ou, si edite a la baisse, creer) l'alerte
        # depenses > revenus du mois.
        services.evaluate_alerts(request.user, income.date)
        if 'save_and_new' in request.POST:
            return redirect('income_create')
        return redirect('income_dashboard')
    return render(request, 'income_form.html', {'form': form, 'is_edit': False})


@login_required
def income_edit(request, pk):
    income = get_object_or_404(Income, pk=pk, user=request.user)
    form = IncomeForm(request.POST or None, instance=income, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        services.evaluate_alerts(request.user, income.date)
        messages.success(request, 'Revenu mis a jour.')
        return redirect('income_history')
    return render(request, 'income_form.html',
                  {'form': form, 'is_edit': True, 'income': income})


@login_required
@require_POST
def income_delete(request, pk):
    income = get_object_or_404(Income, pk=pk, user=request.user)
    income_date = income.date
    income.delete()
    services.evaluate_alerts(request.user, income_date)
    messages.success(request, 'Revenu supprime.')
    return redirect('income_history')


def filtered_incomes(user, data):
    """Applique les filtres de l'historique des revenus."""
    qs = Income.objects.filter(user=user).select_related('source')
    if data.get('preset'):
        period = services.period_bounds(data['preset'])
        qs = qs.filter(date__gte=period.start, date__lte=period.end)
    if data.get('date_from'):
        qs = qs.filter(date__gte=data['date_from'])
    if data.get('date_to'):
        qs = qs.filter(date__lte=data['date_to'])
    if data.get('source'):
        qs = qs.filter(source=data['source'])
    if data.get('min_amount') is not None:
        qs = qs.filter(amount__gte=data['min_amount'])
    if data.get('max_amount') is not None:
        qs = qs.filter(amount__lte=data['max_amount'])
    if data.get('q'):
        term = data['q']
        qs = qs.filter(Q(description__icontains=term) | Q(note__icontains=term))
    return qs


@login_required
def income_history(request):
    form = IncomeFilterForm(request.GET or None, user=request.user)
    data = form.cleaned_data if form.is_valid() else {}
    incomes = filtered_incomes(request.user, data)
    total = incomes.aggregate(t=Sum('amount'))['t'] or Decimal('0')
    return render(request, 'income_history.html', {
        'form': form,
        'incomes': incomes[:300],
        'total': total,
        'count': incomes.count(),
        'querystring': request.GET.urlencode(),
    })


# --------------------------------------------------------------------------
# Sources de revenus
# --------------------------------------------------------------------------

@login_required
def source_list(request):
    sources = (
        IncomeSource.objects.filter(user=request.user)
        .annotate(income_count=Count('incomes'), earned=Sum('incomes__amount'))
    )
    return render(request, 'sources.html', {
        'sources': sources,
        'form': IncomeSourceForm(user=request.user),
    })


@login_required
@require_POST
def source_create(request):
    form = IncomeSourceForm(request.POST, user=request.user)
    if form.is_valid():
        form.save()
        messages.success(request, 'Source ajoutee.')
    else:
        messages.error(request, form.errors.as_text())
    return redirect('source_list')


@login_required
def source_edit(request, pk):
    source = get_object_or_404(IncomeSource, pk=pk, user=request.user)
    form = IncomeSourceForm(request.POST or None, instance=source, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Source mise a jour.')
        return redirect('source_list')
    return render(request, 'source_form.html', {'form': form, 'source': source})


@login_required
@require_POST
def source_delete(request, pk):
    source = get_object_or_404(IncomeSource, pk=pk, user=request.user)
    try:
        source.delete()
        messages.success(request, 'Source supprimee.')
    except ProtectedError:
        source.is_archived = True
        source.save(update_fields=['is_archived'])
        messages.warning(
            request,
            'Des revenus proviennent de cette source : elle a ete archivee au lieu '
            "d'etre supprimee, pour ne pas perdre votre historique.",
        )
    return redirect('source_list')


# --------------------------------------------------------------------------
# Categories
# --------------------------------------------------------------------------

@login_required
def category_list(request):
    categories = (
        Category.objects.filter(user=request.user)
        .annotate(expense_count=Count('expenses'), spent=Sum('expenses__amount'))
    )
    return render(request, 'categories.html', {
        'categories': categories,
        'form': CategoryForm(user=request.user),
    })


@login_required
@require_POST
def category_create(request):
    form = CategoryForm(request.POST, user=request.user)
    if form.is_valid():
        form.save()
        messages.success(request, 'Categorie ajoutee.')
    else:
        messages.error(request, form.errors.as_text())
    return redirect('category_list')


@login_required
def category_edit(request, pk):
    category = get_object_or_404(Category, pk=pk, user=request.user)
    form = CategoryForm(request.POST or None, instance=category, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Categorie mise a jour.')
        return redirect('category_list')
    return render(request, 'category_form.html', {'form': form, 'category': category})


@login_required
@require_POST
def category_delete(request, pk):
    category = get_object_or_404(Category, pk=pk, user=request.user)
    try:
        category.delete()
        messages.success(request, 'Categorie supprimee.')
    except ProtectedError:
        category.is_archived = True
        category.save(update_fields=['is_archived'])
        messages.warning(
            request,
            'Des depenses utilisent cette categorie : elle a ete archivee au lieu '
            "d'etre supprimee, pour ne pas perdre votre historique.",
        )
    return redirect('category_list')


# --------------------------------------------------------------------------
# Budgets et limites
# --------------------------------------------------------------------------

@login_required
def budget_list(request):
    form = BudgetLimitForm(request.POST or None, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        services.evaluate_alerts(request.user)
        messages.success(request, 'Limite enregistree.')
        return redirect('budget_list')
    return render(request, 'budgets.html', {
        'form': form,
        'statuses': services.all_limit_statuses(request.user, include_inactive=True),
    })


@login_required
def budget_edit(request, pk):
    limit = get_object_or_404(BudgetLimit, pk=pk, user=request.user)
    form = BudgetLimitForm(request.POST or None, instance=limit, user=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Limite mise a jour.')
        return redirect('budget_list')
    return render(request, 'budget_form.html', {'form': form, 'limit': limit})


@login_required
@require_POST
def budget_delete(request, pk):
    limit = get_object_or_404(BudgetLimit, pk=pk, user=request.user)
    limit.delete()
    messages.success(request, 'Limite supprimee.')
    return redirect('budget_list')


@login_required
@require_POST
def alerts_read(request):
    Alert.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return redirect('dashboard')


# --------------------------------------------------------------------------
# Rapports et statistiques
# --------------------------------------------------------------------------

@login_required
def reports(request):
    kind = request.GET.get('kind', 'month')
    if kind not in ('day', 'week', 'month', 'year'):
        kind = 'month'

    period = services.period_bounds(kind)
    comparison = services.compare(request.user, kind)
    breakdown = services.breakdown_by_category(request.user, period)
    report = services.build_report(request.user, kind)

    return render(request, 'reports.html', {
        'kind': kind,
        'period': period,
        'report': report,
        'comparison': comparison,
        'comparisons': [services.compare(request.user, k)
                        for k in ('day', 'week', 'month', 'year')],
        'breakdown': breakdown,
        'top': breakdown[0] if breakdown else None,
        'chart_categories': json.dumps([
            {'label': r['name'], 'value': float(r['total']), 'color': r['color']}
            for r in breakdown
        ]),
        'chart_timeline': json.dumps(services.timeline(request.user, kind)),
        'chart_compare': json.dumps([
            {'label': comparison['previous_label'],
             'value': float(comparison['previous']), 'color': '#94a3b8'},
            {'label': comparison['label'],
             'value': float(comparison['current']), 'color': '#0f766e'},
        ]),
    })


@login_required
def export_excel(request):
    form = ExpenseFilterForm(request.GET or None, user=request.user)
    data = form.cleaned_data if form.is_valid() else {}
    return exports.expenses_xlsx(request.user, filtered_expenses(request.user, data))


@login_required
def export_pdf(request):
    form = ExpenseFilterForm(request.GET or None, user=request.user)
    data = form.cleaned_data if form.is_valid() else {}
    kind = request.GET.get('kind', 'month')
    if kind not in ('day', 'week', 'month', 'year'):
        kind = 'month'
    return exports.expenses_pdf(
        request.user, filtered_expenses(request.user, data), kind
    )


# --------------------------------------------------------------------------
# Sauvegarde complete (anti-perte de donnees)
# --------------------------------------------------------------------------

@login_required
def export_backup(request):
    """Telecharge l'integralite des donnees du compte en JSON."""
    payload = backup.export_payload(request.user)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.last_backup = timezone.now()
    profile.save(update_fields=['last_backup'])
    request.session.pop('backup_snooze_until', None)
    stamp = timezone.localtime().strftime('%Y-%m-%d')
    response = JsonResponse(payload, json_dumps_params={'ensure_ascii': False, 'indent': 2})
    response['Content-Disposition'] = (
        f'attachment; filename="budget-control_sauvegarde_{request.user.username}_{stamp}.json"'
    )
    return response


@login_required
@require_POST
def import_backup(request):
    """Remplace les donnees du compte par une sauvegarde importee."""
    file = request.FILES.get('backup')
    if not file:
        messages.error(request, 'Aucun fichier fourni.')
        return redirect('settings')
    try:
        data = json.load(file)
        backup.import_payload(request.user, data)
    except Exception:
        # import_payload est transactionnel : en cas d'erreur, rien n'est modifie.
        messages.error(request, 'Fichier de sauvegarde invalide : rien n a ete modifie.')
        return redirect('settings')
    # Regenere alertes et rapports a partir des donnees restaurees.
    services.evaluate_alerts(request.user, services.today())
    services.refresh_reports(request.user, services.today())
    messages.success(request, 'Sauvegarde importee : vos donnees ont ete restaurees.')
    return redirect('dashboard')


@login_required
@require_POST
def backup_snooze(request):
    """Reporte le rappel de sauvegarde de 7 jours (pour cette session)."""
    request.session['backup_snooze_until'] = (
        timezone.now() + timedelta(days=7)
    ).isoformat()
    return redirect('dashboard')


# --------------------------------------------------------------------------
# Parametres
# --------------------------------------------------------------------------

@login_required
def settings_view(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    form = ProfileForm(request.POST or None, instance=profile)
    if request.method == 'POST' and form.is_valid():
        form.save()
        messages.success(request, 'Parametres enregistres.')
        return redirect('settings')
    return render(request, 'settings.html', {
        'form': form,
        'profile': profile,
        'last_backup': profile.last_backup,
        'stats': {
            'expenses': Expense.objects.filter(user=request.user).count(),
            'categories': Category.objects.filter(user=request.user).count(),
            'limits': BudgetLimit.objects.filter(user=request.user).count(),
            'total': Expense.objects.filter(user=request.user)
                     .aggregate(t=Sum('amount'))['t'] or Decimal('0'),
            'incomes': Income.objects.filter(user=request.user).count(),
            'sources': IncomeSource.objects.filter(user=request.user).count(),
            'earned': Income.objects.filter(user=request.user)
                      .aggregate(t=Sum('amount'))['t'] or Decimal('0'),
        },
    })


@login_required
def api_summary(request):
    """Point d'entree JSON, utile pour un futur client mobile natif."""
    kind = request.GET.get('kind', 'day')
    if kind not in ('day', 'week', 'month', 'year'):
        kind = 'day'
    comparison = services.compare(request.user, kind)
    return JsonResponse({
        'kind': kind,
        'current': str(comparison['current']),
        'previous': str(comparison['previous']),
        'variation': round(comparison['variation'], 2),
    })
