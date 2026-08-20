/**
 * cloudCellTexture.ts
 *
 * `cloudCellField.ts`가 구운 셀 무늬를 GPU 텍스처로 올립니다.
 * (docs/CLOUD_TEXTURE_PLAN.md 1단계)
 *
 * ## 왜 별도 모듈인가
 *
 * 굽는 쪽(`cloudCellField.ts`)은 THREE를 몰라야 합니다. 그래야 하네스가
 * 브라우저 없이 수치를 검증할 수 있고, 나중에 빌드 타임에 구워 에셋으로
 * 넣기로 해도 그 코드를 그대로 씁니다. 여기는 올리는 일만 합니다.
 *
 * ## 텍스처가 정적이라는 점이 중요합니다
 *
 * 이 무늬는 날씨·시각·위치에 **전혀 의존하지 않습니다.** 운량은 셰이더에서
 * 문턱으로 들어가고, 셀 크기는 uv 배율로 들어갑니다. 그래서 앱 수명 동안
 * 한 번만 구우면 되고, 모듈 수준에서 캐시합니다.
 *
 * `docs/SKY_TIMELINE.md`의 "픽셀이 아니라 파라미터를 저장한다" 원칙에는
 * 걸리지 않습니다 — 여기 굽는 것은 하늘의 모습이 아니라 **시간과 무관한
 * 무늬**입니다.
 *
 * ## 밉맵을 직접 만들어 올립니다
 *
 * `generateMipmaps`를 쓰면 GPU가 상자 필터로 줄이는데, 그러면 값 분포가
 * 평균 쪽으로 좁아져 **먼 하늘에서 운량이 다시 틀립니다.**
 * `cloudCellField`가 레벨마다 다시 평활화한 체인을 만들어 두므로 그걸 씁니다.
 */
import * as THREE from 'three';
import {
  bakeCellField,
  packCellFieldsRGBA,
  type CellFieldOptions,
  type PackedCellField,
} from '../../utils/cloudCellField';

export interface CloudCellTexture {
  texture: THREE.DataTexture;
  /** 타일 하나에 들어가는 셀 개수 — 셰이더 uv 배율 계산에 필요합니다 */
  tileCells: number;
  size: number;
  dispose: () => void;
}

/**
 * 채널별 씨앗.
 *
 * 덱은 층이 3개인데 셋이 같은 무늬를 쓰면 저·중·상층이 완벽히 겹쳐 보여
 * 하늘이 한 장짜리가 됩니다. 층마다 다른 채널을 읽게 하려고 씨앗을 벌려 둡니다.
 * (네 번째 채널은 같은 층 안에서 무늬를 섞어 타일 반복을 흐리는 데 씁니다)
 */
const CHANNEL_SEEDS = [1, 18, 35, 52];

/** 층 → 읽을 채널. `cloudCellField`의 RGBA 순서와 맞춰야 합니다. */
export const LAYER_CELL_CHANNEL: Record<'low' | 'mid' | 'high', number> = {
  low: 0,
  mid: 1,
  high: 2,
};

function toDataTexture(packed: PackedCellField): THREE.DataTexture {
  const level0 = packed.levels[0];
  const tex = new THREE.DataTexture(
    level0.data,
    level0.width,
    level0.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );

  // 밉 체인을 직접 넘깁니다 (레벨 0 포함). generateMipmaps는 반드시 꺼야
  // 합니다 — 켜면 GPU가 만든 상자 필터 결과가 이걸 덮어씁니다.
  tex.mipmaps = packed.levels.map(l => ({
    data: l.data,
    width: l.width,
    height: l.height,
  })) as unknown as THREE.DataTexture['mipmaps'];
  tex.generateMipmaps = false;

  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  // **색이 아니라 데이터**입니다. sRGB 변환이 걸리면 평활화가 깨져
  // 운량이 다시 틀어집니다.
  tex.colorSpace = THREE.NoColorSpace;

  tex.needsUpdate = true;
  return tex;
}

let cached: CloudCellTexture | null = null;
let cachedKey = '';

function keyOf(opts: CellFieldOptions): string {
  return JSON.stringify({
    size: opts.size ?? null,
    tileCells: opts.tileCells ?? null,
    octaves: opts.octaves ?? null,
    variant: opts.variant ?? null,
    warp: opts.warp ?? null,
  });
}

/**
 * 셀 무늬 텍스처를 얻습니다. 같은 설정이면 구운 것을 그대로 돌려줍니다.
 *
 * 굽는 비용은 512² 4채널 기준 데스크톱 약 1초입니다. 모바일에서는 몇 배가
 * 되므로 **첫 프레임을 막지 않도록** 타임라인 사전계산 같은 진행 표시가 있는
 * 자리에서 부르거나, `createCloudCellTextureAsync`를 쓰세요.
 */
export function createCloudCellTexture(
  opts: CellFieldOptions = {}
): CloudCellTexture {
  const key = keyOf(opts);
  if (cached && cachedKey === key) return cached;

  const fields = CHANNEL_SEEDS.map(seed => bakeCellField({ ...opts, seed }));
  const packed = packCellFieldsRGBA(fields);
  const texture = toDataTexture(packed);

  const handle: CloudCellTexture = {
    texture,
    tileCells: packed.options.tileCells,
    size: packed.size,
    dispose: () => {
      texture.dispose();
      if (cached === handle) {
        cached = null;
        cachedKey = '';
      }
    },
  };

  cached = handle;
  cachedKey = key;
  return handle;
}

/**
 * 채널을 하나씩 구우면서 사이사이 프레임을 양보합니다.
 *
 * 512² 한 채널이 약 250ms이므로, 통째로 돌리면 모바일에서 눈에 띄게 멈춥니다.
 * 채널마다 끊어 주면 진행률도 보고할 수 있습니다.
 */
export async function createCloudCellTextureAsync(
  opts: CellFieldOptions = {},
  onProgress?: (fraction: number) => void
): Promise<CloudCellTexture> {
  const key = keyOf(opts);
  if (cached && cachedKey === key) {
    onProgress?.(1);
    return cached;
  }

  const fields = [];
  for (let i = 0; i < CHANNEL_SEEDS.length; i++) {
    fields.push(bakeCellField({ ...opts, seed: CHANNEL_SEEDS[i] }));
    onProgress?.((i + 1) / CHANNEL_SEEDS.length);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const packed = packCellFieldsRGBA(fields);
  const texture = toDataTexture(packed);

  const handle: CloudCellTexture = {
    texture,
    tileCells: packed.options.tileCells,
    size: packed.size,
    dispose: () => {
      texture.dispose();
      if (cached === handle) {
        cached = null;
        cachedKey = '';
      }
    },
  };

  cached = handle;
  cachedKey = key;
  return handle;
}

/** 테스트·개발용 — 캐시를 버립니다 (텍스처는 dispose하지 않습니다). */
export function resetCloudCellTextureCache(): void {
  cached = null;
  cachedKey = '';
}
