#!/usr/bin/env python3
"""
fetch-dem.py: RULER-oro 의 지형 입력. Terrarium 타일(공개, 키 없음, Open-Meteo 가중 0)을 받아
.harness/oro/dem/ 에 두고, 타일마다 sha256, ETag, x-amz-version-id 를 목록(dem-manifest.json)으로 남깁니다.

  python3 tools/genus-ruler/oro/fetch-dem.py [--out .harness/oro/dem] [--manifest tools/genus-ruler/oro/dem-manifest.json]
                                             [--sites all|dev|held|name,name] [--dry]

타일 고르기(앱과 같은 줌, 같은 원점):
  - 줌 z = demZoomForRadius(384 km, lat, block 3)  (src/utils/demTiles.ts 와 같은 식).
    z6 에서 한 장이 384 km 보다 좁은 곳(hamburg)은 z5 가 됩니다.
  - 앱 블록: pickBlockOrigin(t.x, t.y, 3) 의 3×3.
  - 판정 상자: 관측점에서 동서남북 ±450 km 를 덮는 같은 줌 타일 전부.
  - 둘의 합집합을 받습니다.
디코드(R·256 + G + B/256 − 32768)와 사이트 격자로 다시 뽑기는 oro_ref.py 몫입니다. 여기서는 받기만 합니다.
받기 규칙: 순차, 요청 사이 0.3 s, 실패하면 5 s 뒤 3 번까지. 이미 있는 파일도 다시 받아 바이트가 같은지 찍습니다(CHANGED).
--dry 는 받을 타일 목록과 수만 찍습니다.
"""
import sys, os, json, math, time, hashlib
import urllib.request

SITES = {
    'dev': {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774)},
    'held': {'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47), 'sapporo': (43.06, 141.35),
             'lisbon': (38.72, -9.14), 'denver': (39.74, -104.99), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)},
}
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
EARTH_CIRCUMFERENCE_M = 40075016.686
RADIUS_M = 384e3
BOX_M = 450e3
BLOCK = 3


def tile_float(lon, lat, z):
    n = 2.0 ** z
    la = math.radians(lat)
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.log(math.tan(la) + 1.0 / math.cos(la)) / math.pi) / 2.0 * n)


def span_m(z, lat):
    return EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat)) / 2.0 ** z


def zoom_for_radius(radius_m, lat, block=BLOCK, max_zoom=14, min_zoom=4):
    margin = (block - 1) // 2
    for z in range(max_zoom, min_zoom - 1, -1):
        if span_m(z, lat) * margin >= radius_m:
            return z
    return min_zoom


def site_tiles(lat, lon):
    z = zoom_for_radius(RADIUS_M, lat)
    tx, ty = tile_float(lon, lat, z)
    half = (BLOCK - 1) // 2
    ox, oy = math.floor(tx) - half, math.floor(ty) - half
    block = {(z, ox + dx, oy + dy) for dy in range(BLOCK) for dx in range(BLOCK)}
    s = span_m(z, lat)
    d = BOX_M / s
    box = {(z, x, y) for y in range(math.floor(ty - d), math.floor(ty + d) + 1)
           for x in range(math.floor(tx - d), math.floor(tx + d) + 1)}
    return z, (tx, ty), (ox, oy), sorted(block), sorted(box)


def fetch(url, tries=3):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                body = r.read()
                return body, {h: r.headers.get(h) for h in ('ETag', 'x-amz-version-id', 'Last-Modified', 'Content-Type')}
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5)
    raise RuntimeError(f'{url}: {last}')


def main(argv):
    def opt(k, d):
        return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, '..', '..', '..'))
    out = opt('--out', os.path.join(root, '.harness', 'oro', 'dem'))
    manifest_path = opt('--manifest', os.path.join(here, 'dem-manifest.json'))
    which = opt('--sites', 'all')
    allsites = {**SITES['dev'], **SITES['held']}
    if which == 'all':
        sites = allsites
    elif which in SITES:
        sites = SITES[which]
    else:
        sites = {k: allsites[k] for k in which.split(',')}

    per_site, union = {}, set()
    for name, (lat, lon) in sorted(sites.items()):
        z, (tx, ty), (ox, oy), block, box = site_tiles(lat, lon)
        per_site[name] = {'lat': lat, 'lon': lon, 'zoom': z, 'tileX': tx, 'tileY': ty,
                          'blockOrigin': [ox, oy], 'tileSpanM': span_m(z, lat),
                          'blockTiles': [f'{t[0]}/{t[1]}/{t[2]}' for t in block],
                          'boxTiles': [f'{t[0]}/{t[1]}/{t[2]}' for t in box]}
        union |= set(block) | set(box)
    tiles = sorted(union)
    print(f'sites {len(per_site)}  tiles {len(tiles)}  zooms {sorted({t[0] for t in tiles})}')
    if '--dry' in argv:
        for n, s in per_site.items():
            print(f'  {n:9s} z{s["zoom"]} block {len(s["blockTiles"])} box {len(s["boxTiles"])}')
        return 0

    os.makedirs(out, exist_ok=True)
    rows, fails = [], []
    for i, (z, x, y) in enumerate(tiles):
        path = os.path.join(out, f'{z}_{x}_{y}.png')
        url = URL.format(z=z, x=x, y=y)
        try:
            body, hdr = fetch(url)
        except RuntimeError as e:
            fails.append(str(e))
            print(f'  FAIL {z}/{x}/{y}')
            continue
        if os.path.exists(path):
            old = open(path, 'rb').read()
            if old != body:
                print(f'  CHANGED {z}/{x}/{y} (bytes differ from cached file)')
        with open(path, 'wb') as f:
            f.write(body)
        rows.append({'tile': f'{z}/{x}/{y}', 'url': url, 'bytes': len(body),
                     'sha256': hashlib.sha256(body).hexdigest(),
                     'etag': (hdr.get('ETag') or '').strip('"'),
                     'versionId': hdr.get('x-amz-version-id'),
                     'lastModified': hdr.get('Last-Modified'),
                     'contentType': hdr.get('Content-Type')})
        if (i + 1) % 10 == 0:
            print(f'  {i + 1}/{len(tiles)}')
        time.sleep(0.3)

    man = {'source': URL, 'radiusM': RADIUS_M, 'boxM': BOX_M, 'block': BLOCK,
           'decode': 'R*256 + G + B/256 - 32768; h = max(0, elev)',
           'fetchedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'scriptSha256': hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest(),
           'nTiles': len(tiles), 'nFetched': len(rows), 'failures': fails,
           'sites': per_site, 'tiles': rows}
    os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
    with open(manifest_path, 'w') as f:
        json.dump(man, f, indent=1)
        f.write('\n')
    print(f'fetched {len(rows)}/{len(tiles)}  failures {len(fails)}  manifest {os.path.relpath(manifest_path, root)}')
    return 0 if not fails else 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
