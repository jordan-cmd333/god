"""Selection des taches a signaler."""

from __future__ import annotations

from datetime import date

from .config import Config
from .modele import Alerte, Tache, palier_de


def analyser(taches: list[Tache], config: Config, aujourdhui: date) -> list[Alerte]:
    """Alertes du jour, de la plus urgente a la moins urgente."""
    alertes: list[Alerte] = []
    for tache in taches:
        if tache.echeance is None:
            continue
        if config.ignorer_terminees and tache.terminee:
            continue
        jours = tache.jours_restants(aujourdhui)
        assert jours is not None
        if jours < 0 and not config.inclure_retards:
            continue
        palier = palier_de(jours, config.seuils_jours)
        if palier is None:
            continue
        rang, libelle = palier
        alertes.append(Alerte(tache=tache, jours=jours, rang=rang, palier=libelle))

    alertes.sort(key=lambda a: (a.jours, a.tache.libelle.lower()))
    return alertes


def sans_echeance(taches: list[Tache]) -> list[Tache]:
    """Lignes dont la date limite est vide ou illisible : a signaler au proprietaire."""
    return [t for t in taches if t.echeance is None and not t.terminee]
