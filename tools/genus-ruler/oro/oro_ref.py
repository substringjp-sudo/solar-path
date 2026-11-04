#!/usr/bin/env python3
"""
oro_ref.py — RULER-oro(3판 고침 1) 참조 구현: 모듈 + CLI(동결 파일, 자 L874). 설계: tools/genus-ruler/oro/S3-design.md §0·§1.

  python3 -I tools/genus-ruler/oro/oro_ref.py ring-manifest [--tags blend[,blend-ext,blend-pre2]] [--out tools/genus-ruler/oro/ring-manifest.json]
  python3 -I tools/genus-ruler/oro/oro_ref.py bank-manifest [--banks orig[,ext,pre2]] [--out tools/genus-ruler/oro/bank-manifest.json]

이 파일에 지금 있는 부분(S3a 'JS + manifest' 몫):
  §0.1 열기 가드(install_guard · allow · guard_verdict), §0.2 dump_json · sha256, 은행 표(§1.15),
  §1.13 허용 목록 장면 읽기(load_scene_meta, scene_hashes — 장면 JSON 을 여는 함수는 _read_scene 하나뿐),
  §1.15 ring-manifest · bank-manifest(자 L374·L375, C1·C3).
  다른 S3a 부분(§1.1~§1.14 모형, dem-grids · inputs · seal-inputs · apply)은 같은 파일의 같은 COMMANDS 표에 더합니다.

오염 규칙(§0.1): 표준 출력은 수·상태·sha256 만. 장면 JSON 은 허용 목록 키(또는 해시)만 밖으로 내보내고, PNG 는 날 바이트의
sha256 만(디코드 없음, png-hash), 은행 파일의 크기는 어디에도 적거나 찍지 않습니다(C1). git 은 부르지 않습니다.
"""
import sys
sys.dont_write_bytecode = True          # importlib 으로 부르는 fetch-sat.py 등이 __pycache__ 를 남기지 않게(§0.2)

import contextlib
import hashlib
import importlib.util
import json
import os
import re
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
JUDGE_LOCK = os.path.join(HERE, 'judge.lock')


# ───────────────────────── §0.2 JSON · 해시 · 경로 ─────────────────────────
def dumps_json(obj):
    """모든 산출 JSON 의 한 꼴: 키 정렬, indent 1, NaN 금지, 끝 줄바꿈. float 는 파이썬 repr(왕복 정확)."""
    return json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False) + '\n'


def dump_json(obj, path):
    s = dumps_json(obj)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)
    return s


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def rel(path):
    """저장소 뿌리 기준 상대 경로(posix). 산출 파일에는 이 꼴만 적습니다."""
    return os.path.relpath(os.path.abspath(path), ROOT).replace(os.sep, '/')


def absp(relpath):
    return os.path.join(ROOT, *relpath.split('/'))


def shown(path):
    """찍을 때의 경로: 저장소 안이면 상대 경로, 밖이면 절대 경로."""
    r = rel(path)
    return os.path.abspath(path) if r == '..' or r.startswith('../') else r


# ───────────────────────── §0.1 열기 가드 ─────────────────────────
# 저장소 뿌리 기준 상대 경로(posix)에 맞춥니다. 심볼릭 링크로 돌아가지 않게 abspath 와 realpath 둘 다 봅니다.
_ALWAYS_FORBIDDEN = tuple(re.compile(p) for p in (
    r'^\.harness/macro/sat[^/]*/index\.json$',
    r'^\.harness/oro/sat-[^/]+/index\.json$',
    r'^tools/genus-ruler/macro/sat-quartiles\.json$',
    r'^tools/genus-ruler/ring/(gate-.*|ringtruth-results)\.json$',
    r'^\.harness/oro/(f2\.log|f3-run\.log|fetch-sat.*\.log|sat-quartiles-restore\.json)$',
    r'^\.harness/regime/sat',
))
_ALWAYS_FORBIDDEN_ABS = ('/scratchpad/restore/',)
_NEEDS_CONTEXT = (
    (re.compile(r'^\.harness/macro/sat[^/]*/[^/]+\.png$'), ('png-hash', 'png-judge')),
    (re.compile(r'^\.harness/oro/sat-[^/]+/[^/]+\.png$'), ('png-hash', 'png-judge')),
    (re.compile(r'^\.harness/macro/sat[^/]*/(?!index\.json)[^/]+\.json$'), ('scene-json',)),
    (re.compile(r'^\.harness/oro/sat-[^/]+/(?!index\.json)[^/]+\.json$'), ('scene-json',)),
)
CONTEXTS = ('scene-json', 'png-hash', 'png-judge')
_tls = threading.local()
_guard_installed = False


def guard_verdict(path):
    """경로 → None(제한 없음) · 'forbidden' · 허용 문맥 튜플. 파일을 건드리지 않는 순수 함수(U-GUARD 가 직접 부름)."""
    a = os.path.abspath(path)
    cands = {a}
    try:
        cands.add(os.path.realpath(a))
    except (OSError, ValueError):
        pass
    needs = []
    for p in sorted(cands):
        if any(s in p for s in _ALWAYS_FORBIDDEN_ABS):
            return 'forbidden'
        r = os.path.relpath(p, ROOT).replace(os.sep, '/')
        if r == '..' or r.startswith('../'):
            continue
        if any(rx.search(r) for rx in _ALWAYS_FORBIDDEN):
            return 'forbidden'
        for rx, ctxs in _NEEDS_CONTEXT:
            if rx.search(r):
                needs.append(set(ctxs))
    if not needs:
        return None
    ok = set.intersection(*needs)
    return tuple(sorted(ok)) if ok else 'forbidden'


def _active_contexts():
    return getattr(_tls, 'ctx', ())


@contextlib.contextmanager
def allow(ctx):
    """with allow('scene-json'|'png-hash'|'png-judge'): 그 안에서만 해당 경로를 열 수 있음(스레드별)."""
    if ctx not in CONTEXTS:
        raise ValueError(f'unknown guard context {ctx!r}')
    prev = _active_contexts()
    _tls.ctx = prev + (ctx,)
    try:
        yield
    finally:
        _tls.ctx = prev


def _guard_hook(event, args):
    if event != 'open' or not args:
        return
    p = args[0]
    if p is None or isinstance(p, int):
        return
    try:
        p = os.fsdecode(p)
    except (TypeError, ValueError):
        return
    v = guard_verdict(p)
    if v is None:
        return
    if v != 'forbidden':
        act = _active_contexts()
        if ('png-hash' in v and 'png-hash' in act) or ('scene-json' in v and 'scene-json' in act):
            return
        # png-judge 는 judge.lock 이 그 순간 있을 때만(C2, §6.6): MODIS 내용 디코드 전에 lock.
        if 'png-judge' in v and 'png-judge' in act and os.path.exists(JUDGE_LOCK):
            return
    raise PermissionError(f'oro guard: {rel(p)}')


def install_guard():
    """sys.addaudithook('open') — oro_ref CLI · oro-geom · oro-test · oro.py 가 맨 먼저 부름(oro-fingerprint.py 는 아님, C3)."""
    global _guard_installed
    if not _guard_installed:
        sys.addaudithook(_guard_hook)
        _guard_installed = True


def guard_installed():
    return _guard_installed


# ───────────────────────── 이웃 도구(importlib, main 은 막혀 있음) ─────────────────────────
_mods = {}


def load_tool(name, relpath):
    """fetch-sat.py · fetch-nwp-ring.py 같은 이웃 도구를 파일 경로로 부름(-I 라 sys.path[0] 없음)."""
    if name not in _mods:
        spec = importlib.util.spec_from_file_location(name, absp(relpath))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _mods[name] = m
    return _mods[name]


def fetch_sat():
    return load_tool('fetch_sat', 'tools/genus-ruler/macro/fetch-sat.py')


def ring91():
    """fetch-sat RING 순서의 (dist, az) 91 개: 0 = 관측점(0, 0), 그다음 5 km × 6, 10·30·70·130·200·280·380 km × 12."""
    return [(0, 0)] + [(d, az) for d, azs in fetch_sat().RING for az in azs]


def all_sites():
    S = fetch_sat().SITES
    return sorted(list(S['dev']) + list(S['held']))


# ───────────────────────── 은행 표(§1.15) ─────────────────────────
def bank_table(bank):
    """은행 이름 → 장면 폴더 · 시각 파일 · 고리 tag · 탐측 파일(모두 저장소 뿌리 기준 상대 경로)."""
    if bank == 'orig':
        return {'dir': '.harness/macro/sat', 'times': 'tools/genus-ruler/ring/modis-times.json',
                'latest': 'tools/genus-ruler/ring/modis-times-latest.json', 'ringTag': 'blend',
                'sounding': '.harness/oro/sounding.json'}
    if bank == 'ext':
        return {'dir': '.harness/oro/sat-ext', 'times': 'tools/genus-ruler/oro/modis-times-ext.json', 'latest': None,
                'ringTag': 'blend-ext', 'sounding': '.harness/oro/sounding.json'}
    if bank == 'pre2':
        return {'dir': '.harness/oro/sat-pre2', 'times': 'tools/genus-ruler/oro/modis-times-pre2.json', 'latest': None,
                'ringTag': 'blend-pre2', 'sounding': '.harness/oro/sounding-oro-pre2.json'}
    m = re.fullmatch(r'ext(\d+)', bank)
    if m:   # 동결 뒤 확장 extN(L333): 같은 동결 코드, 다른 파일 이름
        k = m.group(1)
        return {'dir': f'.harness/oro/sat-ext{k}', 'times': f'tools/genus-ruler/oro/modis-times-ext{k}.json', 'latest': None,
                'ringTag': f'blend-ext{k}', 'sounding': f'.harness/oro/sounding-oro-ext{k}.json'}
    raise ValueError(f'unknown bank {bank!r} (orig, ext, pre2, ext<N>)')


def bank_scene_names(dirpath):
    """은행 폴더의 장면 이름(파일 이름에서만, 열지도 stat 하지도 않음), 정렬. index.json 은 뺌."""
    return sorted(f[:-5] for f in os.listdir(dirpath) if f.endswith('.json') and f != 'index.json')


# ───────────────────────── §1.13 허용 목록 장면 읽기 ─────────────────────────
SCENE_META_KEYS = ('site', 'lat', 'lon', 'date', 'grid', 'cellKm')


def _read_scene(path, want):
    """
    장면 JSON 을 여는 **유일한** 함수(§0.1). want='meta' → 허용 목록 값 {site, lat, lon, date, grid, cellKm, ring:[{dist, az}]},
    want='hash' → {jsonSha256, trueGridSha256} 만(bank-manifest, 값 없음 L375). 파싱한 객체는 여기서 지우므로
    trueGrid · cover · empty · 고리 cover 같은 MODIS 값은 이 함수 밖으로 나가지 않습니다. 오류 글에는 키 이름만 씁니다.
    """
    with allow('scene-json'):
        with open(path, 'rb') as f:
            raw = f.read()
    sc = None
    try:
        sc = json.loads(raw)
        if not isinstance(sc, dict):
            raise ValueError(f'{rel(path)}: scene JSON is not an object')
        if want == 'hash':
            tg = sc.get('trueGrid')
            try:
                tg_sha = sha256_bytes(tg.encode('ascii')) if isinstance(tg, str) else None
            except UnicodeEncodeError:
                raise ValueError(f'{rel(path)}: trueGrid is not ASCII') from None
            finally:
                tg = None
            return {'jsonSha256': sha256_bytes(raw), 'trueGridSha256': tg_sha}
        if want == 'meta':
            missing = [k for k in SCENE_META_KEYS + ('ring',) if k not in sc]
            if missing:
                raise KeyError(f'{rel(path)}: missing keys {missing}')
            meta = {k: sc[k] for k in SCENE_META_KEYS}
            meta['ring'] = [{'dist': r['dist'], 'az': r['az']} for r in sc['ring']]
            return meta
        raise ValueError(f'bad want {want!r}')
    finally:
        del sc, raw


def load_scene_meta(path):
    return _read_scene(path, 'meta')


def scene_hashes(path):
    return _read_scene(path, 'hash')


# ───────────────────────── §1.15 ring-manifest ─────────────────────────
def ring_manifest_doc(tags):
    """ring/nwp/<tag>/<site>.json(NWP 원자료, 허용)의 sha256 · 바이트 · 머리 정보(자 L374). 값은 oro-inputs.json 에."""
    want = ring91()
    doc = {'schema': 'ring-manifest/1', 'tags': {}}
    for tag in tags:
        if not re.fullmatch(r'[A-Za-z0-9-]+', tag):
            raise ValueError(f'bad tag {tag!r}')
        d = absp(f'tools/genus-ruler/ring/nwp/{tag}')
        if not os.path.isdir(d):
            raise FileNotFoundError(f'ring raw dir missing: {rel(d)}')
        sites = {}
        for fn in sorted(os.listdir(d)):
            if not fn.endswith('.json'):
                continue
            p = os.path.join(d, fn)
            with open(p, 'rb') as f:
                raw = f.read()
            r = json.loads(raw)
            site = fn[:-5]
            if r.get('site') != site:
                raise ValueError(f'{rel(p)}: site field != file name')
            pts = [(q['dist'], q['az']) for q in r['points']]
            if pts != want:
                raise ValueError(f'{rel(p)}: points are not in fetch-sat RING order')
            data = r['data']
            if len(data) != len(pts):
                raise ValueError(f'{rel(p)}: {len(data)} data entries for {len(pts)} points')
            t0 = data[0]['hourly']['time']
            if any(x['hourly']['time'] != t0 for x in data):
                raise ValueError(f'{rel(p)}: hourly time lists differ between points')
            sites[site] = {'path': rel(p), 'sha256': sha256_bytes(raw), 'bytes': len(raw), 'nPoints': len(data),
                           'models': list(r.get('models') or []), 'endpoint': r.get('endpoint'),
                           'nHours': len(t0), 'firstHour': t0[0] if t0 else None, 'lastHour': t0[-1] if t0 else None}
        missing = [s for s in all_sites() if s not in sites]
        print(f'RING {tag} sites {len(sites)} missing {len(missing)}' + (f' {",".join(missing)}' if missing else ''))
        doc['tags'][tag] = sites
    return doc


