"""Canaux d'avertissement : console, notification de bureau, e-mail, fichier HTML."""

from __future__ import annotations

import shutil
import smtplib
import subprocess
import sys
from datetime import date
from email.message import EmailMessage

from .config import Config
from .modele import Alerte, Tache
from .rapport import page_html, resume_court, texte_console, titre_court


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

    # -- canaux -------------------------------------------------------------

    def _bureau(self, alertes: list[Alerte]) -> None:
        binaire = shutil.which("notify-send")
        if not binaire:
            self.erreurs.append(
                "Notification de bureau indisponible : notify-send introuvable "
                "(paquet libnotify-bin)."
            )
            return
        urgence = "critical" if any(a.en_retard or a.jours == 0 for a in alertes) else "normal"
        try:
            subprocess.run(
                [
                    binaire,
                    "--app-name=Echeancier",
                    f"--urgency={urgence}",
                    "--icon=appointment-soon",
                    titre_court(alertes, self.config.titre),
                    resume_court(alertes),
                ],
                check=True,
                timeout=15,
            )
        except (subprocess.SubprocessError, OSError) as erreur:
            self.erreurs.append(f"Notification de bureau echouee : {erreur}")

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
