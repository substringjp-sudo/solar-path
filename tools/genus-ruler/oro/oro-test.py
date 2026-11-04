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

S3b(oro.py, S3-design §6.9): U-TAU · U-APP · U-LAMAPP · B-FILL(§6.1), U-TRUTH · U-EMPTY · U-MASKJ(§6.2),
  U-METRIC · U-LMINUS · U-FINE · U-C45 · U-AUX · U-SCENE · U-ARMS0 · U-GSHUF(§6.3, §6.5 팔), U-BOOT · U-SIGNFLIP · U-STATS(§6.4),
  U-CLAUSE(§6.5), U-RHASH · U-PRECHK(§6.6), G6f · G6g · G6h(가짜 참값, test-tmp), G8b~G8f(G8d 는 합성 git 저장소에서만 판정을
  돌림 — 진짜 은행 경로는 열지 않고, 진짜 저장소에는 --precheck 만), P-EQ · P-PLACE · P-CAL · P-MODA · P-MODB · P-MUTE · P-DOC ·
  P-ZERO · P-COMMITTED(§6.7 --power), S-EVE · S-A15 · S-E2E · S-COMMITTED · S-GUARD(§6.8 --sunset; PS-10 에서 옮겨 옴).
  G8d·G8e 의 동결 뒤 갈래(FROZEN.json 이 있을 때)는 지금 합성 동결 저장소에서 미리 돌림(oro-test.py 는 동결 파일).
  G6f 는 커밋된 oro-apply.json 의 dev 판정 장면(A1~A8)을 날짜 순으로 쓰고 모자라면 합성으로 채움; 11-05 재빌드가 탈 dev 갈래는
  B-SYN 고정물로 미리 돌림(키 앞 'dry'). G8c 는 FROZEN.json 이 oro-test.txt 뒤에 쓰이므로(L876) 동결 전에는 마른 구조 시험
  (mode=dry), FROZEN.json 이 있으면 진짜 파일도 봄(mode=real). 동결 뒤 G8 을 다시 잴 때(§9.3 ②)는 --only G8a,…,G8f 로
  돌리고 --out 은 주지 않거나 다른 곳으로(oro-test.txt 는 동결 파일, L876).
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
sys.modules['oro_ref'] = O              # oro.py reuses this instance: one guard, one allow() context per process
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
    "# Pinned additions, not ruler values (S3b, build notes 12-13): G6(f)(g)(h) fixtures - synthetic sounding (U 8 m/s, "
    "N 0.01, H_w 2500 m, kappa = gamma_s(280 K)/0.15), synthetic B = logistic(1.2 smooth_field(128, 100 km, seed "
    "20261103+11..14)) with band B low = mid = 0.3 and high 0, masks off (z_snow = max h + 1000 m), the fake PNG empty px "
    "in the max |box dC| window box ((f), (h)) or box (0, 0) ((g)), and the (iv) seed order site > set > scene > "
    "replicate. G6(g) reading (build note 12): every scene of a set is both a G-shuf j and k (J = K, as the ruler's "
    "'(ii) mean exactly 0' needs); this reading was chosen after an S3b run in which J = the scenes with |S| >= 20 (K = all) gave "
    "seoul/skew (ii) mean -0.051; no criterion value was changed. To be put to the S4 short review.\n"
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
        if os.path.exists(fake_lock):         # test-tmp is inside the repo tree: no judge.lock may stay there (FX-3)
            os.remove(fake_lock)
    ck(no_lock == 'guard' and with_lock == 'notfound' and json_under_judge == 'guard', 'judgeLock')
    ck(not os.path.exists(fake_lock), 'fakeLockRemoved')
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


# ═══════════════════════ S3b JUDGE TESTS — BEGIN (S3-design §6.9 and units of every §6.1/§6.3–§6.6 function) ═══════════════════════
# oro.py is imported once per run and shares this process's oro_ref (one guard). Every truth here is fake and MODIS-free
# (clip(B + ΔC), synthetic noise), written under .harness/oro/test-tmp; the judge runs only on synthetic repos there.
# G8(f) audits that no real scene JSON / PNG / index / quartile / gate path is opened by G6 (f)(g)(h).
import ast
import itertools
import types
from datetime import date as _date
from PIL import Image

ORO_REL = 'tools/genus-ruler/oro'
T_G6 = os.path.join(TMP, 'g6')
G8D = os.path.join(TMP, 'g8d')
DEM_GRIDS_P = os.path.join(HERE, 'dem-grids.json')
REAL_APPLY = os.path.join(HERE, 'oro-apply.json')
G6_SITES = ('kanazawa', 'seoul')
G6_SETS = {'even': (tuple(range(0, 360, 45)), 0), 'skew': ((270, 285, 300, 315, 330, 345, 105, 150), 300)}
G6_BSEED = {('kanazawa', 'even'): SEED + 11, ('kanazawa', 'skew'): SEED + 12, ('seoul', 'even'): SEED + 13,
            ('seoul', 'skew'): SEED + 14}
G6_EMPTY_BOX = (0, 0)          # (g) scenes: the fake PNG's empty px sits in the same window box for every scene
_G6_OPENS = {}
G8F_COMMITTED_OK = tuple(os.path.abspath(p) for p in (REAL_APPLY, REAL_INPUTS, DEM_GRIDS_P))


def _R():
    if 'oro' not in _FIX:
        _FIX['oro'] = _load('oro_judge', os.path.join(HERE, 'oro.py'))
    return _FIX['oro']


def _run_oro(args, check=True):
    r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'oro.py')] + list(args), cwd=ROOT, capture_output=True,
                       text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f'oro.py {args[0]} exit {r.returncode}: {r.stderr.strip()[-300:]}')
    return r


@contextlib.contextmanager
def _record_opens(tag):
    lst = []
    prev = _REC['on']
    _REC['on'] = lst
    try:
        yield lst
    finally:
        _REC['on'] = prev
        _G6_OPENS[tag] = lst


# ── fake scene files ((f) form, L766-L770) ──
def _fake_tg(T128):
    """clip(T) → 2×2 replicate (no bilinear) → u8 → row 0 = north → base64 (fetch-sat form)."""
    u = np.round(np.kron(np.clip(T128, 0.0, 1.0), np.ones((2, 2))) * 255.0).astype(np.uint8)[::-1]
    return base64.b64encode(np.ascontiguousarray(u).tobytes()).decode('ascii')


def _fake_png(path, empty_box):
    """RGB (128, 128, 128) 256², one (0, 0, 0) 3 km px inside window box empty_box (row 0 = north)."""
    a = np.full((256, 256, 3), 128, dtype=np.uint8)
    if empty_box is not None:
        bi, bj = empty_box
        p, q = 98 + 4 * bi + 1, 98 + 4 * bj + 2
        a[255 - p, q] = 0
    Image.fromarray(a, 'RGB').save(path)


def _fake_files(d, name, site, lat, lon, date_s, T128, empty_box):
    """Fake scene JSON (allow-list fields + fake trueGrid only) and fake PNG in test-tmp."""
    pj, pp = os.path.join(d, name + '.json'), os.path.join(d, name + '.png')
    sc = {'site': site, 'lat': lat, 'lon': lon, 'date': date_s, 'grid': 256, 'cellKm': 3.0,
          'ring': [{'dist': a, 'az': b} for a, b in O.ring91()], 'trueGrid': _fake_tg(T128)}
    with open(pj, 'w') as f:
        json.dump(sc, f)
    _fake_png(pp, empty_box)
    return pj, pp


def _judge_one(p, pj, pp, primary='rho_res', lam=1.0):
    """The judge path of one scene: load_truth (flip, 2×2 mean) + empty_cells → judge_masks → scene_main."""
    R = _R()
    tr = R.load_truth(pj)
    tr['empty'], tr['dark'] = R.empty_cells(pp)
    mk = R.judge_masks(p['dem']['hmax6'], p['tm']['zSnow'], p['Bs']['high'], tr['empty'])
    return R.scene_main(p, tr, mk, primary, lam), tr, mk


# ── (g) synthetic soundings and B (L777-L780) ──
def _g6_site(site):
    key = ('g6site', site)
    if key not in _FIX:
        dg = _jload(DEM_GRIDS_P)
        dem = O.SiteCache(dg).get(site)
        _FIX[key] = {'dem': dem, 'lat': dg['sites'][site]['lat'], 'lon': dg['sites'][site]['lon'],
                     'zs': float(np.max(dem['hmax6'])) + 1000.0}       # z_snow > max h + 300 m: snow mask inactive
    return _FIX[key]


def _g6_snd(frm):
    """U 8 m/s from `frm`, N 0.01, H_w 2500 m, κ = γ_s(280 K)/0.15 (the G6(d) synthetic sounding with the (g) wind)."""
    U, V = O.wind_to_uv(8.0, float(frm))
    gs = O.gamma_s(280.0)
    return {'Vref': [U, V], 'speedRef': 8.0, 'N': 0.01, 'N2': 1e-4, 'Hw_m': 2500.0, 'kappa': gs / 0.15, 'gammaS': gs,
            'sRel': 0.15, 'complete': True, 'refEmpty': False}


def _g6_B(key):
    return 1.0 / (1.0 + np.exp(-1.2 * smooth_field(128, 100, G6_BSEED[key])))


def _g6_prep(site, frm, B, name):
    """prep_fields for a synthetic scene: B_tot = the set's B, bands low = mid = 0.3 (one field), high 0 (masks inactive,
    L777; the band form is that of the ρ^vis fallback scenes, L775); ring = the band value at every point."""
    s = _g6_site(site)
    one = np.ones((128, 128))
    Bs = {'total': B, 'low': 0.3 * one, 'mid': 0.3 * one, 'high': 0.0 * one}
    rings = {'total': np.full(91, 0.5), 'low': np.full(91, 0.3), 'mid': np.full(91, 0.3), 'high': np.zeros(91)}
    snd = _g6_snd(frm)
    tm = {'snd': snd, 'sndEcmwf': None, 'zSnow': s['zs'], 'zSnow7': s['zs'], 'zSnow42': None, 'z0': s['zs']}
    sc = {'site': site, 'lat': s['lat'], 'lon': s['lon'], 'times': {'closest': tm}}
    return _R().prep_fields(name, sc, s['dem'], snd, s['lat'], Bs, rings, [d for d, _ in O.ring91()], tm)


def _g6_date(i):
    return (_date(2026, 9, 1) + timedelta(days=i)).isoformat()


def _g6_names(site, sname):
    dirs = G6_SETS[sname][0]
    return [f'g6{site}-{sname}-{frm:03d}_{_g6_date(i)}' for i, frm in enumerate(dirs)]


def _a1to8(row):
    """The judge definition A1–A8 of one oro-apply row (L298, Q-44), read flag by flag (not through row['judge'])."""
    a6 = row['A6']['judge']
    return bool(all(row[f'A{i}']['ok'] for i in range(1, 6)) and a6 is not None and a6['ok'] and row['A7']['ok']
                and row['A8']['ok'])


def _dev_judge_names(app):
    """'dev 적용 장면' (L765, Q-44): dev rows of oro-apply with A1–A8 true, by date (then name). Must equal
    summary.devJudgeable and row['judge'] (checked by the caller)."""
    rows = app['scenes']
    return sorted((n for n, r in rows.items() if r['group'] == 'dev' and _a1to8(r)), key=lambda n: (rows[n]['date'], n))


def _g6f_fill(dev_entries, syn_entries):
    """L765: the first 3 dev scenes by date; fewer than 3 → filled from the (g) even-set synthetic scenes in the order
    0°, 90°, 180°. The dev scenes after the third are kept for the ρ^vis fallback (L775)."""
    out = list(dev_entries[:3])
    out += list(syn_entries[:3 - len(out)])
    return out, list(dev_entries[3:])


def _g6f_syn():
    """The (g) even-set synthetic scenes 0°, 90°, 180° (kanazawa, the dev site with A1 true, Q-44; build note 13)."""
    if 'g6fSyn' not in _FIX:
        syn = []
        B = _g6_B(('kanazawa', 'even'))
        names = _g6_names('kanazawa', 'even')
        s = _g6_site('kanazawa')
        for frm in (0, 90, 180):
            i = G6_SETS['even'][0].index(frm)
            syn.append(('syn', names[i], 'kanazawa', s['lat'], s['lon'], _g6_date(i), _g6_prep('kanazawa', frm, B, names[i])))
        _FIX['g6fSyn'] = syn
    return _FIX['g6fSyn']


def _g6f_select(apply_path, inputs_path, base_dir, key):
    """G6(f) scenes (L765) from one oro-apply / oro-inputs / B dir: dev judge scenes by date (≤ 3) through the judge's
    own prep_scene (it also checks the judge-path combiner against the row), filled per _g6f_fill. Cached by key."""
    if key in _FIX:
        return _FIX[key]
    R = _R()
    app = _jload(apply_path)
    dev = _dev_judge_names(app)
    consistent = (dev == sorted(app['summary']['devJudgeable'], key=lambda n: (app['scenes'][n]['date'], n))
                  and all(app['scenes'][n]['judge'] for n in dev)
                  and not any(r['judge'] for n, r in app['scenes'].items() if r['group'] == 'dev' and n not in dev))
    ent = []
    if dev:
        inp = _jload(inputs_path)
        cache = O.SiteCache(_jload(DEM_GRIDS_P))
        for n in dev:
            sc = inp['scenes'][n]
            p = R.prep_scene(n, sc, app['scenes'][n], cache.get(sc['site']), {'dir': base_dir, 'checkSha': True})
            ent.append(('dev', n, sc['site'], sc['lat'], sc['lon'], sc['date'], p))
    syn = _g6f_syn()
    out, more = _g6f_fill(ent, syn)
    _FIX[key] = {'scenes': out, 'moreDev': more, 'syn': syn, 'devNames': dev, 'devConsistent': consistent}
    return _FIX[key]


def _g6f_scenes():
    """The real G6(f)/(h) scenes: the committed oro-apply.json (provisional until the 10 soundings exist), oro-inputs.json
    and the sealed B in .harness/oro/base."""
    return _g6f_select(REAL_APPLY, REAL_INPUTS, REAL_BASE, 'g6f')


# ───────────────────────── §6.1 app path arm ─────────────────────────
@test('U-TAU')
def t_tau():
    """τ_band = macroTileCover (volumetricScene.ts:1028-1033) with the band's ring point 0 as first argument (Q-36)."""
    ck = Checks()
    R = _R()
    dist = [d for d, _ in O.ring91()]
    v = np.arange(91) / 100.0
    ck(sum(1 for x in dist if x <= 150) == 55, 'near55')
    ck(R.tau_band(v, dist, R.ring_first(v)) == 0.41, 'p75')            # near = 0.00..0.54, index floor(0.75·55) = 41
    ck(R.tau_band(v, dist, 0.6) == 0.6, 'firstWins')
    w = v.copy()
    w[41:55] = 1.5
    ck(R.tau_band(w, dist, 0.0) == 1.0, 'clamp01')
    few = np.full(91, np.nan)
    few[:11] = 0.5
    ck(R.tau_band(few, dist, 0.2) == 0.2, 'lt12Points')
    nn = v.copy()
    nn[5:55] = np.nan                                                   # 5 near points, 41 finite
    ck(R.tau_band(nn, dist, 0.33) == 0.33, 'lt6Near')
    z = v.copy()
    z[0] = np.nan
    ck(R.ring_first(z) == 0.0 and R.ring_first(v + 0.07) == 0.07, 'firstNullIs0')
    return ck.result()


@test('U-APP')
def t_app():
    """ΔC^app, C^vis, B^vis, ΔC^vis by hand (L545-L548); app_arm with F ≡ 0 is exactly 0; low-only arm uses C_mid = B_mid."""
    ck = Checks()
    R = _R()
    one = np.ones((128, 128))
    Bs = {'low': 0.2 * one, 'mid': 0.3 * one, 'high': 0.5 * one}
    out = R.app_fields(Bs, 0.25 * one, 0.35 * one, {'low': 0.22, 'mid': 1.0, 'high': 0.4})
    hand = {'dCapp': (1 - 0.75 * 0.65 * 0.5) - (1 - 0.8 * 0.7 * 0.5), 'Cvis': 1 - 0.78 * 0.65 * 0.6,
            'Bvis': 1 - 0.8 * 0.7 * 0.6}
    for k, h in hand.items():
        ck(float(np.max(np.abs(out[k] - h))) <= 1e-15, k)
    ck(abs(hand['dCapp'] - 0.03625) <= 1e-15 and abs(hand['Cvis'] - 0.6958) <= 1e-15 and abs(hand['Bvis'] - 0.664) <= 1e-15,
       'handLiterals')
    ck(float(np.max(np.abs(out['dCvis'] - 0.0318))) <= 1e-15, 'dCvis')
    B = _comb_B()
    Bs4 = {'total': B, 'low': 0.6 * B, 'mid': 0.4 * B, 'high': 0.2 * B}
    rings = {b: np.full(91, 0.3) for b in O.BANDS}
    dist = [d for d, _ in O.ring91()]
    z = R.app_arm(Bs4, np.zeros_like(B), rings, dist)
    ck(not np.any(z['dCapp']) and not np.any(z['dCvis']) and z['okLow'] and z['okMid'], 'F0isZero')
    F = 0.3 * smooth_field(128, 30, SEED + 2)
    full, lo = R.app_arm(Bs4, F, rings, dist), R.app_arm(Bs4, F, rings, dist, low_only=True)
    clo = O.combine(Bs4['low'], F)['C']
    ck(np.array_equal(lo['dCapp'], R.app_total(clo, Bs4['mid'], Bs4['high']) - R.app_total(Bs4['low'], Bs4['mid'], Bs4['high']))
       and lo['okMid'] is None and not np.array_equal(lo['dCapp'], full['dCapp']), 'lowOnly')
    ck(full['taus'] == {'low': 0.3, 'mid': 0.3, 'high': 0.3}, 'taus')
    return ck.result()


@test('U-LAMAPP')
def t_lamapp():
    """λ_app (L510), masked app share (L308), G7corr (L754), m8 app rms — box hand values."""
    ck = Checks()
    R = _R()
    d = np.zeros((15, 15))
    a = np.zeros((15, 15))
    W = np.ones((15, 15), dtype=bool)
    W[14, :] = False
    d[0, 0], d[0, 1], d[0, 2] = 0.1, -0.2, 0.05
    a[0, 0], a[0, 1], a[0, 2] = 0.12, -0.25, 0.04
    a[3, 3] = 0.3                     # ΔC = 0 there: no weight in λ_app
    d[14, 0], a[14, 0] = 5.0, 5.0     # outside W
    ck(_close(R.lambda_app(a, d, W), 0.064 / 0.0525, 1e-12), 'lambdaApp')
    ck(R.lambda_app(a, np.zeros((15, 15)), W) is None, 'lambdaNone')
    Min = np.zeros((15, 15), dtype=bool)
    Min[5, 5] = True
    b = np.zeros((15, 15))
    b[5, 5], b[0, 0], b[0, 1] = 0.1, 0.2, 0.2
    ck(_close(R.masked_app_share(b, Min), 0.01 / 0.09, 1e-12) and R.masked_app_share(np.zeros((15, 15)), Min) is None, 'share')
    ck(_close(O.pearson(d[W], a[W]), statistics.correlation(list(d[W]), list(a[W])), 1e-12), 'g7')
    return ck.result()


@test('B-FILL')
def t_bfill():
    """--fill-apply (§6.1): separate processes give identical bytes (idempotent), medians over counted, λ̃* = max(1, ·),
    rows without a combiner stay null, other fields untouched, foreign inputs refused, and the committed oro-apply.json
    is exactly this code's filled output."""
    ck = Checks()
    R = _R()
    fx = _fixture_syn()
    d = fresh_dir(os.path.join(TMP, 'fill'))
    ap = os.path.join(d, 'oro-apply.json')
    shutil.copyfile(fx['apply'], ap)
    args = ['--fill-apply', '--apply', ap, '--inputs', fx['inputs'], '--base', fx['base']]
    _run_oro(args)
    b1 = read_bytes(ap)
    _run_oro(args)
    ck(read_bytes(ap) == b1, 'idempotentTwoProcesses')
    doc = json.loads(b1)
    sm, rows = doc['summary'], doc['scenes']
    cnt = [r for _, r in sorted(rows.items()) if r['counted']]
    med = R.median([r['lambdaApp'] for r in cnt])
    ck(sm['lambdaAppMedian'] == med and sm['lambdaTilde'] == (None if med is None else max(1.0, med)), 'lambdaTilde')
    g7 = R.median([r['G7corr'] for r in cnt])
    ck(sm['G7median'] == g7 and sm['G7pass'] == (None if g7 is None else g7 >= 0.7), 'G7')
    ck(sm['maskedAppShareMedian'] == R.median([r['maskedAppShare'] for r in cnt]), 'shareMedian')
    ck(all(r['lambdaApp'] is None and r['G7corr'] is None and r['maskedAppShare'] is None and r['m8']['rmsDCapp'] is None
           for r in rows.values() if r['A6']['judge'] is None), 'nullWithoutCombiner')
    nf = sum(1 for r in rows.values() if r['m8']['rmsDCapp'] is not None)
    ck(nf > 0 and nf == sum(1 for r in rows.values() if r['A6']['judge'] is not None), 'filledWhereCombined')
    ck(doc['sources']['code'].get('oro.py') == O.sha256_file(os.path.join(HERE, 'oro.py')), 'codeSha')
    orig = _jload(fx['apply'])

    def strip(x):
        x = json.loads(json.dumps(x))
        for r in x['scenes'].values():
            for k in ('lambdaApp', 'G7corr', 'maskedAppShare'):
                r[k] = None
            r['m8']['rmsDCapp'] = None
        for k in ('lambdaAppMedian', 'lambdaTilde', 'G7median', 'maskedAppShareMedian', 'G7pass'):
            x['summary'].pop(k, None)
        x['sources']['code'].pop('oro.py', None)
        return x
    ck(strip(doc) == strip(orig), 'restUntouched')
    bad = json.loads(b1)
    bad['sources']['oroInputsSha256'] = '0' * 64
    bp = os.path.join(d, 'bad.json')
    O.dump_json(bad, bp)
    ck(_run_oro(['--fill-apply', '--apply', bp, '--inputs', fx['inputs'], '--base', fx['base']], check=False).returncode != 0,
       'refusesForeignInputs')
    if os.path.exists(REAL_APPLY):
        rp = os.path.join(d, 'real.json')
        shutil.copyfile(REAL_APPLY, rp)
        _run_oro(['--fill-apply', '--apply', rp])
        ck(read_bytes(rp) == read_bytes(REAL_APPLY), 'committedApplyIsFilled')
    ck.kv.update({'filled': nf, 'counted': len(cnt), 'synLambdaTilde': sm['lambdaTilde'], 'synG7median': sm['G7median']})
    return ck.result()


