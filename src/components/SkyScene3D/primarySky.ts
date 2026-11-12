/**
 * primarySky.ts — 하늘 화면의 3D 하늘(SkyScene3D, registerPrimary)을 다른 화면이 빌려 쓰는 자리(2026-11-13).
 *
 * 촬영 화면은 예전에 자기 3D 하늘을 하나 더 만들었습니다. 대기 표 계산·구름 생성을 처음부터 다시 하고, 카메라 미리보기와
 * GPU 를 나눠 써서 몹시 끊겼고, 구름이 준비되기 전이라 "3D 준비 중" 만 떴습니다. 이제 이미 준비된 하늘 화면의 장면에
 * 카메라의 방위·고도·화각을 잠깐 걸어 한 장 그려 받습니다(SkyScene3DHandle.renderRemote).
 */
import type { SkyScene3DHandle } from './SkyScene3D';

let primary: SkyScene3DHandle | null = null;
export function setPrimarySky(h: SkyScene3DHandle | null): void { primary = h; }
export function getPrimarySky(): SkyScene3DHandle | null { return primary; }
