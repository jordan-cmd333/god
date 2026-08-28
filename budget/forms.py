"""Formulaires : inscription, depense rapide, categorie, limite, filtres."""

from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .models import (
    BudgetLimit, Category, Expense, Income, IncomeSource, Profile,
    RecurringTransaction, SavingsGoal,
)

# Le navigateur poste toujours en ISO ; on tolere aussi la saisie francaise.
ISO_AND_FR = ['%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y']

PERIOD_PRESETS = [
    ('', 'Toutes les periodes'),
    ('day', "Aujourd'hui"),
    ('week', 'Cette semaine'),
    ('month', 'Ce mois-ci'),
    ('year', 'Cette annee'),
]


class SignUpForm(UserCreationForm):
    email = forms.EmailField(required=False, label='Email (facultatif)')

    class Meta:
        model = User
        fields = ['username', 'email']
        labels = {'username': "Nom d'utilisateur"}


class ExpenseForm(forms.ModelForm):
    """Ajout rapide : montant + categorie suffisent, le reste est optionnel."""

    class Meta:
        model = Expense
        fields = ['amount', 'category', 'date', 'payment_method', 'description', 'note']
        widgets = {
            'amount': forms.NumberInput(
                attrs={'inputmode': 'decimal', 'step': '0.01', 'min': '0.01',
                       'placeholder': '0', 'autofocus': True, 'class': 'amount-input'}
            ),
            # <input type="date"> n'accepte que le format ISO, quelle que soit la
            # locale : sans ce format explicite le champ s'affiche vide.
            'date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
            'description': forms.TextInput(attrs={'placeholder': 'Ex : dejeuner au campus'}),
            'note': forms.Textarea(attrs={'rows': 2, 'placeholder': 'Note (facultatif)'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields['category'].queryset = Category.objects.filter(
            user=user, is_archived=False
        )
        self.fields['category'].empty_label = None
        self.fields['description'].required = False
        self.fields['date'].input_formats = ISO_AND_FR

    def save(self, commit=True):
        expense = super().save(commit=False)
        expense.user = self.user
        if commit:
            expense.save()
        return expense


class IncomeForm(forms.ModelForm):
    """Ajout rapide d'une rentree : montant + source suffisent."""

    class Meta:
        model = Income
        fields = ['amount', 'source', 'date', 'method', 'description',
                  'is_recurring', 'note']
        widgets = {
            'amount': forms.NumberInput(
                attrs={'inputmode': 'decimal', 'step': '0.01', 'min': '0.01',
                       'placeholder': '0', 'autofocus': True, 'class': 'amount-input'}
            ),
            'date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
            'description': forms.TextInput(attrs={'placeholder': 'Ex : salaire de juillet'}),
            'note': forms.Textarea(attrs={'rows': 2, 'placeholder': 'Note (facultatif)'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields['source'].queryset = IncomeSource.objects.filter(
            user=user, is_archived=False
        )
        self.fields['source'].empty_label = None
        self.fields['description'].required = False
        self.fields['date'].input_formats = ISO_AND_FR

    def save(self, commit=True):
        income = super().save(commit=False)
        income.user = self.user
        if commit:
            income.save()
        return income


class IncomeSourceForm(forms.ModelForm):
    class Meta:
        model = IncomeSource
        fields = ['name', 'color', 'icon']
        widgets = {
            'color': forms.TextInput(attrs={'type': 'color'}),
            'name': forms.TextInput(attrs={'placeholder': 'Ex : Prime annuelle'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    def clean_name(self):
        name = self.cleaned_data['name'].strip()
        qs = IncomeSource.objects.filter(user=self.user, name__iexact=name)
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError('Vous avez deja une source portant ce nom.')
        return name

    def save(self, commit=True):
        source = super().save(commit=False)
        source.user = self.user
        if commit:
            source.save()
        return source


class IncomeFilterForm(forms.Form):
    """Filtres de l'historique des revenus."""

    preset = forms.ChoiceField(choices=PERIOD_PRESETS, required=False, label='Periode')
    date_from = forms.DateField(
        required=False, label='Du', input_formats=ISO_AND_FR,
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
    )
    date_to = forms.DateField(
        required=False, label='Au', input_formats=ISO_AND_FR,
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
    )
    source = forms.ModelChoiceField(
        queryset=IncomeSource.objects.none(), required=False,
        label='Source', empty_label='Toutes',
    )
    min_amount = forms.DecimalField(required=False, label='Montant min', min_value=0)
    max_amount = forms.DecimalField(required=False, label='Montant max', min_value=0)
    q = forms.CharField(required=False, label='Recherche',
                        widget=forms.TextInput(attrs={'placeholder': 'Description, note...'}))

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['source'].queryset = IncomeSource.objects.filter(user=user)


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ['name', 'color', 'icon']
        widgets = {
            'color': forms.TextInput(attrs={'type': 'color'}),
            'name': forms.TextInput(attrs={'placeholder': 'Ex : Abonnements'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    def clean_name(self):
        name = self.cleaned_data['name'].strip()
        qs = Category.objects.filter(user=self.user, name__iexact=name)
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError('Vous avez deja une categorie portant ce nom.')
        return name

    def save(self, commit=True):
        category = super().save(commit=False)
        category.user = self.user
        if commit:
            category.save()
        return category


class BudgetLimitForm(forms.ModelForm):
    class Meta:
        model = BudgetLimit
        fields = ['period', 'category', 'amount', 'is_active']
        widgets = {
            'amount': forms.NumberInput(attrs={'inputmode': 'decimal', 'step': '0.01'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields['category'].queryset = Category.objects.filter(
            user=user, is_archived=False
        )
        self.fields['category'].empty_label = 'Toutes categories (limite globale)'
        self.fields['category'].required = False

    def clean(self):
        data = super().clean()
        qs = BudgetLimit.objects.filter(
            user=self.user, period=data.get('period'), category=data.get('category')
        )
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        existante = qs.first()
        if existante is not None:
            if existante.is_active:
                raise forms.ValidationError(
                    'Une limite existe deja pour cette periode et cette categorie. '
                    'Modifiez-la plutot que d’en creer une seconde.'
                )
            raise forms.ValidationError(
                'Une limite desactivee existe deja pour cette periode et cette '
                'categorie. Elle est listee ci-dessous : reactivez-la ou modifiez-la.'
            )
        return data

    def save(self, commit=True):
        limit = super().save(commit=False)
        limit.user = self.user
        if commit:
            limit.save()
        return limit


class ProfileForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ['currency', 'alert_threshold']
        widgets = {
            'alert_threshold': forms.NumberInput(attrs={'min': 10, 'max': 100}),
        }


class SavingsGoalForm(forms.ModelForm):
    """Objectif d'epargne. A la creation, un montant deja epargne optionnel."""

    initial_saved = forms.DecimalField(
        required=False, min_value=0, label='Deja epargne (optionnel)',
        widget=forms.NumberInput(attrs={'inputmode': 'decimal', 'step': '0.01',
                                        'min': '0', 'placeholder': '0'}),
    )

    class Meta:
        model = SavingsGoal
        fields = ['name', 'target_amount', 'deadline', 'color', 'icon']
        widgets = {
            'name': forms.TextInput(attrs={'placeholder': "Ex : Fonds d'urgence"}),
            'target_amount': forms.NumberInput(
                attrs={'inputmode': 'decimal', 'step': '0.01', 'min': '0.01',
                       'placeholder': '0', 'autofocus': True, 'class': 'amount-input'}
            ),
            'deadline': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
            'color': forms.TextInput(attrs={'type': 'color'}),
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields['deadline'].required = False
        self.fields['deadline'].input_formats = ISO_AND_FR
        if self.instance.pk:                       # le montant epargne se gere
            self.fields.pop('initial_saved')       # via Ajouter / Retirer

    def save(self, commit=True):
        goal = super().save(commit=False)
        goal.user = self.user
        if not goal.pk:
            goal.saved_amount = self.cleaned_data.get('initial_saved') or 0
        if commit:
            goal.save()
        return goal


class RecurringTransactionForm(forms.ModelForm):
    """Definit une recurrence (depense ou revenu). Le type est fixe a la
    creation ; seule la reference correspondante (categorie ou source) est
    demandee."""

    class Meta:
        model = RecurringTransaction
        fields = ['amount', 'category', 'source', 'method', 'frequency',
                  'start_date', 'end_date', 'description', 'note']
        widgets = {
            'amount': forms.NumberInput(
                attrs={'inputmode': 'decimal', 'step': '0.01', 'min': '0.01',
                       'placeholder': '0', 'autofocus': True, 'class': 'amount-input'}
            ),
            'start_date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
            'end_date': forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
            'description': forms.TextInput(attrs={'placeholder': 'Ex : loyer'}),
            'note': forms.Textarea(attrs={'rows': 2, 'placeholder': 'Note (facultatif)'}),
        }

    def __init__(self, *args, user=None, kind='expense', **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.kind = self.instance.kind if self.instance.pk else kind
        if self.kind == RecurringTransaction.Kind.INCOME:
            self.fields.pop('category')
            self.fields['source'].queryset = IncomeSource.objects.filter(
                user=user, is_archived=False)
            self.fields['source'].empty_label = None
        else:
            self.fields.pop('source')
            self.fields['category'].queryset = Category.objects.filter(
                user=user, is_archived=False)
            self.fields['category'].empty_label = None
        self.fields['description'].required = False
        self.fields['end_date'].required = False
        self.fields['start_date'].input_formats = ISO_AND_FR
        self.fields['end_date'].input_formats = ISO_AND_FR

    def save(self, commit=True):
        rec = super().save(commit=False)
        rec.user = self.user
        rec.kind = self.kind
        # A la creation, la premiere echeance = date de debut ; a l'edition, on
        # ne laisse jamais l'echeance passer avant la nouvelle date de debut.
        if rec.next_due is None:
            rec.next_due = rec.start_date
        elif rec.next_due < rec.start_date:
            rec.next_due = rec.start_date
        if commit:
            rec.save()
        return rec


class ExpenseFilterForm(forms.Form):
    """Filtres de l'historique : date, categorie, montant, periode."""

    preset = forms.ChoiceField(choices=PERIOD_PRESETS, required=False, label='Periode')
    date_from = forms.DateField(
        required=False, label='Du', input_formats=ISO_AND_FR,
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
    )
    date_to = forms.DateField(
        required=False, label='Au', input_formats=ISO_AND_FR,
        widget=forms.DateInput(attrs={'type': 'date'}, format='%Y-%m-%d'),
    )
    category = forms.ModelChoiceField(
        queryset=Category.objects.none(), required=False,
        label='Categorie', empty_label='Toutes',
    )
    min_amount = forms.DecimalField(required=False, label='Montant min', min_value=0)
    max_amount = forms.DecimalField(required=False, label='Montant max', min_value=0)
    q = forms.CharField(required=False, label='Recherche',
                        widget=forms.TextInput(attrs={'placeholder': 'Description, note...'}))

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['category'].queryset = Category.objects.filter(user=user)
