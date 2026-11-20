/**
 * savedScenes.ts — **저장한 장면**의 순수 로직(docs/SANDBOX_MODE_PLAN.md 12.3, 목업 20 "저장한 장면"). 화면과 저장소는 건드리지 않습니다.
 *
 * 장면은 지금 샌드박스에서 보고 있는 것을 그대로 적어 둔 것입니다: 자리, 눈 높이, 보는 방향(방위 · 앙각), 줌, 날짜와 시각, 고른 대상.
 * **날씨는 저장하지 않고** 열 때 그 시각의 예보를 새로 받습니다. 이 기기에만 저장하며 서버로 보내지 않습니다. 촬영 "계획"이라는 물건을 따로 만들지 않고,
 * 보고 있는 장면이 곧 계획이라는 방향(12.1)에 따라 이 모양 하나로 둡니다.
 *
 *  - 저장하는 값은 화면에 적히는 값과 같게 정리합니다(눈 높이와 줌은 세로 막대와 같은 반올림, 방위와 앙각은 한 자리, 위도 · 경도는 소수 여섯째 자리 = 약 0.1 m).
 *  - 저장소에서 읽은 값은 `sanitizeScenes` 로 한 번 더 정리합니다. 파일이 깨지거나 앱 버전이 바뀌어도 화면이 망가지지 않게, 못 읽는 장면은 버리고 범위를 벗어난 값은 자릅니다.
 *  - 고른 대상은 위경도로 기억합니다(`targetFromPicked`). 열 때 새 자리의 지형이 오면 장면이 그 점을 새 눈에서 본 값으로 돌려주고(`targetFromLatLon`),
 *    `pickedTarget.rebuildPicked` 가 같은 종류의 대상으로 다시 만듭니다(`pendingTargetFromScene` 이 그 입력을 만듭니다).
 *
 * 판정: `tools/shader-preview/verify-saved-scenes.js`
 */
import { EYE_RANGE, ZOOM_RANGE, fmtEye, fmtZoom, roundEye, roundZoom } from './sandboxDials';
import { targetPointOf } from './pickedTarget';
import { sunPosition } from './solarPosition';
import type { BuildingInfo, PickedTarget, TargetPoint } from './demPick';

export type SceneLang = 'ko' | 'en' | 'ja';

/** 저장할 수 있는 장면의 최대 수. */
export const SAVED_SCENE_MAX = 50;
/** 이름의 최대 글자 수(코드 포인트). */
export const SCENE_NAME_MAX = 40;

/** 다시 건물로 되살리는 데 필요한 다섯 수치. 점 칸(방위 · 앙각 · 거리)은 열 때 새 눈에서 다시 잽니다. */
export interface SceneBuilding {
  heightM: number;
  baseElevM: number;
  topElevM: number;
  longM: number;
  shortM: number;
}

/** 고른 대상. 건물이면 꼭대기(지붕 한가운데), 땅이면 고른 점. `distM` 은 저장할 때 눈에서의 지상 거리로 글에만 씁니다. */
export interface SceneTarget {
  kind: 'terrain' | 'building';
  latitude: number;
  longitude: number;
  elevM: number;
  distM: number;
  building?: SceneBuilding;
}

export interface SavedScene {
  id: string;
  name: string;
  savedAtMs: number;
  latitude: number;
  longitude: number;
  eyeHeightM: number;
  azDeg: number;
  elDeg: number;
  zoomX: number;
  timeMs: number;
  target: SceneTarget | null;
}

/** 지금 장면에서 읽은 값(정리 전). */
export interface SceneInput {
  latitude: number;
  longitude: number;
  eyeHeightM: number;
  azDeg: number;
  elDeg: number;
  zoomX: number;
  timeMs: number;
  target: SceneTarget | null;
}

// ── 정리 ─────────────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r1 = (x: number) => Math.round(x * 10) / 10;
/** 음의 0 을 0 으로(JSON 은 -0 을 "0" 으로 적으므로 읽었을 때 달라 보이지 않게). */
const nz = (x: number) => x + 0;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * 경도를 −180 이상 180 미만으로 감습니다. 이미 그 범위면 그대로 돌려줍니다(감는 계산은 126.978 을 126.97800000000007 로 흔들기 때문입니다).
 * 감은 값은 소수 여섯째 자리로 다시 반올림해 그 흔들림을 지웁니다.
 */
