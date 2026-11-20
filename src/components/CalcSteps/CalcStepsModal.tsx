/**
 * CalcStepsModal.tsx — 계산 과정 보기 (docs/SANDBOX_MODE_PLAN.md 9 장, 목업 CalcSunrise).
 *
 * 결과 하나가 나온 단계들을 오늘의 숫자 그대로 펼칩니다. 주제는 "노을 점수가 나오기까지"(예보 → 주변 구름 지도 → 해 쪽 빛의 길 → 구름 종류 → 점수),
 * "해 뜨는 시각과 방향"(일출)과 "해 지는 시각과 방향"(일몰)입니다. 땅의 스카이라인(능선)이 해가 보이는 시각을 얼마나 늦추는지는
 * 일출·일몰의 세 번째 단계에 그림으로 나옵니다. 별 보기 조건과 구름 모양(층별 비율 · 두께 · 바람 · 종류)도 같은 틀입니다.
 *
 *  - `CalcStepsView`  : 내용(머리 · 주제 칩 · 단계 카드 · 아래 단추). 모달 없이도 그려져 하네스가 바로 붙입니다.
 *  - `CalcStepsModal` : 전체 화면 모달로 감싼 것.
 *
 * 값은 `utils/calcSteps.ts` 가 앱의 실제 계산(`terrainSun.ts`)에서 가져옵니다. 이 화면은 그리기만 합니다.
 * 스카이라인이 아직 없으면(지형 자료를 못 받음) 평평한 수평선으로 계산했다고 3 단계에 적습니다.
 */
