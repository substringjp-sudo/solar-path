"""§179 WP5 — 아치 빛 **CPU 계약 적분기**(RULER-tsun §5.0 ⑤, ruler-delta B3·E5: Ω = [−dip, 0]). 렌더 없음, 브라우저 없음.

  nice -n 19 python3 -I tools/genus-ruler/tsun/archcpu/archcpu.py <명령> --tables DIR [--out r.json]
    명령: ga | u5b | u5c | fblk | test | all | manifest
    DIR = gen_tables.py 가 만든 폴더(app15.npz). 배열의 정규 sha256 이 tables-sha256.json 과 다르면 멈춤(--allow-unrecorded 로만 넘김).

계약(archQuad.ts 머리말이 원본 — 이 파일은 그 식을 앱 15 파장 표 위에서 계산):
  E_arch(x) = Σ_{노드 k} L_sky(x, ω_k) · p(ω_k·v) · dΩ_k × T_arch,  Ω = [−dip, 0] × (줄 방향 ± 30°), 노드 = GL2 고도 × 방위 −20/0/+20°,
  dΩ = sin(dip)/2 × 20°. L_sky = 앱 15 파장 표(사전 시험 precompute.c 를 CPU 에서 다시 만든 것)의 GetSkyRadiance(그림자 길이 0, GROUND 갈래),
  p = takram 이중 HG. G-A 기대값은 T_arch = 1(가림 없음). 세 세기 raw · phase(자 §1 정의) · octave(셰이더 τ = 0) 를 모두 냄(D-q2).
  단위: '표' = 표 값 그대로(arch/nodes.json 과 같은 단위), '×K' = 렌더러가 곱하는 SPECTRAL_SKY_RADIANCE_TO_RELATIVE_LUMINANCE(683/SUN_LUMINANCE).

명령:
  ga    G-A 기대값 — P1 7.4 km × D1 네 칸(고도 8/12.5/17.5/25°, 방위 275.30°) · P2 2.8 km × 두 칸(8/8.75°, 269.81°), 사진 시각 해.
        줄 방향 두 가지: 'sun'(표본 접평면에 투영한 해 방향 = arch/nodes.json 관례) · 'observer'(관측점 수평 해 방위 벡터를 표본 접평면에 —
        셰이더 gArchRowAxis 처럼 아틀라스 줄 방향이 관측점에서 정해질 때). 덧붙여 ruler-delta E5 의 **세밀 격자 점검**(노드 대 격자,
        phase Y 비 |·−1| ≤ 4 % [from doc, critic-physics M5]) 과 옛 계약 Ω [−dip, +5] 색(E3 보고 줄), 가능성(§5.0 ④)용 P1 색(--rgb 글자).
  u5b   arch/nodes.json(사전 계산 노드, 4 자리 비율 0.2113/0.7887)과 같은 기하로 L·dΩ 를 다시 계산해 노드마다 |Δ| ≤ 1e−6 × max|ref|(관문) ·
        mid(−dip/2) 노드(보고) · 정확한 GL 비율과의 차(보고).
  u5c   지구 그림자 가장자리 아래 δ = 0.3 / 1 / 2°(그리고 맥락 0 · 4 · 7°), h = 1.5 / 2.8 / 7.4 km 에서 여섯 노드 대 세밀 격자의
        Y·R/B 오차(보고만, design v2 m2). 비평 모형(critic terminator.py 의 판 감쇠 msw)도 같은 줄에 보고.
  fblk  RULER-tsun §4.5 서쪽 벽(방위 180~360 · 100~380 km · 2~16 km)·동쪽 벽이 막는 계약 영역 비율 — 사전 시험 rev/fblk.py 를 옮김(옛 Ω 로
        0.973 / 0.000 재현) + 새 Ω [−dip, 0].
  test  U5a(파이썬 거울: 가중치 합 = sin(dip)·π/3 sr, 노드가 Ω 안, GL2 가 3 차 다항식까지 정확) · U5b · U5c · E5 를 PASS/FAIL/REPORT 로.
  all   ga + u5b + u5c + fblk + test 를 한 JSON 으로(--out).
  manifest  archcpu/ 파일과 archQuad.ts 의 sha256, 옮겨 온 사전 시험 원본 sha256 을 archcpu-manifest.json 에.
결정(이 파일): D-c1 세밀 격자는 칸 가운데 표본 + 칸의 정확한 입체각((sin e₁ − sin e₀)Δφ), 고도 칸 경계가 −dip·0·+5 에 정확히 맞게 등분.
  (비평 arch_energy.py 의 np.arange 경계는 P2 2.8 km 에서 지평 바로 아래 0.0198° — 가장 밝은 띠 — 를 빠뜨려 노드/격자 Y 1.037 이 나왔음;
  경계를 맞추면 1.017, 굵기를 반으로 해도 3e−5 안 [computed].)
  D-c2 노드·격자 모두 땅에 닿는 방향은 0(Ω 안에서는 닿는 방향이 없음 — e > −dip). D-c3 해 위치는 사전 시험과 같은 NOAA 이식(sun.py) ·
  관측점 ENU 무한원 벡터. D-c4 U5b 의 1e−6 은 노드별 상대(그 노드 RGB 중 큰 값 기준) — L·dΩ ≈ 3e−4 라 절대 1e−6 은 0.3 % 로 너무 느슨함.
"""
import sys, os, json, math, hashlib, argparse
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import luts as L, geom as GEO, archquad as Q, gen_tables as GT

ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
REF_NODES = os.path.join(HERE, 'ref', 'arch-nodes.json')
E5_TOL = 0.04          # [from doc: ruler-delta E5 'nodes vs fine grid within 4 %', critic-physics M5 1.004~1.037]
U5B_TOL = 1e-6         # [from doc: design v2 §8 U5b '… L·dΩ to 1e-6'] — 노드별 상대(D-c4)
FINE_DEL, FINE_DAZ = 0.01, 0.5          # 세밀 격자(°): 고도 · 방위
COARSE_DEL, COARSE_DAZ = 0.02, 1.0      # 수렴 점검용(비평 low30 과 같은 굵기)
LUMA = L.LUMA


