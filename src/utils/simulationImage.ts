import { Skia, rect, TileMode, ImageFormat } from '@shopify/react-native-skia';

interface CloudData {
  x: number;
  y: number;
  renderWidth: number;
  renderHeight: number;
  cloudOpacity: number;
  finalLitColor?: string;
  finalShadowColor?: string;
}

// 태양 고도에 따른 정밀한 하늘 그라데이션 색상 배열 반환
const getSkyGradientColors = (sunAlt: number): string[] => {
  if (sunAlt > 15.0) {
    return ['#0B47A1', '#2196F3', '#B3E5FC']; // 쨍한 파란 하늘
  } else if (sunAlt > 5.0) {
    return ['#1A237E', '#3F51B5', '#FFCC80']; // 옅은 골든아워 진입
  } else if (sunAlt > 1.5) {
    return ['#311B92', '#880E4F', '#FF7043', '#FFE082']; // 본격 황금빛 노을
  } else if (sunAlt > -2.0) {
    return ['#2E1563', '#B71C1C', '#FF5722', '#FFCA28']; // 강렬한 붉은 핏빛 노을 피크
  } else if (sunAlt > -6.0) {
    return ['#0F0826', '#4A148C', '#880E4F', '#E65100']; // 일몰 후 어스름 (보랏빛 잔광)
  } else if (sunAlt > -12.0) {
    return ['#050514', '#0D0D2B', '#25164E']; // 천문 박명 (아주 깊은 남색)
  } else {
    return ['#020205', '#050510', '#0A0A1C']; // 밤 (암흑에 가까움)
  }
};

// 태양 고도에 따른 광선 색상
const getSunBeamColorStr = (alt: number): string => {
  if (alt > 15.0) return '#FFFFFF';
  if (alt > 5.0) return '#FFF59D';
  if (alt > 0) return '#FFB74D';
  if (alt > -3.0) return '#FF5722';
  return '#FF3D00';
};

/**
 * 촬영 당시 태양 고도와 구름 비율(cloudRatio)을 이용하여
 * 백그라운드 캔버스에 시뮬레이션 결과를 렌더링하고 base64 JPEG 스트링을 반환합니다.
 */
export const generateSimulationImage = async (
  sunAltitude: number,
  cloudRatio: number
): Promise<string> => {
  const w = 400;
  const h = 300;

  try {
    const surface = Skia.Surface.Make(w, h);
    if (!surface) return '';
    const canvas = surface.getCanvas();

    // 1. 하늘 그라데이션 그리기
    const skyColors = getSkyGradientColors(sunAltitude).map(c => Skia.Color(c));
    const skyPoints = [
      { x: w / 2, y: 0 },
      { x: w / 2, y: h }
    ];
    
    // Skia 셰이더 생성
    const skyShader = Skia.Shader.MakeLinearGradient(
      skyPoints[0],
      skyPoints[1],
      skyColors,
      null,
      TileMode.Clamp
    );
    
    const paintSky = Skia.Paint();
    paintSky.setShader(skyShader);
    canvas.drawRect(rect(0, 0, w, h), paintSky);

    const horizonY = h * 0.72; // 지평선 높이 (72%)

    // 2. 태양 그리기 (태양 고도가 -8도 이상인 경우에만 렌더링)
    let sunY = 0;
    let sunX = w / 2;
    if (sunAltitude > -8.0) {
      // 태양 Y축 계산: 고도 30도일 때 꼭대기, -8도일 때 지평선 아래 매핑
      const sunRange = 38; // 30도 ~ -8도 범위
      const pct = (30 - sunAltitude) / sunRange;
      sunY = (h * 0.1) + pct * (horizonY - (h * 0.1));

      const sunColorStr = getSunBeamColorStr(sunAltitude);
      const sunColor = Skia.Color(sunColorStr);

      // 글로우 외곽선
      const paintGlow1 = Skia.Paint();
      paintGlow1.setColor(sunColor);
      paintGlow1.setAlphaf(0.12);
      canvas.drawCircle(sunX, sunY, 32, paintGlow1);

      const paintGlow2 = Skia.Paint();
      paintGlow2.setColor(sunColor);
      paintGlow2.setAlphaf(0.24);
      canvas.drawCircle(sunX, sunY, 20, paintGlow2);

      // 태양 코어
      const paintSun = Skia.Paint();
      paintSun.setColor(Skia.Color('#FFFFFF'));
      canvas.drawCircle(sunX, sunY, 10, paintSun);
    }

    // 3. 구름 그리기 (cloudRatio를 기반으로 내부 난수 드로잉 생성)
    if (cloudRatio > 0.05) {
      const paintCloud = Skia.Paint();
      const cloudCount = Math.min(18, Math.round(cloudRatio * 15) + 3);
      
      // 태양 고도에 따라 구름의 라이팅 색상 보간
      const isNight = sunAltitude <= -6.0;
      const isSunset = sunAltitude > -6.0 && sunAltitude <= 2.0;
      const cloudBaseColor = isNight 
        ? Skia.Color('rgba(40, 45, 60, 0.45)') 
        : isSunset 
        ? Skia.Color('rgba(255, 110, 64, 0.55)') 
        : Skia.Color('rgba(255, 235, 200, 0.5)');

      for (let i = 0; i < cloudCount; i++) {
        // 의사 난수 생성
        const seed = i * 29 + 17;
        const cx = ((seed * 13) % (w - 60)) + 30;
        
        // 지평선 주위와 상단부에 배치되도록 Y값 맵핑
        const cy = ((seed * 7) % (Math.round(horizonY * 0.7))) + 30;
        
        const rx = 35 + ((seed * 19) % 45); // 35 to 80
        const ry = 8 + ((seed * 3) % 12);  // 8 to 20
        
        paintCloud.setColor(cloudBaseColor);
        paintCloud.setAlphaf(0.35 + (seed % 4) * 0.1);

        canvas.drawOval(rect(cx - rx, cy - ry, rx * 2, ry * 2), paintCloud);
      }
    }

    // 4. 지형 그리기 (산 실루엣 contour)
    const paintTerrain = Skia.Paint();
    // 태양 고도가 낮아질수록 실루엣 색상을 어둡게 변경
    const terrainColorStr = sunAltitude > 2 ? '#222F1E' : sunAltitude > -2 ? '#162013' : '#070A06';
    paintTerrain.setColor(Skia.Color(terrainColorStr));

    const path = Skia.Path.Make();
    path.moveTo(0, h);
    path.lineTo(0, horizonY + 12);

    const segments = 12;
    for (let i = 1; i <= segments; i++) {
      const px = (w / segments) * i;
      // 자연스러운 산 능선을 표현하기 위해 삼각함수 노이즈 적용
      const offset = Math.sin(i * 1.6) * 9 + Math.cos(i * 0.8) * 4;
      const py = horizonY + offset;
      path.lineTo(px, py);
    }
    path.lineTo(w, h);
    path.close();

    canvas.drawPath(path, paintTerrain);

    // 5. 이미지 캡처
    const snapshot = surface.makeImageSnapshot();
    const base64Bytes = snapshot.encodeToBase64(ImageFormat.JPEG, 85);
    return `data:image/jpeg;base64,${base64Bytes}`;
  } catch (error) {
    console.error('Failed to generate simulation image:', error);
    return '';
  }
};
