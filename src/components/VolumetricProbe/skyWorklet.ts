/**
 * skyWorklet.ts — react-native-worklets 기반 전용 백그라운드 연산 런타임.
 *
 * 안드로이드 Hermes JS 메인 스레드에서 수백만 번의 삼각함수를 도는 3D 구름 파동장 원시 볼륨 합성을
 * 별도 OS 스레드(WorkletRuntime 'sky-compute')로 분리하여, 계산 중에도 60fps 터치·카메라 조작이
 * 끊기지 않고 안드로이드 big.LITTLE 코어 스케줄링 분산 효과를 얻습니다.
 *
 * 웹 / Node 하네스 환경에서는 자동으로 null 을 반환해 기존 비동기 제너레이터로 폴백합니다.
 */

export interface RawWaveWorkletParams {
  n: number;
  nz: number;
  half: number;
  zb: number;
  zMin: number;
  zMax: number;
  nWarp: number;
  nAll: number;
  wKx: Float64Array;
  wKy: Float64Array;
  wKz: Float64Array;
  wPh: Float64Array;
  wPhWarp: Float64Array;
  wEx: Float64Array;
  wEy: Float64Array;
  wEz: Float64Array;
  wAmp: Float64Array;
}

type WorkletRuntimeMod = {
  createWorkletRuntime: (config: { name: string }) => unknown;
  runOnRuntime: <Args extends unknown[], R>(rt: unknown, fn: (...args: Args) => R) => (...args: Args) => void;
  scheduleOnRN: <Args extends unknown[]>(fn: (...args: Args) => void, ...args: Args) => void;
};

let workletMod: WorkletRuntimeMod | null = null;
let skyRuntime: unknown = null;
const isNodeOrBrowserDom =
  (typeof process !== 'undefined' && Boolean((process as { versions?: { node?: string } }).versions?.node)) ||
  (typeof document !== 'undefined' && typeof window !== 'undefined');

/**
 * React Native 진입점(SkyScene3D 등)에서 react-native-worklets 모듈을 등록합니다.
 * RN 0.73+ / 0.81 Bridgeless 에서는 `navigator.product` 가 제거되었으므로 모듈 함수 시그니처와 비-DOM/Node 여부로 판별합니다.
 * VolumetricProbe 내부에 react-native 의존성을 두지 않아 Node/esbuild 하네스 번들링을 깨지 않습니다.
 */
export function registerWorkletModule(mod: WorkletRuntimeMod | null | undefined): void {
  if (isNodeOrBrowserDom || !mod) return;
  if (typeof mod.createWorkletRuntime === 'function' && typeof mod.runOnRuntime === 'function' && typeof mod.scheduleOnRN === 'function') {
    workletMod = mod;
  }
}

function ensureSkyRuntime(): { mod: WorkletRuntimeMod; rt: unknown } | null {
  if (isNodeOrBrowserDom || !workletMod) return null;
  if (skyRuntime) return { mod: workletMod, rt: skyRuntime };
  try {
    skyRuntime = workletMod.createWorkletRuntime({ name: 'sky-compute' });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[PerfTrace][Worklet] sky-compute runtime created');
    }
    return { mod: workletMod, rt: skyRuntime };
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[PerfTrace][Worklet] sky-compute creation failed:', e);
    }
    return null;
  }
}

const WORKLET_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const WORKLET_B64_REV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[WORKLET_B64.charCodeAt(i)] = i;
  return t;
})();

function decodeBase64ToFloat32(b64: string, expectedFloats: number): Float32Array | null {
  const byteLen = expectedFloats * 4;
  if (!b64 || b64.length < Math.floor((byteLen * 4) / 3)) return null;
  const out = new Uint8Array(byteLen);
  let o = 0;
  const len = b64.length;
  for (let i = 0; i + 1 < len && o < byteLen; i += 4) {
    const a = WORKLET_B64_REV[b64.charCodeAt(i)];
    const b = WORKLET_B64_REV[b64.charCodeAt(i + 1)];
    const c = i + 2 < len ? WORKLET_B64_REV[b64.charCodeAt(i + 2)] : -1;
    const d = i + 3 < len ? WORKLET_B64_REV[b64.charCodeAt(i + 3)] : -1;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out[o++] = (n >> 16) & 255;
    if (c >= 0 && o < byteLen) out[o++] = (n >> 8) & 255;
    if (d >= 0 && o < byteLen) out[o++] = n & 255;
  }
  return o === byteLen ? new Float32Array(out.buffer) : null;
}

