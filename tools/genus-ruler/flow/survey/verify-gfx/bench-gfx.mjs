// Cost checks for the computer-graphics angle, on our grid (512^2 tile, N=64 dynamics). node, typed arrays.
const now = () => performance.now();
function rng(seed){ let s = seed>>>0 || 1; return () => { s ^= s<<13; s>>>=0; s ^= s>>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; }
const S = 512, N2 = S*S;
function bench(name, fn, reps=3){ fn(); let best=1e9; for(let r=0;r<reps;r++){ const t=now(); fn(); best=Math.min(best, now()-t);} console.log(name.padEnd(58), best.toFixed(1), 'ms'); return best; }
// periodic value noise like cloudGenus.periodicNoise
function pnoise(n, seed){ const r=rng(seed), g=new Float32Array(n*n); for(let i=0;i<n*n;i++) g[i]=r();
  return (u,v)=>{ const x=u*n,y=v*n,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0; const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    const i0=((x0%n)+n)%n,i1=(i0+1)%n,j0=((y0%n)+n)%n,j1=(j0+1)%n; const a=g[j0*n+i0],b=g[j0*n+i1],c=g[j1*n+i0],d=g[j1*n+i1]; const ab=a+(b-a)*sx; return ab+(c+(d-c)*sx-ab)*sy; }; }
function fbm(n0, oct, seed){ const ns=[]; for(let k=0;k<oct;k++) ns.push(pnoise(n0<<k, seed+k*101)); return (u,v)=>{ let s=0,a=0.5,w=0; for(const f of ns){ s+=a*f(u,v); w+=a; a*=0.5;} return s/w; }; }
// hash-based periodic Worley F1, cell count n per tile
function worleyF1(n, seed){ const r=rng(seed), px=new Float32Array(n*n), py=new Float32Array(n*n); for(let i=0;i<n*n;i++){px[i]=r();py[i]=r();}
  return (u,v)=>{ const x=u*n, y=v*n, ci=Math.floor(x), cj=Math.floor(y); let best=9;
    for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){ const i=(((ci+di)%n)+n)%n, j=(((cj+dj)%n)+n)%n; const ox=ci+di+px[j*n+i]-x, oy=cj+dj+py[j*n+i]-y; const d=ox*ox+oy*oy; if(d<best) best=d; }
    return Math.sqrt(best); }; }
const out = new Float32Array(N2);

