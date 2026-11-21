/**
 * CameraFrameRepro — 카메라 새 틀(`CameraFrame`)을 가짜 카메라 위에 올려 웹 하네스에서 눌러 보는 장면(2026-11-21).
 * 주소 # 뒤 JSON: { camframe: 1, w, h, lang, tab: 'photo' | 'astro', view: 'camera' | 'blend' | 'sim', stage, sky }.
 * 일어난 일은 window.__cam 에 남습니다: { zoom, view, shutter, lock, picks: [모드], times: [ms], commits, nows, dock: 고정부 높이, astro: 천체 설정(천체 탭) }.
 * 판정: tools/web-repro/verify-camera-frame.js
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Layers, Lock, Moon, Camera } from 'lucide-react-native';
import { CameraFrame, type CameraChipSpec } from '../../src/components/AstroCamera/CameraFrame';
import { ExposureCells } from '../../src/components/AstroCamera/ExposureCells';
import { GlassChip } from '../../src/components/glass/GlassChip';
import { TEXT } from '../../src/theme/glassTokens';
import { adviseExposure } from '../../src/utils/exposureAdvice';
import { AstroSettingsPanel } from '../../src/components/AstroCamera/AstroSettingsPanel';
import { astroChipLabel, createDefaultAstroSettings, planAstroShotSummary, type AstroSettingsState } from '../../src/utils/astroCameraUi';
import { modeList, captureKeyFor, type AppMode } from '../../src/utils/modeStrip';
import type { DockStage } from '../../src/utils/dockStages';

const SKY: Record<string, string> = {
  haze: 'linear-gradient(180deg, #b8c0d6 0%, #d9dde6 45%, #e9e2d6 60%, #e9e2d6 100%)',
  night: 'linear-gradient(180deg, #070A12 0%, #0d1428 100%)',
};

export function CameraFrameRepro({ W, H, Q }: { W: number; H: number; Q: any }) {
  const lang = (Q.lang ?? 'ko') as 'ko' | 'en' | 'ja';
  const C = Date.UTC(2026, 10, 21, 8, 4);
  const tab = (Q.tab ?? 'photo') as 'photo' | 'astro';
  const [zoom, setZoom] = React.useState(1);
  const [view, setView] = React.useState<'camera' | 'blend' | 'sim'>(Q.view ?? 'camera');
  const [timeMs, setTimeMs] = React.useState(C);
  const [stage, setStage] = React.useState<DockStage>(Q.stage ?? 'min');
  const log = React.useRef<any>({ shutter: 0, lock: 0, picks: [], times: [], commits: 0, nows: 0, dock: 0, drawer: 0 });
  log.current.zoom = zoom; log.current.view = view; log.current.timeMs = timeMs;
  (globalThis as any).__cam = log.current;
  const advice = adviseExposure(6);
  // 천체 탭: 실제 설정 패널과 기본 설정(기기 정보 없음 = 대체 범위). 바뀐 설정은 window.__cam.astro 에 남깁니다.
  const [astro, setAstro] = React.useState<AstroSettingsState>(() => ({ ...createDefaultAstroSettings(), mode: 'trails', durationSec: 480 }));
  const caps: any = { available: false, cameraId: '', hardwareLevel: 0, rawSupported: false, manualSensorSupported: false, minExposureMs: 1, maxExposureMs: 30000, minIso: 100, maxIso: 6400, focalLengthMm: 6, focal35mm: 24, hfovDeg: 70, sensorOrientation: 90, supportsFocusDistance: false, rawWidth: 0, rawHeight: 0, yuvWidth: 0, yuvHeight: 0 };
  const summary = planAstroShotSummary({ settings: astro, caps, latitudeDeg: 37.5, azDeg: 180, elDeg: 40 });
  log.current.astro = astro;
  const chips: CameraChipSpec[] = [
    ...[1, 2, 3, 5].map(m => ({ id: `zoom-${m}`, label: `${m}×`, mono: true, active: Math.abs(zoom - m) < 0.25, onPress: () => setZoom(m) })),
    ...(tab === 'astro'
      ? [{ id: 'astro', label: astroChipLabel(astro, summary, lang), mono: true, expands: true, openStage: 'full' as const }]
      : [{ id: 'exposure', label: lang === 'en' ? 'Exposure' : '노출', expands: true }]),
  ];
  const panels = tab === 'photo' ? { exposure: <ExposureCells language={lang} advice={advice} lensMm="≈ 24 mm" lensText="1x" /> } : { astro: <AstroSettingsPanel settings={astro} onChange={setAstro} summary={summary} caps={caps} language={lang} /> };
  return (
    <View testID="camframe-root" style={[{ width: W, height: H, position: 'relative', overflow: 'hidden', backgroundColor: '#222' }, { backgroundImage: SKY[Q.sky ?? 'haze'] } as any]}>
      <Text style={{ position: 'absolute', top: 60, left: 12, color: '#000', fontSize: 12 }}>{`카메라 ${view} · ${tab}`}</Text>
      <CameraFrame
        language={lang}
        chips={chips}
        panels={panels}
        ruler={view === 'camera' ? null : {
          timeMs, tz: 9, nowMs: C,
          onDragStart: () => {},
          onChange: (ms) => { log.current.times.push(ms); setTimeMs(ms); },
          onCommit: () => { log.current.commits++; },
          sunsetMs: Date.UTC(2026, 10, 21, 8, 17), sunsetLabel: '일몰 17:17',
          showNow: Math.abs(timeMs - C) > 60000, onNow: () => { log.current.nows++; setTimeMs(C); },
        }}
        left={<GlassChip testID="view-toggle" label="" icon={<Layers size={20} color={TEXT} />} accessibilityLabel="보기 전환" onPress={() => setView(v => (v === 'camera' ? 'blend' : v === 'blend' ? 'sim' : 'camera'))} style={{ width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 }} />}
        right={<GlassChip testID="lock" label="" icon={<Lock size={20} color={TEXT} />} accessibilityLabel="방향 고정" onPress={() => { log.current.lock++; }} style={{ width: 48, minHeight: 48, borderRadius: 24, paddingHorizontal: 0 }} />}
        shutterLabel="셔터"
        shutterInner={tab === 'astro' ? <Moon size={22} color="#0b1020" /> : <Camera size={22} color="#0b1020" />}
        shutterColor={tab === 'astro' ? '#cbd5e1' : undefined}
        onShutter={() => { log.current.shutter++; }}
        stripMode={tab === 'astro' ? 'astro' : 'photo'}
        stripModes={modeList(false)}
        onPickMode={(m: AppMode) => { log.current.picks.push(m); void captureKeyFor; }}
        onDockHeight={(h) => { log.current.dock = h; }}
        stage={stage}
        onStageChange={setStage}
      />
    </View>
  );
}
