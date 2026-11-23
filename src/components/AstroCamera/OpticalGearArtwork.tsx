/**
 * OpticalGearArtwork.tsx — 확장 렌즈 · 전면 광학 필터 · 필름/센서 백의 실제 제품 외형 SVG 일러스트.
 *
 * 텍스트 위주의 긴 설명 대신, 실제 카메라 장비(황동/아노다이징 메탈 필터 링, 코팅 유리 그라데이션,
 * 틸트-시프트 경통, 아나모픽 타원 배럴, 중형 필름 백/센서 모듈)를 직관적인 그래픽으로 보여줍니다.
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
 * 1. 확장 렌즈 마운트 제품 일러스트 (경통 · 전면 대물렌즈 코팅 · 특수 기구물)
 */
export const LensMountArtwork: React.FC<{
  id: OpticalLensMount;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 64, selected = false }) => {
  const uid = `lens_${id}`;
  const ringStroke = selected ? '#38BDF8' : '#475569';

  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        {/* 메탈 배럴 그라데이션 */}
        <LinearGradient id={`${uid}_metal`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#334155" />
          <Stop offset="45%" stopColor="#0F172A" />
          <Stop offset="100%" stopColor="#1E293B" />
        </LinearGradient>

        {/* 기본 멀티코팅 유리 */}
        <RadialGradient id={`${uid}_glass_std`} cx="38%" cy="35%" r="65%">
          <Stop offset="0%" stopColor="#38BDF8" stopOpacity="0.55" />
          <Stop offset="45%" stopColor="#0F172A" stopOpacity="0.92" />
          <Stop offset="85%" stopColor="#1E1B4B" stopOpacity="0.98" />
          <Stop offset="100%" stopColor="#020617" />
        </RadialGradient>

        {/* 샤임플러그 틸트-시프트 앰버/시안 코팅 */}
        <RadialGradient id={`${uid}_glass_ts`} cx="35%" cy="32%" r="68%">
          <Stop offset="0%" stopColor="#FBBF24" stopOpacity="0.65" />
          <Stop offset="45%" stopColor="#0284C7" stopOpacity="0.45" />
          <Stop offset="80%" stopColor="#090D16" stopOpacity="0.96" />
          <Stop offset="100%" stopColor="#020617" />
        </RadialGradient>

        {/* 돌리 줌 깊이 압축 다중 렌즈군 코팅 */}
        <RadialGradient id={`${uid}_glass_dolly`} cx="50%" cy="50%" r="60%">
          <Stop offset="0%" stopColor="#F97316" stopOpacity="0.7" />
          <Stop offset="38%" stopColor="#7C3AED" stopOpacity="0.55" />
          <Stop offset="75%" stopColor="#0F172A" stopOpacity="0.95" />
          <Stop offset="100%" stopColor="#020617" />
        </RadialGradient>

        {/* 아나모픽 시네마 블루 스트릭 코팅 */}
        <LinearGradient id={`${uid}_glass_ana`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#0284C7" stopOpacity="0.75" />
          <Stop offset="50%" stopColor="#0F172A" stopOpacity="0.95" />
          <Stop offset="100%" stopColor="#38BDF8" stopOpacity="0.6" />
        </LinearGradient>
      </Defs>

      {/* 외곽 널링(Knurling) 렌즈 경통 링 */}
      <Circle cx="36" cy="36" r="32" fill={`url(#${uid}_metal)`} stroke={ringStroke} strokeWidth={selected ? 2 : 1.2} />
      <Circle
        cx="36"
        cy="36"
        r="29.5"
        fill="none"
        stroke="#64748B"
        strokeWidth="1.2"
        strokeDasharray="2 2.5"
        opacity="0.55"
      />
      {/* 단차 내측 배럴 */}
      <Circle cx="36" cy="36" r="26" fill="#090D16" stroke="#334155" strokeWidth="1" />

      {id === 'standard' && (
        <G>
          {/* 대물 렌즈 유리 */}
          <Circle cx="36" cy="36" r="22" fill={`url(#${uid}_glass_std)`} stroke="#1E293B" strokeWidth="1" />
          {/* 조리개 날 (Aperture Blades) */}
          <Circle cx="36" cy="36" r="14" fill="none" stroke="#475569" strokeWidth="0.8" strokeDasharray="5 3" opacity="0.7" />
          <Circle cx="36" cy="36" r="8.5" fill="#020617" stroke="#38BDF8" strokeWidth="0.7" strokeOpacity="0.5" />
          {/* 렌즈 반사 하이라이트 */}
          <Ellipse cx="28" cy="27" rx="5.5" ry="2.6" transform="rotate(-32 28 27)" fill="#FFFFFF" opacity="0.35" />
          <Circle cx="43" cy="43" r="1.8" fill="#38BDF8" opacity="0.45" />
          <SvgText x="36" y="62.5" fill="#94A3B8" fontSize="5.5" fontWeight="700" textAnchor="middle">
            f/1.8 ASPH
          </SvgText>
        </G>
      )}

      {id === 'scheimpflug' && (
        <G>
          {/* 좌우 시프트/틸트 황동 노브 (PC-E 렌즈 특유의 기계식 노브) */}
          <Rect x="1.5" y="31" width="5" height="10" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="0.8" />
          <Rect x="65.5" y="31" width="5" height="10" rx="1.5" fill="#F59E0B" stroke="#78350F" strokeWidth="0.8" />
          {/* 대물 유리 */}
          <Circle cx="36" cy="36" r="22" fill={`url(#${uid}_glass_ts)`} stroke="#F59E0B" strokeWidth="0.9" strokeOpacity="0.7" />
          {/* 기울어진 초점 평면 + 샤임플러그 격자 */}
          <G transform="rotate(-16 36 36)">
            <Ellipse cx="36" cy="36" rx="19" ry="9.5" fill="none" stroke="#FBBF24" strokeWidth="1.4" />
            <Line x1="15" y1="36" x2="57" y2="36" stroke="#38BDF8" strokeWidth="1.2" strokeDasharray="3 2" />
          </G>
          {/* 수직 시프트 눈금 */}
          <Line x1="36" y1="15" x2="36" y2="57" stroke="#E2E8F0" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.6" />
          <Ellipse cx="27" cy="26" rx="4.5" ry="2" transform="rotate(-30 27 26)" fill="#FFFFFF" opacity="0.38" />
          <SvgText x="36" y="62.5" fill="#FBBF24" fontSize="5.3" fontWeight="700" textAnchor="middle">
            TS-E ±16°
          </SvgText>
        </G>
      )}

      {id === 'dolly' && (
        <G>
          <Circle cx="36" cy="36" r="22.5" fill={`url(#${uid}_glass_dolly)`} stroke="#A855F7" strokeWidth="0.9" strokeOpacity="0.6" />
          {/* 원근 압축 동심 다중 렌즈 터널 */}
          <Circle cx="36" cy="36" r="18" fill="none" stroke="#38BDF8" strokeWidth="0.9" opacity="0.55" />
          <Circle cx="36" cy="36" r="13" fill="none" stroke="#F97316" strokeWidth="1.1" opacity="0.75" />
          {/* 뒤쪽 산 능선과 거대하게 당겨진 해 실루엣 */}
          <Circle cx="36" cy="33" r="6.5" fill="#FB923C" opacity="0.88" />
          <Path d="M18 44 L28 36 L36 41 L45 34 L54 44 Z" fill="#090D16" stroke="#FDBA74" strokeWidth="0.8" />
          {/* 안쪽으로 모이는 압축 화살표 */}
          <Path d="M21 25 L27 30 M51 25 L45 30" stroke="#38BDF8" strokeWidth="1.3" strokeLinecap="round" />
          <Ellipse cx="28" cy="24" rx="4" ry="1.8" transform="rotate(-28 28 24)" fill="#FFFFFF" opacity="0.35" />
          <SvgText x="36" y="62.5" fill="#FB923C" fontSize="5.3" fontWeight="700" textAnchor="middle">
            Z-TELE 2.2×
          </SvgText>
        </G>
      )}

      {id === 'anamorphic' && (
        <G>
          <Circle cx="36" cy="36" r="22.5" fill={`url(#${uid}_glass_ana)`} stroke="#38BDF8" strokeWidth="1" />
          {/* 아나모픽 특유의 수직 타원형 실린더 렌즈 배럴과 2.39:1 매트 박스 */}
          <Rect x="17" y="25" width="38" height="22" rx="3" fill="#020617" stroke="#38BDF8" strokeWidth="1" strokeOpacity="0.75" />
          <Ellipse cx="36" cy="36" rx="7.5" ry="10.5" fill="#0F172A" stroke="#7DD3FC" strokeWidth="1.1" />
          {/* 시네마 수평 블루 스트릭 플레어 & 선스타 */}
          <Line x1="12" y1="36" x2="60" y2="36" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" opacity="0.95" />
          <Line x1="16" y1="36" x2="56" y2="36" stroke="#E0F2FE" strokeWidth="1" strokeLinecap="round" />
          <Circle cx="36" cy="36" r="2.8" fill="#FFFBEB" />
          <SvgText x="36" y="62.5" fill="#38BDF8" fontSize="5.3" fontWeight="700" textAnchor="middle">
            2.39:1 CINE
          </SvgText>
        </G>
      )}
    </Svg>
  );
};

/**
 * 2. 전면 원형 광학 필터 일러스트 (금속 필터 프레임 + 원 안의 실제 유리 그라데이션·색상·특성 시각화)
 */
export const CircularFilterArtwork: React.FC<{
  id: FrontFilterId;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 64, selected = false }) => {
  const uid = `flt_${id}`;
  const ringBorder = selected ? '#38BDF8' : '#475569';

  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        <ClipPath id={`${uid}_clip`}>
          <Circle cx="36" cy="36" r="23" />
        </ClipPath>

        {/* 금속 필터 테두리 */}
        <LinearGradient id={`${uid}_frame`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#334155" />
          <Stop offset="50%" stopColor="#0F172A" />
          <Stop offset="100%" stopColor="#1E293B" />
        </LinearGradient>

        {/* 1) GND: 상단 짙은 앰버/스모크 ND 그라데이션 → 능선 아래 투명 유리 */}
        <LinearGradient id={`${uid}_gnd_sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0F172A" stopOpacity="0.92" />
          <Stop offset="45%" stopColor="#B45309" stopOpacity="0.82" />
          <Stop offset="75%" stopColor="#F59E0B" stopOpacity="0.45" />
          <Stop offset="100%" stopColor="#FEF3C7" stopOpacity="0.1" />
        </LinearGradient>

        {/* 2) CPL: 90도 편광 딥 코발트 블루 ↔ 청록 그라데이션 */}
        <LinearGradient id={`${uid}_cpl`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1E3A8A" />
          <Stop offset="48%" stopColor="#0284C7" />
          <Stop offset="100%" stopColor="#06B6D4" />
        </LinearGradient>

        {/* 3) ND1000: 10스톱 짙은 스모크 루비 코팅 다크 글래스 */}
        <LinearGradient id={`${uid}_nd1000`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#090D16" />
          <Stop offset="55%" stopColor="#1E1B4B" />
          <Stop offset="100%" stopColor="#31102F" />
        </LinearGradient>

        {/* 4) Dehaze / 산수화: 청명한 하늘 블루 ↔ 첩첩산중 수묵 안개 그라데이션 */}
        <LinearGradient id={`${uid}_dehaze`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.85" />
          <Stop offset="50%" stopColor="#334155" stopOpacity="0.8" />
          <Stop offset="100%" stopColor="#94A3B8" stopOpacity="0.65" />
        </LinearGradient>

        {/* 5) Astro-Clear (Neodymium): 나트륨 황색광 차단 네오디뮴 바이올렛-블루 유리 */}
        <RadialGradient id={`${uid}_astro`} cx="40%" cy="38%" r="65%">
          <Stop offset="0%" stopColor="#818CF8" stopOpacity="0.85" />
          <Stop offset="55%" stopColor="#4338CA" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="#1E1B4B" stopOpacity="0.98" />
        </RadialGradient>

        {/* 6) Black Pro-Mist: 웜 할레이션 디퓨저 글래스 */}
        <RadialGradient id={`${uid}_promist`} cx="50%" cy="50%" r="55%">
          <Stop offset="0%" stopColor="#FDE68A" stopOpacity="0.95" />
          <Stop offset="35%" stopColor="#F59E0B" stopOpacity="0.55" />
          <Stop offset="75%" stopColor="#1E293B" stopOpacity="0.9" />
          <Stop offset="100%" stopColor="#0F172A" />
        </RadialGradient>

        {/* 7) Anti-Ghost: 에메랄드 나노 AR 멀티코팅 유리 */}
        <LinearGradient id={`${uid}_ghost`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#064E3B" />
          <Stop offset="50%" stopColor="#047857" stopOpacity="0.75" />
          <Stop offset="100%" stopColor="#0F172A" />
        </LinearGradient>
      </Defs>

      {/* 원형 필터 금속 링 + 나사산 널링 */}
      <Circle cx="36" cy="36" r="32" fill={`url(#${uid}_frame)`} stroke={ringBorder} strokeWidth={selected ? 2 : 1.2} />
      <Circle
        cx="36"
        cy="36"
        r="29.5"
        fill="none"
        stroke="#94A3B8"
        strokeWidth="1"
        strokeDasharray="1.8 2.4"
        opacity="0.45"
      />
      {/* 필터 내측 황동/티타늄 리테이너 링 */}
      <Circle
        cx="36"
        cy="36"
        r="24.2"
        fill="#020617"
        stroke={id === 'cpl' ? '#38BDF8' : id === 'gnd' ? '#F59E0B' : '#475569'}
        strokeWidth="1.1"
      />

      {/* 원형 필터 유리 내부 그래픽 */}
      <G clipPath={`url(#${uid}_clip)`}>
        {id === 'gnd' && (
          <G>
            {/* 베이스 투명 유리 */}
            <Rect x="12" y="12" width="48" height="48" fill="#1E293B" opacity="0.35" />
            {/* 산봉우리 능선 모양에 딱 맞춰 커팅된 상단 Reverse GND 감광 코팅 */}
            <Path
              d="M12 12 L60 12 L60 40 L49 30 L39 38 L27 26 L12 39 Z"
              fill={`url(#${uid}_gnd_sky)`}
            />
            {/* 능선 밀착 골드 경계선 */}
            <Path
              d="M12 39 L27 26 L39 38 L49 30 L60 40"
              fill="none"
              stroke="#FBBF24"
              strokeWidth="1.6"
              strokeDasharray="3 2"
            />
            {/* 하단 클리어 영역 표시 */}
            <SvgText x="36" y="51" fill="#E2E8F0" fontSize="6" fontWeight="700" textAnchor="middle" opacity="0.85">
              CLEAR
            </SvgText>
          </G>
        )}

        {id === 'cpl' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_cpl)`} />
            {/* 편광 격자 줄무늬 */}
            <G opacity="0.28" transform="rotate(-35 36 36)">
              <Line x1="14" y1="24" x2="58" y2="24" stroke="#E0F2FE" strokeWidth="1" />
              <Line x1="14" y1="30" x2="58" y2="30" stroke="#E0F2FE" strokeWidth="1" />
              <Line x1="14" y1="36" x2="58" y2="36" stroke="#E0F2FE" strokeWidth="1" />
              <Line x1="14" y1="42" x2="58" y2="42" stroke="#E0F2FE" strokeWidth="1" />
              <Line x1="14" y1="48" x2="58" y2="48" stroke="#E0F2FE" strokeWidth="1" />
            </G>
            {/* 구름 대비 심볼 */}
            <Circle cx="30" cy="37" r="5.5" fill="#FFFFFF" opacity="0.9" />
            <Circle cx="37" cy="35.5" r="7" fill="#FFFFFF" opacity="0.95" />
            <Circle cx="43.5" cy="37.5" r="5" fill="#FFFFFF" opacity="0.88" />
          </G>
        )}

        {id === 'nd1000' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_nd1000)`} />
            {/* 상층풍을 따라 실크처럼 흐르는 장노출 구름 스트릭 */}
            <Path
              d="M16 28 C26 26, 42 26, 56 24"
              stroke="#F43F5E"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.75"
            />
            <Path
              d="M14 35 C28 33, 44 33, 58 31"
              stroke="#FB923C"
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity="0.85"
            />
            <Path
              d="M18 42 C30 41, 45 40, 55 39"
              stroke="#FBBF24"
              strokeWidth="1.8"
              strokeLinecap="round"
              opacity="0.7"
            />
            <SvgText x="36" y="52" fill="#FDA4AF" fontSize="6.2" fontWeight="700" textAnchor="middle">
              ND1000 · 10 STOP
            </SvgText>
          </G>
        )}

        {id === 'dehaze' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_dehaze)`} />
            {/* 첩첩산중 3단 산 능선과 층별 안개 레이어 */}
            <Path d="M12 36 L24 27 L36 33 L48 25 L60 35 L60 60 L12 60 Z" fill="#475569" opacity="0.65" />
            <Path d="M12 43 L28 34 L41 40 L53 32 L60 39 L60 60 L12 60 Z" fill="#1E293B" opacity="0.82" />
            <Path d="M12 50 L23 42 L37 47 L49 40 L60 48 L60 60 L12 60 Z" fill="#090D16" opacity="0.95" />
            {/* 층 사이 운무 선 */}
            <Line x1="15" y1="36" x2="57" y2="36" stroke="#E2E8F0" strokeWidth="1.2" opacity="0.6" />
            <Line x1="15" y1="43" x2="57" y2="43" stroke="#E2E8F0" strokeWidth="1.2" opacity="0.5" />
          </G>
        )}

        {id === 'astroClear' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_astro)`} />
            {/* 하단 황색 나트륨 광해 차단 표시 + 상단 선명한 별 */}
            <Circle cx="27" cy="25" r="1.4" fill="#FFFFFF" />
            <Circle cx="44" cy="23" r="1.7" fill="#E0E7FF" />
            <Circle cx="36" cy="30" r="2.1" fill="#38BDF8" />
            <Circle cx="23" cy="35" r="1.1" fill="#C7D2FE" />
            <Circle cx="48" cy="34" r="1.3" fill="#FFFFFF" />
            {/* 589nm 나트륨 파장 노치 컷 파형 */}
            <Path
              d="M15 44 L29 44 L33 53 L36 39 L39 53 L43 44 L57 44"
              fill="none"
              stroke="#FBBF24"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </G>
        )}

        {id === 'proMist' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_promist)`} />
            {/* 블랙 프로미스트 특유의 미세 디퓨전 스펙클 입자들과 할레이션 광원 */}
            <Circle cx="36" cy="36" r="12" fill="#F59E0B" opacity="0.28" />
            <Circle cx="36" cy="36" r="6" fill="#FEF3C7" opacity="0.85" />
            <Circle cx="24" cy="26" r="0.9" fill="#FFFBEB" opacity="0.55" />
            <Circle cx="46" cy="27" r="0.8" fill="#FFFBEB" opacity="0.5" />
            <Circle cx="26" cy="45" r="0.8" fill="#FFFBEB" opacity="0.5" />
            <Circle cx="45" cy="44" r="1" fill="#FFFBEB" opacity="0.55" />
            <Circle cx="32" cy="22" r="0.7" fill="#FFFBEB" opacity="0.4" />
            <Circle cx="41" cy="49" r="0.7" fill="#FFFBEB" opacity="0.4" />
          </G>
        )}

        {id === 'ghostClean' && (
          <G>
            <Rect x="12" y="12" width="48" height="48" fill={`url(#${uid}_ghost)`} />
            {/* 광축 대칭 플레어/고스트 링 억제 그래픽 */}
            <Circle cx="27" cy="27" r="6" fill="#FBBF24" opacity="0.85" />
            <Circle cx="44" cy="44" r="6.5" fill="none" stroke="#34D399" strokeWidth="1.4" strokeDasharray="3 2" />
            <Line x1="39" y1="39" x2="49" y2="49" stroke="#F43F5E" strokeWidth="1.6" />
          </G>
        )}

        {/* 모든 유리 필터 공통 표면 반사 광택 */}
        <Ellipse
          cx="26"
          cy="23"
          rx="8"
          ry="3.2"
          transform="rotate(-32 26 23)"
          fill="#FFFFFF"
          opacity="0.26"
        />
      </G>

      {/* CPL 회전 베젤 마커 핀 */}
      {id === 'cpl' && (
        <Polygon points="36,3 33.5,8 38.5,8" fill="#38BDF8" />
      )}
    </Svg>
  );
};

