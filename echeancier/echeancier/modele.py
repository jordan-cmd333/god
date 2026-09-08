"""Objets metier : une tache lue dans le classeur et son niveau d'urgence."""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass, field
from datetime import date

# Paliers d'alerte, du moins au plus urgent. Le rang sert a ne prevenir
# qu'une fois par palier franchi (voir etat.py).
RANG_RIEN = 0
RANG_RETARD = 100
RANG_AUJOURDHUI = 90


def normaliser(texte: object) -> str:
    """Minuscules, sans accent ni ponctuation : sert a comparer les libelles."""
    if texte is None:
        return ""
    brut = unicodedata.normalize("NFKD", str(texte))
    sans_accent = "".join(c for c in brut if not unicodedata.combining(c))
    return " ".join(sans_accent.lower().replace("'", " ").replace("_", " ").split())


@dataclass
class Tache:
    libelle: str
    echeance: date | None
    feuille: str
    ligne: int
    identifiant: str = ""
    statut: str = ""
    responsable: str = ""
    priorite: str = ""
    extras: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.identifiant:
            graine = f"{self.feuille}|{normaliser(self.libelle)}"
            self.identifiant = hashlib.sha1(graine.encode("utf-8")).hexdigest()[:12]

    @property
    def terminee(self) -> bool:
        return normaliser(self.statut) in STATUTS_TERMINES

    def jours_restants(self, aujourdhui: date) -> int | None:
        if self.echeance is None:
            return None
        return (self.echeance - aujourdhui).days


STATUTS_TERMINES = {
    "termine", "terminee", "termines", "terminees",
    "fini", "finie", "fait", "faite", "faits", "faites",
    "cloture", "cloturee", "solde", "soldee", "livre", "livree",
    "ok", "oui", "x", "done", "closed", "complete", "completed", "100%",
    "annule", "annulee", "abandonne", "abandonnee", "sans objet",
}


@dataclass
class Alerte:
    """Une tache a signaler, avec le palier qui a declenche le signalement."""

    tache: Tache
    jours: int
    rang: int
    palier: str

    @property
    def en_retard(self) -> bool:
        return self.jours < 0

    def resume(self) -> str:
        if self.jours < 0:
            delai = f"en retard de {abs(self.jours)} j"
        elif self.jours == 0:
            delai = "echeance aujourd'hui"
        elif self.jours == 1:
            delai = "echeance demain"
        else:
            delai = f"dans {self.jours} jours"
        qui = f" — {self.tache.responsable}" if self.tache.responsable else ""
        return f"{self.tache.libelle} ({delai}){qui}"


def palier_de(jours: int, seuils: list[int]) -> tuple[int, str] | None:
    """Rang et libelle du palier atteint, ou None si l'echeance est lointaine."""
    if jours < 0:
        return RANG_RETARD, "retard"
    if jours == 0:
        return RANG_AUJOURDHUI, "aujourd'hui"
    tries = sorted({int(s) for s in seuils}, reverse=True)
    atteints = [s for s in tries if jours <= s]
    if not atteints:
        return None
    seuil = atteints[-1]
    # Rang croissant a mesure que le seuil se resserre, et toujours < aujourd'hui.
    return 10 + tries.index(seuil), f"J-{seuil}"
