# 계산 지도 — 무엇이 언제 다시 계산되나

한 줄: 날짜 · 장소를 고를 때(불러오기 · 미리 계산), 시간이 바뀔 때, 카메라가 바뀔 때 각각 무엇을 계산하는지. 갱신: 2026-11-26.
비용은 데스크톱 V8 측정 또는 기기 상태 줄 값(기기 Hermes · 모바일 GPU 는 따로 측정 안 함). 자세한 비용 분석은 [성능](performance.md).

## 1. 날짜 · 장소를 고를 때 — 불러오기와 미리 계산
| 일 | 언제 | 위치 | 비용 · 메모 |
|---|---|---|---|
| 볼륨 하늘 인스턴스 · **대기 표(15파장)** | 처음 한 번 | `ensureVolumetricInstance` → `spectralAtmosphere.ts` | 기기 "대기 10s". 장소 · 날짜와 무관 |
| 모양 잡음 3D 텍스처 · 세포 · 가장자리 타일 | 처음 한 번(모듈 캐시) | `volumetricScene` cachedNoise, `cloudCells.ts`, `cloudEdge.ts` | |
| **예보 고리 받기** `fetchDayWeatherRing` | 장소 · 날짜 바뀜(캐시 · 카나리아 먼저) | `SkyScreen.tsx` loadWeather | 네트워크(하네스에선 30 s 걸린 적) · 저장장치 캐시 |
| 지형 단면(능선 · 지평선 띠) | 장소 | `SkyScreen.tsx` → terrainData, `SkyScene3D` createTerrainBands · 물 가림 텍스처 | 네트워크 + CPU |
| **DEM 높이장** `loadDemPatch`(먼 반경 + 바다 가림 반경) | 장소 | `SkyScene3D.tsx` loadDemForRef | 텍스처 받기 · 지형 메시 |
| 밤 불빛 지도 | 장소 | `ensureNightLightsForLocation` | |
| **하루치 날씨 텍스처 미리 굽기**(24 칸) | 장면이 처음 서고 나서(PR #169 부터 끄는 중에도) | `startDayPrewarmIfNeeded` → `prewarmScenesAsync` | 칸당 기기 ~1.2 s(V8 196 ms) · 캐시 32 칸 |
| 거시 격자 텍스처 · 먼 거리 운량 격자 | 고리 예보가 바뀔 때(시간 칸) | `getOrBuildCachedMacroTex`, `buildFarCoverGrids` | V8 4.8~6.5 ms |
| 하루 하늘 기둥 타임라인(있으면) | 타임라인을 만들 때 | `SKY_TIMELINE.md`, `SkyScreen` timeline | 옛 하늘 경로용 |
| 노을 점수 그래프 · 다가오는 좋은 순간 · 3일 예보 카드 | 예보 · 날짜 | `SkyScreen` scoreGraph · glow · `useForecastDays` | 끄는 중엔 지난 값을 씀 |
| 먼 건물 | **버튼으로만** | `loadFarBuildings` | 네트워크 |

## 2. 시간이 바뀔 때(시간 막대 · 실시간 시계)
| 일 | 얼마나 자주 | 위치 | 비용 |
|---|---|---|---|
| 해 · 달 위치, 별 · 은하수 | 매 프레임 | `SkyScene3D` render | 작음 |
| 해 · 달 궤적 선 | 1 시간 넘게 바뀔 때 | `updateCelestialPaths` | 작음 |
| **날씨 텍스처 바꾸기** `setSceneAsync` | 시간 칸(정시 30분)이 바뀔 때 — 미리 구웠으면 즉시 | `stepVolumetricScene` | 안 구웠으면 기기 ~1.2 s(4 ms 조각) |
| 장면 입력 `buildLiveScene` + 예보 보간 + `updateContinuousScene` | 분이 바뀔 때(끄는 중 150 ms 간격) | 같은 곳 | V8 ~1 ms · 균일변수 갱신 |
| `setDate`: 해 빛 · 바람 표류 · 거시 격자 섞기 · 연무 · 도시 불빛 · 노출 | 거의 매 프레임(동기화 규칙 `evaluateVolDateSync`) | `volumetricScene.setDate` | 작음 |
| 먼 거리 가림 지도 | 해 10° 아래 · 끄는 중 해 1.5° / 방위 3° 마다 | `applyFarSun` | V8 2~7 ms |
| 지형 빛 · 거리 패스 | 끄는 중 해 1.5° 마다(평소 0.05°) | `prepareTerrainDistance` | 지형 · 건물 원해상도 다시 그림 |
| 옛 하늘 기둥 · **지형 구름 그림자 텍스처** · 해 가림 | 장면 2 분 · 해 1° · 30 s · 예보 바뀜(끄는 중엔 180 ms 뒤로 미룸) | `rebuildCloudsForDate` → `buildSkyColumns` · `buildCloudShadowTexture` | 576 방위 fBm + 4096 그림자 맵(볼륨 하늘에서도 지형 · 바다 구름 그림자에 씀) |
| 노을 예측 · 점수 | 시간 · 해가 바뀔 때(끄는 중엔 지난 값) | `scenePrediction` | |
| 구름 시간 누적 정착 18 프레임 | 시각이 바뀌면 | `volSettleRef` | 그동안 쉬지 않고 그림 |

## 3. 카메라가 바뀔 때(회전 · 줌 · 이동)
| 일 | 얼마나 자주 | 위치 | 비용 |
|---|---|---|---|
| **구름 행진** `renderToTexture` | 매 프레임 | `volumetricScene` | 가장 큼 — 기기 해상도 자동 ×0.25 까지 |
| 상호작용 품질(LOD): 구름 걸음 1.6 배 · 해 쪽 6 걸음 · 해상도 자동 | 상호작용 시작 · 끝 | `applyInteractionLod`, `volGovRef` | 손을 떼면 원래대로 |
| `setView` · 눈 자리 | 시선 키가 바뀔 때 | `placeCamera` | 작음 |
| **지형 빛 · 거리 패스(MRT×3, 원해상도)** | 시선 키가 바뀔 때마다 | `prepareTerrainDistance` | 지형을 프레임마다 두 번 그림(본 패스는 깊이만) |
| 구름 시간 누적 끊김 · 정착 18 프레임 | 시선이 바뀌면 | `volSettleRef` | |
| 눈 이동(조이스틱 · 비행) | 30 km 넘게 옮기면 장면 다시 | `localOffsetM` → volHasScene 리셋 | 장면 전체 다시 |
| 시선 방향을 쓰는 장면 입력 | 분 갱신 때 함께(az · el 전달) | `buildLiveScene` | 작음 |

## 남은 질문
- 기기에서 단계별 ms 계측이 없음 → 개발 패널에 단계별 시간 표시가 다음 일.
- 옛 하늘 기둥 재빌드가 볼륨 하늘에서 쓰이는 건 지형 · 바다 구름 그림자뿐 — 볼륨 구름과 같은 근거로 바꾸면 이 일을 없앨 수 있음(별도 검토).
