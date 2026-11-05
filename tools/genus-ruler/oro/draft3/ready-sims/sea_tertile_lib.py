"""ready-validity: 판정 창(±90 km, 12 km 상자 15x15)에서 바다 상자의 몫과 h 삼분위 구성.
DEM(Terrarium) 만 읽음. MODIS·held 영상 없음. 사용: python3 -I sea_tertile.py <dem_dir> <dem-manifest.json>
"""
import sys, json, math
import numpy as np
from PIL import Image

cache = {}

def tile(z, x, y):
    k = (z, x, y)
    if k not in cache:
        a = np.asarray(Image.open(f"{dem_dir}/{z}_{x}_{y}.png").convert("RGB"), dtype=np.float64)
        cache[k] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return cache[k]

def elev(z, lat, lon):
    n = 2 ** z
    xf = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    yf = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256
    tx, ty = int(xf // 256), int(yf // 256)
    px, py = int(xf - tx * 256), int(yf - ty * 256)
    return tile(z, tx, ty)[py, px]

