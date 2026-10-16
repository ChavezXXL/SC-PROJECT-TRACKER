package io.fabtrack.tv;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

/**
 * Checks about once a minute that the board is on screen, and opens it again
 * if it isn't — after the TV's system closed the app (out of memory), or sent
 * it to the home screen by itself. A person pressing Home or double-Back gets
 * two hours before the board comes back.
 */
public class Watchdog extends BroadcastReceiver {
    private static final long EVERY_MS = 60_000;
    private static final long STALE_MS = 50_000;
    private static final long USER_LEFT_MS = 2 * 60 * 60_000L;

    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, new Intent(c, Watchdog.class), flags);
        am.setRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + EVERY_MS, EVERY_MS, pi);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        SharedPreferences p = c.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long left = p.getLong("user_left_at", 0);
        if (left > 0 && now - left < USER_LEFT_MS) return;     // someone closed it on purpose
        if (now - p.getLong("alive_at", 0) < STALE_MS) return; // the board is on screen
        Log.w(MainActivity.TAG, "board not on screen — opening it again");
        p.edit().remove("user_left_at")
                .putLong("relaunches", p.getLong("relaunches", 0) + 1)
                .apply();
        open(c);
    }

    static void open(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            c.startActivity(i);
        } catch (Throwable t) {
            Log.e(MainActivity.TAG, "couldn't open the board", t);
        }
    }
}
