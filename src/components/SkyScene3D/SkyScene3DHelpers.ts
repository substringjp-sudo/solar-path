import * as THREE from 'three';
import SunCalc from 'suncalc';
import { type HeightSampler, type PickedTarget } from '../../utils/demPick';
import { makeDemSampler } from '../../utils/demSampler';
import { type DemPatch } from '../../utils/demTiles';
import { buildMergedBuildingGeometry, type BuildingMeshData } from '../../utils/buildingTiles';
import { picksToElements, concatBuildingMeshData, type FarTileData } from '../../utils/farBuildingsLoad';
import { FAR_OUTER_M } from '../../utils/farBuildings';
import { flattenDemPatchUnderBuildings, type BuildingCover } from '../../utils/demBuildingFlatten';
import { getPlanetEquatorialCoord, PlanetKey } from '../../utils/celestialPlanets';
import { skyRadiance, beamAtAltitude, angularSeparationDeg, moonLight, type AtmosphereParams } from '../../utils/atmosphere';
import { getApparentAltitude } from '../../utils/sunsetPhysics';
import { seaHorizonDipDeg } from './TerrainRing';
import { terrainHorizonDegAtAz, isSunVisibleAboveHorizon } from '../../utils/terrainPick';
import { planetLabelVisible, moonLabelVisible, milkyWayLabelVisible } from '../../utils/labelVisibility';
import { L3, type Language } from '../../utils/i18n';

export interface LayerState {
  labels: boolean;
  sun: boolean;
  moon: boolean;
  stars: boolean;
  milkyway: boolean;
  planets: boolean;
  clouds: boolean;
  paths: boolean;
  cityLights: boolean;
  buildings?: boolean;
}

/** 별 표현을 사용자가 조절하는 값 (레이어 ON/OFF와 달리 연속값이라 따로 둡니다) */
export interface SkySettings {
  starBrightness: number;
  starMagLimit: number;
  pixelArtRows: number;
  volumetricSky?: boolean;
  volumetricQuality?: 'low' | 'medium' | 'high';
  volumetricRes?: number;
  volumetricAutoRes?: boolean;
  volumetricFlow?: boolean;
  volumetricFlowUv?: boolean;
  volumetricPhysics?: boolean;
  volumetricPhysicsIce?: boolean;
  volumetricMacro?: 0 | 1 | 2;
  volumetricMorph?: boolean;
  volumetricBillow?: boolean;
  volumetricFill?: boolean;
  volumetricAccurateSun?: boolean;
  volumetricLowSunShadow?: boolean;
  volumetricFarSun?: boolean;
  /** 구름 알갱이 다듬기(표본 누적 + 정착 뒤 몇 초 더 그림, PR #171). 끄면 그 전과 같음. 기본 켬. */
  volumetricRefine?: boolean;
  /** 땅 알갱이(실험, 기본 0 끔): 1 켬(위치 표본) — 땅 · 건물을 구름과 같은 표본 방식으로(volumetricScene `GROUND_GRAIN_GLSL`). */
  volumetricGroundGrain?: number;
  volumetricSheetDiffuse?: boolean;
  /** 구름 이동 속도 배율(개발 패널): 1 = 예보 바람 그대로, 0.5 · 0.25 로 느리게. */
  volumetricCloudSpeed?: number;
  /** 구름 수명 배율(개발 패널): 1 = 종류별 기본, 2 · 4 로 더 오래(제자리 변화가 느려짐). */
  volumetricCloudLife?: number;
  /** 노출 방식(개발 패널): 'metered' 화면 평균 휘도 측광(기본) · 'table' 해 고도 표만(옛 방식). 샌드박스는 이 값과 무관하게 수동. */
  volumetricExposureMode?: 'metered' | 'table';
  /** 샌드박스 수동 노출 켬(SkyScreen 이 전문가 모드일 때 채움 — 저장 설정 아님). 켜면 자동 노출 없이 고정 노출 + `sandboxExposureEv`. */
  sandboxManualExposure?: boolean;
  /** 샌드박스 수동 노출 보정(EV, 0 = 해 30° 맑은 하늘 기준). 설정 창 슬라이더, 저장됨. */
  sandboxExposureEv?: number;
  diagRawTerrain?: boolean;
  volumetricClampInscatter?: boolean;
  volumetricIrradianceLogMu?: boolean;
  cameraVolumetric?: boolean;
}

export const PIXEL_ART_CHOICES: { rows: number; label: string }[] = [
  { rows: 0, label: '끔' },
  { rows: 256, label: '가늘게' },
  { rows: 160, label: '보통' },
  { rows: 96, label: '굵게' },
];

