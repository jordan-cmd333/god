"""Formulaires : inscription, depense rapide, categorie, limite, filtres."""

from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .models import BudgetLimit, Category, Expense, Profile

# Le navigateur poste toujours en ISO ; on tolere aussi la saisie francaise.
ISO_AND_FR = ['%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y']


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
        if qs.exists():
            raise forms.ValidationError(
                'Une limite existe deja pour cette periode et cette categorie.'
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


class ExpenseFilterForm(forms.Form):
    """Filtres de l'historique : date, categorie, montant, periode."""

    PRESETS = [
        ('', 'Toutes les periodes'),
        ('day', "Aujourd'hui"),
        ('week', 'Cette semaine'),
        ('month', 'Ce mois-ci'),
        ('year', 'Cette annee'),
    ]

    preset = forms.ChoiceField(choices=PRESETS, required=False, label='Periode')
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
