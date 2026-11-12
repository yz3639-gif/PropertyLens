// Sanity tests for the loss model. Run: node matching-scripts/riskmodel.test.js
const RM=require('../riskmodel.js');
const mk=(id,tiv,o={})=>({id,tiv,limit:tiv,ded:25000,eqDedPct:10,floodLimit:500000,floodZone:'X (unshaded)',burnProb:0.002,
  f:{cons:0.9,roof:1,sys:1.1,prot:0.95,spr:1,occ:1.1,mit:1,loss:1,liq:1.25,eqc:1.2,ret:1.15},
  open:[{k:'sys',lo:0.9,v:1.1,hi:1.15},{k:'loss',lo:0.9,v:1,hi:1.35},{k:'ret',lo:0.85,v:1.15,hi:1.25},{k:'rc',tiv:true,lo:0.95,v:1,hi:1.18}],...o});
const specs=[mk('oak',2.4e6),mk('harbor',5e6,{floodZone:'AE',burnProb:0.0005,f:{cons:0.85,roof:1.1,sys:0.95,prot:0.95,spr:0.85,occ:1.25,mit:1,loss:1,liq:1,eqc:0.8,ret:1}}),mk('canyon',2.2e6,{burnProb:0.015}),mk('elm',2.5e6)];
let fail=0;const ok=(name,c,d)=>{console.log((c?'PASS ':'FAIL ')+name+(d?'  '+d:''));if(!c)fail++};
const t0=Date.now(),sim=RM.simulate(specs,400000,206),ms=Date.now()-t0;
specs.forEach((s,i)=>{const a=RM.aal(s),m=RM.metrics(sim.props[i].loss),rel=Math.abs(m.aal-a.total)/a.total;
  ok(`${s.id}: simulated AAL matches analytic AAL within 5%`,rel<0.05,`analytic ${Math.round(a.total)} simulated ${Math.round(m.aal)} (${(rel*100).toFixed(1)}%)`);
  ok(`${s.id}: exceedance curve never decreases with return period`,m.ep.every((e,j)=>j===0||e.loss>=m.ep[j-1].loss));
  ok(`${s.id}: no insured loss exceeds the limit in any year by more than the count of perils`,m.max<=s.limit*5);
  ok(`${s.id}: TVaR99 is at least the 1-in-100 loss`,m.tvar99>=m.pml100);
  const perilSum=Object.values(a.per).reduce((x,p)=>x+p.aal,0);ok(`${s.id}: peril AALs add up to the total`,Math.abs(perilSum-a.total)<1e-6);
  ok(`${s.id}: insured AAL does not exceed ground-up AAL`,a.total<=a.totalGu+1e-9)});
const al=RM.allocation(sim);
ok('co-TVaR shares add up to portfolio TVaR',Math.abs(al.co.reduce((a,b)=>a+b,0)-al.tvar)/al.tvar<1e-9,`${Math.round(al.tvar)}`);
ok('portfolio TVaR is no more than the sum of standalone TVaRs (diversification)',al.tvar<=al.sumAlone+1,`${Math.round(al.tvar)} vs ${Math.round(al.sumAlone)}`);
const sim2=RM.simulate(specs,400000,206);ok('same seed gives the same result',sim2.total.every((v,i)=>v===sim.total[i]));
const solo=RM.simulate([specs[0]],400000,206);ok('a property simulates the same alone as inside the portfolio',solo.props[0].loss.every((v,i)=>v===sim.props[0].loss[i]));
const u=RM.uncertainty(specs[0]);
ok('uncertainty: P10 <= P50 <= P90',u.p10<=u.p50&&u.p50<=u.p90,`${Math.round(u.p10)} / ${Math.round(u.p50)} / ${Math.round(u.p90)}`);
ok('Sobol indices lie in [0,1] and sum to about 1 or less',u.drivers.every(d=>d.sobol>=0&&d.sobol<=1)&&u.explained<=1.0001,u.drivers.map(d=>d.k+' '+d.sobol.toFixed(2)).join(', '));
const base=RM.aal(specs[0]).total,ded=RM.aal({...specs[0],ded:100000}).total,ret=RM.aal(specs[0],{...specs[0].f,ret:0.85}).total;
ok('a higher deductible lowers insured AAL',ded<base);ok('a completed retrofit lowers AAL',ret<base);
const lo=RM.metrics(RM.simulate([specs[0]],400000,206,'lo').total),hi=RM.metrics(RM.simulate([specs[0]],400000,206,'hi').total);
ok('favourable inputs give a lower AAL than unfavourable ones',lo.aal<hi.aal,`${Math.round(lo.aal)} < ${Math.round(hi.aal)}`);
ok('flood rate: unshaded X is below shaded X, which is below AE',RM.FLOOD_RATE('X (unshaded)')<RM.FLOOD_RATE('X (shaded, 0.2%)')&&RM.FLOOD_RATE('X (shaded, 0.2%)')<RM.FLOOD_RATE('AE'));
specs.forEach((s,i)=>{const m=RM.metrics(sim.props[i].loss),a=RM.aal(s);console.log(`  ${s.id.padEnd(7)} AAL ${Math.round(a.total)}  ${Object.entries(a.per).map(([k,p])=>k+' '+Math.round(p.aal)).join(' ')}  PML100 ${Math.round(m.pml100)} PML250 ${Math.round(m.pml250)} TVaR ${Math.round(m.tvar99)} P(any) ${(m.pAny*100).toFixed(1)}%`)});
const pm=RM.metrics(sim.total);console.log(`  portfolio AAL ${Math.round(pm.aal)} PML100 ${Math.round(pm.pml100)} PML250 ${Math.round(pm.pml250)} TVaR ${Math.round(pm.tvar99)} | tail years with earthquake ${(al.tailEq*100).toFixed(0)}% | sim ${ms} ms`);
console.log(fail?`${fail} FAILED`:'all passed');process.exit(fail?1:0);
