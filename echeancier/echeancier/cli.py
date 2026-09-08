"""Ligne de commande de l'echeancier."""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

from . import __version__
from .analyse import analyser, sans_echeance
from .config import MODELE_CONFIG, Config, ConfigError, charger
from .etat import Etat
from .lecture import LectureError, lire_classeur
from .notifications import Notificateur, signaler_erreurs
from .rapport import page_html

INTERVALLE_SCRUTATION = 30  # secondes entre deux verifications de la date du fichier


def _analyser_classeur(config: Config, aujourdhui: date):
    taches, diagnostic = lire_classeur(
        config.chemin_classeur, config.feuilles, config.colonnes
    )
    return taches, diagnostic, analyser(taches, config, aujourdhui)


def commande_verifier(config: Config, args: argparse.Namespace) -> int:
    aujourdhui = args.date or date.today()
    taches, _, alertes = _analyser_classeur(config, aujourdhui)

    etat = Etat(config.chemin_etat)
    if args.tout:
        nouvelles = alertes
    else:
        nouvelles = etat.a_notifier(alertes, aujourdhui, config.rappel_quotidien)

    if args.silencieux and not nouvelles:
        return 0

    notificateur = Notificateur(config)
    erreurs = notificateur.envoyer(
        nouvelles, alertes, aujourdhui, sans_echeance(taches)
    )
    signaler_erreurs(erreurs)

    if not args.essai:
        etat.enregistrer(nouvelles, aujourdhui)
        etat.oublier_absentes({t.identifiant for t in taches})
        etat.sauver()
    return 0


def commande_surveiller(config: Config, args: argparse.Namespace) -> int:
    print(
        f"Surveillance de {config.chemin_classeur} "
        f"(verification toutes les {config.intervalle_minutes} min, Ctrl+C pour arreter).",
        file=sys.stderr,
    )
    derniere_execution = 0.0
    derniere_modif = None
    dernier_jour = None
    periode = config.intervalle_minutes * 60

    while True:
        try:
            modif = config.chemin_classeur.stat().st_mtime
        except OSError:
            modif = None

        maintenant = time.time()
        jour = date.today()
        declencher = (
            maintenant - derniere_execution >= periode
            or (modif is not None and modif != derniere_modif)
            or jour != dernier_jour
        )

        if declencher:
            derniere_execution, derniere_modif, dernier_jour = maintenant, modif, jour
            try:
                commande_verifier(config, args)
            except LectureError as erreur:
                print(f"[erreur] {erreur}", file=sys.stderr)

        try:
            time.sleep(INTERVALLE_SCRUTATION)
        except KeyboardInterrupt:
            print("\nSurveillance interrompue.", file=sys.stderr)
            return 0


def commande_rapport(config: Config, args: argparse.Namespace) -> int:
    aujourdhui = args.date or date.today()
    taches, _, alertes = _analyser_classeur(config, aujourdhui)
    contenu = page_html(alertes, aujourdhui, config.titre, sans_echeance(taches))
    destination = args.sortie or config.fichier_rapport
    if destination is None:
        sys.stdout.write(contenu)
        return 0
    chemin = Path(destination).expanduser()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(contenu, encoding="utf-8")
    print(f"Rapport ecrit : {chemin}")
    return 0


def commande_colonnes(config: Config, args: argparse.Namespace) -> int:
    """Diagnostic : montre ce que l'outil a reconnu dans le classeur."""
    aujourdhui = args.date or date.today()
    taches, diagnostic, alertes = _analyser_classeur(config, aujourdhui)

    print(f"Classeur : {config.chemin_classeur}")
    for feuille, roles in diagnostic.items():
        if not roles:
            print(f"  [{feuille}] aucune colonne de date limite reconnue - ignoree.")
            continue
        detail = ", ".join(f'{role} = "{nom}"' for role, nom in roles.items())
        compte = sum(1 for t in taches if t.feuille == feuille)
        print(f"  [{feuille}] {detail} - {compte} ligne(s) lue(s).")

    orphelines = sans_echeance(taches)
    print(f"\n{len(taches)} tache(s) lue(s), {len(alertes)} a signaler aujourd'hui.")
    if orphelines:
        print(f"{len(orphelines)} ligne(s) sans date limite lisible :")
        for tache in orphelines[:10]:
            print(f"  - {tache.feuille} ligne {tache.ligne} : {tache.libelle}")
    if not diagnostic or all(not r for r in diagnostic.values()):
        print(
            "\nAucune colonne reconnue. Indiquez-les a la main dans la section "
            "[classeur.colonnes] de la configuration.",
            file=sys.stderr,
        )
        return 1
    return 0


