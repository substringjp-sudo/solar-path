#!/usr/bin/env python3
"""
RULER-grain(§169~) 지표·판정 — 알갱이·반짝임(표본 오차). numpy + PIL 만(fm.py·phys2.py 는 import 만, 고치지 않음).
이 파일·grain-photo-quartiles.json(이 파일의 sha256 포함)·scenes-grain.json·jobs-grain.json 은 판정 렌더 전에 동결합니다(RULER-grain §10).

── 입력: grain/run-grain.js 가 쓴 잡 폴더 <out>/<팔>__<층>_<시각>__<방위>__<틀>[__꼬리표]/ (capture.ts 머리말) ──
  samp.f16    구름 버퍼 격자 [meanY, stdY(ddof1), meanA, stdA] — 해석(업스케일) 앞 1/4 해상도 표본, 텍셀마다 창 64 프레임에 정확히 4 개.
  lnStd.f16   화소마다 ln(Ld + 0.01) 의 창 64 프레임 표준편차(Ld = skyDenoise 뒤 표시 선형 휘도) · drift.f16 앞·뒤 반 창 평균의 ln 차
  meanA.f16   원(잡음 제거 전) 알파 창 평균 · flags.u8 [세 채널 모두 ≥ 0.98 인 프레임 비율, 아무 채널 ≥ 0.98 비율]·255
  meanLd.f32, still{k}.Ld.f16 (full 만) · mean.png/.alpha.png(원 경로 창 평균) · still0.png(F-std)
  기준 잡: ref.Ld.f32 · refA.Ld.f32 · refB.Ld.f32(skyDenoise(평균)) · ref.A.f32 · capMask.u8 · 비용 잡: cost.f16 [x, y, z, cap]
── 지표(RULER-grain §2) ──
  σs  = √(Σ_p var_p / Σ_p μ_p²)  (구름 격자, 마스크 텍셀, var·μ 는 텍셀 표본 4 개의 휘도) — 장면 선형·톤/노출/잡음 제거/클리핑 무관. 주 지표.
  표시 부호 V = 255·sRGB(clip(Ld)) (8비트 디더 앞), CSF = Mannos–Sakrison(정점 1로 정규화), 기기 화소 0.0602 mm·30 cm(0.0115°/화소).
  tCSF = √(mean_M var_k(CSF∗V_k))  정지 4 장(ddof 1) — 기기에 얼어붙는 알갱이의 보이는 크기(부호).
  eCSF = median_k √(mean_M (CSF∗(V_k − V_ref))²), 기준 반쪽 차로 뺌 √max(e² − refErr², 0), refErr² = mean (CSF∗(V_A − V_B))² / 4.
  sparkFrac · T_band(정지 화면 짝 곱 — 잡음에 불편) · eBias · aErr · tStd(ln, 기록) · eFine(기록) · 사진 지표(fm·phys2, 창 평균 PNG).
── 판정(RULER-grain §5·§6): 단위 = (장면, 방위, 틀, 영역 Int|Rim), 짝 블록 부트스트랩 CI 로 거른 개선/악화/동률, 세 문턱 벌, 장면 묶음·종류 기준.

쓰는 법:
  grain.py --photos [--out grain-photo-quartiles.json]
  grain.py --select jobs-grain.json key=val[,val] ... [--out sub.json]      (예: set=heldout arm=E1b frame=dev,std)
  grain.py --cap DIR [--out caps.json]                                     잡마다 홀로 지표(기록)
  grain.py --gate --scenes scenes-grain.json --renders DIR --base C0 --cand E1b --round 1 [--ref DIR] [--calib calib-grain.json]
           [--external ext.json] [--cumcap 1.40] [--adopt-in adopt-R0.json] --out gate-R1-E1b.json
  grain.py --adopt --round 1 --gates gate-R1-*.json [--adopt-in adopt-R0.json] --out adopt-R1.json
  grain.py --stop --scenes scenes-grain.json --renders DIR --base C0 [--ref DIR]   멈춤 규칙(제품 단위 80 % 가 보이지 않음)
  grain.py --calibrate --scenes scenes-grain.json --renders PROBE_DIR [--ref PROBE_DIR] --out calib-grain.json   탐침 P0n·P8·P2·P3·P4·P7
"""
import sys, os, json, math, glob, hashlib, datetime, zlib
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'flow'))
import fm      # noqa: E402
import phys2   # noqa: E402

# ═════════ 동결 상수(RULER-grain §2·§5·§6) ═════════
LN_OFF = 0.01                    # 표시 로그 지표의 오프셋 ln(L + 0.01)(검토 통계 #4)
MIN_TEX = {'Int': 400, 'Rim': 200}     # σs 마스크 최소 텍셀
MIN_PX = {'Int': 1600, 'Rim': 800}     # 표시 마스크 최소 화소
MIN_BLOCKS = 25
BLK_TEX, BLK_PX = 4, 16          # 부트스트랩 블록(구름 텍셀 4×4 · 캔버스 16×16)
BOOT_N, BOOT_SEED, CI_LO, CI_HI = 2000, 20261028, 0.05, 0.95
TSETS = {'nominal': (0.80, 1.10), 'liberal': (0.85, 1.15), 'strict': (0.70, 1.05)}
DELTA_ABS = {'sig': 0.003, 'code': 0.25, 'ln': 0.003}
DISP_NOT_WORSE = 1.10            # 개선 칸의 표시 보조 지표 점추정 상한
FLOOR_CODE, FLOOR_WORSE_CODE = 1.0, 1.5
OVERLAP_MIN = 0.7
DRIFT_MAX = 0.5                  # RMS 드리프트 > 0.5·tStd 면 무효
REF_ERR_MAX = 0.25               # 기준 반쪽 오차(부호, CSF) 상한
BORDER_PX = 8                    # CSF 필터 가장자리 제외
SPARK_CODE, SPARK_TOL, GUARD_SHARE = 10.0, 0.002, 0.90
T_BANDS = ((1, 6), (6, 16)); T_KEEP = 0.85; EL_SPLIT = 6.0
G5_KEYS = ('logIQR', 'structMid', 'perimPerArea', 'shadeRange', 'darkFrac')
G5_LN_TOL, G5_ABS_TOL = 0.10, 0.02    # darkFrac 은 절대 차
G7_MUL, G7_ADD, AERR_ADD = 1.25, 0.02, 0.02
G1_CF = 0.06
G2_SKY, G2_CLOUD, G2_CLOUD_MAX, G2_SAT = 0.01, 0.15, 0.30, 0.01
G8_MED, G8_BUNDLE, G8_CAP = 1.25, 1.40, 0.01
NMIN_K, NMIN_KP = 40, 20
STOP_SHARE = 0.80
CLUSTER_UPPER = math.log(0.90); SIGN_ALPHA = 0.05; MIN_SCENES = 6
GENUS_SHARE, GENUS_MIN = 0.6, 3
HDEV_NEED = 3
MM_PER_PX, VIEW_MM = 0.0602, 300.0
H_EL = (0.8, 17.0)               # H-dev 측정 고도대
L_LAYERS = ('cu35', 'sc25', 'sc85', 'ac60', 'ci60')
JITTER_ARMS = {'E4'}
DENSITY_ARMS = {'E3', 'E3b', 'E3c', 'E5-', 'E5+'}
SIMPLE_ARMS = {'E1a.3', 'E1a.0', 'E2a.8', 'E2a.6', 'E5-', 'E5+'}   # 하네스 값(셰이더 손잡이보다 단순)


def grain_sha256():
    return hashlib.sha256(open(os.path.abspath(__file__), 'rb').read()).hexdigest()


def isnum(v):
    return v is not None and isinstance(v, (int, float)) and v == v and abs(v) != float('inf')


# ═════════ 이름 ═════════
def parse_name(name):
    """<팔>__<층>_<시각>__<방위>__<틀>[__꼬리표] → dict. 박명 가드(tw1734 등)는 층=시각=장면 이름."""
    p = name.split('__')
    if len(p) < 4:
        raise ValueError('bad job name: ' + name)
    arm, scene, az, frame = p[:4]
    tag = p[4] if len(p) > 4 else None
    if '_' in scene:
        layer, time = scene.rsplit('_', 1)
    else:
        layer = time = scene
    return {'arm': arm, 'scene': scene, 'layer': layer, 'time': time, 'az': az, 'frame': frame, 'tag': tag}


def job_name(arm, scene, az, frame, tag=None):
    return '__'.join([arm, scene, az, frame] + ([tag] if tag else []))


# ═════════ 영상 보조 ═════════
def box(a, r):
    return fm.box_blur(a, r)


