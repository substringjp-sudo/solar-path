import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDebouncedPersistStorage } from '../utils/debouncedPersist';
import { startupTrace } from '../utils/startupTrace';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadWeatherCache, loadTerrainCache, loadRingCache,
  saveWeatherCache, saveTerrainCache, saveRingCache,
} from '../utils/persistentCache';
import {
  weatherCacheKey, terrainCacheKey, needTerrainFetch, upsertEntry,
  findEntry, MAX_CACHE_ENTRIES, MAX_RING_ENTRIES, sameBucket,
  canaryPrint, canarySaysSkip, canaryIsUsable,
} from '../utils/cachePolicy';
import { auth, db, storage } from '../config/firebase';
import { doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch, updateDoc, deleteField } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { User } from 'firebase/auth';
import { TerrainData, fetchTerrainProfile, fetchDayWeatherRing, fetchWeatherCanary, primeRingCache, setRingPersister, setRingFallbackFinder } from '../utils/weather';
import { encryptData, decryptData } from '../utils/security';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import type { LearnEntry } from '../utils/learnSections';
import { localDateString } from '../utils/localDate';
import type { LayerState, SkySettings } from '../components/SkyScene3D/SkyScene3D';
import { DEFAULT_NOTIF_PREFS, type NotifPrefs } from '../utils/notificationPlan';
import { mergeCompare, type PhotoCompare, type PhotoKind } from '../utils/recordCompare';
import { addScene, mergeSampleScenes, removeScene, renameScene, sanitizeScenes, type AddResult, type SavedScene } from '../utils/savedScenes';
import type { SkyTimeline } from '../utils/skyTimeline';
import { createClockSlice, type ClockState } from '../utils/liveClock';
import type { AstroSettingsState } from '../utils/astroCameraUi';
import type { TimelapsePlan } from '../utils/timelapsePlan';
import type { CameraGearBagState } from '../utils/photoAlgorithms';

export interface CameraHandoff {
  mode: 'photo' | 'astro' | 'timelapse';
  zoomX: number;
  exposure: number;
  astroSettings?: AstroSettingsState;
  timelapsePlan?: TimelapsePlan | null;
  gearBag?: CameraGearBagState;
}

export interface CameraHudState {
  hidden?: boolean;
  isAstro: boolean;
  azDeg: number;
  elDeg: number;
  frozenActive: boolean;
  topInfoExpanded: boolean;
  alignMenuOpen: boolean;
  alignDotColor?: string | null;
  canSwitchCamera: boolean;
  onToggleTopInfo: () => void;
  onToggleAlignMenu: () => void;
  onSwitchCamera: () => void;
}

const uploadTimers: { [photoId: string]: any } = {};

const generateUniqueId = () => {
  return Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
};

export function sanitizeFirestoreData(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') {
    if (typeof obj === 'number' && isNaN(obj)) return 0;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeFirestoreData);
  }
  const sanitized: any = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      sanitized[key] = sanitizeFirestoreData(val);
    }
  }
  return sanitized;
}

export interface WeatherCacheItem {
  key: string;
  data: any[];
  timestamp: number;
  latitude: number;
  longitude: number;
  /**
   * 카나리아 한 점의 **보정 전 원본** 지문.
   *
   * ⚠ `data` 로 견주면 안 됩니다 — 예전에는 거기에 위성 운량 편향 보정(`applyBiasToPath`)이 발려 있었고, 보정 세기가 관측 시각을
   * 따라 계속 변해서 예보가 그대로여도 늘 "바뀜" 이 나왔습니다(`cachePolicy.ts` 카나리아 절). §166 부터 그 보정은 호출처가 없어
   * 지금은 발리지 않지만, 다시 붙일 때를 위해 원본 지문을 그대로 씁니다.
   */
  canaryPrint?: string;
}

export interface TerrainCacheItem {
  key: string;
  data: any;
  timestamp: number;
  latitude: number;
  longitude: number;
}

export interface MyPhoto {
  id: string;
  latitude: number;
  longitude: number;
  imageUrl: string;
  timestamp: number;
  locationName: string;
  landscapeScore?: number;
  weatherScore?: number;
  weatherInfo?: any;
  simulationSample?: any;
  simulationImageUrl?: string;
  isPending?: boolean;
  scheduledUploadTime?: number;
  localUri?: string;
  simulationLocalUri?: string;
  deviceAzimuth?: number;
  devicePitch?: number;
  isPublic?: boolean;
  likesCount?: number;
  userFeedback?: 'good' | 'bad' | null;
  /** 찍은 종류(없으면 찍은 때의 해 고도로 정함, `recordCompare.photoKind`) */
  kind?: PhotoKind;
  /** 한 번 누르는 피드백: 구름 양 · 색이 예측과 비교해 어땠나(계획 8.7) */
  compare?: PhotoCompare;
}

export interface GlobalPhoto {
  id: string;
  latitude: number;
  longitude: number;
  imageUrl: string;
  storagePath: string;
  timestamp: number;
  locationName: string;
  userId: string;
  userName: string;
  landscapeScore?: number;
  weatherScore?: number;
  weatherInfo?: any;
  simulationSample?: any;
  simulationImageUrl?: string;
  simulationStoragePath?: string;
  deviceAzimuth?: number;
  devicePitch?: number;
  scheduledUploadTime?: number;
}

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  terrainData?: TerrainData;
}

