// 구름 종류별 형태 모형(C3 시제품) — takram 구름 셰이더의 날씨 단계를 종류별로 바꿉니다.
//
// 날씨 텍스처 채널 값 d ∈ [0,1] 은 "그 자리 구름 기둥의 꼭대기 높이(층 두께 대비)"입니다. 0 이면 맑음.
// 셰이더는 층 안 높이 hf 에서 d 가 단면 함수 문턱을 넘는 곳에 구름을 둡니다.
//   dome(적운·층적운): 밑면 평평(얇은 램프) + 위로 (1−hf)^p — p=1 이면 꼭대기 = d (돔 모양 그대로)
//   lens(고적운): 가운데가 두껍고 위아래로 얇아지는 렌즈
// 밀도 = saturate((d − 문턱)·edge) — edge 가 클수록 가장자리가 또렷합니다(적운은 솜털이 아니라 선이 있습니다).

const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 주기 경계에서 이어지는 값 잡음(격자 n×n) + fbm
function periodicNoise(n, seed) {
  const r = rng(seed), g = new Float32Array(n * n).map(() => r());
  return (u, v) => {
    const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => g[((j % n + n) % n) * n + ((i % n + n) % n)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}
// 가로·세로 격자 수가 다른 주기 잡음(늘인 무늬 — 주기 경계를 지키려고 축에 맞춰 늘입니다)
function periodicNoise2(nx, ny, seed) {
  const r = rng(seed), g = new Float32Array(nx * ny).map(() => r());
  return (u, v) => {
    const x = u * nx, y = v * ny, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => g[((j % ny + ny) % ny) * nx + ((i % nx + nx) % nx)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const ab = a + (b - a) * sx; return ab + ((c + (d - c) * sx) - ab) * sy;
  };
}
function fbm2(nx, ny, oct, seed) {
  const ns = Array.from({ length: oct }, (_, k) => periodicNoise2(nx << k, ny << k, seed + k * 131));
  return (u, v) => { let s = 0, a = 0.5, w = 0; for (const f of ns) { s += a * f(u, v); w += a; a *= 0.5; } return s / w; };
}
function fbm(n0, oct, seed) {
  const ns = Array.from({ length: oct }, (_, k) => periodicNoise(n0 << k, seed + k * 101));
  return (u, v) => { let s = 0, a = 0.5, w = 0; for (const f of ns) { s += a * f(u, v); w += a; a *= 0.5; } return s / w; };
}

// 주기 경계 Worley 점들(격자 n×n, 칸마다 한 점) — 칸 정보(세기 등)를 같이 둡니다.
function cells(n, seed, jitter = 0.9) {
  const r = rng(seed), pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push({ x: (i + 0.5 + (r() - 0.5) * jitter) / n, y: (j + 0.5 + (r() - 0.5) * jitter) / n, s: r(), t: r() });
  return { n, pts, at: (i, j) => pts[((j % n + n) % n) * n + ((i % n + n) % n)] };
}
function wrapD(a, b) { let d = a - b; d -= Math.round(d); return d; }

function quantile(arr, q) { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; }

// 종류별 수평 무늬. 반환: 크기 S×S 의 원시 장 f(클수록 구름 기둥이 높음), 맑음은 작은 값.
const FIELDS = {
  // 적운: 떨어진 세포(돔). 간격 spacingKm, 세기 분포는 작은 것이 많게. 큰 규모 fbm 으로 무리 짓기.
  cu(S, tileKm, seed, o) {
    const n = Math.max(2, Math.round(tileKm / (o.spacingKm ?? 2.4)));
    const C = cells(n, seed), env = fbm(2, 3, seed + 7), warp = fbm(Math.max(4, n), 3, seed + 13), warp2 = fbm(Math.max(4, n), 3, seed + 17);
    const f = new Float32Array(S * S), wa = (o.warp ?? 0.35) / n, rmax = (o.radius ?? 0.55) / n, T = o.turrets ?? 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let u = (x + 0.5) / S, v = (y + 0.5) / S;
      u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n); let best = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), s = Math.pow(p.s, o.sizeSkew ?? 1.5) * (0.4 + 1.2 * env(p.x, p.y));
        const R = rmax * (0.45 + 0.55 * Math.min(1, s)); const dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        if (!T) { const q = 1 - (dx * dx + dy * dy) / (R * R); if (q > 0) best = Math.max(best, s * q); continue; }
        // 탑(turret) 여러 개: 한 구름 = 높이가 다른 반구 몇 개의 합집합 → 꼭대기가 여러 봉우리(꽃양배추).
        if (dx * dx + dy * dy > R * R * 1.6) continue;
        const r2 = rng(Math.floor(p.s * 1e9) ^ seed);
        for (let t = 0; t < T; t++) {
          const a = r2() * 6.2832, off = (t === 0 ? 0 : 0.25 + 0.3 * r2()) * R, Rb = R * (t === 0 ? 0.75 : 0.35 + 0.3 * r2());
          const hb = s * (t === 0 ? 0.75 : 0.55 + 0.45 * r2());
          const ex = dx - Math.cos(a) * off, ey = dy - Math.sin(a) * off, q = 1 - (ex * ex + ey * ey) / (Rb * Rb);
          if (q > 0) best = Math.max(best, hb * Math.sqrt(q));
        }
      }
      f[y * S + x] = best;
    }
    return f;
  },
  // 고적운: 잔 세포(구름 조각) + 큰 패치 + 약한 줄무늬(물결).
  ac(S, tileKm, seed, o) {
    const n = Math.max(4, Math.round(tileKm / (o.spacingKm ?? 0.35)));
    const C = cells(n, seed, 0.7), env = fbm(3, 4, seed + 5), rows = o.rows ?? 0.35, ang = o.windDeg ?? 30;
    const ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180);
    const f = new Float32Array(S * S), R = (o.radius ?? 0.62) / n;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S, ci = Math.floor(u * n), cj = Math.floor(v * n);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y);
        const q = 1 - (dx * dx + dy * dy) / (R * R * (0.6 + 0.4 * p.s)); if (q > 0) best = Math.max(best, (0.6 + 0.4 * p.t) * Math.sqrt(q));
      }
      // 물결: 바람에 수직인 줄(정수 주기여야 이어짐 — 근사로 n/3 줄)
      const k = Math.round(n / 3), along = (u * ca + v * sa);
      const wave = 1 - rows + rows * (0.5 + 0.5 * Math.cos(2 * Math.PI * k * along));
      f[y * S + x] = best * wave * Math.min(1, Math.max(0, (env(u, v) - 0.35) * 4));
    }
    return f;
  },
  // 권운: 바람 방향으로 길게 늘인 결(능선 잡음) + 갈고리(직각 방향 휨) + 패치.
  ci(S, tileKm, seed, o) {
    if (o.aniso) {
      // 권운 v2: 바람(텍스처 x = 동쪽) 방향으로 긴 띠 + 띠 속 가늘고 긴 평행 결 + 결을 휘는 저주파 휨.
      const bandL = Math.max(1, Math.round(tileKm / (o.bandLenKm ?? 12))), bandW = Math.max(2, Math.round(tileKm / (o.bandWidKm ?? 2.5)));
      const fibL = Math.max(2, Math.round(tileKm / (o.fibLenKm ?? 4))), fibW = Math.max(8, Math.round(tileKm / (o.fibWidKm ?? 0.15)));
      const band = fbm2(bandL, bandW, 3, seed), fib = fbm2(fibL, fibW, 2, seed + 7), bend = fbm(3, 3, seed + 11);
      const f = new Float32Array(S * S), bendA = (o.bendKm ?? 1.5) / tileKm;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S, v = (y + 0.5) / S, vb = v + (bend(u, v) - 0.5) * 2 * bendA;
        const b = band(u, vb), r = 1 - Math.abs(2 * fib(u, vb) - 1);
        const bandMask = Math.min(1, Math.max(0, (b - 0.42) / 0.25));
        f[y * S + x] = bandMask * (0.25 + 0.75 * Math.pow(r, o.fibPow ?? 4));
      }
      return f;
    }
    const ang = (o.windDeg ?? 30) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang), stretch = o.stretch ?? 10;
    const base = fbm(Math.max(8, Math.round(tileKm / (o.fiberKm ?? 0.25))), 3, seed), bend = fbm(4, 3, seed + 9), env = fbm(3, 4, seed + 3);
    const f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      // 늘인 좌표(주기 유지를 위해 원 좌표에서 휨만 주고, 늘이기는 표본을 바람 방향으로 평균)
      const b = (bend(u, v) - 0.5) * 0.15; let s = 0;
      for (let k = -3; k <= 3; k++) { const t = k / 3 * stretch / 400; s += base(u + ca * t - sa * b, v + sa * t + ca * b); }
      s /= 7; const ridge = 1 - Math.abs(2 * s - 1);
      f[y * S + x] = Math.pow(ridge, 3) * Math.min(1, Math.max(0, (env(u, v) - 0.3) * 3));
    }
    return f;
  },
  // 층적운: 닫힌 세포 — 칸 안은 차고 경계에 얇은 틈. 칸 가운데가 더 두껍게.
  sc(S, tileKm, seed, o) {
    const n = Math.max(2, Math.round(tileKm / (o.spacingKm ?? 1.8)));
    const C = cells(n, seed, 0.8), warp = fbm(Math.max(4, n * 2), 3, seed + 21), warp2 = fbm(Math.max(4, n * 2), 3, seed + 23);
    const f = new Float32Array(S * S), wa = (o.warp ?? 0.3) / n, lumps = o.lumps ?? 0, lumpN = fbm(Math.max(8, n * 4), 3, seed + 29), gap = o.gap ?? 0.5;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let u = (x + 0.5) / S, v = (y + 0.5) / S; u += (warp(u, v) - 0.5) * wa; v += (warp2(u, v) - 0.5) * wa;
      const ci = Math.floor(u * n), cj = Math.floor(v * n); let d1 = 9, d2 = 9, s1 = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const p = C.at(ci + di, cj + dj), dx = wrapD(u, p.x), dy = wrapD(v, p.y), d = Math.sqrt(dx * dx + dy * dy) * n;
        if (d < d1) { d2 = d1; d1 = d; s1 = p.s; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1;   // 0 = 경계
      // 칸 안 잔 덩어리(lumps): 칸 지름의 1/4 쯤 되는 혹들 — 매끈한 타일 대신 울퉁불퉁한 덩어리.
      const lump = lumps ? 1 - lumps + lumps * Math.min(1, Math.max(0, (lumpN((x + 0.5) / S, (y + 0.5) / S) - 0.25) * 2)) : 1;
      f[y * S + x] = (0.55 + 0.45 * s1) * Math.min(1, edge / gap) * (1 - 0.35 * Math.min(1, d1)) * lump;
    }
    return f;
  },
  st(S, tileKm, seed) {
    const g = fbm(Math.max(4, Math.round(tileKm / 3)), 4, seed), f = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) f[y * S + x] = 0.7 + 0.3 * g((x + 0.5) / S, (y + 0.5) / S);
    return f;
  },
};