/**
 * 3. 흑백 광학 컬러 필터 미니 원형 디스크 (Red 25A, Orange 21, Yellow 8, Deep IR, Neutral)
 */
export const MonoFilterDiscSvg: React.FC<{
  id: MonochromeOpticalFilter;
  size?: number;
  active?: boolean;
}> = ({ id, size = 22, active = false }) => {
  const uid = `mono_${id}`;
  const colors: Record<MonochromeOpticalFilter, [string, string, string]> = {
    red25A: ['#EF4444', '#991B1B', '#FCA5A5'],
    orange21: ['#F97316', '#9A3412', '#FDBA74'],
    yellow8: ['#FACC15', '#854D0E', '#FEF08A'],
    deepSky: ['#881337', '#1E1B4B', '#F43F5E'],
    neutral: ['#94A3B8', '#334155', '#E2E8F0'],
  };
  const [c1, c2, rim] = colors[id];

  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Defs>
        <RadialGradient id={uid} cx="35%" cy="32%" r="68%">
          <Stop offset="0%" stopColor={rim} />
          <Stop offset="45%" stopColor={c1} />
          <Stop offset="100%" stopColor={c2} />
        </RadialGradient>
      </Defs>
      <Circle
        cx="14"
        cy="14"
        r="12.5"
        fill="#0F172A"
        stroke={active ? '#38BDF8' : '#475569'}
        strokeWidth={active ? 2 : 1.2}
      />
      <Circle cx="14" cy="14" r="9.8" fill={`url(#${uid})`} />
      <Ellipse cx="11" cy="10.5" rx="3.2" ry="1.4" transform="rotate(-30 11 10.5)" fill="#FFFFFF" opacity="0.4" />
    </Svg>
  );
};

