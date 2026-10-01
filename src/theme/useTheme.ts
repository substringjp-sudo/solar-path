/**
 * useTheme.ts — 화면 모드(어둡게 · 밝게 · 시스템)를 읽어 팔레트를 고릅니다.
 *
 * 밝은 모드는 **패널 · 창 · 기록 탭 · 헤더만** 바꿉니다. 하늘·지도 위의 떠 있는 것과 촬영 화면은
 * 이 훅을 쓰지 않고 `tokens.color`(어두운 값)를 그대로 씁니다(docs/DESIGN_SYSTEM.md §4.1).
 *
 * 쓰는 법:
 *   const useStyles = makeStyles((color) => ({ box: { backgroundColor: color.panel } }));
 *   function Comp() { const color = useThemeColors(); const styles = useStyles(); … }
 */
import { StyleSheet, useColorScheme } from 'react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { palettes, color as DARK, type Palette, type DataPalette, type Scheme } from './tokens';

export function useScheme(): Scheme {
  const mode = useCelestialStore((s) => s.themeMode);
  const system = useColorScheme();
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'light' ? 'light' : 'dark';
}

export const useThemeColors = (): Palette => palettes[useScheme()].color;
export const useDataColors = (): DataPalette => palettes[useScheme()].data;

/** 팔레트를 받는 스타일 묶음을 모드마다 한 번만 만들어 둡니다. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(fn: (color: Palette) => T): () => T {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const scheme = useScheme();
    return (cache[scheme] ??= StyleSheet.create(fn(palettes[scheme].color)));
  };
}

/**
 * 하늘·지도·카메라 위의 떠 있는 것에 넘기는 `theme` — 모드와 상관없이 어둡습니다.
 * (`useCelestialApp().theme` 과 같은 모양이라 그대로 바꿔 넘길 수 있습니다.)
 */
export const OVERLAY_THEME = {
  bg: '#0A0E18',
  card: DARK.panel,
  glass: DARK.panel,
  text: DARK.text,
  subText: DARK.textDim,
  mute: DARK.textMute,
  border: DARK.border,
  accent: DARK.accent,
  overlay: DARK.overlay,
  scheme: 'dark' as const,
};
