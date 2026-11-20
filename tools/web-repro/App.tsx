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
import { CloudCaption } from '../../src/components/SkyScreen/CloudCaption';
import { PredictionCard } from '../../src/components/SunsetSimulation/PredictionCard';
import { cloudSummary, skyDirection } from '../../src/utils/skyWords';
import { DateTimeBar } from '../../src/components/TimeBar/DateTimeBar';
import { ScoreGraph } from '../../src/components/SkyScreen/ScoreGraph';
import { scoreWindow, sampleScores } from '../../src/utils/scoreSeries';
import { sunPosition } from '../../src/utils/solarPosition';
import { SandboxPanel } from '../../src/components/SkyScreen/SandboxPanel';
import { DialPair, MoveStick } from '../../src/components/SkyScreen/SandboxDials';
import { ObjectInfoPanel } from '../../src/components/SkyScreen/ObjectInfoPanel';
import { LearnScreen } from '../../src/components/LearnScreen/LearnScreen';
import { WhySection } from '../../src/components/LearnScreen/WhySection';
import { UpcomingCards } from '../../src/components/SkyScreen/UpcomingCards';
import { useForecastDays } from '../../src/hooks/useForecastDays';
import { upcomingMoments, starMoment } from '../../src/utils/upcomingMoments';
import { localNoons } from '../../src/utils/sunForecast';
import { useCelestialStore } from '../../src/store/useCelestialStore';
import { getVolumetricStatus } from '../../src/components/VolumetricProbe/volumetricStatus';
import { fetchDayWeatherRing, getInterpolatedWeather } from '../../src/utils/weather';
import { getSubsolarPoint, getSublunarPoint, getMoonPhase, getTerminatorSegments, getSunPosition } from '../../src/utils/celestial';
import { buildTopicResult, type TopicResult } from '../../src/utils/calcTopic';
import { LEARN_TOPICS, type LearnTopic } from '../../src/utils/learnSections';
import { starArgsFor } from '../../src/utils/starTonight';
import { buildHorizonProfile } from '../../src/utils/horizon';
import { predictSunset } from '../../src/utils/sunsetPhysics';
import { verdictWord, localHHMM } from '../../src/components/SunsetSimulation/PredictionCard';
import { snapBuildingTarget } from '../../src/utils/demPick';
import { createPickIndexBuilder } from '../../src/utils/buildingPick';
import { pickTargetAt } from '../../src/utils/pickTarget';
import { Onboarding } from '../../src/components/Onboarding/Onboarding';

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

/**
 * sbxctl:1 — 샌드박스 세로 막대(높이 · 줌)와 이동 조이스틱만(2026-11-19). 값은 window.__sbx 에 남깁니다: {eye, zoom, moves:[[동 m, 북 m] …]}.
 *   eye · zoom 처음 값, step 걸음 크기(m, 기본 100), lang. 하늘색 배경 위에 그려 읽힘을 봅니다.
 */
