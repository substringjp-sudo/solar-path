/**
 * SkyFrame.tsx — 하늘 화면의 새 틀(목업 "4차 b" · "5차: 모드 줄", 새 화면 틀 실험 스위치가 켜졌을 때만).
 *
 * 맨 아래 고정부는 위에서부터 칩 줄 · 시간 자 · 셔터 줄 · 모드 줄이고, 그 위에 펼친 영역이 얹힙니다(`glass/DockSheet`).
 *  - 시뮬레이션: 칩 `어제 · 오늘 · 내일 · 날짜`. "날짜"를 누르면 일주일 줄이 펼쳐지고, 끝까지 펼치면 `simBody`(점수 · 그래프 · 다가오는 좋은 순간)가 이어집니다.
 *  - 샌드박스: 칩 `이동 · 보기 · 장면 · 도구`. 칩을 누르면 그 칩의 내용이 펼쳐지고, 같은 칩을 다시 누르면 접힙니다.
 *  - 모드 줄: 시뮬레이션 · 샌드박스 · 사진 · 천체 · 타임랩스. 카메라 쪽 모드로 가면 `onSwitch` 가 사진에 내린 결과(보던 방향이 가이드)를 받습니다.
 * 시각을 바꾸는 일은 모두 `onSlideStart` → `onPick` → `onSlideEnd` 로 알립니다("time" 은 하루 안에서 끄는 것, "date" 는 날짜가 바뀌는 것 — 하늘 화면이 날씨를 새로 받는 때가 다릅니다).
 * 안의 내용(`simBody` · `sandbox.*`)은 부르는 쪽이 넣습니다: 기존 조작부를 그대로 재사용합니다.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Bookmark, Camera, FolderOpen } from 'lucide-react-native';
import { BottomDock, type BottomDockChip } from '../glass/BottomDock';
import { GlassSurface } from '../glass/GlassSurface';
import { Scrim } from '../glass/Scrim';
import { belowHeader } from '../../utils/headerLayout';
import { color as DARK, mono as monoFont } from '../../theme/tokens';
import { TEXT } from '../../theme/glassTokens';
import type { DockStage } from '../../utils/dockStages';
import { modeList, switchMode, type AppMode, type ChipId, type ModeSwitch } from '../../utils/modeStrip';
import { L3 } from '../../utils/i18n';
import { fmtAz, fmtEl, fmtEye, fmtZoom, viewDiffers, type ViewAzEl } from '../../utils/sandboxDials';
import { equivalentFocalMm } from '../../utils/lensInfo';

type Lang = 'ko' | 'en' | 'ja';
export type SlideKind = 'time' | 'date';
export type FrameMode = 'simulation' | 'sandbox';

interface Props {
  language: Lang;
  tz: number;
  /** 지금(오늘 · 어제 · 내일을 가르는 기준) */
  nowMs: number;
  timeMs: number;
  onSlideStart: (kind: SlideKind) => void;
  onPick: (ms: number, kind: SlideKind) => void;
  onSlideEnd: (kind: SlideKind) => void;
  /** "지금" 단추 */
  onNow: () => void;
  /** 날짜·시간·위치가 현재와 다를 때만 "지금" 단추를 보임. 생략하면 시각 차이(>1분)로 판단. */
  showNow?: boolean;
  live?: boolean;
  sunsetMs?: number | null;
  sunsetLabel?: string;
  /** 시간대별 점수 표본(자 위 색 띠) */
  scoreSamples?: readonly { t: number; score: number | null }[] | null;
  mode: FrameMode;
  /** 모드 줄에서 모드를 바꿨을 때. 카메라 쪽이면 `sw.mode` 는 사진이고 `sw.guide` 가 보던 방향입니다. */
  onSwitch: (sw: ModeSwitch) => void;
  /** 지금 보는 방향(가이드가 됨). 못 읽으면 null. */
  getView: () => { azDeg: number; elDeg: number } | null;
  /** 맨 위 읽음 줄(글이면 유리 알약에 담고, 요소면 그대로) */
  readout: React.ReactNode;
  /** 시뮬레이션을 끝까지 펼쳤을 때 보이는 내용 */
  simBody?: React.ReactNode;
  /** 샌드박스 칩별 펼친 내용 */
  sandbox?: Partial<Record<'shoot' | 'scene', React.ReactNode>>;
  /** 값이 증가하면 펼친 시트를 접습니다(미리보기 시작 등) */
  collapseNonce?: number;
  /** 하단 독 고정 높이 콜백 */
  onDockHeight?: (h: number) => void;
  /** 셔터: 이 장면 찍기 */
  onShoot: () => void;
  /** 오른쪽 아래: 장면 저장 */
  onSaveScene?: () => void;
  /** 왼쪽 아래 썸네일: 가장 최근 저장한 장면 열기(없으면 누를 수 없음) */
  onOpenLatestScene?: () => void;
  /** 달력 창 열기("날짜" 펼침 안의 "달력") */
  onOpenCalendar?: () => void;
  /** 시뮬레이션을 끝까지 펼쳐 `simBody` 가 보이는지가 바뀔 때(예보 카드는 펼칠 때 한 번 받습니다). */
  onSimBodyOpenChange?: (open: boolean) => void;
  /** 샌드박스 설정 시트 열림/닫힘 상태가 바뀔 때 */
  onSandboxSheetOpenChange?: (open: boolean) => void;
  /** 샌드박스 모드 전용 하단 통합 다이얼 슬라이더 */
  customRuler?: React.ReactNode;
}

