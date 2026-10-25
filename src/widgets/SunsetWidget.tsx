import React from 'react';
import { FlexWidget, TextWidget, ImageWidget } from 'react-native-android-widget';
import { getSafeBase64JpegPixel } from '../utils/simulationImage';

export interface WidgetData {
  timeStr: string;        // e.g. "19:24"
  eventLabel: string;     // e.g. "오늘의 일몰" / "내일의 일출"
  cloudLabel: string;     // e.g. "구름 적음"
  colorLabel: string;     // e.g. "Vivid 붉은 노을"
  simulationUri?: string | null; // 시뮬레이션 기본 이미지
  simulationSmallUri?: string | null;  // 180x120 콤팩트
  simulationMediumUri?: string | null; // 280x140 기본
  simulationLargeUri?: string | null;  // 360x200 대형
  updatedAtStr: string;   // e.g. "14:30 업데이트"
}

interface SunsetWidgetProps {
  data: WidgetData;
  widgetWidth?: number;  // Android widget container width
  widgetHeight?: number; // Android widget container height
}

export function SunsetWidget({ data, widgetWidth = 280, widgetHeight = 160 }: SunsetWidgetProps) {
  const {
    timeStr = '19:20',
    eventLabel = '오늘의 일몰',
    cloudLabel = '구름 약간',
    colorLabel = 'Vivid 붉은 노을',
    simulationUri,
    simulationSmallUri,
    simulationMediumUri,
    simulationLargeUri,
  } = data || {};

  // 안드로이드 RemoteViews 100% 호환 안전 이미지 선택
  const activeImageUri = (() => {
    let candidate = simulationMediumUri || simulationUri || simulationSmallUri || simulationLargeUri;
    if (!candidate || typeof candidate !== 'string' || candidate.startsWith('data:image/svg')) {
      candidate = getSafeBase64JpegPixel();
    }
    return candidate;
  })();

  const imageResWidth = widgetWidth < 200 ? 180 : widgetWidth >= 320 ? 360 : 280;
  const imageResHeight = widgetWidth < 200 ? 120 : widgetWidth >= 320 ? 200 : 140;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#16131A',
        borderRadius: 20,
        padding: 12,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
      clickAction="OPEN_APP"
    >
      {/* Top Header Row */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: 'match_parent',
        }}
      >
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget
            text={eventLabel}
            style={{
              fontSize: 12,
              fontWeight: 'bold',
              color: '#FFB380',
            }}
          />
        </FlexWidget>
        <TextWidget
          text={timeStr}
          style={{
            fontSize: 17,
            fontWeight: 'bold',
            color: '#FFFFFF',
          }}
        />
      </FlexWidget>

      {/* Middle Body Visual Section (Responsive 3-Res Multi-Frame) */}
      <FlexWidget
        style={{
          flex: 1,
          marginTop: 6,
          marginBottom: 6,
          borderRadius: 14,
          backgroundColor: '#231E2A',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {activeImageUri ? (
          <ImageWidget
            image={{ uri: activeImageUri } as any}
            imageWidth={imageResWidth}
            imageHeight={imageResHeight}
            style={{
              width: 'match_parent',
              height: 'match_parent',
            }}
          />
        ) : (
          <FlexWidget
            style={{
              width: 'match_parent',
              height: 'match_parent',
              backgroundColor: '#35252D',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <TextWidget
              text="Sunset Glow"
              style={{
                fontSize: 13,
                color: '#FFA07A',
                fontWeight: 'bold',
              }}
            />
          </FlexWidget>
        )}
      </FlexWidget>

      {/* Bottom Prediction Label Badge (안드로이드 RemoteViews 100% 호환 HEX 색상) */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#26FF7B54', // ARGB Hex (rgba(255, 123, 84, 0.15) 대신 표준 HEX)
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 10,
          width: 'match_parent',
        }}
      >
        <TextWidget
          text={`${cloudLabel} · ${colorLabel}`}
          style={{
            fontSize: 11,
            fontWeight: 'bold',
            color: '#FF8C66',
          }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
