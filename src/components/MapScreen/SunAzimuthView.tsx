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
  // ── 160cm 가상 기둥 및 물리 기반 그림자 계산 ──────────────────────────────
  const POLE_HEIGHT_M = 1.6; // 160cm 기둥
  const shadowInfo = useMemo(() => {
    if (!isAbove) {
      return {
        lengthM: 0,
        lengthPx: 0,
        azimuth: 0,
        endX: cx,
        endY: cy,
        pathD: '',
      };
    }

    // 그림자 방위각은 태양의 정반대 (180° 반대편)
    const shadowAzimuth = (sunPos.azimuth + 180) % 360;
    const shadowRad = ((shadowAzimuth - 90) * Math.PI) / 180;

    // 물리적 그림자 길이 L = H / tan(alt)
    const altRad = Math.max(0.06, (sunPos.altitude * Math.PI) / 180); // 최소 3.4° 이상으로 제한해 무한대 방지
    const lengthM = POLE_HEIGHT_M / Math.tan(altRad);

    // 원판(반지름 R) 내 스케일링: 고도 45°(길이 1.6m)일 때 R * 0.28 픽셀
    const scalePxPerM = (R * 0.28) / POLE_HEIGHT_M;
    const rawPx = lengthM * scalePxPerM;
    // 원판 지평선 테두리를 넘지 않도록 최대 R * 0.92로 클램프
    const lengthPx = Math.min(R * 0.92, Math.max(6, rawPx));

    const endX = cx + lengthPx * Math.cos(shadowRad);
    const endY = cy + lengthPx * Math.sin(shadowRad);

    // 그림자 너비 (기둥 밑동 3.5px -> 끝부분은 빛 회절/반그림자로 살짝 확산)
    const normX = -Math.sin(shadowRad);
    const normY = Math.cos(shadowRad);
    const baseW = 3.2;
    const endW = 4.5 + Math.min(6, lengthPx * 0.05);

    // 사다리꼴 그림자 Path
    const p1 = { x: cx - normX * baseW, y: cy - normY * baseW };
    const p2 = { x: cx + normX * baseW, y: cy + normY * baseW };
    const p3 = { x: endX + normX * endW, y: endY + normY * endW };
    const p4 = { x: endX - normX * endW, y: endY - normY * endW };

    const pathD = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} L ${p3.x.toFixed(1)} ${p3.y.toFixed(1)} Q ${endX.toFixed(1)} ${endY.toFixed(1)} ${p4.x.toFixed(1)} ${p4.y.toFixed(1)} Z`;

    return {
      lengthM,
      lengthPx,
      azimuth: shadowAzimuth,
      endX,
      endY,
      pathD,
    };
  }, [isAbove, sunPos.azimuth, sunPos.altitude, cx, cy, R]);

  // ── 태양 중심 다이내믹 원판 조명 & 노을 그라디언트 ────────────────────────────
  const diskLighting = useMemo(() => {
    const alt = sunPos.altitude;

    if (alt > 25) {
      // [1] 한낮: 맑고 밝은 태양광 코어 + 맑은 하늘빛
      return {
        focusX: `${((sunXY.x / size) * 100).toFixed(1)}%`,
        focusY: `${((sunXY.y / size) * 100).toFixed(1)}%`,
        radius: '85%',
        coreColor: '#FFFBEB',
        coreOpacity: 0.95,
        midColor: '#0284C7',
        midOpacity: 0.45,
        outerColor: '#070F1E',
        outerOpacity: 0.98,
        rimColor: 'rgba(56, 189, 248, 0.4)',
      };
    } else if (alt > 10) {
      // [2] 늦은 오후 / 이른 아침 (골든 아워: 10°~25°)
      return {
        focusX: `${((sunXY.x / size) * 100).toFixed(1)}%`,
        focusY: `${((sunXY.y / size) * 100).toFixed(1)}%`,
        radius: '80%',
        coreColor: '#FEF08A',
        coreOpacity: 0.95,
        midColor: '#EA580C',
        midOpacity: 0.55,
        outerColor: '#091122',
        outerOpacity: 0.98,
        rimColor: 'rgba(245, 158, 11, 0.45)',
      };
    } else if (alt > 0) {
      // [3] 일출·일몰 노을 (0°~10°): 고도가 낮아질수록 짙은 노을빛 (버닝 오렌지 & 크림슨 & 퍼플)
      return {
        focusX: `${((sunXY.x / size) * 100).toFixed(1)}%`,
        focusY: `${((sunXY.y / size) * 100).toFixed(1)}%`,
        radius: '80%',
        coreColor: '#FB923C',
        coreOpacity: 0.98,
        midColor: '#DC2626',
        midOpacity: 0.72,
        outerColor: '#1A0B2E',
        outerOpacity: 0.98,
        rimColor: 'rgba(244, 63, 94, 0.55)',
      };
    } else if (alt > -6) {
      // [4] 시민 박명 (0° ~ -6°): 해가 졌으나 지평선 쪽에 노을 잔광(Afterglow)이 남음
      const horizonPoint = polarToXY(sunPos.azimuth, 0, cx, cy, R);
      return {
        focusX: `${((horizonPoint.x / size) * 100).toFixed(1)}%`,
        focusY: `${((horizonPoint.y / size) * 100).toFixed(1)}%`,
        radius: '65%',
        coreColor: '#9333EA',
        coreOpacity: 0.5,
        midColor: '#3B0764',
        midOpacity: 0.4,
        outerColor: '#05070D',
        outerOpacity: 0.98,
        rimColor: 'rgba(147, 51, 234, 0.35)',
      };
    } else {
      // [5] 완전한 야간 (alt <= -6°): 깊은 흑연 옵시디언 밤
      return {
        focusX: '50%',
        focusY: '50%',
        radius: '60%',
        coreColor: '#0E1726',
        coreOpacity: 0.8,
        midColor: '#080C14',
        midOpacity: 0.95,
        outerColor: '#04060A',
        outerOpacity: 1.0,
        rimColor: 'rgba(255, 255, 255, 0.12)',
      };
    }
  }, [sunPos.altitude, sunXY.x, sunXY.y, size, cx, cy, R, sunPos.azimuth]);

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
          {/* 태양 중심 다이내믹 원판 조명 그라디언트 */}
          <RadialGradient
            id="diskGrad"
            cx={diskLighting.focusX}
            cy={diskLighting.focusY}
            r={diskLighting.radius}
            fx={diskLighting.focusX}
            fy={diskLighting.focusY}
          >
            <Stop offset="0%" stopColor={diskLighting.coreColor} stopOpacity={diskLighting.coreOpacity} />
            <Stop offset="45%" stopColor={diskLighting.midColor} stopOpacity={diskLighting.midOpacity} />
            <Stop offset="100%" stopColor={diskLighting.outerColor} stopOpacity={diskLighting.outerOpacity} />
          </RadialGradient>

          {/* 그림자 그라디언트 (기둥 근처는 진하고 끝으로 갈수록 반그림자) */}
          <LinearGradient
            id="shadowGrad"
            x1={cx}
            y1={cy}
            x2={shadowInfo.endX}
            y2={shadowInfo.endY}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0%" stopColor="#000000" stopOpacity="0.82" />
            <Stop offset="70%" stopColor="#000000" stopOpacity="0.55" />
            <Stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
          </LinearGradient>

          {/* 외곽 림 그라디언트 */}
          <LinearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={diskLighting.rimColor} />
            <Stop offset="100%" stopColor="rgba(255, 255, 255, 0.08)" />
          </LinearGradient>

          {/* 태양 글로우 */}
          <RadialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FFFBEB" stopOpacity="1" />
            <Stop offset="50%" stopColor="#F59E0B" stopOpacity="0.8" />
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
              stroke={alt === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)'}
              strokeWidth={alt === 0 ? 1.8 : 1}
              strokeDasharray={alt > 0 ? '4 4' : undefined}
            />
            {alt > 0 && (
              <SvgText
                x={cx + 4} y={cy - r + 13}
                fontSize={9.5}
                fontWeight="800"
                fontFamily="monospace"
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
              stroke="rgba(255,255,255,0.18)" strokeWidth={1}
            />
          );
        })}

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

        {/* ── 160cm 기둥의 물리 기반 그림자 (Shadow) ────────────────── */}
        {isAbove && shadowInfo.pathD.length > 0 && (
          <G>
            {/* 메인 그림자 본체 */}
            <Path
              d={shadowInfo.pathD}
              fill="url(#shadowGrad)"
            />
            {/* 그림자 중심 정밀 유도선 */}
            <Line
              x1={cx}
              y1={cy}
              x2={shadowInfo.endX}
              y2={shadowInfo.endY}
              stroke="rgba(255, 255, 255, 0.25)"
              strokeWidth={0.8}
              strokeDasharray="2 2"
            />
            {/* 그림자 끝 지점 마커 */}
            <Circle
              cx={shadowInfo.endX}
              cy={shadowInfo.endY}
              r={2.5}
              fill="#F59E0B"
            />
            {/* 그림자 끝 실측 길이 텍스트 라벨 */}
            <SvgText
              x={shadowInfo.endX + (shadowInfo.endX >= cx ? 8 : -8)}
              y={shadowInfo.endY + (shadowInfo.endY >= cy ? 12 : -6)}
              fontSize={9}
              fontWeight="900"
              fontFamily="monospace"
              fill="#FDE68A"
              textAnchor={shadowInfo.endX >= cx ? 'start' : 'end'}
            >
              {`${shadowInfo.lengthM.toFixed(1)}m`}
            </SvgText>
          </G>
        )}

        {/* ── 정가운데 160cm 관측 기둥(Gnomon) 마커 ────────────────────── */}
        <G>
          {/* 기둥 바닥 원형 베이스 */}
          <Circle cx={cx} cy={cy} r={9} fill="rgba(15, 23, 42, 0.88)" stroke="rgba(245, 158, 11, 0.6)" strokeWidth={1.2} />
          {/* 기둥 본체 핀 */}
          <Circle cx={cx} cy={cy} r={4} fill="#F59E0B" stroke="#FFFFFF" strokeWidth={1} />
          <Circle cx={cx} cy={cy} r={1.5} fill="#FFFFFF" />
          <SvgText
            x={cx} y={cy + 22}
            fontSize={8.5}
            fontWeight="900"
            fontFamily="monospace"
            fill="#F59E0B"
            textAnchor="middle"
          >
            160cm 기둥
          </SvgText>
        </G>

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
                fontWeight="700"
                fontFamily="monospace"
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
            {/* 강렬한 태양 글로우 */}
            <Circle cx={sunXY.x} cy={sunXY.y} r={22} fill="url(#sunGlow)" />
            {/* 본체 */}
            <Circle cx={sunXY.x} cy={sunXY.y} r={8.5} fill="#FFFBEB" stroke="#F59E0B" strokeWidth={1.5} />
            <Circle cx={sunXY.x} cy={sunXY.y} r={5} fill="#F97316" />
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
                  <Circle cx={onHorizon.x} cy={onHorizon.y} r={7} fill="rgba(251,146,60,0.2)" stroke="#FB923C" strokeWidth={1.2} />
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
              fontSize={isCardinal ? 12 : 9}
              fontWeight={isCardinal ? '900' : '700'}
              fontFamily="monospace"
              fill={isNorth ? '#38BDF8' : isCardinal ? '#FFFFFF' : 'rgba(203,213,225,0.65)'}
              textAnchor="middle"
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>

      {/* ── 수치 패널 (HUD 스타일) ───────────────────────────────────────── */}
      <View style={styles.infoRow}>
        <InfoChip label="방위각" value={`${sunPos.azimuth.toFixed(1)}°`} color="#FB923C" />
        <InfoChip
          label="고도"
          value={`${sunPos.altitude.toFixed(1)}°`}
          color={isAbove ? '#FDE68A' : '#94A3B8'}
        />
        <InfoChip
          label="160cm 그림자"
          value={isAbove ? `${shadowInfo.lengthM.toFixed(2)}m` : '밤 (없음)'}
          color={isAbove ? '#34D399' : '#64748B'}
        />
      </View>
      <Text style={styles.timeLabel}>{timeStr} 관측 기준</Text>
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
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    width: '100%',
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 24, 0.95)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  chipLabel: {
    fontSize: 9.5,
    color: 'rgba(148, 163, 184, 0.8)',
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  chipValue: {
    fontSize: 13.5,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },
  timeLabel: {
    marginTop: 8,
    fontSize: 10.5,
    color: 'rgba(148, 163, 184, 0.65)',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
});
