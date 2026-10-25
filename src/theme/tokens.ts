/**
 * tokens.ts — BeforeGlow 디자인 언어의 **유일한 출처** (2026-09-29 정리).
 *
 * 정리 전: 색 308가지(hex 144 · rgba 164), 모서리 반경 15가지, 글자 크기 20가지 넘게 섞여
 * 있었고, 강조색이 낮엔 주황·밤엔 하늘색으로 바뀌어 "누를 수 있는 것" 의 색이 시간대마다
 * 달랐습니다. 새 화면·부품은 여기 값만 씁니다.
 *
 * ## 색은 역할로 고릅니다
 *  - `accent` (하늘색) — **누를 수 있는 것, 고른 것.** 탭 표시, 켜진 토글, 링크, 주 버튼.
 *  - `sun` · `glow` (호박·주황) — **해와 노을 데이터.** 일출·일몰 시각, 노을 점수, 해 표시.
 *  - `moon` (연보라) — 달 데이터.  `cloud` (흰 회색) — 구름 데이터.
 *  - `success` · `warning` · `danger` — 상태(권한 허용·주의·오류). 장식에 쓰지 않습니다.
 *  - 글자: `text`(본문) · `textDim`(설명·보조 값) · `textMute`(단위·꺼진 것).
 *
 * ## 재질은 세 겹 + 모달
 *  - `bg` — 바닥.
 *  - `panel` — **도킹 패널**: 화면 아래 조작부, 끌어올리는 시트, 설정 카드. 불투명.
 *  - `overlay` — **떠 있는 것**: 3D 하늘·지도 위의 버튼·배지·범례. 반투명(뒤가 비침).
 *  - `modal` — 창 + `scrim`(뒤를 가리는 막).
 *
 * ## 자리 규칙 (하늘·지도 탭 공통)
 *  - 왼쪽 위 = **읽는 것**(방위 HUD, 태양 배지)  ·  오른쪽 위 = **보기 조작**(레이어, 위치, 구/지도, 도움말)
 *  - 왼쪽 아래 = **범례·읽기값**  ·  화면 아래 도킹 패널 = **시간 조작**(슬라이더·재생) + 주 동작(촬영)
 *  - 헤더 = 탭 · 위치 · 설정 · 날짜 — 앱 전체에 걸리는 것만.
 */
import { Platform, Easing } from 'react-native';

export type Palette = { readonly [K in keyof typeof darkColorShape]: string };
export type DataPalette = { readonly [K in keyof typeof darkDataShape]: string };

const darkColorShape = {
  bg: '#070A12',
  panel: '#0D1320',
  panelRaised: '#131B2B',
  overlay: 'rgba(10, 15, 26, 0.82)',
  scrim: 'rgba(3, 5, 10, 0.62)',

  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',

  text: '#F1F5F9',
  textDim: '#94A3B8',
  /** bg 5.3 · panel 5.0 · panelRaised 4.6 : 1. 예전 #64748B 는 panel 위 3.9 : 1 로 4.5 에 못 미쳤습니다(2026-10-25). */
  textMute: '#778699',

  accent: '#38BDF8',
  accentSoft: 'rgba(56, 189, 248, 0.14)',
  accentLine: 'rgba(56, 189, 248, 0.40)',
  onAccent: '#04121C',

  sun: '#FBBF24',
  glow: '#F97316',
  glowSoft: 'rgba(249, 115, 22, 0.14)',
  moon: '#A5B4FC',
  cloud: '#E2E8F0',

  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',

  /** 패널 안 칸 바탕처럼 아주 옅은 채움 */
  fill: 'rgba(255, 255, 255, 0.04)',
} as const;

/** 어두운 모드(기본) — 떠 있는 것과 촬영 화면은 모드와 상관없이 이 값을 씁니다. */
export const color = darkColorShape;

/**
 * 데이터 색 — **그림과 범례가 같은 값을 써야 하는 색**. UI 역할색(`color`)과 달리 값이 뜻을 가집니다:
 * 지도에 그린 일출선이 `sunrise` 면 범례·배지·절기 점·슬라이더 표시도 `sunrise` 입니다.
 * 값을 바꾸면 그림(MapGlobe · MapCanvas · Visualizer)과 범례가 함께 바뀝니다.
 */
