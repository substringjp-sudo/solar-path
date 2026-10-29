#!/usr/bin/env python3
"""
RULER-tsun 장면·잡 (동결 후보 2026-10-28, 검토 반영판).

  nice -n 19 python3 -I make-jobs-tsun.py pin                       → scenes-tsun.json (비평 잡에서 장면 입력 고정 + B 고리 재생성 sha 대조
                                                                       + R-A 단위 기하 사전 분류)
  nice -n 19 python3 -I make-jobs-tsun.py expand --outdir 폴더       → 크기(W×H)·페이지별 잡 파일 + run-tsun.sh + jobs-manifest.json(파일 sha)

B 장면(사진 맞춤)의 거시 고리(3 km 간격 120 km 까지 · 10 km 간격 380 km 까지 · 층마다 9319 점)는 크므로 scenes-tsun.json 에는
생성 매개변수 + 정규 JSON sha256 만 적고, 여기 dense_ring 이 비평 생성기(twphoto/rend/mkjobs.py · heda/rend2/mkjobs_h.py)와
같은 식으로 다시 만듭니다. pin 은 다시 만든 고리가 비평 잡 파일의 고리와 바이트 같은지(정규 sha) 확인합니다.
씨앗(절차 #16): 잡음 씨앗 = 앱 기본 12345(applyNoiseSeed(undefined)), flowSeed 없음(흐름 끔), 종류 표류는 date 에서 — 그래서 date 를 ms 까지 고정.
"""
import copy, hashlib, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/twphoto'
R_E = 6371.0
SRC = {
    'P1': SCR + '/rend/jobs-R1.json',            # 비평 P1 렌더(5ced8b1 번들, §173 고침 전) — t0x = 노출 ×45
    'P2': SCR + '/heda/rend2/jobs-P2-2.json',    # 헤다 P2(80f22a6 번들, §173 고침 후) — t0x = 노출 ×2.0
    'P3': SCR + '/heda/rend2/jobs-P3-2.json',    # 헤다 P3 — t0x = 노출 ×0.13
    'TW': 'tools/genus-ruler/flow/jobs-flow-guards.json',   # 저장소 상대(절차 #16: 절대 경로를 박지 않음)
    'DEV': SCR + '/heda/rend2/jobs-P2-1.json',   # 헤다 기기 시점(보고만)
    'GRAIN': 'tools/genus-ruler/grain/jobs-grain.json',      # 비용 잡(RULER-grain C0__*__cost) — §4.7
}


def apath(p):
    return p if os.path.isabs(p) else os.path.join(REPO, p)


def sha_file(p):
    return hashlib.sha256(open(apath(p), 'rb').read()).hexdigest()


def sha_obj(o):
    return hashlib.sha256(json.dumps(o, separators=(',', ':'), sort_keys=True).encode()).hexdigest()


# ---------------------------------------------------------------- 비평 생성기와 같은 고리
def dense_ring(fn, shift=(0.0, 0.0)):
    def fs(x, y):
        xt, yt = x - shift[0], y - shift[1]
        return fn(xt, yt, math.hypot(xt, yt), math.degrees(math.atan2(xt, yt)) % 360)
    pts = [{'distance': 0, 'azimuthOffset': 0, 'cover': round(fs(0.0, 0.0), 4)}]
    r = 3
    while r <= 381:
        step = 3 if r <= 120 else 10
        n = max(6, round(2 * math.pi * r / step))
        for i in range(n):
            az = i * 360.0 / n
            x, y = r * math.sin(math.radians(az)), r * math.cos(math.radians(az))
            pts.append({'distance': r, 'azimuthOffset': round(az, 3), 'cover': round(fs(x, y), 4)})
        r += 3 if r < 120 else 10
    return pts


def dense_ring_heda(fn):
    """heda/rend2/mkjobs_h.py 판(fn(0,0,0,0) 로 가운데를 셈)."""
    pts = [{'distance': 0, 'azimuthOffset': 0, 'cover': round(fn(0.0, 0.0, 0.0, 0.0), 4)}]
    r = 3
    while r <= 381:
        step = 3 if r <= 120 else 10
        n = max(6, round(2 * math.pi * r / step))
        for i in range(n):
            az = i * 360.0 / n
            x, y = r * math.sin(math.radians(az)), r * math.cos(math.radians(az))
            pts.append({'distance': r, 'azimuthOffset': round(az, 3), 'cover': round(fn(x, y, r, az), 4)})
        r += 3 if r < 120 else 10
    return pts


def inside(poly, x, y):
    c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


P1_EDGE = [(60, 45), (20, 24), (0, 15), (-11.6, 10.1), (-14.0, 9.0), (-18.0, 7.6), (-24.5, 5.4), (-34.6, 1.4), (-47.3, -5.6), (-64.8, -17.5),
           (-84.7, -32.5), (-101.0, -50.1), (-113.2, -68.5), (-140, -110), (-170, -160), (-230, -260)]
P1_DECK_POLY = P1_EDGE + [(-230, -420), (420, -420), (420, 45)]
P1B = dict(deckKm=7.4, deckThickM=500, deckCover=0.75, cuBaseKm=1.0, cuThickM=2000, cuCover=0.5, cuAz=(232, 318), cuDist=(25, 60))
P2B = dict(scBaseKm=1.736, scThickM=527, scCover=0.75, scEdgeKm=24.7, bankDist=(51, 130), bankCover=0.7, westSector=(215, 325),
           acBaseKm=2.822, acThickM=1000, acCover=0.5, acEdgeKm=30)