# ───────────────────────── §6.2 truth and judge masks ─────────────────────────
@test('U-TRUTH')
def t_truth():
    """load_truth: trueGrid → u8/255 → flip rows (row 0 north → south) → 2×2 mean (and 4×4 for the 64² arm); only
    `trueGrid`/`grid` read; no trueGrid or no file → None; a real bank path is refused without judge.lock (C2)."""
    ck = Checks()
    R = _R()
    d = fresh_dir(os.path.join(TMP, 'truth'))
    g = ((np.arange(256)[:, None] * 7 + np.arange(256)[None, :] * 3) % 256).astype(np.uint8)
    p = os.path.join(d, 'x_2026-09-01.json')
    with open(p, 'w') as f:
        json.dump({'site': 'x', 'grid': 256, 'cellKm': 3.0, 'cover': 0.5, 'empty': 0.1,
                   'trueGrid': base64.b64encode(g.tobytes()).decode('ascii')}, f)
    tr = R.load_truth(p)
    gf = g.astype(np.float64) / 255.0
    ck(np.array_equal(tr['T256'], gf[::-1]), 'flip')
    ck(abs(tr['T'][0, 0] - (gf[255, 0] + gf[255, 1] + gf[254, 0] + gf[254, 1]) / 4.0) <= 1e-15
       and abs(tr['T'][127, 127] - (gf[0, 254] + gf[0, 255] + gf[1, 254] + gf[1, 255]) / 4.0) <= 1e-15, 'mean2x2')
    ck(abs(tr['T64'][0, 0] - float(gf[252:256, 0:4].mean())) <= 1e-15 and tr['T64'].shape == (64, 64), 'mean4x4')
    with open(p, 'w') as f:
        json.dump({'site': 'x', 'grid': 256}, f)
    ck(R.load_truth(p) is None and R.load_truth(os.path.join(d, 'absent.json')) is None, 'noTrueGridNone')
    ck(not os.path.exists(O.JUDGE_LOCK), 'noRealLock')
    for probe in ('.harness/macro/sat/__oro_truth_probe__.json', '.harness/oro/sat-ext/__oro_truth_probe__.json'):
        try:
            R.load_truth(os.path.join(ROOT, *probe.split('/')))
            ck(False, f'refused:{probe}')
        except PermissionError:
            pass
    return ck.result()


@test('U-EMPTY')
def t_empty():
    """empty_cells: R = G = B = 0 px, rows flipped; dark px = max(RGB)/255 < 0.02 and not empty (report); extended boxes."""
    ck = Checks()
    R = _R()
    d = fresh_dir(os.path.join(TMP, 'empty'))
    a = np.full((256, 256, 3), 128, dtype=np.uint8)
    a[10, 20] = 0
    a[30, 40] = 3
    a[40, 50] = 6
    a[255 - 98, 98] = (0, 0, 1)
    p = os.path.join(d, 'x.png')
    Image.fromarray(a, 'RGB').save(p)
    e, k = R.empty_cells(p)
    ck(np.argwhere(e).tolist() == [[245, 20]], 'emptyFlipped')
    ck(sorted(map(tuple, np.argwhere(k).tolist())) == [(98, 98), (225, 40)], 'darkReport')
    ck(np.argwhere(R.ext_empty(e)).tolist() == [[61, 5]], 'extBox')
    e2 = np.zeros((256, 256), dtype=bool)
    e2[98 + 13, 98 + 18] = True                       # window box (3, 4)
    mk = R.judge_masks(np.zeros((128, 128)), 1e9, np.zeros((128, 128)), e2)
    ck(np.argwhere(mk['empty']).tolist() == [[3, 4]] and not mk['W'][3, 4] and int(mk['W'].sum()) == 224, 'windowBox')
    ck(bool(R.empty_from_rgb(np.zeros((256, 256, 3), dtype=np.uint8))[0].all()), 'allZeroEmpty')
    try:
        R.empty_cells(os.path.join(ROOT, '.harness', 'macro', 'sat', '__oro_png_probe__.png'))
        ck(False, 'realPngRefused')
    except PermissionError:
        pass
    return ck.result()


@test('U-MASKJ')
def t_maskj():
    """M_judge on the extended tiling (R4): window part = masks_input; edge half boxes (box mean over present cells);
    6 km weight m and 3 km mask from the extended boxes."""
    ck = Checks()
    R = _R()
    rng = np.random.default_rng(SEED)
    hmax6, Bhi = rng.uniform(0, 2000, (128, 128)), rng.uniform(0, 0.6, (128, 128))
    mk, mi = R.judge_masks(hmax6, 1500.0, Bhi), O.masks_input(hmax6, 1500.0, Bhi)
    ck(np.array_equal(mk['snow'], mi['snow']) and np.array_equal(mk['high'], mi['high'])
       and np.array_equal(mk['W'], mi['W_in']), 'windowEqualsMasksInput')
    h = np.zeros((128, 128))
    h[0, 0] = h[127, 127] = h[1, 2] = 1000.0
    ext = R.judge_masks(h, 1200.0, np.zeros((128, 128)))['ext']
    ck(bool(ext[0, 0] and ext[64, 64] and ext[1, 1]) and int(ext.sum()) == 3, 'snowExtBoxes')
    b = np.zeros((128, 128))
    b[0, 0], b[0, 1], b[2, 1], b[2, 2] = 0.31, 0.7, 0.62, 0.62
    ext = R.judge_masks(np.zeros((128, 128)), 1e9, b)['ext']
    ck(sorted(map(tuple, np.argwhere(ext).tolist())) == [(0, 0), (0, 1), (1, 1)], 'highHalfBoxes')
    ck(R.judge_masks(h, 1200.0, b, snow_on=False, high_on=False)['ext'].sum() == 0, 'armsOff')
    Mx = np.zeros((65, 65), dtype=bool)
    Mx[25, 25] = Mx[0, 0] = Mx[64, 64] = True
    m6, m3 = R.mask6(Mx), R.mask3(Mx)
    ck(np.argwhere(m6 == 0).tolist() == [[0, 0], [49, 49], [49, 50], [50, 49], [50, 50], [127, 127]], 'mask6')
    ck(int(m3.sum()) == 4 + 16 + 4 and bool(m3[98:102, 98:102].all() and m3[0:2, 0:2].all() and m3[254:, 254:].all()), 'mask3')
    ck(R.ext_idx3()[[0, 1, 2, 3, 4, 5, 6, 253, 254, 255]].tolist() == [0, 0, 1, 1, 1, 1, 2, 63, 64, 64]
       and R.ext_idx6()[[0, 1, 2, 49, 50, 51, 126, 127]].tolist() == [0, 1, 1, 25, 25, 26, 63, 64], 'tilingIndex')
    m64 = R.judge_masks64(np.zeros((64, 64)), 1e9, np.zeros((64, 64)), None)
    ck(int(m64['W'].sum()) == 64 and m64['m12'].shape == (64, 64), 'grid64')
    e3 = np.zeros((256, 256), dtype=bool)
    e3[96 + 8 * 2 + 3, 96 + 8 * 5 + 1] = True         # 24 km box (2, 5) of the 12 km window
    m64 = R.judge_masks64(np.zeros((64, 64)), 1e9, np.zeros((64, 64)), e3)
    ck(np.argwhere(m64['M']).tolist() == [[2, 5]], 'grid64Empty')
    return ck.result()


# ───────────────────────── §6.3 per-scene metrics ─────────────────────────
def _hand_boxes():
    """15×15 hand case: S = 3 boxes, S∪ = 4, |W| = 150 (rows 0..9), one masked box with large values."""
    d, dr, r = np.zeros((15, 15)), np.zeros((15, 15)), np.zeros((15, 15))
    W = np.ones((15, 15), dtype=bool)
    W[10:, :] = False
    d[0, 0], d[0, 1], d[0, 2] = 0.02, 0.04, 0.06
    r[0, 0], r[0, 1], r[0, 2] = 0.01, 0.03, 0.02
    dr[0, 0], dr[0, 1], dr[0, 2] = -0.03, 0.01, -0.05
    d[1, 0], r[1, 0] = 0.01, 0.05
    dr[2, 0] = 0.03
    d[12, 0] = r[12, 0] = 0.5
    return d, dr, r, W


@test('U-METRIC')
def t_metric():
    """ρ_res (L503), β_res, ΔMSE_W, ΔMSE_W(λ) (L505-L513), d with the 0 rules (L519, L354), d on S (§6 arm), ρ′ for
    ρ_even/ρ_odd (L525), fine versions on the total-ΔC sets (L576), box-level drops (splits) — hand values."""
    ck = Checks()
    R = _R()
    d, dr, r, W = _hand_boxes()
    S, Su = R.sets(d, dr, W)
    ck(int(S.sum()) == 3 and int(Su.sum()) == 4 and not S[12, 0], 'sets')
    core = R.rho_d(d, dr, r, W, True)
    ck(_close(core['rho_res'], 0.5, 1e-12), 'rhoRes')
    ck(_close(R.beta_res(d, r, W), 0.0031 / 0.0057, 1e-12), 'betaRes')
    ck(_close(R.dmse(d, r, W), -0.0005 / 150, 1e-16) and _close(R.dmse(d, r, W, 1.2), 0.000768 / 150, 1e-16), 'dMSE')
    ck(_close(core['d'], 0.8 + 0.2 * math.sqrt(2.0), 1e-12), 'dGrev')
    ck(_close(O.pearson(d[Su], r[Su]), 0.8, 1e-12) and _close(O.pearson(dr[Su], r[Su]), -0.2 * math.sqrt(2.0), 1e-12), 'rhoPrime')
    ck(R.rho_d(d, dr, r, W, False)['d'] == 0.0, 'dRevFailIs0')
    dr2 = dr.copy()
    dr2[Su] = 0.03
    ck(R.rho_d(d, dr2, r, W, True)['d'] == 0.0, 'dZeroVarIs0')
    ck(_close(R.rho_d(d, dr, r, W, True, use_S_for_d=True)['d'], 0.5 - math.sqrt(3.0 / 7.0), 1e-12), 'dOnS')
    cf = R.rho_d(d, dr, r, W, True, fine=(2 * d, 2 * dr, 3 * r))
    ck(_close(cf['rho_fine'], 0.5, 1e-12) and _close(cf['d_fine'], core['d'], 1e-12)
       and R.star(cf, 'rho_fine') == (cf['rho_fine'], cf['d_fine']) and R.star(core, 'rho_res') == (core['rho_res'], core['d']),
       'fineSameSets')
    ck(R.pearson_def([1.0], [2.0]) == (0.0, False) and R.pearson_def([1, 1, 1], [1, 2, 3]) == (0.0, False)
       and R.pearson_def([1, 2], [2, 4]) == (1.0, True), 'pearsonDef')
    drop = np.zeros((15, 15), dtype=bool)
    drop[0, 2] = True
    cd = R.rho_d(d, dr, r, W, True, drop=drop)
    ck(cd['nS'] == 2 and cd['nW'] == 149 and _close(cd['rho_res'], 1.0, 1e-12), 'dropBoxes')
    return ck.result()


@test('U-LMINUS')
def t_lminus():
    """L⁻ (L551-L562): sea stratum + land h tertiles (linear quantiles, h ≤ q₁ / q₁ < h ≤ q₂ / else — L5 sits on q₂ and
    belongs to stratum 2), strata without neutral boxes dropped, weights ∝ |Lee_t|; report forms by hand."""
    ck = Checks()
    R = _R()
    W, sea = np.zeros((15, 15), dtype=bool), np.zeros((15, 15), dtype=bool)
    h, d, dr, r = (np.zeros((15, 15)) for _ in range(4))
    boxes = {'A': ((0, 0), True, 0.0, -0.05, 0.0, -0.04), 'B': ((0, 1), True, 0.0, 0.0, 0.0, 0.01),
             'L1': ((1, 0), False, 100.0, -0.03, 0.0, -0.02), 'L2': ((1, 1), False, 100.0, 0.01, 0.01, 0.0),
             'L3': ((1, 2), False, 200.0, -0.04, 0.0, -0.05), 'L4': ((1, 3), False, 300.0, 0.0, 0.0, 0.02),
             'L5': ((1, 4), False, 300.0, -0.02, 0.0, 0.01), 'L6': ((1, 5), False, 400.0, -0.06, 0.0, -0.03)}
    for pos, s_, hh, a, b, rr in boxes.values():
        W[pos], sea[pos], h[pos], d[pos], dr[pos], r[pos] = True, s_, hh, a, b, rr
    d[5, 5], r[5, 5] = -0.5, 0.9                      # masked box: no effect
    S, _ = R.sets(d, dr, W)
    ck(_close(R.lminus(d, dr, r, W, S, sea, h, 'strata'), -0.0375, 1e-15), 'strata')
    ck(_close(R.lminus(d, dr, r, W, S, sea, h, 'tertile'), -0.0325, 1e-15), 'seaAgnosticTertile')
    ck(_close(R.lminus(d, dr, r, W, S, sea, h, 'window'), -0.0135, 1e-15), 'windowMean2draft')
    d0 = np.where(d < 0, 0.0, d)
    ck(R.lminus(d0, dr, r, W, R.sets(d0, dr, W)[0], sea, h, 'strata') == 0.0
       and R.lminus(d0, dr, r, W, R.sets(d0, dr, W)[0], sea, h, 'window') == 0.0, 'noLeeIs0')
    dr3 = np.where(W, 0.05, 0.0)                     # no neutral box anywhere
    ck(R.lminus(d, dr3, r, W, S, sea, h, 'strata') == 0.0, 'noNeutralIs0')
    # second hand case: the sea is its own stratum (L553 "바다 층"), not merged into land stratum 1 — the case above gives
    # the same −0.0375 under that merge, and G6(h)'s synthetic fill has no sea lee box (build note 30). 3 sea W boxes
    # (one lee, two neutral; r = +0.05 each) and 6 land boxes h 100, 100, 200, 200, 300, 300, lee / neutral alternating,
    # r = 0: every stratum has lee r = neutral r, so L⁻ = 0 exactly; with the sea merged into stratum 1 it is −1/240.
    W2, sea2 = np.zeros((15, 15), dtype=bool), np.zeros((15, 15), dtype=bool)
    h2, d2, dr2, r2 = (np.zeros((15, 15)) for _ in range(4))
    for pos, s_, hh, a, rr in (((0, 0), True, 0.0, -0.05, 0.05), ((0, 1), True, 0.0, 0.0, 0.05),
                               ((0, 2), True, 0.0, 0.0, 0.05), ((1, 0), False, 100.0, -0.05, 0.0),
                               ((1, 1), False, 100.0, 0.0, 0.0), ((1, 2), False, 200.0, -0.05, 0.0),
                               ((1, 3), False, 200.0, 0.0, 0.0), ((1, 4), False, 300.0, -0.05, 0.0),
                               ((1, 5), False, 300.0, 0.0, 0.0)):
        W2[pos], sea2[pos], h2[pos], d2[pos], r2[pos] = True, s_, hh, a, rr
    S2, _ = R.sets(d2, dr2, W2)
    ck(R.lminus(d2, dr2, r2, W2, S2, sea2, h2, 'strata') == 0.0, 'coastStratumSeparate')
    lee2, neu2 = S2 & (d2 <= -0.02), W2 & (np.abs(d2) < 0.02) & (np.abs(dr2) < 0.02)       # control: the merged reading
    land2 = W2 & ~sea2
    q1, q2 = np.quantile(h2[land2], [1.0 / 3.0, 2.0 / 3.0])
    num = den = 0.0
    for t in ((W2 & sea2) | (land2 & (h2 <= q1)), land2 & (h2 > q1) & (h2 <= q2), land2 & (h2 > q2)):
        if (lee2 & t).any() and (neu2 & t).any():
            num += (lee2 & t).sum() * (r2[lee2 & t].mean() - r2[neu2 & t].mean())
            den += (lee2 & t).sum()
    ck(_close(num / den, -1.0 / 240.0, 1e-15), 'coastCaseDiscriminates')
    return ck.result()


@test('U-FINE')
def t_fine():
    """G₁₀ ⊛_M (L567-L570): masked values do not leak, normalised masked convolution equals a brute-force sum, NaN only
    where the whole 3σ neighbourhood is masked."""
    ck = Checks()
    R = _R()
    m = np.ones((128, 128))
    m[40:60, 30:90] = 0.0
    X = np.where(m > 0, 1.0, 100.0)
    fine, coarse = R.fine_coarse(X, m)
    ck(float(np.max(np.abs(coarse[m > 0] - 1.0))) <= 1e-12 and float(np.max(np.abs(fine[m > 0]))) <= 1e-12, 'noLeak')
    Y = np.random.default_rng(SEED).standard_normal((128, 128))
    _, cy = R.fine_coarse(Y, m)
    w = np.exp(-((np.arange(-5, 6) * 6000.0) ** 2) / (2.0 * 1e8))
    for (i, j) in ((0, 0), (64, 64), (45, 25), (100, 127), (39, 31)):
        num = den = 0.0
        for a in range(-5, 6):
            for b in range(-5, 6):
                ii, jj = i + a, j + b
                if 0 <= ii < 128 and 0 <= jj < 128:
                    num += w[a + 5] * w[b + 5] * Y[ii, jj] * m[ii, jj]
                    den += w[a + 5] * w[b + 5] * m[ii, jj]
        ck(abs(cy[i, j] - num / den) <= 1e-12, f'brute{i}_{j}')
    m2 = np.ones((128, 128))
    m2[20:50, 20:50] = 0
    _, c2 = R.fine_coarse(Y, m2)
    ck(bool(np.isnan(c2[35, 35])) and bool(np.all(np.isfinite(c2[m2 > 0]))), 'nanOnlyFullyMasked')
    return ck.result()


@test('U-C45')
def t_c45():
    """Δcorr12, Δcorr50, ΔmeanErr (L583-L585): bilinear 128² → 256² (c/2 − 0.25, clamp, sampleGrid formula); unmasked =
    macro.py formulas; masked corr12 drops windows touching a masked cell, corr50 masked mean with the half rule, meanErr on
    disc ∩ unmasked (brute force)."""
    ck = Checks()
    R = _R()
    cols = np.tile(np.arange(128.0)[None, :], (128, 1))
    u = R.up256(cols)
    ck([u[0, q] for q in (0, 1, 2, 3, 254, 255)] == [0.0, 0.25, 0.75, 1.25, 126.75, 127.0], 'bilinearHand')
    ck(np.array_equal(R.up256(cols.T), u.T), 'bilinearRows')
    f = np.clip(np.arange(256) / 2.0 - 0.25, 0, 127)
    ck(float(np.max(np.abs(R.up256(cols.T * 1000.0 + cols) - (f[:, None] * 1000.0 + f[None, :])))) <= 1e-9, 'bilinearPlane')
    rng = np.random.default_rng(SEED)
    B = 1 / (1 + np.exp(-1.2 * smooth_field(128, 100, SEED + 3)))
    C = np.clip(B + 0.05 * smooth_field(128, 30, SEED + 4), 0, 1)
    T = np.clip(R.up256(C) + 0.1 * rng.standard_normal((256, 256)), 0, 1)
    Cu, Bu = R.up256(C), R.up256(B)
    sl = slice(98, 158)
    bm = R.box_mean
    yy, xx = np.mgrid[0:256, 0:256]
    disc = ((xx + .5) * 3 - 384) ** 2 + ((yy + .5) * 3 - 384) ** 2 <= 380 ** 2
    un = R.c45(C, B, T, None)
    e12 = R.corr(bm(Cu, 4)[sl, sl], bm(T, 4)[sl, sl]) - R.corr(bm(Bu, 4)[sl, sl], bm(T, 4)[sl, sl])
    e50 = R.corr(bm(Cu, 17), bm(T, 17)) - R.corr(bm(Bu, 17), bm(T, 17))
    eme = (Cu[disc].mean() - T[disc].mean()) - (Bu[disc].mean() - T[disc].mean())
    ck(un['dcorr12'] == e12 and un['dcorr50'] == e50 and un['dmeanErr'] == eme, 'unmaskedEqualsMacro')
    z = R.c45(C, B, T, np.zeros((256, 256), dtype=bool))
    ck(all(abs(z[k] - un[k]) <= 1e-12 for k in un), 'emptyMaskEqualsUnmasked')
    m3 = np.zeros((256, 256), dtype=bool)
    m3[120, 120] = True
    ok = np.ones((60, 60), dtype=bool)
    ok[119 - 98:123 - 98, 119 - 98:123 - 98] = False
    a12 = [R.corr(bm(X, 4)[sl, sl][ok], bm(T, 4)[sl, sl][ok]) for X in (Cu, Bu)]
    ck(_close(R.c45(C, B, T, m3)['dcorr12'], a12[0] - a12[1], 1e-12) and int((~ok).sum()) == 16, 'corr12Exclusion')
    m3b = np.zeros((256, 256), dtype=bool)
    m3b[:100, :] = True
    m3b[150:160, 30:200] = True
    um = (~m3b).astype(np.float64)

    def wsum(X):                                       # brute-force 17×17 window sums (rows y−8..y+8, clipped)
        P = np.zeros((272, 272))
        P[8:264, 8:264] = X
        out = np.zeros((256, 256))
        for a in range(17):
            for b in range(17):
                out += P[a:a + 256, b:b + 256]
        return out
    cnt, su = wsum(np.ones((256, 256))), wsum(um)
    keep = su >= 0.5 * cnt
    mt = wsum(T * um)[keep] / su[keep]
    e50m = R.corr(wsum(Cu * um)[keep] / su[keep], mt) - R.corr(wsum(Bu * um)[keep] / su[keep], mt)
    mb = R.c45(C, B, T, m3b)
    ck(_close(mb['dcorr50'], e50m, 1e-9) and 0 < int(keep.sum()) < 65536, 'corr50HalfRule')
    sel = disc & ~m3b
    ck(_close(mb['dmeanErr'], (Cu[sel].mean() - T[sel].mean()) - (Bu[sel].mean() - T[sel].mean()), 1e-12)
       and _close(mb['dmeanErr'], float((Cu - Bu)[sel].mean()), 1e-12), 'meanErrDiscUnmasked')
    return ck.result()


@test('U-AUX')
def t_aux():
    """Screen weight (L563, Q-2: 5 near boxes), windward/lee contrast (L587), rotation about the observer corner (Q-39)."""
    ck = Checks()
    R = _R()
    ck(int(R.NEAR15.sum()) == 5 and bool(R.NEAR15[7, 7] and R.NEAR15[6, 7] and R.NEAR15[8, 7] and R.NEAR15[7, 6]
                                         and R.NEAR15[7, 8]) and not R.NEAR15[6, 6], 'nearFive')
    d, dr, r, W = _hand_boxes()
    d[7, 7], r[7, 7] = 0.03, 0.01
    sw = R.screen_weight(d, r, W)
    tot = R.dmse(d, r, W)
    ck(sw['nNear'] == 5 and sw['nNear'] + sw['nFar'] == int(W.sum()) and sw['nNearTiling'] == 5
       and _close((5 * sw['dMSEnear'] + sw['nFar'] * sw['dMSEfar']) / W.sum(), tot, 1e-16)
       and _close(sw['dMSEnear'], (0.03 ** 2 - 2 * 0.03 * 0.01) / 5, 1e-16), 'screenSplit')
    F, rr, Wk = np.zeros((15, 15)), np.zeros((15, 15)), np.zeros((15, 15), dtype=bool)
    for i, (fv, x) in enumerate(zip([1, 2, 3, 4, 5, 6], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6])):
        F[0, i], rr[0, i], Wk[0, i] = fv, x, True
    ck(_close(R.wl_contrast(F, rr, Wk), 0.4, 1e-12) and R.wl_contrast(F, rr, np.zeros((15, 15), dtype=bool)) is None,
       'wlContrast')
    h = np.zeros((128, 128))
    h[10, 20] = 500.0
    x, y = O.cell_xy_km()
    ck(np.rot90(h, 2)[117, 107] == 500.0 and x[10, 20] == -x[117, 107] and y[10, 20] == -y[117, 107], 'rot180Corner')
    hm = O.dec_f32(_jload(DEM_GRIDS_P)['sites']['kanazawa']['hmean6'], 128)
    a_, _ = O.h_sub_field(np.rot90(hm, 2))
    ck(float(np.max(np.abs(a_ - np.rot90(O.h_sub_field(hm)[0], 2)))) <= 1e-9, 'hsubRotationEquivariant')
    return ck.result()


