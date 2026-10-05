/**
 * volumetricGovernor.ts — 볼륨 하늘(§126.7)의 **구름 해상도 자동 조절**과 기기 성능 수치(§127, E2-5).
 *
 * takram 볼륨 구름은 프래그먼트 부하가 화면 크기 × 구름 해상도 배율²에 비례합니다. 기기마다 GPU 가 크게 달라
 * 한 값으로 못 박을 수 없어, 실제 프레임 간격을 보고 배율을 계단으로 내리고 올립니다.
 *  - 이어서 그린 프레임 간격(250ms 미만)만 셉니다 — 하늘 화면은 필요할 때만 그리므로 쉬는 사이는 빼야 합니다.
 *  - 간격의 지수 평균이 slowMs 를 downAfter 번 연속 넘으면 한 계단 내리고, fastMs 밑으로 upAfter 번 연속이면 한 계단
 *    올립니다(설정한 최대 배율까지). 배율을 바꾸면 시간 업스케일 이력이 지워져 잠깐 거칠어지므로 자주 바꾸지 않게
 *    올리는 쪽을 훨씬 느리게 둡니다.
 * 순수 논리라 기기 없이 시험합니다(`tools/genus-ruler/volsky/governor-check.js`).
 */
export const VOLUMETRIC_RES_STEPS = [1, 0.75, 0.5, 0.35, 0.25] as const;

export interface GovernorConfig {
  /** 최대 배율(설정). 계단 중 이 값 이하에서만 움직입니다. */
  maxScale: number;
  /** 최소 배율 */
  minScale: number;
  /** 이보다 느리면(평균 프레임 간격 ms) 내림 — 50ms = 20fps */
  slowMs: number;
  /** 이보다 빠르면 올림 — 28ms ≈ 36fps */
  fastMs: number;
  downAfter: number;
  upAfter: number;
}
export const DEFAULT_GOVERNOR: GovernorConfig = { maxScale: 0.5, minScale: 0.25, slowMs: 50, fastMs: 28, downAfter: 20, upAfter: 150 };

export interface ResolutionGovernor {
  readonly scale: number;
  readonly emaMs: number;
  /** 프레임 간격 한 표본. 배율이 바뀌면 새 배율, 아니면 null. */
  sample(intervalMs: number): number | null;
  /** 최대 배율을 바꿉니다(설정). 지금 배율이 넘으면 곧바로 내려 새 배율을 돌려줍니다. */
  setMax(maxScale: number): number | null;
}

export function createResolutionGovernor(cfg: Partial<GovernorConfig> = {}): ResolutionGovernor {
  const c: GovernorConfig = { ...DEFAULT_GOVERNOR, ...cfg };
  const allowed = (): number[] => VOLUMETRIC_RES_STEPS.filter(s => s <= c.maxScale + 1e-6 && s >= c.minScale - 1e-6);
  let steps = allowed();
  let idx = 0;              // steps[0] = 가장 큰 허용 배율
  let ema = 0, slow = 0, fast = 0;
  return {
    get scale() { return steps[idx] ?? c.maxScale; },
    get emaMs() { return ema; },
    sample(ms: number) {
      if (!(ms > 0) || ms >= 250) return null;   // 쉬었다 다시 그린 프레임은 빼기
      ema = ema === 0 ? ms : ema + (ms - ema) * 0.1;
      if (ema > c.slowMs) { slow++; fast = 0; } else if (ema < c.fastMs) { fast++; slow = 0; } else { slow = 0; fast = 0; }
      if (slow >= c.downAfter && idx < steps.length - 1) { idx++; slow = 0; ema = 0; return steps[idx]; }
      if (fast >= c.upAfter && idx > 0) { idx--; fast = 0; ema = 0; return steps[idx]; }
      return null;
    },
    setMax(maxScale: number) {
      const before = steps[idx];
      c.maxScale = maxScale;
      steps = allowed();
      if (steps.length === 0) steps = [maxScale];
      // 지금 배율이 새 범위 안이면 그 자리, 아니면 가장 가까운 허용 값
      const j = steps.findIndex(s => s <= before + 1e-6);
      idx = j < 0 ? steps.length - 1 : j;
      return steps[idx] !== before ? steps[idx] : null;
    },
  };
}

/** 개발자 패널이 읽는 볼륨 하늘 수치(하늘 화면이 매 프레임 씁니다). 상태(준비 중·실패)는 `volumetricStatus.ts`. */
export const volumetricStats = {
  /** 이어서 그린 프레임 간격의 지수 평균(ms) */
  frameMs: 0,
  /** 지금 구름 해상도 배율 */
  resScale: 0,
  quality: 'low' as 'low' | 'medium' | 'high',
  /** 마지막 날씨 무늬 생성 시간(ms) — 잘라 만들므로 화면이 멈춘 시간은 아님 */
  weatherMs: 0,
  /** 대기 표 생성 시간(ms) */
  atmosMs: 0,
};
