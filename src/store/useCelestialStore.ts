import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSunsetWeather, fetchTerrainProfile, getDistance } from '../utils/weather';

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp: number;
}

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

interface CelestialState {
  currentTime: Date;
  location: Location.LocationObject | null;
  isTimeMachineEnabled: boolean;
  errorMsg: string | null;
  weatherCache: WeatherCacheItem | null;
  terrainCache: TerrainCacheItem | null;
  weatherCacheList: WeatherCacheItem[];
  terrainCacheList: TerrainCacheItem[];
  userRotation: number;
  isGyroEnabled: boolean;
  savedLocations: SavedLocation[];
  
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
  addSavedLocation: (name: string, latitude: number, longitude: number) => void;
  removeSavedLocation: (id: string) => void;
}

export const useCelestialStore = create<CelestialState>()(
  persist(
    (set) => ({
      currentTime: new Date(),
      location: null,
      isTimeMachineEnabled: false,
      errorMsg: null,
      weatherCache: null,
      terrainCache: null,
      weatherCacheList: [],
      terrainCacheList: [],
      userRotation: 0,
      isGyroEnabled: false,
      savedLocations: [],

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
        // Filter out any existing item with the exact same key to prevent duplicates
        const filtered = state.terrainCacheList.filter(item => item.key !== cache.key);
        // Keep the last 10 items
        return {
          terrainCacheList: [cache, ...filtered].slice(0, 10),
          terrainCache: cache // support legacy single cache
        };
      }),
      setCurrentTime: (time) => set({ currentTime: time }),
      setLocation: (loc) => set({ location: loc }),
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
      addSavedLocation: (name, latitude, longitude) => {
        const latFixed = Math.round(latitude * 1000) / 1000;
        const lonFixed = Math.round(longitude * 1000) / 1000;
        
        let isDuplicate = false;
        
        set((state) => {
          isDuplicate = state.savedLocations.some(
            loc => Math.round(loc.latitude * 1000) / 1000 === latFixed && 
                   Math.round(loc.longitude * 1000) / 1000 === lonFixed
          );
          
          if (isDuplicate) return state;

          return {
            savedLocations: [
              {
                id: Math.random().toString(36).substring(7),
                name,
                latitude: latFixed,
                longitude: lonFixed,
                timestamp: Date.now()
              },
              ...state.savedLocations
            ].slice(0, 20) // Keep last 20
          };
        });

        if (isDuplicate) return;

        // Background prefetching for Saved Location
        (async () => {
          try {
            const currentState = useCelestialStore.getState();
            const { weatherCacheList, terrainCacheList, addWeatherCache, addTerrainCache } = currentState;

            // 1. Terrain prefetch check (500m threshold)
            let foundTerrainCache = false;
            for (const item of terrainCacheList) {
              const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
              if (dist <= 500) {
                foundTerrainCache = true;
                break;
              }
            }

            if (!foundTerrainCache) {
              console.log(`[useCelestialStore] Prefetching terrain for saved location: ${name} (${latitude}, ${longitude})`);
              const terrainData = await fetchTerrainProfile(latitude, longitude, 0, 360);
              if (terrainData) {
                addTerrainCache({
                  key: `t_${latitude.toFixed(4)}_${longitude.toFixed(4)}`,
                  data: terrainData,
                  timestamp: Date.now(),
                  latitude,
                  longitude
                });
              }
            }

            // 2. Weather prefetch check (2km and 30 minutes threshold)
            let foundWeatherCache = false;
            for (const item of weatherCacheList) {
              const dist = getDistance(latitude, longitude, item.latitude, item.longitude);
              const age = Date.now() - item.timestamp;
              if (dist <= 2000 && age <= 1800000) {
                foundWeatherCache = true;
                break;
              }
            }

            if (!foundWeatherCache) {
              console.log(`[useCelestialStore] Prefetching weather for saved location: ${name} (${latitude}, ${longitude})`);
              const weatherData = await fetchSunsetWeather(latitude, longitude, 270);
              if (weatherData) {
                addWeatherCache({
                  key: `w_${latitude.toFixed(4)}_${longitude.toFixed(4)}`,
                  data: weatherData,
                  timestamp: Date.now(),
                  latitude,
                  longitude
                });
              }
            }
          } catch (error) {
            console.warn('[useCelestialStore] Background prefetching failed:', error);
          }
        })();
      },
      removeSavedLocation: (id) => set((state) => ({
        savedLocations: state.savedLocations.filter(loc => loc.id !== id)
      })),
    }),
    {
      name: 'solar-path-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        savedLocations: state.savedLocations,
        location: state.location,
        weatherCacheList: state.weatherCacheList,
        terrainCacheList: state.terrainCacheList
      }),
    }
  )
);