P3B = dict(scBaseKm=1.736, scThickM=527, scCover=0.45, scDist=(32, 120), acBaseKm=2.822, acThickM=1000, acCover=0.85, acEdgeKm=33, westSector=(215, 325))
# 서쪽 흐림 반사실(§4.5, 타당성 M4): P1-B 의 빈 중층에 해 쪽 벽 — 방위 180~360(관측점 기준), 100~380 km, 운량 1.0, ns 밑면 2 km 두께 14 km(꼭대기 16 km).
# 1차 광선은 100 km 경사에서 멈추므로(maxRayKm 100) 벽은 화면에 안 보임 — 아치 광선(T_arch, 400 km)만 벽을 봄.
P1CF = dict(az=(180, 360), dist=(100, 380), cover=1.0, genus='ns', baseKm=2.0, thicknessM=14000)
P1CE = dict(P1CF, az=(0, 180))    # 동쪽 대조: 같은 벽을 해 반대쪽에
HI_FACTOR = 16                     # P1 장면 선형용 두 번째 노출(§3.1)
# R-A 새 장면 RA5(타당성 B2): 가까운 sc 0.6(1.0~1.5 km, 30 km 안) + 해 쪽 먼 '더 높은' 층 ac 1.0(2.8~4.8 km, 40~200 km, 해 방위 ±40°)
RA5 = dict(nearBaseKm=1.0, nearThickM=500, nearCover=0.6, nearKm=30, farBaseKm=2.8, farThickM=2000, farCover=1.0, farDist=(40, 200), farHalfAz=40)


def macro_P1B(shift):
    lo, hi = P1B['cuAz']; d0, d1 = P1B['cuDist']
    return {'low': dense_ring(lambda x, y, r, az: P1B['cuCover'] if (d0 <= r <= d1 and lo <= az <= hi) else 0.0, shift),
            'mid': dense_ring(lambda x, y, r, az: 0.0, shift),
            'high': dense_ring(lambda x, y, r, az: P1B['deckCover'] if inside(P1_DECK_POLY, x, y) else 0.0, shift)}


def macro_wall(W, shift=(0.0, 0.0)):
    m = macro_P1B(shift)
    a0, a1 = W['az']; d0, d1 = W['dist']
    m['mid'] = dense_ring(lambda x, y, r, az: W['cover'] if (a0 <= az <= a1 and d0 <= r <= d1) else 0.0, shift)
    return m


def macro_P2B():
    w0, w1 = P2B['westSector']; b0, b1 = P2B['bankDist']
    def low(x, y, r, az):
        if not (w0 <= az <= w1): return P2B['scCover'] if r <= 60 else 0.3
        if r <= P2B['scEdgeKm']: return P2B['scCover']
        if b0 <= r <= b1: return P2B['bankCover']
        return 0.0
    def mid(x, y, r, az):
        west = w0 <= az <= w1
        return P2B['acCover'] if (r <= P2B['acEdgeKm'] or (not west and r <= 80)) else 0.0
    return {'low': dense_ring_heda(low), 'mid': dense_ring_heda(mid), 'high': dense_ring_heda(lambda *a: 0.0)}


def p3b_cover(band, r, az):
    w0, w1 = P3B['westSector']; d0, d1 = P3B['scDist']
    west = (w0 <= az) & (az <= w1)
    if band == 'low':
        return np.where(~west, np.where(r > 20, 0.2, 0.0), np.where((d0 <= r) & (r <= d1), P3B['scCover'], 0.0))
    if band == 'mid':
        return np.where(~west, np.where(r <= 80, P3B['acCover'], 0.4), np.where(r <= P3B['acEdgeKm'], P3B['acCover'], 0.0))
    return np.zeros_like(r)


def ra3_cover(band, r, az, sun_az):
    d = (az - sun_az + 180) % 360 - 180
    if band == 'low':
        return np.where((np.abs(d) <= 40) & (40 <= r) & (r <= 150), 1.0, 0.0)
    if band == 'mid':
        return np.where(r <= 30, 0.6, 0.0)
    return np.zeros_like(r)


def ra5_cover(band, r, az, sun_az):
    d = (az - sun_az + 180) % 360 - 180
    if band == 'low':
        return np.where(r <= RA5['nearKm'], RA5['nearCover'], 0.0)
    if band == 'mid':
        return np.where((np.abs(d) <= RA5['farHalfAz']) & (RA5['farDist'][0] <= r) & (r <= RA5['farDist'][1]), RA5['farCover'], 0.0)
    return np.zeros_like(r)


def _ring_from(cov):
    f = lambda band: (lambda x, y, r, az: float(cov(band, np.array(r, float), np.array(az, float))))
    return {'low': dense_ring_heda(f('low')), 'mid': dense_ring_heda(f('mid')), 'high': dense_ring_heda(f('high'))}


