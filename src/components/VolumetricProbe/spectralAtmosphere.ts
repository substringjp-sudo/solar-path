/**
 * spectralAtmosphere.ts — 대기 표를 **파장 15개**로 미리 계산합니다(문서 §128, 2026-10-05).
 *
 * takram 의 표 생성기는 파장 셋(680 · 550 · 440nm)에서 복사휘도를 계산하고, 그리는 쪽에서 채널마다 상수를 곱해
 * 휘도로 바꿉니다(Bruneton 의 3파장 근사). 박명에는 이 근사가 크게 틀립니다 — 빨강을 680nm 한 점으로 보니
 * 오존(샤퓌 띠, 600nm 근처 최대)과 레일리 산란을 실제 빨강 채널(570~700nm)보다 훨씬 적게 받아, 해 −3~−5° 에
 * 서쪽 하늘이 자주색이 됩니다(기기 화면 자주 비율 0.90 · 사진 0.00, RULER-twilight-hue.md). CPU 단일 산란 비교:
 * 해 −5°, 고도 25° 에서 3파장 (1, 0.43, 0.71) · 분광 (0.50, 0.60, 1).
 *
 * Bruneton 원 모형의 "휘도를 미리 계산" 방식 그대로입니다(model.cc Model::Init, num_precomputed_wavelengths = 15):
 * 360~830nm 를 15개 파장으로 나눠 셋씩 다섯 번 미리 계산하고, 매번 그 파장의 CIE 등색 함수 → sRGB 계수
 * (luminanceFromRadiance)로 바꿔 표에 **더합니다**. 표에는 휘도 ÷ 683 이 들어가므로 그리는 쪽의 하늘 환산 상수는
 * 683 입니다(`SPECTRAL_SKY_RADIANCE_TO_RELATIVE_LUMINANCE`). 해 직달빛은 원 모형처럼 680·550·440nm 투과율을 다시
 * 계산해 쓰는데, 앱은 `effectiveTransmittance`(태양 분광 × 등색 함수 가중 평균 투과율, 아래)를 씁니다.
 *
 * takram 생성기의 비공개 메서드(precompute · computeTransmittance)를 감쌉니다 — 빌드에도 이름이 남아 있고
 * (three-atmosphere 0.19.1), 바뀌면 `patchSpectralGenerator` 가 false 를 돌려 3파장 그대로 둡니다.
 */
