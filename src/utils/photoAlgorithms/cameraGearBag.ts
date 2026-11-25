/**
 * cameraGearBag.ts — 촬영 화면 '가상 광학 가방' 상태, 프리셋 및 요약 라벨 정의.
 */
import { L3, type Language } from '../i18n';
import type { MonochromeOpticalFilter } from './opticalFilters';

export type OpticalLensMount = 'standard' | 'scheimpflug' | 'dolly' | 'anamorphic';

export type FrontFilterId =
  | 'gnd'
  | 'cpl'
  | 'nd1000'
  | 'astroClear'
  | 'proMist'
  | 'dehaze'
  | 'ghostClean';

export type FilmBackMode =
  | 'natural'
  | 'sunsetWb'
  | 'monoZone'
  | 'astroDual'
  | 'luckyTele'
  | 'timeShift';

export interface CameraGearBagState {
  /** 확장 렌즈 마운트 (1개). */
  lensMount: OpticalLensMount;
  /** 전면 필터 슬롯 (최대 2개). */
  frontFilters: FrontFilterId[];
  /** 필름 / 센서 촬영 모드 (1개). */
  filmBack: FilmBackMode;

  // ── 3D 틸트-시프트 · 돌리 줌 · 수직 교정 세부값 ──
  focusDistM: number;
  tiltPitchDeg: number;
  apertureF: 1.4 | 2.0 | 2.8 | 4.0;
  /** IMU 기반 건축 수직선 교정 (표준/다른 렌즈에서도 단독 활성화 가능). */
  verticalShift: boolean;
  shiftStrength: number;
  /** 가상 돌리 줌 원경 압축 배율(1.0..2.5). */
  dollyFarZoom: number;

  // ── 전면 필터 세부값 ──
  gndMode: 'reverse' | 'standard';
  gndStops: number;
  cplStrength: number;
  /** ND1000 구름 장노출 시뮬레이션 노출 시간(초). */
  ndDurationSec: number;
  /** + = 연무 제거(Dehaze), - = 산수화 원근 강조. */
  dehazeStrength: number;
  /** 겹친 산 능선 층 분리 마이크로 대비(0..1). */
  ridgeBandContrast: number;
  proMistGrade: 0.125 | 0.25 | 0.5 | 1;
  lightPollutionStrength: number;
  sunstarBlades: 6 | 8 | 10;

  // ── 필름 / 센서 백 세부값 ──
  wbStrength: number;
  /** 노을 색감 락 시 3단 노출 브라켓 합성 사용 여부. */
  sunsetBracket3Shot: boolean;
  monoFilter: MonochromeOpticalFilter;
  /** 해·달 럭키 이미징 연사 장수 (6..16). */
  luckyBurstCount: number;

  // ── 뷰파인더 보조 HUD ──
  showPeakLabels: boolean;
  showDipHorizon: boolean;
  showCloudDurationHint: boolean;

  // ── 3D 지형·건물 가이드 기반 이미지 경계 추론 보정 ──
  /** 0 = 이미지 픽셀 경계(건물·나무) 우선, 1 = 3D DEM 가이드 고정. 기본 0.45. */
  skylinePriorWeight: number;
  /** 3D 가이드선 상하 탐색 반경(화면 높이 비율, 0.06..0.24). 기본 0.14. */
  skylineSearchNorm: number;
  /** 3D 가이드선(점선)과 이미지 추론 실제 경계선(실선) 비교 표시 여부. */
  showSkylineCompare: boolean;
}

export const MAX_FRONT_FILTERS = 2;

export function createDefaultGearBag(): CameraGearBagState {
  return {
    lensMount: 'standard',
    frontFilters: [],
    filmBack: 'natural',
    focusDistM: 1200,
    tiltPitchDeg: 8,
    apertureF: 2.0,
    verticalShift: false,
    shiftStrength: 0.85,
    dollyFarZoom: 1.55,
    gndMode: 'reverse',
    gndStops: 1.8,
    cplStrength: 0.78,
    ndDurationSec: 12,
    dehazeStrength: 0.55,
    ridgeBandContrast: 0.4,
    proMistGrade: 0.25,
    lightPollutionStrength: 0.75,
    sunstarBlades: 8,
    wbStrength: 0.72,
    sunsetBracket3Shot: false,
    monoFilter: 'red25A',
    luckyBurstCount: 8,
    showPeakLabels: false,
    showDipHorizon: false,
    showCloudDurationHint: true,
    skylinePriorWeight: 0.45,
    skylineSearchNorm: 0.14,
    showSkylineCompare: false,
  };
}