def macro_P3B():
    w0, w1 = P3B['westSector']; d0, d1 = P3B['scDist']
    def low(x, y, r, az):
        if not (w0 <= az <= w1): return 0.2 if r > 20 else 0.0
        return P3B['scCover'] if d0 <= r <= d1 else 0.0
    def mid(x, y, r, az):
        if not (w0 <= az <= w1): return P3B['acCover'] if r <= 80 else 0.4
        return P3B['acCover'] if r <= P3B['acEdgeKm'] else 0.0
    return {'low': dense_ring_heda(low), 'mid': dense_ring_heda(mid), 'high': dense_ring_heda(lambda *a: 0.0)}


def macro_RA3(sun_az):
    def low(x, y, r, az):
        d = (az - sun_az + 180) % 360 - 180
        return 1.0 if (abs(d) <= 40 and 40 <= r <= 150) else 0.0
    def mid(x, y, r, az):
        return 0.6 if r <= 30 else 0.0
    return {'low': dense_ring_heda(low), 'mid': dense_ring_heda(mid), 'high': dense_ring_heda(lambda *a: 0.0)}


def macro_RA5(sun_az):
    return _ring_from(lambda band, r, az: ra5_cover(band, r, az, sun_az))


GEN = {'P1B': lambda p: macro_P1B(tuple(p.get('shift_km', (0.0, 0.0)))),
       'P1CF': lambda p: macro_wall(P1CF, tuple(p.get('shift_km', (0.0, 0.0)))),
       'P1CE': lambda p: macro_wall(P1CE, tuple(p.get('shift_km', (0.0, 0.0)))),
       'P2B': lambda p: macro_P2B(), 'P3B': lambda p: macro_P3B(), 'RA3': lambda p: macro_RA3(p['sun_az']), 'RA5': lambda p: macro_RA5(p['sun_az'])}


def pick(path, name):
    for j in json.load(open(apath(path))):
        if j['name'] == name:
            return j
    raise KeyError(name)


def strip_macro(job, gen=None, params=None):
    j = copy.deepcopy(job)
    if 'macro' in j['input']:
        m = j['input'].pop('macro')
        j['input']['macroRef'] = dict(gen=gen, params=params, sha256=sha_obj(m), n_points={k: len(v) for k, v in m.items()}) if gen else None
        if not gen:
            j['input']['macro'] = m
    return j


ENGINE_SUN = json.load(open(os.path.join(HERE, 'sun-tsun.json')))
HEDA = dict(lat=34.97342, lon=138.77713, heightM=2.74)


# ---------------------------------------------------------------- R-A 단위 기하 사전 분류(통계 #7·타당성 B2, 렌더 전)
SEC_MARCH_KM = 6.5   # C0ps 의 해 쪽 2차 행진 길이 ≈ sunMarch [6, 250, 1.6] [computed, 절차 검토 #3]


