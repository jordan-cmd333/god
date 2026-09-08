"""Canaux d'avertissement : console, notification de bureau, e-mail, fichier HTML.

La notification de bureau s'adapte au systeme : bulle toast sous Windows
(a defaut une fenetre d'alerte), notify-send sous Linux, Centre de
notifications sous macOS.
"""

from __future__ import annotations

import os
import shutil
import smtplib
import subprocess
import sys
from datetime import date
from email.message import EmailMessage

from .config import Config
from .modele import Alerte, Tache
from .rapport import page_html, resume_court, texte_console, titre_court


def plateforme() -> str:
    """Systeme hote : « windows », « macos » ou « linux »."""
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


# Le texte est transmis par variables d'environnement : aucun libelle de tache
# (apostrophes, guillemets, accents...) ne se retrouve dans le code execute.
VAR_TITRE = "ECHEANCIER_NOTIF_TITRE"
VAR_CORPS = "ECHEANCIER_NOTIF_CORPS"

# Identifiant d'application connu de Windows, sans quoi la bulle n'apparait pas.
AUMID_POWERSHELL = (
    r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
)

SCRIPT_TOAST = r"""
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] > $null
$modele = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textes = $modele.GetElementsByTagName('text')
$textes.Item(0).AppendChild($modele.CreateTextNode($env:%(titre)s)) > $null
$textes.Item(1).AppendChild($modele.CreateTextNode($env:%(corps)s)) > $null
$toast = New-Object Windows.UI.Notifications.ToastNotification $modele
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('%(aumid)s').Show($toast)
""" % {"titre": VAR_TITRE, "corps": VAR_CORPS, "aumid": AUMID_POWERSHELL}

# Repli si les toasts sont indisponibles (Windows 8, notifications desactivees,
# session sans interface moderne) : une simple boite de dialogue Windows.
SCRIPT_FENETRE = (
    "import ctypes, os; "
    "ctypes.windll.user32.MessageBoxW(0, "
    f"os.environ['{VAR_CORPS}'], os.environ['{VAR_TITRE}'], 0x40040)"
)


def _environnement(titre: str, corps: str) -> dict[str, str]:
    return {**os.environ, VAR_TITRE: titre, VAR_CORPS: corps}


def _sans_fenetre_console() -> dict:
    """Empeche l'ouverture d'une console noire sous Windows."""
    try:
        infos = subprocess.STARTUPINFO()
        infos.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        return {"startupinfo": infos, "creationflags": subprocess.CREATE_NO_WINDOW}
    except AttributeError:      # ailleurs que sous Windows
        return {}


