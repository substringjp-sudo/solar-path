# SolarPath 워크스페이스 가이드 (WORKSPACE_GUIDE.md)

이 문서는 SolarPath 프로젝트의 전체 폴더 구조와 주요 파일들의 역할을 정의합니다.
**새로운 기능을 구현하거나 리팩토링 작업을 시작하기 전에 반드시 이 가이드를 숙지하고 준수해야 합니다.**

---

## 1. 프로젝트 폴더 구조 요약

```text
solar-path/
├── .expo/                   # Expo 빌드 캐시 및 설정
├── assets/                  # 이미지, 아이콘, 폰트 등 정적 리소스
├── docs/                    # 기술 문서 및 레퍼런스
├── src/                     # 핵심 소스 코드 디렉토리
│   ├── components/          # 공용 및 핵심 UI 컴포넌트
│   │   ├── AdaptiveDatePicker/ # 디바이스 환경에 맞춘 날짜 선택기
│   │   ├── MapPicker/       # Leaflet 기반의 지도 선택 모달 및 등시선(Isochrones) 제어
│   │   ├── SunsetSimulation/# 노을/날씨 시뮬레이션 배경 및 예측 정보 표시 컴포넌트
│   │   ├── CelestialChart.tsx  # 천체 궤적 차트
│   │   ├── GenericSlider.tsx   # 공용 슬라이더 컴포넌트
│   │   ├── InfoCard.tsx        # 정보 출력용 카드 컴포넌트
│   │   ├── SunCamera.tsx       # AR 태양 궤적 렌더링 및 자이로 트래킹 카메라 뷰
│   │   └── TimeSlider.tsx      # 시간 탐색 전용 슬라이더 컴포넌트
│   ├── store/               # 상태 관리 (Zustand 스토어)
│   │   └── useCelestialStore.ts # 천체 상태, 위치, 시간, 보정 정보 통합 스토어
│   ├── utils/               # 순수 물리 연산 및 비즈니스 로직 유틸리티
│   │   ├── celestial.ts     # 일출/일몰 각도 계산 및 천체 궤도 물리 연산
│   │   ├── sunCamera.ts     # AR 카메라 투영 행렬 계산 및 센서 연산 유틸
│   │   ├── sunsetPhysics.ts # 대기 산란(Atmospheric Scattering) 및 소멸 물리 엔진
│   │   └── weather.ts       # 기상 정보(구름, 시정, 풍속) 기반 차폐 계수 연산
│   └── App.tsx              # 메인 엔트리포인트 및 핵심 HUD 인터페이스
├── App.tsx                  # 루트 진입점 (src/App.tsx 래퍼)
├── app.json                 # Expo 앱 메타데이터 및 설정 파일
├── package.json             # 의존성 정의 파일
└── tsconfig.json            # TypeScript 컴파일러 구성
```

---

## 2. 파일별 핵심 역할 및 물리 엔진 정보

### 📂 `src/utils/` (핵심 물리 엔진 및 유틸)
* **`celestial.ts`**
  - **역할**: NOAA 천체 알고리즘을 기반으로 한 위도, 경도, 시간 기준의 일출, 일몰, 태양 고도(Elevation) 및 방위각(Azimuth) 정밀 물리 계산.
  - **핵심 연산**: 일출/일몰 등시선(Isochrones) 생성을 위한 각 위도별 통과 시간 탐색.
* **`sunsetPhysics.ts`**
  - **역할**: 대기 산란 시뮬레이션. 빛이 대기(Rayleigh, Mie Scattering)를 통과하며 겪는 감쇠 및 기상 요인(구름양, 습도 등)이 빛의 도달도에 미치는 영향 계산.
  - **핵심 연산**: `beamPathTransmittance` (대기 통과 두께에 따른 흡수율), `getSimulationData` (화면에 그려질 HSL 그라디언트 및 광도 데이터 추출).
* **`sunCamera.ts`**
  - **역할**: AR 환경에서 나침반(Magnetometer)과 가속도/자이로 센서 데이터를 활용해 기기의 3D 회전 행렬을 구하고, 카메라 좌표계에 태양 궤적 투영.
  - **핵심 연산**: 상보 필터(Complementary Filter) 및 쿼터니언을 활용한 센서 드리프트 방지 알고리즘.
* **`weather.ts`**
  - **역할**: 단기 기상 예측 데이터 가공 및 이를 천체/시뮬레이션 데이터와 바인딩.

### 📂 `src/components/` (주요 인터페이스)
* **`SunsetSimulation.tsx`**
  - **역할**: 대기 물리 데이터를 그래픽(SVG 그라디언트)으로 변환하여 역동적인 일몰/일출을 시각화하고 기상 점수(Sunset Quality) 예측.
* **`SunCamera.tsx`**
  - **역할**: AR 카메라 렌더링 및 디바이스 방향에 맞춘 태양 궤적 그래픽 실시간 오버레이.
* **`MapPicker/MapPicker.tsx`**
  - **역할**: WebView와 Leaflet 지도를 결합해 지도 위에서 임의의 위치를 선택하고, 등시선을 중첩 렌더링.

---

## 3. 이 워크스페이스 한정 개발 규칙

1. **작업 전 가이드 참조**: 모든 기능 개발, 버그 수정, 리팩토링 시작 전에 이 `WORKSPACE_GUIDE.md`를 열어 관련된 물리 계산 모듈과 컴포넌트의 책임을 확인해야 합니다.
2. **물리 공식의 순수성 유지**: `src/utils/` 아래의 물리 법칙이나 수학 공식 연산은 UI 렌더링 로직(React State, View Styling 등)과 엄격히 분리되어 있어야 하며, 부작용(Side effects)이 없는 순수 함수로 작성해야 합니다.
3. **아키텍처 일관성**: 파일을 쪼갤 때도 이 폴더 구조 설계 철학을 준수하여, 비즈니스 로직은 `hooks`나 `utils`로, 재사용 UI는 `components` 내에 개별 파일로 분리합니다.
4. **센서 및 스레드 성능 유의**: 자이로/가속도 센서 트래킹(AR) 및 Leaflet Map 렌더링은 메인 스레드 성능에 민감하므로 프레임 드랍이나 렌더링 성능 최적화를 항상 염두에 두어야 합니다.
