// Candidate 12: open-cell wall network (1 - closed gap + vertex boost) composed with a k^-2 q0 under the quantile threshold.
// Does the network stay one piece (largestFrac) and spread (quad12km) at cover 0.3 for GENUS_FLOW.sc weights (wQ 1.0, wT 0.4) vs retuned?
const rng=(seed)=>()=>{ seed|=0; seed=(seed+0x6D2B79F5)|0; let t=Math.imul(seed^(seed>>>15),1|seed); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
const gauss=(r)=>{ const u=Math.max(1e-12,r()),v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
const wrapD=(a,b)=>{ let d=a-b; d-=Math.round(d); return d; };
function cells(n,seed,jit=0.8){ const r=rng(seed), p=[]; for(let j=0;j<n;j++) for(let i=0;i<n;i++) p.push({x:(i+0.5+(r()-0.5)*jit)/n, y:(j+0.5+(r()-0.5)*jit)/n, s:r()}); return (i,j)=>p[(((j%n)+n)%n)*n+(((i%n)+n)%n)]; }
function std(A){ let m=0; for(const v of A) m+=v; m/=A.length; let s=0; for(const v of A){ s+=(v-m)*(v-m);} s=Math.sqrt(s/A.length)||1; for(let i=0;i<A.length;i++) A[i]=(A[i]-m)/s; }
function q0field(S,seed,kq=12,pow=2){ // direct trig sum (cheap enough at 256^2 for a check)
  const r=rng(seed), modes=[]; for(let ky=-kq;ky<=kq;ky++) for(let kx=-kq;kx<=kq;kx++){ const k=Math.hypot(kx,ky); if(k<1||k>kq) continue; if(ky<0||(ky===0&&kx<0)) continue; modes.push([kx,ky,Math.pow(k,-pow)*gauss(r), r()*2*Math.PI]); }
  const f=new Float32Array(S*S); for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+.5)/S,v=(y+.5)/S; let s=0; for(const [kx,ky,a,ph] of modes) s+=a*Math.cos(2*Math.PI*(kx*u+ky*v)+ph); f[y*S+x]=s; } std(f); return f; }
function openField(S,n,seed,gap=0.35,vertex=0.5){ const C=cells(n,seed); const f=new Float32Array(S*S);
  for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+.5)/S,v=(y+.5)/S, ci=Math.floor(u*n), cj=Math.floor(v*n); let d1=9,d2=9,d3=9;
    for(let dj=-2;dj<=2;dj++) for(let di=-2;di<=2;di++){ const p=C(ci+di,cj+dj), d=Math.hypot(wrapD(u,p.x),wrapD(v,p.y))*n; if(d<d1){d3=d2;d2=d1;d1=d;} else if(d<d2){d3=d2;d2=d;} else if(d<d3) d3=d; }
    const closed=Math.min(1,(d2-d1)/gap); f[y*S+x]=1-closed+vertex*Math.exp(-((d3-d1)*(d3-d1))/0.1); }
  std(f); return f; }
function stats(f,S,cover,tileKm=24){ const s=Float32Array.from(f).sort(); const th=s[Math.floor((1-cover)*(S*S-1))]; const m=new Uint8Array(S*S); let tot=0; for(let i=0;i<S*S;i++){ m[i]=f[i]>th?1:0; tot+=m[i]; }
  const lab=new Int32Array(S*S).fill(-1); let best=0,cnt=0; const st=[]; for(let i=0;i<S*S;i++){ if(!m[i]||lab[i]>=0) continue; let sz=0; st.push(i); lab[i]=cnt; while(st.length){ const c=st.pop(); sz++; const x=c%S,y=(c/S)|0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=S||ny>=S) continue; const k=ny*S+nx; if(m[k]&&lab[k]<0){ lab[k]=cnt; st.push(k);} } } if(sz>=4){ best=Math.max(best,sz); cnt++; } }
  // quad12km: max fraction of cloud in a 12x12 km periodic window
  const w=Math.round(S*12/tileKm); let qmax=0; for(let oy=0;oy<S;oy+=8) for(let ox=0;ox<S;ox+=8){ let c=0; for(let y=0;y<w;y++) for(let x=0;x<w;x++) c+=m[((oy+y)%S)*S+((ox+x)%S)]; qmax=Math.max(qmax,c); }
  // perimPerArea (4-neighbour boundary texels / area) at this S; scale to 512 texel units ~ x(S/512)
  let bd=0; for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const i=y*S+x; if(!m[i]) continue; if((x>0&&!m[i-1])||(x<S-1&&!m[i+1])||(y>0&&!m[i-S])||(y<S-1&&!m[i+S])) bd++; }
  return {pieces100km2:+(cnt/tileKm/tileKm*100).toFixed(1), largestFrac:+(best/tot).toFixed(2), quad12km:+(qmax/tot).toFixed(2), perimPerArea512:+((bd/tot)*(S/512)).toFixed(3)}; }
const S=256; const q0=q0field(S,7);
for (const n of [13,4]){ const T=openField(S,n,21);
  for (const [wQ,wT] of [[1.0,0.4],[0.5,1.0],[0,1]]){ const f=new Float32Array(S*S); for(let i=0;i<S*S;i++) f[i]=wQ*q0[i]+wT*T[i];
    console.log(`open n=${n} (spacing ${(24/n).toFixed(1)} km) wQ ${wQ} wT ${wT}`, 'cover .3', stats(f,S,.3), 'cover .5', stats(f,S,.5)); } }
// closed-cell reference (today's FIELDS.sc gap only, sheet 0.3) with current weights
{ const n=13, C=cells(n,21), T=new Float32Array(S*S); for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+.5)/S,v=(y+.5)/S,ci=Math.floor(u*n),cj=Math.floor(v*n); let d1=9,d2=9,s1=0; for(let dj=-2;dj<=2;dj++) for(let di=-2;di<=2;di++){ const p=C(ci+di,cj+dj), d=Math.hypot(wrapD(u,p.x),wrapD(v,p.y))*n; if(d<d1){d2=d1;d1=d;s1=p.s;} else if(d<d2) d2=d; } const g=0.3+0.7*Math.min(1,(d2-d1)/0.35); T[y*S+x]=(0.55+0.45*s1)*g*(1-0.35*Math.min(1,d1)); } std(T);
  const f=new Float32Array(S*S); for(let i=0;i<S*S;i++) f[i]=1.0*q0[i]+0.4*T[i]; console.log('closed(today) wQ 1 wT .4', 'cover .3', stats(f,S,.3), 'cover .5', stats(f,S,.5)); }