# ───────────────────────── §1.15 bank-manifest ─────────────────────────
def bank_manifest_doc(banks, table=bank_table):
    """
    복원 은행의 장면 JSON · trueGrid · PNG sha256(값 없음, 자 L375; 크기 없음, C1). 장면 이름은 폴더 목록에서(정렬, stat 없음).
    JSON 은 scene_hashes 로(허용 목록 함수 안에서 해시만), PNG 는 allow('png-hash') 안에서 날 바이트만 읽어 해시.
    표준 출력은 수만(n, nPng, nInTimes).
    """
    doc = {'schema': 'bank-manifest/1', 'banks': {}}
    for bank in banks:
        bt = table(bank)
        d = absp(bt['dir'])
        if not os.path.isdir(d):
            raise FileNotFoundError(f'bank dir missing: {bt["dir"]}')
        tp = absp(bt['times'])
        if not os.path.exists(tp):
            raise FileNotFoundError(f'times file missing: {bt["times"]}')
        with open(tp, 'rb') as f:
            times_keys = set(json.loads(f.read()).keys())
        listing = set(os.listdir(d))
        scenes = {}
        for name in bank_scene_names(d):
            h = scene_hashes(os.path.join(d, name + '.json'))
            png = None
            if name + '.png' in listing:
                with allow('png-hash'):
                    png = sha256_file(os.path.join(d, name + '.png'))
            scenes[name] = {'jsonSha256': h['jsonSha256'], 'trueGridSha256': h['trueGridSha256'],
                            'pngSha256': png, 'inTimes': name in times_keys}
        n_png = sum(1 for v in scenes.values() if v['pngSha256'] is not None)
        n_in = sum(1 for v in scenes.values() if v['inTimes'])
        print(f'BANK {bank} n {len(scenes)} nPng {n_png} nInTimes {n_in}')
        doc['banks'][bank] = {'dir': bt['dir'], 'n': len(scenes), 'scenes': scenes}
    return doc


# ───────────────────────── CLI ─────────────────────────
def _parse(argv, spec):
    """--key value 만 받는 엄격한 인자 풀이. spec = {'--key': 기본값}. 모르는 인자는 SystemExit(2)."""
    o = dict(spec)
    seen = set()
    i = 0
    while i < len(argv):
        k = argv[i]
        if k not in spec or k in seen or i + 1 >= len(argv):
            print(f'oro_ref: bad argument {k!r} (allowed: {" ".join(sorted(spec))})', file=sys.stderr)
            raise SystemExit(2)
        seen.add(k)
        o[k] = argv[i + 1]
        i += 2
    return o


def _csv(s):
    out = [x for x in s.split(',') if x]
    if not out or len(set(out)) != len(out):
        print(f'oro_ref: bad list {s!r}', file=sys.stderr)
        raise SystemExit(2)
    return out


def cmd_ring_manifest(argv):
    o = _parse(argv, {'--tags': 'blend', '--out': 'tools/genus-ruler/oro/ring-manifest.json'})
    s = dump_json(ring_manifest_doc(_csv(o['--tags'])), o['--out'])
    print(f'WROTE {shown(o["--out"])} sha256 {sha256_bytes(s.encode("utf-8"))}')
    return 0


def cmd_bank_manifest(argv):
    o = _parse(argv, {'--banks': 'orig', '--out': 'tools/genus-ruler/oro/bank-manifest.json'})
    s = dump_json(bank_manifest_doc(_csv(o['--banks'])), o['--out'])
    print(f'WROTE {shown(o["--out"])} sha256 {sha256_bytes(s.encode("utf-8"))}')
    return 0


COMMANDS = {
    'ring-manifest': cmd_ring_manifest,
    'bank-manifest': cmd_bank_manifest,
}



# ═══════════════════════ S3a MODEL + BUILDERS — BEGIN (S3-design §1.1–§1.15: dem-grids · inputs · seal-inputs · apply) ═══════════════════════
# Reference model of RULER-oro §3 (h_eff, η_w, combiner) and the MODIS-free builders. Uses the guard, allow-list loader, bank table and
# JSON/sha helpers defined above. English comments; ruler line refs Lnnn are RULER-oro.md at 6f99303.
#
#   python3 -I tools/genus-ruler/oro/oro_ref.py dem-grids   [--manifest tools/genus-ruler/oro/dem-manifest.json] [--dem-dir .harness/oro/dem]
#                                                           [--out tools/genus-ruler/oro/dem-grids.json]
#   python3 -I tools/genus-ruler/oro/oro_ref.py inputs      [--banks orig[,ext|,pre2]] [--out tools/genus-ruler/oro/oro-inputs.json]
#                                                           [--sounding .harness/oro/sounding.json] [--sounding-ecmwf .harness/oro/sounding-ecmwf.json]
#                                                           [--sounding-manifest <path>] [--dem-grids tools/genus-ruler/oro/dem-grids.json]
#   python3 -I tools/genus-ruler/oro/oro_ref.py seal-inputs [--inputs …/oro-inputs.json] [--base-index .harness/oro/base/index.json]
#   python3 -I tools/genus-ruler/oro/oro_ref.py apply       [--inputs …] [--dem-grids …] [--cmr-geom tools/genus-ruler/oro/cmr-geom.json]
#                                                           [--base .harness/oro/base] [--out tools/genus-ruler/oro/oro-apply.json]
# Every builder derives pending sites from the data on disk (D4): re-run inputs → oro-base → seal-inputs → apply when soundings arrive.
# Before B exists (or before seal-inputs), apply still runs: rows get bMissing = true (A6 null, A7 false, judge false) and the summary
# stays provisional.
import io
import math
import base64
import platform
from datetime import datetime, timedelta, timezone

import numpy as np

# ── §1.1 constants (RULER-oro L65-L74, L389-L449, L289-L296; arms L727, L733; sun-facing split L592) ──
N_GRID = 128; DX_M = 6000.0; HALF_KM = 384.0; KM_PER_DEG = 111.32
WIN = (49, 79); NBOX = 15; TUKEY_CELLS = 16; S_HP_M = 10000.0; LAMBDA_SMIN_M = 200000.0
SIGMA_G_M = 20000.0; QCLIP = 2.5; DCLIP = 1.5; TOL_STOP = 0.005; TOL_FAIL = 0.01; MAX_IT = 10; DEN_FLOOR = 1e-6
OMEGA = 7.2921e-5; LV = 2.5e6; RV = 461.5; RD = 287.04; G0 = 9.80665; CP = 1004.7; GAMMA_D = G0 / CP
N_MIN = 0.003; N_MAX = 0.02; HW_MIN = 1500.0; HW_MAX = 4000.0; HW_DEF = 2500.0
SREL_MIN = 0.05; SREL_MAX = 0.30; SREL_DEF = 0.15; CLM_LO = 0.05; CLM_HI = 0.45; RH_MAX = 0.97
A1_RMS_M = 100.0; A2_SPEED = 5.0; A3_N2 = 1e-5; A7_MIN_S = 20; DC_SEL = 0.02; SNOW_MARGIN_M = 300.0; HI_MASK = 0.3
ZREF_RADIUS_KM = 50.0; REF_MARGIN_M = 500.0; FALLBACK_H = 3; SNOW_HOURS = 504; RING_NULL_MAX = 9; RING_MIN_POINTS = 12
SNOW_DAYS_ARMS = (7, 42); TAU_C = 1000.0; SUN_SLOPE_MIN_DEG = 5.0; SUN_AZ_HALF_DEG = 45.0; UNDERGROUND_MARGIN_M = 500.0
TEMP_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300, 250, 200]   # fetch-sounding.py
EXT_SUN_MIN_DEG = 20.0          # L315 (inclusive, Q-43)
CROSS_TRACK_SPLIT_KM = 430.0    # L592
DDC_PRIMARY = 0.3               # L574
BANDS = ('total', 'low', 'mid', 'high')
BAND_VAR = {'total': 'cloud_cover', 'low': 'cloud_cover_low', 'mid': 'cloud_cover_mid', 'high': 'cloud_cover_high'}
TIME_KEYS = ('closest', 'latest', 'm1h', 'p1h')
REF_LEVELS = (850, 700, 600, 500)

CONSTANTS = dict(sorted(dict(
    N_GRID=N_GRID, DX_M=DX_M, WIN=list(WIN), NBOX=NBOX, TUKEY_CELLS=TUKEY_CELLS, S_HP_M=S_HP_M, LAMBDA_SMIN_M=LAMBDA_SMIN_M,
    SIGMA_G_M=SIGMA_G_M, QCLIP=QCLIP, DCLIP=DCLIP, TOL_STOP=TOL_STOP, TOL_FAIL=TOL_FAIL, MAX_IT=MAX_IT, DEN_FLOOR=DEN_FLOOR,
    OMEGA=OMEGA, LV=LV, RV=RV, RD=RD, G0=G0, CP=CP, N_MIN=N_MIN, N_MAX=N_MAX, HW_MIN=HW_MIN, HW_MAX=HW_MAX, HW_DEF=HW_DEF,
    SREL_MIN=SREL_MIN, SREL_MAX=SREL_MAX, SREL_DEF=SREL_DEF, CLM_LO=CLM_LO, CLM_HI=CLM_HI, RH_MAX=RH_MAX, A1_RMS_M=A1_RMS_M,
    A2_SPEED=A2_SPEED, A3_N2=A3_N2, A7_MIN_S=A7_MIN_S, DC_SEL=DC_SEL, SNOW_MARGIN_M=SNOW_MARGIN_M, HI_MASK=HI_MASK,
    ZREF_RADIUS_KM=ZREF_RADIUS_KM, REF_MARGIN_M=REF_MARGIN_M, FALLBACK_H=FALLBACK_H, SNOW_HOURS=SNOW_HOURS,
    RING_NULL_MAX=RING_NULL_MAX, RING_MIN_POINTS=RING_MIN_POINTS, SNOW_DAYS_ARMS=list(SNOW_DAYS_ARMS), TAU_C=TAU_C,
    SUN_SLOPE_MIN_DEG=SUN_SLOPE_MIN_DEG, SUN_AZ_HALF_DEG=SUN_AZ_HALF_DEG, UNDERGROUND_MARGIN_M=UNDERGROUND_MARGIN_M,
    EXT_SUN_MIN_DEG=EXT_SUN_MIN_DEG, CROSS_TRACK_SPLIT_KM=CROSS_TRACK_SPLIT_KM, DDC_PRIMARY=DDC_PRIMARY).items()))

GRID_META = {'n': 128, 'cellKm': 6.0, 'rows': 'south->north', 'cols': 'west->east', 'observer': 'corner of cells 63/64'}

# default paths (repo-relative; S3-design §0.4)
D_DEM_MANIFEST = 'tools/genus-ruler/oro/dem-manifest.json'
D_DEM_DIR = '.harness/oro/dem'
D_DEM_GRIDS = 'tools/genus-ruler/oro/dem-grids.json'
D_INPUTS = 'tools/genus-ruler/oro/oro-inputs.json'
D_APPLY = 'tools/genus-ruler/oro/oro-apply.json'
D_CMR_GEOM = 'tools/genus-ruler/oro/cmr-geom.json'
D_SOUNDING = '.harness/oro/sounding.json'
D_SOUNDING_ECMWF = '.harness/oro/sounding-ecmwf.json'
D_BASE = '.harness/oro/base'
D_RING_NWP = 'tools/genus-ruler/ring/nwp'
FETCH_NWP_REL = 'tools/genus-ruler/ring/fetch-nwp-ring.py'
FETCH_SAT_REL = 'tools/genus-ruler/macro/fetch-sat.py'


def _path(p):
    """CLI/table path → absolute: absolute stays, repo-relative ('a/b') is joined to ROOT."""
    return p if os.path.isabs(p) else os.path.join(ROOT, *p.split('/'))


def fetch_nwp():
    return load_tool('fetch_nwp_ring', FETCH_NWP_REL)


def sites_table():
    """{site: (lat, lon, group)} from fetch-sat SITES, sorted by name."""
    S = fetch_sat().SITES
    out = {}
    for g in ('dev', 'held'):
        for s, (la, lo) in S[g].items():
            out[s] = (la, lo, g)
    return {k: out[k] for k in sorted(out)}


# ── encodings (S3-design §0.3) ──
def f32b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<f4').tobytes()).decode('ascii')


def f64b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<f8').tobytes()).decode('ascii')


def dec_f32(s, n):
    """f32b64 → float64 (n, n) (the float32 round trip of D5)."""
    return np.frombuffer(base64.b64decode(s), dtype='<f4').reshape(n, n).astype(np.float64)


def dec_f64(s):
    return np.frombuffer(base64.b64decode(s), dtype='<f8').astype(np.float64)


def ring_entry(vals):
    """91 values (None = null) → {'f64': f64b64 with NaN at nulls, 'nullIdx': sorted NaN positions} (Q-20)."""
    a = np.array([np.nan if v is None else float(v) for v in vals], dtype=np.float64)
    return {'f64': f64b64(a), 'nullIdx': [int(i) for i in np.flatnonzero(np.isnan(a))]}


