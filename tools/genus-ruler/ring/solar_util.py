"""solar_util.py — 자(ruler) 공용: 태양 고도(근사), Haurwitz 맑은 하늘 GHI 와 그 **창 평균**(satelliteBias.ts clearSkyGHIMean 과 같은 규약),
Kasten–Czeplak 정방향 τ(운량 → 투과율; 역함수는 쓰지 않는다 — satelliteBias.ts 머리말)."""
import math
from datetime import datetime, timedelta, timezone

def sun_alt_deg(t: datetime, lat: float, lon: float) -> float:
    """태양 고도(°). t 는 UTC aware datetime. 적위·시간방정식 근사(±0.3°)."""
    doy = t.timetuple().tm_yday
    frac_h = t.hour + t.minute / 60 + t.second / 3600
    g = math.radians((360 / 365.25) * (doy - 1 + (frac_h - 12) / 24))
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    tst = frac_h * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    sin_alt = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1, min(1, sin_alt))))

def clear_sky_ghi(cos_z: float) -> float:
    """Haurwitz. cos_z = sin(고도)."""
    return 0.0 if cos_z <= 0 else 1098 * cos_z * math.exp(-0.059 / cos_z)

def clear_sky_ghi_mean(end: datetime, lat: float, lon: float, window_min=60, step_min=5) -> float:
    """끝 시각 end 의 직전 window 평균(Open-Meteo 일사가 '직전 1 h 평균' 이라 분모도 같은 창)."""
    s = 0.0; n = 0; m = window_min - step_min / 2
    while m > 0:
        alt = sun_alt_deg(end - timedelta(minutes=m), lat, lon)
        s += clear_sky_ghi(math.sin(math.radians(alt))); n += 1; m -= step_min
    return s / n if n else 0.0

def tau_from_cover(pct: float) -> float:
    """Kasten–Czeplak: τ = 1 − 0.75 (N/100)^3.4"""
    n = max(0.0, min(1.0, pct / 100.0))
    return 1 - 0.75 * n ** 3.4

def parse_utc(s: str) -> datetime:
    return datetime.strptime(s[:16], '%Y-%m-%dT%H:%M').replace(tzinfo=timezone.utc)

MIN_CLEAR_GHI = 226.0
MIN_SUN_ALT = 15.0
