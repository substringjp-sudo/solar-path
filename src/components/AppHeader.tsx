/**
 * AppHeader.tsx
 *
 * 앱 맨 위 한 줄 — **탭 셋(01 하늘 · 02 학습 · 03 기록)** + 위치(장소 이름) · 설정.
 *
 * ## 달라진 것 (2026-11-21, 헤더 유리)
 *
 * - **머리줄이 하늘 위에 떠 있습니다**(절대 위치, 높이 `HEADER_HEIGHT` 48). 하늘 탭에서는 3D 하늘이 머리줄 뒤까지 이어지고 탭 · 장소 · 설정이 테두리 없는 유리(흐림 + 어두운 칠)이며 글자는 모두 #F1F5F9 입니다.
 *   학습 · 기록 탭은 불투명한 화면이라 내용이 머리줄 아래에서 시작하고(`TabNavigator`) 머리줄은 예전 테마 상자 그대로입니다(밝은 테마에서 유리 위 흰 글자 대비가 모자람, `utils/headerLayout.ts`).
 *
 * ## 달라진 것 (2026-11-20)
 *
 * - **02 예보가 02 학습이 됐습니다**(`LearnScreen`). 16일 예보 표는 그대로 있고, 시트의 이벤트 목록 · 기상 정보, 왜 그런가요 창이
 *   한 페이지로 모였습니다(docs/SANDBOX_MODE_PLAN.md 13 장).
 *
 * ## 달라진 것 (2026-10-25, 디자인 2단)
 *
 * - 탭 이름을 디자인 시스템 이름으로 바꿨습니다("시뮬레이션 · 갤러리" → "하늘 · 기록").
 * - 그 사이에 02 예보(16일 × 일출 · 일몰 판정)를 끼웠습니다. 기록은 03 입니다.
 * - 위치 버튼이 지금 장소를 이름으로 보여 줍니다(`placeLabel`). 예전에는 핀 아이콘만 있어 어느 하늘인지 알 수 없었습니다.
 *
 * ## 달라진 것 (§143)
 *
 * - **날짜 바를 뺐습니다.** 날짜 표시·앞뒤 하루·"오늘"·달력은 하단의 날짜·시간 막대(`TimeBar/DateTimeBar`)가
 *   전부 합니다. 같은 값을 위아래에서 두 번 보여 주고 있었습니다.
 * - **지도 탭을 뺐습니다.** 지도·구는 하늘 탭을 핀치로 줌아웃하면 같은 화면에서 이어집니다(`zoomContinuum.ts`).
 *   지도 탭의 등시선·구름 레이더는 그 줌 화면이 이미 그립니다.
 *
 * (옛 구조의 이력: docs/IA_REDESIGN.md — 카테고리 드롭다운 × 서브탭 → 평면 3탭 → 2탭 → 지금의 3탭.)
 */