// 종류별 층 모양(셰이더 손잡이) — 두께는 m, 나머지는 층 두께 대비.
export const GENUS = {
  cu: { ao: 0, mode: 0, height: 1500, base: 0.03, top: 1.0, edge: 6, domePow: 0.6, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1 },
  sc: { ao: 0, mode: 0, height: 600, base: 0.06, top: 0.35, edge: 5, domePow: 1, densityScale: 0.2, shapeAmount: 0.8, shapeDetailAmount: 1 },
  st: { ao: 0, mode: 0, height: 400, base: 0.05, top: 0.15, edge: 6, domePow: 1, densityScale: 0.2, shapeAmount: 0.3, shapeDetailAmount: 0.5 },
  ac: { ao: 0, mode: 1, height: 400, base: 0, top: 1.0, edge: 5, domePow: 1, densityScale: 0.2, shapeAmount: 0.5, shapeDetailAmount: 0.7 },
  ci: { ao: 0, mode: 0, height: 800, base: 0.4, top: 0.5, edge: 3, domePow: 1, densityScale: 0.006, shapeAmount: 0.3, shapeDetailAmount: 0.3 },
};

/**
 * 층별 종류·운량 → 날씨 텍스처(RGBA8, S×S). 운량은 "아래에서 본 덮인 면적 비율" — d>0 인 면적이 운량이 되게 문턱을 잡습니다.
 * layers: [{genus, cover, opts}] (최대 4, 채널 순서 r,g,b,a). 종류가 없는 층은 0.
 */
