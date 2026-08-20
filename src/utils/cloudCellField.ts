/**
 * cloudCellField.ts
 *
 * 구름 **조각 무늬**를 타일 가능한 필드로 굽습니다.
 * (docs/CLOUD_TEXTURE_PLAN.md 1단계)
 *
 * ## 왜 매 프래그먼트 fbm이 아니라 굽는가
 *
 * 성능 때문만이 아닙니다. 계획 §4의 투영에서 uv 스케일이 시선 고도에 따라
 * 38배 변하므로, **밉맵 없이는 지평선 부근이 반드시 앨리어싱**합니다.
 * 밉맵을 쓰려면 텍스처여야 하고, 텍스처면 한 번 구워 두는 게 맞습니다.
 *
 * ## 왜 히스토그램 평활화인가
 *
 * 지금 덱은 운량 39%에서 하늘의 13.8%만 덮습니다 (-25.2%p, 측정:
 * `tools/shader-preview/measure-cloud-scale.js`). 계수를 잘못 고른 게 아니라
 * **고칠 수 없는 형태의 오차**입니다 — fbm 4옥타브 합은 중심극한정리로
 * 가우시안에 뭉치는데 문턱은 선형으로 움직입니다. 분포 꼬리에서는 문턱을
 * 옮겨도 면적이 안 변하고 중앙에서는 급변하니, 어떤 값을 넣어도 전 구간에서
 * 맞을 수가 없습니다.
 *
 * 값 분포를 **균등분포로 펴 두면** `v >= 1 - cover` 의 통과 면적이 정확히
 * `cover`가 됩니다. 근사가 아니라 정의로 그렇습니다. 굽는 단계에서
 * 히스토그램 누적 한 번이면 끝나므로 런타임 비용은 0입니다.
 * 측정: 운량 0.39에서 오차 -25.2%p → **-0.32%p**.
 *
 * ## 밉 레벨마다 다시 폅니다
 *
 * 상자 필터로 축소하면 값이 평균 쪽으로 몰려 분포가 좁아집니다. 그대로 두면
 * 먼 하늘(=거친 밉)에서 운량이 다시 틀립니다. 그래서 **레벨마다 따로**
 * 평활화합니다. 모든 레벨이 각자 균등분포이므로 어느 거리에서도 운량이 맞습니다.
 *
 * ## 타일 가능성
 *
 * 격자 해시를 옥타브별 주기로 나머지 연산해 감쌉니다. `CloudDeck.ts`의 fbm은
 * 옥타브 사이에 회전을 넣는데, 회전은 격자 주기를 깨므로 여기서는 쓸 수 없습니다.
 * 대신 **옥타브별 오프셋 + 도메인 워프**로 축 정렬 무늬를 흩뜨립니다.
 * 워프가 없으면 운량 0.6 부근에서 정사각 격자결이 눈에 띕니다 (렌더로 확인).
 */

/** 굽기 설정 */
export interface CellFieldOptions {
  /** 한 변 픽셀 수 (2의 거듭제곱) */
  size?: number;
  /** 타일 하나에 들어가는 셀 개수 — 옥타브 0의 주파수 */
  tileCells?: number;
  /** 옥타브 수 */
  octaves?: number;
  /**
   * 무늬 종류.
   *  - `fbm`    : 보통 값 노이즈 합. 덩어리가 불규칙하게 이어짐.
   *  - `billow` : |2n-1| 접기. 둥근 알갱이가 또렷해져 고적운/권적운에 가까움.
   */
  variant?: 'fbm' | 'billow';
  /**
   * 도메인 워프 세기 (uv 단위, 0이면 끄기).
   *
   * Why: 타일을 유지하려면 옥타브 사이 회전을 못 씁니다(회전이 격자 주기를
   * 깹니다). 그런데 회전이 없으면 값 노이즈의 정사각 격자가 그대로 드러나
   * **축 방향으로 정렬된 결**이 보입니다 — 운량 0.6 부근에서 특히 두드러집니다.
   *
   * 저주파 노이즈로 표본 위치 자체를 밀어 격자를 흩뜨립니다. 워프 필드도
   * 주기적이므로 타일 가능성은 그대로입니다.
   */
  warp?: number;
  /** 난수 씨앗 */
  seed?: number;
}