def srgb_enc(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c < 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def codes(L):
    return 255.0 * srgb_enc(L)


def deg_per_px(mm_per_px=MM_PER_PX, view_mm=VIEW_MM):
    return math.degrees(math.atan(mm_per_px / view_mm))


def csf_ms(f_cpd):
    """Mannos–Sakrison(1974) 대비 감도, 정점 1 로 정규화(정점 ≈ 8 cyc/deg)."""
    f = np.asarray(f_cpd, float)
    a = 2.6 * (0.0192 + 0.114 * f) * np.exp(-(0.114 * f) ** 1.1)
    ff = np.linspace(0, 60, 60001)
    peak = (2.6 * (0.0192 + 0.114 * ff) * np.exp(-(0.114 * ff) ** 1.1)).max()
    return a / peak


_CSF_CACHE = {}


def csf_filter(img, mm_per_px=MM_PER_PX, view_mm=VIEW_MM):
    """대칭 확장(2H×2W) 주기 FFT 에 CSF 를 곱해 거름 — 가장자리 불연속을 피함. 단위는 입력과 같음."""
    h, w = img.shape
    key = (h, w, mm_per_px, view_mm)
    if key not in _CSF_CACHE:
        fy = np.fft.fftfreq(2 * h)[:, None]; fx = np.fft.rfftfreq(2 * w)[None, :]
        _CSF_CACHE[key] = csf_ms(np.hypot(fx, fy) / deg_per_px(mm_per_px, view_mm))
    ext = np.concatenate([np.concatenate([img, img[:, ::-1]], 1), np.concatenate([img[::-1, :], img[::-1, ::-1]], 1)], 0)
    F = np.fft.rfft2(ext) * _CSF_CACHE[key]
    return np.fft.irfft2(F, s=ext.shape)[:h, :w]


def erode(mask, r):
    return box(mask.astype(np.float64), r) > 0.999


def pixel_elevation(W, H, el_deg, vfov_deg, rows=None):
    """캔버스 화소 고도(°): 카메라 기울기 el, 굴림 없음. rows = 위에서부터 행 번호 배열(자른 영역)."""
    t = math.tan(math.radians(vfov_deg) / 2)
    ys = np.arange(H) if rows is None else np.asarray(rows)
    v = t * (1 - 2 * (ys + 0.5) / H)
    u = t * (W / H) * (2 * (np.arange(W) + 0.5) / W - 1)
    V, U = np.meshgrid(v, u, indexing='ij')
    e = math.radians(el_deg)
    up = V * math.cos(e) + math.sin(e)
    hor = np.sqrt(U * U + (math.cos(e) - V * math.sin(e)) ** 2)
    return np.degrees(np.arctan2(up, hor))


# ═════════ 잡 읽기 ═════════
class Job:
    def __init__(self, d):
        self.dir = d
        self.meta = json.load(open(os.path.join(d, 'meta.json')))
        m = self.meta
        self.name = m['name']; self.info = parse_name(self.name)
        self.W, self.H = m['W'], m['H']
        cy0, cy1 = m.get('canvasCropRows', [0, self.H]); self.rows = np.arange(cy0, cy1); self.gh = cy1 - cy0
        cg = m.get('cloudGrid', {}); self.cw = cg.get('cw'); ccy0, ccy1 = cg.get('cropRows', [0, cg.get('ch', 0)]); self.cgh = ccy1 - ccy0
        self.ch = cg.get('ch'); self.crow0 = ccy0
        self._c = {}

    def has(self, f):
        return os.path.exists(os.path.join(self.dir, f))

    def arr(self, f, ch=1, grid='canvas'):
        if f in self._c:
            return self._c[f]
        dt = {'f16': '<f2', 'f32': '<f4', 'u8': 'u1'}[f.rsplit('.', 1)[1]]
        a = np.fromfile(os.path.join(self.dir, f), dtype=dt).astype(np.float64)
        w, h = (self.W, self.gh) if grid == 'canvas' else (self.cw, self.cgh)
        a = a.reshape((h, w) if ch == 1 else (h, w, ch))
        self._c[f] = a
        return a

    # 구름 격자
    def samp(self):
        return self.arr('samp.f16', 4, 'cloud')

    # 캔버스
    def meanA(self):
        return self.arr('meanA.f16')

    def flags(self):
        return self.arr('flags.u8', 2) / 255.0

    def lnStd(self):
        return self.arr('lnStd.f16')

    def drift(self):
        return self.arr('drift.f16')

    def meanLd(self):
        return self.arr('meanLd.f32')

    def still(self, k):
        return self.arr('still%d.Ld.f16' % k)

    def nstills(self):
        return sum(1 for k in range(8) if self.has('still%d.Ld.f16' % k))

    def elevation(self):
        inp = self.meta['input'] if 'input' in self.meta else self.meta['job']['input']
        return pixel_elevation(self.W, self.H, inp['el'], inp['fov'], self.rows)

    def ok(self):
        return bool(self.meta.get('captureOk'))


# ═════════ 마스크 ═════════
def sat_mask(job):
    """포화(표시 지표에서 뺌): 창 평균 Ld ≥ 0.98 또는 세 채널 모두 ≥ 0.98 인 프레임 ≥ 50 %(검토 타당성 B2 — 빨강만 잘린 노을 화소는 남김)."""
    f = job.flags()
    s = f[..., 0] >= 0.5
    if job.has('meanLd.f32'):
        s |= job.meanLd() >= 0.98
    return s


def tex_masks(job, extra_bad=None):
    s = job.samp(); mA = s[..., 2]; ok = np.isfinite(s[..., 1]) & np.isfinite(mA)
    if extra_bad is not None:
        ok &= ~extra_bad
    I = erode((mA >= 0.9) & ok, 1) & ok
    R = (mA >= 0.15) & (mA < 0.9) & ok
    return {'Int': I, 'Rim': R}


def px_masks(job, sat, el_range=None, extra_bad=None):
    mA = job.meanA(); ok = ~sat & np.isfinite(mA)
    if extra_bad is not None:
        ok &= ~extra_bad
    if el_range is not None:
        el = job.elevation(); ok &= (el >= el_range[0]) & (el <= el_range[1])
    border = np.zeros_like(ok); b = BORDER_PX
    border[b:-b, b:-b] = True
    ok &= border
    I = erode((mA >= 0.9) & ok, 2) & ok
    R = (mA >= 0.15) & (mA < 0.9) & ok
    return {'Int': I, 'Rim': R}


def tex_el_mask(job, el_range):
    """구름 격자 텍셀의 고도(캔버스 화소 고도를 텍셀 크기로 내려 받음)."""
    el = job.elevation()
    fy = job.gh / job.cgh; fx = job.W / job.cw
    yy = np.minimum((np.arange(job.cgh) * fy + fy / 2).astype(int), job.gh - 1)
    xx = np.minimum((np.arange(job.cw) * fx + fx / 2).astype(int), job.W - 1)
    e = el[yy][:, xx]
    return (e >= el_range[0]) & (e <= el_range[1])


def cap_px(ref_job, job):
    """기준의 반복 상한 텍셀 → 캔버스 화소 표지(마스크에서 뺌)."""
    if ref_job is None or not ref_job.has('capMask.u8'):
        return None
    c = np.fromfile(os.path.join(ref_job.dir, 'capMask.u8'), dtype='u1').reshape(ref_job.cgh, ref_job.cw) > 0
    fy = job.gh / ref_job.cgh; fx = job.W / ref_job.cw
    yy = np.minimum((np.arange(job.gh) / fy).astype(int), ref_job.cgh - 1)
    xx = np.minimum((np.arange(job.W) / fx).astype(int), ref_job.cw - 1)
    return c[yy][:, xx]


def cap_tex(ref_job, job):
    if ref_job is None or not ref_job.has('capMask.u8'):
        return None
    c = np.fromfile(os.path.join(ref_job.dir, 'capMask.u8'), dtype='u1').reshape(ref_job.cgh, ref_job.cw) > 0
    if c.shape == (job.cgh, job.cw):
        return c
    return None


# ═════════ 블록 합과 부트스트랩 ═════════
def block_ids(shape, blk):
    h, w = shape
    nbx = (w + blk - 1) // blk
    return (np.arange(h)[:, None] // blk) * nbx + (np.arange(w)[None, :] // blk)


def block_sums(values, mask, bid):
    """mask 안 값의 블록 합(블록 = bid). 블록마다 하나라도 마스크 화소가 있는 것만 남김(공통 순서 = 블록 번호)."""
    ids = bid[mask]
    nb = int(bid.max()) + 1
    return np.bincount(ids, weights=values[mask], minlength=nb)


def unit_seed(key):
    return (BOOT_SEED + zlib.crc32(key.encode())) % (2 ** 32)


def boot_counts(nb, seed, n=BOOT_N):
    rng = np.random.default_rng(seed)
    return rng.multinomial(nb, np.full(nb, 1.0 / nb), size=n).astype(np.float64)


def ratio_rms(NB, DB, NE, DE, key, n=BOOT_N):
    """짝 블록 부트스트랩: 비 = √(ΣN_E/ΣD_E) ÷ √(ΣN_B/ΣD_B). 같은 블록을 두 팔에 다시 뽑음. → (점, 하한, 상한, mB, mE, 블록 수)."""
    keep = (DB > 0) & (DE > 0)
    NB, DB, NE, DE = NB[keep], DB[keep], NE[keep], DE[keep]
    nb = len(NB)
    mB = math.sqrt(NB.sum() / DB.sum()) if nb else float('nan')
    mE = math.sqrt(NE.sum() / DE.sum()) if nb else float('nan')
    if nb < 2 or mB <= 0:
        return {'r': float('nan'), 'lo': float('nan'), 'hi': float('nan'), 'mB': mB, 'mE': mE, 'nb': nb}
    C = boot_counts(nb, unit_seed(key), n)
    with np.errstate(divide='ignore', invalid='ignore'):
        rb = np.sqrt((C @ NE) / (C @ DE)) / np.sqrt((C @ NB) / (C @ DB))
    rb = rb[np.isfinite(rb)]
    return {'r': mE / mB, 'lo': float(np.quantile(rb, CI_LO)), 'hi': float(np.quantile(rb, CI_HI)), 'mB': mB, 'mE': mE, 'nb': nb}


def ratio_median_debiased(EB, EE, D, N, key, n=BOOT_N):
    """eCSF 비: 정지 화면 k 마다 √(Σe_k²/ΣN) 의 중앙값, 기준 반쪽 오차를 제곱으로 뺌. EB·EE: (k, 블록), D: 블록(반쪽 차²), N: 블록 화소 수."""
    keep = N > 0
    EB, EE, D, N = EB[:, keep], EE[:, keep], D[keep], N[keep]
    nb = len(N)

    def stat(EX, w):
        tot = w @ N.T if w.ndim == 2 else (N * w).sum()
        if w.ndim == 2:
            per = (w @ EX.T) / tot[:, None]          # (n, k)
            ref = (w @ D) / tot / 4.0
            med = np.median(per, axis=1)
            return np.sqrt(np.maximum(med - ref, 0.0))
        per = (EX @ w) / tot
        return math.sqrt(max(float(np.median(per)) - float((D * w).sum() / tot / 4.0), 0.0))
    one = np.ones(nb)
    mB, mE = stat(EB, one), stat(EE, one)
    refErr = math.sqrt(max(D.sum() / N.sum() / 4.0, 0.0)) if nb else float('nan')
    if nb < 2 or mB <= 0:
        return {'r': float('nan'), 'lo': float('nan'), 'hi': float('nan'), 'mB': mB, 'mE': mE, 'nb': nb, 'refErr': refErr}
    C = boot_counts(nb, unit_seed(key), n)
    with np.errstate(divide='ignore', invalid='ignore'):
        rb = stat(EE, C) / stat(EB, C)
    rb = rb[np.isfinite(rb)]
    return {'r': mE / mB, 'lo': float(np.quantile(rb, CI_LO)) if len(rb) else float('nan'), 'hi': float(np.quantile(rb, CI_HI)) if len(rb) else float('nan'),
            'mB': mB, 'mE': mE, 'nb': nb, 'refErr': refErr}


# ═════════ 잡 하나의 지표(짝 없이, 기록·바닥) ═════════
def still_codes(job):
    return [codes(job.still(k)) for k in range(job.nstills())]


def ref_codes(ref):
    return codes(ref.arr('ref.Ld.f32')), codes(ref.arr('refA.Ld.f32')), codes(ref.arr('refB.Ld.f32'))


def tcsf_field(job):
    """정지 화면 4 장의 CSF 거른 부호 분산(ddof 1) — 화소별."""
    F = np.stack([csf_filter(v) for v in still_codes(job)])
    return F.var(axis=0, ddof=1)


def ecsf_fields(job, ref):
    Vr, VA, VB = ref_codes(ref)
    E = np.stack([csf_filter(v - Vr) ** 2 for v in still_codes(job)])
    D = csf_filter(VA - VB) ** 2
    return E, D


def spark_frac(job, mask):
    Vbar = codes(job.meanLd())
    fr = [float((np.abs(v - Vbar)[mask] > SPARK_CODE).mean()) for v in still_codes(job)] if mask.any() else []
    return float(np.median(fr)) if fr else float('nan')


def t_band(job, mask, el=None):
    """정지 화면 짝(k<l)의 대역 통과 곱 평균 — 독립 잡음은 기댓값 0, 정적 질감만 남음(검토 타당성 B3·G10). 고도 띠별."""
    V = still_codes(job)
    out = {}
    for (r1, r2) in T_BANDS:
        bp = [box(v, r1) - box(v, r2) for v in V]
        prs = [(i, j) for i in range(len(bp)) for j in range(len(bp)) if i < j]
        for tag, sel in (('lo', None if el is None else el < EL_SPLIT), ('hi', None if el is None else el >= EL_SPLIT)):
            m = mask if sel is None else (mask & sel)
            out['b%d_%d_%s' % (r1, r2, tag)] = float(np.mean([np.mean((bp[i] * bp[j])[m]) for i, j in prs])) if m.sum() >= 400 and prs else float('nan')
    return out


def photo_metrics(job, top=0.78):
    """창 평균(원 경로) PNG 에서 fm·phys2 지표 — 사진 사분위와 같은 자름·마스크(폭 320, 위 78 %, 알파 ≥ 0.15)."""
    p, a = os.path.join(job.dir, 'mean.png'), os.path.join(job.dir, 'mean.alpha.png')
    m = fm.all_metrics(p, 0, top, alpha_path=a, mask_mode='alpha')
    m2 = phys2.all_metrics2(p, 0, top, a)
    out = {k: m.get(k) for k in ('logIQR', 'shadeRange', 'perimPerArea', 'edgeWidthPx', 'darkFrac', 'cloudFrac', 'granSpatial', 'speckleExcess')}
    out.update({k: m2.get(k) for k in ('structMid', 'grainShareMid', 'nInt')})
    # G2 밝기(원 경로 창 평균, 선형 휘도)
    rgb = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    al = np.asarray(Image.open(a).convert('L')).astype(np.float64) / 255.0
    L, _ = fm.luminance(rgb)
    inner = erode(al >= 0.9, 2)
    sky = al < 0.02
    sat = (rgb[..., 0] >= 250) & (rgb[..., 1] >= 250) & (rgb[..., 2] >= 250) & (al >= 0.15)
    out['cloudL'] = float(np.median(L[inner])) if inner.sum() >= 200 else float('nan')
    out['skyL'] = float(np.median(L[sky])) if sky.sum() >= 200 else float('nan')
    out['satCloud'] = float(sat.sum() / max((al >= 0.15).sum(), 1))
    out['cf'] = float((al[: int(round(al.shape[0] * top))] >= 0.15).mean())
    return out


def single_metrics(job, ref=None):
    """잡 하나: σs·tStd·tCSF·바닥 등(기록·멈춤 규칙)."""
    out = {'name': job.name, 'captureOk': job.ok(), 'wallMs': job.meta.get('wallMs')}
    if job.meta.get('mode') != 'capture':
        return out
    el_rng = H_EL if job.info['frame'] == 'hdev' else None
    tm = tex_masks(job)
    if el_rng:
        te = tex_el_mask(job, el_rng); tm = {k: v & te for k, v in tm.items()}
    s = job.samp()
    sat = sat_mask(job); pm = px_masks(job, sat, el_rng)
    lnS = job.lnStd()
    for reg in ('Int', 'Rim'):
        M = tm[reg]
        out['nTex' + reg] = int(M.sum())
        out['sig' + reg] = float(math.sqrt((s[..., 1][M] ** 2).sum() / (s[..., 0][M] ** 2).sum())) if M.sum() else float('nan')
        P = pm[reg]
        out['nPx' + reg] = int(P.sum())
        out['tStd' + reg] = float(math.sqrt((lnS[P] ** 2).mean())) if P.sum() else float('nan')
        sd = s[..., 1][M] / np.maximum(s[..., 0][M], 1e-12)
        out['tail' + reg] = float((sd > 3 * np.median(sd)).mean()) if M.sum() else float('nan')
    out['driftInt'] = float(math.sqrt((job.drift()[pm['Int']] ** 2).mean())) if pm['Int'].sum() else float('nan')
    fl = job.flags()
    out['rClipFrac'] = float((fl[..., 1][pm['Int'] | pm['Rim']] > 0).mean()) if (pm['Int'] | pm['Rim']).sum() else float('nan')
    if job.nstills() >= 2:
        tv = tcsf_field(job)
        for reg in ('Int', 'Rim'):
            P = pm[reg]
            out['tCSF' + reg] = float(math.sqrt(tv[P].mean())) if P.sum() else float('nan')
        out['sparkFrac'] = spark_frac(job, pm['Int'] | pm['Rim'])
        if ref is not None:
            E, D = ecsf_fields(job, ref)
            for reg in ('Int', 'Rim'):
                P = pm[reg]
                if P.sum():
                    e = float(np.median([math.sqrt(E[k][P].mean()) for k in range(len(E))])); rr = math.sqrt(D[P].mean() / 4)
                    out['eCSF' + reg] = math.sqrt(max(e * e - rr * rr, 0)); out['refErr' + reg] = rr
    return out


# ═════════ 짝 단위(B, E) ═════════
def find_job(root, arm, scene, az, frame, tag=None):
    d = os.path.join(root, job_name(arm, scene, az, frame, tag))
    return Job(d) if os.path.exists(os.path.join(d, 'meta.json')) else None


def find_ref(refroot, scene, az, frame='dev', arm='C0', tag='ref'):
    if not refroot:
        return None
    d = os.path.join(refroot, job_name(arm, scene, az, frame, tag))
    return Job(d) if os.path.exists(os.path.join(d, 'meta.json')) else None


def ref_valid(ref):
    return ref is not None and bool(ref.meta.get('captureOk')) and ref.has('ref.Ld.f32')


def unit_pair(B, E, ref, key, primary):
    """한 (장면, 방위, 틀) 의 두 영역 짝 지표. primary: 'sig' | 'ecsf'. 돌려줌: {Int: {...}, Rim: {...}}."""
    frame = B.info['frame']
    el_rng = H_EL if frame == 'hdev' else None
    res = {}
    capT = cap_tex(ref, B) if ref is not None else None
    tB, tE = tex_masks(B, capT), tex_masks(E, capT)
    if el_rng:
        te = tex_el_mask(B, el_rng); tB = {k: v & te for k, v in tB.items()}; tE = {k: v & te for k, v in tE.items()}
    sB, sE = B.samp(), E.samp()
    bidT = block_ids(sB.shape[:2], BLK_TEX)
    full_disp = frame in ('dev', 'hdev', 'ddev') and B.nstills() >= 2 and E.nstills() >= 2
    sat = sat_mask(B) | sat_mask(E)
    capP = cap_px(ref, B) if ref is not None else None
    pB, pE = px_masks(B, sat, el_rng, capP), px_masks(E, sat, el_rng, capP)
    bidP = block_ids((B.gh, B.W), BLK_PX)
    lnB, lnE = B.lnStd(), E.lnStd()
    tvB = tcsf_field(B) if full_disp else None
    tvE = tcsf_field(E) if full_disp else None
    ecs = None
    if full_disp and ref_valid(ref):
        EB_, D = ecsf_fields(B, ref); EE_, _ = ecsf_fields(E, ref); ecs = (EB_, EE_, D)
    for reg in ('Int', 'Rim'):
        u = {'region': reg}
        Mt = tB[reg] & tE[reg]
        u['nTex'] = int(Mt.sum()); u['overlapTex'] = float(Mt.sum() / max(tB[reg].sum(), 1))
        u['sig'] = ratio_rms(block_sums(sB[..., 1] ** 2, Mt, bidT), block_sums(sB[..., 0] ** 2, Mt, bidT),
                             block_sums(sE[..., 1] ** 2, Mt, bidT), block_sums(sE[..., 0] ** 2, Mt, bidT), key + reg + 'sig')
        Mp = pB[reg] & pE[reg]
        u['nPx'] = int(Mp.sum()); u['overlapPx'] = float(Mp.sum() / max(pB[reg].sum(), 1))
        cnt = block_sums(np.ones_like(lnB), Mp, bidP)
        u['tstd'] = ratio_rms(block_sums(lnB ** 2, Mp, bidP), cnt, block_sums(lnE ** 2, Mp, bidP), cnt, key + reg + 'tstd')
        if full_disp:
            u['tcsf'] = ratio_rms(block_sums(tvB, Mp, bidP), cnt, block_sums(tvE, Mp, bidP), cnt, key + reg + 'tcsf')
            u['spark'] = {'B': spark_frac(B, Mp), 'E': spark_frac(E, Mp)}
        if ecs is not None:
            EB_, EE_, D = ecs
            u['ecsf'] = ratio_median_debiased(np.stack([block_sums(x, Mp, bidP) for x in EB_]), np.stack([block_sums(x, Mp, bidP) for x in EE_]),
                                              block_sums(D, Mp, bidP), cnt, key + reg + 'ecsf')
        # 드리프트(두 팔 모두)
        dB = math.sqrt((B.drift()[Mp] ** 2).mean()) if Mp.sum() else float('nan')
        dE = math.sqrt((E.drift()[Mp] ** 2).mean()) if Mp.sum() else float('nan')
        u['drift'] = {'B': dB, 'E': dE}
        # 유효성
        why = []
        if not (B.ok() and E.ok()): why.append('captureOk')
        if u['nTex'] < MIN_TEX[reg]: why.append('nTex')
        if u['overlapTex'] < OVERLAP_MIN: why.append('overlapTex')
        if u['sig']['nb'] < MIN_BLOCKS: why.append('blocks')
        if frame in ('dev', 'hdev') and u['nPx'] < MIN_PX[reg]: why.append('nPx')
        tsB, tsE = u['tstd']['mB'], u['tstd']['mE']
        if isnum(tsB) and isnum(dB) and dB > DRIFT_MAX * tsB: why.append('driftB')
        if isnum(tsE) and isnum(dE) and dE > DRIFT_MAX * tsE: why.append('driftE')
        if primary == 'ecsf':
            if 'ecsf' not in u: why.append('noRef')
            elif not isnum(u['ecsf']['refErr']) or u['ecsf']['refErr'] > REF_ERR_MAX: why.append('refErr')
        if 'ecsf' in u and isnum(u['ecsf'].get('refErr')) and u['ecsf']['refErr'] > REF_ERR_MAX:
            u['ecsfInvalid'] = True
        u['invalid'] = why
        res[reg] = u
    return res


def classify(u, primary, tset, frame):
    """한 단위의 분류: 'imp' | 'worse' | 'tie' | 'na'(무효) | 'floor'(보이지 않음 — 개선 셈 밖, 악화만). 세 문턱 벌 공통 규칙(§5.2)."""
    if u['invalid']:
        return 'na'
    ri, rw = TSETS[tset]
    P = u['ecsf'] if primary == 'ecsf' else u['sig']
    if not isnum(P['r']):
        return 'na'
    dkind = 'code' if primary == 'ecsf' else 'sig'
    disp = []          # 표시 보조(기기 피치): tCSF 늘, eCSF(주 지표가 아니고 유효할 때)
    if frame in ('dev', 'hdev') and 'tcsf' in u and primary != 'ecsf':
        disp.append(('tcsf', u['tcsf']))
        if 'ecsf' in u and not u.get('ecsfInvalid'):
            disp.append(('ecsf', u['ecsf']))
    if frame == 'std':
        disp.append(('tstd', u['tstd']))
    # 바닥(보이지 않음) — B 만으로: 기기 피치 단위에서 tCSF_B < 1 부호(그리고 eCSF_B < 1 부호, 있으면)
    floor = False
    if frame in ('dev', 'hdev'):
        vis = []
        if 'tcsf' in u and isnum(u['tcsf']['mB']) and primary != 'ecsf': vis.append(u['tcsf']['mB'])
        if 'ecsf' in u and not u.get('ecsfInvalid') and isnum(u['ecsf']['mB']): vis.append(u['ecsf']['mB'])
        floor = bool(vis) and max(vis) < FLOOR_CODE

    def worse_of(m, kind):
        return isnum(m['r']) and m['r'] >= rw and isnum(m['lo']) and m['lo'] > 1 and (m['mE'] - m['mB']) >= DELTA_ABS[kind]
    dworse = any(worse_of(m, 'ln' if k == 'tstd' else 'code') for k, m in disp)
    if floor:
        big = any(isnum(m['mE']) and m['mE'] >= FLOOR_WORSE_CODE for k, m in disp if k != 'tstd') or (primary == 'ecsf' and isnum(P['mE']) and P['mE'] >= FLOOR_WORSE_CODE)
        pw = primary == 'ecsf' and worse_of(P, 'code')
        return 'worse' if (dworse or pw) and big else 'floor'
    if worse_of(P, dkind) or dworse:
        return 'worse'
    if P['r'] <= ri and isnum(P['hi']) and P['hi'] < 1 and all(isnum(m['r']) and m['r'] <= DISP_NOT_WORSE for k, m in disp):
        return 'imp'
    return 'tie'


def binom_c(n, alpha=SIGN_ALPHA):
    """P(Bin(n, ½) ≥ c) ≤ alpha 인 가장 작은 c."""
    for c in range(n + 1):
        p = sum(math.comb(n, k) for k in range(c, n + 1)) / 2 ** n
        if p <= alpha:
            return c
    return n + 1


def cluster_criterion(scene_vals, seed=BOOT_SEED):
    """장면 묶음 기준(§5.2 iv): 장면 값 = 그 장면 K∩P 유효 단위의 ln 비 중앙값. 장면 부트스트랩(2000) 중앙값의 90 % 상한 < ln 0.90, 그리고 부호 검정."""
    v = np.array([x for x in scene_vals if isnum(x)])
    n = len(v)
    if n < MIN_SCENES:
        return {'n': n, 'ok': None, 'why': 'scenes<%d' % MIN_SCENES}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(BOOT_N, n))
    med = np.median(v[idx], axis=1)
    up = float(np.quantile(med, CI_HI))
    neg = int((v < 0).sum()); c = binom_c(n)
    return {'n': n, 'median': float(np.median(v)), 'upper90': up, 'neg': neg, 'need': c, 'ok': bool(up < CLUSTER_UPPER and neg >= c)}


# ═════════ 판정 ═════════
def arm_primary(arm):
    return 'ecsf' if arm in JITTER_ARMS or arm == 'E3b' else 'sig'


def k_of(arm):
    return {'E1a.3': 'E1', 'E1a.0': 'E1', 'E1b': 'E1', 'E2a.8': 'E2', 'E2a.6': 'E2', 'E2b': 'E2', 'E2c': 'E2', 'E3': 'E3', 'E3b': 'E3', 'E3c': 'E3',
            'E4': 'E4', 'E5-': 'E5', 'E5+': 'E5'}.get(arm)


def collect_units(S, root, base, cand, refroot, primary, sets=('heldout', 'hdev')):
    """held-out 단위 전부(두 팔 모두 그려진 것). 돌려줌: [단위 dict]."""
    units = []
    scenes = S['scenes']
    for key, sc in scenes.items():
        if sc.get('record'):
            continue
        for az in ('t', 's', 'a'):
            for frame in ('dev', 'std', 'hdev'):
                B = find_job(root, base, key, az, frame); E = find_job(root, cand, key, az, frame)
                if B is None or E is None:
                    continue
                ref = find_ref(refroot, key, az) if frame == 'dev' else None
                if primary == 'ecsf' and frame != 'dev':
                    continue
                if primary == 'ecsf' and ref is None:
                    continue
                pr = unit_pair(B, E, ref, job_name('', key, az, frame), primary)
                for reg, u in pr.items():
                    u.update({'scene': key, 'layer': sc['layer'], 'time': sc['time'], 'bundle': sc['bundle'], 'az': az, 'frame': frame,
                              'product': bool(sc['product']) and frame == 'dev'})
                    units.append(u)
    return units


def verdict_for(units, S, arm, primary):
    kk = k_of(arm)
    claims = S['claims'][kk] if kk else None
    inK = (lambda u: claims[u['scene']].get(u['frame'], False)) if claims else (lambda u: True)
    out = {'sets': {}}
    for tset in TSETS:
        cls = [classify(u, primary, tset, u['frame']) for u in units]
        V = [i for i, c in enumerate(cls) if c != 'na']
        Vimp = [i for i in V if cls[i] != 'floor']
        VK = [i for i in V if inK(units[i])]
        VimpK = [i for i in Vimp if inK(units[i])]
        VimpKP = [i for i in VimpK if units[i]['product']]
        VP = [i for i in V if units[i]['product']]
        imp = lambda ix: sum(1 for i in ix if cls[i] == 'imp')
        wor = lambda ix: sum(1 for i in ix if cls[i] == 'worse')
        r = {'V': len(V), 'Vimp': len(Vimp), 'VK': len(VK), 'VimpK': len(VimpK), 'VimpKP': len(VimpKP), 'VP': len(VP),
             'impK': imp(VimpK), 'impKP': imp(VimpKP), 'worse': wor(V), 'worseP': wor(VP), 'floor': sum(1 for c in cls if c == 'floor')}
        r['i'] = r['impK'] >= 0.5 * r['VimpK']
        r['ii'] = (r['impKP'] >= 0.5 * r['VimpKP']) if r['VimpKP'] >= NMIN_KP else True
        r['iii'] = r['worse'] <= 0.10 * r['V'] and (r['worseP'] <= 0.10 * r['VP'] if r['VP'] else True)
        # 종류 기준(v): L 층마다 K 유효 단위 ≥ 3 → 층 중앙 비 ≤ r_i 인 층 비율 ≥ 60 %, 층 ≥ 3
        lay = {}
        for i in VimpK:
            u = units[i]
            if u['layer'] in L_LAYERS:
                P_ = u['ecsf'] if primary == 'ecsf' else u['sig']
                lay.setdefault(u['layer'], []).append(P_['r'])
        lay = {k: float(np.median(v)) for k, v in lay.items() if len(v) >= 3}
        r['genus'] = lay
        r['v'] = None if len(lay) < GENUS_MIN else (sum(1 for v in lay.values() if v <= TSETS[tset][0]) >= GENUS_SHARE * len(lay))
        r['classes'] = cls
        out['sets'][tset] = r
    # 장면 묶음(iv) — 문턱 벌과 무관(장면 값 = K∩P 유효 단위의 ln 비 중앙)
    nom = out['sets']['nominal']['classes']
    sv = {}
    for i, u in enumerate(units):
        if nom[i] in ('na', 'floor') or not inK(u) or not u['product']:
            continue
        P_ = u['ecsf'] if primary == 'ecsf' else u['sig']
        if isnum(P_['r']) and P_['r'] > 0:
            sv.setdefault(u['scene'], []).append(math.log(P_['r']))
    out['cluster'] = cluster_criterion([float(np.median(v)) for v in sv.values()])
    out['sceneValues'] = {k: float(np.median(v)) for k, v in sv.items()}
    # H-dev(vi): K 가 H 단위를 포함하면 기기 피치 H 잡 4 개 중 ≥ 3 에서 Int σs 비 ≤ 1.0, 그리고 H-dev 악화 단위 없음
    hd = [(i, u) for i, u in enumerate(units) if u['frame'] == 'hdev']
    needH = claims is not None and any(claims[k].get('std') and S['scenes'][k]['bundle'] in ('H', 'O45') for k in claims)
    if needH and primary == 'sig':
        ints = [u for i, u in hd if u['region'] == 'Int' and not u['invalid']]
        okn = sum(1 for u in ints if isnum(u['sig']['r']) and u['sig']['r'] <= 1.0)
        anyw = any(nom[i] == 'worse' for i, u in hd)
        out['hdev'] = {'n': len(ints), 'ok': okn, 'worse': anyw, 'pass': (len(ints) >= HDEV_NEED and okn >= HDEV_NEED and not anyw) if ints else None}
    else:
        out['hdev'] = {'pass': True, 'note': 'H 주장 없음' if not needH else 'E4·E3b: eCSF(F-dev) 만'}
    # 종합
    def holds(t):
        r = out['sets'][t]
        return r['i'] and r['ii'] and r['iii'] and r['v'] is not False

    s = out['sets']['nominal']
    if s['VK'] < NMIN_K:
        out['verdict'] = '평가 불가'
    elif s['VimpK'] < NMIN_K:
        out['verdict'] = '평가 불가(이미 바닥)'
    elif any(out['sets'][t]['v'] is None for t in TSETS) and claims is not None and any(S['scenes'][k]['layer'] in L_LAYERS for k in claims if any(claims[k].values())):
        out['verdict'] = '평가 불가(종류)'
    elif out['cluster']['ok'] is None:
        out['verdict'] = '평가 불가(장면)'
    else:
        common = out['cluster']['ok'] and out['hdev']['pass'] is not False
        if common and all(holds(t) for t in TSETS):
            out['verdict'] = '통과'
        elif common and holds('nominal'):
            out['verdict'] = '불확정(효과 문턱)'
        else:
            out['verdict'] = '불합격'
    for t in TSETS:
        out['sets'][t].pop('classes')
    out['classesNominal'] = nom
    return out


# ═════════ 가드(§6) ═════════
def guards(S, root, base, cand, refroot, calib, primary, units, ext=None):
    g = {}
    sc = S['scenes']
    # 사진 기준 지표·면적·밝기(F-std 창 평균): G1b·G2·G5·G6
    rows = []
    for key, s in sc.items():
        if s.get('record'):
            continue
        for az in ('t', 's', 'a'):
            B = find_job(root, base, key, az, 'std'); E = find_job(root, cand, key, az, 'std')
            if B is None or E is None:
                continue
            rows.append({'scene': key, 'az': az, 'bundle': s['bundle'], 'sunEl': s['sunEl'], 'B': photo_metrics(B), 'E': photo_metrics(E)})
    g['n'] = len(rows)
    # G1b 장면별(방위 평균) cf
    cfd = {}
    for r in rows:
        cfd.setdefault(r['scene'], []).append((r['B']['cf'], r['E']['cf']))
    worst = max((abs(np.mean([e for b, e in v]) - np.mean([b for b, e in v])) for v in cfd.values()), default=float('nan'))
    g['G1b'] = {'maxAbsDcf': worst, 'pass': bool(isnum(worst) and worst <= G1_CF)}
    # G2 밝기
    def dln(a, b):
        return abs(math.log(a / b)) if isnum(a) and isnum(b) and a > 0 and b > 0 else float('nan')
    sky = [dln(r['E']['skyL'], r['B']['skyL']) for r in rows]
    cl = {}
    for r in rows:
        cl.setdefault(r['scene'], []).append(dln(r['E']['cloudL'], r['B']['cloudL']))
    clm = [np.nanmedian(v) for v in cl.values() if any(isnum(x) for x in v)]
    satd = [r['E']['satCloud'] - r['B']['satCloud'] for r in rows]
    g['G2'] = {'skyMax': float(np.nanmax(sky)) if sky else float('nan'), 'cloudShare': float(np.mean([x <= G2_CLOUD for x in clm])) if clm else float('nan'),
               'cloudMax': float(np.max(clm)) if clm else float('nan'), 'satMax': float(max(satd)) if satd else float('nan')}
    g['G2']['pass'] = bool(g['G2']['skyMax'] <= G2_SKY and g['G2']['cloudShare'] >= 0.9 and g['G2']['cloudMax'] <= G2_CLOUD_MAX and g['G2']['satMax'] <= G2_SAT)
    # G5 B 대비 양측(창 평균): |ln(m_E/m_B)| ≤ max(0.10, 2·sd_AA) (darkFrac 은 |Δ| ≤ max(0.02, 2·sd_AA)), 지표마다 유효 단위 ≥ 90 %. 해 ≥ 3° 장면.
    tol = (calib or {}).get('g5Tol', {})
    g5 = {}
    for k in G5_KEYS:
        ok = []
        for r in rows:
            if r['sunEl'] < 3:
                continue
            b, e = r['B'].get(k), r['E'].get(k)
            if not (isnum(b) and isnum(e)):
                continue
            if k == 'darkFrac':
                ok.append(abs(e - b) <= max(G5_ABS_TOL, tol.get(k, 0)))
            elif b > 0 and e > 0:
                ok.append(abs(math.log(e / b)) <= max(G5_LN_TOL, tol.get(k, 0)))
        g5[k] = {'n': len(ok), 'share': float(np.mean(ok)) if ok else float('nan'), 'pass': bool(ok) and float(np.mean(ok)) >= GUARD_SHARE}
    g['G5'] = {'per': g5, 'pass': all(v['pass'] for v in g5.values()), 'calibrated': bool(tol)}
    # G6(E3·E5 라운드, 창 평균): grainShareMid ≤ 사진 q75 점수(E) ≥ 점수(B) − t, 세 벌. 기준 라운드에서는 기록만(검토 타당성 M8).
    Qp = json.load(open(os.path.join(HERE, 'grain-photo-quartiles.json')))['g6'] if os.path.exists(os.path.join(HERE, 'grain-photo-quartiles.json')) else None
    if Qp:
        sc6 = {}
        for tset, kq in (('nominal', 'q75'), ('liberal', 'ci75hi'), ('strict', 'ci75lo')):
            sb = se = 0
            for r in rows:
                gq = Qp.get(sc[r['scene']]['photoGenus'], {}).get(kq)
                if gq is None:
                    continue
                b, e = r['B'].get('grainShareMid'), r['E'].get('grainShareMid')
                if isnum(b) and isnum(e):
                    sb += b <= gq; se += e <= gq
            sc6[tset] = {'B': int(sb), 'E': int(se)}
        t6 = int((calib or {}).get('g6Tol', 0))
        g['G6'] = {'scores': sc6, 'tol': t6, 'pass': all(v['E'] >= v['B'] - t6 for v in sc6.values()), 'recordOnly': cand not in DENSITY_ARMS}
    # 기준 칸(F-dev): G1c·G7
    g1c, g7 = [], []
    if refroot:
        for key, s in sc.items():
            if s.get('record') or not s['product']:
                continue
            for az in ('t', 's', 'a'):
                B = find_job(root, base, key, az, 'dev'); E = find_job(root, cand, key, az, 'dev'); ref = find_ref(refroot, key, az)
                if B is None or E is None or not ref_valid(ref):
                    continue
                Ar = ref.arr('ref.A.f32'); Lr = ref.arr('ref.Ld.f32')
                bias = {}
                for tag, J in (('B', B), ('E', E)):
                    mA = J.meanA(); cf = float((mA >= 0.15).mean()); cfr = float((Ar >= 0.15).mean())
                    sel = (mA >= 0.15) | (Ar >= 0.15)
                    aerr = float(np.abs(mA - Ar)[sel].mean()) if sel.any() else float('nan')
                    I = px_masks(J, sat_mask(J))['Int']
                    eb = box(np.log(J.meanLd() + LN_OFF) - np.log(Lr + LN_OFF), 8)
                    bias[tag] = {'cf': cf, 'cfRef': cfr, 'aErr': aerr, 'eBias': float(np.median(np.abs(eb[I]))) if I.sum() >= 400 else float('nan'),
                                 'eBiasMean': float(np.mean(eb[I])) if I.sum() >= 400 else float('nan')}
                g1c.append(abs(bias['E']['cf'] - bias['E']['cfRef']) <= abs(bias['B']['cf'] - bias['B']['cfRef']) + 0.02)
                if isnum(bias['B']['eBias']) and isnum(bias['E']['eBias']):
                    g7.append(bias['E']['eBias'] <= max(G7_MUL * bias['B']['eBias'], bias['B']['eBias'] + G7_ADD) and bias['E']['aErr'] <= bias['B']['aErr'] + AERR_ADD)
        g['G1c'] = {'n': len(g1c), 'share': float(np.mean(g1c)) if g1c else float('nan'), 'pass': (float(np.mean(g1c)) >= GUARD_SHARE) if g1c else None}
        g['G7'] = {'n': len(g7), 'share': float(np.mean(g7)) if g7 else float('nan'), 'pass': (float(np.mean(g7)) >= GUARD_SHARE) if g7 else None}
        if cand in DENSITY_ARMS and cand != 'E3b':
            g['G1c']['note'] = g['G7']['note'] = '밀도장을 바꾸는 팔 — C0 기준과의 비교는 기록만'
    # G10 질감 보존(F-dev, 정지 화면 짝 곱; E4 는 eCSF 로 대신) · G11 반짝임(sparkFrac)
    t10, s11 = {}, []
    for key, s in sc.items():
        if s.get('record') or not s['product']:
            continue
        for az in ('t', 's', 'a'):
            B = find_job(root, base, key, az, 'dev'); E = find_job(root, cand, key, az, 'dev')
            if B is None or E is None or B.nstills() < 2 or E.nstills() < 2:
                continue
            sat = sat_mask(B) | sat_mask(E)
            pB, pE = px_masks(B, sat), px_masks(E, sat)
            M = (pB['Int'] | pB['Rim']) & (pE['Int'] | pE['Rim'])
            if M.sum() < MIN_PX['Int']:
                continue
            spB, spE = spark_frac(B, M), spark_frac(E, M)
            s11.append(spE <= spB + SPARK_TOL)
            if cand in JITTER_ARMS:
                continue
            el = B.elevation()
            TB, TE = t_band(B, M, el), t_band(E, M, el)
            ref = find_ref(refroot, key, az)
            TR = t_band_ref(ref, M, el) if ref_valid(ref) and cand not in DENSITY_ARMS else None
            for k in TB:
                if not (isnum(TB[k]) and isnum(TE[k]) and TB[k] > 0):
                    continue
                ok = TE[k] >= T_KEEP * TB[k]
                if not ok and TR is not None and isnum(TR.get(k)) and TR[k] > 0 and TE[k] > 0:
                    ok = abs(math.log(TE[k] / TR[k])) <= abs(math.log(TB[k] / TR[k]))
                t10.setdefault(k, []).append(ok)
    g['G10'] = {'per': {k: {'n': len(v), 'share': float(np.mean(v))} for k, v in t10.items()},
                'pass': (all(np.mean(v) >= GUARD_SHARE for v in t10.values()) if t10 else None) if cand not in JITTER_ARMS else 'eCSF(주 지표)'}
    g['G11'] = {'n': len(s11), 'share': float(np.mean(s11)) if s11 else float('nan'), 'pass': (float(np.mean(s11)) >= GUARD_SHARE) if s11 else None}
    # G8 비용
    cb, ce, capd, bund = [], [], [], {}
    for key, s in sc.items():
        for frame in ('dev', 'std'):
            B = find_job(root, base, key, 's', frame, 'cost'); E = find_job(root, cand, key, 's', frame, 'cost')
            if B is None or E is None:
                continue
            fb, fe = B.meta['cost']['fetch'], E.meta['cost']['fetch']
            cb.append(fb); ce.append(fe); capd.append(E.meta['cost']['capFrac'] - B.meta['cost']['capFrac'])
            bund.setdefault(s['bundle'], []).append(fe / fb)
    rat = [e / b for b, e in zip(cb, ce) if b > 0]
    g['G8'] = {'n': len(rat), 'median': float(np.median(rat)) if rat else float('nan'), 'bundles': {k: float(np.median(v)) for k, v in bund.items()},
               'capMax': float(max(capd)) if capd else float('nan')}
    g['G8']['pass'] = bool(rat) and g['G8']['median'] <= G8_MED and all(v <= G8_BUNDLE for v in g['G8']['bundles'].values()) and g['G8']['capMax'] <= G8_CAP
    # 외부(G0·G3·G4·G9): eval-grain.sh 가 만든 JSON
    for k in ('G0', 'G3', 'G4', 'G9'):
        if ext and k in ext:
            g[k] = ext[k]
    return g


def t_band_ref(ref, M, el):
    """기준 렌더(평균 하나)의 같은 대역 에너지 — 비교용(기준 라운드의 대안 통과)."""
    V = codes(ref.arr('ref.Ld.f32'))
    out = {}
    for (r1, r2) in T_BANDS:
        bp = box(V, r1) - box(V, r2)
        for tag, sel in (('lo', el < EL_SPLIT), ('hi', el >= EL_SPLIT)):
            m = M & sel
            out['b%d_%d_%s' % (r1, r2, tag)] = float(np.mean((bp * bp)[m])) if m.sum() >= 400 else float('nan')
    return out


def run_gate(a):
    S = json.load(open(a['scenes']))
    calib = json.load(open(a['calib'])) if a.get('calib') and os.path.exists(a['calib']) else None
    ext = json.load(open(a['external'])) if a.get('external') and os.path.exists(a['external']) else None
    arm, base = a['cand'], a['base']
    primary = arm_primary(arm)
    units = collect_units(S, a['renders'], base, arm, a.get('ref'), primary)
    v = verdict_for(units, S, arm, primary)
    gd = guards(S, a['renders'], base, arm, a.get('ref'), calib, primary, units, ext)
    # 누적 비용(§5.5): C0 대비
    cum = None
    if a.get('cumcap') and a.get('c0') and a['c0'] != base:
        r = []
        for key in S['scenes']:
            for frame in ('dev', 'std'):
                C = find_job(a['renders'], a['c0'], key, 's', frame, 'cost'); E = find_job(a['renders'], arm, key, 's', frame, 'cost')
                if C is not None and E is not None and C.meta['cost']['fetch'] > 0:
                    r.append(E.meta['cost']['fetch'] / C.meta['cost']['fetch'])
        cum = {'median': float(np.median(r)) if r else float('nan'), 'cap': float(a['cumcap'])}
        cum['pass'] = bool(r) and cum['median'] <= cum['cap']
    gnames = ['G1b', 'G2', 'G5', 'G1c', 'G7', 'G10', 'G11'] + (['G6'] if arm in DENSITY_ARMS else []) + [k for k in ('G0', 'G3', 'G4', 'G9') if k in gd]
    gfail = [k for k in gnames if k in gd and gd[k].get('pass') is False]
    gnone = [k for k in gnames if k in gd and gd[k].get('pass') is None]
    doc = {'ruler': 'RULER-grain', 'grainSha256': grain_sha256(), 'date': datetime.date.today().isoformat(), 'round': a.get('round'), 'base': base, 'cand': arm,
           'primary': primary, 'claim': k_of(arm), 'verdict': v['verdict'], 'detail': {k: v[k] for k in v if k != 'classesNominal'},
           'guards': gd, 'guardFail': gfail, 'guardUnknown': gnone, 'cost': gd.get('G8'), 'cumCost': cum,
           'units': [{k: u[k] for k in u if k not in ()} for u in units], 'classesNominal': v['classesNominal'],
           'calibrated': calib is not None}
    st = doc['verdict']
    if st == '통과' and not gfail and gd.get('G8', {}).get('pass') and (cum is None or cum['pass']):
        doc['status'] = '채택 후보'
    elif st == '통과' and gfail == [] and not gd.get('G8', {}).get('pass'):
        doc['status'] = '비용 보류'
    elif st == '통과' and set(gfail) <= {'G1b', 'G1c'} and gfail:
        doc['status'] = '면적 재맞춤 필요'
    else:
        doc['status'] = st if st != '통과' else '가드 실패'
    if arm == 'E3c':
        doc['status'] = '진단(채택 안 함)'
    if not calib:
        doc['warning'] = 'calib-grain.json 없음 — 탐침 P8 보정 전(판정 렌더 전에 보정 필수, §8.3)'
    json.dump(doc, open(a['out'], 'w'), indent=1, default=lambda o: None)
    s = v['sets']['nominal']
    print('%s vs %s (%s): %s | 상태 %s | V %d Vimp %d K %d impK %d KP %d impKP %d worse %d | 장면 %s | H %s | 가드 실패 %s' % (
        arm, base, primary, v['verdict'], doc['status'], s['V'], s['Vimp'], s['VK'], s['impK'], s['VimpKP'], s['impKP'], s['worse'],
        json.dumps(v['cluster']), json.dumps(v['hdev']), gfail))


def run_adopt(a):
    """라운드 안 채택(§5.4): 채택 후보 중 K∩P 개선 단위 많은 쪽 → fetch 낮은 쪽 → 단순한 쪽. 비용 보류 목록. 이전 채택을 이어받음."""
    prev = json.load(open(a['adopt_in'])) if a.get('adopt_in') else {'adopted': [], 'costHold': []}
    gates = [json.load(open(f)) for f in a['gates']]
    cands = [g for g in gates if g.get('status') == '채택 후보']
    hold = [g['cand'] for g in gates if g.get('status') == '비용 보류']
    pick = None
    if cands:
        cands.sort(key=lambda g: (-g['detail']['sets']['nominal']['impKP'], (g.get('cost') or {}).get('median', 9), 0 if g['cand'] in SIMPLE_ARMS else 1))
        pick = cands[0]['cand']
    nxt = []
    if any(g['cand'] == 'E2a.8' and g.get('status') == '비용 보류' for g in gates):
        nxt.append('E2c')
    doc = {'ruler': 'RULER-grain', 'grainSha256': grain_sha256(), 'round': int(a['round']), 'adopted': prev['adopted'] + ([{'arm': pick, 'round': int(a['round'])}] if pick else []),
           'costHold': prev.get('costHold', []) + hold, 'conditionalNext': nxt, 'gates': [{'cand': g['cand'], 'status': g['status'], 'verdict': g['verdict']} for g in gates],
           'final': bool(a.get('final'))}
    json.dump(doc, open(a['out'], 'w'), indent=1)
    print('round', a['round'], 'adopted', pick, 'costHold', hold, 'next', nxt)


def run_stop(a):
    """멈춤 규칙(§5.3): 기준 팔의 제품 단위(F-dev) 중 ≥ 80 % 가 보이지 않음(tCSF_B < 1 부호, 기준 있으면 eCSF_B < 1 부호)."""
    S = json.load(open(a['scenes']))
    inv, n = 0, 0
    rows = []
    for key, s in S['scenes'].items():
        if s.get('record') or not s['product']:
            continue
        for az in ('t', 's', 'a'):
            B = find_job(a['renders'], a['base'], key, az, 'dev')
            if B is None:
                continue
            m = single_metrics(B, find_ref(a.get('ref'), key, az) if a.get('ref') else None)
            for reg in ('Int', 'Rim'):
                t = m.get('tCSF' + reg); e = m.get('eCSF' + reg)
                if not isnum(t):
                    continue
                n += 1
                vis = max(t, e if isnum(e) else 0)
                inv += vis < FLOOR_CODE
                rows.append({'scene': key, 'az': az, 'region': reg, 'tCSF': t, 'eCSF': e, 'sig': m.get('sig' + reg)})
    share = inv / n if n else float('nan')
    doc = {'n': n, 'invisible': inv, 'share': share, 'stop': bool(n and share >= STOP_SHARE), 'rows': rows}
    json.dump(doc, open(a['out'], 'w'), indent=1) if a.get('out') else None
    print('stop rule: invisible %d / %d = %.3f → %s' % (inv, n, share, '멈춤(사용자에게 묻기)' if doc['stop'] else '계속'))


# ═════════ 보정(탐침, §8.3) — 개발 집합 C0 만 ═════════
def mask_class(n):
    return 'small' if n < 1000 else ('mid' if n < 4000 else 'large')


def run_calibrate(a):
    S = json.load(open(a['scenes']))
    root = a['renders']
    sc = {}
    # 개발 장면 키(층_시각) — 장면 표에는 held-out 만 있으므로 이름으로
    jobs = sorted(os.listdir(root))
    def J(name):
        d = os.path.join(root, name)
        return Job(d) if os.path.exists(os.path.join(d, 'meta.json')) else None
    pairs = {}
    for nm in jobs:
        try:
            p = parse_name(nm)
        except ValueError:
            continue
        if p['tag'] and p['tag'].startswith('P8'):
            pairs.setdefault((p['scene'], p['az'], p['frame']), {})[p['tag'][2:]] = nm
    out = {'ruler': 'RULER-grain', 'grainSha256': grain_sha256(), 'date': datetime.date.today().isoformat(), 'blkTex': BLK_TEX, 'blkPx': BLK_PX}
    # P8 A/A: 씨앗 12345(A) 대 777·4242 — σs·tCSF·tStd 의 ln 비, CI 가 1 을 빼는 비율, 마스크 크기별 sd
    lnr, excl, cls_n = {}, [], {}
    g5d = {k: [] for k in G5_KEYS}; g6d = []
    p0n = {}
    for key, tg in pairs.items():
        scene, az, frame = key
        A = J(tg['A']) if 'A' in tg else None
        if A is None:
            continue
        for other in ('n777', 'n4242', 'B'):
            if other not in tg:
                continue
            E = J(tg[other])
            if E is None:
                continue
            pr = unit_pair(A, E, None, job_name('', scene, az, frame) + other, 'sig')
            for reg, u in pr.items():
                for met in ('sig', 'tcsf', 'tstd'):
                    if met not in u or not isnum(u[met]['r']) or u['invalid']:
                        continue
                    r = u[met]
                    if other == 'B':
                        p0n.setdefault(met, []).append(abs(r['r'] - 1))
                        continue
                    c = mask_class(u['nTex'] if met == 'sig' else u['nPx'] // 4)
                    lnr.setdefault(met + ':' + c, []).append(math.log(r['r']))
                    excl.append(not (r['lo'] <= 1 <= r['hi']))
            if frame == 'std' and other != 'B':
                mA, mE = photo_metrics(A), photo_metrics(E)
                for k in G5_KEYS:
                    if isnum(mA.get(k)) and isnum(mE.get(k)):
                        g5d[k].append(abs(mE[k] - mA[k]) if k == 'darkFrac' else (abs(math.log(mE[k] / mA[k])) if mA[k] > 0 and mE[k] > 0 else float('nan')))
    out['aaSd'] = {k: {'n': len(v), 'sd': float(np.std(v, ddof=1)) if len(v) > 1 else float('nan')} for k, v in lnr.items()}
    out['ciExcludeShare'] = float(np.mean(excl)) if excl else float('nan')
    out['ciOk'] = bool(excl) and out['ciExcludeShare'] <= 0.15
    out['g5Tol'] = {k: float(2 * np.nanstd([x for x in v if isnum(x)], ddof=1)) for k, v in g5d.items() if sum(isnum(x) for x in v) > 2}
    out['p0n'] = {k: {'n': len(v), 'p95': float(np.quantile(v, 0.95))} for k, v in p0n.items() if v}
    out['bkReuse'] = bool(out['p0n']) and all(v['p95'] < 0.05 for v in out['p0n'].values())
    # A/A 게이트 전체(의사 후보 = 씨앗 777, K 전부): '불합격' 이고 악화 ≤ 10 % 여야 함
    out['aaGateNote'] = 'eval-grain.sh calibrate 가 같은 코드로 --gate 를 돌려 aaGate 에 붙임'
    # P2 기준 수렴·앨리어싱 몫, P4 창 등가, P3 순서, P1 시간, P7 비용
    if a.get('ref'):
        r10, r5, rpt, c0 = J(job_name('C0', 'cu35_e5', 's', 'dev', 'P2ref10')), J(job_name('C0', 'cu35_e5', 's', 'dev', 'P2ref5')), J(job_name('C0', 'cu35_e5', 's', 'dev', 'P2refpt')), J(job_name('C0', 'cu35_e5', 's', 'dev', 'P8A'))
        if r10 and r5 and c0 and ref_valid(r10) and ref_valid(r5):
            m = px_masks(c0, sat_mask(c0))
            M = m['Int'] | m['Rim']
            d = csf_filter(codes(r10.arr('ref.Ld.f32')) - codes(r5.arr('ref.Ld.f32')))
            e = single_metrics(c0, r10)
            ec = max(e.get('eCSFInt', float('nan')), e.get('eCSFRim', float('nan')))
            out['P2'] = {'diff10v5': float(math.sqrt((d[M] ** 2).mean())), 'eCSF_C0': ec, 'refErr': e.get('refErrInt')}
            out['P2']['use5m'] = bool(out['P2']['diff10v5'] > 0.25 * ec)
            if rpt and ref_valid(rpt):
                aa = csf_filter(codes(rpt.arr('ref.Ld.f32')) - codes(r10.arr('ref.Ld.f32')))
                out['P2']['aliasShare'] = float(math.sqrt((aa[M] ** 2).mean()) / ec) if ec > 0 else float('nan')
            out['P1'] = {'refWallMsPerFrame': r10.meta.get('wallMs', 0) / max(1, r10.meta['grain'].get('n', 1))}
    p4 = []
    for layer in ('cu35', 'sc85', 'ac60'):
        Dd, Fd = J(job_name('C0', layer + '_e5', 's', 'ddev', 'P4')), J(job_name('C0', layer + '_e5', 's', 'dev', 'P8A'))
        if Dd is None or Fd is None:
            continue
        x0 = (Dd.W - Fd.W) // 2
        mD, mF = single_metrics_center(Dd, x0, Fd.W, Fd.gh), single_metrics(Fd)
        for reg in ('Int', 'Rim'):
            for met in ('sig', 'tCSF'):
                if isnum(mD.get(met + reg)) and isnum(mF.get(met + reg)) and mF[met + reg] > 0:
                    p4.append(mD[met + reg] / mF[met + reg])
    if p4:
        out['P4'] = {'ratios': p4, 'median': float(np.median(p4)), 'pass': all(0.8 <= x <= 1.25 for x in p4) and 0.9 <= float(np.median(p4)) <= 1.11 and len(p4) >= 6}
    a3, b3 = J(job_name('C0', 'cu35_e20', 't', 'std', 'P3')), J(job_name('C0', 'cu35_e20', 't', 'std', 'P8A'))
    if a3 and b3:
        p1, p2 = os.path.join(a3.dir, 'mean.png'), os.path.join(b3.dir, 'mean.png')
        x, y = np.asarray(Image.open(p1)).astype(int), np.asarray(Image.open(p2)).astype(int)
        dd = np.abs(x - y)
        out['P3'] = {'meanAbs255': float(dd.mean()), 'max': int(dd.max()), 'fracOver32': float((dd > 32).mean())}
        out['P3']['pass'] = out['P3']['meanAbs255'] <= 0.05 and out['P3']['fracOver32'] <= 0.005
    p7 = J(job_name('C0', 'cu35_e5', 's', 'dev', 'P7'))
    if p7:
        out['P7'] = p7.meta.get('cost')
    json.dump(out, open(a['out'], 'w'), indent=1, default=lambda o: None)
    print(json.dumps({k: out[k] for k in out if k in ('aaSd', 'ciExcludeShare', 'ciOk', 'g5Tol', 'p0n', 'bkReuse', 'P2', 'P3', 'P4', 'P7')}, indent=1, default=str))


def single_metrics_center(job, x0, w, h):
    """P4: 기기 전체 틀의 가운데 w×h(캔버스 화소) 만 — 같은 각도 영역. 구름 격자는 비례로 자름."""
    m = {}
    y0 = (job.gh - h) // 2
    s = job.samp(); fx = job.cw / job.W; fy = job.cgh / job.gh
    sl = (slice(int(y0 * fy), int((y0 + h) * fy)), slice(int(x0 * fx), int((x0 + w) * fx)))
    tm = tex_masks(job)
    for reg in ('Int', 'Rim'):
        M = tm[reg][sl]; ss = s[sl]
        m['sig' + reg] = float(math.sqrt((ss[..., 1][M] ** 2).sum() / (ss[..., 0][M] ** 2).sum())) if M.sum() else float('nan')
    pm = px_masks(job, sat_mask(job))
    if job.nstills() >= 2:
        tv = tcsf_field(job)[y0:y0 + h, x0:x0 + w]
        for reg in ('Int', 'Rim'):
            P = pm[reg][y0:y0 + h, x0:x0 + w]
            m['tCSF' + reg] = float(math.sqrt(tv[P].mean())) if P.sum() else float('nan')
    return m


# ═════════ 잡 고르기 · 홀로 지표 ═════════
def run_select(a):
    jobs = json.load(open(a['jobs']))
    conds = []
    for c in a['conds']:
        k, v = c.split('=', 1)
        conds.append((k, set(v.split(','))))
    sel = [j for j in jobs if all(str(j.get(k)) in vs for k, vs in conds)]
    s = json.dumps(sel)
    if a.get('out'):
        open(a['out'], 'w').write(s)
    else:
        print(s)
    print('selected', len(sel), file=sys.stderr)


def run_cap(a):
    rows = []
    for d in sorted(glob.glob(os.path.join(a['dir'], '*', 'meta.json'))):
        j = Job(os.path.dirname(d))
        try:
            rows.append(single_metrics(j))
        except Exception as e:   # noqa: BLE001 — 기록용, 판정 아님
            rows.append({'name': j.name, 'error': str(e)})
    json.dump({'grainSha256': grain_sha256(), 'rows': rows}, open(a['out'], 'w'), indent=1, default=lambda o: None)
    for r in rows:
        print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}))


