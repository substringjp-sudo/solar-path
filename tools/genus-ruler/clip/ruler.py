# 미리 정한 기준(genus/RULER.md)으로 판정: python ruler.py 종류=파일패턴(방향은 {az}) ...
# 예: python ruler.py "Cu=../proto/ctl-Cu-{az}.png" "AcCc=../proto/ctl-Ac-{az}.png"
import json, sys, numpy as np
sys.path.insert(0, '.'); from judge import *
R = json.load(open('photo-ruler.json')); AZ = [200, 110, 20]
names, C = class_embeds('genus'); _, Cr = class_embeds('real'); _, Cv = class_embeds('volume')
for arg in sys.argv[1:]:
    g, pat = arg.split('=', 1); files = [pat.format(az=a) for a in AZ]
    E = embed_images([Image.open(f) for f in files], [0.78] * 3)
    P = probs(E, C); Pr = probs(E, Cr)[:, 0]; Pv = probs(E, Cv)[:, 0]; j = names.index(g)
    hits = int((P.argmax(1) == j).sum()); own = float(np.median(P[:, j]))
    j1 = hits >= 2 and own >= R[g]['own'][0]; j2 = float(np.median(Pr)) >= 0.5
    j3 = None if g in ('AcCc', 'Ci') else float(np.median(Pv)) >= R[g]['big'][0]
    pred = ','.join(names[k] for k in P.argmax(1))
    f = lambda b: '—' if b is None else ('통과' if b else '불합격')
    print('%-5s 판정[%s] 자기확률 %.2f(문턱 %.2f) J1 %s | 사진같음 %.2f J2 %s | 큰부피 %.2f(문턱 %.2f) J3 %s' % (
        g, pred, own, R[g]['own'][0], f(j1), float(np.median(Pr)), f(j2), float(np.median(Pv)), R[g]['big'][0], f(j3)))