@test('U-SCENE')
def t_scene():
    """scene_main wiring on a synthetic scene (kanazawa, 270°, fake truth = B + ΔC + noise): every value equals an
    independent recomputation from the boxes, the masks and the cell fields."""
    ck = Checks()
    R = _R()
    d = fresh_dir(os.path.join(TMP, 'scene'))
    B = _g6_B(('kanazawa', 'even'))
    p = _g6_prep('kanazawa', 270, B, 'g6scene_2026-09-01')
    s = _g6_site('kanazawa')
    Tf = B + p['cj']['dC'] + 0.05 * smooth_field(128, 20, SEED + 9)
    pj, pp = _fake_files(d, 'g6scene_2026-09-01', 'kanazawa', s['lat'], s['lon'], '2026-09-01', Tf, (7, 7))
    v, tr, mk = _judge_one(p, pj, pp, lam=1.3)
    T, Bt, dC, dCr = tr['T'], p['Bs']['total'], p['cj']['dC'], p['cr']['dC']
    r = T - Bt
    d15, dr15, r15 = O.box15(dC), O.box15(dCr), O.box15(r)
    W = mk['W']
    S, Su = R.sets(d15, dr15, W)
    ck(v['nW'] == int(W.sum()) == 224 and v['nS'] == int(S.sum()) and v['nEmptyBoxes'] == 1 and not W[7, 7], 'sets')
    ck(v['rho_res'] == O.pearson(d15[S], r15[S]) and v['rho_star'] == v['rho_res'] and v['d_star'] == v['d'], 'rhoRes')
    ck(v['beta_res'] == R.beta_res(d15, r15, W) and v['dMSE'] == R.dmse(d15, r15, W)
       and v['dMSElam'] == R.dmse(d15, r15, W, 1.3), 'amplitude')
    rs, rr = O.pearson(d15[Su], r15[Su]), O.pearson(dr15[Su], r15[Su])
    ck(v['d'] == R.d_pair(d15, dr15, r15, Su) and v['rho_even'] == 0.5 * (rs + rr) and v['rho_odd'] == 0.5 * (rs - rr), 'grev')
    ck(v['rho_rot'] == O.pearson(O.box15(p['co']['dC'])[Su], r15[Su]) and v['rotOk'], 'rhoRot')
    # ΔC_rot is the 180° rotation about the observer (L539, Q-39), recomputed here outside prep_fields: a transpose, a 90°
    # turn or an N–S mirror passes rhoRot (wiring only), G6g (self-consistent) and U-AUX (np.rot90 itself)
    hrot, _ = O.h_sub_field(np.rot90(s['dem']['hmean6'], 2))
    ck(np.array_equal(p['co']['dC'], O.combine(B, O.forcing(hrot, p['snd'], s['lat']))['dC']), 'rot180Independent')
    m6 = R.mask6(mk['ext'])
    ck(int((m6 == 0).sum()) == 4 and m6[49 + 14, 49 + 14] == 0, 'mask6EmptyBox')
    fd = O.box15(dC - O.gauss_smooth(dC, 10000.0, mask=m6))
    fr = O.box15(r - O.gauss_smooth(r, 10000.0, mask=m6))
    ck(v['rho_fine'] == O.pearson(fd[S], fr[S]), 'rhoFine')
    ck(v['rho_coarse'] == O.pearson(O.box15(O.gauss_smooth(dC, 10000.0, mask=m6))[S],
                                    O.box15(O.gauss_smooth(r, 10000.0, mask=m6))[S]), 'rhoCoarse')
    ck(v['rho_hp'] == O.pearson(d15[S], O.box15(r - O.gauss_smooth(r, 20000.0))[S]), 'rhoHp')
    a = p['app']
    ck(v['rho_vis'] == O.pearson(O.box15(a['dCvis'])[S], O.box15(T - a['Bvis'])[S]), 'rhoVis')
    T15 = O.box15(T)
    ck(_close(v['dMSEvis'], float(np.mean((O.box15(a['Cvis'])[W] - T15[W]) ** 2 - (O.box15(a['Bvis'])[W] - T15[W]) ** 2)),
              1e-16), 'dMSEvis')
    ck(v['Lminus'] == R.lminus(d15, dr15, r15, W, S, p['dem']['sea'], O.box15(p['dem']['hmean6']), 'strata'), 'Lminus')
    m3 = R.mask3(mk['ext'])
    ck(int(m3.sum()) == 16 and v['dcorr12'] == R.c45(p['cj']['C'], Bt, tr['T256'], m3)['dcorr12'], 'c45')
    ck(v['wlContrast'] == R.wl_contrast(O.box15(p['F']), r15, W) and v['nNear'] == 4, 'aux')
    ck.kv.update({'rhoRes': v['rho_res'], 'beta': v['beta_res'], 'nS': v['nS']})
    return ck.result()


@test('U-ARMS0')
def t_arms0():
    """Sensitivity machinery (§6.5): an arm set to the main model's values reproduces the main ρ*, d exactly; a missing
    arm input drops the scene from that arm only."""
    ck = Checks()
    R = _R()
    d = fresh_dir(os.path.join(TMP, 'arms0'))
    B = _g6_B(('kanazawa', 'even'))
    p = _g6_prep('kanazawa', 270, B, 'g6arms_2026-09-01')
    s = _g6_site('kanazawa')
    pj, pp = _fake_files(d, 'g6arms_2026-09-01', 'kanazawa', s['lat'], s['lon'], '2026-09-01', B + p['cj']['dC'], (0, 0))
    v, tr, mk = _judge_one(p, pj, pp)
    for cfg in ({}, {'s_m': 10000.0}, {'sigma_G_m': 20000.0}, {'hi': 0.3}, {'time': 'closest'}, {'zSnowKey': 'zSnow'},
                {'block': 'clip', 'vertical': 'col', 'N_scale': 1.0, 'lambda_smin': 200000.0}):
        a = R.arm_core(p, tr, mk, 'rho_res', cfg, None, {})
        ck(a.get('rho_star') == v['rho_res'] and a.get('d_star') == v['d'], 'identity:' + (','.join(sorted(cfg)) or 'none'))
    ck(R.arm_core(p, tr, mk, 'rho_res', {'sndKey': 'sndEcmwf'}, None, {}) == {'drop': 'input'}
       and R.arm_core(p, tr, mk, 'rho_res', {'zSnowKey': 'zSnow42'}, None, {}) == {'drop': 'input'}, 'missingInputDrops')
    a = R.arm_core(p, tr, mk, 'rho_res', {'N_scale': 0.6}, None, {})
    ck('rho_star' in a and a['rho_star'] != v['rho_res'], 'armChanges')
    names = [n for n, _ in R.MODEL_ARMS + R.MASK_ARMS]
    ck(len(names) == len(set(names)) == 29, 'armTable')
    return ck.result()


@test('U-GSHUF')
def t_gshuf():
    """d_shuf,j = Pearson_W(ΔC_j, r_j) − mean_k Pearson_W(ΔC_{j|k}, r_j) (L526-L535): hand values; failed (j|k) combiner →
    k skipped; all skipped → j excluded; ρ_odd,swap (M5); gshuf_all: j and k = the site's finally judged scenes (L526,
    build note FX-2), so a scene dropped after T is neither j nor k, F_{j|k} = F_k with the combiner on B_j — against a
    direct recomputation; a site left with < 3 judged scenes leaves G-shuf (L354 ⑨)."""
    ck = Checks()
    R = _R()
    W = np.zeros((15, 15), dtype=bool)
    W[0, :4] = True

    def row(v):
        a = np.zeros((15, 15))
        a[0, :4] = v
        return a
    d, r, dr = row([1, 2, 3, 4]), row([1, 3, 2, 4]), row([4, 3, 2, 1])
    jb = {'d15': d, 'dr15': dr, 'r15': r, 'W': W, 'Su': W.copy(), 'fine': (d, dr, r)}
    k1, k2, kr1, kr2 = row([4, 3, 2, 1]), row([1, 3, 2, 4]), row([1, 2, 3, 4]), row([4, 3, 2, 1])
    k3 = row([5, -1, 7, 2])
    a, sw = R.dshuf_scene(jb, [(True, k1, kr1, True), (True, k2, kr2, True), (False, k3, k3, True)], False, 'W')
    ck(_close(a, 0.8 - 0.5 * (-0.8 + 1.0), 1e-12) and _close(sw, 0.8 - 0.5 * (-0.8 + 0.9), 1e-12), 'hand')
    a2, sw2 = R.dshuf_scene(jb, [(True, k1, kr1, True), (True, k2, kr2, False)], False, 'W')
    ck(_close(a2, a, 1e-15) and _close(sw2, 0.8 - (-0.8), 1e-12), 'revFailSkipsSwapOnly')
    ck(R.dshuf_scene(jb, [(False, k1, kr1, True)], False, 'W') == (None, None), 'allSkippedExcluded')
    fb = {'d15': 0 * d, 'dr15': 0 * dr, 'r15': 0 * r, 'W': W, 'Su': W, 'fine': (d, dr, r)}
    ck(_close(R.dshuf_scene(fb, [(True, k1, kr1, True), (True, k2, kr2, True)], True, 'W')[0], a, 1e-15), 'fineMode')
    B = _g6_B(('kanazawa', 'even'))
    dirs = (270, 0, 90, 180)
    names = [f'gsh{f:03d}_{_g6_date(i)}' for i, f in enumerate(dirs)]
    preps = {n: _g6_prep('kanazawa', f, B, n) for n, f in zip(names, dirs)}
    rows = {n: {'site': 'kanazawa', 'date': n.rsplit('_', 1)[1], 'counted': True} for n in names}
    rows['other_2026-09-30'] = {'site': 'seoul', 'date': '2026-09-30', 'counted': True}
    td = fresh_dir(os.path.join(TMP, 'gshuf'))
    s = _g6_site('kanazawa')
    vals = {}
    for i, n in enumerate(names):
        T = B + preps[n]['cj']['dC'] + 0.03 * smooth_field(128, 30, SEED + 40 + i)
        pj, pp = _fake_files(td, n, 'kanazawa', s['lat'], s['lon'], rows[n]['date'], T, (0, 0))
        vals[n] = _judge_one(preps[n], pj, pp)[0]
    judged = names[:3] + ['other_2026-09-30']         # names[3] dropped after T: neither a j nor a k (J = K)
    ds, dsw, ds2, excl = R.gshuf_all(judged, rows, preps, vals, ['kanazawa'], 'rho_res')
    ck(sorted(ds) == sorted(names[:3]) and not excl, 'jSet')
    for j in names[:3]:
        bx = vals[j]['_box']
        Wj, r15 = bx['W'], bx['r15']
        ks = [O.pearson(O.box15(O.combine(preps[j]['Bs']['total'], preps[k]['F'])['dC'])[Wj], r15[Wj])
              for k in names[:3] if k != j]
        ck(len(ks) == 2 and _close(ds[j], O.pearson(bx['d15'][Wj], r15[Wj]) - float(np.mean(ks)), 1e-12), f'direct:{j}')
    ds2s = R.gshuf_all(names[:2], rows, preps, vals, ['kanazawa'], 'rho_res')[0]
    ck(ds2s == {} and R.gshuf_sites_post(names[:2], rows, ['kanazawa']) == []
       and R.gshuf_sites_post(names[:3], rows, ['kanazawa']) == ['kanazawa'] and R.GSHUF_MIN_SITE == 3, 'siteBelow3Leaves')
    ck.kv.update({'dshufMean': R.mean(list(ds.values()))})
    return ck.result()


@test('U-GSHUFJK')
def t_gshufjk():
    """J = K under a judge-time drop (L526 "같은 사이트의 다른 판정 장면 k", L532 Σ_j(a_j − ā_−j) = 0; build note FX-2): per
    G6 site one synthetic B and one site-fixed truth T = B + ΔC_{k*} for every scene (the (g)(ii) form, no day effect),
    five winds of the skew set, one scene dropped from the judged set after T. The judge's gshuf_all must give
    mean d_shuf = 0 (|·| ≤ 1e-12) for ρ_res and ρ_fine; control: the same drop with k still ranging over all five scenes
    (J ⊊ K, the replaced Q-55 reading), recomputed here directly, is not 0 (|·| > 1e-3)."""
    ck = Checks()
    R = _R()
    dirs, kstar, dropped = (270, 300, 330, 105, 150), 300, 270
    td = fresh_dir(os.path.join(TMP, 'gshufjk'))
    for site in G6_SITES:
        s = _g6_site(site)
        B = _g6_B((site, 'skew'))
        names = [f'gjk{site}-{f:03d}_{_g6_date(i)}' for i, f in enumerate(dirs)]
        preps = {n: _g6_prep(site, f, B, n) for n, f in zip(names, dirs)}
        rows = {n: {'site': site, 'date': n.rsplit('_', 1)[1], 'counted': True} for n in names}
        T = B + preps[names[dirs.index(kstar)]]['cj']['dC']          # one truth for every scene of the site
        vals = {}
        for n in names:
            pj, pp = _fake_files(td, n, site, s['lat'], s['lon'], rows[n]['date'], T, G6_EMPTY_BOX)
            vals[n] = _judge_one(preps[n], pj, pp)[0]
        judged = [n for n, f in zip(names, dirs) if f != dropped]
        for primary in ('rho_res', 'rho_fine'):
            ds, _dsw, _ds2, excl = R.gshuf_all(judged, rows, preps, vals, [site], primary)
            m = R.mean([ds[n] for n in sorted(ds)])
            ck(sorted(ds) == sorted(judged) and not excl and m is not None and abs(m) <= 1e-12, f'{site}:{primary}:mean0')
            ck.kv[f'{site}:{primary}:mean'] = m
        ctl = []
        for j in judged:
            bx = vals[j]['_box']
            Wj, r15 = bx['W'], bx['r15']
            ks = [O.pearson(O.box15(O.combine(B, preps[k]['F'])['dC'])[Wj], r15[Wj]) for k in names if k != j]
            ctl.append(O.pearson(bx['d15'][Wj], r15[Wj]) - float(np.mean(ks)))
        c = float(np.mean(ctl))
        ck(abs(c) > 1e-3, f'{site}:controlJsubK')
        ck.kv[f'{site}:controlJsubK'] = c
    return ck.result()


# ───────────────────────── §6.4 statistics ─────────────────────────
@test('U-BOOT')
def t_boot():
    """date_block_ci = eval-ringtruth.date_block_ci (function text taken with ast, the script is never run; L600) for two
    (B, seed); constant → [v, v]; one block → [median, median]; fresh RNG per call; pins B 10000, seed 20261103."""
    ck = Checks()
    R = _R()
    with open(os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'eval-ringtruth.py'), encoding='utf-8') as f:
        tree = ast.parse(f.read())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'date_block_ci')
    ns = {'np': np}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), 'eval-ringtruth.date_block_ci', 'exec'), ns)
    rng = np.random.default_rng(SEED + 5)
    dates = [f'2026-09-{x:02d}' for x in (1, 5, 9, 13, 17, 21, 25, 29)]
    rows, vals, dts = [], [], []
    for i, dd in enumerate(dates):
        for s in range(1 + i % 3):
            v = float(rng.normal(0.1, 0.2))
            rows.append({'name': f's{s}_{dd}', 'x': v})
            vals.append(v)
            dts.append(dd)
    rows.append({'name': 's9_2026-09-29', 'x': None})
    vals.append(None)
    dts.append('2026-09-29')
    for B, seed in ((1000, 7), (10000, SEED)):
        ck(ns['date_block_ci'](rows, 'x', B=B, seed=seed) == R.date_block_ci(vals, dts, B=B, seed=seed), f'port{B}')
    ck(R.date_block_ci([0.3] * 5, dates[:5]) == [0.3, 0.3], 'constant')
    ck(R.date_block_ci([0.1, 0.2, 0.6], ['2026-09-01'] * 3) == [0.2, 0.2], 'oneBlock')
    ck(R.date_block_ci(vals, dts) == R.date_block_ci(vals, dts), 'freshRng')
    ck(R.BOOT_B == 10000 and R.SEED == 20261103, 'pins')
    return ck.result()


@test('U-SIGNFLIP')
def t_signflip():
    """Exact date-block sign flip (D11, L601-L604) by hand: 2^G vectors incl. identity, ties count as ≥; G > 16 → 65,536
    draws of default_rng(20261103), p = (1 + #≥)/65,537. Regression (build note FX-1): random mean and median cases with
    n ≥ 9 values (where a separate (1, n) reduction of the observed mean can sit 1 ulp above the identity row) against an
    independent count — one 1-D np.mean/np.median per sign vector against that of the values — incl. all-zero blocks
    (exact ties) and an MC case; PlacementTests.p (power) gives the same p."""
    ck = Checks()
    R = _R()
    ck(R.sign_flip_p([0.1, 0.2, -0.05], ['a', 'b', 'c'], 'median') == 0.25, 'hand3median')
    ck(R.sign_flip_p([0.3, -0.1, 0.2], ['a', 'a', 'b'], 'mean') == 0.25, 'hand2blocksMean')
    ck(R.sign_flip_p([0.0, 0.1, 0.2, 0.3], list('abcd'), 'median') == 2 / 16, 'tiesCountGE')
    ck(R.sign_flip_p([0.1, 0.2, 0.3, 0.4], list('abcd'), 'mean') == 1 / 16, 'identityOnly')
    ds = [f'd{i:02d}' for i in range(17)]
    signs = np.random.default_rng(SEED).choice([1, -1], size=(65536, 17))
    cnt = int(np.sum(np.all(signs == 1, axis=1)))
    ck(R.sign_flip_p([1.0] * 17, ds, 'mean') == (1 + cnt) / 65537, 'mc17')
    ck(R.sign_flip_p([1.0] * 16, ds[:16], 'mean') == 1 / 65536, 'exact16')
    ck(R.sign_flip_p([None, 0.2], ['a', 'b'], 'mean') == 0.5 and R.sign_flip_p([None], ['a']) is None, 'nones')
    rng = np.random.default_rng(SEED + 7)
    nbad, nzero, nplace = [], 0, 0
    cases = [(int(rng.integers(8, 13)), t) for t in range(40)] + [(16, 40), (16, 41), (17, 42), (17, 43)]
    for G, t in cases:
        n = G + int(rng.integers(1, 12))
        blocks = [f'2026-{9 + i // 30:02d}-{1 + i % 30:02d}' for i in range(G)]
        dts = blocks + [blocks[int(i)] for i in rng.integers(0, G, n - G)]
        v = rng.normal(0.05, 0.15, n)
        if t % 5 == 0:                                   # one all-zero block: its flip is an exact tie
            v[np.array([d == blocks[0] for d in dts])] = 0.0
            nzero += 1
        idx = np.array([blocks.index(d) for d in dts])
        if G <= 16:
            sv = np.array(list(itertools.product((1, -1), repeat=G)), dtype=np.float64)
        else:
            sv = np.random.default_rng(SEED).choice([1, -1], size=(65536, G)).astype(np.float64)
        for stat, fn in (('mean', np.mean), ('median', np.median)):
            obs = float(fn(v))
            c = sum(1 for x in sv if float(fn(v * x[idx])) >= obs)
            ref = c / 2.0 ** G if G <= 16 else (1.0 + c) / 65537.0
            got = R.sign_flip_p([float(x) for x in v], dts, stat)
            if got != ref or (G <= 16 and stat == 'mean' and got * 2 ** G < (2 if t % 5 == 0 else 1)):
                nbad.append(f'{stat}G{G}n{n}')
            if stat == 'mean' and t % 4 == 0:
                nplace += 1
                if R.PlacementTests(dts, B=10).p(v, stat) != got:
                    nbad.append(f'place{stat}G{G}')
    ck(not nbad, 'identityRegression' + ('(' + ','.join(nbad[:4]) + ')' if nbad else ''))
    ck.kv.update({'regCases': len(cases), 'regZeroBlock': nzero, 'regPlacement': nplace, 'regBad': len(nbad)})
    return ck.result()


@test('U-STATS')
def t_stats():
    """8-day blocks (L742, Q-54), |S|-weighted Fisher z (L589), c1 (L627), site table / LOSO / median of site medians
    (L590), summary_stat — hand values."""
    ck = Checks()
    R = _R()
    hand = {'2026-09-01': 0, '2026-09-05': 0, '2026-09-09': 1, '2026-09-13': 1, '2026-10-11': 5, '2026-10-15': 5,
            '2026-10-19': 6, '2026-10-23': 6, '2026-10-27': 7, '2026-10-31': 7, '2026-11-04': 8}
    ck(all(R.block8(k) == v for k, v in hand.items()), 'block8')
    z = (20 * math.atanh(0.5) + 10 * math.atanh(-0.2)) / 30
    fz = R.fisher_stat([(0.5, 23), (-0.2, 13)])
    ck(_close(fz, math.tanh(z), 1e-15) and _close(fz, 0.29006, 1e-5), 'fisher')
    ck(_close(R.fisher_stat([(1.0, 23)]), 0.999999, 1e-12) and R.fisher_stat([(0.5, 3)]) is None, 'fisherClipWeight')
    rows = {}
    k = 0
    for site, nd in (('a', 10), ('b', 6), ('c', 4)):
        for i in range(nd):
            rows[f'{site}_2026-09-{1 + (k % 8) * 4:02d}x{k}'] = {'site': site, 'date': f'2026-09-{1 + (k % 8) * 4:02d}'}
            k += 1
    c1 = R.clause_c1(sorted(rows), rows)
    ck(c1['n'] == 20 and c1['dates'] == 8 and c1['sites'] == 3 and c1['maxShare'] == 0.5 and c1['pass'], 'c1pass')
    names = sorted(rows)[1:]
    c1b = R.clause_c1(names, rows)
    ck(not c1b['pass'] and not c1b['n>=20'] and c1b['maxShare<=0.5'], 'c1n19')
    rows2 = dict(rows)
    rows2['a_extra'] = {'site': 'a', 'date': '2026-09-01'}
    c1c = R.clause_c1(sorted(rows2), rows2)
    ck(c1c['n'] == 21 and not c1c['maxShare<=0.5'] and not c1c['pass'], 'c1share')
    vals = {n: {'rho_star': (0.1 if rows[n]['site'] == 'a' else (0.3 if rows[n]['site'] == 'b' else -0.2)), 'd_star': 0.05}
            for n in rows}
    dsh = {n: 0.02 for n in rows if rows[n]['site'] == 'a'}
    t = R.site_table(sorted(rows), rows, vals, dsh)
    ck(t['sites']['a']['n'] == 10 and t['sites']['a']['medianRhoStar'] == 0.1 and t['sites']['b']['medianRhoStar'] == 0.3
       and _close(t['sites']['a']['meanDshuf'], 0.02, 1e-15) and t['sites']['b']['meanDshuf'] is None, 'siteTable')
    ck(t['loso']['a'] == 0.3 and t['loso']['c'] == 0.1 and t['medianOfSiteMedians'] == 0.1, 'losoMedianOfMedians')
    ss = R.summary_stat([0.1, None, 0.3], ['x', 'y', 'z'], 'mean', with_p=True)
    ck(ss['n'] == 2 and _close(ss['value'], 0.2, 1e-15) and ss['p'] == 0.25 and ss['ci'][0] <= ss['ci'][1], 'summaryStat')
    return ck.result()


# ───────────────────────── §6.5 clauses, actions, tags ─────────────────────────
def _st(**ov):
    st = {'primary': 'rho_res', 'c1': {'pass': True}, 'c3bMeasurable': True, 'c7': True,
          'rho': {'value': 0.1, 'ci': [0.02, 0.2], 'p': 0.01}, 'd': {'value': 0.2, 'ci': [0.05, 0.3], 'p': 0.01},
          'dMSE': {'value': -0.001, 'ci': [-0.003, 0.001]}, 'dMSElam': {'value': -0.0005, 'ci': None},
          'beta': {'value': 0.6}, 'dshuf': {'value': 0.02, 'p': 0.05},
          'dcorr12': {'value': 0.01, 'ci': [0.0, 0.02]}, 'dcorr50': {'value': 0.0}, 'dmeanErr': {'value': 0.001},
          'rhoVis': {'value': 0.05, 'ci': [-0.01, 0.1]}, 'Lminus': {'value': -0.01, 'ci': [-0.02, -0.001]},
          'rhoRot': {'value': 0.01}, 'rhoEven': {'value': 0.02}, 'rhoOdd': {'value': 0.08},
          'rhoFine': {'value': 0.05, 'ci': [0.01, 0.1]}}
    for k, v in ov.items():
        if isinstance(v, dict) and isinstance(st.get(k), dict):
            st[k] = dict(st[k], **v)
        else:
            st[k] = v
    return st