const darkDataShape = {
  sunrise: '#FFA500',
  sunset: '#FF4500',
  /** 지도 가까운 축척의 태양 고도선 · 방위선 */
  altitude: '#38BDF8',
  azimuth: '#FB923C',
  /** 절기 점(춘분 · 하지 · 추분 · 동지) */
  spring: '#4ADE80',
  summer: '#FFA500',
  autumn: '#F97316',
  winter: '#38BDF8',
  /** 3D 레이어 아이콘 */
  stars: '#A78BFA',
  milkyway: '#C4B5FD',
  planets: '#F43F5E',
  cityLights: '#F59E0B',
  paths: '#22C55E',
  /** 노을 예보 품질 · 구름 · 색 라벨(PredictionCard · Visualizer · 이벤트 점수) */
  qEpic: '#FF5C3F',
  qGreat: '#FF8A3D',
  qFair: '#E6C25A',
  /** panel 5.4 : 1. 예전 #6B7886 은 4.1 : 1 이었습니다(2026-10-25). */
  qOvercast: '#7D8BA0',
  qClean: '#4DA0B0',
} as const;
export const dataColor = darkDataShape;

/**
 * 밝은 모드 — **패널 · 창 · 기록 탭 · 헤더만** 밝아집니다(2026-09-30, "좁은 범위").
 *
 * 하늘 · 지도 위의 떠 있는 것(`overlay`)과 촬영 화면은 그림 위에서 읽혀야 하므로 모드와 상관없이
 * 어둡습니다. 그래서 `lightColor.overlay` 도 어두운 값 그대로입니다 — 떠 있는 것을 그리는 코드는
 * 테마 훅이 아니라 모듈의 `color`(어두운 값)를 씁니다.
 *
 * 대비(흰 바탕 `panelRaised` / `panel`): text 17.9 · textDim 7.6 · textMute 4.8 · accent 5.9 · sun 5.0 ·
 * glow 5.2 · moon 6.3 · success 5.0 · danger 4.8 : 1. 강조색 바탕 위 흰 글자(`onAccent`) 5.9 : 1.
 */
export const lightColor: Palette = {
  bg: '#E9EEF4',
  panel: '#F8FAFC',
  panelRaised: '#FFFFFF',
  overlay: color.overlay,
  scrim: 'rgba(15, 23, 42, 0.40)',

  border: 'rgba(15, 23, 42, 0.12)',
  borderStrong: 'rgba(15, 23, 42, 0.20)',

  text: '#0F172A',
  textDim: '#475569',
  textMute: '#64748B',

  accent: '#0369A1',
  accentSoft: 'rgba(2, 132, 199, 0.12)',
  accentLine: 'rgba(2, 132, 199, 0.55)',
  onAccent: '#FFFFFF',

  sun: '#B45309',
  glow: '#C2410C',
  glowSoft: 'rgba(194, 65, 12, 0.10)',
  moon: '#4F46E5',
  cloud: '#475569',

  success: '#15803D',
  warning: '#B45309',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.10)',

  fill: 'rgba(15, 23, 42, 0.04)',
};

/**
 * 밝은 바탕용 데이터 색 — 같은 이름은 같은 뜻, **같은 색 계열의 진한 값**입니다.
 * 밝은 패널 위의 절기 점 · 예보 라벨 · 레이어 아이콘에 씁니다. 지도에 그린 선과 그 범례는 지도(어두운
 * 그림) 위에 있으므로 늘 `dataColor` 입니다.
 */
export const lightDataColor: DataPalette = {
  sunrise: '#B45309',
  sunset: '#C2410C',
  altitude: '#0369A1',
  azimuth: '#C2410C',
  spring: '#15803D',
  summer: '#B45309',
  autumn: '#C2410C',
  winter: '#0369A1',
  stars: '#7C3AED',
  milkyway: '#8B5CF6',
  planets: '#E11D48',
  cityLights: '#B45309',
  paths: '#15803D',
  qEpic: '#DC2626',
  qGreat: '#C2410C',
  qFair: '#A16207',
  qOvercast: '#475569',
  qClean: '#0E7490',
};

export type ThemeMode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';
export const palettes: Record<Scheme, { color: Palette; data: DataPalette }> = {
  dark: { color, data: dataColor },
  light: { color: lightColor, data: lightDataColor },
};