export interface CellField {
  /** size × size, 값이 0~255에 **균등분포** */
  data: Uint8Array;
  size: number;
  /** 밉 체인 (레벨 0 = data). 각 레벨이 따로 평활화되어 있습니다. */
  mips: Uint8Array[];
  options: Required<CellFieldOptions>;
}

const DEFAULTS: Required<CellFieldOptions> = {
  size: 512,
  tileCells: 16,
  octaves: 5,
  variant: 'billow',
  warp: 0.035,
  seed: 1,
};

/** 격자 해시 — 주기 안에서 감싸므로 타일이 이어집니다. */
function hash2(ix: number, iy: number, period: number, seed: number): number {
  // 음수 좌표도 주기 안으로 접습니다.
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 주기적 값 노이즈 (smoothstep 보간 — CloudDeck.ts와 같은 커널) */
function periodicNoise(
  px: number,
  py: number,
  period: number,
  seed: number
): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, period, seed);
  const b = hash2(ix + 1, iy, period, seed);
  const c = hash2(ix, iy + 1, period, seed);
  const d = hash2(ix + 1, iy + 1, period, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/**
 * uv(0~1)에서의 필드 값. 아직 평활화 전이라 분포가 고르지 않습니다.
 *
 * 옥타브 i의 격자 주기는 `tileCells * 2^i` 이므로 uv 1에서 항상 정수 격자에
 * 떨어집니다 — 이것이 타일 가능성의 전부입니다.
 */
function rawField(
  u0: number,
  v0: number,
  o: Required<CellFieldOptions>
): number {
  let u = u0;
  let v = v0;

  // 도메인 워프 — 격자 정렬을 흩뜨립니다. 워프 필드도 주기적이라 타일 유지.
  if (o.warp > 0) {
    const W = o.tileCells;
    const wu = periodicNoise(u * W, v * W, W, o.seed + 31) - 0.5;
    const wv = periodicNoise(u * W + 3.7, v * W + 1.3, W, o.seed + 37) - 0.5;
    u += wu * o.warp;
    v += wv * o.warp;
  }

  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    const period = o.tileCells * (1 << i);
    // 옥타브마다 어긋나게 밀어 축 정렬 격자무늬를 흩뜨립니다.
    // (회전을 쓰면 격자 주기가 깨져 타일이 이어지지 않습니다)
    const offU = i * 0.37;
    const offV = i * 0.71;
    let n = periodicNoise((u + offU) * period, (v + offV) * period, period, o.seed + i);
    if (o.variant === 'billow') {
      // |2n-1| — 골짜기가 접혀 올라오면서 둥근 알갱이가 또렷해집니다.
      n = Math.abs(2 * n - 1);
    }
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * 값 배열을 **0~255 균등분포**로 폅니다.
 *
 * 값 k가 정확히 전체의 1/256을 차지하므로, `v >= t` 의 통과 면적이
 * 정확히 `1 - t/256` 이 됩니다.
 */
export function equalize(values: Float32Array): Uint8Array {
  const n = values.length;
  if (n === 0) return new Uint8Array(0);

  // 비교 정렬을 쓰지 않습니다. 출력이 256단계뿐이라 **순위만** 알면 되고,
  // 순위는 히스토그램 누적으로 O(n)에 구할 수 있습니다.
  // (512²×4채널 기준 정렬 1,876ms → 히스토그램 방식으로 크게 줄어듭니다.)
  const BINS = 8192;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  if (span <= 0) return new Uint8Array(n); // 상수 필드 — 나눌 것이 없습니다

  const scale = (BINS - 1) / span;
  const hist = new Uint32Array(BINS);
  const bin = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const b = ((values[i] - lo) * scale) | 0;
    bin[i] = b;
    hist[b]++;
  }

  // 빈 b의 대표 순위 = 앞선 개수 + 자기 빈의 절반.
  // 빈 하나에 평균 n/8192개가 들어가므로 순위 오차는 그 절반, 면적으로는
  // 0.03% 미만입니다 — 합격선 2%p에 견주면 무시할 수 있습니다.
  const binLevel = new Uint8Array(BINS);
  let cum = 0;
  for (let b = 0; b < BINS; b++) {
    const c = hist[b];
    if (c > 0) {
      const rank = cum + c * 0.5;
      let lv = Math.floor((rank * 256) / n);
      if (lv > 255) lv = 255;
      binLevel[b] = lv;
      cum += c;
    }
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = binLevel[bin[i]];
  return out;
}

/** 상자 필터로 절반 크기로 줄입니다 (감싸기 불필요 — 짝수 크기라 딱 떨어집니다). */
function downsample(src: Uint8Array, size: number): Float32Array {
  const half = size >> 1;
  const out = new Float32Array(half * half);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const i0 = 2 * y * size + 2 * x;
      const i1 = i0 + 1;
      const i2 = i0 + size;
      const i3 = i2 + 1;
      out[y * half + x] = (src[i0] + src[i1] + src[i2] + src[i3]) * 0.25;
    }
  }
  return out;
}

