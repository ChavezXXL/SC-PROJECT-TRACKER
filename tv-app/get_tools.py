"""Download the tools tv-app/build.py needs into tv-app/.tools (≈350 MB, once):

  - Eclipse Temurin JDK 17 (adoptium.net)
  - Android build-tools, the platform android.jar, and platform-tools (adb)
    from Google (dl.google.com) — covered by the Android SDK License.

    python tv-app/get_tools.py
"""
import io, os, re, shutil, sys, tempfile, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, '.tools')
REPO = 'https://dl.google.com/android/repository/'
JDK_URL = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'


def fetch(url, label):
    print(f'downloading {label} …', flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'fabtrack-tv-build'})
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    print(f'  {len(data) // (1024 * 1024)} MB', flush=True)
    return data


def unzip_root(data, dest):
    """Extract a zip whose contents sit in one top folder, as `dest`."""
    tmp = tempfile.mkdtemp(dir=TOOLS)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(tmp)
    entries = os.listdir(tmp)
    src = os.path.join(tmp, entries[0]) if len(entries) == 1 else tmp
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)
    shutil.rmtree(tmp, ignore_errors=True)


def android_archive(xml, path_prefix):
    """Newest Windows archive URL for a package path like 'build-tools;34.'."""
    best = None
    for m in re.finditer(r'<remotePackage path="([^"]+)">(.*?)</remotePackage>', xml, re.S):
        path, body = m.group(1), m.group(2)
        if not path.startswith(path_prefix) or '<channelRef ref="channel-0"/>' not in body:
            continue
        if '-rc' in path or '-ext' in path:   # stable releases only
            continue
        for a in re.finditer(r'<archive>(.*?)</archive>', body, re.S):
            ab = a.group(1)
            host = re.search(r'<host-os>(\w+)</host-os>', ab)
            if host and host.group(1) != 'windows':
                continue
            url = re.search(r'<url>([^<]+)</url>', ab).group(1)
            if best is None or path > best[0]:
                best = (path, url)
    if not best:
        sys.exit(f'no Android package found for {path_prefix}')
    return best


def main():
    os.makedirs(TOOLS, exist_ok=True)
    if not any(n.startswith('jdk') for n in os.listdir(TOOLS)):
        unzip_root(fetch(JDK_URL, 'Java (Temurin JDK 17)'), os.path.join(TOOLS, 'jdk-17'))
    xml = fetch(REPO + 'repository2-3.xml', 'Android package list').decode('utf-8')
    for prefix, dest in (('build-tools;34.', 'android/build-tools/{v}'),
                         ('platforms;android-34', 'android/platforms/android-34'),
                         ('platform-tools', 'android/platform-tools')):
        path, url = android_archive(xml, prefix)
        target = os.path.join(TOOLS, dest.format(v=path.split(';')[-1]))
        if os.path.isdir(target):
            print('have', path)
            continue
        unzip_root(fetch(REPO + url, path), target)
    print('tools ready in', TOOLS)


if __name__ == '__main__':
    main()