import { AtmosphereParameters, type PrecomputedTexturesGenerator } from '@takram/three-atmosphere';
import {
  AddEquation, Color, CustomBlending, FloatType, GLSL3, HalfFloatType, LinearFilter, Matrix3, NoBlending, OneFactor,
  RawShaderMaterial, RGBAFormat, Uniform, Vector2, Vector3, WebGLRenderTarget,
  type Camera, type Material, type Mesh, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { CIE_2DEG, OZONE_CROSS_SECTION, SOLAR_IRRADIANCE, XYZ_TO_SRGB } from './spectralTables';

const LAMBDA_MIN = 360, LAMBDA_MAX = 830;
/** 미리 계산할 파장 수(Bruneton 데모의 PRECOMPUTED 와 같음). 3의 배수. */
export const SPECTRAL_WAVELENGTHS = 15;
export const MAX_LUMINOUS_EFFICACY = 683;
/** takram 의 상대 휘도 기준(해의 단위 복사휘도 → 휘도) — AtmosphereParameters 생성자와 같은 식. */
const SUN_LUMINANCE = new Vector3(0.2126, 0.7152, 0.0722).dot(new AtmosphereParameters().sunRadianceToLuminance);
/** 분광 표일 때의 하늘 환산 상수(상대). 3파장일 때는 (1.52, 0.94, 0.86) 입니다. */
export const SPECTRAL_SKY_RADIANCE_TO_RELATIVE_LUMINANCE = MAX_LUMINOUS_EFFICACY / SUN_LUMINANCE;

/** 10nm 표(360~830nm) 선형 보간 — Bruneton Interpolate 와 같음. */
function table10(t: number[], lambda: number): number {
  const x = (lambda - LAMBDA_MIN) / 10;
  if (x <= 0) return t[0];
  if (x >= t.length - 1) return t[t.length - 1];
  const i = Math.floor(x), u = x - i;
  return t[i] * (1 - u) + t[i + 1] * u;
}
/** CIE 등색 함수(5nm 표) 선형 보간 — c = 1 x̄, 2 ȳ, 3 z̄. Bruneton CieColorMatchingFunctionTableValue 와 같음. */
function cmf(lambda: number, c: 1 | 2 | 3): number {
  if (lambda <= LAMBDA_MIN || lambda >= LAMBDA_MAX) return 0;
  const x = (lambda - LAMBDA_MIN) / 5, row = Math.floor(x), u = x - row;
  return CIE_2DEG[4 * row + c] * (1 - u) + CIE_2DEG[4 * (row + 1) + c] * u;
}
/** 파장 λ 의 분광 복사휘도 1 이 sRGB 채널 k 에 보태는 몫(× dλ, 683 은 뺌) — Model::Init 의 coeff. */
function srgbCoeff(lambda: number, k: number, dlambda: number): number {
  const x = cmf(lambda, 1), y = cmf(lambda, 2), z = cmf(lambda, 3);
  return (XYZ_TO_SRGB[3 * k] * x + XYZ_TO_SRGB[3 * k + 1] * y + XYZ_TO_SRGB[3 * k + 2] * z) * dlambda;
}

/** 오존 최대 수밀도(m⁻³): 300 돕슨 ÷ 밀도 단면 적분 15km — demo.cc kMaxOzoneNumberDensity. */
const MAX_OZONE_NUMBER_DENSITY = (300 * 2.687e20) / 15000;
/**
 * 파장 셋의 대기 값(takram 길이 단위 = km). takram 기본값이 바로 이 식의 680·550·440nm 값입니다
 * (레일리 5.802e-3 · 오존 6.5e-4/km 등) — 에어로졸·지면 반사·밀도 단면은 파장과 무관해 그대로 둡니다.
 */
export function spectralParameters(lambdas: readonly [number, number, number]): AtmosphereParameters {
  const p = new AtmosphereParameters();
  const at = (f: (l: number) => number) => new Vector3(f(lambdas[0]), f(lambdas[1]), f(lambdas[2]));
  p.solarIrradiance.copy(at(l => table10(SOLAR_IRRADIANCE, l)));
  p.rayleighScattering.copy(at(l => 1.24062e-6 * Math.pow(l * 1e-3, -4) * 1000));
  p.absorptionExtinction.copy(at(l => MAX_OZONE_NUMBER_DENSITY * table10(OZONE_CROSS_SECTION, l) * 1000));
  return p;
}

export interface SpectralBatch {
  lambdas: [number, number, number];
  params: AtmosphereParameters;
  /** 이 파장 셋의 복사휘도 → sRGB 휘도 ÷ 683 */
  luminanceFromRadiance: Matrix3;
  /** 유효 투과율 가중치: 행 k = 채널 k 에 이 파장 셋의 투과율이 보태는 몫(모든 묶음 합 = 1) */
  transmittanceWeights: Matrix3;
}

export function spectralBatches(n: number = SPECTRAL_WAVELENGTHS): SpectralBatch[] {
  const iters = Math.ceil(n / 3), dl = (LAMBDA_MAX - LAMBDA_MIN) / (3 * iters);
  const all: number[] = [];
  for (let i = 0; i < 3 * iters; i++) all.push(LAMBDA_MIN + (i + 0.5) * dl);
  // 유효 투과율: T_k = Σ E(λ)·c_k(λ)·T(λ) ÷ Σ E(λ)·c_k(λ) — 해 직달빛(태양 분광)을 sRGB 로 적분한 가중치.
  const norm = [0, 1, 2].map(k => all.reduce((s, l) => s + table10(SOLAR_IRRADIANCE, l) * srgbCoeff(l, k, dl), 0));
  const out: SpectralBatch[] = [];
  for (let i = 0; i < iters; i++) {
    const L = [all[3 * i], all[3 * i + 1], all[3 * i + 2]] as [number, number, number];
    const c = (j: number, k: number) => srgbCoeff(L[j], k, dl);
    const w = (j: number, k: number) => (table10(SOLAR_IRRADIANCE, L[j]) * c(j, k)) / norm[k];
    out.push({
      lambdas: L,
      params: spectralParameters(L),
      luminanceFromRadiance: new Matrix3().set(c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1), c(0, 2), c(1, 2), c(2, 2)),
      transmittanceWeights: new Matrix3().set(w(0, 0), w(1, 0), w(2, 0), w(0, 1), w(1, 1), w(2, 1), w(0, 2), w(1, 2), w(2, 2)),
    });
  }
  return out;
}

/** 그리는 쪽 대기 값: 분광 표면 하늘 환산 상수만 683(상대)로. 해 쪽 상수·나머지는 takram 기본. */
export function renderAtmosphere(spectral: boolean): AtmosphereParameters {
  const p = new AtmosphereParameters();
  if (spectral) p.skyRadianceToRelativeLuminance.setScalar(SPECTRAL_SKY_RADIANCE_TO_RELATIVE_LUMINANCE);
  return p;
}

interface GenInternals {
  precompute(ctx: GenContext, additive: boolean): Iterable<void>;
  computeTransmittance(p: { renderTarget: WebGLRenderTarget }): void;
  transmittanceRenderTarget: WebGLRenderTarget;
  transmittanceMaterial: Material & { uniforms: { ATMOSPHERE: Uniform } };
  renderer: WebGLRenderer;
  type: typeof FloatType | typeof HalfFloatType;
  mesh: Mesh; scene: Scene; camera: Camera;
}
interface GenContext { lambdas: Vector3; luminanceFromRadiance: Matrix3 }

