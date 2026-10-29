/**
 * §179 RULER-tsun 하네스의 순수 함수(브라우저·three 없음) — entry-tsun.ts 가 쓰고, tools/shader-preview/verify-tsun-ref.js 가 node 에서 시험합니다.
 * **하네스 전용, 기본 끔** — 앱은 이 파일을 묶지 않습니다(2026-10-28 사용자 결정: T_sun 은 하네스 도구만).
 *
 * 무엇(ruler-delta B1·A1·F4, design v2.1 §5.4·§8 WP8):
 *  - 잡 점검: 새 손잡이 9 개(TSUN_OPTIONS_OFF 의 키)가 **모든 잡에 명시**돼야 함(A1) · 잡 필드 허용 목록(모르는 필드 → throw, 빈 팔 방지) ·
 *    잡 종류(image · debug · cost) · 진단 + 비용 섞기 금지. §179 검토 반영(하네스 4·12·13·16): 팔 불변식(REF 는 shadowMinSunDeg·accurateSunBelowDeg 90,
 *    T 팔은 C0ps(accurateSunBelowDeg 12) + tsunSync true) · 옛 팔 이름 T1A1/T1A2 거부 · 값 범위(frames·res·input·grain.frame0/crop) ·
 *    진단 잡 이름은 `__dbg<k>` 로 끝남(그림 잡과 meta 이름이 겹치지 않게).
 *  - 비용 변형(B1): 동결 COST_PATCH(grain/capture.ts applyCostPatch) **뒤에** 정확히 한 번씩 더 바꿈 — 출력 줄 A 에 2·n_tsun 을 더하고,
 *    `int gCostTsun = 0;` 선언, T_sun 세는 줄(cloudTsun TSUN_COUNT_LINE) 뒤 `++gCostTsun;`, 아치 팔이면 I-4 아치 블록 읽기 둘(+2)과 노드 캐시
 *    하늘 LUT 호출(+1, 노드마다). 해독: cap = A mod 2, n = floor(A/2)(반정밀도에서 n ≤ 1023 까지 정확 [computed]). F_cloud = x + y + z + n.
 *  - D-1 진단(R-A_T) 텍셀 해독: 구름 패스 출력 B = Σw·T, G = Σw 를 프레임·텍셀마다 더해 T = ΣB/ΣG. 시간 업스케일(1/4 해상도·Bayer)에서 4 프레임은
 *    4×4 칸의 4/16 만 그리므로 안 그린 텍셀은 같은 칸에서 그린 텍셀의 합으로 채우고(덮음 비율을 meta 에) 8비트 PNG(R = √T, G = Σw, B = 덮음 255)로.
 */
