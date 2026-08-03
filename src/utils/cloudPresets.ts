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

// Collage / Papercraft cloud SVG templates categorized by 10 specific cloud types
export const CLOUD_TEMPLATES: Record<CloudPresetName, string[]> = {
  Cirrus: [
    "M 0,20 C 20,15 45,8 70,12 C 85,14 110,7 130,12 C 105,16 80,13 55,20 C 35,25 15,23 0,20 Z",
    "M 0,15 C 30,12 60,6 90,12 C 110,16 130,8 150,15 C 120,18 90,15 60,20 C 30,22 15,19 0,15 Z"
  ],
  Cirrocumulus: [
    "M 5,12 C 10,8 15,8 20,12 C 18,15 12,15 5,12 Z M 30,10 C 35,6 40,6 45,10 C 43,13 37,13 30,10 Z M 55,12 C 60,8 65,8 70,12 C 68,15 62,15 55,12 Z M 15,22 C 20,18 25,18 30,22 C 28,25 22,25 15,22 Z M 42,20 C 47,16 52,16 57,20 C 55,23 49,23 42,20 Z M 68,22 C 73,18 78,18 83,22 C 81,25 75,25 68,22 Z",
    "M 10,10 C 14,6 18,6 22,10 C 20,13 16,13 10,10 Z M 32,12 C 36,8 40,8 44,12 C 42,15 38,15 32,12 Z M 54,10 C 58,6 62,6 66,10 C 64,13 60,13 54,10 Z M 21,20 C 25,16 29,16 33,20 C 31,23 27,23 21,20 Z M 43,22 C 47,18 51,18 55,22 C 53,25 49,25 43,22 Z"
  ],
  Cirrostratus: [
    "M 0,15 C 50,12 100,12 150,15 L 150,20 C 100,23 50,23 0,20 Z"
  ],
  Altocumulus: [
    "M 10,20 C 15,12 25,12 35,20 C 45,12 55,12 65,20 C 75,12 85,12 95,20 C 105,12 115,12 125,20 L 125,25 C 95,28 65,28 35,25 L 10,20 Z",
    "M 10,20 C 10,14 20,10 35,10 C 45,5 65,5 75,12 C 85,8 100,8 110,14 C 120,10 135,12 140,20 Z"
  ],
  Altostratus: [
    "M 0,25 C 20,10 50,8 80,18 C 110,8 140,12 170,5 C 200,10 220,18 240,25 C 240,40 220,45 200,42 C 160,48 120,40 80,45 C 40,42 20,48 0,40 Z"
  ],
  Nimbostratus: [
    "M 0,40 C 30,20 70,15 100,30 C 130,10 170,25 210,15 C 240,20 260,35 280,45 C 280,75 250,85 220,80 C 180,90 140,82 100,90 C 60,82 30,88 0,75 Z"
  ],
  Stratocumulus: [
    "M 15,25 C 15,18 28,12 45,16 C 55,8 80,8 95,18 C 110,10 135,12 145,22 C 155,20 170,25 175,32 C 150,35 125,32 15,32 Z",
    "M 15,22 C 15,16 25,12 40,12 C 50,7 72,7 82,14 C 92,10 110,10 120,16 C 130,12 145,14 150,22 Z"
  ],
  Stratus: [
    "M 0,15 C 30,8 80,8 120,15 C 150,18 180,10 200,15 L 200,30 C 170,25 140,32 100,28 C 60,24 30,28 0,25 Z"
  ],
  Cumulus: [
    "M 15,35 C 15,25 25,18 40,18 C 50,10 70,8 85,12 C 100,5 125,5 140,15 C 150,12 165,15 170,25 C 180,25 185,30 185,35 C 185,38 15,38 15,35 Z",
    "M 20,40 C 20,28 32,20 50,20 C 60,10 82,8 100,12 C 118,4 146,4 163,16 C 175,12 192,16 198,28 C 210,28 215,34 215,40 Z"
  ],
  Cumulonimbus: [
    "M 20,60 C 20,50 30,45 40,45 C 30,30 50,15 70,20 C 60,-5 120,-5 110,25 C 130,20 150,35 140,50 C 155,50 160,55 160,60 Z",
    "M 10,50 C 10,42 16,36 28,36 C 20,20 45,10 65,18 C 55,2 105,2 95,24 C 112,20 130,30 120,45 C 130,45 135,48 135,50 Z"
  ]
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
