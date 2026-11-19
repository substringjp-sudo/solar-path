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
import { ScoreGraph } from '../../src/components/SkyScreen/ScoreGraph';
import { scoreWindow, sampleScores } from '../../src/utils/scoreSeries';
import { sunPosition } from '../../src/utils/solarPosition';
import { SandboxPanel } from '../../src/components/SkyScreen/SandboxPanel';
import { ObjectInfoPanel } from '../../src/components/SkyScreen/ObjectInfoPanel';
import { useCelestialStore } from '../../src/store/useCelestialStore';
import { getVolumetricStatus } from '../../src/components/VolumetricProbe/volumetricStatus';
import { fetchDayWeatherRing, getInterpolatedWeather } from '../../src/utils/weather';
import { getSubsolarPoint, getSublunarPoint, getMoonPhase, getTerminatorSegments, getSunPosition } from '../../src/utils/celestial';
import { CalcStepsView, type CalcTopic } from '../../src/components/CalcSteps/CalcStepsModal';
import { starArgsFor } from '../../src/utils/starTonight';
import { buildHorizonProfile } from '../../src/utils/horizon';
import { predictSunset } from '../../src/utils/sunsetPhysics';
import { verdictWord } from '../../src/components/SunsetSimulation/PredictionCard';
import { snapBuildingTarget } from '../../src/utils/demPick';
import { createPickIndexBuilder } from '../../src/utils/buildingPick';
import { pickTargetAt } from '../../src/utils/pickTarget';
import { Onboarding } from '../../src/components/Onboarding/Onboarding';
import { StandSuggestView } from '../../src/components/SkyScreen/StandSuggest';
import { outlookFromHourly } from '../../src/utils/standSuggest';
import { localOffsetM } from '../../src/utils/geoMove';
import { findStandPoints, groupStandHits } from '../../src/utils/standFinder';
import { standQueryFor, rankStands, rebuildPicked } from '../../src/utils/standSuggest';
import { bodySky } from '../../src/utils/alignSearch';
import { fetchUrbanMask } from '../../src/utils/mvtTiles';

const Q = (() => {
  try { return JSON.parse(decodeURIComponent((globalThis as any).location?.hash?.slice(1) || '{}')); }
  catch { return {}; }
})();
// §129 볼륨 하늘 지형 알베도 후보(RULER-terrain-lit.md) — "talb":[r,g,b]
if (Array.isArray(Q.talb)) Object.assign(VOLUMETRIC_TERRAIN_ALBEDO, { r: Q.talb[0], g: Q.talb[1], b: Q.talb[2] });
// §157 지형 보임새 손잡이(terrainLook.ts) — 주소 "look":{ao,hemi,ambGain,cloudFill,sheen,mottle}, 실행 중에는 window.__look({...}).
if (Q.look) setTerrainLook(Q.look);
(globalThis as any).__look = setTerrainLook;
// 장면 요약(저·중·상 종류·τ·출처)을 하네스가 읽습니다 — window.__volStatus().summary (§164 수원 재현).
(globalThis as any).__volStatus = getVolumetricStatus;
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
        simple={!!Q.simple}
        seasonPcts={[{ key: 'a', pct: 22, color: '#4ADE80' }, { key: 'b', pct: 47, color: '#FFA500' }, { key: 'c', pct: 72, color: '#F97316' }, { key: 'd', pct: 98, color: '#38BDF8' }]}
      />
    </View>
  );
}

/** sbx:1 — 샌드박스 구도 도구 패널만(눈 높이·이동·내 위치 아님). awayM 으로 "내 위치 아님" 거리를 줍니다. */
function PanelRepro({ W, H }: { W: number; H: number }) {
  const [eyeH, setEyeH] = React.useState(Q.eyeH ?? 1.6);
  const [step, setStep] = React.useState(100);
  // farStates:1 — 먼 건물 줄의 네 상태(안내 · 받는 중 · 끝남 · 지형 없음)를 한 화면에 쌓아 봅니다(2026-11-19).
  const farStates: any[] = [null, { state: 'loading', tilesDone: 12, tilesTotal: 28, bytes: 3_400_000 }, { state: 'done', tilesDone: 28, tilesTotal: 28, bytes: 7_083_440, buildings: 3000, truncated: false, failed: 0 }, { state: 'off', tilesDone: 0, tilesTotal: 0, bytes: 0 }];
  return (
    <View style={{ width: W, height: H, backgroundColor: '#3a4a6a', padding: 12, gap: 10 }}>
      {Q.farStates
        ? farStates.map((st, i) => <SandboxPanel key={i} language="ko" eyeHeightM={eyeH} onEyeHeight={setEyeH} stepM={step} onStep={setStep} onMove={() => {}} awayM={null} onHome={() => {}} far={{ status: st, onLoad: () => {} }} />)
        : <SandboxPanel language="ko" eyeHeightM={eyeH} onEyeHeight={setEyeH} stepM={step} onStep={setStep} onMove={() => {}} awayM={Q.awayM ?? null} onHome={() => {}} />}
    </View>
  );
}

