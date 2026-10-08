// Micro-benchmarks for pattern-formation candidates on the weather-tile grid (node, Float32/64 typed arrays).
const now = () => performance.now();
function rng(seed){ let s = seed>>>0 || 1; return () => { s ^= s<<13; s>>>=0; s ^= s>>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; }

// ---- in-place complex FFT 2D (radix-2, same spirit as cloudFlow.fft2) ----
function fft1(re, im, n, off, stride, inv){
  for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ const a=off+i*stride,b=off+j*stride; let t=re[a];re[a]=re[b];re[b]=t; t=im[a];im[a]=im[b];im[b]=t; } }
  for (let len=2; len<=n; len<<=1){ const ang=2*Math.PI/len*(inv?1:-1), wr=Math.cos(ang), wi=Math.sin(ang);
    for (let i=0;i<n;i+=len){ let cr=1, ci=0; for(let k=0;k<len/2;k++){ const a=off+(i+k)*stride, b=off+(i+k+len/2)*stride;
      const xr=re[b]*cr-im[b]*ci, xi=re[b]*ci+im[b]*cr; re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t; } } }
  if(inv){ for(let i=0;i<n;i++){ re[off+i*stride]/=n; im[off+i*stride]/=n; } }
}
function fft2(re,im,n,inv){ for(let j=0;j<n;j++) fft1(re,im,n,j*n,1,inv); for(let i=0;i<n;i++) fft1(re,im,n,i,n,inv); }

// ---- 1. Swift–Hohenberg, semi-implicit spectral: u_t = r u - (1+∇²)² u + g2 u² - u³ ----
function benchSH(n, steps, g2){
  const r=0.3, dt=1.0, k0=1, L=2*Math.PI*n/ (8*k0); // ~8 cells across the tile at k0 = 1 → scale: 8 wavelengths per tile
  const re=new Float64Array(n*n), im=new Float64Array(n*n), lin=new Float64Array(n*n);
  const R=rng(7); for(let i=0;i<n*n;i++) re[i]=(R()-0.5)*0.1;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const kx=(i<n/2?i:i-n)*2*Math.PI/L, ky=(j<n/2?j:j-n)*2*Math.PI/L; const q=1-(kx*kx+ky*ky); lin[j*n+i]=r-q*q; }
  const nl=new Float64Array(n*n), nim=new Float64Array(n*n);
  const t0=now();
  for(let s=0;s<steps;s++){
    for(let i=0;i<n*n;i++){ const u=re[i]; nl[i]=g2*u*u-u*u*u; nim[i]=0; }
    fft2(nl,nim,n,false); im.fill(0); fft2(re,im,n,false);
    for(let i=0;i<n*n;i++){ const d=1-dt*lin[i]; re[i]=(re[i]+dt*nl[i])/d; im[i]=(im[i]+dt*nim[i])/d; }
    fft2(re,im,n,true);
  }
  const ms=now()-t0; let mx=0; for(let i=0;i<n*n;i++) mx=Math.max(mx,Math.abs(re[i]));
  return {ms:+ms.toFixed(1), amp:+mx.toFixed(2)};
}

// ---- 2. Gray–Scott explicit (Pearson 1993), 5-point Laplacian, periodic ----
function benchGS(n, steps){
  const F=0.037, k=0.06, Du=0.2, Dv=0.1, dt=1; // "spots/holes" regime-ish
  let U=new Float32Array(n*n).fill(1), V=new Float32Array(n*n); let U2=new Float32Array(n*n), V2=new Float32Array(n*n);
  const R=rng(3); for(let i=0;i<n*n;i++) if(R()<0.02){U[i]=0.5;V[i]=0.25;}
  const t0=now();
  for(let s=0;s<steps;s++){
    for(let j=0;j<n;j++){ const jm=((j-1+n)%n)*n, jp=((j+1)%n)*n, j0=j*n;
      for(let i=0;i<n;i++){ const im=(i-1+n)%n, ip=(i+1)%n, c=j0+i;
        const lu=U[jm+i]+U[jp+i]+U[j0+im]+U[j0+ip]-4*U[c], lv=V[jm+i]+V[jp+i]+V[j0+im]+V[j0+ip]-4*V[c];
        const uvv=U[c]*V[c]*V[c]; U2[c]=U[c]+dt*(Du*lu-uvv+F*(1-U[c])); V2[c]=V[c]+dt*(Dv*lv+uvv-(F+k)*V[c]); } }
    let t=U;U=U2;U2=t; t=V;V=V2;V2=t;
  }
  return {ms:+(now()-t0).toFixed(1)};
}

