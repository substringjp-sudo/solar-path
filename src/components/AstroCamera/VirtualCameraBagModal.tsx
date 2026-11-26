/**
 * VirtualCameraBagModal.tsx — 확장 렌즈 · 전면 필터(최대 2개) · 필름/촬영 백을 조립하는 '가상 광학 가방' 팝업.
 *
 * 구구절절한 텍스트 설명 대신 실제 렌즈 경통, 원형 유리 그라데이션 필터, 센서/필름 백 제품 그래픽을 중심으로
 * 한눈에 보고 장착할 수 있도록 쇼케이스 타일 형태로 구성합니다.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Aperture, Camera, Check, Film, Layers, RotateCcw, Sliders, X } from 'lucide-react-native';
import { GlassChip } from '../glass/GlassChip';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3, type Language } from '../../utils/i18n';
import { useCelestialStore } from '../../store/useCelestialStore';
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
import {
  CircularFilterArtwork,
  FilmBackArtwork,
  LensMountArtwork,
  MonoFilterDiscSvg,
} from './OpticalGearArtwork';

interface Props {
  visible: boolean;
  language: Language;
  gear: CameraGearBagState;
  onChange: React.Dispatch<React.SetStateAction<CameraGearBagState>>;
  hasTimeShiftAnchor?: boolean;
  onClearTimeShiftAnchor?: () => void;
  onClose: () => void;
}

const ProductTile: React.FC<{
  artwork: React.ReactNode;
  title: string;
  spec: string;
  selected: boolean;
  slotBadge?: string;
  onPress: () => void;
}> = ({ artwork, title, spec, selected, slotBadge, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    style={({ pressed }) => [
      styles.tile,
      selected && styles.tileOn,
      pressed && styles.tilePressed,
    ]}
  >
    {slotBadge ? (
      <View style={[styles.badgePill, selected && styles.badgePillOn]}>
        <Text style={[styles.badgePillText, selected && styles.badgePillTextOn]}>{slotBadge}</Text>
      </View>
    ) : selected ? (
      <View style={styles.checkCorner}>
        <Check size={12} color="#03111B" strokeWidth={3} />
      </View>
    ) : null}

    <View style={styles.artWrap}>{artwork}</View>
    <Text style={[styles.tileTitle, selected && styles.tileTitleOn]} numberOfLines={1}>
      {title}
    </Text>
    <Text style={[styles.tileSpec, selected && styles.tileSpecOn]} numberOfLines={1}>
      {spec}
    </Text>
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
  const graphicsQuality = useCelestialStore(s => s.graphicsQuality);
  const isLowSpec = graphicsQuality === 'low';
  const effectiveGear = isLowSpec ? { ...gear, lensMount: 'standard' as const, verticalShift: false } : gear;
  const activeSummary = summarizeGearForCell(effectiveGear, language);
  const anyActive = hasActiveOpticalGear(effectiveGear);

  const lensItems: Array<{ id: OpticalLensMount; title: string; spec: string }> = [
    {
      id: 'standard',
      title: L3(language, '표준 광학', 'Standard', '標準レンズ'),
      spec: L3(language, '무왜곡 기본 화각', '1:1 Native', '標準光学'),
    },
    {
      id: 'scheimpflug',
      title: L3(language, '틸트-시프트', 'Tilt-Shift', 'チルトシフト'),
      spec: L3(language, '3D 초점면 · 수직교정', '3D Plane · PC-E', '3D焦点面・シフト'),
    },
    {
      id: 'dolly',
      title: L3(language, '공간 원근 압축', 'Dolly Compress', '遠近圧縮ドリー'),
      spec: L3(language, '원경 능선·해·달 확대', 'Far Ridge Zoom', '遠景・天体拡大'),
    },
    {
      id: 'anamorphic',
      title: L3(language, '아나모픽 시네마', 'Anamorphic', 'アナモルフィック'),
      spec: L3(language, '2.39:1 · 수평 플레어', '2.39:1 · Flare', '2.39:1・フレア'),
    },
  ];

  const filterItems: Array<{ id: FrontFilterId; title: string; spec: string }> = [
    {
      id: 'gnd',
      title: L3(language, '능선 Reverse GND', 'Contour GND', '稜線GND'),
      spec: L3(language, '3D 산봉우리 밀착 감광', '3D Ridge Mask', '3D稜線減光'),
    },
    {
      id: 'cpl',
      title: L3(language, '90° 레일리 CPL', 'Rayleigh CPL', 'レイリーCPL'),
      spec: L3(language, '하늘 채도·구름 입체감', '90° Sky Polarizer', '空彩度・雲立体感'),
    },
    {
      id: 'nd1000',
      title: L3(language, 'ND1000 장노출', 'ND1000 Flow', 'ND1000雲流し'),
      spec: L3(language, '상층풍 방향 구름 결', '10-Stop Wind Flow', '10段減光・雲流'),
    },
    {
      id: 'dehaze',
      title: L3(language, '연무 · 산수화', 'Dehaze / Ink', '霞除去・山水'),
      spec: L3(language, '거리별 투과율 제어', '3D Depth Haze', '距離別透過率'),
    },
    {
      id: 'astroClear',
      title: L3(language, '광해 노치 컷', 'Astro-Clear', '光害カット'),
      spec: L3(language, '589nm 나트륨 황색 차단', 'Neodymium Notch', 'ナトリウム光除去'),
    },
    {
      id: 'proMist',
      title: 'Black Pro-Mist',
      spec: L3(language, '시네마 광원 할레이션', 'Highlight Glow', 'ハイライト拡散'),
    },
    {
      id: 'ghostClean',
      title: L3(language, '역광 고스트 클린', 'Anti-Ghost', 'ゴースト抑制'),
      spec: L3(language, '나노 코팅 반사 억제', 'Nano AR Coat', '反射ゴースト除去'),
    },
  ];

  const filmItems: Array<{ id: FilmBackMode; title: string; spec: string }> = [
    {
      id: 'natural',
      title: L3(language, '표준 센서', 'Standard CMOS', '標準センサー'),
      spec: L3(language, '네이티브 컬러·톤', 'Native Tone', '標準トーン'),
    },
    {
      id: 'sunsetWb',
      title: L3(language, '노을 색감 락', 'Sunset Lock', '夕焼け色ロック'),
      spec: L3(language, 'AWB 회색화 방지', '2800K Spectral', '物理散乱色固定'),
    },
    {
      id: 'monoZone',
      title: L3(language, 'Zone 모노크롬', 'Zone B&W', 'Zone白黒'),
      spec: L3(language, '안셀 아담스 Zone 0–X', 'Red 25A · IR', '分光白黒・0〜X'),
    },
    {
      id: 'astroDual',
      title: L3(language, '지형+별 분리 스택', 'Astro Dual Stack', '地形+星スタック'),
      spec: L3(language, '능선 고정·별 자전 추적', 'IMU + Star Track', '稜線固定・星追尾'),
    },
    {
      id: 'luckyTele',
      title: L3(language, '해·달 럭키 줌', 'Lucky 2× Drizzle', 'ラッキー超解像'),
      spec: L3(language, '아지랑이 제거 초해상', 'Top 35% Burst', '揺らぎ除去2×合成'),
    },
    {
      id: 'timeShift',
      title: L3(language, '시간차 능선 정합', 'Blue+Night Sync', '時差稜線合成'),
      spec: hasTimeShiftAnchor
        ? L3(language, '● 앵커 대기 (96% 셔터)', '● Anchor Ready', '● アンカー待機')
        : L3(language, '블루아워 지형+밤하늘', '2-Step Hybrid', '夕景地形＋星空'),
    },
  ];

  const monoChoices: Array<{ id: MonochromeOpticalFilter; label: string; sub: string }> = [
    { id: 'red25A', label: 'Red 25A', sub: L3(language, '칠흑 하늘·강한 대비', 'Deep Sky', '濃黒空') },
    { id: 'orange21', label: 'Orange 21', sub: L3(language, '구름 입체 강조', 'Cloud Pop', '雲強調') },
    { id: 'yellow8', label: 'Yellow 8', sub: L3(language, '자연 계조', 'Balanced', '自然階調') },
    { id: 'deepSky', label: 'IR 720nm', sub: L3(language, '적외선 흑백', 'Infrared', '赤外線調') },
    { id: 'neutral', label: 'Neutral', sub: L3(language, '무필터', 'Pure', '標準') },
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
            {/* 1. 확장 렌즈 마운트 (고화질 모드 전용 — 저화질 모드에서는 표준 광학으로 고정) */}
            {!isLowSpec && (
            <>
            <View style={styles.secHead}>
              <Camera size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>
                {L3(language, '1. 렌즈 마운트 (1개 장착)', '1. OPTICAL LENS MOUNT (PICK 1)', '1. レンズマウント (1つ装着)')}
              </Text>
            </View>
            <View style={styles.lensGrid}>
              {lensItems.map(item => {
                const selected = gear.lensMount === item.id;
                return (
                  <ProductTile
                    key={item.id}
                    selected={selected}
                    title={item.title}
                    spec={item.spec}
                    artwork={<LensMountArtwork id={item.id} size={66} selected={selected} />}
                    onPress={() => onChange(s => ({ ...s, lensMount: item.id }))}
                  />
                );
              })}
            </View>

            {/* 선택된 렌즈 세부 설정 */}
            {gear.lensMount === 'scheimpflug' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '틸트-시프트 3D 초점 거리 · 각도 · 조리개', 'Scheimpflug Plane Settings', 'チルトシフト詳細')}</Text>
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
            </>
            )}

            {/* 2. 전면 원형 필터 슬롯 (최대 2개 — 원 안에 실제 유리 그라데이션·색상 표현) */}
            <View style={[styles.secHead, { marginTop: 14 }]}>
              <Layers size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>
                {L3(
                  language,
                  `2. 원형 광학 필터 (${gear.frontFilters.length}/2개 장착)`,
                  `2. CIRCULAR OPTICAL FILTERS (${gear.frontFilters.length}/2 MOUNTED)`,
                  `2. 円形光学フィルター (${gear.frontFilters.length}/2 装着)`,
                )}
              </Text>
            </View>
            <View style={styles.filterGrid}>
              {filterItems.map(item => {
                const slotIdx = gear.frontFilters.indexOf(item.id);
                const selected = slotIdx !== -1;
                return (
                  <ProductTile
                    key={item.id}
                    selected={selected}
                    title={item.title}
                    spec={item.spec}
                    slotBadge={selected ? `SLOT ${slotIdx + 1}` : undefined}
                    artwork={<CircularFilterArtwork id={item.id} size={66} selected={selected} />}
                    onPress={() => onChange(s => toggleFrontFilter(s, item.id))}
                  />
                );
              })}
            </View>

            {/* 장착된 전면 필터 세부 옵션 */}
            {gear.frontFilters.includes('gnd') && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '능선 GND 감광 농도', 'Contour GND Density', '稜線GND減光量')}</Text>
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
                <Text style={styles.detailTitle}>Black Pro-Mist Diffusion Grade</Text>
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

            {/* 3. 필름 / 센서 촬영 백 */}
            <View style={[styles.secHead, { marginTop: 14 }]}>
              <Film size={13} color={DARK.textDim} />
              <Text style={styles.secLabel}>{L3(language, '3. 필름 · 센서 백 (1개 장착)', '3. FILM & SENSOR BACK (PICK 1)', '3. フィルム・センサーバック (1つ)')}</Text>
            </View>
            <View style={styles.filterGrid}>
              {filmItems.map(item => {
                const selected = gear.filmBack === item.id;
                return (
                  <ProductTile
                    key={item.id}
                    selected={selected}
                    title={item.title}
                    spec={item.spec}
                    artwork={<FilmBackArtwork id={item.id} size={66} selected={selected} />}
                    onPress={() => onChange(s => ({ ...s, filmBack: item.id }))}
                  />
                );
              })}
            </View>

            {gear.filmBack === 'sunsetWb' && (
              <View style={styles.detailBox}>
                <Text style={styles.detailTitle}>{L3(language, '노을 색감 보정 & 3단 노출 브라켓', 'Sunset Chromaticity & Bracket', '夕焼け色補正・ブラケット')}</Text>
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
                <Text style={styles.detailTitle}>{L3(language, '흑백 광학 컬러 필터 디스크', 'B&W Optical Color Filter Disc', 'モノクロ光学カラーフィルター')}</Text>
                <View style={styles.monoDiscRow}>
                  {monoChoices.map(mc => {
                    const active = gear.monoFilter === mc.id;
                    return (
                      <Pressable
                        key={mc.id}
                        onPress={() => onChange(s => ({ ...s, monoFilter: mc.id }))}
                        style={[styles.monoDiscBtn, active && styles.monoDiscBtnOn]}
                      >
                        <MonoFilterDiscSvg id={mc.id} size={28} active={active} />
                        <Text style={[styles.monoDiscLabel, active && styles.monoDiscLabelOn]}>{mc.label}</Text>
                        <Text style={styles.monoDiscSub} numberOfLines={1}>{mc.sub}</Text>
                      </Pressable>
                    );
                  })}
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
    maxHeight: '86%',
    backgroundColor: DARK.panel,
    borderColor: DARK.border,
    borderWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
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
  lensGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: '31.5%',
    minWidth: 96,
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 9,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: DARK.border,
    backgroundColor: DARK.panelRaised,
    position: 'relative',
  },
  tileOn: {
    borderColor: DARK.accent,
    backgroundColor: DARK.accentSoft,
  },
  tilePressed: { opacity: 0.82 },
  artWrap: {
    width: 82,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
  },
  tileTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: DARK.text,
    textAlign: 'center',
  },
  tileTitleOn: {
    color: DARK.accent,
  },
  tileSpec: {
    fontFamily: mono,
    fontSize: 9.5,
    color: DARK.textDim,
    textAlign: 'center',
    marginTop: 2,
  },
  tileSpecOn: {
    color: '#BAE6FD',
  },
  checkCorner: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: DARK.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  badgePill: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: DARK.borderStrong,
    zIndex: 2,
  },
  badgePillOn: {
    backgroundColor: DARK.accent,
    borderColor: DARK.accent,
  },
  badgePillText: {
    fontFamily: mono,
    fontSize: 8.5,
    fontWeight: '800',
    color: DARK.textDim,
  },
  badgePillTextOn: {
    color: '#03111B',
  },
  detailBox: {
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: DARK.borderStrong,
    backgroundColor: DARK.overlay,
    gap: 7,
  },
  detailTitle: { fontFamily: mono, fontSize: 10.5, color: DARK.textDim, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  anchorRow: { gap: 6 },
  monoDiscRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monoDiscBtn: {
    flex: 1,
    minWidth: 60,
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: DARK.border,
    backgroundColor: DARK.panelRaised,
    gap: 3,
  },
  monoDiscBtnOn: {
    borderColor: DARK.accent,
    backgroundColor: DARK.accentSoft,
  },
  monoDiscLabel: {
    fontFamily: mono,
    fontSize: 9.5,
    fontWeight: '700',
    color: DARK.text,
  },
  monoDiscLabelOn: {
    color: DARK.accent,
  },
  monoDiscSub: {
    fontSize: 8.5,
    color: DARK.textDim,
  },
});
