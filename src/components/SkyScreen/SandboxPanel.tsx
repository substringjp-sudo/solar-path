/**
 * SandboxPanel.tsx — 샌드박스(전문가 모드) 구도 도구: 눈 높이 · 위치 이동 · "내 위치 아님".
 * docs/SANDBOX_MODE_PLAN.md 2.2 · 12.2. 하늘 위의 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 *
 * - 읽음 줄(맨 위): 지금 시선의 방위 · 앙각과 눈 높이(`SandboxDials.ViewReadout`). 시선은 장면이 `getView` 로 알려 줍니다.
 * - 주변 불러오는 중: 멈춘 뒤 건물을 받는 동안 진행 막대("주변 불러오는 중 · 건물 62 %"). 움직이는 동안에는 숨깁니다(그동안은 받지 않습니다).
 * - 눈 높이: 칩 5개. 눈이 그 높이에서 보는 지형·건물·구름으로 다시 그립니다.
 * - 이동: 조이스틱(`SandboxDials.MoveStick`)은 민 방향과 정도만 알리고, `useJoystickDriver` 가 프레임마다 속도(데드존을 뺀 민 정도의 제곱 × 모드 최고 속도, 0.3 초에 걸쳐 부드럽게)로
 *   장면의 눈을 옮깁니다. 손을 놓고 속도가 가라앉으면 그 자리를 새 위치로 한 번만 저장하고, 그때 날씨 · 지형 · 건물을 받습니다. 모드: 걷기 2 · 자전거 8 · 차 25 · 비행 120 m/s.
 *   지금 속도는 움직이는 동안 숫자로 보입니다. 스크린리더는 북·동·남·서 동작 한 번에 모드 최고 속도로 5 초 가는 거리를 한 번에 갑니다.
 * - 이동 방향 기준: 속도 숫자 아래의 단추로 "시선 기준"(손잡이 위 = 지금 보는 방향, 처음 값)과 "북 기준"(손잡이 위 = 북)을 오갑니다. 시선을 못 읽으면 북 기준으로 움직입니다.
 * - 내 위치 아님: 기기 위치에서 멀면(`awayM`, 움직이는 동안에는 눈의 자리 기준으로 실시간) 알리고, "내 위치로"로 돌아옵니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { MoveStick, ViewReadout } from './SandboxDials';
import type { ViewAzEl } from '../../utils/sandboxDials';
import { MODE_MAX_SPEED_MPS, MOVE_MODES, formatSpeed, type HeadingRef, type MoveMode } from '../../utils/joystickMotion';
import type { LatLon } from '../../utils/joystickDriver';
import { loadBar, type LoadBar, type LoadProgress } from '../../utils/loadProgress';
import { distanceM } from '../../utils/geoMove';
import { useJoystickDriver, type DriverHost } from '../../hooks/useJoystickDriver';

/** 먼 건물 받기 상태(계획 6). loading 중엔 진행, done 이면 결과, off 는 건물 레이어가 꺼져 있거나 지형이 아직 없음. */
export interface FarStatus {
  state: 'loading' | 'done' | 'off' | 'error';
  tilesDone: number;
  tilesTotal: number;
  bytes: number;
  buildings?: number;
  truncated?: boolean;
  failed?: number;
}

export const EYE_HEIGHT_CHOICES_M = [1.6, 10, 30, 100, 300] as const;

/** 이 거리(m) 넘게 떨어지면 "내 위치 아님". */
export const AWAY_THRESHOLD_M = 150;

interface Props {
  language: 'ko' | 'en' | 'ja';
  eyeHeightM: number;
  onEyeHeight: (m: number) => void;
  /** 이동 모드(걷기 · 자전거 · 차 · 비행). 손잡이를 끝까지 밀었을 때의 속도가 모드로 정해집니다. */
  mode: MoveMode;
  onMode: (m: MoveMode) => void;
  /** 이동이 장면 · 저장소에 닿는 길(`useJoystickDriver`): 저장된 위치 읽기, 장면의 눈 옮기기 · 거두기, 새 위치 저장. */
  drive: Pick<DriverHost, 'getOrigin' | 'setEye' | 'clearEye' | 'commit'>;
  /** 저장된 위치에서 기기 위치까지의 거리(m). 기기 위치를 모르면 null. */
  awayM: number | null;
  /** 기기 위치. 주면 움직이는 동안 "내 위치 아님" 거리를 눈의 자리 기준으로 실시간 갱신합니다. */
  home?: LatLon | null;
  onHome: () => void;
  /** 장면이 알려 주는 지금 시선(방위 · 앙각). 주면 맨 위에 읽음 줄을 그리고, "시선 기준" 이동을 쓸 수 있습니다. 없으면 둘 다 없습니다. */
  getView?: () => ViewAzEl | null;
  /** 멈춘 뒤 주변(건물)을 받는 진행. 주면 받는 동안 막대를 보여 줍니다. */
  getLoad?: () => LoadProgress | null;
  /** 먼 건물(보는 방향만 받음). 없으면 이 줄을 그리지 않습니다. */
  far?: { status: FarStatus | null; onLoad: () => void };
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m % 1 === 0 ? m : m.toFixed(1)} m`);

const fmtMB = (b: number) => `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;

