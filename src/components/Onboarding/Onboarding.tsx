/**
 * Onboarding.tsx — 처음 실행 안내 (docs/SANDBOX_MODE_PLAN.md 10.1 의 8번, 목업 Onboarding).
 *
 * 처음 실행할 때만(저장하는 `onboardingSeen`) 앱이 준비되는 대로 뜨고, 설정의 "안내 다시 보기"로 언제든 다시 엽니다.
 * 석 장입니다: ① 점수 하나로 노을을 알려 준다 ② 슬라이더로 시간을 옮긴다 ③ 촬영 버튼은 상황에 맞춰 권한다.
 * 한 번에 한 장을 크게 보이고, 아래에 아직 안 본 장을 작게 미리 보입니다. "건너뛰기"는 언제든, 마지막 장의 단추는 "시작하기".
 * 맨 아래의 "좋은 하늘이면 알려 주기"는 켜 두면 그대로 알림 설정에 반영됩니다(`onToggleGoodOnly`).
 *
 * 하늘 위에 떠 있는 화면이라 화면 모드와 상관없이 어둡습니다(노을 그림 + 어두운 막).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Line, Path, Rect, Stop } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import { color as DARK, dataColor, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';

type Lang = 'ko' | 'en' | 'ja';

/** 안내 장 수 */
export const GUIDE_STEPS = 3;

export interface OnboardingProps {
  visible: boolean;
  language: Lang;
  /** 좋은 하늘이면 알려 주기가 켜져 있는가 */
  goodOnly: boolean;
  onToggleGoodOnly: (next: boolean) => void;
  /** 마쳤거나 건너뜀 */
  onDone: () => void;
}

interface Step { title: string; sub: string }

const stepsOf = (lang: Lang): Step[] => [
  {
    title: L3(lang, '점수 하나로 오늘 노을을 알려 줘요', 'One score tells you about today\'s sunset', '点数ひとつで今日の夕焼けがわかります'),
    sub: '',
  },
  {
    title: L3(lang, '슬라이더로 시간을 옮겨 봐요', 'Slide through the day', 'スライダーで時間を動かしてみましょう'),
    sub: L3(lang, '그래프가 높은 곳이 좋은 시간이에요.', 'Where the graph is high, the sky is good.', 'グラフが高いところが良い時間です。'),
  },
  {
    title: L3(lang, '촬영 버튼은 상황에 맞춰 권해요', 'The shoot button suggests what fits', '撮影ボタンは状況に合わせて提案します'),
    sub: L3(lang, '밤에 맑으면 별 장노출을 권해요.', 'On a clear night it suggests a star long exposure.', '晴れた夜には星の長時間露光を提案します。'),
  },
];

