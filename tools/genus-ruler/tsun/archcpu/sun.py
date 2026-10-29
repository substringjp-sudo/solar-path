"""Python port of src/utils/solarPosition.ts sunPosition (NOAA / Meeus low precision). Geometric altitude, no refraction."""
import math
RAD = math.pi/180; DAY_MS = 86400000.0; J1970 = 2440587.5; J2000 = 2451545.0
def julian(ms): return ms/DAY_MS + J1970
def equatorial(ms):
    T = (julian(ms)-J2000)/36525
    L0 = (((280.46646 + T*(36000.76983 + T*0.0003032)) % 360) + 360) % 360
    M = 357.52911 + T*(35999.05029 - 0.0001537*T)
    e = 0.016708634 - T*(0.000042037 + 0.0000001267*T)
    C = (math.sin(M*RAD)*(1.914602 - T*(0.004817 + 0.000014*T)) + math.sin(2*M*RAD)*(0.019993 - 0.000101*T)
         + math.sin(3*M*RAD)*0.000289)
    omega = 125.04 - 1934.136*T
    lam = L0 + C - 0.00569 - 0.00478*math.sin(omega*RAD)
    eps0 = 23 + (26 + (21.448 - T*(46.815 + T*(0.00059 - T*0.001813)))/60)/60
    eps = eps0 + 0.00256*math.cos(omega*RAD)
    dec = math.asin(math.sin(eps*RAD)*math.sin(lam*RAD))
    y = math.tan(eps*RAD/2)**2
    eot = (y*math.sin(2*L0*RAD) - 2*e*math.sin(M*RAD) + 4*e*y*math.sin(M*RAD)*math.cos(2*L0*RAD)
           - 0.5*y*y*math.sin(4*L0*RAD) - 1.25*e*e*math.sin(2*M*RAD))
    return dec, 4*eot/RAD
def js_mod(a, b):  # JS % semantics then +b %b
    r = math.fmod(a, b)
    return r
def hour_angle(ms, lng, eot):
    utMin = (math.fmod(math.fmod(ms/60000, 1440) + 1440, 1440))
    tst = math.fmod(math.fmod(utMin + eot + 4*lng, 1440) + 1440, 1440)
    return (tst/4 - 180)*RAD
def sun_position(ms, lat, lng):
    """returns (altitude_deg, compass_azimuth_deg)"""
    dec, eot = equatorial(ms)
    H = hour_angle(ms, lng, eot)
    phi = lat*RAD
    alt = math.asin(max(-1, min(1, math.sin(phi)*math.sin(dec) + math.cos(phi)*math.cos(dec)*math.cos(H))))
    az = math.atan2(math.sin(H), math.cos(H)*math.sin(phi) - math.tan(dec)*math.cos(phi))
    return alt/RAD, (az/RAD + 180) % 360
def ms_of(iso):
    import datetime
    return datetime.datetime.fromisoformat(iso).timestamp()*1000.0
# Photo epochs (JST)
P1_MS = ms_of('2026-10-02T18:22:21+09:00')
P2_MS = ms_of('2026-10-05T17:53:43.772+09:00')
P3_MS = ms_of('2026-10-05T17:14:28.847+09:00')
if __name__ == '__main__':
    for name, ms, lat, lon in [('P1', P1_MS, 36.046, 136.278), ('P2', P2_MS, 34.97342, 138.77713), ('P3', P3_MS, 34.97342, 138.77713)]:
        print(name, ms, sun_position(ms, lat, lon))
