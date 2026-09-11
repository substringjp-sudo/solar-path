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
 * ## 레이더 탭도 없앴습니다 (§74)
 *
 * ⚠ 옛 `02 레이더` 는 **날씨 자료를 하나도 안 썼습니다.** 운량·구름종류·풍속·
 * 풍향이 전부 `Math.sin(lat*12.9898 + lon*78.233 + …)` 해시에서 나왔고, 화면에는
 * "웅장한 적란운"·"희귀 렌즈구름" 같은 이름이 떴습니다.
 *
 * 이제 지도가 **이미 받아 둔 구름 고리**(반경 380km·97점)를 그대로 그립니다.
 * 차트가 나르던 것 중 지도가 못 그리는 둘 — 구름 종류와 바람 — 은 지도 위
 * 읽기값과 화살표로 옮겼습니다.
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
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { IsolineMap } from '../IsolineMap/IsolineMap';

interface MapScreenProps {
  theme: any;
  currentTime: Date;
  isActive: boolean;
  /**
   * 좌표를 손으로 넣고 싶을 때 **기존 위치 선택 모달**을 엽니다.
   *
   * ⚠ 폼을 새로 만들지 않습니다. 지도 안에서 옮기는 길이 생겼어도 좌표 입력·
   * 검색은 그 모달이 이미 하고 있으므로, 같은 걸 두 벌 두면 갈라집니다.
   */
  onOpenPicker?: () => void;
}
// ⚠ 태양경로 탭이 없어지면서 이 화면의 하단 TimeSlider 도 사라졌습니다.
//   시간·날짜 조작은 합쳐진 화면 안의 `IsolineControls` 가 그대로 맡습니다.
//   그래서 setCurrentTime · isTimeMachineEnabled · setTimeMachineEnabled ·
//   events · onCameraPress 를 더 안 받습니다 — 죽은 prop 을 남기지 않습니다.

export const MapScreen: React.FC<MapScreenProps> = ({
  theme,
  currentTime,
  isActive,
  onOpenPicker,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <IsolineMap theme={theme} currentTime={currentTime} isActive={isActive} onOpenPicker={onOpenPicker} />
      </View>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