const wrapLon = (lon: number) => {
  if (lon >= -180 && lon < 180) return nz(lon);
  return nz(r6((((lon + 180) % 360) + 360) % 360 - 180));
};
/** 방위를 0 이상 360 미만 한 자리로(반올림해 360.0 이 되면 0). */
const normAz = (az: number) => { const r = r1((((az % 360) + 360) % 360)); return nz(r >= 360 ? 0 : r); };

interface Fields {
  latitude: number;
  longitude: number;
  eyeHeightM: number;
  azDeg: number;
  elDeg: number;
  zoomX: number;
  timeMs: number;
}

/** 숫자 일곱 칸을 화면에 적히는 값과 같게 정리합니다. 하나라도 숫자가 아니면 null. */
function normalizeFields(f: { [K in keyof Fields]: unknown }): Fields | null {
  if (!fin(f.latitude) || !fin(f.longitude) || !fin(f.eyeHeightM) || !fin(f.azDeg) || !fin(f.elDeg) || !fin(f.zoomX) || !fin(f.timeMs)) return null;
  return {
    latitude: nz(r6(clamp(f.latitude, -90, 90))),
    longitude: wrapLon(r6(f.longitude)),
    eyeHeightM: roundEye(clamp(f.eyeHeightM, EYE_RANGE.min, EYE_RANGE.max)),
    azDeg: normAz(f.azDeg),
    elDeg: nz(r1(clamp(f.elDeg, -90, 90))),
    zoomX: roundZoom(clamp(f.zoomX, ZOOM_RANGE.min, ZOOM_RANGE.max)),
    timeMs: f.timeMs,
  };
}

function normalizeBuilding(b: unknown): SceneBuilding | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  if (!fin(o.heightM) || !fin(o.baseElevM) || !fin(o.topElevM) || !fin(o.longM) || !fin(o.shortM)) return null;
  return { heightM: nz(r1(o.heightM)), baseElevM: nz(r1(o.baseElevM)), topElevM: nz(r1(o.topElevM)), longM: nz(r1(o.longM)), shortM: nz(r1(o.shortM)) };
}

/** 고른 대상을 정리합니다. 망가졌으면 null(장면은 대상 없이 남습니다). */
function normalizeTarget(t: unknown): SceneTarget | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if ((o.kind !== 'terrain' && o.kind !== 'building') || !fin(o.latitude) || !fin(o.longitude) || !fin(o.elevM) || !fin(o.distM)) return null;
  const base = {
    kind: o.kind as SceneTarget['kind'],
    latitude: nz(r6(clamp(o.latitude, -90, 90))),
    longitude: wrapLon(r6(o.longitude)),
    elevM: nz(r1(o.elevM)),
    distM: nz(Math.round(Math.max(0, o.distM))),
  };
  if (o.kind === 'building') {
    const b = normalizeBuilding(o.building);
    return b ? { ...base, building: b } : null;
  }
  return base;
}

/** 이름을 정리합니다: 제어 문자를 빼고 공백 묶음은 한 칸으로, 앞뒤를 자르고, 40 글자(코드 포인트)에서 자릅니다. 비면 빈 글. */
export function cleanName(raw: unknown, max: number = SCENE_NAME_MAX): string {
  const s = String(raw ?? '')
    .replace(/[\t\n\r\v\f]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max).join('').trim() : s;
}

// ── 시각과 글 ────────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0');