function SandboxCtlRepro({ W }: { W: number }) {
  const [eye, setEye] = React.useState<number>(Q.eye ?? 1.6);
  const [zoom, setZoom] = React.useState<number>(Q.zoom ?? 1);
  const moves = React.useRef<number[][]>([]);
  (globalThis as any).__sbx = { eye, zoom, moves: moves.current };
  return (
    <View style={{ width: W, padding: 16, backgroundColor: '#35557F', flexDirection: 'row', gap: 28, alignItems: 'flex-start' }}>
      <MoveStick language={Q.lang ?? 'ko'} stepM={Q.step ?? 100} onMove={(e, n) => { moves.current.push([Math.round(e * 10) / 10, Math.round(n * 10) / 10]); }} />
      <DialPair language={Q.lang ?? 'ko'} eyeHeightM={eye} onEyeHeight={setEye} zoomX={zoom} onZoom={setZoom} />
    </View>
  );
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
/**
 * words:1 — 쉬운 말(2026-11-19): 판정 카드의 해 방향 머리 줄과 하늘 위 구름 한 줄. 실제 `predictSunset` 으로 카드를 그리고 구름 줄은 같은 운량에서 만듭니다.
 *   low · mid · high 운량 %, az 해 방위(기본 245), lang · light.   예: {"words":1,"low":20,"mid":5,"high":70,"az":245}
 */
function WordsRepro({ W }: { W: number }) {
  React.useEffect(() => { useCelestialStore.setState({ themeMode: Q.light ? 'light' : 'dark', language: Q.lang ?? 'ko' } as any); }, []);
  const lo = Q.low ?? 20, mi = Q.mid ?? 5, hi = Q.high ?? 70, lang = Q.lang ?? 'ko';
  const pred = React.useMemo(() => {
    const T0 = new Date('2026-11-21T17:00:00+09:00');
    const mk = (l: number, m: number, h: number, d: number, off: number) => ({ distance: d, azimuthOffset: off, source: 'standard', hourly: { time: ['x'], timeMs: [T0.getTime()], low: [l], mid: [m], high: [h] } });
    const path = [mk(lo, mi, hi, 0, 0), ...[30, 60, 100, 200].flatMap(d => [0, 90, 180, 270].map(a => mk(a === 0 ? 0 : lo, mi, hi, d, a)))];
    return predictSunset(path as any, T0, 0.5, 20000, 55, 37.5, 38, 325, Q.az ?? 245);
  }, []);
  const line = cloudSummary({ low: lo, mid: mi, high: hi }, lang);
  return (
    <View style={{ width: W, backgroundColor: Q.light ? '#E9EEF4' : '#070A12' }}>
      <View style={{ height: 150, backgroundColor: '#35557F' }}>{line ? <CloudCaption text={line} /> : null}</View>
      <View style={{ padding: 12 }}>
        <PredictionCard prediction={pred} isSunrise={false} peakTime={new Date('2026-11-21T17:11:00+09:00')} directionText={skyDirection(Q.az ?? 245, lang)} onWhy={() => {}} />
      </View>
    </View>
  );
}

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
        : (
          // 시선 읽음 줄과 "시선 기준" 이동(2026-11-20): window.__view = {az, el} 로 시선을 바꿉니다(없으면 Q.az · Q.el). noView:1 이면 시선을 못 읽는 상태(null), noGetView:1 이면 getView 를 안 줌.
          // 조이스틱이 내보낸 걸음(동 m, 북 m)은 window.__moves 에 쌓입니다.
          <SandboxPanel
            language={Q.lang ?? 'ko'}
            eyeHeightM={eyeH}
            onEyeHeight={setEyeH}
            stepM={step}
            onStep={setStep}
            onMove={(e, n) => { ((globalThis as any).__moves ??= []).push([Math.round(e * 100) / 100, Math.round(n * 100) / 100]); }}
            awayM={Q.awayM ?? null}
            onHome={() => {}}
            getView={Q.noGetView ? undefined : () => (Q.noView ? null : ((globalThis as any).__view ?? { az: Q.az ?? 128.4, el: Q.el ?? 6.9 }))}
          />
        )}
    </View>
  );
}

