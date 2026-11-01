import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View, ScrollView } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RotateCcw, X, Info } from 'lucide-react-native';
import { PressScale, PrimaryButton } from '../ui';
import { useCelestialStore } from '../../store/useCelestialStore';
import { L3 } from '../../utils/i18n';
import { DATA_START_MS, FORECAST_DAYS, MS_HOUR, TIER_LEAD_HOURS } from '../../utils/timeBar';
import { mono, radius, space, TOUCH, type } from '../../theme/tokens';
import { makeStyles, useThemeColors } from '../../theme/useTheme';

export type CalendarTier = 'high' | 'medium' | 'low' | 'past' | 'none';

interface Props {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}

const WEEKDAYS = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
} as const;

/** 특정 날짜(정오 기준)의 날씨 데이터 티어 판정 */
export function getCalendarTier(year: number, month: number, day: number, nowMs: number): CalendarTier {
  const tMs = Date.UTC(year, month, day, 12, 0, 0);
  if (tMs < DATA_START_MS) return 'none';
  const leadH = (tMs - nowMs) / MS_HOUR;
  if (leadH < 0) return 'past';
  if (leadH < TIER_LEAD_HOURS.high) return 'high';
  if (leadH < TIER_LEAD_HOURS.medium) return 'medium';
  if (leadH < TIER_LEAD_HOURS.low) return 'low';
  return 'none';
}