export function computeRawWaveOnWorklet(p: RawWaveWorkletParams): Promise<Float32Array | null> {
  const env = ensureSkyRuntime();
  if (!env) return Promise.resolve(null);

  const expectedFloats = p.n * p.n * (p.nz + 1);
  const tStart = typeof __DEV__ !== 'undefined' && __DEV__ ? Date.now() : 0;
  return new Promise<Float32Array | null>(resolve => {
    let settled = false;
    const finish = (b64: string | null, errMsg?: string | null) => {
      if (settled) return;
      settled = true;
      const res = b64 ? decodeBase64ToFloat32(b64, expectedFloats) : null;
      if (tStart > 0) {
        console.log(
          `[PerfTrace][Worklet] computeRawWave(${p.n}x${p.n}x${p.nz}): ${Date.now() - tStart}ms (${res ? 'ok' : `null${errMsg ? ': ' + errMsg : ''}`})`,
        );
      }
      resolve(res);
    };

    try {
      const { mod, rt } = env;
      const scheduleOnRN = mod.scheduleOnRN;
      const b64Chars = WORKLET_B64;
      const run = mod.runOnRuntime(
        rt,
        (
          n: number,
          nz: number,
          half: number,
          zb: number,
          zMin: number,
          zMax: number,
          nWarp: number,
          nAll: number,
          wKx: Float64Array,
          wKy: Float64Array,
          wKz: Float64Array,
          wPh: Float64Array,
          wPhWarp: Float64Array,
          wEx: Float64Array,
          wEy: Float64Array,
          wEz: Float64Array,
          wAmp: Float64Array,
          cb: (outB64: string | null, err?: string | null) => void,
        ) => {
          'worklet';
          try {
            const n2 = n * n;
            const packed = new Float32Array(n2 * (nz + 1));
            const spanXY = 2 * half;
            const dx = spanXY / n;
            const x0 = -half + 0.5 * dx;
            const invN = 1 / n;
            const invNz = 1 / nz;
            const spanZ = zMax - zMin;

            const warpCosD = new Float64Array(nWarp);
            const warpSinD = new Float64Array(nWarp);
            for (let m = 0; m < nWarp; m++) {
              const d = wKx[m] * dx;
              warpCosD[m] = Math.cos(d);
              warpSinD[m] = Math.sin(d);
            }
            const bigCosD = new Float64Array(nAll);
            const bigSinD = new Float64Array(nAll);
            for (let m = 0; m < nAll; m++) {
              const d = wKx[m] * dx;
              bigCosD[m] = Math.cos(d);
              bigSinD[m] = Math.sin(d);
            }
            const wxRow = new Float64Array(n);
            const wyRow = new Float64Array(n);
            const wzRow = new Float64Array(n);
            const fRow = new Float64Array(n);

            const evalRow = (y: number, z: number, dstOff: number) => {
              wxRow.fill(0);
              wyRow.fill(0);
              wzRow.fill(0);
              for (let m = 0; m < nWarp; m++) {
                const ang0 = wKx[m] * x0 + wKy[m] * y + wKz[m] * z + wPhWarp[m];
                let s = Math.sin(ang0);
                let c = Math.cos(ang0);
                const cd = warpCosD[m];
                const sd = warpSinD[m];
                const ex = wEx[m];
                const ey = wEy[m];
                const ez = wEz[m];
                for (let ix = 0; ix < n; ix++) {
                  wxRow[ix] += s * ex;
                  wyRow[ix] += s * ey;
                  wzRow[ix] += s * ez;
                  const ns = s * cd + c * sd;
                  c = c * cd - s * sd;
                  s = ns;
                }
              }
              fRow.fill(0);
              for (let m = 0; m < nAll; m++) {
                const kx = wKx[m];
                const ky = wKy[m];
                const kz = wKz[m];
                const amp = wAmp[m];
                const cd = bigCosD[m];
                const sd = bigSinD[m];
                const p0 = kx * x0 + ky * y + kz * z + wPh[m];
                let c = Math.cos(p0);
                let s = Math.sin(p0);
                for (let ix = 0; ix < n; ix++) {
                  const eps = kx * wxRow[ix] + ky * wyRow[ix] + kz * wzRow[ix];
                  const eps2 = eps * eps;
                  fRow[ix] += amp * ((1 - 0.5 * eps2) * c - eps * (1 - 0.16666667 * eps2) * s);
                  const nc = c * cd - s * sd;
                  s = s * cd + c * sd;
                  c = nc;
                }
              }
              for (let ix = 0; ix < n; ix++) packed[dstOff + ix] = fRow[ix];
            };

            for (let iy = 0; iy < n; iy++) {
              const y = -half + (iy + 0.5) * invN * spanXY;
              evalRow(y, zb, iy * n);
            }
            for (let iz = 0; iz < nz; iz++) {
              const z = zMin + (iz + 0.5) * invNz * spanZ;
              const sliceOff = n2 + iz * n2;
              for (let iy = 0; iy < n; iy++) {
                const y = -half + (iy + 0.5) * invN * spanXY;
                evalRow(y, z, sliceOff + iy * n);
              }
            }
            // react-native-worklets 0.5.1 의 scheduleOnRN(makeShareableCloneOnUIRecursiveLEGACY)은 TypedArray 에
            // Object.entries 를 돌아 예외를 던지므로, 순수 ASCII Base64 문자열(C++ _createSerializableString 경로)로 전송합니다.
            const bytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
            const bLen = bytes.length;
            const parts: string[] = [];
            let chunk = '';
            for (let i = 0; i < bLen; i += 3) {
              const b0 = bytes[i];
              const b1 = i + 1 < bLen ? bytes[i + 1] : 0;
              const b2 = i + 2 < bLen ? bytes[i + 2] : 0;
              const v = (b0 << 16) | (b1 << 8) | b2;
              chunk +=
                b64Chars[(v >> 18) & 63] +
                b64Chars[(v >> 12) & 63] +
                (i + 1 < bLen ? b64Chars[(v >> 6) & 63] : '=') +
                (i + 2 < bLen ? b64Chars[v & 63] : '=');
              if (chunk.length >= 8192) {
                parts.push(chunk);
                chunk = '';
              }
            }
            if (chunk) parts.push(chunk);
            scheduleOnRN(cb, parts.join(''), null);
          } catch (e) {
            scheduleOnRN(cb, null, String((e as Error)?.message ?? e));
          }
        },
      );

      run(
        p.n,
        p.nz,
        p.half,
        p.zb,
        p.zMin,
        p.zMax,
        p.nWarp,
        p.nAll,
        p.wKx,
        p.wKy,
        p.wKz,
        p.wPh,
        p.wPhWarp,
        p.wEx,
        p.wEy,
        p.wEz,
        p.wAmp,
        finish,
      );
    } catch (e) {
      finish(null, String((e as Error)?.message ?? e));
    }
  });
}
