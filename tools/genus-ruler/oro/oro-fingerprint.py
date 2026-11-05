#!/usr/bin/env python3
"""
oro-fingerprint.py: 복원 자료가 예전 자료와 같은지 수만 셉니다(RULER-oro 계획 §2.1 R3·R7). 값은 찍지 않습니다.

  python3 tools/genus-ruler/oro/oro-fingerprint.py --f1 [--out .harness/oro/restore-fingerprints.json]
  python3 tools/genus-ruler/oro/oro-fingerprint.py --f2
  python3 tools/genus-ruler/oro/oro-fingerprint.py --f3 [--skip-run]

  F1: .harness/macro/sat 의 장면 파일 이름 집합 대 ring/modis-times.json 의 121 키.
      index.json 은 항목마다 'skip'·'error' 값이 참인지만 셉니다(사유 글은 찍지 않고, 다른 키는 읽지 않음).
  F2: macro.py --truth 를 돌려 .harness/oro/sat-quartiles-restore.json 을 만들고(표준 출력은 .harness/oro/f2.log, 읽지 않음),
      커밋된 macro/sat-quartiles.json 과 수치 잎이 몇 개 같은지만 셉니다.
  F3: downscale-run.mjs(--variant prior)로 .harness/macro/sat-nwp-blend 의 합성을 다시 만들고(.harness/oro/syn-blend,
      표준 출력은 .harness/oro/f3-run.log), macro.py 의 beta_of·ring_values 만 불러 T(위성 참값)를 쓰지 않는 다섯 열
      ringRmse·ringRmseBase·betaSyn·betaC0·partialSyn 을 셉니다. 커밋된 ring/gate-blend-held.json 의 같은 열과
      장면 97 개 가운데 몇 개가 다섯 열 모두 같은지(상대 1e-9)만 찍습니다. 장면 파일의 trueGrid·cover 는 쓰지 않습니다.
  macro.py --gate 는 돌리지 않습니다.
  결과는 --out(기본 .harness/oro/restore-fingerprints.json)에 단계별 수로 더해 적습니다.
"""
import sys, os, json, glob, subprocess, math, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SAT = os.path.join(ROOT, '.harness', 'macro', 'sat')
NWP = os.path.join(ROOT, '.harness', 'macro', 'sat-nwp-blend')
ORO = os.path.join(ROOT, '.harness', 'oro')
MACRO = os.path.join(ROOT, 'tools', 'genus-ruler', 'macro')
RING = os.path.join(ROOT, 'tools', 'genus-ruler', 'ring')
F3_COLS = ('ringRmse', 'ringRmseBase', 'betaSyn', 'betaC0', 'partialSyn')


def scene_names(d):
    return sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(d, '*.json')) if not f.endswith('index.json'))


def f1():
    keys = set(json.load(open(os.path.join(RING, 'modis-times.json'))).keys())
    names = set(scene_names(SAT))
    idx = json.load(open(os.path.join(SAT, 'index.json')))
    n_skip = sum(1 for e in idx if isinstance(e, dict) and e.get('skip'))
    n_err = sum(1 for e in idx if isinstance(e, dict) and e.get('error'))
    missing, extra = sorted(keys - names), sorted(names - keys)
    r = {'nKeys': len(keys), 'nFiles': len(names), 'nCommon': len(keys & names), 'missing': missing, 'extra': extra,
         'indexEntries': len(idx), 'indexSkip': n_skip, 'indexError': n_err}
    nwp = set(scene_names(NWP)) if os.path.isdir(NWP) else set()
    r['nwpBlendFiles'] = len(nwp)
    r['nwpBlendCommon'] = len(keys & nwp)
    print(f"F1 files {r['nFiles']} keys {r['nKeys']} common {r['nCommon']} missing {len(missing)} extra {len(extra)} "
          f"index skip {n_skip} error {n_err} | nwp-blend {r['nwpBlendFiles']} common {r['nwpBlendCommon']}")
    return r


def leaves(x, pre=''):
    if isinstance(x, dict):
        for k in sorted(x):
            yield from leaves(x[k], f'{pre}/{k}')
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from leaves(v, f'{pre}/{i}')
    elif isinstance(x, (int, float)) and not isinstance(x, bool):
        yield pre, float(x)


