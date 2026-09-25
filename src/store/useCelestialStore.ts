import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadWeatherCache, loadTerrainCache, loadRingCache,
  saveWeatherCache, saveTerrainCache, saveRingCache,
} from '../utils/persistentCache';
import {
  weatherCacheKey, terrainCacheKey, needTerrainFetch, upsertEntry,
  findEntry, fingerprint, MAX_CACHE_ENTRIES,
  canaryPrint, canarySaysSkip, canaryIsUsable, MAX_RING_ENTRIES,
} from '../utils/cachePolicy';
import { auth, db, storage } from '../config/firebase';
import { doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch, updateDoc, deleteField } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { User } from 'firebase/auth';
import { TerrainData, fetchSunsetWeather, fetchTerrainProfile, fetchDayWeatherRing, fetchWeatherCanary, primeRingCache, setRingPersister } from '../utils/weather';
import SunCalc from 'suncalc';
import { encryptData, decryptData } from '../utils/security';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { localDateString } from '../utils/localDate';

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
   * ⚠ `data` 로 견주면 안 됩니다 — 거기엔 위성 보정이 발려 있고
   * (`applyBiasToPath`), 보정 세기가 관측 시각을 따라 계속 변해서 예보가
   * 그대로여도 늘 "바뀜" 이 나옵니다(`cachePolicy.ts` 카나리아 절).
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

interface CelestialState {
  currentTime: Date;
  location: Location.LocationObject | null;
  timezoneOffsetHours: number;
  timezoneLabel: string;
  isTimeMachineEnabled: boolean;
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
  locationPermission: string | null;
  cameraPermission: string | null;
  mediaPermission: string | null;
  microphonePermission: string | null;
  isSimulationLoading: boolean;
  isDebugMode: boolean;
  language: 'ko' | 'en' | 'ja';
  isAppReady: boolean;
  preloadStatus: string;
  /** 프리로드 후 처음 열 탭. 새 IA 기준: 'sky' | 'map' | 'log' */
  initialTab: 'sky' | 'map' | 'log';
  selectedCategory: 'sun' | 'cloud' | 'star' | 'sim3d' | 'gallery';
  
  // Actions
  setSelectedCategory: (category: 'sun' | 'cloud' | 'star' | 'sim3d' | 'gallery') => void;
  setCurrentTime: (time: Date) => void;
  setLocation: (loc: Location.LocationObject | null) => void;
  setTimeMachineEnabled: (enabled: boolean) => void;
  setErrorMsg: (msg: string | null) => void;
  updateTime: () => void;
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
  setAppReady: (ready: boolean) => void;
  preloadInitialData: () => Promise<void>;
  initializePendingUploads: () => void;
  currentSimulationUri: string | null;
  setCurrentSimulationUri: (uri: string | null) => void;
  isGestureBlocked: boolean;
  setGestureBlocked: (blocked: boolean) => void;
  teleportTarget: TeleportTarget | null;
  setTeleportTarget: (target: Omit<TeleportTarget, 'nonce'>) => void;
}

export interface TeleportTarget {
  cameraAz?: number;
  cameraElev?: number;
  fov?: number;
  nonce: number;
}

