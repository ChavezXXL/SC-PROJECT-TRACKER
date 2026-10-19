package io.fabtrack.tv;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.PointerIcon;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * FabTrack TV — the shop-floor board on a Fire TV / Android TV, in its own
 * browser instead of the TV's. It keeps the screen on, and when the TV's web
 * engine crashes, runs out of memory or stops responding, it opens the board
 * again by itself within seconds. (The Silk browser on a 1 GB Fire TV quit
 * ~50 minutes into every session and stayed gone until someone came by.)
 */
public class MainActivity extends Activity {
    static final String TAG = "FabTrackTV";
    static final String VERSION = "1.2";
    static final String BOARD_URL = "https://scprojtrac.netlify.app/tv";
    static final String PREFS = "fabtrack_tv";

    private static final long BEAT_MS = 15_000;
    private static final long HUNG_MS = 45_000;
    /** The TV's web engine hoards graphics memory (410 MB after 22 h on the
     *  shop's 1.5 GB TV, which then froze). Past this, start a fresh engine. */
    private static final int GFX_LIMIT_MB = 300;
    private static final long MEM_CHECK_MS = 5 * 60_000;

    private FrameLayout root;
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resumed = false;
    private boolean pingPending = false;
    private long pingSentAt = 0;
    private long lastBackAt = 0;
    private long lastFreshAt = 0;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        prefs().edit().remove("user_left_at").apply();   // opened again → guard it again
        Watchdog.schedule(this);
        openBoard(null);
        handler.postDelayed(memCheck, MEM_CHECK_MS);
    }

    // ── The board ────────────────────────────────────────────────────────

    /** A fresh web engine with the board in it. `note` says why (null = first open). */
    @SuppressLint("SetJavaScriptEnabled")
    private void openBoard(String note) {
        if (web != null) {
            root.removeView(web);
            try { web.destroy(); } catch (Throwable ignored) { }
            web = null;
        }
        pingPending = false;
        web = new BoardView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: the TV's link to the shop
        s.setDatabaseEnabled(true);            // IndexedDB: the board's offline copy
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // The board knows it's in this app: the app keeps the screen on, so
        // the page skips its own keep-awake tricks.
        s.setUserAgentString(s.getUserAgentString() + " FabTrackTV/" + VERSION);
        web.setWebViewClient(new BoardClient());
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        hideSystemBars();
        String url = note == null ? BOARD_URL : BOARD_URL + "#app-restart=" + note;
        web.loadUrl(url);
        web.requestFocus();
        Log.i(TAG, "board opened" + (note == null ? "" : " (" + note + ")"));
    }

    /**
     * The board's web view, with the mouse pointer always hidden: the shop's
     * USB mouse jiggler kept an arrow on the wall (the TV's web engine
     * ignores the page's cursor: none).
     */
    private static class BoardView extends WebView {
        BoardView(android.content.Context c) { super(c); }

        @Override
        public PointerIcon onResolvePointerIcon(MotionEvent event, int pointerIndex) {
            if (Build.VERSION.SDK_INT >= 24) return PointerIcon.getSystemIcon(getContext(), PointerIcon.TYPE_NULL);
            return super.onResolvePointerIcon(event, pointerIndex);
        }
    }

    private class BoardClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return false;   // everything stays inside the app
        }

        @Override
        @TargetApi(23)
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) retryLater("page error " + err.getErrorCode());
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int code, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < 23) retryLater("page error " + code);
        }

        /** The web engine was killed (out of memory) or crashed: open a new one. */
        @Override
        @TargetApi(26)
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            final String why = detail.didCrash() ? "crash" : "memory";
            Log.w(TAG, "web engine stopped (" + why + ") — opening the board again");
            prefs().edit().putLong("engine_restarts", prefs().getLong("engine_restarts", 0) + 1).apply();
            handler.post(new Runnable() { public void run() { openBoard(why); } });
            return true;   // handled: the app stays up
        }
    }

    private void retryLater(String why) {
        Log.w(TAG, why + " — trying again in 15 s");
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, 15_000);
    }

    private final Runnable retry = new Runnable() {
        public void run() { if (web != null) web.loadUrl(BOARD_URL); }
    };

    // ── Heartbeat + hang check (only while the board is on screen) ──────

    private final Runnable beat = new Runnable() {
        public void run() {
            if (!resumed) return;
            prefs().edit().putLong("alive_at", System.currentTimeMillis()).apply();
            if (web != null) {
                long now = SystemClock.elapsedRealtime();
                if (pingPending && now - pingSentAt > HUNG_MS) {
                    Log.w(TAG, "board stopped responding — opening it again");
                    openBoard("hung");
                } else if (!pingPending) {
                    pingPending = true;
                    pingSentAt = now;
                    web.evaluateJavascript("1", new android.webkit.ValueCallback<String>() {
                        public void onReceiveValue(String v) { pingPending = false; }
                    });
                }
            }
            handler.postDelayed(this, BEAT_MS);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        hideSystemBars();
        if (web != null) { web.onResume(); web.resumeTimers(); }
        handler.removeCallbacks(beat);
        handler.post(beat);
    }

    @Override
    protected void onPause() {
        resumed = false;
        handler.removeCallbacks(beat);
        if (web != null) web.onPause();
        super.onPause();
    }

    /** The Home button (someone chose to leave): don't pull the board back for a while. */
    @Override
    protected void onUserLeaveHint() {
        prefs().edit().putLong("user_left_at", System.currentTimeMillis()).apply();
        super.onUserLeaveHint();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        Log.i(TAG, "memory pressure level " + level);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) { try { web.destroy(); } catch (Throwable ignored) { } web = null; }
        super.onDestroy();
    }

    // ── Memory upkeep ────────────────────────────────────────────────────

    private final Runnable memCheck = new Runnable() {
        public void run() {
            try {
                int gfx = graphicsMb();
                if (gfx > GFX_LIMIT_MB && resumed) {
                    long now = SystemClock.elapsedRealtime();
                    if (lastFreshAt > 0 && now - lastFreshAt < 60 * 60_000) {
                        // A fresh engine didn't give it back: start the app over.
                        plannedExit("app restart (memory upkeep)", new Runnable() { public void run() { restartApp(); } });
                        return;
                    }
                    lastFreshAt = now;
                    Log.w(TAG, "graphics memory " + gfx + " MB — fresh web engine");
                    plannedExit("fresh engine (memory upkeep)", new Runnable() { public void run() { openBoard("refresh"); } });
                }
            } catch (Throwable t) {
                Log.w(TAG, "memory check failed", t);
            }
            handler.postDelayed(this, MEM_CHECK_MS);
        }
    };

    /** This process's graphics memory (GPU textures etc.), in MB. */
    private static int graphicsMb() {
        if (Build.VERSION.SDK_INT < 23) return 0;
        Debug.MemoryInfo mi = new Debug.MemoryInfo();
        Debug.getMemoryInfo(mi);
        String g = mi.getMemoryStat("summary.graphics");
        return g == null ? 0 : Integer.parseInt(g) / 1024;
    }

    /** Tell the board this is planned (so its report doesn't call it a crash), then do it. */
    private void plannedExit(String why, final Runnable then) {
        if (web == null) { then.run(); return; }
        String js = "try{window.__fabtrackExitReason=" + org.json.JSONObject.quote(why)
                + ";window.dispatchEvent(new Event('pagehide'))}catch(e){}";
        web.evaluateJavascript(js, null);
        handler.postDelayed(then, 500);
    }

    /** Start the whole app over in a couple of seconds (frees memory a new engine can't). */
    private void restartApp() {
        Log.w(TAG, "restarting the app to free memory");
        try {
            Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(this, 2, i, flags);
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am != null) am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 2000, pi);
        } catch (Throwable ignored) { }
        android.os.Process.killProcess(android.os.Process.myPid());
    }

    /**
     * Mouse moves never reach the board. A USB mouse jiggler sends ~40 a
     * second; the board doesn't use them, and when the TV was short of memory
     * they piled up (72 waiting) until Android called the app frozen. The TV
     * still counts them as activity, so the jiggler keeps it awake.
     */
    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        if (ev.isFromSource(InputDevice.SOURCE_MOUSE)) {
            int a = ev.getActionMasked();
            if (a == MotionEvent.ACTION_HOVER_MOVE || a == MotionEvent.ACTION_HOVER_ENTER || a == MotionEvent.ACTION_HOVER_EXIT) return true;
        }
        return super.dispatchGenericMotionEvent(ev);
    }

    // ── Remote control ───────────────────────────────────────────────────

    /** Back never closes the board by accident: press it twice to leave. */
    @Override
    public void onBackPressed() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackAt < 2000) {
            prefs().edit().putLong("user_left_at", System.currentTimeMillis()).apply();
            finish();
            return;
        }
        lastBackAt = now;
        Toast.makeText(this, "Press Back again to close the board", Toast.LENGTH_SHORT).show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {   // ☰ on the remote: reload the board
            Toast.makeText(this, "Reloading the board…", Toast.LENGTH_SHORT).show();
            if (web != null) web.reload();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private void hideSystemBars() {
        View v = getWindow().getDecorView();
        v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }
}
