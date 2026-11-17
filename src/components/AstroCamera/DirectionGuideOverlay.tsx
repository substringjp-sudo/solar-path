import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { Check, Target, Vibrate, VolumeX, X } from 'lucide-react-native';
import { color, radius, space, type } from '../../theme/tokens';
import { PressScale } from '../ui';
import { L3, type Language } from '../../utils/i18n';
import type { Attitude } from '../../utils/arVision';
import { projectAzAlt, type PreviewOptics } from '../../utils/cameraOverlay';
import type { DirectionGuideState, DirectionTarget } from '../../utils/astroCameraUi';

interface DirectionGuideOverlayProps {
  target: DirectionTarget;
  guide: DirectionGuideState;
  optics: PreviewOptics;
  attitude: Attitude;
  vibrationEnabled: boolean;
  onToggleVibration: () => void;
  onClearTarget: () => void;
  stageWidth: number;
  stageHeight: number;
  language: Language;
}

/**
 * 사각형 테두리([m, w-m] x [m, h-m]) 위 시계방향 둘레 거리 s -> (x, y) 좌표 변환.
 */
function rectPointAt(s: number, m: number, rw: number, rh: number): { x: number; y: number } {
  const p = 2 * (rw + rh);
  const d = ((s % p) + p) % p;
  if (d <= rw) return { x: m + d, y: m };
  if (d <= rw + rh) return { x: m + rw, y: m + (d - rw) };
  if (d <= 2 * rw + rh) return { x: m + rw - (d - rw - rh), y: m + rh };
  return { x: m, y: m + rh - (d - 2 * rw - rh) };
}

/**
 * 목표 방향이 화면 밖일 때 해당 방향 테두리 주변을 따라 파란색 안내선(모서리 꺾임 포함)을 만든다.
 */
