/**
 * 예보 운량을 **위성이 실제로 본 하늘**과 견주는 자 (2판).
 *
 * 1판의 잘못: 위성 일사를 Kasten-Czeplak 로 운량(%)으로 되돌려 견줬다.
 *   τ = 1 - 0.75·(N/8)^3.4 는 지수 3.4 때문에 맑은 쪽에서 거의 수직이라
 *   τ 0.95 → 운량 45% 가 나온다. 일사 5% 오차가 운량 45%p 오차로 부풀어
 *   "모델 오차 30%p" 의 상당 부분이 자 자신의 잡음이었다.
 * 2판: **투과율 τ 공간에서** 견준다. 모델 운량을 같은 식으로 τ 로 바꾼 뒤
 *   τ 끼리 뺀다. 앱이 실제로 그리는 것(하늘이 얼마나 어두워지나)에도 이쪽이 가깝다.
 *
 * 맑은하늘 기준: Haurwitz(1098·cosZ·exp(-0.059/cosZ)) 는 연무·수증기를 무시해
 *   지역마다 몇 % 씩 어긋난다. 그래서 **네 모델이 모두 맑다(≤20%)고 한 시각**
 *   의 τ 평균을 그 지역의 맑은하늘 배율로 삼아 나눈다. 모델은 여기서 눈금의
 *   크기만 정하고, 변동은 정하지 않는다.
 *
 * 덮는 범위: MSG(0°)+IODC(45.5°E)+Himawari(140°E). **미 대륙은 위성이 없다**
 *   (서반구 경도는 전부 latitude:nan 을 돌려준다). 원반 가장자리(경도 -60°
 *   부근 등)도 못 믿는다.
 */
const MODELS = ['best_match','ecmwf_ifs025','icon_seamless','gfs_seamless'];
const PLACES = [
  { name:'서울 도곡동',     lat:37.4863, lon:127.0443 },
  { name:'강원 인제',       lat:38.0695, lon:128.1704 },
  { name:'제주 서귀포',     lat:33.2541, lon:126.5601 },
  { name:'일본 도쿄',       lat:35.6812, lon:139.7671 },
  { name:'독일 뮌헨',       lat:48.1372, lon:11.5756  },
  { name:'영국 런던',       lat:51.5072, lon:-0.1276  },
  { name:'스페인 세비야',   lat:37.3891, lon:-5.9845  },
  { name:'몽골 울란바토르', lat:47.8864, lon:106.9057 },
  { name:'케냐 나이로비',   lat:-1.2921, lon:36.8219  },
  { name:'호주 시드니',     lat:-33.8688,lon:151.2093 },
];
const DAYS = Number(process.argv[2] || 30);
const rad=d=>d*Math.PI/180;
function cosZenith(d,lat,lon){const jd=d.getTime()/86400000+2440587.5,n=jd-2451545.0;
 const L=(280.460+0.9856474*n)%360,g=rad((357.528+0.9856003*n)%360);
 const lam=rad(L+1.915*Math.sin(g)+0.020*Math.sin(2*g)),eps=rad(23.439-0.0000004*n);
 const dec=Math.asin(Math.sin(eps)*Math.sin(lam));
 const gmst=(18.697374558+24.06570982441908*n)%24;
 const ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam));
 const ha=rad(gmst*15+lon)-ra;
 return Math.sin(rad(lat))*Math.sin(dec)+Math.cos(rad(lat))*Math.cos(dec)*Math.cos(ha);}
const haurwitz=cz=>cz<=0?0:1098*cz*Math.exp(-0.059/cz);
const tauOf=pct=>1-0.75*Math.pow(Math.min(100,Math.max(0,pct))/100,3.4);
const iso=d=>d.toISOString().slice(0,10);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;