@test('U-CLAUSE')
def t_clause():
    """c1–c8 boundaries (L627-L636) and the action lines ①–⑥ with their tags (L646-L683)."""
    ck = Checks()
    R = _R()

    def run(exp=None, **ov):
        st = _st(**ov)
        c = R.clauses(st)
        return c, R.action(c, st, exp)
    c, a = run()
    ck(all(c[k] is True for k in ('c1', 'c2', 'c2b', 'c3', 'c3b', 'c4', 'c5', 'c7', 'c8')) and c['c6'] == 'report', 'allPass')
    ck(a['line'] == '3-5' and a['verdict'] == '합격' and a['failed'] == []
       and a['tags'] == ['사이트 고정 무늬와 약하게만 가름(p 값)', '아침(Terra ≈ 09:00) 판정']
       and a['effect']['rhoOdd']['median'] == 0.08, 'passTags')
    ck(R.clauses(_st(rho={'p': 0.025}))['c2'] is True and R.clauses(_st(rho={'ci': [0.0, 0.2]}))['c2'] is False
       and R.clauses(_st(rho={'value': 0.0}))['c2'] is False and R.clauses(_st(rho={'p': 0.0251}))['c2'] is False, 'c2bounds')
    ck(R.clauses(_st(dMSE={'value': 0.0}))['c2b'] is True and R.clauses(_st(dMSE={'value': 1e-9}))['c2b'] is False, 'c2bBound')
    ck(R.clauses(_st(d={'ci': [0.0, 0.3]}))['c3'] is False and R.clauses(_st(d={'p': 0.025}))['c3'] is True, 'c3bounds')
    ck(R.clauses(_st(dshuf={'p': 0.10}))['c3b'] is True and R.clauses(_st(dshuf={'p': 0.1001}))['c3b'] is False
       and R.clauses(_st(dshuf={'value': 0.0}))['c3b'] is False and R.clauses(_st(c3bMeasurable=False))['c3b'] == '못 잼', 'c3b')
    ck(R.clauses(_st(dcorr12={'value': 0.0, 'ci': [-0.01, 0.01]}))['c4'] is True
       and R.clauses(_st(dcorr12={'ci': [-0.0101, 0.02]}))['c4'] is False, 'c4bounds')
    ck(R.clauses(_st(dcorr50={'value': -0.01}, dmeanErr={'value': -0.01}))['c5'] is True
       and R.clauses(_st(dmeanErr={'value': 0.0101}))['c5'] is False and R.clauses(_st(dcorr50={'value': -0.0101}))['c5'] is False,
       'c5bounds')
    ck(R.clauses(_st(rhoVis={'value': 0.0}))['c8'] is True and R.clauses(_st(Lminus={'value': 0.0}))['c8'] is False, 'c8bounds')
    lines = {
        '1': dict(c7=False), '2': dict(c1={'pass': False}), '3-1a': dict(c3bMeasurable=False),
        '3-1b': dict(dshuf={'p': 0.3}, dMSE={'value': 0.002}),
        '3-2a': dict(dMSE={'value': 0.002, 'ci': [0.0005, 0.004]}), '3-2b': dict(dMSE={'value': 0.002, 'ci': [-0.001, 0.004]}),
        '3-3a': dict(Lminus={'value': 0.001, 'ci': [0.0005, 0.002]}), '3-3b': dict(Lminus={'value': 0.001, 'ci': [-0.001, 0.002]}),
        '3-4a': dict(dcorr12={'value': -0.001}), '3-4b': dict(dmeanErr={'value': 0.02}),
        '4': dict(rho={'value': -0.01}), '5a': dict(d={'p': 0.5}), '5b': dict(d={'p': 0.5, 'ci': [-0.05, 0.08]}),
        '6a': dict(rho={'p': 0.5, 'ci': [-0.1, 0.04]}, d={'p': 0.5, 'ci': [-0.1, 0.09]}),
        '6b': dict(rho={'p': 0.5, 'ci': [-0.1, 0.04]}, d={'p': 0.5, 'ci': [-0.1, 0.2]})}
    want = {'1': ('1', '가드 실패', None), '2': ('2', '미결', None), '3-1a': ('3-1', '미결', None), '3-1b': ('3-1', '미결', None),
            '3-2a': ('3-2', '불합격', '진폭 과대'), '3-2b': ('3-2', '불합격', '진폭 못 가름(점 추정만 > 0)'),
            '3-3a': ('3-3', '불합격', '보이는 쪽 반대'), '3-3b': ('3-3', '불합격', '보이는 쪽 못 가름(점 추정만)'),
            '3-4a': ('3-4', '불합격', '방향 통과·c4 실패'), '3-4b': ('3-4', '불합격', '방향 통과·c5 실패'),
            '4': ('4', '미결', None), '5a': ('5', '불합격', '바람 홀수 몫 못 가름'),
            '5b': ('5', '불합격', '바람 홀수 몫 작음 — c2 의 상관은 바람과 무관한 지형 상관(눈·안개 등)일 수 있음'),
            '6a': ('6', '불합격', '작음'), '6b': ('6', '불합격', '못 가름')}
    for k, ov in lines.items():
        _, a = run(**ov)
        ln, vd, tag = want[k]
        ck(a['line'] == ln and a['verdict'] == vd and (tag is None or a['tags'] == [tag]), f'line{k}')
    _, a = run(**lines['3-1a'])
    ck(a['reason'] == 'G-shuf 못 잼', 'reason31a')
    _, a = run(**lines['3-1b'])
    ck(a['reason'] == '사이트에 고정된 지형·지표 무늬와 구분 안 됨' and a['register'] == {'kappaTimesBetaTilde': 0.6}
       and 'c2b' in a['notes'] and 'c2b' in a['failed'] and 'c3b' in a['failed'], 'reason31bRegister')
    _, a = run(**lines['3-2a'])
    ck(a['register'] == {'kappaTimesBetaTilde': 0.6}, 'register32')
    _, a = run(dcorr12={'value': -0.001}, dmeanErr={'value': 0.02})
    ck(a['tags'] == ['방향 통과·c4·c5 실패'] and a['failed'] == ['c4', 'c5'], 'line34both')
    _, a = run('held 집계')
    ck(a['tags'][-2:] == ['동결 전 held 집계 노출(§0.5)', '아침(Terra ≈ 09:00) 판정'], 'exposureAggregate')
    _, a = run('모름', **lines['6a'])
    ck(a['tags'] == ['작음', '동결 전 held 장면별 노출(§0.5)'], 'exposureUnknownIsPerScene')
    _, a = run('없음')
    ck('동결 전 held 집계 노출(§0.5)' not in a['tags'] and len(a['tags']) == 2, 'exposureNone')
    _, a = run(rhoRot={'value': -0.031}, rhoEven={'value': 0.08}, rhoFine={'value': 0.05, 'ci': [-0.01, 0.1]},
               Lminus={'ci': [-0.02, 0.0]}, dMSElam={'value': 0.0001}, dshuf={'p': 0.02})
    ck(a['tags'] == ['null 이 0 이 아님', '높이 착시 몫이 바람 홀수 몫만큼 큼',
                     '50 km 아래 신호는 확인 안 됨 — 예보 자체의 지형 오차·고리 표본 오차와 구분 안 됨',
                     '풍하 갬 근거는 점추정뿐', '앱 진폭 과대 가능(λ̃* 배 — 판정 경로 진폭만 합격)', '아침(Terra ≈ 09:00) 판정'],
       'passTagsAll')
    _, a = run(rhoFine={'value': -0.01, 'ci': [-0.05, 0.03]}, dshuf={'p': 0.02})
    ck(a['tags'] == ['신호가 50 km 넘는 규모에만 있음', '아침(Terra ≈ 09:00) 판정'], 'fineNonPositive')
    _, a = run(primary='rho_fine', rhoFine={'value': -0.01, 'ci': [-0.05, 0.03]}, dshuf={'p': 0.02})
    ck(a['tags'] == ['아침(Terra ≈ 09:00) 판정'], 'fineTagOnlyWithRhoRes')
    return ck.result()


# ───────────────────────── §6.6 rulerHash, prechecks ─────────────────────────
@test('U-RHASH')
def t_rhash():
    """rulerHash (L871): lines strictly between '## 10.' and '## 11.' removed; exactly one of each; CLI = function."""
    ck = Checks()
    R = _R()
    t = b'# x\n## 9. a\nA\n## 10. rec\nB\n### 10.2 g\nC\n## 11. ans\nD\n'
    exp = sha(b'# x\n## 9. a\nA\n## 10. rec\n## 11. ans\nD\n')
    ck(R.ruler_hash_bytes(t) == exp, 'hand')
    ck(R.ruler_hash_bytes(t.replace(b'C\n', b'C\nappended record line\n')) == exp, 'section10Free')
    ck(R.ruler_hash_bytes(t.replace(b'A\n', b'A2\n')) != exp and R.ruler_hash_bytes(t.replace(b'D\n', b'D2\n')) != exp,
       'restBound')
    for bad in (t + b'## 10. again\n', t.replace(b'## 11. ans\n', b''), b'## 11. x\n## 10. y\n', t + b'## 11. two\n'):
        try:
            R.ruler_hash_bytes(bad)
            ck(False, 'refusesBadStructure')
        except ValueError:
            pass
    rp = os.path.join(HERE, 'RULER-oro.md')
    h = R.ruler_hash(rp)
    ck(_run_oro(['--ruler-hash']).stdout.strip() == h, 'cliEqualsFunction')
    ck(R.section_text(t, b'### 10.2', b'## 11.') == b'### 10.2 g\nC', 'section102')
    ck.kv['rulerHash'] = h
    return ck.result()


@test('U-PRECHK')
def t_prechk():
    """T-free recompute comparison (Q-56): env differences recorded only, floats ≤ 1e-9, flags/counts exact; versions."""
    ck = Checks()
    R = _R()
    a = {'sources': {'env': {'numpy': '2.5.3'}}, 'scenes': {'x': {'A1': {'ok': True, 'rmsM': 101.0}, 'counts': {'S': 21}}}}

    def mod(f):
        b = json.loads(json.dumps(a))
        f(b)
        return R.compare_apply(b, a)
    c = mod(lambda b: None)
    ck(c['identical'] and c['ok'], 'same')
    c = mod(lambda b: b['scenes']['x']['A1'].update(rmsM=101.0 + 1e-10))
    ck(c['ok'] and not c['identical'] and c['nFloatDiffs'] == 1, 'float1e-10')
    ck(not mod(lambda b: b['scenes']['x']['A1'].update(rmsM=101.0 + 1e-8))['ok'], 'float1e-8')
    c = mod(lambda b: b['scenes']['x']['A1'].update(ok=False))
    ck(not c['ok'] and c['flagDiffs'] == ['/scenes/x/A1/ok'], 'flag')
    ck(not mod(lambda b: b['scenes']['x']['counts'].update(S=22))['ok'], 'countS')
    ck(mod(lambda b: b['sources']['env'].update(numpy='9.9'))['identical'], 'envIgnored')
    ok, rec = R.versions_ok({'versions': R.versions_ok({})[1]['running']})
    ck(ok and not R.versions_ok({'versions': dict(rec['running'], numpy='0.0')})[0], 'versions')
    return ck.result()


# ───────────────────────── §6.9 G6 (f)(g)(h) ─────────────────────────
def _g6_empty_box(p):
    """Window box for the fake PNG's one empty 3 km px ((f), (h); L769): the box of S without the empty px (input masks
    snow ∪ high on the judge tiling) with the largest |box ΔC|, so that the box is in W, S and S∪ before the px and the
    check 'it leaves W·S·S∪' has content. Masks are off in the synthetic scenes, so there it is the window's max |box ΔC|.
    Returns (box, S without the empty px, W without the empty px)."""
    d15 = O.box15(p['cj']['dC'])
    mk0 = _R().judge_masks(p['dem']['hmax6'], p['tm']['zSnow'], p['Bs']['high'], None)
    S0 = mk0['W'] & (np.abs(d15) >= O.DC_SEL)
    a = np.where(S0, np.abs(d15), -1.0)
    return tuple(int(x) for x in np.unravel_index(int(np.argmax(a)), a.shape)), S0, mk0['W']


def _g6f_eval(entry, d, empty_box=None):
    """One G6(f) scene through the judge path with T_fake = clip(B + ΔC) ((f) form). Returns (v, tr, mk, box, clipped)."""
    kind, name, site, lat, lon, date_s, p = entry
    B, dC = p['Bs']['total'], p['cj']['dC']
    if empty_box is None:
        empty_box = _g6_empty_box(p)[0]
    pj, pp = _fake_files(d, name, site, lat, lon, date_s, B + dC, empty_box)
    v, tr, mk = _judge_one(p, pj, pp)
    return v, tr, mk, empty_box, (B + dC < 0) | (B + dC > 1), pj, pp


def _g6f_criteria(fx, d, ck, pre=''):
    """The G6(f) criteria (L771-L776) on the scenes fx['scenes'] (and the ρ^vis fallback scenes), checked into ck with
    names prefixed by pre. Returns the number of scenes evaluated."""
    vis = []
    for i, entry in enumerate(fx['scenes']):
        kind, name = entry[0], entry[1]
        tag = f'{pre}{kind}{i}'
        v, tr, mk, box, clipped, pj, pp = _g6f_eval(entry, d)
        bx = v['_box']
        d15, r15 = bx['d15'], bx['r15']
        okb = mk['W'] & ~(O.box15(clipped.astype(np.float64)) > 0)
        err = float(np.max(np.abs(r15 - d15)[okb])) if okb.any() else None
        ck(err is not None and err <= 0.003, f'{tag}:rMinusDC')
        ck(v['rho_res'] >= 0.99, f'{tag}:rhoRes')
        ck(v['beta_res'] is not None and 0.97 <= v['beta_res'] <= 1.03, f'{tag}:betaRes')
        ck(v['d'] > 0, f'{tag}:d')
        ck(v['dMSE'] is not None and v['dMSE'] < 0, f'{tag}:dMSE')
        ck(v['dcorr12'] > 0, f'{tag}:dcorr12')
        ck(v['rho_fine'] > 0, f'{tag}:rhoFine')
        ck(v['Lminus'] < 0, f'{tag}:Lminus')
        _b, S0, W0 = _g6_empty_box(entry[6])
        ck(_b == box and W0[box] and S0[box] and not mk['W'][box] and not bx['S'][box] and not bx['Su'][box]
           and v['nEmptyBoxes'] == 1 and v['nS'] == int(S0.sum()) - 1 and v['nW'] == int(W0.sum()) - 1, f'{tag}:emptyBox')
        p = entry[6]
        for fl, sl in (('NS', (slice(None, None, -1), slice(None))), ('EW', (slice(None), slice(None, None, -1)))):
            pjx, ppx = _fake_files(d, f'{name}-{fl}', entry[2], entry[3], entry[4], entry[5],
                                   (p['Bs']['total'] + p['cj']['dC'])[sl], box)
            vx, _, _ = _judge_one(p, pjx, ppx)
            ck(vx['rho_res'] < v['rho_res'] - 0.3, f'{tag}:flip{fl}')
            ck.kv[f'{tag}rho{fl}'] = vx['rho_res']
        vis.append(_g6f_vis(entry, d, box))
        ck.kv.update({f'{tag}rhoRes': v['rho_res'], f'{tag}beta': v['beta_res'], f'{tag}errMax': err, f'{tag}nS': v['nS'],
                      f'{tag}nClipped': int(clipped.sum()), f'{tag}Lminus': v['Lminus']})
    # ρ^vis (L775): scenes with sd_S(ΔC^vis) ≥ 0.01 must reach 0.99; none → further dev scenes by date, then the (g)
    # synthetic scenes 0°, 90°, 180° (band B 0.3, high 0): the first with sd ≥ 0.01; none at all → G6(f) fails
    meas = [x for x in vis if x[2] is not None and x[2] >= 0.01]
    src = 'scenes'
    if not meas:
        for entry in fx['moreDev'] + fx['syn']:
            x = _g6f_vis(entry, d, None)
            if x[2] is not None and x[2] >= 0.01:
                meas, src = [x], ('moreDev' if entry[0] == 'dev' else 'synthetic')
                break
    ck(bool(meas), f'{pre}visMeasurable')
    for tag, rv, sd in meas:
        ck(rv is not None and rv >= 0.99, f'{pre}vis:{tag}')
    for i, (tag, rv, sd) in enumerate(vis):
        ck.kv[f'{pre}vis{i}'] = rv
        ck.kv[f'{pre}visSd{i}'] = sd
    ck.kv.update({f'{pre}visSource': src, f'{pre}visN': len(meas)})
    return len(fx['scenes'])


@test('G6f')
def t_g6f():
    """Judge path end to end with fake truth (L764-L776): |r_b − ΔC_b| ≤ 0.003 on unclipped W boxes; ρ_res ≥ 0.99,
    β_res ∈ [0.97, 1.03], d > 0, ΔMSE_W < 0, Δcorr12 > 0, ρ_fine > 0, L⁻ < 0; the empty-px box leaves W, S, S∪ and is the
    only empty box; N/S and E/W flips of T_fake drop ρ_res by > 0.3; ρ^vis ≥ 0.99 on scenes with sd_S(ΔC^vis) ≥ 0.01 (app
    path fake truth, the L775 fallback order).
    Scenes: the dev judge scenes (A1–A8 true) of the committed oro-apply.json by date, else the synthetic fill. While the
    soundings are pending (provisional oro-apply, no dev judge scene) the fill is all three; the dev branch that the
    11-05 rebuild will take is run here as a dry run on the B-SYN fixture (synthetic soundings and B, real DEM), with the
    same criteria, so a failure of that branch shows now (prefix 'dry'). The fill rule is checked for 0–4 dev scenes."""
    ck = Checks()
    with _record_opens('G6f'):
        d = fresh_dir(os.path.join(T_G6, 'f'))
        fx = _g6f_scenes()
        ck(fx['devConsistent'], 'devSelectionConsistent')
        nd = sum(1 for e in fx['scenes'] if e[0] == 'dev')
        ck(nd == min(3, len(fx['devNames'])) and [e[1] for e in fx['scenes'] if e[0] == 'dev'] == fx['devNames'][:3],
           'devFirstByDate')
        _g6f_criteria(fx, d, ck)
        ck.kv.update({'nDev': nd, 'nDevJudgeable': len(fx['devNames'])})
        # fill rule (L765): k dev scenes → dev[:3] then synthetic 0°, 90°, 180°
        syn = _g6f_syn()
        ck([e[1].split('-')[2].split('_')[0] for e in syn] == ['000', '090', '180'], 'synOrder')
        fill_ok = True
        for k in range(5):
            devs = [('dev', f'x{i}') for i in range(k)]
            out, more = _g6f_fill(devs, [('syn', s[1]) for s in syn])
            want = [x[1] for x in devs[:3]] + [s[1] for s in syn][:max(0, 3 - k)]
            fill_ok &= [x[1] for x in out] == want and [x[1] for x in more] == [x[1] for x in devs[3:]]
        ck(fill_ok, 'fillRule')
    # dev branch dry run (synthetic fixture; its opens are audited by G8f too)
    with _record_opens('G6fDry'):
        fs = _fixture_syn()
        dd = fresh_dir(os.path.join(T_G6, 'f-dry'))
        fxd = _g6f_select(fs['apply'], fs['inputs'], fs['base'], 'g6fDry')
        ck(fxd['devConsistent'] and len(fxd['devNames']) >= 4 and [e[0] for e in fxd['scenes']] == ['dev'] * 3
           and [e[1] for e in fxd['scenes']] == fxd['devNames'][:3] and [e[1] for e in fxd['moreDev']] == fxd['devNames'][3:],
           'dryDevSelection')
        _g6f_criteria(fxd, dd, ck, 'dry')
        ck.kv['dryNDevJudgeable'] = len(fxd['devNames'])
    return ck.result()


def _g6f_vis(entry, d, box):
    """ρ^vis with the app-path fake truth T^vis = clip(B^vis + ΔC^vis) ((f) form; L775, check-procedure q-b)."""
    kind, name, site, lat, lon, date_s, p = entry
    if box is None:
        box = _g6_empty_box(p)[0]
    a = p['app']
    pj, pp = _fake_files(d, f'{name}-vis', site, lat, lon, date_s, a['Bvis'] + a['dCvis'], box)
    v, _, _ = _judge_one(p, pj, pp)
    return name, v['rho_vis'], v['sdVisS']