// 1. Nubis type field: 2-octave fbm at 512^2
{ const f=fbm(4,2,1); bench('cand1 Nubis type field fbm 2 oct @512^2', ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++) out[y*S+x]=f((x+0.5)/S,(y+0.5)/S); }); }
// 2. Perlin-Worley: LF value noise (3 oct) + Worley F1 (9 cells, 8 cells/tile = 3 km) + remap at 512^2
{ const p=fbm(4,3,2), w=worleyF1(8,3); bench('cand2 Perlin-Worley (fbm3 + worley9 + remap) @512^2', ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S,v=(y+0.5)/S; const pw=p(u,v), wf=1-w(u,v); out[y*S+x]=Math.max(0,Math.min(1,(pw-wf)/(1-wf+1e-6))); } }); }
{ const p=fbm(4,3,2), w=worleyF1(8,3); const M=256, o2=new Float32Array(M*M); bench('cand2 same @256^2 (then bilinear up ~5 ms)', ()=>{ for(let y=0;y<M;y++) for(let x=0;x<M;x++){ const u=(x+0.5)/M,v=(y+0.5)/M; const pw=p(u,v), wf=1-w(u,v); o2[y*M+x]=Math.max(0,Math.min(1,(pw-wf)/(1-wf+1e-6))); } }); }
// 3. domain warp: 2 x fbm(3 oct) vector at 512^2
{ const a=fbm(8,3,4), b=fbm(8,3,5); bench('cand3 warp vec 2 x fbm3 @512^2', ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S,v=(y+0.5)/S; out[y*S+x]=a(u,v)+b(u,v);} }); }
{ const a=fbm(8,3,4), b=fbm(8,3,5); const M=128, o2=new Float32Array(M*M*2); bench('cand3 warp vec @128^2', ()=>{ for(let y=0;y<M;y++) for(let x=0;x<M;x++){ const u=(x+0.5)/M,v=(y+0.5)/M; o2[(y*M+x)*2]=a(u,v); o2[(y*M+x)*2+1]=b(u,v);} }); }
// 4/5. curl noise 3 octaves (|k| 16,32,64) via finite difference of value noise, evaluated at X = x - D (D from 64^2 bilinear): 2 bilinear + 3 oct x 4 noise taps
{ const ns=[pnoise(16,7),pnoise(32,8),pnoise(64,9)]; const amp=[1,0.35,0.125]; const DX=new Float32Array(64*64).map(()=>Math.random()*0.02), DY=new Float32Array(64*64).map(()=>Math.random()*0.02);
  const bl=(F,n,u,v)=>{ const x=(u-Math.floor(u))*n-0.5,y=(v-Math.floor(v))*n-0.5; let x0=Math.floor(x),y0=Math.floor(y); const fx=x-x0,fy=y-y0; x0=((x0%n)+n)%n; y0=((y0%n)+n)%n; const x1=(x0+1)%n,y1=(y0+1)%n; const a=F[y0*n+x0],b=F[y0*n+x1],c=F[y1*n+x0],d=F[y1*n+x1]; const ab=a+(b-a)*fx; return ab+(c+(d-c)*fx-ab)*fy; };
  const ox=new Float32Array(N2), oy=new Float32Array(N2);
  bench('cand5 wavelet-turb: 3-oct curl (FD, 4 taps/oct) at X @512^2', ()=>{ const e=1/1024; for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S,v=(y+0.5)/S; const X=u-bl(DX,64,u,v), Y=v-bl(DY,64,u,v); let cx=0,cy=0; for(let o=0;o<3;o++){ const f=ns[o]; cx+=amp[o]*(f(X,Y+e)-f(X,Y-e))/(2*e); cy-=amp[o]*(f(X+e,Y)-f(X-e,Y))/(2*e);} ox[y*S+x]=cx; oy[y*S+x]=cy; } });
  bench('cand5 same at 256^2 (then bilinear up)', ()=>{ const M=256, e=1/1024; for(let y=0;y<M;y++) for(let x=0;x<M;x++){ const u=(x+0.5)/M,v=(y+0.5)/M; const X=u-bl(DX,64,u,v), Y=v-bl(DY,64,u,v); let cx=0,cy=0; for(let o=0;o<3;o++){ const f=ns[o]; cx+=amp[o]*(f(X,Y+e)-f(X,Y-e))/(2*e); cy-=amp[o]*(f(X+e,Y)-f(X-e,Y))/(2*e);} ox[y*M+x]=cx; oy[y*M+x]=cy; } });
  // strain |grad u| on 64^2 from D Jacobian: negligible, measure anyway
  bench('cand5 Jacobian/strain of D on 64^2', ()=>{ const n=64; let s=0; for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const ip=(i+1)%n, im=(i+n-1)%n, jp=(j+1)%n, jm=(j+n-1)%n; const a=(DX[j*n+ip]-DX[j*n+im])*n/2, b=(DX[jp*n+i]-DX[jm*n+i])*n/2, c=(DY[j*n+ip]-DY[j*n+im])*n/2, d=(DY[jp*n+i]-DY[jm*n+i])*n/2; s+=Math.sqrt(a*a+b*b+c*c+d*d);} out[0]=s; });
}
// 7. LIC: 512^2, L=16 each way, RK2 on 64^2 velocity bilinear, noise bilinear 512^2
{ const n=64, U=new Float32Array(n*n).map(()=>Math.random()-0.5), V=new Float32Array(n*n).map(()=>Math.random()-0.5); const noise=new Float32Array(N2).map(()=>Math.random());
  const bl=(F,m,u,v)=>{ const x=(u-Math.floor(u))*m-0.5,y=(v-Math.floor(v))*m-0.5; let x0=Math.floor(x),y0=Math.floor(y); const fx=x-x0,fy=y-y0; x0=((x0%m)+m)%m; y0=((y0%m)+m)%m; const x1=(x0+1)%m,y1=(y0+1)%m; const a=F[y0*m+x0],b=F[y0*m+x1],c=F[y1*m+x0],d=F[y1*m+x1]; const ab=a+(b-a)*fx; return ab+(c+(d-c)*fx-ab)*fy; };
  const lic=(M,L)=>{ const h=1/M; for(let y=0;y<M;y++) for(let x=0;x<M;x++){ let acc=0,wsum=0; for(const sgn of [1,-1]){ let px=(x+0.5)/M, py=(y+0.5)/M; for(let s=0;s<L;s++){ let u=bl(U,n,px,py), v=bl(V,n,px,py); let m=Math.hypot(u,v)||1; const mx=px+sgn*h*0.5*u/m, my=py+sgn*h*0.5*v/m; u=bl(U,n,mx,my); v=bl(V,n,mx,my); m=Math.hypot(u,v)||1; px+=sgn*h*u/m; py+=sgn*h*v/m; acc+=bl(noise,S,px,py); wsum++; } } out[y*M+x]=acc/wsum; } };
  bench('cand7 LIC 512^2 L=16 (RK2, 32 taps x 3 bilinear)', ()=>lic(512,16), 1);
  bench('cand7 LIC 256^2 L=8', ()=>lic(256,8), 2);
  bench('cand7 LIC 128^2 L=8', ()=>lic(128,8), 2);
}
// 8. phasor noise: 128^2 complex sum over kernels in 3x3 cells (12 kernels/cell), then 512^2 bilinear + atan2 + sin
{ const n=16, K=12, r=rng(11); const kx=new Float32Array(n*n*K), ky=new Float32Array(n*n*K), ph=new Float32Array(n*n*K), th=new Float32Array(n*n*K);
  for(let i=0;i<n*n*K;i++){ kx[i]=r(); ky[i]=r(); ph[i]=r()*6.2832; th[i]=(r()-0.5)*0.5; }
  const M=128, re=new Float32Array(M*M), im=new Float32Array(M*M); const F0=8*n/ (24/3); // ~ lambda 3 km -> 8 cycles / tile.. scaled per cell
  bench('cand8 phasor complex field @128^2 (9 cells x 12 kernels)', ()=>{ const a=4.0; for(let y=0;y<M;y++) for(let x=0;x<M;x++){ const u=(x+0.5)/M*n, v=(y+0.5)/M*n, ci=Math.floor(u), cj=Math.floor(v); let sr=0, si=0;
      for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){ const i=(((ci+di)%n)+n)%n, j=(((cj+dj)%n)+n)%n; const base=(j*n+i)*K; for(let k=0;k<K;k++){ const dx=u-(ci+di+kx[base+k]), dy=v-(cj+dj+ky[base+k]); const g=Math.exp(-a*(dx*dx+dy*dy)); const o=th[base+k]; const arg=6.2832*1.0*(Math.cos(o)*dx+Math.sin(o)*dy)+ph[base+k]; sr+=g*Math.cos(arg); si+=g*Math.sin(arg);} }
      re[y*M+x]=sr; im[y*M+x]=si; } });
  bench('cand8 phasor @512^2: bilinear re/im + atan2 + sin', ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S*M-0.5, v=(y+0.5)/S*M-0.5; const x0=Math.floor(u), y0=Math.floor(v), fx=u-x0, fy=v-y0; const i0=(x0&127), i1=((x0+1)&127), j0=(y0&127), j1=((y0+1)&127); const a=re[j0*M+i0],b=re[j0*M+i1],c=re[j1*M+i0],d=re[j1*M+i1]; const ab=a+(b-a)*fx; const R=ab+(c+(d-c)*fx-ab)*fy; const a2=im[j0*M+i0],b2=im[j0*M+i1],c2=im[j1*M+i0],d2=im[j1*M+i1]; const ab2=a2+(b2-a2)*fx; const I=ab2+(c2+(d2-c2)*fx-ab2)*fy; out[y*S+x]=Math.sin(Math.atan2(I,R)); } });
  bench('cand8 phasor direct @512^2 (9 cells x 12 kernels)', ()=>{ const a=4.0; for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S*n, v=(y+0.5)/S*n, ci=Math.floor(u), cj=Math.floor(v); let sr=0, si=0;
      for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++){ const i=(((ci+di)%n)+n)%n, j=(((cj+dj)%n)+n)%n; const base=(j*n+i)*K; for(let k=0;k<K;k++){ const dx=u-(ci+di+kx[base+k]), dy=v-(cj+dj+ky[base+k]); const g=Math.exp(-a*(dx*dx+dy*dy)); const o=th[base+k]; const arg=6.2832*(Math.cos(o)*dx+Math.sin(o)*dy)+ph[base+k]; sr+=g*Math.cos(arg); si+=g*Math.sin(arg);} }
      out[y*S+x]=Math.sin(Math.atan2(si,sr)); } }, 1);
}
// 9. Lewis sparse convolution: Poisson impulses, lognormal radius, 5x5 cell search (radius <= 2 cells), smoothstep kernel, soft-max
{ const n=12, r=rng(13); const P=[]; for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const m=1+Math.floor(r()*2); for(let q=0;q<m;q++){ const g=Math.sqrt(-2*Math.log(Math.max(1e-9,r())))*Math.cos(6.2832*r()); P.push({x:(i+r())/n,y:(j+r())/n,R:Math.exp(Math.log(0.6/n)+0.6*g),a:0.5+0.5*r(),ci:i,cj:j}); } }
  const cell=Array.from({length:n*n},()=>[]); for(const p of P) cell[p.cj*n+p.ci].push(p);
  const wrapD=(a,b)=>{ let d=a-b; d-=Math.round(d); return d; };
  bench(`cand9 Lewis sparse conv @512^2 (${P.length} impulses, 5x5 cells)`, ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S, v=(y+0.5)/S, ci=Math.floor(u*n), cj=Math.floor(v*n); let sm=0;
      for(let dj=-2;dj<=2;dj++) for(let di=-2;di<=2;di++){ const L=cell[((((cj+dj)%n)+n)%n)*n+((((ci+di)%n)+n)%n)]; for(const p of L){ const dx=wrapD(u,p.x), dy=wrapD(v,p.y), rr=Math.sqrt(dx*dx+dy*dy)/p.R; if(rr<1){ const t=Math.max(0,Math.min(1,(1-rr)/0.4)); const h=p.a*t*t*(3-2*t); sm+=Math.exp(4*h);} } }
      out[y*S+x]=sm>0?Math.log(sm)/4:0; } }); }
