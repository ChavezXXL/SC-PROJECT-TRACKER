# FabTrack TV (Android / Fire TV app)

A small app that shows the shop-floor board (`/tv`) in its own browser on a
Fire TV or Android TV. It exists because the Fire TV's own Silk browser, on
a 1 GB TV, quit about 50 minutes into every session and stayed gone until
someone came by with the remote.

What it does:

- Opens the board full screen and keeps the screen on.
- When the TV's web engine crashes or runs out of memory, it opens the board
  again in a new engine within seconds (`onRenderProcessGone`).
- If the board hangs (the page stops answering for 45 s), it reopens it.
- A watchdog alarm checks about once a minute. If the board isn't on screen
  (the TV's system closed the app, or sent it to the home screen), it brings
  the board back.
  - If someone pressed Home, or Back twice, it waits two hours first.
- Starts when the TV turns on (`BOOT_COMPLETED`).
- Remote: ☰ reloads the board. Back twice closes it.
- The board can tell it's running in the app: the user agent includes
  `FabTrackTV/<version>`. It skips its own keep-awake tricks and reports
  `app` in the TV check-in. When the app had to reopen the board, the
  address has `#app-restart=memory|crash|hung`, and the board puts that in
  the stop report under Settings → TV Display.

## Build

```bash
python tv-app/get_tools.py   # once: JDK 17 + Android build-tools/platform/adb into tv-app/.tools
python tv-app/build.py       # → tv-app/build/fabtrack-tv.apk
cp tv-app/build/fabtrack-tv.apk public/tv.apk   # served at <site>/tv.apk
```

No Gradle: `build.py` runs aapt2, javac, d8, zipalign and apksigner directly.
The signing key lives outside the repo, in `~/.fabtrack/fabtrack-tv.keystore`.
Keep it: an installed copy can only be updated by an `.apk` signed with the
same key.

To release an update:

1. Raise `versionCode` / `versionName` in `AndroidManifest.xml`, and
   `VERSION` in `MainActivity.java`.
2. Rebuild.
3. Install it over the old one. Its saved link to the shop stays.

## Install on a TV

On the TV:

1. Install the free **Downloader** app (Amazon Appstore).
2. Settings → My Fire TV → Developer Options → Install unknown apps →
   Downloader → On. If Developer Options is missing: My Fire TV → About,
   then click the TV's name 7 times.
3. In Downloader, type `scprojtrac.netlify.app/tv.apk` → Install → Open.
4. The board shows a 6-digit code. Type it into FabTrack → Settings →
   TV Display.

From a computer on the same network, with ADB debugging turned on in the
TV's Developer Options:

```bash
tv-app/.tools/android/platform-tools/adb connect <tv-ip>
tv-app/.tools/android/platform-tools/adb install -r tv-app/build/fabtrack-tv.apk
```

`adb logcat -s FabTrackTV` shows what the app is doing.