// ---- 3. Turing box-kernel (Young 1984 two-disk activator/inhibitor), SAT box blurs, periodic via tiling ----
function satBlur(a, n, r, out){ // box blur radius r, periodic, separable running sums
  const tmp=new Float32Array(n*n); const w=2*r+1;
  for(let j=0;j<n;j++){ const o=j*n; let s=0; for(let i=-r;i<=r;i++) s+=a[o+((i+n)%n)]; for(let i=0;i<n;i++){ tmp[o+i]=s/w; s+=a[o+((i+r+1)%n)]-a[o+((i-r+n)%n)]; } }
  for(let i=0;i<n;i++){ let s=0; for(let j=-r;j<=r;j++) s+=tmp[((j+n)%n)*n+i]; for(let j=0;j<n;j++){ out[j*n+i]=s/w; s+=tmp[((j+r+1)%n)*n+i]-tmp[((j-r+n)%n)*n+i]; } }
}
function benchTuring(n, steps, r1, r2){
  const u=new Float32Array(n*n), b1=new Float32Array(n*n), b2=new Float32Array(n*n); const R=rng(11); for(let i=0;i<n*n;i++) u[i]=R()-0.5;
  const t0=now();
  for(let s=0;s<steps;s++){ satBlur(u,n,r1,b1); satBlur(u,n,r2,b2); let mx=0; for(let i=0;i<n*n;i++){ u[i]+= (b1[i]>b2[i]?0.05:-0.05); mx=Math.max(mx,Math.abs(u[i])); } for(let i=0;i<n*n;i++) u[i]/=mx; }
  return {ms:+(now()-t0).toFixed(1)};
}

// ---- 4. 2-D Kuramoto–Sivashinsky spectral semi-implicit: u_t = -∇²u - ∇⁴u - ½|∇u|² ----
function benchKS2(n, steps){
  const L=32*Math.PI, dt=0.2; const re=new Float64Array(n*n), im=new Float64Array(n*n), lin=new Float64Array(n*n), kx=new Float64Array(n), ky=new Float64Array(n);
  for(let i=0;i<n;i++) kx[i]=(i<n/2?i:i-n)*2*Math.PI/L; for(let j=0;j<n;j++) ky[j]=kx[j];
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const k2=kx[i]*kx[i]+ky[j]*ky[j]; lin[j*n+i]=k2-k2*k2; }
  const R=rng(5); for(let i=0;i<n*n;i++) re[i]=(R()-0.5)*0.1;
  const t0=now();
  const gxr=new Float64Array(n*n), gxi=new Float64Array(n*n), gyr=new Float64Array(n*n), gyi=new Float64Array(n*n), nl=new Float64Array(n*n), nim=new Float64Array(n*n);
  for(let s=0;s<steps;s++){
    im.fill(0); fft2(re,im,n,false);
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const c=j*n+i; gxr[c]=-kx[i]*im[c]; gxi[c]=kx[i]*re[c]; gyr[c]=-ky[j]*im[c]; gyi[c]=ky[j]*re[c]; }
    fft2(gxr,gxi,n,true); fft2(gyr,gyi,n,true);
    for(let i=0;i<n*n;i++){ nl[i]=-0.5*(gxr[i]*gxr[i]+gyr[i]*gyr[i]); nim[i]=0; }
    fft2(nl,nim,n,false);
    for(let i=0;i<n*n;i++){ const d=1-dt*lin[i]; re[i]=(re[i]+dt*nl[i])/d; im[i]=(im[i]+dt*nim[i])/d; }
    fft2(re,im,n,true);
  }
  return {ms:+(now()-t0).toFixed(1)};
}

// ---- 5. Cumulus life-cycle cellular automaton (Dobashi 2000 rules: hum/act/cld bits) ----
function benchCA(n, steps){
  let hum=new Uint8Array(n*n), act=new Uint8Array(n*n), cld=new Uint8Array(n*n), age=new Uint16Array(n*n);
  const R=rng(9); for(let i=0;i<n*n;i++){ hum[i]=R()<0.4?1:0; act[i]=R()<0.02?1:0; }
  let h2=new Uint8Array(n*n), a2=new Uint8Array(n*n), c2=new Uint8Array(n*n);
  const t0=now();
  for(let s=0;s<steps;s++){
    for(let j=0;j<n;j++){ const jm=((j-1+n)%n)*n, jp=((j+1)%n)*n, j0=j*n; for(let i=0;i<n;i++){ const im=(i-1+n)%n, ip=(i+1)%n, c=j0+i;
      const f=act[jm+i]|act[jp+i]|act[j0+im]|act[j0+ip]|act[jm+im]|act[jp+ip];
      a2[c]=(!act[c]&hum[c]&f)|0; h2[c]=(hum[c]&!act[c])|0; c2[c]=(cld[c]|act[c])|0;
      const r=R(); if(r<0.02) c2[c]=0; if(r>0.98) h2[c]=1; age[c]=c2[c]?age[c]+1:0; } }
    let t=hum;hum=h2;h2=t; t=act;act=a2;a2=t; t=cld;cld=c2;c2=t;
  }
  return {ms:+(now()-t0).toFixed(1)};
}

console.log('CA 128^2 x40', benchCA(128,40));
console.log('CA 256^2 x40', benchCA(256,40));
