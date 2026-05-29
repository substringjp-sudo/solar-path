import { CloudGenus } from '../types/simulation';

// Seed-based pseudo-random number generator (LCG) for reproducible paths
function createRandom(seed: number) {
  let s = Math.abs(seed | 0) || 1;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export interface CloudStyle {
  baseOpacity: number;      // 기본 불투명도 (0-1)
  blur: number;             // SVG blur 값
  fillColorOffset: string;  // 구름 컬러 조절용 ('white', 'grey', 'dark', 'pink')
  prismEffect: boolean;     // 권운 등의 프리즘 발광 효과 적용 여부
  shadowOffset: number;     // 자외선/태양광 차단 깊이 (입체감용)
  layerCount: number;       // 디테일을 위한 패스 중첩 개수
}

export const CLOUD_STYLES: Record<CloudGenus, CloudStyle> = {
  cirrus: {
    baseOpacity: 0.25,
    blur: 6,
    fillColorOffset: 'pink', // 노을빛을 받아 핑크/골드로 빛남
    prismEffect: true,
    shadowOffset: 0,
    layerCount: 3,
  },
  cirrostratus: {
    baseOpacity: 0.2,
    blur: 10,
    fillColorOffset: 'white',
    prismEffect: true,
    shadowOffset: 0,
    layerCount: 1,
  },
  cumulonimbus: {
    baseOpacity: 0.95,
    blur: 3,
    fillColorOffset: 'dark', // 하단부는 매우 어둡고 웅장함
    prismEffect: false,
    shadowOffset: 25,
    layerCount: 4,
  },
  altostratus: {
    baseOpacity: 0.5,
    blur: 8,
    fillColorOffset: 'grey',
    prismEffect: false,
    shadowOffset: 5,
    layerCount: 2,
  },
  altocumulus: {
    baseOpacity: 0.45,
    blur: 4,
    fillColorOffset: 'white',
    prismEffect: false,
    shadowOffset: 3,
    layerCount: 3,
  },
  stratocumulus: {
    baseOpacity: 0.7,
    blur: 5,
    fillColorOffset: 'grey',
    prismEffect: false,
    shadowOffset: 12,
    layerCount: 3,
  },
  stratus: {
    baseOpacity: 0.85,
    blur: 12,
    fillColorOffset: 'dark',
    prismEffect: false,
    shadowOffset: 8,
    layerCount: 1,
  },
  cumulus: {
    baseOpacity: 0.75,
    blur: 2,
    fillColorOffset: 'white',
    prismEffect: false,
    shadowOffset: 10,
    layerCount: 3,
  },
  clear: {
    baseOpacity: 0,
    blur: 0,
    fillColorOffset: 'white',
    prismEffect: false,
    shadowOffset: 0,
    layerCount: 0,
  },
};

/**
 * 주어진 구름 종류(Genus)와 캔버스 상의 너비/높이에 최적화된 SVG Path를 생성합니다.
 * @param genus 구름 유형
 * @param w 구름의 너비
 * @param h 구름의 높이
 * @param seed 모양 고정을 위한 시드값
 * @param layerIndex 중첩 레이어 번호 (동일한 구름을 여러 겹 그릴 때 약간 변형된 패스 생성)
 */
export function generateCloudPath(
  genus: CloudGenus,
  w: number,
  h: number,
  seed: number,
  layerIndex: number = 0
): string {
  const rand = createRandom(seed + layerIndex * 777);
  
  switch (genus) {
    case 'cirrus': {
      let path = '';
      const lines = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < lines; i++) {
        const startY = h * (0.3 + rand() * 0.4);
        const endY = startY + h * (-0.2 + rand() * 0.4);
        const cp1x = w * 0.25;
        const cp1y = startY - h * (0.3 + rand() * 0.4);
        const cp2x = w * 0.75;
        const cp2y = endY + h * (0.3 + rand() * 0.4);
        
        path += ` M 0,${startY.toFixed(1)} C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${w.toFixed(1)},${endY.toFixed(1)}`;
      }
      return path.trim();
    }
    
    case 'cirrostratus': {
      const topY = h * (0.1 + rand() * 0.2);
      const bottomY = h * (0.7 + rand() * 0.2);
      const leftControlY = h * (0.3 + rand() * 0.4);
      const rightControlY = h * (0.3 + rand() * 0.4);
      
      return `M 0,${topY.toFixed(1)} Q ${w*0.5},${leftControlY.toFixed(1)} ${w},${topY.toFixed(1)} L ${w},${bottomY.toFixed(1)} Q ${w*0.5},${rightControlY.toFixed(1)} 0,${bottomY.toFixed(1)} Z`;
    }
    
    case 'cumulonimbus': {
      const baseHeight = h * 0.8;
      let path = `M 0,${baseHeight.toFixed(1)}`;
      
      const domeCount = 5 + Math.floor(rand() * 4);
      let lastX = 0;
      for (let i = 0; i < domeCount; i++) {
        const targetX = (i + 1) * (w / domeCount);
        const progress = (i + 0.5) / domeCount;
        const centerFactor = 1 - Math.abs(progress - 0.5) * 2;
        const peakHeight = h * (0.1 + (1 - centerFactor) * 0.6);
        
        const cp1x = lastX + (targetX - lastX) * 0.25;
        const cp1y = peakHeight - (rand() * 15);
        const cp2x = lastX + (targetX - lastX) * 0.75;
        const cp2y = peakHeight - (rand() * 15);
        
        path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${targetX.toFixed(1)},${baseHeight.toFixed(1)}`;
        lastX = targetX;
      }
      
      path += ` L ${w.toFixed(1)},${h.toFixed(1)} L 0,${h.toFixed(1)} Z`;
      return path;
    }
    
    case 'altocumulus': {
      let path = '';
      const rows = 2;
      const cols = 4 + Math.floor(rand() * 3);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (c + 0.5) * (w / cols) + (rand() - 0.5) * (w / cols * 0.4);
          const cy = (r + 0.5) * (h / rows) + (rand() - 0.5) * (h / rows * 0.4);
          const rx = (w / cols) * (0.35 + rand() * 0.2);
          const ry = (h / rows) * (0.35 + rand() * 0.2);
          
          path += ` M ${(cx - rx).toFixed(1)},${cy.toFixed(1)} 
                    C ${(cx - rx).toFixed(1)},${(cy - ry).toFixed(1)} ${(cx + rx).toFixed(1)},${(cy - ry).toFixed(1)} ${(cx + rx).toFixed(1)},${cy.toFixed(1)} 
                    C ${(cx + rx).toFixed(1)},${(cy + ry).toFixed(1)} ${(cx - rx).toFixed(1)},${(cy + ry).toFixed(1)} ${(cx - rx).toFixed(1)},${cy.toFixed(1)} Z`;
        }
      }
      return path.trim();
    }
    
    case 'altostratus': {
      const leftY1 = h * (0.4 + rand() * 0.2);
      const rightY1 = h * (0.4 + rand() * 0.2);
      const leftY2 = h * (0.6 + rand() * 0.2);
      const rightY2 = h * (0.6 + rand() * 0.2);
      
      const cp1y = leftY1 - h * 0.15;
      const cp2y = rightY1 - h * 0.15;
      const cp3y = rightY2 + h * 0.15;
      const cp4y = leftY2 + h * 0.15;
      
      return `M 0,${leftY1.toFixed(1)} C ${w*0.3},${cp1y.toFixed(1)} ${w*0.7},${cp2y.toFixed(1)} ${w},${rightY1.toFixed(1)} L ${w},${rightY2.toFixed(1)} C ${w*0.7},${cp3y.toFixed(1)} ${w*0.3},${cp4y.toFixed(1)} 0,${leftY2.toFixed(1)} Z`;
    }
    
    case 'stratocumulus': {
      let topPath = `M 0,${(h * 0.5).toFixed(1)}`;
      let bottomPath = '';
      
      const steps = 4 + Math.floor(rand() * 3);
      let lastX = 0;
      let lastY = h * 0.5;
      
      for (let i = 0; i < steps; i++) {
        const nextX = (i + 1) * (w / steps);
        const nextY = h * (0.4 + rand() * 0.25);
        const cp1x = lastX + (nextX - lastX) * 0.5;
        const cp1y = Math.min(lastY, nextY) - h * (0.15 + rand() * 0.15);
        
        topPath += ` Q ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${nextX.toFixed(1)},${nextY.toFixed(1)}`;
        lastX = nextX;
        lastY = nextY;
      }
      
      bottomPath = ` L ${w.toFixed(1)},${(h * 0.85).toFixed(1)} Q ${w*0.5},${(h * 0.95).toFixed(1)} 0,${(h * 0.85).toFixed(1)} Z`;
      
      return topPath + bottomPath;
    }
    
    case 'stratus': {
      const topY = h * (0.2 + rand() * 0.1);
      const bottomY = h * (0.8 - rand() * 0.1);
      const midTopY = topY + (rand() - 0.5) * h * 0.1;
      const midBotY = bottomY + (rand() - 0.5) * h * 0.1;
      
      return `M 0,${topY.toFixed(1)} Q ${w*0.5},${midTopY.toFixed(1)} ${w},${topY.toFixed(1)} L ${w},${bottomY.toFixed(1)} Q ${w*0.5},${midBotY.toFixed(1)} 0,${bottomY.toFixed(1)} Z`;
    }
    
    case 'cumulus': {
      const baseHeight = h * 0.75;
      const d1w = w * 0.35;
      const d2w = w * 0.4;
      const d3w = w * 0.25;
      
      const h1 = baseHeight - h * (0.2 + rand() * 0.2);
      const h2 = baseHeight - h * (0.4 + rand() * 0.3);
      const h3 = baseHeight - h * (0.15 + rand() * 0.2);
      
      const p1 = `C ${(d1w*0.25).toFixed(1)},${h1.toFixed(1)} ${(d1w*0.75).toFixed(1)},${h1.toFixed(1)} ${d1w.toFixed(1)},${baseHeight.toFixed(1)}`;
      const p2 = `C ${(d1w + d2w*0.25).toFixed(1)},${h2.toFixed(1)} ${(d1w + d2w*0.75).toFixed(1)},${h2.toFixed(1)} ${(d1w+d2w).toFixed(1)},${baseHeight.toFixed(1)}`;
      const p3 = `C ${(w - d3w*0.75).toFixed(1)},${h3.toFixed(1)} ${(w - d3w*0.25).toFixed(1)},${h3.toFixed(1)} ${w.toFixed(1)},${baseHeight.toFixed(1)}`;
      
      return `M 0,${baseHeight.toFixed(1)} ${p1} ${p2} ${p3} L ${w.toFixed(1)},${h.toFixed(1)} L 0,${h.toFixed(1)} Z`;
    }
    
    default:
      return '';
  }
}
