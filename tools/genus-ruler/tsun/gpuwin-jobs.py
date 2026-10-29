#!/usr/bin/env python3
"""
§180 GPU 창 잡 목록 — RULER-grain C0 가 끝난 뒤 한 번에 돌 GPU 창(gpu-window.sh)의 run-tsun 잡 파일과 §178 렌더 확인 장면을 만듭니다.
**렌더하지 않음**(파일만 씀). 판정 회차 없음 — 후보 손잡이(T·아치)는 사진 장면(P1B·P2B·P3B 등)에 걸지 않고 합성 단위(RA·HS·grain 비용 입력)에만
(2026-10-28 사용자 결정: 사진은 후보 손잡이에 보이지 않게).

  nice -n 19 python3 -I -B tools/genus-ruler/tsun/gpuwin-jobs.py --outdir DIR   (-B: 동결 파일 옆에 __pycache__ 를 남기지 않음 — §180 검토 13)

읽기만: scenes-tsun.json · make-jobs-tsun.py(동결 후보 — 모듈로 불러 고리 재생성 GEN·sha_obj 만 씀, 고치지 않음) · ../grain/jobs-grain.json(비용 입력).
팔은 설계 v2.1 §5.1 그대로(새 손잡이 9 개를 모든 잡에 명시 — ruler-delta A1). 동결 확장기(make-jobs-tsun expand)의 ARMS 는 옛 T1A1/T1A2 와
손잡이 7 개라 entry-tsun 이 거부하므로 쓰지 않음(§179.7 'A1/E8 갱신' 전까지).

출력(DIR):
  b1-low.json · b1-medium.json · b1-high.json   B1 컴파일·링크(모든 팔 × 진단 0·1, 품질마다 한 페이지 — 품질 섞기 거부, ruler-delta F4)
  b1-refuse.json                                 B1 진단 2~7 = 구현 안 됨(TSUN_IMPLEMENTED) → 잡마다 거부(error.txt)가 기대값
  b1-det.json                                    B1 아틀라스 결정성(E2): 같은 T1 잡 둘 → 같은 아틀라스 sha
  w7-emu.json                                    WP7-P3 합성 덮개(RA1)의 C0ps 그림(T1 그림은 b2-t 의 것과 짝)
  b0-time.json                                   B0 REF·REF100 시간(프레임마다 그리기 시간 → 가위 대체 경로 > 10 s 판단, 감시 시간 배율)
  b0-cost.json · b0-costaa-1.json · b0-costaa-2.json   B0 비용(390×584, grain 비용 입력) · 비용 A/A(E2)
  b0-floor.json                                  B0 바닥 페이지(B): C0ps·REF A/A 단위 + REF 진단(Floor_T)
  b0-floor-ref100.json                           B0 바닥 REF100 쪽(같은 단위의 REF100 진단·그림 — §180 검토 2: REF100 감시 시간·막힘이 따로라 따로 된 페이지)
  b2-t.json                                      B2 R-A_T 후보 쪽: T1·T2 그림 + 진단(34 RA 단위)
  b2-ref.json                                    B2 REF_v2 진단 + 그림(34 RA, 바닥 단위 먼저)
  b2-refval.json                                 B2 REF 검증 (i): REF_val × HS 45·30·15° 12 + C0 12
  light-scenes.json                              §178 렌더 확인 장면(P1B 입력 + 합성 장면) — lighting-render-check.js 가 읽음
  manifest.json                                  파일마다 잡 수·캔버스·sha256·종류별 수(시간 어림용 — gpuwin-lib.js estimate)
"""
import copy, hashlib, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

# ── 동결 후보 확장기를 모듈로(읽기만) — 고리 재생성(GEN)·정규 sha(sha_obj)를 그대로 써서 장면 입력이 동결 확장기와 같은 바이트가 되게
_spec = importlib.util.spec_from_file_location('make_jobs_tsun', os.path.join(HERE, 'make-jobs-tsun.py'))
MJ = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(MJ)

