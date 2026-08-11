/**
 * cloudPlacement.ts
 *
 * 하늘 방향 샘플(skyColumn)에서 구름 빌보드를 만듭니다.
 *
 * Why 지상 격자를 버렸나: 이전 구현은 29점 지상 격자의 각 점에 구름을 놓고
 * 고도각을 `atan2(고도, 거리)`로 구했습니다. 격자 거리가 0/50/100/200km라
 * 29칸 중 28칸이 고도각 13° 아래에 깔렸고, 그 위 — 하늘의 77.6% — 를
 * 중심 셀 한 칸이 담당했습니다. 고개를 들면 늘 비어 있었습니다.
 * 지금은 skyColumn이 방향을 먼저 정하고 거리를 역산하므로 천정도 채워집니다.
 *
 * 운형과 운량도 위경도 해시가 아니라 실제 기상값에서 나옵니다.
 */
import {
  getCloudPreset,
  PRESET_OPTICS,
  resolvePresetFromWeather,
  representativeTauForObserver,
  type CloudPresetName,
  type CloudOpticsConfig,
} from '../../utils/cloudPresets';
import { clamp01, type RGB } from '../../utils/sunsetPhysics';
import {
  skyRadiance,
  beamAtAltitude,
  cloudOpticalDepthFromDb,
  cloudTauFromDNI,
  applyCloudDimming,
  type DniTauResult,
  type AtmosphereParams,
} from '../../utils/atmosphere';
import {
  buildSkyColumns,
  solveColumnOptics,
  haloStrength,
  WeatherFan,
  LAYER_ALTITUDE_KM,
  type ColumnOptics,
  type LayerSample,
  type LayerKey,
} from '../../utils/skyColumn';
import type { CloudData } from '../../utils/weather';
import { getTuning } from '../../utils/skyTuning';
import { cloudAtlasKey, type CloudAtlas } from './cloudAtlas';

export type LayerType = 'high' | 'mid' | 'low';

/** 구름 3D 고도층별 구면 반지름 */
export const CLOUD_SHELL_RADIUS_HIGH = 460;
export const CLOUD_SHELL_RADIUS_MID  = 430;
export const CLOUD_SHELL_RADIUS_LOW  = 400;

export interface CloudInstanceData {
  azimuthDeg: number;
  elevationDeg: number;
  /**
   * 조명 계산에 쓴 고도각 — **실제로 그려지는 위치**의 고도각입니다.
   * 태양 방향 투영 등 조명성 계산은 전부 이 값을 써야 합니다.
   */
  lightingElevDeg: number;
  distanceKm: number;
  atlasKey: string;
  sizeY: number;
  aspect: number;
  opacity: number;
  beam: RGB;
  ambient: RGB;
  tau: number;
  altitudeKm: number;
  shadowContrast: number;
  rimSharpness: number;
  horizontal: boolean;
  shellRadius: number;
  /** 이 방향 층의 운량 (0~1) — 덱과의 블렌드에 사용 */
  cover: number;
  layer: LayerKey;
}

/** 프리셋별 대표 물리 고도 (km) */
const PRESET_ALTITUDE_KM: Record<CloudPresetName, number> = {
  Cirrus: 11.5,
  Cirrocumulus: 10.0,
  Cirrostratus: 9.0,
  Altocumulus: 5.2,
  Altostratus: 4.2,
  Nimbostratus: 2.8,
  Stratocumulus: 2.0,
  Stratus: 1.2,
  Cumulus: 1.6,
  Cumulonimbus: 3.5,
};

/** 10종 운형별 광학 파라미터. DNI가 없을 때의 폴백입니다. */

/**
 * τ 값은 실제 관측 범위에 맞춰 올렸습니다.
 * 이전 값(난층운 50 → T=0.21, 적란운 70 → T=0.16)은 "비 오는데 꽤 밝은" 수준이라
 * 아무리 두꺼운 구름을 쌓아도 흐린 날이 나오지 않았습니다.
 * (T = 2/(τ(1−g)+2), g = 0.85)
 */

function presetLayerType(name: CloudPresetName): LayerType {
  if (name === 'Cirrus' || name === 'Cirrocumulus' || name === 'Cirrostratus') return 'high';
  if (name === 'Altocumulus' || name === 'Altostratus') return 'mid';
  return 'low';
}

