/**
 * 자이로 방위와 자기 방위를 합쳐 **진짜 방위각**을 내는 논리.
 *
 * ## 왜 따로 뺐나
 *
 * 실기 보고: "동쪽을 바라보면 북쪽이라고 뜬다(90도쯤 차이). 지자기 초기화도
 * 잘 동작 안 하는 것 같고 8자로 흔들어도 그렇게까지 잘 맞지는 않는다."
 *
 * `SunCamera.tsx` 안에 흩어져 있던 이 논리는 화면·센서에 붙어 있어
 * **기기 없이는 한 줄도 시험할 수 없었습니다.** 순수 함수로 빼내면 가짜
 * 센서 열을 먹여 판정할 수 있습니다(`verify-heading-fusion.js`).
 *
 * ## 예전 논리의 결함 넷 — 전부 코드에서 확인됩니다
 *
 * 1. **경주(race).** `rawGyroHeadingRef` 는 **0 으로 초기화**되고, 자기
 *    heading 콜백은 자이로 샘플이 왔는지 **안 보고** 첫 샘플로 오프셋을
 *    확정했습니다(`northOffset = heading - 0 = heading`). 자이로가 먼저
 *    오면 맞고, 자기 쪽이 먼저 오면 그 순간의 진짜 자이로 방위만큼
 *    통째로 어긋납니다. 화면을 열 때마다 어느 쪽이 먼저인지에 달렸습니다.
 * 2. **자세를 안 봅니다.** 전방 벡터가 천정·바닥에 가까우면 방위는 수치적
 *    으로 무의미합니다(수평 성분이 0 으로 가서 atan2 가 튑니다). 폰을
 *    책상에 눕힌 채 화면을 열면 그 값으로 오프셋이 잡힙니다.
 * 3. **한 표본으로 확정합니다.** 자기계는 튀는데 첫 표본 하나를 그대로
 *    씁니다.
 * 4. **되돌릴 길이 사실상 없습니다.** 보정률이 0.001 이라 시정수가 표본
 *    1000개 — 초당 5~10개면 **2~3분**입니다. 처음에 잘못 잡히면 한참
 *    갑니다. "8자로 흔들어도 잘 안 맞는다" 가 이것입니다(8자는 자기계를
 *    고치는 것이지 이 오프셋을 고치는 게 아닙니다).
 *
 * ## 여기서 바꾼 것
 *
 *  - 자이로 표본이 **하나라도 오기 전에는** 자기 표본을 안 씁니다.
 *  - 전방 벡터의 수평 길이가 짧으면(천정·바닥) **씨앗으로 안 씁니다.**
 *  - 씨앗은 표본 여러 개의 **원형 평균**입니다.
 *  - 잡은 뒤에는 **처음엔 빠르게, 나중엔 느리게** 따라갑니다. 오래된 뒤의
 *    느린 드리프트만 잡으면 되기 때문입니다.
 *  - 큰 튐은 **연속으로 같은 말을 할 때만** 받아들입니다.
 *  - 상태를 밖에서 볼 수 있게 내놓습니다 — 화면에 띄우면 "초기화가 되고
 *    있나"를 눈으로 확인할 수 있습니다.
 *
 * ⚠ **자기 편각은 여기서 안 다룹니다.** 진북 heading 을 못 얻어 자북을
 * 쓰면 한국에서 약 8° 어긋나는데, 그건 이 모듈이 아니라 부르는 쪽이
 * `isTrueNorth` 로 알려 주고 화면이 사용자에게 알릴 일입니다.
 */

/** 각도를 -180~180 으로 접습니다. */
export function wrap180(deg: number): number {
  return ((deg + 540) % 360) - 180;
}
/** 각도를 0~360 으로 접습니다. */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface HeadingFusionOptions {
  /** 씨앗으로 삼을 표본 수. 기본 8. */
  seedSamples?: number;
  /**
   * 전방 벡터의 수평 길이 하한. 이보다 짧으면 방위가 무의미하므로 씨앗에
   * 안 씁니다. 기본 0.30 — 전방이 수평에서 ±72.5° 안쪽이라는 뜻입니다.
   */
  minHorizontal?: number;
  /** 씨앗 직후 빠르게 따라가는 구간의 표본 수. 기본 40. */
  fastSamples?: number;
  /** 빠른 구간의 보정률. 기본 0.12. */
  fastRate?: number;
  /** 느린 구간의 보정률. 기본 0.004. */
  slowRate?: number;
  /** 이보다 크게 어긋난 표본은 연속 확인을 요구합니다(도). 기본 45. */
  outlierDeg?: number;
  /** 튄 값을 받아들이는 데 필요한 연속 표본 수. 기본 5. */
  outlierStreak?: number;
}

export interface HeadingFusionStatus {
  /** 오프셋이 잡혔는가. */
  seeded: boolean;
  /** 씨앗에 쓰인(또는 쓰일) 표본 수. */
  seedCount: number;
  /** 씨앗 뒤 받아들인 자기 표본 수. */
  trackCount: number;
  /** 지금 오프셋(도). */
  offsetDeg: number;
  /** 자이로 표본이 온 적 있는가. */
  hasGyro: boolean;
  /** 자기 표본이 온 적 있는가. */
  hasMagnetic: boolean;
  /** 진북을 받고 있는가. false 면 자북이라 편각만큼 어긋납니다. */
  trueNorth: boolean;
  /** 마지막으로 자기 표본을 **버린** 이유. 안 버렸으면 null. */
  lastReject: 'no-gyro' | 'ill-pose' | 'outlier' | null;
}

