#!/usr/bin/env python3
"""
probe-layers.py: 복원 R9(RULER-regime §2.3). GIBS WMS 레이어마다 64 px 한 장을 받아 응답 상태·형식·바이트 수·sha256 만 적습니다.
영상은 디코드하지 않고 저장하지도 않습니다(내용을 보지 않음). C4 영상 받기는 oro 동결 뒤입니다.

  python3 tools/genus-ruler/regime/probe-layers.py [--out tools/genus-ruler/regime/probe-layers.json]

장소·날짜는 dev 서울, 2026-06-15(판정 기간 안, 장면 선택과 무관한 고정값)입니다. 상자는 §2.3 과 같은 96 km 입니다.
"""
import sys, os, json, math, time, hashlib, urllib.request, urllib.error

LAYERS = ['MODIS_Aqua_CorrectedReflectance_TrueColor', 'MODIS_Terra_CorrectedReflectance_TrueColor']
LAT, LON, DATE, HALF_KM, PX = 37.5, 127.0, '2026-06-15', 48.0, 64


def url_for(layer):
    dlat = HALF_KM / 111.32
    dlon = HALF_KM / (111.32 * math.cos(math.radians(LAT)))
    bbox = f'{LAT - dlat:.5f},{LON - dlon:.5f},{LAT + dlat:.5f},{LON + dlon:.5f}'
    return ('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0'
            f'&LAYERS={layer}&CRS=EPSG:4326&BBOX={bbox}&WIDTH={PX}&HEIGHT={PX}&FORMAT=image/png&TIME={DATE}')


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    out = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(here, 'probe-layers.json')
    rows = []
    for layer in LAYERS:
        u = url_for(layer)
        try:
            with urllib.request.urlopen(u, timeout=120) as r:
                body, st, ct = r.read(), r.status, r.headers.get('Content-Type')
        except urllib.error.HTTPError as e:
            body, st, ct = e.read(), e.code, e.headers.get('Content-Type')
        rows.append({'layer': layer, 'url': u, 'status': st, 'contentType': ct, 'bytes': len(body),
                     'isPng': body[:8] == b'\x89PNG\r\n\x1a\n', 'sha256': hashlib.sha256(body).hexdigest()})
        del body
        print(f"  {layer}: {st} {ct} {rows[-1]['bytes']} B png={rows[-1]['isPng']}")
        time.sleep(0.5)
    with open(out, 'w') as f:
        json.dump({'probedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'site': 'seoul', 'date': DATE,
                   'px': PX, 'halfKm': HALF_KM, 'layers': rows}, f, indent=1)
        f.write('\n')
    return 0 if all(r['status'] == 200 and r['isPng'] for r in rows) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
