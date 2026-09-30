/**
 * motion.ts — 움직임 도우미. 값은 `tokens.motion` 에서, 규칙은 docs/DESIGN_SYSTEM.md §7.
 *
 * 모든 애니메이션은 이 도우미를 거쳐서 "동작 줄이기"(OS 접근성 설정)를 따릅니다:
 * 켜져 있으면 스프링·이동은 곧바로 끝값으로 갑니다.
 */
import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { motion } from './tokens';

/** 웹(react-native-web)엔 네이티브 드라이버가 없습니다. */
export const NATIVE = Platform.OS !== 'web';

let reduced = false;
try {
  AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduced = !!v; }).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { reduced = !!v; });
} catch {
  // 일부 플랫폼엔 없음 — 기본은 움직임 켬.
}
export const isReducedMotion = () => reduced;

type SpringKind = keyof typeof motion.spring;
type DurationKind = keyof typeof motion.duration;
type EasingKind = keyof typeof motion.easing;

/** 스프링으로 끝값까지. 동작 줄이기면 즉시. */
export function springTo(
  value: Animated.Value,
  toValue: number,
  kind: SpringKind,
  opts: { useNativeDriver?: boolean; velocity?: number } = {},
): Animated.CompositeAnimation {
  const useNativeDriver = opts.useNativeDriver ?? NATIVE;
  if (reduced) return Animated.timing(value, { toValue, duration: 0, useNativeDriver });
  return Animated.spring(value, { toValue, ...motion.spring[kind], velocity: opts.velocity, useNativeDriver });
}

/** 시간으로 끝값까지. 동작 줄이기면 즉시(단, `keepWhenReduced` 는 색·투명도처럼 움직임이 아닌 것). */
export function timeTo(
  value: Animated.Value,
  toValue: number,
  duration: DurationKind,
  easing: EasingKind = 'standard',
  opts: { useNativeDriver?: boolean; keepWhenReduced?: boolean } = {},
): Animated.CompositeAnimation {
  const useNativeDriver = opts.useNativeDriver ?? NATIVE;
  const ms = reduced && !opts.keepWhenReduced ? 0 : motion.duration[duration];
  return Animated.timing(value, { toValue, duration: ms, easing: motion.easing[easing], useNativeDriver });
}

/** 너비(px)에 맞춘 누름 배율 — 가장자리가 `insetPx` 만큼 들어가도록, 범위 안에서. */
export function pressScaleFor(width: number): number {
  const { insetPx, minScale, maxScale } = motion.press;
  if (!(width > 0)) return minScale;
  return Math.min(maxScale, Math.max(minScale, 1 - (2 * insetPx) / width));
}
