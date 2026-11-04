#!/usr/bin/env python3
"""
fetch-sat-times.py: RULER-regime §2.1 위성 통과 시각(복원 R8). NASA CMR 에서 MODIS 위치 자료(MYD03 Aqua, MOD03 Terra)
granule 의 시각·폴리곤·주야 깃발만 받습니다. 영상·운량 값은 받지 않습니다(Open-Meteo 가중 0).

  python3 tools/genus-ruler/regime/fetch-sat-times.py [--out tools/genus-ruler/regime/sat-times.json.gz]
                                                     [--periods p2026,p2026spring,p2025] [--sites all|dev|held|name,…]
                                                     [--sleep 1.0] [--summary]

  - 질의: 사이트 × 위성 × 기간마다 하나(쪽 나눔은 CMR-Search-After, page_size=2000). point=lon,lat.
  - 시간 창은 사이트의 평균 태양일(UTC 시작 = 날짜 00:00 − lon/15 h)을 기간 첫날부터 끝날까지 이은 것입니다.
    granule 마다 그 시작 시각이 든 평균 태양일 날짜(solarDate)를 붙입니다.
  - 남기는 필드: time_start, time_end, day_night_flag, polygons(소수 셋째 자리). 주야 깃발이 NIGHT 인 granule 은 버립니다.
    다른 필드(이름·링크·크기 등)는 저장하지 않습니다.
  - --out 이 .gz 로 끝나면 gzip(mtime 0)으로 씁니다(60 질의 ≈ 5 MB JSON).
  - 질의 사이 --sleep 초(기본 1.0). 한 질의가 3 번 실패하면 멈추고 코드 2.
  - --summary: 저장된 파일에서 위성·기간·달마다 held 관측점을 덮는 DAY 날 수(사이트 합)만 찍습니다
    (VIIRS 대체 규칙, RULER-regime §2.1: 6~10 월 어느 달이든 Aqua 날 수 < Terra 의 절반이면 기간 전체 Aqua → VIIRS).
"""
import sys, os, json, time, gzip, hashlib, datetime as dt, urllib.request, urllib.error

SITES = {
    'dev': {'seoul': (37.5, 127.0), 'kanazawa': (36.5679, 136.6774)},
    'held': {'osaka': (34.69, 135.5), 'busan': (35.18, 129.08), 'shanghai': (31.23, 121.47), 'sapporo': (43.06, 141.35),
             'lisbon': (38.72, -9.14), 'denver': (39.74, -104.99), 'sydney': (-33.87, 151.21), 'hamburg': (53.55, 9.99)},
}
SATS = {'aqua': 'MYD03', 'terra': 'MOD03'}
PERIODS = {'p2026': ('2026-06-01', '2026-10-31'), 'p2026spring': ('2026-04-01', '2026-05-31'), 'p2025': ('2025-06-01', '2025-10-31')}
CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json'


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def window(lon, d0, d1):
    off = dt.timedelta(hours=lon / 15.0)
    a = dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc) - off
    b = dt.datetime.fromisoformat(d1).replace(tzinfo=dt.timezone.utc) + dt.timedelta(days=1) - off
    return a, b


def solar_date(t_iso, lon):
    t = dt.datetime.fromisoformat(t_iso.replace('Z', '+00:00')) + dt.timedelta(hours=lon / 15.0)
    return t.date().isoformat()


def query(short, lat, lon, a, b, sleep_s):
    base = f'{CMR}?short_name={short}&point={lon:.4f},{lat:.4f}&temporal={iso(a)},{iso(b)}&page_size=2000&sort_key=start_date'
    out, after, pages, hits = [], None, 0, None
    while True:
        req = urllib.request.Request(base, headers={'CMR-Search-After': after} if after else {})
        body = hdr = None
        for k in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    body, hdr = r.read(), dict(r.headers.items())
                break
            except (urllib.error.URLError, TimeoutError) as e:  # noqa: PERF203
                print(f'    retry {k + 1}: {e}')
                time.sleep(5)
        if body is None:
            raise RuntimeError(base)
        pages += 1
        hits = int(hdr.get('CMR-Hits') or hdr.get('cmr-hits') or 0)
        entries = json.loads(body)['feed']['entry']
        out.extend(entries)
        after = hdr.get('CMR-Search-After') or hdr.get('cmr-search-after')
        time.sleep(sleep_s)
        if not entries or len(out) >= hits or not after:
            break
    return base, hits, pages, out


