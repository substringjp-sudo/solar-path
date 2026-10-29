"""§179 WP5 — 사전 시험 analysis.py(sha256 7135df20befa…)에서 계약 적분에 필요한 기하만 떼어 옮긴 것(함수 본문은 글자 그대로).
옮긴 것: enu_vec · destination · Observer · directions. 뺀 것: 판(slab)·관측점 쪽 산란·결과 표(계약 밖).
좌표: 관측점 ENU(x 동 · y 북 · z 위), 원점 = 지구(구 R0 = 6360 km) 중심, 관측점은 (0, 0, R0 + h). 해 방향은 관측점 ENU 의 무한원 벡터.
"""
import math
import numpy as np
import luts as L
import sun as SUN

R0 = L.BOTTOM  # sphere of the atmosphere model (km); geometry and LUTs use the same sphere


def enu_vec(az_deg, el_deg):
    a, e = math.radians(az_deg), math.radians(el_deg)
    return np.array([math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e)])


def destination(lat, lon, bearing_deg, gamma):
    p1, l1, th = math.radians(lat), math.radians(lon), math.radians(bearing_deg)
    p2 = math.asin(math.sin(p1) * math.cos(gamma) + math.cos(p1) * math.sin(gamma) * math.cos(th))
    l2 = l1 + math.atan2(math.sin(th) * math.sin(gamma) * math.cos(p1), math.cos(gamma) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), math.degrees(l2)


class Observer:
    def __init__(self, name, lat, lon, h_km, ms):
        self.name, self.lat, self.lon, self.h, self.ms = name, lat, lon, h_km, ms
        self.sun_alt, self.sun_az = SUN.sun_position(ms, lat, lon)
        self.s = enu_vec(self.sun_az, self.sun_alt)
        self.O = np.array([0.0, 0.0, R0 + h_km])

    def sample_on_ray(self, az, el, h_deck):
        d = enu_vec(az, el)
        r = R0 + h_deck
        b = float(self.O @ d)
        c = float(self.O @ self.O) - r * r
        t = -b + math.sqrt(b * b - c)
        return self.sample(self.O + t * d, az)

    def sample_ground_distance(self, az, dist_km, h_deck):
        g = dist_km / R0
        up = np.array([0, 0, 1.0]); hor = enu_vec(az, 0.0)
        X = (R0 + h_deck) * (math.cos(g) * up + math.sin(g) * hor)
        return self.sample(X, az)

    def sample(self, X, az):
        O = self.O
        r = float(np.linalg.norm(X))
        dvec = (X - O) / np.linalg.norm(X - O)
        up = X / r
        gamma = math.acos(min(1.0, float(up @ np.array([0, 0, 1.0]))))
        el_obs = math.degrees(math.asin(float(dvec[2])))
        mu_s = float(up @ self.s)
        lat2, lon2 = destination(self.lat, self.lon, az, gamma)
        noaa_alt, noaa_az = SUN.sun_position(self.ms, lat2, lon2)
        return dict(X=X, r=r, h=r - R0, d=dvec, dist_slant=float(np.linalg.norm(X - O)), ground_dist=gamma * R0,
                    el_from_obs=el_obs, az=az, sun_alt_vector=math.degrees(math.asin(mu_s)), sun_alt_noaa=noaa_alt,
                    lat=lat2, lon=lon2, mu_s=mu_s)


def directions(smp, sunv, G):
    up = smp['X'] / smp['r']
    sh = sunv - (sunv @ up) * up
    e1 = sh / np.linalg.norm(sh)
    e2 = np.cross(up, e1)
    e, a = np.radians(G['el']), np.radians(G['az'])
    W = (np.cos(e) * np.cos(a))[:, None] * e1 + (np.cos(e) * np.sin(a))[:, None] * e2 + np.sin(e)[:, None] * up
    return W, up


# 사전 시험 표본점(사진 시각 · 관측점) — RULER-tsun §4.1 G-A 의 'P1 7.4 km × D1 네 칸 가운데 거리, P2 2.8 km × 두 칸'.
P1 = ('P1', 36.046, 136.278, (13.3 + 1.6) / 1000.0, SUN.P1_MS)
P2 = ('P2', 34.97342, 138.77713, 2.74 / 1000.0, SUN.P2_MS)
P1_AZ, P2_AZ = 275.3005669789342, 269.81
P1_BINS = {'6-10': 8.0, '10-15': 12.5, '15-20': 17.5, '20-30': 25.0}
P2_BINS = {'7.5-8.5': 8.0, '8.5-9.0': 8.75}
P1_H, P2_H = 7.4, 2.8
