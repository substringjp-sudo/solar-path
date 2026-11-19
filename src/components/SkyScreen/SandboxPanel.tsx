/**
 * SandboxPanel.tsx — 샌드박스(전문가 모드) 구도 도구: 눈 높이 · 위치 이동 · "내 위치 아님".
 * docs/SANDBOX_MODE_PLAN.md 2.2. 하늘 위의 떠 있는 것이라 화면 모드와 상관없이 어두운 재질(overlay)을 씁니다.
 *
 * - 눈 높이: 칩 5개. 눈이 그 높이에서 보는 지형·건물·구름으로 다시 그립니다.
 * - 이동: 조이스틱(`SandboxDials.MoveStick`) — 민 방향으로 누르고 있는 동안 `stepM` 미터씩 반복합니다(스크린리더는 북·동·남·서 동작 한 걸음씩). 위치가 바뀔 때마다 날씨·지형은 새 자리 것을 받습니다.
 * - 내 위치 아님: 기기 위치에서 멀면(`awayM`) 알리고, "내 위치로"로 돌아옵니다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { OverlayButton } from '../ui';
import { color as DARK, mono, radius } from '../../theme/tokens';
import { L3 } from '../../utils/i18n';
import { MoveStick } from './SandboxDials';

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
export const MOVE_STEP_CHOICES_M = [10, 100, 1000] as const;

/** 이 거리(m) 넘게 떨어지면 "내 위치 아님". */
export const AWAY_THRESHOLD_M = 150;

interface Props {
  language: 'ko' | 'en' | 'ja';
  eyeHeightM: number;
  onEyeHeight: (m: number) => void;
  stepM: number;
  onStep: (m: number) => void;
  /** 동쪽(+)·북쪽(+) 미터 */
  onMove: (eastM: number, northM: number) => void;
  /** 기기 위치에서 떨어진 거리(m). 기기 위치를 모르면 null. */
  awayM: number | null;
  onHome: () => void;
  /** 먼 건물(보는 방향만 받음). 없으면 이 줄을 그리지 않습니다. */
  far?: { status: FarStatus | null; onLoad: () => void };
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m % 1 === 0 ? m : m.toFixed(1)} m`);

const fmtMB = (b: number) => `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;

export const SandboxPanel: React.FC<Props> = ({ language, eyeHeightM, onEyeHeight, stepM, onStep, onMove, awayM, onHome, far }) => {
  const away = awayM != null && awayM > AWAY_THRESHOLD_M;
  const nextStep = () => {
    const i = MOVE_STEP_CHOICES_M.indexOf(stepM as (typeof MOVE_STEP_CHOICES_M)[number]);
    onStep(MOVE_STEP_CHOICES_M[(i + 1) % MOVE_STEP_CHOICES_M.length]);
  };
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {away && (
        <View style={styles.awayRow}>
          <View style={styles.awayBadge}>
            <Text style={styles.awayText} numberOfLines={1}>
              {L3(language, '내 위치 아님', 'Not my location', '現在地ではない')} · {fmtM(Math.round(awayM!))}
            </Text>
          </View>
          <OverlayButton onPress={onHome} accessibilityLabel={L3(language, '내 위치로', 'Back to my location', '現在地へ')} style={styles.homeBtn}>
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
        <MoveStick language={language} stepM={stepM} onMove={onMove} />
        <OverlayButton onPress={nextStep} accessibilityLabel={`${L3(language, '이동 간격', 'Step', '移動幅')} ${fmtM(stepM)}`} style={styles.stepBtn}>
          <Text style={styles.stepText}>{fmtM(stepM)}</Text>
          <Text style={styles.stepSub}>{L3(language, '한 걸음', 'per step', '1歩')}</Text>
        </OverlayButton>
      </View>

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
  stepBtn: { width: 64, height: 44, flexDirection: 'column' },
  stepText: { fontFamily: mono, fontSize: 13, fontWeight: '700', color: DARK.text },
  stepSub: { fontSize: 9, color: DARK.textDim },
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
