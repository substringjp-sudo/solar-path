/**
 * worldLand.ts
 *
 * **육지 윤곽을 번들에 넣습니다.**
 *
 * ⚠ 예전에는 `MapGlobe` 가 실행 중에 `cdn.jsdelivr.net` 에서 받았습니다.
 * 실패하면 **육지 없는 빈 구**가 됐습니다. 줌으로 자동 전환하는 지금은
 * "오프라인에서 줌만 당겼는데 화면이 빈다" 가 되므로 번들에 넣습니다.
 *
 * `land-110m`(55KB)은 `countries-110m`(108KB)의 절반인데 **같은 육지 윤곽**을
 * 줍니다 — 옛 코드도 `countries-110m` 에서 `objects.land` 만 꺼내 썼습니다.
 * 나라 경계를 안 그리므로 작은 쪽이 맞습니다.
 */
import * as topojson from 'topojson-client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const landTopo = require('../assets/land-110m.json');

/** 육지 GeoJSON. 앱이 뜰 때 한 번만 풉니다. */
export const WORLD_LAND: any = topojson.feature(landTopo, landTopo.objects.land);
