/**
 * 뭉게구름 표면 혹(billow) — 하네스 시제품, 기본 꺼짐. 설계: docs/WAVE_FIELD_DESIGN.md §8.
 *
 * 지금 종류 모형의 밀도(바닥 무늬 → 돔 단면)는 그대로 두고, 표면 근처에서만 3차원 혹 장 B 를 더해 경계면을 바깥·안쪽으로 밉니다.
 *  - B = Σ_j a_j·(2|F_j|/√6 − 1.596): 둥근 혹 사이에 날카로운 골(꽃양배추). F_j 는 방향 12 개 사인 합.
 *  - 단계별 파장 λ = billowKm·2^(−j)(j = 0, 1, 2). 화소 크기(mip 발자국)가 λ/4 를 넘으면 그 단계를 줄여 반짝임을 막음.
 *  - 혹은 밑면에서 꺼지고(높이 비율 0.05~0.3 에서 켜짐) 옆·꼭대기에서 켜짐.
 *  - 바깥으로 솟는 혹이 '빈 칸 건너뛰기'에 잘리지 않도록 날씨 밀도를 혹 세기만큼 부풀려 둡니다.
 * billowOn 0 이면 셰이더는 원래 경로 그대로입니다.
 */
import { Vector4 } from 'three';

const PER = 12, OCT = 3, N = PER * OCT;
type PatchableMaterial = { fragmentShader: string; uniforms: Record<string, { value: unknown }>; needsUpdate: boolean };

const ST_GENUS = 'struct WeatherSample {\n  vec4 heightFraction;\n  vec4 density;\n  vec4 depth;\n};';
const MIX_ANCHOR = '  weather.density = mix(weather.density, gDensity, genusOn);';
const MEDIA_ANCHOR = '  vec4 density = weather.density;\n';

const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 단위 방향 36 개(구 위 고르게)와 위상. 파장은 셰이더에서 단계별로 곱함. */
function directions(seed: number): Vector4[] {
  const r = rng(seed * 104729 + 7), out: Vector4[] = [];
  for (let i = 0; i < N; i++) {
    const u = 2 * r() - 1, th = 2 * Math.PI * r(), s = Math.sqrt(1 - u * u);
    out.push(new Vector4(s * Math.cos(th), s * Math.sin(th), u, 2 * Math.PI * r()));
  }
  return out;
}