def keep(e, lon):
    flag = e.get('day_night_flag')
    if flag == 'NIGHT':
        return None
    polys = [[' '.join(f'{float(v):.3f}' for v in ring.split()) for ring in p] for p in e.get('polygons', [])]
    return {'time_start': e['time_start'], 'time_end': e['time_end'], 'day_night_flag': flag,
            'polygons': polys, 'solarDate': solar_date(e['time_start'], lon)}


def load(path):
    with (gzip.open(path, 'rt') if path.endswith('.gz') else open(path)) as f:
        return json.load(f)


def save(path, doc):
    raw = (json.dumps(doc, separators=(',', ':')) + '\n').encode()
    if path.endswith('.gz'):
        with open(path, 'wb') as f, gzip.GzipFile(fileobj=f, mode='wb', mtime=0, filename='') as g:
            g.write(raw)
    else:
        with open(path, 'wb') as f:
            f.write(raw)


def summary(doc):
    for per in sorted({q['period'] for q in doc['queries']}):
        for sat in SATS:
            by_month = {}
            for q in doc['queries']:
                if q['period'] != per or q['sat'] != sat or q['site'] not in SITES['held']:
                    continue
                days = {g['solarDate'] for g in q['granules'] if g['day_night_flag'] in ('DAY', 'BOTH')}
                for d in days:
                    by_month[d[:7]] = by_month.get(d[:7], 0) + 1
            print(f'  {per:12s} {sat:5s} held DAY site-days by month: ' + ' '.join(f'{m}:{n}' for m, n in sorted(by_month.items())))


def main(argv):
    def opt(k, d):
        return argv[argv.index(k) + 1] if k in argv else d
    here = os.path.dirname(os.path.abspath(__file__))
    out = opt('--out', os.path.join(here, 'sat-times.json.gz'))
    if '--summary' in argv:
        summary(load(out))
        return 0
    periods = opt('--periods', ','.join(PERIODS)).split(',')
    which = opt('--sites', 'all')
    allsites = {**SITES['dev'], **SITES['held']}
    sites = allsites if which == 'all' else SITES[which] if which in SITES else {k: allsites[k] for k in which.split(',')}
    sleep_s = float(opt('--sleep', '1.0'))
    doc = load(out) if os.path.exists(out) else {'queries': []}
    done = {(q['site'], q['sat'], q['period']) for q in doc['queries']}
    doc.update({'source': CMR, 'products': SATS, 'periods': {p: PERIODS[p] for p in PERIODS},
                'fields': ['time_start', 'time_end', 'day_night_flag', 'polygons'],
                'scriptSha256': hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()})
    for per in periods:
        d0, d1 = PERIODS[per]
        for name, (lat, lon) in sorted(sites.items()):
            for sat, short in SATS.items():
                if (name, sat, per) in done:
                    continue
                a, b = window(lon, d0, d1)
                try:
                    url, hits, pages, ents = query(short, lat, lon, a, b, sleep_s)
                except RuntimeError as e:
                    print(f'  FAIL {name} {sat} {per}: {e}')
                    return 2
                gs = [g for g in (keep(e, lon) for e in ents) if g]
                doc['queries'].append({'site': name, 'sat': sat, 'period': per, 'url': url, 'hits': hits, 'pages': pages,
                                       'nReturned': len(ents), 'nDay': len(gs),
                                       'fetchedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'granules': gs})
                print(f'  {per:12s} {name:9s} {sat:5s} hits {hits:4d} pages {pages} kept {len(gs)}')
                save(out, doc)
    print(f"queries {len(doc['queries'])}")
    summary(doc)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
