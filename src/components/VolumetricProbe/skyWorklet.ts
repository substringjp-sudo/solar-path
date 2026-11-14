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
  mix3d: number;
  kappa: number;
  eK: number;
  sK: number;
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
          mix3d: number,
          kappa: number,
          eK: number,
          sK: number,
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
            const fbig = (x: number, y: number, z: number): number => {
              let wx = 0;
              let wy = 0;
              let wz = 0;
              for (let m = 0; m < nWarp; m++) {
                const s = Math.sin(wKx[m] * x + wKy[m] * y + wKz[m] * z + wPhWarp[m]);
                wx += s * wEx[m];
                wy += s * wEy[m];
                wz += s * wEz[m];
              }
              const X = x + wx;
              const Y = y + wy;
              const Z = z + wz;
              let f = 0;
              for (let m = 0; m < nAll; m++) {
                f += wAmp[m] * Math.cos(wKx[m] * X + wKy[m] * Y + wKz[m] * Z + wPh[m]);
              }
              return f;
            };
            const skew = (f: number): number => (kappa < 1e-3 ? f : (Math.exp(kappa * f) - eK) / sK);
            const n2 = n * n;
            const vox = new Float32Array(n2 * nz);
            const base2 = new Float32Array(n2);
            const spanXY = 2 * half;
            const invN = 1 / n;
            const invNz = 1 / nz;
            const spanZ = zMax - zMin;

            for (let iy = 0; iy < n; iy++) {
              const y = -half + (iy + 0.5) * invN * spanXY;
              const rowOff = iy * n;
              for (let ix = 0; ix < n; ix++) {
                const x = -half + (ix + 0.5) * invN * spanXY;
                base2[rowOff + ix] = skew(fbig(x, y, zb));
              }
            }
            for (let iz = 0; iz < nz; iz++) {
              const z = zMin + (iz + 0.5) * invNz * spanZ;
              const sliceOff = iz * n2;
              for (let iy = 0; iy < n; iy++) {
                const y = -half + (iy + 0.5) * invN * spanXY;
                const rowOff = iy * n;
                const dstRow = sliceOff + rowOff;
                for (let ix = 0; ix < n; ix++) {
                  const x = -half + (ix + 0.5) * invN * spanXY;
                  const g2 = base2[rowOff + ix];
                  const val3 = skew(fbig(x, y, z));
                  vox[dstRow + ix] = mix3d >= 1 ? val3 : g2 + mix3d * (val3 - g2);
                }
              }
            }
            scheduleOnRN(cb, vox);
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
        p.mix3d,
        p.kappa,
        p.eK,
        p.sK,
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
