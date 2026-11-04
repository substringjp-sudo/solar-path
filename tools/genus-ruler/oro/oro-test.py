#!/usr/bin/env python3
"""
oro-test.py — RULER-oro 동결 전 시험(동결 파일, 자 L874). 설계: tools/genus-ruler/oro/S3-design.md §5.

  python3 -I tools/genus-ruler/oro/oro-test.py [--fetch-ref] [--only ID[,ID…]] [--out tools/genus-ruler/oro/oro-test.txt]

한 시험이 한 줄: `ID PASS|FAIL|SKIP key=value…`(MODIS 없는 값만, 수는 %.6g). 파일은 머리말 뒤에 id 순으로 정렬한 줄, 시각 없음.
exit 0 iff FAIL 없음. SKIP 은 동결 문턱(§9.1 ⑨)의 통과가 아닙니다. --only 로 돌리면 --out 을 주지 않는 한 파일을 쓰지 않습니다.
맨 먼저 열기 가드(oro_ref.install_guard)를 겁니다(§0.1).

지금 들어 있는 시험(S3a 'JS + manifest' 몫):
  B-BASE   §5.2: 실제 봉인 oro-inputs.json 과 .harness/oro/base 로 oro-base.mjs --check(n128·n64 diff 0), 봉인된 B 마다
           load_B(sha256) 로 읽어 유한·[0, 1], closest 의 n64 는 n128 이 null 이 아닌 밴드에만. 둘 중 하나가 없으면 SKIP.
  B-BASE0  합성 oro-inputs 고정물(.harness/oro/test/)로 oro-base.mjs 의 B = buildMacroField 를 직접 부른 값(작업 트리
           macroField.ts 를 따로 묶은 번들)과 바이트 비교, index.json, --check(봉인·변조·미봉인), Q-45(115fbe2 번들 = HEAD 번들).
           자의 시험이 아니라 구현 확인(값 기준 없음, 비트 같음만).
  B-MAN    ring-manifest · bank-manifest: 두 번(따로 python3 -I) 만들어 바이트 같음, 커밋 파일과 같음, 꼴(크기 없음, C1),
           합성 은행에서 index.json 을 열지 않고 PNG 는 png-hash 안에서만 엶.
  G8a      §5.4: 가짜 trueGrid·cover·empty 를 넣은 inputs 사본으로 oro-base 출력이 바이트 같음, fs-audit 로 연 파일·부른
           명령이 허용 목록 안, 경로 인자 추가는 거절(C5).
  U-ALLOW  §1.13 의 로더 몫(허용 키만, 해시만). 'builder 출력이 가짜 키에 무관' 몫은 inputs 빌더와 함께 더합니다.
  U-GUARD  §5.1: 금지 꼴마다 감사 훅이 파일을 건드리기 전에 PermissionError(없는 이름으로만 시험), png-judge 는 lock 이
           있을 때만, 심볼릭 링크 우회 막힘, 이 실행이 __pycache__ 를 쓰지 않음.
"""
import sys
sys.dont_write_bytecode = True

import base64
import contextlib
import hashlib
import io
import importlib.util
import json
import os
import re
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PYC_DIRS = [os.path.join(ROOT, 'tools', 'genus-ruler', d, '__pycache__') for d in ('macro', 'ring', 'oro')]


def _pyc_snapshot():
    return {d: sorted(os.listdir(d)) if os.path.isdir(d) else None for d in PYC_DIRS}


PYC_AT_START = _pyc_snapshot()          # 다른 무엇을 부르기 전에(U-GUARD)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


O = _load('oro_ref', os.path.join(HERE, 'oro_ref.py'))
O.install_guard()

import numpy as np                      # noqa: E402  (가드 뒤)

ORO_BASE = os.path.join(HERE, 'oro-base.mjs')
FIX = os.path.join(ROOT, '.harness', 'oro', 'test')         # 합성 oro-inputs 고정물(B-BASE0, 실제 inputs 가 없을 때 G8a)
TMP = os.path.join(ROOT, '.harness', 'oro', 'test-tmp')     # 시험 임시(§0.4)
REAL_INPUTS = os.path.join(HERE, 'oro-inputs.json')
REAL_BASE = os.path.join(ROOT, '.harness', 'oro', 'base')  # oro-base.mjs 기본 --out(B-BASE)
BANDS = ('total', 'low', 'mid', 'high')
TIME_KEYS = ('closest', 'latest', 'm1h', 'p1h')
SEED = 20261103
Q45_COMMIT = '115fbe2'                  # 합친 커밋(Q-45): 그 번들 sha256 = HEAD 번들이어야 함
TS_PATHS = ('src/utils/macroField.ts', 'src/components/VolumetricProbe/cloudFlow.ts')

HEADER = (
    "# Pinned additions, not ruler values: G6(a) eight-case split (Q-32), G6(b) rms definition and precip_base/precip_min "
    "(Q-33), G6(d) mountains, bands and the report-only easterly mirror (Q-34), G6(e) quadrant sea-fraction thresholds (Q-35). "
    "Q-34/Q-35 were pinned after a DEM-only prototype run (no MODIS, no B); criteria are fixed as written before the first "
    "oro-test run (L793).\n"
)

TESTS = []


def test(tid):
    def deco(fn):
        TESTS.append((tid, fn))
        return fn
    return deco


class Skip(Exception):
    pass


class Checks:
    """조건을 모아 PASS/FAIL 을 정함. 실패한 조건 이름은 줄에 fail=… 로."""

    def __init__(self):
        self.failed = []
        self.kv = {}

    def __call__(self, cond, name):
        if not cond:
            self.failed.append(name)
        return bool(cond)

    def result(self):
        kv = dict(self.kv)
        if self.failed:
            kv['fail'] = ','.join(self.failed[:12]) + (f',+{len(self.failed) - 12}' if len(self.failed) > 12 else '')
        return (not self.failed), kv


def fmt(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float):
        return '%.6g' % v
    if v is None:
        return 'null'
    return re.sub(r'\s+', '_', str(v))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def fresh_dir(p):
    shutil.rmtree(p, ignore_errors=True)
    os.makedirs(p)
    return p


def read_bytes(p):
    with open(p, 'rb') as f:
        return f.read()


def run_oro_base(args, extra_node=(), env=None):
    """node oro-base.mjs … → (returncode, stdout 줄, stderr). stdout 은 sha256·이름·수뿐."""
    r = subprocess.run(['node', *extra_node, ORO_BASE, *args], cwd=ROOT, capture_output=True, text=True, timeout=1800,
                       env=env)
    return r.returncode, r.stdout.splitlines(), r.stderr


def parse_base_stdout(lines):
    out = {'bundle': None, 'commit': None, 'B': {}, 'check': {}, 'diff': []}
    for ln in lines:
        p = ln.split()
        if not p:
            continue
        if p[0] == 'BUNDLE':
            out['bundle'], out['commit'] = p[1], p[p.index('commit') + 1]
        elif p[0] == 'B':
            out['B'][(p[1], p[2], p[3], int(p[4]))] = None if p[5] == 'null' else p[5]
        elif p[0] == 'CHECK':
            out['check'][p[1]] = {'same': int(p[3]), 'diff': int(p[5]), 'null': int(p[7])}
        elif p[0] == 'DIFF':
            out['diff'].append(tuple(p[1:]))
    return out


def f32_name(scene, t, band, n):
    return f'{scene}__{t}__{band}.f32' if n == 128 else f'{scene}__{t}__{band}__n64.f32'


# ───────────────────────── 합성 oro-inputs 고정물 ─────────────────────────
FIX_SCENES = ('fixa_2026-09-01', 'fixb_2026-09-05', 'fixc_2026-09-09', 'fixd_2026-09-13')


def make_base_fixture(d=FIX):
    """
    S3-design §1.15 꼴의 작은 oro-inputs(4 장면 × 4 시각 × 4 밴드, 고리 기하 = fetch-sat RING). 운량은 합성: 매끈한 방위·거리
    무늬 + 잡음을 정시 두 값(정수 %)으로 만들고 inputs 빌더처럼 시간 선형 보간 /100.0(정확한 0·1 포함). 일부러 넣은 경우:
      - 평소: 관측점이 아닌 3 점 NaN(nullIdx)
      - fixa closest total: NaN 없음 · fixb p1h: 네 밴드 모두 NaN(은행 끝 시각 팔, D9) → B null
      - fixc closest high: 유한 11 점 → B null(n128·n64) · fixd closest low: 유한 정확히 12 점 → B 있음
    samples.json: 같은 값의 '직접 경로' 입력(유한 점만, cover = c·100 을 float64 로, JSON 은 repr 왕복 정확).
    """
    os.makedirs(d, exist_ok=True)
    R = O.ring91()
    dist = np.array([p[0] for p in R], dtype=np.float64)
    az = np.array([p[1] for p in R], dtype=np.float64)
    rng = np.random.default_rng(SEED)
    scenes, samples = {}, {}
    for si, name in enumerate(FIX_SCENES):
        site, date = name.rsplit('_', 1)
        phase = rng.uniform(0, 2 * np.pi)
        times, samples[name] = {}, {}
        for tk in TIME_KEYS:
            ring, samples[name][tk] = {}, {}
            for band in BANDS:
                base = 0.5 + 0.45 * np.sin(np.radians(az) + phase) * (dist / 380.0) + rng.normal(0, 0.12, 91)
                a = np.clip(np.round(100 * (base + rng.normal(0, 0.05, 91))), 0, 100)
                b = np.clip(np.round(100 * (base + rng.normal(0, 0.05, 91))), 0, 100)
                frac = float(rng.uniform(0.05, 0.95))
                c = (a * (1 - frac) + b * frac) / 100.0
                null = sorted(int(i) for i in rng.choice(np.arange(1, 91), 3, replace=False))
                if (name, tk, band) == ('fixa_2026-09-01', 'closest', 'total'):
                    null = []
                    c[5], c[6] = 0.0, 1.0
                if (name, tk) == ('fixb_2026-09-05', 'p1h'):
                    null = list(range(91))
                if (name, tk, band) == ('fixc_2026-09-09', 'closest', 'high'):
                    null = list(range(11, 91))       # 유한 11 점
                if (name, tk, band) == ('fixd_2026-09-13', 'closest', 'low'):
                    null = list(range(12, 91))       # 유한 12 점
                c[null] = np.nan
                ring[band] = {'f64': base64.b64encode(c.astype('<f8').tobytes()).decode('ascii'), 'nullIdx': null}
                fin = [i for i in range(91) if np.isfinite(c[i])]
                samples[name][tk][band] = None if len(fin) < 12 else {
                    'dist': [float(dist[i]) for i in fin], 'az': [float(az[i]) for i in fin],
                    'pct': [float(c[i] * 100.0) for i in fin]}
            hh = 1 + si
            utc = {'closest': f'{date}T0{hh}:30:00Z', 'latest': f'{date}T0{hh}:40:00Z',
                   'm1h': f'{date}T0{hh - 1}:30:00Z', 'p1h': f'{date}T0{hh + 1}:30:00Z'}[tk]
            times[tk] = {'utc': utc, 'ring': ring, 'snd': None, 'sndEcmwf': None, 'z0': None,
                         'zSnow': None, 'zSnowValidHours': 0, 'zSnow7': None, 'zSnowValidHours7': 0,
                         'zSnow42': None, 'zSnowValidHours42': None, 'bSha256': None}
            if tk == 'closest':
                times[tk]['bSha256n64'] = None
        scenes[name] = {'site': site, 'lat': 36.0 + si, 'lon': 127.0 + si, 'date': date, 'group': 'dev', 'bank': 'orig',
                        'multiPass': False, 'seam': False,
                        'ringGeom': {'dist': [int(x) for x in dist], 'az': [int(x) for x in az]},
                        'demTiles': {}, 'zSfc': None, 'zRef': 0.0, 'times': times}
    doc = {'schema': 'oro-inputs/1',
           'grid': {'n': 128, 'cellKm': 6.0, 'rows': 'south->north', 'cols': 'west->east', 'observer': 'corner of cells 63/64'},
           'ring': {'n': 91, 'order': 'fetch-sat RING, observer first', 'encoding': 'f64b64 LE, NaN=null, nullIdx'},
           'sources': {'fixture': 'oro-test.py make_base_fixture (synthetic, no MODIS)', 'demGridsSha256': None, 'times': {},
                       'ringRaw': {}, 'sounding': {'bestMatch': None, 'ecmwf': None}, 'code': {}},
           'scenes': scenes}
    O.dump_json(doc, os.path.join(d, 'oro-inputs.json'))
    O.dump_json(samples, os.path.join(d, 'samples.json'))
    return doc, samples


def seal_copy(doc, index):
    """seal-inputs 와 같은 일(시험 안에서): index 의 sha256 을 times[*].bSha256 / closest.bSha256n64 로."""
    d = json.loads(json.dumps(doc))
    for s, sc in d['scenes'].items():
        for t, e in sc['times'].items():
            e['bSha256'] = dict(index['entries'][s][t])
            if t == 'closest':
                e['bSha256n64'] = dict(index['entriesN64'][s])
    return d


DIRECT_CJS = r"""'use strict';
// B-BASE0 의 직접 경로: 작업 트리 macroField.ts 를 따로 묶은 번들로 buildMacroField 를 부릅니다(oro-base 를 거치지 않음).
const fs = require('fs'), path = require('path');
const [bundle, samplesPath, outDir] = process.argv.slice(2);
const M = require(bundle);
const S = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
let k = 0;
for (const name of Object.keys(S).sort()) for (const t of Object.keys(S[name]).sort()) for (const b of Object.keys(S[name][t]).sort()) {
  const e = S[name][t][b];
  if (e === null) continue;
  for (const n of (t === 'closest' ? [128, 64] : [128])) {
    const pts = e.dist.map((d, i) => ({ distance: d, azimuthOffset: e.az[i], cover: e.pct[i] }));
    const B = M.buildMacroField(M.samplesFromRing(pts), { n, cellKm: n === 128 ? 6 : 12, noise: false }).base;
    fs.writeFileSync(path.join(outDir, `${name}__${t}__${b}${n === 64 ? '__n64' : ''}.f32`), Buffer.from(B.buffer, B.byteOffset, B.byteLength));
    k++;
  }
}
console.log('DIRECT', k);
"""