# ---------------------------------------------------------------- 표
def load_tables(tdir, allow_unrecorded=False):
    z = np.load(os.path.join(tdir, 'app15.npz'))
    arr = {k: z[k] for k in ['T', 'I', 'S', 'M', 'H', 'K']}
    sha = GT.sha256_arrays([(k, arr[k]) for k in ['T', 'I', 'S', 'M', 'H', 'K']])
    rec = json.load(open(GT.RECORD)) if os.path.exists(GT.RECORD) else dict(canonical_sha256=None)
    if sha != rec['canonical_sha256'] and not allow_unrecorded:
        raise SystemExit(f'archcpu: 표 정규 sha256 {sha} 가 tables-sha256.json({rec["canonical_sha256"]})과 다름 — gen_tables.py 로 다시 만들거나 --allow-unrecorded')
    K = float(arr['K'])
    tb = L.CpuTables(T=arr['T'], I=arr['I'], S=arr['S'], M=arr['M'], H=arr['H'], K=np.full(3, K), name='app15')
    tb.solar = np.zeros(3)
    return tb, sha, K


def sky(tb, X, W, sunv):
    """GetSkyRadiance(그림자 길이 0, GROUND 갈래) — 땅에 닿는 방향은 0(D-c2). W (n, 3)."""
    X = np.asarray(X, float); W = np.asarray(W, float)
    Ls, _ = L.sky_radiance(tb, np.broadcast_to(X, W.shape), W, np.broadcast_to(sunv, W.shape), ground=True)
    r = float(np.linalg.norm(X))
    hits = L.ray_intersects_ground(np.full(len(W), r), W @ (X / r))
    return np.where(hits[:, None], 0.0, Ls)


def phase_np(c, att=1.0):
    p = Q.ARCH_PHASE
    def hg(g, c):
        return (1 - g * g) / (4 * math.pi * np.maximum(1e-7, np.power(1 + g * g - 2 * g * c, 1.5)))
    return (1 - p['mix']) * hg(p['g1'] * att, c) + p['mix'] * hg(p['g2'] * att, c)


def octave_weight_np(c):
    w = np.zeros_like(c); ai = 1.0
    for _ in range(Q.ARCH_OCTAVES):
        w = w + ai * phase_np(c, ai); ai *= Q.ARCH_OCTAVE_ATTENUATION
    return w


def slab_weight_np(c, s_a, s_v):
    """비평 terminator.py 의 msw: Σ aⁱ p(c; cⁱ)·s_a/(aⁱ s_v + s_a) — 판 안 홑산란 감쇠 모형 [critic model, 보고만]."""
    w = np.zeros_like(c); ai = 1.0
    for _ in range(Q.ARCH_OCTAVES):
        w = w + ai * phase_np(c, ai) * (s_a / (ai * s_v + s_a)); ai *= Q.ARCH_OCTAVE_ATTENUATION
    return w


def Y(v, K):
    return float((K * np.asarray(v)) @ LUMA)


def ratios(v):
    v = np.asarray(v, float)
    return dict(RB=float(v[0] / v[2]) if v[2] != 0 else None, GB=float(v[1] / v[2]) if v[2] != 0 else None)


def summarize(v, K):
    v = np.asarray(v, float)
    return dict(table=v.tolist(), xK=(v * K).tolist(), Y=Y(v, K), **ratios(v))


