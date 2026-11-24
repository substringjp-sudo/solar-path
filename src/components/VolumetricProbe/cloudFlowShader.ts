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
  'genusCarve', 'genusGrain', 'genusGrainDir', 'genusWisp',
  'genusDriftKmU', 'genusDriftKmV', 'genusFloor',
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
    + '\nuniform float genusUvOn;\nuniform float genusTexelM;\nuniform float genusMacroOn;\nuniform float genusLsAmt;\nuniform vec4 genusLife;   // xy = 이번 무늬 오프셋, zw = 다음 무늬 오프셋(타일)\nuniform float genusLifeW;\nuniform float genusSheetOn;');
  // 층별 찢긴 결 UV 오프셋 헬퍼 — 각 레인이 자기 바람 방향(genusGrainDir)과 활성 고도에서만 자기 UV 를 뒤틀게 합니다.
  const weatherDecl = 'WeatherSample sampleWeather(';
  if (!src.includes(weatherDecl)) throw new Error('cloudFlow: sampleWeather anchor missing');
  src = src.replace(weatherDecl, [
    // 2026-11-18 큰 무늬(비주기): 파장 55·89·144 km 사인 셋을 서로 다른 방향으로 — 24 km 타일 반복을 깹니다. 0..1.
    'float genusLsField(const vec2 pKm) {',
    '  float a = sin(dot(pKm, vec2(0.8090, 0.5878)) * (6.2831853 / 55.0) + 1.3);',
    '  float b = sin(dot(pKm, vec2(-0.3420, 0.9397)) * (6.2831853 / 89.0) + 4.1);',
    '  float c = sin(dot(pKm, vec2(0.9945, -0.1045)) * (6.2831853 / 144.0) + 2.7);',
    '  return 0.5 + 0.5 * (0.45 * a + 0.33 * b + 0.22 * c);',
    '}',
    // 2026-11-18 구름 생애: 이번 무늬(A)와 다음 무늬(B, 다른 자리에서 읽은 같은 타일)를 genusLifeW 로 섞음. 섞으면 분산이 줄어 문턱 위 면적(운량)이 줄므로
    //   평균 0.5 둘레로 분산을 되살림(1/√((1−w)²+w²)). w = 0 이면 A 그대로.
    ...GENUS_SHEET_B_GLSL,
    'vec4 genusLifeMix(const vec4 a, const vec4 b) {',
    '  if (genusLifeW <= 0.0) return a;',
    '  return genusSheetMix(a, b, vec4(genusLifeW));',
    '}',
    'vec2 flowWispWarp(const vec2 uv, const float dirRad, const float h, const float amt) {',
    '  if (amt <= 0.0) return vec2(0.0);',
    '  vec2 gPw = uv * genusTileM;',
    '  vec2 gWw = vec2(sin(dirRad), cos(dirRad));',
    '  vec2 gWn = vec2(-gWw.y, gWw.x);',
    '  float gA = dot(gPw, gWw), gC = dot(gPw, gWn);',
    // 고도(h)에 따라 서로 다른 위상으로 3차원 와류 비틀림이 걸려야 수직 기둥(쿠키커터 상자)이 깨지고 위아래가 비대칭으로 찢어집니다.
    '  float gB = clamp((texture(shapeTexture, vec3(gA * 0.22, h * 0.55 + 230.0, gC * 0.22) * shapeRepeat + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '  float gStr = clamp((texture(shapeTexture, vec3(gA / 4.5, h * 1.35, gC * 1.6 + gB * 480.0) * shapeRepeat * 2.6 + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '  float gJit = clamp((texture(shapeTexture, vec3(gA / 1.8, h * 2.75, gC * 3.4 - gB * 260.0) * shapeRepeat * 5.8 + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '  return (gWw * ((0.62 * gStr + 0.38 * gJit) * 680.0) + gWn * ((0.48 * gB + 0.52 * gJit) * 340.0)) * (amt / genusTileM);',
    '}',
    weatherDecl,
  ].join('\n'));
  // S2 mode 2 — 비대칭 쐐기·조각 단면: 두꺼운 중심부는 응결 밑면(gRamp)에 닿고, 가장자리·작은 조각구름(d < 0.6)은
  // 밑면도 위로 들리고 윗면도 완만하게 낮아져(pow 1.35) 수직 벽 상자 대신 날렵하게 찢어진 조각 단면이 됩니다.
  src = src.replace(oHs, [
    '  vec4 gCloudMask = smoothstep(vec4(0.0), vec4(1.5 / 255.0), localWeather);',
    '  localWeather = mix(localWeather, mix(genusFloor, vec4(1.0), localWeather), gCloudMask * genusFlow);',
    '  vec4 gCoreH = clamp(genusBase * 1.15, vec4(0.22), vec4(0.42));',
    '  vec4 gUp = clamp((gHf - gCoreH) / max(vec4(1.0) - gCoreH, vec4(1e-3)), 0.0, 1.0);',
    '  vec4 gDn = clamp((gCoreH - gHf) / max(gCoreH, vec4(1e-3)), 0.0, 1.0);',
    '  vec4 gWedge = vec4(1.0) - max(pow(max(gUp, vec4(1e-6)), vec4(1.35)), pow(max(gDn, vec4(1e-6)), vec4(1.65)) * vec4(0.62));',
    '  vec4 gDomeL = gRamp * clamp(gWedge, 0.0, 1.0);',
    '  vec4 gHs = mix(mix(gDome, gLens, clamp(genusMode, 0.0, 1.0)), gDomeL, clamp(genusMode - vec4(1.0), 0.0, 1.0));',
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
  // S4 층별 드리프트·기울임·결 warp fetch — 각 레인이 자기 방향(genusGrainDir)과 활성 고도에서만 자기 UV 를 밉니다(두 분기 뒤의 SHADOW 마스크 3행은 그대로).
  src = src.replace(gFetch, [
    '  vec2 gUv0 = uv * localWeatherRepeat + localWeatherOffset;',
    '  float gFoot0 = genusTexelM * exp2(mipLevel);',
    '  float gWispFade0 = 1.0 - smoothstep(3500.0, 15000.0, gFoot0);',
    '  vec4 gWW = genusWisp * genusFlow * gWispFade0 * step(minLayerHeights, vec4(height)) * step(vec4(height), maxLayerHeights);',
    '  vec2 gW0 = flowWispWarp(gUv0, genusGrainDir.x, height, gWW.x);',
    '  vec2 gW1 = flowWispWarp(gUv0, genusGrainDir.y, height, gWW.y);',
    '  vec2 gW2 = flowWispWarp(gUv0, genusGrainDir.z, height, gWW.z);',
    '  vec2 gW3 = flowWispWarp(gUv0, genusGrainDir.w, height, gWW.w);',
    '  vec4 localWeather;',
    '  if (genusUvOn > 0.5 || dot(gWW, vec4(1.0)) > 0.0) {',
    '    vec4 gHA = genusUvOn > 0.5 ? max(vec4(height) - minLayerHeights, vec4(0.0)) / genusTileM : vec4(0.0);',
    '    vec2 d0 = genusUvOn > 0.5 ? vec2(genusDriftU.x + genusTiltU.x * gHA.x, genusDriftV.x + genusTiltV.x * gHA.x) : vec2(0.0);',
    '    vec2 d1 = genusUvOn > 0.5 ? vec2(genusDriftU.y + genusTiltU.y * gHA.y, genusDriftV.y + genusTiltV.y * gHA.y) : vec2(0.0);',
    '    vec2 d2 = genusUvOn > 0.5 ? vec2(genusDriftU.z + genusTiltU.z * gHA.z, genusDriftV.z + genusTiltV.z * gHA.z) : vec2(0.0);',
    '    vec2 d3 = genusUvOn > 0.5 ? vec2(genusDriftU.w + genusTiltU.w * gHA.w, genusDriftV.w + genusTiltV.w * gHA.w) : vec2(0.0);',
    '    vec4 gT0 = textureLod(localWeatherTexture, gUv0 + gW0 + d0 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT1 = textureLod(localWeatherTexture, gUv0 + gW1 + d1 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT2 = textureLod(localWeatherTexture, gUv0 + gW2 + d2 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gT3 = textureLod(localWeatherTexture, gUv0 + gW3 + d3 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gU0 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gUv0 + gW0 + d0 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gT0;',
    '    vec4 gU1 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gUv0 + gW1 + d1 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gT1;',
    '    vec4 gU2 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gUv0 + gW2 + d2 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gT2;',
    '    vec4 gU3 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gUv0 + gW3 + d3 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gT3;',
    '    vec4 gLA = genusLifeMix(vec4(gT0.x, gT1.y, gT2.z, gT3.w), vec4(gU0.x, gU1.y, gU2.z, gU3.w));',
    // 2026-11-18 둘째 무늬판(B): 같은 타일을 37° 돌리고 1.618 배로 키워 읽고, 비주기 무게로 A 와 섞음 — 24 km 마다 같은 자리에 빈 곳이 서던 것.
    //   자리는 감싸지 않은 바람 이동(km)으로 — B 의 주기(38.8 km, 돌아감)는 A 와 맞지 않아 둘을 섞은 무늬는 반복하지 않습니다.
    '    vec4 gSw = vec4(0.0);',
    '    if (genusSheetOn > 0.5) {',
    '      float gInvT = 1000.0 / genusTileM;',
    '      vec2 gK0 = vec2(genusDriftKmU.x, genusDriftKmV.x), gK1 = vec2(genusDriftKmU.y, genusDriftKmV.y), gK2 = vec2(genusDriftKmU.z, genusDriftKmV.z), gK3 = vec2(genusDriftKmU.w, genusDriftKmV.w);',
    '      vec2 gB0 = genusSheetB(gUv0 + gW0 + gK0 * gInvT + vec2(genusTiltU.x, genusTiltV.x) * gHA.x);',
    '      vec2 gB1 = genusSheetB(gUv0 + gW1 + gK1 * gInvT + vec2(genusTiltU.y, genusTiltV.y) * gHA.y);',
    '      vec2 gB2 = genusSheetB(gUv0 + gW2 + gK2 * gInvT + vec2(genusTiltU.z, genusTiltV.z) * gHA.z);',
    '      vec2 gB3 = genusSheetB(gUv0 + gW3 + gK3 * gInvT + vec2(genusTiltU.w, genusTiltV.w) * gHA.w);',
    '      vec4 gV0 = textureLod(localWeatherTexture, gB0 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '      vec4 gV1 = textureLod(localWeatherTexture, gB1 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '      vec4 gV2 = textureLod(localWeatherTexture, gB2 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '      vec4 gV3 = textureLod(localWeatherTexture, gB3 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '      vec4 gX0 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gB0 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gV0;',
    '      vec4 gX1 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gB1 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gV1;',
    '      vec4 gX2 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gB2 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gV2;',
    '      vec4 gX3 = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gB3 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gV3;',
    '      vec4 gLB = genusLifeMix(vec4(gV0.x, gV1.y, gV2.z, gV3.w), vec4(gX0.x, gX1.y, gX2.z, gX3.w));',
    '      vec2 gPk0 = uv * (genusTileM * 0.001);',
    '      gSw = vec4(genusSheetW(gPk0 + gK0), genusSheetW(gPk0 + gK1), genusSheetW(gPk0 + gK2), genusSheetW(gPk0 + gK3));',
    '      gLA = genusSheetMix(gLA, gLB, gSw);',
    '    }',
    '    localWeather = pow(gLA, weatherExponents);',
    '  } else {',
    '    vec4 gA = textureLod(localWeatherTexture, gUv0 + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '    vec4 gB = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gUv0 + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gA;',
    '    vec4 gLA = genusLifeMix(gA, gB);',
    '    if (genusSheetOn > 0.5) {',
    '      vec2 gBs = genusSheetB(gUv0);',
    '      vec4 gC = textureLod(localWeatherTexture, gBs + genusLife.xy, mipLevel).LOCAL_WEATHER_CHANNELS;',
    '      vec4 gD = genusLifeW > 0.0 ? textureLod(localWeatherTexture, gBs + genusLife.zw, mipLevel).LOCAL_WEATHER_CHANNELS : gC;',
    '      gLA = genusSheetMix(gLA, genusLifeMix(gC, gD), vec4(genusSheetW(uv * (genusTileM * 0.001))));',
    '    }',
    '    localWeather = pow(gLA, weatherExponents);',
    '  }',
    // 2026-11-18 큰 무늬 변조: 곱셈 후 1.0 클램프를 하면 거시 문턱(gMS) 절단 전에 구름 상단이 1.0 평탄면(상자 천장)으로 포화되므로
    //   0 과 1 을 유지하면서 분포만 늘리고 줄이는 지수(감마) 변조를 씁니다.
    '  if (genusLsAmt > 0.0) {',
    '    vec2 gPk = uv * (genusTileM * 0.001);',
    '    vec4 gLs = vec4(genusLsField(gPk + vec2(genusDriftKmU.x, genusDriftKmV.x)), genusLsField(gPk + vec2(genusDriftKmU.y, genusDriftKmV.y)),',
    '                    genusLsField(gPk + vec2(genusDriftKmU.z, genusDriftKmV.z)), genusLsField(gPk + vec2(genusDriftKmU.w, genusDriftKmV.w)));',
    '    vec4 gLsExp = exp(-genusLsAmt * (vec4(1.0) - 0.65 * genusFloor) * 0.75 * (2.0 * gLs - 1.0));',
    '    localWeather = pow(clamp(localWeather, vec4(0.0), vec4(1.0)), gLsExp);',
    '  }',
    '  // §132 거시 상태장: 주변 좌표의 2D 운량 기울기로 구름을 변조. §135: 더하지 않고 **곱합니다** — 더하면 빈 하늘(0)에',
    '  // 구름이 생겨 하늘 위쪽을 얇은 막이 덮었습니다. 곱하면 이미 있는 구름만 옅어지거나(기울기 음의 쪽) 조금 짙어집니다(양의 쪽).',
    '  if (genusMacroOn > 0.5) {',
    '    vec2 gPosKm = uv * (genusTileM * 0.001);',
    '    vec4 gMacroDelta = (gPosKm.x * genusMacroGradX + gPosKm.y * genusMacroGradY) * 0.01;',
    '    localWeather = min(localWeather * clamp(vec4(1.0) + gMacroDelta, vec4(0.0), vec4(1.35)), vec4(1.0));',
    '  }',
  ].join('\n'));
  // S7 평균 보존 침식 + 발자국 페이드(mipLevel 은 sampleMedia 의 매개변수).
  src = src.replace(gShape, [
    '  float gFoot = genusTexelM * exp2(mipLevel);',
    // 찢긴 결 잡음은 늘인 능선이라 멀리서도 알갱이가 덜 생김 — wisp 만큼 침식 페이드를 3.5~14 km 로 늘려 지평선 쪽 구름도 상자가 아닌 찢어진 결로 유지합니다.
    '  vec4 gErodeAmt = genusErode * mix(vec4(1.0 - smoothstep(250.0, 1200.0, gFoot)), vec4(1.0 - smoothstep(3500.0, 14000.0, gFoot)), clamp(genusWisp, vec4(0.0), vec4(1.0)));',
    // 활성 층 밀도 가중으로 각 레인의 바람 방향·결 배율·높이 비율을 합성(.x 고정 버그 제거).
    '  vec4 gDw = density / max(density.x + density.y + density.z + density.w, 1e-6);',
    '  vec2 gDirV = gDw.x * vec2(sin(genusGrainDir.x), cos(genusGrainDir.x)) + gDw.y * vec2(sin(genusGrainDir.y), cos(genusGrainDir.y)) + gDw.z * vec2(sin(genusGrainDir.z), cos(genusGrainDir.z)) + gDw.w * vec2(sin(genusGrainDir.w), cos(genusGrainDir.w));',
    '  vec2 gWwActive = length(gDirV) > 1e-4 ? normalize(gDirV) : vec2(0.0, 1.0);',
    '  float gHfActive = dot(weather.heightFraction, gDw);',
    '  float gGrainActive = dot(genusGrain, gDw);',
    // 2026-11-13 찢긴 결(genusWisp): shapeTexture 는 평균 0.7906·표준편차 0.0785 에 몰려 있어 그대로 (2n−1) 을 쓰면 능선이 접히지 않고
    //   둥근 Worley 방울(포도송이)로 남음. 실측 평균 0.7906 중심으로 [−1, 1] 영점 정규화 뒤 두 주파수 도메인 휨과 다중 스케일 능선·결을 만듦.
    '  float gShapeZero = clamp(0.5 + (shape - 0.7906) / 0.314, 0.0, 1.0);',
    '  vec4 gShapeN = vec4(gShapeZero);',
    '  if (dot(genusWisp * gDw, genusFlow) > 0.0) {',
    '    vec2 gPw = uv * genusTileM;',
    '    float gA = dot(gPw, gWwActive), gC = dot(gPw, vec2(-gWwActive.y, gWwActive.x));',
    '    float gBend = clamp((texture(shapeTexture, vec3(gA * 0.22, gHfActive * 240.0 + 37.0, gC * 0.22) * shapeRepeat + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '    float gBendFine = clamp((texture(shapeTexture, vec3(gA * 0.65, gHfActive * 520.0 + 117.0, gC * 0.65) * shapeRepeat + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '    float gCw = gC + gBend * 620.0 + gBendFine * 260.0;',
    '    float gS1 = clamp((texture(shapeTexture, vec3(gA / 6.0, gHfActive * 420.0, gCw) * shapeRepeat * 2.8 + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '    float gS2 = clamp((texture(shapeTexture, vec3(gA / 2.6 + gC * 0.18, gHfActive * 780.0, gCw * 1.85) * shapeRepeat * 6.5 + shapeOffset).r - 0.7906) / 0.157, -1.0, 1.0);',
    '    float gRidge1 = pow(clamp(1.0 - abs(gS1), 0.0, 1.0), 1.45);',
    '    float gRidge2 = pow(clamp(1.0 - abs(gS2), 0.0, 1.0), 1.35);',
    '    float gRidge = clamp(0.58 * gRidge1 + 0.42 * gRidge2 + 0.22 * (0.5 + 0.5 * gS1) - 0.18, 0.0, 1.0);',
    '    gShapeN = mix(gShapeN, vec4(gRidge), clamp(genusWisp, vec4(0.0), vec4(1.0)));',
    '  }',
    '  vec4 gMul = density * clamp(vec4(1.0) + gErodeAmt * (2.0 * gShapeN - 1.0), vec4(0.0), vec4(2.0));',
    // 2026-11-13 구름 가장자리·상하단 찢기(genusCarve) + 바람결(genusGrain): 중원거리(12 km)까지 유효하게 유지하고,
    // 구름 외곽과 상하단 경계에서 날카로운 능선 난류가 내부까지 깊숙이 파고들어 상자 윤곽을 찢어진 조각구름(Fractus/Wisps)으로 분해합니다.
    '  vec4 gCarveAmt = genusCarve * (1.0 - smoothstep(2500.0, 12000.0, gFoot));',
    '  if (dot(gCarveAmt * gDw, genusFlow) > 0.0) {',
    '    vec2 gPm = uv * genusTileM;',
    '    float gAlong = dot(gPm, gWwActive) / max(1.0, gGrainActive), gAcross = dot(gPm, vec2(-gWwActive.y, gWwActive.x));',
    '    float gGrain = texture(shapeTexture, vec3(gAlong, gHfActive * 750.0, gAcross) * shapeRepeat * 3.8 + shapeOffset).r;',
    '    #ifdef SHAPE_DETAIL',
    '    float gFine = texture(shapeDetailTexture, vec3(gAlong, gHfActive * 750.0, gAcross) * shapeDetailRepeat * 0.65 + shapeDetailOffset).r;',
    '    #else',
    '    float gFine = texture(shapeTexture, vec3(gAlong, gHfActive * 750.0, gAcross) * shapeRepeat * 10.5 + shapeOffset).r;',
    '    #endif',
    '    float gGrain0 = clamp(0.5 + (gGrain - 0.7906) / 0.22, 0.0, 1.0);',
    '    float gFine0 = clamp(0.5 + (gFine - 0.7906) / 0.22, 0.0, 1.0);',
    '    float gFineRidge = pow(clamp(1.0 - abs(2.0 * gFine0 - 1.0), 0.0, 1.0), 1.3);',
    '    vec4 gN = mix(vec4(0.30 * gShapeZero + 0.40 * mix(gShapeZero, gGrain0, step(1.01, gGrainActive)) + 0.30 * gFineRidge), 0.65 * gShapeN + 0.35 * gFineRidge, clamp(genusWisp, vec4(0.0), vec4(1.0)));',
    '    float gVertEdge = smoothstep(0.18, 0.0, gHfActive) + smoothstep(0.55, 0.98, gHfActive) * 0.85;',
    '    vec4 gLo = gCarveAmt * (0.75 + 0.45 * gVertEdge) * pow(vec4(1.0) - gN, vec4(1.15));',
    '    gMul *= smoothstep(gLo * 0.38, gLo * 0.95 + vec4(1e-3), gMul);',
    '  }',
    '  density = mix(remapClamped(density, vec4(1.0 - shape) * shapeAmounts, vec4(1.0)), gMul, genusFlow);',
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
  mat.uniforms.genusLsAmt = { value: GENUS_LS_AMT };
  mat.uniforms.genusLife = { value: new Vector4() };
  mat.uniforms.genusLifeW = { value: 0 };
  mat.uniforms.genusSheetOn = { value: 1 };
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
/**
 * §139 K2 전단 기울기 — 흐름 S4 fetch 레인 재사용(새 셰이더 코드 없음). setFlowUniforms **다음**에: 뼈대(opts.skeleton.tilt = 꼭대기 밀림/두께, 동·북)가 있는
 * 층의 genusTiltU/V 를 채우고 genusUvOn 을 켭니다. uv 이동 = tilt × (높이/타일) 이므로 무차원 tilt 가 그대로 들어가고, 꼭대기가 전단 쪽(+ŝ)으로 기울게
 * 읽는 자리는 −ŝ 쪽(setFlowUniforms 와 같은 부호).
 */
export function setSkeletonTilt(mat: PatchableMaterial, layers: (GenusLayer | null)[], scale = 1): void {
  const tu = [0, 0, 0, 0], tv = [0, 0, 0, 0];
  let any = false;
  layers.forEach((L, i) => {
    const t = (L?.opts as { skeleton?: { tilt?: [number, number] } } | undefined)?.skeleton?.tilt;
    if (t && (t[0] !== 0 || t[1] !== 0)) { tu[i] = -t[0] * scale; tv[i] = -t[1] * scale; any = true; }
  });
  (mat.uniforms.genusTiltU.value as Vector4).set(tu[0], tu[1], tu[2], tu[3]);
  (mat.uniforms.genusTiltV.value as Vector4).set(tv[0], tv[1], tv[2], tv[3]);
  // 뼈대는 흐름과 함께 쓰지 않으므로 드리프트 0 — setGenusDrift 는 GENUS_FLOW 기본값(cu·sc flow 1)으로 흐름 옵션이 꺼져 있어도 lane 을 채웁니다
  // (genusUvOn 이 0 일 때는 읽히지 않아 무해했음). 이 함수는 setGenusDrift **뒤**에 부릅니다.
  (mat.uniforms.genusDriftU.value as Vector4).set(0, 0, 0, 0);
  (mat.uniforms.genusDriftV.value as Vector4).set(0, 0, 0, 0);
  if (any) mat.uniforms.genusUvOn.value = 1;
}

export function setFlowUniforms(mat: PatchableMaterial, layers: (GenusLayer | null)[], on: { density: boolean; uv: boolean; macroGrad?: boolean }, tileKm: number): void {
  const lane = (fn: (L: GenusLayer) => number) => [0, 1, 2, 3].map(i => (layers[i] && layerHasFlow(layers[i]) ? fn(layers[i] as GenusLayer) : 0));
  const set = (u: string, v: number[]) => (mat.uniforms[u].value as Vector4).set(v[0], v[1], v[2], v[3]);
  const dens = on.density ? 1 : 0;
  set('genusFlow', lane(() => dens));
  set('genusDensPow', lane(L => flowParam(L, 'densPow', 0.5)));
  set('genusErode', lane(L => flowParam(L, 'flowErode', 0.5)));
  set('genusCarve', lane(L => flowParam(L, 'flowCarve', 0)));
  set('genusGrain', lane(L => flowParam(L, 'flowGrain', 1)));
  set('genusWisp', lane(L => flowParam(L, 'flowWisp', 0)));
  set('genusFloor', lane(L => flowParam(L, 'flowFloor', 0)));
  set('genusGrainDir', lane(L => { const u = flowParam(L, 'windU', 0), v = flowParam(L, 'windV', 0); return u === 0 && v === 0 ? 0 : Math.atan2(u, v); }));
  set('genusTauRef', [4, 4, 4, 4]);
  // 거시 상태장 기울기 — §171 on.macroGrad 가 아니면 0(기본 끔; §156 거시 격자가 자리별로 대신함)
  const macroLane = (fn: (L: GenusLayer) => number) => [0, 1, 2, 3].map(i => (on.macroGrad && layers[i] ? fn(layers[i] as GenusLayer) : 0));
  set('genusMacroGradX', macroLane(L => flowParam(L, 'macroGradX', 0)));
  set('genusMacroGradY', macroLane(L => flowParam(L, 'macroGradY', 0)));
  mat.uniforms.genusMacroOn.value = on.macroGrad && layers.some(L => !!L && (flowParam(L, 'macroGradX', 0) !== 0 || flowParam(L, 'macroGradY', 0) !== 0)) ? 1 : 0;
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
 *
 * §155 **모든 층**에 겁니다(바람 opts 가 있는 층). 예전에는 흐름 모형 층(cu·sc, 그것도 흐름 uv 옵션이 켜졌을 때)만 움직여,
 * 흐름을 기본으로 끈 뒤(S0-1) 비늘구름(ac) 같은 층은 하늘에 붙박여 전혀 흐르지 않았습니다. 드리프트가 있으면 층별 fetch 를 켭니다.
 */
/** 구름 생애 주기(초) — 적운의 수명(15~30 분)보다 조금 길게. 이 간격마다 무늬를 읽는 자리를 새로 뽑아 이전 자리에서 서서히 넘어감. */
export const GENUS_LIFE_SEC = 2400;
const lifeHash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
/**
 * 2026-11-18 구름 생애 — 24 km 타일을 바람으로 밀기만 하면, 바람이 주기마다 타일 한 칸쯤 가는 날(나고야 저층 39 km/h × 38 분 ≈ 24 km)
 * 같은 구름이 같은 자리로 돌아와 멈춘 듯 보였음. 주기 n 마다 타일 안 읽는 자리(오프셋)를 해시로 뽑고, n → n+1 을 smoothstep 으로 섞음.
 * 시각(초)은 장면 시각 + 흐른 시간(드리프트 시계) — 시간 막대를 끌어도 이어짐.
 */
export function setGenusLife(mat: PatchableMaterial, absSec: number, layers?: (GenusLayer | null)[]): void {
  const u = mat.uniforms.genusLife?.value as Vector4 | undefined;
  if (!u) return;
  let lifeSec = GENUS_LIFE_SEC;
  if (layers) {
    for (const L of layers) {
      const fls = (L?.opts as { flowLifeSec?: number } | undefined)?.flowLifeSec;
      if (typeof fls === 'number' && Number.isFinite(fls) && fls >= 600) {
        lifeSec = fls;
        break;
      }
    }
  }
  const f = absSec / lifeSec, n = Math.floor(f), t = f - n;
  const w = t * t * (3 - 2 * t);
  u.set(lifeHash(n, 1), lifeHash(n, 2), lifeHash(n + 1, 1), lifeHash(n + 1, 2));
  mat.uniforms.genusLifeW.value = w;
}

/** 큰 무늬 세기(날씨 값 곱 1 ± 이 값). 0 이면 끔. */
export const GENUS_LS_AMT = 0.45;
/**
 * 2026-11-18 둘째 무늬판(B) — 24 km 타일만 깔면 구름 없는 자리가 24 km 마다 같은 곳에 서서, 줌아웃하면 빈 곳이 주기적으로 보였습니다(사용자 보고, 도코나메).
 * 같은 타일을 37° 돌리고 1.618 배로 키워(주기 38.8 km) 한 번 더 읽고, 파장 37·61 km 의 비주기 무게로 A 와 섞습니다. 두 주기가 맞지 않아 섞은 무늬는 반복하지 않습니다.
 * 섞으면 분산이 줄어 운량이 줄므로 생애 섞기와 같이 평균 0.5 둘레로 분산을 되살립니다. 먼 구름 경로(volumetricScene volEvalFarLayer)도 같은 함수를 씁니다.
 */
export const GENUS_SHEET_B_GLSL: string[] = [
  'vec2 genusSheetB(const vec2 uvT) { return mat2(0.7986355, 0.6018150, -0.6018150, 0.7986355) * uvT * 0.6180340 + vec2(0.3712, 0.7139); }',
  'float genusSheetW(const vec2 pKm) {',
  '  float a = sin(dot(pKm, vec2(0.2588, 0.9659)) * (6.2831853 / 37.0) + 0.7);',
  '  float b = sin(dot(pKm, vec2(0.9063, -0.4226)) * (6.2831853 / 61.0) + 2.2);',
  '  return smoothstep(-0.45, 0.45, 0.6 * a + 0.4 * b);',
  '}',
  'vec4 genusSheetMix(const vec4 a, const vec4 b, const vec4 w) {',
  '  vec4 m = mix(a, b, w);',
  '  vec4 s = max(sqrt((vec4(1.0) - w) * (vec4(1.0) - w) + w * w), vec4(1e-4));',
  '  vec4 dryMix = clamp(vec4(0.5) + (m - vec4(0.5)) / s, vec4(0.0), vec4(1.0));',
  '  vec4 ua = sqrt(max(a, vec4(0.0))), ub = sqrt(max(b, vec4(0.0)));',
  '  vec4 mu = mix(ua, ub, w);',
  '  vec4 al = min(w, vec4(1.0) - w), be = max(vec4(1.0) - al, vec4(1e-4));',
  '  vec4 denom = max(2.0 * al * be, vec4(1e-5));',
  '  vec4 fLo = (mu * mu) / denom;',
  '  vec4 fMid = (mu - 0.5 * al) / be;',
  '  vec4 fHi = vec4(1.0) - ((vec4(1.0) - mu) * (vec4(1.0) - mu)) / denom;',
  '  vec4 uCdf = mix(mix(fLo, fMid, step(al, mu)), fHi, step(be, mu));',
  '  vec4 uSat = mix(mu, clamp(uCdf, vec4(0.0), vec4(1.0)), step(vec4(1e-3), al));',
  '  vec4 satMix = max(uSat * uSat, min(a, b) * vec4(0.85));',
  '  vec4 bothSat = smoothstep(vec4(0.0), vec4(1.5 / 255.0), min(a, b));',
  '  return clamp(mix(dryMix, satMix, bothSat), vec4(0.0), vec4(1.0));',
  '}',
];

export function setGenusDrift(mat: PatchableMaterial, layers: (GenusLayer | null)[], seconds: number, tileKm: number, baseKm?: ([number, number] | null | undefined)[]): void {
  const s = seconds / 3600 / tileKm;
  // baseKm: 장면 시각까지 이미 밀려간 거리(동·북 km, 시간별 바람 적분 — liveScene). seconds 는 그 뒤 흐른 시간.
  const lane = (k: 'windU' | 'windV') => [0, 1, 2, 3].map(i => (layers[i] ? -flowParam(layers[i] as GenusLayer, k, 0) * s - (baseKm?.[i]?.[k === 'windU' ? 0 : 1] ?? 0) / tileKm : 0));
  const set = (u: string, v: number[]) => (mat.uniforms[u].value as Vector4).set(v[0], v[1], v[2], v[3]);
  // fp32 위상 보호: 타일 단위로 소수부만(정수 타일 이동은 주기 텍스처라 같음).
  const wrap = (v: number[]) => v.map(x => x - Math.floor(x));
  const du = lane('windU'), dv = lane('windV');
  set('genusDriftU', wrap(du));
  set('genusDriftV', wrap(dv));
  // 감싸지 않은 이동(km) — 큰 무늬(genusLsField)용. 같은 부호(무늬를 −U·t − 적분 이동만큼 읽음).
  set('genusDriftKmU', du.map(x => x * tileKm));
  set('genusDriftKmV', dv.map(x => x * tileKm));
  if (layers.some((L, i) => !!L && (flowParam(L, 'windU', 0) !== 0 || flowParam(L, 'windV', 0) !== 0) && Number.isFinite(du[i] + dv[i]))) {
    mat.uniforms.genusUvOn.value = 1;
  }
}
