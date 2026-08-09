/**
 * cloudPresets.ts
 *
 * 10종 운형의 광학 파라미터와 SVG 실루엣 템플릿.
 *
 * Why 별도 모듈인가: 이 데이터는 2D Visualizer와 3D 씬이 함께 씁니다.
 * 그런데 원래는 Visualizer.tsx(React Native 컴포넌트) 안에 있어서,
 * 3D 쪽 순수 로직이 렌더 트리 전체를 끌고 들어와야 했습니다.
 * 순수 데이터라 컴포넌트에 있을 이유가 없고, 분리해두면 노드에서 그대로
 * 실행해 검증·미리보기를 돌릴 수 있습니다.
 *
 * Visualizer.tsx는 하위 호환을 위해 여기서 재수출합니다.
 */

import type { CloudData } from './weather';
import type { LayerKey } from './skyColumn';

export type CloudPresetName =
  | 'Cirrus'          // 권운 (새털구름)
  | 'Cirrocumulus'    // 권적운 (비늘구름)
  | 'Cirrostratus'    // 권층운 (햇무리구름)
  | 'Altocumulus'     // 고적운 (양떼구름)
  | 'Altostratus'     // 고층운 (차일구름)
  | 'Nimbostratus'    // 난층운 (비구름)
  | 'Stratocumulus'   // 층적운 (물결뭉게구름)
  | 'Stratus'         // 층운 (안개구름)
  | 'Cumulus'         // 적운 (뭉게구름)
  | 'Cumulonimbus';   // 적란운 (소나기구름)

export interface CloudPreset {
  name: CloudPresetName;
  thickness: number;          // 0.0 ~ 1.0 (빛 차단 및 그늘 깊이)
  shadowContrast: number;     // 0.0 ~ 1.0 (그림자 색상 어두움 비중)
  scattering: number;         // 0.0 ~ 1.0 (구름 본체의 빛 산란 투과율)
  rimLightSharpness: number;  // 0.0 ~ 1.0 (림라이트 영역의 좁고 날카로운 정도)
  baseOpacity: number;        // 기본 투명도 바이어스
}

export function getCloudPreset(
  layerType: 'high' | 'mid' | 'low',
  density: number,
  overcast: number,
  precipFactor: number,
  liquidWater: number,
  humidity: number = 50,
  visibility: number = 10000
): CloudPreset {
  if (layerType === 'high') {
    if (overcast > 0.6 && density > 60) {
      return {
        name: 'Cirrostratus',
        thickness: 0.12,
        shadowContrast: 0.15,
        scattering: 0.85,
        rimLightSharpness: 0.25,
        baseOpacity: 0.35,
      };
    } else if (density < 30 && overcast < 0.3) {
      return {
        name: 'Cirrus',
        thickness: 0.04,
        shadowContrast: 0.05,
        scattering: 0.95,
        rimLightSharpness: 0.15,
        baseOpacity: 0.15,
      };
    } else {
      return {
        name: 'Cirrocumulus',
        thickness: 0.16,
        shadowContrast: 0.20,
        scattering: 0.80,
        rimLightSharpness: 0.30,
        baseOpacity: 0.28,
      };
    }
  } else if (layerType === 'mid') {
    const isRaining = precipFactor > 0.15;
    if (isRaining) {
      return {
        name: 'Nimbostratus',
        thickness: 0.75,
        shadowContrast: 0.80,
        scattering: 0.30,
        rimLightSharpness: 0.50,
        baseOpacity: 0.80,
      };
    } else if (density > 65 || overcast > 0.6) {
      return {
        name: 'Altostratus',
        thickness: 0.55,
        shadowContrast: 0.50,
        scattering: 0.60,
        rimLightSharpness: 0.40,
        baseOpacity: 0.55,
      };
    } else {
      return {
        name: 'Altocumulus',
        thickness: 0.40,
        shadowContrast: 0.40,
        scattering: 0.70,
        rimLightSharpness: 0.60,
        baseOpacity: 0.45,
      };
    }
  } else {
    const isStormy = precipFactor > 0.35 || liquidWater > 20;
    if (isStormy) {
      return {
        name: 'Cumulonimbus',
        thickness: 1.00,
        shadowContrast: 0.98,
        scattering: 0.20,
        rimLightSharpness: 0.90,
        baseOpacity: 0.92,
      };
    }

    const isRainingLight = precipFactor > 0.05;
    const isFoggy = visibility < 3000; // 시정 3km 미만인 경우 안개(Stratus) 유효 조건으로 판별

    if (isRainingLight && humidity > 85 && isFoggy) {
      return {
        name: 'Stratus',
        thickness: 0.65,
        shadowContrast: 0.60,
        scattering: 0.50,
        rimLightSharpness: 0.40,
        baseOpacity: 0.75,
      };
    }

    if (density > 60 || overcast > 0.6) {
      return {
        name: 'Stratocumulus',
        thickness: 0.80,
        shadowContrast: 0.82,
        scattering: 0.40,
        rimLightSharpness: 0.75,
        baseOpacity: 0.75,
      };
    }

    if (isFoggy && humidity > 85 && density < 40) {
      return {
        name: 'Stratus',
        thickness: 0.30,
        shadowContrast: 0.30,
        scattering: 0.70,
        rimLightSharpness: 0.30,
        baseOpacity: 0.35,
      };
    }

    return {
      name: 'Cumulus',
      thickness: 0.70,
      shadowContrast: 0.72,
      scattering: 0.45,
      rimLightSharpness: 0.82,
      baseOpacity: 0.65,
    };
  }
}

