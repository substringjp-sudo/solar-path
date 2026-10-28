#!/usr/bin/env python3
"""
RULER-tsun 장면·잡 (초안 2026-10-28).

  nice -n 19 python3 -I make-jobs-tsun.py pin      → scenes-tsun.json  (비평 잡 파일에서 장면 입력을 뽑아 고정 + B 고리 재생성 sha 대조)
  nice -n 19 python3 -I make-jobs-tsun.py expand [--out jobs-tsun.json]   → 하네스 잡(팔 × 장면), 큰 고리는 여기서 다시 만듦

B 장면(사진 맞춤)의 거시 고리(3 km 간격 120 km 까지 · 10 km 간격 380 km 까지 · 층마다 9319 점)는 크므로 scenes-tsun.json 에는
생성 매개변수 + 정규 JSON sha256 만 적고, 여기 dense_ring 이 비평 생성기(twphoto/rend/mkjobs.py · heda/rend2/mkjobs_h.py)와
같은 식으로 다시 만듭니다. pin 은 다시 만든 고리가 비평 잡 파일의 고리와 바이트 같은지(정규 sha) 확인합니다.
"""
import copy, hashlib, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/twphoto'
R_E = 6371.0
SRC = {
    'P1': SCR + '/rend/jobs-R1.json',            # 비평 P1 렌더(5ced8b1 번들, §173 고침 전) — t0x = 노출 ×45
    'P2': SCR + '/heda/rend2/jobs-P2-2.json',    # 헤다 P2(80f22a6 번들, §173 고침 후) — t0x = 노출 ×2.0
    'P3': SCR + '/heda/rend2/jobs-P3-2.json',    # 헤다 P3 — t0x = 노출 ×0.13
    'TW': os.path.join(os.path.dirname(HERE), 'flow', 'jobs-flow-guards.json'),   # RULER-twilight-hue 가드 장면(사도 합성)
    'DEV': SCR + '/heda/rend2/jobs-P2-1.json',   # 헤다 기기 시점(보고만)
}


def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


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
    """heda/rend2/mkjobs_h.py 판(fn(0,0,0,0) 로 가운데를 셈 — rend/mkjobs.py 판과 가운데 방위 인자만 다름)."""
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
# 서쪽 흐림 반사실(§4.5) — P1-B 의 빈 중층에 해 쪽 벽: 방위 240~305, 100~380 km, 운량 1.0, ns 밑면 2 km 두께 10 km(꼭대기 12 km) [estimate]
P1CF = dict(az=(240, 305), dist=(100, 380), cover=1.0, genus='ns', baseKm=2.0, thicknessM=10000)


def macro_P1B(shift):
    lo, hi = P1B['cuAz']; d0, d1 = P1B['cuDist']
    return {'low': dense_ring(lambda x, y, r, az: P1B['cuCover'] if (d0 <= r <= d1 and lo <= az <= hi) else 0.0, shift),
            'mid': dense_ring(lambda x, y, r, az: 0.0, shift),
            'high': dense_ring(lambda x, y, r, az: P1B['deckCover'] if inside(P1_DECK_POLY, x, y) else 0.0, shift)}


def macro_P1CF(shift=(0.0, 0.0)):
    m = macro_P1B(shift)
    a0, a1 = P1CF['az']; d0, d1 = P1CF['dist']
    m['mid'] = dense_ring(lambda x, y, r, az: P1CF['cover'] if (a0 <= az <= a1 and d0 <= r <= d1) else 0.0, shift)
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


def macro_P3B():
    w0, w1 = P3B['westSector']; d0, d1 = P3B['scDist']
    def low(x, y, r, az):
        if not (w0 <= az <= w1): return 0.2 if r > 20 else 0.0
        return P3B['scCover'] if d0 <= r <= d1 else 0.0
    def mid(x, y, r, az):
        if not (w0 <= az <= w1): return P3B['acCover'] if r <= 80 else 0.4
        return P3B['acCover'] if r <= P3B['acEdgeKm'] else 0.0
    return {'low': dense_ring_heda(low), 'mid': dense_ring_heda(mid), 'high': dense_ring_heda(lambda *a: 0.0)}


