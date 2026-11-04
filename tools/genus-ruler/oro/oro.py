#!/usr/bin/env python3
"""
oro.py — RULER-oro judgement code (FROZEN file, ruler L874). Spec: tools/genus-ruler/oro/S3-design.md §6 (S3b).

  python3 -I tools/genus-ruler/oro/oro.py --fill-apply [--apply tools/genus-ruler/oro/oro-apply.json]
                                                       [--inputs tools/genus-ruler/oro/oro-inputs.json]
                                                       [--dem-grids tools/genus-ruler/oro/dem-grids.json] [--base .harness/oro/base]
  python3 -I tools/genus-ruler/oro/oro.py --ruler-hash [--ruler tools/genus-ruler/oro/RULER-oro.md]
  python3 -I tools/genus-ruler/oro/oro.py --precheck   [--root <repo>] [--frozen-commit <sha>]
  python3 -I tools/genus-ruler/oro/oro.py --judge      [--root <repo>] [--frozen-commit <sha>]

Modes (S3-design §6 table):
  --fill-apply  pre-freeze, MODIS-free: per scene λ_app, G7corr, maskedAppShare, m8.rmsDCapp (§6.1, M_in/W_in only) and the
                summary medians over `counted` scenes (lambdaAppMedian, lambdaTilde = max(1, median), G7median, G7pass,
                maskedAppShareMedian). Run after `oro_ref.py apply` (build order step 8b); idempotent.
  --ruler-hash  prints rulerHash (§9.2: sha256 of the ruler with the §10 body removed, L871).
  --precheck    post-freeze: §9.3 ④ checks 1–7, environment precheck (versions, T-free recompute of oro-apply, Q-56) and the
                T-read precheck (inputs present, bank vs bank-manifest by hashing only). No T read, no lock. Exit 0 iff ok.
  --judge       once, post-freeze: precheck → pre-T record → judge.lock → T read (trueGrid, PNG empty pixels) → every
                T-dependent value in one pass → one write of gate-oro-held.json (with a dev report block).
  --power / --sunset (§6.7, §6.8) are separate S3b steps and are not built in this file yet.

Contamination (§0.1): the open guard is installed first. Scene JSON `trueGrid` and bank PNG pixels are decoded only by
load_truth / empty_cells, which refuse a real bank path unless tools/genus-ruler/oro/judge.lock exists (C2); the guard
additionally refuses a real PNG under png-judge without the lock. Stdout: counts, statuses, sha256 and MODIS-free numbers
only (the judge prints progress counters only). git is called only with --quiet / --porcelain / --is-ancestor or with
pathspecs that never name the forbidden files (C4).
"""
import sys
sys.dont_write_bytecode = True          # no __pycache__ next to the tools (§0.2)

import importlib.util
import io
import itertools
import json
import math
import os
import platform
import subprocess
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def _load_ref():
    """oro_ref.py as module 'oro_ref' (one instance per process, so one guard and one allow() context)."""
    p = os.path.join(HERE, 'oro_ref.py')
    m = sys.modules.get('oro_ref')
    if m is not None and os.path.abspath(getattr(m, '__file__', '') or '') == p:
        return m
    spec = importlib.util.spec_from_file_location('oro_ref', p)
    m = importlib.util.module_from_spec(spec)
    sys.modules['oro_ref'] = m
    spec.loader.exec_module(m)
    return m


O = _load_ref()
O.install_guard()                       # guard first (§0.1)

import numpy as np                      # noqa: E402  (after the guard)

M = O.load_tool('macro_ruler', 'tools/genus-ruler/macro/macro.py')     # only load_u8, box_mean, corr are used (§6)
load_u8, box_mean, corr = M.load_u8, M.box_mean, M.corr

# ───────────────────────── constants (ruler §4, §4.7, §5; S3-design §6) ─────────────────────────
SEED = 20261103                 # L599, L604
BOOT_B = 10000                  # L599
SF_EXACT_MAX_G = 16             # L603
SF_MC = 65536                   # L604
FISHER_CLIP = 0.999999          # S3-design §6.4
SIGMA_FINE_M = 10000.0          # G₁₀ (L568)
P_C2 = 0.025                    # c2, c3 (L628, L630)
P_C3B = 0.10                    # c3b (L631)
C3B_MIN_SCENES = 10             # L355
RHO_ROT_TAG = 0.03              # L676
SMALL_RHO_U95 = 0.05            # L664
SMALL_D_U95 = 0.10              # L664, L667
C4_L95 = -0.01                  # L632
C5_CORR50 = -0.01               # L633
C5_MEANERR = 0.01               # L633
G7_MIN = 0.7                    # L754
NEXT = 65                       # extended 12 km box tiling (S3-design §0.3)
EXT_W0 = 25                     # window box (bi, bj) = extended (bi + 25, bj + 25)
K12, K50 = 4, 17                # macro.py corr12 / corr50 boxes at 3 km (round(12/3), round(50/3))
SL12 = slice(98, 158)           # macro.py corr12 window: 3 km rows/cols 98..157 (±90 km)
DISC_KM = 380.0                 # macro.py meanErr disc
NEAR_KM = 15.0                  # screen weight (L563, Q-2)
N_NEAR_TILING = 5               # Q-2
DARK_MAX = 0.02                 # dark px (report, L348)
BLOCK_EPOCH = date(2026, 9, 1)  # 8-day blocks (L742, Q-54)
BLOCK_DAYS = 8
BANDS = O.BANDS
ORO_REL = 'tools/genus-ruler/oro'
TAG_MORNING = '아침(Terra ≈ 09:00) 판정'
FROZEN_REQUIRED = ('oro-apply.json', 'oro-inputs.json', 'dem-grids.json')     # G8(c): their hashes must be in FROZEN
EXPOSURE_TAG = {'held 장면별': '동결 전 held 장면별 노출(§0.5)', '모름': '동결 전 held 장면별 노출(§0.5)',
                'held 집계': '동결 전 held 집계 노출(§0.5)'}


# ═══════════════════════ helpers ═══════════════════════
def _f(x):
    return None if x is None else float(x)


def median(v):
    v = [x for x in v if x is not None]
    return float(np.median(np.array(v, dtype=np.float64))) if v else None


def mean(v):
    v = [x for x in v if x is not None]
    return float(np.mean(np.array(v, dtype=np.float64))) if v else None


def pearson_def(a, b):
    """(O.pearson(a, b), defined): defined = n ≥ 2 and both variances non-zero (the d rule of L519 needs to know
    when a Pearson is 'not defined' — O.pearson returns 0.0 for zero variance per L500)."""
    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    v = O.pearson(a, b)
    if a.size < 2:
        return v, False
    x, y = a - a.mean(), b - b.mean()
    return v, bool(float(np.dot(x, x)) != 0.0 and float(np.dot(y, y)) != 0.0)


def _trim(c):
    """combine() result without the large intermediates."""
    return {'C': c['C'], 'dC': c['dC'], 'ok': bool(c['ok']), 'maxGdC': c['maxGdC'], 'iters': c['iters']}


# ═══════════════════════ §6.1 app path arm (§4.4 L544-L548) ═══════════════════════
def tau_band(ring_vals, dist, first):
    """Port of macroTileCover (volumetricScene.ts:1028-1033): finite points < 12 → first; near = covers (clamped to
    [0, 1], sorted) of points with dist ≤ 150 km (observer included); len < 6 → first; else max(first,
    near[min(len − 1, floor(0.75·len))]). first = that band's ring point 0 (null → 0, Q-36)."""
    v = np.asarray(ring_vals, dtype=np.float64)
    d = np.asarray(dist, dtype=np.float64)
    fin = np.isfinite(v)
    if int(fin.sum()) < O.RING_MIN_POINTS:
        return float(first)
    near = np.sort(np.clip(v[fin & (d <= 150.0)], 0.0, 1.0))
    if near.size < 6:
        return float(first)
    return float(max(first, near[min(near.size - 1, int(math.floor(near.size * 0.75)))]))


def ring_first(ring_vals):
    v = float(np.asarray(ring_vals, dtype=np.float64)[0])
    return 0.0 if not math.isfinite(v) else v


def app_total(C_lo, C_mid, B_hi):
    """1 − (1 − C_lo)(1 − C_mid)(1 − C_hi) with C_hi = B_hi (L545)."""
    return 1.0 - (1.0 - C_lo) * (1.0 - C_mid) * (1.0 - B_hi)


def app_fields(Bs, C_lo, C_mid, taus):
    """ΔC^app (pre-cap total, L545) and the visible fields C^vis, B^vis, ΔC^vis (L546-L548) from band fields."""
    B_lo, B_mid, B_hi = Bs['low'], Bs['mid'], Bs['high']
    Capp = app_total(C_lo, C_mid, B_hi)
    Bapp = app_total(B_lo, B_mid, B_hi)
    tl, tm, th = taus['low'], taus['mid'], taus['high']
    Cvis = app_total(np.minimum(C_lo, tl), np.minimum(C_mid, tm), np.minimum(B_hi, th))
    Bvis = app_total(np.minimum(B_lo, tl), np.minimum(B_mid, tm), np.minimum(B_hi, th))
    return {'dCapp': Capp - Bapp, 'Cvis': Cvis, 'Bvis': Bvis, 'dCvis': Cvis - Bvis}


def app_arm(Bs, F, rings, dist, low_only=False, sigma_G_m=O.SIGMA_G_M):
    """App path arm (§6.1): own combiner per band (own δ), C_hi = B_hi; low_only → C_mid = B_mid (§6 arm, L738)."""
    clo = O.combine(Bs['low'], F, sigma_G_m=sigma_G_m)
    C_mid = Bs['mid']
    cmi = None
    if not low_only:
        cmi = O.combine(Bs['mid'], F, sigma_G_m=sigma_G_m)
        C_mid = cmi['C']
    taus = {b: tau_band(rings[b], dist, ring_first(rings[b])) for b in ('low', 'mid', 'high')}
    out = app_fields(Bs, clo['C'], C_mid, taus)
    out['taus'] = taus
    out['okLow'] = bool(clo['ok'])
    out['okMid'] = None if cmi is None else bool(cmi['ok'])
    return out


def lambda_app(a15, d15, W):
    """λ_app = Σ_W ΔC^app ΔC / Σ_W ΔC² (box values, L510); None when Σ_W ΔC² = 0."""
    den = float(np.sum(d15[W] ** 2))
    return None if den == 0.0 else float(np.sum(a15[W] * d15[W]) / den)


def masked_app_share(a15, Min):
    """Σ_{b∈M_in}(ΔC^app_b)² / Σ_{225}(ΔC^app_b)² (L308, L564); None when the window total is 0."""
    den = float(np.sum(a15 ** 2))
    return None if den == 0.0 else float(np.sum(a15[Min] ** 2) / den)


def fill_scene(sc, row, dem, Bs):
    """§6.1 MODIS-free values of one oro-apply row; also checks that the judge-path combiner reproduces the row (same
    frozen code ⇒ bit-identical). Returns (lambdaApp, G7corr, maskedAppShare, rmsDCapp)."""
    tm = sc['times']['closest']
    snd = tm['snd']
    F = O.forcing(dem['hsub'], snd, sc['lat'])
    cj = O.combine(Bs['total'], F)
    if cj['maxGdC'] != row['A6']['judge']['maxGdC'] or cj['iters'] != row['A6']['judge']['iters']:
        raise ValueError('fill-apply: judge-path combiner differs from the oro-apply row (rebuild oro-apply with this code)')
    app = app_arm(Bs, F, O.ring_arrays(tm), sc['ringGeom']['dist'])
    mk = O.masks_input(dem['hmax6'], tm['zSnow'], Bs['high'])
    d15, a15 = O.box15(cj['dC']), O.box15(app['dCapp'])
    W = mk['W_in']
    return (lambda_app(a15, d15, W), O.pearson(d15[W], a15[W]), masked_app_share(a15, mk['M_in']),
            float(np.sqrt(np.mean(a15 ** 2))))