import { TSUN_ARCH_FETCH_LINE, TSUN_ARCH_LUT_LINE, TSUN_COUNT_LINE, TSUN_OPTIONS_OFF } from '../../../src/components/VolumetricProbe/cloudTsunShader';

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
/** 손잡이 뜻 판(meta.tsunKnobs.v) — §179 검토 반영(하네스 12): archLight 1 = 이중 HG(옛 T1A2), 옛 T1A1(등방)은 없음. 바뀌면 올림. */
export const TSUN_KNOB_SEMANTICS = 'v2.1-r1';
/** 하네스 12: 옛 확장기의 팔 이름 — 같은 이름으로 다른 팔을 그리지 않게 거부(A1 갱신이 잡을 다시 만들 때까지). */
export const TSUN_RETIRED_ARMS = ['T1A1', 'T1A2'] as const;
const GRAIN_JOB_FIELDS = new Set(['mode', 'frame0', 'frames', 'noiseSeed']);
export function checkTsunJob(job: AnyRec): TsunJobKind {
  const name = String(job.name ?? '?');
  if (typeof job.name !== 'string' || !/^[A-Za-z0-9_.+-]+$/.test(job.name)) throw new Error('entry-tsun: bad job name ' + JSON.stringify(job.name));
  const bad = Object.keys(job).filter(k => !TSUN_JOB_FIELDS.has(k));
  if (bad.length) throw new Error(`entry-tsun: job ${name} has fields this harness does not implement: ${bad.join(', ')}`);
  checkExplicitKnobs(job.options as AnyRec | undefined, name);
  const o = job.options as AnyRec;
  const g = job.grain as AnyRec | undefined;
  if (g && g.mode !== 'cost') throw new Error(`entry-tsun: job ${name} grain.mode ${String(g.mode)} — only the cost variant is part of RULER-tsun (§4.7)`);
  // 하네스 13: 비용 잡의 frame0·crop 은 이 진입점이 하지 않음(늘 프레임 0, 자르지 않음) — 조용히 무시하지 않고 거부
  if (g) {
    const gb = Object.keys(g).filter(k => !GRAIN_JOB_FIELDS.has(k));
    if (gb.length) throw new Error(`entry-tsun: job ${name} grain fields not implemented here: ${gb.join(', ')} (crop is not supported)`);
    if (g.frame0 != null && g.frame0 !== 0) throw new Error(`entry-tsun: job ${name} grain.frame0 ${String(g.frame0)} — this entry always starts at frame 0`);
    if (g.frames != null && !(Number.isInteger(g.frames) && (g.frames as number) >= 1 && (g.frames as number) <= 256)) throw new Error(`entry-tsun: job ${name} grain.frames must be an integer 1..256`);
  }
  const dbg = Number(o.tsunDebug ?? 0);
  if (g && dbg) throw new Error(`entry-tsun: job ${name} mixes the cost variant with tsunDebug ${dbg}`);
  if (job.quality != null && !['low', 'medium', 'high'].includes(String(job.quality))) throw new Error(`entry-tsun: job ${name} quality ${String(job.quality)}`);
  // 하네스 13: 값 범위(빈 팔·frames 0 의 show(null) 같은 늦은 실패를 앞에서)
  if (job.frames != null && !(Number.isInteger(job.frames) && (job.frames as number) >= 1 && (job.frames as number) <= 256)) throw new Error(`entry-tsun: job ${name} frames must be an integer 1..256, got ${JSON.stringify(job.frames)}`);
  if (job.timedN != null && !(Number.isInteger(job.timedN) && (job.timedN as number) >= 1)) throw new Error(`entry-tsun: job ${name} timedN must be an integer >= 1`);
  if (job.res != null && !(typeof job.res === 'number' && job.res > 0 && job.res <= 1)) throw new Error(`entry-tsun: job ${name} res must be in (0, 1], got ${JSON.stringify(job.res)}`);
  if (job.out != null && !['rgb', 'alpha', 'both'].includes(String(job.out))) throw new Error(`entry-tsun: job ${name} out ${String(job.out)}`);
  const inp = job.input as AnyRec | undefined;
  if (!inp || typeof inp !== 'object' || typeof inp.date !== 'string' || !Number.isFinite(Date.parse(inp.date))) throw new Error(`entry-tsun: job ${name} needs input.date (ISO string)`);
  // 하네스 12: 옛 팔 이름
  const arm = String(job.arm ?? '');
  if (TSUN_RETIRED_ARMS.some(a => arm === a || name.startsWith(a + '__'))) throw new Error(`entry-tsun: job ${name} uses retired arm name ${arm || name.split('__')[0]} (T1A1 deleted, T1A2 renamed T1A — ruler-delta A1); regenerate the job file`);
  // 하네스 4: 팔 불변식(ruler-delta A1). REF·REF100·REF_val = accurateSunBelowDeg 90 · shadowMinSunDeg 90(그래야 HS 45·30·15° 에서도 글자가 들어감 — D12).
  if (Number(o.tsunRef ?? 0) !== 0 && (o.shadowMinSunDeg !== 90 || o.accurateSunBelowDeg !== 90)) {
    throw new Error(`entry-tsun: job ${name} REF arm needs shadowMinSunDeg 90 and accurateSunBelowDeg 90 (got ${JSON.stringify(o.shadowMinSunDeg)} / ${JSON.stringify(o.accurateSunBelowDeg)}) — otherwise it renders C0 above 12° (void arm)`);
  }
  // T 팔 = C0ps + T 손잡이: accurateSunBelowDeg 12 · tsunSync true · shadowMinSunDeg 없음(하네스 기본 12) 또는 12
  if (o.tsun === 1 && (o.accurateSunBelowDeg !== 12 || o.tsunSync !== true || !(o.shadowMinSunDeg == null || o.shadowMinSunDeg === 12))) {
    throw new Error(`entry-tsun: job ${name} T arm must be C0ps + T knobs (accurateSunBelowDeg 12, tsunSync true, shadowMinSunDeg 12) — got ${JSON.stringify([o.accurateSunBelowDeg, o.tsunSync, o.shadowMinSunDeg])}`);
  }
  const kind: TsunJobKind = g ? 'cost' : dbg ? 'debug' : 'image';
  // 하네스 16: 진단 잡 이름은 __dbg<k>(k = tsunDebug) 로 끝남 — 같은 출력 폴더의 그림 잡과 <이름>.meta.json 이 겹치지 않게
  if (kind === 'debug' && !new RegExp('__dbg' + dbg + '$').test(name)) throw new Error(`entry-tsun: debug job ${name} must be named <...>__dbg${dbg}`);
  if (kind !== 'debug' && /__dbg\d+$/.test(name)) throw new Error(`entry-tsun: job ${name} is named like a debug job but tsunDebug is 0`);
  return kind;
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
/** 반정밀도가 정수를 정확히 담는 한계(2¹¹ − 1) — 그 위에서는 짝수만 담겨 cap 비트(홀짝)가 사라짐. */
export const COST_A_EXACT_MAX = 2047;
/**
 * 비용 A 채널 해독 — 반올림한 정수 a 에서 cap = a mod 2, n = floor(a/2). 프레임·텍셀마다(평균 전에) 부름.
 * §179 검토 반영(하네스 10): a > 2047 이면 cap 비트가 반정밀도에서 사라짐(2049 → 2050 → cap 0, n 1025 로 잘못 읽힘) — overflow 로 표시하고 NaN.
 * low 는 n ≤ 3·200 + 6 = 606 이라 안전, 아치 팔 medium·high(500 반복)는 넘을 수 있음 → meta.cost.overflow 로 셈.
 */
export function decodeCostA(a: number): { cap: number; n: number; overflow: boolean } {
  const r = Math.round(a);
  if (r > COST_A_EXACT_MAX) return { cap: NaN, n: NaN, overflow: true };
  if (!(r >= 0) || Math.abs(a - r) > 1e-3) return { cap: NaN, n: NaN, overflow: false };
  return { cap: r % 2, n: (r - (r % 2)) / 2, overflow: false };
}
/**
 * 하네스 9(ruler-delta B1 '모든 셈 줄은 == 1'): 렌더하는 묶음 안에서 T_sun 셈 줄 수를 팔·글자 상태와 대조 — 다르면 throw(n_tsun = 0 이 조용히 나오지 않게).
 */
export function expectedTsunCostCounts(o: AnyRec, injected: boolean): { tsun: number; archFetch: number; archLut: number } {
  const t = o.tsun === 1 && injected ? 1 : 0, a = o.tsun === 1 && o.archLight === 1 && injected ? 1 : 0;
  return { tsun: t, archFetch: a, archLut: a };
}

// ───── D-1 진단 텍셀 해독 ─────
/**
 * 4×4 칸 채우기 + 8비트 부호화. sB = Σ(Σw·T), sG = Σ(Σw), sA = Σ(Σw·mip)(§179 검토 반영 물리 5 — 없으면 null), n = 그린 횟수(텍셀마다, GL 행 순서, cw×ch).
 * 돌려줌: T(NaN = 빛 받는 무게 없음), W(그린 프레임 평균 Σw), mip(빛 받는 표본의 무게 평균 mip, NaN = 없음), drawn(그린 텍셀), covered(그린 텍셀 비율).
 */
export function debugTexels(sB: Float64Array, sG: Float64Array, n: Uint16Array, cw: number, ch: number, sA: Float64Array | null = null): { T: Float32Array; W: Float32Array; mip: Float32Array; drawn: Uint8Array; covered: number } {
  const T = new Float32Array(cw * ch), W = new Float32Array(cw * ch), mip = new Float32Array(cw * ch), drawn = new Uint8Array(cw * ch);
  let nd = 0;
  for (let by = 0; by < ch; by += 4) for (let bx = 0; bx < cw; bx += 4) {
    let bB = 0, bG = 0, bA = 0, bn = 0;
    for (let y = by; y < Math.min(ch, by + 4); y++) for (let x = bx; x < Math.min(cw, bx + 4); x++) { const j = y * cw + x; if (n[j]) { bB += sB[j]; bG += sG[j]; bA += sA ? sA[j] : 0; bn += n[j]; } }
    for (let y = by; y < Math.min(ch, by + 4); y++) for (let x = bx; x < Math.min(cw, bx + 4); x++) {
      const j = y * cw + x;
      const [B, G, A, k] = n[j] ? [sB[j], sG[j], sA ? sA[j] : 0, n[j]] : [bB, bG, bA, bn];
      if (n[j]) { drawn[j] = 1; nd++; }
      T[j] = k && G > 0 ? Math.min(1, Math.max(0, B / G)) : NaN;
      W[j] = k ? G / k : NaN;
      mip[j] = sA && k && G > 0 ? A / G : NaN;
    }
  }
  return { T, W, mip, drawn, covered: nd / (cw * ch) };
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
/**
 * 잡이 바라는 글자 상태: T 팔은 해 ≤ shadowMinSunDeg 에서 글자가 있어야(없으면 C0ps — 빈 팔). REF 팔은 해와 무관하게 늘(§179 검토 반영 하네스 4 —
 * 팔 정의가 shadowMinSunDeg 90 이라 늘 들어가야 하고, 안 들어가면 REF 이름으로 C0 을 그림). 진단 잡은 글자가 없으면 throw.
 */
export function expectInjected(o: AnyRec, belowShadow: boolean | null): boolean {
  if (Number(o.tsunRef ?? 0) !== 0) return belowShadow !== null;
  return o.tsun === 1 && belowShadow === true;
}