// 11. parcel model: 300 parcels, soft-max, spatial hash 12x12 cells, radius <= 2 cells
{ const n=12, r=rng(17); const P=[]; for(let k=0;k<300;k++){ const x=r(), y=r(); const age=r(); P.push({x,y,R:(0.03+0.05*r())*Math.sin(Math.PI*age),a:Math.sqrt(age),ci:Math.floor(x*n),cj:Math.floor(y*n)}); }
  const cell=Array.from({length:n*n},()=>[]); for(const p of P) cell[p.cj*n+p.ci].push(p);
  const wrapD=(a,b)=>{ let d=a-b; d-=Math.round(d); return d; };
  bench('cand11 parcels 300 soft-max @512^2 (5x5 cells)', ()=>{ for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const u=(x+0.5)/S, v=(y+0.5)/S, ci=Math.floor(u*n), cj=Math.floor(v*n); let sm=0;
      for(let dj=-2;dj<=2;dj++) for(let di=-2;di<=2;di++){ const L=cell[((((cj+dj)%n)+n)%n)*n+((((ci+di)%n)+n)%n)]; for(const p of L){ const dx=wrapD(u,p.x), dy=wrapD(v,p.y), rr=Math.sqrt(dx*dx+dy*dy)/p.R; if(rr<1){ const t=Math.max(0,Math.min(1,(1-rr)/0.4)); sm+=Math.exp(4*p.a*t*t*(3-2*t));} } }
      out[y*S+x]=sm>0?Math.log(sm)/4:0; } }); }