@test('B-BASE0')
def t_base0():
    ck = Checks()
    doc, samples = make_base_fixture()
    fx_inputs = os.path.join(FIX, 'oro-inputs.json')
    out = fresh_dir(os.path.join(FIX, 'base'))
    rc, lines, err = run_oro_base(['--inputs', fx_inputs, '--out', out])
    if not ck(rc == 0, 'run'):
        ck.kv['stderr'] = err.strip().splitlines()[-1][:120] if err.strip() else ''
        return ck.result()
    st = parse_base_stdout(lines)
    head = subprocess.run(['git', 'rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], cwd=ROOT, capture_output=True,
                          text=True).stdout.strip()
    idx = json.loads(read_bytes(os.path.join(out, 'index.json')))
    bundle_file = os.path.join(ROOT, '.harness', 'oro', 'base-bundle', st['commit'], 'macro.cjs')
    ck(st['commit'] == head == idx['commit'], 'commit')
    ck(idx['schema'] == 'oro-base-index/1' and idx['esbuild'] == '0.28.2', 'indexSchema')
    ck(idx['inputsFileSha256'] == sha(read_bytes(fx_inputs)), 'inputsSha')
    ck(idx['bundleSha256'] == st['bundle'] == sha(read_bytes(bundle_file)), 'bundleSha')
    ck(sorted(os.listdir(os.path.dirname(bundle_file))) ==
       ['entry.ts', 'macro.cjs', 'package.json', 'src', 'tsconfig.json'], 'bundleDir')
    ck(read_bytes(os.path.join(out, 'index.json')).endswith(b'\n'), 'indexNewline')

    # 직접 경로: 작업 트리 macroField.ts(= HEAD 여야 함)를 저장소 뿌리에서 따로 묶어 buildMacroField 를 부름
    clean = subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', *TS_PATHS], cwd=ROOT).returncode == 0
    ck(clean, 'worktreeTsEqualsHead')
    dd = fresh_dir(os.path.join(FIX, 'direct'))
    with open(os.path.join(dd, 'entry.ts'), 'w') as f:
        f.write(f"export {{ buildMacroField, samplesFromRing }} from '{os.path.join(ROOT, 'src', 'utils', 'macroField.ts')}';\n")
    with open(os.path.join(dd, 'direct.cjs'), 'w') as f:
        f.write(DIRECT_CJS)
    r = subprocess.run(['npx', '--yes', 'esbuild@0.28.2', os.path.join(dd, 'entry.ts'), '--bundle', '--format=cjs',
                        '--platform=node', f'--outfile={os.path.join(dd, "macro.cjs")}', '--log-level=warning'],
                       cwd=ROOT, capture_output=True, text=True)
    if not ck(r.returncode == 0, 'directBundle'):
        return ck.result()
    r = subprocess.run(['node', os.path.join(dd, 'direct.cjs'), os.path.join(dd, 'macro.cjs'),
                        os.path.join(FIX, 'samples.json'), os.path.join(dd, 'B')], cwd=ROOT, capture_output=True, text=True)
    if not ck(r.returncode == 0, 'directRun'):
        return ck.result()
    ck.kv['directBundle'] = sha(read_bytes(os.path.join(dd, 'macro.cjs')))[:12]

    n = {128: [0, 0], 64: [0, 0]}
    n_same, bmin, bmax, distinct = 0, 1.0, 0.0, set()
    for s in FIX_SCENES:
        for t in TIME_KEYS:
            for b in BANDS:
                for nn in ((128, 64) if t == 'closest' else (128,)):
                    rec = idx['entries'][s][t][b] if nn == 128 else idx['entriesN64'][s][b]
                    ck(st['B'].get((s, t, b, nn), 'missing') == rec, f'stdout:{s}:{t}:{b}:{nn}')
                    p_base = os.path.join(out, f32_name(s, t, b, nn))
                    p_dir = os.path.join(dd, 'B', f32_name(s, t, b, nn))
                    expect_null = samples[s][t][b] is None
                    if rec is None:
                        n[nn][1] += 1
                        ck(expect_null and not os.path.exists(p_base) and not os.path.exists(p_dir), f'null:{s}:{t}:{b}:{nn}')
                        continue
                    n[nn][0] += 1
                    if not ck(not expect_null, f'notNull:{s}:{t}:{b}:{nn}'):     # < 12 점인데 B 가 있음
                        continue
                    bb = read_bytes(p_base)
                    ck(len(bb) == 4 * nn * nn and sha(bb) == rec, f'file:{s}:{t}:{b}:{nn}')
                    if ck(os.path.exists(p_dir) and read_bytes(p_dir) == bb, f'direct:{s}:{t}:{b}:{nn}'):
                        n_same += 1
                    B = np.frombuffer(bb, dtype='<f4').astype(np.float64)
                    ck(np.all(np.isfinite(B)) and B.min() >= 0.0 and B.max() <= 1.0, f'range:{s}:{t}:{b}:{nn}')
                    # 고리 전체(≥ 80 점)면 무늬가 있어야 함; 12 점(10 km 안)만 있는 밴드는 멀리서 평균으로 채워져 거의 평평
                    ck(B.std() > (0.01 if len(samples[s][t][b]['dist']) >= 80 else 0.0), f'flat:{s}:{t}:{b}:{nn}')
                    bmin, bmax = min(bmin, float(B.min())), max(bmax, float(B.max()))
                    distinct.add(rec)
    ck(n[128][1] == 5 and n[64][1] == 1, 'expectedNulls')     # fixb p1h ×4 + fixc closest high; n64: fixc high
    ck(len(distinct) == n[128][0] + n[64][0], 'distinct')
    ck.kv.update({'n128': n[128][0], 'null128': n[128][1], 'n64': n[64][0], 'null64': n[64][1], 'sameAsDirect': n_same,
                  'bmin': bmin, 'bmax': bmax, 'bundle': st['bundle'][:12]})

    # --check: 봉인 → 0, 한 sha 바꿈 → 1(diff 1), 미봉인 → 1
    sealed = seal_copy(doc, idx)
    p_sealed = os.path.join(FIX, 'oro-inputs.sealed.json')
    O.dump_json(sealed, p_sealed)
    rc0, l0, _ = run_oro_base(['--inputs', p_sealed, '--check'])
    c0 = parse_base_stdout(l0)['check']
    ck(rc0 == 0 and c0.get('n128', {}).get('diff') == 0 and c0.get('n64', {}).get('diff') == 0
       and c0['n128']['same'] == n[128][0] and c0['n128']['null'] == n[128][1]
       and c0['n64']['same'] == n[64][0] and c0['n64']['null'] == n[64][1], 'checkSealed')
    tam = json.loads(json.dumps(sealed))
    e = tam['scenes'][FIX_SCENES[0]]['times']['closest']['bSha256']
    e['total'] = ('0' if e['total'][0] != '0' else '1') + e['total'][1:]
    p_tam = os.path.join(FIX, 'oro-inputs.tampered.json')
    O.dump_json(tam, p_tam)
    rc1, l1, _ = run_oro_base(['--inputs', p_tam, '--check'])
    c1 = parse_base_stdout(l1)
    ck(rc1 == 1 and c1['check']['n128']['diff'] == 1 and c1['check']['n64']['diff'] == 0
       and c1['diff'] == [(FIX_SCENES[0], 'closest', 'total', '128', 'sha')], 'checkTampered')
    rc2, l2, _ = run_oro_base(['--inputs', fx_inputs, '--check'])
    c2 = parse_base_stdout(l2)['check']
    ck(rc2 == 1 and c2['n128']['diff'] == n[128][0] + n[128][1] and c2['n64']['diff'] == n[64][0] + n[64][1],
       'checkUnsealed')
    ck.kv['check'] = f'{rc0}/{rc1}/{rc2}'

    # Q-45: 합친 커밋 115fbe2 의 번들 = HEAD 번들(같은 macroField.ts·cloudFlow.ts), 그 번들로도 --check 가 0
    rc3, l3, _ = run_oro_base(['--inputs', p_sealed, '--check', '--commit', Q45_COMMIT])
    q = parse_base_stdout(l3)
    ck(rc3 == 0 and q['bundle'] == st['bundle'], 'q45')
    ck.kv['q45'] = 'same' if q['bundle'] == st['bundle'] else 'differs'
    return ck.result()


def base_check(inputs_path, base_dir, commit=Q45_COMMIT):
    """B-BASE body (S3-design §5.2) for one sealed oro-inputs + its oro-base output folder: `oro-base.mjs --check` exit 0
    with diff 0 at n = 128 and n = 64; every sealed B loads through O.load_B (sha256-checked), is (n, n), finite and in
    [0, 1]; at the closest time n = 64 is null exactly where n = 128 is null. Line values are counts only."""
    ck = Checks()
    rc, lines, err = run_oro_base(['--inputs', inputs_path, '--commit', commit, '--check'])
    st = parse_base_stdout(lines)
    c = st['check']
    ck(rc == 0, 'checkExit')
    ck(c.get('n128', {}).get('diff') == 0 and c.get('n64', {}).get('diff') == 0, 'checkDiff0')
    if rc != 0 and err.strip():
        ck.kv['stderr'] = err.strip().splitlines()[-1][:120]
    with open(inputs_path) as f:
        inp = json.load(f)
    n = {128: [0, 0], 64: [0, 0]}
    for s in sorted(inp['scenes']):
        for t in sorted(inp['scenes'][s]['times']):
            tm = inp['scenes'][s]['times'][t]
            rec = tm.get('bSha256')
            if not ck(isinstance(rec, dict) and sorted(rec) == sorted(BANDS), f'sealed:{s}:{t}'):
                continue
            r64 = None
            if t == 'closest':
                r64 = tm.get('bSha256n64')
                if not ck(isinstance(r64, dict) and sorted(r64) == sorted(BANDS), f'sealed64:{s}'):
                    r64 = None
            for b in BANDS:
                arms = [(128, rec[b])]
                if r64 is not None:
                    ck((r64[b] is None) == (rec[b] is None), f'n64PresentIffN128:{s}:{b}')
                    arms.append((64, r64[b]))
                for nn, h in arms:
                    if h is None:
                        n[nn][1] += 1
                        continue
                    n[nn][0] += 1
                    try:
                        B = O.load_B(s, t, b, inp, base_dir, n64=(nn == 64))
                    except (OSError, ValueError) as e:
                        ck(False, f'load:{s}:{t}:{b}:{nn}:{type(e).__name__}')
                        continue
                    ck(B is not None and B.shape == (nn, nn) and bool(np.all(np.isfinite(B)))
                       and 0.0 <= float(B.min()) and float(B.max()) <= 1.0, f'range:{s}:{t}:{b}:{nn}')
    for nn in (128, 64):
        cc = c.get(f'n{nn}', {})
        ck(cc.get('same') == n[nn][0] and cc.get('null') == n[nn][1], f'countsEqualCheck{nn}')
    ck.kv.update({'scenes': len(inp['scenes']), 'n128': n[128][0], 'null128': n[128][1], 'n64': n[64][0],
                  'null64': n[64][1], 'check': rc, 'bundle': (st['bundle'] or '')[:12]})
    return ck.result()


@test('B-BASE')
def t_base():
    """S3-design §5.2 B-BASE on the real sealed tools/genus-ruler/oro/oro-inputs.json and .harness/oro/base (SKIP until
    the full build: inputs → oro-base.mjs → seal-inputs)."""
    if not (os.path.exists(REAL_INPUTS) and os.path.exists(os.path.join(REAL_BASE, 'index.json'))):
        raise Skip('real sealed inputs absent')
    # --check with the commit that built this B folder (§0.5 step 6 repeats step 4's --commit: 115fbe2 now, later the G1
    # baseline commit), so the test follows the build instead of pinning a commit here.
    commit = _jload(os.path.join(REAL_BASE, 'index.json'))['commit']
    ok, kv = base_check(REAL_INPUTS, REAL_BASE, commit=commit)
    kv['commit'] = commit[:12]
    return ok, kv


# ───────────────────────── G8(a) ─────────────────────────
FS_AUDIT_CJS = r"""'use strict';
// G8(a) 감사(node --require): oro-base.mjs 가 여는 파일과 부르는 자식 명령을 ORO_FS_AUDIT 파일에 JSON 줄로 적습니다.
const fs = require('fs'), cp = require('child_process'), path = require('path');
const LOG = process.env.ORO_FS_AUDIT;
const append = fs.appendFileSync;                       // 감싸지 않은 원본(기록용)
const log = rec => append(LOG, JSON.stringify(rec) + '\n');
const pathOf = p => typeof p === 'number' ? null : path.resolve(p instanceof URL ? p.pathname : String(p));
const wrapFs = (obj, names, tag) => {
  for (const fn of names) {
    const orig = obj[fn];
    if (typeof orig !== 'function') continue;
    obj[fn] = function (p, ...rest) {
      const flag = (fn === 'openSync' || fn === 'open') ? (typeof rest[0] === 'string' ? rest[0] : 'r')
        : (rest[0] && typeof rest[0] === 'object' && rest[0].flag) || null;
      log({ kind: 'fs', fn: tag + fn, path: pathOf(p), fd: typeof p === 'number', flag });
      return orig.call(this, p, ...rest);
    };
  }
};
wrapFs(fs, ['readFileSync', 'openSync', 'readFile', 'open', 'createReadStream', 'existsSync', 'readdirSync', 'statSync',
            'lstatSync', 'accessSync', 'opendirSync'], '');
wrapFs(fs.promises, ['readFile', 'open', 'readdir', 'stat'], 'promises.');
for (const fn of ['execFileSync', 'execFile', 'spawnSync', 'spawn', 'execSync', 'exec', 'fork']) {
  const orig = cp[fn];
  cp[fn] = function (cmd, ...rest) {
    const args = Array.isArray(rest[0]) ? rest[0].map(String) : [];
    const opts = (Array.isArray(rest[0]) ? rest[1] : rest[0]) || {};
    log({ kind: 'cp', fn, cmd: String(cmd), args, cwd: opts.cwd ? path.resolve(String(opts.cwd)) : process.cwd() });
    return orig.call(this, cmd, ...rest);
  };
}
"""


def _inject_fake(doc):
    """가짜 trueGrid·cover·empty 를 맨 위·장면·시각(그리고 고리 밴드·ringGeom, 장면 JSON 꼴의 ring[].cover)에 넣음."""
    rng = np.random.default_rng(SEED + 8)
    tg = base64.b64encode(rng.integers(0, 256, 65536, dtype=np.uint8).tobytes()).decode('ascii')

    def fake():
        return {'trueGrid': tg, 'cover': float(rng.uniform()), 'empty': float(rng.uniform())}
    doc.update(fake())
    for sc in doc['scenes'].values():
        sc.update(fake())
        sc['ringGeom']['cover'] = [float(x) for x in rng.uniform(size=91)]
        sc['ring'] = [{'dist': d, 'az': a, 'cover': float(rng.uniform())}
                      for d, a in zip(sc['ringGeom']['dist'], sc['ringGeom']['az'])]
        for e in sc['times'].values():
            e.update(fake())
            for bd in e['ring'].values():
                bd['cover'] = [float(x) for x in rng.uniform(size=91)]
    return doc


@test('G8a')
def t_g8a():
    ck = Checks()
    if os.path.exists(REAL_INPUTS):
        src, raw = 'real', read_bytes(REAL_INPUTS)
    else:
        if not os.path.exists(os.path.join(FIX, 'oro-inputs.json')):
            make_base_fixture()
        src, raw = 'fixture', read_bytes(os.path.join(FIX, 'oro-inputs.json'))
    d = fresh_dir(os.path.join(TMP, 'g8a'))
    p_orig, p_fake = os.path.join(d, 'inputs-orig.json'), os.path.join(d, 'inputs-fake.json')
    with open(p_orig, 'wb') as f:
        f.write(raw)
    doc = json.loads(raw)
    scenes3 = sorted(doc['scenes'])[:3]
    O.dump_json(_inject_fake(doc), p_fake)
    del doc
    ck.kv.update({'src': src, 'scenes': len(scenes3)})

    runs = {}
    for tag, p in (('orig', p_orig), ('fake', p_fake)):
        o = os.path.join(d, f'out-{tag}')
        rc, lines, err = run_oro_base(['--inputs', p, '--scenes', ','.join(scenes3), '--out', o])
        if not ck(rc == 0, f'run-{tag}'):
            ck.kv['stderr'] = err.strip().splitlines()[-1][:120] if err.strip() else ''
            return ck.result()
        runs[tag] = (o, parse_base_stdout(lines), json.loads(read_bytes(os.path.join(o, 'index.json'))))
    (oa, sa, ia), (ob, sb, ib) = runs['orig'], runs['fake']
    ck(ia['inputsFileSha256'] != ib['inputsFileSha256'], 'inputsDiffer')        # 가짜 파일이 실제로 입력이었음
    ck(ia['entries'] == ib['entries'] and ia['entriesN64'] == ib['entriesN64'], 'indexSame')
    ck(sa['B'] == sb['B'] and sa['bundle'] == sb['bundle'], 'stdoutSame')
    fa, fb = sorted(os.listdir(oa)), sorted(os.listdir(ob))
    ck(fa == fb, 'fileSet')
    n_b = 0
    for fn in fa:
        if fn.endswith('.f32'):
            n_b += 1
            ck(read_bytes(os.path.join(oa, fn)) == read_bytes(os.path.join(ob, fn)), f'bytes:{fn}')
    ck(n_b > 0 and set(k[0] for k in sa['B']) == set(scenes3), 'nonEmpty')
    ck.kv['b'] = n_b

    # 감사 실행: 연 파일 ⊆ {inputs 사본, 번들, oro-base.mjs}, 쓴 파일 ⊆ {out, 번들 폴더}, 금지 꼴 없음, 명령 허용 목록
    audit_js, audit_log = os.path.join(d, 'fs-audit.cjs'), os.path.join(d, 'audit.jsonl')
    with open(audit_js, 'w') as f:
        f.write(FS_AUDIT_CJS)
    open(audit_log, 'w').close()
    oc = os.path.join(d, 'out-audit')
    env = dict(os.environ, ORO_FS_AUDIT=audit_log)
    rc, lines, err = run_oro_base(['--inputs', p_fake, '--scenes', ','.join(scenes3), '--out', oc],
                                  extra_node=('--require', audit_js), env=env)
    if not ck(rc == 0, 'run-audit'):
        return ck.result()
    sc = parse_base_stdout(lines)
    ck(sc['B'] == sa['B'], 'auditSame')
    commit = sc['commit']
    bdir = os.path.realpath(os.path.join(ROOT, '.harness', 'oro', 'base-bundle', commit))
    bfile = os.path.join(bdir, 'macro.cjs')
    allowed_read = {os.path.realpath(p_fake), bfile, os.path.realpath(ORO_BASE)}
    with open(audit_log) as f:
        recs = [json.loads(x) for x in f if x.strip()]
    # 내용 읽기(readFile*, createReadStream, 읽기 깃발의 open*) ⊆ allowed_read. 쓰기와 메타 호출(stat·readdir·exists 등,
    # 남은 B 지우기 rmSync 가 부름)은 oro-base 자신의 out 폴더·번들 폴더 안에서만.
    reads, writes, meta, cmds, bad = set(), set(), set(), [], []
    forbid = re.compile(r'(/\.harness/macro/|/ring/nwp/|\.png$|/sounding[^/]*\.json$|/\.harness/oro/sat-)')
    content_fns = {'readFileSync', 'readFile', 'createReadStream', 'promises.readFile'}
    open_fns = {'openSync', 'open', 'promises.open'}
    for r in recs:
        if r['kind'] == 'cp':
            cmds.append(r)
            continue
        if r['path'] is None:
            continue
        p = os.path.realpath(r['path'])
        if forbid.search(p):
            bad.append(p)
        if r['fn'] in open_fns:
            (writes if (r['flag'] or 'r')[0] in 'wa' else reads).add(p)
        elif r['fn'] in content_fns:
            reads.add(p)
        else:
            meta.add(p)
    own = lambda p: p == bdir or p.startswith(bdir + os.sep) or p.startswith(os.path.realpath(oc) + os.sep)  # noqa: E731
    extra_reads = sorted(p for p in reads if p not in allowed_read)
    extra_writes = sorted(p for p in writes if not own(p))
    extra_meta = sorted(p for p in meta if not own(p))
    ck(not bad, 'forbiddenPath')
    ck(not extra_reads, 'extraReads')
    ck(not extra_writes, 'extraWrites')
    ck(not extra_meta, 'extraMeta')
    ck(os.path.realpath(p_fake) in reads and bfile in reads, 'expectedReads')
    want_cmds = [('git', ['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], ROOT)]
    want_cmds += [('git', ['show', f'{commit}:{p}'], ROOT) for p in TS_PATHS]
    want_cmds += [('npx', ['--yes', 'esbuild@0.28.2', '--version'], bdir),
                  ('npx', ['--yes', 'esbuild@0.28.2', 'entry.ts', '--bundle', '--format=cjs', '--platform=node',
                           '--outfile=macro.cjs', '--log-level=warning'], bdir)]
    got_cmds = [(r['cmd'], r['args'], os.path.realpath(r['cwd'])) for r in cmds]
    ck(got_cmds == want_cmds, 'commands')
    ck.kv.update({'reads': len(reads), 'writes': len(writes), 'meta': len(meta), 'extra': len(extra_reads + extra_writes + extra_meta),
                  'forbidden': len(bad), 'cmds': len(got_cmds)})
    if extra_reads + extra_writes + extra_meta:
        ck.kv['extraPath'] = O.shown((extra_reads + extra_writes + extra_meta)[0])

    # C5: 경로를 가리키는 다른 선택지는 받지 않음(아무것도 만들지 않고 exit 2)
    rc5, l5, _ = run_oro_base(['--inputs', p_fake, '--bank', '.harness/macro/sat', '--out', os.path.join(d, 'out-c5')])
    ck(rc5 == 2 and not l5 and not os.path.exists(os.path.join(d, 'out-c5')), 'c5')
    return ck.result()


# ───────────────────────── B-MAN ─────────────────────────
def _man_cli(cmd, out, extra=()):
    r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'oro_ref.py'), cmd, *extra, '--out', out], cwd=ROOT,
                       capture_output=True, text=True, timeout=1800)
    return r.returncode, r.stdout.splitlines()


def _committed_list(path, key, default):
    """커밋된 manifest 의 tag·은행 목록(확장 뒤에도 같은 목록으로 다시 만들어 견주게). 없으면 기본값."""
    if not os.path.exists(path):
        return default
    with open(path, 'rb') as f:
        return ','.join(sorted(json.loads(f.read()).get(key) or {})) or default


def _keys_recursive(x, acc):
    if isinstance(x, dict):
        for k, v in x.items():
            acc.add(k)
            _keys_recursive(v, acc)
    elif isinstance(x, list):
        for v in x:
            _keys_recursive(v, acc)
    return acc


@test('B-MAN')
def t_man():
    ck = Checks()
    d = fresh_dir(os.path.join(TMP, 'man'))
    # 1) ring-manifest: 두 번(따로 프로세스) 바이트 같음, 커밋 파일과 같음, 꼴과 sha256
    outs = []
    committed = os.path.join(HERE, 'ring-manifest.json')
    tags = _committed_list(committed, 'tags', 'blend')
    for k in 'ab':
        rc, _ = _man_cli('ring-manifest', os.path.join(d, f'ring-{k}.json'), ('--tags', tags))
        ck(rc == 0, f'ring-run-{k}')
        outs.append(read_bytes(os.path.join(d, f'ring-{k}.json')) if rc == 0 else b'')
    ck(outs[0] == outs[1] and outs[0], 'ringDet')
    ck.kv['tags'] = tags
    ck(os.path.exists(committed) and read_bytes(committed) == outs[0], 'ringCommitted')
    rm = json.loads(outs[0]) if outs[0] else {'tags': {}}
    n_sites = 0
    for tag, sites in rm['tags'].items():
        for site, e in sites.items():
            n_sites += 1
            ck(set(e) == {'path', 'sha256', 'bytes', 'nPoints', 'models', 'endpoint', 'nHours', 'firstHour', 'lastHour'},
               f'ringKeys:{site}')
            ck(e['sha256'] == O.sha256_file(O.absp(e['path'])) and e['nPoints'] == 91, f'ringSha:{site}')
    ck(rm.get('schema') == 'ring-manifest/1' and n_sites > 0, 'ringSchema')
    ck.kv['ringSites'] = n_sites

    # 2) 합성 은행: 꼴, 해시, index.json 안 엶, PNG 는 png-hash 안에서만, 크기 키 없음
    bk = fresh_dir(os.path.join(d, 'bank-syn'))
    rng = np.random.default_rng(SEED + 1)
    names = ['syna_2026-09-01', 'synb_2026-09-05', 'sync_2026-09-09']
    tg = {}
    for i, nm in enumerate(names):
        tg[nm] = base64.b64encode(rng.integers(0, 256, 4096, dtype=np.uint8).tobytes()).decode('ascii')
        sc = {'site': nm.split('_')[0], 'lat': 1.0, 'lon': 2.0, 'date': nm.split('_')[1], 'cover': 0.5, 'empty': 0.0,
              'grid': 256, 'cellKm': 3.0, 'ring': [{'dist': 0, 'az': 0, 'cover': 0.25}]}
        if i != 2:
            sc['trueGrid'] = tg[nm]                 # sync 는 trueGrid 없음 → null
        with open(os.path.join(bk, nm + '.json'), 'w') as f:
            json.dump(sc, f)
        if i != 1:                                  # synb 는 PNG 없음 → null
            with open(os.path.join(bk, nm + '.png'), 'wb') as f:
                f.write(b'\x89PNG-not-a-real-png-' + nm.encode())      # 디코드하면 실패할 바이트: 해시만 하는지 확인
    with open(os.path.join(bk, 'index.json'), 'w') as f:
        json.dump([{'name': 'x', 'skip': True, 'cover': 0.9}], f)
    times = os.path.join(d, 'times-syn.json')
    with open(times, 'w') as f:
        json.dump({names[0]: {}, names[2]: {}}, f)
    table = lambda b: {'dir': O.rel(bk), 'times': O.rel(times)}       # noqa: E731
    opened = []

    def spy(event, args):
        if event == 'open' and args and isinstance(args[0], (str, bytes)) and os.fsdecode(args[0]).startswith(bk):
            opened.append((os.path.basename(os.fsdecode(args[0])), O._active_contexts()))
    sys.addaudithook(spy)       # 이 시험 안에서만 의미 있음(경로 bk 로 한정)
    with contextlib.redirect_stdout(io.StringIO()):     # 함수의 BANK 수 줄이 시험 줄에 섞이지 않게
        doc = O.bank_manifest_doc(['syn'], table=table)
    seen = list(opened)
    opened.clear()
    sb = doc['banks']['syn']
    ck(sb['n'] == 3 and sb['dir'] == O.rel(bk) and sorted(sb['scenes']) == names, 'synShape')
    for i, nm in enumerate(names):
        e = sb['scenes'][nm]
        ck(set(e) == {'jsonSha256', 'trueGridSha256', 'pngSha256', 'inTimes'}, f'synKeys:{nm}')
        ck(e['jsonSha256'] == O.sha256_file(os.path.join(bk, nm + '.json')), f'synJson:{nm}')
        ck(e['trueGridSha256'] == (sha(tg[nm].encode('ascii')) if i != 2 else None), f'synTrueGrid:{nm}')
        ck(e['pngSha256'] == (O.sha256_file(os.path.join(bk, nm + '.png')) if i != 1 else None), f'synPng:{nm}')
        ck(e['inTimes'] == (i != 1), f'synInTimes:{nm}')
    ck(not ({k.lower() for k in _keys_recursive(doc, set())} & {'bytes', 'jsonbytes', 'pngbytes', 'size'}), 'noSizes')
    ck(all(fn != 'index.json' for fn, _ in seen), 'indexNotOpened')
    ck(all(('png-hash' in ctx) for fn, ctx in seen if fn.endswith('.png')), 'pngOnlyHash')
    ck(all(('scene-json' in ctx) for fn, ctx in seen if fn.endswith('.json')), 'jsonOnlySceneCtx')
    # cover·empty·고리 cover 만 바꾸면 trueGridSha256 그대로, jsonSha256 만 바뀜
    p0 = os.path.join(bk, names[0] + '.json')
    with open(p0) as f:
        sc0 = json.load(f)
    sc0['cover'], sc0['empty'], sc0['ring'][0]['cover'] = 0.7, 0.1, 0.9
    with open(p0, 'w') as f:
        json.dump(sc0, f)
    with contextlib.redirect_stdout(io.StringIO()):
        doc2 = O.bank_manifest_doc(['syn'], table=table)
    e1, e2 = sb['scenes'][names[0]], doc2['banks']['syn']['scenes'][names[0]]
    ck(e1['trueGridSha256'] == e2['trueGridSha256'] and e1['jsonSha256'] != e2['jsonSha256'], 'coverIndependent')

    # 3) 진짜 은행(해시만): 두 번 바이트 같음, 커밋 파일과 같음, 꼴
    outs = []
    committed = os.path.join(HERE, 'bank-manifest.json')
    banks = _committed_list(committed, 'banks', 'orig')
    ck.kv['banks'] = banks
    for k in 'ab':
        rc, lines = _man_cli('bank-manifest', os.path.join(d, f'bank-{k}.json'), ('--banks', banks))
        ck(rc == 0, f'bank-run-{k}')
        ck(all(ln.startswith(('BANK ', 'WROTE ')) for ln in lines), f'bank-stdout-{k}')
        outs.append(read_bytes(os.path.join(d, f'bank-{k}.json')) if rc == 0 else b'')
    ck(outs[0] == outs[1] and outs[0], 'bankDet')
    ck(os.path.exists(committed) and read_bytes(committed) == outs[0], 'bankCommitted')
    bm = json.loads(outs[0]) if outs[0] else {'banks': {}}
    ck(bm.get('schema') == 'bank-manifest/1' and 'orig' in bm['banks'], 'bankSchema')
    ok_keys = all(set(e) == {'jsonSha256', 'trueGridSha256', 'pngSha256', 'inTimes'}
                  for b in bm['banks'].values() for e in b['scenes'].values())
    ck(ok_keys and not ({k.lower() for k in _keys_recursive(bm, set())} & {'bytes', 'jsonbytes', 'pngbytes', 'size'}),
       'bankNoSizes')
    if 'orig' in bm['banks']:
        o = bm['banks']['orig']
        ck.kv.update({'bankN': o['n'], 'bankPng': sum(1 for e in o['scenes'].values() if e['pngSha256']),
                      'bankInTimes': sum(1 for e in o['scenes'].values() if e['inTimes']),
                      'bankTrueGrid': sum(1 for e in o['scenes'].values() if e['trueGridSha256'])})
    return ck.result()


# ───────────────────────── U-ALLOW(로더 몫) ─────────────────────────
@test('U-ALLOW')
def t_allow():
    ck = Checks()
    d = fresh_dir(os.path.join(TMP, 'allow'))
    marker = 'FAKE-MODIS-MARKER-7f3a'
    sc = {'site': 'seoul', 'lat': 37.5, 'lon': 127.0, 'date': '2026-09-01', 'grid': 256, 'cellKm': 3.0,
          'cover': 0.4321, 'empty': 0.0123, 'trueGrid': base64.b64encode(marker.encode() * 40).decode('ascii'),
          'ring': [{'dist': d_, 'az': a_, 'cover': 0.111 * (i % 9), 'note': marker} for i, (d_, a_) in enumerate(O.ring91())],
          'extra': {'x': marker}, 'nwp': {'tag': marker}}
    p = os.path.join(d, 'seoul_2026-09-01.json')
    with open(p, 'w') as f:
        json.dump(sc, f)
    meta = O.load_scene_meta(p)
    ck(set(meta) == {'site', 'lat', 'lon', 'date', 'grid', 'cellKm', 'ring'}, 'metaKeys')
    ck(all(set(r) == {'dist', 'az'} for r in meta['ring']) and len(meta['ring']) == 91, 'ringKeys')
    ck([(r['dist'], r['az']) for r in meta['ring']] == O.ring91(), 'ringGeom')
    ck(marker not in json.dumps(meta) and '0.4321' not in json.dumps(meta), 'noValues')
    h = O.scene_hashes(p)
    ck(set(h) == {'jsonSha256', 'trueGridSha256'} and h['trueGridSha256'] == sha(sc['trueGrid'].encode('ascii'))
       and h['jsonSha256'] == O.sha256_file(p), 'hashes')
    sc2 = dict(sc, cover=0.9, empty=0.5, trueGrid='QUJD', ring=[dict(r, cover=0.5) for r in sc['ring']])
    with open(p, 'w') as f:
        json.dump(sc2, f)
    ck(O.load_scene_meta(p) == meta, 'metaIndependentOfValues')
    # '빌더 출력이 가짜 키에 무관'(§1.13 U-ALLOW 뒤 몫)은 이 시험에 아직 없음: inputs 빌더 시험(B-SYN 의 합성 은행)과 함께 더합니다.
    ck.kv['scope'] = 'loader'
    return ck.result()


# ───────────────────────── U-GUARD ─────────────────────────
def _try_open(path):
    """가드 판정만 보려고 엶: 'guard'(PermissionError) · 'notfound'(가드는 통과, 파일 없음) · 'opened'(있으면 곧바로 닫음)."""
    try:
        with open(path, 'rb'):
            return 'opened'
    except PermissionError as e:
        return 'guard' if str(e).startswith('oro guard:') else 'perm'
    except FileNotFoundError:
        return 'notfound'


@test('U-GUARD')
def t_guard():
    ck = Checks()
    ck(O.guard_installed(), 'installed')
    R = lambda p: os.path.join(ROOT, p)        # noqa: E731
    probes = {   # 없는 이름만(가드가 실패해도 진짜 파일을 건드리지 않게)
        'satPng': (R('.harness/macro/sat/__guard_probe__.png'), ('png-hash', 'png-judge')),
        'oroSatPng': (R('.harness/oro/sat-ext/__guard_probe__.png'), ('png-hash', 'png-judge')),
        'satJson': (R('.harness/macro/sat/__guard_probe__.json'), ('scene-json',)),
        'nwpCopyJson': (R('.harness/macro/sat-nwp-blend/__guard_probe__.json'), ('scene-json',)),
        'oroSatJson': (R('.harness/oro/sat-__probe__/__guard_probe__.json'), ('scene-json',)),
        'satIndex': (R('.harness/macro/sat-__probe__/index.json'), 'forbidden'),
        'oroSatIndex': (R('.harness/oro/sat-__probe__/index.json'), 'forbidden'),
        'gate': (R('tools/genus-ruler/ring/gate-__probe__.json'), 'forbidden'),
        'fetchSatLog': (R('.harness/oro/fetch-sat__probe__.log'), 'forbidden'),
        'regimeSat': (R('.harness/regime/sat__probe__/x.json'), 'forbidden'),
        'scratchRestore': ('/tmp/__oro_probe__/scratchpad/restore/x.json', 'forbidden'),
        'free': (R('.harness/oro/test-tmp/__guard_probe__.png'), None),
    }
    for k, (p, want) in probes.items():
        if not ck(not os.path.exists(p), f'probeAbsent:{k}'):
            continue
        ck(O.guard_verdict(p) == want, f'verdict:{k}')
        got = _try_open(p)
        ck(got == ('notfound' if want is None else 'guard'), f'bare:{k}')
        for ctx in O.CONTEXTS:
            with O.allow(ctx):
                got = _try_open(p)
            should_pass = want is None or (want != 'forbidden' and ctx in want and ctx != 'png-judge')
            ck(got == ('notfound' if should_pass else 'guard'), f'{ctx}:{k}')
    # 꼴로만 확인(진짜 파일이라 열지 않음)
    exact = ['tools/genus-ruler/macro/sat-quartiles.json', 'tools/genus-ruler/ring/ringtruth-results.json',
             'tools/genus-ruler/ring/gate-blend-held.json', '.harness/oro/f2.log', '.harness/oro/f3-run.log',
             '.harness/oro/sat-quartiles-restore.json', '.harness/macro/sat/index.json']
    for p in exact:
        ck(O.guard_verdict(R(p)) == 'forbidden', f'exact:{p}')
    ck(O.guard_verdict(R('tools/genus-ruler/ring/nwp/blend/busan.json')) is None
       and O.guard_verdict(R('.harness/oro/sounding.json')) is None, 'nwpFree')
    # png-judge: lock 이 그 순간 있을 때만(진짜 lock 대신 test-tmp 의 lock 경로로 바꿔 끼워 시험)
    d = fresh_dir(os.path.join(TMP, 'guard'))
    real_lock = O.JUDGE_LOCK
    ck(real_lock == os.path.join(HERE, 'judge.lock'), 'lockPath')
    fake_lock = os.path.join(d, 'judge.lock')
    O.JUDGE_LOCK = fake_lock
    try:
        with O.allow('png-judge'):
            no_lock = _try_open(probes['satPng'][0])
        open(fake_lock, 'w').close()
        with O.allow('png-judge'):
            with_lock = _try_open(probes['satPng'][0])
        with O.allow('png-judge'):
            json_under_judge = _try_open(probes['satJson'][0])
    finally:
        O.JUDGE_LOCK = real_lock
    ck(no_lock == 'guard' and with_lock == 'notfound' and json_under_judge == 'guard', 'judgeLock')
    # 심볼릭 링크로 돌아가기: test-tmp 의 링크 → 금지 꼴(없는 대상)
    link = os.path.join(d, 'link.png')
    os.symlink(probes['satIndex'][0], link)
    ck(O.guard_verdict(link) == 'forbidden' and _try_open(link) == 'guard', 'symlink')
    ck(_pyc_snapshot() == PYC_AT_START, 'noPycache')
    ck.kv['probes'] = len(probes)
    return ck.result()


# ═══════════════════════ S3a MODEL TESTS — BEGIN (S3-design §5.1 units, §5.2 builders, §5.3 G6 (a)–(e)) ═══════════════════════
# Uses the registry above (@test, Checks, Skip, fmt, sha, fresh_dir, read_bytes, O = oro_ref). Values printed on the lines are
# DEM/NWP/synthetic only. Fixtures are built lazily once per run in .harness/oro/test-tmp/ (B-SYN, B-BUSAN) and shared.
import gzip
import math
import statistics
import urllib.request
from datetime import datetime, timedelta, timezone

T_SYN = os.path.join(TMP, 'syn')
T_BUSAN = os.path.join(TMP, 'busan')
REF_DIR = os.path.join(ROOT, '.harness', 'oro', 'ref')
FS_URL = ('https://raw.githubusercontent.com/fastscape-lem/orographic-precipitation/baf8a0c13855fdef88b4ad995fd59c6e69834e00/'
          'orographic_precipitation/orographic_precipitation.py')
FS_SHA = '3d924a41b4032ec019686f1ff96d5871a557bda498913837515dd929aae8e98d'
FP_SHA = 'b03800e75e40984f9834157973a2082b7bf129c9a44ed32438c7b020d5c213f6'
UTC = timezone.utc


def _geo():
    if 'geo' not in _FIX:
        _FIX['geo'] = _load('oro_geom', os.path.join(HERE, 'oro-geom.py'))
    return _FIX['geo']


_FIX = {}


def _close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def _rclose(a, b, rel):
    return a is not None and abs(a - b) <= rel * abs(b)


def _run_ref(args):
    """oro_ref.py CLI in its own python3 -I process (separate str hash seed, D1)."""
    r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'oro_ref.py')] + list(args), cwd=ROOT,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'oro_ref {args[0]} exit {r.returncode}: {r.stderr.strip()[-300:]}')
    return r.stdout


