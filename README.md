# Solar Path ☀️🌙

현재 위치와 시간을 기반으로 태양과 달의 위치를 원형 궤적 위에 시각화하는 프리미엄 iOS/Android 앱입니다.

## 🚀 시작하기

프로젝트 폴더로 이동한 후 다음 명령어를 실행하세요:

```bash
# 의존성 설치
pnpm install

# 앱 실행 (iOS)
pnpm ios

# 앱 실행 (Android)
pnpm android
```

## ✨ 핵심 기능
- **Celestial Tracking**: `suncalc`를 활용한 실시간 태양/달의 고도(Altitude) 및 방위각(Azimuth) 계산.
- **Visual Trajectory**: 오늘 하루 동안의 이동 경로를 점선으로 시각화.
- **Premium UI**: SVG 기반의 선명한 그래픽과 다크 모드 최적화 디자인.

## 🗺️ 향후 확장 계획 (Roadmap)
이 프로젝트는 단순한 위치 추적기를 넘어 **'노을 예측 엔진'**으로 진화할 예정입니다.
1. **3D Terrain Integration**: 지형 고저차 데이터를 불러와 실제 지평선 구현.
2. **Cloud Forecast Engine**: 기상 API 연동을 통해 고도별 구름 분포 데이터 수집.
3. **Ray-casting Prediction**: 태양빛이 구름 하단에 반사되는 각도를 수학적으로 계산하여 노을의 강도와 색상을 예측.

## 🛠️ 기술 스택
- **Core**: Expo (React Native), TypeScript
- **Styling/UI**: React Native SVG, Lucide Icons
- **State Management**: Zustand
- **Calculation**: SunCalc, Date-fns
