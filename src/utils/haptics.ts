/**
 * haptics.ts — 진동 셋(디자인 시스템 §8.4, 2026-10-25 · 3단).
 *
 *  - 셔터: impact medium
 *  - 시간 막대가 일출 · 일몰 표시를 지날 때: selection
 *  - 사용자에게 알리는 오류(촬영 · 올리기 · 날씨 받기 실패): notification error
 *
 * 이 셋 말고는 진동하지 않습니다 — 누를 때마다 떨면 아무것도 알리지 못합니다.
 *
 * ## 옛 빌드에서도 멈추지 않게
 *
 * 앱은 `expo-updates` 로 새 JS 를 받는데 `runtimeVersion` 이 고정("1.0.0")이라 **햅틱 모듈이 없는 옛 스토어
 * 빌드도 이 코드를 받습니다.** `expo-haptics` 15 는 네이티브 모듈을 `requireOptionalNativeModule` 로 찾으므로
 * 불러오기만으로는 죽지 않고, 없으면 호출이 `UnavailabilityError` 로 거절됩니다. 여기서 그 거절(과 혹시 모를
 * 동기 예외)을 삼킵니다. 그래서 옛 빌드에서는 조용히 진동만 없습니다.
 */
import * as Haptics from 'expo-haptics';

const quietly = (run: () => Promise<void>) => {
  try {
    run().catch(() => {});
  } catch {
    // 모듈이 없거나 플랫폼이 지원하지 않음 — 진동 없이 지나갑니다.
  }
};

/** 셔터를 눌렀을 때. */
export const hapticShutter = () => quietly(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** 시간 막대 손잡이가 일출 · 일몰 표시를 지날 때. */
export const hapticTick = () => quietly(() => Haptics.selectionAsync());

/** 사용자에게 알리는 오류. */
export const hapticError = () => quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

/**
 * `prev` → `next` 분으로 옮길 때 지난 표시가 있는가. 표시와 같은 분에 닿으면 지난 것으로 칩니다.
 * 시간 막대가 끄는 동안 부릅니다(`DateTimeBar`).
 */
export function crossesMarker(prev: number, next: number, markers: readonly (number | null | undefined)[]): boolean {
  if (prev === next) return false;
  return markers.some(m => m != null && Number.isFinite(m) && (prev < m) !== (next < m));
}