export const SkyFrame: React.FC<Props> = ({
  language, tz, nowMs, timeMs, onSlideStart, onPick, onSlideEnd, onNow, showNow, live = false, sunsetMs = null, sunsetLabel, scoreSamples = null, mode, onSwitch, getView,
  readout, simBody, sandbox, collapseNonce = 0, onDockHeight, onShoot, onSaveScene, onOpenLatestScene, onOpenCalendar, onSimBodyOpenChange, onSandboxSheetOpenChange, customRuler,
}) => {
  const [stage, setStage] = React.useState<DockStage>('min');
  const [active, setActive] = React.useState<ChipId | 'shoot' | null>(null);
  const simBodyOpen = mode === 'simulation' && stage !== 'min';
  const simBodyCb = React.useRef(onSimBodyOpenChange);
  simBodyCb.current = onSimBodyOpenChange;
  React.useEffect(() => { simBodyCb.current?.(simBodyOpen); }, [simBodyOpen]);
  const sandboxSheetOpen = mode === 'sandbox' && stage !== 'min';
  const sandboxSheetCb = React.useRef(onSandboxSheetOpenChange);
  sandboxSheetCb.current = onSandboxSheetOpenChange;
  React.useEffect(() => { sandboxSheetCb.current?.(sandboxSheetOpen); }, [sandboxSheetOpen]);
  React.useEffect(() => { if (collapseNonce > 0) { setStage('min'); setActive(null); } }, [collapseNonce]);
  const modes = React.useMemo(() => modeList(false), []);

  const firstSandboxTab = React.useMemo(
    () => (sandbox?.shoot ? 'shoot' : null),
    [sandbox],
  );

  const setStageSafe = (s: DockStage) => {
    setStage(s);
    if (s === 'min') {
      setActive(null);
    } else if (mode === 'sandbox' && (!active || active === 'date') && firstSandboxTab) {
      setActive(firstSandboxTab);
    }
  };

  const pickMode = (target: AppMode) => {
    const sw = switchMode(mode, target, getView());
    setStageSafe('min');
    onSwitch(sw);
  };

  let expanded: React.ReactNode | ((maxH: number) => React.ReactNode) = null;
  if (mode === 'sandbox') {
    const sbTab = (active && active !== 'date' && sandbox?.[active as 'shoot' | 'scene'])
      ? (active as 'shoot' | 'scene')
      : firstSandboxTab;
    if (sbTab && sandbox?.[sbTab]) {
      expanded = (maxH: number) => {
        const panelMaxH = Math.max(96, maxH - 8);
        const node = sandbox[sbTab];
        return (
          <GlassSurface blurred testID={`panel-${sbTab}`} style={[styles.panel, { maxHeight: panelMaxH }]}>
            {sbTab === 'shoot' ? (
              React.isValidElement(node)
                ? React.cloneElement(node as React.ReactElement<any>, { maxHeight: panelMaxH })
                : node
            ) : (
              <ScrollView
                style={[styles.panelScroll, { maxHeight: panelMaxH }]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.panelContent}
              >
                {node}
              </ScrollView>
            )}
          </GlassSurface>
        );
      };
    }
  } else if (mode === 'simulation' && simBody) {
    expanded = (maxH: number) => {
      const panelMaxH = Math.max(96, maxH - 8);
      return (
        <GlassSurface blurred testID="panel-sim" style={[styles.panel, { maxHeight: panelMaxH }]}>
          <ScrollView
            style={[styles.panelScroll, { maxHeight: panelMaxH }]}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.panelContent}
          >
            {simBody}
          </ScrollView>
        </GlassSurface>
      );
    };
  }

  const dockChips: BottomDockChip[] = [];

  const effectiveShowNow = showNow ?? (Math.abs(timeMs - nowMs) > 60_000);

  return (
    <>
      <Scrim edge="top" height={180} />
      <View testID="frame-readout" pointerEvents="none" style={styles.readout}>
        {typeof readout === 'string' ? <Text style={[styles.readoutText, readoutShadow]}>{readout}</Text> : readout}
      </View>
      <BottomDock
        language={language}
        stage={stage}
        onStageChange={setStageSafe}
        onDockHeight={onDockHeight}
        expanded={expanded}
        fitContent
        chips={dockChips}
        customRuler={customRuler}
        ruler={{
          timeMs,
          tz,
          nowMs,
          onDragStart: () => onSlideStart('time'),
          onChange: (ms) => onPick(ms, 'time'),
          onCommit: () => onSlideEnd('time'),
          onDayShift: (nextMs) => {
            onSlideStart('date');
            onPick(nextMs, 'date');
            onSlideEnd('date');
          },
          onDayDragStart: () => onSlideStart('date'),
          onDayPreview: (ms) => onPick(ms, 'date'),
          onDayCommit: () => onSlideEnd('date'),
          onDatePress: onOpenCalendar,
          sunsetMs,
          sunsetLabel,
          scoreSamples,
          showNow: effectiveShowNow,
          live,
          onNow,
        }}
        leftAction={{
          testID: 'thumb',
          icon: <FolderOpen size={20} color={TEXT} />,
          disabled: !onOpenLatestScene,
          accessibilityLabel: L3(language, '저장한 장면 열기', 'Open saved scene', '保存したシーンを開く'),
          onPress: onOpenLatestScene,
        }}
        rightAction={{
          testID: 'scene-save',
          icon: <Bookmark size={20} color={TEXT} />,
          accessibilityLabel: L3(language, '장면 저장', 'Save scene', 'シーン保存'),
          onPress: onSaveScene,
        }}
        shutterLabel={L3(language, '이 장면 찍기', 'Shoot this scene', 'このシーンを撮る')}
        shutterInner={<Camera size={22} color={DARK.onAccent} />}
        onShutter={onShoot}
        stripMode={mode}
        stripModes={modes}
        onPickMode={pickMode}
      />
    </>
  );
};