// Diverse cloud SVG silhouettes — each type has 4-5 morphologically distinct shapes
export const CLOUD_TEMPLATES: Record<CloudPresetName, string[]> = {
  // ── 권운 (Cirrus): 새털/말꼬리/실처럼 얇고 길게 늘어진 형태 ───────────────
  Cirrus: [
    // 길게 휘어진 새털 모양
    "M 0,18 C 20,10 50,5 90,8 C 110,10 130,4 160,8 C 140,14 110,12 80,16 C 50,19 25,20 0,18 Z",
    // 말꼬리형 — 한쪽으로 흘러내리는 갈고리
    "M 0,12 C 40,8 80,4 120,10 C 140,12 150,8 155,18 C 145,14 130,16 100,14 C 60,12 30,18 0,16 Z",
    // 여러 가닥이 나란한 실타래 형태
    "M 5,10 C 40,6 90,3 140,7 L 145,10 C 90,8 40,10 5,13 Z M 0,18 C 35,14 85,12 130,15 L 132,18 C 85,16 35,19 0,21 Z",
    // 짧고 끊긴 솜털 가닥들
    "M 10,12 C 25,8 45,8 60,12 L 58,16 C 43,14 25,14 10,16 Z M 75,9 C 90,5 110,5 125,9 L 123,13 C 108,11 90,11 75,13 Z M 135,13 C 148,10 165,10 175,13 L 173,17 C 163,15 148,15 135,17 Z",
    // 길고 균일한 수평 띠
    "M 0,14 C 60,10 120,10 190,14 L 190,17 C 120,13 60,13 0,17 Z",
  ],

  // ── 권적운 (Cirrocumulus): 잔물결·비늘 패턴, 작은 알갱이들의 규칙적 배열 ─
  Cirrocumulus: [
    // 체스판형 소규모 셀 패턴
    "M 5,8 C 9,4 13,4 17,8 C 15,11 9,11 5,8 Z M 22,6 C 26,2 30,2 34,6 C 32,9 26,9 22,6 Z M 39,8 C 43,4 47,4 51,8 C 49,11 43,11 39,8 Z M 56,6 C 60,2 64,2 68,6 C 66,9 60,9 56,6 Z M 12,18 C 16,14 20,14 24,18 C 22,21 16,21 12,18 Z M 30,16 C 34,12 38,12 42,16 C 40,19 34,19 30,16 Z M 48,18 C 52,14 56,14 60,18 C 58,21 52,21 48,18 Z",
    // 물결처럼 이어진 연속 소포 패턴
    "M 0,12 C 8,6 16,6 24,12 C 32,6 40,6 48,12 C 56,6 64,6 72,12 C 80,6 88,6 96,12 L 96,16 C 88,12 80,14 72,16 C 64,12 56,14 48,16 C 40,12 32,14 24,16 C 16,12 8,14 0,16 Z",
    // 행列로 정렬된 타원 소포 집합
    "M 4,7 C 10,3 18,3 24,7 C 22,11 8,11 4,7 Z M 28,5 C 34,1 42,1 48,5 C 46,9 30,9 28,5 Z M 52,7 C 58,3 66,3 72,7 C 70,11 54,11 52,7 Z M 10,17 C 16,13 24,13 30,17 C 28,21 12,21 10,17 Z M 38,15 C 44,11 52,11 58,15 C 56,19 40,19 38,15 Z M 64,17 C 70,13 78,13 84,17 C 82,21 66,21 64,17 Z",
    // 듬성듬성한 비늘 패턴
    "M 10,10 C 18,4 28,4 36,10 C 34,15 16,15 10,10 Z M 45,8 C 53,2 63,2 71,8 C 69,13 47,13 45,8 Z M 25,22 C 33,16 43,16 51,22 C 49,27 27,27 25,22 Z M 60,20 C 68,14 78,14 86,20 C 84,25 62,25 60,20 Z",
  ],

  // ── 권층운 (Cirrostratus): 베일처럼 넓고 균일하게 덮이는 막 형태 ──────────
  Cirrostratus: [
    // 얇고 균일한 넓은 띠
    "M 0,14 C 60,11 130,11 200,14 L 200,20 C 130,23 60,23 0,20 Z",
    // 살짝 물결치는 베일
    "M 0,16 C 30,12 70,10 110,14 C 150,10 190,12 230,16 L 230,22 C 190,18 150,20 110,22 C 70,18 30,20 0,22 Z",
    // 가장자리가 흐릿한 넓은 막
    "M 0,20 C 50,14 110,12 170,16 C 200,14 220,18 240,22 L 240,28 C 200,24 160,26 120,24 C 80,22 40,26 0,28 Z",
    // 중앙이 두껍고 가장자리로 가면서 얇아지는 렌즈형
    "M 10,20 C 40,12 80,8 120,10 C 160,8 200,12 220,20 C 200,28 160,32 120,30 C 80,32 40,28 10,20 Z",
  ],

  // ── 고적운 (Altocumulus): 중형 덩어리들이 줄지어 있는 양떼 형태 ────────────
  Altocumulus: [
    // 큰 덩어리 3개가 연결된 형태
    "M 10,22 C 10,14 22,10 38,10 C 50,6 72,6 85,14 C 98,8 118,8 130,18 C 145,14 165,16 172,24 L 172,28 C 120,32 60,30 10,28 Z",
    // 좌우가 비대칭인 울퉁불퉁 덩어리
    "M 15,28 C 15,18 28,12 48,14 C 58,8 85,6 100,14 C 115,6 140,8 155,20 C 165,16 185,18 190,28 Z",
    // 낮게 깔린 둥근 혹 연속 형태
    "M 5,25 C 5,18 15,14 30,14 C 40,10 55,10 65,16 C 75,10 90,10 100,16 C 110,10 125,10 135,16 C 145,10 160,12 168,22 L 168,28 C 90,32 5,30 5,25 Z",
    // 수직 발달이 있는 탑 형태 (고적운 종탑형)
    "M 20,30 C 20,22 28,18 40,18 C 45,12 58,8 70,12 C 82,8 95,12 100,20 C 110,16 122,18 130,26 C 140,22 155,24 160,30 Z",
    // 3열 배치 패턴
    "M 8,18 C 8,14 14,10 24,10 C 34,10 40,14 40,18 Z M 45,16 C 45,11 52,7 64,7 C 76,7 83,11 83,16 Z M 88,18 C 88,14 95,10 106,10 C 117,10 124,14 124,18 Z M 25,28 C 25,23 32,20 44,20 C 56,20 63,23 63,28 Z M 68,26 C 68,21 75,18 87,18 C 99,18 106,21 106,26 Z",
  ],

  // ── 고층운 (Altostratus): 두꺼운 회색 판, 윤곽이 불분명한 층 ──────────────
  Altostratus: [
    // 넓고 두꺼운 불규칙한 덩어리
    "M 0,28 C 25,14 60,10 95,20 C 125,10 165,14 200,8 C 230,12 250,22 260,28 C 260,44 235,50 200,46 C 160,54 120,44 80,50 C 40,46 20,52 0,44 Z",
    // 울퉁불퉁한 밑면이 있는 두꺼운 층
    "M 0,22 C 30,10 75,8 110,18 C 145,8 185,12 220,6 C 250,10 270,20 280,28 C 270,40 240,46 200,42 C 160,50 120,42 80,48 C 40,44 15,50 0,40 Z",
    // 중앙이 불룩하게 아래로 처진 형태
    "M 0,18 C 40,12 90,10 140,14 C 160,10 200,14 240,20 C 230,30 200,36 160,32 C 120,36 80,30 40,34 C 20,32 5,28 0,22 Z",
    // 가장자리가 흐릿하게 녹아드는 넓은 덩어리
    "M 10,24 C 30,12 70,8 110,16 C 140,8 180,12 210,18 C 225,14 245,18 250,26 C 240,38 200,44 160,40 C 120,46 80,40 40,44 C 20,40 8,34 10,28 Z",
  ],

  // ── 난층운 (Nimbostratus): 두껍고 어두운 비구름, 밑면이 들쭉날쭉 ──────────
  Nimbostratus: [
    // 두껍고 짙은 비구름 — 비늘 같은 밑면
    "M 0,42 C 35,24 75,18 110,32 C 145,14 185,28 225,18 C 258,24 275,38 285,48 C 280,78 252,88 218,82 C 178,92 138,84 100,92 C 62,84 32,90 0,78 Z",
    // 여러 층이 겹친 불규칙한 형태
    "M 0,38 C 25,22 60,16 90,28 C 115,14 150,20 180,12 C 210,18 235,30 255,42 C 245,60 215,68 180,64 C 145,72 110,64 75,70 C 45,64 18,70 0,60 Z",
    // 하단이 거칠게 찢어진 형태
    "M 5,45 C 30,25 70,15 105,30 C 130,12 170,22 205,15 C 235,20 258,35 265,50 C 255,68 220,78 185,72 C 148,80 110,72 75,78 C 40,72 12,78 5,62 Z M 30,80 C 50,72 70,78 90,72 M 120,82 C 140,74 160,80 180,74",
    // 수직 발달이 있는 두꺼운 적난형
    "M 20,55 C 20,38 35,28 55,30 C 50,12 75,2 95,10 C 115,2 140,15 135,35 C 155,30 175,40 170,58 C 185,55 195,62 192,70 C 175,75 100,78 20,70 Z",
  ],

  // ── 층적운 (Stratocumulus): 중간 높이의 납작한 덩어리들이 연결된 형태 ──────
  Stratocumulus: [
    // 여러 봉우리가 연결된 물결형
    "M 15,28 C 15,20 25,14 40,16 C 50,10 72,10 82,18 C 92,12 112,12 125,20 C 138,14 158,16 168,26 C 178,22 195,26 198,32 C 160,36 80,36 15,34 Z",
    // 넓게 퍼진 납작한 쿠션 형태
    "M 10,24 C 10,18 22,12 42,12 C 55,6 82,6 98,14 C 115,8 145,10 158,18 C 172,14 192,16 200,24 L 200,30 C 150,34 70,34 10,30 Z",
    // 울퉁불퉁한 상면, 평평한 하면
    "M 8,32 C 8,24 20,18 36,20 C 42,14 58,12 70,16 C 80,10 100,10 112,16 C 122,12 140,12 152,18 C 162,14 180,16 188,24 L 188,32 Z",
    // 가운데가 끊긴 틈새가 있는 층
    "M 5,22 C 5,16 15,12 30,12 C 42,8 60,8 72,14 C 82,10 95,12 102,20 L 102,26 C 80,24 40,24 5,26 Z M 115,20 C 115,14 126,10 140,10 C 152,6 170,6 182,12 C 192,8 205,10 212,18 L 212,24 C 190,22 145,22 115,24 Z",
    // 3단 구름탑 복합 형태
    "M 10,30 C 10,22 20,16 36,18 C 44,12 62,10 78,16 C 88,10 108,10 120,18 C 132,12 150,14 160,22 C 170,18 185,20 190,28 L 190,34 C 130,38 60,38 10,34 Z",
  ],

  // ── 층운 (Stratus): 안개처럼 낮게 깔리는 균질한 회색 막 ───────────────────
  Stratus: [
    // 지평선에 붙은 납작한 안개 띠
    "M 0,16 C 35,10 85,10 135,16 C 168,20 200,12 230,18 L 230,28 C 195,22 160,30 120,26 C 80,22 40,28 0,24 Z",
    // 약간 물결치는 층
    "M 0,18 C 40,12 90,12 140,18 C 170,14 200,18 230,16 L 230,24 C 200,22 165,26 130,22 C 90,18 45,24 0,22 Z",
    // 균일하고 두꺼운 층
    "M 0,20 C 50,14 120,12 190,16 C 210,14 225,18 240,22 L 240,32 C 210,28 170,32 130,28 C 80,24 40,30 0,28 Z",
    // 가장자리가 흐릿한 안개형
    "M 5,22 C 30,14 70,12 110,16 C 145,12 180,16 210,20 L 210,30 C 175,26 135,30 100,26 C 65,22 30,28 5,26 Z",
  ],

  // ── 적운 (Cumulus): 꽃양배추처럼 위로 솟은 뭉게구름 ────────────────────────
  Cumulus: [
    // 전형적인 꽃양배추 봉우리 형태
    "M 15,38 C 15,28 25,20 40,20 C 48,12 65,8 82,12 C 98,4 125,4 140,14 C 150,10 168,14 174,26 C 184,24 190,30 190,38 Z",
    // 여러 봉우리가 연결된 복합 형태
    "M 20,42 C 20,30 32,22 50,22 C 58,14 78,10 98,14 C 112,6 138,4 155,16 C 168,10 185,14 192,28 C 202,26 210,32 210,42 Z",
    // 납작하지만 봉우리가 분명한 형태 (Fair-weather cumulus)
    "M 10,30 C 10,24 18,18 32,18 C 38,14 52,12 65,16 C 72,12 85,12 96,16 C 102,12 115,14 122,22 L 122,30 Z",
    // 크게 발달한 탑형 적운
    "M 25,45 C 25,32 38,22 55,24 C 60,12 80,4 100,8 C 120,2 145,8 148,24 C 162,20 178,26 182,40 C 192,36 200,42 200,50 Z",
    // 해안형 — 밑면은 평평하고 위는 솟은 독립 봉우리
    "M 30,40 C 30,32 40,26 54,26 C 62,20 78,16 94,20 C 108,14 130,14 145,22 C 158,18 172,22 178,32 L 178,40 Z",
  ],

  // ── 적란운 (Cumulonimbus): 탑 모양, 상단이 넓게 퍼지는 모루구름 ────────────
  Cumulonimbus: [
    // 전형적인 모루구름 — 상단이 납작하게 퍼짐
    "M 20,65 C 20,52 30,44 45,44 C 38,30 55,16 72,22 C 65,4 120,4 114,28 C 132,22 152,34 148,52 C 162,50 170,57 170,65 Z M 5,22 C 30,18 170,18 195,22 L 195,25 C 170,21 30,21 5,25 Z",
    // 좌우 비대칭 모루구름
    "M 15,58 C 15,44 25,36 40,36 C 32,18 55,6 78,14 C 70,2 115,2 108,22 C 126,16 148,28 142,46 C 158,44 168,52 165,62 Z M 0,16 C 25,12 140,12 185,16 L 185,20 C 140,16 25,16 0,20 Z",
    // 슈퍼셀 — 극도로 발달한 나선 형태
    "M 25,70 C 25,55 38,44 55,46 C 48,28 68,12 90,18 C 82,2 130,0 122,22 C 140,16 165,28 158,50 C 175,48 185,56 182,68 Z",
    // 멀티셀 — 여러 탑이 연결된 형태
    "M 10,55 C 10,44 18,36 30,36 C 24,22 38,14 52,18 C 60,8 90,6 95,20 C 110,14 128,20 130,36 C 142,32 155,38 158,50 C 168,48 178,54 175,60 Z M 178,50 C 178,42 185,36 195,36 C 190,26 200,18 212,22 C 210,14 235,12 232,24 C 242,20 250,26 248,38 Z",
  ],
};



