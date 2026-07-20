"""Reactive les limites desactivees par un defaut du formulaire.

La page Budgets ne rendait pas la case « active » : Django interprete une case
absente comme decochee, donc toute limite creee depuis cette page etait
enregistree inactive — invisible partout, mais toujours prise en compte par le
controle d'unicite. Aucune interface ne permettant alors de desactiver
volontairement une limite, toutes les limites inactives sont des artefacts de
ce defaut et peuvent etre reactivees sans risque.
"""

from django.db import migrations


def reactiver(apps, schema_editor):
    BudgetLimit = apps.get_model('budget', 'BudgetLimit')
    BudgetLimit.objects.filter(is_active=False).update(is_active=True)


class Migration(migrations.Migration):

    dependencies = [('budget', '0001_initial')]

    # Irreversible a dessein : on ne sait pas distinguer les limites reactivees
    # ici de celles que l'utilisateur desactivera volontairement par la suite.
    operations = [migrations.RunPython(reactiver, migrations.RunPython.noop)]
