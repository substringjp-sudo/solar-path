import json, sys, numpy as np
sys.path.insert(0, '.'); from judge import *
names, C = class_embeds('genus'); out = {}
G = {'Cu': 'Cu', 'Ac': 'AcCc', 'Ci': 'Ci', 'Sc': 'StSc'}
for tm in ['AGX', 'ACES_FILMIC', 'NEUTRAL']:
    out[tm] = {}
    for k, g in G.items():
        E = embed_images([Image.open('../proto/d%s-%s-%d.png' % (tm, k, a)) for a in (200, 110, 20)], [0.78] * 3)
        out[tm][g] = float(np.median(probs(E, C)[:, names.index(g)]))
json.dump(out, open('../genus/display-clip.json', 'w'), indent=1); print(json.dumps(out))
