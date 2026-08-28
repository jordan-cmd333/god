"""Modeles de donnees de Budget Control."""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone
from django.utils.functional import cached_property


class Profile(models.Model):
    """Preferences utilisateur (page Parametres)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile'
    )
    currency = models.CharField('devise', max_length=8, default='FCFA')
    alert_threshold = models.PositiveSmallIntegerField(
        "seuil d'alerte (%)", default=80,
        help_text="Pourcentage d'une limite a partir duquel une alerte est levee.",
    )
    last_backup = models.DateTimeField(
        'derniere sauvegarde', null=True, blank=True,
        help_text='Horodatage du dernier export complet des donnees.',
    )

    def __str__(self):
        return f'Profil de {self.user}'


class Category(models.Model):
    """Categorie de depense, personnalisable par utilisateur."""

    DEFAULTS = [
        ('Nourriture', '#f97316', 'restaurant'),
        ('Etudes', '#6366f1', 'school'),
        ('Famille', '#ec4899', 'family'),
        ('Transport', '#0ea5e9', 'transport'),
        ('Logement', '#14b8a6', 'home'),
        ('Sante', '#ef4444', 'health'),
        ('Loisirs', '#a855f7', 'leisure'),
        ('Communication', '#3b82f6', 'phone'),
        ('Factures', '#eab308', 'bill'),
        ('Epargne', '#22c55e', 'saving'),
        ('Autres', '#64748b', 'other'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='categories'
    )
    name = models.CharField('nom', max_length=60)
    color = models.CharField('couleur', max_length=7, default='#64748b')
    icon = models.CharField('icone', max_length=20, default='other')
    is_archived = models.BooleanField('archivee', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'categorie'
        verbose_name_plural = 'categories'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'name'], name='unique_category_name_per_user'
            )
        ]

    def __str__(self):
        return self.name

    @classmethod
    def create_defaults(cls, user):
        """Cree le jeu de categories par defaut a l'inscription."""
        cls.objects.bulk_create(
            [
                cls(user=user, name=name, color=color, icon=icon)
                for name, color, icon in cls.DEFAULTS
            ],
            ignore_conflicts=True,
        )


class Expense(models.Model):
    """Une depense. Toujours rattachee a une categorie."""

    class PaymentMethod(models.TextChoices):
        CASH = 'cash', 'Especes'
        CARD = 'card', 'Carte bancaire'
        MOBILE = 'mobile', 'Mobile money'
        TRANSFER = 'transfer', 'Virement'
        CHECK = 'check', 'Cheque'
        OTHER = 'other', 'Autre'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='expenses'
    )
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name='expenses',
        verbose_name='categorie',
    )
    amount = models.DecimalField(
        'montant', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    description = models.CharField('description', max_length=140, blank=True)
    date = models.DateField('date', default=timezone.localdate)
    payment_method = models.CharField(
        'mode de paiement', max_length=10,
        choices=PaymentMethod.choices, default=PaymentMethod.CASH,
    )
    note = models.TextField('note', blank=True)
    # Renseigne quand la depense est une mise de cote vers un objectif d'epargne.
    goal = models.ForeignKey(
        'SavingsGoal', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='contributions', verbose_name='objectif',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'depense'
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['user', '-date']),
            models.Index(fields=['user', 'category', '-date']),
        ]

    def __str__(self):
        return f'{self.amount} - {self.category} ({self.date})'


class IncomeSource(models.Model):
    """Source de revenu, personnalisable — pendant de Category cote entrees."""

    DEFAULTS = [
        ('Salaire', '#0f766e', 'salary'),
        ('Freelance', '#6366f1', 'freelance'),
        ('Commerce', '#f97316', 'business'),
        ('Bourse', '#3b82f6', 'scholarship'),
        ('Aide familiale', '#ec4899', 'family'),
        ('Location', '#14b8a6', 'rent'),
        ('Vente', '#eab308', 'sale'),
        ('Interets', '#22c55e', 'interest'),
        ('Cadeau', '#a855f7', 'gift'),
        ('Autres', '#64748b', 'other'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sources'
    )
    name = models.CharField('nom', max_length=60)
    color = models.CharField('couleur', max_length=7, default='#0f766e')
    icon = models.CharField('icone', max_length=20, default='other')
    is_archived = models.BooleanField('archivee', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'source de revenu'
        verbose_name_plural = 'sources de revenus'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'name'], name='unique_source_name_per_user'
            )
        ]

    def __str__(self):
        return self.name

    @classmethod
    def create_defaults(cls, user):
        cls.objects.bulk_create(
            [
                cls(user=user, name=name, color=color, icon=icon)
                for name, color, icon in cls.DEFAULTS
            ],
            ignore_conflicts=True,
        )


