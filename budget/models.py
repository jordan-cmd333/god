"""Modeles de donnees de Budget Control."""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


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
    """Alerte levee lorsqu'une limite atteint le seuil ou est depassee."""

    class Level(models.TextChoices):
        WARNING = 'warning', 'Seuil atteint'
        EXCEEDED = 'exceeded', 'Limite depassee'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='alerts'
    )
    limit = models.ForeignKey(
        BudgetLimit, on_delete=models.CASCADE, related_name='alerts'
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
            )
        ]

    def __str__(self):
        return f'{self.get_level_display()} - {self.limit}'

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
