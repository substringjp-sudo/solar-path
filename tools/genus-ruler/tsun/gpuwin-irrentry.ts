/**
 * §180 L7irrprobe 페이지(하네스 전용) — gpuwin-irrprobe.js 가 이 번들(GW_ROOT/bundle-irr, .harness/ 아님)을 SwiftShader Chromium 한 페이지에 띄우고
 * window.__irrProbe(인자) 를 한 번 부릅니다. 페이지 하나 ≤ 60 분(대기 생성 3~12 분 + 탐침 < 2 분 [estimate]).
 *
 * 장면 만들기는 entry-gpuwin.ts 와 같음: createVolumetricScene(renderer, W, H, { genus, celestial false, spectral true, effectiveTransmittance true })
 * — 앱의 15 파장 대기 표를 이 기기 GPU 에서 만듦. P1B(후쿠이 10/02 18:22:21 JST, 해 −9.84°, ac 0.75 · 7.4 km 덮개) low 로 setup(같은 JOB_BASE_OPTIONS ·
 * grainBaseOptions), 두 고침 켬(앱 길)으로 2 프레임 → 구름 패스 재질의 균일변수(카메라·해·고도 보정)가 그 장면 값이 됨.
 *
 * 탐침(gpuwin-irrshader.ts — 구름 패스 조각 글자의 대기 함수 앞부분 + 탐침 main, 재질의 defines·균일변수 객체를 그대로 공유):
 *  - table : 조도 표 텍셀(texelFetch) → node 의 CPU 이식이 이 표로 같은 식을 계산(셰이더 산술·필터만 가름).
 *  - irr   : 열 = 해 −12..+10°(0.05°, μs = float32 sin) × 행 = 높이 0·2·5·7.4 km — GetIrradiance 끔(takram 원문)/켬(§178 irradianceLogMu) 글자 각각.
 *  - aerial: P1 덮개 — 구름 패스 카메라(ECEF + 고도 보정)에서 화면 격자 선마다 덮개 밑면(bottomRadius + 층 고도) 끝점까지
 *            GetSkyRadianceToPoint(그림자 길이 0) — raw(산란 + 투과율) · off(원문 합성 줄) · on(§178 clampInscatter 줄) · sky(맑은 하늘).
 * 읽기: RGBA32F(EXT_color_buffer_float) — 없으면 float 비트를 RGBA8 네 바이트로(정확). 어느 쪽인지 readback 에 적음. 부동 RT 가 되면
 * 표 탐침을 두 길로 다 읽어 비트 같은지도 봄(읽기 길 점검).
 */
import { DataTexture, FloatType, GLSL3, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RawShaderMaterial, RGBAFormat, Scene, UnsignedByteType, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
  type IUniform, type Matrix4, type PerspectiveCamera, type Texture } from 'three';
import { createVolumetricScene, type VolumetricOptions, type VolumetricQuality, type VolumetricSceneInput } from '../../../src/components/VolumetricProbe/volumetricScene';
import { grainBaseOptions } from '../grain/capture';
import { PROBE_VERT, aerialProbeFragment, aerialTemplateCheck, checkPrefixPair, cutAtmospherePrefix, functionText, GET_IRRADIANCE_SIG, irrProbeFragment, staticCheck, tableProbeFragment, type AerialMode } from './gpuwin-irrshader';

