/**
 * OpticalGearArtwork.tsx — 도형 조합 데포르메 스타일의 3/4 입체 렌즈 경통 · 3/4 원형 광학 필터 · 필름/센서 백 일러스트.
 *
 * AI 비트맵 이미지가 아니라 순수 SVG 기하 도형(원통 단면 타원, 사다리꼴 경통, 널링 그립 선, 코팅 볼록 렌즈,
 * 옆면 두께가 보이는 3/4 원형 필터 링과 유리 너머로 비치는 데포르메 산·호수 풍경)을 조합해
 * 실제 카메라 렌즈와 필터 제품의 외형을 직관적으로 표현합니다.
 */
import React from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Line,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type {
  FilmBackMode,
  FrontFilterId,
  OpticalLensMount,
} from '../../utils/photoAlgorithms/cameraGearBag';
import type { MonochromeOpticalFilter } from '../../utils/photoAlgorithms/opticalFilters';

/**
 * 1. 확장 렌즈 마운트 제품 일러스트 — 3/4 측면 원통형 카메라 렌즈 경통 데포르메
 * (왼쪽: 타원형 전면 대물렌즈 + 볼록 코팅 유리 / 중앙: 널링 포커스 링 + 배지 + AF/MF 스위치 + 조리개 눈금 링 / 오른쪽: 테이퍼드 후면 콘 + E-마운트 베이요넷)
 */
