function rng(seed){ let s=seed>>>0||1; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
const R=rng(5);
function gamma(a){ if(a<1){ return gamma(a+1)*Math.pow(R(),1/a); } const d=a-1/3, c=1/Math.sqrt(9*d);
  for(;;){ let x,v; do{ const u1=Math.max(1e-12,R()),u2=R(); x=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2); v=1+c*x; }while(v<=0); v=v*v*v; const u=R(); if(u<1-0.0331*x*x*x*x) return d*v; if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v))) return d*v; } }
function beta(a,b){ const x=gamma(a), y=gamma(b); return x/(x+y); }
function ent10(name, f, N=200000){ const h=new Float64Array(10); for(let i=0;i<N;i++){ h[Math.min(9,Math.floor(f()*10))]++; } let e=0; for(const c of h){ if(c>0){ const p=c/N; e-=p*Math.log2(p);} } console.log(name, 'ent10', e.toFixed(2)); }
ent10('rank^2', ()=>Math.pow(R(),2));
ent10('ac mix 0.6B(2,5)+0.4B(6,2)', ()=> R()<0.6?beta(2,5):beta(6,2));
ent10('toe-safe 0.55B(0.5,1.2)+0.45B(6,2)', ()=> R()<0.55?beta(0.5,1.2):beta(6,2));
ent10('toe-safe 0.6B(0.5,1.0)+0.4B(5,2.5)', ()=> R()<0.6?beta(0.5,1.0):beta(5,2.5));
ent10('B(1.6,3.8)', ()=>beta(1.6,3.8));
