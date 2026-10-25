/**
 * SimReportQR.tsx
 *
 * 씬 위에 그리는 QR — 이 프레임을 만든 입력값을 담습니다
 * (`utils/simReport.ts`). 캡처해서 보내면 그 안의 수치를 그대로 읽어
 * 분석에 쓸 수 있습니다.
 *
 * `qrcode-generator`로 모듈 행렬만 뽑고, `react-native-svg`로 그립니다 —
 * 둘 다 이미 프로젝트에 있어 새 네이티브 의존성이 없습니다. 벡터라 화면
 * 배율이 달라져도, 캡처 후 재압축(JPEG)되어도 모듈 경계가 흐려지지 않습니다.
 *
 * **모듈 하나하나를 `<Rect>`로 그리지 않습니다.** 페이로드가 커지면 모듈이
 * 수천 개가 되어 SVG 노드가 그만큼 늘어납니다. 대신 어두운 모듈을 전부
 * 하나의 `<Path>`로 합칩니다 — `qrcode-generator`의 `createSvgTag`가 쓰는
 * 것과 같은 기법(상대 lineto 사각형을 이어붙임)입니다.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';
import { SIM_REPORT_VERSION } from '../../utils/simReport';
import { color } from '../../theme/tokens';

/** QR 모듈 사이 여백 (모듈 단위). QR 표준 권장값은 4입니다. */
const QUIET_MODULES = 4;
/** 화면에 그릴 목표 한 변 길이 (pt). 페이로드 길이와 무관하게 이 크기로 고정됩니다. */
const TARGET_SIZE_PT = 128;

function buildQrPath(data: string): { size: number; moduleCount: number; d: string } {
  // ECC 'M'(15% 복원). 카메라로 찍는 물리 QR과 달리 여기는 화면 캡처를
  // 그대로 디코드하므로 밀도가 큰 문제는 아니지만, 그렇다고 ECC를
  // 최고(H)로 올리면 모듈이 촘촘해져 SNS 재전송 등에서 겪을 JPEG
  // 재압축에 오히려 더 취약해집니다(모듈 하나가 차지하는 화면 픽셀 수가
  // 줄어드므로). M이 밀도·복원력의 균형점입니다.
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  const n = qr.getModuleCount();

  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const x = c + QUIET_MODULES;
      const y = r + QUIET_MODULES;
      // 절대 moveto + 상대 lineto 4개로 정사각형 하나. 전부 같은 방향으로
      // 감으므로 서로 다른 모듈끼리 겹쳐도 구멍이 뚫리지 않습니다.
      d += `M${x},${y} l1,0 0,1 -1,0 0,-1 `;
    }
  }
  return { size: n + QUIET_MODULES * 2, moduleCount: n, d };
}

/**
 * `size` 는 한 변(pt). 기본 128. 시선·구름판 상태를 실은 뒤로 모듈이 93칸 안팎이라, 캡처가 줄어
 * 들어도 읽히게 촬영 결과 화면은 더 크게 그립니다(모듈 하나가 3px 아래로 내려가면 못 읽었습니다).
 */
export const SimReportQR: React.FC<{ data: string; size?: number }> = React.memo(({ data, size: sizePt = TARGET_SIZE_PT }) => {
  const { size, d } = useMemo(() => buildQrPath(data), [data]);

  return (
    <View style={styles.plate} pointerEvents="none">
      <Svg width={sizePt} height={sizePt} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={0} y={0} width={size} height={size} fill={color.text} />
        <Path d={d} fill="#000000" />
      </Svg>
      <Text style={styles.caption}>SIM v{SIM_REPORT_VERSION}</Text>
    </View>
  );
});
SimReportQR.displayName = 'SimReportQR';

const styles = StyleSheet.create({
  plate: {
    backgroundColor: color.text,
    borderRadius: 6,
    padding: 4,
    alignItems: 'center',
  },
  caption: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '700',
    color: '#111111',
    letterSpacing: 0.4,
  },
});
