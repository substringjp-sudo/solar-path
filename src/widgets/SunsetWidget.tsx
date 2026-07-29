import React from 'react';
import { FlexWidget, TextWidget, ImageWidget } from 'react-native-android-widget';

export interface WidgetData {
  timeStr: string;        // e.g. "19:24"
  eventLabel: string;     // e.g. "오늘의 일몰" / "내일의 일출"
  cloudLabel: string;     // e.g. "구름 구름 적음"
  colorLabel: string;     // e.g. "붉고 화려함 (Vivid)"
  simulationBase64?: string | null; // 시뮬레이션 이미지 데이터
  updatedAtStr: string;   // e.g. "14:30 업데이트"
}

interface SunsetWidgetProps {
  data: WidgetData;
  clickAction?: string;
}

export function SunsetWidget({ data }: SunsetWidgetProps) {
  const {
    timeStr = '19:20',
    eventLabel = '오늘의 일몰',
    cloudLabel = '구름 약간',
    colorLabel = 'Vivid 붉은 노을',
    simulationBase64,
  } = data || {};

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#16131A',
        borderRadius: 24,
        padding: 14,
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
            text="🌅"
            style={{ fontSize: 14, marginRight: 4 }}
          />
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
            fontSize: 18,
            fontWeight: 'bold',
            color: '#FFFFFF',
          }}
        />
      </FlexWidget>

      {/* Middle Body Visual Section (Responsive) */}
      <FlexWidget
        style={{
          flex: 1,
          marginTop: 8,
          marginBottom: 8,
          borderRadius: 16,
          backgroundColor: '#231E2A',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {simulationBase64 ? (
          <ImageWidget
            image={{ uri: simulationBase64 } as any}
            imageWidth={280}
            imageHeight={140}
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
              text="🌄 BeforeGlow"
              style={{
                fontSize: 14,
                color: '#FFA07A',
                fontWeight: 'bold',
              }}
            />
          </FlexWidget>
        )}
      </FlexWidget>

      {/* Bottom Prediction Label Badge */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(255, 123, 84, 0.15)',
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 12,
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