import React, { useMemo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { ChevronDown, ChevronUp, Compass, Globe, MapPin, Moon, RefreshCw, Settings, SlidersHorizontal, Sun, Target, X } from 'lucide-react-native';
import { useCelestialStore } from '../store/useCelestialStore';
import { t, L3 } from '../utils/i18n';
import { space, TOUCH } from '../theme/tokens';
import type { SavedLocation } from '../store/useCelestialStore';
import { PressScale } from './ui';
import { GlassSurface, glassTextShadow } from './glass/GlassSurface';
import { ACTIVE_CHIP_TEXT, TEXT } from '../theme/glassTokens';
import { HEADER_HEIGHT, HEADER_PAD_BOTTOM, HEADER_PAD_TOP, headerMaterial } from '../utils/headerLayout';
import { makeStyles, useThemeColors } from '../theme/useTheme';
import { useAdministrativeArea } from '../utils/reverseGeocode';

/** 앱의 최상위 화면. 데이터(-1 왼쪽) · 하늘(메인). */
export type AppTab = 'learn' | 'sky';

export const APP_TABS: { id: AppTab; code: string; label: string }[] = [
  { id: 'learn', code: '01', label: 'DATA' },
  { id: 'sky', code: '02', label: 'SKY' },
];

/**
 * 헤더 위치 버튼에 적을 이름.
 * 1. 저장한 장소와 1km 안이면 그 이름(별칭)
 * 2. 행정구역 이름(시/도/구/동, 해외 도시명)
 * 3. 역지오코딩 전이거나 실패 시 짧은 좌표
 */
export function placeLabel(
  lat: number | undefined,
  lon: number | undefined,
  saved: SavedLocation[],
  adminName?: string | null,
): string | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  let best: { name: string; d: number } | null = null;
  for (const s of saved) {
    const d = Math.hypot((s.latitude - lat) * kmPerDegLat, (s.longitude - lon) * kmPerDegLon);
    if (d <= 1 && (!best || d < best.d)) best = { name: s.name, d };
  }
  if (best) return best.name;
  if (adminName) return adminName;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** 스와이프 순서 = 탭 순서. 둘이 어긋날 수 없도록 같은 배열에서 유도합니다. */
export const TAB_ORDER: AppTab[] = APP_TABS.map(t2 => t2.id);

interface AppHeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  setSettingsVisible: (visible: boolean) => void;
  setMapVisible?: (visible: boolean) => void;
  isCameraActive?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  setSettingsVisible,
  setMapVisible,
  isCameraActive = false,
}) => {
  const color = useThemeColors(); const styles = useStyles();
  const language = useCelestialStore(s => s.language);
  const location = useCelestialStore(s => s.location);
  const savedLocations = useCelestialStore(s => s.savedLocations);
  const expertMode = useCelestialStore(s => s.expertMode);
  const skyHeaderActions = useCelestialStore(s => s.skyHeaderActions);
  const cameraHud = useCelestialStore(s => s.cameraHud);
  const adminName = useAdministrativeArea(location?.coords?.latitude, location?.coords?.longitude);
  const place = useMemo(
    () => placeLabel(location?.coords?.latitude, location?.coords?.longitude, savedLocations, adminName),
    [location?.coords?.latitude, location?.coords?.longitude, savedLocations, adminName],
  );

  // 단일 루트 HUD: 카메라 오버레이가 권한/결과 미리보기 등을 덮을 때만 숨김
  if (isCameraActive && (!cameraHud || cameraHud.hidden)) return null;

  const showCamera = !!isCameraActive && !!cameraHud;
  const glass = headerMaterial(activeTab) === 'glass';
  const isGlass = showCamera || glass;
  const placeLabelText = `${L3(language, '위치 변경', 'Change location', '位置を変更')}${place ? ` — ${place}` : ''}`;

  // 좌측 슬롯: 전 모드 동일 위치 · 동일 규격(40px 캡슐 알약).
  const renderLeft = () => {
    if (showCamera) {
      return (
        <PressScale
          testID="hdr-az"
          onPress={cameraHud.onToggleTopInfo}
          style={styles.pillBtn}
          accessibilityLabel={L3(language, '촬영 정보 펼치기/접기', 'Toggle capture info', '撮影情報を開閉')}
          accessibilityRole="button"
        >
          <GlassSurface active={cameraHud.topInfoExpanded || cameraHud.frozenActive} style={StyleSheet.absoluteFill} />
          {cameraHud.isAstro ? <Moon size={12} color={TEXT} /> : <Sun size={12} color={TEXT} />}
          <Text style={[styles.pillText, { color: TEXT }, glassTextShadow]} numberOfLines={1}>
            {`AZ ${Math.round(cameraHud.azDeg)}° · ${cameraHud.elDeg >= 0 ? '+' : ''}${cameraHud.elDeg.toFixed(0)}°`}
          </Text>
          {cameraHud.topInfoExpanded ? <ChevronUp size={13} color={TEXT} /> : <ChevronDown size={13} color={TEXT} />}
        </PressScale>
      );
    }

    return setMapVisible ? (
      <PressScale
        testID="hdr-place"
        onPress={() => setMapVisible(true)}
        style={[styles.pillBtn, !isGlass && styles.solidSurface]}
        accessibilityLabel={placeLabelText}
        accessibilityRole="button"
      >
        {isGlass ? <GlassSurface style={StyleSheet.absoluteFill} /> : null}
        <MapPin size={12} color={isGlass ? TEXT : color.accent} />
        <Text
          style={[styles.pillText, isGlass ? [{ color: TEXT }, glassTextShadow] : null]}
          numberOfLines={1}
        >
          {place ?? L3(language, '위치', 'Place', '場所')}
        </Text>
      </PressScale>
    ) : <View />;
  };

  return (
    <View style={styles.header} pointerEvents="box-none">
      <View style={styles.headerTop} pointerEvents="box-none">
        {renderLeft()}

        {/* 중앙 슬롯: 현재 위치와 우측 버튼 사이에 추적 중 / 선택 객체 요약 배지 배치 */}
        <View style={styles.centerSlot} pointerEvents="box-none">
          {!showCamera && isGlass && skyHeaderActions?.trackingLabel ? (
            <PressScale
              testID="hdr-tracking"
              onPress={skyHeaderActions.onClearTracking}
              style={styles.centerPill}
              accessibilityLabel={`${skyHeaderActions.trackingLabel} — ${t('trackRelease', language)}`}
              accessibilityRole="button"
            >
              <GlassSurface active style={StyleSheet.absoluteFill} />
              <Target size={11} color={ACTIVE_CHIP_TEXT} />
              <Text style={[styles.centerPillText, glassTextShadow]} numberOfLines={1}>
                {skyHeaderActions.trackingLabel}
              </Text>
              <X size={11} color={TEXT} />
            </PressScale>
          ) : !showCamera && isGlass && skyHeaderActions?.pickedLabel ? (
            <View style={styles.centerPillGroup} pointerEvents="box-none">
              <PressScale
                testID="hdr-picked"
                onPress={skyHeaderActions.onTogglePickedDetail}
                style={styles.centerPill}
                accessibilityLabel={skyHeaderActions.pickedLabel}
                accessibilityRole="button"
              >
                <GlassSurface active={!!skyHeaderActions.pickedDetailOpen} style={StyleSheet.absoluteFill} />
                <Text style={[styles.centerPillText, glassTextShadow]} numberOfLines={1}>
                  {skyHeaderActions.pickedLabel}
                </Text>
                {skyHeaderActions.pickedDetailOpen
                  ? <ChevronUp size={12} color={TEXT} />
                  : <ChevronDown size={12} color={TEXT} />}
              </PressScale>
              {skyHeaderActions.onClearPicked ? (
                <PressScale
                  testID="hdr-picked-clear"
                  onPress={skyHeaderActions.onClearPicked}
                  style={styles.centerCloseBtn}
                  accessibilityLabel={L3(language, '고른 대상 지우기', 'Clear target', '選択を消す')}
                  accessibilityRole="button"
                >
                  <GlassSurface style={StyleSheet.absoluteFill} />
                  <X size={12} color={TEXT} />
                </PressScale>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 우측 슬롯: 전 모드 동일 규격의 40×40 원형 아이콘 버튼만 정렬 */}
        <View style={styles.rightButtons} pointerEvents="box-none">
          {showCamera && (
            <>
              <PressScale
                testID="hdr-align"
                onPress={cameraHud.onToggleAlignMenu}
                style={styles.circleBtn}
                accessibilityLabel={L3(language, '화면·방위 보정', 'Align & Heading', '画面・方位補正')}
                accessibilityRole="button"
              >
                <GlassSurface active={cameraHud.alignMenuOpen} style={StyleSheet.absoluteFill} />
                <Compass size={15} color={cameraHud.alignMenuOpen ? ACTIVE_CHIP_TEXT : TEXT} />
                {cameraHud.alignDotColor ? (
                  <View style={[styles.dotBadge, { backgroundColor: cameraHud.alignDotColor }]} />
                ) : null}
              </PressScale>
              {cameraHud.canSwitchCamera && (
                <PressScale
                  testID="cam-switch"
                  onPress={cameraHud.onSwitchCamera}
                  style={styles.circleBtn}
                  accessibilityLabel={L3(language, '앞뒤 카메라 바꾸기', 'Switch camera', 'カメラ切替')}
                  accessibilityRole="button"
                >
                  <GlassSurface style={StyleSheet.absoluteFill} />
                  <RefreshCw size={15} color={TEXT} />
                </PressScale>
              )}
            </>
          )}

          {!showCamera && isGlass && expertMode && skyHeaderActions?.openLayers && (
            <PressScale
              testID="hdr-layers"
              onPress={skyHeaderActions.openLayers}
              onLongPress={skyHeaderActions.openDev}
              style={styles.circleBtn}
              accessibilityLabel={t('layerTitle', language)}
              accessibilityRole="button"
            >
              <GlassSurface style={StyleSheet.absoluteFill} />
              <SlidersHorizontal size={15} color={TEXT} />
            </PressScale>
          )}

          {!showCamera && isGlass && !skyHeaderActions?.ascended && skyHeaderActions?.flyToMap && (
            <PressScale
              testID="hdr-map"
              onPress={skyHeaderActions.flyToMap}
              style={styles.circleBtn}
              accessibilityLabel={L3(language, '지도 · 구름 레이더로', 'Map · cloud radar', '地図 · 雲レーダーへ')}
              accessibilityRole="button"
            >
              <GlassSurface style={StyleSheet.absoluteFill} />
              <Globe size={15} color={TEXT} />
            </PressScale>
          )}

          <PressScale
            testID="hdr-settings"
            onPress={() => setSettingsVisible(true)}
            style={[styles.circleBtn, !isGlass && styles.solidSurface]}
            accessibilityLabel={t('settings', language)}
            accessibilityRole="button"
          >
            {isGlass ? <GlassSurface style={StyleSheet.absoluteFill} /> : null}
            <Settings size={15} color={isGlass ? TEXT : color.textDim} />
          </PressScale>
        </View>
      </View>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  // 하늘 위에 떠 있습니다(`HEADER_HEIGHT` = 위 여백 4 + 줄 40 + 아래 여백 4).
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    height: HEADER_HEIGHT,
    paddingTop: HEADER_PAD_TOP,
    paddingBottom: HEADER_PAD_BOTTOM,
    paddingHorizontal: space.md,
  },
  headerTop: {
    height: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  centerSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  centerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: TOUCH,
    minHeight: TOUCH,
    maxWidth: '100%',
    flexShrink: 1,
    paddingHorizontal: 10,
    borderRadius: TOUCH / 2,
    overflow: 'hidden',
  },
  centerPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    includeFontPadding: false,
    color: TEXT,
    flexShrink: 1,
  },
  centerCloseBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 좌측 공용 알약 규격 (전 모드 동일: 높이 40, 반지름 20). */
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: TOUCH,
    minHeight: TOUCH,
    minWidth: TOUCH,
    maxWidth: 150,
    flexShrink: 1,
    paddingHorizontal: 12,
    borderRadius: TOUCH / 2,
    overflow: 'hidden',
  },
  pillText: { fontSize: 11, lineHeight: 14, fontWeight: '500', includeFontPadding: false, color: color.text, flexShrink: 1 },
  /** 우측 공용 원형 아이콘 버튼 규격 (전 모드 동일: 40×40 정원). */
  circleBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** 불투명 화면(데이터 탭)에서만 쓰는 바탕 · 테두리. */
  solidSurface: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
  },
  dotBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
}));
