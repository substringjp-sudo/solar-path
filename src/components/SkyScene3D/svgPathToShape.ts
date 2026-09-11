/**
 * svgPathToShape.ts
 * SVG path 문자열을 Three.js Shape로 변환하는 유틸리티.
 * 
 * Why: 기존 CLOUD_TEMPLATES의 SVG path 데이터를 3D geometry로 재사용하기 위함.
 * 지원하는 SVG 명령어: M, L, C, Q, Z (절대 좌표만)
 */
import * as THREE from 'three';

/**
 * SVG path 문자열을 파싱하여 Three.js Shape를 반환합니다.
 * @param pathStr SVG path의 d 속성 문자열
 * @param scale 좌표 스케일 배율 (기본 1.0)
 * @returns THREE.Shape 배열 (서브패스 포함 시 여러 개)
 */
export function svgPathToShapes(pathStr: string, scale: number = 1.0): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  let currentShape: THREE.Shape | null = null;
  
  // SVG path 토큰화
  const tokens = pathStr.match(/[MLCQZmlcqz]|[-+]?\d*\.?\d+/g);
  if (!tokens) return shapes;

  let i = 0;
  let cx = 0, cy = 0; // current position

  const nextNum = (): number => {
    while (i < tokens.length && /[MLCQZmlcqz]/.test(tokens[i])) i++;
    return i < tokens.length ? parseFloat(tokens[i++]) * scale : 0;
  };

  while (i < tokens.length) {
    const cmd = tokens[i];
    
    if (/[MLCQZmlcqz]/.test(cmd)) {
      i++;
      
      switch (cmd) {
        case 'M': {
          // Move to (absolute) — 새 서브패스 시작
          cx = nextNum();
          cy = nextNum();
          currentShape = new THREE.Shape();
          currentShape.moveTo(cx, -cy); // SVG Y축 반전
          shapes.push(currentShape);
          break;
        }
        case 'L': {
          // Line to (absolute)
          cx = nextNum();
          cy = nextNum();
          currentShape?.lineTo(cx, -cy);
          break;
        }
        case 'C': {
          // Cubic bezier (absolute): C x1,y1 x2,y2 x,y
          const x1 = nextNum(), y1 = nextNum();
          const x2 = nextNum(), y2 = nextNum();
          cx = nextNum();
          cy = nextNum();
          currentShape?.bezierCurveTo(x1, -y1, x2, -y2, cx, -cy);
          break;
        }
        case 'Q': {
          // Quadratic bezier (absolute): Q x1,y1 x,y
          const qx1 = nextNum(), qy1 = nextNum();
          cx = nextNum();
          cy = nextNum();
          currentShape?.quadraticCurveTo(qx1, -qy1, cx, -cy);
          break;
        }
        case 'Z':
        case 'z': {
          // Close path
          currentShape?.closePath();
          break;
        }
        default: {
          // 지원하지 않는 명령어는 건너뜀
          i++;
          break;
        }
      }
    } else {
      // 명령어 없이 숫자가 오면 이전 명령어의 implicit repeat (L로 처리)
      cx = parseFloat(tokens[i++]) * scale;
      cy = nextNum();
      currentShape?.lineTo(cx, -cy);
    }
  }

  return shapes;
}