import React, { useMemo, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { PressScale, Chip } from '../ui';
import { makeStyles } from '../../theme/useTheme';
import { mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { buildCloudShapeCards, buildStarCards, buildSunHorizonCards, buildSunsetScoreCards, type BuildCloudShapeArgs, type BuildStarArgs, type BuildSunsetScoreArgs, type SkyMap, type SkyPicture, type StepCard } from '../../utils/calcSteps';
import { skylineAngleDeg, type HorizonProfile } from '../../utils/horizon';

type Lang = 'ko' | 'en' | 'ja';
export type CalcTopic = 'score' | 'sunrise' | 'sunset' | 'stars' | 'cloud';

/** 노을 점수 단계의 입력 — 화면이 가진 예측·해 쪽으로 돌린 링을 그대로 받습니다. 없으면(예보가 아직 없음) 그렇다고 알립니다. */
export type CalcScoreInput = Pick<BuildSunsetScoreArgs, 'prediction' | 'ring' | 'time' | 'eventMs' | 'sunAzDeg' | 'kind'>;

interface ViewProps {
  language: Lang;
  /** 지금 보는 날짜·시각(그날의 일출·일몰을 풉니다) */
  date: Date;
  latitude: number;
  longitude: number;
  /** 부제의 장소 이름(없으면 좌표) */
  placeName?: string;
  topic: CalcTopic;
  onTopic: (t: CalcTopic) => void;
  /** 주제 칩으로 보일 주제(기본: 전부). 입력을 줄 수 없는 주제를 감출 때 씁니다 — 02 예보에서 여는 계산 과정은 별 보기를 뺍니다. */
  topics?: readonly CalcTopic[];
  /** 눈에서 본 땅 프로필(장면 핸들). 없거나 null 이면 평평한 수평선으로 계산합니다. */
  getHorizon?: () => HorizonProfile | null;
  /** "노을 점수" 주제의 입력. 없거나 null 이면 이 주제는 예보가 없다고 알립니다. */
  getScoreInput?: () => CalcScoreInput | null;
  /** "별 보기" 주제의 입력(별을 보는 시각 · 구름 · 해·달 · 빛 지도 · 연무 · 달 지는 시각). 없거나 null 이면 이 주제는 자료가 없다고 알립니다. */
  getStarArgs?: () => Omit<BuildStarArgs, 'language' | 'fmtTime'> | null;
  /** "구름 모양" 주제의 입력(장면이 그린 구름 · 층별 높이 · 바람). 없거나 null 이면 이 주제는 구름 그림이 아직 없다고 알립니다. */
  getCloudArgs?: () => Omit<BuildCloudShapeArgs, 'language'> | null;
  /** 앱의 판정 단어(좋음 · 훌륭함 …). 없으면 영어 판정 이름 그대로. */
  qualityWord?: (quality: string) => string;
  onBack: () => void;
  onOpenSandbox?: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 기기 시간대 시각(앱의 다른 목록과 같음) */
const fmtLocalTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const CalcStepsView: React.FC<ViewProps> = ({ language, date, latitude, longitude, placeName, topic, onTopic, topics, getHorizon, getScoreInput, getStarArgs, getCloudArgs, qualityWord, onBack, onOpenSandbox }) => {
  const styles = useStyles();
  const result = useMemo<{ title: string; cards: StepCard[]; footnote: string; eventLabel?: string | null } | null>(() => {
    if (topic === 'score') {
      const inp = getScoreInput?.() ?? null;
      return inp ? buildSunsetScoreCards({ ...inp, language, fmtTime: fmtLocalTime, qualityWord: qualityWord ?? ((q) => q) }) : null;
    }
    if (topic === 'stars') {
      const sa = getStarArgs?.() ?? null;
      return sa ? buildStarCards({ ...sa, language, fmtTime: fmtLocalTime }) : null;
    }
    if (topic === 'cloud') {
      const ca = getCloudArgs?.() ?? null;
      return ca ? buildCloudShapeCards({ ...ca, language }) : null;
    }
    const profile = getHorizon?.() ?? null;
    const skyline = profile ? (az: number) => { const v = skylineAngleDeg(profile, az); return v > -89 ? v : null; } : null;
    return buildSunHorizonCards({ kind: topic === 'sunrise' ? 'rise' : 'set', date, lat: latitude, lon: longitude, language, skyline, profile, fmtTime: fmtLocalTime });
  }, [topic, date, latitude, longitude, language, getHorizon, getScoreInput, getStarArgs, getCloudArgs, qualityWord]);

  const shows = (t: CalcTopic) => !topics || topics.includes(t);
  const dateText = `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  const sub = `${dateText}${result?.eventLabel ? ` ${result.eventLabel}` : ''} · ${placeName ?? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`}`;
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <PressScale onPress={onBack} accessibilityLabel={L3(language, '뒤로', 'Back', '戻る')} style={styles.backBtn}>
          <Text style={styles.backText}>{L3(language, '뒤로', 'Back', '戻る')}</Text>
        </PressScale>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>{result?.title ?? L3(language, '계산 과정', 'How it is computed', '計算の過程')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>
        </View>
      </View>
      <View style={styles.topics}>
        {shows('score') && <Chip label={L3(language, '노을 점수', 'Sunset score', '夕焼けスコア')} on={topic === 'score'} onPress={() => onTopic('score')} />}
        {shows('sunrise') && <Chip label={L3(language, '해 뜨는 시각', 'Sunrise', '日の出')} on={topic === 'sunrise'} onPress={() => onTopic('sunrise')} />}
        {shows('sunset') && <Chip label={L3(language, '해 지는 시각', 'Sunset', '日の入り')} on={topic === 'sunset'} onPress={() => onTopic('sunset')} />}
        {shows('stars') && <Chip label={L3(language, '별 보기', 'Stargazing', '星空')} on={topic === 'stars'} onPress={() => onTopic('stars')} />}
        {shows('cloud') && <Chip label={L3(language, '구름 모양', 'Cloud shapes', '雲の形')} on={topic === 'cloud'} onPress={() => onTopic('cloud')} />}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {result ? (
          <>
            {result.cards.map((c, i) => <StepCardView key={c.id} index={i + 1} card={c} language={language} />)}
            <Text style={styles.footnote}>{result.footnote}</Text>
          </>
        ) : (
          <Text style={styles.footnote}>
            {topic === 'score'
              ? L3(language, '이 시각의 예보가 아직 없어서 점수가 나온 단계를 보여 줄 수 없어요.', 'There is no forecast for this time yet, so the steps of the score cannot be shown.', 'この時刻の予報がまだないので、スコアが出た段階を表示できません。')
              : topic === 'stars'
                ? L3(language, '이 시각의 별 보기 조건을 셀 자료가 아직 없어요.', 'There is not enough data yet to work out stargazing conditions for this time.', 'この時刻の星空の条件を計算するデータがまだありません。')
                : topic === 'cloud'
                  ? L3(language, '이 시각의 구름 그림이 아직 없어서 구름 모양을 보여 줄 수 없어요.', 'There is no sky picture for this time yet, so the cloud shapes cannot be shown.', 'この時刻の空の絵がまだないため、雲の形を表示できません。')
                  : L3(language, '이 날 이 위치에서는 해가 뜨거나 지는 순간이 없어요(백야 또는 극야).', 'No sunrise or sunset here on this day (midnight sun or polar night).', 'この日この場所では日の出・日の入りがありません(白夜または極夜)。')}
          </Text>
        )}
        {onOpenSandbox && (
          <PressScale onPress={onOpenSandbox} accessibilityLabel={L3(language, '샌드박스에서 바꿔 보기', 'Try it in the sandbox', 'サンドボックスで変えてみる')} style={styles.sandboxBtn}>
            <Text style={styles.sandboxText}>{L3(language, '샌드박스에서 바꿔 보기', 'Try it in the sandbox', 'サンドボックスで変えてみる')}</Text>
          </PressScale>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const StepCardView: React.FC<{ index: number; card: StepCard; language: Lang }> = ({ index, card, language }) => {
  const styles = useStyles();
  if (card.shape === 'result') {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.num}>{index}</Text>
          <Text style={styles.cardTitleFlex}>{card.title}</Text>
          <Text style={styles.resultText}>{card.result}</Text>
        </View>
        {card.rows && card.rows.length > 0 && (
          <View style={[styles.rowsLine, styles.resultRows]}>
            {card.rows.map(r => <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>)}
          </View>
        )}
      </View>
    );
  }
  if (card.shape === 'metric') {
    const tone = card.tone === 'good' ? styles.toneGood : card.tone === 'warn' ? styles.toneWarn : card.tone === 'bad' ? styles.toneBad : card.tone === 'moon' ? styles.toneMoon : styles.tonePlain;
    return (
      <View style={[styles.card, card.key && styles.cardKey]}>
        <View style={styles.metricRow}>
          <Text style={styles.num}>{index}</Text>
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.note}>{card.note}</Text>
            {card.rows && card.rows.length > 0 && (
              <View style={styles.rowsLine}>
                {card.rows.map(r => <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>)}
              </View>
            )}
          </View>
          <Text style={[styles.metricValue, tone]}>{card.result}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.card, card.key && styles.cardKey]}>
      <View style={styles.cardRowTop}>
        <Text style={styles.num}>{index}</Text>
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          {card.shape === 'rows' && (
            <View style={styles.rowsLine}>
              {card.rows!.map(r => (
                <Text key={r.label} style={styles.rowText}>{r.label} {r.value}</Text>
              ))}
            </View>
          )}
          {card.shape === 'bar' && card.bar && (
            <View style={styles.barRow}>
              <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(0, Math.min(1, card.bar.value)) * 100}%` }]} /></View>
              <Text style={styles.barText}>{card.bar.display}</Text>
            </View>
          )}
          {card.shape === 'map' && card.map && <SkyMapView map={card.map} language={language} />}
          {card.shape === 'sky' && card.sky && <SkyPictureView sky={card.sky} language={language} />}
          <Text style={styles.note}>{card.note}</Text>
        </View>
      </View>
    </View>
  );
};

/** 스카이라인 단면: 윤곽 · 평평한 수평선(0°) · 해 둘(평평한 수평선 기준 / 실제로 보이는). 하늘 위에 그리므로 화면 모드와 상관없이 어둡습니다. */
const SkyPictureView: React.FC<{ sky: SkyPicture; language: Lang }> = ({ sky, language }) => {
  const W = 320, H = 96;
  const [az0, az1] = sky.azRange, [el0, el1] = sky.elRange;
  const x = (az: number) => ((az - az0) / (az1 - az0)) * W;
  const y = (el: number) => H - ((el - el0) / (el1 - el0)) * H;
  const ridge = sky.skyline.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const rPx = Math.max(4, (sky.sunRadiusDeg / (el1 - el0)) * H);
  const label = L3(language, '지평선 단면', 'Horizon section', '地平線の断面');
  const aria = `${label}: ${sky.caption ?? ''}`;
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={{ borderRadius: 6 }}>
      <Rect x={0} y={0} width={W} height={H} fill="#0F1625" />
      <Line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
      <Path d={`${ridge} L${W} ${H} L0 ${H} Z`} fill="#1D2A3D" />
      {sky.suns.map(s => (
        <React.Fragment key={s.kind}>
          <Circle cx={x(s.az)} cy={y(s.el)} r={rPx} fill={s.kind === 'visible' ? '#FBBF24' : 'none'} stroke="#FBBF24" strokeWidth={s.kind === 'visible' ? 0 : 1} strokeDasharray={s.kind === 'visible' ? undefined : '2 2'} />
          <SvgText x={Math.min(W - 34, Math.max(2, x(s.az) + rPx + 3))} y={y(s.el) + (s.kind === 'visible' ? -rPx - 2 : rPx + 10)} fill="#94A3B8" fontSize={9} fontFamily={mono}>{s.label}</SvgText>
        </React.Fragment>
      ))}
      <SvgText x={6} y={H - 6} fill="#94A3B8" fontSize={9} fontFamily={mono}>0°</SvgText>
      {sky.caption ? <SvgText x={W - 6} y={12} fill="#94A3B8" fontSize={9} fontFamily={mono} textAnchor="end">{sky.caption}</SvgText> : null}
    </Svg>
  );
};

/**
 * 주변 구름 지도(북쪽이 위): 관측점에서 본 방위·거리의 구름을 칸마다 원으로(구름이 많을수록 크고 진하게), 거리 고리와
 * 해 방향 점선을 함께. 거리는 √ 눈금이라 가까운 곳이 너무 좁아지지 않습니다. 하늘 위에 그리므로 화면 모드와 상관없이 어둡습니다.
 */
const SkyMapView: React.FC<{ map: SkyMap; language: Lang }> = ({ map, language }) => {
  const W = 320, H = 150, cx = W / 2, cy = H / 2, R = 62;
  const BG = '#0F1625';
  const pos = (distKm: number, azDeg: number): [number, number] => {
    const r = R * Math.sqrt(distKm / map.maxKm);
    const a = (azDeg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  const [sx, sy] = pos(map.maxKm, map.sunAzDeg);
  const aria = L3(language, '주변 구름 지도', 'Cloud map around you', '周りの雲の地図');
  // 해 쪽 이름표: 선 끝(바깥 고리)에서 구름 원 하나(최대 반지름 13)만큼 더 밖에 둡니다. 해가 거의 정북·정남이라 화면 위아래로 몰리면 구름과
  // 겹칠 수 있어 뒤를 배경색으로 칠합니다.
  const sunLabel = L3(language, '해 쪽', 'Sun', '太陽側');
  const sa = (map.sunAzDeg * Math.PI) / 180;
  const sunAnchor: 'start' | 'middle' | 'end' = Math.sin(sa) > 0.35 ? 'start' : Math.sin(sa) < -0.35 ? 'end' : 'middle';
  const sunLx = cx + (R + 17) * Math.sin(sa);
  const sunLy = Math.min(H - 5, Math.max(20, cy - (R + 14) * Math.cos(sa) + 3));
  const sunLabelW = [...sunLabel].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 9 : 5.4), 0) + 4;
  const sunLabelX = sunAnchor === 'start' ? sunLx - 2 : sunAnchor === 'end' ? sunLx - sunLabelW + 2 : sunLx - sunLabelW / 2;
  const labelRings: { km: number; y: number }[] = [];
  let lastLabelY = -Infinity;
  for (const km of map.ringsKm) {
    const y = cy + R * Math.sqrt(km / map.maxKm);
    if (y - lastLabelY >= 9) { labelRings.push({ km, y }); lastLabelY = y; }
  }
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={{ borderRadius: 6 }}>
      <Rect x={0} y={0} width={W} height={H} fill={BG} />
      {map.ringsKm.map(km => <Circle key={km} cx={cx} cy={cy} r={R * Math.sqrt(km / map.maxKm)} fill="none" stroke="rgba(255,255,255,0.12)" />)}
      {map.cells.map((c, i) => {
        const [x, y] = pos(c.distKm, c.azDeg);
        return <Circle key={i} cx={x} cy={y} r={4 + 9 * c.cover} fill={`rgba(226,232,240,${(0.10 + 0.55 * c.cover).toFixed(2)})`} />;
      })}
      <Line x1={cx} y1={cy} x2={sx} y2={sy} stroke="#F97316" strokeWidth={1.5} strokeDasharray="3 3" />
      <Circle cx={cx} cy={cy} r={3} fill="#38BDF8" />
      <Rect x={sunLabelX} y={sunLy - 9} width={sunLabelW} height={12} fill={BG} opacity={0.85} />
      <SvgText x={sunLx} y={sunLy} fill="#F97316" fontSize={9} fontFamily={mono} textAnchor={sunAnchor}>{sunLabel}</SvgText>
      <SvgText x={cx} y={11} fill="#94A3B8" fontSize={9} fontFamily={mono} textAnchor="middle">N</SvgText>
      {/* 거리 이름표: 남쪽 축(아래)의 각 고리 위에 놓고 뒤를 배경색으로 칠해 구름 위에서도 읽히게 합니다. 직전에 그린 이름표와 9 미만으로 붙는 고리는 건너뜁니다(글자 높이 8). */}
      {labelRings.map(({ km, y }) => {
        const w = String(km).length * 5 + 4;
        return (
          <React.Fragment key={`l${km}`}>
            <Rect x={cx - w / 2} y={y - 5} width={w} height={10} fill={BG} opacity={0.85} />
            <SvgText x={cx} y={y + 3} fill="#9AA8BA" fontSize={8} fontFamily={mono} textAnchor="middle">{km}</SvgText>
          </React.Fragment>
        );
      })}
      <SvgText x={W - 4} y={H - 5} fill="#778699" fontSize={8} fontFamily={mono} textAnchor="end">km</SvgText>
    </Svg>
  );
};

interface ModalProps extends Omit<ViewProps, 'topic' | 'onTopic' | 'onBack'> {
  visible: boolean;
  onClose: () => void;
  initialTopic?: CalcTopic;
}

/** 전체 화면 모달. 닫았다 다시 열면 `initialTopic` 으로 돌아갑니다. */
export const CalcStepsModal: React.FC<ModalProps> = ({ visible, onClose, initialTopic = 'sunrise', ...rest }) => {
  const [topic, setTopic] = useState<CalcTopic>(initialTopic);
  React.useEffect(() => { if (visible) setTopic(initialTopic); }, [visible, initialTopic]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <CalcStepsView {...rest} topic={topic} onTopic={setTopic} onBack={onClose} />
    </Modal>
  );
};

const useStyles = makeStyles((color) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: color.panel, borderBottomWidth: 1, borderBottomColor: color.border },
  backBtn: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.xs },
  backText: { fontSize: 13, color: color.text },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: color.text },
  subtitle: { fontFamily: mono, fontSize: 11, color: color.textDim },
  // 주제 칩이 다섯(구름 모양을 더하면서)이라 390 폭에서도 한 줄에 다 안 들어갑니다 — 잘리지 않고 다음 줄로 넘어가게.
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: color.panel },
  body: { padding: 12, gap: 8 },
  card: { backgroundColor: color.panel, borderRadius: 10, padding: 10 },
  cardKey: { borderWidth: 1, borderColor: color.accentLine },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardRowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardMain: { flex: 1, minWidth: 0, gap: 6 },
  num: { width: 14, fontFamily: mono, fontSize: 11, color: color.textMute },
  cardTitle: { fontSize: 13, fontWeight: '700', color: color.text },
  cardTitleFlex: { flex: 1, fontSize: 13, fontWeight: '700', color: color.text },
  rowsLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  rowText: { fontFamily: mono, fontSize: 11, color: color.text },
  resultRows: { marginTop: 6, marginLeft: 24 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.border, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  barText: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: color.text },
  note: { fontSize: 11, color: color.textDim },
  resultText: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: color.sun },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricValue: { fontFamily: mono, fontSize: 13, fontWeight: '700', textAlign: 'right', maxWidth: 96 },
  tonePlain: { color: color.text },
  toneGood: { color: color.success },
  toneWarn: { color: color.warning },
  toneBad: { color: color.danger },
  toneMoon: { color: color.moon },
  footnote: { fontSize: 11, color: color.textMute },
  sandboxBtn: { minHeight: 44, marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' },
  sandboxText: { fontSize: 13, fontWeight: '700', color: color.accent },
}));
