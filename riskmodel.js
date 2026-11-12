/* Property Risk Lens · loss model
   A transparent frequency-severity model for one commercial property and for a portfolio.
     ground-up loss  = replacement cost x damage ratio          (per occurrence, per peril)
     insured loss    = min(limit, max(0, ground-up - deductible))
     annual loss     = sum over perils and occurrences in the year
   Three layers of method:
   1. Analytic expected loss (AAL) per peril, by integrating the severity curve through the policy terms.
   2. Parameter uncertainty: every input that is not backed by a sourced fact is drawn from a range, giving a
      distribution of AAL (how sure the model is) and first-order Sobol indices (which unknown drives it).
   3. Monte Carlo years with shared earthquake events and shared fire-weather years, giving exceedance curves,
      tail value at risk, and each property's share of the portfolio tail (co-TVaR, Euler allocation).
   PARAMETERS ARE ILLUSTRATIVE. They are chosen to be plausible, not fitted to loss data. Seeded, so repeatable. */
(function(root){
function rng(seed){let a=seed>>>0;return ()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function normal(r){let u=0;while(u===0)u=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*r())}
function gamma(r,k){if(k<1)return gamma(r,k+1)*Math.pow(r()||1e-12,1/k);const d=k-1/3,c=1/Math.sqrt(9*d);for(;;){let x,v;do{x=normal(r);v=1+c*x}while(v<=0);v=v*v*v;const u=r();if(u<1-0.0331*x*x*x*x||Math.log(u)<0.5*x*x+d*(1-v+Math.log(v)))return d*v}}
function beta(r,a,b){const x=gamma(r,a),y=gamma(r,b);return x/(x+y)}
function poisson(r,l){if(l<=0)return 0;const L=Math.exp(-l);let k=0,p=1;do{k++;p*=r()}while(p>L);return k-1}

/* ---- peril definitions: frequency inputs, severity inputs, base rates (illustrative) ---- */
const PERILS=[
 {k:'flood',label:'Flood',freqIn:[],sevIn:[],note:'Annual chance set by the mapped flood zone'},
 {k:'fire',label:'Fire',base:0.010,freqIn:['cons','prot','spr','sys','occ','loss'],sevIn:[],note:'Mostly partial losses, with a one-in-ten chance of a severe fire'},
 {k:'water',label:'Water and other',base:0.050,freqIn:['roof','sys','loss'],sevIn:[],note:'Frequent, small: pipe breaks, roof leaks, wind'},
 {k:'wildfire',label:'Wildfire',freqIn:['mit'],sevIn:[],note:'Burn probability of the grid cell; a burned building is often a large loss'},
 {k:'eq',label:'Earthquake',freqIn:[],sevIn:['liq','eqc','ret'],note:'Three regional event sizes shared by every property'}
];
const FLOOD_RATE=z=>/^(AE|A|V)/.test(z)?0.010:/\(shaded/.test(z)?0.002:0.0004;
const EQ_EVENTS=[{name:'Moderate (about M6.0)',rate:1/30,dr:0.02},{name:'Strong (about M6.7)',rate:1/120,dr:0.08},{name:'Major (M7.2 or larger)',rate:1/475,dr:0.22}];
const FIRE_WX={p:0.12,bad:4.0}; /* one year in eight is a bad fire-weather year for the whole region */
FIRE_WX.good=(1-FIRE_WX.p*FIRE_WX.bad)/(1-FIRE_WX.p);
const M=8192; /* points used to integrate each damage curve */
/* unit severity samples per peril, generated once (common random numbers keep comparisons stable) */
const SEV=(()=>{const mk=(seed,f)=>{const r=rng(seed),a=new Float64Array(M);for(let i=0;i<M;i++)a[i]=f(r);return a};
  return {flood:mk(11,r=>beta(r,1.8,5.5)),fire:mk(12,r=>r()<0.9?beta(r,1.1,22):beta(r,2,2.5)),water:mk(13,r=>beta(r,1.3,55)),wildfire:mk(14,r=>beta(r,2.2,1.6)),
    eq:mk(15,r=>Math.exp(0.6*normal(r)-0.18))}})(); /* eq: lognormal multiplier with mean 1 */
const prod=(f,keys)=>keys.reduce((a,k)=>a*(f[k]==null?1:f[k]),1);
const freq=(spec,f,pk)=>pk==='flood'?FLOOD_RATE(spec.floodZone):pk==='fire'?0.010*prod(f,PERILS[1].freqIn):pk==='water'?0.050*prod(f,PERILS[2].freqIn):pk==='wildfire'?spec.burnProb*(f.mit==null?1:f.mit):EQ_EVENTS.reduce((a,e)=>a+e.rate,0);
function terms(spec,pk,tiv){const limit=pk==='flood'?Math.min(spec.floodLimit,spec.limit):spec.limit;const ded=pk==='eq'?spec.eqDedPct/100*spec.limit:spec.ded;return {limit,ded,tiv}}
const insured=(gu,t)=>Math.min(t.limit,Math.max(0,gu-t.ded));
const eqMult=f=>prod(f,['liq','eqc','ret']);
/* expected insured and ground-up loss per occurrence, by integrating the unit severity samples */
function sevMean(spec,f,pk,tiv){
  const t=terms(spec,pk,tiv);let ins=0,gu=0;
  if(pk==='eq'){const m=eqMult(f),R=EQ_EVENTS.reduce((a,e)=>a+e.rate,0);
    for(const e of EQ_EVENTS){let si=0,sg=0;for(let i=0;i<M;i++){const g=tiv*Math.min(0.95,e.dr*m*SEV.eq[i]);sg+=g;si+=insured(g,t)}ins+=e.rate/R*si/M;gu+=e.rate/R*sg/M}}
  else{const S=SEV[pk];for(let i=0;i<M;i++){const g=tiv*S[i];gu+=g;ins+=insured(g,t)}ins/=M;gu/=M}
  return {ins,gu,t};
}
/* 1. analytic expected annual loss */
function aal(spec,f=spec.f,tivMult=1){
  const tiv=spec.tiv*tivMult,per={};let total=0,totalGu=0;
  for(const P of PERILS){const l=freq(spec,f,P.k),s=sevMean(spec,f,P.k,tiv);per[P.k]={freq:l,sevIns:s.ins,sevGu:s.gu,dr:s.gu/tiv,aal:l*s.ins,aalGu:l*s.gu,limit:s.t.limit,ded:s.t.ded};total+=l*s.ins;totalGu+=l*s.gu}
  return {per,total,totalGu,tiv};
}
/* 2. parameter uncertainty: open inputs drawn from triangular(lo, value, hi) */
function tri(r,lo,mode,hi){if(hi<=lo)return mode;const u=r(),c=(mode-lo)/(hi-lo);return u<c?lo+Math.sqrt(u*(hi-lo)*(mode-lo)):hi-Math.sqrt((1-u)*(hi-lo)*(hi-mode))}
function uncertainty(spec,K=1500){
  const r=rng(hashStr(spec.id)^0x9e3779b9),U=spec.open,out=new Float64Array(K),X=U.map(()=>new Float64Array(K));
  for(let k=0;k<K;k++){const f={...spec.f};let tm=1;
    U.forEach((u,j)=>{const x=tri(r,u.lo,u.v,u.hi);X[j][k]=x;if(u.tiv)tm*=x;else f[u.k]=x});
    out[k]=aal(spec,f,tm).total}
  const sorted=Float64Array.from(out).sort(),q=p=>sorted[Math.min(K-1,Math.floor(p*K))];
  let mean=0;for(let k=0;k<K;k++)mean+=out[k];mean/=K;let v=0;for(let k=0;k<K;k++)v+=(out[k]-mean)**2;v/=K;
  /* first-order Sobol index by binning: Var(E[AAL | input]) / Var(AAL) */
  const B=15,sob=U.map((u,j)=>{if(v===0)return 0;const idx=Array.from({length:K},(_,i)=>i).sort((a,b)=>X[j][a]-X[j][b]);let acc=0;
    for(let b=0;b<B;b++){let m=0,n=0;for(let i=Math.floor(b*K/B);i<Math.floor((b+1)*K/B);i++){m+=out[idx[i]];n++}m/=n;acc+=n*(m-mean)**2}
    return Math.max(0,acc/K/v-(B-1)/K)});
  const tot=sob.reduce((a,b)=>a+b,0)||1;
  return {K,mean,sd:Math.sqrt(v),p10:q(0.10),p50:q(0.50),p90:q(0.90),min:sorted[0],max:sorted[K-1],draws:sorted,
    drivers:U.map((u,j)=>({...u,sobol:sob[j],share:sob[j]/Math.max(tot,1)})).sort((a,b)=>b.sobol-a.sobol),explained:Math.min(1,tot)};
}
/* 3. Monte Carlo years. Earthquake events and fire weather are drawn once per year for the whole region. */
function simulate(specs,N=100000,seed=206,pick='v'){
  const R=rng(seed),eqEv=new Int8Array(N),wx=new Float32Array(N),eqR=EQ_EVENTS.reduce((a,e)=>a+e.rate,0);
  for(let y=0;y<N;y++){const u=R();let c=0,ev=-1;for(let i=0;i<EQ_EVENTS.length;i++){c+=EQ_EVENTS[i].rate;if(u<c){ev=i;break}}eqEv[y]=ev;wx[y]=R()<FIRE_WX.p?FIRE_WX.bad:FIRE_WX.good}
  const props=specs.map(spec=>{
    const f={...spec.f};let tm=1;
    if(pick!=='v')spec.open.forEach(u=>{const x=pick==='lo'?u.lo:u.hi;if(u.tiv)tm*=x;else f[u.k]=x});
    const tiv=spec.tiv*tm,r=rng(hashStr(spec.id)),loss=new Float64Array(N),per={};PERILS.forEach(P=>per[P.k]=0);
    const lam={flood:freq(spec,f,'flood'),fire:freq(spec,f,'fire'),water:freq(spec,f,'water'),wildfire:freq(spec,f,'wildfire')},T={};PERILS.forEach(P=>T[P.k]=terms(spec,P.k,tiv));
    const m=eqMult(f);
    for(let y=0;y<N;y++){let tot=0;
      for(const pk of ['flood','fire','water','wildfire']){const n=poisson(r,pk==='wildfire'?lam[pk]*wx[y]:lam[pk]);
        for(let i=0;i<n;i++){const dr=pk==='flood'?beta(r,1.8,5.5):pk==='fire'?(r()<0.9?beta(r,1.1,22):beta(r,2,2.5)):pk==='water'?beta(r,1.3,55):beta(r,2.2,1.6);const x=insured(tiv*dr,T[pk]);tot+=x;per[pk]+=x}}
      if(eqEv[y]>=0){const x=insured(tiv*Math.min(0.95,EQ_EVENTS[eqEv[y]].dr*m*Math.exp(0.6*normal(r)-0.18)),T.eq);tot+=x;per.eq+=x}
      loss[y]=tot}
    PERILS.forEach(P=>per[P.k]/=N);
    return {id:spec.id,loss,per};
  });
  const total=new Float64Array(N);props.forEach(p=>{for(let y=0;y<N;y++)total[y]+=p.loss[y]});
  return {N,props,total,eqEv,wx};
}
const RP=[2,5,10,25,50,100,250,500,1000];
function metrics(loss){
  const N=loss.length,s=Float64Array.from(loss).sort(),at=rp=>s[Math.min(N-1,Math.max(0,Math.ceil(N*(1-1/rp))-1))];
  let mean=0,nz=0;for(let i=0;i<N;i++){mean+=loss[i];if(loss[i]>0)nz++}mean/=N;
  const n1=Math.max(1,Math.round(N*0.01));let t=0;for(let i=N-n1;i<N;i++)t+=s[i];
  return {aal:mean,pAny:nz/N,ep:RP.map(rp=>({rp,loss:at(rp)})),var99:at(100),pml100:at(100),pml250:at(250),tvar99:t/n1,max:s[N-1],sorted:s};
}
/* each property's share of the portfolio's worst 1% of years (co-TVaR); the shares add up to portfolio TVaR */
function allocation(sim){
  const N=sim.N,n1=Math.max(1,Math.round(N*0.01)),idx=Array.from({length:N},(_,i)=>i).sort((a,b)=>sim.total[b]-sim.total[a]).slice(0,n1);
  const co=sim.props.map(p=>{let s=0;idx.forEach(y=>s+=p.loss[y]);return s/n1});
  const alone=sim.props.map(p=>metrics(p.loss).tvar99),port=metrics(sim.total);
  const eqYears=idx.filter(y=>sim.eqEv[y]>=0).length,wxYears=idx.filter(y=>sim.wx[y]>1).length;
  return {co,alone,tvar:port.tvar99,sumAlone:alone.reduce((a,b)=>a+b,0),tailEq:eqYears/n1,tailWx:wxYears/n1};
}
const api={PERILS,EQ_EVENTS,FIRE_WX,FLOOD_RATE,RP,aal,uncertainty,simulate,metrics,allocation,rng};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RiskModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