def fill_apply_doc(doc, inputs, dg, base_dir, code_sha=None):
    """Fill the §6.1 placeholders of an oro-apply document in place (and return it). Rows whose combiner did not run
    (A6.judge null) keep null. Medians over `counted` scenes (M6)."""
    cache = O.SiteCache(dg)
    for name in sorted(doc['scenes']):
        row = doc['scenes'][name]
        row['lambdaApp'] = row['G7corr'] = row['maskedAppShare'] = None
        row['m8']['rmsDCapp'] = None
        if row['A6']['judge'] is None:
            continue
        sc = inputs['scenes'][name]
        Bs = {b: O.load_B(name, 'closest', b, inputs, base_dir) for b in BANDS}
        lam, g7, share, rms = fill_scene(sc, row, cache.get(sc['site']), Bs)
        row['lambdaApp'], row['G7corr'], row['maskedAppShare'] = lam, g7, share
        row['m8']['rmsDCapp'] = rms
    cnt = [doc['scenes'][n] for n in sorted(doc['scenes']) if doc['scenes'][n]['counted']]
    sm = doc['summary']
    sm['lambdaAppMedian'] = median([r['lambdaApp'] for r in cnt])
    sm['lambdaTilde'] = None if sm['lambdaAppMedian'] is None else max(1.0, sm['lambdaAppMedian'])
    sm['G7median'] = median([r['G7corr'] for r in cnt])
    sm['G7pass'] = None if sm['G7median'] is None else bool(sm['G7median'] >= G7_MIN)
    sm['maskedAppShareMedian'] = median([r['maskedAppShare'] for r in cnt])
    if code_sha is not None:
        doc['sources']['code']['oro.py'] = code_sha
    return doc


def fill_apply(apply_path, inputs_path, dem_path, base_dir):
    with open(apply_path) as f:
        doc = json.load(f)
    with open(inputs_path) as f:
        inputs = json.load(f)
    with open(dem_path) as f:
        dg = json.load(f)
    if doc['sources']['oroInputsSha256'] != O.sha256_file(inputs_path):
        raise ValueError('fill-apply: oro-apply was not built from this oro-inputs.json')
    if doc['sources']['demGridsSha256'] != O.sha256_file(dem_path):
        raise ValueError('fill-apply: oro-apply was not built from this dem-grids.json')
    fill_apply_doc(doc, inputs, dg, base_dir, O.sha256_file(os.path.abspath(__file__)))
    return doc


# ═══════════════════════ §6.2 truth and judge-time masks ═══════════════════════
def _needs_lock(path):
    """Real bank content (a path the guard restricts) is decoded only while judge.lock exists (C2, §6.6)."""
    if O.guard_verdict(path) is not None and not os.path.exists(O.JUDGE_LOCK):
        raise PermissionError(f'oro: judge.lock required before decoding {O.rel(path)}')


def truth_from_u8(g):
    """u8/255 grid (256², row 0 = north as fetched) → T256 (row 0 = south), T (128², 2×2 mean), T64 (64², 4×4 mean)."""
    T256 = np.ascontiguousarray(np.asarray(g, dtype=np.float64)[::-1, :])
    return {'T256': T256, 'T': T256.reshape(128, 2, 128, 2).mean(axis=(1, 3)),
            'T64': T256.reshape(64, 4, 64, 4).mean(axis=(1, 3))}


def load_truth(path):
    """Scene JSON → T (L488): trueGrid → macro.load_u8(·, 256) → flip rows (fetch row 0 = north) → 2×2 mean. Only the
    `trueGrid` and `grid` keys are read; the parsed object is dropped here. No trueGrid (or no file) → None (L343)."""
    _needs_lock(path)
    if not os.path.exists(path):
        return None
    with O.allow('scene-json'):
        with open(path, 'rb') as f:
            raw = f.read()
    sc = tg = None
    try:
        sc = json.loads(raw)
        tg = sc.get('trueGrid') if isinstance(sc, dict) else None
        if not isinstance(tg, str):
            return None
        if sc.get('grid') != 256:
            raise ValueError(f'{O.rel(path)}: grid is not 256')
        g = load_u8(tg, 256)
    finally:
        del sc, tg, raw
    return truth_from_u8(g)


def empty_from_rgb(a):
    """RGB u8 (256, 256, 3), row 0 = north → (empty, dark) bool 256², row 0 = south (L345, L348)."""
    a = np.asarray(a)
    if a.shape != (256, 256, 3):
        raise ValueError('scene PNG is not 256² RGB')
    a = a[::-1]
    empty = (a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 0)
    dark = (a.max(axis=2).astype(np.float64) / 255.0 < DARK_MAX) & ~empty
    return empty, dark


def empty_cells(path):
    """Scene PNG → (empty, dark) 3 km px (§6.2). Real bank PNGs are opened under allow('png-judge') (guard needs the lock)."""
    from PIL import Image
    _needs_lock(path)
    with O.allow('png-judge'):
        with open(path, 'rb') as f:
            body = f.read()
    a = np.asarray(Image.open(io.BytesIO(body)).convert('RGB'))
    del body
    return empty_from_rgb(a)


def ext_idx6(n=128):
    """6 km row/col → extended box row/col (r + 1)//2 ∈ 0..64."""
    return (np.arange(n) + 1) // 2