# ---------------------------------------------------------------- 노드 · 격자
def node_eval(tb, X, d, sunv, row_axis, fractions=Q.ARCH_GL2_FRACTIONS):
    X = np.asarray(X, float); r = float(np.linalg.norm(X)); up = X / r
    dip = Q.arch_dip_rad(r - L.BOTTOM)
    nodes = Q.arch_nodes(dip, fractions)
    W = np.array([Q.arch_node_direction(nd, up.tolist(), list(map(float, row_axis))) for nd in nodes])
    Ls = sky(tb, X, W, sunv)
    cosv = W @ np.asarray(d, float)
    sums = Q.arch_contract_sums(nodes, Ls.tolist(), cosv.tolist())
    C = Q.arch_octave_cache(nodes, Ls.tolist(), cosv.tolist())
    per = [dict(group=nd['group'], az=nd['az'], e_deg=math.degrees(nd['elevationRad']), a_deg=math.degrees(nd['azimuthRad']), dOm=nd['dOmega'],
                L=Ls[k].tolist(), LdOm=(Ls[k] * nd['dOmega']).tolist(), cos_view=float(cosv[k])) for k, nd in enumerate(nodes)]
    return dict(dip_deg=math.degrees(dip), nodes=per, sums=sums, C=C, W=W, L=Ls, cosv=cosv)


def fine_eval(tb, X, d, sunv, row_axis, el_lo, el_hi, az_half, d_el=FINE_DEL, d_az=FINE_DAZ, slab_sv=None):
    """세밀 격자(D-c1): 칸 가운데 + 정확한 칸 입체각. 반환 raw · phase · octave(· slab) 합(표 단위)."""
    X = np.asarray(X, float); r = float(np.linalg.norm(X)); up = X / r
    ne = max(1, int(math.ceil((el_hi - el_lo) / d_el - 1e-9))); na = max(1, int(math.ceil(2 * az_half / d_az - 1e-9)))
    ee = np.radians(np.linspace(el_lo, el_hi, ne + 1)); ae = np.radians(np.linspace(-az_half, az_half, na + 1))
    ec, ac = 0.5 * (ee[1:] + ee[:-1]), 0.5 * (ae[1:] + ae[:-1])
    dOm = ((np.sin(ee[1:]) - np.sin(ee[:-1]))[:, None] * np.diff(ae)[None, :]).ravel()
    E_, A_ = np.meshgrid(ec, ac, indexing='ij'); E_, A_ = E_.ravel(), A_.ravel()
    n, a, b = (np.array(v) for v in Q.arch_tangent_frame(up.tolist(), list(map(float, row_axis))))
    W = (np.cos(E_) * np.cos(A_))[:, None] * a + (np.cos(E_) * np.sin(A_))[:, None] * b + np.sin(E_)[:, None] * n
    Ls = sky(tb, X, W, sunv)
    c = W @ np.asarray(d, float)
    out = dict(raw=(Ls * dOm[:, None]).sum(0), phase=(Ls * (phase_np(c) * dOm)[:, None]).sum(0),
               octave=(Ls * (octave_weight_np(c) * dOm)[:, None]).sum(0), n_dirs=int(len(W)), solid_angle=float(dOm.sum()))
    if slab_sv is not None:
        out['slab'] = (Ls * (slab_weight_np(c, np.abs(np.sin(E_)), slab_sv) * dOm)[:, None]).sum(0)
    return out


def node_slab(ne, s_v):
    """여섯 노드의 판 감쇠(비평 모형) 합 — 노드마다 자기 고도의 s_a."""
    s = np.zeros(3)
    for k, nd in enumerate(ne['nodes']):
        s_a = abs(math.sin(math.radians(nd['e_deg'])))
        s += np.asarray(nd['L']) * nd['dOm'] * float(slab_weight_np(np.array([nd['cos_view']]), s_a, s_v)[0])
    return s


