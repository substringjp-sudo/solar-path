/**
 * **하늘이 보이는 몫을 DEM 에서 한 번 굽습니다** (§157) — 지형이 입체로 읽히게 하는 둘째 단서.
 *
 * ## 왜 필요한가
 *
 * 볼륨 하늘 경로에서 땅의 하늘빛 조도는 `수평면이 받는 값 한 개`였습니다. 직달이 구름에 가려진 날(0점짜리
 * 흐린 날)은 직달 항이 0 이라 땅이 **한 색 판**이 됩니다 — 사면의 향도, 골짜기도, 섬 사이 물길도 안 보입니다.
 * 사진에서 흐린 날 땅이 입체로 읽히는 까닭은 직달이 아니라 **하늘이 얼마나 보이느냐**입니다:
 * 능선·벌판은 하늘을 다 보고 골짜기·절벽 밑·언덕 사이는 지평선에 하늘이 가려 어둡습니다.
 *
 * ## 무엇을 굽나
 *
 * 화소(DEM 한 칸)마다 8방위로 지평선 앙각을 훑어 `V = 평균(cos²(앙각))` 을 냅니다. 수평면이 받는 하늘 조도를
 * 코사인 가중으로 적분하면 방위 한 조각이 `cos²(지평선 앙각)/2` 라서, 이것이 곧 **열린 하늘 대비 하늘빛의
 * 몫**입니다(균일한 하늘 가정). 거리는 15m(DEM 한 칸) 부터 1.5km 까지 로그 간격 11걸음.
 *
 * - R: V (1 = 사방이 트임)
 * - G: 볼록도 — 이 칸 고도가 주변 평균보다 높으면 > 0.5 (능선·둔덕), 낮으면 < 0.5 (골·움푹). 알베도 얼룩이 씁니다.
 *
 * ## 비용
 *
 * 패치(블록)가 바뀔 때만 한 번 굽습니다 — 시각·시선과 무관합니다. 384² × 11걸음 × 8방위 × 4칸 읽기 ≈ 5천만 읽기,
 * 휴대폰 GPU 에서 수십 ms. 화소마다는 이 텍스처를 **한 번** 읽을 뿐입니다.
 *
 * ⚠ 맵은 DEM 블록의 UV 와 **같은 좌표**입니다(`dem_uv(지상좌표)` 로 그대로 읽음). 관측자가 블록 안에서 움직여도
 * 다시 굽지 않는 까닭입니다 — 굽는 식이 `dem_uv` 의 역변환을 같은 관측자 값으로 쓰므로 어긋남이 없습니다.
 */
import * as THREE from 'three';
import { DEM_GLSL } from '../../utils/demTiles';

/** 맵 한 변의 화소 수. DEM 블록(768²)의 절반 — AO 는 저주파라 충분합니다. */
export const AMBIENT_MAP_SIZE = 384;
/** 지평선을 훑는 가장 먼 거리(m). */
export const AMBIENT_REACH_M = 1500;

const BAKE_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BAKE_FRAG = /* glsl */ `
precision highp float;
${DEM_GLSL}
uniform float uMapN;

void main() {
  // 이 화소가 덮는 지상 좌표(동, 남 m, 관측자 원점) — dem_uv 의 역.
  vec2 uv = (gl_FragCoord.xy) / uMapN;
  vec2 g = (uv * uDemBlock - uDemObs) * uDemSpanM;
  float h0 = dem_elevationAt(g);

  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = (float(i) + 0.5) * 0.7853982;
    vec2 d = vec2(cos(a), sin(a));
    float best = 0.0;   // 지평선 앙각의 tan (수평 아래는 하늘을 안 가리므로 0 에서 자름)
    for (int j = 0; j < 11; j++) {
      float t = 15.0 * pow(${(AMBIENT_REACH_M / 15).toFixed(1)}, float(j) / 10.0);
      float h = dem_elevationAt(g + d * t);
      best = max(best, (h - h0) / t);
    }
    sum += 1.0 / (1.0 + best * best);     // cos²(atan(best))
  }
  float V = sum / 8.0;

  // 볼록도: 60m 둘레 네 점 평균과의 차 (6m 에서 포화).
  float m = 0.25 * (dem_elevationAt(g + vec2(60.0, 0.0)) + dem_elevationAt(g - vec2(60.0, 0.0))
                  + dem_elevationAt(g + vec2(0.0, 60.0)) + dem_elevationAt(g - vec2(0.0, 60.0)));
  float convex = clamp(0.5 + 0.5 * (h0 - m) / 6.0, 0.0, 1.0);

  gl_FragColor = vec4(V, convex, 0.5, 1.0);
}
`;

export interface TerrainAmbientBake {
  /** 구운 맵. 아직 안 구웠으면 null. */
  texture: () => THREE.Texture | null;
  /** 판정 전용 — 구운 렌더 타깃(화소를 읽어 CPU 참조와 견주려고). 앱은 쓰지 않습니다. */
  debugTarget: () => THREE.WebGLRenderTarget | null;
  /**
   * 이 DEM 패치 텍스처로 구워 둔 것이 아니면 다시 굽습니다. 같으면 아무것도 안 합니다(매 프레임 불러도 됨).
   * `demUniforms` 는 `makeDemUniforms` 가 만든 `uDem*` 균일변수 객체(재질이 쓰는 것 그대로 — 값 변경을 따라옵니다).
   * 반환: 지금 쓸 수 있는 맵이 있는가.
   */
  bake: (renderer: THREE.WebGLRenderer, demUniforms: Record<string, { value: unknown }>) => boolean;
  dispose: () => void;
}

export function createTerrainAmbientBake(): TerrainAmbientBake {
  let rt: THREE.WebGLRenderTarget | null = null;
  let bakedFor: THREE.Texture | null = null;
  let mat: THREE.ShaderMaterial | null = null;
  let quad: THREE.Mesh | null = null;
  let scene: THREE.Scene | null = null;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const ensure = (demUniforms: Record<string, { value: unknown }>) => {
    if (rt) return;
    rt = new THREE.WebGLRenderTarget(AMBIENT_MAP_SIZE, AMBIENT_MAP_SIZE, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      // 부드럽게 읽습니다 — 384² 를 768² 블록 위에 늘려 쓰므로 선형이 맞습니다.
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    // 균일변수는 재질의 것과 **같은 객체**를 나눠 씁니다(uDemTex·uDemObs 가 setPatch 로 바뀌면 따라옴).
    mat = new THREE.ShaderMaterial({
      uniforms: { ...demUniforms, uMapN: { value: AMBIENT_MAP_SIZE } },
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene = new THREE.Scene();
    scene.add(quad);
  };

  return {
    texture: () => (bakedFor ? rt?.texture ?? null : null),
    debugTarget: () => (bakedFor ? rt : null),
    bake: (renderer, demUniforms) => {
      const tex = demUniforms.uDemTex?.value as THREE.Texture | null | undefined;
      const valid = (demUniforms.uDemValid?.value as number) > 0.5;
      if (!tex || !valid) { bakedFor = null; return false; }
      if (bakedFor === tex) return true;
      ensure(demUniforms);
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.render(scene!, cam);
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
      bakedFor = tex;
      return true;
    },
    dispose: () => {
      rt?.dispose(); mat?.dispose(); quad?.geometry.dispose();
      rt = null; mat = null; quad = null; scene = null; bakedFor = null;
    },
  };
}
