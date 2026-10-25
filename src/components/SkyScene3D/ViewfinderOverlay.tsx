/**
 * ViewfinderOverlay.tsx
 *
 * 하늘 위 눈금 — **방위 한 줄**만 늘 보입니다(디자인 2단, 2026-10-25).
 * - 상단 방위 눈금자 (Heading / Azimuth Ruler) — 읽기, 늘 보임
 * - 우측 고도각 · 좌측 시야각 눈금자 — 손으로 시선·줌을 바꾸는 동안만(`adjusting`)
 *
 * 예전의 3등분선 · 교차점 십자 · 모서리 괄호 · 하단 방위 눈금은 뺐습니다. 다섯 겹 장식이 하늘(주인공)을 가렸습니다.
 *
 * 모든 요소는 pointerEvents="none"으로 3D 씬의 터치 인터랙션을 완벽하게 통과시킵니다.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View, Text } from 'react-native';

interface ViewfinderOverlayProps {
  cameraAzimuth: number;    // 0 ~ 360°
  cameraElevation: number;  // -85 ~ +85°
  cameraFov: number;        // 20 ~ 90°
  theme?: any;
  /** 손으로 시선·줌을 바꾸는 중(놓고 잠시 뒤 false). 이때만 고도·시야각 눈금을 보입니다. */
  adjusting?: boolean;
}