# ── 설계 v2.1 §5.1 팔(새 손잡이 9 개 모두 명시). tsunSync: T 팔 true(하네스 동기 구축), 나머지 false(끔 값).
# §180 검토 11: §178 앱 조명 고침 둘(clampInscatter·irradianceLogMu)도 모든 T_sun 잡에 끔(F6 기준선)으로 명시 — 기본값과 같지만 '모든 손잡이 명시'.
K0 = dict(tsun=0, tsunN=128, tsunRangeKm=400, archLight=0, archNoT=0, tsunRef=0, tsunRefStepM=200, tsunDebug=0, tsunSync=False,
          clampInscatter=False, irradianceLogMu=False)
ARMS = {
    'C0': dict(K0, accurateSunBelowDeg=None),
    'C0ps': dict(K0, accurateSunBelowDeg=12),
    'T1': dict(K0, accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunSync=True),
    'T2': dict(K0, accurateSunBelowDeg=12, tsun=1, tsunN=256, tsunSync=True),
    'T1A': dict(K0, accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunSync=True, archLight=1),
    'H0': dict(K0, accurateSunBelowDeg=12, tsun=1, tsunN=128, tsunSync=True, archLight=1, archNoT=1),   # 음성 대조(T_arch ≡ 1)
    'REF': dict(K0, accurateSunBelowDeg=90, shadowMinSunDeg=90, tsunRef=1),
    'REF100': dict(K0, accurateSunBelowDeg=90, shadowMinSunDeg=90, tsunRef=1, tsunRefStepM=100),
    'REFval': dict(K0, accurateSunBelowDeg=90, shadowMinSunDeg=90, tsunRef=2),
}
T_ARMS = ['T1', 'T2', 'T1A', 'H0']
REF_ARMS = ['REF', 'REF100', 'REFval']
# 이 묶음에 셰이더가 있는 진단(cloudTsun.ts TSUN_IMPLEMENTED.tsunDebug = [0, 1]) — 2~7 은 setOptions 가 throw(빈 팔 방지)가 기대값
DEBUG_IMPLEMENTED = [0, 1]
DEBUG_REFUSED = [2, 3, 4, 5, 6, 7]
RA_WH = (400, 300)
COST_WH = (390, 584)


def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def kind_of(job):
    """시간 어림용 잡 종류(gpuwin-lib.js EST 표의 열쇠)."""
    o = job['options']
    if job.get('grain'):
        return 'cost'
    dbg = o.get('tsunDebug', 0)
    if o.get('tsunRef'):
        base = 'ref100' if o.get('tsunRefStepM', 200) <= 100 else 'ref'
        return base + ('_dbg' if dbg else '') + ('_f1' if job.get('frames') == 1 else '')
    if o.get('tsun'):
        return 't' + ('_dbg' if dbg else '') + ('_f1' if job.get('frames') == 1 else '')
    return 'img' + ('_f1' if job.get('frames') == 1 else '')


def arm_options(base_options, arm, dbg=0):
    o = dict(base_options, **ARMS[arm])
    o['tsunDebug'] = dbg
    return o


