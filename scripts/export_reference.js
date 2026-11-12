// Recomputes python/reference_js.json from riskmodel.js so the Python tests compare against the current web model.
// Run from the repository root:  node scripts/export_reference.js
const fs=require('fs'),path=require('path'),RM=require('../riskmodel.js');
const file=path.join(__dirname,'..','python','reference_js.json'),ref=JSON.parse(fs.readFileSync(file)),r=Math.round;
const sim=RM.simulate(ref.specs),al=RM.allocation(sim),pm=RM.metrics(sim.total);
ref.js={};ref.specs.forEach((s,i)=>{const a=RM.aal(s),m=RM.metrics(sim.props[i].loss),u=RM.uncertainty(s);
  ref.js[s.id]={aal:r(a.total),aalGroundUp:r(a.totalGu),perils:Object.fromEntries(Object.entries(a.per).map(([k,p])=>[k,r(p.aal)])),simAal:r(m.aal),pml100:r(m.pml100),pml250:r(m.pml250),tvar99:r(m.tvar99),p10:r(u.p10),p50:r(u.p50),p90:r(u.p90),
    drivers:u.drivers.map(d=>({k:d.k,share:+d.share.toFixed(3)}))}});
ref.portfolio={aal:r(pm.aal),pml100:r(pm.pml100),pml250:r(pm.pml250),tvar99:r(pm.tvar99),sumStandaloneTvar:r(al.sumAlone),coTvar:Object.fromEntries(ref.specs.map((s,i)=>[s.id,r(al.co[i])]))};
fs.writeFileSync(file,JSON.stringify(ref,null,1)+'\n');console.log('reference written for',ref.specs.length,'properties');
