# 사진 묶음 임베딩(한 번) — photo-metrics.js 와 같은 하늘 자르기.
import json, sys, numpy as np
sys.path.insert(0, '.'); from judge import *
G = '../genus/'; P = json.load(open(G + 'genus-photos.json')); S = json.load(open(G + 'selection.json'))
imgs, tops, lab = [], [], []
for g, sel in S.items():
    for idx, frac in sel.items():
        f = G + 'thumbs/%s/%03d.jpg' % (g, int(idx))
        if not f or not os.path.exists(f): continue
        imgs.append(Image.open(f)); tops.append(min(1.0, frac) * 0.97); lab.append(g)
E = embed_images(imgs, tops); np.save('photo-emb.npy', E); json.dump(lab, open('photo-lab.json', 'w'))
print('n', len(lab))