/** 모드 이름과 쓰임(스크린리더 · 목업의 "이동 속도" 표). */
const MODE_TEXT: Record<MoveMode, { ko: [string, string]; en: [string, string]; ja: [string, string] }> = {
  walk: { ko: ['걷기', '걸어서 둘러보기'], en: ['Walk', 'look around on foot'], ja: ['徒歩', '歩いて見て回る'] },
  bike: { ko: ['자전거', '공원과 강변'], en: ['Bike', 'parks and riverside'], ja: ['自転車', '公園と川沿い'] },
  car: { ko: ['차', '동네에서 동네로'], en: ['Car', 'from town to town'], ja: ['車', '町から町へ'] },
  fly: { ko: ['비행', '도시 전체'], en: ['Fly', 'the whole city'], ja: ['飛行', '街全体'] },
};
const modeName = (m: MoveMode, lang: 'ko' | 'en' | 'ja') => MODE_TEXT[m][lang][0];
const modeUse = (m: MoveMode, lang: 'ko' | 'en' | 'ja') => MODE_TEXT[m][lang][1];

const sameBar = (a: LoadBar | null, b: LoadBar | null) => a === b || (!!a && !!b && a.title === b.title && a.detail === b.detail && a.fraction === b.fraction && a.tone === b.tone);

