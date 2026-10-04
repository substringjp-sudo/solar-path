# SYNOP FM-12 1절 파싱: AAXX YYGGi IIiii iRixhVV Nddff [00fff] 1sTTT 2sTdTd 3P 4P 5app 6RRR 7wwWW 8NhCLCMCH 9GGgg
import csv, re, sys, collections
def parse(msg):
    s1 = msg.split(' 333')[0].split(' 222')[0].split(' 555')[0].split()
    if len(s1) < 5 or s1[0] != 'AAXX': return None
    iRixhVV, Nddff = s1[3], s1[4]
    ix = iRixhVV[1]; h = iRixhVV[2]; N = Nddff[0]
    rest = s1[5:]
    if rest and rest[0].startswith('00'): rest = rest[1:]   # 00fff 풍속 보조
    out = {'ix': ix, 'h': h, 'N': N, 'ww': None, 'cl': None}
    for g in rest:
        if len(g) != 5: continue
        if g[0] == '7' and out['ww'] is None: out['ww'] = g[1:3]
        if g[0] == '8' and out['cl'] is None: out['cl'] = g[1:]      # NhCLCMCH
    return out
def rows(path):
    for line in open(path):
        p = line.strip().split(',', 6)
        if len(p) < 7: continue
        r = parse(p[6])
        if r: yield p[0], f'{p[1]}-{p[2]}-{p[3]}T{p[4]}:00', r
if __name__ == '__main__':
    for f in sys.argv[1:]:
        CL = collections.Counter(); ixc = collections.Counter(); n = n8 = 0
        for st, t, r in rows(f):
            n += 1
            if r['cl'] and r['cl'][1] != '/': n8 += 1; CL[r['cl'][1]] += 1; ixc[r['ix']] += 1
        print(f, 'reports', n, 'CL known', n8, 'ix', dict(ixc), 'CL', dict(sorted(CL.items())))
