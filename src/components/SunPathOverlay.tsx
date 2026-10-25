/**
 * SunPathOverlay.tsx — 전체 화면 카메라 위에 **해 경로 · 지금 해 · 다음 출몰 · 방위 눈금**을 겹칩니다
 * (2026-10-25, 디자인 2단 · 촬영 화면 전체 화면).
 *
 * 예전 촬영 화면에는 카메라 위에 해 경로가 없었고(3D 시뮬 안에만), 카메라와 시뮬레이터가 위아래 4:3 상자로
 * 나뉘어 둘 다 작았습니다. 이제 카메라가 화면을 채우고, 그 위에 같은 핀홀 모형(`cameraOverlay.ts` →
 * `arVision.project`)으로 해 자리를 그립니다. 해는 원을 비운 고리로 그립니다 — 진짜 해가 고리 안에 들면
 * 방위가 맞은 것입니다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import type { Attitude } from '../utils/arVision';
import { projectAzAlt, projectPath, type PathPoint, type PreviewOptics } from '../utils/cameraOverlay';
import { azimuthOffsetToPx } from '../utils/arProjection';
import { color, radius, space, type } from '../theme/tokens';

const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const PILL_H = 24;

interface Props {
  width: number;
  height: number;
  optics: PreviewOptics;
  attitude: Attitude;
  path: PathPoint[];
  /** 지금 해(겉보기 고도) */
  sun: { az: number; alt: number };
  sunLabel: string;
  /** 다음 출몰 — 지평선 위 표시 */
  event: { az: number; label: string } | null;
  /** 방위 눈금 줄의 y(화면 아래쪽) */
  rulerY: number;
}

export const SunPathOverlay: React.FC<Props> = ({ width, height, optics, attitude, path, sun, sunLabel, event, rulerY }) => {
  const segs = projectPath(path, attitude, optics.k);
  const s = sun.alt > -2 ? projectAzAlt(sun.az, sun.alt, attitude, optics.k) : null;
  const ev = event ? projectAzAlt(event.az, 0, attitude, optics.k) : null;
  const on = (p: { x: number; y: number } | null, m = 0): p is { x: number; y: number } =>
    !!p && p.x >= -m && p.x <= width + m && p.y >= -m && p.y <= height + m;

  // 방위 눈금 — 렌더와 같은 탄젠트 투영(`arProjection`). 기울기는 보지 않습니다(한 줄 눈금).
  const ticks: { x: number; deg: number }[] = [];
  for (let off = -60; off <= 60; off += 10) {
    const deg = Math.round((attitude.yawDeg + off) / 10) * 10;
    const d = ((deg - attitude.yawDeg + 540) % 360) - 180;
    const dx = azimuthOffsetToPx(d, width, optics.hFovDeg);
    if (dx == null) continue;
    const x = width / 2 + dx;
    if (x < 16 || x > width - 16) continue;
    ticks.push({ x, deg: ((deg % 360) + 360) % 360 });
  }

  const pill = (p: { x: number; y: number }, dx: number, dy: number) => ({
    left: Math.max(space.sm, Math.min(width - 132, p.x + dx)),
    top: Math.max(space.sm, Math.min(height - PILL_H - space.sm, p.y + dy)),
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {segs.map((seg, i) => (
          <Polyline
            key={i}
            points={seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={color.sun}
            strokeWidth={2.5}
            strokeDasharray="3 7"
            strokeLinecap="round"
            opacity={0.9}
          />
        ))}
        {on(s, 12) && <Circle cx={s.x} cy={s.y} r={14} stroke={color.sun} strokeWidth={2} fill="none" />}
        {on(ev) && <Line x1={ev.x} y1={ev.y - 8} x2={ev.x} y2={ev.y + 8} stroke={color.glow} strokeWidth={2} />}
        {ticks.map(t => (
          <Line key={t.deg} x1={t.x} y1={rulerY} x2={t.x} y2={rulerY + (CARDINALS[t.deg] ? 8 : 5)} stroke={color.textDim} strokeWidth={1} />
        ))}
      </Svg>
      {ticks.map(t => (
        <Text key={`l${t.deg}`} style={[styles.tick, { left: t.x - 24, top: rulerY + 10 }]}>{CARDINALS[t.deg] ?? `${t.deg}°`}</Text>
      ))}
      {on(s) && (
        <View style={[styles.pill, pill(s, 20, -PILL_H - 4)]}>
          <View style={[styles.dot, { backgroundColor: color.sun }]} />
          <Text style={styles.pillText}>{sunLabel}</Text>
        </View>
      )}
      {on(ev) && event && (
        <View style={[styles.pill, pill(ev, 8, 12)]}>
          <View style={[styles.dot, { backgroundColor: color.glow }]} />
          <Text style={styles.pillText}>{event.label}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  tick: { position: 'absolute', width: 48, textAlign: 'center', ...type.micro, color: color.textDim },
  pill: {
    position: 'absolute', height: PILL_H, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.overlay,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...type.label, color: color.text },
});
