/**
 * SunAzimuthView.tsx
 *
 * 극좌표(polar) 다이어그램으로 태양의 하루 방위·고도를 시각화합니다.
 * - 외원 = 지평선(고도 0°), 중심 = 천정(고도 90°)
 * - 방위각은 시계 방향, N이 위
 * - 현재 시각의 태양 위치는 오렌지 점으로 강조
 * - 일출·일몰, 황금 시간 등 주요 이벤트 마커 표시
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, {
  Circle, Path, Line, G, Text as SvgText, Defs,
  LinearGradient, Stop, RadialGradient,
} from 'react-native-svg';
import SunCalc from 'suncalc';
import { getSunPath } from '../../utils/celestial';
import { useCelestialStore } from '../../store/useCelestialStore';

interface Props {
  theme: any;
  currentTime: Date;
}

/** 극좌표(az, alt) → SVG (x, y) 변환
 *  r = 반지름 * (1 - altitude/90) → 고도 0°=외원, 90°=중심
 */
function polarToXY(azDeg: number, altDeg: number, cx: number, cy: number, R: number) {
  const r = R * (1 - Math.max(0, altDeg) / 90);
  const rad = ((azDeg - 90) * Math.PI) / 180; // N=위(-90° 보정)
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function toPathD(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

export const SunAzimuthView: React.FC<Props> = ({ theme, currentTime }) => {
  const { location } = useCelestialStore();
  const lat = location?.coords.latitude ?? 37.5665;
  const lng = location?.coords.longitude ?? 126.978;

  const { width, height } = Dimensions.get('window');
  const size = Math.min(width - 32, Math.min(360, height * 0.45));
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 24; // 패딩 24

  // ── 하루 태양 궤적 (30분 간격, 49점) ─────────────────────────────────────
  const sunPath = useMemo(() => getSunPath(currentTime, lat, lng), [
    currentTime.toDateString(), lat, lng,
  ]);

  // 지평선 위 점만 사용
  const aboveHorizon = sunPath.filter(p => p.altitude > 0);

  const pathPoints = aboveHorizon.map(p =>
    polarToXY(p.azimuth, p.altitude, cx, cy, R)
  );

  // ── 현재 태양 위치 ─────────────────────────────────────────────────────────
  const sunPos = useMemo(() => {
    const s = SunCalc.getPosition(currentTime, lat, lng);
    return {
      azimuth: (s.azimuth * 180) / Math.PI + 180,
      altitude: (s.altitude * 180) / Math.PI,
    };
  }, [currentTime.getTime(), lat, lng]);

  const sunXY = polarToXY(sunPos.azimuth, sunPos.altitude, cx, cy, R);
  const isAbove = sunPos.altitude > 0;

  // ── 주요 이벤트 (일출·정오·일몰) ─────────────────────────────────────────
  const events = useMemo(() => {
    const times = SunCalc.getTimes(currentTime, lat, lng);
    const items: { label: string; time: Date; color: string }[] = [
      { label: '일출', time: times.sunrise, color: '#FB923C' },
      { label: '정오', time: times.solarNoon, color: '#38BDF8' },
      { label: '일몰', time: times.sunset, color: '#F43F5E' },
    ];
    return items
      .filter(e => e.time && !isNaN(e.time.getTime()))
      .map(e => {
        const sp = SunCalc.getPosition(e.time, lat, lng);
        const az = (sp.azimuth * 180) / Math.PI + 180;
        const alt = (sp.altitude * 180) / Math.PI;
        const timeStr = e.time.toLocaleTimeString('ko-KR', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        });
        return { ...e, az, alt, xy: polarToXY(az, alt, cx, cy, R), timeStr };
      })
      .filter(e => e.alt > 0);
  }, [currentTime.toDateString(), lat, lng, cx, cy, R]);

  // ── 방위 레이블 ────────────────────────────────────────────────────────────
  const directions = [
    { label: 'N', az: 0 },
    { label: 'NE', az: 45 },
    { label: 'E', az: 90 },
    { label: 'SE', az: 135 },
    { label: 'S', az: 180 },
    { label: 'SW', az: 225 },
    { label: 'W', az: 270 },
    { label: 'NW', az: 315 },
  ];

  // ── 고도 동심원 (0°, 30°, 60°) ─────────────────────────────────────────────
  const altCircles = [0, 30, 60].map(alt => ({
    alt,
    r: R * (1 - alt / 90),
  }));

  // 현재 시각 포맷
  const timeStr = currentTime.toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <View style={[styles.container]}>
      <Svg width={size} height={size}>
        <Defs>
          {/* 원판 배경 그라디언트 */}
          <RadialGradient id="diskGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#1E293B" stopOpacity="0.95" />
            <Stop offset="70%" stopColor="#0F172A" stopOpacity="0.95" />
            <Stop offset="100%" stopColor="#020617" stopOpacity="0.98" />
          </RadialGradient>
          {/* 외곽 림 그라디언트 */}
          <LinearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="rgba(148, 163, 184, 0.45)" />
            <Stop offset="50%" stopColor="rgba(56, 189, 248, 0.35)" />
            <Stop offset="100%" stopColor="rgba(148, 163, 184, 0.25)" />
          </LinearGradient>
          {/* 태양 글로우 */}
          <RadialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FDE68A" stopOpacity="1" />
            <Stop offset="60%" stopColor="#F97316" stopOpacity="0.7" />
            <Stop offset="100%" stopColor="#F97316" stopOpacity="0" />
          </RadialGradient>
          {/* 경로 그라디언트 */}
          <LinearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#FB923C" stopOpacity="0.5" />
            <Stop offset="50%" stopColor="#FDE68A" stopOpacity="0.95" />
            <Stop offset="100%" stopColor="#F43F5E" stopOpacity="0.5" />
          </LinearGradient>
        </Defs>

        {/* ── 배경 원판 & 림 테두리 ──────────────────────────────────── */}
        <Circle cx={cx} cy={cy} r={R} fill="url(#diskGrad)" stroke="url(#rimGrad)" strokeWidth={2} />

        {/* ── 고도 동심원 + 레이블 ─────────────────────────────────── */}
        {altCircles.map(({ alt, r }) => (
          <G key={alt}>
            <Circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={alt === 0 ? 'rgba(203,213,225,0.45)' : 'rgba(148,163,184,0.22)'}
              strokeWidth={alt === 0 ? 1.8 : 1}
              strokeDasharray={alt > 0 ? '4 4' : undefined}
            />
            {alt > 0 && (
              <SvgText
                x={cx + 4} y={cy - r + 13}
                fontSize={10}
                fontWeight="700"
                fill="rgba(226,232,240,0.85)"
                textAnchor="middle"
              >
                {alt}°
              </SvgText>
            )}
          </G>
        ))}

        {/* ── 방위 축선 (N/S/E/W) ─────────────────────────────────── */}
        {[0, 90, 180, 270].map(az => {
          const end = polarToXY(az, 0, cx, cy, R);
          return (
            <Line
              key={az}
              x1={cx} y1={cy} x2={end.x} y2={end.y}
              stroke="rgba(148,163,184,0.25)" strokeWidth={1.2}
            />
          );
        })}

        {/* ── 정가운데 관측자('내 위치') 마커 ───────────────────────────── */}
        <G>
          <Circle cx={cx} cy={cy} r={14} fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.35)" strokeWidth={1} />
          <Circle cx={cx} cy={cy} r={4.5} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={1.5} />
          <SvgText
            x={cx} y={cy + 25}
            fontSize={9.5}
            fontWeight="700"
            fill="#38BDF8"
            textAnchor="middle"
          >
            내 위치
          </SvgText>
        </G>

        {/* ── 태양 궤적 경로 ───────────────────────────────────────── */}
        {pathPoints.length > 1 && (
          <Path
            d={toPathD(pathPoints)}
            fill="none"
            stroke="url(#pathGrad)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* ── 이벤트 마커 (일출 / 정오 / 일몰) ───────────────────────── */}
        {events.map((e, i) => {
          const isLeft = e.xy.x < cx;
          const textAnchor = isLeft ? 'end' : 'start';
          const textX = isLeft ? e.xy.x - 8 : e.xy.x + 8;

          return (
            <G key={i}>
              <Circle cx={e.xy.x} cy={e.xy.y} r={4.5} fill={e.color} stroke="#FFFFFF" strokeWidth={1.2} />
              <SvgText
                x={textX} y={e.xy.y - 3}
                fontSize={9.5}
                fontWeight="800"
                fill={e.color}
                textAnchor={textAnchor}
              >
                {e.label}
              </SvgText>
              <SvgText
                x={textX} y={e.xy.y + 9}
                fontSize={8.5}
                fontWeight="600"
                fill="#E2E8F0"
                textAnchor={textAnchor}
              >
                {e.timeStr}
              </SvgText>
            </G>
          );
        })}

        {/* ── 태양 현재 위치 ───────────────────────────────────────── */}
        {isAbove && (
          <G>
            {/* 글로우 */}
            <Circle cx={sunXY.x} cy={sunXY.y} r={18} fill="url(#sunGlow)" />
            {/* 본체 */}
            <Circle cx={sunXY.x} cy={sunXY.y} r={8} fill="#FDE68A" />
            <Circle cx={sunXY.x} cy={sunXY.y} r={5.5} fill="#F97316" />
          </G>
        )}

        {/* 태양이 지평선 아래일 때 지평선 위에 아이콘 표시 */}
        {!isAbove && (
          <G>
            {/* 지평선 원 위 태양 예상 위치 */}
            {(() => {
              const onHorizon = polarToXY(sunPos.azimuth, 0, cx, cy, R);
              return (
                <>
                  <Circle cx={onHorizon.x} cy={onHorizon.y} r={7} fill="rgba(251,146,60,0.3)" stroke="#FB923C" strokeWidth={1.5} />
                  <SvgText x={onHorizon.x} y={onHorizon.y + 4} fontSize={8} fill="#FB923C" textAnchor="middle">☽</SvgText>
                </>
              );
            })()}
          </G>
        )}

        {/* ── 방위 레이블 ─────────────────────────────────────────── */}
        {directions.map(({ label, az }) => {
          const isCardinal = label.length === 1;
          const isNorth = label === 'N';
          const pos = polarToXY(az, 0, cx, cy, R + (isCardinal ? 15 : 12));
          return (
            <SvgText
              key={az}
              x={pos.x} y={pos.y + 4}
              fontSize={isCardinal ? 13 : 9.5}
              fontWeight={isCardinal ? '900' : '600'}
              fill={isNorth ? '#38BDF8' : isCardinal ? '#FFFFFF' : 'rgba(203,213,225,0.75)'}
              textAnchor="middle"
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>

      {/* ── 수치 패널 ────────────────────────────────────────────────────── */}
      <View style={styles.infoRow}>
        <InfoChip label="방위각" value={`${sunPos.azimuth.toFixed(1)}°`} color="#FB923C" />
        <InfoChip
          label="고도"
          value={`${sunPos.altitude.toFixed(1)}°`}
          color={isAbove ? '#FDE68A' : '#94A3B8'}
        />
        <InfoChip
          label="상태"
          value={isAbove ? '지평선 위' : '지평선 아래'}
          color={isAbove ? '#34D399' : '#94A3B8'}
        />
      </View>
      <Text style={styles.timeLabel}>{timeStr} 기준</Text>
    </View>
  );
};

const InfoChip = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <View style={styles.chip}>
    <Text style={styles.chipLabel}>{label}</Text>
    <Text style={[styles.chipValue, { color }]}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.7)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 2,
  },
  chipLabel: {
    fontSize: 10,
    color: 'rgba(148,163,184,0.8)',
    fontWeight: '500',
  },
  chipValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  timeLabel: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(148,163,184,0.5)',
  },
});