export const VOLUMETRIC_SKY_ENABLED = true;
export const REMOTE_SETTLE_FRAMES = 20;
export const FAR_MAX_BUILDINGS_SHOWN = 3000;

export type LongExposureSimMode = 'trails' | 'tracked' | 'tracked_fixed_ground';

export interface LongExposureSimOptions {
  mode: LongExposureSimMode;
  startTimeMs?: number;
  durationSec?: number;
  steps?: number;
  exposureGain?: number;
  shadowLift?: number;
  starBoost?: number;
  settleFrames?: number;
  requireReady?: boolean;
  waitMs?: number;
  format?: 'jpeg' | 'png';
  compress?: number;
  signal?: AbortSignal;
  /** 한 장씩 누적될 때마다 (현재 완료 장수 1..totalSteps, 전체 장수)를 알립니다. */
  onStepProgress?: (step: number, totalSteps: number) => void;
}

export interface LongExposureSimResult {
  uri: string | null;
  ready: boolean;
  error: string | null;
  mode: LongExposureSimMode;
  durationSec: number;
  steps: number;
  exposureGain: number;
  state: SkyRenderState | null;
}

export interface EyeState {
  eye: { latitude: number; longitude: number } | null;
  moving: boolean;
  obs: Record<string, [number, number] | null>;
  block: { zoom: number; originTileX: number; originTileY: number; blockTiles: number; tileSpanM: number } | null;
}

export interface FarBuildingsResult {
  planned: number;
  fetched: number;
  failed: number;
  bytes: number;
  truncated: boolean;
  tilesTotal: number;
  buildings: number;
}

export type VolumetricPhaseOf = 'off' | 'creating' | 'updating' | 'running' | 'failed';

export interface VolumetricSceneState {
  t: string;
  low: number; mid: number; high: number; total?: number;
  genus: string;
  tau?: number;
}

export interface SkyRenderState {
  view: { az: number; el: number; roll: number; fov: number; aspect: number };
  slab: null;
  volPhase: VolumetricPhaseOf;
  scene: VolumetricSceneState | null;
}

const tempPlanetVec = new THREE.Vector3();
const projTempVec = new THREE.Vector3();
const trackingMwVec = new THREE.Vector3();

/** 건물 자리 고도 깎기 — 바뀌었으면 true(호출부가 패치를 다시 꽂음). */
export function flattenDemForBuildings(renderer: any, patch: DemPatch, cover: BuildingCover): boolean {
  try {
    const st = flattenDemPatchUnderBuildings(renderer, patch, cover);
    if (__DEV__ && st) console.log('[DEM] 건물 자리 고도 깎기', st.touched, '칸, 평균', st.meanDropM.toFixed(1), 'm, 최대', st.maxDropM.toFixed(1), 'm 낮춤');
    return !!st && st.touched > 0;
  } catch (e) {
    if (__DEV__) console.warn('[DEM] 건물 자리 고도 깎기 실패', e);
    return false;
  }
}

export function getPlanetDirectionVector(
  key: PlanetKey,
  date: Date,
  targetVec: THREE.Vector3 = tempPlanetVec,
): THREE.Vector3 {
  const eq = getPlanetEquatorialCoord(key, date);
  const raRad = (eq.raHours / 24) * Math.PI * 2;
  const decRad = (eq.decDeg * Math.PI) / 180;
  const cd = Math.cos(decRad);
  return targetVec.set(cd * Math.cos(raRad), cd * Math.sin(raRad), Math.sin(decRad)).normalize();
}

export function sceneHeightSampler(renderer: THREE.WebGLRenderer, patch: DemPatch, farPatch: DemPatch | null): HeightSampler | null {
  const fine = makeDemSampler(renderer, patch);
  const far = farPatch ? makeDemSampler(renderer, farPatch) : null;
  if (!fine && !far) return null;
  return (e, s) => fine?.(e, s) ?? far?.(e, s) ?? null;
}

export function mergeBuildings(near: BuildingMeshData | null, farTiles: Map<string, FarTileData>, lat: number, lng: number): BuildingMeshData | null {
  if (farTiles.size === 0) return near;
  const els = picksToElements(farTiles.values(), FAR_MAX_BUILDINGS_SHOWN);
  if (els.length === 0) return near;
  return concatBuildingMeshData(near, buildMergedBuildingGeometry(els, lat, lng, FAR_OUTER_M));
}

