/**
 * ObjectInfoPanel.tsx — 샌드박스에서 고른 대상의 정보 (docs/SANDBOX_MODE_PLAN.md 2.2 "객체 정보").
 * 하늘 위에 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다. 숫자 8 칸을 빽빽하게(전문가용).
 *
 * 칸: 거리 · 방위 · 앙각 · 해발 / 눈 대비 높이 · 달과의 각 · 해와의 각 · 시야.
 * 앙각은 곡률(굴절 포함)을 반영한 "눈에 보이는 높이"입니다. 해·달과의 각은 지금 시각의 기하학적 위치 기준입니다.
 * 건물을 골랐으면 한 줄이 더 붙습니다: 높이(지도 자료) · 꼭대기 해발 · 발자국 · 대상 점(꼭대기 / 누른 곳 전환).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { angularSeparationDeg, type PickedTarget } from '../../utils/demPick';
import type { AlignHit } from '../../utils/alignSearch';
import { AlignFinder } from './AlignFinder';

interface Props {
  language: 'ko' | 'en' | 'ja';
  target: PickedTarget;
  sun: { azDeg: number; altDeg: number };
  moon: { azDeg: number; altDeg: number };
  /** 서 있는 자리와 지금 시뮬레이션 시각 — 있으면 "해·달 걸기" 찾기가 붙습니다. */
  observer?: { latitude: number; longitude: number; fromMs: number };
  onAlign?: (hit: AlignHit) => void;
  /** 눈에서 본 땅 스카이라인(방위 → 앙각). 해·달이 능선 뒤에 가리는지 알리는 데 씁니다. */
  getSkyline?: () => ((azDeg: number) => number | null) | null;
  /** 건물 대상의 점을 꼭대기(true)나 누른 곳(false)으로 바꿉니다. */
  onSnap?: (snapTop: boolean) => void;
  onClear: () => void;
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${Math.round(m)} m`);
const fmtDeg = (d: number, digits = 1) => `${d.toFixed(digits)}°`;
const fmtSigned = (m: number) => `${m >= 0 ? '+' : '−'}${Math.abs(Math.round(m))} m`;

export const ObjectInfoPanel: React.FC<Props> = ({ language, target, sun, moon, observer, onAlign, getSkyline, onSnap, onClear }) => {
  const sunSep = angularSeparationDeg(target.azDeg, target.elDeg, sun.azDeg, sun.altDeg);
  const moonSep = angularSeparationDeg(target.azDeg, target.elDeg, moon.azDeg, moon.altDeg);
  const cells: Array<{ label: string; value: string; tone?: 'good' | 'bad' | 'sun' | 'moon' }> = [
    { label: L3(language, '거리', 'Distance', '距離'), value: fmtDist(target.distM) },
    { label: L3(language, '방위', 'Azimuth', '方位'), value: fmtDeg(target.azDeg) },
    { label: L3(language, '앙각', 'Elevation', '仰角'), value: fmtDeg(target.elDeg, 2) },
    { label: L3(language, '해발', 'Height ASL', '標高'), value: `${Math.round(target.elevM)} m` },
    { label: L3(language, '눈 대비', 'vs eye', '目との差'), value: fmtSigned(target.elevM - target.eyeElevM) },
    { label: L3(language, '달까지', 'To moon', '月まで'), value: moon.altDeg > -1 ? fmtDeg(moonSep) : '—', tone: 'moon' },
    { label: L3(language, '해까지', 'To sun', '太陽まで'), value: sun.altDeg > -1 ? fmtDeg(sunSep) : '—', tone: 'sun' },
    {
      label: L3(language, '시야', 'Sight', '視界'),
      value: target.visible ? L3(language, '트임', 'Clear', '開') : `${L3(language, '가려짐', 'Hidden', '遮られ')} ${Math.round(-target.marginM)} m`,
      tone: target.visible ? 'good' : 'bad',
    },
  ];
  const b = target.kind === 'building' ? target.building : undefined;
  const buildingCells: Array<{ label: string; value: string }> = b ? [
    { label: L3(language, '높이(지도)', 'Height (map)', '高さ(地図)'), value: `${Math.round(b.heightM)} m` },
    { label: L3(language, '꼭대기 해발', 'Top ASL', '頂上標高'), value: `${Math.round(b.topElevM)} m` },
    { label: L3(language, '발자국', 'Footprint', '底面'), value: `${Math.round(b.longM)}×${Math.round(b.shortM)} m` },
  ] : [];
  const toneColor = (t?: string) => (t === 'good' ? DARK.success : t === 'bad' ? DARK.danger : t === 'sun' ? DARK.sun : t === 'moon' ? DARK.moon : DARK.text);
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={1}>
          {b ? L3(language, '건물', 'Building', '建物') : L3(language, '지형 지점', 'Terrain point', '地形の点')}
          {target.latitude != null && target.longitude != null ? `  ${target.latitude.toFixed(4)}, ${target.longitude.toFixed(4)}` : ''}
        </Text>
        <OverlayButton onPress={onClear} accessibilityLabel={L3(language, '고른 대상 지우기', 'Clear target', '選択を消す')} style={styles.close}>
          <X size={14} color={DARK.text} />
        </OverlayButton>
      </View>
      <View style={styles.grid}>
        {cells.map(c => (
          <View key={c.label} style={styles.cell}>
            <Text style={styles.cellLabel}>{c.label}</Text>
            <Text style={[styles.cellValue, { color: toneColor(c.tone) }]} numberOfLines={1}>{c.value}</Text>
          </View>
        ))}
        {buildingCells.map(c => (
          <View key={c.label} style={styles.cell}>
            <Text style={styles.cellLabel}>{c.label}</Text>
            <Text style={[styles.cellValue, { color: DARK.text }]} numberOfLines={1}>{c.value}</Text>
          </View>
        ))}
      </View>
      {b && (
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>{L3(language, '대상 점', 'Target point', '対象点')}</Text>
          {([true, false] as const).map(top => (
            <OverlayButton
              key={String(top)}
              active={b.snapped === top}
              onPress={() => onSnap?.(top)}
              accessibilityLabel={top ? L3(language, '꼭대기를 대상으로', 'Target the top', '頂上を対象に') : L3(language, '누른 곳을 대상으로', 'Target the tapped spot', 'タップ位置を対象に')}
              style={styles.snapBtn}
            >
              <Text style={[styles.snapText, b.snapped === top && { color: DARK.accent }]}>
                {top ? L3(language, '꼭대기', 'Top', '頂上') : L3(language, '누른 곳', 'Tapped spot', 'タップ位置')}
              </Text>
            </OverlayButton>
          ))}
        </View>
      )}
      {observer && onAlign && (
        <AlignFinder
          language={language}
          latitude={observer.latitude}
          longitude={observer.longitude}
          eyeElevM={target.eyeElevM}
          azDeg={target.azDeg}
          elDeg={target.elDeg}
          fromMs={observer.fromMs}
          onPick={onAlign}
          getSkyline={getSkyline}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: DARK.overlay,
    borderColor: DARK.border,
    borderWidth: 1,
    borderRadius: radius.xs,
    padding: 8,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0, fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  close: { width: 28, height: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: '24%', flexGrow: 1, backgroundColor: DARK.fill, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 5 },
  cellLabel: { fontFamily: mono, fontSize: 9, color: DARK.textMute },
  cellValue: { fontFamily: mono, fontSize: 13, fontWeight: '700' },
  snapRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  snapLabel: { fontFamily: mono, fontSize: 9, color: DARK.textMute },
  snapBtn: { width: 'auto', minWidth: 60, height: 28, paddingHorizontal: 8 },
  snapText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
});
