import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, storage } from '../config/firebase';
import { doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { User } from 'firebase/auth';
import { TerrainData, fetchSunsetWeather, fetchTerrainProfile } from '../utils/weather';
import SunCalc from 'suncalc';
import { encryptData, decryptData } from '../utils/security';
import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';

const uploadTimers: { [photoId: string]: any } = {};

const generateUniqueId = () => {
  return Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
};

export interface WeatherCacheItem {
  key: string;
  data: any[];
  timestamp: number;
  latitude: number;
  longitude: number;
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
  initialTab: 'tracker' | 'sim' | 'gallery';
  
  // Actions
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
  triggerActualUpload: (photo: MyPhoto) => Promise<void>;
  currentSimulationUri: string | null;
  setCurrentSimulationUri: (uri: string | null) => void;
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
      initialTab: 'tracker',
      currentSimulationUri: null,

      setCurrentSimulationUri: (uri) => set({ currentSimulationUri: uri }),
      setWeatherCache: (cache) => set({ weatherCache: cache }),
      setTerrainCache: (cache) => set({ terrainCache: cache }),
      addWeatherCache: (cache) => set((state) => {
        // Filter out any existing item with the exact same key to prevent duplicates
        const filtered = state.weatherCacheList.filter(item => item.key !== cache.key);
        // Keep the last 10 items
        return {
          weatherCacheList: [cache, ...filtered].slice(0, 10),
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
        // Keep the last 10 items
        return {
          terrainCacheList: [cache, ...filtered].slice(0, 10),
          terrainCache: cache // support legacy single cache
        };
      }),
      setCurrentTime: (time) => set({ currentTime: time }),
      setLocation: async (loc) => {
        set({ location: loc });
        if (loc) {
          const { latitude, longitude } = loc.coords;
          try {
            const response = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&timezone=auto`
            );
            const data = await response.json();
            if (data && typeof data.utc_offset_seconds === 'number') {
              const offsetHours = data.utc_offset_seconds / 3600;
              const tzName = data.timezone || `GMT${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
              const cleanLabel = `${tzName} (GMT${offsetHours >= 0 ? '+' : ''}${offsetHours})`;
              set({ timezoneOffsetHours: offsetHours, timezoneLabel: cleanLabel });
            } else {
              const solarOffset = Math.floor((longitude + 7.5) / 15);
              set({
                timezoneOffsetHours: solarOffset,
                timezoneLabel: `GMT${solarOffset >= 0 ? '+' : ''}${solarOffset}`
              });
            }
          } catch (error) {
            console.warn('Failed to fetch timezone from API:', error);
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
        // 1. 예약 대기 중인 타이머가 있다면 즉시 제거
        if (uploadTimers[id]) {
          clearTimeout(uploadTimers[id]);
          delete uploadTimers[id];
          if (__DEV__) console.log(`[Pending Upload] Cancelled scheduled upload for photo ${id}`);
        }

        const user = get().currentUser || auth.currentUser;
        if (user) {
          try {
            // 로컬 상태에서 즉시 먼저 제거하여 즉각적인 UI 반응 제공
            set((state) => ({
              myPhotos: state.myPhotos.filter((p) => p.id !== id)
            }));

            // 2. Firestore 개인 사진 문서 삭제 (이미 업로드된 경우)
            const docRef = doc(db, `users/${user.uid}/photos`, id);
            await deleteDoc(docRef);

            // 3. shared 전역 사진 문서 연쇄 삭제
            const globalPhoto = get().globalPhotos.find(p => p.id === id);
            if (globalPhoto && globalPhoto.userId === user.uid) {
              await get().removeGlobalPhoto(id);
            }
          } catch (err) {
            console.warn('Failed to remove photo from Firestore:', err);
          }
        } else {
          set((state) => ({
            myPhotos: state.myPhotos.filter((p) => p.id !== id)
          }));
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

        // 구글 지오코드를 이용해 위경도 좌표에서 가장 간단한 단계의 행정구역 주소 획득
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
        const scheduledTime = Date.now() + 60 * 60 * 1000; // 1시간 뒤 실제 업로드 예정

        // 임시 로컬 이미지로 등록하여 myPhotos에 즉시 노출 (isPending: true 표시)
        const newPendingPhoto: MyPhoto = {
          id: photoId,
          latitude,
          longitude,
          imageUrl: localUri, // 일단 로컬 URI를 이미지 소스로 지정하여 갤러리에 노출
          timestamp: Date.now(),
          locationName: finalLocationName,
          landscapeScore,
          weatherScore,
          weatherInfo,
          simulationSample,
          simulationImageUrl: simulationImageUri, // 이것도 로컬 경로
          isPending: true,
          scheduledUploadTime: scheduledTime,
          localUri,
          simulationLocalUri: simulationImageUri,
          deviceAzimuth,
          devicePitch
        };

        // 로컬 상태에 즉시 추가하여 갤러리에 대기 중 이미지 노출
        set((state) => ({
          myPhotos: [newPendingPhoto, ...state.myPhotos]
        }));

        // 타이머 예약 걸기
        const delay = scheduledTime - Date.now();
        uploadTimers[photoId] = setTimeout(() => {
          get().triggerActualUpload(newPendingPhoto);
        }, Math.max(0, delay));

        return finalLocationName;
      },
      triggerActualUpload: async (photo: MyPhoto) => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return;

        // 혹시 대기 1시간 사이에 사용자가 삭제했다면 업로드 중단
        const exists = get().myPhotos.find(p => p.id === photo.id);
        if (!exists) return;

        try {
          const ext = photo.localUri?.split('.').pop() || 'jpg';
          const storagePath = `photos/${user.uid}/${photo.id}.${ext}`;
          const storageRef = ref(storage, storagePath);

          // 1. 실제 사진 업로드
          let imageUrl = '';
          if (photo.localUri) {
            const base64Data = await FileSystem.readAsStringAsync(photo.localUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const contentType = `image/${ext === 'png' ? 'png' : 'jpeg'}`;
            await uploadString(storageRef, base64Data, 'base64', { contentType });
            imageUrl = await getDownloadURL(storageRef);
          }

          // 2. 시뮬레이션 사진 업로드
          let simulationImageUrl = '';
          let simulationStoragePath = '';
          if (photo.simulationLocalUri) {
            simulationStoragePath = `photos/${user.uid}/${photo.id}_sim.jpg`;
            const simStorageRef = ref(storage, simulationStoragePath);

            let simBase64 = '';
            if (photo.simulationLocalUri.startsWith('data:')) {
              simBase64 = photo.simulationLocalUri.split(';base64,')[1];
            } else {
              simBase64 = await FileSystem.readAsStringAsync(photo.simulationLocalUri, {
                encoding: FileSystem.EncodingType.Base64,
              });
            }
            await uploadString(simStorageRef, simBase64, 'base64', { contentType: 'image/jpeg' });
            simulationImageUrl = await getDownloadURL(simStorageRef);
          }

          // 3. Firestore global_photos 컬렉션에 추가
          const userName = user.displayName || (user.email ? user.email.split('@')[0] : 'Anonymous');
          const globalPhoto: GlobalPhoto = {
            id: photo.id,
            latitude: Number(photo.latitude.toFixed(2)),
            longitude: Number(photo.longitude.toFixed(2)),
            imageUrl: imageUrl || photo.imageUrl,
            storagePath,
            timestamp: photo.timestamp,
            locationName: photo.locationName,
            userId: user.uid,
            userName,
            landscapeScore: photo.landscapeScore,
            weatherScore: photo.weatherScore,
            weatherInfo: photo.weatherInfo,
            simulationSample: photo.simulationSample,
            simulationImageUrl,
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

          // 4. Firestore 개인 users/*/photos 컬렉션에 추가 (isPending 등 불필요 속성 제거)
          const personalPhoto: MyPhoto = {
            ...photo,
            imageUrl: imageUrl || photo.imageUrl,
            simulationImageUrl,
            isPending: undefined,
            scheduledUploadTime: undefined,
            localUri: undefined,
            simulationLocalUri: undefined
          };

          const cleanedPersonal = Object.entries(personalPhoto).reduce((acc, [key, val]) => {
            if (val !== undefined) acc[key] = val;
            return acc;
          }, {} as any);

          const personalDocRef = doc(db, `users/${user.uid}/photos`, photo.id);
          await setDoc(personalDocRef, cleanedPersonal);

          // 5. 로컬 상태 업데이트 (isPending 해제 및 실제 CDN URL 적용)
          set((state) => ({
            myPhotos: state.myPhotos.map(p => 
              p.id === photo.id 
                ? { 
                    ...p, 
                    isPending: undefined, 
                    scheduledUploadTime: undefined, 
                    localUri: undefined, 
                    simulationLocalUri: undefined,
                    imageUrl: imageUrl || p.imageUrl, 
                    simulationImageUrl 
                  } 
                : p
            )
          }));

          // 타이머 관리 맵에서 제거
          delete uploadTimers[photo.id];
          if (__DEV__) console.log(`[Pending Upload] Successfully uploaded photo ${photo.id}`);
        } catch (uploadErr) {
          console.error(`[Pending Upload] Failed to upload ${photo.id}:`, uploadErr);
        }
      },
      initializePendingUploads: () => {
        const user = get().currentUser || auth.currentUser;
        if (!user) return;

        const pending = get().myPhotos.filter(p => p.isPending && p.scheduledUploadTime);
        if (pending.length === 0) return;

        if (__DEV__) console.log(`[Pending Upload] Found ${pending.length} pending uploads to restore`);

        pending.forEach(photo => {
          const now = Date.now();
          const targetTime = photo.scheduledUploadTime || now;
          const delay = targetTime - now;

          if (uploadTimers[photo.id]) {
            clearTimeout(uploadTimers[photo.id]);
          }

          if (delay <= 0) {
            // 이미 예정된 업로드 시각이 지났다면 즉시 업로드
            if (__DEV__) console.log(`[Pending Upload] Upload time passed for ${photo.id}. Triggering immediately.`);
            get().triggerActualUpload(photo);
          } else {
            // 남은 시간만큼 타이머 재등록
            if (__DEV__) console.log(`[Pending Upload] Scheduling upload for ${photo.id} in ${(delay / 1000 / 60).toFixed(1)} minutes`);
            uploadTimers[photo.id] = setTimeout(() => {
              get().triggerActualUpload(photo);
            }, delay);
          }
        });
      },
      syncGlobalPhotos: () => {
        const photosRef = collection(db, 'global_photos');
        const unsubscribe = onSnapshot(
          photosRef,
          (snapshot) => {
            const photosList: GlobalPhoto[] = [];
            snapshot.forEach((doc) => {
              photosList.push(doc.data() as GlobalPhoto);
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
 
          const offsetHours = get().timezoneOffsetHours || 9;
          const localTime = new Date(now.getTime() + offsetHours * 3600 * 1000);
          const dateStr = localTime.toISOString().split('T')[0];
 
          if (__DEV__) {
            console.log(`[Preload] Fetching weather/terrain for lat=${lat}, lon=${lon}`);
          }
          set({ preloadStatus: 'analyzingData' });
          await Promise.all([
            fetchSunsetWeather(lat, lon, az, false, targetEvent).then(weatherData => {
              if (weatherData) {
                get().addWeatherCache({
                  key: `w_${lat.toFixed(4)}_${lon.toFixed(4)}_${dateStr}`,
                  data: weatherData,
                  timestamp: Date.now(),
                  latitude: lat,
                  longitude: lon
                });
              }
            }).catch(err => console.warn('Preload Weather failed:', err)),
            fetchTerrainProfile(lat, lon, 0, 360).then(terrainData => {
              if (terrainData && !terrainData.isFallback) {
                get().addTerrainCache({
                  key: `t_${lat.toFixed(4)}_${lon.toFixed(4)}`,
                  data: terrainData,
                  timestamp: Date.now(),
                  latitude: lat,
                  longitude: lon
                });
              }
            }).catch(err => console.warn('Preload Terrain failed:', err))
          ]);
 
          let initialTab: 'tracker' | 'sim' = 'tracker';
          try {
            const netState = await NetInfo.fetch();
            const isConnected = netState.isConnected && netState.isInternetReachable !== false;
            if (isConnected) {
              initialTab = 'sim';
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
          set({ isAppReady: true });
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
