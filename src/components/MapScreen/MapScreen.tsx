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
 *
 * ## 태양 경로 탭을 없앴습니다 (§73)
 *
 * 등치선과 태양경로는 **같은 기하의 두 표현**입니다 — 등고도선은 직하점 중심의
 * 원이고 태양 방위는 그 원의 법선입니다(잰 잔차 0.213°, `solarGeometry.ts`).
 * 게다가 둘은 **사는 축척이 다릅니다**: 화면 폭 1° 아래로 내려가면 등치선은
 * 화면 안에서 5분도 안 벌어져 뜻을 잃고, 바로 그 자리에서 "내 하늘 어디에 해가
 * 있나"가 뜻을 얻습니다.
 *
 * 그래서 따로 둘 이유가 없어 **하나로 합쳤습니다.** 줌만 내리면 같은 화면에서
 * 등치선이 한 줄로 수렴하며 그 법선으로 태양 방위가 뜹니다. 지도 평면이 못
 * 그리는 **고도**는 극좌표 인셋이 모서리에서 지킵니다.
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
// ⚠ 태양경로 탭이 없어지면서 이 화면의 하단 TimeSlider 도 사라졌습니다.
//   시간·날짜 조작은 합쳐진 화면 안의 `IsolineControls` 가 그대로 맡습니다.
//   그래서 setCurrentTime · isTimeMachineEnabled · setTimeMachineEnabled ·
//   events · onCameraPress 를 더 안 받습니다 — 죽은 prop 을 남기지 않습니다.

export const MapScreen: React.FC<MapScreenProps> = ({
  theme,
  currentTime,
  isActive,
}) => {
  const { location } = useCelestialStore();
  const [view, setView] = useState<MapView>('isoline');

  const latitude = location?.coords.latitude ?? 37.5665;
  const longitude = location?.coords.longitude ?? 126.978;

  const views: { id: MapView; label: string; icon: (active: boolean) => React.ReactNode }[] = [
    {
      id: 'isoline',
      // 축척에 따라 등치선이 되기도 태양 방위가 되기도 합니다 — 한 이름으로 묶습니다.
      label: '01 하늘·지구',
      icon: (a) => <Globe2 size={12} color={a ? '#38BDF8' : '#64748B'} />,
    },
    {
      id: 'clouds',
      label: '02 레이더',
      icon: (a) => <CloudSun size={12} color={a ? '#38BDF8' : '#64748B'} />,
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
        ) : (
          <CloudTrackerChart theme={theme} latitude={latitude} longitude={longitude} currentTime={currentTime} />
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
