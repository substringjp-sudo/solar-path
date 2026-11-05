"""ready-validity: 6 km 칸 평균 h = 0 이 셋 이상인 상자 = 바다 상자(§4.6 해안 나눔 꼴). 삼분위 배정 두 꼴(값 경계 ≤ / 순위 등분)의 차.
DEM 만(MODIS 없음). 사용: python3 -I tie_check.py <dem_dir> <dem-manifest.json> <out.json>"""
import sys, json, math, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import sea_tertile_lib as L
L.dem_dir = sys.argv[1]
man = json.load(open(sys.argv[2]))
out = {}
for site, s in man["sites"].items():
    lat0, lon0, z = s["lat"], s["lon"], s["zoom"]
    offs = np.arange(-87, 88, 6.0); sub = 6
    H = np.zeros((30, 30))
    for i, yn in enumerate(offs):
        for j, xe in enumerate(offs):
            hs = []
            for a in range(sub):
                for b in range(sub):
                    la = lat0 + (yn - 3 + (a + .5)) / 111.32
                    lo = lon0 + (xe - 3 + (b + .5)) / (111.32 * math.cos(math.radians(lat0)))
                    hs.append(max(L.elev(z, la, lo), 0.0))
            H[i, j] = np.mean(hs)
    Hb = H.reshape(15, 2, 15, 2).mean(axis=(1, 3)).ravel()
    zc = (H == 0).reshape(15, 2, 15, 2).sum(axis=(1, 3)).ravel()
    sea = zc >= 3
    q1, q2 = np.quantile(Hb, [1/3, 2/3])
    tv = np.where(Hb <= q1, 0, np.where(Hb <= q2, 1, 2))
    order = np.argsort(Hb, kind="stable"); tr = np.empty(225, int); tr[order] = np.minimum(np.arange(225) * 3 // 225, 2)
    out[site] = {
        "seaBox(>=3 of 4 cells h=0)": int(sea.sum()),
        "value-cut low tertile n / sea share": [int((tv == 0).sum()), round(float(sea[tv == 0].mean()), 2)],
        "rank-cut low n / sea share": [int((tr == 0).sum()), round(float(sea[tr == 0].mean()), 2)],
        "rank-cut mid sea share": round(float(sea[tr == 1].mean()), 2),
        "boxes whose tertile differs between the two cuts": int((tv != tr).sum()),
    }
    print(site, out[site], flush=True)
json.dump(out, open(sys.argv[3], "w"), indent=1, ensure_ascii=False)