/**
 * 4. 필름 / 센서 촬영 백 제품 일러스트 (센서 모듈 · 스펙트럼 필터 · 다중 노출 매거진)
 */
export const FilmBackArtwork: React.FC<{
  id: FilmBackMode;
  size?: number;
  selected?: boolean;
}> = ({ id, size = 64, selected = false }) => {
  const uid = `film_${id}`;
  const borderCol = selected ? '#38BDF8' : '#475569';

  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        <LinearGradient id={`${uid}_body`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1E293B" />
          <Stop offset="100%" stopColor="#090D16" />
        </LinearGradient>

        <LinearGradient id={`${uid}_sunset`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#F97316" />
          <Stop offset="50%" stopColor="#E11D48" />
          <Stop offset="100%" stopColor="#7C2D12" />
        </LinearGradient>

        <LinearGradient id={`${uid}_mono`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#020617" />
          <Stop offset="45%" stopColor="#64748B" />
          <Stop offset="100%" stopColor="#F8FAFC" />
        </LinearGradient>
      </Defs>

      {/* 중형 카메라 디지털 백 / 필름 매거진 하우징 */}
      <Rect
        x="7"
        y="9"
        width="58"
        height="54"
        rx="10"
        fill={`url(#${uid}_body)`}
        stroke={borderCol}
        strokeWidth={selected ? 2 : 1.2}
      />
      {/* 모서리 마운트 나사 */}
      <Circle cx="13" cy="15" r="1.4" fill="#64748B" />
      <Circle cx="59" cy="15" r="1.4" fill="#64748B" />
      <Circle cx="13" cy="57" r="1.4" fill="#64748B" />
      <Circle cx="59" cy="57" r="1.4" fill="#64748B" />

      {id === 'natural' && (
        <G>
          {/* 풀프레임 CMOS 센서 + 베이어 배열 광택 */}
          <Rect x="16" y="18" width="40" height="28" rx="3" fill="#064E3B" stroke="#10B981" strokeWidth="1.2" />
          <Line x1="29" y1="18" x2="29" y2="46" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="43" y1="18" x2="43" y2="46" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="16" y1="27" x2="56" y2="27" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Line x1="16" y1="37" x2="56" y2="37" stroke="#34D399" strokeWidth="0.6" opacity="0.45" />
          <Path d="M18 20 L34 20 L22 44 L18 44 Z" fill="#34D399" opacity="0.22" />
          <SvgText x="36" y="56.5" fill="#94A3B8" fontSize="6" fontWeight="700" textAnchor="middle">
            CMOS STD
          </SvgText>
        </G>
      )}

      {id === 'sunsetWb' && (
        <G>
          {/* 물리 노을 스펙트럼 락 센서 창 */}
          <Rect x="16" y="18" width="40" height="28" rx="4" fill={`url(#${uid}_sunset)`} stroke="#FBBF24" strokeWidth="1.2" />
          <Circle cx="36" cy="31" r="7" fill="#FEF08A" opacity="0.92" />
          <Path d="M16 39 Q26 35 36 39 T56 38 L56 46 L16 46 Z" fill="#1E1B4B" opacity="0.78" />
          <SvgText x="36" y="56.5" fill="#FBBF24" fontSize="5.8" fontWeight="700" textAnchor="middle">
            2500K–3200K LOCK
          </SvgText>
        </G>
      )}

      {id === 'monoZone' && (
        <G>
          {/* Zone 0~X 흑백 계조 창 + Red 25A 광학 필터 겹침 */}
          <Rect x="15" y="18" width="32" height="26" rx="3" fill={`url(#${uid}_mono)`} stroke="#94A3B8" strokeWidth="1" />
          {/* Red 25A 원형 컬러 필터가 센서 앞에 겹쳐진 모습 */}
          <Circle cx="46" cy="33" r="11" fill="#DC2626" fillOpacity="0.88" stroke="#FCA5A5" strokeWidth="1.2" />
          <SvgText x="46" y="35" fill="#FFFFFF" fontSize="5.5" fontWeight="800" textAnchor="middle">
            25A
          </SvgText>
          <SvgText x="36" y="56.5" fill="#E2E8F0" fontSize="5.8" fontWeight="700" textAnchor="middle">
            ZONE 0–X B&amp;W
          </SvgText>
        </G>
      )}

      {id === 'astroDual' && (
        <G>
          {/* 지형 고정 + 별 적도의 회전 다중 프레임 스택 */}
          <Rect x="20" y="16" width="34" height="24" rx="3" fill="#0F172A" stroke="#475569" strokeWidth="0.9" />
          <Rect x="16" y="20" width="34" height="24" rx="3" fill="#1E1B4B" stroke="#38BDF8" strokeWidth="1.2" />
          {/* 별 점상 & 회전 궤도 화살표 */}
          <Circle cx="26" cy="27" r="1.4" fill="#FFFFFF" />
          <Circle cx="38" cy="26" r="1.6" fill="#38BDF8" />
          <Circle cx="33" cy="31" r="1.2" fill="#FDE68A" />
          <Path d="M16 40 L25 34 L34 38 L42 33 L50 40 L50 44 L16 44 Z" fill="#020617" stroke="#38BDF8" strokeWidth="0.8" />
          <SvgText x="36" y="56.5" fill="#38BDF8" fontSize="5.8" fontWeight="700" textAnchor="middle">
            IMU + STAR STACK
          </SvgText>
        </G>
      )}

      {id === 'luckyTele' && (
        <G>
          {/* 2x 서브픽셀 드리즐 격자 + 달/태양 림 선명화 */}
          <Rect x="16" y="18" width="40" height="28" rx="3" fill="#090D16" stroke="#F59E0B" strokeWidth="1.1" />
          <Circle cx="36" cy="32" r="9.5" fill="#FBBF24" opacity="0.9" />
          <Circle cx="39" cy="29" r="2.2" fill="#D97706" opacity="0.6" />
          <Circle cx="33" cy="35" r="1.6" fill="#D97706" opacity="0.6" />
          {/* 서브픽셀 크로스헤어 */}
          <Line x1="20" y1="32" x2="52" y2="32" stroke="#38BDF8" strokeWidth="0.8" strokeDasharray="2 2" />
          <Line x1="36" y1="20" x2="36" y2="44" stroke="#38BDF8" strokeWidth="0.8" strokeDasharray="2 2" />
          <SvgText x="36" y="56.5" fill="#FBBF24" fontSize="5.8" fontWeight="700" textAnchor="middle">
            2× DRIZZLE TELE
          </SvgText>
        </G>
      )}

      {id === 'timeShift' && (
        <G>
          {/* 좌측 블루아워 지형 + 우측 한밤중 밤하늘 대각선 합성 */}
          <Rect x="16" y="18" width="40" height="28" rx="3" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.1" />
          <Path d="M16 18 L40 18 L32 46 L16 46 Z" fill="#F97316" opacity="0.7" />
          <Circle cx="25" cy="26" r="3.2" fill="#FDE047" />
          <Circle cx="45" cy="25" r="1.4" fill="#FFFFFF" />
          <Circle cx="50" cy="30" r="1.2" fill="#38BDF8" />
          <Path d="M16 41 L27 34 L37 39 L47 33 L56 41 L56 46 L16 46 Z" fill="#020617" stroke="#4ADE80" strokeWidth="1" />
          <SvgText x="36" y="56.5" fill="#4ADE80" fontSize="5.8" fontWeight="700" textAnchor="middle">
            BLUE + NIGHT SYNC
          </SvgText>
        </G>
      )}
    </Svg>
  );
};
