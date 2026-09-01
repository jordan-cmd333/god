package com.budgetcontrol.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

/**
 * Recoit l'alarme quotidienne (planifiee par MainActivity via AlarmManager) et
 * poste la notification de rappel. Le texte est lu depuis les preferences, mis a
 * jour par l'application a chaque ouverture. Toucher la notification ouvre la
 * vue « A venir ».
 */
public class ReminderReceiver extends BroadcastReceiver {

    static final String CHANNEL = "reminders";
    static final int NOTIF_ID = 1;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String title = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)
                .getString("title", "Budget Control");
        String body = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)
                .getString("body", "");
        if (body.isEmpty()) return; // rien a rappeler

        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setData(Uri.parse("budgetcontrol://upcoming")); // ouvre la vue « A venir »
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, piFlags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                    new NotificationChannel(CHANNEL, "Rappels", NotificationManager.IMPORTANCE_DEFAULT));
            b = new Notification.Builder(ctx, CHANNEL);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(Notification.PRIORITY_DEFAULT);
        }
        b.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi);
        nm.notify(NOTIF_ID, b.build());
    }
}
