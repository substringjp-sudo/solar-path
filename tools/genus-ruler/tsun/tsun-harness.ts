/**
 * §179 RULER-tsun 하네스의 순수 함수(브라우저·three 없음) — entry-tsun.ts 가 쓰고, tools/shader-preview/verify-tsun-ref.js 가 node 에서 시험합니다.
 * **하네스 전용, 기본 끔** — 앱은 이 파일을 묶지 않습니다(2026-10-28 사용자 결정: T_sun 은 하네스 도구만).
 *
 * 무엇(ruler-delta B1·A1·F4, design v2.1 §5.4·§8 WP8):
 *  - 잡 점검: 새 손잡이 9 개(TSUN_OPTIONS_OFF 의 키)가 **모든 잡에 명시**돼야 함(A1) · 잡 필드 허용 목록(모르는 필드 → throw, 빈 팔 방지) ·
 *    잡 종류(image · debug · cost) · 진단 + 비용 섞기 금지.
 *  - 비용 변형(B1): 동결 COST_PATCH(grain/capture.ts applyCostPatch) **뒤에** 정확히 한 번씩 더 바꿈 — 출력 줄 A 에 2·n_tsun 을 더하고,
 *    `int gCostTsun = 0;` 선언, T_sun 세는 줄(cloudTsun TSUN_COUNT_LINE) 뒤 `++gCostTsun;`, 아치 팔이면 I-4 아치 블록 읽기 둘(+2)과 노드 캐시
 *    하늘 LUT 호출(+1, 노드마다). 해독: cap = A mod 2, n = floor(A/2)(반정밀도에서 n ≤ 1023 까지 정확 [computed]). F_cloud = x + y + z + n.
 *  - D-1 진단(R-A_T) 텍셀 해독: 구름 패스 출력 B = Σw·T, G = Σw 를 프레임·텍셀마다 더해 T = ΣB/ΣG. 시간 업스케일(1/4 해상도·Bayer)에서 4 프레임은
 *    4×4 칸의 4/16 만 그리므로 안 그린 텍셀은 같은 칸에서 그린 텍셀의 합으로 채우고(덮음 비율을 meta 에) 8비트 PNG(R = √T, G = Σw, B = 덮음 255)로.
 */
import { TSUN_ARCH_FETCH_LINE, TSUN_ARCH_LUT_LINE, TSUN_COUNT_LINE, TSUN_OPTIONS_OFF } from '../../../src/components/VolumetricProbe/cloudTsun';

type AnyRec = Record<string, unknown>;

/** 새 손잡이 9 개 — 모든 잡이 명시(ruler-delta A1 'Every arm gives every new knob explicitly'). */
export const TSUN_KNOB_KEYS = Object.keys(TSUN_OPTIONS_OFF) as (keyof typeof TSUN_OPTIONS_OFF)[];
export function checkExplicitKnobs(options: AnyRec | undefined, name = '?'): void {
  const miss = TSUN_KNOB_KEYS.filter(k => !options || !(k in options));
  if (miss.length) throw new Error(`entry-tsun: job ${name} does not give every new knob explicitly (missing ${miss.join(', ')}) — ruler-delta A1`);
}

/**
 * 잡 필드 허용 목록 — 동작하는 필드 + make-jobs-tsun·RULER-grain 비용 잡이 들고 오는 기록 필드. 다른 필드(clouds·resolve·material·fill·views·terrain·tone 등
 * volsky 진단 필드)는 이 자에 없으므로 throw(조용히 무시되면 다른 팔이 됨).
 */
export const TSUN_JOB_FIELDS = new Set(['name', 'input', 'frames', 'timedN', 'quality', 'res', 'out', 'options', 'exposureScale', 'W', 'H', 'canvas', 'grain',
  // 기록 필드(동작 없음): RULER-grain 비용 잡 · make-jobs-tsun
  'set', 'round', 'arm', 'layer', 'time', 'az', 'frame', 'scene', 'unit', 'note', 'watchdogMin']);
