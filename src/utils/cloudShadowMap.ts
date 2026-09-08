/**
 * **땅에 지는 구름 그림자** — 지상 직달 투과율 지도.
 *
 * 실기 보고: "구름의 그림자도 땅에 안보여." 맞습니다. 지금까지 그림자는
 * **구름끼리**(상층 → 중층)만 있었고, 땅은 구름이 하늘의 어디에 있든 늘
 * 같은 직달광을 받았습니다.
 *
 * ## 운량장은 이미 있습니다 — 자리만 옮기면 됩니다
 *
 * 구름은 `(방위 × 고도)` 격자로 들고 있습니다. 그런데 고도 `H` 의 층을
 * 고도각 `ε` 로 본다는 것은 곧 **지상 거리 `H / tan ε`** 를 본다는 뜻이라,
 * 그 격자는 사실 그 층 수평면의 극좌표 지도입니다. 그러니 새 자료가
 * 필요 없습니다.
 *
 * 지상 점 `p` 에 해가 닿으려면 햇빛이 층을 지나는 자리는
 *
 *     q = p + 태양수평방향 · (H / tan(태양고도))
 *
 * 입니다. 그 `q` 를 관측자 기준 (방위, 고도각) 으로 되돌려 운량을 읽습니다.
 * 태양이 낮을수록 이 어긋남이 커집니다 — 고도 1.5km 층, 해 10° 면 8.5km
 * 입니다. 그래서 **저녁에는 머리 위 구름이 아니라 저 멀리 구름이 내 발밑을
 * 그늘지게 합니다.** 이 항이 없으면 노을에 땅이 늘 균일하게 밝습니다.
 *
 * ## 왜 지도(텍스처)인가
 *
 * 셰이더에서 층마다 격자를 이중선형으로 읽으려면 운량 격자 전체를 GPU 로
 * 올려야 하고, 층·방위·고도 인덱싱을 GLSL 로 옮겨 적어야 합니다. 그건
 * 같은 논리를 두 벌 두는 일입니다. 대신 JS 에서 한 번 풀어 **작은 2D
 * 투과율 지도**로 굽습니다 — 64×64 면 4,096번 조회뿐이고, 구름 그늘은
 * 원래 km 규모라 250m 해상도로 충분합니다.
 */
import * as THREE from 'three';
import { sampleCoverAt } from '../components/SkyScene3D/CloudDeck';
import { LAYER_ALTITUDE_KM, type LayerKey, type LayerSample } from './skyColumn';

/** 지도 한 변의 화소 수. */
export const CLOUD_SHADOW_PX = 96;

/**
 * 지도가 덮는 반경 (m). 관측자를 가운데 두고 ±이 값.
 *
 * ⚠ 이 값이 덮어야 하는 것은 **땅**의 범위이지 구름의 범위가 아닙니다.
 * 구름까지의 어긋남(H/tan)은 `cloudTransmittanceAt` 안에서 더해집니다.
 *
 * 근거리 지형 격자가 3km, 해수면은 수평선까지 갑니다. 12km 면 지형 전체와
 * 눈에 띄는 근해를 덮고, 그 밖은 가장자리 값이 늘어납니다 — 그 거리의
 * 바다는 이미 수평선 근처 1° 안으로 눌려 있어 그늘 무늬가 안 보입니다.
 * 96화소면 화소당 250m 이고, 구름 그늘은 원래 km 규모입니다.
 */
export const CLOUD_SHADOW_HALF_M = 12000;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const LAYERS: LayerKey[] = ['low', 'mid', 'high'];

export interface CloudShadowInput {
  /** `CloudDeck` 가 쓰는 것과 **같은** 표본 배열이어야 합니다. */
  samples: LayerSample[];
  /** 표본 격자의 방위 칸 수 (CloudDeck 과 같은 값). */
  azSteps: number;
  /** 표본 격자의 고도각들 (`elevationGrid()`). */
  elevs: number[];
  sunAltDeg: number;
  sunAzDeg: number;
  /** 층의 광학두께. 직달 투과율 exp(−τ) 로 씁니다. */
  tauFor: (layer: LayerKey) => number;
}

/**
 * 지상 점 하나의 **직달 투과율** (0~1).
 *
 * 층마다 `(1 − 운량) + 운량 · exp(−τ)` 를 곱합니다. 앞항은 구름 사이로
 * 그냥 지나가는 몫, 뒷항은 구름을 뚫고 오는 몫입니다. 운량을 "구름에
 * 맞을 확률"로 읽는 셈이라 부분운량이 저절로 반그늘이 됩니다.
 */