def synth_terrain(n, dx_m, beta=3.0, rms=300.0, seed=1):
    """draft-1 bench/oro_core.synth_terrain (G6(b) terrain)."""
    rng = np.random.default_rng(seed)
    k, l = O.kgrid(n, dx_m)
    K = np.hypot(k, l)
    K[0, 0] = np.inf
    h = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * K ** (-beta / 2)))
    h -= h.mean()
    h *= rms / h.std()
    return h


def smooth_field(n, L_km, seed, dx_m=6000.0):
    """draft-1 stat/sim1_lib.smooth_field: standardised white noise filtered by exp(−K²L²/4)."""
    r = np.random.default_rng(seed)
    k, l = O.kgrid(n, dx_m)
    a = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * np.exp(-(k * k + l * l) * (L_km * 1e3) ** 2 / 4)))
    return (a - a.mean()) / a.std()


# ───────────────────────── §5.1 unit tests ─────────────────────────
@test('U-PHI')
def t_phi():
    ck = Checks()
    hand = [(O.Phi(1.0), 0.841344736168), (O.Phi(-2.5), 0.006209680111), (O.Phinv(0.975), 1.959963986120),
            (O.Phinv(0.02), -2.053748909003), (O.Phinv(0.01), -2.326347874388), (O.Phinv(0.3), -0.524400513279),
            (O.Phinv(O.Q_LO), -2.499999159036)]
    for i, (v, h) in enumerate(hand):
        ck(abs(float(v) - h) <= 1e-12, f'hand{i}')
    ck(float(O.Phinv(0.5)) == 0.0, 'PhinvHalfExact')
    ck(O.Q_LO == 0.006209680111438021 and O.Q_HI == 0.993790319888562, 'QLOQHI')
    x = np.linspace(-5, 5, 1001)
    nd = statistics.NormalDist()
    dev = max(abs(float(O.Phi(v)) - nd.cdf(float(v))) for v in x)
    ck(dev <= 1.5e-7, 'PhiVsExact')
    try:
        O.Phinv(np.array([0.5, 1.0]))
        ck(False, 'domain')
    except ValueError:
        pass
    ck(abs(float(O.phi(0.0)) - 1 / math.sqrt(2 * math.pi)) == 0.0, 'phiExact')
    ck.kv.update({'maxPhiDev': dev, 'Phi0': float(O.Phi(0.0))})
    return ck.result()


