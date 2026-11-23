/**
 * VirtualCameraBagModal.tsx — 확장 렌즈 · 전면 필터(최대 2개) · 필름/촬영 백을 조립하는 '가상 광학 가방' 팝업.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Aperture, Camera, Check, Film, Layers, RotateCcw, Sliders, X } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import {
  createDefaultGearBag,
  hasActiveOpticalGear,
  summarizeGearForCell,
  toggleFrontFilter,
  type CameraGearBagState,
  type FilmBackMode,
  type FrontFilterId,
  type OpticalLensMount,
} from '../../utils/photoAlgorithms/cameraGearBag';
import type { MonochromeOpticalFilter } from '../../utils/photoAlgorithms/opticalFilters';

interface Props {
  visible: boolean;
  language: Language;
  gear: CameraGearBagState;
  onChange: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  hasTimeShiftAnchor?: boolean;
  onClearTimeShiftAnchor?: () => void;
  onClose: () => void;
}

const OptionCard: React.FC<{
  title: string;
  desc: string;
  selected: boolean;
  badge?: string;
  onPress: () => void;
}> = ({ title, desc, selected, badge, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    style={({ pressed }) => [
      styles.card,
      selected && styles.cardOn,
      pressed && styles.cardPressed,
    ]}
  >
    <View style={styles.cardTop}>
      <Text style={[styles.cardTitle, selected && styles.cardTitleOn]} numberOfLines={1}>{title}</Text>
      {badge ? <Text style={styles.cardBadge}>{badge}</Text> : selected ? <Check size={14} color={DARK.accent} /> : null}
    </View>
    <Text style={styles.cardDesc} numberOfLines={2}>{desc}</Text>
  </Pressable>
);

export const VirtualCameraBagModal: React.FC<Props> = ({
  visible,
  language,
  gear,
  onChange,
  hasTimeShiftAnchor = false,
  onClearTimeShiftAnchor,
  onClose,
}) => {
  const activeSummary = summarizeGearForCell(gear, language);
  const anyActive = hasActiveOpticalGear(gear);

  const lensItems: Array<{ id: OpticalLensMount; title: string; desc: string; tag?: string }> = [
    {
      id: 'standard',
      title: L3(language, '표준 렌즈', 'Standard Lens', '標準レンズ'),
      desc: L3(language, '왜곡이나 특수 워핑 없는 기본 광학 화각', 'Default optical geometry without perspective warp', '歪みのない標準光学画角'),
    },
    {
      id: 'scheimpflug',
      title: L3(language, '3D 샤임플러그 틸트-시프트', '3D Scheimpflug Tilt-Shift', '3Dチルトシフト'),
      desc: L3(language, 'DEM 거리 기반 3D 기울어진 초점 평면 보케 + 건물 수직선 교정', '3D tilted focal-plane bokeh using DEM depth + vertical keystone shift', 'DEM距離に基づく3D焦点面ボケ＋垂直シフト補正'),
      tag: '3D DEM · IMU',
    },
    {
      id: 'dolly',
      title: L3(language, '공간 원근 압축 (돌리 줌)', 'Depth Perspective (Dolly)', '空間遠近圧縮ドリー'),
      desc: L3(language, '근경 구도는 유지하고 먼 산 능선과 해·달만 망원처럼 끌어당겨 합성', 'Keep foreground framing while compressing distant ridges and sun/moon', '前景を保ったまま遠景の稜線と太陽・月だけを望遠圧縮'),
      tag: '3D Z-Warp',
    },
    {
      id: 'anamorphic',
      title: L3(language, '2.39:1 아나모픽 시네마', '2.39:1 Anamorphic', '2.39:1 アナモルフィック'),
      desc: L3(language, '2.39:1 와이드 비율 + 능선 차폐 반응 수평 플레어 & 회절 선스타', '2.39:1 cinema crop with occlusion-aware horizontal flare & sunstar', '2.39:1比率＋稜線遮蔽連動フレア＆サンスタ'),
      tag: '2.39:1',
    },
  ];

  const filterItems: Array<{ id: FrontFilterId; title: string; desc: string }> = [
    {
      id: 'gnd',
      title: L3(language, '3D 능선 맞춤 Reverse GND', 'Contour Reverse GND', '稜線フィットGND'),
      desc: L3(language, '산봉우리는 살리고 노을 하늘만 DEM 윤곽선에 1px 밀착 감광', 'Follows 3D ridgeline contour to darken only sky without muting peaks', 'DEM稜線に沿って空だけを減光'),
    },
    {
      id: 'cpl',
      title: L3(language, '90° 물리 레일리 CPL', 'Rayleigh 90° CPL', 'レイリーCPL偏光'),
      desc: L3(language, '태양 각거리 편광도로 광각 얼룩 없이 하늘 색 깊이와 구름 대비 강화', 'Polarizes sky by sun angular distance without ultra-wide banding', '太陽角距離に基づく物理偏光'),
    },
    {
      id: 'nd1000',
      title: L3(language, 'ND1000 구름 장노출', 'ND1000 Cloud Flow', 'ND1000雲流し'),
      desc: L3(language, '지상은 IMU로 고정하고 850/500/300hPa 상층풍 방향으로 구름 결 적분', 'Locks terrain via IMU and flows clouds along real upper-air wind vectors', '地上固定＋上層風ベクトル方向へ雲を積分'),
    },
    {
      id: 'dehaze',
      title: L3(language, '거리별 연무 제어 (Dehaze·산수화)', 'Koschmieder Dehaze / Haze', '距離別霞・山水画'),
      desc: L3(language, 'DEM 거리 기반 대기 투과율 역산(연무 제거↔첩첩산중 원근 강조)', 'Inverts physical haze by DEM distance or adds layered mountain ink haze', 'DEM距離別の透過率逆算（除去／山水画強調）'),
    },
    {
      id: 'astroClear',
      title: L3(language, '도심 광해 노치 (Neodymium)', 'Astro-Clear Light Notch', '光害カット'),
      desc: L3(language, '저고도 대기질량에 비례한 황색 나트륨등 광해 성분만 선택 감산', 'Subtracts low-altitude yellow sodium glow weighted by air mass', '低高度ナトリウム光害を選択除去'),
    },
    {
      id: 'proMist',
      title: 'Black Pro-Mist',
      desc: L3(language, '대기 탁도(AOD)와 태양 휘도에 비례하는 영화적 하이라이트 할레이션', 'Cinematic highlight halation scaled by solar brightness & AOD', '太陽輝度・AOD連動のハレーション'),
    },
    {
      id: 'ghostClean',
      title: L3(language, '역광 고스트 클린', 'Anti-Ghost Optics', 'ゴースト抑制'),
      desc: L3(language, '광축 점대칭 위치의 렌즈 내부 반사 고스트·색 편향 억제', 'Suppresses optical-axis symmetric internal lens ghosting', '光軸点対称のゴーストを抑制'),
    },
  ];

  const filmItems: Array<{ id: FilmBackMode; title: string; desc: string; tag?: string }> = [
    {
      id: 'natural',
      title: L3(language, '표준 디지털 센서', 'Standard Digital', '標準デジタル'),
      desc: L3(language, '기본 카메라 톤·화이트밸런스 유지', 'Native camera exposure & tone curve', '標準トーン・WBを維持'),
    },
    {
      id: 'sunsetWb',
      title: L3(language, '노을 색감 락 (Chromaticity Lock)', 'Sunset Spectral Lock', '夕焼け色ロック'),
      desc: L3(language, '태양 고도·AOD 물리 색도로 AWB 회색화 역보정 + 하이라이트 롤오프', 'Reverses AWB gray-out back to physical sunset chromaticity & roll-off', 'AWBの灰化を物理散乱色度で逆補正'),
      tag: 'AWB Lock',
    },
    {
      id: 'monoZone',
      title: L3(language, '안셀 아담스 Zone 모노크롬', 'Ansel Adams Zone Mono', 'アンセルZone白黒'),
      desc: L3(language, 'Red 25A 등 대기 산란 흑백 광학 필터 + Zone 0~X 분포 측정', 'Optical Red/Orange sky-darkening B&W filters + Zone 0–X meter', '分光白黒フィルター＋Zone 0〜X'),
      tag: 'Zone 0-X',
    },
    {
      id: 'astroDual',
      title: L3(language, '지형·별 분리 야간 스태킹', 'Dual-Layer Astro Stack', '地形・星分離スタック'),
      desc: L3(language, '능선 고정 + 하늘 지구 자전 역투영(촬영 시 천체 네이티브 스택 실행)', 'Locks DEM ridgeline while de-rotating star field via AstroCamera', '稜線固定＋地球自転逆投影スタック'),
      tag: 'Native Stack',
    },
    {
      id: 'luckyTele',
      title: L3(language, '해·달 럭키 이미징 (Drizzle)', 'Lucky Tele + Drizzle', 'ラッキー望遠Drizzle'),
      desc: L3(language, '고속 연사 중 아지랑이 멎은 상위 35% 선별 후 2× 서브픽셀 초해상 합성', 'Picks sharpest 35% burst frames & composites 2× subpixel drizzle', '上位35%選別＋2倍超解像合成'),
      tag: '2× Drizzle',
    },
    {
      id: 'timeShift',
      title: L3(language, '블루아워+야간 시간차 정합', 'Blue-Hour + Night Hybrid', '時差ハイブリッド'),
      desc: L3(language, '블루아워 앵커 능선 저장 → 야간 재정렬 NCC 96%+ 자동 셔터 합성', 'Saves blue-hour ridgeline anchor; auto-triggers & blends night sky at 96% match', '96%稜線一致で自動シャッター合成'),
      tag: hasTimeShiftAnchor ? L3(language, '앵커 대기', 'Anchor Set', 'アンカー有') : '2-Step',
    },
  ];

  const monoChoices: Array<{ id: MonochromeOpticalFilter; label: string }> = [
    { id: 'red25A', label: 'Red 25A' },
    { id: 'orange21', label: 'Orange 21' },
    { id: 'yellow8', label: 'Yellow 8' },
    { id: 'deepSky', label: 'Deep IR' },
    { id: 'neutral', label: 'Neutral' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Aperture size={18} color={DARK.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {L3(language, '가상 광학 가방 · 렌즈 & 필터', 'Virtual Camera Bag · Optics', '仮想カメラバッグ · 光学')}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {anyActive
                  ? activeSummary
                  : L3(language, '장착된 확장 광학 없음 (표준 촬영)', 'No optical mounts/filters attached', '追加光学なし（標準撮影）')}
              </Text>
            </View>
            {anyActive && (
              <Pressable
                onPress={() => onChange(createDefaultGearBag())}
                style={styles.resetBtn}
                accessibilityRole="button"
                accessibilityLabel={L3(language, '장비 초기화', 'Reset optical gear', '光学設定をリセット')}
              >
                <RotateCcw size={13} color={DARK.textDim} />
                <Text style={styles.resetText}>{L3(language, '초기화', 'Reset', 'リセット')}</Text>
              </Pressable>
            )}
            <OverlayButton onPress={onClose} accessibilityLabel={L3(language, '닫기', 'Close', '閉じる')} style={styles.closeBtn}>
              <X size={16} color={DARK.text} />
            </OverlayButton>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* 1. 확장 렌즈 마운트 */}
            <View style={styles.secHead}>
              <Camera size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>{L3(language, '1. 확장 렌즈 마운트 (1개 선택)', '1. OPTICAL LENS MOUNT (PICK 1)', '1. レンズマウント (1つ)')}</Text>
            </View>
            <View style={styles.grid}>
              {lensItems.map(item => (
                <OptionCard
                  key={item.id}
                  title={item.title}
                  desc={item.desc}
                  badge={item.tag}
                  selected={gear.lensMount === item.id}
                  onPress={() => onChange(s => ({ ...s, lensMount: item.id }))}
                />
              ))}
            </View>

            {/* 선택된 렌즈 세부 설정 */}
            {gear.lensMount === 'scheimpflug' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '틸트-시프트 3D 초점 평면', 'Scheimpflug Plane Settings', 'チルトシフト詳細')}</Text>
                <View style={styles.chipRow}>
                  {[300, 800, 1200, 2500, 5000].map(dist => (
                    <GlassChip
                      key={dist}
                      label={dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${dist}m`}
                      mono
                      active={gear.focusDistM === dist}
                      onPress={() => onChange(s => ({ ...s, focusDistM: dist }))}
                    />
                  ))}
                </View>
                <View style={styles.chipRow}>
                  {[-12, 0, 8, 16].map(tp => (
                    <GlassChip
                      key={tp}
                      label={`${L3(language, '틸트', 'Tilt', '傾')} ${tp > 0 ? '+' : ''}${tp}°`}
                      mono
                      active={gear.tiltPitchDeg === tp}
                      onPress={() => onChange(s => ({ ...s, tiltPitchDeg: tp }))}
                    />
                  ))}
                  {([1.4, 2.0, 2.8, 4.0] as const).map(f => (
                    <GlassChip
                      key={f}
                      label={`f/${f}`}
                      mono
                      active={gear.apertureF === f}
                      onPress={() => onChange(s => ({ ...s, apertureF: f }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.lensMount === 'dolly' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '원경 압축 배율 (산 능선·천체)', 'Background Compression Factor', '遠景圧縮倍率')}</Text>
                <View style={styles.chipRow}>
                  {[1.25, 1.55, 1.85, 2.2].map(z => (
                    <GlassChip
                      key={z}
                      label={`${z.toFixed(2)}×`}
                      mono
                      active={Math.abs(gear.dollyFarZoom - z) < 0.05}
                      onPress={() => onChange(s => ({ ...s, dollyFarZoom: z }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.lensMount === 'anamorphic' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '조리개 날 (선스타 갈래)', 'Aperture Blades (Sunstar)', '絞り羽根（光条）')}</Text>
                <View style={styles.chipRow}>
                  {([6, 8, 10] as const).map(b => (
                    <GlassChip
                      key={b}
                      label={`${b}${L3(language, '갈래', '-ray', '本')}`}
                      mono
                      active={gear.sunstarBlades === b}
                      onPress={() => onChange(s => ({ ...s, sunstarBlades: b }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* 2. 전면 필터 슬롯 (최대 2개) */}
            <View style={[styles.secHead, { marginTop: 14 }]}>
              <Layers size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>
                {L3(
                  language,
                  `2. 전면 필터 슬롯 (${gear.frontFilters.length}/2 장착)`,
                  `2. FRONT FILTERS (${gear.frontFilters.length}/2 MOUNTED)`,
                  `2. 前面フィルター (${gear.frontFilters.length}/2 装着)`,
                )}
              </Text>
            </View>
            <View style={styles.grid}>
              {filterItems.map(item => (
                <OptionCard
                  key={item.id}
                  title={item.title}
                  desc={item.desc}
                  selected={gear.frontFilters.includes(item.id)}
                  onPress={() => onChange(s => toggleFrontFilter(s, item.id))}
                />
              ))}
            </View>

            {/* 장착된 전면 필터 세부 옵션 */}
            {gear.frontFilters.includes('gnd') && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '능선 GND 설정', 'Contour GND Options', '稜線GND設定')}</Text>
                <View style={styles.chipRow}>
                  <GlassChip
                    label={L3(language, '리버스 (노을용)', 'Reverse (Sunset)', 'リバース')}
                    active={gear.gndMode === 'reverse'}
                    onPress={() => onChange(s => ({ ...s, gndMode: 'reverse' }))}
                  />
                  <GlassChip
                    label={L3(language, '표준 (주간용)', 'Standard', '標準GND')}
                    active={gear.gndMode === 'standard'}
                    onPress={() => onChange(s => ({ ...s, gndMode: 'standard' }))}
                  />
                  {[1.0, 1.8, 2.5, 3.0].map(ev => (
                    <GlassChip
                      key={ev}
                      label={`-${ev.toFixed(1)}EV`}
                      mono
                      active={Math.abs(gear.gndStops - ev) < 0.15}
                      onPress={() => onChange(s => ({ ...s, gndStops: ev }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.frontFilters.includes('nd1000') && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, 'ND1000 가상 장노출 시간', 'Simulated Cloud Flow Duration', '仮想露光時間')}</Text>
                <View style={styles.chipRow}>
                  {[6, 12, 20, 30].map(sec => (
                    <GlassChip
                      key={sec}
                      label={`${sec}s`}
                      mono
                      active={gear.ndDurationSec === sec}
                      onPress={() => onChange(s => ({ ...s, ndDurationSec: sec }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.frontFilters.includes('dehaze') && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '대기 연무 방향 (- 산수화 ↔ + 안개 제거)', 'Haze Control (- Ink Wash ↔ + Dehaze)', '霞制御（山水 ↔ 除去）')}</Text>
                <View style={styles.chipRow}>
                  {[
                    { v: -0.75, label: L3(language, '진한 산수화', 'Deep Ink', '濃山水') },
                    { v: -0.35, label: L3(language, '은은한 안개', 'Soft Mist', '薄霞') },
                    { v: 0.55, label: L3(language, '선명 Dehaze', 'Dehaze', '霞除去') },
                    { v: 0.9, label: L3(language, '강한 Dehaze', 'Clear+', '強除去') },
                  ].map(p => (
                    <GlassChip
                      key={p.v}
                      label={p.label}
                      active={Math.abs(gear.dehazeStrength - p.v) < 0.12}
                      onPress={() => onChange(s => ({ ...s, dehazeStrength: p.v }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.frontFilters.includes('proMist') && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>Black Pro-Mist 강도</Text>
                <View style={styles.chipRow}>
                  {([0.125, 0.25, 0.5, 1] as const).map(gr => (
                    <GlassChip
                      key={gr}
                      label={gr === 1 ? '1' : `1/${Math.round(1 / gr)}`}
                      mono
                      active={gear.proMistGrade === gr}
                      onPress={() => onChange(s => ({ ...s, proMistGrade: gr }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* 3. 필름 / 촬영 백 */}
            <View style={[styles.secHead, { marginTop: 14 }]}>
              <Film size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>{L3(language, '3. 필름 / 센서 촬영 모드 (1개 선택)', '3. FILM & CAPTURE BACK (PICK 1)', '3. フィルム・撮影モード (1つ)')}</Text>
            </View>
            <View style={styles.grid}>
              {filmItems.map(item => (
                <OptionCard
                  key={item.id}
                  title={item.title}
                  desc={item.desc}
                  badge={item.tag}
                  selected={gear.filmBack === item.id}
                  onPress={() => onChange(s => ({ ...s, filmBack: item.id }))}
                />
              ))}
            </View>

            {gear.filmBack === 'sunsetWb' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '노을 색감 보정 & 3단 노출', 'Sunset Chromaticity & Bracket', '夕焼け色補正・ブラケット')}</Text>
                <View style={styles.chipRow}>
                  <GlassChip
                    label={L3(language, '1장 고속 촬영', 'Single Shot', '1枚撮影')}
                    active={!gear.sunsetBracket3Shot}
                    onPress={() => onChange(s => ({ ...s, sunsetBracket3Shot: false }))}
                  />
                  <GlassChip
                    label={L3(language, '3단 EV 브라켓 합성', '3-Shot EV Bracket', '3段EVブラケット')}
                    active={gear.sunsetBracket3Shot}
                    onPress={() => onChange(s => ({ ...s, sunsetBracket3Shot: true }))}
                  />
                </View>
              </View>
            )}

            {gear.filmBack === 'monoZone' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '흑백 광학 필터 색판', 'B&W Optical Spectral Filter', 'モノクロ光学フィルター')}</Text>
                <View style={styles.chipRow}>
                  {monoChoices.map(mc => (
                    <GlassChip
                      key={mc.id}
                      label={mc.label}
                      mono
                      active={gear.monoFilter === mc.id}
                      onPress={() => onChange(s => ({ ...s, monoFilter: mc.id }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.filmBack === 'luckyTele' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '럭키 이미징 연사 장수 (상위 35% 합성)', 'Lucky Burst Frames (Top 35% Drizzle)', 'ラッキー連写枚数')}</Text>
                <View style={styles.chipRow}>
                  {[6, 8, 12, 16].map(n => (
                    <GlassChip
                      key={n}
                      label={`${n}${L3(language, '장', ' shots', '枚')}`}
                      mono
                      active={gear.luckyBurstCount === n}
                      onPress={() => onChange(s => ({ ...s, luckyBurstCount: n }))}
                    />
                  ))}
                </View>
              </View>
            )}

            {gear.filmBack === 'timeShift' && hasTimeShiftAnchor && (
              <View style={styles.detailBox}>
                <View style={styles.anchorRow}>
                  <Text style={styles.detailTitle}>
                    {L3(language, '블루아워 앵커가 저장됨 — 야간 능선 96% 정렬 시 자동 촬영', 'Blue-hour anchor saved — auto-triggers at 96% match', 'ブルーアワーアンカー保存済み（96%一致で自動撮影）')}
                  </Text>
                  {onClearTimeShiftAnchor && (
                    <GlassChip
                      label={L3(language, '앵커 지우기', 'Clear', '消去')}
                      onPress={onClearTimeShiftAnchor}
                    />
                  )}
                </View>
              </View>
            )}

            {/* 4. 구도 & 뷰파인더 보조 */}
            <View style={[styles.secHead, { marginTop: 14 }]}>
              <Sliders size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>{L3(language, '4. 구도 · 뷰파인더 보조 HUD', '4. GEOMETRY & VIEWFINDER ASSISTS', '4. 構図・HUD補助')}</Text>
            </View>
            <View style={styles.chipRow}>
              <GlassChip
                label={L3(language, '건물 수직선 시프트 교정', 'Vertical Shift (PC-E)', '垂直シフト補正')}
                active={gear.verticalShift || gear.lensMount === 'scheimpflug'}
                onPress={() => onChange(s => ({ ...s, verticalShift: !s.verticalShift }))}
              />
              <GlassChip
                label={L3(language, '봉우리 · 능선 거리 라벨', 'Ridge Distance Labels', '稜線距離ラベル')}
                active={gear.showPeakLabels}
                onPress={() => onChange(s => ({ ...s, showPeakLabels: !s.showPeakLabels }))}
              />
              <GlassChip
                label={L3(language, '관측고도 Dip 수평선', 'Dip Horizon Level', '視線Dip水平線')}
                active={gear.showDipHorizon}
                onPress={() => onChange(s => ({ ...s, showDipHorizon: !s.showDipHorizon }))}
              />
              <GlassChip
                label={L3(language, '구름 노출 권장 시간', 'Cloud Flow Hint', '雲露光推奨時間')}
                active={gear.showCloudDurationHint}
                onPress={() => onChange(s => ({ ...s, showCloudDurationHint: !s.showCloudDurationHint }))}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: DARK.scrim },
  sheet: {
    maxHeight: '85%',
    backgroundColor: DARK.panel,
    borderColor: DARK.border,
    borderWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: DARK.borderStrong,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: DARK.border,
  },
  title: { fontSize: 15, fontWeight: '800', color: DARK.text },
  subtitle: { fontFamily: mono, fontSize: 11, color: DARK.accent, marginTop: 1 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: DARK.border,
  },
  resetText: { fontSize: 11, color: DARK.textDim, fontWeight: '600' },
  closeBtn: { width: 32, height: 32 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 28, gap: 8 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  secLabel: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: DARK.textDim,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    width: '48.7%',
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: DARK.border,
    backgroundColor: DARK.panelRaised,
    gap: 4,
  },
  cardOn: {
    borderColor: DARK.accent,
    backgroundColor: DARK.accentSoft,
  },
  cardPressed: { opacity: 0.8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  cardTitle: { flex: 1, fontSize: 12, fontWeight: '700', color: DARK.text },
  cardTitleOn: { color: DARK.accent },
  cardBadge: {
    fontFamily: mono,
    fontSize: 9,
    color: DARK.sun,
    fontWeight: '700',
  },
  cardDesc: { fontSize: 10.5, lineHeight: 14, color: DARK.textDim },
  detailBox: {
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: DARK.borderStrong,
    backgroundColor: DARK.overlay,
    gap: 6,
  },
  detailTitle: { fontFamily: mono, fontSize: 10.5, color: DARK.textDim, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  anchorRow: { gap: 6 },
});