/**
 * calc:1 — 계산 과정 보기(해 뜨는·지는 시각). 합성 능선으로 땅 프로필을 만듭니다: 해 뜨는 쪽(방위 120° ± 15°) 4.2 km 에 높이 ridgeH m 의 띠.
 *   예: {"calc":1,"t":"2026-12-21T03:00:00Z","lat":37.5665,"lon":126.978,"ridgeH":175,"topic":"sunrise","lang":"ko","light":0,"noTerrain":0}
 * noTerrain:1 이면 땅 자료 없이(평평한 수평선), light:1 이면 밝은 모드.
 * topic:"score" — 노을 점수: 합성 예보 링(낮은 low · 중간 mid · 높은 high %, 해 쪽 60 km 의 낮은 구름 sunLow %, 해 고도 sunAlt°)으로 predictSunset 을 돌립니다.
 *   예: {"calc":1,"topic":"score","low":4,"mid":18,"high":63,"sunLow":0,"sunAlt":0.5}
 * topic:"stars" — 별 보기 조건: 앱과 같은 `starArgsFor`(해·달·달 지는 시각은 t·lat·lon 에서 계산)에 합성 날씨를 넣습니다.
 *   cloud(운량 %) · aod · vis(시정 m) · rh(습도 %) · pm(PM2.5) · lp(빛 지도 한계등급). noCloud:1 이면 구름 예보 없음, noLp:1 이면 빛 지도 없음.
 *   예: {"calc":1,"topic":"stars","t":"2026-12-21T03:00:00Z","cloud":25,"aod":0.12,"rh":55,"lp":6.2}
 */
/**
 * graph:1 — 시간대별 점수 그래프만(2026-11-19, 계획 2.4). 실제 노을 예측(`predictSunset`)과 해 위치로 9시간 창을 10분 간격으로 훑어 그립니다.
 *   t: 출몰 시각(ISO), side: "sunset"|"sunrise", tz: 관측지 UTC 오프셋(시간), now: 지금 보는 시각(ISO), low · mid · high: 해 쪽 구름 %, noWx:1 이면 구름 예보 없음(그래프 없음),
 *   lang · light 로 언어·모드. 누르면 window.__picked 에 그 시각(ISO)이 남고 세로선이 그리로 옮겨 갑니다.
 *   예: {"graph":1,"t":"2026-11-21T08:17:00Z","side":"sunset","tz":9,"now":"2026-11-21T07:40:00Z","low":4,"mid":18,"high":63}
 */
function GraphRepro({ W }: { W: number }) {
  const lat = Q.lat ?? 37.5665, lon = Q.lon ?? 126.978, tz = Q.tz ?? 9, side = Q.side ?? 'sunset';
  const win = React.useMemo(() => scoreWindow(Date.parse(Q.t ?? '2026-11-21T08:17:00Z'), side, tz), []);
  React.useEffect(() => { useCelestialStore.setState({ themeMode: Q.light ? 'light' : 'dark' } as any); }, []);
  const points = React.useMemo(() => {
    if (Q.noWx) return [];
    const T0 = new Date(win.fromMs);
    const mk = (l: number, m: number, h: number, d: number, off: number) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['x'], timeMs: [T0.getTime()], low: [l], mid: [m], high: [h] } });
    const lo = Q.low ?? 4, mi = Q.mid ?? 18, hi = Q.high ?? 63;
    const path = [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 ? 0 : lo, mi, hi, d, a)))];
    return sampleScores(win, 10, (d) => {
      const sp = sunPosition(d, lat, lon);
      return predictSunset(path as any, d, sp.altitude * 180 / Math.PI, 20000, 55, lat, 38, 325, sp.azimuth * 180 / Math.PI + 180).score;
    });
  }, []);
  const [now, setNow] = React.useState<number>(Date.parse(Q.now ?? '2026-11-21T07:40:00Z'));
  return (
    <View style={{ width: W, padding: 16, backgroundColor: Q.light ? '#F8FAFC' : '#0D1320' }}>
      <ScoreGraph
        points={points}
        window={win}
        nowMs={now}
        tzHours={tz}
        language={Q.lang ?? 'ko'}
        onPickTime={(ms) => { (globalThis as any).__picked = new Date(ms).toISOString(); setNow(ms); }}
      />
    </View>
  );
}