/** `tzHours` 로 본 그 시각의 달력(UTC 게터로 읽습니다). */
function localParts(ms: number, tzHours: number) {
  const d = new Date(ms + tzHours * 3600000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

const pick = <T,>(lang: SceneLang, ko: T, en: T, ja: T): T => (lang === 'en' ? en : lang === 'ja' ? ja : ko);

/** 기본 이름: 그 시각을 `tzHours` 로 본 "11.24 18:12 장면". */
export function defaultSceneName(timeMs: number, tzHours: number, lang: SceneLang): string {
  const t = localParts(timeMs, tzHours);
  const stamp = `${p2(t.mo)}.${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}`;
  return pick(lang, `${stamp} 장면`, `Scene ${stamp}`, `${stamp} のシーン`);
}

export interface MakeOptions {
  name: string;
  nowMs: number;
  id: string;
  tzHours: number;
  lang: SceneLang;
}

/**
 * 지금 장면을 저장할 모양으로 만듭니다. 숫자가 하나라도 이상하면 null(저장하지 않습니다).
 * 이름이 비면 기본 이름을 씁니다. 고른 대상이 이상하면 대상만 뺍니다.
 */
export function makeScene(input: SceneInput, o: MakeOptions): SavedScene | null {
  const f = normalizeFields(input);
  if (!f || !fin(o.nowMs) || !o.id) return null;
  return buildScene(o.id, cleanName(o.name) || defaultSceneName(f.timeMs, o.tzHours, o.lang), o.nowMs, f, normalizeTarget(input.target));
}

/** 키 순서를 한 곳에서 정해, 만들 때와 읽을 때 같은 순서로 나오게 합니다(JSON 으로 견주어도 같다). */
function buildScene(id: string, name: string, savedAtMs: number, f: Fields, target: SceneTarget | null): SavedScene {
  return {
    id,
    name,
    savedAtMs,
    latitude: f.latitude,
    longitude: f.longitude,
    eyeHeightM: f.eyeHeightM,
    azDeg: f.azDeg,
    elDeg: f.elDeg,
    zoomX: f.zoomX,
    timeMs: f.timeMs,
    target,
  };
}

/** 새 id. 시각과 난수를 36 진수로 이어 붙입니다(난수는 넘겨 받아 판정이 고정할 수 있게). */
export function nextSceneId(nowMs: number, rnd: () => number = Math.random): string {
  return `scene_${Math.floor(nowMs).toString(36)}_${Math.floor(clamp(rnd(), 0, 0.999999) * 36 ** 4).toString(36).padStart(4, '0')}`;
}

export interface SummaryContext {
  nowMs: number;
  /** 장면의 시각을 읽을 시간대(시간). */
  tzHours: number;
  lang: SceneLang;
}

/** "11.24 18:12 · 눈 31 m · 방위 128° · 20×" — 같은 날이면 날짜 대신 "오늘". */
export function sceneSummary(s: SavedScene, c: SummaryContext): string {
  const t = localParts(s.timeMs, c.tzHours), n = localParts(c.nowMs, c.tzHours);
  const hm = `${p2(t.h)}:${p2(t.mi)}`;
  const sameDay = t.y === n.y && t.mo === n.mo && t.d === n.d;
  const when = sameDay ? `${pick(c.lang, '오늘', 'Today', '今日')} ${hm}` : `${p2(t.mo)}.${p2(t.d)} ${hm}`;
  const az = `${Math.round(s.azDeg) % 360}°`;
  return [when, `${pick(c.lang, '눈', 'Eye', '目')} ${fmtEye(s.eyeHeightM)}`, `${pick(c.lang, '방위', 'Az', '方位')} ${az}`, fmtZoom(s.zoomX)].join(' · ');
}

const COMPASS_KO = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
const COMPASS_EN = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
const COMPASS_JA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/** 8 방위 말("남서쪽 하늘"). 북은 337.5 이상 22.5 미만, 경계는 위쪽 방위로(22.5 는 북동). */
function skyWords(azDeg: number, lang: SceneLang): string {
  const i = Math.floor((((azDeg % 360) + 360 + 22.5) % 360) / 45);
  return pick(lang, `${COMPASS_KO[i]}쪽 하늘`, `${COMPASS_EN[i]} sky`, `${COMPASS_JA[i]}の空`);
}

/** 해가 시선 기준 어디인가("정면 · 오른쪽 · 왼쪽 하늘"). 나침반이 아니라 보는 사람 기준이라 위도와 상관없이 맞습니다. 정면은 ±15° 안(경계 포함). */
export const SUN_AHEAD_DEG = 15;
function sunSide(d: number, lang: SceneLang): string {
  if (Math.abs(d) <= SUN_AHEAD_DEG) return pick(lang, '정면 하늘', 'Ahead', '正面の空');
  return d > 0 ? pick(lang, '오른쪽 하늘', 'Right side', '右の空') : pick(lang, '왼쪽 하늘', 'Left side', '左の空');
}

/** 그 시각 해의 자리. `rising` 은 뜨는 중(고도가 늘어나는 중)인가. */
export interface SunNote {
  altDeg: number;
  azDeg: number;
  rising: boolean;
}

/**
 * 그 시각 그 자리의 해: 고도(도), 나침반 방위(북 0, 동 90, 0 이상 360 미만), 뜨는 중인가(10 분 뒤 고도가 더 높은가).
 * `sunPosition` 은 방위를 남쪽 0 · 서쪽 +(라디안)로 돌려주므로 북 기준 나침반 도로 바꿉니다. 시각 · 자리가 숫자가 아니면 null.
 */
export function sunNoteAt(timeMs: number, latitude: number, longitude: number): SunNote | null {
  if (!fin(timeMs) || !fin(latitude) || !fin(longitude)) return null;
  const a = sunPosition(new Date(timeMs), latitude, longitude);
  const b = sunPosition(new Date(timeMs + 10 * 60000), latitude, longitude);
  if (!fin(a.altitude) || !fin(a.azimuth) || !fin(b.altitude)) return null;
  const R2D = 180 / Math.PI;
  return { altDeg: a.altitude * R2D, azDeg: nz((((a.azimuth * R2D + 180) % 360) + 360) % 360), rising: b.altitude > a.altitude };
}

const fmtDistance = (m: number) => {
  const r = Math.round(m);
  return r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`;
};

/** 해가 지평선 가까이라고 보는 고도 범위(도)와, 시선이 해와 이 안이면 "일출 · 일몰" 을 붙이는 각(도). */
const HORIZON_ALT_DEG = 8;
const SUN_NEAR_DEG = 60;

/**
 * 목록의 두 번째 줄: 고른 대상이 있으면 그 설명("건물 · 555 m", "지형 지점 · 3.1 km"), 없으면 하늘 글
 * ("일몰 · 오른쪽 하늘": 해가 지평선 가까이이고 시선이 해와 60° 안일 때만 일출 · 일몰을 붙이고, 해는 시선 기준 정면 · 오른쪽 · 왼쪽으로 말합니다).
 */
export function sceneNote(s: SavedScene, sun: SunNote | null, lang: SceneLang): string {
  const t = s.target;
  if (t) {
    const head = t.kind === 'building' && t.building
      ? `${pick(lang, '건물', 'Building', '建物')} · ${Math.round(t.building.heightM)} m`
      : `${pick(lang, '지형 지점', 'Terrain point', '地形の点')} · ${fmtDistance(t.distM)}`;
    return head;
  }
  const words = skyWords(s.azDeg, lang);
  if (sun && fin(sun.altDeg) && fin(sun.azDeg) && Math.abs(sun.altDeg) <= HORIZON_ALT_DEG) {
    const d = (((sun.azDeg - s.azDeg) % 360) + 540) % 360 - 180; // 시선 기준 해의 각(오른쪽 +)
    if (Math.abs(d) <= SUN_NEAR_DEG) return `${sun.rising ? pick(lang, '일출', 'Sunrise', '日の出') : pick(lang, '일몰', 'Sunset', '日没')} · ${sunSide(d, lang)}`;
  }
  return words;
}

// ── 목록 ─────────────────────────────────────────────────────────────────────

export interface AddResult {
  list: SavedScene[];
  ok: boolean;
  reason: 'full' | 'duplicate' | null;
}

/** 새 장면을 맨 앞(최신순)에 넣습니다. 같은 id 이거나 `SAVED_SCENE_MAX` 개가 찼으면 거절하고 목록은 그대로. 원본은 바꾸지 않습니다. */
export function addScene(list: readonly SavedScene[], scene: SavedScene): AddResult {
  if (list.some(s => s.id === scene.id)) return { list: [...list], ok: false, reason: 'duplicate' };
  if (list.length >= SAVED_SCENE_MAX) return { list: [...list], ok: false, reason: 'full' };
  return { list: [scene, ...list], ok: true, reason: null };
}

/** 이름 바꾸기(정리한 이름으로). 정리하면 비거나 없는 id 면 그대로. */
export function renameScene(list: readonly SavedScene[], id: string, name: string): SavedScene[] {
  const n = cleanName(name);
  if (!n) return [...list];
  return list.map(s => (s.id === id ? { ...s, name: n } : s));
}

export function removeScene(list: readonly SavedScene[], id: string): SavedScene[] {
  return list.filter(s => s.id !== id);
}

// ── 저장소에서 읽기 ──────────────────────────────────────────────────────────

function sanitizeScene(r: unknown): SavedScene | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id || o.id.length > 64) return null;
  const f = normalizeFields({ latitude: o.latitude, longitude: o.longitude, eyeHeightM: o.eyeHeightM, azDeg: o.azDeg, elDeg: o.elDeg, zoomX: o.zoomX, timeMs: o.timeMs });
  if (!f || !fin(o.savedAtMs)) return null;
  // 이름이 비었거나 글이 아니면 UTC 로 본 기본 이름을 씁니다(저장소에서 읽을 때는 시간대를 모릅니다).
  const name = (typeof o.name === 'string' ? cleanName(o.name) : '') || defaultSceneName(f.timeMs, 0, 'en');
  return buildScene(o.id, name, o.savedAtMs, f, normalizeTarget(o.target));
}

/**
 * 저장소에서 읽은 값을 정리합니다. 배열이 아니면 빈 목록, 못 읽는 장면은 버리고 범위를 벗어난 값은 자르며,
 * 같은 id 는 앞의 것만 남기고 `SAVED_SCENE_MAX` 개를 넘으면 앞에서부터 그만큼만 남깁니다. 이미 정리된 목록은 그대로입니다.
 */
export function sanitizeScenes(raw: unknown): SavedScene[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedScene[] = [];
  for (const r of raw) {
    const s = sanitizeScene(r);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
    if (out.length >= SAVED_SCENE_MAX) break;
  }
  return out;
}

// ── 고른 대상 오가기 ─────────────────────────────────────────────────────────

/** 고른 대상을 기억할 모양으로. 위경도를 모르면 null. 건물은 꼭대기(지붕 한가운데)를, 땅은 고른 점을 기억합니다. */
export function targetFromPicked(t: PickedTarget | null | undefined): SceneTarget | null {
  if (!t) return null;
  const p = targetPointOf(t);
  if (!p) return null;
  const base = { latitude: p.latitude, longitude: p.longitude, elevM: p.elevM, distM: p.distM };
  if (t.kind === 'building' && t.building) {
    const b = t.building;
    return { kind: 'building', ...base, building: { heightM: b.heightM, baseElevM: b.baseElevM, topElevM: b.topElevM, longM: b.longM, shortM: b.shortM } };
  }
  return { kind: 'terrain', ...base };
}

/** `rebuildPicked` 가 점 칸을 새 점으로 덮어쓰므로 자리만 채우는 값. */
const placeholderPoint = (elevM: number): TargetPoint => ({ azDeg: 0, elDeg: 0, distM: 0, elevM, eastM: 0, southM: 0, latitude: null, longitude: null, visible: true, marginM: 0 });

/** 열 때 새 자리의 지형이 오면 대상을 다시 잡기 위한 입력(`targetFromLatLon` 으로 점을 구한 뒤 `rebuildPicked(kind, building, 점)`). 대상이 없으면 null. */
export function pendingTargetFromScene(s: SavedScene): { kind: 'terrain' | 'building'; latitude: number; longitude: number; elevM: number; building?: BuildingInfo } | null {
  const t = s.target;
  if (!t) return null;
  if (t.kind === 'building' && t.building) {
    const p = placeholderPoint(t.building.topElevM);
    const building: BuildingInfo = { ...t.building, angularHeightDeg: 0, snapped: true, hitPoint: p, topPoint: p };
    return { kind: 'building', latitude: t.latitude, longitude: t.longitude, elevM: t.elevM, building };
  }
  return { kind: 'terrain', latitude: t.latitude, longitude: t.longitude, elevM: t.elevM };
}
