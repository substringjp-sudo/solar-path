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

const Q = (() => {
  try { return JSON.parse(decodeURIComponent((globalThis as any).location?.hash?.slice(1) || '{}')); }
  catch { return {}; }
})();
// §129 볼륨 하늘 지형 알베도 후보(RULER-terrain-lit.md) — "talb":[r,g,b]
if (Array.isArray(Q.talb)) Object.assign(VOLUMETRIC_TERRAIN_ALBEDO, { r: Q.talb[0], g: Q.talb[1], b: Q.talb[2] });

export default function App() {
  const W = Q.w ?? 400, H = Q.h ?? 300;
  return (
    <View style={{ width: W, height: H }}>
      <SkyScene3D
        sim={{ terrain: { observerElevation: Q.elevM ?? 0 } }}
        currentTime={new Date(Q.t ?? Date.now())}
        sunAltitude={Q.sunAlt ?? 30}
        sunAzimuth={Q.sunAz ?? 180}
        prediction={null}
        location={{ coords: { latitude: Q.lat ?? 37.5, longitude: Q.lon ?? 127 } }}
        interpolatedWeather={Q.wx ?? []}
        theme={{ accent: '#FF9800' }}
        cameraAzimuthProp={Q.view?.az}
        cameraElevationProp={Q.view?.el}
        fovProp={Q.view?.fov}
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
