# 렌더 판정: python score.py 기대종류:파일[:위쪽비율] ...
import json, numpy as np, sys
sys.path.insert(0, '.'); from judge import *
args = [a.split(':') for a in sys.argv[1:]]
imgs = [Image.open(a[1]) for a in args]; tops = [float(a[2]) if len(a) > 2 else 0.78 for a in args]
E = embed_images(imgs, tops)
names, C = class_embeds('genus'); P = probs(E, C)
_, Cr = class_embeds('real'); Pr = probs(E, Cr)
_, Cv = class_embeds('volume'); Pv = probs(E, Cv)
for i, a in enumerate(args):
    g = a[0]; row = ' '.join('%s %.2f' % (n, P[i, j]) for j, n in enumerate(names))
    print('%-22s 기대 %-4s → %-4s | %s | 사진같음 %.2f | 큰부피 %.2f' % (a[1].split('/')[-1], g, names[P[i].argmax()], row, Pr[i, 0], Pv[i, 0]))
