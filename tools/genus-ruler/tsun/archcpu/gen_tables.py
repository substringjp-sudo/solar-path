"""§179 WP5 — 앱 15 파장 대기 표를 CPU 에서 결정적으로 다시 만들고 sha256 을 적는 도구(큰 표는 git 밖).

  nice -n 19 python3 -I tools/genus-ruler/tsun/archcpu/gen_tables.py --out DIR [--from-batches DIR2] [--check]

- 사전 시험(scratchpad tsun/pretest — §176.1)의 길을 그대로 옮김:
  (1) spec.params(앱 15 파장의 묶음 셋씩)를 '%.10e' 로 params.txt 에 씀 — 사전 시험 s0..s4/params.txt 와 바이트 같음 [measured].
  (2) precompute.c(사전 시험 원본 그대로, sha256 df296e9b4389…)를 gcc -O2 -mfma 로 묶어 묶음마다 한 번(4 차 산란까지).
      한 묶음 약 80 s, 다섯 묶음 약 7 CPU 분 [measured]. 단일 스레드·난수 없음 → 같은 컴파일러·같은 플래그면 바이트 같음.
      (결정 D-t1) -mfma: 사전 시험 바이너리가 FMA(vfmadd 96 곳)로 묶여 있었고, -O2 -mfma 가 사전 시험 s0..s4 를 **바이트 그대로** 다시
      만듦 [measured] — arch/nodes.json·feas_v2band·critic arch_energy 의 모든 수가 이 표에서 나왔으므로 그 표를 기준으로 고정.
      FMA 없는 x86-64 에서는 --portable(-O2 -ffp-contract=off)만 가능: 사전 시험 표와 float32 텍셀 0.1~0.4 % 가 최대 상대 1.7e−6 다름
      [measured] → 기록된 sha 와 다르므로 --allow-unrecorded 로만 씀.
  (3) assemble.py 와 같은 식으로 앱 표를 합침(spectralAtmosphere.ts: 묶음마다 luminanceFromRadiance 를 곱해 더함, 투과율은
      태양 × 등색 함수 가중 평균(effectiveTransmittance, 앱 기본) 을 [0, 1] 로 자름, K = 683 / SUN_LUMINANCE).
- 기록: 묶음 원시 f32 파일마다 sha256 과, 합친 배열의 **정규 sha256**(배열을 '<f8' C 순서 바이트로 T·I·S·M·H·K 차례로 이은 것).
  np.savez 의 zip 머리말에는 시각이 들어가 파일 sha 가 매번 달라지므로 파일 sha 는 쓰지 않음(결정).
- --from-batches: 이미 있는 s0..s4 원시 묶음(예: 사전 시험 표)을 합치기만 함(precompute 를 돌리지 않음) — 합치기만의 재현 확인용.
- --check: 이 폴더의 tables-sha256.json(커밋된 기록)과 견주어 MATCH/MISMATCH 를 찍음(다르면 종료 코드 1).
- --record: 결과를 이 폴더의 tables-sha256.json 에 씀(기록을 바꿀 때만).
"""
import sys, os, json, hashlib, subprocess, time, argparse, platform
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import luts as L, spec

CFLAGS = ['-O2', '-mfma']
CFLAGS_PORTABLE = ['-O2', '-ffp-contract=off']
N_BATCH = 5
RECORD = os.path.join(HERE, 'tables-sha256.json')
BATCH_FILES = ['transmittance.f32', 'irradiance.f32', 'scattering.f32', 'mie.f32', 'higher.f32']


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 22), b''):
            h.update(chunk)
    return h.hexdigest()


def sha256_arrays(arrs):
    """정규 sha256: 배열마다 '<f8' C 순서 바이트(모양은 머리말 문자열로 앞에)."""
    h = hashlib.sha256()
    for name, a in arrs:
        a = np.ascontiguousarray(np.asarray(a, dtype='<f8'))
        h.update(f'{name}{list(a.shape)};'.encode())
        h.update(a.tobytes())
    return h.hexdigest()


def batch_params(b):
    l15, _ = spec.app_lambdas(15)
    p = spec.params(l15[3 * b:3 * b + 3])
    v = np.concatenate([p['solar'], p['rayleigh'], p['mie_sca'], p['mie_ext'], p['ozone']])
    return ' '.join('%.10e' % x for x in v)


def compile_precompute(out, flags):
    os.makedirs(os.path.join(out, 'bin'), exist_ok=True)
    exe = os.path.join(out, 'bin', 'precompute')
    subprocess.run(['gcc', *flags, '-o', exe, os.path.join(HERE, 'precompute.c'), '-lm'], check=True)
    cc = subprocess.run(['gcc', '--version'], capture_output=True, text=True).stdout.splitlines()[0]
    return exe, ' '.join(['gcc', *flags, '-o', 'precompute', 'precompute.c', '-lm']), cc