class Income(models.Model):
    """Une rentree d'argent. Toujours rattachee a une source."""

    class Method(models.TextChoices):
        CASH = 'cash', 'Especes'
        MOBILE = 'mobile', 'Mobile money'
        TRANSFER = 'transfer', 'Virement'
        CARD = 'card', 'Carte bancaire'
        CHECK = 'check', 'Cheque'
        OTHER = 'other', 'Autre'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='incomes'
    )
    source = models.ForeignKey(
        IncomeSource, on_delete=models.PROTECT, related_name='incomes',
        verbose_name='source',
    )
    amount = models.DecimalField(
        'montant', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    description = models.CharField('description', max_length=140, blank=True)
    date = models.DateField('date', default=timezone.localdate)
    method = models.CharField(
        'mode de reception', max_length=10,
        choices=Method.choices, default=Method.CASH,
    )
    is_recurring = models.BooleanField(
        'revenu recurrent', default=False,
        help_text='A cocher pour un revenu qui revient chaque periode (salaire, loyer...).',
    )
    note = models.TextField('note', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'revenu'
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['user', '-date']),
            models.Index(fields=['user', 'source', '-date']),
        ]

    def __str__(self):
        return f'{self.amount} - {self.source} ({self.date})'


class BudgetLimit(models.Model):
    """Limite budgetaire, globale ou ciblee sur une categorie."""

    class Period(models.TextChoices):
        DAY = 'day', 'Journaliere'
        WEEK = 'week', 'Hebdomadaire'
        MONTH = 'month', 'Mensuelle'
        YEAR = 'year', 'Annuelle'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='limits'
    )
    period = models.CharField('periode', max_length=6, choices=Period.choices)
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name='limits',
        null=True, blank=True, verbose_name='categorie',
        help_text='Laisser vide pour une limite globale, toutes categories confondues.',
    )
    amount = models.DecimalField(
        'montant', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    is_active = models.BooleanField('active', default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'limite budgetaire'
        verbose_name_plural = 'limites budgetaires'
        ordering = ['period', 'category__name']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'period', 'category'],
                name='unique_limit_per_period_and_category',
            ),
            models.UniqueConstraint(
                fields=['user', 'period'],
                condition=models.Q(category__isnull=True),
                name='unique_global_limit_per_period',
            ),
        ]

    def __str__(self):
        cible = self.category.name if self.category else 'Global'
        return f'{self.get_period_display()} - {cible} : {self.amount}'


class Alert(models.Model):
    """Alerte : limite budgetaire atteinte/depassee, ou depenses > revenus.

    `spent` et `limit_amount` gardent un sens commun aux deux types : ce qui a
    ete depense, et le plafond franchi (le montant de la limite, ou les revenus
    du mois pour une alerte de type OVERSPEND).
    """

    class Kind(models.TextChoices):
        LIMIT = 'limit', 'Limite budgetaire'
        OVERSPEND = 'overspend', 'Depenses superieures aux revenus'

    class Level(models.TextChoices):
        WARNING = 'warning', 'Seuil atteint'
        EXCEEDED = 'exceeded', 'Limite depassee'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='alerts'
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.LIMIT)
    limit = models.ForeignKey(
        BudgetLimit, on_delete=models.CASCADE, related_name='alerts',
        null=True, blank=True,  # nul pour une alerte OVERSPEND, sans limite associee
    )
    level = models.CharField(max_length=8, choices=Level.choices)
    period_start = models.DateField()
    period_end = models.DateField()
    spent = models.DecimalField(max_digits=12, decimal_places=2)
    limit_amount = models.DecimalField(max_digits=12, decimal_places=2)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'alerte'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['limit', 'level', 'period_start'],
                name='unique_alert_per_limit_period_level',
            ),
            # Au plus une alerte « depenses > revenus » par mois.
            models.UniqueConstraint(
                fields=['user', 'period_start'],
                condition=models.Q(kind='overspend'),
                name='unique_overspend_per_month',
            ),
        ]

    def __str__(self):
        cible = self.limit if self.limit_id else self.get_kind_display()
        return f'{self.get_level_display()} - {cible}'

    @property
    def ratio(self):
        if not self.limit_amount:
            return 0
        return float(self.spent) / float(self.limit_amount) * 100