# ═════════ 사진(§3.2) — 동결 행에서 문턱·CI(기록·G6) ═════════
def run_photos(out):
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
    D = json.load(open(os.path.join(HERE, '..', 'flow', 'photo-flow-quartiles.json')))
    Q2 = json.load(open(os.path.join(HERE, '..', 'flow', 'phys2-photo-quartiles.json')))
    rows = D['rows']
    genera = ['Cu', 'AcCc', 'Ci', 'StSc', 'As', 'St', 'Ns']
    g5 = {g: {k: phys2.quart_ci([r.get(k) for r in rows if r['genus'] == g]) for k in ('logIQR', 'shadeRange', 'perimPerArea', 'edgeWidthPx', 'darkFrac', 'granSpatial')} for g in genera}
    g6 = {}
    for g in genera:
        q = Q2['quartiles'][g]['grainShareMid']
        if q and q.get('n', 0) >= 10:
            g6[g] = {'q75': q['q75'], 'ci75lo': q['ci75'][0], 'ci75hi': q['ci75'][1], 'n': q['n']}
    sm = {g: Q2['quartiles'][g]['structMid'] for g in genera}
    # 폭 960(원본 화소, 기록만): phys2 제외 목록 그대로, grainShareMid·granSpatial
    excl = set(s.split(':')[0] for lst in Q2['excluded'].values() for s in lst)
    w960 = {}
    W0 = fm.W0
    try:
        fm.W0 = 960
        for sub, sel, gs in fm.PHOTO_SETS:
            Ssel = json.load(open(os.path.join(ROOT, 'tools/genus-ruler', sub, sel)))
            for g in gs:
                vals, gsp = [], []
                for idx, frac in Ssel[g].items():
                    f = os.path.join(ROOT, '.harness/genus', sub, 'thumbs', g, '%03d.jpg' % int(idx))
                    if not os.path.exists(f) or ('%s/%s' % (g, idx)) in excl:
                        continue
                    rgb, alpha = fm.load_crop(f, 0, min(1.0, float(frac)) * 0.97, 0.0, 1.0, None)
                    m = phys2.struct_metrics(rgb, alpha, 'nrbr', phys2.PHOTO_ERODE_EXTRA)
                    vals.append(m['grainShareMid'])
                w960[g] = {'grainShareMid': phys2.quart_ci(vals)}
    finally:
        fm.W0 = W0
    doc = {'ruler': 'RULER-grain', 'grainSha256': grain_sha256(), 'fmSha256': fm.fm_sha256(), 'phys2Sha256': phys2.phys2_sha256(),
           'sources': {'photo-flow-quartiles.json': hashlib.sha256(open(os.path.join(HERE, '..', 'flow', 'photo-flow-quartiles.json'), 'rb').read()).hexdigest(),
                       'phys2-photo-quartiles.json': hashlib.sha256(open(os.path.join(HERE, '..', 'flow', 'phys2-photo-quartiles.json'), 'rb').read()).hexdigest()},
           'date': datetime.date.today().isoformat(), 'bootN': phys2.BOOT_N, 'bootSeed': phys2.BOOT_SEED,
           'use': 'G6 = grainShareMid ≤ q75(기본)·ci75hi(넓게)·ci75lo(좁게), E3·E5 라운드 창 평균만; g5 = 사진 IQR 은 기록만(§3.2 — 판정은 B 대비 양측)',
           'g6': g6, 'g5record': g5, 'structMidRecord': sm, 'width960Record': w960}
    json.dump(doc, open(out, 'w'), indent=1)
    print('grain.py sha256', doc['grainSha256'])
    for g in genera:
        print('%-5s G6 q75 %s | logIQR %s | shadeRange %s' % (g, g6.get(g), (g5[g]['logIQR'] or {}).get('q75'), (g5[g]['shadeRange'] or {}).get('q75')))
    print('wrote', out)