export function dayOfYearOf(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

/** 코사인 가중 24방위 하늘 평균 조도 + 지평선(2°) 6방위 평균 공기원근 색 */
export function computeSkyAtmosphereMeans(sunAltDeg: number, sunAzDeg: number, atmosphere: AtmosphereParams) {
  let sr = 0, sg = 0, sb = 0, sw = 0;
  for (const elev of [10, 30, 50, 75]) {
    const w = Math.sin((elev * Math.PI) / 180);
    for (let a = 0; a < 6; a++) {
      const az = (a * 360) / 6;
      const gamma = angularSeparationDeg(az, elev, sunAzDeg, sunAltDeg);
      const L = skyRadiance(elev, gamma, sunAltDeg, atmosphere);
      sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
    }
  }
  let hr = 0, hg = 0, hb = 0;
  for (let a = 0; a < 6; a++) {
    const az = (a * 360) / 6;
    const gamma = angularSeparationDeg(az, 2, sunAzDeg, sunAltDeg);
    const L = skyRadiance(2, gamma, sunAltDeg, atmosphere);
    hr += L.r; hg += L.g; hb += L.b;
  }
  return {
    skyMean: { r: sr / sw, g: sg / sw, b: sb / sw },
    horizonMean: { r: hr / 6, g: hg / 6, b: hb / 6 },
  };
}

export interface MoonGroundCacheEntry {
  alt: number;
  az: number;
  atmos: unknown;
  sky: { r: number; g: number; b: number };
  beam: { r: number; g: number; b: number };
}

export function computeMoonGroundLighting(args: {
  sunAltDeg: number;
  mAltDeg: number;
  mAzDeg: number;
  seaDipDeg: number;
  moonFraction: number;
  overcast: number;
  atmosphere: AtmosphereParams;
  cache: MoonGroundCacheEntry | null;
}) {
  const { sunAltDeg, mAltDeg, mAzDeg, seaDipDeg, moonFraction, overcast, atmosphere, cache } = args;
  const mGain = moonLight(sunAltDeg, mAltDeg + seaDipDeg, moonFraction, atmosphere).gain;
  let moonIrr: { r: number; g: number; b: number } | null = null;
  let moonBeamRadiance = { r: 0, g: 0, b: 0 };
  let nextCache = cache;

  if (mGain > 0 && mAltDeg > -seaDipDeg - 0.3) {
    if (!nextCache || Math.abs(nextCache.alt - mAltDeg) > 0.2 || Math.abs(nextCache.az - mAzDeg) > 0.2 || nextCache.atmos !== atmosphere) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (const elev of [10, 30, 50, 75]) {
        const w = Math.sin((elev * Math.PI) / 180);
        for (let a = 0; a < 6; a++) {
          const az = (a * 360) / 6;
          const L = skyRadiance(elev, angularSeparationDeg(az, elev, mAzDeg, mAltDeg), mAltDeg + seaDipDeg, atmosphere);
          sr += L.r * w; sg += L.g * w; sb += L.b * w; sw += w;
        }
      }
      const beamM = beamAtAltitude(mAltDeg + seaDipDeg, 0, atmosphere);
      const direct = Math.max(0, Math.sin(((mAltDeg + seaDipDeg) * Math.PI) / 180)) / Math.PI;
      nextCache = {
        alt: mAltDeg, az: mAzDeg, atmos: atmosphere,
        sky: { r: sr / sw, g: sg / sw, b: sb / sw },
        beam: { r: beamM.r * direct, g: beamM.g * direct, b: beamM.b * direct },
      };
    }
    const t = 1 - overcast;
    moonIrr = {
      r: (nextCache.sky.r + nextCache.beam.r * t) * mGain,
      g: (nextCache.sky.g + nextCache.beam.g * t) * mGain,
      b: (nextCache.sky.b + nextCache.beam.b * t) * mGain,
    };
    const beamM = beamAtAltitude(mAltDeg + seaDipDeg, 0, atmosphere);
    moonBeamRadiance = { r: beamM.r * mGain * t, g: beamM.g * mGain * t, b: beamM.b * mGain * t };
  }

  return { moonIrr, moonBeamRadiance, nextCache };
}