export function makeGenusWeather(layers, S = 1024, tileKm = 24, seed = 7) {
  const data = new Uint8Array(S * S * 4);
  layers.forEach((L, k) => {
    if (!L || !L.genus || !(L.cover > 0)) return;
    const f = FIELDS[L.genus](S, tileKm, seed + k * 1000, L.opts || {});
    const th = L.cover >= 0.999 ? -1 : quantile(f, 1 - L.cover);
    const top = quantile(f, 0.997), pw = (L.opts && L.opts.domePow) ?? GENUS[L.genus].domePow;
    for (let i = 0; i < S * S; i++) {
      const d = f[i] > th ? Math.min(1, Math.max(1 / 255, (f[i] - th) / Math.max(1e-6, top - th))) : 0;
      data[i * 4 + k] = Math.round(Math.pow(d, pw) * 255);
    }
  });
  return data;
}

// 셰이더 패치 — 구름 패스와 그림자 패스 둘 다(같은 clouds.glsl 을 씁니다). GLSL 안에 백틱 없음.
export function patchGenusShader(mat, Vector4) {
  const U = ['genusOn', 'genusMode', 'genusBase', 'genusTop', 'genusEdge', 'genusAO'];
  let src = mat.fragmentShader;
  const decl = 'uniform vec4 coverageFilterWidths;';
  const a = '  vec4 heightScale = shapeAlteringFunction(weather.heightFraction, shapeAlteringBiases);';
  const b = '    factor + coverageFilterWidths\n  );';
  if (!src.includes(decl) || !src.includes(a) || !src.includes(b)) throw new Error('genus patch: anchor missing');
  src = src.replace(decl, decl + '\n' + U.map(u => 'uniform vec4 ' + u + ';').join('\n'));
  src = src.replace(a, a + `
  // C3 종류별 단면: d(날씨) 가 문턱 1 − hs 를 넘는 곳이 구름.
  vec4 gHf = weather.heightFraction;
  vec4 gRamp = smoothstep(vec4(0.0), max(genusBase, vec4(1e-4)), gHf);
  vec4 gDome = gRamp * pow(max(vec4(1.0) - gHf, vec4(1e-6)), genusTop);
  vec4 gLens = vec4(1.0) - pow(max(abs(gHf * 2.0 - 1.0), vec4(1e-6)), max(genusTop, vec4(1e-3)));
  vec4 gHs = mix(gDome, gLens, step(vec4(0.5), genusMode));
  vec4 gDensity = clamp((localWeather - (vec4(1.0) - gHs)) * genusEdge, 0.0, 1.0);
  gDensity *= step(vec4(1.0 / 512.0), localWeather);`);
  src = src.replace(b, b + '\n  weather.density = mix(weather.density, gDensity, genusOn);\n  weather.depth = max(localWeather - (vec4(1.0) - gHs), vec4(0.0));');
  // 하늘빛 가림: 기둥 꼭대기·가장자리에서 안쪽으로 들어간 깊이(층 두께 대비)만큼 하늘빛이 줄어듭니다.
  // 두꺼운 구름의 밑면·그늘 면이 하늘보다 어두워지는 단서입니다. genusAO = 0 이면 takram 그대로.
  const st = 'struct WeatherSample {\n  vec4 heightFraction; // Normalized height of each layer\n  vec4 density;\n};';
  if (!src.includes(st)) throw new Error('genus patch: WeatherSample anchor missing');
  src = src.replace(st, 'struct WeatherSample {\n  vec4 heightFraction;\n  vec4 density;\n  vec4 depth;\n};');
  const sg = 'float skyGradient = dot(weather.heightFraction * 0.5 + 0.5, media.weight);';
  if (src.includes(sg)) src = src.replace(sg, sg + '\n      skyGradient *= dot(mix(vec4(1.0), exp(-genusAO * weather.depth), genusOn), media.weight);');
  // 날씨 좌표: 정육면체 구면 대신 관측점 접평면(동·북, m / 타일 m). 가나자와는 정육면체 모서리 근처라
  // 원래 좌표가 남북·동서로 1.6배 다르게 늘어났습니다(세포가 타원). 화면에 보이는 수십~수백 km 에서 평면 근사로 충분합니다.
  const g = 'vec2 getGlobeUv(const vec3 position) {\n  return getCubeSphereUv(position);\n}';
  if (!src.includes(g)) throw new Error('genus patch: getGlobeUv anchor missing');
  src = src.replace(g, 'uniform vec3 genusOrigin;\nuniform vec3 genusEast;\nuniform vec3 genusNorth;\nuniform float genusTileM;\n' +
    'vec2 getGlobeUv(const vec3 position) {\n  vec3 d = position - genusOrigin;\n  return vec2(dot(d, genusEast), dot(d, genusNorth)) / genusTileM;\n}');
  mat.fragmentShader = src;
  for (const u of U) mat.uniforms[u] = { value: new Vector4() };
  mat.uniforms.genusOrigin = { value: null }; mat.uniforms.genusEast = { value: null }; mat.uniforms.genusNorth = { value: null };
  mat.uniforms.genusTileM = { value: 24000 };
  mat.needsUpdate = true;
}

