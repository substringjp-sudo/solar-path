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

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
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
      addSavedLocation: (name, latitude, longitude) => set((state) => {
        const newLocation: SavedLocation = {
          id: Date.now().toString(),
          name,
          latitude,
          longitude,
        };
        const isDuplicate = state.savedLocations.some(
          (loc) => loc.latitude === latitude && loc.longitude === longitude
        );
        if (isDuplicate) return state;
        return {
          savedLocations: [...state.savedLocations, newLocation]
        };
      }),
      removeSavedLocation: (id) => set((state) => ({
        savedLocations: state.savedLocations.filter(loc => loc.id !== id)
      })),
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
        savedLocations: state.savedLocations
      }),
    }
  )
);