(async()=>{
  const end=new Date(Date.now()-24*3600e3), start=new Date(end.getTime()-(DAYS-1)*86400e3);
  console.log(`관측 ${iso(start)} ~ ${iso(end)} (${DAYS}일), 태양고도 15° 이상 시각만`);
  console.log(`견줌: 투과율 τ (1=맑음, 0=완전차단). 표의 수치는 τ 평균절대오차 ×100\n`);
  const tot=Object.fromEntries(MODELS.map(m=>[m,{n:0,ae:0,bias:0}]));
  const totCons={n:0,ae:0,bias:0}, spreadBins=[[],[],[],[]], obsBins=[[],[],[],[]];
  const rows=[]; const allSamples=[];
  for(const P of PLACES){
    let sat,fc;
    try{
      sat=JSON.parse(await(await fetch(`https://satellite-api.open-meteo.com/v1/archive?latitude=${P.lat}&longitude=${P.lon}&hourly=shortwave_radiation&models=satellite_radiation_seamless&start_date=${iso(start)}&end_date=${iso(end)}&timezone=UTC`)).text());
      fc=JSON.parse(await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${P.lat}&longitude=${P.lon}&hourly=cloud_cover&models=${MODELS.join(',')}&start_date=${iso(start)}&end_date=${iso(end)}&timezone=UTC`)).text());
    }catch(e){ console.log(`  ${P.name.padEnd(14)} 위성 미포함 지역`); continue; }
    if(!sat.hourly||!fc.hourly){ console.log(`  ${P.name.padEnd(14)} 위성 미포함 지역`); continue; }
    const st=sat.hourly.time, sv=sat.hourly.shortwave_radiation;
    const idx=new Map(fc.hourly.time.map((t,i)=>[t,i]));
    // 1차 통과: 맑은하늘 배율 구하기
    const clearTaus=[], samples=[];
    for(let i=0;i<st.length;i++){
      if(sv[i]==null) continue;
      const d=new Date(st[i]+'Z'), cz=cosZenith(d,P.lat,P.lon);
      if(cz<Math.sin(rad(15))) continue;
      const cs=haurwitz(cz); if(cs<80) continue;
      const fi=idx.get(st[i]); if(fi===undefined) continue;
      const vs=MODELS.map(m=>fc.hourly[`cloud_cover_${m}`]?.[fi]);
      if(vs.some(v=>v==null)) continue;
      const tauRaw=sv[i]/cs;
      samples.push({tauRaw,vs});
      if(Math.max(...vs)<=20) clearTaus.push(tauRaw);
    }
    if(samples.length<50){ console.log(`  ${P.name.padEnd(14)} 표본 부족 (${samples.length})`); continue; }
    // 맑은하늘 배율: 네 모델이 다 맑다고 한 시각의 τ 평균. 그런 시각이 8개도 안
    // 되는 곳(런던·서울 장마철처럼 30일 내내 흐린 곳)은 τ 상위 5% 를 대신 쓴다.
    let scale, scaleSrc;
    if(clearTaus.length>=8){ scale=mean(clearTaus); scaleSrc='합의'; }
    else { const s2=samples.map(x=>x.tauRaw).sort((a,b)=>a-b);
           scale=s2[Math.floor(0.95*(s2.length-1))]; scaleSrc='상위5%'; }
    const row={name:P.name,n:0,scale,scaleSrc,nClear:clearTaus.length,m:Object.fromEntries(MODELS.map(m=>[m,{ae:0,bias:0}])),cons:{ae:0,bias:0}};
    for(const s of samples){
      const tObs=Math.min(1,Math.max(0,s.tauRaw/scale));
      row.n++;
      s.vs.forEach((v,k)=>{
        const m=MODELS[k], e=tauOf(v)-tObs;
        row.m[m].ae+=Math.abs(e); row.m[m].bias+=e;
        tot[m].n++; tot[m].ae+=Math.abs(e); tot[m].bias+=e;
      });
      const eC=mean(s.vs.map(tauOf))-tObs;                 // 네 모델 τ 평균 = 합의
      row.cons.ae+=Math.abs(eC); row.cons.bias+=eC;
      totCons.n++; totCons.ae+=Math.abs(eC); totCons.bias+=eC;
      const sp=Math.max(...s.vs)-Math.min(...s.vs);        // 모델 갈림 폭 → 오차 예고?
      spreadBins[Math.min(3,Math.floor(sp/25))].push(Math.abs(eC));
      // 실제 하늘이 얼마나 흐렸나로 나눠 담는다: τ 1.0=맑음 … 0.25=완전흐림
      allSamples.push({tObs, vs:s.vs});
      const b = tObs>=0.85?0 : tObs>=0.65?1 : tObs>=0.45?2 : 3;
      obsBins[b].push({e:eC, per:MODELS.map((m,k)=>tauOf(s.vs[k])-tObs)});
    }
    rows.push(row);
    await new Promise(r=>setTimeout(r,900));
  }
  const pad=(s,n)=>String(s).padStart(n);
  console.log('  장소            시각수 맑음배율(출처) ' + MODELS.map(m=>pad(m.replace('_seamless','').replace('_ifs025',''),11)).join('') + pad('4모델평균',11));
  for(const r of rows) console.log(`  ${r.name.padEnd(14)}${pad(r.n,5)}${pad(r.scale.toFixed(2),8)}(${r.scaleSrc.padEnd(5)})`
    + MODELS.map(m=>pad((r.m[m].ae/r.n*100).toFixed(0),11)).join('') + pad((r.cons.ae/r.n*100).toFixed(0),11));
  console.log('\n  전체 (τ 평균절대오차 ×100, 낮을수록 좋음)');
  for(const m of MODELS) if(tot[m].n) console.log(`   ${m.padEnd(15)} ${(tot[m].ae/tot[m].n*100).toFixed(1)}   편향 ${(tot[m].bias/tot[m].n>=0?'+':'')}${(tot[m].bias/tot[m].n*100).toFixed(1)}   (n=${tot[m].n})`);
  console.log(`   ${'4모델 τ 평균'.padEnd(13)} ${(totCons.ae/totCons.n*100).toFixed(1)}   편향 ${(totCons.bias/totCons.n>=0?'+':'')}${(totCons.bias/totCons.n*100).toFixed(1)}   (n=${totCons.n})`);
  // 조합별 비교: 요청 비용(모델 수)과 이득을 견준다
  console.log('\n  조합별 (τ 평균절대오차×100 / 짙은흐림 τ<.45 에서의 편향)');
  const COMBOS=[['best_match'],['ecmwf_ifs025'],['icon_seamless'],
                ['ecmwf_ifs025','icon_seamless'],['ecmwf_ifs025','icon_seamless','gfs_seamless'],
                ['best_match','ecmwf_ifs025','icon_seamless'],MODELS];
  for(const C of COMBOS){
    let ae=0,n=0, dAe=0,dB=0,dn=0;
    for(const s2 of allSamples){
      const t=mean(C.map(m=>tauOf(s2.vs[MODELS.indexOf(m)])));
      const e=t-s2.tObs; ae+=Math.abs(e); n++;
      if(s2.tObs<0.45){ dAe+=Math.abs(e); dB+=e; dn++; }
    }
    console.log(`   ${C.map(m=>m.replace('_seamless','').replace('_ifs025','')).join('+').padEnd(28)} ${(ae/n*100).toFixed(1).padStart(5)}   짙음 ${(dAe/dn*100).toFixed(1).padStart(5)} / 편향 ${(dB/dn>=0?'+':'')}${(dB/dn*100).toFixed(1)}   (모델 ${C.length}개)`);
  }
  console.log('\n  모델이 갈리는 폭이 오차를 미리 알려주나 (합의값 기준)');
  ['0-25%p','25-50%p','50-75%p','75-100%p'].forEach((l,i)=>{
    const a=spreadBins[i];
    console.log(`   갈림 ${l.padEnd(9)} n=${pad(a.length,4)}  τ오차 ${a.length?(mean(a)*100).toFixed(1):'-'}`);
  });
  console.log('\n  실제 하늘이 흐릴수록 더 틀리나 (τ오차×100, +는 예보가 실제보다 맑다고 함)');
  ['맑음 τ≥.85','엷음 .65-.85','흐림 .45-.65','짙음 τ<.45'].forEach((l,i)=>{
    const a=obsBins[i]; if(!a.length){console.log(`   ${l.padEnd(12)} 없음`);return;}
    const per=MODELS.map((m,k)=>mean(a.map(x=>x.per[k])));
    console.log(`   ${l.padEnd(12)} n=${pad(a.length,4)}  합의 절대오차 ${(mean(a.map(x=>Math.abs(x.e)))*100).toFixed(1)}  편향 ${(mean(a.map(x=>x.e))>=0?'+':'')}${(mean(a.map(x=>x.e))*100).toFixed(1)}`
      + `   [모델별 편향 ` + MODELS.map((m,k)=>`${m.replace('_seamless','').replace('_ifs025','')} ${(per[k]>=0?'+':'')}${(per[k]*100).toFixed(0)}`).join(' ') + ']');
  });
})();