/**
 * why:1 (옛 이름 calc:1) — 학습 페이지의 "결과가 나온 과정" 구역(2026-11-20, 옛 계산 과정 창을 옮김). 다섯 주제가 접는 줄로 나옵니다.
 *   open:"score"|"sunrise"|"sunset"|"stars"|"cloud" 를 주면 그 주제가 펼친 채 시작합니다(없으면 모두 접힘). topic 도 같은 뜻의 옛 이름입니다.
 * 합성 능선으로 땅 프로필을 만듭니다: 해 뜨는 쪽(방위 120° ± 15°) 4.2 km 에 높이 ridgeH m 의 띠.
 *   예: {"why":1,"open":"sunrise","t":"2026-12-21T03:00:00Z","lat":37.5665,"lon":126.978,"ridgeH":175,"topic":"sunrise","lang":"ko","light":0,"noTerrain":0}
 * noTerrain:1 이면 땅 자료 없이(평평한 수평선), light:1 이면 밝은 모드.
 * 노을 점수: 합성 예보 링(낮은 low · 중간 mid · 높은 high %, 해 쪽 60 km 의 낮은 구름 sunLow %, 해 고도 sunAlt°)으로 predictSunset 을 돌립니다.
 *   예: {"why":1,"open":"score","low":4,"mid":18,"high":63,"sunLow":0,"sunAlt":0.5}
 * 별 보기 조건: 앱과 같은 `starArgsFor`(해·달·달 지는 시각은 t·lat·lon 에서 계산)에 합성 날씨를 넣습니다.
 *   cloud(운량 %) · aod · vis(시정 m) · rh(습도 %) · pm(PM2.5) · lp(빛 지도 한계등급). noCloud:1 이면 구름 예보 없음, noLp:1 이면 빛 지도 없음.
 *   예: {"why":1,"open":"stars","t":"2026-12-21T03:00:00Z","cloud":25,"aod":0.12,"rh":55,"lp":6.2}
 * 구름 모양: 합성 장면 값(층별 운량 cLow · cMid · cHigh · cTotal, 그려진 종류 genus "sc/as/-", 광학두께 tau, 높이 alt [낮은·중간·높은 km], 바람 wind [[속도, 불어오는 방위]×3])을
 *   카드로 옮깁니다(`buildCloudShapeCards`). noScene:1 이면 장면 그림 없음, noWind:1 이면 바람 없음.
 *   예: {"why":1,"open":"cloud","cLow":15,"cMid":10,"cHigh":70,"cTotal":80,"genus":"sc/as/-","tau":1.8,"alt":[1.2,4.5,9],"wind":[[12,315],[30,270],[72,225]]}
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

function WhyRepro({ W, H }: { W: number; H: number }) {
  const lang = Q.lang ?? 'ko';
  React.useEffect(() => { useCelestialStore.setState({ themeMode: Q.light ? 'light' : 'dark', language: lang } as any); }, []);
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
  const cloudArgs = Q.noScene ? null : {
    scene: { low: Q.cLow ?? 15, mid: Q.cMid ?? 10, high: Q.cHigh ?? 70, total: Q.cTotal, genus: Q.genus ?? 'sc/as/-', tau: Q.tau },
    altKm: { low: Q.alt?.[0] ?? null, mid: Q.alt?.[1] ?? null, high: Q.alt?.[2] ?? null },
    winds: Q.noWind ? null : (Q.wind ? { low: { speedKmh: Q.wind[0][0], bearingDeg: Q.wind[0][1] }, mid: { speedKmh: Q.wind[1][0], bearingDeg: Q.wind[1][1] }, high: { speedKmh: Q.wind[2][0], bearingDeg: Q.wind[2][1] } } : null),
  };
  const results = React.useMemo(() => {
    const out = {} as Record<LearnTopic, TopicResult | null>;
    for (const t of LEARN_TOPICS) {
      out[t] = buildTopicResult(t, {
        language: lang, date: new Date(Q.t ?? '2026-12-21T03:00:00Z'), latitude: Q.lat ?? 37.5665, longitude: Q.lon ?? 126.978,
        fmtTime: (ms) => localHHMM(new Date(ms), Q.tz ?? 9),
        horizon: profile, scoreInput, starArgs, cloudArgs: cloudArgs as any, qualityWord: (q) => verdictWord(q as any, lang),
      });
    }
    return out;
  }, []);
  const open: LearnTopic | null = Q.open ?? Q.topic ?? null;
  return (
    <View style={{ width: W, minHeight: H, padding: 16, backgroundColor: Q.light ? '#F8FAFC' : '#0D1320' }}>
      <WhySection
        language={lang}
        results={results}
        openTopic={open}
        entryNonce={1}
        notes={cloudArgs ? { cloud: lang === 'ko' ? '01 하늘이 지금 그린 17:00 의 구름이에요.' : 'The clouds the 01 Sky drew for 17:00.' } : undefined}
        onOpenData={() => { (globalThis as any).__openData = true; }}
      />
    </View>
  );
}

/**
 * learn:1 (옛 이름 forecast:1) · cards:1 — 02 학습 페이지 전체와 01 하늘의 "다가오는 좋은 순간" 카드(2026-11-19 · 20). 16일 예보를 실제 경로(훅 → `fetchSunForecast` → 판정)로 받으므로
 * 하네스 페이지가 Open-Meteo 응답을 가짜로 줘야 합니다(`scratchpad/forecast-shot.js` 처럼 Playwright 로 가로챕니다). 위치는 서울, 시간대 +9.
 *   learn:1 — 02 학습 페이지 전체. focusDay(0~15) · focusSide("sunrise"|"sunset") 를 주면 01 하늘의 카드에서 건너온 모습(그 날 · 쪽이 고른 날),
 *     section("today"|"forecast"|"data"|"why"|"globe") · topic("score"|…) 을 주면 그 구역으로 맞추고 그 주제를 펼칩니다. 누르면 window.__openSky 에 true.
 *   cards:1 — 카드 줄만. 누르면 window.__cardTap 에 {noonMs, side}.   공통: lang · light.
 *   cards:1 star:{cloud, lp} — "오늘 밤 별 보기" 카드도 함께. 서울 · 지금 시각으로 실제 경로(`starArgsFor` → `starMoment`)를 돌립니다(운량 cloud % · 빛 지도 lp 등급).
 *     누르면 window.__starTap = true.   window.__cards.star 에 카드 값(없으면 null).
 */