export const useCelestialStore = create<CelestialState>()(
  persist(
    (set, get) => ({
      currentTime: new Date(),
      location: null,
      timezoneOffsetHours: -new Date().getTimezoneOffset() / 60,
      timezoneLabel: (() => {
        const offset = -new Date().getTimezoneOffset() / 60;
        if (offset === 0) return 'GMT';
        return `GMT${offset > 0 ? '+' : ''}${offset}`;
      })(),
      isTimeMachineEnabled: false,
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
      locationPermission: null,
      cameraPermission: 'undetermined',
      mediaPermission: 'undetermined',
      microphonePermission: 'undetermined',
      isSimulationLoading: false,
      isDebugMode: false,
      language: 'ko',
      isAppReady: false,
      preloadStatus: 'initializingApp',
      initialTab: 'sky',
      selectedCategory: 'sun',
      currentSimulationUri: null,
      isGestureBlocked: false,
      teleportTarget: null,

      setSelectedCategory: (category) => set({ selectedCategory: category }),
      setCurrentSimulationUri: (uri) => set({ currentSimulationUri: uri }),
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
        const list = upsertEntry(state.weatherCacheList as any, cache as any, MAX_CACHE_ENTRIES);
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
      setCurrentTime: (time) => set({ currentTime: time }),
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
      setTimeMachineEnabled: (enabled) => set((state) => ({ 
        isTimeMachineEnabled: enabled,
        currentTime: enabled ? state.currentTime : new Date() 
      })),
      setErrorMsg: (msg) => set({ errorMsg: msg }),
      updateTime: () => set((state) => {
        if (state.isTimeMachineEnabled) return state;
        return { currentTime: new Date() };
      }),
      addSavedLocation: async (name, latitude, longitude, terrainData) => {
        const isDuplicate = get().savedLocations.some(
          (loc) => Math.abs(loc.latitude - latitude) < 1e-6 && Math.abs(loc.longitude - longitude) < 1e-6
        );

        if (isDuplicate) {
          Alert.alert('Notification', 'This location is already saved.');
          return;
        }

        const user = get().currentUser || auth.currentUser;
        const newLocation: SavedLocation = {
          id: generateUniqueId(),
          name,
          latitude,
          longitude,
          ...(terrainData ? { terrainData } : {})
        };

        if (user) {
          try {
            const docRef = doc(db, `users/${user.uid}/locations`, newLocation.id);
            await setDoc(docRef, newLocation);
          } catch (err) {
            console.warn('Failed to save location to Firestore:', err);
          }
        } else {
          set((state) => ({
            savedLocations: [...state.savedLocations, newLocation]
          }));
        }
      },
      removeSavedLocation: async (id) => {
        const user = get().currentUser || auth.currentUser;
        if (user) {
          try {
            const docRef = doc(db, `users/${user.uid}/locations`, id);
            await deleteDoc(docRef);
          } catch (err) {
            console.warn('Failed to remove location from Firestore:', err);
          }
        } else {
          set((state) => ({
            savedLocations: state.savedLocations.filter(loc => loc.id !== id)
          }));
        }
      },
      setCurrentUser: async (user) => {
        set({ currentUser: user });
        if (user) {
          // 1. Merge locations
          const localLocations = get().savedLocations;
          if (localLocations.length > 0) {
            try {
              const batch = writeBatch(db);
              localLocations.forEach((loc) => {
                const docRef = doc(db, `users/${user.uid}/locations`, loc.id);
                batch.set(docRef, {
                  id: loc.id,
                  name: loc.name,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                });
              });
              await batch.commit();
              console.log('Successfully merged local saved locations to Firestore');
            } catch (err) {
              console.warn('Failed to merge local locations to Firestore:', err);
            }
          }

          // 2. Merge photos
          const localPhotos = get().myPhotos;
          if (localPhotos.length > 0) {
            try {
              const batch = writeBatch(db);
              localPhotos.forEach((photo) => {
                const docRef = doc(db, `users/${user.uid}/photos`, photo.id);
                batch.set(docRef, photo);
              });
              await batch.commit();
              console.log('Successfully merged local photos to Firestore');
            } catch (err) {
              console.warn('Failed to merge local photos to Firestore:', err);
            }
          }
        }
      },
      syncSavedLocations: () => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return () => {};
        
        const locationsRef = collection(db, `users/${user.uid}/locations`);
        const unsubscribe = onSnapshot(
          locationsRef,
          (snapshot) => {
            const locationsList: SavedLocation[] = [];
            snapshot.forEach((doc) => {
              locationsList.push(doc.data() as SavedLocation);
            });
            set({ savedLocations: locationsList });
          },
          (err) => {
            console.warn('Failed to sync saved locations:', err);
          }
        );
        return unsubscribe;
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
        const user = get().currentUser || auth.currentUser;
        const newPhoto: MyPhoto = {
          id: photoId || generateUniqueId(),
          latitude,
          longitude,
          imageUrl,
          timestamp: Date.now(),
          locationName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl,
        };

        if (user) {
          try {
            const docRef = doc(db, `users/${user.uid}/photos`, newPhoto.id);
            await setDoc(docRef, newPhoto);
            // Firestore 저장 성공 후 로컬 상태도 즉시 반영 (syncMyPhotos 이전에도 UI 반응)
            set((state) => ({
              myPhotos: [newPhoto, ...state.myPhotos],
            }));
          } catch (err) {
            console.warn('Failed to save photo to Firestore:', err);
          }
        } else {
          set((state) => ({
            myPhotos: [newPhoto, ...state.myPhotos]
          }));
        }
      },
      removeMyPhoto: async (id) => {
        if (uploadTimers[id]) {
          clearTimeout(uploadTimers[id]);
          delete uploadTimers[id];
        }

        const user = get().currentUser || auth.currentUser;
        set((state) => ({
          myPhotos: state.myPhotos.filter((p) => p.id !== id),
          globalPhotos: state.globalPhotos.filter((p) => p.id !== id)
        }));

        if (user) {
          try {
            // 1. 내 개인 Firestore 문서 삭제
            const docRef = doc(db, `users/${user.uid}/photos`, id);
            await deleteDoc(docRef);

            // 2. Storage 및 전역 Firestore 연쇄 삭제
            await get().removeGlobalPhoto(id);
          } catch (err) {
            console.warn('Failed to remove photo from Firestore/Storage:', err);
          }
        }
      },
      syncMyPhotos: () => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return () => {};
        
        const photosRef = collection(db, `users/${user.uid}/photos`);
        const unsubscribe = onSnapshot(
          photosRef,
          (snapshot) => {
            const photosList: MyPhoto[] = [];
            snapshot.forEach((doc) => {
              photosList.push(doc.data() as MyPhoto);
            });
            // Sort by newest timestamp
            photosList.sort((a, b) => b.timestamp - a.timestamp);
            
            // 로컬에만 떠 있는 isPending: true인 항목들이 Firestore 동기화 스냅샷 갱신 시 날아가지 않도록 보존합니다.
            set((state) => {
              const localPending = state.myPhotos.filter(p => p.isPending);
              // Firestore 동기화 목록에 이미 들어온 건 대기 큐에서 제외
              const filteredPending = localPending.filter(lp => !photosList.some(p => p.id === lp.id));
              const merged = [...filteredPending, ...photosList];
              merged.sort((a, b) => b.timestamp - a.timestamp);
              return { myPhotos: merged };
            });
          },
          (err) => {
            console.warn('Failed to sync my photos:', err);
          }
        );
        return unsubscribe;
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
        const user = get().currentUser || auth.currentUser;
        if (!user) throw new Error('User must be logged in to upload photos');

        let simpleAddress = '';
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (apiKey) {
          try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}&language=ko`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.status === 'OK' && data.results && data.results.length > 0) {
              const components = data.results[0].address_components;
              let sublocality2 = '';
              let sublocality1 = '';
              let locality = '';
              let adminArea1 = '';
              for (const comp of components) {
                const types = comp.types;
                if (types.includes('sublocality_level_2')) {
                  sublocality2 = comp.long_name;
                } else if (types.includes('sublocality_level_1')) {
                  sublocality1 = comp.long_name;
                } else if (types.includes('locality')) {
                  locality = comp.long_name;
                } else if (types.includes('administrative_area_level_1')) {
                  adminArea1 = comp.long_name;
                }
              }
              if (sublocality2) {
                simpleAddress = sublocality1 ? `${sublocality1} ${sublocality2}` : sublocality2;
              } else if (sublocality1) {
                simpleAddress = locality ? `${locality} ${sublocality1}` : sublocality1;
              } else if (locality) {
                simpleAddress = locality;
              } else if (adminArea1) {
                simpleAddress = adminArea1;
              }
            }
          } catch (geoErr) {
            console.warn('Geocoding failed, falling back to coordinates:', geoErr);
          }
        }
 
        const finalLocationName = simpleAddress || locationName || `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
        const photoId = generateUniqueId();
        const now = Date.now();
        const scheduledTime = now + 60 * 60 * 1000; // 서버 기준 1시간 뒤 전역 공개

        // 1. Firebase Storage에 즉시 파일 업로드
        const ext = localUri?.split('.').pop() || 'jpg';
        const storagePath = `photos/${user.uid}/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);

        let imageUrl = localUri;
        try {
          const base64Data = await FileSystem.readAsStringAsync(localUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const contentType = `image/${ext === 'png' ? 'png' : 'jpeg'}`;
          await uploadString(storageRef, base64Data, 'base64', { contentType });
          imageUrl = await getDownloadURL(storageRef);
        } catch (uploadErr) {
          console.warn('[Photo Upload] Main image upload failed, using local URI:', uploadErr);
        }

        let simulationImageUrl = simulationImageUri || '';
        let simulationStoragePath = '';
        if (simulationImageUri) {
          try {
            simulationStoragePath = `photos/${user.uid}/${photoId}_sim.jpg`;
            const simStorageRef = ref(storage, simulationStoragePath);
            let simBase64 = '';
            if (simulationImageUri.startsWith('data:')) {
              simBase64 = simulationImageUri.split(';base64,')[1];
            } else {
              simBase64 = await FileSystem.readAsStringAsync(simulationImageUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            }
            await uploadString(simStorageRef, simBase64, 'base64', { contentType: 'image/jpeg' });
            simulationImageUrl = await getDownloadURL(simStorageRef);
          } catch (simUploadErr) {
            console.warn('[Photo Upload] Simulation image upload failed:', simUploadErr);
          }
        }

        const userName = user.displayName || (user.email ? user.email.split('@')[0] : 'Anonymous');

        // 2. 개인 Firestore 문서 생성
        const myPhotoRecord: MyPhoto = {
          id: photoId,
          latitude,
          longitude,
          imageUrl,
          timestamp: now,
          locationName: finalLocationName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl,
          scheduledUploadTime: scheduledTime,
          deviceAzimuth,
          devicePitch
        };

        const cleanedMyRecord = sanitizeFirestoreData(myPhotoRecord);
        const personalDocRef = doc(db, `users/${user.uid}/photos`, photoId);
        await setDoc(personalDocRef, cleanedMyRecord);

        // 3. 전역 global_photos 문서 즉시 기록 (scheduledUploadTime 보존)
        const globalPhotoRecord: GlobalPhoto = {
          id: photoId,
          latitude: Number(latitude.toFixed(2)),
          longitude: Number(longitude.toFixed(2)),
          imageUrl,
          storagePath,
          timestamp: now,
          locationName: finalLocationName,
          userId: user.uid,
          userName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl,
          simulationStoragePath,
          scheduledUploadTime: scheduledTime,
          deviceAzimuth,
          devicePitch
        };

        const cleanedGlobalRecord = sanitizeFirestoreData(globalPhotoRecord);
        const globalDocRef = doc(db, 'global_photos', photoId);
        await setDoc(globalDocRef, cleanedGlobalRecord);

        // 4. 로컬 상태 즉시 추가
        set((state) => ({
          myPhotos: [myPhotoRecord, ...state.myPhotos.filter(p => p.id !== photoId)]
        }));

        if (__DEV__) {
          console.log(`[Photo Upload] Successfully uploaded photo ${photoId} to Storage & Firestore. Scheduled reveal at ${new Date(scheduledTime).toISOString()}`);
        }

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
          const userName = user.displayName || (user.email ? user.email.split('@')[0] : 'Anonymous');
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
        const photosRef = collection(db, 'global_photos');
        const unsubscribe = onSnapshot(
          photosRef,
          (snapshot) => {
            const now = Date.now();
            const photosList: GlobalPhoto[] = [];
            snapshot.forEach((doc) => {
              const data = doc.data() as GlobalPhoto;
              // scheduledUploadTime이 없거나, 이미 서버 시각 기준 1시간이 경과한 것만 전역 사진으로 채택
              if (!data.scheduledUploadTime || data.scheduledUploadTime <= now) {
                photosList.push(data);
              }
            });
            // Sort by newest timestamp
            photosList.sort((a, b) => b.timestamp - a.timestamp);
            set({ globalPhotos: photosList });
          },
          (err) => {
            console.warn('Failed to sync global photos:', err);
          }
        );
        return unsubscribe;
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
          const { status: mediaStatus } = await MediaLibrary.getPermissionsAsync();
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
            await get().setLocation(loc);
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
          const { status } = await MediaLibrary.requestPermissionsAsync();
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
      setAppReady: (ready) => set({ isAppReady: ready }),
      preloadInitialData: async () => {
        try {
          set({ preloadStatus: 'checkingPermissions' });
          await get().checkPermissions();
          const locPerm = get().locationPermission;
 
          if (locPerm !== 'granted') {
            set({ isAppReady: true });
            return;
          }
 
          set({ preloadStatus: 'locatingPosition' });
          let loc = null;
          try {
            loc = await Location.getLastKnownPositionAsync({});
            if (!loc) {
              loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            }
          } catch (e) {
            console.warn('Failed to get location, using default:', e);
          }
 
          const defaultCoords = { latitude: 37.5665, longitude: 126.9780 };
          const lat = loc?.coords.latitude ?? defaultCoords.latitude;
          const lon = loc?.coords.longitude ?? defaultCoords.longitude;
 
          if (loc) {
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
 
          const now = new Date();
          const times = SunCalc.getTimes(now, lat, lon);
          let targetEvent = times.sunset;
          let eventType = 'Sunset';
          if (now.getTime() > times.sunset.getTime()) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            targetEvent = SunCalc.getTimes(tomorrow, lat, lon).sunrise;
            eventType = 'Sunrise';
          } else if (now.getTime() < times.sunrise.getTime()) {
            targetEvent = times.sunrise;
            eventType = 'Sunrise';
          }
 
          const pos = SunCalc.getPosition(targetEvent, lat, lon);
          const az = (pos.azimuth * 180 / Math.PI) + 180;
 
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
            [diskWeather, diskTerrain, diskRing] = await Promise.all([
              loadWeatherCache(), loadTerrainCache(), loadRingCache(),
            ]);
            // 고리는 상태가 아니라 **모듈 캐시**로 갑니다 — 부르는 쪽
            // (`IsolineMap`·`skyTimeline`)을 안 고치려고요. 다만 채우는 것은
            // 카나리아가 "그대로" 라고 한 뒤입니다(아래).
            /* 고리를 남기는 길을 **여기서 꽂습니다.**
             *
             * ⚠ `weather.ts` 가 `persistentCache` 를 직접 부르면 `security.ts` →
             * `expo-constants` 를 타고 들어가, Node 로 도는 판정 하네스가
             * 통째로 죽습니다(실제로 아홉 개가 죽었습니다). 앱 쪽인 여기는
             * expo 를 써도 됩니다.
             */
            setRingPersister((key, la, lo, data) => {
              diskRing = upsertEntry(
                diskRing as any,
                { key, data, timestamp: Date.now(), latitude: la, longitude: lo } as any,
                MAX_RING_ENTRIES,
              ) as any;
              void saveRingCache(diskRing as any);
            });
            if (diskWeather.length || diskTerrain.length) {
              set({
                weatherCacheList: diskWeather as any,
                terrainCacheList: diskTerrain as any,
                weatherCache: (diskWeather[0] as any) ?? null,
                terrainCache: (diskTerrain[0] as any) ?? null,
              });
            }
            if (__DEV__) {
              console.log(`[Preload] 저장장치 캐시 — 날씨 ${diskWeather.length}칸 · 지형 ${diskTerrain.length}칸 · 고리 ${diskRing.length}칸`);
            }
          } catch (e) {
            console.warn('[Preload] 저장장치 캐시를 못 올렸습니다:', e);
          }

          /* ── 지형은 캐시가 있으면 **요청 자체를 건너뜁니다** ──────────
           *
           * ⚠ 나이를 안 봅니다. 산은 안 움직입니다. 여기에 만료를 넣으면
           * 아무 근거 없이 요청만 늘어납니다(`cachePolicy.needTerrainFetch`).
           */
          const mustFetchTerrain = needTerrainFetch(diskTerrain as any, lat, lon);

          if (__DEV__) {
            console.log(`[Preload] Fetching weather/ring for lat=${lat}, lon=${lon}`
              + ` · 지형 ${mustFetchTerrain ? '받음' : '캐시로 건너뜀'}`);
          }
          set({ preloadStatus: 'analyzingData' });

          /* ── 카나리아: 한 점만 보고 큰 요청을 건너뜁니다 ─────────────
           *
           * 35점은 같은 모델 런에서 옵니다. 런은 격자 전체가 한꺼번에
           * 갈리므로, 관측점이 안 갈렸으면 나머지도 안 갈린 것입니다 —
           * 점들이 닮아서가 아니라 **원인(런)을 공유**해서입니다.
           * 실측 7/7 로 확인했습니다(`tools/weather-truth/measure-canary.js`).
           *
           * ⚠ 건너뛰기가 **의심스러운 갈래는 전부 "그냥 다 받음"** 으로
           * 떨어집니다 — 저장된 지문이 없거나, 카나리아가 실패했거나,
           * 그날 값이 평평해서 못 믿을 때. 여기서 건너뛰는 쪽으로 기울면
           * 화면이 옛 하늘을 그립니다.
           */
          const cachedWeather = findEntry(diskWeather as any, lat, lon, dateStr);
          const cachedPrint = cachedWeather ? fingerprint(cachedWeather.data) : null;

          /* ⚠ 카나리아는 **늘** 받습니다. 저장된 지문이 있을 때만 받으면
           *    지문이 영영 안 생겨 교착에 빠집니다 — 첫 실행에 지문이 없고,
           *    지문이 없으니 카나리아를 안 받고, 그래서 지문이 또 안 생깁니다.
           *    한 점·한 변수라 본 요청의 약 1/300 입니다.
           */
          const storedCanary = (cachedWeather as any)?.canaryPrint as string | undefined;

          /* ⚠ 카나리아를 `await` 로 먼저 기다리면 **고리와 지형까지 붙잡습니다.**
           *    §68 에서 왕복 한 번이 비싸다는 걸 쟀으므로, 카나리아에 매달리는
           *    것은 큰 날씨 요청 하나뿐이고 나머지는 곧바로 나갑니다.
           */
          let canarySeries: number[] | null = null;
          const weatherChain = fetchWeatherCanary(lat, lon, targetEvent)
            .catch(() => null)
            .then(series => {
              canarySeries = series;
              const skip = canaryIsUsable(series) && canarySaysSkip(storedCanary, series);
              if (__DEV__) {
                console.log(`[Preload] 카나리아 — ${
                  series === null ? '실패 → 그냥 다 받음'
                  : !canaryIsUsable(series) ? '평평해서 못 믿음 → 그냥 다 받음'
                  : !storedCanary ? '저장된 지문 없음 → 다 받고 지문을 남김'
                  : skip ? '그대로 → **큰 요청 건너뜀**' : '갈림 → 다 받음'}`);
              }
              /* ⚠ **고리도 같은 카나리아에 물립니다.** 고리가 한 칸 139KB 로
               *    가장 큰데, 예전에는 카나리아와 무관하게 **늘 다시 받았습니다**
               *    — 10분 뒤에 열어도요. 런이 그대로면 디스크에 둔 고리를 모듈
               *    캐시에 채워, 부르는 쪽이 평소처럼 불러도 네트워크가 안 나갑니다.
               *
               *    ⚠ 채우는 것은 **카나리아가 "그대로" 라고 할 때만**입니다.
               *    모듈 고리 캐시에는 나이 검사가 없어서, 아무 때나 채우면 새
               *    런이 나온 뒤에도 옛 고리를 계속 돌려줍니다.
               */
              if (skip) {
                primeRingCache(diskRing as any);
                if (__DEV__) console.log(`[Preload] 고리 ${diskRing.length}칸을 캐시에 채움 — 고리도 안 받습니다`);
              }
              return skip ? null : fetchSunsetWeather(lat, lon, az, false, targetEvent);
            });

          await Promise.all([
            weatherChain.then(weatherData => {
              if (!weatherData) return;
              // 값이 그대로면 다시 그릴 것도, 다시 쓸 것도 없습니다.
              if (cachedPrint && fingerprint(weatherData) === cachedPrint) {
                if (__DEV__) console.log('[Preload] 날씨가 캐시와 같습니다 — 상태를 안 건드립니다');
                return;
              }
              get().addWeatherCache({
                key: weatherCacheKey(lat, lon, dateStr),
                data: weatherData,
                timestamp: Date.now(),
                latitude: lat,
                longitude: lon,
                /**
                 * ⚠ **보정 전 원본**의 지문입니다. `data` 는 위성 보정이 발린
                 * 뒤라(`applyBiasToPath` 가 제자리에서 덮어씀) 그걸로 견주면
                 * 예보가 그대로여도 늘 "바뀜" 이 나와 카나리아가 영영 일을
                 * 못 합니다.
                 */
                canaryPrint: canarySeries ? canaryPrint(canarySeries) : undefined,
              } as any);
            }).catch((err: any) => console.warn('Preload Weather failed:', err)),
            // ⚠ 카나리아 뒤에 부릅니다. 채우기(`primeRingCache`)가 먼저 끝나야
            //   이 호출이 모듈 캐시에 맞습니다 — 앞서 부르면 채우기와 경주가
            //   되어 그대로인데도 받아 버립니다.
            // ⚠ `catch` 를 **먼저** 답니다. 이걸 안 달면 일몰 날씨가 실패했을 때
            //   사슬이 거부되어 **고리를 아예 안 받습니다** — 게다가 로그에는
            //   "Ring Weather failed" 가 찍혀 받아 보고 실패한 것처럼 보입니다.
            //   카나리아 판정만 기다리면 되고, 일몰 날씨의 성패는 상관없습니다.
            weatherChain
              .catch(() => null)
              .then(() => fetchDayWeatherRing(lat, lon, targetEvent))
              .catch((err: any) => console.warn('Preload Ring Weather failed:', err)),
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
          if (__DEV__) {
            console.log(`[Preload] Completed successfully. Initial tab: ${initialTab}`);
          }
        } catch (err) {
          console.warn('[Preload] Error during initialization preloading:', err);
        } finally {
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
      storage: createJSONStorage(() => ({
        getItem: async (name) => {
          const value = await AsyncStorage.getItem(name);
          if (!value) return null;
          try {
            return decryptData(value);
          } catch (e) {
            console.warn('Failed to decrypt storage data:', e);
            return value;
          }
        },
        setItem: async (name, value) => {
          try {
            const encrypted = encryptData(value);
            await AsyncStorage.setItem(name, encrypted);
          } catch (e) {
            console.warn('Failed to encrypt storage data:', e);
            await AsyncStorage.setItem(name, value);
          }
        },
        removeItem: async (name) => {
          await AsyncStorage.removeItem(name);
        }
      })),
      partialize: (state) => ({ 
        location: state.location,
        timezoneOffsetHours: state.timezoneOffsetHours,
        timezoneLabel: state.timezoneLabel,
        savedLocations: state.savedLocations,
        myPhotos: state.myPhotos,
        language: state.language,
      }),
    }
  )
);