/**
 * 셀 필드를 굽습니다.
 *
 * 반환된 모든 밉 레벨이 각자 균등분포이므로, 어느 거리에서 봐도
 * `v >= 255 * (1 - cover)` 의 면적이 `cover`가 됩니다.
 */
export function bakeCellField(opts: CellFieldOptions = {}): CellField {
  const o: Required<CellFieldOptions> = { ...DEFAULTS, ...opts };
  const { size } = o;

  const raw = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      raw[y * size + x] = rawField(x / size, y / size, o);
    }
  }

  const level0 = equalize(raw);
  const mips: Uint8Array[] = [level0];

  // 레벨마다 **다시** 폅니다 — 상자 필터가 분포를 좁히기 때문입니다.
  let cur = level0;
  let curSize = size;
  while (curSize > 1) {
    const smaller = downsample(cur, curSize);
    curSize >>= 1;
    cur = equalize(smaller);
    mips.push(cur);
  }

  return { data: level0, size, mips, options: o };
}

/**
 * 문턱 `1 - cover` 를 넘는 면적 비율. 검증용입니다.
 * 평활화가 제대로 됐으면 `cover`와 같아야 합니다.
 */
export function coverageAt(data: Uint8Array, cover: number): number {
  const t = (1 - cover) * 256;
  let hit = 0;
  for (let i = 0; i < data.length; i++) if (data[i] >= t) hit++;
  return hit / data.length;
}

/** 여러 필드를 RGBA 한 장으로 묶은 결과 */
export interface PackedCellField {
  size: number;
  /** 레벨 0부터의 밉 체인. 각 레벨이 RGBA 인터리브. */
  levels: { data: Uint8Array; width: number; height: number }[];
  channels: number;
  options: Required<CellFieldOptions>;
}

/**
 * 최대 4개의 필드를 RGBA 한 장에 담습니다.
 *
 * Why: 덱은 층이 3개인데 셋이 **같은 무늬를 쓰면 안 됩니다** — 저·중·상층
 * 구름이 완벽히 겹쳐 보이면 하늘이 한 장짜리로 보입니다. 채널마다 다른 씨앗을
 * 넣어 두면 텍스처 한 장, 페치 한 번으로 층마다 다른 무늬를 씁니다.
 *
 * 단일 채널 포맷(LUMINANCE)은 three r185에서 사라졌고 RED는 WebGL2 전용이라,
 * 어차피 RGBA가 가장 안전합니다. 남는 채널을 버리는 대신 쓰는 셈입니다.
 */
