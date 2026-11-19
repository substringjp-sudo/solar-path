/**
 * CalcStepsModal.tsx — 계산 과정 보기 (docs/SANDBOX_MODE_PLAN.md 9 장, 목업 CalcSunrise).
 *
 * 결과 하나가 나온 단계들을 오늘의 숫자 그대로 펼칩니다. 처음 주제는 "해 뜨는 시각과 방향"(일출)과 "해 지는 시각과 방향"(일몰)이고,
 * 땅의 스카이라인(능선)이 해가 보이는 시각을 얼마나 늦추는지가 세 번째 단계에 그림으로 나옵니다.
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
import { buildSunHorizonCards, type SkyPicture, type StepCard } from '../../utils/calcSteps';
import { skylineAngleDeg, type HorizonProfile } from '../../utils/horizon';

type Lang = 'ko' | 'en' | 'ja';
export type CalcTopic = 'sunrise' | 'sunset';

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
  /** 눈에서 본 땅 프로필(장면 핸들). 없거나 null 이면 평평한 수평선으로 계산합니다. */
  getHorizon?: () => HorizonProfile | null;
  onBack: () => void;
  onOpenSandbox?: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 기기 시간대 시각(앱의 다른 목록과 같음) */
const fmtLocalTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const CalcStepsView: React.FC<ViewProps> = ({ language, date, latitude, longitude, placeName, topic, onTopic, getHorizon, onBack, onOpenSandbox }) => {
  const styles = useStyles();
  const result = useMemo(() => {
    const profile = getHorizon?.() ?? null;
    const skyline = profile ? (az: number) => { const v = skylineAngleDeg(profile, az); return v > -89 ? v : null; } : null;
    return buildSunHorizonCards({ kind: topic === 'sunrise' ? 'rise' : 'set', date, lat: latitude, lon: longitude, language, skyline, profile, fmtTime: fmtLocalTime });
  }, [topic, date, latitude, longitude, language, getHorizon]);

  const dateText = `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  const sub = `${dateText} · ${placeName ?? `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`}`;
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
        <Chip label={L3(language, '해 뜨는 시각', 'Sunrise', '日の出')} on={topic === 'sunrise'} onPress={() => onTopic('sunrise')} />
        <Chip label={L3(language, '해 지는 시각', 'Sunset', '日の入り')} on={topic === 'sunset'} onPress={() => onTopic('sunset')} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {result ? (
          <>
            {result.cards.map((c, i) => <StepCardView key={c.id} index={i + 1} card={c} language={language} />)}
            <Text style={styles.footnote}>{result.footnote}</Text>
          </>
        ) : (
          <Text style={styles.footnote}>
            {L3(language, '이 날 이 위치에서는 해가 뜨거나 지는 순간이 없어요(백야 또는 극야).', 'No sunrise or sunset here on this day (midnight sun or polar night).', 'この日この場所では日の出・日の入りがありません(白夜または極夜)。')}
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
      <View style={[styles.card, styles.cardRow]}>
        <Text style={styles.num}>{index}</Text>
        <Text style={styles.cardTitleFlex}>{card.title}</Text>
        <Text style={styles.resultText}>{card.result}</Text>
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
  topics: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: color.panel },
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
  note: { fontSize: 11, color: color.textDim },
  resultText: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: color.sun },
  footnote: { fontSize: 11, color: color.textMute },
  sandboxBtn: { minHeight: 44, marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' },
  sandboxText: { fontSize: 13, fontWeight: '700', color: color.accent },
}));