def fmt_utc(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_utc(s):
    return datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)


def parse_hour(s):
    return datetime.strptime(s[:16], '%Y-%m-%dT%H:%M').replace(tzinfo=timezone.utc)


def hour_key(t):
    return t.strftime('%Y-%m-%dT%H:%M')


# ── §1.2 normal distribution (L426): Abramowitz–Stegun 7.1.26 erf, Acklam inverse without refinement (Q-6), exact φ (Q-7) ──
_AS_P = 0.3275911
_AS_A = (0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429)
_AK_A = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02,
         -3.066479806614716e+01, 2.506628277459239e+00)
_AK_B = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01,
         -1.328068155288572e+01)
_AK_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00,
         4.374664141464968e+00, 2.938163982698783e+00)
_AK_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00)
_AK_PLOW = 0.02425


def erf_as(x):
    """A&S 7.1.26 for x ≥ 0 (Horner form of a1 t + … + a5 t⁵); odd extension for x < 0. erf_as(0) = 1e-9 (not exact)."""
    x = np.asarray(x, dtype=np.float64)
    ax = np.abs(x)
    t = 1.0 / (1.0 + _AS_P * ax)
    a1, a2, a3, a4, a5 = _AS_A
    v = 1.0 - t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5)))) * np.exp(-ax * ax)
    return np.where(x >= 0, v, -v)


def Phi(x):
    return 0.5 * (1.0 + erf_as(np.asarray(x, dtype=np.float64) / math.sqrt(2.0)))


def phi(x):
    x = np.asarray(x, dtype=np.float64)
    return np.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def Phinv(p):
    """Acklam rational approximation, published coefficients, regions p < 0.02425 / central / p > 0.97575. Domain (0, 1)."""
    p = np.asarray(p, dtype=np.float64)
    if not (np.all(p > 0.0) and np.all(p < 1.0)):
        raise ValueError('Phinv: p outside (0, 1)')
    a, b, c, d = _AK_A, _AK_B, _AK_C, _AK_D
    out = np.empty_like(p)
    lo = p < _AK_PLOW
    hi = p > 1.0 - _AK_PLOW
    mid = ~(lo | hi)
    if np.any(lo):
        q = np.sqrt(-2.0 * np.log(p[lo]))
        out[lo] = ((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
                   / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0))
    if np.any(mid):
        q = p[mid] - 0.5
        r = q * q
        out[mid] = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
                    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0))
    if np.any(hi):
        q = np.sqrt(-2.0 * np.log(1.0 - p[hi]))
        out[hi] = -((((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
                    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0))
    return out


Q_LO = float(Phi(-QCLIP))
Q_HI = float(Phi(QCLIP))


# ── grid helpers (S3-design §0.3) ──
def kgrid(n, dx_m):
    """k (east) varies along axis 1, l (north) along axis 0: 2π·fftfreq(n, Δ)."""
    k1 = 2.0 * np.pi * np.fft.fftfreq(n, d=dx_m)
    return np.tile(k1[None, :], (n, 1)), np.tile(k1[:, None], (1, n))


def cell_xy_km(n=N_GRID, cell_km=DX_M / 1000.0):
    """Cell centres x = (c + 0.5 − n/2)·Δ (east), y = (r + 0.5 − n/2)·Δ (north); arrays (n, n)."""
    c = (np.arange(n) + 0.5 - n / 2) * cell_km
    return np.tile(c[None, :], (n, 1)), np.tile(c[:, None], (1, n))


def window_slice(n):
    """Cells whose centres are within ±90 km: 128² × 6 km → 49..78, 64² × 12 km → 24..39 (Q-52)."""
    if n == 128:
        return WIN
    if n == 64:
        return (24, 40)
    raise ValueError(f'no window for n={n}')


def box15(X):
    """(15, 15) means of the 12 km judging boxes; box (bi, bj) = rows 49+2bi..50+2bi × cols 49+2bj..50+2bj, flat b = 15·bi + bj."""
    w = np.asarray(X, dtype=np.float64)[WIN[0]:WIN[1], WIN[0]:WIN[1]]
    return w.reshape(NBOX, 2, NBOX, 2).mean(axis=(1, 3))


def box15_max(H):
    """(15, 15) max over the 4 cells of each judging box (Q-1, from hmax6)."""
    w = np.asarray(H, dtype=np.float64)[WIN[0]:WIN[1], WIN[0]:WIN[1]]
    return w.reshape(NBOX, 2, NBOX, 2).max(axis=(1, 3))


# ── §1.3 Gaussian smoothing (L425, L568): separable, square truncation R = floor(3σ/Δ + 1e-9), zero pad, conv(X·m)/conv(m) ──
def gauss_taps(sigma_m, dx_m=DX_M):
    R = int(math.floor(3.0 * sigma_m / dx_m + 1e-9))
    i = np.arange(-R, R + 1, dtype=np.float64)
    return np.exp(-(i * dx_m) ** 2 / (2.0 * sigma_m * sigma_m))


def _conv_axis(X, w, axis):
    R = (len(w) - 1) // 2
    n = X.shape[axis]
    pad = [(0, 0), (0, 0)]
    pad[axis] = (R, R)
    Xp = np.pad(X, pad)
    out = np.zeros(X.shape, dtype=np.float64)
    for i in range(2 * R + 1):              # tap order −R..R (fixed float accumulation order)
        sl = [slice(None), slice(None)]
        sl[axis] = slice(i, i + n)
        out += w[i] * Xp[tuple(sl)]
    return out


def _conv2(X, w):
    return _conv_axis(_conv_axis(X, w, 0), w, 1)       # axis 0 then axis 1


def gauss_smooth(X, sigma_m, mask=None, dx_m=DX_M):
    """Normalised Gaussian; with a 0/1 mask: conv(X·m)/conv(m), NaN where conv(m) = 0."""
    X = np.asarray(X, dtype=np.float64)
    w = gauss_taps(sigma_m, dx_m)
    m = np.ones_like(X) if mask is None else np.asarray(mask).astype(np.float64)
    num = _conv2(X * m, w)
    den = _conv2(m, w)
    if mask is None:
        return num / den
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(den == 0, np.nan, num / den)


class _GaussOp:
    """Unmasked gauss_smooth with conv(1) cached; the same operations as gauss_smooth(X, σ), so bit-identical."""
    def __init__(self, n, sigma_m, dx_m):
        self.w = gauss_taps(sigma_m, dx_m)
        self.den = _conv2(np.ones((n, n), dtype=np.float64), self.w)

    def __call__(self, X):
        return _conv2(np.asarray(X, dtype=np.float64), self.w) / self.den


_GOPS = {}


def _gop(n, sigma_m, dx_m):
    key = (n, float(sigma_m), float(dx_m))
    if key not in _GOPS:
        _GOPS[key] = _GaussOp(n, sigma_m, dx_m)
    return _GOPS[key]


# ── §1.4 DEM decode and resampling (L243-L253) ──
def decode_terrarium(rgb):
    """uint8 RGB → elevation float64 = R·256 + G + B/256 − 32768 (h = max(·, 0) is applied by the callers, L246)."""
    a = np.asarray(rgb, dtype=np.float64)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def pix_lonlat(X, Y, z):
    """Global Web-Mercator pixel coordinates (256 px per tile; pixel centre = integer + 0.5) → lon, lat in degrees."""
    W = 256.0 * 2.0 ** z
    lon = 360.0 * np.asarray(X, dtype=np.float64) / W - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * np.asarray(Y, dtype=np.float64) / W))))
    return lon, lat


def box_map(lat, lon, lat0, lon0, n=N_GRID, cell_km=DX_M / 1000.0):
    """fetch-sat equirectangular map (L247): r = floor((lat − lat0)·111.32/Δ + n/2), c = floor(dlon·111.32·cos lat0/Δ + n/2)."""
    dlon = np.mod(np.asarray(lon, dtype=np.float64) - lon0 + 540.0, 360.0) - 180.0
    r = np.floor((np.asarray(lat, dtype=np.float64) - lat0) * KM_PER_DEG / cell_km + n / 2).astype(np.int64)
    c = np.floor(dlon * KM_PER_DEG * math.cos(math.radians(lat0)) / cell_km + n / 2).astype(np.int64)
    return r, c


