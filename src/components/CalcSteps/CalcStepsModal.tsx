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
import { PressScale, Chip } from '../ui';
import { makeStyles } from '../../theme/useTheme';
import { mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { buildCloudShapeCards, buildStarCards, buildSunHorizonCards, buildSunsetScoreCards, type BuildCloudShapeArgs, type BuildStarArgs, type BuildSunsetScoreArgs, type StepCard } from '../../utils/calcSteps';
import { skylineAngleDeg, type HorizonProfile } from '../../utils/horizon';
import { StepCardView } from './StepCards';

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
  footnote: { fontSize: 11, color: color.textMute },
  sandboxBtn: { minHeight: 44, marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' },
  sandboxText: { fontSize: 13, fontWeight: '700', color: color.accent },
}));