# R-A 합성 장면 고리(§4.3)
def macro_RA3(sun_az):
    def low(x, y, r, az):
        d = (az - sun_az + 180) % 360 - 180
        return 1.0 if (abs(d) <= 40 and 40 <= r <= 150) else 0.0
    def mid(x, y, r, az):
        return 0.6 if r <= 30 else 0.0
    return {'low': dense_ring_heda(low), 'mid': dense_ring_heda(mid), 'high': dense_ring_heda(lambda *a: 0.0)}


GEN = {'P1B': lambda p: macro_P1B(tuple(p.get('shift_km', (0.0, 0.0)))), 'P1CF': lambda p: macro_P1CF(tuple(p.get('shift_km', (0.0, 0.0)))),
       'P2B': lambda p: macro_P2B(), 'P3B': lambda p: macro_P3B(), 'RA3': lambda p: macro_RA3(p['sun_az'])}


def pick(path, name):
    for j in json.load(open(path)):
        if j['name'] == name:
            return j
    raise KeyError(name)


def strip_macro(job, gen=None, params=None):
    j = copy.deepcopy(job)
    if 'macro' in j['input']:
        m = j['input'].pop('macro')
        j['input']['macroRef'] = dict(gen=gen, params=params, sha256=sha_obj(m), n_points={k: len(v) for k, v in m.items()}) if gen else None
        if not gen:
            j['input']['macro'] = m   # 작은 고리(예보 A 장면 91 점)는 그대로 둠
    return j


ENGINE_SUN = json.load(open(os.path.join(HERE, 'sun-tsun.json'))) if os.path.exists(os.path.join(HERE, 'sun-tsun.json')) else None
HEDA = dict(lat=34.97342, lon=138.77713, heightM=2.74)


