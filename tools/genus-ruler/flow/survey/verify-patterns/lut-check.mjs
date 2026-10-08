// Candidate 8: can a Beta-mixture quantile LUT satisfy T3 (entropy>=2.8 bit over 8-bit? we use tile.py bins), thinFrac 0.25-0.5, satFrac<=0.05
// AND keep the gamma=2 slope near rank 0 (T4)? Build Finv by sampling the mixture.
function rng(seed){ let s=seed>>>0||1; return ()=>{ s^=s<<13; s>>>=0; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
const R=rng(5);
function gamma(a){ // Marsaglia-Tsang
  if(a<1){ return gamma(a+1)*Math.pow(R(),1/a); }
  const d=a-1/3, c=1/Math.sqrt(9*d);
  for(;;){ let x,v; do{ const u1=Math.max(1e-12,R()),u2=R(); x=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2); v=1+c*x; }while(v<=0); v=v*v*v; const u=R(); if(u<1-0.0331*x*x*x*x) return d*v; if(Math.log(u)<0.5*x*x+d*(1-v+Math.log(v))) return d*v; }
}
function beta(a,b){ const x=gamma(a), y=gamma(b); return x/(x+y); }
function stats(name, sampler, N=200000){
  const s=new Float64Array(N); for(let i=0;i<N;i++) s[i]=sampler(); s.sort();
  const thin=s.filter(v=>v<0.2).length/N, sat=s.filter(v=>v>=0.99).length/N;
  // entropy over 32 bins (tile.py uses 32 bins? we report both 32 and 64)
  const ent=(nb)=>{ const h=new Float64Array(nb); for(const v of s){ h[Math.min(nb-1,Math.floor(v*nb))]++; } let e=0; for(const c of h){ if(c>0){ const p=c/N; e-=p*Math.log2(p);} } return e; };
  // slope near rank 0: d at u=0.01 and u=0.05 (rank^2 gives 1e-4, 2.5e-3)
  const q=(u)=>s[Math.floor(u*(N-1))];
  const bc=()=>{ // bimodality coefficient (skew^2+1)/kurt
    let m=0; for(const v of s) m+=v; m/=N; let m2=0,m3=0,m4=0; for(const v of s){ const d=v-m; m2+=d*d; m3+=d*d*d; m4+=d*d*d*d; } m2/=N;m3/=N;m4/=N; const sk=m3/Math.pow(m2,1.5), ku=m4/(m2*m2); return (sk*sk+1)/ku; };
  console.log(name, {p10:+q(0.1).toFixed(3), p50:+q(0.5).toFixed(3), p90:+q(0.9).toFixed(3), thin:+thin.toFixed(3), sat:+sat.toFixed(3), ent32:+ent(32).toFixed(2), ent64:+ent(64).toFixed(2), d_u001:q(0.01).toExponential(2), d_u005:q(0.05).toExponential(2), bimodBC:+bc().toFixed(3)});
}
stats('rank^2 (today)', ()=>Math.pow(R(),2));
stats('Beta(0.5,1)=rank^2 check', ()=>beta(0.5,1));
stats('ac mix 0.6B(2,5)+0.4B(6,2)', ()=> R()<0.6?beta(2,5):beta(6,2));
stats('first-guess cover0.3 B(1.6,3.8)', ()=>beta(1.6,3.8));
stats('first-guess cover0.85 B(2.7,1.6)', ()=>beta(2.7,1.6));
// mixture that keeps the u^2 toe: 0.5*rank^2-like Beta(0.5,1.2) + 0.5*Beta(6,2) (interior mode) 
stats('toe-safe 0.55B(0.5,1.2)+0.45B(6,2)', ()=> R()<0.55?beta(0.5,1.2):beta(6,2));
stats('toe-safe 0.6B(0.5,1.0)+0.4B(5,2.5)', ()=> R()<0.6?beta(0.5,1.0):beta(5,2.5));
