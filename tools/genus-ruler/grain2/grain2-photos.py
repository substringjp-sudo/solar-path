#!/usr/bin/env python3
"""grain2-photos.py — RULER-grain2 §4(e): 새 G3 판정기(그림마다 따로, ±1 LSB 떨림 K 개 평균)를 사진으로 다시 잼(렌더 안 봄).
  python3 tools/genus-ruler/grain2/grain2-photos.py --cache C --out OUT.json [--classes AcCc,Ci,Cu,Cs,Sc]
기준 = 옛 판정기(clip/photo-emb2.npy — 8 장 묶음 임베딩, judge-validity.py 와 같은 사진·자름)의 같은 맞음 정의.
맞음: AcCc 사진 → argmax AcCc, Ci 사진 → argmax ∈ {Ci, Cs}(clip-labels.py 와 같음). 혼동 종류(Cu·Cs·Sc)는 AcCc·Ci 로 잘못 붙는 비율만 기록.
받아들임(미리 정함): AcCc·Ci 각각 새 정확도 ≥ 옛 정확도 − 0.05.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grain2 as G2  # noqa: E402
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
GR = os.path.join(REPO, 'tools/genus-ruler')
OK = {'AcCc': {'AcCc'}, 'Ci': {'Ci', 'Cs'}}
TOL = 0.05


def photo_list():
    """judge-validity.py build_photos 와 같은 순서·자름."""
    out = []
    for sub, sel, remap in (('genus', 'selection.json', {'StSc': 'Sc'}), ('genus2', 'selection2.json', {})):
        S = json.load(open(os.path.join(GR, sub, sel)))
        for g, d in S.items():
            for idx, frac in d.items():
                f = os.path.join(REPO, '.harness/genus', sub, 'thumbs/%s/%03d.jpg' % (g, int(idx)))
                if not os.path.exists(f):
                    continue
                out.append({'file': f, 'top': min(1.0, frac) * 0.97, 'label': remap.get(g, g)})
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache'); ap.add_argument('--out', required=True); ap.add_argument('--classes', default='AcCc,Ci')
    a = ap.parse_args(argv)
    cls = a.classes.split(',')
    j2, names, C = G2._judge2()
    ph = photo_list()
    E = np.load(os.path.join(GR, 'clip', 'photo-emb2.npy')); lab = json.load(open(os.path.join(GR, 'clip', 'photo-lab2.json')))
    assert len(ph) == len(lab) == len(E) and [p['label'] for p in ph] == lab, '사진 목록이 photo-emb2 와 다름'
    Pold = j2.probs(E, C); amold = [names[i] for i in Pold.argmax(1)]
    cache = G2.load_cache(a.cache)
    res = {'provenance': G2.provenance(), 'clipCfg': G2.clip_cfg()[0], 'K': G2.G3_K, 'classes': {}}
    for g in cls:
        idx = [i for i, p in enumerate(ph) if p['label'] == g]
        new = []
        for n, i in enumerate(idx):
            p, _, _ = G2.clip_smooth(ph[i]['file'], cache, top=ph[i]['top'])   # 렌더 판정과 같은 함수(자름만 사진의 것)
            new.append(names[int(np.argmax(p))])
            if n % 10 == 9:
                G2.save_cache(a.cache, cache)
        G2.save_cache(a.cache, cache)
        old = [amold[i] for i in idx]
        rec = {'n': len(idx), 'newLabels': dict(zip(*np.unique(new, return_counts=True))) if new else {}, 'oldLabels': dict(zip(*np.unique(old, return_counts=True)))}
        rec = {k: ({kk: int(vv) for kk, vv in v.items()} if isinstance(v, dict) else v) for k, v in rec.items()}
        if g in OK:
            rec['oldAcc'] = float(np.mean([x in OK[g] for x in old])); rec['newAcc'] = float(np.mean([x in OK[g] for x in new]))
            rec['pass'] = bool(rec['newAcc'] >= rec['oldAcc'] - TOL)
        else:
            rec['oldAsAcCc'] = float(np.mean([x == 'AcCc' for x in old])); rec['newAsAcCc'] = float(np.mean([x == 'AcCc' for x in new]))
            rec['oldAsCi'] = float(np.mean([x in OK['Ci'] for x in old])); rec['newAsCi'] = float(np.mean([x in OK['Ci'] for x in new]))
        res['classes'][g] = rec
        print(g, json.dumps(rec, ensure_ascii=False), flush=True)
    res['accept'] = bool(all(res['classes'][g]['pass'] for g in OK if g in res['classes']) and all(g in res['classes'] for g in OK))
    json.dump(res, open(a.out, 'w'), indent=1, ensure_ascii=False)
    print('accept', res['accept'])
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
