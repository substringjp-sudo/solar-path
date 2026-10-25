#!/usr/bin/env python3
"""
eval-ringtruth.py — RULER-ringtruth Q1(·Q3·Q1-b) 평가: 장면 사본 폴더들을 downscale-run.mjs → macro.py --gate 로 돌리고(held),
세 입력(대용 / 실제 NWP / C0)·단일 통과 vs multiPass·closest vs latest·±1 h 민감도·분리 지표를 표로 낸다.
  python3 tools/genus-ruler/ring/eval-ringtruth.py [--variants blend,blend-lm,blend-latest,blend-m1h,blend-p1h,jma,archive,era5] [--skip-run]
입력 폴더: .harness/macro/sat(대용) 와 .harness/macro/sat-nwp-<variant>(fetch-nwp-ring.py). 출력: ring/gate-<variant>-held.json, ring/ringtruth-results.json.
판정 지표는 Barnes(base) 의 corr50Base·corr12Base(RULER-ringtruth §3). 손잡이는 바꾸지 않는다(--variant prior, σ·β 기본값).
"""
import sys, os, json, glob, math, subprocess, base64
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MACRO = os.path.join(ROOT, 'tools', 'genus-ruler', 'macro'); HAR = os.path.join(ROOT, '.harness', 'macro')
sys.path.insert(0, MACRO)
import importlib.util
spec = importlib.util.spec_from_file_location('macro', os.path.join(MACRO, 'macro.py')); M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)
GROUP = {'seoul': 'dev', 'kanazawa': 'dev'}
FLOOR = 0.181   # 대용 입력의 ringRmseTrue held 중앙값(0/1 마스크 대표성 바닥)