export const radius = { xs: 4, sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** 엄지로 누르는 최소 크기(px). 이보다 작은 버튼은 hitSlop 으로 넓힙니다. */
export const TOUCH = 40;
/** 아이콘 크기(px) — 글자 옆 12 · 칩/머리 14 · 아이콘 버튼 16 · 목록 줄 18 · 촬영 화면 큰 버튼 22. */
export const icon = { inline: 12, chip: 14, button: 16, row: 18, large: 22 } as const;

/** 떠 있는 아이콘 버튼 한 변(px) — 하늘·지도 오버레이 공통. */
export const OVERLAY_BTN = 32;

export const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * 글자 단계 — 다섯 개만 씁니다.
 *  - `micro` 9 : 단위·눈금(모노, 대문자 간격)
 *  - `label` 11 : 라벨·칩·배지(모노)
 *  - `body` 13 : 본문·목록 제목
 *  - `title` 16 : 시트·창 제목
 *  - `display` 22 : 큰 수치(시각·점수)
 */
export const type = {
  micro: { fontSize: 9, fontFamily: mono, fontWeight: '700' as const, letterSpacing: 0.6 },
  label: { fontSize: 11, fontFamily: mono, fontWeight: '700' as const, letterSpacing: 0.3 },
  body: { fontSize: 13, fontWeight: '500' as const },
  bodyStrong: { fontSize: 13, fontWeight: '700' as const },
  title: { fontSize: 16, fontWeight: '800' as const },
  display: { fontSize: 22, fontFamily: mono, fontWeight: '800' as const },
} as const;

/** 재질 — 스타일 조각으로 바로 펼쳐 씁니다. */
export const material = {
  panel: { backgroundColor: color.panel, borderColor: color.border, borderWidth: 1, borderRadius: radius.lg },
  overlay: { backgroundColor: color.overlay, borderColor: color.border, borderWidth: 1, borderRadius: radius.sm },
  modal: { backgroundColor: color.panelRaised, borderColor: color.borderStrong, borderWidth: 1, borderRadius: radius.lg },
  chip: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: color.border, borderWidth: 1, borderRadius: radius.xs },
  chipOn: { backgroundColor: color.accentSoft, borderColor: color.accentLine, borderWidth: 1, borderRadius: radius.xs },
} as const;

/**
 * 움직임 — 반응은 "눌렀다 · 바뀌었다 · 나타났다" 를 알려 줄 만큼만(자세한 규칙은 docs/DESIGN_SYSTEM.md §7).
 *
 *  - `duration.tap` 90  : 누르는 순간(손가락이 닿자마자 줄어듦)
 *  - `duration.fast` 160 : 켜고 끄기 · 색 바뀜 · 작은 것이 나타남
 *  - `duration.base` 240 : 탭 표시 이동 · 창 닫힘 · 배너 나타남
 *  - `duration.slow` 480 : 낮↔밤 배경처럼 분위기가 바뀌는 것
 *  - 스프링은 세 가지: `press`(놓으면 제자리로), `sheet`(시트·창), `page`(탭 넘김).
 *  - 몸짓 끝에서 제자리로 돌아가는 것은 스프링, 스스로 끝나는 것(닫힘·색)은 시간.
 *  - "동작 줄이기" 가 켜져 있으면 크기·위치 움직임은 즉시 끝나고 흐림(dim)만 남습니다.
 */
export const motion = {
  duration: { tap: 90, fast: 160, base: 240, slow: 480 },
  easing: {
    /** 들어올 때 — 빨리 시작해 부드럽게 멈춤 */
    enter: Easing.out(Easing.cubic),
    /** 나갈 때 — 천천히 시작해 빠르게 사라짐 */
    exit: Easing.in(Easing.cubic),
    /** 제자리에서 바뀔 때 */
    standard: Easing.inOut(Easing.cubic),
  },
  spring: {
    press: { damping: 14, stiffness: 420, mass: 0.6 },
    sheet: { damping: 20, stiffness: 170, mass: 0.9 },
    page: { damping: 20, stiffness: 130, mass: 0.9 },
  },
  press: {
    /** 누르면 가장자리가 이만큼(px) 들어갑니다 — 큰 줄은 살짝, 작은 버튼은 또렷하게. */
    insetPx: 3,
    /** 줄어드는 비율의 범위(작은 버튼 5%, 긴 줄 1.2%). */
    minScale: 0.95,
    maxScale: 0.988,
    /** 동작 줄이기일 때 대신 쓰는 흐림 */
    dim: 0.72,
  },
  /** 나타날 때 아래에서 떠오르는 거리(px) */
  rise: 8,
  /** 가운데 뜨는 창(저장 목록)이 커지기 시작하는 배율 */
  popFrom: 0.94,
} as const;

/** 색에 옅은 바탕을 만듭니다 — 아이콘 칸 · 켜진 줄 바탕(`#RRGGBB` → `rgba(…, a)`). */
export const tint = (hex: string, a = 0.15): string => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
