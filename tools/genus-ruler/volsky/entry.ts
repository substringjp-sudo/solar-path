/**
 * 볼륨 하늘 측정 하네스(§127) — **앱의** volumetricScene.ts 를 그대로 묶어 브라우저에서 그립니다.
 * 대기 표는 한 번만 만들고(SwiftShader 60~70초), 장면은 `window.__job(job)` 으로 여러 개를 이어 그립니다.
 * 출력은 하늘 화면과 같은 길(renderToTexture → sRGB 부호화 복사, SceneComposer 와 같음): rgb = 표시 색, 알파 = 구름 불투명도.
 *
 * 묶기·돌리기: run.js 머리말.
 */
import { DataTexture, Mesh, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, Vector3, WebGLRenderer, type Texture } from 'three';
import { PrecomputedTexturesLoader } from '@takram/three-atmosphere';
import { autoExposure, createVolumetricScene, type VolumetricOptions, type VolumetricQuality, type VolumetricSceneInput } from '../../../src/components/VolumetricProbe/volumetricScene';
import { sunPosition } from '../../../src/utils/solarPosition';

type Job = {
  input: Omit<VolumetricSceneInput, 'date'> & { date: string };
  frames?: number;
  quality?: VolumetricQuality;
  res?: number;
  options?: Partial<VolumetricOptions>;
  /** 'rgb' 표시 색 · 'alpha' 구름 불투명도(회색) · 'both' 둘 다 · 'direct' 텍스처를 거치지 않고 화면에 바로(시제품과 같은 길) */
  out?: 'rgb' | 'alpha' | 'both' | 'direct';
  /** 손으로 만든 지형 거리 판(§127 판정): 화면 아래 frac 만큼(물결 능선)을 km 거리의 지형으로 둡니다. */
  terrain?: { km: number; frac: number };
  /**
   * 운량 → 면적 자(§127): 같은 장면을 여러 시선으로 그려, 지평선 위 화소 중 구름 불투명도 ≥ alphaMin 인 비율을 냅니다.
   * 주면 그림을 돌려주지 않고 views 마다 { area, sky } 만 돌려줍니다.
   */
  views?: { az: number; el: number }[];
  alphaMin?: number;
  /** 표시 곡선 바꾸기(postprocessing ToneMappingMode 번호) — 진단용 */
  tone?: number;
  /** §137 D1 진단: takram 하늘빛·지면 반사 몫 배율(기본 1 = 손대지 않음). 잡마다 기본값으로 되돌립니다. */
  fill?: { skyLightScale?: number; groundBounceScale?: number };
  /** §138 노출 배율 — 장면 노출(input.exposure 또는 해 고도의 autoExposure)에 곱합니다. 후보 모두에 같은 값(RULER-physics3 §3). 기본 1. */
  exposureScale?: number;
};
const terrainTex = (km: number, frac: number) => {
  // SceneComposer TERRAIN_DIST_GLSL 의 부호화와 같음: t = log2(km/1e-3)/20 → 16비트(R 위·G 아래).
  const t = Math.min(0.9999, Math.max(0, Math.log2(Math.max(km, 1e-3) / 1e-3) / 20));
  const v = Math.floor(t * 65535 + 0.5), hi = Math.floor(v / 256), lo = v - hi * 256;
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ridge = H * (frac + 0.06 * Math.sin((x / W) * Math.PI * 3));
    const i = (y * W + x) * 4, terr = y < ridge;   // 텍스처 v=0 이 화면 아래
    d[i] = terr ? hi : 255; d[i + 1] = terr ? lo : 255; d[i + 2] = 0; d[i + 3] = 255;
  }
  const tx = new DataTexture(d, W, H, RGBAFormat, UnsignedByteType);
  tx.minFilter = tx.magFilter = NearestFilter; tx.needsUpdate = true;
  return tx;
};

const errors: string[] = [];
window.addEventListener('error', e => errors.push(String(e.message)));
const Q = new URLSearchParams(location.search);
const W = Number(Q.get('w') ?? 390), H = Number(Q.get('h') ?? 584);
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.style.margin = '0';
document.body.appendChild(canvas);
const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);