export function patchBillowShader(mat: PatchableMaterial): void {
  let src = mat.fragmentShader;
  for (const a of [ST_GENUS, MIX_ANCHOR, MEDIA_ANCHOR]) if (!src.includes(a)) throw new Error('cloudBillow: shader anchor missing — ' + a.trim().slice(0, 50));
  // 균일변수는 sampleWeather 보다 앞(구조체 자리)에 선언
  src = src.replace(ST_GENUS, `uniform float billowOn;\nuniform vec4 billowLanes;\nuniform vec4 billowP;\nuniform vec4 billowDir[${N}];\n` + 'struct WeatherSample {\n  vec4 heightFraction;\n  vec4 density;\n  vec4 depth;\n  vec4 sd;\n};');
  // 자르기 전 부호 있는 값(경계면 = 0, 속 = 양수)을 남기고, 혹이 바깥으로 솟을 자리만큼 건너뛰기용 밀도를 부풀림
  src = src.replace(MIX_ANCHOR, MIX_ANCHOR + [
    '',
    '  weather.sd = (localWeather - (vec4(1.0) - gHs)) * genusEdge;',
    '  if (billowOn > 0.5 && billowP.w < 0.5) weather.density = max(weather.density, clamp(weather.sd + billowLanes * billowP.y, 0.0, 1.0) * genusOn * step(vec4(1.0 / 512.0), localWeather));',
  ].join('\n'));
  const decl = [
    '// 혹 장: 단계 j 의 파장 billowP.x·2^(−j) m. 발자국 foot(m) 가 λ/4 를 넘으면 그 단계를 줄임.',
    'float billowField(vec3 q, float foot) {',
    '  float b = 0.0, lam = billowP.x, amp = 0.6;',
    '  for (int j = 0; j < 3; j++) {',
    '    float fade = 1.0 - smoothstep(0.25 * lam, 0.5 * lam, foot);',
    '    if (fade > 0.0) {',
    '      float k = 6.2831853 / lam, f = 0.0;',
    `      for (int m = 0; m < ${PER}; m++) { vec4 d = billowDir[j * ${PER} + m]; f += cos(k * dot(d.xyz, q) + d.w); }`,
    `      b += fade * amp * (2.0 * abs(f) * ${(1 / Math.sqrt(PER / 2)).toFixed(6)} - 1.5958);`,
    '    }',
    '    lam *= 0.5; amp *= 0.55;',
    '  }',
    '  return b;',
    '}',
    '',
  ].join('\n');
  src = src.replace('vec4 getLayerDensity', decl + 'vec4 getLayerDensity');
  src = src.replace(MEDIA_ANCHOR, MEDIA_ANCHOR + [
    '  if (billowOn > 0.5 && any(greaterThan(billowLanes, vec4(0.0)))) {',
    '    vec4 bNear = billowLanes * step(vec4(-billowP.y), weather.sd) * step(weather.sd, vec4(1.0 + billowP.y));',
    '    if (any(greaterThan(bNear, vec4(0.0)))) {',
    '      float bFoot = genusTexelM * exp2(mipLevel);',
    '      vec3 bd = position - genusOrigin;',
    '      float bz = dot(bd, normalize(position));',
    '      float bB = billowField(vec3(dot(bd, genusEast), dot(bd, genusNorth), bz), bFoot);',
    '      vec4 bH = smoothstep(vec4(0.05), vec4(0.3), weather.heightFraction);',
    '      // 깎기 꼴(billowP.w 1): 혹 사이 골만 파고 바깥으로 솟지 않음 — 솟기 꼴은 약한 칸에 새 조각 구름을 만듦(3차 판정)',
    '      float bV = billowP.w > 0.5 ? min(bB, 0.0) : bB;',
    '      density = mix(density, clamp(weather.sd + billowP.y * bV * bH - billowP.z, 0.0, 1.0), bNear);',
    '    }',
    '  }',
  ].join('\n') + '\n');
  mat.fragmentShader = src;
  mat.uniforms.billowOn = { value: 0 };
  mat.uniforms.billowLanes = { value: new Vector4() };
  mat.uniforms.billowP = { value: new Vector4(400, 0.5, 0, 0) };
  mat.uniforms.billowDir = { value: directions(1) };
  mat.needsUpdate = true;
}

export interface BillowParams {
  /** 가장 큰 혹 파장(m) */
  lambdaM: number;
  /** 혹 세기(날씨 부호 값 단위, 경계면을 미는 양) */
  amp: number;
  /** 경계면을 안쪽으로 당기는 양(혹이 더한 구름 양을 상쇄) */
  bias?: number;
  /** 깎기만(골만 파고 바깥으로 솟지 않음) */
  carve?: boolean;
  seed?: number;
}

/** lanes: 레인별 켬(0/1). 모두 0 이거나 p 가 null 이면 끔. */
export function setBillowUniforms(mat: PatchableMaterial, p: BillowParams | null, lanes: number[]): void {
  const u = mat.uniforms;
  const on = !!p && lanes.some(x => x > 0);
  u.billowOn.value = on ? 1 : 0;
  (u.billowLanes.value as Vector4).set(lanes[0] ?? 0, lanes[1] ?? 0, lanes[2] ?? 0, lanes[3] ?? 0);
  if (!on || !p) return;
  (u.billowP.value as Vector4).set(p.lambdaM, p.amp, p.bias ?? 0, p.carve ? 1 : 0);
  const dirs = directions(p.seed ?? 1), cur = u.billowDir.value as Vector4[];
  dirs.forEach((d, i) => cur[i].copy(d));
}

/** 앱 기본값(§8 10회차에서 고른 것): 혹 400 m, 깎기 0.3. */
export const BILLOW_DEFAULT: BillowParams = { lambdaM: 400, amp: 0.3, carve: true };
/** 혹 그늘이 읽히는 해 쪽 추적(걸음 수, 첫 걸음 m, 배율). 끄면 [6, 250, 1.6]. */
export const BILLOW_SUN_MARCH: [number, number, number] = [10, 60, 1.5];
