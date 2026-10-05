"""
볼륨 하늘 아래 땅의 밝기·색(RULER-terrain-lit.md T1·T2).

  python3 tools/genus-ruler/genus/terrain-lit.py 그림.png [하늘 위 비율=0.40] [땅 아래 비율=0.30]

하늘 = 화면 위 40% 화소, 땅 = 아래 30% 화소. 땅/하늘 = 땅 휘도 중앙값 ÷ 하늘 휘도 중앙값(선형 sRGB 휘도),
땅 색 = 땅 화소 중앙 색의 G/R · B/R. 사진 쪽 값은 RULER 에 적은 Commons 사진 260장(같은 정의, 하늘·땅 경계만 사진의 하늘 비율로).
"""
import sys
import numpy as np
from PIL import Image


def lum(a):
    c = a / 255.0
    l = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]


def measure(path, top=0.40, bottom=0.30):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    H = a.shape[0]
    sky = a[: int(H * top)]
    gnd = a[int(H * (1 - bottom)):]
    ls, lg = np.median(lum(sky)), np.median(lum(gnd))
    gm = np.median(gnd.reshape(-1, 3), 0)
    return {'ground/sky': round(float(lg / max(1e-5, ls)), 3), 'G/R': round(float(gm[1] / max(1, gm[0])), 3),
            'B/R': round(float(gm[2] / max(1, gm[0])), 3), 'sky L': round(float(ls), 4), 'ground L': round(float(lg), 4)}


if __name__ == '__main__':
    a = sys.argv[1:]
    for p in [x for x in a if x.endswith('.png') or x.endswith('.jpg')]:
        print(p.split('/')[-1], measure(p))
