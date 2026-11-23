/**
 * runDevice.ts — 촬영 중 기기 상태 이음새(배터리 · 화면 켜 두기 · 화면 어둡게). 네이티브 부품이라 **없으면 조용히 건너뜁니다**
 * (expo-blur 와 같은 안전한 require — 새 네이티브 모듈이 아직 설치되지 않은 개발 빌드에서도 앱이 죽지 않음). 판정할 계산은 없고 `runCurve.batteryLine` 이 글을 만듭니다.
 *
 * 기기 온도는 Expo 가 주는 API 가 없어 다루지 않습니다.
 */
type BatteryMod = {
  getBatteryLevelAsync: () => Promise<number>;
  getBatteryStateAsync: () => Promise<number>;
  isLowPowerModeEnabledAsync: () => Promise<boolean>;
  BatteryState?: { CHARGING?: number; FULL?: number };
};
type AwakeMod = { activateKeepAwakeAsync: (tag?: string) => Promise<void>; deactivateKeepAwake: (tag?: string) => Promise<void> };
type BrightMod = { setBrightnessAsync: (v: number) => Promise<void>; restoreSystemBrightnessAsync?: () => Promise<void>; getBrightnessAsync?: () => Promise<number> };

let battery: BatteryMod | null = null;
let awake: AwakeMod | null = null;
let bright: BrightMod | null = null;
try { battery = require('expo-battery'); } catch { battery = null; }
try { awake = require('expo-keep-awake'); } catch { awake = null; }
try { bright = require('expo-brightness'); } catch { bright = null; }

export interface BatteryStatus { level: number | null; charging: boolean; lowPower: boolean }

/** 지금 배터리. 부품이 없거나 읽지 못하면 null. */
export async function readBattery(): Promise<BatteryStatus | null> {
  if (!battery) return null;
  try {
    const [level, state, lowPower] = await Promise.all([battery.getBatteryLevelAsync(), battery.getBatteryStateAsync(), battery.isLowPowerModeEnabledAsync().catch(() => false)]);
    const S = battery.BatteryState;
    const charging = !!S && (state === S.CHARGING || state === S.FULL);
    return { level: typeof level === 'number' && level >= 0 ? level : null, charging, lowPower };
  } catch {
    return null;
  }
}

const KEEP_AWAKE_TAG = 'timelapse-run';

/** 화면이 꺼지지 않게 합니다(찍는 동안). 부품이 없으면 false. */
export async function setKeepAwake(on: boolean): Promise<boolean> {
  if (!awake) return false;
  try {
    if (on) await awake.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    else await awake.deactivateKeepAwake(KEEP_AWAKE_TAG);
    return true;
  } catch {
    return false;
  }
}

/** 화면 밝기를 최저로(켜면) · 되돌림(끄면). 부품이 없으면 false(검은 덮개만 남음). */
export async function setScreenDim(on: boolean): Promise<boolean> {
  if (!bright) return false;
  try {
    if (on) await bright.setBrightnessAsync(0);
    else if (bright.restoreSystemBrightnessAsync) await bright.restoreSystemBrightnessAsync();
    return true;
  } catch {
    return false;
  }
}
