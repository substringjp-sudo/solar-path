/**
 * 구운 셀 필드를 **눈으로** 봅니다 (docs/CLOUD_TEXTURE_PLAN.md 1단계).
 *
 * 수치 검증(verify-cell-field.js)은 면적비만 봅니다. 면적이 맞아도 무늬가
 * 고적운처럼 안 보이면 소용이 없으므로, 여기서 실제 픽셀을 그려 놓고 봅니다.
 *
 * 두 변종(fbm / billow)을 운량별로 나란히 놓고, 아래에 확대 컷을 둡니다.
 * 판단 기준은 기준 사진(2026-08-20 비늘구름)의 조각 모양입니다 —
 * 둥근 알갱이가 고르게 흩어져 있고 사이로 하늘이 보이는가.
 *
 * 준비: verify-cell-field.js와 같은 /tmp/cellbuild 산출물
 * 사용: node tools/shader-preview/build-cell-preview.js
 *       node tools/shader-preview/shoot.js cell.html cell-preview.png
 */
const fs = require('fs');
const path = require('path');
const C = require('/tmp/cellbuild/cloudCellField.js');

const { PREVIEW } = require('./paths');

const SIZE = 512;
const COVERS = [0.15, 0.39, 0.6, 0.85];

const fields = {};
for (const variant of ['fbm', 'billow']) {
  const t0 = Date.now();
  const f = C.bakeCellField({ size: SIZE, tileCells: 16, octaves: 5, variant });
  console.log('%s 굽기 %dms', variant, Date.now() - t0);
  fields[variant] = Buffer.from(f.data).toString('base64');
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#14181c;font-family:sans-serif;color:#dde}
 #wrap{width:1180px;padding:16px}
 h2{font-size:14px;margin:14px 0 6px;letter-spacing:.05em}
 .row{display:flex;gap:8px}
 .cell{display:flex;flex-direction:column;gap:4px}
 .cell canvas{display:block;width:280px;height:280px;image-rendering:pixelated;
   border:1px solid #2a3238}
 .lbl{font-size:11px;color:#8d9aa4;font-family:monospace}
 .zoom canvas{width:565px;height:565px}
</style></head><body>
<div id="wrap">
 <h2>billow — 운량별 (타일 전체 512px = 셀 16개)</h2>
 <div class="row" id="r-billow"></div>
 <h2>fbm — 운량별</h2>
 <div class="row" id="r-fbm"></div>
 <h2>확대 (좌 billow · 우 fbm, 운량 0.39, 왼쪽 위 1/4)</h2>
 <div class="row zoom" id="r-zoom"></div>
</div>
<script>
const SIZE=${SIZE}, COVERS=${JSON.stringify(COVERS)};
const B64=${JSON.stringify(fields)};
const SKY=[46,109,150], CLOUD=[242,237,228], SHADE=[196,199,206];

function decode(b64){
  const bin=atob(b64); const a=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i);
  return a;
}
const DATA={billow:decode(B64.billow), fbm:decode(B64.fbm)};

function paint(cv, data, cover, x0, y0, w, h){
  const ctx=cv.getContext('2d');
  const img=ctx.createImageData(w,h);
  const px=img.data;
  const t=(1-cover)*256;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const v=data[(y0+y)*SIZE+(x0+x)];
    // 문턱 부근만 부드럽게 — 실제 셰이더도 좁은 램프를 씁니다.
    let a=Math.max(0,Math.min(1,(v-(t-6))/12));
    a=a*a*(3-2*a);
    const shade=Math.max(0,Math.min(1,(v-t)/28));
    const o=4*(y*w+x);
    for(let c=0;c<3;c++){
      const cl=SHADE[c]+(CLOUD[c]-SHADE[c])*shade;
      px[o+c]=SKY[c]+(cl-SKY[c])*a;
    }
    px[o+3]=255;
  }
  ctx.putImageData(img,0,0);
}

const stats={};
for(const variant of ['billow','fbm']){
  const row=document.getElementById('r-'+variant);
  for(const cover of COVERS){
    const d=document.createElement('div'); d.className='cell';
    const cv=document.createElement('canvas'); cv.width=SIZE; cv.height=SIZE;
    paint(cv, DATA[variant], cover, 0, 0, SIZE, SIZE);
    const l=document.createElement('div'); l.className='lbl';
    // 화면에서 실제로 구름인 픽셀 비율을 재서 라벨에 함께 적습니다.
    const dd=cv.getContext('2d').getImageData(0,0,SIZE,SIZE).data;
    let n=0,tot=0;
    for(let i=0;i<dd.length;i+=4){ if(dd[i+2]>190) n++; tot++; }
    const got=n/tot;
    stats[variant+'@'+cover]=+got.toFixed(4);
    l.textContent='운량 '+cover.toFixed(2)+' → 화면 '+got.toFixed(3);
    d.appendChild(cv); d.appendChild(l); row.appendChild(d);
  }
}

const z=document.getElementById('r-zoom');
for(const variant of ['billow','fbm']){
  const d=document.createElement('div'); d.className='cell';
  const cv=document.createElement('canvas'); cv.width=SIZE/2; cv.height=SIZE/2;
  paint(cv, DATA[variant], 0.39, 0, 0, SIZE/2, SIZE/2);
  const l=document.createElement('div'); l.className='lbl'; l.textContent=variant+' · 운량 0.39 · 2배 확대';
  d.appendChild(cv); d.appendChild(l); z.appendChild(d);
}

document.title='DONE::OK::0';
window.__stats=stats;
window.__errors=[];
</script></body></html>`;

fs.mkdirSync(PREVIEW, { recursive: true });
fs.writeFileSync(path.join(PREVIEW, 'cell.html'), html);
console.log('생성 완료: cell.html');