def ext_idx3(n=256):
    """3 km row/col → 6 km row p//2 → extended box ((p//2) + 1)//2."""
    return (np.arange(n) // 2 + 1) // 2


def _pad130(X, fill):
    P = np.full((130, 130), fill, dtype=np.float64)
    P[1:129, 1:129] = X
    return P


def ext_box_max(X):
    return _pad130(X, -np.inf).reshape(NEXT, 2, NEXT, 2).max(axis=(1, 3))


def ext_box_mean(X):
    s = _pad130(X, 0.0).reshape(NEXT, 2, NEXT, 2).sum(axis=(1, 3))
    c = _pad130(np.ones((128, 128)), 0.0).reshape(NEXT, 2, NEXT, 2).sum(axis=(1, 3))
    return s / c


def ext_empty(empty256):
    """Extended boxes with ≥ 1 empty 3 km px."""
    e6 = np.asarray(empty256, dtype=bool).reshape(128, 2, 128, 2).any(axis=(1, 3))
    return _pad130(e6.astype(np.float64), 0.0).reshape(NEXT, 2, NEXT, 2).max(axis=(1, 3)) > 0


def judge_masks(hmax6, zSnow, Bhi, empty256=None, margin_m=O.SNOW_MARGIN_M, hi=O.HI_MASK, snow_on=True, high_on=True):
    """M_judge = snow ∪ high ∪ empty on the extended tiling (R4, L491-L495). The window part of snow/high is exactly
    oro_ref.masks_input (same thresholds, same box arithmetic). snow_on/high_on False → that mask off (§6 arms)."""
    snow = np.ones((NEXT, NEXT), dtype=bool) if zSnow is None else ext_box_max(hmax6) >= zSnow - margin_m
    high = ext_box_mean(Bhi) >= hi
    mi = O.masks_input(hmax6, zSnow, Bhi, margin_m=margin_m, hi=hi)
    w = slice(EXT_W0, EXT_W0 + O.NBOX)
    snow[w, w] = mi['snow']
    high[w, w] = mi['high']
    if not snow_on:
        snow[:] = False
    if not high_on:
        high[:] = False
    empty = np.zeros((NEXT, NEXT), dtype=bool) if empty256 is None else ext_empty(empty256)
    Mx = snow | high | empty
    return {'ext': Mx, 'snow': snow[w, w], 'high': high[w, w], 'empty': empty[w, w], 'M': Mx[w, w], 'W': ~Mx[w, w]}


def mask6(Mext):
    """1 on 6 km cells outside M (G₁₀ ⊛_M weight m, L568), from the extended tiling."""
    e = ext_idx6()
    return (~Mext[e[:, None], e[None, :]]).astype(np.float64)


def mask3(Mext):
    """True on masked 3 km cells (4×4 per window box, extended tiling; c4·c5, L495)."""
    e = ext_idx3()
    return Mext[e[:, None], e[None, :]]


# 64² × 12 km arm (L740, Q-52): 24 km boxes = 2×2 of 12 km cells; window = 12 km cells 24..39 → boxes 12..19 (even)
def box8(X):
    return np.asarray(X, dtype=np.float64)[24:40, 24:40].reshape(8, 2, 8, 2).mean(axis=(1, 3))


def judge_masks64(hmax12, zSnow, Bhi64, empty256=None, margin_m=O.SNOW_MARGIN_M, hi=O.HI_MASK):
    snow = np.ones((32, 32), dtype=bool) if zSnow is None else (
        np.asarray(hmax12).reshape(32, 2, 32, 2).max(axis=(1, 3)) >= zSnow - margin_m)
    high = np.asarray(Bhi64).reshape(32, 2, 32, 2).mean(axis=(1, 3)) >= hi
    empty = (np.zeros((32, 32), dtype=bool) if empty256 is None
             else np.asarray(empty256, dtype=bool).reshape(32, 8, 32, 8).any(axis=(1, 3)))
    Mx = snow | high | empty
    w = slice(12, 20)
    e = np.arange(64) // 2
    return {'ext': Mx, 'M': Mx[w, w], 'W': ~Mx[w, w], 'm12': (~Mx[e[:, None], e[None, :]]).astype(np.float64)}


# ═══════════════════════ §6.3 per-scene metrics ═══════════════════════
def sets(d15, dr15, W):
    S = W & (np.abs(d15) >= O.DC_SEL)
    Su = W & ((np.abs(d15) >= O.DC_SEL) | (np.abs(dr15) >= O.DC_SEL))
    return S, Su


def beta_res(d15, r15, W):
    den = float(np.sum(d15[W] ** 2))
    return None if den == 0.0 else float(np.sum(d15[W] * r15[W]) / den)


def dmse(d15, r15, W, lam=1.0):
    """ΔMSE_W(λ) = mean_W(λ²ΔC² − 2λΔC r) (L506, L513); λ = 1 is ΔMSE_W."""
    if not W.any():
        return None
    return float(np.mean(lam * lam * d15[W] ** 2 - 2.0 * lam * d15[W] * r15[W]))


def d_pair(a15, b15, r15, Su, rev_ok=True):
    """G-rev d = Pearson_{S∪}(ΔC, r) − Pearson_{S∪}(ΔC_rev, r); either undefined, or the G-rev combiner failed → 0 (L519, L354)."""
    if not rev_ok:
        return 0.0
    p1, ok1 = pearson_def(a15[Su], r15[Su])
    p2, ok2 = pearson_def(b15[Su], r15[Su])
    if not (ok1 and ok2):
        return 0.0
    return float(p1 - p2)


def lminus(d15, dr15, r15, W, S, sea15, h15, mode='strata'):
    """L⁻ (L551-L562). mode 'strata' = sea stratum (sea_box ∩ W) + land h tertiles (np.quantile linear; h ≤ q₁ → 1,
    q₁ < h ≤ q₂ → 2, else 3); 'tertile' = h tertiles of all W (3-draft form, report); 'window' = 2-draft form
    mean_{Lee} r − mean_W r (report). Lee = {b ∈ S: ΔC_b ≤ −0.02}; N = {b ∈ W: |ΔC_b| < 0.02 ∧ |ΔC_rev,b| < 0.02}.
    Strata with |Lee_t| > 0 and |N_t| > 0, weights ∝ |Lee_t|; none → 0."""
    Lee = S & (d15 <= -O.DC_SEL)
    if mode == 'window':
        return float(np.mean(r15[Lee]) - np.mean(r15[W])) if Lee.any() else 0.0
    N = W & (np.abs(d15) < O.DC_SEL) & (np.abs(dr15) < O.DC_SEL)
    if mode == 'strata':
        sea = W & sea15
        land = W & ~sea15
    elif mode == 'tertile':
        sea = np.zeros_like(W)
        land = W.copy()
    else:
        raise ValueError(mode)
    strata = [sea]
    if land.any():
        q1, q2 = np.quantile(h15[land], [1.0 / 3.0, 2.0 / 3.0])
        strata += [land & (h15 <= q1), land & (h15 > q1) & (h15 <= q2), land & (h15 > q2)]
    num, den = 0.0, 0
    for t in strata:
        lt, nt = Lee & t, N & t
        if lt.any() and nt.any():
            k = int(lt.sum())
            num += k * (float(np.mean(r15[lt])) - float(np.mean(r15[nt])))
            den += k
    return float(num / den) if den else 0.0


def fine_coarse(X, m6, dx_m=O.DX_M):
    """X_coarse = G₁₀*(X·m)/G₁₀*m (masked normalised Gaussian, σ 10 km, 3σ, non-periodic), X_fine = X − X_coarse (L567-L570)."""
    coarse = O.gauss_smooth(X, SIGMA_FINE_M, mask=m6, dx_m=dx_m)
    return X - coarse, coarse


def up256(X):
    """128² → 256² bilinear, 3 km cell c ↦ 6 km coordinate c/2 − 0.25 clamped to [0, 127] (sampleGrid formula, Q-40)."""
    X = np.asarray(X, dtype=np.float64)
    f = np.clip(np.arange(256) / 2.0 - 0.25, 0.0, 127.0)
    i0 = np.floor(f).astype(np.int64)
    i1 = np.minimum(i0 + 1, 127)
    t = f - i0
    a, b = X[i0[:, None], i0[None, :]], X[i0[:, None], i1[None, :]]
    c, d = X[i1[:, None], i0[None, :]], X[i1[:, None], i1[None, :]]
    tx, ty = t[None, :], t[:, None]
    return (a + (b - a) * tx) * (1.0 - ty) + (c + (d - c) * tx) * ty


def disc3():
    """macro.py meanErr disc: 3 km cell centre within 380 km."""
    yy, xx = np.mgrid[0:256, 0:256]
    return ((xx + 0.5) * 3.0 - 384.0) ** 2 + ((yy + 0.5) * 3.0 - 384.0) ** 2 <= DISC_KM ** 2


_DISC = None


def c45(C, B, T256, m3=None):
    """Δcorr12, Δcorr50, ΔmeanErr (L583-L585): C, B bilinear to 256²; macro.py formulas. With a mask m3 (True =
    masked 3 km cell): corr12 drops box positions whose 4×4 window touches a masked cell; corr50 uses the masked mean
    Σ(X·m)/Σm and drops positions with Σm < half the window count; meanErr uses disc ∩ unmasked. Δ = (C vs T) − (B vs T)."""
    global _DISC
    if _DISC is None:
        _DISC = disc3()
    Cu, Bu = up256(C), up256(B)
    T = np.asarray(T256, dtype=np.float64)
    if m3 is None:
        c12 = [corr(box_mean(X, K12)[SL12, SL12], box_mean(T, K12)[SL12, SL12]) for X in (Cu, Bu)]
        c50 = [corr(box_mean(X, K50), box_mean(T, K50)) for X in (Cu, Bu)]
        sel = _DISC
    else:
        mf = np.asarray(m3, dtype=np.float64)
        ok12 = box_mean(mf, K12)[SL12, SL12] == 0.0
        c12 = [corr(box_mean(X, K12)[SL12, SL12][ok12], box_mean(T, K12)[SL12, SL12][ok12]) if ok12.any() else 0.0
               for X in (Cu, Bu)]
        um = 1.0 - mf
        mu = box_mean(um, K50)
        keep = mu >= 0.5
        if keep.any():
            tb = box_mean(T * um, K50)[keep] / mu[keep]
            c50 = [corr(box_mean(X * um, K50)[keep] / mu[keep], tb) for X in (Cu, Bu)]
        else:
            c50 = [0.0, 0.0]
        sel = _DISC & ~np.asarray(m3, dtype=bool)
    if sel.any():
        me = [float(X[sel].mean() - T[sel].mean()) for X in (Cu, Bu)]
        dme = me[0] - me[1]
    else:
        dme = None
    return {'dcorr12': c12[0] - c12[1], 'dcorr50': c50[0] - c50[1], 'dmeanErr': dme}


def wl_contrast(F15, r15, W):
    """Windward/lee contrast (L587): W boxes, mean r over F ≥ q₂ minus mean r over F ≤ q₁ (box F tertiles)."""
    if not W.any():
        return None
    q1, q2 = np.quantile(F15[W], [1.0 / 3.0, 2.0 / 3.0])
    hi, lo = W & (F15 >= q2), W & (F15 <= q1)
    if not (hi.any() and lo.any()):
        return None
    return float(np.mean(r15[hi]) - np.mean(r15[lo]))


def box_dist_km():
    bi, bj = np.mgrid[0:O.NBOX, 0:O.NBOX]
    return np.hypot(12.0 * (bj - 7), 12.0 * (bi - 7))


NEAR15 = box_dist_km() <= NEAR_KM


def screen_weight(d15, r15, W):
    """ΔMSE_W split into boxes with centre ≤ 15 km (5 boxes on this tiling, Q-2) and the rest of the window (L563)."""
    near, far = W & NEAR15, W & ~NEAR15
    return {'dMSEnear': dmse(d15, r15, near), 'dMSEfar': dmse(d15, r15, far), 'nNear': int(near.sum()),
            'nFar': int(far.sum()), 'nNearTiling': N_NEAR_TILING}


def rho_d(d15, dr15, r15, W, rev_ok, fine=None, use_S_for_d=False, drop=None):
    """Core of the main path and of every sensitivity arm: S, S∪ from total ΔC (L498-L499, fine uses the same sets,
    L576); ρ_res, d (and ρ_fine, d_fine when fine = (ΔC_fine, ΔC_rev,fine, r_fine) box arrays). drop: boxes removed
    from W, S, S∪ (box-level splits)."""
    if drop is not None:
        W = W & ~drop
    S, Su = sets(d15, dr15, W)
    dset = S if use_S_for_d else Su
    out = {'nW': int(W.sum()), 'nS': int(S.sum()), 'nSu': int(Su.sum()),
           'rho_res': O.pearson(d15[S], r15[S]), 'd': d_pair(d15, dr15, r15, dset, rev_ok)}
    if fine is not None:
        fd, fdr, fr = fine
        out['rho_fine'] = O.pearson(fd[S], fr[S])
        out['d_fine'] = d_pair(fd, fdr, fr, dset, rev_ok)
    return out


def star(core, primary):
    """(ρ*, d*) of a core result: fine versions when the primary metric is ρ_fine (L575-L576)."""
    if primary == 'rho_fine':
        return core.get('rho_fine'), core.get('d_fine')
    return core['rho_res'], core['d']


# ═══════════════════════ §6.4 statistics (L597-L607) ═══════════════════════
def date_block_ci(values, dates, stat=None, B=BOOT_B, seed=SEED):
    """Port of eval-ringtruth.date_block_ci (same form, L600): blocks = sorted distinct dates; a fresh
    default_rng(seed) per call; each replicate rng.choice(blocks, size=G, replace=True), concatenate the values of the
    drawn blocks, stat; percentiles 2.5 / 97.5 (numpy linear). None values are left out (as the original)."""
    stat = np.median if stat is None else stat
    blocks = sorted(set(dates))
    by = {d: [v for v, dd in zip(values, dates) if dd == d and v is not None] for d in blocks}
    rng = np.random.default_rng(seed)
    meds = []
    for _ in range(B):
        samp = [x for d in rng.choice(blocks, size=len(blocks), replace=True) for x in by[d]]
        if samp:
            meds.append(stat(samp))
    return [float(np.percentile(meds, 2.5)), float(np.percentile(meds, 97.5))] if meds else None


def _rowstat(X, stat):
    if stat == 'median':
        return np.median(X, axis=1)
    if stat == 'mean':
        return np.mean(X, axis=1)
    raise ValueError(stat)


def sign_flip_p(values, dates, stat='median'):
    """One-sided date-block sign-flip p (D11, L601-L604): G = #dates; G ≤ 16 → all 2^G sign vectors
    (itertools.product((1, −1)), identity included), p = #(stat_flip ≥ stat_obs)/2^G; G > 16 → default_rng(20261103)
    .choice([1, −1], size=(65536, G)), p = (1 + #≥)/65537. Ties count as ≥."""
    pairs = [(v, d) for v, d in zip(values, dates) if v is not None]
    if not pairs:
        return None
    vals = np.array([v for v, _ in pairs], dtype=np.float64)
    blocks = sorted({d for _, d in pairs})
    pos = {b: i for i, b in enumerate(blocks)}
    idx = np.array([pos[d] for _, d in pairs], dtype=np.int64)
    G = len(blocks)
    if G <= SF_EXACT_MAX_G:
        signs = np.array(list(itertools.product((1, -1), repeat=G)), dtype=np.float64)
    else:
        signs = np.random.default_rng(SEED).choice([1, -1], size=(SF_MC, G)).astype(np.float64)
    st = _rowstat(vals[None, :] * signs[:, idx], stat)
    obs = _rowstat(vals[None, :] * np.ones((1, G))[:, idx], stat)[0]
    cnt = int(np.sum(st >= obs))
    return cnt / float(2 ** G) if G <= SF_EXACT_MAX_G else (1.0 + cnt) / (SF_MC + 1.0)


def block8(d):
    """8-day block id on the fixed 4-day calendar (L742, Q-54): (date − 2026-09-01).days // 8."""
    y, m, dd = (int(x) for x in d.split('-'))
    return (date(y, m, dd) - BLOCK_EPOCH).days // BLOCK_DAYS


def fisher_stat(pairs):
    """|S|-weighted Fisher z mean (L589): z = atanh(clip(ρ, ±0.999999)), weight |S| − 3 → tanh(Σwz/Σw)."""
    z = np.array([math.atanh(min(max(p, -FISHER_CLIP), FISHER_CLIP)) for p, _ in pairs], dtype=np.float64)
    w = np.array([n - 3.0 for _, n in pairs], dtype=np.float64)
    if float(w.sum()) <= 0.0:
        return None
    return float(math.tanh(float(np.sum(w * z) / np.sum(w))))


def summary_stat(values, dates, stat='median', with_p=False):
    """{n, value (median or mean), ci [L95, U95], p?} with date blocks."""
    fn = np.median if stat == 'median' else np.mean
    vals = [v for v in values if v is not None]
    out = {'n': len(vals), 'value': (median if stat == 'median' else mean)(values),
           'ci': date_block_ci(values, dates, fn) if vals else None}
    if with_p:
        out['p'] = sign_flip_p(values, dates, stat) if vals else None
    return out


def L95(s):
    return None if (s is None or s.get('ci') is None) else s['ci'][0]


def U95(s):
    return None if (s is None or s.get('ci') is None) else s['ci'][1]


def _gt(a, b):
    return a is not None and a > b


def _ge(a, b):
    return a is not None and a >= b


def _le(a, b):
    return a is not None and a <= b


def _lt(a, b):
    return a is not None and a < b


# ═══════════════════════ §6.5 clauses, actions, tags (§5) ═══════════════════════
def clause_c1(names, rows):
    per = {}
    for n in names:
        per[rows[n]['site']] = per.get(rows[n]['site'], 0) + 1
    n = len(names)
    nd = len({rows[x]['date'] for x in names})
    share = max(per.values()) / n if n else None
    c = {'n': n, 'dates': nd, 'sites': len(per), 'perSite': dict(sorted(per.items())), 'maxShare': share,
         'n>=20': n >= 20, 'dates>=8': nd >= 8, 'sites>=3': len(per) >= 3, 'maxShare<=0.5': bool(share is not None and share <= 0.5)}
    c['pass'] = bool(c['n>=20'] and c['dates>=8'] and c['sites>=3'] and c['maxShare<=0.5'])
    return c


def clauses(st):
    """c1–c8 from the statistics dict `st` (S3-design §6.5, L627-L636). Booleans only; values stay in st."""
    c = {}
    c['c1'] = st['c1']['pass']
    r, d = st['rho'], st['d']
    c['c2'] = bool(_gt(r['value'], 0.0) and _gt(L95(r), 0.0) and _le(r.get('p'), P_C2))
    c['c2b'] = bool(_le(st['dMSE']['value'], 0.0))
    c['c3'] = bool(_gt(d['value'], 0.0) and _gt(L95(d), 0.0) and _le(d.get('p'), P_C2))
    if not st['c3bMeasurable']:
        c['c3b'] = '못 잼'
    else:
        s = st['dshuf']
        c['c3b'] = bool(_gt(s['value'], 0.0) and _le(s.get('p'), P_C3B))
    c['c4'] = bool(_ge(st['dcorr12']['value'], 0.0) and _ge(L95(st['dcorr12']), C4_L95))
    c['c5'] = bool(_ge(st['dcorr50']['value'], C5_CORR50) and st['dmeanErr']['value'] is not None
                   and abs(st['dmeanErr']['value']) <= C5_MEANERR)
    c['c6'] = 'report'
    c['c7'] = bool(st['c7'])
    c['c8'] = bool(_ge(st['rhoVis']['value'], 0.0) and _lt(st['Lminus']['value'], 0.0))
    return c


def _ci_txt(s):
    return {'median': s.get('value'), 'ci': s.get('ci')}


def action(c, st, exposure_grade=None):
    """First matching action line (L646-L683) with its tags; every failed clause listed."""
    failed = [k for k in ('c1', 'c2', 'c2b', 'c3', 'c3b', 'c4', 'c5', 'c7', 'c8') if c[k] is not True]
    exp = EXPOSURE_TAG.get(exposure_grade)
    out = {'failed': failed, 'tags': [], 'notes': [], 'register': None}

    def done(line, verdict, reason=None):
        out.update({'line': line, 'verdict': verdict, 'reason': reason})
        if exp:
            out['tags'].append(exp)
        return out
    if c['c7'] is not True:
        return done('1', '가드 실패', '가드 실패(짝짓기 전) — 고친 뒤 가드만 다시 잼')
    if c['c1'] is not True:
        return done('2', '미결', 'c1 이 §2.7 끝까지 안 맞음')
    c2, c3 = c['c2'] is True, c['c3'] is True
    if c2 and c3:
        if c['c3b'] is not True:
            if c['c2b'] is not True:
                out['register'] = {'kappaTimesBetaTilde': st['beta']['value']}
            out['notes'] += [k for k in ('c2b', 'c8') if c[k] is not True]
            return done('3-1', '미결', 'G-shuf 못 잼' if c['c3b'] == '못 잼' else '사이트에 고정된 지형·지표 무늬와 구분 안 됨')
        if c['c2b'] is not True:
            out['register'] = {'kappaTimesBetaTilde': st['beta']['value']}
            out['tags'].append('진폭 과대' if _gt(L95(st['dMSE']), 0.0) else '진폭 못 가름(점 추정만 > 0)')
            out['notes'].append({'dMSE': _ci_txt(st['dMSE'])})
            return done('3-2', '불합격')
        if c['c8'] is not True:
            opp = _lt(U95(st['rhoVis']), 0.0) or _gt(L95(st['Lminus']), 0.0)
            out['tags'].append('보이는 쪽 반대' if opp else '보이는 쪽 못 가름(점 추정만)')
            out['notes'].append({'rhoVis': _ci_txt(st['rhoVis']), 'Lminus': _ci_txt(st['Lminus'])})
            return done('3-3', '불합격')
        if c['c4'] is not True or c['c5'] is not True:
            fl = [k for k in ('c4', 'c5') if c[k] is not True]
            out['tags'].append(f'방향 통과·{"·".join(fl)} 실패')
            out['notes'].append({k: ({'dcorr12': _ci_txt(st['dcorr12'])} if k == 'c4' else
                                     {'dcorr50': _ci_txt(st['dcorr50']), 'dmeanErr': _ci_txt(st['dmeanErr'])}) for k in fl})
            return done('3-4', '불합격')
        # 3-5 pass tags (L674-L683)
        tags = out['tags']
        if _gt(st['dshuf'].get('p'), P_C2):
            tags.append('사이트 고정 무늬와 약하게만 가름(p 값)')
        if st['rhoRot']['value'] is not None and abs(st['rhoRot']['value']) > RHO_ROT_TAG:
            tags.append('null 이 0 이 아님')
        if st['rhoEven']['value'] is not None and st['rhoOdd']['value'] is not None \
                and st['rhoEven']['value'] >= st['rhoOdd']['value']:
            tags.append('높이 착시 몫이 바람 홀수 몫만큼 큼')
        if st['primary'] == 'rho_res':
            if _le(st['rhoFine']['value'], 0.0):
                tags.append('신호가 50 km 넘는 규모에만 있음')
            elif _le(L95(st['rhoFine']), 0.0):
                tags.append('50 km 아래 신호는 확인 안 됨 — 예보 자체의 지형 오차·고리 표본 오차와 구분 안 됨')
        if _ge(U95(st['Lminus']), 0.0):
            tags.append('풍하 갬 근거는 점추정뿐')
        if _gt(st['dMSElam']['value'], 0.0):
            tags.append('앱 진폭 과대 가능(λ̃* 배 — 판정 경로 진폭만 합격)')
        out['effect'] = {'rhoStar': _ci_txt(st['rho']), 'rhoOdd': _ci_txt(st['rhoOdd'])}
        res = done('3-5', '합격')
        res['tags'].append(TAG_MORNING)
        return res
    if c3 and not c2:
        out['notes'].append({'c2NoInversionSplit': st.get('c2NoInversion'), 'FoddArm': st.get('FoddArm')})
        return done('4', '미결', 'η_w 의 짝수 성분이 아침 안개·웅덩이와 반대일 수 있음')
    if c2 and not c3:
        out['tags'].append('바람 홀수 몫 작음 — c2 의 상관은 바람과 무관한 지형 상관(눈·안개 등)일 수 있음'
                           if _lt(U95(st['d']), SMALL_D_U95) else '바람 홀수 몫 못 가름')
        return done('5', '불합격')
    small = _lt(U95(st['rho']), SMALL_RHO_U95) and _lt(U95(st['d']), SMALL_D_U95)
    out['tags'].append('작음' if small else '못 가름')
    return done('6', '불합격')


# ═══════════════════════ §6.6 rulerHash, prechecks, lock ═══════════════════════
def ruler_hash_bytes(b):
    """sha256 of the ruler with the lines strictly between '## 10.' and '## 11.' removed (both kept; L871). Exactly one
    line starting '## 10.' and one later line starting '## 11.', else ValueError."""
    lines = b.split(b'\n')
    i10 = [i for i, ln in enumerate(lines) if ln.startswith(b'## 10.')]
    i11 = [i for i, ln in enumerate(lines) if ln.startswith(b'## 11.')]
    if len(i10) != 1 or len(i11) != 1 or i11[0] <= i10[0]:
        raise ValueError('ruler_hash: need exactly one "## 10." line and one later "## 11." line')
    return O.sha256_bytes(b'\n'.join(lines[:i10[0] + 1] + lines[i11[0]:]))


def ruler_hash(path):
    with open(path, 'rb') as f:
        return ruler_hash_bytes(f.read())


def section_text(b, start, end):
    """Bytes of the lines from the first line starting `start` up to (not including) the first later line starting `end`."""
    lines = b.split(b'\n')
    i0 = next((i for i, ln in enumerate(lines) if ln.startswith(start)), None)
    if i0 is None:
        return b''
    i1 = next((i for i in range(i0 + 1, len(lines)) if lines[i].startswith(end)), len(lines))
    return b'\n'.join(lines[i0:i1])


class Ctx:
    """Repository paths of one judgement (root = the repo; tests use synthetic repos in .harness/oro/test-tmp)."""
    def __init__(self, root=ROOT, frozen_commit=None):
        self.root = os.path.abspath(root)
        self.oro = os.path.join(self.root, *ORO_REL.split('/'))
        self.frozen_commit = frozen_commit

    def p(self, rel):
        return os.path.join(self.root, *rel.split('/'))

    def o(self, name):
        return os.path.join(self.oro, name)

    @property
    def lock(self):
        return self.o('judge.lock')

    @property
    def lock1(self):
        return self.o('judge.lock.1')

    @property
    def gate(self):
        return self.o('gate-oro-held.json')

    @property
    def base(self):
        return self.p(O.D_BASE)


def git(ctx, *args):
    """git in the repo (C4: only quiet / porcelain / ancestry / pathspec forms are passed by the callers)."""
    return subprocess.run(['git', *args], cwd=ctx.root, capture_output=True, text=True)


def frozen_commit_of(ctx, rel_path):
    """The commit that added rel_path (git log --diff-filter=A, pathspec = that file only; prints hashes only)."""
    r = git(ctx, 'log', '--diff-filter=A', '--format=%H', '--', rel_path)
    hs = [x for x in r.stdout.split() if x]
    return hs[-1] if (r.returncode == 0 and hs) else None


def _jl(path):
    with open(path) as f:
        return json.load(f)


def frozen_extn(ctx):
    return sorted(f for f in os.listdir(ctx.oro) if f.startswith('FROZEN-ext') and f.endswith('.json'))


def check_files_clean(ctx, commit, files):
    """`git diff --quiet <commit> HEAD -- <files>` and no working-tree change (`git status --porcelain -- <files>`)."""
    if not files:
        return True, 'empty'
    r = git(ctx, 'diff', '--quiet', commit, 'HEAD', '--', *files)
    if r.returncode != 0:
        return False, 'diff'
    s = git(ctx, 'status', '--porcelain', '--', *files)
    if s.returncode != 0 or s.stdout.strip():
        return False, 'worktree'
    return True, 'ok'


def files_hashes_ok(ctx, files):
    bad = []
    for rel, h in sorted(files.items()):
        p = ctx.p(rel)
        if not os.path.exists(p) or O.sha256_file(p) != h:
            bad.append(rel)
    return bad


def default_b_check(ctx, frozen, inputs_path):
    """§9.3 ④ 5: B rebuilt from oro-inputs.json (only) must equal the recorded sha256 (oro-base.mjs --check, n128 and
    n64). On a difference: rebuild into a temp dir and compare floats with the sealed B in .harness/oro/base; all
    max|ΔB| ≤ 1e-6 → proceed with the rebuilt B; else stop before T. Returns {'ok', 'mode', 'baseDir', 'checkSha', ...}."""
    commit = (frozen.get('runtime') or {}).get('bCommit')
    if not commit:
        ip = os.path.join(ctx.base, 'index.json')
        commit = _jl(ip).get('commit') if os.path.exists(ip) else None
    if not commit:
        return {'ok': False, 'mode': 'no-commit'}
    script = ctx.o('oro-base.mjs')
    r = subprocess.run(['node', script, '--inputs', inputs_path, '--commit', commit, '--check'], cwd=ctx.root,
                       capture_output=True, text=True)
    if r.returncode == 0:
        return {'ok': True, 'mode': 'check', 'baseDir': ctx.base, 'checkSha': True}
    vers = frozen.get('versions') or {}
    rec = {'ok': False, 'mode': 'rebuild', 'nodeRunning': subprocess.run(['node', '--version'], capture_output=True,
                                                                         text=True).stdout.strip(),
           'nodeFrozen': vers.get('node')}
    tmp = tempfile.mkdtemp(prefix='oro-brebuild-', dir=ctx.p('.harness/oro'))
    r2 = subprocess.run(['node', script, '--inputs', inputs_path, '--commit', commit, '--out', tmp], cwd=ctx.root,
                        capture_output=True, text=True)
    if r2.returncode != 0:
        rec['mode'] = 'rebuild-failed'
        return rec
    inp = _jl(inputs_path)
    worst = 0.0
    for sc in sorted(inp['scenes']):
        for tk in sorted(inp['scenes'][sc]['times']):
            tm = inp['scenes'][sc]['times'][tk]
            for n64 in (False, True):
                shas = tm.get('bSha256n64' if n64 else 'bSha256') if (not n64 or tk == 'closest') else None
                if not shas:
                    continue
                for b in BANDS:
                    if shas.get(b) is None:
                        continue
                    nm = f'{sc}__{tk}__{b}' + ('__n64' if n64 else '') + '.f32'
                    old = O.load_B(sc, tk, b, inp, ctx.base, n64=n64)
                    with open(os.path.join(tmp, nm), 'rb') as f:
                        new = np.frombuffer(f.read(), dtype='<f4').astype(np.float64)
                    worst = max(worst, float(np.max(np.abs(new - old.ravel()))))
    rec['maxAbsDB'] = worst
    rec['ok'] = worst <= 1e-6
    rec['baseDir'] = tmp
    rec['checkSha'] = False
    return rec


def versions_ok(frozen):
    import PIL
    v = frozen.get('versions') or {}
    run = {'python': platform.python_version(), 'numpy': np.__version__, 'Pillow': PIL.__version__}
    bad = sorted(k for k in run if v.get(k) != run[k])
    return not bad, {'running': run, 'mismatch': bad}


def compare_apply(new, old):
    """T-free recompute vs committed oro-apply (Q-56): flags (A1–A8 ok, appA, judge, counted) and |S|/counts exact,
    floats within 1e-9; sources.env differences are recorded only."""
    flags, floats = [], 0.0
    nf = 0

    def walk(a, b, path):
        nonlocal floats, nf
        if path.startswith('/sources/env'):
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b)):
                if k not in a or k not in b:
                    flags.append(f'{path}/{k}')
                else:
                    walk(a[k], b[k], f'{path}/{k}')
        elif isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                flags.append(path)
            else:
                for i, (x, y) in enumerate(zip(a, b)):
                    walk(x, y, f'{path}/{i}')
        elif isinstance(a, float) and isinstance(b, float):
            d = abs(a - b)
            if d > 0:
                nf += 1
            floats = max(floats, d)
        elif a != b:
            flags.append(path)
    walk(new, old, '')
    return {'identical': not flags and floats == 0.0, 'flagDiffs': flags[:50], 'nFlagDiffs': len(flags),
            'maxAbsFloat': floats, 'nFloatDiffs': nf, 'ok': not flags and floats <= 1e-9}