export const CLOUD_TEMPLATES_HORIZONTAL: Record<CloudPresetName, string[]> = {
  Cirrus: [
    "M 0,10 C 30,8 70,5 110,8 C 140,10 180,7 210,10 C 180,12 140,11 110,13 C 70,14 30,13 0,10 Z"
  ],
  Cirrocumulus: [
    "M 5,8 C 10,5 15,5 20,8 C 18,10 12,10 5,8 Z M 30,6 C 35,3 40,3 45,6 C 43,8 37,8 30,6 Z M 55,8 C 60,5 65,5 70,8 C 68,10 62,10 55,8 Z M 80,6 C 85,3 90,3 95,6 C 93,8 87,8 80,6 Z M 15,16 C 20,13 25,13 30,16 C 28,18 22,18 15,16 Z M 42,14 C 47,11 52,11 57,14 C 55,16 49,16 42,14 Z M 68,16 C 73,13 78,13 83,16 C 81,18 75,18 68,16 Z"
  ],
  Cirrostratus: [
    "M 0,8 C 60,6 120,6 180,8 L 180,11 C 120,13 60,13 0,11 Z"
  ],
  Altocumulus: [
    "M 10,10 C 25,6 40,6 55,10 C 70,6 85,6 100,10 C 115,6 130,6 145,10 C 160,6 175,6 190,10 L 190,13 C 145,15 100,15 55,13 L 10,10 Z"
  ],
  Altostratus: [
    "M 0,20 C 30,8 70,6 110,16 C 150,6 190,10 230,5 C 260,10 280,18 300,22 C 300,35 270,38 230,35 C 190,42 150,35 110,40 C 70,38 30,42 0,35 Z"
  ],
  Nimbostratus: [
    "M 0,30 C 40,15 90,10 130,25 C 170,8 210,20 250,15 C 280,20 300,32 320,40 C 320,65 290,72 250,68 C 210,76 170,70 130,76 C 90,70 45,75 0,65 Z"
  ],
  Stratocumulus: [
    "M 10,15 C 25,10 45,8 65,12 C 85,6 115,6 135,14 C 155,8 185,10 205,18 C 225,16 245,20 255,25 C 220,27 185,25 10,25 Z"
  ],
  Stratus: [
    "M 0,10 C 40,5 100,5 150,10 C 190,12 220,7 260,10 L 260,22 C 220,18 180,24 130,20 C 80,17 40,20 0,17 Z"
  ],
  Cumulus: [
    "M 10,18 C 25,12 45,10 65,12 C 85,8 115,8 135,14 C 155,10 185,12 205,18 C 175,21 145,21 115,20 C 85,20 45,20 10,18 Z"
  ],
  Cumulonimbus: [
    "M 10,25 C 25,18 45,15 65,18 C 85,12 115,12 135,22 C 155,15 185,18 205,25 C 175,28 145,28 115,27 C 85,27 45,27 10,25 Z"
  ]
};


