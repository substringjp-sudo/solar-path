#!/usr/bin/env python3
"""
grain-test.py — RULER-grain 판정 코드(grain.py)의 합성 시험(렌더 없음). 동결 대상.
  python3 tools/genus-ruler/grain/grain-test.py [--jobs jobs-grain.json --scenes scenes-grain.json] [--out grain-test.json]
시험(번호는 RULER-grain §2.5 표와 같음):
  T1 이름 규칙·잡 목록 정합   T2 σs 알려진 잡음   T3 경사(램프) 불변   T4 노출·톤 배율 불변(σs, 비)
  T5 시간 더미(64 프레임 유지 모형) tStd/σ   T6 분산 클리핑 모형(검토 통계 upscale_clip) — 표시 tStd 압축 vs σs 무압축
  T7 표류 규칙(잡음만이면 안 걸림, 느린 표류는 걸림)   T8 포화 마스크(빨강만 잘림은 남김)   T9 꼬리 비율 χ²₃ 기댓값
  T10 A/A 귀무(블록 부트스트랩 CI 포함률·오분류율)   T11 검정력(σ 반감)   T12 분류 표   T13 분모·장면 묶음·부호 검정
  T14 T_band(정지 짝 곱) 잡음 불편·흐림 검출   T15 sparkFrac   T16 CSF 필터   T17 E4 지터 인공물(golden)
  T18 화소 고도   T19 eCSF 기준 잡음 빼기   T20 G0 상태 차이   T21 부트스트랩 결정성   T22 끝까지(합성 잡 폴더 → 판정)
  T23 보정 끝까지(합성 A/A → 블록·P0n·허용폭)   T24 확인 집합 Q
"""
import sys, os, json, math, tempfile, shutil
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib.util
_spec = importlib.util.spec_from_file_location('grain', os.path.join(HERE, 'grain.py'))
G = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(G)

RES = []


def check(label, cond, **info):
    RES.append({'test': label, 'pass': bool(cond), **{k: (float(v) if isinstance(v, (np.floating, float)) else v) for k, v in info.items()}})
    print(('PASS ' if cond else 'FAIL ') + label + ('  ' + json.dumps(info, default=float) if info else ''))


def fbm(rng, h, w, beta=3.0):
    ky = np.fft.fftfreq(h)[:, None]; kx = np.fft.fftfreq(w)[None, :]
    k = np.sqrt(kx ** 2 + ky ** 2); k[0, 0] = 1
    F = (rng.normal(size=(h, w)) + 1j * rng.normal(size=(h, w))) * k ** (-beta / 2); F[0, 0] = 0
    x = np.real(np.fft.ifft2(F)); return (x - x.mean()) / x.std()


