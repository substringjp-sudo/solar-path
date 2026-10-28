#!/usr/bin/env python3
"""
RULER-tsun 사진·렌더 지표 (T_sun · 아치 빛, 초안 2026-10-28) — RULER-tsun.md §3 의 정의를 코드로 그대로.

  nice -n 19 python3 -I tsun_photo.py photo [--out tsun-photo.json]
      사진 P1·P2·P3 에서 모든 지표를 셈 + 비평(critic.md) 숫자 재현 검사(§3.6 허용폭) → JSON
  nice -n 19 python3 -I tsun_photo.py render P1|P2|P3 그림.png [--alpha 그림.alpha.png] [--cam az,el,vfov[,roll]] [--out m.json]
      하네스 렌더 한 장에서 같은 지표(같은 방위·고도 영역, 같은 색 계산). --cam 이 없으면 scenes-tsun.json 의 렌더 카메라.
  nice -n 19 python3 -I tsun_photo.py judge --photo tsun-photo.json --cand c1.json [c2.json …] [--base b1.json …]
      RULER-tsun.md §4 의 통과 규칙(절대 규칙 + 기준 대비 나빠지지 않음)을 기계적으로 적용.
  nice -n 19 python3 -I tsun_photo.py baseline [--out tsun-baseline.json]
      비평 에이전트의 기존 렌더(scratchpad)에 render 를 돌려 '오늘 기준'을 기록(판정 아님 — §5 재측정 전 참고값).
  nice -n 19 python3 -I tsun_photo.py ra 후보.png 기준.png          R-A 단위 지표(§4.3; 같은 장면·해·시점의 후보 대 긴 광선 기준)
  nice -n 19 python3 -I tsun_photo.py cf B켬.png B끔.png CF켬.png CF끔.png   서쪽 흐림 반사실(§4.5)
  nice -n 19 python3 -I tsun_photo.py diff a.png b.png [--bytes]     끄면 그대로·높은 해 가드(§4.1·§4.4)

색 계산(§3.1): 8 비트 값 → (상자 축소, 8 비트 공간) → sRGB EOTF → **선형 sRGB**(사진 파일의 Display-P3 ICC 는 무시 — 렌더와 같은 길;
P3 행렬 감도는 photo 출력의 p3_sensitivity 에 기록). 표시 luma = Rec.709 가중(0.2126, 0.7152, 0.0722) × 8 비트 값(0~255).
선형 Y = 같은 가중 × 선형 값. R/B = 영역의 선형 R 평균 / 선형 B 평균(화소별 비의 평균이 아님).
기하(§3.2): 화소 → (방위, 고도) 는 핀홀(주점 = 가운데), roll 포함, 고도는 기하 수평 기준(굴절 없음) — geo-P*.json 과 같은 식.
하늘 마스크: 사진 실루엣(geo photo_silhouette) + 0.15° 위(실루엣 방위 범위 밖은 고도 ≥ EL_SAFE), P2 는 고도 < 15° 와 돛대 상자 제외, P3 는 돛대 상자 제외.
렌더에도 같은 마스크(사진 실루엣)를 씁니다(하네스는 지형 없음).
"""
import argparse, hashlib, json, math, os, sys
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = '/tmp/claude-0/-home-user-solar-path/827aa702-2f52-52c8-9fe8-e45a3ff14759/scratchpad/twphoto'
UP = '/root/.claude/uploads/827aa702-2f52-52c8-9fe8-e45a3ff14759/'
# 사진은 저장소 밖 — sha256 로 고정(§2). 경로는 환경 변수 TSUN_P1·TSUN_P2·TSUN_P3 로 바꿀 수 있음.
PHOTOS = {
    'P1': dict(img=UP + '035793bf-image.jpg', sha256='42bbd2ec6d6e6ee7cf480ce97923ba1b946a6ca79b98e3b5a24d40234c8b03ec',
               geo=SCR + '/geo-P1.json', ds=4),
    'P2': dict(img=UP + '2ffb5792-image.jpg', sha256='d349990c673a19e3668cd28c7c36a5832024a0346802ab2b1effc33984da8461',
               geo=SCR + '/heda/geo-P2.json', ds=2),
    'P3': dict(img=UP + 'b7bca0fb-image.jpg', sha256='c715077d0eae013744a3d702d5edc0efbe32ab5ccfe040ffed09c4b96ec25966',
               geo=SCR + '/heda/geo-P3.json', ds=4),
}
# 엔진 해(src/utils/solarPosition.ts sunPosition, NOAA) — §2 표. SunCalc 금지.
SUN = {'P1': dict(alt=-9.8423, az=272.6585), 'P2': dict(alt=-6.9193, az=268.9720), 'P3': dict(alt=1.1076, az=263.3732)}
# 렌더 카메라(비평 렌더와 같음: roll 0, 사진은 roll 포함) — scenes-tsun.json cams 와 같아야 함.
RENDER_CAM = {'P1': dict(az=275.301, el=8.452, vfov=58.285, roll=0.0),
              'P2': dict(az=269.812, el=6.094, vfov=28.161, roll=0.0),
              'P3': dict(az=263.142, el=5.541, vfov=12.879, roll=0.0)}
LUM = np.array([0.2126, 0.7152, 0.0722])
M_P3_TO_SRGB = np.array([[1.2249401, -0.2249404, 0.0], [-0.0420569, 1.0420571, 0.0], [-0.0196376, -0.0786361, 1.0982735]])