def run_variant(v, skip):
    scene_dir = os.path.join(HAR, 'sat' if v == 'sat' else f'sat-nwp-{v}'); syn_dir = os.path.join(HAR, f'syn-rt-{v}'); gate = os.path.join(HERE, f'gate-{v}-held.json')
    if not os.path.isdir(scene_dir): print(v, 'no scene dir', file=sys.stderr); return None
    if not skip:
        subprocess.run(['node', os.path.join(MACRO, 'downscale-run.mjs'), scene_dir, syn_dir, '--variant', 'prior'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['python3', os.path.join(MACRO, 'macro.py'), '--gate', scene_dir, syn_dir, '--out', gate, '--group', 'held'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return json.load(open(gate)), scene_dir, syn_dir

def scene_meta(scene_dir):
    meta = {}
    for f in glob.glob(os.path.join(scene_dir, '*.json')):
        if f.endswith('index.json'): continue
        sc = json.load(open(f)); meta[f"{sc['site']}_{sc['date']}"] = sc
    return meta

def date_block_ci(rows, key, B=1000, seed=7):
    dates = sorted({r['name'].rsplit('_', 1)[1] for r in rows}); by = {d: [r[key] for r in rows if r['name'].endswith(d) and r[key] is not None] for d in dates}
    rng = np.random.default_rng(seed); meds = []
    for _ in range(B):
        samp = [x for d in rng.choice(dates, size=len(dates), replace=True) for x in by[d]]
        if samp: meds.append(np.median(samp))
    return [float(np.percentile(meds, 2.5)), float(np.percentile(meds, 97.5))] if meds else None

def summarize(rows, label):
    keys = ('corr50Base', 'corr12Base', 'corr50C0', 'meanErrBaseDisc', 'ringRmseTrue', 'partialTrue')
    out = {'n': len(rows)}
    for k in keys:
        vals = [r[k] for r in rows if r.get(k) is not None]
        out[k] = {'q25': float(np.percentile(vals, 25)), 'med': float(np.median(vals)), 'q75': float(np.percentile(vals, 75))} if vals else None
    out['corr50Base_ci'] = date_block_ci(rows, 'corr50Base') if rows else None
    rr = [r['ringRmseTrue'] for r in rows]
    out['ringRmseTrue_nwp_share_med'] = float(np.median([math.sqrt(max(0.0, x * x - FLOOR * FLOOR)) for x in rr])) if rr else None
    print(f"{label:28s} n={out['n']:3d} corr50Base {out['corr50Base']['med'] if out['corr50Base'] else float('nan'):.3f} CI {out['corr50Base_ci']}  corr12Base {out['corr12Base']['med'] if out['corr12Base'] else float('nan'):.3f}  C0 {out['corr50C0']['med'] if out['corr50C0'] else float('nan'):.3f}  meanErr {out['meanErrBaseDisc']['med'] if out['meanErrBaseDisc'] else float('nan'):+.3f}  ringRmseTrue {out['ringRmseTrue']['med'] if out['ringRmseTrue'] else float('nan'):.3f} (NWP 몫 {out['ringRmseTrue_nwp_share_med']})")
    return out

def duplication_ratio(sc):
    """안쪽 19 점(관측점 + 5·10 km)에서 서로 다른 값의 비율 → 중복률 = 1 − distinct/n."""
    inner = [round(r['cover'], 4) for r in sc['ring'] if r['dist'] <= 10]
    return 1 - len(set(inner)) / len(inner) if inner else None

def ring_rmse_by_dist(sc, T, n, cell):
    out = {}
    rv = M.ring_values(T, sc['ring'], n, cell)
    for d in sorted({r['dist'] for r in sc['ring']}):
        idx = [i for i, r in enumerate(sc['ring']) if r['dist'] == d]
        out[d] = float(math.sqrt(np.mean([(rv[i] - sc['ring'][i]['cover']) ** 2 for i in idx])))
    return out

def main(argv):
    def opt(k, d): return argv[argv.index(k) + 1] if k in argv else d
    variants = opt('--variants', 'blend,blend-lm,blend-latest,blend-m1h,blend-p1h,jma,archive,era5').split(',')
    skip = '--skip-run' in argv
    R = {}
    sat = run_variant('sat', skip)
    if not sat: return 1
    sat_gate, sat_dir, sat_syn = sat
    R['surrogate'] = summarize(sat_gate['rows'], '대용(위성 7 km 평균)')
    sat_rows = {r['name']: r for r in sat_gate['rows']}
    for v in variants:
        res = run_variant(v, skip)
        if not res: continue
        gate, sdir, ssyn = res; meta = scene_meta(sdir)
        rows = gate['rows']
        single = [r for r in rows if not meta[r['name']].get('nwp', {}).get('multiPass')]
        multi = [r for r in rows if meta[r['name']].get('nwp', {}).get('multiPass')]
        R[v] = {'all': summarize(rows, f'{v} 전체'), 'single': summarize(single, f'{v} 단일 통과'), 'multi': summarize(multi, f'{v} multiPass') if multi else None}
        # 분리 지표: 중복률, 거리 고리별 ringRmseTrue, corr50(Barnes NWP ↔ Barnes 대용) — 보간 고정한 NWP 오차 몫
        dup = [duplication_ratio(meta[r['name']]) for r in rows]; R[v]['duplication_med'] = float(np.median([d for d in dup if d is not None])) if dup else None
        bydist = {}
        fixed = []
        for r in rows:
            sc = meta[r['name']]; n = sc['grid']; cell = sc['cellKm']; T = M.truth_grid(sc)
            for d, val in ring_rmse_by_dist(sc, T, n, cell).items(): bydist.setdefault(d, []).append(val)
            sy = os.path.join(ssyn, r['name'] + '.syn.json'); sy0 = os.path.join(sat_syn, r['name'] + '.syn.json')
            if os.path.exists(sy) and os.path.exists(sy0):
                B1 = M.load_u8(json.load(open(sy))['base'], n); B0 = M.load_u8(json.load(open(sy0))['base'], n); k50 = int(round(50 / cell))
                fixed.append(M.corr(M.box_mean(B1, k50), M.box_mean(B0, k50)))
        R[v]['ringRmseTrue_by_dist_med'] = {d: float(np.median(v_)) for d, v_ in bydist.items()}
        R[v]['corr50_barnesNWP_vs_barnesSurrogate_med'] = float(np.median(fixed)) if fixed else None
        # 대용 대비 장면별 차(짝)
        d50 = [r['corr50Base'] - sat_rows[r['name']]['corr50Base'] for r in rows if r['name'] in sat_rows]
        R[v]['delta_corr50_vs_surrogate_med'] = float(np.median(d50)) if d50 else None
        print(f"   중복률 {R[v]['duplication_med']}, 보간 고정 corr50(NWP↔대용 Barnes) {R[v]['corr50_barnesNWP_vs_barnesSurrogate_med']}, 거리별 ringRmseTrue {{{', '.join(f'{d}:{x:.2f}' for d, x in sorted(R[v]['ringRmseTrue_by_dist_med'].items()))}}}")
    # 민감도: blend vs ±1 h
    if 'blend' in R and 'blend-m1h' in R and 'blend-p1h' in R:
        b = R['blend']['single']['corr50Base']['med']; m = R['blend-m1h']['single']['corr50Base']['med']; p = R['blend-p1h']['single']['corr50Base']['med']
        R['sensitivity'] = {'blend': b, 'm1h': m, 'p1h': p, 'max_abs_diff': max(abs(b - m), abs(b - p)), 'pass': max(abs(b - m), abs(b - p)) <= 0.05}
        print('민감도 ±1 h: ', R['sensitivity'])
    if 'blend' in R and 'blend-latest' in R and R['blend']['multi'] and R['blend-latest']['multi']:
        R['multiPass_rule_gap'] = abs(R['blend']['multi']['corr50Base']['med'] - R['blend-latest']['multi']['corr50Base']['med'])
        print('multiPass closest vs latest corr50 차:', R['multiPass_rule_gap'])
    json.dump(R, open(os.path.join(HERE, 'ringtruth-results.json'), 'w'), indent=1, default=str)
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
