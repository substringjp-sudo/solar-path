# measure-photo-cells.py — 사진 하늘의 구름 조각 크기 · 가로 주기를 잰다(계획 문서 §24.9). 사용: python3 -I measure-photo-cells.py 사진(2000×1500로 줄인 것) [가로 화각°]
# 구름 = 주변(±45 px)보다 밝거나 더 따뜻한 곳(국소 대비). 하늘 행 0..650, 지평선 y≈1000 은 이번 사진 기준 값이라 다른 사진은 고쳐서 씁니다.
import sys, numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
H, W, _ = im.shape
sky = im[0:650]                      # 건물·가로등 위 하늘만
r, g, b = sky[..., 0], sky[..., 1], sky[..., 2]
# 구름 = 파란 하늘보다 덜 파랗다(r − b 가 큼). 하늘 행마다 배경이 다르므로 행별 중앙값으로 문턱.
L = 0.3 * r + 0.55 * g + 0.15 * b
warm = r - b
def blur(a, k):
    # 상자 흐림(적분 영상) — 배경 밝기
    p = np.pad(a, k, mode='edge'); c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = 2 * k + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)
bgL, bgW = blur(L, 45), blur(warm, 45)
# 구름 = 주변보다 밝거나 더 따뜻한 곳(국소 대비) — 구름 사이 회청색 틈을 하늘로
mask = ((L - bgL) + 0.6 * (warm - bgW)) > 1.5
Image.fromarray((mask * 255).astype(np.uint8)).save('photo_mask.png')
print('size', W, H, 'sky rows 0..650, cloud frac', round(mask.mean(), 3))
# 가로 방향 1-D 스펙트럼(원근 축소가 작은 방향): 띠마다 봉우리 주기(px)
HFOV = float(sys.argv[2]) if len(sys.argv) > 2 else 73.0
ppd = W / HFOV
horizon_y = 1000
for (y0, y1) in [(0, 200), (200, 400), (400, 650)]:
    band = mask[y0:y1].astype(np.float32)
    band = band - band.mean(axis=1, keepdims=True)
    F = np.abs(np.fft.rfft(band, axis=1)) ** 2
    P = F.mean(axis=0)
    k = np.arange(len(P))
    valid = (k >= 3) & (W / np.maximum(k, 1) >= 6)
    kp = k[valid][np.argmax(P[valid] * k[valid])]   # 둘레 가중(에너지 per log k)
    period_px = W / kp
    el = (horizon_y - (y0 + y1) / 2) / ppd
    ang = period_px / ppd
    out = [f'band y{y0}-{y1}: 앙각 약 {el:.0f}°, 주기 {period_px:.0f}px = {ang:.2f}°']
    for h in (2.0, 3.0, 4.0):
        rng = h / np.sin(np.radians(max(el, 1)))
        out.append(f'고도 {h:.0f}km→ {np.radians(ang) * rng:.2f} km')
    print('  '.join(out))
# 조각(4-이웃) 크기: 각도 지름 분포
from collections import deque
lab = -np.ones(mask.shape, int); sizes = []
Hm, Wm = mask.shape
for y in range(0, Hm):
    for x in range(0, Wm):
        if mask[y, x] and lab[y, x] < 0:
            q = deque([(y, x)]); lab[y, x] = len(sizes); c = 0
            while q:
                yy, xx = q.popleft(); c += 1
                for ny, nx in ((yy+1, xx), (yy-1, xx), (yy, xx+1), (yy, xx-1)):
                    if 0 <= ny < Hm and 0 <= nx < Wm and mask[ny, nx] and lab[ny, nx] < 0:
                        lab[ny, nx] = len(sizes); q.append((ny, nx))
            sizes.append(c)
s = np.array(sizes); big = s[s >= 50]
print('조각 수(≥50px)', len(big), ' 가장 큰 조각 몫', round(s.max() / s.sum(), 3), ' 각지름 중앙값', round(2 * np.sqrt(np.median(big) / np.pi) / ppd, 2), '°')
A = np.sort(big)[::-1]; xs = np.log(A); ys = np.log(np.arange(1, len(A) + 1))
print('크기 분포 β', round(-np.polyfit(xs, ys, 1)[0], 2))
