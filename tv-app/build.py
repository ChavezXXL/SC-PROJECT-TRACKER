"""Build the FabTrack TV app (an .apk for Fire TV / Android TV) without Gradle.

    python tv-app/build.py            # → tv-app/build/fabtrack-tv.apk

Needs the tools that tv-app/get_tools.py puts in tv-app/.tools (a JDK, and the
Android build-tools + platform jar). The signing key is kept OUTSIDE the repo
(~/.fabtrack/fabtrack-tv.keystore) and made on the first build — keep it: an
installed copy can only be updated by an .apk signed with the same key.
"""
import glob, os, secrets, shutil, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, '.tools')
OUT = os.path.join(HERE, 'build')
KEY_DIR = os.path.join(os.path.expanduser('~'), '.fabtrack')
KEYSTORE = os.path.join(KEY_DIR, 'fabtrack-tv.keystore')
KEYPASS = os.path.join(KEY_DIR, 'fabtrack-tv.pass')
EXE = '.exe' if os.name == 'nt' else ''
BAT = '.bat' if os.name == 'nt' else ''


def find(pattern):
    hits = sorted(glob.glob(os.path.join(TOOLS, pattern)))
    if not hits:
        sys.exit(f'missing tool: {pattern} — run tv-app/get_tools.py first')
    return hits[-1]


def run(cmd, env=None):
    # Never echo the signing password.
    shown = ['***' if (c.startswith('pass:') or (i > 0 and cmd[i - 1] in ('-storepass', '-keypass'))) else c
             for i, c in enumerate(cmd)]
    print('>', ' '.join(os.path.basename(c) if i == 0 else c for i, c in enumerate(shown))[:160])
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        sys.exit(f'failed: {os.path.basename(cmd[0])}')
    return r.stdout


def main():
    jdk = os.path.dirname(os.path.dirname(find('jdk*/bin/javac' + EXE)))
    bt = os.path.dirname(find('android/build-tools/*/aapt2' + EXE))
    android_jar = find('android/platforms/android-*/android.jar')
    env = dict(os.environ, JAVA_HOME=jdk, PATH=os.path.join(jdk, 'bin') + os.pathsep + os.environ['PATH'])
    java_bin = lambda n: os.path.join(jdk, 'bin', n + EXE)

    shutil.rmtree(OUT, ignore_errors=True)
    for d in ('gen', 'classes', 'dex'):
        os.makedirs(os.path.join(OUT, d))

    # 1. Resources + manifest → base apk (and R.java).
    res_zip = os.path.join(OUT, 'res.zip')
    run([os.path.join(bt, 'aapt2' + EXE), 'compile', '--dir', os.path.join(HERE, 'res'), '-o', res_zip])
    base = os.path.join(OUT, 'base.apk')
    run([os.path.join(bt, 'aapt2' + EXE), 'link', '-o', base, '-I', android_jar,
         '--manifest', os.path.join(HERE, 'AndroidManifest.xml'),
         '--java', os.path.join(OUT, 'gen'), res_zip])

    # 2. Java → classes → dex.
    sources = glob.glob(os.path.join(HERE, 'src', '**', '*.java'), recursive=True)
    sources += glob.glob(os.path.join(OUT, 'gen', '**', '*.java'), recursive=True)
    run([java_bin('javac'), '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-nowarn', '-Xlint:-options',
         '-bootclasspath', android_jar, '-d', os.path.join(OUT, 'classes')] + sources, env)
    classes_jar = os.path.join(OUT, 'classes.jar')
    with zipfile.ZipFile(classes_jar, 'w') as z:
        for f in glob.glob(os.path.join(OUT, 'classes', '**', '*.class'), recursive=True):
            z.write(f, os.path.relpath(f, os.path.join(OUT, 'classes')))
    run([os.path.join(bt, 'd8' + BAT), '--release', '--min-api', '22', '--lib', android_jar,
         '--output', os.path.join(OUT, 'dex'), classes_jar], env)

    # 3. Put the dex in, align, sign.
    unaligned = os.path.join(OUT, 'unaligned.apk')
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(unaligned, 'w') as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item.filename))
        dst.write(os.path.join(OUT, 'dex', 'classes.dex'), 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)
    aligned = os.path.join(OUT, 'aligned.apk')
    run([os.path.join(bt, 'zipalign' + EXE), '-p', '-f', '4', unaligned, aligned])

    os.makedirs(KEY_DIR, exist_ok=True)
    if not os.path.exists(KEYSTORE):
        pw = secrets.token_urlsafe(18)
        with open(KEYPASS, 'w') as f:
            f.write(pw)
        run([java_bin('keytool'), '-genkeypair', '-keystore', KEYSTORE, '-alias', 'fabtrack', '-keyalg', 'RSA',
             '-keysize', '2048', '-validity', '36500', '-storepass', pw, '-keypass', pw,
             '-dname', 'CN=FabTrack TV, O=FabTrack IO'], env)
        print('made a new signing key:', KEYSTORE, '(keep it — updates need the same key)')
    pw = open(KEYPASS).read().strip()
    final = os.path.join(OUT, 'fabtrack-tv.apk')
    run([os.path.join(bt, 'apksigner' + BAT), 'sign', '--ks', KEYSTORE, '--ks-key-alias', 'fabtrack',
         '--ks-pass', 'pass:' + pw, '--key-pass', 'pass:' + pw, '--out', final, aligned], env)
    run([os.path.join(bt, 'apksigner' + BAT), 'verify', final], env)
    print('built', final, f'({os.path.getsize(final) // 1024} KB)')


if __name__ == '__main__':
    main()
