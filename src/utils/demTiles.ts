/**
 * **DEM 타일** — 진짜 높이장을 받아 GPU 로 올립니다 (docs/COASTLINE_PLAN.md 1단계).
 *
 * 지금까지 지형 자료는 31방위 × 3거리 = **93점** 이었습니다. 그건 실루엣이지
 * 높이장이 아니라, 물가·수심·가려짐을 만들 수 없었습니다. 여기서 바꿉니다.
 *
 * ## 자료
 *
 * AWS Terrain Tiles (Registry of Open Data on AWS, Mapzen 파생):
 *
 *     https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 *
 * 인증이 없고, 256×256 PNG 한 장이 **65,536점** 입니다. 해상도 약 30m,
 * 전 지구, **얕은 수심 포함**(근해가 음수로 옵니다 — 물가 표현의 재료).
 *
 * ## Terrarium 인코딩
 *
 *     고도(m) = R·256 + G + B/256 − 32768
 *
 * ⚠ **선형보간을 켜도 됩니다.** "세 채널에 쪼개 담았으니 보간하면 깨진다"고
 * 짐작했다가 실측했더니 최대 오차가 **0.0m** 였습니다. 위 식이 채널에 대해
 * **선형**이라 채널별 보간과 디코드가 교환됩니다.
 *
 * ⚠ **sRGB 로 읽으면 안 됩니다.** 감마가 걸리면 고도가 통째로 어긋납니다.
 * 이쪽이 진짜 함정이라 `NoColorSpace` 를 못박아 둡니다.
 *
 * ## 왜 CPU 로 디코드하지 않나
 *
 * PNG 를 그대로 텍스처로 올리고 **셰이더에서 디코드**합니다. RN 에 PNG
 * 디코더를 붙이는 문제가 통째로 사라지고, 65,536점이 JS 를 거치지 않습니다.
 */
import * as THREE from 'three';

/** 적도 둘레 (m). Web Mercator 의 기준입니다. */
const EARTH_CIRCUMFERENCE_M = 40075016.686;

export const DEM_TILE_SIZE_PX = 256;

/** 타일 한 장의 URL. */
export const demTileUrl = (z: number, x: number, y: number): string =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/**
 * 경위도 → **소수** 타일 좌표 (표준 slippy map 식).
 *
 * 정수부가 타일 번호, 소수부가 그 타일 안에서의 위치입니다.
 */
export function lonLatToTileFloat(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      n,
  };
}

/**
 * 그 위도에서 타일 한 장이 덮는 **지상** 거리 (m).
 *
 * Web Mercator 는 등각사상이라 위도가 높을수록 같은 타일이 좁은 땅을 덮습니다
 * (cos φ 배). 이걸 빼먹으면 지형이 남북으로 늘어납니다.
 */
export function tileSpanMetres(z: number, lat: number): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z)
  );
}

/**
 * 블록 한 변의 타일 수. **홀수여야** 관측자 타일이 정중앙에 옵니다.
 *
 * 3 이면 관측자에서 어느 방향으로도 타일 한 장(줌 13 에서 약 3.9km)이
 * 보장되고, 텍스처는 768×768 입니다.
 */
export const DEM_BLOCK_TILES = 3;

/** 짝수가 들어오면 하나 키워 홀수로 만듭니다 — 중앙 정렬을 지키려고. */
const oddBlock = (n: number): number => Math.max(1, n % 2 === 1 ? n : n + 1);

/**
 * 반경 `radiusM` 를 덮으면서 **가장 촘촘한** 줌을 고릅니다.
 *
 * ⚠ 보장되는 여유는 블록 한 변이 아니라 **(한 변 − 1) / 2 타일** 입니다.
 * 관측자 타일이 가운데 한 칸을 차지하고 양옆으로 나눠 갖기 때문입니다.
 * 여기를 "2×2 면 한 장은 남는다"로 잘못 읽어 바깥 표본이 가장자리로
 * 뭉개졌고, 판정에서 최대 50.6m 오차로 잡혔습니다.
 */
export function demZoomForRadius(
  radiusM: number,
  lat: number,
  opts: { block?: number; maxZoom?: number } = {},
): number {
  const margin = (oddBlock(opts.block ?? DEM_BLOCK_TILES) - 1) / 2;
  const minZoom = 4;
  if (margin <= 0) return minZoom;
  for (let z = opts.maxZoom ?? 14; z >= minZoom; z--) {
    if (tileSpanMetres(z, lat) * margin >= radiusM) return z;
  }
  return minZoom;
}