@test('U-G')
def t_gauss():
    ck = Checks()
    one = O.gauss_smooth(np.ones((128, 128)), 20000.0)
    ck(np.max(np.abs(one - 1)) <= 1e-12, 'onePreserved')
    imp = np.zeros((128, 128))
    imp[64, 0] = 1.0
    g = O.gauss_smooth(imp, 20000.0)
    ck(np.all(g[:, 11:] == 0.0) and g[64, 10] > 0, 'noWrap')
    rng = np.random.default_rng(SEED)
    X = rng.standard_normal((128, 128))
    ck(np.allclose(O.gauss_smooth(X.T, 20000.0), O.gauss_smooth(X, 20000.0).T, rtol=0, atol=1e-13), 'transpose')
    taps = {(20000.0, 6000.0): 21, (10000.0, 6000.0): 11, (15000.0, 6000.0): 15, (30000.0, 6000.0): 31, (20000.0, 12000.0): 11}
    for (s, d), nt in taps.items():
        ck(O.gauss_taps(s, d).size == nt, f'taps{int(s / 1000)}_{int(d / 1000)}')
    m = np.zeros((128, 128))
    m[:, :20] = 1
    gm = O.gauss_smooth(X, 10000.0, mask=m)
    ck(np.all(np.isnan(gm[:, 26:])) and np.all(np.isfinite(gm[:, :25])), 'maskNaN')
    ck(np.array_equal(O._gop(128, 20000.0, 6000.0)(X), O.gauss_smooth(X, 20000.0)), 'cachedOpEqual')
    return ck.result()


@test('U-TUKEY')
def t_tukey():
    ck = Checks()
    w = O.tukey_1d()
    ck(w[0] == 0.0 and abs(w[1] - 0.009607) <= 1e-6 and abs(w[8] - 0.5) <= 1e-12 and abs(w[15] - 0.990393) <= 1e-6, 'hand')
    ck(np.all(w[16:112] == 1.0) and np.array_equal(w, w[::-1]), 'flatSymmetric')
    w64 = O.tukey_1d(64, 8)
    ck(w64[0] == 0.0 and np.all(w64[8:56] == 1.0), 'n64')
    return ck.result()


@test('U-HP')
def t_hp():
    ck = Checks()
    lam = 2 * math.pi * O.S_HP_M / math.sqrt(2 * math.log(2))
    K = 2 * math.pi / lam
    ck(abs((1 - math.exp(-K * K * O.S_HP_M ** 2 / 2)) - 0.5) <= 1e-12, 'halfAmplitude')
    ck(abs(lam / 1000 - 53.364) <= 1e-3, 'wavelength')
    hs, a1 = O.h_sub_field(np.full((128, 128), 700.0))
    ck(np.max(np.abs(hs)) <= 1e-9 and a1 <= 1e-9, 'constantRemoved')
    ck.kv['lambdaHalfKm'] = lam / 1000
    return ck.result()


@test('U-WIND')
def t_wind():
    ck = Checks()
    for d, (u, v) in {0: (0, -10), 90: (-10, 0), 180: (0, 10), 270: (10, 0), 225: (7.0710678, 7.0710678)}.items():
        U, V = O.wind_to_uv(10.0, d)
        ck(abs(U - u) <= 1e-7 and abs(V - v) <= 1e-7, f'from{d}')
    return ck.result()


def _one(v):
    return np.array([[float(v)]])


@test('U-M')
def t_m():
    ck = Checks()
    Hw, f = 2500.0, 1e-4
    k60 = _one(2 * math.pi / 60000.0)
    z = _one(0.0)
    kind, m, mu = O.vertical_m(k60, z, 10.0, 0.0, 0.01, f)
    W, _ = O.col_weight(k60, z, 10.0, 0.0, 0.01, f, Hw)
    ck(kind[0, 0] == 1 and _rclose(m[0, 0], 9.990674045554384e-4, 1e-12), 'propM')
    ck(_rclose(W[0, 0].real, 0.13815307042396577, 1e-12) and _rclose(W[0, 0].imag, 0.34506057374959037, 1e-12), 'propW')
    kind2, m2, _ = O.vertical_m(k60, z, -10.0, 0.0, 0.01, f)
    W2, _ = O.col_weight(k60, z, -10.0, 0.0, 0.01, f, Hw)
    ck(m2[0, 0] == -m[0, 0] and W2[0, 0] == np.conj(W[0, 0]), 'propSign')
    k24 = _one(2 * math.pi / 24000.0)
    kind, m, mu = O.vertical_m(k24, z, 25.0, 0.0, 0.003, f)
    W, _ = O.col_weight(k24, z, 25.0, 0.0, 0.003, f, Hw)
    ck(kind[0, 0] == 2 and _rclose(mu[0, 0], 2.3270487921261152e-4, 1e-12) and _rclose(W[0, 0].real, 0.6322062831217485, 1e-12)
       and W[0, 0].imag == 0, 'evanescent')
    kind, m, mu = O.vertical_m(z, k60, 10.0, 0.0, 0.01, f)
    W, _ = O.col_weight(z, k60, 10.0, 0.0, 0.01, f, Hw)
    ck(kind[0, 0] == 3 and _rclose(mu[0, 0], 1.0471975511965976e-2, 1e-12) and _rclose(W[0, 0].real, 0.03679184151580821, 1e-12),
       'rotational')
    W0, _ = O.col_weight(z, k60, 10.0, 0.0, 0.01, 0.0, Hw)
    _, _, mu0 = O.vertical_m(z, k60, 10.0, 0.0, 0.01, 0.0)
    ck(W0[0, 0] == 0 and np.isinf(mu0[0, 0]), 'rotationalF0')
    Wk0, kk0 = O.col_weight(z, z, 10.0, 0.0, 0.01, f, Hw)
    ck(kk0[0, 0] == 0 and Wk0[0, 0] == 0, 'meanMode')
    return ck.result()


@test('U-M2')
def t_m2():
    ck = Checks()
    rng = np.random.default_rng(SEED)
    k, l = O.kgrid(64, 6000.0)
    counts = {0: 0, 1: 0, 2: 0, 3: 0}
    sgn = {1: 0, -1: 0}
    for i in range(32):
        U, V = rng.uniform(-25, 25, 2)
        N = rng.uniform(0.003, 0.02)
        f = 0.0 if i % 8 == 0 else rng.uniform(0, 1.46e-4)
        Hw, zz = rng.uniform(1500, 4000), rng.uniform(500, 3000)
        for br in ('physical', 'fastscape'):
            kind, m, mu = O.vertical_m(k, l, U, V, N, f, br)
            W, kind2 = O.col_weight(k, l, U, V, N, f, Hw, br)
            E = O.vertical_decay(k, l, U, V, N, f, zz, br)
            Wx = np.zeros(kind.shape, complex)
            Ex = np.zeros(kind.shape, complex)
            p = kind == 1
            Wx[p] = 1.0 / (1.0 - 1j * m[p] * Hw)
            Ex[p] = np.exp(1j * m[p] * zz)
            d = (kind >= 2) & np.isfinite(mu)
            Wx[d] = 1.0 / (1.0 + mu[d] * Hw)
            Ex[d] = np.exp(-mu[d] * zz)
            ck(np.array_equal(kind, kind2) and np.array_equal(W, Wx) and np.array_equal(E, Ex), f'draw{i}{br[0]}')
            if br == 'physical':
                for kk in counts:
                    counts[kk] += int(np.sum(kind == kk))
                s = U * k + V * l
                sgn[1] += int(np.sum((kind == 1) & (s > 0)))
                sgn[-1] += int(np.sum((kind == 1) & (s < 0)))
            else:
                ck(np.all(kind[(k != 0) | (l != 0)] == 1), f'fsKind{i}')
    ck(all(v > 0 for v in counts.values()) and sgn[1] > 0 and sgn[-1] > 0, 'allKindsBothSigns')
    ck.kv.update({'nMean': counts[0], 'nProp': counts[1], 'nEvan': counts[2], 'nRot': counts[3]})
    return ck.result()


