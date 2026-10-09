# 판정기 타당성(사진만) — RULER-flow2.md §3 마지막 항목 + §4 "판정기 교체". 렌더는 보지 않습니다.
# 실행: cd tools/genus-ruler/clip && python3 judge-validity.py   (photo-emb2.npy·photo-lab2.json 이 없으면 photos2.py 와 같은 방식으로 만듦)
import json, os, sys, numpy as np
H = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, H)
from judge2 import *
REPO = os.path.abspath(os.path.join(H, '../../..'))
R = json.load(open(os.path.join(H, 'photo-ruler2.json')))
GROUPS = [{'Ns', 'St', 'As', 'Sc'}, {'Cb', 'Cg'}]          # ruler2.py 와 같은 묶음(사진 적중 < 0.4 일 때만 완화)
SG = {'Ns', 'St', 'As', 'Sc'}; K = 5; MARGIN = 2
DECIDE = ['AcCc', 'Sc', 'Ci', 'Cu']
EMB, LAB = os.path.join(H, 'photo-emb2.npy'), os.path.join(H, 'photo-lab2.json')

def group_of(g):  # J1 완화 묶음(사진 적중 < 0.4 이고 묶음이 있을 때)
    G = next((G for G in GROUPS if g in G), set())
    return G if (R[g]['acc'] < 0.4 and G) else {g}

def build_photos():
    # photos2.py 와 같은 논리 — 선택 json 은 tools/genus-ruler/genus*/, 썸네일은 .harness/genus/genus*/thumbs
    E, lab = [], []
    for sub, sel, remap in (('genus', 'selection.json', {'StSc': 'Sc'}), ('genus2', 'selection2.json', {})):
        S = json.load(open(os.path.join(H, '..', sub, sel))); imgs, tops = [], []
        for g, d in S.items():
            for idx, frac in d.items():
                f = os.path.join(REPO, '.harness/genus', sub, 'thumbs/%s/%03d.jpg' % (g, int(idx)))
                if not os.path.exists(f): continue
                imgs.append(Image.open(f)); tops.append(min(1.0, frac) * 0.97); lab.append(remap.get(g, g))
        E.append(embed_images(imgs, tops))
    np.save(EMB, np.concatenate(E)); json.dump(lab, open(LAB, 'w'))

def vote(neigh_labels, merge=None):
    # 다수결; 1등과 2등의 표 차 ≥ 2 아니면 None("판정 없음"). merge: 하나로 셀 묶음
    c = {}
    for l in neigh_labels:
        l = 'G' if (merge and l in merge) else l; c[l] = c.get(l, 0) + 1
    s = sorted(c.items(), key=lambda t: -t[1])
    return s[0][0] if (s[0][1] - (s[1][1] if len(s) > 1 else 0)) >= MARGIN else None

def knn_labels(Q, E, lab, exclude_self=False, merge=None):
    S = Q @ E.T
    if exclude_self: np.fill_diagonal(S, -np.inf)
    nn = np.argsort(-S, 1)[:, :K]
    return [vote(lab[r], merge) for r in nn]

def knn_judge(render_paths_triple, top=0.78, g=None):
    """렌더 3 방위를 사진 k-NN 으로 판정. 반환: (방위별 라벨 목록, 판정). g 가 주어지면 ≥2/3 이 g(완화 묶음 포함)인지 bool,
    없으면 ≥2/3 이 같은 라벨이면 그 라벨, 아니면 None."""
    E = np.load(EMB); lab = np.array(json.load(open(LAB)))
    Q = embed_images([Image.open(p) for p in render_paths_triple], [top] * 3)
    labs = knn_labels(Q, E, lab)
    if g is not None:
        G = group_of(g); return labs, sum(l in G for l in labs if l) >= 2
    for l in set(x for x in labs if x):
        if labs.count(l) >= 2: return labs, l
    return labs, None