def same(a, b, rel=1e-9):
    if a is None or b is None:
        return a is None and b is None
    if not (math.isfinite(a) and math.isfinite(b)):
        return a == b
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


def f2():
    os.makedirs(ORO, exist_ok=True)
    out = os.path.join(ORO, 'sat-quartiles-restore.json')
    with open(os.path.join(ORO, 'f2.log'), 'w') as log:
        subprocess.run([sys.executable, os.path.join(MACRO, 'macro.py'), '--truth', SAT, '--out', out],
                       stdout=log, stderr=subprocess.STDOUT, check=True, cwd=ROOT)
    old = dict(leaves(json.load(open(os.path.join(MACRO, 'sat-quartiles.json')))))
    new = dict(leaves(json.load(open(out))))
    common = sorted(set(old) & set(new))
    n_same = sum(1 for k in common if same(old[k], new[k]))
    r = {'nLeavesOld': len(old), 'nLeavesNew': len(new), 'nCommon': len(common), 'nSame': n_same}
    print(f"F2 numeric leaves old {len(old)} new {len(new)} common {len(common)} same {n_same}")
    return r


def load_macro():
    spec = importlib.util.spec_from_file_location('macro_ruler', os.path.join(MACRO, 'macro.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def f3(skip_run):
    syn_dir = os.path.join(ORO, 'syn-blend')
    if not skip_run:
        os.makedirs(ORO, exist_ok=True)
        with open(os.path.join(ORO, 'f3-run.log'), 'w') as log:
            subprocess.run(['node', os.path.join(MACRO, 'downscale-run.mjs'), NWP, syn_dir, '--variant', 'prior'],
                           stdout=log, stderr=subprocess.STDOUT, check=True, cwd=ROOT)
    M = load_macro()
    ref = {r['name']: r for r in json.load(open(os.path.join(RING, 'gate-blend-held.json')))['rows']}
    n_rows, n_all5, per_col, n_nosyn = 0, 0, {c: 0 for c in F3_COLS}, 0
    for name in sorted(ref):
        p_sc, p_sy = os.path.join(NWP, name + '.json'), os.path.join(syn_dir, name + '.syn.json')
        if not (os.path.exists(p_sc) and os.path.exists(p_sy)):
            n_nosyn += 1
            continue
        sc = json.load(open(p_sc))
        meta = {'grid': sc['grid'], 'cellKm': sc['cellKm'], 'ring': sc['ring']}  # trueGrid·cover 는 넘기지 않음
        del sc
        sy = json.load(open(p_sy))
        n, cell = meta['grid'], meta['cellKm']
        S, B, C0 = M.load_u8(sy['syn'], n), M.load_u8(sy['base'], n), M.load_u8(sy['c0'], n)
        ring_fc = M.np.array([r['cover'] for r in meta['ring']])
        rv, rvB = M.ring_values(S, meta['ring'], n, cell), M.ring_values(B, meta['ring'], n, cell)
        got = {'ringRmse': float(M.np.sqrt(((rv - ring_fc) ** 2).mean())),
               'ringRmseBase': float(M.np.sqrt(((rvB - ring_fc) ** 2).mean())),
               'betaSyn': M.beta_of(S, cell), 'betaC0': M.beta_of(C0, cell),
               'partialSyn': float(((S > 0.1) & (S < 0.9)).mean())}
        n_rows += 1
        ok = {c: same(got[c], ref[name].get(c)) for c in F3_COLS}
        for c in F3_COLS:
            per_col[c] += ok[c]
        n_all5 += all(ok.values())
    r = {'nRef': len(ref), 'nCompared': n_rows, 'nMissingSceneOrSyn': n_nosyn, 'nAllFiveSame': n_all5, 'perColumnSame': per_col}
    print(f"F3 {n_all5}/{len(ref)} scenes with all five columns same (compared {n_rows}, missing {n_nosyn}) per column {per_col}")
    return r


def main(argv):
    out = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(ORO, 'restore-fingerprints.json')
    doc = json.load(open(out)) if os.path.exists(out) else {}
    if '--f1' in argv:
        doc['F1'] = f1()
    if '--f2' in argv:
        doc['F2'] = f2()
    if '--f3' in argv:
        doc['F3'] = f3('--skip-run' in argv)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
