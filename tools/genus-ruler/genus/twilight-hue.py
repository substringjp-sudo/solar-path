"""
박명 하늘의 자주·푸른 비율(RULER-twilight-hue.md).

  python3 tools/genus-ruler/genus/twilight-hue.py 그림.png [y0 y1 [x0 x1]]   # 표시값 그림, 잴 영역(화소)
  python3 tools/genus-ruler/genus/twilight-hue.py --horizon 그림.png         # 하네스 렌더: 지평선(맨 아래 검은 땅) 위 전체

자주 = G + 6 < R 이고 G + 6 < B, 푸른 = B > R + 6 이고 B >= G. 휘도 사분위·밝은/어두운 25% 의 중앙 색도 냅니다.
"""
import sys
import numpy as np
from PIL import Image


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def measure(px):
    R, G, B = px[:, 0], px[:, 1], px[:, 2]
    L = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B)
    q25, q50, q75 = np.quantile(L, [0.25, 0.5, 0.75])
    return {
        'n': int(len(px)),
        'magenta': float(np.mean((G + 6 < R) & (G + 6 < B))),
        'blue': float(np.mean((B > R + 6) & (B >= G))),
        'L': [round(float(q25), 4), round(float(q50), 4), round(float(q75), 4)],
        'hi': np.median(px[L >= q75], 0).astype(int).tolist(),
        'lo': np.median(px[L <= q25], 0).astype(int).tolist(),
    }


def sky_pixels(path, horizon=False, box=None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    if horizon:
        # 하네스 렌더는 지평선 아래가 거의 검은 땅입니다 — 맨 아래에서 위로 올라가며 줄 평균 휘도가 처음 넘는 줄 위를 하늘로.
        rowL = a.mean(axis=(1, 2))
        y = a.shape[0] - 1
        while y > 0 and rowL[y] < 6:
            y -= 1
        a = a[: max(1, y - 2)]
    elif box:
        y0, y1 = box[0], box[1]
        x0, x1 = (box[2], box[3]) if len(box) >= 4 else (0, a.shape[1])
        a = a[y0:y1, x0:x1]
    return a.reshape(-1, 3)


if __name__ == '__main__':
    args = sys.argv[1:]
    hz = args and args[0] == '--horizon'
    if hz:
        args = args[1:]
    for p in args if hz else args[:1]:
        box = [int(v) for v in args[1:]] if not hz and len(args) > 1 else None
        m = measure(sky_pixels(p, hz, box))
        print(f"{p.split('/')[-1]:28s} 자주 {m['magenta']:.2f}  푸른 {m['blue']:.2f}  L {m['L']}  밝은 {m['hi']} 어두운 {m['lo']}")