/** 시각(`currentTime`·`isTimeMachineEnabled`)과 그 동작은 `ClockState`(utils/liveClock.ts)에 있습니다. */
interface CelestialState extends ClockState {
  location: Location.LocationObject | null;
  timezoneOffsetHours: number;
  timezoneLabel: string;
  errorMsg: string | null;
  weatherCache: WeatherCacheItem | null;
  terrainCache: TerrainCacheItem | null;
  weatherCacheList: WeatherCacheItem[];
  terrainCacheList: TerrainCacheItem[];
  userRotation: number;
  isGyroEnabled: boolean;
  savedLocations: SavedLocation[];
  currentUser: User | null;
  myPhotos: MyPhoto[];
  globalPhotos: GlobalPhoto[];
  /** 사용자 제작 콘텐츠 안전(Play 정책, 출시 점검 2026-09-30): 신고로 가린 사진 · 차단한 사용자 */
  hiddenPhotoIds: string[];
  blockedUserIds: string[];
  hidePhoto: (photoId: string) => void;
  blockUser: (userId: string) => void;
  locationPermission: string | null;
  cameraPermission: string | null;
  mediaPermission: string | null;
  microphonePermission: string | null;
  isSimulationLoading: boolean;
  isDebugMode: boolean;
  language: 'ko' | 'en' | 'ja';
  /** 화면 모드 — 밝은 모드는 패널·창·기록 탭·헤더만 밝힙니다(docs/DESIGN_SYSTEM.md §4.1). 기본은 어둡게. */
  themeMode: 'system' | 'light' | 'dark';
  /** 상단 알림바(StatusBar) 아이콘 색 — 배경은 검은색으로 고정하고 아이콘만 밝게(흰색)/어둡게(검은색) 전환합니다. */
  statusBarIcon: 'light' | 'dark';
  /**
   * 전문가 모드 (2026-11-19, docs/SANDBOX_MODE_PLAN.md 2.4). 꺼짐(기본)이면 하늘 화면이 초보자용으로 덜어낸 모습이고,
   * 켜면 지금까지의 모든 조작(레이어·지구/지도·태양 추적·달력·기상정보·수치)이 그대로 나옵니다.
   * 샌드박스 모드가 만들어지면 이 스위치가 그 입구가 됩니다.
   */
  expertMode: boolean;
  /**
   * 새 화면 틀(실험, 2026-11-21): 하늘 화면 아래를 유리 막대(시간 자 · 칩 · 셔터 · 모드 줄)로 바꿉니다. 꺼짐이 기본이고, 실기기 확인 뒤 기본으로 켭니다.
   */
  /**
   * 처음 실행 안내(docs/SANDBOX_MODE_PLAN.md 10.1 의 8번)를 마쳤거나 건너뛰었는가. 저장합니다.
   * 거짓이면 앱이 준비되는 대로 안내를 한 번 보이고, 설정의 "안내 다시 보기"는 이 값과 상관없이 엽니다.
   */
  onboardingSeen: boolean;
  /**
   * 기기 GPS 로 마지막에 받은 "내 위치"(2026-11-19 샌드박스). 고른 위치(`location`)가 이것과 멀면 "내 위치 아님"을 보입니다.
   * GPS 를 한 번도 못 받았으면 null(표시 안 함). 저장합니다.
   */
  homeCoords: { latitude: number; longitude: number } | null;
  /**
   * 저장한 장면(2026-11-20 샌드박스, docs/SANDBOX_MODE_PLAN.md 12.3): 자리 · 눈 높이 · 보는 방향 · 줌 · 시각 · 고른 대상. 이 기기에만 저장하고 서버로 보내지 않으며
   * 날씨는 저장하지 않습니다. 최신순, 최대 50 개. 읽어 들일 때 `sanitizeScenes` 로 정리합니다.
   */
  savedScenes: SavedScene[];
  /** 기본 추천 샘플 장면 시드를 최초 1회 적용했는지 여부 */
  sampleScenesSeeded: boolean;
  /** 맥락 기반 1회성 기능 발견 힌트 열람 상태 */
  seenHints: { sandboxPick?: boolean; alignBody?: boolean; spaceZoom?: boolean };
  /**
   * "이 장면 찍기"로 샌드박스에서 카메라에 넘긴 장면(2026-11-20, 계획 12.3). 저장한 장면일 필요는 없습니다. 카메라가 이 방향으로 안내하고 시각에 맞는 모드를 권합니다.
   * 카메라를 닫으면 지웁니다. 저장하지 않습니다(partialize 에 없음).
   */
  cameraScene: SavedScene | null;
  setCameraScene: (scene: SavedScene | null) => void;
  /** 샌드박스에서 카메라로 넘기는 촬영 프리셋(모드 · 줌 · 노출 · 천체/타임랩스 세팅). 저장하지 않습니다. */
  cameraHandoff: CameraHandoff | null;
  setCameraHandoff: (handoff: CameraHandoff | null) => void;
  /** 하늘 화면 상단 통합 버튼(지도 이동 · 레이어 설정) 콜백. 저장하지 않습니다. */
  skyHeaderActions: {
    flyToMap?: () => void;
    openLayers?: () => void;
    openDev?: () => void;
    ascended?: boolean;
    trackingLabel?: string | null;
    onClearTracking?: () => void;
    pickedLabel?: string | null;
    pickedDetailOpen?: boolean;
    onTogglePickedDetail?: () => void;
    onClearPicked?: () => void;
  } | null;
  setSkyHeaderActions: (actions: CelestialState['skyHeaderActions']) => void;
  /** 카메라 오버레이 활성 시 루트 상단 HUD가 표시할 상태와 콜백. 저장하지 않습니다. */
  cameraHud: CameraHudState | null;
  setCameraHud: (hud: CameraHudState | null) => void;
  /** 외부 모달(촬영 결과 비교 · 03 기록 등)에서 02 학습 계산 과정으로 바로 이동할 때 씁니다. */
  pendingLearnEntry: Omit<LearnEntry, 'nonce'> | null;
  requestOpenLearn: (entry: Omit<LearnEntry, 'nonce'> | null) => void;
  /** 알림 설정 — 노을·일출 예보 + 하늘 이벤트(골든아워·블루아워·월출·가는 달·은하수·행성). utils/notificationPlan.ts */
  notifPrefs: NotifPrefs;
  isAppReady: boolean;
  preloadStatus: string;
  isCacheHydrated: boolean;
  /**
   * 시작할 때 위치를 정하는 일(권한 확인 → GPS/기본 위치)이 끝났는지. 처음 딥링크(텔레포트)가 이걸 기다립니다 —
   * 먼저 텔레포트하면 프리로드의 GPS 가 그 위치를 덮어씁니다. 저장하지 않습니다.
   */
  startupLocationSettled: boolean;
  /** 프리로드 후 처음 열 탭: 'sky'(01 하늘) | 'learn'(02 학습) | 'log'(03 기록). 옛 'map' · 'forecast' 는 앱이 'sky' 로 읽습니다. */
  initialTab: 'sky' | 'learn' | 'forecast' | 'map' | 'log';
  selectedCategory: 'sun' | 'cloud' | 'star' | 'sim3d' | 'gallery';
  
