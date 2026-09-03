/**
 * **한 화면 안에서 운형이 갈리는가** (docs/CLOUD_VARIETY_PLAN.md 2단계).
 *
 * ## 무엇이 달라졌나
 *
 * 2단계 이전에는 덱이 층마다 스칼라 하나만 받았습니다 — τ·그늘·조각크기·
 * 조각세기 전부. 그래서 방향마다 다른 것은 **운량뿐**이었습니다. 왼쪽이
 * 20%, 오른쪽이 90%면 "같은 구름이 더 많이 있다"이지 "다른 구름"이 아닙니다.
 *
 * 실제 대기는 그렇지 않습니다. 중층 운량 20%는 고적운(양떼구름 — 알갱이가
 * 또렷하고 사이로 하늘이 보임)이고, 90%는 고층운(차일구름 — 요소가 없는
 * 균질한 판)입니다. WMO 분류가 곧 그 차이입니다.
 *
 * ## 어떻게 재나
 *
 * 서쪽 중층 20% · 동쪽 90%인 링을 만들고 **그 경계를 정면으로** 봅니다.
 * 같은 프레임에서 왼쪽 1/3과 오른쪽 1/3을 각각 잽니다.
 *
 *  - **밝기**: τ 차이 (고적운 16 → 고층운 30)
 *  - **알파 결(RMS)**: 조각 세기 차이. 조각형은 알파가 0/1로 갈려 분산이
 *    크고, 층상형은 운량이 그대로 알파라 분산이 작습니다. 밝기 RMS로는
 *    이걸 못 잽니다 — 층상운도 두께 얼룩(thickVar)으로 밝기가 흔들리기
 *    때문입니다 (실측: 고층운 결 10.2 vs 고적운 9.7, 거의 같음).
 *
 * 왼쪽 패널이 2단계 이전(층 대표 스칼라), 오른쪽이 2단계(방향별)입니다.
 * **같은 링·같은 카메라·같은 태양**이라 차이는 오직 운형 배분에서 옵니다.
 *
 * 준비: node tools/shader-preview/stage-esm.js
 * 사용: node tools/shader-preview/build-genus-split-preview.js
 *       node tools/shader-preview/verify-genus-split.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');

const VIEW_AZ = 0, VIEW_ELEV = 24, FOV_DEG = 62;
const TW = 520, TH = 420;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#12171c;font-family:sans-serif;color:#dde}
 #wrap{position:relative;width:${TW * 2 + 24}px;padding:12px}
 .lbl{position:absolute;color:#fff;font-size:12px;font-family:monospace;
   text-shadow:0 1px 3px #000;pointer-events:none;line-height:1.4}
 h3{font-size:13px;margin:8px 0}
</style></head><body>
<div id="wrap"><h3>중층 서쪽 20% / 동쪽 90% — 왼쪽: 층 대표 스칼라(2단계 이전) &nbsp;|&nbsp; 오른쪽: 방향별 운형(2단계)</h3>
<canvas id="c"></canvas><div id="labels"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { createCloudDeck, updateCloudDeck } from './app/components/SkyScene3D/CloudDeck.js';
import { PRESET_OPTICS, resolvePresetFromWeather, blendedOpticsFromWeather } from './app/utils/cloudPresets.js';
import { WeatherFan, buildSkyColumns,
         PLACEHOLDER_WIND_SPEED_KMH, PLACEHOLDER_WIND_BEARING_DEG }
  from './app/utils/skyColumn.js';

const errors = [];
const oe = console.error;
console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };

const VIEW_AZ=${VIEW_AZ}, VIEW_ELEV=${VIEW_ELEV}, FOV_DEG=${FOV_DEG};
const TW=${TW}, TH=${TH};

const canvas = document.getElementById('c');
canvas.width = TW*4; canvas.height = TH;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:false });
renderer.setPixelRatio(1);
renderer.setSize(TW*4, TH, false);

const deck = createCloudDeck({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const scene = new THREE.Scene();
scene.add(deck.group);

const RING_AZ = [0,30,60,90,120,150,180,-150,-120,-90,-60,-30];
const RING_D  = [10,30,70,130,200,280,380];
// 방위 0°을 경계로 동쪽(0~180)이 90%, 서쪽이 20%.
function splitRing() {
  const out = [{ distance:0, azimuthOffset:0, low:0, mid:55, high:0 }];
  for (const az of RING_AZ) for (const d of RING_D) {
    const a = (az+360)%360;
    const east = a > 0 && a < 180;
    out.push({ distance:d, azimuthOffset:az, low:0, high:0, mid: east ? 90 : 20 });
  }
  return out;
}
const samples = buildSkyColumns({
  fan: new WeatherFan(splitRing(), 0),
  driftMinutes: 0,
  windSpeedKmh: PLACEHOLDER_WIND_SPEED_KMH,
  windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
});

const SUN_ALT = 16, SUN_AZ = 300;
const beam = { r: 1.50, g: 1.14, b: 0.78 };
const ambUp = { r: 0.42, g: 0.52, b: 0.78 };
const ambDown = { r: 0.50, g: 0.47, b: 0.52 };
const sA = SUN_ALT*Math.PI/180, sZ = SUN_AZ*Math.PI/180;
const sunDir = new THREE.Vector3(
  Math.cos(sA)*Math.sin(sZ), Math.sin(sA), -Math.cos(sA)*Math.cos(sZ)).normalize();

const cam = new THREE.PerspectiveCamera(FOV_DEG, TW/TH, 0.1, 2000);
cam.position.set(0,0,0); cam.up.set(0,1,0);
const ar = VIEW_AZ*Math.PI/180, er = VIEW_ELEV*Math.PI/180;
cam.lookAt(100*Math.cos(er)*Math.sin(ar), 100*Math.sin(er), -100*Math.cos(er)*Math.cos(ar));
cam.updateMatrixWorld(true);

const gl = renderer.getContext();
const labels = document.getElementById('labels');

// 관측점 중층 55% → 층 대표는 고적운. 2단계 이전 경로가 쓰던 값입니다.
const 층대표 = PRESET_OPTICS.Altocumulus;
const wx = { precipitation: 0, humidity: 60, lowPct: 0, highPct: 0 };

function shoot(label, x, genusFor) {
  updateCloudDeck(deck, {
    samples,
    beamFor: () => beam,
    ambientFor: () => ({ up: ambUp, down: ambDown }),
    sunDir, sunAltDeg: SUN_ALT,
    tauFor: () => 층대표.tau,
    shadowFor: () => 층대표.shadowContrast,
    cellFor: () => 층대표,
    genusFor,
    pixelAngleRad: (FOV_DEG*Math.PI/180)/TH,
    windBearingDeg: PLACEHOLDER_WIND_BEARING_DEG,
    betaMie: 0.08, angstrom: 1.3, elevScale: 1.0,
    timeSeconds: 0, visible: true,
  });

  const grab = (bg) => {
    renderer.setClearColor(bg,1);
    renderer.setViewport(x,0,TW,TH);
    renderer.setScissor(x,0,TW,TH);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.render(scene, cam);
    const b = new Uint8Array(4*TW*TH);
    gl.readPixels(x,0,TW,TH,gl.RGBA,gl.UNSIGNED_BYTE,b);
    return b;
  };
  const kb = grab(0x000000), kw = grab(0xffffff);

  // 바깥 1/4씩만 잽니다. 경계 근처는 192방향 격자 보간이 두 운형을 섞는
  // **전이 띠**라 어느 쪽으로도 셀 수 없습니다 (격자가 15° 간격이므로
  // 경계에서 ±15°가 섞입니다).
  const quarter = Math.floor(TW/4);
  const band = (x0,x1) => {
    let n=0, sumL=0, sumL2=0, sumA=0, sumA2=0, nA=0, mid=0;
    // ⚠ 세로도 잘라야 합니다. 화면 아래쪽은 덱을 **스침각**으로 보는
    // 구간이라 조각이 화소보다 작아지며 얼룩집니다 — 운형과 무관한 현상이고,
    // 여기를 포함하면 "층상형이 균질한가"를 묻는 지표가 그 얼룩을 셉니다.
    // 실제로 하늘 전체를 고층운(cellStrength=0)으로 채워도 오른쪽 이항성이
    // 0.726 이 나왔는데, 그림을 보니 위쪽은 제대로 균질한 판이었습니다.
    for (let py=Math.floor(TH*0.45); py<TH; py++) {
      for (let px=x0; px<x1; px++) {
        const p = py*TW+px;
        const a = Math.max(0, Math.min(1, 1 - (kw[p*4+1]-kb[p*4+1])/255));
        sumA += a; sumA2 += a*a; nA++;
        // ── 조각이 얼마나 또렷한가 ─────────────────────────────────────
        //
        // 조각형(cellStrength ≈ 1)은 알파가 문턱으로 잘려 **0 아니면 1**에
        // 몰리고, 층상형(0)은 운량이 그대로 알파라 전부 중간값입니다.
        // 그래서 "중간 알파의 비율"이 조각 세기를 직접 읽습니다.
        //
        // ⚠ 알파의 표준편차로는 안 됩니다 — 이항 분포의 분산은 운량 0.5에서
        // 최대라, 조각이 또렷할수록 커야 할 값이 운량에 휘둘립니다
        // (실측: 층상 0.61에서 0.372, 조각 0.21에서 0.335 — 순서가 뒤집힘).
        if (a > 0.15 && a < 0.85) mid++;
        if (a < 0.5) continue;
        const r = kb[p*4]/a, g = kb[p*4+1]/a, bl = kb[p*4+2]/a;
        const L = 0.2126*r + 0.7152*g + 0.0722*bl;
        sumL += L; sumL2 += L*L; n++;
      }
    }
    const mA = sumA/nA;
    // ── 이항성 — 운량과 무관한 "조각 세기" ────────────────────────────
    //
    // 알파가 0/1 로 몰릴수록(조각형) 분산은 이항분포의 최대치 p(1-p) 에
    // 다가가고, 운량이 그대로 알파면(층상형) 분산은 0 에 가깝습니다.
    // **p(1-p) 로 나누면 운량 의존이 정확히 사라집니다.**
    //
    // 중간알파(0.15~0.85 비율)로는 안 됩니다. 층상형 쪽 운량이 90% 면
    // 완벽한 균질 판의 알파가 0.90 이라 그 밴드 **밖**입니다 — 잘 그릴수록
    // 지표가 낮아집니다. 앞서 표준편차를 버리고 중간알파로 옮긴 것도
    // 정규화를 안 한 채로 옮긴 것이라 같은 병을 옮겨 심은 셈이었습니다.
    const varA = Math.max(0, sumA2/nA - mA*mA);
    const binMax = Math.max(1e-4, mA*(1-mA));
    const mL = n ? sumL/n : 0;
    return {
      운량: +mA.toFixed(4),
      중간알파: +(mid/nA).toFixed(4),
      이항성: +(varA/binMax).toFixed(4),
      밝기: +mL.toFixed(1),
      밝기결: +(n ? Math.sqrt(Math.max(0, sumL2/n - mL*mL)) : 0).toFixed(2),
    };
  };
  const 왼쪽 = band(0, quarter);
  const 오른쪽 = band(TW-quarter, TW);

  renderer.setClearColor(0x1d4f77,1);
  renderer.setViewport(x,0,TW,TH);
  renderer.setScissor(x,0,TW,TH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, cam);

  const d = document.createElement('div');
  d.className='lbl';
  d.style.left=(x+10+12)+'px'; d.style.top='34px';
  d.innerHTML = label +
    '<br>왼(서 20%)  밝기 ' + 왼쪽.밝기 + '  중간알파 ' + (왼쪽.중간알파*100).toFixed(1) + '%  운량 ' + (왼쪽.운량*100).toFixed(0) + '%' +
    '<br>오른(동 90%) 밝기 ' + 오른쪽.밝기 + '  중간알파 ' + (오른쪽.중간알파*100).toFixed(1) + '%  운량 ' + (오른쪽.운량*100).toFixed(0) + '%' +
    '<br>밝기차 ' + (왼쪽.밝기-오른쪽.밝기).toFixed(1) +
    '   중간알파차 ' + ((오른쪽.중간알파-왼쪽.중간알파)*100).toFixed(1) + '%p' +
    '<br>이항성 왼 ' + 왼쪽.이항성 + '  오른 ' + 오른쪽.이항성;
  labels.appendChild(d);
  return { 왼쪽, 오른쪽 };
}

const 이전 = shoot('층 대표 스칼라 (2단계 이전)', 0, undefined);
const 방향별 = shoot('방향별 운형 (2단계)', TW,
  (layer, at) => blendedOpticsFromWeather(layer, at.cover, wx, 0.5));

// ── 진단: 하늘 전체를 한 운형으로만 채워 봅니다 ──────────────────────────
//
// 갈린 화면에서 조각형 쪽 이항성이 0.816 → 0.529 로 **떨어지고** 층상형 쪽은
// 0.917 → 0.732 로 덜 떨어졌습니다. 양쪽 다 중간으로 뭉개진 모양이라,
// 원인이 (가) 셰이더가 cellStrength 를 안 듣는 것인지 (나) 정점 속성 보간이
// 두 운형을 섞는 것인지 갈라야 합니다. 하늘 전체를 한 운형으로 채우면
// 섞일 상대가 없으므로, 그래도 안 갈리면 (가)입니다.
const 모두조각 = shoot('진단: 전부 고적운', TW*2, () => PRESET_OPTICS.Altocumulus);
const 모두층상 = shoot('진단: 전부 고층운', TW*3, () => PRESET_OPTICS.Altostratus);


// 이 링에서 방향별 판정이 실제로 어떤 운형을 얼마나 골랐는가.
// 렌더가 아니라 판정 자체를 세는 것이라, 화면에서 본 차이의 **원인**입니다.
const 운형표 = {};
for (const c of [0.20, 0.55, 0.90]) 운형표[c] = resolvePresetFromWeather('mid', c, wx, 0.5);

const midS = samples.filter(s => s.layer === 'mid');
const 분포 = {};
let tMin = 1e9, tMax = -1e9;
for (const s of midS) {
  const n = resolvePresetFromWeather('mid', s.cover, wx, 0.5);
  분포[n] = (분포[n] || 0) + 1;
  const t = PRESET_OPTICS[n].tau;
  if (t < tMin) tMin = t;
  if (t > tMax) tMax = t;
}
const 운형분포 = { 방향수: midS.length, 분포, τ최소: tMin, τ최대: tMax };

const glErr = gl.getError();
window.__stats = { glError: glErr, 이전, 방향별, 모두조각, 모두층상, 운형표, 운형분포 };
window.__errors = errors;
document.title = 'DONE::' + (errors.length?'SHADER_ERR':'OK') + '::' + glErr;
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'genus-split.html'), html);
console.log('생성 완료: genus-split.html');