@test('G6g')
def t_g6g():
    """Contrasts (L777-L785): two dev sites × even/skew sets, U 8 m/s, N 0.01, one B per site/set, masks inactive.
    (i) T = B + ΔC_j vs (ii) T = B + ΔC_{j|k*}: mean d_shuf(i) > mean d_shuf(ii) + 0.2, |mean d_shuf(ii)| ≤ 0.05, (ii) c3b
    sign-flip p > 0.10; (iii) T = B + ΔC_rot: median ρ_rot ≥ 0.99 and > median ρ_res + 0.3; (iv) 200 noise truths per
    scene (gauss50, amplitude 0.25 in the (f) clip, seeds 20261103, 20261104, … in loop order): |mean ρ_rot| ≤ 0.01."""
    ck = Checks()
    R = _R()
    with _record_opens('G6g'):
        d = fresh_dir(os.path.join(T_G6, 'g'))
        seed = SEED
        allrot, nclip, ncell = [], 0, 0
        iv_full_diff, iv_full_n = 0.0, 0
        for site in G6_SITES:
            s = _g6_site(site)
            for sname, (dirs, kstar) in G6_SETS.items():
                B = _g6_B((site, sname))
                names = _g6_names(site, sname)
                preps = {n: _g6_prep(site, frm, B, n) for n, frm in zip(names, dirs)}
                rows = {n: {'site': site, 'date': n.rsplit('_', 1)[1], 'counted': True} for n in names}
                kname = names[dirs.index(kstar)]
                res = {}
                for mode in ('i', 'ii', 'iii'):
                    vals = {}
                    for n in names:
                        p = preps[n]
                        add = {'i': p['cj']['dC'], 'ii': preps[kname]['cj']['dC'], 'iii': p['co']['dC']}[mode]
                        pj, pp = _fake_files(d, f'{n}-{mode}', site, s['lat'], s['lon'], rows[n]['date'], B + add, G6_EMPTY_BOX)
                        vals[n] = _judge_one(p, pj, pp)[0]
                    # every scene of the set is a G-shuf j and k (the set is the test's applied list, L777-L781): the
                    # ruler's "(ii) mean exactly 0" needs J = K; A7 is not applied to synthetic scenes (build note 12)
                    ds, dsw, ds2, excl = R.gshuf_all(list(names), rows, preps, vals, [site], 'rho_res')
                    res[mode] = {'vals': vals, 'ds': ds, 'ds2': ds2, 'excl': excl}
                tag = f'{site}/{sname}'
                m1, m2 = R.mean(list(res['i']['ds'].values())), R.mean(list(res['ii']['ds'].values()))
                jd = sorted(res['ii']['ds'])
                p2 = R.sign_flip_p([res['ii']['ds'][n] for n in jd], [rows[n]['date'] for n in jd], 'mean')
                ck(m1 is not None and m2 is not None and m1 > m2 + 0.2, f'{tag}:iGTii')
                ck(m2 is not None and abs(m2) <= 0.05, f'{tag}:iiMean')
                ck(p2 is not None and p2 > 0.10, f'{tag}:iiP')
                v3 = res['iii']['vals']
                mrot = R.median([v3[n]['rho_rot'] for n in names])
                mres = R.median([v3[n]['rho_res'] for n in names])
                ck(mrot is not None and mrot >= 0.99 and mrot > mres + 0.3, f'{tag}:iiiRot')
                ck(not res['i']['excl'] and len(res['i']['ds']) == len(res['ii']['ds']) == len(names), f'{tag}:everyJ')
                nsv = [res['i']['vals'][n]['nS'] for n in names]
                ck.kv.update({f'{tag}:nSmin': min(nsv), f'{tag}:nSlt20': sum(1 for x in nsv if x < O.A7_MIN_S)})
                ck.kv.update({f'{tag}:i': m1, f'{tag}:ii': m2, f'{tag}:iiP': p2, f'{tag}:rot': mrot, f'{tag}:rotRes': mres})
                if sname == 'skew':
                    ck.kv[f'{tag}:iiMedian'] = R.median(list(res['ii']['ds'].values()))
                    ck.kv[f'{tag}:iiForm2Mean'] = R.mean(list(res['ii']['ds2'].values()))
                # (iv) pure-noise truths through the judge decoding (u8 2×2 replicate, row flip, 2×2 mean). ρ_rot =
                # pearson_S∪(ΔC_rot, r) with S∪ fixed by ΔC, ΔC_rev and W (same PNG for every truth of the scene), so
                # only r changes; replicate 0 of every scene also goes through the whole judge path (fake JSON + PNG
                # → load_truth → empty_cells → judge_masks → scene_main) and must give the same ρ_rot bit for bit.
                v1 = res['i']['vals']
                rep0, rep_meds = [], []
                per_rep = [[] for _ in range(200)]
                for n in names:
                    p = preps[n]
                    Su = v1[n]['_box']['Su']
                    rot15 = O.box15(p['co']['dC'])
                    for rep in range(200):
                        raw = B + 0.25 * smooth_field(128, 50, seed)
                        nclip += int(np.sum((raw < 0) | (raw > 1)))
                        ncell += raw.size
                        u = np.round(np.kron(np.clip(raw, 0, 1), np.ones((2, 2))) * 255.0).astype(np.uint8)[::-1]
                        Tj = R.truth_from_u8(u.astype(np.float64) / 255.0)['T']
                        x = O.pearson(rot15[Su], O.box15(Tj - B)[Su])
                        allrot.append(x)
                        per_rep[rep].append(x)
                        if rep == 0:
                            rep0.append(x)
                            pj, pp = _fake_files(d, f'{n}-iv{seed}', site, s['lat'], s['lon'], rows[n]['date'], raw,
                                                 G6_EMPTY_BOX)
                            vj = _judge_one(p, pj, pp)[0]
                            iv_full_diff = max(iv_full_diff, abs(vj['rho_rot'] - x) if vj['rho_rot'] is not None else 9.0)
                            iv_full_n += 1
                        seed += 1
                rep_meds = [R.median(xs) for xs in per_rep]
                ck.kv[f'{tag}:noiseRep0Median'] = R.median(rep0)
                ck.kv[f'{tag}:noiseShareAbsMedGt0.05'] = sum(1 for m in rep_meds if abs(m) > 0.05) / len(rep_meds)
        mr = float(np.mean(allrot))
        ck(abs(mr) <= 0.01, 'ivNoiseMean')
        ck(len(allrot) == 2 * 2 * 8 * 200 and seed - 1 == SEED + len(allrot) - 1, 'ivCountAndSeeds')
        ck(iv_full_n == 2 * 2 * 8 and iv_full_diff == 0.0, 'ivEqualsJudgePath')
        ck.kv.update({'ivMeanRot': mr, 'ivN': len(allrot), 'ivClipFrac': nclip / ncell, 'ivLastSeed': seed - 1,
                      'ivJudgePathN': iv_full_n, 'ivJudgePathMaxDiff': iv_full_diff})
    return ck.result()


@test('G6h')
def t_g6h():
    """c8 test (L786-L792) on the (f) scenes: T = B + ΔC·1[box ΔC ≥ 0.02] (window boxes, T = B outside) → |median L⁻| ≤
    0.003; coastal version + s·1[sea stratum box] (s = +0.05 if the scene's sea-box median B ≤ 0.5 else −0.05, clipped) →
    the same; the sea-agnostic tertile and 2-draft window-mean forms are reported."""
    ck = Checks()
    R = _R()
    with _record_opens('G6h'):
        d = fresh_dir(os.path.join(T_G6, 'h'))
        fx = _g6f_scenes()
        L1, L2, tert, win, tert2 = [], [], [], [], []
        for i, entry in enumerate(fx['scenes']):
            kind, name, site, lat, lon, date_s, p = entry
            B, dC = p['Bs']['total'], p['cj']['dC']
            d15 = O.box15(dC)
            box = _g6_empty_box(p)[0]
            ind = np.zeros((128, 128))
            ind[49:79, 49:79] = np.kron((d15 >= 0.02).astype(np.float64), np.ones((2, 2)))
            pj, pp = _fake_files(d, f'{name}-h', site, lat, lon, date_s, B + dC * ind, box)
            v, tr, mk = _judge_one(p, pj, pp)
            L1.append(v['Lminus'])
            tert.append(v['LminusTertile'])
            win.append(v['LminusWindow'])
            seab = p['dem']['sea'] & mk['W']
            sv = 0.0
            if seab.any():
                sv = 0.05 if float(np.median(O.box15(B)[seab])) <= 0.5 else -0.05
            sea6 = np.zeros((128, 128))
            sea6[49:79, 49:79] = np.kron(seab.astype(np.float64), np.ones((2, 2)))
            pj, pp = _fake_files(d, f'{name}-hc', site, lat, lon, date_s, B + dC * ind + sv * sea6, box)
            v2, _, _ = _judge_one(p, pj, pp)
            L2.append(v2['Lminus'])
            tert2.append(v2['LminusTertile'])
            bx = v['_box']
            lee = bx['S'] & (bx['d15'] <= -O.DC_SEL)
            neu = bx['W'] & (np.abs(bx['d15']) < O.DC_SEL) & (np.abs(bx['dr15']) < O.DC_SEL)
            ck.kv.update({f's{i}nSea': int(seab.sum()), f's{i}seaS': sv, f's{i}seaLee': int((lee & seab).sum()),
                          f's{i}seaNeutral': int((neu & seab).sum()), f's{i}L': v['Lminus'], f's{i}Lcoastal': v2['Lminus'],
                          f's{i}LtertileCoastal': v2['LminusTertile']})
        m1, m2 = R.median(L1), R.median(L2)
        ck(abs(m1) <= 0.003, 'windwardOnly')
        ck(abs(m2) <= 0.003, 'coastal')
        ck.kv.update({'medianL': m1, 'medianLcoastal': m2, 'medianTertile': R.median(tert),
                      'medianTertileCoastal': R.median(tert2), 'medianWindow2draft': R.median(win)})
    return ck.result()


# ───────────────────────── §6.9 G8 (b)–(f) ─────────────────────────
@test('G8b')
def t_g8b():
    """oro-fingerprint.py (byte-identical, imported, main never run) on a synthetic bank with patched SAT/NWP/ORO/MACRO/RING
    (C3): --f1/--f3 identical with and without trueGrid in the scene copies and with real-looking vs fake index cover;
    --f2 with a stub subprocess.run reads only its --out file and the (fake) committed file and prints counts only."""
    ck = Checks()
    fpp = os.path.join(HERE, 'oro-fingerprint.py')
    ck(O.sha256_file(fpp) == FP_SHA, 'byteIdentical')
    fpm = _load('oro_fingerprint_g8b', fpp)
    d = fresh_dir(os.path.join(TMP, 'g8b'))
    dd = {k: os.path.join(d, k) for k in ('sat', 'nwp', 'oro', 'macro', 'ring')}
    for v in dd.values():
        os.makedirs(v)
    os.makedirs(os.path.join(dd['oro'], 'syn-blend'))
    shutil.copyfile(os.path.join(ROOT, 'tools', 'genus-ruler', 'macro', 'macro.py'), os.path.join(dd['macro'], 'macro.py'))
    for k, v in (('SAT', dd['sat']), ('NWP', dd['nwp']), ('ORO', dd['oro']), ('MACRO', dd['macro']), ('RING', dd['ring'])):
        setattr(fpm, k, v)
    Mm = fpm.load_macro()                              # the byte copy in test-tmp
    rng = np.random.default_rng(SEED + 21)
    order = O.ring91()
    names = ['busan_2026-09-01', 'busan_2026-09-05', 'osaka_2026-09-09', 'seoul_2026-09-01']

    def u8b64(a):
        return base64.b64encode(np.round(np.clip(a, 0, 1) * 255).astype(np.uint8).tobytes()).decode('ascii')
    gate, scenes = [], {}
    for i, n in enumerate(names):
        site, dt = n.rsplit('_', 1)
        la, lo, _g = O.sites_table()[site]
        ring = [{'dist': a, 'az': b, 'cover': float(rng.uniform(0, 1))} for a, b in order]
        sc = {'site': site, 'lat': la, 'lon': lo, 'date': dt, 'grid': 256, 'cellKm': 3.0, 'ring': ring,
              'trueGrid': u8b64(rng.uniform(0, 1, (256, 256))), 'cover': 0.37, 'empty': 0.01}
        scenes[n] = sc
        sy = {k: u8b64(1 / (1 + np.exp(-1.2 * smooth_field(256, 60, SEED + 30 + 3 * i + j, 3000.0))))
              for j, k in enumerate(('syn', 'base', 'c0'))}
        sy['ms'] = 1.0
        with open(os.path.join(dd['oro'], 'syn-blend', n + '.syn.json'), 'w') as f:
            json.dump(sy, f)
        S, Bb, C0 = Mm.load_u8(sy['syn'], 256), Mm.load_u8(sy['base'], 256), Mm.load_u8(sy['c0'], 256)
        fc = np.array([r['cover'] for r in ring])
        rv, rvB = Mm.ring_values(S, ring, 256, 3.0), Mm.ring_values(Bb, ring, 256, 3.0)
        gate.append({'name': n, 'ringRmse': float(np.sqrt(((rv - fc) ** 2).mean())),
                     'ringRmseBase': float(np.sqrt(((rvB - fc) ** 2).mean())), 'betaSyn': Mm.beta_of(S, 3.0),
                     'betaC0': Mm.beta_of(C0, 3.0), 'partialSyn': float(((S > 0.1) & (S < 0.9)).mean()),
                     'betaTrue': 9.9, 'corr50Base': 0.123, 'ringRmseTrue': 0.2, 'partialTrue': 0.4})   # fake truth columns
    with open(os.path.join(dd['ring'], 'gate-blend-held.json'), 'w') as f:
        json.dump({'rows': gate}, f)
    with open(os.path.join(dd['ring'], 'modis-times.json'), 'w') as f:
        json.dump({n: {'modisTimeUtc': '2026-09-01T02:00:00Z'} for n in names + ['lisbon_2026-09-13']}, f)
    with open(os.path.join(dd['macro'], 'sat-quartiles.json'), 'w') as f:
        json.dump({'n': 4, 'quartiles': {'betaTrue': {'q25': 1.0, 'q50': 2.0, 'q75': 3.0, 'n': 4}}}, f)

    def write_bank(with_tg, cover, scene_truth=None):
        """Scene copies (bank and sat-nwp-blend) with or without trueGrid; scene_truth replaces the scene-level
        `cover`/`empty`; index.json with `cover` from cover(i); a fake PNG next to each scene (never to be opened)."""
        for n, sc in scenes.items():
            x = dict(sc) if with_tg else {k: v for k, v in sc.items() if k != 'trueGrid'}
            if scene_truth is not None:
                x.update(scene_truth)
            for dn in ('sat', 'nwp'):
                with open(os.path.join(dd[dn], n + '.json'), 'w') as f:
                    json.dump(x, f)
            _fake_png(os.path.join(dd['sat'], n + '.png'), (0, 0))
        idx = [{'name': n, 'cover': cover(i), 'skip': False, 'error': None} for i, n in enumerate(names)]
        idx += [{'name': 'x_skip', 'skip': True, 'cover': cover(9)}, {'name': 'x_err', 'error': 'timeout', 'cover': cover(8)}]
        with open(os.path.join(dd['sat'], 'index.json'), 'w') as f:
            json.dump(idx, f)

    f13_opens = []

    def run13():
        """(F1 result, F1 stdout, F3 result, F3 stdout) with F3's node run skipped (skip_run); opens kept in f13_opens."""
        prev = _REC['on']
        _REC['on'] = f13_opens
        try:
            with contextlib.redirect_stdout(io.StringIO()) as s1:
                r1 = fpm.f1()
            with contextlib.redirect_stdout(io.StringIO()) as s3:
                r3 = fpm.f3(True)
        finally:
            _REC['on'] = prev
        opened.extend(f13_opens)
        return r1, s1.getvalue(), r3, s3.getvalue()
    opened = []
    _REC['on'] = opened
    real_sub = fpm.subprocess
    try:
        real_cover = lambda i: round(0.1 + 0.07 * i, 3)                    # noqa: E731
        fake_cover = lambda i: 0.999                                       # noqa: E731
        runs = {}
        for tag, with_tg, cov, st in (('withTG', True, real_cover, None), ('noTG', False, real_cover, None),
                                      ('noTGfakeIndexCover', False, fake_cover, None),
                                      ('withTGfakeIndexCover', True, fake_cover, None),
                                      ('fakeSceneCoverEmpty', True, real_cover, {'cover': 0.0, 'empty': 0.93})):
            write_bank(with_tg, cov, st)
            runs[tag] = run13()
        f1a, f3a = runs['withTG'][0], runs['withTG'][2]
        ck(all(r[0] == f1a and r[1] == runs['withTG'][1] for r in runs.values()) and f1a['nCommon'] == 4
           and f1a['missing'] == ['lisbon_2026-09-13'] and f1a['indexSkip'] == 1 and f1a['indexError'] == 1, 'f1Independent')
        ck(all(r[2] == f3a and r[3] == runs['withTG'][3] for r in runs.values()) and f3a['nAllFiveSame'] == 4
           and f3a['nCompared'] == 4, 'f3Independent')
        ck(all(re.fullmatch(r'F1 files \d+ keys \d+ common \d+ missing \d+ extra \d+ index skip \d+ error \d+ \| nwp-blend \d+'
                            r' common \d+\n', r[1]) and re.fullmatch(r'F3 \d+/\d+ scenes with all five columns same '
                                                                     r'\(compared \d+, missing \d+\) per column \{.*\}\n', r[3])
               for r in runs.values()), 'f13CountsOnly')
        ck(f13_opens and not any(x.endswith('.png') for x in f13_opens), 'f13NoPngOpened')
        ck.kv['variants'] = len(runs)
        calls = []

        def stub_run(cmd, **kw):
            calls.append(list(cmd))
            out = cmd[cmd.index('--out') + 1]
            with open(out, 'w') as f:
                json.dump({'n': 4, 'quartiles': {'betaTrue': {'q25': 1.0, 'q50': 2.5, 'q75': 3.0, 'n': 4}}}, f)
            return subprocess.CompletedProcess(cmd, 0)
        fpm.subprocess = types.SimpleNamespace(run=stub_run, STDOUT=subprocess.STDOUT)
        del opened[:]
        with contextlib.redirect_stdout(io.StringIO()) as so2:
            f2 = fpm.f2()
        f2_opens = sorted({os.path.abspath(x) for x in opened if os.path.abspath(x).startswith(ROOT + os.sep)})
    finally:
        _REC['on'] = None
        fpm.subprocess = real_sub
    allowed = {os.path.join(dd['oro'], 'f2.log'), os.path.join(dd['oro'], 'sat-quartiles-restore.json'),
               os.path.join(dd['macro'], 'sat-quartiles.json')}
    ck(set(f2_opens) <= allowed and os.path.join(dd['macro'], 'sat-quartiles.json') in f2_opens, 'f2ReadsOnlyOutAndCommitted')
    ck(len(calls) == 1 and calls[0][2:4] == ['--truth', dd['sat']], 'f2Stubbed')
    ck(f2 == {'nLeavesOld': 5, 'nLeavesNew': 5, 'nCommon': 5, 'nSame': 4}     # leaves n, q25, q50 (differs), q75, n
       and re.fullmatch(r'F2 numeric leaves old \d+ new \d+ common \d+ same \d+\n', so2.getvalue()) is not None, 'f2CountsOnly')
    real_forbidden = [os.path.join(ROOT, *p.split('/')) for p in ('.harness/macro/sat/index.json',
                                                                 'tools/genus-ruler/macro/sat-quartiles.json',
                                                                 'tools/genus-ruler/ring/gate-blend-held.json')]
    ck(not any(os.path.abspath(x) in real_forbidden for x in opened), 'realFilesUntouched')
    ck(all(O.guard_verdict(x) is None for x in opened), 'noGuardedPath')
    return ck.result()


def _frozen_lists_inputs(frozen, root):
    """G8(c): FROZEN `files` holds oro-apply.json and oro-inputs.json with their current sha256 (L755)."""
    files = frozen.get('files') or {}
    need = [f'{ORO_REL}/oro-apply.json', f'{ORO_REL}/oro-inputs.json']
    return all(k in files and os.path.exists(os.path.join(root, *k.split('/')))
               and O.sha256_file(os.path.join(root, *k.split('/'))) == files[k] for k in need)


@test('G8c')
def t_g8c():
    """FROZEN contains the oro-apply.json and oro-inputs.json hashes (L755 (c)). FROZEN.json lists oro-test.txt (L876),
    so it is written after this file's output and the committed line is a dry structure test (mode=dry):
    (1) the judge requires both keys (oro.py FROZEN_REQUIRED); (2) a FROZEN `files` built in the S4 layout (build note 15:
    repo path → sha256) from the current committed files is accepted by oro.py's own hash check; (3) the judge's precheck
    (§9.3 ④ 2a) on the synthetic post-freeze repo of G8d refuses, at step 2a with the key named, a FROZEN that lacks
    oro-apply.json, lacks oro-inputs.json, keys them by bare file name instead of repo path, or holds a wrong sha256 —
    and accepts the valid one. When FROZEN.json exists (a run after the freeze, written elsewhere than oro-test.txt) the
    real file is checked the same way (mode=real)."""
    ck = Checks()
    R = _R()
    need = {'oro-apply.json', 'oro-inputs.json'}
    ck(set(R.FROZEN_REQUIRED) >= need, 'precheckRequires')
    cand = {f'{ORO_REL}/{x}': O.sha256_file(os.path.join(HERE, x)) for x in sorted(R.FROZEN_REQUIRED)}
    ck(R.files_hashes_ok(R.Ctx(ROOT), cand) == [] and _frozen_lists_inputs({'files': cand}, ROOT), 'currentFilesLayoutOk')
    _g8d_base()

    def fz_edit(fn):
        """FROZEN.json edited and committed; that commit is passed as the freeze commit (as G8d notFrozen), so git
        diff/status are clean and step 2a can fail only on the FROZEN content."""
        def mut(root):
            fz = _jload(_od(root, 'FROZEN.json'))
            fn(fz['files'])
            O.dump_json(fz, _od(root, 'FROZEN.json'))
            _git(root, 'commit', '-q', '-am', 'FROZEN edit (G8c)')
            return _git(root, 'rev-parse', 'HEAD')
        return mut

    def drop(k):
        return lambda files: files.pop(f'{ORO_REL}/{k}')

    def bare(files):
        for k in sorted(files):
            if k.endswith(('/oro-apply.json', '/oro-inputs.json')):
                files[k.rsplit('/', 1)[1]] = files.pop(k)

    def wrong(files):
        files[f'{ORO_REL}/oro-apply.json'] = '0' * 64
    ok, rec = _g8d_case('g8cValid')
    ck(ok and rec['steps']['2a'] and rec['2a']['notFrozen'] == [] and rec['2a']['hashMismatch'] == [], 'validAccepted')
    for tag, fn, want_nf, want_bad in (('noApply', drop('oro-apply.json'), [f'{ORO_REL}/oro-apply.json'], []),
                                       ('noInputs', drop('oro-inputs.json'), [f'{ORO_REL}/oro-inputs.json'], []),
                                       ('bareNames', bare, [f'{ORO_REL}/oro-apply.json', f'{ORO_REL}/oro-inputs.json'],
                                        ['oro-apply.json', 'oro-inputs.json']),
                                       ('wrongSha', wrong, [], [f'{ORO_REL}/oro-apply.json'])):
        ok, rec = _g8d_case('g8c' + tag, fz_edit(fn))
        bad = sorted(k for k, v in rec['steps'].items() if not v)
        ck(not ok and '2a' in bad and set(bad) <= {'2a', '5', 'tread'} and rec['2a']['git'] == 'ok'
           and rec['2a']['notFrozen'] == want_nf and rec['2a']['hashMismatch'] == want_bad, f'{tag}Refused')
    fz = os.path.join(HERE, 'FROZEN.json')
    if os.path.exists(fz):
        ck(_frozen_lists_inputs(_jload(fz), ROOT), 'realFrozen')
    ck.kv['mode'] = 'real' if os.path.exists(fz) else 'dry'
    return ck.result()


# ── G8(d): synthetic git repos ──
RULER_SYN = (b'# RULER synthetic (G8d)\n## 0. rules\nrule text\n## 9. freeze\nlist\n## 10. records\n### 10.1 freeze\n'
             b'### 10.2 guards\n### 10.3 judgement\n## 11. answers\nend\n')
G8D_OLD = ('tools/genus-ruler/macro/macro.py', 'tools/genus-ruler/macro/fetch-sat.py',
           'tools/genus-ruler/ring/fetch-nwp-ring.py')


def _git(root, *args):
    r = subprocess.run(['git', '-c', 'user.name=oro-test', '-c', 'user.email=oro-test@example.invalid', '-c',
                        'commit.gpgsign=false', *args], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'git {args[0]} exit {r.returncode}')
    return r.stdout.strip()


def _g8d_ok(ctx, frozen, ip):
    return {'ok': True, 'mode': 'test', 'baseDir': ctx.base, 'checkSha': True}


def _g8d_bad(ctx, frozen, ip):
    return {'ok': False, 'mode': 'test-diff'}


