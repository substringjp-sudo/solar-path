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

const Q = (() => {
  try { return JSON.parse(decodeURIComponent((globalThis as any).location?.hash?.slice(1) || '{}')); }
  catch { return {}; }
})();

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
        fullScreen
        hideHudOverlay
        hideCompassBar
        isActive
      />
    </View>
  );
}