@test('U-D')
def t_damp():
    ck = Checks()
    z = _one(0.0)
    ck(_rclose(2 * math.pi * 10 / O.LAMBDA_SMIN_M, 3.1415926536e-4, 1e-10), 'sigmaMin')
    D60 = O.low_sigma_damp(_one(2 * math.pi / 60000.0), z, 10.0, 0.0)[0, 0]
    D200 = O.low_sigma_damp(_one(2 * math.pi / 200000.0), z, 10.0, 0.0)[0, 0]
    ck(abs(D60 - 0.917431192661) <= 1e-12 and abs(D200 - 0.5) <= 1e-15, 'hand')
    ck(np.all(O.low_sigma_damp(*O.kgrid(16, 6000.0), 0.0, 0.0) == 0), 'zeroWind')
    return ck.result()


@test('U-THERMO')
def t_thermo():
    ck = Checks()
    r = 1e-9
    ck(_rclose(O.e_s(10), 12.27169599, r) and _rclose(O.mixing_q(10, 80, 850), 0.007215496886, r)
       and _rclose(O.theta(10, 850), 296.6069909, r) and _rclose(O.theta_v(10, 80, 850), 297.9077625, r)
       and _rclose(O.theta_v(0, 60, 700), 303.0520656, r), 'thetaV')
    tl, th = O.theta_v(10, 80, 850), O.theta_v(0, 60, 700)
    N2 = (O.G0 / (0.5 * (tl + th))) * (th - tl) / (3100.0 - 1500.0)
    ck(_rclose(N2, 1.0493292871e-4, r) and _rclose(math.sqrt(N2), 0.0102436775, r), 'N2')
    ck(_rclose(O.gamma_s(280), 5.5241246474e-4, r) and _rclose(O.gamma_s(270), 5.9877619672e-4, r)
       and _rclose(O.gamma_s(290), 5.1090950928e-4, r), 'gammaS')
    ck(_rclose(O.hw_of(280.0, 6.5e-3), 2226.56, 1e-9) and O.hw_of(280.0, -1e-3) == 2500.0 and O.hw_of(280.0, 1e-3) == 4000.0
       and O.hw_of(250.0, 0.02) == 1500.0, 'Hw')
    sr, br = O.s_rel_of(0.28, 0.9)
    ck(_rclose(sr, 0.171573229857, r) and br == 'inv' and _rclose(O.gamma_s(278.15) / sr, 3.267421921052e-3, r), 'sRelKappa')
    ck(O.s_rel_of(0.28, 0.7) == (0.30, 'inv') and O.s_rel_of(0.5, 0.9) == (0.15, 'default')
       and O.s_rel_of(0.28, 0.97) == (0.15, 'default') and O.s_rel_of(None, 0.9) == (0.15, 'default-noClm'), 'sRelBranches')
    return ck.result()


def _series_snd(times, var_values, elevation=0.0):
    h = {'time': times}
    h.update(var_values)
    return O.Sounding('syn', {'lat': 0, 'lon': 0, 'elevation': elevation, 'hourly': h})


def _hours(start, n):
    t0 = datetime.strptime(start, '%Y-%m-%dT%H:%M').replace(tzinfo=UTC)
    return [(t0 + timedelta(hours=i)).strftime('%Y-%m-%dT%H:%M') for i in range(n)]


@test('U-INT0')
def t_int0():
    ck = Checks()
    fn = O.fetch_nwp()
    rng = np.random.default_rng(SEED)
    times = _hours('2026-09-01T00:00', 48)
    vals = [float(v) for v in rng.uniform(0, 100, 48)]
    nbad = 0
    for _ in range(200):
        sec = int(rng.integers(1, 46 * 3600))
        if sec % 3600 == 0:
            sec += 7
        t = datetime(2026, 9, 1, tzinfo=UTC) + timedelta(seconds=sec)
        a, how = O.interp_fallback(times, vals, t)
        b = fn.interp(times, vals, t.strftime('%Y-%m-%dT%H:%M:%SZ'))
        nbad += not (a == b and how == 'linear')
    ck(nbad == 0, 'equalsFetchNwpInterp')
    ck.kv['n'] = 200
    return ck.result()


@test('U-INT')
def t_int():
    ck = Checks()
    times = _hours('2026-09-01T00:00', 8)
    t = lambda s: datetime.strptime('2026-09-01T' + s, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=UTC)
    v, how = O.interp_fallback(times, [10.0, None, 14.0, 1, 1, 1, 1, 1], t('01:07:30'))
    ck(v == 12.25 and how == 'fallback2', 'fallback2')
    v, how = O.interp_fallback(times, [10.0, None, 14.0, 1, 1, 1, 1, 1], t('02:00:00'))
    ck(v == 14.0 and how == 'exact', 'onHour')
    v, how = O.interp_fallback(times, [10.0, 20.0, 14.0, 1, 1, 1, 1, 1], t('00:30:00'))
    ck(v == 15.0 and how == 'linear', 'linear')
    v, how = O.interp_fallback(times, [10.0] + [None] * 7, t('02:30:00'))
    ck(v == 10.0 and how == 'fallback1', 'oneSide')
    only4 = [None, None, None, None, 7.0, None, None, None]
    v, how = O.interp_fallback(times, only4, t('01:00:00'))
    ck(v == 7.0 and how == 'fallback1', 'exactly3hIncluded')
    v, how = O.interp_fallback(times, only4, t('00:59:59'))
    ck(v is None and how == 'none', '3hPlus1sExcluded')
    v, how = O.interp_fallback(times, [None] * 8, t('03:30:00'))
    ck(v is None, 'allNull')
    return ck.result()


def _z0_profile(z_sfc=100.0):
    Z = {1000: 40.0, 975: 70.0, 950: 95.0, 925: 800.0, 900: 1150.0, 850: 1500.0, 800: 2000.0, 750: 2500.0, 700: 3100.0,
         600: 4300.0, 500: 5600.0, 400: 7200.0, 300: 9200.0, 250: 10400.0, 200: 11800.0}
    T = {1000: 9.0, 975: 8.5, 950: -1.0, 925: 4.0, 900: 1.5, 850: -1.0, 800: -4.0, 750: -6.0, 700: -9.0, 600: -16.0,
         500: -25.0, 400: -35.0, 300: -45.0, 250: -50.0, 200: -55.0}
    return T, Z


@test('U-Z0')
def t_z0():
    ck = Checks()
    T, Z = _z0_profile()
    ck(_close(O.z0_from_profile(100.0, 8.0, T, Z), 1360.0, 1e-9), 'crossing')       # 950 hPa (Z 95 ≤ z_sfc, T < 0) is no node
    ck(O.z0_from_profile(100.0, -1.0, T, Z) == 100.0, 'T2mBelow0')
    Tw = {p: v + 40.0 for p, v in T.items()}
    ck(O.z0_from_profile(100.0, 30.0, Tw, Z) == 5600.0, 'noCrossingZ500')
    ck(O.z0_from_profile(100.0, None, T, Z) is None, 'nullT2m')
    Zn = dict(Z)
    Zn[700] = None
    ck(O.z0_from_profile(100.0, 8.0, T, Zn) is None, 'nullZ700')
    return ck.result()


@test('U-Z0B')
def t_z0b():
    ck = Checks()
    T, Z = _z0_profile()
    Z = {p: v + 1500.0 for p, v in Z.items()}          # Denver-like: z_sfc 1600, 1000..900 hPa far under ground
    Tn, Zn = dict(T), dict(Z)
    for p in (1000, 975, 950, 925, 900):
        Tn[p] = None
        Zn[p] = None
    ck(O.z0_from_profile(1600.0, 8.0, Tn, Zn) is not None, 'deepNullsSkipped')
    ck(O.z0_from_profile(100.0, 8.0, Tn, Zn) is None, 'sameNullsShallowSite')
    Zm = dict(Zn)
    Zm[850] = None
    ck(O.z0_from_profile(1600.0, 8.0, Tn, Zm) is None, 'nullZ850Required')
    ck([p for p in O.TEMP_LEVELS if O.z_std(p) < 1100.0] == [1000, 975, 950, 925, 900], 'zStd')
    return ck.result()


@test('U-ZSNOW')
def t_zsnow():
    ck = Checks()
    n = 2000
    times = _hours('2026-06-01T00:00', n)
    snd = _series_snd(times, {}, elevation=123.0)
    t = lambda i, mins=0: datetime.strptime(times[i], '%Y-%m-%dT%H:%M').replace(tzinfo=UTC) + timedelta(minutes=mins)
    base = [3000.0 + i for i in range(n)]
    snd._z0 = list(base)
    v, nv = O.z_snow_at(snd, t(600, 30), 21)
    ck(v == 3000.0 + 97 and nv == 504, 'windowOffHour')
    v2, _ = O.z_snow_at(snd, t(600), 21)
    ck(v2 == v, 'windowOnHour')
    for days, need in ((21, 252), (7, 84), (42, 504)):
        end = 1500
        first = end - days * 24 + 1
        z = [None] * n
        for i in range(first, first + need):
            z[i] = 5000.0 - i
        snd._z0 = z
        a, na = O.z_snow_at(snd, t(end), days)
        z[first] = None
        b, nb = O.z_snow_at(snd, t(end), days)
        ck(na == need and a == 5000.0 - (first + need - 1) and nb == need - 1 and b == 123.0, f'boundary{days}d')
    snd._z0 = list(base)
    ck(O.z_snow_at(snd, t(100), 21) == (None, None), 'windowBeforeFile')
    ck(O.z_snow_at(snd, t(503), 21)[0] == 3000.0 and O.z_snow_at(snd, t(502), 21) == (None, None), 'firstFullWindow')
    return ck.result()


def _std_hourly(times, elevation=0.0, wind_dir=270.0, overrides=None):
    """Standard-atmosphere hourly record: T = 15 − 6.5 z/km °C, Z = z_std(p), RH 70 %, wind 10 m/s from wind_dir."""
    h = {'time': list(times)}
    nt = len(times)
    h['temperature_2m'] = [15.0 - 6.5 * (elevation + 2.0) / 1000.0] * nt
    for p in O.TEMP_LEVELS:
        zp = O.z_std(p)
        h[f'geopotential_height_{p}hPa'] = [zp] * nt
        h[f'temperature_{p}hPa'] = [15.0 - 6.5 * zp / 1000.0] * nt
    for p in (1000, 975, 950, 925, 900, 850, 800, 750, 700, 600, 500, 400, 300):
        h[f'relative_humidity_{p}hPa'] = [70.0] * nt
    for p in (925, 850, 700, 600, 500, 250):
        h[f'wind_speed_{p}hPa'] = [10.0] * nt
        h[f'wind_direction_{p}hPa'] = [wind_dir] * nt
    for k, v in (overrides or {}).items():
        h[k] = v
    return h


@test('U-REF')
def t_ref():
    ck = Checks()
    times = _hours('2026-09-01T00:00', 6)
    t = datetime(2026, 9, 1, 2, 0, tzinfo=UTC)

    def snd(elev=0.0, **ov):
        return O.Sounding('x', {'elevation': elev, 'hourly': _std_hourly(times, elev, overrides={k: [None] * 6 if v is None else v
                                                                                                 for k, v in ov.items()})})
    r = O.ref_values(snd(1600.0), t, 1900.0, 39.74, 0.2, 0.1)
    ck(r['refLevels'] == [700] and r['pLo'] == 700 and r['pHi'] == 500 and r['complete'], 'denverL700')
    r = O.ref_values(snd(), t, 100.0, 37.5, 0.2, 0.1)
    ck(r['refLevels'] == [850, 700] and r['pLo'] == 850 and r['pHi'] == 700 and r['complete'] and r['A4']['ok']
       and _close(r['speedRef'], 10.0, 1e-12) and r['sRelBranch'] == 'inv', 'bothLevels')
    ck(0.9e-4 <= r['N2'] <= 1.3e-4 and r['inversion'] == {'level': 1000, 'flag': False}, 'N2Inversion')
    r = O.ref_values(snd(), t, 5000.0, 37.5, 0.2, 0.1)
    ck(r['refEmpty'] and r['complete'] and r['Vref'] is None and r['A4']['reason'] == 'refEmpty', 'emptyL')
    r = O.ref_values(snd(**{'wind_direction_500hPa': [90.0] * 6}), t, 100.0, 37.5, 0.2, 0.1)
    ck(not r['A4']['ok'] and r['A4']['reason'] == 'dot' and r['A4']['dots']['500'] < 0 and r['complete'], 'reversed500')
    r = O.ref_values(snd(temperature_2m=None), t, 100.0, 37.5, 0.2, 0.1)
    ck(r['complete'] and r['inversion'] is None, 'nullT2m')
    r = O.ref_values(snd(wind_speed_600hPa=None), t, 100.0, 37.5, 0.2, 0.1)
    ck(r['complete'] and not r['A4']['ok'] and r['A4']['reason'] == 'null', 'nullV600')
    r = O.ref_values(snd(relative_humidity_700hPa=None), t, 100.0, 37.5, 0.2, 0.1)
    ck(not r['complete'] and r['missing'] == ['RH700'], 'nullRHpHi')
    r = O.ref_values(snd(geopotential_height_850hPa=None), t, 1900.0, 39.74, 0.2, 0.1)
    ck(not r['complete'] and 'Z850' in r['missing'], 'nullZ850Literal')
    r = O.ref_values(snd(), t, 100.0, 37.5, None, 0.1)
    ck(r['sRelBranch'] == 'default-noClm' and r['sRel'] == 0.15, 'noClm')
    return ck.result()


@test('U-ZREF')
def t_zref():
    ck = Checks()
    x, y = O.cell_xy_km()
    inside = (x * x + y * y) <= 2500.0
    h = np.where(inside, 1.0, 1000.0)
    ck(int(inside.sum()) == 216 and O.z_ref(h) == 1.0, 'cells216')
    return ck.result()


def _comb_B():
    rng = np.random.default_rng(SEED)
    B = (1 / (1 + np.exp(-1.2 * smooth_field(128, 100, SEED)))).astype(np.float32).astype(np.float64)
    B[0, :8] = [0.0, 1.0, O.Q_LO, O.Q_HI, 0.5, 1e-9, 1 - 1e-9, float(np.float32(0.3))]
    B[1, :4] = rng.uniform(0, 1, 4).astype(np.float32)
    return B


@test('U-COMB')
def t_comb():
    ck = Checks()
    B = _comb_B()
    r = O.combine(B, np.zeros_like(B))
    ck(np.array_equal(r['C'], B) and r['iters'] == 0 and r['converged'] and r['ok'], 'COMB1_F0identity')
    Bc = np.full((128, 128), 0.5)
    r = O.combine(Bc, np.full((128, 128), 0.05))
    ck(r['iters'] == 1 and r['converged'] and r['ok'], 'COMB2_oneUpdate')
    r0 = O.combine(Bc, np.full((128, 128), 0.001))
    ck(r0['iters'] == 0 and r0['converged'] and np.any(r0['dC_raw'] != 0), 'COMB2_zeroUpdates')
    F = np.zeros((128, 128))
    F[54:74, 54:74] = 3.0
    r = O.combine(np.zeros((128, 128)), F)
    ck(r['iters'] == 10 and not r['converged'] and not r['ok'], 'COMB3_impossible')
    h = synth_terrain(128, 6000.0, beta=3.0, rms=600.0, seed=11)
    snd = {'Vref': [10.0, 0.0], 'N': 0.01, 'Hw_m': 2230.0, 'kappa': O.gamma_s(280.0) / 0.15}
    hs, _ = O.h_sub_field(np.maximum(h, 0.0))
    F = O.forcing(hs, snd, 37.5)
    F *= 0.12 / math.sqrt(float(np.mean(F ** 2)))
    Bs = 1 / (1 + np.exp(-1.2 * smooth_field(128, 100, SEED + 1)))
    r = O.combine(Bs, F)
    ck(abs(float(np.mean(r['dC']))) <= 1e-3 and r['ok'], 'COMB4_conservation')
    ck(O.apply_or_identity(B, F, False) is B, 'identityObject')
    ck.kv.update({'comb4MeanDC': float(np.mean(r['dC'])), 'comb4MaxGdC': r['maxGdC'], 'comb4Iters': r['iters']})
    return ck.result()


