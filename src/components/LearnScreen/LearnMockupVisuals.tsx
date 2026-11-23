/**
 * LearnMockupVisuals.tsx — 데이터 페이지("하늘 읽는 노트")의 차트 · 게이지 · 스파크라인 · 달/행성 칩 부품.
 *
 * Light/Dark 테마 토큰(`useThemeColors` · `useDataColors`)을 그대로 따라 두 모드에서 모두 읽힙니다.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type } from '../../theme/tokens';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';
import type {
  CloudTrend6h,
  GaugeBandSpec,
  MoonStripInfo,
  StarGaugeSummary,
  Timeline24hChartData,
} from '../../utils/learnNoteData';
import type { VisiblePlanetItem } from '../../utils/timeBriefing';

// ── 1. 6시간 구름 추세 스파크라인 ─────────────────────────────────────────

export const CloudTrendBanner: React.FC<{
  trend: CloudTrend6h;
  language: Language;
  onOpenSky: () => void;
}> = ({ trend, language, onOpenSky }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const W = 84;
  const H = 24;
  const pts = useMemo(() => {
    const n = trend.points.length;
    if (n <= 1) return `2,${H / 2} ${W - 2},${H / 2}`;
    return trend.points
      .map((pct, i) => {
        const x = 3 + (i / (n - 1)) * (W - 6);
        const y = H - 3 - (Math.max(0, Math.min(100, pct)) / 100) * (H - 6);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [trend.points]);
  const lastY = H - 3 - (Math.max(0, Math.min(100, trend.endPct)) / 100) * (H - 6);

  return (
    <View style={styles.trendRow}>
      <Text style={styles.trendText}>
        {L3(language, '지난 6시간 구름 ', 'Clouds -6h ', '過去6時間の雲 ')}
        <Text style={styles.trendBold}>{`${trend.startPct} → ${trend.endPct}%`}</Text>
        {` ${trend.trendWord}`}
      </Text>
      <View style={styles.trendRight}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={`${trend.startPct}% -> ${trend.endPct}%`}>
          <Polyline points={pts} fill="none" stroke={color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={W - 3} cy={lastY} r={3} fill={color.accent} />
        </Svg>
        <PressScale style={[styles.goBtn, { borderColor: color.accentLine }]} onPress={onOpenSky} accessibilityRole="button">
          <Text style={[styles.goBtnText, { color: color.accent }]}>{L3(language, '3D 하늘 ▸', '3D Sky ▸', '3D空 ▸')}</Text>
        </PressScale>
      </View>
    </View>
  );
};

// ── 2. 노을 점수 · 별 한계등급 원형 도넛 2열 ───────────────────────────────

export const ScoreRingsRow: React.FC<{
  glowScore: number | null;
  glowWord: string;
  glowSubLabel: string;
  glowTone: string;
  star: StarGaugeSummary;
  language: Language;
  onPressGlow?: () => void;
  onPressStar?: () => void;
}> = ({ glowScore, glowWord, glowSubLabel, glowTone, star, language, onPressGlow, onPressStar }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const R = 22;
  const CIRC = 2 * Math.PI * R;
  const glowRatio = glowScore != null ? Math.max(0.02, Math.min(1, glowScore / 100)) : 0;
  const starRatio = Math.max(0.02, Math.min(1, star.limitMag / 6.5));
  const starTone = star.limitMag >= 5.2 ? color.success : star.limitMag >= 3.0 ? color.warning : color.danger;

  return (
    <View style={styles.scoresRow}>
      <PressScale style={styles.scoreCard} onPress={onPressGlow} disabled={!onPressGlow} accessibilityRole={onPressGlow ? 'button' : 'summary'}>
        <Svg width={56} height={56} viewBox="0 0 56 56">
          <Circle cx={28} cy={28} r={R} fill="none" stroke={color.borderStrong} strokeWidth={6} />
          {glowScore != null && (
            <Circle
              cx={28}
              cy={28}
              r={R}
              fill="none"
              stroke={glowTone}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={`${(glowRatio * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
              transform="rotate(-90 28 28)"
            />
          )}
        </Svg>
        <View style={styles.scoreTextCol}>
          <Text style={styles.scoreTitle}>{L3(language, '노을 점수', 'Glow score', '夕焼けスコア')}</Text>
          <Text style={styles.scoreVal}>
            {glowScore != null ? glowScore : '—'}
            <Text style={styles.scoreUnit}> /100</Text>
          </Text>
          <Text style={styles.scoreSub} numberOfLines={1}>{`${glowWord} · ${glowSubLabel}`}</Text>
        </View>
      </PressScale>

      <PressScale style={styles.scoreCard} onPress={onPressStar} disabled={!onPressStar} accessibilityRole={onPressStar ? 'button' : 'summary'}>
        <Svg width={56} height={56} viewBox="0 0 56 56">
          <Circle cx={28} cy={28} r={R} fill="none" stroke={color.borderStrong} strokeWidth={6} />
          <Circle
            cx={28}
            cy={28}
            r={R}
            fill="none"
            stroke={starTone}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${(starRatio * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`}
            transform="rotate(-90 28 28)"
          />
        </Svg>
        <View style={styles.scoreTextCol}>
          <Text style={styles.scoreTitle}>{L3(language, '별 한계등급', 'Star limit', '星の限界等級')}</Text>
          <Text style={styles.scoreVal}>
            {star.limitMag.toFixed(1)}
            <Text style={styles.scoreUnit}>{L3(language, ' 등', ' mag', ' 等')}</Text>
          </Text>
          <Text style={styles.scoreSub} numberOfLines={1}>{star.subLabel}</Text>
        </View>
      </PressScale>
    </View>
  );
};

// ── 3. 달 · 행성 컴팩트 칩 ───────────────────────────────────────────────

export const MoonPlanetStrip: React.FC<{
  moon: MoonStripInfo;
  planets: VisiblePlanetItem[];
  language: Language;
}> = ({ moon, planets, language }) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();

  // 위상 SVG: 배경 원 + 밝은 반원/타원 조합
  const r = 11;
  const waxing = moon.phase < 0.5;
  const rx = Math.max(0.5, Math.abs(Math.cos(moon.phase * 2 * Math.PI)) * r);
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = moon.fraction > 0.5 ? (waxing ? 1 : 0) : (waxing ? 0 : 1);
  const moonPath = `M 0 ${-r} A ${r} ${r} 0 0 ${sweepOuter} 0 ${r} A ${rx.toFixed(1)} ${r} 0 0 ${sweepInner} 0 ${-r} Z`;

  const altStr = `${moon.altDeg >= 0 ? '+' : ''}${moon.altDeg}°`;
  const moonMeta = [
    moon.altDeg >= 0 ? `${moon.dir} ${L3(language, '고도', 'Alt', '高度')} ${altStr}` : `${L3(language, '지평선 아래', 'Below horizon', '地平線下')} (${altStr})`,
    moon.riseLabel ? `${moon.riseLabel} ${L3(language, '뜸', 'rise', '出')}` : null,
    moon.setLabel ? `${moon.setLabel} ${L3(language, '짐', 'set', '没')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.moonStack}>
      <View style={styles.mchip}>
        <Svg width={28} height={28} viewBox="-14 -14 28 28">
          <Circle r={r} fill={color.borderStrong} />
          <Path d={moonPath} fill={color.sun} />
        </Svg>
        <View style={styles.mchipText}>
          <Text style={styles.mchipTitle}>{`${L3(language, '달', 'Moon', '月')} · ${moon.name} ${moon.pct}%`}</Text>
          <Text style={styles.mchipSub}>{moonMeta}</Text>
        </View>
      </View>

      <View style={styles.mchip}>
        <Svg width={28} height={28} viewBox="-14 -14 28 28">
          <Circle r={6.5} fill={dataColor.sunrise} />
          <Ellipse rx={12.5} ry={3.2} fill="none" stroke={dataColor.sunrise} strokeWidth={1.6} transform="rotate(-18)" />
        </Svg>
        <View style={styles.mchipText}>
          <Text style={styles.mchipTitle}>{L3(language, '보이는 행성', 'Visible planets', '見えている惑星')}</Text>
          {planets.length > 0 ? (
            <Text style={styles.mchipSub}>
              {planets.map(p => `${p.name} ${p.direction} ${p.altitudeDeg}°`).join('  ·  ')}
            </Text>
          ) : (
            <Text style={styles.mchipSub}>
              {L3(language, '지금 지평선 위 주요 행성 없음', 'No major planets above horizon now', '現在地平線上の主要惑星なし')}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

// ── 4. 기준 띠 3색 게이지 (구름 · 시정 · 습도 · 이슬점 차) ─────────────────

export const ComfortGaugesView: React.FC<{ gauges: GaugeBandSpec[] }> = ({ gauges }) => {
  const color = useThemeColors();
  const styles = useStyles();

  const toneColor = (t: 'good' | 'mid' | 'bad') =>
    t === 'good' ? color.success : t === 'mid' ? color.warning : color.danger;

  return (
    <View style={styles.gaugesWrap}>
      {gauges.map(g => {
        const pct = g.value != null ? Math.max(0, Math.min(100, (g.value / g.max) * 100)) : null;
        return (
          <View key={g.id} style={styles.gaugeCard}>
            <View style={styles.gaugeTopRow}>
              <View style={styles.gaugeNameCol}>
                <Text style={styles.gaugeName}>{g.name}</Text>
                <Text style={styles.gaugeSub}>{g.sub}</Text>
              </View>

              <View style={styles.gaugeTrackCol}>
                <View style={styles.gaugeValRow}>
                  <Text style={styles.gaugeValText}>{g.valueLabel}</Text>
                </View>
                <View style={styles.barRow}>
                  {g.segs.map((s, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.barSeg,
                        {
                          width: `${((s.to - s.from) / g.max) * 100}%`,
                          backgroundColor: toneColor(s.tone),
                          borderTopLeftRadius: idx === 0 ? 5 : 0,
                          borderBottomLeftRadius: idx === 0 ? 5 : 0,
                          borderTopRightRadius: idx === g.segs.length - 1 ? 5 : 0,
                          borderBottomRightRadius: idx === g.segs.length - 1 ? 5 : 0,
                        },
                      ]}
                    />
                  ))}
                  {pct != null && (
                    <View
                      style={[
                        styles.pinMarker,
                        {
                          left: `${Math.min(97, Math.max(3, pct))}%`,
                          backgroundColor: color.text,
                          borderColor: color.panel,
                        },
                      ]}
                    />
                  )}
                </View>
                <View style={styles.tickRow}>
                  {g.ticks.map((tk, i) => (
                    <Text key={i} style={styles.tickText}>{tk}</Text>
                  ))}
                </View>
              </View>
            </View>
            <Text style={styles.gaugeRead}>{g.read}</Text>
          </View>
        );
      })}
    </View>
  );
};

// ── 5. 앞으로 24시간(-6h ~ +24h) SVG 타임라인 ─────────────────────────────

export const Timeline24hChart: React.FC<{
  data: Timeline24hChartData;
  selectedIndex: number | null;
  onSelectMarker: (index: number) => void;
  language: Language;
}> = ({ data, selectedIndex, onSelectMarker, language }) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();
  const [boxW, setBoxW] = useState(340);

  const onLayout = (e: LayoutChangeEvent) => {
    setBoxW(Math.max(300, Math.round(e.nativeEvent.layout.width)));
  };

  const W = Math.max(360, boxW);
  const H = 264;
  const L = 34;
  const R = 12;
  const PW = W - L - R;
  const T0 = -6;
  const T1 = 24;
  const X = (tRel: number) => L + ((tRel - T0) / (T1 - T0)) * PW;

  const BAND_Y = 18;
  const CHART_TOP = 42;
  const CHART_H = 78;
  const CHART_BOT = CHART_TOP + CHART_H;
  const CLOUD_Y = 136;
  const MARKER_Y = 224;

  const { samples, markers, axisTicks } = data;
  const sunsetFuturePts: string[] = [];
  const sunsetPastPts: string[] = [];
  const sunsetAreaPts: string[] = [`${X(T0).toFixed(1)},${CHART_BOT}`];
  const starFuturePts: string[] = [];
  const starPastPts: string[] = [];
  const starAreaPts: string[] = [`${X(T0).toFixed(1)},${CHART_BOT}`];

  for (const s of samples) {
    const px = X(s.tRel).toFixed(1);
    const pySun = (CHART_BOT - (s.sunsetScore / 100) * CHART_H).toFixed(1);
    const pyStar = (CHART_BOT - (s.starScore / 100) * CHART_H).toFixed(1);
    sunsetAreaPts.push(`${px},${pySun}`);
    starAreaPts.push(`${px},${pyStar}`);
    if (s.tRel <= 0.01) {
      sunsetPastPts.push(`${px},${pySun}`);
      starPastPts.push(`${px},${pyStar}`);
    }
    if (s.tRel >= -0.01) {
      sunsetFuturePts.push(`${px},${pySun}`);
      starFuturePts.push(`${px},${pyStar}`);
    }
  }
  sunsetAreaPts.push(`${X(T1).toFixed(1)},${CHART_BOT}`);
  starAreaPts.push(`${X(T1).toFixed(1)},${CHART_BOT}`);

  const cloudColW = Math.max(4, PW / Math.max(1, samples.length) + 0.5);
  const phaseFill = (ph: 'day' | 'dusk' | 'night') =>
    ph === 'day' ? color.accentSoft : ph === 'dusk' ? color.glowSoft : color.panelRaised;

  // 겹치는 이벤트 번호 핀을 좌우로 살짝 벌려 줌
  const spreadOffsets = useMemo(() => {
    const out: number[] = [];
    let prevX = -999;
    let tier = 0;
    for (const m of markers) {
      const mx = X(m.tRel);
      if (mx - prevX < 18) tier = (tier + 1) % 3;
      else tier = 0;
      const dx = tier === 0 ? 0 : tier === 1 ? -11 : 11;
      out.push(dx);
      prevX = mx;
    }
    return out;
  }, [markers, PW]);

  const selectedMarker = markers.find(m => m.index === selectedIndex) ?? null;

  return (
    <View style={styles.tlCard} onLayout={onLayout}>
      <View style={styles.tlLegend}>
        <View style={styles.tlLegItem}>
          <View style={[styles.tlLegSwatch, { backgroundColor: dataColor.sunrise }]} />
          <Text style={styles.tlLegText}>{L3(language, '노을 점수', 'Glow score', '夕焼け')}</Text>
        </View>
        <View style={styles.tlLegItem}>
          <View style={[styles.tlLegSwatch, { backgroundColor: dataColor.stars }]} />
          <Text style={styles.tlLegText}>{L3(language, '별 점수', 'Star score', '星')}</Text>
        </View>
        <View style={styles.tlLegItem}>
          <View style={[styles.tlLegSwatch, { height: 7, backgroundColor: color.textDim }]} />
          <Text style={styles.tlLegText}>{L3(language, '구름 짙기', 'Cloud density', '雲の濃さ')}</Text>
        </View>
        <View style={styles.tlLegItem}>
          <View style={[styles.tlLegSwatch, { backgroundColor: color.textMute }]} />
          <Text style={styles.tlLegText}>{L3(language, '지난 6시간', 'Past 6h', '過去6h')}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* 낮 · 박명 · 밤 띠 */}
          <SvgText x={L} y={12} fontSize={9.5} fill={color.textMute}>
            {L3(language, '낮 · 밤', 'Day · Night', '昼・夜')}
          </SvgText>
          {samples.slice(0, -1).map((s, i) => (
            <Rect
              key={`ph-${i}`}
              x={X(s.tRel)}
              y={BAND_Y}
              width={cloudColW}
              height={11}
              fill={phaseFill(s.phase)}
            />
          ))}

          {/* 지난 6시간 반투명 음영 + 지금 선 */}
          <Rect x={X(-6)} y={BAND_Y + 13} width={X(0) - X(-6)} height={CHART_BOT - BAND_Y + 46} fill={color.textMute} opacity={0.12} />
          <Line x1={X(0)} x2={X(0)} y1={BAND_Y + 13} y2={MARKER_Y - 12} stroke={color.accent} strokeWidth={1.6} />
          <SvgText x={X(0) + 4} y={CHART_TOP - 3} fontSize={9.5} fill={color.accent} fontWeight="700">
            {L3(language, '지금', 'Now', '今')}
          </SvgText>

          {/* 눈금선 (0, 50, 100) */}
          {[0, 50, 100].map(v => {
            const yy = CHART_BOT - (v / 100) * CHART_H;
            return (
              <G key={`grid-${v}`}>
                <Line x1={L} x2={L + PW} y1={yy} y2={yy} stroke={color.border} strokeWidth={1} />
                <SvgText x={L - 4} y={yy + 3} fontSize={9} fontFamily={mono} fill={color.textMute} textAnchor="end">
                  {v}
                </SvgText>
              </G>
            );
          })}

          {/* 선택된 이벤트 세로 하이라이트 */}
          {selectedMarker && (
            <Rect
              x={X(selectedMarker.tRel) - 8}
              y={CHART_TOP - 4}
              width={16}
              height={MARKER_Y - CHART_TOP - 8}
              rx={4}
              fill={dataColor.sunrise}
              opacity={0.16}
            />
          )}

          {/* 별 점수 면 + 선 */}
          <Path d={`M ${starAreaPts.join(' L ')} Z`} fill={dataColor.stars} opacity={0.16} />
          {starPastPts.length > 1 && (
            <Polyline points={starPastPts.join(' ')} fill="none" stroke={dataColor.stars} strokeWidth={1.6} strokeDasharray="3 3" opacity={0.7} />
          )}
          {starFuturePts.length > 1 && (
            <Polyline points={starFuturePts.join(' ')} fill="none" stroke={dataColor.stars} strokeWidth={2} />
          )}

          {/* 노을 점수 면 + 선 */}
          <Path d={`M ${sunsetAreaPts.join(' L ')} Z`} fill={dataColor.sunrise} opacity={0.2} />
          {sunsetPastPts.length > 1 && (
            <Polyline points={sunsetPastPts.join(' ')} fill="none" stroke={dataColor.sunrise} strokeWidth={1.6} strokeDasharray="3 3" opacity={0.7} />
          )}
          {sunsetFuturePts.length > 1 && (
            <Polyline points={sunsetFuturePts.join(' ')} fill="none" stroke={dataColor.sunrise} strokeWidth={2} />
          )}

          {/* 최고 노을 점 숫자 라벨 */}
          {data.peakLabel && data.peakTRel != null && data.peakScore != null && (
            <SvgText
              x={X(data.peakTRel)}
              y={Math.max(CHART_TOP + 10, CHART_BOT - (data.peakScore / 100) * CHART_H - 6)}
              fontSize={9.5}
              fontFamily={mono}
              fill={dataColor.sunrise}
              textAnchor="middle"
              fontWeight="700"
            >
              {data.peakLabel}
            </SvgText>
          )}

          {/* 구름 층별 짙기 히트맵 (높은 · 중간 · 낮은) */}
          <SvgText x={L} y={CLOUD_Y - 5} fontSize={9.5} fill={color.textMute}>
            {L3(language, '구름 층별 짙기 (과거 포함)', 'Cloud density by altitude', '層別の雲の濃さ')}
          </SvgText>
          {(
            [
              { label: L3(language, '높은', 'High', '高'), key: 'high' as const, row: 0 },
              { label: L3(language, '중간', 'Mid', '中'), key: 'mid' as const, row: 1 },
              { label: L3(language, '낮은', 'Low', '低'), key: 'low' as const, row: 2 },
            ]
          ).map(layer => {
            const yy = CLOUD_Y + layer.row * 19;
            return (
              <G key={layer.key}>
                <SvgText x={L - 4} y={yy + 11} fontSize={9.5} fill={color.textMute} textAnchor="end">
                  {layer.label}
                </SvgText>
                {samples.slice(0, -1).map((s, i) => {
                  const cov = s[layer.key] / 100;
                  return (
                    <Rect
                      key={`${layer.key}-${i}`}
                      x={X(s.tRel)}
                      y={yy}
                      width={cloudColW}
                      height={14}
                      fill={color.cloud}
                      opacity={0.07 + cov * 0.78}
                    />
                  );
                })}
              </G>
            );
          })}

          {/* 이벤트 번호 마커 */}
          {markers.map((m, idx) => {
            const mx = X(m.tRel);
            const dx = spreadOffsets[idx] ?? 0;
            const active = selectedIndex === m.index;
            return (
              <G key={m.event.id} onPress={() => onSelectMarker(m.index)}>
                <Line
                  x1={mx}
                  x2={mx}
                  y1={BAND_Y + 13}
                  y2={MARKER_Y - 12}
                  stroke={dataColor.sunrise}
                  strokeWidth={active ? 1.5 : 1}
                  strokeDasharray="3 3"
                  opacity={active ? 0.9 : 0.45}
                />
                {dx !== 0 && (
                  <Line x1={mx} y1={MARKER_Y - 12} x2={mx + dx} y2={MARKER_Y - 8} stroke={dataColor.sunrise} strokeWidth={1} opacity={0.6} />
                )}
                <Circle cx={mx + dx} cy={MARKER_Y} r={active ? 10 : 8.5} fill={active ? color.accent : dataColor.sunrise} />
                <SvgText x={mx + dx} y={MARKER_Y + 3.5} fontSize={9.5} fontFamily={mono} fontWeight="700" fill="#FFFFFF" textAnchor="middle">
                  {m.index}
                </SvgText>
              </G>
            );
          })}

          {/* 하단 시간 축 눈금 */}
          {axisTicks.map((tk, i) => (
            <SvgText
              key={`ax-${i}`}
              x={X(tk.tRel)}
              y={H - 8}
              fontSize={9.5}
              fontFamily={mono}
              fill={tk.tRel === 0 ? color.accent : color.textMute}
              textAnchor={i === 0 ? 'start' : i === axisTicks.length - 1 ? 'end' : 'middle'}
            >
              {tk.label}
            </SvgText>
          ))}
        </Svg>
      </ScrollView>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.sm,
    backgroundColor: color.fill,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  trendText: { ...type.body, fontSize: 12, color: color.textDim, flexShrink: 1 },
  trendBold: { fontFamily: mono, fontWeight: '700', color: color.text },
  trendRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  goBtn: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 28,
    justifyContent: 'center',
  },
  goBtnText: { fontSize: 11, fontWeight: '700' },

  scoresRow: { flexDirection: 'row', gap: space.sm },
  scoreCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.fill,
    borderRadius: radius.md,
    padding: space.sm + 2,
  },
  scoreTextCol: { flex: 1, minWidth: 0, gap: 1 },
  scoreTitle: { fontSize: 11, color: color.textMute },
  scoreVal: { fontFamily: mono, fontSize: 20, fontWeight: '700', color: color.text, lineHeight: 24 },
  scoreUnit: { fontSize: 11, fontWeight: '400', color: color.textMute },
  scoreSub: { fontSize: 11, color: color.textDim },

  moonStack: { gap: 6 },
  mchip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    backgroundColor: color.fill,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  mchipText: { flex: 1, minWidth: 0, gap: 2 },
  mchipTitle: { ...type.bodyStrong, fontSize: 13, color: color.text },
  mchipSub: { fontSize: 12, color: color.textDim },

  gaugesWrap: { gap: space.sm },
  gaugeCard: {
    backgroundColor: color.fill,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: 6,
  },
  gaugeTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  gaugeNameCol: { width: 68 },
  gaugeName: { fontSize: 12, fontWeight: '700', color: color.text },
  gaugeSub: { fontSize: 11, color: color.textMute },
  gaugeTrackCol: { flex: 1, minWidth: 0, gap: 3 },
  gaugeValRow: { alignItems: 'flex-end' },
  gaugeValText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: color.text },
  barRow: { flexDirection: 'row', height: 10, borderRadius: 5, position: 'relative', overflow: 'visible' },
  barSeg: { height: 10, opacity: 0.6 },
  pinMarker: {
    position: 'absolute',
    top: -4,
    width: 6,
    height: 18,
    borderRadius: 3,
    borderWidth: 1.5,
    marginLeft: -3,
  },
  tickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tickText: { fontFamily: mono, fontSize: 10, color: color.textMute },
  gaugeRead: { fontSize: 12, color: color.textDim, lineHeight: 17 },

  tlCard: {
    backgroundColor: color.fill,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.xs,
  },
  tlLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: 4 },
  tlLegItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tlLegSwatch: { width: 12, height: 3, borderRadius: 2 },
  tlLegText: { fontSize: 11, color: color.textDim },
}));
