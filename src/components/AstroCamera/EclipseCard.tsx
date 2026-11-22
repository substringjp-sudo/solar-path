/**
 * EclipseCard.tsx — **월식 이벤트 모드의 카드**(유리, 2026-11-21, docs/SANDBOX_MODE_PLAN.md 목업 13 · §23-6).
 * 지금 단계와 다음 단계까지 남은 시간, 그 단계의 노출 안내, 달이 뜨고 지는 때를 한눈에 보이고, "시간표" 로 모든 단계(시각 · 보임 여부 · 노출)를 펼칩니다.
 * 계산은 `utils/eclipseEvent.ts` · `utils/eclipsePlan.ts`(판정 `verify-eclipse-event.js` · `verify-eclipse-plan.js`), 이 화면은 `tools/web-repro/verify-eclipse-card.js`.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Moon } from 'lucide-react-native';
import { TEXT } from '../../theme/glassTokens';
import { mono } from '../../theme/tokens';
import { GlassSurface, glassTextShadow } from '../glass/GlassSurface';
import { GlassChip } from '../glass/GlassChip';
import { L3, type Language } from '../../utils/i18n';
import { clockLabel } from '../../utils/timelapsePlan';
import { formatRemain, stageName, type EclipseEvent } from '../../utils/eclipseEvent';
import { stageExposure, type EclipseStageKey } from '../../utils/eclipsePlan';

interface Props {
  event: EclipseEvent;
  language: Language;
  tzHours: number;
}

const adviceText = (key: EclipseStageKey): string => {
  const x = stageExposure(key);
  return x.brightEv === x.darkEv
    ? `ISO ${x.bright.iso} · ${x.bright.shutterText}`
    : `ISO ${x.bright.iso} · ${x.bright.shutterText} ~ ISO ${x.dark.iso} · ${x.dark.shutterText}`;
};

export const EclipseCard: React.FC<Props> = ({ event, language, tzHours }) => {
  const [open, setOpen] = useState(false);
  const { eclipse, plan, now } = event;
  const T = (ms: number) => clockLabel(ms, tzHours);
  const lang = language as 'ko' | 'en' | 'ja';
  const cur = now.stage ?? now.next ?? plan.stages[0];

  const status = now.phase === 'before'
    ? `${L3(language, '월식 시작까지', 'Eclipse starts in', '月食開始まで')} ${formatRemain(now.remainingMs)}`
    : now.next
      ? `${stageName(cur.key, lang)} · ${L3(language, `다음 ${stageName(now.next.key, lang)}까지`, `${stageName(now.next.key, lang)} in`, `次の${stageName(now.next.key, lang)}まで`)} ${formatRemain(now.remainingMs)}`
      : `${stageName(cur.key, lang)} · ${L3(language, '월식 끝까지', 'Eclipse ends in', '月食終了まで')} ${formatRemain(now.remainingMs)}`;

  const risesLate = plan.visibleFromMs != null && plan.visibleFromMs > eclipse.p1Ms + 60000;
  const setsEarly = plan.visibleToMs != null && plan.visibleToMs < eclipse.p4Ms - 60000;
  const moonLine = [
    risesLate ? L3(language, `달이 ${T(plan.visibleFromMs!)} 에 떠요`, `Moon rises ${T(plan.visibleFromMs!)}`, `月は${T(plan.visibleFromMs!)}に昇ります`) : null,
    setsEarly ? L3(language, `달이 ${T(plan.visibleToMs!)} 에 져요`, `Moon sets ${T(plan.visibleToMs!)}`, `月は${T(plan.visibleToMs!)}に沈みます`) : null,
  ].filter(Boolean).join(' · ');

  return (
    <GlassSurface blurred testID="eclipse-card" style={styles.card}>
      <View style={styles.head}>
        <Moon size={14} color={TEXT} />
        <Text style={styles.title} numberOfLines={1}>
          {`${L3(language, '월식', 'Lunar eclipse', '月食')} · ${stageName(eclipse.kind === 'total' ? 'total' : eclipse.kind === 'partial' ? 'partial' : 'penumbral', lang)}`}
        </Text>
        <GlassChip
          testID="eclipse-toggle"
          label={open ? L3(language, '접기', 'Hide', '閉じる') : L3(language, '시간표', 'Schedule', '時刻表')}
          expanded={open}
          onPress={() => setOpen(v => !v)}
        />
      </View>
      <Text testID="eclipse-status" style={styles.status}>{status}</Text>
      <Text testID="eclipse-advice" style={styles.mono}>{`${L3(language, '노출 안내', 'Exposure', '露出の目安')} ${adviceText(cur.key)}`}</Text>
      {moonLine ? <Text testID="eclipse-moon" style={styles.line}>{moonLine}</Text> : null}
      {open ? (
        <View testID="eclipse-table" style={styles.table}>
          {plan.stages.map((s, i) => (
            <View key={i} testID={`eclipse-row-${i}`} style={styles.row}>
              <Text style={styles.rowName}>{stageName(s.key, lang)}</Text>
              <Text style={styles.rowTime}>{`${T(s.startMs)}–${T(s.endMs)}`}</Text>
              <Text style={styles.rowNote} numberOfLines={1}>
                {s.visible ? adviceText(s.key) : L3(language, '달이 지평선 아래', 'Moon below horizon', '月は地平線の下')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 10, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 12, fontWeight: '700', color: TEXT, ...glassTextShadow },
  status: { fontSize: 12, color: TEXT, ...glassTextShadow },
  mono: { fontFamily: mono, fontSize: 11, color: TEXT, ...glassTextShadow },
  line: { fontSize: 11, color: TEXT, ...glassTextShadow },
  table: { gap: 2, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowName: { width: 52, fontSize: 11, fontWeight: '700', color: TEXT, ...glassTextShadow },
  rowTime: { fontFamily: mono, fontSize: 11, color: TEXT, ...glassTextShadow },
  rowNote: { flexShrink: 1, fontSize: 10, color: TEXT, ...glassTextShadow },
});