const styles = StyleSheet.create({
  // 머리줄이 하늘 위에 떠 있으므로 그 아래에서 시작합니다(`utils/headerLayout`).
  readout: { position: 'absolute', left: 10, right: 10, top: belowHeader(12), alignItems: 'center' },
  readoutText: { fontFamily: monoFont, fontSize: 11, fontWeight: '500', color: TEXT, letterSpacing: 0.3 },
  panel: { marginHorizontal: 10, marginBottom: 8, borderRadius: 16 },
  panelScroll: { flexGrow: 0 },
  panelContent: { padding: 12, gap: 8 },
});

interface LiveReadoutProps {
  language: Lang;
  /** 장면이 알려 주는 지금 시선. 못 알려 주면 null. */
  getView: () => ViewAzEl | null;
  /** 눈 높이(m, 땅 위). 시뮬레이션이면 생략(적지 않음). */
  eyeHeightM?: number;
  intervalMs?: number;
}

const readoutShadow = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const;

/** 지금 시선의 방위 · 앙각(과 눈 높이)을 투명 글자 한 줄로. 읽을 만큼 바뀔 때만 이 줄만 다시 그립니다(`SandboxDials.ViewReadout` 과 같은 읽기). */
export const LiveReadout: React.FC<LiveReadoutProps> = React.memo(({ language, getView, eyeHeightM, intervalMs = 330 }) => {
  const win = useWindowDimensions();
  const get = React.useRef(getView);
  get.current = getView;
  const [v, setV] = React.useState<ViewAzEl | null>(() => get.current());
  React.useEffect(() => {
    const tick = () => { const n = get.current(); setV(p => (viewDiffers(p, n) ? (n ? { az: n.az, el: n.el, fov: n.fov } : null) : p)); };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  const eye = eyeHeightM == null ? '' : ` · ${L3(language, '높이', 'HGT', '高さ')} ${fmtEye(eyeHeightM)}`;
  let zoomStr = '';
  if (v?.fov != null && Number.isFinite(v.fov) && v.fov > 0) {
    const mm = equivalentFocalMm(v.fov, win.width / Math.max(1, win.height));
    const mag = mm / 24;
    const magFmt = fmtZoom(mag < 10 ? Math.round(mag * 10) / 10 : Math.round(mag));
    const mmFmt = mm >= 100 ? Math.round(mm / 10) * 10 : Math.round(mm);
    zoomStr = ` · ${magFmt} (${mmFmt}mm)`;
  }
  return <Text style={[styles.readoutText, readoutShadow]}>{`${v ? `AZ ${fmtAz(v.az)}°` : 'AZ —'} · ${v ? `EL ${fmtEl(v.el)}°` : 'EL —'}${zoomStr}${eye}`}</Text>;
});
