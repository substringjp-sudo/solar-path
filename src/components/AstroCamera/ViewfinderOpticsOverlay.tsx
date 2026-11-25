/**
 * ViewfinderOpticsOverlay.tsx — 장착된 확장 렌즈·필터에 따른 라이브 뷰파인더 광학 가이드 & Zone 히스토그램.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import {
  dirFromAzEl,
  horizonAt,
  predictSkyline,
  project,
  type Attitude,
  type GroundElevation,
  type HorizonProfile,
} from '../../utils/arVision';
import type { PreviewOptics } from '../../utils/cameraOverlay';
import {
  computeCloudFlowKernel,
  computeSunstarAndFlareParams,
  predictBacklightGhosts,
  type AnchorMatchResult,
  type CameraGearBagState,
  type GuidedSkylineResult,
  type SkylineAnchor,
  type WindLayerInput,
  type ZoneHistogramResult,
} from '../../utils/photoAlgorithms';
import { color, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';

interface OverlayProps {
  width: number;
  height: number;
  gear: CameraGearBagState;
  optics: PreviewOptics;
  attitude: Attitude;
  horizon?: HorizonProfile | null;
  elev?: GroundElevation | null;
  eyeElevM?: number;
  sunAzDeg: number;
  sunAltDeg: number;
  windLayers?: readonly WindLayerInput[];
  timeShiftAnchor?: SkylineAnchor | null;
  anchorMatch?: AnchorMatchResult | null;
  refinedSkyline?: GuidedSkylineResult | null;
  language: Language;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EARTH_R_M = 6371008.8;

/** 해당 방위각에서 지평선을 만든 최고 능선까지의 거리(m) 추정. */
function ridgeDistanceAtAz(
  azDeg: number,
  eyeM: number,
  elev: GroundElevation | null | undefined,
): number | null {
  if (!elev) return null;
  const rad = azDeg * D2R;
  const se = Math.sin(rad);
  const ce = Math.cos(rad);
  let bestEl = -90;
  let bestD = 0;
  for (let d = 250; d <= 45000; d *= 1.18) {
    const g = elev(d * se, -d * ce);
    if (g == null) continue;
    const drop = (d * d * 0.87) / (2 * EARTH_R_M);
    const el = Math.atan2(g - drop - eyeM, d) * R2D;
    if (el > bestEl) {
      bestEl = el;
      bestD = d;
    }
  }
  return bestD > 0 ? bestD : null;
}

