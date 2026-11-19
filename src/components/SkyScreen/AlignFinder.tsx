/**
 * AlignFinder.tsx — 고른 대상에 해·달 걸기: 앞으로 1 년 안에 언제 가장 가까워지는가
 * (docs/SANDBOX_MODE_PLAN.md 5 장). 대상 정보 패널(ObjectInfoPanel) 안에 들어갑니다.
 *
 * 서 있는 자리와 대상의 방위·앙각이 정해져 있으니 `searchAlignments` 가 해(또는 달)가 그 방향에서
 * `eps`° 안으로 드는 순간을 모두 찾고, `groupAlignments` 가 며칠씩 이어진 것을 묶습니다.
 * 한 줄을 누르면 그 시각으로 가서 시선을 대상에 맞춥니다(부모가 `onPick` 으로 처리).
 *
 * 스카이라인(`getSkyline`, 장면의 땅 지평선)이 있으면 해·달이 능선 뒤에 가리는 접근을 가려 냅니다:
 * 기본은 가려진 것을 숨기고(몇 건 숨겼는지 알림), 능선에 걸린 것은 "능선에 걸림" 으로 표시합니다.
 *
 * 하늘 위에 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다. 표시는 기기 시간대(앱의 다른 목록과 같음).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Moon, Sun } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { groupAlignments, searchAlignments, type AlignBody, type AlignGroup, type AlignHit } from '../../utils/alignSearch';

type Lang = 'ko' | 'en' | 'ja';

/** 앞으로 찾는 기간(일) */
export const ALIGN_SEARCH_DAYS = 366;
const EPS_CHOICES_DEG = [1, 2] as const;

interface Props {
  language: Lang;
  /** 서 있는 자리 */
  latitude: number;
  longitude: number;
  eyeElevM: number;
  /** 대상의 방위(북 0 시계)·겉보기 앙각 */
  azDeg: number;
  elDeg: number;
  /** 여기서부터 앞으로 찾습니다(보통 지금 시뮬레이션 시각) */
  fromMs: number;
  onPick: (hit: AlignHit) => void;
  /** 눈에서 본 땅 스카이라인(방위 → 앙각). 땅 자료가 아직 없으면 null. 찾기를 누를 때 한 번 부릅니다. */
  getSkyline?: () => ((azDeg: number) => number | null) | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEK: Record<Lang, string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};
