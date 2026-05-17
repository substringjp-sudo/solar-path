import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
}

export const useCelestialStore = create<CelestialState>()(
  persist(
    (set, get) => ({
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
    }),
    {
      name: 'solar-path-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        location: state.location,
        weatherCacheList: state.weatherCacheList,
        terrainCacheList: state.terrainCacheList
      }),
    }
  )
);