export function setGenusFrame(mat, origin, east, north, tileM) {
  mat.uniforms.genusOrigin.value = origin.clone(); mat.uniforms.genusEast.value = east.clone().normalize();
  mat.uniforms.genusNorth.value = north.clone().normalize(); mat.uniforms.genusTileM.value = tileM;
}

export function setGenusUniforms(mat, layers) {
  const v = key => layers.map(L => (L && L.genus ? (key === 'on' ? 1 : (L.opts && L.opts[key]) ?? GENUS[L.genus][key]) : 0));
  const set = (u, arr) => mat.uniforms[u].value.set(...[0, 1, 2, 3].map(i => arr[i] ?? 0));
  set('genusOn', v('on')); set('genusMode', v('mode')); set('genusBase', v('base')); set('genusTop', v('top')); set('genusEdge', v('edge')); set('genusAO', v('ao'));
}

// 셰이더의 getCubeSphereUv 를 그대로 옮겨, 관측점에서 텍스처 한 장이 tileKm 이 되도록 반복 수를 구합니다.
export function cubeSphereUv(p) {
  const l = Math.hypot(p.x, p.y, p.z), n = { x: p.x / l, y: p.y / l, z: p.z / l };
  const f = { x: Math.abs(n.x), y: Math.abs(n.y), z: Math.abs(n.z) };
  const mx = Math.max(f.x, f.y, f.z), c = { x: n.x / mx, y: n.y / mx, z: n.z / mx };
  let m;
  if (f.y > f.x && f.y > f.z) m = c.y > 0 ? [-n.x, n.z] : [n.x, n.z];
  else if (f.x > f.y && f.x > f.z) m = c.x > 0 ? [n.y, n.z] : [-n.y, n.z];
  else m = c.z > 0 ? [n.x, n.y] : [n.x, -n.y];
  const m2 = [m[0] * m[0], m[1] * m[1]], q = -2 * m2[0] + 2 * m2[1] - 3, q2 = q * q;
  const ux = Math.sqrt(Math.max(0, 1.5 + m2[0] - m2[1] - 0.5 * Math.sqrt(-24 * m2[0] + q2))) * (m[0] > 0 ? 1 : -1);
  const uy = Math.sqrt(6 / (3 - ux * ux)) * m[1];
  return [ux * 0.5 + 0.5, uy * 0.5 + 0.5];
}