@test('U-HOOKS')
def t_hooks():
    ck = Checks()
    h = synth_terrain(128, 6000.0, beta=3.0, rms=500.0, seed=3)
    hs, _ = O.h_sub_field(np.maximum(h, 0.0))
    snd = {'Vref': [3.0, 2.0], 'N': 0.02, 'Hw_m': 2400.0, 'kappa': 3e-3, 'gammaS': 5.5e-4}     # |V|/N = 180 m: clip active
    ck(float(np.max(np.abs(hs))) > math.hypot(3.0, 2.0) / 0.02, 'clipActive')
    F = O.forcing(hs, snd, 36.0)
    Fd = O.forcing(hs, snd, 36.0, block='clip', vertical='col', N_scale=1.0, Hw_override=None, odd=False,
                   lambda_smin=O.LAMBDA_SMIN_M, f_override=None, s_rel_override=None)
    ck(np.array_equal(F, Fd), 'defaultsAreMain')
    Fr = O.forcing(hs, snd, 36.0, rev=True)
    ck(np.allclose(O.forcing(hs, snd, 36.0, odd=True), 0.5 * (F - Fr), rtol=0, atol=1e-15), 'odd')
    ck(np.allclose(O.forcing(hs, snd, 36.0, s_rel_override=0.2), F * (5.5e-4 / 0.2) / 3e-3, rtol=1e-12, atol=1e-18), 'sRel')
    for kw in ({'block': 'none'}, {'block': 'sheppard'}, {'vertical': 'two'}, {'vertical': 'z1500'}, {'vertical': 'q'},
               {'N_scale': 0.6}, {'Hw_override': 2500.0}, {'lambda_smin': 1e5}, {'f_override': 0.0}):
        G = O.forcing(hs, snd, 36.0, **kw)
        ck(np.all(np.isfinite(G)) and not np.array_equal(G, F), 'hook_' + '_'.join(f'{k}{v}' for k, v in kw.items()))
    ck(pearson_ok(O.forcing(hs, snd, 36.0, vertical='q'), F), 'qNearCol')
    return ck.result()


def pearson_ok(a, b):
    return O.pearson(a, b) > 0.5


@test('U-BOX')
def t_box():
    ck = Checks()
    x, y = O.cell_xy_km()
    ck(O.box15(x)[7, 7] == 0.0 and O.box15(y)[7, 7] == 0.0, 'centreBox')
    ck(O.box15(x)[0, 0] == -84.0 and O.box15(y)[14, 0] == 84.0, 'edgeBoxes')
    r = np.tile(np.arange(128.0)[:, None], (1, 128))
    c = np.tile(np.arange(128.0)[None, :], (128, 1))
    ck(np.array_equal(O.box15(r)[:, 0], 49.5 + 2 * np.arange(15)) and O.box15(c).ravel()[1] == 51.5, 'rowsColsFlat')
    ck(O.box15_max(r)[0, 0] == 50.0, 'boxMax')
    h = np.ones((128, 128))
    h[49:51, 49:51] = [[0, 0], [0, 7]]
    h[49:51, 51:53] = [[0, 0], [5, 7]]
    sb = O.sea_box(h)
    ck(sb[0, 0] and not sb[0, 1] and int(sb.sum()) == 1, 'seaBox')
    bx, by = O.box15(x), O.box15(y)
    ck(int(np.sum(np.hypot(bx, by) <= 15.0)) == 5, 'Q2nearBoxes5')
    return ck.result()


@test('U-DEM1')
def t_dem1():
    ck = Checks()
    fd = _load('fetch_dem', os.path.join(HERE, 'fetch-dem.py'))
    with open(os.path.join(HERE, 'dem-manifest.json')) as f:
        man = json.load(f)
    worst = 0.0
    for t in man['tiles']:
        z, tx, ty = (int(v) for v in t['tile'].split('/'))
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            lon, lat = O.pix_lonlat(256.0 * (tx + dx), 256.0 * (ty + dy), z)
            fx, fy = fd.tile_float(float(lon), float(lat), z)
            worst = max(worst, abs(fx - (tx + dx)), abs(fy - (ty + dy)))
    ck(worst <= 1e-9, 'cornersInverse')
    ck.kv.update({'tiles': len(man['tiles']), 'maxErrTile': worst})
    return ck.result()


@test('U-DEM2')
def t_dem2():
    ck = Checks()
    r = np.array([0, 0, 0, 0, 1, 1, 1, 1, 1, 1])
    c = np.array([0, 0, 0, 1, 0, 0, 1, 1, 1, 1])
    h = np.array([1.0, 2.0, 3.0, 10.0, 4.0, 4.0, 0.0, 0.0, 0.0, 8.0])
    s6, n6, m6, s12, n12 = O.accumulate_cells(r, c, h, 4)
    hm = s6 / np.maximum(n6, 1)
    ck(np.array_equal(hm[:2, :2], [[2.0, 10.0], [4.0, 2.0]]) and np.array_equal(m6[:2, :2], [[3.0, 10.0], [4.0, 8.0]]), 'meanMax')
    ck(s12[0, 0] / n12[0, 0] == 3.2 and hm[:2, :2].mean() == 4.5, 'hmean12PixelWeighted')
    with open(os.path.join(HERE, 'dem-manifest.json')) as f:
        s = json.load(f)['sites']['kanazawa']
    keys = sorted(set(s['blockTiles']) | set(s['boxTiles']))
    tiles = {(int(k.split('/')[1]), int(k.split('/')[2])): np.full((256, 256), 123.0) for k in keys}
    first = sorted(tiles)[0]
    tiles[first] = np.full((256, 256), -50.0)
    g = O.grids_from_tiles(36.5679, 136.6774, 6, tiles)
    vals = set(np.unique(g['hmean6']).tolist())
    ck(vals <= {0.0, 123.0} or all(0.0 <= v <= 123.0 for v in vals), 'seaClipped')
    ck(np.all(g['hmax6'] <= 123.0) and np.all(g['hmean6'] >= 0.0) and g['pixPerCell'][0] >= 1, 'synthTiles')
    return ck.result()


@test('U-SLOPE')
def t_slope():
    ck = Checks()
    res = np.full(40, 1000.0)
    X = np.tile(np.arange(40.0)[None, :], (40, 1))
    Y = np.tile(np.arange(40.0)[:, None], (1, 40))
    bidx = np.zeros((40, 40), dtype=np.int64)
    exp_slope = math.degrees(math.atan(0.1))
    for name, hm, asp in (('east', 0.1 * X * 1000.0, 270.0), ('north', -0.1 * Y * 1000.0, 180.0),
                          ('west', -0.1 * X * 1000.0, 90.0), ('south', 0.1 * Y * 1000.0, 0.0)):
        ge, gn = O.pixel_gradients(hm, res)
        sl, a = O.box_slope_aspect(bidx, ge, gn, nbox=1)
        ck(abs(sl[0] - exp_slope) <= 1e-6 and O.ang_dist(a[0], asp) <= 1e-6, name)
    hm = 0.1 * X * 1000.0
    hm[5, 5] = np.nan
    ge, gn = O.pixel_gradients(hm, res)
    ck(np.isnan(ge[5, 4]) and np.isnan(ge[5, 6]) and np.isnan(gn[4, 5]) and np.isnan(gn[6, 5]) and np.isfinite(ge[5, 7]), 'nanNeighbours')
    ck.kv['slopeDeg'] = exp_slope
    return ck.result()


@test('U-LATEST')
def t_latest():
    ck = Checks()
    with open(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'modis-times.json')) as f:
        mt = json.load(f)
    with open(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'modis-times-latest.json')) as f:
        ml = json.load(f)
    bad = [n for n in sorted(mt) if O.latest_from_passes(mt[n]) != ml[n]['modisTimeUtc']]
    ck(not bad and len(mt) == 121, 'all121')
    ck.kv.update({'n': len(mt), 'differ': len(bad)})
    return ck.result()


@test('U-SITES')
def t_sites():
    ck = Checks()
    a = O.fetch_sat().SITES
    b = _load('fetch_dem2', os.path.join(HERE, 'fetch-dem.py')).SITES
    c = _load('fetch_sounding', os.path.join(HERE, 'fetch-sounding.py')).SITES
    ck(a == b == c, 'identical')
    return ck.result()


@test('U-SUN')
def t_sun():
    ck = Checks()
    su = _load('solar_util', os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'solar_util.py'))
    rng = np.random.default_rng(SEED)
    bad = 0
    for _ in range(200):
        t = datetime(2026, 6, 1, tzinfo=UTC) + timedelta(seconds=int(rng.integers(0, 153 * 86400)))
        la, lo = float(rng.uniform(-60, 60)), float(rng.uniform(-180, 180))
        bad += O.sun_alt_deg(t, la, lo) != su.sun_alt_deg(t, la, lo)
    ck(bad == 0, 'equalsSolarUtil')
    return ck.result()


@test('U-SUNAZ')
def t_sunaz():
    ck = Checks()
    t = datetime(2026, 10, 15, tzinfo=UTC) + timedelta(hours=9.02)
    az = O.sun_az_deg(t, 40.0, 0.0)
    ck(abs(az - 132.0) <= 1.0, 'terra0902')
    best = max((O.sun_alt_deg(datetime(2026, 10, 15, tzinfo=UTC) + timedelta(minutes=m), 40.0, 0.0), m) for m in range(600, 840))
    azn = O.sun_az_deg(datetime(2026, 10, 15, tzinfo=UTC) + timedelta(minutes=best[1]), 40.0, 0.0)
    ck(abs(azn - 180.0) <= 0.5, 'noon')
    azm = O.sun_az_deg(datetime(2026, 10, 15, 8, 0, tzinfo=UTC), 40.0, 0.0)
    ck(90.0 < azm < 180.0, 'morning')
    ck.kv.update({'az0902': az, 'altAt0902': O.sun_alt_deg(t, 40.0, 0.0), 'azNoon': azn})
    return ck.result()


@test('U-GEOM0')
def t_geom0():
    ck = Checks()

    def fn_text(path):
        with open(path, encoding='utf-8') as f:
            s = f.read()
        m = re.search(r'^def point_in_poly\(.*?(?=^\S)', s, flags=re.S | re.M)
        return m.group(0).rstrip() if m else None
    a = fn_text(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'fetch-modis-time.py'))
    b = fn_text(os.path.join(HERE, 'oro-geom.py'))
    ck(a is not None and a == b, 'verbatimCopy')
    return ck.result()


@test('U-GEOM1')
def t_geom1():
    ck = Checks()
    G = _geo()
    quad = [(30.0, 120.0), (30.0, 140.0), (40.0, 140.0), (40.0, 120.0), (30.0, 120.0)]
    ck(G.point_in_poly(35.0, 130.0, quad) and not G.point_in_poly(45.0, 130.0, quad) and not G.point_in_poly(35.0, 141.0, quad),
       'quad')
    am = [(10.0, 170.0), (10.0, -170.0), (20.0, -170.0), (20.0, 170.0)]
    # (the wrap maps vertices to ±180° of the point, so the rule is meant for points near the polygon)
    ck(G.point_in_poly(15.0, 179.5, am) and G.point_in_poly(15.0, -179.5, am) and not G.point_in_poly(15.0, 165.0, am)
       and not G.point_in_poly(25.0, 179.5, am) and not G.point_in_poly(15.0, -165.0, am), 'antimeridian')
    c = G.window_corners(36.0, 130.0)
    ck(c[0][0] < 36 and c[0][1] < 130 and c[2][0] > 36 and c[2][1] > 130 and abs((c[2][0] - 36.0) * 111.32 - 90.0) < 1e-9, 'corners')
    e = {'modisTimeUtc': '2026-09-01T01:10:00Z', 'times': ['2026-09-01T01:10:00.000Z', '2026-09-01T01:05:00.000Z',
                                                            '2026-09-01T22:00:00.000Z'], 'source': 'cmr'}
    ck(G.pass_granules(e) == ['2026-09-01T01:05:00.000Z', '2026-09-01T01:10:00.000Z'], 'passRegroup')
    ck(G.pass_granules(dict(e, source='solar')) is None and G.pass_granules(dict(e, modisTimeUtc='2026-09-01T03:00:00Z')) is None,
       'noPass')
    return ck.result()


@test('U-GEOM2')
def t_geom2():
    ck = Checks()
    p = os.path.join(HERE, 'cmr-geom.json')
    if not os.path.exists(p):
        raise Skip('cmr-geom.json absent')
    with open(p) as f:
        g = json.load(f)
    st = {}
    for v in g['scenes'].values():
        st[v['status']] = st.get(v['status'], 0) + 1
        if v['status'] == 'ok':
            ck(v['A8'] == all(v['cornersInside']), 'A8consistent')
    ck(len(g['scenes']) == 121 and set(st) <= {'ok', 'no-pass', 'missing-granules'}, 'allHaveStatus')
    ck(st.get('missing-granules', 0) == 0, 'noMissingGranules')
    ck.kv.update({f'n_{k}': v for k, v in sorted(st.items())})
    ck.kv['A8true'] = sum(1 for v in g['scenes'].values() if v['A8'] is True)
    return ck.result()


def _dest(lat, lon, d_km, brg):
    la1, lo1, b = math.radians(lat), math.radians(lon), math.radians(brg)
    d = d_km / 6371.0
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)


@test('U-GEOM3')
def t_geom3():
    ck = Checks()
    G = _geo()
    c = (40.0, 130.0)
    n, s = _dest(*c, 1000.0, 0.0), _dest(*c, 1000.0, 180.0)
    quad = [_dest(*s, 1165.0, 270.0), _dest(*s, 1165.0, 90.0), _dest(*n, 1165.0, 90.0), _dest(*n, 1165.0, 270.0)]
    quad.append(quad[0])
    on, st0 = G.cross_track_km(quad, c)
    edge, st1 = G.cross_track_km(quad, _dest(*c, 1165.0, 90.0))
    ck(st0 == 'ok' and on <= 1e-6, 'onTrack')
    ck(st1 == 'ok' and abs(edge - 1165.0) <= 0.02 * 1165.0, 'swathEdge')
    rot = quad[1:4] + [quad[0], quad[1]]
    ck(abs(G.cross_track_km(rot, _dest(*c, 1165.0, 90.0))[0] - edge) <= 1e-6, 'vertexOrder')
    ck(G.cross_track_km(quad[:3] + [quad[0]], c) == (None, 'nonquad'), 'nonquad')
    ck.kv.update({'onTrackKm': on, 'edgeKm': edge})
    return ck.result()


@test('U-HASH')
def t_hash():
    ck = Checks()
    a = {'b': [1.0, 0.1, 1e-300], 'a': {'y': None, 'x': True}, 'ü': 'é'}
    b = {'ü': 'é', 'a': {'x': True, 'y': None}, 'b': [1.0, 0.1, 1e-300]}
    ck(O.dumps_json(a) == O.dumps_json(b) and json.loads(O.dumps_json(a)) == a, 'dumpDeterministic')
    try:
        O.dumps_json({'x': float('nan')})
        ck(False, 'nanRefused')
    except ValueError:
        pass
    rng = np.random.default_rng(SEED)
    X = rng.standard_normal((128, 128))
    ck(np.array_equal(O.dec_f32(O.f32b64(X), 128), X.astype(np.float32).astype(np.float64)), 'f32RoundTrip')
    v = [0.1, None, 0.5, None] + [0.25] * 87
    e = O.ring_entry(v)
    d = O.dec_f64(e['f64'])
    ck(e['nullIdx'] == [1, 3] and np.array_equal(np.flatnonzero(np.isnan(d)), [1, 3]) and d[0] == 0.1 and d.size == 91, 'nanNullIdx')
    ck(len(base64.b64decode(e['f64'])) == 91 * 8, 'f64Bytes')
    return ck.result()


