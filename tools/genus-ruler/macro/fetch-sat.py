#!/usr/bin/env python3
"""
fetch-sat.py — RULER-macro 의 **참값**: MODIS Terra 진색 영상(NASA GIBS WMS, 공개·키 없음)을 관측점 둘레 768 km 상자(1 km/px)로 받아
구름 마스크 → 3 km 운량 격자(256²) 를 만들고, 앱의 고리 90 점(weather.ts RING: 5/10/30/70/130/200/280/380 km × 12 방위, 5 km 는 6 방위)
자리에서 **예보 격자 크기(7 km 상자)로 평균**한 값을 '예보'로 뽑습니다. 다운스케일러는 그 90 값만 보고 256² 을 만들고, 자(macro.py)가
참값 격자와 견줍니다(held-out).

  python3 tools/genus-ruler/macro/fetch-sat.py <outDir> [--sites all|dev|held] [--dates 2026-09-01:2026-10-22:4]

출력: outDir/<site>_<date>.json { site, lat, lon, date, cover, ring:[{dist, az, cover}], trueGrid: base64 Uint8 256² (0~255 = 운량) },
      outDir/<site>_<date>.png(진색 축소 256²), outDir/index.json.
마스크: 흰 정도 min(R,G,B) > 0.45(땅 0.2~0.3·바다 0.07·구름 0.5~0.9, 서울 10/23 상자 사분위로 정함). 영상 빈 곳(스와스 틈, 전부 0)이 5 % 넘거나
운량 < 0.08·> 0.92 면 버립니다(다운스케일링이 할 일이 없음).
"""
import sys, os, json, math, base64, time, io
import urllib.request
import numpy as np
from PIL import Image

SITES = {
    'dev': {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774)},
    'held': {'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47), 'sapporo': (43.06, 141.35),
             'lisbon': (38.72, -9.14), 'denver': (39.74, -104.99), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)},
}
RING = [(5, [0, 60, 120, 180, -120, -60])] + [(d, [0, 30, 60, 90, 120, 150, 180, -150, -120, -90, -60, -30]) for d in (10, 30, 70, 130, 200, 280, 380)]
HALF_KM = 384.0
N_PX = 768          # 1 km/px
GRID = 256          # 3 km
FC_KM = 7.0         # 예보 격자 대용 평균 창
WHITE_T = 0.45

def wms_url(lat, lon, date):
    dlat = HALF_KM / 111.32
    dlon = HALF_KM / (111.32 * math.cos(math.radians(lat)))
    bbox = f"{lat-dlat:.5f},{lon-dlon:.5f},{lat+dlat:.5f},{lon+dlon:.5f}"
    return ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
            f"&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX={bbox}&WIDTH={N_PX}&HEIGHT={N_PX}&FORMAT=image/png&TIME={date}")

def fetch(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(3 * (i + 1))

def box_mean(a, k):
    """k×k 상자 평균(가장자리 정규화)."""
    H, W = a.shape
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), axis=0), axis=1)
    r = k // 2
    y0 = np.clip(np.arange(H) - r, 0, H); y1 = np.clip(np.arange(H) + k - r, 0, H)
    x0 = np.clip(np.arange(W) - r, 0, W); x1 = np.clip(np.arange(W) + k - r, 0, W)
    s = c[y1[:, None], x1[None, :]] - c[y0[:, None], x1[None, :]] - c[y1[:, None], x0[None, :]] + c[y0[:, None], x0[None, :]]
    return s / ((y1 - y0)[:, None] * (x1 - x0)[None, :])

def process(site, lat, lon, date, out):
    name = f"{site}_{date}"
    png = fetch(wms_url(lat, lon, date))
    im = Image.open(io.BytesIO(png)).convert('RGB')
    a = np.asarray(im).astype(np.float64) / 255.0
    empty = (a.max(axis=2) < 0.02).mean()
    white = a.min(axis=2)
    mask = (white > WHITE_T).astype(np.float64)
    cover = float(mask.mean())
    if empty > 0.05 or cover < 0.08 or cover > 0.92:
        return {'name': name, 'skip': True, 'empty': round(empty, 3), 'cover': round(cover, 3)}
    # 3 km 격자(3×3 상자 평균) — 행 0 = 북쪽
    g = mask.reshape(GRID, 3, GRID, 3).mean(axis=(1, 3))
    # 고리: 7 km 상자 평균(예보 격자 대용). x 동(+), y 북(+) → 행 = 384 − y, 열 = 384 + x
    sm = box_mean(mask, int(FC_KM))
    ring = [{'dist': 0, 'az': 0, 'cover': float(sm[N_PX // 2, N_PX // 2])}]
    for dist, azs in RING:
        for az in azs:
            x = dist * math.sin(math.radians(az)); y = dist * math.cos(math.radians(az))
            r = int(round(N_PX / 2 - y)); c = int(round(N_PX / 2 + x))
            r = min(N_PX - 1, max(0, r)); c = min(N_PX - 1, max(0, c))
            ring.append({'dist': dist, 'az': az, 'cover': float(sm[r, c])})
    im.resize((GRID, GRID), Image.BOX).save(os.path.join(out, name + '.png'))
    doc = {'site': site, 'lat': lat, 'lon': lon, 'date': date, 'cover': round(cover, 4), 'empty': round(empty, 4),
           'grid': GRID, 'cellKm': 3.0, 'ring': ring,
           'trueGrid': base64.b64encode(np.round(g * 255).astype(np.uint8).tobytes()).decode('ascii')}
    with open(os.path.join(out, name + '.json'), 'w') as f: json.dump(doc, f)
    return {'name': name, 'skip': False, 'cover': round(cover, 3), 'empty': round(empty, 3)}

def main(argv):
    out = argv[0]; os.makedirs(out, exist_ok=True)
    which = 'all'; dates = '2026-09-01:2026-10-22:4'
    if '--sites' in argv: which = argv[argv.index('--sites') + 1]
    if '--dates' in argv: dates = argv[argv.index('--dates') + 1]
    d0, d1, step = dates.split(':'); step = int(step)
    import datetime as dt
    a = dt.date.fromisoformat(d0); b = dt.date.fromisoformat(d1)
    ds = []
    while a <= b: ds.append(a.isoformat()); a += dt.timedelta(days=step)
    sites = {}
    for k, v in SITES.items():
        if which in ('all', k): sites.update(v)
    index = []
    for site, (lat, lon) in sites.items():
        for date in ds:
            name = f"{site}_{date}"
            if os.path.exists(os.path.join(out, name + '.json')):
                index.append({'name': name, 'skip': False, 'cached': True}); continue
            try:
                r = process(site, lat, lon, date, out)
            except Exception as e:
                r = {'name': name, 'skip': True, 'error': str(e)[:120]}
            r['group'] = 'dev' if site in SITES['dev'] else 'held'
            print(json.dumps(r), flush=True)
            index.append(r)
    with open(os.path.join(out, 'index.json'), 'w') as f: json.dump(index, f, indent=1)
    kept = [r for r in index if not r.get('skip')]
    print('kept', len(kept), 'of', len(index))

if __name__ == '__main__':
    main(sys.argv[1:])
