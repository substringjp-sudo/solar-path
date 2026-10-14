#!/usr/bin/env python3
"""
state-compare.py — state-hash.js 출력 두 개를 장면별·필드별로 견줍니다(§136 G3, §137 HB).
  python3 state-compare.py A.json B.json [--map-prefix P0:H1] [--ice ci_200,ci_110,ci_20,halo_0,seoul]
  --map-prefix X:Y   A 의 이름 X_<장면> 을 B 의 Y_<장면> 과 짝짓기(없으면 이름이 같아야 함)
  --ice 목록          얼음 층이 있는 장면 — 이름 끝(<장면>_<방위>, 또는 seoul·tw1734 처럼 방위 없는 이름)이 목록에 있으면 달라야 하고, 달라도 되는 필드는
                     clouds.shader · clouds.uniforms · clouds.perUniform 의 genusHalo/genusPowderW/genusPhysOn 뿐. 목록에 없는 장면은 모든 필드가 같아야 함.
종료 코드 0 = 기대대로.
"""
import sys, json

args = sys.argv[1:]
def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
mp = opt('--map-prefix'); ice = set((opt('--ice') or '').split(',')) - {''}
A = json.load(open(args[0])); B = json.load(open(args[1]))
EXPECTED = {'clouds.shader', 'clouds.uniforms', 'clouds.perUniform.genusHalo', 'clouds.perUniform.genusPowderW', 'clouds.perUniform.genusPhysOn'}

def diff(a, b):
    d = []
    for f in a:
        if f.endswith('.perUniform'):
            for u in sorted(set(a[f]) | set(b[f])):
                if a[f].get(u) != b[f].get(u): d.append(f + '.' + u)
        elif a[f] != b[f]: d.append(f)
    return d

bad = 0; same = []; changed = []
for k, a in A.items():
    kb = k
    if mp:
        x, y = mp.split(':')
        if k.startswith(x + '_'): kb = y + k[len(x):]
    b = B.get(kb)
    if b is None: print('missing', kb); bad += 1; continue
    scene = k.split('_', 1)[1]
    is_ice = scene in ice or scene.rsplit('_', 1)[0] in ice or scene in {s.rsplit('_', 1)[0] for s in ice}
    d = diff(a, b)
    if not d: same.append(scene)
    else: changed.append((scene, d))
    if is_ice:
        if not d or not set(d) <= EXPECTED: bad += 1; print('FAIL 얼음 장면', scene, '— 달라야 하고 기대한 필드만:', d)
    elif d:
        bad += 1; print('FAIL', scene, '— 같아야 하는데 다름:', d)
print('장면 %d: 같음 %d, 다름 %d, 위반 %d' % (len(A), len(same), len(changed), bad))
print('다른 장면:', {s: ('+%d 필드' % len(d)) for s, d in changed})
sys.exit(0 if bad == 0 else 1)
