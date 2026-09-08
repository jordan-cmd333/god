"""Tests : python3 -m unittest discover -s tests (depuis le dossier echeancier/)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from echeancier.analyse import analyser, sans_echeance
from echeancier.config import Config
from echeancier.etat import Etat
from echeancier.lecture import convertir_date, lire_classeur, reperer_entete
from echeancier.modele import Tache, palier_de
from echeancier.rapport import page_html, texte_console

AUJOURDHUI = date(2026, 3, 10)


def config_test(**extra) -> Config:
    base = dict(chemin_classeur=Path("/inexistant.xlsx"), seuils_jours=[7, 3, 1])
    base.update(extra)
    return Config(**base)


def tache(libelle="Tache", jours=0, statut="", **extra) -> Tache:
    return Tache(
        libelle=libelle,
        echeance=AUJOURDHUI + timedelta(days=jours) if jours is not None else None,
        feuille="F",
        ligne=2,
        statut=statut,
        **extra,
    )


class TestDates(unittest.TestCase):
    def test_formats_courants(self):
        attendu = date(2026, 3, 12)
        for valeur in ("12/03/2026", "2026-03-12", "12-03-2026", "12.03.2026", "12 mars 2026"):
            self.assertEqual(convertir_date(valeur), attendu, valeur)

    def test_serie_excel(self):
        self.assertEqual(convertir_date(46093), date(2026, 3, 12))

    def test_valeurs_invalides(self):
        for valeur in (None, "", "a definir", "n/a", True):
            self.assertIsNone(convertir_date(valeur), repr(valeur))


class TestEntete(unittest.TestCase):
    def test_entete_pas_en_premiere_ligne(self):
        lignes = [
            ("Suivi 2026", None, None),
            (None, None, None),
            ("Intitule", "Date limite", "Avancement"),
            ("Faire X", date(2026, 3, 12), "En cours"),
        ]
        index, roles = reperer_entete(lignes)
        self.assertEqual(index, 2)
        self.assertEqual(roles["tache"], 0)
        self.assertEqual(roles["echeance"], 1)
        self.assertEqual(roles["statut"], 2)

    def test_colonnes_forcees(self):
        lignes = [("Quoi", "Quand", "Ou"), ("Faire X", date(2026, 3, 12), "Paris")]
        index, roles = reperer_entete(lignes, {"tache": "Quoi", "echeance": "Quand"})
        self.assertEqual((index, roles["tache"], roles["echeance"]), (0, 0, 1))

    def test_sans_colonne_de_date(self):
        lignes = [("Nom", "Ville"), ("Dupont", "Lyon")]
        self.assertIsNone(reperer_entete(lignes))

    def test_libelle_de_secours_si_pas_de_colonne_tache(self):
        lignes = [("Client", "Date limite"), ("Dupont", date(2026, 3, 12))]
        index, roles = reperer_entete(lignes)
        self.assertEqual(roles["tache"], 0)


class TestPaliers(unittest.TestCase):
    def test_ordre_des_rangs(self):
        seuils = [7, 3, 1]
        rangs = [palier_de(j, seuils)[0] for j in (7, 3, 1, 0, -2)]
        self.assertEqual(rangs, sorted(rangs), "l'urgence doit croitre")

    def test_hors_seuil(self):
        self.assertIsNone(palier_de(8, [7, 3, 1]))

    def test_libelles(self):
        self.assertEqual(palier_de(-1, [7])[1], "retard")
        self.assertEqual(palier_de(0, [7])[1], "aujourd'hui")
        self.assertEqual(palier_de(5, [7, 3])[1], "J-7")
        self.assertEqual(palier_de(2, [7, 3])[1], "J-3")


class TestAnalyse(unittest.TestCase):
    def test_selection(self):
        taches = [
            tache("Retard", -2),
            tache("Aujourd'hui", 0),
            tache("Proche", 3),
            tache("Lointaine", 40),
            tache("Terminee", 1, statut="Termine"),
            tache("Sans date", None),
        ]
        alertes = analyser(taches, config_test(), AUJOURDHUI)
        self.assertEqual([a.tache.libelle for a in alertes], ["Retard", "Aujourd'hui", "Proche"])

    def test_retards_exclus_sur_demande(self):
        alertes = analyser([tache("Retard", -2)], config_test(inclure_retards=False), AUJOURDHUI)
        self.assertEqual(alertes, [])

    def test_terminees_gardees_sur_demande(self):
        alertes = analyser(
            [tache("Faite", 1, statut="Fait")], config_test(ignorer_terminees=False), AUJOURDHUI
        )
        self.assertEqual(len(alertes), 1)

    def test_statuts_termines_varies(self):
        for statut in ("Terminé", "TERMINEE", "fait", "OK", "x", "Clôturé", "Done"):
            alertes = analyser([tache("T", 1, statut=statut)], config_test(), AUJOURDHUI)
            self.assertEqual(alertes, [], statut)

    def test_lignes_sans_date(self):
        orphelines = sans_echeance([tache("Sans date", None), tache("Datee", 1)])
        self.assertEqual([t.libelle for t in orphelines], ["Sans date"])


class TestEtat(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.TemporaryDirectory()
        self.chemin = Path(self.dossier.name) / "etat.json"

    def tearDown(self):
        self.dossier.cleanup()

    def _alertes(self, jours):
        return analyser([tache("Rapport", jours)], config_test(), AUJOURDHUI)

    def test_pas_de_repetition_au_meme_palier(self):
        etat = Etat(self.chemin)
        alertes = self._alertes(5)
        self.assertEqual(len(etat.a_notifier(alertes, AUJOURDHUI)), 1)
        etat.enregistrer(alertes, AUJOURDHUI)
        etat.sauver()
        self.assertEqual(Etat(self.chemin).a_notifier(alertes, AUJOURDHUI), [])

    def test_nouvelle_alerte_au_palier_suivant(self):
        etat = Etat(self.chemin)
        etat.enregistrer(self._alertes(5), AUJOURDHUI)
        self.assertEqual(len(etat.a_notifier(self._alertes(2), AUJOURDHUI)), 1)

    def test_rappel_quotidien(self):
        etat = Etat(self.chemin)
        alertes = self._alertes(5)
        etat.enregistrer(alertes, AUJOURDHUI)
        self.assertEqual(etat.a_notifier(alertes, AUJOURDHUI, True), [])
        demain = AUJOURDHUI + timedelta(days=1)
        self.assertEqual(len(etat.a_notifier(alertes, demain, True)), 1)

    def test_echeance_repoussee_reinitialise(self):
        etat = Etat(self.chemin)
        etat.enregistrer(self._alertes(1), AUJOURDHUI)
        repoussee = analyser([tache("Rapport", 5)], config_test(), AUJOURDHUI)
        self.assertEqual(len(etat.a_notifier(repoussee, AUJOURDHUI)), 1)

    def test_purge_des_taches_disparues(self):
        etat = Etat(self.chemin)
        etat.enregistrer(self._alertes(1), AUJOURDHUI)
        etat.oublier_absentes(set())
        self.assertEqual(etat.donnees, {})


class TestClasseurComplet(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "outils"))
        from creer_classeur_exemple import creer

        self.dossier = tempfile.TemporaryDirectory()
        self.classeur = Path(self.dossier.name) / "taches.xlsx"
        creer(self.classeur)

    def tearDown(self):
        self.dossier.cleanup()

    def test_lecture_et_alertes(self):
        taches, diagnostic = lire_classeur(self.classeur)
        self.assertEqual(len(taches), 10)
        self.assertEqual(diagnostic["Suivi des taches"]["echeance"], "Date limite")

        alertes = analyser(taches, config_test(), date.today())
        libelles = [a.tache.libelle for a in alertes]
        self.assertIn("Rendre le rapport trimestriel", libelles)   # retard
        self.assertIn("Valider le budget formation", libelles)     # aujourd'hui
        self.assertNotIn("Archiver les dossiers 2025", libelles)   # J+30
        self.assertNotIn("Declaration sociale annuelle", libelles) # terminee

    def test_rendus(self):
        taches, _ = lire_classeur(self.classeur)
        alertes = analyser(taches, config_test(), date.today())
        self.assertIn("EN RETARD", texte_console(alertes, date.today(), "Titre"))
        html = page_html(alertes, date.today(), "Titre")
        self.assertIn("<table>", html)
        self.assertIn("Rendre le rapport trimestriel", html)

    def test_echappement_html(self):
        page = page_html(
            analyser([tache("<script>alert(1)</script>", 1)], config_test(), AUJOURDHUI),
            AUJOURDHUI,
            "T",
        )
        self.assertNotIn("<script>alert", page)


if __name__ == "__main__":
    unittest.main()
