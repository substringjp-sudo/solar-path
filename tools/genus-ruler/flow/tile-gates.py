#!/usr/bin/env python3
"""
tile-gates.py — RULER-flow(1회차 §2 타일 게이트, 값 불변)·RULER-flow2(§4 규칙 R·Q, §7 D 보정)를 기계적으로 적용합니다(§131).
  python3 tile-gates.py tile.json [--ref R0] [--gen gen.json]
tile.json = tile.py --out 결과({rows, pooled}). 행 이름 '<후보>_<장면>.s<씨앗>.L<k>'. --ref 후보와 칸(장면·층·씨앗·게이트)별로 견줍니다.
"""
import sys, json, re, math
from collections import defaultdict

D_BIAS = 0.135          # RULER-flow2 §7 1
SHEET = {'st', 'as', 'ns', 'cs'}
LAYER_GENUS = {('dev', 0): 'sc', ('dev', 1): 'ac', ('devv1', 0): 'sc', ('devv1', 1): 'ac', ('devv3', 0): 'sc', ('devv3', 1): 'ac',
               ('sc25', 0): 'sc', ('sc85', 0): 'sc', ('ac60', 0): 'ac', ('cu35', 0): 'cu', ('ci60', 0): 'ci', ('st50', 0): 'st'}
COVER = {('dev', 0): .23, ('dev', 1): .43, ('devv1', 0): .23, ('devv1', 1): .43, ('devv3', 0): .23, ('devv3', 1): .43,
         ('sc25', 0): .25, ('sc85', 0): .85, ('ac60', 0): .6, ('cu35', 0): .35, ('ci60', 0): .6, ('st50', 0): .5}

def ok(v, lo=-math.inf, hi=math.inf):
    return v == v and lo <= v <= hi

def gates(r, g, cover):
    """칸별 (이름, 통과, 상한 게이트인가) — 1회차 §2 그대로."""
    out = []
    if g not in SHEET:
        out.append(('T1 slope0.5-6', ok(r['slope_0.5_6km'], -3.3, -2.3), False))
    out.append(('T1 steepen<=2', ok(r['slope_0.5_6km'] - r['slope_0.14_0.5km'], hi=2.0), False))
    if cover <= 0.3:
        if g != 'ac': out.append(('T2 pieces<=15', ok(r['nPer100km2'], hi=15), True))
        out.append(('T2 largest>=0.4', ok(r['largestFrac'], lo=0.4), False))
        out.append(('T2 areaCV>=2.5', ok(r['areaCV'], lo=2.5), False))
        out.append(('T2 elongIQR>=1', ok(r['elongIQR'], lo=1.0), False))
        out.append(('T2 elongIQR<=3', ok(r['elongIQR'], hi=3.0), True))
        out.append(('T2 elongMed<=3', ok(r['elongMed'], hi=3.0), True))
        out.append(('T2 perim<=0.16', ok(r['perimPerArea'], hi=0.16), True))
    out.append(('T3 entropy', ok(r['dEntropyBits'], lo=2.5 if g == 'ac' else 2.8), True))
    out.append(('T3 thin', ok(r['thinFrac'], 0.25, 0.5), True))
    out.append(('T3 sat<=0.05', ok(r['satFrac'], hi=0.05), True))
    if g in ('sc', 'ac'):
        out.append(('T4 rise', ok(r['riseLenKm_edge'], lo=0.9 if g == 'sc' else 0.6), False))
    if g not in SHEET:
        out.append(('T5 orient>=3', ok(r['orientRatio'], lo=3), False))
        out.append(('T5 coh1km>=0.5', ok(r['coh1km'], lo=0.5), False))
    out.append(('T8 quad<=0.6', ok(r['quad12km'], hi=0.6), True))
    return out

def parse(name):
    m = re.match(r'^(.+?)_([a-z0-9]+)\.s(\d+)\.L(\d)$', name)
    return (m.group(1), m.group(2), int(m.group(3)), int(m.group(4))) if m else None

def main(argv):
    path = argv[0]; ref = None; gen = None
    if '--ref' in argv: ref = argv[argv.index('--ref') + 1]
    if '--gen' in argv: gen = json.load(open(argv[argv.index('--gen') + 1]))
    T = json.load(open(path)); rows, pooled = T['rows'], T['pooled']
    cells = defaultdict(dict)        # cand -> (scene, layer, seed, gate) -> pass
    upper = {}
    for name, r in rows.items():
        p = parse(name)
        if not p: continue
        c, s, seed, k = p
        if (s, k) not in LAYER_GENUS: continue
        g = LAYER_GENUS[(s, k)]
        for gname, passed, up in gates(r, g, COVER[(s, k)]):
            cells[c][(s, k, seed, gname)] = passed; upper[gname] = up
    for c in sorted(cells):
        print('== %s' % c)
        by = defaultdict(list)
        for (s, k, seed, gname), v in cells[c].items(): by[(s, k, gname)].append(v)
        lines = []
        for (s, k, gname), vs in sorted(by.items()):
            need = 4 if upper[gname] else 3
            lines.append('  %-7s L%d %-16s %d/4 %s' % (s, k, gname, sum(vs), '○' if sum(vs) >= min(need, len(vs)) else '×'))
        print('\n'.join(lines))
        # D_pa 풀링(보정)
        for key, v in sorted(pooled.items()):
            if key.startswith(c + '_'):
                D = v['D_pa']; Dh = D - D_BIAS if D == D else float('nan')
                print('  D_pa %-22s raw %s  D̂ %s (n %d) %s' % (key[len(c) + 1:], '%.3f' % D if D == D else 'nan', '%.3f' % Dh if Dh == Dh else 'nan', v['n'],
                      ('○' if 1.25 <= Dh <= 1.45 else '×') if Dh == Dh else '—'))
        if ref and c != ref and ref in cells:
            flips = [key for key, v in cells[ref].items() if v and key in cells[c] and not cells[c][key]]
            gains = [key for key, v in cells[ref].items() if not v and key in cells[c] and cells[c][key]]
            print('  vs %s: pass→fail %d %s' % (ref, len(flips), sorted(flips)[:12]))
            print('  vs %s: fail→pass %d %s' % (ref, len(gains), sorted(gains)[:12]))
    if gen:
        print('\n== core (s90 · hoursUsed · ms), devv1/dev/devv3')
        by = defaultdict(list)
        for name, row in gen.items():
            m = re.match(r'^(.+?)_(dev|devv1|devv3)\.s(\d+)$', name)
            if m: by[(m.group(1), m.group(2))].append((row.get('s90'), row.get('hoursUsed'), row.get('ms')))
        for (c, s), v in sorted(by.items()):
            s9 = [x[0] for x in v if x[0] is not None]; hu = [x[1] for x in v if x[1] is not None]; ms = [x[2] for x in v]
            print('  %-10s %-6s s90 %s  hours %s  ms %s' % (c, s, ' '.join('%.1f' % x for x in s9), ' '.join('%.2f' % x for x in hu), ' '.join(str(x) for x in ms)))

if __name__ == '__main__':
    main(sys.argv[1:])