  // Actions
  setSelectedCategory: (category: 'sun' | 'cloud' | 'star' | 'sim3d' | 'gallery') => void;
  setLocation: (loc: Location.LocationObject | null) => void;
  setErrorMsg: (msg: string | null) => void;
  setWeatherCache: (cache: WeatherCacheItem | null) => void;
  setTerrainCache: (cache: TerrainCacheItem | null) => void;
  addWeatherCache: (cache: WeatherCacheItem) => void;
  addTerrainCache: (cache: TerrainCacheItem) => void;
  setUserRotation: (rot: number) => void;
  setGyroEnabled: (enabled: boolean) => void;
  resetRotation: () => void;
  addSavedLocation: (name: string, latitude: number, longitude: number, terrainData?: TerrainData) => Promise<void>;
  removeSavedLocation: (id: string) => Promise<void>;
  setCurrentUser: (user: User | null) => Promise<void>;
  syncSavedLocations: () => () => void;
  addMyPhoto: (
    imageUrl: string, 
    latitude: number, 
    longitude: number, 
    locationName: string,
    landscapeScore?: number,
    weatherScore?: number,
    weatherInfo?: any,
    simulationSample?: any,
    simulationImageUrl?: string,
    photoId?: string
  ) => Promise<void>;
  removeMyPhoto: (id: string) => Promise<void>;
  togglePhotoVisibility: (id: string, isPublic: boolean) => Promise<void>;
  setPhotoFeedback: (photoId: string, feedback: 'good' | 'bad' | null) => Promise<void>;
  /** 구름 양 · 색 피드백을 합쳐 저장합니다(같은 칩을 다시 누르면 꺼짐). */
  setPhotoCompare: (photoId: string, next: PhotoCompare) => Promise<void>;
  syncMyPhotos: () => () => void;
  
  uploadAndPostPhoto: (
    localUri: string, 
    latitude: number, 
    longitude: number, 
    locationName: string,
    landscapeScore?: number,
    weatherScore?: number,
    weatherInfo?: any,
    simulationSample?: any,
    simulationImageUri?: string,
    deviceAzimuth?: number,
    devicePitch?: number
  ) => Promise<string>;
  syncGlobalPhotos: () => () => void;
  removeGlobalPhoto: (id: string) => Promise<void>;
  checkPermissions: () => Promise<void>;
  requestLocationPermission: () => Promise<void>;
  requestCameraPermission: () => Promise<void>;
  requestMediaPermission: () => Promise<void>;
  requestMicrophonePermission: () => Promise<void>;
  setSimulationLoading: (loading: boolean) => void;
  setDebugMode: (enabled: boolean) => void;
  setLanguage: (lang: 'ko' | 'en' | 'ja') => void;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => void;
  setStatusBarIcon: (icon: 'light' | 'dark') => void;
  setExpertMode: (on: boolean) => void;
  setOnboardingSeen: (seen: boolean) => void;
  setHomeCoords: (c: { latitude: number; longitude: number } | null) => void;
  /** 장면을 맨 앞에 저장합니다. 50 개가 찼거나 같은 id 면 거절하고 이유를 돌려줍니다(저장소는 그대로). */
  addSavedScene: (scene: SavedScene) => AddResult;
  renameSavedScene: (id: string, name: string) => void;
  removeSavedScene: (id: string) => void;
  restoreSampleScenes: () => void;
  markHintSeen: (key: 'sandboxPick' | 'alignBody' | 'spaceZoom') => void;
  resetHints: () => void;
  setNotifPref: <K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) => void;
  setAppReady: (ready: boolean) => void;
  preloadInitialData: () => Promise<void>;
  initializePendingUploads: () => void;
  isGestureBlocked: boolean;
  setGestureBlocked: (blocked: boolean) => void;
  teleportTarget: TeleportTarget | null;
  setTeleportTarget: (target: Omit<TeleportTarget, 'nonce'>) => void;
  /**
   * 하늘 화면의 레이어·하늘 설정. **하늘 화면과 촬영하기(카메라)가 같이 봅니다** — 예전에는
   * 하늘 화면 안의 useState 라, 카메라의 3D 는 늘 기본값(도시광·한계등급·도트 모드)으로 그려
   * 두 화면의 하늘색이 달랐습니다.
   */
  skyLayers: LayerState;
  setSkyLayers: (update: (prev: LayerState) => LayerState) => void;
  skySettings: SkySettings;
  setSkySettings: (patch: Partial<SkySettings>) => void;
  /**
   * 하늘 화면이 만든 **하루치 하늘(360° 고리 기상)**. 촬영하기(카메라)도 같은 장소·날짜면 이걸 씁니다 —
   * 예전에는 하늘 화면 안의 상태라 카메라는 해 방향 부채꼴 기상만으로 그려, 두 화면의 구름이 달랐습니다.
   * 크고 날마다 새로 만드므로 **저장하지 않습니다**(partialize 에 없음).
   */
  skyTimeline: SkyTimeline | null;
  setSkyTimeline: (tl: SkyTimeline | null) => void;
}

export interface TeleportTarget {
  cameraAz?: number;
  cameraElev?: number;
  fov?: number;
  nonce: number;
}

const persistStorage = createDebouncedPersistStorage<any>({
  raw: AsyncStorage,
  delayMs: 500,
  encode: encryptData,
  decode: decryptData,
});
AppState.addEventListener('change', (st) => { if (st !== 'active') void persistStorage.flush(); });

