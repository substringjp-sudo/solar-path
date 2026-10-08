#!/usr/bin/env python3
"""skyl.py — RULER-flow2 §3 박명 하늘 밝기 skyL: 위 78 % 크롭, sRGB → 선형 → Rec.709 휘도의 중앙값(§131).
  python3 skyl.py a.png b.png …   (.alpha.png 는 건너뜀; 구름 불투명도 중앙값 cloudA 도 같이 적음)"""
import sys, os, numpy as np
from PIL import Image
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
for f in sys.argv[1:]:
    if f.endswith('.alpha.png'): continue
    a = np.asarray(Image.open(f).convert('RGB')).astype(np.float64) / 255.0
    h = int(round(a.shape[0] * 0.78)); a = lin(a[:h])
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    af = f[:-4] + '.alpha.png'; ca = float('nan')
    if os.path.exists(af): ca = float(np.median(np.asarray(Image.open(af).convert('L')).astype(np.float64)[:h] / 255.0))
    print('%-22s skyL %.5f  cloudAlpha_med %.3f' % (os.path.basename(f), float(np.median(L)), ca))
