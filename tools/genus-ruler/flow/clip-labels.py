#!/usr/bin/env python3
"""
clip-labels.py — CLIP J1 의 **라벨(argmax) 기준** 판정(§137 G1'·HC). 자기확률 0.05 차이는 방위 수 장에서 잡음이라(0.11~0.19 대) 라벨만 셉니다.
  python3 tools/genus-ruler/flow/clip-labels.py <종류> <파일패턴 {az}> <방위,방위,…>
  예: clip-labels.py Ci "out/P0_ci_{az}.png" 5,160,290
종류 AcCc 는 AcCc 만, Ci 는 권운족(Ci·Cs)을 맞는 것으로 셈. 출력: JSON 한 줄 {genus, az, pred, hits, own}.
clip/judge2.py 의 전처리·판정기를 그대로 씁니다(수정 없음).
"""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
CLIP = os.path.abspath(os.path.join(HERE, '../clip'))
sys.path.insert(0, CLIP)
os.chdir(CLIP)
from judge2 import *  # noqa: E402,F401  (class_embeds · embed_images · probs · Image)
g, pat, azs = sys.argv[1], sys.argv[2], [a for a in sys.argv[3].split(',')]
names, C = class_embeds('genus')
E = embed_images([Image.open(pat.format(az=a)) for a in azs], [0.78] * len(azs))
P = probs(E, C)
pred = [names[k] for k in P.argmax(1)]
ok = {'AcCc': {'AcCc'}, 'Ci': {'Ci', 'Cs'}, 'Sc': {'St', 'Sc', 'Ns', 'As'}}.get(g, {g})   # §139: Cu 는 자기 라벨, Sc 는 층 묶음
j = names.index(g)
print(json.dumps({'genus': g, 'az': azs, 'pred': pred, 'hits': int(sum(p in ok for p in pred)), 'own': [round(float(x), 3) for x in P[:, j]]}))
