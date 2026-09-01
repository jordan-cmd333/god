package com.budgetcontrol.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.OutputStream;
import java.util.Calendar;

/**
 * Budget Control — coquille WebView 100 % hors ligne.
 *
 * Les fichiers de l'application (assets/www) sont servis via une origine
 * virtuelle "https://appassets.local/", interceptee localement par
 * {@link AssetWebViewClient}. Aucun socket reseau n'est ouvert : rien ne passe
 * par le reseau, meme si le telephone est connecte. L'origine https donne un
 * contexte securise (IndexedDB, crypto), sans qu'aucune permission INTERNET ne
 * soit requise. Un {@link AppChromeClient} active les dialogues et le selecteur
 * de fichier ; un {@link AndroidBridge} permet d'enregistrer et d'imprimer.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.local";
    static final String BASE = "https://" + HOST + "/";

    private static final int REQ_IMPORT = 10;
    private static final int REQ_SAVE = 20;
    private static final int REQ_NOTIF = 30;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingText;
    private String pendingMime;
    private String pendingName;

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
        web.setWebChromeClient(new AppChromeClient(this));
        web.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
        setContentView(web);
        web.loadUrl(BASE + "index.html" + routeFromIntent(getIntent()));
    }

    /**
     * Raccourci « ecran d'accueil » sur une activite deja ouverte (singleTop) :
     * on route la WebView vers le formulaire sans recharger l'application.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String route = routeFromIntent(intent);
        if (web != null && !route.isEmpty()) {
            web.evaluateJavascript("location.hash='" + route + "';", null);
        }
    }

    /**
     * Traduit l'URI d'un raccourci (budgetcontrol://expense/new) en hash de
     * route (#/expense/new). Retourne "" pour un lancement normal.
     */
    private String routeFromIntent(Intent intent) {
        if (intent == null) return "";
        Uri data = intent.getData();
        if (data == null || !"budgetcontrol".equals(data.getScheme())) return "";
        String host = data.getHost();
        if (host == null) return "";
        String path = data.getPath();
        return "#/" + host + (path != null ? path : "");
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

    // --- Ponts appeles depuis AppChromeClient / AndroidBridge ---------------

    /** Ouvre le selecteur de fichier pour l'import de sauvegarde. */
    boolean launchImport(ValueCallback<Uri[]> callback, Intent intent) {
        fileCallback = callback;
        try {
            startActivityForResult(intent, REQ_IMPORT);
            return true;
        } catch (Exception e) {
            fileCallback = null;
            return false;
        }
    }

    /** Enregistre un texte via le selecteur systeme (Storage Access Framework). */
    void requestSave(String filename, String mime, String text) {
        pendingName = filename;
        pendingMime = (mime != null ? mime : "text/plain");
        pendingText = text;
        // Appele depuis un thread du pont JS : repasser sur le thread UI.
        runOnUiThread(new UiTask(this, UiTask.SAVE));
    }

    /** Lance l'impression / export PDF de la page courante. */
    void requestPrint() {
        runOnUiThread(new UiTask(this, UiTask.PRINT));
    }

    // --- Rappels quotidiens (notifications) ---------------------------------
    //
    // Ni lambda ni classe anonyme (d8 8.2.2 y trebuche, cf. UiTask). Le travail
    // AlarmManager / SharedPreferences est thread-safe, donc appele directement ;
    // seule la demande de permission passe par le thread UI via UiTask.

    /** Cree le canal de notification et demande l'autorisation (Android 13+). */
    void requestNotificationPermission() {
        ensureChannel();
        runOnUiThread(new UiTask(this, UiTask.NOTIF));
    }

    /** Execute la demande de permission sur le thread UI (appele par UiTask). */
    void doRequestNotif() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                   != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
        }
    }

    /** Planifie un rappel quotidien (inexact, sans permission d'alarme exacte). */
    void scheduleDailyReminder(int hour, int minute, String title, String body) {
        getSharedPreferences("reminders", MODE_PRIVATE).edit()
                .putString("title", title).putString("body", body).apply();
        ensureChannel();
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) {
            c.add(Calendar.DAY_OF_YEAR, 1);
        }
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(),
                AlarmManager.INTERVAL_DAY, reminderIntent());
    }

    /** Annule le rappel quotidien. */
    void cancelReminder() {
        ((AlarmManager) getSystemService(ALARM_SERVICE)).cancel(reminderIntent());
    }

    private PendingIntent reminderIntent() {
        Intent i = new Intent(this, ReminderReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, 0, i, flags);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(
                    new NotificationChannel("reminders", "Rappels",
                            NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    /** Ouvre le selecteur d'enregistrement (execute sur le thread UI). */
    void doLaunchSave() {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(pendingMime);
        i.putExtra(Intent.EXTRA_TITLE, pendingName);
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (Exception e) {
            pendingText = null;
        }
    }

    /** Lance l'impression (execute sur le thread UI). */
    void doPrint() {
        try {
            PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter("Budget Control");
            pm.print("Budget Control", adapter, new PrintAttributes.Builder().build());
        } catch (Exception e) {
            // Impression indisponible sur cet appareil : sans effet.
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingText != null) {
                try {
                    OutputStream os = getContentResolver().openOutputStream(data.getData());
                    if (os != null) {
                        os.write(pendingText.getBytes("UTF-8"));
                        os.close();
                    }
                } catch (Exception e) {
                    // Echec d'ecriture : sans effet.
                }
            }
            pendingText = null;
        }
    }
}
