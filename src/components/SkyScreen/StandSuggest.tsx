/**
 * StandSuggest.tsx — 추천: 고른 대상에 어울리는 주제와 서 있을 자리·날짜·시각 후보 (docs/SANDBOX_MODE_PLAN.md 4·5 장, 목업 3번).
 *
 *  - `StandSuggestView`  : 내용(머리 · 주제 칩 · 설정 · 필요 거리 줄 · 지도 · 후보 목록). 모달 없이도 그려져 하네스가 바로 붙입니다.
 *  - `StandSuggestModal` : 전체 화면 모달로 감싼 것.
 *
 * 계산은 `utils/standFinder.ts`(자리 찾기)와 `utils/standSuggest.ts`(주제 · 순위 · 예보 상태)가 합니다. 이 화면은 설정이 바뀔 때 한 번 찾아
 * 묶음을 들고 있다가, 예보가 늦게 오면 다시 찾지 않고 순위만 다시 매깁니다. 후보를 누르면 `onPick` 으로 부모에게 넘깁니다
 * (부모가 그 자리로 옮기고 시각을 맞추고 시선을 대상에 맞춥니다).
 *
 * 하는 것: 달 걸기 · 해 걸기(대상 꼭대기나 정상). 하지 않는 것(칩만 흐리게 "준비 중"): 탑 뒤 은하수 · 북극성 별 일주 · 옥상에 서기.
 * 후보의 장소는 이름이 아니라 위경도와 해발입니다(장소 이름 자료가 없음). 예보는 대상 위치의 시간별 구름입니다(`utils/cloudOutlook.ts`).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { PressScale, Chip } from '../ui';
import { makeStyles } from '../../theme/useTheme';
import { mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import type { HeightSampler, PickedTarget } from '../../utils/demPick';
import { findStandPoints, groupStandHits, type StandGroup } from '../../utils/standFinder';
import {
  themesFor, sizeChoices, neededDistanceKm, neededFocalMm, standQueryFor, suggestTargetPoint, rankStands, pickDistinct, sortStands,
  type CloudOutlook, type Forecast, type MoonInfo, type SizeId, type StandCandidate, type ThemeId,
} from '../../utils/standSuggest';

type Lang = 'ko' | 'en' | 'ja';

/** 찾는 기간 선택(일) */
export const SUGGEST_PERIOD_CHOICES = [30, 90, 180] as const;
/** 목록에 보이는 후보 수(같은 쪽 2 일 안은 거른 뒤) */
export const SUGGEST_MAX_ROWS = 12;

/** 장면이 내주는 지반 틀(`SkyScene3DHandle.getStandSamplers`). */
export interface StandSamplers {
  origin: { latitude: number; longitude: number };
  ground: HeightSampler;
  isWater: (eastM: number, southM: number) => boolean;
}