def _g8d_base():
    """A synthetic post-freeze repo: B-SYN inputs (sealed, synthetic B), real dem-grids/cmr-geom, oro-apply filled by
    oro.py, a fake bank (allow-list fields + fake trueGrid = clip(B + ΔC), fake PNG) for the counted and dev judge scenes
    with its bank-manifest, a synthetic ruler, FROZEN.json at the freeze commit, then guards-oro.json + §10.2 hashes."""
    if 'g8d' in _FIX:
        return _FIX['g8d']
    R = _R()
    fx = _fixture_syn()
    root = fresh_dir(os.path.join(G8D, 'base'))
    od = os.path.join(root, *ORO_REL.split('/'))
    os.makedirs(od)
    inputs, dg = _jload(fx['inputs']), _jload(DEM_GRIDS_P)
    shutil.copyfile(fx['inputs'], os.path.join(od, 'oro-inputs.json'))
    shutil.copyfile(DEM_GRIDS_P, os.path.join(od, 'dem-grids.json'))
    shutil.copyfile(os.path.join(HERE, 'cmr-geom.json'), os.path.join(od, 'cmr-geom.json'))
    app = _jload(fx['apply'])
    R.fill_apply_doc(app, inputs, dg, fx['base'], O.sha256_file(os.path.join(HERE, 'oro.py')))
    O.dump_json(app, os.path.join(od, 'oro-apply.json'))
    os.makedirs(os.path.join(root, '.harness', 'oro'))
    os.symlink(fx['base'], os.path.join(root, '.harness', 'oro', 'base'))
    bank = os.path.join(root, '.harness', 'macro', 'sat')
    os.makedirs(bank)
    cache = O.SiteCache(dg)
    want = sorted(n for n, r in app['scenes'].items() if r['counted'] or (r['group'] == 'dev' and r['judge']))
    for n in want:
        sc = inputs['scenes'][n]
        p = R.prep_scene(n, sc, app['scenes'][n], cache.get(sc['site']), {'dir': fx['base'], 'checkSha': True})
        _fake_files(bank, n, sc['site'], sc['lat'], sc['lon'], sc['date'], p['Bs']['total'] + p['cj']['dC'], (0, 0))
    with contextlib.redirect_stdout(io.StringIO()):
        man = O.bank_manifest_doc(['orig'], table=lambda b: dict(O.bank_table(b), dir=O.rel(bank)))
    O.dump_json(man, os.path.join(od, 'bank-manifest.json'))
    with open(os.path.join(od, 'x.py'), 'w') as f:
        f.write('X = 1\n')
    with open(os.path.join(od, 'RULER-oro.md'), 'wb') as f:
        f.write(RULER_SYN)
    with open(os.path.join(root, '.gitignore'), 'w') as f:
        f.write('.harness/\n')
    # FROZEN `old` (§9.2, build note 15 layout {repo path: sha256}): byte copies of the three tools the judge executes;
    # the src/ and volsky entries (G1-baseline-commit hashes) name no file here and must be skipped by ④ 2
    for rel in G8D_OLD:
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, rel), os.path.join(root, rel))
    old = {rel: O.sha256_file(os.path.join(root, rel)) for rel in G8D_OLD}
    old.update({'src/utils/macroField.ts': '0' * 64, 'tools/genus-ruler/volsky/run.js': '0' * 64})
    frozen_files = ('RULER-oro.md', 'oro-inputs.json', 'oro-apply.json', 'dem-grids.json', 'cmr-geom.json',
                    'bank-manifest.json', 'x.py')
    frozen = {'files': {f'{ORO_REL}/{x}': O.sha256_file(os.path.join(od, x)) for x in frozen_files}, 'old': old,
              'versions': R.versions_ok({})[1]['running'],
              'decisions': {'primaryMetric': app['summary']['primaryMetric'], 'lambdaTilde': app['summary']['lambdaTilde']},
              'exposure': {'grade': '없음'}, 'rulerHash': R.ruler_hash(os.path.join(od, 'RULER-oro.md')),
              'runtime': {'bCommit': 'synthetic'}, 'gateFilesAtFreeze': []}
    O.dump_json(frozen, os.path.join(od, 'FROZEN.json'))
    _git(root, 'init', '-q', '-b', 'main')
    _git(root, 'add', '-A')
    _git(root, 'commit', '-q', '-m', 'freeze')
    freeze = _git(root, 'rev-parse', 'HEAD')
    with open(os.path.join(od, 'oroLift.ts'), 'w') as f:
        f.write('export const oro = 1;\n')
    h = O.sha256_file(os.path.join(od, 'oroLift.ts'))
    O.dump_json({'guards': {f'G{i}': {'status': 'PASS'} for i in range(1, 10)}, 'hashes': {f'{ORO_REL}/oroLift.ts': h}},
                os.path.join(od, 'guards-oro.json'))
    with open(os.path.join(od, 'RULER-oro.md'), 'wb') as f:
        f.write(RULER_SYN.replace(b'### 10.2 guards\n', b'### 10.2 guards\noroLift.ts ' + h.encode('ascii') + b'\n'))
    _git(root, 'add', '-A')
    _git(root, 'commit', '-q', '-m', 'post-freeze: G5 hashes')
    _FIX['g8d'] = {'root': root, 'freeze': freeze, 'counted': sum(1 for r in app['scenes'].values() if r['counted'])}
    return _FIX['g8d']


def _g8d_copy(tag):
    base = _g8d_base()
    root = os.path.join(G8D, tag)
    shutil.rmtree(root, ignore_errors=True)
    shutil.copytree(base['root'], root, symlinks=True)
    return root


def _g8d_case(tag, mutate=None, b_checker=_g8d_ok, env=False):
    R = _R()
    root = _g8d_copy(tag)
    fc = mutate(root) if mutate else None
    ok, rec = R.precheck(R.Ctx(root, fc), b_checker=b_checker, env_check=env)
    shutil.rmtree(root, ignore_errors=True)
    return ok, rec


def _od(root, *x):
    return os.path.join(root, *ORO_REL.split('/'), *x)


def _write(p, s, mode='w'):
    with open(p, mode) as f:
        f.write(s)


@test('G8d')
def t_g8d():
    """The judge runs only when the §9.3 ④ conditions hold (L755 (d), L896-L913): a valid synthetic repo passes every
    step; each violation is refused at its own step without a lock (incl. an edited FROZEN `old` tool, ④ 2); ④ 5's
    rebuild branch asks for the pinned node first and records max|ΔB| per scene · time · band · n; the CLI --judge refuses
    with exit 2 and writes no lock; the full judge then runs end to end on the synthetic repo (lock → T → one write, stdout
    T-free progress only; stop → judge-stop.json; rerun via judge.lock.1 → judge-pret.1.json / judge-stop.1.json, never
    over the first run's records), never opening a real bank path. The real repo is only --precheck'ed: before the freeze
    it is refused for the missing FROZEN.json; after it (§9.3 ② re-measure, build note 26) the CLI must print CHECK /
    PRECHECK lines only and leave no lock or gate — that branch is exercised now on a synthetic frozen copy."""
    ck = Checks()
    R = _R()
    with _record_opens('G8d') as opened:
        base = _g8d_base()
        ok, rec = _g8d_case('baseline', env=True)
        ck(ok and all(rec['steps'].values()) and rec['tread']['bankDiffs'] == [] and rec['env']['recompute']['identical']
           and rec['2a']['oldHashMismatch'] == [] and rec['2a']['oldNotFrozen'] == [], 'baselinePasses')
        ck.kv['steps'] = ','.join(sorted(rec['steps']))

        def side(root):
            _git(root, 'checkout', '-q', '-b', 'side')
            _write(os.path.join(root, 'side.txt'), 's\n')
            _git(root, 'add', '-A')
            _git(root, 'commit', '-q', '-m', 'side')
            h = _git(root, 'rev-parse', 'HEAD')
            _git(root, 'checkout', '-q', 'main')
            return h

        def commit_x(root):
            _write(_od(root, 'x.py'), 'X = 2\n')
            _git(root, 'commit', '-q', '-am', 'edit frozen')

        def worktree_x(root):
            _write(_od(root, 'x.py'), 'X = 2\n')

        def frozen_json(root):
            fz = _jload(_od(root, 'FROZEN.json'))
            fz['note'] = 'edited'
            O.dump_json(fz, _od(root, 'FROZEN.json'))
            _git(root, 'commit', '-q', '-am', 'edit FROZEN')

        def not_frozen(root):
            fz = _jload(_od(root, 'FROZEN.json'))
            del fz['files'][f'{ORO_REL}/oro-inputs.json']
            O.dump_json(fz, _od(root, 'FROZEN.json'))
            _git(root, 'commit', '-q', '-am', 'FROZEN without oro-inputs')
            return _git(root, 'rev-parse', 'HEAD')

        def old_edit(root):
            # a post-freeze edit of an `old` tool the judge executes (macro.py decodes T and computes c4·c5): it is not
            # in FROZEN `files`, so git diff (④ 2a) is clean and only the `old` hash check can refuse
            _write(os.path.join(root, *G8D_OLD[0].split('/')), '\n# edited after freeze\n', 'a')
            _git(root, 'commit', '-q', '-am', 'edit old macro.py')

        def old_unlisted(root):
            fz = _jload(_od(root, 'FROZEN.json'))
            del fz['old'][G8D_OLD[0]]
            O.dump_json(fz, _od(root, 'FROZEN.json'))
            _git(root, 'commit', '-q', '-am', 'FROZEN without old macro.py')
            return _git(root, 'rev-parse', 'HEAD')

        def ext(root, wrong_sha=False, later_edit=False):
            _write(_od(root, 'x2.py'), 'Y = 1\n')
            h = '0' * 64 if wrong_sha else O.sha256_file(_od(root, 'x2.py'))
            O.dump_json({'files': {f'{ORO_REL}/x2.py': h}}, _od(root, 'FROZEN-ext1.json'))
            _git(root, 'add', '-A')
            _git(root, 'commit', '-q', '-m', 'FROZEN-ext1')
            if later_edit:
                fz = _jload(_od(root, 'FROZEN-ext1.json'))
                fz['note'] = 'edited'
                O.dump_json(fz, _od(root, 'FROZEN-ext1.json'))
                _git(root, 'commit', '-q', '-am', 'edit ext')

        def ruler(root):
            p = _od(root, 'RULER-oro.md')
            with open(p, 'rb') as f:
                b = f.read()
            _write(p, b.replace(b'rule text', b'rule text changed'), 'wb')
            _git(root, 'commit', '-q', '-am', 'ruler')

        def ruler_sec10(root):
            p = _od(root, 'RULER-oro.md')
            with open(p, 'rb') as f:
                b = f.read()
            _write(p, b.replace(b'### 10.3 judgement\n', b'### 10.3 judgement\nrecord appended after freeze\n'), 'wb')
            _git(root, 'commit', '-q', '-am', 'ruler §10 record')

        def impl(root):
            _write(_od(root, 'oroLift.ts'), 'export const oro = 2;\n')

        def impl_not102(root):
            g = _jload(_od(root, 'guards-oro.json'))
            g['hashes'][f'{ORO_REL}/x.py'] = O.sha256_file(_od(root, 'x.py'))
            O.dump_json(g, _od(root, 'guards-oro.json'))

        def no_guards(root):
            os.remove(_od(root, 'guards-oro.json'))

        def gate(root):
            _write(_od(root, 'gate-oro-held.json'), '{}\n')

        def lock(root):
            _write(_od(root, 'judge.lock'), 'x\n')

        def lock1(root):
            _write(_od(root, 'judge.lock.1'), 'x\n')

        app = _jload(_od(base['root'], 'oro-apply.json'))
        cnt = sorted(n for n, r in app['scenes'].items() if r['counted'])

        def no_png(root):
            os.remove(os.path.join(root, '.harness', 'macro', 'sat', cnt[0] + '.png'))

        def bank_diff(root):
            p = os.path.join(root, '.harness', 'macro', 'sat', cnt[0] + '.json')
            sc = _jload(p)
            sc['extra'] = 1
            with open(p, 'w') as f:
                json.dump(sc, f)

        cases = [('1', 'notAncestor', side, {}), ('2a', 'frozenFileCommitted', commit_x, {}),
                 ('2a', 'frozenFileWorktree', worktree_x, {}), ('2a', 'frozenJsonEdited', frozen_json, {}),
                 ('2a', 'notFrozen', not_frozen, {}), ('2a', 'oldMacroEdited', old_edit, {}),
                 ('2a', 'oldNotListed', old_unlisted, {}), ('2b', 'extEdited', lambda r: ext(r, later_edit=True), {}),
                 ('6', 'extWrongSha', lambda r: ext(r, wrong_sha=True), {}), ('3', 'rulerEdited', ruler, {}),
                 ('4', 'implChanged', impl, {}), ('4', 'implNotIn10_2', impl_not102, {}), ('4', 'noGuardsRecord', no_guards, {}),
                 ('5', 'bRebuildDiffers', None, {'b_checker': _g8d_bad}), ('7', 'gateExists', gate, {}),
                 ('7', 'lockExists', lock, {}), ('tread', 'missingPng', no_png, {})]
        for step, tag, mut, kw in cases:
            ok, rec = _g8d_case(tag, mut, **kw)
            bad = sorted(k for k, v in rec['steps'].items() if not v)
            exp_bad = {step, 'tread'} | ({'5'} if step in ('1', '2a', '2b', '3', '4', '6', '7') else set())
            ck(not ok and step in bad and set(bad) <= exp_bad, f'{tag}:refusedAt{step}')
            if tag == 'notFrozen':
                ck(rec['2a']['notFrozen'] == [f'{ORO_REL}/oro-inputs.json'] and rec['2a']['git'] == 'ok', 'notFrozenReason')
            if tag == 'oldMacroEdited':
                ck(rec['2a']['oldHashMismatch'] == [G8D_OLD[0]] and rec['2a']['git'] == 'ok' and rec['2a']['hashMismatch'] == []
                   and rec['2a']['notFrozen'] == [], 'oldMacroReason')
            if tag == 'oldNotListed':
                ck(rec['2a']['oldNotFrozen'] == [G8D_OLD[0]] and rec['2a']['git'] == 'ok', 'oldNotListedReason')
        ok, rec = _g8d_case('rulerSec10', ruler_sec10)
        ck(ok, 'section10AppendAllowed')
        ok, rec = _g8d_case('rerunMode', lock1)
        ck(ok and rec['rerun'], 'lock1RerunMode')
        devj = sorted(n for n, r in app['scenes'].items() if r['group'] == 'dev' and r['judge'])
        if devj:
            ok, rec = _g8d_case('devPngMissing', lambda root: os.remove(os.path.join(root, '.harness', 'macro', 'sat',
                                                                                      devj[0] + '.png')))
            ck(ok and rec['tread']['devMissing'] == [devj[0]] and not rec['tread']['missingPng'], 'devMissingIsReportOnly')
        ck.kv['devJudge'] = len(devj)
        ok, rec = _g8d_case('bankDiff', bank_diff)
        ck(ok and rec['tread']['bankDiffs'] == [cnt[0]] and rec['tread']['nDiffs'] == 1, 'bankDiffRecordedNotRefused')
        fz = _jload(_od(base['root'], 'FROZEN.json'))
        ck(not R.versions_ok(dict(fz, versions=dict(fz['versions'], numpy='0.0.0')))[0]
           and not R.env_precheck(R.Ctx(base['root']), dict(fz, versions=dict(fz['versions'], numpy='0.0.0')))['ok'],
           'versionsRefused')
        root = _g8d_copy('recompute')
        ap = _od(root, 'oro-apply.json')
        a = _jload(ap)
        n0 = cnt[0]
        a['scenes'][n0]['m8']['rmsDC'] += 1e-6
        O.dump_json(a, ap)
        e = R.env_precheck(R.Ctx(root), fz)
        ck(not e['ok'] and e['recompute']['maxAbsFloat'] > 9e-7 and e['recompute']['nFloatDiffs'] == 1
           and not e['recompute']['flagDiffs'], 'recomputeFloat')
        a['scenes'][n0]['m8']['rmsDC'] -= 1e-6
        a['scenes'][n0]['A8']['ok'] = not a['scenes'][n0]['A8']['ok']
        O.dump_json(a, ap)
        e = R.env_precheck(R.Ctx(root), fz)
        ck(not e['ok'] and e['recompute']['flagDiffs'] == [f'/scenes/{n0}/A8/ok'], 'recomputeFlag')
        shutil.rmtree(root, ignore_errors=True)
        _g8d_b5(ck, R)
        # CLI refusals (no lock written); the real repo is only prechecked
        root = _g8d_copy('cli')
        try:
            gate(root)
            r = _run_oro(['--judge', '--root', root], check=False)
            ck(r.returncode == 2 and r.stdout.startswith('REFUSE') and not os.path.exists(_od(root, 'judge.lock'))
               and os.path.exists(_od(root, 'judge-refused.json')), 'cliJudgeRefuses')
        finally:
            shutil.rmtree(root, ignore_errors=True)
        real_ok, mode = _precheck_cli_ok(ROOT)
        ck(real_ok, 'realRepoPrecheckRefuses' if mode == 'dry' else 'realRepoPrecheckFrozenForm')
        ck.kv['realPrecheck'] = mode
        root = _g8d_copy('cliFrozen')           # the post-freeze branch of the line above, on a synthetic frozen repo
        try:
            syn_ok, syn_mode = _precheck_cli_ok(root)
            ck(syn_ok and syn_mode == 'frozen', 'frozenBranchSelfTest')
        finally:
            shutil.rmtree(root, ignore_errors=True)
        # end to end on the synthetic repo
        root = _g8d_copy('e2e')
        try:
            ctx = R.Ctx(root)
            with contextlib.redirect_stdout(io.StringIO()) as so:
                rc = R.run_judge(ctx, b_checker=_g8d_ok)
            g = _jload(ctx.gate) if os.path.exists(ctx.gate) else {}
            ck(rc == 0 and os.path.exists(ctx.lock) and os.path.exists(_od(root, 'judge-pret.json'))
               and g.get('pret', {}).get('file') == 'judge-pret.json', 'e2eWrote')
            ck(set(g.get('clauses', {})) == {'c1', 'c2', 'c2b', 'c3', 'c3b', 'c4', 'c5', 'c6', 'c7', 'c8'}
               and g['action']['line'] in ('1', '2', '3-1', '3-2', '3-3', '3-4', '3-5', '4', '5', '6'), 'e2eClauses')
            st = g.get('stats', {})
            ck(st and st['rhoRes']['value'] >= 0.99 and st['d']['value'] > 0 and g['judged']['c1']['n'] == len(g['judged']['names'])
               and set(g['judged']['names']) <= set(cnt), 'e2eValues')
            ck(len(g.get('sensitivity', {})) == 29 + 7 and g['sensitivity']['ecmwf'] == {'status': '못 잼'}, 'e2eArms')
            lines = so.getvalue().splitlines()
            # stdout: progress counters over the T-free prepared list only (L914); no judged / G-shuf counts
            ck(all(re.fullmatch(r'(PRET \S+ sha256 [0-9a-f]{64}|LOCK written|PREP \d+|TRUTH \d+/\d+|METRICS done'
                                r'|GSHUF done|ARMS|WROTE \S+ sha256 [0-9a-f]{64})', x) for x in lines), 'e2eStdoutProgressOnly')
            ck([x.split()[0] for x in lines][:3] == ['PRET', 'PREP', 'LOCK'], 'e2ePrepBeforeLock')
            ck.kv.update({'e2eJudged': len(g.get('judged', {}).get('names', [])), 'e2eLine': g.get('action', {}).get('line'),
                          'e2eVerdict': g.get('action', {}).get('verdict')})
            with contextlib.redirect_stdout(io.StringIO()):
                ck(R.run_judge(ctx, b_checker=_g8d_ok) == 2, 'e2eSecondRunRefused')
        finally:
            shutil.rmtree(root, ignore_errors=True)
        _g8d_stop_rerun(ck, R)
    ck(not os.path.exists(O.JUDGE_LOCK) and not os.path.exists(os.path.join(HERE, 'gate-oro-held.json'))
       and not os.path.exists(os.path.join(HERE, 'judge-refused.json')), 'noRealLockOrGate')
    ck(all(O.guard_verdict(x) is None for x in opened), 'noRealBankOpened')
    ck(not _judge_files_under(G8D), 'noLockOrGateLeftInTestTmp')
    return ck.result()


def _judge_files_under(top):
    """judge.lock(.1) / gate-oro-* / judge record files left under top (test temp dirs must not keep any)."""
    out = []
    for dp, dns, fns in os.walk(top):
        dns[:] = sorted(x for x in dns if x != '.git')
        out += [os.path.join(dp, f) for f in sorted(fns) if f.startswith(('judge.lock', 'gate-oro', 'judge-'))]
    return out


def _precheck_cli_ok(root):
    """`oro.py --precheck --root <root>` (a subprocess). Before the freeze (no FROZEN.json): exit 1 and 'CHECK frozen FAIL'.
    After it (§9.3 ② re-measure of G8): exit 0 or 1, every stdout line a CHECK/PRECHECK status line, the last one PRECHECK,
    and no judge.lock / gate-oro-held.json afterwards (the precheck never locks or reads T). Returns (ok, 'dry'|'frozen')."""
    r = _run_oro(['--precheck', '--root', root], check=False)
    if not os.path.exists(_od(root, 'FROZEN.json')):
        return r.returncode == 1 and 'CHECK frozen FAIL' in r.stdout, 'dry'
    lines = r.stdout.splitlines()
    ok = (r.returncode in (0, 1) and bool(lines) and lines[-1].startswith('PRECHECK ')
          and all(re.fullmatch(r'CHECK \S+ (ok|FAIL)|PRECHECK (ok|FAIL)( rerun)?', x) for x in lines)
          and not os.path.exists(_od(root, 'judge.lock')) and not os.path.exists(_od(root, 'gate-oro-held.json')))
    return ok, 'frozen'


