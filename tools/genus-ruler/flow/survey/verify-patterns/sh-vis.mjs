// Candidate 1: does 64^2 x 40 SH steps (r .3, dt 1, k0 = 8 cycles/tile) give a defect-laden cell/roll field? Write PGM for hex (g2=1) and rolls (g2=0), upsampled x4 nearest; also measure fraction of top-30% set that is one connected piece (largestFrac) as a proxy.
import fs from 'node:fs';
function rng(seed){ let s=seed>>>0||1; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
function fft1(re, im, n, off, stride, inv){
  for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ const a=off+i*stride,b=off+j*stride; let t=re[a];re[a]=re[b];re[b]=t; t=im[a];im[a]=im[b];im[b]=t; } }
  for (let len=2; len<=n; len<<=1){ const ang=2*Math.PI/len*(inv?1:-1), wr=Math.cos(ang), wi=Math.sin(ang);
    for (let i=0;i<n;i+=len){ let cr=1, ci=0; for(let k=0;k<len/2;k++){ const a=off+(i+k)*stride, b=off+(i+k+len/2)*stride;
      const xr=re[b]*cr-im[b]*ci, xi=re[b]*ci+im[b]*cr; re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t; } } }
  if(inv){ for(let i=0;i<n;i++){ re[off+i*stride]/=n; im[off+i*stride]/=n; } }
}
function fft2(re,im,n,inv){ for(let j=0;j<n;j++) fft1(re,im,n,j*n,1,inv); for(let i=0;i<n;i++) fft1(re,im,n,i,n,inv); }
function sh(n, steps, g2, cyc, aniso=0){
  const r=0.3, dt=1.0;
  const re=new Float64Array(n*n), im=new Float64Array(n*n), lin=new Float64Array(n*n);
  const R=rng(7); for(let i=0;i<n*n;i++) re[i]=(R()-0.5)*0.1;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const kx=(i<n/2?i:i-n)/cyc, ky=(j<n/2?j:j-n)/cyc; const q=1-(kx*kx+ky*ky); lin[j*n+i]=r-q*q - aniso*kx*kx; }
  const nl=new Float64Array(n*n), nim=new Float64Array(n*n);
  for(let s=0;s<steps;s++){
    for(let i=0;i<n*n;i++){ const u=re[i]; nl[i]=g2*u*u-u*u*u; nim[i]=0; }
    fft2(nl,nim,n,false); im.fill(0); fft2(re,im,n,false);
    for(let i=0;i<n*n;i++){ const d=1-dt*lin[i]; re[i]=(re[i]+dt*nl[i])/d; im[i]=(im[i]+dt*nim[i])/d; }
    fft2(re,im,n,true);
  }
  return re;
}
function largestFrac(u,n,cover){ const s=Float64Array.from(u).sort(); const th=s[Math.floor((1-cover)*(n*n-1))]; const m=new Uint8Array(n*n); let tot=0; for(let i=0;i<n*n;i++){ m[i]=u[i]>th?1:0; tot+=m[i]; }
  const lab=new Int32Array(n*n).fill(-1); let best=0, cnt=0; const st=[]; for(let i=0;i<n*n;i++){ if(!m[i]||lab[i]>=0) continue; let sz=0; st.push(i); lab[i]=cnt; while(st.length){ const c=st.pop(); sz++; const x=c%n,y=(c/n)|0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nx=(x+dx+n)%n, ny=(y+dy+n)%n, k=ny*n+nx; if(m[k]&&lab[k]<0){ lab[k]=cnt; st.push(k);} } } best=Math.max(best,sz); cnt++; }
  return {pieces:cnt, largestFrac:+(best/tot).toFixed(3)}; }
function pgm(name,u,n,up=4){ let mn=Infinity,mx=-Infinity; for(const v of u){ if(v<mn)mn=v; if(v>mx)mx=v;} const N=n*up; const b=Buffer.alloc(N*N); for(let y=0;y<N;y++) for(let x=0;x<N;x++){ const v=u[((y/up)|0)*n+((x/up)|0)]; b[y*N+x]=Math.round(255*(v-mn)/(mx-mn)); } fs.writeFileSync(name, Buffer.concat([Buffer.from(`P5\n${N} ${N}\n255\n`), b])); }
for (const [g2,cyc,aniso,tag] of [[0,8,0,'rolls'],[1,8,0,'hexUp'],[-1,8,0,'hexDown'],[0,8,0.6,'rollsAniso']]){
  const u=sh(64,40,g2,cyc,aniso); pgm(`sh64_${tag}.pgm`,u,64);
  console.log(tag, 'cover .3', largestFrac(u,64,0.3), 'cover .5', largestFrac(u,64,0.5), 'cover .7', largestFrac(u,64,0.7));
}
