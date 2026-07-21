package com.budgetcontrol.app;

import android.net.Uri;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/**
 * WebChromeClient minimal. Sans lui, une WebView ignore window.confirm()/alert()
 * et n'ouvre pas le selecteur de fichier d'un <input type="file"> : l'import de
 * sauvegarde JSON en depend. Aucun acces reseau — le selecteur passe par le
 * Storage Access Framework, sans permission.
 */
class AppChromeClient extends WebChromeClient {

    private final MainActivity activity;

    AppChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onShowFileChooser(WebView webView,
                                     ValueCallback<Uri[]> filePathCallback,
                                     FileChooserParams fileChooserParams) {
        return activity.launchImport(filePathCallback, fileChooserParams.createIntent());
    }
}