def classify_unit(unit, layers, cov, n=(40, 30), step=0.2, sun_step=0.25):
    """화면 40×30 광선 → 처음 닿는 구름 점 P(1차 광선 100 km 경사 안). P 마다: 지구 그림자(해 광선이 지구에 닿음), 층 안 해 쪽 경로,
       그 뒤 다른 구름(어느 층) 경로(400 km 까지), 층 기둥(밑면·꼭대기) 사이를 그림자 경계가 지나는지. 분율 ≥ 0.25 면 변별(disc)."""
    inp = unit['input']; s = unit['sun']
    W, H = unit['W'], unit['H']; vf = inp['fov']
    f = (H / 2) / math.tan(math.radians(vf) / 2)
    us = (np.arange(n[0]) + 0.5) * W / n[0]; vs = (np.arange(n[1]) + 0.5) * H / n[1]
    U, V = np.meshgrid(us, vs)
    a, e = math.radians(inp['az']), math.radians(inp['el'])
    F = np.array([math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)]); Rv = np.array([math.cos(a), -math.sin(a), 0.0]); Uv = np.cross(Rv, F)
    D = F + ((U - W / 2) / f)[..., None] * Rv - ((V - H / 2) / f)[..., None] * Uv
    D = (D / np.linalg.norm(D, axis=-1, keepdims=True)).reshape(-1, 3)
    o = np.array([0.0, 0.0, R_E + inp['heightM'] / 1000.0])
    lay = [(L['band'], L['baseKm'], L['baseKm'] + L.get('thicknessM', 0) / 1000.0, L.get('cover', 0)) for L in layers if L.get('genus')]
    def cover_at(band, base_cov, P):
        h = np.linalg.norm(P, axis=-1) - R_E
        r = R_E * np.arctan2(np.hypot(P[..., 0], P[..., 1]), P[..., 2]); az = np.degrees(np.arctan2(P[..., 0], P[..., 1])) % 360
        c = cov(band, r, az) if cov else np.full(r.shape, base_cov)
        return h, c
    hit = np.full(len(D), -1); Pt = np.zeros((len(D), 3)); found = np.zeros(len(D), bool)
    for t in np.arange(step, 100.0 + 1e-9, step):
        P = o + t * D
        for li, (band, b0, b1, bc) in enumerate(lay):
            h, c = cover_at(band, bc, P)
            m = (~found) & (h >= b0) & (h <= b1) & (c > 0.05)
            hit[m] = li; Pt[m] = P[m]; found |= m
    idx = np.where(found)[0]
    if len(idx) == 0:
        return dict(n_vis=0, family='none', disc=False)
    P = Pt[idx]; L = hit[idx]
    sa, se = math.radians(s['az']), math.radians(s['alt'])
    sd = np.array([math.sin(sa) * math.cos(se), math.cos(sa) * math.cos(se), math.sin(se)])
    def shadowed(Q):
        tt = -(Q @ sd)
        rmin = np.where(tt > 0, np.linalg.norm(Q + np.maximum(tt, 0)[..., None] * sd, axis=-1), np.linalg.norm(Q, axis=-1))
        return rmin < R_E
    sh = shadowed(P)
    # 층 기둥의 그림자 경계: 같은 (x, y) 의 밑면·꼭대기 점
    up = P / np.linalg.norm(P, axis=-1, keepdims=True)
    b0s = np.array([lay[i][1] for i in L]); b1s = np.array([lay[i][2] for i in L])
    edge = shadowed(up * (R_E + b0s)[:, None]) != shadowed(up * (R_E + b1s)[:, None])
    # 해 쪽 경로
    in_path = np.zeros(len(P)); far_path = np.zeros(len(P)); left = np.zeros(len(P), bool)
    for t in np.arange(sun_step, 400.0 + 1e-9, sun_step):
        Q = P + t * sd
        inside_own = np.zeros(len(P), bool); inside_any = np.zeros(len(P), bool)
        for li, (band, b0, b1, bc) in enumerate(lay):
            h, c = cover_at(band, bc, Q)
            m = (h >= b0) & (h <= b1) & (c > 0.05)
            inside_any |= m; inside_own |= m & (L == li)
        still = (~left) & inside_own
        in_path += still * sun_step
        left |= ~inside_own
        far_path += (left & inside_any) * sun_step
    lit = ~sh
    f_in = float((lit & (in_path > SEC_MARCH_KM)).mean()); f_far = float((lit & (far_path > 1.0)).mean())
    f_es = float(edge.mean()); f_lit = float(lit.mean())
    es = f_es >= 0.25 or (0.1 <= f_lit <= 0.9)   # 그림자 경계가 층 기둥 안 또는 화면을 가로지름
    fam = 'far' if f_far >= 0.25 else 'es' if es else 'in' if f_in >= 0.25 else ('ctrl' if f_lit > 0 else 'dark')
    return dict(n_vis=int(len(P)), f_vis=round(len(P) / len(D), 3), f_lit=round(f_lit, 3), f_in=round(f_in, 3), f_far=round(f_far, 3), f_es=round(f_es, 3),
                in_path_med_km=round(float(np.median(in_path[lit])) if lit.any() else 0.0, 2),
                far_path_med_km=round(float(np.median(far_path[lit])) if lit.any() else 0.0, 2),
                family=fam, disc=bool(max(f_in, f_far) >= 0.25 or es))