export function packCellFieldsRGBA(fields: CellField[]): PackedCellField {
  if (fields.length === 0) throw new Error('필드가 없습니다');
  if (fields.length > 4) throw new Error('RGBA는 최대 4채널입니다');
  const size = fields[0].size;
  const mipCount = fields[0].mips.length;
  for (const f of fields) {
    if (f.size !== size) throw new Error('필드 크기가 서로 다릅니다');
    if (f.mips.length !== mipCount) throw new Error('밉 단수가 서로 다릅니다');
  }

  const levels: { data: Uint8Array; width: number; height: number }[] = [];
  for (let lv = 0; lv < mipCount; lv++) {
    const side = size >> lv;
    const n = side * side;
    const rgba = new Uint8Array(n * 4);
    for (let c = 0; c < 4; c++) {
      // 채널이 모자라면 앞 필드를 돌려 씁니다 (씨앗은 달라도 채널은 4개 고정).
      const src = fields[c % fields.length].mips[lv];
      for (let i = 0; i < n; i++) rgba[i * 4 + c] = src[i];
    }
    levels.push({ data: rgba, width: side, height: side });
  }

  return { size, levels, channels: fields.length, options: fields[0].options };
}

// ── 밉 필터 보정 ───────────────────────────────────────────────────────────
//
// 레벨마다 평활화해 뒀는데도 **GPU 삼선형 필터가 업로드 이후에** 값을 다시
// 평균 쪽으로 좁힙니다. 레벨 안의 쌍선형 보간과 레벨 사이의 선형 혼합, 둘 다
// 평균 연산이기 때문입니다. 그대로 두면 축소할수록 운량이 어긋납니다 —
// 측정(tools/shader-preview/build-cell-gl-preview.js): 운량 0.15, 텍셀/픽셀 44에서
// **-11.29%p**.
//
// 고치는 방법: 필터가 분포를 s배로 좁혔으면 문턱도 중앙 쪽으로 s배 당깁니다.
// 좁아진 분포에서 **같은 분위수**를 집는 것이라 면적이 되돌아옵니다.
//
// s는 텍셀/픽셀의 함수로 측정해 로짓형으로 맞췄습니다 (RMS 0.0020):
//
//   텍셀/픽셀 │  1.4   2.7   5.5   10.9   21.8   43.6
//   측정 s    │ 1.002 0.990 0.967 0.920  0.855  0.811
//
// 높은 축소에서 s가 0.79 부근에 멈추는 것이 레벨별 평활화가 실제로 일하고
// 있다는 증거입니다 — 안 그러면 계속 0.5로 수렴합니다.
//
// **반드시 `cell_sample`(두 번 뽑기)로 재야 합니다.** 처음에 한 번 뽑기로
// 재서 맞췄더니 운량 0.85 꼬리에서 2.19%p 어긋났습니다 — 두 번 뽑고 재평활한
// 분포는 덜 좁아지기 때문입니다. 측정 경로와 출하 경로가 같아야 합니다.

/** 극한 축소에서의 수축률 하한 */
export const MIP_SHRINK_MIN = 0.785;
/** 수축이 절반쯤 진행되는 log2(텍셀/픽셀) */
export const MIP_SHRINK_MID = 3.85;
/** 수축 곡선의 완만함 */
export const MIP_SHRINK_K = 0.80;

/**
 * 두 번째 표본의 배율 (황금비의 역수).
 *
 * 무리수를 쓰는 이유: 유리수면 두 표본의 주기가 언젠가 맞아떨어져 반복이
 * 되살아납니다. 황금비는 유리수로 가장 근사하기 어려운 수라 주기가 가장
 * 늦게 맞습니다.
 */
export const CELL_TAP2_SCALE = 0.6180339887;

/**
 * 필터가 분포를 얼마나 좁혔는가 (1 = 그대로, 작을수록 좁아짐).
 * @param texelsPerPixel 화면 픽셀 하나가 덮는 텍스처 텍셀 수
 */
