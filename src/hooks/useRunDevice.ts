/**
 * useRunDevice.ts — 타임랩스를 찍는 동안: 화면이 꺼지지 않게 하고, 배터리를 30 초마다 읽고, "화면 끄고 계속"일 때 화면을 어둡게 합니다.
 * 끝나면(running 거짓) 모두 되돌립니다. 부품이 없으면 조용히 건너뜁니다(`utils/runDevice.ts`).
 */
import { useEffect, useState } from 'react';
import { readBattery, setKeepAwake, setScreenDim, type BatteryStatus } from '../utils/runDevice';

export const BATTERY_POLL_MS = 30_000;

export function useRunDevice(running: boolean, screenOff: boolean): BatteryStatus | null {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    if (!running) return undefined;
    void setKeepAwake(true);
    let alive = true;
    const tick = () => { void readBattery().then(b => { if (alive) setBattery(b); }); };
    tick();
    const id = setInterval(tick, BATTERY_POLL_MS);
    return () => { alive = false; clearInterval(id); void setKeepAwake(false); };
  }, [running]);
  useEffect(() => {
    if (!running || !screenOff) return undefined;
    void setScreenDim(true);
    return () => { void setScreenDim(false); };
  }, [running, screenOff]);
  return battery;
}
