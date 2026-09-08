"""Memoire des alertes deja emises, pour ne pas repeter le meme avertissement."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .modele import Alerte


class Etat:
    """Retient, par tache, le palier le plus urgent deja notifie et sa date.

    Une tache n'est re-signalee que lorsqu'elle franchit un palier plus urgent
    (J-7 puis J-3 puis J-1 puis retard), ou chaque jour si `rappel_quotidien`.
    Si l'echeance du classeur change, l'historique de la tache est remis a zero.
    """

    def __init__(self, chemin: Path) -> None:
        self.chemin = chemin
        self.donnees: dict[str, dict] = {}
        if chemin.is_file():
            try:
                self.donnees = json.loads(chemin.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self.donnees = {}

    def a_notifier(
        self, alertes: list[Alerte], aujourdhui: date, rappel_quotidien: bool = False
    ) -> list[Alerte]:
        retenues: list[Alerte] = []
        for alerte in alertes:
            precedent = self.donnees.get(alerte.tache.identifiant)
            echeance = alerte.tache.echeance.isoformat() if alerte.tache.echeance else ""
            if precedent is None or precedent.get("echeance") != echeance:
                retenues.append(alerte)
                continue
            if alerte.rang > int(precedent.get("rang", 0)):
                retenues.append(alerte)
            elif rappel_quotidien and precedent.get("date") != aujourdhui.isoformat():
                retenues.append(alerte)
        return retenues

    def enregistrer(self, alertes: list[Alerte], aujourdhui: date) -> None:
        for alerte in alertes:
            self.donnees[alerte.tache.identifiant] = {
                "libelle": alerte.tache.libelle,
                "echeance": alerte.tache.echeance.isoformat() if alerte.tache.echeance else "",
                "rang": alerte.rang,
                "palier": alerte.palier,
                "date": aujourdhui.isoformat(),
            }

    def oublier_absentes(self, identifiants: set[str]) -> None:
        """Purge les taches disparues du classeur (supprimees ou terminees)."""
        for cle in list(self.donnees):
            if cle not in identifiants:
                del self.donnees[cle]

    def sauver(self) -> None:
        self.chemin.parent.mkdir(parents=True, exist_ok=True)
        temporaire = self.chemin.with_suffix(self.chemin.suffix + ".tmp")
        temporaire.write_text(
            json.dumps(self.donnees, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporaire.replace(self.chemin)