export const LensMountArtwork: React.FC<{
  id: OpticalLensMount;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 66, selected = false }) => {
  const uid = `lens3d_${id}`;
  const w = Math.round(size * 1.18);
  const h = size;
  const accentBorder = selected ? '#38BDF8' : '#475569';

  // 포커스 링 가로 널링(Knurling) 홈 Y 좌표들
  const ribYs = [15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5, 55];

  return (
    <Svg width={w} height={h} viewBox="0 0 88 72">
      <Defs>
        {/* 원통형 메탈 경통 세로 음영 (상단 하이라이트 -> 중앙 새틴 블랙 -> 하단 딥 섀도우 -> 바닥 반사광) */}
        <LinearGradient id={`${uid}_barrel`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#1E293B" />
          <Stop offset="18%" stopColor="#475569" />
          <Stop offset="36%" stopColor="#1E293B" />
          <Stop offset="72%" stopColor="#090D16" />
          <Stop offset="90%" stopColor="#020617" />
          <Stop offset="100%" stopColor="#1E293B" />
        </LinearGradient>

        {/* 포커스 링 베이스 그라데이션 */}
        <LinearGradient id={`${uid}_grip`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0F172A" />
          <Stop offset="22%" stopColor="#334155" />
          <Stop offset="55%" stopColor="#0F172A" />
          <Stop offset="88%" stopColor="#020617" />
          <Stop offset="100%" stopColor="#1E293B" />
        </LinearGradient>

        {/* 후면 마운트 실린더 음영 */}
        <LinearGradient id={`${uid}_mount`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#1E293B" />
          <Stop offset="25%" stopColor="#334155" />
          <Stop offset="75%" stopColor="#090D16" />
          <Stop offset="100%" stopColor="#020617" />
        </LinearGradient>

        {/* 망원(Dolly) 백색/샴페인 경통 음영 */}
        <LinearGradient id={`${uid}_tele_white`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#CBD5E1" />
          <Stop offset="22%" stopColor="#F8FAFC" />
          <Stop offset="60%" stopColor="#94A3B8" />
          <Stop offset="90%" stopColor="#475569" />
          <Stop offset="100%" stopColor="#64748B" />
        </LinearGradient>

        {/* 1) 표준 렌즈: 자이스 T* 스타일 웜 앰버-로즈 볼록 대물 유리 코팅 */}
        <LinearGradient id={`${uid}_glass_std`} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0%" stopColor="#FDE68A" stopOpacity="0.92" />
          <Stop offset="32%" stopColor="#D97706" stopOpacity="0.78" />
          <Stop offset="68%" stopColor="#7C2D12" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="#1E1B4B" stopOpacity="0.98" />
        </LinearGradient>

        {/* 2) 틸트-시프트 렌즈: 에메랄드-앰버 광각 TS-E 볼록 대물 유리 코팅 */}
        <LinearGradient id={`${uid}_glass_ts`} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.9" />
          <Stop offset="38%" stopColor="#0284C7" stopOpacity="0.82" />
          <Stop offset="75%" stopColor="#1E1B4B" stopOpacity="0.94" />
          <Stop offset="100%" stopColor="#020617" />
        </LinearGradient>

        {/* 3) 돌리 망원 줌: 대구경 마젠타-바이올렛 불소 코팅 */}
        <LinearGradient id={`${uid}_glass_dolly`} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0%" stopColor="#F472B6" stopOpacity="0.9" />
          <Stop offset="38%" stopColor="#7C3AED" stopOpacity="0.82" />
          <Stop offset="74%" stopColor="#1E3A8A" stopOpacity="0.92" />
          <Stop offset="100%" stopColor="#090D16" />
        </LinearGradient>

        {/* 4) 아나모픽 시네마: 시안-코발트 실린더리컬 코팅 */}
        <LinearGradient id={`${uid}_glass_ana`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.92" />
          <Stop offset="45%" stopColor="#0369A1" stopOpacity="0.88" />
          <Stop offset="85%" stopColor="#0F172A" stopOpacity="0.96" />
          <Stop offset="100%" stopColor="#020617" />
        </LinearGradient>
      </Defs>

      {/* 바닥 접지 그림자 */}
      <Ellipse cx="45" cy="65" rx="34" ry="3.2" fill="#020617" opacity="0.65" />

      {/* ─── A. 표준 광학 렌즈 (자이스 Batis / Sonnar 3/4 측면 원통 데포르메) ─── */}
      {id === 'standard' && (
        <G>
          {/* 1) 가장 오른쪽 금속 베이요넷 플랜지 */}
          <Ellipse cx="78.5" cy="35" rx="3.2" ry="11.5" fill="#94A3B8" stroke="#475569" strokeWidth="0.7" />
          {/* 2) 후면 E-마운트 실린더 */}
          <Path
            d="M66 20.5 L77.5 20.5 A3.5 14.5 0 0 1 77.5 49.5 L66 49.5 Z"
            fill={`url(#${uid}_mount)`}
            stroke={accentBorder}
            strokeWidth="0.8"
          />
          {/* 마운트 장착 기준 흰색 점 + E-mount 각인 */}
          <Circle cx="73.5" cy="31" r="1.3" fill="#F8FAFC" />
          <Line x1="73.5" y1="34.5" x2="73.5" y2="43.5" stroke="#94A3B8" strokeWidth="1" strokeDasharray="1.2 1.2" />

          {/* 3) 후면 테이퍼드 콘 (경통 -> 마운트 연결 사다리꼴) */}
          <Path
            d="M57 13 L66.5 20.5 L66.5 49.5 L57 57 Z"
            fill={`url(#${uid}_barrel)`}
            stroke={accentBorder}
            strokeWidth="0.8"
          />

          {/* 4) 메인 경통 바디 + 조리개/거리계 링 (x: 34 ~ 57) */}
          <Rect
            x="33.5"
            y="13"
            width="24"
            height="44"
            fill={`url(#${uid}_barrel)`}
            stroke={accentBorder}
            strokeWidth="0.8"
          />
          {/* 조리개 링 미세 널링 & 눈금 (x: 50 ~ 56) */}
          <Line x1="50" y1="13" x2="50" y2="57" stroke="#334155" strokeWidth="0.8" />
          {ribYs.map((ry, i) => (
            <Line
              key={`ap_${i}`}
              x1="51.5"
              y1={ry}
              x2="55.8"
              y2={ry}
              stroke={ry < 30 ? '#64748B' : '#1E293B'}
              strokeWidth="0.9"
            />
          ))}
          {/* 조리개 숫자 각인 (4 · 8 · 16 · A) */}
          <SvgText x="47.2" y="22" fill="#E2E8F0" fontSize="3.8" fontWeight="700" textAnchor="middle">4</SvgText>
          <SvgText x="47.2" y="29" fill="#E2E8F0" fontSize="3.8" fontWeight="700" textAnchor="middle">8</SvgText>
          <SvgText x="47.2" y="36" fill="#E2E8F0" fontSize="3.8" fontWeight="700" textAnchor="middle">16</SvgText>
          <SvgText x="47.2" y="43" fill="#EF4444" fontSize="4" fontWeight="800" textAnchor="middle">A</SvgText>

          {/* 중앙 블루 스퀘어 브랜드 배지 (자이스 스타일) */}
          <Rect x="38" y="30" width="6.5" height="6.5" rx="0.8" fill="#1D4ED8" stroke="#60A5FA" strokeWidth="0.5" />
          <Line x1="39.2" y1="33.2" x2="43.3" y2="33.2" stroke="#FFFFFF" strokeWidth="1.1" />

          {/* AF | MF 슬라이드 스위치 */}
          <Rect x="36.8" y="42.5" width="9" height="4.2" rx="1" fill="#090D16" stroke="#475569" strokeWidth="0.6" />
          <Line x1="41.2" y1="42.8" x2="41.2" y2="46.4" stroke="#E2E8F0" strokeWidth="1.1" />

          {/* 5) 넓은 널링 포커스 링 (x: 16 ~ 34) */}
          <Rect
            x="16"
            y="12"
            width="18"
            height="46"
            rx="1"
            fill={`url(#${uid}_grip)`}
            stroke={accentBorder}
            strokeWidth={selected ? 1.2 : 0.8}
          />
          {ribYs.map((ry, i) => (
            <Line
              key={`rib_${i}`}
              x1="17.5"
              y1={ry}
              x2="32.8"
              y2={ry}
              stroke={ry >= 19 && ry <= 28 ? '#64748B' : ry < 38 ? '#334155' : '#090D16'}
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          ))}

          {/* 6) 3/4 타원형 전면 경통 테두리 & 볼록 대물렌즈 유리 */}
          <Ellipse
            cx="16"
            cy="35"
            rx="8.8"
            ry="23"
            fill="#0F172A"
            stroke={selected ? '#38BDF8' : '#64748B'}
            strokeWidth={selected ? 1.5 : 1}
          />
          {/* 내측 단차 필터 나사산 베젤 */}
          <Ellipse cx="15.6" cy="35" rx="7.2" ry="19.8" fill="#090D16" stroke="#334155" strokeWidth="0.9" />
          {/* T* 레드 각인 & Φ72 각인 */}
          <Circle cx="11.2" cy="24" r="0.9" fill="#EF4444" />
          <Line x1="10.8" y1="44" x2="11.6" y2="47.5" stroke="#94A3B8" strokeWidth="0.9" />
          {/* 볼록하게 튀어나온 대물렌즈 알 (웜 앰버/로즈 코팅) */}
          <Ellipse cx="17.2" cy="35" rx="5.4" ry="15.2" fill={`url(#${uid}_glass_std)`} stroke="#475569" strokeWidth="0.7" />
          {/* 렌즈 내부 경통 반사 아크 & 하이라이트 */}
          <Path d="M16.5 22 A3.8 12 0 0 1 16.5 48" fill="none" stroke="#FEF3C7" strokeWidth="1.1" opacity="0.55" />
          <Ellipse cx="15.2" cy="28" rx="1.6" ry="5.2" fill="#FFFFFF" opacity="0.45" />
        </G>
      )}

      {/* ─── B. 샤임플러그 틸트-시프트 렌즈 (전면 경통이 아래로 꺾인 TS-E 구조 + 황동 노브) ─── */}
      {id === 'scheimpflug' && (
        <G>
          {/* 후면 마운트 & 고정 베이스 경통 (우측) */}
          <Ellipse cx="78.5" cy="36" rx="3" ry="11" fill="#94A3B8" stroke="#475569" strokeWidth="0.7" />
          <Path d="M67 22 L77.5 22 A3 14 0 0 1 77.5 50 L67 50 Z" fill={`url(#${uid}_mount)`} stroke={accentBorder} strokeWidth="0.8" />
          <Circle cx="73.5" cy="32" r="1.2" fill="#EF4444" />
          <Path d="M58 15 L67 22 L67 50 L58 57 Z" fill={`url(#${uid}_barrel)`} stroke={accentBorder} strokeWidth="0.8" />
          <Rect x="45" y="15" width="13.5" height="42" fill={`url(#${uid}_barrel)`} stroke={accentBorder} strokeWidth="0.8" />

          {/* 시프트/틸트 회전 아크 가이드 레일 & ±° 눈금 */}
          <Path d="M41 16 A24 24 0 0 0 41 56" fill="none" stroke="#F59E0B" strokeWidth="1.6" strokeDasharray="2 1.8" />

          {/* 상단·하단 돌출 황동(Brass) 틸트/시프트 조절 노브 */}
          <Rect x="41" y="6.5" width="8.5" height="6.5" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="0.9" />
          <Line x1="43" y1="7" x2="43" y2="12.5" stroke="#FEF3C7" strokeWidth="0.8" />
          <Line x1="45.5" y1="7" x2="45.5" y2="12.5" stroke="#78350F" strokeWidth="0.8" />
          <Line x1="47.5" y1="7" x2="47.5" y2="12.5" stroke="#78350F" strokeWidth="0.8" />
          <Rect x="42" y="57.5" width="7" height="5" rx="1.2" fill="#D97706" stroke="#78350F" strokeWidth="0.8" />

          {/* 전면 경통 블록 전체가 -10도 아래로 틸트(꺾임)된 모습 */}
          <G transform="rotate(-10 42 36)">
            <Rect x="16" y="13" width="26" height="44" rx="1" fill={`url(#${uid}_grip)`} stroke={accentBorder} strokeWidth="0.9" />
            {/* TS-E 레드 링 밴드 */}
            <Line x1="20.5" y1="13" x2="20.5" y2="57" stroke="#EF4444" strokeWidth="1.6" />
            {/* 포커스 링 널링 */}
            {ribYs.slice(1, -1).map((ry, i) => (
              <Line
                key={`ts_rib_${i}`}
                x1="23"
                y1={ry}
                x2="35"
                y2={ry}
                stroke={ry < 30 ? '#64748B' : '#1E293B'}
                strokeWidth="1.15"
              />
            ))}
            {/* 틸트 각도 배지 */}
            <Rect x="36.5" y="29" width="5" height="11" rx="0.8" fill="#090D16" stroke="#F59E0B" strokeWidth="0.6" />
            {/* 3/4 전면 타원 베젤 & 에메랄드-시안 코팅 볼록 렌즈 */}
            <Ellipse cx="16" cy="35" rx="8.2" ry="22" fill="#0F172A" stroke={selected ? '#38BDF8' : '#F59E0B'} strokeWidth="1.2" />
            <Ellipse cx="15.8" cy="35" rx="6.6" ry="18.6" fill="#090D16" stroke="#334155" strokeWidth="0.8" />
            <Ellipse cx="17.2" cy="35" rx="5.0" ry="14.5" fill={`url(#${uid}_glass_ts)`} />
            <Ellipse cx="15.4" cy="28" rx="1.5" ry="4.8" fill="#FFFFFF" opacity="0.5" />
          </G>
        </G>
      )}

      {/* ─── C. 공간 원근 압축 돌리 렌즈 (2단 신축 망원 줌 경통 + 대구경 전면 유리) ─── */}
      {id === 'dolly' && (
        <G>
          {/* 후면 마운트 */}
          <Ellipse cx="80" cy="35" rx="2.8" ry="10.5" fill="#94A3B8" stroke="#475569" strokeWidth="0.7" />
          <Path d="M70 21.5 L79 21.5 A2.8 13.5 0 0 1 79 48.5 L70 48.5 Z" fill={`url(#${uid}_mount)`} stroke={accentBorder} strokeWidth="0.8" />
          <Circle cx="75.5" cy="31" r="1.2" fill="#F8FAFC" />

          {/* 망원 백색/실버 후면 경통 섹션 (70-200mm L / GM 망원 줌 특유의 투톤 배럴) */}
          <Path d="M63 15.5 L70 21.5 L70 48.5 L63 54.5 Z" fill={`url(#${uid}_tele_white)`} stroke="#64748B" strokeWidth="0.8" />
          <Rect x="44" y="15.5" width="19.5" height="39" fill={`url(#${uid}_tele_white)`} stroke="#64748B" strokeWidth="0.8" />
          {/* 후면 줌 링 (다크 그립) */}
          <Rect x="48" y="15.5" width="10" height="39" fill={`url(#${uid}_grip)`} stroke="#334155" strokeWidth="0.7" />
          {ribYs.slice(1, -1).map((ry, i) => (
            <Line key={`z_rib_${i}`} x1="49.2" y1={ry} x2="56.8" y2={ry} stroke={ry < 30 ? '#64748B' : '#1E293B'} strokeWidth="1.05" />
          ))}
          {/* 오렌지/골드 텔레컨버터 링 띠 */}
          <Line x1="44.5" y1="15.5" x2="44.5" y2="54.5" stroke="#F97316" strokeWidth="1.8" />

          {/* 앞으로 길게 뻗어 나온 2단 신축 이너 배럴 + 대구경 전면 경통 */}
          <Rect x="32" y="17.5" width="12" height="35" fill={`url(#${uid}_barrel)`} stroke={accentBorder} strokeWidth="0.8" />
          {/* 신축 화살표 각인 */}
          <Path d="M35 25 L41 25 M35 25 L37 23.2 M41 25 L39 23.2" stroke="#38BDF8" strokeWidth="1.1" strokeLinecap="round" />

          {/* 대구경 전면 포커스 배럴 (x: 14 ~ 32, 위아래로 더 굵은 대구경) */}
          <Path d="M15 11 L32 14.5 L32 55.5 L15 59 Z" fill={`url(#${uid}_grip)`} stroke={accentBorder} strokeWidth="0.9" />
          {ribYs.map((ry, i) => (
            <Line key={`f_rib_${i}`} x1="17.5" y1={ry} x2="29.5" y2={ry} stroke={ry < 29 ? '#64748B' : '#090D16'} strokeWidth="1.15" />
          ))}

          {/* 대구경 3/4 타원 전면 대물렌즈 (마젠타-바이올렛 코팅) */}
          <Ellipse cx="15" cy="35" rx="8.8" ry="24" fill="#0F172A" stroke={selected ? '#38BDF8' : '#FB923C'} strokeWidth="1.2" />
          <Ellipse cx="14.8" cy="35" rx="7.2" ry="20.5" fill="#090D16" stroke="#334155" strokeWidth="0.8" />
          <Ellipse cx="16.4" cy="35" rx="5.5" ry="16" fill={`url(#${uid}_glass_dolly)`} />
          <Path d="M15.8 21 A4 13 0 0 1 15.8 49" fill="none" stroke="#FBCFE8" strokeWidth="1.1" opacity="0.6" />
          <Ellipse cx="14.5" cy="27.5" rx="1.6" ry="5.5" fill="#FFFFFF" opacity="0.48" />
        </G>
      )}

      {/* ─── D. 아나모픽 시네마 렌즈 (팔로우 포커스 기어 톱니 + 사각 매트박스 후드 + 수직 타원 실린더 유리) ─── */}
      {id === 'anamorphic' && (
        <G>
          {/* 후면 PL/E 시네마 마운트 */}
          <Ellipse cx="79" cy="35" rx="3" ry="11" fill="#94A3B8" stroke="#475569" strokeWidth="0.7" />
          <Path d="M67 21 L78 21 A3 14 0 0 1 78 49 L67 49 Z" fill={`url(#${uid}_mount)`} stroke={accentBorder} strokeWidth="0.8" />
          <Path d="M58 14 L67 21 L67 49 L58 56 Z" fill={`url(#${uid}_barrel)`} stroke={accentBorder} strokeWidth="0.8" />

          {/* 메인 시네마 경통 (x: 22 ~ 58) */}
          <Rect x="22" y="14" width="36" height="42" fill={`url(#${uid}_barrel)`} stroke={accentBorder} strokeWidth="0.8" />

          {/* 시네마 렌즈 특유의 0.8-Mod 팔로우 포커스 기어 링 2줄 (상·하단으로 톱니가 돌출!) */}
          <Rect x="27" y="11.5" width="8.5" height="47" rx="1" fill="#0F172A" stroke="#38BDF8" strokeWidth="0.9" />
          <Rect x="47" y="11.5" width="7" height="47" rx="1" fill="#0F172A" stroke="#38BDF8" strokeWidth="0.9" />
          {ribYs.map((ry, i) => (
            <G key={`cine_gear_${i}`}>
              <Line x1="27.8" y1={ry} x2="34.7" y2={ry} stroke={ry < 30 ? '#7DD3FC' : '#0284C7'} strokeWidth="1.2" />
              <Line x1="47.8" y1={ry} x2="53.2" y2={ry} stroke={ry < 30 ? '#7DD3FC' : '#0284C7'} strokeWidth="1.2" />
            </G>
          ))}

          {/* 2x ANAMORPHIC 시네마 블루 배지 */}
          <Rect x="37.5" y="29" width="7.5" height="12" rx="1" fill="#0284C7" stroke="#7DD3FC" strokeWidth="0.6" />
          <SvgText x="41.2" y="36.8" fill="#FFFFFF" fontSize="4.8" fontWeight="800" textAnchor="middle">2×</SvgText>

          {/* 전면 3/4 사각 시네마 후드 + 아나모픽 수직 타원형 실린더 전면 유리 */}
          <Path
            d="M10 15 L22 12 L22 58 L10 55 Z"
            fill="#090D16"
            stroke={selected ? '#38BDF8' : '#64748B'}
            strokeWidth={selected ? 1.4 : 1}
          />
          <Ellipse cx="16" cy="35" rx="6.2" ry="20.5" fill="#020617" stroke="#334155" strokeWidth="0.9" />
          {/* 아나모픽 수직 실린더리컬 볼록 유리 */}
          <Ellipse cx="17" cy="35" rx="4.6" ry="16.5" fill={`url(#${uid}_glass_ana)`} stroke="#38BDF8" strokeWidth="0.7" />
          {/* 가로 블루 스트릭 플레어 광선 */}
          <Line x1="7" y1="35" x2="27" y2="35" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
          <Line x1="10" y1="35" x2="24" y2="35" stroke="#E0F2FE" strokeWidth="1" strokeLinecap="round" />
          <Circle cx="16.5" cy="35" r="2.1" fill="#FFFFFF" />
        </G>
      )}
    </Svg>
  );
};

/**
 * 2. 전면 원형 광학 필터 일러스트 — 3/4 비스듬히 세운 입체 금속 필터 링 + 유리 너머 데포르메 산·숲·호수 투과 뷰
 * (사용자가 첨부한 UV / CPL / FLD 참고 이미지처럼 왼쪽 널링 금속 옆면 두께와 텍스트 각인이 보이고,
 *  원형 유리 안에는 필터별 광학 효과가 적용된 기하 도형 풍경이 비칩니다.)
 */
export const CircularFilterArtwork: React.FC<{
  id: FrontFilterId;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 66, selected = false }) => {
  const uid = `flt3d_${id}`;
  const ringBorder = selected ? '#38BDF8' : '#64748B';

  // 필터별 왼쪽 베젤 각인 텍스트 & 포인트 컬러
  const bezelMeta: Record<FrontFilterId, { tag: string; accent: string }> = {
    gnd: { tag: 'GND', accent: '#F59E0B' },
    cpl: { tag: 'CPL', accent: '#38BDF8' },
    nd1000: { tag: 'ND1K', accent: '#F43F5E' },
    dehaze: { tag: 'HAZE', accent: '#38BDF8' },
    astroClear: { tag: 'FLD', accent: '#A855F7' },
    proMist: { tag: 'MIST', accent: '#FBBF24' },
    ghostClean: { tag: 'NANO', accent: '#10B981' },
  };
  const meta = bezelMeta[id];

  // 왼쪽 금속 옆면 널링(Knurling) 홈 Y 좌표
  const knurlYs = [14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53];

  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        {/* 3/4 타원형 유리창 클립 영역 */}
        <ClipPath id={`${uid}_glass_clip`}>
          <Ellipse cx="38" cy="34" rx="19.5" ry="23.2" />
        </ClipPath>

        {/* 금속 필터 옆면(두께) 그라데이션 */}
        <LinearGradient id={`${uid}_side_metal`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#334155" />
          <Stop offset="30%" stopColor="#475569" />
          <Stop offset="70%" stopColor="#0F172A" />
          <Stop offset="100%" stopColor="#020617" />
        </LinearGradient>

        {/* 금속 필터 전면 베젤 그라데이션 */}
        <LinearGradient id={`${uid}_front_bezel`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#334155" />
          <Stop offset="45%" stopColor="#1E293B" />
          <Stop offset="85%" stopColor="#090D16" />
          <Stop offset="100%" stopColor="#334155" />
        </LinearGradient>

        {/* 1) GND 상단 앰버-스모크 감광 코팅 */}
        <LinearGradient id={`${uid}_gnd_coat`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#1E1B4B" stopOpacity="0.92" />
          <Stop offset="50%" stopColor="#B45309" stopOpacity="0.85" />
          <Stop offset="88%" stopColor="#F59E0B" stopOpacity="0.55" />
          <Stop offset="100%" stopColor="#FEF3C7" stopOpacity="0.05" />
        </LinearGradient>

        {/* 2) CPL 편광 딥 블루 하늘 + 에메랄드 호수 */}
        <LinearGradient id={`${uid}_cpl_sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#1E3A8A" />
          <Stop offset="60%" stopColor="#0284C7" />
          <Stop offset="100%" stopColor="#38BDF8" />
        </LinearGradient>
        <LinearGradient id={`${uid}_cpl_lake`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0D9488" />
          <Stop offset="55%" stopColor="#047857" />
          <Stop offset="100%" stopColor="#064E3B" />
        </LinearGradient>

        {/* 3) ND1000 10스톱 스모크-루비 하늘 & 실크 호수 */}
        <LinearGradient id={`${uid}_nd_sky`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1E1B4B" />
          <Stop offset="55%" stopColor="#4C1D95" />
          <Stop offset="100%" stopColor="#881337" />
        </LinearGradient>

        {/* 4) Dehaze 산수화 하늘 */}
        <LinearGradient id={`${uid}_dehaze_sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0284C7" />
          <Stop offset="65%" stopColor="#7DD3FC" />
          <Stop offset="100%" stopColor="#E2E8F0" />
        </LinearGradient>

        {/* 5) Astro-Clear / FLD 네오디뮴 바이올렛-퍼플 유리 */}
        <LinearGradient id={`${uid}_fld_sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#2E1065" />
          <Stop offset="55%" stopColor="#6D28D9" />
          <Stop offset="100%" stopColor="#C084FC" />
        </LinearGradient>

        {/* 6) Pro-Mist 웜 할레이션 유리 */}
        <RadialGradient id={`${uid}_mist_glow`} cx="52%" cy="38%" r="58%">
          <Stop offset="0%" stopColor="#FEF08A" />
          <Stop offset="38%" stopColor="#F59E0B" />
          <Stop offset="78%" stopColor="#1E293B" />
          <Stop offset="100%" stopColor="#0F172A" />
        </RadialGradient>

        {/* 7) Anti-Ghost 에메랄드 나노 코팅 */}
        <LinearGradient id={`${uid}_nano_sky`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#064E3B" />
          <Stop offset="50%" stopColor="#059669" />
          <Stop offset="100%" stopColor="#0F172A" />
        </LinearGradient>
      </Defs>

      {/* 1. 바닥 타원형 그림자 (필터가 세워져 있는 입체감) */}
      <Ellipse cx="36" cy="65.5" rx="21" ry="2.6" fill="#020617" opacity="0.65" />

      {/* 2. 3/4 왼쪽 금속 필터 링 옆면 두께 (cx=32.5) + 널링 홈 */}
      <Ellipse
        cx="32.5"
        cy="34"
        rx="24.2"
        ry="28.2"
        fill={`url(#${uid}_side_metal)`}
        stroke={ringBorder}
        strokeWidth={selected ? 1.4 : 0.9}
      />
      {knurlYs.map((ky, idx) => {
        const dy = (ky - 34) / 28.2;
        const xLeft = 32.5 - 24.2 * Math.sqrt(Math.max(0, 1 - dy * dy));
        return (
          <Line
            key={`kn_${idx}`}
            x1={xLeft + 0.6}
            y1={ky}
            x2={xLeft + 4.4}
            y2={ky}
            stroke={ky < 32 ? '#94A3B8' : '#1E293B'}
            strokeWidth="1.15"
            strokeLinecap="round"
          />
        );
      })}

      {/* 3. 3/4 전면 아노다이징 금속 필터 링 베젤 (cx=36.8) */}
      <Ellipse
        cx="36.8"
        cy="34"
        rx="23.8"
        ry="28.0"
        fill={`url(#${uid}_front_bezel)`}
        stroke={selected ? '#38BDF8' : '#475569'}
        strokeWidth={selected ? 1.5 : 1}
      />

      {/* 4. 내측 리테이너 단차 링 (오른쪽 안쪽 벽 두께가 입체적으로 보임) */}
      <Ellipse
        cx="37.6"
        cy="34"
        rx="20.6"
        ry="24.2"
        fill="#090D16"
        stroke={meta.accent}
        strokeWidth="0.9"
        strokeOpacity="0.8"
      />

      {/* 5. 필터 유리창 내부 — 필터별 광학 특성이 반영된 데포르메 산·나무·호수 풍경 */}
      <G clipPath={`url(#${uid}_glass_clip)`}>
        {/* ─── (1) GND: 밝은 노을 하늘 + 산봉우리 능선에 딱 맞춘 상단 감광 그라데이션 + 맑은 호수 반영 ─── */}
        {id === 'gnd' && (
          <G>
            {/* 기본 밝은 하늘 & 하단 에메랄드 호수 */}
            <Rect x="16" y="8" width="46" height="28" fill="#FDE68A" />
            <Rect x="16" y="36" width="46" height="24" fill="#0F766E" />
            {/* 태양 원반 */}
            <Circle cx="44" cy="22" r="5" fill="#FFFBEB" />
            {/* 데포르메 산봉우리 + 왼쪽 침엽수림 */}
            <Polygon points="24,36 37,20 48,36" fill="#1E293B" />
            <Polygon points="37,36 49,23 60,36" fill="#334155" />
            <Polygon points="18,36 22,25 26,36" fill="#064E3B" />
            <Polygon points="23,36 27,27 31,36" fill="#047857" />
            {/* 호수 물결 반영 (하단은 필터 감광 없이 밝고 선명) */}
            <Polygon points="24,36 37,49 48,36" fill="#134E4A" opacity="0.65" />
            <Line x1="22" y1="41" x2="54" y2="41" stroke="#5EEAD4" strokeWidth="1" opacity="0.55" />
            <Line x1="26" y1="46" x2="50" y2="46" stroke="#99F6E4" strokeWidth="0.9" opacity="0.45" />
            {/* ★ 산 능선 모양을 따라 덮이는 상단 Reverse GND 감광 유리층 */}
            <Path
              d="M16 8 L62 8 L62 36 L49 23 L42.5 30.5 L37 20 L24 36 L16 36 Z"
              fill={`url(#${uid}_gnd_coat)`}
            />
            {/* 능선 밀착 골드 커팅 가이드선 */}
            <Path
              d="M17 36 L24 36 L37 20 L42.5 30.5 L49 23 L60 36"
              fill="none"
              stroke="#FBBF24"
              strokeWidth="1.4"
              strokeDasharray="2.5 1.8"
            />
          </G>
        )}

        {/* ─── (2) CPL: 90° 편광 딥 블루 하늘 + 흰 구름 + 수면 반사가 제거된 투명 에메랄드 호수 (참고 이미지 중앙 CPL) ─── */}
        {id === 'cpl' && (
          <G>
            <Rect x="16" y="8" width="46" height="28" fill={`url(#${uid}_cpl_sky)`} />
            <Rect x="16" y="36" width="46" height="24" fill={`url(#${uid}_cpl_lake)`} />
            {/* 선명하게 살아난 흰 적운 구름 */}
            <Circle cx="33" cy="18" r="4.2" fill="#FFFFFF" opacity="0.95" />
            <Circle cx="39" cy="17" r="5.2" fill="#FFFFFF" />
            <Circle cx="45" cy="18.5" r="3.8" fill="#FFFFFF" opacity="0.92" />
            {/* 데포르메 바위산 & 왼쪽 소나무 숲 */}
            <Polygon points="26,36 39,20 51,36" fill="#0F172A" />
            <Polygon points="38,20 43,27 39,29 35,26" fill="#38BDF8" opacity="0.35" />
            <Polygon points="40,36 51,23 61,36" fill="#1E293B" />
            <Polygon points="18,36 22,23 26,36" fill="#064E3B" />
            <Polygon points="22.5,36 26.5,25 30.5,36" fill="#047857" />
            <Polygon points="27,36 30.5,27 34,36" fill="#059669" />
            {/* 수평선 물가 */}
            <Line x1="17" y1="36" x2="60" y2="36" stroke="#A7F3D0" strokeWidth="1" opacity="0.7" />
            {/* 편광으로 수면 반사가 걷힌 맑은 에메랄드 물속·산 반영 */}
            <Polygon points="26,36 39,50 51,36" fill="#022C22" opacity="0.55" />
            <Ellipse cx="38" cy="49" rx="11" ry="4.5" fill="#34D399" opacity="0.35" />
          </G>
        )}

        {/* ─── (3) ND1000: 10스톱 다크 글래스 + 상층풍 장노출 구름 스트릭 + 실크 호수 ─── */}
        {id === 'nd1000' && (
          <G>
            <Rect x="16" y="8" width="46" height="28" fill={`url(#${uid}_nd_sky)`} />
            <Rect x="16" y="36" width="46" height="24" fill="#1E1B4B" />
            {/* 바람 결을 따라 길게 뻗은 장노출 구름 궤적 */}
            <Line x1="20" y1="16" x2="55" y2="14" stroke="#F43F5E" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
            <Line x1="18" y1="21" x2="57" y2="19" stroke="#FB923C" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
            <Line x1="22" y1="26" x2="54" y2="24.5" stroke="#FDE047" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
            {/* 산 실루엣 */}
            <Polygon points="24,36 37,22 49,36" fill="#090D16" />
            <Polygon points="39,36 51,25 61,36" fill="#0F172A" />
            {/* 장노출로 매끈해진 실크 수면 그라데이션 */}
            <Line x1="19" y1="41" x2="57" y2="41" stroke="#F472B6" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
            <Line x1="22" y1="46" x2="54" y2="46" stroke="#FB923C" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
            <Line x1="26" y1="51" x2="50" y2="51" stroke="#A855F7" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
          </G>
        )}

        {/* ─── (4) Dehaze / 산수화: 3단 첩첩산중 능선 + 운무 레이어 + 수묵 호수 반영 ─── */}
        {id === 'dehaze' && (
          <G>
            <Rect x="16" y="8" width="46" height="30" fill={`url(#${uid}_dehaze_sky)`} />
            <Rect x="16" y="38" width="46" height="22" fill="#334155" />
            {/* 원경·중경·근경 3단 산 능선과 그 사이의 안개 띠 */}
            <Polygon points="17,31 31,18 44,29 55,19 62,28 62,38 17,38" fill="#64748B" />
            <Rect x="17" y="27.5" width="45" height="3.2" fill="#E2E8F0" opacity="0.65" />
            <Polygon points="17,35 28,24 41,33 52,23 62,33 62,38 17,38" fill="#334155" />
            <Rect x="17" y="32.5" width="45" height="2.8" fill="#F8FAFC" opacity="0.55" />
            <Polygon points="17,38 25,29 37,36 48,28 62,38" fill="#0F172A" />
            {/* 호수 수묵 반영 */}
            <Line x1="22" y1="43" x2="54" y2="43" stroke="#E2E8F0" strokeWidth="1.1" opacity="0.6" />
            <Line x1="25" y1="48" x2="51" y2="48" stroke="#94A3B8" strokeWidth="1" opacity="0.5" />
          </G>
        )}

        {/* ─── (5) Astro-Clear (FLD 네오디뮴 퍼플-바이올렛 유리 + 밤하늘 별 + 산과 호수 반영, 참고 이미지 우측 FLD) ─── */}
        {id === 'astroClear' && (
          <G>
            <Rect x="16" y="8" width="46" height="28" fill={`url(#${uid}_fld_sky)`} />
            <Rect x="16" y="36" width="46" height="24" fill="#1E1B4B" />
            {/* 광해가 차단된 보랏빛 밤하늘의 선명한 별들 */}
            <Circle cx="28" cy="16" r="1.3" fill="#FFFFFF" />
            <Circle cx="38" cy="13.5" r="1.5" fill="#E9D5FF" />
            <Circle cx="48" cy="17" r="1.4" fill="#38BDF8" />
            <Circle cx="33" cy="21" r="1.1" fill="#FFFFFF" />
            {/* 보랏빛 톤 산봉우리 & 침엽수림 */}
            <Polygon points="25,36 38,20 50,36" fill="#1E1B4B" />
            <Polygon points="39,36 51,22 61,36" fill="#311042" />
            <Polygon points="48,25 54,28 51,33" fill="#C084FC" opacity="0.35" />
            <Polygon points="18,36 22,24 26,36" fill="#0F172A" />
            <Polygon points="23,36 27,26 31,36" fill="#1E1B4B" />
            {/* 보랏빛 호수 반영 */}
            <Line x1="17" y1="36" x2="60" y2="36" stroke="#DDD6FE" strokeWidth="1" opacity="0.65" />
            <Polygon points="25,36 38,49 50,36" fill="#090D16" opacity="0.5" />
            <Ellipse cx="41" cy="48" rx="11" ry="5" fill="#A855F7" opacity="0.35" />
          </G>
        )}

        {/* ─── (6) Black Pro-Mist: 시네마 광원 할레이션 블룸 + 미세 디퓨전 입자 + 호수 윤슬 ─── */}
        {id === 'proMist' && (
          <G>
            <Rect x="16" y="8" width="46" height="52" fill={`url(#${uid}_mist_glow)`} />
            {/* 부드럽게 번지는 태양 할레이션 링 */}
            <Circle cx="40" cy="24" r="10.5" fill="#F59E0B" opacity="0.32" />
            <Circle cx="40" cy="24" r="5.5" fill="#FEF08A" opacity="0.92" />
            {/* 산 능선 & 숲 실루엣 */}
            <Polygon points="23,37 36,24 47,37" fill="#1E293B" opacity="0.88" />
            <Polygon points="38,37 50,26 61,37" fill="#0F172A" opacity="0.92" />
            {/* 호수 위 부드러운 할레이션 윤슬과 미스트 입자 */}
            <Ellipse cx="40" cy="43" rx="8" ry="2.2" fill="#FDE68A" opacity="0.65" />
            <Ellipse cx="40" cy="48" rx="5.5" ry="1.6" fill="#FBBF24" opacity="0.45" />
            <Circle cx="28" cy="18" r="0.9" fill="#FFFBEB" opacity="0.6" />
            <Circle cx="50" cy="19" r="0.8" fill="#FFFBEB" opacity="0.55" />
            <Circle cx="29" cy="45" r="0.8" fill="#FFFBEB" opacity="0.5" />
          </G>
        )}

        {/* ─── (7) Anti-Ghost: 에메랄드 나노 AR 코팅 유리 + 고스트 링 없는 깨끗한 역광 산·호수 ─── */}
        {id === 'ghostClean' && (
          <G>
            <Rect x="16" y="8" width="46" height="28" fill={`url(#${uid}_nano_sky)`} />
            <Rect x="16" y="36" width="46" height="24" fill="#064E3B" />
            {/* 플레어 없이 또렷한 태양 원반 */}
            <Circle cx="43" cy="20" r="4.8" fill="#FDE047" />
            <Polygon points="25,36 38,21 50,36" fill="#022C22" />
            <Polygon points="39,36 51,24 61,36" fill="#065F46" />
            {/* 나노 AR 코팅 특유의 에메랄드빛 대각선 반사 띠 */}
            <Polygon points="20,10 31,10 54,56 43,56" fill="#34D399" opacity="0.24" />
            <Line x1="18" y1="36" x2="60" y2="36" stroke="#6EE7B7" strokeWidth="1" opacity="0.7" />
          </G>
        )}

        {/* 모든 필터 유리 공통: 입체 유리창 왼쪽 위 대각선 광택 하이라이트 */}
        <Path
          d="M21 22 C25 14, 34 11, 43 13"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.32"
        />
      </G>

      {/* 6. 왼쪽 전면 베젤 위 흰색 레이저 각인 텍스트 (참고 이미지의 UV / CPL / FLD 52mm 위치) */}
      <SvgText
        x="15.4"
        y="32.5"
        fill="#F8FAFC"
        fontSize="4.1"
        fontWeight="800"
        textAnchor="middle"
        transform="rotate(-90 15.4 32.5)"
      >
        {meta.tag}
      </SvgText>
      <SvgText
        x="16.2"
        y="44.5"
        fill="#94A3B8"
        fontSize="3.2"
        fontWeight="700"
        textAnchor="middle"
        transform="rotate(-78 16.2 44.5)"
      >
        72mm
      </SvgText>
    </Svg>
  );
};

/**
 * 3. 흑백 광학 컬러 필터 디스크 (Red 25A, Orange 21, Yellow 8, Deep IR, Neutral) — 3/4 입체 컬러 유리 필터 링
 */
export const MonoFilterDiscSvg: React.FC<{
  id: MonochromeOpticalFilter;
  size?: number;
  active?: boolean;
}> = ({ id, size = 28, active = false }) => {
  const uid = `mono3d_${id}`;
  const colors: Record<MonochromeOpticalFilter, [string, string, string]> = {
    red25A: ['#EF4444', '#7F1D1D', '#FCA5A5'],
    orange21: ['#F97316', '#7C2D12', '#FDBA74'],
    yellow8: ['#FACC15', '#713F12', '#FEF08A'],
    deepSky: ['#9F1239', '#1E1B4B', '#FB7185'],
    neutral: ['#94A3B8', '#1E293B', '#E2E8F0'],
  };
  const [c1, c2, highlight] = colors[id];

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={highlight} />
          <Stop offset="45%" stopColor={c1} />
          <Stop offset="100%" stopColor={c2} />
        </LinearGradient>
      </Defs>
      {/* 바닥 그림자 */}
      <Ellipse cx="16" cy="29.5" rx="9" ry="1.3" fill="#020617" opacity="0.55" />
      {/* 3/4 옆면 금속 링 두께 */}
      <Ellipse
        cx="14.4"
        cy="15.5"
        rx="10.5"
        ry="12.5"
        fill="#1E293B"
        stroke={active ? '#38BDF8' : '#475569'}
        strokeWidth={active ? 1.4 : 0.9}
      />
      {/* 3/4 전면 금속 링 */}
      <Ellipse
        cx="16.8"
        cy="15.5"
        rx="10.5"
        ry="12.5"
        fill="#0F172A"
        stroke={active ? '#38BDF8' : '#64748B'}
        strokeWidth={active ? 1.5 : 1}
      />
      {/* 컬러 필터 유리 */}
      <Ellipse cx="17.2" cy="15.5" rx="8.2" ry="10.0" fill={`url(#${uid})`} />
      {/* 유리 반사 하이라이트 */}
      <Path d="M13 10 C15 7.5, 18.5 7, 21 8.5" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    </Svg>
  );
};

/**
 * 4. 필름 / 센서 촬영 백 제품 일러스트 — 3/4 입체 중형 필름 매거진 & 풀프레임 센서 모듈 데포르메
 */
export const FilmBackArtwork: React.FC<{
  id: FilmBackMode;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 66, selected = false }) => {
  const uid = `film3d_${id}`;
  const borderCol = selected ? '#38BDF8' : '#475569';

  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        <LinearGradient id={`${uid}_body`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#334155" />
          <Stop offset="45%" stopColor="#1E293B" />
          <Stop offset="100%" stopColor="#090D16" />
        </LinearGradient>

        <LinearGradient id={`${uid}_sunset`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#F97316" />
          <Stop offset="50%" stopColor="#E11D48" />
          <Stop offset="100%" stopColor="#581C87" />
        </LinearGradient>

        <LinearGradient id={`${uid}_mono`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#090D16" />
          <Stop offset="48%" stopColor="#64748B" />
          <Stop offset="100%" stopColor="#F8FAFC" />
        </LinearGradient>
      </Defs>

      {/* 바닥 접지 그림자 */}
      <Ellipse cx="36" cy="65.5" rx="24" ry="2.6" fill="#020617" opacity="0.6" />

      {/* 3/4 입체 센서 모듈 / 필름 백 뒷면 두께 블록 */}
      <Rect
        x="7"
        y="12"
        width="52"
        height="48"
        rx="8"
        fill="#0F172A"
        stroke={borderCol}
        strokeWidth="0.9"
      />
      {/* 전면 모듈 하우징 (우측으로 살짝 오프셋되어 3/4 두께감 표현) */}
      <Rect
        x="11"
        y="10"
        width="53"
        height="48"
        rx="8"
        fill={`url(#${uid}_body)`}
        stroke={borderCol}
        strokeWidth={selected ? 1.8 : 1.1}
      />
      {/* 모서리 금속 마운트 핀 */}
      <Circle cx="16.5" cy="15.5" r="1.3" fill="#94A3B8" />
      <Circle cx="58.5" cy="15.5" r="1.3" fill="#94A3B8" />
      <Circle cx="16.5" cy="52.5" r="1.3" fill="#94A3B8" />
      <Circle cx="58.5" cy="52.5" r="1.3" fill="#94A3B8" />

      {id === 'natural' && (
        <G>
          {/* 골드 접점 핀 + 풀프레임 CMOS 센서 유리 */}
          <Rect x="19" y="18" width="37" height="25" rx="2.5" fill="#064E3B" stroke="#10B981" strokeWidth="1.2" />
          <Line x1="31" y1="18" x2="31" y2="43" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="44" y1="18" x2="44" y2="43" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="19" y1="26" x2="56" y2="26" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="19" y1="35" x2="56" y2="35" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Polygon points="21,19.5 34,19.5 24,41.5 21,41.5" fill="#6EE7B7" opacity="0.25" />
          <SvgText x="37.5" y="52.5" fill="#A7F3D0" fontSize="5.6" fontWeight="800" textAnchor="middle">
            CMOS NATIVE
          </SvgText>
        </G>
      )}

      {id === 'sunsetWb' && (
        <G>
          <Rect x="19" y="18" width="37" height="25" rx="3" fill={`url(#${uid}_sunset)`} stroke="#FBBF24" strokeWidth="1.2" />
          <Circle cx="37.5" cy="29" r="6" fill="#FEF08A" opacity="0.92" />
          <Polygon points="19,43 29,34 39,39 48,33 56,43" fill="#1E1B4B" opacity="0.85" />
          <SvgText x="37.5" y="52.5" fill="#FBBF24" fontSize="5.5" fontWeight="800" textAnchor="middle">
            2800K LOCK
          </SvgText>
        </G>
      )}

      {id === 'monoZone' && (
        <G>
          <Rect x="18" y="18" width="29" height="24" rx="2.5" fill={`url(#${uid}_mono)`} stroke="#94A3B8" strokeWidth="1" />
          {/* 3/4 입체 Red 25A 필터 링이 센서 앞에 겹쳐진 모습 */}
          <Ellipse cx="48" cy="31" rx="8.5" ry="10.2" fill="#0F172A" stroke="#FCA5A5" strokeWidth="1.1" />
          <Ellipse cx="48.5" cy="31" rx="6.8" ry="8.2" fill="#DC2626" fillOpacity="0.9" />
          <SvgText x="48.5" y="33" fill="#FFFFFF" fontSize="5" fontWeight="800" textAnchor="middle">
            25A
          </SvgText>
          <SvgText x="37.5" y="52.5" fill="#E2E8F0" fontSize="5.5" fontWeight="800" textAnchor="middle">
            ZONE 0–X B&amp;W
          </SvgText>
        </G>
      )}

      {id === 'astroDual' && (
        <G>
          {/* 다중 노출 겹침 프레임 */}
          <Rect x="22" y="16" width="33" height="22" rx="2.5" fill="#0F172A" stroke="#475569" strokeWidth="0.9" />
          <Rect x="18" y="20" width="33" height="22" rx="2.5" fill="#1E1B4B" stroke="#38BDF8" strokeWidth="1.2" />
          <Circle cx="26" cy="26" r="1.3" fill="#FFFFFF" />
          <Circle cx="37" cy="25" r="1.5" fill="#38BDF8" />
          <Circle cx="44" cy="28" r="1.2" fill="#FDE68A" />
          <Polygon points="18,42 27,33 36,38 44,32 51,42" fill="#020617" stroke="#38BDF8" strokeWidth="0.8" />
          <SvgText x="37.5" y="52.5" fill="#38BDF8" fontSize="5.5" fontWeight="800" textAnchor="middle">
            DUAL STACK
          </SvgText>
        </G>
      )}

      {id === 'luckyTele' && (
        <G>
          <Rect x="19" y="18" width="37" height="25" rx="2.5" fill="#090D16" stroke="#F59E0B" strokeWidth="1.1" />
          <Circle cx="37.5" cy="30.5" r="8.5" fill="#FBBF24" opacity="0.92" />
          <Circle cx="40.5" cy="28" r="2" fill="#D97706" opacity="0.6" />
          <Circle cx="35" cy="33" r="1.5" fill="#D97706" opacity="0.6" />
          <Line x1="23" y1="30.5" x2="52" y2="30.5" stroke="#38BDF8" strokeWidth="0.8" strokeDasharray="2 2" />
          <Line x1="37.5" y1="19" x2="37.5" y2="42" stroke="#38BDF8" strokeWidth="0.8" strokeDasharray="2 2" />
          <SvgText x="37.5" y="52.5" fill="#FBBF24" fontSize="5.5" fontWeight="800" textAnchor="middle">
            2× DRIZZLE
          </SvgText>
        </G>
      )}

      {id === 'timeShift' && (
        <G>
          <Rect x="19" y="18" width="37" height="25" rx="2.5" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.1" />
          <Polygon points="19,18 41,18 33,43 19,43" fill="#F97316" opacity="0.75" />
          <Circle cx="27" cy="25" r="2.8" fill="#FEF08A" />
          <Circle cx="46" cy="24" r="1.3" fill="#FFFFFF" />
          <Circle cx="51" cy="28" r="1.1" fill="#38BDF8" />
          <Polygon points="19,43 29,33 38,38 48,32 56,43" fill="#020617" stroke="#4ADE80" strokeWidth="1" />
          <SvgText x="37.5" y="52.5" fill="#4ADE80" fontSize="5.5" fontWeight="800" textAnchor="middle">
            TIME-SHIFT
          </SvgText>
        </G>
      )}
    </Svg>
  );
};
