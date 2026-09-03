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
import { getTuning } from './skyTuning';
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
    // ── 탑형 (congestus) — 인덱스 5부터 (docs/CLOUD_VARIETY_PLAN.md 5단계) ──
    //
    // 위의 다섯은 전부 **가로가 긴 판**입니다 (종횡비 2.3~5.6). 그래서
    // 배치에서 종횡비를 세로로 열어 줘도 넓은 꽃양배추를 가로로 눌러 놓은
    // 모양이 될 뿐, 솟은 탑이 나오지 않습니다. 세로로 긴 실루엣 자체가
    // 필요합니다 (종횡비 0.54~0.65).
    //
    // `tools/shader-preview/gen-congestus-paths.js` 로 생성했습니다 —
    // 손으로 베지에를 찍으면 재현이 안 되기 때문입니다. 생성기를 다시 돌리면
    // 같은 문자열이 나옵니다(씨앗 고정). 런타임 생성이 아니라 정적 문자열인
    // 이유는 앱과 하네스가 다른 모양을 그리면 안 되기 때문입니다.
    "M 28,150 C 14.9,147.7 10.7,129.5 21.3,121.6 C 11,116.6 10.9,98.4 21,93.2 C 15.2,87.9 15.7,69.7 21.9,64.8 C 15.9,59.1 17.7,40.9 24.7,36.4 C 18.1,29.4 22.5,11.3 31.5,8 C 28.4,-2.1 39,-9.7 47.7,-3.8 C 50.8,-11.1 61.4,-10.9 64.3,-3.6 C 72,-8.2 82.6,-0.8 80.9,8 C 85.9,12.4 89.7,30.5 87.2,36.4 C 97.6,41.2 98.1,59.4 87.9,64.8 C 91.6,70.6 88.7,88.8 83.4,93.2 C 89.8,100 85.7,118.2 77,121.6 C 81.3,128.4 75.9,146.6 68.5,150 L 28,150 Z",
    "M 28.5,138 C 17.5,136.9 11,120.2 18.3,112 C 11.9,107.5 11.3,90.9 17.4,86 C 10.9,80.6 12.7,63.9 20.2,60 C 12.8,54.7 14.2,38 22.4,34 C 15.4,29.2 15.6,12.6 22.8,8 C 22.1,2.1 29.7,-1.3 34.1,2.7 C 36.4,-2.2 44,-1.9 45.9,3.2 C 50,-0.7 57.6,2.3 57.8,8 C 64.2,11.5 68.3,28.2 64.9,34 C 73.9,36.9 77.7,53.5 70.7,60 C 78.4,63.2 82.2,79.8 76.7,86 C 87.4,89.6 89.1,106.3 79.4,112 C 88.1,119.6 83.3,136.3 71.8,138 L 28.5,138 Z",
    "M 29.9,160 C 17.1,159.4 7.7,139.9 15.2,129.6 C 7.7,125.8 2.1,106.4 6.5,99.2 C -3.8,93 -2.6,73.6 8.5,68.8 C -0.1,58.6 8.3,39.2 21.5,38.4 C 17.8,28.8 29.3,9.3 39.6,8 C 39.4,-0.4 49,-7.5 56.4,-3.1 C 59.6,-11.7 69.3,-11.2 71.6,-2.3 C 79.5,-8.1 89.1,-1.5 86.7,8 C 92.2,12.1 96.5,31.6 91.6,38.4 C 103.4,41.1 108.6,60.6 99.7,68.8 C 104.7,74 105.6,93.5 101.2,99.2 C 107.3,107.1 101.2,126.6 91.7,129.6 C 93.9,138.4 82.1,157.9 73.3,160 L 29.9,160 Z",
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



