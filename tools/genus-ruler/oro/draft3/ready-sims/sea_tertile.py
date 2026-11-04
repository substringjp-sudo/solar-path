"""ready-validity: 판정 창(±90 km, 12 km 상자 15x15)에서 바다 상자의 몫과 h 삼분위 구성.
DEM(Terrarium) 만 읽음. MODIS·held 영상 없음. 사용: python3 -I sea_tertile.py <dem_dir> <dem-manifest.json>
"""
import sys, json, math
import numpy as np
from PIL import Image

dem_dir, man_path = sys.argv[1], sys.argv[2]
man = json.load(open(man_path))
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

out = {}
sub = 6  # 6x6 표본/6 km 칸(1 km)
for site, s in man["sites"].items():
    lat0, lon0, z = s["lat"], s["lon"], s["zoom"]
    offs = np.arange(-87, 88, 6.0)  # 30 칸 중심(km)
    H = np.zeros((30, 30)); SEA = np.zeros((30, 30))
    for i, yn in enumerate(offs):
        for j, xe in enumerate(offs):
            hs = []; sea = 0
            for a in range(sub):
                for b in range(sub):
                    dn = yn - 3 + (a + 0.5) * 6 / sub
                    de = xe - 3 + (b + 0.5) * 6 / sub
                    la = lat0 + dn / 111.32
                    lo = lon0 + de / (111.32 * math.cos(math.radians(lat0)))
                    e = elev(z, la, lo)
                    hs.append(max(e, 0.0)); sea += (e <= 0)
            H[i, j] = np.mean(hs); SEA[i, j] = sea / sub ** 2
    Hb = H.reshape(15, 2, 15, 2).mean(axis=(1, 3)).ravel()
    Sb = SEA.reshape(15, 2, 15, 2).mean(axis=(1, 3)).ravel()
    seabox = Sb > 0.5
    q1, q2 = np.quantile(Hb, [1 / 3, 2 / 3])
    low = Hb <= q1
    out[site] = {
        "boxes": int(Hb.size),
        "seaBoxShare(>half sea)": round(float(seabox.mean()), 3),
        "anySeaBoxShare": round(float((Sb > 0).mean()), 3),
        "hBoxMean_q1_q2_m": [round(float(q1), 1), round(float(q2), 1)],
        "lowTertileCount(<=q1)": int(low.sum()),
        "seaShareInLowTertile": round(float(seabox[low].mean()), 3),
        "hZeroBoxShare": round(float((Hb == 0).mean()), 3),
    }
    print(site, out[site], flush=True)
json.dump(out, open(sys.argv[3] if len(sys.argv) > 3 else "/dev/stdout", "w"), indent=1, ensure_ascii=False)
