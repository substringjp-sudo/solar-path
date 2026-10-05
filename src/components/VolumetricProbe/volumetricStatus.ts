/**
 * volumetricStatus.ts — 하늘 화면 볼륨 하늘(§126.7)의 상태를 개발자 패널에 보여 주는 작은 저장소.
 *
 * 볼륨 하늘은 만들다 실패하면 기존 하늘로 조용히 돌아갑니다. 폰에서는 콘솔을 볼 수 없어서, 상태와 실패 이유를
 * 여기에 적고 패널이 읽습니다. takram 을 불러오지 않으므로 출시 번들에 들어가도 가볍습니다.
 */
export type VolumetricPhase = 'off' | 'creating' | 'running' | 'failed';

export interface VolumetricStatus {
  phase: VolumetricPhase;
  /** 생성을 시작한 시각(ms) — 준비 중 경과 시간 표시용 */
  sinceMs: number;
  /** 실패 이유 */
  error: string | null;
  /** 마지막 프레임의 장면 요약(예보 종류 등) */
  summary: string | null;
}

let status: VolumetricStatus = { phase: 'off', sinceMs: 0, error: null, summary: null };
const listeners = new Set<(s: VolumetricStatus) => void>();

export function getVolumetricStatus(): VolumetricStatus {
  return status;
}

export function setVolumetricStatus(patch: Partial<VolumetricStatus>): void {
  const next = { ...status, ...patch };
  if (next.phase === status.phase && next.error === status.error && next.summary === status.summary && next.sinceMs === status.sinceMs) return;
  status = next;
  listeners.forEach(l => l(status));
}

export function subscribeVolumetricStatus(l: (s: VolumetricStatus) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