/** 3D 천체 트래킹 목표 방위·고도 스무딩 계산 */
export function computeTrackingStep(args: {
  target: string;
  sunPos: THREE.Vector3 | null;
  moonPos: THREE.Vector3 | null;
  equToHorizon: THREE.Matrix3;
  frameDate: Date;
  terrain: any;
  sunDiscRadiusDeg: number;
  currentAz: number;
  currentElev: number;
}): { clearTarget?: boolean; nextAz?: number; nextElev?: number; moving: boolean } {
  const { target, sunPos, moonPos, equToHorizon, frameDate, terrain, sunDiscRadiusDeg, currentAz, currentElev } = args;
  let tPos: THREE.Vector3 | null = null;
  if (target === 'sun' && sunPos) {
    tPos = sunPos;
  } else if (target === 'moon' && moonPos) {
    tPos = moonPos;
  } else if (target === 'milkyway') {
    tPos = trackingMwVec.set(0.5, -0.4, -0.7).normalize().multiplyScalar(400).applyMatrix3(equToHorizon);
  } else if (target.startsWith('planet_')) {
    const idx = parseInt(target.split('_')[1], 10);
    const keys: PlanetKey[] = ['jupiter', 'saturn', 'venus'];
    if (keys[idx]) {
      const dir = getPlanetDirectionVector(keys[idx], frameDate, tempPlanetVec);
      tPos = dir.multiplyScalar(380).applyMatrix3(equToHorizon);
    }
  }
  if (!tPos) return { moving: false };

  const targetAz = (Math.atan2(tPos.x, -tPos.z) * (180 / Math.PI) + 360) % 360;
  const targetElev = Math.atan2(tPos.y, Math.hypot(tPos.x, tPos.z)) * (180 / Math.PI);
  const horizonDeg = (target === 'sun' || target === 'moon') ? terrainHorizonDegAtAz(terrain, targetAz) : 0;

  if (target === 'moon' && targetElev < Math.max(0, horizonDeg) - 0.5) {
    return { clearTarget: true, moving: false };
  }
  const sunVisible = target !== 'sun' || isSunVisibleAboveHorizon(targetElev, sunDiscRadiusDeg, horizonDeg, targetElev > -1.5);
  if (!sunVisible) return { moving: false };

  let azDiff = targetAz - currentAz;
  while (azDiff > 180) azDiff -= 360;
  while (azDiff < -180) azDiff += 360;

  const minElev = target === 'sun' ? Math.max(0, horizonDeg) : -20;
  const elevDiff = Math.max(minElev, targetElev) - currentElev;
  const moving = Math.abs(azDiff) > 0.05 || Math.abs(elevDiff) > 0.05;
  return {
    nextAz: (currentAz + azDiff * 0.14 + 360) % 360,
    nextElev: currentElev + elevDiff * 0.14,
    moving,
  };
}

export interface CelestialLabelItem {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
}

