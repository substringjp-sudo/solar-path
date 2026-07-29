import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { SunsetWidget, WidgetData } from '../widgets/SunsetWidget';

const WIDGET_STORAGE_KEY = '@beforeglow_widget_data';

export async function updateSunsetWidgetData(data: WidgetData): Promise<void> {
  try {
    await AsyncStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(data));
    await requestWidgetUpdate({
      widgetName: 'SunsetWidget',
      renderWidget: () => <SunsetWidget data={data} />,
    });
    if (__DEV__) {
      console.log('[SunsetWidget] Widget updated and persisted successfully:', data.timeStr, data.colorLabel);
    }
  } catch (err) {
    console.warn('[SunsetWidget] Widget update skipped or failed:', err);
  }
}

export async function getPersistedWidgetData(): Promise<WidgetData | null> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WidgetData;
  } catch (err) {
    console.warn('[SunsetWidget] Failed to get persisted widget data:', err);
    return null;
  }
}