/**
 * `CLOUD_TEMPLATES.Cumulus` 중 **탑형(congestus)** 실루엣이 시작하는 인덱스.
 *
 * 아틀라스는 이 배열 순서대로 변종을 굽고 `cloudAtlasKey(name, i)` 로
 * 부르므로, 인덱스가 곧 아틀라스 키입니다. 배치가 대류 강도(vigor)로
 * 이 앞뒤 중 어느 구간에서 고를지 정합니다.
 */
export const CUMULUS_TOWER_FIRST = 5;

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

  // ── 덱 조각 기하 (docs/CLOUD_TEXTURE_PLAN.md 3-B) ────────────────────────
  /**
   * 구름 조각(요소) 하나의 **물리 크기** (km).
   *
   * 각크기가 아니라 물리 크기인 것이 핵심입니다. 같은 조각이라도 낮은
   * 고도각에서는 훨씬 멀어 작게 보여야 하는데, 그 원근 단축은 덱 셰이더의
   * 지상거리 투영이 알아서 만들어 줍니다.
   *
   * 값의 출처는 **WMO 속 분류 자체**입니다. WMO는 권적운·고적운·층적운을
   * 구성 요소의 각크기로 구분합니다 (고도 30° 이상에서 관측했을 때):
   *
   *   권적운 Cc  < 1°   상층 8km  → 30°에서 14km  → 244m 미만
   *   고적운 Ac  1~5°   중층 4km  → 30°에서  7km  → 122~611m
   *   층적운 Sc  > 5°   저층 1.5km → 30°에서  3km  → 262m 초과
   *
   * 즉 분류 기준이 곧 우리에게 필요한 숫자입니다. 새 입력이 필요 없습니다.
   */
  cellSizeKm: number;
  /**
   * 조각 무늬를 얼마나 강하게 낼 것인가 (0 = 조각 없는 연속 베일).
   *
   * 층운·난층운·고층운·권층운은 0입니다 — WMO 정의상 **요소가 없는**
   * 구름이라 조각을 내면 오히려 틀립니다. 지금 덱이 잘 그리는 유일한
   * 하늘이 바로 그쪽이고, 0으로 두면 그 동작이 그대로 보존됩니다.
   */
  cellStrength: number;
  /**
   * 어느 채널의 무늬를 쓸 것인가 (`cloudCellField`가 구운 RGBA 중).
   *
   * 렌더로 비교했을 때 `billow`(둥근 알갱이가 또렷)가 고적운·권적운에 맞고,
   * `fbm`(덩어리가 이어짐)이 층적운·적운 쪽입니다.
   */
  cellVariant: 'billow' | 'fbm';
  /**
   * 조각의 **바람 방향 늘임 비율** (1 = 등방).
   *
   * 권운(Ci)만 1이 아닙니다. 권운은 낙하하는 얼음 결정이 상하층 풍속차에
   * 끌려가며 생기는 **낙적운(fall streak)** 이라, 태생부터 바람 방향으로
   * 길게 늘어난 필라멘트입니다.
   *
   * 셰이더는 지상 좌표를 바람 정렬 축으로 회전한 뒤 축마다 다른 배율을
   * 적용합니다 — 가로지르는 쪽은 `cellSizeKm`, 바람 쪽은
   * `cellSizeKm * cellAspect`. 비율이 1이면 회전이 무의미해지므로
   * 나머지 아홉 운형은 이 코드 경로의 영향을 전혀 받지 않습니다.
   *
   * ⚠ **물리 비율 20을 그대로 쓰면 안 됩니다.** 낙하줄 하나의 실제 비율은
   * 300 m × 6 km ≒ 20이지만, 그건 *조각 하나*의 비율입니다. 이 배율은
   * 무늬의 **모든 옥타브에 한꺼번에** 걸리므로, 20을 주면 낱개 줄뿐 아니라
   * 줄이 모여 이루는 큰 덩어리까지 20배로 늘어납니다. 그 결과는 필라멘트가
   * 아니라 화면을 가로지르는 **끊기지 않는 블라인드**입니다 (종횡비 훑기
   * 렌더로 확인: 6부터 이미 리본이 되고 20은 완전한 줄무늬).
   *
   * 4는 그 훑기에서 고른 값입니다 — 줄이 뚜렷이 바람 방향으로 눕되 잘게
   * 끊겨 있는 마지막 지점. 큰 덩어리까지 늘이지 않고 낱개만 늘이려면
   * 옥타브별로 다른 배율을 먹여야 하는데, 그건 무늬를 다시 굽는 일이라
   * 여기 범위 밖입니다.
   */
  cellAspect: number;
}