export interface HeadingFusion {
  /**
   * 자이로 표본. `rawHeadingDeg` 는 보정 전 방위, `horizontal` 은 전방
   * 벡터의 수평 길이(0~1) — 자세가 쓸 만한지 가리는 데 씁니다.
   */
  pushGyro(rawHeadingDeg: number, horizontal: number): void;
  /** 자기(OS) 방위 표본. */
  pushMagnetic(headingDeg: number, isTrueNorth: boolean): void;
  /** 보정된 방위(도, 0~360). 자이로 표본이 없으면 null. */
  heading(): number | null;
  status(): HeadingFusionStatus;
  /** 다시 잡습니다 — 사용자가 '보정' 을 누를 때. */
  reset(): void;
  /** 태양 스냅처럼 **정답을 아는** 경우 오프셋을 바로 못 박습니다. */
  snapTo(trueHeadingDeg: number): void;
}

export function createHeadingFusion(opts: HeadingFusionOptions = {}): HeadingFusion {
  const seedSamples = opts.seedSamples ?? 8;
  const minHorizontal = opts.minHorizontal ?? 0.30;
  const fastSamples = opts.fastSamples ?? 40;
  const fastRate = opts.fastRate ?? 0.12;
  const slowRate = opts.slowRate ?? 0.004;
  const outlierDeg = opts.outlierDeg ?? 45;
  const outlierStreak = opts.outlierStreak ?? 5;

  let rawGyro = 0;
  let gyroHorizontal = 0;
  let hasGyro = false;
  let hasMagnetic = false;
  let trueNorth = false;

  let offset = 0;
  let seeded = false;
  // 씨앗 표본은 원형 평균이라 벡터로 모읍니다 — 0°/360° 경계에서 평균이
  // 180° 로 튀는 것을 막습니다.
  let seedX = 0, seedY = 0, seedCount = 0;
  let trackCount = 0;
  let outlierRun = 0, outlierSumX = 0, outlierSumY = 0;
  let lastReject: HeadingFusionStatus['lastReject'] = null;

  const applyOffset = (raw: number) => wrap360(raw + offset);

  return {
    pushGyro(rawHeadingDeg, horizontal) {
      rawGyro = rawHeadingDeg;
      gyroHorizontal = horizontal;
      hasGyro = true;
    },

    pushMagnetic(headingDeg, isTrue) {
      hasMagnetic = true;
      trueNorth = isTrue;

      // ① 자이로가 아직 없으면 못 씁니다. 예전 코드는 여기서 rawGyro 를
      //    0 으로 읽어 오프셋을 통째로 잘못 잡았습니다.
      if (!hasGyro) { lastReject = 'no-gyro'; return; }

      // ② 자세가 서 있지 않으면(전방이 천정·바닥에 가까우면) 방위가
      //    무의미합니다. 씨앗에도 추적에도 안 씁니다.
      if (gyroHorizontal < minHorizontal) { lastReject = 'ill-pose'; return; }

      const rawOffset = wrap180(headingDeg - rawGyro);

      if (!seeded) {
        const r = (rawOffset * Math.PI) / 180;
        seedX += Math.cos(r); seedY += Math.sin(r); seedCount++;
        if (seedCount >= seedSamples) {
          offset = (Math.atan2(seedY, seedX) * 180) / Math.PI;
          seeded = true;
        } else {
          // 아직 씨앗 중 — 그동안은 지금까지의 평균을 씁니다.
          offset = (Math.atan2(seedY, seedX) * 180) / Math.PI;
        }
        lastReject = null;
        return;
      }

      const diff = wrap180(rawOffset - offset);

      // ③ 크게 튄 값은 **연속으로 같은 말을 할 때만** 받습니다. 한 번 튄
      //    자기계에 끌려가지 않으면서도, 진짜로 틀어졌으면 따라갑니다.
      if (Math.abs(diff) > outlierDeg) {
        const r = (rawOffset * Math.PI) / 180;
        outlierRun++; outlierSumX += Math.cos(r); outlierSumY += Math.sin(r);
        if (outlierRun >= outlierStreak) {
          offset = (Math.atan2(outlierSumY, outlierSumX) * 180) / Math.PI;
          outlierRun = 0; outlierSumX = 0; outlierSumY = 0;
          trackCount++;
          lastReject = null;
        } else {
          lastReject = 'outlier';
        }
        return;
      }
      outlierRun = 0; outlierSumX = 0; outlierSumY = 0;

      // ④ 처음엔 빠르게, 나중엔 느리게. 예전에는 줄곧 0.001 이라 잘못
      //    잡히면 표본 1000개(2~3분) 동안 그대로였습니다.
      const rate = trackCount < fastSamples ? fastRate : slowRate;
      offset = wrap180(offset + diff * rate);
      trackCount++;
      lastReject = null;
    },

    heading() {
      return hasGyro ? applyOffset(rawGyro) : null;
    },

    status() {
      return {
        seeded, seedCount, trackCount,
        offsetDeg: +wrap180(offset).toFixed(2),
        hasGyro, hasMagnetic, trueNorth, lastReject,
      };
    },

    reset() {
      offset = 0; seeded = false;
      seedX = 0; seedY = 0; seedCount = 0; trackCount = 0;
      outlierRun = 0; outlierSumX = 0; outlierSumY = 0;
      lastReject = null;
    },

    snapTo(trueHeadingDeg) {
      offset = wrap180(trueHeadingDeg - rawGyro);
      seeded = true;
      seedCount = seedSamples;
      // 스냅 뒤에는 자기계가 천천히만 끌어가게 둡니다.
      trackCount = fastSamples;
      outlierRun = 0; outlierSumX = 0; outlierSumY = 0;
      lastReject = null;
    },
  };
}