# ───────── 합성 잡 폴더(capture.ts 와 같은 파일·형·행 순서) ─────────
def write_job(root, name, mu_tex, alpha_tex, sigma, seed, el=9.0, fov=16.399, stills=True, extra=None, drift=0.0, sample_noise=None):
    """구름 격자(텍셀) 진실 휘도 mu_tex·알파 alpha_tex(ch×cw), 텍셀마다 표본 4 개 = mu·(1 + σ·n). 캔버스 = 텍셀 2×2(가장 가까운 확대).
    표시 길 Ld = Lr = 표본 그대로(톤·잡음 제거 없음 — 추정기·판정 논리 시험용). 64 프레임 창 = 표본 4 개를 16 프레임씩 유지."""
    rng = np.random.default_rng(seed)
    ch, cw = mu_tex.shape
    n = sample_noise if sample_noise is not None else rng.standard_normal((4, ch, cw))
    Y = mu_tex[None] * (1 + sigma * n)
    if drift:
        Y = Y * (1 + drift * np.array([-1.5, -0.5, 0.5, 1.5])[:, None, None])
    d = os.path.join(root, name); os.makedirs(d, exist_ok=True)
    samp = np.stack([Y.mean(0), Y.std(0, ddof=1), alpha_tex, np.zeros_like(alpha_tex)], -1)
    samp.astype('<f2').tofile(os.path.join(d, 'samp.f16'))
    up = lambda a: np.kron(a, np.ones((2, 2)))
    Lk = np.stack([up(y) for y in Y])                         # 4 × gh × W
    H, W = Lk.shape[1:]
    ln = np.log(np.maximum(Lk, 0) + G.LN_OFF)
    lnw = np.repeat(ln, 16, axis=0)                           # 64 프레임
    lnStd = lnw.std(0, ddof=1)
    lnStd.astype('<f2').tofile(os.path.join(d, 'lnStd.f16'))
    m1, m2 = Lk[:2].mean(0), Lk[2:].mean(0)
    (np.log(np.maximum(m1, 0) + 0.01) - np.log(np.maximum(m2, 0) + 0.01)).astype('<f2').tofile(os.path.join(d, 'drift.f16'))
    up(alpha_tex).astype('<f2').tofile(os.path.join(d, 'meanA.f16'))
    np.zeros((H, W, 2), np.uint8).tofile(os.path.join(d, 'flags.u8'))
    Lk.mean(0).astype('<f4').tofile(os.path.join(d, 'meanLd.f32'))
    if stills:
        for k in range(4):
            Lk[k].astype('<f2').tofile(os.path.join(d, 'still%d.Ld.f16' % k))
            Lk[k].astype('<f2').tofile(os.path.join(d, 'still%d.Lr.f16' % k))
    from PIL import Image
    g8 = lambda x: np.round(255 * G.srgb_enc(x)).astype(np.uint8)
    mL = Lk.mean(0); ua = up(alpha_tex)
    Image.fromarray(np.stack([g8(mL)] * 3, -1)).save(os.path.join(d, 'mean.png'))
    Image.fromarray(np.round(255 * np.clip(ua, 0, 1)).astype(np.uint8)).save(os.path.join(d, 'mean.alpha.png'))
    meta = {'name': name, 'mode': 'capture', 'W': W, 'H': H, 'canvasCropRows': [0, H], 'cloudGrid': {'cw': cw, 'ch': ch, 'lw': -(-cw // 4), 'lh': -(-ch // 4), 'cropRows': [0, ch]},
            'captureOk': True, 'input': {'el': el, 'fov': fov}, 'grain': {'mode': 'capture'}}
    meta.update(extra or {})
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'))
    return G.Job(d)


def write_ref(root, name, mu_tex, alpha_tex, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    d = os.path.join(root, name); os.makedirs(d, exist_ok=True)
    up = lambda a: np.kron(a, np.ones((2, 2)))
    L = up(mu_tex)
    A = L * (1 + noise * up(rng.standard_normal(mu_tex.shape))); B = L * (1 + noise * up(rng.standard_normal(mu_tex.shape)))
    for t in ('Ld', 'Lr'):
        ((A + B) / 2).astype('<f4').tofile(os.path.join(d, 'ref.%s.f32' % t))
        A.astype('<f4').tofile(os.path.join(d, 'refA.%s.f32' % t)); B.astype('<f4').tofile(os.path.join(d, 'refB.%s.f32' % t))
    up(alpha_tex).astype('<f4').tofile(os.path.join(d, 'ref.A.f32'))
    H, W = L.shape
    ch, cw = mu_tex.shape
    json.dump({'name': name, 'mode': 'reference', 'W': W, 'H': H, 'canvasCropRows': [0, H], 'cloudGrid': {'cw': cw, 'ch': ch, 'cropRows': [0, ch]},
               'captureOk': True, 'input': {'el': 9.0, 'fov': 16.399}, 'grain': {'mode': 'reference', 'n': 32}}, open(os.path.join(d, 'meta.json'), 'w'))
    return G.Job(d)


def cloud_field(rng, ch=96, cw=80, cover=0.6):
    """덩어리 알파(0/1 + 가장자리 반투명)와 밝기 텍스처(0.2~0.8)."""
    f = fbm(rng, ch, cw, 3.5)
    th = np.quantile(f, 1 - cover)
    a = np.clip((f - th) / 0.35, 0, 1)
    mu = 0.45 * np.exp(0.35 * fbm(rng, ch, cw, 3.0))
    mu = np.where(a > 0, mu, 0.08)       # 하늘
    return mu, a


def main(argv):
    out = os.path.join(HERE, 'grain-test.json')
    jobs_f = os.path.join(HERE, 'jobs-grain.json'); scenes_f = os.path.join(HERE, 'scenes-grain.json')
    for i, k in enumerate(argv):
        if k == '--out': out = argv[i + 1]
        if k == '--jobs': jobs_f = argv[i + 1]
        if k == '--scenes': scenes_f = argv[i + 1]
    rng = np.random.default_rng(20261028)
    tmp = tempfile.mkdtemp(prefix='grain-test-')
    try:
        run_all(rng, tmp, jobs_f, scenes_f)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    n_fail = sum(1 for r in RES if not r['pass'])
    json.dump({'grainSha256': G.grain_sha256(), 'passed': len(RES) - n_fail, 'failed': n_fail, 'results': RES}, open(out, 'w'), indent=1, default=float)
    print('grain-test: %d passed, %d failed → %s' % (len(RES) - n_fail, n_fail, out))
    return 1 if n_fail else 0


def run_all(rng, tmp, jobs_f, scenes_f):
    # T1 이름 규칙·잡 목록
    nm = G.job_name('E1b', 'cu35_e5', 's', 'dev', 'ref')
    p = G.parse_name(nm)
    check('T1 name round trip', p == {'arm': 'E1b', 'scene': 'cu35_e5', 'layer': 'cu35', 'time': 'e5', 'az': 's', 'frame': 'dev', 'tag': 'ref'}, name=nm)
    if os.path.exists(jobs_f) and os.path.exists(scenes_f):
        J = json.load(open(jobs_f)); S = json.load(open(scenes_f))
        bad = []
        for j in J:
            q = G.parse_name(j['name'])
            if q['arm'] != j['arm'] or q['az'] != j['az'] or q['frame'] != j['frame'] or q['layer'] != j['layer'] or q['time'] != j['time']:
                bad.append(j['name'])
        check('T1 every job name parses to its fields', not bad, n=len(J), bad=bad[:3])
        held = {G.parse_name(j['name'])['scene'] for j in J if j['set'] in ('heldout', 'confirm', 'ref', 'hdev')}
        check('T1 held-out scenes in scene table', held <= set(S['scenes']), missing=sorted(held - set(S['scenes']))[:5])
        check('T1 F-dev vfov = device centre pitch', abs(S['frames']['dev']['fov'] - 2 * math.degrees(math.atan((584 / 2340) * math.tan(math.pi / 6)))) < 2e-3, fov=S['frames']['dev']['fov'])
        dup = len(J) - len({j['name'] for j in J})
        check('T1 job names unique', dup == 0, dup=dup)
        g = [j for j in J if j.get('grain', {}).get('mode') == 'reference']
        check('T1 reference jobs: upscale off, temporalAlpha 1, n = 2·ss²k', all(j['options'].get('temporalUpscale') is False and j['resolve']['temporalAlpha'] == 1 and j['grain']['n'] % (2 * j['grain']['ss'] ** 2) == 0 for j in g), n=len(g))
        import re
        cap = open(os.path.join(HERE, 'capture.ts')).read()
        repk = re.findall(r"'([^']+)'", re.search(r'REPACKED_LAYER_UNIFORMS = \[([\s\S]*?)\]', cap).group(1))
        rep = [j['name'] for j in J if any(k in repk for k in (j.get('material') or {}))]
        check('T1 no job overrides a repacked layer uniform', len(repk) == 11 and not rep, nRepacked=len(repk), bad=rep[:3])
    # T2 σs 알려진 잡음
    mu, a = cloud_field(rng)
    a1 = np.ones_like(a)
    for sg in (0.01, 0.05, 0.2):
        j = write_job(tmp, 'C0__t2_%g__s__dev' % sg, mu, a1, sg, 1)
        m = G.single_metrics(j)
        check('T2 sigma_samp ≈ σ (σ=%g)' % sg, abs(m['sigInt'] / sg - 1) < 0.03, ratio=m['sigInt'] / sg)
    # T3 경사 불변: 잡음 0 의 큰 경사 → σs 0, tCSF 0; 경사 위 잡음 → σs 는 경사 없는 것과 같음
    ramp = np.linspace(0.1, 0.9, 80)[None, :] * np.ones((96, 1))
    j0 = write_job(tmp, 'C0__t3ramp0__s__dev', ramp, a1, 0.0, 2)
    m0 = G.single_metrics(j0)
    check('T3 ramp without noise: σs = 0, tCSF = 0', m0['sigInt'] == 0 and m0['tCSFInt'] < 1e-9, sig=m0['sigInt'], tcsf=m0['tCSFInt'])
    n = np.random.default_rng(3).standard_normal((4, 96, 80))
    jr = write_job(tmp, 'C0__t3ramp__s__dev', ramp, a1, 0.05, 3, sample_noise=n)
    jf = write_job(tmp, 'C0__t3flat__s__dev', np.full_like(ramp, 0.5), a1, 0.05, 3, sample_noise=n)
    check('T3 σs on ramp = σs on flat (same noise)', abs(G.single_metrics(jr)['sigInt'] / G.single_metrics(jf)['sigInt'] - 1) < 0.02)
    R = np.linspace(20, 230, 160)[None, :] + np.linspace(0, 40, 192)[:, None]      # 캔버스 화소의 선형 경사(부호)
    bp = G.box(R, 1) - G.box(R, 6)
    check('T3 T_band band-pass of a linear ramp ≈ 0 (interior)', np.abs(bp[20:-20, 20:-20]).max() < 1e-9, maxAbs=float(np.abs(bp[20:-20, 20:-20]).max()))
    # T4 노출 배율 불변: σs(k·L) = σs(L); 짝 비 불변
    jB = write_job(tmp, 'C0__t4__s__dev', mu, a1, 0.05, 4, sample_noise=n)
    jK = write_job(tmp, 'C0__t4k__s__dev', 1.7 * mu, a1, 0.05, 4, sample_noise=n)
    sB, sK = G.single_metrics(jB)['sigInt'], G.single_metrics(jK)['sigInt']
    check('T4 σs invariant to exposure ×1.7', abs(sK / sB - 1) < 2e-3, ratio=sK / sB)
    jE = write_job(tmp, 'X__t4__s__dev', mu, a1, 0.025, 5)
    jEK = write_job(tmp, 'X__t4k__s__dev', 1.7 * mu, a1, 0.025, 5)
    r1 = G.unit_pair(jB, jE, None, 'k', 'sig')['Int']['sig']['r']; r2 = G.unit_pair(jK, jEK, None, 'k', 'sig')['Int']['sig']['r']
    check('T4 paired σs ratio invariant to common exposure', abs(r1 / r2 - 1) < 3e-3, r1=r1, r2=r2)
    # T5 64 프레임 유지 모형: tStd/σ = √(64/63 · 3/4) = 0.873 (ln 영역, 작은 σ)
    j5 = write_job(tmp, 'C0__t5__s__dev', np.full((96, 80), 0.5), a1, 0.02, 6)
    t5 = G.single_metrics(j5)['tStdInt'] / (0.02 * 0.5 / (0.5 + G.LN_OFF))
    check('T5 tStd/σ = 0.873 under hold model', abs(t5 - math.sqrt(64 / 63 * 0.75)) < 0.02, ratio=t5)
    # T6 분산 클리핑(검토 통계 upscale_clip.py 이식, γ 2, 5 탭): 표시 tStd/σ 는 장면 질감에 따라 압축, σs(해석 앞)는 σ 그대로
    t6 = clip_model(rng)
    check('T6 clip model compresses display tStd (flat ≈ 0.46, textured 0.50–0.9; hold model 0.867)', 0.40 < t6['flat'] < 0.52 and 0.45 < t6['fbm_0.2'] < 0.56 and t6['fbm_0.02'] > 0.8, **t6)
    check('T6 → a true σ ratio of 0.5 (0.2 → 0.1, textured) reads > 0.5 on display tStd (ratios pulled toward 1)', t6['fbm_0.1'] * 0.1 / (t6['fbm_0.2'] * 0.2) > 0.5,
          displayRatio=t6['fbm_0.1'] * 0.1 / (t6['fbm_0.2'] * 0.2))
    check('T6 σs (pre-resolve) uncompressed by construction', abs(t6['sig_samp'] - 1) < 0.03, sig=t6['sig_samp'])
    # T7 표류: 잡음만 → drift_lp ≪ 0.5·tStd; 매끈한 표류 5 % → 걸림
    jn = write_job(tmp, 'C0__t7n__s__dev', mu, a1, 0.05, 7)
    jd = write_job(tmp, 'C0__t7d__s__dev', mu, a1, 0.05, 7, drift=0.05)
    P = G.px_masks(jn, G.sat_mask(jn))['Int']
    dn, dd = G.drift_lp(jn, P), G.drift_lp(jd, P)
    tn = G.single_metrics(jn)['tStdInt']
    check('T7 pure noise: smoothed drift < 0.5·tStd (not invalid)', not G.drift_invalid(dn, tn), drift=dn, tstd=tn)
    check('T7 smooth 5 % drift flagged', G.drift_invalid(dd, tn), drift=dd, tstd=tn)
    raw_rms = float(np.sqrt((np.nan_to_num(jn.drift())[P] ** 2).mean()))
    check('T7 (the review rule on unsmoothed D would flag pure noise)', raw_rms > 0.5 * tn, rawD=raw_rms, tstd=tn)
    # T8 포화: 빨강만 모든 프레임 → 남김; 세 채널 60 % 프레임 → 뺌; 평균 L ≥ 0.98 → 뺌
    j8 = write_job(tmp, 'C0__t8__s__dev', np.full((96, 80), 0.5), a1, 0.0, 8)
    fl = np.zeros((192, 160, 2), np.uint8); fl[:10, :, 1] = 255; fl[10:20, :, 0] = int(0.6 * 255); fl[10:20, :, 1] = 255; fl[20:30, :, 0] = int(0.4 * 255)
    fl.tofile(os.path.join(j8.dir, 'flags.u8')); j8._c.clear()
    mL = np.full((192, 160), 0.5, np.float32); mL[30:40] = 0.985; mL.tofile(os.path.join(j8.dir, 'meanLd.f32'))
    sm = G.sat_mask(j8)
    check('T8 red-only clipping kept; all-channel ≥ 50 % frames and mean L ≥ 0.98 excluded',
          (not sm[:10].any()) and sm[10:20].all() and (not sm[20:30].any()) and sm[30:40].all())
    # T9 꼬리: 균질 잡음에서 s_p > 3·중앙값 비율(χ²₃ 기댓값 ≈ 9e-5)
    j9 = write_job(tmp, 'C0__t9__s__dev', np.full((96, 80), 0.5), a1, 0.05, 9)
    tail = G.single_metrics(j9)['tailInt']
    check('T9 tail fraction ≈ χ²₃ expectation (< 1e-3)', tail < 1e-3, tail=tail)
    # T10 A/A 귀무 · T11 검정력
    nul_ex, nul_imp, nul_w, pw = [], [], [], []
    for k in range(60):
        muk, ak = cloud_field(np.random.default_rng(100 + k))
        B = write_job(tmp, 'C0__aa%d__s__dev' % k, muk, ak, 0.05, 1000 + k)
        E = write_job(tmp, 'Z__aa%d__s__dev' % k, muk, ak, 0.05, 2000 + k)
        H = write_job(tmp, 'Y__aa%d__s__dev' % k, muk, ak, 0.025, 3000 + k)
        u = G.unit_pair(B, E, None, 'aa%d' % k, 'sig')['Int']
        uh = G.unit_pair(B, H, None, 'aa%d' % k, 'sig')['Int']
        if not u['invalid']:
            nul_ex.append(not (u['sig']['lo'] <= 1 <= u['sig']['hi']))
            c = G.classify(u, 'sig', 'nominal', 'dev'); nul_imp.append(c == 'imp'); nul_w.append(c == 'worse')
        if not uh['invalid']:
            pw.append(G.classify(uh, 'sig', 'nominal', 'dev') == 'imp')
    check('T10 A/A: 90 % CI excludes 1 in ≤ 15 % of null units', np.mean(nul_ex) <= 0.15, rate=float(np.mean(nul_ex)), n=len(nul_ex))
    check('T10 A/A: improved ≤ 5 %, worse ≤ 5 %', np.mean(nul_imp) <= 0.05 and np.mean(nul_w) <= 0.05, imp=float(np.mean(nul_imp)), worse=float(np.mean(nul_w)))
    check('T11 power: σ halved → improved in ≥ 95 %', np.mean(pw) >= 0.95, rate=float(np.mean(pw)), n=len(pw))
    # T12 분류 표
    t12(check)
    # T13 분모·묶음·부호 검정
    t13(check)
    # T14 T_band 잡음 불편·흐림 검출(검토 타당성 texture_xcov 이식)
    r14 = tband_check(np.random.default_rng(14))
    check('T14 T_xcov unbiased at noise σ 0.02/0.08 (within 5 %)', all(abs(r14['xcov_%g' % s] / r14['true'] - 1) < 0.05 for s in (0.02, 0.08)), **r14)
    check('T14 5×5 blur of texture drops T below 0.85·T(B)', r14['blur_xcov'] < 0.85 * r14['true'], **r14)
    # T15 sparkFrac: 정지마다 다른 1 % 화소에 +20 부호
    j15 = write_job(tmp, 'C0__t15__s__dev', np.full((96, 80), 0.3), a1, 0.0, 15)
    base = G.codes(np.full((192, 160), 0.3))
    for k in range(4):
        v = np.full((192, 160), 0.3)
        idx = np.random.default_rng(150 + k).random((192, 160)) < 0.01
        Vk = base + 20 * idx
        v = G.srgb_dec(Vk / 255.0) if hasattr(G, 'srgb_dec') else ((Vk / 255.0 + 0.055) / 1.055) ** 2.4
        v.astype('<f2').tofile(os.path.join(j15.dir, 'still%d.Ld.f16' % k))
    j15._c.clear()
    M15 = np.zeros((192, 160), bool); M15[10:-10, 10:-10] = True
    sf = G.spark_frac(j15, M15)
    check('T15 sparkFrac ≈ injected 1 %', 0.007 < sf < 0.013, spark=sf)
    # T16 CSF: 정점 1, 정점 주파수 ≈ 8 cpd, 상수 영상 통과 ≈ csf(0)
    f = np.linspace(0.01, 60, 6000); c = G.csf_ms(f)
    fpk = float(f[np.argmax(c)])
    con = G.csf_filter(np.full((64, 64), 10.0))
    check('T16 CSF peak 1 at ≈ 8 cpd; DC gain = csf(0)', abs(c.max() - 1) < 1e-3 and 7 < fpk < 9.5 and abs(con[32, 32] / 10 - float(G.csf_ms(0.0))) < 1e-6, peak_cpd=fpk, dc=float(G.csf_ms(0.0)))
    wn = np.random.default_rng(16).standard_normal((256, 256))
    gain = float(G.csf_filter(wn).std())
    check('T16 white-noise (1 px) CSF gain recorded (0.0115°/px)', 0 < gain < 1, gain=gain, degPerPx=G.deg_per_px())
    # T17 E4 지터 인공물(검토 통계 e4_golden): tStd 비 ≈ 0.93, 정지 RMS 비 ≈ 1
    r17 = e4_golden(np.random.default_rng(17))
    check('T17 golden-ratio jitter: tStd ratio ≈ 0.93 while still RMS ≈ 1.00 (→ E4 judged on eCSF only)', 0.9 < r17['tstd'] < 0.96 and abs(r17['still'] - 1) < 0.01, **r17)
    # T18 화소 고도
    el = G.pixel_elevation(390, 584, 9.0, 16.399)
    check('T18 pixel elevation: centre = el, top/bottom ≈ el ± vfov/2', abs(el[291:293, 194:196].mean() - 9) < 0.02 and abs(el[0, 195] - (9 + 8.2)) < 0.05 and abs(el[-1, 195] - (9 - 8.2)) < 0.05,
          top=float(el[0, 195]), bottom=float(el[-1, 195]))
    # T19 eCSF 기준 잡음 빼기: 기준 반쪽 잡음이 있어도 빼고 나면 정지 오차 ≈ 진실
    t19(check, tmp, rng)
    # T20 G0 상태 차이
    a_ = {'clouds.shader': '1:10', 'clouds.perUniform': {'perspectiveStepScale': 1, 'maxIterationCount': 2}, 'shadow.perUniform': {'shapeRepeat': 3}, 'frame': 5, 'clouds.uniforms': 'x'}
    b_ = {'clouds.shader': '1:10', 'clouds.perUniform': {'perspectiveStepScale': 9, 'maxIterationCount': 2}, 'shadow.perUniform': {'shapeRepeat': 3}, 'frame': 6, 'clouds.uniforms': 'y'}
    d = G.state_diff(a_, b_)
    check('T20 state diff: only intended uniform, frame/aggregate skipped', d == {'clouds.perUniform:perspectiveStepScale'} and d <= G.G0_ALLOWED['E1a.3'], diff=sorted(d))
    check('T20 E5 must touch both passes (shared uniform)', G.G0_ALLOWED['E5-'] == {'clouds.perUniform:shapeRepeat', 'shadow.perUniform:shapeRepeat'})
    # T21 결정성
    NB = np.random.default_rng(21).random(40) + 0.5
    r_a = G.ratio_rms(NB, NB * 2, NB * 1.1, NB * 2, 'key'); r_b = G.ratio_rms(NB, NB * 2, NB * 1.1, NB * 2, 'key')
    check('T21 bootstrap deterministic per unit key', r_a == r_b)
    # T22 끝까지: 8 장면 × 3 방위, E = σ 반감 → 통과; A/A → 통과 아님
    t22(check, tmp)
    # T23 보정(--calibrate) 끝까지: 합성 개발 집합(P8A·P8n777·P8n4242·P8B) → 블록 사다리·A/A 판정·P0n·G5 허용폭
    t23(check, tmp)
    # T24 확인 집합 Q(--confirm): 12 장면 방위 s, B_final σ 반감 → 확인 통과
    t24(check, tmp)


def clip_model(rng):
    """cloudsResolve temporalUpscale + varianceClipping(γ 2, 5 탭: 가운데 texelFetch + 이중선형 이웃 4) 정지 카메라 — 검토 통계 upscale_clip.py 그대로 이식.
    돌려줌: 표시 tStd/σ(유지 모형 0.867 대비)와 해석 앞 표본 σ/σ."""
    from scipy.ndimage import map_coordinates
    N = 128; n = N // 4
    BAY = np.array([[0, 12, 3, 15], [8, 4, 11, 7], [2, 14, 1, 13], [10, 6, 9, 5]])
    yy, xx = np.mgrid[0:N, 0:N]
    bayer = BAY[xx % 4, yy % 4]
    pos = {int(BAY[i, j]): (i, j) for i in range(4) for j in range(4)}

    def run(sigma, truth, frames=80, warm=16):
        nr = np.random.default_rng(0)
        noise = nr.standard_normal((64, n, n))
        out = truth + sigma * nr.standard_normal((N, N))
        s1 = np.zeros((N, N)); s2 = np.zeros((N, N)); samp = []
        lu = (yy + 0.5) / 4 - 0.5; lv = (xx + 0.5) / 4 - 0.5
        for t in range(frames):
            ox, oy = pos[t % 16]
            tr = truth[np.arange(n)[:, None] * 4 + oy, np.arange(n)[None, :] * 4 + ox]
            cur = tr + sigma * noise[t % 64]
            centre = cur[yy // 4, xx // 4]
            taps = [centre] + [map_coordinates(cur, [lu + du, lv + dv], order=1, mode='nearest') for du, dv in ((1, 0), (0, -1), (0, 1), (-1, 0))]
            T = np.stack(taps); m = T.mean(0); s = np.sqrt(np.maximum((T * T).mean(0) - m * m, 0)) * 2.0
            out = np.where(bayer == t % 16, centre, np.clip(out, m - s, m + s))
            if t >= warm:
                s1 += out; s2 += out * out; samp.append(cur - tr)
        W = frames - warm; mean = s1 / W; var = np.maximum(s2 / W - mean ** 2, 0)
        c = slice(8, N - 8)
        return float(np.sqrt(var[c, c].mean())) / sigma, float(np.std(np.stack(samp))) / sigma
    k = np.fft.fftfreq(N); K = np.sqrt(k[:, None] ** 2 + k[None, :] ** 2); K[0, 0] = 1
    F = (rng.standard_normal((N, N)) + 1j * rng.standard_normal((N, N))) * K ** -1.5; F[0, 0] = 0
    tex = np.real(np.fft.ifft2(F)); tex = 0.3 * tex / tex.std()
    flat, sg = run(0.05, np.zeros((N, N)))
    return {'flat': flat, 'fbm_0.02': run(0.02, tex)[0], 'fbm_0.05': run(0.05, tex)[0], 'fbm_0.1': run(0.1, tex)[0], 'fbm_0.2': run(0.2, tex)[0], 'sig_samp': sg}


def tband_check(rng):
    n = 256
    S = 25.0 * fbm(rng, n, n, 2.6)            # 부호 단위 질감
    bp = lambda a: G.box(a, 1) - G.box(a, 6)

    def xcov(sig, noise):
        st = [sig + noise * rng.standard_normal((n, n)) for _ in range(4)]
        b = [bp(x)[20:-20, 20:-20] for x in st]
        return float(np.mean([np.mean(b[i] * b[j]) for i in range(4) for j in range(4) if i < j]))
    true = float(np.mean(bp(S)[20:-20, 20:-20] ** 2))
    return {'true': true, 'xcov_0.02': xcov(S, 2.0), 'xcov_0.08': xcov(S, 8.0), 'blur_xcov': xcov(G.box(S, 2), 2.0)}


def e4_golden(rng):
    NP = 200000
    b = rng.integers(0, 16, NP); ign = rng.random(NP)
    wh = rng.random((NP, 4))
    k = np.arange(4)[None, :]
    go = np.mod(ign[:, None] + 0.61803398875 * (b[:, None] + 16 * k), 1.0)
    f = lambda j: j
    tw, tg = np.sqrt(np.mean(f(wh).var(1))), np.sqrt(np.mean(f(go).var(1)))
    sw, sg = np.sqrt(np.mean((f(wh[:, 0]) - 0.5) ** 2)), np.sqrt(np.mean((f(go[:, 0]) - 0.5) ** 2))
    return {'tstd': float(tg / tw), 'still': float(sg / sw)}


def mk_unit(r, lo, hi, mB, mE, **kw):
    return dict({'r': r, 'lo': lo, 'hi': hi, 'mB': mB, 'mE': mE, 'nb': 60}, **kw)


def t12(check):
    base = lambda **kw: dict({'invalid': [], 'jitter': False, 'refOk': False}, **kw)
    u = base(sig=mk_unit(0.7, 0.6, 0.9, 0.05, 0.035), tcsf=mk_unit(1.05, 0.9, 1.2, 3.0, 3.15))
    check('T12a improved: σs 0.70 (CI<1) and tCSF ≤ 1.10', G.classify(u, 'sig', 'nominal', 'dev') == 'imp')
    u = base(sig=mk_unit(0.7, 0.6, 0.9, 0.05, 0.035), tcsf=mk_unit(1.2, 1.0, 1.4, 3.0, 3.6))
    check('T12b display worse-ish (1.2, CI touches 1) → tie, not improved', G.classify(u, 'sig', 'nominal', 'dev') == 'tie')
    u = base(sig=mk_unit(1.2, 1.05, 1.4, 0.05, 0.06), tcsf=mk_unit(1.0, 0.9, 1.1, 3.0, 3.0))
    check('T12c σs 1.2, CI>1, Δ ≥ 0.003 → worse', G.classify(u, 'sig', 'nominal', 'dev') == 'worse')
    u = base(sig=mk_unit(1.2, 0.98, 1.4, 0.05, 0.06), tcsf=mk_unit(1.0, 0.9, 1.1, 3.0, 3.0))
    check('T12d σs 1.2 but CI includes 1 → tie', G.classify(u, 'sig', 'nominal', 'dev') == 'tie')
    u = base(sig=mk_unit(0.6, 0.5, 0.7, 0.02, 0.012), tcsf=mk_unit(0.6, 0.5, 0.7, 0.5, 0.3))
    check('T12e B invisible (tCSF 0.5 code) → floor (not counted as improved)', G.classify(u, 'sig', 'nominal', 'dev') == 'floor')
    u = base(sig=mk_unit(2.0, 1.5, 2.5, 0.02, 0.04), tcsf=mk_unit(4.0, 3.0, 5.0, 0.5, 2.0))
    check('T12f floor but E becomes visible (≥ 1.5 code, worse) → worse', G.classify(u, 'sig', 'nominal', 'dev') == 'worse')
    u = base(sig=mk_unit(0.7, 0.6, 0.9, 0.05, 0.035), tcsf=mk_unit(1.05, 0.9, 1.2, 3.0, 3.15), invalid=['nTex'])
    check('T12g invalid → na', G.classify(u, 'sig', 'nominal', 'dev') == 'na')
    u = base(ecsf=mk_unit(0.7, 0.6, 0.9, 3.0, 2.1), ecsfDev=mk_unit(0.8, 0.7, 0.95, 2.5, 2.0), tcsf=mk_unit(3.0, 2.0, 4.0, 3.0, 9.0), refOk=True, jitter=True)
    check('T12h jitter arm: tCSF not a gate (judged on eCSF)', G.classify(u, 'ecsf', 'nominal', 'dev') == 'imp')
    u = base(sig=mk_unit(0.75, 0.6, 0.9, 0.05, 0.0375), tcsf=mk_unit(1.0, 0.9, 1.1, 3.0, 3.0))
    check('T12i r 0.75: improved at nominal (0.80) but tie at strict (0.70)', G.classify(u, 'sig', 'nominal', 'dev') == 'imp' and G.classify(u, 'sig', 'strict', 'dev') == 'tie')
    u = base(sig=mk_unit(0.7, 0.6, 0.9, 0.05, 0.035), tstd=mk_unit(1.5, 1.2, 1.8, 0.02, 0.03))
    check('T12j F-std: display tStd(ln) worse → worse', G.classify(u, 'sig', 'nominal', 'std') == 'worse')


def t13(check):
    check('T13 sign-test cut: 12 of 15, 15 of 21, 7 of 8', G.binom_c(15) == 12 and G.binom_c(21) == 15 and G.binom_c(8) == 7)
    c_ok = G.cluster_criterion([math.log(0.6)] * 12 + [math.log(1.05)] * 3)
    c_no = G.cluster_criterion([math.log(0.6)] * 11 + [math.log(1.05)] * 4)
    c_few = G.cluster_criterion([math.log(0.6)] * 5)
    check('T13 cluster: 12/15 at 0.6 passes, 11/15 fails, < 6 scenes → None', c_ok['ok'] is True and c_no['ok'] is False and c_few['ok'] is None)
    # 분모: 50 K 단위 중 바닥 20 → Vimp 30 < 40 → '평가 불가(이미 바닥)'
    S = {'scenes': {('s%d' % i): {'layer': 'cu35', 'time': 'e5', 'bundle': 'L', 'product': True, 'sunEl': 5} for i in range(10)},
         'claims': {'E2': {('s%d' % i): {'dev': True, 'std': False, 'hdev': False} for i in range(10)}}}
    units = []
    for i in range(50):
        vis = 0.5 if i < 20 else 3.0
        units.append({'invalid': [], 'jitter': False, 'refOk': False, 'scene': 's%d' % (i % 10), 'layer': ['cu35', 'sc25', 'sc85', 'ac60', 'ci60'][i % 5], 'frame': 'dev', 'product': True,
                      'region': 'Int', 'sig': mk_unit(0.6, 0.5, 0.7, 0.05, 0.03), 'tcsf': mk_unit(0.6, 0.5, 0.7, vis, vis * 0.6)})
    v = G.verdict_for(units, S, 'E2a.8', 'sig')
    s = v['sets']['nominal']
    check('T13 floor units leave V_imp; V_imp∩K < 40 → 평가 불가(이미 바닥)', s['Vimp'] == 30 and s['floor'] == 20 and v['verdict'] == '평가 불가(이미 바닥)', Vimp=s['Vimp'], verdict=v['verdict'])


def t19(check, tmp, rng):
    mu, a = cloud_field(np.random.default_rng(19)); a1 = np.ones_like(a)
    B = write_job(tmp, 'C0__t19__s__dev', mu, a1, 0.05, 190)
    R0 = write_ref(tmp, 'C0__t19__s__dev__r0', mu, a1, 0.0)
    R1 = write_ref(tmp, 'C0__t19__s__dev__r1', mu, a1, 0.03, 191)
    e0 = G.single_metrics(B, R0)['eCSFInt']; e1 = G.single_metrics(B, R1)['eCSFInt']
    check('T19 eCSF with noisy reference, debiased ≈ noiseless-reference value (±10 %)', abs(e1 / e0 - 1) < 0.10, e_true=e0, e_noisyref=e1)


def t22(check, tmp):
    root = os.path.join(tmp, 'e2e'); os.makedirs(root)
    scenes, claims = {}, {}
    layers = ['cu35', 'sc25', 'sc85', 'ac60', 'ci60']
    for i in range(8):
        key = '%s_e%d' % (layers[i % 5], i)
        scenes[key] = {'layer': layers[i % 5], 'time': 'e%d' % i, 'bundle': 'L', 'product': True, 'sunEl': 5.0, 'photoGenus': 'Cu', 'record': False}
        claims[key] = {'dev': True, 'std': False, 'hdev': False}
    S = {'scenes': scenes, 'claims': {'E2': claims}}
    k = 0
    for key in scenes:
        for az in ('t', 's', 'a'):
            mu, a = cloud_field(np.random.default_rng(500 + k), cover=0.75); k += 1
            n = np.random.default_rng(900 + k).standard_normal((4,) + mu.shape)
            write_job(root, G.job_name('C0', key, az, 'dev'), mu, a, 0.06, 0, sample_noise=n)
            write_job(root, G.job_name('E2a.8', key, az, 'dev'), mu, a, 0.03, 0, sample_noise=np.random.default_rng(1900 + k).standard_normal((4,) + mu.shape))
            write_job(root, G.job_name('E2a.6', key, az, 'dev'), mu, a, 0.06, 0, sample_noise=np.random.default_rng(2900 + k).standard_normal((4,) + mu.shape))
    U = G.collect_units(S, root, 'C0', 'E2a.8', None, 'sig')
    v = G.verdict_for(U, S, 'E2a.8', 'sig')
    U0 = G.collect_units(S, root, 'C0', 'E2a.6', None, 'sig')
    v0 = G.verdict_for(U0, S, 'E2a.6', 'sig')
    s = v['sets']['nominal']
    check('T22 end-to-end: σ halved on every unit → 통과', v['verdict'] == '통과', verdict=v['verdict'], V=s['V'], impK=s['impK'], VimpK=s['VimpK'], cluster=v['cluster'])
    check('T22 end-to-end: A/A (same σ, new noise) → not 통과', v0['verdict'] not in ('통과', '불확정(효과 문턱)'), verdict=v0['verdict'], worse=v0['sets']['nominal']['worse'])


def t23(check, tmp):
    root = os.path.join(tmp, 'cal'); os.makedirs(root)
    k = 0
    for layer in ('cu35', 'sc85', 'ac60'):
        for time, frames in (('e5', ('dev', 'std')), ('e20', ('std',))):
            for frame in frames:
                for az in ('t', 's', 'a'):
                    mu, a = cloud_field(np.random.default_rng(700 + k), cover=0.7); k += 1
                    for tag, seed in (('P8A', 1), ('P8B', 1), ('P8n777', 2), ('P8n4242', 3)):
                        write_job(root, G.job_name('C0', layer + '_' + time, az, frame, tag), mu, a, 0.05, 10000 * seed + k, el=(9 if frame == 'dev' else 20), fov=(16.399 if frame == 'dev' else 60))
    out = os.path.join(tmp, 'calib.json')
    G.run_calibrate({'renders': root, 'out': out})
    c = json.load(open(out))
    G.set_blocks(4, 16)
    check('T23 calibrate: σs block 4×4 accepted; after A/A floor every metric CI-excl ≤ 15 %; A/A gate not passing (pass=True means no false pass)',
          c.get('blk') == [4, 16] and c['ciOk'] is True and c['aaGate']['pass'] is True,
          blk=c.get('blk'), boot=c['blockLadder'][0]['ciExcludeBoot'], floored=c['ciExcludeFloored'], aa=c['aaGate']['pass'])
    check('T23 calibrate: P0n identical replay → B_k reuse allowed', c['bkReuse'] is True and all(v['p95'] == 0 for v in c['p0n'].values()), p0n=c['p0n'])
    check('T23 calibrate: G5 tolerances from A/A (5 metrics) and aaSd recorded', len(c['g5Tol']) >= 4 and len(c['aaSd']) >= 2, g5Tol=c['g5Tol'])


def t24(check, tmp):
    root = os.path.join(tmp, 'q'); os.makedirs(root)
    layers = ['cu35', 'sc25', 'sc85', 'ac60', 'ci60']
    scenes, claims = {}, {}
    for i in range(12):
        key = '%s_q%d' % (layers[i % 5], i)
        scenes[key] = {'layer': layers[i % 5], 'time': 'q%d' % i, 'bundle': 'L', 'product': True, 'sunEl': 5.0, 'photoGenus': 'Cu', 'record': False}
        claims[key] = {'dev': True, 'std': False, 'hdev': False}
        mu, a = cloud_field(np.random.default_rng(800 + i), cover=0.75)
        write_job(root, G.job_name('C0', key, 's', 'dev', 'Q'), mu, a, 0.06, 1)
        write_job(root, G.job_name('Bfinal', key, 's', 'dev', 'Q'), mu, a, 0.03, 2)
    S = {'scenes': scenes, 'claims': {'E2': claims}}
    sf = os.path.join(tmp, 'qs.json'); json.dump(S, open(sf, 'w'))
    af = os.path.join(tmp, 'qa.json'); json.dump({'adopted': [{'arm': 'E2a.8', 'round': 2}]}, open(af, 'w'))
    of = os.path.join(tmp, 'qo.json')
    G.run_gate({'scenes': sf, 'renders': root, 'base': 'C0', 'cand': 'Bfinal', 'adopt_in': af, 'confirm': True, 'out': of})
    d = json.load(open(of))
    check('T24 confirm set Q: σ halved → 확인 통과', d['status'] == '확인 통과(채택)', verdict=d['verdict'], n=len(d['units']))


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