export const PRESET_OPTICS: Record<CloudPresetName, CloudOpticsConfig> = {
  Cirrus:        { tau: 3.0,   opacity: 0.38, shadowContrast: 0.12, rimSharpness: 0.25,
                   cellSizeKm: 0.30, cellStrength: 0.55, cellVariant: 'fbm', cellAspect: 4 },
  Cirrocumulus:  { tau: 4.2,   opacity: 0.42, shadowContrast: 0.15, rimSharpness: 0.30,
                   cellSizeKm: 0.20, cellStrength: 0.95, cellVariant: 'billow', cellAspect: 1 },
  Cirrostratus:  { tau: 5.0,   opacity: 0.45, shadowContrast: 0.10, rimSharpness: 0.20,
                   cellSizeKm: 0.00, cellStrength: 0.00, cellVariant: 'fbm', cellAspect: 1 },
  Altocumulus:   { tau: 16.0,  opacity: 0.72, shadowContrast: 0.48, rimSharpness: 0.60,
                   cellSizeKm: 0.50, cellStrength: 0.95, cellVariant: 'billow', cellAspect: 1 },
  Altostratus:   { tau: 30.0,  opacity: 0.82, shadowContrast: 0.38, rimSharpness: 0.35,
                   cellSizeKm: 0.00, cellStrength: 0.00, cellVariant: 'fbm', cellAspect: 1 },
  Stratocumulus: { tau: 35.0,  opacity: 0.90, shadowContrast: 0.62, rimSharpness: 0.70,
                   cellSizeKm: 2.00, cellStrength: 0.85, cellVariant: 'fbm', cellAspect: 1 },
  Stratus:       { tau: 22.0,  opacity: 0.80, shadowContrast: 0.28, rimSharpness: 0.25,
                   cellSizeKm: 0.00, cellStrength: 0.00, cellVariant: 'fbm', cellAspect: 1 },
  Cumulus:       { tau: 32.0,  opacity: 0.92, shadowContrast: 0.78, rimSharpness: 0.88,
                   cellSizeKm: 1.20, cellStrength: 0.90, cellVariant: 'fbm', cellAspect: 1 },
  Cumulonimbus:  { tau: 220.0, opacity: 0.99, shadowContrast: 0.94, rimSharpness: 0.95,
                   cellSizeKm: 4.00, cellStrength: 0.70, cellVariant: 'fbm', cellAspect: 1 },
  Nimbostratus:  { tau: 110.0, opacity: 0.98, shadowContrast: 0.88, rimSharpness: 0.45,
                   cellSizeKm: 0.00, cellStrength: 0.00, cellVariant: 'fbm', cellAspect: 1 },
};

export function resolvePresetFromWeather(
  layer: LayerKey,
  cover: number,
  wx: { precipitation?: number; humidity?: number; lowPct: number; highPct: number },
  seed: number
): CloudPresetName {
  const precip = wx.precipitation ?? 0;
  const rh = wx.humidity ?? 60;
  // 문턱은 개발자 패널에서 조정합니다 (utils/skyTuning.ts).
  // "비가 오는데 왜 뭉게구름이냐" 같은 판단은 실제 하늘을 보면서 맞춰야
  // 하는 값이라, 상수로 박아두면 매번 빌드를 다시 해야 합니다.
  const T = getTuning();

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
  if (precip > T.cbPrecipMm && wx.highPct > T.cbHighPct) return 'Cumulonimbus';
  if (precip > T.nsPrecipMm && cover > T.nsCover) return 'Nimbostratus';
  if (cover > T.stratusCover) return rh > T.stratusHumidityPct ? 'Stratus' : 'Stratocumulus';
  if (cover > T.cumulusCover) return seed < 0.65 ? 'Cumulus' : 'Stratocumulus';
  return 'Cumulus';
}

