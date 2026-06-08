import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, storage } from '../config/firebase';
import { doc, collection, setDoc, deleteDoc, onSnapshot, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { User } from 'firebase/auth';
import { TerrainData } from '../utils/weather';

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
  language: 'ko' | 'en';
  
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
    simulationImageUrl?: string
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
    simulationImageUri?: string
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
  setLanguage: (lang: 'ko' | 'en') => void;
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
          id: Date.now().toString(),
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
        simulationImageUrl
      ) => {
        const user = get().currentUser || auth.currentUser;
        const newPhoto: MyPhoto = {
          id: Date.now().toString(),
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
        const user = get().currentUser || auth.currentUser;
        if (user) {
          try {
            const docRef = doc(db, `users/${user.uid}/photos`, id);
            await deleteDoc(docRef);
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
            set({ myPhotos: photosList });
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
        simulationImageUri?: string
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

        const photoId = Date.now().toString();
        // File extension extraction
        const ext = localUri.split('.').pop() || 'jpg';
        const storagePath = `photos/${user.uid}/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);

        // Fetch image file to upload as blob
        const response = await fetch(localUri);
        const blob = await response.blob();
        let imageUrl = '';

        // Simulation image variables
        let simulationImageUrl = '';
        let simulationStoragePath = '';
        let simBlob: any = null;

        try {
          // Upload actual photo to Firebase Storage
          await uploadBytes(storageRef, blob);
          imageUrl = await getDownloadURL(storageRef);

          // Upload simulation image if provided
          if (simulationImageUri) {
            simulationStoragePath = `photos/${user.uid}/${photoId}_sim.jpg`;
            const simStorageRef = ref(storage, simulationStoragePath);
            const simResponse = await fetch(simulationImageUri);
            simBlob = await simResponse.blob();
            await uploadBytes(simStorageRef, simBlob);
            simulationImageUrl = await getDownloadURL(simStorageRef);
          }

          // Save metadata to Firestore 'global_photos'
          const userName = user.email || user.displayName || 'Anonymous';
          const newPhoto: GlobalPhoto = {
            id: photoId,
            latitude,
            longitude,
            imageUrl,
            storagePath,
            timestamp: Date.now(),
            locationName: finalLocationName,
            userId: user.uid,
            userName,
            landscapeScore,
            weatherScore,
            weatherInfo,
            simulationSample,
            simulationImageUrl,
            simulationStoragePath,
          };

          const docRef = doc(db, 'global_photos', photoId);
          await setDoc(docRef, newPhoto);

          // Add to local myPhotos as well
          await get().addMyPhoto(
            imageUrl,
            latitude,
            longitude,
            finalLocationName,
            landscapeScore,
            weatherScore,
            weatherInfo,
            simulationSample,
            simulationImageUrl
          );
        } finally {
          // Prevent memory leaks / OOM by closing the blob if supported in RN
          if (blob && typeof (blob as any).close === 'function') {
            (blob as any).close();
          }
          if (simBlob && typeof (simBlob as any).close === 'function') {
            (simBlob as any).close();
          }
        }
        return finalLocationName;
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
    }),
    {
      name: 'solar-path-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        location: state.location,
        timezoneOffsetHours: state.timezoneOffsetHours,
        timezoneLabel: state.timezoneLabel,
        weatherCacheList: state.weatherCacheList,
        terrainCacheList: state.terrainCacheList,
        savedLocations: state.savedLocations,
        myPhotos: state.myPhotos,
        isDebugMode: state.isDebugMode,
        language: state.language,
      }),
    }
  )
);
