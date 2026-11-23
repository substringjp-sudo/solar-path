/**
 * LearnConceptCards.tsx — 원리 구역(④) 하단의 **원리 학습 5종 탭 · ? 용어 칩 4종 · 오늘의 하늘 공부**.
 *
 * 현재 관측지·시각의 기온/이슬점/구름/바람/달 수치가 있으면 그 값을 그림과 설명에 그대로 반영합니다.
 */
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { L3, type Language } from '../../utils/i18n';
import { mono, radius, space, type } from '../../theme/tokens';
import { makeStyles, useDataColors, useThemeColors } from '../../theme/useTheme';
import { PressScale } from '../ui';

export interface ConceptContext {
  lowPct?: number | null;
  midPct?: number | null;
  highPct?: number | null;
  windLowKmh?: number | null;
  windHighKmh?: number | null;
  t2mC?: number | null;
  td2mC?: number | null;
  visKm?: number | null;
  moonPct?: number | null;
  sunDeltaLabel?: string | null;
}

type TabKey = 'cloud' | 'path' | 'horizon' | 'fog' | 'moon';
type TermKey = 'vis' | 'dew' | 'layers' | 'twilight';

export const LearnConceptCards: React.FC<{
  language: Language;
  ctx?: ConceptContext;
  onOpenSky?: () => void;
}> = ({ language, ctx, onOpenSky }) => {
  const color = useThemeColors();
  const dataColor = useDataColors();
  const styles = useStyles();

  const [tab, setTab] = useState<TabKey>('cloud');
  const [term, setTerm] = useState<TermKey | null>(null);

  const tabs: Array<{ k: TabKey; label: string }> = [
    { k: 'cloud', label: L3(language, '구름 높이·운형', 'Cloud height', '雲の高さ') },
    { k: 'path', label: L3(language, '해 쪽 빛 통로', 'Light path', '光の通路') },
    { k: 'horizon', label: L3(language, '지평선·산능선', 'Horizon & ridge', '地平線・稜線') },
    { k: 'fog', label: L3(language, '안개·습도', 'Fog & dew', '霧・湿度') },
    { k: 'moon', label: L3(language, '달·광해·경계', 'Moon & dark', '月・光害') },
  ];

  const terms: Array<{ k: TermKey; label: string }> = [
    { k: 'vis', label: L3(language, '? 시정', '? Visibility', '? 視程') },
    { k: 'dew', label: L3(language, '? 이슬점', '? Dew point', '? 露点') },
    { k: 'layers', label: L3(language, '? 층별 구름', '? Cloud layers', '? 層別の雲') },
    { k: 'twilight', label: L3(language, '? 박명', '? Twilight', '? 薄明') },
  ];

  const t2m = ctx?.t2mC;
  const td2m = ctx?.td2mC;
  const spread = t2m != null && td2m != null ? t2m - td2m : null;

  const renderLessonSvg = () => {
    switch (tab) {
      case 'cloud':
        return (
          <View style={styles.panelBody}>
            <Svg width="100%" height={138} viewBox="0 0 320 138">
              <Rect width={320} height={138} rx={8} fill={color.panel} />
              {[
                { y: 26, ry: 5, text: L3(language, `9 km 권운 Ci ${ctx?.highPct != null ? `${Math.round(ctx.highPct)}%` : ''}`, `9 km Cirrus ${ctx?.highPct != null ? `${Math.round(ctx.highPct)}%` : ''}`, `9 km 巻雲`), op: 0.55, wind: ctx?.windHighKmh != null ? `${Math.round(ctx.windHighKmh)} km/h →` : '' },
                { y: 68, ry: 10, text: L3(language, `5 km 고층운 As ${ctx?.midPct != null ? `${Math.round(ctx.midPct)}%` : ''}`, `5 km Altostratus ${ctx?.midPct != null ? `${Math.round(ctx.midPct)}%` : ''}`, `5 km 高層雲`), op: 0.85, wind: '' },
                { y: 110, ry: 11, text: L3(language, `1.5 km 층적운 Sc ${ctx?.lowPct != null ? `${Math.round(ctx.lowPct)}%` : ''}`, `1.5 km Stratocumulus ${ctx?.lowPct != null ? `${Math.round(ctx.lowPct)}%` : ''}`, `1.5 km 層積雲`), op: 0.9, wind: ctx?.windLowKmh != null ? `${Math.round(ctx.windLowKmh)} km/h →` : '' },
              ].map((row, idx) => (
                <React.Fragment key={idx}>
                  {[-32, -8, 16, 40].map((dx, j) => (
                    <Ellipse key={j} cx={76 + dx} cy={row.y} rx={24} ry={row.ry} fill={color.cloud} opacity={row.op} />
                  ))}
                  <SvgText x={152} y={row.y + 4} fontSize={10.5} fontWeight="700" fill={color.text}>{row.text}</SvgText>
                  {!!row.wind && <SvgText x={310} y={row.y + 18} fontSize={9} fontFamily={mono} fill={color.textMute} textAnchor="end">{row.wind}</SvgText>}
                </React.Fragment>
              ))}
            </Svg>
            <Text style={styles.cap}>
              {L3(language,
                '높은 구름은 얼음 결정이라 얇게 붉어지고, 낮·중간 구름은 두꺼워 햇빛을 가립니다. 바람이 빠를수록 길게 늘어납니다.',
                'High ice clouds catch soft color while thicker low/mid decks block direct light. Stronger winds stretch clouds into bands.',
                '上層の氷晶雲は薄く染まり、低・中層雲は厚く光を遮ります。風が強いほど雲は長く伸びます。')}
            </Text>
            {onOpenSky && (
              <View style={styles.linkBox}>
                <Text style={styles.linkText}>
                  {L3(language, '3D 하늘에서 현재 구름 층과 반사 색 확인', 'Inspect cloud layers and glow in 3D Sky', '3D空で雲層と反射を確認')}
                </Text>
                <PressScale style={[styles.goPill, { borderColor: color.success }]} onPress={onOpenSky}>
                  <Text style={[styles.goText, { color: color.success }]}>{L3(language, '3D ▸', '3D ▸', '3D ▸')}</Text>
                </PressScale>
              </View>
            )}
          </View>
        );
      case 'path':
        return (
          <View style={styles.panelBody}>
            <Svg width="100%" height={138} viewBox="0 0 320 138">
              <Rect width={320} height={138} rx={8} fill={color.panel} />
              <Rect x={0} y={114} width={320} height={24} fill={color.textMute} opacity={0.3} />
              <Circle cx={28} cy={110} r={4} fill={color.text} />
              <SvgText x={28} y={131} fontSize={9.5} fontFamily={mono} fill={color.textDim} textAnchor="middle">{L3(language, '나', 'You', '自分')}</SvgText>
              <Path d="M12 46 Q45 36 86 44 Q126 35 162 46 L162 64 Q126 72 86 66 Q45 73 12 64 Z" fill={color.cloud} opacity={0.78} />
              <Path d="M238 46 Q272 38 310 46 L310 62 Q272 68 238 62 Z" fill={color.cloud} opacity={0.78} />
              <Circle cx={304} cy={92} r={8.5} fill={color.sun} />
              <Line x1={296} y1={92} x2={94} y2={66} stroke={dataColor.sunrise} strokeWidth={2} />
              <Line x1={296} y1={95} x2={68} y2={68} stroke={dataColor.sunrise} strokeWidth={2} />
              <Path d="M56 67 Q80 77 104 67 Z" fill={dataColor.qEpic} opacity={0.85} />
              <Line x1={182} y1={42} x2={224} y2={42} stroke={color.success} strokeWidth={2} />
              <SvgText x={203} y={35} fontSize={9.5} fill={color.success} textAnchor="middle" fontWeight="700">{L3(language, '구름 틈', 'Gap', '切れ間')}</SvgText>
              <SvgText x={80} y={89} fontSize={9.5} fill={dataColor.qEpic} textAnchor="middle" fontWeight="700">{L3(language, '밑면이 붉게', 'Red base', '雲底が赤く')}</SvgText>
            </Svg>
            <Text style={styles.cap}>
              {L3(language,
                '낮은 해가 멀리서 비출 때 150~300km 밖에 틈이 열려 있어야 내 머리 위 구름 밑면까지 붉은빛이 닿습니다.',
                'At low sun angles, a clear opening 150–300 km away lets red light strike cloud bases above you. Without a gap, clouds look flat grey.',
                '低い太陽の光が150〜300km先の切れ間を抜けると頭上の雲底が赤く染まります。隙間がないと灰色のままです。')}
            </Text>
          </View>
        );
      case 'horizon':
        return (
          <View style={styles.panelBody}>
            <Svg width="100%" height={138} viewBox="0 0 320 138">
              <Rect width={320} height={138} rx={8} fill="#18223C" />
              <Rect y={64} width={320} height={74} fill="#E58C6E" opacity={0.35} />
              <Path d="M0 138 L0 108 L26 98 L56 106 L86 82 L116 94 L148 76 L176 66 L208 86 L242 74 L276 94 L320 100 L320 138 Z" fill="#0D1320" />
              <Line x1={0} x2={320} y1={116} y2={116} stroke="#FFFFFF" strokeDasharray="4 3" opacity={0.75} />
              <Circle cx={222} cy={116} r={9.5} fill="none" stroke="#FFFFFF" strokeDasharray="3 2" />
              <Circle cx={176} cy={64} r={9.5} fill="#FBBF24" />
              <SvgText x={8} y={112} fontSize={9} fill="#E2E8F0">{L3(language, '평평한 수평선', 'Flat horizon', '平坦な地平線')}</SvgText>
              <SvgText x={190} y={56} fontSize={9.5} fill="#FDE68A">{L3(language, '실제 능선 기준 해', 'Sun on ridge', '稜線の太陽')}</SvgText>
            </Svg>
            <Text style={styles.cap}>
              {L3(language,
                `실제 산능선이 해를 가리면 일몰은 앞당겨지고 일출은 늦어집니다.${ctx?.sunDeltaLabel ? ` (${ctx.sunDeltaLabel})` : ''}`,
                `Terrain ridges hide low sunlight—making sunset earlier and sunrise later.${ctx?.sunDeltaLabel ? ` (${ctx.sunDeltaLabel})` : ''}`,
                `実際の山の稜線が太陽を遮ると日没は早まり、日の出は遅くなります。${ctx?.sunDeltaLabel ? `(${ctx.sunDeltaLabel})` : ''}`)}
            </Text>
            {onOpenSky && (
              <View style={styles.linkBox}>
                <Text style={styles.linkText}>
                  {L3(language, '3D 하늘에서 내 위치 지평선 능선 보기', 'View real DEM skyline in 3D Sky', '3D空で地形の稜線を見る')}
                </Text>
                <PressScale style={[styles.goPill, { borderColor: color.success }]} onPress={onOpenSky}>
                  <Text style={[styles.goText, { color: color.success }]}>{L3(language, '3D ▸', '3D ▸', '3D ▸')}</Text>
                </PressScale>
              </View>
            )}
          </View>
        );
      case 'fog': {
        const xTemp = t2m != null ? 180 + Math.min(90, Math.max(-70, (t2m - 10) * 5)) : 208;
        const xDew = td2m != null ? 180 + Math.min(90, Math.max(-70, (td2m - 10) * 5)) : 186;
        return (
          <View style={styles.panelBody}>
            <Svg width="100%" height={106} viewBox="0 0 320 106">
              <Rect width={320} height={106} rx={8} fill={color.panel} />
              <Line x1={28} x2={292} y1={48} y2={48} stroke={color.borderStrong} strokeWidth={8} strokeLinecap="round" />
              <Circle cx={xTemp} cy={48} r={7.5} fill={color.danger} />
              <Circle cx={Math.min(xTemp - 8, xDew)} cy={48} r={7.5} fill={color.accent} />
              <SvgText x={xTemp} y={32} fontSize={10} fontFamily={mono} fill={color.text} textAnchor="middle">
                {t2m != null ? `${L3(language, '기온', 'Temp', '気温')} ${t2m.toFixed(1)}` : L3(language, '기온', 'Temp', '気温')}
              </SvgText>
              <SvgText x={Math.min(xTemp - 8, xDew)} y={72} fontSize={10} fontFamily={mono} fill={color.textDim} textAnchor="middle">
                {td2m != null ? `${L3(language, '이슬점', 'Dew', '露点')} ${td2m.toFixed(1)}` : L3(language, '이슬점', 'Dew', '露点')}
              </SvgText>
              <SvgText x={160} y={96} fontSize={10} fill={color.textDim} textAnchor="middle">
                {L3(language, '차이 2°C 아래 → 안개 · 렌즈 결로 위험', 'Spread < 2°C → Fog & lens condensation', '差2°C以下 → 霧・レンズ結露に注意')}
              </SvgText>
            </Svg>
            <Text style={styles.cap}>
              {spread != null
                ? L3(language,
                  `현재 차이 ${spread.toFixed(1)}°C. 두 점 거리가 좁을수록 먼 풍경이 뿌옇고 야간 렌즈에 이슬이 맺히기 쉽습니다.`,
                  `Current spread ${spread.toFixed(1)}°C. Closer points mean haze and fast lens condensation at night.`,
                  `現在の差は${spread.toFixed(1)}°C。差が小さいほど遠くが霞み、夜間にレンズが結露しやすくなります。`)
                : L3(language,
                  '기온과 이슬점이 가까울수록 공기 중 물방울이 응결해 시정이 떨어지고 렌즈가 서립니다.',
                  'When air temperature nears dew point, moisture condenses—reducing clarity and fogging optics.',
                  '気温が露点に近づくほど水滴が凝結し、視界が悪くなってレンズも曇りやすくなります。')}
            </Text>
          </View>
        );
      }
      case 'moon':
      default:
        return (
          <View style={styles.panelBody}>
            <Svg width="100%" height={112} viewBox="0 0 320 112">
              <Rect width={320} height={112} rx={8} fill={color.panel} />
              <Circle cx={48} cy={46} r={22} fill={color.borderStrong} />
              <Path d="M48 24 A22 22 0 0 1 48 68 A16 22 0 0 1 48 24 Z" fill={color.sun} />
              <SvgText x={48} y={84} fontSize={9.5} fill={color.textDim} textAnchor="middle">
                {ctx?.moonPct != null ? `${L3(language, '달', 'Moon', '月')} ${ctx.moonPct}%` : L3(language, '달빛', 'Moon', '月')}
              </SvgText>
              {Array.from({ length: 9 }, (_, i) => (
                <Rect
                  key={i}
                  x={102 + i * 16}
                  y={38}
                  width={13}
                  height={14}
                  rx={3}
                  fill={i < 3 ? '#2c68cc' : i < 6 ? '#f0b93a' : '#ff7a63'}
                  opacity={i === 6 ? 1 : 0.45}
                />
              ))}
              <SvgText x={172} y={70} fontSize={9.5} fill={color.textDim} textAnchor="middle">
                {L3(language, '도심 광해 Bortle 척도', 'Bortle light pollution', '光害レベル')}
              </SvgText>
              <Circle cx={274} cy={48} r={24} fill="#1B2540" />
              <Path d="M274 24 A24 24 0 0 0 274 72 A10 24 0 0 1 274 24 Z" fill="#D9E6F8" />
              <SvgText x={274} y={88} fontSize={9.5} fill={color.textDim} textAnchor="middle">
                {L3(language, '낮·밤 경계', 'Terminator', '昼夜境界')}
              </SvgText>
            </Svg>
            <Text style={styles.cap}>
              {L3(language,
                '밝은 달과 도시 불빛, 해 진 뒤 남아있는 박명은 배경 하늘을 밝혀 어두운 별과 은하수를 가립니다.',
                'Moonlight, urban glow, and shallow twilight brighten sky background, washing out faint Milky Way stars.',
                '明るい月、街明かり、残る薄明は背景空を明るくし、淡い星や天の川を見えにくくします。')}
            </Text>
          </View>
        );
    }
  };

  const renderTermCard = (k: TermKey) => {
    let title = '';
    let svgEl: React.ReactNode = null;
    if (k === 'vis') {
      title = ctx?.visKm != null
        ? L3(language, `시정 ${ctx.visKm.toFixed(1)} km: 먼 산 능선이 보이는 거리`, `Visibility ${ctx.visKm.toFixed(1)} km: clarity range`, `視程 ${ctx.visKm.toFixed(1)} km`)
        : L3(language, '시정: 수평 방향으로 사물을 구분하는 거리', 'Visibility: horizontal transparency', '視程: 遠くが見える距離');
      svgEl = (
        <Svg width="100%" height={68} viewBox="0 0 300 68">
          <Rect width={300} height={68} rx={6} fill={color.panel} />
          {([[44, '10km'], [148, '20km'], [254, '40km']] as const).map(([px, lb], i) => (
            <React.Fragment key={lb}>
              <Path d={`M ${px - 22} 52 L ${px} ${34 - i * 6} L ${px + 22} 52 Z`} fill={color.textDim} opacity={0.6 - i * 0.16} />
              <SvgText x={px} y={63} fontSize={9} fill={color.textDim} textAnchor="middle">{lb}</SvgText>
            </React.Fragment>
          ))}
        </Svg>
      );
    } else if (k === 'dew') {
      title = L3(language, '기온과 이슬점이 가까울수록 안개 · 결로에 가까움', 'Closer temp and dew point means fog/dew risk', '気温と露点が近いほど霧や結露になりやすい');
      svgEl = (
        <Svg width="100%" height={66} viewBox="0 0 300 66">
          <Rect width={300} height={66} rx={6} fill={color.panel} />
          <Line x1={24} x2={276} y1={34} y2={34} stroke={color.borderStrong} strokeWidth={6} strokeLinecap="round" />
          <Circle cx={196} cy={34} r={7} fill={color.danger} />
          <Circle cx={166} cy={34} r={7} fill={color.accent} />
          <SvgText x={196} y={20} fontSize={9.5} fontFamily={mono} fill={color.text} textAnchor="middle">
            {t2m != null ? `${t2m.toFixed(1)}°` : L3(language, '기온', 'Temp', '気温')}
          </SvgText>
          <SvgText x={166} y={56} fontSize={9.5} fontFamily={mono} fill={color.textDim} textAnchor="middle">
            {td2m != null ? `${td2m.toFixed(1)}°` : L3(language, '이슬점', 'Dew', '露点')}
          </SvgText>
        </Svg>
      );
    } else if (k === 'layers') {
      title = L3(language, '높이마다 구름의 광학적 역할이 다름', 'Different altitudes play different optical roles', '高度ごとに雲の光学的な役割が異なる');
      svgEl = (
        <Svg width="100%" height={68} viewBox="0 0 300 68">
          <Rect width={300} height={68} rx={6} fill={color.panel} />
          {[
            { y: 15, label: L3(language, '높은 구름: 얇아서 붉게 물듦', 'High: thin screen for red glow', '高層: 薄く赤く染まりやすい'), op: 0.35 },
            { y: 35, label: L3(language, '중간 구름: 두꺼우면 빛 차단', 'Mid: blocks sunlight when dense', '中層: 厚いと太陽光を遮断'), op: 0.6 },
            { y: 55, label: L3(language, '낮은 구름: 지평선 자체를 가림', 'Low: hides low horizon & Sun', '下層: 地平線そのものを隠す'), op: 0.85 },
          ].map(r => (
            <React.Fragment key={r.y}>
              <Ellipse cx={24} cy={r.y} rx={12} ry={5} fill={color.cloud} opacity={r.op} />
              <SvgText x={44} y={r.y + 3.5} fontSize={10} fill={color.text}>{r.label}</SvgText>
            </React.Fragment>
          ))}
        </Svg>
      );
    } else {
      title = L3(language, '해 진 뒤 어두워지는 박명 3단계', '3 twilight stages after sunset', '日没後に暗くなる薄明の3段階');
      svgEl = (
        <Svg width="100%" height={68} viewBox="0 0 300 68">
          <Rect width={300} height={68} rx={6} fill={color.panel} />
          {[
            { x: 10, c: '#9D6A86', t: L3(language, '시민 −6°', 'Civil -6°', '市民 -6°') },
            { x: 104, c: '#4C4A7C', t: L3(language, '항해 −12°', 'Nautical -12°', '航海 -12°') },
            { x: 198, c: '#1B2145', t: L3(language, '천문 −18°', 'Astro -18°', '天文 -18°') },
          ].map(p => (
            <React.Fragment key={p.t}>
              <Rect x={p.x} y={12} width={88} height={24} rx={4} fill={p.c} />
              <SvgText x={p.x + 44} y={28} fontSize={9.5} fontFamily={mono} fill="#FFFFFF" textAnchor="middle">{p.t}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={150} y={56} fontSize={9.5} fill={color.textDim} textAnchor="middle">
            {L3(language, '−6° 아래 밝은 별 · −18° 아래 은하수', 'Stars below -6° · Milky Way below -18°', '-6°以下で星・-18°以下で天の川')}
          </SvgText>
        </Svg>
      );
    }
    return (
      <View style={styles.glCard}>
        <Text style={styles.glTitle}>{title}</Text>
        {svgEl}
      </View>
    );
  };

  // 오늘의 하늘 공부 문구: 실시간 이슬점 차이 or 구름 분포 기반
  const studyHeadline = spread != null && spread <= 2.5
    ? L3(language, '습도가 높고 이슬점이 가까울 때 주의점', 'Watching humidity & dew spread today', '湿度が高く露点が近い時の注意点')
    : L3(language, '습도가 높으면 노을이 탁한 이유', 'Why high humidity washes out sunset color', '湿度が高いと夕焼けが濁る理由');
  const studyBody = spread != null && spread <= 2.5
    ? L3(language,
      `현재 기온-이슬점 차이가 ${spread.toFixed(1)}°C로 좁습니다. 물방울이 빛을 흩뜨려 붉은빛이 약해지고 렌즈 결로가 생기기 쉬워 렌즈 히터·융을 챙기는 편이 좋습니다.`,
      `Temp–dew spread is only ${spread.toFixed(1)}°C right now, meaning hazy scattering and quick lens condensation—pack a lens cloth or warmer.`,
      `現在気温と露点の差が${spread.toFixed(1)}°Cと狭く、光の散乱やレンズの結露が起きやすいためレンズ拭きがあると安心です。`)
    : L3(language,
      '공기 중 습기가 많아지면 물방울이 빛을 사방으로 흩뜨려 붉은빛이 멀리 직진하지 못합니다. 기온과 이슬점 차이가 2°C 아래로 좁아지면 먼 풍경이 급격히 뿌옇게 보입니다.',
      'Moist air scatters sunlight evenly before red wavelengths can travel far across the horizon. When temperature approaches dew point (< 2°C spread), distance hazes over fast.',
      '空気が湿るほど水滴が光を四方へ散らし赤い光が遠くへ届きにくくなります。気温と露点の差が2°C以下になると遠景が急に霞みます。');

  return (
    <View style={styles.wrap}>
      {/* 원리 학습 5종 탭 */}
      <View style={styles.block}>
        <Text style={styles.secLabel}>{L3(language, '원리 학습 · 탭', 'Principles · Tap', '仕組み学習・タップ')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          {tabs.map(t => {
            const on = tab === t.k;
            return (
              <PressScale
                key={t.k}
                style={[styles.tabPill, on && { backgroundColor: color.success, borderColor: color.success }]}
                onPress={() => setTab(t.k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabPillText, on && { color: color.onAccent }]}>{t.label}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
        <View style={styles.panel}>{renderLessonSvg()}</View>
      </View>

      {/* 용어 4종 칩 */}
      <View style={styles.block}>
        <Text style={styles.secLabel}>{L3(language, '용어 · 탭', 'Glossary · Tap', '用語・タップ')}</Text>
        <View style={styles.termWrap}>
          {terms.map(tm => {
            const on = term === tm.k;
            return (
              <PressScale
                key={tm.k}
                style={[
                  styles.termChip,
                  { borderColor: color.success, backgroundColor: on ? color.success : color.fill },
                ]}
                onPress={() => setTerm(on ? null : tm.k)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.termText, { color: on ? color.onAccent : color.success }]}>{tm.label}</Text>
              </PressScale>
            );
          })}
        </View>
        {term && renderTermCard(term)}
      </View>

      {/* 오늘의 하늘 공부 */}
      <View style={[styles.studyBox, { borderColor: color.success }]}>
        <Text style={[styles.studyKicker, { color: color.success }]}>
          {L3(language, '오늘의 하늘 공부', "Today's sky note", '今日の空メモ')}
        </Text>
        <Text style={styles.studyTitle}>{studyHeadline}</Text>
        <Text style={styles.studyBody}>{studyBody}</Text>
      </View>
    </View>
  );
};

const useStyles = makeStyles((color) => ({
  wrap: { gap: space.md, marginTop: space.xs },
  block: { gap: space.xs + 2 },
  secLabel: { fontSize: 12, fontWeight: '700', color: color.textMute, letterSpacing: 0.4 },
  pillRow: { gap: 6, paddingVertical: 2 },
  tabPill: {
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.panel,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  tabPillText: { fontSize: 12, fontWeight: '700', color: color.textDim },
  panel: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.md },
  panelBody: { gap: space.sm },
  cap: { fontSize: 12, color: color.textDim, lineHeight: 18 },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.success,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: color.panel,
  },
  linkText: { flex: 1, fontSize: 12, color: color.text },
  goPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  goText: { fontSize: 11, fontWeight: '700' },

  termWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  termChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, minHeight: 32, justifyContent: 'center' },
  termText: { fontSize: 12, fontWeight: '700' },
  glCard: { backgroundColor: color.fill, borderRadius: radius.md, padding: space.md, gap: space.xs },
  glTitle: { ...type.bodyStrong, fontSize: 13, color: color.text },

  studyBox: {
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: color.fill,
    padding: space.md,
    gap: 4,
  },
  studyKicker: { fontSize: 11, fontWeight: '700' },
  studyTitle: { ...type.bodyStrong, fontSize: 14, color: color.text },
  studyBody: { ...type.body, color: color.textDim, lineHeight: 19 },
}));
