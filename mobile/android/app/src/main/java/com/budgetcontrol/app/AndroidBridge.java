package com.budgetcontrol.app;

import android.webkit.JavascriptInterface;

/**
 * Pont JavaScript -> Android pour les fonctions qu'une WebView ne sait pas faire
 * seule : enregistrer un fichier (export CSV / sauvegarde JSON) et imprimer.
 *
 * Exposé sous le nom "AndroidBridge". Sans danger : seul le code local et de
 * confiance de assets/www s'execute (aucun contenu distant, tout reseau bloque).
 */
class AndroidBridge {

    private final MainActivity activity;

    AndroidBridge(MainActivity activity) {
        this.activity = activity;
    }

    /** Enregistre un contenu texte via le selecteur systeme (aucune permission). */
    @JavascriptInterface
    public void saveText(String filename, String mime, String text) {
        activity.requestSave(filename, mime, text);
    }

    /** Lance l'impression / export PDF de la page via le service systeme. */
    @JavascriptInterface
    public void printPage() {
        activity.requestPrint();
    }
}
