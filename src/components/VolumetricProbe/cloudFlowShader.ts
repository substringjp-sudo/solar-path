/**
 * cloudFlowShader.ts — 흐름 구름 모형의 **셰이더 쪽**(문서 §130, 설계 §3). CPU 쪽 모형은 cloudFlow.ts.
 *
 * patchGenusShader(§124) **직후**에 구름 패스·그림자 패스 둘 다에 겁니다(둘 다 같은 clouds.glsl 을 품으므로 1차 행진·
 * 해 쪽 행진·층 그림자 지도가 자동으로 같은 밀도를 봅니다). 모든 변경은 `mix(이전, 새것, genusFlow)` 꼴이라 레인이 0 이면
 * 화소 단위로 이전과 같고, 층별 fetch(`genusUvOn`)가 0 이면 takram 의 단일 fetch 그대로입니다.
 *
 *  S2 mode 2 "LWP 돔": d 를 기둥 꼭대기 높이가 아니라 **정규화 응결량**으로 읽어 꼭대기 hf_top = d^(1/top)(top 2 → √d).
 *     단열 구름 LWP = ½Γh² 이므로 깊이 ∝ √LWP. 얇은 가장자리가 1~2km 폭으로 넓어져 "폭 ≈ 높이" 탑이 사라집니다.
 *  S3 연속 밀도: gDensity ×= d^densPow(0.5, 평균 액수 ∝ √LWP) — 밀도가 1/edge 폭의 계단이 아니라 d 에 연속.
 *     1/512 텍셀 절벽(step)도 smoothstep(0, 2/255) 으로.
 *  S4 층별 fetch(C3): 층마다 바람 드리프트·전단 기울임만큼 uv 를 밀어 읽습니다(채널 4개 = fetch 4번).
 *  S6 하늘빛 가림의 깊이를 "기둥 높이" 대신 **광학두께 대리값**(밀도 × 꼭대기까지 거리 × 소광 / τref)으로 — 두꺼운 핵이
 *     어두워지고 키만 큰 얇은 기둥은 밝게 남습니다.
 *  S7 모양 잡음 침식을 takram 의 이진 remap 대신 **평균 보존 곱**(1 + erode·(2·shape − 1))으로, 화소 발자국(150~600m)에서
 *     페이드 — 60~400m Worley 가 멀리서 1~3px 반점(알갱이)으로 깨지는 것을 막습니다. 잔모양(SHAPE_DETAIL)도 같은 꼴.
 *
 * 기준 문자열이 없으면(takram 판이 바뀜) throw — 조용히 틀리지 않게(§124 규칙).
 */
import { Vector4 } from 'three';
import type { GenusLayer } from './cloudGenus';
import { GENUS_FLOW, type FlowLayerParams } from './cloudFlow';

type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };

const FLOW_VEC_UNIFORMS = [
  'genusFlow', 'genusDensPow', 'genusDriftU', 'genusDriftV',
  'genusTiltU', 'genusTiltV', 'genusErode', 'genusTauRef',
  'genusMacroGradX', 'genusMacroGradY',
] as const;

/** 흐름 손잡이 — 층 opts 가 우선, 없으면 종류별 GENUS_FLOW, 그것도 없으면 기본값. */
export function flowParam<K extends keyof FlowLayerParams>(L: GenusLayer, k: K, fallback: number): number {
  const o = L.opts as Partial<FlowLayerParams> | undefined;
  const v = o?.[k] ?? GENUS_FLOW[L.genus]?.[k];
  return (v ?? fallback) as number;
}

/** 이 층이 흐름 모형으로 그려지는가(opts.flow > 0 또는 종류 기본값). */
export function layerHasFlow(L: GenusLayer | null): boolean {
  return !!L && flowParam(L, 'flow', 0) > 0;
}

