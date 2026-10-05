# RULER2.md 판정: python ruler2.py 종류=파일패턴({az}) ...  예: "Cb=../proto2/g5-cb-{az}.png"
import json, sys, numpy as np
sys.path.insert(0, '.'); from judge2 import *
R = json.load(open('photo-ruler2.json')); AZ = [200, 110, 20]
names, C = class_embeds('genus')
GROUPS = [{'Ns', 'St', 'As', 'Sc'}, {'Cb', 'Cg'}]   # 사진 적중 < 0.4 인 종류는 같은 묶음으로 완화(RULER2 + Cb/Cg 추가, 렌더 점수 보기 전 사진 결과만 보고 정함)
for arg in sys.argv[1:]:
    g, pat = arg.split('=', 1)
    E = embed_images([Image.open(pat.format(az=a)) for a in AZ], [0.78] * 3); P = probs(E, C); j = names.index(g)
    pred = [names[k] for k in P.argmax(1)]; own = float(np.median(P[:, j])); hits = sum(p == g for p in pred)
    GROUP = next((G for G in GROUPS if g in G), set())
    relaxed = R[g]['acc'] < 0.4 and bool(GROUP)
    hits_r = sum((p in GROUP) for p in pred) if relaxed else hits
    j1 = hits_r >= 2 and own >= R[g]['own'][0]
    print('%-3s 판정[%s] 자기확률 %.2f(문턱 %.2f, 사진적중 %.2f%s) J1 %s' % (g, ','.join(pred), own, R[g]['own'][0], R[g]['acc'],
          ' · 묶음 완화' if relaxed else '', '통과' if j1 else '불합격'))
