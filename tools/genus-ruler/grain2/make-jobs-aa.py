#!/usr/bin/env python3
"""make-jobs-aa.py — RULER-grain2 의 A/A 복제 잡(C0 를 잡음 씨앗만 바꿔 다시 그림).
  python3 tools/genus-ruler/grain2/make-jobs-aa.py <jobs-grain-R1.json> <out.json>
- 원본: RULER-grain 잡 목록의 C0 held-out F-std 잡 전부(이름 'C0__<장면>__<방위>__std'). 기본 잡음 씨앗 12345(capture.ts).
- AA777: 그 전부를 noiseSeed 777 로. AA4242: G3 장면(ac60·ci60 × e20·e45 × t·s·a)만 noiseSeed 4242 로.
- 이름 = 원본 이름 + '__AA777' | '__AA4242'. set = 'aa', round = -2. 그 밖의 필드(번들 기본값·입력·창·워밍)는 원본 그대로.
"""
import json, sys, copy
src, out = sys.argv[1], sys.argv[2]
jobs = json.load(open(src))
base = [j for j in jobs if j['arm'] == 'C0' and j['set'] == 'heldout' and j['frame'] == 'std' and j['name'].count('__') == 3]
G3 = {(l, t) for l in ('ac60', 'ci60') for t in ('e20', 'e45')}
res = []
for seed, tag, pick in ((777, 'AA777', lambda j: True), (4242, 'AA4242', lambda j: (j['layer'], j['time']) in G3)):
    for j in base:
        if not pick(j):
            continue
        k = copy.deepcopy(j)
        k['name'] = j['name'] + '__' + tag; k['set'] = 'aa'; k['round'] = -2
        k['grain'] = {**j['grain'], 'noiseSeed': seed}
        res.append(k)
json.dump(res, open(out, 'w'), indent=1)
print('base', len(base), 'aa jobs', len(res), {t: sum(1 for r in res if r['name'].endswith(t)) for t in ('AA777', 'AA4242')})