if __name__ == '__main__':
    if not (os.path.exists(EMB) and os.path.exists(LAB)): build_photos()
    E = np.load(EMB); lab = np.array(json.load(open(LAB)))
    names, C = class_embeds('genus'); P = probs(E, C); am = np.array([names[i] for i in P.argmax(1)])
    counts = {g: int((lab == g).sum()) for g in names}
    diff = {g: (counts[g], R[g]['n']) for g in names if counts[g] != R[g]['n']}
    print('사진 n', len(lab), '· photo-ruler2 n 과 차이', diff or '없음')
    zs = (am == lab).mean(); print('제로샷 10종 정확도 %.3f' % zs)

    kn = np.array([x or '-' for x in knn_labels(E, E, lab, exclude_self=True)], dtype=object)
    knG = np.array([x or '-' for x in knn_labels(E, E, lab, exclude_self=True, merge=SG)], dtype=object)
    cu = lab == 'Cu'; out = {'n': counts, 'n_diff_vs_ruler2': diff, 'zeroshot_acc': float(zs), 'k': K, 'margin': MARGIN, 'classes': {}}
    print('\n%-4s %3s %6s %6s %6s %6s %6s %7s %7s  %s' % ('g', 'n', 'J1pass', 'acc0', 'kNNacc', 'kNN-', 'kNNgrp', 'Cu>g_k', 'Cu>g_J1', 'kNN 혼동'))
    for j, g in enumerate(names):
        m = lab == g; G = group_of(g); q25 = R[g]['own'][0]
        j1 = float(np.mean([(am[i] in G) and P[i, j] >= q25 for i in np.where(m)[0]]))
        acc = float((kn[m] == g).mean()); nd = float((kn[m] == '-').mean())
        conf = {h: int((kn[m] == h).sum()) for h in names + ['-'] if (kn[m] == h).any()}
        accG = float((knG[m] == 'G').mean()) if g == 'Sc' else None
        cu_k = float((kn[cu] == g).mean()) if g != 'Cu' else None
        cu_j1 = float(np.mean((am[cu] == g) & (P[cu, j] >= q25))) if g != 'Cu' else None
        rec = {'n': int(m.sum()), 'j1_single_pass': j1, 'j1_relax_group': sorted(G), 'q25': q25, 'zeroshot_acc_photo': R[g]['acc'],
               'knn_loo_acc': acc, 'knn_no_decision': nd, 'knn_acc_when_decided': float((kn[m] == g).sum() / max(1, (kn[m] != '-').sum())),
               'j1_single_pass_strict': float(np.mean((am[m] == g) & (P[m, j] >= q25))), 'knn_confusion': conf, 'knn_loo_acc_group': accG,
               'cu_to_g_knn': cu_k, 'cu_to_g_j1': cu_j1}
        if g == 'Sc':
            rec['cu_to_group_knn'] = float((knG[cu] == 'G').mean()); rec['knn_confusion_group'] = {str(h): int((knG[m] == h).sum()) for h in set(knG[m])}
        if g in DECIDE:
            if j1 >= 0.6: v = 'J1 유효'
            else:
                a = accG if g == 'Sc' else acc                      # Sc 는 1회차와 같은 묶음 완화(사진 적중 0.32 < 0.4)
                fp = rec['cu_to_group_knn'] if g == 'Sc' else (cu_k or 0.0)   # Cu 는 자기 자신이라 Cu→g 항은 해당 없음
                v = 'k-NN 으로 교체' if (a >= 0.8 and fp <= 0.2) else '판정기 없음'
            rec['verdict'] = v
        out['classes'][g] = rec
        f = lambda x: '   n/a' if x is None else '%6.2f' % x
        print('%-4s %3d %6.2f %6.2f %6.2f %6.2f %s %s  %s  %s%s' % (g, m.sum(), j1, R[g]['acc'], acc, nd, f(accG), f(cu_k), f(cu_j1), conf,
              ('  → ' + rec['verdict']) if 'verdict' in rec else ''))
    print('Sc 묶음: Cu→{Ns,St,As,Sc} k-NN %.2f, 묶음 혼동 %s' % (out['classes']['Sc']['cu_to_group_knn'], out['classes']['Sc']['knn_confusion_group']))
    json.dump(out, open(os.path.join(H, 'judge-validity.json'), 'w'), indent=1, ensure_ascii=False)