def env_precheck(ctx, frozen):
    ok_v, vrec = versions_ok(frozen)
    rec = {'versions': vrec, 'versionsOk': ok_v}
    if not ok_v:
        rec['ok'] = False
        return rec
    ip, dp, cp, ap = ctx.o('oro-inputs.json'), ctx.o('dem-grids.json'), ctx.o('cmr-geom.json'), ctx.o('oro-apply.json')
    new = O.build_apply(ip, dp, cp, ctx.base)
    fill_apply_doc(new, _jl(ip), _jl(dp), ctx.base, O.sha256_file(os.path.abspath(__file__)))
    old = _jl(ap)
    cmp_ = compare_apply(json.loads(O.dumps_json(new)), old)
    rec['recompute'] = cmp_
    rec['ok'] = cmp_['ok']
    return rec


def judged_rows(ctx):
    """oro-apply rows (+ every oro-apply-extN.json listed by a FROZEN-extN) and their oro-inputs scenes. Returns
    (rows, scenes, info): info = the oro-apply summary keys the judge uses (G-shuf sites and measurability, primary
    metric, λ̃*), recomputed with the summary rule over all counted rows when extN files are merged, and whether the
    ecmwf sounding file was received (L739)."""
    rows, scenes = {}, {}
    pairs = [('oro-apply.json', 'oro-inputs.json')]
    for fx in frozen_extn(ctx):
        k = fx[len('FROZEN-'):-len('.json')]
        pairs.append((f'oro-apply-{k}.json', f'oro-inputs-{k}.json'))
    ecm = True
    for ap, ip in pairs:
        a, i = _jl(ctx.o(ap)), _jl(ctx.o(ip))
        ecm = ecm and (i['sources']['sounding'] or {}).get('ecmwf') is not None
        for n in sorted(a['scenes']):
            if n in rows:
                raise ValueError(f'scene {n} appears in two oro-apply files')
            rows[n] = a['scenes'][n]
            scenes[n] = i['scenes'][n]
    sm = _jl(ctx.o('oro-apply.json'))['summary']
    info = {k: sm.get(k) for k in ('gshufSites', 'gshufScenes', 'c3bMeasurable', 'primaryMetric', 'lambdaTilde')}
    if len(pairs) > 1:
        per = {}
        for n in sorted(rows):
            if rows[n]['counted']:
                per[rows[n]['site']] = per.get(rows[n]['site'], 0) + 1
        gs = sorted(s for s, k in per.items() if k >= 3)
        info.update({'gshufSites': gs, 'gshufScenes': sum(per[s] for s in gs)})
        info['c3bMeasurable'] = info['gshufScenes'] >= C3B_MIN_SCENES
    info['ecmwfAvailable'] = ecm
    return rows, scenes, info