// ── 수직 발달 (docs/CLOUD_VARIETY_PLAN.md 5단계) ───────────────────────────

const clamp01x = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 구름 **밑면** 고도 (응결고도 LCL, km).
 *
 * Espy 근사: LCL[m] ≈ 125 × (T − Td). 그리고 이슬점 편차는 상대습도로
 * (T − Td) ≈ (100 − RH)/5 로 근사됩니다. 둘을 합치면
 *
 *   LCL[km] ≈ 0.125 × (100 − RH)/5 = (100 − RH)/40
 *
 * 습도 50% → 1.25km, 70% → 0.75km, 90% → 0.25km. 실제 관측 범위와 맞습니다.
 *
 * **이게 왜 중요한가**: 적운의 밑면은 응결고도 하나에서 결정되므로 하늘의
 * 모든 적운이 **같은 높이에 평평한 밑면**을 갖습니다. 사진에서 뭉게구름
 * 아래쪽이 자로 그은 듯 나란한 것이 그 때문입니다. 지금까지는 이 고도가
 * 상수(1.6km)라 습도와 무관했습니다.
 */
export function cloudBaseKm(humidityPct: number): number {
  const rh = Math.max(5, Math.min(100, humidityPct));
  return Math.max(0.15, Math.min(2.5, (100 - rh) / 40));
}

/**
 * 대류 강도 0~1 — 적운이 얼마나 위로 자랐는가.
 *
 * CAPE를 받아오지 않으므로 대용값을 씁니다. 셋 다 이미 있는 값입니다:
 *  - **강수**가 가장 직접적입니다 (적운이 비를 내리면 이미 congestus 이상)
 *  - **습도**가 높으면 상승 기류가 덜 마르며 올라갑니다
 *  - **운량**이 많으면 대류가 활발합니다
 *
 * 상한을 강수 0.9mm/h 로 잡은 것은 그 위가 적란운 문턱(`cbPrecipMm`)이라
 * 종이 바뀌기 때문입니다 — 적운의 vigor는 그 직전까지만 의미가 있습니다.
 */
export function convectiveVigor(
  precipMmH: number,
  humidityPct: number,
  cover: number
): number {
  const p = clamp01x(precipMmH / 0.9);
  const h = clamp01x((humidityPct - 55) / 30);
  const c = clamp01x((cover - 0.15) / 0.5);
  return clamp01x(0.5 * p + 0.28 * h + 0.22 * c);
}

/**
 * 적운·적란운의 **연직 두께** (km).
 *
 * 빌보드가 나오는 종은 이 둘뿐이라 둘만 다룹니다 (나머지 여덟은 덱이
 * 그리고, 덱은 얇은 껍질이라 두께 개념이 없습니다).
 *
 *   humilis   0.7km   맑은 날 납작한 뭉게구름
 *   mediocris 2.5km
 *   congestus 4.7km   사진 ②의 솟은 탑
 *   적란운    7.5~12km
 */
export function convectiveDepthKm(name: CloudPresetName, vigor: number): number {
  if (name === 'Cumulonimbus') return 7.5 + 4.5 * clamp01x(vigor);
  return 0.7 + 4.0 * clamp01x(vigor);
}

/** vigor가 이 값을 넘으면 탑형 실루엣을 씁니다 (congestus 전이). */
export const TOWER_VIGOR = 0.45;