def cmd_pin():
    out = {'note': 'RULER-tsun 장면(초안). 판정 장면 = B(사진 맞춤), A(예보)는 보고·배치 점검. 사진은 저장소 밖(tsun-photo.json 의 sha256).',
           'sources': {k: dict(path=v, sha256=sha_file(v)) for k, v in SRC.items() if os.path.exists(v)},
           'engine_sun': ENGINE_SUN, 'cams': {}, 'scenes': {}, 'checks': {}}
    out['cams'] = {'P1': dict(az=275.301, el=8.452, fov=58.285, W=1000, H=750, roll=0.0),
                   'P2': dict(az=269.812, el=6.094, fov=28.161, W=390, H=520, roll=0.0),
                   'P3': dict(az=263.142, el=5.541, fov=12.879, W=800, H=600, roll=0.0)}
    # --- P1
    jB = pick(SRC['P1'], 'P1_B_t0x_obs_r100'); jA = pick(SRC['P1'], 'P1_A_t0x_obs_r100')
    m_crit = jB['input']['macro']
    m_pre = macro_P1B((0.0, 20.34)); m_post = macro_P1B((0.0, 0.0))
    out['checks']['P1B_preshift_regen_equals_critic'] = sha_obj(m_pre) == sha_obj(m_crit)
    s = strip_macro(jB, 'P1B', {'shift_km': [0.0, 0.0]})
    s['input']['macroRef']['sha256'] = sha_obj(m_post)
    s['input']['macroRef']['critic_preshift_sha256'] = sha_obj(m_crit)
    s['input']['macroRef']['note'] = ('비평 잡의 고리는 §173 버그를 상쇄하려고 북쪽 20.34 km 미리 밀었음(rend/mkjobs.py MACRO_SHIFT). §173 고친 번들에서는 '
                                      '밀지 않은 고리(shift 0)를 씀 — 이 sha. 미리 민 원본 sha 는 critic_preshift_sha256.')
    s['input']['date'] = '2026-10-02T09:22:21.793Z'   # 사진 EXIF 시각(비평 잡 09:22:21Z 보다 0.79 s 뒤, 해 −9.8423 vs −9.8396)
    s['input']['date_critic'] = jB['input']['date']
    out['scenes']['P1B'] = dict(role='판정(R-B-deep D1~D5)', exposureScale=jB.get('exposureScale'), job=s, src=dict(file=SRC['P1'], name=jB['name']), params=P1B,
                                edge_en_km=P1_EDGE)
    cf = copy.deepcopy(s)
    cf['input']['layers'] = [L if L.get('band') != 'mid' else {'genus': P1CF['genus'], 'cover': P1CF['cover'], 'baseKm': P1CF['baseKm'],
                                                               'thicknessM': P1CF['thicknessM'], 'band': 'mid', 'opts': {'beamTransmittance': 0.0}}
                             for L in cf['input']['layers']]
    cf['input']['macroRef'] = dict(gen='P1CF', params={'shift_km': [0.0, 0.0]}, sha256=sha_obj(macro_P1CF()))
    out['scenes']['P1CF'] = dict(role='가드(서쪽 흐림 반사실, §4.5)', exposureScale=jB.get('exposureScale'), job=cf, params=P1CF)
    sA = strip_macro(jA)
    out['scenes']['P1A'] = dict(role='보고(예보 장면, 덮개 없음)', exposureScale=jA.get('exposureScale'), job=sA, src=dict(file=SRC['P1'], name=jA['name']),
                                note='scene-P1-forecast.json(§175 전 liveScene, SunCalc). 해 −9.84 라 빔·τ 영향 없음 [estimate].')
    # --- P2·P3
    for pid, gen, fn in [('P2', 'P2B', macro_P2B), ('P3', 'P3B', macro_P3B)]:
        jB = pick(SRC[pid], f'{pid}_B_t0x_obs_r100'); jA = pick(SRC[pid], f'{pid}_A_t0x_obs_r100')
        m = fn()
        out['checks'][f'{gen}_regen_equals_critic'] = sha_obj(m) == sha_obj(jB['input']['macro'])
        out['scenes'][gen] = dict(role='판정(R-B-deep E5~E8)' if pid == 'P2' else '판정(R-C C1~C5)', exposureScale=jB.get('exposureScale'),
                                  job=strip_macro(jB, gen, {}), src=dict(file=SRC[pid], name=jB['name']), params=P2B if pid == 'P2' else P3B)
        out['scenes'][f'{pid}A'] = dict(role='배치 점검·보고(E1~E4)' if pid == 'P2' else '보고', exposureScale=jA.get('exposureScale'),
                                        job=strip_macro(jA), src=dict(file=SRC[pid], name=jA['name']),
                                        note='heda/rend2/scenes/forecast-scenes.json(80f22a6 liveScene = §175 전, SunCalc 빔·τ). P3 은 해 +1.1 이라 빔·τ 가 §175 뒤 달라질 수 있음 — 재측정 때 HEAD liveScene 으로 다시 만들지 말 것(고정), 차이는 보고만.')
    # --- 박명 색 가드(사도 합성) · 기기 시점(헤다, 보고)
    for n in ['C0_tw1734', 'C0_tw1746']:
        out['scenes'][n.replace('C0_', '')] = dict(role='가드(RULER-twilight-hue H1)', job=pick(SRC['TW'], n), src=dict(file=SRC['TW'], name=n))
    for n in ['DEV_A_t1734_obs_r100', 'DEV_A_t1746_obs_r100']:
        out['scenes'][n.replace('_obs_r100', '')] = dict(role='보고(헤다 기기 시점 박명 색)', job=strip_macro(pick(SRC['DEV'], n)), src=dict(file=SRC['DEV'], name=n))
    # --- R-A 합성 장면(§4.3) · 높은 해 가드(§4.4)
    ra = ENGINE_SUN['ra'] if ENGINE_SUN else {}
    def view(sun_az, kind):
        return dict(az=round(sun_az, 3), el=4.0, fov=30.0) if kind == 'V1' else dict(az=round((sun_az + 90) % 360, 3), el=25.0, fov=60.0)
    RA = {
        'RA1': dict(desc='균일 ac 덮개(층 안 스치는 광학두께)', suns=['heda_8', 'heda_4', 'heda_1.1'], macro=None,
                    layers=[{'genus': None, 'cover': 0, 'baseKm': 1.0, 'band': 'low'},
                            {'genus': 'ac', 'cover': 0.85, 'baseKm': 2.822, 'thicknessM': 1000, 'band': 'mid', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': None, 'cover': 0, 'baseKm': 10, 'band': 'high'}]),
        'RA2': dict(desc='P3-B 장면(가까운 덮개 + 먼 해 쪽 층적운)', suns=['heda_4', 'heda_1.1', 'heda_-1'], macro='P3B',
                    layers=out['scenes']['P3B']['job']['input']['layers']),
        'RA3': dict(desc='해 쪽 먼 둑(40~150 km, 운량 1) + 머리 위 ac 조각(30 km 안)', suns=['heda_4', 'heda_1.1', 'heda_-1', 'heda_-2.5'], macro='RA3',
                    layers=[{'genus': 'sc', 'cover': 1.0, 'baseKm': 1.736, 'thicknessM': 527, 'band': 'low', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': 'ac', 'cover': 0.6, 'baseKm': 2.822, 'thicknessM': 1000, 'band': 'mid', 'opts': {'beamTransmittance': 1.0}},
                            {'genus': None, 'cover': 0, 'baseKm': 10, 'band': 'high'}]),
        'RA4': dict(desc='높은 권운 박명(9 km, 60 %) — 표본별 지구 그림자', suns=['heda_-1', 'heda_-2.5', 'heda_-4'], macro=None,
                    layers=[{'genus': None, 'cover': 0, 'baseKm': 1.0, 'band': 'low'}, {'genus': None, 'cover': 0, 'baseKm': 4.5, 'band': 'mid'},
                            {'genus': 'ci', 'cover': 0.6, 'baseKm': 9.0, 'thicknessM': 800, 'band': 'high', 'opts': {'beamTransmittance': 1.0}}]),
    }
    thermo = out['scenes']['P3B']['job']['input'].get('thermo')
    units = []
    for k, d in RA.items():
        for sk in d['suns']:
            s_ = ra.get(sk)
            for v in ['V1', 'V2']:
                inp = dict(HEDA, date=s_['iso'] if s_ else None, layers=d['layers'], thermo=thermo, **view(s_['az'] if s_ else 0, v))
                mref = None
                if d['macro'] == 'P3B':
                    mref = dict(gen='P3B', params={}, sha256=sha_obj(macro_P3B()))
                elif d['macro'] == 'RA3':
                    mref = dict(gen='RA3', params={'sun_az': s_['az']}, sha256=sha_obj(macro_RA3(s_['az'])))
                if mref:
                    inp['macroRef'] = mref
                units.append(dict(name=f'{k}_{sk.replace("heda_", "s")}_{v}', scene=k, sun=s_, view=v, input=inp,
                                  options=dict(macro=1 if mref else 0, macroN=256, maxRayKm=100), W=400, H=300))
    out['scenes']['RA'] = dict(role='R-A 긴 광선 기준(§4.3)', desc={k: v['desc'] for k, v in RA.items()}, units=units)
    hs = []
    for sk in ['heda_45', 'heda_30', 'heda_15', 'heda_12.1', 'heda_11.9']:
        s_ = (ENGINE_SUN or {}).get('high', {}).get(sk) or ra.get(sk)
        for scen in ['RA1', 'RA3']:
            for v in ['V1', 'V2']:
                inp = dict(HEDA, date=s_['iso'] if s_ else None, layers=RA[scen]['layers'], thermo=thermo, **view(s_['az'] if s_ else 0, v))
                if scen == 'RA3':
                    inp['macroRef'] = dict(gen='RA3', params={'sun_az': s_['az']}, sha256=sha_obj(macro_RA3(s_['az'])))
                hs.append(dict(name=f'HS_{scen}_{sk.replace("heda_", "s")}_{v}', scene=scen, sun=s_, view=v, input=inp,
                               options=dict(macro=1 if scen == 'RA3' else 0, macroN=256, maxRayKm=100), W=400, H=300))
    out['scenes']['HS'] = dict(role='가드(높은 해 ≥ 12° 그대로 · 12° 이음매, §4.4)', units=hs)
    json.dump(out, open(os.path.join(HERE, 'scenes-tsun.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(out['checks']), 'scenes', list(out['scenes'].keys()), 'RA units', len(units), 'HS units', len(hs))


# ---------------------------------------------------------------- 팔(닫힌 목록, §1) — 옵션 이름은 구현 때 확정, 매핑은 §11 에만 적음
ARMS = {
    'C0':   dict(accurateSunBelowDeg=None),                          # 앱 오늘(관측점 기둥 빛)
    'C0ps': dict(accurateSunBelowDeg=12),                            # 분해용: 12° 아래 표본별 빛만(후보 아님)
    'T1':   dict(accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunRangeKm=400),
    'T2':   dict(accurateSunBelowDeg=12, tsun=1, tsunN=256, tsunRangeKm=400),
    'T1A1': dict(accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunRangeKm=400, archLight=1),   # 아치 빛: 해 쪽 반구 등방 가중
    'T1A2': dict(accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunRangeKm=400, archLight=2),   # 아치 빛: 구름 위상 가중
    'REF':  dict(accurateSunBelowDeg=90, tsunRef=1, shadowMinSunDeg=90),                     # R-A 기준(긴 해 행진, 그림자 지도 없음)
}


def cmd_expand(outp):
    S = json.load(open(os.path.join(HERE, 'scenes-tsun.json')))
    jobs = []
    def materialize(inp):
        inp = copy.deepcopy(inp)
        ref = inp.pop('macroRef', None)
        for k in ['date_critic']:
            inp.pop(k, None)
        if ref:
            m = GEN[ref['gen']](ref['params'])
            assert sha_obj(m) == ref['sha256'], ('macro sha mismatch', ref['gen'])
            inp['macro'] = m
        return inp
    photo_scenes = ['P1B', 'P1CF', 'P1A', 'P2B', 'P2A', 'P3B', 'P3A']
    for arm in ['C0', 'C0ps', 'T1', 'T2', 'T1A1', 'T1A2']:
        for sc in photo_scenes + ['tw1734', 'tw1746', 'DEV_A_t1734', 'DEV_A_t1746']:
            j = copy.deepcopy(S['scenes'][sc]['job']); j['input'] = materialize(j['input'])
            j['name'] = f'{arm}__{sc}'
            j.setdefault('options', {}).update({k: v for k, v in ARMS[arm].items() if v is not None or k == 'accurateSunBelowDeg'})
            jobs.append(j)
        for grp in ['RA', 'HS']:
            for u in S['scenes'][grp]['units']:
                jobs.append(dict(name=f'{arm}__{u["name"]}', input=materialize(u['input']), frames=16, timedN=4, quality='low', res=0.5, out='both',
                                 options=dict(u['options'], flowCamCell=False, **ARMS[arm])))
    for u in S['scenes']['RA']['units']:
        jobs.append(dict(name=f'REF__{u["name"]}', input=materialize(u['input']), frames=8, timedN=4, quality='low', res=0.5, out='both',
                         options=dict(u['options'], flowCamCell=False, **ARMS['REF'])))
    json.dump(jobs, open(outp, 'w'))
    print(len(jobs), 'jobs →', outp)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'pin':
        cmd_pin()
    elif len(sys.argv) > 1 and sys.argv[1] == 'expand':
        cmd_expand(sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == '--out' else os.path.join(HERE, 'jobs-tsun.json'))
    else:
        print(__doc__)
