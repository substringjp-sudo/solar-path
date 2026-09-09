/**
 * **눈이 메시 원점에 있는가** (사용자 물음에서 나옴: "카메라를 지표면 위에
 * 올리면 되는 거 아니야?").
 *
 * ## 이 격자는 실좌표가 아니라 **각도**입니다
 *
 * `gp_project` 는 정점을 "눈에서 본 진짜 고도각"으로 반지름 r 의 구면에
 * 놓습니다. 그 각의 기준점은 **메시 원점**입니다. 그러니 화면에 그 각이
 * 그대로 나오려면 카메라가 원점에 있어야 합니다.
 *
 * 그런데 앱은 카메라를 `groundY + 1.6` 에 두고 메시를 `y = 0` 에 뒀습니다.
 * "카메라 Y 는 실제 미터가 아니라 옛 원반용 dip 트릭 값이니 따라가지
 * 않는다" 는 이유였는데, 트릭 값이든 아니든 **시차는 생깁니다.**
 *
 * ## 재는 법 — 카메라 높이만 바꿔 하늘금을 견줍니다
 *
 * 시선 방향은 그대로 두고 눈만 올렸다 내립니다. 지형이 각도로 놓여 있다면
 * 화면은 **한 화소도** 안 변해야 합니다. 변한다면 그만큼이 어긋남입니다.
 *
 * ⚠ 처음에 발밑을 내려다보며 "가장 위 불투명 화소"로 쟀더니 0 이 나왔습니다
 * — 화면이 통째로 땅이라 자가 포화한 것이지 차이가 없어서가 아닙니다.
 * 발밑은 **격자 안쪽 구멍의 각반경**으로 따로 잽니다.
 *
 * ⚠ 다른 하네스가 이걸 못 잡은 이유는 거의 모두 카메라를 (0,0,0) 에 두기
 * 때문입니다. 여기서는 일부러 높이를 바꿉니다.
 *
 * 사용: node tools/shader-preview/build-eye-origin.js
 *       node tools/shader-preview/verify-eye-origin.js
 */
const fs = require('fs');
const path = require('path');
const { PREVIEW } = require('./paths');
const LIGHT = require('./app-lighting').appLighting(25, 135);

const BLOCK = 3, FIELD_FAR_M = 3000, MASK_RADIUS_M = 60000, EYE_M = 1.6;
/**
 * 카메라 높이 — 앱이 실제로 쓰는 값입니다.
 * `cameraY = groundY + 1.6` 이고 `groundY = -480·tan(dip)`, dip 은 관측지
 * 고도가 정합니다. 해수면에서는 +1.26, 350m 에서는 −3.43 이라 **부호가
 * 뒤집힙니다.**
 */
const CAM_Y = [
  { key: '기준 (원점)', y: 0 },
  { key: '해수면 관측지', y: 1.26 },
  { key: '350m 관측지', y: -3.43 },
];
const SITES = [
  { key: '마니산', lat: 37.61553, lon: 126.4300, near: 'dem-mani', wide: 'wide-mani' },
  { key: '대부도', lat: 37.24102, lon: 126.55969, near: 'dem', wide: 'wide-daebu' },
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#0b0f15;font-family:sans-serif;color:#dde}
 #wrap{padding:12px;width:900px} canvas{border:1px solid #345;margin:2px} p{font:11px monospace}
</style></head><body>
<div id="wrap"><h3>카메라 높이를 바꾸면 지형이 움직이는가 (움직이면 안 됩니다)</h3>
<div id="shots"></div><div id="out"></div></div>
<script type="module">
import * as THREE from './app/vendor/three.module.js';
import { loadDemPatch, clearDemCache } from './app/utils/demTiles.js';
import { createTerrainField, updateTerrainFieldEye,
         FAR_FIELD_NEAR_M, FAR_FIELD_FAR_M, FAR_FIELD_RINGS }
  from './app/components/SkyScene3D/TerrainField.js';
import { createSeaPlane, updateSeaPlaneEye } from './app/components/SkyScene3D/SeaPlane.js';

const errors=[]; const oe=console.error; console.error=(...a)=>{errors.push(a.join(' ')); oe(...a);};
window.addEventListener('error', e=>errors.push(String(e.message)));

const SITES=${JSON.stringify(SITES)}, CAM_Y=${JSON.stringify(CAM_Y)};
const BLOCK=${BLOCK}, FAR=${FIELD_FAR_M}, MASK_R=${MASK_RADIUS_M}, EYE=${EYE_M};
const IRR=${JSON.stringify(LIGHT.surfaceIrr)}, SUNR=${JSON.stringify(LIGHT.sunRadiance)};
const EXPO=${LIGHT.exposure};

const W=512,H=512,FOV=60, AZ=[45,135,225,315];
const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H;
const r=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
r.setPixelRatio(1); r.setSize(W,H,false); r.setClearColor(0,0);
const rt=new THREE.WebGLRenderTarget(W,H,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,
  minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});
