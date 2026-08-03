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
import { getCloudPreset, type CloudPresetName } from '../../utils/cloudPresets';
import { clamp01, type RGB } from '../../utils/sunsetPhysics';
import {
  skyRadiance,
  beamAtAltitude,
  cloudOpticalDepthFromDb,
  cloudTauFromDNI,
  type DniTauResult,
  type AtmosphereParams,
} from '../../utils/atmosphere';
import {
  buildSkyColumns,
  WeatherFan,
  LAYER_ALTITUDE_KM,
  type LayerSample,
  type LayerKey,
} from '../../utils/skyColumn';
import type { CloudData } from '../../utils/weather';
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
interface CloudOpticsConfig {
  tau: number;
  opacity: number;
  shadowContrast: number;
  rimSharpness: number;
}

/**
 * τ 값은 실제 관측 범위에 맞춰 올렸습니다.
 * 이전 값(난층운 50 → T=0.21, 적란운 70 → T=0.16)은 "비 오는데 꽤 밝은" 수준이라
 * 아무리 두꺼운 구름을 쌓아도 흐린 날이 나오지 않았습니다.
 * (T = 2/(τ(1−g)+2), g = 0.85)
 */
const PRESET_OPTICS: Record<CloudPresetName, CloudOpticsConfig> = {
  Cirrus:        { tau: 3.0,   opacity: 0.38, shadowContrast: 0.12, rimSharpness: 0.25 },
  Cirrocumulus:  { tau: 4.2,   opacity: 0.42, shadowContrast: 0.15, rimSharpness: 0.30 },
  Cirrostratus:  { tau: 5.0,   opacity: 0.45, shadowContrast: 0.10, rimSharpness: 0.20 },
  Altocumulus:   { tau: 16.0,  opacity: 0.72, shadowContrast: 0.48, rimSharpness: 0.60 },
  Altostratus:   { tau: 30.0,  opacity: 0.82, shadowContrast: 0.38, rimSharpness: 0.35 },
  Stratocumulus: { tau: 35.0,  opacity: 0.90, shadowContrast: 0.62, rimSharpness: 0.70 },
  Stratus:       { tau: 22.0,  opacity: 0.80, shadowContrast: 0.28, rimSharpness: 0.25 },
  Cumulus:       { tau: 32.0,  opacity: 0.92, shadowContrast: 0.78, rimSharpness: 0.88 },
  Cumulonimbus:  { tau: 220.0, opacity: 0.99, shadowContrast: 0.94, rimSharpness: 0.95 },
  Nimbostratus:  { tau: 110.0, opacity: 0.98, shadowContrast: 0.88, rimSharpness: 0.45 },
};

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
function resolvePresetFromWeather(
  layer: LayerKey,
  cover: number,
  wx: { precipitation?: number; humidity?: number; lowPct: number; highPct: number },
  seed: number
): CloudPresetName {
  const precip = wx.precipitation ?? 0;
  const rh = wx.humidity ?? 60;

  if (layer === 'high') {
    if (cover > 0.65) return 'Cirrostratus';
    if (cover > 0.3) return seed < 0.5 ? 'Cirrocumulus' : 'Cirrus';
    return 'Cirrus';
  }

  if (layer === 'mid') {
    if (precip > 0.2 || cover > 0.7) return 'Altostratus';
    return 'Altocumulus';
  }

  // low
  if (precip > 2.0 && wx.highPct > 45) return 'Cumulonimbus';
  if (precip > 0.3 && cover > 0.6) return 'Nimbostratus';
  if (cover > 0.6) return rh > 90 ? 'Stratus' : 'Stratocumulus';
  if (cover > 0.35) return seed < 0.65 ? 'Cumulus' : 'Stratocumulus';
  return 'Cumulus';
}

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
}

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

  const beamCache = new Map<number, RGB>();
  const beamFor = (altKm: number): RGB => {
    let v = beamCache.get(altKm);
    if (!v) {
      v = beamAtAltitude(sunAltDeg, altKm, atmosphere);
      beamCache.set(altKm, v);
    }
    return v;
  };

  const minNightAmbient = { r: 0.015, g: 0.022, b: 0.040 };
  const out: CloudInstanceData[] = [];

  // 운량이 높은 방향부터 채워 용량이 모자랄 때 빈 하늘이 아니라
  // 옅은 구름이 먼저 잘리게 합니다.
  const ordered = samples
    .filter(s => s.cover > 0.06)
    .sort((a, b) => b.cover - a.cover);

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

    const beam = beamFor(altKm);

    const azDiff = ((sunAzDeg - azimuthDeg + 540) % 360) - 180;
    const gammaDeg =
      Math.acos(
        clamp01Signed(
          Math.sin(elevationDeg * D2R) * Math.sin(sunAltDeg * D2R) +
            Math.cos(elevationDeg * D2R) * Math.cos(sunAltDeg * D2R) * Math.cos(azDiff * D2R)
        )
      ) * R2D;

    const rawAmbient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);
    const ambient = {
      r: Math.max(rawAmbient.r, minNightAmbient.r),
      g: Math.max(rawAmbient.g, minNightAmbient.g),
      b: Math.max(rawAmbient.b, minNightAmbient.b),
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

  return { instances: out, samples, dniTau };
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
