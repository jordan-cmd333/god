"""Chargement de la configuration (TOML) et valeurs par defaut."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

# Cherchee dans le dossier courant, puis a cote de l'outil (pratique pour cron
# et systemd, qui demarrent avec un repertoire courant quelconque), puis dans
# la configuration utilisateur.
RACINE_OUTIL = Path(__file__).resolve().parent.parent

CHEMINS_CONFIG = [
    Path("echeancier.toml"),
    RACINE_OUTIL / "echeancier.toml",
    Path.home() / ".config" / "echeancier" / "config.toml",
]

ETAT_PAR_DEFAUT = Path.home() / ".local" / "state" / "echeancier" / "etat.json"


class ConfigError(Exception):
    pass


@dataclass
class ConfigEmail:
    serveur_smtp: str = ""
    port: int = 587
    utilisateur: str = ""
    mot_de_passe: str = ""
    expediteur: str = ""
    destinataires: list[str] = field(default_factory=list)
    tls: bool = True

    @property
    def utilisable(self) -> bool:
        return bool(self.serveur_smtp and self.destinataires)


@dataclass
class Config:
    chemin_classeur: Path
    feuilles: list[str] = field(default_factory=list)
    colonnes: dict[str, str] = field(default_factory=dict)
    seuils_jours: list[int] = field(default_factory=lambda: [7, 3, 1])
    inclure_retards: bool = True
    rappel_quotidien: bool = False
    ignorer_terminees: bool = True
    canaux: list[str] = field(default_factory=lambda: ["console", "bureau"])
    email: ConfigEmail = field(default_factory=ConfigEmail)
    fichier_rapport: Path | None = None
    intervalle_minutes: int = 60
    chemin_etat: Path = ETAT_PAR_DEFAUT
    titre: str = "Echeances"


def _chemin(valeur: str) -> Path:
    return Path(os.path.expandvars(str(valeur))).expanduser()


def trouver_config(explicite: str | None = None) -> Path | None:
    if explicite:
        chemin = _chemin(explicite)
        if not chemin.is_file():
            raise ConfigError(f"Fichier de configuration introuvable : {chemin}")
        return chemin
    for candidat in CHEMINS_CONFIG:
        if candidat.is_file():
            return candidat
    return None


def charger(explicite: str | None = None, classeur: str | None = None) -> Config:
    """Lit le fichier TOML ; `classeur` (option CLI) prend le dessus sur le fichier."""
    chemin_config = trouver_config(explicite)
    donnees: dict = {}
    if chemin_config is not None:
        with chemin_config.open("rb") as flux:
            donnees = tomllib.load(flux)

    bloc_classeur = donnees.get("classeur", {})
    brut_chemin = classeur or bloc_classeur.get("chemin")
    if not brut_chemin:
        raise ConfigError(
            "Aucun classeur indique. Renseignez [classeur].chemin dans la "
            "configuration, ou passez --classeur chemin.xlsx."
        )

    alertes = donnees.get("alertes", {})
    notifs = donnees.get("notifications", {})
    bloc_email = notifs.get("email", {})
    surveillance = donnees.get("surveillance", {})
    etat = donnees.get("etat", {})

    seuils = [int(s) for s in alertes.get("seuils_jours", [7, 3, 1]) if int(s) > 0]
    if not seuils:
        raise ConfigError("[alertes].seuils_jours doit contenir au moins un entier > 0.")

    rapport = notifs.get("fichier_rapport")

    return Config(
        chemin_classeur=_chemin(brut_chemin),
        feuilles=[str(f) for f in bloc_classeur.get("feuilles", [])],
        colonnes={str(k): str(v) for k, v in bloc_classeur.get("colonnes", {}).items()},
        seuils_jours=sorted(set(seuils), reverse=True),
        inclure_retards=bool(alertes.get("inclure_retards", True)),
        rappel_quotidien=bool(alertes.get("rappel_quotidien", False)),
        ignorer_terminees=bool(alertes.get("ignorer_terminees", True)),
        canaux=[str(c) for c in notifs.get("canaux", ["console", "bureau"])],
        email=ConfigEmail(
            serveur_smtp=str(bloc_email.get("serveur_smtp", "")),
            port=int(bloc_email.get("port", 587)),
            utilisateur=str(bloc_email.get("utilisateur", "")),
            mot_de_passe=str(
                os.environ.get("ECHEANCIER_SMTP_MDP", bloc_email.get("mot_de_passe", ""))
            ),
            expediteur=str(bloc_email.get("expediteur", "")),
            destinataires=[str(d) for d in bloc_email.get("destinataires", [])],
            tls=bool(bloc_email.get("tls", True)),
        ),
        fichier_rapport=_chemin(rapport) if rapport else None,
        intervalle_minutes=max(1, int(surveillance.get("intervalle_minutes", 60))),
        chemin_etat=_chemin(etat.get("chemin", str(ETAT_PAR_DEFAUT))),
        titre=str(donnees.get("titre", "Echeances")),
    )


MODELE_CONFIG = '''# Configuration de l'echeancier. Placez ce fichier a cote du script
# (echeancier.toml) ou dans ~/.config/echeancier/config.toml.
titre = "Echeances du service"

[classeur]
chemin = "~/Documents/taches.xlsx"
# feuilles = ["Suivi 2026"]      # vide ou absent = toutes les feuilles
# Forcer les colonnes si la detection automatique se trompe :
# [classeur.colonnes]
# tache = "Intitule"
# echeance = "Date limite"
# statut = "Avancement"
# responsable = "Pilote"

[alertes]
seuils_jours = [7, 3, 1]       # prevenir a J-7, J-3 puis J-1
inclure_retards = true         # signaler aussi ce qui est deja depasse
ignorer_terminees = true       # ne rien dire des lignes marquees "termine"
rappel_quotidien = false       # true = re-alerter chaque jour, pas seulement au changement de palier

[notifications]
canaux = ["console", "bureau"]   # au choix : console, bureau, email, fichier
# fichier_rapport = "~/echeances.html"

[notifications.email]
serveur_smtp = ""
port = 587
utilisateur = ""
mot_de_passe = ""              # de preference via la variable ECHEANCIER_SMTP_MDP
expediteur = ""
destinataires = []

[surveillance]
intervalle_minutes = 60

[etat]
chemin = "~/.local/state/echeancier/etat.json"
'''