const buf=new Uint8Array(W*H*4);
const tanH=Math.tan(FOV*Math.PI/360);
const loadTexture=u=>new Promise((res,rej)=>{new THREE.TextureLoader().load(u,res,undefined,rej);});

function draw(cam){ r.setRenderTarget(rt); r.clear(); r.render(scene,cam);
  r.readRenderTargetPixels(rt,0,0,W,H,buf); r.setRenderTarget(null); }

/** 시선은 그대로, 눈만 옮깁니다. legacy=true 면 옛 방식(메시 Y=0)을 흉내냅니다. */
function place(camY, azDeg, pitchDeg, legacy){
  const cam=new THREE.PerspectiveCamera(FOV,1,0.1,2000);
  cam.position.set(0,camY,0);
  for(const h of handles){ updateTerrainFieldEye(h,cam); if(legacy) h.mesh.position.y=0; }
  if(sea){ updateSeaPlaneEye(sea,cam); if(legacy) sea.mesh.position.y=0; }
  const a=azDeg*Math.PI/180, p=pitchDeg*Math.PI/180;
  cam.up.set(0,1,0);
  cam.lookAt(cam.position.x+Math.sin(a)*Math.cos(p), cam.position.y+Math.sin(p),
             cam.position.z-Math.cos(a)*Math.cos(p));
  cam.updateMatrixWorld(true);
  return cam;
}

/** 열마다 가장 위의 불투명 화소 → 그 방향의 하늘금 고도각. */
function skyline(camY, azDeg, legacy){
  draw(place(camY, azDeg, 0, legacy));
  const out=[];
  for(let x=0;x<W;x+=8){
    let top=-1; for(let y=H-1;y>=0;y--) if(buf[(y*W+x)*4+3]>128){top=y;break;}
    out.push(top<0?null:Math.atan(tanH*(2*(top+0.5)/H-1))*180/Math.PI);
  }
  return out;
}

/** 발밑 격자 구멍의 각반경 — 바로 아래를 보고 빈 화소 넓이로 잽니다. */
function holeDeg(camY, legacy){
  const cam=place(camY, 0, -90, legacy);
  cam.up.set(0,0,-1);
  cam.lookAt(cam.position.x, cam.position.y-1, cam.position.z);
  cam.updateMatrixWorld(true);
  draw(cam);
  let n=0; for(let i=0;i<W*H;i++) if(buf[i*4+3]<128) n++;
  return Math.atan(Math.sqrt((n/(W*H))/Math.PI)*2*tanH)*180/Math.PI;
}

const median=a=>{const b=a.slice().sort((x,y)=>x-y); return b[b.length>>1]??0;};

