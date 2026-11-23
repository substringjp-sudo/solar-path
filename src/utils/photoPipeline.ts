/**
 * photoPipeline.ts — Skia GPU(SkSL RuntimeEffect) + 멀티프레임 촬영 실행 파이프라인.
 *
 * `photoAlgorithms/*` 순수 엔진이 산출한 3×3 호모그래피, 3×3 색 보정 행렬, 1D 톤 LUT,
 * 2D 공간 그리드(GND · CPL · Koschmieder 연무 · 광해 노치 · CoC · 능선 층)를 받아
 * 실제 사진 비트맵에 GPU 가속으로 적용하고, 멀티프레임(3단 브라켓 · ND1000 구름 결 · 럭키 Drizzle · 시간차 합성)을 실행합니다.
 */
import {
  Skia,
  AlphaType,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  TileMode,
  rect,
  type SkImage,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';
import {
  dirFromAzEl,
  project,
  type Attitude,
  type GroundElevation,
  type HorizonProfile,
  type Intrinsics,
} from './arVision';
import {
  bakeContourGndGrid,
  buildSunsetToneLut,
  computeCloudFlowKernel,
  computeContourGndCurve,
  computeGroundStabilizationHomography,
  computeKoschmiederDehazeMap,
  computeLightPollutionNotchGrid,
  computeMonochromeFilterWeights,
  computeRayleighCplGrid,
  computeRidgeLayerBands,
  computeScheimpflugCocGrid,
  computeSunstarAndFlareParams,
  computeSunsetWbCorrection,
  computeTerrainDepthGrid,
  computeVerticalShiftHomography,
  computeVirtualDollyWarpGrid,
  computeZoneSystemHistogram,
  estimateSubpixelShift,
  hasActiveOpticalGear,
  predictBacklightGhosts,
  scoreFrameSharpness,
  selectLuckyFrames,
  type CameraGearBagState,
  type WindLayerInput,
  type ZoneHistogramResult,
} from './photoAlgorithms';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const GRID_W = 48;
const GRID_H = 36;
const MAX_WORK_EDGE = 2048;

export interface PhotoProcessContext {
  gear: CameraGearBagState;
  attitude: Attitude;
  intrinsics: Intrinsics;
  horizon?: HorizonProfile | null;
  elev?: GroundElevation | null;
  eyeElevM?: number;
  sunAzDeg: number;
  sunAltDeg: number;
  aod?: number;
  humidityPct?: number;
  cloudCover01?: number;
  bortleClass?: number;
  windLayers?: readonly WindLayerInput[];
}

export interface PhotoProcessResult {
  uri: string;
  zoneHistogram: ZoneHistogramResult | null;
  recommendedCloudSec: number | null;
  appliedTags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Skia 헬퍼 & SkSL 셰이더 캐시
// ─────────────────────────────────────────────────────────────────────────────

function makeOpaqueRgbaImage(rgba: Uint8Array, width: number, height: number): SkImage | null {
  const data = Skia.Data.fromBytes(rgba);
  return Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
    data,
    width * 4,
  );
}

function imgShader(img: SkImage) {
  return img.makeShaderOptions(
    TileMode.Clamp,
    TileMode.Clamp,
    FilterMode.Linear,
    MipmapMode.None,
  );
}

async function loadSkImageFromUri(uri: string): Promise<SkImage | null> {
  try {
    const data = uri.startsWith('data:')
      ? Skia.Data.fromBase64(uri.split(';base64,')[1] ?? '')
      : await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}

async function saveSkImageToTempJpeg(img: SkImage, quality = 92, tag = 'opt'): Promise<string> {
  const base64 = img.encodeToBase64(ImageFormat.JPEG, quality);
  const dir = FileSystem.cacheDirectory ?? '';
  if (!dir) return `data:image/jpeg;base64,${base64}`;
  const outPath = `${dir}photo_${tag}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
  await FileSystem.writeAsStringAsync(outPath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return outPath;
}

// 1) 기하 워핑 셰이더: 건축 수직 시프트 호모그래피 + 가상 돌리 줌 원근 압축
const GEOM_SKSL = `
uniform shader uImage;
uniform shader uGeom;
uniform float2 uRes;
uniform float2 uGrid;
uniform float3 uShiftR0;
uniform float3 uShiftR1;
uniform float3 uShiftR2;
uniform float4 uCropBox;
uniform float uUseShift;
uniform float uUseDolly;

half4 main(float2 coord) {
  float2 uv = coord / uRes;
  if (uUseShift > 0.5) {
    float2 cu = mix(uCropBox.xy, uCropBox.zw, uv);
    float3 dst = float3(cu.x, cu.y, 1.0);
    float w = max(0.0001, dot(uShiftR2, dst));
    uv = float2(dot(uShiftR0, dst) / w, dot(uShiftR1, dst) / w);
  }
  if (uUseDolly > 0.5) {
    half4 g = uGeom.eval(uv * uGrid);
    float2 duv = (float2(g.r, g.g) - 0.5) * 0.8;
    uv += duv;
  }
  uv = clamp(uv, float2(0.0), float2(1.0));
  return uImage.eval(uv * uRes);
}
`;

// 2) 공간 광학 pass: 3D 샤임플러그 가변 보케 + ND1000 구름 방향성 적분 + 고스트 클린 + 선스타/아나모픽/Pro-Mist
const SPATIAL_SKSL = `
uniform shader uImage;
uniform shader uMaskA;
uniform shader uGeom;
uniform float2 uRes;
uniform float2 uGrid;
uniform float uBokehOn;
uniform float uCloudOn;
uniform float2 uCloudFlowUv;
uniform float uFlareOn;
uniform float2 uSunUv;
uniform float uSunstarInt;
uniform float uSunstarRays;
uniform float uSunstarLen;
uniform float uAnaInt;
uniform float uAnaHalfW;
uniform float uProMistStr;
uniform float uProMistRad;
uniform float uGhostOn;
uniform float4 uGhost0;
uniform float4 uGhost1;
uniform float4 uGhost2;

half4 main(float2 coord) {
  float2 uv = coord / uRes;
  half4 base = uImage.eval(coord);
  float3 rgb = float3(base.rgb);

  half4 mA = uMaskA.eval(uv * uGrid);
  half4 g = uGeom.eval(uv * uGrid);
  float skyFlag = g.a; // 1 = sky, 0 = ground

  // ND1000 구름 방향성 장노출 적분 (지형은 100% 고정, 하늘 구름만 바람 벡터 방향 적분)
  if (uCloudOn > 0.5 && skyFlag > 0.2) {
    float3 acc = float3(0.0);
    float wSum = 0.0;
    for (int i = -6; i <= 6; i++) {
      float s = float(i) / 12.0;
      float w = exp(-(s * s) / 0.1764);
      float2 suv = clamp(uv + uCloudFlowUv * s, float2(0.0), float2(1.0));
      half4 sg = uGeom.eval(suv * uGrid);
      float maskW = w * smoothstep(0.15, 0.75, sg.a);
      acc += float3(uImage.eval(suv * uRes).rgb) * maskW;
      wSum += maskW;
    }
    if (wSum > 0.05) {
      float3 flowed = acc / wSum;
      rgb = mix(rgb, flowed, smoothstep(0.2, 0.85, skyFlag));
    }
  }

  // 3D 샤임플러그 기울어진 초점 평면 착란원(CoC) 가변 보케
  if (uBokehOn > 0.5) {
    float coc = abs(g.b - 0.5) * 0.08; // 정규화 폭 비율 (최대 ~0.04)
    if (coc > 0.0012) {
      float3 bAcc = rgb;
      float bW = 1.0;
      for (int k = 0; k < 8; k++) {
        float ang = float(k) * 0.78539816;
        float2 off = float2(cos(ang), sin(ang) * (uRes.x / max(1.0, uRes.y))) * coc;
        float2 buv = clamp(uv + off, float2(0.0), float2(1.0));
        bAcc += float3(uImage.eval(buv * uRes).rgb);
        bW += 1.0;
      }
      rgb = mix(rgb, bAcc / bW, smoothstep(0.0012, 0.0045, coc));
    }
  }

  // Black Pro-Mist 할레이션/하이라이트 글로우
  if (uProMistStr > 0.01) {
    float3 glow = float3(0.0);
    float gW = 0.0;
    float r = uProMistRad;
    for (int k = 0; k < 8; k++) {
      float ang = float(k) * 0.78539816;
      float2 off = float2(cos(ang), sin(ang) * (uRes.x / max(1.0, uRes.y))) * r;
      float3 s = float3(uImage.eval(clamp(uv + off, float2(0.0), float2(1.0)) * uRes).rgb);
      float lum = dot(s, float3(0.2126, 0.7152, 0.0722));
      float hi = smoothstep(0.62, 0.98, lum);
      glow += s * hi;
      gW += 1.0;
    }
    rgb += (glow / max(1.0, gW)) * (uProMistStr * 0.55);
  }

  // 역광 렌즈 고스트 억제 (광축 점대칭 반사 색상 편향·베일링 헤이즈 완화)
  if (uGhostOn > 0.5) {
    float gMask = 0.0;
    for (int gi = 0; gi < 3; gi++) {
      float4 gp = gi == 0 ? uGhost0 : (gi == 1 ? uGhost1 : uGhost2);
      if (gp.w > 0.01) {
        float d = length((uv - gp.xy) * float2(1.0, uRes.y / max(1.0, uRes.x)));
        gMask = max(gMask, smoothstep(gp.z * 1.4, gp.z * 0.15, d) * gp.w);
      }
    }
    if (gMask > 0.01) {
      float gLum = dot(rgb, float3(0.2126, 0.7152, 0.0722));
      float chromaDev = length(rgb - float3(gLum));
      float greenCyan = clamp((rgb.g + rgb.b) * 0.5 - rgb.r, 0.0, 1.0);
      float damp = gMask * smoothstep(0.03, 0.25, chromaDev + greenCyan);
      rgb = mix(rgb, float3(gLum * 0.90), damp * 0.65);
    }
  }

  // 아나모픽 수평 플레어 & 3D 차폐 선스타
  if (uFlareOn > 0.5) {
    float aspect = uRes.y / max(1.0, uRes.x);
    float2 dSun = uv - uSunUv;
    float2 dIso = float2(dSun.x, dSun.y * aspect);
    float dist = max(1e-4, length(dIso));

    // 아나모픽 수평 청백색 플레어 스트릭
    if (uAnaInt > 0.01) {
      float streakX = exp(-abs(dSun.x) / max(0.04, uAnaHalfW * 0.45));
      float streakY = exp(-pow(dIso.y / 0.012, 2.0));
      rgb += float3(0.58, 0.80, 1.0) * (streakX * streakY * uAnaInt * 0.65);
    }

    // 조리개 날 회절 선스타
    if (uSunstarInt > 0.01) {
      float theta = atan(dIso.y, dIso.x);
      float rays = pow(max(1e-4, cos(theta * uSunstarRays * 0.5)), 24.0);
      float radial = exp(-dist / max(0.03, uSunstarLen * 0.45)) * smoothstep(0.004, 0.02, dist);
      rgb += float3(1.0, 0.94, 0.82) * (rays * radial * uSunstarInt * 0.85);
    }
  }

  return half4(clamp(rgb, float3(0.0), float3(1.0)), 1.0);
}
`;

// 3) 대기 · 색감 · 스펙트럼 필터 pass (선형 RGB 기반 물리 처리)
const COLOR_SKSL = `
uniform shader uImage;
uniform shader uMaskA;
uniform shader uMaskB;
uniform shader uLut;
uniform float2 uRes;
uniform float2 uGrid;
uniform float3 uWbR0;
uniform float3 uWbR1;
uniform float3 uWbR2;
uniform float uWbOn;
uniform float uLutMix;
uniform float uGndOn;
uniform float uCplOn;
uniform float uCplStr;
uniform float uDehazeStr;
uniform float uRidgeStr;
uniform float uLpOn;
uniform float3 uSodiumRgb;
uniform float uMonoOn;
uniform float3 uMonoWeights;
uniform float uMonoSkyDark;
uniform float uMonoRelief;

float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float toSrgb(float c) {
  float x = clamp(c, 0.0, 1.0);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

half4 main(float2 coord) {
  float2 uv = coord / uRes;
  half4 px = uImage.eval(coord);
  half4 mA = uMaskA.eval(uv * uGrid);
  half4 mB = uMaskB.eval(uv * uGrid);

  float3 lin = float3(toLinear(px.r), toLinear(px.g), toLinear(px.b));

  // 1. 노을 물리 WB 역보정 행렬
  if (uWbOn > 0.5) {
    lin = max(float3(0.0), float3(dot(uWbR0, lin), dot(uWbR1, lin), dot(uWbR2, lin)));
  }

  // 2. 능선 밀착 Reverse/Standard GND 감광
  if (uGndOn > 0.5) {
    lin *= mA.r;
  }

  // 3. 90도 물리 레일리 편광(CPL) 하늘 감광 + 채도 강화
  if (uCplOn > 0.5) {
    float cplGain = mA.g;
    float polBoost = clamp((1.0 - cplGain) * (1.2 + uCplStr), 0.0, 0.45);
    float y = dot(lin, float3(0.2126, 0.7152, 0.0722));
    lin = max(float3(0.0), mix(float3(y), lin, 1.0 + polBoost)) * cplGain;
  }

  // 4. 도심 광해 노치 필터 (저고도 황색 나트륨등 성분만 선택 감산)
  if (uLpOn > 0.5) {
    float lpW = mB.r;
    if (lpW > 0.01) {
      float sodiumAmt = min(lin.r, lin.g * 1.15);
      lin = max(float3(0.0), lin - uSodiumRgb * (sodiumAmt * lpW * 0.52));
      lin.b += sodiumAmt * lpW * 0.04;
    }
  }

  // 5. Koschmieder 거리별 대기 연무 제어(Dehaze / 산수화) + 능선 층 분리
  if (abs(uDehazeStr) > 0.02 || uRidgeStr > 0.02) {
    float tPhys = max(0.18, mA.b);
    float3 airlight = float3(0.45, 0.50, 0.58);
    if (uDehazeStr > 0.02 && tPhys < 0.995) {
      lin = max(float3(0.0), (lin - airlight * (1.0 - tPhys)) / tPhys);
    } else if (uDehazeStr < -0.02 && tPhys < 0.995) {
      lin = mix(airlight * 0.92, lin, tPhys);
    }
    // 겹친 산 능선 층 대비 및 능선 엣지 강조
    if (uRidgeStr > 0.02 && mB.b > 0.01) {
      float bandT = mB.b;
      float edge = mB.g;
      float bandGain = 1.0 + (0.5 - bandT) * uRidgeStr * 0.24 + edge * uRidgeStr * 0.22;
      lin *= bandGain;
    }
  }

  float3 srgb = float3(toSrgb(lin.r), toSrgb(lin.g), toSrgb(lin.b));

  // 6. 노을 필름 톤 LUT (하이라이트 롤오프 + 실루엣 대비 보존)
  if (uLutMix > 0.01) {
    float3 mapped = float3(
      uLut.eval(float2(clamp(srgb.r, 0.0, 1.0) * 255.0 + 0.5, 0.5)).r,
      uLut.eval(float2(clamp(srgb.g, 0.0, 1.0) * 255.0 + 0.5, 0.5)).g,
      uLut.eval(float2(clamp(srgb.b, 0.0, 1.0) * 255.0 + 0.5, 0.5)).b
    );
    srgb = mix(srgb, mapped, uLutMix);
  }

  // 7. 안셀 아담스 Zone 모노크롬 (Red 25A / Orange 21 / Yellow 8 / DeepSky)
  if (uMonoOn > 0.5) {
    float3 mLin = float3(toLinear(srgb.r), toLinear(srgb.g), toLinear(srgb.b));
    float mono = clamp(dot(mLin, uMonoWeights), 0.0, 1.2);
    // 하늘 영역(gndGain < 0.95 또는 lpWeight > 0) 단파장 차단 감광 반영
    float skyness = mB.b < 0.05 ? 1.0 : 0.0;
    float skyGain = pow(2.0, -uMonoSkyDark * skyness * 0.55);
    mono = clamp(mono * skyGain, 0.0, 1.0);
    // 양지/음지 톤 S-커브 마이크로 콘트라스트
    float g = toSrgb(mono);
    g = clamp((g - 0.5) * uMonoRelief + 0.5, 0.0, 1.0);
    srgb = float3(g);
  }

  return half4(clamp(srgb, float3(0.0), float3(1.0)), 1.0);
}
`;

const TIME_SHIFT_SKSL = `
uniform shader uBlueImg;
uniform shader uNightImg;
uniform shader uHorizonTex;
uniform float2 uRes;
uniform float2 uOffsetUv;
uniform float uHorizonCols;

half4 main(float2 coord) {
  float2 uv = coord / uRes;
  half4 hCol = uHorizonTex.eval(float2(uv.x * uHorizonCols, 0.5));
  float hy = hCol.r; // 0..1 정규화 능선 y
  float skyMask = smoothstep(hy + 0.015, hy - 0.015, uv.y);
  half4 bluePx = uBlueImg.eval(coord);
  float2 nightCoord = clamp(uv + uOffsetUv, float2(0.0), float2(1.0)) * uRes;
  half4 nightPx = uNightImg.eval(nightCoord);
  return mix(bluePx, nightPx, skyMask);
}
`;

let geomEffect: SkRuntimeEffect | null | undefined;
let spatialEffect: SkRuntimeEffect | null | undefined;
let colorEffect: SkRuntimeEffect | null | undefined;
let timeShiftEffect: SkRuntimeEffect | null | undefined;

function getEffects() {
  if (geomEffect === undefined) geomEffect = Skia.RuntimeEffect.Make(GEOM_SKSL);
  if (spatialEffect === undefined) spatialEffect = Skia.RuntimeEffect.Make(SPATIAL_SKSL);
  if (colorEffect === undefined) colorEffect = Skia.RuntimeEffect.Make(COLOR_SKSL);
  if (timeShiftEffect === undefined) timeShiftEffect = Skia.RuntimeEffect.Make(TIME_SHIFT_SKSL);
  return { geomEffect, spatialEffect, colorEffect, timeShiftEffect };
}

function estimateSkyRgbFromSkImage(
  img: SkImage,
  horizonYNorm: Float32Array | null,
): [number, number, number] {
  const sw = 48;
  const sh = 36;
  const surf = Skia.Surface.Make(sw, sh);
  if (!surf) return [0.5, 0.5, 0.5];
  const c = surf.getCanvas();
  c.drawImageRect(img, rect(0, 0, img.width(), img.height()), rect(0, 0, sw, sh), Skia.Paint());
  surf.flush();
  const px = surf.makeImageSnapshot().readPixels(0, 0, {
    width: sw,
    height: sh,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px || !(px instanceof Uint8Array)) return [0.5, 0.5, 0.5];

  const toLin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let x = 0; x < sw; x++) {
    const colIdx = horizonYNorm
      ? Math.min(horizonYNorm.length - 1, Math.floor((x / sw) * horizonYNorm.length))
      : 0;
    const hy = horizonYNorm && Number.isFinite(horizonYNorm[colIdx]) ? horizonYNorm[colIdx] : 0.45;
    const maxY = clamp(Math.floor(hy * sh), 2, Math.floor(sh * 0.65));
    for (let y = 0; y < maxY; y++) {
      const idx = (y * sw + x) * 4;
      rSum += toLin(px[idx]);
      gSum += toLin(px[idx + 1]);
      bSum += toLin(px[idx + 2]);
      count++;
    }
  }
  if (count === 0) return [0.5, 0.5, 0.5];
  return [rSum / count, gSum / count, bSum / count];
}

function sampleZoneHistogram(img: SkImage): ZoneHistogramResult | null {
  const sw = 64;
  const sh = 64;
  const surf = Skia.Surface.Make(sw, sh);
  if (!surf) return null;
  surf.getCanvas().drawImageRect(
    img,
    rect(0, 0, img.width(), img.height()),
    rect(0, 0, sw, sh),
    Skia.Paint(),
  );
  surf.flush();
  const px = surf.makeImageSnapshot().readPixels(0, 0, {
    width: sw,
    height: sh,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px || !(px instanceof Uint8Array)) return null;
  const luma = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    luma[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  }
  return computeZoneSystemHistogram(luma);
}

/**
 * 1장(또는 합성된 기본 이미지)에 현재 장착된 가상 광학 가방 전체(렌즈 + 필터 + 필름)를 적용합니다.
 */
export async function applyOpticalGearToPhoto(
  uri: string,
  ctx: PhotoProcessContext,
): Promise<PhotoProcessResult> {
  const { gear } = ctx;
  const aod = ctx.aod ?? 0.25;
  const humidityPct = ctx.humidityPct ?? 55;
  const cloudCover01 = ctx.cloudCover01 ?? 0.3;

  // 구름 노출 추천 시간 계산 (필터와 무관하게 HUD/요약용으로 산출)
  const cloudFlow = ctx.windLayers && ctx.windLayers.length > 0
    ? computeCloudFlowKernel(ctx.windLayers, ctx.attitude, ctx.intrinsics, {
        durationSec: gear.ndDurationSec,
        taps: 13,
      })
    : null;

  if (!hasActiveOpticalGear(gear)) {
    return {
      uri,
      zoneHistogram: null,
      recommendedCloudSec: cloudFlow?.recommendedDurationSec ?? null,
      appliedTags: [],
    };
  }

  const srcRaw = await loadSkImageFromUri(uri);
  if (!srcRaw) {
    return {
      uri,
      zoneHistogram: null,
      recommendedCloudSec: cloudFlow?.recommendedDurationSec ?? null,
      appliedTags: [],
    };
  }

  const scale = Math.min(1, MAX_WORK_EDGE / Math.max(srcRaw.width(), srcRaw.height()));
  const workW = Math.max(16, Math.round(srcRaw.width() * scale));
  const workH = Math.max(16, Math.round(srcRaw.height() * scale));

  // 작업용 해상도로 리사이즈된 기준 SkImage 확보
  const workSurf0 = Skia.Surface.Make(workW, workH);
  if (!workSurf0) return { uri, zoneHistogram: null, recommendedCloudSec: null, appliedTags: [] };
  workSurf0.getCanvas().drawImageRect(
    srcRaw,
    rect(0, 0, srcRaw.width(), srcRaw.height()),
    rect(0, 0, workW, workH),
    Skia.Paint(),
  );
  workSurf0.flush();
  let curImg = workSurf0.makeImageSnapshot();

  const { geomEffect: gFx, spatialEffect: sFx, colorEffect: cFx } = getEffects();
  const appliedTags: string[] = [];

  const needDepth =
    gear.lensMount === 'scheimpflug' ||
    gear.lensMount === 'dolly' ||
    gear.frontFilters.includes('dehaze') ||
    gear.frontFilters.includes('nd1000');

  const depthGrid = needDepth
    ? computeTerrainDepthGrid(
        { elev: ctx.elev, eyeElevM: ctx.eyeElevM, horizon: ctx.horizon },
        ctx.attitude,
        ctx.intrinsics,
        GRID_W,
        GRID_H,
      )
    : null;

  const fallbackHorizon: HorizonProfile = ctx.horizon ?? {
    stepDeg: 5,
    elevDeg: new Float32Array(72).fill(0),
  };

  const gndCurve = computeContourGndCurve(fallbackHorizon, ctx.attitude, ctx.intrinsics, {
    mode: gear.gndMode,
    maxStops: gear.gndStops,
    columns: 64,
  });
  const gndGrid = bakeContourGndGrid(gndCurve, GRID_W, GRID_H);

  const useCpl = gear.frontFilters.includes('cpl');
  const cplGrid = useCpl
    ? computeRayleighCplGrid(ctx.sunAzDeg, ctx.sunAltDeg, ctx.attitude, ctx.intrinsics, GRID_W, GRID_H, {
        strength: gear.cplStrength,
      })
    : null;

  const useDehaze = gear.frontFilters.includes('dehaze');
  const dehazeRes = useDehaze && depthGrid
    ? computeKoschmiederDehazeMap(depthGrid, GRID_W, GRID_H, {
        aod,
        humidityPct,
        strength: gear.dehazeStrength,
      })
    : null;
  const ridgeRes = useDehaze && depthGrid ? computeRidgeLayerBands(depthGrid, GRID_W, GRID_H) : null;

  const useLp = gear.frontFilters.includes('astroClear');
  const lpRes = useLp
    ? computeLightPollutionNotchGrid(ctx.attitude, ctx.intrinsics, GRID_W, GRID_H, {
        bortleClass: ctx.bortleClass ?? 7,
        aod,
        horizon: ctx.horizon,
        strength: gear.lightPollutionStrength,
      })
    : null;

  const useBokeh = gear.lensMount === 'scheimpflug';
  const cocGrid = useBokeh && depthGrid
    ? computeScheimpflugCocGrid(depthGrid, GRID_W, GRID_H, ctx.attitude, ctx.intrinsics, {
        focusDistM: gear.focusDistM,
        tiltPitchDeg: gear.tiltPitchDeg,
        apertureF: gear.apertureF,
      })
    : null;

  const useDolly = gear.lensMount === 'dolly';
  const dollyRes = useDolly && depthGrid
    ? computeVirtualDollyWarpGrid(depthGrid, GRID_W, GRID_H, {
        farZoom: gear.dollyFarZoom,
      })
    : null;

  const nCells = GRID_W * GRID_H;
  const maskABytes = new Uint8Array(nCells * 4);
  const maskBBytes = new Uint8Array(nCells * 4);
  const geomBytes = new Uint8Array(nCells * 4);

  const hyAtU = (u: number): number => {
    const f = clamp(u, 0, 0.9999) * gndCurve.columns - 0.5;
    const i0 = clamp(Math.floor(f), 0, gndCurve.columns - 1);
    const i1 = clamp(i0 + 1, 0, gndCurve.columns - 1);
    const t = clamp(f - i0, 0, 1);
    const y0 = gndCurve.horizonYNorm[i0];
    const y1 = gndCurve.horizonYNorm[i1];
    if (!Number.isFinite(y0) && !Number.isFinite(y1)) return 0.55;
    return !Number.isFinite(y0) ? y1 : !Number.isFinite(y1) ? y0 : y0 * (1 - t) + y1 * t;
  };

  for (let y = 0; y < GRID_H; y++) {
    const v = (y + 0.5) / GRID_H;
    for (let x = 0; x < GRID_W; x++) {
      const u = (x + 0.5) / GRID_W;
      const i = y * GRID_W + x;
      const o = i * 4;

      const isGround = depthGrid
        ? Number.isFinite(depthGrid[i]) && depthGrid[i] > 0
        : v > hyAtU(u);

      maskABytes[o] = Math.round(clamp(gndGrid[i], 0, 1) * 255);
      maskABytes[o + 1] = Math.round(clamp(cplGrid ? cplGrid[i] : 1, 0, 1) * 255);
      maskABytes[o + 2] = Math.round(clamp(dehazeRes ? dehazeRes.effectiveTransmission[i] : 1, 0, 1) * 255);
      maskABytes[o + 3] = 255;

      const bIdx = ridgeRes ? ridgeRes.bandIndex[i] : -1;
      const bandNorm = bIdx < 0 ? 0 : clamp((bIdx + 1) / 5, 0.2, 1);
      maskBBytes[o] = Math.round(clamp(lpRes ? lpRes.pollutionWeightGrid[i] : 0, 0, 1) * 255);
      maskBBytes[o + 1] = Math.round(clamp(ridgeRes ? ridgeRes.ridgeEdgeStrength[i] : 0, 0, 1) * 255);
      maskBBytes[o + 2] = Math.round((isGround ? Math.max(0.1, bandNorm) : 0) * 255);
      maskBBytes[o + 3] = 255;

      const du = dollyRes ? dollyRes.uvOffset[i * 2] : 0;
      const dv = dollyRes ? dollyRes.uvOffset[i * 2 + 1] : 0;
      const coc = cocGrid ? cocGrid[i] : 0;
      geomBytes[o] = Math.round(clamp(0.5 + du / 0.8, 0, 1) * 255);
      geomBytes[o + 1] = Math.round(clamp(0.5 + dv / 0.8, 0, 1) * 255);
      geomBytes[o + 2] = Math.round(clamp(0.5 + coc / 0.08, 0, 1) * 255);
      // geomBytes.A = 하늘 여부(255=하늘, 0=지상)
      geomBytes[o + 3] = isGround ? 0 : 255;
    }
  }

  const maskAImg = makeOpaqueRgbaImage(maskABytes, GRID_W, GRID_H);
  const maskBImg = makeOpaqueRgbaImage(maskBBytes, GRID_W, GRID_H);
  const geomImg = makeOpaqueRgbaImage(geomBytes, GRID_W, GRID_H);

  // Pass A: 수직 시프트 교정 & 가상 돌리 줌 워핑
  const useShift = gear.verticalShift || gear.lensMount === 'scheimpflug';
  if ((useShift || useDolly) && gFx && geomImg) {
    const shiftRes = computeVerticalShiftHomography(ctx.attitude, ctx.intrinsics, {
      strength: gear.shiftStrength,
    });
    const h = shiftRes.dstToSrcUv;
    const cb = shiftRes.cropBox;
    const surf = Skia.Surface.Make(workW, workH);
    if (surf) {
      const shader = gFx.makeShaderWithChildren(
        [
          workW, workH,
          GRID_W, GRID_H,
          h[0], h[1], h[2],
          h[3], h[4], h[5],
          h[6], h[7], h[8],
          cb.u0, cb.v0, cb.u1, cb.v1,
          useShift ? 1 : 0,
          useDolly ? 1 : 0,
        ],
        [imgShader(curImg), imgShader(geomImg)],
      );
      const p = Skia.Paint();
      p.setShader(shader);
      surf.getCanvas().drawRect(rect(0, 0, workW, workH), p);
      surf.flush();
      curImg = surf.makeImageSnapshot();
      if (useShift) appliedTags.push('Vertical-Shift');
      if (useDolly) appliedTags.push(`Dolly ${gear.dollyFarZoom.toFixed(1)}×`);
    }
  }

  // Pass B: 공간 광학 효과 (Tilt-Shift 보케 · ND1000 구름 결 · 고스트 억제 · 선스타/아나모픽/Pro-Mist)
  const useCloud = gear.frontFilters.includes('nd1000') && !!cloudFlow;
  const useProMist = gear.frontFilters.includes('proMist');
  const useGhostClean = gear.frontFilters.includes('ghostClean');
  const useAnamorphic = gear.lensMount === 'anamorphic';

  const sunPt = project(dirFromAzEl(ctx.sunAzDeg, ctx.sunAltDeg), ctx.attitude, ctx.intrinsics);
  const sunIn = !!sunPt;
  const flareRes = (useAnamorphic || useProMist || useGhostClean) && sunIn
    ? computeSunstarAndFlareParams(ctx.sunAzDeg, ctx.sunAltDeg, ctx.attitude, ctx.intrinsics, {
        horizon: ctx.horizon,
        aod,
        apertureBlades: gear.sunstarBlades,
        proMistGrade: gear.proMistGrade,
      })
    : null;
  const ghostRes = useGhostClean
    ? predictBacklightGhosts(ctx.sunAzDeg, ctx.sunAltDeg, ctx.attitude, ctx.intrinsics)
    : null;

  const needSpatial = useBokeh || useCloud || useProMist || useGhostClean || useAnamorphic;
  if (needSpatial && sFx && maskAImg && geomImg) {
    const g0 = ghostRes?.ghosts[0];
    const g1 = ghostRes?.ghosts[1];
    const g2 = ghostRes?.ghosts[2];
    const surf = Skia.Surface.Make(workW, workH);
    if (surf) {
      const shader = sFx.makeShaderWithChildren(
        [
          workW, workH,
          GRID_W, GRID_H,
          useBokeh ? 1 : 0,
          useCloud ? 1 : 0,
          cloudFlow ? cloudFlow.flowUv[0] : 0,
          cloudFlow ? cloudFlow.flowUv[1] : 0,
          flareRes && flareRes.visible && (useAnamorphic || gear.filmBack === 'sunsetWb') ? 1 : 0,
          flareRes?.sunUv?.[0] ?? 0.5,
          flareRes?.sunUv?.[1] ?? 0.3,
          flareRes?.sunstarIntensity ?? 0,
          flareRes?.rayCount ?? 8,
          flareRes?.sunstarLengthNorm ?? 0.12,
          useAnamorphic ? (flareRes?.anamorphicIntensity ?? 0.45) : 0,
          flareRes?.anamorphicHalfWidthNorm ?? 0.35,
          useProMist ? (flareRes?.proMistStrength ?? gear.proMistGrade) : 0,
          flareRes?.proMistRadiusNorm ?? 0.06,
          useGhostClean ? 1 : 0,
          g0 ? g0.u : 0, g0 ? g0.v : 0, g0 ? g0.radiusNorm : 0.03, g0 ? g0.intensity : 0,
          g1 ? g1.u : 0, g1 ? g1.v : 0, g1 ? g1.radiusNorm : 0.04, g1 ? g1.intensity : 0,
          g2 ? g2.u : 0, g2 ? g2.v : 0, g2 ? g2.radiusNorm : 0.05, g2 ? g2.intensity : 0,
        ],
        [imgShader(curImg), imgShader(maskAImg), imgShader(geomImg)],
      );
      const p = Skia.Paint();
      p.setShader(shader);
      surf.getCanvas().drawRect(rect(0, 0, workW, workH), p);
      surf.flush();
      curImg = surf.makeImageSnapshot();
      if (useBokeh) appliedTags.push('3D-Scheimpflug');
      if (useCloud) appliedTags.push(`ND1000-${gear.ndDurationSec}s`);
      if (useProMist) appliedTags.push(`ProMist`);
      if (useGhostClean) appliedTags.push('Anti-Ghost');
    }
  }

  // Pass C: 대기 · 색감 · 스펙트럼 필터 (노을 WB + LUT + GND + CPL + 광해 + 연무 + 존 모노크롬)
  const useWb = gear.filmBack === 'sunsetWb';
  const useGnd = gear.frontFilters.includes('gnd');
  const useMono = gear.filmBack === 'monoZone';

  const needColor = useWb || useGnd || useCpl || useDehaze || useLp || useMono;
  if (needColor && cFx && maskAImg && maskBImg) {
    const measuredSky = useWb
      ? estimateSkyRgbFromSkImage(curImg, gndCurve.horizonYNorm)
      : ([0.5, 0.5, 0.5] as const);
    const wbRes = computeSunsetWbCorrection({
      sunAltDeg: ctx.sunAltDeg,
      aod,
      humidityPct,
      cloudCover01,
      measuredSkyRgb: measuredSky,
      strength: gear.wbStrength,
    });
    const lutArr = buildSunsetToneLut({
      highlightRollOff: useWb ? 0.72 : 0.45,
      silhouetteDepth: useWb ? 0.5 : 0.25,
      size: 256,
    });
    const lutBytes = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const v = Math.round(clamp(lutArr[i], 0, 1) * 255);
      lutBytes[i * 4] = v;
      lutBytes[i * 4 + 1] = v;
      lutBytes[i * 4 + 2] = v;
      lutBytes[i * 4 + 3] = 255;
    }
    const lutImg = makeOpaqueRgbaImage(lutBytes, 256, 1);

    const monoRes = computeMonochromeFilterWeights(gear.monoFilter, ctx.sunAltDeg, aod);
    const m = wbRes.colorMatrix;

    if (lutImg) {
      const surf = Skia.Surface.Make(workW, workH);
      if (surf) {
        const shader = cFx.makeShaderWithChildren(
          [
            workW, workH,
            GRID_W, GRID_H,
            m[0], m[1], m[2],
            m[3], m[4], m[5],
            m[6], m[7], m[8],
            useWb ? 1 : 0,
            useWb ? 0.75 : 0,
            useGnd ? 1 : 0,
            useCpl ? 1 : 0,
            gear.cplStrength,
            useDehaze ? gear.dehazeStrength : 0,
            useDehaze ? gear.ridgeBandContrast : 0,
            useLp ? 1 : 0,
            lpRes?.sodiumCastRgb[0] ?? 1,
            lpRes?.sodiumCastRgb[1] ?? 0.74,
            lpRes?.sodiumCastRgb[2] ?? 0.22,
            useMono ? 1 : 0,
            monoRes.channelWeights[0],
            monoRes.channelWeights[1],
            monoRes.channelWeights[2],
            monoRes.skyDarkenStops,
            monoRes.reliefContrastBoost,
          ],
          [imgShader(curImg), imgShader(maskAImg), imgShader(maskBImg), imgShader(lutImg)],
        );
        const p = Skia.Paint();
        p.setShader(shader);
        surf.getCanvas().drawRect(rect(0, 0, workW, workH), p);
        surf.flush();
        curImg = surf.makeImageSnapshot();
        if (useWb) appliedTags.push(`SunsetWB ${wbRes.reference.horizonCctK}K`);
        if (useGnd) appliedTags.push(`GND-${gear.gndStops.toFixed(1)}EV`);
        if (useCpl) appliedTags.push('CPL');
        if (useDehaze) appliedTags.push(gear.dehazeStrength >= 0 ? 'Dehaze' : 'Ink-Haze');
        if (useLp) appliedTags.push('Astro-Clear');
        if (useMono) appliedTags.push(`Zone-${gear.monoFilter}`);
      }
    }
  }

  // Pass D: 2.39:1 아나모픽 시네마 비율 크롭
  if (useAnamorphic) {
    const targetH = Math.max(16, Math.round(workW / 2.39));
    if (targetH < workH - 4) {
      const sy = Math.round((workH - targetH) / 2);
      const surf = Skia.Surface.Make(workW, targetH);
      if (surf) {
        surf.getCanvas().drawImageRect(
          curImg,
          rect(0, sy, workW, targetH),
          rect(0, 0, workW, targetH),
          Skia.Paint(),
        );
        surf.flush();
        curImg = surf.makeImageSnapshot();
        appliedTags.push('2.39:1');
      }
    }
  }

  const zoneHistogram = useMono || useWb ? sampleZoneHistogram(curImg) : null;
  const outUri = await saveSkImageToTempJpeg(curImg, 93, 'opt');

  return {
    uri: outUri,
    zoneHistogram,
    recommendedCloudSec: cloudFlow?.recommendedDurationSec ?? null,
    appliedTags,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 멀티프레임 / 시간차 특수 촬영 합성
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 해·달 걸기 럭키 이미징 + 2× 서브픽셀 Drizzle 합성.
 * 버스트 프레임들 중 Laplacian Variance 상위 35%를 고르고 서브픽셀 위상차만큼 정렬해
 * 2배 해상도 격자에 누적합니다.
 */
export async function mergeLuckyDrizzleBurst(
  frameUris: readonly string[],
  keepRatio = 0.35,
): Promise<string | null> {
  if (frameUris.length === 0) return null;
  if (frameUris.length === 1) return frameUris[0];

  const imgs: SkImage[] = [];
  for (const u of frameUris) {
    const im = await loadSkImageFromUri(u);
    if (im) imgs.push(im);
  }
  if (imgs.length === 0) return null;
  if (imgs.length === 1) return frameUris[0];

  const tw = 96;
  const th = 72;
  const lumas: Float32Array[] = [];
  const scores: number[] = [];

  for (const im of imgs) {
    const s = Skia.Surface.Make(tw, th);
    if (!s) {
      lumas.push(new Float32Array(tw * th));
      scores.push(0);
      continue;
    }
    s.getCanvas().drawImageRect(im, rect(0, 0, im.width(), im.height()), rect(0, 0, tw, th), Skia.Paint());
    s.flush();
    const px = s.makeImageSnapshot().readPixels(0, 0, {
      width: tw,
      height: th,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    const lum = new Float32Array(tw * th);
    if (px && px instanceof Uint8Array) {
      for (let i = 0; i < tw * th; i++) {
        lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      }
    }
    lumas.push(lum);
    // 화면 중앙 70% 영역(타워+해/달 걸리는 영역)의 선명도 평가
    scores.push(
      scoreFrameSharpness(lum, tw, th, {
        x0: Math.floor(tw * 0.15),
        y0: Math.floor(th * 0.15),
        x1: Math.ceil(tw * 0.85),
        y1: Math.ceil(th * 0.85),
      }),
    );
  }

  const sel = selectLuckyFrames(scores, keepRatio);
  const refIdx = sel.selectedIndices[0] ?? 0;
  const refImg = imgs[refIdx];
  const refLum = lumas[refIdx];

  // 2× 서브픽셀 Drizzle 출력 크기 (상한 3072px)
  const drizzleScale = Math.min(2, 3072 / Math.max(refImg.width(), refImg.height()));
  const outW = Math.max(64, Math.round(refImg.width() * drizzleScale));
  const outH = Math.max(64, Math.round(refImg.height() * drizzleScale));
  const surf = Skia.Surface.Make(outW, outH);
  if (!surf) return frameUris[refIdx];

  const canvas = surf.getCanvas();
  const pxScaleX = outW / tw;
  const pxScaleY = outH / th;

  let accWeight = 0;
  for (let orderPos = 0; orderPos < sel.selectedIndices.length; orderPos++) {
    const idx = sel.selectedIndices[orderPos];
    const w = sel.weights[idx];
    if (w <= 0) continue;

    const shift = idx === refIdx
      ? { dx: 0, dy: 0, confidence: 1 }
      : estimateSubpixelShift(refLum, lumas[idx], tw, th, 6);
    const dxOut = shift.confidence > 0.2 ? -shift.dx * pxScaleX : 0;
    const dyOut = shift.confidence > 0.2 ? -shift.dy * pxScaleY : 0;

    accWeight += w;
    const paint = Skia.Paint();
    paint.setAlphaf(orderPos === 0 ? 1 : clamp(w / accWeight, 0.05, 1));
    canvas.drawImageRect(
      imgs[idx],
      rect(0, 0, imgs[idx].width(), imgs[idx].height()),
      rect(dxOut, dyOut, outW, outH),
      paint,
    );
  }
  surf.flush();
  return saveSkImageToTempJpeg(surf.makeImageSnapshot(), 95, 'lucky');
}

/**
 * 다중 프레임 지상 IMU 정합 평균(ND1000 구름 버스트 / 3단 브라켓 공용).
 */
export async function mergeAlignedBurstFrames(
  frames: ReadonlyArray<{ uri: string; attitude?: Attitude | null }>,
  intrinsics: Intrinsics,
  weights?: readonly number[],
): Promise<string | null> {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0].uri;

  const imgs: SkImage[] = [];
  for (const f of frames) {
    const im = await loadSkImageFromUri(f.uri);
    if (im) imgs.push(im);
  }
  if (imgs.length === 0) return null;
  if (imgs.length === 1) return frames[0].uri;

  const ref = imgs[0];
  const scale = Math.min(1, MAX_WORK_EDGE / Math.max(ref.width(), ref.height()));
  const outW = Math.max(16, Math.round(ref.width() * scale));
  const outH = Math.max(16, Math.round(ref.height() * scale));

  const surf = Skia.Surface.Make(outW, outH);
  if (!surf) return frames[0].uri;
  const canvas = surf.getCanvas();

  const refAtt = frames[0].attitude;
  let wSum = 0;

  for (let i = 0; i < imgs.length; i++) {
    const w = weights?.[i] ?? 1;
    wSum += w;
    const paint = Skia.Paint();
    paint.setAlphaf(i === 0 ? 1 : clamp(w / wSum, 0.02, 1));

    // IMU 호모그래피 중심 이동량 추출(안전한 강체 오프셋 정렬)
    let dx = 0;
    let dy = 0;
    const curAtt = frames[i].attitude;
    if (i > 0 && refAtt && curAtt) {
      const h = computeGroundStabilizationHomography(refAtt, curAtt, intrinsics);
      const du = h[0] * 0.5 + h[1] * 0.5 + h[2];
      const dv = h[3] * 0.5 + h[4] * 0.5 + h[5];
      const dw = h[6] * 0.5 + h[7] * 0.5 + h[8];
      if (Math.abs(dw) > 1e-4) {
        dx = (0.5 - du / dw) * outW;
        dy = (0.5 - dv / dw) * outH;
      }
    }

    canvas.drawImageRect(
      imgs[i],
      rect(0, 0, imgs[i].width(), imgs[i].height()),
      rect(dx, dy, outW, outH),
      paint,
    );
  }

  surf.flush();
  return saveSkImageToTempJpeg(surf.makeImageSnapshot(), 93, 'burst');
}

/**
 * 블루아워 지형(앵커) + 한밤중 별/달 하늘을 3D DEM 능선 경계에서 자연스럽게 합성합니다.
 */
export async function blendTimeShiftBlueHourAndNight(
  blueAnchorUri: string,
  nightUri: string,
  horizonYNorm: Float32Array,
  alignOffsetUv: readonly [number, number],
): Promise<string> {
  const { timeShiftEffect: fx } = getEffects();
  const blueImg = await loadSkImageFromUri(blueAnchorUri);
  const nightImg = await loadSkImageFromUri(nightUri);
  if (!fx || !blueImg || !nightImg) return nightUri;

  const scale = Math.min(1, MAX_WORK_EDGE / Math.max(blueImg.width(), blueImg.height()));
  const w = Math.max(16, Math.round(blueImg.width() * scale));
  const h = Math.max(16, Math.round(blueImg.height() * scale));

  const cols = Math.max(8, horizonYNorm.length);
  const hBytes = new Uint8Array(cols * 4);
  for (let i = 0; i < cols; i++) {
    const y = Number.isFinite(horizonYNorm[i]) ? clamp(horizonYNorm[i], 0, 1) : 0.55;
    const v = Math.round(y * 255);
    hBytes[i * 4] = v;
    hBytes[i * 4 + 1] = v;
    hBytes[i * 4 + 2] = v;
    hBytes[i * 4 + 3] = 255;
  }
  const hImg = makeOpaqueRgbaImage(hBytes, cols, 1);
  const surf = Skia.Surface.Make(w, h);
  if (!hImg || !surf) return nightUri;

  const shader = fx.makeShaderWithChildren(
    [w, h, alignOffsetUv[0], alignOffsetUv[1], cols],
    [imgShader(blueImg), imgShader(nightImg), imgShader(hImg)],
  );
  const p = Skia.Paint();
  p.setShader(shader);
  surf.getCanvas().drawRect(rect(0, 0, w, h), p);
  surf.flush();
  return saveSkImageToTempJpeg(surf.makeImageSnapshot(), 94, 'timeshift');
}