def scene_paths(ctx, sc, name):
    d = ctx.p(O.bank_table(sc['bank'])['dir'])
    return os.path.join(d, name + '.json'), os.path.join(d, name + '.png')


def tread_precheck(ctx, rows, scenes, b_src, ecmwf_available=True):
    """T-read precheck (L910-L913): judgement inputs present; bank vs bank-manifest by hashing only (no decode)."""
    rec = {'missingTrueGrid': [], 'missingPng': [], 'bankDiffs': [], 'missingB': [], 'armUnmeasurable': [], 'ok': True}
    man = _jl(ctx.o('bank-manifest.json'))
    want = sorted(n for n, r in rows.items() if r['counted'] or (r['group'] == 'dev' and r['judge']))
    for name in want:
        sc = scenes[name]
        pj, pp = scene_paths(ctx, sc, name)
        mb = ((man.get('banks') or {}).get(sc['bank']) or {}).get('scenes', {}).get(name)
        h = O.scene_hashes(pj) if os.path.exists(pj) else None
        if h is None or h['trueGridSha256'] is None:
            rec['missingTrueGrid'].append(name)
        png = None
        if os.path.exists(pp):
            with O.allow('png-hash'):
                png = O.sha256_file(pp)
        else:
            rec['missingPng'].append(name)
        if mb is None or h is None or mb.get('jsonSha256') != h['jsonSha256'] or mb.get('trueGridSha256') != h['trueGridSha256'] \
                or mb.get('pngSha256') != png:
            rec['bankDiffs'].append(name)
        for b in BANDS:
            try:
                if load_B_src(b_src, name, 'closest', b, sc) is None:
                    rec['missingB'].append(f'{name}:{b}')
            except (OSError, ValueError):
                rec['missingB'].append(f'{name}:{b}')
    if not ecmwf_available:
        rec['armUnmeasurable'].append('ecmwf')
    # missing PNG of a judged scene = a judgement input missing (empty-pixel mask, L345) → stop before T (L911)
    if rec['missingPng'] or rec['missingB']:
        rec['ok'] = False
    rec['nDiffs'] = len(rec['bankDiffs'])
    return rec


def precheck(ctx, b_checker=None, env_check=True):
    """§9.3 ④ 1–7 + environment precheck + T-read precheck. Returns (ok, record); never reads T, never writes a lock."""
    rec = {'steps': {}}
    st = rec['steps']
    fp = ctx.o('FROZEN.json')
    if not os.path.exists(fp):
        st['frozen'] = False
        return False, rec
    frozen = _jl(fp)
    rec['frozenSha256'] = O.sha256_file(fp)
    fc = ctx.frozen_commit or frozen_commit_of(ctx, f'{ORO_REL}/FROZEN.json')
    rec['frozenCommit'] = fc
    head = git(ctx, 'rev-parse', '--quiet', '--verify', 'HEAD').stdout.strip()
    rec['head'] = head
    # 1. frozen commit is an ancestor of HEAD
    st['1'] = bool(fc) and git(ctx, 'merge-base', '--is-ancestor', fc, 'HEAD').returncode == 0
    # 2(a). frozen files (except the ruler) and FROZEN.json unchanged since the freeze commit, no working-tree change
    files = dict(frozen.get('files') or {})
    ruler_rel = f'{ORO_REL}/RULER-oro.md'
    frel = sorted(k for k in files if k != ruler_rel)
    ok2a, why = check_files_clean(ctx, fc, frel + [f'{ORO_REL}/FROZEN.json']) if fc else (False, 'no-commit')
    bad = files_hashes_ok(ctx, {k: files[k] for k in frel})
    notf = [f'{ORO_REL}/{x}' for x in FROZEN_REQUIRED if f'{ORO_REL}/{x}' not in files]
    st['2a'] = bool(ok2a and not bad and not notf)
    rec['2a'] = {'git': why, 'hashMismatch': bad, 'notFrozen': notf}
    # 2(b) + 6. every FROZEN-extN: unchanged since its own commit, its files' hashes match
    ok2b, ok6, ext = True, True, {}
    for fx in frozen_extn(ctx):
        fxd = _jl(ctx.o(fx))
        xc = frozen_commit_of(ctx, f'{ORO_REL}/{fx}')
        xf = dict(fxd.get('files') or {})
        okc, whyc = check_files_clean(ctx, xc, sorted(xf) + [f'{ORO_REL}/{fx}']) if xc else (False, 'no-commit')
        badx = files_hashes_ok(ctx, xf)
        ok2b = ok2b and okc
        ok6 = ok6 and not badx
        ext[fx] = {'git': whyc, 'hashMismatch': badx}
    st['2b'] = ok2b
    st['6'] = ok6
    rec['ext'] = ext
    # 3. rulerHash
    try:
        rh = ruler_hash(ctx.p(ruler_rel))
    except (OSError, ValueError):
        rh = None
    st['3'] = rh is not None and rh == frozen.get('rulerHash')
    rec['rulerHash'] = rh
    # 4. implementation and bundle hashes = §10.2 (guards-oro.json, recorded at G5 pass; each hash also in ruler §10.2)
    gp = ctx.o('guards-oro.json')
    ok4, rec4 = False, {}
    if os.path.exists(gp):
        g = _jl(gp)
        impl = dict(g.get('hashes') or {})
        with open(ctx.p(ruler_rel), 'rb') as f:
            s102 = section_text(f.read(), b'### 10.2', b'### 10.3')
        badi = files_hashes_ok(ctx, {k: v for k, v in impl.items() if not k.startswith('bundle:')})
        notrec = sorted(k for k, v in impl.items() if v.encode('ascii') not in s102)
        bund = {k: v for k, v in impl.items() if k.startswith('bundle:')}
        ok4 = bool(impl) and not badi and not notrec
        rec4 = {'hashMismatch': badi, 'notIn10_2': notrec, 'bundles': sorted(bund)}
        rec['guards'] = {k: (v or {}).get('status') for k, v in sorted((g.get('guards') or {}).items())}
    st['4'] = ok4
    rec['4'] = rec4
    # 7. no gate file, no lock; judge.lock.1 → rerun mode
    st['7'] = not os.path.exists(ctx.gate) and not os.path.exists(ctx.lock)
    rec['rerun'] = os.path.exists(ctx.lock1)
    # 5. B rebuilt from oro-inputs only
    ipath = ctx.o('oro-inputs.json')
    b = (b_checker or default_b_check)(ctx, frozen, ipath) if os.path.exists(ipath) else {'ok': False, 'mode': 'no-inputs'}
    st['5'] = bool(b.get('ok'))
    rec['5'] = {k: v for k, v in b.items() if k != 'baseDir'}
    rec['bSource'] = {'dir': b.get('baseDir'), 'checkSha': b.get('checkSha', True)}
    # environment precheck (D2, D3, Q-56)
    if env_check:
        e = env_precheck(ctx, frozen) if all(st[k] for k in ('1', '2a', '3', '7')) else {'ok': False, 'skipped': True}
        st['env'] = bool(e.get('ok'))
        rec['env'] = e
    # T-read precheck
    if all(v for v in st.values()):
        rows, scenes, info = judged_rows(ctx)
        tr = tread_precheck(ctx, rows, scenes, rec['bSource'], info['ecmwfAvailable'])
        st['tread'] = tr['ok']
        rec['tread'] = tr
    else:
        st['tread'] = False
    ok = all(bool(v) for v in st.values())
    rec['ok'] = ok
    return ok, rec


def load_B_src(src, scene, tk, band, sc, n64=False):
    """B from the precheck's B source: sha256-checked oro_ref.load_B, or (④ 5 ≤ 1e-6 branch) the rebuilt files."""
    d = (src or {}).get('dir') or os.path.join(ROOT, *O.D_BASE.split('/'))
    if (src or {}).get('checkSha', True):
        return O.load_B(scene, tk, band, {'scenes': {scene: sc}}, d, n64=n64)
    tm = sc['times'][tk]
    shas = tm.get('bSha256n64' if n64 else 'bSha256')
    if not shas or shas.get(band) is None:
        return None
    n = 64 if n64 else O.N_GRID
    with open(os.path.join(d, f'{scene}__{tk}__{band}' + ('__n64' if n64 else '') + '.f32'), 'rb') as f:
        return np.frombuffer(f.read(), dtype='<f4').reshape(n, n).astype(np.float64)