/** 멈춘 뒤 주변(건물)을 받는 진행 막대. 장면이 알려 주는 진행(`getLoad`)을 4 번/초 읽고, 글이 바뀔 때만 다시 그립니다. */
const LoadBarView: React.FC<{ language: 'ko' | 'en' | 'ja'; getLoad: () => LoadProgress | null }> = ({ language, getLoad }) => {
  const get = React.useRef(getLoad);
  get.current = getLoad;
  const [bar, setBar] = React.useState<LoadBar | null>(null);
  React.useEffect(() => {
    const tick = () => { const b = loadBar(get.current(), language); setBar(p => (sameBar(p, b) ? p : b)); };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [language]);
  if (!bar) return null;
  const retry = bar.tone === 'retry';
  return (
    <View
      style={styles.loadBar}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={bar.detail ? `${bar.title}, ${bar.detail}` : bar.title}
      accessibilityValue={bar.fraction != null ? { min: 0, max: 100, now: Math.round(bar.fraction * 100) } : undefined}
    >
      <View style={styles.loadHead}>
        <Text style={[styles.loadTitle, retry && { color: DARK.danger }]} numberOfLines={1}>{bar.title}</Text>
        {bar.detail != null && <Text style={styles.loadDetail} numberOfLines={1}>{bar.detail}</Text>}
      </View>
      <View style={styles.loadTrack}>
        {bar.fraction != null && <View style={[styles.loadFill, { width: `${Math.round(bar.fraction * 100)}%` }]} />}
      </View>
    </View>
  );
};

export const SandboxPanel: React.FC<Props> = ({ language, eyeHeightM, onEyeHeight, mode, onMode, drive, awayM, home, onHome, getView, getLoad, far }) => {
  // 이동 방향 기준: 켜짐 = 시선 기준(손잡이 위 = 지금 보는 방향, 처음 값), 꺼짐 = 북 기준(손잡이 위 = 북). 시선을 못 읽는 장면이면 북 기준으로만 움직입니다.
  const [rel, setRel] = React.useState(true);
  const ref: HeadingRef = rel && getView ? 'view' : 'compass';
  const driver = useJoystickDriver({ ...drive, mode, ref, getHeading: () => getView?.()?.az ?? null });
  const { moving, speed, eye } = driver.readout;
  // 움직이는 동안에는 눈의 자리에서, 멈춘 뒤에는 저장된 위치에서 잰 거리
  const away = home && eye ? distanceM(home, eye) : awayM;
  const awayShown = away != null && away > AWAY_THRESHOLD_M;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {getView && <ViewReadout language={language} getView={getView} eyeHeightM={eyeHeightM} />}
      {getLoad && !moving && <LoadBarView language={language} getLoad={getLoad} />}
      {awayShown && (
        <View style={styles.awayRow}>
          <View style={styles.awayBadge}>
            <Text style={styles.awayText} numberOfLines={1}>
              {L3(language, '내 위치 아님', 'Not my location', '現在地ではない')} · {fmtM(Math.round(away!))}
            </Text>
          </View>
          <OverlayButton onPress={() => { driver.cancel(); onHome(); }} accessibilityLabel={L3(language, '내 위치로', 'Back to my location', '現在地へ')} style={styles.homeBtn}>
            <LocateFixed size={14} color={DARK.accent} />
            <Text style={styles.homeText}>{L3(language, '내 위치로', 'Home', '現在地へ')}</Text>
          </OverlayButton>
        </View>
      )}

      <Text style={styles.label}>{L3(language, '눈 높이', 'Eye height', '目の高さ')}</Text>
      <View style={styles.chipRow}>
        {EYE_HEIGHT_CHOICES_M.map(h => (
          <OverlayButton
            key={h}
            active={Math.abs(eyeHeightM - h) < 0.01}
            onPress={() => onEyeHeight(h)}
            accessibilityLabel={`${L3(language, '눈 높이', 'Eye height', '目の高さ')} ${h} m`}
            style={styles.chip}
          >
            <Text style={[styles.chipText, Math.abs(eyeHeightM - h) < 0.01 && { color: DARK.accent }]}>{h}</Text>
          </OverlayButton>
        ))}
        <Text style={styles.unit}>m</Text>
      </View>

      <Text style={styles.label}>{L3(language, '위치 이동', 'Move', '位置移動')}</Text>
      <View style={styles.moveRow}>
        <MoveStick language={language} onStick={driver.onStick} onNudge={driver.nudge} relative={ref === 'view'} />
        <View style={styles.moveCol}>
          <View
            style={styles.speedBox}
            accessible
            accessibilityLabel={`${L3(language, '지금 속도', 'Current speed', '現在の速度')} ${formatSpeed(speed)}`}
          >
            <Text style={styles.speedLabel}>{L3(language, '지금 속도', 'SPEED', '速度')}</Text>
            <Text style={[styles.speedValue, moving && { color: DARK.accent }]} numberOfLines={1}>{formatSpeed(speed)}</Text>
          </View>
          {getView && (
            <OverlayButton
              active={rel}
              onPress={() => setRel(r => !r)}
              accessibilityLabel={`${L3(language, '이동 방향 기준', 'Move direction reference', '移動方向の基準')}: ${rel ? L3(language, '시선 기준', 'where you look', '視線基準') : L3(language, '북 기준', 'north', '北基準')}`}
              style={styles.refBtn}
            >
              <Text style={[styles.modeText, rel && { color: DARK.accent }]}>{rel ? L3(language, '시선 기준', 'View-up', '視線基準') : L3(language, '북 기준', 'North-up', '北基準')}</Text>
              <Text style={styles.stepSub}>{L3(language, '이동 방향', 'move axis', '移動方向')}</Text>
            </OverlayButton>
          )}
        </View>
      </View>
      <View style={styles.modeRow}>
        {MOVE_MODES.map(m => (
          <OverlayButton
            key={m}
            active={m === mode}
            onPress={() => onMode(m)}
            accessibilityLabel={`${modeName(m, language)}, ${L3(language, '최고', 'max', '最高')} ${MODE_MAX_SPEED_MPS[m]} m/s, ${modeUse(m, language)}`}
            style={styles.modeChip}
          >
            <Text style={[styles.chipText, m === mode && { color: DARK.accent }]}>{modeName(m, language)}</Text>
          </OverlayButton>
        ))}
      </View>
      <Text style={styles.hint}>{L3(language, `끝까지 밀면 ${MODE_MAX_SPEED_MPS[mode]} m/s`, `Full push = ${MODE_MAX_SPEED_MPS[mode]} m/s`, `いっぱいに倒すと ${MODE_MAX_SPEED_MPS[mode]} m/s`)}</Text>

      {far && (
        <>
          <Text style={styles.label}>{L3(language, '먼 건물', 'Far buildings', '遠くの建物')}</Text>
          <View style={styles.farRow}>
            <OverlayButton
              onPress={far.status?.state === 'loading' ? undefined : far.onLoad}
              accessibilityLabel={L3(language, '보는 방향의 먼 건물 불러오기', 'Load far buildings in view', '視線方向の遠い建物を読む')}
              style={styles.farBtn}
            >
              <Text style={styles.farBtnText}>{far.status?.state === 'loading' ? L3(language, '받는 중…', 'Loading…', '読込中…') : L3(language, '보는 방향 불러오기', 'Load view', '視線方向を読む')}</Text>
            </OverlayButton>
            <Text style={styles.farStatus} numberOfLines={2}>
              {far.status?.state === 'loading' && `${far.status.tilesDone}/${far.status.tilesTotal}${L3(language, '장', ' tiles', '枚')} · ${fmtMB(far.status.bytes)}`}
              {far.status?.state === 'done' && `${L3(language, '건물', 'Buildings', '建物')} ${far.status.buildings ?? 0}${L3(language, '채', '', '棟')} · ${fmtMB(far.status.bytes)}${far.status.truncated ? ` · ${L3(language, '한도에서 멈춤', 'stopped at the limit', '上限で停止')}` : ''}${far.status.failed ? ` · ${L3(language, `실패 ${far.status.failed}장`, `${far.status.failed} failed`, `失敗${far.status.failed}枚`)}` : ''}`}
              {far.status?.state === 'off' && L3(language, '지형을 아직 못 받았어요', 'Terrain is not loaded yet', '地形をまだ受信していません')}
              {far.status?.state === 'error' && L3(language, '받지 못했어요', 'Could not load', '読み込めませんでした')}
              {!far.status && L3(language, '도심은 한 장이 약 0.4 MB 라 보는 방향만 받아요', 'Downtown tiles are ~0.4 MB each, so only the view direction is loaded', '市街地は1枚約0.4MBなので視線方向だけ読みます')}
            </Text>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontFamily: mono, fontSize: 9, letterSpacing: 1, color: DARK.textMute, marginTop: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { width: 38, height: 28 },
  chipText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.text },
  unit: { fontFamily: mono, fontSize: 11, color: DARK.textDim, marginLeft: 2 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moveCol: { gap: 4 },
  // 지금 속도: 글꼴이 등폭이라 숫자가 바뀌어도 폭이 흔들리지 않습니다("120 m/s" 가 가장 깁니다).
  speedBox: {
    width: 76, height: 44, alignItems: 'center', justifyContent: 'center', gap: 1,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.xs,
  },
  speedLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 0.6, color: DARK.textMute },
  speedValue: { fontFamily: mono, fontSize: 14, fontWeight: '700', color: DARK.text },
  refBtn: { width: 76, height: 40, flexDirection: 'column' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  modeChip: { width: 'auto', minWidth: 44, height: 28, paddingHorizontal: 6, flexShrink: 0 },
  modeText: { fontSize: 11, fontWeight: '700', color: DARK.text },
  stepSub: { fontSize: 9, color: DARK.textDim },
  hint: { fontFamily: mono, fontSize: 10, color: DARK.textDim },
  loadBar: {
    alignSelf: 'stretch', gap: 4, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: DARK.overlay, borderColor: DARK.border, borderWidth: 1, borderRadius: radius.xs,
  },
  loadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  loadTitle: { fontSize: 11, fontWeight: '700', color: DARK.text, flexShrink: 1 },
  loadDetail: { fontFamily: mono, fontSize: 10, color: DARK.textDim },
  loadTrack: { height: 3, borderRadius: 2, backgroundColor: DARK.border, overflow: 'hidden' },
  loadFill: { height: 3, borderRadius: 2, backgroundColor: DARK.accent },
  farRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  farBtn: { width: 'auto', minWidth: 96, height: 30, paddingHorizontal: 8, flexShrink: 0 },
  farBtnText: { fontSize: 11, fontWeight: '700', color: DARK.text },
  farStatus: { flex: 1, minWidth: 0, fontFamily: mono, fontSize: 10, color: DARK.textDim },
  awayRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  awayBadge: {
    backgroundColor: DARK.overlay,
    borderColor: DARK.danger,
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 190,
  },
  awayText: { fontFamily: mono, fontSize: 11, fontWeight: '700', color: DARK.danger },
  homeBtn: { width: 'auto', minWidth: 72, paddingHorizontal: 8, flexDirection: 'row', gap: 4, flexShrink: 0 },
  homeText: { fontSize: 11, fontWeight: '700', color: DARK.accent },
});
