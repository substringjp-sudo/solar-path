/**
 * SkyFrameRepro — 하늘 화면의 새 틀(`SkyScreen/SkyFrame`)을 가짜 내용으로 웹 하네스에서 눌러 보는 장면(2026-11-21).
 * 주소 # 뒤 JSON: { skyframe: 1, w, h, lang, mode: 'simulation' | 'sandbox', sky: 'haze' | 'night' }.
 * 일어난 일은 window.__frame 에 남습니다: { mode, timeMs, ev: [{ e: 'start' | 'pick' | 'end', kind, ms? }], switches, shoots, saves, nows, calendars }.
 * 판정: tools/web-repro/verify-sky-frame.js
 */
import React from 'react';
import { Text, View } from 'react-native';
import { SkyFrame, type FrameMode, type SlideKind } from '../../src/components/SkyScreen/SkyFrame';
import type { ModeSwitch } from '../../src/utils/modeStrip';

const SKY: Record<string, string> = {
  haze: 'linear-gradient(180deg, #b8c0d6 0%, #d9dde6 45%, #e9e2d6 60%, #e9e2d6 100%)',
  night: 'linear-gradient(180deg, #070A12 0%, #0d1428 100%)',
};

export function SkyFrameRepro({ W, H, Q }: { W: number; H: number; Q: any }) {
  const lang = (Q.lang ?? 'ko') as 'ko' | 'en' | 'ja';
  const tz = 9;
  const C = Date.UTC(2026, 10, 21, 8, 4);
  const [mode, setMode] = React.useState<FrameMode>(Q.mode ?? 'simulation');
  const [timeMs, setTimeMs] = React.useState(C);
  const log = React.useRef<any>({ ev: [], switches: [], shoots: 0, saves: 0, nows: 0, calendars: 0 });
  // 눌러도 다시 그려지지 않는 일(셔터 · 저장 · 달력)도 읽을 수 있게, 같은 객체를 매번 갱신해 둡니다.
  log.current.mode = mode; log.current.timeMs = timeMs;
  (globalThis as any).__frame = log.current;
  const onSwitch = (sw: ModeSwitch) => {
    log.current.switches.push(sw);
    if (sw.mode === 'simulation' || sw.mode === 'sandbox') setMode(sw.mode);
  };
  const body = (label: string) => <Text testID={`body-${label}`} style={{ color: '#F1F5F9', fontSize: 13 }}>{label}</Text>;
  return (
    <View testID="frame-root" style={[{ width: W, height: H, position: 'relative', overflow: 'hidden', backgroundColor: '#b8c0d6' }, { backgroundImage: SKY[Q.sky ?? 'haze'] } as any]}>
      <SkyFrame
        language={lang}
        tz={tz}
        nowMs={C}
        timeMs={timeMs}
        onSlideStart={(kind: SlideKind) => log.current.ev.push({ e: 'start', kind })}
        onPick={(ms: number, kind: SlideKind) => { log.current.ev.push({ e: 'pick', kind, ms }); setTimeMs(ms); }}
        onSlideEnd={(kind: SlideKind) => log.current.ev.push({ e: 'end', kind })}
        onNow={() => { log.current.nows++; setTimeMs(C); }}
        sunsetMs={Date.UTC(2026, 10, 21, 8, 17)}
        sunsetLabel="일몰 17:17"
        scoreSamples={Array.from({ length: 19 }, (_, i) => ({ t: C + (i - 9) * 10 * 60000, score: i === 5 ? null : 100 - Math.abs(i - 12) * 10 }))}
        mode={mode}
        onSwitch={onSwitch}
        getView={() => ({ azDeg: 159, elDeg: 13 })}
        readout={mode === 'simulation' ? '159° S · 해 EL 13.0°' : '159° S · EL 13.0° · 눈 1.6 m'}
        simBody={body('점수와 다가오는 좋은 순간')}
        sandbox={{ move: body('이동 내용'), view: body('보기 내용'), scene: body('장면 내용'), tools: body('도구 내용') }}
        onShoot={() => { log.current.shoots++; }}
        onSaveScene={() => { log.current.saves++; }}
        onOpenCalendar={() => { log.current.calendars++; }}
      />
    </View>
  );
}
