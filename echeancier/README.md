# Echeancier

Surveille un classeur Excel de suivi de tâches et **prévient la personne qui le
tient avant que les dates limites n'arrivent** : notification sur le bureau,
e-mail, page HTML récapitulative ou simple sortie console.

Le classeur n'est jamais modifié : l'outil se contente de le lire.

- Aucune saisie à refaire : les colonnes sont reconnues automatiquement
  (`Tâche`, `Date limite`, `Statut`, `Responsable`…), même si l'en-tête n'est
  pas en première ligne et même sur plusieurs feuilles.
- Alerte par paliers : J-7, puis J-3, puis J-1, puis le jour même, puis retard.
- Pas de harcèlement : chaque tâche n'est signalée **qu'une fois par palier
  franchi**. Si l'échéance est repoussée dans le classeur, le compteur repart.
- Les lignes marquées `Terminé`, `Fait`, `OK`, `Clôturé`… sont ignorées.

## Installation

```bash
cd echeancier
python3 -m venv ../venv          # déjà présent si vous utilisez Budget Control
../venv/bin/pip install -r requirements.txt
```

Seule dépendance : `openpyxl`. Python 3.11 ou plus récent.

## Prise en main

```bash
./echeancier.sh init                    # crée echeancier.toml
```

Renseignez `[classeur].chemin`, puis vérifiez que l'outil comprend bien votre
fichier :

```bash
./echeancier.sh colonnes
```

```
Classeur : /home/…/taches.xlsx
  [Suivi des tâches] identifiant = « Ref », tache = « Tâche »,
      echeance = « Date limite », statut = « Statut » — 10 ligne(s) lue(s).

10 tâche(s) lue(s), 6 à signaler aujourd'hui.
```

Puis lancez une vérification :

```bash
./echeancier.sh verifier
```

Pour essayer sans classeur sous la main :

```bash
../venv/bin/python outils/creer_classeur_exemple.py exemple-taches.xlsx
./echeancier.sh -x exemple-taches.xlsx verifier
```

## Commandes

| Commande | Rôle |
|---|---|
| `verifier` | Contrôle une fois et avertit (commande par défaut) |
| `surveiller` | Reste actif ; recontrôle à chaque enregistrement du classeur |
| `rapport -o page.html` | Écrit la page HTML récapitulative |
| `colonnes` | Diagnostic : ce que l'outil a reconnu dans le classeur |
| `init` | Écrit une configuration d'exemple |

Options utiles : `-x/--classeur` (classeur ponctuel), `-c/--config`,
`--date 2026-03-12` (simuler un autre jour), `--tout` (re-signaler ce qui
l'a déjà été), `--essai` (ne rien mémoriser), `--silencieux` (se taire s'il
n'y a rien de neuf — à privilégier pour les tâches planifiées).

## Configuration

Cherchée dans `./echeancier.toml`, puis `~/.config/echeancier/config.toml`.
Modèle complet dans [config.exemple.toml](config.exemple.toml).

```toml
[classeur]
chemin = "~/Documents/taches.xlsx"
# feuilles = ["Suivi 2026"]        # vide = toutes les feuilles

[alertes]
seuils_jours = [7, 3, 1]           # les paliers d'avertissement
inclure_retards = true
rappel_quotidien = false           # true = re-alerter chaque jour

[notifications]
canaux = ["console", "bureau"]     # console, bureau, email, fichier
fichier_rapport = "~/echeances.html"
```

### Si les colonnes ne sont pas reconnues

`colonnes` le dit clairement. Il suffit alors de les nommer à la main :

```toml
[classeur.colonnes]
tache = "Intitulé de l'action"
echeance = "Butoir"
statut = "Avancement"
responsable = "Pilote"
```

### E-mail

```toml
[notifications]
canaux = ["email"]

[notifications.email]
serveur_smtp = "smtp.example.com"
port = 587
utilisateur = "alerte@example.com"
expediteur = "alerte@example.com"
destinataires = ["responsable@example.com"]
```

Le mot de passe se met de préférence dans la variable d'environnement
`ECHEANCIER_SMTP_MDP` plutôt que dans le fichier. Avec Gmail, il faut un
« mot de passe d'application », pas le mot de passe du compte.

## Vérification automatique

Timer systemd utilisateur, sans droits administrateur :

```bash
./planification/installer.sh
```

Par défaut : du lundi au vendredi à 8 h 30, plus 2 minutes après l'ouverture de
session ; `Persistent=true` rattrape l'exécution si la machine était éteinte.
Modifiez l'horaire dans [planification/echeancier.timer](planification/echeancier.timer).

Variante cron :

```bash
crontab -e
# 30 8 * * 1-5 /home/dick/App/echeancier/echeancier.sh verifier --silencieux
```

Variante « en continu », utile pendant qu'on travaille dans le classeur :

```bash
./echeancier.sh surveiller
```

## Fonctionnement

```
classeur .xlsx ──▶ lecture.py ──▶ analyse.py ──▶ etat.py ──▶ notifications.py
  (openpyxl)      colonnes et      paliers      déjà vu ?     bureau · e-mail
                  dates lues      d'urgence                  console · HTML
```

| Fichier | Rôle |
|---|---|
| `echeancier/lecture.py` | Repérage de l'en-tête, des colonnes, conversion des dates |
| `echeancier/analyse.py` | Sélection des tâches à signaler |
| `echeancier/modele.py` | Tâche, alerte, calcul des paliers |
| `echeancier/etat.py` | Mémoire des alertes déjà émises (`~/.local/state/echeancier/etat.json`) |
| `echeancier/notifications.py` | Canaux console / bureau / e-mail / fichier |
| `echeancier/rapport.py` | Rendus texte et HTML |
| `echeancier/cli.py` | Ligne de commande |

Formats de dates acceptés : cellules date d'Excel, séries numériques, et texte
au format `12/03/2026`, `2026-03-12`, `12-03-2026`, `12.03.2026`, `12 mars 2026`.

## Tests

```bash
../venv/bin/python -m unittest discover -s tests
```

## Limites connues

- Lit `.xlsx` / `.xlsm`. Un vieux `.xls` doit être réenregistré au format
  `.xlsx` depuis Excel ou LibreOffice.
- Les formules sont lues à leur **dernière valeur calculée** enregistrée par
  Excel : une échéance calculée par formule n'est à jour qu'après un
  enregistrement du classeur.
- Un classeur ouvert en écriture sous Windows peut être verrouillé ; l'outil
  le signale et réessaiera à la vérification suivante.