@test('U-PEARSON')
def t_pearson():
    ck = Checks()
    ck(O.pearson([], []) is None and O.pearson([1.0], [2.0]) == 0.0 and O.pearson([1, 1, 1], [1, 2, 3]) == 0.0, 'edgeCases')
    a, b = [1.0, 2.0, 3.0, 5.0], [2.0, 4.0, 6.5, 6.0]
    ck(abs(O.pearson(a, b) - statistics.correlation(a, b)) <= 1e-12 and abs(O.pearson([1, 2, 3], [3, 2, 1]) + 1) <= 1e-15,
       'values')
    return ck.result()


@test('U-FP')
def t_fp():
    ck = Checks()
    p = os.path.join(HERE, 'oro-fingerprint.py')
    ck(O.sha256_file(p) == FP_SHA, 'sha256')
    opened = []
    _REC['on'] = opened
    try:
        m = _load('oro_fingerprint', p)
    finally:
        _REC['on'] = None
    # the import system's own bytecode-cache probe (__pycache__/*.pyc read attempt, nothing written) is not the module's code
    others = [x for x in opened if os.path.abspath(x).startswith(ROOT + os.sep) and os.path.abspath(x) != os.path.abspath(p)
              and os.sep + '__pycache__' + os.sep not in x]
    ck(callable(getattr(m, 'main', None)) and not others, 'importRunsNothing')
    ck.kv['opensDuringImport'] = len(others)
    return ck.result()


_REC = {'on': None}


def _rec_hook(event, args):
    if event == 'open' and _REC['on'] is not None and args and isinstance(args[0], (str, bytes)):
        _REC['on'].append(os.fsdecode(args[0]))


sys.addaudithook(_rec_hook)


# ───────────────────────── §5.2 builder fixtures and tests ─────────────────────────
def _syn_sounding_file(path):
    """B-SYN sounding: standard atmosphere for the 10 sites, 06-01..10-31 hourly, elevation 0; injected nulls:
    T850 null at every 01:00Z (fallback2 near the ~01Z scenes), RH850 null 00..02Z (fallback1 for ~23-24Z scenes),
    Z700 null 04..13Z for hamburg (its passes are 08:25–09:50Z, so the ±3 h fallback finds nothing → incomplete), and a Denver-like variant (elevation 1600 m, null 1000..900 hPa)."""
    times = _hours('2026-06-01T00:00', 153 * 24)
    hh = [int(s[11:13]) for s in times]
    out = {}
    for site, (la, lo, _g) in O.sites_table().items():
        elev = 1600.0 if site == 'denver' else 0.0
        h = _std_hourly(times, elev)
        h['temperature_850hPa'] = [None if x == 1 else v for x, v in zip(hh, h['temperature_850hPa'])]
        h['relative_humidity_850hPa'] = [None if x in (0, 1, 2) else v for x, v in zip(hh, h['relative_humidity_850hPa'])]
        if site == 'hamburg':
            h['geopotential_height_700hPa'] = [None if 4 <= x <= 13 else v for x, v in zip(hh, h['geopotential_height_700hPa'])]
        if site == 'denver':
            for p in (1000, 975, 950, 925, 900):
                for var in ('temperature', 'geopotential_height', 'relative_humidity'):
                    h[f'{var}_{p}hPa'] = [None] * len(times)
        out[site] = {'lat': la, 'lon': lo, 'elevation': elev, 'hourly': h}
    with open(path, 'w') as f:
        json.dump(out, f)


def _syn_base(inputs_path, base_dir):
    """Synthetic Float32 B for the closest time (n = 128 and n = 64) + an oro-base-like index (MODIS-free, deterministic)."""
    fresh_dir(base_dir)
    with open(inputs_path, 'rb') as f:
        raw = f.read()
    inp = json.loads(raw)
    fields = [1 / (1 + np.exp(-1.2 * smooth_field(128, 100, SEED + i))) for i in range(6)]
    f64s = [1 / (1 + np.exp(-1.2 * smooth_field(64, 100, SEED + i, 12000.0))) for i in range(6)]
    ent, e64 = {}, {}
    for j, sc in enumerate(sorted(inp['scenes'])):
        ent[sc] = {tk: {b: None for b in BANDS} for tk in TIME_KEYS}
        e64[sc] = {}
        for i, b in enumerate(BANDS):
            k = (j + i) % 6
            amp = 0.15 if b == 'high' else 0.8
            for n, F, nm in ((128, fields[k], f'{sc}__closest__{b}.f32'), (64, f64s[k], f'{sc}__closest__{b}__n64.f32')):
                arr = (amp * F).astype('<f4')
                body = arr.tobytes()
                with open(os.path.join(base_dir, nm), 'wb') as f:
                    f.write(body)
                if n == 128:
                    ent[sc]['closest'][b] = sha(body)
                else:
                    e64[sc][b] = sha(body)
    O.dump_json({'schema': 'oro-base-index/1', 'commit': 'synthetic', 'bundleSha256': None, 'esbuild': None, 'node': None,
                 'inputsFileSha256': sha(raw), 'entries': ent, 'entriesN64': e64}, os.path.join(base_dir, 'index.json'))


def _fixture_syn():
    """inputs (synthetic sounding) → synthetic B → seal-inputs → apply, all through the CLI, in test-tmp/syn (cached)."""
    if 'syn' not in _FIX:
        d = fresh_dir(T_SYN)
        snd = os.path.join(d, 'sounding-syn.json')
        _syn_sounding_file(snd)
        inp = os.path.join(d, 'oro-inputs.json')
        _run_ref(['inputs', '--sounding', snd, '--sounding-ecmwf', os.path.join(d, 'none.json'), '--out', inp])
        with open(inp, 'rb') as f:
            unsealed = f.read()
        base = os.path.join(d, 'base')
        _syn_base(inp, base)
        _run_ref(['seal-inputs', '--inputs', inp, '--base-index', os.path.join(base, 'index.json')])
        app = os.path.join(d, 'oro-apply.json')
        _run_ref(['apply', '--inputs', inp, '--base', base, '--out', app])
        _FIX['syn'] = {'dir': d, 'sounding': snd, 'inputs': inp, 'base': base, 'apply': app, 'unsealed': unsealed}
    return _FIX['syn']


def _fixture_busan():
    """Real sounding.json (busan only until 11-05) → inputs → apply with no B (bMissing), in test-tmp/busan (cached)."""
    if 'busan' not in _FIX:
        d = fresh_dir(T_BUSAN)
        inp = os.path.join(d, 'oro-inputs.json')
        _run_ref(['inputs', '--out', inp])
        base = fresh_dir(os.path.join(d, 'base-empty'))
        app = os.path.join(d, 'oro-apply.json')
        _run_ref(['apply', '--inputs', inp, '--base', base, '--out', app])
        _FIX['busan'] = {'dir': d, 'inputs': inp, 'apply': app}
    return _FIX['busan']


def _jload(p):
    with open(p) as f:
        return json.load(f)


@test('B-SYN')
def t_bsyn():
    ck = Checks()
    fx = _fixture_syn()
    inp, app = _jload(fx['inputs']), _jload(fx['apply'])
    dg = _jload(os.path.join(HERE, 'dem-grids.json'))
    ck(inp['schema'] == 'oro-inputs/1' and app['schema'] == 'oro-apply/1' and len(inp['scenes']) == 121, 'schema')
    ck(inp['pendingSites'] == {'sounding': [], 'ring': []} and not app['summary']['pendingSites']['sounding'], 'noPending')
    hows, nL, n2 = {}, 0, []
    for name, sc in sorted(inp['scenes'].items()):
        tm = sc['times']['closest']
        s = tm['snd']
        if not ck(s is not None, 'everySceneHasSnd'):
            break
        want = [850, 700] if O.z_std(850) >= dg['sites'][sc['site']]['zRefM'] + 500 else [700]
        nL += s['refLevels'] == want or sc['site'] == 'hamburg'      # hamburg: Z700 null → L from Z850 only, incomplete
        if s['N2'] is not None:
            n2.append(s['N2'])
        for k, v in s['interpHow'].items():
            hows[v] = hows.get(v, 0) + 1
        if sc['site'] == 'hamburg':
            ck(not s['complete'] and 'Z700' in s['missing'], 'hamburgIncomplete')
        elif sc['site'] == 'denver':
            ck(s['complete'] and tm['z0'] is not None and tm['zSnow'] is not None and s['refLevels'] == [700], 'denverDeepNulls')
        else:
            ck(s['complete'], 'complete')
        ck(sc['times']['closest']['bSha256'] is not None and sc['times']['closest']['bSha256n64'] is not None, 'sealed')
    ck(nL == 121, 'refLevels')
    ck(n2 and 0.9e-4 <= min(n2) and max(n2) <= 1.3e-4, 'N2')
    ck(hows.get('fallback2', 0) > 0 and hows.get('fallback1', 0) > 0, 'fallbacksExercised')
    rows = app['scenes']
    ran = [n for n, r in rows.items() if r['A6']['judge'] is not None]
    ck(len(ran) > 0 and all(rows[n]['counts'] is not None for n in ran), 'combinerRan')
    ck(all(not r['A5']['ok'] for n, r in rows.items() if r['site'] == 'hamburg'), 'hamburgA5false')
    ck(app['summary']['bMissing'] == 0 and app['summary']['provisional'] is False, 'notProvisional')
    ck(app['sources']['base'] == {'commit': 'synthetic', 'bundleSha256': None, 'esbuild': None}, 'baseRecorded')
    ck.kv.update({'nCombined': len(ran), 'nJudge': sum(r['judge'] for r in rows.values()),
                  'nAppA': sum(r['appA'] for r in rows.values()), 'fallback1': hows.get('fallback1', 0),
                  'fallback2': hows.get('fallback2', 0), 'N2min': min(n2), 'N2max': max(n2)})
    return ck.result()


@test('B-DET')
def t_bdet():
    ck = Checks()
    fx = _fixture_syn()
    d = fresh_dir(os.path.join(TMP, 'det'))
    a1, a2 = os.path.join(d, 'inputs1.json'), os.path.join(d, 'inputs2.json')
    for p in (a1, a2):
        _run_ref(['inputs', '--sounding', fx['sounding'], '--sounding-ecmwf', os.path.join(d, 'none.json'), '--out', p])
    ck(read_bytes(a1) == read_bytes(a2) == fx['unsealed'], 'inputsBytes')
    p1, p2 = os.path.join(d, 'apply1.json'), os.path.join(d, 'apply2.json')
    for p in (p1, p2):
        _run_ref(['apply', '--inputs', fx['inputs'], '--base', fx['base'], '--out', p])
    ck(read_bytes(p1) == read_bytes(p2) == read_bytes(fx['apply']), 'applyBytes')
    g1, g2 = os.path.join(d, 'dem1.json'), os.path.join(d, 'dem2.json')
    for p in (g1, g2):
        _run_ref(['dem-grids', '--out', p])
    committed = os.path.join(HERE, 'dem-grids.json')
    ck(read_bytes(g1) == read_bytes(g2), 'demGridsBytes')
    ck(os.path.exists(committed) and read_bytes(g1) == read_bytes(committed), 'demGridsEqualsWorkingTree')
    ck.kv['demGridsSha256'] = sha(read_bytes(g1))
    return ck.result()


@test('B-BUSAN')
def t_bbusan():
    ck = Checks()
    fx = _fixture_busan()
    inp, app = _jload(fx['inputs']), _jload(fx['apply'])
    with open(os.path.join(ROOT, '.harness', 'oro', 'sounding.json')) as f:
        have = sorted(json.load(f))
    expect_pending = sorted(s for s in O.sites_table() if s not in have)
    ck(inp['pendingSites']['sounding'] == expect_pending == app['summary']['pendingSites']['sounding'], 'pendingFromData')
    sm = app['summary']
    exp_prov = bool(expect_pending or sm['pendingSites']['ring'] or sm['bMissing'])
    ck(sm['provisional'] == exp_prov, 'provisional')
    ecm = os.path.exists(os.path.join(ROOT, '.harness', 'oro', 'sounding-ecmwf.json'))
    ck((inp['sources']['sounding']['ecmwf'] is None) != ecm and sm['ecmwfArm'] == ('available' if ecm else '못 잼(미수신)'), 'ecmwfArm')
    for name, sc in inp['scenes'].items():
        s = sc['times']['closest']['snd']
        if sc['site'] in have:
            ck(s is not None, 'recordedSitesHaveSnd')
        else:
            ck(s is None and app['scenes'][name]['A5']['soundingMissing'] == ['site'], 'pendingSitesNull')
    nc = sum(1 for sc in inp['scenes'].values() if sc['times']['closest']['snd'] and sc['times']['closest']['snd']['complete'])
    if not expect_pending:
        ck(sm['pendingSites']['sounding'] == [] and (sm['provisional'] is False or sm['bMissing'] > 0), 'tenOfTen')
    ck.kv.update({'sitesWithSounding': len(have), 'pending': len(expect_pending), 'completeClosest': nc,
                  'bMissing': sm['bMissing'], 'provisional': sm['provisional']})
    return ck.result()


@test('B-RING')
def t_bring():
    ck = Checks()
    fx = _fixture_busan()
    inp = _jload(fx['inputs'])
    fn = O.fetch_nwp()
    names = sorted(inp['scenes'])[::50][:3]
    for name in names:
        sc = inp['scenes'][name]
        raw = _jload(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'nwp', 'blend', sc['site'] + '.json'))
        got = O.dec_f64(sc['times']['closest']['ring']['total']['f64'])
        exp = []
        for d in raw['data']:
            h = d['hourly']
            v = fn.interp(h['time'], fn.blend(h, 'cloud_cover', raw['models']), sc['times']['closest']['utc'])
            exp.append(np.nan if v is None else v / 100.0)
        ck(np.array_equal(got, np.array(exp), equal_nan=True), name)
    ck.kv['scenes'] = len(names)
    return ck.result()


@test('B-SUM')
def t_bsum():
    ck = Checks()
    for tag, fx in (('syn', _fixture_syn()), ('busan', _fixture_busan())):
        app, inp = _jload(fx['apply']), _jload(fx['inputs'])
        sm = app['summary']
        held = {s for s, (_, _, g) in O.sites_table().items() if g == 'held'}
        ext = sorted(s for s in held if sm['a1BySite'][s]['ok'])
        re_ = O.summarize(app['scenes'], inp['pendingSites'], sm['a1BySite'], ext, inp['sources']['sounding']['ecmwf'] is not None)
        ck(json.loads(O.dumps_json(re_)) == sm, f'{tag}Recomputed')
        cnt = [r for r in app['scenes'].values() if r['counted']]
        ck(sm['n'] == len(cnt) and all(r['group'] == 'held' and r['judge'] for r in cnt), f'{tag}Counted')
    return ck.result()


@test('U-ALLOWB')
def t_allowb():
    """U-ALLOW builder part (S3-design §1.13): inputs bytes do not depend on MODIS keys in the scene files."""
    ck = Checks()
    mt = _jload(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'modis-times.json'))
    names = [n for n in sorted(mt) if n.startswith(('busan_', 'seoul_'))][:3]
    order = O.ring91()
    outs = []
    for fake in (False, True):
        d = fresh_dir(os.path.join(TMP, 'allowb', 'fake' if fake else 'clean'))
        for n in names:
            site, date = n.rsplit('_', 1)
            la, lo, _g = O.sites_table()[site]
            sc = {'site': site, 'lat': la, 'lon': lo, 'date': date, 'grid': 256, 'cellKm': 3.0,
                  'ring': [{'dist': a, 'az': b} for a, b in order]}
            if fake:
                sc.update({'trueGrid': base64.b64encode(bytes(range(256)) * 256).decode('ascii'), 'cover': 0.77, 'empty': 0.01,
                           'extra': {'x': 1}})
                sc['ring'] = [dict(r, cover=0.3) for r in sc['ring']]
            with open(os.path.join(d, n + '.json'), 'w') as f:
                json.dump(sc, f)

        def table(bank, d=d):
            t = dict(O.bank_table(bank))
            t['dir'] = d
            return t
        doc = O.build_inputs(('orig',), table=table, sounding_ecmwf=os.path.join(d, 'none.json'))
        outs.append(O.dumps_json(doc))
    ck(outs[0] == outs[1], 'builderIndependentOfFakeKeys')
    ck(len(json.loads(outs[0])['scenes']) == len(names), 'scenes')
    return ck.result()