export const ViewfinderOverlay: React.FC<ViewfinderOverlayProps> = ({
  cameraAzimuth,
  cameraElevation,
  cameraFov,
  theme,
  adjusting = false,
}) => {
  const normAz = ((cameraAzimuth % 360) + 360) % 360;
  const roundedAz = Math.round(normAz);
  const roundedElev = Math.round(cameraElevation);
  const roundedFov = Math.round(cameraFov);

  // 현재 방위 문자 (N, NE, E, SE, S, SW, W, NW)
  const dirLabel = useMemo(() => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(normAz / 45) % 8;
    return dirs[idx];
  }, [normAz]);

  // 상단 수평 방위 눈금자 틱 생성 (-60° ~ +60° 범위)
  const headingTicks = useMemo(() => {
    const ticks = [];
    const pxPerDeg = 2.4;
    for (let offset = -60; offset <= 60; offset += 5) {
      const deg = (normAz + offset + 360) % 360;
      const rDeg = Math.round(deg / 5) * 5 % 360;
      const isCurrent = Math.abs(offset) < 2.5;
      const isMajor = rDeg % 45 === 0;
      const isMedium = rDeg % 15 === 0;

      let label = '';
      if (rDeg === 0) label = 'N';
      else if (rDeg === 45) label = 'NE';
      else if (rDeg === 90) label = 'E';
      else if (rDeg === 135) label = 'SE';
      else if (rDeg === 180) label = 'S';
      else if (rDeg === 225) label = 'SW';
      else if (rDeg === 270) label = 'W';
      else if (rDeg === 315) label = 'NW';
      else if (isMedium) label = `${rDeg}°`;

      ticks.push(
        <View
          key={offset}
          style={[
            styles.headingTick,
            { transform: [{ translateX: offset * pxPerDeg }] }
          ]}
        >
          <View
            style={[
              styles.tickBar,
              {
                height: isCurrent ? 12 : isMajor ? 10 : isMedium ? 6 : 4,
                backgroundColor: isCurrent ? '#38BDF8' : isMajor ? '#38BDF8' : isMedium ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
                width: isCurrent ? 2.5 : isMajor ? 2 : 1,
              }
            ]}
          />
          {label !== '' && (
            <Text
              style={[
                styles.tickText,
                {
                  color: isCurrent ? '#38BDF8' : isMajor ? '#38BDF8' : 'rgba(255,255,255,0.6)',
                  fontWeight: isCurrent || isMajor ? '800' : '700',
                  fontSize: isCurrent ? 11 : 9,
                }
              ]}
            >
              {label}
            </Text>
          )}
        </View>
      );
    }
    return ticks;
  }, [normAz]);


  // 우측 수직 고도각(Pitch) 눈금자 틱 생성 (-25° ~ +25° 범위)
  const pitchTicks = useMemo(() => {
    const ticks = [];
    const pxPerDeg = 2.8;
    for (let offset = -25; offset <= 25; offset += 5) {
      const elev = roundedElev + offset;
      if (elev < -85 || elev > 85) continue;
      const isCurrent = offset === 0;
      const isZero = elev === 0;
      const isTen = elev % 10 === 0;

      ticks.push(
        <View
          key={offset}
          style={[
            styles.pitchTick,
            { transform: [{ translateY: -offset * pxPerDeg }] }
          ]}
        >
          {/* 눈금 수치 라벨: 현재 고도각은 무조건 볼드/확대 강조, 그 외에는 10도 단위만 서브로 표시 */}
          {(isCurrent || isTen) && (
            <Text
              style={[
                styles.pitchText,
                {
                  color: isCurrent ? '#F59E0B' : isZero ? '#F59E0B' : 'rgba(255,255,255,0.65)',
                  fontSize: isCurrent ? 11 : 9,
                  fontWeight: isCurrent ? '800' : '700',
                }
              ]}
            >
              {elev > 0 ? `+${elev}°` : `${elev}°`}
            </Text>
          )}
          <View
            style={[
              styles.pitchBar,
              {
                width: isCurrent ? 16 : isZero ? 12 : isTen ? 8 : 4,
                backgroundColor: isCurrent ? '#F59E0B' : isZero ? '#F59E0B' : isTen ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)',
                height: isCurrent ? 2 : isZero ? 1.5 : 1,
              }
            ]}
          />
        </View>
      );
    }
    return ticks;
  }, [roundedElev]);

  // 좌측 수직 FOV 눈금자 틱 생성 (-20° ~ +20° 범위)
  const fovTicks = useMemo(() => {
    const ticks = [];
    const pxPerDeg = 2.4;
    for (let offset = -20; offset <= 20; offset += 5) {
      const fovVal = roundedFov + offset;
      if (fovVal < 15 || fovVal > 95) continue;
      const isCurrent = offset === 0;
      const isTen = fovVal % 10 === 0;

      ticks.push(
        <View
          key={offset}
          style={[
            styles.fovTick,
            { transform: [{ translateY: -offset * pxPerDeg }] }
          ]}
        >
          <View
            style={[
              styles.fovBar,
              {
                width: isCurrent ? 16 : isTen ? 8 : 4,
                backgroundColor: isCurrent ? '#38BDF8' : isTen ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
                height: isCurrent ? 2 : 1,
              }
            ]}
          />
          {/* 눈금 수치 라벨: 현재 FOV는 무조건 볼드/확대 강조, 그 외에는 10도 단위만 서브로 표시 */}
          {(isCurrent || isTen) && (
            <Text
              style={[
                styles.fovTickText,
                {
                  color: isCurrent ? '#38BDF8' : 'rgba(255,255,255,0.6)',
                  fontSize: isCurrent ? 11 : 9,
                  fontWeight: isCurrent ? '800' : '700',
                }
              ]}
            >
              {isCurrent ? `${fovVal}°` : `${fovVal}°`}
            </Text>
          )}
        </View>
      );
    }
    return ticks;
  }, [roundedFov]);

  return (
    <View style={styles.container} pointerEvents="none">
      {/* ── 방위 눈금 한 줄 (읽기 — 늘 보임) ─────────────────────────────── */}
      <View style={styles.topRulerContainer}>
        <View style={styles.topCenterIndicator}>
          <Text style={styles.topHeaderText}>{roundedAz}° {dirLabel}</Text>
          <View style={styles.topPointer} />
        </View>
        <View style={styles.topRulerTrack}>
          {headingTicks}
        </View>
      </View>

      {/* ── 고도·시야각 눈금 — 손으로 하늘을 돌리거나 당기는 동안만(디자인 2단: 하늘을 가리지 않음) ── */}
      {adjusting && (
        <View style={styles.rightRulerContainer}>
          <View style={styles.rightRulerTrack}>
            {pitchTicks}
          </View>
          <View style={styles.rightPointer} />
        </View>
      )}
      {adjusting && (
        <View style={styles.leftRulerContainer}>
          <View style={styles.leftPointer} />
          <View style={styles.leftRulerTrack}>
            {fovTicks}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },

  // ── 상단 방위 눈금자 ──
  topRulerContainer: {
    position: 'absolute',
    top: 6,
    left: '12%',
    right: '12%',
    alignItems: 'center',
  },
  topCenterIndicator: {
    alignItems: 'center',
    marginBottom: 2,
  },
  topHeaderText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 2,
  },
  topPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#38BDF8',
  },
  topRulerTrack: {
    width: '100%',
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headingTick: {
    position: 'absolute',
    alignItems: 'center',
    width: 24,
    marginLeft: -12,
  },
  tickBar: {
    borderRadius: 0.5,
  },
  tickText: {
    fontSize: 9,
    marginTop: 2,
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── 우측 각도(Pitch) 눈금자 ──
  rightRulerContainer: {
    position: 'absolute',
    right: 8,
    top: '28%',
    bottom: '28%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  rightPointer: {
    width: 0,
    height: 0,
    borderTopWidth: 3.5,
    borderBottomWidth: 3.5,
    borderRightWidth: 5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: '#F59E0B',
    marginLeft: 3,
  },
  rightRulerTrack: {
    width: 44,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  pitchTick: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    right: 0,
    gap: 4,
  },
  pitchBar: {
    borderRadius: 0.5,
  },
  pitchText: {
    fontSize: 9,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── 좌측 시야각(FOV) 눈금자 ──
  leftRulerContainer: {
    position: 'absolute',
    left: 8,
    top: '28%',
    bottom: '28%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  leftPointer: {
    width: 0,
    height: 0,
    borderTopWidth: 3.5,
    borderBottomWidth: 3.5,
    borderLeftWidth: 5,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#38BDF8',
    marginRight: 3,
  },
  leftRulerTrack: {
    width: 44,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'flex-start',
    overflow: 'hidden',
  },
  fovTick: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    left: 0,
    gap: 4,
  },
  fovBar: {
    borderRadius: 0.5,
  },
  fovTickText: {
    fontSize: 9,
    fontWeight: '700',
  },
});