export function patchFlowShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  // 앵커 — takram 0.7.6 원문(G-*) 과 patchGenusShader 가 만든 문장(O-*).
  const decl = 'uniform vec4 coverageFilterWidths;';
  const oHs = '  vec4 gHs = mix(gDome, gLens, step(vec4(0.5), genusMode));';
  const oDens = '  vec4 gDensity = clamp((localWeather - (vec4(1.0) - gHs)) * genusEdge, 0.0, 1.0);';
  const oStep = '  gDensity *= step(vec4(1.0 / 512.0), localWeather);';
  const oDepth = '  weather.depth = max(localWeather - (vec4(1.0) - gHs), vec4(0.0));';
  const gFetch = [
    '  vec4 localWeather = pow(',
    '    textureLod(',
    '      localWeatherTexture,',
    '      uv * localWeatherRepeat + localWeatherOffset,',
    '      mipLevel',
    '    ).LOCAL_WEATHER_CHANNELS,',
    '    weatherExponents',
    '  );',
  ].join('\n');
  const gShape = '  density = remapClamped(density, vec4(1.0 - shape) * shapeAmounts, vec4(1.0));';
  const gDetail = '    density = remapClamped(density * 2.0, vec4(modifier * 0.5), vec4(1.0));';
  for (const anchor of [decl, oHs, oDens, oStep, oDepth, gFetch, gShape, gDetail]) {
    if (!src.includes(anchor)) throw new Error('cloudFlow: shader anchor missing — ' + anchor.trim().slice(0, 48));
  }
  // S1 균일변수
  src = src.replace(decl, decl + '\n' + FLOW_VEC_UNIFORMS.map(u => 'uniform vec4 ' + u + ';').join('\n')
    + '\nuniform float genusUvOn;\nuniform float genusTexelM;\nuniform float genusMacroOn;');
  // S2 mode 2 — LWP 돔(꼭대기 = d^(1/top)). genusMode 0/1 은 이전과 같음.
  src = src.replace(oHs, [
    '  vec4 gBulgeL = sin(clamp(gHf, vec4(0.0), vec4(1.0)) * 3.141592);',
    '  vec4 gDomeL = gRamp * ((vec4(1.0) - pow(max(gHf, vec4(1e-6)), genusTop)) * 0.45 + pow(max(gBulgeL, vec4(1e-6)), genusTop * 0.7) * 0.55);',
    '  vec4 gHs = mix(mix(gDome, gLens, step(vec4(0.5), genusMode)), gDomeL, step(vec4(1.5), genusMode));',
  ].join('\n'));
  // S3 연속 밀도
  src = src.replace(oDens, oDens.replace(';', '')
    + '\n                * mix(vec4(1.0), pow(max(localWeather, vec4(1e-4)), genusDensPow), genusFlow);');
  src = src.replace(oStep, '  gDensity *= mix(step(vec4(1.0 / 512.0), localWeather), smoothstep(vec4(0.0), vec4(2.0 / 255.0), localWeather), genusFlow);');
  // S6 광학두께 대리 깊이(하늘빛 가림용)
  src = src.replace(oDepth, [
    '  vec4 gHfTop = pow(max(localWeather, vec4(1e-4)), vec4(1.0) / max(genusTop, vec4(1e-3)));',
    '  vec4 gDepthTau = gDensity * max(gHfTop - gHf, vec4(0.0)) * (maxLayerHeights - minLayerHeights) * densityScales / max(genusTauRef, vec4(1e-3));',
    '  weather.depth = mix(max(localWeather - (vec4(1.0) - gHs), vec4(0.0)), gDepthTau, genusFlow);',
  ].join('\n'));
  // S4 층별 드리프트·기울임 fetch — 선언은 분기 앞에(두 분기 뒤의 SHADOW 마스크 3행은 그대로).
  src = src.replace(gFetch, [
    '  vec2 gUv0 = uv * localWeatherRepeat + localWeatherOffset;',
    '  vec4 localWeather;',
    '  if (genusUvOn > 0.5) {',
    '    vec4 gHA = max(vec4(height) - minLayerHeights, vec4(0.0)) / genusTileM;',
    '    vec4 gT0 = textureLod(localWeatherTexture, gUv0 + vec2(genusDriftU.x + genusTiltU.x * gHA.x, genusDriftV.x + genusTiltV.x * gHA.x), mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT1 = textureLod(localWeatherTexture, gUv0 + vec2(genusDriftU.y + genusTiltU.y * gHA.y, genusDriftV.y + genusTiltV.y * gHA.y), mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT2 = textureLod(localWeatherTexture, gUv0 + vec2(genusDriftU.z + genusTiltU.z * gHA.z, genusDriftV.z + genusTiltV.z * gHA.z), mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT3 = textureLod(localWeatherTexture, gUv0 + vec2(genusDriftU.w + genusTiltU.w * gHA.w, genusDriftV.w + genusTiltV.w * gHA.w), mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    localWeather = pow(vec4(gT0.x, gT1.y, gT2.z, gT3.w), weatherExponents);',
    '  } else {',
    '    localWeather = pow(textureLod(localWeatherTexture, gUv0, mipLevel).LOCAL_WEATHER_CHANNELS, weatherExponents);',
    '  }',
    '  // §132 거시 상태장: 주변 10여개 좌표의 2D 공간 기울기에 따라 운량을 점진적으로 변조',
    '  if (genusMacroOn > 0.5) {',
    '    vec2 gPosKm = uv * (genusTileM * 0.001);',
    '    vec4 gMacroDelta = (gPosKm.x * genusMacroGradX + gPosKm.y * genusMacroGradY) * 0.01;',
    '    localWeather = clamp(localWeather + gMacroDelta, vec4(0.0), vec4(1.0));',
    '  }',
  ].join('\n'));
  // S7 평균 보존 침식 + 발자국 페이드(mipLevel 은 sampleMedia 의 매개변수).
  src = src.replace(gShape, [
    '  float gFoot = genusTexelM * exp2(mipLevel);',
    '  vec4 gErodeAmt = genusErode * (1.0 - smoothstep(150.0, 600.0, gFoot));',
    '  density = mix(remapClamped(density, vec4(1.0 - shape) * shapeAmounts, vec4(1.0)),',
    '                density * clamp(vec4(1.0) + gErodeAmt * (2.0 * shape - 1.0), vec4(0.0), vec4(2.0)),',
    '                genusFlow);',
  ].join('\n'));
  src = src.replace(gDetail, [
    '    density = mix(remapClamped(density * 2.0, vec4(modifier * 0.5), vec4(1.0)),',
    '                  density * clamp(vec4(1.0) + 0.5 * gErodeAmt * (2.0 * detail - 1.0), vec4(0.0), vec4(2.0)),',
    '                  genusFlow);',
  ].join('\n'));
  mat.fragmentShader = src;
  for (const u of FLOW_VEC_UNIFORMS) mat.uniforms[u] = { value: new Vector4() };
  mat.uniforms.genusTauRef = { value: new Vector4(4, 4, 4, 4) };
  mat.uniforms.genusUvOn = { value: 0 };
  mat.uniforms.genusTexelM = { value: 24000 / 512 };
  mat.uniforms.genusMacroOn = { value: 0 };
  mat.needsUpdate = true;
}