def accumulate_cells(r, c, h, n=N_GRID):
    """Pixel-centre-in-cell statistics for pixels already inside the grid. Returns sum6, cnt6, max6 (n, n) and the
    pixel-weighted even 12 km tiling sum12, cnt12 (n/2, n/2). Sums of Terrarium values (multiples of 1/256) are exact."""
    idx = r * n + c
    sum6 = np.bincount(idx, weights=h, minlength=n * n).reshape(n, n)
    cnt6 = np.bincount(idx, minlength=n * n).reshape(n, n)
    max6 = np.full(n * n, -np.inf)
    np.maximum.at(max6, idx, h)
    m = n // 2
    idx12 = (r // 2) * m + (c // 2)
    sum12 = np.bincount(idx12, weights=h, minlength=m * m).reshape(m, m)
    cnt12 = np.bincount(idx12, minlength=m * m).reshape(m, m)
    return sum6, cnt6, max6.reshape(n, n), sum12, cnt12


def mercator_res_m(lat_deg, z):
    """Web-Mercator ground resolution (m/px), the same on both axes (conformal)."""
    return 40075016.686 * np.cos(np.radians(lat_deg)) / 2.0 ** z / 256.0


def pixel_gradients(hm, res_rows):
    """Central differences on a mosaic hm (row index increases southward; NaN = no tile), per-row resolution res_rows (m):
    g_east = (h[Y, X+1] − h[Y, X−1])/(2 res), g_north = (h[Y−1, X] − h[Y+1, X])/(2 res); NaN where a neighbour is absent."""
    H, W = hm.shape
    rr = np.asarray(res_rows, dtype=np.float64)[:, None]
    ge = np.full((H, W), np.nan)
    gn = np.full((H, W), np.nan)
    ge[:, 1:-1] = (hm[:, 2:] - hm[:, :-2]) / (2.0 * rr)
    gn[1:-1, :] = (hm[:-2, :] - hm[2:, :]) / (2.0 * rr[1:-1])
    return ge, gn


def box_slope_aspect(bidx, ge, gn, nbox=NBOX * NBOX):
    """Vector mean of the pixel gradients per box (bidx = flat box index, −1 = outside) → slope°, aspect° (direction the
    slope faces, clockwise from north) (Q-51)."""
    ok = (bidx >= 0) & np.isfinite(ge) & np.isfinite(gn)
    b = bidx[ok]
    cnt = np.bincount(b, minlength=nbox)
    if np.any(cnt == 0):
        raise ValueError('a judging box has no slope pixels')
    me = np.bincount(b, weights=ge[ok], minlength=nbox) / cnt
    mn = np.bincount(b, weights=gn[ok], minlength=nbox) / cnt
    return np.degrees(np.arctan(np.hypot(me, mn))), np.mod(np.degrees(np.arctan2(-me, -mn)), 360.0)


def grids_from_tiles(lat0, lon0, z, tiles):
    """tiles {(tx, ty): elevation (256, 256)} of one zoom → dem-grids arrays (float64, before the float32 encoding).
    Tiles are processed in sorted (tx, ty) order; each pixel lands in exactly one cell (pixel centre in cell, Q-29)."""
    n = N_GRID
    keys = sorted(tiles)
    px = np.arange(256, dtype=np.float64) + 0.5
    rs, cs, hs, used = [], [], [], []
    for (tx, ty) in keys:
        h = np.maximum(tiles[(tx, ty)], 0.0)
        X = np.tile((256.0 * tx + px)[None, :], (256, 1))
        Y = np.tile((256.0 * ty + px)[:, None], (1, 256))
        lon, lat = pix_lonlat(X, Y, z)
        r, c = box_map(lat, lon, lat0, lon0)
        ok = (r >= 0) & (r < n) & (c >= 0) & (c < n)
        if np.any(ok):
            used.append((tx, ty))
            rs.append(r[ok]); cs.append(c[ok]); hs.append(h[ok])
    r = np.concatenate(rs); c = np.concatenate(cs); h = np.concatenate(hs)
    sum6, cnt6, max6, sum12, cnt12 = accumulate_cells(r, c, h, n)
    if np.any(cnt6 == 0):
        raise ValueError('a 6 km cell has no DEM pixel')
    # slope/aspect of the 15×15 judging boxes on the tile-pixel mosaic (M4, Q-51)
    xs = sorted({k[0] for k in keys}); ys = sorted({k[1] for k in keys})
    x0, y0 = xs[0], ys[0]
    Hm, Wm = (ys[-1] - y0 + 1) * 256, (xs[-1] - x0 + 1) * 256
    hm = np.full((Hm, Wm), np.nan)
    for (tx, ty) in keys:
        hm[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = np.maximum(tiles[(tx, ty)], 0.0)
    lon_cols, _ = pix_lonlat(256.0 * x0 + np.arange(Wm) + 0.5, np.zeros(Wm), z)
    _, lat_rows = pix_lonlat(np.zeros(Hm), 256.0 * y0 + np.arange(Hm) + 0.5, z)
    ge, gn = pixel_gradients(hm, mercator_res_m(lat_rows, z))
    r2, c2 = box_map(np.tile(lat_rows[:, None], (1, Wm)), np.tile(lon_cols[None, :], (Hm, 1)), lat0, lon0)
    inwin = (r2 >= WIN[0]) & (r2 < WIN[1]) & (c2 >= WIN[0]) & (c2 < WIN[1]) & np.isfinite(hm)
    bidx = np.where(inwin, ((r2 - WIN[0]) // 2) * NBOX + (c2 - WIN[0]) // 2, -1)
    slope, aspect = box_slope_aspect(bidx, ge, gn)
    return {'hmean6': sum6 / cnt6, 'hmax6': max6, 'hmax12': max6.reshape(n // 2, 2, n // 2, 2).max(axis=(1, 3)),
            'hmean12': sum12 / cnt12, 'pixPerCell': [int(cnt6.min()), int(cnt6.max())], 'used': used,
            'slopeDeg15': slope, 'aspectDeg15': aspect}


def _dem_site_empty(lat0, lon0, z):
    return {'lat': lat0, 'lon': lon0, 'zoom': z, 'complete': False, 'tilesUsed': {}, 'pixPerCell': None,
            'hmean6': None, 'hmax6': None, 'hmax12': None, 'hmean12': None, 'slopeDeg15': None, 'aspectDeg15': None,
            'a1RmsM': None, 'zRefM': None}


def site_dem_grid(site, lat0, lon0, man, dem_dir):
    """dem-grids.json entry of one site (S3-design §1.4). A missing tile or a sha256 ≠ manifest → complete false, grids null."""
    from PIL import Image
    s = man['sites'][site]
    z = int(s['zoom'])
    keys = sorted(set(s['blockTiles']) | set(s['boxTiles']))
    sha = {t['tile']: t['sha256'] for t in man['tiles']}
    tiles, filesha = {}, {}
    for k in keys:
        zz, tx, ty = (int(v) for v in k.split('/'))
        p = os.path.join(dem_dir, f'{zz}_{tx}_{ty}.png')
        if zz != z or not os.path.exists(p):
            return _dem_site_empty(lat0, lon0, z)
        with open(p, 'rb') as f:
            body = f.read()
        if sha256_bytes(body) != sha.get(k):
            return _dem_site_empty(lat0, lon0, z)
        filesha[(tx, ty)] = sha[k]
        tiles[(tx, ty)] = decode_terrarium(np.asarray(Image.open(io.BytesIO(body)).convert('RGB')))
    g = grids_from_tiles(lat0, lon0, z, tiles)
    out = _dem_site_empty(lat0, lon0, z)
    for k in ('hmean6', 'hmax6', 'hmax12', 'hmean12'):
        out[k] = f32b64(g[k])
    hm6 = dec_f32(out['hmean6'], N_GRID)                 # D5: A1 and z_ref from the decoded float32 grid
    _, a1 = h_sub_field(hm6)
    out.update({'complete': True, 'pixPerCell': g['pixPerCell'],
                'tilesUsed': {f'{z}/{tx}/{ty}': filesha[(tx, ty)] for (tx, ty) in sorted(g['used'])},
                'slopeDeg15': [float(v) for v in g['slopeDeg15'].ravel()],
                'aspectDeg15': [float(v) for v in g['aspectDeg15'].ravel()],
                'a1RmsM': a1, 'zRefM': z_ref(hm6)})
    return out


def dem_site_arrays(site_entry):
    """Decoded float32 → float64 grids of one dem-grids.json site, or None if the site is incomplete."""
    if not site_entry.get('complete'):
        return None
    return {'hmean6': dec_f32(site_entry['hmean6'], N_GRID), 'hmax6': dec_f32(site_entry['hmax6'], N_GRID),
            'hmax12': dec_f32(site_entry['hmax12'], 64), 'hmean12': dec_f32(site_entry['hmean12'], 64),
            'slopeDeg15': np.array(site_entry['slopeDeg15'], dtype=np.float64),
            'aspectDeg15': np.array(site_entry['aspectDeg15'], dtype=np.float64)}


# ── §1.5 h_eff (L388-L393) ──
def tukey_1d(n=N_GRID, edge=TUKEY_CELLS):
    """w[i] = ½(1 − cos(π i/edge)) for i < edge, mirrored, else 1 (Q-3)."""
    w = np.ones(n, dtype=np.float64)
    for i in range(edge):
        v = 0.5 * (1.0 - math.cos(math.pi * i / edge))
        w[i] = v
        w[n - 1 - i] = v
    return w


def h_sub_field(hmean, n=N_GRID, dx_m=DX_M, tukey_cells=TUKEY_CELLS, s_m=S_HP_M):
    """① box mean removed ② Tukey ③ high-pass 1 − exp(−K²s²/2). Returns (hsub, A1 = rms of hsub over the window)."""
    h = np.array(hmean, dtype=np.float64)
    if h.shape != (n, n):
        raise ValueError('h_sub_field: shape')
    h -= h.mean()
    w = tukey_1d(n, tukey_cells)
    h *= np.outer(w, w)
    k, l = kgrid(n, dx_m)
    hsub = np.real(np.fft.ifft2(np.fft.fft2(h) * (1.0 - np.exp(-(k * k + l * l) * s_m * s_m / 2.0))))
    a, b = window_slice(n)
    return hsub, float(np.sqrt(np.mean(hsub[a:b, a:b] ** 2)))


def h_eff(hsub, speed, N):
    """Blocking clip in physical space: clip(h_sub, ±|V_ref|/N) (L393, Q-16)."""
    lim = speed / N
    return np.clip(hsub, -lim, lim)


def z_ref(hmean6):
    """Mean of max(0, h) over the cells whose centre is ≤ 50 km from the observer, inclusive (216 cells; L434, Q-50)."""
    x, y = cell_xy_km()
    sel = (x * x + y * y) <= ZREF_RADIUS_KM * ZREF_RADIUS_KM
    return float(np.mean(np.asarray(hmean6, dtype=np.float64)[sel]))


# ── §1.6 column displacement: vertical_m is the ONLY place that computes σ, the branch, sgn(σ), m and μ (R3, L802) ──
def vertical_m(k, l, U, V, N, f, branch='physical'):
    """→ (kind int8, m, μ). kind 0 = mean (K = 0), 1 = propagating f² < σ² < N² (real m = sgn(σ) K √((N² − σ²)/(σ² − f²))),
    2 = evanescent σ² ≥ N² (μ = K √((σ² − N²)/(σ² − f²))), 3 = rotational σ² ≤ f² (μ = K √((N² − σ²)/(f² − σ²)), +inf when
    f² − σ² = 0). branch='fastscape' copies fastscape's clamps (num ≥ 0, |den| ≥ eps, sgn(0) = +1, real m, kind 1 for K > 0).
    (With N² ≤ f², which the model never uses since N ≥ 0.003 > 2Ω, σ² ≥ N² is taken as evanescent first.)"""
    k = np.asarray(k, dtype=np.float64)
    l = np.asarray(l, dtype=np.float64)
    sig = U * k + V * l
    s2 = sig * sig
    N2 = float(N) * float(N)
    f2 = float(f) * float(f)
    K = np.hypot(k, l)
    pos = K > 0
    kind = np.zeros(k.shape, dtype=np.int8)
    m = np.zeros(k.shape, dtype=np.float64)
    mu = np.zeros(k.shape, dtype=np.float64)
    if branch == 'fastscape':
        eps = np.finfo(float).eps
        num = np.maximum(N2 - s2, 0.0)
        den = s2 - f2
        den = np.where((den < eps) & (den >= 0), eps, den)
        den = np.where((den > -eps) & (den < 0), -eps, den)
        sgn = np.where(sig >= 0, 1.0, -1.0)
        m = np.where(pos, sgn * np.sqrt(np.abs(num / den * (k * k + l * l))), 0.0)
        kind[pos] = 1
        return kind, m, mu
    if branch != 'physical':
        raise ValueError(f'branch {branch!r}')
    ev = pos & (s2 >= N2)
    rot = pos & ~ev & (s2 <= f2)
    prop = pos & ~ev & ~rot
    kind[prop] = 1
    kind[ev] = 2
    kind[rot] = 3
    m[prop] = np.sign(sig[prop]) * K[prop] * np.sqrt((N2 - s2[prop]) / (s2[prop] - f2))
    mu[ev] = K[ev] * np.sqrt((s2[ev] - N2) / (s2[ev] - f2))
    dr = f2 - s2[rot]
    mur = np.full(dr.shape, np.inf)
    okr = dr > 0
    mur[okr] = K[rot][okr] * np.sqrt((N2 - s2[rot][okr]) / dr[okr])
    mu[rot] = mur
    return kind, m, mu


def col_weight(k, l, U, V, N, f, Hw, branch='physical'):
    """W = 1/(1 − i m H_w) (kind 1), 1/(1 + μ H_w) (kinds 2, 3; μ = inf → 0), 0 (kind 0); from real μ, never complex inf."""
    kind, m, mu = vertical_m(k, l, U, V, N, f, branch)
    W = np.zeros(kind.shape, dtype=np.complex128)
    p = kind == 1
    W[p] = 1.0 / (1.0 - 1j * m[p] * Hw)
    d = ((kind == 2) | (kind == 3)) & np.isfinite(mu)
    W[d] = 1.0 / (1.0 + mu[d] * Hw)
    return W, kind


def vertical_decay(k, l, U, V, N, f, z, branch='physical'):
    """η̂(z)/ĥ: e^{imz} (kind 1), e^{−μz} (kinds 2, 3; μ = inf → 0), 0 at K = 0."""
    kind, m, mu = vertical_m(k, l, U, V, N, f, branch)
    E = np.zeros(kind.shape, dtype=np.complex128)
    p = kind == 1
    E[p] = np.exp(1j * m[p] * z)
    d = ((kind == 2) | (kind == 3)) & np.isfinite(mu)
    E[d] = np.exp(-mu[d] * z)
    return E


def low_sigma_damp(k, l, U, V, lambda_smin=LAMBDA_SMIN_M):
    """D(σ) = σ²/(σ² + σ_min²), σ_min = 2π|V|/λ (L66); |V| = 0 → 0 everywhere."""
    sig = U * np.asarray(k, dtype=np.float64) + V * np.asarray(l, dtype=np.float64)
    smin = 2.0 * math.pi * math.hypot(U, V) / lambda_smin
    if smin == 0.0:
        return np.zeros(sig.shape)
    s2 = sig * sig
    return s2 / (s2 + smin * smin)


def wind_to_uv(speed, from_deg):
    """Open-Meteo from-direction d and speed S → U = −S sin d, V = −S cos d (blowing toward east, north; L384)."""
    d = math.radians(from_deg)
    return -speed * math.sin(d), -speed * math.cos(d)


def eta_field(hsub, U, V, N, f, Hw, dx_m=DX_M, block='clip', vertical='col', N_scale=1.0, lambda_smin=LAMBDA_SMIN_M):
    """η for one wind (L396-L407). Defaults = the main model; the keywords are the §6 sensitivity hooks (S3-design §1.6):
    block clip|none|sheppard, vertical col|two|z1500|q, N_scale (N_m = N_scale·N in m and in the clip), lambda_smin."""
    n = hsub.shape[0]
    speed = math.hypot(U, V)
    if speed == 0.0:
        return np.zeros_like(hsub)
    Nm = N * N_scale
    if block == 'clip':
        he = h_eff(hsub, speed, Nm)
    elif block == 'none':
        he = np.asarray(hsub, dtype=np.float64)
    elif block == 'sheppard':   # max(h_sub − (max h_sub − U/N), 0), max over the judging window (Q-53)
        a, b = window_slice(n)
        he = np.maximum(hsub - (float(np.max(hsub[a:b, a:b])) - speed / Nm), 0.0)
    else:
        raise ValueError(f'block {block!r}')
    k, l = kgrid(n, dx_m)
    Hh = np.fft.fft2(he) * low_sigma_damp(k, l, U, V, lambda_smin)
    if vertical in ('col', 'q'):
        W, _ = col_weight(k, l, U, V, Nm, f, Hw)
        E = Hh * W
        if vertical == 'q':   # η̂_q = ĥ_eff·D·W·iστ_c/(1 + iστ_c); τ_c → ∞ gives η̂_w (L395, draft-1 method.md)
            sig = U * k + V * l
            E = E * (1j * sig * TAU_C) / (1.0 + 1j * sig * TAU_C)
    elif vertical == 'two':
        E = 0.5 * (Hh * vertical_decay(k, l, U, V, Nm, f, 1500.0) + Hh * vertical_decay(k, l, U, V, Nm, f, 3000.0))
    elif vertical == 'z1500':
        E = Hh * vertical_decay(k, l, U, V, Nm, f, 1500.0)
    else:
        raise ValueError(f'vertical {vertical!r}')
    E[0, 0] = 0.0
    return np.real(np.fft.ifft2(E))


def eta_w(hsub, snd, lat, rev=False, dx_m=DX_M, block='clip', vertical='col', N_scale=1.0, Hw_override=None,
          odd=False, lambda_smin=LAMBDA_SMIN_M, f_override=None):
    """η_w from a §3.5 REF dict (Vref, N, Hw_m); f = 2Ω sin φ. rev → (−U, −V) (G-rev, L518); odd → (η − η_rev)/2 (L730)."""
    U, V = snd['Vref']
    if rev:
        U, V = -U, -V
    f = 2.0 * OMEGA * math.sin(math.radians(lat)) if f_override is None else f_override
    Hw = snd['Hw_m'] if Hw_override is None else Hw_override
    kw = dict(dx_m=dx_m, block=block, vertical=vertical, N_scale=N_scale, lambda_smin=lambda_smin)
    e = eta_field(hsub, U, V, snd['N'], f, Hw, **kw)
    if odd:
        e = 0.5 * (e - eta_field(hsub, -U, -V, snd['N'], f, Hw, **kw))
    return e


def forcing(hsub, snd, lat, s_rel_override=None, **kw):
    """F = κ·η_w (σ units of the total-water PDF, L407). s_rel_override → κ = γ_s(T̄)/s_rel (L731)."""
    kappa = snd['kappa'] if s_rel_override is None else snd['gammaS'] / s_rel_override
    return kappa * eta_w(hsub, snd, lat, **kw)


# ── §1.7 combiner, difference form (L418-L431) ──
def combine(B, F, sigma_G_m=SIGMA_G_M, dx_m=DX_M):
    """q0 = Φ⁻¹(clip(B)); δ loop (≤ 10 updates, stop at max|R| ≤ 0.005); ΔC_raw = Φ(q0+F+δ) − Φ(q0); C = clip(B + ΔC_raw).
    No RNG. iters = number of δ updates; ok = max|G*ΔC_raw| ≤ 0.01 (A6, Q-5); dC = C − B (post-clip metric ΔC, L489)."""
    B = np.asarray(B, dtype=np.float64)
    F = np.asarray(F, dtype=np.float64)
    G = _gop(B.shape[0], sigma_G_m, dx_m)
    q0 = Phinv(np.clip(B, Q_LO, Q_HI))
    P0 = Phi(q0)
    delta = np.zeros_like(B)
    conv = False
    it = 0
    for it in range(1, MAX_IT + 1):
        R = G(Phi(q0 + F + delta) - P0)
        if float(np.max(np.abs(R))) <= TOL_STOP:
            conv = True
            it -= 1
            break
        delta = np.clip(delta - R / np.maximum(G(phi(q0 + F + delta)), DEN_FLOOR), -DCLIP, DCLIP)
    dC_raw = Phi(q0 + F + delta) - P0
    maxGdC = float(np.max(np.abs(G(dC_raw))))
    C = np.clip(B + dC_raw, 0.0, 1.0)
    return {'C': C, 'dC': C - B, 'dC_raw': dC_raw, 'delta': delta, 'iters': int(it), 'converged': conv,
            'maxGdC': maxGdC, 'ok': maxGdC <= TOL_FAIL}


def apply_or_identity(B, F, a):
    """a false → the very same object B, no computation (L428)."""
    return combine(B, F)['C'] if a else B


# ── §1.8 boxes, masks, Pearson ──
def pearson(a, b):
    """n = 0 → None (empty set, report values only); n = 1 or zero variance → 0.0 (L500, R6); else Pearson r."""
    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    if a.size == 0:
        return None
    if a.size == 1:
        return 0.0
    x = a - a.mean()
    y = b - b.mean()
    sxx = float(np.dot(x, x))
    syy = float(np.dot(y, y))
    if sxx == 0.0 or syy == 0.0:
        return 0.0
    return float(np.dot(x, y) / math.sqrt(sxx * syy))


def masks_input(hmax6, zSnow, Bhigh, margin_m=SNOW_MARGIN_M, hi=HI_MASK):
    """MODIS-free M_in (R4): snow = box max h ≥ z_snow − margin (z_snow null → all boxes), high = box mean B_hi ≥ hi."""
    snow = np.ones((NBOX, NBOX), dtype=bool) if zSnow is None else box15_max(hmax6) >= zSnow - margin_m
    high = box15(Bhigh) >= hi
    M = snow | high
    return {'snow': snow, 'high': high, 'M_in': M, 'W_in': ~M}


def sea_box(hmean6):
    """Judging box is 'sea' when ≥ 3 of its 4 cells have hmean6 == 0 (L554, Q-26)."""
    w = (np.asarray(hmean6)[WIN[0]:WIN[1], WIN[0]:WIN[1]] == 0.0).astype(np.int64)
    return w.reshape(NBOX, 2, NBOX, 2).sum(axis=(1, 3)) >= 3


# ── §1.9 sounding interpolation with the ±3 h fallback (L227-L229, Q-10, Q-11) ──
def interp_fallback(times, values, t, index=None):
    """(value | None, how). before = nearest valid hour ≤ t, after = nearest valid hour ≥ t, each within 3 h inclusive.
    Both and equal → 'exact'; both → linear in time ('linear' on the bracket hours ⌊t⌋, ⌊t⌋+1, else 'fallback2');
    one → 'fallback1'; none → (None, 'none'). With no nulls and t off the hour this equals fetch-nwp-ring.interp."""
    if index is None:
        index = {s: i for i, s in enumerate(times)}
    h0 = t.replace(minute=0, second=0, microsecond=0)
    h1 = h0 if h0 == t else h0 + timedelta(hours=1)
    lim = timedelta(hours=FALLBACK_H)

    def val(h):
        i = index.get(hour_key(h))
        return None if i is None else values[i]

    before = after = None
    for kk in range(FALLBACK_H + 1):
        h = h0 - timedelta(hours=kk)
        if t - h > lim:
            break
        v = val(h)
        if v is not None:
            before = (h, v)
            break
    for kk in range(FALLBACK_H + 1):
        h = h1 + timedelta(hours=kk)
        if h - t > lim:
            break
        v = val(h)
        if v is not None:
            after = (h, v)
            break
    if before and after:
        if before[0] == after[0]:
            return before[1], 'exact'
        frac = (t - before[0]).total_seconds() / (after[0] - before[0]).total_seconds()
        how = 'linear' if (before[0] == h0 and after[0] == h0 + timedelta(hours=1)) else 'fallback2'
        return before[1] * (1 - frac) + after[1] * frac, how
    if before or after:
        return (before or after)[1], 'fallback1'
    return None, 'none'


class Sounding:
    """One site record of a fetch-sounding.py file ({lat, lon, elevation, hourly}); derived series cached."""
    def __init__(self, name, rec):
        self.name = name
        self.elevation = rec.get('elevation')            # z_sfc (Q-9)
        self.hourly = rec.get('hourly') or {}
        self.times = list(self.hourly.get('time') or [])
        self.index = {s: i for i, s in enumerate(self.times)}
        self._wind = {}
        self._z0 = None

    def series(self, var):
        s = self.hourly.get(var)
        return s if s is not None else [None] * len(self.times)

    def wind(self, p):
        """Per-hour (U, V) from speed/direction, valid iff both non-null (Q-10)."""
        if p not in self._wind:
            U, V = [], []
            for a, d in zip(self.series(f'wind_speed_{p}hPa'), self.series(f'wind_direction_{p}hPa')):
                if a is None or d is None:
                    U.append(None)
                    V.append(None)
                else:
                    u, v = wind_to_uv(a, d)
                    U.append(u)
                    V.append(v)
            self._wind[p] = (U, V)
        return self._wind[p]

    def at(self, var, t):
        return interp_fallback(self.times, self.series(var), t, self.index)

    def wind_at(self, p, t):
        U, V = self.wind(p)
        u, how = interp_fallback(self.times, U, t, self.index)
        v, _ = interp_fallback(self.times, V, t, self.index)
        return u, v, how

    def z0_hourly(self):
        """z_0°C from the raw values of every hour of the file (None where invalid), for z_snow (§1.11)."""
        if self._z0 is None:
            Ts = {p: self.series(f'temperature_{p}hPa') for p in TEMP_LEVELS}
            Zs = {p: self.series(f'geopotential_height_{p}hPa') for p in TEMP_LEVELS}
            T2 = self.series('temperature_2m')
            self._z0 = [z0_from_profile(self.elevation, T2[i], {p: Ts[p][i] for p in TEMP_LEVELS},
                                        {p: Zs[p][i] for p in TEMP_LEVELS}) for i in range(len(self.times))]
        return self._z0


def load_soundings(path):
    """{site: Sounding} (sorted) from a fetch-sounding.py file; {} if the file does not exist yet."""
    if path is None or not os.path.exists(path):
        return {}
    with open(path) as f:
        d = json.load(f)
    return {k: Sounding(k, d[k]) for k in sorted(d)}


# ── §1.10 thermodynamics (L438-L449) ──
def e_s(Tc):
    """Bolton saturation vapour pressure (hPa)."""
    return 6.112 * math.exp(17.67 * Tc / (Tc + 243.5))


def mixing_q(Tc, RH, p):
    e = RH / 100.0 * e_s(Tc)
    return 0.622 * e / (p - 0.378 * e)


def theta(Tc, p):
    return (Tc + 273.15) * (1000.0 / p) ** (RD / CP)


def theta_v(Tc, RH, p):
    """θ_v = θ(1 + (R_v/R_d − 1) q) (Q-8)."""
    return theta(Tc, p) * (1.0 + (RV / RD - 1.0) * mixing_q(Tc, RH, p))


def gamma_s(T):
    """d ln q_s/dz of a dry-adiabatically lifted parcel: LΓ_d/(R_v T²) − g/(R_d T) (L447)."""
    return LV * GAMMA_D / (RV * T * T) - G0 / (RD * T)


def hw_of(Tbar_K, gamma):
    """H_w = R_v T̄²/(L γ) clipped to [1500, 4000] m; γ ≤ 0 → 2500 m (L444)."""
    if gamma <= 0:
        return HW_DEF
    return min(max(RV * Tbar_K * Tbar_K / (LV * gamma), HW_MIN), HW_MAX)


def s_rel_of(Clm, RHbar):
    """(s_rel, branch): 'inv' = clip((1 − RH̄)/(−Φ⁻¹(C_lm)), 0.05, 0.30) when 0.05 ≤ C_lm ≤ 0.45 and RH̄ < 0.97 (L446),
    else 0.15 'default'; C_lm null → 0.15 'default-noClm' (Q-15)."""
    if Clm is None:
        return SREL_DEF, 'default-noClm'
    if CLM_LO <= Clm <= CLM_HI and RHbar < RH_MAX:
        v = float((1.0 - RHbar) / (-Phinv(np.array([Clm], dtype=np.float64))[0]))
        return min(max(v, SREL_MIN), SREL_MAX), 'inv'
    return SREL_DEF, 'default'


# ── §1.11 freezing level and snow memory (L231-L238, Q-12, Q-49) ──
def z_std(p):
    """Standard-atmosphere height of pressure level p (hPa), m."""
    return 44330.8 * (1.0 - (p / 1013.25) ** 0.190263)


def _deep_underground(p, z_sfc):
    return z_std(p) < z_sfc - UNDERGROUND_MARGIN_M


def z0_from_profile(z_sfc, T2m, T, Z):
    """z_0°C of one profile (T, Z dicts by level, °C and m). Nodes (z_sfc + 2, T2m) then levels p ≥ 500 hPa with Z(p) > z_sfc.
    Deep-underground levels (z_std(p) < z_sfc − 500 m) are skipped when their Z or T is null (Q-49); any other needed null → None.
    T2m < 0 → z_sfc; first crossing T_i ≥ 0 > T_{i+1} → linear; none → Z(500)."""
    if z_sfc is None or T2m is None:
        return None
    nodes = [(z_sfc + 2.0, T2m)]
    for p in TEMP_LEVELS:
        if p < 500:
            continue
        zp, tp = Z.get(p), T.get(p)
        if _deep_underground(p, z_sfc) and (zp is None or tp is None):
            continue
        if zp is None:
            return None
        if zp > z_sfc:
            if tp is None:
                return None
            nodes.append((zp, tp))
    if T2m < 0:
        return float(z_sfc)
    for i in range(len(nodes) - 1):
        (z1, t1), (z2, t2) = nodes[i], nodes[i + 1]
        if t1 >= 0 > t2:
            return float(z1 + (z2 - z1) * t1 / (t1 - t2))
    return float(Z[500])


def z0_at(snd, t):
    """z_0°C from the §1.9-interpolated profile at t (oro-inputs `z0`)."""
    T = {p: snd.at(f'temperature_{p}hPa', t)[0] for p in TEMP_LEVELS}
    Z = {p: snd.at(f'geopotential_height_{p}hPa', t)[0] for p in TEMP_LEVELS}
    return z0_from_profile(snd.elevation, snd.at('temperature_2m', t)[0], T, Z)


def z_snow_at(snd, t, days=21):
    """(z_snow | None, valid hours | None): min of hourly z_0 over the days·24 hours h with t − days·24 h < h ≤ t, from raw
    hours (no interpolation). Fewer than days·12 valid → z_sfc (L238). Window starting before the file's first hour → (None,
    None): that scene drops from that arm only, no splicing of files (L331, M2)."""
    if not snd.times:
        return None, None
    first = t.replace(minute=0, second=0, microsecond=0) - timedelta(hours=days * 24 - 1)
    if first < parse_hour(snd.times[0]):
        return None, None
    z0 = snd.z0_hourly()
    vals = []
    for kk in range(days * 24):
        i = snd.index.get(hour_key(first + timedelta(hours=kk)))
        if i is not None and z0[i] is not None:
            vals.append(z0[i])
    if len(vals) < days * 12:
        return (None if snd.elevation is None else float(snd.elevation)), len(vals)
    return float(min(vals)), len(vals)


# ── §1.12 §3.5 values at time t (L433-L449, L289-L293) ──
def ref_values(snd, t, zref, lat, ring0_low, ring0_mid, model='best_match'):
    """REF dict (S3-design §1.15 schema), steps 1–12 of §1.12. `complete` (A5 sounding part) needs only the step 2–9 values;
    A4-only nulls make A4 false (reason 'null'), inversion-only nulls make `inversion` null, z₀ nulls only z₀."""
    how = {}
    lv = {}
    for p in REF_LEVELS:
        Tp, h1 = snd.at(f'temperature_{p}hPa', t)
        RHp, h2 = snd.at(f'relative_humidity_{p}hPa', t)
        Zp, h3 = snd.at(f'geopotential_height_{p}hPa', t)
        U, V, h4 = snd.wind_at(p, t)
        lv[p] = {'T_C': Tp, 'RH_pct': RHp, 'Z_m': Zp, 'U': U, 'V': V}
        for nm, hw_ in ((f'T{p}', h1), (f'RH{p}', h2), (f'Z{p}', h3), (f'wind{p}', h4)):
            if hw_ in ('exact', 'fallback2', 'fallback1'):
                how[nm] = hw_
    T2m, h5 = snd.at('temperature_2m', t)
    if h5 in ('exact', 'fallback2', 'fallback1'):
        how['T2m'] = h5
    out = {'model': model, 'complete': False, 'missing': [], 'levels': {str(p): lv[p] for p in REF_LEVELS},
           'interpHow': dict(sorted(how.items())), 'T2m_C': T2m, 'refLevels': [], 'refEmpty': False,
           'Vref': None, 'speedRef': None, 'pLo': None, 'pHi': None, 'thetaV': None, 'N2': None, 'N': None,
           'Tbar_K': None, 'RHbar': None, 'gamma_Kpm': None, 'Hw_m': None, 'Clm': None, 'sRel': SREL_DEF,
           'sRelBranch': 'default', 'gammaS': None, 'kappa': None, 'f': 2.0 * OMEGA * math.sin(math.radians(lat)),
           'A4': {'dots': {'700': None, '600': None, '500': None}, 'ok': False, 'reason': 'null'}, 'inversion': None}
    missing = [f'Z{p}' for p in (850, 700) if lv[p]['Z_m'] is None]
    # step 2: reference levels L (Z850 and Z700 literal, L239)
    L = [p for p in (850, 700) if lv[p]['Z_m'] is not None and lv[p]['Z_m'] >= zref + REF_MARGIN_M]
    out['refLevels'] = L
    if not missing and not L:
        out['refEmpty'] = True                  # a = 0: A2 = A3 = A4 = false (Q-14)
        out['A4']['reason'] = 'refEmpty'
    if L:
        # step 3: V_ref = component mean over L
        for p in L:
            if lv[p]['U'] is None or lv[p]['V'] is None:
                missing.append(f'wind{p}')
        if all(lv[p]['U'] is not None and lv[p]['V'] is not None for p in L):
            U = sum(lv[p]['U'] for p in L) / len(L)
            V = sum(lv[p]['V'] for p in L) / len(L)
            out['Vref'] = [U, V]
            out['speedRef'] = math.hypot(U, V)
        # step 4: layer p_lo = lowest level of L, p_hi = 700 (p_lo 850) or 500 (p_lo 700)
        plo = max(L)
        phi_ = 700 if plo == 850 else 500
        out['pLo'], out['pHi'] = plo, phi_
        vals = {}
        for p in (plo, phi_):
            for key, nm in (('T_C', 'T'), ('RH_pct', 'RH'), ('Z_m', 'Z')):
                vals[(p, nm)] = lv[p][key]
                if lv[p][key] is None:
                    missing.append(f'{nm}{p}')
        if all(v is not None for v in vals.values()):
            tlo, thi = vals[(plo, 'T')], vals[(phi_, 'T')]
            rlo, rhi = vals[(plo, 'RH')], vals[(phi_, 'RH')]
            zlo, zhi = vals[(plo, 'Z')], vals[(phi_, 'Z')]
            tvl, tvh = theta_v(tlo, rlo, plo), theta_v(thi, rhi, phi_)             # step 5
            N2 = (G0 / (0.5 * (tvl + tvh))) * (tvh - tvl) / (zhi - zlo)
            out['thetaV'] = [tvl, tvh]
            out['N2'] = N2
            out['N'] = min(max(math.sqrt(max(N2, 0.0)), N_MIN), N_MAX)
            Tbar = 0.5 * (tlo + thi) + 273.15                                         # step 6
            RHbar = 0.5 * (rlo + rhi) / 100.0
            gam = -(thi - tlo) / (zhi - zlo)
            out['Tbar_K'], out['RHbar'], out['gamma_Kpm'] = Tbar, RHbar, gam
            out['Hw_m'] = hw_of(Tbar, gam)                                              # step 7
            Clm = None if (ring0_low is None or ring0_mid is None) else 1.0 - (1.0 - ring0_low) * (1.0 - ring0_mid)
            out['Clm'] = Clm
            out['sRel'], out['sRelBranch'] = s_rel_of(Clm, RHbar)                       # step 8
            out['gammaS'] = gamma_s(Tbar)                                               # step 9
            out['kappa'] = out['gammaS'] / out['sRel']
        # step 10: A4 — every level p ∈ {700, 600, 500} with Z(p) > z_ref has V(p)·V̂_ref > 0 (Q-13)
        dots = {'700': None, '600': None, '500': None}
        reason = None
        if out['speedRef'] is None:
            reason = 'null'
        elif out['speedRef'] == 0.0:
            reason = 'dot'
        else:
            ux, vy = out['Vref'][0] / out['speedRef'], out['Vref'][1] / out['speedRef']
            all_pos = True
            for p in (700, 600, 500):
                if lv[p]['Z_m'] is None:
                    reason = 'null'
                    break
                if lv[p]['Z_m'] > zref:
                    if lv[p]['U'] is None or lv[p]['V'] is None:
                        reason = 'null'
                        break
                    dots[str(p)] = lv[p]['U'] * ux + lv[p]['V'] * vy
                    all_pos = all_pos and dots[str(p)] > 0
            if reason is None:
                reason = 'ok' if all_pos else 'dot'
        out['A4'] = {'dots': dots, 'ok': reason == 'ok', 'reason': reason}
    out['inversion'] = inversion_at(snd, t, T2m)                                         # step 11
    out['missing'] = sorted(set(missing))                                                # step 12
    out['complete'] = not out['missing']
    return out


def inversion_at(snd, t, T2m):
    """Surface inversion (L305, Q-41): lowest level with Z(p) > z_sfc (deep-underground nulls skipped); flag = T(p) > T2m.
    Any needed null → None (split bin 'unknown')."""
    z_sfc = snd.elevation
    if z_sfc is None or T2m is None:
        return None
    for p in TEMP_LEVELS:
        zp = snd.at(f'geopotential_height_{p}hPa', t)[0]
        tp = snd.at(f'temperature_{p}hPa', t)[0]
        if _deep_underground(p, z_sfc) and (zp is None or tp is None):
            continue
        if zp is None:
            return None
        if zp > z_sfc:
            return None if tp is None else {'level': p, 'flag': bool(tp > T2m)}
    return None


# ── §1.13 B loader, sun position ──
def load_B(scene, time_key, band, inputs, base_dir, n64=False):
    """.harness/oro/base/<scene>__<time>__<band>[__n64].f32 → float64 (n, n), sha256-checked against oro-inputs (mismatch →
    raise). None when oro-inputs carries no sha for it (not sealed yet, or B null: < 12 ring points)."""
    tm = inputs['scenes'][scene]['times'][time_key]
    shas = tm.get('bSha256n64' if n64 else 'bSha256')
    if not shas or shas.get(band) is None:
        return None
    n = 64 if n64 else N_GRID
    p = os.path.join(base_dir, f'{scene}__{time_key}__{band}' + ('__n64' if n64 else '') + '.f32')
    with open(p, 'rb') as f:
        body = f.read()
    if sha256_bytes(body) != shas[band]:
        raise ValueError(f'B sha256 mismatch: {scene} {time_key} {band}' + (' n64' if n64 else ''))
    return np.frombuffer(body, dtype='<f4').reshape(n, n).astype(np.float64)


def _sun_series(t, lon):
    """Shared series of ring/solar_util.sun_alt_deg (NOAA approximation with the equation of time; Q-30), verbatim."""
    doy = t.timetuple().tm_yday
    frac_h = t.hour + t.minute / 60 + t.second / 3600
    g = math.radians((360 / 365.25) * (doy - 1 + (frac_h - 12) / 24))
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    tst = frac_h * 60 + eqt + 4 * lon
    return decl, math.radians(tst / 4 - 180)


def sun_alt_deg(t, lat, lon):
    """Copy of ring/solar_util.sun_alt_deg (t aware UTC; test U-SUN)."""
    decl, ha = _sun_series(t, lon)
    la = math.radians(lat)
    sin_alt = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1, min(1, sin_alt))))


def sun_az_deg(t, lat, lon):
    """Sun azimuth, degrees clockwise from north, from the same series (M4, L592; test U-SUNAZ)."""
    decl, ha = _sun_series(t, lon)
    la = math.radians(lat)
    a = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(decl) * math.cos(la)))
    return (a + 180.0) % 360.0