def parse_args(argv):
    a = {'conds': [], 'gates': []}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k in ('--photos', '--gate', '--adopt', '--stop', '--calibrate', '--final'):
            a[k[2:]] = True; i += 1
        elif k == '--select':
            a['select'] = True; a['jobs'] = argv[i + 1]; i += 2
        elif k == '--cap':
            a['cap'] = True; a['dir'] = argv[i + 1]; i += 2
        elif k == '--gates':
            i += 1
            while i < len(argv) and not argv[i].startswith('--'):
                a['gates'].append(argv[i]); i += 1
        elif k.startswith('--'):
            a[k[2:].replace('-', '_')] = argv[i + 1]; i += 2
        else:
            a['conds'].append(k); i += 1
    return a


def main(argv):
    a = parse_args(argv)
    if a.get('photos'):
        run_photos(a.get('out', os.path.join(HERE, 'grain-photo-quartiles.json')))
    elif a.get('select'):
        run_select(a)
    elif a.get('cap'):
        run_cap({**a, 'out': a.get('out', os.path.join(a['dir'], 'caps.json'))})
    elif a.get('gate'):
        run_gate(a)
    elif a.get('adopt'):
        run_adopt(a)
    elif a.get('stop'):
        run_stop(a)
    elif a.get('calibrate'):
        run_calibrate(a)
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
