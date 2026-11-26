/**
 * 시간 슬라이더 해제 이후 볼륨 하늘 수렴·드리프트 시계 판정 및 24시간 예열 버킷 계산.
 *
 * 왜 분리했는가:
 * - 기존 `SkyScene3D` 는 매 프레임 `wallElapsedMs` 가 더해진 `vMs` 를 비교해
 *   사용자가 시간을 멈춰 두어도 매 프레임(16ms) `dateChanged = true` 가 발동하고
 *   `volSettleRef` 가 계속 18 로 되감겨 수렴이 끝나지 않으며 프리워밍이 막혔다.
 * - 선택 기준 시각(`targetMs`)과 바람 드리프트 경과를 분리하고, 순수 함수로 빼내
 *   헤드리스 검증 스크립트로 회귀를 직접 확인한다.
 */

export interface VolDateSyncState {
  targetMs: number | null;
  wallMs: number;
}

export interface DriftAnchor {
  sceneMs: number;
  wallMs: number;
}

export interface VolDateSyncInput {
  /** overrideSceneTimeMs ?? targetTimeMs */
  targetMs: number;
  /** renderLongExposure 등 명시적 고정 시각 덮어쓰기 여부 */
  overrideActive: boolean;
  /** 실제 렌더링에 쓰는 시각(targetMs + wallElapsedMs) */
  renderedMs: number;
  nowWall: number;
  lastSync: VolDateSyncState;
  driftAnchor: DriftAnchor | null;
  volPending: boolean;
  isInteracting: boolean;
  volSettleRemaining: number;
  /** '지금' 실시간 시계 추종 중 여부(!isTimeMachineEnabled) */
  isLiveClock: boolean;
}

export interface VolDateSyncDecision {
  shouldCallSetDate: boolean;
  driftSec: number;
  nextAnchor: DriftAnchor;
  nextLastSync: VolDateSyncState;
  shouldResetSettle: boolean;
}

const DRIFT_SYNC_INTERVAL_MS = 250;
const LIVE_CLOCK_MATCH_TOLERANCE_MS = 2000;
const LIVE_CLOCK_MAX_CONTINUOUS_STEP_MS = 120_000;

/**
 * 이번 프레임에 `vol.setDate` 호출 여부와 18프레임 TAAU 재수렴 시작 여부를 계산한다.
 */
export function evaluateVolDateSync(input: VolDateSyncInput): VolDateSyncDecision {
  const {
    targetMs,
    overrideActive,
    renderedMs,
    nowWall,
    lastSync,
    driftAnchor,
    volPending,
    isInteracting,
    volSettleRemaining,
    isLiveClock,
  } = input;

  if (overrideActive) {
    return {
      shouldCallSetDate: true,
      driftSec: renderedMs / 1000,
      nextAnchor: driftAnchor ?? { sceneMs: targetMs, wallMs: nowWall },
      nextLastSync: { targetMs, wallMs: nowWall },
      shouldResetSettle: false,
    };
  }

  const prevTargetMs = lastSync.targetMs;
  const targetDiffers = prevTargetMs === null || targetMs !== prevTargetMs;

  // '지금' 모드에서 1분 주기로 currentTime 이 실제 경과 시간만큼 넘어온 경우에는
  // 드리프트 앵커가 이미 같은 속도로 흘렀으므로 새 앵커/재수렴으로 취급하지 않는다.
  const sceneStepFromAnchor = driftAnchor ? targetMs - driftAnchor.sceneMs : 0;
  const wallStepFromAnchor = driftAnchor ? nowWall - driftAnchor.wallMs : 0;
  const singleTickStep = prevTargetMs !== null ? targetMs - prevTargetMs : Infinity;
  const isSeamlessLiveTick =
    isLiveClock &&
    prevTargetMs !== null &&
    driftAnchor !== null &&
    Math.abs(singleTickStep) <= LIVE_CLOCK_MAX_CONTINUOUS_STEP_MS &&
    Math.abs(sceneStepFromAnchor - wallStepFromAnchor) < LIVE_CLOCK_MATCH_TOLERANCE_MS;

  const dateChanged = targetDiffers && !isSeamlessLiveTick;
  const nextAnchor: DriftAnchor =
    dateChanged || !driftAnchor
      ? { sceneMs: targetMs, wallMs: nowWall }
      : driftAnchor;

  const driftElapsedMs = isLiveClock ? Math.max(0, nowWall - nextAnchor.wallMs) : 0;
  const driftSec = (nextAnchor.sceneMs + driftElapsedMs) / 1000;

  // 수렴 중(!isInteracting && volSettleRemaining > 0)에는 250ms 미세 드리프트 호출을 미뤄
  // TAAU 18프레임 수렴이 깔끔하게 끝난 뒤 2초 드리프트로 이어지게 한다.
  // 현재시간 실시간 자동재생(isLiveClock === true)일 때만 드리프트를 진행한다.
  const driftDue =
    isLiveClock &&
    !dateChanged &&
    (isInteracting || volSettleRemaining <= 0) &&
    nowWall - lastSync.wallMs >= DRIFT_SYNC_INTERVAL_MS;

  const shouldCallSetDate = dateChanged || driftDue;
  const nextLastSync: VolDateSyncState = shouldCallSetDate
    ? { targetMs, wallMs: nowWall }
    : isSeamlessLiveTick
      ? { targetMs, wallMs: lastSync.wallMs }
      : lastSync;

  return {
    shouldCallSetDate,
    driftSec,
    nextAnchor,
    nextLastSync,
    // 비동기 씬 빌드가 대기 중일 때는 완료 콜백에서 1회만 수렴하도록 여기서 리셋하지 않는다.
    shouldResetSettle: dateChanged && !volPending,
  };
}

/**
 * 하루 24시간의 정시+30분 버킷 목록을 현재 보고 있는 버킷과 가까운 순으로 정렬한다.
 */
export function buildDayPrewarmBuckets(dayStartMs: number, focusBucketMs: number): number[] {
  const buckets: number[] = [];
  for (let h = 0; h < 24; h++) {
    buckets.push(dayStartMs + h * 3600000 + 1800000);
  }
  buckets.sort((a, b) => Math.abs(a - focusBucketMs) - Math.abs(b - focusBucketMs));
  return buckets;
}
