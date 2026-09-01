package com.budgetcontrol.app;

/**
 * Petite tache a executer sur le thread UI. Classe de premier niveau (ni lambda,
 * ni classe anonyme) : android.jar ne fournit pas LambdaMetafactory en
 * bootclasspath, et d8 8.2.2 trebuche sur certaines classes imbriquees.
 */
class UiTask implements Runnable {

    static final int SAVE = 1;
    static final int PRINT = 2;
    static final int NOTIF = 3;

    private final MainActivity activity;
    private final int what;

    UiTask(MainActivity activity, int what) {
        this.activity = activity;
        this.what = what;
    }

    @Override
    public void run() {
        if (what == SAVE) {
            activity.doLaunchSave();
        } else if (what == PRINT) {
            activity.doPrint();
        } else if (what == NOTIF) {
            activity.doRequestNotif();
        }
    }
}
