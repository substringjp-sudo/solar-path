/**
 * useCloudTopView — 지구본 "시뮬레이션 보기" 한 장을 만듭니다 (§120 B).
 *
 * 하늘 탭의 GL 은 그 탭의 것이라 빌리지 않고, 화면 없는 GL 컨텍스트를 **하나만** 만들어
 * 둡니다(`GLView.createContextAsync`). 켜져 있을 때만, 고리·시각이 바뀔 때만 그립니다.
 * 그리는 중에 새 요청이 오면 끝난 뒤 **마지막 것만** 그립니다(자동재생이 150ms 마다 밀어도
 * 쌓이지 않게).
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import type * as THREE from 'three';
import type { CloudPathData } from '../../utils/weather';
import { createCloudTopView, buildTopViewInput, type CloudTopViewHandle } from '../SkyScene3D/CloudTopView';
import { encodePngRgba, toBase64 } from '../../utils/png';

export interface CloudTopViewImage {
  /**
   * 그림 주소. 웹은 data URI, 네이티브는 **캐시 파일**(file://)입니다 — 지도 겹(react-native-maps
   * `Overlay`)이 "로컬 자원이나 URI" 만 받는다고 적혀 있어 data URI 에 기대지 않습니다.
   */
  uri: string;
  /** 그림 한 변이 덮는 반경(km) — 그림 가장자리 = 중심에서 이 거리. */
  rangeKm: number;
  timeMs: number;
}

let seq = 0;
let shared: Promise<{ renderer: THREE.WebGLRenderer; tv: CloudTopViewHandle; gl: any } | null> | null = null;
const getShared = () => {
  if (!shared) {
    shared = (async () => {
      try {
        const gl: any = await GLView.createContextAsync();
        if (!gl) return null;
        const tv = createCloudTopView();
        const renderer = new Renderer({ gl, width: tv.size, height: tv.size }) as unknown as THREE.WebGLRenderer;
        return { renderer, tv, gl };
      } catch (e) {
        console.warn('위에서 본 구름: GL 을 못 만들었습니다', e);
        return null;
      }
    })();
  }
  return shared;
};

export function useCloudTopView(
  ring: CloudPathData[] | null,
  timeMs: number,
  enabled: boolean,
): CloudTopViewImage | null {
  const [img, setImg] = useState<CloudTopViewImage | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<{ ring: CloudPathData[]; timeMs: number } | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (!enabled || !ring) return;
    pending.current = { ring, timeMs };
    // ⚠ 도는 중이면 새 일감만 남겨 둡니다 — 도는 고리가 끝나기 전에 집어 갑니다.
    //   (효과의 정리 함수로 고리를 끊으면, 그 사이 들어온 마지막 일감이 버려집니다.)
    if (busy.current) return;
    const run = async () => {
      busy.current = true;
      try {
        const ctx = await getShared();
        while (mounted.current && pending.current && ctx) {
          const job = pending.current;
          pending.current = null;
          const input = buildTopViewInput(job.ring, job.timeMs);
          if (!input) { setImg(null); continue; }
          const px = ctx.tv.render(ctx.renderer, input);
          ctx.gl.endFrameEXP?.();
          const b64 = toBase64(encodePngRgba(px, ctx.tv.size, ctx.tv.size));
          let uri = 'data:image/png;base64,' + b64;
          if (Platform.OS !== 'web' && FileSystem.cacheDirectory) {
            // 같은 이름을 다시 쓰면 그림 캐시가 옛 것을 보여 줄 수 있어 이름을 바꿔 가며 씁니다.
            const path = `${FileSystem.cacheDirectory}cloud-top-${seq++ % 4}.png`;
            try {
              await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
              uri = `${path}?t=${job.timeMs}`;
            } catch (e) {
              console.warn('위에서 본 구름: 파일에 못 썼습니다 — data URI 로 씁니다', e);
            }
          }
          if (mounted.current) setImg({ uri, rangeKm: ctx.tv.rangeKm, timeMs: job.timeMs });
          // 한 프레임 양보 — 자동재생 중에도 화면이 멈추지 않게.
          await new Promise(r => setTimeout(r, 0));
        }
      } finally {
        busy.current = false;
      }
    };
    run();
  }, [ring, timeMs, enabled]);

  return enabled ? img : null;
}
