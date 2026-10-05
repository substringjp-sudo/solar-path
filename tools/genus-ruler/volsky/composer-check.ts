/**
 * §127 합성기 판정 — 볼륨 하늘(밖에서 그린 하늘 텍스처, 알파 = 구름 불투명도)을 깔았을 때
 *  (1) 천체가 구름 투과율만큼만 남는가, (2) 지형 화소에만 지형 앞 구름이 다시 얹히는가, (3) 하늘 화소는 그대로인가.
 * 장면을 손으로 만듭니다: 화면 왼쪽 절반 = 불투명 구름(알파 1), 오른쪽 = 맑음(알파 0), 가운데 띠 = 알파 0.5.
 * 아래 1/3 = 지형(갈색, 거리 판 3km). 천체 = 화면 전체를 덮는 흰 판(더하기).
 * 저해상도 경로(배율 2)와 한 번에 그리기(배율 1) 둘 다 잽니다.
 */
import * as THREE from 'three';
import { createSceneComposer, assignLayer, LAYER_CELESTIAL, LAYER_MID, LAYER_TERRAIN_DIST, TERRAIN_DIST_GLSL } from '../../../src/components/SkyScene3D/SceneComposer';

const W = 64, H = 48;
const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

// 밖의 하늘(선형 색 — 합성기가 sRGB 로 부호화): rgb = (0.2, 0.4, 0.8) 하늘에 구름 (0.9,0.9,0.9)·알파.
// 지형 화소는 하늘을 검게 비운 "지형 앞 구름"만.
const ext = new Uint8Array(W * H * 4);
const alphaAt = (x: number) => (x < W * 0.4 ? 1 : x < W * 0.6 ? 0.5 : 0);
const terrainRow = Math.floor(H / 3);   // 텍스처 v 는 아래가 0 — 아래 1/3 이 지형
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = alphaAt(x), terr = y < terrainRow, i = (y * W + x) * 4;
  const sky = terr ? [0, 0, 0] : [0.2, 0.4, 0.8];
  const c = [0, 1, 2].map(k => sky[k] * (1 - a) + 0.9 * a);
  ext[i] = Math.round(c[0] * 255); ext[i + 1] = Math.round(c[1] * 255); ext[i + 2] = Math.round(c[2] * 255); ext[i + 3] = Math.round(a * 255);
}
const extTex = new THREE.DataTexture(ext, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
extTex.needsUpdate = true;

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 1;
// 천체: 화면 전체를 덮는 흰 판, 더하기(별·해처럼).
const star = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x404040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
assignLayer(star, LAYER_CELESTIAL); scene.add(star);
// 지형: 아래 1/3, 갈색 불투명 + 거리 판 쌍둥이(3km).
const tg = new THREE.PlaneGeometry(2, 2 / 3); tg.translate(0, -1 + 1 / 3, 0);
const terr = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0x804020 }));
assignLayer(terr, LAYER_MID); scene.add(terr);
const twin = new THREE.Mesh(tg, new THREE.ShaderMaterial({ vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: TERRAIN_DIST_GLSL + 'void main(){ gl_FragColor = terrainDistEncode(3.0); }' }));
assignLayer(twin, LAYER_TERRAIN_DIST); scene.add(twin);

const results: Record<string, unknown> = {};
for (const scale of [2, 1]) {
  const comp = createSceneComposer(W, H, scale, { strength: 0, threshold: 1, knee: 0.1, scale: 4 } as never, { strength: 0 } as never, 0);
  comp.setTerrainDistance(true);
  comp.setExternalSky(extTex);
  comp.prepareTerrainDistance(renderer, scene, cam);
  comp.render(renderer, scene, cam);
  const px = new Uint8Array(W * H * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const at = (fx: number, fy: number) => { const x = Math.floor(fx * W), y = Math.floor(fy * H), i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const enc = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
  const ext3 = (sky: number[], a: number) => [0, 1, 2].map(k => enc(Math.round((sky[k] * (1 - a) + 0.9 * a) * 255) / 255));
  const star = 13;   // 0x404040 (sRGB) → 선형 0.051 → 출력 선형 공간에서 약 13
  const brown = [55, 13, 4];
  const close = (got: number[], want: number[]) => got.every((g, k) => Math.abs(g - want[k]) <= 3);
  const sky = [0.2, 0.4, 0.8], black = [0, 0, 0];
  const exp = {
    skyCloud: ext3(sky, 1),
    skyHalf: ext3(sky, 0.5).map(v => v + star * 0.5),
    skyClear: ext3(sky, 0).map(v => v + star),
    terrCloud: ext3(black, 1),
    terrHalf: ext3(black, 0.5).map((v, k) => v + brown[k] * 0.5),
    terrClear: brown,
  };
  const got = {
    skyCloud: at(0.2, 0.8),     // 하늘·불투명 구름: 천체 없이 구름(230,230,230)
    skyHalf: at(0.5, 0.8),      // 하늘·반투명: 구름 섞인 하늘 + 천체의 절반(64·0.5)
    skyClear: at(0.8, 0.8),     // 하늘·맑음: 하늘(51,102,204) + 천체(64)
    terrCloud: at(0.2, 0.15),   // 지형·앞 구름 불투명: 구름(230)
    terrHalf: at(0.5, 0.15),    // 지형·앞 구름 반: 구름 0.45 + 갈색 0.5
    terrClear: at(0.8, 0.15),   // 지형·맑음: 갈색(128,64,32)
  };
  results['scale' + scale] = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { got: v, want: exp[k as keyof typeof exp].map(Math.round), ok: close(v, exp[k as keyof typeof exp]) }]));
  comp.dispose();
}
(window as unknown as Record<string, unknown>).__result = results;
document.title = 'DONE';
