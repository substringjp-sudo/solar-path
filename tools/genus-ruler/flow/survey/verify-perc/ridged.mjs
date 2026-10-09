// Candidate 9(i): ridged term r = 1-|g| added to a q0-like field. Measure top-cover set: pieces, largestFrac, elongIQR, perim/area.
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function fft1(re,im,off,stride,n,inv){for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const a=off+i*stride,b=off+j*stride;let t=re[a];re[a]=re[b];re[b]=t;t=im[a];im[a]=im[b];im[b]=t}}
for(let len=2;len<=n;len<<=1){const ang=2*Math.PI/len*(inv?1:-1);const wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const a=off+(i+k)*stride,b=off+(i+k+len/2)*stride;const tr=re[b]*cr-im[b]*ci,ti=re[b]*ci+im[b]*cr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr}}}
if(inv)for(let i=0;i<n;i++){re[off+i*stride]/=n;im[off+i*stride]/=n}}
function fft2(re,im,n,inv){for(let y=0;y<n;y++)fft1(re,im,y*n,1,n,inv);for(let x=0;x<n;x++)fft1(re,im,x,n,n,inv)}
function grf(n,beta,seed,kmax){const r=mulberry32(seed);const re=new Float64Array(n*n),im=new Float64Array(n*n);
for(let y=0;y<n;y++)for(let x=0;x<n;x++){const kx=x<=n/2?x:x-n,ky=y<=n/2?y:y-n;const k=Math.hypot(kx,ky);if(k===0||k>kmax)continue;const a=Math.pow(k,-beta/2);const ph=r()*2*Math.PI;const g=Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r());re[y*n+x]=a*g*Math.cos(ph);im[y*n+x]=a*g*Math.sin(ph)}
fft2(re,im,n,true);const f=Float32Array.from(re);let m=0,s=0;for(const v of f)m+=v;m/=f.length;for(const v of f)s+=(v-m)*(v-m);s=Math.sqrt(s/f.length);for(let i=0;i<f.length;i++)f[i]=(f[i]-m)/s;return f}
function bil(F,n,u,v){u=u-Math.floor(u);v=v-Math.floor(v);const x=u*n-0.5,y=v*n-0.5;let x0=Math.floor(x),y0=Math.floor(y);const fx=x-x0,fy=y-y0;x0=((x0%n)+n)%n;y0=((y0%n)+n)%n;const x1=(x0+1)%n,y1=(y0+1)%n;return F[y0*n+x0]*(1-fx)*(1-fy)+F[y0*n+x1]*fx*(1-fy)+F[y1*n+x0]*(1-fx)*fy+F[y1*n+x1]*fx*fy}
function stats(mask,S){ // periodic 4-conn label
 const lab=new Int32Array(S*S).fill(-1);const pieces=[];for(let i=0;i<S*S;i++){if(!mask[i]||lab[i]>=0)continue;const id=pieces.length;const st=[i];lab[i]=id;const px=[];while(st.length){const j=st.pop();px.push(j);const x=j%S,y=(j-x)/S;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const k=((y+dy+S)%S)*S+((x+dx+S)%S);if(mask[k]&&lab[k]<0){lab[k]=id;st.push(k)}}}pieces.push(px)}
 const areas=pieces.map(p=>p.length);const tot=areas.reduce((a,b)=>a+b,0);const big=pieces.filter(p=>p.length>=16);
 let perim=0;for(let i=0;i<S*S;i++){if(!mask[i])continue;const x=i%S,y=(i-x)/S;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){if(!mask[((y+dy+S)%S)*S+((x+dx+S)%S)])perim++}}
 const el=big.map(p=>{ // unwrap via first pixel reference
  const x0=p[0]%S,y0=(p[0]-x0)/S;let sx=0,sy=0,sxx=0,syy=0,sxy=0;for(const j of p){let x=j%S,y=(j-x)/S;x-=x0;y-=y0;if(x>S/2)x-=S;if(x<-S/2)x+=S;if(y>S/2)y-=S;if(y<-S/2)y+=S;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y}const n=p.length;const cx=sx/n,cy=sy/n;const a=sxx/n-cx*cx,b=syy/n-cy*cy,c=sxy/n-cx*cy;const tr=a+b,det=a*b-c*c;const disc=Math.sqrt(Math.max(0,tr*tr/4-det));const l1=tr/2+disc,l2=Math.max(tr/2-disc,1e-9);return Math.log(Math.sqrt(l1/l2))}).sort((a,b)=>a-b);
 const q=(arr,p)=>arr.length?arr[Math.min(arr.length-1,Math.floor(p*arr.length))]:NaN;
 const areaMean=tot/areas.length;let v=0;for(const a of areas)v+=(a-areaMean)**2;const cv=Math.sqrt(v/areas.length)/areaMean;
 return {pieces:pieces.length,largestFrac:Math.max(...areas)/tot,elongIQR:(q(el,.75)-q(el,.25)),elongMed:q(el,.5),perimPerArea:perim/tot,areaCV:cv}}
const S=256,n=64;
for(const seed of [7,1007,2007]){
 const Q=grf(n,4,seed,12);         // q0: power k^-4 (|q|~k^-2), kq 12
 const Z=grf(n,2.5*2-2,seed+5,8);  // zeta-like
 const G=grf(n,5,seed+9,8);        // ridged base: psi-like k^-2.5 amplitude, |k|<=8
 const G2=grf(n,3,seed+9,16);      // rougher ridge base
 for(const [name,wR,base,sign] of [['none',0,G,1],['ridge0.3',0.3,G,1],['ridge0.6',0.6,G,1],['valley0.3',0.3,G,-1],['ridge0.3 k16',0.3,G2,1],['ridge1.0',1.0,G,1]]){
  const f=new Float32Array(S*S);for(let y=0;y<S;y++)for(let x=0;x<S;x++){const u=(x+.5)/S,v=(y+.5)/S;const g=bil(base,n,u,v);f[y*S+x]=1.0*bil(Q,n,u,v)+0.4*bil(Z,n,u,v)+wR*sign*(1-Math.abs(g))}
  for(const cover of [0.25]){const idx=Array.from(f.keys()).sort((a,b)=>f[a]-f[b]);const th=f[idx[Math.floor((1-cover)*(S*S-1))]];const mask=new Uint8Array(S*S);for(let i=0;i<S*S;i++)mask[i]=f[i]>th?1:0;
   const s=stats(mask,S);console.log(`seed ${seed} ${name.padEnd(14)} cover ${cover}: pieces ${s.pieces} largestFrac ${s.largestFrac.toFixed(2)} areaCV ${s.areaCV.toFixed(2)} elongMed ${s.elongMed.toFixed(2)} elongIQR ${s.elongIQR.toFixed(2)} perim/area ${s.perimPerArea.toFixed(3)}`)}
 }
}