export type TsunJobKind = 'image' | 'debug' | 'cost';
export function checkTsunJob(job: AnyRec): TsunJobKind {
  const name = String(job.name ?? '?');
  if (typeof job.name !== 'string' || !/^[A-Za-z0-9_.+-]+$/.test(job.name)) throw new Error('entry-tsun: bad job name ' + JSON.stringify(job.name));
  const bad = Object.keys(job).filter(k => !TSUN_JOB_FIELDS.has(k));
  if (bad.length) throw new Error(`entry-tsun: job ${name} has fields this harness does not implement: ${bad.join(', ')}`);
  checkExplicitKnobs(job.options as AnyRec | undefined, name);
  const o = job.options as AnyRec;
  const g = job.grain as AnyRec | undefined;
  if (g && g.mode !== 'cost') throw new Error(`entry-tsun: job ${name} grain.mode ${String(g.mode)} — only the cost variant is part of RULER-tsun (§4.7)`);
  const dbg = Number(o.tsunDebug ?? 0);
  if (g && dbg) throw new Error(`entry-tsun: job ${name} mixes the cost variant with tsunDebug ${dbg}`);
  if (job.quality != null && !['low', 'medium', 'high'].includes(String(job.quality))) throw new Error(`entry-tsun: job ${name} quality ${String(job.quality)}`);
  return g ? 'cost' : dbg ? 'debug' : 'image';
}

// ───── 비용 변형(ruler-delta B1) ─────
/** 동결 COST_PATCH 가 만든 출력 줄(그대로)과 그 뒤 한 번 더 바꾼 줄. */
export const COST_OUT_LINE = 'outputColor = vec4(float(sampleCount.x), float(gCostShape), float(gCostSun), gCostCap);';
export const COST_OUT_LINE_TSUN = 'outputColor = vec4(float(sampleCount.x), float(gCostShape), float(gCostSun), gCostCap + 2.0 * float(gCostTsun));';
/** 동결 COST_PATCH 가 만든 선언 줄 — 그 뒤에 gCostTsun 선언(T 글자가 없는 팔도 출력 줄이 쓰므로 늘 선언; T 선언 블록에 두면 C0ps 에서 없음). */
export const COST_DECL_LINE = 'float gCostCap = 0.0;\n';
const count = (s: string, a: string) => s.split(a).length - 1;
function once(src: string, a: string, b: string, tag: string): string {
  const n = count(src, a);
  if (n !== 1) throw new Error(`tsun cost patch: anchor count ${n} (${tag})`);
  return src.replace(a, () => b);
}
/**
 * applyCostPatch(동결) 출력에 T_sun 셈을 더함. T 글자(세는 줄)·아치 글자의 수는 0 또는 1 이어야 하고(둘 다 아니면 throw), 아치 줄은 T 글자와 함께만.
 * 돌려주는 counts 는 meta 에(어느 셈이 들어갔는지).
 */
export function applyTsunCostPatch(patched: string): { text: string; counts: { tsun: number; archFetch: number; archLut: number } } {
  let t = once(patched, COST_OUT_LINE, COST_OUT_LINE_TSUN, 'output line');
  t = once(t, COST_DECL_LINE, COST_DECL_LINE + 'int gCostTsun = 0;   // §179 RULER-tsun n_tsun + n_archLUT (ruler-delta B1)\n', 'declaration');
  const nT = count(t, TSUN_COUNT_LINE), nF = count(t, TSUN_ARCH_FETCH_LINE), nL = count(t, TSUN_ARCH_LUT_LINE);
  if (nT > 1 || nF > 1 || nL > 1) throw new Error(`tsun cost patch: count lines ${nT}/${nF}/${nL} > 1`);
  if ((nF || nL) && !(nT && nF && nL)) throw new Error(`tsun cost patch: arch lines without the full arch text (${nT}/${nF}/${nL})`);
  if (nT) t = once(t, TSUN_COUNT_LINE, TSUN_COUNT_LINE + '\n          ++gCostTsun;   // §179 n_tsun', 'T_sun fetch');
  if (nF) t = once(t, TSUN_ARCH_FETCH_LINE, TSUN_ARCH_FETCH_LINE + '\n          gCostTsun += 2;   // §179 아치 블록 읽기 둘', 'arch fetch');
  if (nL) t = once(t, TSUN_ARCH_LUT_LINE, TSUN_ARCH_LUT_LINE + '\n      ++gCostTsun;   // §179 n_archLUT', 'arch LUT');
  return { text: t, counts: { tsun: nT, archFetch: nF, archLut: nL } };
}
/** 비용 A 채널 해독 — 반올림한 정수 a 에서 cap = a mod 2, n = floor(a/2). 프레임·텍셀마다(평균 전에) 부름. */
export function decodeCostA(a: number): { cap: number; n: number } {
  const r = Math.round(a);
  if (!(r >= 0) || Math.abs(a - r) > 1e-3) return { cap: NaN, n: NaN };
  return { cap: r % 2, n: (r - (r % 2)) / 2 };
}

