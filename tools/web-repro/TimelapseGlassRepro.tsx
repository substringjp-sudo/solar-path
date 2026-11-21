/**
 * TimelapseGlassRepro — 타임랩스 설정 시트(`TimelapsePanel`)와 촬영 중 카드(`TimelapseRunCard` + `RunExtras`)를 웹 하네스에서 눌러 보는 장면(2026-11-21).
 * 주소 # 뒤 JSON: { tlglass: 1, w, h, lang, view: 'sheet' | 'run', running: 1|0, err: 1|0, lowbat: 1|0, sky }.
 * 일어난 일은 window.__tl 에 남습니다: { previews: [{ sec, frames, startMs, endMs }], starts: [{ frames, kind }], closes, finishes, dismisses, screenOffs }.
 * 판정: tools/web-repro/verify-timelapse-glass.js
 */
import React from 'react';
import { View } from 'react-native';
import { TimelapsePanel } from '../../src/components/AstroCamera/TimelapsePanel';
import { TimelapseRunCard } from '../../src/components/AstroCamera/TimelapseRunCard';
import { RunExtras } from '../../src/components/AstroCamera/RunExtras';

const SKY: Record<string, string> = {
  haze: 'linear-gradient(180deg, #b8c0d6 0%, #d9dde6 45%, #e9e2d6 60%, #e9e2d6 100%)',
  night: 'linear-gradient(180deg, #070A12 0%, #0d1428 100%)',
};

export function TimelapseGlassRepro({ W, H, Q }: { W: number; H: number; Q: any }) {
  const lang = (Q.lang ?? 'ko') as 'ko' | 'en' | 'ja';
  const view = (Q.view ?? 'sheet') as 'sheet' | 'run';
  const sunset = Date.UTC(2026, 10, 21, 8, 17);
  const log = React.useRef<any>({ previews: [], starts: [], closes: 0, finishes: 0, dismisses: 0, screenOffs: 0 });
  (globalThis as any).__tl = log.current;
  const running = Q.running !== 0;
  return (
    <View testID="tlglass-root" style={[{ width: W, height: H, position: 'relative', overflow: 'hidden', backgroundColor: '#222' }, { backgroundImage: SKY[Q.sky ?? 'haze'] } as any]}>
      {view === 'sheet' ? (
        <TimelapsePanel
          visible
          language={lang}
          events={{ sunrise: null, sunset }}
          nowMs={sunset - 3600000}
          tzHours={9}
          peak={{ fromMs: sunset - 1200000, toMs: sunset + 600000 }}
          lowCloud={{ fromMs: sunset - 1800000, toMs: sunset - 600000 }}
          sunAltAt={(ms) => 2.5 - ((ms - (sunset - 20 * 60000)) / 60000) * 0.18}
          onPreview={(plan, startMs, endMs) => { log.current.previews.push({ sec: plan.videoSec, frames: plan.frames, startMs, endMs }); }}
          onStart={(plan) => { log.current.starts.push({ frames: plan.frames, kind: plan.kind }); }}
          onClose={() => { log.current.closes++; }}
        />
      ) : (
        <View style={{ position: 'absolute', left: 12, right: 12, top: 60 }}>
          <TimelapseRunCard
            language={lang}
            title={lang === 'en' ? 'Timelapse · Plain' : '타임랩스 · 일반'}
            subtitle="16:40 시작 · 지금 16:52"
            running={running}
            error={!!Q.err}
            taken={37}
            frames={301}
            remaining="12:31"
            saved={37}
            onFinish={() => { log.current.finishes++; }}
            onDismiss={() => { log.current.dismisses++; }}
          >
            <RunExtras
              language={lang}
              pred={[0, -1, -2.5, -4, -6, -8, -10, -11.5]}
              actual={[{ f: 0, stops: 0 }, { f: 0.15, stops: -0.1 }, { f: 0.3, stops: -0.4 }, { f: 0.5, stops: -1.2 }]}
              battery={{ level: Q.lowbat ? 0.08 : 0.62, charging: false, lowPower: !!Q.lowbat }}
              running={running}
              onScreenOff={() => { log.current.screenOffs++; }}
            />
          </TimelapseRunCard>
        </View>
      )}
    </View>
  );
}