type AnyRec = Record<string, unknown>;
type In = Omit<VolumetricSceneInput, 'date'> & { date: string };
const errors: string[] = [];
window.addEventListener('error', e => errors.push(String(e.message)));
const shaderErrors: string[] = [];
const Q = new URLSearchParams(location.search);
const W = Number(Q.get('w') ?? 400), H = Number(Q.get('h') ?? 300);
const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.style.margin = '0';
document.body.appendChild(canvas);
let ctxLost = false;
canvas.addEventListener('webglcontextlost', () => { ctxLost = true; errors.push('webglcontextlost'); });
const renderer = new WebGLRenderer({ canvas, antialias: false, depth: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.debug.checkShaderErrors = true;
renderer.debug.onShaderError = (gl, program, vs, fs) => { shaderErrors.push(`program: ${gl.getProgramInfoLog(program) ?? ''} | fragment: ${(gl.getShaderInfoLog(fs) ?? '').slice(0, 2000)} | vertex: ${(gl.getShaderInfoLog(vs) ?? '').slice(0, 500)}`); };
const brokenPrograms = (): string[] => ((renderer.info as unknown as { programs?: { name?: string; diagnostics?: { runnable: boolean; programLog: string } }[] }).programs ?? [])
  .filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => `${p.name ?? '?'}: ${p.diagnostics!.programLog.slice(0, 400)}`);

/** entry-gpuwin JOB_BASE_OPTIONS 와 같은 값(그 파일을 바꾸지 않으려고 옮겨 적음 — gpuwin-irrtest.js 가 두 글자를 대조). */
const JOB_BASE_OPTIONS: Partial<VolumetricOptions> = {
  genus: true, coverRemap: true, weatherLod: null, shadowMinSunDeg: 12, sunMarch: [6, 250, 1.6], accurateSunBelowDeg: null, maxRayKm: null,
  flow: false, flowDensity: true, flowUv: false, flowN: 64, flowSteps: 20, flowHours: 0.5, flowVrms: 2, flowPsiEvery: 2,
  flowQMode: 0, flowQN: 128, flowQH: 0.5, flowS90: 0, flowCamCell: true, physics: false, physicsIce: false, iceHalo: false, icePowderOff: false, debugLightFloors: null, diffuse: 0, skeleton: 0, skeletonTiltScale: 1, profileBase: null, macroGrad: false,
};
const FLAGS = { off: { clampInscatter: false, irradianceLogMu: false }, on: { clampInscatter: true, irradianceLogMu: true } };

(async () => {
  try {
    const t0 = performance.now();
    const vol = await createVolumetricScene(renderer, W, H, { genus: true, celestial: false, spectral: true, effectiveTransmittance: true });
    const win = window as unknown as AnyRec;
    win.__atmosMs = performance.now() - t0;
    win.__spectral = (vol as unknown as { spectral?: boolean }).spectral ?? null;
    const clouds = vol.debug.clouds as unknown as AnyRec & {
      frame: number; skyLightScale: number; groundBounceScale: number; cloudLayers: { altitude: number; height: number }[];
      cloudsPass: { currentMaterial: { fragmentShader: string; vertexShader: string; defines: Record<string, unknown>; uniforms: Record<string, IUniform> } };
    };
    const mat = () => clouds.cloudsPass.currentMaterial;
    const setup = (input: In, opts: AnyRec, quality: VolumetricQuality, res = 0.5) => {
      vol.setOptions({ ...grainBaseOptions(JOB_BASE_OPTIONS, false), ...opts } as Partial<VolumetricOptions>, false);
      clouds.skyLightScale = 1; clouds.groundBounceScale = 1;
      vol.setQuality(quality);
      vol.setResolutionScale(res);
      vol.setScene({ ...input, date: new Date(input.date) } as VolumetricSceneInput);
      vol.setTerrainDistance(null);
      clouds.frame = 0;
    };
    const quadScene = new Scene(), quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new Mesh(new PlaneGeometry(2, 2)); quad.frustumCulled = false; quadScene.add(quad);
    const floatRT = renderer.extensions.has('EXT_color_buffer_float');

    win.__irrProbe = async (p: AnyRec) => {
      const e0 = errors.length, s0 = shaderErrors.length, ts = performance.now();
      const sc = p.scene as { input: In; options: AnyRec };
      // ── 장면(앱 길: 두 고침 켬) — 2 프레임으로 구름 재질 균일변수를 이 장면 값으로 ──
      setup(sc.input, { ...sc.options, ...FLAGS.on }, 'low');
      for (let i = 0; i < 2; i++) vol.renderToTexture(1 / 60);
      const fragOn = mat().fragmentShader, vertOn = mat().vertexShader;
      vol.setOptions(FLAGS.off, false);   // 글자만(그리지 않음) — 끔 글자
      const fragOff = mat().fragmentShader, vertOff = mat().vertexShader;
      vol.setOptions(FLAGS.on, false);
      const preOff = cutAtmospherePrefix(fragOff), preOn = cutAtmospherePrefix(fragOn);
      const pair = checkPrefixPair(preOff, preOn);
      const fnOf = (s: string) => functionText(s, GET_IRRADIANCE_SIG);
      const textChecks = { ...pair, prefixBytes: [preOff.length, preOn.length], fragOnHasMark: fragOn.includes('§178 irradianceLogMu'),
        vertexGetIrradianceSameAsFragment: { off: fnOf(vertOff) === fnOf(preOff), on: fnOf(vertOn) === fnOf(preOn) }, getIrradianceOn: fnOf(preOn),
        // §180 검토: 산란 탐침의 손 옮김 몸통 = 구름 패스 applyAerialPerspective(끔 글자, 이름·그림자 길이·해 방향만 바꿈)
        aerialTemplate: aerialTemplateCheck(fragOff) };
      const m = mat();
      const defines = { ...m.defines } as Record<string, unknown>;
      const iw = Number(defines.IRRADIANCE_TEXTURE_WIDTH), ih = Number(defines.IRRADIANCE_TEXTURE_HEIGHT);
      const atmU = (m.uniforms.ATMOSPHERE.value as { bottom_radius: number; top_radius: number });
      const atm = { bottom: atmU.bottom_radius, top: atmU.top_radius, W: iw, H: ih };
      const itex = m.uniforms.irradiance_texture.value as Texture & { image?: { width?: number; height?: number } };
      const texInfo = { type: itex?.type, format: itex?.format, internalFormat: (itex as unknown as { internalFormat?: string | null })?.internalFormat ?? null, minFilter: itex?.minFilter, magFilter: itex?.magFilter,
        width: itex?.image?.width ?? null, height: itex?.image?.height ?? null, floatLinear: renderer.extensions.has('OES_texture_float_linear') };

      // ── 탐침 그리기·읽기 ──
      const sources: Record<string, string> = {};
      const mk = (name: string, frag: string, extra: Record<string, IUniform>, pack: boolean) => {
        const bad = staticCheck(frag); if (bad.length) throw new Error(`irrprobe ${name}: static check ${bad.join(', ')}`);
        sources[name] = frag;
        return new RawShaderMaterial({ name: 'irrprobe-' + name, glslVersion: GLSL3, defines: { ...defines, ...(pack ? { PROBE_PACK: '1' } : {}) },
          uniforms: { ...m.uniforms, ...extra, probeChan: { value: 0 } }, vertexShader: PROBE_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
      };
      const rts: WebGLRenderTarget[] = [];
      const draw = (name: string, frag: string, extra: Record<string, IUniform>, w: number, h: number, pack = !floatRT): Float32Array => {
        const se = shaderErrors.length;
        const mm = mk(name + (pack ? '-pack' : ''), frag, extra, pack);
        quad.material = mm;
        const out = new Float32Array(w * h * 4);
        if (!pack) {
          const rt = new WebGLRenderTarget(w, h, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }); rts.push(rt);
          renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam); renderer.setRenderTarget(null);
          renderer.readRenderTargetPixels(rt, 0, 0, w, h, out);
        } else {
          const rt = new WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }); rts.push(rt);
          const u8 = new Uint8Array(w * h * 4), dv = new DataView(new ArrayBuffer(4));
          for (let ch = 0; ch < 4; ch++) {
            mm.uniforms.probeChan.value = ch;
            renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam); renderer.setRenderTarget(null);
            renderer.readRenderTargetPixels(rt, 0, 0, w, h, u8);
            for (let k = 0; k < w * h; k++) { for (let b = 0; b < 4; b++) dv.setUint8(b, u8[k * 4 + b]); out[k * 4 + ch] = dv.getFloat32(0, true); }
          }
        }
        const ge = renderer.getContext().getError(); if (ge) errors.push(`irrprobe ${name}: GL error ${ge}`);
        if (shaderErrors.length > se) errors.push(`irrprobe ${name}: shader error`);
        mm.dispose();
        return out;
      };
      const toArr = (a: Float32Array) => Array.from(a);

      // 표
      const tFrag = tableProbeFragment(preOff);
      const table = draw('table', tFrag, {}, iw, ih);
      let packCheck: AnyRec | null = null;
      if (floatRT) {   // 읽기 길 점검: 같은 표를 비트 포장 길로 — 비트 같아야
        const t2 = draw('table', tFrag, {}, iw, ih, true);
        let diff = 0; for (let k = 0; k < table.length; k++) if (!Object.is(table[k], t2[k]) && !(Number.isNaN(table[k]) && Number.isNaN(t2[k]))) diff++;
        packCheck = { texelsDiffering: diff, n: table.length };
      }
      // 조도 격자
      const es = p.es as number[], mus = p.mus as number[], hs = p.heightsKm as number[];
      const N = es.length;
      const muData = new Float32Array(N * 4); for (let i = 0; i < N; i++) muData[i * 4] = mus[i];
      const muTex = new DataTexture(muData, N, 1, RGBAFormat, FloatType); muTex.minFilter = NearestFilter; muTex.magFilter = NearestFilter; muTex.needsUpdate = true;
      const hv = [0, 1, 2, 3].map(i => hs[i] ?? 0);
      const extraIrr: Record<string, IUniform> = { probeMu: { value: muTex }, probeH: { value: new Vector4(hv[0], hv[1], hv[2], hv[3]) } };
      const irrOld = draw('irr-old', irrProbeFragment(preOff), extraIrr, N, hs.length);
      const irrNew = draw('irr-new', irrProbeFragment(preOn), extraIrr, N, hs.length);

      // ── 산란 자르기(P1 덮개) ──
      const U = m.uniforms;
      const w2e = (U.worldToECEFMatrix.value as Matrix4).clone();
      const camW = (U.cameraPosition.value as Vector3).clone();
      const camE = camW.clone().applyMatrix4(w2e).add(U.altitudeCorrection.value as Vector3);
      const sunE = (U.sunDirection.value as Vector3).clone();
      const bottomM = Number((U.bottomRadius as IUniform | undefined)?.value ?? atm.bottom * 1000);
      const ag = p.aerial as { grid: [number, number]; deckKm: number };
      const layers = clouds.cloudLayers.map(l => [l.altitude, l.height]);
      // 덮개 층: 고도가 deckKm 에 가장 가까운 층(m)
      let deckAlt = ag.deckKm * 1000; { let best = Infinity; for (const [a, hgt] of layers) if (hgt > 0 && Math.abs(a - ag.deckKm * 1000) < best) { best = Math.abs(a - ag.deckKm * 1000); deckAlt = a; } }
      const Rdeck = bottomM + deckAlt;
      const [gw, gh] = ag.grid;
      const endData = new Float32Array(gw * gh * 4), el = new Float32Array(gw * gh), hit = new Uint8Array(gw * gh);
      const cam = vol.camera as PerspectiveCamera, vv = new Vector3(), dE = new Vector3();
      // §180 검토: unproject 는 matrixWorld 를 쓰므로 빼는 것도 세계 위치(부모가 있으면 cam.position 은 지역 좌표)
      cam.updateMatrixWorld(); const camPosW = new Vector3().setFromMatrixPosition(cam.matrixWorld);
      const upE = camE.clone().normalize(); let elDiff = 0;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        vv.set(((i + 0.5) / gw) * 2 - 1, ((j + 0.5) / gh) * 2 - 1, 0.5).unproject(cam).sub(camPosW).normalize();
        el[k] = (Math.asin(vv.y) * 180) / Math.PI;   // entry-gpuwin elevAt 과 같은 정의(장면 좌표 y = 위)
        dE.copy(vv).transformDirection(w2e);
        elDiff = Math.max(elDiff, Math.abs((Math.asin(Math.max(-1, Math.min(1, dE.dot(upE)))) * 180) / Math.PI - el[k]));   // ECEF 고도와 대조(장면 y = 위 가정 점검)
        // |camE + t dE| = Rdeck 의 양의 근(카메라는 덮개 아래)
        const b = camE.dot(dE), c = camE.lengthSq() - Rdeck * Rdeck, disc = b * b - c;
        if (disc < 0) continue;
        const t = -b + Math.sqrt(disc); if (!(t > 0)) continue;
        endData[k * 4] = camE.x + t * dE.x; endData[k * 4 + 1] = camE.y + t * dE.y; endData[k * 4 + 2] = camE.z + t * dE.z; endData[k * 4 + 3] = 1; hit[k] = 1;
      }
      const endTex = new DataTexture(endData, gw, gh, RGBAFormat, FloatType); endTex.minFilter = NearestFilter; endTex.magFilter = NearestFilter; endTex.needsUpdate = true;
      const extraA = { probeEnd: { value: endTex }, probeCam: { value: camE }, probeSun: { value: sunE } } as Record<string, IUniform>;
      const aer: Record<string, number[]> = {};
      for (const md of ['raw', 'off', 'on', 'sky'] as AerialMode[]) aer[md] = toArr(draw('aerial-' + md, aerialProbeFragment(preOn, md), extraA, gw, gh));
      muTex.dispose(); endTex.dispose(); for (const rt of rts) rt.dispose();

      const gl = renderer.getContext();
      return {
        result: {
          readback: floatRT ? 'float32' : 'rgba8-bits', packCheck, atm, texInfo, defines: { IRRADIANCE_TEXTURE_WIDTH: iw, IRRADIANCE_TEXTURE_HEIGHT: ih, METER_TO_LENGTH_UNIT: defines.METER_TO_LENGTH_UNIT },
          textChecks, sourceBytes: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, s.length])),
          scene: { sunAltDeg: vol.lastScene()?.sunAltDeg ?? null, camE: camE.toArray(), camHeightM: camE.length() - bottomM, sunE: sunE.toArray(), sunElevGeocentricDeg: (Math.asin(sunE.dot(camE.clone().normalize())) * 180) / Math.PI,
            bottomRadiusM: bottomM, deckAltM: deckAlt, layers, camWorldMinusUniformM: camPosW.distanceTo(camW), elevSceneVsEcefMaxDeg: elDiff },
          raw: { atm, heightsKm: hs, es, mus, table: toArr(table), irr: { old: toArr(irrOld), new: toArr(irrNew) },
            aerial: { gw, gh, el: Array.from(el), hit: Array.from(hit), ...aer } },
        },
        wallMs: performance.now() - ts, errors: errors.slice(e0), shaderErrors: shaderErrors.slice(s0), brokenPrograms: brokenPrograms(), glError: gl.getError(), ctxLost, canvas: [W, H],
      };
    };
  } catch (e) { errors.push('예외: ' + ((e as Error)?.stack ?? e)); }
  (window as unknown as AnyRec).__errors = errors;
  document.title = 'READY::' + (errors.length ? 'ERR' : 'OK');
})();