# ═══════════════════════ judgement: per-scene computation ═══════════════════════
MODEL_ARMS = (
    ('s8km', {'s_m': 8000.0}), ('s15km', {'s_m': 15000.0}),
    ('blockNone', {'block': 'none'}), ('blockSheppard', {'block': 'sheppard'}),
    ('vertTwo', {'vertical': 'two'}), ('vertZ1500', {'vertical': 'z1500'}), ('vertQ', {'vertical': 'q'}),
    ('Nm0.6', {'N_scale': 0.6}), ('Hw2500', {'Hw_override': 2500.0}), ('Fodd', {'odd': True}),
    ('smin100km', {'lambda_smin': 100000.0}), ('smin400km', {'lambda_smin': 400000.0}), ('f0', {'f_override': 0.0}),
    ('sRel0.10', {'s_rel_override': 0.10}), ('sRel0.20', {'s_rel_override': 0.20}),
    ('sigmaG15km', {'sigma_G_m': 15000.0}), ('sigmaG30km', {'sigma_G_m': 30000.0}),
    ('ecmwf', {'sndKey': 'sndEcmwf'}),
    ('latest', {'time': 'latest'}), ('m1h', {'time': 'm1h'}), ('p1h', {'time': 'p1h'}),
)
MASK_ARMS = (
    ('snow7d', {'zSnowKey': 'zSnow7'}), ('snow42d', {'zSnowKey': 'zSnow42'}),
    ('snowZ0only', {'z0margin': 300.0}), ('snowZ0m800', {'z0margin': 800.0}), ('snowNone', {'snow_on': False}),
    ('high0.2', {'hi': 0.2}), ('high0.5', {'hi': 0.5}), ('highNone', {'high_on': False}),
)
HOOK_KEYS = ('block', 'vertical', 'N_scale', 'Hw_override', 'odd', 'lambda_smin', 'f_override', 's_rel_override')


def _usable(snd):
    return snd is not None and snd.get('complete') and not snd.get('refEmpty') and snd.get('speedRef')


def prep_fields(name, sc, dem, snd, lat, Bs, rings, dist, tm):
    """T-free fields of one scene (main model): F, F_rev, combiner results, app arm (+ low-only arm), rotated DEM (Q-39)."""
    F = O.forcing(dem['hsub'], snd, lat)
    Fr = O.forcing(dem['hsub'], snd, lat, rev=True)
    cj, cr = O.combine(Bs['total'], F), O.combine(Bs['total'], Fr)
    app = app_arm(Bs, F, rings, dist)
    app_lo = app_arm(Bs, F, rings, dist, low_only=True)
    hrot, _ = O.h_sub_field(np.rot90(dem['hmean6'], 2))
    co = O.combine(Bs['total'], O.forcing(hrot, snd, lat))
    return {'name': name, 'sc': sc, 'dem': dem, 'Bs': Bs, 'F': F, 'Fr': Fr, 'cj': _trim(cj), 'cr': _trim(cr),
            'app': app, 'appLow': {'dCvis': app_lo['dCvis'], 'Bvis': app_lo['Bvis']}, 'co': _trim(co), 'snd': snd,
            'lat': lat, 'tm': tm}


def prep_scene(name, sc, row, dem, b_src):
    """prep_fields from oro-inputs + B files (closest time); the judge-path combiner must reproduce the oro-apply row."""
    tm = sc['times']['closest']
    Bs = {b: load_B_src(b_src, name, 'closest', b, sc) for b in BANDS}
    p = prep_fields(name, sc, dem, tm['snd'], sc['lat'], Bs, O.ring_arrays(tm), sc['ringGeom']['dist'], tm)
    if row['A6']['judge'] is None or p['cj']['maxGdC'] != row['A6']['judge']['maxGdC']:
        raise ValueError(f'{name}: judge-path combiner differs from oro-apply (environment is not the frozen one)')
    return p


def fine_boxes(cells, m6, dx_m=O.DX_M, box=None):
    box = box or O.box15
    return [box(fine_coarse(X, m6, dx_m)[0]) for X in cells]


def scene_main(p, tr, mk, primary, lam_tilde):
    """All §6.3 per-scene values of the main path for one scene (T and the judge masks known)."""
    T, Bt = tr['T'], p['Bs']['total']
    dC, dCr = p['cj']['dC'], p['cr']['dC']
    r = T - Bt
    d15, dr15, r15 = O.box15(dC), O.box15(dCr), O.box15(r)
    W = mk['W']
    m6 = mask6(mk['ext'])
    (fdC, cdC), (fdCr, _), (fr, cr_) = fine_coarse(dC, m6), fine_coarse(dCr, m6), fine_coarse(r, m6)
    fine = (O.box15(fdC), O.box15(fdCr), O.box15(fr))
    core = rho_d(d15, dr15, r15, W, p['cr']['ok'], fine=fine)
    S, Su = sets(d15, dr15, W)
    cd15, cr15 = O.box15(cdC), O.box15(cr_)
    rs, rr = O.pearson(d15[Su], r15[Su]), O.pearson(dr15[Su], r15[Su])
    out = dict(core)
    out.update({
        'beta_res': beta_res(d15, r15, W), 'dMSE': dmse(d15, r15, W), 'dMSElam': dmse(d15, r15, W, lam_tilde),
        'rho_resU': rs, 'rho_revU': rr,
        'rho_even': None if (rs is None or rr is None) else 0.5 * (rs + rr),
        'rho_odd': None if (rs is None or rr is None) else 0.5 * (rs - rr),
        'revOk': p['cr']['ok'], 'rotOk': p['co']['ok'],
        'rho_rot': O.pearson(O.box15(p['co']['dC'])[Su], r15[Su]) if p['co']['ok'] else None,
        'rho_coarse': O.pearson(cd15[S], cr15[S]),
        'rho_hp': O.pearson(d15[S], O.box15(r - O.gauss_smooth(r, O.SIGMA_G_M))[S]),
        'wlContrast': wl_contrast(O.box15(p['F']), r15, W),
        'nEmptyBoxes': int(mk['empty'].sum()), 'nEmptyOnly': int((mk['empty'] & ~mk['snow'] & ~mk['high']).sum()),
    })
    out['rho_star'], out['d_star'] = star(core, primary)
    # visible side (L550, §6.1)
    app = p['app']
    v15, rv15 = O.box15(app['dCvis']), O.box15(T - app['Bvis'])
    out['rho_vis'] = O.pearson(v15[S], rv15[S])
    out['sdVisS'] = float(np.std(v15[S])) if S.any() else None
    T15 = O.box15(T)
    out['dMSEvis'] = float(np.mean((O.box15(app['Cvis'])[W] - T15[W]) ** 2 - (O.box15(app['Bvis'])[W] - T15[W]) ** 2)) \
        if W.any() else None
    lo = p['appLow']
    out['rho_visLow'] = O.pearson(O.box15(lo['dCvis'])[S], O.box15(T - lo['Bvis'])[S])
    sea15, h15 = p['dem']['sea'], O.box15(p['dem']['hmean6'])
    out['Lminus'] = lminus(d15, dr15, r15, W, S, sea15, h15, 'strata')
    out['LminusTertile'] = lminus(d15, dr15, r15, W, S, sea15, h15, 'tertile')
    out['LminusWindow'] = lminus(d15, dr15, r15, W, S, sea15, h15, 'window')
    out['LminusVis'] = lminus(v15, dr15, rv15, W, W & (np.abs(v15) >= O.DC_SEL), sea15, h15, 'strata')
    m3 = mask3(mk['ext'])
    cm = c45(p['cj']['C'], Bt, tr['T256'], m3)
    cu = c45(p['cj']['C'], Bt, tr['T256'], None)
    out.update(cm)
    out.update({k + 'Unmasked': v for k, v in cu.items()})
    out.update(screen_weight(d15, r15, W))
    out['d_S'] = d_pair(d15, dr15, r15, S, p['cr']['ok'])
    out['d_S_fine'] = d_pair(fine[0], fine[1], fine[2], S, p['cr']['ok'])
    # box arrays kept for G-shuf and the box-level splits (not written)
    out['_box'] = {'d15': d15, 'dr15': dr15, 'r15': r15, 'W': W, 'S': S, 'Su': Su, 'fine': fine, 'm6': m6, 'r': r}
    return out


def dshuf_scene(j_box, k_list, fine_mode, use_set='W'):
    """d_shuf,j (L526-L535) = Pearson_{W_j}(ΔC_j, r_j) − mean_k Pearson_{W_j}(ΔC_{j|k}, r_j); k with a failed combiner
    skipped; all skipped → None (j excluded). k_list = [(ok, ΔC_{j|k} box, ΔC_rev,j|k box | None, okRev)].
    use_set 'Su' gives the 2-draft form (S∪_j). Also returns ρ_odd,swap (report, M5)."""
    d15, dr15, r15 = j_box['fine'] if fine_mode else (j_box['d15'], j_box['dr15'], j_box['r15'])
    Wj = j_box['W'] if use_set == 'W' else j_box['Su']
    Su = j_box['Su']
    rk = [O.pearson(kb[Wj], r15[Wj]) for ok, kb, _kr, _okr in k_list if ok]
    if not rk:
        return None, None
    dsh = float(O.pearson(d15[Wj], r15[Wj]) - np.mean(rk))
    odd_j = 0.5 * (O.pearson(d15[Su], r15[Su]) - O.pearson(dr15[Su], r15[Su]))
    ok_odd = [0.5 * (O.pearson(kb[Su], r15[Su]) - O.pearson(kr[Su], r15[Su])) for ok, kb, kr, okr in k_list
              if ok and okr and kr is not None]
    swap = float(odd_j - np.mean(ok_odd)) if ok_odd else None
    return dsh, swap


def arm_core(p, tr, mk_main, primary, cfg, b_src, cache_hs):
    """One sensitivity arm for one scene → {'rho_star', 'd_star', 'nS'} or {'drop': reason}."""
    sc, dem, lat = p['sc'], p['dem'], p['lat']
    mk = mk_main
    if 'zSnowKey' in cfg or 'z0margin' in cfg or 'snow_on' in cfg or 'hi' in cfg or 'high_on' in cfg:
        tm = p['tm']
        if 'zSnowKey' in cfg:
            z = tm[cfg['zSnowKey']]
            if z is None:
                return {'drop': 'input'}
            mk = judge_masks(dem['hmax6'], z, p['Bs']['high'], tr['empty'])
        elif 'z0margin' in cfg:
            if tm['z0'] is None:
                return {'drop': 'input'}
            mk = judge_masks(dem['hmax6'], tm['z0'], p['Bs']['high'], tr['empty'], margin_m=cfg['z0margin'])
        else:
            mk = judge_masks(dem['hmax6'], tm['zSnow'], p['Bs']['high'], tr['empty'], hi=cfg.get('hi', O.HI_MASK),
                             snow_on=cfg.get('snow_on', True), high_on=cfg.get('high_on', True))
        dC, dCr, r = p['cj']['dC'], p['cr']['dC'], tr['T'] - p['Bs']['total']
        rev_ok = p['cr']['ok']
    else:
        tk = cfg.get('time', 'closest')
        tm = sc['times'][tk]
        snd = tm[cfg.get('sndKey', 'snd')]
        if not _usable(snd):
            return {'drop': 'input'}
        if tk == 'closest':
            Bs = p['Bs']
        else:
            Bs = {b: load_B_src(b_src, p['name'], tk, b, sc) for b in ('total', 'high')}
            if any(v is None for v in Bs.values()):
                return {'drop': 'input'}
            mk = judge_masks(dem['hmax6'], tm['zSnow'], Bs['high'], tr['empty'])
        hs = dem['hsub']
        if 's_m' in cfg:
            key = (sc['site'], cfg['s_m'])
            if key not in cache_hs:
                cache_hs[key] = O.h_sub_field(dem['hmean6'], s_m=cfg['s_m'])[0]
            hs = cache_hs[key]
        hooks = {k: cfg[k] for k in HOOK_KEYS if k in cfg}
        sg = cfg.get('sigma_G_m', O.SIGMA_G_M)
        F = O.forcing(hs, snd, lat, **hooks)
        Fr = O.forcing(hs, snd, lat, rev=True, **hooks)
        cj, cr = O.combine(Bs['total'], F, sigma_G_m=sg), O.combine(Bs['total'], Fr, sigma_G_m=sg)
        dC, dCr, r = cj['dC'], cr['dC'], tr['T'] - Bs['total']
        rev_ok = cr['ok']
    d15, dr15, r15 = O.box15(dC), O.box15(dCr), O.box15(r)
    fine = None
    if primary == 'rho_fine':
        m6 = mask6(mk['ext'])
        fine = tuple(O.box15(fine_coarse(X, m6)[0]) for X in (dC, dCr, r))
    core = rho_d(d15, dr15, r15, mk['W'], rev_ok, fine=fine)
    if core['nS'] < O.A7_MIN_S:
        return {'drop': 'S'}
    rs, ds = star(core, primary)
    return {'rho_star': rs, 'd_star': ds, 'nS': core['nS']}


