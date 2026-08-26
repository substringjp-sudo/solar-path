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
  cloudBaseKm,
  convectiveVigor,
  convectiveDepthKm,
  CUMULUS_TOWER_FIRST,
  TOWER_VIGOR,
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
  angularSeparationDeg,
  type DniTauResult,
  type AtmosphereParams,
} from '../../utils/atmosphere';
import {
  buildSkyColumns,
  solveColumnOptics,
  solveDirectionalShade,
  elevationFromDistanceDeg,
  haloStrength,
  WeatherFan,
  LAYER_ALTITUDE_KM,
  PLACEHOLDER_WIND_SPEED_KMH,
  PLACEHOLDER_WIND_BEARING_DEG,
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
  /** 밑면 고도 (km) — 응결고도. 같은 하늘이면 방향이 달라도 같은 값입니다. */
  baseKm: number;
  /** 운정 고도 (km) */
  topKm: number;
  horizontal: boolean;
  shellRadius: number;
  /** 이 방향 층의 운량 (0~1) — 덱과의 블렌드에 사용 */
  cover: number;
  layer: LayerKey;
}

/**
 * 프리셋별 대표 물리 고도 (km).
 *
 * ⚠ 적운·적란운은 이제 이 표를 쓰지 않습니다 — 밑면은 습도에서 나온
 * 응결고도(`cloudBaseKm`), 꼭대기는 대류 강도에서 나옵니다 (5단계).
 * 나머지 여덟 종은 덱이 그리므로 이 표는 조명 고도 참조로만 남습니다.
 */
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
  /**
   * 방향별 직달광 배율 — `samples`와 같은 인덱스 (다양성 4단계).
   *
   * 예전에는 `optics.beamFactor[layer]` 하나를 하늘 전체에 곱했습니다.
   * 관측점 수직 기둥에서 구한 값이라, 서쪽에 두꺼운 상층 띠가 있으면
   * **동쪽 저층까지 같이 어두워졌습니다.**
   */
  beamShade: Float32Array;
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
 * 빌보드 연직 각크기의 하한·상한 (도) — docs/CLOUD_VARIETY_PLAN.md 5단계.
 *
 * 예전에는 각크기가 **상수**였습니다 (저 14° × 0.75~1.25). 그래서 40km 밖
 * 적운과 5km 앞 적운이 화면에서 같은 크기였습니다 — 원근이 없으니 크기가
 * 거리를 말해 주지 못했고, "다양한 크기"가 있을 수 없었습니다.
 *
 * 이제는 밑면·꼭대기 고도와 거리에서 계산합니다. 남는 것은 두 경계뿐입니다:
 *  - 하한: 이보다 작으면 화면에서 몇 픽셀이라 그릴 값이 없습니다.
 *    (그 거리의 구름은 덱이 이미 담당합니다.)
 *  - 상한: 머리 위 가까운 탑은 기하학적으로 60°를 넘길 수 있는데, 그러면
 *    빌보드 한 장이 화면을 덮어 스프라이트라는 게 드러납니다.
 */
const BILLBOARD_MIN_DEG = 1.2;
const BILLBOARD_MAX_DEG = 40;

/**
 * 대류운 빌보드를 그리기 위한 **최소 거리** — 연직 두께의 몇 배인가.
 *
 * 하늘 기둥 모형은 방향에서 거리를 역산합니다(`elevationToDistanceKm`).
 * 그 역산은 구름층이 **연속한 껍질**이라는 가정 위에 있습니다. 층상운에는
 * 맞지만 대류운에는 안 맞습니다 — 적운은 낱개 덩어리라, 고도각 40°를
 * 올려다볼 때 "밑면 0.3km인 구름이 0.36km 앞에 있다"는 답이 나옵니다.
 * 그 자리에 4km짜리 탑을 그리면 각크기가 57°가 되어 빌보드 한 장이 화면을
 * 덮습니다 (실측: 중앙값 41.9°, 상한에 붙음).
 *
 * 물리적으로도 그건 "구름 안에 들어가 있다"는 뜻입니다. 대류운의 수평 크기는
 * 연직 두께와 비슷하므로, **자기 크기의 1.4배보다 가까우면** 하나의 물체로
 * 보이지 않습니다. 그런 방향은 덱이 담당합니다.
 *
 * 이 조건은 두께에 비례하므로 저절로 옳은 일을 합니다: 납작한 호천적운
 * (0.7km)은 1km 앞에서도 물체로 보이니 중간 고도까지 나오고, 4km짜리 탑은
 * 5km 밖에서만 나옵니다 — 실제로 솟은 적운이 늘 **지평선 쪽에** 보이는
 * 이유가 그것입니다 (사진 ②).
 */
