"""§179 WP5 — src/components/VolumetricProbe/archQuad.ts 의 파이썬 거울(같은 상수·같은 순서·같은 식). numpy 없음(math 만).

CPU 계약 적분기(archcpu.py)가 노드·가중치·옥타브 합을 여기서 가져옵니다. archquad-test.mjs 가 TS 쪽과 이 파일을 같은 입력으로 돌려
1e-12(상대) 안에서 같음을 확인합니다. 식과 결정(D-q1 정확한 띠 입체각 · D-q2 세 가지 세기)은 archQuad.ts 머리말이 원본.

  python3 -I archquad.py --selftest-json in.json   # archquad-test.mjs 가 부르는 대조 입구(입력 JSON → 결과 JSON 을 표준 출력으로)
"""
import math, json, sys

ARCH_QUAD_MARK = '§179'
ARCH_BOTTOM_RADIUS_KM = 6360.0
ARCH_GL2_FRACTIONS = ((3 - math.sqrt(3)) / 6, (3 + math.sqrt(3)) / 6)
ARCH_AZ_NODES_DEG = (-20.0, 0.0, 20.0)
ARCH_AZ_NODE_WIDTH_DEG = 20.0
ARCH_AZ_HALF_WIDTH_DEG = 30.0
ARCH_OCTAVES = 8
ARCH_OCTAVE_ATTENUATION = 0.5
ARCH_PHASE = dict(g1=0.7, g2=-0.2, mix=0.5)
ARCH_GROUPS = 2
ARCH_NODE_COUNT = ARCH_GROUPS * len(ARCH_AZ_NODES_DEG)
DEG = math.pi / 180


def arch_dip_rad(height_km, bottom_radius_km=ARCH_BOTTOM_RADIUS_KM):
    return math.acos(min(1.0, max(0.0, bottom_radius_km / (bottom_radius_km + max(0.0, height_km)))))


def arch_band_solid_angle(dip_rad, az_width_rad=2 * ARCH_AZ_HALF_WIDTH_DEG * DEG):
    return math.sin(dip_rad) * az_width_rad


def arch_nodes(dip_rad, fractions=ARCH_GL2_FRACTIONS):
    d_omega = (math.sin(dip_rad) / 2) * (ARCH_AZ_NODE_WIDTH_DEG * DEG)
    out = []
    for g in range(ARCH_GROUPS):
        for j, az in enumerate(ARCH_AZ_NODES_DEG):
            out.append(dict(group=g, az=j, elevationRad=-fractions[g] * dip_rad, azimuthRad=az * DEG, dOmega=d_omega))
    return out


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a):
    l = math.hypot(a[0], a[1], a[2])
    return [a[0] / l, a[1] / l, a[2] / l]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def arch_tangent_frame(up, row_axis):
    n = _norm(up)
    k = _dot(n, row_axis)
    a = _norm([row_axis[0] - n[0] * k, row_axis[1] - n[1] * k, row_axis[2] - n[2] * k])
    return n, a, _cross(n, a)


def arch_node_direction(node, up, row_axis):
    n, a, b = arch_tangent_frame(up, row_axis)
    ce, se = math.cos(node['elevationRad']), math.sin(node['elevationRad'])
    ca, sa = math.cos(node['azimuthRad']), math.sin(node['azimuthRad'])
    return [ce * (ca * a[i] + sa * b[i]) + se * n[i] for i in range(3)]


def arch_mid_direction(up, row_axis, dip_rad):
    return arch_node_direction(dict(elevationRad=-0.5 * dip_rad, azimuthRad=0.0), up, row_axis)


def henyey_greenstein(g, cos_theta):
    return (1 - g * g) / (4 * math.pi * max(1e-7, math.pow(1 + g * g - 2 * g * cos_theta, 1.5)))


def arch_phase(cos_theta, attenuation=1.0):
    p = ARCH_PHASE
    return (1 - p['mix']) * henyey_greenstein(p['g1'] * attenuation, cos_theta) + p['mix'] * henyey_greenstein(p['g2'] * attenuation, cos_theta)


