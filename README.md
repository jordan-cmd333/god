# Budget Control

Application mobile-first de gestion de finances personnelles : dépenses et
revenus, limites budgétaires avec alertes, solde, résumés automatiques par
jour / semaine / mois / année, rapports et exports PDF et Excel.

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
| `/revenus/` | Vue d'ensemble des rentrées : sources, évolution, solde |
| `/revenus/ajouter/` | Ajout rapide d'un revenu |
| `/revenus/historique/` | Historique des revenus, mêmes filtres |
| `/revenus/sources/` | Sources de revenus personnalisables |
| `/categories/` | Catégories de dépenses personnalisables |
| `/budgets/` | Limites journalières, hebdomadaires, mensuelles, annuelles |
| `/rapports/` | Statistiques, graphiques et exports |
| `/parametres/` | Devise, seuil d'alerte, configuration, export global |

La barre de navigation donne accès aux cinq écrans quotidiens (Accueil,
Historique, ajout, Revenus, Budgets). Catégories et sources sont des réglages :
on les atteint depuis Paramètres.

## Modèle de données

`Profile` · `Category` · `Expense` · `IncomeSource` · `Income` ·
`BudgetLimit` · `Alert` · `Report`

Chaque dépense est rattachée à une catégorie, chaque revenu à une source. Une
catégorie ou une source encore utilisée est archivée plutôt que supprimée, afin
de préserver l'historique.

Revenus et dépenses partagent les mêmes fonctions d'agrégation, paramétrées par
modèle : une période se calcule une seule fois, pour les deux.

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
- Pour un revenu, une hausse est une amélioration ; pour une dépense, c'est
  l'inverse — les flèches et les couleurs suivent cette logique.
- Le solde d'une période vaut revenus − dépenses. Au-delà de 80 % des revenus
  dépensés la barre passe à l'orange, au-delà de 100 % au rouge.
- Un revenu récurrent encaissé plusieurs fois n'apparaît qu'une fois dans la
  liste des flux, à sa date la plus récente.

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

54 tests couvrant les bornes de périodes, les agrégations (dépenses et
revenus), les comparaisons, le déclenchement et la déduplication des alertes,
le calcul du solde, la génération des rapports, l'isolation des données entre
comptes, les filtres et les exports.