export function projectCelestialScreenLabels(args: {
  camera: THREE.Camera;
  vw: number;
  vh: number;
  layers: LayerState;
  sunPos: THREE.Vector3 | null;
  moonPos: THREE.Vector3 | null;
  sunAltDeg: number;
  sunDiscRadiusDeg: number;
  eyeHeightM?: number;
  terrain: any;
  equToHorizon: THREE.Matrix3;
  frameDate: Date;
  lang: Language;
  pickedTarget: PickedTarget | null;
  pickedView: { azDeg: number; elDeg: number } | null;
}): CelestialLabelItem[] {
  const {
    camera, vw, vh, layers, sunPos, moonPos, sunAltDeg, sunDiscRadiusDeg,
    eyeHeightM, terrain, equToHorizon, frameDate, lang, pickedTarget, pickedView,
  } = args;
  const labs: CelestialLabelItem[] = [];

  const proj = (v3: THREE.Vector3) => {
    projTempVec.copy(v3).project(camera);
    const visible =
      projTempVec.z > -1.0 && projTempVec.z < 1.0 &&
      projTempVec.x >= -0.96 && projTempVec.x <= 0.96 &&
      projTempVec.y >= -0.92 && projTempVec.y <= 0.96;
    return {
      px: ((projTempVec.x + 1) * vw) / 2,
      py: ((-projTempVec.y + 1) * vh) / 2,
      visible,
    };
  };
  const projEye = (v3: THREE.Vector3) => proj(projTempVec.copy(v3).add(camera.position));
  const azOf = (v: THREE.Vector3) => ((Math.atan2(v.x, -v.z) * 180) / Math.PI + 360) % 360;

  if (sunPos && layers.sun) {
    const sunHoriz = terrainHorizonDegAtAz(terrain, azOf(sunPos));
    const sunAppAlt = getApparentAltitude(sunAltDeg);
    if (isSunVisibleAboveHorizon(sunAppAlt, sunDiscRadiusDeg, sunHoriz, sunAppAlt > -0.8)) {
      const p = projEye(sunPos);
      if (p.visible) labs.push({ id: 'sun', name: L3(lang, '태양', 'Sun', '太陽'), x: p.px, y: p.py, color: '#FBBF24' });
    }
  }
  if (moonPos && layers.moon) {
    const mLen = moonPos.length() || 1;
    const moonAltDeg = (Math.asin(Math.max(-1, Math.min(1, moonPos.y / mLen))) * 180) / Math.PI;
    const moonHoriz = terrainHorizonDegAtAz(terrain, azOf(moonPos));
    let sepDeg = 180;
    if (sunPos) {
      const sLen = sunPos.length() || 1;
      const cos = (moonPos.x * sunPos.x + moonPos.y * sunPos.y + moonPos.z * sunPos.z) / (mLen * sLen);
      sepDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    }
    const illum = SunCalc.getMoonIllumination(frameDate).fraction;
    const seaDipLabelDeg = seaHorizonDipDeg((terrain?.observerElevation ?? 0) + Math.max(0, (eyeHeightM ?? 1.6) - 1.6));
    if (moonAltDeg + 0.26 > Math.max(-seaDipLabelDeg, moonHoriz) && moonLabelVisible({ moonAltDeg, sunAltDeg, illum, sepDeg })) {
      const p = projEye(moonPos);
      if (p.visible) labs.push({ id: 'moon', name: L3(lang, '달', 'Moon', '月'), x: p.px, y: p.py, color: '#38BDF8' });
    }
  }
  if (layers.milkyway) {
    const mwPos = trackingMwVec.set(0.5, -0.4, -0.7).normalize().multiplyScalar(400).applyMatrix3(equToHorizon);
    const mwAltDeg = (Math.asin(Math.max(-1, Math.min(1, mwPos.y / (mwPos.length() || 1)))) * 180) / Math.PI;
    const mwHoriz = terrainHorizonDegAtAz(terrain, azOf(mwPos));
    if (mwAltDeg > Math.max(0.5, mwHoriz) && milkyWayLabelVisible(mwAltDeg, sunAltDeg)) {
      const p = projEye(mwPos);
      if (p.visible) labs.push({ id: 'milkyway', name: L3(lang, '은하수 중심', 'Milky Way center', '天の川中心'), x: p.px, y: p.py, color: '#C4B5FD' });
    }
  }
  if (layers.planets) {
    const planetList: Array<{ key: PlanetKey; name: string; color: string }> = [
      { key: 'jupiter', name: L3(lang, '목성', 'Jupiter', '木星'), color: '#F43F5E' },
      { key: 'saturn', name: L3(lang, '토성', 'Saturn', '土星'), color: '#F59E0B' },
      { key: 'venus', name: L3(lang, '금성', 'Venus', '金星'), color: '#38BDF8' },
    ];
    planetList.forEach((pl, idx) => {
      const pWorld = getPlanetDirectionVector(pl.key, frameDate, tempPlanetVec).multiplyScalar(380).applyMatrix3(equToHorizon);
      const pAltDeg = (Math.asin(Math.max(-1, Math.min(1, pWorld.y / (pWorld.length() || 1)))) * 180) / Math.PI;
      const pHoriz = terrainHorizonDegAtAz(terrain, azOf(pWorld));
      if (pAltDeg > Math.max(0.5, pHoriz) && planetLabelVisible(pl.key, pAltDeg, sunAltDeg)) {
        const p = projEye(pWorld);
        if (p.visible) labs.push({ id: `planet_${idx}`, name: pl.name, x: p.px, y: p.py, color: pl.color });
      }
    });
  }
  if (pickedTarget) {
    const pkEl = pickedView?.elDeg ?? pickedTarget.elDeg;
    const pkAz = pickedView?.azDeg ?? pickedTarget.azDeg;
    const ce = Math.cos((pkEl * Math.PI) / 180), se = Math.sin((pkEl * Math.PI) / 180);
    const a = (pkAz * Math.PI) / 180;
    const pp = proj(new THREE.Vector3(Math.sin(a) * ce * 400, se * 400, -Math.cos(a) * ce * 400).add(camera.position));
    if (pp.visible) labs.push({ id: 'pick', name: '', x: pp.px, y: pp.py, color: '#38BDF8' });
  }
  return labs;
}

export function resolveCelestialLabelY(
  rawX: number,
  rawY: number,
  placed: Array<{ x: number; y: number; w: number; h: number }>,
  maxY: number,
  lblW: number,
  lblH: number,
): number {
  let y = rawY;
  const MARGIN = 4;
  for (let attempt = 0; attempt < 5; attempt++) {
    const overlapping = placed.some(p =>
      rawX < p.x + p.w + MARGIN &&
      rawX + lblW > p.x - MARGIN &&
      y < p.y + p.h + MARGIN &&
      y + lblH > p.y - MARGIN,
    );
    if (!overlapping) break;
    const downY = y + lblH + MARGIN;
    const upY = y - lblH - MARGIN;
    y = downY + lblH <= maxY ? downY : Math.max(10, upY);
  }
  return y;
}
