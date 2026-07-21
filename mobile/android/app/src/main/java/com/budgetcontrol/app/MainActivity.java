package com.budgetcontrol.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Budget Control — coquille WebView 100 % hors ligne.
 *
 * Les fichiers de l'application (assets/www) sont servis via une origine
 * virtuelle "https://appassets.local/", interceptee localement par
 * {@link AssetWebViewClient}. Aucun socket reseau n'est ouvert : rien ne passe
 * par le reseau, meme si le telephone est connecte. L'origine https donne un
 * contexte securise (IndexedDB, crypto), sans qu'aucune permission INTERNET ne
 * soit requise.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.local";
    static final String BASE = "https://" + HOST + "/";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);     // requis par IndexedDB
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);      // tout passe par l'intercepteur, pas de file://
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);

        web.setWebViewClient(new AssetWebViewClient(this));
        setContentView(web);
        web.loadUrl(BASE + "index.html");
    }

    /** Le bouton retour navigue dans l'historique interne avant de quitter. */
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