/** 전단 단위벡터(동, 북) — shearU/V 는 km/h. 없으면 0. */
function shearUnit(L: GenusLayer): [number, number] {
  const su = flowParam(L, 'shearU', 0), sv = flowParam(L, 'shearV', 0);
  const m = Math.hypot(su, sv);
  return m > 1e-6 ? [su / m, sv / m] : [0, 0];
}

/**
 * 흐름 레인 — `density`(C2: 연속 밀도·LWP 돔·침식·AO 대리값) 와 `uv`(C3: 층별 드리프트·기울임) 를 따로 켭니다.
 * density 가 켜진 층은 genusMode/genusTop/genusEdge 레인도 흐름값(flowMode/flowTop/flowEdge)으로 덮어씁니다 —
 * setGenusUniforms **다음**에 부르세요.
 */
export function setFlowUniforms(mat: PatchableMaterial, layers: (GenusLayer | null)[], on: { density: boolean; uv: boolean }, tileKm: number): void {
  const lane = (fn: (L: GenusLayer) => number) => [0, 1, 2, 3].map(i => (layers[i] && layerHasFlow(layers[i]) ? fn(layers[i] as GenusLayer) : 0));
  const set = (u: string, v: number[]) => (mat.uniforms[u].value as Vector4).set(v[0], v[1], v[2], v[3]);
  const dens = on.density ? 1 : 0;
  set('genusFlow', lane(() => dens));
  set('genusDensPow', lane(L => flowParam(L, 'densPow', 0.5)));
  set('genusErode', lane(L => flowParam(L, 'flowErode', 0.5)));
  set('genusTauRef', [4, 4, 4, 4]);
  // 거시 상태장 기울기
  const macroLane = (fn: (L: GenusLayer) => number) => [0, 1, 2, 3].map(i => (layers[i] ? fn(layers[i] as GenusLayer) : 0));
  set('genusMacroGradX', macroLane(L => flowParam(L, 'macroGradX', 0)));
  set('genusMacroGradY', macroLane(L => flowParam(L, 'macroGradY', 0)));
  mat.uniforms.genusMacroOn.value = layers.some(L => !!L && (flowParam(L, 'macroGradX', 0) !== 0 || flowParam(L, 'macroGradY', 0) !== 0)) ? 1 : 0;
  // 기울임: 높이 1 타일당 uv 이동(타일 단위). 꼭대기가 전단 쪽(+ŝ)으로 기울게 읽는 자리는 −ŝ 쪽.
  const tilt = (L: GenusLayer, c: 0 | 1) => (on.uv ? -flowParam(L, 'flowTilt', 0) * shearUnit(L)[c] : 0);
  set('genusTiltU', lane(L => tilt(L, 0)));
  set('genusTiltV', lane(L => tilt(L, 1)));
  mat.uniforms.genusUvOn.value = on.uv && layers.some(layerHasFlow) ? 1 : 0;
  mat.uniforms.genusTexelM.value = (tileKm * 1000) / 512;
  if (dens) {
    const over = (u: string, k: 'flowMode' | 'flowTop' | 'flowEdge') => {
      const cur = mat.uniforms[u].value as Vector4;
      const v = [cur.x, cur.y, cur.z, cur.w];
      for (let i = 0; i < 4; i++) {
        const L = layers[i];
        if (!L || !layerHasFlow(L)) continue;
        const o = (L.opts as Partial<FlowLayerParams> | undefined)?.[k] ?? GENUS_FLOW[L.genus]?.[k];
        if (o != null) v[i] = o;
      }
      cur.set(v[0], v[1], v[2], v[3]);
    };
    over('genusMode', 'flowMode'); over('genusTop', 'flowTop'); over('genusEdge', 'flowEdge');
  }
}