class Report(models.Model):
    """Instantane d'un resume de periode, genere automatiquement."""

    class Kind(models.TextChoices):
        DAY = 'day', 'Jour'
        WEEK = 'week', 'Semaine'
        MONTH = 'month', 'Mois'
        YEAR = 'year', 'Annee'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reports'
    )
    kind = models.CharField(max_length=6, choices=Kind.choices)
    period_start = models.DateField()
    period_end = models.DateField()
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    expense_count = models.PositiveIntegerField(default=0)
    top_category = models.CharField(max_length=60, blank=True)
    breakdown = models.JSONField(default=dict, blank=True)
    generated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'rapport'
        ordering = ['-period_start']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'kind', 'period_start'], name='unique_report_per_period'
            )
        ]

    def __str__(self):
        return f'{self.get_kind_display()} {self.period_start} : {self.total}'


class RecurringTransaction(models.Model):
    """Modele recurrent : une depense ou un revenu qui revient (loyer, salaire,
    abonnement, ecolage...). Rien n'est cree en silence : a l'echeance
    (`next_due` <= aujourd'hui), l'utilisateur confirme (ou passe)."""

    class Kind(models.TextChoices):
        EXPENSE = 'expense', 'Depense'
        INCOME = 'income', 'Revenu'

    class Frequency(models.TextChoices):
        WEEKLY = 'weekly', 'Hebdomadaire'
        MONTHLY = 'monthly', 'Mensuel'
        YEARLY = 'yearly', 'Annuel'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='recurrences'
    )
    kind = models.CharField('type', max_length=8, choices=Kind.choices)
    amount = models.DecimalField(
        'montant', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    # Une seule des deux references est renseignee selon `kind`.
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, null=True, blank=True,
        related_name='recurrences', verbose_name='categorie',
    )
    source = models.ForeignKey(
        IncomeSource, on_delete=models.PROTECT, null=True, blank=True,
        related_name='recurrences', verbose_name='source',
    )
    method = models.CharField(
        'mode', max_length=10,
        choices=Expense.PaymentMethod.choices, default=Expense.PaymentMethod.CASH,
    )
    description = models.CharField('description', max_length=140, blank=True)
    note = models.TextField('note', blank=True)
    frequency = models.CharField(
        'frequence', max_length=8, choices=Frequency.choices, default=Frequency.MONTHLY,
    )
    start_date = models.DateField('premiere echeance', default=timezone.localdate)
    end_date = models.DateField('fin', null=True, blank=True)
    next_due = models.DateField('prochaine echeance')
    is_active = models.BooleanField('active', default=True)
    last_run = models.DateField('derniere execution', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'transaction recurrente'
        verbose_name_plural = 'transactions recurrentes'
        ordering = ['next_due']
        indexes = [models.Index(fields=['user', 'is_active', 'next_due'])]

    def __str__(self):
        return f'{self.get_frequency_display()} {self.amount} ({self.description or self.kind})'

    @property
    def ref(self):
        """Categorie (depense) ou source (revenu) selon le type."""
        return self.source if self.kind == self.Kind.INCOME else self.category


class SavingsGoal(models.Model):
    """Objectif d'epargne : un montant a atteindre, suivi a la main (ajout /
    retrait). Suivi autonome, sans impact sur le solde depenses/revenus."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='goals'
    )
    name = models.CharField('nom', max_length=80)
    target_amount = models.DecimalField(
        'montant cible', max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    deadline = models.DateField('echeance', null=True, blank=True)
    color = models.CharField('couleur', max_length=9, default='#0f766e')
    icon = models.CharField('icone', max_length=20, default='saving')
    is_archived = models.BooleanField('archive', default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "objectif d'epargne"
        verbose_name_plural = "objectifs d'epargne"
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} : {self.saved} / {self.target_amount}'

    @cached_property
    def saved(self):
        """Montant epargne = somme des depenses « Epargne » liees a l'objectif."""
        return self.contributions.aggregate(t=models.Sum('amount'))['t'] or Decimal('0')

    @property
    def percent(self):
        if self.target_amount and self.target_amount > 0:
            return min(100.0, float(self.saved) / float(self.target_amount) * 100)
        return 100.0 if self.saved > 0 else 0.0

    @property
    def remaining(self):
        return max(Decimal('0'), self.target_amount - self.saved)

    @property
    def reached(self):
        return self.target_amount > 0 and self.saved >= self.target_amount