/**
 * objpanel:1 — 정보 패널만(2026-11-19 건물 고르기). 합성 건물(롯데월드타워 모양: 동남동 10.9 km, 37×11 m, 555 m)을 실제 `pickTargetAt` 으로 골라
 * 패널을 그립니다. kind:'terrain' 이면 건물 없이 지형만. lang · light 로 언어·모드. 전환 칩이 눌립니다.
 */
function ObjPanelRepro({ W, H }: { W: number; H: number }) {
  const target = React.useMemo(() => {
    const az = 113 * Math.PI / 180, d = 10940;
    const cx = Math.sin(az) * d, cz = -Math.cos(az) * d;
    const rot = 20 * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-18, -5.5], [18, -5.5], [18, 5.5], [-18, 5.5]].map(([x, z]) => ({ x: cx + x * c - z * s, z: cz + x * s + z * c }));
    const bld = createPickIndexBuilder();
    bld.add(cx, cz, 555, -5, pts);
    const idx = bld.finish();
    const sample = () => 20;
    // 지형 변형은 평지 3 km 앞 땅을 겨냥(−5°). 눈이 272 m 높아 −0.45° 시선은 평지에 닿지 않습니다.
    return pickTargetAt({ sample, eyeM: 292, azDeg: 113, elDeg: Q.kind === 'terrain' ? -5 : -0.45, buildings: Q.kind === 'terrain' ? null : idx, tolDeg: 0.4,
      toLatLon: (e: number, sth: number) => ({ latitude: 37.5512 - sth / 110574, longitude: 126.9882 + e / 88279 }) });
  }, []);
  const [t, setT] = React.useState<any>(target);
  return (
    <View style={{ width: W, height: H, backgroundColor: '#0B1220', justifyContent: 'flex-end', padding: 8 }}>
      {t ? (
        <ObjectInfoPanel
          language={Q.lang ?? 'ko'}
          target={t}
          sun={{ azDeg: 250, altDeg: 20 }}
          moon={{ azDeg: 90, altDeg: -20 }}
          observer={{ latitude: 37.5512, longitude: 126.9882, fromMs: Date.parse(Q.t ?? '2026-11-19T03:00:00Z') }}
          onAlign={() => {}}
          onCalc={() => { (globalThis as any).__calcPressed = true; }}
          onSuggest={() => { (globalThis as any).__suggestPressed = true; }}
          moonDiskDeg={0.52}
          onSnap={(top: boolean) => setT((p: any) => snapBuildingTarget(p, top))}
          onClear={() => setT(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * onboard:1 — 처음 실행 안내(2026-11-19 목업 8번). step 은 처음 장(0~2), lang · light, good 으로 알림 체크 처음 상태.
 * 눌림: window.__guideDone(건너뛰기·시작하기), window.__guideGood(체크 바꿈 뒤 값).
 */
function OnboardRepro({ W, H }: { W: number; H: number }) {
  const [good, setGood] = React.useState(!!Q.good);
  return (
    <View style={{ width: W, height: H }}>
      <Onboarding
        visible
        language={Q.lang ?? 'ko'}
        goodOnly={good}
        onToggleGoodOnly={(n) => { setGood(n); (globalThis as any).__guideGood = n; }}
        onDone={() => { (globalThis as any).__guideDone = true; }}
      />
    </View>
  );
}

/**
 * suggest:1 — 추천 화면(2026-11-19 목업 3번). 합성 세계: 눈 위치(원점) 37.5512, 126.9882 에서 동남동 약 11 km 의 롯데월드타워 모양(555 m, 꼭대기 해발 575 m).
 * 땅은 해발 20 m 평지 + 대상 남서 3 km 의 언덕(420 m, 뒤쪽 자리는 가려짐) + 대상 북쪽을 지나는 강(물 띠). 예보: 16일, 날마다 맑음 · 보통 · 많음이 돌아가고 그 뒤는 모름.
 * kind:'terrain' 이면 건물 없이 지형 한 점(해발 400 m), noTerrain:1 이면 지형을 못 받은 상태, noWater:1 이면 지도 물 격자를 못 받은 상태,
 * noOutlook:1 이면 예보 없음(날씨 모름), lang · light.
 * 후보를 누르면 window.__suggestPicked 에 시각·위경도가 남습니다.
 */
function SuggestRepro({ W, H }: { W: number; H: number }) {
  React.useEffect(() => { useCelestialStore.setState({ themeMode: Q.light ? 'light' : 'dark' } as any); }, []);
  const origin = { latitude: 37.5512, longitude: 126.9882 };
  const T = { latitude: 37.5126, longitude: 127.1026 };
  const o = localOffsetM(origin, T.latitude, T.longitude);
  const tx = o.eastM, tz = -o.northM;
  const ground = React.useCallback((e: number, s: number) => {
    const hx = tx - 2100, hz = tz + 2100;   // 대상의 남서쪽 약 3 km
    return 20 + 420 * Math.exp(-(((e - hx) ** 2 + (s - hz) ** 2) / (2 * 800 ** 2)));
  }, [tx, tz]);
  const isWater = React.useCallback((e: number, s: number) => Math.abs(s - (tz - 2800)) < 220 && e > tx - 9000 && e < tx + 9000, [tx, tz]);
  const t0 = Date.parse(Q.t ?? '2026-11-19T00:00:00Z');
  const outlook = React.useMemo(() => {
    if (Q.noOutlook) return null;
    const n = 24 * 16;
    return outlookFromHourly({ timeMs: Array.from({ length: n }, (_, i) => t0 + i * 3600e3), total: Array.from({ length: n }, (_, i) => [10, 40, 85, 20][Math.floor(i / 24) % 4]) });
  }, [t0]);
  const building = Q.kind !== 'terrain';
  const top = { azDeg: 113, elDeg: 0.3, distM: Math.hypot(tx, tz), elevM: building ? 575 : 400, eastM: tx, southM: tz, latitude: T.latitude, longitude: T.longitude, visible: true, marginM: 30 };
  const target: any = building
    ? { kind: 'building', ...top, eyeElevM: 21.6, building: { heightM: 555, baseElevM: 20, topElevM: 575, longM: 40, shortM: 11, snapped: true, hitPoint: top, topPoint: top, angularHeightDeg: 3.2 } }
    : { kind: 'terrain', ...top, eyeElevM: 21.6 };
  return (
    <View style={{ width: W, height: H }}>
      <StandSuggestView
        language={Q.lang ?? 'ko'}
        target={target}
        fromMs={t0}
        eyeAboveGroundM={Q.eye ?? 1.6}
        getSamplers={() => (Q.noTerrain ? null : { origin, ground, isWater, waterReady: !Q.noWater })}
        outlook={outlook}
        outlookState={Q.noOutlook ? 'failed' : 'ready'}
        onPick={(c) => { (globalThis as any).__suggestPicked = { timeMs: c.hit.timeMs, lat: c.hit.latitude, lon: c.hit.longitude, score: c.score }; }}
        onBack={() => { (globalThis as any).__suggestBack = true; }}
      />
    </View>
  );
}

function CalcRepro({ W, H }: { W: number; H: number }) {
  const [topic, setTopic] = React.useState<CalcTopic>(Q.topic ?? 'sunrise');
  React.useEffect(() => { useCelestialStore.setState({ themeMode: Q.light ? 'light' : 'dark' } as any); }, []);
  const profile = React.useMemo(() => {
    if (Q.noTerrain) return null;
    const ridgeH = Q.ridgeH ?? 175, base = 40;
    const hgt = (e: number, s: number) => {
      const d = Math.hypot(e, s), az = ((Math.atan2(e, -s) * 180) / Math.PI + 360) % 360;
      return Math.abs(az - 120) < 15 && Math.abs(d - 4200) < 150 ? ridgeH : base;
    };
    return buildHorizonProfile(hgt, base + 1.6, { maxDistM: 15000 });
  }, []);
  const scoreInput = React.useMemo(() => {
    const T = new Date('2026-11-19T17:00:00+09:00');
    const lo = Q.low ?? 4, mi = Q.mid ?? 18, hi = Q.high ?? 63, sunLow = Q.sunLow ?? 0;
    const mk = (l: number, m: number, h: number, d: number, off: number) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['2026-11-19T17:00'], timeMs: [T.getTime()], low: [l], mid: [m], high: [h], directNormalIrradiance: [300], totalColumnWaterVapour: [18], precipitation: [0], visibility: [20000], humidity: [55] } });
    const path = [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 45, 90, 135, 180, 225, 270, 315].map(a => mk(a === 0 && d === 60 ? sunLow : a === 0 ? 0 : lo * 0.8 + (a === 90 && d === 100 ? 25 : 0), mi, hi, d, a)))];
    const pred = predictSunset(path as any, T, Q.sunAlt ?? 0.5, 20000, 55, 37.5, 30, 323, 250);
    return { prediction: pred, ring: path.map(p => ({ distance: p.distance, azimuthOffset: p.azimuthOffset, low: p.hourly.low[0], mid: p.hourly.mid[0], high: p.hourly.high[0] })), time: T, eventMs: T.getTime(), sunAzDeg: Q.sunAz ?? 250, kind: 'sunset' as const };
  }, []);
  const starArgs = React.useMemo(() => starArgsFor({
    date: new Date(Q.t ?? '2026-12-21T03:00:00Z'),
    lat: Q.lat ?? 37.5665,
    lon: Q.lon ?? 126.978,
    elevM: 38,
    weatherAt: () => (Q.noCloud ? null : { cloudPct: Q.cloud ?? 25, aod550: Q.aod ?? 0.12, humidityPct: Q.rh ?? 55, visibilityM: Q.vis ?? null, pm25: Q.pm ?? null }),
    lightPollutionMag: Q.noLp ? null : (Q.lp ?? 6.2),
  }), []);
  return (
    <View style={{ width: W, height: H }}>
      <CalcStepsView
        getScoreInput={() => scoreInput}
        getStarArgs={() => starArgs}
        qualityWord={(q) => verdictWord(q as any, Q.lang ?? 'ko')}
        language={Q.lang ?? 'ko'}
        date={new Date(Q.t ?? '2026-12-21T03:00:00Z')}
        latitude={Q.lat ?? 37.5665}
        longitude={Q.lon ?? 126.978}
        placeName={Q.place ?? '서울 중구'}
        topic={topic}
        onTopic={setTopic}
        getHorizon={profile ? () => profile : undefined}
        onBack={() => { (globalThis as any).__calcBack = true; }}
        onOpenSandbox={() => { (globalThis as any).__calcSandbox = true; }}
      />
    </View>
  );
}