def run_batches(out, exe):
    times = []
    for b in range(N_BATCH):
        d = os.path.join(out, f's{b}')
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'params.txt'), 'w') as f:
            f.write(batch_params(b))
        t0 = time.time()
        with open(os.path.join(d, 'log.txt'), 'w') as log:
            subprocess.run(['nice', '-n', '19', exe, os.path.join(d, 'params.txt'), d], check=True, stderr=log)
        times.append(round(time.time() - t0, 1))
        print(f'batch s{b} {times[-1]} s', flush=True)
    return times


def assemble(bdir):
    """assemble.py(사전 시험) 와 같은 식 — 결과 배열 dict(T, I, S, M, H, K)."""
    l15, dl = spec.app_lambdas(15)
    C = spec.srgb_coeff(l15, dl)
    E = spec.table10(spec.SOLAR, l15)
    norm = (E[:, None] * C).sum(0)
    acc = None; T = 0
    for b in range(N_BATCH):
        t = L.load_cpu_batch(os.path.join(bdir, f's{b}'))
        M = C[3 * b:3 * b + 3].T
        W = (E[3 * b:3 * b + 3, None] * C[3 * b:3 * b + 3]).T / norm[:, None]
        conv = {k: t[k] @ M.T for k in ['I', 'S', 'M', 'H']}
        acc = conv if acc is None else {k: acc[k] + conv[k] for k in acc}
        T = T + t['T'] @ W.T
    T = np.clip(T, 0, 1)
    K = 683.0 / L.SUN_LUMINANCE
    return dict(T=T, I=acc['I'], S=acc['S'], M=acc['M'], H=acc['H'], K=np.float64(K))


def table_record(arr, bdir):
    rec = dict(canonical_sha256=sha256_arrays([(k, arr[k]) for k in ['T', 'I', 'S', 'M', 'H', 'K']]),
               arrays={k: dict(shape=list(np.shape(arr[k])), sha256=sha256_arrays([(k, arr[k])])) for k in ['T', 'I', 'S', 'M', 'H', 'K']},
               K=float(arr['K']),
               batches={f's{b}': {fn: sha256_file(os.path.join(bdir, f's{b}', fn)) for fn in BATCH_FILES} for b in range(N_BATCH)},
               params_sha256={f's{b}': hashlib.sha256(batch_params(b).encode()).hexdigest() for b in range(N_BATCH)})
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--from-batches')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--record', action='store_true')
    ap.add_argument('--portable', action='store_true')
    a = ap.parse_args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    meta = dict(tool='archcpu/gen_tables.py §179', numpy=np.__version__, python=platform.python_version(), machine=platform.machine(),
                precompute_c_sha256=sha256_file(os.path.join(HERE, 'precompute.c')))
    if a.from_batches:
        bdir = os.path.abspath(a.from_batches)
        meta['source'] = 'from-batches'
    else:
        exe, cmd, cc = compile_precompute(out, CFLAGS_PORTABLE if a.portable else CFLAGS)
        meta.update(compile=cmd, compiler=cc)
        meta['batch_seconds'] = run_batches(out, exe)
        bdir = out
        meta['source'] = 'precompute'
    arr = assemble(bdir)
    rec = table_record(arr, bdir)
    rec['meta'] = meta
    np.savez(os.path.join(out, 'app15.npz'), **arr)
    json.dump(rec, open(os.path.join(out, 'tables-sha256.json'), 'w'), indent=1)
    print('canonical sha256', rec['canonical_sha256'])
    print('K', rec['K'])
    rc = 0
    if a.check:
        ref = json.load(open(RECORD))
        same_tab = ref['canonical_sha256'] == rec['canonical_sha256']
        same_bat = ref['batches'] == rec['batches']
        print('CHECK tables', 'MATCH' if same_tab else 'MISMATCH', '· batches', 'MATCH' if same_bat else 'MISMATCH')
        rc = 0 if (same_tab and same_bat) else 1
    if a.record:
        keep = {k: rec[k] for k in ['canonical_sha256', 'arrays', 'K', 'batches', 'params_sha256']}
        keep['meta'] = {k: meta[k] for k in meta if k not in ('batch_seconds',)}
        json.dump(keep, open(RECORD, 'w'), indent=1)
        print('recorded', RECORD)
    sys.exit(rc)


if __name__ == '__main__':
    main()