// ── 광학·운형 판정 (THREE 비의존) ──────────────────────────────────────

/**
 * 이 블록이 왜 여기 있나: 사전 계산(`skyTimeline`)이 렌더러를 끌고 오면 안 됩니다.
 * 원래 `cloudPlacement.ts`에 있었는데, 그 파일은 `cloudAtlas`를 통해 THREE에
 * 의존합니다. 순수 데이터인 이 셋만 내려서 계층을 되돌립니다.
 */
export interface CloudOpticsConfig {
  tau: number;
  opacity: number;
  shadowContrast: number;
  rimSharpness: number;
}

export const PRESET_OPTICS: Record<CloudPresetName, CloudOpticsConfig> = {
  Cirrus:        { tau: 3.0,   opacity: 0.38, shadowContrast: 0.12, rimSharpness: 0.25 },
  Cirrocumulus:  { tau: 4.2,   opacity: 0.42, shadowContrast: 0.15, rimSharpness: 0.30 },
  Cirrostratus:  { tau: 5.0,   opacity: 0.45, shadowContrast: 0.10, rimSharpness: 0.20 },
  Altocumulus:   { tau: 16.0,  opacity: 0.72, shadowContrast: 0.48, rimSharpness: 0.60 },
  Altostratus:   { tau: 30.0,  opacity: 0.82, shadowContrast: 0.38, rimSharpness: 0.35 },
  Stratocumulus: { tau: 35.0,  opacity: 0.90, shadowContrast: 0.62, rimSharpness: 0.70 },
  Stratus:       { tau: 22.0,  opacity: 0.80, shadowContrast: 0.28, rimSharpness: 0.25 },
  Cumulus:       { tau: 32.0,  opacity: 0.92, shadowContrast: 0.78, rimSharpness: 0.88 },
  Cumulonimbus:  { tau: 220.0, opacity: 0.99, shadowContrast: 0.94, rimSharpness: 0.95 },
  Nimbostratus:  { tau: 110.0, opacity: 0.98, shadowContrast: 0.88, rimSharpness: 0.45 },
};