export const CustomCalendarModal: React.FC<Props> = ({ visible, value, onChange, onClose }) => {
  const color = useThemeColors();
  const styles = useStyles();
  const language = useCelestialStore((s) => s.language);

  // 현재 기준 시각
  const [now] = useState(() => new Date());
  const nowMs = now.getTime();

  // 열릴 때 초기 년/월/일 동기화
  const [viewYear, setViewYear] = useState(() => value.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value.getMonth());
  const [selected, setSelected] = useState(() => new Date(value.getFullYear(), value.getMonth(), value.getDate()));

  // 모달이 다시 열릴 때 value 로 리셋
  React.useEffect(() => {
    if (visible) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
      setSelected(new Date(value.getFullYear(), value.getMonth(), value.getDate()));
    }
  }, [visible, value]);

  const selectedTier = useMemo(() => {
    return getCalendarTier(selected.getFullYear(), selected.getMonth(), selected.getDate(), nowMs);
  }, [selected, nowMs]);

  // 달력 그리드 계산 (해당 월 1일의 요일, 총 일수)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells: { year: number; month: number; day: number; isCurrentMonth: boolean }[] = [];

    // 이전 달 빈칸 채우기
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({
        year: viewMonth === 0 ? viewYear - 1 : viewYear,
        month: viewMonth === 0 ? 11 : viewMonth - 1,
        day: daysInPrevMonth - i,
        isCurrentMonth: false,
      });
    }

    // 이번 달 날짜
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        year: viewYear,
        month: viewMonth,
        day: d,
        isCurrentMonth: true,
      });
    }

    // 다음 달 빈칸 채우기 (총 35 or 42 셀)
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({
          year: viewMonth === 11 ? viewYear + 1 : viewYear,
          month: viewMonth === 11 ? 0 : viewMonth + 1,
          day: d,
          isCurrentMonth: false,
        });
      }
    }

    return cells;
  }, [viewYear, viewMonth]);

  // 주(Week) 단위로 7일씩 묶음 — 서브픽셀 줄바꿈 오차 방지
  const weeks = useMemo(() => {
    const rows: (typeof calendarDays)[] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      rows.push(calendarDays.slice(i, i + 7));
    }
    return rows;
  }, [calendarDays]);

  const changeMonth = (delta: number) => {
    let nextM = viewMonth + delta;
    let nextY = viewYear;
    if (nextM > 11) {
      nextM = 0;
      nextY += 1;
    } else if (nextM < 0) {
      nextM = 11;
      nextY -= 1;
    }
    setViewYear(nextY);
    setViewMonth(nextM);
  };

  const changeYear = (delta: number) => {
    setViewYear((y) => y + delta);
  };

  const goToday = () => {
    const t = new Date();
    setViewYear(t.getFullYear());
    setViewMonth(t.getMonth());
    setSelected(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
  };

  const handleConfirm = () => {
    onChange(selected);
    onClose();
  };

  const isToday = (y: number, m: number, d: number) => {
    return y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
  };

  const isSelected = (y: number, m: number, d: number) => {
    return y === selected.getFullYear() && m === selected.getMonth() && d === selected.getDate();
  };

  const tierColors: Record<CalendarTier, string> = {
    high: '#10B981',     // 초록: 고정밀 예보 (~3일)
    medium: '#F59E0B',   // 노랑: 중기 예보 (3~7일)
    low: '#F97316',      // 주황: 장기 예측 (7~16일)
    past: '#3B82F6',     // 파랑: 과거 재분석 (1940~)
    none: color.textDim, // 회색: 기상 없음 (천문만)
  };

  const tierLabels: Record<CalendarTier, { name: string; desc: string }> = {
    high: {
      name: L3(language, '고정밀 수치예보', 'High-Accuracy Forecast', '高精度数値予報'),
      desc: L3(
        language,
        'ECMWF · ICON 고해상도 모델 및 실시간 관측치 동화 (운량·3D 구름 정밀 재현)',
        'ECMWF & ICON high-res models with real-time assimilation (precise 3D clouds)',
        'ECMWF・ICON高解像度モデル及びリアルタイム観測同化 (高精度3D雲再現)'
      ),
    },
    medium: {
      name: L3(language, '중기 수치예보', 'Medium-Range Forecast', '中期数値予報'),
      desc: L3(
        language,
        '전 지구 수치예보 모델 기반 (기압골 통과 시 ±반나절 오차 가능)',
        'Global numerical weather model (±half-day synoptic timing variation)',
        '全球数値予報モデル基準 (気圧配置通過時に±半日のズレの可能性あり)'
      ),
    },
    low: {
      name: L3(language, '장기 앙상블 추세', 'Long-Range Ensemble', '長期アンサンブル傾向'),
      desc: L3(
        language,
        '50개 앙상블 시뮬레이션 평균치 (거시적 날씨 경향 파악용, 신뢰도 낮음)',
        '50-member ensemble average (macro trend only, low cloud fidelity)',
        '50メンバーアンサンブル平均値 (マクロな傾向把握用、信頼度低)'
      ),
    },
    past: {
      name: L3(language, 'ERA5 과거 재분석', 'ERA5 Global Reanalysis', 'ERA5過去再解析'),
      desc: L3(
        language,
        '과거 전 지구 관측치(위성·관측소) 동화 재분석 자료 (노을 및 대기 재현)',
        'Global observation assimilation reanalysis (sky, sunset & atmosphere replay)',
        '全球観測データ(衛星・地上)同化再解析データ (夕焼け・大気再現)'
      ),
    },
    none: {
      name: L3(language, '기상 자료 없음 (천문 전용)', 'No Weather Data (Astronomy Only)', '気象データなし (天体専用)'),
      desc: L3(
        language,
        '예보 한계(+16일) 너머 또는 1940년 이전 (해·달·은하수 궤적만 계산)',
        'Beyond 16-day forecast or before 1940 (sun, moon & stars track only)',
        '予報限界(+16日)以降または1940年以前 (太陽・月・星空の軌道のみ計算)'
      ),
    },
  };

  const selWeekday = WEEKDAYS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'][selected.getDay()];
  const selectedDateStr = `${selected.getFullYear()}.${String(selected.getMonth() + 1).padStart(2, '0')}.${String(selected.getDate()).padStart(2, '0')} (${selWeekday})`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* ── 헤더: 타이틀 & 닫기 ──────────────────────────── */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{L3(language, '날짜 선택', 'Select Date', '日付を選択')}</Text>
              <Text style={styles.headerSubTitle}>
                {L3(language, '기상 데이터 신뢰도 연동', 'Weather Data Tier Linked', '気象データ信頼度連動')}
              </Text>
            </View>
            <PressScale onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <X size={20} color={color.textDim} />
            </PressScale>
          </View>

          {/* ── 월/연도 네비게이션 ─────────────────────────── */}
          <View style={styles.navRow}>
            <View style={styles.navGroup}>
              <PressScale onPress={() => changeYear(-1)} style={styles.navBtn} accessibilityLabel="Prev Year">
                <ChevronsLeft size={16} color={color.textDim} />
              </PressScale>
              <PressScale onPress={() => changeMonth(-1)} style={styles.navBtn} accessibilityLabel="Prev Month">
                <ChevronLeft size={16} color={color.textDim} />
              </PressScale>
            </View>

            <View style={styles.monthDisplay}>
              <Text style={styles.monthText}>
                {viewYear}
                {L3(language, '년 ', '. ', '年 ')}
                {String(viewMonth + 1).padStart(2, '0')}
                {L3(language, '월', '', '月')}
              </Text>
            </View>

            <View style={styles.navGroup}>
              <PressScale onPress={() => changeMonth(1)} style={styles.navBtn} accessibilityLabel="Next Month">
                <ChevronRight size={16} color={color.textDim} />
              </PressScale>
              <PressScale onPress={() => changeYear(1)} style={styles.navBtn} accessibilityLabel="Next Year">
                <ChevronsRight size={16} color={color.textDim} />
              </PressScale>
              <PressScale onPress={goToday} style={styles.todayBtn} accessibilityLabel="Today">
                <RotateCcw size={13} color={color.accent} />
                <Text style={styles.todayBtnText}>{L3(language, '오늘', 'Today', '今日')}</Text>
              </PressScale>
            </View>
          </View>

          {/* ── 요일 헤더 ────────────────────────────────────── */}
          <View style={styles.weekdayRow}>
            {WEEKDAYS[language === 'ko' ? 'ko' : language === 'ja' ? 'ja' : 'en'].map((w, idx) => (
              <View key={w} style={styles.weekdayCell}>
                <Text style={[styles.weekdayText, idx === 0 && { color: color.warning }, idx === 6 && { color: color.accent }]}>
                  {w}
                </Text>
              </View>
            ))}
          </View>

          {/* ── 달력 그리드 (주 단위 행 정렬) ────────────────── */}
          <View style={styles.grid}>
            {weeks.map((week, wIdx) => (
              <View key={`week-${wIdx}`} style={styles.weekRow}>
                {week.map((cell, idx) => {
                  const selectedCell = isSelected(cell.year, cell.month, cell.day);
                  const todayCell = isToday(cell.year, cell.month, cell.day);
                  const tier = getCalendarTier(cell.year, cell.month, cell.day, nowMs);
                  const dotColor = tierColors[tier];

                  return (
                    <PressScale
                      key={`${cell.year}-${cell.month}-${cell.day}-${idx}`}
                      style={[
                        styles.dayCell,
                        selectedCell && { backgroundColor: color.accent },
                        todayCell && !selectedCell && { borderColor: color.accentLine, borderWidth: 1 },
                      ]}
                      onPress={() => setSelected(new Date(cell.year, cell.month, cell.day))}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          !cell.isCurrentMonth && { color: color.borderStrong, opacity: 0.4 },
                          selectedCell && { color: color.onAccent, fontWeight: '800' },
                          todayCell && !selectedCell && { color: color.accent, fontWeight: '700' },
                        ]}
                      >
                        {cell.day}
                      </Text>
                      {/* 데이터 등급 도트 */}
                      <View
                        style={[
                          styles.tierDot,
                          {
                            backgroundColor: dotColor,
                            opacity: cell.isCurrentMonth ? (selectedCell ? 0.9 : 1) : 0.25,
                          },
                        ]}
                      />
                    </PressScale>
                  );
                })}
              </View>
            ))}
          </View>

          {/* ── 선택 날짜 데이터 정보 카드 ─────────────────────── */}
          <View style={styles.infoCard}>
            <View style={styles.infoHeaderRow}>
              <Text style={styles.infoDateText}>{selectedDateStr}</Text>
              <View style={[styles.tierBadge, { backgroundColor: color.fill, borderColor: tierColors[selectedTier] }]}>
                <View style={[styles.tierBadgeDot, { backgroundColor: tierColors[selectedTier] }]} />
                <Text style={[styles.tierBadgeText, { color: tierColors[selectedTier] }]}>
                  {tierLabels[selectedTier].name}
                </Text>
              </View>
            </View>
            <Text style={styles.infoDescText} numberOfLines={2}>
              {tierLabels[selectedTier].desc}
            </Text>
          </View>

          {/* ── 데이터 범례 (Legend) ─────────────────────────── */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors.high }]} />
              <Text style={styles.legendLabel}>{L3(language, '고정밀예보', 'High Forecast', '高精度予報')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors.medium }]} />
              <Text style={styles.legendLabel}>{L3(language, '중기예보', 'Medium', '中期')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors.low }]} />
              <Text style={styles.legendLabel}>{L3(language, '장기추세', 'Trend', '長期')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors.past }]} />
              <Text style={styles.legendLabel}>{L3(language, 'ERA5재분석', 'Reanalysis', '再解析')}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors.none }]} />
              <Text style={styles.legendLabel}>{L3(language, '천문만', 'Astro Only', '天体のみ')}</Text>
            </View>
          </View>

          {/* ── 하단 액션 버튼 ────────────────────────────────── */}
          <View style={styles.actionRow}>
            <PressScale onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>{L3(language, '취소', 'Cancel', 'キャンセル')}</Text>
            </PressScale>
            <PrimaryButton
              label={L3(language, '날짜 적용', 'Apply Date', '日付を適用')}
              onPress={handleConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const useStyles = makeStyles((color) => ({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.md,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '92%',
    backgroundColor: color.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  scrollContent: {
    padding: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  headerTitleWrap: { gap: 2 },
  headerTitle: { fontSize: 16, fontWeight: '800', color: color.text },
  headerSubTitle: { ...type.micro, color: color.textDim },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
  },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
    paddingVertical: 4,
  },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDisplay: { paddingHorizontal: space.xs },
  monthText: { fontSize: 15, fontWeight: '800', fontFamily: mono, color: color.text },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.accentSoft,
    marginLeft: 3,
  },
  todayBtnText: { ...type.micro, color: color.accent, fontWeight: '700' },

  weekdayRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: color.border,
    paddingBottom: 6,
    marginBottom: 4,
  },
  weekdayCell: { flex: 1, alignItems: 'center' },
  weekdayText: { ...type.micro, color: color.textDim, fontWeight: '700' },

  grid: {
    marginBottom: space.sm,
    gap: 2,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayCell: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
    marginHorizontal: 1,
  },
  dayText: {
    fontSize: 13,
    fontFamily: mono,
    fontWeight: '600',
    color: color.text,
  },
  tierDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },

  infoCard: {
    backgroundColor: color.fill,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.sm,
    gap: 4,
    marginBottom: space.xs,
  },
  infoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoDateText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
    color: color.text,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
    borderWidth: 1,
  },
  tierBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  tierBadgeText: { ...type.micro, fontWeight: '700' },
  infoDescText: { ...type.micro, color: color.textDim, lineHeight: 14 },

  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 6,
    marginBottom: space.xs,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { ...type.micro, color: color.textDim, fontSize: 8.5 },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  cancelBtn: {
    height: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { ...type.label, color: color.textDim },
}));