export const Onboarding: React.FC<OnboardingProps> = ({ visible, language, goodOnly, onToggleGoodOnly, onDone }) => {
  const [step, setStep] = useState(0);
  useEffect(() => { if (visible) setStep(0); }, [visible]);
  const steps = stepsOf(language);
  const last = step >= GUIDE_STEPS - 1;
  const great = dataColor.qGreat;
  const next = () => { if (last) onDone(); else setStep(step + 1); };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={styles.root}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="62%" preserveAspectRatio="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Defs>
            <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#1b2a4a" />
              <Stop offset="0.5" stopColor="#3a3f6b" />
              <Stop offset="0.86" stopColor="#b8603a" />
              <Stop offset="0.96" stopColor="#f0a050" />
              <Stop offset="1" stopColor={DARK.bg} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#sky)" />
        </Svg>
        <View style={styles.scrim} />

        <SafeAreaView style={styles.safe}>
          <View style={styles.top}>
            <View style={styles.dots} accessibilityLabel={`${step + 1} / ${GUIDE_STEPS}`}>
              {Array.from({ length: GUIDE_STEPS }, (_, i) => <View key={i} style={[styles.dot, i === step && styles.dotOn]} />)}
            </View>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={L3(language, '건너뛰기', 'Skip', 'スキップ')} style={styles.skip}>
              <Text style={styles.skipText}>{L3(language, '건너뛰기', 'Skip', 'スキップ')}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.card}>
              <Text style={styles.count}>{step + 1} / {GUIDE_STEPS}</Text>
              <Text style={styles.title}>{steps[step].title}</Text>

              {step === 0 && (
                <>
                  <View style={styles.example}>
                    <View style={styles.exampleRow}>
                      <View style={styles.bars} accessibilityLabel={L3(language, '다섯 칸 중 네 칸', 'Four of five bars', '5マス中4マス')}>
                        {[0, 1, 2, 3, 4].map(i => <View key={i} style={[styles.bar, { backgroundColor: i < 4 ? great : DARK.border }]} />)}
                      </View>
                      <Text style={[styles.verdict, { color: great }]}>{L3(language, '좋음', 'Good', '良い')}</Text>
                      <Text style={styles.score}>72</Text>
                    </View>
                    <Text style={styles.exampleSub}>{L3(language, '가장 붉을 때 17:04 · 서쪽 하늘', 'Reddest at 17:04 · western sky', '最も赤い時刻 17:04 · 西の空')}</Text>
                  </View>
                  <Text style={styles.text}>
                    {L3(
                      language,
                      '칸이 많을수록 붉게 물들 가능성이 커요. 판정 아래 한 문장이 이유예요. 먼 날일수록 점수를 숨겨 실제보다 정확해 보이지 않게 해요.',
                      'More bars mean a better chance of a red sky. The sentence under the verdict is the reason. Scores for far-off days are hidden so they do not look more accurate than they are.',
                      'マスが多いほど赤く染まる可能性が高いです。判定の下の一文が理由です。遠い日ほど点数を隠し、実際より正確に見えないようにします。',
                    )}
                  </Text>
                </>
              )}

              {step === 1 && (
                <>
                  <View style={styles.example}>
                    <Svg width="100%" height={52} viewBox="0 0 300 52" preserveAspectRatio="none" accessibilityLabel={L3(language, '시간대별 점수 그래프', 'Score graph by hour', '時間帯別の点数グラフ')}>
                      <Path d="M0 46 L36 44 L72 42 L108 36 L144 40 L180 30 L210 10 L234 8 L252 22 L282 40 L300 44 L300 52 L0 52 Z" fill="rgba(249,115,22,0.22)" />
                      <Path d="M0 46 L36 44 L72 42 L108 36 L144 40 L180 30 L210 10 L234 8 L252 22 L282 40 L300 44" fill="none" stroke="#F97316" strokeWidth={1.5} />
                      <Line x1="196" y1="0" x2="196" y2="52" stroke={DARK.accent} strokeWidth={2} />
                    </Svg>
                  </View>
                  <Text style={styles.text}>{steps[1].sub}</Text>
                </>
              )}

              {step === 2 && (
                <>
                  <View style={[styles.example, styles.shootRow]}>
                    <Text style={styles.shootHint}>{L3(language, '맑은 밤', 'Clear night', '晴れた夜')}</Text>
                    <View style={styles.shootBtn}><Text style={styles.shootBtnText}>{L3(language, '촬영', 'Shoot', '撮影')}</Text></View>
                    <Text style={[styles.shootHint, { color: DARK.moon }]}>{L3(language, '별 장노출', 'Star long exposure', '星の長時間露光')}</Text>
                  </View>
                  <Text style={styles.text}>{steps[2].sub}</Text>
                </>
              )}
            </View>

            {!last && (
              <View style={styles.nextBox}>
                <Text style={styles.nextLabel}>{L3(language, '다음 카드', 'Up next', '次のカード')}</Text>
                <View style={styles.nextGrid}>
                  {steps.map((s, i) => (i > step ? (
                    <View key={i} style={styles.nextCard}>
                      <Text style={styles.nextCount}>{i + 1} / {GUIDE_STEPS}</Text>
                      <Text style={styles.nextTitle}>{s.title}</Text>
                      {!!s.sub && <Text style={styles.nextSub}>{s.sub}</Text>}
                    </View>
                  ) : null))}
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.bottom}>
            <Pressable
              onPress={() => onToggleGoodOnly(!goodOnly)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: goodOnly }}
              accessibilityLabel={L3(language, '좋은 하늘이면 알려 주기', 'Notify me when the sky is good', '良い空なら知らせる')}
              style={styles.checkRow}
            >
              <View style={[styles.box, goodOnly && styles.boxOn]}>{goodOnly && <Check size={14} color={DARK.onAccent} />}</View>
              <Text style={styles.checkText}>{L3(language, '좋은 하늘이면 알려 주기', 'Notify me when the sky is good', '良い空なら知らせる')}</Text>
            </Pressable>
            <Pressable onPress={next} accessibilityRole="button" accessibilityLabel={last ? L3(language, '시작하기', 'Get started', 'はじめる') : L3(language, '다음', 'Next', '次へ')} style={styles.cta}>
              <Text style={styles.ctaText}>{last ? L3(language, '시작하기', 'Get started', 'はじめる') : L3(language, '다음', 'Next', '次へ')}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK.bg },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,5,10,0.62)' },
  safe: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16 },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 4, borderRadius: 2, backgroundColor: DARK.borderStrong },
  dotOn: { width: 22, backgroundColor: DARK.accent },
  skip: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  skipText: { fontSize: 13, color: DARK.textDim },
  body: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  card: { backgroundColor: DARK.panelRaised, borderColor: DARK.borderStrong, borderWidth: 1, borderRadius: radius.lg, padding: 20, gap: 14 },
  count: { fontFamily: mono, fontSize: 11, color: DARK.textMute },
  title: { fontSize: 22, fontWeight: '800', color: DARK.text },
  example: { backgroundColor: DARK.panel, borderRadius: radius.md, padding: 12, gap: 6 },
  exampleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bars: { flexDirection: 'row', gap: 3 },
  bar: { width: 10, height: 16, borderRadius: 2 },
  verdict: { fontSize: 16, fontWeight: '800' },
  score: { fontFamily: mono, fontSize: 16, fontWeight: '700', color: DARK.text },
  exampleSub: { fontSize: 13, color: DARK.textDim },
  text: { fontSize: 13, color: DARK.textDim, lineHeight: 20 },
  shootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shootHint: { fontSize: 12, color: DARK.textDim },
  shootBtn: { minHeight: 36, paddingHorizontal: 18, borderRadius: radius.sm, backgroundColor: DARK.accent, alignItems: 'center', justifyContent: 'center' },
  shootBtnText: { fontSize: 14, fontWeight: '800', color: DARK.onAccent },
  nextBox: { gap: 6 },
  nextLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: DARK.textDim },
  nextGrid: { flexDirection: 'row', gap: 8 },
  nextCard: { flex: 1, minWidth: 0, backgroundColor: DARK.panelRaised, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 4 },
  nextCount: { fontFamily: mono, fontSize: 11, color: DARK.textMute },
  nextTitle: { fontSize: 13, fontWeight: '700', color: DARK.text },
  nextSub: { fontSize: 11, color: DARK.textDim },
  bottom: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: DARK.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: DARK.accent, borderColor: DARK.accent },
  checkText: { fontSize: 13, color: DARK.text },
  cta: { minHeight: 48, borderRadius: radius.sm + 2, backgroundColor: DARK.accent, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: '800', color: DARK.onAccent },
});
