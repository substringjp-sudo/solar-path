/**
 * ResultCompare.tsx — **촬영 결과 크게 비교하기 + 차이 짚기**(docs/SANDBOX_MODE_PLAN.md 8.7, 목업 5).
 *
 *  - 방식 셋: 반씩(가운데 손잡이를 밀어 사진 | 예측), 겹침(예측을 사진 위에 반투명하게, 산 능선과 해 자리가 맞는지), 위아래(나란히).
 *  - 차이 짚기: 하늘을 왼쪽 · 가운데 · 오른쪽으로 나눠 밝기와 색을 비교해 최대 3 줄("가운데 하늘이 예측보다 밝음"). 그림을 못 읽으면 줄이 빠집니다. 해 근처 비교는 해가 그림의 어디인지 알 때만 들어갑니다.
 *  - 그때 예보 한 줄(`forecastLine`)은 부르는 쪽이 글을 줍니다.
 * 계산은 `utils/resultCompare.ts`(순수), 그림 읽기는 `utils/imageZones.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { color, radius, mono } from '../theme/tokens';
import { PressScale } from './ui';
import { L3, type Language } from '../utils/i18n';
import { clampSplit, diffLines, zoneStats } from '../utils/resultCompare';
import { readSmallRgba, ZONE_GRID } from '../utils/imageZones';

export type CompareMode = 'split' | 'overlay' | 'stack';
export const COMPARE_MODES: readonly CompareMode[] = ['split', 'overlay', 'stack'];

interface Props {
  language: Language;
  photoUri: string;
  /** 예측 그림. 없으면 비교 대신 `missing` 을 보입니다. */
  simUri: string | null;
  /** 예측 그림이 없을 때 자리를 지키는 안내(왜 없는지). */
  missing?: React.ReactNode;
  /** 해가 그림의 어디인지(가로 · 세로 비율 0~1). 알면 "해 근처" 비교가 들어갑니다. */
  sunXY?: { x: number; y: number } | null;
  /** 그때 예보 한 줄 */
  forecast?: string | null;
}

const modeLabel = (m: CompareMode, l: Language): string =>
  m === 'split' ? L3(l, '반씩', 'Split', '半分ずつ') : m === 'overlay' ? L3(l, '겹침', 'Overlay', '重ねる') : L3(l, '위아래', 'Stacked', '上下');

export const ResultCompare: React.FC<Props> = ({ language, photoUri, simUri, missing, sunXY, forecast }) => {
  const [mode, setMode] = useState<CompareMode>('split');
  const [width, setWidth] = useState(0);
  const [split, setSplit] = useState(0.5);
  const [lines, setLines] = useState<string[] | null>(null);
  const widthRef = useRef(0);
  widthRef.current = width;

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setSplit(clampSplit(e.nativeEvent.locationX, widthRef.current)),
    onPanResponderMove: (e) => setSplit(clampSplit(e.nativeEvent.locationX, widthRef.current)),
  }), []);

  useEffect(() => {
    let alive = true;
    setLines(null);
    if (!simUri) return;
    (async () => {
      const [a, b] = await Promise.all([readSmallRgba(photoUri), readSmallRgba(simUri)]);
      if (!alive || !a || !b) return;
      const sun = sunXY ?? undefined;
      const za = zoneStats(a, ZONE_GRID.width, ZONE_GRID.height, sun);
      const zb = zoneStats(b, ZONE_GRID.width, ZONE_GRID.height, sun);
      if (za && zb) setLines(diffLines(za, zb, language));
    })();
    return () => { alive = false; };
  }, [photoUri, simUri, sunXY?.x, sunXY?.y, language]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const h = width > 0 ? Math.round(width * 0.62) : 200;

  return (
    <View style={styles.wrap}>
      <View style={styles.modes} accessibilityRole="tablist">
        {COMPARE_MODES.map(m => (
          <PressScale key={m} style={[styles.modeBtn, mode === m && styles.modeBtnOn]} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{modeLabel(m, language)}</Text>
          </PressScale>
        ))}
      </View>
      {!simUri ? (
        <View onLayout={onLayout}>
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: h, borderRadius: radius.xs }} resizeMode="cover" />
          {missing}
        </View>
      ) : mode === 'stack' ? (
        <View onLayout={onLayout} style={{ gap: 6 }}>
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: h, borderRadius: radius.xs }} resizeMode="cover" />
          <Image source={{ uri: simUri }} style={{ width: '100%', height: h, borderRadius: radius.xs }} resizeMode="cover" />
        </View>
      ) : mode === 'overlay' ? (
        <View onLayout={onLayout} style={{ height: h }}>
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <Image source={{ uri: simUri }} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} resizeMode="cover" />
        </View>
      ) : (
        <View onLayout={onLayout} style={{ height: h }} {...pan.panHandlers} accessibilityLabel={L3(language, '가운데 손잡이를 밀어 사진과 예측을 반씩 비교', 'Drag the handle to compare photo and prediction', 'ハンドルを動かして写真と予測を比較')}>
          <Image source={{ uri: simUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[styles.clip, { width: width * split }]}>
            <Image source={{ uri: photoUri }} style={{ width, height: h }} resizeMode="cover" />
          </View>
          <View style={[styles.handle, { left: width * split - 1 }]} pointerEvents="none" />
        </View>
      )}
      <View style={styles.legend}>
        <Text style={styles.legendText}>{L3(language, mode === 'split' ? '왼쪽 사진 · 오른쪽 예측' : mode === 'overlay' ? '사진 위에 예측 50 %' : '위 사진 · 아래 예측', mode === 'split' ? 'Left photo · right prediction' : mode === 'overlay' ? 'Prediction at 50 % over the photo' : 'Photo on top · prediction below', mode === 'split' ? '左が写真・右が予測' : mode === 'overlay' ? '写真の上に予測50%' : '上が写真・下が予測')}</Text>
      </View>
      {lines && lines.length > 0 ? (
        <View style={styles.diffCard} accessibilityRole="summary">
          <Text style={styles.diffTitle}>{L3(language, '차이 짚기', 'WHAT DIFFERS', '違いの指摘')}</Text>
          {lines.map(t => <Text key={t} style={styles.diffLine}>{t}</Text>)}
        </View>
      ) : null}
      {forecast ? <Text style={styles.forecast}>{forecast}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  modes: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill },
  modeBtnOn: { borderColor: color.accent },
  modeText: { fontSize: 12, fontWeight: '700', color: color.textDim },
  modeTextOn: { color: color.accent },
  clip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: color.accent },
  legend: { alignItems: 'flex-start' },
  legendText: { fontFamily: mono, fontSize: 10, color: color.textMute },
  diffCard: { gap: 2, padding: 10, borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, backgroundColor: color.fill },
  diffTitle: { fontFamily: mono, fontSize: 9, letterSpacing: 0.8, color: color.textMute },
  diffLine: { fontSize: 13, fontWeight: '700', color: color.text },
  forecast: { fontSize: 12, color: color.textDim },
});