export function resolvePresetFromWeather(
  layer: LayerKey,
  cover: number,
  wx: { precipitation?: number; humidity?: number; lowPct: number; highPct: number },
  seed: number
): CloudPresetName {
  const precip = wx.precipitation ?? 0;
  const rh = wx.humidity ?? 60;

  if (layer === 'high') {
    if (cover > 0.65) return 'Cirrostratus';
    if (cover > 0.3) return seed < 0.5 ? 'Cirrocumulus' : 'Cirrus';
    return 'Cirrus';
  }

  if (layer === 'mid') {
    if (precip > 0.2 || cover > 0.7) return 'Altostratus';
    return 'Altocumulus';
  }

  // low
  // 적란운 조건이 강수 2.0mm/h + 상층 45% 였는데, 2.0mm/h는 꽤 센 비라
  // 실제로는 거의 걸리지 않았습니다. 대류성 소나기의 서명(상층까지 발달)은
  // 유지하되 문턱을 관측 가능한 수준으로 낮춥니다.
  if (precip > 0.9 && wx.highPct > 35) return 'Cumulonimbus';
  if (precip > 0.3 && cover > 0.6) return 'Nimbostratus';
  if (cover > 0.6) return rh > 90 ? 'Stratus' : 'Stratocumulus';
  if (cover > 0.35) return seed < 0.65 ? 'Cumulus' : 'Stratocumulus';
  return 'Cumulus';
}

/**
 * 관측점 기상에서 층별 대표 광학두께를 뽑습니다.
 *
 * 태양 방향 기둥을 풀 때 필요합니다. 운형 판정이 방향마다 달라질 수 있으므로
 * 관측점 값으로 대표를 잡습니다.
 *
 * `skyTimeline`의 사전 계산도 **이 함수를 그대로** 씁니다 — 두 곳에서 따로
 * 구현하면 사전 계산과 실시간 계산의 광학이 갈라집니다.
 */
export function representativeTauForObserver(
  layer: LayerKey,
  obs: CloudData | undefined
): number {
  const coverPct = layer === 'low' ? obs?.low ?? 0 : layer === 'mid' ? obs?.mid ?? 0 : obs?.high ?? 0;
  const name = resolvePresetFromWeather(
    layer,
    coverPct / 100,
    {
      precipitation: obs?.precipitation,
      humidity: obs?.humidity,
      lowPct: obs?.low ?? 0,
      highPct: obs?.high ?? 0,
    },
    0.5
  );
  return (PRESET_OPTICS[name] ?? PRESET_OPTICS.Cumulus).tau;
}