def ang_dist(a, b):
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


# ── §1.15 builders ──
def env_record():
    """Interpreter/library environment recorded in oro-apply.sources.env (D2, D3)."""
    try:
        from numpy._core import _multiarray_umath as mu
    except ImportError:                     # numpy 1.x
        from numpy.core import _multiarray_umath as mu
    import PIL
    return {'python': platform.python_version(), 'numpy': np.__version__, 'Pillow': PIL.__version__,
            'machine': platform.machine(), 'numpyCpuBaseline': sorted(mu.__cpu_baseline__),
            'numpyCpuDispatch': sorted(mu.__cpu_dispatch__)}


def build_dem_grids(manifest_path, dem_dir):
    with open(manifest_path) as f:
        man = json.load(f)
    sites = {}
    for s, (la, lo, _g) in sites_table().items():
        if s in man['sites']:
            sites[s] = site_dem_grid(s, la, lo, man, dem_dir)
        else:
            sites[s] = _dem_site_empty(la, lo, None)
    return {'schema': 'dem-grids/1', 'grid': GRID_META,
            'mapping': 'equirectangular: lat=lat0+y/111.32, lon=lon0+x/(111.32 cos lat0); pixel centre in cell',
            'decode': 'R*256+G+B/256-32768; h=max(0,elev) per pixel; no despike',
            'sources': {'demManifestSha256': sha256_file(manifest_path)}, 'sites': sites}


