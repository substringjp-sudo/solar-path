import json, numpy as np, sys
sys.path.insert(0, '.'); from judge2 import *
E = np.load('photo-emb2.npy'); lab = np.array(json.load(open('photo-lab2.json')))
names, C = class_embeds('genus'); P = probs(E, C); pred = np.array([names[i] for i in P.argmax(1)])
print('10종 제로샷 정확도 %.2f (우연 0.10)' % (pred == lab).mean())
out = {}
for j, g in enumerate(names):
    m = lab == g
    if not m.any(): continue
    conf = {h: int((pred[m] == h).sum()) for h in names if (pred[m] == h).any()}
    out[g] = {'n': int(m.sum()), 'acc': float((pred[m] == g).mean()), 'own': np.quantile(P[m, j], [.25, .5, .75]).round(3).tolist()}
    print(' %-3s n=%3d 적중 %.2f 자기확률 q25/50/75 %s 혼동 %s' % (g, m.sum(), out[g]['acc'], out[g]['own'], conf))
json.dump(out, open('photo-ruler2.json', 'w'), indent=1)