export interface StandSuggestViewProps {
  language: Lang;
  target: PickedTarget;
  /** 여기서부터 앞으로 찾습니다(보통 지금 시뮬레이션 시각). "N 일 뒤"의 기준이기도 합니다. */
  fromMs: number;
  /** 서 있을 자리의 눈 높이(m) — 샌드박스의 눈 높이 */
  eyeAboveGroundM: number;
  /** 장면의 지반 틀. 지형이 아직 안 왔으면 null(그 사실을 알립니다). */
  getSamplers: () => StandSamplers | null;
  /** 대상 위치의 구름 예보. 없으면 모두 "날씨 모름"(`outlookState` 로 이유를 적습니다). */
  outlook?: CloudOutlook | null;
  outlookState?: 'loading' | 'ready' | 'failed';
  onPick: (c: StandCandidate) => void;
  onBack: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEK: Record<Lang, string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
};
/** 기기 시간대 표시(앱의 다른 목록과 같음) */
const fmtDay = (ms: number, lang: Lang) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WEEK[lang][d.getDay()]})`; };
const fmtTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtKm = (m: number) => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;

const themeLabel = (id: ThemeId, building: boolean, lang: Lang): string => {
  switch (id) {
    case 'moonOnTop': return building ? L3(lang, '꼭대기에 달 걸기', 'Moon on the top', '頂上に月を掛ける') : L3(lang, '정상에 달 걸기', 'Moon on the summit', '山頂に月を掛ける');
    case 'sunOnTop': return building ? L3(lang, '꼭대기에 해 걸기', 'Sun on the top', '頂上に太陽を掛ける') : L3(lang, '정상에 해 걸기', 'Sun on the summit', '山頂に太陽を掛ける');
    case 'milkyBehind': return L3(lang, '탑 뒤 은하수', 'Milky Way behind', '塔の後ろの天の川');
    case 'polarisTrails': return L3(lang, '북극성 별 일주', 'Polaris star trails', '北極星の日周運動');
  }
};

const moonName = (m: MoonInfo, lang: Lang): string => {
  const pct = `${Math.round(m.illum * 100)} %`;
  switch (m.shape) {
    case 'full': return `${L3(lang, '보름달', 'Full moon', '満月')} ${pct}`;
    case 'new': return `${L3(lang, '삭', 'New moon', '新月')} ${pct}`;
    case 'quarter': return `${L3(lang, '반달', 'Half moon', '半月')} ${pct}`;
    case 'crescent': return `${m.waxing ? L3(lang, '초승달', 'Waxing crescent', '三日月') : L3(lang, '그믐달', 'Waning crescent', '有明月')} ${pct}`;
    default: return `${m.waxing ? L3(lang, '차오르는 달', 'Waxing gibbous', '十三夜') : L3(lang, '기우는 달', 'Waning gibbous', '十八夜')} ${pct}`;
  }
};

const eventName = (c: StandCandidate, lang: Lang): string => {
  if (c.phase === 'high') return '';
  const rising = c.phase === 'rising';
  return c.hit.body === 'moon'
    ? (rising ? L3(lang, '달 뜬 직후', 'just after moonrise', '月の出の直後') : L3(lang, '달 지기 전', 'before moonset', '月の入りの前'))
    : (rising ? L3(lang, '일출 직후', 'just after sunrise', '日の出の直後') : L3(lang, '일몰 직전', 'just before sunset', '日の入りの直前'));
};

const skyName = (c: StandCandidate, lang: Lang): string =>
  c.sky === 'day' ? L3(lang, '낮', 'day', '昼') : c.sky === 'twilight' ? L3(lang, '황혼', 'twilight', '薄明') : L3(lang, '밤', 'night', '夜');

const forecastName = (f: Forecast, lang: Lang, loading: boolean): string =>
  f.state === 'clear' ? L3(lang, '예보 맑음', 'Forecast clear', '予報 晴れ')
    : f.state === 'partly' ? L3(lang, '구름 보통', 'Partly cloudy', '雲 普通')
      : f.state === 'cloudy' ? L3(lang, '구름 많음', 'Cloudy', '雲 多い')
        : loading ? L3(lang, '예보 받는 중', 'Loading forecast', '予報取得中') : L3(lang, '날씨 모름', 'Weather unknown', '天気不明');

/** 찾은 결과(묶음)와 상태. */
type Search =
  | { status: 'idle' | 'running'; progress: number }
  | { status: 'noTerrain' | 'noPosition' | 'error' }
  | { status: 'done'; groups: StandGroup[] };

export const StandSuggestView: React.FC<StandSuggestViewProps> = ({ language, target, fromMs, eyeAboveGroundM, getSamplers, outlook, outlookState, onPick, onBack }) => {
  const styles = useStyles();
  const building = target.kind === 'building';
  const themes = useMemo(() => themesFor(target), [target]);
  const sizes = useMemo(() => sizeChoices(target), [target]);
  const [themeId, setThemeId] = useState<ThemeId>(themes[0].id);
  const theme = themes.find(t => t.id === themeId) ?? themes[0];
  const [sizeId, setSizeId] = useState<SizeId>(sizes[0].id);
  const size = sizes.find(s => s.id === sizeId) ?? sizes[0];
  const [days, setDays] = useState<number>(90);
  const [sort, setSort] = useState<'score' | 'date'>('score');
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState<Search>({ status: 'idle', progress: 0 });
  const [retry, setRetry] = useState(0);
  const runId = useRef(0);

  const point = suggestTargetPoint(target);
  const body = theme.body;

  // 설정이 바뀌면 다시 찾습니다. 예보(outlook)는 찾는 데 쓰지 않으므로 의존에 없습니다 — 순위만 다시 매깁니다.
  useEffect(() => {
    const id = ++runId.current;
    setSelected(null);
    if (!theme.ready || !body) { setSearch({ status: 'idle', progress: 0 }); return; }
    const s = getSamplers();
    if (!s) { setSearch({ status: 'noTerrain' }); return; }
    const q = standQueryFor({ target, body, sizeM: size.lengthM, fromMs, days, origin: s.origin, ground: s.ground, isWater: s.isWater, eyeAboveGroundM });
    if (!q) { setSearch({ status: 'noPosition' }); return; }
    setSearch({ status: 'running', progress: 0 });
    findStandPoints(q, { isCancelled: () => id !== runId.current, onProgress: (f) => { if (id === runId.current) setSearch({ status: 'running', progress: f }); } })
      .then((hits) => { if (id === runId.current) setSearch({ status: 'done', groups: groupStandHits(hits) }); })
      .catch(() => { if (id === runId.current) setSearch({ status: 'error' }); });
    return () => { runId.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, themeId, sizeId, days, fromMs, eyeAboveGroundM, retry]);

  const ranked = useMemo(() => {
    if (search.status !== 'done' || !body || !point) return [];
    return rankStands(search.groups, { body, latitude: point.latitude, longitude: point.longitude, elevM: point.elevM, outlook, searchFromMs: fromMs, includeHidden: showHidden });
  }, [search, body, point, outlook, fromMs, showHidden]);
  const hiddenCount = useMemo(() => (search.status === 'done' ? search.groups.filter(g => !g.best.visible).length : 0), [search]);
  const rows = useMemo(() => sortStands(pickDistinct(ranked, SUGGEST_MAX_ROWS), sort), [ranked, sort]);
  const allDistinct = useMemo(() => pickDistinct(ranked, 9999).length, [ranked]);
  const recommended = useMemo(() => rows.filter(c => c.recommended).length, [rows]);

  const ringKm = neededDistanceKm(size.lengthM);
  const focal = Math.max(50, Math.round(neededFocalMm() / 50) * 50);
  const sub = building && target.building
    ? `${L3(language, '높이', 'Height', '高さ')} ${Math.round(target.building.heightM)} m · ${L3(language, '꼭대기 해발', 'top ASL', '頂上標高')} ${Math.round(target.building.topElevM)} m`
    : `${L3(language, '해발', 'Height ASL', '標高')} ${Math.round(target.elevM)} m`;
  const bodyWord = theme.body === 'sun' ? L3(language, '해', 'Sun', '太陽') : L3(language, '달', 'Moon', '月');
  const loadingForecast = outlookState === 'loading';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <PressScale onPress={onBack} accessibilityLabel={L3(language, '뒤로', 'Back', '戻る')} style={styles.backBtn}>
          <Text style={styles.backText}>{L3(language, '뒤로', 'Back', '戻る')}</Text>
        </PressScale>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>{building ? L3(language, '건물', 'Building', '建物') : L3(language, '지형 지점', 'Terrain point', '地形の点')}{building && target.building ? ` · ${Math.round(target.building.heightM)} m` : ''}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{sub}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.settings}>
          <Text style={styles.label}>{L3(language, '이 대상에 어울리는 주제', 'Themes for this target', 'この対象に合うテーマ')}</Text>
          <View style={styles.chipWrap}>
            {themes.map(t => t.ready
              ? <Chip key={t.id} label={themeLabel(t.id, building, language)} on={t.id === themeId} onPress={() => setThemeId(t.id)} />
              : (
                <View key={t.id} style={styles.chipOff} accessibilityState={{ disabled: true }}>
                  <Text style={styles.chipOffText} numberOfLines={1}>{themeLabel(t.id, building, language)} · {L3(language, '준비 중', 'coming', '準備中')}</Text>
                </View>
              ))}
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{L3(language, `${bodyWord} 크기 = 대상의`, `${bodyWord} size = the target's`, `${bodyWord}の大きさ = 対象の`)}</Text>
            <View style={styles.settingChips}>
              {sizes.map(s => (
                <Chip key={s.id} label={s.id === 'whole' ? `${L3(language, '전체 높이', 'whole height', '全高')} ${Math.round(s.lengthM)} m` : `${building ? L3(language, '꼭대기', 'top', '頂上') : L3(language, '정상', 'summit', '山頂')} ${s.lengthM} m`} on={s.id === sizeId} onPress={() => setSizeId(s.id)} />
              ))}
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{L3(language, '기간', 'Period', '期間')}</Text>
            <View style={styles.settingChips}>
              {SUGGEST_PERIOD_CHOICES.map(d => <Chip key={d} label={L3(language, `앞으로 ${d}일`, `next ${d} d`, `今後${d}日`)} on={d === days} onPress={() => setDays(d)} />)}
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>{L3(language, '서 있을 곳', 'Stand on', '立つ場所')}</Text>
            <View style={styles.settingChips}>
              <Chip label={`${L3(language, '땅 위만', 'Ground only', '地上のみ')} · ${L3(language, '눈 높이', 'eye', '目の高さ')} ${eyeAboveGroundM} m`} on onPress={() => {}} />
              <View style={styles.chipOff} accessibilityState={{ disabled: true }}>
                <Text style={styles.chipOffText}>{L3(language, '옥상 포함 · 준비 중', 'Rooftops · coming', '屋上も · 準備中')}</Text>
              </View>
            </View>
          </View>
          {theme.ready && (
            <Text style={styles.need}>
              {L3(language, `필요 거리 약 ${ringKm.toFixed(1)} km · ${focal} mm 환산 이상`, `Distance needed about ${ringKm.toFixed(1)} km · ${focal} mm equiv. or longer`, `必要距離 約${ringKm.toFixed(1)} km · ${focal} mm換算以上`)}
            </Text>
          )}
        </View>

        {theme.ready && (
          <View style={styles.mapBox}>
            <StandMap ringKm={ringKm} target={point} rows={rows} selected={selected} language={language} onSelect={setSelected} />
          </View>
        )}

        <View style={styles.listBox}>
          <View style={styles.listHead}>
            <Text style={styles.label}>{L3(language, '후보 · 기하 조건과 날씨 순', 'Candidates · geometry and weather', '候補 · 幾何条件と天気順')}</Text>
            <View style={{ flex: 1 }} />
            {(['score', 'date'] as const).map(k => (
              <Chip key={k} label={k === 'score' ? L3(language, '좋은 순', 'Best', '良い順') : L3(language, '날짜순', 'Date', '日付順')} on={sort === k} onPress={() => setSort(k)} />
            ))}
          </View>

          {search.status === 'running' && (
            <View style={styles.progressTrack} accessibilityLabel={L3(language, '찾는 중', 'Searching', '探索中')}>
              <View style={[styles.progressFill, { width: `${Math.round(search.progress * 100)}%` }]} />
            </View>
          )}
          {!theme.ready && <Text style={styles.empty}>{L3(language, '이 주제는 아직 준비 중이에요. 달 걸기나 해 걸기를 골라 주세요.', 'This theme is not ready yet. Pick moon or sun.', 'このテーマはまだ準備中です。月か太陽を選んでください。')}</Text>}
          {search.status === 'noTerrain' && (
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{L3(language, '이 자리의 지형을 아직 못 받았어요. 받은 뒤에 다시 찾을 수 있어요.', 'The terrain here has not loaded yet. Try again once it has.', 'この場所の地形をまだ受信していません。受信後にもう一度探せます。')}</Text>
              <PressScale onPress={() => setRetry(n => n + 1)} accessibilityLabel={L3(language, '다시 찾기', 'Search again', 'もう一度探す')} style={styles.retryBtn}>
                <Text style={styles.retryText}>{L3(language, '다시 찾기', 'Search again', 'もう一度探す')}</Text>
              </PressScale>
            </View>
          )}
          {search.status === 'noPosition' && <Text style={styles.empty}>{L3(language, '이 대상의 위치를 몰라 자리를 찾을 수 없어요.', 'The position of this target is unknown, so no spot can be found.', 'この対象の位置が不明なため場所を探せません。')}</Text>}
          {search.status === 'error' && <Text style={styles.empty}>{L3(language, '찾는 중에 문제가 생겼어요.', 'Something went wrong while searching.', '探索中に問題が発生しました。')}</Text>}
          {search.status === 'done' && (
            <>
              <View style={styles.countRow}>
                <Text style={styles.count}>
                  {L3(language, `${rows.length}곳 · 추천 ${recommended}`, `${rows.length} spots · ${recommended} recommended`, `${rows.length}件 · おすすめ ${recommended}`)}
                  {allDistinct > rows.length ? L3(language, ` · 전체 ${allDistinct}곳 중 위쪽`, ` · top of ${allDistinct}`, ` · 全${allDistinct}件の上位`) : ''}
                </Text>
                {hiddenCount > 0 && <Chip label={showHidden ? L3(language, `가려진 ${hiddenCount}곳 포함`, `incl. ${hiddenCount} hidden`, `隠れた${hiddenCount}件を含む`) : L3(language, `가려진 ${hiddenCount}곳 숨김`, `${hiddenCount} hidden`, `隠れた${hiddenCount}件を非表示`)} on={showHidden} onPress={() => setShowHidden(v => !v)} />}
              </View>
              {rows.length === 0 && (
                <Text style={styles.empty}>
                  {L3(language, `앞으로 ${days}일 안에 이 조건으로 서 있을 자리가 없어요. 크기나 기간을 바꿔 보세요.`, `No spot fits within ${days} days. Change the size or period.`, `今後${days}日以内にこの条件の場所はありません。大きさや期間を変えてみてください。`)}
                </Text>
              )}
              {rows.map(c => (
                <PressScale
                  key={c.hit.timeMs}
                  onPress={() => onPick(c)}
                  accessibilityLabel={`${fmtDay(c.hit.timeMs, language)} ${fmtTime(c.hit.timeMs)}`}
                  style={[styles.row, c.recommended && styles.rowRec, selected === c.hit.timeMs && styles.rowSel]}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{fmtDay(c.hit.timeMs, language)} {fmtTime(c.hit.timeMs)} {eventName(c, language)}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {c.hit.latitude.toFixed(4)}, {c.hit.longitude.toFixed(4)} · {L3(language, '해발', 'ASL', '標高')} {Math.round(c.hit.groundElevM)} m · {fmtKm(c.hit.distM)}
                    </Text>
                    <Text style={styles.rowSub2} numberOfLines={1}>
                      {c.moon ? `${moonName(c.moon, language)} · ${skyName(c, language)}` : `${L3(language, '해 고도', 'Sun altitude', '太陽高度')} ${c.hit.altDeg.toFixed(1)}°${c.hit.altDeg <= 8 ? ` · ${L3(language, '노을빛', 'golden light', '夕焼けの光')}` : ''}`}{!c.hit.visible ? ` · ${L3(language, '지형에 가림', 'hidden by terrain', '地形に隠れる')}` : ''}{c.hit.onWater ? ` · ${L3(language, '물 위', 'on water', '水上')}` : ''}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={[styles.forecast, c.forecast.state === 'clear' && styles.fClear, c.forecast.state === 'partly' && styles.fPartly, c.forecast.state === 'cloudy' && styles.fCloudy, c.forecast.state === 'unknown' && styles.fUnknown]}>
                      {forecastName(c.forecast, language, loadingForecast)}
                    </Text>
                    <Text style={styles.days}>{c.days <= 0 ? L3(language, '오늘', 'today', '今日') : L3(language, `${c.days}일 뒤`, `in ${c.days} d`, `${c.days}日後`)}</Text>
                  </View>
                </PressScale>
              ))}
              {rows.length > 0 && <Text style={styles.footnote}>{L3(language, '예보는 대상 위치의 시간별 구름이에요. 서 있을 곳은 지도 자료로 바다와 3 km 안의 물을 거른 것이라 강·호수·사유지는 직접 확인해야 해요.', 'The forecast is hourly cloud at the target. The spots only exclude sea and water within 3 km, so check rivers, lakes and private land yourself.', '予報は対象位置の時間別の雲です。立つ場所は地図データで海と3km以内の水を除いただけなので、川・湖・私有地は自分で確認してください。')}</Text>}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

/** 지도: 대상을 가운데에 두고 북쪽이 위. 점선 고리는 필요 거리, 점은 후보(추천은 채움, 고른 것은 크게 + 대상과 잇는 선). */
const StandMap: React.FC<{
  ringKm: number;
  target: ReturnType<typeof suggestTargetPoint>;
  rows: StandCandidate[];
  selected: number | null;
  language: Lang;
  onSelect: (key: number | null) => void;
}> = ({ ringKm, target, rows, selected, language, onSelect }) => {
  const styles = useStyles();
  const W = 360, H = 170, cx = W / 2, cy = H / 2 + 4, R = 62;
  const scale = R / (ringKm * 1000);
  const aria = L3(language, `지도: 대상에서 ${ringKm.toFixed(1)} km 고리 위의 후보 ${rows.length}곳`, `Map: ${rows.length} candidates on the ${ringKm.toFixed(1)} km ring around the target`, `地図: 対象から${ringKm.toFixed(1)} kmの輪の上の候補${rows.length}件`);
  const at = (c: StandCandidate) => (target ? { x: cx + (c.hit.eastM - target.eastM) * scale, y: cy + (c.hit.southM - target.southM) * scale } : { x: cx, y: cy });
  const sel = rows.find(c => c.hit.timeMs === selected);
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel={aria} style={styles.map}>
        <Circle cx={cx} cy={cy} r={R} fill="none" stroke="#38BDF8" strokeWidth={1.5} strokeDasharray="4 4" />
        <SvgText x={cx} y={11} fill="#94A3B8" fontSize={9} fontFamily={mono} textAnchor="middle">N</SvgText>
        {sel && <Line x1={cx} y1={cy} x2={at(sel).x} y2={at(sel).y} stroke="#A5B4FC" strokeWidth={1} />}
        <Circle cx={cx} cy={cy} r={5} fill="#F1F5F9" />
        <SvgText x={cx + 9} y={cy + 4} fill="#F1F5F9" fontSize={10}>{L3(language, '대상', 'target', '対象')}</SvgText>
        {rows.map(c => {
          const p = at(c);
          const isSel = c.hit.timeMs === selected;
          const color = c.hit.visible ? '#38BDF8' : '#F87171';
          return (
            <React.Fragment key={c.hit.timeMs}>
              <Circle cx={p.x} cy={p.y} r={isSel ? 7 : 5} fill={isSel ? color : c.recommended ? color : 'none'} fillOpacity={isSel ? 1 : 0.45} stroke={color} strokeWidth={isSel ? 2.5 : 1.5} />
              <Circle cx={p.x} cy={p.y} r={13} fill="transparent" onPress={() => onSelect(isSel ? null : c.hit.timeMs)} />
            </React.Fragment>
          );
        })}
      </Svg>
      <Text style={styles.mapBadge}>{L3(language, `점선 = 거리 ${ringKm.toFixed(1)} km`, `dashed = ${ringKm.toFixed(1)} km`, `点線 = 距離 ${ringKm.toFixed(1)} km`)}</Text>
    </View>
  );
};

interface ModalProps extends StandSuggestViewProps {
  visible: boolean;
}

/** 전체 화면 모달. */
export const StandSuggestModal: React.FC<ModalProps> = ({ visible, onBack, ...rest }) => (
  <Modal visible={visible} animationType="slide" onRequestClose={onBack}>
    {visible ? <StandSuggestView {...rest} onBack={onBack} /> : <View />}
  </Modal>
);

const useStyles = makeStyles((color) => ({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: color.panel, borderBottomWidth: 1, borderBottomColor: color.border },
  backBtn: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.xs },
  backText: { fontSize: 13, color: color.text },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: color.text },
  subtitle: { fontFamily: mono, fontSize: 11, color: color.textDim },
  body: { paddingBottom: 24 },
  settings: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: color.panel },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: color.textMute },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipOff: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.xs, borderWidth: 1, borderColor: color.border, opacity: 0.55 },
  chipOffText: { fontSize: 13, color: color.textMute },
  settingRow: { gap: 4 },
  settingLabel: { fontFamily: mono, fontSize: 9, color: color.textMute },
  settingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  need: { fontSize: 11, color: color.textDim },
  mapBox: { backgroundColor: '#0f1625', borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.border },
  map: { backgroundColor: '#0f1625' },
  mapBadge: { position: 'absolute', left: 10, top: 8, fontFamily: mono, fontSize: 9, color: '#94A3B8', backgroundColor: 'rgba(10,15,26,0.82)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.xs, overflow: 'hidden' },
  listBox: { paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressTrack: { height: 2, backgroundColor: color.fill, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, backgroundColor: color.accent },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { flex: 1, fontFamily: mono, fontSize: 11, color: color.textDim },
  empty: { fontSize: 12, color: color.textDim, paddingVertical: 6 },
  emptyBox: { gap: 8 },
  retryBtn: { minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accentLine, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '700', color: color.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.fill, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: 'transparent' },
  rowRec: { backgroundColor: 'rgba(56,189,248,0.08)', borderColor: color.accentLine },
  rowSel: { borderColor: color.accent },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: color.text },
  rowSub: { fontFamily: mono, fontSize: 10, color: color.textDim },
  rowSub2: { fontSize: 11, color: color.textDim },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  forecast: { fontSize: 11, color: color.textDim },
  fClear: { color: color.success },
  fPartly: { color: color.textDim, textDecorationLine: 'underline', textDecorationStyle: 'dashed' },
  fCloudy: { color: color.danger },
  fUnknown: { color: color.textMute },
  days: { fontFamily: mono, fontSize: 9, color: color.textDim },
  footnote: { fontSize: 10, color: color.textMute, paddingTop: 6 },
}));
