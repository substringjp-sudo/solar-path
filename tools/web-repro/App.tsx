/**
 * **앱의 SkyScene3D 를 웹으로 띄워 QR 장면을 그대로 그립니다** (§112).
 *
 * 셰이더만 떼어 낸 하네스는 기기 화면을 못 되살렸습니다(지형·나눠 그리기·합성기·조명 튜닝이
 * 빠짐). 이것은 앱 컴포넌트를 그대로 씁니다. 값은 주소의 # 뒤 JSON 으로 받습니다:
 *   repro.html#{"t":"...","lat":..,"lon":..,"elevM":..,"sunAlt":..,"sunAz":..,"view":{...},"wx":[...]}
 * wx 는 CloudData 배열(관측점이 [0]) — 그대로 interpolatedWeather 로 넘깁니다.
 *
 * 빌드: tools/web-repro/build.sh
 */
import React from 'react';
import { View } from 'react-native';
import { SkyScene3D } from '../../src/components/SkyScene3D/SkyScene3D';
import { DevTuningPanel } from '../../src/components/SkyScreen/DevTuningPanel';
import { VOLUMETRIC_TERRAIN_ALBEDO } from '../../src/components/SkyScene3D/TerrainField';
import { setTerrainLook } from '../../src/components/SkyScene3D/terrainLook';
import { PrecomputedTexturesLoader } from '@takram/three-atmosphere';
import { MapGlobe } from '../../src/components/IsolineMap/MapGlobe';
import { DateTimeBar } from '../../src/components/TimeBar/DateTimeBar';
import { useCelestialStore } from '../../src/store/useCelestialStore';
import { getSubsolarPoint, getSublunarPoint, getMoonPhase, getTerminatorSegments } from '../../src/utils/celestial';

const Q = (() => {
  try { return JSON.parse(decodeURIComponent((globalThis as any).location?.hash?.slice(1) || '{}')); }
  catch { return {}; }
})();
// §129 볼륨 하늘 지형 알베도 후보(RULER-terrain-lit.md) — "talb":[r,g,b]
if (Array.isArray(Q.talb)) Object.assign(VOLUMETRIC_TERRAIN_ALBEDO, { r: Q.talb[0], g: Q.talb[1], b: Q.talb[2] });
// §156 지형 보임새 손잡이(terrainLook.ts) — 주소 "look":{ao,hemi,ambGain,cloudFill,sheen,mottle}, 실행 중에는 window.__look({...}).
if (Q.look) setTerrainLook(Q.look);
(globalThis as any).__look = setTerrainLook;
// atmos:"load" — takram 의 미리 만든 대기 표(3파장)를 읽어 볼륨 하늘을 몇 초 만에 켭니다(SwiftShader 에서 15파장 표는 4~10분).
// 지형 조명 A/B 처럼 하늘 색의 세부가 중요하지 않은 비교용 — 앱과 같은 색은 이 옵션 없이 돌립니다.
if (Q.atmos === 'load') {
  (globalThis as any).__volCreateOpts = (renderer: any) => new Promise((res, rej) => {
    new PrecomputedTexturesLoader({ format: 'binary' }).setType(renderer).load('assets', (t: any) => res({ precomputed: t, spectral: false, effectiveTransmittance: false }), undefined, rej);
  });
}

/** globe:1 — 지구본(MapGlobe)만 그립니다(해·달 직하점·위상 확인, §142). cLat·cLon·r 로 한가운데·반지름, morph 로 형태(§153). */
function GlobeRepro({ W, H }: { W: number; H: number }) {
  const date = new Date(Q.t ?? Date.now());
  return (
    <View style={{ width: W, height: H, backgroundColor: '#0B1220' }}>
      <MapGlobe
        subsolar={getSubsolarPoint(date)}
        terminator={getTerminatorSegments(date)}
        sublunar={getSublunarPoint(date)}
        moonFraction={getMoonPhase(date).fraction}
        lat={Q.lat ?? 37.5}
        lon={Q.lon ?? 127}
        hasLocation
        theme={{ dark: true }}
        width={W}
        height={H}
        initialCenter={{ latitude: Q.cLat ?? 0, longitude: Q.cLon ?? 140 }}
        initialRadius={Q.r ?? Math.min(W, H) * 0.42}
        initialMorph={Q.morph ?? 1}
        minRadius={50}
        maxRadius={20000}
        selectedDate={date}
      />
    </View>
  );
}