export interface DemPatch {
  /** block×block 을 하나로 합친 높이장. 셰이더에서 디코드합니다. */
  texture: THREE.Texture;
  /** 블록 왼쪽 위 **정수** 타일 좌표 */
  originTileX: number;
  originTileY: number;
  zoom: number;
  /** 블록 한 변의 타일 수 */
  blockTiles: number;
  /** 타일 한 장이 덮는 지상 거리 (m) */
  tileSpanM: number;
  /** 관측자의 소수 타일 좌표 (블록 원점 기준 0~blockTiles) */
  observerU: number;
  observerV: number;
  /** 받아 온 타일 수 / 요청한 타일 수 — 1 이 아니면 구멍이 있습니다 */
  coverage: number;
  dispose: () => void;
}

/**
 * 관측자 타일이 블록 **정중앙**에 오도록 원점 타일을 고릅니다.
 *
 * 한 변이 홀수라 치우침을 따질 필요가 없습니다 — 양옆으로 똑같이
 * `(block − 1) / 2` 장씩 붙습니다.
 */
export function pickBlockOrigin(
  tileX: number,
  tileY: number,
  block: number = DEM_BLOCK_TILES,
): { originX: number; originY: number } {
  const half = (oddBlock(block) - 1) / 2;
  return {
    originX: Math.floor(tileX) - half,
    originY: Math.floor(tileY) - half,
  };
}

/**
 * 높이장을 읽는 GLSL 을 **접두사를 갈아 끼워** 찍어 냅니다.
 *
 * `uDemTex` 는 block×block 을 합친 높이장, `uDemSpanM` 은 타일 한 장의 지상
 * 거리, `uDemObs` 는 관측자의 블록 내 소수 타일 좌표(0~block)입니다.
 *
 * 씬 좌표 규약: **+x = 동, −z = 북** (`dirX = sin(az)`, `dirZ = -cos(az)` 와
 * 같은 규약). Web Mercator 는 x 가 동, y 가 **남**으로 증가하므로 +z 와
 * 그대로 맞아떨어집니다 — 뒤집을 것이 없습니다.
 *
 * ## 왜 접두사를 받나
 *
 * 해수면은 높이장을 **두 벌** 씁니다: 물가의 수심을 재는 촘촘한 것(3km)과,
 * 물이 있는지 없는지만 가리는 성긴 것(60km). 하나만 쓰면 촘촘한 패치 밖은
 * "모른다" 가 되고, 그때 물을 그려 버리면 **내륙 한복판에도 수평선까지
 * 바다가 깔립니다** — 실기에서 그렇게 났습니다(서울 도곡동, 해발 70m).
 */
export function demGlsl(prefix: string = 'dem'): string {
  const p = prefix;
  const U = p.charAt(0).toUpperCase() + p.slice(1);
  return /* glsl */ `
uniform sampler2D u${U}Tex;
uniform vec2  u${U}Obs;      // 관측자의 블록 내 타일 좌표 (0~u${U}Block)
uniform float u${U}SpanM;    // 타일 한 장의 지상 거리 (m)
uniform float u${U}Block;    // 블록 한 변의 타일 수
uniform float u${U}Valid;    // 0 이면 자료 없음 — 호출부가 물러날 수 있게

/** 씬의 지상 좌표(m, 관측자 원점) → 블록 UV (0~1) */
vec2 ${p}_uv(vec2 groundM) {
  return (u${U}Obs + groundM / u${U}SpanM) / u${U}Block;
}

/** 그 지점이 받아 둔 블록 **안**인가 (1/0). 밖은 가장자리 값이 늘어납니다. */
float ${p}_inside(vec2 groundM) {
  vec2 uv = ${p}_uv(groundM);
  vec2 k = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return k.x * k.y;
}

/**
 * 관측자에서 **어느 방향으로도 보장되는** 블록 안쪽 반지름 (m).
 *
 * 관측자 타일이 정중앙 한 칸을 차지하므로 여유는 (한 변 − 1) / 2 타일입니다.
 * 가장자리 화소가 늘어나는 것을 피하려고 조금 안쪽으로 잡습니다.
 */
float ${p}_probeRadiusM() {
  return 0.98 * 0.5 * (u${U}Block - 1.0) * u${U}SpanM;
}

/**
 * 높이장 표본 (m, 해수면 기준).
 *
 * Terrarium: 고도 = R·256 + G + B/256 − 32768.
 * 이 식은 채널에 대해 **선형**이라 텍스처 선형보간과 교환됩니다 —
 * 그래서 보간을 켜 둬도 안전합니다(실측 오차 0.0m).
 */
float ${p}_elevation(vec2 uv) {
  vec3 t = texture2D(u${U}Tex, clamp(uv, 0.0, 1.0)).rgb * 255.0;
  return t.r * 256.0 + t.g + t.b / 256.0 - 32768.0;
}

float ${p}_elevationAt(vec2 groundM) {
  return ${p}_elevation(${p}_uv(groundM));
}

/**
 * 블록 **밖**은 같은 방위의 가장자리 값으로 잇습니다 — "마지막으로 본 것이
 * 계속된다". 모르는 곳을 0m(=물)로 두는 것보다 훨씬 덜 틀립니다.
 */
float ${p}_elevationExtended(vec2 groundM) {
  float r = length(groundM);
  float rp = ${p}_probeRadiusM();
  vec2 g = r > rp ? groundM * (rp / max(r, 1e-4)) : groundM;
  return ${p}_elevationAt(g);
}
`;
}