def latest_from_passes(entry):
    """latest rule exactly as fetch-modis-time.py: candidates = passes with `center`, else all; max mid (Q-21, U-LATEST)."""
    ps = entry.get('passes') or []
    if not ps:
        return entry['modisTimeUtc']
    cands = [p for p in ps if p.get('center')] or ps
    return max(cands, key=lambda p: parse_utc(p['mid']))['mid']


class RingRaw:
    """ring/nwp/<tag>/<site>.json: per point and variable, fetch-nwp-ring.blend over the full series (cached), then
    fetch-nwp-ring.interp on the two bracket hours — the same lookup and formula as a full-series call (test B-RING)."""
    def __init__(self, path):
        with open(path) as f:
            self.raw = json.load(f)
        self._bl = {}

    def _blended(self, j, var):
        key = (j, var)
        if key not in self._bl:
            h = self.raw['data'][j].get('hourly') or {}
            times = list(h.get('time') or [])
            s = fetch_nwp().blend(h, var, self.raw['models']) if times else None
            self._bl[key] = (times, s if s is not None else [None] * len(times), {x: i for i, x in enumerate(times)})
        return self._bl[key]

    def value(self, j, var, t_iso):
        """Cover fraction (Open-Meteo % / 100.0) or None (null, or hours outside the raw range — D9)."""
        times, s, idx = self._blended(j, var)
        i0 = idx.get(hour_key(parse_utc(t_iso).replace(minute=0, second=0)))     # bracket hour ⌊t⌋
        if i0 is None:
            return None
        v = fetch_nwp().interp(times[i0:i0 + 2], s[i0:i0 + 2], t_iso)
        return None if v is None else v / 100.0


SOUNDING_NULL_VARS = sorted(['temperature_2m'] + [f'temperature_{p}hPa' for p in TEMP_LEVELS if p >= 500]
                            + [f'geopotential_height_{p}hPa' for p in TEMP_LEVELS if p >= 500]
                            + [f'relative_humidity_{p}hPa' for p in REF_LEVELS]
                            + [f'wind_{k}_{p}hPa' for p in REF_LEVELS for k in ('speed', 'direction')])


def default_sounding_manifest(sounding_path):
    """fetch-sounding.py naming: <stem>.json → tools/genus-ruler/oro/<stem>-manifest.json."""
    stem = os.path.basename(sounding_path)
    stem = stem[:-5] if stem.endswith('.json') else stem
    return os.path.join(HERE, f'{stem}-manifest.json')


def sounding_source(path, snds, manifest_path):
    """Provenance of a sounding file (M7): sounding.json is a re-serialisation, so per site hourlySha256 of
    json.dumps(hourly, sort_keys, compact), elevation, hour range and null counts of the §3.5/z₀ variables (manifest first)."""
    if not snds:
        return None
    man = {}
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path) as f:
            man = json.load(f)
    sites = {}
    for s in sorted(snds):
        sd = snds[s]
        ms = (man.get('sites') or {}).get(s) or {}
        mn = ms.get('nulls') or {}
        nulls = {}
        for v in SOUNDING_NULL_VARS:
            if mn.get(v) is not None:
                nulls[v] = int(mn[v])
            else:
                ser = sd.hourly.get(v)
                nulls[v] = len(sd.times) if ser is None else sum(1 for x in ser if x is None)
        sites[s] = {'hourlySha256': sha256_bytes(json.dumps(sd.hourly, sort_keys=True, separators=(',', ':')).encode('utf-8')),
                    'elevation': sd.elevation, 'firstHour': sd.times[0] if sd.times else None,
                    'lastHour': sd.times[-1] if sd.times else None, 'nulls': nulls}
    return {'path': rel(path), 'fileSha256': sha256_file(path),
            'manifestSha256': sha256_file(manifest_path) if (manifest_path and os.path.exists(manifest_path)) else None,
            'sites': sites}


