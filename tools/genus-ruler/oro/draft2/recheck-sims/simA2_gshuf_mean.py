"""Recheck sim A2 (평균 통계량 변형): RULER-oro 2판 G-shuf (c3b).  MODIS 없음, 합성 지형만.
- 지형: 64x64 x 6 km 가우스 장(파장 20~100 km 힘), 고역 s = 10 km, 가운데 30x30 칸 -> 12 km 상자 15x15.
- 강제: F^(theta) = [i (w.k/K) + c_even] h_sub^ (홀수 + 짝수, corr(F, h_sub) ~ 0.24 가 되게 c_even = 0.175).
- dC = 0.02 * F / sd_site (사이트 기준 크기), S = |dC| >= 0.02, S_cup = S u S_rev.
- r = beta * z(dC_j) + A * z(P) + 공간 상관 잡음(상관 길이 ~15 km, 상자 SD 1).
- P = 사이트 고정 홀수 무늬(정해 둔 방향 theta_P 의 바람받이 무늬: 기후 바람받이 눈·밝기, 또는 해 쪽 비탈).
- 배치: modis-times.json 키(6 산악 사이트 x 13 날짜, 적용 확률은 검토 sim2 와 같음), 판정 장면 >= 20.
- c3b 변형: (a) 2판 = 중앙 d_shuf(S_cup_j) > 0, (b) 대칭 집합 = 중앙 d_shuf(S_sym_j) > 0,
  (c) 대칭 집합 + 날짜 블록 부호 뒤집기 한쪽 p <= 0.10, (d) 대칭 집합 + 날짜 블록 L95 > 0.
Usage: python3 -I simA_gshuf.py <modis_times_json> <out_json> [reps]
"""
import sys, json, itertools
import numpy as np

mt = json.load(open(sys.argv[1]))
REPS = int(sys.argv[3]) if len(sys.argv) > 3 else 500
SITES = ['busan', 'denver', 'osaka', 'sapporo', 'sydney', 'lisbon']
P_APPLY = {'denver': 0.5, 'sapporo': 0.4, 'busan': 0.3, 'osaka': 0.3, 'sydney': 0.3, 'lisbon': 0.2}
cells = [(k.rsplit('_', 1)[0], k.rsplit('_', 1)[1]) for k in mt if k.rsplit('_', 1)[0] in SITES]
dates = sorted({d for _, d in cells}); si = {s: i for i, s in enumerate(SITES)}; di = {d: i for i, d in enumerate(dates)}
S_IDX = np.array([si[s] for s, _ in cells]); D_IDX = np.array([di[d] for _, d in cells])
PA = np.array([P_APPLY[s] for s, _ in cells])
SIGNS = np.array(list(itertools.product((1, -1), repeat=len(dates))))
rng = np.random.default_rng(20261104)
N, DX = 64, 6.0
kx = 2 * np.pi * np.fft.fftfreq(N, DX); KX, KY = np.meshgrid(kx, kx); K = np.hypot(KX, KY); Ks = np.where(K == 0, 1, K)
HP = 1 - np.exp(-K ** 2 * 10.0 ** 2 / 2)
BAND = np.exp(-((np.log(np.where(K == 0, 1e-9, K)) - np.log(2 * np.pi / 45)) ** 2) / (2 * 0.6 ** 2)); BAND[0, 0] = 0
NOISE_FILT = np.exp(-K ** 2 * 7.0 ** 2 / 2)
C_EVEN = 0.175
B = 600

def boxes(f):
    c = f[N // 2 - 15:N // 2 + 15, N // 2 - 15:N // 2 + 15]
    return c.reshape(15, 2, 15, 2).mean(axis=(1, 3)).ravel()

def terrain():
    h = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * BAND))
    return np.fft.fft2(h) * HP

def forcing(hs, th):
    w = np.array([np.cos(th), np.sin(th)])
    return boxes(np.real(np.fft.ifft2(hs * (1j * (w[0] * KX + w[1] * KY) / Ks + C_EVEN))))

def noise():
    z = boxes(np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((N, N))) * NOISE_FILT)))
    return z / z.std()

