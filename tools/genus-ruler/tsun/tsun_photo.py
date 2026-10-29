#!/usr/bin/env python3
"""
RULER-tsun 사진·렌더 지표와 판정 (T_sun · 아치 빛) — RULER-tsun.md §3·§4 의 정의를 코드로 그대로. 동결 후보(2026-10-28, 검토 반영판).

  nice -n 19 python3 -I tsun_photo.py geo-export                  scratchpad geo 세 파일 → tsun-geo.json(카메라·실루엣, 한 번만; 저장소에 커밋)
  nice -n 19 python3 -I tsun_photo.py photo [--out tsun-photo.json]
      사진 P1·P2·P3 의 모든 지표(주 = Display-P3 → sRGB, 보조 = ICC 무시) + 견고성(블록 부트스트랩·정의 묶음) + 비평 숫자 재현(ICC 무시 길)
  nice -n 19 python3 -I tsun_photo.py render P1|P2|P3 그림.png [--hi 그림x16.png] [--meta results.json 의 잡 기록] [--out m.json]
      하네스 렌더 한 장의 지표: 표시 선형(사진과 같은 길) + 장면 선형(ACES 역변환, P1 은 ×16 노출과 합침). 크기·노출을 고정값과 대조.
  nice -n 19 python3 -I tsun_photo.py judge --photo tsun-photo.json --cand c.json --base C0ps.json [--c0 C0.json] [--arm-kind T|A] [--margins m.json]
  nice -n 19 python3 -I tsun_photo.py baseline [--out tsun-baseline.json]     비평 렌더(scratchpad)의 '오늘' 값(판정 아님)
  nice -n 19 python3 -I tsun_photo.py selftest                     고정한 비평 렌더를 다시 재서 tsun-baseline.json 과 같은지
  nice -n 19 python3 -I tsun_photo.py ra 후보.png 기준.png           R-A 단위 지표(§4.3, 장면 선형)
  nice -n 19 python3 -I tsun_photo.py cf B켬 B끔 CF켬 CF끔 CE켬 CE끔 [--hi …6 장]   서쪽 흐림 반사실 + 동쪽 대조(§4.5)
  nice -n 19 python3 -I tsun_photo.py hue 그림.png [--c0 C0.png]   박명 색 H1(§4.6, 반올림 없음)
  nice -n 19 python3 -I tsun_photo.py diff a.png b.png [--bytes]   끄면 그대로·높은 해(§4.1·§4.4)
  nice -n 19 python3 -I tsun_photo.py margins --aa a1.json a2.json … --var v1.json v2.json …   가드 여유(§4.2, A/A + 변형 퍼짐)
  nice -n 19 python3 -I tsun_photo.py feas P1B.png [--hi P1Bh.png] --rgb r,g,b [--out f.json]   더하는 아치 빛 가능성(§5.0)
  nice -n 19 python3 -I tsun_photo.py gate --manifest run.json [--out verdict.json]   팔마다 관문·가드·채택(§4.9), 손으로 고치지 않음

색 계산(§3.1): 8 비트 값 → (상자 축소, 8 비트 공간) → sRGB EOTF → 선형. 사진 주 길 = Display-P3 → 선형 sRGB 행렬(파일 ICC: "DCI-P3 D65
Gamut with sRGB Transfer"), 보조 길 = ICC 무시(비평과 같음). 렌더 표시 선형 = sRGB EOTF. 렌더 장면 선형 = three.js ACESFilmic 역변환
(노출 배율은 비에서 지워짐), 어느 채널이든 ≤ 3 또는 ≥ 250 인 화소는 빼고(발끝·잘림), P1 은 ×16 노출 렌더와 합침.
표시 luma = Rec.709 가중 × 8 비트 값. 선형 Y = 같은 가중 × 선형 값. R/B = 영역 선형 R 평균 / 선형 B 평균.
기하(§3.2): 화소 → (방위, 고도) 는 핀홀(주점 = 가운데), roll 포함, 기하 수평(굴절 없음). 카메라·실루엣은 tsun-geo.json(저장소).
"""
import argparse, hashlib, json, math, os, sys
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/twphoto'
UP = '/root/.claude/uploads/827aa702-2f52-52c8-9fe8-e45a3ff14759/'
GEO_FILE = os.path.join(HERE, 'tsun-geo.json')
GEO_SRC = {'P1': SCR + '/geo-P1.json', 'P2': SCR + '/heda/geo-P2.json', 'P3': SCR + '/heda/geo-P3.json'}
# 사진은 저장소 밖 — sha256 로 고정(§2). 경로는 환경 변수 TSUN_P1·TSUN_P2·TSUN_P3 로 바꿀 수 있음.
PHOTOS = {
    'P1': dict(img=UP + '035793bf-image.jpg', sha256='42bbd2ec6d6e6ee7cf480ce97923ba1b946a6ca79b98e3b5a24d40234c8b03ec', ds=4),
    'P2': dict(img=UP + '2ffb5792-image.jpg', sha256='d349990c673a19e3668cd28c7c36a5832024a0346802ab2b1effc33984da8461', ds=2),
    'P3': dict(img=UP + 'b7bca0fb-image.jpg', sha256='c715077d0eae013744a3d702d5edc0efbe32ab5ccfe040ffed09c4b96ec25966', ds=4),
}
# 엔진 해(src/utils/solarPosition.ts sunPosition, NOAA) — §2 표. SunCalc 금지.
SUN = {'P1': dict(alt=-9.8423, az=272.6585), 'P2': dict(alt=-6.9193, az=268.9720), 'P3': dict(alt=1.1076, az=263.3732)}
# 렌더 카메라(비평 렌더와 같음: roll 0) — scenes-tsun.json cams 와 같아야 함. W·H·노출은 render 가 대조(§2.2, 절차 #2d).
RENDER_CAM = {'P1': dict(az=275.301, el=8.452, vfov=58.285, roll=0.0, W=1000, H=750),
              'P2': dict(az=269.812, el=6.094, vfov=28.161, roll=0.0, W=390, H=520),
              'P3': dict(az=263.142, el=5.541, vfov=12.879, roll=0.0, W=800, H=600)}
EXPOSURE = {'P1': 45000.0, 'P2': 1250.617, 'P3': 3.890}   # 유효 노출 = autoExposure × exposureScale [computed, 절차 검토 #2d]
HI_FACTOR = 16.0          # P1 장면 선형용 두 번째 노출(×16 = exposureScale 720) — §3.1
LUM = np.array([0.2126, 0.7152, 0.0722])
M_P3_TO_SRGB = np.array([[1.2249401, -0.2249404, 0.0], [-0.0420569, 1.0420571, 0.0], [-0.0196376, -0.0786361, 1.0982735]])
TOE_LO, TOE_HI = 4, 249   # 장면 선형 유효 = 모든 채널 ∈ [4, 249](8 비트)
SEED = 20261028
NBOOT = 2000

# P1 덮개 가장자리(비평 rend/common.py P1_EDGE_AZEL, 사진에서 그은 선) — (방위, 고도)
P1_EDGE_AZEL = [(311.0, 25.56), (302.6, 23.86), (292.9, 20.63), (282.3, 16.31), (272.3, 11.89), (263.3, 8.59), (254.9, 5.97),
                (249.0, 4.24), (243.6, 3.24), (238.8, 2.60)]
P1_BINS = [(6, 10), (10, 15), (15, 20), (20, 30)]
P1_MIRROR_BINS = [(8, 10), (10, 12), (12, 14), (14, 16), (16, 18)]
P2_REG = {'strip': (1.1, 2.2), 'band': (2.5, 3.5), 'deck': (4.1, 6.8), 'upper': (6.8, 15.0)}
P2_GAP_BINS = [(7.5, 8.5), (8.5, 9.0)]
P2_E5_SCAN = [(6.0 + 0.5 * i, 6.5 + 0.5 * i) for i in range(12)]   # 보고: 6~12° 0.5° 칸(통계 검토 #1)
P2_E7_BINS = [(1, 1.5), (1.5, 2), (2, 2.5), (2.5, 3), (3, 3.5), (3.5, 4), (4, 5), (5, 6), (6, 8), (8, 10), (10, 12), (12, 15)]
EL_SAFE = {'P1': 5.0, 'P2': 4.0, 'P3': 6.0}   # 실루엣 최대(2.09 · 2.83 · 5.07°) + 여유 [estimate]
P2_MAST = dict(az=(273.45, 274.35), el_max=2.3)
P3_MAST = dict(az=(267.0, 267.5), el=(0.8, 1.45))
P3_REG = {'glow': dict(el=(1.2, 3.2), daz_max=2.5), 'side': dict(el=(1.2, 3.2), daz_min=4.0), 'mid': dict(el=(3.2, 6.5)),
          'upper': dict(el=(7.0, 12.0)), 'sheet': dict(el=(6.5, 8.25)), 'ref': dict(el=(4.25, 5.15)), 'far': dict(el=(1.25, 4.25)),
          'glow_s': dict(el=(1.55, 3.55), daz_max=2.5)}   # glow_s = 굴절 차 +0.35° 옮긴 빛 상자(보고, 타당성 m9)
A_DECK, A_CLEAR = 0.7, 0.1   # 렌더 알파: 구름 ≥ 0.7, 하늘 < 0.1 (D1m·D3m·D2)

# 비평이 적은 사진 값(재현 대상, ICC 무시 길)과 허용폭(§3.6): 비 ±5 %(상대), 고도 ±0.10°, 분율 ±0.05.
CRITIC = {
    'P1': {'D1box': ([1.81, 1.73, 1.80, 1.76], 'rel', 0.05, 'twphoto/critic.md Q5 D1 (critic/pdeck.py)'),
           'D3box': ([0.25, 0.43, 1.00, 1.42], 'rel', 0.05, 'twphoto/critic.md Q5 D3 (critic/pdeck.py) — 두 자리 반올림'),
           'D2t': ([1.72, 1.60, 1.81, 2.06, 1.95], 'rel', 0.05, 'twphoto/critic.md §1 #7 (critic/mirror.py)'),
           'D4': (0.356, 'rel', 0.05, 'render-metrics.json photos.P1 band_p10_over_glow_luma (warped photo)'),
           'D5': (4.07, 'abs', 0.10, 'render-metrics.json photos.P1 band_top luma_rule_median (warped photo)')},
    'P2': {'E1': (2.20, 'abs', 0.10, 'heda/critic2/p2meas.json adopted/edges_halfmax_cols strip_top_med'),
           'E2': (3.80, 'abs', 0.10, 'heda/critic2/p2meas.json deck_edge_med'),
           'E3': (2.504, 'rel', 0.05, 'heda/critic2/p2meas.json adopted/meas band_strip'),
           'E4': (3.876, 'rel', 0.05, 'heda/critic2/p2meas.json adopted/meas band_deck'),
           'E5q': ([1.046, 1.304], 'rel', 0.05, 'heda/critic2/p2meas.json deck_vs_gap_quantile 7.5-8.5, 8.5-9.0'),
           'E8': (0.289, 'rel', 0.10, 'heda/render-metrics.json photos.P2 strip_over_band_RoverB (band 2.4-3.4, warped) — 정의 차이로 ±10 %')},
    'P3': {'C1': (5.618, 'rel', 0.05, 'heda/render-metrics.json photos.P3 glow_over_upper_RoverB (warped)'),
           'C2': (0.463, 'abs', 0.05, 'heda/render-metrics.json photos.P3 warm_frac_mid_2x_upperRB (warped)'),
           'C5': (1.75, 'abs', 0.10, 'heda/render-metrics.json photos.P3 glow.peak_el (warped)'),
           'C6': (1.693, 'rel', 0.05, 'heda/render-metrics.json photos.P3 glow_over_upper_luma (warped)')},
}
CITED = {
    'P1': {'D4s_cloud_over_sky_band': dict(value=[0.22, 0.24], src='twphoto/critic.md Q5 D4 (meas-P1.json)')},
    'P2': {'E5seg': dict(value={'7.5-8.0': 1.349, '8.0-8.5': 1.226, '8.5-9.0': 1.442, 'core': [1.393, 1.289, 1.579]}, src='heda/meas-P2.json deck_vs_gap_same_el'),
           'E6seg': dict(value={'7.5-8.0': 0.152, '8.0-8.5': 0.181, '8.5-9.0': 0.174, 'core': [0.124, 0.146, 0.141]}, src='heda/meas-P2.json deck_vs_gap_same_el'),
           'E7': dict(value={'0.75-2.25': 0.135, '2.25-3.5': 0.352, '3.5-6.25': 0.107, '6.25-9.0': 0.185, '9.0-10.0': 0.141},
                      src='heda/meas-P2.json headline ratio_cloud_to_sky_behind (critic Q5 E7 "0.06-0.43")')},
    'P3': {'C3': dict(value=0.93, src='heda/meas-P3.json headline 6.5-8.25 dark RB_over_ref (critic Q5 C3)'),
           'C4': dict(value=[6.408, 6.441, 7.767], src='heda/meas-P3.json headline RB_warm_over_ref 1.25-2.5/2.5-3.25/3.25-4.25')},
}
# 장면 선형에서도 내는 지표(색 비만 — 표시 luma 지표는 장면 선형에서 뜻 없음)
SCENE_KEYS = {'P1': ['D1m', 'D3m', 'D1m_parts', 'D1m_a09', 'D1box', 'D2_pooled_8_18', 'D2_pairs', 'D6', 'n_valid_scene'],
              'P2': ['E5a', 'E5a_merged', 'E5q', 'E6a', 'E8', 'RB', 'n_valid_scene'],
              'P3': ['C1', 'C1_glow_s', 'C2', 'RB', 'n_valid_scene']}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def srgb_eotf(x):
    x = np.asarray(x, np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def srgb_oetf8(l):
    l = np.clip(np.asarray(l, np.float64), 0, 1)
    return 255.0 * np.where(l <= 0.0031308, 12.92 * l, 1.055 * np.power(l, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------- ACES(three.js ACESFilmicToneMapping, postprocessing ToneMappingEffect ACES_FILMIC)
ACES_IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
ACES_OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])
ACES_IN_INV, ACES_OUT_INV = np.linalg.inv(ACES_IN), np.linalg.inv(ACES_OUT)


def aces_fwd(x, k=1.0):
    """장면 선형(…, 3) → 표시 선형(0~1 자름). k = toneMappingExposure."""
    v = (np.asarray(x, np.float64) * (k / 0.6)) @ ACES_IN.T
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    return np.clip((a / b) @ ACES_OUT.T, 0.0, 1.0)


def aces_inv(c, k=1.0):
    """표시 선형(자르기 전 값이라 가정) → 장면 선형. 이차식의 양의 근."""
    w = np.asarray(c, np.float64) @ ACES_OUT_INV.T
    w = np.minimum(w, 1.0 / 0.983729 - 1e-6)
    A = 1.0 - 0.983729 * w
    B = 0.0245786 - 0.4329510 * w
    C = -(0.000090537 + 0.238081 * w)
    u = (-B + np.sqrt(np.maximum(B * B - 4 * A * C, 0.0))) / (2 * A)
    return (u @ ACES_IN_INV.T) * (0.6 / k)


def scene_from_rgb8(rgb8):
    """8 비트 표시 → (장면 선형, 유효 마스크). 유효 = 모든 채널 ∈ [TOE_LO, TOE_HI]."""
    ok = (rgb8.min(-1) >= TOE_LO) & (rgb8.max(-1) <= TOE_HI)
    return aces_inv(srgb_eotf(rgb8)), ok


# ---------------------------------------------------------------- 기하
def basis(az0, el0, roll):
    a, e, r = np.radians([az0, el0, roll])
    F = np.array([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)])
    R = np.array([np.cos(a), -np.sin(a), 0.0])
    U = np.cross(R, F)
    return F, np.cos(r) * R + np.sin(r) * U, -np.sin(r) * R + np.cos(r) * U


