/**
 * **지형의 보임새 손잡이** (§156) — 볼륨 하늘 경로에서 땅을 하늘과 같은 빛으로 칠할 때 쓰는 값들.
 *
 * 값을 셰이더에 박지 않고 한 곳에 둔 까닭: 하네스(`tools/web-repro`)가 같은 페이지에서 값을 바꿔 가며 찍어
 * A/B 를 하고, 개발 패널이 나중에 같은 값을 만지게 하려는 것입니다. 지형·해수면 재질이 만들어질 때
 * `bindTerrainLook` 으로 균일변수를 등록하면, `setTerrainLook` 이 등록된 곳 전부에 값을 밀어 넣습니다.
 *
 * 전부 **볼륨 하늘 경로(지형 빛 판)** 에만 걸립니다. 이전 대기 모형으로 직접 칠하는 경로(`TerrainField` 의
 * 색 출력)는 이 값을 읽지 않으므로 기존 판정이 그대로 유효합니다.
 */
export interface TerrainLook {
  /**
   * 하늘이 보이는 몫(지평선 가림)을 하늘빛에 얼마나 반영하나 (0~1). 0 이면 예전처럼 어디나 열린 하늘.
   * 골짜기·절벽 밑·섬 사이가 어두워지고 능선·벌판이 밝아져 **형태**가 읽힙니다.
   */
  ao: number;
  /**
   * 사면이 하늘을 향한 정도 `(1 + n.y) / 2` 를 하늘빛에 얼마나 반영하나 (0~1).
   * 직달이 없는 흐린 날에는 이것이 사면의 향을 보여 주는 거의 유일한 단서입니다.
   */
  hemi: number;
  /** 위 둘이 평균을 낮추는 만큼의 보정 — 평평한 벌판의 밝기는 예전 그대로 두려는 값. */
  ambGain: number;
  /**
   * 구름이 해를 가린 땅에 **구름을 뚫고 흩어진 햇빛**이 닿는 몫(직달 대비, 0~1).
   * 예전에는 구름 그늘의 땅이 하늘빛(맑은 하늘 모형)만 받아 흐린 날 땅이 검은 판이 됐습니다. 두꺼운 층운의
   * 확산 투과율은 0.1~0.3 입니다.
   */
  cloudFill: number;
  /** 젖은 갯벌·모래의 하늘 되비침 세기 (0~1). 0 이면 끔. */
  sheen: number;
  /** 땅 알베도의 얼룩(풀·흙·마른 갯벌) 세기. 0 이면 끔. 평균 밝기는 그대로입니다. */
  mottle: number;
  /** 자료 아래 미세 기복(0.5~4m 요철)의 법선 세기. 0 이면 끔. 낮은 해가 스칠 때 땅의 결로 읽힙니다. */
  micro: number;
}

export const TERRAIN_LOOK: TerrainLook = {
  ao: 0.85,
  hemi: 0.6,
  ambGain: 1.15,
  cloudFill: 0.5,
  sheen: 0.65,
  mottle: 1.0,
  micro: 1.0,
};

type Uniforms = Record<string, { value: unknown }>;
const bound = new Set<Uniforms>();

function apply(u: Uniforms): void {
  const put = (k: string, v: number) => { if (u[k]) u[k].value = v; };
  put('uLookAo', TERRAIN_LOOK.ao);
  put('uLookHemi', TERRAIN_LOOK.hemi);
  put('uLookAmbGain', TERRAIN_LOOK.ambGain);
  put('uLookFill', TERRAIN_LOOK.cloudFill);
  put('uLookSheen', TERRAIN_LOOK.sheen);
  put('uLookMottle', TERRAIN_LOOK.mottle);
  put('uLookMicro', TERRAIN_LOOK.micro);
}

/** 재질의 균일변수 객체를 등록합니다. 돌려주는 함수로 등록을 풉니다(재질을 버릴 때). */
export function bindTerrainLook(u: Uniforms): () => void {
  bound.add(u);
  apply(u);
  return () => { bound.delete(u); };
}

/** 값을 바꾸고 등록된 모든 재질에 밀어 넣습니다. */
export function setTerrainLook(p: Partial<TerrainLook>): void {
  Object.assign(TERRAIN_LOOK, p);
  bound.forEach(apply);
}

/** 재질이 만들어질 때 쓸 균일변수 초기값. */
export function makeTerrainLookUniforms(): Uniforms {
  return {
    uLookAo: { value: TERRAIN_LOOK.ao },
    uLookHemi: { value: TERRAIN_LOOK.hemi },
    uLookAmbGain: { value: TERRAIN_LOOK.ambGain },
    uLookFill: { value: TERRAIN_LOOK.cloudFill },
    uLookSheen: { value: TERRAIN_LOOK.sheen },
    uLookMottle: { value: TERRAIN_LOOK.mottle },
    uLookMicro: { value: TERRAIN_LOOK.micro },
  };
}

/**
 * 지형 빛 판 둘째 출력의 부호화(8비트) — 지형·해수면 쌍둥이가 쓰고, 볼륨 하늘의 대기 효과가 읽습니다(volumetricScene).
 *   R: 하늘빛 몫(AO × 반구 × 보정, 0~1.25 를 0~1 로) · G: 젖은 면의 하늘 되비침 가중 · B: 구름을 뚫은 햇빛 몫 ·
 *   A: 구름낌(1 − 직달 투과율) — 구름 그늘 아래 하늘빛을 중성으로 섞는 데 씁니다(맑은 하늘 모형은 파란 하늘빛만 압니다).
 */
export const LIT2_AMB_RANGE = 1.25;
export const LIT2_ENCODE_GLSL = /* glsl */ `
vec4 lit2Encode(float amb, float wet, float fill, float cloudy) {
  return vec4(clamp(amb / ${LIT2_AMB_RANGE.toFixed(2)}, 0.0, 1.0), clamp(wet, 0.0, 1.0), clamp(fill, 0.0, 1.0), clamp(cloudy, 0.0, 1.0));
}
`;