// ───── D-1 진단 텍셀 해독 ─────
/**
 * 4×4 칸 채우기 + 8비트 부호화. sB = Σ(Σw·T), sG = Σ(Σw), n = 그린 횟수(텍셀마다, GL 행 순서, cw×ch).
 * 돌려줌: T(NaN = 빛 받는 무게 없음), Wm(그린 프레임 평균 Σw), covered(그린 텍셀 비율), filled(채운 텍셀 수).
 */
export function debugTexels(sB: Float64Array, sG: Float64Array, n: Uint16Array, cw: number, ch: number): { T: Float32Array; W: Float32Array; drawn: Uint8Array; covered: number } {
  const T = new Float32Array(cw * ch), W = new Float32Array(cw * ch), drawn = new Uint8Array(cw * ch);
  let nd = 0;
  for (let by = 0; by < ch; by += 4) for (let bx = 0; bx < cw; bx += 4) {
    let bB = 0, bG = 0, bn = 0;
    for (let y = by; y < Math.min(ch, by + 4); y++) for (let x = bx; x < Math.min(cw, bx + 4); x++) { const j = y * cw + x; if (n[j]) { bB += sB[j]; bG += sG[j]; bn += n[j]; } }
    for (let y = by; y < Math.min(ch, by + 4); y++) for (let x = bx; x < Math.min(cw, bx + 4); x++) {
      const j = y * cw + x;
      const [B, G, k] = n[j] ? [sB[j], sG[j], n[j]] : [bB, bG, bn];
      if (n[j]) { drawn[j] = 1; nd++; }
      T[j] = k && G > 0 ? Math.min(1, Math.max(0, B / G)) : NaN;
      W[j] = k ? G / k : NaN;
    }
  }
  return { T, W, drawn, covered: nd / (cw * ch) };
}
/**
 * 구름 격자(GL 행 순서, cw×ch) → 캔버스(위가 0, W×H) 8비트 RGBA — 가장 가까운 텍셀. R = round(255·√T), G = round(255·min(1, Σw)),
 * B = 255(값 있음)·0(빛 받는 무게 없음 또는 칸 전체를 안 그림), A = 255. ruler-delta B1 의 '√T in R, Σw in G'.
 */
export function debugPngRgba(T: Float32Array, Wt: Float32Array, cw: number, ch: number, W: number, H: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tx = Math.min(cw - 1, Math.floor(((x + 0.5) * cw) / W)), tyTop = Math.min(ch - 1, Math.floor(((y + 0.5) * ch) / H));
    const j = (ch - 1 - tyTop) * cw + tx, o = (y * W + x) * 4, t = T[j], w = Wt[j];
    const ok = Number.isFinite(t) && Number.isFinite(w) && w > 0;
    out[o] = ok ? Math.round(255 * Math.sqrt(t)) : 0;
    out[o + 1] = ok ? Math.round(255 * Math.min(1, w)) : 0;
    out[o + 2] = ok ? 255 : 0;
    out[o + 3] = 255;
  }
  return out;
}

// ───── meta 보조 ─────
/** 잡이 바라는 글자 상태: T 팔·REF 팔은 해 ≤ shadowMinSunDeg 에서 글자가 있어야(없으면 C0 — 빈 팔). 진단 잡은 글자가 없으면 throw. */
export function expectInjected(o: AnyRec, belowShadow: boolean | null): boolean {
  return (o.tsun === 1 || Number(o.tsunRef ?? 0) !== 0) && belowShadow === true;
}