def takram_multiple_scattering(optical_depth, cos_theta, octaves=ARCH_OCTAVES):
    a = b = c = 1.0
    s = 0.0
    for _ in range(octaves):
        s += a * math.exp(-optical_depth * b) * arch_phase(cos_theta, c)
        a *= ARCH_OCTAVE_ATTENUATION; b *= ARCH_OCTAVE_ATTENUATION; c *= ARCH_OCTAVE_ATTENUATION
    return s


def arch_octave_cache(nodes, radiance, cos_view):
    if len(radiance) != len(nodes) or len(cos_view) != len(nodes):
        raise ValueError('archquad: radiance/cosView length must equal node count')
    C = [[0.0, 0.0, 0.0] for _ in range(ARCH_GROUPS * ARCH_OCTAVES)]
    for k, nd in enumerate(nodes):
        L = radiance[k]
        ai = 1.0
        for i in range(ARCH_OCTAVES):
            w = ai * arch_phase(cos_view[k], ai) * nd['dOmega']
            c = C[nd['group'] * ARCH_OCTAVES + i]
            c[0] += w * L[0]; c[1] += w * L[1]; c[2] += w * L[2]
            ai *= ARCH_OCTAVE_ATTENUATION
    return C


def arch_attenuated_sum(C, tau_mid, own, rest, no_t=False):
    s = [0.0, 0.0, 0.0]
    for g in range(ARCH_GROUPS):
        r = 0.0 if no_t else rest[g]
        bi = 1.0
        for i in range(ARCH_OCTAVES):
            f = math.exp(-bi * (tau_mid + own[g]) - r)
            c = C[g * ARCH_OCTAVES + i]
            s[0] += c[0] * f; s[1] += c[1] * f; s[2] += c[2] * f
            bi *= ARCH_OCTAVE_ATTENUATION
    return s


def arch_contract_sums(nodes, radiance, cos_view):
    C = arch_octave_cache(nodes, radiance, cos_view)
    raw = [0.0, 0.0, 0.0]; phase = [0.0, 0.0, 0.0]; octave = [0.0, 0.0, 0.0]
    for k, nd in enumerate(nodes):
        for c in range(3):
            raw[c] += radiance[k][c] * nd['dOmega']
    for g in range(ARCH_GROUPS):
        for i in range(ARCH_OCTAVES):
            v = C[g * ARCH_OCTAVES + i]
            for c in range(3):
                octave[c] += v[c]
                if i == 0:
                    phase[c] += v[c]
    return dict(raw=raw, phase=phase, octave=octave)


def selftest(inp):
    """archquad-test.mjs 대조: 입력 사례마다 TS 와 같은 계산을 해서 돌려줌."""
    out = []
    for case in inp['cases']:
        dip = arch_dip_rad(case['heightKm'])
        nodes = arch_nodes(dip)
        dirs = [arch_node_direction(nd, case['up'], case['rowAxis']) for nd in nodes]
        cosv = [_dot(d, case['rayDir']) for d in dirs]
        C = arch_octave_cache(nodes, case['radiance'], cosv)
        S = arch_attenuated_sum(C, case['tauMid'], case['own'], case['rest'], case.get('noT', False))
        sums = arch_contract_sums(nodes, case['radiance'], cosv)
        out.append(dict(dip=dip, band=arch_band_solid_angle(dip), nodes=nodes, dirs=dirs, cosView=cosv, C=C, S=S, sums=sums,
                        mid=arch_mid_direction(case['up'], case['rowAxis'], dip),
                        ms=[takram_multiple_scattering(t, c) for t, c in case['msProbe']]))
    return dict(consts=dict(gl2=list(ARCH_GL2_FRACTIONS), az=list(ARCH_AZ_NODES_DEG), azWidth=ARCH_AZ_NODE_WIDTH_DEG, azHalf=ARCH_AZ_HALF_WIDTH_DEG,
                            octaves=ARCH_OCTAVES, att=ARCH_OCTAVE_ATTENUATION, phase=ARCH_PHASE, bottom=ARCH_BOTTOM_RADIUS_KM), cases=out)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--selftest-json':
        json.dump(selftest(json.load(open(sys.argv[2]))), sys.stdout)
    else:
        print(__doc__)
