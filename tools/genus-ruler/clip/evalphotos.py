import json, numpy as np, sys
sys.path.insert(0, '.'); from judge import *
E = np.load('photo-emb.npy'); lab = json.load(open('photo-lab.json'))
names, C = class_embeds('genus'); P = probs(E, C)
pred = [names[i] for i in P.argmax(1)]
G = names; conf = {g: {h: 0 for h in G} for g in G}
for a, b in zip(lab, pred): conf[a][b] += 1
acc = np.mean([a == b for a, b in zip(lab, pred)])
print('zero-shot 정확도 %.2f (우연 0.25)' % acc)
for g in G: print(' ', g, conf[g], ' 자기종류 확률 중앙값 %.2f' % np.median([P[i, G.index(g)] for i in range(len(lab)) if lab[i] == g]))
for grp in ['real', 'volume']:
    n2, C2 = class_embeds(grp); P2 = probs(E, C2)
    for g in G:
        v = [P2[i, 0] for i in range(len(lab)) if lab[i] == g]
        print(grp, n2[0], g, 'q25/med/q75 %.2f/%.2f/%.2f' % tuple(np.quantile(v, [.25, .5, .75])))
