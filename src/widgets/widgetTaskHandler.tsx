import React from 'react';
import { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { SunsetWidget, WidgetData } from './SunsetWidget';

import { getPersistedWidgetData } from '../utils/widgetStorage';

const defaultData: WidgetData = {
  timeStr: '19:25',
  eventLabel: '오늘의 일몰',
  cloudLabel: '구름 분석 중',
  colorLabel: '예측 중',
  updatedAtStr: '최신 업데이트',
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