let scene, handles=[], sea=null;
const 결과={};
for (const site of SITES){
  clearDemCache();
  const patch=await loadDemPatch(site.lat,site.lon,FAR,{renderer:r,loadTexture,block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.near}/\${z}_\${x}_\${y}.png\`});
  const maskPatch=await loadDemPatch(site.lat,site.lon,MASK_R,{renderer:r,loadTexture,block:BLOCK,
    tileUrl:(z,x,y)=>\`./\${site.wide}/\${z}_\${x}_\${y}.png\`});
  if(!patch||!maskPatch){ errors.push(site.key+' 패치 없음'); continue; }

  scene=new THREE.Scene();
  const near=createTerrainField({patch,eyePatch:patch,eyeHeightM:EYE});
  near.mesh.renderOrder=-0.48; scene.add(near.mesh);
  const far=createTerrainField({patch:maskPatch,eyePatch:patch,eyeHeightM:EYE,
    nearM:FAR_FIELD_NEAR_M,farM:FAR_FIELD_FAR_M,rings:FAR_FIELD_RINGS,despike:true});
  far.mesh.renderOrder=-0.49; scene.add(far.mesh);
  sea=createSeaPlane({patch,maskPatch,eyeHeightM:EYE});
  sea.mesh.renderOrder=-0.47; scene.add(sea.mesh);
  handles=[near,far];
  for(const h of handles){ const u=h.material.uniforms;
    u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
    u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
    u.uExposure.value=EXPO; u.uAerial.value=0;
    u.uSunAltDeg.value=25; u.uSunAltRad.value=25*Math.PI/180; u.uSunAzRad.value=135*Math.PI/180; }
  { const u=sea.material.uniforms;
    u.uSurfaceIrr.value.set(IRR[0],IRR[1],IRR[2]);
    u.uSunRadiance.value.set(SUNR[0],SUNR[1],SUNR[2]);
    u.uSunAltDeg.value=25; u.uSunAltRad.value=25*Math.PI/180; u.uSunAzRad.value=135*Math.PI/180; }

  const base={}, baseHole={};
  for(const az of AZ) base[az]=skyline(0,az,false);
  baseHole.now=holeDeg(0,false); baseHole.legacy=holeDeg(0,true);

  const rows={};
  for(const c of CAM_Y){
    if(c.y===0) continue;
    for(const mode of ['지금','옛 방식']){
      const legacy = mode==='옛 방식';
      const per={};
      for(const az of AZ){
        const b=skyline(c.y,az,legacy), a=base[az];
        const d=[]; for(let i=0;i<a.length;i++) if(a[i]!==null&&b[i]!==null) d.push(b[i]-a[i]);
        per['방위'+az]=+median(d).toFixed(4);
      }
      per['발밑구멍']=+(holeDeg(c.y,legacy)-(legacy?baseHole.legacy:baseHole.now)).toFixed(4);
      per['최대절대']=+Math.max(...Object.values(per).map(Math.abs)).toFixed(4);
      rows[c.key+' · '+mode]=per;
    }
  }
  결과[site.key]=rows;

  { const cam=place(1.26,45,0,false); r.render(scene,cam);
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    cv.style.width='180px'; cv.style.height='180px';
    cv.getContext('2d').drawImage(canvas,0,0);
    const t=document.createElement('div'); t.style.font='10px monospace';
    t.textContent=site.key+' · 카메라 +1.26 · 방위 45°';
    document.getElementById('shots').appendChild(t);
    document.getElementById('shots').appendChild(cv); }

  for(const h of handles){ scene.remove(h.mesh); h.dispose?.(); }
  scene.remove(sea.mesh); sea.dispose?.();
}

document.getElementById('out').innerHTML='<p>'+JSON.stringify(결과)+'</p>';
window.__stats={ glError:r.getContext().getError(), 결과 };
window.__errors=errors;
document.title='DONE::'+(errors.length?'ERR':'OK')+'::'+r.getContext().getError();
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'eye-origin.html'), html);
console.log('생성 완료: eye-origin.html');