export function mipShrink(texelsPerPixel: number): number {
  const x = Math.log2(Math.max(1e-3, texelsPerPixel));
  return (
    MIP_SHRINK_MIN +
    (1 - MIP_SHRINK_MIN) / (1 + Math.exp((x - MIP_SHRINK_MID) / MIP_SHRINK_K))
  );
}

/**
 * 운량에 해당하는 **보정된 문턱**.
 *
 * 평활화된 필드라 보정 전 문턱은 그냥 `1 - cover` 입니다. 여기에 필터 수축을
 * 반영해 중앙(0.5)으로 당깁니다.
 */
export function cellThreshold(cover: number, texelsPerPixel: number): number {
  const s = mipShrink(texelsPerPixel);
  return 0.5 + (1 - cover - 0.5) * s;
}

/**
 * 위 두 함수의 GLSL 판본. **상수를 TS에서 주입**하므로 두 구현이 갈라지지
 * 않습니다 (`ATMOSPHERE_GLSL`과 같은 방식).
 */
export const CELL_FIELD_GLSL = `
const float MIP_SHRINK_MIN = ${MIP_SHRINK_MIN};
const float MIP_SHRINK_MID = ${MIP_SHRINK_MID};
const float MIP_SHRINK_K   = ${MIP_SHRINK_K};
const float CELL_TAP2_SCALE = ${CELL_TAP2_SCALE};

// 삼선형 필터가 값 분포를 좁힌 정도. 1 = 그대로.
float cell_mipShrink(float texelsPerPixel) {
  float x = log2(max(1e-3, texelsPerPixel));
  return MIP_SHRINK_MIN +
         (1.0 - MIP_SHRINK_MIN) / (1.0 + exp((x - MIP_SHRINK_MID) / MIP_SHRINK_K));
}

// 운량 → 보정된 문턱. 평활화된 필드라 보정 전은 그냥 1 - cover 입니다.
float cell_threshold(float cover, float texelsPerPixel) {
  return 0.5 + (1.0 - cover - 0.5) * cell_mipShrink(texelsPerPixel);
}

/**
 * 셀 필드 표본.
 *
 * 한 번만 뽑으면 **타일 반복이 눈에 보입니다** — 축소가 커질수록 정사각
 * 격자로 짜인 무늬가 드러납니다 (렌더로 확인). 그래서 두 번 뽑아 섞습니다:
 * 두 번째 표본은 비격자 회전 + 무리수 배율이라 두 주기가 좀처럼 맞지 않아
 * 눈에 보이는 반복 주기가 훨씬 길어집니다.
 *
 * 다만 균등분포 둘을 평균하면 **삼각분포**가 되어 평활화가 깨집니다.
 * 그러면 운량 보장이 무너지므로 해석적 CDF로 다시 폅니다:
 *   F(s) = 2s²          (s ≤ 0.5)
 *   F(s) = 1 - 2(1-s)²  (s > 0.5)
 * 이 변환을 거치면 결과가 다시 균등분포라 문턱을 그대로 쓸 수 있습니다.
 *
 * maskA/maskB로 RGBA 중 어느 채널을 쓸지 고릅니다 (층마다 다르게).
 */
float cell_sample(sampler2D tex, vec2 uv, vec4 maskA, vec4 maskB) {
  float x = dot(texture2D(tex, uv), maskA);
  // 45° 회전 — 격자 축과 어긋나 두 표본이 같은 자리에서 되풀이되지 않습니다.
  vec2 r = vec2(uv.x - uv.y, uv.x + uv.y) * 0.70710678;
  float y = dot(texture2D(tex, r * CELL_TAP2_SCALE + vec2(0.37, 0.71)), maskB);

  float s = 0.5 * (x + y);
  // 삼각 → 균등 (위 CDF)
  return s <= 0.5 ? 2.0 * s * s : 1.0 - 2.0 * (1.0 - s) * (1.0 - s);
}
`;

/** `cell_sample`의 삼각→균등 재평활. GLSL과 같은 식이어야 합니다. */
export function reflattenTriangular(s: number): number {
  return s <= 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s);
}
