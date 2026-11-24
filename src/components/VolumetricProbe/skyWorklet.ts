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
const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

/**
 * React Native 진입점(SkyScene3D 등)에서 react-native-worklets 모듈을 등록합니다.
 * VolumetricProbe 내부에 react-native 의존성을 두지 않아 Node/esbuild 하네스 번들링을 깨지 않습니다.
 */
export function registerWorkletModule(mod: WorkletRuntimeMod | null | undefined): void {
  if (!isReactNative || !mod) return;
  if (typeof mod.createWorkletRuntime === 'function' && typeof mod.runOnRuntime === 'function' && typeof mod.scheduleOnRN === 'function') {
    workletMod = mod;
  }
}

function ensureSkyRuntime(): { mod: WorkletRuntimeMod; rt: unknown } | null {
  if (!isReactNative || !workletMod) return null;
  if (skyRuntime) return { mod: workletMod, rt: skyRuntime };
  try {
    skyRuntime = workletMod.createWorkletRuntime({ name: 'sky-compute' });
    return { mod: workletMod, rt: skyRuntime };
  } catch {
    return null;
  }
}

export function computeRawWaveOnWorklet(p: RawWaveWorkletParams): Promise<Float32Array | null> {
  const env = ensureSkyRuntime();
  if (!env) return Promise.resolve(null);

  return new Promise<Float32Array | null>(resolve => {
    let settled = false;
    const finish = (res: Float32Array | null) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    try {
      const { mod, rt } = env;
      const scheduleOnRN = mod.scheduleOnRN;
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
          cb: (out: Float32Array | null) => void,
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
            scheduleOnRN(cb, packed);
          } catch {
            scheduleOnRN(cb, null);
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
    } catch {
      finish(null);
    }
  });
}