/**
 * 방향별 운형 광학 — **문턱을 부드럽게 넘긴** 값
 * (docs/CLOUD_VARIETY_PLAN.md 2·3단계).
 *
 * ## 왜 그냥 뽑으면 안 되나
 *
 * `resolvePresetFromWeather`는 운량·강수의 **계단 함수**입니다. 그런데 덱이
 * 그 입력을 받는 기상 격자는 방위 24 × 고도 8, 즉 15°짜리 성긴 격자입니다.
 * 계단 함수를 성긴 격자로 표본하면 **문턱을 넘는 등고선이 격자선에 붙어**,
 * 화면에 축에 나란한 사각형으로 나타납니다 (렌더로 확인: 비 구역 경계가
 * 하늘에 네모난 상자로 찍힘). 메시 해상도를 올려도 사라지지 않습니다 —
 * 등고선의 위치를 정하는 것은 메시가 아니라 기상 격자이기 때문입니다.
 *
 * ## 왜 섞는 것이 물리적으로도 맞나
 *
 * 한 방향이 담당하는 입체각은 15°×약 10°입니다. 30km 밖이면 한 변이
 * 8km쯤 되는 하늘 조각이고, 그 안에 운형 하나만 들어 있을 리 없습니다.
 * 실제로는 운량·강수가 그 조각 안에서 분포를 이루고, 분포의 각 부분이
 * 다른 운형입니다. 그러니 대표 하나를 고르는 것보다 **입력 분포 위에서
 * 평균한 광학**이 그 조각을 더 잘 나타냅니다.
 *
 * ## 어떻게
 *
 * 운량과 강수 축으로 5점 스텐실을 잡아 가중 평균합니다. 문턱 위치를
 * 알 필요가 없다는 것이 장점입니다 — 문턱이 어디 있든, 그 근처에서만
 * 자동으로 섞이고 멀리서는 한 운형이 100% 이깁니다
 * (예: 강수 0인 하늘은 다섯 점이 전부 같은 운형이라 평균이 그 운형 그대로).
 *
 * 폭은 각각 예보 격자가 한 칸 사이에 실제로 변하는 정도로 잡았습니다.
 */
const COVER_STENCIL = 0.10;
const PRECIP_STENCIL = 0.25;
/** 중심 : 네 이웃 가중치. 합이 1이 되도록 씁니다. */
const STENCIL_CENTER = 0.40;
const STENCIL_SIDE = 0.15;

export interface BlendedOptics {
  tau: number;
  shadowContrast: number;
  cellSizeKm: number;
  cellStrength: number;
  cellAspect: number;
}

export function blendedOpticsFromWeather(
  layer: LayerKey,
  cover: number,
  wx: { precipitation?: number; humidity?: number; lowPct: number; highPct: number },
  seed: number,
  out?: BlendedOptics
): BlendedOptics {
  const r = out ?? { tau: 0, shadowContrast: 0, cellSizeKm: 0, cellStrength: 0, cellAspect: 1 };
  r.tau = 0;
  r.shadowContrast = 0;
  r.cellSizeKm = 0;
  r.cellStrength = 0;
  r.cellAspect = 0;

  const precip = wx.precipitation ?? 0;
  const add = (c: number, p: number, w: number) => {
    _stencilWx.precipitation = p;
    _stencilWx.humidity = wx.humidity;
    _stencilWx.lowPct = wx.lowPct;
    _stencilWx.highPct = wx.highPct;
    const name = resolvePresetFromWeather(layer, c, _stencilWx, seed);
    const o = PRESET_OPTICS[name] ?? PRESET_OPTICS.Cumulus;
    r.tau += o.tau * w;
    r.shadowContrast += o.shadowContrast * w;
    r.cellSizeKm += o.cellSizeKm * w;
    r.cellStrength += o.cellStrength * w;
    r.cellAspect += o.cellAspect * w;
  };

  add(cover, precip, STENCIL_CENTER);
  add(Math.max(0, cover - COVER_STENCIL), precip, STENCIL_SIDE);
  add(Math.min(1, cover + COVER_STENCIL), precip, STENCIL_SIDE);
  add(cover, Math.max(0, precip - PRECIP_STENCIL), STENCIL_SIDE);
  add(cover, precip + PRECIP_STENCIL, STENCIL_SIDE);
  return r;
}