function layerShellRadius(layer: LayerType): number {
  if (layer === 'high') return CLOUD_SHELL_RADIUS_HIGH;
  if (layer === 'mid') return CLOUD_SHELL_RADIUS_MID;
  return CLOUD_SHELL_RADIUS_LOW;
}

function hash01(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * 실제 기상값에서 운형을 고릅니다.
 *
 * 이전에는 `Math.sin(lat*12.9898 + ...)` 해시로 뽑았습니다. 비가 오든 말든
 * 같은 좌표면 같은 운형이 나왔습니다. 여기서는 강수·습도·운량으로 판정합니다.
 *
 * 판정 근거는 기본적인 운형 분류입니다:
 *  - 강수가 있고 저층이 많이 덮였으면 난층운(지속성 비)
 *  - 강수가 강하고 상층까지 발달했으면 적란운(대류성 소나기)
 *  - 저층이 많고 습도가 매우 높으면 층운(안개층이 들린 것)
 *  - 저층이 많고 건조하면 층적운(대류가 억제되어 퍼진 것)
 *  - 저층이 적당하면 적운(맑은 날 뭉게구름)
 */

export interface BuildCloudsParams {
  atlas: CloudAtlas;
  currentTime: Date;
  sunAltDeg: number;
  sunAzDeg: number;
  atmosphere: AtmosphereParams;
  /** 관측 팬. 없으면 빈 배열을 넘기면 됩니다(맑은 하늘로 처리). */
  weather: CloudData[];
  maxTotal?: number;
}

export interface BuildCloudsResult {
  instances: CloudInstanceData[];
  /** 덱 렌더링에 그대로 넘길 층 샘플 */
  samples: LayerSample[];
  /** DNI에서 역산한 기둥 광학두께 (없거나 태양이 낮으면 null) */
  dniTau: DniTauResult | null;
  /** 태양 방향 수직 기둥 광학 — 태양 원반 차폐와 덱 조명이 함께 씁니다. */
  optics: ColumnOptics;
  /** 22° 무리 세기 (0 = 안 보임) */
  halo: number;
}

/**
 * 덱 바닥에서 내려오는 확산광의 세기 배율.
 *
 * 두꺼운 층 아래의 조도는 입사 직달광의 대략 10~20%입니다. 여기서는 그
 * 중간값을 쓰되, 확산광은 반구 전체에서 오므로 방향성 직달광보다 구름을
 * 고르게 비춥니다.
 */
const DIFFUSE_ILLUM_SCALE = 0.55;

/**
 * 빌보드 하나의 각크기 (도).
 *
 * 격자 한 칸이 담당하는 입체각은 2π/192 = 0.0327 sr이고, 이는 지름 약 11.7°의
 * 원반에 해당합니다. 빌보드를 그보다 조금 크게 잡아야 8/8에서 빈틈이 닫히고,
 * 너무 크게 잡으면(이전 26~36°) 겹침이 과해져 3/8도 뿌연 죽처럼 보입니다.
 */
const BILLBOARD_ANGULAR_DEG: Record<LayerKey, number> = {
  low: 14,
  mid: 17,
  high: 21,
};


/**
 * 사전 계산된 하늘 기둥으로 구름 인스턴스를 만듭니다.
 *
 * `buildCloudInstances`에서 **비싼 앞부분(팬 샘플링 + 576방향 fBm + 기둥 광학)을
 * 뺀** 나머지입니다. 타임라인 경로는 그 앞부분을 미리 계산해 두고 여기만
 * 매 갱신마다 돌립니다.
 */
export function buildCloudsFromColumns(params: {
  atlas: CloudAtlas;
  sunAltDeg: number;
  sunAzDeg: number;
  atmosphere: AtmosphereParams;
  samples: LayerSample[];
  optics: ColumnOptics;
  halo: number;
  obs: CloudData | undefined;
  maxTotal?: number;
}): BuildCloudsResult {
  const { atlas, sunAltDeg, sunAzDeg, atmosphere, samples, optics, halo, obs, maxTotal = 320 } = params;
  const dniTau = cloudTauFromDNI(obs?.directNormalIrradiance, sunAltDeg);
  return placeClouds(atlas, sunAltDeg, sunAzDeg, atmosphere, samples, optics, halo, obs, dniTau, maxTotal);
}

export function buildCloudInstances(params: BuildCloudsParams): BuildCloudsResult {
  const {
    atlas,
    currentTime,
    sunAltDeg,
    sunAzDeg,
    atmosphere,
    weather,
    maxTotal = 320,
  } = params;

  const fan = new WeatherFan(weather, sunAzDeg);
  const obs = fan.observerData();

  // 바람 — 관측값이 없으면 온건한 서풍계열로 둡니다.
  const windSpeedKmh = 22;
  const windBearingDeg = 260;
  const driftMinutes = (currentTime.getTime() / 60000) % 1440;

  const samples = buildSkyColumns({
    fan,
    driftMinutes,
    windSpeedKmh,
    windBearingDeg,
  });

  const dniTau = cloudTauFromDNI(obs?.directNormalIrradiance, sunAltDeg);

  // 태양 방향 수직 기둥. 각 층에 실제로 닿는 직달광 배율을 줍니다.
  const optics = solveColumnOptics(samples, sunAzDeg, sunAltDeg, layer =>
    representativeTauForObserver(layer, obs)
  );

  // 22° 무리 — 얇은 권층운에서만 보입니다.
  const halo = haloStrength(
    (obs?.high ?? 0) / 100,
    (obs?.low ?? 0) / 100,
    (obs?.mid ?? 0) / 100,
    sunAltDeg
  );

  return placeClouds(atlas, sunAltDeg, sunAzDeg, atmosphere, samples, optics, halo, obs, dniTau, maxTotal);
}

/** 빌보드 배치·조명 — 두 경로가 공유하는 부분입니다. */
function placeClouds(
  atlas: CloudAtlas,
  sunAltDeg: number,
  sunAzDeg: number,
  atmosphere: AtmosphereParams,
  samples: LayerSample[],
  optics: ColumnOptics,
  halo: number,
  obs: CloudData | undefined,
  dniTau: DniTauResult | null,
  maxTotal: number
): BuildCloudsResult {

  const beamCache = new Map<string, RGB>();
  const beamFor = (altKm: number, layer: LayerKey): RGB => {
    const key = `${altKm}|${layer}`;
    let v = beamCache.get(key);
    if (!v) {
      const clear = beamAtAltitude(sunAltDeg, altKm, atmosphere);
      // **위층을 통과해서 오는 직달광.**
      // 이게 없으면 상층이 완전히 덮여도 저층운이 햇빛을 그대로 받아,
      // 아무리 두꺼운 구름을 쌓아도 흐린 날이 되지 않습니다.
      const f = optics.beamFactor[layer];
      v = { r: clear.r * f, g: clear.g * f, b: clear.b * f };
      beamCache.set(key, v);
    }
    return v;
  };

  const minNightAmbient = { r: 0.015, g: 0.022, b: 0.040 };
  const out: CloudInstanceData[] = [];

  // ── 어떤 방향에 빌보드를 놓을지 ──────────────────────────────────────────
  //
  // 예전에는 전체를 운량 내림차순으로 정렬해 앞에서부터 잘랐습니다.
  // 그러면 **저층이 예산을 독점합니다.** 측정 (예산 160개):
  //
  //   상황     저층  중층  상층   잘려나간 방향
  //   6/8       147     6     7        371
  //   8/8       160     0     0        416
  //
  // 8/8에서 중·상층이 통째로 0입니다. 새털구름(권운)은 저층이 거의 없을 때만
  // 살아남았고, 그게 "구름 형태가 다양하지 않다"의 정체였습니다.
  //
  // 그래서 **층마다 몫을 따로 줍니다.** 남는 몫은 다른 층이 가져갑니다.
  const LAYER_SHARE: Record<LayerKey, number> = { low: 0.45, mid: 0.22, high: 0.33 };

  // 덱이 완전히 덮은 방향에는 빌보드가 필요 없습니다.
  // OVC에서 덱은 불투명하므로 그 위에 얹는 빌보드는 순수한 오버드로입니다 —
  // 하필 가장 무거운 상황(하늘이 구름으로 꽉 찬 때)에서 가장 크게 낭비됩니다.
  const deckSeals = (cover: number) => cover >= getTuning().deckSealCover;

  // **아래층이 막으면 위층도 안 보입니다.**
  // 셸 반경이 저 400 < 중 430 < 상 460 이고 카메라는 원점이므로, 저층 덱이
  // 불투명해진 방향에서는 중·상층이 그 뒤에 완전히 가립니다. 이걸 빼지 않으면
  // 8/8에서 저층 빌보드를 없앤 만큼 중·상층이 그 자리를 채워, 보이지도 않는
  // 빌보드 160장을 그리게 됩니다.
  const dirKey = (s: LayerSample) => `${s.azimuthDeg.toFixed(1)}|${s.elevationDeg.toFixed(1)}`;
  const sealedBelow: Record<LayerKey, Set<string>> = { low: new Set(), mid: new Set(), high: new Set() };
  for (const s of samples) {
    if (!deckSeals(s.cover)) continue;
    const k = dirKey(s);
    if (s.layer === 'low') {
      sealedBelow.low.add(k);
      sealedBelow.mid.add(k);
      sealedBelow.high.add(k);
    } else if (s.layer === 'mid') {
      sealedBelow.mid.add(k);
      sealedBelow.high.add(k);
    } else {
      sealedBelow.high.add(k);
    }
  }

  const byLayer: Record<LayerKey, LayerSample[]> = { low: [], mid: [], high: [] };
  for (const s of samples) {
    if (s.cover <= 0.06) continue;
    if (sealedBelow[s.layer].has(dirKey(s))) continue;
    byLayer[s.layer].push(s);
  }
  for (const k of ['low', 'mid', 'high'] as LayerKey[]) {
    byLayer[k].sort((a, b) => b.cover - a.cover);
  }

  const ordered: LayerSample[] = [];
  const leftovers: LayerSample[] = [];
  for (const k of ['low', 'mid', 'high'] as LayerKey[]) {
    const quota = Math.floor(maxTotal * LAYER_SHARE[k]);
    ordered.push(...byLayer[k].slice(0, quota));
    leftovers.push(...byLayer[k].slice(quota));
  }
  // 쓰지 않은 몫은 운량이 높은 순서로 다른 층이 채웁니다.
  leftovers.sort((a, b) => b.cover - a.cover);
  ordered.push(...leftovers);

  for (const s of ordered) {
    if (out.length >= maxTotal) break;

    const key = `${s.layer}|${s.azimuthDeg.toFixed(1)}|${s.elevationDeg.toFixed(1)}`;
    const seed1 = hash01(key);
    const seed2 = hash01(`${key}#b`);

    // 운량이 낮으면 그 방향에 구름이 없을 수도 있어야 합니다.
    // (전부 그리면 운량 10%도 하늘을 한 바퀴 두릅니다.)
    if (seed2 > 0.12 + s.cover * 0.95) continue;

    const presetName = resolvePresetFromWeather(
      s.layer,
      s.cover,
      {
        precipitation: obs?.precipitation,
        humidity: obs?.humidity,
        lowPct: obs?.low ?? 0,
        highPct: obs?.high ?? 0,
      },
      seed1
    );

    const layerType = presetLayerType(presetName);
    const altKm = PRESET_ALTITUDE_KM[presetName];
    const shellRadius = layerShellRadius(layerType);
    const opticsConfig = PRESET_OPTICS[presetName] || PRESET_OPTICS.Cumulus;

    const variantCount = countVariants(atlas, presetName, false);
    if (variantCount === 0) continue;
    const variant = Math.floor(seed1 * variantCount) % variantCount;
    const atlasKey = cloudAtlasKey(presetName, variant, false);
    const rect = atlas.rects.get(atlasKey);
    if (!rect) continue;

    // 격자 중앙에서 살짝 흔들어 정렬 티가 나지 않게 합니다.
    const azJitter = (seed1 - 0.5) * (360 / 24) * 0.8;
    const elevJitter = (seed2 - 0.5) * 5.0;
    const azimuthDeg = (s.azimuthDeg + azJitter + 360) % 360;
    const elevationDeg = Math.max(1.5, Math.min(89, s.elevationDeg + elevJitter));

    const beam = beamFor(altKm, s.layer);

    const azDiff = ((sunAzDeg - azimuthDeg + 540) % 360) - 180;
    const gammaDeg =
      Math.acos(
        clamp01Signed(
          Math.sin(elevationDeg * D2R) * Math.sin(sunAltDeg * D2R) +
            Math.cos(elevationDeg * D2R) * Math.cos(sunAltDeg * D2R) * Math.cos(azDiff * D2R)
        )
      ) * R2D;

    const rawAmbient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);

    // 위층이 두꺼우면 아래는 파란 천공광이 아니라 **덱 바닥에서 내려오는
    // 회백색 확산광**으로 조명됩니다. 이 항이 없으면 평행광을 죽인 순간
    // 8/8 하늘이 새까매집니다 — 실제 흐린 날은 균일하게 밝은 회색입니다.
    const dFactor = optics.diffuseFactor[s.layer];
    // 하늘빛은 스카이돔과 **같은 식**으로 감광·탈색합니다.
    const dimmedSky = applyCloudDimming(rawAmbient, dFactor);
    // 위층 바닥에서 내려오는 회백색 확산광. 평행광을 죽인 뒤에도
    // 이 빛이 남아야 흐린 하늘이 새까매지지 않고 균일한 회색이 됩니다.
    const clearBeam = beamAtAltitude(sunAltDeg, altKm, atmosphere);
    const skyBlocked = 1 - dFactor;
    const diffuseGrey =
      (clearBeam.r + clearBeam.g + clearBeam.b) / 3 * dFactor * DIFFUSE_ILLUM_SCALE * skyBlocked;

    const ambient = {
      r: Math.max(dimmedSky.r + diffuseGrey, minNightAmbient.r),
      g: Math.max(dimmedSky.g + diffuseGrey, minNightAmbient.g),
      b: Math.max(dimmedSky.b + diffuseGrey, minNightAmbient.b),
    };

    // 도감 τ를 기본으로 쓰되, DNI 관측이 있으면 그쪽으로 끌어옵니다.
    // 관측이 "얼마나 가렸나"를 직접 말해주므로 표보다 신뢰합니다.
    const preset = getCloudPreset(layerType, s.cover * 100, s.cover, 0, 0, obs?.humidity ?? 50, obs?.visibility ?? 10000);
    let tau = Math.max(opticsConfig.tau, cloudOpticalDepthFromDb(preset.scattering, s.cover));

    // DNI 관측 반영.
    //
    // DNI는 τ ≲ 5까지만 분해합니다(직달광이 Beer-Lambert로 죽으므로).
    // 그래서 **포화하지 않았을 때만** 신뢰합니다. 포화했다면 "두껍다"는 것만
    // 확인해줄 뿐이라 도감 τ를 그대로 둡니다.
    //
    // 이 구분이 없으면 난층운(τ=110)이 DNI 역산값 2.8에 끌려 40까지 얇아집니다.
    // 관측을 반영하려다 오히려 흐린 날을 밝게 만드는 셈입니다.
    if (dniTau && !dniTau.saturated) {
      // 예보는 흐림인데 해가 실제로 비치는 상황 — 관측이 옳습니다.
      const share = s.layer === 'low' ? 0.6 : s.layer === 'mid' ? 0.3 : 0.1;
      const fromDni = (dniTau.tauVert * share) / Math.max(0.15, s.cover);
      // 관측은 상한으로만 씁니다(도감보다 두껍게 만들지는 않음).
      tau = Math.min(tau, Math.max(0.5, fromDni));
    }
    tau = Math.max(0.5, Math.min(400, tau));

    // 알파는 운량이 아니라 **광학두께**가 정합니다.
    // 운량은 하늘을 얼마나 채우는가(= 빌보드 개수)로 이미 반영되었습니다.
    const opacity = clamp01(opticsConfig.opacity * (0.55 + 0.45 * clamp01(s.cover * 1.4)));

    const angularDeg = BILLBOARD_ANGULAR_DEG[s.layer] * (0.75 + seed1 * 0.5);
    const sizeY = shellRadius * Math.tan((angularDeg * Math.PI) / 360) * 2;
    const clampedAspect = Math.max(0.8, Math.min(2.5, rect.aspect));

    out.push({
      azimuthDeg,
      elevationDeg,
      lightingElevDeg: elevationDeg,
      distanceKm: s.distanceKm,
      atlasKey,
      sizeY,
      aspect: clampedAspect,
      opacity,
      beam,
      ambient,
      tau,
      altitudeKm: altKm,
      shadowContrast: opticsConfig.shadowContrast,
      rimSharpness: opticsConfig.rimSharpness,
      horizontal: false,
      shellRadius,
      cover: s.cover,
      layer: s.layer,
    });
  }

  return { instances: out, samples, dniTau, optics, halo };
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function clamp01Signed(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function countVariants(atlas: CloudAtlas, name: CloudPresetName, horizontal: boolean): number {
  let n = 0;
  while (atlas.rects.has(cloudAtlasKey(name, n, horizontal))) n++;
  return n;
}

export { LAYER_ALTITUDE_KM };

export { representativeTauForObserver, resolvePresetFromWeather, PRESET_OPTICS };