def pix2azel(u, v, W, H, az0, el0, roll, f):
    F, R, U = basis(az0, el0, roll)
    x = (np.asarray(u, float) - W / 2) / f
    y = (np.asarray(v, float) - H / 2) / f
    D = F + x[..., None] * R - y[..., None] * U
    return (np.degrees(np.arctan2(D[..., 0], D[..., 1])) % 360,
            np.degrees(np.arctan2(D[..., 2], np.hypot(D[..., 0], D[..., 1]))))


def daz(az, a0):
    return ((az - a0) + 180.0) % 360.0 - 180.0


_GEO = None


def geo(pid):
    """저장소의 tsun-geo.json(절차 검토 #1) — scratchpad 에 기대지 않음."""
    global _GEO
    if _GEO is None:
        _GEO = json.load(open(GEO_FILE))
    return _GEO['photos'][pid]


def cmd_geo_export(a):
    out = {'note': 'RULER-tsun 사진 카메라·실루엣(scratchpad geo-P*.json 에서 옮김). 지표 코드는 이 파일만 읽음.', 'photos': {}}
    for pid, p in GEO_SRC.items():
        g = json.load(open(p)); c = g['camera']; s = g['photo_silhouette']
        out['photos'][pid] = dict(camera=dict(az0_deg=c['az0_deg'], el0_deg=c['el0_deg'], roll_deg=c['roll_deg'], f_px=c['f_px'], k1=c.get('k1', 0.0),
                                              image_size_after_exif_orientation=g['image_size_after_exif_orientation'], convention=c.get('convention')),
                                  silhouette=dict(az_deg=s['az_deg'], el_deg=s['el_deg'], source=s.get('source')),
                                  source=dict(path=p, sha256=sha256(p)))
        assert float(c.get('k1', 0.0)) == 0.0, (pid, 'k1 ≠ 0 — pix2azel 은 왜곡 없음')
    json.dump(out, open(GEO_FILE, 'w'), indent=1, ensure_ascii=False)
    print('wrote', GEO_FILE, {k: len(v['silhouette']['az_deg']) for k, v in out['photos'].items()})


class Img:
    """표시 8 비트 RGB(float) + 선형(표시 선형 또는 장면 선형) + (방위, 고도) + 하늘 마스크 (+ 렌더 알파)."""

    def __init__(self, pid, rgb8, az, el, alpha=None, kind='photo'):
        self.pid, self.kind = pid, kind
        self.rgb8 = rgb8.astype(np.float64)
        self.lin = srgb_eotf(self.rgb8)
        self.luma = self.rgb8 @ LUM
        self.Y = self.lin @ LUM
        self.az, self.el, self.alpha = az, el, alpha
        self.space = 'display'
        s = geo(pid)['silhouette']
        saz = np.array(s['az_deg'], float); sel = np.array(s['el_deg'], float); o = np.argsort(saz)
        sk = np.interp(az, saz[o], sel[o], left=np.nan, right=np.nan)
        self.sil_defined = np.isfinite(sk)
        with np.errstate(invalid='ignore'):
            m = (self.sil_defined & (el > sk + 0.15)) | (~self.sil_defined & (el >= EL_SAFE[pid]))
        if pid == 'P2':
            m &= el < 15.0
            m &= ~((az > P2_MAST['az'][0]) & (az < P2_MAST['az'][1]) & (el < P2_MAST['el_max']))
        if pid == 'P3':
            m &= ~((az >= P3_MAST['az'][0]) & (az <= P3_MAST['az'][1]) & (el >= P3_MAST['el'][0]) & (el <= P3_MAST['el'][1]))
        self.sky = m

    def with_lin(self, lin, valid=None, space='scene'):
        I2 = Img.__new__(Img); I2.__dict__.update(self.__dict__)
        I2.lin = lin; I2.Y = lin @ LUM; I2.space = space
        if valid is not None:
            I2.sky = self.sky & valid
        return I2

    def RB(self, m, minn=30):
        if m.sum() < minn:
            return None
        L = self.lin[m]
        return float(L[:, 0].mean() / max(L[:, 2].mean(), 1e-12))

    def Ym(self, m, minn=30):
        return float(self.Y[m].mean()) if m.sum() >= minn else None

    def lmed(self, m, minn=30):
        return float(np.median(self.luma[m])) if m.sum() >= minn else None