/** 기본 접두사(`dem`) 판. 예전 그대로입니다. */
export const DEM_GLSL = demGlsl('dem');

/**
 * block×block 타일을 받아 **GPU 에서** 한 장으로 합칩니다.
 *
 * CPU 로 합치려면 PNG 디코더가 필요합니다. 대신 렌더 타깃에 타일을 그대로
 * 붙입니다 — 화소 대 화소 1:1 이라 값이 하나도 안 변합니다.
 *
 * ⚠ 붙일 때는 **반드시 NearestFilter** 입니다. 여기서 한 번이라도 리샘플되면
 * 고도가 흐려지고, 그건 해안선이 흐려진다는 뜻입니다. (완성된 텍스처를
 * 나중에 읽을 때는 선형보간이 안전합니다 — 위 주석 참고.)
 */
/**
 * 받아 둔 패치들.
 *
 * ⚠ 예전에는 **한 칸짜리** 캐시였습니다. 그때는 부르는 데가 하나뿐이라
 * 괜찮았지만, 이제 해수면이 성긴 물 마스크(60km)를 따로 씁니다 — 한 칸이면
 * 두 패치가 서로를 밀어내며 매 프레임 타일을 다시 받습니다. 그래서 작은
 * 키 맵으로 바꾸고 개수만 묶어 둡니다.
 */
const cache = new Map<string, DemPatch>();
const CACHE_MAX = 4;

/** 캐시를 버립니다 (시험용, 그리고 관측지가 크게 바뀔 때). */
export function clearDemCache(): void {
  const all = [...cache.values()];
  cache.clear();
  all.forEach((p) => p.dispose());
}