def arm64(p, tr, primary, b_src):
    """64² × 12 km arm (L740, Q-52)."""
    sc, dem, tm = p['sc'], p['dem'], p['tm']
    Bs = {b: load_B_src(b_src, p['name'], 'closest', b, sc, n64=True) for b in ('total', 'high')}
    if any(v is None for v in Bs.values()):
        return {'drop': 'input'}
    hs64, _ = O.h_sub_field(dem['hmean12'], n=64, dx_m=12000.0, tukey_cells=8)
    F = O.forcing(hs64, p['snd'], p['lat'], dx_m=12000.0)
    Fr = O.forcing(hs64, p['snd'], p['lat'], rev=True, dx_m=12000.0)
    cj = O.combine(Bs['total'], F, dx_m=12000.0)
    cr = O.combine(Bs['total'], Fr, dx_m=12000.0)
    mk = judge_masks64(dem['hmax12'], tm['zSnow'], Bs['high'], tr['empty'])
    r = tr['T64'] - Bs['total']
    d8, dr8, r8 = box8(cj['dC']), box8(cr['dC']), box8(r)
    fine = None
    if primary == 'rho_fine':
        fine = tuple(box8(fine_coarse(X, mk['m12'], dx_m=12000.0)[0]) for X in (cj['dC'], cr['dC'], r))
    core = rho_d(d8, dr8, r8, mk['W'], cr['ok'], fine=fine)
    if core['nS'] < O.A7_MIN_S:
        return {'drop': 'S'}
    rs, ds = star(core, primary)
    return {'rho_star': rs, 'd_star': ds, 'nS': core['nS']}


# ═══════════════════════ judgement: statistics over scenes ═══════════════════════
def site_table(names, rows, vals, dshuf):
    sites = sorted({rows[n]['site'] for n in names})
    tab, loso = {}, {}
    for s in sites:
        ns = [n for n in names if rows[n]['site'] == s]
        tab[s] = {'n': len(ns), 'medianRhoStar': median([vals[n]['rho_star'] for n in ns]),
                  'medianD': median([vals[n]['d_star'] for n in ns]),
                  'meanDshuf': mean([dshuf.get(n) for n in ns]) if any(n in dshuf for n in ns) else None}
        rest = [n for n in names if rows[n]['site'] != s]
        loso[s] = median([vals[n]['rho_star'] for n in rest])
    return {'sites': tab, 'loso': loso, 'medianOfSiteMedians': median([t['medianRhoStar'] for t in tab.values()])}


def split_stats(names, rows, vals, key, dates):
    v = [vals[n][key] for n in names]
    return summary_stat(v, [dates[n] for n in names])


def scene_stats(names, rows, vals, key, stat='median', with_p=False, blockfn=None):
    dts = [blockfn(rows[n]['date']) if blockfn else rows[n]['date'] for n in names]
    return summary_stat([vals[n][key] for n in names], dts, stat, with_p)


def build_stats(names, rows, vals, dshuf_vals, extra):
    """Every judged statistic and report row over the finally judged held set (§6.4)."""
    st = {'primary': extra['primary'], 'c1': clause_c1(names, rows), 'c3bMeasurable': extra['c3bMeasurable'],
          'c7': extra['c7']}
    st['rho'] = scene_stats(names, rows, vals, 'rho_star', with_p=True)
    st['d'] = scene_stats(names, rows, vals, 'd_star', with_p=True)
    st['dMSE'] = scene_stats(names, rows, vals, 'dMSE')
    st['dMSElam'] = scene_stats(names, rows, vals, 'dMSElam')
    st['beta'] = scene_stats(names, rows, vals, 'beta_res')
    jn = sorted(dshuf_vals)
    dsv = [dshuf_vals[n] for n in jn]
    st['dshuf'] = summary_stat(dsv, [rows[n]['date'] for n in jn], 'mean', with_p=True)
    st['dshuf']['median'] = median(dsv)
    st['dshuf']['medianCi'] = date_block_ci(dsv, [rows[n]['date'] for n in jn]) if dsv else None
    st['dshuf']['nJ'] = len(jn)
    for key, nm in (('dcorr12', 'dcorr12'), ('dcorr50', 'dcorr50'), ('dmeanErr', 'dmeanErr'), ('rho_vis', 'rhoVis'),
                    ('Lminus', 'Lminus'), ('rho_even', 'rhoEven'), ('rho_odd', 'rhoOdd'), ('rho_fine', 'rhoFine'),
                    ('rho_coarse', 'rhoCoarse'), ('rho_res', 'rhoRes'), ('rho_hp', 'rhoHp'), ('dMSEvis', 'dMSEvis'),
                    ('LminusTertile', 'LminusTertile'), ('LminusWindow', 'LminusWindow'), ('LminusVis', 'LminusVis'),
                    ('dMSEnear', 'dMSEnear'), ('dMSEfar', 'dMSEfar')):
        st[nm] = scene_stats(names, rows, vals, key)
    rot = [n for n in names if vals[n]['rho_rot'] is not None]
    st['rhoRot'] = scene_stats(rot, rows, vals, 'rho_rot')
    st['rhoRot']['excluded'] = len(names) - len(rot)
    wl = [vals[n]['wlContrast'] for n in names if vals[n]['wlContrast'] is not None]
    st['wlContrast'] = {'n': len(wl), 'sharePositive': (sum(1 for x in wl if x > 0) / len(wl)) if wl else None,
                        'median': median(wl)}
    pairs = [(vals[n]['rho_star'], vals[n]['nS']) for n in names if vals[n]['rho_star'] is not None]
    fz = fisher_stat(pairs) if pairs else None
    st['fisher'] = {'value': fz, 'ci': date_block_ci([(vals[n]['rho_star'], vals[n]['nS']) for n in names],
                                                     [rows[n]['date'] for n in names], fisher_stat) if pairs else None}
    st['siteTable'] = site_table(names, rows, vals, dshuf_vals)
    sp = [n for n in names if rows[n]['singlePass']]
    c6 = scene_stats(sp, rows, vals, 'rho_star')
    c6['medianGE0'] = None if c6['value'] is None else bool(c6['value'] >= 0.0)
    st['c6'] = c6
    st['screen'] = {'nNearTiling': N_NEAR_TILING, 'nNear': {n: vals[n]['nNear'] for n in names}}
    return st


# ═══════════════════════ judgement driver ═══════════════════════
def _progress(msg):
    print(msg, flush=True)


def judge_compute(ctx, rows, scenes, summary, frozen, b_src, truth_fn=None, png_fn=None):
    """Everything after the lock: T read, per-scene metrics, G-shuf, arms, statistics, clauses, action. Returns the
    gate document (not written). truth_fn / png_fn map a scene name to its JSON / PNG path (tests: synthetic dirs)."""
    dec = frozen.get('decisions') or {}
    primary = dec.get('primaryMetric') or summary.get('primaryMetric') or 'rho_res'
    lam_t = dec.get('lambdaTilde')
    if lam_t is None:
        lam_t = summary.get('lambdaTilde') or 1.0
    exposure = (frozen.get('exposure') or {}).get('grade')
    dg = _jl(ctx.o('dem-grids.json'))
    cache = O.SiteCache(dg)
    held = sorted(n for n, r in rows.items() if r['counted'])
    dev = sorted(n for n, r in rows.items() if r['group'] == 'dev' and r['judge'])
    preps = {n: prep_scene(n, scenes[n], rows[n], cache.get(scenes[n]['site']), b_src) for n in held + dev}
    _progress(f'PREP {len(preps)}')
    # T read (the lock exists already)
    truths, drops = {}, {'noTrueGrid': [], 'smallS': []}
    for i, n in enumerate(held + dev):
        pj, pp = (truth_fn(n), png_fn(n)) if truth_fn else scene_paths(ctx, scenes[n], n)
        tr = load_truth(pj)
        if tr is None:
            drops['noTrueGrid'].append(n)
            continue
        tr['empty'], tr['dark'] = empty_cells(pp)
        truths[n] = tr
        if (i + 1) % 10 == 0:
            _progress(f'TRUTH {i + 1}/{len(held) + len(dev)}')
    vals, masks = {}, {}
    for n in held + dev:
        if n not in truths:
            continue
        p, tr = preps[n], truths[n]
        mk = judge_masks(p['dem']['hmax6'], p['tm']['zSnow'], p['Bs']['high'], tr['empty'])
        masks[n] = mk
        v = scene_main(p, tr, mk, primary, lam_t)
        v['nDarkWin'] = int(tr['dark'][98:158, 98:158].sum())
        vals[n] = v
    judged = [n for n in held if n in vals and vals[n]['nS'] >= O.A7_MIN_S]
    drops['smallS'] = sorted(n for n in held if n in vals and vals[n]['nS'] < O.A7_MIN_S)
    dev_j = [n for n in dev if n in vals and vals[n]['nS'] >= O.A7_MIN_S]
    _progress(f'METRICS judged {len(judged)} dev {len(dev_j)}')
    gs_sites = sorted(summary.get('gshufSites') or [])
    dshuf, dswap, dshuf2, gs_excluded = gshuf_all(held, judged, rows, preps, vals, gs_sites, primary)
    _progress(f'GSHUF j {len(dshuf)}')
    extra = {'primary': primary, 'c3bMeasurable': bool(summary.get('c3bMeasurable')),
             'c7': guards_pass(ctx)}
    st = build_stats(judged, rows, vals, dshuf, extra)
    st['dshuf']['postDropJ'] = len(dshuf)
    st['dshuf']['excludedAllKSkipped'] = sorted(gs_excluded)
    st['dshuf']['swap'] = {'median': median(list(dswap.values())), 'mean': mean(list(dswap.values()))}
    st['dshuf']['form2'] = {'median': median(list(dshuf2.values())), 'n': len(dshuf2)}
    # c2 point estimate without surface-inversion scenes (line 4 note)
    noinv = [n for n in judged if rows[n]['split']['surfaceInversion'] is not True]
    st['c2NoInversion'] = median([vals[n]['rho_star'] for n in noinv])
    # sensitivity arms (§6.5, L716-L743)
    _progress('ARMS')
    arms = {}
    cache_hs = {}
    inp_ecmwf = bool(summary.get('ecmwfAvailable'))
    for name, cfg in MODEL_ARMS + MASK_ARMS:
        if name == 'ecmwf' and not inp_ecmwf:
            arms[name] = {'status': '못 잼'}
            continue
        res, nd_s, nd_i = {}, [], []
        for n in judged:
            a = arm_core(preps[n], truths[n], masks[n], primary, cfg, b_src, cache_hs)
            if 'drop' in a:
                (nd_s if a['drop'] == 'S' else nd_i).append(n)
            else:
                res[n] = a
        arms[name] = arm_summary(res, rows, nd_s, nd_i)
    res, nd_s, nd_i = {}, [], []
    for n in judged:
        a = arm64(preps[n], truths[n], primary, b_src)
        if 'drop' in a:
            (nd_s if a['drop'] == 'S' else nd_i).append(n)
        else:
            res[n] = a
    arms['grid64'] = arm_summary(res, rows, nd_s, nd_i)
    arms['blocks8d'] = {'rho': scene_stats(judged, rows, vals, 'rho_star', with_p=True, blockfn=block8),
                        'd': scene_stats(judged, rows, vals, 'd_star', with_p=True, blockfn=block8)}
    arms['grevOnS'] = scene_stats(judged, rows, vals, 'd_S_fine' if primary == 'rho_fine' else 'd_S')
    arms['gshufForm2'] = st['dshuf']['form2']
    arms['LminusWindow'] = st['LminusWindow']
    arms['c45Unmasked'] = {k: scene_stats(judged, rows, vals, k + 'Unmasked') for k in ('dcorr12', 'dcorr50', 'dmeanErr')}
    arms['appLowOnly'] = scene_stats(judged, rows, vals, 'rho_visLow')
    st['FoddArm'] = arms['Fodd']
    # splits (§6.3, L592; report)
    splits = build_splits(judged, rows, vals, preps, primary)
    c = clauses(st)
    act = action(c, st, exposure)
    dev_block = {'n': len(dev_j), 'names': dev_j, 'drops': sorted(set(dev) - set(dev_j)),
                 'medians': {k: median([vals[n][k] for n in dev_j]) for k in
                             ('rho_res', 'rho_star', 'd_star', 'dMSE', 'rho_vis', 'Lminus', 'rho_fine', 'dcorr12')}}
    scenes_out = {n: {k: v for k, v in vals[n].items() if not k.startswith('_')} for n in sorted(vals)}
    for n in scenes_out:
        if n in dshuf:
            scenes_out[n].update({'dshuf': dshuf[n], 'dshufSwap': dswap[n], 'dshufForm2': dshuf2[n]})
    return {'schema': 'gate-oro/1', 'primaryMetric': primary, 'lambdaTilde': lam_t, 'exposure': exposure,
            'judged': {'names': judged, 'c1': st['c1']}, 'drops': {k: sorted(v) for k, v in drops.items()},
            'clauses': c, 'action': act, 'stats': {k: v for k, v in st.items() if k not in ('c1',)},
            'sensitivity': arms, 'splits': splits, 'dev': dev_block, 'scenes': scenes_out}