class Notificateur:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.erreurs: list[str] = []

    def envoyer(
        self,
        alertes: list[Alerte],
        toutes: list[Alerte],
        aujourdhui: date,
        sans_date: list[Tache] | None = None,
    ) -> list[str]:
        """`alertes` = les nouveautes a signaler, `toutes` = l'etat complet du jour.

        Les canaux « pousses » (bureau, e-mail) ne parlent que des nouveautes ;
        la console et le rapport HTML montrent la situation complete.
        """
        self.erreurs = []
        canaux = {c.strip().lower() for c in self.config.canaux}

        if "console" in canaux:
            print(texte_console(toutes, aujourdhui, self.config.titre))

        if "fichier" in canaux or self.config.fichier_rapport:
            self._fichier(toutes, aujourdhui, sans_date)

        if alertes:
            if "bureau" in canaux:
                self._bureau(alertes)
            if "email" in canaux:
                self._email(alertes, aujourdhui, sans_date)

        return self.erreurs

    # -- notification de bureau --------------------------------------------

    def _bureau(self, alertes: list[Alerte]) -> None:
        titre = titre_court(alertes, self.config.titre)
        corps = resume_court(alertes)
        urgent = any(a.en_retard or a.jours == 0 for a in alertes)

        systeme = plateforme()
        if systeme == "windows":
            self._bureau_windows(titre, corps)
        elif systeme == "macos":
            self._bureau_macos(titre, corps)
        else:
            self._bureau_linux(titre, corps, urgent)

    def _bureau_windows(self, titre: str, corps: str) -> None:
        style = self.config.style_bureau
        if style != "fenetre" and self._toast_windows(titre, corps):
            return
        if style == "toast":
            self.erreurs.append(
                "Bulle de notification Windows indisponible. Essayez "
                'style_bureau = "fenetre" dans la configuration.'
            )
            return
        self._fenetre_windows(titre, corps)

    def _toast_windows(self, titre: str, corps: str) -> bool:
        powershell = shutil.which("powershell") or shutil.which("powershell.exe")
        if not powershell:
            return False
        try:
            resultat = subprocess.run(
                [powershell, "-NoProfile", "-NonInteractive", "-Command", SCRIPT_TOAST],
                env=_environnement(titre, corps),
                capture_output=True,
                timeout=30,
                **_sans_fenetre_console(),
            )
        except (subprocess.SubprocessError, OSError):
            return False
        return resultat.returncode == 0

    def _fenetre_windows(self, titre: str, corps: str) -> None:
        try:
            subprocess.Popen(
                [sys.executable, "-c", SCRIPT_FENETRE],
                env=_environnement(titre, corps),
                **_sans_fenetre_console(),
            )
        except OSError as erreur:
            self.erreurs.append(f"Notification de bureau echouee : {erreur}")

    def _bureau_linux(self, titre: str, corps: str, urgent: bool) -> None:
        binaire = shutil.which("notify-send")
        if not binaire:
            self.erreurs.append(
                "Notification de bureau indisponible : notify-send introuvable "
                "(paquet libnotify-bin)."
            )
            return
        try:
            subprocess.run(
                [
                    binaire,
                    "--app-name=Echeancier",
                    f"--urgency={'critical' if urgent else 'normal'}",
                    "--icon=appointment-soon",
                    titre,
                    corps,
                ],
                check=True,
                timeout=15,
            )
        except (subprocess.SubprocessError, OSError) as erreur:
            self.erreurs.append(f"Notification de bureau echouee : {erreur}")

    def _bureau_macos(self, titre: str, corps: str) -> None:
        binaire = shutil.which("osascript")
        if not binaire:
            self.erreurs.append("Notification de bureau indisponible : osascript introuvable.")
            return
        script = (
            f'display notification (system attribute "{VAR_CORPS}") '
            f'with title (system attribute "{VAR_TITRE}")'
        )
        try:
            subprocess.run(
                [binaire, "-e", script],
                env=_environnement(titre, corps),
                check=True,
                timeout=15,
            )
        except (subprocess.SubprocessError, OSError) as erreur:
            self.erreurs.append(f"Notification de bureau echouee : {erreur}")

    # -- autres canaux ------------------------------------------------------

    def _fichier(
        self, alertes: list[Alerte], aujourdhui: date, sans_date: list[Tache] | None
    ) -> None:
        chemin = self.config.fichier_rapport
        if chemin is None:
            self.erreurs.append(
                "Canal « fichier » demande sans [notifications].fichier_rapport."
            )
            return
        try:
            chemin.parent.mkdir(parents=True, exist_ok=True)
            chemin.write_text(
                page_html(alertes, aujourdhui, self.config.titre, sans_date),
                encoding="utf-8",
            )
        except OSError as erreur:
            self.erreurs.append(f"Ecriture du rapport impossible : {erreur}")

    def _email(
        self, alertes: list[Alerte], aujourdhui: date, sans_date: list[Tache] | None
    ) -> None:
        reglages = self.config.email
        if not reglages.utilisable:
            self.erreurs.append(
                "Canal « email » demande sans serveur SMTP ni destinataire "
                "(section [notifications.email])."
            )
            return

        message = EmailMessage()
        message["Subject"] = titre_court(alertes, self.config.titre)
        message["From"] = reglages.expediteur or reglages.utilisateur
        message["To"] = ", ".join(reglages.destinataires)
        message.set_content(texte_console(alertes, aujourdhui, self.config.titre))
        message.add_alternative(
            page_html(alertes, aujourdhui, self.config.titre, sans_date), subtype="html"
        )

        try:
            with smtplib.SMTP(reglages.serveur_smtp, reglages.port, timeout=30) as serveur:
                if reglages.tls:
                    serveur.starttls()
                if reglages.utilisateur:
                    serveur.login(reglages.utilisateur, reglages.mot_de_passe)
                serveur.send_message(message)
        except (smtplib.SMTPException, OSError) as erreur:
            self.erreurs.append(f"Envoi de l'e-mail echoue : {erreur}")


def signaler_erreurs(erreurs: list[str]) -> None:
    for erreur in erreurs:
        print(f"[avertissement] {erreur}", file=sys.stderr)
