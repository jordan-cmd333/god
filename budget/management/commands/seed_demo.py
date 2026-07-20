"""Cree un compte de demonstration avec 3 mois de depenses realistes."""

import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from budget.models import BudgetLimit, Category, Expense
from budget import services

PROFILS = {
    'Nourriture': (500, 4000, 0.30, ['Marche', 'Dejeuner', 'Courses', 'Petit-dejeuner']),
    'Transport': (200, 2500, 0.18, ['Taxi', 'Carburant', 'Bus', 'Zemidjan']),
    'Etudes': (1000, 15000, 0.05, ['Photocopies', 'Livre', 'Frais de scolarite']),
    'Communication': (500, 5000, 0.08, ['Credit telephone', 'Forfait internet']),
    'Sante': (1000, 20000, 0.04, ['Pharmacie', 'Consultation']),
    'Loisirs': (1000, 12000, 0.08, ['Cinema', 'Sortie', 'Abonnement']),
    'Factures': (3000, 25000, 0.06, ['Electricite', 'Eau', 'Abonnement TV']),
    'Famille': (2000, 20000, 0.07, ['Aide famille', 'Cadeau']),
    'Logement': (10000, 60000, 0.03, ['Loyer', 'Reparation']),
    'Epargne': (5000, 30000, 0.05, ['Tontine', 'Compte epargne']),
    'Autres': (500, 8000, 0.06, ['Divers']),
}


class Command(BaseCommand):
    help = 'Genere un compte de demonstration (demo / demo12345).'

    def handle(self, *args, **options):
        random.seed(7)
        user, created = User.objects.get_or_create(username='demo')
        user.set_password('demo12345')
        user.save()
        services.bootstrap_user(user)
        Expense.objects.filter(user=user).delete()

        categories = {c.name: c for c in Category.objects.filter(user=user)}
        noms = list(PROFILS)
        poids = [PROFILS[n][2] for n in noms]
        today = timezone.localdate()

        depenses = []
        for jour in range(90):
            day = today - timedelta(days=jour)
            for _ in range(random.choices([0, 1, 2, 3, 4], [1, 3, 4, 3, 1])[0]):
                nom = random.choices(noms, poids)[0]
                low, high, _, libelles = PROFILS[nom]
                depenses.append(Expense(
                    user=user,
                    category=categories[nom],
                    amount=Decimal(random.randrange(low, high, 50)),
                    description=random.choice(libelles),
                    date=day,
                    payment_method=random.choice(['cash', 'cash', 'mobile', 'card', 'transfer']),
                ))
        Expense.objects.bulk_create(depenses)

        BudgetLimit.objects.filter(user=user).delete()
        for period, amount in [('day', 8000), ('week', 45000), ('month', 180000),
                               ('year', 2000000)]:
            BudgetLimit.objects.create(user=user, period=period, amount=Decimal(amount))
        BudgetLimit.objects.create(
            user=user, period='month', category=categories['Nourriture'],
            amount=Decimal('60000'),
        )
        BudgetLimit.objects.create(
            user=user, period='month', category=categories['Loisirs'],
            amount=Decimal('20000'),
        )

        services.evaluate_alerts(user)
        services.refresh_reports(user)

        self.stdout.write(self.style.SUCCESS(
            f'Compte demo pret : {len(depenses)} depenses sur 90 jours. '
            'Identifiants : demo / demo12345'
        ))