const _stencilWx: {
  precipitation?: number;
  humidity?: number;
  lowPct: number;
  highPct: number;
} = { lowPct: 0, highPct: 0 };

/**
 * 저층 운형의 두 큰 갈래 — 근거리 볼륨이 쓰는 값입니다 (계획 27·33절).
 *
 * 0 = 적운형(뭉게, 볼록한 덩어리) · 1 = 층운형(먹구름, 평평한 시트).
 * 적란운은 별도 원뿔 표현 몫(계획 23절)이라 아직 없어 당분간 적운형에
 * 둡니다 — 평평한 것보다는 낫습니다.
 */
const LOW_GENUS: Partial<Record<CloudPresetName, number>> = {
  Cumulus: 0,
  Cumulonimbus: 0,
  Stratocumulus: 1,
  Stratus: 1,
};

/**
 * 저층 운형을 **적운형/층운형 스칼라**(0..1)로 뽑습니다.
 *
 * `resolvePresetFromWeather`는 문턱에서 뚝 갈리는 계단함수입니다. 그걸
 * 그대로 쓰면 근거리 볼륨의 뭉게/먹구름 경계가 하늘에 뚜렷한 선으로
 * 보입니다(방위 격자가 성긴 것과 같은 이유 — 위 `blendedOpticsFromWeather`
 * 주석). 같은 5점 스텐실로 부드럽게 섞습니다. 문턱 상수는 새로 만들지 않고
 * `resolvePresetFromWeather`에서 그대로 가져오므로, 개발자 패널의 "운형
 * 판정" 슬라이더가 여기도 같이 움직입니다.
 */
export function lowLayerGenus(
  cover: number,
  wx: { precipitation?: number; humidity?: number; lowPct: number; highPct: number },
  seed: number
): number {
  const precip = wx.precipitation ?? 0;
  let sum = 0;
  const add = (c: number, p: number, w: number) => {
    _stencilWx.precipitation = p;
    _stencilWx.humidity = wx.humidity;
    _stencilWx.lowPct = wx.lowPct;
    _stencilWx.highPct = wx.highPct;
    const name = resolvePresetFromWeather('low', Math.max(0, Math.min(1, c)), _stencilWx, seed);
    sum += (LOW_GENUS[name] ?? 0) * w;
  };
  add(cover, precip, STENCIL_CENTER);
  add(Math.max(0, cover - COVER_STENCIL), precip, STENCIL_SIDE);
  add(Math.min(1, cover + COVER_STENCIL), precip, STENCIL_SIDE);
  add(cover, Math.max(0, precip - PRECIP_STENCIL), STENCIL_SIDE);
  add(cover, precip + PRECIP_STENCIL, STENCIL_SIDE);
  return sum;
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

/**
 * 관측점 기상에서 층별 대표 **운형**을 뽑습니다.
 *
 * `representativeTauForObserver`가 이미 안에서 하던 일을 꺼낸 것뿐입니다.
 * 덱은 광학두께만이 아니라 조각 크기(`cellSizeKm`)도 알아야 하는데,
 * 두 값이 **같은 운형**에서 나와야 광학과 모양이 갈라지지 않습니다.
 */
export function representativePresetForObserver(
  layer: LayerKey,
  obs: CloudData | undefined
): CloudPresetName {
  const coverPct = layer === 'low' ? obs?.low ?? 0 : layer === 'mid' ? obs?.mid ?? 0 : obs?.high ?? 0;
  return resolvePresetFromWeather(
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
}
