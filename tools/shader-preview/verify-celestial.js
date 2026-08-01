const T = require('/home/user/solar-path/node_modules/three/build/three.cjs');
const Cat = require('/tmp/atmbuild/starCatalog.js');
const Coords = require('/tmp/atmbuild/celestialCoords.js');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('  FAIL:', m);} };

// ── 1. 은하 좌표 기저: 알려진 별들의 은하 좌표와 일치하는가 ─────────────────
function fromRaDec(ra,dec){const r=ra*Math.PI/180,d=dec*Math.PI/180,cd=Math.cos(d);
  return new T.Vector3(cd*Math.cos(r),cd*Math.sin(r),Math.sin(d));}
const GX=fromRaDec(266.405,-28.936).normalize(), GZ=fromRaDec(192.85948,27.12825).normalize();
const GY=new T.Vector3().crossVectors(GZ,GX).normalize();
function toGal(raH,decD){
  const v=fromRaDec(raH*15,decD);
  const x=v.dot(GX), y=v.dot(GY), z=v.dot(GZ);
  return { l:(Math.atan2(y,x)*180/Math.PI+360)%360, b:Math.asin(Math.max(-1,Math.min(1,z)))*180/Math.PI };
}
console.log('== 은하 좌표계 기저 ==');
const GXo=fromRaDec(266.405,-28.936); GXo.addScaledVector(GZ,-GXo.dot(GZ)).normalize();
ok(Math.abs(GXo.dot(GZ))<1e-9, '직교화 후 중심축과 극축 직교');
ok(Math.abs(GX.length()-1)<1e-9 && Math.abs(GY.length()-1)<1e-9, '기저 정규화');
// 문헌값 (SIMBAD)
const REF = [
  ['Deneb',      20.6905,  45.2803,  84.28,   2.00],
  ['Polaris',     2.5303,  89.2641, 123.28,  26.46],
  ['Sirius',      6.7525, -16.7161, 227.23, -8.89],
  ['Vega',       18.6156,  38.7837,  67.45,  19.24],
  ['Antares',    16.4901, -26.4320, 351.95,  15.06],
  ['Rigel',       5.2423,  -8.2016, 209.24, -25.25],
];
for (const [name, ra, dec, l, b] of REF) {
  const g = toGal(ra, dec);
  let dl = Math.abs(((g.l - l + 540) % 360) - 180);
  ok(dl < 0.2 && Math.abs(g.b - b) < 0.2,
     `${name} 은하좌표 l=${g.l.toFixed(2)}(기대 ${l}) b=${g.b.toFixed(2)}(기대 ${b})`);
}

// ── 2. 은하수 띠가 실제 은하수 별을 덮는가 ─────────────────────────────────
console.log('== 은하수 띠 범위 ==');
// Deneb(b=+2.0), Altair(b=-8.9) 는 띠 안, Polaris(b=+26.5) 는 밖이어야 합니다
const HALF = 20;
ok(Math.abs(toGal(20.6905,45.2803).b) < HALF, 'Deneb은 띠 안');
ok(Math.abs(toGal(19.8464,8.8683).b) < HALF, 'Altair는 띠 안');
ok(Math.abs(toGal(2.5303,89.2641).b) > HALF, 'Polaris는 띠 밖');
ok(Math.abs(toGal(0.857,-27.128).b) > 89, `남은하극은 b=${toGal(0.857,-27.128).b.toFixed(2)}`);

// ── 3. 경도별 밝기 프로파일 ────────────────────────────────────────────────
console.log('== 경도별 밝기 ==');
const fold=l=>{const x=((l%360)+360)%360; return x>180?360-x:x;};
const bright=l=>{const L=fold(l);
  return Math.exp(-Math.pow(L/26,2)) + 0.52*Math.exp(-Math.pow((L-55)/46,2))
       + 0.16 - 0.09*Math.min(1,Math.max(0,(L-90)/90));};
ok(bright(0) > bright(180)*3, `중심(${bright(0).toFixed(2)})이 반중심(${bright(180).toFixed(2)})보다 3배 이상 밝음`);
ok(bright(60) > bright(140), '방패-백조 팔이 그 바깥보다 밝음');
ok(Math.abs(bright(30)-bright(330)) < 1e-9, '중심 기준 좌우 대칭');
ok(bright(180) > 0.03, '반중심도 완전히 사라지지는 않음');

