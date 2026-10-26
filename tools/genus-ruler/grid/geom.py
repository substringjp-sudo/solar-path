# -*- coding: utf-8 -*-
"""
geom.py — 표본 배치(고리 vs 격자) 정의. 탐색 측정(grid 질문)의 두 측정 에이전트가 같은 정의를 쓰도록 한 곳에 둡니다.
좌표: 관측점 기준 동(+x)·북(+y) km. 변환은 fetch-sat.py 와 같은 등장방형(111.32 km/°, 경도는 cos(lat0) 배).
반환: list of dict {lat, lon, x, y, tag}. 중복 좌표는 지우지 않습니다(dedupe 는 호출 쪽에서, 무엇을 키로 할지 정해서).
"""
import math
KM_PER_DEG = 111.32
R_EARTH = 6371.0088

def dest(lat, lon, dist_km, az_deg):
    """weather.ts calculateDestination 과 같은 대원 목적지."""
    if dist_km == 0: return lat, lon
    d = dist_km / R_EARTH; a = math.radians(az_deg); p1 = math.radians(lat); l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(a))
    l2 = l1 + math.atan2(math.sin(a) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180

def to_km(lat0, lon0, lat, lon):
    dlon = (lon - lon0 + 540) % 360 - 180
    return dlon * KM_PER_DEG * math.cos(math.radians(lat0)), (lat - lat0) * KM_PER_DEG

def _pt(lat0, lon0, lat, lon, tag):
    x, y = to_km(lat0, lon0, lat, lon)
    return {'lat': lat, 'lon': lon, 'x': x, 'y': y, 'tag': tag}

# 앱 고리(weather.ts RING): 5 km 6방위, 10~380 km 12방위, + 관측점 = 91
RING = [(5, [0, 60, 120, 180, -120, -60])] + [(d, list(range(0, 360, 30))) for d in (10, 30, 70, 130, 200, 280, 380)]

def ring91(lat0, lon0):
    out = [_pt(lat0, lon0, lat0, lon0, 'obs')]
    for d, azs in RING:
        for a in azs:
            la, lo = dest(lat0, lon0, d, a); out.append(_pt(lat0, lon0, la, lo, f'r{d}'))
    return out

def ring_az(lat0, lon0, n_az=24):
    out = [_pt(lat0, lon0, lat0, lon0, 'obs')]
    for a in [0, 60, 120, 180, 240, 300]:
        la, lo = dest(lat0, lon0, 5, a); out.append(_pt(lat0, lon0, la, lo, 'r5'))
    for d in (10, 30, 70, 130, 200, 280, 380):
        for k in range(n_az):
            la, lo = dest(lat0, lon0, d, k * 360 / n_az); out.append(_pt(lat0, lon0, la, lo, f'r{d}'))
    return out

def snap(lat, lon, step):
    return round(lat / step) * step, round(lon / step) * step

def snapped(points, step, lat0, lon0):
    """각 점을 step° 정규 위경도 격자의 가장 가까운 격자점으로 옮기고 중복 제거(모델 칸 단위 요청)."""
    seen = {}; out = []
    for p in points:
        la, lo = snap(p['lat'], p['lon'], step)
        k = (round(la / step), round(lo / step))
        if k in seen: continue
        seen[k] = 1; out.append(_pt(lat0, lon0, la, lo, p['tag']))
    return out

def uniform_centered(lat0, lon0, spacing_km=71.3, radius_km=384):
    out = []; m = int(radius_km // spacing_km) + 1
    for i in range(-m, m + 1):
        for j in range(-m, m + 1):
            x, y = i * spacing_km, j * spacing_km
            if x * x + y * y <= radius_km ** 2:
                lat = lat0 + y / KM_PER_DEG; lon = lon0 + x / (KM_PER_DEG * math.cos(math.radians(lat0)))
                out.append(_pt(lat0, lon0, lat, lon, 'u'))
    return out

def uniform_anchored(lat0, lon0, step_deg=0.75, radius_km=384):
    """세계에 고정된 step° 정규 위경도 격자(관측점과 무관) 중 반경 안의 점."""
    out = []; i0, j0 = round(lat0 / step_deg), round(lon0 / step_deg)
    m = int(radius_km / (KM_PER_DEG * step_deg * math.cos(math.radians(min(85, abs(lat0) + 4))))) + 2
    for i in range(i0 - m, i0 + m + 1):
        for j in range(j0 - m, j0 + m + 1):
            p = _pt(lat0, lon0, i * step_deg, j * step_deg, 'ua')
            if p['x'] ** 2 + p['y'] ** 2 <= radius_km ** 2: out.append(p)
    return out

def clipmap(lat0, lon0, base_deg=0.125, levels=5, m=2, radius_km=None):
    """세계 고정 겹 격자(clipmap): 단계 k 의 간격 base·2^k°, 단계마다 (2m+1)² 칸을 관측점에 가장 가까운 격자점 중심으로.
    안쪽 단계가 덮는 상자(중심 ± (m+0.5)·s_{k-1})의 점은 뺍니다. radius_km 를 주면 그 밖 점은 버립니다."""
    out = []; prev = None
    for k in range(levels):
        s = base_deg * 2 ** k
        ci, cj = round(lat0 / s), round(lon0 / s)
        for di in range(-m, m + 1):
            for dj in range(-m, m + 1):
                la, lo = (ci + di) * s, (cj + dj) * s
                if prev is not None:
                    pla, plo, ps = prev
                    if abs(la - pla) <= (m + 0.5) * ps and abs(lo - plo) <= (m + 0.5) * ps: continue
                p = _pt(lat0, lon0, la, lo, f'L{k}')
                if radius_km is not None and p['x'] ** 2 + p['y'] ** 2 > radius_km ** 2: continue
                out.append(p)
        prev = (ci * s, cj * s, s)
    return out

def dense(lat0, lon0, step_deg=0.125, half_km=384):
    out = []; i0, j0 = round(lat0 / step_deg), round(lon0 / step_deg)
    mi = int(half_km / (KM_PER_DEG * step_deg)) + 1; mj = int(half_km / (KM_PER_DEG * step_deg * math.cos(math.radians(lat0)))) + 1
    for i in range(i0 - mi, i0 + mi + 1):
        for j in range(j0 - mj, j0 + mj + 1):
            p = _pt(lat0, lon0, i * step_deg, j * step_deg, 'd')
            if abs(p['x']) <= half_km and abs(p['y']) <= half_km: out.append(p)
    return out

GEOMS = {
    'G0_ring91':          lambda la, lo: ring91(la, lo),
    'G0c_ring91_cell':    lambda la, lo: snapped(ring91(la, lo), 0.125, la, lo),
    'G1_uniform_ctr':     lambda la, lo: uniform_centered(la, lo),
    'G1a_uniform_anch':   lambda la, lo: uniform_anchored(la, lo),
    'G2_clipmap_m2':      lambda la, lo: clipmap(la, lo, 0.125, 5, 2),
    'G2b_clipmap_m3':     lambda la, lo: clipmap(la, lo, 0.125, 5, 3),
    'G4_ring24az':        lambda la, lo: ring_az(la, lo, 24),
    'G3_dense0125':       lambda la, lo: dense(la, lo, 0.125),
}

if __name__ == '__main__':
    for la, lo in ((37.5, 127.0), (36.5679, 136.6774), (53.55, 9.99)):
        print(la, lo, {k: len(f(la, lo)) for k, f in GEOMS.items()},
              'ring91 unique cells 0.125/0.25:', len(snapped(ring91(la, lo), 0.125, la, lo)), len(snapped(ring91(la, lo), 0.25, la, lo)))