def main(outdir):
    S = json.load(open(os.path.join(HERE, 'scenes-tsun.json')))
    os.makedirs(outdir, exist_ok=True)

    def materialize(inp):
        # make-jobs-tsun.py cmd_expand.materialize 와 같은 식(그 함수는 cmd_expand 안의 닫힘이라 여기 옮김 — 고리 sha 대조 포함)
        inp = copy.deepcopy(inp)
        ref = inp.pop('macroRef', None)
        inp.pop('date_critic', None)
        if ref:
            m = MJ.GEN[ref['gen']](ref['params'])
            assert MJ.sha_obj(m) == ref['sha256'], ('macro sha mismatch', ref['gen'])
            inp['macro'] = m
        return inp

    units = {u['name']: u for g in ('RA', 'HS', 'AS') for u in S['scenes'][g]['units']}
    ra_names = [u['name'] for u in S['scenes']['RA']['units']]
    aa = list(S['scenes']['RA']['aa_units'])
    hs_ref = [u['name'] for u in S['scenes']['HS']['units'] if u['sun']['alt'] >= 14.9]   # 45·30·15° (REF 검증 (i), 타당성 M7)
    assert len(ra_names) == 34 and len(aa) == 4 and len(hs_ref) == 12, (len(ra_names), len(aa), len(hs_ref))

    def unit_job(prefix, arm, unit, dbg=0, frames=None, quality='low', note=None):
        u = units[unit]
        frames = frames if frames is not None else (4 if dbg else 16)
        name = (prefix + '__' if prefix else '') + f'{arm}__{unit}' + (f'__dbg{dbg}' if dbg else '')
        j = dict(name=name, input=materialize(u['input']), frames=frames, timedN=min(4, frames), quality=quality, res=0.5,
                 out='both', options=arm_options(dict(u['options'], flowCamCell=False), arm, dbg), W=RA_WH[0], H=RA_WH[1],
                 arm=arm, unit=unit)
        if note:
            j['note'] = note
        return j

    files = {}

    # ── B1 컴파일·링크(품질마다 한 페이지). 해 1.1°(T 글자 들어감) 단위 + 해 30°(T 글자 없음 = C0ps 글자, F1/U4g) 단위.
    B1_LOW_SUN = 'RA1_s1.1_V1'
    B1_HIGH_SUN = 'HS_RA1_s30_V1'
    for q in ('low', 'medium', 'high'):
        p = 'B1' + q[0]
        js = []
        for arm in ['C0', 'C0ps'] + T_ARMS + REF_ARMS:
            js.append(unit_job(p, arm, B1_LOW_SUN, 0, frames=1, quality=q, note='B1 compile/link'))
        for arm in T_ARMS + REF_ARMS:
            js.append(unit_job(p, arm, B1_LOW_SUN, 1, frames=1, quality=q, note='B1 compile/link debug 1'))
        for arm in ['C0ps', 'T1', 'T1A', 'REF']:
            js.append(unit_job(p, arm, B1_HIGH_SUN, 0, frames=1, quality=q, note='B1 sun > 12: T text must equal C0ps text (F1, U4g)'))
        files[f'b1-{q}.json'] = js
    files['b1-refuse.json'] = [unit_job('B1r', 'T1A' if k <= 5 else 'T1', B1_LOW_SUN, k, frames=1, note=f'expect refusal: tsunDebug {k} not implemented')
                               for k in DEBUG_REFUSED]
    files['b1-det.json'] = [unit_job('B1da', 'T1', 'RA3_s1.1_V1', 0, frames=1, note='atlas determinism a'),
                            unit_job('B1db', 'T1', 'RA3_s1.1_V1', 0, frames=1, note='atlas determinism b')]

    # ── WP7-P3 합성 덮개 대조: RA1(균일 ac 덮개) C0ps 그림 — 같은 단위의 T1 그림·진단은 b2-t.json 에서
    files['w7-emu.json'] = [unit_job('', 'C0ps', u, 0) for u in ra_names if u.startswith('RA1_')]

    # ── B0 시간: REF·REF100 한 단위(RA1_s1.1_V1 — ruler-delta E2 의 시간 단위), 페이지 첫 잡 = REF(첫 프레임에 컴파일)
    files['b0-time.json'] = [unit_job('', 'REF', 'RA1_s1.1_V1', 0, note='B0 REF timing'), unit_job('', 'REF100', 'RA1_s1.1_V1', 0, note='B0 REF100 timing')]

    # ── B0 비용: grain 비용 입력(C0__*__cost, 합성 층 — 사진 아님). T 팔은 해 < 12° 단위만(그 위는 글자가 C0ps 와 같아 비율 1 — T1 만 전체로 확인)
    G = {j['name']: j for j in json.load(open(os.path.join(REPO, 'tools/genus-ruler/grain/jobs-grain.json')))}
    cost_names = [n for n in S['scenes']['COST']['names'] if n.startswith('C0__')]
    assert len(cost_names) == 36, len(cost_names)

    def cost_job(prefix, arm, gname):
        g = G[gname]
        assert g['grain']['mode'] == 'cost' and tuple(g['canvas']) == COST_WH, gname
        rest = gname[len('C0__'):]
        j = {k: copy.deepcopy(v) for k, v in g.items() if k in ('set', 'round', 'layer', 'time', 'az', 'frame', 'canvas', 'quality', 'res', 'input')}
        j['name'] = (prefix + '__' if prefix else '') + f'{arm}__{rest}'
        j['arm'] = arm
        j['grain'] = {'mode': 'cost', 'frames': int(g['grain'].get('frames', 16))}
        j['options'] = arm_options({}, arm, 0)
        return j

    below = [n for n in cost_names if n.split('__')[1].split('_')[1] not in ('e20', 'e45')]
    assert len(below) == 23, len(below)
    files['b0-cost.json'] = ([cost_job('', 'C0ps', n) for n in cost_names] + [cost_job('', 'T1', n) for n in cost_names]
                             + [cost_job('', 'T2', n) for n in below] + [cost_job('', 'T1A', n) for n in below])
    files['b0-costaa-1.json'] = [cost_job('AA', 'C0', 'C0__cu35_e5__s__dev__cost')]
    files['b0-costaa-2.json'] = [cost_job('AA', 'C0', 'C0__cu35_e5__s__dev__cost')]

    # ── B0 바닥 페이지 B(동결 확장기의 page B RA 와 같은 단위·팔 + 진단 바닥): 싼 것 먼저. §180 검토 2: REF100 은 따로 된 파일(감시 시간 배율·막힘이
    # REF 와 따로 — gpu-window.sh B0floor100 단계, 같은 출력 폴더 B0-floor)
    fl = [unit_job('', 'C0ps', u, 0) for u in aa] + [unit_job('', 'C0ps', 'HS_RA1_s30_V1', 0, note='HS phase test (page B)')]
    fl += [unit_job('', 'REF', u, 1) for u in aa] + [unit_job('', 'REF', u, 0) for u in aa]
    files['b0-floor.json'] = fl
    files['b0-floor-ref100.json'] = [unit_job('', 'REF100', u, 1) for u in aa] + [unit_job('', 'REF100', u, 0) for u in aa]

    # ── B2: R-A_T 후보 쪽(싼 것) · REF_v2(바닥 단위 먼저, 단위마다 진단 → 그림) · REF 검증
    files['b2-t.json'] = [unit_job('', arm, u, d) for u in ra_names for arm in ('T1', 'T2') for d in (0, 1)]
    order = aa + [u for u in ra_names if u not in aa]
    files['b2-ref.json'] = [unit_job('', 'REF', u, d) for u in order for d in (1, 0)]
    files['b2-refval.json'] = [unit_job('', 'REFval', u, 0) for u in hs_ref] + [unit_job('', 'C0', u, 0) for u in hs_ref]

    # ── 감시 시간(watchdogMin, run-tsun-lib watchdogMs 가 잡 값을 먼저 씀): 잡마다 새 프로그램을 컴파일하는 B1 은 품질별 고정값.
    # §180 검토 3: 페이지(덩어리)마다 프로그램을 새로 컴파일하므로 컴파일 여유(8 분 × 품질 배율)를 **모든** 잡에(예전: 파일 안 종류의 첫 잡만 —
    # 둘째 덩어리의 첫 T2·진단 잡이 2 분 감시 시간에 걸려 영영 건너뛰어졌음). 값 = max(기본, 8 × 품질 배율). 비용: 덩어리 끝 8 분은 새 잡을 받지 않음.
    # §180 검토 2: REF100 은 기본 50 분이면 대기 생성(7.5~12 분, c0.log) 뒤 55 분 덩어리에 영영 못 들어감 → 그림 30 분 · 진단 16 분으로 명시
    # (30 분을 넘는 REF100 은 어차피 한 그리기 > 10 s — 감시 시간에 걸리면 decide-b0 가 '너무 느림'으로 적음).
    # B0 시간 뒤 REF 파일은 --watchdog-scale(≥ 1 — 줄이지 않음, decideB0)로만 늘림.
    # B1(잡마다 새 프로그램 + 1 프레임): REF 팔은 품질별 10·15·25 분, 그 밖 팔은 8·12·16 분(§180 검토 6: B1-high 가 어림 높은 끝을 차지 — 25 분 고정 감시 시간이
    # 덩어리 끝 25 분을 비워 둠. T 팔 high 1 프레임 = 컴파일 2~5 분 + 1 분 미만 [estimate] 이라 16 분이면 세 배 넘는 여유).
    B1_WD = {'low': 10, 'medium': 15, 'high': 25}
    B1_WD_NONREF = {'low': 8, 'medium': 12, 'high': 16}
    QMUL = {'low': 1, 'medium': 1.5, 'high': 2}
    REF100_WD = {'image': 30, 'debug': 16}

    def default_wd(j):
        o = j['options']
        W, H = (j['canvas'] if j.get('canvas') else (j['W'], j['H']))
        if o.get('tsunRef') and o.get('tsunRefStepM', 200) <= 100:
            return REF100_WD['debug' if o.get('tsunDebug') else 'image']
        if o.get('tsunRef') and o.get('tsunDebug'):
            return 8 * max(1, 200 / max(1, o.get('tsunRefStepM', 200)))
        if o.get('tsunRef'):
            return 25
        return 2 * max(1, W * H / (400 * 300))

    for fn, js in files.items():
        for j in js:
            if fn.startswith('b1-'):
                j['watchdogMin'] = (B1_WD if j['options'].get('tsunRef') else B1_WD_NONREF)[j.get('quality', 'low')]
            else:
                j['watchdogMin'] = max(default_wd(j), 8 * QMUL[j.get('quality', 'low')])

    # ── 점검: 이름 겹침(파일 안·출력 폴더를 같이 쓰는 파일 사이) · 품질 섞기 · 캔버스
    shared_out = {'B2': ['b2-t.json', 'b2-ref.json', 'b2-refval.json']}
    for grp, fns in shared_out.items():
        seen = {}
        for fn in fns:
            for j in files[fn]:
                assert j['name'] not in seen, ('duplicate name across ' + grp, j['name'], seen.get(j['name']), fn)
                seen[j['name']] = fn
    for fn, js in files.items():
        names = [j['name'] for j in js]
        assert len(names) == len(set(names)), ('duplicate name', fn)
        assert len({j.get('quality', 'low') for j in js}) == 1, ('mixed quality', fn)
        for j in js:
            assert all(k in j['options'] for k in K0), ('knob missing', j['name'])

    man = {'note': '§180 GPU 창 잡(gpuwin-jobs.py). 판정 회차 없음 — 후보 손잡이는 합성 단위에만. 한 파일 = 한 페이지 = 한 품질·크기.', 'files': {}}
    for fn, js in files.items():
        p = os.path.join(outdir, fn)
        with open(p, 'w') as f:
            json.dump(js, f)
        W, H = (js[0]['canvas'] if js[0].get('canvas') else (js[0]['W'], js[0]['H']))
        kinds = {}
        for j in js:
            k = kind_of(j)
            kinds[k] = kinds.get(k, 0) + 1
        # §180 검토 6: 시간 어림(gpuwin-lib simulateFile)이 run-tsun 받아들임 규칙을 잡마다 흉내 내도록 가벼운 목록(130 MB 잡 파일을 다시 읽지 않게)
        sim = []
        for j in js:
            o = j['options']
            jw, jh = (j['canvas'] if j.get('canvas') else (j['W'], j['H']))
            cls = [o.get('accurateSunBelowDeg'), o.get('shadowMinSunDeg'), o.get('tsun'), o.get('tsunN'), o.get('archLight'), o.get('archNoT'),
                   o.get('tsunRef'), o.get('tsunRefStepM'), o.get('tsunDebug'), bool(j.get('grain'))]
            sim.append(dict(n=j['name'], k=kind_of(j), c=json.dumps(cls), q=j.get('quality', 'low'), W=jw, H=jh, g=bool(j.get('grain')), wd=j.get('watchdogMin'),
                            o={k: o.get(k) for k in ('tsunRef', 'tsunDebug', 'tsunRefStepM')}))
        man['files'][fn] = dict(n=len(js), W=W, H=H, quality=js[0].get('quality', 'low'), kinds=kinds, sha256=sha_file(p), sim=sim)

    # ── §178 렌더 확인 장면(후보 손잡이 없음 — 앱 조명 고침 둘만 켜고 끔)
    P1B = S['scenes']['P1B']['job']
    light = {
        'note': '§178 렌더 확인(lighting-render-check.js). P1B = 후쿠이 10/02 18:22:21 JST 높은 덮개(ac 0.75 · 7.4 km), 해 −9.84°. 앱 조명 고침 외 손잡이는 하네스 기본.',
        'P1B': dict(input=materialize(P1B['input']), options=dict(P1B.get('options', {}), flowCamCell=False), W=1000, H=750),
        'fukui': dict(lat=36.046, lon=136.278, heightM=23, az=272, el=10, fov=60),
        'configs': {
            'lowOnly': [{'genus': 'sc', 'cover': 0.45, 'baseKm': 1.5, 'thicknessM': 750, 'band': 'low', 'opts': {'seed': 4242}}, {'genus': None, 'cover': 0, 'baseKm': 4.5, 'band': 'mid'}, {'genus': None, 'cover': 0, 'baseKm': 10.0, 'band': 'high'}],
            'withCi': [{'genus': 'sc', 'cover': 0.45, 'baseKm': 1.5, 'thicknessM': 750, 'band': 'low', 'opts': {'seed': 4242}}, {'genus': None, 'cover': 0, 'baseKm': 4.5, 'band': 'mid'}, {'genus': 'ci', 'cover': 0.3, 'baseKm': 9.0, 'band': 'high', 'opts': {'seed': 77}}],
        },
        'frametimeUnit': dict(input=materialize(units['RA1_s4_V1']['input']), options=dict(units['RA1_s4_V1']['options'], flowCamCell=False)),
        'wp7Units': {n: dict(input=materialize(units[n]['input']), options=dict(units[n]['options'], flowCamCell=False))
                     for n in ['RA1_s1.1_V1', 'RA2_s-1_V1', 'RA3_s1.1_V1', 'RA4_s-3_V1', 'RA5_s1.1_V1']},
        'arms': {k: ARMS[k] for k in ('T1', 'T2', 'T1A')},
    }
    lp = os.path.join(outdir, 'light-scenes.json')
    with open(lp, 'w') as f:
        json.dump(light, f)
    man['files']['light-scenes.json'] = dict(n=0, sha256=sha_file(lp))
    man['arms'] = ARMS
    man['debugRefused'] = DEBUG_REFUSED
    with open(os.path.join(outdir, 'manifest.json'), 'w') as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: {kk: v[kk] for kk in ('n', 'W', 'H', 'quality', 'kinds') if kk in v} for k, v in man['files'].items()}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--outdir':
        sys.exit('usage: gpuwin-jobs.py --outdir DIR')
    main(sys.argv[2])
