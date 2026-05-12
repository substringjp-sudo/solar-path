import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface CelestialState {
  currentTime: Date;
  location: Location.LocationObject | null;
  isTimeMachineEnabled: boolean;
  errorMsg: string | null;
  weatherCache: { key: string; data: any[]; timestamp: number; latitude: number; longitude: number } | null;
  terrainCache: { key: string; data: any; timestamp: number; latitude: number; longitude: number } | null;
  userRotation: number;
  isGyroEnabled: boolean;
  savedLocations: SavedLocation[];
  
  // Actions
  setCurrentTime: (time: Date) => void;
  setLocation: (loc: Location.LocationObject | null) => void;
  setTimeMachineEnabled: (enabled: boolean) => void;
  setErrorMsg: (msg: string | null) => void;
  updateTime: () => void;
  setWeatherCache: (cache: { key: string; data: any[]; timestamp: number; latitude: number; longitude: number } | null) => void;
  setTerrainCache: (cache: { key: string; data: any; timestamp: number; latitude: number; longitude: number } | null) => void;
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
      userRotation: 0,
      isGyroEnabled: false,
      savedLocations: [],

      setWeatherCache: (cache) => set({ weatherCache: cache }),
      setTerrainCache: (cache) => set({ terrainCache: cache }),
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
      addSavedLocation: (name, latitude, longitude) => set((state) => ({
        savedLocations: [
          {
            id: Math.random().toString(36).substring(7),
            name,
            latitude,
            longitude,
            timestamp: Date.now()
          },
          ...state.savedLocations
        ].slice(0, 20) // Keep last 20
      })),
      removeSavedLocation: (id) => set((state) => ({
        savedLocations: state.savedLocations.filter(loc => loc.id !== id)
      })),
    }),
    {
      name: 'solar-path-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ 
        savedLocations: state.savedLocations,
        location: state.location 
      }),
    }
  )
);
