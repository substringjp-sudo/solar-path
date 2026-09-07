/**
 * MapScreen.tsx
 *
 * "지도" 탭 — 타자중심(위에서 내려다보는) 시점.
 * 답하는 질문은 **"뭐가 오고 있나 / 어디로 갈까"** 입니다.
 *
 * Why 이 둘을 한 탭에 묶었나 (docs/IA_REDESIGN.md §2):
 * 3D 돔은 자기중심 시점이라 "200km 밖 구름이 제시간에 걷힐까"를 **구조적으로**
 * 보여줄 수 없습니다. 돔 안에 있으니까요. 그건 지도의 질문입니다.
 *
 * 등시선은 "빛이 언제 여기 도착하나"를, 구름 추적은 "그때까지 구름이 어떻게
 * 움직이나"를 답합니다. 두 정보가 다른 탭에 흩어져 있으면 사용자가 머릿속에서
 * 합쳐야 합니다. 같은 화면에 두면 "빛이 도착하기 전에 걷힐까"가 한눈에 보입니다.
 */
import React, { useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { Globe2, CloudSun, Compass } from 'lucide-react-native';
import SunCalc from 'suncalc';
import { IsolineMap } from '../IsolineMap/IsolineMap';
import { CloudTrackerChart } from '../CloudTrackerChart';
import { SunAzimuthView } from './SunAzimuthView';
import { TimeSlider } from '../TimeSlider';
import { useCelestialStore } from '../../store/useCelestialStore';

type MapView = 'isoline' | 'clouds' | 'sunpath';

interface MapScreenProps {
  theme: any;
  currentTime: Date;
  isActive: boolean;
  setCurrentTime?: (time: Date) => void;
  isTimeMachineEnabled?: boolean;
  setTimeMachineEnabled?: (enabled: boolean) => void;
  events?: any;
  onCameraPress?: () => void;
}

export const MapScreen: React.FC<MapScreenProps> = ({
  theme,
  currentTime,
  isActive,
  setCurrentTime,
  isTimeMachineEnabled = true,
  setTimeMachineEnabled,
  events,
  onCameraPress,
}) => {
  const { location } = useCelestialStore();
  const [view, setView] = useState<MapView>('isoline');

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.978;

  const isDay = useMemo(() => {
    const sp = SunCalc.getPosition(currentTime, latitude, longitude);
    return sp.altitude > 0;
  }, [currentTime, latitude, longitude]);

  const views: { id: MapView; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    {
      id: 'isoline',
      label: '01 등치선',
      icon: (a) => <Globe2 size={12} color={a ? '#38BDF8' : '#64748B'} />,
    },
    {
      id: 'clouds',
      label: '02 레이더',
      icon: (a) => <CloudSun size={12} color={a ? '#38BDF8' : '#64748B'} />,
    },
    {
      id: 'sunpath',
      label: '03 태양경로',
      icon: (a) => <Compass size={12} color={a ? '#38BDF8' : '#64748B'} />,
    },
  ];

  return (
    <View style={styles.container}>
      {/* ── 상단 3단 계측 세그먼트 (Astro-HUD 스타일) ────────────────────── */}
      <View style={[styles.segment, { backgroundColor: 'rgba(9, 13, 24, 0.95)', borderColor: 'rgba(255, 255, 255, 0.14)' }]}>
        {views.map(v => {
          const isActiveView = view === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => setView(v.id)}
              style={[
                styles.segmentBtn,
                isActiveView && styles.segmentBtnActive,
              ]}
              activeOpacity={0.8}
            >
              {v.icon(isActiveView)}
              <Text
                style={[
                  styles.segmentText,
                  { color: isActiveView ? '#38BDF8' : '#64748B' },
                  isActiveView && { fontWeight: '900' },
                ]}
              >
                {v.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {view === 'isoline' ? (
          <IsolineMap theme={theme} currentTime={currentTime} isActive={isActive} />
        ) : view === 'clouds' ? (
          <CloudTrackerChart theme={theme} latitude={latitude} longitude={longitude} currentTime={currentTime} />
        ) : (
          <SunAzimuthView theme={theme} currentTime={currentTime} />
        )}
      </View>

      {/* ── 태양 경로 뷰 최하단 상시 노출 타임 슬라이더 ─────────────────────── */}
      {view === 'sunpath' && setCurrentTime && (
        <View style={[styles.bottomPanel, { backgroundColor: 'rgba(8, 11, 17, 0.95)', borderColor: 'rgba(255, 255, 255, 0.12)' }]}>
          <TimeSlider
            value={currentTime}
            onChange={setCurrentTime}
            isTimeMachineEnabled={isTimeMachineEnabled}
            onToggleTimeMachine={setTimeMachineEnabled}
            theme={theme}
            isDay={isDay}
            onCameraPress={onCameraPress}
            markers={events ? [
              { time: events.sunrise || null, color: '#FFA500', type: 'rise' },
              { time: events.sunset || null, color: '#FF4500', type: 'set' },
              { time: events.moonrise || null, color: '#888', type: 'rise' },
              { time: events.moonset || null, color: '#888', type: 'set' },
            ] : []}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 2,
    borderRadius: 4,
    borderWidth: 1,
    gap: 2,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  segmentText: {
    fontSize: 10.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.4,
  },
  body: {
    flex: 1,
  },
  bottomPanel: {
    paddingVertical: 6,
    borderTopWidth: 1,
  },
});
