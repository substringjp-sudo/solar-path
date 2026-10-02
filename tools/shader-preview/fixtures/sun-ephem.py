#!/usr/bin/env python3
"""
해 위치·출몰의 **바깥 자** — PyEphem 으로 표를 만들어 옆의 sun-ephem.json 에 둡니다.

앱의 태양력(src/utils/solarPosition.ts)을 앱 밖의 구현에 대어 보려는 것입니다.
PyEphem 은 VSOP87 행성 이론에 광행차·장동·시차를 넣어 겉보기 위치를 각초 단위로
냅니다. 굴절은 끕니다(pressure = 0) — 앱의 고도는 기하 고도이기 때문입니다.

이 표는 커밋해 둡니다. 판정(verify-solar-position.js)이 네트워크·파이썬 없이 돌게
하려는 것이고, 다시 만들 일은 장소·시각을 바꿀 때뿐입니다:

    python3 -m venv /tmp/ephem && /tmp/ephem/bin/pip install ephem
    /tmp/ephem/bin/python tools/shader-preview/fixtures/sun-ephem.py
"""
import json, math, os
import ephem

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sun-ephem.json')

PLACES = [
    ('fukui', 36.0209, 136.2894), ('seoul', 37.5665, 126.978), ('tokyo', 35.6762, 139.6503),
    ('london', 51.5072, -0.1276), ('sydney', -33.8688, 151.2093), ('quito', -0.1807, -78.4678),
    ('reykjavik', 64.1466, -21.9426), ('honolulu', 21.3069, -157.8583),
]
DATES = ['2026/1/15', '2026/3/20', '2026/6/21', '2026/9/23', '2026/10/2', '2026/12/21']
HOURS = [0, 3, 6, 9, 12, 15, 18, 21]


def observer(lat, lon, when):
    o = ephem.Observer()
    o.lat, o.lon = str(lat), str(lon)
    o.elevation = 0
    o.pressure = 0          # 굴절 끔 → 기하 고도
    o.date = when
    return o


def iso(d):
    return ephem.Date(d).datetime().isoformat(timespec='milliseconds') + 'Z'


positions = []
for name, lat, lon in PLACES:
    for day in DATES:
        for hh in HOURS:
            when = ephem.Date(day) + hh * ephem.hour
            s = ephem.Sun(observer(lat, lon, when))
            positions.append(dict(place=name, lat=lat, lon=lon, iso=iso(when),
                                  altDeg=round(math.degrees(s.alt), 5), azDeg=round(math.degrees(s.az), 5)))

# 후쿠이 2026-10-02 — 사진이 찍힌 시각들 (JST = UTC+9)
for hhmmss in ['08:28:00', '08:30:00', '08:31:00']:
    when = ephem.Date('2026/10/2 ' + hhmmss)
    s = ephem.Sun(observer(36.0209, 136.2894, when))
    positions.append(dict(place='fukui-photo', lat=36.0209, lon=136.2894, iso=iso(when),
                          altDeg=round(math.degrees(s.alt), 5), azDeg=round(math.degrees(s.az), 5)))

# 출몰 — 해 중심이 기하 고도 −0.8333° (굴절 34′ + 시반경 16′ 의 관례값)를 지나는 순간.
# 기준 시각은 그 경도의 정오 무렵이라, 앱(sunTimes)에 같은 시각을 넘기면 같은 날을 고릅니다.
events = []
for name, lat, lon in PLACES:
    for day in DATES:
        noon = ephem.Date(day) + (12 - lon / 15.0) * ephem.hour
        o = observer(lat, lon, noon)
        o.horizon = '-0:50'
        row = dict(place=name, lat=lat, lon=lon, noonIso=iso(noon))
        try:
            row['setIso'] = iso(o.next_setting(ephem.Sun(), use_center=True))
            row['riseIso'] = iso(o.previous_rising(ephem.Sun(), use_center=True))
        except (ephem.AlwaysUpError, ephem.NeverUpError) as e:
            row['none'] = type(e).__name__
        events.append(row)

with open(OUT, 'w') as f:
    json.dump(dict(source='PyEphem ' + ephem.__version__ + ' (pressure=0, geometric, topocentric)',
                   positions=positions, events=events), f, indent=1)
print(f'{OUT}: positions {len(positions)}, events {len(events)}')