export function cloudTransmittanceAt(
  eastM: number,
  southM: number,
  input: CloudShadowInput,
): number {
  const { samples, azSteps, elevs, sunAltDeg, sunAzDeg, tauFor } = input;
  // 해가 지평선 아래면 직달이 없습니다 — 그늘을 논할 것도 없습니다.
  if (sunAltDeg <= 0.5) return 1;

  const tanAlt = Math.tan(sunAltDeg * D2R);
  // ⚠ 씬 규약과 같은 방위 → 지상 방향: 동 = sin A, 남 = −cos A.
  const sunE = Math.sin(sunAzDeg * D2R);
  const sunS = -Math.cos(sunAzDeg * D2R);

  let t = 1;
  for (const layer of LAYERS) {
    const H = LAYER_ALTITUDE_KM[layer] * 1000;
    const reach = H / Math.max(tanAlt, 1e-3);
    const qe = eastM + sunE * reach;
    const qs = southM + sunS * reach;
    const r = Math.hypot(qe, qs);
    // 관측자 기준 방위·고도각으로 되돌립니다.
    let az = Math.atan2(qe, -qs) * R2D;
    if (az < 0) az += 360;
    const elev = r < 1 ? 90 : Math.atan2(H, r) * R2D;
    // 격자 밖(수평선보다 낮은 각)은 가장자리 값으로 물러납니다.
    const e = Math.min(Math.max(elev, elevs[0]), elevs[elevs.length - 1]);
    const cover = sampleCoverAt(samples, layer, azSteps, elevs, az, e);
    const through = Math.exp(-Math.min(8, Math.max(0, tauFor(layer))));
    t *= 1 - cover * (1 - through);
  }
  return Math.min(1, Math.max(0, t));
}

/**
 * 투과율 지도를 굽습니다. `px × px`, R 채널에 0~255 로 담습니다.
 *
 * ## ⚠ 관측자 자리를 1 로 맞춰 내보냅니다 — 두 번 세지 않으려고
 *
 * 씬은 이미 직달광에 `1 − overheadOvercast` 를 곱하고 있습니다. 그 위에
 * 이 지도의 절대값을 다시 곱하면 운량을 **제곱**하게 됩니다 (부분운량
 * 0.5 인 날이 0.25 로 어두워집니다).
 *
 * 그래서 내보내는 값은 **관측자 발밑 대비 상대 투과율** 입니다. 발밑은
 * 정확히 1 이라 지금까지의 밝기가 그대로 유지되고, 이 항이 더하는 것은
 * 오직 **무늬** — 저기는 구름 그늘, 여기는 햇살 — 입니다. 균일한 흐림은
 * 무늬가 없으니 1 로 평평해지는데, 그게 맞습니다: 온 하늘이 덮이면 땅에
 * 그림자 무늬가 지지 않고 전체가 어두워질 뿐이고, 그 전체 어두움은 이미
 * 다른 데서 처리하고 있습니다.
 *
 * 발밑이 두꺼운 구름 밑이면 나눗셈이 커지므로 비를 0~4 로 묶습니다.
 *
 * 기존 텍스처를 넘기면 화소만 갈아 끼우고 그대로 돌려줍니다 — 프레임마다
 * 새 텍스처를 만들면 GPU 자원이 샙니다.
 */
export function buildCloudShadowTexture(
  input: CloudShadowInput,
  reuse?: THREE.DataTexture | null,
  px: number = CLOUD_SHADOW_PX,
  halfM: number = CLOUD_SHADOW_HALF_M,
): THREE.DataTexture {
  const tex =
    reuse && reuse.image && (reuse.image as { width: number }).width === px
      ? reuse
      : new THREE.DataTexture(new Uint8Array(px * px * 4), px, px, THREE.RGBAFormat);
  const data = tex.image.data as Uint8Array;

  // 발밑의 절대 투과율. 이걸로 나눠 상대값을 만듭니다 (위 주석 참고).
  const atObs = Math.max(0.05, cloudTransmittanceAt(0, 0, input));

  const step = (2 * halfM) / px;
  for (let j = 0; j < px; j++) {
    // ⚠ 행 j 는 **남쪽** 축입니다. DataTexture 는 뒤집지 않으므로 행 0 이
    //   v=0 이고, 셰이더의 uv.y = 남/(2·half) + 0.5 와 그대로 맞습니다.
    const southM = -halfM + (j + 0.5) * step;
    for (let i = 0; i < px; i++) {
      const eastM = -halfM + (i + 0.5) * step;
      const t = cloudTransmittanceAt(eastM, southM, input) / atObs;
      const o = (j * px + i) * 4;
      // 0~4 를 0~255 에 담습니다. 셰이더가 4 를 곱해 되돌립니다.
      const v = Math.round(Math.min(4, Math.max(0, t)) * (255 / 4));
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
  }
  tex.colorSpace = THREE.NoColorSpace;   // 투과율입니다 — 색이 아닙니다.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** 그늘이 없는 지도 (전부 1). 자료가 오기 전의 대비책. */
export function createOpenSkyShadowTexture(): THREE.DataTexture {
  // 1.0 을 0~4 눈금에 담으면 255/4 입니다.
  const v = Math.round(255 / 4);
  const data = new Uint8Array([v, v, v, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** 지면·수면 셰이더가 함께 쓰는 GLSL. */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uCloudShadowTex;
uniform float uCloudShadowHalfM;
uniform float uCloudShadow;     // 0 이면 끕니다 (대조 판정용)

/**
 * 그 지상 좌표(동, 남 m)의 **관측자 발밑 대비** 직달 투과율.
 *
 * 발밑이 1 이고, 구름 그늘이면 그보다 작고, 발밑이 그늘인데 저기가 햇살이면
 * 1 보다 큽니다. 지도는 0~4 를 0~1 에 담아 두었으므로 4 를 곱해 되돌립니다.
 */
float cloudShadowAt(vec2 g) {
  if (uCloudShadow < 0.5) return 1.0;
  vec2 uv = g / (2.0 * uCloudShadowHalfM) + 0.5;
  return texture2D(uCloudShadowTex, clamp(uv, 0.0, 1.0)).r * 4.0;
}
`;
