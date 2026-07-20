# Budget Control

Application mobile-first de gestion de dépenses personnelles : saisie rapide,
limites budgétaires avec alertes, résumés automatiques par jour / semaine /
mois / année, rapports et exports PDF et Excel.

Django 6 · SQLite · aucune dépendance JavaScript externe (graphiques dessinés
en canvas natif).

## Démarrage

```bash
python3 -m venv venv
./venv/bin/pip install django openpyxl reportlab
./venv/bin/python manage.py migrate
./venv/bin/python manage.py runserver
```

L'application est disponible sur http://localhost:8000.

### Compte de démonstration

```bash
./venv/bin/python manage.py seed_demo    # demo / demo12345
```

Génère 90 jours de dépenses réalistes, six limites budgétaires et les alertes
correspondantes, pour voir toutes les pages remplies.

## Pages

| URL | Rôle |
|---|---|
| `/connexion/`, `/inscription/` | Authentification |
| `/` | Tableau de bord : KPI du jour, limites, répartition, évolution, comparaisons |
| `/depenses/ajouter/` | Ajout rapide d'une dépense |
| `/historique/` | Historique filtrable (date, catégorie, montant, période, texte) |
| `/categories/` | Catégories personnalisables |
| `/budgets/` | Limites journalières, hebdomadaires, mensuelles, annuelles |
| `/rapports/` | Statistiques, graphiques et exports |
| `/parametres/` | Devise, seuil d'alerte, export global, déconnexion |

## Modèle de données

`Profile` · `Category` · `Expense` · `BudgetLimit` · `Alert` · `Report`

Chaque dépense est rattachée à une catégorie. Une catégorie encore utilisée est
archivée plutôt que supprimée, afin de préserver l'historique.

## Règles de gestion

Toute la logique de calcul est regroupée dans [`budget/services.py`](budget/services.py)
pour que le tableau de bord, les rapports et les exports affichent exactement
les mêmes chiffres.

- Les dépenses sont additionnées automatiquement selon la période concernée
  (semaine du lundi au dimanche).
- Chaque limite est comparée aux dépenses réelles de sa période.
- Une alerte `warning` est levée au seuil configuré (80 % par défaut, réglable
  dans les paramètres), une alerte `exceeded` au dépassement. Une contrainte
  d'unicité `(limite, niveau, début de période)` empêche les doublons.
- Un dépassement enregistre les deux niveaux — trace complète en base — mais
  l'interface n'affiche que le plus sévère.
- Les rapports sont générés et rafraîchis selon la date des dépenses.
- Une comparaison sans période de référence n'affiche pas de pourcentage.

## Sécurité

- Mots de passe hachés par Django, validateurs de robustesse actifs.
- Toutes les vues exigent une connexion ; chaque requête est filtrée sur
  l'utilisateur courant (isolation vérifiée par les tests).
- Cookies `HttpOnly` et `SameSite=Lax`, protection CSRF sur tous les
  formulaires, `X-Frame-Options: DENY`, `nosniff`.
- En production (`DJANGO_DEBUG=0`) : cookies `Secure`, redirection HTTPS et
  HSTS activés automatiquement.

Variables d'environnement : `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`,
`DJANGO_ALLOWED_HOSTS`, `DJANGO_TIME_ZONE`, `BUDGET_CURRENCY`.

## Tests

```bash
./venv/bin/python manage.py test budget
```

32 tests couvrant les bornes de périodes, les agrégations, les comparaisons, le
déclenchement et la déduplication des alertes, la génération des rapports,
l'isolation des données entre comptes, les filtres et les deux exports.