@test('U-SEAL')
def t_seal():
    ck = Checks()
    fx = _fixture_syn()
    d = fresh_dir(os.path.join(TMP, 'seal'))
    p = os.path.join(d, 'oro-inputs.json')
    with open(p, 'wb') as f:
        f.write(fx['unsealed'])
    idx = os.path.join(fx['base'], 'index.json')
    s1 = O.seal_inputs(p, idx)
    ck(s1.encode('utf-8') == read_bytes(fx['inputs']), 'sealEqualsFixture')
    s2 = O.seal_inputs(p, idx)
    ck(s2 == s1, 'idempotentReseal')
    bad = _jload(idx)
    bad['inputsFileSha256'] = '0' * 64
    bp = os.path.join(d, 'bad-index.json')
    O.dump_json(bad, bp)
    try:
        O.seal_inputs(p, bp)
        ck(False, 'refusesForeignIndex')
    except ValueError:
        pass
    # Partial index (same inputsFileSha256): (a) entries/entriesN64 cut to the first 3 scenes, as an
    # `oro-base.mjs --scenes a,b,c` run writes it; (c) one scene deleted from both entries and entriesN64; (b) one time key
    # removed from one scene. All must be refused and leave the (unsealed) inputs bytes as they were, not seal the missing
    # ones as B-null.
    full = _jload(idx)
    first3 = sorted(full['entries'])[:3]
    part_a = dict(full, entries={s: full['entries'][s] for s in first3},
                  entriesN64={s: full['entriesN64'][s] for s in first3})
    sc_c = sorted(full['entries'])[-1]
    part_c = dict(full, entries={s: v for s, v in full['entries'].items() if s != sc_c},
                  entriesN64={s: v for s, v in full['entriesN64'].items() if s != sc_c})
    part_b = json.loads(json.dumps(full))
    sc_b = sorted(part_b['entries'])[len(part_b['entries']) // 2]
    del part_b['entries'][sc_b][sorted(part_b['entries'][sc_b])[-1]]
    for tag, doc in (('refusesPartialScenes', part_a), ('refusesOneSceneMissing', part_c), ('refusesMissingTime', part_b)):
        ip = os.path.join(d, f'oro-inputs.{tag}.json')
        with open(ip, 'wb') as f:
            f.write(fx['unsealed'])
        xp = os.path.join(d, f'index.{tag}.json')
        O.dump_json(doc, xp)
        ck(doc['inputsFileSha256'] == sha(fx['unsealed']), f'{tag}:sameInputsSha')
        try:
            O.seal_inputs(ip, xp)
            ck(False, tag)
        except ValueError:
            pass
        ck(read_bytes(ip) == fx['unsealed'], f'{tag}:inputsUnchanged')
    return ck.result()


# ───────────────────────── §5.3 G6 (a)–(e) ─────────────────────────
@test('G6a')
def t_g6a():
    """Witch of Agnesi (L759, Q-32): 4 perpendicular cases (|η − η_a| ≤ 5 m on |s| ≤ 100 km, argmax at s = −a, η_w(−a) > 0 >
    η_w(+a)) and 4 parallel cases (η ≡ 0, η_w ≡ 0)."""
    ck = Checks()
    n, dx, h0, a, U0, N = 512, 2000.0, 100.0, 10000.0, 10.0, 0.01
    x = (np.arange(n) - 256) * dx
    prof = h0 * a * a / (x * x + a * a)
    z = 0.5 * math.pi * U0 / N
    k, l = O.kgrid(n, dx)
    worst, worst_par = 0.0, 0.0
    near = np.abs(x) <= 100000.0
    for ridge in ('x', 'y'):
        H = np.tile(prof[None, :], (n, 1)) if ridge == 'x' else np.tile(prof[:, None], (1, n))
        Hh = np.fft.fft2(H)
        Hh[0, 0] = 0.0
        for wind in ('+x', '-x', '+y', '-y'):
            U = U0 if wind == '+x' else (-U0 if wind == '-x' else 0.0)
            V = U0 if wind == '+y' else (-U0 if wind == '-y' else 0.0)
            eta = np.real(np.fft.ifft2(Hh * O.vertical_decay(k, l, U, V, N, 0.0, z)))
            W, _ = O.col_weight(k, l, U, V, N, 0.0, 2500.0)
            etaw = np.real(np.fft.ifft2(Hh * O.low_sigma_damp(k, l, U, V) * W))
            tag = f'{ridge}{wind}'
            if ridge == wind[1]:
                line = eta[0, :] if ridge == 'x' else eta[:, 0]
                linew = etaw[0, :] if ridge == 'x' else etaw[:, 0]
                sgn = 1.0 if wind[0] == '+' else -1.0
                s = sgn * x
                ea = -h0 * a * s / (s * s + a * a)
                err = float(np.max(np.abs(line - ea)[near]))
                worst = max(worst, err)
                ck(err <= 5.0, f'{tag}_analytic')
                ck(s[int(np.argmax(line))] == -a, f'{tag}_argmaxUpwind')
                i_up, i_dn = int(np.argmin(np.abs(s + a))), int(np.argmin(np.abs(s - a)))
                ck(linew[i_up] > 0 > linew[i_dn], f'{tag}_etaWsign')
            else:
                m = max(float(np.max(np.abs(eta))), float(np.max(np.abs(etaw))))
                worst_par = max(worst_par, m)
                ck(m <= 1e-9, f'{tag}_parallelZero')
    ck.kv.update({'maxErrPerpM': worst, 'maxAbsParallelM': worst_par, 'zM': z})
    return ck.result()


def _fastscape():
    p = os.path.join(REF_DIR, 'orographic_precipitation.py')
    if '--fetch-ref' in sys.argv and not (os.path.exists(p) and O.sha256_file(p) == FS_SHA):
        os.makedirs(REF_DIR, exist_ok=True)
        body = None
        for i in range(3):
            try:
                with urllib.request.urlopen(FS_URL, timeout=60) as r:
                    body = r.read()
                break
            except Exception:       # noqa: BLE001
                if i == 2:
                    raise
        with open(p, 'wb') as f:
            f.write(body)
    if not os.path.exists(p):
        raise Skip('fastscape reference absent (run with --fetch-ref)')
    got = O.sha256_file(p)
    if got != FS_SHA:
        return None, got                  # sha checked on the bytes BEFORE exec_module (D8): never imported on mismatch
    return _load('fastscape_op', p), got


@test('G6b')
def t_g6b():
    """fastscape branch vs fastscape (L760, Q-33): rms(P − P_fs)/std(P_fs) ≤ 1e-5 for winds W, S, SW."""
    ck = Checks()
    fs, got = _fastscape()
    if not ck(fs is not None, 'sha256'):
        ck.kv['sha'] = got
        return ck.result()
    h = synth_terrain(128, 6000.0, beta=3.0, rms=400.0, seed=7)
    h -= h.min()
    dx, lat, cw, tc, tf, Hw, N = 6000.0, 37.0, 0.004, 1000.0, 1000.0, 2500.0, 0.01
    f = 2 * O.OMEGA * math.sin(math.radians(lat))
    pad = min(int(np.ceil(sum(h.shape) / 2) / 100 * 100), 200)
    hp = np.pad(h, pad)
    k, l = O.kgrid(hp.shape[0], dx)
    Hh = np.fft.fft2(hp)
    for d in (270.0, 180.0, 225.0):
        par = dict(latitude=lat, precip_base=1e4, precip_min=0.0, wind_speed=10.0, wind_dir=d, conv_time=tc, fall_time=tf,
                   nm=N, hw=Hw, cw=cw)
        Pfs = (fs.compute_orographic_precip(h[::-1], dx, dx, **par)[::-1] - 1e4) / 3600.0
        U, V = O.wind_to_uv(10.0, d)
        sig = U * k + V * l
        vals = {}
        for br in ('fastscape', 'physical'):
            W, _ = O.col_weight(k, l, U, V, N, f, Hw, branch=br)
            P = np.real(np.fft.ifft2(cw * 1j * sig * Hh * W / ((1 + 1j * sig * tc) * (1 + 1j * sig * tf))))[pad:-pad, pad:-pad]
            vals[br] = float(np.sqrt(np.mean((P - Pfs) ** 2)) / np.std(Pfs))
        ck(vals['fastscape'] <= 1e-5, f'wind{int(d)}')
        ck.kv[f'relrms{int(d)}'] = vals['fastscape']
        ck.kv[f'physical{int(d)}'] = vals['physical']
    ck.kv['pad'] = pad
    return ck.result()


@test('G6c')
def t_g6c():
    """F ≡ 0 → C array_equal B (L761): U-COMB1 case, plus B files of the first 3 scenes × 4 bands (real sealed B if present,
    else the B-SYN synthetic B), and apply_or_identity(B, F, False) is B."""
    ck = Checks()
    B = _comb_B()
    ck(np.array_equal(O.combine(B, np.zeros_like(B))['C'], B), 'synthetic')
    src = 'syn'
    inp_path, base = None, None
    if os.path.exists(REAL_INPUTS) and os.path.exists(os.path.join(ROOT, '.harness', 'oro', 'base', 'index.json')):
        ri = _jload(REAL_INPUTS)
        if any(sc['times']['closest'].get('bSha256') for sc in ri['scenes'].values()):
            inp_path, base, src = REAL_INPUTS, os.path.join(ROOT, '.harness', 'oro', 'base'), 'real'
    if inp_path is None:
        fx = _fixture_syn()
        inp_path, base = fx['inputs'], fx['base']
    inp = _jload(inp_path)
    nb = 0
    for name in sorted(inp['scenes'])[:3]:
        for b in BANDS:
            Bb = O.load_B(name, 'closest', b, inp, base)
            if Bb is None:
                continue
            nb += 1
            ck(np.array_equal(O.combine(Bb, np.zeros_like(Bb))['C'], Bb), f'{name}_{b}')
            ck(O.apply_or_identity(Bb, np.ones_like(Bb), False) is Bb, f'{name}_{b}_identity')
    ck(nb == 12, 'twelveB')
    ck.kv.update({'source': src, 'nB': nb})
    return ck.result()


def _mountain_bands(site, mlat, mlon, dg):
    ent = dg['sites'][site]
    lat0, lon0 = ent['lat'], ent['lon']
    hm = O.dec_f32(ent['hmean6'], 128)
    x, y = O.cell_xy_km()
    mx = ((mlon - lon0 + 540) % 360 - 180) * 111.32 * math.cos(math.radians(lat0))
    my = (mlat - lat0) * 111.32
    near = np.hypot(x - mx, y - my) <= 20.0
    i = int(np.argmax(np.where(near, hm, -np.inf)))
    xp, yp = x.flat[i], y.flat[i]
    band = np.abs(y - yp) <= 12.0
    west = band & (x >= xp - 24.0) & (x <= xp - 6.0)
    east = band & (x >= xp + 6.0) & (x <= xp + 24.0)
    return hm, lat0, west, east, float(hm.flat[i])


@test('G6d')
def t_g6d():
    """Known mountains (L762, Q-34): westerly 10 m/s → mean F west band > 0 > east band at Hakusan and Odaesan.
    The easterly mirror is report-only."""
    ck = Checks()
    dg = _jload(os.path.join(HERE, 'dem-grids.json'))
    kap = O.gamma_s(280.0) / 0.15
    for tag, site, mlat, mlon in (('hakusan', 'kanazawa', 36.1550, 136.7714), ('odaesan', 'seoul', 37.7944, 128.5431)):
        hm, lat0, west, east, hpk = _mountain_bands(site, mlat, mlon, dg)
        hs, _ = O.h_sub_field(hm)
        for d, key in ((270.0, 'W'), (90.0, 'E')):
            U, V = O.wind_to_uv(10.0, d)
            F = O.forcing(hs, {'Vref': [U, V], 'N': 0.01, 'Hw_m': 2500.0, 'kappa': kap}, lat0)
            fw, fe = float(F[west].mean()), float(F[east].mean())
            ck.kv[f'{tag}{key}west'] = fw
            ck.kv[f'{tag}{key}east'] = fe
            if key == 'W':
                ck(fw > 0 > fe, f'{tag}Westerly')
        ck.kv[f'{tag}PeakM'] = hpk
    return ck.result()


@test('G6e')
def t_g6e():
    """DEM orientation (kanazawa: sea NW, land SE; L763, Q-35) and from→toward wind with the busan sounding at
    2026-09-01T01:00Z (on the hour)."""
    ck = Checks()
    dg = _jload(os.path.join(HERE, 'dem-grids.json'))
    hm = O.dec_f32(dg['sites']['kanazawa']['hmean6'], 128)
    x, y = O.cell_xy_km()
    nw = (x >= -90) & (x <= -30) & (y >= 30) & (y <= 90)
    se = (x >= 30) & (x <= 90) & (y >= -90) & (y <= -30)
    fnw, fse = float(np.mean(hm[nw] == 0.0)), float(np.mean(hm[se] == 0.0))
    ck(fnw >= 0.9 and fse <= 0.1, 'orientation')
    ck.kv.update({'seaNW': fnw, 'seaSE': fse})
    for d, (u, v) in {0: (0, -10), 90: (-10, 0), 180: (0, 10), 270: (10, 0), 225: (7.0710678, 7.0710678)}.items():
        U, V = O.wind_to_uv(10.0, d)
        ck(abs(U - u) <= 1e-7 and abs(V - v) <= 1e-7, f'hand{d}')
    snd = O.load_soundings(os.path.join(ROOT, '.harness', 'oro', 'sounding.json')).get('busan')
    if snd is None:
        ck.kv['busan'] = 'absent'
        raise Skip('busan sounding missing')
    t = datetime(2026, 9, 1, 1, 0, tzinfo=UTC)
    i = snd.index['2026-09-01T01:00']
    S, dd = snd.series('wind_speed_700hPa')[i], snd.series('wind_direction_700hPa')[i]
    r = O.ref_values(snd, t, dg['sites']['busan']['zRefM'], 35.18, None, None)
    U, V = r['levels']['700']['U'], r['levels']['700']['V']
    brg = math.degrees(math.atan2(U, V)) % 360.0
    ck(O.ang_dist(brg, (dd + 180.0) % 360.0) <= 1e-9 and abs(math.hypot(U, V) - S) <= 1e-9 * max(1.0, S), 'busan700')
    ck.kv.update({'busanFromDeg': dd, 'busanTowardDeg': brg, 'busanSpeed': S})
    return ck.result()
# ═══════════════════════ S3a MODEL TESTS — END ═══════════════════════


# ───────────────────────── 실행 ─────────────────────────
def main(argv):
    def opt(k, dflt=None):
        return argv[argv.index(k) + 1] if k in argv else dflt
    only = set(x for x in (opt('--only') or '').split(',') if x)
    known = {t for t, _ in TESTS}
    if only - known:
        print(f'unknown test ids: {sorted(only - known)}', file=sys.stderr)
        return 2
    lines, n_fail = [], 0
    for tid, fn in sorted(TESTS):
        if only and tid not in only:
            continue
        try:
            ok, kv = fn()
            status = 'PASS' if ok else 'FAIL'
        except Skip as e:
            status, kv = 'SKIP', {'reason': str(e)}
        except Exception as e:      # 시험 코드의 예외도 FAIL 로(메시지는 경로·키 이름뿐)
            status, kv = 'FAIL', {'error': type(e).__name__, 'msg': str(e)[:160]}
        n_fail += status == 'FAIL'
        line = ' '.join([tid, status] + [f'{k}={fmt(v)}' for k, v in kv.items()])
        print(line, flush=True)
        lines.append(line)
    out = opt('--out', None if only else os.path.join(HERE, 'oro-test.txt'))
    if out:
        with open(out, 'w', encoding='utf-8', newline='\n') as f:
            f.write(HEADER + ''.join(ln + '\n' for ln in sorted(lines)))
    return 1 if n_fail else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
