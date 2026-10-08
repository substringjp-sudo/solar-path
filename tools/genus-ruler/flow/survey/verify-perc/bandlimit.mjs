// Candidate 2 check: compose at 256 + bilinear upsample to 512 vs compose at 512 directly.
// Pipeline stand-in: template T at 256² (k^-1.4 amplitude = power k^-2.8), warped by a smooth D (k<=8, amp ~2-3 texels@256),
// sampled bilinearly at S points. Measure radial power slope in the 0.14-0.5 km band (3-10.7 texels@512) and 0.5-6 km band.
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function fft1(re,im,off,stride,n,inv){for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const a=off+i*stride,b=off+j*stride;let t=re[a];re[a]=re[b];re[b]=t;t=im[a];im[a]=im[b];im[b]=t}}
for(let len=2;len<=n;len<<=1){const ang=2*Math.PI/len*(inv?1:-1);const wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const a=off+(i+k)*stride,b=off+(i+k+len/2)*stride;const tr=re[b]*cr-im[b]*ci,ti=re[b]*ci+im[b]*cr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr}}}
if(inv)for(let i=0;i<n;i++){re[off+i*stride]/=n;im[off+i*stride]/=n}}
function fft2(re,im,n,inv){for(let y=0;y<n;y++)fft1(re,im,y*n,1,n,inv);for(let x=0;x<n;x++)fft1(re,im,x,n,n,inv)}
function grf(n,beta,seed,kmax=1e9){const r=mulberry32(seed);const re=new Float64Array(n*n),im=new Float64Array(n*n);
for(let y=0;y<n;y++)for(let x=0;x<n;x++){const kx=x<=n/2?x:x-n,ky=y<=n/2?y:y-n;const k=Math.hypot(kx,ky);if(k===0||k>kmax)continue;const a=Math.pow(k,-beta/2);const ph=r()*2*Math.PI;const g=Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());re[y*n+x]=a*g*Math.cos(ph);im[y*n+x]=a*g*Math.sin(ph)}
fft2(re,im,n,true);return Float32Array.from(re)}
function bil(F,n,u,v){u=u-Math.floor(u);v=v-Math.floor(v);const x=u*n-0.5,y=v*n-0.5;let x0=Math.floor(x),y0=Math.floor(y);const fx=x-x0,fy=y-y0;x0=((x0%n)+n)%n;y0=((y0%n)+n)%n;const x1=(x0+1)%n,y1=(y0+1)%n;return F[y0*n+x0]*(1-fx)*(1-fy)+F[y0*n+x1]*fx*(1-fy)+F[y1*n+x0]*(1-fx)*fy+F[y1*n+x1]*fx*fy}
function compose(S,T,TS,DX,DY,n,amp){const f=new Float32Array(S*S);for(let y=0;y<S;y++){const v=(y+0.5)/S;for(let x=0;x<S;x++){const u=(x+0.5)/S;const dx=amp*bil(DX,n,u,v),dy=amp*bil(DY,n,u,v);f[y*S+x]=bil(T,TS,u-dx,v-dy)}}return f}
function upsample(f,S0,S){const g=new Float32Array(S*S);for(let y=0;y<S;y++){const v=(y+0.5)/S;for(let x=0;x<S;x++)g[y*S+x]=bil(f,S0,(x+0.5)/S,v)}return g}
function slope(f,S,lamLoTex,lamHiTex,nb=10){const re=Float64Array.from(f),im=new Float64Array(S*S);let m=0;for(const v of re)m+=v;m/=re.length;for(let i=0;i<re.length;i++)re[i]-=m;fft2(re,im,S,false);
const P=new Float64Array(S*S);for(let i=0;i<S*S;i++)P[i]=re[i]*re[i]+im[i]*im[i];const klo=S/lamHiTex,khi=S/lamLoTex;const edges=[];for(let i=0;i<=nb;i++)edges.push(klo*Math.pow(khi/klo,i/nb));
const sum=new Float64Array(nb),cnt=new Int32Array(nb);for(let y=0;y<S;y++)for(let x=0;x<S;x++){const kx=x<=S/2?x:x-S,ky=y<=S/2?y:y-S;const k=Math.hypot(kx,ky);if(k<klo||k>=khi)continue;let b=Math.floor(Math.log(k/klo)/Math.log(khi/klo)*nb);if(b>=nb)b=nb-1;sum[b]+=P[y*S+x];cnt[b]++}
let xs=[],ys=[];for(let b=0;b<nb;b++){if(cnt[b]<4)continue;xs.push(Math.log10(Math.sqrt(edges[b]*edges[b+1])));ys.push(Math.log10(sum[b]/cnt[b]+1e-30))}
const N=xs.length;let sx=0,sy=0,sxx=0,sxy=0;for(let i=0;i<N;i++){sx+=xs[i];sy+=ys[i];sxx+=xs[i]*xs[i];sxy+=xs[i]*ys[i]}return (N*sxy-sx*sy)/(N*sxx-sx*sx)}
function rankSq(f,S,cover){const idx=Array.from(f.keys()).sort((a,b)=>f[a]-f[b]);const th=f[idx[Math.floor((1-cover)*(S*S-1))]];const vals=[];for(let i=0;i<S*S;i++)if(f[i]>th)vals.push(f[i]);vals.sort((a,b)=>a-b);const d=new Float32Array(S*S);
// rank by binary search
for(let i=0;i<S*S;i++){if(!(f[i]>th)){d[i]=0;continue}let lo=0,hi=vals.length;while(lo<hi){const m=(lo+hi)>>1;if(vals[m]<f[i])lo=m+1;else hi=m}d[i]=Math.pow((lo+0.5)/vals.length,2)}return d}
const S=512,TS=256,n=64;
// 0.14-0.5 km = 3-10.7 texels@512 ; 0.5-6 km = 10.7-128 texels@512
for(const seed of [7,1007,2007]){
 const T=grf(TS,2.8,seed);const DX=grf(n,2.5,seed+1,8),DY=grf(n,2.5,seed+2,8);
 let s=0;for(let i=0;i<n*n;i++)s+=DX[i]*DX[i]+DY[i]*DY[i];const rms=Math.sqrt(s/(n*n));const amp=0.012/rms; // ~3 texels@256 rms displacement (288 m)
 const f512=compose(S,T,TS,DX,DY,n,amp);
 const f256=upsample(compose(256,T,TS,DX,DY,n,amp),256,S);
 for(const cover of [0.25,0.85]){
  const d1=rankSq(f512,S,cover),d2=rankSq(f256,S,cover);
  let diff=0,mask=0;for(let i=0;i<S*S;i++){if(Math.round(d1[i]*255)!==Math.round(d2[i]*255))diff++;if((d1[i]>0)!==(d2[i]>0))mask++}
  const a1=slope(d1,S,3,10.7),b1=slope(d1,S,10.7,128),a2=slope(d2,S,3,10.7),b2=slope(d2,S,10.7,128);
  console.log(`seed ${seed} cover ${cover}: compose@512 fine ${a1.toFixed(2)} coarse ${b1.toFixed(2)} diff ${(b1-a1).toFixed(2)} | compose@256+up fine ${a2.toFixed(2)} coarse ${b2.toFixed(2)} diff ${(b2-a2).toFixed(2)} | bytes differ ${(100*diff/(S*S)).toFixed(1)}% mask ${(100*mask/(S*S)).toFixed(2)}%`);
 }
 const t0=performance.now();compose(S,T,TS,DX,DY,n,amp);const t1=performance.now();const c=compose(256,T,TS,DX,DY,n,amp);const t2=performance.now();upsample(c,256,S);const t3=performance.now();
 console.log(`  time: compose@512 ${(t1-t0).toFixed(1)} ms, compose@256 ${(t2-t1).toFixed(1)} ms, upsample ${(t3-t2).toFixed(1)} ms`);
}