def cmd_pin():
    out = {'note': 'RULER-tsun 장면(동결 후보). 판정 장면 = B(사진 맞춤), A(예보)는 보고·배치 점검. 사진은 저장소 밖(tsun-photo.json 의 sha256).',
           'sources': {k: dict(path=v, sha256=sha_file(v)) for k, v in SRC.items() if os.path.exists(apath(v))},
           'engine_sun': ENGINE_SUN, 'cams': {}, 'scenes': {}, 'checks': {},
           'seeds': dict(noiseSeed='앱 기본 12345 (applyNoiseSeed(undefined))', flowSeed='없음(흐름 끔)', genusDrift='input.date 에서(ms 까지 고정)'),
           'renderer_sun_note': '조명·그림자 스위치는 takram getSunDirectionECEF(엔진 NOAA 와 P2 +0.0012°, P3 +0.0011° 차 [measured, 절차 #12]) — 무시할 만함, results.scene 에 기록'}
    out['cams'] = {'P1': dict(az=275.301, el=8.452, fov=58.285, W=1000, H=750, roll=0.0),
                   'P2': dict(az=269.812, el=6.094, fov=28.161, W=390, H=520, roll=0.0),
                   'P3': dict(az=263.142, el=5.541, fov=12.879, W=800, H=600, roll=0.0),
                   'TW': dict(W=390, H=584, src='flow/README.md:13'), 'DEV': dict(W=390, H=520, src='heda/render-metrics.json device_view_cams'),
                   'RA': dict(W=400, H=300)}
    out['exposure_effective'] = {'P1B': 45000.0, 'P1Bh': 45000.0 * HI_FACTOR, 'P2B': 1250.617, 'P3B': 3.890,
                                 'note': 'autoExposure × exposureScale [computed, 절차 #2d] — tsun_photo.py render 가 results.scene.exposure 와 대조(±0.1 %)'}
    # --- P1
    jB = pick(SRC['P1'], 'P1_B_t0x_obs_r100'); jA = pick(SRC['P1'], 'P1_A_t0x_obs_r100')
    m_crit = jB['input']['macro']
    m_pre = macro_P1B((0.0, 20.34)); m_post = macro_P1B((0.0, 0.0))
    out['checks']['P1B_preshift_regen_equals_critic'] = sha_obj(m_pre) == sha_obj(m_crit)
    s = strip_macro(jB, 'P1B', {'shift_km': [0.0, 0.0]})
    s['name'] = 'P1B'
    s['input']['macroRef']['sha256'] = sha_obj(m_post)
    s['input']['macroRef']['critic_preshift_sha256'] = sha_obj(m_crit)
    s['input']['macroRef']['note'] = ('비평 잡의 고리는 §173 버그를 상쇄하려고 북쪽 20.34 km 미리 밀었음(rend/mkjobs.py MACRO_SHIFT). §173 고친 번들에서는 '
                                      '밀지 않은 고리(shift 0)를 씀 — 이 sha. 미리 민 원본 sha 는 critic_preshift_sha256. §173 은 24 km 종류 타일 원점도 0.85 타일 옮겨 '
                                      '구름 질감 실현은 비평 렌더와 다름(절차 #8).')
    s['input']['date'] = '2026-10-02T09:22:21.793Z'
    s['input']['date_critic'] = jB['input']['date']
    out['scenes']['P1B'] = dict(role='판정(R-B-deep D1m·D2, 가드 D3·D4)', exposureScale=jB.get('exposureScale'), job=s, src=dict(file=SRC['P1'], name=jB['name']),
                                params=P1B, edge_en_km=P1_EDGE)
    sh = copy.deepcopy(s); sh['name'] = 'P1Bh'; sh['exposureScale'] = jB['exposureScale'] * HI_FACTOR
    out['scenes']['P1Bh'] = dict(role=f'장면 선형 합침(×{HI_FACTOR} 노출, §3.1) — P1B 와 같은 잡, 노출만', exposureScale=sh['exposureScale'], job=sh)
    for nm, W in [('P1CF', P1CF), ('P1CE', P1CE)]:
        cf = copy.deepcopy(s); cf['name'] = nm
        cf['input']['layers'] = [L if L.get('band') != 'mid' else {'genus': W['genus'], 'cover': W['cover'], 'baseKm': W['baseKm'],
                                                                   'thicknessM': W['thicknessM'], 'band': 'mid', 'opts': {'beamTransmittance': 0.0}}
                                 for L in cf['input']['layers']]
        cf['input']['macroRef'] = dict(gen=nm, params={'shift_km': [0.0, 0.0]}, sha256=sha_obj(GEN[nm]({})))
        out['scenes'][nm] = dict(role='관문(서쪽 흐림 반사실, §4.5)' if nm == 'P1CF' else '관문(동쪽 대조, §4.5)', exposureScale=jB.get('exposureScale'), job=cf, params=W,
                                 src=dict(derived_from='P1B', note='P1B + 중층 벽(이름 따로, 절차 #17)'))
        cfh = copy.deepcopy(cf); cfh['name'] = nm + 'h'; cfh['exposureScale'] = jB['exposureScale'] * HI_FACTOR
        out['scenes'][nm + 'h'] = dict(role=f'{nm} 의 ×{HI_FACTOR} 노출(장면 선형 합침)', exposureScale=cfh['exposureScale'], job=cfh)
    sA = strip_macro(jA); sA['name'] = 'P1A'
    out['scenes']['P1A'] = dict(role='보고(예보 장면, 덮개 없음)', exposureScale=jA.get('exposureScale'), job=sA, src=dict(file=SRC['P1'], name=jA['name']),
                                note='scene-P1-forecast.json(§175 전 liveScene, SunCalc). 해 −9.84 라 빔·τ 영향 없음 [estimate].')
    # --- P2·P3
    for pid, gen, fn in [('P2', 'P2B', macro_P2B), ('P3', 'P3B', macro_P3B)]:
        jB = pick(SRC[pid], f'{pid}_B_t0x_obs_r100'); jA = pick(SRC[pid], f'{pid}_A_t0x_obs_r100')
        m = fn()
        out['checks'][f'{gen}_regen_equals_critic'] = sha_obj(m) == sha_obj(jB['input']['macro'])
        sb = strip_macro(jB, gen, {}); sb['name'] = gen
        sa = strip_macro(jA); sa['name'] = f'{pid}A'
        out['scenes'][gen] = dict(role='가드(E3·E4·E7·E8, H2) · 보고(E5·E6)' if pid == 'P2' else '판정(R-C C1, 가드 C5·FL)', exposureScale=jB.get('exposureScale'),
                                  job=sb, src=dict(file=SRC[pid], name=jB['name']), params=P2B if pid == 'P2' else P3B)
        out['scenes'][f'{pid}A'] = dict(role='배치 점검·보고(E1~E4)' if pid == 'P2' else '보고', exposureScale=jA.get('exposureScale'),
                                        job=sa, src=dict(file=SRC[pid], name=jA['name']),
                                        note='heda/rend2/scenes/forecast-scenes.json(80f22a6 liveScene = §175 전, SunCalc 빔·τ). 고정 — 다시 만들지 말 것, 차이는 보고만.')
    for n in ['C0_tw1734', 'C0_tw1746']:
        j = pick(SRC['TW'], n); j = copy.deepcopy(j); j['name'] = n.replace('C0_', '')
        out['scenes'][j['name']] = dict(role='가드(RULER-twilight-hue H1; quality high 라 C0 ≡ C0ps, 절차 #13)', job=j, src=dict(file=SRC['TW'], name=n))
    for n in ['DEV_A_t1734_obs_r100', 'DEV_A_t1746_obs_r100']:
        j = strip_macro(pick(SRC['DEV'], n)); j['name'] = n.replace('_obs_r100', '')
        out['scenes'][j['name']] = dict(role='보고(헤다 기기 시점 박명 색)', job=j, src=dict(file=SRC['DEV'], name=n))
    # --- R-A 합성 장면(§4.3) · 높은 해(§4.4) · 아치 켜짐 이음매(§4.6b)
    ra = ENGINE_SUN['ra']
    def view(sun_az, kind):
        return dict(az=round(sun_az, 3), el=4.0, fov=30.0) if kind == 'V1' else dict(az=round((sun_az + 90) % 360, 3), el=25.0, fov=60.0)
    RA = {
        'RA1': dict(desc='균일 ac 덮개(층 안 스치는 광학두께)', suns=['heda_8', 'heda_4', 'heda_1.1'], macro=None,
                    layers=[{'genus': None, 'cover': 0, 'baseKm': 1.0, 'band': 'low'},
                            {'genus': 'ac', 'cover': 0.85, 'baseKm': 2.822, 'thicknessM': 1000, 'band': 'mid', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': None, 'cover': 0, 'baseKm': 10, 'band': 'high'}]),
        'RA2': dict(desc='P3-B 장면(가까운 덮개 + 먼 해 쪽 층적운 — 먼 층이 더 낮음)', suns=['heda_4', 'heda_1.1', 'heda_-1'], macro='P3B',
                    layers=out['scenes']['P3B']['job']['input']['layers']),
        'RA3': dict(desc='해 쪽 먼 둑(40~150 km, 운량 1) + 머리 위 ac 조각(30 km 안)', suns=['heda_4', 'heda_1.1', 'heda_-1', 'heda_-2.5'], macro='RA3',
                    layers=[{'genus': 'sc', 'cover': 1.0, 'baseKm': 1.736, 'thicknessM': 527, 'band': 'low', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': 'ac', 'cover': 0.6, 'baseKm': 2.822, 'thicknessM': 1000, 'band': 'mid', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': None, 'cover': 0, 'baseKm': 10, 'band': 'high'}]),
        'RA4': dict(desc='높은 권운 박명(9 km, 60 %) — 표본별 지구 그림자(−3.0·−3.6° 에서 경계가 화면을 가로지름)', suns=['heda_-1', 'heda_-2.5', 'heda_-3', 'heda_-3.6'], macro=None,
                    layers=[{'genus': None, 'cover': 0, 'baseKm': 1.0, 'band': 'low'}, {'genus': None, 'cover': 0, 'baseKm': 4.5, 'band': 'mid'},
                            {'genus': 'ci', 'cover': 0.6, 'baseKm': 9.0, 'thicknessM': 800, 'band': 'high', 'opts': {'beamTransmittance': 1.0}}]),
        'RA5': dict(desc='가까운 sc 0.6(1.0~1.5 km, 30 km 안) + 해 쪽 먼 더 높은 ac 1.0(2.8~4.8 km, 40~200 km, ±40°) — 해가 떠 있을 때 먼 그늘(타당성 B2)',
                    suns=['heda_4', 'heda_1.1', 'heda_-1'], macro='RA5',
                    layers=[{'genus': 'sc', 'cover': 1.0, 'baseKm': RA5['nearBaseKm'], 'thicknessM': RA5['nearThickM'], 'band': 'low', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': 'ac', 'cover': 1.0, 'baseKm': RA5['farBaseKm'], 'thicknessM': RA5['farThickM'], 'band': 'mid', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': None, 'cover': 0, 'baseKm': 10, 'band': 'high'}]),
    }
    COV = {None: None, 'P3B': lambda sun_az: (lambda b, r, az: p3b_cover(b, r, az)),
           'RA3': lambda sun_az: (lambda b, r, az: ra3_cover(b, r, az, sun_az)), 'RA5': lambda sun_az: (lambda b, r, az: ra5_cover(b, r, az, sun_az))}
    thermo = out['scenes']['P3B']['job']['input'].get('thermo')
    def mk_unit(prefix, k, sk, v):
        s_ = ra[sk] if sk in ra else ENGINE_SUN['high'][sk]
        d = RA[k]
        inp = dict(HEDA, date=s_['iso'], layers=d['layers'], thermo=thermo, **view(s_['az'], v))
        if d['macro'] == 'P3B':
            inp['macroRef'] = dict(gen='P3B', params={}, sha256=sha_obj(macro_P3B()))
        elif d['macro'] in ('RA3', 'RA5'):
            inp['macroRef'] = dict(gen=d['macro'], params={'sun_az': s_['az']}, sha256=sha_obj(GEN[d['macro']]({'sun_az': s_['az']})))
        name = f'{prefix}{k}_{sk.replace("heda_", "s")}_{v}' if prefix else f'{k}_{sk.replace("heda_", "s")}_{v}'
        return dict(name=name, scene=k, sun=s_, view=v, input=inp, options=dict(macro=1 if d['macro'] else 0, macroN=256, maxRayKm=100), W=400, H=300)
    units = []
    for k, d in RA.items():
        for sk in d['suns']:
            for v in ['V1', 'V2']:
                u = mk_unit('', k, sk, v)
                u['geo'] = classify_unit(u, d['layers'], COV[d['macro']](u['sun']['az']) if d['macro'] else None)
                units.append(u)
    out['scenes']['RA'] = dict(role='R-A 긴 광선 기준(§4.3)', desc={k: v['desc'] for k, v in RA.items()}, units=units,
                               classify=dict(rule='화면 40×30 광선의 첫 구름 점마다: 해 쪽 층 안 경로 > 6.5 km(in), 다른 구름 경로 > 1 km(far), 층 기둥 안 그림자 경계(es); '
                                                  '또는 밝은 분율 0.1~0.9(경계가 화면을 가로지름, es); 분율 ≥ 0.25 면 변별, 가족 = far > es > in 우선', sec_march_km=SEC_MARCH_KM),
                               aa_units=['RA1_s1.1_V1', 'RA2_s-1_V1', 'RA5_s1.1_V1', 'RA4_s-3.6_V1'])
    hs = []
    for sk in ['heda_45', 'heda_30', 'heda_15', 'heda_12.1', 'heda_11.9']:
        for scen in ['RA1', 'RA3']:
            for v in ['V1', 'V2']:
                u = mk_unit('HS_', scen, sk, v)
                hs.append(u)
    out['scenes']['HS'] = dict(role='가드(높은 해 ≥ 12° 그대로 · 12° 이음매, §4.4) + REF 검증(45·30·15°)', units=hs)
    asu = []
    for sk in ['heda_-0.9', 'heda_-1.1', 'heda_-1.9', 'heda_-2.1']:
        for scen in ['RA3', 'RA4']:
            RA[scen]['suns'] = RA[scen]['suns']
            asu.append(mk_unit('AS_', scen, sk, 'V1'))
    out['scenes']['AS'] = dict(role='가드(아치 켜짐 이음매 −1°·−2°, §4.6b)', units=asu)
    # --- 비용 잡(§4.7): RULER-grain 의 C0 비용 잡 이름만(입력은 그 파일 그대로, sha 고정)
    gj = json.load(open(apath(SRC['GRAIN'])))
    out['scenes']['COST'] = dict(role='비용(§4.7) — RULER-grain jobs-grain.json 의 C0__*__cost 입력 + P1B·P2B·P3B',
                                 names=sorted(j['name'] for j in gj if j['name'].startswith('C0__') and j['name'].endswith('__cost')))
    json.dump(out, open(os.path.join(HERE, 'scenes-tsun.json'), 'w'), indent=1, ensure_ascii=False)
    fam = {}
    for u in units:
        fam.setdefault(u['geo']['family'], []).append((u['name'], u['geo']['disc']))
    print(json.dumps(out['checks']), 'scenes', list(out['scenes'].keys()), 'RA', len(units), 'HS', len(hs), 'AS', len(asu), 'COST', len(out['scenes']['COST']['names']))
    for u in units:
        print('  ', u['name'], json.dumps(u['geo']))


# ---------------------------------------------------------------- 팔(닫힌 목록, §1) — 모든 팔이 새 손잡이 전체를 냄(절차 #4)
KNOBS0 = dict(tsun=0, tsunN=128, tsunRangeKm=400, archLight=0, archNoT=0, tsunRef=0, tsunRefStepM=200)
ARMS = {
    'C0':   dict(KNOBS0, accurateSunBelowDeg=None),
    'C0ps': dict(KNOBS0, accurateSunBelowDeg=12),
    'T1':   dict(KNOBS0, accurateSunBelowDeg=12, tsun=1, tsunN=128),
    'T2':   dict(KNOBS0, accurateSunBelowDeg=12, tsun=1, tsunN=256),
    'T1A1': dict(KNOBS0, accurateSunBelowDeg=12, tsun=1, tsunN=128, archLight=1),
    'T1A2': dict(KNOBS0, accurateSunBelowDeg=12, tsun=1, tsunN=128, archLight=2),
    'H0':   dict(KNOBS0, accurateSunBelowDeg=12, tsun=1, tsunN=128, archLight=1, archNoT=1),   # 음성 대조: T_arch ≡ 1
    'REF':  dict(KNOBS0, accurateSunBelowDeg=90, tsunRef=1, shadowMinSunDeg=90),
    'REF100': dict(KNOBS0, accurateSunBelowDeg=90, tsunRef=1, tsunRefStepM=100, shadowMinSunDeg=90),
}
PHOTO_SCENES = ['P1B', 'P1Bh', 'P1CF', 'P1CFh', 'P1CE', 'P1CEh', 'P1A', 'P2B', 'P2A', 'P3B', 'P3A', 'tw1734', 'tw1746', 'DEV_A_t1734', 'DEV_A_t1746']
SIZE = {'P1': (1000, 750), 'P2': (390, 520), 'DEV': (390, 520), 'P3': (800, 600), 'tw': (390, 584), 'RA': (400, 300)}


def group_of(sc):
    return 'P1' if sc.startswith('P1') else 'P2' if sc.startswith('P2') else 'P3' if sc.startswith('P3') else 'DEV' if sc.startswith('DEV') else 'tw' if sc.startswith('tw') else 'RA'


def cmd_expand(outdir):
    S = json.load(open(os.path.join(HERE, 'scenes-tsun.json')))
    os.makedirs(outdir, exist_ok=True)
    groups = {}
    def materialize(inp):
        inp = copy.deepcopy(inp)
        ref = inp.pop('macroRef', None)
        inp.pop('date_critic', None)
        if ref:
            m = GEN[ref['gen']](ref['params'])
            assert sha_obj(m) == ref['sha256'], ('macro sha mismatch', ref['gen'])
            inp['macro'] = m
        return inp
    def add(page, grp, job):
        W, H = SIZE[grp]
        job['W'], job['H'] = W, H
        groups.setdefault((page, grp), []).append(job)
    for arm in ['C0', 'C0ps', 'T1', 'T2', 'T1A1', 'T1A2', 'H0']:
        for sc in PHOTO_SCENES:
            j = copy.deepcopy(S['scenes'][sc]['job']); j['input'] = materialize(j['input'])
            j['name'] = f'{arm}__{sc}'
            if S['scenes'][sc].get('exposureScale') is not None:
                j['exposureScale'] = S['scenes'][sc]['exposureScale']
            j['options'] = dict(j.get('options', {}), **ARMS[arm])
            add('A', group_of(sc), j)
        for grp in ['RA', 'HS', 'AS']:
            for u in S['scenes'][grp]['units']:
                add('A', 'RA', dict(name=f'{arm}__{u["name"]}', input=materialize(u['input']), frames=16, timedN=4, quality='low', res=0.5, out='both',
                                    options=dict(u['options'], flowCamCell=False, **ARMS[arm])))
    hs_ref = [u for u in S['scenes']['HS']['units'] if u['sun']['alt'] >= 14.9]   # REF 검증(타당성 M7): 45·30·15°
    for u in S['scenes']['RA']['units'] + hs_ref:
        add('A', 'RA', dict(name=f'REF__{u["name"]}', input=materialize(u['input']), frames=16, timedN=4, quality='low', res=0.5, out='both',
                            options=dict(u['options'], flowCamCell=False, **ARMS['REF'])))
    # 바닥(통계 #7·절차 #3·#5): 두 번째 페이지 B 에서 REF·C0ps A/A, REF 100 m, HS 한 단위 위상 시험
    aa = set(S['scenes']['RA']['aa_units'])
    for u in S['scenes']['RA']['units']:
        if u['name'] in aa:
            for arm in ['REF', 'C0ps', 'REF100']:
                add('B', 'RA', dict(name=f'{arm}__{u["name"]}', input=materialize(u['input']), frames=16, timedN=4, quality='low', res=0.5, out='both',
                                    options=dict(u['options'], flowCamCell=False, **ARMS[arm])))
    u = next(x for x in S['scenes']['HS']['units'] if x['name'] == 'HS_RA1_s30_V1')
    add('B', 'RA', dict(name=f'C0ps__{u["name"]}', input=materialize(u['input']), frames=16, timedN=4, quality='low', res=0.5, out='both',
                        options=dict(u['options'], flowCamCell=False, **ARMS['C0ps'])))
    for arm in ['C0', 'C0ps']:   # 사진 장면 A/A(여유 m_k, §4.2)
        for sc in ['P1B', 'P1Bh', 'P2B', 'P3B']:
            j = copy.deepcopy(S['scenes'][sc]['job']); j['input'] = materialize(j['input']); j['name'] = f'{arm}__{sc}'
            j['exposureScale'] = S['scenes'][sc]['exposureScale']; j['options'] = dict(j.get('options', {}), **ARMS[arm])
            add('B', group_of(sc), j)
    man = {'note': 'RULER-tsun 잡(페이지 A = 판정, B = A/A·바닥). 한 파일 = 한 페이지 = 한 크기. 잡마다 프레임 0 에서 시작(entry-tsun 이 리셋, §5.2).', 'files': {}}
    lines = ['#!/bin/sh', '# RULER-tsun 렌더 — RULER-grain 보정이 끝나 기계가 빈 뒤에만. entry-tsun 번들 = .harness/volsky-tsun/app.js(§5.2, sha 는 §10).',
             'set -e', 'R=${RUNNER:-tools/genus-ruler/tsun/run-tsun.js}', 'O=${OUT:-out/tsun}']
    for (page, grp), jobs in sorted(groups.items()):
        fn = f'jobs-tsun-{page}-{grp}.json'
        p = os.path.join(outdir, fn)
        json.dump(jobs, open(p, 'w'))
        W, H = SIZE[grp]
        man['files'][fn] = dict(n=len(jobs), W=W, H=H, page=page, sha256=sha_file(p), bytes=os.path.getsize(p))
        lines.append(f'VROOT=.harness/volsky-tsun nice -n 19 node "$R" {os.path.join(outdir, fn)} "$O/{page}/{grp}" {W} {H} gen')
    json.dump(man, open(os.path.join(outdir, 'jobs-manifest.json'), 'w'), indent=1, ensure_ascii=False)
    open(os.path.join(outdir, 'run-tsun.sh'), 'w').write('\n'.join(lines) + '\n')
    print(json.dumps(man['files'], indent=0))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'pin':
        cmd_pin()
    elif len(sys.argv) > 1 and sys.argv[1] == 'expand':
        if len(sys.argv) < 4 or sys.argv[2] != '--outdir':
            sys.exit('expand --outdir 폴더')
        cmd_expand(sys.argv[3])
    else:
        print(__doc__)