def build_inputs(banks=('orig',), sounding=None, sounding_ecmwf=None, dem_grids=None, table=None, sounding_manifest=None,
                 ring_dir=None):
    """oro-inputs.json (S3-design §1.15). All bank scenes are stored (Q-19). Pending lists are derived from the data on disk
    (D4): sites with no sounding record get snd null at every time, so re-running after the 11-05 soundings needs no change."""
    table = table or bank_table
    sounding = sounding or _path(D_SOUNDING)
    sounding_ecmwf = sounding_ecmwf or _path(D_SOUNDING_ECMWF)
    dem_grids = dem_grids or _path(D_DEM_GRIDS)
    ring_dir = ring_dir or _path(D_RING_NWP)
    sites = sites_table()
    order = ring91()
    with open(dem_grids) as f:
        dg = json.load(f)
    snd_main = load_soundings(sounding)
    snd_ecm = load_soundings(sounding_ecmwf)
    sources = {'demGridsSha256': sha256_file(dem_grids), 'times': {}, 'ringRaw': {},
               'sounding': {'bestMatch': sounding_source(sounding, snd_main, sounding_manifest or default_sounding_manifest(sounding)),
                            'ecmwf': sounding_source(sounding_ecmwf, snd_ecm, default_sounding_manifest(sounding_ecmwf))},
               'code': {'fetch-nwp-ring.py': sha256_file(_path(FETCH_NWP_REL)), 'fetch-sat.py': sha256_file(_path(FETCH_SAT_REL))}}
    scenes, rings, pend_ring = {}, {}, set()
    for bank in banks:
        bt = table(bank)
        tpath = _path(bt['times'])
        with open(tpath) as f:
            times = json.load(f)
        sources['times'][rel(tpath)] = sha256_file(tpath)
        latest = None
        if bt.get('latest'):
            lpath = _path(bt['latest'])
            with open(lpath) as f:
                latest = json.load(f)
            sources['times'][rel(lpath)] = sha256_file(lpath)
        # orig/ext share the main sounding file (06-01..10-31); pre2/extN have their own (L331)
        bsnd = snd_main if bank in ('orig', 'ext') else load_soundings(_path(bt['sounding']))
        bdir = _path(bt['dir'])
        names = [n for n in bank_scene_names(bdir) if n in times] if os.path.isdir(bdir) else []
        for name in names:
            site, date = name.rsplit('_', 1)
            meta = load_scene_meta(os.path.join(bdir, name + '.json'))      # allow-list only
            la, lo, grp = sites[site]
            if not (meta['site'] == site and meta['lat'] == la and meta['lon'] == lo and meta['date'] == date):
                raise ValueError(f'{name}: site/lat/lon/date differ from SITES/name')
            if not (meta['grid'] == 256 and float(meta['cellKm']) == 3.0):
                raise ValueError(f'{name}: grid/cellKm differ from 256/3.0')
            if [(r['dist'], r['az']) for r in meta['ring']] != order:
                raise ValueError(f'{name}: ring geometry differs from fetch-sat RING')
            rkey = (bt['ringTag'], site)
            if rkey not in rings:
                rp = os.path.join(ring_dir, bt['ringTag'], f'{site}.json')
                rings[rkey] = RingRaw(rp) if os.path.exists(rp) else None
                if rings[rkey] is None:
                    pend_ring.add(site)
                else:
                    sources['ringRaw'][f'{bt["ringTag"]}/{site}'] = sha256_file(rp)
                    if [(p['dist'], p['az']) for p in rings[rkey].raw['points']] != order:
                        raise ValueError(f'ring raw {bt["ringTag"]}/{site}: points not in fetch-sat RING order')
            rr = rings[rkey]
            ent = times[name]
            tc = parse_utc(ent['modisTimeUtc'])
            tlist = {'closest': ent['modisTimeUtc'],
                     'latest': latest[name]['modisTimeUtc'] if latest is not None else latest_from_passes(ent),
                     'm1h': fmt_utc(tc - timedelta(seconds=3600)), 'p1h': fmt_utc(tc + timedelta(seconds=3600))}
            sd, se = bsnd.get(site), snd_ecm.get(site)
            dsite = dg['sites'][site]
            zr = dsite['zRefM']
            tout = {}
            for tk in TIME_KEYS:
                t = parse_utc(tlist[tk])
                t_iso = fmt_utc(t)
                ring, ring0 = {}, {}
                for band in BANDS:
                    vals = ([None] * len(order) if rr is None
                            else [rr.value(j, BAND_VAR[band], t_iso) for j in range(len(order))])
                    ring[band] = ring_entry(vals)
                    ring0[band] = vals[0]
                e = {'utc': t_iso, 'ring': ring, 'snd': None, 'sndEcmwf': None, 'z0': None,
                     'zSnow': None, 'zSnowValidHours': None, 'zSnow7': None, 'zSnowValidHours7': None,
                     'zSnow42': None, 'zSnowValidHours42': None, 'bSha256': None}
                if tk == 'closest':
                    e['bSha256n64'] = None
                if sd is not None and zr is not None:
                    e['snd'] = ref_values(sd, t, zr, la, ring0['low'], ring0['mid'])
                    e['z0'] = z0_at(sd, t)
                    e['zSnow'], e['zSnowValidHours'] = z_snow_at(sd, t, 21)
                    e['zSnow7'], e['zSnowValidHours7'] = z_snow_at(sd, t, SNOW_DAYS_ARMS[0])
                    e['zSnow42'], e['zSnowValidHours42'] = z_snow_at(sd, t, SNOW_DAYS_ARMS[1])
                if se is not None and zr is not None:
                    e['sndEcmwf'] = ref_values(se, t, zr, la, ring0['low'], ring0['mid'], model='ecmwf_ifs025')
                tout[tk] = e
            scenes[name] = {'site': site, 'lat': la, 'lon': lo, 'date': date, 'group': grp, 'bank': bank,
                            'multiPass': bool(ent.get('multiPass')), 'seam': bool(ent.get('seam')),
                            'ringGeom': {'dist': [int(d) for d, _ in order], 'az': [int(a) for _, a in order]},
                            'demTiles': dsite['tilesUsed'], 'zSfc': None if sd is None else sd.elevation, 'zRef': zr,
                            'times': tout}
    return {'schema': 'oro-inputs/1', 'grid': GRID_META,
            'ring': {'n': len(order), 'order': 'fetch-sat RING, observer first', 'encoding': 'f64b64 LE, NaN=null, nullIdx'},
            'pendingSites': {'sounding': sorted(s for s in sites if s not in snd_main), 'ring': sorted(pend_ring)},
            'sources': sources, 'scenes': dict(sorted(scenes.items()))}


def unsealed_text(inp):
    """dumps_json of `inp` with bSha256/bSha256n64 cleared: the bytes oro-base was built from (idempotent re-seal)."""
    import copy
    c = copy.deepcopy(inp)
    for sc in c['scenes'].values():
        for tk, tm in sc['times'].items():
            tm['bSha256'] = None
            if tk == 'closest':
                tm['bSha256n64'] = None
    return dumps_json(c)


def seal_inputs(inputs_path, index_path):
    """Copy the oro-base B sha256 into oro-inputs.json (S3-design §1.15). The index must come from this file (or its unsealed
    form, for a re-seal); already-filled values must equal the index. Returns the written text."""
    with open(inputs_path, 'rb') as f:
        raw = f.read()
    with open(index_path) as f:
        idx = json.load(f)
    inp = json.loads(raw)
    if idx.get('inputsFileSha256') not in (sha256_bytes(raw), sha256_bytes(unsealed_text(inp).encode('utf-8'))):
        raise ValueError('seal-inputs: index inputsFileSha256 is not the sha256 of oro-inputs.json')
    ent, e64 = idx.get('entries') or {}, idx.get('entriesN64') or {}
    for sc in sorted(inp['scenes']):
        for tk in sorted(inp['scenes'][sc]['times']):
            tm = inp['scenes'][sc]['times'][tk]
            new = {b: (ent.get(sc) or {}).get(tk, {}).get(b) for b in BANDS}
            if tm.get('bSha256') not in (None, new):
                raise ValueError(f'seal-inputs: {sc} {tk} bSha256 differs from the index')
            tm['bSha256'] = new
            if tk == 'closest':
                n64 = {b: (e64.get(sc) or {}).get(b) for b in BANDS}
                if tm.get('bSha256n64') not in (None, n64):
                    raise ValueError(f'seal-inputs: {sc} bSha256n64 differs from the index')
                tm['bSha256n64'] = n64
    return dump_json(inp, inputs_path)


# ── §1.14 scene evaluation (MODIS-free) ──
def ring_arrays(tm):
    return {b: dec_f64(tm['ring'][b]['f64']) for b in BANDS}


def nhu_bin(v):
    if v is None:
        return None
    return 'le1' if v <= 1.0 else ('1to3' if v <= 3.0 else 'gt3')


class SiteCache:
    """Per-site decoded-float32 DEM arrays and derived fields; A1 recomputed and required equal to dem-grids (same code)."""
    def __init__(self, dg):
        self.dg = dg
        self._c = {}

    def get(self, site):
        if site not in self._c:
            ent = self.dg['sites'][site]
            arr = dem_site_arrays(ent)
            if arr is not None:
                hsub, a1 = h_sub_field(arr['hmean6'])
                if a1 != ent['a1RmsM']:
                    raise ValueError(f'{site}: A1 differs from dem-grids.json (rebuild dem-grids with this code)')
                a, b = WIN
                arr.update({'hsub': hsub, 'a1': a1, 'sea': sea_box(arr['hmean6']), 'hsub15': box15(hsub),
                            'maxAbsHsubWin': float(np.max(np.abs(hsub[a:b, a:b])))})
            self._c[site] = arr
        return self._c[site]


def _a6(c):
    return {'iters': c['iters'], 'converged': c['converged'], 'maxGdC': c['maxGdC'], 'ok': c['ok']}