# P1 덮개 가장자리(비평 rend/common.py P1_EDGE_AZEL, 사진에서 그은 선) — (방위, 고도)
P1_EDGE_AZEL = [(311.0, 25.56), (302.6, 23.86), (292.9, 20.63), (282.3, 16.31), (272.3, 11.89), (263.3, 8.59), (254.9, 5.97),
                (249.0, 4.24), (243.6, 3.24), (238.8, 2.60)]
P1_BINS = [(6, 10), (10, 15), (15, 20), (20, 30)]
P1_MIRROR_BINS = [(8, 10), (10, 12), (12, 14), (14, 16), (16, 18)]
P2_REG = {'strip': (1.1, 2.2), 'band': (2.5, 3.5), 'deck': (4.1, 6.8), 'upper': (6.8, 15.0)}
P2_GAP_BINS = [(7.5, 8.5), (8.5, 9.0)]
P2_E7_BINS = [(1, 1.5), (1.5, 2), (2, 2.5), (2.5, 3), (3, 3.5), (3.5, 4), (4, 5), (5, 6), (6, 8), (8, 10), (10, 12), (12, 15)]
EL_SAFE = {'P1': 5.0, 'P2': 4.0, 'P3': 6.0}   # 실루엣 최대(2.09 · 2.83 · 5.07°) + 여유 [estimate]
P2_MAST = dict(az=(273.45, 274.35), el_max=2.3)   # 비평 렌더 정의(common_h.py) — 사진·렌더 같은 상자
P3_MAST = dict(az=(267.0, 267.5), el=(0.8, 1.45))  # meas-P3 정의
P3_REG = {'glow': dict(el=(1.2, 3.2), daz_max=2.5), 'side': dict(el=(1.2, 3.2), daz_min=4.0), 'mid': dict(el=(3.2, 6.5)),
          'upper': dict(el=(7.0, 12.0)), 'sheet': dict(el=(6.5, 8.25)), 'ref': dict(el=(4.25, 5.15)), 'far': dict(el=(1.25, 4.25))}