def _g8d_b5(ck, R):
    """§9.3 ④ 5 (L904-L907) in oro.py default_b_check, with oro-base.mjs stubbed (no node run): after a failed --check,
    (i) a running node other than FROZEN versions.node stops with mode 'node-version' before any rebuild (environment fix);
    (ii) with the pinned node the rebuild is compared per scene · time · band · n (`maxAbsDBPer`, every recorded B), all
    ≤ 1e-6 → ok, one key above → refused; the table is the precheck's step-5 record (judge-pret.json / judge-refused.json)."""
    root = _g8d_copy('b5')
    fx = _fixture_syn()
    real_sp = R.subprocess
    calls = []

    def stub(node_ver, bump):
        def run(args, **kw):
            calls.append(list(args))
            if list(args[:2]) == ['node', '--version']:
                return types.SimpleNamespace(returncode=0, stdout=node_ver + '\n', stderr='')
            if '--check' in args:
                return types.SimpleNamespace(returncode=1, stdout='', stderr='')
            out = args[args.index('--out') + 1]
            for fn in sorted(os.listdir(fx['base'])):
                if fn.endswith('.f32') and fn != bump[0]:
                    os.symlink(os.path.join(fx['base'], fn), os.path.join(out, fn))
            with open(os.path.join(fx['base'], bump[0]), 'rb') as f:
                a = np.frombuffer(f.read(), dtype='<f4').copy()
            a[0] = np.float32(np.float64(a[0]) + bump[1])
            with open(os.path.join(out, bump[0]), 'wb') as f:
                f.write(a.astype('<f4').tobytes())
            return types.SimpleNamespace(returncode=0, stdout='', stderr='')
        return run
    try:
        ctx = R.Ctx(root)
        ip = _od(root, 'oro-inputs.json')
        inp = _jload(ip)
        keys = []
        for sc in sorted(inp['scenes']):
            for tk, tm in sorted(inp['scenes'][sc]['times'].items()):
                for b in BANDS:
                    if (tm.get('bSha256') or {}).get(b) is not None:
                        keys.append((f'{sc}|{tk}|{b}|n128', f'{sc}__{tk}__{b}.f32'))
                    if tk == 'closest' and (tm.get('bSha256n64') or {}).get(b) is not None:
                        keys.append((f'{sc}|{tk}|{b}|n64', f'{sc}__{tk}__{b}__n64.f32'))
        k0, f0 = keys[len(keys) // 2]
        fz = {'versions': {'node': 'v22.23.4'}, 'runtime': {'bCommit': 'synthetic'}}
        R.subprocess = types.SimpleNamespace(run=stub('v20.0.0', (f0, 0.0)))
        r0 = R.default_b_check(ctx, fz, ip)
        ck(r0['ok'] is False and r0['mode'] == 'node-version' and r0['nodeFrozen'] == 'v22.23.4'
           and not any('--out' in c for c in calls), 'b5NodeVersionFirst')
        res = {}
        for tag, dv in (('within', 4e-7), ('exceeds', 1e-4)):
            R.subprocess = types.SimpleNamespace(run=stub('22.23.4', (f0, dv)))
            res[tag] = R.default_b_check(ctx, fz, ip)
        a, b = res['within'], res['exceeds']
        per_ok = (sorted(a.get('maxAbsDBPer') or {}) == sorted(k for k, _ in keys)
                  and all(v == 0.0 for k, v in a['maxAbsDBPer'].items() if k != k0))
        ck(a['ok'] is True and a['mode'] == 'rebuild' and a['checkSha'] is False and per_ok
           and 1e-7 < a['maxAbsDBPer'][k0] <= 1e-6 and a['maxAbsDB'] == a['maxAbsDBPer'][k0] and a['nNotCompared'] == 0,
           'b5PerKeyWithin')
        ck(b['ok'] is False and b['maxAbsDBPer'][k0] > 1e-6 and b['maxAbsDB'] == b['maxAbsDBPer'][k0], 'b5PerKeyExceeds')
        ck.kv['b5Keys'] = len(keys)
    finally:
        R.subprocess = real_sp
        shutil.rmtree(root, ignore_errors=True)


def _g8d_stop_rerun(ck, R):
    """Stop after the lock → judge-stop.json (exception type only); the one environment-only rerun via judge.lock.1 writes
    judge-pret.1.json / judge-stop.1.json (mode 'x') with the first run's record hashes, never over the first run's files
    (L916-L919, build note 17); a double stop is 미결; a rerun whose record already exists is refused without a lock."""
    root = _g8d_copy('stop')
    try:
        ctx = R.Ctx(root)
        bankd = os.path.join(root, '.harness', 'macro', 'sat')
        stop_args = dict(truth_fn=lambda n: os.path.join(bankd, n + '.json'),
                         png_fn=lambda n: os.path.join(bankd, n + '.absent.png'))
        with contextlib.redirect_stdout(io.StringIO()):
            rc = R.run_judge(ctx, b_checker=_g8d_ok, **stop_args)
        sp, pp = _od(root, 'judge-stop.json'), _od(root, 'judge-pret.json')
        stop = _jload(sp) if os.path.exists(sp) else {}
        ck(rc == 3 and stop.get('exception') == 'FileNotFoundError' and stop.get('rerun') is False
           and not os.path.exists(ctx.gate) and os.path.exists(ctx.lock), 'stopRecorded')
        first = {p: read_bytes(p) for p in (sp, pp) if os.path.exists(p)}
        os.rename(ctx.lock, ctx.lock1)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = R.run_judge(ctx, b_checker=_g8d_ok, **stop_args)
        sp1, pp1 = _od(root, 'judge-stop.1.json'), _od(root, 'judge-pret.1.json')
        stop1 = _jload(sp1) if os.path.exists(sp1) else {}
        pret1 = _jload(pp1) if os.path.exists(pp1) else {}
        fr = {'judgePretSha256': sha(first.get(pp, b'')), 'judgeStopSha256': sha(first.get(sp, b''))}
        ck(rc == 3 and stop1.get('rerun') is True and stop1.get('verdict') == '미결(판정 실행 두 번 멈춤)'
           and stop1.get('firstRun') == fr and pret1.get('firstRun') == fr and pret1.get('rerun') is True, 'doubleStopRecorded')
        ck(len(first) == 2 and all(read_bytes(p) == b for p, b in first.items()), 'firstRunRecordsKept')
    finally:
        shutil.rmtree(root, ignore_errors=True)
    root = _g8d_copy('rerun')
    try:
        ctx = R.Ctx(root)
        _write(ctx.lock1, 'HEAD x\n')                     # the first run stopped after its lock (judge.lock → judge.lock.1)
        _write(_od(root, 'judge-stop.json'), '{"exception": "MemoryError"}\n')
        fst = O.sha256_file(_od(root, 'judge-stop.json'))

        def b5_rec(c, frozen, ip):
            return {'ok': True, 'mode': 'rebuild', 'maxAbsDBPer': {'s|closest|total|n128': 0.0}, 'maxAbsDB': 0.0,
                    'baseDir': c.base, 'checkSha': True}
        with contextlib.redirect_stdout(io.StringIO()):
            rc = R.run_judge(ctx, b_checker=b5_rec)
        g = _jload(ctx.gate) if os.path.exists(ctx.gate) else {}
        pret1 = _jload(_od(root, 'judge-pret.1.json')) if os.path.exists(_od(root, 'judge-pret.1.json')) else {}
        ck(rc == 0 and g.get('pret', {}).get('rerun') is True and g['pret'].get('file') == 'judge-pret.1.json'
           and g['pret'].get('sha256') == O.sha256_file(_od(root, 'judge-pret.1.json'))
           and not os.path.exists(_od(root, 'judge-pret.json')), 'rerunViaLock1')
        ck(pret1.get('firstRun') == {'judgePretSha256': None, 'judgeStopSha256': fst}
           and pret1.get('5', {}).get('maxAbsDBPer') == {'s|closest|total|n128': 0.0}, 'rerunPretRecords')
    finally:
        shutil.rmtree(root, ignore_errors=True)
    root = _g8d_copy('rerunExists')
    try:
        ctx = R.Ctx(root)
        _write(ctx.lock1, 'HEAD x\n')
        _write(_od(root, 'judge-pret.1.json'), '{}\n')
        before = read_bytes(_od(root, 'judge-pret.1.json'))
        with contextlib.redirect_stdout(io.StringIO()) as so:
            rc = R.run_judge(ctx, b_checker=_g8d_ok)
        ck(rc == 2 and so.getvalue().startswith('REFUSE record-exists') and not os.path.exists(ctx.lock)
           and read_bytes(_od(root, 'judge-pret.1.json')) == before, 'rerunRecordNeverReplaced')
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _g8e_eval(root):
    """G8(e) on the repo at root (L755 (e), L890). Before the freeze (no FROZEN.json): the live tree has no gate-oro-*,
    judge.lock(.1) and no C4 satellite dir .harness/regime/sat*. After it (§9.3 ② re-measure, build note 26; the C4 held
    satellites arrive after the freeze commit, §9.1 ⑩): FROZEN gateFilesAtFreeze == [] and the freeze commit's tree
    (`git ls-tree -r --name-only`, names only, C4) holds no gate-oro-*, judge.lock, judge.lock.1; the live state is recorded
    as kv only. Returns (failed check names, kv)."""
    od = os.path.join(root, *ORO_REL.split('/'))
    fz = os.path.join(od, 'FROZEN.json')
    reg = os.path.join(root, '.harness', 'regime')
    c4 = sorted(f for f in os.listdir(reg) if f.startswith('sat')) if os.path.isdir(reg) else []
    gates = sorted(f for f in os.listdir(od) if f.startswith('gate-oro')) if os.path.isdir(od) else []
    locks = [f for f in ('judge.lock', 'judge.lock.1') if os.path.exists(os.path.join(od, f))]
    if not os.path.exists(fz):
        return [n for n, bad in (('noGateOro', gates), ('noLock', locks), ('noC4Satellite', c4)) if bad], {'frozen': False}
    fails = []
    if _jload(fz).get('gateFilesAtFreeze') != []:
        fails.append('frozenGateFilesEmpty')
    fc = _R().frozen_commit_of(_R().Ctx(root), f'{ORO_REL}/FROZEN.json')
    if not fc:
        fails.append('freezeCommitFound')
    else:
        r = subprocess.run(['git', 'ls-tree', '-r', '--name-only', fc], cwd=root, capture_output=True, text=True)
        names = [x.rsplit('/', 1)[-1] for x in r.stdout.splitlines()]
        if r.returncode != 0 or any(x.startswith('gate-oro') or x in ('judge.lock', 'judge.lock.1') for x in names):
            fails.append('freezeTreeClean')
    return fails, {'frozen': True, 'liveC4Satellite': bool(c4), 'liveGateOro': len(gates), 'liveLock': len(locks)}


@test('G8e')
def t_g8e():
    """At freeze: no C4 satellite files (.harness/regime/sat*), no gate-oro-*, no judge.lock(.1) (L755 (e), L890) — the
    live tree before the freeze, FROZEN gateFilesAtFreeze + the freeze commit's tree after it (_g8e_eval). The post-freeze
    branch (oro-test.py is FROZEN and cannot change at S7) is exercised now on two tiny synthetic frozen repos: a clean one
    with a live .harness/regime/sat dir passes, one whose freeze commit holds a judge.lock fails."""
    ck = Checks()
    fails, kv = _g8e_eval(ROOT)
    for n in fails:
        ck(False, n)
    ck.kv.update(kv)
    d = fresh_dir(os.path.join(TMP, 'g8e'))
    try:
        for tag, extra, want in (('clean', None, []), ('lockInFreeze', 'judge.lock', ['freezeTreeClean'])):
            root = os.path.join(d, tag)
            os.makedirs(os.path.join(root, *ORO_REL.split('/')))
            os.makedirs(os.path.join(root, '.harness', 'regime', 'sat'))
            _write(os.path.join(root, '.gitignore'), '.harness/\n')
            O.dump_json({'files': {}, 'gateFilesAtFreeze': []}, _od(root, 'FROZEN.json'))
            if extra:
                _write(_od(root, extra), 'x\n')
            _git(root, 'init', '-q', '-b', 'main')
            _git(root, 'add', '-A')
            _git(root, 'commit', '-q', '-m', 'freeze')
            if extra:
                _git(root, 'rm', '-q', _od(root, extra))
                _git(root, 'commit', '-q', '-m', 'after freeze')
            f2, kv2 = _g8e_eval(root)
            ck(f2 == want and kv2.get('liveC4Satellite') is True, f'frozenBranchSelfTest:{tag}')
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return ck.result()


@test('G8f')
def t_g8f():
    """The open guard is armed during G6 (f)(g)(h) and none of them opened (or tried to open) a real scene JSON, PNG,
    index, quartile or gate path (L755 (f)); the judge's truth/PNG decoders refuse real bank paths without the lock."""
    ck = Checks()
    R = _R()
    ck(O.guard_installed() and R.O is O, 'guardArmed')
    tmp_root = os.path.abspath(TMP) + os.sep
    allow_keys = {'site', 'lat', 'lon', 'date', 'grid', 'cellKm', 'ring', 'trueGrid'}      # L768: allow-list + T_fake
    for tag, fn in (('G6f', t_g6f), ('G6g', t_g6g), ('G6h', t_g6h)):
        if tag not in _G6_OPENS:
            fn()
        opens = _G6_OPENS[tag] + (_G6_OPENS.get('G6fDry') or [] if tag == 'G6f' else [])
        bad = [p for p in opens if O.guard_verdict(p) is not None]
        ck(not bad, f'{tag}:noRealBankOpen')
        # every JSON / PNG the test opened lies in test-tmp, except the committed MODIS-free inputs (oro-apply,
        # oro-inputs, dem-grids); B files (.f32) are MODIS-free too
        js = sorted({os.path.abspath(p) for p in opens if p.endswith(('.json', '.png'))} - set(G8F_COMMITTED_OK))
        ck(all(p.startswith(tmp_root) for p in js), f'{tag}:sceneFilesInTmp')
        ck.kv[f'{tag}Opens'] = len(opens)
    # the fake scene JSONs written by G6 (f)(g)(h) carry only allow-list fields and T_fake (no cover/empty, no ring cover)
    nj, keys_ok = 0, True
    for sub in sorted(os.listdir(T_G6)) if os.path.isdir(T_G6) else []:
        for fnm in sorted(os.listdir(os.path.join(T_G6, sub))):
            if fnm.endswith('.json'):
                sc = _jload(os.path.join(T_G6, sub, fnm))
                nj += 1
                keys_ok &= set(sc) <= allow_keys and all(set(x) <= {'dist', 'az'} for x in sc.get('ring', []))
    ck(nj > 0 and keys_ok, 'fakeSceneKeysAllowListOnly')
    ck.kv['fakeSceneJson'] = nj
    for probe in ('.harness/macro/sat/__g8f_probe__.json', '.harness/macro/sat/__g8f_probe__.png',
                  '.harness/oro/sat-ext/__g8f_probe__.png'):
        p = os.path.join(ROOT, *probe.split('/'))
        try:
            (R.empty_cells if p.endswith('.png') else R.load_truth)(p)
            ck(False, f'refused:{probe}')
        except PermissionError:
            pass
    # positive controls: the interception would have caught an open of a real bank path. A scene JSON path opened under
    # allow('scene-json') (the context load_truth uses) is recorded and flagged; a bank PNG under png-judge is refused by
    # the guard before any open (no judge.lock). Probe names do not exist in the bank.
    pj = os.path.join(ROOT, '.harness', 'macro', 'sat', '__g8f_probe__.json')
    with _record_opens('G8fProbe') as rec:
        with O.allow('scene-json'):
            try:
                open(pj, 'rb').close()
            except FileNotFoundError:
                pass
    ck(any(os.path.abspath(x) == pj and O.guard_verdict(x) is not None for x in rec), 'interceptCatchesSceneJson')
    pp = os.path.join(ROOT, '.harness', 'macro', 'sat', '__g8f_probe__.png')
    try:
        with O.allow('png-judge'):
            open(pp, 'rb').close()
        ck(False, 'guardRefusesBankPng')
    except PermissionError:
        pass
    except FileNotFoundError:
        ck(False, 'guardRefusesBankPng')
    _G6_OPENS.pop('G8fProbe', None)
    return ck.result()
# ═══════════════════════ S3b JUDGE TESTS — END ═══════════════════════


# ═══════════════════════ S3b POWER / SUNSET TESTS (§6.7, §6.8; build notes PS-1 … PS-10) ═══════════════════════
# MODIS-free: synthetic placements, the committed oro-apply.json placement (counts only), the real sounding (busan's
# record, relabelled as a code fixture), DEM grids and ring raw (NWP). Temp files under test-tmp/ps/<test>.
T_PS = os.path.join(TMP, 'ps')
PS_DATES13 = [f'2026-{m:02d}-{d:02d}' for m, d in ((9, 1), (9, 5), (9, 9), (9, 13), (9, 17), (9, 21), (9, 25), (9, 29),
                                                   (10, 3), (10, 7), (10, 11), (10, 15), (10, 19))]
# draft placement (sim2 P_APPLY × 13 dates): the scenario the [computed] simA2/sim2 numbers come from (PS-6)
PS_DRAFT_PER = {'busan': 4, 'denver': 6, 'lisbon': 2, 'osaka': 4, 'sapporo': 5, 'sydney': 3}
RING_BLEND = os.path.join(ROOT, 'tools', 'genus-ruler', 'ring', 'nwp', 'blend')
SOUNDING_P = os.path.join(ROOT, '.harness', 'oro', 'sounding.json')


def _ps_dir(sub):
    return fresh_dir(os.path.join(T_PS, sub))


def _ps_apply(per, extra_uncounted=3):
    """A minimal oro-apply-shaped doc: per = {site: k} counted scenes spread over the 13 dates, plus uncounted rows."""
    rows = {}
    for si, (s, k) in enumerate(sorted(per.items())):
        for i in range(k):
            d = PS_DATES13[(i * 5 + si * 2) % 13]
            rows[f'{s}_{d}'] = {'site': s, 'date': d, 'counted': True}
    for i in range(extra_uncounted):
        rows[f'zz_{PS_DATES13[i]}'] = {'site': 'zz', 'date': PS_DATES13[i], 'counted': False}
    gs = sorted(s for s in per if per[s] >= 3)
    gsc = sum(per[s] for s in gs)
    return {'scenes': rows, 'summary': {'n': sum(per.values()), 'gshufSites': gs, 'gshufScenes': gsc,
                                        'c3bMeasurable': gsc >= 10, 'provisional': False}}


def _ps_tests(R, dates):
    return R.PlacementTests(dates, 1000, R.SEED)


@test('P-EQ')
def t_peq():
    """PlacementTests.ci/p are bit-identical to the judgement's date_block_ci(B = 1000, seed 20261103) and sign_flip_p
    (median and mean; exact branch G ≤ 16 and the MC branch G = 17; ties; one date)."""
    ck = Checks()
    R = _R()
    rng = np.random.default_rng(7)
    n_cmp = 0
    for G in (1, 2, 5, 13, 16, 17):
        blocks = sorted(f'2026-1{(i // 28)}-{(i % 28) + 1:02d}' for i in range(G))
        dates = [blocks[i % G] for i in range(G + 9)]
        T = _ps_tests(R, dates)
        for rep in range(3 if G >= 16 else 6):
            v = rng.normal(0.03, 0.2, len(dates))
            if rep == 1:
                v = np.round(v, 1)                       # ties
            ck(R.date_block_ci(list(v), dates, np.median, B=1000) == T.ci(v), f'ci:G{G}')
            for stat in ('median', 'mean'):
                ck(R.sign_flip_p(list(v), dates, stat) == T.p(v, stat), f'p:{stat}:G{G}')
            n_cmp += 1
    ck.kv['valueSets'] = n_cmp
    return ck.result()


@test('P-PLACE')
def t_pplace():
    """power_placement: counted rows only, sorted; G-shuf sites ≥ 3 counted; c3b measurability ≥ 10; a summary that
    disagrees with the rows is refused; the committed oro-apply.json gives its own summary counts."""
    ck = Checks()
    R = _R()
    doc = _ps_apply({'a': 3, 'b': 2, 'c': 5})
    p = R.power_placement(doc)
    ck(p['names'] == sorted(n for n, r in doc['scenes'].items() if r['counted']), 'names')
    ck(p['gshufSites'] == ['a', 'c'] and p['gshufScenes'] == 8 and p['c3bMeasurable'] is False, 'gshuf')
    ck(sorted(p['site'][j] for j in p['gIdx']) == ['a'] * 3 + ['c'] * 5, 'gIdx')
    bad = json.loads(json.dumps(doc))
    bad['summary']['gshufSites'] = ['a', 'b', 'c']
    try:
        R.power_placement(bad)
        ck(False, 'refuseSummary')
    except ValueError:
        pass
    real = _jload(REAL_APPLY)
    pr = R.power_placement(real)
    sm = real['summary']
    ck(len(pr['names']) == sm['n'] and pr['gshufSites'] == sm['gshufSites'] and pr['gshufScenes'] == sm['gshufScenes'],
       'realSummary')
    ck.kv.update({'realN': sm['n'], 'realGshufScenes': sm['gshufScenes'], 'realProvisional': bool(sm.get('provisional'))})
    return ck.result()


@test('P-CAL')
def t_pcal():
    """β calibration (Q-48, PS-4): the moment form equals simA2's pear on S to ≤ 1e-12 (incl. |S| < 3 → 0); the solved β
    reproduces μ (|f(β) − μ| ≤ 1e-9, bracketed); f is increasing on a β grid; β = 0 gives a mean median ρ near 0."""
    ck = Checks()
    R = _R()
    pl = R.power_placement(_ps_apply(PS_DRAFT_PER))
    mb = R.ModelB()
    reps = 200
    cal = R._CalibB(mb, pl, 1.0, reps, R.SEED)
    rng = np.random.default_rng(R.SEED)
    mx = 0.0
    for i in range(min(reps, 20)):
        dr = mb.draw(rng, pl, 1.0, rev=False, pattern=False)
        for beta in (0.0, 0.04, 0.37, 1.0):
            row = cal.rho(beta)[i]
            for j in range(len(pl['names'])):
                S = np.abs(dr['dC'][j]) >= R.MB_DC
                mx = max(mx, abs(row[j] - R._pear_a2(dr['dC'][j], beta * dr['z'][j] + dr['noise'][j], S)))
    ck(mx <= 1e-12, 'momentsEqualPear')
    c2 = R._CalibB.__new__(R._CalibB)                    # |S| < 3 branch: same moments, one scene with |S| = 2 → ρ = 0
    c2.M = np.zeros((7, 1, 2))
    c2.M[:, 0, 0] = [1.0, 0.5, 0.1, 1.0, 0.0, 1.0, 0.0]
    c2.M[:, 0, 1] = [1.0, 0.5, 0.1, 1.0, 0.0, 1.0, 1.0]
    ck(c2.rho(0.3)[0, 1] == 0.0 and c2.rho(0.3)[0, 0] != 0.0, 'smallS')
    for mu in (0.05, 0.10, 0.15):
        b, fv, br = cal.solve(mu)
        ck(br and abs(fv - mu) <= 1e-9 and 0.0 < b < 1.0, f'solve:mu{mu:.2f}')
        ck.kv[f'beta{mu:.2f}'] = b
    grid = [cal.f(b) for b in (0.0, 0.02, 0.04, 0.08, 0.16, 0.32)]
    ck(all(x < y for x, y in zip(grid, grid[1:])), 'increasing')
    ck(abs(grid[0]) < 0.01, 'nullNear0')
    ck.kv.update({'reps': reps, 'momentsMaxDiff': mx, 'f0': grid[0]})
    return ck.result()


@test('P-MODA')
def t_pmoda():
    """Model A (PS-2) against the draft numbers on the draft placement (MC, generous tolerance): null P(c2∧c3) ≤ 0.03;
    μ 0.10 σ 0.20 P(c2) ≈ sim2b's sign-flip 0.41 (± 0.12); P(c2∧c3) rises with μ and falls with σ."""
    ck = Checks()
    R = _R()
    pl = R.power_placement(_ps_apply(PS_DRAFT_PER))
    T = _ps_tests(R, pl['date'])
    reps = 400
    r0 = R._model_a_cell(pl, T, 0.0, 0.20, 11, reps)
    r1 = R._model_a_cell(pl, T, 0.10, 0.20, 12, reps)
    r2 = R._model_a_cell(pl, T, 0.10, 0.15, 13, reps)
    r3 = R._model_a_cell(pl, T, 0.15, 0.15, 14, reps)
    ck(r0['pA_c2c3'] <= 0.03, 'null')
    ck(abs(r1['pA_c2'] - 0.41) <= 0.12, 'c2VsSim2b')
    ck(r2['pA_c2c3'] > r1['pA_c2c3'] and r3['pA_c2c3'] > r2['pA_c2c3'], 'monotone')
    ck.kv.update({'reps': reps, 'null': r0['pA_c2c3'], 'mu10s20c2': r1['pA_c2'], 'mu10s20c2c3': r1['pA_c2c3'],
                  'mu10s15c2c3': r2['pA_c2c3'], 'mu15s15c2c3': r3['pA_c2c3']})
    return ck.result()


@test('P-MODB')
def t_pmodb():
    """Model B (PS-3) against simA2 (kw1) on the draft placement (MC, tolerance 0.12): β 0.06 → c2∧c3 ≈ 0.825 and joint
    (variant e) ≈ 0.818; null → c2∧c3 ≤ 0.03; site pattern A 0.10 → c2∧c3 ≈ 0.337, joint ≤ 0.10 (simA2 0.030)."""
    ck = Checks()
    R = _R()
    pl = R.power_placement(_ps_apply(PS_DRAFT_PER))
    T = _ps_tests(R, pl['date'])
    Tg = _ps_tests(R, [pl['date'][j] for j in pl['gIdx']])
    mb = R.ModelB()
    reps = 250
    h1 = R._model_b_cell(mb, pl, T, Tg, 0.06, 0.0, 1.0, 21, reps)
    nl = R._model_b_cell(mb, pl, T, Tg, 0.0, 0.0, 1.0, 22, reps)
    sa = R._model_b_cell(mb, pl, T, Tg, 0.0, 0.10, 1.0, 23, reps)
    ck(abs(h1['pB_c2c3'] - 0.825) <= 0.12, 'h1c2c3')
    ck(abs(h1['pB_joint'] - 0.818) <= 0.12, 'h1joint')
    ck(nl['pB_c2c3'] <= 0.03, 'null')
    ck(abs(sa['pB_c2c3'] - 0.337) <= 0.12 and sa['pB_joint'] <= 0.10, 'sitePattern')
    ck(h1['pB_joint'] <= h1['pB_c2c3'] and (h1['pB_c3b_given'] is None or 0.0 <= h1['pB_c3b_given'] <= 1.0), 'consistency')
    ck.kv.update({'reps': reps, 'beta06c2c3': h1['pB_c2c3'], 'beta06joint': h1['pB_joint'], 'nullc2c3': nl['pB_c2c3'],
                  'A10c2c3': sa['pB_c2c3'], 'A10joint': sa['pB_joint']})
    return ck.result()


@test('P-MUTE')
def t_pmute():
    """'못 잼': a placement with < 10 G-shuf scenes never passes c3b (P(c3b | c2∧c3) = 0, joint 0, product 0) even with a
    strong effect; the same effect on a measurable placement passes c3b."""
    ck = Checks()
    R = _R()
    pl = R.power_placement(_ps_apply({'a': 4, 'b': 4, 'c': 2, 'd': 2, 'e': 2, 'f': 2, 'g': 2, 'h': 2}))
    ck(pl['gshufScenes'] == 8 and pl['c3bMeasurable'] is False, 'placement')
    mb = R.ModelB()
    r = R._model_b_cell(mb, pl, _ps_tests(R, pl['date']), _ps_tests(R, [pl['date'][j] for j in pl['gIdx']]),
                        0.25, 0.0, 1.0, 31, 20)
    ck(r['pB_c2c3'] > 0.5 and r['pB_joint'] == 0.0 and r['pB_c3b_given'] == 0.0, 'mute')
    pl2 = R.power_placement(_ps_apply({'a': 5, 'b': 5, 'c': 4}))
    r2 = R._model_b_cell(mb, pl2, _ps_tests(R, pl2['date']), _ps_tests(R, [pl2['date'][j] for j in pl2['gIdx']]),
                         0.25, 0.0, 1.0, 31, 20)
    ck(r2['pB_joint'] > 0.5, 'measurable')
    return ck.result()


@test('P-DOC')
def t_pdoc():
    """power_doc / CLI on a small synthetic placement (reduced replicate counts, --out in test-tmp): schema, 16 product
    cells = pA × pB_given, 8 calibrations, 20 seeded cells = 20261103 + index, decision = min over σ × κ at μ 0.10,
    false-pass blocks; two processes give identical bytes; the committed path is refused for non-pinned counts and for a
    foreign oro-apply (the committed power-oro.json bytes are unchanged)."""
    ck = Checks()
    R = _R()
    d = _ps_dir('doc')
    ap = os.path.join(d, 'apply.json')
    O.dump_json(_ps_apply({'a': 5, 'b': 4, 'c': 3, 'd': 2}), ap)
    out1, out2 = os.path.join(d, 'p1.json'), os.path.join(d, 'p2.json')
    args = ['--power', '--apply', ap, '--reps', '12', '--boot', '200', '--cal-reps', '30']
    r1 = _run_oro(args + ['--out', out1], check=False)
    r2 = _run_oro(args + ['--out', out2], check=False)
    ck(r1.returncode == 0 and r2.returncode == 0, 'exit0')
    if r1.returncode == 0 and r2.returncode == 0:
        b1 = read_bytes(out1)
        ck(b1 == read_bytes(out2), 'deterministic')
        doc = json.loads(b1)
        ck(doc['schema'] == 'power-oro/1' and doc['status'] == 'ok', 'schema')
        ck(len(doc['cells']) == 16 and len(doc['cellsA']) == 8 and len(doc['cellsB']) == 8 and len(doc['calibration']) == 8,
           'counts')
        ck(all(c['product'] == c['pA_c2c3'] * (c['pB_c3b_given'] or 0.0) for c in doc['cells'].values()), 'product')
        ck(sorted(doc['seeds']['cells'].values()) == [R.SEED + i for i in range(20)], 'seeds')
        dec = [doc['cells'][f'mu=0.10,sigma={s},kappa={k}']['product'] for s in ('0.15', '0.20') for k in ('1', '3')]
        ck(doc['decision']['value'] == min(dec) and doc['decision']['below0.2'] == (min(dec) < 0.2), 'decision')
        ck(len(doc['falsePass']['null']) == 4 and len(doc['falsePass']['sitePattern']) == 4, 'falsePass')
        ck(all(doc['calibration'][k]['beta'] == 0.0 for k in doc['calibration'] if k.startswith('mu=0.00')), 'beta0')
        ck(doc['placement']['n'] == 14 and doc['placement']['gshufScenes'] == 12, 'placement')
    pp = os.path.join(HERE, 'power-oro.json')
    before = read_bytes(pp) if os.path.exists(pp) else None
    r3 = _run_oro(['--power', '--reps', '12'], check=False)
    r4 = _run_oro(['--power', '--apply', ap], check=False)
    after = read_bytes(pp) if os.path.exists(pp) else None
    if after != before and before is not None:          # a broken refusal must not leave a trial file in the committed path
        with open(pp, 'wb') as f:
            f.write(before)
    ck(r3.returncode == 2 and r4.returncode == 2 and after == before, 'refuseCommittedPath')
    return ck.result()


@test('P-ZERO')
def t_pzero():
    """An oro-apply with 0 counted scenes (the provisional one) gives status 'no placement', no cells, decision null."""
    ck = Checks()
    R = _R()
    ap = os.path.join(_ps_dir('zero'), 'apply.json')
    O.dump_json(_ps_apply({}), ap)
    doc = R.power_doc(ap, 10, 100, 10)
    ck(doc['status'].startswith('no placement') and doc['cells'] == {} and doc['decision']['value'] is None
       and doc['decision']['below0.2'] is None, 'zero')
    return ck.result()


@test('P-COMMITTED')
def t_pcommitted():
    """The committed power-oro.json is this code's output for the committed oro-apply.json (pinned counts): same oro-apply
    sha256, same oro.py sha256 (build order 8b → 8c, PS-9); product and decision consistent; with n = 0 it is recomputed
    and compared byte for byte (with n > 0 the ≈ 8 min recompute is the --power run itself)."""
    ck = Checks()
    R = _R()
    p = os.path.join(HERE, 'power-oro.json')
    if not os.path.exists(p):
        ck(False, 'missing')
        return ck.result()
    doc = _jload(p)
    ck(doc['sources']['oroApply']['sha256'] == O.sha256_file(REAL_APPLY), 'applySha')
    ck(doc['sources']['code']['oro.py'] == O.sha256_file(os.path.join(HERE, 'oro.py')), 'codeSha')
    ck(doc['reps'] == {'cell': R.POW_REPS, 'bootstrap': R.POW_BOOT_B, 'calibration': R.POW_CAL_REPS,
                       'calibrationSteps': R.POW_CAL_STEPS}, 'pinned')
    ck(all(c['product'] == c['pA_c2c3'] * (c['pB_c3b_given'] or 0.0) for c in doc['cells'].values()), 'product')
    if doc['cells']:
        dec = [doc['cells'][f'mu=0.10,sigma={s},kappa={k}']['product'] for s in ('0.15', '0.20') for k in ('1', '3')]
        ck(doc['decision']['value'] == min(dec), 'decision')
    if doc['placement']['n'] == 0:
        ck(O.dumps_json(R.power_doc(REAL_APPLY)) == read_bytes(p).decode('utf-8'), 'recomputed')
    ck.kv.update({'n': doc['placement']['n'], 'decision': doc['decision']['value'], 'provisional': doc['provisional']})
    return ck.result()


def _busan_record():
    if not os.path.exists(SOUNDING_P):
        raise Skip('.harness/oro/sounding.json missing')
    return _jload(SOUNDING_P)['busan']


def _fake_sounding(path, sites=('kanazawa', 'osaka'), edit=None):
    """busan's real hourly record relabelled for A1-true sites (a code fixture, not a physical sounding)."""
    rec = _busan_record()
    d = {}
    for s in sites:
        r = json.loads(json.dumps(rec))
        if edit:
            edit(s, r)
        d[s] = r
    O.dump_json(d, path)
    return path


@test('S-EVE')
def t_seve():
    """Q-42 evening rule: [−2°, +8°] inclusive and strictly descending vs t − 30 min (patched altitudes); on the real
    busan hours the selected set is exactly the brute-force set, each evening hour lies in local evening."""
    ck = Checks()
    R = _R()
    if not os.path.exists(SOUNDING_P):
        raise Skip('.harness/oro/sounding.json missing')
    real = O.sun_alt_deg
    t = datetime(2026, 9, 1, 10, tzinfo=timezone.utc)
    cases = [((8.0, 9.0), True), ((-2.0, 1.0), True), ((8.0001, 9.0), False), ((-2.0001, 1.0), False),
             ((3.0, 2.0), False), ((3.0, 3.0), False), ((0.0, 5.0), True)]
    try:
        for (a, b), want in cases:
            O.sun_alt_deg = (lambda a_, b_: (lambda tt, la, lo: a_ if tt == t else b_))(a, b)
            ck(R.evening(t, 35.0, 129.0) is want, f'case:{a},{b}')
    finally:
        O.sun_alt_deg = real
    la, lo, _ = O.sites_table()['busan']
    sd = O.load_soundings(SOUNDING_P)['busan']
    want = [h for h in sd.times if '2026-06-01' <= h[:10] <= '2026-10-31'
            and -2.0 <= O.sun_alt_deg(O.parse_hour(h), la, lo) <= 8.0
            and O.sun_alt_deg(O.parse_hour(h), la, lo) < O.sun_alt_deg(O.parse_hour(h) - timedelta(minutes=30), la, lo)]
    _, hrs = R.sunset_hours('busan', sd, None, None, la, lo, None)
    ck([h['hour'] for h in hrs] == want, 'bruteForce')
    ck(all(8 <= int(h[11:13]) <= 11 for h in want), 'localEvening')      # UTC+9: 08–11Z = 17–20 KST
    ck(0 < len(want) <= 153 * 2, 'count')
    ck.kv['busanEveningHours'] = len(want)
    return ck.result()


@test('S-A15')
def t_sa15():
    """A1–A5 per evening hour (PS-7): a null at the hour itself is bridged by the §2.3 fallback (counted in nFallbackHours,
    A5 true); nulls over ±3 h make A5 false at that hour only; > 9 null ring points in one band at a ring hour make A5
    false there only, 9 do not; A1 false (busan) → no hour counts; outside the ring range the ring part is not required."""
    ck = Checks()
    R = _R()
    d = _ps_dir('a15')
    sites = O.sites_table()
    dg = _jload(DEM_GRIDS_P)
    cache = O.SiteCache(dg)
    la, lo, _ = sites['kanazawa']
    dem = cache.get('kanazawa')
    zr = dg['sites']['kanazawa']['zRefM']
    rp = os.path.join(RING_BLEND, 'kanazawa.json')
    sp = _fake_sounding(os.path.join(d, 's0.json'), ('kanazawa',))
    sd = O.load_soundings(sp)['kanazawa']
    A1, base = R.sunset_hours('kanazawa', sd, dem, zr, la, lo, R.RingHours(rp))
    ck(A1 is True, 'A1')
    good = [h for h in base if h['ring'] and h['a15']]
    noring = [h for h in base if not h['ring']]
    ck(len(good) >= 3 and len(noring) > 0, 'fixture')
    ck.kv.update({'evening': len(base), 'ring': sum(h['ring'] for h in base), 'A1to5': sum(h['a15'] for h in base),
                  'ringA1to5': len(good)})
    if len(good) < 3:
        return ck.result()
    h0 = good[1]['hour']
    i0 = sd.index[h0]
    base_a15 = {x['hour']: x['a15'] for x in base}

    def null_at(idxs):
        def ed(s, r):
            for i in idxs:
                r['hourly']['temperature_850hPa'][i] = None
        return ed
    sd1 = O.load_soundings(_fake_sounding(os.path.join(d, 's1.json'), ('kanazawa',), null_at([i0])))['kanazawa']
    _, h1 = R.sunset_hours('kanazawa', sd1, dem, zr, la, lo, R.RingHours(rp))
    m1 = {h['hour']: h for h in h1}
    ck(m1[h0]['a15'] is True and m1[h0]['fallback'] is True, 'fallbackBridges')
    ck(sum(h['fallback'] for h in h1) == 1, 'oneFallbackHour')
    sd2 = O.load_soundings(_fake_sounding(os.path.join(d, 's2.json'), ('kanazawa',),
                                          null_at(range(i0 - 3, i0 + 4))))['kanazawa']
    _, h2 = R.sunset_hours('kanazawa', sd2, dem, zr, la, lo, R.RingHours(rp))
    ck({h['hour']: h for h in h2}[h0]['a15'] is False, 'nullWindowFails')
    ck(sum(1 for h in h2 if h['a15'] != base_a15[h['hour']]) == 1, 'onlyThatHour')
    raw = _jload(rp)            # ring nulls: copy the raw ring and null band 'low' at h0 for 9 / 10 points
    for k, want in ((9, True), (10, False)):
        rw = json.loads(json.dumps(raw))
        for j in range(1, k + 1):
            hh = rw['data'][j]['hourly']
            i = hh['time'].index(h0)
            for m in rw['models']:
                hh[f'cloud_cover_low_{m}'][i] = None
        rd = os.path.join(d, f'ring{k}')
        os.makedirs(rd)
        O.dump_json(rw, os.path.join(rd, 'kanazawa.json'))
        _, hr = R.sunset_hours('kanazawa', sd, dem, zr, la, lo, R.RingHours(os.path.join(rd, 'kanazawa.json')))
        ck({h['hour']: h for h in hr}[h0]['a15'] is want, f'ringNull{k}')
        ck(sum(1 for h in hr if h['a15'] != base_a15[h['hour']]) == (0 if want else 1), f'ringNull{k}OnlyThatHour')
    lb, lob, _ = sites['busan']
    A1b, hb = R.sunset_hours('busan', O.load_soundings(sp)['kanazawa'], cache.get('busan'), dg['sites']['busan']['zRefM'],
                             lb, lob, None)
    ck(A1b is False and not any(h['a15'] for h in hb), 'A1false')
    # outside the ring range the A5 ring part is not asked: with no ring at all the same hours pass or fail on the sounding
    _, hn = R.sunset_hours('kanazawa', sd, dem, zr, la, lo, None)
    nr = {x['hour'] for x in noring}
    ck(all(not h['ring'] for h in hn) and [h['a15'] for h in hn if h['hour'] in nr] == [h['a15'] for h in noring],
       'noRingPart')
    return ck.result()


@test('S-E2E')
def t_se2e():
    """--sunset end to end (PS-8) on a fixture sounding (busan's record for kanazawa and osaka) with the real ring raw and
    DEM: sunset-inputs holds exactly the ring hours with A1–A5 true; oro-base (node, commit of .harness/oro/base) builds
    their B and its index names this sunset-inputs sha256; A6 app recomputed here from the B files equals the count;
    counts are consistent; two CLI runs give identical bytes; a corrupted B is refused; A6 app needs both bands."""
    ck = Checks()
    R = _R()
    bip = os.path.join(REAL_BASE, 'index.json')
    if not os.path.exists(bip):
        raise Skip('.harness/oro/base/index.json missing')
    d = _ps_dir('e2e')
    sp = _fake_sounding(os.path.join(d, 'sounding.json'))
    sin, sb, out = os.path.join(d, 'sunset-inputs.json'), os.path.join(d, 'base'), os.path.join(d, 'sunset.json')
    args = ['--sunset', '--sounding', sp, '--inputs-out', sin, '--base-out', sb, '--out', out]
    r1 = _run_oro(args, check=False)
    ck(r1.returncode == 0, 'exit0')
    if r1.returncode != 0:
        return ck.result()
    b1 = read_bytes(out)
    r2 = _run_oro(args, check=False)
    ck(r2.returncode == 0 and read_bytes(out) == b1, 'deterministic')
    doc = json.loads(b1)
    idx = _jload(os.path.join(sb, 'index.json'))
    sinb = read_bytes(sin)
    ck(idx['inputsFileSha256'] == O.sha256_bytes(sinb) == doc['sources']['sunsetInputs']['sha256'], 'inputsSha')
    base_idx = _jload(bip)
    ck(idx['commit'] == base_idx['commit'] and idx['bundleSha256'] == base_idx['bundleSha256'], 'sameBundle')
    ck(doc['sources']['base']['commit'] == idx['commit'], 'baseRecorded')
    si = json.loads(sinb)
    sites = O.sites_table()
    dg = _jload(DEM_GRIDS_P)
    cache = O.SiteCache(dg)
    snds = O.load_soundings(sp)
    expect, a6 = {}, {}
    for s in ('kanazawa', 'osaka'):
        la, lo, _ = sites[s]
        A1, hrs = R.sunset_hours(s, snds[s], cache.get(s), dg['sites'][s]['zRefM'], la, lo,
                                 R.RingHours(os.path.join(RING_BLEND, f'{s}.json')))
        st = doc['sites'][s]
        ck(st['nEvening'] == len(hrs) and st['nA1toA5'] == sum(h['a15'] for h in hrs)
           and st['ring']['nHours'] == sum(h['ring'] for h in hrs), f'{s}:counts')
        n6 = 0
        for h in hrs:
            if h['ring'] and h['a15']:
                name, tk = f'{s}_{h["hour"][:10]}', f'h{h["hour"][11:13]}'
                expect.setdefault(name, set()).add(tk)
                Bs = {}
                for b in ('low', 'mid'):
                    body = read_bytes(os.path.join(sb, f'{name}__{tk}__{b}.f32'))
                    ck(O.sha256_bytes(body) == idx['entries'][name][tk][b], f'{s}:bSha')
                    Bs[b] = np.frombuffer(body, dtype='<f4').reshape(128, 128).astype(np.float64)
                F = O.forcing(cache.get(s)['hsub'], h['snd'], la)
                n6 += all(O.combine(Bs[b], F)['ok'] for b in ('low', 'mid'))
        a6[s] = n6
        ck(st['ring']['nA1toA6app'] == n6 and n6 <= st['ring']['nA1toA5'], f'{s}:A6')
        ck(st['fracA1toA5'] == (st['nA1toA5'] / st['nEvening'] if st['nEvening'] else None), f'{s}:frac')
        ck(st['ring']['frac'] == (n6 / st['ring']['nHours'] if st['ring']['nHours'] else None), f'{s}:ringFrac')
    ck({k: set(v['times']) for k, v in si['scenes'].items()} == expect, 'inputsExactlyCandidates')
    ck(len(expect) > 0, 'nonEmpty')
    ck(doc['provisional'] is True and 'busan' in doc['pendingSites']['sounding'], 'pending')
    # ring values in sunset-inputs are the raw hourly blend / 100 at the hour (point 0.., band low, first scene)
    name0 = sorted(si['scenes'])[0]
    tk0 = sorted(si['scenes'][name0]['times'])[0]
    rh = R.RingHours(os.path.join(RING_BLEND, f'{name0.rsplit("_", 1)[0]}.json'))
    got = O.dec_f64(si['scenes'][name0]['times'][tk0]['ring']['low']['f64'])
    raw = rh.values('low', f'{name0.rsplit("_", 1)[1]}T{tk0[1:]}:00')
    ck(all((v is None and np.isnan(g)) or (v is not None and g == v) for g, v in zip(got, raw)), 'rawRing')
    victim = os.path.join(sb, f'{name0}__{tk0}__low.f32')          # corrupted B → refused (index reused, no node)
    good_b = read_bytes(victim)
    bb = bytearray(good_b)
    bb[100] ^= 1
    with open(victim, 'wb') as f:
        f.write(bytes(bb))
    try:
        R.sunset_doc(sp, DEM_GRIDS_P, RING_BLEND, os.path.join(d, 'sin2.json'), sb, idx['commit'],
                     run_base=lambda i, o, c: idx)
        ck(False, 'corruptRefused')
    except ValueError:
        pass
    with open(victim, 'wb') as f:
        f.write(good_b)
    # A6 app needs both bands: a stub combiner failing only the first call (low of the first candidate) removes one hour;
    # failing every second call (every mid band) removes all
    real = O.combine
    try:
        for mode, want in (('first', sum(a6.values()) - 1), ('mid', 0)):
            calls = [0]

            def fake(B, F, _m=mode, **kw):
                c = real(B, F, **kw)
                calls[0] += 1
                if (_m == 'first' and calls[0] == 1) or (_m == 'mid' and calls[0] % 2 == 0):
                    c = dict(c, ok=False)
                return c
            O.combine = fake
            dd = R.sunset_doc(sp, DEM_GRIDS_P, RING_BLEND, os.path.join(d, 'sin3.json'), sb, idx['commit'],
                              run_base=lambda i, o, c: idx)
            ck(sum(dd['sites'][s]['ring']['nA1toA6app'] for s in ('kanazawa', 'osaka')) == want, f'bothBands:{mode}')
    finally:
        O.combine = real
    ck.kv.update({'kanazawaA6app': a6['kanazawa'], 'osakaA6app': a6['osaka'], 'scenes': len(expect),
                  'times': sum(len(v) for v in expect.values())})
    return ck.result()


@test('S-COMMITTED')
def t_scommitted():
    """The committed sunset-apply.json equals a fresh in-memory run of this code on the committed inputs (build order 8c,
    PS-9): sunset-inputs written to test-tmp (same bytes as the uncommitted .harness/oro/sunset-inputs.json, so its path is
    the only difference), B read from .harness/oro/sunset-base through its index when the committed file names one (no
    node run); it names this oro.py and marks the pending sites."""
    ck = Checks()
    R = _R()
    p = os.path.join(HERE, 'sunset-apply.json')
    if not os.path.exists(p):
        ck(False, 'missing')
        return ck.result()
    doc = _jload(p)
    ck(doc['sources']['code']['oro.py'] == O.sha256_file(os.path.join(HERE, 'oro.py')), 'codeSha')
    d = _ps_dir('scommit')
    if doc['sources']['base'] is None:
        def no_b(*a):
            raise AssertionError('no B expected')
        base_out, commit, run_base = os.path.join(d, 'base'), 'unused', no_b
    else:
        base_out = O._path(R.D_SUNSET_BASE)
        ip = os.path.join(base_out, 'index.json')
        if not os.path.exists(ip):
            raise Skip('.harness/oro/sunset-base/index.json missing')
        idx = _jload(ip)
        base_out, commit, run_base = base_out, doc['sources']['base']['commit'], (lambda i, o, c: idx)
    sin = os.path.join(d, 'sunset-inputs.json')
    new = R.sunset_doc(O._path(O.D_SOUNDING), O._path(O.D_DEM_GRIDS), RING_BLEND, sin, base_out, commit, run_base=run_base)
    ck(new['sources']['sunsetInputs']['path'] == O.rel(sin), 'inputsPathOnlyDiff')
    new['sources']['sunsetInputs']['path'] = doc['sources']['sunsetInputs']['path']
    ck(O.dumps_json(new) == read_bytes(p).decode('utf-8'), 'recomputed')
    ck(sorted(doc['pendingSites']['sounding']) == sorted(s for s, v in doc['sites'].items() if not v['sounding']), 'pending')
    for s, v in sorted(doc['sites'].items()):
        if v['sounding']:
            ck.kv[s] = f'{v["nEvening"]}/{v["nA1toA5"]}/{v["ring"]["nHours"]}/{v["ring"]["nA1toA6app"]}'
    return ck.result()


@test('S-GUARD')
def t_sguard():
    """The open guard is armed in this process (installed first), so no power/sunset test could open MODIS content."""
    ck = Checks()
    ck(O.guard_installed(), 'installed')
    try:
        open(os.path.join(ROOT, 'tools', 'genus-ruler', 'macro', 'sat-quartiles.json')).close()
        ck(False, 'forbiddenOpenRaised')
    except PermissionError:
        pass
    return ck.result()


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