const fmtDay = (ms: number, lang: Lang) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${lang === 'ko' || lang === 'ja' ? `(${WEEK[lang][d.getDay()]})` : WEEK.en[d.getDay()]}`;
};
const fmtShort = (ms: number) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const fmtTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** 해·달이 대상의 어느 쪽으로 얼마 벗어나는가 */
const offsetText = (h: AlignHit, lang: Lang) => {
  const parts: string[] = [];
  if (Math.abs(h.dAzDeg) >= 0.005) parts.push(`${h.dAzDeg > 0 ? L3(lang, '오른쪽', 'right', '右') : L3(lang, '왼쪽', 'left', '左')} ${Math.abs(h.dAzDeg).toFixed(2)}°`);
  if (Math.abs(h.dElDeg) >= 0.005) parts.push(`${h.dElDeg > 0 ? L3(lang, '위', 'up', '上') : L3(lang, '아래', 'down', '下')} ${Math.abs(h.dElDeg).toFixed(2)}°`);
  return parts.length ? parts.join(' · ') : L3(lang, '한가운데', 'dead centre', 'ど真ん中');
};

const skyText = (sunAltDeg: number, lang: Lang) =>
  sunAltDeg > 0 ? L3(lang, '낮', 'day', '昼') : sunAltDeg > -12 ? L3(lang, '황혼', 'twilight', '薄明') : L3(lang, '밤', 'night', '夜');

export const AlignFinder: React.FC<Props> = ({ language, latitude, longitude, eyeElevM, azDeg, elDeg, fromMs, onPick, getSkyline }) => {
  const [eps, setEps] = useState<(typeof EPS_CHOICES_DEG)[number]>(1);
  const [sort, setSort] = useState<'near' | 'date'>('near');
  const [showHidden, setShowHidden] = useState(false);
  const [body, setBody] = useState<AlignBody | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [groups, setGroups] = useState<AlignGroup[] | null>(null);
  // "N 일 뒤" 는 찾기 시작한 시각 기준입니다 — 줄을 눌러 시각이 옮겨 가도 같은 말이어야 합니다.
  const [searchFrom, setSearchFrom] = useState(fromMs);
  const runId = useRef(0);

  // 대상·자리가 바뀌면 낡은 결과를 버립니다. 언마운트하면 돌던 탐색도 멈춥니다.
  useEffect(() => {
    runId.current++;
    setGroups(null);
    setRunning(false);
    setBody(null);
    return () => { runId.current++; };
  }, [azDeg, elDeg, latitude, longitude]);

  const run = async (b: AlignBody, e: number) => {
    const id = ++runId.current;
    setBody(b);
    setSearchFrom(fromMs);
    setRunning(true);
    setProgress(0);
    setGroups(null);
    const skyline = getSkyline?.() ?? undefined;
    const hits = await searchAlignments(
      { body: b, latitude, longitude, eyeElevM, target: { azDeg, elDeg }, fromMs, days: ALIGN_SEARCH_DAYS, epsDeg: e, skyline },
      { isCancelled: () => id !== runId.current, onProgress: (f) => { if (id === runId.current) setProgress(f); } },
    );
    if (id !== runId.current) return;
    setGroups(groupAlignments(hits));
    setRunning(false);
  };

  const hiddenCount = useMemo(() => (groups ?? []).filter(g => g.best.visibility === 'hidden').length, [groups]);
  const rows = useMemo(() => {
    if (!groups) return [];
    const shown = showHidden ? groups : groups.filter(g => g.best.visibility !== 'hidden');
    return sort === 'near' ? [...shown].sort((a, b) => a.best.sepDeg - b.best.sepDeg) : shown;
  }, [groups, sort, showHidden]);

  const label = (b: AlignBody) => (b === 'moon' ? L3(language, '달 걸기', 'Hang moon', '月を重ねる') : L3(language, '해 걸기', 'Hang sun', '太陽を重ねる'));

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>{L3(language, '해·달 걸기 — 언제 이 방향에 오나', 'Align sun / moon — when does it line up', '太陽・月を重ねる日を探す')}</Text>
      <View style={styles.row}>
        {(['moon', 'sun'] as const).map(b => (
          <OverlayButton key={b} active={body === b} onPress={() => run(b, eps)} accessibilityLabel={label(b)} style={styles.findBtn}>
            {b === 'moon' ? <Moon size={14} color={DARK.moon} /> : <Sun size={14} color={DARK.sun} />}
            <Text style={[styles.findText, body === b && { color: DARK.accent }]}>{label(b)}</Text>
          </OverlayButton>
        ))}
        <View style={styles.spacer} />
        {EPS_CHOICES_DEG.map(v => (
          <OverlayButton
            key={v}
            active={eps === v}
            onPress={() => { setEps(v); if (body) run(body, v); }}
            accessibilityLabel={`${L3(language, '허용', 'Within', '許容')} ${v}°`}
            style={styles.chip}
          >
            <Text style={[styles.chipText, eps === v && { color: DARK.accent }]}>{v}°</Text>
          </OverlayButton>
        ))}
      </View>

      {running && (
        <View style={styles.progressTrack} accessibilityLabel={L3(language, '찾는 중', 'Searching', '探索中')}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}

      {groups && (
        groups.length === 0 ? (
          <Text style={styles.empty}>
            {L3(
              language,
              `앞으로 ${ALIGN_SEARCH_DAYS}일 안에 ${eps}° 안으로 드는 날이 없어요. 허용을 넓히거나 자리를 옮겨 보세요.`,
              `No date within ${eps}° in the next ${ALIGN_SEARCH_DAYS} days. Widen the tolerance or move.`,
              `今後${ALIGN_SEARCH_DAYS}日に${eps}°以内に入る日はありません。許容を広げるか場所を動かしてください。`,
            )}
          </Text>
        ) : (
          <>
            <View style={styles.sortRow}>
              <Text style={styles.count}>{L3(language, `${rows.length}건`, `${rows.length} found`, `${rows.length}件`)}</Text>
              {hiddenCount > 0 && (
                <OverlayButton
                  active={showHidden}
                  onPress={() => setShowHidden(v => !v)}
                  accessibilityLabel={L3(language, '가려진 것 보기', 'Show hidden', '隠れたものを表示')}
                  style={styles.hiddenBtn}
                >
                  <Text style={[styles.chipText, showHidden && { color: DARK.accent }]}>
                    {showHidden
                      ? L3(language, `가려진 ${hiddenCount}건 포함`, `incl. ${hiddenCount} hidden`, `隠れた${hiddenCount}件を含む`)
                      : L3(language, `가려진 ${hiddenCount}건 숨김`, `${hiddenCount} hidden`, `隠れた${hiddenCount}件を非表示`)}
                  </Text>
                </OverlayButton>
              )}
              <View style={styles.spacer} />
              {(['near', 'date'] as const).map(k => (
                <OverlayButton key={k} active={sort === k} onPress={() => setSort(k)} accessibilityLabel={k === 'near' ? L3(language, '가까운 순', 'Closest first', '近い順') : L3(language, '날짜순', 'By date', '日付順')} style={styles.sortBtn}>
                  <Text style={[styles.chipText, sort === k && { color: DARK.accent }]}>
                    {k === 'near' ? L3(language, '가까운 순', 'Closest', '近い順') : L3(language, '날짜순', 'Date', '日付順')}
                  </Text>
                </OverlayButton>
              ))}
            </View>
            <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator>
              {rows.map(g => {
                const h = g.best;
                const days = Math.round((h.timeMs - searchFrom) / 86400e3);
                const ratio = h.sepDeg / h.diskDeg;
                return (
                  <Pressable
                    key={h.timeMs}
                    onPress={() => onPick(h)}
                    accessibilityRole="button"
                    accessibilityLabel={`${fmtDay(h.timeMs, language)} ${fmtTime(h.timeMs)}`}
                    style={styles.item}
                  >
                    <View style={styles.itemMain}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {fmtDay(h.timeMs, language)}  {fmtTime(h.timeMs)}
                      </Text>
                      <Text style={styles.itemSub} numberOfLines={1}>
                        {L3(language, '어긋남', 'off', 'ずれ')} {h.sepDeg.toFixed(2)}° ({L3(language, `지름 ${ratio.toFixed(1)}배`, `${ratio.toFixed(1)}× disc`, `直径の${ratio.toFixed(1)}倍`)}) · {offsetText(h, language)}
                      </Text>
                      <Text style={styles.itemSub2} numberOfLines={1}>
                        {h.body === 'moon' && h.illum != null ? `${L3(language, '달', 'Moon', '月')} ${Math.round(h.illum * 100)}% · ` : ''}
                        {skyText(h.sunAltDeg, language)} · {L3(language, '고도', 'alt', '高度')} {h.altDeg.toFixed(1)}°
                        {h.visibility === 'partial' ? ` · ${L3(language, '능선에 걸림', 'on the ridge', '稜線にかかる')}` : ''}
                        {h.visibility === 'hidden' ? ` · ${L3(language, '지형에 가림', 'hidden by terrain', '地形に隠れる')}` : ''}
                        {g.count > 1 ? ` · ${fmtShort(g.firstMs)}~${fmtShort(g.lastMs)} ${L3(language, `${g.count}일 이어짐`, `${g.count} days`, `${g.count}日続く`)}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.itemDays}>
                      {days <= 0 ? L3(language, '오늘', 'today', '今日') : L3(language, `${days}일 뒤`, `in ${days} d`, `${days}日後`)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 4, borderTopWidth: 1, borderTopColor: DARK.border, paddingTop: 6 },
  sectionLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: DARK.textMute },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  spacer: { flex: 1 },
  findBtn: { width: 'auto', minWidth: 84, height: 30, paddingHorizontal: 8, flexDirection: 'row', gap: 4 },
  findText: { fontSize: 11, fontWeight: '700', color: DARK.text },
  chip: { width: 'auto', minWidth: 30, height: 30, paddingHorizontal: 6 },
  chipText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  progressTrack: { height: 2, backgroundColor: DARK.fill, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, backgroundColor: DARK.accent },
  empty: { fontSize: 11, color: DARK.textDim, paddingVertical: 4 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontFamily: mono, fontSize: 11, color: DARK.textDim },
  sortBtn: { width: 'auto', minWidth: 56, height: 26, paddingHorizontal: 6 },
  hiddenBtn: { width: 'auto', minWidth: 56, height: 26, paddingHorizontal: 6, marginLeft: 6 },
  list: { maxHeight: 156 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: DARK.fill,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 3,
    minHeight: 44,
  },
  itemMain: { flex: 1, minWidth: 0 },
  itemTitle: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: DARK.text },
  itemSub: { fontFamily: mono, fontSize: 10, color: DARK.text },
  itemSub2: { fontFamily: mono, fontSize: 10, color: DARK.textDim },
  itemDays: { fontFamily: mono, fontSize: 10, color: DARK.textDim },
});