def load_photo(pid, path=None):
    """ICC 무시 길(비평과 같은 길)의 Img. 주 길은 photo_p3(I)."""
    P = PHOTOS[pid]
    path = path or os.environ.get('TSUN_' + pid) or P['img']
    c = geo(pid)['camera']
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    W, H = im.size
    assert [W, H] == c['image_size_after_exif_orientation'], (pid, im.size)
    ds = P['ds']
    small = np.asarray(im.resize((W // ds, H // ds), Image.BOX)).astype(np.float64)   # 8 비트 공간 상자 축소(비평과 같음)
    us = (np.arange(W // ds) + 0.5) * ds; vs = (np.arange(H // ds) + 0.5) * ds
    U, V = np.meshgrid(us, vs)
    az, el = pix2azel(U, V, W, H, c['az0_deg'], c['el0_deg'], c['roll_deg'], c['f_px'])
    return Img(pid, small, az, el, None, 'photo'), path


def photo_p3(I):
    """주 길(§3.1): Display-P3 선형 → 선형 sRGB(음수는 0 으로)."""
    return I.with_lin(np.clip(I.lin @ M_P3_TO_SRGB.T, 0, None), None, 'display-p3')


def load_render(pid, png, alpha_png=None, cam=None, hi_png=None, meta=None, check=True):
    """렌더 한 장 → 표시 선형 Img(.scene 에 장면 선형 Img, .merge 에 합침 점검). check 면 크기·노출을 고정값과 대조."""
    c = dict(RENDER_CAM[pid]); c.update(cam or {})
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.float64)
    H, W = a.shape[:2]
    if check and not cam:
        assert (W, H) == (c['W'], c['H']), f'{png}: 크기 {W}×{H} ≠ 고정 {c["W"]}×{c["H"]} (§2.2)'
    if check and meta and meta.get('exposure') is not None:
        want = EXPOSURE[pid] * (HI_FACTOR if meta.get('hi') else 1.0)
        assert abs(meta['exposure'] / want - 1) <= 1e-3, f'{png}: 노출 {meta["exposure"]} ≠ 고정 {want} (§2.3)'
    f = (H / 2) / math.tan(math.radians(c['vfov']) / 2)
    U, V = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    az, el = pix2azel(U, V, W, H, c['az'], c['el'], c['roll'], f)
    al = None
    alpha_png = alpha_png or (png[:-4] + '.alpha.png')
    if alpha_png and os.path.exists(alpha_png):
        al = np.asarray(Image.open(alpha_png).convert('L')).astype(np.float64) / 255.0
    I = Img(pid, a, az, el, al, 'render')
    S, ok = scene_from_rgb8(a)
    merge = None
    if hi_png:
        b = np.asarray(Image.open(hi_png).convert('RGB')).astype(np.float64)
        assert b.shape == a.shape, 'hi 크기 다름'
        Sb, okb = scene_from_rgb8(b)
        Sb = Sb / HI_FACTOR
        both = ok & okb
        ratio = float(np.median((Sb[both] @ LUM) / np.maximum(S[both] @ LUM, 1e-12))) if both.sum() >= 200 else None
        merge = dict(n_both=int(both.sum()), median_ratio_hi_over_lo=ratio,
                     ok=bool(ratio is not None and abs(ratio - 1) <= 0.03),
                     frac_valid_lo=float(ok.mean()), frac_valid_hi=float(okb.mean()))
        if merge['ok']:
            S = np.where(okb[..., None], Sb, S); ok = ok | okb
        merge['used'] = merge['ok']
    I.scene = I.with_lin(S, ok, 'scene')
    I.scene.n_valid = int(ok.sum())
    I.merge = merge
    return I


def r3(x, n=3):
    if x is None:
        return None
    if isinstance(x, (list, tuple)):
        return [r3(v, n) for v in x]
    if isinstance(x, dict):
        return {k: r3(v, n) for k, v in x.items()}
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else round(float(x), n)
    if isinstance(x, np.integer):
        return int(x)
    return x


def hue_fracs(rgb8):
    """RULER-twilight-hue.md 자주/푸른 비율(표시값)."""
    R, G, B = rgb8[:, 0], rgb8[:, 1], rgb8[:, 2]
    return dict(magenta=float(np.mean((G + 6 < R) & (G + 6 < B))), blue=float(np.mean((B > R + 6) & (B >= G))), n=int(len(rgb8)))


def cloud_masks(I, a_d=A_DECK, a_c=A_CLEAR):
    """렌더: (구름 α ≥ a_d, 하늘 α < a_c). 사진: 둘 다 전부(사진엔 알파가 없음 — 덮개 상자는 거의 이어진 구름, 통계 검토 #4)."""
    if I.alpha is None:
        t = np.ones(I.el.shape, bool)
        return t, t
    return I.alpha >= a_d, I.alpha < a_c


# ---------------------------------------------------------------- P1 (R-B-deep D1~D6)
def p1_edge(az):
    a = np.array([q[0] for q in P1_EDGE_AZEL][::-1]); e = np.array([q[1] for q in P1_EDGE_AZEL][::-1])
    return np.interp(az, a, e, left=np.nan, right=np.nan)


def p1_boxes(I):
    ee = p1_edge(I.az)
    with np.errstate(invalid='ignore'):
        above = I.el > ee + 2; below = I.el < ee - 2
    return above, below, I.sky & above & (I.az >= 236) & (I.az <= 300), I.sky & below & (I.az <= 312)


def matched(I, dk, cl, lo, hi, sub=0.25, minsub=3, minpx=100):
    """§3.3 D1m·D3m: 0.25° 고도 칸마다 덮개·맑음이 둘 다 ≥ 3 화소인 칸만, 맑음은 덮개 화소 수로 가중(같은 고도끼리, 타당성 M3c)."""
    nsub = int(round((hi - lo) / sub))
    sd = np.clip(np.floor((I.el[dk] - lo) / sub).astype(int), 0, nsub - 1)
    sc = np.clip(np.floor((I.el[cl] - lo) / sub).astype(int), 0, nsub - 1)
    Ld, Lc, Yd, Yc = I.lin[dk], I.lin[cl], I.Y[dk], I.Y[cl]
    nd = np.bincount(sd, minlength=nsub); nc = np.bincount(sc, minlength=nsub)
    keep = (nd >= minsub) & (nc >= minsub)
    kd = keep[sd]; kc = keep[sc]
    res = dict(el=[lo, hi], n_deck_box=int(dk.sum()), n_clear_box=int(cl.sum()), n_deck=int(kd.sum()), n_clear=int(kc.sum()),
               frac_deck_kept=float(kd.mean()) if len(kd) else 0.0)
    if kd.sum() < minpx or kc.sum() < minpx:
        res.update(D1m=None, D3m=None, RB_deck=None, RB_clear=None); return res
    RBd = Ld[kd, 0].sum() / max(Ld[kd, 2].sum(), 1e-12)
    w = np.where(keep, nd, 0).astype(float)
    def cm(v):
        return np.bincount(sc, v, minlength=nsub) / np.maximum(nc, 1)
    mR, mB, mY = cm(Lc[:, 0]), cm(Lc[:, 2]), cm(Yc)
    RBc = float((w * mR).sum() / max((w * mB).sum(), 1e-12))
    Ycw = float((w * mY).sum() / w.sum())
    res.update(D1m=float(RBd / RBc), D3m=float(Yd[kd].mean() / max(Ycw, 1e-12)), RB_deck=float(RBd), RB_clear=RBc)
    return res


def p1_d1m(I, a_d=A_DECK):
    above, below, deckbox, clearbox = p1_boxes(I)
    dmask, cmask = cloud_masks(I, a_d)
    return [matched(I, deckbox & dmask & (I.el >= lo) & (I.el < hi), clearbox & cmask & (I.el >= lo) & (I.el < hi), lo, hi) for lo, hi in P1_BINS]


def p1_d2(I, above, below):
    az, el, sky = I.az, I.el, I.sky
    out = {}
    # D2 기하 거울: 덮개 쪽 = 해 방위 − d (3 ≤ d ≤ 20), 가장자리 + 2° 위; 거울 = 해 방위 + d, 같은 줄 ±0.2°, 가장자리 − 2° 아래.
    # 렌더는 덮개 쪽 α ≥ 0.7, 거울 쪽 α < 0.1(통계 #5 공동 관문).
    dmask, cmask = cloud_masks(I)
    sun = SUN['P1']['az']
    out['D2'] = []; pairs_all = ([], [])
    for lo, hi in P1_MIRROR_BINS:
        dk_px, cl_px = [], []
        rows = np.where((sky & (el >= lo) & (el < hi)).any(1))[0]
        for r in rows:
            a = az[r]; e = el[r]; s_ = sky[r]
            o = np.argsort(a); ao = a[o]
            d = sun - a
            sel = s_ & (e >= lo) & (e < hi) & (d >= 3) & (d <= 20) & above[r] & dmask[r]
            if not sel.any():
                continue
            am = sun + d[sel]
            j = np.clip(np.searchsorted(ao, am), 1, len(ao) - 1)
            jj = np.where(np.abs(ao[j - 1] - am) < np.abs(ao[j] - am), j - 1, j)
            cmx = o[jj]
            ok = (np.abs(a[cmx] - am) <= 0.2) & below[r][cmx] & s_[cmx] & cmask[r][cmx]
            src = np.where(sel)[0][ok]
            dk_px.append(I.lin[r, src]); cl_px.append(I.lin[r, cmx[ok]])
        if not dk_px or sum(len(x) for x in dk_px) < 30:
            out['D2'].append(None); continue
        dk = np.concatenate(dk_px); cl = np.concatenate(cl_px)
        pairs_all[0].append(dk); pairs_all[1].append(cl)
        out['D2'].append(float((dk[:, 0].mean() / dk[:, 2].mean()) / (cl[:, 0].mean() / cl[:, 2].mean())))
    out['D2_pooled_8_18'] = None; out['D2_pairs'] = 0
    if pairs_all[0]:
        dk = np.concatenate(pairs_all[0]); cl = np.concatenate(pairs_all[1])
        if len(dk) >= 100:
            out['D2_pooled_8_18'] = float((dk[:, 0].mean() / dk[:, 2].mean()) / (cl[:, 0].mean() / cl[:, 2].mean()))
        out['D2_pairs'] = int(len(dk))
    return out


def p1_d4(I):
    az, el, sky = I.az, I.el, I.sky
    band = sky & (el <= 4.0) & (az >= 255) & (az <= 308)
    glow = sky & (el >= 5.5) & (el <= 7.5) & (az >= 268) & (az <= 305)
    gm = I.lmed(glow)
    return (None if (gm is None or band.sum() < 30) else float(np.percentile(I.luma[band], 10) / max(gm, 0.5))), band


def p1_core(I):
    """D1m·D3m·D2·D4 만(가능성 점검용, metrics_P1 와 같은 정의)."""
    above, below, _, _ = p1_boxes(I)
    parts = p1_d1m(I)
    out = dict(D1m=[p['D1m'] for p in parts], D3m=[p['D3m'] for p in parts])
    out.update(p1_d2(I, above, below))
    out['D4'] = p1_d4(I)[0]
    return out


def metrics_P1(I):
    az, el, sky = I.az, I.el, I.sky
    above, below, deckbox, clearbox = p1_boxes(I)
    out = {'D1box': [], 'D3box': [], 'D1box_parts': []}
    for lo, hi in P1_BINS:   # 초안의 상자 정의(보고 — 렌더에선 틈·구름이 섞임, 통계 #4·타당성 M3)
        b = (el >= lo) & (el < hi)
        dk = deckbox & b; cl = clearbox & b
        rd, rc = I.RB(dk), I.RB(cl); yd, yc = I.Ym(dk), I.Ym(cl)
        out['D1box'].append(None if (rd is None or rc is None) else rd / rc)
        out['D3box'].append(None if (yd is None or yc is None) else yd / yc)
        out['D1box_parts'].append(dict(el=[lo, hi], n_deck=int(dk.sum()), n_clear=int(cl.sum()), RB_deck=rd, RB_clear=rc))
    # D1m·D3m(판정 정의): 알파로 거른 구름/하늘, 같은 고도 맞춤
    parts = p1_d1m(I)
    out['D1m'] = [p['D1m'] for p in parts]; out['D3m'] = [p['D3m'] for p in parts]; out['D1m_parts'] = parts
    if I.alpha is not None:
        out['D1m_a09'] = [p['D1m'] for p in p1_d1m(I, 0.9)]
        out['deckbox_cloud_frac'] = [float((I.alpha[deckbox & (el >= lo) & (el < hi)] >= 0.5).mean()) if (deckbox & (el >= lo) & (el < hi)).any() else None for lo, hi in P1_BINS]
        out['clearbox_cloud_frac'] = [float((I.alpha[clearbox & (el >= lo) & (el < hi)] >= 0.1).mean()) if (clearbox & (el >= lo) & (el < hi)).any() else None for lo, hi in P1_BINS]
        out['deck_toe_frac'] = [float((I.rgb8[deckbox & (el >= lo) & (el < hi) & (I.alpha >= A_DECK)].min(-1) < TOE_LO).mean())
                                if (deckbox & (el >= lo) & (el < hi) & (I.alpha >= A_DECK)).any() else None for lo, hi in P1_BINS]
    out.update(p1_d2(I, above, below))
    dmask, cmask = cloud_masks(I)
    sun = SUN['P1']['az']
    # D4 띠 p10 / 빛 중앙(표시 luma)
    out['D4'], band = p1_d4(I)
    # D5 띠 꼭대기(휘도 규칙)
    tops = []
    for a0 in np.arange(255.0, 308.0, 0.1):
        col = sky & I.sil_defined & (az >= a0) & (az < a0 + 0.1)
        ref = col & (el >= 6.5) & (el <= 8.5)
        if ref.sum() < 3:
            continue
        thr = 0.6 * np.median(I.luma[ref])
        cand = col & (el <= 7) & (I.luma < thr)
        tops.append(float(el[cand].max()) if cand.any() else float(el[col].min()))
    out['D5'] = float(np.median(tops)) if tops else None
    out['D5_ncols'] = len(tops)
    if I.alpha is not None:
        ta = []
        for a0 in np.arange(255.0, 308.0, 0.1):
            col = sky & I.sil_defined & (az >= a0) & (az < a0 + 0.1) & (el <= 9.0)
            if col.sum() < 3:
                continue
            c = col & (I.alpha >= 0.3)
            ta.append(float(el[c].max()) if c.any() else np.nan)
        ta = np.array(ta)
        out['D5a'] = float(np.nanmedian(ta)) if np.isfinite(ta).any() else None
        out['D5a_cols_with_cloud'] = float(np.isfinite(ta).mean()) if len(ta) else None
    # D6(보고, 타당성 M3 #3): 덮개 R/B 를 같은 그림의 해 쪽 맑은 하늘 R/B 고도 단면에 놓은 '색 등가 고도'
    prof_m = clearbox & cmask & (np.abs(daz(az, sun)) <= 15)
    prof = []
    for e0 in np.arange(0.5, 12.0, 0.5):
        m = prof_m & (el >= e0) & (el < e0 + 0.5)
        prof.append((e0 + 0.25, I.RB(m)))
    out['D6_profile'] = [[e, r] for e, r in prof]
    d6 = []
    pts = [(e, r) for e, r in prof if r is not None]
    for p in parts:
        rd = p['RB_deck']
        if rd is None or len(pts) < 2:
            d6.append(None); continue
        hit = None
        for (e0, r0), (e1, r1) in zip(pts[:-1], pts[1:]):
            if (r0 - rd) * (r1 - rd) <= 0 and r0 != r1:
                t = (math.log(rd) - math.log(r0)) / (math.log(r1) - math.log(r0)); hit = e0 + t * (e1 - e0); break
        d6.append(hit if hit is not None else ('above_profile' if rd > max(r for _, r in pts) else 'below_profile'))
    out['D6'] = d6
    dk_all = sky & above & (az >= 236) & (az <= 300) & (el >= 6) & (el < 30)
    out['hue_deck'] = hue_fracs(I.rgb8[dk_all]) if dk_all.sum() > 30 else None
    out['hue_sky'] = hue_fracs(I.rgb8[sky & (el < 30)])
    if I.alpha is not None:
        cm_ = band & (I.alpha >= 0.5); km = band & (I.alpha < 0.1)
        out['D4s_render_alpha'] = (I.lmed(cm_, 20) / max(I.lmed(km, 20), 0.5)) if (cm_.sum() >= 20 and km.sum() >= 20) else None
    out['n_valid_scene'] = getattr(I, 'n_valid', None)
    return out


def critic_mirror_P1(I):
    """비평 critic/mirror.py 그대로(질감 문턱 — 사진 전용, 재현 검사만)."""
    from scipy import ndimage as ndi
    sun = SUN['P1']['az']
    L = np.log(I.Y + 1e-4)
    tex = np.sqrt(np.maximum(ndi.uniform_filter(L ** 2, 7) - ndi.uniform_filter(L, 7) ** 2, 0))
    texs = ndi.uniform_filter(tex, 9)
    res = []
    for lo, hi in P1_MIRROR_BINS:
        dk_px, cl_px = [], []
        for r in np.where(((I.el >= lo) & (I.el < hi)).any(1))[0]:
            a = I.az[r]; e = I.el[r]
            d = sun - a
            sel = (e >= lo) & (e < hi) & (d >= 3) & (d <= 20) & (texs[r] >= 0.06)
            if not sel.any():
                continue
            am = sun + d[sel]
            o = np.argsort(a); ao = a[o]
            j = np.clip(np.searchsorted(ao, am), 1, len(ao) - 1)
            cm = o[np.where(np.abs(ao[j - 1] - am) < np.abs(ao[j] - am), j - 1, j)]
            ok = (np.abs(a[cm] - am) <= 0.2) & (texs[r][cm] <= 0.03)
            dk_px.append(I.lin[r, np.where(sel)[0][ok]]); cl_px.append(I.lin[r, cm[ok]])
        if not dk_px:
            res.append(None); continue
        dk = np.concatenate(dk_px); cl = np.concatenate(cl_px)
        res.append(float((dk[:, 0].mean() / dk[:, 2].mean()) / (cl[:, 0].mean() / cl[:, 2].mean())) if len(dk) else None)
    return res


def boot_D1m(I, block_deg=2.0, n=NBOOT, seed=SEED):
    """§3.3 사진 D1m 의 방위 블록 부트스트랩(2° 블록, 같은 블록을 덮개·맑음에 함께). 5·50·95 분위 + 1.3 아래 비율."""
    rng = np.random.default_rng(seed)
    above, below, deckbox, clearbox = p1_boxes(I)
    out = []
    for lo, hi in P1_BINS:
        nsub = int(round((hi - lo) / 0.25))
        dk = deckbox & (I.el >= lo) & (I.el < hi); cl = clearbox & (I.el >= lo) & (I.el < hi)
        allaz = np.concatenate([I.az[dk], I.az[cl]])
        b0 = np.floor(allaz.min() / block_deg)
        nb = int(np.floor(allaz.max() / block_deg) - b0) + 1
        def tab(m):
            bi = (np.floor(I.az[m] / block_deg) - b0).astype(int); si = np.clip(np.floor((I.el[m] - lo) / 0.25).astype(int), 0, nsub - 1)
            k = bi * nsub + si
            T = np.zeros((4, nb * nsub))
            for j, v in enumerate([I.lin[m][:, 0], I.lin[m][:, 2], I.Y[m], np.ones(m.sum())]):
                T[j] = np.bincount(k, v, minlength=nb * nsub)
            return T.reshape(4, nb, nsub)
        Td, Tc = tab(dk), tab(cl)
        present = np.where((Td[3].sum(1) + Tc[3].sum(1)) > 0)[0]
        cnt = np.zeros((n, nb))
        draws = rng.integers(0, len(present), size=(n, len(present)))
        for i in range(n):
            cnt[i] = np.bincount(present[draws[i]], minlength=nb)
        Sd = np.einsum('nb,jbs->njs', cnt, Td); Sc = np.einsum('nb,jbs->njs', cnt, Tc)
        keep = (Sd[:, 3] >= 3) & (Sc[:, 3] >= 3)
        Rd = (Sd[:, 0] * keep).sum(1); Bd = (Sd[:, 1] * keep).sum(1)
        w = Sd[:, 3] * keep
        mR = Sc[:, 0] / np.maximum(Sc[:, 3], 1); mB = Sc[:, 1] / np.maximum(Sc[:, 3], 1)
        with np.errstate(invalid='ignore', divide='ignore'):
            v = (Rd / Bd) / ((w * mR).sum(1) / (w * mB).sum(1))
        v = np.where(np.isfinite(v) & (Bd > 0), v, np.nan)
        out.append(dict(el=[lo, hi], p5=float(np.nanpercentile(v, 5)), p50=float(np.nanpercentile(v, 50)), p95=float(np.nanpercentile(v, 95)),
                        frac_below_1_3=float(np.nanmean(v < 1.3)), frac_undefined=float(np.isnan(v).mean()), n_blocks=int(len(present))))
    return out


# ---------------------------------------------------------------- P2 (R-B-deep E1~E8)
def grouped_median(vals, idx, n):
    o = np.argsort(idx, kind='stable'); iv = idx[o]; vv = vals[o]
    bounds = np.searchsorted(iv, np.arange(n + 1))
    med = np.full(n, np.nan); cnt = np.diff(bounds)
    for k in np.where(cnt > 3)[0]:
        med[k] = np.median(vv[bounds[k]:bounds[k + 1]])
    return med


def e5_split(I, b, bright=15, dark=50):
    if b.sum() < 60:
        return None
    q_hi, q_lo = np.percentile(I.luma[b], 100 - bright), np.percentile(I.luma[b], dark)
    rbb, rbd = I.RB(b & (I.luma >= q_hi)), I.RB(b & (I.luma <= q_lo))
    return rbd / rbb if (rbb and rbd) else None


def otsu(x, nb=256):
    h, e = np.histogram(x, nb); c = (e[:-1] + e[1:]) / 2
    w0 = np.cumsum(h); w1 = w0[-1] - w0; m = np.cumsum(h * c)
    mu0 = m / np.maximum(w0, 1); mu1 = (m[-1] - m) / np.maximum(w1, 1)
    return float(c[int(np.argmax(w0 * w1 * (mu0 - mu1) ** 2))])


def metrics_P2(I):
    az, el, sky = I.az, I.el, I.sky
    out = {}
    a0s = np.arange(262.0, 276.0, 0.5); ce = np.arange(0.9, 6.0, 0.05)
    m = sky & (az >= 262.0) & (az < 276.0) & (el >= 0.9) & (el < 6.0 + 0.05)
    ia = np.floor((az[m] - 262.0) / 0.5).astype(int); ie = np.floor((el[m] - 0.9) / 0.05 + 1e-9).astype(int)
    ok = (ia >= 0) & (ia < len(a0s)) & (ie >= 0) & (ie < len(ce))
    med = grouped_median(I.luma[m][ok], ia[ok] * len(ce) + ie[ok], len(a0s) * len(ce)).reshape(len(a0s), len(ce))
    tops, edges = [], []
    for cp in med:
        if np.all(np.isnan(cp)):
            continue
        k = int(np.nanargmax(cp)); thr = 0.5 * cp[k]
        t = next((ce[j] for j in range(k, -1, -1) if cp[j] < thr), None)
        d = next((ce[j] for j in range(k, len(ce)) if cp[j] < thr), None)
        if t is not None: tops.append(round(float(t), 4))   # 0.05° 격자로 반올림(절차 #9: 부동소수 경계)
        if d is not None: edges.append(round(float(d), 4))
    out['E1'] = float(np.median(tops)) if tops else None
    out['E2'] = float(np.median(edges)) if edges else None
    out['E1E2_n'] = [len(tops), len(edges)]
    out['E1_p10_p90'] = [float(np.percentile(tops, 10)), float(np.percentile(tops, 90))] if tops else None
    out['E2_p10_p90'] = [float(np.percentile(edges, 10)), float(np.percentile(edges, 90))] if edges else None
    R = {k: sky & (el >= lo) & (el <= hi) for k, (lo, hi) in P2_REG.items()}
    lm = {k: I.lmed(v) for k, v in R.items()}
    out['luma_med'] = lm
    out['E3'] = lm['band'] / lm['strip'] if (lm['band'] and lm['strip']) else None
    out['E4'] = lm['band'] / lm['deck'] if (lm['band'] and lm['deck']) else None
    rb = {k: I.RB(v) for k, v in R.items()}
    out['RB'] = rb
    out['E8'] = rb['strip'] / rb['band'] if (rb['strip'] and rb['band']) else None
    out['E5q'], out['E6q'], out['E5a'], out['E6a'], out['E5_parts'] = [], [], [], [], []
    for lo, hi in P2_GAP_BINS:
        b = sky & (el >= lo) & (el < hi)
        q85, q50 = np.percentile(I.luma[b], 85), np.percentile(I.luma[b], 50)
        br = b & (I.luma >= q85); dk = b & (I.luma <= q50)
        rbb, rbd = I.RB(br), I.RB(dk)
        out['E5q'].append(rbd / rbb if (rbb and rbd) else None)
        out['E6q'].append(I.Ym(dk) / I.Ym(br) if (I.Ym(br) and I.Ym(dk)) else None)
        part = dict(el=[lo, hi], n=int(b.sum()), RB_bright=rbb, RB_dark=rbd)
        if I.alpha is not None:
            c = b & (I.alpha > 0.7); s = b & (I.alpha < 0.2)
            rc, rs = I.RB(c, 10), I.RB(s, 10)
            out['E5a'].append(rc / rs if (rc and rs) else None)
            out['E6a'].append(I.Ym(c, 10) / I.Ym(s, 10) if (rc and rs) else None)
            part.update(n_cloud=int(c.sum()), n_sky=int(s.sum()))
        out['E5_parts'].append(part)
    if I.alpha is not None:
        b = sky & (el >= 7.5) & (el < 9.0)
        c = b & (I.alpha > 0.7); s = b & (I.alpha < 0.2)
        rc, rs = I.RB(c, 200), I.RB(s, 200)
        out['E5a_merged'] = rc / rs if (rc and rs) else None   # 7.5~9.0 합침, 하늘 ≥ 200 화소(통계 #4)
        out['E5a_merged_n'] = [int(c.sum()), int(s.sum())]
        e7 = {}
        for lo, hi in P2_E7_BINS:
            b = sky & (el >= lo) & (el < hi)
            c = b & (I.alpha >= 0.5); s = b & (I.alpha < 0.1)
            if c.sum() >= 20 and s.sum() >= 20:
                e7[f'{lo}-{hi}'] = I.lmed(c, 20) / max(I.lmed(s, 20), 0.5)
        out['E7'] = e7
    # 보고: 6~12° 0.5° 칸 분위 E5(창 고르기 점검, 통계 #1)
    out['E5q_scan'] = [[lo, hi, e5_split(I, sky & (el >= lo) & (el < hi))] for lo, hi in P2_E5_SCAN]
    out['hue_sky'] = hue_fracs(I.rgb8[sky])
    out['n_valid_scene'] = getattr(I, 'n_valid', None)
    return out


def robust_E5(I, n=NBOOT, seed=SEED):
    """사진 E5 정의 묶음(통계 검토 #1): 밝은 5/10/15/20/30 % × 어두운 30/50/70 % + Otsu(log luma), 두 칸 모두 ≥ 1 인 비율; 1° 방위 블록 부트스트랩(15/50)."""
    defs = []
    for br in [5, 10, 15, 20, 30]:
        for dk in [30, 50, 70]:
            defs.append(dict(split=f'q{br}/{dk}', v=[e5_split(I, I.sky & (I.el >= lo) & (I.el < hi), br, dk) for lo, hi in P2_GAP_BINS]))
    ov = []
    for lo, hi in P2_GAP_BINS:
        b = I.sky & (I.el >= lo) & (I.el < hi)
        t = otsu(np.log(I.luma[b] + 1.0))
        g = b & (np.log(I.luma + 1.0) > t); d = b & (np.log(I.luma + 1.0) <= t)
        rg, rd = I.RB(g), I.RB(d)
        ov.append(rd / rg if (rg and rd) else None)
    defs.append(dict(split='otsu', v=ov))
    both = [all(x is not None and x >= 1.0 for x in d['v']) for d in defs]
    rng = np.random.default_rng(seed)
    boot = []
    for lo, hi in P2_GAP_BINS:
        b = I.sky & (I.el >= lo) & (I.el < hi)
        blk = np.floor(I.az[b]).astype(int); ub = np.unique(blk)
        L = I.lin[b]; lu = I.luma[b]
        idx = [np.where(blk == u)[0] for u in ub]
        vals = []
        for _ in range(n):
            pick = rng.integers(0, len(ub), len(ub))
            ii = np.concatenate([idx[p] for p in pick])
            l = lu[ii]; q_hi, q_lo = np.percentile(l, 85), np.percentile(l, 50)
            Lb, Ld = L[ii][l >= q_hi], L[ii][l <= q_lo]
            vals.append((Ld[:, 0].mean() / Ld[:, 2].mean()) / (Lb[:, 0].mean() / Lb[:, 2].mean()))
        v = np.array(vals)
        boot.append(dict(el=[lo, hi], p5=float(np.percentile(v, 5)), p50=float(np.percentile(v, 50)), p95=float(np.percentile(v, 95)),
                         p_below_1=float((v < 1).mean()), n_blocks=int(len(ub))))
    return dict(definitions=defs, frac_both_ge1=float(np.mean(both)), n_definitions=len(defs), boot_q15_50=boot,
                rule='E5 를 관문으로 쓰려면 정의 묶음의 ≥ 80 % 에서 두 칸 모두 ≥ 1 이어야 함(통계 #1) — 못 미치면 보고만')


# ---------------------------------------------------------------- P3 (R-C C1~C6)
def p3_mask(I, d):
    m = I.sky & (I.el >= d['el'][0]) & (I.el <= d['el'][1])
    dz = np.abs(daz(I.az, SUN['P3']['az']))
    if 'daz_max' in d: m &= dz <= d['daz_max']
    if 'daz_min' in d: m &= dz >= d['daz_min']
    return m


def metrics_P3(I):
    R = {k: p3_mask(I, d) for k, d in P3_REG.items()}
    rb = {k: I.RB(v) for k, v in R.items()}
    lm = {k: I.lmed(v) for k, v in R.items()}
    out = {'RB': rb, 'luma_med': lm}
    out['C1'] = rb['glow'] / rb['upper'] if (rb['glow'] and rb['upper']) else None
    out['C1_glow_s'] = rb['glow_s'] / rb['upper'] if (rb['glow_s'] and rb['upper']) else None
    rbpx = I.lin[..., 0] / np.maximum(I.lin[..., 2], 1e-4)
    thr = 2.0 * float(np.median(rbpx[R['upper']])) if R['upper'].sum() >= 30 else None
    out['C2'] = float((rbpx[R['mid']] > thr).mean()) if (thr and R['mid'].sum() >= 30) else None
    out['C3r'] = rb['sheet'] / rb['ref'] if (rb['sheet'] and rb['ref']) else None
    ref = float(np.median(rbpx[R['ref']])) if R['ref'].sum() >= 30 else None
    if ref:
        w = R['far'] & (rbpx >= 1.78 * ref)
        out['C4'] = (I.RB(w) / ref) if w.sum() >= 30 else 0.0
        out['C4_warm_frac'] = float(w.sum() / max(R['far'].sum(), 1))
        out['C4_ref_RBpx_median'] = ref
    else:
        out['C4'] = None; out['C4_warm_frac'] = None
    near = I.sky & (np.abs(daz(I.az, SUN['P3']['az'])) <= 3)
    cen = np.arange(0.95, 8.0, 0.1); prof = []
    for c in cen:
        mm = near & (I.el >= c - 0.05) & (I.el < c + 0.05)
        prof.append(float(np.median(I.luma[mm])) if mm.sum() > 10 else np.nan)
    prof = np.array(prof)
    out['C5'] = float(cen[int(np.nanargmax(prof))]) if np.isfinite(prof).any() else None
    out['C6'] = lm['glow'] / lm['upper'] if (lm['glow'] and lm['upper']) else None
    out['hue_sky'] = hue_fracs(I.rgb8[I.sky])
    out['n_valid_scene'] = getattr(I, 'n_valid', None)
    return out


METRICS = {'P1': metrics_P1, 'P2': metrics_P2, 'P3': metrics_P3}


def compare(pid, got):
    rows = []
    for k, (want, mode, tol, src) in CRITIC[pid].items():
        g = got.get(k)
        ws = want if isinstance(want, list) else [want]
        gs = g if isinstance(g, list) else [g]
        for i, (w, x) in enumerate(zip(ws, gs)):
            if x is None:
                rows.append(dict(metric=k, i=i, critic=w, tool=None, ok=False, src=src)); continue
            dev = (x / w - 1) if mode == 'rel' else (x - w)
            rows.append(dict(metric=k, i=i, critic=w, tool=round(x, 3), dev=round(dev, 3), tol=tol, mode=mode, ok=abs(dev) <= tol + 1e-9, src=src))
    return rows


PHOTO_PRINT = {'P1': ['D1m', 'D3m', 'D1box', 'D3box', 'D2_pooled_8_18', 'D2', 'D2t', 'D4', 'D5', 'D6', 'hue_deck', 'hue_sky'],
               'P2': ['E1', 'E2', 'E3', 'E4', 'E5q', 'E6q', 'E8', 'E5q_scan', 'RB', 'hue_sky'],
               'P3': ['C1', 'C1_glow_s', 'C2', 'C3r', 'C4', 'C4_warm_frac', 'C5', 'C6', 'RB', 'hue_sky']}


def cmd_photo(a):
    res = {'tool': 'tools/genus-ruler/tsun/tsun_photo.py', 'ruler': 'RULER-tsun.md (동결 후보)',
           'color': {'primary': 'Display-P3 → 선형 sRGB 행렬(파일 ICC), 음수 0', 'alt': 'ICC 무시(sRGB EOTF 만 — 비평과 같은 길, 재현 검사는 이 길)',
                     'luma': '표시 luma 는 두 길 같음(8 비트 값)'},
           'geo': dict(file='tsun-geo.json', sha256=sha256(GEO_FILE)), 'sun_engine': SUN, 'boot': dict(seed=SEED, n=NBOOT), 'photos': {}}
    for pid in ['P1', 'P2', 'P3']:
        I0, path = load_photo(pid)
        h = sha256(path)
        I = photo_p3(I0)
        got = METRICS[pid](I); alt = METRICS[pid](I0)
        if pid == 'P1':
            alt['D2t'] = critic_mirror_P1(I0)
        cmp_ = compare(pid, alt)
        rob = {}
        if pid == 'P1':
            rob['D1m_boot'] = boot_D1m(I); rob['D1m_boot_alt'] = boot_D1m(I0)
        if pid == 'P2':
            rob['E5'] = robust_E5(I); rob['E5_alt'] = robust_E5(I0)
        src = GEO_SRC[pid]
        res['photos'][pid] = dict(image=path, image_sha256=h, sha_ok=(h == PHOTOS[pid]['sha256']), downsample=PHOTOS[pid]['ds'], n_sky=int(I.sky.sum()),
                                  geo_source=dict(path=src, sha256=geo(pid)['source']['sha256'],
                                                  scratch_present=os.path.exists(src), scratch_sha_ok=(sha256(src) == geo(pid)['source']['sha256']) if os.path.exists(src) else None),
                                  metrics=r3(got), metrics_icc_ignored=r3(alt), robustness=r3(rob), cited=CITED[pid],
                                  repro=cmp_, repro_all_ok=all(r['ok'] for r in cmp_))
        print(f'== {pid} sha {"OK" if h == PHOTOS[pid]["sha256"] else "MISMATCH"}  sky px {int(I.sky.sum())}')
        for k in PHOTO_PRINT[pid]:
            print(f'   {k:16s} p3 {json.dumps(r3(got.get(k)))}   icc-ignored {json.dumps(r3(alt.get(k)))}')
        print('   robustness', json.dumps(r3(rob))[:1500])
        for r in cmp_:
            print(f"   repro {r['metric']}[{r['i']}] critic {r['critic']} tool {r['tool']} dev {r.get('dev')} tol {r.get('tol')} {'ok' if r['ok'] else 'MISMATCH'}")
    out = a.out or os.path.join(HERE, 'tsun-photo.json')
    json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
    print('wrote', out)


def render_record(pid, png, hi=None, meta=None, cam=None, check=True):
    I = load_render(pid, png, None, cam, hi, meta, check)
    disp = METRICS[pid](I)
    sc = METRICS[pid](I.scene)
    return dict(pid=pid, png=png, png_sha256=sha256(png), hi=hi, hi_sha256=sha256(hi) if hi else None,
                alpha=(png[:-4] + '.alpha.png') if os.path.exists(png[:-4] + '.alpha.png') else None,
                cam=dict(RENDER_CAM[pid], **(cam or {})), merge=r3(I.merge, 4), metrics=r3(disp), metrics_scene=r3({k: sc.get(k) for k in SCENE_KEYS[pid]}))


def cmd_render(a):
    cam = None
    if a.cam:
        v = [float(x) for x in a.cam.split(',')]
        cam = dict(az=v[0], el=v[1], vfov=v[2], roll=v[3] if len(v) > 3 else 0.0)
    meta = json.load(open(a.meta)) if a.meta else None
    rec = render_record(a.pid, a.png, a.hi, meta, cam)
    if a.out:
        json.dump(rec, open(a.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(rec, ensure_ascii=False)[:4000])
    return rec


# ---------------------------------------------------------------- 판정(§4) — 관문(두 공간), 가드(C0ps 기준, 양측 띠), 보고
MARGIN0 = {'D3': 0.05, 'D4': 0.03, 'E3': 0.05, 'E4': 0.05, 'E8': 0.05, 'C5': 0.10, 'DT': 0.05}   # 적은 값; 실제 = max(적은 값, margins.json)


def _num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _lst(x, n):
    return x if (isinstance(x, list) and len(x) == n and all(_num(v) is not None for v in x)) else None


def lndist(x, lo, hi):
    """ln 거리: [lo, hi] 안이면 0, 밖이면 가까운 끝까지 |ln|."""
    return 0.0 if lo <= x <= hi else min(abs(math.log(x / lo)), abs(math.log(x / hi)))


def absdist(x, lo, hi):
    return 0.0 if lo <= x <= hi else min(abs(x - lo), abs(x - hi))


def photo_range(photo, pid, key):
    """사진 값의 두 색 길(주·보조) 범위 — 띠 가드는 이 범위를 사진 값으로 씀(통계 #9)."""
    P = photo['photos'][pid]
    a, b = P['metrics'].get(key), P['metrics_icc_ignored'].get(key)
    if isinstance(a, list):
        return [(min(x, y), max(x, y)) for x, y in zip(a, b)]
    return (min(a, b), max(a, b))


def judge_one(pid, photo, cand, base, c0=None, arm_kind='T', margins=None):
    """RULER-tsun §4.2 — 반환 {이름: {verdict, role, …}}. verdict ∈ pass / fail / na. base = 같은 번들의 C0ps(가드 기준), c0 = C0(보고·H2)."""
    M = dict(MARGIN0)
    for k, v in (margins or {}).items():
        if k in M and v is not None:
            M[k] = max(M[k], float(v))
    C, S = cand['metrics'], cand.get('metrics_scene') or {}
    B = base['metrics'] if base else None
    V = {}

    def put(k, ok, **kw):
        V[k] = dict(verdict='na' if ok is None else ('pass' if ok else 'fail'), **kw)
    if pid == 'P1':
        for key, thr in [('D1m', 1.3)]:
            d, s = _lst(C.get(key), 4), _lst(S.get(key), 4)
            okd = None if d is None else all(v >= thr for v in d)
            oks = None if s is None else all(v >= thr for v in s)
            put(key, None if (okd is None or oks is None) else (okd and oks), display=d, scene=s, rule=f'모든 칸 ≥ {thr} (표시·장면 둘 다)', role='관문(아치)')
        d2, s2 = _num(C.get('D2_pooled_8_18')), _num(S.get('D2_pooled_8_18'))
        put('D2', None if (d2 is None or s2 is None) else (d2 >= 1.3 and s2 >= 1.3), display=d2, scene=s2, rule='합침 ≥ 1.3 (표시·장면 둘 다)', role='관문(아치)')
        d3 = _lst(C.get('D3m'), 4); pr = photo_range(photo, 'P1', 'D3m')
        if d3 and B and _lst(B.get('D3m'), 4):
            ok = all(lndist(c, *p) <= max(lndist(b, *p), math.log(1.5)) + M['D3'] for c, b, p in zip(d3, B['D3m'], pr))
            put('D3_band', ok, cand=d3, base=B['D3m'], photo=pr, margin=M['D3'], rule='칸마다 d(E) ≤ max(d(B), ln 1.5) + m, d = 사진 범위까지 ln 거리', role='가드')
        else:
            put('D3_band', None, role='가드')
        d4 = _num(C.get('D4')); p4 = photo_range(photo, 'P1', 'D4')
        if d4 is not None and B and _num(B.get('D4')) is not None:
            put('D4_band', absdist(d4, *p4) <= max(absdist(B['D4'], *p4) + M['D4'], 0.10), cand=d4, base=B['D4'], photo=p4, margin=M['D4'],
                rule='d(E) ≤ max(d(B) + m, 0.10)', role='가드')
        else:
            put('D4_band', None, role='가드')
        d5 = _num(C.get('D5a')) if C.get('D5a') is not None else _num(C.get('D5'))
        put('D5', None if d5 is None else abs(d5 - photo['photos']['P1']['metrics']['D5']) <= 0.5, cand=d5, rule='사진(휘도 규칙) ± 0.5°, 렌더는 알파 규칙', role='장면 점검')
        put('D1box', None, cand=C.get('D1box'), scene=S.get('D1box'), role='보고')
        put('D6', None, cand=C.get('D6'), role='보고')
    if pid == 'P2':
        put('E5', None, alpha=C.get('E5a'), alpha_scene=S.get('E5a'), merged=C.get('E5a_merged'), quantile=C.get('E5q'), parts=C.get('E5_parts'), role='보고(관문 아님 — 통계 #1·타당성 M6)')
        put('E6', None, cand=C.get('E6a'), role='보고')
        e7 = C.get('E7') or {}
        put('E7', None if not e7 else all(x < 1.0 for x in e7.values()), cand=e7, rule='모든 칸 구름/하늘 < 1', role='가드')
        e8 = _num(C.get('E8'))
        if e8 is not None and B and _num(B.get('E8')) is not None:
            put('E8_nr', e8 <= B['E8'] + M['E8'], cand=e8, base=B['E8'], margin=M['E8'], rule='E ≤ B + m (표시)', role='가드')
        else:
            put('E8_nr', None, role='가드')
        put('E8_abs', None, display=e8, scene=S.get('E8'), rule='< 1 (보고)', role='보고')
        for k in ['E3', 'E4']:
            x = _num(C.get(k)); p = photo['photos']['P2']['metrics'][k]
            if x is not None and B and _num(B.get(k)) is not None:
                put(k + '_band', abs(math.log(x / p)) <= max(abs(math.log(B[k] / p)) + M[k], math.log(1.3)), cand=x, base=B[k], photo=p, margin=M[k],
                    rule='|ln(E/사진)| ≤ max(|ln(B/사진)| + m, ln 1.3)', role='가드')
            else:
                put(k + '_band', None, role='가드')
        if arm_kind == 'A':
            hc = (C.get('hue_sky') or {}).get('magenta'); h0 = ((c0 or {}).get('metrics', {}).get('hue_sky') or {}).get('magenta')
            put('H2', None if (hc is None or h0 is None) else hc <= h0 + 0.05, cand=hc, c0=h0, photo=photo['photos']['P2']['metrics']['hue_sky']['magenta'],
                rule='P2B 하늘 자주 E ≤ C0 + 0.05 (사진 0.000)', role='가드(아치)')
        for k, c_ in [('E1', 2.3), ('E2', 3.8)]:
            x = _num(C.get(k))
            put(k, None if x is None else abs(x - c_) <= 0.35 + 1e-9, cand=x, rule=f'{c_} ± 0.35°', role='장면 점검')
    if pid == 'P3':
        c1, s1 = _num(C.get('C1')), _num(S.get('C1'))
        put('C1', None if (c1 is None or s1 is None) else (c1 >= 2.5 and s1 >= 2.5), display=c1, scene=s1, rule='≥ 2.5 (표시·장면 둘 다)', role='관문(T)')
        put('C2', None, cand=C.get('C2'), role='보고(C1 과 짝 — 통계 #6)')
        put('C4', None, cand=C.get('C4'), role='보고')
        put('C1_glow_s', None, display=C.get('C1_glow_s'), scene=S.get('C1_glow_s'), role='보고(굴절 +0.35°)')
        c5 = _num(C.get('C5')); p5 = photo['photos']['P3']['metrics']['C5']
        if c5 is not None and B and _num(B.get('C5')) is not None:
            put('C5_band', abs(c5 - p5) <= max(abs(B['C5'] - p5) + M['C5'], 0.3), cand=c5, base=B['C5'], photo=p5, margin=M['C5'],
                rule='|E − 사진| ≤ max(|B − 사진| + m, 0.3°)', role='가드')
        else:
            put('C5_band', None, role='가드')
        wf, lf = _num(C.get('C4_warm_frac')), _num((C.get('luma_med') or {}).get('far'))
        if B and wf is not None and lf is not None and _num(B.get('C4_warm_frac')) and _num((B.get('luma_med') or {}).get('far')):
            put('FL', wf >= 0.5 * B['C4_warm_frac'] and lf >= 0.5 * B['luma_med']['far'], warm=wf, warm_base=B['C4_warm_frac'], luma=lf, luma_base=B['luma_med']['far'],
                rule='먼 밭 따뜻한 비율 ≥ 0.5 × B 그리고 먼 밭 luma 중앙 ≥ 0.5 × B', role='가드(먼 곳은 빛 받음, 타당성 M8)')
        else:
            put('FL', None, role='가드')
    return V


def deep_twilight(pid, cand, base, margins=None):
    """§4.8(T 팔): P1B·P2B 에서 C0ps 대비 칸마다 |Δln| ≤ m_DT (장면 선형 D1m·D3m·E5a·E6a, 없으면 표시)."""
    m = max(MARGIN0['DT'], float((margins or {}).get('DT') or 0))
    keys = {'P1': ['D1m', 'D3m'], 'P2': ['E5a', 'E6a']}[pid]
    worst, ok = 0.0, True
    for k in keys:
        for sp in ['metrics_scene', 'metrics']:
            c, b = (cand.get(sp) or {}).get(k), (base.get(sp) or {}).get(k)
            if not (isinstance(c, list) and isinstance(b, list)):
                continue
            for x, y in zip(c, b):
                if _num(x) is None or _num(y) is None or x <= 0 or y <= 0:
                    return dict(verdict='na', why=f'{k} 값 없음')
                d = abs(math.log(x / y)); worst = max(worst, d); ok &= d <= m
            break
    return dict(verdict='pass' if ok else 'fail', worst=round(worst, 4), margin=m, role='가드(T 팔)')


def cmd_judge(a):
    photo = json.load(open(a.photo))
    cand = json.load(open(a.cand)); base = json.load(open(a.base)) if a.base else None
    c0 = json.load(open(a.c0)) if a.c0 else None
    margins = json.load(open(a.margins)) if a.margins else None
    V = judge_one(cand['pid'], photo, cand, base, c0, a.arm_kind, margins)
    for k, v in V.items():
        print(f"   {k:10s} {v['verdict']:4s} {v.get('role', '')}  {json.dumps({kk: vv for kk, vv in v.items() if kk not in ('verdict', 'role')}, ensure_ascii=False)[:300]}")
    if a.out:
        json.dump(V, open(a.out, 'w'), indent=1, ensure_ascii=False)
    return V


BASELINE = {   # 비평 렌더(scratchpad) — '오늘 기준'(판정 아님). P1 은 §173 고침 전 번들(5ced8b1) + 미리 민 고리. 'ps' = accurateSunBelowDeg 90(= ps90, 절차 #14).
    'P1': [SCR + '/rend/out/R1/P1_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'B_s25_ps_r100', 'B_s4_ps_r100']],
    'P2': [SCR + '/heda/rend2/out/P2/P2_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'A_t0x_ps_r400', 'A_t0_obs_r100']],
    'P3': [SCR + '/heda/rend2/out/P3/P3_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'A_t0x_ps_r100', 'A_t0_obs_r100']],
}
BASE_PRINT = ('D1m', 'D3m', 'D1box', 'D3box', 'D1m_a09', 'D2_pooled_8_18', 'D4', 'D5a', 'deckbox_cloud_frac', 'clearbox_cloud_frac', 'deck_toe_frac',
              'E3', 'E4', 'E5a', 'E5a_merged', 'E5q', 'E6a', 'E7', 'E8', 'C1', 'C1_glow_s', 'C2', 'C4', 'C4_warm_frac', 'C5', 'C6')


def baseline_records():
    res = {}
    for pid, lst in BASELINE.items():
        for png in lst:
            k = os.path.basename(png)[:-4]
            if not os.path.exists(png):
                res[k] = 'missing'; continue
            res[k] = render_record(pid, png, check=False)
    return res


def cmd_baseline(a):
    res = baseline_records()
    for k, v in res.items():
        if isinstance(v, dict):
            print(k, json.dumps({kk: vv for kk, vv in v['metrics'].items() if kk in BASE_PRINT}), '| scene', json.dumps(v['metrics_scene'])[:600])
    out = a.out or os.path.join(HERE, 'tsun-baseline.json')
    json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
    print('wrote', out)


def cmd_selftest(a):
    """절차 #1: 고정한 비평 렌더를 다시 재서 tsun-baseline.json 과 지표가 같은지(도구 회귀 점검)."""
    want = json.load(open(os.path.join(HERE, 'tsun-baseline.json')))
    got = json.loads(json.dumps(baseline_records(), ensure_ascii=False))
    bad = [k for k in want if want[k] != 'missing' and (not isinstance(got.get(k), dict) or got[k]['metrics'] != want[k]['metrics'] or got[k]['metrics_scene'] != want[k]['metrics_scene'])]
    print(json.dumps(dict(n=len(want), mismatches=bad, ok=not bad), ensure_ascii=False))
    sys.exit(0 if not bad else 1)


# ---------------------------------------------------------------- R-A(§4.3)
def _rgb_alpha(png):
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.float64)
    ap_ = png[:-4] + '.alpha.png'
    al = np.asarray(Image.open(ap_).convert('L')).astype(np.float64) / 255.0 if os.path.exists(ap_) else None
    return a, al


def ra_unit(cand_png, ref_png, down=1):
    """§4.3 R-A 단위 지표(장면 선형, ACES 역변환): 구름 = 두 팔 α ≥ 0.5 이고 두 팔 모두 유효(채널 ∈ [4, 249]).
       d = ln((Yc+ε)/(Yr+ε)), ε = 기준 구름 Y 중앙의 1 %. e = 중앙 |d|, b = 중앙 d, p75 = 75 분위 |d|, f03 = |d| > 0.3 비율,
       c = ln(R/B 후보 ÷ R/B 기준)(영역 평균 비). clip_asym = α ≥ 0.5 화소 중 한 팔만 잘림(≥ 250)인 비율. down = 장면 선형 상자 평균 배율(REF 대체 경로)."""
    c, ac = _rgb_alpha(cand_png); r, ar = _rgb_alpha(ref_png)
    if ac is None or ar is None:
        return dict(valid=False, why='alpha 없음')
    if down > 1:
        def dn(x):
            H, W = x.shape[:2]; x = x[:H // down * down, :W // down * down]
            return x.reshape(H // down, down, W // down, down, *x.shape[2:]).mean((1, 3))
        Sc, okc = scene_from_rgb8(c); Sc = dn(Sc); okc = dn(okc.astype(float)) == 1; c = dn(c); ac = dn(ac)
    else:
        Sc, okc = scene_from_rgb8(c)
    if c.shape != r.shape:
        return dict(valid=False, why=f'크기 다름 {c.shape} vs {r.shape}')
    Sr, okr = scene_from_rgb8(r)
    cl = (ac >= 0.5) & (ar >= 0.5)
    clip_c, clip_r = c.max(-1) >= 250, r.max(-1) >= 250
    asym = float(((clip_c ^ clip_r) & cl).sum() / max(cl.sum(), 1))
    m = cl & okc & okr
    if m.sum() < 400:
        return dict(valid=False, why=f'구름 화소 {int(m.sum())} < 400', n=int(m.sum()), clip_asym=round(asym, 4))
    Yc, Yr = Sc[m] @ LUM, Sr[m] @ LUM
    eps = 0.01 * float(np.median(Yr))
    d = np.log((Yc + eps) / (Yr + eps))
    rb = math.log((Sc[m][:, 0].mean() / max(Sc[m][:, 2].mean(), 1e-12)) / (Sr[m][:, 0].mean() / max(Sr[m][:, 2].mean(), 1e-12)))
    ad = np.abs(d)
    # 보고: 표시 선형 같은 값
    lc, lr = srgb_eotf(c[m]), srgb_eotf(r[m])
    dd = np.log((lc @ LUM + 0.01 * np.median(lr @ LUM)) / (lr @ LUM + 0.01 * np.median(lr @ LUM)))
    return dict(valid=True, n=int(m.sum()), e=round(float(np.median(ad)), 4), b=round(float(np.median(d)), 4), c=round(rb, 4),
                p75=round(float(np.percentile(ad, 75)), 4), f03=round(float((ad > 0.3).mean()), 4), clip_asym=round(asym, 4),
                display=dict(e=round(float(np.median(np.abs(dd))), 4), b=round(float(np.median(dd)), 4)))


RA_TOL0 = dict(e=0.15, b=0.10, c=0.10, p75=0.25)


def ra_tol(floors):
    """허용폭 = max(적은 값, 3 × 바닥)(통계 #7). 바닥 = REF A/A 와 REF 200 m 대 100 m 의 단위 지표 최댓값."""
    f = floors or {}
    return {k: max(v, 3 * float(f.get(k) or 0)) for k, v in RA_TOL0.items()}


def ra_unit_pass(u, tol):
    if not u.get('valid'):
        return None
    return bool(u['e'] <= tol['e'] and abs(u['b']) <= tol['b'] and abs(u['c']) <= tol['c'] and u['p75'] <= tol['p75']
                and u['f03'] <= 0.15 + 1e-9 and u['clip_asym'] <= 0.05 + 1e-9)


def ra_arm(units, cand, c0ps, floors=None):
    """§4.3 팔 규칙. units = scenes-tsun.json RA 단위(geo 분류 포함), cand·c0ps = {단위 이름: ra_unit 결과(대 REF)}."""
    tol = ra_tol(floors)
    fe = float((floors or {}).get('e') or 0)
    rows = []
    for u in units:
        n = u['name']; g = u.get('geo') or {}
        a, b = cand.get(n) or {}, c0ps.get(n) or {}
        pa, pb = ra_unit_pass(a, tol), ra_unit_pass(b, tol)
        informative = bool(b.get('valid') and b['e'] > max(0.05, 2 * fe))
        rows.append(dict(name=n, family=g.get('family'), disc=bool(g.get('disc')), informative=informative, pass_cand=pa, pass_c0ps=pb,
                         e_cand=a.get('e'), e_c0ps=b.get('e'), b_cand=a.get('b'), valid=bool(a.get('valid') and b.get('valid'))))
    valid = [r for r in rows if r['valid']]
    out = dict(tol=tol, n_units=len(rows), n_valid=len(valid), rows=rows)
    if len(valid) < 0.9 * len(rows):
        out.update(verdict='na', why=f'유효 단위 {len(valid)} < 90 % of {len(rows)}'); return out
    disc = [r for r in valid if r['disc']]
    c0_fail_disc = [r for r in disc if r['pass_c0ps'] is False]
    out['c0ps_fail_disc'] = [len(c0_fail_disc), len(disc)]
    if not disc or len(c0_fail_disc) < (2 / 3) * len(disc):
        out.update(verdict='na', why='변별 없음: C0ps 가 변별 단위의 2/3 미만에서 실패 — 멈추고 사용자에게'); return out
    rest = [r for r in valid if (not r['disc']) and r['informative']]
    checks = {}
    checks['disc_pass_80'] = sum(r['pass_cand'] for r in disc) >= 0.8 * len(disc)
    checks['rest_pass_90'] = (not rest) or sum(r['pass_cand'] for r in rest) >= 0.9 * len(rest)
    fam = {}
    for f in ['in', 'far', 'es']:
        rs = [r for r in valid if r['family'] == f and (r['informative'] or r['disc'])]
        fam[f] = [sum(bool(r['pass_cand']) for r in rs), len(rs)]
        checks[f'family_{f}_75'] = len(rs) >= 2 and fam[f][0] >= 0.75 * len(rs)
    out['families'] = fam
    checks['far_c0fail_all_pass'] = all(r['pass_cand'] for r in valid if r['family'] == 'far' and r['pass_c0ps'] is False)
    checks['no_bias_gt_0.30'] = all(abs(r['b_cand']) <= 0.30 for r in valid if r['b_cand'] is not None)
    c0f = [r for r in valid if r['pass_c0ps'] is False]
    checks['improve_90'] = (not c0f) or sum(r['e_cand'] < r['e_c0ps'] for r in c0f) >= 0.9 * len(c0f)
    out['checks'] = checks
    out['verdict'] = 'pass' if all(checks.values()) else 'fail'
    return out


def cmd_ra(a):
    r = ra_unit(a.cand, a.ref, a.down)
    print(json.dumps(r, ensure_ascii=False))
    return r


# ---------------------------------------------------------------- 서쪽 흐림 반사실 + 동쪽 대조(§4.5)
def deck_RB_bins(png, hi=None):
    """P1 D1m 의 덮개 화소(α ≥ 0.7, 같은 고도 맞춤 칸)의 칸별 R/B — 장면 선형(hi 있으면 합침), 없으면 표시."""
    I = load_render('P1', png, None, None, hi, None, check=False)
    sc = [p['RB_deck'] for p in p1_d1m(I.scene)]
    dp = [p['RB_deck'] for p in p1_d1m(I)]
    return sc, dp, I.merge


def cf_rule(gB, gC, gE, kC=0.5, kE=0.8, gmin=0.1):
    """g_B > 0.1 인 칸에서 g_CF ≤ 0.5·g_B 그리고 g_E ≥ 0.8·g_B; 그런 칸이 2 개 미만이면 na(아치 빛이 덮개를 붉히지 못함 — D1m 이 먼저 실패)."""
    idx = [i for i, g in enumerate(gB) if g is not None and g > gmin]
    if len(idx) < 2 or any(gC[i] is None or gE[i] is None for i in idx):
        return None, idx
    return all(gC[i] <= kC * gB[i] and gE[i] >= kE * gB[i] for i in idx), idx


def cmd_cf(a):
    his = a.hi or [None] * 6
    R = [deck_RB_bins(p, h) for p, h in zip([a.b_on, a.b_off, a.cf_on, a.cf_off, a.ce_on, a.ce_off], his)]
    out = {}
    for sp, j in [('scene', 0), ('display', 1)]:
        v = [r[j] for r in R]
        g = [[math.log(x / y) if (x and y) else None for x, y in zip(v[i], v[i + 1])] for i in (0, 2, 4)]
        ok, idx = cf_rule(*g)
        out[sp] = dict(gB=r3(g[0], 4), gCF=r3(g[1], 4), gE=r3(g[2], 4), bins_used=idx, verdict='na' if ok is None else ('pass' if ok else 'fail'),
                       report_cap_ln1_1=[None if x is None else x <= math.log(1.1) for x in g[1]])
    out['verdict'] = out['scene']['verdict'] if R[0][2] and R[0][2].get('used') else out['display']['verdict']
    out['space_used'] = 'scene' if (R[0][2] and R[0][2].get('used')) else 'display'
    print(json.dumps(out, ensure_ascii=False))
    return out


# ---------------------------------------------------------------- 박명 색(§4.6) — twilight-hue.py --horizon 과 같은 자르기, 반올림 없음
def hue_h1(png):
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.float64)
    rowL = a.mean(axis=(1, 2)); y = a.shape[0] - 1
    while y > 0 and rowL[y] < 6:
        y -= 1
    px = a[: max(1, y - 2)].reshape(-1, 3)
    return dict(hue_fracs(px), rows=int(max(1, y - 2)), W=a.shape[1], H=a.shape[0])


def clear_diff(png_e, png_c0):
    """맑은 하늘(두 그림 α < 0.05) 평균 |Δ|(8 비트 단계)."""
    e, ae = _rgb_alpha(png_e); c, ac = _rgb_alpha(png_c0)
    m = (ae < 0.05) & (ac < 0.05) if (ae is not None and ac is not None) else np.ones(e.shape[:2], bool)
    return float(np.abs(e[m] - c[m]).mean()) if m.any() else None


def h1_rule(h, h0, arm_kind, cdiff=None):
    """T 팔 = RULER-twilight-hue H1 그대로(C0 가 이미 실패하면 None = 가드 미평가). A 팔 = 넓힌 규칙(타당성 M5)."""
    if arm_kind != 'A' and not (h0['magenta'] <= 0.10 and h0['blue'] >= 0.10):
        return None, 'C0 가 이미 H1 실패 — 가드 미평가'
    if arm_kind == 'A':
        ok = h['magenta'] <= max(0.10, h0['magenta'] + 0.10) and h['blue'] >= 0.10 and (cdiff is not None and cdiff <= 0.5)
        rule = '자주 ≤ max(0.10, C0 + 0.10) 그리고 푸른 ≥ 0.10 그리고 맑은 하늘 평균 |Δ| ≤ 0.5 단계'
    else:
        ok = h['magenta'] <= 0.10 and h['blue'] >= 0.10
        rule = '자주 ≤ 0.10 그리고 푸른 ≥ 0.10'
    return ok, rule


def cmd_hue(a):
    h = hue_h1(a.png)
    r = dict(h)
    if a.c0:
        h0 = hue_h1(a.c0); r['c0'] = h0; r['clear_diff'] = clear_diff(a.png, a.c0)
        r['ok'], r['rule'] = h1_rule(h, h0, a.arm_kind, r['clear_diff'])
    print(json.dumps(r, ensure_ascii=False))


def cmd_diff(a):
    """§4.4·§4.1 화소 허용폭(RULER-grain G0(c) 와 같은 수): 평균 |Δ| ≤ 0.05/255 그리고 32 단계 넘는 화소 ≤ 0.5 %. --bytes 면 바이트 같음."""
    print(json.dumps(diff_pngs(a.a, a.b, a.bytes)))


def diff_pngs(pa, pb, bytes_=False):
    if bytes_:
        return dict(byte_identical=open(pa, 'rb').read() == open(pb, 'rb').read())
    x = np.asarray(Image.open(pa).convert('RGB')).astype(np.int32); y = np.asarray(Image.open(pb).convert('RGB')).astype(np.int32)
    d = np.abs(x - y)
    r = dict(mean_abs=round(float(d.mean()), 5), frac_gt32=round(float((d.max(-1) > 32).mean()), 5))
    r['pass_'] = r['mean_abs'] <= 0.05 and r['frac_gt32'] <= 0.005
    return r


def cloud_lnY(png):
    """높은 해 이음매(§4.4 b): 구름(α ≥ 0.5, 유효) 장면 선형 Y 중앙의 ln, 그리고 R/B 의 ln."""
    c, ac = _rgb_alpha(png)
    S, ok = scene_from_rgb8(c)
    m = ok & (ac >= 0.5) if ac is not None else ok
    if m.sum() < 400:
        return None, None
    return float(np.log(np.median(S[m] @ LUM))), float(np.log(S[m][:, 0].mean() / max(S[m][:, 2].mean(), 1e-12)))


# ---------------------------------------------------------------- 여유(§4.2) — A/A + 변형 퍼짐
GUARD_KEYS = {'P1': [('D3m', 'ln'), ('D4', 'abs')], 'P2': [('E3', 'ln'), ('E4', 'ln'), ('E8', 'abs')], 'P3': [('C5', 'abs')]}
MKEY = {'D3m': 'D3', 'D4': 'D4', 'E3': 'E3', 'E4': 'E4', 'E8': 'E8', 'C5': 'C5'}


def pair_spread(r1, r2):
    out = {}
    if r1['pid'] != r2['pid']:
        return out
    for k, mode in GUARD_KEYS[r1['pid']]:
        a, b = r1['metrics'].get(k), r2['metrics'].get(k)
        a = a if isinstance(a, list) else [a]; b = b if isinstance(b, list) else [b]
        v = [abs(math.log(x / y)) if mode == 'ln' else abs(x - y) for x, y in zip(a, b) if _num(x) and _num(y) and x > 0 and y > 0]
        if v:
            out[MKEY[k]] = max(v)
    # §4.8 DT: D1m·D3m·E5a·E6a
    for k in {'P1': ['D1m', 'D3m'], 'P2': ['E5a', 'E6a'], 'P3': []}[r1['pid']]:
        for sp in ['metrics_scene', 'metrics']:
            a, b = (r1.get(sp) or {}).get(k), (r2.get(sp) or {}).get(k)
            if isinstance(a, list) and isinstance(b, list):
                v = [abs(math.log(x / y)) for x, y in zip(a, b) if _num(x) and _num(y) and x > 0 and y > 0]
                if v:
                    out['DT'] = max(out.get('DT', 0), max(v))
    return out


def margins_from(aa_pairs, var_pairs):
    """m_k = max(적은 값, 3 × A/A_k) (통계 #8 을 고쳐 받아들임 — C0 대 C0ps 차이는 표본별 하늘빛이라는 진짜 경로 차이라 여유에 넣지 않고 보고만).
       aa = 같은 잡을 다른 페이지에서 두 번(C0·C0ps), var = 보고용 쌍."""
    A, Vv = {}, {}
    for r1, r2 in aa_pairs:
        for k, v in pair_spread(r1, r2).items():
            A[k] = max(A.get(k, 0), v)
    for r1, r2 in var_pairs:
        for k, v in pair_spread(r1, r2).items():
            Vv[k] = max(Vv.get(k, 0), v)
    return {k: max(MARGIN0[k], 3 * A.get(k, 0)) for k in MARGIN0}, A, Vv


def cmd_margins(a):
    ld = lambda ps: [json.load(open(p)) for p in ps]
    aa, var = ld(a.aa or []), ld(a.var or [])
    m, A, Vv = margins_from(list(zip(aa[::2], aa[1::2])), list(zip(var[::2], var[1::2])))
    r = dict(margins=r3(m, 4), aa=r3(A, 4), variant_report=r3(Vv, 4), rule='m_k = max(적은 값, 3 × A/A)')
    print(json.dumps(r, ensure_ascii=False))
    if a.out:
        json.dump(r, open(a.out, 'w'), indent=1, ensure_ascii=False)


# ---------------------------------------------------------------- 더하는 아치 빛 가능성(§5.0)
def feas_scan(png, hi, rgb, guard_base=None, photo=None, fs=None, where='cloud'):
    """P1B 렌더(장면 선형)에 α 비례 빛(색 rgb, 크기 f × 덮개 상자 구름 장면 Y 평균)을 더해 다시 톤 매핑 → D1m(두 공간)·D2·D3_band·D4_band.
       where='cloud' 이면 모든 구름 화소(적운 띠 포함), 'deck' 이면 고도 ≥ 5° 만."""
    I = load_render('P1', png, None, None, hi, None, check=False)
    S_all = aces_inv(srgb_eotf(I.rgb8))                     # 발끝·잘림 화소도 근사 역변환(더한 빛이 발끝에서 들어 올리는 몫을 셈)
    S = np.where(I.scene.sky[..., None], I.scene.lin, S_all)
    al = I.alpha if I.alpha is not None else np.zeros(I.el.shape)
    rgb = np.asarray(rgb, float); rgb = rgb / (rgb @ LUM)
    _, _, deckbox, _ = p1_boxes(I)
    dm = deckbox & (al >= A_DECK) & I.scene.sky
    Yd = float((S[dm] @ LUM).mean())
    w = al * ((I.el >= 5.0) if where == 'deck' else 1.0)
    # 표시 8 비트 다시 만들기: 장면 선형 → ACES(k = 1, 역변환과 같은 척도) → sRGB 8 비트
    base_rec = dict(metrics=p1_core(I), metrics_scene=p1_core(I.scene))
    photo = photo or json.load(open(os.path.join(HERE, 'tsun-photo.json')))
    B = guard_base or base_rec
    rows = []
    for f in (fs or [0.0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]):
        S2 = S + (f * Yd) * w[..., None] * rgb[None, None, :]
        rgb8 = np.where(I.sky[..., None], np.round(srgb_oetf8(aces_fwd(S2))), I.rgb8)
        J = Img('P1', rgb8, I.az, I.el, I.alpha, 'render')
        ok2 = (rgb8.min(-1) >= TOE_LO) & (rgb8.max(-1) <= TOE_HI)
        Js = J.with_lin(S2, ok2 | (I.scene.sky if hi else np.zeros_like(ok2)), 'scene')
        rec = dict(metrics=p1_core(J), metrics_scene=p1_core(Js))
        V = judge_one('P1', photo, rec, B)
        rows.append(dict(f=f, D1m=r3(rec['metrics']['D1m']), D1m_scene=r3(rec['metrics_scene']['D1m']), D2=r3(rec['metrics']['D2_pooled_8_18']),
                         D2_scene=r3(rec['metrics_scene']['D2_pooled_8_18']), D3m=r3(rec['metrics']['D3m']), D4=r3(rec['metrics']['D4']),
                         verdict={k: V[k]['verdict'] for k in ['D1m', 'D2', 'D3_band', 'D4_band']}))
    win = [r['f'] for r in rows if all(v == 'pass' for v in r['verdict'].values())]
    return dict(rgb=list(rgb), where=where, Y_deck_scene=Yd, rows=rows, feasible=bool(win), window=win,
                note='합성 더하기(균일·α 비례) — 위상·거리·그림자 없음 [estimate]')


def cmd_feas(a):
    rgb = [float(x) for x in a.rgb.split(',')]
    r = feas_scan(a.png, a.hi, rgb, where=a.where)
    for row in r['rows']:
        print(json.dumps(row, ensure_ascii=False))
    print('feasible', r['feasible'], 'window', r['window'])
    if a.out:
        json.dump(r, open(a.out, 'w'), indent=1, ensure_ascii=False)


# ---------------------------------------------------------------- 판정 묶음(§4.9) — gate --manifest
T_ARMS, A_ARMS = ['T1', 'T2'], ['T1A1', 'T1A2']


def gate(man, photo, scenes):
    """manifest = {renders: {잡 이름: png}, meta: {잡 이름: {W,H,exposure,bundle,hi?,layers?}}, margins?: {…}, floors?: {e,b,c,p75},
                   impl: {G-T0, G-T1, probe: {팔: {verdict, err_RB, err_Y}}, ref_valid, ref_slab, pipeline, aa}, cost?: {팔: {ratio, cum, cap_cum}}}.
       반환: 팔마다 {checks, verdict} + adoption."""
    R, Mt = man['renders'], man.get('meta', {})
    margins = man.get('margins') or {}
    out = {'refused': [], 'arms': {}}
    # 0. 번들·크기·노출이 섞이면 거절(절차 #6)
    bundles = {m.get('bundle') for m in Mt.values() if m.get('bundle')}
    if len(bundles) > 1:
        out['refused'].append(f'번들 섞임 {sorted(bundles)}')
    def png(arm, sc):
        return R.get(f'{arm}__{sc}')
    def rec(arm, sc, pid, hi_sc=None):
        p = png(arm, sc)
        if not p or not os.path.exists(p):
            return None
        h = png(arm, hi_sc) if hi_sc else None
        try:
            return render_record(pid, p, h if (h and os.path.exists(h)) else None, Mt.get(f'{arm}__{sc}'))
        except AssertionError as e:
            out['refused'].append(str(e)); return None
    photo_sc = {'P1': ('P1B', 'P1Bh'), 'P2': ('P2B', None), 'P3': ('P3B', None)}
    recs = {arm: {pid: rec(arm, sc, pid, h) for pid, (sc, h) in photo_sc.items()} for arm in ['C0', 'C0ps'] + T_ARMS + A_ARMS + ['H0']}
    impl = man.get('impl', {})
    units = scenes['scenes']['RA']['units']
    floors = man.get('floors')
    ra_c0 = {u['name']: (ra_unit(png('C0ps', u['name']), png('REF', u['name'])) if (png('C0ps', u['name']) and png('REF', u['name'])) else {}) for u in units}
    hs_units = scenes['scenes']['HS']['units']
    hc = []
    for u in hs_units:
        p0, p1 = png('C0', u['name']), png('C0ps', u['name'])
        if u['sun']['alt'] >= 12.0:
            hc.append(diff_pngs(p0, p1)['pass_'] if (p0 and p1) else None)
    hs_c = dict(verdict='na' if (not hc or None in hc) else ('pass' if all(hc) else 'fail'), n=len(hc),
                role='가드(C0 = C0ps at ≥ 12° — 실패면 C0ps 정의 오류로 멈춤)')
    for arm in T_ARMS + A_ARMS + ['H0']:
        kind = 'T' if arm in T_ARMS else 'A'
        tarm = 'T1' if kind == 'A' else arm
        C = {}
        # 구현 점검(기록값): G-T0·G-T1·파이프라인·A/A·REF 검증
        C['HS_c'] = hs_c
        for k in ['G-T0', 'G-T1', 'pipeline', 'aa', 'ref_valid', 'ref_slab']:
            v = impl.get(k)
            C['impl_' + k] = dict(verdict=v if v in ('pass', 'fail') else 'na', role='구현 점검')
        # 사진 관문·가드
        for pid in ['P1', 'P2', 'P3']:
            c, b, c0 = recs[arm][pid], recs['C0ps'][pid], recs['C0'][pid]
            if c is None or b is None:
                C[f'{pid}_photo'] = dict(verdict='na', why='렌더 없음'); continue
            for k, v in judge_one(pid, photo, c, b, c0, kind, margins).items():
                C[f'{pid}.{k}'] = v
            if pid == 'P1' and c.get('merge') is not None:
                C['P1.merge'] = dict(verdict='pass' if c['merge'].get('ok') else 'fail', merge=c['merge'], role='보고(합침 점검 — 실패면 P1 장면 공간 = ×1 발끝 뺀 값, §3.1)')
            if kind == 'T' and pid in ('P1', 'P2'):
                C[f'{pid}.DT'] = deep_twilight(pid, c, b, margins)
        # R-A (T 팔만 판정; 아치 팔은 그 T 팔의 결과를 물려받음)
        if kind == 'T':
            ra_c = {u['name']: (ra_unit(png(arm, u['name']), png('REF', u['name'])) if (png(arm, u['name']) and png('REF', u['name'])) else {}) for u in units}
            ra = ra_arm(units, ra_c, ra_c0, floors)
            C['R-A'] = dict(verdict=ra['verdict'], detail={k: v for k, v in ra.items() if k != 'rows'}, role='관문(T)')
            # 높은 해(§4.4)
            hs_ok, seam = [], []
            for u in hs_units:
                pa, pb = png(arm, u['name']), png('C0ps', u['name'])
                if not (pa and pb):
                    hs_ok.append(None); continue
                if u['sun']['alt'] >= 12.0 and not u['name'].endswith(('s11.9_V1', 's11.9_V2')):
                    hs_ok.append(diff_pngs(pa, pb)['pass_'])
            C['HS_a'] = dict(verdict='na' if (not hs_ok or None in hs_ok) else ('pass' if all(hs_ok) else 'fail'), n=len(hs_ok), role='가드')
            for scn in ['RA1', 'RA3']:
                for v in ['V1', 'V2']:
                    q = {x: png(x, f'HS_{scn}_s12.1_{v}') for x in [arm, 'C0ps']}; q2 = {x: png(x, f'HS_{scn}_s11.9_{v}') for x in [arm, 'C0ps']}
                    if not all(list(q.values()) + list(q2.values())):
                        seam.append(None); continue
                    da = cloud_lnY(q[arm])[0], cloud_lnY(q2[arm])[0]; db = cloud_lnY(q['C0ps'])[0], cloud_lnY(q2['C0ps'])[0]
                    if None in da or None in db:
                        seam.append(None); continue
                    seam.append(abs(da[0] - da[1]) <= max(abs(db[0] - db[1]), 0.02, 2 * float((floors or {}).get('e') or 0)))
            C['HS_b'] = dict(verdict='na' if (not seam or None in seam) else ('pass' if all(seam) else 'fail'), role='가드(12° 이음매)')
        else:
            C['T_arm'] = dict(verdict='pending', of=tarm, role='관문(그 T 팔이 채택 후보)')
            # 반사실 + 동쪽 대조(§4.5)
            sc_ = ['P1B', 'P1B', 'P1CF', 'P1CF', 'P1CE', 'P1CE']; arms_ = [arm, tarm] * 3
            ps = [png(x, s) for x, s in zip(arms_, sc_)]; hs = [png(x, s + 'h') for x, s in zip(arms_, sc_)]
            lay_ok = all((Mt.get(f'{x}__{s}', {}).get('layers_ok') is True) for x, s in zip(arms_, sc_) if s != 'P1B')
            if all(ps) and lay_ok:
                Rr = [deck_RB_bins(p, h if (h and os.path.exists(h)) else None) for p, h in zip(ps, hs)]
                use_sc = all(r[2] and r[2].get('used') for r in Rr)
                j = 0 if use_sc else 1
                g = [[math.log(x / y) if (x and y) else None for x, y in zip(Rr[i][j], Rr[i + 1][j])] for i in (0, 2, 4)]
                ok, idx = cf_rule(*g)
                C['CF'] = dict(verdict='na' if ok is None else ('pass' if ok else 'fail'), gB=r3(g[0], 4), gCF=r3(g[1], 4), gE=r3(g[2], 4), space='scene' if use_sc else 'display', role='관문(아치)')
            else:
                C['CF'] = dict(verdict='na', why='렌더 없음 또는 벽 층 확인 실패(layers)', role='관문(아치)')
            pr = (impl.get('probe') or {}).get(arm, {})
            C['probe'] = dict(verdict=pr.get('verdict', 'na'), detail=pr, role='구현 점검(아치 항 대 CPU 적분기, ln R/B ≤ ln 1.10 · ln Y ≤ ln 1.20)')
            # 켜짐 이음매(타당성 m4): −0.9/−1.1, −1.9/−2.1
            sm = []
            for a1, a2 in [('s-0.9', 's-1.1'), ('s-1.9', 's-2.1')]:
                for scn in ['RA3', 'RA4']:
                    q = [png(x, f'AS_{scn}_{s}_V1') for x in [arm, tarm] for s in (a1, a2)]
                    if not all(q):
                        sm.append(None); continue
                    v = [cloud_lnY(p) for p in q]
                    if any(x[0] is None for x in v):
                        sm.append(None); continue
                    dA = (v[0][0] - v[1][0], v[0][1] - v[1][1]); dT = (v[2][0] - v[3][0], v[2][1] - v[3][1])
                    sm.append(abs(dA[0] - dT[0]) <= 0.05 and abs(dA[1] - dT[1]) <= 0.05)
            C['AS'] = dict(verdict='na' if (not sm or None in sm) else ('pass' if all(sm) else 'fail'), role='가드(아치 켜짐 이음매)')
        # 박명 색(§4.6)
        h1 = []
        for tw in ['tw1734', 'tw1746']:
            pa, p0 = png(arm, tw), png('C0', tw)
            if not (pa and p0):
                h1.append(None); continue
            ok, rule = h1_rule(hue_h1(pa), hue_h1(p0), kind, clear_diff(pa, p0) if kind == 'A' else None)
            h1.append(ok)
        C['H1'] = dict(verdict='na' if (not h1 or None in h1) else ('pass' if all(h1) else 'fail'), role='가드')
        cst = (man.get('cost') or {}).get(arm)
        C['cost'] = dict(verdict='na' if not cst else ('pass' if (cst['ratio'] <= 1.15 and cst['cum'] <= cst['cap_cum']) else 'fail'), detail=cst, role='가드(비용)')
        out['arms'][arm] = dict(checks=C)
    # 판정 · 채택
    def gates_of(arm):
        C = out['arms'][arm]['checks']
        if arm in T_ARMS:
            return [C.get('R-A'), C.get('P3.C1')]
        if arm == 'H0':
            return [C.get('P1.D1m'), C.get('P1.D2'), C.get('CF')]
        return [C.get('P1.D1m'), C.get('P1.D2'), C.get('CF'), C.get('probe')]
    def guards_of(arm):
        return [v for k, v in out['arms'][arm]['checks'].items() if v and ('가드' in v.get('role', '') or '구현 점검' in v.get('role', ''))]
    for arm in T_ARMS + A_ARMS + ['H0']:
        g = gates_of(arm); gd = guards_of(arm)
        if any(x is None or x['verdict'] == 'na' for x in g):
            v = 'na(관문 평가 불가)'
        elif not all(x['verdict'] == 'pass' for x in g):
            v = 'fail(관문)'
        elif any(x['verdict'] == 'na' for x in gd):
            v = 'na(가드 미평가)'
        elif any(x['verdict'] == 'fail' for x in gd):
            v = 'fail(가드: ' + ', '.join(k for k, x in out['arms'][arm]['checks'].items() if x in gd and x['verdict'] == 'fail') + ')'
        else:
            v = 'candidate'
        out['arms'][arm]['verdict'] = v
    tc = [a for a in T_ARMS if out['arms'][a]['verdict'] == 'candidate']
    t_adopt = None
    if tc:
        cost = lambda a: ((man.get('cost') or {}).get(a) or {}).get('ratio', 9e9)
        t_adopt = sorted(tc, key=lambda a: (cost(a), T_ARMS.index(a)))[0]
    for a in A_ARMS:
        if out['arms'][a]['verdict'] == 'candidate' and t_adopt != 'T1':
            out['arms'][a]['verdict'] = 'fail(T1 이 채택 후보 아님)'
    h0cf = (out['arms']['H0']['checks'].get('CF') or {}).get('verdict')
    ac = [a for a in A_ARMS if out['arms'][a]['verdict'] == 'candidate']
    a_adopt = None
    if h0cf != 'fail':
        out['arch_note'] = f'H0(T_arch ≡ 1 인 아치 빛)의 CF = {h0cf} — 반사실이 가짜를 못 가림(또는 미평가), 아치 빛 채택 안 함(§4.5·§4.9)'
    elif ac:
        perr = lambda a: (((man.get('impl') or {}).get('probe') or {}).get(a) or {}).get('err_sum', 9e9)
        cost = lambda a: ((man.get('cost') or {}).get(a) or {}).get('ratio', 9e9)
        a_adopt = sorted(ac, key=lambda a: (perr(a), cost(a), A_ARMS.index(a)))[0]
    out['adoption'] = dict(T=t_adopt, A=a_adopt, H0=out['arms']['H0']['verdict'], note='앱 기본값으로 켜는 것은 사용자 결정(held-out 사진 뒤, §4.9)')
    if out['refused']:
        out['adoption'] = dict(T=None, A=None, note='거절: ' + '; '.join(out['refused']))
    return out


def cmd_gate(a):
    man = json.load(open(a.manifest))
    photo = json.load(open(man.get('photo') or os.path.join(HERE, 'tsun-photo.json')))
    scenes = json.load(open(man.get('scenes') or os.path.join(HERE, 'scenes-tsun.json')))
    if isinstance(man.get('margins'), str):
        man['margins'] = json.load(open(man['margins']))['margins']
    r = gate(man, photo, scenes)
    for arm, v in r['arms'].items():
        print(arm, v['verdict'])
    print('adoption', json.dumps(r['adoption'], ensure_ascii=False))
    if a.out:
        json.dump(r3(r, 4), open(a.out, 'w'), indent=1, ensure_ascii=False)
    return r


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('geo-export')
    p = sp.add_parser('photo'); p.add_argument('--out')
    p = sp.add_parser('render'); p.add_argument('pid', choices=['P1', 'P2', 'P3']); p.add_argument('png'); p.add_argument('--hi'); p.add_argument('--meta'); p.add_argument('--cam'); p.add_argument('--out')
    p = sp.add_parser('judge'); p.add_argument('--photo', required=True); p.add_argument('--cand', required=True); p.add_argument('--base', required=True)
    p.add_argument('--c0'); p.add_argument('--arm-kind', default='T', choices=['T', 'A']); p.add_argument('--margins'); p.add_argument('--out')
    p = sp.add_parser('baseline'); p.add_argument('--out')
    sp.add_parser('selftest')
    p = sp.add_parser('ra'); p.add_argument('cand'); p.add_argument('ref'); p.add_argument('--down', type=int, default=1)
    p = sp.add_parser('cf')
    for k in ['b_on', 'b_off', 'cf_on', 'cf_off', 'ce_on', 'ce_off']:
        p.add_argument(k)
    p.add_argument('--hi', nargs=6)
    p = sp.add_parser('hue'); p.add_argument('png'); p.add_argument('--c0'); p.add_argument('--arm-kind', default='T', choices=['T', 'A'])
    p = sp.add_parser('diff'); p.add_argument('a'); p.add_argument('b'); p.add_argument('--bytes', action='store_true')
    p = sp.add_parser('margins'); p.add_argument('--aa', nargs='*'); p.add_argument('--var', nargs='*'); p.add_argument('--out')
    p = sp.add_parser('feas'); p.add_argument('png'); p.add_argument('--hi'); p.add_argument('--rgb', required=True); p.add_argument('--where', default='cloud', choices=['cloud', 'deck']); p.add_argument('--out')
    p = sp.add_parser('gate'); p.add_argument('--manifest', required=True); p.add_argument('--out')
    a = ap.parse_args()
    {'geo-export': cmd_geo_export, 'photo': cmd_photo, 'render': cmd_render, 'judge': cmd_judge, 'baseline': cmd_baseline, 'selftest': cmd_selftest,
     'ra': cmd_ra, 'cf': cmd_cf, 'hue': cmd_hue, 'diff': cmd_diff, 'margins': cmd_margins, 'feas': cmd_feas, 'gate': cmd_gate}[a.cmd](a)