// 6. IBFV crossfade per-second: mix two 512^2 byte tiles for one channel + requantize
{ const A=new Uint8Array(N2*4).map(()=>Math.random()*255), B=new Uint8Array(N2*4).map(()=>Math.random()*255), C=new Uint8Array(N2*4);
  bench('cand6 crossfade 2 RGBA8 tiles @512^2 (4 ch)', ()=>{ const w=0.37; for(let i=0;i<N2*4;i++) C[i]=(A[i]+(B[i]-A[i])*w)|0; }); }
// 10. CML 128^2 x 50 steps (T, qv, w) 8-neighbour diffusion
{ const n=128, T=new Float32Array(n*n), Q=new Float32Array(n*n).map(()=>Math.random()), W=new Float32Array(n*n), T2=new Float32Array(n*n), Q2=new Float32Array(n*n), C=new Float32Array(n*n);
  bench('cand10 CML 128^2 x 50 steps (3 fields, 8-nbr diffusion)', ()=>{ for(let s=0;s<50;s++){ for(let j=0;j<n;j++){ const jm=((j+n-1)%n)*n, jp=((j+1)%n)*n, j0=j*n; for(let i=0;i<n;i++){ const im=(i+n-1)%n, ip=(i+1)%n, k=j0+i;
      const lapT=(T[jm+i]+T[jp+i]+T[j0+im]+T[j0+ip])*0.2+(T[jm+im]+T[jm+ip]+T[jp+im]+T[jp+ip])*0.05-T[k];
      const lapQ=(Q[jm+i]+Q[jp+i]+Q[j0+im]+Q[j0+ip])*0.2+(Q[jm+im]+Q[jm+ip]+Q[jp+im]+Q[jp+ip])*0.05-Q[k];
      const qs=0.6*Math.exp(-0.5*T[k]); const cond=Math.max(0,Q[k]-qs); W[k]+=0.1*(T[k]-0.3)-0.05*W[k]; T2[k]=T[k]+0.2*lapT+0.3*cond-0.02*T[k]+0.01*W[k]; Q2[k]=Q[k]+0.2*lapQ-0.3*cond+0.01; C[k]=cond; } }
      T.set(T2); Q.set(Q2); } }); }
// 12. Nubis per-sample in-scatter: shader only; nothing to bench on CPU. 13. drift wobble: 0.
console.log('done');