export async function loadDemPatch(
  lat: number,
  lon: number,
  radiusM: number,
  deps: {
    renderer: THREE.WebGLRenderer;
    /** 원격 PNG → THREE.Texture. RN 은 expo-three 의 loadTextureAsync. */
    loadTexture: (url: string) => Promise<THREE.Texture>;
    /**
     * URL 을 바꿔 끼우는 자리. 판정 하네스가 **미리 내려받은 로컬 타일**을
     * 쓰게 하려고 열어 둡니다 — 그래야 시험이 망 상태와 CORS 에 안 휘둘립니다.
     */
    tileUrl?: (z: number, x: number, y: number) => string;
    /** 블록 한 변의 타일 수 (홀수). 기본 `DEM_BLOCK_TILES`. */
    block?: number;
  },
): Promise<DemPatch | null> {
  const block = oddBlock(deps.block ?? DEM_BLOCK_TILES);
  const zoom = demZoomForRadius(radiusM, lat, { block });
  const tileSpanM = tileSpanMetres(zoom, lat);
  const t = lonLatToTileFloat(lon, lat, zoom);
  const { originX, originY } = pickBlockOrigin(t.x, t.y, block);

  // 같은 블록이면 다시 받지 않습니다. 관측지가 한 타일 안에서 움직이는 동안
  // (걸어다니는 정도) 계속 재사용됩니다.
  const key = `${zoom}/${originX}/${originY}/${block}`;
  const hit = cache.get(key);
  if (hit) {
    // 같은 객체를 돌려줍니다 (복사본이 아니라). 텍스처가 그대로이므로 호출부가
    // 유니폼을 다시 꽂을 필요가 없고, 객체 동일성으로 비교하는 쪽도 안 흔들립니다.
    hit.observerU = t.x - originX;
    hit.observerV = t.y - originY;
    // 방금 쓴 것을 맨 뒤로 — 아래에서 가장 오래된 것부터 버립니다.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const tiles: (THREE.Texture | null)[] = [];
  for (let dy = 0; dy < block; dy++) {
    for (let dx = 0; dx < block; dx++) {
      try {
        const url = (deps.tileUrl ?? demTileUrl)(zoom, originX + dx, originY + dy);
        const tex = await deps.loadTexture(url);
        // ⚠ 고도 자료입니다 — 색이 아닙니다. 감마를 걸면 안 됩니다.
        tex.colorSpace = THREE.NoColorSpace;
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = false;
        tex.needsUpdate = true;
        tiles.push(tex);
      } catch {
        tiles.push(null);
      }
    }
  }
  const got = tiles.filter((x) => x !== null).length;
  if (got === 0) return null;

  const size = DEM_TILE_SIZE_PX * block;
  const target = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, block, block, 0, -1, 1);
  tiles.forEach((tex, i) => {
    if (!tex) return;
    const dx = i % block;
    const dy = Math.floor(i / block);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, depthTest: false }),
    );
    // ⚠ 뒤집지 않습니다. 이 텍스처의 v 는 `dem_uv` 의 약속대로 **남쪽으로**
    // 증가해야 합니다(= 타일 y 방향). 카메라 아래쪽이 y=0 → v=0 이고,
    // flipY=false 라 판 아래쪽(uv v=0)이 PNG 첫 줄(북쪽)이므로, 타일 dy 를
    // 그대로 y=dy+0.5 에 놓으면 v = 블록내y / block 이 됩니다.
    // (한 번 뒤집었다가 타일 줄이 통째로 뒤바뀌어 최대 137m 틀렸습니다.)
    quad.position.set(dx + 0.5, dy + 0.5, 0);
    scene.add(quad);
  });

  const prevTarget = deps.renderer.getRenderTarget();
  deps.renderer.setRenderTarget(target);
  deps.renderer.render(scene, cam);
  deps.renderer.setRenderTarget(prevTarget);

  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as THREE.Material).dispose();
  });
  // 합치고 나면 원본 타일은 필요 없습니다 — 화소는 렌더 타깃에 들어갔습니다.
  tiles.forEach((x) => x?.dispose());

  const patch: DemPatch = {
    texture: target.texture,
    originTileX: originX,
    originTileY: originY,
    zoom,
    blockTiles: block,
    tileSpanM,
    observerU: t.x - originX,
    observerV: t.y - originY,
    coverage: got / (block * block),
    dispose: () => {
      if (cache.get(key)?.texture === target.texture) cache.delete(key);
      target.dispose();
    },
  };
  cache.set(key, patch);
  while (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value as string;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    oldest?.dispose();
  }
  return patch;
}

/** `demGlsl(prefix)` 가 기대하는 유니폼을 만듭니다 (기본 접두사 `dem`). */
export function makeDemUniforms(
  patch: DemPatch | null,
  prefix: string = 'dem',
): Record<string, { value: unknown }> {
  const block = patch?.blockTiles ?? DEM_BLOCK_TILES;
  const U = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return {
    [`u${U}Tex`]: { value: patch?.texture ?? null },
    [`u${U}Obs`]: {
      value: new THREE.Vector2(
        patch?.observerU ?? block / 2,
        patch?.observerV ?? block / 2,
      ),
    },
    [`u${U}SpanM`]: { value: patch?.tileSpanM ?? 1 },
    [`u${U}Block`]: { value: block },
    [`u${U}Valid`]: { value: patch ? 1 : 0 },
  };
}

/**
 * CPU 쪽 디코드 — **검증과 도구 전용** 입니다.
 *
 * 앱은 셰이더에서 디코드하므로 이 함수를 쓰지 않습니다. 판정(`verify-dem.js`)
 * 이 읽어 온 화소를 고도로 바꿀 때만 씁니다.
 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
