"""Chemins de code specifiques a Windows, verifiables depuis n'importe quel systeme.

Les commandes reellement lancees (PowerShell, boite de dialogue) sont
interceptees : on controle ce qui serait execute, pas le resultat visuel.
"""

from __future__ import annotations

import importlib
import os
import subprocess
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from echeancier import notifications
from echeancier.analyse import analyser
from echeancier.config import Config
from echeancier.modele import Tache

AUJOURDHUI = date(2026, 3, 10)
# Un libelle piege : apostrophes, guillemets et accents ne doivent jamais
# finir dans le code PowerShell execute.
PIEGE = "Signer l'avenant \"Dupont\" ; Remove-Item C:\\"


def alertes_test(libelle: str = PIEGE):
    tache = Tache(libelle=libelle, echeance=AUJOURDHUI + timedelta(days=1), feuille="F", ligne=2)
    return analyser([tache], Config(chemin_classeur=Path("x.xlsx")), AUJOURDHUI)


class TestNotificationWindows(unittest.TestCase):
    def setUp(self):
        self.alertes = alertes_test()
        patch = mock.patch.object(notifications, "plateforme", return_value="windows")
        patch.start()
        self.addCleanup(patch.stop)

    def _notificateur(self, **extra):
        config = Config(chemin_classeur=Path("x.xlsx"), canaux=["bureau"], **extra)
        return notifications.Notificateur(config)

    def test_toast_powershell_appele(self):
        with mock.patch.object(notifications.shutil, "which", return_value="powershell.exe"), \
             mock.patch.object(notifications.subprocess, "run") as lancer:
            lancer.return_value = subprocess.CompletedProcess([], 0)
            erreurs = self._notificateur().envoyer(self.alertes, self.alertes, AUJOURDHUI)

        self.assertEqual(erreurs, [])
        commande = lancer.call_args.args[0]
        self.assertEqual(commande[0], "powershell.exe")
        self.assertIn("-NoProfile", commande)

    def test_texte_transmis_par_variables_d_environnement(self):
        """Aucun libelle de tache ne doit etre interpole dans le script."""
        with mock.patch.object(notifications.shutil, "which", return_value="powershell.exe"), \
             mock.patch.object(notifications.subprocess, "run") as lancer:
            lancer.return_value = subprocess.CompletedProcess([], 0)
            self._notificateur().envoyer(self.alertes, self.alertes, AUJOURDHUI)

        script = lancer.call_args.args[0][-1]
        environnement = lancer.call_args.kwargs["env"]
        self.assertNotIn("Remove-Item", script)
        self.assertNotIn("Dupont", script)
        self.assertIn(PIEGE, environnement[notifications.VAR_CORPS])
        self.assertTrue(environnement[notifications.VAR_TITRE])
        self.assertIn("PATH", {c.upper() for c in environnement})  # environnement herite

    def test_repli_sur_une_fenetre_si_le_toast_echoue(self):
        with mock.patch.object(notifications.shutil, "which", return_value="powershell.exe"), \
             mock.patch.object(notifications.subprocess, "run") as lancer, \
             mock.patch.object(notifications.subprocess, "Popen") as fenetre:
            lancer.return_value = subprocess.CompletedProcess([], 1)   # toast en echec
            erreurs = self._notificateur().envoyer(self.alertes, self.alertes, AUJOURDHUI)

        self.assertEqual(erreurs, [])
        fenetre.assert_called_once()
        self.assertIn("MessageBoxW", fenetre.call_args.args[0][-1])

    def test_repli_si_powershell_absent(self):
        with mock.patch.object(notifications.shutil, "which", return_value=None), \
             mock.patch.object(notifications.subprocess, "Popen") as fenetre:
            erreurs = self._notificateur().envoyer(self.alertes, self.alertes, AUJOURDHUI)
        self.assertEqual(erreurs, [])
        fenetre.assert_called_once()

    def test_style_fenetre_force(self):
        with mock.patch.object(notifications.subprocess, "run") as lancer, \
             mock.patch.object(notifications.subprocess, "Popen") as fenetre:
            self._notificateur(style_bureau="fenetre").envoyer(
                self.alertes, self.alertes, AUJOURDHUI
            )
        lancer.assert_not_called()
        fenetre.assert_called_once()

    def test_style_toast_force_signale_l_echec(self):
        with mock.patch.object(notifications.shutil, "which", return_value=None), \
             mock.patch.object(notifications.subprocess, "Popen") as fenetre:
            erreurs = self._notificateur(style_bureau="toast").envoyer(
                self.alertes, self.alertes, AUJOURDHUI
            )
        fenetre.assert_not_called()
        self.assertEqual(len(erreurs), 1)
        self.assertIn("fenetre", erreurs[0])


