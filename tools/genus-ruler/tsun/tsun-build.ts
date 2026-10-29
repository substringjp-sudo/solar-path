/**
 * §179 T_sun 아틀라스 하네스 구축(WP2 + WP8) — **하네스 전용**. 앱 묶음에는 들어가지 않음(§179 검토 반영 회귀 1, 2026-10-29: 처음 판은
 * volumetricScene.ts 안의 자동 동기 구축(setTsunFixture·tsunAutoBuild)이라 앱 묶음에 LP3 구축기가 실렸음 — 축소 +51 KB [measured, review-regression]).
 *
 * 잡마다 한 번(entry-tsun 이 setScene 뒤에 부름 — 하네스 검토 7: 처음 판은 setOptions 가 앞 잡 장면으로 한 번 더 지어 T 잡마다 두 번 지었음):
 *   tsun 1 · tsunSync true · 글자가 들어감(해 ≤ shadowMinSunDeg) · 고정표 있음 · 종류 평면 틀 있음 → vol.tsunBuildInput() → tsunLawsFromFixture →
 *   buildTsunAtlasData → makeTsunAtlas(장면 번호) → vol.setTsunAtlas. 짓지 않으면 이유를 돌려줌(entry 가 T 팔이면 throw — 아틀라스 없는 T 팔 = C0ps 빛).
 * 텍스처는 부른 쪽(entry) 소유 — 다음 잡 시작에 setTsunAtlas(null) 뒤 dispose(dropTsunAtlas).
 */
import type { Texture } from 'three';
import type { VolumetricScene } from '../../../src/components/VolumetricProbe/volumetricScene';
import { buildTsunAtlasData, makeTsunAtlas, tsunLawsFromFixture } from '../../../src/components/VolumetricProbe/tsunAtlas';
import type { TsunFixture } from '../../../src/components/VolumetricProbe/tsunFixture';

/** 하네스 구축 상태(페이지마다 하나) — meta.tsun.builds·buildReason 로. */
export interface TsunBuildState { builds: number; reason: string | null; texture: Texture | null; lastSha: string | null }
export const newTsunBuildState = (): TsunBuildState => ({ builds: 0, reason: null, texture: null, lastSha: null });

/** 앞 잡의 아틀라스를 풀고 텍스처를 버림(잡 시작마다 — 옵션을 바꾸기 전에). */
export function dropTsunAtlas(vol: Pick<VolumetricScene, 'setTsunAtlas'>, st: TsunBuildState): void {
  vol.setTsunAtlas(null);
  if (st.texture) { st.texture.dispose(); st.texture = null; }
}

/**
 * 지금 장면에 아틀라스를 짓고 겁니다(잡마다 한 번, 동기). 돌려줌: 지었으면 true. 짓지 않은 이유는 st.reason.
 * o = 잡 옵션(tsun·tsunSync). fx = WP1 고정표(sha 는 부른 쪽이 확인).
 */
export function buildTsunAtlasForJob(vol: Pick<VolumetricScene, 'setTsunAtlas' | 'tsunInfo' | 'tsunBuildInput' | 'tsunSceneSerial'>, fx: TsunFixture | null, o: { tsun?: unknown; tsunSync?: unknown }, st: TsunBuildState): boolean {
  st.reason = null;
  if (o.tsun !== 1) { st.reason = 'tsun 0'; return false; }
  if (o.tsunSync !== true) { st.reason = 'tsunSync false (no scheduler — atlas must come from setTsunAtlas)'; return false; }
  const info = vol.tsunInfo();
  if (!info.injected) { st.reason = info.belowShadow === null ? 'no scene' : 'sun above shadowMinSunDeg (no T text)'; return false; }
  if (!fx) { st.reason = 'no fixture'; return false; }
  const input = vol.tsunBuildInput();
  if (!input) { st.reason = 'no genus planar frame'; return false; }
  const { laws, warnings } = tsunLawsFromFixture(fx, input);
  input.warnings = [...(input.warnings ?? []), ...warnings];
  const data = buildTsunAtlasData(input, laws, { fixtureSha: fx.header.binSha256 });
  const atlas = makeTsunAtlas(data, vol.tsunSceneSerial());
  vol.setTsunAtlas(atlas);   // 옵션·장면과 안 맞으면 throw(구축기 버그)
  if (st.texture && st.texture !== atlas.texture) st.texture.dispose();
  st.texture = atlas.texture;
  st.builds++;
  st.lastSha = data.sha;
  return true;
}