/**
 * 층별 바람 드리프트(C3) — 장면 생성 시각부터 seconds 만큼 지난 자리의 날씨를 읽습니다. windU/V 는 부는 방향(km/h, 동·북).
 * 구름은 바람과 함께 가므로 지금 x 에 있는 구름은 t=0 에 x − U·t 에 있던 것 → uv 를 −U·t/타일 만큼 밉니다.
 * 두 재질(구름·그림자 패스) 모두에 매 프레임 부르세요 — 빠뜨리면 해 > 12° 의 층 그림자가 구름에서 떨어집니다.
 */
export function setGenusDrift(mat: PatchableMaterial, layers: (GenusLayer | null)[], seconds: number, tileKm: number): void {
  const s = seconds / 3600 / tileKm;
  const lane = (k: 'windU' | 'windV') => [0, 1, 2, 3].map(i => (layers[i] && layerHasFlow(layers[i]) ? -flowParam(layers[i] as GenusLayer, k, 0) * s : 0));
  const set = (u: string, v: number[]) => (mat.uniforms[u].value as Vector4).set(v[0], v[1], v[2], v[3]);
  // fp32 위상 보호: 타일 단위로 소수부만(정수 타일 이동은 주기 텍스처라 같음).
  const wrap = (v: number[]) => v.map(x => x - Math.floor(x));
  set('genusDriftU', wrap(lane('windU')));
  set('genusDriftV', wrap(lane('windV')));
}