const QUAD_VERT = 'precision highp float;\nin vec2 position;\nvoid main() { gl_Position = vec4(position, 1.0, 1.0); }';
const accumMaterial = () => new RawShaderMaterial({
  glslVersion: GLSL3,
  vertexShader: QUAD_VERT,
  fragmentShader: 'precision highp float;\nuniform sampler2D tex;\nuniform vec2 size;\nuniform mat3 weights;\nuniform float alpha;\nuniform float clampOut;\nout vec4 outColor;\n'
    + 'void main() { vec3 t = texture(tex, gl_FragCoord.xy / size).rgb; vec3 v = weights * t;\n'
    + '  outColor = vec4(clampOut > 0.5 ? clamp(v, 0.0, 1.0) : v, alpha); }',
  uniforms: { tex: new Uniform<Texture | null>(null), size: new Uniform(new Vector2()), weights: new Uniform(new Matrix3()), alpha: new Uniform(1), clampOut: new Uniform(0) },
  depthTest: false, depthWrite: false,
});

/**
 * 생성기를 분광 미리 계산으로 바꿉니다(`update()` 를 부르기 전에 한 번). 내부가 기대와 다르면 false(3파장 그대로).
 * effectiveTransmittance: 투과율 표를 680·550·440nm 값 대신 태양 분광 × 등색 함수 가중 평균으로(§128 — 먼 구름 아래 청록 띠를 없앰).
 */
export function patchSpectralGenerator(gen: PrecomputedTexturesGenerator, opts: { effectiveTransmittance?: boolean } = {}): boolean {
  const g = gen as unknown as GenInternals;
  if (typeof g.precompute !== 'function' || typeof g.computeTransmittance !== 'function' || !g.transmittanceRenderTarget || !g.transmittanceMaterial) return false;
  const orig = g.precompute;
  const batches = spectralBatches();
  g.precompute = function* (ctx: GenContext, additive: boolean) {
    // update() 는 여섯 재료에 같은 ATMOSPHERE 균일변수를 걸어 둡니다 — 값만 묶음마다 바꿉니다(three 가 균일변수 목록을 붙들고 있음).
    const atm = g.transmittanceMaterial.uniforms.ATMOSPHERE;
    const rgb = atm.value;
    try {
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        atm.value = b.params.toUniform().value;
        ctx.lambdas.set(b.lambdas[0], b.lambdas[1], b.lambdas[2]);
        ctx.luminanceFromRadiance.copy(b.luminanceFromRadiance);
        yield* orig.call(g, ctx, additive || i > 0);
      }
      if (opts.effectiveTransmittance) {
        effectiveTransmittance(g, batches);
      }
    } finally {
      atm.value = rgb;
      ctx.lambdas.set(680, 550, 440);
      ctx.luminanceFromRadiance.identity();
    }
    // 원 모형: 마지막 묶음의 투과율이 남아 있으므로 680·550·440nm 로 다시 계산합니다.
    if (!opts.effectiveTransmittance) g.computeTransmittance({ renderTarget: g.transmittanceRenderTarget });
    g.renderer.setRenderTarget(null);
  };
  return true;
}

/** 묶음마다 투과율을 계산해 가중치로 더하고(빼는 쪽 등색 함수 때문에 음수가 될 수 있어) [0, 1] 로 잘라 표에 씁니다. */
function effectiveTransmittance(g: GenInternals, batches: SpectralBatch[]): void {
  const rt = g.transmittanceRenderTarget, w = rt.width, h = rt.height;
  const mk = () => new WebGLRenderTarget(w, h, { depthBuffer: false, type: g.type, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter });
  const tmp = mk(), acc = mk();
  const mat = accumMaterial();
  mat.uniforms.size.value.set(w, h);
  const atm = g.transmittanceMaterial.uniforms.ATMOSPHERE;
  const r = g.renderer, prevMat = g.mesh.material;
  const clearColor = r.getClearColor(new Color()), clearAlpha = r.getClearAlpha();
  r.setRenderTarget(acc); r.setClearColor(0x000000, 0); r.clear(true, false, false);
  r.setClearColor(clearColor, clearAlpha);
  for (const b of batches) {
    atm.value = b.params.toUniform().value;
    g.computeTransmittance({ renderTarget: tmp });
    mat.blending = CustomBlending; mat.blendEquation = AddEquation; mat.blendSrc = OneFactor; mat.blendDst = OneFactor;
    mat.uniforms.tex.value = tmp.texture; mat.uniforms.weights.value.copy(b.transmittanceWeights);
    mat.uniforms.alpha.value = 1 / batches.length; mat.uniforms.clampOut.value = 0;
    mat.needsUpdate = true;
    g.mesh.material = mat; r.setRenderTarget(acc); r.render(g.scene, g.camera);
  }
  mat.blending = NoBlending; mat.uniforms.tex.value = acc.texture; mat.uniforms.weights.value.identity();
  mat.uniforms.alpha.value = 1; mat.uniforms.clampOut.value = 1; mat.needsUpdate = true;
  r.setRenderTarget(rt); r.render(g.scene, g.camera);
  g.mesh.material = prevMat;
  tmp.dispose(); acc.dispose(); mat.dispose();
}