(globalThis as any).__sky = () => (globalThis as any).__skyHandle;
// 서 있을 자리 찾기 계산을 실제 장면의 표본기로 돌려 보는 용도(window.__stand.findStandPoints 등) — 장면 시험 스크립트가 씁니다.
(globalThis as any).__stand = { findStandPoints, groupStandHits, standQueryFor, rankStands, rebuildPicked, bodySky, fetchUrbanMask };
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
  // ring:1 — 앱처럼 고리 예보(시간별 바람 포함)를 받아 sim.pathData 와 분 단위 보간 날씨로 넘깁니다(구름 이동 재현, 2026-11-18).
  const [ring, setRing] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    if (!Q.ring) return;
    // ringFile: 미리 받아 둔 고리(JSON)를 같은 폴더에서 읽음 — 예보 서버 한도와 모델 런 차이 없이 같은 자료로 재현(2026-11-19).
    (Q.ringFile ? fetch(Q.ringFile).then(r => r.json()).then(j => j.map((d: any) => ({ ...d, hourly: { ...d.hourly, time: d.hourly.time } }))) : fetchDayWeatherRing(lat ?? 37.5, lon ?? 127, new Date(tNow ?? Date.now()), true)).then(p => { setRing(p as any[]); (globalThis as any).__ringReady = (p as any[]).length; }).catch(e => { (globalThis as any).__ringReady = 'err ' + String(e); });
  }, []);
  const ringWx = React.useMemo(() => (ring && ring.length ? getInterpolatedWeather(ring as any, new Date(tNow ?? Date.now())) : null), [ring, tNow]);
  if (Q.graph) return <GraphRepro W={W} />;
  if (Q.bar) return <BarRepro W={W} />;
  // pick:1 — 탭으로 지형 고르기(샌드박스). 결과를 window.__picked 에 남기고 정보 패널을 띄웁니다.
  const [picked, setPicked] = React.useState<any>(null);
  if (Q.sbx) return <PanelRepro W={W} H={H} />;
  if (Q.calc) return <CalcRepro W={W} H={H} />;
  if (Q.onboard) return <OnboardRepro W={W} H={H} />;
  if (Q.objpanel) return <ObjPanelRepro W={W} H={H} />;
  if (Q.suggest) return <SuggestRepro W={W} H={H} />;
  if (Q.globe) return <GlobeRepro W={W} H={H} />;
  return (
    <View style={{ width: W, height: H }}>
      <SkyScene3D
        sim={{ terrain: { observerElevation: elevM ?? 0 }, ...(ring ? { pathData: ring } : {}) } as any}
        currentTime={new Date(tNow ?? Date.now())}
        sunAltitude={sunAlt ?? 30}
        sunAzimuth={sunAz ?? 180}
        prediction={null}
        location={{ coords: { latitude: lat ?? 37.5, longitude: lon ?? 127 } }}
        // 장노출 시험(2026-11-18): window.__sky() 로 SkyScene3D 손잡이(renderLongExposure 등)를 받습니다.
        ref={(h: any) => { (globalThis as any).__skyHandle = h; }}
        // bld:1 — 3D 건물 켜기(2026-11-18 건물 자리 고도 깎기 확인)
        {...(Q.bld ? { layers: { labels: true, sun: true, moon: true, stars: true, milkyway: true, planets: true, clouds: true, paths: true, cityLights: true, buildings: true } } : {})}
        interpolatedWeather={ringWx ?? wx ?? []}
        theme={{ accent: '#FF9800' }}
        cameraAzimuthProp={view?.az}
        cameraElevationProp={view?.el}
        fovProp={view?.fov}
        skySettings={{ starBrightness: 1, starMagLimit: 6.5, pixelArtRows: 0, diagRawTerrain: !!Q.diag, volumetricSky: Q.vol === undefined ? undefined : !!Q.vol,
          // §130 흐름 모형 — volFlow:1 · volFlowUv:1 · volq:'low'|'medium'|'high' · volres:0.25~1 (장치 크기 알갱이 자)
          volumetricFlow: !!Q.volFlow, volumetricFlowUv: !!Q.volFlowUv,
          ...(Q.volq ? { volumetricQuality: Q.volq } : {}), ...(Q.volres != null ? { volumetricRes: Q.volres, volumetricAutoRes: false } : {}) }}
        // tele:N · lens:1 — 샌드박스 망원 배율과 렌즈 정보 배지(2026-11-19). lens:1 이면 눈금 HUD 를 켭니다.
        telephotoX={Q.tele ?? 1}
        showLensInfo={!!Q.lens}
        eyeHeightM={Q.eyeH}
        pickEnabled={!!Q.pick}
        onPickTarget={(t: any) => { (globalThis as any).__picked = t; setPicked(t); }}
        pickedTarget={picked}
        fullScreen
        hideHudOverlay={!Q.lens}
        hideCompassBar={!Q.lens}
        isActive
      />
      {/* panel:1 — 개발자 튜닝 패널을 함께 띄웁니다(폰 폭에서 헤더·볼륨 상태 확인용). */}
      {picked ? (
        <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>
          <ObjectInfoPanel
            language="ko"
            target={picked}
            sun={{ azDeg: sunAz ?? 180, altDeg: sunAlt ?? 30 }}
            moon={{ azDeg: 90, altDeg: -20 }}
            // 해·달 걸기(2026-11-19): 앱과 같은 길 — 시각을 옮기고 시선을 대상에 맞춥니다(해 위치도 그 시각 것으로).
            observer={{ latitude: lat ?? 37.5, longitude: lon ?? 127, fromMs: new Date(tNow ?? Date.now()).getTime() }}
            getSkyline={() => (globalThis as any).__skyHandle?.getSkyline?.() ?? null}
            onAlign={(hit: any) => {
              (globalThis as any).__aligned = hit;
              const sp = getSunPosition(new Date(hit.timeMs), lat ?? 37.5, lon ?? 127);
              setDyn((d: any) => ({ ...d, t: new Date(hit.timeMs).toISOString(), sunAlt: sp.altitude, sunAz: sp.azimuth }));
              (globalThis as any).__skyHandle?.setCameraView?.(picked.azDeg, picked.elDeg, 14, { centerOffsetYFrac: 0.25 });
            }}
            onSnap={(top: boolean) => setPicked((p: any) => { const n = p ? snapBuildingTarget(p, top) : p; (globalThis as any).__picked = n; return n; })}
            onClear={() => setPicked(null)}
          />
        </View>
      ) : null}
      {Q.panel ? <DevTuningPanel visible onClose={() => { (globalThis as any).__panelClosed = true; }} /> : null}
    </View>
  );
}