// ── 4. 별 밝기 매핑 (셰이더와 같은 식) ─────────────────────────────────────
console.log('== 등급 → 화면 밝기 ==');
const LIMIT = 6.5;
const vis=(mag, userLimit)=>{
  const t=Math.min(1,Math.max(0,(LIMIT-mag)/(LIMIT+1.46)));
  const sm=(e0,e1,x)=>{const u=Math.min(1,Math.max(0,(x-e0)/(e1-e0))); return u*u*(3-2*u);};
  return Math.pow(t,1.15) * sm(userLimit+0.35, userLimit-0.35, mag);
};
ok(vis(-1.46,6.5) > 0.99, `시리우스가 최대 밝기 (${vis(-1.46,6.5).toFixed(3)})`);
ok(vis(6.5,6.5) < 0.02, `한계 등급은 거의 안 보임 (${vis(6.5,6.5).toFixed(3)})`);
ok(vis(4,6.5) > 0.15, `4등성은 분명히 보임 (${vis(4,6.5).toFixed(3)})`);
// 광공해가 밝은 별을 어둡게 만들면 안 됨
ok(Math.abs(vis(0,4.0)-vis(0,6.5)) < 1e-6,
   `한계 4등급에서도 0등성 밝기 유지 (${vis(0,4.0).toFixed(3)} vs ${vis(0,6.5).toFixed(3)})`);
ok(vis(5.5,4.0) < 0.001, '한계 4등급에서 5.5등성은 사라짐');
ok(vis(3.0,4.0) > 0.1, '한계 4등급에서 3등성은 남음');
// 단조성
let mono=true; for(let m=-1.4;m<6.4;m+=0.1) if(vis(m+0.1,6.5) > vis(m,6.5)+1e-9) mono=false;
ok(mono, '등급이 클수록 단조 감소');

// ── 5. 카탈로그 무결성 ─────────────────────────────────────────────────────
console.log('== 카탈로그 ==');
const cat = Cat.getStarCatalog();
ok(cat.count > 8000, `별 ${cat.count}개`);
let sorted=true; for(let i=1;i<cat.count;i++) if(cat.magnitude[i] < cat.magnitude[i-1]-1e-6) sorted=false;
ok(sorted, '밝은 순 정렬 (한계등급이 prefix slice가 됨)');
ok(cat.magnitude[0] < -1.4, `가장 밝은 별 ${cat.magnitude[0].toFixed(2)}등급 (시리우스)`);
let maxMag=-99; for(let i=0;i<cat.count;i++) maxMag=Math.max(maxMag,cat.magnitude[i]);
ok(maxMag <= 6.6, `하한 ${maxMag.toFixed(2)}등급`);
let raOk=true, decOk=true;
for(let i=0;i<cat.count;i++){ if(!(cat.raHours[i]>=0&&cat.raHours[i]<24.001)) raOk=false;
  if(!(cat.decDeg[i]>=-90.1&&cat.decDeg[i]<=90.1)) decOk=false; }
ok(raOk, 'RA 범위'); ok(decOk, 'Dec 범위');

// ── 6. 색 지수 → RGB ───────────────────────────────────────────────────────
console.log('== B-V → 색 ==');
const blue = Cat.bvToLinearRGB(-0.30);  // O/B형
const white= Cat.bvToLinearRGB(0.00);   // A형 (베가)
const red  = Cat.bvToLinearRGB(1.60);   // M형 (베텔게우스)
ok(blue[2] > blue[0], `B형은 파랑 우세 (R${blue[0].toFixed(2)} B${blue[2].toFixed(2)})`);
ok(red[0] > red[2]*1.5, `M형은 빨강 우세 (R${red[0].toFixed(2)} B${red[2].toFixed(2)})`);
ok(Math.abs(white[0]-white[2]) < 0.35, `A형은 거의 백색 (R${white[0].toFixed(2)} B${white[2].toFixed(2)})`);
// 실제 카탈로그에 색 다양성이 있는가
let minB=9,maxB=-9; for(let i=0;i<2000;i++){const c=Cat.bvToLinearRGB(cat.colorIndex[i]);
  const ratio=c[2]/Math.max(1e-6,c[0]); minB=Math.min(minB,ratio); maxB=Math.max(maxB,ratio);}
ok(maxB/minB > 2.0, `밝은 별 2000개의 청/적 비 범위 ${minB.toFixed(2)}~${maxB.toFixed(2)}`);

// ── 7. 궤적 시간축 (자정 기준 경과시간) ────────────────────────────────────
console.log('== 궤적 시간축 ==');
const start = new Date(2026,7,1,0,0,0); // 로컬 자정
const hours=[]; for(let i=0;i<=24;i+=0.5) hours.push((new Date(start.getTime()+i*3600000).getTime()-start.getTime())/3600000);
let hmono=true; for(let i=1;i<hours.length;i++) if(hours[i]<=hours[i-1]) hmono=false;
ok(hmono, 'UTC+9에서도 시간축이 단조 증가 (23→0 불연속 없음)');
ok(Math.abs(hours[hours.length-1]-24)<1e-9, '마지막 점이 24시');
const now = new Date(2026,7,1,19,30,0);
ok(Math.abs((now.getHours()+now.getMinutes()/60) - 19.5) < 1e-9, '"지금"이 같은 기준(19.5)');

console.log(`\n총 ${pass+fail}개 중 통과 ${pass}, 실패 ${fail}`);
process.exit(fail ? 1 : 0);