function buildPerimeterGlowPoints(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  w: number,
  h: number,
  spanPx = 84,
): string {
  const m = 3;
  const rw = Math.max(20, w - 2 * m);
  const rh = Math.max(20, h - 2 * m);
  const minX = m;
  const maxX = m + rw;
  const minY = m;
  const maxY = m + rh;

  const tx = ux > 1e-4 ? (maxX - cx) / ux : ux < -1e-4 ? (minX - cx) / ux : Infinity;
  const ty = uy > 1e-4 ? (maxY - cy) / uy : uy < -1e-4 ? (minY - cy) / uy : Infinity;
  const tHit = Math.min(tx, ty);
  const bx = Math.max(minX, Math.min(maxX, cx + ux * tHit));
  const by = Math.max(minY, Math.min(maxY, cy + uy * tHit));

  // (bx, by)의 시계방향 둘레 거리 sCenter 계산
  let sCenter = 0;
  if (Math.abs(by - minY) <= 1.5) sCenter = bx - minX;
  else if (Math.abs(bx - maxX) <= 1.5) sCenter = rw + (by - minY);
  else if (Math.abs(by - maxY) <= 1.5) sCenter = rw + rh + (maxX - bx);
  else sCenter = 2 * rw + rh + (maxY - by);

  const p = 2 * (rw + rh);
  const corners = [0, rw, rw + rh, 2 * rw + rh];
  const sStart = sCenter - spanPx;
  const sEnd = sCenter + spanPx;

  const stops: number[] = [sStart];
  for (const k of [-1, 0, 1]) {
    for (const c of corners) {
      const sc = c + k * p;
      if (sc > sStart + 0.5 && sc < sEnd - 0.5) stops.push(sc);
    }
  }
  stops.push(sEnd);
  stops.sort((a, b) => a - b);

  return stops
    .map((s) => {
      const pt = rectPointAt(s, m, rw, rh);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * 목표 방향을 실제 카메라 화각 위에 원(타깃 서클)으로 투영해,
 * 사용자가 화면 중앙 기준 원에 목표 원을 겹쳐 맞추도록 안내한다.
 * 화각 밖에 있을 때는 해당 방향 화면 테두리에 파란 안내선과 가장자리 방향 원을 표시한다.
 */
export const DirectionGuideOverlay: React.FC<DirectionGuideOverlayProps> = ({
  target,
  guide,
  optics,
  attitude,
  vibrationEnabled,
  onToggleVibration,
  onClearTarget,
  stageWidth,
  stageHeight,
  language,
}) => {
  const cx = stageWidth / 2;
  const cy = stageHeight / 2;

  const proj = projectAzAlt(target.azDeg, target.elDeg, attitude, optics.k);
  const padX = 30;
  const padTop = 96;
  const padBottom = 86;

  const isInsideScreen =
    proj != null &&
    proj.x >= padX &&
    proj.x <= stageWidth - padX &&
    proj.y >= padTop &&
    proj.y <= stageHeight - padBottom;

  // 목표가 화면 밖(또는 뒤쪽)일 때 가장자리 방향 원 + 테두리 파란 선 좌표 계산
  let edgePos: { x: number; y: number; angleDeg: number } | null = null;
  let edgeGlowPoints = '';
  if (!isInsideScreen) {
    const rawDx = proj ? proj.x - cx : guide.deltaAzDeg;
    const rawDy = proj ? proj.y - cy : -guide.deltaElDeg;
    const len = Math.hypot(rawDx, rawDy) || 1;
    const ux = rawDx / len;
    const uy = rawDy / len;

    const minX = padX;
    const maxX = Math.max(padX + 1, stageWidth - padX);
    const minY = padTop;
    const maxY = Math.max(padTop + 1, stageHeight - padBottom);

    const tx = ux > 1e-4 ? (maxX - cx) / ux : ux < -1e-4 ? (minX - cx) / ux : Infinity;
    const ty = uy > 1e-4 ? (maxY - cy) / uy : uy < -1e-4 ? (minY - cy) / uy : Infinity;
    const tMin = Math.min(tx, ty);

    const ex = Math.max(minX, Math.min(maxX, cx + ux * tMin));
    const ey = Math.max(minY, Math.min(maxY, cy + uy * tMin));
    const angleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
    edgePos = { x: ex, y: ey, angleDeg };
    edgeGlowPoints = buildPerimeterGlowPoints(cx, cy, ux, uy, stageWidth, stageHeight, 92);
  }

  const yawArrow =
    Math.abs(guide.deltaAzDeg) < 1.5
      ? ''
      : guide.deltaAzDeg > 0
        ? `→ ${Math.round(Math.abs(guide.deltaAzDeg))}°`
        : `← ${Math.round(Math.abs(guide.deltaAzDeg))}°`;
  const pitchArrow =
    Math.abs(guide.deltaElDeg) < 1.5
      ? ''
      : guide.deltaElDeg > 0
        ? `↑ ${Math.round(Math.abs(guide.deltaElDeg))}°`
        : `↓ ${Math.round(Math.abs(guide.deltaElDeg))}°`;

  const hintLabel = guide.onTarget
    ? L3(language, '방향 일치 — 볼헤드를 고정하세요', 'Aligned — lock tripod', '方向一致 — 三脚を固定してください')
    : isInsideScreen
      ? L3(
          language,
          `원을 가운데에 맞추세요 (${guide.errorDeg.toFixed(1)}°)`,
          `Center the circle (${guide.errorDeg.toFixed(1)}°)`,
          `円を中央に合わせてください (${guide.errorDeg.toFixed(1)}°)`,
        )
      : [yawArrow, pitchArrow].filter(Boolean).join('  ') || `${guide.errorDeg.toFixed(1)}°`;

  const activeColor = guide.onTarget ? color.success : color.accent;

  return (
    <View style={[styles.root, { height: stageHeight }]} pointerEvents="box-none">
      {/* 중앙 기준 원 ↔ 투영된 목표 원 + 화면 밖 방향 테두리 파란 선 (SVG) */}
      <Svg width={stageWidth} height={stageHeight} style={StyleSheet.absoluteFill} pointerEvents="none">
        {!isInsideScreen && edgeGlowPoints.length > 0 && (
          <>
            <Polyline
              points={edgeGlowPoints}
              fill="none"
              stroke={color.accent}
              strokeWidth={11}
              strokeOpacity={0.28}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Polyline
              points={edgeGlowPoints}
              fill="none"
              stroke={color.accent}
              strokeWidth={4}
              strokeOpacity={0.95}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {isInsideScreen && proj && !guide.onTarget && (
          <Line
            x1={cx}
            y1={cy}
            x2={proj.x}
            y2={proj.y}
            stroke={color.accent}
            strokeWidth={1.5}
            strokeDasharray="4,4"
            strokeOpacity={0.7}
          />
        )}

        {/* 화면 중앙 고정 기준 원 */}
        <Circle
          cx={cx}
          cy={cy}
          r={28}
          fill={guide.onTarget ? 'rgba(74, 222, 128, 0.14)' : 'rgba(56, 189, 248, 0.05)'}
          stroke={activeColor}
          strokeWidth={guide.onTarget ? 2.5 : 1.5}
          strokeDasharray={guide.onTarget ? undefined : '5,4'}
        />
        <Circle cx={cx} cy={cy} r={2.5} fill={activeColor} />

        {/* 목표 방향 원 (화각 안에 들어온 경우) */}
        {isInsideScreen && proj && (
          <>
            <Circle
              cx={proj.x}
              cy={proj.y}
              r={20}
              fill={guide.onTarget ? 'rgba(74, 222, 128, 0.18)' : 'rgba(56, 189, 248, 0.14)'}
              stroke={activeColor}
              strokeWidth={2.5}
            />
            <Circle cx={proj.x} cy={proj.y} r={4.5} fill={activeColor} />
          </>
        )}
      </Svg>

      {/* 목표가 화각 밖에 있을 때 화면 가장자리에 방향 원 표시 */}
      {!isInsideScreen && edgePos && (
        <View
          pointerEvents="none"
          style={[
            styles.edgeMarker,
            {
              left: edgePos.x - 20,
              top: edgePos.y - 20,
            },
          ]}
        >
          <View
            style={[
              styles.edgeArrowWrap,
              { transform: [{ rotate: `${edgePos.angleDeg}deg` }] },
            ]}
          >
            <Text style={styles.edgeArrow}>▶</Text>
          </View>
          <Text style={styles.edgeDegText}>{`${Math.round(guide.errorDeg)}°`}</Text>
        </View>
      )}

      {/* 무대 하단 상태·진동·해제 칩 바 (중앙 원 정렬 시야를 가리지 않도록 하단 배치) */}
      <View style={styles.bottomHud} pointerEvents="box-none">
        <View style={[styles.dirPill, guide.onTarget && styles.dirPillOk]} pointerEvents="none">
          <Text style={[styles.dirText, guide.onTarget && { color: color.success }]}>
            {hintLabel}
          </Text>
        </View>

        <View style={styles.chipBar} pointerEvents="box-none">
          <View style={[styles.targetChip, guide.onTarget && styles.targetChipOk]}>
            {guide.onTarget ? (
              <Check size={13} color={color.success} />
            ) : (
              <Target size={13} color={color.accent} />
            )}
            <Text style={[styles.targetText, guide.onTarget && { color: color.success }]}>
              {`${Math.round(target.azDeg)}° / ${target.elDeg >= 0 ? '+' : ''}${Math.round(target.elDeg)}°`}
            </Text>
          </View>

          <PressScale
            style={[styles.iconBtn, vibrationEnabled && !guide.onTarget && styles.iconBtnActive]}
            onPress={onToggleVibration}
            accessibilityLabel={L3(language, '진동 가이드 켜기/끄기', 'Toggle vibration guide', '振動ガイド切替')}
          >
            {vibrationEnabled ? (
              <Vibrate size={14} color={guide.onTarget ? color.success : color.accent} />
            ) : (
              <VolumeX size={14} color={color.textDim} />
            )}
          </PressScale>

          <PressScale
            style={styles.iconBtn}
            onPress={onClearTarget}
            accessibilityLabel={L3(language, '목표 방향 해제', 'Clear target direction', '目標方向を解除')}
          >
            <X size={14} color={color.text} />
          </PressScale>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0 },
  edgeMarker: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: color.accent,
    backgroundColor: 'rgba(10, 15, 26, 0.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  edgeArrowWrap: {
    position: 'absolute',
    width: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 2,
  },
  edgeArrow: {
    fontSize: 9,
    color: color.accent,
    lineHeight: 10,
  },
  edgeDegText: {
    ...type.micro,
    fontSize: 10,
    color: color.text,
    fontWeight: '700',
    includeFontPadding: false,
  },
  bottomHud: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
    gap: 6,
  },
  chipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: space.sm,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.overlay,
  },
  targetChipOk: {
    borderColor: color.success,
    backgroundColor: 'rgba(10, 28, 18, 0.85)',
  },
  targetText: { ...type.micro, color: color.text, fontWeight: '600' },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
  },
  dirPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.overlay,
  },
  dirPillOk: {
    borderColor: color.success,
    backgroundColor: 'rgba(10, 28, 18, 0.9)',
  },
  dirText: { ...type.label, color: color.text },
});