const CONVECTIVE_MIN_DIST_FACTOR = 1.4;


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

  // 바람 — **실측이 아니라 대용 상수입니다** (skyColumn.ts 주석 참고).
  const windSpeedKmh = PLACEHOLDER_WIND_SPEED_KMH;
  const windBearingDeg = PLACEHOLDER_WIND_BEARING_DEG;
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

  // ── 4단계: 방향별 그늘 ────────────────────────────────────────────────
  //
  // **위층을 통과해서 오는 직달광.** 이게 없으면 상층이 완전히 덮여도
  // 저층운이 햇빛을 그대로 받아, 아무리 두꺼운 구름을 쌓아도 흐린 날이
  // 되지 않습니다. 이제 그 배율이 방향마다 다릅니다 — 옆 구름은 그늘인데
  // 이 구름만 빛을 받는 대비가 여기서 나옵니다.
  const beamShade = solveDirectionalShade(samples, sunAzDeg, sunAltDeg, layer =>
    representativeTauForObserver(layer, obs)
  );
  const shadeIndex = new Map<LayerSample, number>();
  for (let i = 0; i < samples.length; i++) shadeIndex.set(samples[i], i);

  const clearBeamCache = new Map<number, RGB>();
  const clearBeamAt = (altKm: number): RGB => {
    let v = clearBeamCache.get(altKm);
    if (!v) {
      v = beamAtAltitude(sunAltDeg, altKm, atmosphere);
      clearBeamCache.set(altKm, v);
    }
    return v;
  };
  const beamFor = (altKm: number, s: LayerSample): RGB => {
    const clear = clearBeamAt(altKm);
    const idx = shadeIndex.get(s);
    const f = idx === undefined ? optics.beamFactor[s.layer] : beamShade[idx];
    return { r: clear.r * f, g: clear.g * f, b: clear.b * f };
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

    // 3단계: 강수·습도·상층 운량은 **그 방향 지점**의 값입니다
    // (docs/CLOUD_VARIETY_PLAN.md). 덱(SkyScene3D의 genusOptics)과 같은
    // 입력을 써야 BKN 경계에서 두 표현의 운형이 갈라지지 않습니다.
    const presetName = resolvePresetFromWeather(
      s.layer,
      s.cover,
      {
        precipitation: s.precipMmH,
        humidity: s.humidityPct,
        lowPct: s.lowPct,
        highPct: s.highPct,
      },
      seed1
    );

    // ── 5단계: 빌보드는 적운·적란운으로 후퇴 (docs/CLOUD_TEXTURE_PLAN.md 3-G) ──
    //
    // 나머지 여덟 운형(Ci·Cc·Cs·Ac·As·Sc·St·Ns)은 이제 덱이 담당합니다.
    // 거리로 나누는 게 아니라 **속으로** 나눕니다 — 적운은 원래 가깝고 낮고
    // 볼록해 시차가 의미 있는 3D 물체지만, 층상운은 원래 멀고 평평해서
    // 시차가 0인 스프라이트로 그려 봐야 얻는 게 없습니다(카메라가 원점에서
    // 회전만 하므로).
    //
    // 1-B의 계산이 여기서 무너집니다: 상층 52장 × 21°만으로 반구가
    // 기하학적으로 포화됐던 게 파란 하늘이 사라진 원인 중 하나였는데,
    // 상층·중층 빌보드가 이제 전혀 안 나오므로(resolvePresetFromWeather의
    // mid/high 분기는 Cumulus/Cumulonimbus를 절대 반환하지 않습니다)
    // 그 포화가 사라집니다.
    if (presetName !== 'Cumulus' && presetName !== 'Cumulonimbus') continue;

    const layerType = presetLayerType(presetName);
    const shellRadius = layerShellRadius(layerType);
    const opticsConfig = PRESET_OPTICS[presetName] || PRESET_OPTICS.Cumulus;

    // ── 5단계: 수직 발달 ────────────────────────────────────────────────
    //
    // 밑면은 **응결고도**입니다 — 습도 하나가 정하므로 하늘의 모든 적운이
    // 같은 높이에 평평한 밑면을 갖습니다. 사진에서 뭉게구름 아래가 자로 그은
    // 듯 나란한 것이 그 때문입니다. 예전에는 상수 1.6km 였습니다.
    const vigor = convectiveVigor(s.precipMmH, s.humidityPct, s.cover);
    const baseKm = cloudBaseKm(s.humidityPct);
    const depthKm = convectiveDepthKm(presetName, vigor);
    const topKm = baseKm + depthKm;
    // 조명 고도는 덩어리의 가운데를 씁니다.
    const altKm = baseKm + depthKm * 0.5;

    // ── 이 방향의 구름이 놓인 **거리**, 그리고 거기서 본 밑면·꼭대기 각 ──
    //
    // 거리는 표본의 `distanceKm`을 그대로 씁니다. 이 값은 층 대표 고도
    // (1.5km) 껍질과의 교점이라, "이 방향에 구름이 있다면 대략 이만큼
    // 떨어져 있다"는 뜻입니다 — 나머지 파이프라인(운량·그늘·대기 투시)이
    // 전부 그 거리를 쓰므로 여기서도 같은 값을 써야 어긋나지 않습니다.
    //
    // ⚠ 밑면 고도로 거리를 **다시 역산하면 안 됩니다.** 그러면 밑면이 낮을수록
    // (습한 날) 같은 고도각이 훨씬 가까운 거리로 풀려, 탑이 나올 수 있는
    // 고도각 띠가 3.6° 한 줄로 좁아집니다 (실측: 빌보드 2장). 밑면 고도는
    // **각도**를 정하는 데만 씁니다.
    const dKm = s.distanceKm;
    // 자기 크기보다 가까우면 물체로 보이지 않습니다 (위 상수 주석).
    if (dKm < CONVECTIVE_MIN_DIST_FACTOR * depthKm) continue;
    const baseElevDeg = elevationFromDistanceDeg(dKm, baseKm);
    const topElevDeg = elevationFromDistanceDeg(dKm, topKm);
    const angularDeg = topElevDeg - baseElevDeg;
    // 너무 작으면 화면에서 몇 픽셀입니다 — 그 거리의 구름은 덱이 담당합니다.
    if (angularDeg < BILLBOARD_MIN_DEG) continue;
    const drawDeg = Math.min(BILLBOARD_MAX_DEG, angularDeg);

    const seed3 = hash01(`${key}#v3`);
    const variantCount = countVariants(atlas, presetName, false);
    if (variantCount === 0) continue;
    // 대류가 강하면 **탑형** 실루엣에서 고릅니다. 넓적한 판을 세로로 늘여
    // 봐야 눌린 꽃양배추가 될 뿐이라, 모양 자체가 다른 템플릿이 필요합니다.
    const useTower = presetName === 'Cumulus' && vigor > TOWER_VIGOR
      && variantCount > CUMULUS_TOWER_FIRST;
    const from = useTower ? CUMULUS_TOWER_FIRST : 0;
    const span = useTower ? variantCount - CUMULUS_TOWER_FIRST
      : Math.min(CUMULUS_TOWER_FIRST, variantCount);
    const variant = from + (Math.floor((seed1 * 0.4 + seed3 * 0.6) * span * 13) % span);
    const atlasKey = cloudAtlasKey(presetName, variant, false);
    const rect = atlas.rects.get(atlasKey);
    if (!rect) continue;

    // 50% 확률 무작위 좌우 반전
    const isFlipped = seed3 > 0.5;

    // 격자 중앙에서 살짝 흔들어 정렬 티가 나지 않게 합니다.
    // 세로 흔들림은 **밑면**에만 겁니다 — 밑면이 나란한 것이 적운의 서명이라
    // 크게 흔들면 그 서명이 사라집니다.
    const azJitter = (seed1 - 0.5) * (360 / 24) * 0.8;
    const baseJitter = (seed2 - 0.5) * 1.6;
    const azimuthDeg = (s.azimuthDeg + azJitter + 360) % 360;
    // 빌보드는 중심 정렬이므로, 밑면을 표본 방향에 두려면 중심을 반만큼
    // 위로 올립니다. 그래야 탑이 밑면에서 **위로** 자랍니다.
    const elevationDeg = Math.max(1.5, Math.min(89,
      baseElevDeg + baseJitter + drawDeg * 0.5));

    const beam = beamFor(altKm, s);

    const gammaDeg = angularSeparationDeg(azimuthDeg, elevationDeg, sunAzDeg, sunAltDeg);

    const rawAmbient = skyRadiance(elevationDeg, gammaDeg, sunAltDeg, atmosphere);

    // 위층이 두꺼우면 아래는 파란 천공광이 아니라 **덱 바닥에서 내려오는
    // 회백색 확산광**으로 조명됩니다. 이 항이 없으면 평행광을 죽인 순간
    // 8/8 하늘이 새까매집니다 — 실제 흐린 날은 균일하게 밝은 회색입니다.
    const dFactor = optics.diffuseFactor[s.layer];
    // 하늘빛은 스카이돔과 **같은 식**으로 감광·탈색합니다.
    const dimmedSky = applyCloudDimming(rawAmbient, dFactor);
    // 위층 바닥에서 내려오는 회백색 확산광. 평행광을 죽인 뒤에도
    // 이 빛이 남아야 흐린 하늘이 새까매지지 않고 균일한 회색이 됩니다.
    const clearBeam = clearBeamAt(altKm);
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
    // 시정(visibility)은 관측점에서만 옵니다 — 원격 지점 값은 지표 시정이라
    // 그 방향 구름의 광학과 관계가 약합니다. 습도는 방향별 값을 씁니다.
    const preset = getCloudPreset(
      layerType, s.cover * 100, s.cover, 0, 0, s.humidityPct, obs?.visibility ?? 10000
    );
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

    const sizeY = shellRadius * Math.tan((drawDeg * Math.PI) / 360) * 2;
    // 종횡비는 **템플릿이 정합니다.** 목표 비율로 늘이면 넓적한 판이
    // 가로로 눌린 모양이 되므로, 모양은 템플릿에서 오고 배치는 그걸
    // 그대로 씁니다. 하한을 0.5로 연 것은 탑형이 0.54~0.65이기 때문입니다.
    const clampedAspect = Math.max(0.5, Math.min(3.0, rect.aspect));

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
      baseKm,
      topKm,
      horizontal: isFlipped,
      shellRadius,
      cover: s.cover,
      layer: s.layer,
    });
  }

  return { instances: out, samples, dniTau, optics, halo, beamShade };
}

function countVariants(atlas: CloudAtlas, name: CloudPresetName, horizontal: boolean): number {
  let n = 0;
  while (atlas.rects.has(cloudAtlasKey(name, n, horizontal))) n++;
  return n;
}

export { LAYER_ALTITUDE_KM };

export { representativeTauForObserver, resolvePresetFromWeather, PRESET_OPTICS };