/** bar:1 — 하단 날짜·시간 막대만(§143). t·now·tz 로 시각·지금·시간대. 커밋 횟수·시각을 window.__bar 에 남깁니다. */
function BarRepro({ W }: { W: number }) {
  const [t, setT] = React.useState(new Date(Q.t ?? Date.now()));
  const [sim, setSim] = React.useState(true);
  React.useEffect(() => { useCelestialStore.setState({ timezoneOffsetHours: Q.tz ?? 9, timezoneLabel: 'GMT+9', language: Q.lang ?? 'ko' } as any); }, []);
  (globalThis as any).__bar = (globalThis as any).__bar ?? { commits: 0, last: 0, events: [] as string[] };
  const origNow = React.useRef(false);
  if (!origNow.current && Q.now) { origNow.current = true; const real = Date.now; const off = new Date(Q.now).getTime() - real(); Date.now = () => real() + off; }
  const day = (h: number, m: number) => new Date(Date.UTC(2026, 9, 16, h - 9, m));
  return (
    <View style={{ width: W, backgroundColor: '#0D1320', paddingVertical: 6 }}>
      <DateTimeBar
        currentTime={t}
        onPick={(d, meta) => { const b = (globalThis as any).__bar; b.commits++; b.last = d.getTime(); b.events.push(`${meta?.scrub ?? 'step'}:${d.toISOString()}`); setT(d); setSim(true); }}
        onSlidingStart={(k) => (globalThis as any).__bar.events.push('start:' + k)}
        onSlidingComplete={(k) => (globalThis as any).__bar.events.push('end:' + k)}
        isTimeMachineEnabled={sim}
        onNow={() => setSim(false)}
        onOpenDatePicker={() => (globalThis as any).__bar.events.push('picker')}
        onCameraPress={() => {}}
        events={{ sunrise: day(6, 41), sunset: day(17, 53), moonrise: day(13, 20), moonset: day(23, 40) }}
        seasonPcts={[{ key: 'a', pct: 22, color: '#4ADE80' }, { key: 'b', pct: 47, color: '#FFA500' }, { key: 'c', pct: 72, color: '#F97316' }, { key: 'd', pct: 98, color: '#38BDF8' }]}
      />
    </View>
  );
}

export default function App() {
  const W = Q.w ?? 400, H = Q.h ?? 300;
  // 시선·시각·해 위치를 페이지를 다시 열지 않고 바꿉니다 — 볼륨 대기 표(SwiftShader 60~70초)를 한 번만 만들려고.
  //   window.__set({ view:{az,el,fov}, t:'ISO', sunAlt, sunAz, wx:[...], lat, lon, elevM })   (위치를 바꾸면 DEM 을 새로 받습니다)
  const [dyn, setDyn] = React.useState<any>({});
  React.useEffect(() => { (globalThis as any).__set = (o: any) => setDyn((d: any) => ({ ...d, ...o })); }, []);
  const view = dyn.view ?? Q.view;
  const tNow = dyn.t ?? Q.t;
  const sunAlt = dyn.sunAlt ?? Q.sunAlt;
  const sunAz = dyn.sunAz ?? Q.sunAz;
  const wx = dyn.wx ?? Q.wx;
  const lat = dyn.lat ?? Q.lat, lon = dyn.lon ?? Q.lon, elevM = dyn.elevM ?? Q.elevM;
  if (Q.bar) return <BarRepro W={W} />;
  if (Q.globe) return <GlobeRepro W={W} H={H} />;
  return (
    <View style={{ width: W, height: H }}>
      <SkyScene3D
        sim={{ terrain: { observerElevation: elevM ?? 0 } }}
        currentTime={new Date(tNow ?? Date.now())}
        sunAltitude={sunAlt ?? 30}
        sunAzimuth={sunAz ?? 180}
        prediction={null}
        location={{ coords: { latitude: lat ?? 37.5, longitude: lon ?? 127 } }}
        interpolatedWeather={wx ?? []}
        theme={{ accent: '#FF9800' }}
        cameraAzimuthProp={view?.az}
        cameraElevationProp={view?.el}
        fovProp={view?.fov}
        skySettings={{ starBrightness: 1, starMagLimit: 6.5, pixelArtRows: 0, volumetricSky: Q.vol === undefined ? undefined : !!Q.vol,
          // §130 흐름 모형 — volFlow:1 · volFlowUv:1 · volq:'low'|'medium'|'high' · volres:0.25~1 (장치 크기 알갱이 자)
          volumetricFlow: !!Q.volFlow, volumetricFlowUv: !!Q.volFlowUv,
          ...(Q.volq ? { volumetricQuality: Q.volq } : {}), ...(Q.volres != null ? { volumetricRes: Q.volres, volumetricAutoRes: false } : {}) }}
        fullScreen
        hideHudOverlay
        hideCompassBar
        isActive
      />
      {/* panel:1 — 개발자 튜닝 패널을 함께 띄웁니다(폰 폭에서 헤더·볼륨 상태 확인용). */}
      {Q.panel ? <DevTuningPanel visible onClose={() => { (globalThis as any).__panelClosed = true; }} /> : null}
    </View>
  );
}
