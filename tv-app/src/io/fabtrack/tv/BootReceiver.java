package io.fabtrack.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The TV turned on (or restarted): put the board up and start the watchdog. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        c.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
                .edit().remove("user_left_at").apply();
        Watchdog.schedule(c);
        Watchdog.open(c);
    }
}
