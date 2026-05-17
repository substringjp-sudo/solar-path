# 🌅 Sunset Cloud Physics Model (노을 구름 물리 기반 렌더링 공식 문서)

이 문서는 `solar-path` 프로젝트의 대기 광학 시뮬레이션 및 물리 기반 구름 채색(Physically-Based Cloud Coloring) 알고리즘에 적용된 수학적/물리학적 공식을 정리한 레퍼런스입니다. 

실제 카메라와 관측자가 일몰/일출 시 보게 되는 하늘과 구름의 다이내믹한 색상 변화(회색 음영부터 신비로운 자색/자주색 황혼빛까지)를 모델링하기 위해 대기 물리학적 수식들이 `src/utils/sunsetPhysics.ts`에 어떻게 구현되었는지 설명합니다.

---

## 📌 목차
1. [대기 광학 개요 (Rayleigh & Mie Scattering)](#1-대기-광학-개요-rayleigh--mie-scattering)
2. [태양 직사광 감쇄 모델 (Direct Beam Attenuation)](#2-태양-직사광-감쇄-모델-direct-beam-attenuation)
3. [구름 광학 두께 모델 (Cloud Optical Depth, $\tau$)](#3-구름-광학-두께-모델-cloud-optical-depth-tau)
4. [구름 내부 감쇄 모델 (Beer-Lambert Law)](#4-구름-내부-감쇄-모델-beer-lambert-law)
5. [음영 자색광 합성 공식 (Twilight Purple Synthesis)](#5-음영-자색광-합성-공식-twilight-purple-synthesis)
6. [코드 매핑 테이블 (Code to Math Mapping)](#6-코드-매핑-테이블-code-to-math-mapping)

---

## 1. 대기 광학 개요 (Rayleigh & Mie Scattering)

대기 중의 빛은 크게 두 가지 산란 메커니즘에 의해 제어됩니다.

### 1) 레일리 산란 (Rayleigh Scattering)
빛의 파장보다 훨씬 작은 대기 분자(질소, 산소 등)에 의해 발생하며, 산란 강도는 파장의 4제곱에 반비례합니다.
$$I_{\text{Rayleigh}}(\lambda) \propto \frac{1}{\lambda^4}$$
*   **낮 하늘 (Blue Sky)**: 파장이 짧은 파란색 빛($\approx 450\text{nm}$)이 붉은색 빛($\approx 650\text{nm}$)보다 약 4.4배 더 강하게 산란되어 온 하늘이 푸르게 보입니다.
*   **노을 하늘 (Red Sunset)**: 태양이 지평선 부근으로 내려앉으면 태양빛이 통과해야 하는 대기 경로(Air Mass)가 기하급수적으로 길어집니다. 이로 인해 파란색/초록색 빛은 관측자에게 도달하기 전에 사방으로 흩어져 소멸하고, 마지막까지 살아남은 **붉은색 직사광**만이 대기를 뚫고 들어옵니다.

### 2) 미 산란 (Mie Scattering)
빛의 파장과 크기가 비슷하거나 더 큰 에어로졸(먼지, 수증기, 물방울 등)에 의해 발생하며, 파장 의존성이 적고 전방 산란(Forward Scattering) 경향이 매우 강합니다.
*   구름(Cloud)은 수많은 물방울과 얼음 결정(미 산란체)으로 이루어져 있어, 모든 가시광선 파장을 골고루 산란하여 원래는 **하얀색/밝은 회색**을 띱니다.
*   태양 주변의 강렬하고 붉은 아우라(Halo)는 에어로졸에 의한 미 산란 때문에 형성됩니다.

---

## 2. 태양 직사광 감쇄 모델 (Direct Beam Attenuation)

태양이 대기를 뚫고 구름에 도달할 때의 incident beam $I_{\text{incident}}(\lambda)$은 대기 공기질량(Air Mass, $m$)과 대기의 광학 두께(Rayleigh Depth $\tau_R$, Aerosol Depth $\tau_M$)에 의해 감쇄됩니다.

### 1) 대기 공기질량 (Airmass)
태양 고도각 $\theta$ (Altitude in degrees)에 따른 빛의 통과 경로 비율을 구하기 위해 Kasten-Young (1989) 공식을 사용합니다:
$$m(\theta) = \frac{1}{\sin(\theta) + 0.50572 \cdot (\theta + 6.07995)^{-1.6364}}$$

### 2) 소산 계수 및 감쇄 (Extinction)
빛의 투과율은 Beer-Lambert 법칙에 따라 다음과 같이 계산됩니다:
$$I_{\text{incident}}(\lambda) = I_0(\lambda) \cdot e^{-(\tau_R(\lambda) + \tau_M(\lambda)) \cdot m(\theta)}$$
*   `directBeamRGB` 함수에서 이 연산을 수행하여 태양이 낮아질수록 붉은 파장(Red)만 살아남은 광선 벡터를 시뮬레이션합니다.

---

## 3. 구름 광학 두께 모델 (Cloud Optical Depth, $\tau$)

구름의 채색은 구름 자체의 밀도와 두께에 따라 달라집니다. 물리학에서는 이를 **광학 두께(Optical Depth, $\tau$)**로 정의하며, 구름 내부의 소산 계수 $\beta_{\text{ext}}$와 두께 $dz$의 곱으로 결정됩니다:
$$\tau = \int \beta_{\text{ext}} \, dz$$

프로젝트의 시뮬레이션 정확도를 높이기 위해, 각 고도 영역별 구름 비율(Cover Percentage, $0 \sim 100\%$)을 기반으로 현실적인 광학 두께를 공식화했습니다.

| 구름 유형 | 실제 물리 특성 | 모델화된 광학 두께 공식 ($\tau$) | 비고 |
| :--- | :--- | :--- | :--- |
| **저층운 (Low Clouds)** | 매우 밀도가 높고 두꺼운 물방울 구름 | $\tau_{\text{low}} = 0.5 + 11.5 \cdot \text{cover}_{\text{low}}$ | 최대 $\tau \approx 12.0$ (빛이 통과하기 매우 어려움. 밑면이 깊은 어두운 회색 형성) |
| **중층운 (Mid Clouds)** | 중간 두께의 수증기/얼음 혼합 구름 | $\tau_{\text{mid}} = 0.3 + 3.7 \cdot \text{cover}_{\text{mid}}$ | 최대 $\tau \approx 4.0$ (노을빛이 부분 투과하여 가장 다이내믹한 붉은빛 방출) |
| **고층운 (High Clouds)** | 얇고 섬세한 얼음 결정 구름 (새털구름) | $\tau_{\text{high}} = 0.1 + 1.4 \cdot \text{cover}_{\text{high}}$ | 최대 $\tau \approx 1.5$ (빛이 아주 쉽게 투과하며, 가장 먼저 붉게 빛남) |

---

## 4. 구름 내부 감쇄 모델 (Beer-Lambert Law)

노을빛이 구름 밑면까지 통과하여 관측자에게 전달되는 비율(투과율, Transmittance)은 구름의 광학 두께 $\tau$에 의해 지수 감쇄합니다.

$$t_{\text{internal}} = e^{-\tau \cdot k}$$

*   $k$는 렌더링 스케일 튜닝 상수로, 우리 프로젝트에서는 시각적 왜곡을 방지하기 위해 $0.25$를 적용했습니다.
*   **결과**:
    *   $\tau$가 매우 큰 두꺼운 저층운은 $t_{\text{internal}} \to 0$이 되어 직접광이 통과하지 못하므로, 구름 밑면이 **어둡고 무거운 회색(Shadowed Grey)**이 됩니다.
    *   $\tau$가 작고 얇은 고층운은 $t_{\text{internal}} \to 1.0$에 가까워 태양 직사광 $I_{\text{incident}}$을 그대로 반사하므로 **불타는 듯한 선명한 주홍색/적색**으로 표현됩니다.

---

## 5. 음영 자색광 합성 공식 (Twilight Purple Synthesis)

해가 지평선 아래로 떨어지거나 구름이 햇빛의 직사선 밑에서 완전히 가려졌을 때(그림자 영역), 구름은 완전한 검은색이 되지 않습니다. 대신 두 가지 환경광(Ambient Light)을 받아 독특한 색을 띱니다.

1.  **천공광(Zenith Ambient Sky, $I_{\text{sky}}$)**: 머리 위 하늘의 푸른빛(Rayleigh 산란의 잔재).
2.  **지평선 반사광(Horizon Glow, $I_{\text{horizon}}$)**: 멀리 지평선 부근에서 붉게 흩어지는 노을빛.

구름 내부에서 이 두 개의 상반된 파장(파란색과 빨간색)이 혼합되면서 황혼기 특유의 **신비로운 보랏빛/자색(Twilight Purple/Magenta)**이 창출됩니다.

### 🟣 자색광 합성 수식 (Purple Glow Equation)
구름의 차폐도($\text{ambientInfluence} = 1.0 - t_{\text{internal}}$)에 따라, 그늘진 구름의 기저 색상(Shadowed Cloud base)에 파란색 천공광과 빨간색 지평선 반사광을 선택적으로 혼합합니다:

$$R_{\text{shadow}} = \text{lerp}(C_{\text{shadow}}.r, \, I_{\text{horizon}}.r \cdot 0.28, \, \text{ambientInfluence})$$
$$G_{\text{shadow}} = \text{lerp}(C_{\text{shadow}}.g, \, I_{\text{horizon}}.g \cdot 0.15, \, \text{ambientInfluence})$$
$$B_{\text{shadow}} = \text{lerp}(C_{\text{shadow}}.b, \, I_{\text{sky}}.b \cdot 0.45, \, \text{ambientInfluence})$$

*   **상수 설계**: $r$ 채널(0.28)과 $b$ 채널(0.45)에 적절한 가중치를 부여하여, 탁하지 않고 채도가 높은 신비로운 자주색/자색이 자연스럽게 배어 나오도록 조율했습니다.
*   최종 구름 색상은 태양의 구름 조명율($illum$)에 따라 **직접 산란광(Direct Scatter)**과 **음영 자색광(Purple Shadow)**을 블렌딩하여 구합니다:
$$C_{\text{cloud}} = \text{mix}(C_{\text{shadow}}, \, C_{\text{direct\_scatter}}, \, illum)$$

---

## 6. 코드 매핑 테이블 (Code to Math Mapping)

`sunsetPhysics.ts` 내 구현 코드와 물리학 수식의 대응 관계입니다.

| 수학 기호 | 코드 변수명 | 구현 위치 | 물리적 정의 / 역할 |
| :---: | :--- | :--- | :--- |
| $\theta$ | `sunAltDeg` | `predictSunset` 매개변수 | 태양의 고도각 (Degrees) |
| - | `latitude` | `predictSunset` 매개변수 | 대기 모델 계산 시 사용되는 관측자의 실제 위도 (Degrees) |
| - | `observerElevationM` | `predictSunset` 매개변수 | 지평선 강하(Horizon Dip) 및 대기 경로 보정에 사용되는 관측자 고도 (Meters) |
| $I_{\text{incident}}$ | `incidentBeam` | `predictSunset` (Line 240) | 대기를 뚫고 도달한 붉은 태양 직사광선 벡터 |
| $\text{cover}_x$ | `coverLow`, `coverMid`, `coverHigh` | `predictSunset` (Line 375~) | 각 구름 레이어의 하늘 점유율 ($0.0 \sim 1.0$) |
| $\tau$ | `tauLow`, `tauMid`, `tauHigh` | `predictSunset` (Line 380~) | 구름의 광학 두께 (Optical Depth) |
| $I_{\text{sky}}$ | `ambientSky` | `predictSunset` (Line 384) | 머리 위 하늘의 푸른/보랏빛 산란 환경광 |
| $t_{\text{internal}}$ | `tInternal` | `physicalCloudColor` 함수 내부 | Beer-Lambert 법칙에 따른 구름 내부 투과율 |
| $C_{\text{direct\_scatter}}$ | `directScatter` | `physicalCloudColor` 함수 내부 | 구름을 뚫고 나온 주홍색/적색의 빛 |
| $C_{\text{shadow}}$ | `purpleGlow` | `physicalCloudColor` 함수 내부 | 노을빛 Red와 하늘빛 Blue가 혼합된 자색 환경광 |
| $C_{\text{cloud}}$ | `mixedCloud` | `physicalCloudColor` 함수 내부 | 최종 결정된 구름의 RGB 광학 색상 |

---

> [!NOTE]
> 이 물리 공식의 도입으로 사용자들은 대기 내의 먼지와 습도(`visibilityM`, `rhPct`) 및 실시간 구름 상태에 반응하여 수시로 변하는 프리미엄 수준의 정밀한 노을 시뮬레이션을 모바일 화면에서 직접 감상할 수 있게 되었습니다. 🌅

> [!TIP]
> 향후 추가적인 광학 보정이 필요할 경우, `physicalCloudColor` 내부의 `tInternal` 지수 스케일러(현재 `0.25`) 또는 `purpleGlow` 내 파장 채널 가중치(현재 `0.28`, `0.15`, `0.45`)를 조율하여 노을의 붉은기 및 자색 강도를 조율할 수 있습니다.