def pear(x, y, m):
    if m.sum() < 3: return 0.0
    a, b = x[m], y[m]
    sa, sb = a.std(), b.std()
    if sa == 0 or sb == 0: return 0.0
    return float(np.mean((a - a.mean()) * (b - b.mean())) / (sa * sb))

def wmedian(vals, W):
    o = np.argsort(vals); v = vals[o]; W = W[:, o]
    cw = np.cumsum(W, axis=1); T = cw[:, -1]; ok = T > 0
    r0 = (T - 1) // 2; r1 = T // 2
    i0 = np.argmax(cw > r0[:, None], axis=1); i1 = np.argmax(cw > r1[:, None], axis=1)
    return (0.5 * (v[i0] + v[i1]))[ok]

def L95(x, d):
    cd = rng.multinomial(len(dates), np.full(len(dates), 1 / len(dates)), size=B)
    return np.percentile(wmedian(x, cd[:, d]), 2.5)

def pflip(x, d):
    med = np.median(x)
    return np.mean(np.median(SIGNS[:, d] * x[None, :], axis=1) >= med)

def pflip_mean(x, d):
    m = np.mean(x)
    return np.mean(np.mean(SIGNS[:, d] * x[None, :], axis=1) >= m)

def rep(beta, A, kappa_w, art_dir):
    while True:
        a = rng.random(len(cells)) < PA
        if a.sum() >= 20: break
    s_idx, d_idx = S_IDX[a], D_IDX[a]
    hs = {s: terrain() for s in np.unique(s_idx)}
    prev = {s: rng.uniform(0, 2 * np.pi) for s in hs}
    scale = {s: np.mean([forcing(hs[s], t).std() for t in np.linspace(0, 2 * np.pi, 8, endpoint=False)]) for s in hs}
    thP = {s: (prev[s] if art_dir == 'prevailing' else rng.uniform(0, 2 * np.pi)) for s in hs}
    P = {}
    for s in hs:
        w = np.array([np.cos(thP[s]), np.sin(thP[s])])
        p = boxes(np.real(np.fft.ifft2(hs[s] * 1j * (w[0] * KX + w[1] * KY) / Ks))); P[s] = (p - p.mean()) / p.std()
    th = np.array([rng.vonmises(prev[s], kappa_w) for s in s_idx])
    dC = [0.02 * forcing(hs[s], t) / scale[s] for s, t in zip(s_idx, th)]
    dCr = [0.02 * forcing(hs[s], t + np.pi) / scale[s] for s, t in zip(s_idx, th)]
    r = []
    for j, s in enumerate(s_idx):
        z = (dC[j] - dC[j].mean()) / dC[j].std()
        r.append(beta * z + A * P[s] + noise())
    n = len(s_idx)
    rho = np.zeros(n); dd = np.zeros(n); ds_a = np.full(n, np.nan); ds_b = np.full(n, np.nan); ds_w = np.full(n, np.nan)
    for j in range(n):
        S = np.abs(dC[j]) >= 0.02; Su = S | (np.abs(dCr[j]) >= 0.02)
        rho[j] = pear(dC[j], r[j], S)
        dd[j] = pear(dC[j], r[j], Su) - pear(dCr[j], r[j], Su)
        ks = [k for k in range(n) if k != j and s_idx[k] == s_idx[j]]
        if len(ks) >= 2:
            Ssym = Su.copy()
            for k in ks: Ssym |= np.abs(dC[k]) >= 0.02
            ds_a[j] = pear(dC[j], r[j], Su) - np.mean([pear(dC[k], r[j], Su) for k in ks])
            ds_b[j] = pear(dC[j], r[j], Ssym) - np.mean([pear(dC[k], r[j], Ssym) for k in ks])
            allW = np.ones_like(S)
            ds_w[j] = pear(dC[j], r[j], allW) - np.mean([pear(dC[k], r[j], allW) for k in ks])
    c2 = np.median(rho) > 0 and L95(rho, d_idx) > 0 and pflip(rho, d_idx) <= 0.025
    c3 = np.median(dd) > 0 and L95(dd, d_idx) > 0 and pflip(dd, d_idx) <= 0.025
    g = ~np.isnan(ds_a); active = g.sum() >= 10
    if active:
        ca = np.median(ds_a[g]) > 0
        cb = np.median(ds_b[g]) > 0
        cc = np.median(ds_b[g]) > 0 and pflip(ds_b[g], d_idx[g]) <= 0.10
        cd_ = np.median(ds_b[g]) > 0 and L95(ds_b[g], d_idx[g]) > 0
        ce = np.mean(ds_w[g]) > 0 and pflip_mean(ds_w[g], d_idx[g]) <= 0.10
        cf = np.mean(ds_w[g]) > 0
        cg = np.mean(ds_b[g]) > 0 and pflip_mean(ds_b[g], d_idx[g]) <= 0.10
        mA, mB, mW = float(np.mean(ds_a[g])), float(np.mean(ds_b[g])), float(np.mean(ds_w[g]))
    else:
        ca = cb = cc = cd_ = ce = cf = cg = True; mA = mB = mW = np.nan
    return dict(c2=c2, c3=c3, c23=c2 and c3, active=active, ca=ca, cb=cb, cc=cc, cd=cd_, ce=ce, cf=cf, cg=cg,
                p_a=c2 and c3 and ca, p_b=c2 and c3 and cb, p_c=c2 and c3 and cc, p_d=c2 and c3 and cd_,
                p_e=c2 and c3 and ce, p_f=c2 and c3 and cf, p_g=c2 and c3 and cg,
                med_rho=float(np.median(rho)), med_d=float(np.median(dd)), sd_rho=float(rho.std()), sd_ds=float(np.nanstd(ds_b)), mean_dsA=mA, mean_dsB=mB, mean_dsW=mW, n=n)

