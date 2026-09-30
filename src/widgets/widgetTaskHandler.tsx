import React from 'react';
import { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { SunsetWidget, WidgetData } from './SunsetWidget';

import { getPersistedWidgetData } from '../utils/widgetStorage';

// 앱을 한 번도 열기 전에 보이는 기본값 — 가짜 시각 대신 빈칸, 문구는 기기 언어로(출시 점검 2026-09-30).
const deviceLang = (): 'ko' | 'en' | 'ja' => {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return loc.startsWith('ko') ? 'ko' : loc.startsWith('ja') ? 'ja' : 'en';
  } catch {
    return 'en';
  }
};
const L3 = (ko: string, en: string, ja: string) => {
  const l = deviceLang();
  return l === 'ko' ? ko : l === 'ja' ? ja : en;
};

const defaultData: WidgetData = {
  timeStr: '--:--',
  eventLabel: L3('오늘의 일몰', "Today's sunset", '今日の日の入り'),
  cloudLabel: L3('앱을 열어 주세요', 'Open the app', 'アプリを開いてください'),
  colorLabel: L3('예측 대기', 'Forecast pending', '予報待ち'),
  updatedAtStr: '',
};

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetAction } = props;

  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const persistedData = await getPersistedWidgetData();
      props.renderWidget(
        <SunsetWidget data={persistedData || defaultData} />
      );
      break;
    }
    default:
      break;
  }
}