class TestNotificationLinux(unittest.TestCase):
    def test_notify_send_toujours_utilise(self):
        with mock.patch.object(notifications, "plateforme", return_value="linux"), \
             mock.patch.object(notifications.shutil, "which", return_value="/usr/bin/notify-send"), \
             mock.patch.object(notifications.subprocess, "run") as lancer:
            config = Config(chemin_classeur=Path("x.xlsx"), canaux=["bureau"])
            erreurs = notifications.Notificateur(config).envoyer(
                alertes_test(), alertes_test(), AUJOURDHUI
            )
        self.assertEqual(erreurs, [])
        self.assertEqual(lancer.call_args.args[0][0], "/usr/bin/notify-send")


class TestCheminsWindows(unittest.TestCase):
    """Sous Windows, l'etat et la configuration vont dans AppData."""

    def _sous_windows(self, variables: dict[str, str], fonction: str) -> str:
        with mock.patch.object(sys, "platform", "win32"), \
             mock.patch.dict(os.environ, variables, clear=False):
            module = importlib.reload(importlib.import_module("echeancier.config"))
            return str(getattr(module, fonction)())

    def tearDown(self):
        importlib.reload(importlib.import_module("echeancier.config"))

    def test_etat_dans_localappdata(self):
        base = r"C:\Users\jean\AppData\Local"
        chemin = self._sous_windows({"LOCALAPPDATA": base}, "_etat_utilisateur")
        self.assertTrue(chemin.startswith(base), chemin)
        self.assertTrue(chemin.endswith("etat.json"), chemin)
        self.assertIn("Echeancier", chemin)

    def test_config_dans_appdata(self):
        base = r"C:\Users\jean\AppData\Roaming"
        chemin = self._sous_windows({"APPDATA": base}, "_config_utilisateur")
        self.assertTrue(chemin.startswith(base), chemin)
        self.assertTrue(chemin.endswith("config.toml"), chemin)

    def test_emplacements_linux_inchanges(self):
        with mock.patch.object(sys, "platform", "linux"):
            module = importlib.reload(importlib.import_module("echeancier.config"))
            self.assertIn(".local/state/echeancier", module._etat_utilisateur().as_posix())
            self.assertIn(".config/echeancier", module._config_utilisateur().as_posix())

    def test_chemin_windows_dans_le_toml(self):
        """Un chemin ecrit en apostrophes simples (litteral TOML) reste intact."""
        import tempfile
        import tomllib

        contenu = "[classeur]\nchemin = 'C:\\Users\\jean\\Documents\\taches.xlsx'\n"
        self.assertEqual(
            tomllib.loads(contenu)["classeur"]["chemin"],
            r"C:\Users\jean\Documents\taches.xlsx",
        )
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fichier:
            fichier.write(contenu)
        from echeancier.config import charger

        config = charger(fichier.name)
        self.assertIn("taches.xlsx", str(config.chemin_classeur))
        Path(fichier.name).unlink()


if __name__ == "__main__":
    unittest.main()


class TestSortiesSansConsole(unittest.TestCase):
    """Sous pythonw.exe (tache planifiee Windows), sys.stdout vaut None."""

    def test_pas_de_plantage_sans_stdout(self):
        from echeancier.cli import _console_tolerante

        with mock.patch.object(sys, "stdout", None), mock.patch.object(sys, "stderr", None):
            _console_tolerante()
            print("ceci ne doit pas lever d'exception")
            self.assertIsNotNone(sys.stdout)
            sys.stdout.close()
            sys.stderr.close()

    def test_accents_hors_perimetre_de_la_console(self):
        """Une console cp850 ne doit pas faire echouer la verification."""
        import io

        flux = io.TextIOWrapper(io.BytesIO(), encoding="cp850", errors="strict")
        with mock.patch.object(sys, "stdout", flux):
            from echeancier.cli import _console_tolerante

            _console_tolerante()
            print("Reunion budgetaire — priorite élevée → J-3")
            flux.flush()