def commande_init(args: argparse.Namespace) -> int:
    chemin = Path(args.sortie or "echeancier.toml").expanduser()
    if chemin.exists() and not args.forcer:
        print(f"{chemin} existe deja (utilisez --forcer pour l'ecraser).", file=sys.stderr)
        return 1
    chemin.write_text(MODELE_CONFIG, encoding="utf-8")
    print(f"Configuration d'exemple ecrite : {chemin}")
    print("Renseignez [classeur].chemin puis lancez : echeancier colonnes")
    return 0


def _date(valeur: str) -> date:
    return date.fromisoformat(valeur)


def construire_parseur() -> argparse.ArgumentParser:
    parseur = argparse.ArgumentParser(
        prog="echeancier",
        description="Previent avant qu'une tache d'un classeur Excel n'arrive a echeance.",
    )
    parseur.add_argument("--version", action="version", version=__version__)
    parseur.add_argument("-c", "--config", help="fichier de configuration TOML")
    parseur.add_argument("-x", "--classeur", help="classeur Excel a surveiller")
    parseur.add_argument(
        "--date", type=_date, help="simuler une autre date du jour (AAAA-MM-JJ)"
    )
    sous = parseur.add_subparsers(dest="commande")

    verifier = sous.add_parser("verifier", help="controler une fois et avertir")
    verifier.add_argument(
        "--tout", action="store_true", help="re-signaler meme ce qui a deja ete notifie"
    )
    verifier.add_argument(
        "--essai", action="store_true", help="ne rien memoriser (repetable a l'identique)"
    )
    verifier.add_argument(
        "--silencieux", action="store_true", help="ne rien afficher s'il n'y a rien de neuf"
    )

    surveiller = sous.add_parser(
        "surveiller", help="rester actif et controler en continu"
    )
    surveiller.add_argument("--tout", action="store_true", help=argparse.SUPPRESS)
    surveiller.add_argument("--essai", action="store_true", help=argparse.SUPPRESS)
    surveiller.add_argument(
        "--silencieux", action="store_true", help="n'afficher que les nouveautes"
    )

    rapport = sous.add_parser("rapport", help="produire la page HTML recapitulative")
    rapport.add_argument("-o", "--sortie", help="fichier de destination (defaut : stdout)")

    sous.add_parser("colonnes", help="verifier ce que l'outil comprend du classeur")

    init = sous.add_parser("init", help="ecrire une configuration d'exemple")
    init.add_argument("-o", "--sortie", help="chemin du fichier a creer")
    init.add_argument("--forcer", action="store_true", help="ecraser un fichier existant")

    return parseur


def _console_tolerante() -> None:
    """Rendre les sorties inoffensives quelle que soit la console.

    Sous Windows, une tache planifiee lancee par pythonw.exe n'a pas de
    console du tout : sys.stdout vaut None et le moindre print echoue. Et une
    console cp850 ne sait pas ecrire tous les accents.
    """
    for nom in ("stdout", "stderr"):
        flux = getattr(sys, nom, None)
        if flux is None:
            setattr(sys, nom, open(os.devnull, "w", encoding="utf-8"))
            continue
        try:
            flux.reconfigure(errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def main(argv: list[str] | None = None) -> int:
    _console_tolerante()
    parseur = construire_parseur()
    args = parseur.parse_args(argv)
    commande = args.commande or "verifier"

    if commande == "init":
        return commande_init(args)

    try:
        config = charger(args.config, args.classeur)
    except ConfigError as erreur:
        print(f"[erreur] {erreur}", file=sys.stderr)
        return 2

    for defaut in ("tout", "essai", "silencieux"):
        if not hasattr(args, defaut):
            setattr(args, defaut, False)
    if not hasattr(args, "sortie"):
        args.sortie = None

    actions = {
        "verifier": commande_verifier,
        "surveiller": commande_surveiller,
        "rapport": commande_rapport,
        "colonnes": commande_colonnes,
    }
    try:
        return actions[commande](config, args)
    except LectureError as erreur:
        print(f"[erreur] {erreur}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