/** 전면 필터 슬롯(최대 2개) 토글 — 2개가 차 있으면 가장 먼저 낀 필터를 빼고 새 필터를 장착합니다. */
export function toggleFrontFilter(
  state: CameraGearBagState,
  id: FrontFilterId,
): CameraGearBagState {
  const exists = state.frontFilters.includes(id);
  if (exists) {
    return { ...state, frontFilters: state.frontFilters.filter(f => f !== id) };
  }
  const next = state.frontFilters.length >= MAX_FRONT_FILTERS
    ? [...state.frontFilters.slice(1), id]
    : [...state.frontFilters, id];
  return { ...state, frontFilters: next };
}

/** 이미지 후처리/광학 효과가 1개라도 켜져 있는지 확인. */
export function hasActiveOpticalGear(s: CameraGearBagState): boolean {
  return (
    s.lensMount !== 'standard' ||
    s.frontFilters.length > 0 ||
    s.filmBack !== 'natural' ||
    s.verticalShift ||
    s.showSkylineCompare
  );
}

export function lensMountShortLabel(mount: OpticalLensMount, lang: Language): string {
  switch (mount) {
    case 'scheimpflug':
      return L3(lang, '틸트-시프트', 'Tilt-Shift', 'チルトシフト');
    case 'dolly':
      return L3(lang, '원근 압축', 'Dolly Compress', '圧縮ドリー');
    case 'anamorphic':
      return L3(lang, '아나모픽', 'Anamorphic', 'アナモル');
    default:
      return L3(lang, '표준', 'Std', '標準');
  }
}

export function frontFilterShortLabel(id: FrontFilterId, lang: Language): string {
  switch (id) {
    case 'gnd':
      return L3(lang, '능선 GND', 'Ridge GND', '稜線GND');
    case 'cpl':
      return L3(lang, '레일리 CPL', 'Rayleigh CPL', 'CPL偏光');
    case 'nd1000':
      return L3(lang, 'ND1000 구름', 'ND1000 Cloud', 'ND雲流');
    case 'astroClear':
      return L3(lang, '광해 컷', 'Astro-Clear', '光害カット');
    case 'proMist':
      return L3(lang, 'Pro-Mist', 'Pro-Mist', 'Pro-Mist');
    case 'dehaze':
      return L3(lang, '연무·산수', 'Dehaze', '霞・山水');
    case 'ghostClean':
      return L3(lang, '고스트 클린', 'Anti-Ghost', 'ゴースト除去');
  }
}

export function filmBackShortLabel(mode: FilmBackMode, lang: Language): string {
  switch (mode) {
    case 'sunsetWb':
      return L3(lang, '노을 색 락', 'Sunset WB', '夕焼色ロック');
    case 'monoZone':
      return L3(lang, 'Zone 흑백', 'Zone Mono', 'Zone白黒');
    case 'astroDual':
      return L3(lang, '지형+별', 'Astro Dual', '地形+星');
    case 'luckyTele':
      return L3(lang, '럭키 줌', 'Lucky Tele', 'ラッキー望遠');
    case 'timeShift':
      return L3(lang, '시간차 정합', 'Time-Shift', '時差合成');
    default:
      return L3(lang, '표준', 'Standard', '標準');
  }
}

/** ExposureCells의 '렌즈' 칸 하단에 표시할 확장 광학 요약 문자열. */
export function summarizeGearForCell(s: CameraGearBagState, lang: Language): string {
  const parts: string[] = [];
  if (s.lensMount !== 'standard') parts.push(lensMountShortLabel(s.lensMount, lang));
  else if (s.verticalShift) parts.push(L3(lang, '수직 시프트', 'Shift', '垂直補正'));
  for (const f of s.frontFilters) parts.push(frontFilterShortLabel(f, lang));
  if (s.filmBack !== 'natural') parts.push(filmBackShortLabel(s.filmBack, lang));
  if (s.showSkylineCompare && parts.length === 0) parts.push(L3(lang, '경계 보정', 'Skyline Fit', '境界補正'));
  return parts.join(' · ');
}