export const useCelestialStore = create<CelestialState>()(
  persist(
    (set, get) => ({
      ...createClockSlice(set),
      location: null,
      timezoneOffsetHours: -new Date().getTimezoneOffset() / 60,
      timezoneLabel: (() => {
        const offset = -new Date().getTimezoneOffset() / 60;
        if (offset === 0) return 'GMT';
        return `GMT${offset > 0 ? '+' : ''}${offset}`;
      })(),
      errorMsg: null,
      weatherCache: null,
      terrainCache: null,
      weatherCacheList: [],
      terrainCacheList: [],
      userRotation: 0,
      isGyroEnabled: false,
      savedLocations: [],
      currentUser: null,
      myPhotos: [],
      globalPhotos: [],
      hiddenPhotoIds: [],
      blockedUserIds: [],
      hidePhoto: (photoId) => set((st) => ({
        hiddenPhotoIds: st.hiddenPhotoIds.includes(photoId) ? st.hiddenPhotoIds : [...st.hiddenPhotoIds, photoId],
        globalPhotos: st.globalPhotos.filter((p) => p.id !== photoId),
      })),
      blockUser: (userId) => set((st) => ({
        blockedUserIds: st.blockedUserIds.includes(userId) ? st.blockedUserIds : [...st.blockedUserIds, userId],
        globalPhotos: st.globalPhotos.filter((p) => p.userId !== userId),
      })),
      locationPermission: null,
      cameraPermission: 'undetermined',
      mediaPermission: 'undetermined',
      microphonePermission: 'undetermined',
      isSimulationLoading: false,
      isDebugMode: false,
      language: 'ko',
      themeMode: 'dark',
      statusBarIcon: 'light',
      notifPrefs: DEFAULT_NOTIF_PREFS,
      expertMode: false,
      onboardingSeen: false,
      homeCoords: null,
      savedScenes: [],
      sampleScenesSeeded: false,
      seenHints: {},
      cameraScene: null,
      setCameraScene: (scene) => set({ cameraScene: scene }),
      cameraHandoff: null,
      setCameraHandoff: (handoff) => set({ cameraHandoff: handoff }),
      skyHeaderActions: null,
      setSkyHeaderActions: (actions) => set({ skyHeaderActions: actions }),
      cameraHud: null,
      setCameraHud: (hud) => set({ cameraHud: hud }),
      pendingLearnEntry: null,
      requestOpenLearn: (entry) => set({ pendingLearnEntry: entry }),
      isAppReady: false,
      startupLocationSettled: false,
      preloadStatus: 'initializingApp',
      isCacheHydrated: false,
      initialTab: 'sky',
      selectedCategory: 'sun',
      isGestureBlocked: false,
      skyLayers: {
        labels: true, sun: true, moon: true, stars: true, milkyway: true,
        planets: true, clouds: true, paths: true, cityLights: true, buildings: true,
      },
      setSkyLayers: (update) => set(state => ({ skyLayers: update(state.skyLayers) })),
      // SkyScene3D 의 DEFAULT_SKY_SETTINGS 와 같은 값입니다(컴포넌트를 스토어로 끌어오지 않으려고 적어 둠).
      skySettings: {
        starBrightness: 1.0,
        starMagLimit: 6.5,
        pixelArtRows: 0,
        volumetricSky: true,
        volumetricQuality: 'low',
        volumetricRes: 0.5,
        volumetricAutoRes: true,
        volumetricFlow: true,
        volumetricFlowUv: true,
        volumetricPhysics: true,
        volumetricPhysicsIce: false,
        volumetricMacro: 1,
        volumetricMorph: false,
        volumetricBillow: true,
        volumetricFill: true,
        volumetricAccurateSun: true,
        volumetricLowSunShadow: true,
        volumetricFarSun: true,
        volumetricSheetDiffuse: true,
        volumetricClampInscatter: true,
        volumetricIrradianceLogMu: true,
      },
      setSkySettings: (patch) => set(state => ({ skySettings: { ...state.skySettings, ...patch } })),
      skyTimeline: null,
      setSkyTimeline: (tl) => set({ skyTimeline: tl }),
      teleportTarget: null,

      setSelectedCategory: (category) => set({ selectedCategory: category }),
      setGestureBlocked: (blocked) => set({ isGestureBlocked: blocked }),
      setTeleportTarget: (target) => set({ teleportTarget: { ...target, nonce: Date.now() } }),
      setWeatherCache: (cache) => set({ weatherCache: cache }),
      setTerrainCache: (cache) => set({ terrainCache: cache }),
      /**
       * 날씨 캐시에 넣고 **저장장치에도 씁니다.**
       *
       * ⚠ 쓰기는 기다리지 않습니다(fire-and-forget). 캐시 쓰기가 늦어도 화면은
       * 이미 값을 받았고, 실패해도 다음에 다시 받으면 되는 것이라 앱을
       * 멈춰 세울 이유가 없습니다.
       */
      addWeatherCache: (cache) => set((state) => {
        if ((cache?.data as any)?.[0]?.isFallback) return state;
        const filtered = (state.weatherCacheList || []).filter(item => {
          if (item.key === cache.key) return false;
          const d = item.data as any;
          if (!d || !Array.isArray(d) || d.length === 0) return false;
          if (d[0]?.isFallback) return false;
          return true;
        });
        const list = [cache, ...filtered].slice(0, MAX_CACHE_ENTRIES);
        void saveWeatherCache(list as any);
        return {
          weatherCacheList: list as any,
          weatherCache: cache // support legacy single cache
        };
      }),
      addTerrainCache: (cache) => set((state) => {
        // 동일 key 중복 제거 + 기존 캐시 중 isFallback이거나 panoramicAngles가 전부 0인 무효 데이터를 함께 정화
        const filtered = state.terrainCacheList.filter(item => {
          if (item.key === cache.key) return false; // 동일 key 교체
          const d = item.data as TerrainData | null;
          if (!d) return false;
          if (d.isFallback) return false; // fallback 마킹된 데이터 제거
          if (Array.isArray(d.panoramicAngles) && d.panoramicAngles.every(a => a === 0)) return false; // 전부 0인 구형 무효 데이터 제거
          return true;
        });
        // Keep the last 10 items — 그리고 **저장장치에도 씁니다.**
        const list = [cache, ...filtered].slice(0, MAX_CACHE_ENTRIES);
        void saveTerrainCache(list as any);
        return {
          terrainCacheList: list,
          terrainCache: cache // support legacy single cache
        };
      }),
      setLocation: async (loc) => {
        set({ location: loc });
        if (loc) {
          const { longitude } = loc.coords;
          try {
            // 시스템 로컬 타임존 우선 활용 (네트워크 호출 0회)
            const localOffsetHours = -new Date().getTimezoneOffset() / 60;
            const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || `GMT${localOffsetHours >= 0 ? '+' : ''}${localOffsetHours}`;
            const cleanLabel = `${tzName} (GMT${localOffsetHours >= 0 ? '+' : ''}${localOffsetHours})`;
            set({ timezoneOffsetHours: localOffsetHours, timezoneLabel: cleanLabel });
          } catch {
            const solarOffset = Math.floor((longitude + 7.5) / 15);
            set({
              timezoneOffsetHours: solarOffset,
              timezoneLabel: `GMT${solarOffset >= 0 ? '+' : ''}${solarOffset}`
            });
          }
        }
      },
      setUserRotation: (rot) => set({ userRotation: (rot + 360) % 360 }),
      setGyroEnabled: (enabled) => set({ isGyroEnabled: enabled }),
      resetRotation: () => set({ userRotation: 0, isGyroEnabled: false }),
      setErrorMsg: (msg) => set({ errorMsg: msg }),
      addSavedLocation: async (name, latitude, longitude, terrainData) => {
        const isDuplicate = get().savedLocations.some(
          (loc) => Math.abs(loc.latitude - latitude) < 1e-6 && Math.abs(loc.longitude - longitude) < 1e-6
        );

        if (isDuplicate) {
          Alert.alert('Notification', 'This location is already saved.');
          return;
        }

        const newLocation: SavedLocation = {
          id: generateUniqueId(),
          name,
          latitude,
          longitude,
          ...(terrainData ? { terrainData } : {})
        };

        set((state) => ({
          savedLocations: [...state.savedLocations, newLocation]
        }));
      },
      removeSavedLocation: async (id) => {
        set((state) => ({
          savedLocations: state.savedLocations.filter(loc => loc.id !== id)
        }));
      },
      setCurrentUser: async (user) => {
        set({ currentUser: user });
      },
      syncSavedLocations: () => {
        return () => {};
      },
      addMyPhoto: async (
        imageUrl, 
        latitude, 
        longitude, 
        locationName,
        landscapeScore,
        weatherScore,
        weatherInfo,
        simulationSample,
        simulationImageUrl,
        photoId
      ) => {
        const newPhoto: MyPhoto = {
          id: photoId || generateUniqueId(),
          latitude,
          longitude,
          imageUrl,
          localUri: imageUrl,
          timestamp: Date.now(),
          locationName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl,
          simulationLocalUri: simulationImageUrl,
        };

        set((state) => ({
          myPhotos: [newPhoto, ...state.myPhotos],
        }));
      },
      removeMyPhoto: async (id) => {
        if (uploadTimers[id]) {
          clearTimeout(uploadTimers[id]);
          delete uploadTimers[id];
        }

        set((state) => ({
          myPhotos: state.myPhotos.filter((p) => p.id !== id),
          globalPhotos: state.globalPhotos.filter((p) => p.id !== id)
        }));
      },
      syncMyPhotos: () => {
        return () => {};
      },
      uploadAndPostPhoto: async (
        localUri: string, 
        latitude: number, 
        longitude: number, 
        locationName: string,
        landscapeScore?: number,
        weatherScore?: number,
        weatherInfo?: any,
        simulationSample?: any,
        simulationImageUri?: string,
        deviceAzimuth?: number,
        devicePitch?: number
      ): Promise<string> => {
        const finalLocationName = locationName || `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
        const photoId = generateUniqueId();
        const now = Date.now();
        const myPhotoRecord: MyPhoto = {
          id: photoId,
          latitude,
          longitude,
          imageUrl: localUri,
          localUri,
          timestamp: now,
          locationName: finalLocationName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl: simulationImageUri || '',
          simulationLocalUri: simulationImageUri,
          deviceAzimuth,
          devicePitch,
        };

        set((state) => ({
          myPhotos: [myPhotoRecord, ...state.myPhotos.filter(p => p.id !== photoId)]
        }));

        return finalLocationName;
      },
      togglePhotoVisibility: async (photoId: string, isPublic: boolean) => {
        const user = get().currentUser || auth.currentUser;
        // 1. 로컬 상태 갱신
        set((state) => ({
          myPhotos: state.myPhotos.map(p => p.id === photoId ? { ...p, isPublic } : p),
        }));

        // 2. Firestore 동기화
        if (user) {
          try {
            const userPhotoRef = doc(db, `users/${user.uid}/photos`, photoId);
            await updateDoc(userPhotoRef, { isPublic });
          } catch (err) {
            console.warn('[togglePhotoVisibility] Firestore update failed:', err);
          }
        }
      },
      setPhotoFeedback: async (photoId: string, feedback: 'good' | 'bad' | null) => {
        const user = get().currentUser || auth.currentUser;
        set((state) => ({
          myPhotos: state.myPhotos.map(p => p.id === photoId ? { ...p, userFeedback: feedback } : p),
        }));

        if (user) {
          try {
            const userPhotoRef = doc(db, `users/${user.uid}/photos`, photoId);
            await updateDoc(userPhotoRef, { userFeedback: feedback });
          } catch (err) {
            console.warn('[setPhotoFeedback] Firestore update failed:', err);
          }
        }
      },
      setPhotoCompare: async (photoId: string, next: PhotoCompare) => {
        const user = get().currentUser || auth.currentUser;
        const prev = get().myPhotos.find(p => p.id === photoId)?.compare;
        const merged = mergeCompare(prev, next);
        set((state) => ({
          myPhotos: state.myPhotos.map(p => p.id === photoId ? { ...p, compare: merged } : p),
        }));
        if (user) {
          try {
            const userPhotoRef = doc(db, `users/${user.uid}/photos`, photoId);
            await updateDoc(userPhotoRef, { compare: merged });
          } catch (err) {
            console.warn('[setPhotoCompare] Firestore update failed:', err);
          }
        }
      },
      publishGlobalPhoto: async (photoId: string) => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return;

        // 로컬 리스트에서 업로드 완료된 CDN url 정보를 가져옴
        const photo = get().myPhotos.find(p => p.id === photoId);
        if (!photo) return;

        try {
          const ext = photo.imageUrl?.split('?')[0].split('.').pop() || 'jpg';
          const storagePath = `photos/${user.uid}/${photo.id}.${ext}`;
          let simulationStoragePath = '';
          if (photo.simulationImageUrl) {
            simulationStoragePath = `photos/${user.uid}/${photo.id}_sim.jpg`;
          }

          // A. global_photos 에 기재하여 전역 공개
          // 이메일 앞부분을 공개 이름으로 쓰지 않습니다 — 전역 갤러리는 누구나 읽습니다(출시 점검 2026-09-30).
        const userName = user.displayName || 'Anonymous';
          const globalPhoto: GlobalPhoto = {
            id: photo.id,
            latitude: Number(photo.latitude.toFixed(2)),
            longitude: Number(photo.longitude.toFixed(2)),
            imageUrl: photo.imageUrl,
            storagePath,
            timestamp: photo.timestamp,
            locationName: photo.locationName,
            userId: user.uid,
            userName,
            landscapeScore: photo.landscapeScore,
            weatherScore: photo.weatherScore,
            weatherInfo: photo.weatherInfo,
            simulationSample: photo.simulationSample,
            simulationImageUrl: photo.simulationImageUrl,
            simulationStoragePath,
            deviceAzimuth: photo.deviceAzimuth,
            devicePitch: photo.devicePitch
          };

          const cleanedGlobal = Object.entries(globalPhoto).reduce((acc, [key, val]) => {
            if (val !== undefined) acc[key] = val;
            return acc;
          }, {} as any);

          const globalDocRef = doc(db, 'global_photos', photo.id);
          await setDoc(globalDocRef, cleanedGlobal);

          // B. 내 개인 Firestore 사진에서도 scheduledUploadTime을 지움
          const personalDocRef = doc(db, `users/${user.uid}/photos`, photo.id);
          await updateDoc(personalDocRef, {
            scheduledUploadTime: deleteField()
          });

          // C. 로컬 상태에서도 scheduledUploadTime을 제거하여 공개 대기 종료
          set((state) => ({
            myPhotos: state.myPhotos.map(p => 
              p.id === photo.id 
                ? { ...p, scheduledUploadTime: undefined }
                : p
            )
          }));

          delete uploadTimers[photo.id];
          if (__DEV__) console.log(`[Pending Publish] Successfully published global photo ${photo.id}`);
        } catch (err) {
          console.error(`[Pending Publish] Failed to publish global photo ${photo.id}:`, err);
        }
      },
      initializePendingUploads: () => {
        // Instant upload with server-side scheduledUploadTime requires no client timers
      },
      syncGlobalPhotos: () => {
        return () => {};
      },
      removeGlobalPhoto: async (id: string) => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return;
        
        // Find photo metadata to get the storage path
        const photo = get().globalPhotos.find(p => p.id === id);
        
        try {
          // 1. Delete the actual image file from Firebase Storage first
          if (photo && photo.storagePath) {
            const fileRef = ref(storage, photo.storagePath);
            await deleteObject(fileRef);
          }

          // Delete simulation image if it exists
          if (photo && photo.simulationStoragePath) {
            try {
              const simFileRef = ref(storage, photo.simulationStoragePath);
              await deleteObject(simFileRef);
            } catch (simDelErr) {
              console.warn('Failed to delete simulation image from storage:', simDelErr);
            }
          }

          // 2. Delete Firestore document after storage file is successfully deleted
          const docRef = doc(db, 'global_photos', id);
          await deleteDoc(docRef);

          // 3. Delete local user photo document as well to sync
          const myPhotoDocRef = doc(db, `users/${user.uid}/photos`, id);
          await deleteDoc(myPhotoDocRef).catch(e => console.warn('Failed to delete local copy:', e));
        } catch (err) {
          console.warn('Failed to remove global photo:', err);
          Alert.alert('Error', 'Failed to delete photo from storage. Database document preserved.');
        }
      },
      checkPermissions: async () => {
        try {
          const { status: locStatus } = await Location.getForegroundPermissionsAsync();
          const { status: camStatus } = await Camera.getCameraPermissionsAsync();
          const { status: mediaStatus } = await MediaLibrary.getPermissionsAsync(true);
          const { status: micStatus } = await Camera.getMicrophonePermissionsAsync();
          set({ 
            locationPermission: locStatus, 
            cameraPermission: camStatus,
            mediaPermission: mediaStatus,
            microphonePermission: micStatus
          });
        } catch (err) {
          console.warn('Failed to check permissions:', err);
        }
      },
      requestLocationPermission: async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          set({ locationPermission: status });
          if (status === 'granted') {
            set({ errorMsg: null });
            const loc = await Location.getCurrentPositionAsync({});
            get().setHomeCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            await get().setLocation(loc);
            void get().preloadInitialData();
          } else {
            set({ errorMsg: 'Permission to access location was denied' });
          }
        } catch (err) {
          console.warn('Failed to request location permission:', err);
          set({ errorMsg: 'Failed to request location permission' });
        }
      },
      requestCameraPermission: async () => {
        try {
          const { status } = await Camera.requestCameraPermissionsAsync();
          set({ cameraPermission: status });
        } catch (err) {
          console.warn('Failed to request camera permission:', err);
        }
      },
      requestMediaPermission: async () => {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync(true);
          set({ mediaPermission: status });
        } catch (err) {
          console.warn('Failed to request media permission:', err);
        }
      },
      requestMicrophonePermission: async () => {
        try {
          const { status } = await Camera.requestMicrophonePermissionsAsync();
          set({ microphonePermission: status });
        } catch (err) {
          console.warn('Failed to request microphone permission:', err);
        }
      },
      setSimulationLoading: (loading) => set({ isSimulationLoading: loading }),
      setDebugMode: (enabled) => set({ isDebugMode: enabled }),
      setLanguage: (lang) => set({ language: lang }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setStatusBarIcon: (icon) => set({ statusBarIcon: icon }),
      setExpertMode: (on) => set({ expertMode: !!on }),
      setOnboardingSeen: (seen) => set({ onboardingSeen: !!seen }),
      setHomeCoords: (c) => set({ homeCoords: c }),
      addSavedScene: (scene) => {
        const r = addScene(get().savedScenes, scene);
        if (r.ok) set({ savedScenes: r.list });
        return r;
      },
      renameSavedScene: (id, name) => set((st) => ({ savedScenes: renameScene(st.savedScenes, id, name) })),
      removeSavedScene: (id) => set((st) => ({ savedScenes: removeScene(st.savedScenes, id) })),
      restoreSampleScenes: () => set((st) => ({
        savedScenes: mergeSampleScenes(st.savedScenes, st.language),
        sampleScenesSeeded: true,
      })),
      markHintSeen: (key) => set((st) => ({
        seenHints: st.seenHints?.[key] ? st.seenHints : { ...(st.seenHints ?? {}), [key]: true },
      })),
      resetHints: () => set({ seenHints: {} }),
      setNotifPref: (key, value) => set((st) => ({ notifPrefs: { ...DEFAULT_NOTIF_PREFS, ...st.notifPrefs, [key]: value } })),
      setAppReady: (ready) => set({ isAppReady: ready }),
      preloadInitialData: async () => {
        try {
          startupTrace.mark('시작');
          set({ preloadStatus: 'checkingPermissions' });
          await get().checkPermissions();
          startupTrace.mark('권한');
          const locPerm = get().locationPermission;
 
          if (locPerm !== 'granted') {
            set({ isAppReady: true, startupLocationSettled: true });
            return;
          }
 
          set({ preloadStatus: 'locatingPosition' });
          let loc = null;
          try {
            loc = await Location.getLastKnownPositionAsync({});
            if (!loc) {
              const gpsPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
              const timeoutPromise = new Promise<null>((res) => setTimeout(() => res(null), 1500));
              loc = await Promise.race([gpsPromise, timeoutPromise]);
            }
          } catch (e) {
            console.warn('Failed to get location, using default:', e);
          }

          const savedFirst = get().savedLocations?.[0];
          const defaultCoords = savedFirst
            ? { latitude: savedFirst.latitude, longitude: savedFirst.longitude }
            : { latitude: 37.5665, longitude: 126.9780 };
          const lat = loc?.coords.latitude ?? defaultCoords.latitude;
          const lon = loc?.coords.longitude ?? defaultCoords.longitude;
 
          if (loc) {
            get().setHomeCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            await get().setLocation(loc);
          } else {
            await get().setLocation({
              coords: {
                ...defaultCoords,
                altitude: 0,
                accuracy: 0,
                altitudeAccuracy: 0,
                heading: 0,
                speed: 0
              },
              timestamp: Date.now()
            });
          }
          set({ startupLocationSettled: true });
          startupTrace.mark('위치');
 
          const now = new Date();
          // SunCamera 와 **같은 키**를 만들어야 하므로 같은 함수를 씁니다(§59).
          const dateStr = localDateString(now);
 
          /* ── 저장장치에 둔 캐시를 먼저 올립니다 ─────────────────────
           *
           * 이게 먼저여야 **화면이 네트워크를 안 기다립니다.** 예전에는
           * 캐시가 메모리에만 있어서 껐다 켤 때마다 빈손으로 시작했고,
           * 다섯 번을 다 받아 올 때까지 아무것도 못 그렸습니다.
           */
          let diskWeather: any[] = [];
          let diskTerrain: any[] = [];
          let diskRing: any[] = [];
          try {
            const [rawWeather, rawTerrain, rawRing] = await Promise.all([
              loadWeatherCache(), loadTerrainCache(), loadRingCache(),
            ]);
            const isInvalidWeather = (item: any) => {
              const d = item?.data;
              if (!d || !Array.isArray(d) || d.length === 0) return true;
              if (d[0]?.isFallback) return true;
              return false;
            };
            diskWeather = (rawWeather || []).filter(item => !isInvalidWeather(item));
            if (rawWeather && diskWeather.length !== rawWeather.length) {
              void saveWeatherCache(diskWeather as any);
            }
            diskRing = (rawRing || []).filter(item => !isInvalidWeather(item));
            if (rawRing && diskRing.length !== rawRing.length) {
              void saveRingCache(diskRing as any);
            }
            diskTerrain = rawTerrain || [];

            // 날씨 캐시와 고리 캐시를 모두 모듈 캐시(MEM_RING_CACHE)에 채워, 조기 요청도 즉각 캐시 적중하도록 합니다.
            const allCachedRings = [...(diskRing || []), ...(diskWeather || [])];
            if (allCachedRings.length > 0) {
              primeRingCache(allCachedRings as any);
            }
            // 스토어 상태의 weatherCacheList 를 비동기적으로 조회할 수 있도록 fallback finder 등록
            setRingFallbackFinder((la, lo, dStr) => {
              const c = get().weatherCacheList.find(item =>
                item.key.includes(dStr) && sameBucket(item.latitude, item.longitude, la, lo)
              );
              return (c?.data && Array.isArray(c.data) && c.data.length > 0 && !(c.data as any)[0]?.isFallback) ? (c.data as any) : null;
            });
            /* 고리를 남기는 길을 **여기서 꽂습니다.**
             *
             * ⚠ `weather.ts` 가 `persistentCache` 를 직접 부르면 `security.ts` →
             * `expo-constants` 를 타고 들어가, Node 로 도는 판정 하네스가
             * 통째로 죽습니다(실제로 아홉 개가 죽었습니다). 앱 쪽인 여기는
             * expo 를 써도 됩니다.
             */
            // 링은 3 칸만 둡니다(`MAX_RING_ENTRIES`). 그리고 **3 초 모았다 씁니다**: 켜는 동안 같은 링이 날씨 캐시(`w_…`)에도 들어가는데,
            // 그 쌍둥이가 생기면 링 쪽은 쓰지 않습니다(켤 때 같은 키는 날씨가 이기므로 읽을 일도 없음) — 같은 자료를 두 번 암호화해 쓰던 것을 없앱니다.
            setRingPersister((key, la, lo, data) => {
              if ((data as any)?.[0]?.isFallback) return;
              const entry = { key, data, timestamp: Date.now(), latitude: la, longitude: lo } as any;
              const twin = key.startsWith('ring_') ? `w_${key.slice(5)}` : null;
              setTimeout(() => {
                if (twin && get().weatherCacheList.some(w => w.key === twin)) return;
                diskRing = upsertEntry(diskRing as any, entry, MAX_RING_ENTRIES) as any;
                void saveRingCache(diskRing as any);
              }, 3000);
            });
            if (diskWeather.length || diskTerrain.length) {
              set({
                weatherCacheList: diskWeather as any,
                terrainCacheList: diskTerrain as any,
                weatherCache: (diskWeather[0] as any) ?? null,
                terrainCache: (diskTerrain[0] as any) ?? null,
                isCacheHydrated: true,
              });
            } else {
              set({ isCacheHydrated: true });
            }
            startupTrace.mark('저장 캐시 읽기');
            if (__DEV__) {
              console.log(`[Preload] 저장장치 캐시 — 날씨 ${diskWeather.length}칸 · 지형 ${diskTerrain.length}칸 · 고리 ${diskRing.length}칸`);
            }
          } catch (e) {
            console.warn('[Preload] 저장장치 캐시를 못 올렸습니다:', e);
            set({ isCacheHydrated: true });
          }

          /* ── 지형은 캐시가 있으면 **요청 자체를 건너뜁니다** ────────── */
          const mustFetchTerrain = needTerrainFetch(diskTerrain as any, lat, lon);

          if (__DEV__) {
            console.log(`[Preload] Fetching weather/ring for lat=${lat}, lon=${lon}`
              + ` · 지형 ${mustFetchTerrain ? '받음' : '캐시로 건너뜀'}`);
          }
          set({ preloadStatus: 'analyzingData' });

          /* ── 카나리아: 1개 점만 보고 큰 요청을 건너뜁니다 ───────────── */
          const cachedWeather = findEntry(diskWeather as any, lat, lon, dateStr);
          const storedCanary = (cachedWeather as any)?.canaryPrint as string | undefined;

          let canarySeries: number[] | null = null;
          let skipWeather = false;

          if (storedCanary) {
            canarySeries = await fetchWeatherCanary(lat, lon, now).catch(() => null);
            // 카나리아 조회가 실패(429 또는 오프라인)해도 기존 캐시가 유효하면 안전하게 캐시를 유지하여 폭주를 막습니다.
            if (canarySeries === null) {
              skipWeather = true;
            } else if (canaryIsUsable(canarySeries)) {
              skipWeather = canarySaysSkip(storedCanary, canarySeries);
            } else {
              skipWeather = true;
            }
            if (__DEV__) {
              console.log(`[Preload] 카나리아 — ${
                canarySeries === null ? '실패 → 기존 캐시 유지 (네트워크 0건)'
                : !canaryIsUsable(canarySeries) ? '평평함 → 기존 캐시 유지 (네트워크 0건)'
                : skipWeather ? '그대로 → **큰 요청 건너뜀**' : '모델 갱신 감지 → 전체 갱신'}`);
            }
          } else if (cachedWeather && Array.isArray((cachedWeather as any).data) && (cachedWeather as any).data.length > 0 && !(cachedWeather as any).data[0]?.isFallback) {
            // 저장된 지문이 없더라도 디스크에 유효한 데이터가 있으면 360° 대용량 요청을 생략하고 캐시를 그대로 씁니다!
            skipWeather = true;
            if (__DEV__) console.log('[Preload] 기존 유효 날씨 캐시 발견 — 대용량 요청 생략');
            // 백그라운드에서 1개 점 카나리아 지문만 가볍게 수신하여 향후 검증용으로 등록
            fetchWeatherCanary(lat, lon, now)
              .then(series => {
                if (series && canaryIsUsable(series)) {
                  (cachedWeather as any).canaryPrint = canaryPrint(series);
                  void saveWeatherCache(diskWeather as any);
                }
              })
              .catch(() => {});
          }

          if (skipWeather) {
            primeRingCache(diskRing as any);
            if (__DEV__) console.log(`[Preload] 고리 ${diskRing.length}칸을 캐시에 채움 — 날씨 네트워크 요청 0건`);
          }

          await Promise.all([
            // 카나리아가 스킵이 아닐 때만 360° 고리 날씨를 1회 수신
            (!skipWeather)
              ? (async () => {
                  try {
                    const ringData = await fetchDayWeatherRing(lat, lon, now, false).catch(() => null);
                    if (ringData && ringData.length > 0 && !(ringData as any)[0]?.isFallback) {
                      const fetchedCanary = canarySeries ?? await fetchWeatherCanary(lat, lon, now).catch(() => null);
                      get().addWeatherCache({
                        key: weatherCacheKey(lat, lon, dateStr),
                        data: ringData,
                        timestamp: Date.now(),
                        latitude: lat,
                        longitude: lon,
                        canaryPrint: fetchedCanary ? canaryPrint(fetchedCanary) : undefined,
                      } as any);
                    }
                  } catch (err: any) {
                    console.warn('Preload Ring Weather failed:', err);
                  }
                })()
              : Promise.resolve(),
            mustFetchTerrain
              ? fetchTerrainProfile(lat, lon, 0, 360).then(terrainData => {
                  if (terrainData && !terrainData.isFallback) {
                    get().addTerrainCache({
                      key: terrainCacheKey(lat, lon),
                      data: terrainData,
                      timestamp: Date.now(),
                      latitude: lat,
                      longitude: lon
                    });
                  }
                }).catch((err: any) => console.warn('Preload Terrain failed:', err))
              : Promise.resolve()
          ]);
 
          startupTrace.mark('날씨·지형');
          let initialTab: 'sky' | 'map' | 'log' = 'sky';
          try {
            const netState = await NetInfo.fetch();
            const isConnected = netState.isConnected && netState.isInternetReachable !== false;
            if (isConnected) {
              initialTab = 'sky';
            }
          } catch (netErr) {
            console.warn('[Preload] Failed to check network state:', netErr);
          }

          set({ initialTab, preloadStatus: 'simulationReady' });
          startupTrace.mark('준비 끝');
          if (__DEV__) {
            console.log(`[Preload] Completed successfully. Initial tab: ${initialTab}`);
          }
        } catch (err) {
          console.warn('[Preload] Error during initialization preloading:', err);
        } finally {
          if (!get().startupLocationSettled) set({ startupLocationSettled: true });
          // 3D 씬 렌더 완료 트리거의 안전망 (2초 후 강제 완료)
          setTimeout(() => {
            if (!get().isAppReady) {
              set({ isAppReady: true });
            }
          }, 2000);
        }
      },
    }),
    {
      name: 'solar-path-storage',
      // 저장은 모았다가 한 번에, 바뀐 게 없으면 아예 안 씁니다(`debouncedPersist.ts`). 앱이 뒤로 갈 때 바로 씁니다.
      storage: persistStorage,
      // 저장소에서 읽은 장면은 한 번 더 정리합니다(파일이 깨지거나 앱 버전이 바뀌어도 화면이 망가지지 않게). 나머지는 기본 병합과 같습니다.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CelestialState>;
        return { ...current, ...p, savedScenes: sanitizeScenes(p.savedScenes) };
      },
      partialize: (state) => ({ 
        location: state.location,
        timezoneOffsetHours: state.timezoneOffsetHours,
        timezoneLabel: state.timezoneLabel,
        savedLocations: state.savedLocations,
        myPhotos: state.myPhotos,
        language: state.language,
        themeMode: state.themeMode,
        statusBarIcon: state.statusBarIcon,
        notifPrefs: state.notifPrefs,
        expertMode: state.expertMode,
        onboardingSeen: state.onboardingSeen,
        homeCoords: state.homeCoords,
        savedScenes: state.savedScenes,
        sampleScenesSeeded: state.sampleScenesSeeded,
        seenHints: state.seenHints,
        hiddenPhotoIds: state.hiddenPhotoIds,
        blockedUserIds: state.blockedUserIds,
      }),
    }
  )
);
