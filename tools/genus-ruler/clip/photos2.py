# 새 종류(genus2) + 기존 사진 임베딩 — 라벨은 10종(StSc → Sc 로 두고 St 는 새 묶음)
import json, sys, numpy as np
sys.path.insert(0, '.'); from judge2 import *
E=[]; lab=[]
for root, selfile, remap in (('../genus/', '../genus/selection.json', {'StSc': 'Sc'}), ('../genus2/', '../genus2/selection2.json', {})):
    S = json.load(open(selfile)); imgs=[]; tops=[]
    for g, sel in S.items():
        for idx, frac in sel.items():
            f = root + 'thumbs/%s/%03d.jpg' % (g, int(idx))
            if not os.path.exists(f): continue
            imgs.append(Image.open(f)); tops.append(min(1.0, frac) * 0.97); lab.append(remap.get(g, g))
    E.append(embed_images(imgs, tops))
np.save('photo-emb2.npy', np.concatenate(E)); json.dump(lab, open('photo-lab2.json', 'w')); print('n', len(lab))