def evaluate_scene(name, sc, dem, geom_scene, Bs, ext_target_sites):
    """One oro-apply row (S3-design §1.14) from oro-inputs (sc), decoded DEM (dem), cmr-geom (geom_scene) and the closest-time
    B per band (None when not built/sealed yet → `bMissing`, A6/A7 unknown, judge false). No MODIS input."""
    site = sc['site']
    tm = sc['times']['closest']
    snd = tm['snd']
    held = sc['group'] == 'held'
    A1 = {'rmsM': None if dem is None else dem['a1'], 'ok': bool(dem is not None and dem['a1'] >= A1_RMS_M)}
    rings = ring_arrays(tm)
    ring_null = {b: int(np.sum(np.isnan(rings[b]))) for b in BANDS}
    snd_ok = bool(snd is not None and snd['complete'])
    a5 = bool(dem is not None and snd_ok and all(ring_null[b] <= RING_NULL_MAX for b in BANDS))
    usable = snd is not None and not snd['refEmpty']
    A2 = {'speed': None if snd is None else snd['speedRef'],
          'ok': bool(usable and snd['speedRef'] is not None and snd['speedRef'] >= A2_SPEED)}
    A3 = {'N2': None if snd is None else snd['N2'], 'ok': bool(usable and snd['N2'] is not None and snd['N2'] >= A3_N2)}
    A4 = ({'dots': dict(snd['A4']['dots']), 'ok': bool(snd['A4']['ok']), 'reason': snd['A4']['reason']} if snd is not None
          else {'dots': {'700': None, '600': None, '500': None}, 'ok': False, 'reason': 'null'})
    A8 = {'ok': bool(geom_scene is not None and geom_scene.get('A8') is True),
          'status': 'absent' if geom_scene is None else geom_scene['status']}
    t = parse_utc(tm['utc'])
    sun_az = sun_az_deg(t, sc['lat'], sc['lon'])
    excl = []
    if dem is not None:
        excl = [b for b in range(NBOX * NBOX) if dem['slopeDeg15'][b] >= SUN_SLOPE_MIN_DEG
                and ang_dist(dem['aspectDeg15'][b], sun_az) <= SUN_AZ_HALF_DEG]
    nhu = None
    if dem is not None and usable and snd['speedRef'] and snd['N'] is not None:
        nhu = snd['N'] * dem['maxAbsHsubWin'] / snd['speedRef']
    ct = None if geom_scene is None else geom_scene.get('crossTrackKm')

    def ring_ok(tk):    # B of that time exists iff every band has ≥ 12 finite ring points (oro-base rule, Q-31, D9)
        rg = ring_arrays(sc['times'][tk])
        return all(int(np.sum(np.isfinite(rg[b]))) >= RING_MIN_POINTS for b in BANDS)

    def snd_ok_at(tk):
        s = sc['times'][tk]['snd']
        return bool(s is not None and s['complete'] and not s['refEmpty'])

    row = {'site': site, 'date': sc['date'], 'group': sc['group'], 'bank': sc['bank'],
           'singlePass': not sc['multiPass'], 'multiPass': sc['multiPass'], 'seam': sc['seam'],
           'A1': A1, 'A2': A2, 'A3': A3, 'A4': A4,
           'A5': {'dem': dem is not None, 'sounding': snd_ok, 'soundingMissing': ['site'] if snd is None else list(snd['missing']),
                  'ringNull': ring_null, 'ok': a5},
           'A6': {'judge': None, 'app': None}, 'A7': {'S': None, 'ok': False}, 'A8': A8,
           'appA': False, 'judge': False, 'counted': False, 'devJudgeable': None, 'bMissing': False,
           'counts': None, 'Ddc': None, 'preCorr': None,
           'split': {'crossTrackKm': ct, 'crossTrackLE430': None if ct is None else bool(ct <= CROSS_TRACK_SPLIT_KM),
                     'coastShareW': None, 'surfaceInversion': None if (snd is None or snd['inversion'] is None) else snd['inversion']['flag'],
                     'NhU': nhu, 'NhUBin': nhu_bin(nhu), 'sunAzDeg': sun_az, 'sunSlopeExcl': excl},
           'm8': {'member': False, 'rmsDC': None, 'rmsDCapp': None},
           'lambdaApp': None, 'maskedAppShare': None, 'G7corr': None,
           'armInputs': {'zSnow7': tm['zSnow7'] is not None, 'zSnow42': tm['zSnow42'] is not None,
                         'latest': ring_ok('latest') and snd_ok_at('latest'), 'm1h': ring_ok('m1h') and snd_ok_at('m1h'),
                         'p1h': ring_ok('p1h') and snd_ok_at('p1h'), 'n64': ring_ok('closest')},
           'sunAltDeg': sun_alt_deg(t, sc['lat'], sc['lon']), 'extSunOk': None, 'extTarget': None}
    if sc['bank'] != 'orig':
        row['extSunOk'] = bool(row['sunAltDeg'] >= EXT_SUN_MIN_DEG)
        row['extTarget'] = site in ext_target_sites
    if a5 and usable and snd['speedRef'] is not None and snd['speedRef'] > 0:
        if any(Bs.get(b) is None for b in BANDS):
            row['bMissing'] = True
        else:
            lat = sc['lat']
            F = forcing(dem['hsub'], snd, lat)
            Fr = forcing(dem['hsub'], snd, lat, rev=True)
            Bt = Bs['total']
            cj, cr = combine(Bt, F), combine(Bt, Fr)
            clo, cmi = combine(Bs['low'], F), combine(Bs['mid'], F)
            row['A6'] = {'judge': _a6(cj), 'app': {'low': _a6(clo), 'mid': _a6(cmi), 'ok': bool(clo['ok'] and cmi['ok'])}}
            mk = masks_input(dem['hmax6'], tm['zSnow'], Bs['high'])
            Win = mk['W_in']
            d15, dr15 = box15(cj['dC']), box15(cr['dC'])
            S = Win & (np.abs(d15) >= DC_SEL)
            Scup = Win & ((np.abs(d15) >= DC_SEL) | (np.abs(dr15) >= DC_SEL))
            nS, nW = int(S.sum()), int(Win.sum())
            row['A7'] = {'S': nS, 'ok': nS >= A7_MIN_S}
            row['counts'] = {'W': nW, 'S': nS, 'Scup': int(Scup.sum()), 'maskedSnow': int(mk['snow'].sum()),
                             'maskedHigh': int(mk['high'].sum()), 'maskedBoth': int((mk['snow'] & mk['high']).sum())}
            F15, Fr15 = box15(F), box15(Fr)
            row['Ddc'] = pearson(F15[Win], box15(Bt - gauss_smooth(Bt, SIGMA_G_M))[Win])          # L573, Q-27
            row['preCorr'] = {'F_hsub': pearson(F15[S], dem['hsub15'][S]), 'Frev_hsub': pearson(Fr15[S], dem['hsub15'][S]),
                              'dC_B': pearson(d15[S], box15(Bt)[S])}                               # L541
            row['split']['coastShareW'] = float(np.sum(dem['sea'] & Win)) / nW if nW else None
            row['m8']['rmsDC'] = float(np.sqrt(np.mean(d15 ** 2)))                                  # Q-18
    a6j = row['A6']['judge'] is not None and row['A6']['judge']['ok']
    a6a = row['A6']['app'] is not None and row['A6']['app']['ok']
    a15 = A1['ok'] and A2['ok'] and A3['ok'] and A4['ok'] and a5
    row['appA'] = bool(a15 and a6a)
    row['judge'] = bool(a15 and a6j and row['A7']['ok'] and A8['ok'])                               # L298
    if not held:
        row['devJudgeable'] = row['judge']                                                          # Q-44
    row['counted'] = bool(held and row['judge'] and (sc['bank'] == 'orig' or (row['extSunOk'] and row['extTarget'])))
    row['m8']['member'] = bool(held and row['appA'] and (not row['A7']['ok'] or not A8['ok']))      # L307
    return row


def _median(v):
    v = [x for x in v if x is not None]
    return float(np.median(np.array(v, dtype=np.float64))) if v else None


ARMS = ('latest', 'm1h', 'n64', 'p1h', 'zSnow42', 'zSnow7')


def summarize(rows, pending, a1_by_site, ext_target_sites, ecmwf_available):
    """oro-apply summary (S3-design §1.15), recomputable from the rows (test B-SUM). Counts and medians use `counted`
    scenes (held judge scenes, orig + counted ext; M6)."""
    names = sorted(rows)
    cnt = [n for n in names if rows[n]['counted']]
    per = {}
    for n in cnt:
        per[rows[n]['site']] = per.get(rows[n]['site'], 0) + 1
    per = dict(sorted(per.items()))
    nC = len(cnt)
    nd = len({rows[n]['date'] for n in cnt})
    share = (max(per.values()) / nC) if nC else None
    c1 = {'n>=20': nC >= 20, 'dates>=8': nd >= 8, 'sites>=3': len(per) >= 3,
          'maxShare<=0.5': bool(share is not None and share <= 0.5)}
    c1['pass'] = all(c1.values())
    gs = sorted(s for s, k in per.items() if k >= 3)
    gsc = sum(per[s] for s in gs)
    a5m = {}
    for n in names:
        r = rows[n]
        if r['group'] == 'held' and not r['A5']['ok'] and r['A5']['soundingMissing'] != ['site']:
            for v in r['A5']['soundingMissing']:
                a5m[v] = a5m.get(v, 0) + 1
    m8 = sorted(n for n in names if rows[n]['m8']['member'])
    ddc = _median([rows[n]['Ddc'] for n in cnt])
    bmiss = sum(1 for n in names if rows[n]['bMissing'])
    return {'provisional': bool(pending.get('sounding') or pending.get('ring') or bmiss),
            'pendingSites': {'sounding': list(pending.get('sounding') or []), 'ring': list(pending.get('ring') or [])},
            'bMissing': bmiss, 'ecmwfArm': 'available' if ecmwf_available else '못 잼(미수신)',
            'n': nC, 'nDates': nd, 'nSites': len(per), 'perSite': per, 'maxSiteShare': share, 'c1': c1,
            'a1BySite': a1_by_site, 'a5SoundingMissing': dict(sorted(a5m.items())),
            'nSinglePassJudge': sum(1 for n in cnt if rows[n]['singlePass']),
            'gshufSites': gs, 'gshufScenes': gsc, 'c3bMeasurable': gsc >= 10,
            'devJudgeable': sorted(n for n in names if rows[n]['devJudgeable']),
            'extTargetSites': sorted(ext_target_sites),
            'm8': {'count': len(m8), 'scenes': m8},
            'armDrops': {a: sum(1 for n in cnt if not rows[n]['armInputs'][a]) for a in ARMS},
            'DdcMedian': ddc, 'primaryMetric': 'rho_fine' if (ddc is not None and ddc >= DDC_PRIMARY) else 'rho_res',
            'lambdaAppMedian': None, 'lambdaTilde': None, 'maskedAppShareMedian': None, 'G7median': None}


def build_apply(inputs_path, dem_grids, cmr_geom, base_dir):
    """oro-apply.json (S3-design §1.15). Refuses while cmr-geom has 'missing-granules' scenes (R-G4)."""
    with open(inputs_path) as f:
        inputs = json.load(f)
    with open(dem_grids) as f:
        dg = json.load(f)
    with open(cmr_geom) as f:
        geom = json.load(f)
    if any(v.get('status') == 'missing-granules' for v in geom['scenes'].values()):
        raise ValueError('cmr-geom.json has missing-granules scenes: run oro-geom.py --fetch-missing first')
    cache = SiteCache(dg)
    a1_by_site = {}
    for s in sorted(dg['sites']):
        d = cache.get(s)
        a1_by_site[s] = {'rmsM': None if d is None else d['a1'], 'ok': bool(d is not None and d['a1'] >= A1_RMS_M)}
    ext_target = sorted(s for s, (_, _, g) in sites_table().items() if g == 'held' and a1_by_site[s]['ok'])   # L314
    rows = {}
    for name in sorted(inputs['scenes']):
        sc = inputs['scenes'][name]
        Bs = {b: load_B(name, 'closest', b, inputs, base_dir) for b in BANDS}
        rows[name] = evaluate_scene(name, sc, cache.get(sc['site']), geom['scenes'].get(name), Bs, ext_target)
    base = None
    ip = os.path.join(base_dir, 'index.json')
    if os.path.exists(ip):
        with open(ip) as f:
            bi = json.load(f)
        base = {'commit': bi.get('commit'), 'bundleSha256': bi.get('bundleSha256'), 'esbuild': bi.get('esbuild')}
    summary = summarize(rows, inputs.get('pendingSites') or {}, a1_by_site, ext_target,
                        inputs['sources']['sounding']['ecmwf'] is not None)
    return {'schema': 'oro-apply/1',
            'sources': {'oroInputsSha256': sha256_file(inputs_path), 'demGridsSha256': sha256_file(dem_grids),
                        'cmrGeomSha256': sha256_file(cmr_geom), 'base': base,
                        'code': {'oro_ref.py': sha256_file(os.path.abspath(__file__)),
                                 'fetch-nwp-ring.py': sha256_file(_path(FETCH_NWP_REL)),
                                 'fetch-sat.py': sha256_file(_path(FETCH_SAT_REL))},
                        'env': env_record()},
            'constants': CONSTANTS, 'scenes': rows, 'summary': summary}


# ── CLI for this part (registered in COMMANDS) ──
def _wrote(path, s):
    print(f'WROTE {rel(path)} sha256 {sha256_bytes(s.encode("utf-8"))}')


def cmd_dem_grids(argv):
    o = _parse(argv, {'--manifest': D_DEM_MANIFEST, '--dem-dir': D_DEM_DIR, '--out': D_DEM_GRIDS})
    doc = build_dem_grids(os.path.abspath(o['--manifest']), os.path.abspath(o['--dem-dir']))
    s = dump_json(doc, o['--out'])
    nc = sum(1 for v in doc['sites'].values() if v['complete'])
    print(f'DEM sites {len(doc["sites"])} complete {nc}')
    _wrote(o['--out'], s)
    return 0 if nc == len(doc['sites']) else 1


def cmd_inputs(argv):
    o = _parse(argv, {'--banks': 'orig', '--out': D_INPUTS, '--sounding': D_SOUNDING, '--sounding-ecmwf': D_SOUNDING_ECMWF,
                      '--sounding-manifest': '', '--dem-grids': D_DEM_GRIDS})
    doc = build_inputs(tuple(_csv(o['--banks'])), os.path.abspath(o['--sounding']), os.path.abspath(o['--sounding-ecmwf']),
                       os.path.abspath(o['--dem-grids']),
                       sounding_manifest=os.path.abspath(o['--sounding-manifest']) if o['--sounding-manifest'] else None)
    s = dump_json(doc, o['--out'])
    sc = doc['scenes']
    ws = sum(1 for v in sc.values() if v['times']['closest']['snd'] is not None)
    wc = sum(1 for v in sc.values() if v['times']['closest']['snd'] is not None and v['times']['closest']['snd']['complete'])
    print(f'INPUTS scenes {len(sc)} withSounding {ws} completeClosest {wc} '
          f'pendingSounding {len(doc["pendingSites"]["sounding"])} pendingRing {len(doc["pendingSites"]["ring"])}')
    _wrote(o['--out'], s)
    return 0


def cmd_seal_inputs(argv):
    o = _parse(argv, {'--inputs': D_INPUTS, '--base-index': D_BASE + '/index.json'})
    s = seal_inputs(os.path.abspath(o['--inputs']), os.path.abspath(o['--base-index']))
    _wrote(o['--inputs'], s)
    return 0


def cmd_apply(argv):
    o = _parse(argv, {'--inputs': D_INPUTS, '--dem-grids': D_DEM_GRIDS, '--cmr-geom': D_CMR_GEOM, '--base': D_BASE,
                      '--out': D_APPLY})
    doc = build_apply(os.path.abspath(o['--inputs']), os.path.abspath(o['--dem-grids']), os.path.abspath(o['--cmr-geom']),
                      os.path.abspath(o['--base']))
    s = dump_json(doc, o['--out'])
    sm = doc['summary']
    for site, v in sm['a1BySite'].items():      # DEM/NWP-only numbers (allowed)
        rms = 'null' if v['rmsM'] is None else f'{v["rmsM"]:.1f}'
        print(f'  {site:9s} A1 rms {rms} ok {v["ok"]} counted {sm["perSite"].get(site, 0)}')
    tag = 'PROVISIONAL ' if sm['provisional'] else ''
    print(f'{tag}c1 n {sm["n"]} dates {sm["nDates"]} sites {sm["nSites"]} maxShare {sm["maxSiteShare"]} pass {sm["c1"]["pass"]}')
    print(f'APPLY scenes {len(doc["scenes"])} bMissing {sm["bMissing"]} pendingSounding {len(sm["pendingSites"]["sounding"])}')
    _wrote(o['--out'], s)
    return 0


COMMANDS.update({'dem-grids': cmd_dem_grids, 'inputs': cmd_inputs, 'seal-inputs': cmd_seal_inputs, 'apply': cmd_apply})
# ═══════════════════════ S3a MODEL + BUILDERS — END ═══════════════════════


def main(argv):
    install_guard()                                     # 가드가 맨 먼저(§0.1)
    if not argv or argv[0] not in COMMANDS:
        print(f'usage: oro_ref.py <{"|".join(sorted(COMMANDS))}> [opts]', file=sys.stderr)
        return 2
    return COMMANDS[argv[0]](argv[1:])


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