export const ViewfinderOpticsOverlay: React.FC<OverlayProps> = ({
  width,
  height,
  gear,
  optics,
  attitude,
  horizon,
  elev,
  eyeElevM = 35,
  sunAzDeg,
  sunAltDeg,
  windLayers,
  timeShiftAnchor,
  anchorMatch,
  refinedSkyline,
  language,
}) => {
  const showGnd = gear.frontFilters.includes('gnd');
  const showSkylineCompare = gear.showSkylineCompare || showGnd;
  const showGhost = gear.frontFilters.includes('ghostClean');
  const showAnamorphic = gear.lensMount === 'anamorphic';
  const showScheimpflug = gear.lensMount === 'scheimpflug';
  const showShift = gear.verticalShift || showScheimpflug;
  const showNdHint = gear.frontFilters.includes('nd1000') && gear.showCloudDurationHint;

  // 1. DEM 능선 가이드 곡선 (점선) 및 이미지 기반 추론 경계선 (실선)
  const skylinePts = useMemo(() => {
    if (!horizon || (!showSkylineCompare && !timeShiftAnchor)) return '';
    const cols = 48;
    const xs = Array.from({ length: cols }, (_, i) => ((i + 0.5) / cols) * width);
    const ys = predictSkyline(horizon, attitude, optics.k, xs);
    const pts: string[] = [];
    for (let i = 0; i < cols; i++) {
      if (Number.isFinite(ys[i]) && ys[i] >= -20 && ys[i] <= height + 20) {
        pts.push(`${xs[i].toFixed(1)},${ys[i].toFixed(1)}`);
      }
    }
    return pts.join(' ');
  }, [horizon, showSkylineCompare, timeShiftAnchor, width, height, attitude, optics.k]);

  const refinedSkylinePts = useMemo(() => {
    if (!refinedSkyline || !showSkylineCompare) return '';
    const arr = refinedSkyline.refinedYNorm;
    const pts: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const yn = arr[i];
      if (!Number.isFinite(yn)) continue;
      const px = ((i + 0.5) / arr.length) * width;
      const py = yn * height;
      if (py >= -20 && py <= height + 20) {
        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      }
    }
    return pts.join(' ');
  }, [refinedSkyline, showSkylineCompare, width, height]);

  const anchorPolyline = useMemo(() => {
    if (!timeShiftAnchor) return '';
    const raw = timeShiftAnchor.rawSkylineYNorm;
    const pts: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const yn = raw[i];
      if (!Number.isFinite(yn)) continue;
      const px = ((i + 0.5) / raw.length) * width;
      const py = yn * height;
      if (py >= -20 && py <= height + 20) pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return pts.join(' ');
  }, [timeShiftAnchor, width, height]);

  // 2. 관측 고도 Dip 수평선
  const dipLine = useMemo(() => {
    if (!gear.showDipHorizon) return null;
    const dipDeg = -Math.sqrt((2 * Math.max(1, eyeElevM)) / EARTH_R_M) * R2D;
    const left = project(dirFromAzEl(attitude.yawDeg - optics.hFovDeg * 0.45, dipDeg), attitude, optics.k);
    const right = project(dirFromAzEl(attitude.yawDeg + optics.hFovDeg * 0.45, dipDeg), attitude, optics.k);
    if (!left || !right) return null;
    return { x1: left.x, y1: left.y, x2: right.x, y2: right.y, dipDeg };
  }, [gear.showDipHorizon, eyeElevM, attitude, optics.hFovDeg, optics.k]);

  // 3. 봉우리/능선 거리 라벨 (시야 내 대표 3개 극대 지점)
  const peakMarkers = useMemo(() => {
    if (!gear.showPeakLabels || !horizon) return [];
    const halfFov = optics.hFovDeg * 0.45;
    const bins = 24;
    const stepAz = (halfFov * 2) / bins;
    const samples: Array<{ az: number; el: number }> = [];
    for (let i = 0; i <= bins; i++) {
      const az = ((attitude.yawDeg - halfFov + i * stepAz) % 360 + 360) % 360;
      samples.push({ az, el: horizonAt(horizon, az) });
    }
    const peaks: Array<{ az: number; el: number; x: number; y: number; distKm: string }> = [];
    for (let i = 1; i < samples.length - 1; i++) {
      if (samples[i].el > samples[i - 1].el && samples[i].el >= samples[i + 1].el && samples[i].el > 0.3) {
        const p = project(dirFromAzEl(samples[i].az, samples[i].el), attitude, optics.k);
        if (!p || p.x < 30 || p.x > width - 30 || p.y < 60 || p.y > height - 100) continue;
        // 서로 너무 가까운 라벨 피하기
        if (peaks.some(pk => Math.abs(pk.x - p.x) < 72)) continue;
        const dM = ridgeDistanceAtAz(samples[i].az, eyeElevM, elev);
        const distKm = dM ? `${(dM / 1000).toFixed(1)}km` : `${samples[i].el.toFixed(1)}°`;
        peaks.push({ az: samples[i].az, el: samples[i].el, x: p.x, y: p.y, distKm });
        if (peaks.length >= 3) break;
      }
    }
    return peaks;
  }, [gear.showPeakLabels, horizon, optics.hFovDeg, optics.k, attitude, width, height, eyeElevM, elev]);

  // 4. 역광 고스트 / 선스타 예측 마커
  const opticalMarkers = useMemo(() => {
    if (!showGhost && !showAnamorphic) return null;
    const g = showGhost ? predictBacklightGhosts(sunAzDeg, sunAltDeg, attitude, optics.k) : null;
    const f = showAnamorphic
      ? computeSunstarAndFlareParams(sunAzDeg, sunAltDeg, attitude, optics.k, {
          horizon,
          apertureBlades: gear.sunstarBlades,
        })
      : null;
    return { ghosts: g?.ghosts ?? [], flare: f };
  }, [showGhost, showAnamorphic, sunAzDeg, sunAltDeg, attitude, optics.k, horizon, gear.sunstarBlades]);

  // 5. 구름 장노출 권장 시간
  const cloudHintSec = useMemo(() => {
    if (!showNdHint || !windLayers || windLayers.length === 0) return null;
    const res = computeCloudFlowKernel(windLayers, attitude, optics.k, {
      durationSec: gear.ndDurationSec,
      taps: 11,
    });
    return Math.round(res.recommendedDurationSec);
  }, [showNdHint, windLayers, attitude, optics.k, gear.ndDurationSec]);

  if (
    !showSkylineCompare &&
    !showAnamorphic &&
    !showScheimpflug &&
    !showShift &&
    !showGhost &&
    !dipLine &&
    peakMarkers.length === 0 &&
    !cloudHintSec &&
    !timeShiftAnchor
  ) {
    return null;
  }

  const anaH = width / 2.39;
  const barH = showAnamorphic && anaH < height ? (height - anaH) / 2 : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        {/* 2.39:1 아나모픽 시네마 레터박스 */}
        {barH > 4 && (
          <>
            <Rect x={0} y={0} width={width} height={barH} fill="rgba(0,0,0,0.58)" />
            <Rect x={0} y={height - barH} width={width} height={barH} fill="rgba(0,0,0,0.58)" />
            <Line x1={0} y1={barH} x2={width} y2={barH} stroke="rgba(255,255,255,0.28)" strokeWidth={0.8} />
            <Line x1={0} y1={height - barH} x2={width} y2={height - barH} stroke="rgba(255,255,255,0.28)" strokeWidth={0.8} />
          </>
        )}

        {/* 수직선 시프트 교정 기준 수직선 */}
        {showShift && (
          <>
            <Line x1={width * 0.25} y1={0} x2={width * 0.25} y2={height} stroke="rgba(56,189,248,0.28)" strokeWidth={1} strokeDasharray="5 5" />
            <Line x1={width * 0.75} y1={0} x2={width * 0.75} y2={height} stroke="rgba(56,189,248,0.28)" strokeWidth={1} strokeDasharray="5 5" />
          </>
        )}

        {/* 3D 샤임플러그 초점 밴드 */}
        {showScheimpflug && (
          <>
            <Line
              x1={0}
              y1={height * (0.52 - Math.sin(gear.tiltPitchDeg * D2R) * 0.2)}
              x2={width}
              y2={height * (0.52 + Math.sin(gear.tiltPitchDeg * D2R) * 0.2)}
              stroke="rgba(251,191,36,0.7)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          </>
        )}

        {/* 3D DEM 지형 가이드 라인 (점선) 및 이미지 픽셀 추론 실제 경계선 (초록 실선) */}
        {showSkylineCompare && skylinePts ? (
          <Polyline
            points={skylinePts}
            fill="none"
            stroke="rgba(251,191,36,0.75)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        ) : null}
        {showSkylineCompare && refinedSkylinePts ? (
          <Polyline
            points={refinedSkylinePts}
            fill="none"
            stroke="rgba(52,211,153,0.92)"
            strokeWidth={2.2}
          />
        ) : null}

        {/* 블루아워 시간차 앵커 능선 실루엣 */}
        {timeShiftAnchor && anchorPolyline ? (
          <Polyline
            points={anchorPolyline}
            fill="none"
            stroke={anchorMatch?.shouldTrigger ? '#4ADE80' : '#38BDF8'}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ) : null}

        {/* 관측 고도 Dip 수평선 */}
        {dipLine && (
          <Line
            x1={dipLine.x1}
            y1={dipLine.y1}
            x2={dipLine.x2}
            y2={dipLine.y2}
            stroke="rgba(165,180,252,0.7)"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
        )}

        {/* 역광 고스트 후보 위치 마커 */}
        {opticalMarkers?.ghosts.map((g, idx) => (
          <Circle
            key={`ghost-${idx}`}
            cx={g.u * width}
            cy={g.v * height}
            r={Math.max(8, g.radiusNorm * width)}
            fill="none"
            stroke="rgba(74,222,128,0.45)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}

        {/* 봉우리·능선 거리 라벨 */}
        {peakMarkers.map((pk, idx) => (
          <React.Fragment key={`peak-${idx}`}>
            <Circle cx={pk.x} cy={pk.y} r={3} fill={color.accent} />
            <Line x1={pk.x} y1={pk.y - 4} x2={pk.x} y2={pk.y - 20} stroke={color.accent} strokeWidth={1} />
            <SvgText
              x={pk.x}
              y={pk.y - 24}
              fill="#F1F5F9"
              fontSize={10}
              fontWeight="700"
              textAnchor="middle"
            >
              {pk.distKm}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>

      {/* 우측 상단/중앙 상태 배지 (구름 추천 노출, 경계 추론 보정량, 앵커 매칭률, 틸트/아나모픽 정보) */}
      <View style={styles.hudColumn}>
        {showSkylineCompare && refinedSkyline && (
          <View style={styles.hudPill}>
            <Text style={[styles.hudText, { color: '#34D399' }]}>
              {L3(
                language,
                `경계 추론 ${Math.round(refinedSkyline.meanConfidence * 100)}% · 스냅 ${Math.round(refinedSkyline.snappedRatio * 100)}% (${refinedSkyline.meanLiftPct >= 0 ? '+' : ''}${refinedSkyline.meanLiftPct.toFixed(1)}%)`,
                `Skyline Fit ${Math.round(refinedSkyline.meanConfidence * 100)}% · Snap ${Math.round(refinedSkyline.snappedRatio * 100)}% (${refinedSkyline.meanLiftPct >= 0 ? '+' : ''}${refinedSkyline.meanLiftPct.toFixed(1)}%)`,
                `境界推論 ${Math.round(refinedSkyline.meanConfidence * 100)}% · 補正 ${Math.round(refinedSkyline.snappedRatio * 100)}%`,
              )}
            </Text>
          </View>
        )}
        {cloudHintSec != null && (
          <View style={styles.hudPill}>
            <Text style={styles.hudText}>
              {L3(language, `ND 구름 권장 ${cloudHintSec}초`, `Cloud Flow ${cloudHintSec}s`, `雲流し推奨 ${cloudHintSec}秒`)}
            </Text>
          </View>
        )}
        {showScheimpflug && (
          <View style={styles.hudPill}>
            <Text style={styles.hudText}>
              {`Tilt ${gear.tiltPitchDeg >= 0 ? '+' : ''}${gear.tiltPitchDeg}° · ${gear.focusDistM >= 1000 ? `${(gear.focusDistM / 1000).toFixed(1)}km` : `${gear.focusDistM}m`}`}
            </Text>
          </View>
        )}
        {opticalMarkers?.flare?.visible && showAnamorphic && (
          <View style={styles.hudPill}>
            <Text style={styles.hudText}>
              {L3(
                language,
                `선스타 차폐 ${Math.round(opticalMarkers.flare.occludedFraction * 100)}%`,
                `Sunstar Occl ${Math.round(opticalMarkers.flare.occludedFraction * 100)}%`,
                `光条遮蔽 ${Math.round(opticalMarkers.flare.occludedFraction * 100)}%`,
              )}
            </Text>
          </View>
        )}
        {timeShiftAnchor && anchorMatch && (
          <View style={[styles.hudPill, anchorMatch.shouldTrigger && styles.hudPillReady]}>
            <Text style={[styles.hudText, anchorMatch.shouldTrigger && { color: color.success }]}>
              {anchorMatch.shouldTrigger
                ? L3(language, `앵커 정합 ${Math.round(anchorMatch.matchScore * 100)}% · 자동 촬영!`, `Anchor ${Math.round(anchorMatch.matchScore * 100)}% · TRIGGER!`, `一致 ${Math.round(anchorMatch.matchScore * 100)}%・自動撮影`)
                : L3(language, `능선 정렬 ${Math.round(anchorMatch.matchScore * 100)}% (목표 96%)`, `Align ${Math.round(anchorMatch.matchScore * 100)}% (goal 96%)`, `稜線一致 ${Math.round(anchorMatch.matchScore * 100)}%`)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

/** 촬영 프리뷰 모달에 띄우는 안셀 아담스 11단계 Zone 0~X 분포 막대. */
export const ZoneSystemBar: React.FC<{
  histogram: ZoneHistogramResult;
  language: Language;
}> = ({ histogram, language }) => {
  const maxVal = Math.max(0.05, ...Array.from(histogram.zones));
  return (
    <View style={styles.zoneCard}>
      <View style={styles.zoneHeader}>
        <Text style={styles.zoneTitle}>
          {L3(language, '안셀 아담스 Zone System (0 ~ X)', 'Ansel Adams Zone System (0–X)', 'アンセル Zone System (0〜X)')}
        </Text>
        <Text style={styles.zoneMeta}>
          {`Mean Z${histogram.meanZone.toFixed(1)} · Clip B:${Math.round(histogram.blackClipRatio * 100)}% W:${Math.round(histogram.whiteClipRatio * 100)}%`}
        </Text>
      </View>
      <View style={styles.zoneBars}>
        {Array.from(histogram.zones).map((v, z) => {
          const hPct = Math.max(6, Math.round((v / maxVal) * 100));
          const tone = Math.round((z / 10) * 235 + 15);
          return (
            <View key={z} style={styles.zoneCol}>
              <View style={styles.zoneTrack}>
                <View style={[styles.zoneBarFill, { height: `${hPct}%`, backgroundColor: `rgb(${tone},${tone},${tone})` }]} />
              </View>
              <Text style={styles.zoneLabel}>{z === 10 ? 'X' : z}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  hudColumn: {
    position: 'absolute',
    right: 12,
    bottom: 132,
    alignItems: 'flex-end',
    gap: 5,
  },
  hudPill: {
    backgroundColor: 'rgba(10, 15, 26, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hudPillReady: {
    borderColor: color.success,
    backgroundColor: 'rgba(20, 45, 30, 0.85)',
  },
  hudText: {
    fontFamily: mono,
    fontSize: 10.5,
    color: '#F1F5F9',
    fontWeight: '600',
  },
  zoneCard: {
    backgroundColor: color.panelRaised,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  zoneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  zoneTitle: { fontSize: 12, fontWeight: '700', color: color.text },
  zoneMeta: { fontFamily: mono, fontSize: 10, color: color.textDim },
  zoneBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 48,
    gap: 4,
  },
  zoneCol: { flex: 1, alignItems: 'center', gap: 2, height: '100%' },
  zoneTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  zoneBarFill: { width: '100%', borderRadius: 2 },
  zoneLabel: { fontFamily: mono, fontSize: 9, color: color.textMute },
});