const blitScene = new Scene();
const blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new ShaderMaterial({
  uniforms: { uTex: { value: null }, uMode: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'precision highp float; uniform sampler2D uTex; uniform float uMode; varying vec2 vUv;'
    // 하늘 화면 합성기(SceneComposer)와 같게: 선형 rgb 를 sRGB 로 부호화(§127).
    + 'vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }'
    + 'void main(){ vec4 t = texture2D(uTex, vUv); gl_FragColor = uMode > 0.5 ? vec4(vec3(clamp(t.a, 0.0, 1.0)), 1.0) : vec4(enc(t.rgb), 1.0); }',
  depthTest: false, depthWrite: false,
});
const quad = new Mesh(new PlaneGeometry(2, 2), blitMat);
quad.frustumCulled = false;
blitScene.add(quad);
const show = (tex: Texture, mode: number) => {
  blitMat.uniforms.uTex.value = tex; blitMat.uniforms.uMode.value = mode;
  renderer.setRenderTarget(null); renderer.autoClear = true;
  renderer.render(blitScene, blitCam);
  return canvas.toDataURL('image/png');
};

(async () => {
  try {
    const t0 = performance.now();
    // ?atmos=load — takram 의 미리 만든 대기 표(assets/*.bin)를 읽습니다(앱은 기기에서 만듦 — 둘을 견줄 때, 그리고 빠르게 돌릴 때).
    const precomputed = Q.get('atmos') === 'load'
      ? await new Promise<Record<string, unknown>>((res, rej) => new PrecomputedTexturesLoader({ format: 'binary' }).setType(renderer).load('assets', t => res(t as unknown as Record<string, unknown>), undefined, rej))
      : undefined;
    // §128 분광 대기 표·유효 투과율(앱과 같이 기본 켬 — 미리 만든 표를 읽으면 꺼짐). ?spectral=0 으로 3파장, ?efft=0 으로 680·550·440nm 투과율.
    const vol = await createVolumetricScene(renderer, W, H, {
      genus: true, celestial: Q.get('celestial') === '1', precomputed,
      spectral: Q.get('spectral') !== '0', effectiveTransmittance: Q.get('efft') !== '0',
    });
    (window as unknown as Record<string, unknown>).__spectral = vol.spectral;
    (window as unknown as Record<string, unknown>).__atmosMs = performance.now() - t0;
    (window as unknown as Record<string, unknown>).__vol = vol;
    // 진단: 구름·그림자 패스 균일변수 중 NaN·무한대가 든 것의 이름.
    (window as unknown as Record<string, unknown>).__badUniforms = () => {
      const bad: string[] = [];
      const scan = (tag: string, u: Record<string, { value: unknown }>) => {
        for (const [k, { value: v }] of Object.entries(u)) {
          const nums: number[] = typeof v === 'number' ? [v]
            : v && typeof v === 'object' && 'toArray' in (v as object) ? ((v as { toArray(): number[] }).toArray())
            : v && typeof v === 'object' && 'elements' in (v as object) ? Array.from((v as { elements: number[] }).elements)
            : Array.isArray(v) ? (v as unknown[]).flatMap(x => (x && typeof x === 'object' && 'toArray' in (x as object) ? (x as { toArray(): number[] }).toArray() : typeof x === 'number' ? [x] : [])) : [];
          if (nums.some(n => !Number.isFinite(n))) bad.push(tag + '.' + k + '=' + JSON.stringify(nums.slice(0, 6)));
        }
      };
      const c = vol.debug.clouds as unknown as { cloudsPass: { currentMaterial: { uniforms: Record<string, { value: unknown }> } }; shadowPass: { currentMaterial: { uniforms: Record<string, { value: unknown }> } } };
      scan('clouds', c.cloudsPass.currentMaterial.uniforms);
      scan('shadow', c.shadowPass.currentMaterial.uniforms);
      return bad;
    };
    /** 잡이 안 준 옵션의 기본값(장면 생성 시와 같음). 새 옵션을 추가하면 여기에도 적습니다. */
    const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = {
      genus: true, coverRemap: true, weatherLod: null, shadowMinSunDeg: 12, sunMarch: [6, 250, 1.6], accurateSunBelowDeg: null, maxRayKm: null,
      flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2,
      flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: true, physics: false, physicsIce: false, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1,
    };
    (window as unknown as Record<string, unknown>).__job = async (job: Job) => {
      const input = { ...job.input, date: new Date(job.input.date) } as VolumetricSceneInput;
      if (job.exposureScale != null && job.exposureScale !== 1) {
        const sunAltDeg = (sunPosition(input.date, input.lat, input.lon).altitude * 180) / Math.PI;
        input.exposure = (input.exposure ?? autoExposure(sunAltDeg)) * job.exposureScale;
      }
      // §130 잡마다 옵션을 기본값으로 되돌린 뒤 덮어씁니다 — 예전에는 options 없는 잡이 앞 잡의 옵션(flow 등)을 물려받았습니다.
      // reapply=false: 아래 setScene 이 장면을 걸므로 두 번 만들지 않습니다.
      vol.setOptions({ ...JOB_BASE_OPTIONS, ...(job.options ?? {}) }, false);
      if (job.tone != null) vol.debug.toneMapping.mode = job.tone;
      // §137 잡마다 하늘빛·지면 반사 배율을 기본값 1 로 되돌린 뒤 덮어씁니다(앞 잡의 진단 값을 물려받지 않게).
      vol.debug.clouds.skyLightScale = job.fill?.skyLightScale ?? 1;
      vol.debug.clouds.groundBounceScale = job.fill?.groundBounceScale ?? 1;
      vol.setQuality(job.quality ?? 'low');
      vol.setResolutionScale(job.res ?? 0.5);
      vol.setScene(input);
      vol.setTerrainDistance(job.terrain ? terrainTex(job.terrain.km, job.terrain.frac) : null);
      const frames = job.frames ?? 48;
      if (job.views) {
        const gl = renderer.getContext(), px = new Uint8Array(W * H * 4), th = Math.round((job.alphaMin ?? 0.15) * 255);
        const cam = vol.camera as PerspectiveCamera, v = new Vector3();
        const res: { az: number; el: number; area: number; sky: number }[] = [];
        for (const vw of job.views) {
          vol.setView(vw.az, vw.el, input.fov);
          let tex: Texture | null = null;
          for (let i = 0; i < frames; i++) tex = vol.renderToTexture(1 / 60);
          show(tex as Texture, 1);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let sky = 0, cl = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            // 화소 방향의 고도(장면 좌표 = 북·위·동, 위 = y) — 지평선 아래는 뺍니다.
            v.set(((x + 0.5) / W) * 2 - 1, ((y + 0.5) / H) * 2 - 1, 0.5).unproject(cam).sub(cam.position);
            if (v.y <= 0) continue;
            sky++; if (px[(y * W + x) * 4] >= th) cl++;
          }
          res.push({ az: vw.az, el: vw.el, area: sky ? cl / sky : 0, sky });
        }
        return { views: res, weatherMs: vol.weatherMs() };
      }
      const ts = performance.now();
      let tex: Texture | null = null;
      if (job.out === 'direct') {
        for (let i = 0; i < frames; i++) vol.render(1 / 60);
        return { scene: vol.lastScene(), rgb: canvas.toDataURL('image/png') };
      }
      for (let i = 0; i < frames; i++) tex = vol.renderToTexture(1 / 60);
      const ms = (performance.now() - ts) / frames;
      const out: Record<string, unknown> = { ms, scene: vol.lastScene(), weatherMs: vol.weatherMs(), flowInfo: vol.flowInfo(), physics: vol.physicsInfo(), glError: renderer.getContext().getError(),
        bad: ((window as unknown as Record<string, unknown>).__badUniforms as () => string[])() };
      // §139 진단: fetch 레인 균일변수(구름·그림자 패스)
      {
        const c = vol.debug.clouds as unknown as { cloudsPass: { currentMaterial: { uniforms: Record<string, { value: unknown }> } }; shadowPass: { currentMaterial: { uniforms: Record<string, { value: unknown }> } } };
        const dump = (u: Record<string, { value: unknown }>) => Object.fromEntries(['genusUvOn', 'genusTileM', 'genusTiltU', 'genusTiltV', 'genusDriftU', 'genusDriftV', 'genusSkel', 'genusMode'].map(k => {
          const v = u[k]?.value as { toArray?: () => number[] } | number | undefined;
          return [k, v == null ? null : typeof v === 'number' ? v : (v.toArray ? v.toArray() : v)];
        }));
        out.uvLane = { clouds: dump(c.cloudsPass.currentMaterial.uniforms), shadow: dump(c.shadowPass.currentMaterial.uniforms) };
      }
      const o = job.out ?? 'rgb';
      if (o === 'rgb' || o === 'both') out.rgb = show(tex as Texture, 0);
      if (o === 'alpha' || o === 'both') out.alpha = show(tex as Texture, 1);
      return out;
    };
  } catch (e) { errors.push('예외: ' + ((e as Error)?.stack ?? e)); }
  (window as unknown as Record<string, unknown>).__errors = errors;
  document.title = 'READY::' + (errors.length ? 'ERR' : 'OK');
})();