# 비평이 적은 사진 값(재현 대상)과 허용폭(§3.6): 비 ±5 %(상대), 고도 ±0.10°, 비율(분율) ±0.05.
CRITIC = {
    'P1': {'D1': ([1.81, 1.73, 1.80, 1.76], 'rel', 0.05, 'twphoto/critic.md Q5 D1 (critic/pdeck.py)'),
           'D3': ([0.25, 0.43, 1.00, 1.42], 'rel', 0.05, 'twphoto/critic.md Q5 D3 (critic/pdeck.py) — 두 자리 반올림'),
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
# 사진 값 중 이 도구가 다시 셀 수 없어 인용만 하는 것(meas 에이전트 분할 마스크 기반) — [from agent]
CITED = {
    'P1': {'D4s_cloud_over_sky_band': dict(value=[0.22, 0.24], src='twphoto/critic.md Q5 D4 (meas-P1.json)')},
    'P2': {'E5seg': dict(value={'7.5-8.0': 1.349, '8.0-8.5': 1.226, '8.5-9.0': 1.442, 'core': [1.393, 1.289, 1.579]}, src='heda/meas-P2.json deck_vs_gap_same_el'),
           'E6seg': dict(value={'7.5-8.0': 0.152, '8.0-8.5': 0.181, '8.5-9.0': 0.174, 'core': [0.124, 0.146, 0.141]}, src='heda/meas-P2.json deck_vs_gap_same_el'),
           'E7': dict(value={'0.75-2.25': 0.135, '2.25-3.5': 0.352, '3.5-6.25': 0.107, '6.25-9.0': 0.185, '9.0-10.0': 0.141},
                      src='heda/meas-P2.json headline ratio_cloud_to_sky_behind (critic Q5 E7 "0.06-0.43")')},
    'P3': {'C3': dict(value=0.93, src='heda/meas-P3.json headline 6.5-8.25 dark RB_over_ref (critic Q5 C3)'),
           'C4': dict(value=[6.408, 6.441, 7.767], src='heda/meas-P3.json headline RB_warm_over_ref 1.25-2.5/2.5-3.25/3.25-4.25')},
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def srgb_eotf(x):
    x = np.asarray(x, np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


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


class Img:
    """표시 8 비트 RGB(float) + 선형 + (방위, 고도) + 하늘 마스크 (+ 렌더 알파)."""

    def __init__(self, pid, rgb8, az, el, alpha=None, kind='photo'):
        self.pid, self.kind = pid, kind
        self.rgb8 = rgb8.astype(np.float64)
        self.lin = srgb_eotf(self.rgb8)
        self.luma = self.rgb8 @ LUM
        self.Y = self.lin @ LUM
        self.az, self.el, self.alpha = az, el, alpha
        g = json.load(open(PHOTOS[pid]['geo']))
        s = g['photo_silhouette']
        saz = np.array(s['az_deg'], float); sel = np.array(s['el_deg'], float); o = np.argsort(saz)
        sk = np.interp(az, saz[o], sel[o], left=np.nan, right=np.nan)
        self.sil_defined = np.isfinite(sk)
        with np.errstate(invalid='ignore'):
            # 실루엣 방위 범위 안: 실루엣 + 0.15° 위. 밖: el ≥ EL_SAFE(어디서도 지형이 그보다 높지 않은 고도, §3.2)
            m = (self.sil_defined & (el > sk + 0.15)) | (~self.sil_defined & (el >= EL_SAFE[pid]))
        if pid == 'P2':
            m &= el < 15.0
            m &= ~((az > P2_MAST['az'][0]) & (az < P2_MAST['az'][1]) & (el < P2_MAST['el_max']))
        if pid == 'P3':
            m &= ~((az >= P3_MAST['az'][0]) & (az <= P3_MAST['az'][1]) & (el >= P3_MAST['el'][0]) & (el <= P3_MAST['el'][1]))
        self.sky = m

    def RB(self, m, minn=30):
        if m.sum() < minn:
            return None
        L = self.lin[m]
        return float(L[:, 0].mean() / max(L[:, 2].mean(), 1e-9))

    def Ym(self, m, minn=30):
        return float(self.Y[m].mean()) if m.sum() >= minn else None

    def lmed(self, m, minn=30):
        return float(np.median(self.luma[m])) if m.sum() >= minn else None


def load_photo(pid, path=None):
    P = PHOTOS[pid]
    path = path or os.environ.get('TSUN_' + pid) or P['img']
    g = json.load(open(P['geo'])); c = g['camera']
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    W, H = im.size
    assert [W, H] == g['image_size_after_exif_orientation'], (pid, im.size)
    ds = P['ds']
    small = np.asarray(im.resize((W // ds, H // ds), Image.BOX)).astype(np.float64)   # 8 비트 공간 상자 축소(비평과 같음)
    us = (np.arange(W // ds) + 0.5) * ds; vs = (np.arange(H // ds) + 0.5) * ds
    U, V = np.meshgrid(us, vs)
    az, el = pix2azel(U, V, W, H, c['az0_deg'], c['el0_deg'], c['roll_deg'], c['f_px'])
    return Img(pid, small, az, el, None, 'photo'), path


def load_render(pid, png, alpha_png=None, cam=None):
    c = dict(RENDER_CAM[pid]); c.update(cam or {})
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.float64)
    H, W = a.shape[:2]
    f = (H / 2) / math.tan(math.radians(c['vfov']) / 2)
    U, V = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    az, el = pix2azel(U, V, W, H, c['az'], c['el'], c['roll'], f)
    al = None
    if alpha_png and os.path.exists(alpha_png):
        al = np.asarray(Image.open(alpha_png).convert('L')).astype(np.float64) / 255.0
    return Img(pid, a, az, el, al, 'render')


def r3(x, n=3):
    if x is None:
        return None
    if isinstance(x, (list, tuple)):
        return [r3(v, n) for v in x]
    if isinstance(x, dict):
        return {k: r3(v, n) for k, v in x.items()}
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else round(float(x), n)
    return x


def hue_fracs(rgb8):
    """RULER-twilight-hue.md 자주/푸른 비율(표시값)."""
    R, G, B = rgb8[:, 0], rgb8[:, 1], rgb8[:, 2]
    return dict(magenta=float(np.mean((G + 6 < R) & (G + 6 < B))), blue=float(np.mean((B > R + 6) & (B >= G))), n=int(len(rgb8)))


# ---------------------------------------------------------------- P1 (R-B-deep D1~D5)
def p1_edge(az):
    a = np.array([q[0] for q in P1_EDGE_AZEL][::-1]); e = np.array([q[1] for q in P1_EDGE_AZEL][::-1])
    return np.interp(az, a, e, left=np.nan, right=np.nan)


def metrics_P1(I):
    az, el, sky = I.az, I.el, I.sky
    ee = p1_edge(az)
    with np.errstate(invalid='ignore'):
        above = el > ee + 2; below = el < ee - 2
    out = {'D1': [], 'D3': [], 'D1_parts': []}
    for lo, hi in P1_BINS:
        b = sky & (el >= lo) & (el < hi)
        dk = b & above & (az >= 236) & (az <= 300)
        cl = b & below & (az <= 312)
        rd, rc = I.RB(dk), I.RB(cl); yd, yc = I.Ym(dk), I.Ym(cl)
        out['D1'].append(None if (rd is None or rc is None) else rd / rc)
        out['D3'].append(None if (yd is None or yc is None) else yd / yc)
        out['D1_parts'].append(dict(el=[lo, hi], n_deck=int(dk.sum()), n_clear=int(cl.sum()), RB_deck=rd, RB_clear=rc))
    # D2 기하 거울(판정용, 사진·렌더 같은 정의): 덮개 쪽 = 해 방위 − d (3 ≤ d ≤ 20), 가장자리 + 2° 위; 거울 = 해 방위 + d, 같은 줄, 가장자리 − 2° 아래
    sun = SUN['P1']['az']
    out['D2'] = []; pairs_all = ([], [])
    for lo, hi in P1_MIRROR_BINS:
        dk_px, cl_px = [], []
        rows = np.where((sky & (el >= lo) & (el < hi)).any(1))[0]
        for r in rows:
            a = az[r]; e = el[r]; s_ = sky[r]
            o = np.argsort(a); ao = a[o]
            d = sun - a
            sel = s_ & (e >= lo) & (e < hi) & (d >= 3) & (d <= 20) & above[r]
            if not sel.any():
                continue
            am = sun + d[sel]
            j = np.clip(np.searchsorted(ao, am), 1, len(ao) - 1)
            jj = np.where(np.abs(ao[j - 1] - am) < np.abs(ao[j] - am), j - 1, j)
            cm = o[jj]
            ok = (np.abs(a[cm] - am) <= 0.2) & below[r][cm] & s_[cm]
            src = np.where(sel)[0][ok]
            dk_px.append(I.lin[r, src]); cl_px.append(I.lin[r, cm[ok]])
        if not dk_px or sum(len(x) for x in dk_px) < 30:
            out['D2'].append(None); continue
        dk = np.concatenate(dk_px); cl = np.concatenate(cl_px)
        pairs_all[0].append(dk); pairs_all[1].append(cl)
        out['D2'].append(float((dk[:, 0].mean() / dk[:, 2].mean()) / (cl[:, 0].mean() / cl[:, 2].mean())))
    if pairs_all[0]:
        dk = np.concatenate(pairs_all[0]); cl = np.concatenate(pairs_all[1])
        out['D2_pooled_8_18'] = float((dk[:, 0].mean() / dk[:, 2].mean()) / (cl[:, 0].mean() / cl[:, 2].mean()))
        out['D2_pairs'] = int(len(dk))
    # D4 띠 p10 / 빛 중앙(표시 luma)
    band = sky & (el <= 4.0) & (az >= 255) & (az <= 308)
    glow = sky & (el >= 5.5) & (el <= 7.5) & (az >= 268) & (az <= 305)
    gm = I.lmed(glow)
    out['D4'] = None if (gm is None or band.sum() < 30) else float(np.percentile(I.luma[band], 10) / max(gm, 0.5))
    # D5 띠 꼭대기(휘도 규칙): 0.25° 방위 칸마다 6.5~8.5° 하늘 중앙의 0.6 배보다 어두운 가장 높은 고도(≤ 7°), 칸 중앙값
    tops = []
    for a0 in np.arange(255.0, 308.0, 0.1):     # 0.1° 방위 칸(≈ 렌더 화소 열 0.085°) — 넓은 칸은 최대값을 위로 치우침
        col = sky & I.sil_defined & (az >= a0) & (az < a0 + 0.1)
        ref = col & (el >= 6.5) & (el <= 8.5)
        if ref.sum() < 3:
            continue
        thr = 0.6 * np.median(I.luma[ref])
        cand = col & (el <= 7) & (I.luma < thr)
        tops.append(float(el[cand].max()) if cand.any() else float(el[col].min()))
    out['D5'] = float(np.median(tops)) if tops else None
    out['D5_ncols'] = len(tops)
    if I.alpha is not None:   # 렌더: 알파 규칙(배치 점검의 판정 정의, §3.3) — 0.1° 칸마다 실루엣~9° 안 알파 ≥ 0.3 인 가장 높은 고도
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
    # 보고: 덮개·전체 하늘의 박명 색 비율(RULER-twilight-hue 정의)
    dk_all = sky & above & (az >= 236) & (az <= 300) & (el >= 6) & (el < 30)
    out['hue_deck'] = hue_fracs(I.rgb8[dk_all]) if dk_all.sum() > 30 else None
    out['hue_sky'] = hue_fracs(I.rgb8[sky & (el < 30)])
    if I.alpha is not None:   # 렌더 진단: 띠 구름/하늘(알파)
        cm = band & (I.alpha >= 0.5); km = band & (I.alpha < 0.1)
        out['D4s_render_alpha'] = (I.lmed(cm, 20) / max(I.lmed(km, 20), 0.5)) if (cm.sum() >= 20 and km.sum() >= 20) else None
    return out


def critic_mirror_P1(I):
    """비평 critic/mirror.py 그대로(질감 문턱 — 사진 전용, 재현 검사만; 판정은 기하 거울 D2)."""
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


# ---------------------------------------------------------------- P2 (R-B-deep E1~E8)
def grouped_median(vals, idx, n):
    """idx 칸마다 중앙값(칸 크기 > 3 만)."""
    o = np.argsort(idx, kind='stable'); iv = idx[o]; vv = vals[o]
    bounds = np.searchsorted(iv, np.arange(n + 1))
    med = np.full(n, np.nan); cnt = np.diff(bounds)
    for k in np.where(cnt > 3)[0]:
        med[k] = np.median(vv[bounds[k]:bounds[k + 1]])
    return med


def metrics_P2(I):
    az, el, sky = I.az, I.el, I.sky
    out = {}
    # E1·E2: 0.5° 방위 열(262~276, 해 방위 ±7)마다 0.05° 줄의 표시 luma 중앙 → 최대 줄, 그 아래·위로 처음 0.5 배 밑 줄
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
        if t is not None: tops.append(t)
        if d is not None: edges.append(d)
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
    # E5·E6: 같은 고도 칸 덮개 대 틈 — 분위 분할(사진·렌더 공통): 밝은 15 % = 틈, 어두운 50 % = 덮개
    out['E5q'], out['E6q'], out['E5a'], out['E6a'], out['E5_parts'] = [], [], [], [], []
    for lo, hi in P2_GAP_BINS:
        b = sky & (el >= lo) & (el < hi)
        q85, q50 = np.percentile(I.luma[b], 85), np.percentile(I.luma[b], 50)
        br = b & (I.luma >= q85); dk = b & (I.luma <= q50)
        rbb, rbd = I.RB(br), I.RB(dk)
        out['E5q'].append(rbd / rbb if (rbb and rbd) else None)
        out['E6q'].append(I.Ym(dk) / I.Ym(br) if (I.Ym(br) and I.Ym(dk)) else None)
        part = dict(el=[lo, hi], n=int(b.sum()), RB_bright=rbb, RB_dark=rbd)
        if I.alpha is not None:   # 렌더: 알파(구름 > 0.7, 하늘 < 0.2) — 판정 정의(§3.4)
            c = b & (I.alpha > 0.7); s = b & (I.alpha < 0.2)
            rc, rs = I.RB(c, 10), I.RB(s, 10)
            out['E5a'].append(rc / rs if (rc and rs) else None)
            out['E6a'].append(I.Ym(c, 10) / I.Ym(s, 10) if (rc and rs) else None)
            part.update(n_cloud=int(c.sum()), n_sky=int(s.sum()))
        out['E5_parts'].append(part)
    if I.alpha is not None:   # E7: 고도 칸마다 구름(알파 ≥ 0.5) / 하늘(알파 < 0.1) 표시 luma 중앙 < 1
        e7 = {}
        for lo, hi in P2_E7_BINS:
            b = sky & (el >= lo) & (el < hi)
            c = b & (I.alpha >= 0.5); s = b & (I.alpha < 0.1)
            if c.sum() >= 20 and s.sum() >= 20:
                e7[f'{lo}-{hi}'] = I.lmed(c, 20) / max(I.lmed(s, 20), 0.5)
        out['E7'] = e7
    out['hue_sky'] = hue_fracs(I.rgb8[sky])
    return out


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
    rbpx = I.lin[..., 0] / np.maximum(I.lin[..., 2], 1e-4)
    thr = 2.0 * float(np.median(rbpx[R['upper']])) if R['upper'].sum() >= 30 else None
    out['C2'] = float((rbpx[R['mid']] > thr).mean()) if (thr and R['mid'].sum() >= 30) else None
    out['C3r'] = rb['sheet'] / rb['ref'] if (rb['sheet'] and rb['ref']) else None   # 영역 정의(보고) — meas 0.93 과 정의 다름
    # C4: 먼 밭(1.25~4.25°)에서 화소 R/B ≥ 1.78 × 기준(4.25~5.15° 화소 R/B 중앙)인 '따뜻한' 화소의 R/B(평균 비) / 기준
    ref = float(np.median(rbpx[R['ref']])) if R['ref'].sum() >= 30 else None
    if ref:
        w = R['far'] & (rbpx >= 1.78 * ref)
        out['C4'] = (I.RB(w) / ref) if w.sum() >= 30 else 0.0
        out['C4_warm_frac'] = float(w.sum() / max(R['far'].sum(), 1))
        out['C4_ref_RBpx_median'] = ref
    else:
        out['C4'] = None
    # C5: 해 방위 ±3° 안 0.1° 줄 표시 luma 중앙의 최대 줄(0.95~8°)
    near = I.sky & (np.abs(daz(I.az, SUN['P3']['az'])) <= 3)
    cen = np.arange(0.95, 8.0, 0.1); prof = []
    for c in cen:
        mm = near & (I.el >= c - 0.05) & (I.el < c + 0.05)
        prof.append(float(np.median(I.luma[mm])) if mm.sum() > 10 else np.nan)
    prof = np.array(prof)
    out['C5'] = float(cen[int(np.nanargmax(prof))]) if np.isfinite(prof).any() else None
    out['C6'] = lm['glow'] / lm['upper'] if (lm['glow'] and lm['upper']) else None
    out['hue_sky'] = hue_fracs(I.rgb8[I.sky])
    return out


METRICS = {'P1': metrics_P1, 'P2': metrics_P2, 'P3': metrics_P3}


def p3_sensitivity(I):
    """선형 sRGB 대신 Display-P3 행렬(파일 ICC 대로)로 바꿨을 때 R/B 비의 비 변화(보고)."""
    lin2 = I.lin @ M_P3_TO_SRGB.T
    I2 = Img.__new__(Img); I2.__dict__.update(I.__dict__); I2.lin = np.clip(lin2, 0, None); I2.Y = I2.lin @ LUM
    return METRICS[I.pid](I2)


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


def cmd_photo(a):
    res = {'tool': 'tools/genus-ruler/tsun/tsun_photo.py', 'ruler': 'RULER-tsun.md (초안)', 'color': 'sRGB EOTF → 선형 sRGB(ICC 무시), Rec.709 가중',
           'sun_engine': SUN, 'photos': {}}
    for pid in ['P1', 'P2', 'P3']:
        I, path = load_photo(pid)
        h = sha256(path)
        got = METRICS[pid](I)
        if pid == 'P1':
            got['D2t'] = critic_mirror_P1(I)
        cmp_ = compare(pid, got)
        sens = p3_sensitivity(I)
        keys = {'P1': ['D1', 'D2_pooled_8_18', 'D3', 'D4'], 'P2': ['E3', 'E4', 'E5q', 'E6q', 'E8'], 'P3': ['C1', 'C2', 'C4', 'C6']}[pid]
        res['photos'][pid] = dict(image=path, image_sha256=h, sha_ok=(h == PHOTOS[pid]['sha256']), geo=PHOTOS[pid]['geo'], geo_sha256=sha256(PHOTOS[pid]['geo']),
                                  downsample=PHOTOS[pid]['ds'], n_sky=int(I.sky.sum()), metrics=r3(got), cited=CITED[pid],
                                  repro=cmp_, repro_all_ok=all(r['ok'] for r in cmp_),
                                  p3_matrix_sensitivity={k: r3(sens.get(k)) for k in keys})
        print(f'== {pid} sha {"OK" if h == PHOTOS[pid]["sha256"] else "MISMATCH"}  sky px {int(I.sky.sum())}')
        for k in {'P1': ['D1', 'D2', 'D2_pooled_8_18', 'D2t', 'D3', 'D4', 'D5', 'hue_deck', 'hue_sky'],
                  'P2': ['E1', 'E2', 'E1_p10_p90', 'E2_p10_p90', 'E3', 'E4', 'E5q', 'E6q', 'E8', 'RB', 'luma_med', 'hue_sky'],
                  'P3': ['C1', 'C2', 'C3r', 'C4', 'C4_warm_frac', 'C5', 'C6', 'RB', 'hue_sky']}[pid]:
            print(f'   {k:16s} {json.dumps(r3(got.get(k)))}')
        print('   P3-matrix sensitivity', json.dumps(res['photos'][pid]['p3_matrix_sensitivity']))
        for r in cmp_:
            print(f"   repro {r['metric']}[{r['i']}] critic {r['critic']} tool {r['tool']} dev {r.get('dev')} tol {r.get('tol')} {'ok' if r['ok'] else 'MISMATCH'}")
    out = a.out or os.path.join(HERE, 'tsun-photo.json')
    json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
    print('wrote', out)


def cmd_render(a):
    cam = None
    if a.cam:
        v = [float(x) for x in a.cam.split(',')]
        cam = dict(az=v[0], el=v[1], vfov=v[2], roll=v[3] if len(v) > 3 else 0.0)
    alpha = a.alpha or (a.png[:-4] + '.alpha.png' if a.png.endswith('.png') else None)
    I = load_render(a.pid, a.png, alpha, cam)
    got = METRICS[a.pid](I)
    rec = dict(pid=a.pid, png=a.png, png_sha256=sha256(a.png), alpha=alpha if (alpha and os.path.exists(alpha)) else None,
               cam=dict(RENDER_CAM[a.pid], **(cam or {})), metrics=r3(got))
    if a.out:
        json.dump(rec, open(a.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(rec, ensure_ascii=False)[:4000])
    return rec


# ---------------------------------------------------------------- 판정(§4) — 절대 규칙 + 기준 대비 나빠지지 않음
def _num(x):
    return x if isinstance(x, (int, float)) else None


def judge_one(pid, photo, cand, base=None):
    """RULER-tsun §4 의 규칙. 반환: {지표: {verdict, …}}. verdict ∈ pass / fail / na."""
    P = photo['photos'][pid]['metrics']; C = cand['metrics']; B = base['metrics'] if base else None
    V = {}

    def put(k, ok, **kw):
        V[k] = dict(verdict='na' if ok is None else ('pass' if ok else 'fail'), **kw)
    if pid == 'P1':
        d1 = C.get('D1') or []
        put('D1', None if (len(d1) < 4 or any(v is None for v in d1)) else all(v >= 1.3 for v in d1), cand=d1, rule='모든 칸 ≥ 1.3', role='관문')
        d3, p3 = C.get('D3') or [], P['D3']
        ok3 = None if (len(d3) < 4 or any(v is None for v in d3)) else all(abs(math.log(c / p)) <= math.log(1.5) for c, p in zip(d3, p3))
        put('D3', ok3, cand=d3, photo=p3, rule='칸마다 사진 ×/÷ 1.5', role='부(보고)')
        if B and B.get('D3'):
            nr = all(abs(math.log(c / p)) <= abs(math.log(b / p)) + 0.05 for c, b, p in zip(d3, B['D3'], p3)) if ok3 is not None else None
            put('D3_nr', nr, rule='칸마다 |ln(E/사진)| ≤ |ln(B/사진)| + 0.05', role='가드')
        d4 = _num(C.get('D4'))
        put('D4_abs', None if d4 is None else (d4 < 1 and abs(d4 - P['D4']) <= 0.10), cand=d4, photo=P['D4'], rule='< 1 그리고 사진 ± 0.10', role='부(보고)')
        if B and _num(B.get('D4')) is not None and d4 is not None:
            put('D4_nr', abs(d4 - P['D4']) <= abs(B['D4'] - P['D4']) + 0.03, rule='|E − 사진| ≤ |B − 사진| + 0.03', role='가드')
        d5 = _num(C.get('D5a')) if C.get('D5a') is not None else _num(C.get('D5'))   # 렌더는 알파 규칙(§3.3)
        put('D5', None if d5 is None else abs(d5 - P['D5']) <= 0.5, cand=d5, photo=P['D5'], rule='사진(휘도 규칙) ± 0.5°, 렌더는 알파 규칙', role='장면 점검')
        put('D2', None if _num(C.get('D2_pooled_8_18')) is None else C['D2_pooled_8_18'] >= 1.3, cand=C.get('D2_pooled_8_18'), rule='≥ 1.3', role='보고')
    if pid == 'P2':
        e5 = C.get('E5a') or []; e5q = C.get('E5q') or []
        ok = None if (len(e5) < 2 or any(v is None for v in e5)) else all(v >= 1.0 for v in e5)
        okq = None if (len(e5q) < 2 or any(v is None for v in e5q)) else all(v >= 1.0 for v in e5q)
        v = None if ok is None else (ok and (okq is not False))   # 알파·분위 부호가 엇갈리면 통과 아님(§4.1)
        put('E5', v, cand_alpha=e5, cand_quantile=e5q, rule='두 칸 모두 ≥ 1.0 (알파 정의), 분위 정의와 부호 일치', role='관문')
        e6 = C.get('E6a') or []
        put('E6', None if (len(e6) < 2 or any(x is None for x in e6)) else all(x >= 0.08 for x in e6), cand=e6, rule='두 칸 모두 ≥ 0.08', role='부(보고)')
        if B and B.get('E6a') and e6 and all(x is not None for x in e6 + B['E6a']):
            put('E6_nr', all(c >= b * 0.95 for c, b in zip(e6, B['E6a'])), rule='칸마다 E ≥ 0.95 × B', role='가드')
        e7 = C.get('E7') or {}
        put('E7', None if not e7 else all(x < 1.0 for x in e7.values()), cand=e7, rule='모든 칸 구름/하늘 < 1', role='가드')
        e8 = _num(C.get('E8'))
        put('E8_abs', None if e8 is None else e8 < 1.0, cand=e8, rule='< 1', role='보고(오늘 B 실패)')
        if B and _num(B.get('E8')) is not None and e8 is not None:
            put('E8_nr', e8 <= B['E8'] + 0.05, rule='E ≤ B + 0.05', role='가드')
        e3, e4 = _num(C.get('E3')), _num(C.get('E4'))
        put('E3', None if e3 is None else 1.9 <= e3 <= 3.3, cand=e3, rule='[1.9, 3.3]', role='가드(B) / 보고(A)')
        put('E4', None if e4 is None else 3.0 <= e4 <= 5.1, cand=e4, rule='[3.0, 5.1]', role='가드(B) / 보고(A)')
        for k, c0 in [('E1', 2.3), ('E2', 3.8)]:
            x = _num(C.get(k))
            put(k, None if x is None else abs(x - c0) <= 0.35, cand=x, rule=f'{c0} ± 0.35°', role='장면 점검')
    if pid == 'P3':
        c1, c2, c4, c5 = _num(C.get('C1')), _num(C.get('C2')), _num(C.get('C4')), _num(C.get('C5'))
        put('C1', None if c1 is None else c1 >= 2.5, cand=c1, rule='≥ 2.5', role='관문')
        put('C2', None if c2 is None else c2 >= 0.2, cand=c2, rule='≥ 0.2', role='관문')
        put('C4', None if c4 is None else c4 >= 3.0, cand=c4, rule='≥ 3', role='부(보고)')
        put('C5', None if c5 is None else abs(c5 - P['C5']) <= 0.3, cand=c5, photo=P['C5'], rule='사진 ± 0.3°', role='부(보고)')
        if B and _num(B.get('C5')) is not None and c5 is not None:
            put('C5_nr', abs(c5 - P['C5']) <= abs(B['C5'] - P['C5']) + 0.1, rule='|E − 사진| ≤ |B − 사진| + 0.1°', role='가드')
    return V


def cmd_judge(a):
    photo = json.load(open(a.photo))
    cands = [json.load(open(p)) for p in a.cand]
    bases = {json.load(open(p))['pid']: json.load(open(p)) for p in (a.base or [])}
    out = {}
    for c in cands:
        out[c['png']] = judge_one(c['pid'], photo, c, bases.get(c['pid']))
        print(c['png'])
        for k, v in out[c['png']].items():
            print(f"   {k:8s} {v['verdict']:4s} {v.get('role', '')}  {json.dumps({kk: vv for kk, vv in v.items() if kk not in ('verdict', 'role')}, ensure_ascii=False)}")
    if a.out:
        json.dump(out, open(a.out, 'w'), indent=1, ensure_ascii=False)


BASELINE = {   # 비평 렌더(scratchpad) — '오늘 기준'(판정 아님). P1 은 §173 고침 전 번들(5ced8b1) + 미리 민 고리.
    'P1': [SCR + '/rend/out/R1/P1_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'B_s25_ps_r100', 'B_s4_ps_r100']],
    'P2': [SCR + '/heda/rend2/out/P2/P2_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'A_t0x_ps_r400', 'A_t0_obs_r100']],
    'P3': [SCR + '/heda/rend2/out/P3/P3_' + s + '.png' for s in
           ['B_t0x_obs_r100', 'B_t0x_ps_r100', 'B_t0x_obs_r400', 'B_t0x_ps_r400', 'A_t0x_obs_r100', 'A_t0x_ps_r100', 'A_t0_obs_r100']],
}


def cmd_baseline(a):
    res = {}
    for pid, lst in BASELINE.items():
        for png in lst:
            if not os.path.exists(png):
                res[os.path.basename(png)] = 'missing'; continue
            I = load_render(pid, png, png[:-4] + '.alpha.png')
            res[os.path.basename(png)[:-4]] = dict(pid=pid, png=png, png_sha256=sha256(png), metrics=r3(METRICS[pid](I)))
            print(os.path.basename(png), json.dumps({k: v for k, v in res[os.path.basename(png)[:-4]]['metrics'].items()
                                                     if k in ('D1', 'D2_pooled_8_18', 'D3', 'D4', 'D5', 'D4s_render_alpha', 'D5a', 'E1', 'E2', 'E3', 'E4', 'E5a', 'E5q', 'E6a', 'E6q', 'E7', 'E8',
                                                              'C1', 'C2', 'C3r', 'C4', 'C5', 'C6')}))
    out = a.out or os.path.join(HERE, 'tsun-baseline.json')
    json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
    print('wrote', out)


def _rgb_alpha(png):
    a = np.asarray(Image.open(png).convert('RGB')).astype(np.float64)
    ap_ = png[:-4] + '.alpha.png'
    al = np.asarray(Image.open(ap_).convert('L')).astype(np.float64) / 255.0 if os.path.exists(ap_) else None
    return a, al


def ra_unit(cand_png, ref_png):
    """§4.3 R-A 단위 지표: 구름 화소(두 팔 알파 ≥ 0.5, 어느 채널도 ≥ 250 아님)에서
       e = 중앙 |ln((Yc+ε)/(Yr+ε))|, b = 중앙 ln((Yc+ε)/(Yr+ε)), c = ln(RB_c / RB_r) (영역 평균 비), ε = 기준 구름 Y 중앙의 1 %."""
    c, ac = _rgb_alpha(cand_png); r, ar = _rgb_alpha(ref_png)
    if ac is None or ar is None or c.shape != r.shape:
        return dict(valid=False, why='alpha 없음 또는 크기 다름')
    m = (ac >= 0.5) & (ar >= 0.5) & (c.max(-1) < 250) & (r.max(-1) < 250)
    if m.sum() < 400:
        return dict(valid=False, why=f'구름 화소 {int(m.sum())} < 400', n=int(m.sum()))
    lc, lr = srgb_eotf(c[m]), srgb_eotf(r[m])
    Yc, Yr = lc @ LUM, lr @ LUM
    eps = 0.01 * float(np.median(Yr))
    d = np.log((Yc + eps) / (Yr + eps))
    rb = math.log((lc[:, 0].mean() / max(lc[:, 2].mean(), 1e-9)) / (lr[:, 0].mean() / max(lr[:, 2].mean(), 1e-9)))
    e, b = float(np.median(np.abs(d))), float(np.median(d))
    return dict(valid=True, n=int(m.sum()), e=round(e, 4), b=round(b, 4), c=round(rb, 4),
                pass_=bool(e <= 0.15 and abs(b) <= 0.10 and abs(rb) <= 0.10))


def cmd_ra(a):
    r = ra_unit(a.cand, a.ref)
    print(json.dumps(r))
    return r


def deck_RB_bins(png):
    """P1 덮개 상자(§3.3 D1 의 deck 영역)의 칸별 선형 R/B — 서쪽 흐림 반사실(§4.5)용."""
    I = load_render('P1', png, png[:-4] + '.alpha.png')
    ee = p1_edge(I.az)
    with np.errstate(invalid='ignore'):
        above = I.el > ee + 2
    return [I.RB(I.sky & (I.el >= lo) & (I.el < hi) & above & (I.az >= 236) & (I.az <= 300)) for lo, hi in P1_BINS]


def cmd_cf(a):
    """§4.5: g = ln(RB_deck(켬)/RB_deck(끔)) 를 칸마다. 통과 = 모든 칸에서 g_CF ≤ ln 1.1 그리고 (g_B > 0.1 인 칸에서) g_CF ≤ 0.5·g_B."""
    bon, boff, con, coff = (deck_RB_bins(p) for p in (a.b_on, a.b_off, a.cf_on, a.cf_off))
    gB = [math.log(x / y) if (x and y) else None for x, y in zip(bon, boff)]
    gC = [math.log(x / y) if (x and y) else None for x, y in zip(con, coff)]
    ok = all(g is not None for g in gC) and all(g <= math.log(1.1) for g in gC) and \
        all((gb is None or gb <= 0.1) or (gc <= 0.5 * gb) for gb, gc in zip(gB, gC))
    r = dict(bins=P1_BINS, gB=r3(gB, 4), gCF=r3(gC, 4), verdict='pass' if ok else 'fail',
             note='g_B ≤ 0.1 인 칸뿐이면 아치 빛이 B 에서 덮개를 붉히지 못한 것 — D1 이 먼저 실패함')
    print(json.dumps(r, ensure_ascii=False))
    return r


def cmd_diff(a):
    """§4.4·§4.1 화소 허용폭(RULER-grain G0(c) 와 같은 수): 평균 |Δ| ≤ 0.05/255 그리고 32 단계 넘는 화소 ≤ 0.5 %. --bytes 면 바이트 같음."""
    if a.bytes:
        same = open(a.a, 'rb').read() == open(a.b, 'rb').read()
        print(json.dumps(dict(byte_identical=same))); return
    x = np.asarray(Image.open(a.a).convert('RGB')).astype(np.int32); y = np.asarray(Image.open(a.b).convert('RGB')).astype(np.int32)
    d = np.abs(x - y)
    r = dict(mean_abs=round(float(d.mean()), 5), frac_gt32=round(float((d.max(-1) > 32).mean()), 5))
    r['pass_'] = r['mean_abs'] <= 0.05 and r['frac_gt32'] <= 0.005
    print(json.dumps(r))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('photo'); p.add_argument('--out')
    p = sp.add_parser('render'); p.add_argument('pid', choices=['P1', 'P2', 'P3']); p.add_argument('png'); p.add_argument('--alpha'); p.add_argument('--cam'); p.add_argument('--out')
    p = sp.add_parser('judge'); p.add_argument('--photo', required=True); p.add_argument('--cand', nargs='+', required=True); p.add_argument('--base', nargs='*'); p.add_argument('--out')
    p = sp.add_parser('baseline'); p.add_argument('--out')
    p = sp.add_parser('ra'); p.add_argument('cand'); p.add_argument('ref')
    p = sp.add_parser('cf'); p.add_argument('b_on'); p.add_argument('b_off'); p.add_argument('cf_on'); p.add_argument('cf_off')
    p = sp.add_parser('diff'); p.add_argument('a'); p.add_argument('b'); p.add_argument('--bytes', action='store_true')
    a = ap.parse_args()
    {'photo': cmd_photo, 'render': cmd_render, 'judge': cmd_judge, 'baseline': cmd_baseline, 'ra': cmd_ra, 'cf': cmd_cf, 'diff': cmd_diff}[a.cmd](a)
