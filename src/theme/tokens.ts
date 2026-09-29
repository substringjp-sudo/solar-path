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
import { Platform } from 'react-native';

export const color = {
  bg: '#070A12',
  panel: '#0D1320',
  panelRaised: '#131B2B',
  overlay: 'rgba(10, 15, 26, 0.82)',
  scrim: 'rgba(3, 5, 10, 0.62)',

  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',

  text: '#F1F5F9',
  textDim: '#94A3B8',
  textMute: '#64748B',

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
} as const;

export const radius = { xs: 4, sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** 엄지로 누르는 최소 크기(px). 이보다 작은 버튼은 hitSlop 으로 넓힙니다. */
export const TOUCH = 40;
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