function seedForecastStore() {
  useCelestialStore.setState({
    themeMode: Q.light ? 'light' : 'dark',
    language: Q.lang ?? 'ko',
    timezoneOffsetHours: 9,
    location: { coords: { latitude: 37.5665, longitude: 126.978, altitude: 38, accuracy: 10, heading: null, speed: null, altitudeAccuracy: null }, timestamp: Date.now() },
  } as any);
}
function LearnRepro({ W, H }: { W: number; H: number }) {
  React.useState(() => { seedForecastStore(); return 0; });
  const entry = React.useMemo(() => (
    Q.focusDay != null || Q.section || Q.topic
      ? { section: Q.section, topic: Q.topic, focus: Q.focusDay != null ? { noonMs: localNoons(new Date(), 9, 16)[Q.focusDay], side: Q.focusSide ?? 'sunset' } : null, nonce: 1 }
      : null
  ), []);
  return (
    <View style={{ width: W, height: H }}>
      <LearnScreen isActive setCurrentTime={(d) => { (globalThis as any).__setTime = d.toISOString(); }} onOpenSky={() => { (globalThis as any).__openSky = true; }} entry={entry as any} />
    </View>
  );
}
function CardsRepro({ W }: { W: number }) {
  React.useState(() => { seedForecastStore(); return 0; });
  const { days, now, load } = useForecastDays({ fetch: true, compute: true, days: 3, haptic: false });
  const moments = React.useMemo(() => upcomingMoments(days, now.getTime()), [days, now]);
  const star = React.useMemo(() => {
    if (!Q.star) return null;
    const o: any = Q.star === true ? {} : Q.star;
    const a = starArgsFor({ date: now, lat: 37.5665, lon: 126.978, elevM: 38, weatherAt: () => ({ cloudPct: o.cloud ?? 15 }), lightPollutionMag: o.lp ?? 4.6 });
    return starMoment({ timeMs: a.timeMs, nowMs: now.getTime(), input: a.input, cloudKnown: a.cloudKnown });
  }, [now]);
  (globalThis as any).__cards = {
    load: load.kind,
    moments: moments.map(m => ({ day: m.dayOffset, side: m.side, q: m.quality, t: new Date(m.timeMs).toISOString() })),
    star: star ? { t: new Date(star.timeMs).toISOString(), limit: Math.round(star.limitMag * 100) / 100, cloud: star.cloudPct, fromNow: star.fromNow } : null,
  };
  return (
    <View style={{ width: W, padding: 16, backgroundColor: Q.light ? '#F8FAFC' : '#0D1320' }}>
      {(moments.length > 0 || star) && (
        <UpcomingCards
          moments={moments}
          star={star}
          language={Q.lang ?? 'ko'}
          tzHours={9}
          onPress={(m) => { (globalThis as any).__cardTap = { noonMs: m.noonMs, side: m.side }; }}
          onStarPress={() => { (globalThis as any).__starTap = true; }}
        />
      )}
    </View>
  );
}

(globalThis as any).__sky = () => (globalThis as any).__skyHandle;
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
  if (Q.words) return <WordsRepro W={W} />;
  if (Q.sbx) return <PanelRepro W={W} H={H} />;
  if (Q.learn || Q.forecast) return <LearnRepro W={W} H={H} />;
  if (Q.cards) return <CardsRepro W={W} />;
  if (Q.why || Q.calc) return <WhyRepro W={W} H={H} />;
  if (Q.onboard) return <OnboardRepro W={W} H={H} />;
  if (Q.objpanel) return <ObjPanelRepro W={W} H={H} />;
  if (Q.globe) return <GlobeRepro W={W} H={H} />;
  if (Q.sbxctl) return <SandboxCtlRepro W={W} />;
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
