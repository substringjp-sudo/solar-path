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
import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { Globe2, CloudSun } from 'lucide-react-native';
import { IsolineMap } from '../IsolineMap/IsolineMap';
import { CloudTrackerChart } from '../CloudTrackerChart';
import { useCelestialStore } from '../../store/useCelestialStore';

type MapView = 'isoline' | 'clouds';

interface MapScreenProps {
  theme: any;
  currentTime: Date;
  isActive: boolean;
}

export const MapScreen: React.FC<MapScreenProps> = ({ theme, currentTime, isActive }) => {
  const { location } = useCelestialStore();
  const [view, setView] = useState<MapView>('isoline');

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.978;

  const views: { id: MapView; label: string; icon: React.ReactNode }[] = [
    { id: 'isoline', label: '등시선', icon: <Globe2 size={13} color={view === 'isoline' ? '#F8FAFC' : '#94A3B8'} /> },
    { id: 'clouds', label: '구름 이동', icon: <CloudSun size={13} color={view === 'clouds' ? '#F8FAFC' : '#94A3B8'} /> },
  ];

  return (
    <View style={styles.container}>
      {/* 같은 공간 프레임 안의 두 레이어 — 탭이 아니라 세그먼트로 전환합니다. */}
      <View style={[styles.segment, { backgroundColor: theme.glass, borderColor: theme.border }]}>
        {views.map(v => {
          const isActiveView = view === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => setView(v.id)}
              style={[
                styles.segmentBtn,
                isActiveView && { backgroundColor: 'rgba(59, 130, 246, 0.22)' },
              ]}
              activeOpacity={0.8}
            >
              {v.icon}
              <Text
                style={[
                  styles.segmentText,
                  { color: isActiveView ? '#F8FAFC' : theme.subText },
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
        ) : (
          <CloudTrackerChart theme={theme} latitude={latitude} longitude={longitude} />
        )}
      </View>
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
    padding: 3,
    borderRadius: 14,
    borderWidth: Platform.OS === 'android' ? 0 : 1,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: 11,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
});