SCEN = {
    'null': dict(beta=0.0, A=0.0),
    'H1_day_beta0.03': dict(beta=0.03, A=0.0),
    'H1_day_beta0.06': dict(beta=0.06, A=0.0),
    'H0_siteArt_A0.05': dict(beta=0.0, A=0.05),
    'H0_siteArt_A0.10': dict(beta=0.0, A=0.10),
}
# variant letters: a = 2판(중앙, S_cup_j), b = 중앙(대칭 집합), c = 중앙 + 부호 뒤집기 0.10(대칭), d = 중앙 + L95(대칭),
# e = 평균(W) + 부호 뒤집기(평균) 0.10, f = 평균(W) > 0, g = 평균(대칭) + 부호 뒤집기(평균) 0.10
out = {}
for kappa_w in (1.0, 3.0):
    for art_dir in ('prevailing', 'random'):
        for nm, kw in SCEN.items():
            if (nm.startswith('H1') or nm == 'null') and art_dir == 'random': continue
            if art_dir == 'random': continue
            rr = [rep(kappa_w=kappa_w, art_dir=art_dir, **kw) for _ in range(REPS)]
            key = f'{nm}_kw{kappa_w}' + ('' if not nm.startswith('H0_site') else f'_{art_dir}')
            res = {k: round(float(np.mean([x[k] for x in rr])), 3) for k in ('c2', 'c3', 'c23', 'active', 'p_a', 'p_b', 'p_c', 'p_d', 'p_e', 'p_f', 'p_g')}
            act = [x for x in rr if x['active']]
            for k in ('ca', 'cb', 'cc', 'cd', 'ce', 'cf', 'cg'):
                res[k + '_givenActive'] = round(float(np.mean([x[k] for x in act])), 3) if act else None
            for k in ('mean_dsA', 'mean_dsB', 'mean_dsW'):
                res[k] = round(float(np.nanmean([x[k] for x in act])), 4) if act else None
            res['med_rho'] = round(float(np.median([x['med_rho'] for x in rr])), 3)
            res['med_d'] = round(float(np.median([x['med_d'] for x in rr])), 3)
            res['n_med'] = float(np.median([x['n'] for x in rr]))
            res['sd_rho_scene'] = round(float(np.median([x['sd_rho'] for x in rr])), 3)
            res['sd_dshuf_scene'] = round(float(np.nanmedian([x['sd_ds'] for x in rr])), 3)
            out[key] = res
            print(key, res, flush=True)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