def gshuf_all(held, judged, rows, preps, vals, gs_sites, primary):
    """G-shuf (L526-L535, Q-55): sites fixed before T (oro-apply gshufSites); j = the site's G-shuf (counted) scenes still
    in the finally judged set; k = the site's counted scenes ≠ j (T-independent). F_{j|k} = F_k (same DEM and lat, k's
    sounding), combiner on B_j; a failed (j|k) combiner skips that k (L354). Returns dicts d_shuf, ρ_odd,swap, 2-draft
    form, and the j excluded because every k was skipped."""
    dshuf, dswap, dshuf2, excluded = {}, {}, {}, []
    fine_mode = primary == 'rho_fine'
    for s in gs_sites:
        ks = [n for n in held if rows[n]['site'] == s]
        for j in [n for n in ks if n in judged]:
            p = preps[j]
            kl = []
            for k in ks:
                if k == j:
                    continue
                ck = O.combine(p['Bs']['total'], preps[k]['F'])
                ckr = O.combine(p['Bs']['total'], preps[k]['Fr'])
                if fine_mode:
                    m6 = vals[j]['_box']['m6']
                    kb, kr = O.box15(fine_coarse(ck['dC'], m6)[0]), O.box15(fine_coarse(ckr['dC'], m6)[0])
                else:
                    kb, kr = O.box15(ck['dC']), O.box15(ckr['dC'])
                kl.append((bool(ck['ok']), kb, kr, bool(ckr['ok'])))
            a, sw = dshuf_scene(vals[j]['_box'], kl, fine_mode, 'W')
            b2, _ = dshuf_scene(vals[j]['_box'], kl, fine_mode, 'Su')
            if a is None:
                excluded.append(j)
                continue
            dshuf[j], dswap[j], dshuf2[j] = a, sw, b2
    return dshuf, dswap, dshuf2, sorted(excluded)


def arm_summary(res, rows, drop_s, drop_i):
    ns = sorted(res)
    dts = [rows[n]['date'] for n in ns]
    rv = [res[n]['rho_star'] for n in ns]
    return {'n': len(ns), 'dropS': len(drop_s), 'dropInput': len(drop_i), 'medianRhoStar': median(rv),
            'ciRhoStar': date_block_ci(rv, dts) if ns else None, 'medianD': median([res[n]['d_star'] for n in ns])}


def build_splits(names, rows, vals, preps, primary):
    """§4.6 splits (report only): scene-level subsets and box-level recomputation (coast, sun-facing slope)."""
    out = {}

    def subset(tag, sel):
        ns = [n for n in names if sel(n)]
        out[tag] = {'n': len(ns), 'rho': scene_stats(ns, rows, vals, 'rho_star'),
                    'medianD': median([vals[n]['d_star'] for n in ns])}
    subset('origDates', lambda n: rows[n]['bank'] == 'orig')
    subset('extDates', lambda n: rows[n]['bank'] != 'orig')
    subset('crossTrackLE430', lambda n: rows[n]['split']['crossTrackLE430'] is True)
    subset('crossTrackGT430', lambda n: rows[n]['split']['crossTrackLE430'] is False)
    for b in ('le1', '1to3', 'gt3'):
        subset(f'NhU_{b}', lambda n, b=b: rows[n]['split']['NhUBin'] == b)
    subset('inversionTrue', lambda n: rows[n]['split']['surfaceInversion'] is True)
    subset('inversionFalse', lambda n: rows[n]['split']['surfaceInversion'] is False)
    subset('inversionUnknown', lambda n: rows[n]['split']['surfaceInversion'] is None)
    subset('seam', lambda n: rows[n]['seam'])
    subset('noSeam', lambda n: not rows[n]['seam'])
    for tag in ('coast', 'sunSlope'):
        per, dropped = {}, {}
        for n in names:
            bx = vals[n]['_box']
            if tag == 'coast':
                drop = preps[n]['dem']['sea']
            else:
                drop = np.zeros(O.NBOX * O.NBOX, dtype=bool)
                drop[rows[n]['split']['sunSlopeExcl']] = True
                drop = drop.reshape(O.NBOX, O.NBOX)
            core = rho_d(bx['d15'], bx['dr15'], bx['r15'], bx['W'], vals[n]['revOk'], fine=bx['fine'], drop=drop)
            rs, ds = star(core, primary)
            per[n] = {'rho_star': rs, 'd_star': ds}
            dropped[n] = int((bx['W'] & drop).sum())
        ns = sorted(per)
        out[tag] = {'n': len(ns), 'rho': summary_stat([per[n]['rho_star'] for n in ns], [rows[n]['date'] for n in ns]),
                    'medianD': median([per[n]['d_star'] for n in ns]), 'droppedBoxes': dropped}
    return out


def guards_pass(ctx):
    """c7: guards-oro.json (S7 record, Q-47) lists G1–G9 all PASS (their hashes are checked by precheck ④ 4)."""
    gp = ctx.o('guards-oro.json')
    if not os.path.exists(gp):
        return False
    g = (_jl(gp).get('guards') or {})
    return all((g.get(f'G{i}') or {}).get('status') == 'PASS' for i in range(1, 10))


def write_lock(ctx, rec):
    with open(ctx.lock, 'x') as f:
        f.write(f'HEAD {rec.get("head")}\nFROZEN {rec.get("frozenSha256")}\n')


def run_judge(ctx, b_checker=None, truth_fn=None, png_fn=None):
    """--judge (§6.6, §9.3 ④): precheck → pre-T record → lock → one pass → one write. Exit codes: 0 written, 2 refused
    (no lock), 3 stopped after the lock (judge-stop.json with the exception type only)."""
    ok, rec = precheck(ctx, b_checker)
    if not ok:
        bad = sorted(k for k, v in rec['steps'].items() if not v)
        print(f'REFUSE {" ".join(bad)}')
        return 2
    pret = ctx.o('judge-pret.json')
    s = O.dump_json(rec, pret)
    print(f'PRET {O.rel(pret)} sha256 {O.sha256_bytes(s.encode("utf-8"))}')
    frozen = _jl(ctx.o('FROZEN.json'))
    rows, scenes, summary = judged_rows(ctx)
    write_lock(ctx, rec)
    print('LOCK written')
    try:
        doc = judge_compute(ctx, rows, scenes, summary, frozen, rec['bSource'], truth_fn, png_fn)
        doc['pret'] = {'sha256': O.sha256_bytes(s.encode('utf-8')), 'rerun': rec['rerun']}
        out = O.dump_json(doc, ctx.gate)
        print(f'WROTE {O.rel(ctx.gate)} sha256 {O.sha256_bytes(out.encode("utf-8"))}')
        return 0
    except Exception as e:      # noqa: BLE001 — record the type only (L916), never the message (it may carry values)
        stop = {'exception': type(e).__name__, 'rerun': rec['rerun'],
                'verdict': '미결(판정 실행 두 번 멈춤)' if rec['rerun'] else None,
                'partial': ({'gateSha256': O.sha256_file(ctx.gate)} if os.path.exists(ctx.gate) else None)}
        O.dump_json(stop, ctx.o('judge-stop.json'))
        print(f'STOP {type(e).__name__}')
        return 3


# ═══════════════════════ CLI ═══════════════════════
def _opts(argv, spec):
    o = dict(spec)
    i = 0
    while i < len(argv):
        k = argv[i]
        if k not in spec or i + 1 >= len(argv):
            print(f'oro: bad argument {k!r}', file=sys.stderr)
            raise SystemExit(2)
        o[k] = argv[i + 1]
        i += 2
    return o


def main(argv):
    if not argv:
        print('usage: oro.py --fill-apply|--ruler-hash|--precheck|--judge [opts]', file=sys.stderr)
        return 2
    mode, rest = argv[0], argv[1:]
    if mode == '--fill-apply':
        o = _opts(rest, {'--apply': O.D_APPLY, '--inputs': O.D_INPUTS, '--dem-grids': O.D_DEM_GRIDS, '--base': O.D_BASE})
        ap = O._path(o['--apply'])
        doc = fill_apply(ap, O._path(o['--inputs']), O._path(o['--dem-grids']), O._path(o['--base']))
        s = O.dump_json(doc, ap)
        sm = doc['summary']
        nf = sum(1 for r in doc['scenes'].values() if r['lambdaApp'] is not None)
        print(f'FILL scenes {len(doc["scenes"])} filled {nf} counted {sm["n"]} lambdaTilde {sm["lambdaTilde"]} '
              f'G7median {sm["G7median"]} G7pass {sm["G7pass"]} maskedAppShareMedian {sm["maskedAppShareMedian"]}'
              + (' PROVISIONAL' if sm.get('provisional') else ''))
        print(f'WROTE {O.rel(ap)} sha256 {O.sha256_bytes(s.encode("utf-8"))}')
        return 0
    if mode == '--ruler-hash':
        o = _opts(rest, {'--ruler': f'{ORO_REL}/RULER-oro.md'})
        print(ruler_hash(O._path(o['--ruler'])))
        return 0
    if mode in ('--precheck', '--judge'):
        o = _opts(rest, {'--root': ROOT, '--frozen-commit': ''})
        ctx = Ctx(o['--root'], o['--frozen-commit'] or None)
        if mode == '--judge':
            return run_judge(ctx)
        ok, rec = precheck(ctx)
        for k, v in sorted(rec['steps'].items()):
            print(f'CHECK {k} {"ok" if v else "FAIL"}')
        print(f'PRECHECK {"ok" if ok else "FAIL"}' + (' rerun' if rec.get('rerun') else ''))
        return 0 if ok else 1
    if mode in ('--power', '--sunset'):
        print(f'oro: {mode} is a separate S3b step (S3-design §6.7/§6.8), not built in this file yet', file=sys.stderr)
        return 2
    print(f'oro: unknown mode {mode!r}', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