def arch_vis(r, mu_s):
    """셰이더 gArchVis(= GetTransmittanceToSun 의 지구 그림자 smoothstep)와 같은 식."""
    sh = L.BOTTOM / r; ch = -math.sqrt(max(1 - sh * sh, 0.0)); a = sh * L.SUN_ANGULAR_RADIUS
    t = min(max((mu_s - ch + a) / (2 * a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def arch_weight(sun_alt_deg):
    """계약 켜짐 w(θ) = smoothstep(−1°, −2°, θ)(cloudTsun.ts archWeight 와 같은 식) — θ = 관측점 해 고도."""
    t = min(1.0, max(0.0, (-1.0 - sun_alt_deg) / 1.0))
    return t * t * (3 - 2 * t)


def observers():
    return {k: GEO.Observer(*v) for k, v in (('P1', GEO.P1), ('P2', GEO.P2))}


def ga_points():
    pts = [('P1', b, GEO.P1_AZ, el, GEO.P1_H) for b, el in GEO.P1_BINS.items()]
    pts += [('P2', b, GEO.P2_AZ, el, GEO.P2_H) for b, el in GEO.P2_BINS.items()]
    return pts


# ---------------------------------------------------------------- 명령
def cmd_ga(tb, K):
    obs = observers(); rows = []; p1_sum = np.zeros(3)
    for name, bin_, az, el, h in ga_points():
        o = obs[name]; smp = o.sample_on_ray(az, el, h); X, d, s = smp['X'], smp['d'], o.s
        row_obs = GEO.enu_vec(o.sun_az, 0.0)
        ne = node_eval(tb, X, d, s, s)                 # 줄 방향 'sun'(표본 접평면에 투영 — arch/nodes.json 관례)
        no = node_eval(tb, X, d, s, row_obs)           # 줄 방향 'observer'
        dip = ne['dip_deg']
        fl = fine_eval(tb, X, d, s, s, -dip, 0.0, Q.ARCH_AZ_HALF_WIDTH_DEG)
        fc = fine_eval(tb, X, d, s, s, -dip, 0.0, Q.ARCH_AZ_HALF_WIDTH_DEG, COARSE_DEL, COARSE_DAZ)
        con = fine_eval(tb, X, d, s, s, -dip, 5.0, Q.ARCH_AZ_HALF_WIDTH_DEG, 0.05, 1.0)
        ph = np.asarray(ne['sums']['phase'])
        if name == 'P1':
            p1_sum += ph * K
        rec = dict(point=name, bin=bin_, el_obs=el, h_km=h, az=az, slant_km=smp['dist_slant'], ground_km=smp['ground_dist'],
                   local_sun_deg=smp['sun_alt_vector'], dip_deg=dip, observer_sun_deg=o.sun_alt,
                   vis=arch_vis(smp['r'], smp['mu_s']), w_theta=arch_weight(o.sun_alt),
                   shader_gate_note='셰이더 아치 항 = w(θ)·(1 − vis)·S — 여기 두 값이 w = 1 · vis = 0 이면 G-A 기대값 = E_arch.octave(T = 1)',
                   E_arch=dict(phase=summarize(ne['sums']['phase'], K), octave=summarize(ne['sums']['octave'], K), raw=summarize(ne['sums']['raw'], K)),
                   E_arch_rowaxis_observer=dict(phase=summarize(no['sums']['phase'], K), octave=summarize(no['sums']['octave'], K)),
                   rowaxis_observer_over_sun_Y=Y(no['sums']['phase'], K) / Y(ph, K),
                   fine=dict(phase=summarize(fl['phase'], K), octave=summarize(fl['octave'], K), raw=summarize(fl['raw'], K), n_dirs=fl['n_dirs'],
                             solid_angle=fl['solid_angle'], band_exact=Q.arch_band_solid_angle(math.radians(dip))),
                   nodes_over_fine=dict(phase_Y=Y(ph, K) / Y(fl['phase'], K), phase_RB=ratios(ph)['RB'] / ratios(fl['phase'])['RB'],
                                        octave_Y=Y(ne['sums']['octave'], K) / Y(fl['octave'], K), raw_Y=Y(ne['sums']['raw'], K) / Y(fl['raw'], K)),
                   fine_convergence_phase_Y=Y(fc['phase'], K) / Y(fl['phase'], K),
                   contract_old_omega=dict(phase=summarize(con['phase'], K), band_over_contract_Y=Y(fl['phase'], K) / Y(con['phase'], K)),
                   nodes=ne['nodes'])
        rows.append(rec)
    rgb = p1_sum / (p1_sum @ LUMA)
    return dict(points=rows, feas_rgb=rgb.tolist(), feas_rgb_arg=','.join('%.6f' % x for x in rgb),
                feas_note='tsun_photo.py feas --rgb 에 줄 글자(P1 네 칸 phase×K 합을 휘도 1 로) — ruler-delta E3 의 v2 띠 색')


def cmd_u5b(tb, K):
    ref = json.load(open(REF_NODES)); obs = observers(); out = []; worst = 0.0; worst_mid = 0.0; worst_exact = 0.0; worst_geo = 0.0
    azs = {'P1': GEO.P1_AZ, 'P2': GEO.P2_AZ, 'P2sc': GEO.P2_AZ}
    for case in ref:
        o = obs['P1' if case['case'] == 'P1' else 'P2']
        smp = o.sample_on_ray(azs[case['case']], case['el'], case['h'])
        X, d, s = smp['X'], smp['d'], o.s
        ne = node_eval(tb, X, d, s, s, fractions=(0.2113, 0.7887))   # nodes.py 와 같은 4 자리 비율
        low = [n for n in case['nodes'] if n['tag'] == 'low']; mid = [n for n in case['nodes'] if n['tag'] == 'mid']
        if len(low) != len(ne['nodes']):
            raise SystemExit(f'U5b: {case["case"]} 의 low 노드 {len(low)} 개 ≠ {len(ne["nodes"])}')
        errs = []
        for mine, r in zip(ne['nodes'], low):
            refv = np.asarray(r['L']) * r['dOm']; v = np.asarray(mine['LdOm'])
            rel = float(np.abs(v - refv).max() / max(np.abs(refv).max(), 1e-300))
            errs.append(dict(e=mine['e_deg'], a=mine['a_deg'], rel=rel, abs=float(np.abs(v - refv).max()),
                             de=abs(mine['e_deg'] - r['e']), da=abs(mine['a_deg'] - r['a']), ddOm=abs(mine['dOm'] - r['dOm'])))
            worst = max(worst, rel); worst_geo = max(worst_geo, errs[-1]['de'], errs[-1]['da'], errs[-1]['ddOm'])
        # mid(−dip/2) 노드: 방향 바꾸기 끝 방향(셰이더 gArchDirMid 는 방위 0 만) — 보고
        up = (X / np.linalg.norm(X)).tolist(); dip = math.radians(ne['dip_deg'])
        mid_err = []
        for r in mid:
            w = np.array(Q.arch_node_direction(dict(elevationRad=-0.5 * dip, azimuthRad=math.radians(r['a'])), up, s.tolist()))
            v = sky(tb, X, w[None], s)[0] * (2 * ne['nodes'][0]['dOm']); refv = np.asarray(r['L']) * r['dOm']
            rel = float(np.abs(v - refv).max() / max(np.abs(refv).max(), 1e-300)); mid_err.append(rel); worst_mid = max(worst_mid, rel)
        # 정확한 GL 비율(archQuad 기본) 대 4 자리: 무리별 Σ L·dΩ 의 상대 차 — 보고
        nx = node_eval(tb, X, d, s, s)
        for g in (0, 1):
            a = sum(np.asarray(n['LdOm']) for n in nx['nodes'] if n['group'] == g); b = sum(np.asarray(n['L']) * n['dOm'] for n in low[3 * g:3 * g + 3])
            worst_exact = max(worst_exact, float(np.abs(a - b).max() / np.abs(b).max()))
        out.append(dict(case=case['case'], el=case['el'], h=case['h'], dip_ref=case['dip'], dip=ne['dip_deg'], nodes=errs, mid_rel=mid_err))
    return dict(cases=out, worst_rel=worst, worst_geometry=worst_geo, worst_mid_rel=worst_mid, exact_gl_vs_ref_group_rel=worst_exact, tol=U5B_TOL,
                n_nodes=sum(len(c['nodes']) for c in out),
                verdict='pass' if (worst <= U5B_TOL and worst_geo <= 1e-12) else 'fail',
                rule='노드마다 max_c|Δ(L·dΩ)| ≤ 1e−6 × max_c|ref| 그리고 고도(°)·방위(°)·dΩ 차 ≤ 1e−12')


def cmd_u5c(tb, K):
    rows = []
    s_v = math.sin(math.radians(10.0)); d = GEO.enu_vec(0.0, 10.0)   # 비평 terminator.py 와 같은 시선(해 방위, +10°)
    for h in (1.5, 2.8, 7.4):
        r = L.BOTTOM + h; X = np.array([0.0, 0.0, r]); dip = math.degrees(Q.arch_dip_rad(h))
        for delta, kind in ((0.3, 'U5c'), (1.0, 'U5c'), (2.0, 'U5c'), (0.0, 'context'), (4.0, 'context'), (7.0, 'context')):
            es = -dip - delta; s = GEO.enu_vec(0.0, es)
            ne = node_eval(tb, X, d, s, s)
            fl = fine_eval(tb, X, d, s, s, -dip, 0.0, Q.ARCH_AZ_HALF_WIDTH_DEG, slab_sv=s_v)
            fc = fine_eval(tb, X, d, s, s, -dip, 0.0, Q.ARCH_AZ_HALF_WIDTH_DEG, COARSE_DEL, COARSE_DAZ)
            nsl = node_slab(ne, s_v)
            def err(a, b):
                a, b = np.asarray(a), np.asarray(b)
                return dict(Y=Y(a, K) / Y(b, K) - 1, RB=(a[0] / a[2]) / (b[0] / b[2]) - 1)
            rows.append(dict(kind=kind, h_km=h, dip_deg=dip, delta_deg=delta, sun_local_deg=es,
                             raw=err(ne['sums']['raw'], fl['raw']), phase=err(ne['sums']['phase'], fl['phase']),
                             octave=err(ne['sums']['octave'], fl['octave']), slab_critic=err(nsl, fl['slab']),
                             fine_RB_phase=ratios(fl['phase'])['RB'], fine_Y_phase=Y(fl['phase'], K),
                             fine_convergence_phase_Y=Y(fc['phase'], K) / Y(fl['phase'], K) - 1))
    return dict(rows=rows, note='여섯 노드 ÷ 세밀 격자 − 1, Ω = [−dip, 0] × ±30°, T_arch = 1, 시선 = 해 방위 +10° [computed]; 판정 없음(보고, design v2 m2)')


def _fblk_paths(P0, D, R, step=0.5, rng=400.0):
    """fblk.py 의 wall_hit 를 한 번의 광선 걸음으로 두 벽에 — 같은 걸음·같은 조건(h 2~16 km, 거리 100~380 km, 방위 구간)."""
    hit_w = np.zeros(len(D), bool); hit_e = np.zeros(len(D), bool)
    for t in np.arange(step, rng + 0.01, step):
        Q_ = P0 + t * D; hh = np.linalg.norm(Q_, axis=-1) - R
        rr = R * np.arctan2(np.hypot(Q_[:, 0], Q_[:, 1]), Q_[:, 2]); az = np.degrees(np.arctan2(Q_[:, 0], Q_[:, 1])) % 360
        m = (hh >= 2) & (hh <= 16) & (rr >= 100) & (rr <= 380)
        hit_w |= m & (az >= 180) & (az <= 360); hit_e |= m & (az >= 0) & (az <= 180)
    return hit_w, hit_e


def cmd_fblk(tb=None, K=None):
    """사전 시험 rev/fblk.py(구 R 6371 km, 덮개 가운데 7.65 km, 해 방위 272.6585°, D1 표본 36 개)를 옮김. 옛 Ω 는 원본 격자 그대로
    (고도 −dip+0.05 … +5 를 0.25°, 방위 ±30 을 2°), 새 Ω 는 고도 −dip+0.05 … 0 을 0.1°(같은 방위 격자). 비율 = 격자 방향의 단순 평균(원본과 같음)."""
    R = 6371.0; H = 7.65; sun_az = 272.6585; out = {}
    for lo, hi in [(6, 10), (10, 15), (15, 20), (20, 30)]:
        for e in [lo, (lo + hi) / 2, hi]:
            for a in [236, 268, 300]:
                dd = None
                for s_ in np.arange(0.1, 400, 0.1):
                    z = s_ * math.sin(math.radians(e)); x = s_ * math.cos(math.radians(e))
                    if math.hypot(x, R + z) - R >= H:
                        dd = s_; break
                ea = math.radians(a)
                P0 = np.array([dd * math.cos(math.radians(e)) * math.sin(ea), dd * math.cos(math.radians(e)) * math.cos(ea), R + dd * math.sin(math.radians(e))])
                up = P0 / np.linalg.norm(P0)
                ex = np.array([1.0, 0, 0]); east = ex - (ex @ up) * up; east /= np.linalg.norm(east); north = np.cross(up, east)
                dip = -math.degrees(math.acos(R / (R + H)))
                rec = dict(dist_km=round(dd, 1))
                for tag, els in (('old', np.arange(dip + 0.05, 5.01, 0.25)), ('new', np.arange(dip + 0.05, 1e-9, 0.1))):
                    AZ, EL = np.meshgrid(np.arange(sun_az - 30, sun_az + 30.01, 2.0), els)
                    A_ = np.radians(AZ.ravel()); E_ = np.radians(EL.ravel())
                    D = (np.cos(E_) * np.sin(A_))[:, None] * east + (np.cos(E_) * np.cos(A_))[:, None] * north + np.sin(E_)[:, None] * up
                    w, ee = _fblk_paths(np.repeat(P0[None], len(D), 0), D, R)
                    rec[f'{tag}_west_blocked'] = round(float(w.mean()), 3); rec[f'{tag}_east_blocked'] = round(float(ee.mean()), 3)
                out[f'{lo}-{hi}@{e}/az{a}'] = rec
    v = list(out.values())
    return dict(samples=out, old_west_min=min(r['old_west_blocked'] for r in v), old_east_max=max(r['old_east_blocked'] for r in v),
                new_west_min=min(r['new_west_blocked'] for r in v), new_east_max=max(r['new_east_blocked'] for r in v),
                note='옛 Ω 값이 사전 시험 rev/fblk_out.txt(서쪽 최소 0.973 · 동쪽 최대 0.000)와 같아야 이식이 맞음 [computed]')


def u5a_python():
    res = []
    for h in (0.25, 0.5, 1.0, 1.5, 2.8, 4.5, 7.4, 9.0, 13.0):
        dip = Q.arch_dip_rad(h); nodes = Q.arch_nodes(dip)
        tot = sum(n['dOmega'] for n in nodes); band = math.sin(dip) * math.pi / 3
        # 띠 입체각을 수치 적분(심프슨 2000 칸)으로 — '정확한 띠 입체각'의 독립 확인
        m = 2000; hstep = dip / m
        simpson = sum((1 if i in (0, m) else (4 if i % 2 else 2)) * math.cos(-dip + i * hstep) for i in range(m + 1)) * hstep / 3 * (math.pi / 3)
        inside = all(-dip < n['elevationRad'] < 0 and abs(n['azimuthRad']) < math.radians(Q.ARCH_AZ_HALF_WIDTH_DEG) for n in nodes)
        # GL2 절점(가중치 dip/2 씩)이 [−dip, 0] 에서 3 차 다항식을 정확히 적분하는지
        f = lambda e: 1.3 - 2.1 * e + 0.7 * e * e + 5.0 * e ** 3
        F = lambda e: 1.3 * e - 1.05 * e * e + 0.7 * e ** 3 / 3 + 1.25 * e ** 4
        gl = (dip / 2) * sum(f(n['elevationRad']) for n in nodes if n['az'] == 0)
        ex = F(0.0) - F(-dip)
        res.append(dict(h=h, dip_deg=math.degrees(dip), sum=tot, band=band, rel=abs(tot - band) / band, simpson_rel=abs(simpson - band) / band,
                        n=len(nodes), inside=inside, gl_cubic_rel=abs(gl - ex) / abs(ex)))
    ok = all(r['rel'] <= 1e-14 and r['simpson_rel'] <= 1e-12 and r['n'] == 6 and r['inside'] and r['gl_cubic_rel'] <= 1e-12 for r in res)
    return dict(rows=res, verdict='pass' if ok else 'fail',
                rule='Σ dΩ = sin(dip)·π/3(= sin(dip)·60° 라디안) 상대 ≤ 1e−14 · 심프슨 띠 입체각과 ≤ 1e−12 · 노드 6 개가 Ω 안 · GL2 가 3 차식 정확')


def cmd_test(tb, K, cache):
    lines = []; fails = 0
    def rep(kind, name, detail):
        nonlocal fails
        fails += kind == 'FAIL'; lines.append(f'{kind}  {name}  {detail}'); print(lines[-1], flush=True)
    a = u5a_python()
    rep('PASS' if a['verdict'] == 'pass' else 'FAIL', 'U5a weights = sin(dip)·60° (python mirror)',
        f"max rel {max(r['rel'] for r in a['rows']):.2e} · simpson {max(r['simpson_rel'] for r in a['rows']):.2e} · GL cubic {max(r['gl_cubic_rel'] for r in a['rows']):.2e}")
    b = cache.get('u5b') or cmd_u5b(tb, K); cache['u5b'] = b
    rep('PASS' if b['verdict'] == 'pass' else 'FAIL', 'U5b parity with arch/nodes.json L·dΩ',
        f"{b['n_nodes']} nodes, worst rel {b['worst_rel']:.2e} (tol {U5B_TOL:g}) · geometry {b['worst_geometry']:.1e} · mid {b['worst_mid_rel']:.2e} · exact-GL vs 4-digit group {b['exact_gl_vs_ref_group_rel']:.2e}")
    c = cache.get('u5c') or cmd_u5c(tb, K); cache['u5c'] = c
    for r in c['rows']:
        if r['kind'] == 'U5c':
            rep('REPORT', f"U5c h {r['h_km']} δ {r['delta_deg']}°",
                f"phase Y {r['phase']['Y']:+.4f} R/B {r['phase']['RB']:+.4f} · octave Y {r['octave']['Y']:+.4f} R/B {r['octave']['RB']:+.4f} · "
                f"raw Y {r['raw']['Y']:+.4f} · slab(critic) Y {r['slab_critic']['Y']:+.4f} R/B {r['slab_critic']['RB']:+.4f} · fine conv {r['fine_convergence_phase_Y']:+.1e}")
    g = cache.get('ga') or cmd_ga(tb, K); cache['ga'] = g
    worst = max(abs(p['nodes_over_fine']['phase_Y'] - 1) for p in g['points'])
    rep('PASS' if worst <= E5_TOL else 'FAIL', 'E5 nodes vs fine grid (G-A points, phase Y)',
        ' '.join(f"{p['point']}{p['bin']} {p['nodes_over_fine']['phase_Y']:.4f}" for p in g['points']) + f' (tol {E5_TOL})')
    return dict(lines=lines, fails=fails, u5a=a)


def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def cmd_manifest():
    files = sorted(f for f in os.listdir(HERE) if os.path.isfile(os.path.join(HERE, f)) and not f.endswith('.pyc') and f != 'archcpu-manifest.json')
    files += ['ref/' + f for f in sorted(os.listdir(os.path.join(HERE, 'ref')))]
    man = dict(tool='archcpu §179 WP5', files={f: sha_file(os.path.join(HERE, f)) for f in files},
               archQuad_ts=sha_file(os.path.join(ROOT, 'src/components/VolumetricProbe/archQuad.ts')),
               derived_from={'pretest/code/precompute.c': 'df296e9b4389b1004c2883fdae19988758b2503a1fa65fc5363ef84f202f25b8 (그대로)',
                             'pretest/code/luts.py': '6c95cc015ce390656bd83e9bedefb36290d282bd54821cbed123810fab158bcd (ASSETS 경로 줄만)',
                             'pretest/code/spec.py': 'b8ee5b798bf0d0c868cab393e1ad6bdf02de0a848095c4c142fa4b870d1c1ef9 (SRC 경로 줄만)',
                             'pretest/code/sun.py': '47db4748349b20d59f801203e45f5717dac32adea4bd7b2ad84ef1e8cc1449a1 (그대로)',
                             'pretest/code/analysis.py': '7135df20befa731f200289c82bbd00c88c14b5ac7817484ad83a25675e3d0ccd (geom.py 로 일부 함수 그대로)',
                             'pretest/code/assemble.py': '983ced1c1901967ebb70981eec66bc4ac0336370b64bd0bdfa942557aae14cca (gen_tables.assemble 같은 식)',
                             'tsun2/arch/nodes.json': 'ref/arch-nodes.json (그대로)'},
               tables=json.load(open(GT.RECORD))['canonical_sha256'])
    json.dump(man, open(os.path.join(HERE, 'archcpu-manifest.json'), 'w'), indent=1, ensure_ascii=False)
    print('manifest', len(man['files']), 'files')
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['ga', 'u5b', 'u5c', 'fblk', 'test', 'all', 'manifest'])
    ap.add_argument('--tables'); ap.add_argument('--out'); ap.add_argument('--allow-unrecorded', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'manifest':
        cmd_manifest(); return
    if a.cmd == 'fblk':
        res = cmd_fblk()
        print(json.dumps({k: v for k, v in res.items() if k != 'samples'}, ensure_ascii=False))
        if a.out:
            json.dump(res, open(a.out, 'w'), indent=1, ensure_ascii=False)
        return
    if not a.tables:
        raise SystemExit('--tables DIR 가 필요(gen_tables.py --out DIR)')
    tb, sha, K = load_tables(a.tables, a.allow_unrecorded)
    prov = dict(tables_canonical_sha256=sha, K=K, archQuad_ts=sha_file(os.path.join(ROOT, 'src/components/VolumetricProbe/archQuad.ts')),
                archcpu_py=sha_file(__file__), archquad_py=sha_file(os.path.join(HERE, 'archquad.py')), ref_nodes=sha_file(REF_NODES))
    cache = {}; res = dict(provenance=prov)
    rc = 0
    if a.cmd in ('ga', 'all'):
        cache['ga'] = res['ga'] = cmd_ga(tb, K)
    if a.cmd in ('u5b', 'all'):
        cache['u5b'] = res['u5b'] = cmd_u5b(tb, K)
    if a.cmd in ('u5c', 'all'):
        cache['u5c'] = res['u5c'] = cmd_u5c(tb, K)
    if a.cmd == 'all':
        res['fblk'] = cmd_fblk()
    if a.cmd in ('test', 'all'):
        t = cmd_test(tb, K, cache); res['test'] = t; rc = 1 if t['fails'] else 0
    if a.cmd == 'ga':
        for p in res['ga']['points']:
            e = p['E_arch']['phase']
            print(p['point'], p['bin'], 'Y×K %.4e' % e['Y'], 'R/B %.3f G/B %.3f' % (e['RB'], e['GB']), 'nodes/fine %.4f' % p['nodes_over_fine']['phase_Y'])
        print('feas --rgb', res['ga']['feas_rgb_arg'])
    if a.cmd == 'u5b':
        print('U5b', res['u5b']['verdict'], 'worst rel %.2e' % res['u5b']['worst_rel'])
    if a.out:
        json.dump(res, open(a.out, 'w'), indent=1, ensure_ascii=False)
    sys.exit(rc)


if __name__ == '__main__':
    main()
