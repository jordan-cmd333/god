# Echeancier

Surveille un classeur Excel de suivi de tâches et **prévient la personne qui le
tient avant que les dates limites n'arrivent** : bulle de notification,
e-mail, page HTML récapitulative ou simple sortie console.

Prévu pour **Windows** (poste cible), fonctionne également sous Linux et macOS.
Le classeur n'est jamais modifié : l'outil se contente de le lire.

- Aucune saisie à refaire : les colonnes sont reconnues automatiquement
  (`Tâche`, `Date limite`, `Statut`, `Responsable`…), même si l'en-tête n'est
  pas en première ligne et même sur plusieurs feuilles.
- Alerte par paliers : J-7, puis J-3, puis J-1, puis le jour même, puis retard.
- Pas de harcèlement : chaque tâche n'est signalée **qu'une fois par palier
  franchi**. Si l'échéance est repoussée dans le classeur, le compteur repart.
- Les lignes marquées `Terminé`, `Fait`, `OK`, `Clôturé`… sont ignorées.

## Installation sous Windows

1. Installer **Python 3.11 ou plus récent** depuis
   [python.org](https://www.python.org/downloads/windows/), en cochant
   **« Add python.exe to PATH »** pendant l'installation.
2. Copier le dossier `echeancier\` sur le poste (par exemple dans
   `C:\Outils\echeancier`).
3. Ouvrir l'invite de commandes dans ce dossier et taper :

```bat
py -m venv venv
venv\Scripts\pip install -r requirements.txt
```

Seule dépendance : `openpyxl`. Toutes les commandes se lancent ensuite avec
`echeancier.cmd`, qui trouve tout seul l'environnement installé.

<details>
<summary>Installation sous Linux / macOS</summary>

```bash
cd echeancier
python3 -m venv venv && venv/bin/pip install -r requirements.txt
```

Les commandes se lancent avec `./echeancier.sh` au lieu de `echeancier.cmd`.
La notification de bureau passe par `notify-send` (paquet `libnotify-bin`)
sous Linux et par le Centre de notifications sous macOS.
</details>

## Prise en main

```bat
echeancier.cmd init
```

Ouvrir le `echeancier.toml` créé et renseigner le chemin du classeur.
**Attention aux antislashs** : entourez le chemin d'apostrophes simples.

```toml
[classeur]
chemin = 'C:\Users\prenom\Documents\taches.xlsx'
# Un classeur synchronisé OneDrive fonctionne aussi, via son chemin local :
# chemin = 'C:\Users\prenom\OneDrive - Societe\Suivi\taches.xlsx'
```

Vérifier ensuite que l'outil comprend bien le fichier :

```bat
echeancier.cmd colonnes
```

```
Classeur : C:\Users\prenom\Documents\taches.xlsx
  [Suivi des tâches] identifiant = "Ref", tache = "Tâche",
      echeance = "Date limite", statut = "Statut" - 10 ligne(s) lue(s).

10 tâche(s) lue(s), 6 à signaler aujourd'hui.
```

Puis lancer une vérification :

```bat
echeancier.cmd verifier
```

Pour essayer sans classeur sous la main :

```bat
venv\Scripts\python outils\creer_classeur_exemple.py exemple-taches.xlsx
echeancier.cmd -x exemple-taches.xlsx verifier
```

## Vérification automatique (Windows)

Installe une tâche dans le **Planificateur de tâches**, sans droits
administrateur :

```bat
powershell -ExecutionPolicy Bypass -File planification\installer.ps1
```

Tous les jours à 8 h 30 et 2 minutes après l'ouverture de session ;
`-Heure 09:00` change l'horaire. La tâche s'exécute avec `pythonw.exe`
(aucune fenêtre noire ne clignote) et **dans la session ouverte**, condition
nécessaire à l'affichage des bulles de notification.

```powershell
Start-ScheduledTask   -TaskName Echeancier      # essai immédiat
Get-ScheduledTaskInfo -TaskName Echeancier      # dernier résultat
Unregister-ScheduledTask -TaskName Echeancier -Confirm:$false
```

Variante « en continu », utile pendant qu'on travaille dans le classeur : elle
recontrôle à chaque enregistrement du fichier.

```bat
echeancier.cmd surveiller
```

<details>
<summary>Vérification automatique sous Linux</summary>

Timer systemd utilisateur : `./planification/installer.sh`
(lun-ven 8 h 30, rattrapage si la machine était éteinte).
Variante cron : `30 8 * * 1-5 /chemin/echeancier/echeancier.sh verifier --silencieux`
</details>

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

Cherchée dans `echeancier.toml` (dossier courant, puis dossier de l'outil),
puis `%APPDATA%\Echeancier\config.toml` sous Windows —
`~/.config/echeancier/config.toml` sous Linux.
Modèle complet dans [config.exemple.toml](config.exemple.toml).

```toml
[classeur]
chemin = 'C:\Users\prenom\Documents\taches.xlsx'
# feuilles = ["Suivi 2026"]        # vide = toutes les feuilles

[alertes]
seuils_jours = [7, 3, 1]           # les paliers d'avertissement
inclure_retards = true
rappel_quotidien = false           # true = re-alerter chaque jour

[notifications]
canaux = ["console", "bureau"]     # console, bureau, email, fichier
style_bureau = "auto"              # auto | toast | fenetre
fichier_rapport = 'C:\Users\prenom\Desktop\echeances.html'
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

### Bulle de notification Windows

Par défaut (`style_bureau = "auto"`), l'outil affiche une bulle toast
Windows 10/11 ; si les toasts sont indisponibles (notifications désactivées,
Windows 8, session sans interface moderne), il bascule automatiquement sur une
fenêtre d'alerte classique. `"toast"` ou `"fenetre"` forcent l'un ou l'autre.

Le texte des tâches est transmis au script d'affichage par variables
d'environnement : un libellé contenant apostrophes, guillemets ou point-virgule
ne peut pas être interprété comme du code.

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
`ECHEANCIER_SMTP_MDP` plutôt que dans le fichier. Avec Gmail ou Microsoft 365,
il faut un « mot de passe d'application », pas le mot de passe du compte.

## Fonctionnement

```
classeur .xlsx ──▶ lecture.py ──▶ analyse.py ──▶ etat.py ──▶ notifications.py
  (openpyxl)      colonnes et      paliers      déjà vu ?    toast Windows
                  dates lues      d'urgence                 e-mail · HTML
```

| Fichier | Rôle |
|---|---|
| `echeancier/lecture.py` | Repérage de l'en-tête, des colonnes, conversion des dates |
| `echeancier/analyse.py` | Sélection des tâches à signaler |
| `echeancier/modele.py` | Tâche, alerte, calcul des paliers |
| `echeancier/etat.py` | Mémoire des alertes déjà émises |
| `echeancier/notifications.py` | Canaux console / bureau / e-mail / fichier |
| `echeancier/rapport.py` | Rendus texte et HTML |
| `echeancier/cli.py` | Ligne de commande |

Mémoire des alertes : `%LOCALAPPDATA%\Echeancier\etat.json` sous Windows,
`~/.local/state/echeancier/etat.json` sous Linux.

Formats de dates acceptés : cellules date d'Excel, séries numériques, et texte
au format `12/03/2026`, `2026-03-12`, `12-03-2026`, `12.03.2026`, `12 mars 2026`.

## Tests

```bat
venv\Scripts\python -m unittest discover -s tests
```

36 tests : reconnaissance des colonnes et des dates, calcul des paliers,
non-répétition des alertes, rendus texte et HTML, et les chemins de code
propres à Windows (bulle toast, repli en fenêtre, dossiers `AppData`,
absence de console sous `pythonw.exe`).

## Limites connues

- Lit `.xlsx` / `.xlsm`. Un vieux `.xls` doit être réenregistré au format
  `.xlsx` depuis Excel.
- Les formules sont lues à leur **dernière valeur calculée** enregistrée par
  Excel : une échéance calculée par formule n'est à jour qu'après un
  enregistrement du classeur.
- Si le classeur est en cours d'enregistrement au moment du contrôle, la
  lecture est retentée trois fois avant d'abandonner jusqu'au contrôle suivant.
- Les bulles de notification n'apparaissent que si une session Windows est
  ouverte. Pour être prévenu sans être devant le poste, ajoutez le canal
  `email`.
